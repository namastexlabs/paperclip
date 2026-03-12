import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import detectPort from "detect-port";
import { applyPendingMigrations } from "@paperclipai/db";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

let pg: EmbeddedPostgresInstance | null = null;
let dataDir: string;

export default async function setup() {
  const port = await detectPort(0);
  // Include port in directory name to avoid conflicts when CI runs parallel jobs
  dataDir = resolve(dirname(fileURLToPath(import.meta.url)), `../../../../tmp-test-pg-${port}`);

  // Clean up any leftover data directory from a previous interrupted run
  rmSync(dataDir, { recursive: true, force: true });

  const EmbeddedPostgres = (await import("embedded-postgres")).default;
  pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();

  const url = `postgresql://postgres:postgres@localhost:${port}/postgres`;
  process.env.TEST_DATABASE_URL = url;

  // Run all Drizzle migrations using the db package's own migrator
  await applyPendingMigrations(url);
}

export async function teardown() {
  if (pg) {
    await pg.stop();
    pg = null;
  }
  rmSync(dataDir, { recursive: true, force: true });
}
