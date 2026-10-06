import { DatabaseSync } from "node:sqlite";
import type { StateChange } from "./types.js";

/** JSON documents in named collections, backed by an instance-owned SQLite database. */
export class StateStore {
  private readonly db: DatabaseSync;
  private changes: StateChange[] = [];
  private recording = false;
  beginRecording(): void {
    this.changes = [];
    this.recording = true;
  }
  endRecording(): StateChange[] {
    this.recording = false;
    const changes = this.changes;
    this.changes = [];
    return changes;
  }
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS documents (collection TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (collection, id))",
    );
  }
  get<T>(collection: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM documents WHERE collection = ? AND id = ?")
      .get(collection, id);
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  }
  list<T>(collection: string): T[] {
    return this.db
      .prepare("SELECT value FROM documents WHERE collection = ? ORDER BY id")
      .all(collection)
      .map((row) => JSON.parse(String(row.value)) as T);
  }
  set<T>(collection: string, id: string, value: T): void {
    const before = this.recording ? this.get(collection, id) : undefined;
    this.db
      .prepare(
        "INSERT INTO documents VALUES (?, ?, ?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value",
      )
      .run(collection, id, JSON.stringify(value));
    if (this.recording)
      this.changes.push({
        collection,
        id,
        before,
        after: structuredClone(value),
      });
  }
  delete(collection: string, id: string): void {
    const before = this.recording ? this.get(collection, id) : undefined;
    this.db
      .prepare("DELETE FROM documents WHERE collection = ? AND id = ?")
      .run(collection, id);
    if (this.recording) this.changes.push({ collection, id, before });
  }
  /** Keep transactions synchronous: no network or awaiting inside an atomic state change. */
  transaction<T>(operation: () => T extends Promise<unknown> ? never : T): T {
    const checkpoint = this.changes.length;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      if (result instanceof Promise)
        throw new Error("State transactions must be synchronous");
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.changes.length = checkpoint;
      throw error;
    }
  }
  snapshot(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = Object.create(null);
    for (const row of this.db
      .prepare("SELECT * FROM documents ORDER BY collection,id")
      .all()) {
      const collection = String(row.collection);
      result[collection] ??= Object.create(null) as Record<string, unknown>;
      result[collection]![String(row.id)] = JSON.parse(String(row.value));
    }
    return result;
  }
  clear(): void {
    this.db.exec("DELETE FROM documents");
  }
  close(): void {
    this.db.close();
  }
}
