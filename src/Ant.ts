import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2, AntGenome, AntRole } from './types';
import { AntBrain, GenomeFactory } from './NeuralNetwork';
import { PheromoneGrid } from './PheromoneGrid';

export class Ant implements Entity {
  public position: Vector2;
  public sprite: Container;
  public genome: AntGenome;
  public energy: number = 200; // More starting energy so they live longer
  public hasFood: boolean = false;
  public age: number = 0;

  private brain: AntBrain;
  private velocity: Vector2 = { x: 0, y: 0 };
  private graphics: Graphics;
  private colony: Vector2;
  private maxSpeed: number = 3;
  private pheromoneGrid: PheromoneGrid;
  private pheromoneTimer: number = 0;
  private isDead: boolean = false;
  private stuckCounter: number = 0;
  private lastPosition: Vector2 = { x: 0, y: 0 };
  private justReturnedTimer: number = 0; // Cooldown after returning food
  private worldWidth: number = 8000;
  private worldHeight: number = 8000;

  constructor(
    position: Vector2,
    colony: Vector2,
    pheromoneGrid: PheromoneGrid,
    parentBrain?: AntBrain,
    worldWidth: number = 8000,
    worldHeight: number = 8000
  ) {
    this.position = { ...position };
    this.colony = colony;
    this.pheromoneGrid = pheromoneGrid;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    // Create genome
    this.genome = GenomeFactory.createGenome(AntRole.WORKER, parentBrain);

    // Create brain - either from parent or new random
    const config = GenomeFactory.createWorkerConfig();
    if (parentBrain) {
      this.brain = parentBrain.clone();
      this.brain.mutate(0.1);
    } else {
      this.brain = new AntBrain(config);
    }

    // Create sprite
    this.sprite = new Container();
    this.graphics = new Graphics();
    this.sprite.addChild(this.graphics);
    this.renderAnt();

    this.sprite.x = position.x;
    this.sprite.y = position.y;

    this.lastPosition = { ...position };

    // Give ants an initial random velocity so they start exploring smoothly
    const randomAngle = Math.random() * Math.PI * 2;
    this.velocity.x = Math.cos(randomAngle) * this.maxSpeed;
    this.velocity.y = Math.sin(randomAngle) * this.maxSpeed;
  }

  private renderAnt(): void {
    this.graphics.clear();

    const size = this.genome.role === AntRole.QUEEN ? 8 : 5;
    const color = this.hasFood ? 0xffff00 : 0xff6644; // Yellow if carrying food, orange-red otherwise

    // Ant body (main circle)
    this.graphics.circle(0, 0, size);
    this.graphics.fill(color);

    // Add a darker center for depth
    this.graphics.circle(0, 0, size * 0.6);
    this.graphics.fill({ color: 0x000000, alpha: 0.3 });

    // If carrying food, draw a small yellow dot
    if (this.hasFood) {
      this.graphics.circle(0, 0, size * 0.4);
      this.graphics.fill(0xffdd00);
    }

    // Indicate direction with a small line (only if moving significantly)
    const speed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (speed > 0.5) {
      // Normalize velocity for consistent line length
      const lineLength = 8;
      const dirX = (this.velocity.x / speed) * lineLength;
      const dirY = (this.velocity.y / speed) * lineLength;

      this.graphics.moveTo(0, 0);
      this.graphics.lineTo(dirX, dirY);
      this.graphics.stroke({ width: 2, color: 0xffffff, alpha: 0.6 });
    }
  }

  public update(deltaTime: number, foodSources?: any[]): void {
    if (this.isDead) return;

    this.age += deltaTime;

    // Very slow energy consumption (and cap deltaTime to prevent huge drains)
    const cappedDelta = Math.min(deltaTime, 2);
    this.energy -= 0.001 * cappedDelta;

    if (this.energy <= 0) {
      this.isDead = true;
      return;
    }

    // Count down return cooldown
    if (this.justReturnedTimer > 0) {
      this.justReturnedTimer -= deltaTime;
    }

    // Gather inputs for neural network
    const inputs = this.gatherInputs(foodSources);

    // Get outputs from brain
    const outputs = this.brain.activate(inputs);

    // Process outputs (unless in cooldown period)
    if (this.justReturnedTimer <= 0) {
      this.processOutputs(outputs, deltaTime, foodSources);
    }

    // Update position FIRST
    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;

    // THEN check if ant is stuck (hasn't moved much) - but not during cooldown
    if (this.justReturnedTimer <= 0) {
      const distMoved = Math.sqrt(
        (this.position.x - this.lastPosition.x) ** 2 +
        (this.position.y - this.lastPosition.y) ** 2
      );

      // Expected movement based on maxSpeed and deltaTime
      const expectedMinMovement = this.maxSpeed * deltaTime * 0.3; // Should move at least 30% of max

      if (distMoved < expectedMinMovement) {
        this.stuckCounter += deltaTime;
      } else {
        this.stuckCounter = 0;
      }

      // If stuck for too long (accumulated time), break free
      if (this.stuckCounter > 5) {
        // Give a strong random velocity to break free
        const randomAngle = Math.random() * Math.PI * 2;
        this.velocity.x = Math.cos(randomAngle) * this.maxSpeed * 1.5;
        this.velocity.y = Math.sin(randomAngle) * this.maxSpeed * 1.5;
        this.stuckCounter = 0;

        // Immediately apply this movement
        this.position.x += this.velocity.x * deltaTime;
        this.position.y += this.velocity.y * deltaTime;
      }
    }

    this.lastPosition = { ...this.position };

    // Boundary checking - bounce off edges
    const margin = 50;
    if (this.position.x < margin) {
      this.position.x = margin;
      this.velocity.x = Math.abs(this.velocity.x);
    }
    if (this.position.x > this.worldWidth - margin) {
      this.position.x = this.worldWidth - margin;
      this.velocity.x = -Math.abs(this.velocity.x);
    }
    if (this.position.y < margin) {
      this.position.y = margin;
      this.velocity.y = Math.abs(this.velocity.y);
    }
    if (this.position.y > this.worldHeight - margin) {
      this.position.y = this.worldHeight - margin;
      this.velocity.y = -Math.abs(this.velocity.y);
    }

    // Update sprite position
    this.sprite.x = this.position.x;
    this.sprite.y = this.position.y;

    // Drop pheromones - ONLY when carrying food back to colony
    this.pheromoneTimer += deltaTime;
    if (this.pheromoneTimer > 2) {
      this.pheromoneTimer = 0;
      if (this.hasFood) {
        // Drop "food this way" trail when returning to colony
        this.pheromoneGrid.depositPheromone(
          this.position.x,
          this.position.y,
          'foodTrail',
          5
        );
      }
    }

    // Re-render if food status changed
    this.renderAnt();
  }

  private gatherInputs(foodSources?: any[]): number[] {
    // Calculate direction to colony
    const toColony = {
      x: this.colony.x - this.position.x,
      y: this.colony.y - this.position.y,
    };
    const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
    const colonyDirNorm = {
      x: colonyDist > 0 ? toColony.x / colonyDist : 0,
      y: colonyDist > 0 ? toColony.y / colonyDist : 0,
    };

    // Find nearest food (if not carrying food)
    let foodDirNorm = { x: 0, y: 0 };
    if (!this.hasFood && foodSources && foodSources.length > 0) {
      let nearestDist = Infinity;
      let nearestFood = null;

      for (const food of foodSources) {
        const dx = food.position.x - this.position.x;
        const dy = food.position.y - this.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < nearestDist && dist < 300) { // Only sense food within 300 units
          nearestDist = dist;
          nearestFood = { x: dx, y: dy };
        }
      }

      if (nearestFood && nearestDist > 0) {
        foodDirNorm.x = nearestFood.x / nearestDist;
        foodDirNorm.y = nearestFood.y / nearestDist;
      }
    }

    // Get pheromone gradient
    const pheromoneType = this.hasFood ? 'exploration' : 'foodTrail';
    const pheromoneGrad = this.pheromoneGrid.getPheromoneGradient(
      this.position.x,
      this.position.y,
      pheromoneType
    );

    const pheromoneLevel = this.pheromoneGrid.getPheromoneLevel(
      this.position.x,
      this.position.y,
      pheromoneType
    );

    return [
      foodDirNorm.x, // Direction to nearest food
      foodDirNorm.y,
      colonyDirNorm.x,
      colonyDirNorm.y,
      pheromoneGrad.x * 5, // Amplify pheromone gradient influence
      pheromoneGrad.y * 5,
      this.hasFood ? 1 : 0,
      this.energy / 200, // Normalize to 0-1
    ];
  }

  private processOutputs(outputs: number[], deltaTime: number, foodSources?: any[]): void {
    // SIMPLE RULE 1: Carrying food? Head to colony.
    if (this.hasFood) {
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);

      if (colonyDist > 0) {
        this.velocity.x = (toColony.x / colonyDist) * this.maxSpeed;
        this.velocity.y = (toColony.y / colonyDist) * this.maxSpeed;
      }
      return;
    }

    // SIMPLE RULE 2: Can see food? Head to food.
    if (foodSources && foodSources.length > 0) {
      let nearestFood = null;
      let nearestDist = 300;

      for (const food of foodSources) {
        if (food.isEmpty && food.isEmpty()) continue;

        const dx = food.position.x - this.position.x;
        const dy = food.position.y - this.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestFood = { x: dx, y: dy, dist };
        }
      }

      if (nearestFood) {
        this.velocity.x = (nearestFood.x / nearestFood.dist) * this.maxSpeed;
        this.velocity.y = (nearestFood.y / nearestFood.dist) * this.maxSpeed;
        return;
      }
    }

    // SIMPLE RULE 3: Smell "food trail" pheromones? Follow them AWAY from colony.
    const cellSize = 20; // Match PheromoneGrid cell size
    const currentX = Math.floor(this.position.x / cellSize);
    const currentY = Math.floor(this.position.y / cellSize);

    let strongestLevel = 0;
    let strongestDirX = 0;
    let strongestDirY = 0;
    let currentLevel = this.pheromoneGrid.getPheromoneLevel(this.position.x, this.position.y, 'foodTrail');

    // Check 3x3 grid around ant
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;

        const checkX = (currentX + dx) * cellSize + cellSize / 2;
        const checkY = (currentY + dy) * cellSize + cellSize / 2;

        const level = this.pheromoneGrid.getPheromoneLevel(checkX, checkY, 'foodTrail');

        // Calculate if this direction leads away from colony
        const testPosX = this.position.x + dx * cellSize;
        const testPosY = this.position.y + dy * cellSize;
        const distToColonyFromTest = Math.sqrt(
          (testPosX - this.colony.x) ** 2 + (testPosY - this.colony.y) ** 2
        );
        const currentDistToColony = Math.sqrt(
          (this.position.x - this.colony.x) ** 2 + (this.position.y - this.colony.y) ** 2
        );

        // Only consider directions that lead AWAY from colony AND have pheromones
        if (level > strongestLevel && distToColonyFromTest > currentDistToColony) {
          strongestLevel = level;
          strongestDirX = dx;
          strongestDirY = dy;
        }
      }
    }

    // Follow if found strong trail that leads away from colony
    if (strongestLevel > 2.0 && (strongestDirX !== 0 || strongestDirY !== 0)) {
      const mag = Math.sqrt(strongestDirX * strongestDirX + strongestDirY * strongestDirY);
      this.velocity.x = (strongestDirX / mag) * this.maxSpeed;
      this.velocity.y = (strongestDirY / mag) * this.maxSpeed;
      return;
    }

    // SIMPLE RULE 4: No food, no smell? Wander randomly.
    const randomAngle = (Math.random() - 0.5) * 0.3;
    const cos = Math.cos(randomAngle);
    const sin = Math.sin(randomAngle);

    const newVelX = this.velocity.x * cos - this.velocity.y * sin;
    const newVelY = this.velocity.x * sin + this.velocity.y * cos;

    this.velocity.x = newVelX;
    this.velocity.y = newVelY;

    // Keep speed consistent
    const velMag = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (velMag > 0.1) {
      const targetSpeed = this.maxSpeed * 0.8;
      this.velocity.x = (this.velocity.x / velMag) * targetSpeed;
      this.velocity.y = (this.velocity.y / velMag) * targetSpeed;
    }
  }

  public checkFoodPickup(foodPosition: Vector2, pickupRadius: number = 20): boolean {
    if (this.hasFood) return false;

    const dx = this.position.x - foodPosition.x;
    const dy = this.position.y - foodPosition.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < pickupRadius) {
      this.hasFood = true;

      // Turn around toward colony when picking up food
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
      if (colonyDist > 0) {
        this.velocity.x = (toColony.x / colonyDist) * this.maxSpeed;
        this.velocity.y = (toColony.y / colonyDist) * this.maxSpeed;
      }

      return true;
    }
    return false;
  }

  public checkColonyReturn(returnRadius: number = 50): boolean {
    if (!this.hasFood) return false;

    const dx = this.position.x - this.colony.x;
    const dy = this.position.y - this.colony.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < returnRadius) {
      this.hasFood = false;
      this.energy = Math.min(200, this.energy + 40); // Restore some energy

      // Push ant away from colony slightly to prevent clustering
      if (dist > 0) {
        const pushDist = 60;
        this.position.x = this.colony.x + (dx / dist) * pushDist;
        this.position.y = this.colony.y + (dy / dist) * pushDist;

        // Give it strong outward velocity
        this.velocity.x = (dx / dist) * this.maxSpeed * 1.5;
        this.velocity.y = (dy / dist) * this.maxSpeed * 1.5;

        // Set cooldown so ant keeps moving away before other behaviors interfere
        this.justReturnedTimer = 30; // 30 frames of free movement
        this.stuckCounter = 0; // Reset stuck counter
      }

      return true; // Food delivered
    }
    return false;
  }

  public isAlive(): boolean {
    return !this.isDead && this.energy > 0;
  }

  public cloneBrain(): AntBrain {
    return this.brain.clone();
  }

  public destroy(): void {
    this.sprite.destroy();
  }
}
