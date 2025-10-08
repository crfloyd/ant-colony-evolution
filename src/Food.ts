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

  // Guard tracking (Phase 1.2: Food Source Guard Tracking)
  private guardsPresent: any[] = []; // Array of Ant references (using any to avoid circular dependency)
  private scoutsTagging: any[] = []; // Scouts currently in TAGGING_FOOD state for this food
  public lastForagerVisit: number = 0; // Timestamp of last forager visit
  public claimedByColony: any | null = null; // Colony that claimed this food (using any to avoid circular dependency)

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

  // Guard tracking methods (Phase 1.2)
  public registerGuard(ant: any): void {
    // Only allow guards from the same colony as the one that claimed the food (compare by position)
    if (this.claimedByColony && ant.colony) {
      const isSameColony = this.claimedByColony.x === ant.colony.x && this.claimedByColony.y === ant.colony.y;
      if (!isSameColony) {
        return; // Enemy colony, don't register
      }
    }

    if (!this.guardsPresent.includes(ant)) {
      this.guardsPresent.push(ant);
      // First guard claims the food if not already claimed by taggers
      if (!this.claimedByColony && ant.colony) {
        this.claimedByColony = ant.colony;
      }
    }
  }

  public unregisterGuard(ant: any): void {
    const index = this.guardsPresent.indexOf(ant);
    if (index !== -1) {
      this.guardsPresent.splice(index, 1);
    }
    // If no guards AND no taggers left, unclaim the food
    if (this.guardsPresent.length === 0 && this.scoutsTagging.length === 0) {
      this.claimedByColony = null;
    }
  }

  public getGuardCount(): number {
    return this.guardsPresent.length;
  }

  public getEnemyCount(colony: any): number {
    // Count guards from different colonies
    return this.guardsPresent.filter(guard => guard.colony !== colony).length;
  }

  public getGuards(): any[] {
    return [...this.guardsPresent]; // Return copy to prevent external modification
  }

  public updateLastForagerVisit(timestamp: number): void {
    this.lastForagerVisit = timestamp;
  }

  // Tagger tracking methods (limit scouts tagging same food)
  // Returns true if registered successfully, false if already at max or enemy colony
  public registerTagger(ant: any): boolean {
    // First tagger claims the food for their colony
    if (this.scoutsTagging.length === 0 && ant.colony) {
      this.claimedByColony = ant.colony;
    }

    // Check if food is claimed by enemy colony (compare by position coordinates)
    if (this.claimedByColony && ant.colony) {
      const isSameColony = this.claimedByColony.x === ant.colony.x && this.claimedByColony.y === ant.colony.y;
      if (!isSameColony) {
        return false; // Enemy colony owns this food
      }
    }

    // Count taggers from the same colony only (compare by position coordinates)
    const friendlyTaggers = this.scoutsTagging.filter(tagger =>
      tagger.colony && ant.colony &&
      tagger.colony.x === ant.colony.x &&
      tagger.colony.y === ant.colony.y
    );

    if (friendlyTaggers.length >= CONFIG.SCOUT_MAX_TAGGERS_PER_FOOD) {
      return false; // At capacity for this colony
    }

    if (!this.scoutsTagging.includes(ant)) {
      this.scoutsTagging.push(ant);
    }
    return true; // Successfully registered
  }

  public unregisterTagger(ant: any): void {
    const index = this.scoutsTagging.indexOf(ant);
    if (index !== -1) {
      this.scoutsTagging.splice(index, 1);
    }
    // If no taggers AND no guards left, unclaim the food
    if (this.scoutsTagging.length === 0 && this.guardsPresent.length === 0) {
      this.claimedByColony = null;
    }
  }

  public getTaggingCount(): number {
    return this.scoutsTagging.length;
  }

  public getTaggers(): any[] {
    return [...this.scoutsTagging]; // Return copy to prevent external modification
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
  private getColonyPositions: () => Vector2[];

  constructor(container: Container, worldWidth: number, worldHeight: number, obstacleManager?: any, pheromoneGrid?: any, getColonySize?: () => number, getColonyPositions?: () => Vector2[]) {
    this.container = container;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.obstacleManager = obstacleManager;
    this.pheromoneGrid = pheromoneGrid;
    this.getColonySize = getColonySize || (() => 0);
    this.getColonyPositions = getColonyPositions || (() => []);

    // Spawn initial food sources
    this.spawnInitialFood(CONFIG.INITIAL_FOOD_SOURCES);
  }

  private spawnInitialFood(count: number): void {
    for (let i = 0; i < count; i++) {
      this.spawnFood();
    }
  }

  private spawnFood(): void {
    // 65% chance to spawn in center region, 35% chance to spawn anywhere
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const margin = CONFIG.FOOD_SPAWN_MARGIN; // Keep food away from edges so ants can reach it

    // Determine spawn region based on 65% center bias
    const spawnInCenter = Math.random() < 0.65;

    // Center region is 50% of map dimensions (0.25 radius from center = 0.5 total width/height)
    const centerRegionWidth = this.worldWidth * 0.5;
    const centerRegionHeight = this.worldHeight * 0.5;
    const centerMinX = centerX - centerRegionWidth / 2;
    const centerMaxX = centerX + centerRegionWidth / 2;
    const centerMinY = centerY - centerRegionHeight / 2;
    const centerMaxY = centerY + centerRegionHeight / 2;

    let position: Vector2;
    let attempts = 0;

    do {
      if (spawnInCenter) {
        // Spawn in center 50% region
        position = {
          x: centerMinX + Math.random() * centerRegionWidth,
          y: centerMinY + Math.random() * centerRegionHeight,
        };
      } else {
        // Spawn anywhere on map
        position = {
          x: margin + Math.random() * (this.worldWidth - 2 * margin),
          y: margin + Math.random() * (this.worldHeight - 2 * margin),
        };
      }

      // Check if position is valid
      const inObstacle = this.obstacleManager && this.obstacleManager.checkCollision(position, CONFIG.FOOD_SPAWN_OBSTACLE_CHECK_RADIUS);

      // Check distance from all colonies
      const colonyPositions = this.getColonyPositions();
      let tooCloseToColony = false;
      for (const colonyPos of colonyPositions) {
        const dx = position.x - colonyPos.x;
        const dy = position.y - colonyPos.y;
        const distFromColony = Math.sqrt(dx * dx + dy * dy);
        if (distFromColony < CONFIG.FOOD_MIN_DIST_FROM_COLONY) {
          tooCloseToColony = true;
          break;
        }
      }

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

      // Valid if: far enough from all colonies, not in obstacle, not near other food, not in super high pheromone area
      const validDistance = !tooCloseToColony;

      if (validDistance && !inObstacle && !tooCloseToFood && !veryHighPheromone) {
        break;
      }

      attempts++;
      if (attempts > CONFIG.FOOD_SPAWN_MAX_ATTEMPTS_STRICT) {
        // After many attempts, relax pheromone constraint (but still avoid obstacles, colonies, and other food)
        if (!inObstacle && !tooCloseToColony && !tooCloseToFood) {
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
    // Clean up dead/invalid guards and taggers from all food sources (Phase 1.2)
    for (const food of this.foodSources) {
      const guards = food.getGuards();
      for (const guard of guards) {
        // Check if guard is dead or invalid
        if (!guard || guard.energy <= 0 || !guard.isAlive) {
          food.unregisterGuard(guard);
        }
      }

      // Clean up taggers who died or switched to different food
      // Keep them registered even if they're EXPLORING or GUARDING_FOOD (permanent tagger slots)
      const taggers = food.getTaggers();
      for (const tagger of taggers) {
        if (!tagger || tagger.energy <= 0 || !tagger.isAlive ||
            (tagger.guardingFoodId && tagger.guardingFoodId !== food.id)) {
          food.unregisterTagger(tagger);
        }
      }
    }

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
