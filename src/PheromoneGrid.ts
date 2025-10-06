import { Graphics, Container, BlurFilter } from 'pixi.js';
import * as CONFIG from './config';

interface PheromoneCell {
  foodPher: number; // Laid while returning with food - leads TO food
  homePher: number; // Laid while leaving colony - leads TO home
  distressPher: number; // Emergency signal - floods outward, fades quickly
  foodSourceId: string | null; // Track which food source this trail leads to
}

export class PheromoneGrid {
  private grid: PheromoneCell[][];
  private graphics: Graphics;
  private cellSize: number;
  private width: number;
  private height: number;
  private renderFrame: number = 0;
  private updateFrame: number = 0;
  private depletedFoodSources: Set<string> = new Set(); // Track depleted food sources for faster decay

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
        this.grid[y][x] = { foodPher: 0, homePher: 0, distressPher: 0, foodSourceId: null };
      }
    }

    // Create graphics for rendering with glow effect
    this.graphics = new Graphics();

    // Add blur filter for glow effect
    const blurFilter = new BlurFilter({
      strength: 8,
      quality: 4,
    });
    this.graphics.filters = [blurFilter];

    container.addChild(this.graphics);
  }

  /** Bilinear splat - deposit pheromone across 4 surrounding cells based on fractional position */
  public depositPheromone(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher',
    amount: number = 1,
    foodSourceId?: string,
    obstacleManager?: any
  ): void {
    // Convert world coordinates to grid coordinates (floating point)
    const gx = x / this.cellSize;
    const gy = y / this.cellSize;

    // Get integer cell indices
    const i = Math.floor(gx);
    const j = Math.floor(gy);

    // Get fractional part (position within cell)
    const fx = gx - i;
    const fy = gy - j;

    // Compute bilinear weights
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;

    // Deposit to 4 surrounding cells with weights
    this.depositToCell(i, j, type, amount * w00, foodSourceId, obstacleManager);
    this.depositToCell(i + 1, j, type, amount * w10, foodSourceId, obstacleManager);
    this.depositToCell(i, j + 1, type, amount * w01, foodSourceId, obstacleManager);
    this.depositToCell(i + 1, j + 1, type, amount * w11, foodSourceId, obstacleManager);
  }

  /** Deposit distress pheromone in a radius (floods outward) */
  public depositDistressPheromone(
    x: number,
    y: number,
    intensity: number = CONFIG.DISTRESS_DEPOSIT_STRENGTH
  ): void {
    // Deposit in a radius around the position for flooding effect
    const radiusInCells = Math.ceil(CONFIG.DISTRESS_EMIT_RADIUS / this.cellSize);
    const centerGridX = Math.floor(x / this.cellSize);
    const centerGridY = Math.floor(y / this.cellSize);

    // Deposit to all cells in radius with falloff
    for (let dy = -radiusInCells; dy <= radiusInCells; dy++) {
      for (let dx = -radiusInCells; dx <= radiusInCells; dx++) {
        const gridX = centerGridX + dx;
        const gridY = centerGridY + dy;

        if (!this.isValidCell(gridX, gridY)) continue;

        // Calculate distance from center
        const distInCells = Math.sqrt(dx * dx + dy * dy);
        if (distInCells > radiusInCells) continue;

        // Falloff based on distance (linear)
        const falloff = 1.0 - (distInCells / radiusInCells);
        const amount = intensity * falloff;

        // Cap at 40% of max level to force spreading instead of accumulation
        this.grid[gridY][gridX].distressPher = Math.min(
          CONFIG.PHEROMONE_MAX_LEVEL * 0.4,
          this.grid[gridY][gridX].distressPher + amount
        );
      }
    }
  }

  /** Helper to deposit to a single cell */
  private depositToCell(
    gridX: number,
    gridY: number,
    type: 'foodPher' | 'homePher' | 'distressPher',
    amount: number,
    foodSourceId?: string,
    obstacleManager?: any
  ): void {
    if (!this.isValidCell(gridX, gridY)) return;

    // Check if this grid cell overlaps with an obstacle
    // Use full cell diagonal to be conservative and prevent pheromone near rock edges
    if (obstacleManager) {
      const cellCenterX = (gridX + 0.5) * this.cellSize;
      const cellCenterY = (gridY + 0.5) * this.cellSize;
      const cellDiagonal = this.cellSize * Math.sqrt(2); // Full diagonal for safety
      const cellOverlapsObstacle = obstacleManager.checkCollision(
        { x: cellCenterX, y: cellCenterY },
        cellDiagonal / 2
      );

      if (cellOverlapsObstacle) {
        return;
      }
    }

    this.grid[gridY][gridX][type] = Math.min(
      CONFIG.PHEROMONE_MAX_LEVEL,
      this.grid[gridY][gridX][type] + amount
    );

    // Set food source ID if provided (for food pheromones)
    if (type === 'foodPher' && foodSourceId) {
      this.grid[gridY][gridX].foodSourceId = foodSourceId;
    }
  }

  /** Bilinear interpolation for smooth pheromone sampling */
  public getPheromoneLevel(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher' | 'distressPher'
  ): number {
    // Convert to grid coordinates
    const gx = x / this.cellSize;
    const gy = y / this.cellSize;

    // Get integer cell indices
    const i = Math.floor(gx);
    const j = Math.floor(gy);

    // Get fractional part
    const fx = gx - i;
    const fy = gy - j;

    // Sample 4 surrounding cells
    const v00 = this.isValidCell(i, j) ? this.grid[j][i][type] : 0;
    const v10 = this.isValidCell(i + 1, j) ? this.grid[j][i + 1][type] : 0;
    const v01 = this.isValidCell(i, j + 1) ? this.grid[j + 1][i][type] : 0;
    const v11 = this.isValidCell(i + 1, j + 1) ? this.grid[j + 1][i + 1][type] : 0;

    // Bilinear interpolation
    return (1 - fx) * (1 - fy) * v00 +
           fx * (1 - fy) * v10 +
           (1 - fx) * fy * v01 +
           fx * fy * v11;
  }

  /**
   * Compute pheromone gradient with magnitude preservation
   * Uses centered difference: g_x = (R - L) / (2*CELL), g_y = (B - T) / (2*CELL)
   * Returns gradient vector (NOT normalized) - magnitude indicates strength
   */
  public getPheromoneGradient(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher',
    foodSourceId?: string
  ): { x: number; y: number } {
    // Convert to grid coordinates
    const gx = x / this.cellSize;
    const gy = y / this.cellSize;

    // Get integer cell indices
    const i = Math.floor(gx);
    const j = Math.floor(gy);

    // Get fractional part for bilinear interpolation
    const fx = gx - i;
    const fy = gy - j;

    // Sample gradient at 4 surrounding cells and interpolate
    let gradX = 0;
    let gradY = 0;

    // Compute gradients at the 4 corners
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const cellI = i + dx;
        const cellJ = j + dy;

        if (!this.isValidCell(cellI, cellJ)) continue;

        // Centered difference at this cell
        const inv2dx = 1 / (2 * this.cellSize);

        // Right neighbor
        const right = this.isValidCell(cellI + 1, cellJ) ? this.grid[cellJ][cellI + 1][type] : this.grid[cellJ][cellI][type];
        // Left neighbor
        const left = this.isValidCell(cellI - 1, cellJ) ? this.grid[cellJ][cellI - 1][type] : this.grid[cellJ][cellI][type];
        // Bottom neighbor
        const bottom = this.isValidCell(cellI, cellJ + 1) ? this.grid[cellJ + 1][cellI][type] : this.grid[cellJ][cellI][type];
        // Top neighbor
        const top = this.isValidCell(cellI, cellJ - 1) ? this.grid[cellJ - 1][cellI][type] : this.grid[cellJ][cellI][type];

        // Centered difference
        const gx_cell = (right - left) * inv2dx;
        const gy_cell = (bottom - top) * inv2dx;

        // Bilinear weight for this corner
        const wx = (dx === 0) ? (1 - fx) : fx;
        const wy = (dy === 0) ? (1 - fy) : fy;
        const weight = wx * wy;

        gradX += gx_cell * weight;
        gradY += gy_cell * weight;
      }
    }

    // Return gradient WITHOUT normalization - preserve magnitude
    return { x: gradX, y: gradY };
  }

  private isValidCell(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  public update(): void {
    // Only update every N frames for performance
    this.updateFrame++;
    if (this.updateFrame % CONFIG.PHEROMONE_UPDATE_INTERVAL !== 0) return;

    // Create temporary grids for diffusion (to avoid in-place modification issues)
    const tempFoodPher: number[][] = [];
    const tempHomePher: number[][] = [];
    const tempDistressPher: number[][] = [];

    for (let y = 0; y < this.height; y++) {
      tempFoodPher[y] = [];
      tempHomePher[y] = [];
      tempDistressPher[y] = [];
      for (let x = 0; x < this.width; x++) {
        tempFoodPher[y][x] = this.grid[y][x].foodPher;
        tempHomePher[y][x] = this.grid[y][x].homePher;
        tempDistressPher[y][x] = this.grid[y][x].distressPher;
      }
    }

    // Apply evaporation and diffusion with separate rates for food/home/distress pheromones
    const rho_food = CONFIG.PHEROMONE_FOOD_DECAY_RATE;
    const rho_home = CONFIG.PHEROMONE_HOME_DECAY_RATE;
    const rho_distress = CONFIG.PHEROMONE_DISTRESS_DECAY_RATE;
    const D_food = CONFIG.PHEROMONE_FOOD_DIFFUSION_RATE;
    const D_home = CONFIG.PHEROMONE_HOME_DIFFUSION_RATE;
    const D_distress = CONFIG.PHEROMONE_DISTRESS_DIFFUSION_RATE;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Evaporation: grid *= (1 - rho) - separate rates for food/home
        // Apply accelerated decay (10x faster) for depleted food sources
        const cell = this.grid[y][x];
        const isDepleted = cell.foodSourceId && this.depletedFoodSources.has(cell.foodSourceId);
        const effectiveFoodDecay = isDepleted ? rho_food * 10 : rho_food;

        let foodValue = cell.foodPher * (1 - effectiveFoodDecay);
        let homeValue = cell.homePher * (1 - rho_home);

        // Distress: concentration-dependent decay - higher concentration decays faster to prevent accumulation
        const distressConcentration = cell.distressPher / CONFIG.PHEROMONE_MAX_LEVEL;
        const effectiveDistressDecay = rho_distress * (1.0 + distressConcentration * 1.5); // Up to 2.5x decay at max concentration
        let distressValue = cell.distressPher * (1 - effectiveDistressDecay);

        // Diffusion: grid = (1 - D)*grid + D*avg(neighbors) - separate rates
        // Calculate average of 4-connected neighbors
        let foodNeighborSum = 0;
        let homeNeighborSum = 0;
        let distressNeighborSum = 0;
        let neighborCount = 0;

        if (this.isValidCell(x - 1, y)) {
          foodNeighborSum += tempFoodPher[y][x - 1];
          homeNeighborSum += tempHomePher[y][x - 1];
          distressNeighborSum += tempDistressPher[y][x - 1];
          neighborCount++;
        }
        if (this.isValidCell(x + 1, y)) {
          foodNeighborSum += tempFoodPher[y][x + 1];
          homeNeighborSum += tempHomePher[y][x + 1];
          distressNeighborSum += tempDistressPher[y][x + 1];
          neighborCount++;
        }
        if (this.isValidCell(x, y - 1)) {
          foodNeighborSum += tempFoodPher[y - 1][x];
          homeNeighborSum += tempHomePher[y - 1][x];
          distressNeighborSum += tempDistressPher[y - 1][x];
          neighborCount++;
        }
        if (this.isValidCell(x, y + 1)) {
          foodNeighborSum += tempFoodPher[y + 1][x];
          homeNeighborSum += tempHomePher[y + 1][x];
          distressNeighborSum += tempDistressPher[y + 1][x];
          neighborCount++;
        }

        if (neighborCount > 0) {
          const foodAvg = foodNeighborSum / neighborCount;
          const homeAvg = homeNeighborSum / neighborCount;
          const distressAvg = distressNeighborSum / neighborCount;

          // Apply separate diffusion rates
          foodValue = (1 - D_food) * foodValue + D_food * foodAvg;
          homeValue = (1 - D_home) * homeValue + D_home * homeAvg;

          // Distress: concentration-dependent diffusion - higher concentration spreads faster
          // Scale diffusion rate by concentration (0-1 normalized by max level)
          const concentrationFactor = tempDistressPher[y][x] / CONFIG.PHEROMONE_MAX_LEVEL;
          const effectiveDistressDiffusion = D_distress * (1.0 + concentrationFactor * 1.5); // Up to 2.5x diffusion at max concentration
          const clampedDiffusion = Math.min(0.95, effectiveDistressDiffusion); // Cap to prevent instability
          distressValue = (1 - clampedDiffusion) * distressValue + clampedDiffusion * distressAvg;
        }

        this.grid[y][x].foodPher = foodValue;
        this.grid[y][x].homePher = homeValue;
        // Cap distress at lower level to force spreading (40% of max)
        this.grid[y][x].distressPher = Math.min(distressValue, CONFIG.PHEROMONE_MAX_LEVEL * 0.4);

        // Remove very small values to avoid flicker
        if (this.grid[y][x].foodPher < CONFIG.PHEROMONE_MIN_THRESHOLD) this.grid[y][x].foodPher = 0;
        if (this.grid[y][x].homePher < CONFIG.PHEROMONE_MIN_THRESHOLD) this.grid[y][x].homePher = 0;
        if (this.grid[y][x].distressPher < CONFIG.PHEROMONE_MIN_THRESHOLD) this.grid[y][x].distressPher = 0;
      }
    }
  }

  public render(showScoutTrails: boolean = true, showForagerTrails: boolean = true, cameraBounds?: { x: number; y: number; width: number; height: number }, showHomePher: boolean = true): void {
    // Only render pheromones every N frames for performance
    this.renderFrame++;
    if (this.renderFrame % CONFIG.PHEROMONE_RENDER_INTERVAL !== 0) return;

    this.graphics.clear();

    // Scout trails have higher strength (CONFIG.SCOUT_HOMEPHER_STRENGTH = 4.0)
    // Forager trails have lower strength (CONFIG.FORAGER_HOMEPHER_STRENGTH = 1.0)
    const scoutTrailThreshold = CONFIG.PHEROMONE_SCOUT_TRAIL_THRESHOLD;

    // Calculate visible cell range (viewport culling for performance)
    let minX = 0, maxX = this.width;
    let minY = 0, maxY = this.height;

    if (cameraBounds) {
      // Add padding to render slightly beyond visible area
      const padding = 50; // cells
      minX = Math.max(0, Math.floor(cameraBounds.x / this.cellSize) - padding);
      maxX = Math.min(this.width, Math.ceil((cameraBounds.x + cameraBounds.width) / this.cellSize) + padding);
      minY = Math.max(0, Math.floor(cameraBounds.y / this.cellSize) - padding);
      maxY = Math.min(this.height, Math.ceil((cameraBounds.y + cameraBounds.height) / this.cellSize) + padding);
    }

    // Render pheromone trails - only render strong ones in visible area
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const cell = this.grid[y][x];

        // Only render if there's a meaningful amount
        if (cell.foodPher > CONFIG.PHEROMONE_RENDER_MIN_THRESHOLD ||
            cell.homePher > CONFIG.PHEROMONE_RENDER_MIN_THRESHOLD ||
            cell.distressPher > CONFIG.PHEROMONE_RENDER_MIN_THRESHOLD) {
          const worldX = x * this.cellSize;
          const worldY = y * this.cellSize;

          // Food pheromone is green (leads to food) - with glow proportional to concentration
          const foodAlpha = Math.min(CONFIG.PHEROMONE_FOOD_ALPHA_MAX,
                                     cell.foodPher / CONFIG.PHEROMONE_FOOD_ALPHA_DIVISOR);
          if (foodAlpha > CONFIG.PHEROMONE_RENDER_MIN_ALPHA) {
            // Boost alpha for better visibility with glow
            const boostedFoodAlpha = Math.min(0.6, foodAlpha * 2);
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x00ff00, alpha: boostedFoodAlpha });
          }

          // Home pheromone - filter by scout/forager, with glow proportional to concentration
          if (showHomePher) {
            const isScoutTrail = cell.homePher > scoutTrailThreshold;
            const shouldRenderHome = (isScoutTrail && showScoutTrails) || (!isScoutTrail && showForagerTrails);

            if (shouldRenderHome) {
              const homeAlpha = Math.min(CONFIG.PHEROMONE_HOME_ALPHA_MAX,
                                         cell.homePher / CONFIG.PHEROMONE_HOME_ALPHA_DIVISOR);
              if (homeAlpha > CONFIG.PHEROMONE_RENDER_MIN_ALPHA) {
                // Boost alpha for better visibility with glow
                const boostedHomeAlpha = Math.min(0.5, homeAlpha * 2);
                this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
                this.graphics.fill({ color: 0x0066ff, alpha: boostedHomeAlpha });
              }
            }
          }

          // Distress pheromone is red-purple (emergency signal) - with glow proportional to concentration
          if (cell.distressPher > CONFIG.PHEROMONE_RENDER_MIN_THRESHOLD) {
            const distressAlpha = Math.min(0.2, cell.distressPher / 10); // Max alpha 0.2, divisor 10
            if (distressAlpha > CONFIG.PHEROMONE_RENDER_MIN_ALPHA) {
              // Boost alpha for high visibility - emergency signal
              const boostedDistressAlpha = Math.min(0.7, distressAlpha * 3);
              this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
              this.graphics.fill({ color: 0xff0066, alpha: boostedDistressAlpha }); // Red-purple
            }
          }
        }
      }
    }
  }

  // Debug overlay support
  public getGrid(): PheromoneCell[][] {
    return this.grid;
  }

  public getCellSize(): number {
    return this.cellSize;
  }

  public markFoodSourceDepleted(foodSourceId: string): void {
    if (foodSourceId) {
      this.depletedFoodSources.add(foodSourceId);
    }
  }
}
