import { ReplayEngine } from "./replay.js";
import { Instance } from "./instance.js";
import type { InstanceOptions, SimulationDefinition } from "./types.js";

export class InstanceManager {
  private instances = new Map<string, Instance>();
  private readonly timer: NodeJS.Timeout;
  private readonly replay: ReplayEngine;
  constructor(
    readonly definition: SimulationDefinition,
    private readonly onDispose: (id: string) => Promise<void> = async () => {},
  ) {
    this.replay = new ReplayEngine(
      definition.captures ?? [],
      definition.replay ?? {},
    );
    this.timer = setInterval(() => {
      for (const instance of this.instances.values())
        if (instance.expiresAt.getTime() < Date.now())
          void this.remove(instance.id).catch((error) =>
            console.error("Could not dispose expired instance", error),
          );
    }, 30_000);
    this.timer.unref();
  }
  create(options: InstanceOptions = {}): Instance {
    const instance = new Instance(this.definition, options, this.replay);
    this.instances.set(instance.id, instance);
    return instance;
  }
  get(id: string): Instance | undefined {
    const instance = this.instances.get(id);
    if (instance && instance.expiresAt.getTime() <= Date.now()) {
      void this.remove(id).catch((error) =>
        console.error("Could not dispose expired instance", error),
      );
      return undefined;
    }
    return instance;
  }
  list(): Instance[] {
    return [...this.instances.values()];
  }
  async remove(id: string): Promise<void> {
    const instance = this.instances.get(id);
    this.instances.delete(id);
    if (!instance) return;
    try {
      await this.onDispose(id);
    } finally {
      await instance.dispose();
    }
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    await Promise.all([...this.instances.keys()].map((id) => this.remove(id)));
  }
}
