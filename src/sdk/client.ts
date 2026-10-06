import type {
  InstanceInfo,
  InstanceOptions,
  RequestTrace,
  Diagnostic,
} from "../runtime/types.js";
import type { WireRequest, WireResponse } from "../server/protocol.js";
export interface ClientOptions {
  url: string;
  token: string;
}
export interface InstanceInspection extends InstanceInfo {
  state: Record<string, Record<string, unknown>>;
  traces: RequestTrace[];
  diagnostics: Diagnostic[];
}
export class WebsimApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WebsimApiError";
  }
}
export class SimulationRunError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(
      diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"),
    );
    this.name = "SimulationRunError";
  }
}
export class WebsimClient {
  constructor(private readonly options: ClientOptions) {}
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await fetch(new URL(`/api${path}`, this.options.url), {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new WebsimApiError(response.status, await response.text());
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }
  async createInstance(options: InstanceOptions = {}): Promise<InstanceHandle> {
    const info = await this.request<InstanceInfo>(
      "/instances",
      "POST",
      options,
    );
    return this.instance(info.id);
  }
  instance(id: string): InstanceHandle {
    return new InstanceHandle(this, id);
  }
  async listInstances(): Promise<InstanceInfo[]> {
    return this.request("/instances");
  }
}
export class InstanceHandle {
  constructor(
    private readonly client: WebsimClient,
    readonly id: string,
  ) {}
  private path(suffix = ""): string {
    return `/instances/${encodeURIComponent(this.id)}${suffix}`;
  }
  inspect(): Promise<InstanceInspection> {
    return this.client.request(this.path());
  }
  async readState<T>(collection: string, id: string): Promise<T | undefined> {
    return (await this.inspect()).state[collection]?.[id] as T | undefined;
  }
  reset(): Promise<void> {
    return this.client.request(this.path("/reset"), "POST");
  }
  dispose(): Promise<void> {
    return this.client.request(this.path(), "DELETE");
  }
  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }
  dispatch(request: WireRequest): Promise<WireResponse> {
    return this.client.request(this.path("/dispatch"), "POST", request);
  }
  reportFailure(url: string, diagnostic: Diagnostic): Promise<void> {
    return this.client.request(this.path("/diagnostics"), "POST", {
      url,
      diagnostic,
    });
  }
  async assertHealthy(): Promise<void> {
    const { diagnostics } = await this.inspect();
    if (diagnostics.length) throw new SimulationRunError(diagnostics);
  }
}
