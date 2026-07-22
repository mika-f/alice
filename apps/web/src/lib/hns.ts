/** HNS uses 6 decimal places (the smallest unit is a "dollarydoo"). */
const HNS_UNIT = 1_000_000n;

export function formatHns(smallestUnit: string | bigint): string {
  const value = typeof smallestUnit === "string" ? BigInt(smallestUnit) : smallestUnit;
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / HNS_UNIT;
  const frac = abs % HNS_UNIT;
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  const body = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${body}` : body;
}

/** Parses a user-typed HNS amount ("1.5") into the smallest-unit decimal string the API expects. */
export function parseHnsToSmallestUnit(input: string): string {
  const trimmed = input.trim();
  const [wholePart, fracPart = ""] = trimmed.split(".");
  const paddedFrac = (fracPart + "000000").slice(0, 6);
  const whole = BigInt(wholePart || "0");
  const frac = BigInt(paddedFrac || "0");
  return (whole * HNS_UNIT + frac).toString();
}
