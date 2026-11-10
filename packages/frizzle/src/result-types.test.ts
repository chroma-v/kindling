import { describe, expect, test } from "vitest";
import {
  createError,
  createParseError,
  createSuccess,
  isError,
  isParseErrorCode,
  isSuccess,
  type ParseError,
  parseErrorCodes,
  propagateError,
  type Result,
} from "./result-types.js";

// ============================================================================
// CONSTRUCTORS
// ============================================================================

describe("createSuccess", () => {
  test("creates success with data", () => {
    const result = createSuccess(42);
    expect(result).toEqual({ success: true, data: 42 });
  });

  test("creates success with string", () => {
    const result = createSuccess("hello");
    expect(result).toEqual({ success: true, data: "hello" });
  });

  test("creates success with null", () => {
    const result = createSuccess(null);
    expect(result).toEqual({ success: true, data: null });
  });

  test("creates success with object", () => {
    const obj = { field: "age", operator: "gte" };
    const result = createSuccess(obj);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(obj);
    }
  });

  test("creates success with undefined (void operations)", () => {
    const result = createSuccess(undefined);
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("createError", () => {
  test("creates error with ParseError", () => {
    const error: ParseError = {
      message: "Bad input",
      position: 5,
      context: "age gte",
      code: "SYNTAX_ERROR",
    };
    const result = createError<string>(error);
    expect(result).toEqual({ success: false, error });
  });
});

describe("createParseError", () => {
  test("creates error with context slice around position", () => {
    const input = "status eq 'active' AND priority";
    // Position 31 is end of string. slice(max(0, 31-10), 31+10) = slice(21, 41) = "D priority"
    const error = createParseError("Unexpected end", 31, input, "SYNTAX_ERROR");
    expect(error.message).toBe("Unexpected end");
    expect(error.position).toBe(31);
    expect(error.code).toBe("SYNTAX_ERROR");
    expect(error.context).toBe("D priority");
  });

  test("context slice near start of string", () => {
    const error = createParseError("Bad token", 2, "abcdef", "SYNTAX_ERROR");
    // slice(max(0, 2-10), 2+10) = slice(0, 12) = "abcdef"
    expect(error.context).toBe("abcdef");
  });

  test("context slice in middle of string", () => {
    const input = "0123456789ABCDEFGHIJ0123456789";
    const error = createParseError("Error", 15, input, "SYNTAX_ERROR");
    // slice(5, 25) = "56789ABCDEFGHIJ01234"
    expect(error.context).toBe("56789ABCDEFGHIJ01234");
  });

  test("includes optional field", () => {
    const error = createParseError("Unknown field", 0, "foo eq 1", "UNKNOWN_FIELD", "foo");
    expect(error.field).toBe("foo");
  });

  test("includes optional suggestions", () => {
    const error = createParseError("Use is_null", 0, "", "TYPE_MISMATCH", "age", ["is_null", "is_not_null"]);
    expect(error.suggestions).toEqual(["is_null", "is_not_null"]);
  });

  test("omitted optional fields are undefined", () => {
    const error = createParseError("Error", 0, "", "SYNTAX_ERROR");
    expect(error.field).toBeUndefined();
    expect(error.suggestions).toBeUndefined();
  });
});

// ============================================================================
// TYPE GUARDS
// ============================================================================

describe("isSuccess", () => {
  test("returns true for success result", () => {
    expect(isSuccess(createSuccess(1))).toBe(true);
  });

  test("returns false for error result", () => {
    const error = createParseError("err", 0, "", "SYNTAX_ERROR");
    expect(isSuccess(createError(error))).toBe(false);
  });

  test("narrows type to access data", () => {
    const result: Result<number> = createSuccess(42);
    if (isSuccess(result)) {
      // TypeScript should allow accessing .data here
      expect(result.data).toBe(42);
    }
  });
});

describe("isError", () => {
  test("returns true for error result", () => {
    const error = createParseError("err", 0, "", "SYNTAX_ERROR");
    expect(isError(createError(error))).toBe(true);
  });

  test("returns false for success result", () => {
    expect(isError(createSuccess("ok"))).toBe(false);
  });

  test("narrows type to access error", () => {
    const error = createParseError("bad", 0, "", "SYNTAX_ERROR");
    const result: Result<string> = createError(error);
    if (isError(result)) {
      expect(result.error.message).toBe("bad");
      expect(result.error.code).toBe("SYNTAX_ERROR");
    }
  });
});

// ============================================================================
// PROPAGATE ERROR
// ============================================================================

describe("propagateError", () => {
  test("propagates error to different result type", () => {
    const error = createParseError("fail", 0, "", "SYNTAX_ERROR");
    const original: Result<string> = createError(error);
    const propagated: Result<number> = propagateError(original);
    expect(isError(propagated)).toBe(true);
    if (isError(propagated)) {
      expect(propagated.error).toBe(error);
    }
  });

  test("throws when called on success (bug detection)", () => {
    const success = createSuccess("data");
    expect(() => propagateError(success)).toThrow("propagateError called on success");
  });

  test("preserves error identity (same reference)", () => {
    const error = createParseError("fail", 5, "input", "UNKNOWN_FIELD", "x");
    const original = createError<string>(error);
    const propagated = propagateError<number, ParseError>(original);
    if (isError(propagated)) {
      expect(propagated.error).toBe(error);
    }
  });
});

// ============================================================================
// PARSE ERROR CODES
// ============================================================================

describe("ParseErrorCode coverage", () => {
  const codes = [
    "SYNTAX_ERROR",
    "UNKNOWN_FIELD",
    "INVALID_FIELD_NAME",
    "INVALID_OPERATOR",
    "TYPE_MISMATCH",
    "INVALID_VALUE",
    "MISSING_VALUE",
    "UNBALANCED_PARENTHESES",
    "LIMIT_EXCEEDED",
    "UNSORTABLE_FIELD",
  ] as const;

  test("the runtime list matches the union", () => {
    expect([...parseErrorCodes].sort()).toEqual([...codes].sort());
    expect(codes.every(isParseErrorCode)).toBe(true);
    expect(isParseErrorCode("INVALID_SYNTAX")).toBe(false);
    expect(isParseErrorCode(undefined)).toBe(false);
  });

  test.each(codes)("code '%s' can be used in createParseError", (code) => {
    const error = createParseError("test", 0, "", code);
    expect(error.code).toBe(code);
  });
});
