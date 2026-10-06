import { useState } from "react";
import { Terminal, X, Folder } from "lucide-react";
import { useWorkbench } from "./use-workbench.js";
import { Sidebar } from "./sidebar.js";
import { InstancePanel } from "./instance-panel.js";
import { Button } from "./components/ui/button.js";
import { InstanceControls } from "./instance-controls.js";
import { api } from "./api.js";

export function App() {
  const workbench = useWorkbench();
  const {
    workspace,
    simulation,
    setSimulation,
    base,
    definition,
    instances,
    selected,
    setSelected,
    inspection,
    seed,
    setSeed,
    error,
    setError,
    busy,
    create,
    mutate,
  } = workbench;
  const [connection, setConnection] = useState<{ id: string; text: string }>();
  const entry = workspace?.simulations.find((entry) => entry.id === simulation);
  async function connect() {
    try {
      const info = await api<{
        url: string;
        token: string;
        browserEndpoint: string;
      }>(`${base}/connection`);
      setConnection({
        id: simulation!,
        text: `WEBSIM_URL=${info.url}\nWEBSIM_TOKEN=${info.token}\nWEBSIM_BROWSER_ENDPOINT=${info.browserEndpoint}`,
      });
    } catch (error) {
      setError(String(error));
    }
  }
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        workspace={workspace}
        simulation={simulation}
        onSelect={(id) => {
          setSimulation(id);
          setConnection(undefined);
        }}
        disabled={busy}
      />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-5 text-sm">
          <span className="text-muted-foreground">
            {workspace?.name ?? "Workspace"}
          </span>
          {entry && (
            <>
              <span className="text-muted-foreground">/</span>
              <h1 className="font-medium">{entry.name}</h1>
            </>
          )}
          {definition && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => void connect()}
            >
              <Terminal />
              Connect
            </Button>
          )}
        </header>
        {error && (
          <div
            role="alert"
            className="flex items-center justify-between border-b bg-red-50 px-5 py-3 text-sm text-destructive"
          >
            {error}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X />
            </Button>
          </div>
        )}
        {connection && connection.id === simulation && (
          <div className="relative border-b bg-muted/40 p-5">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2"
              aria-label="Close connection details"
              onClick={() => setConnection(undefined)}
            >
              <X />
            </Button>
            <pre className="pr-8">{connection?.text}</pre>
          </div>
        )}
        {!entry ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Folder className="mr-2 size-4" />
            {workspace?.simulations.length
              ? "Select a simulation"
              : "No websim.config.ts files found"}
          </div>
        ) : !definition ? (
          <div className="p-5 text-sm text-muted-foreground">
            {error ? "Simulation unavailable" : "Loading simulation…"}
          </div>
        ) : (
          <>
            <InstanceControls
              key={`controls-${simulation}`}
              instances={instances}
              selected={selected}
              select={setSelected}
              definition={definition}
              seed={seed}
              setSeed={setSeed}
              busy={busy}
              create={create}
            />
            <InstancePanel
              key={`panel-${simulation}`}
              base={base}
              definition={definition}
              inspection={inspection}
              selected={selected}
              busy={busy}
              mutate={mutate}
            />
          </>
        )}
      </main>
    </div>
  );
}
