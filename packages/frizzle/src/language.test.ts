import { describe, expect, test } from "vitest";
import {
  getOperatorsByCategory,
  isLiteralValue,
  isLogicalOperator,
  isNodeType,
  isOperator,
  isUrlSafeOperator,
  literalValues,
  logicalOperators,
  nodeTypes,
  type OperatorName,
  operators,
  operatorToSymbol,
  query,
  requiresValue,
  sortDirections,
  symbolToOperator,
} from "./language.js";
import { isTokenType } from "./token-types.js";

// ============================================================================
// OPERATOR REGISTRY
// ============================================================================

describe("operator registry", () => {
  const allOps = Object.keys(operators) as OperatorName[];

  test("contains exactly 16 operators", () => {
    expect(allOps).toHaveLength(16);
  });

  test("every operator has a category", () => {
    for (const op of allOps) {
      expect(operators[op].category).toBeDefined();
    }
  });

  test("categories are from fixed set", () => {
    const validCategories = new Set(["comparison", "string", "array", "range", "null"]);
    for (const op of allOps) {
      expect(validCategories.has(operators[op].category)).toBe(true);
    }
  });

  test("comparison operators", () => {
    const comparison = getOperatorsByCategory("comparison");
    expect(comparison).toEqual(expect.arrayContaining(["eq", "ne", "gt", "gte", "lt", "lte"]));
    expect(comparison).toHaveLength(6);
  });

  test("string operators", () => {
    const string = getOperatorsByCategory("string");
    expect(string).toEqual(expect.arrayContaining(["like", "ilike", "contains", "starts_with", "ends_with"]));
    expect(string).toHaveLength(5);
  });

  test("array operators", () => {
    const array = getOperatorsByCategory("array");
    expect(array).toEqual(expect.arrayContaining(["in", "not_in"]));
    expect(array).toHaveLength(2);
  });

  test("range operators", () => {
    const range = getOperatorsByCategory("range");
    expect(range).toEqual(["between"]);
  });

  test("null operators", () => {
    const nullOps = getOperatorsByCategory("null");
    expect(nullOps).toEqual(expect.arrayContaining(["is_null", "is_not_null"]));
    expect(nullOps).toHaveLength(2);
  });
});

// ============================================================================
// SYMBOL MAPPINGS
// ============================================================================

describe("symbol mappings", () => {
  test("comparison operators have symbols", () => {
    expect(operatorToSymbol.eq).toBe("=");
    expect(operatorToSymbol.ne).toBe("!=");
    expect(operatorToSymbol.gt).toBe(">");
    expect(operatorToSymbol.gte).toBe(">=");
    expect(operatorToSymbol.lt).toBe("<");
    expect(operatorToSymbol.lte).toBe("<=");
  });

  test("string/array/range/null operators have no symbols", () => {
    expect(operatorToSymbol.like).toBeUndefined();
    expect(operatorToSymbol.in).toBeUndefined();
    expect(operatorToSymbol.between).toBeUndefined();
    expect(operatorToSymbol.is_null).toBeUndefined();
  });

  test("symbol to operator is the inverse of operator to symbol", () => {
    for (const [op, sym] of Object.entries(operatorToSymbol)) {
      expect(symbolToOperator[sym]).toBe(op);
    }
  });

  test("symbolToOperator maps symbols back correctly", () => {
    expect(symbolToOperator["="]).toBe("eq");
    expect(symbolToOperator["!="]).toBe("ne");
    expect(symbolToOperator[">"]).toBe("gt");
    expect(symbolToOperator[">="]).toBe("gte");
  });
});

// ============================================================================
// TYPE GUARDS
// ============================================================================

describe("isOperator", () => {
  test("returns true for valid operators", () => {
    expect(isOperator("eq")).toBe(true);
    expect(isOperator("like")).toBe(true);
    expect(isOperator("is_null")).toBe(true);
    expect(isOperator("between")).toBe(true);
  });

  test("returns false for invalid strings", () => {
    expect(isOperator("equals")).toBe(false);
    expect(isOperator("AND")).toBe(false);
    expect(isOperator("")).toBe(false);
    expect(isOperator("null")).toBe(false);
  });
});

describe("isUrlSafeOperator", () => {
  test("is case-insensitive", () => {
    expect(isUrlSafeOperator("EQ")).toBe(true);
    expect(isUrlSafeOperator("Like")).toBe(true);
    expect(isUrlSafeOperator("IS_NULL")).toBe(true);
  });

  test("returns false for non-operators", () => {
    expect(isUrlSafeOperator("SELECT")).toBe(false);
  });
});

describe("isNodeType", () => {
  test("returns true for valid node types", () => {
    expect(isNodeType("comparison")).toBe(true);
    expect(isNodeType("logical")).toBe(true);
    expect(isNodeType("group")).toBe(true);
  });

  test("returns false for invalid node types", () => {
    expect(isNodeType("filter")).toBe(false);
    expect(isNodeType("")).toBe(false);
  });
});

describe("isLogicalOperator", () => {
  test("returns true for and/or", () => {
    expect(isLogicalOperator("and")).toBe(true);
    expect(isLogicalOperator("or")).toBe(true);
  });

  test("returns false for other strings", () => {
    expect(isLogicalOperator("not")).toBe(false);
    expect(isLogicalOperator("AND")).toBe(false); // case-sensitive
  });
});

describe("isTokenType", () => {
  test("returns true for all token types", () => {
    const allTypes = ["field", "operator", "value", "and", "or", "leftParen", "rightParen", "eof"];
    for (const tt of allTypes) {
      expect(isTokenType(tt)).toBe(true);
    }
  });

  test("returns false for invalid token types", () => {
    expect(isTokenType("number")).toBe(false);
    expect(isTokenType("string")).toBe(false);
  });
});

describe("isLiteralValue", () => {
  test("returns true for null, true, false", () => {
    expect(isLiteralValue("null")).toBe(true);
    expect(isLiteralValue("true")).toBe(true);
    expect(isLiteralValue("false")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isLiteralValue("NULL")).toBe(true);
    expect(isLiteralValue("True")).toBe(true);
    expect(isLiteralValue("FALSE")).toBe(true);
  });

  test("returns false for non-literals", () => {
    expect(isLiteralValue("undefined")).toBe(false);
    expect(isLiteralValue("none")).toBe(false);
    expect(isLiteralValue("")).toBe(false);
  });
});

// ============================================================================
// REQUIRESVALUE
// ============================================================================

describe("requiresValue", () => {
  test("returns true for value-bearing operators", () => {
    expect(requiresValue("eq")).toBe(true);
    expect(requiresValue("gt")).toBe(true);
    expect(requiresValue("like")).toBe(true);
    expect(requiresValue("in")).toBe(true);
    expect(requiresValue("between")).toBe(true);
  });

  test("returns false for null-check operators", () => {
    expect(requiresValue("is_null")).toBe(false);
    expect(requiresValue("is_not_null")).toBe(false);
  });
});

// ============================================================================
// CONSTANTS
// ============================================================================

describe("constants", () => {
  test("nodeTypes has 3 types", () => {
    expect(nodeTypes).toEqual(["comparison", "logical", "group"]);
  });

  test("logicalOperators has and/or", () => {
    expect(logicalOperators).toEqual(["and", "or"]);
  });

  test("sortDirections has asc/desc", () => {
    expect(sortDirections).toEqual(["asc", "desc"]);
  });

  test("literalValues maps keywords", () => {
    expect(literalValues.null).toBe("null");
    expect(literalValues.true).toBe("true");
    expect(literalValues.false).toBe("false");
  });
});

// ============================================================================
// QUERY NAMESPACE
// ============================================================================

describe("query namespace", () => {
  test("standard param names", () => {
    expect(query.params.filter).toBe("filter");
    expect(query.params.sort).toBe("sort");
    expect(query.params.limit).toBe("limit");
    expect(query.params.offset).toBe("offset");
  });

  test("limits", () => {
    expect(query.limits.max).toBe(1000);
    expect(query.limits.min).toBe(1);
    expect(query.limits.default).toBe(50);
    expect(query.limits.offsetMin).toBe(0);
  });

  test("defaults", () => {
    expect(query.defaults.sortDirection).toBe("asc");
  });
});
