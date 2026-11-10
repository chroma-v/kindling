// ============================================================================
// QUERY STRING PARSING TESTS
// ============================================================================
//
// Unit tests for URL query string parsing (parseQueryString, serializeQueryAst).
// Tests real-world URL query examples from url-examples.md to ensure they
// parse correctly and produce the expected AST structure.
//
// ============================================================================

import { describe, expect, test } from "vitest";
import type { ComparisonNode, FilterNode, GroupNode, LogicalNode } from "./ast-types.js";
import { parseFilterExpression } from "./core/parser.js";
import { parseQueryString, serializeFilterNode } from "./query-string.js";
import { isSuccess } from "./result-types.js";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function expectParsed(query: string) {
  const result = parseFilterExpression(query);
  expect(isSuccess(result)).toBe(true);

  if (!isSuccess(result)) {
    throw new Error(`Expected query to parse: ${query}`);
  }

  return result.data;
}

function expectFullQueryParsed(queryString: string) {
  const result = parseQueryString(queryString);
  expect(isSuccess(result)).toBe(true);

  if (!isSuccess(result)) {
    throw new Error(`Expected query string to parse: ${queryString}`);
  }

  const params = result.data;

  // Parse the filter string into an AST if present
  let filter: FilterNode | undefined;
  if (params.filter) {
    const filterResult = parseFilterExpression(params.filter);
    if (!isSuccess(filterResult)) {
      throw new Error(`Expected filter to parse: ${params.filter} - ${filterResult.error.message}`);
    }
    filter = filterResult.data;
  }

  return {
    filter,
    sort: params.sort,
    limit: params.limit,
    offset: params.offset,
  };
}

// ============================================================================
// LOGICAL OPERATORS & NESTING
// ============================================================================

describe("URL Examples - Logical Operators & Nesting", () => {
  test("Case-insensitive operators", () => {
    const queries = [
      'status eq "active" and priority eq "high"', // Lowercase
      'status eq "active" AND priority eq "high"', // Uppercase
      'status eq "active" And priority eq "High"', // Mixed case
    ];

    queries.forEach((query) => {
      const ast = expectParsed(query);

      expect(ast.type).toBe("logical");

      if (ast.type === "logical") {
        expect(ast.operator).toBe("and");
      }
    });
  });

  test("Operator precedence: AND before OR", () => {
    // age > 18 AND status eq "active" OR role eq "admin"
    // Should parse as: (age > 18 AND status = "active") OR (role = "admin")
    const ast = expectParsed('age gt 18 and status eq "active" or role eq "admin"');

    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.operator).toBe("or");

      // Left should be AND(age > 18, status = "active")
      const left = ast.left as LogicalNode;
      expect(left.type).toBe("logical");
      expect(left.operator).toBe("and");

      // Right should be comparison(role = "admin")
      const right = ast.right as ComparisonNode;
      expect(right.type).toBe("comparison");
      expect(right.field).toBe("role");
    }
  });

  test("High-priority OR urgent tasks that are in progress", () => {
    const ast = expectParsed('(priority eq "high" or priority eq "urgent") and status eq "in_progress"');

    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.operator).toBe("and");

      // Left should be group with OR inside
      const left = ast.left as GroupNode;
      expect(left.type).toBe("group");
      const innerOr = left.expression as LogicalNode;
      expect(innerOr.operator).toBe("or");

      // Right should be status comparison
      const right = ast.right as ComparisonNode;
      expect(right.field).toBe("status");
    }
  });

  test("Active projects for specific clients OR high-budget projects", () => {
    const ast = expectParsed(
      '(clientPartyId in ["01CLIENT123","01CLIENT456"] and status eq "active") or totalBudget gt "1000000"',
    );

    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.operator).toBe("or");

      // Left should be group with AND
      const left = ast.left as GroupNode;
      expect(left.type).toBe("group");

      // Right should be totalBudget comparison
      const right = ast.right as ComparisonNode;
      expect(right.field).toBe("totalBudget");
      expect(right.operator).toBe("gt");
    }
  });

  test("Complex user permissions", () => {
    const ast = expectParsed(
      '(role eq "admin" or role eq "moderator") and (active eq true or createdAt gt "2025-01-01")',
    );

    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.operator).toBe("and");

      // Both left and right should be groups
      const left = ast.left as GroupNode;
      const right = ast.right as GroupNode;
      expect(left.type).toBe("group");
      expect(right.type).toBe("group");
    }
  });

  test("Multi-level nesting", () => {
    const ast = expectParsed(
      '((priority eq "urgent" and assignedToUserId is_not_null) or (priority eq "high" and targetEndDate lt "2025-02-01")) and status ne "completed"',
    );

    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.operator).toBe("and");

      // Left should be group with nested structure
      const left = ast.left as GroupNode;
      expect(left.type).toBe("group");
      const innerOr = left.expression as LogicalNode;
      expect(innerOr.operator).toBe("or");
    }
  });
});

// ============================================================================
// TASK MANAGEMENT QUERIES
// ============================================================================

describe("URL Examples - Task Management", () => {
  test("Show all high-priority tasks", () => {
    const ast = expectParsed('priority eq "high"');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.field).toBe("priority");
      expect(ast.operator).toBe("eq");
      expect(ast.value).toBe("high");
    }
  });

  test("Show incomplete tasks", () => {
    const ast = expectParsed('status ne "completed"');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("ne");
      expect(ast.value).toBe("completed");
    }
  });

  test("Show urgent tasks that are overdue", () => {
    const ast = expectParsed('priority eq "urgent" and targetEndDate lt "2025-01-15"');
    expect(ast.type).toBe("logical");
  });

  test("Show tasks waiting for materials or inspection", () => {
    const ast = expectParsed('status in ["waiting_materials","waiting_inspection"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("in");
      expect(Array.isArray(ast.value)).toBe(true);
      expect(ast.value).toEqual(["waiting_materials", "waiting_inspection"]);
    }
  });

  test("Show active tasks (not completed, not on hold)", () => {
    const ast = expectParsed('status not_in ["completed","on_hold"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("not_in");
      expect(ast.value).toEqual(["completed", "on_hold"]);
    }
  });

  test("Show tasks due this week", () => {
    const ast = expectParsed('targetEndDate between ["2025-01-13","2025-01-19"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("between");
      expect(ast.value).toEqual(["2025-01-13", "2025-01-19"]);
    }
  });

  test("Show tasks with no due date", () => {
    const ast = expectParsed("targetEndDate is_null");
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("is_null");
      expect(ast.value).toBe(null);
    }
  });

  test("Show tasks that are 50% or more complete", () => {
    const ast = expectParsed("percentComplete gte 50");
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("gte");
      expect(ast.value).toBe(50);
    }
  });

  test("Find tasks by title", () => {
    const ast = expectParsed('title contains "painting"');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("contains");
      expect(ast.value).toBe("painting");
    }
  });

  test("Show parent tasks only (no subtasks)", () => {
    const ast = expectParsed("parentTaskId is_null");
    expect(ast.type).toBe("comparison");
  });
});

// ============================================================================
// COMPLETE QUERIES WITH SORT/LIMIT
// ============================================================================

describe("URL Examples - Complete Queries", () => {
  test("My high-priority tasks due this week", () => {
    const ast = expectFullQueryParsed(
      'filter=assignedToUserId eq "01USER123" AND priority eq "high" and targetEndDate between ["2025-01-13","2025-01-19"]&sort=targetEndDate:asc',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toEqual([{ field: "targetEndDate", direction: "asc" }]);
  });

  test("Unassigned urgent tasks", () => {
    const ast = expectFullQueryParsed('filter=assignedToUserId is_null and priority eq "urgent"&sort=createdAt:desc');

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
  });

  test("Blocked tasks", () => {
    const ast = expectFullQueryParsed(
      'filter=status in ["waiting_materials","waiting_inspection"]&sort=status:asc,targetEndDate:asc',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toEqual([
      { field: "status", direction: "asc" },
      { field: "targetEndDate", direction: "asc" },
    ]);
  });

  test("Team tasks (multiple assignees)", () => {
    const ast = expectFullQueryParsed(
      'filter=assignedToUserId in ["01USER123","01USER456","01USER789"]&sort=priority:desc,targetEndDate:asc',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toEqual([
      { field: "priority", direction: "desc" },
      { field: "targetEndDate", direction: "asc" },
    ]);
  });
});

// ============================================================================
// PROJECT MANAGEMENT QUERIES
// ============================================================================

describe("URL Examples - Project Management", () => {
  test("Show active projects", () => {
    const ast = expectParsed('status eq "active"');
    expect(ast.type).toBe("comparison");
  });

  test("Show projects in planning or active phase", () => {
    const ast = expectParsed('status in ["planning","active"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.value).toEqual(["planning", "active"]);
    }
  });

  test("Show overdue projects", () => {
    const ast = expectParsed('plannedEndDate lt "2025-01-15" and status not_in ["completed","cancelled"]');
    expect(ast.type).toBe("logical");
  });

  test("Show high-budget projects", () => {
    const ast = expectParsed('totalBudget gt "500000"');
    expect(ast.type).toBe("comparison");
  });

  test("Show projects within budget range", () => {
    const ast = expectParsed('totalBudget between ["100000","500000"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("between");
      expect(ast.value).toEqual(["100000", "500000"]);
    }
  });

  test("Find projects by name", () => {
    const ast = expectParsed('name contains "residential"');
    expect(ast.type).toBe("comparison");
  });
});

// ============================================================================
// USER & TEAM MANAGEMENT QUERIES
// ============================================================================

describe("URL Examples - User & Team Management", () => {
  test("Show admin users", () => {
    const ast = expectParsed('role eq "admin"');
    expect(ast.type).toBe("comparison");
  });

  test("Show active users", () => {
    const ast = expectParsed("active eq true");
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.value).toBe(true);
    }
  });

  test("Find users by email domain", () => {
    const ast = expectParsed('email ends_with "@company.com"');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("ends_with");
      expect(ast.value).toBe("@company.com");
    }
  });

  test("Show admins or moderators", () => {
    const ast = expectParsed('role in ["admin","moderator"]');
    expect(ast.type).toBe("comparison");
  });

  test("Show active admins in a workspace", () => {
    const ast = expectFullQueryParsed(
      'filter=active eq true AND role eq "admin" and workspaceId eq "01WORKSPACE123"&sort=name:asc',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toEqual([{ field: "name", direction: "asc" }]);
  });
});

// ============================================================================
// DASHBOARD VIEWS
// ============================================================================

describe("URL Examples - Dashboard Views", () => {
  test("My Tasks Dashboard", () => {
    const ast = expectFullQueryParsed(
      'filter=assignedToUserId eq "01USER123" and status not_in ["completed","cancelled"]&sort=priority:desc,targetEndDate:asc&limit=50',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toEqual([
      { field: "priority", direction: "desc" },
      { field: "targetEndDate", direction: "asc" },
    ]);
    expect(ast.limit).toBe(50);
  });

  test("Team Overview", () => {
    const ast = expectFullQueryParsed(
      'filter=projectId eq "01PROJ123" and status in ["in_progress","not_started"]&sort=assignedToUserId:asc,priority:desc',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toHaveLength(2);
  });

  test("Project Health Check", () => {
    const ast = expectFullQueryParsed(
      'filter=status eq "active" and (plannedEndDate lt "2025-02-01" or totalBudget gt "1000000")&sort=plannedEndDate:asc',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toEqual([{ field: "plannedEndDate", direction: "asc" }]);
  });
});

// ============================================================================
// ADVANCED FILTERING
// ============================================================================

describe("URL Examples - Advanced Filtering", () => {
  test("Critical Path Tasks", () => {
    const ast = expectFullQueryParsed(
      'filter=(priority eq "urgent" or priority eq "high") AND status in ["in_progress","not_started","waiting_materials"] and targetEndDate lt "2025-02-01"&sort=targetEndDate:asc,priority:desc',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.sort).toHaveLength(2);
  });

  test("Blocked Work Items", () => {
    const ast = expectFullQueryParsed(
      'filter=status in ["waiting_materials","waiting_inspection","on_hold"] and assignedToUserId is_not_null&sort=status:asc,targetEndDate:asc',
    );

    expect(ast.filter).toBeDefined();
    if (ast.filter?.type === "logical") {
      const right = ast.filter.right as ComparisonNode;
      expect(right.operator).toBe("is_not_null");
    }
  });

  test("Recently Updated Active Projects", () => {
    const ast = expectFullQueryParsed(
      'filter=status eq "active" and updatedAt gte "2025-01-01"&sort=updatedAt:desc&limit=25',
    );

    expect(ast.filter).toBeDefined();
    expect(ast.limit).toBe(25);
  });
});

// ============================================================================
// PAGINATION & SORTING
// ============================================================================

describe("URL Examples - Common Patterns", () => {
  test("Pagination - First page", () => {
    const ast = expectFullQueryParsed("limit=25");
    expect(ast.limit).toBe(25);
  });

  test("Pagination - Second page", () => {
    const ast = expectFullQueryParsed("limit=25&offset=25");
    expect(ast.limit).toBe(25);
    expect(ast.offset).toBe(25);
  });

  test("Large result set with filtering", () => {
    const ast = expectFullQueryParsed('filter=status eq "active"&sort=createdAt:desc&limit=100&offset=200');

    expect(ast.limit).toBe(100);
    expect(ast.offset).toBe(200);
    expect(ast.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
  });

  test("Multiple field sorting", () => {
    const ast = expectFullQueryParsed("sort=priority:desc,targetEndDate:asc,title:asc");

    expect(ast.sort).toEqual([
      { field: "priority", direction: "desc" },
      { field: "targetEndDate", direction: "asc" },
      { field: "title", direction: "asc" },
    ]);
  });

  test("Default sort direction (ascending)", () => {
    const ast = expectFullQueryParsed("sort=name");
    expect(ast.sort).toEqual([{ field: "name", direction: "asc" }]);
  });
});

// ============================================================================
// NULL HANDLING
// ============================================================================

describe("URL Examples - Null Handling", () => {
  test("Has value (is_not_null)", () => {
    const ast = expectParsed("assignedToUserId is_not_null");
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("is_not_null");
    }
  });

  test("Missing value (is_null)", () => {
    const ast = expectParsed("targetEndDate is_null");
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("is_null");
    }
  });

  test("Optional with fallback", () => {
    const ast = expectParsed('assignedToUserId is_null or assignedToUserId eq "01USER123"');
    expect(ast.type).toBe("logical");
    if (ast.type === "logical") {
      expect(ast.operator).toBe("or");
    }
  });
});

// ============================================================================
// ARRAY OPERATIONS
// ============================================================================

describe("URL Examples - Array Operations", () => {
  test("In list", () => {
    const ast = expectParsed('status in ["in_progress","not_started","waiting_materials"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("in");
      expect(ast.value).toEqual(["in_progress", "not_started", "waiting_materials"]);
    }
  });

  test("Not in list", () => {
    const ast = expectParsed('priority not_in ["low"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.operator).toBe("not_in");
      expect(ast.value).toEqual(["low"]);
    }
  });

  test("Multiple IDs", () => {
    const ast = expectParsed('id in ["01TASK123","01TASK456","01TASK789"]');
    expect(ast.type).toBe("comparison");
    if (ast.type === "comparison") {
      expect(ast.value).toHaveLength(3);
    }
  });
});

// ============================================================================
// parseQueryString OVERLOADS (URL & URLSearchParams)
// ============================================================================

import { parseSortExpression } from "./query-string.js";

describe("parseQueryString overloads", () => {
  test("parses from URL object", () => {
    const url = new URL("http://example.com?filter=status eq 'active'&limit=25");
    const result = parseQueryString(url);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.filter).toBe("status eq 'active'");
      expect(result.data.limit).toBe(25);
    }
  });

  test("parses from URLSearchParams", () => {
    const params = new URLSearchParams("filter=priority eq 'high'&sort=name:asc");
    const result = parseQueryString(params);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.filter).toBe("priority eq 'high'");
      expect(result.data.sort).toEqual([{ field: "name", direction: "asc" }]);
    }
  });

  test("handles empty URL params", () => {
    const url = new URL("http://example.com");
    const result = parseQueryString(url);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.filter).toBeUndefined();
      expect(result.data.sort).toBeUndefined();
      expect(result.data.limit).toBeUndefined();
      expect(result.data.offset).toBeUndefined();
    }
  });

  test("handles empty URLSearchParams", () => {
    const params = new URLSearchParams();
    const result = parseQueryString(params);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toEqual({});
    }
  });

  test("rejects invalid limit from URL", () => {
    const url = new URL("http://example.com?limit=abc");
    const result = parseQueryString(url);
    expect(isSuccess(result)).toBe(false);
  });

  test("rejects limit above 1000 from URLSearchParams", () => {
    const params = new URLSearchParams("limit=5000");
    const result = parseQueryString(params);
    expect(isSuccess(result)).toBe(false);
  });

  test("rejects negative offset from URL", () => {
    const url = new URL("http://example.com?offset=-5");
    const result = parseQueryString(url);
    expect(isSuccess(result)).toBe(false);
  });

  test("parses all params from URL", () => {
    const url = new URL("http://example.com?filter=age gte 18&sort=name:asc,age:desc&limit=50&offset=100");
    const result = parseQueryString(url);
    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.filter).toBe("age gte 18");
      expect(result.data.sort).toEqual([
        { field: "name", direction: "asc" },
        { field: "age", direction: "desc" },
      ]);
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(100);
    }
  });
});

// ============================================================================
// parseSortExpression EDGE CASES
// ============================================================================

describe("parseSortExpression edge cases", () => {
  test("empty string returns empty array", () => {
    expect(parseSortExpression("")).toEqual([]);
  });

  test("whitespace-only items are filtered out", () => {
    expect(parseSortExpression(",,,")).toEqual([]);
  });

  test("trims whitespace around items", () => {
    expect(parseSortExpression(" name:asc , age:desc ")).toEqual([
      { field: "name", direction: "asc" },
      { field: "age", direction: "desc" },
    ]);
  });

  test("missing direction defaults to asc", () => {
    expect(parseSortExpression("name")).toEqual([{ field: "name", direction: "asc" }]);
  });

  test("case insensitive direction", () => {
    expect(parseSortExpression("name:DESC")).toEqual([{ field: "name", direction: "desc" }]);
    expect(parseSortExpression("age:Asc")).toEqual([{ field: "age", direction: "asc" }]);
  });

  test("invalid direction falls back to asc", () => {
    expect(parseSortExpression("name:xyz")).toEqual([{ field: "name", direction: "asc" }]);
  });
});

// ============================================================================
// SERIALIZATION TESTS
// ============================================================================

import type { QueryAst } from "./ast-types.js";
import { serializeQueryAst } from "./query-string.js";

describe("QueryAst Serialization", () => {
  test("serializes is_null without value", () => {
    const ast: QueryAst = {
      filter: {
        type: "comparison",
        field: "dueDate",
        operator: "is_null",
        value: null,
      },
    };

    const serialized = serializeQueryAst(ast);
    expect(serialized).toBe("filter=dueDate%20is_null");

    // Verify round-trip works
    const parsed = parseQueryString(serialized);
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed) && parsed.data.filter) {
      const reparsed = parseFilterExpression(parsed.data.filter);
      expect(isSuccess(reparsed)).toBe(true);
    }
  });

  test("serializes is_not_null without value", () => {
    const ast: QueryAst = {
      filter: {
        type: "comparison",
        field: "assignee",
        operator: "is_not_null",
        value: null,
      },
    };

    const serialized = serializeQueryAst(ast);
    expect(serialized).toBe("filter=assignee%20is_not_null");
  });

  test("escapes quotes in string values", () => {
    const ast: QueryAst = {
      filter: {
        type: "comparison",
        field: "name",
        operator: "eq",
        value: 'John "The Rock" Doe',
      },
    };

    const serialized = serializeQueryAst(ast);
    // Should contain escaped quotes (URL-encoded: \" becomes %5C%22)
    const decoded = decodeURIComponent(serialized);
    expect(decoded).toContain('\\"');

    // Verify round-trip works
    const parsed = parseQueryString(serialized);
    expect(isSuccess(parsed)).toBe(true);
    if (isSuccess(parsed) && parsed.data.filter) {
      const reparsed = parseFilterExpression(parsed.data.filter);
      expect(isSuccess(reparsed)).toBe(true);
      if (isSuccess(reparsed) && reparsed.data.type === "comparison") {
        expect(reparsed.data.value).toBe('John "The Rock" Doe');
      }
    }
  });

  test("escapes backslashes in string values", () => {
    const ast: QueryAst = {
      filter: {
        type: "comparison",
        field: "path",
        operator: "eq",
        value: "C:\\Users\\Test",
      },
    };

    const serialized = serializeQueryAst(ast);
    // URL-encoded: \\ becomes %5C%5C
    const decoded = decodeURIComponent(serialized);
    expect(decoded).toContain("\\\\");
  });

  test("serializes logical operators in lowercase", () => {
    const ast: QueryAst = {
      filter: {
        type: "logical",
        operator: "and",
        left: {
          type: "comparison",
          field: "status",
          operator: "eq",
          value: "active",
        },
        right: {
          type: "comparison",
          field: "priority",
          operator: "gte",
          value: 3,
        },
      },
    };

    const serialized = decodeURIComponent(serializeQueryAst(ast));
    expect(serialized).toContain(" and ");
    expect(serialized).not.toContain("AND");
  });

  test("serializes arrays in values", () => {
    const ast: QueryAst = {
      filter: {
        type: "comparison",
        field: "status",
        operator: "in",
        value: ["active", "pending"],
      },
    };

    const serialized = serializeQueryAst(ast);
    const decoded = decodeURIComponent(serialized);
    expect(decoded).toContain('["active","pending"]');
  });

  test("serializes numeric arrays without quotes", () => {
    const ast: QueryAst = {
      filter: {
        type: "comparison",
        field: "priority",
        operator: "in",
        value: [1, 2, 3],
      },
    };

    const serialized = serializeQueryAst(ast);
    const decoded = decodeURIComponent(serialized);
    expect(decoded).toContain("[1,2,3]");
  });

  test("full round-trip with complex query", () => {
    const originalQuery = 'filter=status eq "active" AND priority gte 3&sort=createdAt:desc&limit=50&offset=10';
    const parsed = parseQueryString(originalQuery);
    expect(isSuccess(parsed)).toBe(true);

    if (isSuccess(parsed) && parsed.data.filter) {
      const filterAst = parseFilterExpression(parsed.data.filter);
      expect(isSuccess(filterAst)).toBe(true);

      if (isSuccess(filterAst)) {
        const ast: QueryAst = {
          filter: filterAst.data,
          sort: parsed.data.sort,
          limit: parsed.data.limit,
          offset: parsed.data.offset,
        };

        const serialized = serializeQueryAst(ast);
        expect(serialized).toContain("filter=");
        expect(serialized).toContain("sort=createdAt:desc");
        expect(serialized).toContain("limit=50");
        expect(serialized).toContain("offset=10");
      }
    }
  });
});

describe("serializeFilterNode", () => {
  const cmp = (field: string): ComparisonNode => ({ type: "comparison", field, operator: "eq", value: 1 });

  test("an ungrouped OR under an AND gets parentheses, so it keeps its meaning", () => {
    // Hand-built: parseFilter only produces this shape with a group node
    const node: LogicalNode = {
      type: "logical",
      operator: "and",
      left: { type: "logical", operator: "or", left: cmp("a"), right: cmp("b") },
      right: cmp("c"),
    };
    const text = serializeFilterNode(node);
    expect(text).toBe("(a eq 1 or b eq 1) and c eq 1"); // was "a eq 1 or b eq 1 and c eq 1"
    const reparsed = parseFilterExpression(text);
    expect(reparsed.success && reparsed.data.type === "logical" && reparsed.data.operator).toBe("and");
  });

  test("an AND under an OR needs none", () => {
    const node: LogicalNode = {
      type: "logical",
      operator: "or",
      left: cmp("a"),
      right: { type: "logical", operator: "and", left: cmp("b"), right: cmp("c") },
    };
    expect(serializeFilterNode(node)).toBe("a eq 1 or b eq 1 and c eq 1");
  });

  test("a 50,000-condition chain serializes, not a RangeError", () => {
    let chain: FilterNode = cmp("a");
    for (let i = 0; i < 50_000; i++) {
      chain = { type: "logical", operator: "or", left: chain, right: cmp("a") };
    }
    expect(serializeFilterNode(chain).split(" or ")).toHaveLength(50_001);
  });
});
