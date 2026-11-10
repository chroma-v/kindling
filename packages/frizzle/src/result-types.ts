// ============================================================================
// RESULT TYPES - Functional error handling
// ============================================================================

/**
 * Result type for operations that can succeed or fail
 * Provides type-safe error handling without exceptions
 */
export type Result<TSuccess, TError = ParseError> =
  | { readonly success: true; readonly data: TSuccess }
  | { readonly success: false; readonly error: TError };

/**
 * Every parse error code, as a runtime list (the type is derived from it).
 */
export const parseErrorCodes = [
  "SYNTAX_ERROR",
  "UNKNOWN_FIELD",
  "INVALID_FIELD_NAME",
  "INVALID_OPERATOR",
  "TYPE_MISMATCH",
  "INVALID_VALUE",
  "MISSING_VALUE",
  "UNBALANCED_PARENTHESES",
  "LIMIT_EXCEEDED",
  "UNSORTABLE_FIELD",
] as const;

/**
 * Parse error codes for categorizing failures
 */
export type ParseErrorCode = (typeof parseErrorCodes)[number];

const parseErrorCodeSet: ReadonlySet<string> = new Set(parseErrorCodes);

/** Whether `code` is a {@link ParseErrorCode}, for narrowing a plain string without a cast. */
export const isParseErrorCode = (code: unknown): code is ParseErrorCode =>
  typeof code === "string" && parseErrorCodeSet.has(code);

/**
 * Structured parse error with context and suggestions
 */
export interface ParseError {
  readonly message: string;
  readonly position: number;
  readonly context: string;
  readonly field?: string;
  readonly suggestions?: readonly string[];
  readonly code: ParseErrorCode;
}

// ============================================================================
// RESULT CONSTRUCTORS
// ============================================================================

/**
 * Create a successful result
 */
export const createSuccess = <T>(data: T): Result<T> => ({
  success: true,
  data,
});

/**
 * Create a failed result
 */
export const createError = <T>(error: ParseError): Result<T> => ({
  success: false,
  error,
});

/**
 * Create a parse error with context
 */
export const createParseError = (
  message: string,
  position: number,
  input: string,
  code: ParseErrorCode,
  field?: string,
  suggestions?: readonly string[],
): ParseError => ({
  message,
  position,
  context: input.slice(Math.max(0, position - 10), position + 10),
  field,
  suggestions,
  code,
});

// ============================================================================
// TYPE GUARDS
// ============================================================================

/**
 * Type guard for successful results
 */
export const isSuccess = <T>(result: Result<T>): result is Extract<Result<T>, { success: true }> => result.success;

/**
 * Type guard for failed results
 */
export const isError = <T>(result: Result<T>): result is Extract<Result<T>, { success: false }> => !result.success;

/**
 * Helper to propagate errors with proper type safety
 * Errors are structurally identical regardless of data type,
 * so this cast is safe (error branch has no data field)
 */
export const propagateError = <T, E>(result: Result<unknown, E>): Result<T, E> => {
  if (result.success) {
    throw new Error("propagateError called on success - this is a bug");
  }
  return result as Result<T, E>;
};
