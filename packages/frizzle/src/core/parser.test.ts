// ============================================================================
// PARSER TESTS
// ============================================================================

import { describe, expect, test } from "vitest";
import type { ComparisonNode, GroupNode, LogicalNode } from "../ast-types.js";
import { isError, isSuccess } from "../result-types.js";
import { tokenizeFilterExpression } from "./lexer.js";
import { PrattParser, parseFilterExpression } from "./parser.js";

// ============================================================================
// TEST HELPERS
// ============================================================================

const parseQuick = (input: string) => {
  const tokenResult = tokenizeFilterExpression(input);
  if (isError(tokenResult)) {
    return tokenResult;
  }
  const parser = new PrattParser(tokenResult.data);
  return parser.parseExpression(0);
};

// ============================================================================
// PRATT PARSER CLASS TESTS
// ============================================================================

describe("PrattParser", () => {
  describe("parseExpression() method", () => {
    test("parses simple comparison", () => {
      const result = parseQuick("age >= 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toMatchObject({
          type: "comparison",
          field: "age",
          operator: "gte",
          value: 18,
        });
      }
    });

    test("parses AND expression", () => {
      const result = parseQuick("age >= 18 AND status = 'active'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const node = result.data as LogicalNode;
        expect(node.type).toBe("logical");
        expect(node.operator).toBe("and");
        expect((node.left as ComparisonNode).field).toBe("age");
        expect((node.right as ComparisonNode).field).toBe("status");
      }
    });

    test("parses OR expression", () => {
      const result = parseQuick("role = 'admin' OR role = 'moderator'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const node = result.data as LogicalNode;
        expect(node.type).toBe("logical");
        expect(node.operator).toBe("or");
      }
    });

    test("respects operator precedence (AND before OR)", () => {
      const result = parseQuick("a = 1 OR b = 2 AND c = 3");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const node = result.data as LogicalNode;
        expect(node.type).toBe("logical");
        expect(node.operator).toBe("or");
        // Right side should be AND(b=2, c=3)
        const rightNode = node.right as LogicalNode;
        expect(rightNode.type).toBe("logical");
        expect(rightNode.operator).toBe("and");
      }
    });

    test("parses grouped expressions", () => {
      const result = parseQuick("(age >= 18 AND age <= 65)");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toMatchObject({
          type: "group",
        });
      }
    });

    test("overrides precedence with parentheses", () => {
      const result = parseQuick("(a = 1 OR b = 2) AND c = 3");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const node = result.data as LogicalNode;
        expect(node.type).toBe("logical");
        expect(node.operator).toBe("and");
        // Left side should be group(OR(a=1, b=2))
        expect(node.left).toMatchObject({
          type: "group",
        });
      }
    });

    test("parses nested groups", () => {
      const result = parseQuick("((age >= 18))");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data.type).toBe("group");
        const inner = (result.data as GroupNode).expression;
        expect(inner.type).toBe("group");
      }
    });

    test("coerces numeric values", () => {
      const result = parseQuick("age = 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect((result.data as ComparisonNode).value).toBe(18);
      }
    });

    test("coerces decimal values", () => {
      const result = parseQuick("price = 19.99");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect((result.data as ComparisonNode).value).toBe(19.99);
      }
    });

    test("coerces boolean true", () => {
      const result = parseQuick("isActive = true");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect((result.data as ComparisonNode).value).toBe(true);
      }
    });

    test("coerces boolean false", () => {
      const result = parseQuick("isActive = false");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect((result.data as ComparisonNode).value).toBe(false);
      }
    });

    test("coerces null", () => {
      const result = parseQuick("deletedAt = null");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect((result.data as ComparisonNode).value).toBe(null);
      }
    });

    test("eq null vs is_null produce different operators", () => {
      // eq null produces operator: "eq" with value: null
      const eqResult = parseQuick("status eq null");
      expect(isSuccess(eqResult)).toBe(true);
      if (isSuccess(eqResult)) {
        expect((eqResult.data as ComparisonNode).operator).toBe("eq");
        expect((eqResult.data as ComparisonNode).value).toBe(null);
      }

      // is_null produces operator: "is_null" with value: null
      const isNullResult = parseQuick("status is_null");
      expect(isSuccess(isNullResult)).toBe(true);
      if (isSuccess(isNullResult)) {
        expect((isNullResult.data as ComparisonNode).operator).toBe("is_null");
        expect((isNullResult.data as ComparisonNode).value).toBe(null);
      }

      // These produce DIFFERENT AST nodes!
      // eq null -> will generate SQL: status = NULL (always false!)
      // is_null -> will generate SQL: status IS NULL (correct)
    });

    test("coerces array values", () => {
      const result = parseQuick("status IN ['active', 'pending']");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const value = (result.data as ComparisonNode).value;
        expect(Array.isArray(value)).toBe(true);
        expect(value).toEqual(["active", "pending"]);
      }
    });

    test("handles is_null operator", () => {
      const result = parseQuick("deletedAt IS_NULL");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toMatchObject({
          type: "comparison",
          field: "deletedAt",
          operator: "is_null",
          value: null,
        });
      }
    });

    test("handles is_not_null operator", () => {
      const result = parseQuick("createdAt IS_NOT_NULL");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toMatchObject({
          type: "comparison",
          field: "createdAt",
          operator: "is_not_null",
          value: null,
        });
      }
    });

    test("validates BETWEEN operator requires array", () => {
      const result = parseQuick("age BETWEEN 18");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("BETWEEN");
        expect(result.error.message).toContain("array");
      }
    });

    test("validates BETWEEN operator requires exactly 2 values", () => {
      const result = parseQuick("age BETWEEN [18, 65, 100]");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("exactly 2 values");
      }
    });

    test("accepts valid BETWEEN operator", () => {
      const result = parseQuick("age BETWEEN [18, 65]");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect((result.data as ComparisonNode).value).toEqual([18, 65]);
      }
    });
  });

  describe("error handling", () => {
    test("rejects unbalanced parentheses (missing closing)", () => {
      const result = parseQuick("(age >= 18");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Unbalanced");
        expect(result.error.message).toContain("missing closing");
      }
    });

    test("rejects an array literal that is not valid", () => {
      const result = parseQuick("tags in [1,,2]");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("INVALID_VALUE");
        expect(result.error.message).toContain("Invalid array");
      }
    });

    test("rejects missing field", () => {
      const result = parseQuick(">= 18");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Expected field");
      }
    });

    test("rejects missing operator", () => {
      const result = parseQuick("age 18");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Expected operator");
      }
    });

    test("rejects missing value", () => {
      const result = parseQuick("age >=");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Expected value");
      }
    });
  });
});

// ============================================================================
// STANDALONE FUNCTION TESTS
// ============================================================================

describe("parseFilterExpression()", () => {
  test("parses simple expression", () => {
    const result = parseFilterExpression("age >= 18");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.type).toBe("comparison");
    }
  });

  test("combines tokenization and parsing", () => {
    const result = parseFilterExpression("age >= 18 AND status = 'active'");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.type).toBe("logical");
    }
  });

  test("rejects unexpected token after expression", () => {
    // This simulates having extra tokens that weren't consumed
    const result = parseFilterExpression("age >= 18 18");

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      // The grammar says what could have come next instead of "Unexpected token".
      expect(result.error.message).toBe("Expected and, or or end of input, got '18'");
      expect(result.error.position).toBe(10);
    }
  });

  test("propagates tokenization errors", () => {
    const result = parseFilterExpression("age @ 18");

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.code).toBe("SYNTAX_ERROR");
    }
  });

  test("propagates parsing errors", () => {
    const result = parseFilterExpression("(age >= 18");

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.message).toContain("Unbalanced");
    }
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Integration Scenarios", () => {
  test("real-world query: user filter", () => {
    const result = parseFilterExpression("(age >= 18 AND age <= 65) AND status = 'active'");

    expect(isSuccess(result)).toBe(true);
  });

  test("real-world query: complex OR/AND", () => {
    const result = parseFilterExpression("role = 'admin' OR (verified = true AND age >= 18)");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const node = result.data as LogicalNode;
      expect(node.operator).toBe("or");
    }
  });

  test("real-world query: multiple conditions", () => {
    const result = parseFilterExpression("status = 'active' AND verified = true AND age >= 18 AND role = 'member'");

    expect(isSuccess(result)).toBe(true);
  });

  test("real-world query: IN operator", () => {
    const result = parseFilterExpression("status IN ['active', 'pending', 'review']");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const value = (result.data as ComparisonNode).value;
      expect(value).toEqual(["active", "pending", "review"]);
    }
  });

  test("real-world query: date range", () => {
    const result = parseFilterExpression("createdAt >= '2024-01-01' AND createdAt <= '2024-12-31'");

    expect(isSuccess(result)).toBe(true);
  });
});
