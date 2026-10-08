import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestProject } from "vitest/node";

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  runner: vi.fn(),
}));

// Construction runs the real driver's connection string parser, but never connects.
vi.mock("pg", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pg")>();
  return {
    Client: class {
      constructor(config: { connectionString: string }) {
        new actual.Client(config);
        mocks.construct(config);
      }
      connect = mocks.connect;
      query = mocks.query;
      end = mocks.end;
      escapeIdentifier = (value: string) => `"${value}"`;
    },
  };
});
vi.mock("node-pg-migrate", () => ({ runner: mocks.runner }));

import setup from "@/lib/test/global-setup";

const URL_WITH_SECRET = "postgres://hubuser:topsecret@localhost:5432/hub_test";

function driverError(code: string): Error {
  return Object.assign(
    new Error(
      'password authentication failed for user "hubuser" at db.internal.example',
    ),
    { code },
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return String(error);
  }
  throw new Error("expected the promise to reject");
}

function expectSanitised(message: string): void {
  expect(message).not.toContain("hubuser");
  expect(message).not.toContain("topsecret");
  expect(message).not.toContain("db.internal");
  expect(message).not.toContain("localhost");
  expect(message).not.toContain("hub_test");
}

describe("global setup error handling", () => {
  const project = { provide: vi.fn() } as unknown as TestProject;

  beforeEach(() => {
    vi.stubEnv("TEST_DATABASE_URL", URL_WITH_SECRET);
    vi.stubEnv("DATABASE_URL", "postgres://hubuser:topsecret@localhost/hub");
    mocks.connect.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ rowCount: 1 });
    mocks.end.mockResolvedValue(undefined);
    mocks.runner.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("quotes the database name when creating it", async () => {
    mocks.query.mockResolvedValueOnce({ rowCount: 0 });
    await setup(project);
    expect(mocks.query).toHaveBeenLastCalledWith('create database "hub_test"');
  });

  it("does not create a database that already exists", async () => {
    await setup(project);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("sanitises a connect error", async () => {
    mocks.connect.mockRejectedValue(driverError("28P01"));
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(
      /Cannot connect to the PostgreSQL server \(28P01\)/,
    );
    expect(message).toMatch(/npm run db:up/);
    expectSanitised(message);
  });

  it("sanitises an error thrown while constructing the client", async () => {
    mocks.construct.mockImplementation(() => {
      throw new URIError(
        "malformed postgres://hubuser:topsecret@localhost:5432/hub_test",
      );
    });
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(/Cannot connect to the PostgreSQL server/);
    expect(message).toMatch(/npm run db:up/);
    expectSanitised(message);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.runner).not.toHaveBeenCalled();
  });

  it("sanitises the driver's own error for a userinfo it cannot parse (%FF)", async () => {
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgres://hubuser:%FFtopsecret@localhost:5432/hub_test",
    );
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(/Cannot connect to the PostgreSQL server/);
    expectSanitised(message);
    expect(message).not.toContain("%FF");
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.runner).not.toHaveBeenCalled();
    expect(project.provide).not.toHaveBeenCalled();
  });

  it("rejects a URL without a port before touching the driver", async () => {
    vi.stubEnv(
      "TEST_DATABASE_URL",
      "postgres://hubuser:topsecret@localhost/hub_test",
    );
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(/explicit port/);
    expectSanitised(message);
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it("sanitises an error from the existence check and closes the client", async () => {
    mocks.query.mockRejectedValue(driverError("42501"));
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(/Cannot create the test database \(42501\)/);
    expectSanitised(message);
    expect(mocks.end).toHaveBeenCalledTimes(1);
  });

  it("sanitises an error from CREATE DATABASE and closes the client", async () => {
    mocks.query
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockRejectedValueOnce(driverError("42501"));
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(/Cannot create the test database \(42501\)/);
    expectSanitised(message);
    expect(mocks.end).toHaveBeenCalledTimes(1);
    expect(mocks.runner).not.toHaveBeenCalled();
  });

  it("sanitises a migration runner error", async () => {
    mocks.runner.mockRejectedValue(driverError("42601"));
    const message = await rejectionOf(setup(project));
    expect(message).toMatch(
      /Cannot apply the migrations to the test database \(42601\)/,
    );
    expectSanitised(message);
    expect(project.provide).not.toHaveBeenCalled();
  });

  it("drops a code that does not look like an error code", async () => {
    mocks.runner.mockRejectedValue(
      Object.assign(new Error("boom"), { code: "host=db.internal secret" }),
    );
    const message = await rejectionOf(setup(project));
    expect(message).not.toContain("(");
    expectSanitised(message);
  });

  it("handles a thrown non-Error value", async () => {
    mocks.runner.mockRejectedValue("postgres://hubuser:topsecret@localhost/x");
    expectSanitised(await rejectionOf(setup(project)));
  });
});
