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
  generation: number; // Generation of the ant that contributed these genes
}

/** Colony-level genome - strategic traits that define colony behavior */
export interface ColonyGenome {
  scoutRatio: number;        // 0.05-0.60 - Percentage of new spawns that are scouts
  aggression: number;        // 0.0-1.0 - How likely to pursue enemies (future use)
  explorationRange: number;  // 0.5-2.0 - Scout distance multiplier (future use)
}

export class Colony implements Entity {
  public position: Vector2;
  public sprite: Container;
  public foodStored: number = CONFIG.COLONY_STARTING_FOOD;
  public ants: Ant[] = [];
  public generation: number = 1;
  public kills: number = 0; // Track enemy ants killed

  // Crisis evolution tracking
  private peakPopulation: number = 0; // Track highest population ever reached
  public crisisBonus: number = 0; // Stacking stat bonus (0-3 for +0% to +30%)

  // Colony-level genome (strategic evolution)
  public genome: ColonyGenome;

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

    // Initialize colony genome with baseline values
    this.genome = {
      scoutRatio: 0.20,        // Start at 20% scouts (old hardcoded value)
      aggression: 0.5,         // Neutral starting aggression
      explorationRange: 1.0    // Normal exploration range
    };

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
      weight: 1.0,
      generation: 1 // Founders are Gen 1
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

    // Determine role: if not specified, use colony's evolved scout ratio
    const antRole = role || (Math.random() < this.genome.scoutRatio ? AntRole.SCOUT : AntRole.FORAGER);

    // Sample traits from gene pool (with or without mutation)
    let traits = skipMutation ? createDefaultTraits() : this.sampleGenePool(antRole);

    // Apply crisis bonuses to stats (additive bonuses)
    if (this.crisisBonus > 0 && !skipMutation) {
      const bonusMultiplier = 1 + (this.crisisBonus * CONFIG.CRISIS_STAT_BONUS_PER_STACK);
      traits = {
        speedMultiplier: Math.min(CONFIG.TRAIT_MAX, traits.speedMultiplier * bonusMultiplier),
        visionMultiplier: Math.min(CONFIG.TRAIT_MAX, traits.visionMultiplier * bonusMultiplier),
        efficiencyMultiplier: Math.min(CONFIG.TRAIT_MAX, traits.efficiencyMultiplier * bonusMultiplier),
        carryMultiplier: Math.min(CONFIG.TRAIT_MAX, traits.carryMultiplier * bonusMultiplier),
        maxHealthMultiplier: Math.min(CONFIG.TRAIT_MAX, traits.maxHealthMultiplier * bonusMultiplier),
        dpsMultiplier: Math.min(CONFIG.TRAIT_MAX, traits.dpsMultiplier * bonusMultiplier),
        healthRegenMultiplier: Math.min(CONFIG.TRAIT_MAX, traits.healthRegenMultiplier * bonusMultiplier)
      };
    }

    // Mutate colony genome on every spawn (continuous evolution)
    if (!skipMutation) {
      const scoutRatioMutation = (Math.random() - 0.5) * 0.01; // ±0.5% per spawn
      const aggressionMutation = (Math.random() - 0.5) * 0.02; // ±1% per spawn
      const explorationMutation = (Math.random() - 0.5) * 0.02; // ±1% per spawn

      this.genome.scoutRatio = Math.max(0.05, Math.min(0.60, this.genome.scoutRatio + scoutRatioMutation));
      this.genome.aggression = Math.max(0.0, Math.min(1.0, this.genome.aggression + aggressionMutation));
      this.genome.explorationRange = Math.max(0.5, Math.min(2.0, this.genome.explorationRange + explorationMutation));
    }

    // Debug: verify initial ants have baseline traits
    if (skipMutation && this.ants.length < 3) {
      console.log(`Initial ant ${this.ants.length + 1} traits:`, traits);
    }

    // Determine generation: founders are Gen 1, offspring inherit from gene pool
    const antGeneration = skipMutation ? 1 : this.getNextGeneration();

    // Debug: log when spawning gen 2+ ants
    if (antGeneration >= 2 && !skipMutation) {
      console.log(`🌟 Spawned Gen ${antGeneration} ${antRole === AntRole.SCOUT ? 'Scout' : 'Forager'} (Total: ${this.ants.length + 1} ants)`);
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
      () => this.recordKill(), // Kill callback
      antGeneration // Hereditary generation (lineage distance from founders)
    );
    this.ants.push(ant);
    this.worldContainer.addChild(ant.sprite);

    // Update colony's generation tracking (for UI display - shows highest generation)
    if (antGeneration > this.generation) {
      this.generation = antGeneration;
    }
  }

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any, viewportBounds?: { x: number; y: number; width: number; height: number }, enemyAnts?: Ant[]): void {
    // Track peak population
    const currentPopulation = this.ants.length;
    if (currentPopulation > this.peakPopulation) {
      this.peakPopulation = currentPopulation;
    }

    // Crisis evolution: Check if colony is in crisis (below 30% of peak)
    const crisisThreshold = this.peakPopulation * CONFIG.CRISIS_POPULATION_THRESHOLD;
    const inCrisis = currentPopulation < crisisThreshold && this.peakPopulation >= 10; // Only trigger if we had at least 10 ants

    if (inCrisis && this.crisisBonus < CONFIG.CRISIS_MAX_BONUS_STACKS) {
      // Increase crisis bonus (gradually, not instantly)
      // Check every ~5 seconds if still in crisis
      if (Math.random() < 0.001) { // ~6% chance per second at 60fps
        this.crisisBonus = Math.min(CONFIG.CRISIS_MAX_BONUS_STACKS, this.crisisBonus + 1);
      }
    } else if (!inCrisis && this.crisisBonus > 0) {
      // Recovered from crisis - slowly reduce bonus
      if (Math.random() < 0.0005) { // ~3% chance per second at 60fps
        this.crisisBonus = Math.max(0, this.crisisBonus - 1);
      }
    }

    // Spawn new ant when enough food stored (cost scales with population)
    const foodCost = this.calculateFoodCost();
    if (this.foodStored >= foodCost) {
      const beforeFood = this.foodStored;
      this.foodStored -= foodCost;
      this.spawnAnt();
      console.log(`👶 SPAWNED ant | Pop: ${this.ants.length} | Cost: ${foodCost} | Food: ${beforeFood.toFixed(1)} → ${this.foodStored.toFixed(1)}`);
    }

    // Update all ants every frame
    for (let i = this.ants.length - 1; i >= 0; i--) {
      const ant = this.ants[i];
      ant.update(deltaTime, foodSources, obstacleManager, enemyAnts, this.ants);

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
          this.addToGenePool(ant.traits, ant.foodDelivered, ant.generation);
        }
        ant.destroy();
        this.ants.splice(i, 1);
        continue;
      }

      // Check if ant returned to colony with food
      const deliveredAmount = ant.checkColonyReturn(CONFIG.COLONY_RETURN_RADIUS);
      if (deliveredAmount > 0) {
        this.foodStored += deliveredAmount;

        // Debug logging
        if (Math.random() < 0.02) { // Log 2% of deliveries
          const foodCost = this.calculateFoodCost();
          console.log(`🍎 +${deliveredAmount} food | Stored: ${this.foodStored.toFixed(1)} | Cost to spawn: ${foodCost} | Pop: ${this.ants.length}`);
        }

        // Track food delivered for gene pool weighting (accumulated over lifetime)
        ant.foodDelivered += deliveredAmount;

        // Successful ants retire after delivering significant food (add genes to pool)
        // This ensures genes enter the pool from successful ants, not just dead ones
        if (ant.foodDelivered >= 10) { // Retire after 10 units delivered (5-10 trips)
          this.addToGenePool(ant.traits, ant.foodDelivered, ant.generation);
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

    }

    // No artificial culling - let natural selection work through starvation and combat
  }

  private mutateGenome(): void {
    // DEPRECATED: Genome now mutates continuously on every spawn
    // This method kept for reference but no longer called
    // Mutation rates for colony traits
    const scoutRatioMutation = (Math.random() - 0.5) * 0.10; // ±5% per generation
    const aggressionMutation = (Math.random() - 0.5) * 0.20; // ±10% per generation
    const explorationMutation = (Math.random() - 0.5) * 0.20; // ±10% per generation

    // Apply mutations with clamping
    this.genome.scoutRatio = Math.max(0.05, Math.min(0.60, this.genome.scoutRatio + scoutRatioMutation));
    this.genome.aggression = Math.max(0.0, Math.min(1.0, this.genome.aggression + aggressionMutation));
    this.genome.explorationRange = Math.max(0.5, Math.min(2.0, this.genome.explorationRange + explorationMutation));

    console.log(`Gen ${this.generation} Genome Mutation: scoutRatio=${(this.genome.scoutRatio * 100).toFixed(1)}%, aggression=${(this.genome.aggression * 100).toFixed(0)}%, exploration=${this.genome.explorationRange.toFixed(2)}x`);
  }

  public getAntCount(): number {
    return this.ants.length;
  }

  public getForagerCount(): number {
    return this.ants.filter(ant => ant.role === AntRole.FORAGER).length;
  }

  public getScoutCount(): number {
    return this.ants.filter(ant => ant.role === AntRole.SCOUT).length;
  }

  public recordKill(): void {
    this.kills++;
  }

  /** Add traits to gene pool with performance-based weighting */
  private addToGenePool(traits: AntTraits, weight: number, generation: number): void {
    this.genePool.push({
      traits: copyTraits(traits),
      weight: weight,
      generation: generation
    });

    // Trim gene pool if it gets too large (keep most recent entries)
    if (this.genePool.length > this.MAX_GENE_POOL_SIZE) {
      this.genePool.shift(); // Remove oldest entry
    }
  }

  /** Calculate next generation number based on gene pool (max generation + 1) */
  private getNextGeneration(): number {
    if (this.genePool.length === 0) {
      return 1; // First generation
    }
    const maxGeneration = Math.max(...this.genePool.map(entry => entry.generation));
    return maxGeneration + 1;
  }

  /** Calculate food cost to spawn new ant (scales with population) */
  private calculateFoodCost(): number {
    const baseCost = CONFIG.FOOD_COST_TO_SPAWN; // 3
    const population = this.ants.length;
    const hundredsOfAnts = Math.floor(population / 100);
    // +50% per 100 ants: cost = base * (1.5 ^ hundredsOfAnts)
    return Math.ceil(baseCost * Math.pow(1.5, hundredsOfAnts));
  }

  /** Sample traits from gene pool (weighted random selection with mutation) */
  private sampleGenePool(role: AntRole): AntTraits {
    // If gene pool is empty, return default traits
    if (this.genePool.length === 0) {
      return createDefaultTraits();
    }

    // Calculate total weight
    const totalWeight = this.genePool.reduce((sum, entry) => sum + entry.weight, 0);

    // Weighted random selection
    const random = Math.random() * totalWeight;
    let cumulative = 0;

    // Apply crisis mutation multiplier if in crisis
    const baseMutationRate = role === AntRole.SCOUT ? CONFIG.SCOUT_MUTATION_RATE : CONFIG.FORAGER_MUTATION_RATE;
    const crisisMutationRate = this.crisisBonus > 0
      ? baseMutationRate * CONFIG.CRISIS_MUTATION_MULTIPLIER
      : undefined; // Use default if not in crisis

    for (const entry of this.genePool) {
      cumulative += entry.weight;
      if (random <= cumulative) {
        // Found the selected traits - apply mutation and return (role-specific mutation with crisis bonus)
        const mutated = mutateTraits(entry.traits, role, crisisMutationRate);

        // Debug: log first 5 spawns to verify mutation diversity
        if (this.ants.length < 5 && this.ants.length >= CONFIG.INITIAL_ANT_COUNT) {
          console.log(`Offspring ${this.ants.length - CONFIG.INITIAL_ANT_COUNT + 1} (${role}) traits:`, mutated);
        }

        return mutated;
      }
    }

    // Fallback (shouldn't reach here)
    return mutateTraits(this.genePool[this.genePool.length - 1].traits, role, crisisMutationRate);
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
      carryMultiplier: acc.carryMultiplier + ant.traits.carryMultiplier,
      maxHealthMultiplier: acc.maxHealthMultiplier + ant.traits.maxHealthMultiplier,
      dpsMultiplier: acc.dpsMultiplier + ant.traits.dpsMultiplier,
      healthRegenMultiplier: acc.healthRegenMultiplier + ant.traits.healthRegenMultiplier
    }), {
      speedMultiplier: 0,
      visionMultiplier: 0,
      efficiencyMultiplier: 0,
      carryMultiplier: 0,
      maxHealthMultiplier: 0,
      dpsMultiplier: 0,
      healthRegenMultiplier: 0
    });

    const averages = {
      speedMultiplier: sum.speedMultiplier / this.ants.length,
      visionMultiplier: sum.visionMultiplier / this.ants.length,
      efficiencyMultiplier: sum.efficiencyMultiplier / this.ants.length,
      carryMultiplier: sum.carryMultiplier / this.ants.length,
      maxHealthMultiplier: sum.maxHealthMultiplier / this.ants.length,
      dpsMultiplier: sum.dpsMultiplier / this.ants.length,
      healthRegenMultiplier: sum.healthRegenMultiplier / this.ants.length
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
