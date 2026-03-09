import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type DBClient = BunSQLiteDatabase<typeof schema>;

export function createDb(dbPath: string): DBClient {
  const sqlite = new Database(dbPath, { create: true, strict: true });
  const db = drizzle(sqlite, { schema });

  db.run(sql`PRAGMA journal_mode = WAL;`);
  db.run(sql`PRAGMA synchronous = NORMAL;`);
  db.run(sql`PRAGMA cache_size = -64000;`);
  db.run(sql`PRAGMA temp_store = MEMORY;`);

  return db;
}
