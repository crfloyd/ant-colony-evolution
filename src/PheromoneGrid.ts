import { Graphics, Container } from 'pixi.js';

interface PheromoneCell {
  foodPher: number; // Laid while returning with food - leads TO food
  homePher: number; // Laid while leaving colony - leads TO home
  foodSourceId: string | null; // Track which food source this trail leads to
}

export class PheromoneGrid {
  private grid: PheromoneCell[][];
  private graphics: Graphics;
  private cellSize: number;
  private width: number;
  private height: number;
  private decayRate: number = 0.02; // rho: evaporation rate per tick (0.01-0.05)
  private diffusionRate: number = 0.1; // D: diffusion rate (0.05-0.2)
  private renderFrame: number = 0;
  private updateFrame: number = 0;

  constructor(
    container: Container,
    width: number,
    height: number,
    cellSize: number = 20
  ) {
    this.width = Math.ceil(width / cellSize);
    this.height = Math.ceil(height / cellSize);
    this.cellSize = cellSize;

    // Initialize grid
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = { foodPher: 0, homePher: 0, foodSourceId: null };
      }
    }

    // Create graphics for rendering
    this.graphics = new Graphics();
    container.addChild(this.graphics);
  }

  public depositPheromone(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher',
    amount: number = 1,
    foodSourceId?: string,
    obstacleManager?: any
  ): void {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (this.isValidCell(gridX, gridY)) {
      // Check if this grid cell overlaps with an obstacle
      if (obstacleManager) {
        const cellCenterX = (gridX + 0.5) * this.cellSize;
        const cellCenterY = (gridY + 0.5) * this.cellSize;
        const cellOverlapsObstacle = obstacleManager.checkCollision(
          { x: cellCenterX, y: cellCenterY },
          this.cellSize / 2
        );

        if (cellOverlapsObstacle) {
          // Don't deposit pheromone in cells that overlap with obstacles
          return;
        }
      }

      this.grid[gridY][gridX][type] = Math.min(
        10,
        this.grid[gridY][gridX][type] + amount
      );

      // Set food source ID if provided (for food pheromones)
      if (type === 'foodPher' && foodSourceId) {
        this.grid[gridY][gridX].foodSourceId = foodSourceId;
      }
    }
  }

  public getPheromoneLevel(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher'
  ): number {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (this.isValidCell(gridX, gridY)) {
      return this.grid[gridY][gridX][type];
    }
    return 0;
  }

  public getPheromoneGradient(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher',
    foodSourceId?: string
  ): { x: number; y: number } {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    let gradX = 0;
    let gradY = 0;

    if (this.isValidCell(gridX, gridY)) {
      const current = this.grid[gridY][gridX][type];

      // Sample neighboring cells - only from same food source if specified
      if (this.isValidCell(gridX + 1, gridY)) {
        const neighbor = this.grid[gridY][gridX + 1];
        if (!foodSourceId || neighbor.foodSourceId === foodSourceId || neighbor.foodSourceId === null) {
          gradX += neighbor[type] - current;
        }
      }
      if (this.isValidCell(gridX - 1, gridY)) {
        const neighbor = this.grid[gridY][gridX - 1];
        if (!foodSourceId || neighbor.foodSourceId === foodSourceId || neighbor.foodSourceId === null) {
          gradX -= neighbor[type] - current;
        }
      }
      if (this.isValidCell(gridX, gridY + 1)) {
        const neighbor = this.grid[gridY + 1][gridX];
        if (!foodSourceId || neighbor.foodSourceId === foodSourceId || neighbor.foodSourceId === null) {
          gradY += neighbor[type] - current;
        }
      }
      if (this.isValidCell(gridX, gridY - 1)) {
        const neighbor = this.grid[gridY - 1][gridX];
        if (!foodSourceId || neighbor.foodSourceId === foodSourceId || neighbor.foodSourceId === null) {
          gradY -= neighbor[type] - current;
        }
      }
    }

    // Normalize
    const magnitude = Math.sqrt(gradX * gradX + gradY * gradY);
    if (magnitude > 0) {
      gradX /= magnitude;
      gradY /= magnitude;
    }

    return { x: gradX, y: gradY };
  }

  private isValidCell(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  public update(): void {
    // Only update every 3 frames for performance
    this.updateFrame++;
    if (this.updateFrame % 3 !== 0) return;

    // Create temporary grids for diffusion (to avoid in-place modification issues)
    const tempFoodPher: number[][] = [];
    const tempHomePher: number[][] = [];

    for (let y = 0; y < this.height; y++) {
      tempFoodPher[y] = [];
      tempHomePher[y] = [];
      for (let x = 0; x < this.width; x++) {
        tempFoodPher[y][x] = this.grid[y][x].foodPher;
        tempHomePher[y][x] = this.grid[y][x].homePher;
      }
    }

    // Apply evaporation and diffusion
    const rho = this.decayRate;
    const D = this.diffusionRate;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Evaporation: grid *= (1 - rho)
        let foodValue = this.grid[y][x].foodPher * (1 - rho);
        let homeValue = this.grid[y][x].homePher * (1 - rho);

        // Diffusion: grid = (1 - D)*grid + D*avg(neighbors)
        // Calculate average of 4-connected neighbors
        let foodNeighborSum = 0;
        let homeNeighborSum = 0;
        let neighborCount = 0;

        if (this.isValidCell(x - 1, y)) {
          foodNeighborSum += tempFoodPher[y][x - 1];
          homeNeighborSum += tempHomePher[y][x - 1];
          neighborCount++;
        }
        if (this.isValidCell(x + 1, y)) {
          foodNeighborSum += tempFoodPher[y][x + 1];
          homeNeighborSum += tempHomePher[y][x + 1];
          neighborCount++;
        }
        if (this.isValidCell(x, y - 1)) {
          foodNeighborSum += tempFoodPher[y - 1][x];
          homeNeighborSum += tempHomePher[y - 1][x];
          neighborCount++;
        }
        if (this.isValidCell(x, y + 1)) {
          foodNeighborSum += tempFoodPher[y + 1][x];
          homeNeighborSum += tempHomePher[y + 1][x];
          neighborCount++;
        }

        if (neighborCount > 0) {
          const foodAvg = foodNeighborSum / neighborCount;
          const homeAvg = homeNeighborSum / neighborCount;

          foodValue = (1 - D) * foodValue + D * foodAvg;
          homeValue = (1 - D) * homeValue + D * homeAvg;
        }

        this.grid[y][x].foodPher = foodValue;
        this.grid[y][x].homePher = homeValue;

        // Remove very small values
        if (this.grid[y][x].foodPher < 0.01) this.grid[y][x].foodPher = 0;
        if (this.grid[y][x].homePher < 0.01) this.grid[y][x].homePher = 0;
      }
    }
  }

  public render(): void {
    // Only render pheromones every 5 frames for performance
    this.renderFrame++;
    if (this.renderFrame % 5 !== 0) return;

    this.graphics.clear();

    // Render pheromone trails - only render strong ones
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];

        // Only render if there's a meaningful amount
        if (cell.foodPher > 1.0 || cell.homePher > 1.0) {
          const worldX = x * this.cellSize;
          const worldY = y * this.cellSize;

          // Food pheromone is green (leads to food)
          const foodAlpha = Math.min(0.15, cell.foodPher / 20);
          if (foodAlpha > 0.05) {
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x00ff00, alpha: foodAlpha });
          }

          // Home pheromone is blue (leads to home)
          const homeAlpha = Math.min(0.1, cell.homePher / 20);
          if (homeAlpha > 0.05) {
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x0066ff, alpha: homeAlpha });
          }
        }
      }
    }
  }
}
