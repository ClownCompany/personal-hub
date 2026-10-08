import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getPool: () => ({ query }) }));

import { truncateAllTables } from "@/lib/test/db";

describe("truncateAllTables (mocked pool)", () => {
  beforeEach(() => {
    query.mockReset();
  });

  it.each(["personal_hub", "postgres", "hub_test_", "Hub_TEST", ""])(
    "refuses database %j before running any other query",
    async (name) => {
      query.mockResolvedValueOnce({ rows: [{ name }] });

      const error = await truncateAllTables().catch((e: unknown) => e);

      expect(String(error)).toMatch(/Refusing to truncate/);
      expect(String(error)).not.toContain(name || "unreachable");
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toMatch(/current_database/);
    },
  );

  it("truncates with quoted identifiers in a _test database", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ name: "hub_test" }] })
      .mockResolvedValueOnce({ rows: [{ tablename: 'we"ird' }] })
      .mockResolvedValueOnce({ rows: [] });

    await truncateAllTables();

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0]).toBe(
      'truncate table public."we""ird" restart identity cascade',
    );
  });

  it("does not truncate when there are no tables", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ name: "hub_test" }] })
      .mockResolvedValueOnce({ rows: [] });

    await truncateAllTables();

    expect(query).toHaveBeenCalledTimes(2);
  });
});
