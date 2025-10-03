import { Container, Sprite } from 'pixi.js';
import { Entity, Vector2, AntRole } from './types';
import { Ant } from './Ant';
import { PheromoneGrid } from './PheromoneGrid';
import { Metrics } from './Metrics';
import { colonyMoundTexture } from './Game';
import * as CONFIG from './config';

export class Colony implements Entity {
  public position: Vector2;
  public sprite: Container;
  public foodStored: number = CONFIG.COLONY_STARTING_FOOD;
  public ants: Ant[] = [];
  public generation: number = 1;

  private moundSprite: Sprite | null = null;
  private pheromoneGrid: PheromoneGrid;
  private worldContainer: Container | null = null;
  private worldWidth: number = 8000;
  private worldHeight: number = 8000;
  private metrics: Metrics | null = null;

  constructor(position: Vector2, pheromoneGrid: PheromoneGrid, initialAnts: number = 20, worldWidth: number = 8000, worldHeight: number = 8000, metrics?: Metrics) {
    this.position = { ...position };
    this.pheromoneGrid = pheromoneGrid;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.metrics = metrics || null;

    // Create sprite
    this.sprite = new Container();

    // Use the mound sprite
    this.moundSprite = new Sprite(colonyMoundTexture);
    this.moundSprite.anchor.set(0.5); // Center the sprite

    // Scale to match CONFIG.COLONY_OUTER_RADIUS (mound diameter = 2 * radius)
    const desiredSize = CONFIG.COLONY_OUTER_RADIUS * 2;
    const scale = desiredSize / Math.max(colonyMoundTexture.width, colonyMoundTexture.height);
    this.moundSprite.scale.set(scale);

    this.sprite.addChild(this.moundSprite);
    this.sprite.x = position.x;
    this.sprite.y = position.y;

    // Spawn initial ants (deferred until setWorldContainer is called)
    // Store initial ant count for later
    this.initialAnts = initialAnts;
  }

  private initialAnts: number = 0;

  public setWorldContainer(container: Container): void {
    this.worldContainer = container;
    // Now spawn initial ants
    for (let i = 0; i < this.initialAnts; i++) {
      this.spawnAnt();
    }
  }

  private spawnAnt(role?: AntRole): void {
    if (!this.worldContainer) {
      console.warn('Cannot spawn ant: worldContainer not set');
      return;
    }

    // Random position around colony
    const angle = Math.random() * Math.PI * 2;
    const distance = CONFIG.ANT_SPAWN_DISTANCE;
    const spawnPos = {
      x: this.position.x + Math.cos(angle) * distance,
      y: this.position.y + Math.sin(angle) * distance,
    };

    // Determine role: if not specified, use CONFIG.SCOUT_SPAWN_RATIO
    const antRole = role || (Math.random() < CONFIG.SCOUT_SPAWN_RATIO ? AntRole.SCOUT : AntRole.FORAGER);

    const ant = new Ant(spawnPos, this.position, this.pheromoneGrid, this.worldWidth, this.worldHeight, antRole);
    this.ants.push(ant);
    this.worldContainer.addChild(ant.sprite);
  }

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // Spawn new ant when enough food stored
    if (this.foodStored >= CONFIG.FOOD_COST_TO_SPAWN) {
      this.foodStored -= CONFIG.FOOD_COST_TO_SPAWN;
      this.spawnAnt();
    }

    // Update all ants every frame
    for (let i = this.ants.length - 1; i >= 0; i--) {
      const ant = this.ants[i];
      ant.update(deltaTime, foodSources, obstacleManager);

      // Remove dead ants
      if (!ant.isAlive()) {
        ant.destroy();
        this.ants.splice(i, 1);
        continue;
      }

      // Check if ant returned to colony with food
      const deliveredAmount = ant.checkColonyReturn(CONFIG.COLONY_RETURN_RADIUS);
      if (deliveredAmount > 0) {
        this.foodStored += deliveredAmount;

        // Record metrics
        if (this.metrics) {
          const tripDistance = Math.sqrt(
            (ant.position.x - this.position.x) ** 2 + (ant.position.y - this.position.y) ** 2
          );
          this.metrics.recordTrip(tripDistance);
          this.metrics.recordFoodDelivery(deliveredAmount);
        }
      }
    }

    // Check for generation advancement (only when population is too large)
    if (this.ants.length > CONFIG.MAX_ANT_COUNT) {
      this.advanceGeneration();
    }
  }

  private advanceGeneration(): void {
    // Natural selection - remove weakest ants
    console.log(`Generation ${this.generation} → ${this.generation + 1}: Culling ${this.ants.length} ants down to top 50%`);

    this.ants.sort((a, b) => b.energy - a.energy);

    // Keep top survivors based on config ratio
    const keepCount = Math.floor(this.ants.length * CONFIG.GENERATION_SURVIVAL_RATIO);
    for (let i = keepCount; i < this.ants.length; i++) {
      this.ants[i].destroy();
    }
    this.ants = this.ants.slice(0, keepCount);

    this.generation++;
  }

  public getAntCount(): number {
    return this.ants.length;
  }

  public destroy(): void {
    this.ants.forEach(ant => ant.destroy());
    this.sprite.destroy();
  }
}
