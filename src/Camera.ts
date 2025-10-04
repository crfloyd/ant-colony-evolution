import { Container } from 'pixi.js';
import * as CONFIG from './config';

export class Camera {
  public container: Container;
  public zoom: number = CONFIG.CAMERA_START_ZOOM;
  public minZoom: number = CONFIG.CAMERA_MIN_ZOOM;
  public maxZoom: number = CONFIG.CAMERA_MAX_ZOOM;

  private isDragging: boolean = false;
  private dragStart: { x: number; y: number } = { x: 0, y: 0 };
  private keys: Set<string> = new Set();
  private keysPressed: Set<string> = new Set(); // Track keys that were just pressed
  private moveSpeed: number = CONFIG.CAMERA_MOVE_SPEED;
  private recenterCallback: (() => void) | null = null;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  // Lerp targets for smooth camera movement
  private targetX: number = 0;
  private targetY: number = 0;
  private targetZoom: number = CONFIG.CAMERA_START_ZOOM;
  private lerpSpeed: number = 0.2; // How fast to interpolate (0-1, higher = faster)
  private panLerpSpeed: number = 0.5; // Faster lerp for panning to reduce jerkiness

  // Follow target
  private followTarget: { x: number; y: number } | null = null;
  private followLerpSpeed: number = 0.1; // Smooth following

  constructor(container: Container) {
    this.container = container;
    this.targetX = container.x;
    this.targetY = container.y;
    this.setupControls();
  }

  private setupControls(): void {
    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.key)) {
        this.keysPressed.add(e.key); // Track this as a new press
      }
      this.keys.add(e.key);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key);
      this.keysPressed.delete(e.key);
    });

    // Track mouse position for zoom
    window.addEventListener('mousemove', (e) => {
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    // Mouse wheel zoom - zoom toward mouse position
    window.addEventListener('wheel', (e) => {
      e.preventDefault();

      // Calculate world position under mouse before zoom
      const worldX = (e.clientX - this.container.x) / this.zoom;
      const worldY = (e.clientY - this.container.y) / this.zoom;

      // Apply zoom
      const zoomFactor = e.deltaY > 0 ? CONFIG.CAMERA_ZOOM_OUT_FACTOR : CONFIG.CAMERA_ZOOM_IN_FACTOR;
      const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));

      // Adjust camera position so world point stays under mouse (instant, no lerp)
      this.container.x = e.clientX - worldX * newZoom;
      this.container.y = e.clientY - worldY * newZoom;
      this.targetX = this.container.x;
      this.targetY = this.container.y;

      // Apply zoom instantly too
      this.zoom = newZoom;
      this.targetZoom = newZoom;
      this.container.scale.set(this.zoom);
    }, { passive: false });

    // Click and drag
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click
        this.isDragging = true;
        this.dragStart = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        const dx = e.clientX - this.dragStart.x;
        const dy = e.clientY - this.dragStart.y;

        // Update target position for smooth drag
        this.targetX += dx;
        this.targetY += dy;

        this.dragStart = { x: e.clientX, y: e.clientY };

        // Cancel follow mode when dragging
        this.followTarget = null;
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  public update(): void {
    // If following a target, update camera position to track it
    if (this.followTarget) {
      const viewWidth = window.innerWidth;
      const viewHeight = window.innerHeight;

      // Calculate where target should be on screen (centered)
      const targetScreenX = viewWidth / 2 - this.followTarget.x * this.zoom;
      const targetScreenY = viewHeight / 2 - this.followTarget.y * this.zoom;

      // Smoothly move toward target
      this.targetX += (targetScreenX - this.targetX) * this.followLerpSpeed;
      this.targetY += (targetScreenY - this.targetY) * this.followLerpSpeed;
    }

    // Arrow key movement - use constant speed for smooth consistent panning
    // User input cancels follow mode
    const speed = this.moveSpeed;

    if (this.keys.has('ArrowUp') || this.keys.has('w') || this.keys.has('W')) {
      this.targetY += speed;
      this.followTarget = null; // Cancel follow mode
    }
    if (this.keys.has('ArrowDown') || this.keys.has('s') || this.keys.has('S')) {
      this.targetY -= speed;
      this.followTarget = null;
    }
    if (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A')) {
      this.targetX += speed;
      this.followTarget = null;
    }
    if (this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D')) {
      this.targetX -= speed;
      this.followTarget = null;
    }

    // Q and E for zoom - continuous zoom when held, zoom toward mouse position
    if (this.keys.has('q') || this.keys.has('Q')) {
      // Calculate world position under mouse before zoom
      const worldX = (this.lastMouseX - this.container.x) / this.zoom;
      const worldY = (this.lastMouseY - this.container.y) / this.zoom;

      const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * CONFIG.CAMERA_KEYBOARD_ZOOM_OUT_RATE)); // Gradual zoom out

      // Adjust camera position so world point stays under mouse (instant)
      this.container.x = this.lastMouseX - worldX * newZoom;
      this.container.y = this.lastMouseY - worldY * newZoom;
      this.targetX = this.container.x;
      this.targetY = this.container.y;

      // Apply zoom instantly
      this.zoom = newZoom;
      this.targetZoom = newZoom;
      this.container.scale.set(this.zoom);
    }
    if (this.keys.has('e') || this.keys.has('E')) {
      // Calculate world position under mouse before zoom
      const worldX = (this.lastMouseX - this.container.x) / this.zoom;
      const worldY = (this.lastMouseY - this.container.y) / this.zoom;

      const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * CONFIG.CAMERA_KEYBOARD_ZOOM_IN_RATE)); // Gradual zoom in

      // Adjust camera position so world point stays under mouse (instant)
      this.container.x = this.lastMouseX - worldX * newZoom;
      this.container.y = this.lastMouseY - worldY * newZoom;
      this.targetX = this.container.x;
      this.targetY = this.container.y;

      // Apply zoom instantly
      this.zoom = newZoom;
      this.targetZoom = newZoom;
      this.container.scale.set(this.zoom);
    }

    // Lerp camera position and zoom towards targets
    // Use faster lerp for panning to keep up with keyboard input
    this.container.x += (this.targetX - this.container.x) * this.panLerpSpeed;
    this.container.y += (this.targetY - this.container.y) * this.panLerpSpeed;
    this.zoom += (this.targetZoom - this.zoom) * this.lerpSpeed;
    this.container.scale.set(this.zoom);
  }

  public setRecenterCallback(callback: () => void): void {
    this.recenterCallback = callback;
  }

  public setZoom(newZoom: number): void {
    this.targetZoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    this.zoom = this.targetZoom; // Set immediately for instant response
    this.container.scale.set(this.zoom);
  }

  public centerOn(x: number, y: number, viewWidth: number, viewHeight: number): void {
    // Update both current and target for immediate centering
    this.targetX = viewWidth / 2 - x * this.zoom;
    this.targetY = viewHeight / 2 - y * this.zoom;
    this.container.x = this.targetX;
    this.container.y = this.targetY;
  }

  public getViewportBounds(viewWidth: number, viewHeight: number): { x: number; y: number; width: number; height: number } {
    // Calculate world-space bounds of the visible viewport
    const x = -this.container.x / this.zoom;
    const y = -this.container.y / this.zoom;
    const width = viewWidth / this.zoom;
    const height = viewHeight / this.zoom;
    return { x, y, width, height };
  }

  public followPosition(x: number, y: number): void {
    this.followTarget = { x, y };
  }

  public stopFollowing(): void {
    this.followTarget = null;
  }
}
