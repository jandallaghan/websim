import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "./components/ui/button.js";
import {
  NativeSelect,
  NativeSelectOption,
} from "./components/ui/native-select.js";
import type { InstanceInfo } from "../src/runtime/types.js";
import type { Definition } from "./api.js";

export function InstanceControls({
  instances,
  selected,
  select,
  definition,
  scenario,
  setScenario,
  busy,
  create,
}: {
  instances: InstanceInfo[];
  selected?: string;
  select(id: string): void;
  definition: Definition;
  scenario: string;
  setScenario(scenario: string): void;
  busy: boolean;
  create(): Promise<boolean>;
}) {
  const [adding, setAdding] = useState(false);
  const starting = !instances.length;
  return (
    <div className="shrink-0 border-b px-5 py-3">
      {!starting && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Running instances ({instances.length})
          </span>
          <NativeSelect
            aria-label="Instance"
            disabled={busy}
            value={selected ?? ""}
            onChange={(event) => select(event.target.value)}
          >
            {!selected && (
              <NativeSelectOption value="">Select instance</NativeSelectOption>
            )}
            {instances.map((instance) => (
              <NativeSelectOption key={instance.id} value={instance.id}>
                {instance.scenario} · {instance.id.slice(0, 8)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {!adding && (
            <Button
              className="ml-auto"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setAdding(true)}
            >
              <Plus />
              New instance
            </Button>
          )}
        </div>
      )}
      {(starting || adding) && (
        <form
          className={`flex flex-wrap items-center gap-2 ${!starting ? "mt-3 border-t pt-3" : ""}`}
          onSubmit={(event) => {
            event.preventDefault();
            void create().then((ok) => {
              if (ok) setAdding(false);
            });
          }}
        >
          <label htmlFor="instance-scenario" className="mr-1 text-sm">
            Scenario
          </label>
          <NativeSelect
            id="instance-scenario"
            aria-label="Scenario"
            disabled={busy}
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
          >
            {definition.scenarios.map((scenario) => (
              <NativeSelectOption key={scenario.name}>
                {scenario.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button size="sm" disabled={busy} type="submit">
            {busy
              ? "Starting…"
              : starting
                ? "Start instance"
                : "Create instance"}
          </Button>
          {!starting && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
