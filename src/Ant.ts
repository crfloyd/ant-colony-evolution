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
  private stuckWithFoodCounter: number = 0; // Track being stuck while carrying food
  private escapeTimer: number = 0; // When >0, ant is escaping from being stuck
  private followingTrail: boolean = false; // Track if currently following a pheromone trail

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

  public update(deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
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

    // Count down escape timer
    if (this.escapeTimer > 0) {
      this.escapeTimer -= deltaTime;
    }

    // Process outputs (unless in cooldown period)
    // Neural network disabled for performance - using simple rule-based AI
    if (this.justReturnedTimer <= 0) {
      this.processOutputs([], deltaTime, foodSources, obstacleManager);
    }

    // Update position FIRST
    const newX = this.position.x + this.velocity.x * deltaTime;
    const newY = this.position.y + this.velocity.y * deltaTime;

    // Check for obstacle collision (but SKIP if following a trail - trail is already valid)
    if (obstacleManager && !this.followingTrail) {
      const collision = obstacleManager.checkCollision({ x: newX, y: newY }, 10);
      if (collision) {
        // Hit an obstacle - reflect away from obstacle center
        const toObstacle = {
          x: collision.position.x - this.position.x,
          y: collision.position.y - this.position.y,
        };
        const dist = Math.sqrt(toObstacle.x * toObstacle.x + toObstacle.y * toObstacle.y);

        if (dist > 0) {
          // Bounce away from obstacle
          const awayX = -toObstacle.x / dist;
          const awayY = -toObstacle.y / dist;

          // Add some randomness to avoid perfect bouncing
          const randomAngle = (Math.random() - 0.5) * Math.PI * 0.5; // +/- 45 degrees
          const cos = Math.cos(randomAngle);
          const sin = Math.sin(randomAngle);

          this.velocity.x = (awayX * cos - awayY * sin) * this.maxSpeed;
          this.velocity.y = (awayX * sin + awayY * cos) * this.maxSpeed;
        }

        // Don't update position, stay where we are
        // The stuck detection will help if we get truly stuck
      } else {
        // No collision, update position
        this.position.x = newX;
        this.position.y = newY;
      }
    } else {
      // Following trail or no obstacle manager - just update position
      this.position.x = newX;
      this.position.y = newY;
    }

    // Safety check: if somehow inside an obstacle, push out (only when NOT following trail)
    if (obstacleManager && !this.followingTrail) {
      const insideObstacle = obstacleManager.checkCollision(this.position, 10);
      if (insideObstacle) {
        // Push ant away from obstacle center
        const dx = this.position.x - insideObstacle.position.x;
        const dy = this.position.y - insideObstacle.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 0) {
          // Push to edge of obstacle plus margin
          const pushDist = Math.max(insideObstacle.width, insideObstacle.height) / 2 + 20;
          this.position.x = insideObstacle.position.x + (dx / dist) * pushDist;
          this.position.y = insideObstacle.position.y + (dy / dist) * pushDist;
        } else {
          // Directly on center, push randomly
          const randomAngle = Math.random() * Math.PI * 2;
          this.position.x += Math.cos(randomAngle) * 50;
          this.position.y += Math.sin(randomAngle) * 50;
        }

        // Random velocity after being pushed
        const randomAngle = Math.random() * Math.PI * 2;
        this.velocity.x = Math.cos(randomAngle) * this.maxSpeed;
        this.velocity.y = Math.sin(randomAngle) * this.maxSpeed;
      }
    }


    // THEN check if ant is stuck (hasn't moved much) - but not during cooldown or following trail
    if (this.justReturnedTimer <= 0 && !this.followingTrail) {
      const distMoved = Math.sqrt(
        (this.position.x - this.lastPosition.x) ** 2 +
        (this.position.y - this.lastPosition.y) ** 2
      );

      // Expected movement based on maxSpeed and deltaTime
      const expectedMinMovement = this.maxSpeed * deltaTime * 0.3; // Should move at least 30% of max

      if (distMoved < expectedMinMovement) {
        this.stuckCounter += deltaTime;

        // Track if stuck while carrying food (this is critical - creates pheromone trap)
        if (this.hasFood && !this.followingTrail) {
          this.stuckWithFoodCounter += deltaTime;
        }
      } else {
        this.stuckCounter = 0;
        this.stuckWithFoodCounter = 0;
      }

      // If stuck with food, actively search for a way around the obstacle
      if (this.stuckWithFoodCounter > 2) {
        // Try to find a clear direction by sampling around
        const toColony = {
          x: this.colony.x - this.position.x,
          y: this.colony.y - this.position.y,
        };
        const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
        const colonyDir = colonyDist > 0 ? { x: toColony.x / colonyDist, y: toColony.y / colonyDist } : { x: 1, y: 0 };

        // Sample 8 directions around the ant
        let bestDir = null;
        let bestScore = -Infinity;
        const checkDist = 60;

        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
          const dirX = Math.cos(angle);
          const dirY = Math.sin(angle);

          const checkPos = {
            x: this.position.x + dirX * checkDist,
            y: this.position.y + dirY * checkDist,
          };

          // Check if this direction is clear
          const blocked = obstacleManager && obstacleManager.checkCollision(checkPos, 10);

          if (!blocked) {
            // Score based on how much it aligns with colony direction
            const score = dirX * colonyDir.x + dirY * colonyDir.y;
            if (score > bestScore) {
              bestScore = score;
              bestDir = { x: dirX, y: dirY };
            }
          }
        }

        if (bestDir) {
          // Found a clear direction - move that way
          this.velocity.x = bestDir.x * this.maxSpeed * 1.5;
          this.velocity.y = bestDir.y * this.maxSpeed * 1.5;
          this.escapeTimer = 15; // Move in this direction for a bit
        } else {
          // No clear direction found - back up
          this.velocity.x = -this.velocity.x * 1.5;
          this.velocity.y = -this.velocity.y * 1.5;
          this.escapeTimer = 10;
        }

        this.stuckWithFoodCounter = 0;
        this.stuckCounter = 0;

        // Immediately apply this movement
        this.position.x += this.velocity.x * deltaTime;
        this.position.y += this.velocity.y * deltaTime;
      } else if (this.stuckCounter > 5) {
        // If stuck for too long (accumulated time), break free
        // Give a strong random velocity to break free
        const randomAngle = Math.random() * Math.PI * 2;
        this.velocity.x = Math.cos(randomAngle) * this.maxSpeed * 1.5;
        this.velocity.y = Math.sin(randomAngle) * this.maxSpeed * 1.5;
        this.stuckCounter = 0;

        // Immediately apply this movement
        this.position.x += this.velocity.x * deltaTime;
        this.position.y += this.velocity.y * deltaTime;
      }
    } else if (this.followingTrail) {
      // Following trail - reset stuck counters
      this.stuckCounter = 0;
      this.stuckWithFoodCounter = 0;
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

    // Drop pheromones - when carrying food back AND not stuck AND moving
    this.pheromoneTimer += deltaTime;
    if (this.pheromoneTimer > 2) {
      this.pheromoneTimer = 0;
      // Only drop if: has food, not stuck, not escaping, and actually moving
      const isMoving = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y) > 1;
      if (this.hasFood && this.stuckWithFoodCounter < 1 && this.escapeTimer <= 0 && isMoving) {
        // Drop "food this way" trail when returning to colony
        // Drop even near obstacles - successful paths need complete trails!
        this.pheromoneGrid.depositPheromone(
          this.position.x,
          this.position.y,
          'foodTrail',
          5
        );
      }
    }

    // Only re-render every 10 frames to save performance
    if (Math.floor(this.age) % 10 === 0 || this.age < 2) {
      this.renderAnt();
    }
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

  private processOutputs(outputs: number[], deltaTime: number, foodSources?: any[], obstacleManager?: any): void {
    // ESCAPE MODE: If escape timer is active, just keep current velocity (moving away from walls)
    if (this.escapeTimer > 0) {
      // Keep moving in escape direction, don't change velocity
      return;
    }

    // SIMPLE RULE 1: Carrying food? Follow existing trail home OR navigate if no trail.
    if (this.hasFood) {
      // Use pheromone gradient (much faster than checking 9 cells)
      const gradient = this.pheromoneGrid.getPheromoneGradient(
        this.position.x,
        this.position.y,
        'foodTrail'
      );

      // Check if gradient points toward colony
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
      const colonyDir = colonyDist > 0 ? { x: toColony.x / colonyDist, y: toColony.y / colonyDist } : { x: 0, y: 0 };

      // Dot product: if gradient aligns with colony direction, follow it
      const alignment = gradient.x * colonyDir.x + gradient.y * colonyDir.y;
      const gradMag = Math.sqrt(gradient.x * gradient.x + gradient.y * gradient.y);

      // Check current pheromone level - if strong trail exists, follow it
      const currentLevel = this.pheromoneGrid.getPheromoneLevel(this.position.x, this.position.y, 'foodTrail');

      // If there's a strong trail (gradient exists) and it leads toward colony
      if (currentLevel > 2.0 && gradMag > 0.1 && alignment > 0.3) {
        // Strong trail exists - follow it blindly! No need to check obstacles, trail is already valid
        this.followingTrail = true;
        this.velocity.x = gradient.x * this.maxSpeed;
        this.velocity.y = gradient.y * this.maxSpeed;
        return;
      }

      // No strong trail found - need to navigate
      this.followingTrail = false;

      // No trail exists - be the first ant and navigate with obstacle avoidance
      // Sample multiple directions and pick the best clear one
      if (colonyDist > 0) {
        const dirX = toColony.x / colonyDist;
        const dirY = toColony.y / colonyDist;

        if (obstacleManager) {
          // Check 5 directions: straight, left 45°, right 45°, left 90°, right 90°
          const directions = [
            { x: dirX, y: dirY, angle: 0 }, // Straight
            { x: Math.cos(Math.atan2(dirY, dirX) - Math.PI / 4), y: Math.sin(Math.atan2(dirY, dirX) - Math.PI / 4), angle: -45 }, // Right 45
            { x: Math.cos(Math.atan2(dirY, dirX) + Math.PI / 4), y: Math.sin(Math.atan2(dirY, dirX) + Math.PI / 4), angle: 45 }, // Left 45
            { x: Math.cos(Math.atan2(dirY, dirX) - Math.PI / 2), y: Math.sin(Math.atan2(dirY, dirX) - Math.PI / 2), angle: -90 }, // Right 90
            { x: Math.cos(Math.atan2(dirY, dirX) + Math.PI / 2), y: Math.sin(Math.atan2(dirY, dirX) + Math.PI / 2), angle: 90 }, // Left 90
          ];

          let bestDir = null;
          let bestScore = -Infinity;

          for (const dir of directions) {
            const checkPos = {
              x: this.position.x + dir.x * 60,
              y: this.position.y + dir.y * 60,
            };

            const blocked = obstacleManager.checkCollision(checkPos, 10);

            if (!blocked) {
              // Score: prefer directions closer to colony direction
              const score = dir.x * dirX + dir.y * dirY;
              if (score > bestScore) {
                bestScore = score;
                bestDir = dir;
              }
            }
          }

          if (bestDir) {
            this.velocity.x = bestDir.x * this.maxSpeed;
            this.velocity.y = bestDir.y * this.maxSpeed;
          } else {
            // All blocked - back up
            this.velocity.x = -dirX * this.maxSpeed;
            this.velocity.y = -dirY * this.maxSpeed;
          }
        } else {
          this.velocity.x = dirX * this.maxSpeed;
          this.velocity.y = dirY * this.maxSpeed;
        }
      }
      return;
    }

    // SIMPLE RULE 2: Can see food? Head to food
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
        // Just head toward the food - pickup will handle the rest
        this.velocity.x = (nearestFood.x / nearestFood.dist) * this.maxSpeed;
        this.velocity.y = (nearestFood.y / nearestFood.dist) * this.maxSpeed;
        return;
      }
    }

    // SIMPLE RULE 3: Smell "food trail" pheromones? Follow them AWAY from colony.
    const gradient = this.pheromoneGrid.getPheromoneGradient(
      this.position.x,
      this.position.y,
      'foodTrail'
    );

    const toColony = {
      x: this.colony.x - this.position.x,
      y: this.colony.y - this.position.y,
    };
    const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
    const colonyDir = colonyDist > 0 ? { x: toColony.x / colonyDist, y: toColony.y / colonyDist } : { x: 0, y: 0 };

    // Dot product: if gradient points AWAY from colony, follow it
    const alignment = gradient.x * colonyDir.x + gradient.y * colonyDir.y;
    const gradMag = Math.sqrt(gradient.x * gradient.x + gradient.y * gradient.y);

    // Follow if trail leads away from colony (negative alignment)
    if (gradMag > 0.1 && alignment < -0.3) {
      this.velocity.x = gradient.x * this.maxSpeed;
      this.velocity.y = gradient.y * this.maxSpeed;
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

      // IMMEDIATELY move away from food source to prevent getting stuck
      // First, push away from food
      if (dist > 0.1) {
        const awayFromFoodX = dx / dist;
        const awayFromFoodY = dy / dist;
        this.position.x = foodPosition.x + awayFromFoodX * (pickupRadius + 10);
        this.position.y = foodPosition.y + awayFromFoodY * (pickupRadius + 10);
      }

      // Turn around toward colony when picking up food
      const toColony = {
        x: this.colony.x - this.position.x,
        y: this.colony.y - this.position.y,
      };
      const colonyDist = Math.sqrt(toColony.x * toColony.x + toColony.y * toColony.y);
      if (colonyDist > 0) {
        this.velocity.x = (toColony.x / colonyDist) * this.maxSpeed * 1.5;
        this.velocity.y = (toColony.y / colonyDist) * this.maxSpeed * 1.5;
      }

      // Reset stuck counters
      this.stuckCounter = 0;
      this.stuckWithFoodCounter = 0;

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
