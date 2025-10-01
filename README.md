# Ant Colony Simulation with Neural Networks

An evolutionary ant colony simulation where ants use neural networks as brains to forage for food, communicate via pheromone trails, and evolve over generations.

## Features

- **Neural Network Brains**: Each ant has a neural network that controls its behavior
- **Pheromone System**: Ants leave visible pheromone trails to communicate food locations
- **Evolutionary Algorithm**: Successful ants pass their genes to offspring with mutations
- **Realistic Foraging**: Worker ants search for food and return it to the colony
- **Interactive Camera**: Zoom, pan, and explore the colony in real-time

## Controls

- **Arrow Keys / WASD**: Pan camera
- **Mouse Wheel**: Zoom in/out
- **Click & Drag**: Pan camera
- **Pause Button**: Pause/resume simulation
- **Speed Button**: Adjust simulation speed (1x, 2x, 4x)

## Tech Stack

- **TypeScript**: Type-safe game logic
- **PixiJS**: High-performance 2D rendering
- **Synaptic**: Neural network library
- **Vite**: Fast development and building

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## How It Works

### Neural Network Architecture

Each worker ant has a neural network with:
- **8 Inputs**: food proximity, colony direction (x,y), pheromone gradient (x,y), energy level, food carrying status, random exploration factor
- **Hidden Layers**: [12, 8] neurons
- **4 Outputs**: movement direction (x,y), pheromone deposit trigger, food pickup/return action

### Pheromone Trails

- **Green trails**: Food pheromones - deposited when ants return to colony with food
- **Blue trails**: Exploration pheromones - weak trails left while searching
- Pheromones decay over time (99.5% per frame)
- Ants follow pheromone gradients probabilistically

### Evolution

- Colony spawns new ants when food is stored (10 food = 1 ant)
- New ants inherit neural networks from successful parents with mutations
- Natural selection removes weakest ants when population exceeds 50
- Generation counter tracks evolutionary progress

## Project Structure

```
src/
├── main.ts              # Entry point
├── Game.ts              # Main game loop and orchestration
├── Camera.ts            # Camera controls (zoom, pan)
├── Ant.ts               # Ant entity with neural network
├── Colony.ts            # Colony management and reproduction
├── Food.ts              # Food sources and spawning
├── PheromoneGrid.ts     # Pheromone system and rendering
├── NeuralNetwork.ts     # Brain architecture and evolution
├── types.ts             # TypeScript interfaces
└── style.css            # UI styling
```

## Future Enhancements

- Rival colonies competing for resources
- Soldier ant role with combat behavior
- Queen ant with reproductive decisions
- Advanced fitness metrics
- Save/load colony genomes
- Statistics and analytics dashboard
