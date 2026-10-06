import { useEffect, useState } from "react";
import { api, type Definition } from "./api.js";
import type { InstanceInfo } from "../src/runtime/types.js";
import type { InstanceInspection } from "../src/sdk/client.js";
export interface Workspace {
  name: string;
  simulations: { id: string; name: string; config: string; running: boolean }[];
}

export function useWorkbench() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [simulation, setSimulation] = useState<string>();
  const [definition, setDefinition] = useState<Definition>();
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [selected, setSelected] = useState<string>();
  const [inspection, setInspection] = useState<InstanceInspection>();
  const [scenario, setScenario] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const base = simulation ? `/simulations/${simulation}` : "";
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<Workspace>("/workspace");
        if (active) setWorkspace(next);
      } catch (error) {
        if (active) setError(String(error));
      }
      if (active) timer = setTimeout(() => void poll(), 3000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    setDefinition(undefined);
    setInstances([]);
    setSelected(undefined);
    setInspection(undefined);
    setError("");
    if (!base) return;
    let active = true;
    void api<Definition>(`${base}/simulation`)
      .then((value) => {
        if (active) {
          setDefinition(value);
          setScenario(value.defaultScenario);
        }
      })
      .catch((error) => {
        if (active) setError(String(error));
      });
    return () => {
      active = false;
    };
  }, [base]);
  useEffect(() => {
    if (!base || !definition) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<InstanceInfo[]>(`${base}/instances`);
        const exists = next.some((instance) => instance.id === selected);
        const detail =
          selected && exists
            ? await api<InstanceInspection>(`${base}/instances/${selected}`)
            : undefined;
        if (active) {
          setInstances(next);
          setInspection(detail);
          if (!exists) setSelected(next[0]?.id);
        }
      } catch (error) {
        if (active) setError(String(error));
      }
      if (active) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, definition, selected, revision]);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setRevision((value) => value + 1);
      return true;
    } catch (error) {
      setError(String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    return act(async () => {
      const instance = await api<InstanceInfo>(`${base}/instances`, "POST", {
        scenario,
      });
      setInstances((current) => [...current, instance]);
      setSelected(instance.id);
    });
  }
  async function mutate(action: "open" | "reset" | "delete") {
    if (!selected) return false;
    return act(async () => {
      await api(
        `${base}/instances/${selected}${action === "delete" ? "" : `/${action}`}`,
        action === "delete" ? "DELETE" : "POST",
      );
      if (action === "delete") {
        setSelected(undefined);
        setInspection(undefined);
      }
    });
  }
  return {
    workspace,
    simulation,
    setSimulation,
    base,
    definition,
    instances,
    selected,
    setSelected,
    inspection,
    scenario,
    setScenario,
    error,
    setError,
    busy,
    create,
    mutate,
  };
}
