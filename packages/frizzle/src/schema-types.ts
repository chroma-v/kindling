// ============================================================================
// SCHEMA TYPES - For validation and type checking
// ============================================================================

import type { ComparisonOperator } from "./ast-types.js";

/**
 * Field types supported by the schema
 */
export type FieldType = "string" | "number" | "boolean" | "date" | "uuid" | "enum";

/**
 * Schema field definition with validation rules
 */
export interface SchemaField {
  readonly type: FieldType;
  /** Operators this field accepts, replacing the defaults for its type. */
  readonly operators?: readonly ComparisonOperator[];
  readonly nullable?: boolean;
  readonly enumValues?: readonly string[];
  /** Smallest allowed value (number fields). */
  readonly min?: number;
  /** Largest allowed value (number fields). Doesn't limit list length; see `maxValues`. */
  readonly max?: number;
  /**
   * Most values an `in` / `not_in` list on this field may hold. Exceeding it is
   * a `LIMIT_EXCEEDED` error. The whole filter's total is capped separately by
   * `maxParameters`.
   */
  readonly maxValues?: number;
  /**
   * Whether the field may be sorted by. Default `true`; set `false` to make
   * schema-aware sort parsing (`parseSort(expr, schema)`, `parseQueryString`
   * with `schema`, `Compiler`) reject it with `UNSORTABLE_FIELD`.
   */
  readonly sortable?: boolean;
}

/**
 * Schema definition - maps field names to their configurations
 */
export type Schema = Record<string, SchemaField>;

const stringOperators: readonly ComparisonOperator[] = [
  "eq",
  "ne",
  "like",
  "ilike",
  "in",
  "not_in",
  "starts_with",
  "ends_with",
  "contains",
  "is_null",
  "is_not_null",
];

const numberOperators: readonly ComparisonOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "between",
  "is_null",
  "is_not_null",
];

const booleanOperators: readonly ComparisonOperator[] = ["eq", "ne", "is_null", "is_not_null"];

const dateOperators: readonly ComparisonOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_null",
  "is_not_null",
];

const uuidOperators: readonly ComparisonOperator[] = ["eq", "ne", "in", "not_in", "is_null", "is_not_null"];

const enumOperators: readonly ComparisonOperator[] = ["eq", "ne", "in", "not_in", "is_null", "is_not_null"];
/**
 * Default operators for each field type
 */
export const operatorSymbols: Record<FieldType, readonly ComparisonOperator[]> = {
  string: stringOperators,
  number: numberOperators,
  boolean: booleanOperators,
  date: dateOperators,
  uuid: uuidOperators,
  enum: enumOperators,
} as const;
