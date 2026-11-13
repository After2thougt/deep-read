import assert from "node:assert/strict";
import { test } from "node:test";
import { getAccountDistribution } from "./adminOverview.js";

test("account distribution reports accurate percentages", () => {
  assert.deepEqual(getAccountDistribution({
    totalUsers: 4,
    activeUsers: 3,
    disabledUsers: 1,
  }), { activePercent: 75, disabledPercent: 25 });
});

test("account distribution handles an empty user base", () => {
  const distribution = getAccountDistribution({
    totalUsers: 0,
    activeUsers: 0,
    disabledUsers: 0,
  });
  assert.deepEqual(distribution, { activePercent: 0, disabledPercent: 0 });
  assert.ok(Number.isFinite(distribution.activePercent));
  assert.ok(Number.isFinite(distribution.disabledPercent));
});
