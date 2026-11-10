# Changelog

## Unreleased

### Added

- **`parseFilterValue`**, the inverse of `serializeFilterValue`: it reads one
  value (`"Smith, John"`, `["a","b"]`, `42`, `null`) with the filter grammar's
  own rules, so a UI that holds a serialized value can read it back without
  splitting on commas or leaving escapes in.

## 0.4.6

### Fixed

- **`orWhere` / `andWhere` threw on an object whose prototype is a `Date`.**
  The dedupe recognised Dates with `instanceof`, which such an object passes,
  then called `getTime()` on it, which throws ("this is not a Date object").
  It's now compared as plain data; real Dates still compare by time. Found by
  the property test (seed -1439156234).

## 0.4.5

### Fixed

- **`SchemaValidator` accepted an object as a string, enum or uuid value.**
  Coercion ran `String(value)`, so `{ name: { nested: true } }` validated as
  the string `"[object Object]"`. An object value other than a valid `Date` is
  now a `TYPE_MISMATCH`, and the error message shows it as JSON. A `Date` is
  converted with `toISOString()` (it was `String(date)`, which dropped the
  milliseconds).

## 0.4.4

### Fixed

- **`orWhere` / `andWhere` were quadratic in the number of values.** Removing
  repeated branches (and repeated values of one field) compared each value with
  every earlier one, so an `OR` of 20,000 different branches took about 8
  seconds, and four times as long for each doubling; grouping an `AND` by
  field was quadratic in the number of fields too. Up to eight values are
  still compared pairwise; beyond that they are bucketed by a structural hash
  first and only compared within a bucket, so the same `OR` takes about 20 ms,
  and 50,000 branches under 0.1 s. What counts as a repeat is
  unchanged: structural equality ignoring key order, Dates by time, `NaN`
  equal to itself, `0` and `-0` different, functions (such as `RAW` filters)
  by reference.
- **An Invalid Date dropped its condition from `andWhere` / `orWhere`.** The
  dedupe compared Dates with `===` on their times, and `NaN === NaN` is false,
  so a value holding `new Date(NaN)` never matched itself and no copy was kept:
  `andWhere({ createdAt: { gt: invalid } }, { status: "active" })` returned just
  `{ status: "active" }` (matching more rows than asked), and `orWhere` lost the
  branch. Combining two such filters returned `{}` from `andWhere` (every row)
  and `undefined` from `orWhere`. Such a value is now kept, once. Parsed
  filters can't hold one, since validation rejects Invalid Dates; this only
  affects filters built by hand.

## 0.4.3

### Fixed

- **The RQB generator overflowed the stack on large hand-built trees.**
  `compileFilterNode` from `@chromav/frizzle/drizzle` (and `compileFilter`)
  walked the tree recursively, so a 50,000-condition chain or 100,000 nested
  groups threw `RangeError`. It now walks it iteratively, like the SQL
  generators since 0.4.2. Output and resolver calls are unchanged: resolvers
  still run one at a time, left to right, and none after the first error.
- **Long RQB chains were slow.** A chain was combined pairwise, re-deduplicating
  the growing `OR` / `AND` list at every level; a 1,000-term chain built
  right-nested took over 10 seconds. It is now combined in one
  `orWhere(...)` / `andWhere(...)` call.

### Changed

- **Malformed hand-built trees** (a missing child, an unknown type or logical
  operator) given to the RQB `compileFilterNode` resolve to a `SYNTAX_ERROR`
  naming the problem, as the other generators do since 0.4.2. A missing child
  used to reject the promise with a `TypeError`, and an unknown type was
  `SYNTAX_ERROR` "Unknown node type".

## 0.4.2

### Fixed

- **Long chains crashed Drizzle within the default limits.** A filter string of
  roughly 820 to 1,000 `and` / `or` terms passed `maxConditions` (1,000), then
  Drizzle threw `RangeError: Maximum call stack size exceeded` rendering the
  query, because the generator nested one `and()` / `or()` per pair. A run of
  one operator now compiles to one flat `and(a, b, c, ...)` / `or(...)`.
  On SQLite / D1 a single chain still fails near 1,000 terms, now with
  SQLite's "Expression tree is too large" instead of a crash; see Limits in
  the query language docs.
- **Hand-built trees overflowed the stack.** A large tree that skipped the
  limits (a 50,000-condition chain) made `compileFilterNodeToSQL`, the raw SQL
  `compileFilterNode`, `serializeFilterNode` and
  `SchemaValidator.validateFilterNode` throw `RangeError`. They now walk the
  tree iteratively.
- **A malformed operand dropped conditions.** A hand-built logical node with a
  missing child, inside a chain of the same operator, cut the chain short:
  `f.and(brokenAnd, a eq 3)` came back as just `a eq 3`, and `validateFilter`
  accepted it. It is now kept as an operand and reported as `SYNTAX_ERROR`.
- `serializeFilterNode` wrote a hand-built OR directly under an AND (no group
  node) without parentheses, so it parsed back with a different meaning. It
  adds them now.
- An unknown node type in `SchemaValidator.validateFilterNode` was reported as
  `INVALID_SYNTAX`, which isn't a `ParseErrorCode`; it's `SYNTAX_ERROR`.
- A hand-built logical node with an operator other than `and` / `or` (e.g.
  `"AND"`) compiled to AND in the raw SQL target and to OR through Drizzle.
  It is now a malformed node (`SYNTAX_ERROR`) everywhere.

### Changed

- **Chains compile flat.** `a and b and c` compiles to one `and(a, b, c)` in the
  Drizzle generator and to `(a AND b AND c)` in the raw SQL target, instead of
  nesting pairs (`and(and(a, b), c)`, `((a AND b) AND c)`). Same meaning;
  tests comparing generated SQL text will see the new shape.
  `SchemaValidator.validateFilterNode` returns chains nested to the left, as
  the parser builds them.
- **Malformed hand-built trees are reported the same way everywhere.** A node
  with a missing child, an unknown type, an unknown logical operator, or a
  comparison without a string `field`:
  - `compileFilterNodeToSQL`, `DrizzleCodeGenerator`, the raw SQL
    `compileFilterNode` and `SchemaValidator.validateFilterNode` return a
    `SYNTAX_ERROR` naming the problem (`Malformed logical node: missing left
    or right`, ...). They used to throw a `TypeError` or `Unknown node type`,
    and a comparison without a field was `UNKNOWN_FIELD`.
  - `serializeFilterNode` throws with that message. An unknown type used to
    serialize as `""`, and a missing field as `undefined eq ...`.

  Parsed filters are never malformed; validate hand-built trees with
  `validateFilter` first.
- `SchemaValidator.validateFilterNode` rebuilds each chain as plain
  `{ type, operator, left, right }` nodes, so extra properties on a hand-built
  logical node are not carried over.

### Known issues

- A hand-built tree that contains itself (a cycle) makes the generators,
  `serializeFilterNode` and `SchemaValidator.validateFilterNode` run until they
  run out of memory, where the old recursive walk failed at once with a stack
  overflow. `validateFilter` still rejects it (`LIMIT_EXCEEDED`).

## 0.4.1

### Fixed

- **Types under `moduleResolution: node16` / `nodenext`.** The published
  declarations re-exported relative modules without a file extension
  (`from "./compiler"`), which those resolution modes reject. The error sits in a
  library file, so `skipLibCheck: true` hid it and the affected exports were
  typed as `any`. Every relative specifier now carries `.js`. No runtime
  change; `bundler` consumers were unaffected.

## 0.4.0

### Deprecated

- **`allOf` / `anyOf` are renamed `andWhere` / `orWhere`.** The 0.3.0 names
  didn't say they combine compiled where objects, which made them easy to
  confuse with the `f.and` / `f.or` builders, which combine filter trees.
  The old names remain as deprecated aliases.

### Changed

- **Error codes for sorting.** Sorting by a field mapped to a resolver (or a
  nested relation path in RQB) is `UNSORTABLE_FIELD`, a new code; it was
  `SYNTAX_ERROR` from `generateDrizzleQuery` / `DrizzleCodeGenerator` and
  `INVALID_FIELD_NAME` from `compileSort`. An unknown sort field in
  `generateDrizzleQuery` is `UNKNOWN_FIELD` (was `SYNTAX_ERROR`), and a
  hand-built sort node with a direction other than `asc` / `desc` is
  `INVALID_VALUE` instead of sorting ascending. `ParseErrorCode` gains the
  member, so exhaustive `switch` statements over it need a case.
- When a field's `operators` list rejects an operator, the message says so
  (`Operator 'like' is not allowed for field 'name'. Allowed: eq, ne`) instead
  of blaming the field's type.

### Fixed

- **LIKE values containing only a backslash.** `a\b` was compiled without
  `ESCAPE`: SQLite reads the backslash literally, but PostgreSQL treats it as
  the default LIKE escape. Any of `%`, `_` or `\` now triggers escaping and
  `ESCAPE '\'` in both Drizzle generators (a `RAW` filter in RQB).

### Added

- `validateFilter(node, schema, limits?)`: schema validation plus the filter
  limits for a tree you built or combined yourself. `SchemaValidator` alone
  doesn't check `maxParameters` / `maxConditions` / `maxDepth`, so a hand-built
  `in` list of 150 values passed it. A malformed node (a logical node with no
  `right`, a comparison with no `field`, `null`) is a `SYNTAX_ERROR`, and a tree
  that reuses subtrees too heavily to walk is `LIMIT_EXCEEDED`.
- Filter node builders, `f`: `f.eq`, `f.ne`, `f.gt` / `gte` / `lt` / `lte`,
  `f.contains`, `f.startsWith`, `f.endsWith`, `f.like`, `f.ilike`, `f.in`,
  `f.notIn`, `f.between`, `f.isNull`, `f.isNotNull`, `f.group`, and
  `f.and(...)` / `f.or(...)`, which skip `undefined` and return `undefined` when
  nothing is left. A same-operator operand is spliced into the chain, so a
  chain built in any order is flat and adds no nesting toward `maxDepth`; an
  `or` inside an `and` is wrapped in a group, so it keeps its meaning when
  serialized. Built trees round-trip through `serializeFilterNode` →
  `parseFilter` when their field names are valid in the grammar (not a keyword,
  not starting with `_` or a digit).
- **One field map for filtering and sorting.** A Drizzle SQL mapping entry can
  be `{ column, where? }` (`SQLFieldMapping`): sorting uses `column`; filtering
  uses the `where` resolver when there is one, otherwise `column`. So
  `generateDrizzleQuery` can filter a field through a resolver and still sort by
  it, from one map. RQB takes the same shape as `{ field, where? }`
  (`WhereFieldMapping`) for `compileFilter` / `compileSort`. Plain columns /
  field names and bare resolvers work as before.
- **Context for SQL resolvers.** `SQLColumnResolver` gets a third argument,
  `context`, as RQB's `WhereResolver` already did. It's optional for an untyped
  `SQLColumnResolver`, and required for `SQLColumnResolver<{ db: Db }>`: the
  compile functions then don't type-check without a `context`. Pass it with
  `compileFilterToSQL(expr, fields, { context })`,
  `compileFilterNodeToSQL(node, fields, context)` or
  `generateDrizzleQuery(ast, baseQuery, fields, context)`, so resolvers that
  need the request's `db` can be defined once. Two-argument resolvers keep
  working, and are still called with two arguments when no context is given.
- `SQLFieldMapping.caseInsensitive`: `eq` / `ne` compile to
  `lower(col) = lower(?)` and the LIKE operators to `lower(col) like lower(?)`
  (still escaped), for string values; other values compare as-is. SQLite's
  `lower()` folds ASCII only.
- **Sort validated against the schema.** `SchemaField.sortable` (default
  `true`), and `parseSort(expr, schema)` / `parseQueryString(input, { schema })`,
  which reject unknown fields (`UNKNOWN_FIELD`, with suggestions) and
  `sortable: false` fields (`UNSORTABLE_FIELD`) as well as bad directions.
  `Compiler.parse` checks `sortable` too.
- `SchemaField.maxValues`: the most values an `in` / `not_in` list on that field
  may hold (`LIMIT_EXCEEDED` beyond it). `SchemaField.max` limits the value, not
  the list length.

## 0.3.0

### Breaking

- **`mergeFilters` ANDs instead of letting the later key win.** Merging two
  filters now keeps both sides' conditions: the same key with different values
  becomes `{ AND: [...] }` (it used to keep only the later value), and two `OR`
  arrays are ANDed (they used to be concatenated into one `OR`, which widened
  the result: `(a or b)` merged with `(c or d)` became `a or b or c or d`).
  This applies everywhere `mergeFilters` is used: `Query` / `QueryBuilder`
  `.filter()` chaining, `mergeDescriptors`, `ctx.rewrite` in interceptors, and
  the scope / soft-delete / extra-scope interceptors. Chained `.filter()` calls
  now narrow a query instead of replacing a condition, and a user filter can no
  longer swap out a scope condition such as `workspaceId` (both apply).
  Merging is idempotent (conditions already present aren't repeated), so the
  interceptor idiom `ctx.rewrite({ filter: { ...ctx.descriptor.filter, x } })`
  keeps working without duplicating conditions.

### Added

- **`allOf(...filters)` / `anyOf(first, ...rest)`**, the filter combinators
  behind `mergeFilters`: AND and OR over `Filter` objects, composable
  (`allOf(scope, anyOf(mine, shared), userFilter)`). `{}` is the identity of
  `allOf` and absorbs `anyOf`; both are idempotent. `mergeFilters(a, b)` is
  `allOf(a, b)`.

### Changed

- RQB `compileFilter` builds `and` / `or` with `allOf` / `anyOf`, so an `or`
  chain compiles to one flat `{ OR: [a, b, c] }` (was nested
  `{ OR: [{ OR: [a, b] }, c] }`), matching how `and` chains already flatten.

### Fixed

- **Numbered placeholders.** The raw SQL generator (`frizzle/sql`) restarted
  parameter numbering in every `OR` branch (`compileFilter`) and in every
  comparison (`compileFilterNode`), so a `$1, $2, ...` dialect produced
  `"a" = $1 AND "b" > $1`. Placeholders are now numbered in order across the
  whole clause. SQLite's `?` placeholders were unaffected.
- The raw SQL `compileFilter` understands `AND` arrays (which `mergeFilters`
  and RQB output now produce) instead of treating `AND` as a column name.

## 0.2.0

### Breaking

- **Default limits.** A filter nested more than 32 levels, with more than 100
  values, or with more than 1000 conditions is now rejected with
  `LIMIT_EXCEEDED`. Raise `maxDepth` / `maxParameters` / `maxConditions` if you
  need more.
- **`LIKE` operators match literally.** `%` and `_` in values of `like`,
  `ilike`, `contains`, `starts_with` and `ends_with` are ordinary characters
  in both Drizzle generators (the raw SQL generator already escaped them).
  Filters that relied on typing wildcards into `like` / `ilike` no longer
  match; there is no pattern operator.
- **No URL decoding.** The parser takes an already-decoded expression;
  `parseQueryString` / `URLSearchParams` already decode, and decoding twice
  turned a literal `%25` into `%`. Callers passing still-encoded strings
  directly to `parseFilter` / `Lexer` must decode first.
- **Stricter input.** Unterminated strings (`name eq 'abc`) and arrays
  (`tags in [1,2`), malformed numbers (`1.2.3`, `18abc`), numbers too large to
  be finite, and invalid array literals (`[1,,2]`) are errors instead of being
  accepted. `parseQueryString` rejects `limit` / `offset` that aren't plain
  integers (`10abc`, `2.9`) instead of truncating them, and an invalid sort
  direction (`name:sideways`, `:asc`, `name:asc:desc`) instead of using `asc`.
  RQB `compileSort` rejects invalid directions too, and `Compiler.parse`
  applies the same `limit` / `offset` rules.
- **RQB output shape.** `compileFilter` can return `{ AND: [...] }` (see Fixed)
  and, for LIKE values containing `%` / `_`, a `RAW` key whose value is a
  function, so the result isn't always plain JSON.
- **`ParseErrorCode`** has a new member, `LIMIT_EXCEEDED`; exhaustive `switch`
  statements over it need a case.
- **Error messages** say what was expected, e.g. `Expected operator, got '18'`
  or `Expected and, or or end of input, got '18'` (was
  `Unexpected token '18' after expression`). Match on `code`, not `message`.

### Fixed

- **RQB `AND` on the same field compiled to `OR`.** `age gte 18 AND age lte 65`
  matched every row; so did any AND of two OR groups, which were flattened into
  one OR. `compileFilter` now emits `{ AND: [...] }` whenever the two sides share
  a key, as one flat list for a chain (`{ AND: [a, b, c] }`).
- **LIKE wildcards in values** matched everything: `name contains '%'` returned
  every row. Values containing `%` or `_` are now escaped and compiled with
  `ESCAPE '\'` (via a `RAW` filter in RQB, placed inside any relation objects).
- **Field names inherited from `Object.prototype`.** A filter on
  `isPrototypeOf`, `constructor`, `toString` etc. found the built-in method in
  the column map or schema: RQB compiled `isPrototypeOf = 1` to `false`, which
  matched every row, and schema validation threw. They are now unknown fields
  like any other (`UNKNOWN_FIELD`), in all three generators, sorting and
  validation.
- **Docs: combining a compiled filter with server-side conditions.** The
  recipes used `{ ...where, ...result.data }`, which lets a user filter replace
  any top-level key of yours — e.g. a user `OR` overwrote a visibility rule like
  `{ OR: [{ owner: me }, { shared: true }] }` and exposed other users' private
  rows. They now use `{ AND: [where, result.data] }`. If you copied the old
  recipe, change it.
- Deeply nested filters return a `LIMIT_EXCEEDED` error instead of throwing
  `RangeError: Maximum call stack size exceeded`. So do very long `and` / `or`
  chains (e.g. 20,000 `is_null` checks), which built a tree deep enough to
  overflow every recursive walker; see `maxConditions`.
- Parsing is linear in the input length. The old lexer's look-ahead copied
  the rest of the input at every identifier, so a 280 KB filter took ~30 s.
- A limit set to `NaN` or `Infinity` disabled it (and deep nesting then
  overflowed the stack). Limits must now be non-negative integers
  (`undefined` / `null` mean the default); anything else is `INVALID_VALUE`.
  The same goes for `maxLimit` / `defaultLimit`, which must be positive.
- `Compiler.parse` hard-coded a 1–1000 `limit` range (ignoring a larger
  `maxLimit` passed to `parseQueryString`) and accepted `NaN` / fractional
  `limit` and `offset`.
- `serializeFilterNode` output didn't always read back: array strings with
  control characters (`"a\nb"`) and numbers `String()` writes with an exponent
  (`1e-7`, `1e+21`). Array strings are now written as JSON, and number
  literals accept exponents.
- RQB: an `OR` with a side that adds no condition (a resolver returning `{}`)
  now matches everything, as `{}` does in an `AND`; Drizzle used to drop the
  empty branch and match only the other side.

### Deprecated

- `Lexer`, `PrattParser`, `tokenizeFilterExpression` and `Compiler`'s
  `tokenizer` option. A `Compiler` given a `tokenizer` keeps the old path;
  `parseTokens(tokens, input, limits)` runs it with the same checks as
  `parseFilterExpression`.
- `parseSortExpression()`, which treats anything but `desc` as `asc`. Use
  `parseSort()`.

### Added

- Filter limits, as options on `parseFilter`, `parseFilterExpression`,
  `compileFilter`, `compileFilterToSQL` and `Compiler` (type `FilterLimits`,
  defaults in `query.limits`): `maxDepth` (32), `maxParameters` (100,
  Cloudflare D1's per-query cap; lower it if your query binds its own
  parameters too) and `maxConditions` (1000). `countParameters()` is exported.
- `parseQueryString(input, { maxLimit, defaultLimit })` (type
  `QueryStringOptions`); `defaultLimit` applies only when `limit` is absent and
  is capped at `maxLimit`. `Compiler` takes a matching `maxLimit`.
- `parseSort()`, returning a `Result` with positioned errors.
- `parseTokens()` (deprecated on arrival; see above).
- Number literals accept exponents: `1e5`, `1.5E-3`.

### Changed

- **`serializeFilterNode` writes `and` / `or` in lowercase** (was `AND` /
  `OR`), matching the AST and the docs' style. Parsing is unchanged: keywords
  are case-insensitive, so filter strings saved with `AND` still work, but
  code comparing serialized strings will see the new casing.
- **New parser.** `parseFilterExpression` (and so `parseFilter`,
  `compileFilter`, `compileFilterToSQL` and `Compiler`) now parses with a
  parser-combinator grammar instead of `Lexer` + `PrattParser`. It produces
  the same ASTs (checked by a differential fuzz test) except that
  single-quoted array elements unescape like scalar strings: `['it\'s']` is
  `it's` (was `it"s`).
- RQB `compileFilter` requires drizzle-orm 1.0 (beta/rc); its filter syntax
  doesn't exist in 0.x (this was already true of `OR` in 0.1.x). The peer range
  still admits 0.x for `compileFilterToSQL` and `frizzle/sql`.

## 0.1.2

- No code changes: a version bump to exercise the npm OIDC publishing
  pipeline.

## 0.1.1

- Published tarballs no longer contain `*.test.d.ts` files.

## 0.1.0

Initial release.

- Pratt parser for filter expressions with operator precedence
- 18 operators across 5 categories: comparison, string, array, range, null-check
- Schema validation with field types, operator compatibility, enum membership, and range constraints
- Two Drizzle ORM code generators:
  - **RQB** (`compileFilter`) — async, supports resolvers and nested relation paths
  - **SQL** (`compileFilterToSQL`) — sync, produces Drizzle SQL objects
- Sort expression compilation (`compileSort`)
- URL query string parsing (`parseQueryString`)
- `Result<T>` return type on all operations — no exceptions thrown
- Pluggable `CodeGenerator` interface for custom backends
- AST visitor pattern (`walkFilterNode`) for custom tree traversal
- Operator/value validation catches broken SQL before it runs
