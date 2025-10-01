import { Architect, Network } from 'synaptic';
import { NeuralNetworkConfig, AntGenome, AntRole } from './types';

export class AntBrain {
  private network: Network;
  private config: NeuralNetworkConfig;

  constructor(config: NeuralNetworkConfig, networkJSON?: any) {
    this.config = config;

    if (networkJSON) {
      // Restore from JSON
      this.network = Network.fromJSON(networkJSON);
    } else {
      // Create new random network
      this.network = new Architect.Perceptron(
        config.inputs,
        ...config.hidden,
        config.outputs
      );
    }
  }

  public activate(inputs: number[]): number[] {
    return this.network.activate(inputs);
  }

  public toJSON(): any {
    return this.network.toJSON();
  }

  public clone(): AntBrain {
    // Clone by serializing and deserializing
    return new AntBrain(this.config, this.toJSON());
  }

  public mutate(mutationRate: number): void {
    // Get the network JSON to access connections
    const json = this.network.toJSON();

    // Mutate connection weights
    if (json.connections) {
      for (let conn of json.connections) {
        if (Math.random() < mutationRate) {
          // Add random mutation to weight
          conn.weight += (Math.random() - 0.5) * 0.5;
        }
      }

      // Recreate network from mutated JSON
      this.network = Network.fromJSON(json);
    }
  }
}

export class GenomeFactory {
  public static createWorkerConfig(): NeuralNetworkConfig {
    return {
      inputs: 8,
      hidden: [12, 8],
      outputs: 4,
    };
  }

  public static createGenome(role: AntRole, parentBrain?: AntBrain): AntGenome {
    const config = this.createWorkerConfig();

    if (parentBrain) {
      // Create mutated offspring from parent
      const brain = parentBrain.clone();
      brain.mutate(0.1); // 10% mutation rate

      return {
        role,
        networkWeights: [], // Not used anymore, we use JSON
        mutationRate: 0.1,
      };
    } else {
      // Create random genome
      return {
        role,
        networkWeights: [],
        mutationRate: 0.1,
      };
    }
  }
}
