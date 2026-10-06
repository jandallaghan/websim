export { defineSimulation, SimulationError } from "./runtime/types.js";
export type { StateStore } from "./runtime/state.js";
export type {
  SimulationDefinition,
  SimulationModule,
  SimulationContext,
  SimulationEnv,
  Scenario,
  ScenarioBehavior,
  ReplayPolicy,
  InstanceInfo,
  InstanceOptions,
  RequestTrace,
  Diagnostic,
} from "./runtime/types.js";
export {
  WebsimClient,
  InstanceHandle,
  WebsimApiError,
  SimulationRunError,
} from "./sdk/client.js";
export type { ClientOptions, InstanceInspection } from "./sdk/client.js";
export { createBrowserSession } from "./sdk/browser.js";
export type { BrowserSession } from "./sdk/browser.js";

export { startSandbox } from "./sandbox/index.js";
export type { SandboxOptions } from "./sandbox/index.js";
