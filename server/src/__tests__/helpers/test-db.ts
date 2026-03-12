import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as dbSchema from "@paperclipai/db";
import type { Db } from "@paperclipai/db";

export type TestDb = {
  db: Db;
  close: () => Promise<void>;
};

/**
 * Returns a Drizzle Db instance connected to the test database,
 * plus a close() function to end the underlying connection pool.
 * Requires global-setup.ts to have set TEST_DATABASE_URL.
 */
export function getTestDb(): TestDb {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Ensure global-setup.ts is configured in vitest.",
    );
  }
  const sql = postgres(url);
  const db = drizzle(sql, { schema: dbSchema });
  return {
    db: db as unknown as Db,
    close: () => sql.end(),
  };
}

/** Shared connection for cleanDb — avoids opening a new pool per beforeEach call. */
let cleanupSql: ReturnType<typeof postgres> | null = null;

/**
 * Truncates all tables in the public schema (except the Drizzle migration journal).
 * Reuses a single connection pool across calls for performance.
 */
export async function cleanDb(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");

  if (!cleanupSql) {
    cleanupSql = postgres(url, { max: 1 });
  }

  const tables = await cleanupSql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '__drizzle_migrations'
  `;

  if (tables.length === 0) return;

  const tableNames = tables.map((t) => `"${t.tablename}"`).join(", ");
  await cleanupSql.unsafe(`TRUNCATE ${tableNames} CASCADE`);
}

/** Close the shared cleanup connection (called from globalTeardown or afterAll). */
export async function closeCleanupConnection(): Promise<void> {
  if (cleanupSql) {
    await cleanupSql.end();
    cleanupSql = null;
  }
}
