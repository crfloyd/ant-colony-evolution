import { Graphics, Container } from 'pixi.js';
import { Entity, Vector2, AntGenome, AntRole } from './types';
import { AntBrain, GenomeFactory } from './NeuralNetwork';
import { PheromoneGrid } from './PheromoneGrid';

export class Ant implements Entity {
  public position: Vector2;
  public sprite: Container;
  public genome: AntGenome;
  public energy: number = 100;
  public hasFood: boolean = false;
  public age: number = 0;

  private brain: AntBrain;
  private velocity: Vector2 = { x: 0, y: 0 };
  private graphics: Graphics;
  private colony: Vector2;
  private maxSpeed: number = 2;
  private pheromoneGrid: PheromoneGrid;
  private pheromoneTimer: number = 0;
  private isDead: boolean = false;

  constructor(
    position: Vector2,
    colony: Vector2,
    pheromoneGrid: PheromoneGrid,
    parentBrain?: AntBrain
  ) {
    this.position = { ...position };
    this.colony = colony;
    this.pheromoneGrid = pheromoneGrid;

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
  }

  private renderAnt(): void {
    this.graphics.clear();

    const size = this.genome.role === AntRole.QUEEN ? 8 : 4;
    const color = this.hasFood ? 0xffff00 : 0xff4444; // Yellow if carrying food

    // Ant body
    this.graphics.circle(0, 0, size);
    this.graphics.fill(color);

    // Indicate direction with a small line
    this.graphics.moveTo(0, 0);
    this.graphics.lineTo(this.velocity.x * 3, this.velocity.y * 3);
    this.graphics.stroke({ width: 1, color: 0xffffff });
  }

  public update(deltaTime: number, foodSources?: any[]): void {
    if (this.isDead) return;

    this.age += deltaTime;
    this.energy -= 0.005 * deltaTime; // Reduced energy consumption

    if (this.energy <= 0) {
      this.isDead = true;
      return;
    }

    // Gather inputs for neural network
    const inputs = this.gatherInputs(foodSources);

    // Get outputs from brain
    const outputs = this.brain.activate(inputs);

    // Process outputs
    this.processOutputs(outputs, deltaTime);

    // Update position
    this.position.x += this.velocity.x * deltaTime;
    this.position.y += this.velocity.y * deltaTime;

    // Boundary checking - bounce off edges
    const margin = 50;
    if (this.position.x < margin) {
      this.position.x = margin;
      this.velocity.x = Math.abs(this.velocity.x);
    }
    if (this.position.x > 2000 - margin) {
      this.position.x = 2000 - margin;
      this.velocity.x = -Math.abs(this.velocity.x);
    }
    if (this.position.y < margin) {
      this.position.y = margin;
      this.velocity.y = Math.abs(this.velocity.y);
    }
    if (this.position.y > 2000 - margin) {
      this.position.y = 2000 - margin;
      this.velocity.y = -Math.abs(this.velocity.y);
    }

    // Update sprite position
    this.sprite.x = this.position.x;
    this.sprite.y = this.position.y;

    // Drop pheromones more frequently
    this.pheromoneTimer += deltaTime;
    if (this.pheromoneTimer > 2) {
      this.pheromoneTimer = 0;
      if (this.hasFood) {
        // Drop strong food trail when returning to colony
        this.pheromoneGrid.depositPheromone(
          this.position.x,
          this.position.y,
          'foodTrail',
          5
        );
      } else {
        // Drop weak exploration pheromone when searching
        this.pheromoneGrid.depositPheromone(
          this.position.x,
          this.position.y,
          'exploration',
          0.3
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
      pheromoneGrad.x,
      pheromoneGrad.y,
      this.hasFood ? 1 : 0,
      this.energy / 100, // Normalize to 0-1
    ];
  }

  private processOutputs(outputs: number[], deltaTime: number): void {
    // Outputs: [moveX, moveY, dropPheromone, pickUpFood]

    // If carrying food, override with strong bias toward colony
    if (this.hasFood) {
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);

      if (colonyDist > 0) {
        // Strong bias toward colony (90% colony direction, 10% neural net)
        const moveX = (outputs[0] - 0.5) * 2;
        const moveY = (outputs[1] - 0.5) * 2;

        const colonyDirX = toColony.x / colonyDist;
        const colonyDirY = toColony.y / colonyDist;

        const colonyWeight = 0.9;
        const nnWeight = 0.1;

        // Blend directions then apply speed
        const blendedX = colonyDirX * colonyWeight + moveX * nnWeight;
        const blendedY = colonyDirY * colonyWeight + moveY * nnWeight;

        // Normalize the blended direction
        const blendedMag = Math.sqrt(blendedX * blendedX + blendedY * blendedY);
        if (blendedMag > 0) {
          this.velocity.x = (blendedX / blendedMag) * this.maxSpeed;
          this.velocity.y = (blendedY / blendedMag) * this.maxSpeed;
        }
      }
    } else {
      // Normal movement when searching for food
      const moveX = (outputs[0] - 0.5) * 2; // Convert from 0-1 to -1 to 1
      const moveY = (outputs[1] - 0.5) * 2;

      // Add some momentum - blend with current velocity
      const momentum = 0.3; // Reduced momentum for more responsive movement
      const newVelX = moveX * this.maxSpeed;
      const newVelY = moveY * this.maxSpeed;

      this.velocity.x = this.velocity.x * momentum + newVelX * (1 - momentum);
      this.velocity.y = this.velocity.y * momentum + newVelY * (1 - momentum);
    }

    // Normalize if too fast
    const magnitude = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
    if (magnitude > this.maxSpeed) {
      this.velocity.x = (this.velocity.x / magnitude) * this.maxSpeed;
      this.velocity.y = (this.velocity.y / magnitude) * this.maxSpeed;
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

  public checkColonyReturn(returnRadius: number = 30): boolean {
    if (!this.hasFood) return false;

    const dx = this.position.x - this.colony.x;
    const dy = this.position.y - this.colony.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < returnRadius) {
      this.hasFood = false;
      this.energy = Math.min(100, this.energy + 20); // Restore some energy
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
