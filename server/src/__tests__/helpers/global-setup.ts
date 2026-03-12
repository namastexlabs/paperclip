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
const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../tmp-test-pg");

export default async function setup() {
  // Clean up any leftover data directory from a previous interrupted run
  rmSync(dataDir, { recursive: true, force: true });

  const port = await detectPort(0);

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
