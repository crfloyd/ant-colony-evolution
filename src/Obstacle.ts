import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2 } from './types';
import * as CONFIG from './config';

export class Obstacle implements Entity {
  public position: Vector2;
  public sprite: Container;
  public width: number;
  public height: number;

  private graphics: Graphics;

  constructor(position: Vector2, width: number, height: number) {
    this.position = { ...position };
    this.width = width;
    this.height = height;

    // Create sprite
    this.sprite = new Container();
    this.graphics = new Graphics();
    this.sprite.addChild(this.graphics);
    this.render();

    this.sprite.x = position.x;
    this.sprite.y = position.y;
  }

  private render(): void {
    this.graphics.clear();

    // Draw obstacle as a gray rectangle
    this.graphics.rect(-this.width / 2, -this.height / 2, this.width, this.height);
    this.graphics.fill({ color: 0x444444, alpha: 0.8 });

    // Add border
    this.graphics.rect(-this.width / 2, -this.height / 2, this.width, this.height);
    this.graphics.stroke({ width: 2, color: 0x666666 });
  }

  public update(deltaTime: number): void {
    // Obstacles are static, no update needed
  }

  public containsPoint(x: number, y: number): boolean {
    const left = this.position.x - this.width / 2;
    const right = this.position.x + this.width / 2;
    const top = this.position.y - this.height / 2;
    const bottom = this.position.y + this.height / 2;

    return x >= left && x <= right && y >= top && y <= bottom;
  }

  public getClosestPointOnEdge(x: number, y: number): Vector2 {
    const left = this.position.x - this.width / 2;
    const right = this.position.x + this.width / 2;
    const top = this.position.y - this.height / 2;
    const bottom = this.position.y + this.height / 2;

    // Clamp point to obstacle bounds
    const clampedX = Math.max(left, Math.min(right, x));
    const clampedY = Math.max(top, Math.min(bottom, y));

    return { x: clampedX, y: clampedY };
  }

  public destroy(): void {
    this.sprite.destroy();
  }
}

export class ObstacleManager {
  private obstacles: Obstacle[] = [];
  private container: Container;
  private worldWidth: number;
  private worldHeight: number;

  constructor(container: Container, worldWidth: number, worldHeight: number) {
    this.container = container;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    this.spawnObstacles();
  }

  private spawnObstacles(): void {
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const minDistFromCenter = CONFIG.OBSTACLE_COLONY_CLEARANCE;

    // Create random obstacles
    const count = CONFIG.MIN_OBSTACLES + Math.floor(Math.random() * (CONFIG.MAX_OBSTACLES - CONFIG.MIN_OBSTACLES + 1));

    for (let i = 0; i < count; i++) {
      let position: Vector2;
      let attempts = 0;

      do {
        const margin = CONFIG.OBSTACLE_SPAWN_MARGIN;
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

        attempts++;
      } while (attempts < CONFIG.OBSTACLE_SPAWN_MAX_ATTEMPTS);

      // Random size
      const width = CONFIG.MIN_OBSTACLE_SIZE + Math.random() * (CONFIG.MAX_OBSTACLE_SIZE - CONFIG.MIN_OBSTACLE_SIZE);
      const height = CONFIG.MIN_OBSTACLE_SIZE + Math.random() * (CONFIG.MAX_OBSTACLE_SIZE - CONFIG.MIN_OBSTACLE_SIZE);

      const obstacle = new Obstacle(position, width, height);
      this.obstacles.push(obstacle);
      this.container.addChild(obstacle.sprite);
    }
  }

  public checkCollision(position: Vector2, radius: number = CONFIG.OBSTACLE_DEFAULT_COLLISION_RADIUS): Obstacle | null {
    for (const obstacle of this.obstacles) {
      // Check if circle (ant) intersects with rectangle (obstacle)
      const closestPoint = obstacle.getClosestPointOnEdge(position.x, position.y);
      const dx = position.x - closestPoint.x;
      const dy = position.y - closestPoint.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < radius * radius) {
        return obstacle;
      }
    }
    return null;
  }

  public getObstacles(): Obstacle[] {
    return this.obstacles;
  }

  public destroy(): void {
    this.obstacles.forEach(obstacle => obstacle.destroy());
  }
}
