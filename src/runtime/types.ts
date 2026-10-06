import type { Hono } from "hono";
import type { StateStore } from "./state.js";
import type { CaptureArchive } from "../capture/archive.js";

/** Immutable scenario settings. Mutable counters and progress belong in state. */
export type ScenarioBehavior = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface SimulationContext {
  readonly behavior: ScenarioBehavior;
  readonly state: StateStore;
  readonly clock: { now(): Date };
  random(): number;
  id(): string;
}
export type SimulationEnv = { Variables: { simulation: SimulationContext } };
export interface SimulationModule {
  name: string;
  /** Exact upstream origin. Modules never accidentally handle another service's routes. */
  origin: string;
  routes: Hono<SimulationEnv>;
  evidence?: "observed" | "inferred" | "authored";
}
export interface Scenario {
  description: string;
  behavior?: ScenarioBehavior;
  /** Runs on instance creation and reset. */
  initialize?(context: SimulationContext): void;
}
export interface ReplayPolicy {
  ignoreQuery?: string[];
  ignoreJsonFields?: string[];
  matchHeaders?: string[];
}
export interface SimulationDefinition {
  name: string;
  description: string;
  entrypoint: string;
  modules: SimulationModule[];
  scenarios: Record<string, Scenario>;
  defaultScenario: string;
  captures?: CaptureArchive[];
  replay?: ReplayPolicy;
}
export function defineSimulation(
  definition: SimulationDefinition,
): SimulationDefinition {
  if (!definition?.scenarios || !Array.isArray(definition.modules))
    throw new Error(
      "Configuration must export a simulation definition or an async factory returning one.",
    );
  if (!definition.scenarios[definition.defaultScenario])
    throw new Error("defaultScenario must name a declared scenario");
  const names = new Set<string>();
  for (const module of definition.modules) {
    if (names.has(module.name))
      throw new Error(`Duplicate module: ${module.name}`);
    names.add(module.name);
    if (new URL(module.origin).origin !== module.origin)
      throw new Error(`Expected an origin: ${module.origin}`);
  }
  new URL(definition.entrypoint);
  return definition;
}
export type FailureCode =
  | "UNMATCHED_REQUEST"
  | "AMBIGUOUS_CAPTURE"
  | "HANDLER_EXCEPTION"
  | "UNSUPPORTED_BEHAVIOR";
const simulationErrorBrand = Symbol.for("@websim/core/SimulationError");
export class SimulationError extends Error {
  readonly [simulationErrorBrand] = true;
  static is(error: unknown): error is SimulationError {
    return (
      error instanceof Error &&
      simulationErrorBrand in error &&
      error[simulationErrorBrand] === true
    );
  }
  constructor(
    readonly code: FailureCode,
    message: string,
  ) {
    super(message);
    this.name = "SimulationError";
  }
}
export interface Diagnostic {
  code: FailureCode;
  message: string;
}
export interface StateChange {
  collection: string;
  id: string;
  before?: unknown;
  after?: unknown;
}
export interface RequestTrace {
  id: string;
  method: string;
  url: string;
  status: number;
  source: string;
  startedAt: string;
  durationMs: number;
  diagnostic?: Diagnostic;
  requestBody?: string;
  responseBody?: string;
  stateChanges?: StateChange[];
}
export interface InstanceOptions {
  scenario?: string;
  time?: string;
  randomSeed?: number;
  ttlMs?: number;
  state?: Record<string, Record<string, unknown>>;
}
export interface InstanceInfo {
  id: string;
  /** Fixed handler time and starting epoch for the browser clock. */
  time: string;
  scenario: string;
  createdAt: string;
  expiresAt: string;
  requests: number;
  failures: number;
  revision: number;
}
