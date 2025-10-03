import { Graphics, Container, Sprite, Texture } from 'pixi.js';
import { Entity, Vector2 } from './types';
import { rockSpritesLarge, rockSpritesMedium, rockSpritesSmall } from './Game';
import * as CONFIG from './config';

export class Obstacle implements Entity {
  public position: Vector2;
  public sprite: Container;
  public width: number;
  public height: number;
  public radius: number; // Circular collision radius
  public sizeCategory: 'large' | 'medium' | 'small' = 'small'; // Rock size category

  private rockSprite: Sprite | null = null;
  private graphics: Graphics | null = null;
  private debugGraphics: Graphics | null = null;

  constructor(position: Vector2, width: number, height: number, rockTexture?: Texture, rotation: number = 0, sizeCategory?: 'large' | 'medium' | 'small') {
    this.position = { ...position };
    this.width = width;
    this.height = height;
    this.sizeCategory = sizeCategory || 'small';

    // Calculate circular collision radius (average of width/height / 2)
    this.radius = (width + height) / 4;

    // Create sprite
    this.sprite = new Container();
    this.sprite.sortableChildren = true; // Enable z-index sorting for debug graphics

    if (rockTexture) {
      // Use rock sprite
      this.rockSprite = new Sprite(rockTexture);
      this.rockSprite.anchor.set(0.5);

      // Scale to match desired size
      const scale = width / rockTexture.width;
      this.rockSprite.scale.set(scale);

      // Apply random rotation
      this.rockSprite.rotation = rotation;

      this.sprite.addChild(this.rockSprite);
    } else {
      // Fallback to graphics rendering
      this.graphics = new Graphics();
      this.sprite.addChild(this.graphics);
      this.render();
    }

    this.sprite.x = position.x;
    this.sprite.y = position.y;

    // Set z-index based on bottom edge of rock (not center) for proper depth sorting
    // Use radius * 1.5 to account for rock graphics that extend beyond the center point
    // Some sprite cells have the rock graphic positioned lower in the cell
    this.sprite.zIndex = position.y + (this.radius * 1.5);

    // Create debug graphics for collision circle
    this.debugGraphics = new Graphics();
    this.debugGraphics.zIndex = 9999; // Always on top
    this.sprite.addChild(this.debugGraphics);
  }

  public renderDebug(show: boolean): void {
    if (!this.debugGraphics) return;

    this.debugGraphics.clear();

    if (show) {
      // Draw collision circle - bright red, thick line
      this.debugGraphics.circle(0, 0, this.radius);
      this.debugGraphics.stroke({ width: 4, color: 0xff0000, alpha: 1.0 });

      // Draw filled semi-transparent circle
      this.debugGraphics.circle(0, 0, this.radius);
      this.debugGraphics.fill({ color: 0xff0000, alpha: 0.2 });

      // Draw center point - larger
      this.debugGraphics.circle(0, 0, 8);
      this.debugGraphics.fill({ color: 0xffff00, alpha: 1.0 }); // Yellow center
    }
  }

  private render(): void {
    if (!this.graphics) return;
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
    // Circular collision
    const dx = x - this.position.x;
    const dy = y - this.position.y;
    const distSq = dx * dx + dy * dy;
    return distSq < this.radius * this.radius;
  }

  public getClosestPointOnEdge(x: number, y: number): Vector2 {
    // Circular collision - get closest point on circle edge
    const dx = x - this.position.x;
    const dy = y - this.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) {
      // Point is at center, return arbitrary edge point
      return { x: this.position.x + this.radius, y: this.position.y };
    }

    // Normalize and scale to radius
    const nx = dx / dist;
    const ny = dy / dist;

    return {
      x: this.position.x + nx * this.radius,
      y: this.position.y + ny * this.radius,
    };
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

  constructor(
    container: Container,
    worldWidth: number,
    worldHeight: number,
    largeCount?: number,
    mediumCount?: number,
    smallCount?: number,
    largeSpread?: number,
    mediumSpread?: number,
    smallSpread?: number
  ) {
    this.container = container;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    this.spawnObstacles(largeCount, mediumCount, smallCount, largeSpread, mediumSpread, smallSpread);
  }

  private spawnObstacles(
    customLargeCount?: number,
    customMediumCount?: number,
    customSmallCount?: number,
    customLargeSpread?: number,
    customMediumSpread?: number,
    customSmallSpread?: number
  ): void {
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const minDistFromCenter = CONFIG.OBSTACLE_COLONY_CLEARANCE;

    // Gaussian random using Box-Muller transform
    const gaussianRandom = (mean: number, stdDev: number): number => {
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return mean + z0 * stdDev;
    };

    // Distribution: more large rocks, medium amount of medium, lots of small to fill gaps
    const largeCount = customLargeCount ?? 39;
    const mediumCount = customMediumCount ?? 56;
    const smallCount = customSmallCount ?? 134;
    const largeSpread = customLargeSpread ?? 0.8;
    const mediumSpread = customMediumSpread ?? 0.7;
    const smallSpread = customSmallSpread ?? 0.7;

    // Track used sprite indices to ensure variety
    const usedLarge: Set<number> = new Set();
    const usedMedium: Set<number> = new Set();
    const usedSmall: Set<number> = new Set();

    const spawnRockCategory = (
      count: number,
      spriteArray: Texture[],
      usedSet: Set<number>,
      baseSize: number,
      sizeVariation: number,
      isLarge: boolean = false,
      stdDevMultiplier: number = 1.0,
      sizeCategory: 'large' | 'medium' | 'small' = 'small'
    ) => {
      for (let i = 0; i < count; i++) {
        let attempts = 0;
        let position: Vector2;
        let size: number;
        let rockTexture: Texture;
        let rotation: number;

        // 15% chance to be an "outlier" rock (uniform random placement)
        const isOutlier = Math.random() < 0.15;

        do {
          // Pick a sprite (cycle through all, prefer unused)
          let rockIndex: number;
          if (usedSet.size < spriteArray.length) {
            // Pick an unused sprite
            do {
              rockIndex = Math.floor(Math.random() * spriteArray.length);
            } while (usedSet.has(rockIndex));
          } else {
            // All used, pick random
            rockIndex = Math.floor(Math.random() * spriteArray.length);
          }
          usedSet.add(rockIndex);
          rockTexture = spriteArray[rockIndex];

          // Random size with variation
          size = baseSize + (Math.random() - 0.5) * sizeVariation;

          // For large rocks, add random scaling (0-75% size increase)
          if (isLarge) {
            const scaleIncrease = Math.random() * 0.75; // 0% to 75%
            size = size * (1.0 + scaleIncrease);
          }

          // Consistent lighting rotation
          // Original sprite has shadow at bottom-left (sun at top-right = 45°)
          // We define sun at 45° (top-right), so shadows should point at 225° (bottom-left)
          // Original sprite already matches this, so base rotation = 0
          // Add small random variation (±20°) for natural variety
          const sunAngle = Math.PI / 4; // 45° (top-right)
          const originalShadowAngle = (5 * Math.PI) / 4; // 225° (bottom-left)
          const desiredShadowAngle = sunAngle + Math.PI; // Opposite of sun
          const baseRotation = desiredShadowAngle - originalShadowAngle; // 0 for our case
          const randomVariation = (Math.random() - 0.5) * (Math.PI / 4.5); // ±20°
          rotation = baseRotation + randomVariation;

          if (isOutlier) {
            // Outlier: uniform random distribution (simulates rocks that rolled/deposited randomly)
            position = {
              x: Math.random() * this.worldWidth,
              y: Math.random() * this.worldHeight,
            };
          } else {
            // Normal: Gaussian distribution with size-dependent spread
            const baseStdDev = Math.min(this.worldWidth, this.worldHeight) / 2.5;
            const stdDev = baseStdDev * stdDevMultiplier;
            position = {
              x: gaussianRandom(centerX, stdDev),
              y: gaussianRandom(centerY, stdDev),
            };
          }

          // Clamp to world bounds with extra margin (rocks can be rotated and extend beyond base size)
          const halfSize = size / 2;
          const edgeMargin = 100; // Extra margin to prevent clipping at edges
          position.x = Math.max(halfSize + edgeMargin, Math.min(this.worldWidth - halfSize - edgeMargin, position.x));
          position.y = Math.max(halfSize + edgeMargin, Math.min(this.worldHeight - halfSize - edgeMargin, position.y));

          // Check colony clearance
          const dx = position.x - centerX;
          const dy = position.y - centerY;
          const distFromCenter = Math.sqrt(dx * dx + dy * dy);

          if (distFromCenter < minDistFromCenter) {
            attempts++;
            continue;
          }

          // Check overlap with existing obstacles
          const radius = size / 2;
          let overlaps = false;
          for (const obs of this.obstacles) {
            const obsDx = position.x - obs.position.x;
            const obsDy = position.y - obs.position.y;
            const obsDist = Math.sqrt(obsDx * obsDx + obsDy * obsDy);

            // Use larger spacing for same-size rocks, smaller for different sizes
            const sameSize = obs.sizeCategory === sizeCategory;
            const spacingBuffer = sameSize ? 30 : 10; // Same size: 30px, different: 10px
            const minDist = radius + obs.radius + spacingBuffer;

            if (obsDist < minDist) {
              overlaps = true;
              break;
            }
          }

          if (overlaps) {
            attempts++;
            continue;
          }

          // Valid position found
          break;

        } while (attempts < CONFIG.OBSTACLE_SPAWN_MAX_ATTEMPTS);

        if (attempts >= CONFIG.OBSTACLE_SPAWN_MAX_ATTEMPTS) {
          continue; // Skip this rock
        }

        // Create obstacle with rock sprite and rotation
        const obstacle = new Obstacle(position, size, size, rockTexture, rotation, sizeCategory);
        this.obstacles.push(obstacle);
        this.container.addChild(obstacle.sprite);
      }
    };

    // Spawn in order: large, medium, small with varying distributions
    spawnRockCategory(largeCount, rockSpritesLarge, usedLarge, 350, 100, true, largeSpread, 'large');
    spawnRockCategory(mediumCount, rockSpritesMedium, usedMedium, 200, 60, false, mediumSpread, 'medium');
    spawnRockCategory(smallCount, rockSpritesSmall, usedSmall, 120, 40, false, smallSpread, 'small');
  }

  public checkCollision(position: Vector2, radius: number = CONFIG.OBSTACLE_DEFAULT_COLLISION_RADIUS): Obstacle | null {
    for (const obstacle of this.obstacles) {
      // Check if circle (ant) intersects with circle (obstacle)
      const dx = position.x - obstacle.position.x;
      const dy = position.y - obstacle.position.y;
      const distSq = dx * dx + dy * dy;
      const minDist = radius + obstacle.radius;

      if (distSq < minDist * minDist) {
        return obstacle;
      }
    }
    return null;
  }

  public getObstacles(): Obstacle[] {
    return this.obstacles;
  }

  public getRockCounts(): { large: number; medium: number; small: number } {
    const counts = { large: 0, medium: 0, small: 0 };
    for (const obstacle of this.obstacles) {
      counts[obstacle.sizeCategory]++;
    }
    return counts;
  }

  public renderDebug(show: boolean): void {
    for (const obstacle of this.obstacles) {
      obstacle.renderDebug(show);
    }
  }

  public destroy(): void {
    this.obstacles.forEach(obstacle => obstacle.destroy());
  }
}
