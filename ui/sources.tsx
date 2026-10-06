import type { Definition } from "./api.js";
import { Badge } from "./components/ui/badge.js";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./components/ui/table.js";
export function Sources({ definition }: { definition: Definition }) {
  return (
    <div className="space-y-6 p-5">
      <section>
        <h2 className="mb-3 text-sm font-medium">Modules</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Origin</TableHead>
              <TableHead>Evidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {definition.modules.map((module) => (
              <TableRow key={module.name}>
                <TableCell>{module.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {module.origin}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{module.evidence}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!definition.modules.length && (
          <p className="py-3 text-sm text-muted-foreground">No modules</p>
        )}
      </section>
      <section>
        <h2 className="mb-3 text-sm font-medium">Captures</h2>
        {definition.captures.map((capture) => (
          <div className="border-b py-3 text-sm" key={capture.name}>
            <div className="flex items-center gap-4">
              <span>{capture.name}</span>
              <span className="text-muted-foreground">
                {capture.entries} responses
              </span>
              {capture.warnings.length > 0 && (
                <Badge variant="destructive">
                  {capture.warnings.length} warnings
                </Badge>
              )}
            </div>
            {capture.warnings.length > 0 && (
              <pre className="mt-2">{capture.warnings.join("\n")}</pre>
            )}
          </div>
        ))}
        {!definition.captures.length && (
          <p className="text-sm text-muted-foreground">No captures</p>
        )}
      </section>
    </div>
  );
}
