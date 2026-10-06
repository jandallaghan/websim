import { useState } from "react";
import { RotateCcw, Square, ExternalLink } from "lucide-react";
import type { InstanceInspection } from "../src/sdk/client.js";
import type { Definition } from "./api.js";
import { Timeline } from "./timeline.js";
import { RemoteBrowser } from "./remote-browser.js";
import { Sources } from "./sources.js";
import { Button } from "./components/ui/button.js";
import { Badge } from "./components/ui/badge.js";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./components/ui/tabs.js";
export function InstancePanel({
  base,
  definition,
  inspection,
  selected,
  busy,
  mutate,
}: {
  base: string;
  definition: Definition;
  inspection?: InstanceInspection;
  selected?: string;
  busy: boolean;
  mutate(action: "open" | "reset" | "delete"): Promise<boolean>;
}) {
  const [tab, setTab] = useState("requests");
  const [view, setView] = useState<string>();
  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="flex min-h-0 flex-1 flex-col gap-0"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-5 py-2">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="state">State</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          {selected && view === selected && (
            <TabsTrigger value="browser">Browser</TabsTrigger>
          )}
        </TabsList>
        <div className="ml-auto flex items-center gap-2">
          {inspection && (
            <Badge variant={inspection.failures ? "destructive" : "outline"}>
              {inspection.failures
                ? `${inspection.failures} failures`
                : "Healthy"}
            </Badge>
          )}
          {selected && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void mutate("open").then((ok) => {
                    if (ok) {
                      setView(selected);
                      setTab("browser");
                    }
                  })
                }
              >
                <ExternalLink />
                Open browser
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setView(undefined);
                  if (tab === "browser") setTab("requests");
                  void mutate("reset");
                }}
              >
                <RotateCcw />
                Reset
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setView(undefined);
                  if (tab === "browser") setTab("requests");
                  void mutate("delete");
                }}
              >
                <Square />
                Stop
              </Button>
            </>
          )}
        </div>
      </div>
      <TabsContent value="requests" className="min-h-0 flex-1 overflow-auto">
        <Timeline
          key={`${selected}-${inspection?.revision}`}
          inspection={inspection}
          selected={selected}
        />
      </TabsContent>
      <TabsContent value="state" className="min-h-0 flex-1 overflow-auto p-5">
        {inspection ? (
          <>
            <div className="mb-3 text-xs text-muted-foreground">
              Revision {inspection.revision}
            </div>
            <pre>{JSON.stringify(inspection.state, null, 2)}</pre>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No instance selected</p>
        )}
      </TabsContent>
      <TabsContent value="sources" className="min-h-0 flex-1 overflow-auto">
        <Sources definition={definition} />
      </TabsContent>
      <TabsContent value="browser" className="min-h-0 flex-1 overflow-hidden">
        {selected && view === selected && (
          <RemoteBrowser
            key={selected}
            base={base}
            id={selected}
            close={() => {
              setView(undefined);
              setTab("requests");
            }}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
