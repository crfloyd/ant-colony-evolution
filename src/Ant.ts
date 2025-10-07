import { Graphics, Container, AnimatedSprite, Sprite, Texture } from 'pixi.js';
import { Entity, Vector2, AntRole, AntState, ScoutState } from './types';
import { PheromoneGrid } from './PheromoneGrid';
import * as CONFIG from './config';
import { antSpriteTextures, scoutSpriteTextures } from './Game';

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

/** Heritable genetic traits for evolution */
export interface AntTraits {
  speedMultiplier: number;      // 0.7-1.3: affects max speed
  visionMultiplier: number;      // 0.7-1.3: affects vision range
  efficiencyMultiplier: number;  // 0.7-1.3: affects energy drain (higher = more efficient)
  carryMultiplier: number;       // 0.7-1.3: affects carry capacity
}

/** Helper to create default traits */
export function createDefaultTraits(): AntTraits {
  return {
    speedMultiplier: 1.0,
    visionMultiplier: 1.0,
    efficiencyMultiplier: 1.0,
    carryMultiplier: 1.0
  };
}

/** Helper to mutate traits with small random changes */
export function mutateTraits(parent: AntTraits, mutationRate: number = 0.1): AntTraits {
  const mutate = (value: number) => {
    const change = (Math.random() - 0.5) * 2 * mutationRate; // ±mutationRate
    return Math.max(0.7, Math.min(1.3, value + change)); // Clamp to 0.7-1.3
  };

  return {
    speedMultiplier: mutate(parent.speedMultiplier),
    visionMultiplier: mutate(parent.visionMultiplier),
    efficiencyMultiplier: mutate(parent.efficiencyMultiplier),
    carryMultiplier: mutate(parent.carryMultiplier)
  };
}

/** Helper to copy traits */
export function copyTraits(traits: AntTraits): AntTraits {
  return { ...traits };
}

export class Ant implements Entity {
  public position: Vector2;
  public sprite: Container;
  public role: AntRole = AntRole.FORAGER; // Scout or Forager
  public energy: number = CONFIG.ANT_STARTING_ENERGY;
  public energyCapacity: number = CONFIG.ANT_STARTING_ENERGY; // Max energy (for UI display)
  public state: AntState = AntState.FORAGING;
  public hasFood: boolean = false; // Keep for backward compatibility temporarily
  public age: number = 0;
  public foodSourceId: string | null = null; // Track which food source this ant is carrying from
  public carryingAmount: number = 0; // How much food currently carrying (0-carryCapacity)
  public carryCapacity: number = 1; // Max food units per trip (role-dependent)
  public trailMisses: number = 0; // Count failed trail attempts → switch to Scout
  public id: string = Math.random().toString(36).substr(2, 9); // Unique ID for debugging
  public static selectedAntId: string | null = null; // Static field for selected ant
  public foodDelivered: number = 0; // Total food delivered (for gene pool weighting)

  // Trait visualization mode (toggled from UI)
  public static showTraitView: boolean = false;

  // Genetic traits (heritable)
  public traits: AntTraits;

  // Scout exploration state
  private explorationTarget: Vector2 | null = null; // Target position for committed exploration
  private smelledFoodId: string | null = null; // Food source being tracked by smell
  private lastSmellDistance: number = Infinity; // Last distance to smelled food
  private smellProgressTimer: number = 0; // Time since last progress toward smell

  // Debug visualization
  public lastFOVRays: RayResult[] = []; // Store last FOV cast for debug visualization

  private velocity: Vector2 = { x: 0, y: 0 };
  private graphics: Graphics | null = null;
  private animatedSprite: AnimatedSprite | null = null;
  private currentSpriteRotation: number = 0; // Smooth rotation tracking
  private foodGraphics: Graphics | null = null; // Tiny food piece when carrying
  private traitGlowGraphics: Graphics | null = null; // Colored glow for trait visualization (deprecated)
  private speedTrailGraphics: Graphics | null = null; // Speed trait: trail behind ant
  private visionConeGraphics: Graphics | null = null; // Vision trait: cone showing vision range
  private efficiencyGlowGraphics: Graphics | null = null; // Efficiency trait: green glow
  private traitVisualsContainer: Container | null = null; // Container for all trait visuals
  private combatIndicatorGraphics: Graphics | null = null; // Combat state indicator (red/blue circle)

  // Trail tracking for speed visualization
  private trailPositions: Array<{x: number, y: number}> = [];
  private colony: Vector2;
  private maxSpeed: number = 3;
  private pheromoneGrid: PheromoneGrid;
  private isDead: boolean = false;
    private wallFollowUntil: number = 0;
  private lastCollisionN: Vector2 | null = null;
public stuckCounter: number = 0;
  private lastPosition: Vector2 = { x: 0, y: 0 };
  public lastDistMoved: number = 0; // For debugging - distance moved last frame
  private lastDistToColony: number = 0; // Track progress toward colony
  public unstuckRecoveryCooldown: number = 0; // Prevent counter reset immediately after unstuck
  public ignorePheromoneTimer: number = 0; // Ignore pheromones during recovery
  private justReturnedTimer: number = 0; // Cooldown after returning food
  public depenetrationDistThisFrame: number = 0; // Track depenetration pushes (not real movement)
  private worldWidth: number = 8000;
  private worldHeight: number = 8000;
  private followingTrail: boolean = false; // Track if currently following a pheromone trail

  // Memory fields (redesign task 4)
  private lastHeading: number = 0; // Current heading in radians
  private previousTargetHeading: number = 0; // Previous target heading for temporal smoothing
  private visualHeading: number = 0; // Visual heading for sprite/FOV (smoothed, stable)
  private lastFoodPosition: Vector2 | null = null; // Position of last found food
  private timeSinceLastFood: number = 0; // Time elapsed since last food pickup

  // Position-based pheromone deposit tracking (prevents circular deposits)
  private lastFoodPheromoneDepositPos: Vector2 | null = null; // Last position where we deposited foodPher
  private lastHomePheromoneDepositPos: Vector2 | null = null; // Last position where we deposited homePher

  // Trail following hysteresis to prevent mode flapping
  private onFoodTrail: boolean = false;
  private trailLatchTimer: number = 0;
  private trailEndCooldown: number = 0;

  // Trail lock system (Task 17) - prevent following dead-end trails
  private trailLockTimer: number = 0; // Time remaining locked from following trails
  private trailFollowStartTime: number = 0; // When we started following current trail
  private trailFollowDistance: number = 0; // Distance traveled while on trail

  // Emergency unstuck system - detect geometric traps
  private unstuckHistory: number[] = []; // Timestamps of recent unstuck triggers
  public emergencyModeTimer: number = 0; // Time remaining in emergency random walk
  private emergencyDirection: number = 0; // Random direction for emergency walk

  // Exploration commitment for smooth foraging movement
  private explorationDirection: number = 0; // Current exploration heading
  private explorationCommitment: number = 0; // Time remaining to stick with current direction

  // Combat system
  private combatTarget: Ant | null = null; // Current enemy ant being fought
  public isInCombat: boolean = false; // Combat state flag
  public fleeing: boolean = false; // Flee state flag
  public fleeDirection: number = 0; // Direction to flee
  private onKillCallback: (() => void) | null = null; // Callback to notify colony of kills

  // Scout state machine (Phase 1.3)
  public scoutState: ScoutState = ScoutState.EXPLORING; // Current scout state (only used for scouts)
  public guardingFoodId: string | null = null; // Food source ID being guarded
  public guardStartTime: number = 0; // Timestamp when started guarding
  public lastForagerSeen: number = 0; // Timestamp when last forager visited guarded food

  constructor(
    position: Vector2,
    colony: Vector2,
    pheromoneGrid: PheromoneGrid,
    worldWidth: number = 8000,
    worldHeight: number = 8000,
    role: AntRole = AntRole.FORAGER,
    traits?: AntTraits,  // Optional traits parameter
    foragerTextures?: Texture[] | null,  // Forager sprite textures
    scoutTextures?: Texture[] | null,  // Scout sprite textures
    onKill?: () => void  // Callback when this ant kills an enemy
  ) {
    this.position = { ...position };
    this.colony = colony;
    this.pheromoneGrid = pheromoneGrid;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.role = role;
    this.onKillCallback = onKill || null;

    // Initialize traits (use provided or create default)
    this.traits = traits ? copyTraits(traits) : createDefaultTraits();

    // Apply trait multipliers to base stats
    // Scouts are 20% faster than foragers (they're lighter and built for exploration)
    const roleSpeedMultiplier = role === AntRole.SCOUT ? 1.2 : 1.0;
    this.maxSpeed = CONFIG.ANT_MAX_SPEED * this.traits.speedMultiplier * roleSpeedMultiplier;

    // Set carry capacity based on role and traits
    // Scouts: 1 unit (light and fast)
    // Foragers: 1-2 units (harvest trails), modified by carry trait
    if (role === AntRole.SCOUT) {
      this.carryCapacity = Math.max(1, Math.floor(CONFIG.SCOUT_CARRY_CAPACITY * this.traits.carryMultiplier));
    } else {
      const baseCapacity = CONFIG.FORAGER_MIN_CARRY_CAPACITY +
        Math.floor(Math.random() * (CONFIG.FORAGER_MAX_CARRY_CAPACITY - CONFIG.FORAGER_MIN_CARRY_CAPACITY + 1));
      this.carryCapacity = Math.max(1, Math.floor(baseCapacity * this.traits.carryMultiplier));
    }

    // Create sprite - use animated sprite if textures loaded, otherwise graphics fallback
    this.sprite = new Container();

    // Choose sprite sheet based on role
    // Use provided textures or fall back to global ones
    const spriteTextures = role === AntRole.SCOUT
      ? (scoutTextures || scoutSpriteTextures)
      : (foragerTextures || antSpriteTextures);

    if (spriteTextures && spriteTextures.length > 0) {
      // Use animated sprite
      this.animatedSprite = new AnimatedSprite(spriteTextures);
      this.animatedSprite.animationSpeed = 0.1; // Slow animation speed

      // Randomize starting frame to desynchronize animations
      this.animatedSprite.currentFrame = Math.floor(Math.random() * spriteTextures.length);

      this.animatedSprite.play();
      this.animatedSprite.anchor.set(0.5); // Center the sprite

      // Scale based on carry capacity trait (bigger ant = more carry capacity)
      const baseScale = 0.3;
      const scaleMultiplier = 0.8 + (this.traits.carryMultiplier * 0.4); // 0.8-1.2x scale for 0.7-1.3 carry
      this.animatedSprite.scale.set(baseScale * scaleMultiplier);

      // Set z-index based on y position to reduce flickering when bunched up
      this.sprite.zIndex = position.y;

      this.sprite.addChild(this.animatedSprite);

      // Create trait visuals container (behind ant sprite)
      this.traitVisualsContainer = new Container();
      this.sprite.addChildAt(this.traitVisualsContainer, 0); // Behind sprite

      // Speed trail (shows movement path)
      this.speedTrailGraphics = new Graphics();
      this.traitVisualsContainer.addChild(this.speedTrailGraphics);

      // Vision cone (shows vision range)
      this.visionConeGraphics = new Graphics();
      this.traitVisualsContainer.addChild(this.visionConeGraphics);

      // Efficiency glow (behind ant)
      this.efficiencyGlowGraphics = new Graphics();
      this.traitVisualsContainer.addChild(this.efficiencyGlowGraphics);

      // Create food graphics for when carrying
      this.foodGraphics = new Graphics();
      this.sprite.addChild(this.foodGraphics);

      // Create combat indicator graphics (red/blue circle)
      this.combatIndicatorGraphics = new Graphics();
      this.sprite.addChild(this.combatIndicatorGraphics);
    } else {
      // Fallback to graphics rendering
      this.graphics = new Graphics();
      this.sprite.addChild(this.graphics);
      this.renderAnt();
    }

    this.sprite.x = position.x;
    this.sprite.y = position.y;

    this.lastPosition = { ...position };
    this.lastDistToColony = Math.sqrt(
      (position.x - colony.x) ** 2 + (position.y - colony.y) ** 2
    );

    // Give ants an initial random velocity so they start exploring smoothly
    const randomAngle = Math.random() * Math.PI * 2;
    this.velocity.x = Math.cos(randomAngle) * this.maxSpeed;
    this.velocity.y = Math.sin(randomAngle) * this.maxSpeed;
    this.lastHeading = randomAngle;
    this.previousTargetHeading = randomAngle; // Initialize temporal smoothing
    this.currentSpriteRotation = randomAngle + Math.PI / 2; // Initialize sprite rotation
  }

  /** Render visual indicators for genetic traits */
  private renderTraitVisuals(): void {
    if (!Ant.showTraitView || !this.traitVisualsContainer) {
      // Hide all trait visuals when trait view is off
      if (this.traitVisualsContainer) {
        this.traitVisualsContainer.visible = false;
      }
      return;
    }

    this.traitVisualsContainer.visible = true;

    // 1. SPEED TRAIT: Trail behind ant (brighter/longer = faster)
    if (this.speedTrailGraphics) {
      this.speedTrailGraphics.clear();

      // Show trail for any speed above baseline (trail length shows the amount)
      if (this.traits.speedMultiplier > 1.0) {
        // Update trail positions (store last N positions)
        const maxTrailLength = Math.floor(5 + (this.traits.speedMultiplier - 1.0) * 30); // 5-20 points
        this.trailPositions.unshift({ x: 0, y: 0 }); // Add current position (relative to sprite)
        if (this.trailPositions.length > maxTrailLength) {
          this.trailPositions.pop();
        }

        // Draw trail as fading line
        if (this.trailPositions.length > 1) {
          for (let i = 0; i < this.trailPositions.length - 1; i++) {
            const alpha = (1 - i / this.trailPositions.length) * 0.6; // Fade out
            const width = 3 * (1 - i / this.trailPositions.length); // Taper

            this.speedTrailGraphics.moveTo(this.trailPositions[i].x, this.trailPositions[i].y);
            this.speedTrailGraphics.lineTo(this.trailPositions[i + 1].x, this.trailPositions[i + 1].y);
            this.speedTrailGraphics.stroke({ width, color: 0xff3333, alpha }); // Red trail
          }
        }
      } else {
        this.trailPositions = []; // Clear trail if speed is baseline
      }
    }

    // 2. VISION TRAIT: Cone and rays showing vision range (any improvement)
    if (this.visionConeGraphics) {
      this.visionConeGraphics.clear();

      // Show cone for any vision above baseline (cone length shows the amount)
      if (this.traits.visionMultiplier > 1.0) {
        // Determine vision range based on role and trait
        const baseVisionRange = this.role === AntRole.SCOUT ? CONFIG.SCOUT_VISION_RANGE : CONFIG.FORAGER_VISION_RANGE;
        const visionRange = baseVisionRange * this.traits.visionMultiplier;
        const heading = Math.atan2(this.velocity.y, this.velocity.x);
        const fovAngle = CONFIG.FOV_ANGLE;

        // Draw vision cone outline
        this.visionConeGraphics.moveTo(0, 0);
        this.visionConeGraphics.arc(0, 0, visionRange, heading - fovAngle / 2, heading + fovAngle / 2);
        this.visionConeGraphics.lineTo(0, 0);
        this.visionConeGraphics.fill({ color: 0x3366ff, alpha: 0.1 }); // Light blue cone
        this.visionConeGraphics.stroke({ width: 1, color: 0x3366ff, alpha: 0.3 });

        // Draw actual FOV rays to show the sensing mechanism
        const rayCount = CONFIG.FOV_RAY_COUNT;
        for (let i = 0; i < rayCount; i++) {
          const rayAngle = heading - fovAngle / 2 + (fovAngle / (rayCount - 1)) * i;
          const rayEndX = Math.cos(rayAngle) * visionRange;
          const rayEndY = Math.sin(rayAngle) * visionRange;

          this.visionConeGraphics.moveTo(0, 0);
          this.visionConeGraphics.lineTo(rayEndX, rayEndY);
          this.visionConeGraphics.stroke({ width: 1, color: 0x6699ff, alpha: 0.4 });
        }
      }
    }

    // 3. EFFICIENCY TRAIT: Green glow (pulsing based on efficiency)
    if (this.efficiencyGlowGraphics) {
      this.efficiencyGlowGraphics.clear();

      // Show glow for any efficiency above baseline (pulse intensity shows the amount)
      if (this.traits.efficiencyMultiplier > 1.0) {
        const intensity = (this.traits.efficiencyMultiplier - 1.0) * 2; // 0-0.6 for 1.0-1.3
        const pulse = Math.sin(this.age * 3) * 0.5 + 0.5; // Pulsing effect
        const alpha = Math.min(0.4, intensity * pulse * 0.8);

        this.efficiencyGlowGraphics.circle(0, 0, 15);
        this.efficiencyGlowGraphics.fill({ color: 0x33ff33, alpha }); // Green glow
      }
    }
  }

  /** Calculate trait-based tint color */
  private getTraitTint(): number {
    if (!Ant.showTraitView) {
      // Normal mode - color based on role
      return this.role === AntRole.SCOUT ? 0xff6666 : 0xff6644;
    }

    // Trait view mode - show ONLY truly exceptional traits (top 5%)
    // Map traits to colors: Speed=Red, Vision=Blue, Efficiency=Green, Carry=Yellow
    const { speedMultiplier, visionMultiplier, efficiencyMultiplier, carryMultiplier } = this.traits;

    // STRICT threshold - only the best of the best get colors
    const EXCEPTIONAL_THRESHOLD = 1.15; // Must be 15% above average to show ANY glow

    // Check each trait for extremes
    const extremes = [
      { value: speedMultiplier, color: 0xff0000 },      // Bright Red
      { value: visionMultiplier, color: 0x0088ff },     // Bright Blue
      { value: efficiencyMultiplier, color: 0x00ff00 }, // Bright Green
      { value: carryMultiplier, color: 0xffcc00 }       // Bright Orange/Yellow
    ];

    // Find the highest trait
    let maxValue = 0;
    let extremeColor = 0x000000; // Black = no glow

    for (const trait of extremes) {
      if (trait.value > maxValue) {
        maxValue = trait.value;
        extremeColor = trait.color;
      }
    }

    // ONLY show glow if the ant has at least ONE trait above the exceptional threshold
    if (maxValue < EXCEPTIONAL_THRESHOLD) {
      return 0x000000; // No glow - this is an average ant
    }

    // Brightness scales from 1.15 (faint) to 1.3 (max bright)
    const intensity = Math.min(1, (maxValue - EXCEPTIONAL_THRESHOLD) / 0.15);

    // Return pure color
    const r = Math.floor(((extremeColor >> 16) & 0xff) * (0.5 + intensity * 0.5)); // At least 50% brightness
    const g = Math.floor(((extremeColor >> 8) & 0xff) * (0.5 + intensity * 0.5));
    const b = Math.floor((extremeColor & 0xff) * (0.5 + intensity * 0.5));

    return ((r << 16) | (g << 8) | b);
  }

  private renderAnt(): void {
    if (this.animatedSprite) {
      // Render trait visualizations when trait view is enabled
      this.renderTraitVisuals();

      // Combat visual indicator - circle around ant
      if (this.combatIndicatorGraphics) {
        this.combatIndicatorGraphics.clear();

        if (this.fleeing) {
          // Blue circle for fleeing
          this.combatIndicatorGraphics.circle(0, 0, 18);
          this.combatIndicatorGraphics.stroke({ width: 3, color: 0x0088ff, alpha: 0.8 });
        } else if (this.isInCombat) {
          // Red circle for combat
          this.combatIndicatorGraphics.circle(0, 0, 18);
          this.combatIndicatorGraphics.stroke({ width: 3, color: 0xff0000, alpha: 0.8 });
        }
      }

      // Rotate sprite to match VISUAL heading (where ant wants to go, not micro-adjustments)
      // Add π/2 offset because sprite faces upward by default
      const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
      if (speed > 0.1) {
        const targetRotation = this.visualHeading + Math.PI / 2;

        // Calculate shortest angular distance
        let diff = targetRotation - this.currentSpriteRotation;
        // Normalize to [-π, π]
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Lerp rotation smoothly (0.2 = 20% per frame)
        this.currentSpriteRotation += diff * 0.2;
        this.animatedSprite.rotation = this.currentSpriteRotation;
      }

      // Draw tiny food piece when carrying
      if (this.foodGraphics) {
        this.foodGraphics.clear();
        if (this.state === AntState.RETURNING && this.carryingAmount > 0) {
          // Small brown circle on the ant's back
          this.foodGraphics.circle(0, -8, 4); // Position above center
          this.foodGraphics.fill({ color: 0x8B4513, alpha: 0.9 }); // Brown food
        }
      }
    } else if (this.graphics) {
      // Fallback graphics rendering
      this.graphics.clear();

      // Size based on role
      const size = CONFIG.ANT_SIZE;

      // Ant body (main circle)
      this.graphics.circle(0, 0, size);
      this.graphics.fill(color);

      // Add a darker center for depth
      this.graphics.circle(0, 0, size * 0.6);
      this.graphics.fill({ color: 0x000000, alpha: 0.3 });

      // If carrying food, draw a small brown dot
      if (this.state === AntState.RETURNING && this.carryingAmount > 0) {
        this.graphics.circle(0, -size * 0.6, size * 0.5); // Position above center
        this.graphics.fill({ color: 0x8B4513, alpha: 0.9 }); // Brown food
      }

      // Combat indicator circle
      if (this.fleeing) {
        // Blue circle for fleeing
        this.graphics.circle(0, 0, size * 3);
        this.graphics.stroke({ width: 2, color: 0x0088ff, alpha: 0.8 });
      } else if (this.isInCombat) {
        // Red circle for combat
        this.graphics.circle(0, 0, size * 3);
        this.graphics.stroke({ width: 2, color: 0xff0000, alpha: 0.8 });
      }

      // Indicate direction with a small line (only if moving significantly)
      const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
      if (speed > 0.5) {
        // Use visual heading for direction indicator
        const lineLength = CONFIG.ANT_DIRECTION_INDICATOR_LENGTH;
        const dirX = Math.cos(this.visualHeading) * lineLength;
        const dirY = Math.sin(this.visualHeading) * lineLength;

        this.graphics.moveTo(0, 0);
        this.graphics.lineTo(dirX, dirY);
        this.graphics.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
      }
    }
  }

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any, enemyAnts?: Ant[]): void {
    if (this.isDead) return;

    // Combat detection and behavior (happens before other behaviors)
    if (enemyAnts && enemyAnts.length > 0) {
      this.handleCombat(deltaTime, enemyAnts);
    }

    // Sanity check: if RETURNING with no food, reset to FORAGING
    // This shouldn't happen but fixes edge cases
    if (this.state === AntState.RETURNING && this.carryingAmount <= 0) {
      if (this.id === Ant.selectedAntId) {
        console.log('[Selected Ant] Fixed RETURNING with 0 carrying - reset to FORAGING');
      }
      this.state = AntState.FORAGING;
      this.hasFood = false;
      this.stuckCounter = 0; // Reset stuck counter when fixing state
      this.lastHomePheromoneDepositPos = null; // Reset for new foraging trail
    }

    this.age += deltaTime;

    // Update memory: time since last food
    this.timeSinceLastFood += deltaTime;

    // Energy consumption (and cap deltaTime to prevent huge drains)
    // Ants carrying food have greatly reduced energy drain (they're eating on the way!)
    const cappedDelta = Math.min(deltaTime, CONFIG.ANT_MAX_DELTA_TIME);
    const energyMultiplier = this.hasFood ? 0.2 : 1.0; // 80% reduction when carrying food
    // Apply energy drain with efficiency trait (higher efficiency = less drain)
    const efficiencyFactor = 1.0 / this.traits.efficiencyMultiplier;
    this.energy -= CONFIG.ANT_ENERGY_DRAIN * cappedDelta * energyMultiplier * efficiencyFactor;

    if (this.energy <= 0) {
      this.isDead = true;
      return;
    }

    // Reset depenetration tracker for this frame
    this.depenetrationDistThisFrame = 0;

    // Cap velocity at normal maxSpeed - no exceptions!
    let currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (currentSpeed > this.maxSpeed) {
      this.velocity.x = (this.velocity.x / currentSpeed) * this.maxSpeed;
      this.velocity.y = (this.velocity.y / currentSpeed) * this.maxSpeed;
    }

    // Count down cooldowns (clamp to prevent negative values)
    if (this.justReturnedTimer > 0) {
      this.justReturnedTimer = Math.max(0, this.justReturnedTimer - deltaTime);
    }
    if (this.unstuckRecoveryCooldown > 0) {
      this.unstuckRecoveryCooldown = Math.max(0, this.unstuckRecoveryCooldown - deltaTime);
    }
    if (this.ignorePheromoneTimer > 0) {
      this.ignorePheromoneTimer = Math.max(0, this.ignorePheromoneTimer - deltaTime);
    }
    if (this.trailLockTimer > 0) {
      this.trailLockTimer = Math.max(0, this.trailLockTimer - deltaTime);
    }
    if (this.emergencyModeTimer > 0) {
      this.emergencyModeTimer = Math.max(0, this.emergencyModeTimer - deltaTime);
    }

    // Process outputs (unless in cooldown period or engaged in combat)
    // Using rule-based AI
    if (this.justReturnedTimer <= 0 && !this.fleeing && !this.isInCombat) {
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

    // Calculate distance moved this frame (always, for debug panel)
    const distMoved = Math.sqrt(
      (this.position.x - this.lastPosition.x) ** 2 +
      (this.position.y - this.lastPosition.y) ** 2
    );
    this.lastDistMoved = distMoved;

    // Calculate "real" movement (exclude depenetration pushes which are fighting navigation)
    const realMovement = Math.max(0, distMoved - this.depenetrationDistThisFrame);

    // THEN check if ant is stuck - but not during cooldown
    if (this.justReturnedTimer <= 0) {
      // During recovery cooldown, skip stuck detection entirely - just let recovery run
      if (this.unstuckRecoveryCooldown > 0) {
        if (this.id === Ant.selectedAntId && this.stuckCounter > 0.1) {
          console.log(`[Selected Ant] In recovery cooldown (${this.unstuckRecoveryCooldown.toFixed(2)}s), skipping stuck detection, counter: ${this.stuckCounter.toFixed(2)}s`);
        }
      } else {
        // Normal stuck detection
        const expectedMinMovement = this.maxSpeed * deltaTime * CONFIG.ANT_EXPECTED_MOVEMENT_RATIO;

        let isStuck = false;

        // For RETURNING ants, also check if making progress toward colony
        if (this.state === AntState.RETURNING) {
          const currentDistToColony = Math.sqrt(
            (this.position.x - this.colony.x) ** 2 +
            (this.position.y - this.colony.y) ** 2
          );

          // Check homePher gradient strength - if strong, ant is following a safe path around obstacles
          const gradient = this.pheromoneGrid.getPheromoneGradient(
            this.position.x,
            this.position.y,
            'homePher',
            undefined,
            this.colony
          );
          const gradMag = Math.hypot(gradient.x, gradient.y);

          // If moving but not getting closer to colony (or getting farther), navigationally stuck
          if (realMovement >= expectedMinMovement) {
            // Ant is moving, but is it making progress?
            const progressTowardColony = this.lastDistToColony - currentDistToColony;

            // If in a strong gradient (> 0.5), allow more lateral movement (navigating around obstacles)
            // Otherwise, require more direct progress toward colony
            const progressThreshold = gradMag > 0.5
              ? -expectedMinMovement  // Allow moving away from colony if following strong gradient
              : expectedMinMovement * 0.5;  // Require progress if no gradient to follow

            // Debug: log progress check (only for selected ant)
            if (this.id === Ant.selectedAntId && progressTowardColony < progressThreshold) {
              console.log(`[Selected Ant] Nav stuck check: progress=${progressTowardColony.toFixed(3)}, threshold=${progressThreshold.toFixed(3)}, gradMag=${gradMag.toFixed(3)}, lastDist=${this.lastDistToColony.toFixed(1)}, currentDist=${currentDistToColony.toFixed(1)}`);
            }

            if (progressTowardColony < progressThreshold) {
              // Moving but not making progress toward colony = navigational stuck
              isStuck = true;
            }
          } else {
            // Not moving enough = collision stuck
            isStuck = true;
          }

          this.lastDistToColony = currentDistToColony;
        } else {
          // FORAGING ants: just check if barely moving (collision stuck)
          isStuck = realMovement < expectedMinMovement;
        }

        if (isStuck) {
          this.stuckCounter += deltaTime;
          // Debug: log when stuck counter increases (only for selected ant)
          if (this.id === Ant.selectedAntId && this.stuckCounter > 0.1) {
            console.log(`[Selected Ant] Stuck! distMoved: ${distMoved.toFixed(3)}, depenetration: ${this.depenetrationDistThisFrame.toFixed(3)}, realMovement: ${realMovement.toFixed(3)}, expected: ${expectedMinMovement.toFixed(3)}, counter: ${this.stuckCounter.toFixed(2)}s`);
          }
        } else {
          // Only decay if making GOOD progress (2x expected or more)
          // Slight movements don't reset stuck progress to prevent oscillation
          if (this.stuckCounter > 0) {
            const goodMovementThreshold = expectedMinMovement * 2.0;

            if (realMovement >= goodMovementThreshold) {
              // Making excellent progress - decay counter
              const oldCounter = this.stuckCounter;
              this.stuckCounter = Math.max(0, this.stuckCounter - deltaTime * 0.5);

              if (this.id === Ant.selectedAntId && oldCounter > 0.1 && this.stuckCounter < 0.1) {
                console.log(`[Selected Ant] Good progress, counter decayed: ${oldCounter.toFixed(2)}s -> ${this.stuckCounter.toFixed(2)}s (moved ${realMovement.toFixed(3)} vs threshold ${goodMovementThreshold.toFixed(3)})`);
              }
            }
            // Else: Minor movement, don't decay (counter stays the same)
          }
        }
      }

      // If stuck, smoothly reverse and turn (no teleport)
      if (this.stuckCounter > CONFIG.ANT_STUCK_THRESHOLD) {
        if (this.id === Ant.selectedAntId) {
          console.log(`[Selected Ant] Triggering unstuck recovery (counter: ${this.stuckCounter.toFixed(2)}s)`);
        }

        // Track unstuck event and check for geometric trap
        this.unstuckHistory.push(this.age);

        // Remove old events outside the window
        const windowStart = this.age - CONFIG.ANT_EMERGENCY_UNSTUCK_WINDOW;
        this.unstuckHistory = this.unstuckHistory.filter(time => time >= windowStart);

        // Check if we're stuck in a geometric trap (multiple unstucks in short time)
        if (this.unstuckHistory.length >= CONFIG.ANT_EMERGENCY_UNSTUCK_COUNT) {
          // GEOMETRIC TRAP DETECTED! Enter emergency mode
          this.emergencyModeTimer = CONFIG.ANT_EMERGENCY_MODE_DURATION;

          // If this is a scout, abandon current target - it's unreachable
          if (this.role === AntRole.SCOUT && this.explorationTarget) {
            if (this.id === Ant.selectedAntId) {
              console.log(`[EMERGENCY] Scout abandoning unreachable target due to geometric trap`);
            }
            this.explorationTarget = null;
          }

          // Instead of random direction, use FOV to find clearest escape route
          // Cast rays in all directions to find the safest path
          const escapeRays: { angle: number; clearance: number }[] = [];
          const numRays = 16; // Check 16 directions around the ant

          for (let i = 0; i < numRays; i++) {
            const angle = (i / numRays) * Math.PI * 2;
            const rayDist = CONFIG.FOV_DISTANCE * 2; // Look further ahead
            let minClearance = rayDist;

            // Check this direction for obstacles
            if (obstacleManager) {
              const nearbyObs = obstacleManager.getNearbyObstacles(
                this.position.x,
                this.position.y,
                rayDist + 100
              );

              for (const obs of nearbyObs) {
                const toObsX = obs.position.x - this.position.x;
                const toObsY = obs.position.y - this.position.y;
                const obsAngle = Math.atan2(toObsY, toObsX);

                // Check if obstacle is in this direction (within ±30 degrees)
                let angleDiff = Math.abs(obsAngle - angle);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

                if (angleDiff < Math.PI / 6) { // Within 30 degrees
                  const obsDist = Math.sqrt(toObsX * toObsX + toObsY * toObsY);
                  const clearance = obsDist - obs.radius;
                  minClearance = Math.min(minClearance, clearance);
                }
              }
            }

            escapeRays.push({ angle, clearance: minClearance });
          }

          // Pick direction with maximum clearance
          let bestRay = escapeRays[0];
          for (const ray of escapeRays) {
            if (ray.clearance > bestRay.clearance) {
              bestRay = ray;
            }
          }

          this.emergencyDirection = bestRay.angle;
          this.unstuckHistory = []; // Clear history to avoid re-triggering

          if (this.id === Ant.selectedAntId) {
            console.log(`[EMERGENCY] Geometric trap detected! ${CONFIG.ANT_EMERGENCY_UNSTUCK_COUNT} unstucks in ${CONFIG.ANT_EMERGENCY_UNSTUCK_WINDOW}s. Entering emergency walk for ${CONFIG.ANT_EMERGENCY_MODE_DURATION}s at angle ${(this.emergencyDirection * 180 / Math.PI).toFixed(1)}° (clearance: ${bestRay.clearance.toFixed(1)}px)`);
          }
        }

        // Steer backward with jitter
        const back = { x: -this.velocity.x, y: -this.velocity.y };
        const backMag = Math.hypot(back.x, back.y);

        if (backMag > 0.001) {
          // Add random jitter to avoid getting stuck in same direction
          const jitter = (Math.random() - 0.5) * 0.6;
          const ang = Math.atan2(back.y, back.x) + jitter;
          const dir = { x: Math.cos(ang), y: Math.sin(ang) };
          this.setDirection(dir, deltaTime);

          if (this.id === Ant.selectedAntId) {
            console.log(`[Selected Ant] Unstuck: reversing to angle ${(ang * 180 / Math.PI).toFixed(1)}°`);
          }

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

          if (this.id === Ant.selectedAntId) {
            console.log(`[Selected Ant] Unstuck: picking random direction ${(randomAngle * 180 / Math.PI).toFixed(1)}°`);
          }
        }

        this.stuckCounter = 0;
        this.unstuckRecoveryCooldown = 2.0; // 2 second cooldown to allow escape
        this.ignorePheromoneTimer = 5.0; // 5 seconds of ignoring pheromones to escape loops
        this.followingTrail = false;
        this.onFoodTrail = false; // Exit trail mode
        this.explorationCommitment = 0; // Reset exploration commitment so ant can pick a new direction

        if (this.id === Ant.selectedAntId) {
          console.log(`[Selected Ant] Unstuck complete, counter reset to 0, cooldown set to 2.0s, ignoring pheromones for 5.0s`);
        }
      }
    }

    // Position-based pheromone deposits (prevents deposits from rotation/circling)
    if (obstacleManager) {
      if (this.state === AntState.RETURNING && this.foodSourceId) {
        // Returning with food - deposit foodPher
        // Check if we've moved far enough from last deposit position
        let shouldDeposit = false;

        if (this.lastFoodPheromoneDepositPos === null) {
          shouldDeposit = true;
        } else {
          const dx = this.position.x - this.lastFoodPheromoneDepositPos.x;
          const dy = this.position.y - this.lastFoodPheromoneDepositPos.y;
          const spatialDist = Math.sqrt(dx * dx + dy * dy);

          if (spatialDist >= CONFIG.PHEROMONE_DEPOSIT_DISTANCE) {
            shouldDeposit = true;
          }
        }

        if (shouldDeposit) {
          // Deposit amount = strength_per_unit * deposit_distance
          const amount = CONFIG.PHEROMONE_FORAGER_STRENGTH_PER_UNIT * CONFIG.PHEROMONE_DEPOSIT_DISTANCE;

          this.pheromoneGrid.depositPheromone(
            this.position.x,
            this.position.y,
            'foodPher',
            amount,
            this.foodSourceId,
            obstacleManager,
            this.colony
          );

          // Update last deposit position
          this.lastFoodPheromoneDepositPos = { x: this.position.x, y: this.position.y };
        }
      } else {
        // Foraging - deposit homePher based on role
        // Check if we've moved far enough from last deposit position
        let shouldDeposit = false;

        if (this.lastHomePheromoneDepositPos === null) {
          shouldDeposit = true;
        } else {
          const dx = this.position.x - this.lastHomePheromoneDepositPos.x;
          const dy = this.position.y - this.lastHomePheromoneDepositPos.y;
          const spatialDist = Math.sqrt(dx * dx + dy * dy);

          if (spatialDist >= CONFIG.PHEROMONE_DEPOSIT_DISTANCE) {
            shouldDeposit = true;
          }
        }

        if (shouldDeposit) {
          // All ants deposit homePher while foraging to mark safe/explored areas
          let amount = 0;

          if (this.role === AntRole.SCOUT) {
            // Scouts deposit stronger trails with fade-in based on distance from colony
            const distFromColony = Math.sqrt(
              (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
            );

            // Fade in trail strength based on distance from colony (no hard gate)
            const fadeStart = CONFIG.LEVY_SCOUT_HOMEPHER_FADE_START;
            const fadeFactor = Math.min(1.0, Math.max(0, (distFromColony - fadeStart) / fadeStart));

            amount = CONFIG.PHEROMONE_SCOUT_STRENGTH_PER_UNIT * CONFIG.PHEROMONE_DEPOSIT_DISTANCE * fadeFactor;
          } else {
            // Foragers deposit weaker homePher to mark safe traversable areas
            amount = CONFIG.PHEROMONE_FORAGER_STRENGTH_PER_UNIT * CONFIG.PHEROMONE_DEPOSIT_DISTANCE * 0.3;
          }

          if (amount > 0.001) { // Only deposit if significant
            this.pheromoneGrid.depositPheromone(
              this.position.x,
              this.position.y,
              'homePher',
              amount,
              undefined,
              obstacleManager,
              this.colony
            );

            // Update last deposit position
            this.lastHomePheromoneDepositPos = { x: this.position.x, y: this.position.y };
          }
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

    // Update animated sprite if available
    if (this.animatedSprite) {
      // Adjust animation speed based on movement speed (much slower)
      const currentSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
      this.animatedSprite.animationSpeed = (currentSpeed / this.maxSpeed) * 1.5; // Slow base speed

      // Update z-index based on y position to prevent flickering when bunched
      this.sprite.zIndex = this.position.y;

      // Update tint and rotation continuously
      this.renderAnt();
    } else {
      // Only re-render graphics every 10 frames to save performance
      if (Math.floor(this.age) % CONFIG.ANT_RENDER_INTERVAL === 0 || this.age < 2) {
        this.renderAnt();
      }
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

    // Check for obstacle collision along ray - simplified sampling method
    if (obstacleManager) {
      // Sample 3 points along the ray (start, middle, end) for performance
      const samplePoints = [
        { x: this.position.x + dirX * (distance * 0.33), y: this.position.y + dirY * (distance * 0.33), dist: distance * 0.33 },
        { x: this.position.x + dirX * (distance * 0.67), y: this.position.y + dirY * (distance * 0.67), dist: distance * 0.67 },
        { x: endX, y: endY, dist: distance }
      ];

      for (const sample of samplePoints) {
        const collision = obstacleManager.checkCollision(sample, CONFIG.ANT_COLLISION_RADIUS);
        if (collision) {
          result.hitObstacle = true;
          result.obstacleDistance = sample.dist * CONFIG.FOV_OBSTACLE_DISTANCE_SAFETY;
          break;
        }
      }
    }

    // Sample pheromone levels at ray endpoint
    result.foodPher = this.pheromoneGrid.getPheromoneLevel(endX, endY, 'foodPher', this.colony);
    result.homePher = this.pheromoneGrid.getPheromoneLevel(endX, endY, 'homePher', this.colony);

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
  private senseEnvironment(
    foodSources?: any[],
    obstacleManager?: any,
    rayCount: number = CONFIG.FOV_RAY_COUNT,
    fovAngle: number = CONFIG.FOV_ANGLE,
    rayDistance: number = CONFIG.FOV_DISTANCE
  ): RayResult[] {
    const rays: RayResult[] = [];
    // Use visual heading (stable, target-directed) instead of actual velocity heading
    const currentHeading = this.visualHeading;

    // Cast rays in a cone around current heading
    for (let i = 0; i < rayCount; i++) {
      const angleOffset = ((i / (rayCount - 1)) - 0.5) * fovAngle; // Spread across FOV
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
   * Swept circle vs circle collision with sliding (for rock obstacles)
   */
  private sweepAndSlide(dt: number, obstacleManager: any): void {
    let remaining = 1.0;                       // normalized time in [0,1] for this frame
    let iter = 0;
    // Use spatial grid to only check nearby obstacles (massive performance boost)
    const searchRadius = CONFIG.ANT_COLLISION_RADIUS + 200; // Check obstacles within reasonable range
    const walls = obstacleManager.getNearbyObstacles(this.position.x, this.position.y, searchRadius);
    const r = CONFIG.ANT_COLLISION_RADIUS;

    // Optional: substep if the ant moves too far in one frame
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const travel = speed * dt;
    const substeps = Math.max(1, Math.ceil(travel / CONFIG.PHYS_SUBSTEP_MAX_DIST));
    const subDt = dt / substeps;

    for (let step = 0; step < substeps; step++) {
      remaining = 1.0;
      iter = 0;

      // Depenetrate from circular obstacles
      for (const w of walls) {
        const wCollisionX = w.position.x + w.collisionOffset.x;
        const wCollisionY = w.position.y + w.collisionOffset.y;
        const dx = this.position.x - wCollisionX;
        const dy = this.position.y - wCollisionY;
        const dist = Math.hypot(dx, dy);
        const minDist = r + w.radius;

        if (dist < minDist && dist > 0.001) {
          // Push out
          const overlap = minDist - dist;
          const pushDist = overlap + CONFIG.PHYS_SKIN;
          const nx = dx / dist;
          const ny = dy / dist;
          this.position.x += nx * pushDist;
          this.position.y += ny * pushDist;

          // Track depenetration distance (this is not "real" movement)
          this.depenetrationDistThisFrame += pushDist;
        }
      }

      while (remaining > CONFIG.PHYS_EPS && iter++ < CONFIG.PHYS_MAX_SWEEP_ITERS) {
        const dx = this.velocity.x * subDt * remaining;
        const dy = this.velocity.y * subDt * remaining;
        if (Math.abs(dx) < CONFIG.PHYS_MIN_SPEED && Math.abs(dy) < CONFIG.PHYS_MIN_SPEED) {
          break;
        }

        // Find earliest circle-circle collision
        let bestT = 1.0;
        let bestN = { x: 0, y: 0 };
        let bestWall: any = null;

        for (const w of walls) {
          // Swept circle vs circle collision - use collision position
          const wCollisionX = w.position.x + w.collisionOffset.x;
          const wCollisionY = w.position.y + w.collisionOffset.y;
          const hit = this.sweepCircleVsCircle(this.position.x, this.position.y, r, dx, dy, wCollisionX, wCollisionY, w.radius);

          if (hit.hit && hit.t < bestT) {
            bestT = hit.t;
            bestN = { x: hit.nx, y: hit.ny };
            bestWall = w;
          }
        }

        if (!bestWall) {
          // No hit → free move
          this.position.x += dx;
          this.position.y += dy;
          break;
        }

        // Move to impact
        const tMove = Math.max(0, bestT - CONFIG.PHYS_EPS);
        this.position.x += dx * tMove;
        this.position.y += dy * tMove;

        // Push out by skin
        this.position.x += bestN.x * CONFIG.PHYS_SKIN;
        this.position.y += bestN.y * CONFIG.PHYS_SKIN;

        // Track skin push as depenetration (not real movement)
        this.depenetrationDistThisFrame += CONFIG.PHYS_SKIN;

        // Remember collision normal
        this.lastCollisionN = { x: bestN.x, y: bestN.y };
        this.wallFollowUntil = CONFIG.TRAIL_LATCH_TIME;

        // Slide: remove normal component from velocity
        const vDotN = this.velocity.x * bestN.x + this.velocity.y * bestN.y;
        if (vDotN < 0) {
          this.velocity.x -= vDotN * bestN.x;
          this.velocity.y -= vDotN * bestN.y;
        }

        // Consume time
        const consumed = tMove;
        remaining *= (1 - consumed);
        if (remaining < CONFIG.PHYS_EPS) break;
      }
    }
  }

  /**
   * Swept circle vs circle collision
   * Returns earliest time of impact (t) and contact normal (nx, ny)
   */
  private sweepCircleVsCircle(
    x: number, y: number, r1: number,
    dx: number, dy: number,
    ox: number, oy: number, r2: number
  ): { hit: boolean; t: number; nx: number; ny: number } {
    // Treat as ray vs circle problem
    // Moving circle center: (x, y) moving by (dx, dy)
    // Static circle: (ox, oy) with combined radius R = r1 + r2

    const R = r1 + r2;
    const px = x - ox;  // Relative position
    const py = y - oy;

    // Quadratic: ||p + t*d||^2 = R^2
    // (px + t*dx)^2 + (py + t*dy)^2 = R^2
    // Expand: px^2 + 2*px*dx*t + dx^2*t^2 + py^2 + 2*py*dy*t + dy^2*t^2 = R^2
    // (dx^2 + dy^2)*t^2 + 2*(px*dx + py*dy)*t + (px^2 + py^2 - R^2) = 0

    const a = dx * dx + dy * dy;
    const b = 2 * (px * dx + py * dy);
    const c = px * px + py * py - R * R;

    if (a < 1e-9) {
      // Not moving, check if already overlapping
      return { hit: false, t: 1, nx: 0, ny: 0 };
    }

    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) {
      // No collision
      return { hit: false, t: 1, nx: 0, ny: 0 };
    }

    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);

    // We want the first positive hit in range [0, 1]
    let t = t1;
    if (t < 0 || t > 1) {
      t = t2;
      if (t < 0 || t > 1) {
        return { hit: false, t: 1, nx: 0, ny: 0 };
      }
    }

    // Compute contact point and normal
    const impactX = x + dx * t;
    const impactY = y + dy * t;
    const nx = (impactX - ox) / R;
    const ny = (impactY - oy) / R;

    return { hit: true, t, nx, ny };
  }

  private steerToward(dir: Vector2, dt: number) {
    const curAng = Math.atan2(this.velocity.y, this.velocity.x);
    const rawTargetAng = Math.atan2(dir.y, dir.x);

    // Temporal smoothing: blend previous target with new target
    let dAng = ((rawTargetAng - this.previousTargetHeading + Math.PI*3) % (Math.PI*2)) - Math.PI;
    const smoothedTargetAng = this.previousTargetHeading + dAng * CONFIG.ANT_HEADING_SMOOTHING;

    // CRITICAL FIX: Normalize smoothedTargetAng to prevent unbounded accumulation
    // This prevents the modulo wrapping from breaking over time
    this.previousTargetHeading = Math.atan2(Math.sin(smoothedTargetAng), Math.cos(smoothedTargetAng));

    // Update visual heading - smoothly rotate toward target direction (more aggressive than physics)
    // This makes the ant visually "look" where it wants to go, not micro-adjustments
    let visualDiff = ((this.previousTargetHeading - this.visualHeading + Math.PI*3) % (Math.PI*2)) - Math.PI;
    this.visualHeading += visualDiff * 0.3; // Fast visual rotation (30% per frame)
    this.visualHeading = Math.atan2(Math.sin(this.visualHeading), Math.cos(this.visualHeading)); // Normalize

    // Clamp turn rate
    dAng = ((this.previousTargetHeading - curAng + Math.PI*3) % (Math.PI*2)) - Math.PI;
    const maxTurn = CONFIG.ANT_MAX_TURN * dt;
    dAng = Math.max(-maxTurn, Math.min(maxTurn, dAng));
    const newAng = curAng + dAng;

    // Debug spinning ants (only for selected)
    if (this.id === Ant.selectedAntId && Math.abs(dAng) > Math.PI / 4) {
      console.log(`[Selected Ant] Large turn: dAng=${(dAng * 180 / Math.PI).toFixed(1)}°, curAng=${(curAng * 180 / Math.PI).toFixed(1)}°, targetAng=${(this.previousTargetHeading * 180 / Math.PI).toFixed(1)}°`);
    }

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
    // Decay wall-glide timer each tick
    if (this.wallFollowUntil > 0) this.wallFollowUntil -= deltaTime;

    // Update cooldown timer
    if (this.trailEndCooldown > 0) {
      this.trailEndCooldown -= deltaTime;
    }

    // PRIORITY 0: LOW ENERGY PANIC MODE - abandon foraging and beeline home
    if (this.energy < CONFIG.ANT_LOW_ENERGY_THRESHOLD) {
      const colonyDir = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y
      };
      const colonyDist = Math.sqrt(colonyDir.x ** 2 + colonyDir.y ** 2);

      if (colonyDist > 0) {
        colonyDir.x /= colonyDist;
        colonyDir.y /= colonyDist;
      }

      if (this.id === Ant.selectedAntId) {
        console.log(`[PANIC] Low energy (${this.energy.toFixed(1)}/${CONFIG.ANT_LOW_ENERGY_THRESHOLD}) - abandoning foraging, beelining to colony!`);
      }

      this.setDirection(colonyDir, deltaTime);
      this.onFoodTrail = false; // Exit any trail
      this.explorationCommitment = 0;
      return;
    }

    // PRIORITY 1: Direct food sensing (CONFIG.FORAGER_VISION_RANGE modified by vision trait)
    let nearestFood: { position: Vector2; distance: number } | null = null;
    let nearestDist = CONFIG.FORAGER_VISION_RANGE * this.traits.visionMultiplier;

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
      let dirX = nearestFood.position.x - this.position.x;
      let dirY = nearestFood.position.y - this.position.y;

      // Apply obstacle avoidance when stuck
      if (this.stuckCounter > 0.1 || this.ignorePheromoneTimer > 0) {
        const repulsion = this.getObstacleRepulsion(obstacleManager);
        dirX += repulsion.x * 2.0; // Strong avoidance during recovery
        dirY += repulsion.y * 2.0;
      }

      this.setDirection({ x: dirX, y: dirY }, deltaTime);
      this.explorationCommitment = 0; // Reset exploration when food is found
      return;
    }

    // PRIORITY 2: Follow pheromone trails with hysteresis (unless trail-locked)
    const currentPher = this.pheromoneGrid.getPheromoneLevel(this.position.x, this.position.y, 'foodPher', this.colony);

    // Hysteresis: different thresholds for entering vs exiting trail mode
    if (!this.onFoodTrail) {
      // Only enter trail if not locked AND pheromone is strong enough
      if (this.trailLockTimer <= 0 && currentPher >= CONFIG.TRAIL_ENTER_LEVEL) {
        this.onFoodTrail = true;
        this.trailLatchTimer = CONFIG.TRAIL_LATCH_TIME;
        this.explorationCommitment = 0; // Reset exploration when entering trail
        this.trailFollowStartTime = this.age; // Track when we started following
        this.trailFollowDistance = 0; // Reset distance tracker
      }
    } else {
      // Track distance traveled while on trail
      const distThisFrame = Math.sqrt(this.velocity.x ** 2 + this.velocity.y ** 2) * deltaTime;
      this.trailFollowDistance += distThisFrame;

      if (this.trailLatchTimer > 0) {
        this.trailLatchTimer -= deltaTime;
      }
      if (currentPher < CONFIG.TRAIL_EXIT_LEVEL && this.trailLatchTimer <= 0) {
        // Exiting trail - check if we should trigger trail lock
        const timeOnTrail = this.age - this.trailFollowStartTime;

        // If we followed a trail for a while but didn't find food, lock ourselves out
        if (timeOnTrail >= CONFIG.TRAIL_LOCK_MIN_FOLLOW_TIME &&
            this.trailFollowDistance >= CONFIG.TRAIL_LOCK_MIN_DISTANCE) {
          this.trailLockTimer = CONFIG.TRAIL_LOCK_DURATION;
          if (this.id === Ant.selectedAntId) {
            console.log(`[Trail Lock] Followed dead-end trail for ${timeOnTrail.toFixed(1)}s (${this.trailFollowDistance.toFixed(0)}px). Locked for ${CONFIG.TRAIL_LOCK_DURATION}s.`);
          }
        }

        this.onFoodTrail = false;
        this.trailEndCooldown = CONFIG.TRAIL_END_COOLDOWN; // Start cooldown
      }
    }

    // Only follow trails if on trail and not in cooldown or recovery
    // During recovery (ignorePheromoneTimer > 0), skip trail following and use FOV-based exploration instead
    if (this.trailEndCooldown <= 0 && this.onFoodTrail && this.ignorePheromoneTimer <= 0) {
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

        const pherLevel = this.pheromoneGrid.getPheromoneLevel(checkX, checkY, 'foodPher', this.colony);
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
        let dirX = bestDir.x;
        let dirY = bestDir.y;

        // Apply obstacle avoidance when stuck or in recovery (not during normal trail following)
        if (this.stuckCounter > 0.1) {
          const repulsion = this.getObstacleRepulsion(obstacleManager);
          dirX += repulsion.x * 2.0;
          dirY += repulsion.y * 2.0;
        }

        this.setDirection({ x: dirX, y: dirY }, deltaTime);
        return;
      }
    }

    // PRIORITY 3: Explore with commitment (smooth, purposeful movement)
    // Update commitment timer
    if (this.explorationCommitment > 0) {
      this.explorationCommitment -= deltaTime;
    }

    // If still committed, continue in current direction
    // BUT: check for obstacles ahead and abort commitment if blocked
    if (this.explorationCommitment > 0) {
      // Cast FOV rays to check for obstacles
      const rays = this.senseEnvironment(foodSources, obstacleManager);
      const centerRayIndex = Math.floor(rays.length / 2);
      const centerRay = rays[centerRayIndex];
      const hasObstacleAhead = centerRay.hitObstacle && centerRay.obstacleDistance < CONFIG.FOV_DISTANCE * 0.5;

      // If obstacle directly ahead, abort commitment and pick new direction
      if (hasObstacleAhead) {
        if (this.id === Ant.selectedAntId) {
          console.log(`[Selected Ant] Obstacle detected during exploration commitment at ${centerRay.obstacleDistance.toFixed(1)}px - aborting commitment`);
        }
        this.explorationCommitment = 0; // Abort commitment
        // Fall through to pick new direction
      } else {
        // No obstacle, continue committed direction
        const dir = { x: Math.cos(this.explorationDirection), y: Math.sin(this.explorationDirection) };
        this.setDirection(dir, deltaTime);
        return;
      }
    }

    // Time to pick a new exploration direction
    const toColonyDist = Math.sqrt(
      (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
    );
    const rays = this.senseEnvironment(foodSources, obstacleManager);
    const candidates: { angle: number; score: number }[] = [];

    // Forager comfort zone: prefer staying within ~1500px of colony
    const FORAGER_COMFORT_ZONE = 1500;
    const outsideComfortZone = toColonyDist > FORAGER_COMFORT_ZONE;

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

      // If outside comfort zone, bias toward directions that bring us closer to home
      if (outsideComfortZone) {
        // Bonus for directions that reduce distance to colony
        if (rayEndColonyDist < toColonyDist) {
          score += 0.8; // Strong bias toward home
        } else {
          score -= 0.4; // Penalty for going farther
        }
      } else {
        // Inside comfort zone, slight bonus for exploring outward (normal behavior)
        if (rayEndColonyDist > toColonyDist) {
          score += CONFIG.FORAGING_EXPLORATION_BONUS;
        }
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


  /** Phase 2.3: GUARDING_FOOD state - Scout patrols and defends food source */
  private updateGuardingFood(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // Find the food source we're guarding
    const guardedFood = foodSources?.find((f: any) => f.id === this.guardingFoodId);

    if (!guardedFood || guardedFood.amount <= 0) {
      // Food depleted or not found - unregister and return to exploring
      if (guardedFood) {
        guardedFood.unregisterGuard(this);
      }
      this.guardingFoodId = null;
      this.setScoutState(ScoutState.EXPLORING);
      return;
    }

    // Register as guard if not already registered
    guardedFood.registerGuard(this);

    // Check if 60 seconds passed without foragers
    const guardDuration = (Date.now() - this.guardStartTime) / 1000; // seconds
    const timeSinceForager = guardedFood.lastForagerVisit > 0
      ? (Date.now() - guardedFood.lastForagerVisit) / 1000
      : guardDuration; // If never visited, use guard duration

    if (this.id === Ant.selectedAntId && Math.random() < 0.02) {
      console.log(`[Guard] Duration: ${guardDuration.toFixed(1)}s, Time since forager: ${timeSinceForager.toFixed(1)}s, Last visit: ${guardedFood.lastForagerVisit}, Guards: ${guardedFood.getGuardCount()}`);
    }

    if (timeSinceForager >= CONFIG.SCOUT_GUARD_TIMEOUT) {
      // No foragers came - re-alert colony by taking 1 food and returning
      if (guardedFood.amount > 0) {
        // Pick up 1 food unit
        this.carryingAmount = 1;
        this.state = AntState.RETURNING;
        this.hasFood = true;
        this.foodSourceId = guardedFood.id;

        // Unregister from guarding
        guardedFood.unregisterGuard(this);
        this.guardingFoodId = null;

        // Transition back to TAGGING_FOOD to re-alert
        this.setScoutState(ScoutState.TAGGING_FOOD);
        return;
      }
    }

    // Patrol in a ring around food source (150-350px from food)
    const dx = guardedFood.position.x - this.position.x;
    const dy = guardedFood.position.y - this.position.y;
    const distToFood = Math.sqrt(dx * dx + dy * dy);

    // Check if we need a new patrol target (no target, reached target, or too far from food)
    const needNewTarget = !this.explorationTarget ||
                          distToFood > CONFIG.SCOUT_GUARD_RADIUS ||
                          Math.random() < 0.005; // 0.5% chance per frame to pick new target

    if (needNewTarget) {
      // Pick random patrol point in ring around food (between min and max patrol distance)
      const randomAngle = Math.random() * Math.PI * 2;
      const patrolDist = CONFIG.SCOUT_GUARD_PATROL_MIN +
                         Math.random() * (CONFIG.SCOUT_GUARD_PATROL_MAX - CONFIG.SCOUT_GUARD_PATROL_MIN);

      this.explorationTarget = {
        x: guardedFood.position.x + Math.cos(randomAngle) * patrolDist,
        y: guardedFood.position.y + Math.sin(randomAngle) * patrolDist
      };
    }

    // Navigate toward patrol target
    if (this.explorationTarget) {
      const pdx = this.explorationTarget.x - this.position.x;
      const pdy = this.explorationTarget.y - this.position.y;
      const pdist = Math.sqrt(pdx * pdx + pdy * pdy);

      // Check if reached target (within 50px)
      if (pdist < 50) {
        // Reached patrol point - pick new one next frame
        this.explorationTarget = null;
      } else {
        // Move toward patrol target
        const pdir = { x: pdx / pdist, y: pdy / pdist };
        this.setDirection(pdir, deltaTime);
      }
    }
  }

  /** Phase 2.2: TAGGING_FOOD state - Scout returns to colony laying trail after finding food */
  private updateTaggingFood(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // PRIORITY 1: Check for distress pheromone (emergency - drop everything)
    const distressLevel = this.pheromoneGrid.getPheromoneLevel(
      this.position.x,
      this.position.y,
      'distressPher'
    );

    if (distressLevel > CONFIG.DISTRESS_DETECTION_THRESHOLD) {
      // Drop mission and respond to distress
      this.guardingFoodId = null;
      this.setScoutState(ScoutState.RESPONDING_TO_DISTRESS);
      return;
    }

    // Navigate back to colony
    const dx = this.colony.x - this.position.x;
    const dy = this.colony.y - this.position.y;
    const distToColony = Math.sqrt(dx * dx + dy * dy);

    // Check if reached colony
    if (distToColony < CONFIG.COLONY_RETURN_RADIUS) {
      // Reached colony - transition to GUARDING_FOOD
      this.setScoutState(ScoutState.GUARDING_FOOD);
      this.guardStartTime = Date.now();
      return;
    }

    // Deposit strong food pheromone trail as we return (uses existing system)
    // The scout is creating a trail TO the food, so we deposit foodPher
    const distanceSinceLastDeposit = this.lastFoodPheromoneDepositPos
      ? Math.sqrt(
          (this.position.x - this.lastFoodPheromoneDepositPos.x) ** 2 +
          (this.position.y - this.lastFoodPheromoneDepositPos.y) ** 2
        )
      : Infinity;

    if (distanceSinceLastDeposit >= CONFIG.PHEROMONE_DEPOSIT_DISTANCE) {
      const trailStrength = CONFIG.PHEROMONE_SCOUT_STRENGTH_PER_UNIT * CONFIG.PHEROMONE_DEPOSIT_DISTANCE;
      this.pheromoneGrid.depositPheromone(
        this.position.x,
        this.position.y,
        'foodPher',
        trailStrength,
        this.guardingFoodId || undefined,
        obstacleManager,
        this.colony
      );
      this.lastFoodPheromoneDepositPos = { x: this.position.x, y: this.position.y };
    }

    // Head toward colony using existing returning behavior navigation
    const dir = { x: dx / distToColony, y: dy / distToColony };
    this.setDirection(dir, deltaTime);
  }

  /** Phase 2.1: EXPLORING state - Scout wanders with detection for food, guards, and distress */
  private updateExploring(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // PRIORITY 1: Check for distress pheromone (highest priority - interrupts everything)
    const distressLevel = this.pheromoneGrid.getPheromoneLevel(
      this.position.x,
      this.position.y,
      'distressPher'
    );

    if (distressLevel > CONFIG.DISTRESS_DETECTION_THRESHOLD) {
      // Transition to RESPONDING_TO_DISTRESS
      this.setScoutState(ScoutState.RESPONDING_TO_DISTRESS);
      return;
    }

    // PRIORITY 2: Use existing exploration behavior with food detection
    // This will navigate toward food and pick it up via checkFoodPickup()
    // When food is picked up, ant transitions to RETURNING state automatically
    // We'll intercept that in checkFoodPickup() to also store the food ID for guarding
    this.updateScoutBehavior(deltaTime, foodSources, obstacleManager);
  }

  /** SCOUT behavior - Simple directional exploration with smell */
  private updateScoutBehavior(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // PRIORITY 1: Check vision range for food (can see it directly)
    let nearestFood: { position: Vector2; distance: number; id: string } | null = null;
    let nearestDist = CONFIG.SCOUT_VISION_RANGE * this.traits.visionMultiplier;

    // PRIORITY 2: Check smell range for food (can detect through obstacles)
    let nearestSmell: { position: Vector2; distance: number; id: string } | null = null;
    let nearestSmellDist = CONFIG.SCOUT_SMELL_RANGE * this.traits.visionMultiplier;

    if (foodSources) {
      for (const food of foodSources) {
        if (food.amount <= 0) continue;
        const dx = food.position.x - this.position.x;
        const dy = food.position.y - this.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Check vision
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestFood = { position: food.position, distance: dist, id: food.id };
        }

        // Check smell (longer range)
        if (dist < nearestSmellDist) {
          nearestSmellDist = dist;
          nearestSmell = { position: food.position, distance: dist, id: food.id };
        }
      }
    }

    // If scout can SEE food, go straight to it
    if (nearestFood) {
      this.smelledFoodId = null; // Clear smell tracking
      const dir = {
        x: nearestFood.position.x - this.position.x,
        y: nearestFood.position.y - this.position.y
      };
      this.setDirection(dir, deltaTime);
      return;
    }

    // If scout can SMELL food, track it with progress checking
    if (nearestSmell) {
      // Check if we're making progress toward the smell
      if (this.smelledFoodId === nearestSmell.id) {
        // Still tracking same food - check if getting closer
        const distanceChange = this.lastSmellDistance - nearestSmell.distance;

        if (distanceChange > 0) {
          // Getting closer - reset timer
          this.smellProgressTimer = 0;
        } else {
          // Not getting closer - increment timer
          this.smellProgressTimer += deltaTime;
        }

        // Give up if stuck for 3 seconds (likely blocked by obstacle)
        if (this.smellProgressTimer > 3.0) {
          if (this.id === Ant.selectedAntId) {
            console.log(`[Selected Ant] Giving up on smell - no progress for 3s, resuming exploration`);
          }
          this.smelledFoodId = null;
          this.lastSmellDistance = Infinity;
          this.smellProgressTimer = 0;
          // Fall through to exploration behavior
        } else {
          // Still pursuing smell
          this.lastSmellDistance = nearestSmell.distance;
          const dir = {
            x: nearestSmell.position.x - this.position.x,
            y: nearestSmell.position.y - this.position.y
          };
          this.setDirection(dir, deltaTime);
          return;
        }
      } else {
        // New smell detected - start tracking
        this.smelledFoodId = nearestSmell.id;
        this.lastSmellDistance = nearestSmell.distance;
        this.smellProgressTimer = 0;

        if (this.id === Ant.selectedAntId) {
          console.log(`[Selected Ant] Detected food smell at distance ${nearestSmell.distance.toFixed(0)}`);
        }

        const dir = {
          x: nearestSmell.position.x - this.position.x,
          y: nearestSmell.position.y - this.position.y
        };
        this.setDirection(dir, deltaTime);
        return;
      }
    } else {
      // No smell detected - clear tracking
      if (this.smelledFoodId !== null) {
        if (this.id === Ant.selectedAntId) {
          console.log(`[Selected Ant] Lost food smell, resuming exploration`);
        }
        this.smelledFoodId = null;
        this.lastSmellDistance = Infinity;
        this.smellProgressTimer = 0;
      }
    }

    // SCOUT EXPLORATION STRATEGY:
    // Pick random distant targets and commit to them - emergent spreading without phases

    // If scout is stuck for 5+ seconds, abandon current target and pick a new one
    if (this.stuckCounter >= CONFIG.SCOUT_STUCK_TARGET_RESET_TIME && this.explorationTarget) {
      if (this.id === Ant.selectedAntId) {
        console.log(`[Selected Ant] Scout stuck for ${this.stuckCounter.toFixed(1)}s - picking new exploration target`);
      }
      this.explorationTarget = null; // Clear stuck target
      this.stuckCounter = 0; // Reset stuck counter when picking new target
    }

    // Check if we need a new target (no target, or reached current target)
    if (!this.explorationTarget) {
      // Pick a random direction and distance, ensuring target is beyond forager zone
      let attempts = 0;
      let validTarget = false;

      while (!validTarget && attempts < 10) {
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.SCOUT_EXPLORATION_COMMIT_DISTANCE;
        const potentialTarget = {
          x: this.position.x + Math.cos(angle) * distance,
          y: this.position.y + Math.sin(angle) * distance
        };

        // Check if target is beyond forager comfort zone from colony
        const targetDistFromColony = Math.sqrt(
          (potentialTarget.x - this.colony.x) ** 2 +
          (potentialTarget.y - this.colony.y) ** 2
        );

        // Check if target is inside an obstacle
        let insideObstacle = false;
        if (obstacleManager) {
          const collision = obstacleManager.checkCollision(potentialTarget, 10);
          if (collision) {
            insideObstacle = true;
          }
        }

        // Check if target is within world bounds (with margin)
        const margin = CONFIG.ANT_WORLD_BOUNDARY_MARGIN;
        const withinBounds =
          potentialTarget.x >= margin &&
          potentialTarget.x <= this.worldWidth - margin &&
          potentialTarget.y >= margin &&
          potentialTarget.y <= this.worldHeight - margin;

        if (targetDistFromColony > CONFIG.FORAGER_COMFORT_ZONE && !insideObstacle && withinBounds) {
          this.explorationTarget = potentialTarget;
          validTarget = true;

          if (this.id === Ant.selectedAntId) {
            console.log(`[Selected Ant] Scout picked new exploration target at (${this.explorationTarget.x.toFixed(0)}, ${this.explorationTarget.y.toFixed(0)}), ${targetDistFromColony.toFixed(0)}px from colony`);
          }
        }
        attempts++;
      }

      // Fallback: if we couldn't find valid target after 10 attempts, just use the last attempt
      if (!validTarget) {
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.SCOUT_EXPLORATION_COMMIT_DISTANCE;
        this.explorationTarget = {
          x: this.position.x + Math.cos(angle) * distance,
          y: this.position.y + Math.sin(angle) * distance
        };
      }
    }

    // Check if we've reached the target (within 100px)
    const targetDx = this.explorationTarget.x - this.position.x;
    const targetDy = this.explorationTarget.y - this.position.y;
    const targetDist = Math.sqrt(targetDx * targetDx + targetDy * targetDy);

    if (targetDist < 100) {
      // Reached target - pick new one beyond forager zone
      let attempts = 0;
      let validTarget = false;

      while (!validTarget && attempts < 10) {
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.SCOUT_EXPLORATION_COMMIT_DISTANCE;
        const potentialTarget = {
          x: this.position.x + Math.cos(angle) * distance,
          y: this.position.y + Math.sin(angle) * distance
        };

        // Check if target is beyond forager comfort zone from colony
        const targetDistFromColony = Math.sqrt(
          (potentialTarget.x - this.colony.x) ** 2 +
          (potentialTarget.y - this.colony.y) ** 2
        );

        // Check if target is inside an obstacle
        let insideObstacle = false;
        if (obstacleManager) {
          const collision = obstacleManager.checkCollision(potentialTarget, 10);
          if (collision) {
            insideObstacle = true;
          }
        }

        // Check if target is within world bounds (with margin)
        const margin = CONFIG.ANT_WORLD_BOUNDARY_MARGIN;
        const withinBounds =
          potentialTarget.x >= margin &&
          potentialTarget.x <= this.worldWidth - margin &&
          potentialTarget.y >= margin &&
          potentialTarget.y <= this.worldHeight - margin;

        if (targetDistFromColony > CONFIG.FORAGER_COMFORT_ZONE && !insideObstacle && withinBounds) {
          this.explorationTarget = potentialTarget;
          validTarget = true;

          if (this.id === Ant.selectedAntId) {
            console.log(`[Selected Ant] Scout reached target, picking new one at (${this.explorationTarget.x.toFixed(0)}, ${this.explorationTarget.y.toFixed(0)}), ${targetDistFromColony.toFixed(0)}px from colony`);
          }
        }
        attempts++;
      }

      // Fallback: if we couldn't find valid target after 10 attempts, just use the last attempt
      if (!validTarget) {
        const angle = Math.random() * Math.PI * 2;
        const distance = CONFIG.SCOUT_EXPLORATION_COMMIT_DISTANCE;
        this.explorationTarget = {
          x: this.position.x + Math.cos(angle) * distance,
          y: this.position.y + Math.sin(angle) * distance
        };
      }
    }

    // Head toward target
    const targetDir = {
      x: targetDx / targetDist,
      y: targetDy / targetDist
    };

    if (this.id === Ant.selectedAntId && Math.random() < 0.01) {
      console.log(`[Selected Ant] Scout heading to exploration target, dist=${targetDist.toFixed(0)}`);
    }

    // INTELLIGENT NAVIGATION - like returning ants but toward exploration goal
    // Cast wide FOV rays to detect obstacles (270° with 9 rays)
    const rays = this.senseEnvironment(foodSources, obstacleManager, CONFIG.SCOUT_FOV_RAY_COUNT, CONFIG.SCOUT_FOV_ANGLE, CONFIG.SCOUT_FOV_DISTANCE);

    // Store rays for debug visualization
    if (this.role === AntRole.SCOUT) {
      this.lastFOVRays = rays;
    }

    // Check if obstacle directly ahead (center ray)
    const centerRayIndex = Math.floor(rays.length / 2);
    const centerRay = rays[centerRayIndex];
    const hasObstacleAhead = centerRay.hitObstacle && centerRay.obstacleDistance < CONFIG.SCOUT_FOV_DISTANCE * 0.5;

    if (this.id === Ant.selectedAntId && hasObstacleAhead) {
      console.log(`[Selected Ant] Scout detected obstacle ahead at ${centerRay.obstacleDistance.toFixed(1)}px`);
    }

    // Get homePher gradient - scouts can follow their own trails to find proven safe paths
    const gradient = this.pheromoneGrid.getPheromoneGradient(
      this.position.x,
      this.position.y,
      'homePher',
      undefined,
      this.colony
    );
    const gradMag = Math.hypot(gradient.x, gradient.y);

    // Apply soft threshold to gradient magnitude
    const mEff = Math.max(0, Math.min(1,
      (gradMag - CONFIG.GRADIENT_MIN_THRESHOLD) / CONFIG.GRADIENT_SPAN
    ));

    // Blend goal direction with gradient and obstacle avoidance
    let dirX = targetDir.x;
    let dirY = targetDir.y;

    // If obstacle ahead, increase gradient weight and reduce goal weight
    if (hasObstacleAhead) {
      // Blend with gradient if available (scouts leave strong homePher trails)
      if (gradMag > 0) {
        const gradDirX = gradient.x / gradMag;
        const gradDirY = gradient.y / gradMag;
        // Strong gradient influence when obstacle ahead
        dirX = targetDir.x * 0.3 + gradDirX * 0.7 * mEff;
        dirY = targetDir.y * 0.3 + gradDirY * 0.7 * mEff;
      }

      // If gradient is weak, pick clearest ray direction
      if (gradMag < 0.3) {
        let bestRay = rays[0];
        for (const ray of rays) {
          if (ray.obstacleDistance > bestRay.obstacleDistance) {
            bestRay = ray;
          }
        }

        // Blend goal direction with clearest ray
        const clearDir = {
          x: Math.cos(bestRay.angle),
          y: Math.sin(bestRay.angle)
        };
        dirX = targetDir.x * 0.4 + clearDir.x * 0.6;
        dirY = targetDir.y * 0.4 + clearDir.y * 0.6;

        if (this.id === Ant.selectedAntId) {
          console.log(`[Selected Ant] Scout using clearest ray at ${(bestRay.angle * 180 / Math.PI).toFixed(1)}° (${bestRay.obstacleDistance.toFixed(1)}px clear)`);
        }
      }
    } else {
      // No obstacle ahead - slight gradient influence for smoother paths
      if (gradMag > 0.5) {
        const gradDirX = gradient.x / gradMag;
        const gradDirY = gradient.y / gradMag;
        dirX = targetDir.x * 0.8 + gradDirX * 0.2 * mEff;
        dirY = targetDir.y * 0.8 + gradDirY * 0.2 * mEff;
      }
    }

    // Normalize and apply
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    if (mag > 0) {
      this.setDirection({ x: dirX / mag, y: dirY / mag }, deltaTime);
    } else {
      this.setDirection(targetDir, deltaTime);
    }
  }

  /** RETURNING behavior (Task 9) - with magnitude-aware gradient steering */
  private updateReturningBehavior(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // Pheromone deposits now handled by distance-based system in update() method

    const toColony = {
      x: this.colony.x - this.position.x,
      y: this.colony.y - this.position.y,
    };
    const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
    const colonyDir = colonyDist > 0 ? { x: toColony.x / colonyDist, y: toColony.y / colonyDist } : { x: 1, y: 0 };

    let dirX: number;
    let dirY: number;

    // Cast FOV rays to detect obstacles ahead
    const rays = this.senseEnvironment(foodSources, obstacleManager);

    // Check if obstacle directly ahead
    const centerRayIndex = Math.floor(rays.length / 2);
    const centerRay = rays[centerRayIndex];
    const hasObstacleAhead = centerRay.hitObstacle && centerRay.obstacleDistance < CONFIG.FOV_DISTANCE * 0.5;

    if (this.id === Ant.selectedAntId && hasObstacleAhead) {
      console.log(`[Selected Ant] Obstacle detected ahead at ${centerRay.obstacleDistance.toFixed(1)}px`);
    }

    // Get homePher gradient (preserves magnitude) - always use it to navigate around obstacles
    const gradient = this.pheromoneGrid.getPheromoneGradient(
      this.position.x,
      this.position.y,
      'homePher',
      undefined,
      this.colony
    );

    // Compute gradient magnitude for weighting
    const gradMag = Math.hypot(gradient.x, gradient.y);

    // Apply soft threshold to gradient magnitude
    const mEff = Math.max(0, Math.min(1,
      (gradMag - CONFIG.GRADIENT_MIN_THRESHOLD) / CONFIG.GRADIENT_SPAN
    ));

    // If in recovery mode OR obstacle ahead, increase gradient weight to follow safe paths
    const inRecovery = this.stuckCounter > 0.1 || this.ignorePheromoneTimer > 0;
    const needsAvoidance = hasObstacleAhead || inRecovery;

    // Magnitude-aware blending: stronger gradients pull harder
    // When gradient is strong (mEff → 1), follow it more
    // When gradient is weak (mEff → 0), rely on colony vector
    // During recovery or when obstacle ahead, trust the gradient even more to navigate around obstacles
    const gradientWeight = needsAvoidance
      ? CONFIG.RETURNING_GRADIENT_WEIGHT * mEff * 3.0  // Triple gradient weight when avoiding
      : CONFIG.RETURNING_GRADIENT_WEIGHT * mEff;
    const colonyWeight = needsAvoidance
      ? CONFIG.RETURNING_COLONY_WEIGHT * 0.3  // Significantly reduce direct colony pull when avoiding
      : CONFIG.RETURNING_COLONY_WEIGHT + CONFIG.RETURNING_GRADIENT_WEIGHT * (1 - mEff);

    if (this.id === Ant.selectedAntId && needsAvoidance) {
      console.log(`[Selected Ant] Avoidance mode (obstacle: ${hasObstacleAhead}, stuck: ${this.stuckCounter.toFixed(2)}s, ignore timer: ${this.ignorePheromoneTimer.toFixed(2)}s), following gradient (weight: ${gradientWeight.toFixed(2)}, gradMag: ${gradMag.toFixed(3)})`);
    }

    dirX = colonyDir.x * colonyWeight;
    dirY = colonyDir.y * colonyWeight;

    if (gradMag > 0) {
      const gradDirX = gradient.x / gradMag;
      const gradDirY = gradient.y / gradMag;
      dirX += gradDirX * gradientWeight;
      dirY += gradDirY * gradientWeight;
    }

    // If obstacle directly ahead and gradient is weak, pick the clearest ray direction
    if (hasObstacleAhead && gradMag < 0.3) {
      let bestRay = rays[0];
      for (const ray of rays) {
        if (ray.obstacleDistance > bestRay.obstacleDistance) {
          bestRay = ray;
        }
      }

      // Blend in the clearest direction
      const clearDir = {
        x: Math.cos(bestRay.angle),
        y: Math.sin(bestRay.angle)
      };
      dirX = dirX * 0.5 + clearDir.x * 0.5;
      dirY = dirY * 0.5 + clearDir.y * 0.5;

      if (this.id === Ant.selectedAntId) {
        console.log(`[Selected Ant] Weak gradient (${gradMag.toFixed(3)}), using clearest ray at ${(bestRay.angle * 180 / Math.PI).toFixed(1)}° (${bestRay.obstacleDistance.toFixed(1)}px clear)`);
      }
    }

    // Normalize
    const mag = Math.sqrt(dirX * dirX + dirY * dirY);
    if (mag > 0) {
      dirX /= mag;
      dirY /= mag;
    }

    // Apply obstacle repulsion (Task 12)
    // Use much stronger repulsion during recovery to help escape
    const repulsion = this.getObstacleRepulsion(obstacleManager);
    const repulsionWeight = (this.stuckCounter > 0.1 || this.ignorePheromoneTimer > 0)
      ? 2.0  // Strong avoidance during recovery
      : CONFIG.RETURNING_OBSTACLE_REPULSION_WEIGHT; // Normal avoidance (0.2)

    dirX += repulsion.x * repulsionWeight;
    dirY += repulsion.y * repulsionWeight;

    // Use smooth steering instead of direct velocity assignment
    const dir = { x: dirX, y: dirY };
    this.setDirection(dir, deltaTime);
  }

  // ============================================================
  // END PHASE 2 REDESIGN
  // ============================================================

  private processOutputs(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // EMERGENCY MODE overrides ALL behavior - walk in clear direction to escape trap
    if (this.emergencyModeTimer > 0) {
      const dirX = Math.cos(this.emergencyDirection);
      const dirY = Math.sin(this.emergencyDirection);

      if (this.id === Ant.selectedAntId && Math.random() < 0.05) {
        console.log(`[EMERGENCY] Walking at ${(this.emergencyDirection * 180 / Math.PI).toFixed(1)}° (${this.emergencyModeTimer.toFixed(1)}s remaining)`);
      }

      this.setDirection({ x: dirX, y: dirY }, deltaTime);
      return;
    }

    // Dispatch based on role and state
    if (this.state === AntState.RETURNING) {
      this.updateReturningBehavior(deltaTime, foodSources, obstacleManager);
    } else {
      // FORAGING state - behavior depends on role
      if (this.role === AntRole.SCOUT) {
        // Scouts use state machine (Phase 2)
        switch (this.scoutState) {
          case ScoutState.EXPLORING:
            this.updateExploring(deltaTime, foodSources, obstacleManager);
            break;
          case ScoutState.TAGGING_FOOD:
            this.updateTaggingFood(deltaTime, foodSources, obstacleManager);
            break;
          case ScoutState.GUARDING_FOOD:
            this.updateGuardingFood(deltaTime, foodSources, obstacleManager);
            break;
          case ScoutState.ASSISTING_GUARD:
            // TODO: Phase 4.2
            this.updateScoutBehavior(deltaTime, foodSources, obstacleManager);
            break;
          case ScoutState.RESPONDING_TO_DISTRESS:
            // TODO: Phase 3.2
            this.updateScoutBehavior(deltaTime, foodSources, obstacleManager);
            break;
          default:
            this.updateScoutBehavior(deltaTime, foodSources, obstacleManager);
        }
      } else {
        this.updateForagingBehavior(deltaTime, foodSources, obstacleManager);
      }
    }
  }

  public checkFoodPickup(foodPosition: Vector2, pickupRadius: number = 20, foodSourceId?: string, amountAvailable: number = 1, foodSource?: any): number {
    if (this.state === AntState.RETURNING) return 0; // Already carrying food

    const dx = this.position.x - foodPosition.x;
    const dy = this.position.y - foodPosition.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < pickupRadius && amountAvailable > 0) {
      // Take a chunk: min(available, carry capacity)
      const amountToTake = Math.min(amountAvailable, this.carryCapacity);

      // Only transition to RETURNING if we actually got food
      if (amountToTake <= 0) return 0;

      this.carryingAmount = amountToTake;

      // State transition: Foraging -> Returning
      this.state = AntState.RETURNING;
      this.hasFood = true; // Keep for backward compatibility
      this.foodSourceId = foodSourceId || null; // Remember which food source this came from

      // Reset pheromone deposit position for new trail
      this.lastFoodPheromoneDepositPos = null;

      // Update memory: remember this food location and reset timer
      this.lastFoodPosition = { x: foodPosition.x, y: foodPosition.y };
      this.timeSinceLastFood = 0;

      // Trail lock: Successfully found food! Reset trail tracking and clear any lock
      this.onFoodTrail = false; // Exit trail mode (we found the food!)
      this.trailLockTimer = 0; // Clear any existing lock - this was a good trail
      this.trailFollowDistance = 0;

      // Scout found food: try to register as tagger (atomic check-and-register)
      if (this.role === AntRole.SCOUT) {
        this.explorationTarget = null;
        this.guardingFoodId = foodSourceId || null;

        // Try to register as tagger - returns false if already at max
        const registeredAsTagger = foodSource ? foodSource.registerTagger(this) : true;

        if (registeredAsTagger) {
          // Successfully registered - proceed with tagging (pick up food and return)
          if (this.id === Ant.selectedAntId) {
            console.log(`[Scout] Registered as tagger for food ${foodSourceId} - will alert colony`);
          }
          this.setScoutState(ScoutState.TAGGING_FOOD);
          // Continue with normal food pickup (state is RETURNING, carrying food)
        } else {
          // Already at max taggers - skip tagging and go straight to guarding
          if (this.id === Ant.selectedAntId) {
            console.log(`[Scout] Food ${foodSourceId} already has max taggers - going straight to guard`);
          }

          // DON'T pick up food - go straight to guarding
          this.state = AntState.FORAGING; // Stay in foraging state (not returning)
          this.hasFood = false;
          this.carryingAmount = 0; // Don't carry food
          this.foodSourceId = foodSourceId; // Remember which food we're guarding

          this.setScoutState(ScoutState.GUARDING_FOOD);
          this.guardStartTime = Date.now();

          return 0; // Return 0 food taken (we didn't actually pick it up)
        }
      }

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

      // Scout special handling: transition to GUARDING_FOOD if in TAGGING_FOOD state
      if (this.role === AntRole.SCOUT && this.scoutState === ScoutState.TAGGING_FOOD) {
        // Keep guardingFoodId (don't clear it) and transition to guarding
        this.setScoutState(ScoutState.GUARDING_FOOD);
        this.guardStartTime = Date.now();
        // Don't clear foodSourceId yet - we'll use it for guarding
      } else {
        this.foodSourceId = null; // Clear food source ID
      }

      this.energy = Math.min(CONFIG.ANT_STARTING_ENERGY, this.energy + CONFIG.ANT_ENERGY_FROM_COLONY); // Restore some energy
      this.explorationCommitment = 0; // Reset exploration when returning to colony
      this.lastHomePheromoneDepositPos = null; // Reset for new foraging trail

      // Push ant away from colony to prevent clustering at center
      // EXCEPT: scouts in GUARDING_FOOD state should head back to their food
      if (this.role === AntRole.SCOUT && this.scoutState === ScoutState.GUARDING_FOOD) {
        // Scout is going back to guard - don't push away, let normal behavior take over
        this.justReturnedTimer = 0; // No cooldown - start guarding immediately
        this.stuckCounter = 0; // Reset stuck counter
      } else {
        // Normal push-away behavior for foragers and other scouts
        let finalAngle: number;

        if (dist > 5) {
          // Far enough from center - use direction away from colony with random variation
          const baseAngle = Math.atan2(dy, dx);
          const randomSpread = (Math.random() - 0.5) * Math.PI * 0.5; // ±45° variation
          finalAngle = baseAngle + randomSpread;
        } else {
          // Too close to center or at exact center - use completely random direction
          finalAngle = Math.random() * Math.PI * 2;
        }

        const dirX = Math.cos(finalAngle);
        const dirY = Math.sin(finalAngle);

        // Give ant outward velocity to move away
        this.velocity.x = dirX * this.maxSpeed;
        this.velocity.y = dirY * this.maxSpeed;

        // Set cooldown so ant keeps moving away before other behaviors interfere
        this.justReturnedTimer = CONFIG.ANT_JUST_RETURNED_COOLDOWN;
        this.stuckCounter = 0; // Reset stuck counter
      }

      return deliveredAmount; // Return amount delivered
    }
    return 0; // No food delivered
  }

  private handleCombat(deltaTime: number, enemyAnts: Ant[]): void {
    // Debug: log enemy count for first call
    if (this.id === Ant.selectedAntId && this.age < 5) {
      console.log(`[Combat Init] ${enemyAnts.length} enemy ants in list`);
    }

    // Find nearest enemy ant within detection range
    let nearestEnemy: Ant | null = null;
    let nearestDistance = CONFIG.COMBAT_DETECTION_RANGE;

    for (const enemy of enemyAnts) {
      if (enemy.isDead) continue;

      // Check if this ant belongs to a different colony
      const dx = this.colony.x - enemy.colony.x;
      const dy = this.colony.y - enemy.colony.y;
      const colonyDist = Math.sqrt(dx * dx + dy * dy);

      if (colonyDist < 10) continue; // Same colony, skip

      // Debug: log first enemy check for selected ant
      if (this.id === Ant.selectedAntId && nearestEnemy === null) {
        console.log(`[Combat] Checking enemy - colonyDist: ${colonyDist.toFixed(0)}px`);
      }

      // Calculate distance to enemy
      const ex = this.position.x - enemy.position.x;
      const ey = this.position.y - enemy.position.y;
      const dist = Math.sqrt(ex * ex + ey * ey);

      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestEnemy = enemy;
      }
    }

    // No enemies detected - clear combat state
    if (!nearestEnemy) {
      this.isInCombat = false;
      this.combatTarget = null;
      this.fleeing = false;
      return;
    }

    // Enemy detected - decide behavior based on role and state
    const isScout = this.role === AntRole.SCOUT;
    const isForager = this.role === AntRole.FORAGER;
    const isCarryingFood = this.carryingAmount > 0;
    const lowEnergy = this.energy < CONFIG.COMBAT_FLEE_THRESHOLD;

    // Debug: log enemy detection for selected ant
    if (this.id === Ant.selectedAntId) {
      console.log(`[Combat] Enemy detected at ${nearestDistance.toFixed(0)}px - Role: ${this.role}, Carrying: ${isCarryingFood}, Energy: ${this.energy.toFixed(0)}`);
    }

    // FORAGER behavior: Always flee unless cornered with food
    if (isForager) {
      // Always flee
      this.fleeing = true;
      this.fleeDirection = Math.atan2(
        this.position.y - nearestEnemy.position.y,
        this.position.x - nearestEnemy.position.x
      );

      // Override movement to flee
      this.setDirection({ x: Math.cos(this.fleeDirection), y: Math.sin(this.fleeDirection) }, deltaTime);

      // If in combat range and carrying food, fight desperately
      if (nearestDistance < CONFIG.COMBAT_RANGE && isCarryingFood) {
        this.engageInCombat(deltaTime, nearestEnemy);
      }
      return;
    }

    // SCOUT behavior: Engage in combat
    if (isScout) {
      // Flee if low energy
      if (lowEnergy) {
        this.fleeing = true;
        this.fleeDirection = Math.atan2(
          this.position.y - nearestEnemy.position.y,
          this.position.x - nearestEnemy.position.x
        );

        // Override movement to flee
        this.setDirection({ x: Math.cos(this.fleeDirection), y: Math.sin(this.fleeDirection) }, deltaTime);
        return;
      }

      // Pursue and engage if within combat range
      if (nearestDistance < CONFIG.COMBAT_RANGE) {
        this.engageInCombat(deltaTime, nearestEnemy);
      } else {
        // Chase enemy (set isInCombat to prevent normal movement from overriding)
        this.isInCombat = true; // Treat chasing as combat state
        this.combatTarget = nearestEnemy;
        const chaseDirection = Math.atan2(
          nearestEnemy.position.y - this.position.y,
          nearestEnemy.position.x - this.position.x
        );
        this.setDirection({ x: Math.cos(chaseDirection), y: Math.sin(chaseDirection) }, deltaTime);
      }
    }
  }

  private engageInCombat(deltaTime: number, enemy: Ant): void {
    this.isInCombat = true;
    this.combatTarget = enemy;
    this.fleeing = false;

    // Calculate damage dealt to enemy: damageDealt = BASE_COMBAT_DAMAGE * (yourSpeed / opponentEfficiency)
    const myDamageMultiplier = this.maxSpeed / enemy.traits.efficiencyMultiplier;
    const damageToEnemy = CONFIG.BASE_COMBAT_DAMAGE * myDamageMultiplier * deltaTime;

    // Calculate damage received from enemy
    const enemyDamageMultiplier = enemy.maxSpeed / this.traits.efficiencyMultiplier;
    const damageFromEnemy = CONFIG.BASE_COMBAT_DAMAGE * enemyDamageMultiplier * deltaTime;

    // Apply damage (both ants take damage simultaneously)
    enemy.energy -= damageToEnemy;
    this.energy -= damageFromEnemy;

    // Check if enemy died
    if (enemy.energy <= 0) {
      enemy.isDead = true;

      // Record kill for colony stats
      if (this.onKillCallback) {
        this.onKillCallback();
      }

      // Winner spoils: steal carried food and gain energy reward
      if (enemy.carryingAmount > 0) {
        this.carryingAmount = Math.min(this.carryCapacity, this.carryingAmount + enemy.carryingAmount);
        this.state = AntState.RETURNING; // Switch to returning if we got food
        enemy.carryingAmount = 0;
      }

      this.energy = Math.min(this.energyCapacity, this.energy + CONFIG.COMBAT_ENERGY_REWARD);
      this.isInCombat = false;
      this.combatTarget = null;
    }

    // Check if we died
    if (this.energy <= 0) {
      this.isDead = true;

      // Drop food if carrying
      if (this.carryingAmount > 0 && !enemy.isDead) {
        enemy.carryingAmount = Math.min(enemy.carryCapacity, enemy.carryingAmount + this.carryingAmount);
        enemy.state = AntState.RETURNING;
        this.carryingAmount = 0;
      }
    }
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

  public getExplorationTarget(): Vector2 | null {
    return this.explorationTarget;
  }

  // Scout state management (Phase 1.3)
  public setScoutState(newState: ScoutState): void {
    if (this.role !== AntRole.SCOUT) {
      console.warn(`Attempted to set scout state on non-scout ant (id: ${this.id})`);
      return;
    }

    if (this.scoutState !== newState) {
      console.log(`Scout ${this.id}: ${this.scoutState} → ${newState}`);
      this.scoutState = newState;
    }
  }

  public destroy(): void {
    this.sprite.destroy();
  }
}
