import { describe, expect, it, vi } from "vitest";
import { createWriteDescriptor } from "./write-descriptor.js";
import type { WriteInterceptor } from "./write-interceptor.js";
import { createWritingContext, createWrittenContext, executeWritePipeline } from "./write-interceptor.js";

// ============================================================================
// Test helpers
// ============================================================================

interface TestEntity {
  id: string;
  title: string;
  status: string;
  workspaceId?: string;
}

const testService = { session: { userId: "user-1" } };

function testDescriptor(mutation: "insert" | "update" | "delete" = "update", values: Record<string, unknown> = {}) {
  return createWriteDescriptor(mutation, values);
}

// ============================================================================
// createWritingContext
// ============================================================================

describe("createWritingContext", () => {
  it("creates a frozen context", () => {
    const ctx = createWritingContext<TestEntity, typeof testService>("task", "update", testDescriptor(), testService);

    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.entity).toBe("task");
    expect(ctx.operation).toBe("update");
  });

  it("includes existing entity when provided", () => {
    const existing = { id: "1", title: "Old", status: "todo" };
    const ctx = createWritingContext<TestEntity, typeof testService>(
      "task",
      "update",
      testDescriptor(),
      testService,
      existing,
    );

    expect(ctx.existing).toBe(existing);
  });

  it("rewrite() returns a new context with merged descriptor", () => {
    const ctx = createWritingContext<TestEntity, typeof testService>(
      "task",
      "update",
      testDescriptor("update", { title: "Old" }),
      testService,
    );

    const rewritten = ctx.rewrite({ values: { status: "done" } });

    expect(rewritten).not.toBe(ctx);
    expect(rewritten.descriptor.values).toEqual({ title: "Old", status: "done" });
    // Original is unchanged
    expect(ctx.descriptor.values).toEqual({ title: "Old" });
  });

  it("rewrite() with mutation change updates operation", () => {
    const ctx = createWritingContext<TestEntity, typeof testService>(
      "task",
      "remove",
      testDescriptor("delete"),
      testService,
    );

    // softDelete transforms delete → update
    const rewritten = ctx.rewrite({ mutation: "update" });

    expect(rewritten.descriptor.mutation).toBe("update");
    // operation maps from mutation
    expect(rewritten.operation).toBe("update");
  });

  it("rewrite() preserves existing entity reference", () => {
    const existing = { id: "1", title: "Task", status: "todo" };
    const ctx = createWritingContext<TestEntity, typeof testService>(
      "task",
      "update",
      testDescriptor(),
      testService,
      existing,
    );

    const rewritten = ctx.rewrite({ values: { status: "done" } });
    expect(rewritten.existing).toBe(existing);
  });
});

// ============================================================================
// createWrittenContext
// ============================================================================

describe("createWrittenContext", () => {
  it("creates a frozen context with result", () => {
    const result: TestEntity = { id: "1", title: "New", status: "done" };
    const ctx = createWrittenContext<TestEntity, typeof testService>(
      "task",
      "update",
      testDescriptor(),
      testService,
      result,
      undefined,
      undefined,
      5.2,
    );

    expect(Object.isFrozen(ctx)).toBe(true);
    expect(ctx.result).toBe(result);
    expect(ctx.duration).toBe(5.2);
  });

  it("includes changes when provided", () => {
    const changes = { status: "done" };
    const ctx = createWrittenContext<TestEntity, typeof testService>(
      "task",
      "update",
      testDescriptor(),
      testService,
      { id: "1", title: "Task", status: "done" },
      { id: "1", title: "Task", status: "todo" },
      changes,
      3.0,
    );

    expect(ctx.changes).toBe(changes);
    expect(ctx.existing).toEqual({ id: "1", title: "Task", status: "todo" });
  });

  it("mapResult() returns a new context with transformed result", () => {
    const original: TestEntity = { id: "1", title: "Task", status: "todo" };
    const ctx = createWrittenContext<TestEntity, typeof testService>(
      "task",
      "update",
      testDescriptor(),
      testService,
      original,
      undefined,
      undefined,
      1.0,
    );

    const mapped = ctx.mapResult((r) => (r ? { ...r, title: "Transformed" } : r));

    expect(mapped).not.toBe(ctx);
    expect(mapped.result?.title).toBe("Transformed");
    expect(ctx.result?.title).toBe("Task");
  });
});

// ============================================================================
// executeWritePipeline
// ============================================================================

describe("executeWritePipeline", () => {
  it("passes through when no interceptors", async () => {
    const result: TestEntity = { id: "1", title: "Task", status: "todo" };
    const execute = vi.fn().mockResolvedValue(result);

    const output = await executeWritePipeline(
      [],
      execute,
      "task",
      "create",
      testDescriptor("insert", { title: "Task" }),
      testService,
    );

    expect(execute).toHaveBeenCalledTimes(1);
    expect(output.result).toBe(result);
  });

  it("runs onWriting interceptors in order", async () => {
    const order: string[] = [];

    const interceptor1: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: (ctx) => {
        order.push("first");
        return ctx.rewrite({ values: { step: 1 } });
      },
    };

    const interceptor2: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: (ctx) => {
        order.push("second");
        return ctx.rewrite({ values: { step: 2 } });
      },
    };

    const execute = vi.fn().mockResolvedValue({ id: "1" });

    await executeWritePipeline(
      [interceptor1, interceptor2],
      execute,
      "task",
      "create",
      testDescriptor("insert", { title: "Task" }),
      testService,
    );

    expect(order).toEqual(["first", "second"]);
    // Execute sees the final rewritten descriptor
    const executedDesc = execute.mock.calls[0]![0];
    expect(executedDesc.values.step).toBe(2);
  });

  it("runs onWritten interceptors in order", async () => {
    const order: string[] = [];

    const interceptor1: WriteInterceptor<TestEntity, typeof testService> = {
      onWritten: (ctx) => {
        order.push("first");
        return ctx;
      },
    };

    const interceptor2: WriteInterceptor<TestEntity, typeof testService> = {
      onWritten: (ctx) => {
        order.push("second");
        return ctx;
      },
    };

    await executeWritePipeline(
      [interceptor1, interceptor2],
      async () => ({ id: "1", title: "Task", status: "todo" }),
      "task",
      "create",
      testDescriptor("insert"),
      testService,
    );

    expect(order).toEqual(["first", "second"]);
  });

  it("awaits async interceptors", async () => {
    const interceptor: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: async (ctx) => {
        await new Promise((r) => setTimeout(r, 1));
        return ctx.rewrite({ values: { injected: true } });
      },
    };

    const execute = vi.fn().mockResolvedValue({ id: "1" });

    await executeWritePipeline([interceptor], execute, "task", "create", testDescriptor("insert"), testService);

    expect(execute.mock.calls[0]![0].values.injected).toBe(true);
  });

  it("scope interceptor runs last and is unforgeable", async () => {
    // User tries to set workspaceId
    const userInterceptor: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: (ctx) => ctx.rewrite({ values: { workspaceId: "evil" } }),
    };

    // Scope interceptor runs last
    const scopeInterceptor: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: (ctx) => ctx.rewrite({ values: { workspaceId: "ws-legit" } }),
    };

    const execute = vi.fn().mockResolvedValue({ id: "1" });

    await executeWritePipeline(
      [userInterceptor, scopeInterceptor],
      execute,
      "task",
      "create",
      testDescriptor("insert"),
      testService,
    );

    expect(execute.mock.calls[0]![0].values.workspaceId).toBe("ws-legit");
  });

  it("softDelete interceptor transforms delete to update", async () => {
    const softDeleteInterceptor: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: (ctx) => {
        if (ctx.operation === "remove") {
          return ctx.rewrite({
            mutation: "update",
            values: { isDeleted: true, deletedAt: "2026-01-01" },
          });
        }
        return ctx;
      },
    };

    const execute = vi.fn().mockResolvedValue(undefined);

    await executeWritePipeline(
      [softDeleteInterceptor],
      execute,
      "task",
      "remove",
      testDescriptor("delete"),
      testService,
      { id: "1", title: "Task", status: "todo" },
    );

    const executedDesc = execute.mock.calls[0]![0];
    expect(executedDesc.mutation).toBe("update");
    expect(executedDesc.values.isDeleted).toBe(true);
  });

  it("computes changes between existing and new values", async () => {
    let capturedChanges: Record<string, unknown> | undefined;

    const observer: WriteInterceptor<TestEntity, typeof testService> = {
      onWritten: (ctx) => {
        capturedChanges = ctx.changes;
        return ctx;
      },
    };

    const existing: TestEntity = { id: "1", title: "Old", status: "todo" };

    await executeWritePipeline(
      [observer],
      async () => ({ id: "1", title: "New", status: "todo" }),
      "task",
      "update",
      testDescriptor("update", { title: "New" }),
      testService,
      existing,
    );

    expect(capturedChanges).toEqual({ title: "New" });
  });

  it("changes are empty when values match existing", async () => {
    let capturedChanges: Record<string, unknown> | undefined;

    const observer: WriteInterceptor<TestEntity, typeof testService> = {
      onWritten: (ctx) => {
        capturedChanges = ctx.changes;
        return ctx;
      },
    };

    const existing: TestEntity = { id: "1", title: "Same", status: "todo" };

    await executeWritePipeline(
      [observer],
      async () => ({ id: "1", title: "Same", status: "todo" }),
      "task",
      "update",
      testDescriptor("update", { title: "Same" }),
      testService,
      existing,
    );

    expect(capturedChanges).toEqual({});
  });

  it("changes are undefined for create (no existing)", async () => {
    let capturedChanges: Record<string, unknown> | undefined = { sentinel: true };

    const observer: WriteInterceptor<TestEntity, typeof testService> = {
      onWritten: (ctx) => {
        capturedChanges = ctx.changes;
        return ctx;
      },
    };

    await executeWritePipeline(
      [observer],
      async () => ({ id: "1", title: "New", status: "todo" }),
      "task",
      "create",
      testDescriptor("insert", { title: "New" }),
      testService,
    );

    expect(capturedChanges).toBeUndefined();
  });

  it("returns duration", async () => {
    const output = await executeWritePipeline(
      [],
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        return { id: "1", title: "Task", status: "todo" };
      },
      "task",
      "create",
      testDescriptor("insert"),
      testService,
    );

    expect(output.duration).toBeGreaterThan(0);
  });

  it("preStatements flow through to the execute function", async () => {
    const versionBump = { sql: "UPDATE projects SET version = version + 1" };

    const syncInterceptor: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: (ctx) => ctx.rewrite({ preStatements: [versionBump] }),
    };

    const execute = vi.fn().mockResolvedValue({ id: "1" });

    await executeWritePipeline(
      [syncInterceptor],
      execute,
      "task",
      "create",
      testDescriptor("insert", { title: "Task" }),
      testService,
    );

    const executedDesc = execute.mock.calls[0]![0];
    expect(executedDesc.preStatements).toEqual([versionBump]);
  });

  it("mixed onWriting and onWritten interceptors", async () => {
    const log: string[] = [];

    const interceptor: WriteInterceptor<TestEntity, typeof testService> = {
      onWriting: (ctx) => {
        log.push("writing");
        return ctx.rewrite({ values: { enriched: true } });
      },
      onWritten: (ctx) => {
        log.push("written");
        return ctx;
      },
    };

    const execute = vi.fn().mockImplementation(async () => {
      log.push("execute");
      return { id: "1", title: "Task", status: "todo" };
    });

    await executeWritePipeline([interceptor], execute, "task", "create", testDescriptor("insert"), testService);

    expect(log).toEqual(["writing", "execute", "written"]);
  });

  it("mapResult transforms the final result", async () => {
    const transformInterceptor: WriteInterceptor<TestEntity, typeof testService> = {
      onWritten: (ctx) => ctx.mapResult((r) => (r ? { ...r, title: "Transformed" } : r)),
    };

    const output = await executeWritePipeline(
      [transformInterceptor],
      async () => ({ id: "1", title: "Original", status: "todo" }),
      "task",
      "create",
      testDescriptor("insert"),
      testService,
    );

    expect(output.result?.title).toBe("Transformed");
  });
});
