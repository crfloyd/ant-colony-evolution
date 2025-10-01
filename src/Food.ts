import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2 } from './types';

export class FoodSource implements Entity {
  public position: Vector2;
  public sprite: Container;
  public amount: number;

  private graphics: Graphics;
  private maxAmount: number;

  constructor(position: Vector2, amount: number = 50) {
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

    // Size based on remaining amount
    const sizeRatio = this.amount / this.maxAmount;
    const radius = 10 + sizeRatio * 10;

    // Food pile
    this.graphics.circle(0, 0, radius);
    this.graphics.fill({ color: 0xffdd44, alpha: 0.9 }); // Yellow/orange

    // Highlight
    this.graphics.circle(-radius * 0.3, -radius * 0.3, radius * 0.4);
    this.graphics.fill({ color: 0xffffaa, alpha: 0.6 });
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

  constructor(container: Container, worldWidth: number, worldHeight: number) {
    this.container = container;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    // Spawn initial food sources
    this.spawnInitialFood(20);
  }

  private spawnInitialFood(count: number): void {
    for (let i = 0; i < count; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    // Random position, avoiding center (colony area) and edges
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const minDistFromCenter = 200;
    const margin = 50; // Keep food away from edges so ants can reach it

    let position: Vector2;
    do {
      position = {
        x: margin + Math.random() * (this.worldWidth - 2 * margin),
        y: margin + Math.random() * (this.worldHeight - 2 * margin),
      };

      const dx = position.x - centerX;
      const dy = position.y - centerY;
      const distFromCenter = Math.sqrt(dx * dx + dy * dy);

      if (distFromCenter >= minDistFromCenter) {
        break;
      }
    } while (true);

    const food = new FoodSource(position, 50 + Math.random() * 50); // 50-100 food per source
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
