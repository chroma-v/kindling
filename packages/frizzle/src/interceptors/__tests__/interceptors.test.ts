import { describe, expect, test } from "vitest";
import type { Include } from "../../query-descriptor.js";
import { createExecutingContext } from "../../query-interceptor.js";
import { createWriteDescriptor } from "../../write-descriptor.js";
import { createWritingContext } from "../../write-interceptor.js";
import {
  defaultIncludesInterceptor,
  extraScopeInterceptor,
  extraScopeWriteInterceptor,
  injectWriteInterceptor,
  scopeQueryInterceptor,
  scopeWriteInterceptor,
  softDeleteQueryInterceptor,
  softDeleteWriteInterceptor,
} from "../index.js";

// ============================================================================
// HELPERS
// ============================================================================

function queryCtx(filter?: Record<string, unknown>, include?: Include) {
  return createExecutingContext("task", "findMany", { filter, include }, {});
}

function writeCtx(
  mutation: "insert" | "update" | "delete",
  operation: "create" | "update" | "remove" | "restore",
  values: Record<string, unknown> = {},
) {
  return createWritingContext("task", operation, createWriteDescriptor(mutation, values), {});
}

// ============================================================================
// SCOPE QUERY INTERCEPTOR
// ============================================================================

describe("scopeQueryInterceptor", () => {
  test("appends scope fields to empty filter", () => {
    const interceptor = scopeQueryInterceptor({ workspaceId: "ws-1" });
    const result = interceptor.onExecuting!(queryCtx());
    expect((result as { descriptor: { filter: unknown } }).descriptor.filter).toEqual({
      workspaceId: "ws-1",
    });
  });

  test("merges scope fields with existing filter", () => {
    const interceptor = scopeQueryInterceptor({ workspaceId: "ws-1" });
    const result = interceptor.onExecuting!(queryCtx({ status: "active" }));
    expect((result as { descriptor: { filter: unknown } }).descriptor.filter).toEqual({
      status: "active",
      workspaceId: "ws-1",
    });
  });

  test("supports multiple scope fields", () => {
    const interceptor = scopeQueryInterceptor({ workspaceId: "ws-1", isDeleted: false });
    const result = interceptor.onExecuting!(queryCtx());
    expect((result as { descriptor: { filter: unknown } }).descriptor.filter).toEqual({
      workspaceId: "ws-1",
      isDeleted: false,
    });
  });

  test("returns new context (immutability)", () => {
    const interceptor = scopeQueryInterceptor({ workspaceId: "ws-1" });
    const original = queryCtx({ status: "active" });
    const result = interceptor.onExecuting!(original);
    expect(result).not.toBe(original);
    expect(original.descriptor.filter).toEqual({ status: "active" });
  });
});

// ============================================================================
// SCOPE WRITE INTERCEPTOR
// ============================================================================

describe("scopeWriteInterceptor", () => {
  test("injects scope into insert values", () => {
    const interceptor = scopeWriteInterceptor({ workspaceId: "ws-1" });
    const result = interceptor.onWriting!(writeCtx("insert", "create", { title: "Task" }));
    expect((result as { descriptor: { values: unknown } }).descriptor.values).toEqual({
      title: "Task",
      workspaceId: "ws-1",
    });
  });

  test("injects scope into update values", () => {
    const interceptor = scopeWriteInterceptor({ workspaceId: "ws-1" });
    const result = interceptor.onWriting!(writeCtx("update", "update", { title: "Updated" }));
    expect((result as { descriptor: { values: unknown } }).descriptor.values).toEqual({
      title: "Updated",
      workspaceId: "ws-1",
    });
  });
});

// ============================================================================
// SOFT DELETE QUERY INTERCEPTOR
// ============================================================================

describe("softDeleteQueryInterceptor", () => {
  test("appends isDeleted: false by default", () => {
    const interceptor = softDeleteQueryInterceptor();
    const result = interceptor.onExecuting!(queryCtx());
    expect((result as { descriptor: { filter: unknown } }).descriptor.filter).toEqual({
      isDeleted: false,
    });
  });

  test("supports custom column name", () => {
    const interceptor = softDeleteQueryInterceptor({ column: "archived" });
    const result = interceptor.onExecuting!(queryCtx());
    expect((result as { descriptor: { filter: unknown } }).descriptor.filter).toEqual({
      archived: false,
    });
  });
});

// ============================================================================
// SOFT DELETE WRITE INTERCEPTOR
// ============================================================================

describe("softDeleteWriteInterceptor", () => {
  test("transforms remove into update with isDeleted: true", () => {
    const interceptor = softDeleteWriteInterceptor("user-1");
    const result = interceptor.onWriting!(writeCtx("delete", "remove"));
    const desc = (result as { descriptor: { mutation: string; values: Record<string, unknown> } }).descriptor;
    expect(desc.mutation).toBe("update");
    expect(desc.values.isDeleted).toBe(true);
    expect(desc.values.deletedAt).toBeInstanceOf(Date);
    expect(desc.values.deletedById).toBe("user-1");
  });

  test("transforms restore by clearing soft-delete fields", () => {
    const interceptor = softDeleteWriteInterceptor("user-1");
    const result = interceptor.onWriting!(writeCtx("update", "restore"));
    const desc = (result as { descriptor: { values: Record<string, unknown> } }).descriptor;
    expect(desc.values.isDeleted).toBe(false);
    expect(desc.values.deletedAt).toBeNull();
    expect(desc.values.deletedById).toBeNull();
  });

  test("passes through create and update operations", () => {
    const interceptor = softDeleteWriteInterceptor("user-1");
    const original = writeCtx("insert", "create", { title: "New" });
    const result = interceptor.onWriting!(original);
    expect(result).toBe(original);
  });

  test("respects columns set — skips missing columns", () => {
    const interceptor = softDeleteWriteInterceptor("user-1", {
      columns: new Set(["isDeleted"]),
    });
    const result = interceptor.onWriting!(writeCtx("delete", "remove"));
    const desc = (result as { descriptor: { values: Record<string, unknown> } }).descriptor;
    expect(desc.values.isDeleted).toBe(true);
    expect(desc.values.deletedAt).toBeUndefined();
    expect(desc.values.deletedById).toBeUndefined();
  });

  test("supports custom column names", () => {
    const interceptor = softDeleteWriteInterceptor("user-1", {
      column: "archived",
      deletedAtColumn: "archivedAt",
      deletedByColumn: "archivedById",
    });
    const result = interceptor.onWriting!(writeCtx("delete", "remove"));
    const desc = (result as { descriptor: { values: Record<string, unknown> } }).descriptor;
    expect(desc.values.archived).toBe(true);
    expect(desc.values.archivedAt).toBeInstanceOf(Date);
    expect(desc.values.archivedById).toBe("user-1");
  });
});

// ============================================================================
// INJECT WRITE INTERCEPTOR
// ============================================================================

describe("injectWriteInterceptor", () => {
  test("injects createdById on insert", () => {
    const interceptor = injectWriteInterceptor("user-1");
    const result = interceptor.onWriting!(writeCtx("insert", "create", { title: "Task" }));
    expect((result as { descriptor: { values: Record<string, unknown> } }).descriptor.values).toEqual({
      title: "Task",
      createdById: "user-1",
    });
  });

  test("injects updatedById on update", () => {
    const interceptor = injectWriteInterceptor("user-1");
    const result = interceptor.onWriting!(writeCtx("update", "update", { title: "Updated" }));
    expect((result as { descriptor: { values: Record<string, unknown> } }).descriptor.values).toEqual({
      title: "Updated",
      updatedById: "user-1",
    });
  });

  test("does not inject on delete", () => {
    const interceptor = injectWriteInterceptor("user-1");
    const original = writeCtx("delete", "remove");
    const result = interceptor.onWriting!(original);
    expect(result).toBe(original);
  });

  test("respects columns set", () => {
    const interceptor = injectWriteInterceptor("user-1", {
      columns: new Set(["updatedById"]),
    });
    // createdById not in columns set → should not inject on insert
    const original = writeCtx("insert", "create", { title: "Task" });
    const insertResult = interceptor.onWriting!(original);
    expect(insertResult).toBe(original); // Same reference — no rewrite

    // updatedById in columns set → should inject on update
    const updateResult = interceptor.onWriting!(writeCtx("update", "update", { title: "Updated" }));
    expect((updateResult as { descriptor: { values: Record<string, unknown> } }).descriptor.values.updatedById).toBe(
      "user-1",
    );
  });

  test("supports custom column names", () => {
    const interceptor = injectWriteInterceptor("user-1", {
      createdByColumn: "authorId",
      updatedByColumn: "editorId",
    });
    const insertResult = interceptor.onWriting!(writeCtx("insert", "create"));
    expect((insertResult as { descriptor: { values: Record<string, unknown> } }).descriptor.values.authorId).toBe(
      "user-1",
    );

    const updateResult = interceptor.onWriting!(writeCtx("update", "update"));
    expect((updateResult as { descriptor: { values: Record<string, unknown> } }).descriptor.values.editorId).toBe(
      "user-1",
    );
  });
});

// ============================================================================
// DEFAULT INCLUDES INTERCEPTOR
// ============================================================================

describe("defaultIncludesInterceptor", () => {
  test("sets default includes on empty query", () => {
    const interceptor = defaultIncludesInterceptor({ author: true });
    const result = interceptor.onExecuting!(queryCtx());
    expect((result as { descriptor: { include: unknown } }).descriptor.include).toEqual({
      author: true,
    });
  });

  test("merges with user-provided includes", () => {
    const interceptor = defaultIncludesInterceptor({ author: true });
    const result = interceptor.onExecuting!(queryCtx(undefined, { tags: true }));
    expect((result as { descriptor: { include: unknown } }).descriptor.include).toEqual({
      author: true,
      tags: true,
    });
  });
});

// ============================================================================
// EXTRA SCOPE INTERCEPTOR (Query)
// ============================================================================

describe("extraScopeInterceptor", () => {
  test("adds filter conditions from factory", () => {
    const interceptor = extraScopeInterceptor(() => ({ userId: "user-1" }));
    const result = interceptor.onExecuting!(queryCtx({ status: "active" }));
    expect((result as { descriptor: { filter: unknown } }).descriptor.filter).toEqual({
      status: "active",
      userId: "user-1",
    });
  });
});

// ============================================================================
// EXTRA SCOPE WRITE INTERCEPTOR
// ============================================================================

describe("extraScopeWriteInterceptor", () => {
  test("injects scope on insert", () => {
    const interceptor = extraScopeWriteInterceptor(() => ({ userId: "user-1" }));
    const result = interceptor.onWriting!(writeCtx("insert", "create", { title: "Task" }));
    expect((result as { descriptor: { values: Record<string, unknown> } }).descriptor.values).toEqual({
      title: "Task",
      userId: "user-1",
    });
  });

  test("does not inject on update", () => {
    const interceptor = extraScopeWriteInterceptor(() => ({ userId: "user-1" }));
    const original = writeCtx("update", "update", { title: "Updated" });
    const result = interceptor.onWriting!(original);
    expect(result).toBe(original);
  });

  test("does not inject on delete", () => {
    const interceptor = extraScopeWriteInterceptor(() => ({ userId: "user-1" }));
    const original = writeCtx("delete", "remove");
    const result = interceptor.onWriting!(original);
    expect(result).toBe(original);
  });
});
