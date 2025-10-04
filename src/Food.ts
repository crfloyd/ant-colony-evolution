import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2 } from './types';
import * as CONFIG from './config';

export class FoodSource implements Entity {
  public position: Vector2;
  public sprite: Container;
  public amount: number;
  public id: string; // Unique ID for this food source

  private graphics: Graphics;
  private maxAmount: number;

  constructor(position: Vector2, amount: number = 50) {
    this.id = Math.random().toString(36).substring(7); // Generate unique ID
    this.position = { ...position };
    this.amount = amount;
    this.maxAmount = amount;

    // Create sprite
    this.sprite = new Container();
    this.graphics = new Graphics();
    this.sprite.addChild(this.graphics);

    this.sprite.x = position.x;
    this.sprite.y = position.y;

    this.render();
  }

  private render(): void {
    this.graphics.clear();

    // Size based on remaining amount - starts big, shrinks as consumed
    const sizeRatio = this.amount / this.maxAmount;
    const minRadius = CONFIG.FOOD_MIN_RADIUS;
    const maxRadius = CONFIG.FOOD_MAX_RADIUS;
    const radius = minRadius + sizeRatio * (maxRadius - minRadius);

    // Food pile (circle) - bright red to stand out
    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color: 0xFF0000, alpha: 0.9 }); // Bright red

    // Highlight for 3D effect
    this.graphics.circle(-radius * 0.3, -radius * 0.3, radius * 0.4);
    this.graphics.fill({ color: 0xFF6666, alpha: 0.6 }); // Light red highlight

    // Shadow/depth
    this.graphics.circle(radius * 0.2, radius * 0.2, radius * 0.3);
    this.graphics.fill({ color: 0x000000, alpha: 0.25 });
  }

  public consume(amount: number = 1): boolean {
    if (this.amount > 0) {
      this.amount -= amount;
      this.render();
      return true;
    }
    return false;
  }

  public isEmpty(): boolean {
    return this.amount <= 0;
  }

  public update(deltaTime: number): void {
    // Food doesn't need to update, but implementing for interface
  }

  public destroy(): void {
    this.sprite.destroy();
  }
}

export class FoodManager {
  private foodSources: FoodSource[] = [];
  private container: Container;
  private respawnTimer: number = 0;
  private worldWidth: number;
  private worldHeight: number;
  private obstacleManager: any = null;
  private pheromoneGrid: any = null; // Phase 3 Task 15: Trail avoidance for food spawning
  private getColonySize: () => number;

  constructor(container: Container, worldWidth: number, worldHeight: number, obstacleManager?: any, pheromoneGrid?: any, getColonySize?: () => number) {
    this.container = container;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.obstacleManager = obstacleManager;
    this.pheromoneGrid = pheromoneGrid;
    this.getColonySize = getColonySize || (() => 0);

    // Spawn initial food sources
    this.spawnInitialFood(CONFIG.INITIAL_FOOD_SOURCES);
  }

  private spawnInitialFood(count: number): void {
    for (let i = 0; i < count; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    // Random position, avoiding center (colony area), edges, obstacles, and very high pheromone trails
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const margin = CONFIG.FOOD_SPAWN_MARGIN; // Keep food away from edges so ants can reach it

    let position: Vector2;
    let attempts = 0;

    do {
      position = {
        x: margin + Math.random() * (this.worldWidth - 2 * margin),
        y: margin + Math.random() * (this.worldHeight - 2 * margin),
      };

      const dx = position.x - centerX;
      const dy = position.y - centerY;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy);

      // Check if position is valid
      const inObstacle = this.obstacleManager && this.obstacleManager.checkCollision(position, CONFIG.FOOD_SPAWN_OBSTACLE_CHECK_RADIUS);

      // Check distance from other food sources
      let tooCloseToFood = false;
      const minFoodDistance = 300; // Minimum distance between food sources
      for (const food of this.foodSources) {
        const fdx = position.x - food.position.x;
        const fdy = position.y - food.position.y;
        const foodDist = Math.sqrt(fdx * fdx + fdy * fdy);
        if (foodDist < minFoodDistance) {
          tooCloseToFood = true;
          break;
        }
      }

      // Phase 3 Task 15: Check foodPher level at this position (only avoid VERY high areas)
      let veryHighPheromone = false;
      if (this.pheromoneGrid) {
        const foodPher = this.pheromoneGrid.getPheromoneLevel(position.x, position.y, 'foodPher');
        veryHighPheromone = foodPher > CONFIG.FOOD_PHER_AVOIDANCE_THRESHOLD;
      }

      // Valid if: far enough from colony, not in obstacle, not near other food, not in super high pheromone area
      const validDistance = distFromCenter >= CONFIG.FOOD_MIN_DIST_FROM_COLONY;

      if (validDistance && !inObstacle && !tooCloseToFood && !veryHighPheromone) {
        break;
      }

      attempts++;
      if (attempts > CONFIG.FOOD_SPAWN_MAX_ATTEMPTS_STRICT) {
        // After many attempts, relax pheromone constraint (but still avoid obstacles, colony, and other food)
        if (!inObstacle && distFromCenter >= CONFIG.FOOD_MIN_DIST_FROM_COLONY && !tooCloseToFood) {
          break;
        }
      }

      if (attempts > CONFIG.FOOD_SPAWN_MAX_ATTEMPTS_TOTAL) {
        // Give up entirely - just avoid obstacles and other food
        if (!inObstacle && !tooCloseToFood) {
          break;
        }
      }
    } while (true);

    const amount = CONFIG.MIN_FOOD_PER_SOURCE + Math.random() * (CONFIG.MAX_FOOD_PER_SOURCE - CONFIG.MIN_FOOD_PER_SOURCE);
    const food = new FoodSource(position, amount);
    this.foodSources.push(food);
    this.container.addChild(food.sprite);
  }

  public update(deltaTime: number): void {
    // Remove depleted food sources and mark their trails for faster decay
    for (let i = this.foodSources.length - 1; i >= 0; i--) {
      if (this.foodSources[i].isEmpty()) {
        const depletedFood = this.foodSources[i];

        // Mark pheromone trails to this food source for accelerated decay
        if (this.pheromoneGrid && depletedFood.id) {
          this.pheromoneGrid.markFoodSourceDepleted(depletedFood.id);
        }

        depletedFood.destroy();
        this.foodSources.splice(i, 1);
      }
    }

    // Respawn food periodically
    this.respawnTimer += deltaTime;
    if (this.respawnTimer >= CONFIG.FOOD_RESPAWN_INTERVAL) {
      this.respawnTimer = 0;

      // Calculate max food sources based on colony size (1 food source per 10 ants)
      const colonySize = this.getColonySize();
      const dynamicMaxFood = Math.min(
        Math.max(CONFIG.INITIAL_FOOD_SOURCES, Math.floor(colonySize / 10)),
        CONFIG.MAX_FOOD_SOURCES
      );

      if (this.foodSources.length < dynamicMaxFood) {
        this.spawnFood();
      }
    }
  }

  public checkCollisions(position: Vector2, radius: number = CONFIG.FOOD_PICKUP_RADIUS): FoodSource | null {
    for (const food of this.foodSources) {
      const dx = position.x - food.position.x;
      const dy = position.y - food.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < radius) {
        return food;
      }
    }
    return null;
  }

  public getFoodSources(): FoodSource[] {
    return this.foodSources;
  }

  public destroy(): void {
    this.foodSources.forEach(food => food.destroy());
    this.foodSources = [];
  }
}
