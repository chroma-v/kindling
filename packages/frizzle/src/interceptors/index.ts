// ============================================================================
// REFERENCE INTERCEPTORS — Barrel Export
// ============================================================================
// Reusable interceptor implementations for common service layer patterns.
// These are reference implementations — consumers can use them directly
// or as templates for their own interceptors.

export { defaultIncludesInterceptor, extraScopeInterceptor } from "./defaults.js";
export { extraScopeWriteInterceptor } from "./extra-scope-write.js";
export type { InjectConfig } from "./inject.js";
export { injectWriteInterceptor } from "./inject.js";
// Read interceptors
// Write interceptors
export { scopeQueryInterceptor, scopeWriteInterceptor } from "./scope.js";
export type { SoftDeleteConfig } from "./soft-delete.js";
export { softDeleteQueryInterceptor, softDeleteWriteInterceptor } from "./soft-delete.js";
// Entity type constraints
export type { Orderable, Trashable } from "./types.js";
