/**
 * An input value as it should read in an error message: strings as-is,
 * anything else as JSON, so an object shows its contents rather than
 * "[object Object]". Never throws (a cycle or BigInt falls back to its tag).
 */
export function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}
