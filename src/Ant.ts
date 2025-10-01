import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2, AntRole, AntState } from './types';
import { PheromoneGrid } from './PheromoneGrid';
import * as CONFIG from './config';

/** Data structure for FOV ray results (Phase 2 Task 6) */
interface RayResult {
  angle: number; // Angle in radians
  hitObstacle: boolean;
  obstacleDistance: number;
  foodPher: number; // Pheromone level at ray end
  homePher: number;
  foodVisible: boolean; // Is food visible along this ray
  foodDistance: number;
}

export class Ant implements Entity {
  public position: Vector2;
  public sprite: Container;
  public role: AntRole = AntRole.FORAGER; // Scout or Forager
  public energy: number = CONFIG.ANT_STARTING_ENERGY;
  public state: AntState = AntState.FORAGING;
  public hasFood: boolean = false; // Keep for backward compatibility temporarily
  public age: number = 0;
  public foodSourceId: string | null = null; // Track which food source this ant is carrying from
  public carryingAmount: number = 0; // How much food currently carrying (0-carryCapacity)
  public carryCapacity: number = 1; // Max food units per trip (role-dependent)
  public trailMisses: number = 0; // Count failed trail attempts → switch to Scout

  // Lévy walk state for scouts
  private levyStepRemaining: number = 0; // Distance left to travel in current Lévy step
  private levyDirection: number = 0; // Current direction for Lévy step

  private velocity: Vector2 = { x: 0, y: 0 };
  private graphics: Graphics;
  private colony: Vector2;
  private maxSpeed: number = 3;
  private pheromoneGrid: PheromoneGrid;
  private isDead: boolean = false;
  private stuckCounter: number = 0;
  private lastPosition: Vector2 = { x: 0, y: 0 };
  private justReturnedTimer: number = 0; // Cooldown after returning food
  private worldWidth: number = 8000;
  private worldHeight: number = 8000;
  private followingTrail: boolean = false; // Track if currently following a pheromone trail

  // Memory fields (redesign task 4)
  private lastHeading: number = 0; // Current heading in radians
  private lastFoodPosition: Vector2 | null = null; // Position of last found food
  private timeSinceLastFood: number = 0; // Time elapsed since last food pickup

  // Distance-based pheromone deposit tracking (replaces frame-based)
  private accumDistFoodPher: number = 0; // Accumulated distance since last foodPher deposit
  private accumDistHomePher: number = 0; // Accumulated distance since last homePher deposit

  // Trail following hysteresis to prevent mode flapping
  private onFoodTrail: boolean = false;
  private trailLatchTimer: number = 0;
  private trailEndCooldown: number = 0;

  // Exploration commitment for smooth foraging movement
  private explorationDirection: number = 0; // Current exploration heading
  private explorationCommitment: number = 0; // Time remaining to stick with current direction

  constructor(
    position: Vector2,
    colony: Vector2,
    pheromoneGrid: PheromoneGrid,
    worldWidth: number = 8000,
    worldHeight: number = 8000,
    role: AntRole = AntRole.FORAGER
  ) {
    this.position = { ...position };
    this.colony = colony;
    this.pheromoneGrid = pheromoneGrid;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.role = role;

    // Set carry capacity based on role
    // Scouts: 1 unit (light and fast)
    // Foragers: 1-2 units (harvest trails)
    if (role === AntRole.SCOUT) {
      this.carryCapacity = CONFIG.SCOUT_CARRY_CAPACITY;
    } else {
      this.carryCapacity = CONFIG.FORAGER_MIN_CARRY_CAPACITY +
        Math.floor(Math.random() * (CONFIG.FORAGER_MAX_CARRY_CAPACITY - CONFIG.FORAGER_MIN_CARRY_CAPACITY + 1));
    }

    // Create sprite
    this.sprite = new Container();
    this.graphics = new Graphics();
    this.sprite.addChild(this.graphics);
    this.renderAnt();

    this.sprite.x = position.x;
    this.sprite.y = position.y;

    this.lastPosition = { ...position };

    // Give ants an initial random velocity so they start exploring smoothly
    const randomAngle = Math.random() * Math.PI * 2;
    this.velocity.x = Math.cos(randomAngle) * this.maxSpeed;
    this.velocity.y = Math.sin(randomAngle) * this.maxSpeed;
    this.lastHeading = randomAngle;
  }

  private renderAnt(): void {
    this.graphics.clear();

    // Size based on role
    const size = CONFIG.ANT_SIZE;

    // Color based on role and state
    let color: number;
    if (this.state === AntState.RETURNING) {
      color = 0xffff00; // Yellow if carrying food
    } else if (this.role === AntRole.SCOUT) {
      color = 0x00ddff; // Cyan for scouts
    } else {
      color = 0xff6644; // Orange-red for foragers
    }

    // Ant body (main circle)
    this.graphics.circle(0, 0, size);
    this.graphics.fill(color);

    // Add a darker center for depth
    this.graphics.circle(0, 0, size * 0.6);
    this.graphics.fill({ color: 0x000000, alpha: 0.3 });

    // If carrying food, draw a small yellow dot
    if (this.state === AntState.RETURNING) {
      this.graphics.circle(0, 0, size * 0.4);
      this.graphics.fill(0xffdd00);
    }

    // Indicate direction with a small line (only if moving significantly)
    const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (speed > 0.5) {
      // Normalize velocity for consistent line length
      const lineLength = CONFIG.ANT_DIRECTION_INDICATOR_LENGTH;
      const dirX = (this.velocity.x / speed) * lineLength;
      const dirY = (this.velocity.y / speed) * lineLength;

      this.graphics.moveTo(0, 0);
      this.graphics.lineTo(dirX, dirY);
      this.graphics.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
    }
  }

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    if (this.isDead) return;

    this.age += deltaTime;

    // Update memory: time since last food
    this.timeSinceLastFood += deltaTime;

    // Energy consumption (and cap deltaTime to prevent huge drains)
    const cappedDelta = Math.min(deltaTime, CONFIG.ANT_MAX_DELTA_TIME);
    this.energy -= CONFIG.ANT_ENERGY_DRAIN * cappedDelta;

    if (this.energy <= 0) {
      this.isDead = true;
      return;
    }

    // Cap velocity at normal maxSpeed - no exceptions!
    let currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (currentSpeed > this.maxSpeed) {
      this.velocity.x = (this.velocity.x / currentSpeed) * this.maxSpeed;
      this.velocity.y = (this.velocity.y / currentSpeed) * this.maxSpeed;
    }

    // Count down return cooldown
    if (this.justReturnedTimer > 0) {
      this.justReturnedTimer -= deltaTime;
    }

    // Process outputs (unless in cooldown period)
    // Using rule-based AI
    if (this.justReturnedTimer <= 0) {
      this.processOutputs(deltaTime, foodSources, obstacleManager);
    }

    // Apply sliding collision physics
    if (obstacleManager) {
      this.sweepAndSlide(deltaTime, obstacleManager);
    } else {
      // No obstacles - just move freely
      this.position.x += this.velocity.x * deltaTime;
      this.position.y += this.velocity.y * deltaTime;
    }


    // THEN check if ant is stuck - but not during cooldown
    if (this.justReturnedTimer <= 0) {
      const distMoved = Math.sqrt(
        (this.position.x - this.lastPosition.x) ** 2 +
        (this.position.y - this.lastPosition.y) ** 2
      );

      // Check current velocity magnitude (detect shimmering)
      const currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);

      // Expected movement based on maxSpeed and deltaTime
      const expectedMinMovement = this.maxSpeed * deltaTime * CONFIG.ANT_EXPECTED_MOVEMENT_RATIO;

      // Stuck if: barely moving OR velocity got killed (shimmering)
      if (distMoved < expectedMinMovement || currentSpeed < this.maxSpeed * CONFIG.ANT_EXPECTED_MOVEMENT_RATIO) {
        this.stuckCounter += deltaTime;
      } else {
        this.stuckCounter = 0;
      }

      // If stuck, smoothly reverse and turn (no teleport)
      if (this.stuckCounter > CONFIG.ANT_STUCK_THRESHOLD) {
        // Steer backward with jitter
        const back = { x: -this.velocity.x, y: -this.velocity.y };
        const backMag = Math.hypot(back.x, back.y);

        if (backMag > 0.001) {
          // Add random jitter to avoid getting stuck in same direction
          const jitter = (Math.random() - 0.5) * 0.6;
          const ang = Math.atan2(back.y, back.x) + jitter;
          const dir = { x: Math.cos(ang), y: Math.sin(ang) };
          this.setDirection(dir, deltaTime);

          // Slow down temporarily to unstick smoothly
          const v = Math.hypot(this.velocity.x, this.velocity.y);
          const slow = Math.max(CONFIG.ANT_MIN_SPEED, v * 0.7);
          const angNow = Math.atan2(this.velocity.y, this.velocity.x);
          this.velocity.x = Math.cos(angNow) * slow;
          this.velocity.y = Math.sin(angNow) * slow;
        } else {
          // No velocity - pick random direction
          const randomAngle = Math.random() * Math.PI * 2;
          const dir = { x: Math.cos(randomAngle), y: Math.sin(randomAngle) };
          this.setDirection(dir, deltaTime);
        }

        this.stuckCounter = 0;
        this.followingTrail = false;
        this.onFoodTrail = false; // Exit trail mode
        this.explorationCommitment = 0; // Reset exploration when stuck
      }
    }

    // Track distance moved for pheromone deposits
    const distMoved = Math.sqrt(
      (this.position.x - this.lastPosition.x) ** 2 +
      (this.position.y - this.lastPosition.y) ** 2
    );

    // Distance-based pheromone deposits
    if (obstacleManager) {
      if (this.state === AntState.RETURNING && this.foodSourceId) {
        // Returning with food - deposit foodPher
        this.accumDistFoodPher += distMoved;

        while (this.accumDistFoodPher >= CONFIG.PHEROMONE_DEPOSIT_DISTANCE) {
          // Interpolate position where deposit should occur
          const ratio = (this.accumDistFoodPher - CONFIG.PHEROMONE_DEPOSIT_DISTANCE) / distMoved;
          const depositX = this.position.x - (this.position.x - this.lastPosition.x) * ratio;
          const depositY = this.position.y - (this.position.y - this.lastPosition.y) * ratio;

          // Deposit amount = strength_per_unit * deposit_distance
          const amount = CONFIG.PHEROMONE_FORAGER_STRENGTH_PER_UNIT * CONFIG.PHEROMONE_DEPOSIT_DISTANCE;

          this.pheromoneGrid.depositPheromone(
            depositX,
            depositY,
            'foodPher',
            amount,
            this.foodSourceId,
            obstacleManager
          );

          this.accumDistFoodPher -= CONFIG.PHEROMONE_DEPOSIT_DISTANCE;
        }
      } else {
        // Foraging - deposit homePher based on role
        this.accumDistHomePher += distMoved;

        while (this.accumDistHomePher >= CONFIG.PHEROMONE_DEPOSIT_DISTANCE) {
          const ratio = (this.accumDistHomePher - CONFIG.PHEROMONE_DEPOSIT_DISTANCE) / distMoved;
          const depositX = this.position.x - (this.position.x - this.lastPosition.x) * ratio;
          const depositY = this.position.y - (this.position.y - this.lastPosition.y) * ratio;

          // Scouts deposit with fade-in based on distance from colony
          if (this.role === AntRole.SCOUT) {
            const distFromColony = Math.sqrt(
              (depositX - this.colony.x) ** 2 + (depositY - this.colony.y) ** 2
            );

            // Fade in trail strength based on distance from colony (no hard gate)
            const fadeStart = CONFIG.LEVY_SCOUT_HOMEPHER_FADE_START;
            const fadeFactor = Math.min(1.0, Math.max(0, (distFromColony - fadeStart) / fadeStart));

            const amount = CONFIG.PHEROMONE_SCOUT_STRENGTH_PER_UNIT * CONFIG.PHEROMONE_DEPOSIT_DISTANCE * fadeFactor;

            if (amount > 0.001) { // Only deposit if significant
              this.pheromoneGrid.depositPheromone(
                depositX,
                depositY,
                'homePher',
                amount,
                undefined,
                obstacleManager
              );
            }
          }
          // Foragers can optionally deposit weak homePher too (trail reinforcement)
          // Currently disabled - uncomment if desired
          /*
          else {
            const amount = CONFIG.PHEROMONE_FORAGER_STRENGTH_PER_UNIT * CONFIG.PHEROMONE_DEPOSIT_DISTANCE * 0.5;
            this.pheromoneGrid.depositPheromone(
              depositX,
              depositY,
              'homePher',
              amount,
              undefined,
              obstacleManager
            );
          }
          */

          this.accumDistHomePher -= CONFIG.PHEROMONE_DEPOSIT_DISTANCE;
        }
      }
    }

    this.lastPosition = { ...this.position };

    // Boundary checking - bounce off edges
    const margin = CONFIG.ANT_WORLD_BOUNDARY_MARGIN;
    if (this.position.x < margin) {
      this.position.x = margin;
      this.velocity.x = Math.abs(this.velocity.x);
    }
    if (this.position.x > this.worldWidth - margin) {
      this.position.x = this.worldWidth - margin;
      this.velocity.x = -Math.abs(this.velocity.x);
    }
    if (this.position.y < margin) {
      this.position.y = margin;
      this.velocity.y = Math.abs(this.velocity.y);
    }
    if (this.position.y > this.worldHeight - margin) {
      this.position.y = this.worldHeight - margin;
      this.velocity.y = -Math.abs(this.velocity.y);
    }

    // Update sprite position
    this.sprite.x = this.position.x;
    this.sprite.y = this.position.y;

    // Update last heading based on current velocity
    if (Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y) > 0.1) {
      this.lastHeading = Math.atan2(this.velocity.y, this.velocity.x);
    }

    // Phase 2: Pheromone deposit now handled via trail decay gates in behavior methods (Tasks 10-11)
    // Old time-based deposit code removed

    // Only re-render every 10 frames to save performance
    if (Math.floor(this.age) % CONFIG.ANT_RENDER_INTERVAL === 0 || this.age < 2) {
      this.renderAnt();
    }
  }

  // ============================================================
  // PHASE 2 REDESIGN: New behavior architecture
  // ============================================================

  /** Cast a single ray for FOV sensing (Task 6) */
  private castRay(angle: number, distance: number, foodSources?: any[], obstacleManager?: any): RayResult {
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const endX = this.position.x + dirX * distance;
    const endY = this.position.y + dirY * distance;

    const result: RayResult = {
      angle,
      hitObstacle: false,
      obstacleDistance: distance,
      foodPher: 0,
      homePher: 0,
      foodVisible: false,
      foodDistance: distance,
    };

    // Check for obstacle collision along ray
    if (obstacleManager) {
      const collision = obstacleManager.checkCollision({ x: endX, y: endY }, 5);
      if (collision) {
        result.hitObstacle = true;
        const dx = endX - this.position.x;
        const dy = endY - this.position.y;
        result.obstacleDistance = Math.sqrt(dx * dx + dy * dy) * CONFIG.FOV_OBSTACLE_DISTANCE_SAFETY; // Slightly shorter to be safe
      }
    }

    // Sample pheromone levels at ray endpoint
    result.foodPher = this.pheromoneGrid.getPheromoneLevel(endX, endY, 'foodPher');
    result.homePher = this.pheromoneGrid.getPheromoneLevel(endX, endY, 'homePher');

    // Check for food visibility along ray
    if (foodSources) {
      for (const food of foodSources) {
        if (food.isEmpty && food.isEmpty()) continue;

        const toFoodX = food.position.x - this.position.x;
        const toFoodY = food.position.y - this.position.y;
        const foodDist = Math.sqrt(toFoodX * toFoodX + toFoodY * toFoodY);

        // Check if food is roughly along this ray direction
        const foodAngle = Math.atan2(toFoodY, toFoodX);
        const angleDiff = Math.abs(foodAngle - angle);

        if (angleDiff < CONFIG.FOV_ANGLE_TOLERANCE && foodDist < distance) { // Within ~17 degrees
          result.foodVisible = true;
          result.foodDistance = foodDist;
          break;
        }
      }
    }

    return result;
  }

  /** Sense environment using FOV rays (Task 6) */
  private senseEnvironment(foodSources?: any[], obstacleManager?: any): RayResult[] {
    const rayCount = CONFIG.FOV_RAY_COUNT;
    const fovAngle = CONFIG.FOV_ANGLE; // 60 degrees
    const rayDistance = CONFIG.FOV_DISTANCE;

    const rays: RayResult[] = [];
    const currentHeading = this.lastHeading;

    // Cast rays in a cone around current heading
    for (let i = 0; i < rayCount; i++) {
      const angleOffset = ((i / (rayCount - 1)) - 0.5) * fovAngle; // -30° to +30°
      const rayAngle = currentHeading + angleOffset;
      rays.push(this.castRay(rayAngle, rayDistance, foodSources, obstacleManager));
    }

    return rays;
  }

  /** Softmax selection over candidate directions (Task 7) */
  private selectDirectionSoftmax(candidates: { angle: number; score: number }[]): number {
    if (candidates.length === 0) return this.lastHeading;

    // Apply softmax with temperature (higher = more random)
    const temperature = CONFIG.SOFTMAX_TEMPERATURE; // Increased for more exploration
    let maxScore = -Infinity;
    for (const c of candidates) {
      if (c.score > maxScore) maxScore = c.score;
    }

    // Normalize scores and compute exp
    const expScores: number[] = [];
    let sumExp = 0;
    for (const c of candidates) {
      const exp = Math.exp((c.score - maxScore) / temperature);
      expScores.push(exp);
      sumExp += exp;
    }

    // Sample from softmax distribution
    const rand = Math.random() * sumExp;
    let cumulative = 0;
    for (let i = 0; i < candidates.length; i++) {
      cumulative += expScores[i];
      if (rand <= cumulative) {
        return candidates[i].angle;
      }
    }

    return candidates[candidates.length - 1].angle;
  }

  /**
   * Swept circle vs AABB collision with sliding (proper physics)
   */
  private sweepAndSlide(dt: number, obstacleManager: any): void {
    let remaining = 1.0;                       // normalized time in [0,1] for this frame
    let iter = 0;
    const walls = obstacleManager.getObstacles();
    const r = CONFIG.ANT_COLLISION_RADIUS;

    // Optional: substep if the ant moves too far in one frame
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const travel = speed * dt;
    const substeps = Math.max(1, Math.ceil(travel / CONFIG.PHYS_SUBSTEP_MAX_DIST));
    const subDt = dt / substeps;

    for (let step = 0; step < substeps; step++) {
      remaining = 1.0;
      iter = 0;

      while (remaining > CONFIG.PHYS_EPS && iter++ < CONFIG.PHYS_MAX_SWEEP_ITERS) {
        const dx = this.velocity.x * subDt * remaining;
        const dy = this.velocity.y * subDt * remaining;
        if (Math.abs(dx) < CONFIG.PHYS_MIN_SPEED && Math.abs(dy) < CONFIG.PHYS_MIN_SPEED) {
          break;
        }

        // Broad: earliest hit among all walls
        let bestT = 1.0, bestN = { x:0, y:0 }, bestWall: any = null, cornerHit = false;

        for (const w of walls) {
          // If already inside (due to previous frame), push out once and continue
          this.depenetrateIfInside(w, r);

          const ex = this.expandAABBByRadius(w, r);
          const hit = this.raycastExpandedAABB(this.position.x, this.position.y, dx, dy, ex);
          if (!hit.hit) continue;

          if (hit.t < bestT) {
            bestT = hit.t;
            bestN = { x: hit.nx, y: hit.ny };
            bestWall = w;
            cornerHit = hit.corner;
          }
        }

        if (!bestWall) {
          // No hit → free move for all remaining time
          this.position.x += dx;
          this.position.y += dy;
          break;
        }

        // Move to impact, leaving a tiny skin to avoid re-penetration
        const tMove = Math.max(0, bestT - CONFIG.PHYS_EPS);
        this.position.x += dx * tMove;
        this.position.y += dy * tMove;

        // If corner, compute the correct corner normal from the **original box**
        if (cornerHit) {
          const impactX = this.position.x;
          const impactY = this.position.y;
          const p = this.closestPointOnRect(impactX, impactY, bestWall); // closest on original (unexpanded) rect
          let nx = impactX - p.x;
          let ny = impactY - p.y;
          const len = Math.hypot(nx, ny);
          if (len > CONFIG.PHYS_EPS) {
            bestN.x = nx / len;
            bestN.y = ny / len;
          } else {
            // Degenerate: fall back to face guess aligned with larger |dx|/|dy|
            if (Math.abs(dx) > Math.abs(dy)) { bestN = {x: dx > 0 ? -1 : 1, y: 0}; }
            else                              { bestN = {x: 0, y: dy > 0 ? -1 : 1}; }
          }
        }

        // Push out by skin along the contact normal
        this.position.x += bestN.x * CONFIG.PHYS_SKIN;
        this.position.y += bestN.y * CONFIG.PHYS_SKIN;

        // Slide: remove normal component from velocity
        const vDotN = this.velocity.x * bestN.x + this.velocity.y * bestN.y;
        if (vDotN < 0) {
          this.velocity.x -= vDotN * bestN.x;
          this.velocity.y -= vDotN * bestN.y;
        }

        // Consume the time we actually advanced
        const consumed = tMove;
        remaining *= (1 - consumed);
        // Prevent tiny infinite loops
        if (remaining < CONFIG.PHYS_EPS) break;
      }
    }
  }

  private steerToward(dir: Vector2, dt: number) {
    // clamp turn rate
    const curAng = Math.atan2(this.velocity.y, this.velocity.x);
    const tgtAng = Math.atan2(dir.y, dir.x);
    let dAng = ((tgtAng - curAng + Math.PI*3) % (Math.PI*2)) - Math.PI;
    const maxTurn = CONFIG.ANT_MAX_TURN * dt;
    dAng = Math.max(-maxTurn, Math.min(maxTurn, dAng));
    const newAng = curAng + dAng;

    // target speed is max; accelerate toward it
    const v = Math.hypot(this.velocity.x, this.velocity.y);
    const targetV = CONFIG.ANT_MAX_SPEED;
    const dvMax = CONFIG.ANT_MAX_ACCEL * dt;
    const newV = v + Math.max(-dvMax, Math.min(dvMax, targetV - v));

    // enforce a small floor to avoid going to 0 after big turns
    const finalV = Math.max(newV, CONFIG.ANT_MIN_SPEED);

    this.velocity.x = Math.cos(newAng) * finalV;
    this.velocity.y = Math.sin(newAng) * finalV;
  }

  private setDirection(dir: Vector2, dt: number) {
    // convenience: normalize dir, then call steerToward
    const m = Math.hypot(dir.x, dir.y);
    if (m > 1e-6) this.steerToward({ x: dir.x / m, y: dir.y / m }, dt);
  }



  /**
   * Push ant out of AABB if already inside (de-penetration)
   */
  private pushOutOfAABB(obstacle: any, radius: number, EPS: number): void {
    const exMinX = obstacle.position.x - obstacle.width / 2 - radius;
    const exMaxX = obstacle.position.x + obstacle.width / 2 + radius;
    const exMinY = obstacle.position.y - obstacle.height / 2 - radius;
    const exMaxY = obstacle.position.y + obstacle.height / 2 + radius;

    const dxL = this.position.x - exMinX;
    const dxR = exMaxX - this.position.x;
    const dyT = this.position.y - exMinY;
    const dyB = exMaxY - this.position.y;

    if (dxL > 0 && dxR > 0 && dyT > 0 && dyB > 0) {
      // inside: push along min penetration axis
      const minX = Math.min(dxL, dxR);
      const minY = Math.min(dyT, dyB);
      if (minX < minY) {
        this.position.x += (dxL < dxR ? -minX - EPS : minX + EPS);
      } else {
        this.position.y += (dyT < dyB ? -minY - EPS : minY + EPS);
      }
    }
  }

  /** Get obstacle repulsion vector (Task 12) */
  private getObstacleRepulsion(obstacleManager?: any): Vector2 {
    if (!obstacleManager) return { x: 0, y: 0 };

    // Check nearby for obstacles
    const checkDistance = CONFIG.OBSTACLE_REPULSION_CHECK_DISTANCE;
    const angles = [0, Math.PI / 4, Math.PI / 2, -Math.PI / 4, -Math.PI / 2];

    let repulsionX = 0;
    let repulsionY = 0;

    for (const offset of angles) {
      const angle = this.lastHeading + offset;
      const checkX = this.position.x + Math.cos(angle) * checkDistance;
      const checkY = this.position.y + Math.sin(angle) * checkDistance;

      const collision = obstacleManager.checkCollision({ x: checkX, y: checkY }, 5);
      if (collision) {
        // Add repulsion away from this direction
        const weight = 1.0 / (CONFIG.OBSTACLE_REPULSION_CHECK_DISTANCE + 1);
        repulsionX -= Math.cos(angle) * weight;
        repulsionY -= Math.sin(angle) * weight;
      }
    }

    return { x: repulsionX, y: repulsionY };
  }

  /** FORAGING behavior (Task 8) with hysteresis */
  private updateForagingBehavior(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // Update cooldown timer
    if (this.trailEndCooldown > 0) {
      this.trailEndCooldown -= deltaTime;
    }

    // PRIORITY 1: Direct food sensing (CONFIG.FORAGER_VISION_RANGE)
    let nearestFood: { position: Vector2; distance: number } | null = null;
    let nearestDist = CONFIG.FORAGER_VISION_RANGE;

    if (foodSources) {
      for (const food of foodSources) {
        if (food.isEmpty && food.isEmpty()) continue;

        const dx = food.position.x - this.position.x;
        const dy = food.position.y - this.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestFood = { position: food.position, distance: dist };
        }
      }
    }

    // If food is nearby, head straight to it using smooth steering
    if (nearestFood) {
      const dir = {
        x: nearestFood.position.x - this.position.x,
        y: nearestFood.position.y - this.position.y
      };
      this.setDirection(dir, deltaTime);
      this.explorationCommitment = 0; // Reset exploration when food is found
      return;
    }

    // PRIORITY 2: Follow pheromone trails with hysteresis
    const currentPher = this.pheromoneGrid.getPheromoneLevel(this.position.x, this.position.y, 'foodPher');

    // Hysteresis: different thresholds for entering vs exiting trail mode
    if (!this.onFoodTrail) {
      if (currentPher >= CONFIG.TRAIL_ENTER_LEVEL) {
        this.onFoodTrail = true;
        this.trailLatchTimer = CONFIG.TRAIL_LATCH_TIME;
        this.explorationCommitment = 0; // Reset exploration when entering trail
      }
    } else {
      if (this.trailLatchTimer > 0) {
        this.trailLatchTimer -= deltaTime;
      }
      if (currentPher < CONFIG.TRAIL_EXIT_LEVEL && this.trailLatchTimer <= 0) {
        this.onFoodTrail = false;
        this.trailEndCooldown = CONFIG.TRAIL_END_COOLDOWN; // Start cooldown
      }
    }

    // Only follow trails if on trail and not in cooldown
    if (this.trailEndCooldown <= 0 && this.onFoodTrail) {
      const toColonyDist = Math.sqrt(
        (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
      );

      let bestDir: Vector2 | null = null;
      let bestScore = -Infinity;

      // Sample 8 directions
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        const checkDist = CONFIG.FORAGING_PHEROMONE_SAMPLE_DISTANCE;
        const checkX = this.position.x + Math.cos(angle) * checkDist;
        const checkY = this.position.y + Math.sin(angle) * checkDist;

        const pherLevel = this.pheromoneGrid.getPheromoneLevel(checkX, checkY, 'foodPher');
        const distToColony = Math.sqrt((checkX - this.colony.x) ** 2 + (checkY - this.colony.y) ** 2);

        // Score: high pheromone + moving away from colony
        if (pherLevel > CONFIG.FORAGING_TRAIL_SAMPLE_MIN && distToColony > toColonyDist) {
          const score = pherLevel;
          if (score > bestScore) {
            bestScore = score;
            bestDir = { x: Math.cos(angle), y: Math.sin(angle) };
          }
        }
      }

      if (bestDir) {
        this.setDirection(bestDir, deltaTime);
        return;
      }
    }

    // PRIORITY 3: Explore with commitment (smooth, purposeful movement)
    // Update commitment timer
    if (this.explorationCommitment > 0) {
      this.explorationCommitment -= deltaTime;
    }

    // If still committed, continue in current direction
    if (this.explorationCommitment > 0) {
      const dir = { x: Math.cos(this.explorationDirection), y: Math.sin(this.explorationDirection) };
      this.setDirection(dir, deltaTime);
      return;
    }

    // Time to pick a new exploration direction
    const toColonyDist = Math.sqrt(
      (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
    );
    const rays = this.senseEnvironment(foodSources, obstacleManager);
    const candidates: { angle: number; score: number }[] = [];

    for (const ray of rays) {
      let score = 0;

      if (!ray.hitObstacle) {
        score += 1.0;
      } else {
        score -= CONFIG.FORAGING_OBSTACLE_PENALTY;
      }

      const rayEndX = this.position.x + Math.cos(ray.angle) * ray.obstacleDistance;
      const rayEndY = this.position.y + Math.sin(ray.angle) * ray.obstacleDistance;
      const rayEndColonyDist = Math.sqrt(
        (rayEndX - this.colony.x) ** 2 + (rayEndY - this.colony.y) ** 2
      );

      if (rayEndColonyDist > toColonyDist) {
        score += CONFIG.FORAGING_EXPLORATION_BONUS;
      }

      score += (Math.random() - 0.5) * CONFIG.FORAGING_RANDOM_COMPONENT;

      candidates.push({ angle: ray.angle, score });
    }

    // Pick new direction and commit to it
    const chosenAngle = this.selectDirectionSoftmax(candidates);
    this.explorationDirection = chosenAngle;
    this.explorationCommitment = CONFIG.FORAGING_EXPLORATION_MIN_DURATION +
      Math.random() * (CONFIG.FORAGING_EXPLORATION_MAX_DURATION - CONFIG.FORAGING_EXPLORATION_MIN_DURATION);

    const dir = { x: Math.cos(chosenAngle), y: Math.sin(chosenAngle) };
    this.setDirection(dir, deltaTime);
  }

  /**
   * Lévy walk step for scouts - power-law distributed step lengths
   * Returns a step length following Lévy distribution with exponent μ
   */
  private levyStep(mu: number = CONFIG.LEVY_WALK_MU): number {
    // Lévy flight: most steps are short, occasional long jumps
    // Use proper Lévy distribution: step ~ (1-U)^(-1/(μ-1)) scaled
    const u = Math.random();
    const minStep = CONFIG.LEVY_WALK_MIN_STEP;
    const maxStep = CONFIG.LEVY_WALK_MAX_STEP;

    // Scale factor to make distribution useful
    const scale = CONFIG.LEVY_WALK_SCALE;
    const rawStep = scale * Math.pow(1 - u, -1 / (mu - 1));

    // Clamp to reasonable bounds
    return Math.min(maxStep, Math.max(minStep, rawStep));
  }

  /** SCOUT behavior - Lévy walk exploration */
  private updateScoutBehavior(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // PRIORITY 1: Scouts have better vision range (CONFIG.SCOUT_VISION_RANGE)
    let nearestFood: { position: Vector2; distance: number } | null = null;
    let nearestDist = CONFIG.SCOUT_VISION_RANGE; // Extended scout vision range

    if (foodSources) {
      for (const food of foodSources) {
        if (food.amount <= 0) continue;
        const dx = food.position.x - this.position.x;
        const dy = food.position.y - this.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestFood = { position: food.position, distance: dist };
        }
      }
    }

    if (nearestFood) {
      // Head straight to food using smooth steering
      const dir = {
        x: nearestFood.position.x - this.position.x,
        y: nearestFood.position.y - this.position.y
      };
      this.setDirection(dir, deltaTime);
      return;
    }

    // Calculate distance from colony
    const toColonyDist = Math.sqrt(
      (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
    );

    // PRIORITY 2: Lévy walk - commit to direction for Lévy-distributed steps
    if (this.levyStepRemaining <= 0) {
      // Pick new Lévy step length
      this.levyStepRemaining = this.levyStep(CONFIG.LEVY_WALK_MU);

      // Bias direction away from colony (especially when close)
      const awayFromColonyAngle = Math.atan2(
        this.position.y - this.colony.y,
        this.position.x - this.colony.x
      );

      if (toColonyDist < CONFIG.LEVY_COLONY_BIAS_DISTANCE) {
        // Close to colony - strongly bias away
        const bias = (CONFIG.LEVY_COLONY_BIAS_DISTANCE - toColonyDist) / CONFIG.LEVY_COLONY_BIAS_DISTANCE;
        const randomness = (1 - bias) * Math.PI;
        this.levyDirection = awayFromColonyAngle + (Math.random() - 0.5) * randomness;
      } else {
        // Far from colony - fully random
        this.levyDirection = Math.random() * Math.PI * 2;
      }
    }

    // Continue in current Lévy direction using smooth steering
    const dir = { x: Math.cos(this.levyDirection), y: Math.sin(this.levyDirection) };
    this.setDirection(dir, deltaTime);

    // Decrement remaining step distance
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.y);
    this.levyStepRemaining -= currentSpeed * deltaTime;

    // Apply LIGHT obstacle avoidance (scouts take risks)
    const repulsion = this.getObstacleRepulsion(obstacleManager);
    const repulsionMag = Math.sqrt(repulsion.x ** 2 + repulsion.y ** 2);

    if (repulsionMag > CONFIG.SCOUT_OBSTACLE_REPULSION_THRESHOLD) {
      // Only avoid very close obstacles - use steering
      const avoidDir = { x: repulsion.x, y: repulsion.y };
      // Blend current direction with avoidance
      const blendedDir = {
        x: dir.x + avoidDir.x * CONFIG.SCOUT_OBSTACLE_CORRECTION_WEIGHT,
        y: dir.y + avoidDir.y * CONFIG.SCOUT_OBSTACLE_CORRECTION_WEIGHT
      };
      this.setDirection(blendedDir, deltaTime);

      // Only reset Lévy step if VERY close to obstacle
      if (repulsionMag > CONFIG.SCOUT_OBSTACLE_RESET_LEVY_THRESHOLD) {
        this.levyStepRemaining = 0;
      }
    }

    // Pheromone deposits now handled by distance-based system in update() method
  }

  /** RETURNING behavior (Task 9) - with magnitude-aware gradient steering */
  private updateReturningBehavior(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // Pheromone deposits now handled by distance-based system in update() method

    // Get homePher gradient (preserves magnitude)
    const gradient = this.pheromoneGrid.getPheromoneGradient(
      this.position.x,
      this.position.y,
      'homePher'
    );

    // Compute gradient magnitude for weighting
    const gradMag = Math.hypot(gradient.x, gradient.y);

    // Apply soft threshold to gradient magnitude
    const mEff = Math.max(0, Math.min(1,
      (gradMag - CONFIG.GRADIENT_MIN_THRESHOLD) / CONFIG.GRADIENT_SPAN
    ));

    const toColony = {
      x: this.colony.x - this.position.x,
      y: this.colony.y - this.position.y,
    };
    const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
    const colonyDir = colonyDist > 0 ? { x: toColony.x / colonyDist, y: toColony.y / colonyDist } : { x: 1, y: 0 };

    // Magnitude-aware blending: stronger gradients pull harder
    // When gradient is strong (mEff → 1), follow it more
    // When gradient is weak (mEff → 0), rely on colony vector
    const gradientWeight = CONFIG.RETURNING_GRADIENT_WEIGHT * mEff;
    const colonyWeight = CONFIG.RETURNING_COLONY_WEIGHT + CONFIG.RETURNING_GRADIENT_WEIGHT * (1 - mEff);

    let dirX = colonyDir.x * colonyWeight;
    let dirY = colonyDir.y * colonyWeight;

    if (gradMag > 0) {
      const gradDirX = gradient.x / gradMag;
      const gradDirY = gradient.y / gradMag;
      dirX += gradDirX * gradientWeight;
      dirY += gradDirY * gradientWeight;
    }

    // Normalize
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    if (mag > 0) {
      dirX /= mag;
      dirY /= mag;
    }

    // Apply obstacle repulsion (Task 12)
    const repulsion = this.getObstacleRepulsion(obstacleManager);
    dirX += repulsion.x * CONFIG.RETURNING_OBSTACLE_REPULSION_WEIGHT;
    dirY += repulsion.y * CONFIG.RETURNING_OBSTACLE_REPULSION_WEIGHT;

    // Use smooth steering instead of direct velocity assignment
    const dir = { x: dirX, y: dirY };
    this.setDirection(dir, deltaTime);
  }

  // ============================================================
  // END PHASE 2 REDESIGN
  // ============================================================

  private processOutputs(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // Dispatch based on role and state
    if (this.state === AntState.RETURNING) {
      this.updateReturningBehavior(deltaTime, foodSources, obstacleManager);
    } else {
      // FORAGING state - behavior depends on role
      if (this.role === AntRole.SCOUT) {
        this.updateScoutBehavior(deltaTime, foodSources, obstacleManager);
      } else {
        this.updateForagingBehavior(deltaTime, foodSources, obstacleManager);
      }
    }
  }

  public checkFoodPickup(foodPosition: Vector2, pickupRadius: number = 20, foodSourceId?: string, amountAvailable: number = 1): number {
    if (this.state === AntState.RETURNING) return 0; // Already carrying food

    const dx = this.position.x - foodPosition.x;
    const dy = this.position.y - foodPosition.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < pickupRadius && amountAvailable > 0) {
      // Take a chunk: min(available, carry capacity)
      const amountToTake = Math.min(amountAvailable, this.carryCapacity);
      this.carryingAmount = amountToTake;

      // State transition: Foraging -> Returning
      this.state = AntState.RETURNING;
      this.hasFood = true; // Keep for backward compatibility
      this.foodSourceId = foodSourceId || null; // Remember which food source this came from

      // Update memory: remember this food location and reset timer
      this.lastFoodPosition = { x: foodPosition.x, y: foodPosition.y };
      this.timeSinceLastFood = 0;

      // Restore small amount of energy when finding food (Phase 3 Task 14)
      this.energy = Math.min(CONFIG.ANT_STARTING_ENERGY, this.energy + CONFIG.ANT_ENERGY_FROM_FOOD_PICKUP);

      // IMMEDIATELY move away from food source to prevent getting stuck
      // First, push away from food
      if (dist > 0.1) {
        const awayFromFoodX = dx / dist;
        const awayFromFoodY = dy / dist;
        this.position.x = foodPosition.x + awayFromFoodX * (pickupRadius + CONFIG.ANT_SAFE_DISTANCE_FROM_OBSTACLE / 2);
        this.position.y = foodPosition.y + awayFromFoodY * (pickupRadius + CONFIG.ANT_SAFE_DISTANCE_FROM_OBSTACLE / 2);
      }

      // Turn around toward colony when picking up food (using smooth steering)
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
      if (colonyDist > 0) {
        // Use setDirection for smooth turn toward colony
        // Note: deltaTime isn't passed to checkFoodPickup, so use a typical frame time (1/60)
        const estimatedDt = 1 / 60;
        this.setDirection(toColony, estimatedDt);
      }

      // Reset stuck counters
      this.stuckCounter = 0;

      return amountToTake; // Return amount taken
    }
    return 0; // No food taken
  }

  public checkColonyReturn(returnRadius: number = 50): number {
    if (this.state !== AntState.RETURNING) return 0; // Not carrying food

    const dx = this.position.x - this.colony.x;
    const dy = this.position.y - this.colony.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < returnRadius) {
      const deliveredAmount = this.carryingAmount;

      // State transition: Returning -> Foraging (drop food)
      this.state = AntState.FORAGING;
      this.hasFood = false; // Keep for backward compatibility
      this.carryingAmount = 0; // Drop all food
      this.foodSourceId = null; // Clear food source ID
      this.energy = Math.min(CONFIG.ANT_STARTING_ENERGY, this.energy + CONFIG.ANT_ENERGY_FROM_COLONY); // Restore some energy
      this.explorationCommitment = 0; // Reset exploration when returning to colony

      // Push ant away from colony slightly to prevent clustering
      if (dist > 0) {
        const pushDist = CONFIG.ANT_COLONY_PUSH_DISTANCE;
        this.position.x = this.colony.x + (dx / dist) * pushDist;
        this.position.y = this.colony.y + (dy / dist) * pushDist;

        // Give it outward velocity
        this.velocity.x = (dx / dist) * this.maxSpeed;
        this.velocity.y = (dy / dist) * this.maxSpeed;

        // Set cooldown so ant keeps moving away before other behaviors interfere
        this.justReturnedTimer = CONFIG.ANT_JUST_RETURNED_COOLDOWN; // 30 frames of free movement
        this.stuckCounter = 0; // Reset stuck counter
      }

      return deliveredAmount; // Return amount delivered
    }
    return 0; // No food delivered
  }

  private depenetrateIfInside(obstacle: any, radius: number): boolean {
    const ex = this.expandAABBByRadius(obstacle, radius);
    const inside = (this.position.x > ex.minX && this.position.x < ex.maxX &&
                    this.position.y > ex.minY && this.position.y < ex.maxY);
    if (!inside) return false;

    // Push along min penetration axis (expanded box)
    const dxL = this.position.x - ex.minX;
    const dxR = ex.maxX - this.position.x;
    const dyT = this.position.y - ex.minY;
    const dyB = ex.maxY - this.position.y;

    const minX = Math.min(dxL, dxR);
    const minY = Math.min(dyT, dyB);

    if (minX < minY) {
      const sign = (dxL < dxR) ? -1 : 1;
      this.position.x += sign * (minX + CONFIG.PHYS_SKIN);
    } else {
      const sign = (dyT < dyB) ? -1 : 1;
      this.position.y += sign * (minY + CONFIG.PHYS_SKIN);
    }
    return true;
  }


  private expandAABBByRadius(w: any, r: number) {
    return {
      minX: w.position.x - w.width  / 2 - r,
      maxX: w.position.x + w.width  / 2 + r,
      minY: w.position.y - w.height / 2 - r,
      maxY: w.position.y + w.height / 2 + r,
    };
  }

  private closestPointOnRect(x: number, y: number, w: any) {
    const minX = w.position.x - w.width  / 2;
    const maxX = w.position.x + w.width  / 2;
    const minY = w.position.y - w.height / 2;
    const maxY = w.position.y + w.height / 2;
    const cx = Math.max(minX, Math.min(x, maxX));
    const cy = Math.max(minY, Math.min(y, maxY));
    return { x: cx, y: cy };
  }

  /**
   * Raycast a point moving by (dx,dy) against expanded AABB (swept circle).
   * Returns earliest hit in [0,1] with face normal; for corner hits, caller
   * should recompute the corner normal from closestPointOnRect at impact.
   */
  private raycastExpandedAABB(
    ox: number, oy: number, dx: number, dy: number,
    ex: {minX:number,maxX:number,minY:number,maxY:number}
  ): {hit:boolean; t:number; nx:number; ny:number; corner:boolean} {
    const EPS = CONFIG.PHYS_EPS;

    // Handle zero-velocity
    if (Math.abs(dx) < CONFIG.PHYS_MIN_SPEED && Math.abs(dy) < CONFIG.PHYS_MIN_SPEED) {
      return { hit:false, t:1, nx:0, ny:0, corner:false };
    }

    const invDx = Math.abs(dx) > EPS ? 1 / dx : Number.POSITIVE_INFINITY;
    const invDy = Math.abs(dy) > EPS ? 1 / dy : Number.POSITIVE_INFINITY;

    let tx1 = (ex.minX - ox) * invDx, tx2 = (ex.maxX - ox) * invDx;
    let ty1 = (ex.minY - oy) * invDy, ty2 = (ex.maxY - oy) * invDy;

    let tminX = Math.min(tx1, tx2), tmaxX = Math.max(tx1, tx2);
    let tminY = Math.min(ty1, ty2), tmaxY = Math.max(ty1, ty2);

    const tEntry = Math.max(tminX, tminY);
    const tExit  = Math.min(tmaxX, tmaxY);

    if (tEntry > tExit || tEntry < 0 || tEntry > 1) {
      return { hit:false, t:1, nx:0, ny:0, corner:false };
    }

    // Face normal guess from which axis produced entry
    let nx = 0, ny = 0, corner = false;
    const diff = Math.abs(tminX - tminY);
    if (tminX > tminY + EPS) {
      nx = dx > 0 ? -1 : 1; // hit vertical face
    } else if (tminY > tminX + EPS) {
      ny = dy > 0 ? -1 : 1; // hit horizontal face
    } else {
      // tminX ~ tminY => likely corner; we’ll refine normal later
      corner = true;
    }

    return { hit:true, t: Math.max(0, tEntry), nx, ny, corner };
  }


  public isAlive(): boolean {
    return !this.isDead && this.energy > 0;
  }

  public destroy(): void {
    this.sprite.destroy();
  }
}
