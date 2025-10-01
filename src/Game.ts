import { Application, Container, Graphics } from 'pixi.js';
import { Camera } from './Camera';
import { PheromoneGrid } from './PheromoneGrid';
import { Colony } from './Colony';
import { FoodManager } from './Food';
import { ObstacleManager } from './Obstacle';
import { Metrics } from './Metrics';
import * as CONFIG from './config';

export class Game {
  private app: Application;
  private camera!: Camera;
  private worldContainer!: Container;
  private pheromoneGrid!: PheromoneGrid;
  private colony!: Colony;
  private foodManager!: FoodManager;
  private obstacleManager!: ObstacleManager;
  private metrics!: Metrics;

  private isPaused: boolean = false;
  private simulationSpeed: number = 1;
  private worldWidth: number = CONFIG.WORLD_WIDTH;
  private worldHeight: number = CONFIG.WORLD_HEIGHT;
  private showScoutTrails: boolean = true;
  private showForagerTrails: boolean = true;

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
      backgroundColor: 0x0a0a0a,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    console.log('PixiJS initialized');

    // Create world container
    this.worldContainer = new Container();
    this.app.stage.addChild(this.worldContainer);

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

    // Initial camera setup
    resetCamera();

    // Set up spacebar to reset camera (same as initial setup)
    this.camera.setRecenterCallback(resetCamera);

    // Initialize systems
    this.pheromoneGrid = new PheromoneGrid(
      this.worldContainer,
      this.worldWidth,
      this.worldHeight,
      CONFIG.PHEROMONE_CELL_SIZE
    );

    // Initialize metrics
    this.metrics = new Metrics();

    // Create colony at center with more initial ants
    this.colony = new Colony(
      { x: this.worldWidth / 2, y: this.worldHeight / 2 },
      this.pheromoneGrid,
      CONFIG.INITIAL_ANT_COUNT,
      this.worldWidth,
      this.worldHeight,
      this.metrics
    );
    this.worldContainer.addChild(this.colony.sprite);
    this.colony.setWorldContainer(this.worldContainer);

    // Initialize obstacle manager
    this.obstacleManager = new ObstacleManager(
      this.worldContainer,
      this.worldWidth,
      this.worldHeight
    );

    // Initialize food manager (pass obstacles and pheromone grid for spawn avoidance)
    this.foodManager = new FoodManager(
      this.worldContainer,
      this.worldWidth,
      this.worldHeight,
      this.obstacleManager,
      this.pheromoneGrid
    );

    // Draw world boundaries
    this.drawWorldBounds();

    // Setup UI controls
    this.setupUIControls();

    // Start game loop
    this.app.ticker.add((ticker) => this.gameLoop(ticker.deltaTime));

    // Handle window resize
    window.addEventListener('resize', () => this.onResize());

    console.log('Game fully initialized!');
    console.log('Colony ants:', this.colony.getAntCount());
    console.log('Food sources:', this.foodManager.getFoodSources().length);
  }

  private drawWorldBounds(): void {
    const bounds = new Container();
    const graphics = new Graphics();

    // Draw boundary rectangle
    graphics.rect(0, 0, this.worldWidth, this.worldHeight);
    graphics.stroke({ width: 4, color: 0x333333 });

    bounds.addChild(graphics);
    this.worldContainer.addChild(bounds);
  }

  private setupUIControls(): void {
    // Pause button
    const pauseBtn = document.getElementById('pauseBtn')!;
    pauseBtn.addEventListener('click', () => {
      this.isPaused = !this.isPaused;
      pauseBtn.textContent = this.isPaused ? 'Resume' : 'Pause';
    });

    // Speed button
    const speedBtn = document.getElementById('speedBtn')!;
    speedBtn.addEventListener('click', () => {
      if (this.simulationSpeed === 1) {
        this.simulationSpeed = 2;
      } else if (this.simulationSpeed === 2) {
        this.simulationSpeed = 4;
      } else if (this.simulationSpeed === 4) {
        this.simulationSpeed = 10;
      } else {
        this.simulationSpeed = 1;
      }
      speedBtn.textContent = `Speed: ${this.simulationSpeed}x`;
    });

    // Scout trail toggle
    const scoutTrailBtn = document.getElementById('scoutTrailBtn')!;
    scoutTrailBtn.addEventListener('click', () => {
      this.showScoutTrails = !this.showScoutTrails;
      scoutTrailBtn.classList.toggle('active', this.showScoutTrails);
    });

    // Forager trail toggle
    const foragerTrailBtn = document.getElementById('foragerTrailBtn')!;
    foragerTrailBtn.addEventListener('click', () => {
      this.showForagerTrails = !this.showForagerTrails;
      foragerTrailBtn.classList.toggle('active', this.showForagerTrails);
    });
  }

  private gameLoop(deltaTime: number): void {
    if (this.isPaused || !this.colony) return;

    const adjustedDelta = deltaTime * this.simulationSpeed;

    // Update camera
    this.camera.update();

    // Update pheromone grid
    this.pheromoneGrid.update();
    this.pheromoneGrid.render(this.showScoutTrails, this.showForagerTrails);

    // Update food manager
    this.foodManager.update(adjustedDelta);

    // Update colony (pass food sources and obstacles for sensing)
    this.colony.update(adjustedDelta, this.foodManager.getFoodSources(), this.obstacleManager);

    // Track metrics for all ants
    for (const ant of this.colony.ants) {
      this.metrics.recordStateTime(ant.state === 0, adjustedDelta); // 0 = FORAGING
    }

    // Check ant-food collisions (only for ants not carrying food)
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

    // Update UI
    this.updateUI();
  }

  private updateUI(): void {
    this.antCountEl.textContent = this.colony.getAntCount().toString();
    this.foodCountEl.textContent = Math.floor(this.colony.foodStored).toString();
    this.spawnProgressEl.textContent = `${Math.round(this.colony.foodSinceLastSpawn * 10) / 10}/10`;
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
