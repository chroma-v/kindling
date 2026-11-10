import { describe, expect, it, vi } from "vitest";
import type { DescriptorAdapter } from "./query-builder.js";
import { createQueryBuilder } from "./query-builder.js";
import type { QueryDescriptor } from "./query-descriptor.js";
import type { QueryInterceptor } from "./query-interceptor.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAdapter<T>(data: T[] = []): DescriptorAdapter<T> & {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
} {
  return {
    findMany: vi.fn().mockResolvedValue(data),
    findFirst: vi.fn().mockResolvedValue(data[0]),
  };
}

// ============================================================================
// createQueryBuilder — Composition
// ============================================================================

describe("createQueryBuilder — composition", () => {
  it("starts with empty descriptor", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    const desc = q.descriptor();
    expect(desc.filter).toBeUndefined();
    expect(desc.sort).toBeUndefined();
    expect(desc.include).toBeUndefined();
    expect(desc.select).toBeUndefined();
    expect(desc.take).toBeUndefined();
    expect(desc.skip).toBeUndefined();
  });

  it("accepts initial descriptor", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({
      adapter,
      initial: {
        filter: { status: "active" },
        sort: { createdAt: "desc" },
        take: 10,
      },
    });
    const desc = q.descriptor();
    expect(desc.filter).toEqual({ status: "active" });
    expect(desc.sort).toEqual({ createdAt: "desc" });
    expect(desc.take).toBe(10);
  });

  it("filter() merges conditions", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    q.filter({ status: "active" }).filter({ priority: "high" });
    expect(q.descriptor().filter).toEqual({ status: "active", priority: "high" });
  });

  it("filter() with the same key narrows: both conditions apply", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    q.filter({ status: "draft" }).filter({ status: "published" });
    expect(q.descriptor().filter).toEqual({ AND: [{ status: "draft" }, { status: "published" }] });
  });

  it("sort() replaces previous sort", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    q.sort({ createdAt: "desc" }).sort({ title: "asc" });
    expect(q.descriptor().sort).toEqual({ title: "asc" });
  });

  it("include() deep-merges relations", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    q.include({ assignedToUser: true }).include({ taskTags: true });
    expect(q.descriptor().include).toEqual({ assignedToUser: true, taskTags: true });
  });

  it("include() deep-merges nested descriptors", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    q.include({ tasks: { filter: { projectId: "p1" } } }).include({ tasks: { filter: { status: "active" } } });
    expect(q.descriptor().include).toEqual({
      tasks: { filter: { projectId: "p1", status: "active" } },
    });
  });

  it("select() merges columns", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    q.select({ id: true }).select({ name: true });
    expect(q.descriptor().select).toEqual({ id: true, name: true });
  });

  it("take() and skip() set pagination", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    q.take(20).skip(40);
    expect(q.descriptor().take).toBe(20);
    expect(q.descriptor().skip).toBe(40);
  });

  it("returns this for chaining (mutable builder)", () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter });
    const result = q.filter({ a: 1 }).sort({ b: "asc" }).take(5);
    expect(result).toBe(q);
  });
});

// ============================================================================
// createQueryBuilder — Execution
// ============================================================================

describe("createQueryBuilder — execution", () => {
  it("findMany() delegates to adapter", async () => {
    const adapter = mockAdapter([{ id: "1" }, { id: "2" }]);
    const q = createQueryBuilder({ adapter, entity: "task" });

    const results = await q.filter({ status: "active" }).sort({ createdAt: "desc" }).take(10).findMany();

    expect(results).toEqual([{ id: "1" }, { id: "2" }]);
    expect(adapter.findMany).toHaveBeenCalledTimes(1);

    const desc = adapter.findMany.mock.calls[0][0] as QueryDescriptor;
    expect(desc.filter).toEqual({ status: "active" });
    expect(desc.sort).toEqual({ createdAt: "desc" });
    expect(desc.take).toBe(10);
  });

  it("findFirst() delegates to adapter and returns single result", async () => {
    const adapter = mockAdapter([{ id: "1", name: "Task" }]);
    const q = createQueryBuilder({ adapter, entity: "task" });

    const result = await q.filter({ id: "1" }).findFirst();

    expect(result).toEqual({ id: "1", name: "Task" });
    expect(adapter.findFirst).toHaveBeenCalledTimes(1);
  });

  it("findFirst() returns undefined when no match", async () => {
    const adapter = mockAdapter();
    adapter.findFirst.mockResolvedValue(undefined);
    const q = createQueryBuilder({ adapter, entity: "task" });

    const result = await q.filter({ id: "nonexistent" }).findFirst();

    expect(result).toBeUndefined();
  });

  it("does not execute until findMany/findFirst is called", () => {
    const adapter = mockAdapter();
    createQueryBuilder({ adapter }).filter({ status: "active" }).sort({ createdAt: "desc" }).take(10);

    expect(adapter.findMany).not.toHaveBeenCalled();
    expect(adapter.findFirst).not.toHaveBeenCalled();
  });

  it("includes are passed to adapter in descriptor", async () => {
    const adapter = mockAdapter();
    const q = createQueryBuilder({ adapter, entity: "task" });

    await q.include({ assignedToUser: true }).findMany();

    const desc = adapter.findMany.mock.calls[0][0] as QueryDescriptor;
    expect(desc.include).toEqual({ assignedToUser: true });
  });
});

// ============================================================================
// createQueryBuilder — Interceptors
// ============================================================================

describe("createQueryBuilder — interceptors", () => {
  it("onExecuting can rewrite the filter", async () => {
    const adapter = mockAdapter();
    const scopeInterceptor: QueryInterceptor = {
      onExecuting: (ctx) =>
        ctx.rewrite({
          filter: { ...ctx.descriptor.filter, workspaceId: "ws-1" },
        }),
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [scopeInterceptor],
      entity: "task",
    });

    await q.filter({ status: "active" }).findMany();

    const desc = adapter.findMany.mock.calls[0][0] as QueryDescriptor;
    expect(desc.filter).toEqual({ status: "active", workspaceId: "ws-1" });
  });

  it("onExecuting interceptors run in order (last wins for scoping)", async () => {
    const adapter = mockAdapter();

    const userFilter: QueryInterceptor = {
      onExecuting: (ctx) =>
        ctx.rewrite({
          filter: { ...ctx.descriptor.filter, userId: "user-1" },
        }),
    };
    const wsScope: QueryInterceptor = {
      onExecuting: (ctx) =>
        ctx.rewrite({
          filter: { ...ctx.descriptor.filter, workspaceId: "ws-1" },
        }),
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [userFilter, wsScope],
      entity: "task",
    });

    await q.findMany();

    const desc = adapter.findMany.mock.calls[0][0] as QueryDescriptor;
    expect(desc.filter).toEqual({ userId: "user-1", workspaceId: "ws-1" });
  });

  it("onExecuting can add includes", async () => {
    const adapter = mockAdapter();
    const defaultIncludes: QueryInterceptor = {
      onExecuting: (ctx) =>
        ctx.rewrite({
          include: { ...ctx.descriptor.include, assignedToUser: true },
        }),
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [defaultIncludes],
      entity: "task",
    });

    await q.include({ taskTags: true }).findMany();

    const desc = adapter.findMany.mock.calls[0][0] as QueryDescriptor;
    expect(desc.include).toEqual({ taskTags: true, assignedToUser: true });
  });

  it("onExecuted can transform results", async () => {
    const adapter = mockAdapter([
      { id: "1", name: "Task 1" },
      { id: "2", name: "Task 2" },
    ]);

    const filterResults: QueryInterceptor<{ id: string; name: string }> = {
      onExecuted: (ctx) => ctx.mapResults((results) => results.filter((r) => r.id === "1")),
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [filterResults],
      entity: "task",
    });

    const results = await q.findMany();
    expect(results).toEqual([{ id: "1", name: "Task 1" }]);
  });

  it("onExecuted receives duration", async () => {
    const adapter = mockAdapter([{ id: "1" }]);
    let capturedDuration = -1;

    const timing: QueryInterceptor = {
      onExecuted: (ctx) => {
        capturedDuration = ctx.duration;
        return ctx;
      },
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [timing],
      entity: "task",
    });

    await q.findMany();
    expect(capturedDuration).toBeGreaterThanOrEqual(0);
  });

  it("async interceptors are awaited", async () => {
    const adapter = mockAdapter();
    const order: string[] = [];

    const slow: QueryInterceptor = {
      onExecuting: async (ctx) => {
        await new Promise((r) => setTimeout(r, 10));
        order.push("slow");
        return ctx.rewrite({ filter: { ...ctx.descriptor.filter, slow: true } });
      },
    };
    const fast: QueryInterceptor = {
      onExecuting: (ctx) => {
        order.push("fast");
        return ctx.rewrite({ filter: { ...ctx.descriptor.filter, fast: true } });
      },
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [slow, fast],
      entity: "task",
    });

    await q.findMany();

    expect(order).toEqual(["slow", "fast"]);
    const desc = adapter.findMany.mock.calls[0][0] as QueryDescriptor;
    expect(desc.filter).toEqual({ slow: true, fast: true });
  });

  it("scoping interceptor is unforgeable when placed last", async () => {
    const adapter = mockAdapter();

    const wsScope: QueryInterceptor = {
      onExecuting: (ctx) =>
        ctx.rewrite({
          filter: { ...ctx.descriptor.filter, workspaceId: "ws-forced" },
        }),
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [wsScope],
      entity: "task",
    });

    // Caller tries to set workspaceId. Both conditions apply, so the query can
    // only return rows in ws-forced (here: none, since no row is in both).
    await q.filter({ workspaceId: "ws-evil" }).findMany();

    const desc = adapter.findMany.mock.calls[0][0] as QueryDescriptor;
    expect(desc.filter).toEqual({ AND: [{ workspaceId: "ws-evil" }, { workspaceId: "ws-forced" }] });
  });

  it("interceptors work with findFirst", async () => {
    const adapter = mockAdapter([{ id: "1", status: "active" }]);

    const scope: QueryInterceptor = {
      onExecuting: (ctx) =>
        ctx.rewrite({
          filter: { ...ctx.descriptor.filter, workspaceId: "ws-1" },
        }),
    };

    const q = createQueryBuilder({
      adapter,
      interceptors: [scope],
      entity: "task",
    });

    const result = await q.filter({ id: "1" }).findFirst();
    expect(result).toEqual({ id: "1", status: "active" });

    // findFirst goes through findFirst adapter path, but interceptor still ran
    const desc = adapter.findFirst.mock.calls[0][0] as QueryDescriptor;
    expect(desc.filter).toEqual({ id: "1", workspaceId: "ws-1" });
  });
});
