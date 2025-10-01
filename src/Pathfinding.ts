import { Vector2 } from './types';

interface PathNode {
  x: number;
  y: number;
  g: number; // Cost from start
  h: number; // Heuristic to goal
  f: number; // Total cost
  parent: PathNode | null;
}

export class Pathfinder {
  private obstacleManager: any;
  private gridSize: number = 40; // Grid cell size for pathfinding

  constructor(obstacleManager: any) {
    this.obstacleManager = obstacleManager;
  }

  public findPath(start: Vector2, goal: Vector2): Vector2[] | null {
    // Convert world positions to grid coordinates
    const startNode: PathNode = {
      x: Math.floor(start.x / this.gridSize),
      y: Math.floor(start.y / this.gridSize),
      g: 0,
      h: this.heuristic(start, goal),
      f: 0,
      parent: null,
    };
    startNode.f = startNode.g + startNode.h;

    const goalNode = {
      x: Math.floor(goal.x / this.gridSize),
      y: Math.floor(goal.y / this.gridSize),
    };

    const openList: PathNode[] = [startNode];
    const closedSet = new Set<string>();

    let iterations = 0;
    const maxIterations = 500; // Prevent infinite loops

    while (openList.length > 0 && iterations < maxIterations) {
      iterations++;

      // Find node with lowest f score
      openList.sort((a, b) => a.f - b.f);
      const current = openList.shift()!;

      // Check if we reached the goal
      if (current.x === goalNode.x && current.y === goalNode.y) {
        return this.reconstructPath(current);
      }

      const currentKey = `${current.x},${current.y}`;
      closedSet.add(currentKey);

      // Check all 8 neighbors
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dx === 0 && dy === 0) continue;

          const neighborX = current.x + dx;
          const neighborY = current.y + dy;
          const neighborKey = `${neighborX},${neighborY}`;

          if (closedSet.has(neighborKey)) continue;

          // Convert back to world coordinates to check obstacle
          const worldX = neighborX * this.gridSize + this.gridSize / 2;
          const worldY = neighborY * this.gridSize + this.gridSize / 2;

          // Check if this cell is blocked by obstacle
          if (this.obstacleManager.checkCollision({ x: worldX, y: worldY }, 15)) {
            continue;
          }

          // Calculate costs
          const isDiagonal = dx !== 0 && dy !== 0;
          const moveCost = isDiagonal ? 1.414 : 1;
          const gScore = current.g + moveCost;

          // Check if neighbor is already in open list
          const existingNode = openList.find(n => n.x === neighborX && n.y === neighborY);

          if (existingNode) {
            if (gScore < existingNode.g) {
              existingNode.g = gScore;
              existingNode.f = gScore + existingNode.h;
              existingNode.parent = current;
            }
          } else {
            const neighbor: PathNode = {
              x: neighborX,
              y: neighborY,
              g: gScore,
              h: this.heuristic({ x: worldX, y: worldY }, goal),
              f: 0,
              parent: current,
            };
            neighbor.f = neighbor.g + neighbor.h;
            openList.push(neighbor);
          }
        }
      }
    }

    // No path found
    return null;
  }

  private heuristic(a: Vector2, b: Vector2): number {
    // Euclidean distance
    const dx = (a.x - b.x) / this.gridSize;
    const dy = (a.y - b.y) / this.gridSize;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private reconstructPath(node: PathNode): Vector2[] {
    const path: Vector2[] = [];
    let current: PathNode | null = node;

    while (current !== null) {
      // Convert grid coordinates back to world coordinates
      path.unshift({
        x: current.x * this.gridSize + this.gridSize / 2,
        y: current.y * this.gridSize + this.gridSize / 2,
      });
      current = current.parent;
    }

    // Simplify path - remove intermediate points that are in a straight line
    if (path.length > 2) {
      const simplified: Vector2[] = [path[0]];

      for (let i = 1; i < path.length - 1; i++) {
        const prev = path[i - 1];
        const curr = path[i];
        const next = path[i + 1];

        // Check if direction changed
        const dir1x = curr.x - prev.x;
        const dir1y = curr.y - prev.y;
        const dir2x = next.x - curr.x;
        const dir2y = next.y - curr.y;

        // Normalize
        const mag1 = Math.sqrt(dir1x * dir1x + dir1y * dir1y);
        const mag2 = Math.sqrt(dir2x * dir2x + dir2y * dir2y);

        if (mag1 > 0 && mag2 > 0) {
          const norm1x = dir1x / mag1;
          const norm1y = dir1y / mag1;
          const norm2x = dir2x / mag2;
          const norm2y = dir2y / mag2;

          // If direction changed significantly, keep this waypoint
          const dot = norm1x * norm2x + norm1y * norm2y;
          if (dot < 0.95) { // Not parallel
            simplified.push(curr);
          }
        }
      }

      simplified.push(path[path.length - 1]);
      return simplified;
    }

    return path;
  }
}
