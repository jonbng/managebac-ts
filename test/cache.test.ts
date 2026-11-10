import { expect, test } from "bun:test";
import { MemoryCacheStore } from "../src/cache.js";

test("memory cache evicts the least recently used entry", () => {
  const cache = new MemoryCacheStore({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  expect(cache.get("a")).toBe(1);
  cache.set("c", 3);
  expect(cache.get("a")).toBe(1);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("c")).toBe(3);
});
