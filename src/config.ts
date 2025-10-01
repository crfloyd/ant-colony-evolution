// Simulation Configuration Constants

// World Settings
export const WORLD_WIDTH = 8000;
export const WORLD_HEIGHT = 8000;

// Colony Settings
export const INITIAL_ANT_COUNT = 2000;
export const MAX_ANT_COUNT = 5000;
export const COLONY_STARTING_FOOD = 20;

// Spawning Settings
export const FOOD_TO_SPAWN_ANT = 10;
export const FOOD_COST_TO_SPAWN = 10;

// Food Settings
export const INITIAL_FOOD_SOURCES = 50;
export const MIN_FOOD_PER_SOURCE = 50;
export const MAX_FOOD_PER_SOURCE = 100;
export const FOOD_RESPAWN_INTERVAL = 500; // frames
export const MAX_FOOD_SOURCES = 50;

// Obstacle Settings
export const MIN_OBSTACLES = 50;
export const MAX_OBSTACLES = 100;
export const MIN_OBSTACLE_SIZE = 80;
export const MAX_OBSTACLE_SIZE = 480;
export const OBSTACLE_COLONY_CLEARANCE = 500;

// Ant Settings
export const ANT_MAX_SPEED = 3;
export const ANT_STARTING_ENERGY = 200;
export const ANT_ENERGY_DRAIN = 0.001;
export const ANT_VISION_RANGE = 300; // How far ants can see food
export const ANT_FOOD_PICKUP_RADIUS = 35;
export const ANT_COLONY_RETURN_RADIUS = 50;

// Pheromone Settings
export const PHEROMONE_CELL_SIZE = 20;
export const PHEROMONE_DECAY_RATE = 0.998;
export const PHEROMONE_DROP_INTERVAL = 2; // frames
export const PHEROMONE_STRENGTH = 5;
export const PHEROMONE_FOLLOW_THRESHOLD = 2.0;

// Camera Settings
export const CAMERA_START_ZOOM = 0.5;
export const CAMERA_MIN_ZOOM = 0.125;
export const CAMERA_MAX_ZOOM = 3;
export const CAMERA_MOVE_SPEED = 5;
