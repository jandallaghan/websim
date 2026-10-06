import { useState } from "react";
import { Search, Layers } from "lucide-react";
import { Button } from "./components/ui/button.js";
import { Input } from "./components/ui/input.js";
import type { Workspace } from "./use-workbench.js";
export function Sidebar({
  workspace,
  simulation,
  onSelect,
  disabled,
}: {
  workspace?: Workspace;
  simulation?: string;
  onSelect(id: string): void;
  disabled: boolean;
}) {
  const [filter, setFilter] = useState("");
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r bg-muted/30 max-sm:w-40">
      <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
        <Layers className="size-4" />
        websim
      </div>
      <div className="px-3 pt-4">
        <div className="mb-3 text-xs font-medium text-muted-foreground">
          Simulations
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            aria-label="Filter simulations"
            placeholder="Search"
            className="h-8 pl-7"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>
      <nav
        aria-label="Simulations"
        className="flex-1 space-y-1 overflow-auto p-2 pt-3"
      >
        {workspace?.simulations
          .filter((entry) =>
            `${entry.name} ${entry.config}`
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
          .map((entry) => (
            <Button
              key={entry.id}
              aria-label={entry.name}
              variant={simulation === entry.id ? "secondary" : "ghost"}
              className="w-full justify-start font-normal"
              aria-current={simulation === entry.id ? "page" : undefined}
              disabled={disabled}
              title={entry.config}
              onClick={() => onSelect(entry.id)}
            >
              <span className="truncate">{entry.name}</span>
              {entry.running && (
                <span
                  className="ml-auto size-1.5 shrink-0 rounded-full bg-emerald-600"
                  aria-label="Runner active"
                />
              )}
            </Button>
          ))}
      </nav>
    </aside>
  );
}
