import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { StateStore } from "./state.js";
import { ReplayEngine } from "./replay.js";
import {
  SimulationError,
  type SimulationDefinition,
  type SimulationContext,
  type InstanceOptions,
  type InstanceInfo,
  type RequestTrace,
  type SimulationEnv,
  type Diagnostic,
} from "./types.js";

/** A FIFO gate makes reset/dispose barriers and state changes deterministic under concurrency. */
export class Instance {
  readonly id = randomUUID();
  readonly state = new StateStore();
  readonly createdAt = new Date();
  readonly expiresAt: Date;
  readonly seed: string;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private traces: RequestTrace[] = [];
  private failures: Diagnostic[] = [];
  private count = 0;
  private revision = 0;
  private context!: SimulationContext;
  private apps = new Map<string, Hono<SimulationEnv>>();
  private overrides = new Map<
    string,
    {
      method: string;
      url: string;
      status: number;
      body: string;
      headers?: Record<string, string>;
      remaining: number;
    }
  >();
  constructor(
    readonly definition: SimulationDefinition,
    private readonly options: InstanceOptions = {},
    private readonly replay = new ReplayEngine(
      definition.captures ?? [],
      definition.replay ?? {},
    ),
  ) {
    this.seed = options.seed ?? definition.defaultSeed;
    if (!definition.seeds[this.seed])
      throw new Error(`Unknown seed: ${this.seed}`);
    this.expiresAt = new Date(Date.now() + (options.ttlMs ?? 3_600_000));
    this.initialize();
    for (const module of definition.modules) {
      const app = new Hono<SimulationEnv>();
      app.use("*", async (c, next) => {
        c.set("simulation", this.context);
        await next();
      });
      // Missing routes fall through; an authored HTTP 404 remains a real application response.
      app.notFound(
        () =>
          new Response(null, {
            status: 404,
            headers: { "x-websim-fallthrough": "1" },
          }),
      );
      app.onError((error) => {
        throw error;
      });
      app.route("/", module.routes);
      this.apps.set(module.name, app);
    }
  }
  private initialize(): void {
    let random = (this.options.randomSeed ?? 1) >>> 0;
    const epoch = this.options.time ?? "2026-01-01T00:00:00.000Z";
    if (!Number.isFinite(Date.parse(epoch)))
      throw new Error("Invalid simulation time");
    this.context = {
      state: this.state,
      clock: { now: () => new Date(epoch) },
      random: () => {
        random = (Math.imul(1664525, random) + 1013904223) >>> 0;
        return random / 4294967296;
      },
      id: () =>
        Array.from({ length: 4 }, () =>
          Math.floor(this.context.random() * 0x100000000)
            .toString(16)
            .padStart(8, "0"),
        ).join(""),
    };
    this.definition.seeds[this.seed]!.apply(this.context);
    for (const [collection, documents] of Object.entries(
      this.options.state ?? {},
    ))
      for (const [id, value] of Object.entries(documents))
        this.state.set(collection, id, value);
  }
  private run<T>(operation: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(() => {
      if (this.closed) throw new Error("Instance is disposed");
      return operation();
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
  info(): InstanceInfo {
    return {
      id: this.id,
      seed: this.seed,
      createdAt: this.createdAt.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
      requests: this.count,
      failures: this.failures.length,
      revision: this.revision,
    };
  }
  inspect() {
    return this.run(() => ({
      ...this.info(),
      state: this.state.snapshot(),
      traces: [...this.traces],
      diagnostics: [...this.failures],
    }));
  }
  reset(): Promise<void> {
    return this.run(() => {
      this.state.clear();
      this.initialize();
      this.traces = [];
      this.failures = [];
      this.count = 0;
      this.overrides.clear();
      this.revision++;
    });
  }
  dispose(): Promise<void> {
    return this.run(() => {
      this.closed = true;
      this.state.close();
    });
  }
  override(value: {
    method: string;
    url: string;
    status: number;
    body: string;
    headers?: Record<string, string>;
    times?: number;
  }): Promise<string> {
    return this.run(() => {
      const id = randomUUID();
      this.overrides.set(id, { ...value, remaining: value.times ?? 1 });
      return id;
    });
  }
  reportFailure(url: string, diagnostic: Diagnostic): Promise<void> {
    return this.run(() => {
      this.failures.push(diagnostic);
      this.traces.push({
        id: randomUUID(),
        method: "CONNECT",
        url,
        status: 0,
        source: "simulation",
        startedAt: new Date().toISOString(),
        durationMs: 0,
        diagnostic,
      });
      this.count++;
      if (this.traces.length > 1000) this.traces.shift();
    });
  }
  dispatch(request: Request): Promise<Response> {
    return this.run(async () => {
      const started = performance.now();
      const trace: RequestTrace = {
        id: randomUUID(),
        method: request.method,
        url: request.url,
        startedAt: new Date().toISOString(),
        durationMs: 0,
        status: 0,
        source: "",
      };
      if (!["GET", "HEAD"].includes(request.method))
        trace.requestBody = (await request.clone().text()).slice(0, 8192);
      this.state.beginRecording();
      let response: Response | undefined;
      try {
        for (const [id, override] of this.overrides) {
          if (
            override.method === request.method &&
            override.url === request.url
          ) {
            response = new Response(
              [204, 205, 304].includes(override.status) ? null : override.body,
              { status: override.status, headers: override.headers },
            );
            if (--override.remaining === 0) this.overrides.delete(id);
            trace.source = `override:${id}`;
            break;
          }
        }
        if (!response)
          for (const module of this.definition.modules) {
            if (module.origin !== new URL(request.url).origin) continue;
            const candidate = await this.apps
              .get(module.name)!
              .fetch(request.clone());
            if (candidate.headers.get("x-websim-fallthrough") !== "1") {
              response = candidate;
              trace.source = `module:${module.name}`;
              break;
            }
          }
        if (!response) {
          const result = await this.replay.match(request.clone());
          response = result?.response;
          trace.source = result?.source ?? "";
        }
        if (!response)
          throw new SimulationError(
            "UNMATCHED_REQUEST",
            `No handler or capture matches ${request.method} ${request.url}`,
          );
      } catch (error) {
        trace.diagnostic = {
          code:
            error instanceof SimulationError ? error.code : "HANDLER_EXCEPTION",
          message: error instanceof Error ? error.message : String(error),
        };
        this.failures.push(trace.diagnostic);
        trace.source = "simulation";
        response = Response.json(
          { websim: trace.diagnostic },
          {
            status: 502,
            headers: { "x-websim-failure": trace.diagnostic.code },
          },
        );
      }
      trace.stateChanges = this.state.endRecording();
      if (/json|text/.test(response.headers.get("content-type") ?? ""))
        trace.responseBody = (await response.clone().text()).slice(0, 8192);
      trace.status = response.status;
      trace.durationMs = Math.round((performance.now() - started) * 100) / 100;
      this.count++;
      this.traces.push(trace);
      if (this.traces.length > 1000) this.traces.shift();
      return response;
    });
  }
}
