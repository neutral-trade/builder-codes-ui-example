export function describeRpcError(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return (
      JSON.stringify(value, (_key, nestedValue: unknown) =>
        typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
      ) ?? String(value)
    );
  } catch {
    return String(value);
  }
}
