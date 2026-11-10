// ============================================================================
// SCHEMA VALIDATOR TESTS
// ============================================================================

import { describe, expect, test } from "vitest";
import type { ComparisonNode, FilterNode } from "../ast-types.js";
import { isError, isSuccess } from "../result-types.js";
import type { Schema, SchemaField } from "../schema-types.js";
import { SchemaValidator } from "./schema-validator.js";

// ============================================================================
// TEST SCHEMA
// ============================================================================

const testSchema: Schema = {
  // String fields
  name: { type: "string" },
  email: { type: "string", nullable: true },

  // Number fields
  age: { type: "number", min: 0, max: 120 },
  score: { type: "number" },
  price: { type: "number", min: 0 },

  // Boolean fields
  active: { type: "boolean" },
  verified: { type: "boolean", nullable: true },

  // Date fields
  createdAt: { type: "date" },
  updatedAt: { type: "date", nullable: true },

  // Enum fields
  status: {
    type: "enum",
    enumValues: ["active", "pending", "completed", "cancelled"],
  },
  priority: {
    type: "enum",
    enumValues: ["low", "medium", "high", "urgent"],
    nullable: true,
  },

  // UUID field
  userId: { type: "uuid" },
};

// ============================================================================
// CLASS-BASED TESTS
// ============================================================================

describe("SchemaValidator", () => {
  describe("validateField() method", () => {
    test("validates existing fields", () => {
      const validator = new SchemaValidator(testSchema);

      const nameResult = validator.validateField("name");
      expect(isSuccess(nameResult)).toBe(true);
      if (isSuccess(nameResult)) {
        expect(nameResult.data.type).toBe("string");
      }

      const ageResult = validator.validateField("age");
      expect(isSuccess(ageResult)).toBe(true);
      if (isSuccess(ageResult)) {
        expect(ageResult.data.type).toBe("number");
        expect(ageResult.data.min).toBe(0);
        expect(ageResult.data.max).toBe(120);
      }
    });

    test("rejects unknown fields", () => {
      const validator = new SchemaValidator(testSchema);

      const result = validator.validateField("unknownField");
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("UNKNOWN_FIELD");
        expect(result.error.message).toContain("Unknown field");
      }
    });

    test("provides suggestions for similar fields", () => {
      const validator = new SchemaValidator(testSchema);

      const result = validator.validateField("nam");
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.suggestions).toContain("name");
      }
    });

    test("rejects reserved words", () => {
      const validator = new SchemaValidator(testSchema);

      // Use actual reserved words from the RESERVED_WORDS list
      const reservedWords = ["and", "or", "eq", "ne", "like", "in", "between"];
      reservedWords.forEach((word) => {
        const result = validator.validateField(word);
        expect(isError(result), `Should reject reserved word: ${word}`).toBe(true);
        if (isError(result)) {
          expect(result.error.code).toBe("INVALID_FIELD_NAME");
          expect(result.error.message).toContain("reserved word");
        }
      });
    });
  });

  describe("validateOperator() method", () => {
    const validator = new SchemaValidator(testSchema);

    test("validates compatible operators for string fields", () => {
      const stringField: SchemaField = { type: "string" };

      const validOperators = ["eq", "ne", "like", "ilike", "starts_with", "ends_with", "contains"];
      validOperators.forEach((op) => {
        const result = validator.validateOperator(op, "name", stringField);
        expect(isSuccess(result), `Operator ${op} should be valid for strings`).toBe(true);
      });
    });

    test("validates compatible operators for number fields", () => {
      const numberField: SchemaField = { type: "number" };

      const validOperators = ["eq", "ne", "gt", "gte", "lt", "lte", "between"];
      validOperators.forEach((op) => {
        const result = validator.validateOperator(op, "age", numberField);
        expect(isSuccess(result), `Operator ${op} should be valid for numbers`).toBe(true);
      });
    });

    test("rejects incompatible operators", () => {
      const numberField: SchemaField = { type: "number" };

      const result = validator.validateOperator("like", "age", numberField);
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("INVALID_OPERATOR");
        expect(result.error.message).toContain("not supported");
      }
    });

    test("respects custom operator lists", () => {
      const customField: SchemaField = {
        type: "string",
        operators: ["eq", "ne"], // Only equality operators
      };

      const equalityResult = validator.validateOperator("eq", "custom", customField);
      expect(isSuccess(equalityResult)).toBe(true);

      const likeResult = validator.validateOperator("like", "custom", customField);
      expect(isError(likeResult)).toBe(true);
      if (isError(likeResult)) {
        // The field's allowlist rejected it, not its type (strings support like)
        expect(likeResult.error.message).toBe("Operator 'like' is not allowed for field 'custom'. Allowed: eq, ne");
        expect(likeResult.error.suggestions).toEqual(["eq", "ne"]);
      }
    });
  });

  describe("validateValue() method", () => {
    const validator = new SchemaValidator(testSchema);

    test("validates and coerces string values", () => {
      const stringField: SchemaField = { type: "string" };

      const result = validator.validateValue("John Doe", "eq", "name", stringField);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toBe("John Doe");
      }
    });

    test("validates and coerces number values", () => {
      const numberField: SchemaField = { type: "number" };

      const intResult = validator.validateValue("25", "eq", "age", numberField);
      expect(isSuccess(intResult)).toBe(true);
      if (isSuccess(intResult)) {
        expect(intResult.data).toBe(25);
        expect(typeof intResult.data).toBe("number");
      }

      const floatResult = validator.validateValue("3.14", "eq", "score", numberField);
      expect(isSuccess(floatResult)).toBe(true);
      if (isSuccess(floatResult)) {
        expect(floatResult.data).toBe(3.14);
      }
    });

    test("validates and coerces boolean values", () => {
      const boolField: SchemaField = { type: "boolean" };

      const trueResult = validator.validateValue("true", "eq", "active", boolField);
      expect(isSuccess(trueResult)).toBe(true);
      if (isSuccess(trueResult)) {
        expect(trueResult.data).toBe(true);
      }

      const falseResult = validator.validateValue("false", "eq", "active", boolField);
      expect(isSuccess(falseResult)).toBe(true);
      if (isSuccess(falseResult)) {
        expect(falseResult.data).toBe(false);
      }
    });

    test("validates and coerces date values", () => {
      const dateField: SchemaField = { type: "date" };

      const result = validator.validateValue("2025-01-15", "eq", "createdAt", dateField);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toBeInstanceOf(Date);
      }
    });

    test("rejects invalid type coercion", () => {
      const numberField: SchemaField = { type: "number" };

      const result = validator.validateValue("not a number", "eq", "age", numberField);
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("TYPE_MISMATCH");
      }
    });

    test("accepts a Date value for a date field", () => {
      const dateField: SchemaField = { type: "date" };
      const when = new Date("2025-01-15T10:30:00.250Z");

      const result = validator.validateValue(when, "eq", "createdAt", dateField);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toEqual(when);
      }
    });

    test("rejects an object value instead of coercing it to '[object Object]'", () => {
      const stringField: SchemaField = { type: "string" };

      const result = validator.validateValue({ nested: true }, "eq", "name", stringField);
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("TYPE_MISMATCH");
        expect(result.error.message).toContain('{"nested":true}');
      }
    });

    test("validates range constraints for numbers", () => {
      const ageField: SchemaField = { type: "number", min: 0, max: 120 };

      const validResult = validator.validateValue("25", "eq", "age", ageField);
      expect(isSuccess(validResult)).toBe(true);

      const belowMinResult = validator.validateValue("-5", "eq", "age", ageField);
      expect(isError(belowMinResult)).toBe(true);
      if (isError(belowMinResult)) {
        expect(belowMinResult.error.message).toContain("below minimum");
      }

      const aboveMaxResult = validator.validateValue("150", "eq", "age", ageField);
      expect(isError(aboveMaxResult)).toBe(true);
      if (isError(aboveMaxResult)) {
        expect(aboveMaxResult.error.message).toContain("above maximum");
      }
    });

    test("validates enum constraints", () => {
      const statusField: SchemaField = {
        type: "enum",
        enumValues: ["active", "pending", "completed"],
      };

      const validResult = validator.validateValue("active", "eq", "status", statusField);
      expect(isSuccess(validResult)).toBe(true);

      const invalidResult = validator.validateValue("invalid", "eq", "status", statusField);
      expect(isError(invalidResult)).toBe(true);
      if (isError(invalidResult)) {
        expect(invalidResult.error.code).toBe("INVALID_VALUE");
        expect(invalidResult.error.suggestions).toContain("active");
      }
    });

    test("skips enum validation when enumValues is empty (runtime-populated)", () => {
      const runtimeEnumField: SchemaField = {
        type: "enum",
        enumValues: [],
      };

      const result = validator.validateValue("any_value", "eq", "status", runtimeEnumField);
      expect(isSuccess(result)).toBe(true);
    });

    test("validates nullable constraints", () => {
      const nonNullableField: SchemaField = { type: "string", nullable: false };
      const nullableField: SchemaField = { type: "string", nullable: true };

      const nonNullableResult = validator.validateValue(null, "eq", "name", nonNullableField);
      expect(isError(nonNullableResult)).toBe(true);
      if (isError(nonNullableResult)) {
        expect(nonNullableResult.error.message).toContain("does not accept null");
      }

      const nullableResult = validator.validateValue(null, "eq", "email", nullableField);
      expect(isSuccess(nullableResult)).toBe(true);
    });

    test("allows null for is_null operator", () => {
      const nonNullableField: SchemaField = { type: "string", nullable: false };

      const result = validator.validateValue(null, "is_null", "name", nonNullableField);
      expect(isSuccess(result)).toBe(true);
    });
  });

  describe("validateFilterNode() method", () => {
    const validator = new SchemaValidator(testSchema);

    test("validates comparison nodes", () => {
      const node: ComparisonNode = {
        type: "comparison",
        field: "age",
        operator: "gte",
        value: "18",
      };

      const result = validator.validateFilterNode(node);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data.type).toBe("comparison");
        expect((result.data as ComparisonNode).value).toBe(18); // Coerced to number
      }
    });

    test("validates logical nodes recursively", () => {
      const node: FilterNode = {
        type: "logical",
        operator: "and",
        left: {
          type: "comparison",
          field: "age",
          operator: "gte",
          value: "18",
        },
        right: {
          type: "comparison",
          field: "status",
          operator: "eq",
          value: "active",
        },
      };

      const result = validator.validateFilterNode(node);
      expect(isSuccess(result)).toBe(true);
    });

    test("validates group nodes recursively", () => {
      const node: FilterNode = {
        type: "group",
        expression: {
          type: "comparison",
          field: "age",
          operator: "gte",
          value: "18",
        },
      };

      const result = validator.validateFilterNode(node);
      expect(isSuccess(result)).toBe(true);
    });

    test("propagates errors from nested nodes", () => {
      const node: FilterNode = {
        type: "logical",
        operator: "and",
        left: {
          type: "comparison",
          field: "unknownField", // Invalid field
          operator: "eq",
          value: "test",
        },
        right: {
          type: "comparison",
          field: "age",
          operator: "gte",
          value: "18",
        },
      };

      const result = validator.validateFilterNode(node);
      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("UNKNOWN_FIELD");
      }
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Schema Integration", () => {
  test("validates complex multi-field queries", () => {
    const validator = new SchemaValidator(testSchema);

    const complexNode: FilterNode = {
      type: "logical",
      operator: "and",
      left: {
        type: "group",
        expression: {
          type: "logical",
          operator: "or",
          left: {
            type: "comparison",
            field: "age",
            operator: "gte",
            value: "18",
          },
          right: {
            type: "comparison",
            field: "age",
            operator: "lte",
            value: "65",
          },
        },
      },
      right: {
        type: "comparison",
        field: "status",
        operator: "eq",
        value: "active",
      },
    };

    const result = validator.validateFilterNode(complexNode);
    expect(isSuccess(result)).toBe(true);
  });

  test("validates all field types together", () => {
    const validator = new SchemaValidator(testSchema);

    const fields = [
      { field: "name", operator: "eq", value: "John" },
      { field: "age", operator: "gte", value: "18" },
      { field: "active", operator: "eq", value: "true" },
      { field: "createdAt", operator: "gte", value: "2025-01-01" },
      { field: "status", operator: "eq", value: "active" },
    ];

    fields.forEach(({ field, operator, value }) => {
      const fieldResult = validator.validateField(field);
      expect(isSuccess(fieldResult)).toBe(true);

      if (isSuccess(fieldResult)) {
        const opResult = validator.validateOperator(operator, field, fieldResult.data);
        expect(isSuccess(opResult)).toBe(true);

        if (isSuccess(opResult)) {
          const valResult = validator.validateValue(value, opResult.data, field, fieldResult.data);
          expect(isSuccess(valResult)).toBe(true);
        }
      }
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge Cases", () => {
  test("handles empty schema", () => {
    const emptySchema: Schema = {};
    const validator = new SchemaValidator(emptySchema);

    const result = validator.validateField("anyField");
    expect(isError(result)).toBe(true);
  });

  test("handles schema with single field", () => {
    const singleFieldSchema: Schema = {
      name: { type: "string" },
    };
    const validator = new SchemaValidator(singleFieldSchema);

    const validResult = validator.validateField("name");
    expect(isSuccess(validResult)).toBe(true);

    const invalidResult = validator.validateField("other");
    expect(isError(invalidResult)).toBe(true);
  });

  test("handles very large numbers", () => {
    const validator = new SchemaValidator(testSchema);
    const numberField: SchemaField = { type: "number" };

    const result = validator.validateValue("999999999999", "eq", "score", numberField);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toBe(999999999999);
    }
  });

  test("handles very long strings", () => {
    const validator = new SchemaValidator(testSchema);
    const stringField: SchemaField = { type: "string" };

    const longString = "a".repeat(10000);
    const result = validator.validateValue(longString, "eq", "name", stringField);
    expect(isSuccess(result)).toBe(true);
  });

  test("handles special characters in values", () => {
    const validator = new SchemaValidator(testSchema);
    const stringField: SchemaField = { type: "string" };

    const specialChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
    const result = validator.validateValue(specialChars, "eq", "name", stringField);
    expect(isSuccess(result)).toBe(true);
  });
});

describe("unknown node types", () => {
  test("are a SYNTAX_ERROR, a real ParseErrorCode", () => {
    const result = new SchemaValidator({}).validateFilterNode({ type: "nope" } as unknown as FilterNode);
    expect(!result.success && result.error.code).toBe("SYNTAX_ERROR");
  });
});

describe("validateFilterNode on a large tree", () => {
  test("a 50,000-condition chain validates without a RangeError", () => {
    const leaf: FilterNode = { type: "comparison", field: "name", operator: "is_null", value: null };
    let chain: FilterNode = leaf;
    for (let i = 0; i < 50_000; i++) {
      chain = { type: "logical", operator: "or", left: chain, right: leaf };
    }
    expect(new SchemaValidator({ name: { type: "string" } }).validateFilterNode(chain).success).toBe(true);
  });
});

describe("unknown field suggestions", () => {
  const schema: Schema = {
    firstName: { type: "string" },
    lastName: { type: "string" },
    email: { type: "string" },
    age: { type: "number" },
    city: { type: "string" },
    country: { type: "string" },
  };
  const suggestionsFor = (field: string) => {
    const node: ComparisonNode = { type: "comparison", field, operator: "eq", value: "x" };
    const result = new SchemaValidator(schema).validateFilterNode(node);
    if (isSuccess(result)) {
      throw new Error(`expected '${field}' to be unknown`);
    }
    expect(result.error.code).toBe("UNKNOWN_FIELD");
    return result.error.suggestions;
  };

  test("suggests fields containing the name, ignoring case", () => {
    expect(suggestionsFor("name")).toEqual(["firstName", "lastName"]);
    expect(suggestionsFor("FIRST")).toEqual(["firstName"]);
  });

  test("suggests fields the name contains, ignoring case", () => {
    expect(suggestionsFor("EmailAddress")).toEqual(["email"]);
  });

  test("with no match, suggests the first five fields", () => {
    expect(suggestionsFor("zzz")).toEqual(["firstName", "lastName", "email", "age", "city"]);
  });
});
