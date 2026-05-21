import { describe, expect, it, vi } from "vitest";
import { QueriesCache, type QueryCacheObject } from "../cache";

const createCacheObject = (
  overrides: Partial<QueryCacheObject<unknown, unknown>> = {},
): QueryCacheObject<unknown, unknown> => ({
  key: "query",
  promise: Promise.resolve(["data", undefined, undefined]),
  stage: "active",
  expireTime: Date.now() + 1_000,
  cacheScope: "outer",
  waitingQueue: {
    resolves: [],
    rejects: [],
  },
  notifyQueue: new Set(),
  ...overrides,
});

describe("QueriesCache", () => {
  it("marks an existing query cache entry inactive", () => {
    const queries = new QueriesCache<string, Response>(10);
    const entry = createCacheObject({ key: "users" });

    queries.set("users", entry);
    queries.invalidate("users");
    queries.invalidate("missing");

    expect(entry.stage).toBe("inactive");
  });

  it("reports missing and expired entries as stale", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const queries = new QueriesCache<string, Response>(10);

    queries.set(
      "fresh",
      createCacheObject({
        key: "fresh",
        expireTime: Date.now() + 1,
      }),
    );
    queries.set(
      "expired",
      createCacheObject({
        key: "expired",
        expireTime: Date.now(),
      }),
    );

    expect(queries.isStale("missing")).toBe(true);
    expect(queries.isStale("expired")).toBe(true);
    expect(queries.isStale("fresh")).toBe(false);

    vi.useRealTimers();
  });
});
