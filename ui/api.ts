export type Definition = {
  name: string;
  description: string;
  entrypoint: string;
  defaultSeed: string;
  seeds: { name: string; description: string }[];
  modules: { name: string; origin: string; evidence: string }[];
  captures: {
    name: string;
    entries: number;
    warnings: string[];
    startedAt: string;
  }[];
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json();
    throw new Error(detail.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
