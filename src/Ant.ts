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

  // Trail deposit tracking (tasks 10-11)
  private stepsSinceLastFoodPherDeposit: number = 0;
  private stepsSinceLastHomePherDeposit: number = 0;
  private distanceTraveled: number = 0;

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

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any, allAnts?: Ant[]): void {
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

    // Traffic smoothing (Task 16) - slow down in crowded areas
    let speedMultiplier = 1.0;
    if (allAnts) {
      const nearbyCount = this.countNearbyAnts(allAnts);
      if (nearbyCount >= CONFIG.TRAFFIC_SLOWDOWN_THRESHOLD) {
        speedMultiplier = CONFIG.TRAFFIC_SLOWDOWN_FACTOR;
      }
    }

    // Calculate desired new position with traffic smoothing applied
    const newX = this.position.x + this.velocity.x * deltaTime * speedMultiplier;
    const newY = this.position.y + this.velocity.y * deltaTime * speedMultiplier;

    // ALWAYS check for obstacle collision - no exceptions
    if (obstacleManager) {
      // Use slightly larger radius to prevent corner cutting
      const collision = obstacleManager.checkCollision({ x: newX, y: newY }, CONFIG.ANT_COLLISION_RADIUS);
      if (collision) {
        // Hit obstacle - turn away from it
        if (this.followingTrail) {
          this.followingTrail = false;
        }

        // Get direction away from the EDGE, not center (important for rectangular corners!)
        const closestPoint = collision.getClosestPointOnEdge(this.position.x, this.position.y);
        const awayFromEdgeX = this.position.x - closestPoint.x;
        const awayFromEdgeY = this.position.y - closestPoint.y;
        const dist = Math.sqrt(awayFromEdgeX * awayFromEdgeX + awayFromEdgeY * awayFromEdgeY);

        if (dist > 0.1) {
          const awayX = awayFromEdgeX / dist;
          const awayY = awayFromEdgeY / dist;

          // If returning with food, blend away direction with colony direction
          if (this.state === AntState.RETURNING) {
            const toColony = {
              x: this.colony.x - this.position.x,
              y: this.colony.y - this.position.y,
            };
            const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
            if (colonyDist > 0) {
              const colonyDirX = toColony.x / colonyDist;
              const colonyDirY = toColony.y / colonyDist;

              // 70% away from wall, 30% toward colony
              const blendX = awayX * CONFIG.ANT_WALL_AVOIDANCE_BLEND_AWAY + colonyDirX * CONFIG.ANT_WALL_AVOIDANCE_BLEND_COLONY;
              const blendY = awayY * CONFIG.ANT_WALL_AVOIDANCE_BLEND_AWAY + colonyDirY * CONFIG.ANT_WALL_AVOIDANCE_BLEND_COLONY;
              const blendDist = Math.sqrt(blendX * blendX + blendY * blendY);

              if (blendDist > 0) {
                this.velocity.x = (blendX / blendDist) * this.maxSpeed;
                this.velocity.y = (blendY / blendDist) * this.maxSpeed;
              }
            } else {
              this.velocity.x = awayX * this.maxSpeed;
              this.velocity.y = awayY * this.maxSpeed;
            }
          } else {
            // Not carrying food - just turn away with some randomness
            const randomAngle = (Math.random() - 0.5) * CONFIG.ANT_RANDOM_TURN_ANGLE_RANGE; // +/- ~15 degrees
            const cos = Math.cos(randomAngle);
            const sin = Math.sin(randomAngle);
            this.velocity.x = (awayX * cos - awayY * sin) * this.maxSpeed;
            this.velocity.y = (awayX * sin + awayY * cos) * this.maxSpeed;
          }
        }

        // Don't update position - collision prevents movement
      } else {
        // Safe to move
        this.position.x = newX;
        this.position.y = newY;
      }

      // Safety check: if somehow already inside an obstacle, push out immediately
      // Use same radius as collision check to be consistent
      const insideObstacle = obstacleManager.checkCollision(this.position, CONFIG.ANT_COLLISION_RADIUS);
      if (insideObstacle) {
        // Emergency push out - use closest edge point for accurate push direction
        const closestPoint = insideObstacle.getClosestPointOnEdge(this.position.x, this.position.y);
        const dx = this.position.x - closestPoint.x;
        const dy = this.position.y - closestPoint.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0.1) {
          // Push to at least 20 units away from the edge
          const safeDist = CONFIG.ANT_SAFE_DISTANCE_FROM_OBSTACLE;
          this.position.x = closestPoint.x + (dx / dist) * safeDist;
          this.position.y = closestPoint.y + (dy / dist) * safeDist;

          // Set velocity away from obstacle
          this.velocity.x = (dx / dist) * this.maxSpeed;
          this.velocity.y = (dy / dist) * this.maxSpeed;
        } else {
          const randomAngle = Math.random() * Math.PI * 2;
          this.position.x += Math.cos(randomAngle) * CONFIG.ANT_SAFE_DISTANCE_FROM_OBSTACLE * 2.5;
          this.position.y += Math.sin(randomAngle) * CONFIG.ANT_SAFE_DISTANCE_FROM_OBSTACLE * 2.5;
        }
        this.followingTrail = false;
      }
    } else {
      // No obstacle manager - just update position
      this.position.x = newX;
      this.position.y = newY;
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

      // If stuck, back up and turn - react FAST (0.5 seconds instead of 2)
      if (this.stuckCounter > CONFIG.ANT_STUCK_THRESHOLD) {
        // Back up more aggressively
        this.position.x -= this.velocity.x * CONFIG.ANT_STUCK_BACKUP_DISTANCE;
        this.position.y -= this.velocity.y * CONFIG.ANT_STUCK_BACKUP_DISTANCE;

        // Turn 90-180 degrees (away from obstacle)
        const turnAngle = (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + Math.random() * Math.PI / 2); // 90-180 degrees
        const cos = Math.cos(turnAngle);
        const sin = Math.sin(turnAngle);
        const newVelX = this.velocity.x * cos - this.velocity.y * sin;
        const newVelY = this.velocity.x * sin + this.velocity.y * cos;
        this.velocity.x = newVelX;
        this.velocity.y = newVelY;

        // Normalize to full speed
        const velMag = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
        if (velMag > 0.1) {
          this.velocity.x = (this.velocity.x / velMag) * this.maxSpeed;
          this.velocity.y = (this.velocity.y / velMag) * this.maxSpeed;
        } else {
          // Random direction if velocity is zero
          const randomAngle = Math.random() * Math.PI * 2;
          this.velocity.x = Math.cos(randomAngle) * this.maxSpeed;
          this.velocity.y = Math.sin(randomAngle) * this.maxSpeed;
        }

        this.stuckCounter = 0;
        this.followingTrail = false; // Abandon trail if stuck
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

  /** FORAGING behavior (Task 8) */
  private updateForagingBehavior(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // PRIORITY 1: Direct food sensing (CONFIG.FORAGER_VISION_RANGE)
    let nearestFood: { position: Vector2; distance: number } | null = null;
    let nearestDist = CONFIG.FORAGER_VISION_RANGE; // Standard forager vision range

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

    // If food is nearby, head straight to it (override everything else)
    if (nearestFood) {
      const dx = nearestFood.position.x - this.position.x;
      const dy = nearestFood.position.y - this.position.y;
      const dist = nearestFood.distance;

      this.velocity.x = (dx / dist) * this.maxSpeed;
      this.velocity.y = (dy / dist) * this.maxSpeed;
      return; // Done - heading to food
    }

    // PRIORITY 2: Follow pheromone trails (if they exist)
    const currentPher = this.pheromoneGrid.getPheromoneLevel(this.position.x, this.position.y, 'foodPher');

    if (currentPher > CONFIG.FORAGING_TRAIL_MIN_LEVEL) {
      // On a trail - sample directions to follow it AWAY from colony
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
        this.velocity.x = bestDir.x * this.maxSpeed;
        this.velocity.y = bestDir.y * this.maxSpeed;
        return; // Following trail
      }
    }

    // PRIORITY 3: Explore (no food, no trail)
    // Add occasional random turns to prevent edge hugging
    if (Math.random() < CONFIG.FORAGING_RANDOM_TURN_PROBABILITY) { // 2% chance per frame to make a big turn
      const randomAngle = Math.random() * Math.PI * 2;
      this.velocity.x = Math.cos(randomAngle) * this.maxSpeed;
      this.velocity.y = Math.sin(randomAngle) * this.maxSpeed;
      return;
    }

    const toColonyDist = Math.sqrt(
      (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
    );
    const rays = this.senseEnvironment(foodSources, obstacleManager);
    const candidates: { angle: number; score: number }[] = [];

    for (const ray of rays) {
      let score = 0;

      // Prefer clear paths
      if (!ray.hitObstacle) {
        score += 1.0;
      } else {
        score -= CONFIG.FORAGING_OBSTACLE_PENALTY; // Strong penalty
      }

      // Prefer directions away from colony (exploration bias)
      const rayEndX = this.position.x + Math.cos(ray.angle) * ray.obstacleDistance;
      const rayEndY = this.position.y + Math.sin(ray.angle) * ray.obstacleDistance;
      const rayEndColonyDist = Math.sqrt(
        (rayEndX - this.colony.x) ** 2 + (rayEndY - this.colony.y) ** 2
      );

      if (rayEndColonyDist > toColonyDist) {
        score += CONFIG.FORAGING_EXPLORATION_BONUS; // Small bonus for moving away
      }

      // Very large random component for exploration to prevent edge hugging
      score += (Math.random() - 0.5) * CONFIG.FORAGING_RANDOM_COMPONENT;

      candidates.push({ angle: ray.angle, score });
    }

    // Select with more randomness (higher temperature)
    const chosenAngle = this.selectDirectionSoftmax(candidates);
    this.velocity.x = Math.cos(chosenAngle) * this.maxSpeed;
    this.velocity.y = Math.sin(chosenAngle) * this.maxSpeed;

    // Trail reinforcement: deposit weak homePher every N steps (Task 11)
    this.stepsSinceLastHomePherDeposit++;
    if (this.stepsSinceLastHomePherDeposit >= CONFIG.HOME_PHER_DEPOSIT_INTERVAL && obstacleManager) {
      this.pheromoneGrid.depositPheromone(
        this.position.x,
        this.position.y,
        'homePher',
        CONFIG.FORAGER_HOMEPHER_STRENGTH,
        undefined,
        obstacleManager
      );
      this.stepsSinceLastHomePherDeposit = 0;
    }
  }

  /**
   * Lévy walk step for scouts - power-law distributed step lengths
   * Returns a step length following Lévy distribution with exponent μ
   */
  /**
   * Count nearby ants for traffic smoothing (Task 16)
   */
  private countNearbyAnts(allAnts: Ant[]): number {
    let count = 0;
    const radiusSq = CONFIG.TRAFFIC_DETECTION_RADIUS ** 2;

    for (const other of allAnts) {
      if (other === this || !other.isAlive()) continue;

      const dx = other.position.x - this.position.x;
      const dy = other.position.y - this.position.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < radiusSq) {
        count++;
      }
    }

    return count;
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
      // Head straight to food
      const dx = nearestFood.position.x - this.position.x;
      const dy = nearestFood.position.y - this.position.y;
      const dist = nearestFood.distance;
      this.velocity.x = (dx / dist) * this.maxSpeed;
      this.velocity.y = (dy / dist) * this.maxSpeed;
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
        const bias = (CONFIG.LEVY_COLONY_BIAS_DISTANCE - toColonyDist) / CONFIG.LEVY_COLONY_BIAS_DISTANCE; // 0 to 1
        const randomness = (1 - bias) * Math.PI; // Less randomness when close
        this.levyDirection = awayFromColonyAngle + (Math.random() - 0.5) * randomness;
      } else {
        // Far from colony - fully random
        this.levyDirection = Math.random() * Math.PI * 2;
      }
    }

    // Continue in current Lévy direction
    this.velocity.x = Math.cos(this.levyDirection) * this.maxSpeed;
    this.velocity.y = Math.sin(this.levyDirection) * this.maxSpeed;

    // Decrement remaining step distance
    this.levyStepRemaining -= this.maxSpeed * deltaTime;

    // Apply LIGHT obstacle avoidance (scouts take risks)
    const repulsion = this.getObstacleRepulsion(obstacleManager);
    const repulsionMag = Math.sqrt(repulsion.x ** 2 + repulsion.y ** 2);

    if (repulsionMag > CONFIG.SCOUT_OBSTACLE_REPULSION_THRESHOLD) {
      // Only avoid very close obstacles
      this.velocity.x += repulsion.x * CONFIG.SCOUT_OBSTACLE_CORRECTION_WEIGHT; // Light correction
      this.velocity.y += repulsion.y * CONFIG.SCOUT_OBSTACLE_CORRECTION_WEIGHT;

      // Normalize
      const mag = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2);
      if (mag > 0) {
        this.velocity.x = (this.velocity.x / mag) * this.maxSpeed;
        this.velocity.y = (this.velocity.y / mag) * this.maxSpeed;
      }

      // Only reset Lévy step if VERY close to obstacle
      if (repulsionMag > CONFIG.SCOUT_OBSTACLE_RESET_LEVY_THRESHOLD) {
        this.levyStepRemaining = 0;
      }
    }

    // Only deposit homePher when far from colony (no breadcrumbs near home)
    if (toColonyDist > CONFIG.LEVY_SCOUT_HOMEPHER_DISTANCE) {
      this.stepsSinceLastHomePherDeposit++;
      if (this.stepsSinceLastHomePherDeposit >= CONFIG.SCOUT_HOME_PHER_DEPOSIT_INTERVAL && obstacleManager) {
        this.pheromoneGrid.depositPheromone(
          this.position.x,
          this.position.y,
          'homePher',
          CONFIG.SCOUT_HOMEPHER_STRENGTH, // Scout trails persist longer
          undefined,
          obstacleManager
        );
        this.stepsSinceLastHomePherDeposit = 0;
      }
    }
  }

  /** RETURNING behavior (Task 9) */
  private updateReturningBehavior(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // Deposit foodPher with trail decay gates (Task 10)
    this.stepsSinceLastFoodPherDeposit++;
    if (this.stepsSinceLastFoodPherDeposit >= CONFIG.FOOD_PHER_DEPOSIT_INTERVAL && this.foodSourceId && obstacleManager) {
      this.pheromoneGrid.depositPheromone(
        this.position.x,
        this.position.y,
        'foodPher',
        CONFIG.PHEROMONE_STRENGTH,
        this.foodSourceId,
        obstacleManager
      );
      this.stepsSinceLastFoodPherDeposit = 0;
    }

    // Follow home vector (breadcrumb / homePher gradient)
    const homePherGradient = this.pheromoneGrid.getPheromoneGradient(
      this.position.x,
      this.position.y,
      'homePher'
    );

    const toColony = {
      x: this.colony.x - this.position.x,
      y: this.colony.y - this.position.y,
    };
    const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
    const colonyDir = colonyDist > 0 ? { x: toColony.x / colonyDist, y: toColony.y / colonyDist } : { x: 1, y: 0 };

    // Blend: 70% home vector, 30% homePher gradient
    const gradMag = Math.sqrt(homePherGradient.x ** 2 + homePherGradient.y ** 2);
    let dirX = colonyDir.x * CONFIG.RETURNING_COLONY_WEIGHT;
    let dirY = colonyDir.y * CONFIG.RETURNING_COLONY_WEIGHT;

    if (gradMag > 0.01) {
      dirX += (homePherGradient.x / gradMag) * CONFIG.RETURNING_GRADIENT_WEIGHT;
      dirY += (homePherGradient.y / gradMag) * CONFIG.RETURNING_GRADIENT_WEIGHT;
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

    // Normalize again
    const finalMag = Math.sqrt(dirX * dirX + dirY * dirY);
    if (finalMag > 0) {
      this.velocity.x = (dirX / finalMag) * this.maxSpeed;
      this.velocity.y = (dirY / finalMag) * this.maxSpeed;
    } else {
      // Fallback: just head to colony
      this.velocity.x = colonyDir.x * this.maxSpeed;
      this.velocity.y = colonyDir.y * this.maxSpeed;
    }
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

  // Legacy code below (will be removed after testing)
  /*
  private processOutputsOLD(outputs: number[], deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // OLD IMPLEMENTATION - REPLACED BY PHASE 2 REDESIGN
    if (this.state === AntState.RETURNING) {
      // Use home pheromone gradient to navigate back
      const gradient = this.pheromoneGrid.getPheromoneGradient(
        this.position.x,
        this.position.y,
        'homePher',
        this.foodSourceId || undefined
      );

      // Check if gradient points toward colony
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
      const colonyDir = colonyDist > 0 ? { x: toColony.x / colonyDist, y: toColony.y / colonyDist } : { x: 0, y: 0 };

      // Dot product: if gradient aligns with colony direction, follow it
      const alignment = gradient.x * colonyDir.x + gradient.y * colonyDir.y;
      const gradMag = Math.sqrt(gradient.x * gradient.x + gradient.y * gradient.y);

      // Check current pheromone level - if ANY trail exists, follow it
      const currentLevel = this.pheromoneGrid.getPheromoneLevel(this.position.x, this.position.y, 'homePher');

      // If there's ANY trail (even weak) that leads toward colony, follow it
      if (currentLevel > 1.0 && gradMag > 0.05 && alignment > 0.2) {
        // Trail exists - follow the gradient blindly, trust the path!
        this.followingTrail = true;
        this.velocity.x = gradient.x * this.maxSpeed;
        this.velocity.y = gradient.y * this.maxSpeed;
        return;
      }

      // No trail found - need to navigate
      this.followingTrail = false;

      // No trail exists - be the first ant and navigate with obstacle avoidance
      // Sample multiple directions and pick the best clear one
      if (colonyDist > 0) {
        const dirX = toColony.x / colonyDist;
        const dirY = toColony.y / colonyDist;

        if (obstacleManager) {
          // Check 5 directions: straight, left 45°, right 45°, left 90°, right 90°
          const directions = [
            { x: dirX, y: dirY, angle: 0 }, // Straight
            { x: Math.cos(Math.atan2(dirY, dirX) - Math.PI / 4), y: Math.sin(Math.atan2(dirY, dirX) - Math.PI / 4), angle: -45 }, // Right 45
            { x: Math.cos(Math.atan2(dirY, dirX) + Math.PI / 4), y: Math.sin(Math.atan2(dirY, dirX) + Math.PI / 4), angle: 45 }, // Left 45
            { x: Math.cos(Math.atan2(dirY, dirX) - Math.PI / 2), y: Math.sin(Math.atan2(dirY, dirX) - Math.PI / 2), angle: -90 }, // Right 90
            { x: Math.cos(Math.atan2(dirY, dirX) + Math.PI / 2), y: Math.sin(Math.atan2(dirY, dirX) + Math.PI / 2), angle: 90 }, // Left 90
          ];

          let bestDir = null;
          let bestScore = -Infinity;

          for (const dir of directions) {
            const checkPos = {
              x: this.position.x + dir.x * 60,
              y: this.position.y + dir.y * 60,
            };

            const blocked = obstacleManager.checkCollision(checkPos, 10);

            if (!blocked) {
              // Score: prefer directions closer to colony direction
              const score = dir.x * dirX + dir.y * dirY;
              if (score > bestScore) {
                bestScore = score;
                bestDir = dir;
              }
            }
          }

          if (bestDir) {
            this.velocity.x = bestDir.x * this.maxSpeed;
            this.velocity.y = bestDir.y * this.maxSpeed;
          } else {
            // All blocked - back up
            this.velocity.x = -dirX * this.maxSpeed;
            this.velocity.y = -dirY * this.maxSpeed;
          }
        } else {
          this.velocity.x = dirX * this.maxSpeed;
          this.velocity.y = dirY * this.maxSpeed;
        }
      }
      return;
    }

    // SIMPLE RULE 2: Smell food pheromones? Follow them AWAY from colony.
    // Check pheromone level at current position
    const currentLevel = this.pheromoneGrid.getPheromoneLevel(this.position.x, this.position.y, 'foodPher');

    if (currentLevel > 0.2) {
      // On a trail! Sample 8 directions to find where it leads
      const cellSize = 20;
      let bestDir = null;
      let bestScore = -Infinity;

      const currentDistToColony = Math.sqrt(
        (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
      );

      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        const checkX = this.position.x + dirX * cellSize;
        const checkY = this.position.y + dirY * cellSize;

        const level = this.pheromoneGrid.getPheromoneLevel(checkX, checkY, 'foodPher');

        // Check if this direction leads away from colony
        const distToColonyFromCheck = Math.sqrt(
          (checkX - this.colony.x) ** 2 + (checkY - this.colony.y) ** 2
        );

        // We want: high pheromone level AND leading away from colony
        if (level > 0.1 && distToColonyFromCheck > currentDistToColony) {
          const score = level; // Prefer higher pheromone concentrations
          if (score > bestScore) {
            bestScore = score;
            bestDir = { x: dirX, y: dirY };
          }
        }
      }

      if (bestDir) {
        this.velocity.x = bestDir.x * this.maxSpeed;
        this.velocity.y = bestDir.y * this.maxSpeed;
        return;
      }
    }

    // SIMPLE RULE 3: Can see food? Head directly to food
    if (foodSources && foodSources.length > 0) {
      let nearestFood = null;
      let nearestDist = 300;

      for (const food of foodSources) {
        if (food.isEmpty && food.isEmpty()) continue;

        const dx = food.position.x - this.position.x;
        const dy = food.position.y - this.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestFood = { x: dx, y: dy, dist };
        }
      }

      if (nearestFood) {
        // Just head toward the food - pickup will handle the rest
        this.velocity.x = (nearestFood.x / nearestFood.dist) * this.maxSpeed;
        this.velocity.y = (nearestFood.y / nearestFood.dist) * this.maxSpeed;
        return;
      }
    }

    // SIMPLE RULE 4: No food, no smell? Wander randomly.
    const randomAngle = (Math.random() - 0.5) * 0.3;
    const cos = Math.cos(randomAngle);
    const sin = Math.sin(randomAngle);

    const newVelX = this.velocity.x * cos - this.velocity.y * sin;
    const newVelY = this.velocity.x * sin + this.velocity.y * cos;

    this.velocity.x = newVelX;
    this.velocity.y = newVelY;

    // Keep speed consistent
    const velMag = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (velMag > 0.1) {
      const targetSpeed = this.maxSpeed * 0.8;
      this.velocity.x = (this.velocity.x / velMag) * targetSpeed;
      this.velocity.y = (this.velocity.y / velMag) * targetSpeed;
    }
  }
  */
  // END LEGACY CODE

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

      // Turn around toward colony when picking up food
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
      if (colonyDist > 0) {
        this.velocity.x = (toColony.x / colonyDist) * this.maxSpeed;
        this.velocity.y = (toColony.y / colonyDist) * this.maxSpeed;
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

  public isAlive(): boolean {
    return !this.isDead && this.energy > 0;
  }

  public destroy(): void {
    this.sprite.destroy();
  }
}
