import { Application, Container, Graphics, Assets, Texture, Rectangle, TilingSprite, Sprite } from 'pixi.js';
import { Camera } from './Camera';
import { PheromoneGrid } from './PheromoneGrid';
import { Colony } from './Colony';
import { FoodManager } from './Food';
import { ObstacleManager } from './Obstacle';
import { Metrics } from './Metrics';
import { Ant } from './Ant';
import * as CONFIG from './config';

// Global ant sprite textures
export let antSpriteTextures: Texture[] | null = null;
export let scoutSpriteTextures: Texture[] | null = null;
export let colonyMoundTexture: Texture | null = null;
export let groundTexture: Texture | null = null;
export let groundClutterTextures: Texture[] = [];

// Rock sprite data: texture + size category
export interface RockSprite {
  texture: Texture;
  category: 'small' | 'medium' | 'large';
}
export let rockSpritesLarge: Texture[] = [];
export let rockSpritesMedium: Texture[] = [];
export let rockSpritesSmall: Texture[] = [];

export class Game {
  private app: Application;
  private camera!: Camera;
  private worldContainer!: Container;
  private staticContainer!: Container; // For ground and rocks
  private dynamicContainer!: Container; // For ants, food, colony
  private pheromoneGrid!: PheromoneGrid;
  private colony!: Colony;
  private foodManager!: FoodManager;
  private obstacleManager!: ObstacleManager;
  private metrics!: Metrics;

  private isPaused: boolean = false;
  private simulationSpeed: number = 1;
  private worldWidth: number = CONFIG.WORLD_WIDTH;
  private worldHeight: number = CONFIG.WORLD_HEIGHT;
  private showRockColliders: boolean = false;
  private selectedAnt: any = null;
  private selectionGraphics: Graphics | null = null;
  private mouseDownPos: { x: number; y: number } | null = null;

  // UI elements
  private antCountEl: HTMLElement;
  private foodCountEl: HTMLElement;
  private spawnProgressEl: HTMLElement;
  private generationEl: HTMLElement;
  private fpsEl: HTMLElement;

  // Metrics UI elements
  private tripsPerHourEl: HTMLElement;
  private avgTripDistEl: HTMLElement;
  private foragingPctEl: HTMLElement;
  private returningPctEl: HTMLElement;
  private foodPerMinEl: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    // Create PixiJS application
    this.app = new Application();

    // Initialize UI elements
    this.antCountEl = document.getElementById('antCount')!;
    this.foodCountEl = document.getElementById('foodCount')!;
    this.spawnProgressEl = document.getElementById('spawnProgress')!;
    this.generationEl = document.getElementById('generation')!;
    this.fpsEl = document.getElementById('fps')!;

    // Initialize metrics UI elements
    this.tripsPerHourEl = document.getElementById('tripsPerHour')!;
    this.avgTripDistEl = document.getElementById('avgTripDist')!;
    this.foragingPctEl = document.getElementById('foragingPct')!;
    this.returningPctEl = document.getElementById('returningPct')!;
    this.foodPerMinEl = document.getElementById('foodPerMin')!;

    // Start async initialization
    this.init(canvas).catch(err => {
      console.error('Failed to initialize game:', err);
    });
  }

  private async init(canvas: HTMLCanvasElement): Promise<void> {
    console.log('Initializing game...');

    await this.app.init({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0xc4a57b, // Light dirt color (tan/brown)
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    console.log('PixiJS initialized');

    // Load ant sprite sheet
    console.log('Loading ant sprite sheet...');
    try {
      const spriteSheet = await Assets.load('/ant-sprint-sheet.png');

      // Create textures from 8x8 grid (62 frames used, skip last 2 blank frames)
      const frameWidth = spriteSheet.width / 8;
      const frameHeight = spriteSheet.height / 8;
      const textures: Texture[] = [];

      let frameCount = 0;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          if (frameCount >= 62) break; // Skip last 2 blank frames
          const rect = new Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight);
          textures.push(new Texture({ source: spriteSheet.source, frame: rect }));
          frameCount++;
        }
        if (frameCount >= 62) break;
      }

      antSpriteTextures = textures;
      console.log(`Loaded ${textures.length} ant animation frames`);
    } catch (err) {
      console.error('Failed to load ant sprite sheet, using fallback graphics:', err);
    }

    // Load scout sprite sheet
    console.log('Loading scout sprite sheet...');
    try {
      const scoutSpriteSheet = await Assets.load('/scout_ant_sprite_sheet.png');

      // Create textures from 8x8 grid (62 frames used, skip last 2 blank frames)
      const frameWidth = scoutSpriteSheet.width / 8;
      const frameHeight = scoutSpriteSheet.height / 8;
      const textures: Texture[] = [];

      let frameCount = 0;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          if (frameCount >= 62) break; // Skip last 2 blank frames
          const rect = new Rectangle(col * frameWidth, row * frameHeight, frameWidth, frameHeight);
          textures.push(new Texture({ source: scoutSpriteSheet.source, frame: rect }));
          frameCount++;
        }
        if (frameCount >= 62) break;
      }

      scoutSpriteTextures = textures;
      console.log(`Loaded ${textures.length} scout animation frames`);
    } catch (err) {
      console.error('Failed to load scout sprite sheet, using fallback to regular ant sprites:', err);
    }

    // Load colony mound sprite
    console.log('Loading colony mound sprite...');
    try {
      colonyMoundTexture = await Assets.load('/ant-mound.png');
      console.log('Loaded colony mound sprite');
    } catch (err) {
      console.error('Failed to load colony mound sprite, using fallback graphics:', err);
    }

    // Load ground clutter sprites
    console.log('Loading ground clutter sprites...');
    try {
      // Load ground clutter images (1.png through 6.png)
      const clutterFiles = ['1.png', '2.png', '3.png', '4.png', '5.png', '6.png'];

      for (const file of clutterFiles) {
        try {
          const texture = await Assets.load(`/${file}`);
          groundClutterTextures.push(texture);
          console.log(`Loaded ground clutter: ${file}`);
        } catch (err) {
          // Skip if file doesn't exist
          console.log(`Ground clutter ${file} not found, skipping...`);
        }
      }

      if (groundClutterTextures.length > 0) {
        console.log(`Loaded ${groundClutterTextures.length} ground clutter sprites`);
      } else {
        console.log('No ground clutter sprites found');
      }
    } catch (err) {
      console.error('Failed to load ground clutter:', err);
    }

    // Load large rock sprite sheet (4x3 grid, skip row 2 col 4)
    try {
      const rockSheetLarge = await Assets.load('/rocks_large.png');
      const frameWidth = rockSheetLarge.width / 4;
      const frameHeight = rockSheetLarge.height / 3;

      // Crop top portion to avoid bleeding from cell above (but not for top row)
      const topCrop = frameHeight * 0.15; // Skip top 15% of each cell
      const bottomExtend = 12; // Extend bottom 5 pixels for row 2

      let loadedCount = 0;
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 4; col++) {
          // Skip row 2, column 4 (1-indexed: row=2, col=4 -> 0-indexed: row=1, col=3)
          if (row === 1 && col === 3) {
            continue;
          }
          // Skip row 1, column 3 (1-indexed: row=1, col=3 -> 0-indexed: row=0, col=2)
          if (row === 0 && col === 2) {
            continue;
          }

          // Apply top crop only to rows below the first (to avoid bleed from above)
          let cropAmount = row === 0 ? 0 : topCrop;
          if (row === 2) cropAmount += 5;
          // Extend row 2 (0-indexed row 1) slightly downward
          const extendAmount = row === 1 ? bottomExtend : 0;
          const rect = new Rectangle(
            col * frameWidth,
            row * frameHeight + cropAmount,
            frameWidth,
            frameHeight - cropAmount + extendAmount
          );
          const texture = new Texture({ source: rockSheetLarge.source, frame: rect });
          rockSpritesLarge.push(texture);
          loadedCount++;
        }
      }
    } catch (err) {
      console.error('Failed to load large rock sprite sheet:', err);
    }

    // Load medium rock sprite sheet (1x6 grid)
    try {
      const rockSheetMedium = await Assets.load('/rocks_medium.png');
      const frameWidth = rockSheetMedium.width / 6;
      const frameHeight = rockSheetMedium.height;

      for (let col = 0; col < 6; col++) {
        // Skip column 4 (1-indexed: col=4 -> 0-indexed: col=3)
        if (col === 3) {
          continue;
        }

        const rect = new Rectangle(col * frameWidth, 0, frameWidth, frameHeight);
        const texture = new Texture({ source: rockSheetMedium.source, frame: rect });
        rockSpritesMedium.push(texture);
      }
    } catch (err) {
      console.error('Failed to load medium rock sprite sheet:', err);
    }

    // Load small rock sprite sheet (1x7 grid)
    try {
      const rockSheetSmall = await Assets.load('/rocks_small.png');
      const frameWidth = rockSheetSmall.width / 7;
      const frameHeight = rockSheetSmall.height;

      for (let col = 0; col < 7; col++) {
        const rect = new Rectangle(col * frameWidth, 0, frameWidth, frameHeight);
        const texture = new Texture({ source: rockSheetSmall.source, frame: rect });
        rockSpritesSmall.push(texture);
      }
    } catch (err) {
      console.error('Failed to load small rock sprite sheet:', err);
    }

    // Create world container hierarchy for performance
    // Main container holds all sub-containers
    this.worldContainer = new Container();
    this.worldContainer.sortableChildren = false; // No sorting at top level
    this.worldContainer.cullable = false;
    this.worldContainer.boundsArea = new Rectangle(
      -500, -500,
      this.worldWidth + 1000,
      this.worldHeight + 1000
    );

    // Static layer: ground, rocks (no sorting needed - render order is creation order)
    this.staticContainer = new Container();
    this.staticContainer.sortableChildren = false; // Static objects don't need z-sorting

    // Dynamic layer: ants, food, colony (sorting enabled for depth)
    this.dynamicContainer = new Container();
    this.dynamicContainer.sortableChildren = true; // Only sort dynamic objects

    this.worldContainer.addChild(this.staticContainer);
    this.worldContainer.addChild(this.dynamicContainer);
    this.app.stage.addChild(this.worldContainer);

    // Add textured dirt ground background with Gaussian-distributed patches
    const groundGraphics = new Graphics();
    const borderInset = 2; // Inset to stay within 4px border stroke

    // Base dirt color (slightly darker than backgroundColor)
    groundGraphics.rect(borderInset, borderInset, this.worldWidth - borderInset * 2, this.worldHeight - borderInset * 2);
    groundGraphics.fill({ color: 0xb89968 }); // Darker tan/brown base

    // Helper: Generate Gaussian-distributed random number (Box-Muller transform)
    const gaussianRandom = (mean: number = 0, stdDev: number = 1): number => {
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      return z0 * stdDev + mean;
    };

    // Add random dirt patches with Gaussian distribution
    const patchCount = 800; // Number of patches
    const patchColors = [
      0xc4a57b, // Light tan (matches backgroundColor)
      0xd4b58b, // Lighter tan
      0xa89058, // Darker brown
      0xc0a070, // Medium tan
      0xb0945f, // Medium brown
    ];

    for (let i = 0; i < patchCount; i++) {
      // Gaussian-distributed position (clustered around random centers)
      const centerX = Math.random() * this.worldWidth;
      const centerY = Math.random() * this.worldHeight;
      const offsetX = gaussianRandom(0, 80); // Standard deviation of 80 pixels
      const offsetY = gaussianRandom(0, 80);

      const x = Math.max(borderInset, Math.min(this.worldWidth - borderInset, centerX + offsetX));
      const y = Math.max(borderInset, Math.min(this.worldHeight - borderInset, centerY + offsetY));

      // Gaussian-distributed size (mostly small, occasionally large)
      const baseSize = 40;
      const sizeVariation = Math.abs(gaussianRandom(0, 15));
      const radius = baseSize + sizeVariation;

      // Random color from palette
      const color = patchColors[Math.floor(Math.random() * patchColors.length)];

      // Random opacity (0.1 to 0.4)
      const alpha = 0.1 + Math.random() * 0.3;

      // Draw patch as a soft circle
      groundGraphics.circle(x, y, radius);
      groundGraphics.fill({ color, alpha });
    }

    groundGraphics.zIndex = -1000; // Behind everything else
    this.staticContainer.addChild(groundGraphics);

    // Add ground clutter sprites scattered randomly (decorative shadows)
    if (groundClutterTextures.length > 0) {
      const clutterCount = 600; // Number of clutter sprites to scatter

      for (let i = 0; i < clutterCount; i++) {
        // Pick random clutter texture
        const texture = groundClutterTextures[Math.floor(Math.random() * groundClutterTextures.length)];

        // Random position across entire world
        const x = Math.random() * this.worldWidth;
        const y = Math.random() * this.worldHeight;

        // Create sprite
        const clutterSprite = new Sprite(texture);
        clutterSprite.x = x;
        clutterSprite.y = y;
        clutterSprite.anchor.set(0.5);

        // Random scale (larger for visibility)
        const scale = 0.8 + Math.random() * 0.8; // 0.8 to 1.6x
        clutterSprite.scale.set(scale);

        // Random rotation
        clutterSprite.rotation = Math.random() * Math.PI * 2;

        // More visible alpha
        clutterSprite.alpha = 0.5 + Math.random() * 0.3; // 0.5 to 0.8 alpha

        // Behind most things but above ground
        clutterSprite.zIndex = -900;

        this.staticContainer.addChild(clutterSprite);
      }

      console.log(`Scattered ${clutterCount} ground clutter sprites (decorative, no collision)`);
    } else {
      console.warn('No ground clutter textures loaded! Check /public/1.png through 6.png');
    }

    // Initialize camera
    this.camera = new Camera(this.worldContainer);

    // Reset camera to fit and center world
    const resetCamera = () => {
      const zoomX = this.app.screen.width / this.worldWidth;
      const zoomY = this.app.screen.height / this.worldHeight;
      const fitZoom = Math.min(zoomX, zoomY) * 0.9; // 90% to add some padding

      this.camera.setZoom(fitZoom);
      this.camera.centerOn(
        this.worldWidth / 2,
        this.worldHeight / 2,
        this.app.screen.width,
        this.app.screen.height
      );
    };

    // Initial camera setup - use config zoom and center on colony
    this.camera.setZoom(CONFIG.CAMERA_START_ZOOM);
    this.camera.centerOn(
      this.worldWidth / 2,
      this.worldHeight / 2,
      this.app.screen.width,
      this.app.screen.height
    );

    // Set up spacebar to reset camera (same as initial setup)
    this.camera.setRecenterCallback(resetCamera);

    // Initialize systems (pheromones go in static container so they render below ants)
    this.pheromoneGrid = new PheromoneGrid(
      this.staticContainer,
      this.worldWidth,
      this.worldHeight,
      CONFIG.PHEROMONE_CELL_SIZE
    );

    // Initialize metrics
    this.metrics = new Metrics();

    // Initialize obstacle manager with saved settings FIRST (so rocks exist before food/ants spawn)
    const savedLargeDensityInit = localStorage.getItem('rockSettings.largeDensity');
    const savedLargeSpreadInit = localStorage.getItem('rockSettings.largeSpread');
    const savedMediumDensityInit = localStorage.getItem('rockSettings.mediumDensity');
    const savedMediumSpreadInit = localStorage.getItem('rockSettings.mediumSpread');
    const savedSmallDensityInit = localStorage.getItem('rockSettings.smallDensity');
    const savedSmallSpreadInit = localStorage.getItem('rockSettings.smallSpread');

    // Calculate counts from saved density multipliers
    const worldArea = this.worldWidth * this.worldHeight;
    const largeDensityMult = savedLargeDensityInit ? parseFloat(savedLargeDensityInit) : 1.0;
    const mediumDensityMult = savedMediumDensityInit ? parseFloat(savedMediumDensityInit) : 1.0;
    const smallDensityMult = savedSmallDensityInit ? parseFloat(savedSmallDensityInit) : 1.0;

    const largeCountInit = Math.floor(worldArea * CONFIG.OBSTACLE_DENSITY_LARGE * largeDensityMult);
    const mediumCountInit = Math.floor(worldArea * CONFIG.OBSTACLE_DENSITY_MEDIUM * mediumDensityMult);
    const smallCountInit = Math.floor(worldArea * CONFIG.OBSTACLE_DENSITY_SMALL * smallDensityMult);

    this.obstacleManager = new ObstacleManager(
      this.staticContainer,
      this.worldWidth,
      this.worldHeight,
      largeCountInit,
      mediumCountInit,
      smallCountInit,
      savedLargeSpreadInit ? parseFloat(savedLargeSpreadInit) : undefined,
      savedMediumSpreadInit ? parseFloat(savedMediumSpreadInit) : undefined,
      savedSmallSpreadInit ? parseFloat(savedSmallSpreadInit) : undefined
    );

    // Create colony at center (but don't spawn ants yet)
    this.colony = new Colony(
      { x: this.worldWidth / 2, y: this.worldHeight / 2 },
      this.pheromoneGrid,
      CONFIG.INITIAL_ANT_COUNT,
      this.worldWidth,
      this.worldHeight,
      this.metrics
    );
    this.dynamicContainer.addChild(this.colony.sprite);

    // Initialize food manager (pass obstacles and pheromone grid for spawn avoidance)
    this.foodManager = new FoodManager(
      this.dynamicContainer,
      this.worldWidth,
      this.worldHeight,
      this.obstacleManager,
      this.pheromoneGrid,
      () => this.colony.getAntCount()
    );

    // Now spawn initial ants (after rocks and food are ready)
    this.colony.setWorldContainer(this.dynamicContainer);

    // Draw world boundaries
    this.drawWorldBounds();

    // Setup UI controls
    this.setupUIControls();

    // Start game loop
    this.app.ticker.add((ticker) => this.gameLoop(ticker.deltaTime));

    // Handle window resize
    window.addEventListener('resize', () => this.onResize());

    // Add click handler for ant debugging
    // Track mousedown/mouseup to detect drags vs clicks
    this.app.canvas.addEventListener('mousedown', (e) => {
      this.mouseDownPos = { x: e.clientX, y: e.clientY };
    });

    this.app.canvas.addEventListener('mouseup', (e) => {
      // Only trigger click if mouse hasn't moved much (not a drag)
      if (this.mouseDownPos) {
        const dx = e.clientX - this.mouseDownPos.x;
        const dy = e.clientY - this.mouseDownPos.y;
        const dragDistance = Math.sqrt(dx * dx + dy * dy);

        // Consider it a click if moved less than 5 pixels
        if (dragDistance < 5) {
          this.onCanvasClick(e);
        }
      }
      this.mouseDownPos = null;
    });

    console.log('Game fully initialized!');
    console.log('Colony ants:', this.colony.getAntCount());
    console.log('Food sources:', this.foodManager.getFoodSources().length);
    console.log('Click on any ant to see debug info');
  }

  private drawWorldBounds(): void {
    const bounds = new Container();
    const graphics = new Graphics();

    // Draw boundary rectangle - just stroke, no fill to avoid clipping
    graphics.rect(2, 2, this.worldWidth - 4, this.worldHeight - 4);
    graphics.stroke({ width: 4, color: 0x333333 });

    bounds.addChild(graphics);
    bounds.zIndex = 10000; // Render on top of everything
    this.worldContainer.addChild(bounds);
  }

  private onCanvasClick(e: MouseEvent): void {
    // Get click position relative to canvas
    const rect = this.app.canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to world coordinates
    // Camera container offset is applied to the world, so reverse it
    const worldX = (screenX - this.camera.container.x) / this.camera.zoom;
    const worldY = (screenY - this.camera.container.y) / this.camera.zoom;

    console.log('Click at screen:', screenX.toFixed(0), screenY.toFixed(0), 'world:', worldX.toFixed(0), worldY.toFixed(0), 'zoom:', this.camera.zoom.toFixed(2));

    // Find closest ant within 100 pixels (in world space)
    const ants = this.colony.ants;
    let closestAnt: any = null;
    let closestDist = 100;

    for (const ant of ants) {
      const dx = ant.position.x - worldX;
      const dy = ant.position.y - worldY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < closestDist) {
        closestDist = dist;
        closestAnt = ant;
      }
    }

    if (closestAnt) {
      console.log('Found ant at distance:', closestDist.toFixed(1));
      this.selectedAnt = closestAnt;
      Ant.selectedAntId = closestAnt.id;
      this.showAntDebugPanel(closestAnt);
    } else {
      console.log('No ant found within 100px');
    }
  }

  private showAntDebugPanel(ant: any): void {
    const panel = document.getElementById('antDebugPanel')!;
    panel.style.display = 'block';

    // Update the panel content
    this.updateAntDebugPanel();

    // Draw initial selection indicator
    this.drawSelectionIndicator();
  }

  private updateAntDebugPanel(): void {
    if (!this.selectedAnt) return;

    const ant = this.selectedAnt;
    const content = document.getElementById('antDebugContent')!;

    const speed = Math.sqrt(ant.velocity.x ** 2 + ant.velocity.y ** 2);
    const foodPher = this.pheromoneGrid.getPheromoneLevel(ant.position.x, ant.position.y, 'foodPher');
    const homePher = this.pheromoneGrid.getPheromoneLevel(ant.position.x, ant.position.y, 'homePher');

    // Check nearby obstacles
    const nearbyObstacles = this.obstacleManager.getObstacles().filter((obs: any) => {
      const dx = obs.position.x - ant.position.x;
      const dy = obs.position.y - ant.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < 100;
    });

    let obstacleInfo = '<div class="debug-value">None within 100px</div>';
    if (nearbyObstacles.length > 0) {
      const closest = nearbyObstacles.reduce((closest: any, obs: any) => {
        const dx1 = closest.position.x - ant.position.x;
        const dy1 = closest.position.y - ant.position.y;
        const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

        const dx2 = obs.position.x - ant.position.x;
        const dy2 = obs.position.y - ant.position.y;
        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        return dist2 < dist1 ? obs : closest;
      });

      const dx = closest.position.x - ant.position.x;
      const dy = closest.position.y - ant.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const clearance = dist - closest.radius;

      const clearanceClass = clearance < 20 ? 'debug-error' : clearance < 40 ? 'debug-warning' : 'debug-value';
      obstacleInfo = `
        <div class="debug-row">
          <span class="debug-label">Distance:</span>
          <span class="${clearanceClass}">${dist.toFixed(1)}px</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Clearance:</span>
          <span class="${clearanceClass}">${clearance.toFixed(1)}px</span>
        </div>
        <div class="debug-row">
          <span class="debug-label">Type:</span>
          <span class="debug-value">${closest.sizeCategory}</span>
        </div>
      `;
    }

    const stuckClass = ant.stuckCounter > 0.1 ? 'debug-warning' : ant.stuckCounter > 0.15 ? 'debug-error' : 'debug-value';

    content.innerHTML = `
      <div class="debug-row">
        <span class="debug-label">Position:</span>
        <span class="debug-value">(${Math.round(ant.position.x)}, ${Math.round(ant.position.y)})</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Speed:</span>
        <span class="debug-value">${speed.toFixed(2)}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">State:</span>
        <span class="debug-value">${ant.state === 'FORAGING' ? 'FORAGING' : 'RETURNING'}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Role:</span>
        <span class="debug-value">${ant.role === 'FORAGER' ? 'FORAGER' : 'SCOUT'}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Energy:</span>
        <span class="debug-value">${ant.energy.toFixed(1)}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Carrying:</span>
        <span class="debug-value">${ant.carryingAmount}</span>
      </div>

      <div class="debug-section-title">Behavior</div>
      <div class="debug-row">
        <span class="debug-label">Stuck counter:</span>
        <span class="${stuckClass}">${ant.stuckCounter.toFixed(2)}s (triggers at > 1.0s)</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Recovery cooldown:</span>
        <span class="debug-value">${(ant.unstuckRecoveryCooldown || 0).toFixed(2)}s</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Ignore pheromones:</span>
        <span class="debug-value">${(ant.ignorePheromoneTimer || 0).toFixed(2)}s</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Dist moved:</span>
        <span class="debug-value">${(ant.lastDistMoved || 0).toFixed(3)}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Depenetration:</span>
        <span class="debug-value">${(ant.depenetrationDistThisFrame || 0).toFixed(3)}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Real movement:</span>
        <span class="debug-value">${Math.max(0, (ant.lastDistMoved || 0) - (ant.depenetrationDistThisFrame || 0)).toFixed(3)}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Exploration:</span>
        <span class="debug-value">${ant.explorationCommitment.toFixed(2)}s</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">On trail:</span>
        <span class="debug-value">${ant.onFoodTrail}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Trail latch:</span>
        <span class="debug-value">${ant.trailLatchTimer.toFixed(2)}s</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Trail lock:</span>
        <span class="${ant.trailLockTimer > 0 ? 'debug-warning' : 'debug-value'}">${ant.trailLockTimer > 0 ? ant.trailLockTimer.toFixed(1) + 's' : 'None'}</span>
      </div>

      <div class="debug-section-title">Pheromones</div>
      <div class="debug-row">
        <span class="debug-label">Food:</span>
        <span class="debug-value">${foodPher.toFixed(3)}</span>
      </div>
      <div class="debug-row">
        <span class="debug-label">Home:</span>
        <span class="debug-value">${homePher.toFixed(3)}</span>
      </div>

      <div class="debug-section-title">Nearest Obstacle</div>
      ${obstacleInfo}
    `;
  }

  private drawSelectionIndicator(): void {
    if (!this.selectedAnt) {
      // Remove indicator if no ant selected
      if (this.selectionGraphics) {
        this.worldContainer.removeChild(this.selectionGraphics);
        this.selectionGraphics.destroy();
        this.selectionGraphics = null;
      }
      return;
    }

    // Create indicator if it doesn't exist
    if (!this.selectionGraphics) {
      this.selectionGraphics = new Graphics();
      this.selectionGraphics.zIndex = 10001; // Above everything
      this.worldContainer.addChild(this.selectionGraphics);
    }

    // Clear and redraw to show direction
    this.selectionGraphics.clear();

    // Circle around ant
    this.selectionGraphics.circle(0, 0, 30);
    this.selectionGraphics.stroke({ width: 3, color: 0x00ffff, alpha: 0.8 });

    // Red direction ray
    const ant = this.selectedAnt;
    const heading = Math.atan2(ant.velocity.y, ant.velocity.x);
    const rayLength = 50;
    const rayX = Math.cos(heading) * rayLength;
    const rayY = Math.sin(heading) * rayLength;

    this.selectionGraphics.moveTo(0, 0);
    this.selectionGraphics.lineTo(rayX, rayY);
    this.selectionGraphics.stroke({ width: 4, color: 0xff0000, alpha: 1.0 });

    // Update position to follow ant
    this.selectionGraphics.x = this.selectedAnt.position.x;
    this.selectionGraphics.y = this.selectedAnt.position.y;
  }

  private setupUIControls(): void {
    const speedDisplay = document.getElementById('speedDisplay')!;

    // Copy ant debug info
    const copyAntDebugBtn = document.getElementById('copyAntDebug');
    if (copyAntDebugBtn) {
      copyAntDebugBtn.addEventListener('click', () => {
        if (!this.selectedAnt) return;

        const ant = this.selectedAnt;
        const speed = Math.sqrt(ant.velocity.x ** 2 + ant.velocity.y ** 2);
        const foodPher = this.pheromoneGrid.getPheromoneLevel(ant.position.x, ant.position.y, 'foodPher');
        const homePher = this.pheromoneGrid.getPheromoneLevel(ant.position.x, ant.position.y, 'homePher');

        // Check nearby obstacles
        const nearbyObstacles = this.obstacleManager.getObstacles().filter((obs: any) => {
          const dx = obs.position.x - ant.position.x;
          const dy = obs.position.y - ant.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          return dist < 100;
        });

        let obstacleInfo = 'None within 100px';
        if (nearbyObstacles.length > 0) {
          const closest = nearbyObstacles.reduce((closest: any, obs: any) => {
            const dx1 = closest.position.x - ant.position.x;
            const dy1 = closest.position.y - ant.position.y;
            const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
            const dx2 = obs.position.x - ant.position.x;
            const dy2 = obs.position.y - ant.position.y;
            const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
            return dist2 < dist1 ? obs : closest;
          });

          const dx = closest.position.x - ant.position.x;
          const dy = closest.position.y - ant.position.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clearance = dist - closest.radius;
          obstacleInfo = `Distance: ${dist.toFixed(1)}px, Clearance: ${clearance.toFixed(1)}px, Type: ${closest.sizeCategory}`;
        }

        const debugText = `
Ant Debug Info
==============
Position: (${Math.round(ant.position.x)}, ${Math.round(ant.position.y)})
Velocity: (${ant.velocity.x.toFixed(2)}, ${ant.velocity.y.toFixed(2)})
Speed: ${speed.toFixed(2)}
State: ${ant.state === 'FORAGING' ? 'FORAGING' : 'RETURNING'}
Role: ${ant.role === 'FORAGER' ? 'FORAGER' : 'SCOUT'}
Energy: ${ant.energy.toFixed(1)}
Carrying: ${ant.carryingAmount}

Behavior:
Stuck counter: ${ant.stuckCounter.toFixed(2)}s (triggers at > 1.0s)
Recovery cooldown: ${(ant.unstuckRecoveryCooldown || 0).toFixed(2)}s
Ignore pheromones: ${(ant.ignorePheromoneTimer || 0).toFixed(2)}s
Dist moved: ${(ant.lastDistMoved || 0).toFixed(3)}
Depenetration: ${(ant.depenetrationDistThisFrame || 0).toFixed(3)}
Real movement: ${Math.max(0, (ant.lastDistMoved || 0) - (ant.depenetrationDistThisFrame || 0)).toFixed(3)}
Exploration: ${ant.explorationCommitment.toFixed(2)}s
On trail: ${ant.onFoodTrail}
Trail latch: ${ant.trailLatchTimer.toFixed(2)}s
Trail lock: ${ant.trailLockTimer > 0 ? ant.trailLockTimer.toFixed(1) + 's' : 'None'}

Pheromones:
Food: ${foodPher.toFixed(3)}
Home: ${homePher.toFixed(3)}

Nearest Obstacle:
${obstacleInfo}
        `.trim();

        navigator.clipboard.writeText(debugText).then(() => {
          console.log('Debug info copied to clipboard');
        }).catch(err => {
          console.error('Failed to copy:', err);
        });
      });
    }

    // Unstuck ant button
    const unstuckAntBtn = document.getElementById('unstuckAntBtn');
    if (unstuckAntBtn) {
      unstuckAntBtn.addEventListener('click', () => {
        if (!this.selectedAnt) return;

        console.log('Manually triggering unstuck behavior...');
        // Force stuck counter above threshold to trigger recovery
        this.selectedAnt.stuckCounter = 0.3;
      });
    }

    // Close ant debug panel
    const closeAntDebugBtn = document.getElementById('closeAntDebug');
    if (closeAntDebugBtn) {
      closeAntDebugBtn.addEventListener('click', () => {
        const panel = document.getElementById('antDebugPanel')!;
        panel.style.display = 'none';
        this.selectedAnt = null;
        Ant.selectedAntId = null;
        if (this.selectionGraphics) {
          this.worldContainer.removeChild(this.selectionGraphics);
          this.selectionGraphics.destroy();
          this.selectionGraphics = null;
        }
      });
    }


    // Pause/Play button (starts playing, so show pause icon)
    const pauseBtn = document.getElementById('pauseBtn')!;
    this.isPaused = false;
    pauseBtn.textContent = '||'; // Show pause icon when playing

    pauseBtn.addEventListener('click', () => {
      this.isPaused = !this.isPaused;
      pauseBtn.textContent = this.isPaused ? '▶' : '||';
    });

    // Slow down button
    const slowBtn = document.getElementById('slowBtn')!;
    slowBtn.addEventListener('click', () => {
      if (this.simulationSpeed === 10) {
        this.simulationSpeed = 4;
      } else if (this.simulationSpeed === 4) {
        this.simulationSpeed = 2;
      } else if (this.simulationSpeed === 2) {
        this.simulationSpeed = 1;
      } else if (this.simulationSpeed === 1) {
        this.simulationSpeed = 0.5;
      }
      speedDisplay.textContent = `${this.simulationSpeed}x`;
    });

    // Speed up button
    const fastBtn = document.getElementById('fastBtn')!;
    fastBtn.addEventListener('click', () => {
      if (this.simulationSpeed === 0.5) {
        this.simulationSpeed = 1;
      } else if (this.simulationSpeed === 1) {
        this.simulationSpeed = 2;
      } else if (this.simulationSpeed === 2) {
        this.simulationSpeed = 4;
      } else if (this.simulationSpeed === 4) {
        this.simulationSpeed = 10;
      }
      speedDisplay.textContent = `${this.simulationSpeed}x`;
    });

    // Rock collider toggle (debug)
    const rockColliderBtn = document.getElementById('rockColliderBtn');
    if (rockColliderBtn) {
      rockColliderBtn.addEventListener('click', () => {
        this.showRockColliders = !this.showRockColliders;
        rockColliderBtn.classList.toggle('active', this.showRockColliders);
      });
    }

    // Metrics panel toggle
    const metricsBtn = document.getElementById('metricsBtn');
    const metricsPanel = document.getElementById('metricsPanel');
    if (metricsBtn && metricsPanel) {
      metricsBtn.addEventListener('click', () => {
        const isHidden = metricsPanel.style.display === 'none';
        metricsPanel.style.display = isHidden ? 'block' : 'none';
        metricsBtn.textContent = isHidden ? 'Hide Metrics' : 'Metrics';
      });
    }

    // Debug panel toggle
    const debugBtn = document.getElementById('debugBtn');
    const debugPanel = document.getElementById('debugPanel');
    const rockStats = document.getElementById('rockStats');
    if (debugBtn && debugPanel) {
      debugBtn.addEventListener('click', () => {
        const isHidden = debugPanel.style.display === 'none' || debugPanel.style.display === '';
        debugPanel.style.display = isHidden ? 'block' : 'none';
        debugBtn.textContent = isHidden ? 'Hide Debug' : 'Debug';

        // Toggle rock stats visibility with debug panel
        if (rockStats) {
          rockStats.style.display = isHidden ? 'block' : 'none';
        }
      });
    }

    // Rock distribution sliders (density-based)
    const largeDensitySlider = document.getElementById('largeDensitySlider') as HTMLInputElement;
    const largeDensityValue = document.getElementById('largeDensityValue');
    const largeSpreadSlider = document.getElementById('largeSpreadSlider') as HTMLInputElement;
    const largeSpreadValue = document.getElementById('largeSpreadValue');

    const mediumDensitySlider = document.getElementById('mediumDensitySlider') as HTMLInputElement;
    const mediumDensityValue = document.getElementById('mediumDensityValue');
    const mediumSpreadSlider = document.getElementById('mediumSpreadSlider') as HTMLInputElement;
    const mediumSpreadValue = document.getElementById('mediumSpreadValue');

    const smallDensitySlider = document.getElementById('smallDensitySlider') as HTMLInputElement;
    const smallDensityValue = document.getElementById('smallDensityValue');
    const smallSpreadSlider = document.getElementById('smallSpreadSlider') as HTMLInputElement;
    const smallSpreadValue = document.getElementById('smallSpreadValue');

    // Load saved rock settings from localStorage
    const savedLargeDensity = localStorage.getItem('rockSettings.largeDensity');
    const savedLargeSpread = localStorage.getItem('rockSettings.largeSpread');
    const savedMediumDensity = localStorage.getItem('rockSettings.mediumDensity');
    const savedMediumSpread = localStorage.getItem('rockSettings.mediumSpread');
    const savedSmallDensity = localStorage.getItem('rockSettings.smallDensity');
    const savedSmallSpread = localStorage.getItem('rockSettings.smallSpread');

    if (savedLargeDensity && largeDensitySlider && largeDensityValue) {
      largeDensitySlider.value = savedLargeDensity;
      largeDensityValue.textContent = savedLargeDensity + 'x';
    }
    if (savedLargeSpread && largeSpreadSlider && largeSpreadValue) {
      largeSpreadSlider.value = savedLargeSpread;
      largeSpreadValue.textContent = savedLargeSpread;
    }
    if (savedMediumDensity && mediumDensitySlider && mediumDensityValue) {
      mediumDensitySlider.value = savedMediumDensity;
      mediumDensityValue.textContent = savedMediumDensity + 'x';
    }
    if (savedMediumSpread && mediumSpreadSlider && mediumSpreadValue) {
      mediumSpreadSlider.value = savedMediumSpread;
      mediumSpreadValue.textContent = savedMediumSpread;
    }
    if (savedSmallDensity && smallDensitySlider && smallDensityValue) {
      smallDensitySlider.value = savedSmallDensity;
      smallDensityValue.textContent = savedSmallDensity + 'x';
    }
    if (savedSmallSpread && smallSpreadSlider && smallSpreadValue) {
      smallSpreadSlider.value = savedSmallSpread;
      smallSpreadValue.textContent = savedSmallSpread;
    }

    // Helper function to update rock stats display
    const updateRockStats = () => {
      const counts = this.obstacleManager.getRockCounts();
      const largeRockStat = document.getElementById('largeRockStat');
      const mediumRockStat = document.getElementById('mediumRockStat');
      const smallRockStat = document.getElementById('smallRockStat');

      if (largeRockStat) largeRockStat.textContent = counts.large.toString();
      if (mediumRockStat) mediumRockStat.textContent = counts.medium.toString();
      if (smallRockStat) smallRockStat.textContent = counts.small.toString();
    };

    // Helper function to respawn rocks
    const respawnRocks = () => {
      if (!largeDensitySlider || !mediumDensitySlider || !smallDensitySlider) return;
      if (!largeSpreadSlider || !mediumSpreadSlider || !smallSpreadSlider) return;

      // Calculate counts from density multipliers
      const worldArea = this.worldWidth * this.worldHeight;
      const largeDensityMult = parseFloat(largeDensitySlider.value);
      const mediumDensityMult = parseFloat(mediumDensitySlider.value);
      const smallDensityMult = parseFloat(smallDensitySlider.value);

      const largeCount = Math.floor(worldArea * CONFIG.OBSTACLE_DENSITY_LARGE * largeDensityMult);
      const mediumCount = Math.floor(worldArea * CONFIG.OBSTACLE_DENSITY_MEDIUM * mediumDensityMult);
      const smallCount = Math.floor(worldArea * CONFIG.OBSTACLE_DENSITY_SMALL * smallDensityMult);

      const largeSpread = parseFloat(largeSpreadSlider.value);
      const mediumSpread = parseFloat(mediumSpreadSlider.value);
      const smallSpread = parseFloat(smallSpreadSlider.value);

      // Destroy old obstacles
      this.obstacleManager.destroy();

      // Create new obstacle manager with custom counts
      this.obstacleManager = new ObstacleManager(
        this.staticContainer,
        this.worldWidth,
        this.worldHeight,
        largeCount,
        mediumCount,
        smallCount,
        largeSpread,
        mediumSpread,
        smallSpread
      );

      // Update rock stats display
      updateRockStats();
    };

    // Initial rock stats update
    updateRockStats();

    if (largeDensitySlider && largeDensityValue) {
      largeDensitySlider.addEventListener('input', () => {
        largeDensityValue.textContent = largeDensitySlider.value + 'x';
        localStorage.setItem('rockSettings.largeDensity', largeDensitySlider.value);
        respawnRocks();
      });
      largeDensitySlider.addEventListener('mousedown', (e) => e.stopPropagation());
      largeDensitySlider.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    if (largeSpreadSlider && largeSpreadValue) {
      largeSpreadSlider.addEventListener('input', () => {
        largeSpreadValue.textContent = largeSpreadSlider.value;
        localStorage.setItem('rockSettings.largeSpread', largeSpreadSlider.value);
        respawnRocks();
      });
      largeSpreadSlider.addEventListener('mousedown', (e) => e.stopPropagation());
      largeSpreadSlider.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    if (mediumDensitySlider && mediumDensityValue) {
      mediumDensitySlider.addEventListener('input', () => {
        mediumDensityValue.textContent = mediumDensitySlider.value + 'x';
        localStorage.setItem('rockSettings.mediumDensity', mediumDensitySlider.value);
        respawnRocks();
      });
      mediumDensitySlider.addEventListener('mousedown', (e) => e.stopPropagation());
      mediumDensitySlider.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    if (mediumSpreadSlider && mediumSpreadValue) {
      mediumSpreadSlider.addEventListener('input', () => {
        mediumSpreadValue.textContent = mediumSpreadSlider.value;
        localStorage.setItem('rockSettings.mediumSpread', mediumSpreadSlider.value);
        respawnRocks();
      });
      mediumSpreadSlider.addEventListener('mousedown', (e) => e.stopPropagation());
      mediumSpreadSlider.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    if (smallDensitySlider && smallDensityValue) {
      smallDensitySlider.addEventListener('input', () => {
        smallDensityValue.textContent = smallDensitySlider.value + 'x';
        localStorage.setItem('rockSettings.smallDensity', smallDensitySlider.value);
        respawnRocks();
      });
      smallDensitySlider.addEventListener('mousedown', (e) => e.stopPropagation());
      smallDensitySlider.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    if (smallSpreadSlider && smallSpreadValue) {
      smallSpreadSlider.addEventListener('input', () => {
        smallSpreadValue.textContent = smallSpreadSlider.value;
        localStorage.setItem('rockSettings.smallSpread', smallSpreadSlider.value);
        respawnRocks();
      });
      smallSpreadSlider.addEventListener('mousedown', (e) => e.stopPropagation());
      smallSpreadSlider.addEventListener('touchstart', (e) => e.stopPropagation());
    }

    // Respawn rocks button (now just triggers the same function)
    const respawnRocksBtn = document.getElementById('respawnRocksBtn');
    if (respawnRocksBtn) {
      respawnRocksBtn.addEventListener('click', () => {
        respawnRocks();
      });
    }
  }

  private gameLoop(deltaTime: number): void {
    if (this.isPaused || !this.colony) return;

    const adjustedDelta = deltaTime * this.simulationSpeed;

    // Performance profiling
    const perfStart = performance.now();
    const timings: Record<string, number> = {};

    // Update camera
    let t = performance.now();
    this.camera.update();
    timings.camera = performance.now() - t;

    // Update pheromone grid
    t = performance.now();
    this.pheromoneGrid.update();
    timings.pheromoneUpdate = performance.now() - t;

    // Get camera viewport for culling pheromone rendering
    t = performance.now();
    const viewportBounds = this.camera.getViewportBounds(window.innerWidth, window.innerHeight);
    this.pheromoneGrid.render(true, true, viewportBounds);
    timings.pheromoneRender = performance.now() - t;

    // Update food manager
    t = performance.now();
    this.foodManager.update(adjustedDelta);
    timings.food = performance.now() - t;

    // Render obstacle colliders if debug enabled
    t = performance.now();
    this.obstacleManager.renderDebug(this.showRockColliders);
    timings.obstacleDebug = performance.now() - t;

    // Update colony (pass food sources and obstacles for sensing)
    t = performance.now();
    this.colony.update(adjustedDelta, this.foodManager.getFoodSources(), this.obstacleManager);
    timings.colony = performance.now() - t;

    // Track metrics for all ants
    t = performance.now();
    for (const ant of this.colony.ants) {
      this.metrics.recordStateTime(ant.state === 'FORAGING', adjustedDelta);
    }
    timings.metrics = performance.now() - t;

    // Check ant-food collisions (only for ants not carrying food)
    t = performance.now();
    for (const ant of this.colony.ants) {
      if (!ant.hasFood) {
        const nearbyFood = this.foodManager.checkCollisions(ant.position, CONFIG.ANT_FOOD_PICKUP_RADIUS);
        if (nearbyFood) {
          // Ant takes a chunk based on carrying capacity
          const amountTaken = ant.checkFoodPickup(nearbyFood.position, CONFIG.ANT_FOOD_PICKUP_RADIUS, nearbyFood.id, nearbyFood.amount);
          if (amountTaken > 0) {
            nearbyFood.consume(amountTaken);
          }
        }
      }
    }
    timings.collisions = performance.now() - t;

    // Update UI
    t = performance.now();
    this.updateUI();
    timings.ui = performance.now() - t;

    const totalTime = performance.now() - perfStart;

    // Log performance every 60 frames
    if (this.app.ticker.FPS < 30 && Math.random() < 0.016) {
      console.log('[PERF] Frame time:', totalTime.toFixed(2), 'ms', timings);
    }
  }

  private updateUI(): void {
    this.antCountEl.textContent = this.colony.getAntCount().toString();
    this.foodCountEl.textContent = Math.floor(this.colony.foodStored).toString();
    this.spawnProgressEl.textContent = `${Math.round(this.colony.foodStored * 10) / 10}/${CONFIG.FOOD_COST_TO_SPAWN}`;
    this.generationEl.textContent = this.colony.generation.toString();
    this.fpsEl.textContent = Math.round(this.app.ticker.FPS).toString();

    // Update metrics (every 30 frames for performance)
    if (this.app.ticker.lastTime % 30 === 0) {
      this.tripsPerHourEl.textContent = Math.round(this.metrics.getTripsPerHour()).toString();
      this.avgTripDistEl.textContent = Math.round(this.metrics.getAverageTripDistance()).toString();
      this.foragingPctEl.textContent = `${Math.round(this.metrics.getForagingPercentage())}%`;
      this.returningPctEl.textContent = `${Math.round(this.metrics.getReturningPercentage())}%`;
      this.foodPerMinEl.textContent = this.metrics.getFoodPerMinute().toFixed(1);
    }

    // Update ant debug panel if ant is selected (live updates)
    if (this.selectedAnt) {
      this.updateAntDebugPanel();
      this.drawSelectionIndicator();
    }
  }

  private onResize(): void {
    this.app.renderer.resize(window.innerWidth, window.innerHeight);
  }

  public destroy(): void {
    this.colony.destroy();
    this.foodManager.destroy();
    this.obstacleManager.destroy();
    this.app.destroy(true);
  }
}
