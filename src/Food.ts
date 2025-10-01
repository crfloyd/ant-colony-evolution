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
    const minRadius = 5;
    const maxRadius = 25;
    const radius = minRadius + sizeRatio * (maxRadius - minRadius);

    // Food pile (circle)
    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color: 0xffdd44, alpha: 0.9 }); // Yellow/orange

    // Highlight for 3D effect
    this.graphics.circle(-radius * 0.3, -radius * 0.3, radius * 0.4);
    this.graphics.fill({ color: 0xffffaa, alpha: 0.6 });

    // Shadow/depth
    this.graphics.circle(radius * 0.2, radius * 0.2, radius * 0.3);
    this.graphics.fill({ color: 0x000000, alpha: 0.15 });
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
  private respawnInterval: number = 500; // Respawn food every 500 frames
  private worldWidth: number;
  private worldHeight: number;
  private obstacleManager: any = null;
  private pheromoneGrid: any = null; // Phase 3 Task 15: Trail avoidance for food spawning

  constructor(container: Container, worldWidth: number, worldHeight: number, obstacleManager?: any, pheromoneGrid?: any) {
    this.container = container;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.obstacleManager = obstacleManager;
    this.pheromoneGrid = pheromoneGrid;

    // Spawn initial food sources
    this.spawnInitialFood(CONFIG.INITIAL_FOOD_SOURCES);
  }

  private spawnInitialFood(count: number): void {
    for (let i = 0; i < count; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    // Random position, avoiding center (colony area), edges, obstacles, and high pheromone trails
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const minDistFromCenter = 200;
    const margin = 50; // Keep food away from edges so ants can reach it
    const maxFoodPherThreshold = 5.0; // Phase 3 Task 15: Avoid high foodPher areas

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

      // Check if position is valid (not in obstacle and far from center)
      const inObstacle = this.obstacleManager && this.obstacleManager.checkCollision(position, 30);

      // Phase 3 Task 15: Check foodPher level at this position
      let highPheromone = false;
      if (this.pheromoneGrid) {
        const foodPher = this.pheromoneGrid.getPheromoneLevel(position.x, position.y, 'foodPher');
        highPheromone = foodPher > maxFoodPherThreshold;
      }

      if (distFromCenter >= minDistFromCenter && !inObstacle && !highPheromone) {
        break;
      }

      attempts++;
      if (attempts > 100) {
        // Give up and use current position
        break;
      }
    } while (true);

    const amount = CONFIG.MIN_FOOD_PER_SOURCE + Math.random() * (CONFIG.MAX_FOOD_PER_SOURCE - CONFIG.MIN_FOOD_PER_SOURCE);
    const food = new FoodSource(position, amount);
    this.foodSources.push(food);
    this.container.addChild(food.sprite);
  }

  public update(deltaTime: number): void {
    // Remove depleted food sources
    for (let i = this.foodSources.length - 1; i >= 0; i--) {
      if (this.foodSources[i].isEmpty()) {
        this.foodSources[i].destroy();
        this.foodSources.splice(i, 1);
      }
    }

    // Respawn food periodically
    this.respawnTimer += deltaTime;
    if (this.respawnTimer >= this.respawnInterval) {
      this.respawnTimer = 0;
      if (this.foodSources.length < 15) {
        this.spawnFood();
      }
    }
  }

  public checkCollisions(position: Vector2, radius: number = 20): FoodSource | null {
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
