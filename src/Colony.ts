import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2, AntRole } from './types';
import { Ant } from './Ant';
import { PheromoneGrid } from './PheromoneGrid';
import { Metrics } from './Metrics';
import * as CONFIG from './config';

export class Colony implements Entity {
  public position: Vector2;
  public sprite: Container;
  public foodStored: number = CONFIG.COLONY_STARTING_FOOD;
  public ants: Ant[] = [];
  public generation: number = 1;
  public foodSinceLastSpawn: number = 0; // Track food collected for spawning

  private graphics: Graphics;
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
    this.graphics = new Graphics();
    this.sprite.addChild(this.graphics);
    this.renderColony();

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

  private renderColony(): void {
    this.graphics.clear();

    // Draw ant mound with gray/red soil appearance (distinct from brown food)
    const outerRadius = CONFIG.COLONY_OUTER_RADIUS;
    const midRadius = CONFIG.COLONY_MIDDLE_RADIUS;
    const innerRadius = CONFIG.COLONY_ENTRANCE_RADIUS;

    // Base mound (irregular shape using multiple overlapping circles for texture)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const offset = outerRadius * 0.15;
      const x = Math.cos(angle) * offset;
      const y = Math.sin(angle) * offset;
      this.graphics.circle(x, y, outerRadius * 0.9);
      this.graphics.fill({ color: 0xA0826D, alpha: 0.3 }); // Light grayish-brown
    }

    // Main mound body - reddish clay/soil
    this.graphics.circle(0, 0, outerRadius);
    this.graphics.fill({ color: 0xC04000, alpha: 0.95 }); // Burnt orange/red clay

    // Mid layer - darker red clay
    this.graphics.circle(0, 0, midRadius);
    this.graphics.fill({ color: 0xA03000, alpha: 0.9 }); // Dark red clay

    // Add some texture spots (small dirt/pebble patches)
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
      const dist = midRadius * 0.5 + Math.random() * midRadius * 0.4;
      const x = Math.cos(angle) * dist;
      const y = Math.sin(angle) * dist;
      const size = 3 + Math.random() * 4;
      this.graphics.circle(x, y, size);
      this.graphics.fill({ color: 0x8B7355, alpha: 0.7 }); // Grayish soil spots
    }

    // Entrance holes (multiple tunnels)
    const entrances = [
      { x: 0, y: 0, r: innerRadius },
      { x: innerRadius * 0.8, y: innerRadius * 0.5, r: innerRadius * 0.6 },
      { x: -innerRadius * 0.7, y: innerRadius * 0.6, r: innerRadius * 0.5 },
    ];

    for (const entrance of entrances) {
      // Dark entrance with rim
      this.graphics.circle(entrance.x, entrance.y, entrance.r * 1.2);
      this.graphics.fill({ color: 0x602010, alpha: 0.9 }); // Dark reddish rim

      this.graphics.circle(entrance.x, entrance.y, entrance.r);
      this.graphics.fill({ color: 0x000000, alpha: 0.95 }); // Black hole
    }

    // Add highlight for 3D effect - lighter orange
    this.graphics.circle(-outerRadius * 0.3, -outerRadius * 0.3, outerRadius * 0.3);
    this.graphics.fill({ color: 0xFF6B35, alpha: 0.3 }); // Bright orange highlight
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
    // Spawn new ant when enough food collected
    if (this.foodSinceLastSpawn >= CONFIG.FOOD_TO_SPAWN_ANT && this.foodStored >= CONFIG.FOOD_COST_TO_SPAWN) {
      this.foodSinceLastSpawn = 0;
      this.foodStored -= CONFIG.FOOD_COST_TO_SPAWN; // Spawning costs food

      // Spawn new ant (role determined by SCOUT_SPAWN_RATIO)
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
        this.foodSinceLastSpawn += deliveredAmount;

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
