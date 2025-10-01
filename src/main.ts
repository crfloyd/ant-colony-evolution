import './style.css';
import { Game } from './Game';

// Get canvas element
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;

if (!canvas) {
  throw new Error('Canvas element not found');
}

// Initialize game
const game = new Game(canvas);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  game.destroy();
});

console.log('Ant Colony Simulation Started!');
console.log('Controls:');
console.log('- Arrow keys or WASD: Pan camera');
console.log('- Mouse wheel: Zoom');
console.log('- Click and drag: Pan camera');
