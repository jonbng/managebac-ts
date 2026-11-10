import { expect, test } from "bun:test";
import { RateLimiter } from "../src/internal/rate-limiter.js";

test("limits concurrent work", async () => {
  const limiter = new RateLimiter(1, 0);
  let active = 0;
  let maximum = 0;
  const work = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await Bun.sleep(5);
    active -= 1;
  };
  await Promise.all([limiter.run(work), limiter.run(work), limiter.run(work)]);
  expect(maximum).toBe(1);
});
