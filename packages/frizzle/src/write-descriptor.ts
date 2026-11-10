// ============================================================================
// WRITE DESCRIPTOR — The Mutation Expression Tree
// ============================================================================
// A plain structured object that describes a write operation. The write-side
// dual of QueryDescriptor.
//
// Serializable, inspectable, walkable. Built by the service layer, rewritten
// by interceptors, then executed against the database.
//
// See: docs/platform/semantic-query-layer.md

// ============================================================================
// TYPES
// ============================================================================

/**
 * The canonical write description. This is the mutation expression tree.
 *
 * A plain object — built by the engine, rewritten by interceptors, then
 * translated into SQL by the executor.
 *
 * Dual of QueryDescriptor (read side).
 *
 * @property mutation - The SQL operation: insert, update, or delete.
 *   Interceptors can transform this (e.g., softDelete changes delete → update).
 * @property values - Column values for INSERT/UPDATE. Interceptors enrich this
 *   (e.g., scope injects workspaceId, append sets order).
 * @property preStatements - Sibling SQL statements to batch atomically with
 *   the main mutation (e.g., version bumps). Backend-agnostic — the executor
 *   interprets them.
 * @property targetIds - Which rows to operate on for update/delete. Interceptors
 *   can expand this (e.g., softDelete cascade adds descendant IDs).
 * @property afterEffects - Side effects to run after execution completes
 *   (e.g., analytics, notifications). Executed via waitUntil.
 */
export interface WriteDescriptor {
  readonly mutation: "insert" | "update" | "delete";
  readonly values: Record<string, unknown>;
  readonly preStatements: unknown[];
  readonly targetIds: string[];
  readonly afterEffects: AfterEffect[];
}

/**
 * A deferred side effect that runs after the write commits.
 */
export type AfterEffect = () => void | Promise<void>;

// ============================================================================
// FACTORIES
// ============================================================================

/**
 * Create a WriteDescriptor with sensible defaults.
 *
 * @param mutation - The SQL operation type.
 * @param values - Initial column values (optional, defaults to empty).
 */
export function createWriteDescriptor(
  mutation: WriteDescriptor["mutation"],
  values?: Record<string, unknown>,
): WriteDescriptor {
  return Object.freeze({
    mutation,
    values: values ? { ...values } : {},
    preStatements: [],
    targetIds: [],
    afterEffects: [],
  });
}

// ============================================================================
// MERGE UTILITIES
// ============================================================================

/**
 * Merge changes into a WriteDescriptor, producing a new frozen descriptor.
 *
 * - `values` are shallow-merged (changes overlay base).
 * - `preStatements`, `targetIds`, and `afterEffects` are concatenated.
 * - `mutation` is replaced if provided.
 *
 * This is the write-side dual of `mergeDescriptors` (query side).
 */
export function mergeWriteDescriptor(base: WriteDescriptor, changes: Partial<WriteDescriptor>): WriteDescriptor {
  return Object.freeze({
    mutation: changes.mutation ?? base.mutation,
    values: changes.values ? { ...base.values, ...changes.values } : { ...base.values },
    preStatements: changes.preStatements ? [...base.preStatements, ...changes.preStatements] : [...base.preStatements],
    targetIds: changes.targetIds ? [...base.targetIds, ...changes.targetIds] : [...base.targetIds],
    afterEffects: changes.afterEffects ? [...base.afterEffects, ...changes.afterEffects] : [...base.afterEffects],
  });
}
