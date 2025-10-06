import { Container, Sprite, Texture } from 'pixi.js';
import { Entity, Vector2, AntRole, AntState } from './types';
import { Ant, AntTraits, createDefaultTraits, mutateTraits, copyTraits } from './Ant';
import { PheromoneGrid } from './PheromoneGrid';
import { Metrics } from './Metrics';
import { colonyMoundTexture } from './Game';
import * as CONFIG from './config';

/** Gene pool entry - tracks traits and their success weight */
interface GenePoolEntry {
  traits: AntTraits;
  weight: number; // Based on food delivered
}

export class Colony implements Entity {
  public position: Vector2;
  public sprite: Container;
  public foodStored: number = CONFIG.COLONY_STARTING_FOOD;
  public ants: Ant[] = [];
  public generation: number = 1;
  public kills: number = 0; // Track enemy ants killed

  private moundSprite: Sprite | null = null;
  private pheromoneGrid: PheromoneGrid;
  private worldContainer: Container | null = null;
  private worldWidth: number = 8000;
  private worldHeight: number = 8000;
  private metrics: Metrics | null = null;

  // Gene pool for evolution
  private genePool: GenePoolEntry[] = [];
  private readonly MAX_GENE_POOL_SIZE = 100; // Keep pool from growing forever

  // Sprite textures for this colony's ants
  private foragerTextures: Texture[] | null = null;
  private scoutTextures: Texture[] | null = null;

  constructor(
    position: Vector2,
    pheromoneGrid: PheromoneGrid,
    initialAnts: number = 20,
    worldWidth: number = 8000,
    worldHeight: number = 8000,
    metrics?: Metrics,
    foragerTextures?: Texture[] | null,
    scoutTextures?: Texture[] | null
  ) {
    this.position = { ...position };
    this.pheromoneGrid = pheromoneGrid;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.metrics = metrics || null;
    this.foragerTextures = foragerTextures || null;
    this.scoutTextures = scoutTextures || null;

    // Seed gene pool with some initial diversity
    this.seedGenePool();

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

  /** Seed gene pool with baseline genes - all ants start equal */
  private seedGenePool(): void {
    // Start with ONE baseline entry - all traits at 1.0x (average)
    // Evolution will occur purely through mutations
    this.genePool.push({
      traits: createDefaultTraits(), // All 1.0x
      weight: 1.0
    });
  }

  public setWorldContainer(container: Container): void {
    this.worldContainer = container;
    // Spawn initial ants with NO MUTATION (pure baseline)
    console.log(`Spawning ${this.initialAnts} initial ants with baseline traits (no mutations)`);
    for (let i = 0; i < this.initialAnts; i++) {
      this.spawnAnt(undefined, true); // true = skip mutation for initial population
    }
    console.log('Initial population spawned - all should have 1.0x traits');
  }

  private spawnAnt(role?: AntRole, skipMutation: boolean = false): void {
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

    // Sample traits from gene pool (with or without mutation)
    const traits = skipMutation ? createDefaultTraits() : this.sampleGenePool();

    // Debug: verify initial ants have baseline traits
    if (skipMutation && this.ants.length < 3) {
      console.log(`Initial ant ${this.ants.length + 1} traits:`, traits);
    }

    const ant = new Ant(
      spawnPos,
      this.position,
      this.pheromoneGrid,
      this.worldWidth,
      this.worldHeight,
      antRole,
      traits,
      this.foragerTextures,
      this.scoutTextures,
      () => this.recordKill() // Kill callback
    );
    this.ants.push(ant);
    this.worldContainer.addChild(ant.sprite);
  }

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any, viewportBounds?: { x: number; y: number; width: number; height: number }, enemyAnts?: Ant[]): void {
    // Spawn new ant when enough food stored
    if (this.foodStored >= CONFIG.FOOD_COST_TO_SPAWN) {
      this.foodStored -= CONFIG.FOOD_COST_TO_SPAWN;
      this.spawnAnt();
    }

    // Update all ants every frame
    for (let i = this.ants.length - 1; i >= 0; i--) {
      const ant = this.ants[i];
      ant.update(deltaTime, foodSources, obstacleManager, enemyAnts);

      // Viewport culling - hide ants outside visible area (with padding for smooth transitions)
      if (viewportBounds) {
        const padding = 200; // Extra padding to prevent pop-in at screen edges
        const inView = ant.position.x >= viewportBounds.x - padding &&
                       ant.position.x <= viewportBounds.x + viewportBounds.width + padding &&
                       ant.position.y >= viewportBounds.y - padding &&
                       ant.position.y <= viewportBounds.y + viewportBounds.height + padding;
        ant.sprite.visible = inView;
      }

      // Remove dead ants and add their genes to pool based on lifetime performance
      if (!ant.isAlive()) {
        // Add ant's traits to gene pool weighted by TOTAL food delivered over lifetime
        // This creates true selective pressure: fast ants make more trips, efficient ants live longer
        if (ant.foodDelivered > 0) {
          this.addToGenePool(ant.traits, ant.foodDelivered);
        }
        ant.destroy();
        this.ants.splice(i, 1);
        continue;
      }

      // Check if ant returned to colony with food
      const deliveredAmount = ant.checkColonyReturn(CONFIG.COLONY_RETURN_RADIUS);
      if (deliveredAmount > 0) {
        this.foodStored += deliveredAmount;

        // Track food delivered for gene pool weighting (accumulated over lifetime)
        ant.foodDelivered += deliveredAmount;

        // Successful ants retire after delivering significant food (add genes to pool)
        // This ensures genes enter the pool from successful ants, not just dead ones
        if (ant.foodDelivered >= 10) { // Retire after 10 units delivered (5-10 trips)
          this.addToGenePool(ant.traits, ant.foodDelivered);
          // Reset counter so they can contribute again later
          ant.foodDelivered = 0;
        }

        // Record metrics
        if (this.metrics) {
          const tripDistance = Math.sqrt(
            (ant.position.x - this.position.x) ** 2 + (ant.position.y - this.position.y) ** 2
          );
          this.metrics.recordTrip(tripDistance);
          this.metrics.recordFoodDelivery(deliveredAmount);
        }
      }

      // Check if low-energy ant reached colony to eat
      if (ant.energy < CONFIG.ANT_LOW_ENERGY_THRESHOLD && ant.state === AntState.FORAGING) {
        const dx = ant.position.x - this.position.x;
        const dy = ant.position.y - this.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < CONFIG.COLONY_RETURN_RADIUS && this.foodStored >= 1) {
          // Ant eats from colony stores
          const foodToEat = Math.min(1, this.foodStored); // Eat 1 unit
          this.foodStored -= foodToEat;
          ant.energy = Math.min(ant.energyCapacity, ant.energy + CONFIG.ANT_ENERGY_FROM_COLONY);
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

    // Add culled ants' genes to pool based on their lifetime performance
    for (let i = keepCount; i < this.ants.length; i++) {
      const ant = this.ants[i];
      if (ant.foodDelivered > 0) {
        this.addToGenePool(ant.traits, ant.foodDelivered);
      }
      ant.destroy();
    }

    this.ants = this.ants.slice(0, keepCount);

    this.generation++;
  }

  public getAntCount(): number {
    return this.ants.length;
  }

  public recordKill(): void {
    this.kills++;
  }

  /** Add traits to gene pool with performance-based weighting */
  private addToGenePool(traits: AntTraits, weight: number): void {
    this.genePool.push({
      traits: copyTraits(traits),
      weight: weight
    });

    // Trim gene pool if it gets too large (keep most recent entries)
    if (this.genePool.length > this.MAX_GENE_POOL_SIZE) {
      this.genePool.shift(); // Remove oldest entry
    }
  }

  /** Sample traits from gene pool (weighted random selection with mutation) */
  private sampleGenePool(): AntTraits {
    // If gene pool is empty, return default traits
    if (this.genePool.length === 0) {
      return createDefaultTraits();
    }

    // Calculate total weight
    const totalWeight = this.genePool.reduce((sum, entry) => sum + entry.weight, 0);

    // Weighted random selection
    const random = Math.random() * totalWeight;
    let cumulative = 0;

    for (const entry of this.genePool) {
      cumulative += entry.weight;
      if (random <= cumulative) {
        // Found the selected traits - apply mutation and return
        const mutated = mutateTraits(entry.traits, CONFIG.MUTATION_RATE);

        // Debug: log first 5 spawns to verify mutation diversity
        if (this.ants.length < 5 && this.ants.length >= CONFIG.INITIAL_ANT_COUNT) {
          console.log(`Offspring ${this.ants.length - CONFIG.INITIAL_ANT_COUNT + 1} traits:`, mutated);
        }

        return mutated;
      }
    }

    // Fallback (shouldn't reach here)
    return mutateTraits(this.genePool[this.genePool.length - 1].traits, 0.005);
  }

  /** Get average traits of current population (for UI display) */
  public getAverageTraits(): AntTraits {
    if (this.ants.length === 0) {
      return createDefaultTraits();
    }

    const sum = this.ants.reduce((acc, ant) => ({
      speedMultiplier: acc.speedMultiplier + ant.traits.speedMultiplier,
      visionMultiplier: acc.visionMultiplier + ant.traits.visionMultiplier,
      efficiencyMultiplier: acc.efficiencyMultiplier + ant.traits.efficiencyMultiplier,
      carryMultiplier: acc.carryMultiplier + ant.traits.carryMultiplier
    }), { speedMultiplier: 0, visionMultiplier: 0, efficiencyMultiplier: 0, carryMultiplier: 0 });

    const averages = {
      speedMultiplier: sum.speedMultiplier / this.ants.length,
      visionMultiplier: sum.visionMultiplier / this.ants.length,
      efficiencyMultiplier: sum.efficiencyMultiplier / this.ants.length,
      carryMultiplier: sum.carryMultiplier / this.ants.length
    };

    return averages;
  }

  /** Get percentage of ants with evolved traits (>1.0) */
  public getEvolvedPercentages(): { speed: number, vision: number, efficiency: number, carry: number } {
    if (this.ants.length === 0) {
      return { speed: 0, vision: 0, efficiency: 0, carry: 0 };
    }

    const counts = this.ants.reduce((acc, ant) => ({
      speed: acc.speed + (ant.traits.speedMultiplier > 1.0 ? 1 : 0),
      vision: acc.vision + (ant.traits.visionMultiplier > 1.0 ? 1 : 0),
      efficiency: acc.efficiency + (ant.traits.efficiencyMultiplier > 1.0 ? 1 : 0),
      carry: acc.carry + (ant.traits.carryMultiplier > 1.0 ? 1 : 0)
    }), { speed: 0, vision: 0, efficiency: 0, carry: 0 });

    return {
      speed: Math.round((counts.speed / this.ants.length) * 100),
      vision: Math.round((counts.vision / this.ants.length) * 100),
      efficiency: Math.round((counts.efficiency / this.ants.length) * 100),
      carry: Math.round((counts.carry / this.ants.length) * 100)
    };
  }

  public destroy(): void {
    this.ants.forEach(ant => ant.destroy());
    this.sprite.destroy();
  }
}
