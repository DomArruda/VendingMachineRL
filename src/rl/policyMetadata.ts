export interface PolicyMetadata {
  name: string;
  algorithm: string;
  trainedAt: string;
  training: Record<string, string | number>;
  evaluation: Record<string, string | number>;
  weightPrecisionDecimals?: number;
}

export function sanitizePolicyMetadata(value: unknown): PolicyMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const cleanValues = (input: unknown): Record<string, string | number> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    const clean = Object.create(null) as Record<string, string | number>;
    for (const [key, entry] of Object.entries(input)) {
      if (key.length > 64) continue;
      if (typeof entry === "string" && entry.length <= 160) clean[key] = entry;
      else if (typeof entry === "number" && Number.isFinite(entry)) clean[key] = entry;
    }
    return clean;
  };
  const weightPrecisionDecimals = raw.weightPrecisionDecimals;
  return {
    name: typeof raw.name === "string" ? raw.name.slice(0, 80) : "Saved PPO",
    algorithm: typeof raw.algorithm === "string" ? raw.algorithm.slice(0, 80) : "PPO",
    trainedAt: typeof raw.trainedAt === "string" ? raw.trainedAt.slice(0, 40) : "",
    training: cleanValues(raw.training),
    evaluation: cleanValues(raw.evaluation),
    ...(typeof weightPrecisionDecimals === "number" &&
    Number.isInteger(weightPrecisionDecimals) &&
    weightPrecisionDecimals >= 0 &&
    weightPrecisionDecimals <= 8
      ? { weightPrecisionDecimals }
      : {}),
  };
}
