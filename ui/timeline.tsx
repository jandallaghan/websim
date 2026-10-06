import { useState } from "react";
import type { RequestTrace } from "../src/runtime/types.js";
import type { InstanceInspection } from "../src/sdk/client.js";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./components/ui/sheet.js";
import { Input } from "./components/ui/input.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table.js";
export function Timeline({
  inspection,
  selected,
}: {
  inspection?: InstanceInspection;
  selected?: string;
}) {
  const [filter, setFilter] = useState("");
  const [trace, setTrace] = useState<RequestTrace>();
  const rows =
    inspection?.traces
      .filter((row) =>
        JSON.stringify(row).toLowerCase().includes(filter.toLowerCase()),
      )
      .toReversed() ?? [];
  return (
    <>
      <div className="flex items-center gap-3 border-b px-5 py-3">
        <Input
          aria-label="Filter requests"
          placeholder="Filter requests"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="h-8 max-w-xs"
        />
        <span className="text-xs text-muted-foreground">
          {inspection?.requests ?? 0} requests
        </span>
      </div>
      {!rows.length ? (
        <div className="p-5 text-sm text-muted-foreground">
          {!selected
            ? "No instance selected"
            : filter
              ? "No matching requests"
              : "No requests"}
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Method</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5 text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={trace?.id === row.id ? "selected" : undefined}
              >
                <TableCell className="pl-5 font-mono text-xs">
                  {row.method}
                </TableCell>
                <TableCell>
                  <button
                    className="block max-w-[38vw] truncate text-left font-mono text-xs hover:underline"
                    title={row.url}
                    onClick={() => setTrace(row)}
                  >
                    {row.url}
                  </button>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.source.split(":").slice(0, 2).join(" / ")}
                </TableCell>
                <TableCell className={row.diagnostic ? "text-destructive" : ""}>
                  {row.status}
                </TableCell>
                <TableCell className="pr-5 text-right text-xs text-muted-foreground">
                  {row.durationMs} ms
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Sheet
        open={!!trace}
        onOpenChange={(open) => {
          if (!open) setTrace(undefined);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Request detail</SheetTitle>
            <SheetDescription className="break-all font-mono text-xs">
              {trace?.method} {trace?.url}
            </SheetDescription>
          </SheetHeader>
          <pre className="min-h-0 flex-1 px-4 pb-4">
            {JSON.stringify(trace, null, 2)}
          </pre>
        </SheetContent>
      </Sheet>
    </>
  );
}
