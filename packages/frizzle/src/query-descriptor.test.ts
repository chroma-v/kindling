import { describe, expect, it } from "vitest";
import type { Include } from "./query-descriptor.js";
import { mergeDescriptors, mergeIncludes, walkIncludes } from "./query-descriptor.js";

// ============================================================================
// mergeIncludes
// ============================================================================

describe("mergeIncludes", () => {
  it("merges non-overlapping keys", () => {
    const result = mergeIncludes({ assignedToUser: true }, { taskTags: true });
    expect(result).toEqual({ assignedToUser: true, taskTags: true });
  });

  it("later boolean overrides earlier boolean", () => {
    const result = mergeIncludes({ assignedToUser: true }, { assignedToUser: true });
    expect(result).toEqual({ assignedToUser: true });
  });

  it("descriptor overrides boolean", () => {
    const result = mergeIncludes({ tasks: true }, { tasks: { filter: { status: "active" } } });
    expect(result).toEqual({ tasks: { filter: { status: "active" } } });
  });

  it("boolean overrides descriptor", () => {
    const result = mergeIncludes({ tasks: { filter: { status: "active" } } }, { tasks: true });
    expect(result).toEqual({ tasks: true });
  });

  it("deep-merges descriptors with filters", () => {
    const result = mergeIncludes(
      { tasks: { filter: { projectId: "p1" } } },
      { tasks: { filter: { status: "active" } } },
    );
    expect(result).toEqual({
      tasks: { filter: { projectId: "p1", status: "active" } },
    });
  });

  it("deep-merges nested includes", () => {
    const result = mergeIncludes(
      { tasks: { include: { assignedToUser: true } } },
      { tasks: { include: { taskTags: true } } },
    );
    expect(result).toEqual({
      tasks: { include: { assignedToUser: true, taskTags: true } },
    });
  });

  it("deep-merges select specs", () => {
    const result = mergeIncludes({ tasks: { select: { id: true } } }, { tasks: { select: { name: true } } });
    expect(result).toEqual({
      tasks: { select: { id: true, name: true } },
    });
  });

  it("later sort overrides earlier sort in descriptor merge", () => {
    const result = mergeIncludes({ tasks: { sort: { createdAt: "asc" } } }, { tasks: { sort: { updatedAt: "desc" } } });
    expect(result).toEqual({
      tasks: { sort: { updatedAt: "desc" } },
    });
  });

  it("does not mutate inputs", () => {
    const a: Include = { assignedToUser: true };
    const b: Include = { taskTags: true };
    mergeIncludes(a, b);
    expect(a).toEqual({ assignedToUser: true });
    expect(b).toEqual({ taskTags: true });
  });
});

// ============================================================================
// mergeDescriptors
// ============================================================================

describe("mergeDescriptors", () => {
  it("merges filters", () => {
    const result = mergeDescriptors({ filter: { status: "active" } }, { filter: { priority: "high" } });
    expect(result.filter).toEqual({ status: "active", priority: "high" });
  });

  it("sort is last-write-wins", () => {
    const result = mergeDescriptors({ sort: { createdAt: "desc" } }, { sort: { title: "asc" } });
    expect(result.sort).toEqual({ title: "asc" });
  });

  it("includes are deep-merged", () => {
    const result = mergeDescriptors({ include: { assignedToUser: true } }, { include: { taskTags: true } });
    expect(result.include).toEqual({ assignedToUser: true, taskTags: true });
  });

  it("take/skip are last-write-wins", () => {
    const result = mergeDescriptors({ take: 10, skip: 0 }, { take: 20 });
    expect(result.take).toBe(20);
    expect(result.skip).toBe(0);
  });

  it("preserves fields not in the partial", () => {
    const result = mergeDescriptors(
      { filter: { status: "active" }, sort: { createdAt: "desc" }, take: 10 },
      { filter: { priority: "high" } },
    );
    expect(result.sort).toEqual({ createdAt: "desc" });
    expect(result.take).toBe(10);
  });
});

// ============================================================================
// walkIncludes
// ============================================================================

describe("walkIncludes", () => {
  it("visits IncludeDescriptor entries, skips booleans", () => {
    const visited: string[][] = [];
    walkIncludes(
      {
        assignedToUser: true,
        tasks: { filter: { status: "active" } },
      },
      (path) => visited.push(path),
    );
    expect(visited).toEqual([["tasks"]]);
  });

  it("recurses into nested includes", () => {
    const visited: string[][] = [];
    walkIncludes(
      {
        tasks: {
          include: {
            taskTags: {
              include: { tag: { select: { name: true } } },
            },
          },
        },
      },
      (path) => visited.push(path),
    );
    expect(visited).toEqual([["tasks"], ["tasks", "taskTags"], ["tasks", "taskTags", "tag"]]);
  });

  it("handles empty include", () => {
    const visited: string[][] = [];
    walkIncludes({}, (path) => visited.push(path));
    expect(visited).toEqual([]);
  });
});
