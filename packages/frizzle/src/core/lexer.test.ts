// ============================================================================
// LEXER TESTS
// ============================================================================

import { describe, expect, test } from "vitest";
import { isError, isSuccess } from "../result-types.js";
import { Lexer, tokenizeFilterExpression } from "./lexer.js";

// ============================================================================
// CLASS-BASED TESTS
// ============================================================================

describe("Lexer", () => {
  describe("tokenize() method", () => {
    test("tokenizes simple comparison", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age >= 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens).toHaveLength(4); // field, operator, value, eof
        expect(tokens[0]).toMatchObject({ type: "field", value: "age" });
        expect(tokens[1]).toMatchObject({ type: "operator", value: "gte" });
        expect(tokens[2]).toMatchObject({ type: "value", value: "18" });
        expect(tokens[3]).toMatchObject({ type: "eof" });
      }
    });

    test("tokenizes logical AND expression", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age >= 18 AND status = 'active'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[0]).toMatchObject({ type: "field", value: "age" });
        expect(tokens[1]).toMatchObject({ type: "operator", value: "gte" });
        expect(tokens[2]).toMatchObject({ type: "value", value: "18" });
        expect(tokens[3]).toMatchObject({ type: "and", value: "and" });
        expect(tokens[4]).toMatchObject({ type: "field", value: "status" });
        expect(tokens[5]).toMatchObject({ type: "operator", value: "eq" });
        expect(tokens[6]).toMatchObject({ type: "value", value: "active" });
      }
    });

    test("tokenizes logical OR expression", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("role = 'admin' OR role = 'moderator'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[3]).toMatchObject({ type: "or", value: "or" });
      }
    });

    test("tokenizes parenthesized expressions", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("(age >= 18 AND status = 'active')");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[0]).toMatchObject({ type: "leftParen", value: "(" });
        expect(tokens[tokens.length - 2]).toMatchObject({
          type: "rightParen",
          value: ")",
        });
      }
    });

    test("tokenizes quoted strings with spaces", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name = 'John Doe'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "John Doe" });
      }
    });

    test("tokenizes double-quoted strings", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize('name = "John Doe"');

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "John Doe" });
      }
    });

    test("tokenizes escaped quotes in strings", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name = 'O\\'Brien'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "O'Brien" });
      }
    });

    test("tokenizes arrays", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("status IN ['active', 'pending']");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({
          type: "value",
          value: "['active', 'pending']",
        });
      }
    });

    test("tokenizes negative numbers", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("temperature < -10");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "-10" });
      }
    });

    test("tokenizes decimal numbers", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("price >= 19.99");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "19.99" });
      }
    });

    test("tokenizes field names with dots (nested fields)", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("user.age >= 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[0]).toMatchObject({ type: "field", value: "user.age" });
      }
    });

    test("tokenizes field names with underscores", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("created_at > '2024-01-01'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[0]).toMatchObject({ type: "field", value: "created_at" });
      }
    });
  });

  describe("URL-safe operators", () => {
    test("tokenizes eq operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age eq 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "eq" });
      }
    });

    test("tokenizes ne operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("status ne 'inactive'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "ne" });
      }
    });

    test("tokenizes gt operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age gt 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "gt" });
      }
    });

    test("tokenizes gte operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age gte 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "gte" });
      }
    });

    test("tokenizes lt operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age lt 65");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "lt" });
      }
    });

    test("tokenizes lte operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age lte 65");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "lte" });
      }
    });

    test("tokenizes LIKE operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name LIKE '%john%'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "like" });
      }
    });

    test("tokenizes ILIKE operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name ILIKE '%john%'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "ilike" });
      }
    });

    test("tokenizes IN operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("status IN ['active', 'pending']");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "in" });
      }
    });

    test("tokenizes NOT_IN operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("status NOT_IN ['deleted', 'archived']");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "not_in" });
      }
    });

    test("tokenizes STARTS_WITH operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name STARTS_WITH 'John'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({
          type: "operator",
          value: "starts_with",
        });
      }
    });

    test("tokenizes ENDS_WITH operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("email ENDS_WITH '@gmail.com'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({
          type: "operator",
          value: "ends_with",
        });
      }
    });

    test("tokenizes CONTAINS operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("description CONTAINS 'urgent'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({
          type: "operator",
          value: "contains",
        });
      }
    });

    test("tokenizes BETWEEN operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age BETWEEN [18, 65]");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "between" });
      }
    });

    test("tokenizes IS_NULL operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("deletedAt IS_NULL");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({ type: "operator", value: "is_null" });
      }
    });

    test("tokenizes IS_NOT_NULL operator", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("createdAt IS_NOT_NULL");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[1]).toMatchObject({
          type: "operator",
          value: "is_not_null",
        });
      }
    });
  });

  describe("special values", () => {
    test("tokenizes NULL keyword", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("deletedAt = NULL");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "null" });
      }
    });

    test("tokenizes TRUE keyword", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("isActive = TRUE");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "true" });
      }
    });

    test("tokenizes FALSE keyword", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("isActive = FALSE");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[2]).toMatchObject({ type: "value", value: "false" });
      }
    });
  });

  describe("URL decoding", () => {
    // The lexer takes an already-decoded expression. Decoding is the transport
    // layer's job (URLSearchParams / parseQueryString already does it), and
    // decoding a second time corrupts literals that contain "%".
    test("does not decode percent-escapes inside string literals", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name = '50%25 off'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data[2]).toMatchObject({ type: "value", value: "50%25 off" });
      }
    });

    test("keeps a bare % in string literals", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name = '100%'");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data[2]).toMatchObject({ type: "value", value: "100%" });
      }
    });

    test("rejects a still-encoded expression", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("name%20%3D%20%27John%27");

      expect(isError(result)).toBe(true);
    });
  });

  describe("error handling", () => {
    test("rejects unexpected character", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age @ 18");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.message).toContain("Unexpected character");
        expect(result.error.message).toContain("@");
      }
    });

    test("rejects invalid syntax", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age # 18");

      expect(isError(result)).toBe(true);
      if (isError(result)) {
        expect(result.error.code).toBe("SYNTAX_ERROR");
      }
    });
  });

  describe("whitespace handling", () => {
    test("handles extra whitespace", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age    >=     18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens).toHaveLength(4); // Same as without extra whitespace
      }
    });

    test("handles leading whitespace", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("   age >= 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[0]).toMatchObject({ type: "field", value: "age" });
      }
    });

    test("handles trailing whitespace", () => {
      const lexer = new Lexer();
      const result = lexer.tokenize("age >= 18   ");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        const tokens = result.data;
        expect(tokens[tokens.length - 1]).toMatchObject({ type: "eof" });
      }
    });
  });
});

// ============================================================================
// STANDALONE FUNCTION TESTS (backward compatibility)
// ============================================================================

describe("Standalone Lexer Functions", () => {
  describe("tokenizeFilterExpression()", () => {
    test("tokenizes simple expression", () => {
      const result = tokenizeFilterExpression("age >= 18");

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data).toHaveLength(4);
      }
    });

    test("matches class method behavior", () => {
      const lexer = new Lexer();
      const input = "age >= 18 AND status = 'active'";

      const classResult = lexer.tokenize(input);
      const functionResult = tokenizeFilterExpression(input);

      expect(isSuccess(classResult)).toBe(isSuccess(functionResult));
      if (isSuccess(classResult) && isSuccess(functionResult)) {
        expect(functionResult.data).toEqual(classResult.data);
      }
    });

    test("handles errors consistently", () => {
      const lexer = new Lexer();
      const input = "age @ 18";

      const classResult = lexer.tokenize(input);
      const functionResult = tokenizeFilterExpression(input);

      expect(isError(classResult)).toBe(true);
      expect(isError(functionResult)).toBe(true);
    });
  });
});

// ============================================================================
// CASE-INSENSITIVE KEYWORDS & OPERATORS
// ============================================================================
// All keywords and operators are case-insensitive.
// Field names and string values remain case-sensitive.

describe("Case-insensitive keywords and operators", () => {
  test("comparison operators are case-insensitive", () => {
    const lexer = new Lexer();
    const cases = ["EQ", "Eq", "eQ", "eq"];

    for (const op of cases) {
      const result = lexer.tokenize(`status ${op} "active"`);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data[1]).toMatchObject({
          type: "operator",
          value: "eq",
        });
      }
    }
  });

  test("all named operators normalize to lowercase", () => {
    const lexer = new Lexer();
    const operators = [
      ["GTE", "gte"],
      ["Lte", "lte"],
      ["LIKE", "like"],
      ["ILIKE", "ilike"],
      ["NOT_IN", "not_in"],
      ["STARTS_WITH", "starts_with"],
      ["ENDS_WITH", "ends_with"],
      ["CONTAINS", "contains"],
      ["BETWEEN", "between"],
      ["IS_NULL", "is_null"],
      ["IS_NOT_NULL", "is_not_null"],
    ] as const;

    for (const [input, expected] of operators) {
      const result = lexer.tokenize(`field ${input} "value"`);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data[1]).toMatchObject({
          type: "operator",
          value: expected,
        });
      }
    }
  });

  test("logical operators are case-insensitive", () => {
    const lexer = new Lexer();
    const cases = ["AND", "and", "And", "aNd"];

    for (const op of cases) {
      const result = lexer.tokenize(`a eq 1 ${op} b eq 2`);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data[3]).toMatchObject({ type: "and", value: "and" });
      }
    }
  });

  test("value keywords are case-insensitive", () => {
    const lexer = new Lexer();
    const cases = [
      ["NULL", "null"],
      ["Null", "null"],
      ["TRUE", "true"],
      ["True", "true"],
      ["FALSE", "false"],
      ["False", "false"],
    ] as const;

    for (const [input, expected] of cases) {
      const result = lexer.tokenize(`field eq ${input}`);
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data[2]).toMatchObject({
          type: "value",
          value: expected,
        });
      }
    }
  });

  test("field names remain case-sensitive", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize('firstName eq "John"');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data[0]).toMatchObject({
        type: "field",
        value: "firstName", // preserved as-is
      });
    }
  });

  test("string values remain case-sensitive", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize('status eq "In_Progress"');
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data[2]).toMatchObject({
        type: "value",
        value: "In_Progress", // preserved as-is
      });
    }
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("Edge Cases", () => {
  test("handles empty input", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize("");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toHaveLength(1); // Just eof
      expect(result.data[0]).toMatchObject({ type: "eof" });
    }
  });

  test("handles whitespace-only input", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize("   ");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toHaveLength(1); // Just eof
    }
  });

  test("rejects unclosed string", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize("name = 'John");

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.message).toContain("Unterminated string");
      expect(result.error.position).toBe(7);
    }
  });

  test("rejects unclosed string ending in an escape", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize("name = 'John\\'");

    expect(isError(result)).toBe(true);
  });

  test("rejects unclosed array", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize("status IN ['active', 'pending'");

    expect(isError(result)).toBe(true);
    if (isError(result)) {
      expect(result.error.message).toContain("Unterminated array");
      expect(result.error.position).toBe(10);
    }
  });

  test("rejects malformed numbers", () => {
    for (const input of ["v = 1.2.3", "v = 1.", "v = -1.2.3", "v = 18abc"]) {
      const result = new Lexer().tokenize(input);
      expect(isError(result), input).toBe(true);
      if (isError(result)) {
        expect(result.error.message, input).toContain("Invalid number");
      }
    }
  });

  test("handles very long input", () => {
    const lexer = new Lexer();
    const longInput = "age >= 18" + " AND status = 'active'".repeat(100);
    const result = lexer.tokenize(longInput);

    expect(isSuccess(result)).toBe(true);
  });

  test("handles unicode characters", () => {
    const lexer = new Lexer();
    const result = lexer.tokenize("name = '用户名'");

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const tokens = result.data;
      expect(tokens[2]).toMatchObject({ type: "value", value: "用户名" });
    }
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe("Integration Scenarios", () => {
  test("complex real-world query", () => {
    const lexer = new Lexer();
    const query = "(age >= 18 AND status = 'active') OR (role = 'admin' AND verified = true)";
    const result = lexer.tokenize(query);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const tokens = result.data;
      expect(tokens[0]).toMatchObject({ type: "leftParen" });
      expect(tokens[tokens.length - 1]).toMatchObject({ type: "eof" });
    }
  });

  test("nested parentheses", () => {
    const lexer = new Lexer();
    const query = "((age >= 18 AND age <= 65) OR verified = true)";
    const result = lexer.tokenize(query);

    expect(isSuccess(result)).toBe(true);
  });

  test("mixed URL-safe and traditional operators", () => {
    const lexer = new Lexer();
    const query = "age gte 18 AND status = 'active'";
    const result = lexer.tokenize(query);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const tokens = result.data;
      expect(tokens[1].value).toBe("gte"); // gte stays as-is
      expect(tokens[5].value).toBe("eq"); // = converted to eq
    }
  });
});
