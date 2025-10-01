import { Container } from 'pixi.js';

export interface Vector2 {
  x: number;
  y: number;
}

export enum AntRole {
  WORKER = 'WORKER',
  QUEEN = 'QUEEN',
}

export enum AntState {
  FORAGING = 'FORAGING',
  RETURNING = 'RETURNING',
}

export interface NeuralNetworkConfig {
  inputs: number;
  hidden: number[];
  outputs: number;
}

export interface AntGenome {
  role: AntRole;
  networkWeights: number[]; // Flattened weights
  mutationRate: number;
}

export interface Entity {
  position: Vector2;
  sprite: Container;
  update(deltaTime: number): void;
  destroy(): void;
}
