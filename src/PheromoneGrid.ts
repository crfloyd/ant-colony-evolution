import { Graphics, Container } from 'pixi.js';

interface PheromoneCell {
  foodTrail: number;
  exploration: number;
}

export class PheromoneGrid {
  private grid: PheromoneCell[][];
  private graphics: Graphics;
  private cellSize: number;
  private width: number;
  private height: number;
  private decayRate: number = 0.998; // Pheromones decay slower

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
        this.grid[y][x] = { foodTrail: 0, exploration: 0 };
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
    amount: number = 1
  ): void {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    if (this.isValidCell(gridX, gridY)) {
      this.grid[gridY][gridX][type] = Math.min(
        10,
        this.grid[gridY][gridX][type] + amount
      );
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
    type: 'foodTrail' | 'exploration'
  ): { x: number; y: number } {
    const gridX = Math.floor(x / this.cellSize);
    const gridY = Math.floor(y / this.cellSize);

    let gradX = 0;
    let gradY = 0;

    if (this.isValidCell(gridX, gridY)) {
      const current = this.grid[gridY][gridX][type];

      // Sample neighboring cells
      if (this.isValidCell(gridX + 1, gridY)) {
        gradX += this.grid[gridY][gridX + 1][type] - current;
      }
      if (this.isValidCell(gridX - 1, gridY)) {
        gradX -= this.grid[gridY][gridX - 1][type] - current;
      }
      if (this.isValidCell(gridX, gridY + 1)) {
        gradY += this.grid[gridY + 1][gridX][type] - current;
      }
      if (this.isValidCell(gridX, gridY - 1)) {
        gradY -= this.grid[gridY - 1][gridX][type] - current;
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
    // Decay all pheromones
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x].foodTrail *= this.decayRate;
        this.grid[y][x].exploration *= this.decayRate;

        // Remove very small values
        if (this.grid[y][x].foodTrail < 0.01) this.grid[y][x].foodTrail = 0;
        if (this.grid[y][x].exploration < 0.01) this.grid[y][x].exploration = 0;
      }
    }
  }

  public render(): void {
    this.graphics.clear();

    // Render pheromone trails
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];

        if (cell.foodTrail > 0.1 || cell.exploration > 0.1) {
          const worldX = x * this.cellSize;
          const worldY = y * this.cellSize;

          // Food trail is green
          const foodAlpha = Math.min(0.6, cell.foodTrail / 10);
          if (foodAlpha > 0.05) {
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x00ff00, alpha: foodAlpha });
          }

          // Exploration trail is blue (less visible)
          const explorationAlpha = Math.min(0.3, cell.exploration / 10);
          if (explorationAlpha > 0.05) {
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x0066ff, alpha: explorationAlpha });
          }
        }
      }
    }
  }
}
