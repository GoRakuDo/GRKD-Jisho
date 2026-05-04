const REDACT_PATTERNS = [
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /password/i,
  /authorization/i,
  /cookie/i,
];

export function redactDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const redactedEntries = entries.map(([key, nestedValue]) => {
      const lower = key.toLowerCase();
      if (REDACT_PATTERNS.some((pattern) => pattern.test(lower))) {
        return [key, "[REDACTED]"] as const;
      }
      return [key, redactDeep(nestedValue)] as const;
    });
    return Object.fromEntries(redactedEntries);
  }

  return value;
}
