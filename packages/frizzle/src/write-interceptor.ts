// ============================================================================
// WRITE INTERCEPTORS — Pipeline Hooks for Mutations
// ============================================================================
// Interceptors observe and rewrite mutations before/after execution.
// Configured at factory time, invisible to callers.
//
// This is the write-side dual of query-interceptor.ts. Same pipeline pattern:
// onWriting → execute → onWritten.
//
// See: docs/platform/semantic-query-layer.md

import type { WriteDescriptor } from "./write-descriptor.js";
import { mergeWriteDescriptor } from "./write-descriptor.js";

// ============================================================================
// SERVICE CONTEXT
// ============================================================================

/**
 * Minimal context about the service producing the mutation.
 *
 * Same pattern as QueryServiceContext — intentionally `object` so concrete
 * types like Cobalt's ServiceContext satisfy the constraint without casting.
 */
export type WriteServiceContext = object;

// ============================================================================
// INTERCEPTOR TYPES
// ============================================================================

/**
 * A write interceptor — hooks into the mutation execution pipeline.
 *
 * - `onWriting`: Rewrite the descriptor before it hits the database.
 *   Runs in order. Scoping interceptors run last (unforgeable).
 * - `onWritten`: Observe or transform results after execution.
 *   Runs in order.
 *
 * Interceptors return a new context (immutable). Each interceptor
 * sees the output of the previous one.
 *
 * Dual of QueryInterceptor (read side).
 */
export interface WriteInterceptor<T = unknown, TContext extends WriteServiceContext = WriteServiceContext> {
  /** Rewrite the mutation before it hits the database. */
  onWriting?: (ctx: WritingContext<T, TContext>) => WritingContext<T, TContext> | Promise<WritingContext<T, TContext>>;

  /** Observe or transform results after execution. */
  onWritten?: (ctx: WrittenContext<T, TContext>) => WrittenContext<T, TContext> | Promise<WrittenContext<T, TContext>>;
}

// ============================================================================
// WRITING CONTEXT (before execution)
// ============================================================================

/**
 * Context available during the `onWriting` phase.
 *
 * The descriptor can be rewritten via `rewrite()`. Each call returns
 * a new context — the original is never mutated.
 *
 * Dual of QueryExecutingContext (read side).
 */
export interface WritingContext<T = unknown, TContext extends WriteServiceContext = WriteServiceContext> {
  /** Entity name (e.g., "task", "project"). */
  readonly entity: string;
  /** Semantic operation (higher-level than descriptor.mutation). */
  readonly operation: "create" | "update" | "remove" | "restore";
  /** The current mutation descriptor. */
  readonly descriptor: WriteDescriptor;
  /** Ambient service context (db, session, scope). */
  readonly service: TContext;
  /** The existing row, available for update/remove/restore. */
  readonly existing?: T;

  /** Return a new context with a rewritten descriptor. */
  rewrite(changes: Partial<WriteDescriptor>): WritingContext<T, TContext>;
}

// ============================================================================
// WRITTEN CONTEXT (after execution)
// ============================================================================

/**
 * Context available during the `onWritten` phase.
 *
 * Results are available. Interceptors can observe them or queue
 * after-effects.
 *
 * Dual of QueryExecutedContext (read side).
 */
export interface WrittenContext<T = unknown, TContext extends WriteServiceContext = WriteServiceContext> {
  /** Entity name. */
  readonly entity: string;
  /** Semantic operation. */
  readonly operation: "create" | "update" | "remove" | "restore";
  /** The final mutation descriptor (as executed). */
  readonly descriptor: WriteDescriptor;
  /** Ambient service context. */
  readonly service: TContext;
  /** The result of the mutation (created/updated row, or undefined for delete). */
  readonly result: T | undefined;
  /** The existing row before mutation (available for update/remove/restore). */
  readonly existing?: T;
  /** Changed fields — delta between existing and new values (update only). */
  readonly changes?: Record<string, unknown>;
  /** Time taken for the database operation (ms). */
  readonly duration: number;

  /** Return a new context with a transformed result. */
  mapResult(fn: (result: T | undefined) => T | undefined): WrittenContext<T, TContext>;
}

// ============================================================================
// CONTEXT FACTORIES
// ============================================================================

/**
 * Create a WritingContext.
 */
export function createWritingContext<T, TContext extends WriteServiceContext>(
  entity: string,
  operation: "create" | "update" | "remove" | "restore",
  descriptor: WriteDescriptor,
  service: TContext,
  existing?: T,
): WritingContext<T, TContext> {
  return Object.freeze({
    entity,
    operation,
    descriptor,
    service,
    existing,
    rewrite(changes: Partial<WriteDescriptor>): WritingContext<T, TContext> {
      return createWritingContext(
        entity,
        // Allow operation changes via descriptor.mutation mapping
        changes.mutation ? mutationToOperation(changes.mutation) : operation,
        mergeWriteDescriptor(descriptor, changes),
        service,
        existing,
      );
    },
  });
}

/**
 * Create a WrittenContext.
 */
export function createWrittenContext<T, TContext extends WriteServiceContext>(
  entity: string,
  operation: "create" | "update" | "remove" | "restore",
  descriptor: WriteDescriptor,
  service: TContext,
  result: T | undefined,
  existing: T | undefined,
  changes: Record<string, unknown> | undefined,
  duration: number,
): WrittenContext<T, TContext> {
  return Object.freeze({
    entity,
    operation,
    descriptor,
    service,
    result,
    existing,
    changes,
    duration,
    mapResult(fn: (result: T | undefined) => T | undefined): WrittenContext<T, TContext> {
      return createWrittenContext(entity, operation, descriptor, service, fn(result), existing, changes, duration);
    },
  });
}

// ============================================================================
// PIPELINE EXECUTION
// ============================================================================

/**
 * Run the write interceptor pipeline: onWriting → execute → onWritten.
 *
 * This is the write-side dual of `executePipeline` (query side).
 *
 * @param interceptors - Ordered interceptor list. Scoping should be last.
 * @param execute - The database execution function. Receives the final
 *   descriptor and returns the result row (or undefined for deletes).
 * @param entity - Entity name for context.
 * @param operation - Semantic operation (create/update/remove/restore).
 * @param descriptor - The initial write descriptor.
 * @param service - The ambient service context.
 * @param existing - The existing row (for update/remove/restore).
 * @returns The execution result with final descriptor, result, and duration.
 */
export async function executeWritePipeline<T, TContext extends WriteServiceContext>(
  interceptors: WriteInterceptor<T, TContext>[],
  execute: (descriptor: WriteDescriptor) => Promise<T | undefined>,
  entity: string,
  operation: "create" | "update" | "remove" | "restore",
  descriptor: WriteDescriptor,
  service: TContext,
  existing?: T,
): Promise<WriteResult<T>> {
  // Phase 1: onWriting
  let writingCtx = createWritingContext<T, TContext>(entity, operation, descriptor, service, existing);
  for (const interceptor of interceptors) {
    if (interceptor.onWriting) {
      writingCtx = await interceptor.onWriting(writingCtx);
    }
  }

  // Phase 2: execute
  const start = performance.now();
  const result = await execute(writingCtx.descriptor);
  const duration = performance.now() - start;

  // Phase 3: onWritten
  const changes = existing ? computeChanges(existing, writingCtx.descriptor.values) : undefined;

  let writtenCtx = createWrittenContext<T, TContext>(
    entity,
    writingCtx.operation,
    writingCtx.descriptor,
    service,
    result,
    existing,
    changes,
    duration,
  );

  for (const interceptor of interceptors) {
    if (interceptor.onWritten) {
      writtenCtx = await interceptor.onWritten(writtenCtx);
    }
  }

  return {
    result: writtenCtx.result,
    descriptor: writingCtx.descriptor,
    duration,
  };
}

// ============================================================================
// RESULT TYPE
// ============================================================================

/**
 * The result of executing a write pipeline.
 */
export interface WriteResult<T> {
  /** The result row (created/updated entity, or undefined for deletes). */
  readonly result: T | undefined;
  /** The final descriptor as it was executed. */
  readonly descriptor: WriteDescriptor;
  /** Time taken for the database operation (ms). */
  readonly duration: number;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Map a low-level mutation type to a semantic operation.
 *
 * Used when an interceptor changes the mutation type (e.g., softDelete
 * transforms delete → update) — the semantic operation stays "remove"
 * unless explicitly overridden.
 */
function mutationToOperation(mutation: "insert" | "update" | "delete"): "create" | "update" | "remove" | "restore" {
  switch (mutation) {
    case "insert":
      return "create";
    case "update":
      return "update";
    case "delete":
      return "remove";
  }
}

/**
 * Compute the delta between an existing entity and the new values.
 *
 * Returns only the fields that actually changed.
 */
function computeChanges<T>(existing: T, values: Record<string, unknown>): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  const prev = existing as Record<string, unknown>;

  for (const [key, value] of Object.entries(values)) {
    if (prev[key] !== value) {
      changes[key] = value;
    }
  }

  return changes;
}
