import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2 } from './types';
import { Ant } from './Ant';
import { PheromoneGrid } from './PheromoneGrid';

export class Colony implements Entity {
  public position: Vector2;
  public sprite: Container;
  public foodStored: number = 20; // Start with some food
  public ants: Ant[] = [];
  public generation: number = 1;
  public foodSinceLastSpawn: number = 0; // Track food collected for spawning

  private graphics: Graphics;
  private pheromoneGrid: PheromoneGrid;
  private worldContainer: Container | null = null;
  private worldWidth: number = 8000;
  private worldHeight: number = 8000;

  constructor(position: Vector2, pheromoneGrid: PheromoneGrid, initialAnts: number = 20, worldWidth: number = 8000, worldHeight: number = 8000) {
    this.position = { ...position };
    this.pheromoneGrid = pheromoneGrid;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

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

    // Colony nest
    this.graphics.circle(0, 0, 30);
    this.graphics.fill({ color: 0x8b4513, alpha: 0.9 }); // Brown

    // Inner circle
    this.graphics.circle(0, 0, 20);
    this.graphics.fill({ color: 0x654321, alpha: 0.9 });

    // Entrance
    this.graphics.circle(0, 0, 10);
    this.graphics.fill({ color: 0x000000, alpha: 0.8 });
  }

  private spawnAnt(parentBrain?: any): void {
    if (!this.worldContainer) {
      console.warn('Cannot spawn ant: worldContainer not set');
      return;
    }

    // Random position around colony
    const angle = Math.random() * Math.PI * 2;
    const distance = 35;
    const spawnPos = {
      x: this.position.x + Math.cos(angle) * distance,
      y: this.position.y + Math.sin(angle) * distance,
    };

    const ant = new Ant(spawnPos, this.position, this.pheromoneGrid, parentBrain, this.worldWidth, this.worldHeight);
    this.ants.push(ant);
    this.worldContainer.addChild(ant.sprite);
  }

  public update(deltaTime: number, foodSources?: any[]): void {
    // Spawn new ant every 10 food collected, costs 10 food
    if (this.foodSinceLastSpawn >= 10 && this.foodStored >= 10) {
      this.foodSinceLastSpawn = 0;
      this.foodStored -= 10; // Spawning costs food

      // Choose a successful ant to reproduce from
      const successfulAnt = this.getSuccessfulAnt();
      if (successfulAnt) {
        this.spawnAnt(successfulAnt.cloneBrain());
      } else {
        this.spawnAnt(); // Random if no successful ants yet
      }
    }

    // Update all ants
    for (let i = this.ants.length - 1; i >= 0; i--) {
      const ant = this.ants[i];
      ant.update(deltaTime, foodSources);

      // Remove dead ants
      if (!ant.isAlive()) {
        // Debug: log why ant died
        if (ant.energy <= 0) {
          console.log(`Ant died of starvation after ${Math.floor(ant.age)} ticks`);
        }
        ant.destroy();
        this.ants.splice(i, 1);
        continue;
      }

      // Check if ant returned to colony with food
      if (ant.checkColonyReturn(50)) {
        this.foodStored += 1;
        this.foodSinceLastSpawn += 1;
      }
    }

    // Check for generation advancement (only when population is too large)
    if (this.ants.length > 500) {
      this.advanceGeneration();
    }
  }

  private getSuccessfulAnt(): Ant | null {
    // Find ant that has delivered the most food (inferred by lowest age and still alive)
    // For simplicity, we'll pick a random living ant with decent energy
    const successfulAnts = this.ants.filter(ant => ant.energy > 50 && ant.age > 200);

    if (successfulAnts.length > 0) {
      return successfulAnts[Math.floor(Math.random() * successfulAnts.length)];
    }

    return null;
  }

  private advanceGeneration(): void {
    // Natural selection - remove weakest ants
    console.log(`Generation ${this.generation} → ${this.generation + 1}: Culling ${this.ants.length} ants down to top 50%`);

    this.ants.sort((a, b) => b.energy - a.energy);

    // Keep top 50%
    const keepCount = Math.floor(this.ants.length / 2);
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
