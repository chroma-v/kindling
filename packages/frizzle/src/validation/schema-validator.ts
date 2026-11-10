// ============================================================================
// SCHEMA VALIDATOR MODULE
// ============================================================================
// Handles schema validation, type checking, range validation, and enum validation

import type { ComparisonNode, ComparisonOperator, FilterNode, SortNode } from "../ast-types.js";
import { foldFilterResult } from "../code-generator.js";
import { describeValue } from "../describe-value.js";
import { ownValue } from "../own-property.js";
import { isKeyword, keywords } from "../reserved-words.js";
import type { Result } from "../result-types.js";
import { createError, createParseError, createSuccess } from "../result-types.js";
import type { FieldType, Schema, SchemaField } from "../schema-types.js";
import { operatorSymbols } from "../schema-types.js";

// ============================================================================
// SCHEMA VALIDATOR CLASS
// ============================================================================

/**
 * Validates queries against a schema, ensuring:
 * - Fields exist in schema
 * - Operators are compatible with field types
 * - Values match expected types
 * - Range constraints are satisfied
 * - Enum values are valid
 * - Nullable constraints are respected
 *
 * @example
 * const schema = {
 *   age: { type: "number", min: 0, max: 120 },
 *   status: { type: "enum", enumValues: ["active", "pending"] },
 * };
 *
 * const validator = new SchemaValidator(schema);
 * const result = validator.validateField("age");
 * if (isSuccess(result)) {
 *   console.log("Field is valid");
 * }
 */
export class SchemaValidator {
  constructor(private schema: Schema) {}

  /**
   * Validates that a field exists in the schema and is not a reserved word.
   *
   * @param field - The field name to validate
   * @returns Success with SchemaField if valid, error otherwise
   */
  validateField(field: string): Result<SchemaField> {
    // Check for reserved words first
    if (isKeyword(field.toLowerCase())) {
      return createError(
        createParseError(
          `Field name '${field}' is a reserved word and cannot be used as a field name. Reserved words: ${keywords.join(", ")}`,
          0,
          "",
          "INVALID_FIELD_NAME",
          field,
          [`Use a different field name that is not a reserved word`],
        ),
      );
    }

    const schemaField = ownValue(this.schema, field);
    if (!schemaField) {
      const availableFields = Object.keys(this.schema);
      const suggestions = availableFields.filter(
        (f) => f.toLowerCase().includes(field.toLowerCase()) || field.toLowerCase().includes(f.toLowerCase()),
      );

      return createError(
        createParseError(
          `Unknown field '${field}'`,
          0,
          "",
          "UNKNOWN_FIELD",
          field,
          suggestions.length > 0 ? suggestions : availableFields.slice(0, 5),
        ),
      );
    }

    return createSuccess(schemaField);
  }

  /**
   * Validates that an operator is supported for a given field type.
   *
   * @param operator - The operator to validate
   * @param field - The field name (for error messages)
   * @param schemaField - The schema field definition
   * @returns Success with typed operator if valid, error otherwise
   */
  validateOperator(operator: string, field: string, schemaField: SchemaField): Result<ComparisonOperator> {
    const validOperator = operator as ComparisonOperator;
    const allowedOperators = schemaField.operators ?? operatorSymbols[schemaField.type];

    if (!allowedOperators.includes(validOperator)) {
      const message = schemaField.operators
        ? `Operator '${operator}' is not allowed for field '${field}'. Allowed: ${allowedOperators.join(", ")}`
        : `Operator '${operator}' not supported for field '${field}' of type '${schemaField.type}'`;
      return createError(createParseError(message, 0, "", "INVALID_OPERATOR", field, allowedOperators));
    }

    return createSuccess(validOperator);
  }

  /**
   * Validates and coerces a value to match the expected field type.
   *
   * Checks:
   * - Nullable constraints
   * - Type compatibility
   * - Range constraints (for numbers)
   * - Enum constraints
   *
   * @param value - The value to validate
   * @param operator - The comparison operator being used
   * @param field - The field name (for error messages)
   * @param schemaField - The schema field definition
   * @returns Success with coerced value if valid, error otherwise
   */
  validateValue(
    value: unknown,
    operator: ComparisonOperator,
    field: string,
    schemaField: SchemaField,
  ): Result<unknown> {
    // Null checks
    if (value === null || value === undefined) {
      if (!schemaField.nullable && operator !== "is_null") {
        return createError(
          createParseError(`Field '${field}' does not accept null values`, 0, "", "INVALID_VALUE", field),
        );
      }
      return createSuccess(value);
    }

    const isList = operator === "in" || operator === "not_in";
    if (isList && Array.isArray(value) && schemaField.maxValues !== undefined && value.length > schemaField.maxValues) {
      return createError(
        createParseError(
          `Field '${field}' accepts at most ${schemaField.maxValues} values; got ${value.length}`,
          0,
          "",
          "LIMIT_EXCEEDED",
          field,
        ),
      );
    }

    // Type validation
    const coercedValue = this.coerceValueToType(value, schemaField.type);
    if (coercedValue === undefined) {
      return createError(
        createParseError(
          `Invalid value '${describeValue(value)}' for field '${field}' of type '${schemaField.type}'`,
          0,
          "",
          "TYPE_MISMATCH",
          field,
        ),
      );
    }

    // Range validation
    if (schemaField.type === "number" && typeof coercedValue === "number") {
      if (schemaField.min !== undefined && coercedValue < schemaField.min) {
        return createError(
          createParseError(
            `Value ${coercedValue} is below minimum ${schemaField.min} for field '${field}'`,
            0,
            "",
            "INVALID_VALUE",
            field,
          ),
        );
      }
      if (schemaField.max !== undefined && coercedValue > schemaField.max) {
        return createError(
          createParseError(
            `Value ${coercedValue} is above maximum ${schemaField.max} for field '${field}'`,
            0,
            "",
            "INVALID_VALUE",
            field,
          ),
        );
      }
    }

    // Enum validation (skip if enumValues is empty — means runtime-populated)
    if (schemaField.type === "enum" && schemaField.enumValues && schemaField.enumValues.length > 0) {
      const valuesToCheck = Array.isArray(coercedValue) ? coercedValue : [coercedValue];
      for (const v of valuesToCheck) {
        if (!schemaField.enumValues.includes(String(v))) {
          return createError(
            createParseError(
              `Value '${v}' is not a valid option for field '${field}'`,
              0,
              "",
              "INVALID_VALUE",
              field,
              schemaField.enumValues,
            ),
          );
        }
      }
    }

    return createSuccess(coercedValue);
  }

  /**
   * Validates a sort node: the field must exist, not be `sortable: false`, and
   * the direction must be `asc` or `desc`.
   *
   * @param node - The sort node to validate
   * @returns Success with the node if valid, error otherwise
   */
  validateSortNode(node: SortNode): Result<SortNode> {
    const fieldResult = this.validateField(node.field);
    if ("error" in fieldResult) {
      return fieldResult;
    }
    if (fieldResult.data.sortable === false) {
      return createError(
        createParseError(`Field '${node.field}' can't be sorted`, 0, "", "UNSORTABLE_FIELD", node.field),
      );
    }
    if (node.direction !== "asc" && node.direction !== "desc") {
      return createError(
        createParseError(
          `Invalid sort direction '${node.direction}' for '${node.field}'. Use asc or desc`,
          0,
          "",
          "INVALID_VALUE",
          node.field,
        ),
      );
    }
    return createSuccess(node);
  }

  /**
   * Validates a complete filter node. Stack-safe at any depth. A chain of one
   * operator comes back nested to the left, as the parser builds it, whichever
   * way it nested in `node`.
   *
   * @param node - The filter node to validate
   * @returns Success with validated (and coerced) node if valid, error otherwise
   */
  validateFilterNode(node: FilterNode): Result<FilterNode> {
    return foldFilterResult<FilterNode>(node, {
      comparison: (comparison) => this.validateComparison(comparison),
      chain: (operands, operator) =>
        createSuccess(operands.reduce((left, right): FilterNode => ({ type: "logical", operator, left, right }))),
      group: (expression, group) => createSuccess({ ...group, expression }),
    });
  }

  private validateComparison(node: ComparisonNode): Result<FilterNode> {
    const fieldResult = this.validateField(node.field);
    if ("error" in fieldResult) {
      return fieldResult;
    }

    const operatorResult = this.validateOperator(node.operator, node.field, fieldResult.data);
    if ("error" in operatorResult) {
      return operatorResult;
    }

    const valueResult = this.validateValue(node.value, operatorResult.data, node.field, fieldResult.data);
    if ("error" in valueResult) {
      return valueResult;
    }

    return createSuccess({
      ...node,
      operator: operatorResult.data,
      value: valueResult.data,
    } as ComparisonNode);
  }

  /**
   * Coerces a value to match the expected field type.
   *
   * @param value - The value to coerce
   * @param fieldType - The target field type
   * @returns Coerced value, or undefined if coercion fails
   *
   * @private
   */
  private coerceValueToType(value: unknown, fieldType: FieldType): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    // Handle arrays (e.g., for `in` / `not_in` / `between` operators)
    if (Array.isArray(value)) {
      const coerced = value.map((item) => this.coerceValueToType(item, fieldType));
      if (coerced.some((v) => v === undefined)) {
        return undefined;
      }
      return coerced;
    }
    // A filter value is a primitive or a Date; any other object has no coercion
    // (String() would accept it as the string "[object Object]").
    const stringValue =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : value instanceof Date && !Number.isNaN(value.getTime())
            ? value.toISOString()
            : undefined;
    if (stringValue === undefined) {
      return undefined;
    }

    switch (fieldType) {
      case "string":
      case "uuid":
      case "enum":
        return stringValue;

      case "number":
        if (/^-?\d+$/.test(stringValue)) {
          return parseInt(stringValue, 10);
        }
        if (/^-?\d+\.\d+$/.test(stringValue)) {
          return parseFloat(stringValue);
        }
        return undefined;

      case "boolean":
        if (stringValue.toLowerCase() === "true") {
          return true;
        }
        if (stringValue.toLowerCase() === "false") {
          return false;
        }
        return undefined;

      case "date": {
        const date = new Date(stringValue);
        return isNaN(date.getTime()) ? undefined : date;
      }

      default:
        return undefined;
    }
  }
}
