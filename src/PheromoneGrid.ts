import { Graphics, Container } from 'pixi.js';

interface PheromoneCell {
  foodTrail: number;
  exploration: number;
  foodSourceId: string | null; // Track which food source this trail leads to
}

export class PheromoneGrid {
  private grid: PheromoneCell[][];
  private graphics: Graphics;
  private cellSize: number;
  private width: number;
  private height: number;
  private decayRate: number = 0.998; // Pheromones decay slower
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
        this.grid[y][x] = { foodTrail: 0, exploration: 0, foodSourceId: null };
      }
    }

    // Create graphics for rendering
    this.graphics = new Graphics();
    container.addChild(this.graphics);
  }

  public depositPheromone(
    x: number,
    y: number,
    type: 'foodTrail' | 'exploration',
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

      // Set food source ID if provided (for food trails)
      if (type === 'foodTrail' && foodSourceId) {
        this.grid[gridY][gridX].foodSourceId = foodSourceId;
      }
    }
  }

  public getPheromoneLevel(
    x: number,
    y: number,
    type: 'foodTrail' | 'exploration'
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
    type: 'foodTrail' | 'exploration',
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
    // Only decay every 3 frames for performance
    this.updateFrame++;
    if (this.updateFrame % 3 !== 0) return;

    // Decay all pheromones
    const decayFactor = Math.pow(this.decayRate, 3); // Compensate for skipped frames
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x].foodTrail *= decayFactor;
        this.grid[y][x].exploration *= decayFactor;

        // Remove very small values
        if (this.grid[y][x].foodTrail < 0.01) this.grid[y][x].foodTrail = 0;
        if (this.grid[y][x].exploration < 0.01) this.grid[y][x].exploration = 0;
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
        if (cell.foodTrail > 1.0 || cell.exploration > 1.0) {
          const worldX = x * this.cellSize;
          const worldY = y * this.cellSize;

          // Food trail is green (very faint)
          const foodAlpha = Math.min(0.15, cell.foodTrail / 20);
          if (foodAlpha > 0.05) {
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x00ff00, alpha: foodAlpha });
          }

          // Exploration trail is blue (even fainter)
          const explorationAlpha = Math.min(0.1, cell.exploration / 20);
          if (explorationAlpha > 0.05) {
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x0066ff, alpha: explorationAlpha });
          }
        }
      }
    }
  }
}
