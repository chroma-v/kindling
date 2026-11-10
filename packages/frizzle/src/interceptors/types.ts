// ============================================================================
// ENTITY TYPE CONSTRAINTS
// ============================================================================
// Marker interfaces for entities that support specific interceptor patterns.
// Used as generic constraints on interceptor factories.

/**
 * Entity that supports soft-delete.
 *
 * The `isDeleted` flag is required. `deletedAt` and `deletedById` are
 * optional — interceptors check column presence before writing them.
 */
export interface Trashable {
  isDeleted: boolean;
  deletedAt?: Date | null;
  deletedById?: string | null;
}

/**
 * Entity with a user-controlled display order.
 *
 * The `order` column holds an integer position. The append interceptor
 * auto-calculates `MAX(order) + 1` for new rows.
 */
export interface Orderable {
  order: number;
}
