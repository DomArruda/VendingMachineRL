import { expect, test } from "bun:test";
import {
  loadPolicy,
  sanitizePolicyMetadata,
  type PolicyData,
} from "../src/rl/policyIO";

test("policy loader rejects unsupported network dimensions before allocation", () => {
  const invalid = { obsDim: 1, hidden: 128, weights: [] } as PolicyData;
  expect(() => loadPolicy(invalid)).toThrow("Unsupported policy format");
});

test("saved metadata accepts only bounded primitive values", () => {
  const input = JSON.parse(
    JSON.stringify({
      name: "n".repeat(120),
      algorithm: "PPO",
      training: {
        expertGames: 150,
        nested: { unexpected: true },
        longText: "x".repeat(200),
      },
      evaluation: { meanProfit: 99.3 },
      weightPrecisionDecimals: 99,
    })
  ) as unknown;
  const metadata = sanitizePolicyMetadata(input)!;

  expect(metadata.name).toHaveLength(80);
  expect(metadata.training.expertGames).toBe(150);
  expect(metadata.training.nested).toBeUndefined();
  expect(metadata.training.longText).toBeUndefined();
  expect(metadata.evaluation.meanProfit).toBe(99.3);
  expect(metadata.weightPrecisionDecimals).toBeUndefined();
  expect(Object.getPrototypeOf(metadata.training)).toBeNull();
});
