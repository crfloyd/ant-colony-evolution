// Simulation Configuration Constants

// World Settings
export const WORLD_WIDTH = 8000;
export const WORLD_HEIGHT = 8000;

// Colony Settings
export const INITIAL_ANT_COUNT = 500; // Start small, let population grow naturally
export const MAX_ANT_COUNT = 5000;
export const COLONY_STARTING_FOOD = 100; // Increased to support initial spawning
export const COLONY_RETURN_RADIUS = 50; // Distance within which ant can deliver food
export const COLONY_OUTER_RADIUS = 30; // Visual size of colony nest (outer circle)
export const COLONY_MIDDLE_RADIUS = 20; // Visual size of colony nest (middle circle)
export const COLONY_ENTRANCE_RADIUS = 10; // Visual size of colony entrance
export const GENERATION_SURVIVAL_RATIO = 0.5; // Fraction of ants that survive generation culling

// Spawning Settings
export const FOOD_TO_SPAWN_ANT = 10;
export const FOOD_COST_TO_SPAWN = 10;

// Food Settings
export const INITIAL_FOOD_SOURCES = 50;
export const MIN_FOOD_PER_SOURCE = 50;
export const MAX_FOOD_PER_SOURCE = 100;
export const FOOD_RESPAWN_INTERVAL = 50; // frames - faster respawn for equilibrium
export const MAX_FOOD_SOURCES = 100; // More food sources to support population
export const FOOD_MIN_DIST_FROM_COLONY = 150; // Minimum spawn distance from colony
export const FOOD_PHER_AVOIDANCE_THRESHOLD = 15.0; // Only avoid VERY high foodPher areas
export const FOOD_SPAWN_MARGIN = 50; // Keep food away from world edges
export const FOOD_SPAWN_OBSTACLE_CHECK_RADIUS = 30; // Radius for obstacle collision check
export const FOOD_MIN_RADIUS = 5; // Minimum visual radius for food piles
export const FOOD_MAX_RADIUS = 25; // Maximum visual radius for food piles
export const FOOD_PICKUP_RADIUS = 20; // Default collision detection radius for food pickup
export const FOOD_SPAWN_MAX_ATTEMPTS_STRICT = 100; // Attempts before relaxing pheromone constraint
export const FOOD_SPAWN_MAX_ATTEMPTS_TOTAL = 200; // Absolute maximum spawn attempts

// Obstacle Settings
export const MIN_OBSTACLES = 50;
export const MAX_OBSTACLES = 100;
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
export const ANT_MIN_SPEED = 0.2;     // keep small floor to avoid “stall”
export const ANT_STARTING_ENERGY = 200; // Starting energy per ant
export const ANT_ENERGY_DRAIN = 0.03; // Ants starve in ~2 minutes without food
export const ANT_ENERGY_FROM_FOOD_PICKUP = 10; // Energy restored when finding food
export const ANT_ENERGY_FROM_COLONY = 30; // Energy restored when returning to colony
export const ANT_FOOD_PICKUP_RADIUS = 35; // Physical collision radius for picking up food (not vision range)
export const ANT_SIZE = 5; // Visual size of ant sprite
export const ANT_DIRECTION_INDICATOR_LENGTH = 8; // Length of direction line on ant
export const ANT_SPAWN_DISTANCE = 35; // Distance from colony center to spawn ants
export const ANT_RENDER_INTERVAL = 10; // Render ant every N frames

// Role-specific settings
export const SCOUT_VISION_RANGE = 600; // Scouts see 2x farther than foragers (200)
export const FORAGER_VISION_RANGE = 200; // Standard forager vision
export const SCOUT_SPAWN_RATIO = 0.2; // 20% of new ants are scouts
export const SCOUT_HOMEPHER_STRENGTH = 4.0; // Scout trails persist longer (foragers use 1.0)
export const FORAGER_HOMEPHER_STRENGTH = 1.0; // Standard forager trail strength
export const SCOUT_CARRY_CAPACITY = 1; // Scouts carry 1 unit (light and fast)
export const FORAGER_MIN_CARRY_CAPACITY = 1; // Minimum forager carry capacity
export const FORAGER_MAX_CARRY_CAPACITY = 2; // Maximum forager carry capacity

// Ant physics and collision
export const ANT_COLLISION_RADIUS = 12; // Radius for obstacle collision checks
export const ANT_SAFE_DISTANCE_FROM_OBSTACLE = 20; // Safe push distance from obstacles
export const ANT_STUCK_THRESHOLD = 0.5; // Seconds before ant is considered stuck
export const ANT_STUCK_BACKUP_DISTANCE = 10; // Distance to backup when stuck
export const ANT_WORLD_BOUNDARY_MARGIN = 50; // Margin from world edges
export const ANT_MAX_DELTA_TIME = 2; // Cap delta time to prevent huge energy drains
export const ANT_EXPECTED_MOVEMENT_RATIO = 0.3; // Minimum expected movement for stuck detection
export const ANT_COLONY_PUSH_DISTANCE = 60; // Push distance after returning to colony
export const ANT_JUST_RETURNED_COOLDOWN = 30; // Frames of free movement after returning
export const PHYS_MAX_SWEEP_ITERS = 5;
export const PHYS_EPS = 1e-5;             // numeric slop
export const PHYS_SKIN = 0.01;            // small push-out after contact (in world units)
export const PHYS_MIN_SPEED = 1e-3;       // ignore near-zero velocities
export const PHYS_SUBSTEP_MAX_DIST = 200; // optional: cap per-step travel (pre-substep)

// Ant behavior - wall avoidance
export const ANT_WALL_AVOIDANCE_BLEND_AWAY = 0.7; // Weight for turning away from wall
export const ANT_WALL_AVOIDANCE_BLEND_COLONY = 0.3; // Weight for turning toward colony
export const ANT_RANDOM_TURN_ANGLE_RANGE = 0.5; // Random angle range for turns

// Pheromone Settings
export const PHEROMONE_CELL_SIZE = 20;

// Decay rates (evaporation) - separate for each type
// homePher half-life ≈ 45s @ 20Hz → ρ ≈ 0.00154
// foodPher half-life ≈ 20s @ 20Hz → ρ ≈ 0.00347
export const PHEROMONE_HOME_DECAY_RATE = 0.00154; // Very slow decay for home trails
export const PHEROMONE_FOOD_DECAY_RATE = 0.00347; // Faster decay for food trails

// Diffusion rates - separate for each type (much smaller than before)
export const PHEROMONE_HOME_DIFFUSION_RATE = 0.01; // Minimal diffusion for home
export const PHEROMONE_FOOD_DIFFUSION_RATE = 0.02; // Slightly more diffusion for food

export const PHEROMONE_MAX_LEVEL = 10; // Maximum pheromone concentration per cell
export const PHEROMONE_MIN_THRESHOLD = 0.00001; // Minimum level before clearing (very small to avoid flicker)
export const PHEROMONE_UPDATE_INTERVAL = 3; // Update grid every N frames
export const PHEROMONE_RENDER_INTERVAL = 5; // Render pheromones every N frames
export const PHEROMONE_RENDER_MIN_THRESHOLD = 0.003; // Minimum level to render (1-2% of fresh drop)

// Distance-based deposit settings (replaces frame-based deposits)
export const PHEROMONE_DEPOSIT_DISTANCE = 5; // Deposit every N units traveled (5-6 units)
export const PHEROMONE_SCOUT_STRENGTH_PER_UNIT = 0.05; // Scout homePher strength per unit distance
export const PHEROMONE_FORAGER_STRENGTH_PER_UNIT = 0.10; // Forager foodPher strength per unit distance (returning with food)

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
export const FOV_RAY_COUNT = 5; // Number of rays to cast (3-5)
export const FOV_ANGLE = Math.PI / 3; // 60 degrees total FOV
export const FOV_DISTANCE = 80; // How far rays extend
export const FOV_ANGLE_TOLERANCE = 0.3; // Radians (~17 degrees) for food detection along ray
export const FOV_OBSTACLE_DISTANCE_SAFETY = 0.8; // Multiplier for obstacle distance

// Foraging behavior weights
export const FORAGING_OBSTACLE_PENALTY = 3.0; // Score penalty for obstacles
export const FORAGING_EXPLORATION_BONUS = 0.3; // Bonus for moving away from colony
export const FORAGING_RANDOM_COMPONENT = 0.5; // Random score variation for exploration (reduced for smoother movement)
export const FORAGING_PHEROMONE_SAMPLE_DISTANCE = 30; // Distance to sample pheromone
export const FORAGING_TRAIL_MIN_LEVEL = 0.01; // Minimum pheromone to consider following (adjusted for new strengths)
export const FORAGING_TRAIL_SAMPLE_MIN = 0.003; // Minimum pheromone in sample direction (adjusted for new strengths)

// Exploration commitment (smooth exploration movement)
export const FORAGING_EXPLORATION_MIN_DURATION = 2.0; // Minimum seconds to commit to a direction
export const FORAGING_EXPLORATION_MAX_DURATION = 5.0; // Maximum seconds to commit to a direction

// Trail following hysteresis (prevents mode flapping at trail edges)
export const TRAIL_ENTER_LEVEL = 0.06; // Higher threshold to start following
export const TRAIL_EXIT_LEVEL = 0.03; // Lower threshold to stop (hysteresis)
export const TRAIL_LATCH_TIME = 0.4; // Seconds to stay in mode
export const TRAIL_END_COOLDOWN = 0.6; // Seconds to ignore trails after exiting

// Returning behavior
export const RETURNING_COLONY_WEIGHT = 0.7; // Weight for direct colony direction
export const RETURNING_GRADIENT_WEIGHT = 0.3; // Weight for homePher gradient
export const RETURNING_OBSTACLE_REPULSION_WEIGHT = 0.2; // Weight for obstacle avoidance

// Obstacle repulsion
export const OBSTACLE_REPULSION_CHECK_DISTANCE = 40; // Distance to check for nearby obstacles
export const SCOUT_OBSTACLE_REPULSION_THRESHOLD = 1.5; // Only avoid if repulsion magnitude > this
export const SCOUT_OBSTACLE_CORRECTION_WEIGHT = 0.3; // Light correction for scouts
export const SCOUT_OBSTACLE_RESET_LEVY_THRESHOLD = 3.0; // Reset Lévy step if very close

// Lévy walk (scouts)
export const LEVY_WALK_MU = 1.7; // Power-law exponent for Lévy distribution
export const LEVY_WALK_MIN_STEP = 50; // Minimum step length
export const LEVY_WALK_MAX_STEP = 400; // Maximum step length
export const LEVY_WALK_SCALE = 30; // Scale factor for distribution
export const LEVY_COLONY_BIAS_DISTANCE = 800; // Distance threshold for colony avoidance bias
export const LEVY_SCOUT_HOMEPHER_FADE_START = 100; // Distance where scout trail strength starts fading in (removed hard gate)

// Softmax selection
export const SOFTMAX_TEMPERATURE = 1.0; // Temperature for probabilistic turning

// Camera Settings
export const CAMERA_START_ZOOM = 0.5;
export const CAMERA_MIN_ZOOM = 0.125;
export const CAMERA_MAX_ZOOM = 3;
export const CAMERA_MOVE_SPEED = 5;
export const CAMERA_ZOOM_OUT_FACTOR = 0.95; // Mouse wheel zoom out per tick
export const CAMERA_ZOOM_IN_FACTOR = 1.05; // Mouse wheel zoom in per tick
export const CAMERA_KEYBOARD_ZOOM_OUT_RATE = 0.98; // Q key zoom out rate
export const CAMERA_KEYBOARD_ZOOM_IN_RATE = 1.02; // E key zoom in rate
