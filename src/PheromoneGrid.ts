import { Graphics, Container, BlurFilter } from 'pixi.js';
import * as CONFIG from './config';

interface PheromoneCell {
  foodPher: [number, number]; // [colony0, colony1] - Laid while returning with food - leads TO food
  homePher: [number, number]; // [colony0, colony1] - Laid while leaving colony - leads TO home
  distressPher: number; // Emergency signal - floods outward, fades quickly (shared across colonies)
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
  private simulatedFrameAccumulator: number = 0; // Track simulated frames for speed-adjusted updates
  private depletedFoodSources: Set<string> = new Set(); // Track depleted food sources for faster decay
  private worldWidth: number;
  private worldHeight: number;

  constructor(
    container: Container,
    width: number,
    height: number,
    cellSize: number = 20
  ) {
    this.width = Math.ceil(width / cellSize);
    this.height = Math.ceil(height / cellSize);
    this.cellSize = cellSize;
    this.worldWidth = width;
    this.worldHeight = height;

    // Initialize grid with separate pheromone arrays for each colony
    this.grid = [];
    for (let y = 0; y < this.height; y++) {
      this.grid[y] = [];
      for (let x = 0; x < this.width; x++) {
        this.grid[y][x] = { foodPher: [0, 0], homePher: [0, 0], distressPher: 0, foodSourceId: null };
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

  /** Helper to determine colony ID from colony position (0 or 1) */
  private getColonyId(colonyPos: { x: number; y: number }): number {
    // Black colony is at (0.75, 0.75) * worldSize - colony ID 0
    // Red colony is at (0.25, 0.25) * worldSize - colony ID 1
    // Use x coordinate to determine: x > 0.5 * worldWidth = colony 0, else colony 1
    return colonyPos.x > this.worldWidth * 0.5 ? 0 : 1;
  }

  /** Bilinear splat - deposit pheromone across 4 surrounding cells based on fractional position */
  public depositPheromone(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher',
    amount: number = 1,
    foodSourceId?: string,
    obstacleManager?: any,
    colonyPos?: { x: number; y: number }
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

    // Determine colony ID
    const colonyId = colonyPos ? this.getColonyId(colonyPos) : 0;

    // Deposit to 4 surrounding cells with weights
    this.depositToCell(i, j, type, amount * w00, foodSourceId, obstacleManager, colonyId);
    this.depositToCell(i + 1, j, type, amount * w10, foodSourceId, obstacleManager, colonyId);
    this.depositToCell(i, j + 1, type, amount * w01, foodSourceId, obstacleManager, colonyId);
    this.depositToCell(i + 1, j + 1, type, amount * w11, foodSourceId, obstacleManager, colonyId);
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

        // Cap at 80% of max level - allows accumulation for strong diffusion pressure
        this.grid[gridY][gridX].distressPher = Math.min(
          CONFIG.PHEROMONE_MAX_LEVEL * 0.8,
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
    obstacleManager?: any,
    colonyId?: number
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

    // Distress pheromone is shared across colonies (no colony ID)
    if (type === 'distressPher') {
      this.grid[gridY][gridX].distressPher = Math.min(
        CONFIG.PHEROMONE_MAX_LEVEL,
        this.grid[gridY][gridX].distressPher + amount
      );
    } else {
      // Food and home pheromones are colony-specific
      const cid = colonyId !== undefined ? colonyId : 0;
      this.grid[gridY][gridX][type][cid] = Math.min(
        CONFIG.PHEROMONE_MAX_LEVEL,
        this.grid[gridY][gridX][type][cid] + amount
      );
    }

    // Set food source ID if provided (for food pheromones)
    if (type === 'foodPher' && foodSourceId) {
      this.grid[gridY][gridX].foodSourceId = foodSourceId;
    }
  }

  /** Bilinear interpolation for smooth pheromone sampling */
  public getPheromoneLevel(
    x: number,
    y: number,
    type: 'foodPher' | 'homePher' | 'distressPher',
    colonyPos?: { x: number; y: number }
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

    // Determine colony ID (only needed for food/home pheromones)
    const colonyId = (type !== 'distressPher' && colonyPos) ? this.getColonyId(colonyPos) : 0;

    // Sample 4 surrounding cells
    let v00 = 0, v10 = 0, v01 = 0, v11 = 0;

    if (type === 'distressPher') {
      // Distress is shared - read directly
      v00 = this.isValidCell(i, j) ? this.grid[j][i].distressPher : 0;
      v10 = this.isValidCell(i + 1, j) ? this.grid[j][i + 1].distressPher : 0;
      v01 = this.isValidCell(i, j + 1) ? this.grid[j + 1][i].distressPher : 0;
      v11 = this.isValidCell(i + 1, j + 1) ? this.grid[j + 1][i + 1].distressPher : 0;
    } else {
      // Food/home pheromones are colony-specific - read from array
      v00 = this.isValidCell(i, j) ? this.grid[j][i][type][colonyId] : 0;
      v10 = this.isValidCell(i + 1, j) ? this.grid[j][i + 1][type][colonyId] : 0;
      v01 = this.isValidCell(i, j + 1) ? this.grid[j + 1][i][type][colonyId] : 0;
      v11 = this.isValidCell(i + 1, j + 1) ? this.grid[j + 1][i + 1][type][colonyId] : 0;
    }

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
    foodSourceId?: string,
    colonyPos?: { x: number; y: number }
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

    // Determine colony ID
    const colonyId = colonyPos ? this.getColonyId(colonyPos) : 0;

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

        // Right neighbor - read from colony-specific array
        const right = this.isValidCell(cellI + 1, cellJ) ? this.grid[cellJ][cellI + 1][type][colonyId] : this.grid[cellJ][cellI][type][colonyId];
        // Left neighbor
        const left = this.isValidCell(cellI - 1, cellJ) ? this.grid[cellJ][cellI - 1][type][colonyId] : this.grid[cellJ][cellI][type][colonyId];
        // Bottom neighbor
        const bottom = this.isValidCell(cellI, cellJ + 1) ? this.grid[cellJ + 1][cellI][type][colonyId] : this.grid[cellJ][cellI][type][colonyId];
        // Top neighbor
        const top = this.isValidCell(cellI, cellJ - 1) ? this.grid[cellJ - 1][cellI][type][colonyId] : this.grid[cellJ][cellI][type][colonyId];

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

  public update(simulationSpeed: number = 1): void {
    // Accumulate simulated frames - update more frequently at higher speeds
    this.simulatedFrameAccumulator += simulationSpeed;

    // Only update when enough simulated frames have passed
    if (this.simulatedFrameAccumulator < CONFIG.PHEROMONE_UPDATE_INTERVAL) return;

    // Reset accumulator (keep remainder for next update)
    this.simulatedFrameAccumulator -= CONFIG.PHEROMONE_UPDATE_INTERVAL;

    // Optimization 2: Use flat Float32Arrays for each colony's pheromones
    const gridSize = this.width * this.height;
    const tempFoodPher0 = new Float32Array(gridSize); // Black colony food
    const tempFoodPher1 = new Float32Array(gridSize); // Red colony food
    const tempHomePher0 = new Float32Array(gridSize); // Black colony home
    const tempHomePher1 = new Float32Array(gridSize); // Red colony home
    const tempDistressPher = new Float32Array(gridSize); // Shared distress

    // Copy current state to temp arrays
    let idx = 0;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        tempFoodPher0[idx] = this.grid[y][x].foodPher[0];
        tempFoodPher1[idx] = this.grid[y][x].foodPher[1];
        tempHomePher0[idx] = this.grid[y][x].homePher[0];
        tempHomePher1[idx] = this.grid[y][x].homePher[1];
        tempDistressPher[idx] = this.grid[y][x].distressPher;
        idx++;
      }
    }

    // Apply evaporation and diffusion with separate rates for food/home/distress pheromones
    // Use base decay rates - update frequency scales with speed instead
    const rho_food = CONFIG.PHEROMONE_FOOD_DECAY_RATE;
    const rho_home = CONFIG.PHEROMONE_HOME_DECAY_RATE;
    const rho_distress = CONFIG.PHEROMONE_DISTRESS_DECAY_RATE;
    const D_food = CONFIG.PHEROMONE_FOOD_DIFFUSION_RATE;
    const D_home = CONFIG.PHEROMONE_HOME_DIFFUSION_RATE;
    const D_distress = CONFIG.PHEROMONE_DISTRESS_DIFFUSION_RATE;
    const minThreshold = CONFIG.PHEROMONE_MIN_THRESHOLD;

    // Helper to get flat array index
    const getIdx = (gx: number, gy: number) => gy * this.width + gx;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        const currentIdx = getIdx(x, y);

        // Optimization 1: Early exit for near-zero cells (check ALL pheromones)
        if (cell.foodPher[0] < minThreshold && cell.foodPher[1] < minThreshold &&
            cell.homePher[0] < minThreshold && cell.homePher[1] < minThreshold &&
            cell.distressPher < minThreshold) {
          // Cell already at minimum - zero it out and skip expensive calculations
          cell.foodPher[0] = 0;
          cell.foodPher[1] = 0;
          cell.homePher[0] = 0;
          cell.homePher[1] = 0;
          cell.distressPher = 0;
          continue;
        }

        // Evaporation: grid *= (1 - rho) - separate rates for food/home
        // Apply accelerated decay (10x faster) for depleted food sources
        const isDepleted = cell.foodSourceId && this.depletedFoodSources.has(cell.foodSourceId);
        const effectiveFoodDecay = isDepleted ? rho_food * 10 : rho_food;

        // Process each colony's pheromones separately
        let food0Value = cell.foodPher[0] * (1 - effectiveFoodDecay);
        let food1Value = cell.foodPher[1] * (1 - effectiveFoodDecay);
        let home0Value = cell.homePher[0] * (1 - rho_home);
        let home1Value = cell.homePher[1] * (1 - rho_home);

        // Distress: concentration-dependent decay - higher concentration decays faster to prevent accumulation
        const distressConcentration = cell.distressPher / CONFIG.PHEROMONE_MAX_LEVEL;
        const effectiveDistressDecay = rho_distress * (1.0 + distressConcentration * 0.3); // Up to 1.3x decay at max concentration
        let distressValue = cell.distressPher * (1 - effectiveDistressDecay);

        // Optimization 3: Check if we need to calculate diffusion at all
        // Peek at neighbors to see if diffusion is needed
        let hasNonZeroNeighbor = false;
        const checkNeighbor = (nx: number, ny: number) => {
          if (!this.isValidCell(nx, ny)) return;
          const nIdx = getIdx(nx, ny);
          if (tempFoodPher0[nIdx] + tempFoodPher1[nIdx] + tempHomePher0[nIdx] + tempHomePher1[nIdx] + tempDistressPher[nIdx] > minThreshold) {
            hasNonZeroNeighbor = true;
          }
        };
        checkNeighbor(x - 1, y);
        checkNeighbor(x + 1, y);
        checkNeighbor(x, y - 1);
        checkNeighbor(x, y + 1);

        // Only calculate diffusion if cell or neighbors have significant pheromone
        if (hasNonZeroNeighbor || food0Value > minThreshold || food1Value > minThreshold ||
            home0Value > minThreshold || home1Value > minThreshold || distressValue > minThreshold) {
          // Diffusion: grid = (1 - D)*grid + D*avg(neighbors) - separate rates
          // Calculate average of 4-connected neighbors for each pheromone type
          let food0Sum = 0, food1Sum = 0, home0Sum = 0, home1Sum = 0, distressSum = 0;
          let neighborCount = 0;

          const addNeighbor = (nx: number, ny: number) => {
            if (!this.isValidCell(nx, ny)) return;
            const nIdx = getIdx(nx, ny);
            food0Sum += tempFoodPher0[nIdx];
            food1Sum += tempFoodPher1[nIdx];
            home0Sum += tempHomePher0[nIdx];
            home1Sum += tempHomePher1[nIdx];
            distressSum += tempDistressPher[nIdx];
            neighborCount++;
          };

          addNeighbor(x - 1, y);
          addNeighbor(x + 1, y);
          addNeighbor(x, y - 1);
          addNeighbor(x, y + 1);

          if (neighborCount > 0) {
            const food0Avg = food0Sum / neighborCount;
            const food1Avg = food1Sum / neighborCount;
            const home0Avg = home0Sum / neighborCount;
            const home1Avg = home1Sum / neighborCount;
            const distressAvg = distressSum / neighborCount;

            // Apply separate diffusion rates for each colony
            food0Value = (1 - D_food) * food0Value + D_food * food0Avg;
            food1Value = (1 - D_food) * food1Value + D_food * food1Avg;
            home0Value = (1 - D_home) * home0Value + D_home * home0Avg;
            home1Value = (1 - D_home) * home1Value + D_home * home1Avg;

            // Distress: concentration-dependent diffusion - higher concentration spreads faster
            const concentrationFactor = tempDistressPher[currentIdx] / CONFIG.PHEROMONE_MAX_LEVEL;
            const effectiveDistressDiffusion = D_distress * (1.0 + concentrationFactor * 3.0); // Up to 4x diffusion at max concentration (increased from 2.5x)
            const clampedDiffusion = Math.min(0.98, effectiveDistressDiffusion); // Cap to prevent instability (raised from 0.95)
            distressValue = (1 - clampedDiffusion) * distressValue + clampedDiffusion * distressAvg;
          }
        }

        this.grid[y][x].foodPher[0] = food0Value;
        this.grid[y][x].foodPher[1] = food1Value;
        this.grid[y][x].homePher[0] = home0Value;
        this.grid[y][x].homePher[1] = home1Value;
        this.grid[y][x].distressPher = distressValue;

        // Remove very small values to avoid flicker
        if (this.grid[y][x].foodPher[0] < minThreshold) this.grid[y][x].foodPher[0] = 0;
        if (this.grid[y][x].foodPher[1] < minThreshold) this.grid[y][x].foodPher[1] = 0;
        if (this.grid[y][x].homePher[0] < minThreshold) this.grid[y][x].homePher[0] = 0;
        if (this.grid[y][x].homePher[1] < minThreshold) this.grid[y][x].homePher[1] = 0;
        if (this.grid[y][x].distressPher < minThreshold) this.grid[y][x].distressPher = 0;
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

        // Combine both colonies' pheromones for visual rendering
        const totalFoodPher = cell.foodPher[0] + cell.foodPher[1];
        const totalHomePher = cell.homePher[0] + cell.homePher[1];

        // Only render if there's a meaningful amount
        if (totalFoodPher > CONFIG.PHEROMONE_RENDER_MIN_THRESHOLD ||
            totalHomePher > CONFIG.PHEROMONE_RENDER_MIN_THRESHOLD ||
            cell.distressPher > CONFIG.PHEROMONE_RENDER_MIN_THRESHOLD) {
          const worldX = x * this.cellSize;
          const worldY = y * this.cellSize;

          // Food pheromone is green (leads to food) - with glow proportional to concentration
          const foodAlpha = Math.min(CONFIG.PHEROMONE_FOOD_ALPHA_MAX,
                                     totalFoodPher / CONFIG.PHEROMONE_FOOD_ALPHA_DIVISOR);
          if (foodAlpha > CONFIG.PHEROMONE_RENDER_MIN_ALPHA) {
            // Boost alpha for better visibility with glow
            const boostedFoodAlpha = Math.min(0.6, foodAlpha * 2);
            this.graphics.rect(worldX, worldY, this.cellSize, this.cellSize);
            this.graphics.fill({ color: 0x00ff00, alpha: boostedFoodAlpha });
          }

          // Home pheromone - filter by scout/forager, with glow proportional to concentration
          if (showHomePher) {
            const isScoutTrail = totalHomePher > scoutTrailThreshold;
            const shouldRenderHome = (isScoutTrail && showScoutTrails) || (!isScoutTrail && showForagerTrails);

            if (shouldRenderHome) {
              const homeAlpha = Math.min(CONFIG.PHEROMONE_HOME_ALPHA_MAX,
                                         totalHomePher / CONFIG.PHEROMONE_HOME_ALPHA_DIVISOR);
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
