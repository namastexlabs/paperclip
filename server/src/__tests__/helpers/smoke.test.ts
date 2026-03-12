import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { companies } from "@paperclipai/db";
import { getTestDb, cleanDb } from "./test-db.js";

describe("test harness smoke test", () => {
  const { db, close } = getTestDb();

  afterAll(() => close());

  beforeEach(async () => {
    await cleanDb();
  });

  it("can insert and read back a company", async () => {
    const id = randomUUID();
    const name = "Smoke Test Corp";

    await db.insert(companies).values({ id, name });

    const rows = await db.select().from(companies).where(eq(companies.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].name).toBe(name);
  });
});
