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
  seed,
  setSeed,
  busy,
  create,
}: {
  instances: InstanceInfo[];
  selected?: string;
  select(id: string): void;
  definition: Definition;
  seed: string;
  setSeed(seed: string): void;
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
                {instance.seed} · {instance.id.slice(0, 8)}
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
          <label htmlFor="instance-seed" className="mr-1 text-sm">
            {starting ? "Starting state" : "New instance"}
          </label>
          <NativeSelect
            id="instance-seed"
            aria-label="Seed"
            disabled={busy}
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
          >
            {definition.seeds.map((seed) => (
              <NativeSelectOption key={seed.name}>
                {seed.name}
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
