// ============================================================================
// OWN-PROPERTY LOOKUPS
// ============================================================================
// Column maps and schemas are plain objects keyed by field names that come
// from user input. `record[field]` would also find Object.prototype members
// (`constructor`, `toString`, `isPrototypeOf`, ...), all valid field names in
// the filter grammar, so every such lookup goes through ownValue.

/** `record[key]` if `key` is the record's own property; `undefined` for inherited ones. */
export const ownValue = <T>(record: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;
