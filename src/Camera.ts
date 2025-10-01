import { Container } from 'pixi.js';

export class Camera {
  public container: Container;
  public zoom: number = 0.5;
  public minZoom: number = 0.125;
  public maxZoom: number = 3;

  private isDragging: boolean = false;
  private dragStart: { x: number; y: number } = { x: 0, y: 0 };
  private keys: Set<string> = new Set();
  private moveSpeed: number = 5;
  private recenterCallback: (() => void) | null = null;

  constructor(container: Container) {
    this.container = container;
    this.setupControls();
  }

  private setupControls(): void {
    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key);
    });

    // Mouse wheel zoom
    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.95 : 1.05;
      this.setZoom(this.zoom * zoomFactor);
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

        this.container.x += dx;
        this.container.y += dy;

        this.dragStart = { x: e.clientX, y: e.clientY };
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }

  public update(): void {
    // Space bar to re-center
    if (this.keys.has(' ')) {
      if (this.recenterCallback) {
        this.recenterCallback();
      }
      this.keys.delete(' '); // Remove so it doesn't keep recentering
    }

    // Arrow key movement
    const speed = this.moveSpeed / this.zoom;

    if (this.keys.has('ArrowUp') || this.keys.has('w') || this.keys.has('W')) {
      this.container.y += speed;
    }
    if (this.keys.has('ArrowDown') || this.keys.has('s') || this.keys.has('S')) {
      this.container.y -= speed;
    }
    if (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A')) {
      this.container.x += speed;
    }
    if (this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D')) {
      this.container.x -= speed;
    }

    // Q and E for zoom
    if (this.keys.has('q') || this.keys.has('Q')) {
      this.setZoom(this.zoom * 0.98); // Zoom out
    }
    if (this.keys.has('e') || this.keys.has('E')) {
      this.setZoom(this.zoom * 1.02); // Zoom in
    }
  }

  public setRecenterCallback(callback: () => void): void {
    this.recenterCallback = callback;
  }

  public setZoom(newZoom: number): void {
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
    this.container.scale.set(this.zoom);
  }

  public centerOn(x: number, y: number, viewWidth: number, viewHeight: number): void {
    this.container.x = viewWidth / 2 - x * this.zoom;
    this.container.y = viewHeight / 2 - y * this.zoom;
  }
}
