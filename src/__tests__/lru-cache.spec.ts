import { describe, expect, it } from "vitest";
import { LruCache } from "../lru-cache";

describe("LruCache", () => {
  it("keeps the most recently used entry at the front", () => {
    const cache = new LruCache<string, number>(3);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    expect([...cache.keys()]).toEqual(["c", "b", "a"]);
    expect(cache.get("b")).toBe(2);
    expect([...cache.keys()]).toEqual(["b", "c", "a"]);
  });

  it("evicts the least recently used entry when capacity is exceeded", () => {
    const cache = new LruCache<string, number>(2);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect([...cache.entries()]).toEqual([
      ["a", 1],
      ["c", 3],
    ]);
    expect([...cache.values()]).toEqual([3, 1]);
  });

  it("updates an existing key without evicting another entry", () => {
    const cache = new LruCache<string, number>(2);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10);

    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(10);
    expect(cache.get("b")).toBe(2);
  });

  it("deletes entries and clears all state", () => {
    const cache = new LruCache<string, number>(2);

    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");

    expect(cache.get("a")).toBeUndefined();
    expect([...cache.keys()]).toEqual(["b"]);

    cache.clear();

    expect(cache.size).toBe(0);
    expect([...cache.entries()]).toEqual([]);
  });
});
