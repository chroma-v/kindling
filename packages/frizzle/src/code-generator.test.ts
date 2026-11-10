import { describe, expect, test, vi } from "vitest";
import type { ComparisonNode, FilterNode, GroupNode, LogicalNode } from "./ast-types.js";
import { type FilterNodeFold, type FilterNodeVisitor, foldFilterNode, walkFilterNode } from "./code-generator.js";

// ============================================================================
// WALK FILTER NODE
// ============================================================================

describe("walkFilterNode", () => {
  const mockVisitor: FilterNodeVisitor<string> = {
    visitComparison: vi.fn(() => "comparison-result"),
    visitLogical: vi.fn(() => "logical-result"),
    visitGroup: vi.fn(() => "group-result"),
  };

  test("dispatches comparison node to visitComparison", () => {
    const node: ComparisonNode = {
      type: "comparison",
      field: "age",
      operator: "gte",
      value: 18,
    };
    const result = walkFilterNode(node, mockVisitor);
    expect(result).toBe("comparison-result");
    expect(mockVisitor.visitComparison).toHaveBeenCalledWith(node);
  });

  test("dispatches logical node to visitLogical", () => {
    const left: ComparisonNode = {
      type: "comparison",
      field: "a",
      operator: "eq",
      value: 1,
    };
    const right: ComparisonNode = {
      type: "comparison",
      field: "b",
      operator: "eq",
      value: 2,
    };
    const node: LogicalNode = {
      type: "logical",
      operator: "and",
      left,
      right,
    };
    const result = walkFilterNode(node, mockVisitor);
    expect(result).toBe("logical-result");
    expect(mockVisitor.visitLogical).toHaveBeenCalledWith(node);
  });

  test("dispatches group node to visitGroup", () => {
    const inner: ComparisonNode = {
      type: "comparison",
      field: "x",
      operator: "eq",
      value: "y",
    };
    const node: GroupNode = {
      type: "group",
      expression: inner,
    };
    const result = walkFilterNode(node, mockVisitor);
    expect(result).toBe("group-result");
    expect(mockVisitor.visitGroup).toHaveBeenCalledWith(node);
  });

  test("throws for unknown node type (exhaustiveness)", () => {
    const badNode = { type: "unknown", field: "x" } as unknown as FilterNode;
    expect(() => walkFilterNode(badNode, mockVisitor)).toThrow("Unknown node type");
  });

  test("passes the exact node reference (no cloning)", () => {
    const node: ComparisonNode = {
      type: "comparison",
      field: "status",
      operator: "eq",
      value: "active",
    };
    const captureVisitor: FilterNodeVisitor<FilterNode> = {
      visitComparison: (n) => n,
      visitLogical: (n) => n,
      visitGroup: (n) => n,
    };
    const result = walkFilterNode(node, captureVisitor);
    expect(result).toBe(node);
  });

  test("visitor can return any type", () => {
    const countVisitor: FilterNodeVisitor<number> = {
      visitComparison: () => 1,
      visitLogical: (node) => walkFilterNode(node.left, countVisitor) + walkFilterNode(node.right, countVisitor),
      visitGroup: (node) => walkFilterNode(node.expression, countVisitor),
    };

    const left: ComparisonNode = {
      type: "comparison",
      field: "a",
      operator: "eq",
      value: 1,
    };
    const right: ComparisonNode = {
      type: "comparison",
      field: "b",
      operator: "eq",
      value: 2,
    };
    const tree: LogicalNode = {
      type: "logical",
      operator: "and",
      left,
      right,
    };

    expect(walkFilterNode(tree, countVisitor)).toBe(2);
  });
});

describe("foldFilterNode", () => {
  const leaf = (field: string): FilterNode => ({ type: "comparison", field, operator: "is_null", value: null });
  const show: FilterNodeFold<string> = {
    comparison: (node) => node.field,
    chain: (operands, operator) => `${operator}[${operands.join(",")}]`,
    group: (inner) => `(${inner})`,
  };

  test("hands a run of one operator over as one chain, however it nests", () => {
    const left: FilterNode = {
      type: "logical",
      operator: "and",
      left: { type: "logical", operator: "and", left: leaf("a"), right: leaf("b") },
      right: leaf("c"),
    };
    const right: FilterNode = {
      type: "logical",
      operator: "and",
      left: leaf("a"),
      right: { type: "logical", operator: "and", left: leaf("b"), right: leaf("c") },
    };
    expect(foldFilterNode(left, show)).toBe("and[a,b,c]");
    expect(foldFilterNode(right, show)).toBe("and[a,b,c]");
  });

  test("a group or the other operator starts a new chain", () => {
    const node: FilterNode = {
      type: "logical",
      operator: "or",
      left: { type: "logical", operator: "and", left: leaf("a"), right: leaf("b") },
      right: { type: "group", expression: { type: "logical", operator: "or", left: leaf("c"), right: leaf("d") } },
    };
    expect(foldFilterNode(node, show)).toBe("or[and[a,b],(or[c,d])]");
  });

  test("stop ends the fold at the leftmost stopping value, visiting nothing after it", () => {
    const visited: string[] = [];
    const node: FilterNode = {
      type: "logical",
      operator: "and",
      left: { type: "logical", operator: "and", left: leaf("a"), right: leaf("bad") },
      right: leaf("c"),
    };
    const result = foldFilterNode(node, {
      ...show,
      comparison: (n) => {
        visited.push(n.field);
        return n.field === "bad" ? "STOP" : n.field;
      },
      stop: (value) => value === "STOP",
    });
    expect(result).toBe("STOP");
    expect(visited).toEqual(["a", "bad"]);
  });

  test("a malformed node goes to malformed(), or throws without it", () => {
    const broken = { type: "logical", operator: "and", left: leaf("a") } as unknown as FilterNode;
    expect(foldFilterNode(broken, { ...show, malformed: (reason) => `bad: ${reason}` })).toBe(
      "bad: Malformed logical node: missing left or right",
    );
    expect(() => foldFilterNode(broken, show)).toThrow("missing left or right");
  });

  test("any depth is safe", () => {
    let chain = leaf("x");
    for (let i = 0; i < 100_000; i++) {
      chain = { type: "logical", operator: "or", left: chain, right: leaf("x") };
    }
    let deep = leaf("x");
    for (let i = 0; i < 100_000; i++) {
      deep = { type: "group", expression: deep };
    }
    const count: FilterNodeFold<number> = {
      comparison: () => 1,
      chain: (counts) => counts.reduce((a, b) => a + b, 0),
      group: (n) => n,
    };
    expect(foldFilterNode(chain, count)).toBe(100_001);
    expect(foldFilterNode(deep, count)).toBe(1);
  });
});
