// Simulation Configuration Constants

// World Settings
export const WORLD_WIDTH = 20000;
export const WORLD_HEIGHT = 20000;

// Colony Settings
export const INITIAL_ANT_COUNT = 300; // Test FPS with fewer ants
export const MAX_ANT_COUNT = 5000;
export const COLONY_STARTING_FOOD = 0; // Start with no food - ants must forage to grow population
export const COLONY_RETURN_RADIUS = 380; // Distance within which ant can deliver food
export const COLONY_OUTER_RADIUS = 480; // Visual size of colony sprite
export const GENERATION_SURVIVAL_RATIO = 0.5; // Fraction of ants that survive generation culling

// Evolution Settings
export const MUTATION_RATE = 0.005; // ±0.005 per generation (0.5% change per offspring)
export const TRAIT_MIN = 0.7; // Minimum trait multiplier
export const TRAIT_MAX = 1.3; // Maximum trait multiplier

// Spawning Settings
export const FOOD_COST_TO_SPAWN = 10;

// Food Settings
export const INITIAL_FOOD_SOURCES = 10;
export const MIN_FOOD_PER_SOURCE = 50;
export const MAX_FOOD_PER_SOURCE = 100;
export const FOOD_RESPAWN_INTERVAL = 600; // frames - slower respawn
export const MAX_FOOD_SOURCES = 30; // More food sources to support population
export const FOOD_MIN_DIST_FROM_COLONY = 150; // Minimum spawn distance from colony
export const FOOD_PHER_AVOIDANCE_THRESHOLD = 15.0; // Only avoid VERY high foodPher areas
export const FOOD_SPAWN_MARGIN = 50; // Keep food away from world edges
export const FOOD_SPAWN_OBSTACLE_CHECK_RADIUS = 80; // Radius for obstacle collision check (larger than max food radius to prevent overlap)
export const FOOD_MIN_RADIUS = 15; // Minimum visual radius for food piles (3x larger)
export const FOOD_MAX_RADIUS = 75; // Maximum visual radius for food piles (3x larger)
export const FOOD_PICKUP_RADIUS = 20; // Default collision detection radius for food pickup
export const FOOD_SPAWN_MAX_ATTEMPTS_STRICT = 100; // Attempts before relaxing pheromone constraint
export const FOOD_SPAWN_MAX_ATTEMPTS_TOTAL = 200; // Absolute maximum spawn attempts

// Obstacle Settings (density-based)
export const OBSTACLE_DENSITY_LARGE = 0.0000009765625; // Rocks per square pixel (39 rocks / 8000^2 ≈ 0.00000097)
export const OBSTACLE_DENSITY_MEDIUM = 0.00000140625; // 56 rocks / 8000^2 ≈ 0.0000014
export const OBSTACLE_DENSITY_SMALL = 0.000003359375; // 134 rocks / 8000^2 ≈ 0.0000033
export const MIN_OBSTACLE_SIZE = 80;
export const MAX_OBSTACLE_SIZE = 480;
export const OBSTACLE_COLONY_CLEARANCE = 500;
export const OBSTACLE_SPAWN_MARGIN = 100; // Minimum distance from world edges
export const OBSTACLE_SPAWN_MAX_ATTEMPTS = 50; // Max attempts to find valid obstacle position
export const OBSTACLE_DEFAULT_COLLISION_RADIUS = 10; // Default entity radius for collision detection

// Ant Settings
export const ANT_MAX_SPEED = 3;
export const ANT_MAX_ACCEL = 20;      // units/s² (tune 10–40)
export const ANT_MAX_TURN = Math.PI;  // rad/s (tune 2–6 for smoother)
export const ANT_MIN_SPEED = 0.2;     // keep small floor to avoid "stall"
export const ANT_HEADING_SMOOTHING = 0.5; // Temporal smoothing factor (0=no smoothing, 1=instant)
export const ANT_STARTING_ENERGY = 500; // Starting energy per ant (scaled for large worlds)
export const ANT_ENERGY_DRAIN = 0.03; // Ants starve in ~2 minutes without food
export const ANT_ENERGY_FROM_FOOD_PICKUP = 10; // Energy restored when finding food
export const ANT_ENERGY_FROM_COLONY = 30; // Energy restored when returning to colony
export const ANT_LOW_ENERGY_THRESHOLD = 100; // Energy level to trigger panic mode (abandon trails, beeline home)
export const ANT_FOOD_PICKUP_RADIUS = 35; // Physical collision radius for picking up food (not vision range)
export const ANT_SIZE = 5; // Visual size of ant sprite
export const ANT_DIRECTION_INDICATOR_LENGTH = 1; // Length of direction line on ant
export const ANT_SPAWN_DISTANCE = 65; // Distance from colony center to spawn ants
export const ANT_RENDER_INTERVAL = 10; // Render ant every N frames

// Role-specific settings
export const SCOUT_VISION_RANGE = 600; // Scouts see 2x farther than foragers (200)
export const SCOUT_SMELL_RANGE = 1000; // Scouts can smell food from very far away
export const FORAGER_VISION_RANGE = 200; // Standard forager vision
export const SCOUT_SPAWN_RATIO = 0.2; // 20% of new ants are scouts
export const SCOUT_HOMEPHER_STRENGTH = 4.0; // Scout trails persist longer (foragers use 1.0)
export const FORAGER_HOMEPHER_STRENGTH = 1.0; // Standard forager trail strength
export const SCOUT_CARRY_CAPACITY = 1; // Scouts carry 1 unit (light and fast)
export const FORAGER_MIN_CARRY_CAPACITY = 1; // Minimum forager carry capacity
export const FORAGER_MAX_CARRY_CAPACITY = 2; // Maximum forager carry capacity

// Scout state detection ranges (Phase 2.1)
export const SCOUT_FOOD_DETECTION_RANGE = 600; // Same as vision range
export const SCOUT_GUARD_DETECTION_RANGE = 200; // Detect friendly guards
export const SCOUT_DISTRESS_DETECTION_RANGE = 500; // Detect distress pheromone

// Scout guarding behavior (Phase 2.3)
export const SCOUT_GUARD_RADIUS = 400; // Stay within this distance of food while guarding (pixels)
export const SCOUT_GUARD_PATROL_MIN = 150; // Minimum patrol distance from food (pixels)
export const SCOUT_GUARD_PATROL_MAX = 350; // Maximum patrol distance from food (pixels)
export const SCOUT_GUARD_TIMEOUT = 60; // Seconds to wait for foragers before re-alerting colony
export const SCOUT_MAX_TAGGERS_PER_FOOD = 2; // Maximum scouts that should tag the same food source

// Combat Settings
export const COMBAT_RANGE = 20; // Distance to initiate combat (pixels)
export const BASE_COMBAT_DAMAGE = 15; // Base energy drained per second in combat
export const COMBAT_FLEE_THRESHOLD = 20; // Auto-flee when energy drops below this
export const COMBAT_ENERGY_REWARD = 10; // Energy gained for winning a fight
export const COMBAT_DETECTION_RANGE = 150; // Distance to detect enemy ants (pixels)

// Ant physics and collision
export const ANT_COLLISION_RADIUS = 12; // Radius for obstacle collision checks
export const ANT_SAFE_DISTANCE_FROM_OBSTACLE = 20; // Safe push distance from obstacles
export const ANT_STUCK_THRESHOLD = 1.0; // Seconds before ant triggers unstuck recovery (increased to allow counter to show)
export const ANT_STUCK_BACKUP_DISTANCE = 10; // Distance to backup when stuck
export const ANT_EMERGENCY_UNSTUCK_COUNT = 3; // Number of unstucks in window to trigger emergency mode
export const ANT_EMERGENCY_UNSTUCK_WINDOW = 6; // Seconds to track unstuck history
export const ANT_EMERGENCY_MODE_DURATION = 10; // Seconds of random walk in emergency mode
export const ANT_WORLD_BOUNDARY_MARGIN = 50; // Margin from world edges
export const ANT_MAX_DELTA_TIME = 2; // Cap delta time to prevent huge energy drains
export const ANT_EXPECTED_MOVEMENT_RATIO = 0.3; // Minimum expected movement for stuck detection
export const ANT_JUST_RETURNED_COOLDOWN = 15; // Frames of free movement after returning to disperse
export const PHYS_MAX_SWEEP_ITERS = 3;
export const PHYS_EPS = 0.001;             // numeric slop
export const PHYS_SKIN = 2.0;              // push-out after contact (increased to prevent sticking)
export const PHYS_MIN_SPEED = 0.01;        // ignore near-zero velocities
export const PHYS_SUBSTEP_MAX_DIST = 100;  // cap per-step travel (smaller for better collision)

// Ant behavior - wall avoidance
export const ANT_WALL_AVOIDANCE_BLEND_AWAY = 0.7; // Weight for turning away from wall
export const ANT_WALL_AVOIDANCE_BLEND_COLONY = 0.3; // Weight for turning toward colony
export const ANT_RANDOM_TURN_ANGLE_RANGE = 0.5; // Random angle range for turns

// Pheromone Settings
export const PHEROMONE_CELL_SIZE = 20;

// Decay rates (evaporation) - separate for each type
// homePher half-life ≈ 3 min @ 20Hz → ρ ≈ 0.000193 (persistent "safe area map")
// foodPher half-life ≈ 20s @ 20Hz → ρ ≈ 0.00347
// distressPher half-life ≈ 5s @ 20Hz → ρ ≈ 0.1 (emergency signal, fast fade)
export const PHEROMONE_HOME_DECAY_RATE = 0.000193; // Very slow decay - accumulates as safe area map
export const PHEROMONE_FOOD_DECAY_RATE = 0.00347; // Faster decay for food trails
export const PHEROMONE_DISTRESS_DECAY_RATE = 0.1; // Fast decay - distress signal fades quickly

// Diffusion rates - separate for each type (much smaller than before)
export const PHEROMONE_HOME_DIFFUSION_RATE = 0.01; // Minimal diffusion for home
export const PHEROMONE_FOOD_DIFFUSION_RATE = 0.02; // Slightly more diffusion for food
export const PHEROMONE_DISTRESS_DIFFUSION_RATE = 1.5; // Fast spread - distress floods outward

export const PHEROMONE_MAX_LEVEL = 10; // Maximum pheromone concentration per cell
export const PHEROMONE_MIN_THRESHOLD = 0.00001; // Minimum level before clearing (very small to avoid flicker)
export const PHEROMONE_UPDATE_INTERVAL = 3; // Update grid every N frames
export const PHEROMONE_RENDER_INTERVAL = 10; // Render pheromones every N frames (increased for performance)
export const PHEROMONE_RENDER_MIN_THRESHOLD = 0.003; // Minimum level to render (1-2% of fresh drop)

// Distance-based deposit settings (replaces frame-based deposits)
export const PHEROMONE_DEPOSIT_DISTANCE = 5; // Deposit every N units traveled (5-6 units)
export const PHEROMONE_SCOUT_STRENGTH_PER_UNIT = 0.75; // Scout foodPher strength per unit distance (15x stronger for long-distance trails)
export const PHEROMONE_FORAGER_STRENGTH_PER_UNIT = 0.10; // Forager foodPher strength per unit distance (returning with food)

// Distress pheromone settings (emergency signaling)
export const DISTRESS_DEPOSIT_STRENGTH = 5.0; // High intensity per deposit (floods area)
export const DISTRESS_DETECTION_THRESHOLD = 0.5; // Min level to detect distress
export const DISTRESS_EMIT_RADIUS = 50; // Deposit in area around ant (pixels)

export const PHEROMONE_FOOD_ALPHA_MAX = 0.15; // Max alpha for food pheromone visualization
export const PHEROMONE_FOOD_ALPHA_DIVISOR = 20; // Divisor for food alpha calculation
export const PHEROMONE_HOME_ALPHA_MAX = 0.1; // Max alpha for home pheromone visualization
export const PHEROMONE_HOME_ALPHA_DIVISOR = 20; // Divisor for home alpha calculation
export const PHEROMONE_RENDER_MIN_ALPHA = 0.05; // Minimum alpha to render
export const PHEROMONE_SCOUT_TRAIL_THRESHOLD = 0.15; // Threshold to distinguish scout vs forager trails (adjusted for new strengths)

// Gradient magnitude thresholds for steering
export const GRADIENT_MIN_THRESHOLD = 0.001; // G0 - ignore gradients below this
export const GRADIENT_SPAN = 0.01; // Gspan - range to scale gradient influence

// FOV Sensing (Phase 2 Task 6)
export const FOV_RAY_COUNT = 5; // Number of rays to cast for foragers
export const FOV_ANGLE = Math.PI / 3; // 60 degrees total FOV for foragers
export const FOV_DISTANCE = 80; // How far rays extend
export const FOV_ANGLE_TOLERANCE = 0.3; // Radians (~17 degrees) for food detection along ray
export const FOV_OBSTACLE_DISTANCE_SAFETY = 0.8; // Multiplier for obstacle distance

// Scout FOV Sensing (wider and more rays for better navigation)
export const SCOUT_FOV_RAY_COUNT = 9; // More rays for better obstacle detection
export const SCOUT_FOV_ANGLE = Math.PI; // 180 degrees - forward hemisphere
export const SCOUT_FOV_DISTANCE = 300; // Scouts look further ahead for obstacle detection

// Foraging behavior weights
export const FORAGING_OBSTACLE_PENALTY = 3.0; // Score penalty for obstacles
export const FORAGING_EXPLORATION_BONUS = 0.3; // Bonus for moving away from colony
export const FORAGING_RANDOM_COMPONENT = 0.5; // Random score variation for exploration (reduced for smoother movement)
export const FORAGING_PHEROMONE_SAMPLE_DISTANCE = 30; // Distance to sample pheromone
export const FORAGING_TRAIL_MIN_LEVEL = 0.01; // Minimum pheromone to consider following (adjusted for new strengths)
export const FORAGING_TRAIL_SAMPLE_MIN = 0.003; // Minimum pheromone in sample direction (adjusted for new strengths)

// Exploration commitment (smooth exploration movement)
export const FORAGING_EXPLORATION_MIN_DURATION = 0.5; // Minimum seconds to commit to a direction
export const FORAGING_EXPLORATION_MAX_DURATION = 1.5; // Maximum seconds to commit to a direction

// Trail following hysteresis (prevents mode flapping at trail edges)
export const TRAIL_ENTER_LEVEL = 0.08; // Higher threshold to start following
export const TRAIL_EXIT_LEVEL = 0.02; // Lower threshold to stop (hysteresis)
export const TRAIL_LATCH_TIME = 0.8; // Seconds to stay in mode
export const TRAIL_END_COOLDOWN = 0.3; // Seconds to ignore trails after exiting

// Trail lock system (Task 17) - prevent following dead-end trails
export const TRAIL_LOCK_DURATION = 45; // Seconds to lock out from following trails after dead end
export const TRAIL_LOCK_MIN_FOLLOW_TIME = 3; // Minimum seconds following trail before considering it a "real" trail
export const TRAIL_LOCK_MIN_DISTANCE = 150; // Minimum distance traveled on trail to trigger lock (pixels)

// Returning behavior
export const RETURNING_COLONY_WEIGHT = 0.7; // Weight for direct colony direction
export const RETURNING_GRADIENT_WEIGHT = 0.3; // Weight for homePher gradient
export const RETURNING_OBSTACLE_REPULSION_WEIGHT = 0.2; // Weight for obstacle avoidance

// Obstacle repulsion
export const OBSTACLE_REPULSION_CHECK_DISTANCE = 40; // Distance to check for nearby obstacles
export const SCOUT_OBSTACLE_REPULSION_THRESHOLD = 1.5; // Only avoid if repulsion magnitude > this
export const SCOUT_OBSTACLE_CORRECTION_WEIGHT = 0.3; // Light correction for scouts

// Scout exploration
export const LEVY_SCOUT_HOMEPHER_FADE_START = 100; // Distance where scout trail strength starts fading in
export const SCOUT_EXPLORATION_COMMIT_DISTANCE = 3500; // Travel this far before picking new direction
export const SCOUT_STUCK_TARGET_RESET_TIME = 5.0; // If stuck for 5 seconds, pick new target
export const FORAGER_COMFORT_ZONE = 1500; // Don't pick targets inside forager territory

// Softmax selection
export const SOFTMAX_TEMPERATURE = 1.0; // Temperature for probabilistic turning

// Camera Settings
export const CAMERA_START_ZOOM = 0.45;
export const CAMERA_MIN_ZOOM = 0.05;
export const CAMERA_MAX_ZOOM = 3;
export const CAMERA_MOVE_SPEED = 5;
export const CAMERA_ZOOM_OUT_FACTOR = 0.95; // Mouse wheel zoom out per tick
export const CAMERA_ZOOM_IN_FACTOR = 1.05; // Mouse wheel zoom in per tick
export const CAMERA_KEYBOARD_ZOOM_OUT_RATE = 0.98; // Q key zoom out rate
export const CAMERA_KEYBOARD_ZOOM_IN_RATE = 1.02; // E key zoom in rate
