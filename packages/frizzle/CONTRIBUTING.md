# Contributing

Thanks for your interest in frizzle. Here's how to get set up.

## Setup

frizzle lives in [chroma-v/kindling](https://github.com/chroma-v/kindling), an
npm workspace, so install from the repo root — not from this package:

```bash
git clone https://github.com/chroma-v/kindling.git
cd kindling
npm install
cd packages/frizzle
```

Issues and pull requests are welcome there. kindling mirrors frizzle from the
private monorepo it's developed in, so a maintainer applies an accepted change
there, and it comes back with the next sync rather than being merged into
`packages/` directly.

The rest of the commands below run from `packages/frizzle`.

## Development

```bash
npm run dev       # Watch mode — rebuilds on change
npm run build     # One-time build
npm run typecheck # Type checking without emit
```

## Testing

```bash
npm test          # Run all tests
npm run test:watch  # Watch mode
```

Tests use [Vitest](https://vitest.dev/). The test suite includes:

- **Parser tests** — Grammar (`filter-grammar.test.ts`), AST construction, error messages and positions
- **Limit tests** — `maxDepth` / `maxParameters` / `maxConditions`, `limit` / `offset` / sort validation (`limits.test.ts`)
- **Validation tests** — Schema validation, operator compatibility, type coercion
- **Code generator tests** — RQB and SQL output for every operator/value combination
- **Exhaustive matrix tests** — Every operator tested against every value type (string, number, null, boolean, array)
- **Completeness guards** — Tests that verify every operator in the registry is handled by validation and covered in the matrix

## Architecture

```
src/
├── core/
│   ├── combinators.ts        # Parser-combinator core (Hutton / Parsec style)
│   ├── filter-grammar.ts     # The filter language as a combinator grammar
│   ├── parser.ts             # parseFilterExpression; deprecated PrattParser
│   └── lexer.ts              # Deprecated tokenizer (used only by PrattParser)
├── validation/
│   └── schema-validator.ts   # Schema & type validation
├── compiler.ts               # Orchestrates parse → validate → compile
├── parse.ts                  # parseFilter: parse + limits + optional schema validation
├── filter-limits.ts          # FilterLimits, countParameters, limit checks
├── like-pattern.ts           # likePattern / isLikeOperator: literal LIKE patterns with ESCAPE
├── code-generator.ts         # CodeGenerator interface & visitor pattern
├── query-string.ts           # URL query string parsing
├── drizzle-rqb.ts            # Drizzle RQB object syntax generator
├── drizzle-sql.ts            # Drizzle SQL builder generator
├── drizzle-validation.ts     # Operator/value validation
├── ast-types.ts              # AST node types
├── token-types.ts            # Token definitions
├── result-types.ts           # Result<T> monad
├── schema-types.ts           # Schema definition types
├── language.ts               # Operator registry (single source of truth)
└── reserved-words.ts         # Reserved keywords
```

## Adding a new operator

Changes are needed in three places. The test suite enforces all three — you can't skip one silently.

### 1. Register in `language.ts`

Add the operator to the `operators` object with its category:

```typescript
export const operators = {
  // ...existing
  not_like: { category: "string" },
} as const;
```

The `category` determines which validation rules apply.

### 2. Handle in code generators

String operators match the user's value literally, so they must build their pattern with `likePattern()` from `src/like-pattern.ts` — never by interpolating the value (`` `%${value}%` ``). Interpolating skips escaping, and a user's `%` or `_` becomes a wildcard.

- **`like-pattern.ts`** — add the operator to `isLikeOperator` and give it a case in `likePattern()`, which returns `{ pattern, escaped }`.
- **RQB** (`drizzle-rqb.ts`) — `comparisonToWhereObject()` routes every `isLikeOperator` operator to `likeToWhereObject()`, which emits `{ like: pattern }`, or a `RAW` filter with `ESCAPE '\'` when `escaped`. A negated operator needs its own branch there.
- **SQL** (`drizzle-sql.ts`) — add a `DRIZZLE_OPERATORS` entry built like `likeLiteral()`: call `likePattern(operator, value)` and append `escape '\'` when `escaped`.
- **Raw SQL** (`sql/compile-where.ts`) — add a case that escapes with `dialect.escapeLikePattern`.

Non-string operators go straight into `comparisonToWhereObject()` and `DRIZZLE_OPERATORS`.

### 3. Update tests

Add the operator to the exhaustive matrix expectations in `drizzle-rqb.test.ts`. The completeness guard tests will fail if you skip this.

If you added a **new category** (not reusing an existing one like `"string"`), the TypeScript compiler will error on the `default: never` exhaustive switch until you add a case branch in `drizzle-validation.ts`.

For full details, see [docs/drizzle-code-generator.md](docs/drizzle-code-generator.md).

## Code style

- No exceptions thrown from public APIs — always return `Result<T>`
- Exhaustive switches with `default: never` for compile-time safety
- The `operators` object in `language.ts` is the single source of truth
- Both code generators (RQB and SQL) must be kept in sync — a fix in one should be checked in the other
