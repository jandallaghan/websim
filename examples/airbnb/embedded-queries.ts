import { z } from "zod";

const query = z.tuple([
  z.string(),
  z.object({ data: z.record(z.string(), z.unknown()) }),
]);
export interface EmbeddedQuery {
  operation: string;
  variables: unknown;
  data: Record<string, unknown>;
}

/** Airbnb embeds GraphQL results in its initial HTML as well as fetching them over HTTP. */
export function embeddedQueries(html: string): EmbeddedQuery[] {
  const results: EmbeddedQuery[] = [];
  function visit(value: unknown) {
    const parsed = query.safeParse(value);
    if (parsed.success) {
      const [key, payload] = parsed.data;
      const separator = key.indexOf(":{");
      if (separator !== -1) {
        results.push({
          operation: key.slice(0, separator),
          variables: JSON.parse(key.slice(separator + 1)),
          data: payload.data,
        });
        return;
      }
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  }
  for (const script of html.matchAll(
    /<script\b[^>]*id="(?:data-injector-instances|data-deferred-state-\d+)"[^>]*>([\s\S]*?)<\/script>/g,
  ))
    visit(JSON.parse(script[1]!));
  return results;
}
