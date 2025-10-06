import { Container } from 'pixi.js';

export interface Vector2 {
  x: number;
  y: number;
}

export enum AntRole {
  SCOUT = 'SCOUT',
  FORAGER = 'FORAGER',
}

export enum AntState {
  FORAGING = 'FORAGING',
  RETURNING = 'RETURNING',
}

// Scout-specific state machine (Phase 1.3)
export enum ScoutState {
  EXPLORING = 'EXPLORING',
  TAGGING_FOOD = 'TAGGING_FOOD',
  GUARDING_FOOD = 'GUARDING_FOOD',
  ASSISTING_GUARD = 'ASSISTING_GUARD',
  RESPONDING_TO_DISTRESS = 'RESPONDING_TO_DISTRESS'
}

export interface Entity {
  position: Vector2;
  sprite: Container;
  update(deltaTime: number): void;
  destroy(): void;
}
