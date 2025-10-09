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

  // Performance tracking for genome evolution with selective pressure
  private lastFoodEvaluation: number = 0; // Food stored at last evaluation
  private lastEvaluationTime: number = 0; // Time of last evaluation (simulation time)
  private foodIncomeRate: number = 0; // Food gained per minute
  private lastScoutRatioMutation: number = 0; // Track last mutation direction
  private lastAggressionMutation: number = 0;
  private lastExplorationMutation: number = 0;
  private readonly EVALUATION_INTERVAL: number = 60; // Evaluate every 60 seconds

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

    // Apply crisis bonuses to stats (compound multipliers for smoother scaling)
    if (this.crisisBonus > 0 && !skipMutation) {
      // Use 1.05^crisisBonus for smooth compound growth (5% per "stack")
      const bonusMultiplier = Math.pow(1.05, this.crisisBonus);
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

    // Mutate colony genome on every spawn (with selective pressure - stored for evaluation)
    if (!skipMutation) {
      this.lastScoutRatioMutation = (Math.random() - 0.5) * 0.01; // ±0.5% per spawn
      this.lastAggressionMutation = (Math.random() - 0.5) * 0.02; // ±1% per spawn
      this.lastExplorationMutation = (Math.random() - 0.5) * 0.02; // ±1% per spawn

      this.genome.scoutRatio = Math.max(0.05, Math.min(0.60, this.genome.scoutRatio + this.lastScoutRatioMutation));
      this.genome.aggression = Math.max(0.0, Math.min(1.0, this.genome.aggression + this.lastAggressionMutation));
      this.genome.explorationRange = Math.max(0.5, Math.min(2.0, this.genome.explorationRange + this.lastExplorationMutation));
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

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any, viewportBounds?: { x: number; y: number; width: number; height: number }, enemyAnts?: Ant[], simulationTime?: number): void {
    // Track peak population
    const currentPopulation = this.ants.length;
    if (currentPopulation > this.peakPopulation) {
      this.peakPopulation = currentPopulation;
    }

    // Evaluate genome performance periodically (every 60 seconds)
    if (simulationTime && simulationTime - this.lastEvaluationTime >= this.EVALUATION_INTERVAL) {
      const timeDelta = simulationTime - this.lastEvaluationTime;
      const foodGained = this.foodStored - this.lastFoodEvaluation;
      this.foodIncomeRate = (foodGained / timeDelta) * 60; // Food per minute

      // Only evaluate if we've had at least one interval
      if (this.lastEvaluationTime > 0) {
        this.evaluateGenomePerformance();
      }

      // Update for next evaluation
      this.lastFoodEvaluation = this.foodStored;
      this.lastEvaluationTime = simulationTime;
    }

    // Crisis evolution: Check if colony is in crisis (below 30% of peak)
    const crisisThreshold = this.peakPopulation * CONFIG.CRISIS_POPULATION_THRESHOLD;
    const inCrisis = currentPopulation < crisisThreshold && this.peakPopulation >= 10; // Only trigger if we had at least 10 ants

    // Smooth crisis bonus (floating point instead of discrete stacks)
    if (inCrisis && this.crisisBonus < CONFIG.CRISIS_MAX_BONUS_STACKS) {
      // Gradual increase: +0.01 per frame = full stack in ~6 seconds at 60fps
      this.crisisBonus = Math.min(CONFIG.CRISIS_MAX_BONUS_STACKS, this.crisisBonus + 0.01);
    } else if (!inCrisis && this.crisisBonus > 0) {
      // Very slow decay: -0.001 per frame = full stack lost in ~60 seconds
      this.crisisBonus = Math.max(0, this.crisisBonus - 0.001);
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
        // Calculate efficiency-based fitness: food delivered per energy consumed
        // This rewards efficient ants, not just old ones that got lucky
        if (ant.foodDelivered > 0 && ant.totalEnergyConsumed > 0) {
          // Fitness = food per energy unit (e.g., 10 food / 500 energy = 0.02 fitness)
          // Scale up by 100x to make weights more meaningful for selection
          const efficiencyFitness = (ant.foodDelivered / ant.totalEnergyConsumed) * 100;
          this.addToGenePool(ant.traits, efficiencyFitness, ant.generation, ant.role);
        } else if (ant.foodDelivered > 0) {
          // Fallback for scouts (no energy consumption): use food/age as fitness
          const timeFitness = ant.foodDelivered / Math.max(1, ant.age);
          this.addToGenePool(ant.traits, timeFitness, ant.generation, ant.role);
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
          // Calculate efficiency-based fitness for living ants too
          let fitness = ant.foodDelivered;
          if (ant.totalEnergyConsumed > 0) {
            fitness = (ant.foodDelivered / ant.totalEnergyConsumed) * 100;
          } else if (ant.age > 0) {
            fitness = ant.foodDelivered / ant.age;
          }
          this.addToGenePool(ant.traits, fitness, ant.generation, ant.role);
          // Reset counters so they can contribute again later
          ant.foodDelivered = 0;
          ant.totalEnergyConsumed = 0;
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

  /** Calculate specialized fitness bonus for role-appropriate traits */
  private calculateSpecializationBonus(traits: AntTraits, role: AntRole): number {
    if (role === AntRole.FORAGER) {
      // Foragers benefit from carry capacity and efficiency
      return (traits.carryMultiplier + traits.efficiencyMultiplier) / 2.0;
    } else {
      // Scouts benefit from vision, speed, and combat stats
      return (traits.visionMultiplier + traits.speedMultiplier + traits.dpsMultiplier + traits.maxHealthMultiplier) / 4.0;
    }
  }

  /** Add traits to gene pool with performance-based weighting */
  private addToGenePool(traits: AntTraits, weight: number, generation: number, role?: AntRole): void {
    // Apply specialization bonus if role is provided
    let adjustedWeight = weight;
    if (role) {
      const specializationBonus = this.calculateSpecializationBonus(traits, role);
      adjustedWeight = weight * specializationBonus; // Multiply fitness by role appropriateness
    }

    this.genePool.push({
      traits: copyTraits(traits),
      weight: adjustedWeight,
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

  /** Calculate food cost to spawn new ant (scales with population and food scarcity) */
  private calculateFoodCost(): number {
    const baseCost = CONFIG.FOOD_COST_TO_SPAWN; // 3
    const population = this.ants.length;

    // Population scaling: +50% per 100 ants
    const hundredsOfAnts = Math.floor(population / 100);
    const populationMultiplier = Math.pow(1.5, hundredsOfAnts);

    // Scarcity scaling: cost based on food-per-ant ratio
    // High food per ant = cheap spawns (0.5x cost)
    // Low food per ant = expensive spawns (2.0x cost)
    const foodPerAnt = this.foodStored / Math.max(1, population);
    let scarcityMultiplier = 1.0;

    if (foodPerAnt > 3.0) {
      // Abundant food: 50% discount
      scarcityMultiplier = 0.5;
    } else if (foodPerAnt < 1.0) {
      // Scarce food: 2x more expensive
      scarcityMultiplier = Math.max(1.0, 3.0 / Math.max(0.1, foodPerAnt)); // Up to 3x cost when very scarce
    }

    return Math.ceil(baseCost * populationMultiplier * scarcityMultiplier);
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

  /** Evaluate genome performance and apply selective pressure */
  private evaluateGenomePerformance(): void {
    // Target: aim for positive food income (food per minute > spawn cost per minute)
    // Rough estimate: colony needs ~1-2 food/min per 10 ants to maintain population
    const targetIncome = (this.ants.length / 10) * 1.5; // 1.5 food/min per 10 ants

    const performanceRatio = this.foodIncomeRate / Math.max(0.1, targetIncome);

    // Success = income > target (ratio > 1.0)
    // Failure = income < target (ratio < 1.0)

    if (performanceRatio > 1.1) {
      // Success! Reinforce recent mutations (push further in same direction)
      this.genome.scoutRatio = Math.max(0.05, Math.min(0.60,
        this.genome.scoutRatio + this.lastScoutRatioMutation * 1.5));
      console.log(`📈 Colony thriving (${this.foodIncomeRate.toFixed(1)} food/min) - reinforcing genome`);
    } else if (performanceRatio < 0.9) {
      // Failure! Reverse recent mutations (try opposite direction)
      this.genome.scoutRatio = Math.max(0.05, Math.min(0.60,
        this.genome.scoutRatio - this.lastScoutRatioMutation * 2.0));
      console.log(`📉 Colony struggling (${this.foodIncomeRate.toFixed(1)} food/min) - reversing genome`);
    }
    // Middle range (0.9-1.1): neutral, keep exploring
  }

  public destroy(): void {
    this.ants.forEach(ant => ant.destroy());
    this.sprite.destroy();
  }
}
