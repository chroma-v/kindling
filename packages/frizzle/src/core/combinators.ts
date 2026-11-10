// ============================================================================
// PARSER COMBINATORS
// ============================================================================
// A small parser-combinator core, after chapter 13 of Hutton's "Programming in
// Haskell": a parser is a pure function from (input, position) to either a
// value and the next position, or a failure. A handful of primitives (`regex`,
// `pure`, `chain`, `alt`, `many`) do the work; everything else is built from
// them.
//
// Two departures from the textbook version, both borrowed from Parsec:
// - Committed choice. `alt` tries the next branch only when the failed branch
//   consumed no input, so there is no unbounded backtracking and an error
//   points at the real problem instead of at the first branch point.
// - Failures say what was expected, and the one that got furthest wins. A
//   success also carries the failures of alternatives it skipped at its end
//   position, so "age >= 18 18" can report "expected and, or, or end of input".

/** A failure: where it happened, what would have been accepted there, and an optional explicit message. */
export interface Failure {
  readonly ok: false;
  readonly pos: number;
  readonly expected: readonly string[];
  readonly message?: string;
  readonly code?: string;
}

/** A success: the value, the next position, and any failures skipped at that position. */
export interface Success<A> {
  readonly ok: true;
  readonly value: A;
  readonly pos: number;
  readonly err?: Failure;
}

export type Reply<A> = Success<A> | Failure;

export type Parser<A> = (input: string, pos: number) => Reply<A>;

type ValueOf<P> = P extends Parser<infer A> ? A : never;

// ============================================================================
// ERROR BOOKKEEPING
// ============================================================================

const failure = (pos: number, expected: readonly string[]): Failure => ({ ok: false, pos, expected });

/** Keeps the failure that got furthest; at the same position, unions what was expected. */
const merge = (a: Failure | undefined, b: Failure): Failure => {
  if (!a || b.pos > a.pos) {
    return b;
  }
  if (a.pos > b.pos) {
    return a;
  }
  return {
    ok: false,
    pos: a.pos,
    expected: [...new Set([...a.expected, ...b.expected])],
    message: a.message ?? b.message,
    code: a.message !== undefined ? a.code : b.code,
  };
};

/** Folds failures skipped earlier into a later reply, keeping only those still at the reply's position. */
const carry = <A>(reply: Reply<A>, skipped: Failure | undefined): Reply<A> => {
  if (!skipped) {
    return reply;
  }
  if (!reply.ok) {
    return merge(skipped, reply);
  }
  if (skipped.pos !== reply.pos) {
    return reply;
  }
  return { ...reply, err: merge(skipped, reply.err ?? skipped) };
};

// ============================================================================
// PRIMITIVES
// ============================================================================

/** Always succeeds with `value`, consuming nothing. Hutton's `pure`. */
export const pure =
  <A>(value: A): Parser<A> =>
  (_input, pos) => ({ ok: true, value, pos });

/** Always fails, consuming nothing, expecting `expected`. Hutton's `empty`. */
export const fail =
  (expected: string): Parser<never> =>
  (_input, pos) =>
    failure(pos, [expected]);

/** Always fails with an explicit message (and optional error code), consuming nothing. */
export const fatal =
  (message: string, code?: string): Parser<never> =>
  (_input, pos) => ({ ok: false, pos, expected: [], message, code });

/** Matches a sticky (`/y`) regular expression at the current position. */
export const regex = (pattern: RegExp, expected: string): Parser<string> => {
  if (!pattern.sticky) {
    throw new Error(`regex(${pattern}) needs the sticky (/y) flag`);
  }
  return (input, pos) => {
    pattern.lastIndex = pos;
    const match = pattern.exec(input);
    return match ? { ok: true, value: match[0], pos: pos + match[0].length } : failure(pos, [expected]);
  };
};

/** Succeeds only at the end of the input. */
export const eof: Parser<undefined> = (input, pos) =>
  pos === input.length ? { ok: true, value: undefined, pos } : failure(pos, ["end of input"]);

// ============================================================================
// SEQUENCING
// ============================================================================

/** Runs `p`, then the parser `f` builds from its value. Hutton's `>>=`. */
export const chain =
  <A, B>(p: Parser<A>, f: (value: A) => Parser<B>): Parser<B> =>
  (input, pos) => {
    const first = p(input, pos);
    if (!first.ok) {
      return first;
    }
    return carry(f(first.value)(input, first.pos), first.err);
  };

/** Transforms a parser's value. Hutton's `fmap`. */
export const map = <A, B>(p: Parser<A>, f: (value: A) => B): Parser<B> => chain(p, (value) => pure(f(value)));

/** Runs parsers in order and returns all of their values as a tuple. */
export const seq =
  <const P extends readonly Parser<unknown>[]>(...parsers: P): Parser<{ -readonly [K in keyof P]: ValueOf<P[K]> }> =>
  (input, pos) => {
    const values: unknown[] = [];
    let at = pos;
    let skipped: Failure | undefined;
    for (const p of parsers) {
      const reply = carry(p(input, at), skipped);
      if (!reply.ok) {
        return reply;
      }
      values.push(reply.value);
      at = reply.pos;
      skipped = reply.err;
    }
    return { ok: true, value: values as { -readonly [K in keyof P]: ValueOf<P[K]> }, pos: at, err: skipped };
  };

/** Runs both, keeps the left value. Haskell's `<*`. */
export const left = <A>(p: Parser<A>, q: Parser<unknown>): Parser<A> => chain(p, (a) => map(q, () => a));

/** Runs both, keeps the right value. Haskell's `*>`. */
export const right = <B>(p: Parser<unknown>, q: Parser<B>): Parser<B> => chain(p, () => q);

// ============================================================================
// CHOICE AND REPETITION
// ============================================================================

/**
 * Tries each parser in turn. Hutton's `<|>`, with committed choice: once a
 * branch has consumed input, its failure is final.
 */
export const alt =
  <A>(...parsers: Parser<A>[]): Parser<A> =>
  (input, pos) => {
    let skipped: Failure | undefined;
    for (const p of parsers) {
      const reply = p(input, pos);
      if (reply.ok) {
        return carry(reply, skipped);
      }
      if (reply.pos > pos) {
        return reply;
      }
      skipped = merge(skipped, reply);
    }
    return skipped ?? failure(pos, []);
  };

/** Zero or more `p`. Stops at the first failure that consumed nothing. */
export const many =
  <A>(p: Parser<A>): Parser<A[]> =>
  (input, pos) => {
    const values: A[] = [];
    let at = pos;
    let skipped: Failure | undefined;
    for (;;) {
      const reply = p(input, at);
      if (!reply.ok) {
        if (reply.pos > at) {
          return carry(reply, skipped);
        }
        return { ok: true, value: values, pos: at, err: merge(skipped, reply) };
      }
      if (reply.pos === at) {
        throw new Error("many() over a parser that succeeded without consuming input");
      }
      values.push(reply.value);
      at = reply.pos;
      skipped = reply.err;
    }
  };

/** `p`, or `fallback` without consuming anything. */
export const optional = <A, B>(p: Parser<A>, fallback: B): Parser<A | B> => alt<A | B>(p, pure(fallback));

/** One or more `p` separated by `separator`. */
export const sepBy1 = <A>(p: Parser<A>, separator: Parser<unknown>): Parser<A[]> =>
  chain(p, (first) => map(many(right(separator, p)), (rest) => [first, ...rest]));

/** Zero or more `p` separated by `separator`. */
export const sepBy = <A>(p: Parser<A>, separator: Parser<unknown>): Parser<A[]> => optional(sepBy1(p, separator), []);

/** One or more `p` joined by a left-associative `operator`: `a op b op c` is `(a op b) op c`. */
export const chainl1 = <A>(p: Parser<A>, operator: Parser<(l: A, r: A) => A>): Parser<A> =>
  chain(p, (first) =>
    map(many(seq(operator, p)), (rest) => rest.reduce((acc, [combine, next]) => combine(acc, next), first)),
  );

// ============================================================================
// REFINEMENT
// ============================================================================

/** Runs `p`; if `predicate` rejects the value, fails as if nothing was consumed. Hutton's `sat`, generalized. */
export const where =
  <A>(p: Parser<A>, predicate: (value: A) => boolean, expected: string): Parser<A> =>
  (input, pos) => {
    const reply = p(input, pos);
    return reply.ok && !predicate(reply.value) ? failure(pos, [expected]) : reply;
  };

/** Replaces what `p` says it expected when it fails without consuming input. */
export const label =
  <A>(p: Parser<A>, expected: string): Parser<A> =>
  (input, pos) => {
    const reply = p(input, pos);
    return !reply.ok && reply.pos === pos && reply.message === undefined ? failure(pos, [expected]) : reply;
  };

/** Defers building a parser, so grammars can refer to themselves. */
export const lazy = <A>(build: () => Parser<A>): Parser<A> => {
  let parser: Parser<A> | undefined;
  return (input, pos) => {
    parser ??= build();
    return parser(input, pos);
  };
};
