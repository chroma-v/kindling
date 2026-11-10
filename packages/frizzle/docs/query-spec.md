# Query String Expression Language Specification

**Version:** 1.0  
**Date:** May 2025

## 1. Overview

This specification defines a query string expression language for filtering, sorting, and paginating database results. The language is designed to be URL-safe and human-readable while supporting complex logical expressions.

## 2. Grammar Definition

### 2.1 Query Structure (EBNF)

```ebnf
(* Top-level query structure *)
query           = param, { "&", param } ;
param           = filter_param | sort_param | limit_param | offset_param ;
filter_param    = "filter=", filter_expr ;
sort_param      = "sort=", sort_list ;
limit_param     = "limit=", positive_integer ;
offset_param    = "offset=", non_negative_integer ;

(* Filter expressions *)
filter_expr     = logical_expr ;
logical_expr    = comparison_expr, { logical_op, comparison_expr } ;
comparison_expr = field, comparison_op, value 
                | "(", logical_expr, ")" ;
logical_op      = "and" | "or" ;
comparison_op   = "=" | "!=" | ">" | ">=" | "<" | "<=" | "like" | "in" ;

(* Field and value definitions *)
field           = identifier, { ".", identifier } ;
identifier      = letter, { letter | digit | "_" } ;
value           = string | number | boolean | null | array ;

(* Sort expressions *)
sort_list       = sort_item, { ",", sort_item } ;
sort_item       = field, [ ":", sort_direction ] ;
sort_direction  = "asc" | "desc" ;

(* Literals *)
string          = "'", { string_char }, "'" 
                | '"', { string_char }, '"' ;
string_char     = ? any character except quote and backslash ?
                | escape_sequence ;
escape_sequence = "\", ( "'" | '"' | "\" | "n" | "t" | "r" ) ;

number          = [ "-" ], digit, { digit }, [ ".", digit, { digit } ], [ exponent ] ;
exponent        = ( "e" | "E" ), [ "+" | "-" ], digit, { digit } ;
positive_integer = digit - "0", { digit } ;
non_negative_integer = digit, { digit } ;

boolean         = "true" | "false" ;
null            = "null" ;
array           = "[", [ value, { ",", value } ], "]" ;

(* Character classes *)
letter          = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" 
                | "K" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" 
                | "U" | "V" | "W" | "X" | "Y" | "Z" | "a" | "b" | "c" | "d" 
                | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" 
                | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" 
                | "y" | "z" ;
digit           = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;

(* Whitespace *)
whitespace      = " " | "\t" | "\n" | "\r" ;
```

### 2.2 Operator Precedence

1. **Parentheses** `()` - Highest precedence
2. **Comparison Operators** `=`, `!=`, `>`, `>=`, `<`, `<=`, `like`, `in`
3. **AND** - Logical conjunction
4. **OR** - Logical disjunction (Lowest precedence)

## 3. Lexical Rules

These describe the shape of each terminal. The parser recognizes them in place, as part of the grammar, rather than in a separate tokenizing pass.

### 3.1 Tokens

| Token Type | Pattern | Description |
|------------|---------|-------------|
| `FIELD` | `[a-zA-Z][a-zA-Z0-9_.]*` | Field identifier |
| `STRING` | `'[^']*'` or `"[^"]*"` | String literal |
| `NUMBER` | `-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?` | Number literal (integer, decimal, or exponent) |
| `BOOLEAN` | `true` or `false` | Boolean literal |
| `NULL` | `null` | Null literal |
| `AND` | `AND` (case-insensitive) | Logical and |
| `OR` | `OR` (case-insensitive) | Logical or |
| `LPAREN` | `(` | Left parenthesis |
| `RPAREN` | `)` | Right parenthesis |
| `EQUALS` | `=` | Equality operator |
| `NOT_EQUALS` | `!=` | Inequality operator |
| `GREATER` | `>` | Greater than |
| `GREATER_EQUAL` | `>=` | Greater than or equal |
| `LESS` | `<` | Less than |
| `LESS_EQUAL` | `<=` | Less than or equal |
| `LIKE` | `like` (case-insensitive) | Pattern matching |
| `IN` | `in` (case-insensitive) | Array membership |

### 3.2 String Escaping

Strings support the following escape sequences:
- `\'` - Single quote
- `\"` - Double quote
- `\\` - Backslash
- `\n` - Newline
- `\t` - Tab
- `\r` - Carriage return

### 3.3 Whitespace

Whitespace (spaces, tabs, newlines) is ignored except within string literals.

## 4. Data Types

### 4.1 Supported Types

| Type | Examples | Description |
|------|----------|-------------|
| **String** | `'hello'`, `"world"` | UTF-8 encoded text |
| **Integer** | `42`, `-17`, `0` | 64-bit signed integers |
| **Decimal** | `3.14`, `-0.5` | IEEE 754 double precision |
| **Boolean** | `true`, `false` | Boolean values |
| **Null** | `null` | Null/undefined value |
| **Array** | `[1,2,3]`, `['a','b']` | Homogeneous arrays |

### 4.2 Type Coercion

- Unquoted numeric strings are coerced to numbers
- Case-insensitive `true`/`false` are coerced to booleans
- Case-insensitive `null` is coerced to null

## 5. Operators

### 5.1 Comparison Operators

| Operator | Description | Example | Valid Types |
|----------|-------------|---------|-------------|
| `=` | Equals | `age = 25` | All types |
| `!=` | Not equals | `status != 'inactive'` | All types |
| `>` | Greater than | `price > 100` | Numbers, strings |
| `>=` | Greater than or equal | `score >= 80` | Numbers, strings |
| `<` | Less than | `date < '2024-01-01'` | Numbers, strings |
| `<=` | Less than or equal | `count <= 50` | Numbers, strings |
| `like` | Pattern match | `name like 'John'` | Strings only |
| `in` | Array membership | `id in [1,2,3]` | All types |

### 5.2 Logical Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `and` | Logical conjunction | `age > 18 and status = 'active'` |
| `or` | Logical disjunction | `role = 'admin' or role = 'moderator'` |

### 5.3 Operator Semantics

- **like**: Substring matching (SQL `LIKE '%value%'`). The value matches literally: `%`, `_` and `\` in it are escaped and compiled with `ESCAPE '\'`, so they are not wildcards. On SQLite, `LIKE` is case-insensitive for ASCII letters only.
- **in**: Tests if left operand exists in right operand array
- String comparisons are lexicographic and case-sensitive
- Cross-type comparisons are invalid except for numeric types

## 6. Query Parameters

### 6.1 Filter Parameter

- **Key:** `filter`
- **Value:** Filter expression conforming to grammar
- **Required:** No
- **Example:** `filter=age > 18 and (status = 'active' or role = 'admin')`

### 6.2 Sort Parameter

- **Key:** `sort`
- **Value:** Comma-separated list of field[:direction] pairs
- **Direction:** `asc` (default) or `desc`
- **Required:** No
- **Example:** `sort=name:asc,created_at:desc,priority`

### 6.3 Limit Parameter

- **Key:** `limit`
- **Value:** Positive integer (1-1000)
- **Required:** No
- **Example:** `limit=25`

### 6.4 Offset Parameter

- **Key:** `offset`
- **Value:** Non-negative integer
- **Required:** No
- **Example:** `offset=100`

## 7. Validation Rules

### 7.1 Syntax Validation

1. **Balanced Parentheses**: All opening parentheses must have matching closing parentheses
2. **Operator Placement**: Comparison operators must be between field and value
3. **Logical Operators**: AND/OR must be between valid expressions
4. **Field Names**: Must start with letter, contain only letters, digits, underscore, and dots
5. **String Literals**: Must be properly quoted and escaped

### 7.2 Semantic Validation

1. **Field Existence**: All referenced fields must exist in the target schema
2. **Type Compatibility**: Operators must be compatible with field types
3. **Value Validation**: Values must be valid for their target field types
4. **Array Homogeneity**: Arrays in `in` operator must contain compatible types

### 7.3 Limits and Constraints

| Parameter | Minimum | Maximum | Default |
|-----------|---------|---------|---------|
| `limit` | 1 | `maxLimit` (default 1000) | None (`defaultLimit` option) |
| `offset` | 0 | No limit | None |
| Parenthesis nesting (`maxDepth`) | - | 32 levels | - |
| Values across the whole filter (`maxParameters`) | - | 100 | - |
| Comparisons (`maxConditions`) | - | 1000 | - |

`limit` and `offset` must be plain decimal integers (`10abc`, `2.9`, `1e2`, `+5` are rejected). `maxParameters` counts 1 per comparison, 1 per `in` / `not_in` element, 2 for `between`, and 0 for `is_null` / `is_not_null`; there is no separate per-array cap. All three filter limits can be overridden per call; see [Limits](query-language.md#limits).

## 8. Examples

### 8.1 Simple Queries

```
# Basic filtering
filter=status = 'active'

# Numeric comparison
filter=age >= 18

# Multiple conditions
filter=age >= 18 and status = 'active'

# Basic sorting
sort=name:asc

# Pagination
limit=20&offset=40
```

### 8.2 Complex Queries

```
# Complex logical expressions
filter=(age >= 18 and status = 'active') or role = 'admin'

# Pattern matching
filter=name like 'John' and email like 'gmail'

# Array membership
filter=id in [1,2,3,4,5]

# Multiple sorts with limit
filter=active = true&sort=priority:desc,name:asc&limit=50

# Nested field access
filter=user.profile.age > 25
```

### 8.3 Complete Query Examples

```
# User search with pagination
filter=name like 'smith' and age >= 21&sort=last_login:desc&limit=25&offset=0

# Product filtering with multiple criteria
filter=(category = 'electronics' or category = 'books') and price <= 100&sort=price:asc,rating:desc

# Complex user permissions query
filter=(role = 'admin' or (role = 'user' and active = true)) and created_at >= '2024-01-01'&sort=created_at:desc&limit=100
```

### 8.4 Project Management & SaaS Examples

```
# Task Management
filter=priority eq "high" and targetEndDate lt "2025-01-31"&sort=targetEndDate:asc

# Project filtering
filter=status eq "active" and clientPartyId eq "01CLIENT123"&sort=totalBudget:desc

# User management
filter=email ends_with "@company.com" and active eq true&sort=name:asc

# Overdue tasks
filter=targetEndDate lt "2025-01-15" and status ne "completed"&sort=priority:desc

# Team workload
filter=assignedToUserId in ["01USER123","01USER456"]&sort=priority:desc,targetEndDate:asc
```

> **📋 For comprehensive PM/SaaS examples**: See [url-examples.md](./url-examples.md) for 50+ realistic URL query patterns covering tasks, projects, users, dashboard views, and common filtering scenarios.

## 9. Error Handling

### 9.1 Syntax Errors

Syntax errors have code `SYNTAX_ERROR` and say what was expected at the error's `position`:

- **Missing Operator**: `Expected operator, got '18'` (for `age 18`)
- **Trailing Input**: `Expected and, or or end of input, got '18'` (for `age gte 18 18`)
- **Missing Field**: `Expected field or '(', got '>='` (for `>= 18`)
- **Missing Value**: `Expected value, got end of input` (for `age eq`)
- **Unbalanced Parentheses**: `Unbalanced parentheses: missing closing parenthesis`
- **Invalid String**: `Unterminated string literal`
- **Invalid Array**: `Unterminated array literal`
- **Invalid Number**: `Invalid number` (for `1.2.3`, `18abc`, or a number too large to be finite)

### 9.2 Semantic Errors

- **Unknown Field** (`UNKNOWN_FIELD`): `Unknown field 'xyz'`, with close field names in `suggestions`
- **Invalid Operator** (`INVALID_OPERATOR`): `Operator 'like' not supported for field 'age' of type 'number'`
- **Type Mismatch** (`TYPE_MISMATCH`): `Invalid value 'abc' for field 'age' of type 'number'`
- **Invalid Value** (`INVALID_VALUE`): `Value 150 is above maximum 120 for field 'age'`

### 9.3 Validation Errors

- **Invalid Limit** (`INVALID_VALUE`): `Invalid limit: 2000. Must be between 1 and 1000`
- **Invalid Sort** (`INVALID_VALUE`): `Invalid sort direction 'sideways' for 'name'. Use asc or desc`
- **Expression Too Deep** (`LIMIT_EXCEEDED`): `Filter is nested more than 32 levels deep`
- **Too Many Values** (`LIMIT_EXCEEDED`): `Filter has 150 values; the limit is 100`
- **Too Many Conditions** (`LIMIT_EXCEEDED`): `Filter has 1001 conditions; the limit is 1000`

## 10. URL Encoding

All query parameter values must be properly URL-encoded:

```
# Spaces become %20
filter=name%20=%20'John%20Doe'

# Special characters are encoded
filter=email%20like%20'%40gmail.com'
```

Decoding is the query-string layer's job: `parseQueryString` (via `URLSearchParams`) decodes the `filter` value. The filter parser itself does not URL-decode, so pass it the decoded string.

## 11. Implementation Notes

### 11.1 Parser Requirements

1. **Syntax Analysis**: Parse the input directly into an Abstract Syntax Tree (AST) with a parser-combinator grammar (there is no separate tokenizing pass), enforcing `maxDepth` / `maxParameters` / `maxConditions`
2. **Semantic Analysis**: Validate field references and type compatibility
3. **Code Generation**: Convert AST to target query language (SQL, etc.)

### 11.2 Performance Considerations

- Limit expression complexity to prevent ReDoS attacks
- Cache parsed queries for repeated use
- Validate field references against schema early
- Use efficient data structures for large IN arrays

### 11.3 Security Considerations

- Always validate field names against allowed schema
- Sanitize string values to prevent injection attacks
- Implement query complexity limits
- Log and monitor for suspicious query patterns

## 12. Compliance Testing

### 12.1 Valid Expression Tests

```javascript
const validExpressions = [
  "age = 25",
  "name = 'John Doe'",
  "active = true",
  "score >= 80 and grade = 'A'",
  "(x = 1 or y = 2) and z = 3",
  "tags in ['red', 'blue', 'green']",
  "created_at > '2024-01-01'",
  "price <= 99.99",
  "description like 'test'"
];
```

### 12.2 Invalid Expression Tests

```javascript
const invalidExpressions = [
  "age =",              // Missing value
  "= 25",               // Missing field
  "age 25",             // Missing operator
  "(age = 25",          // Unbalanced parentheses
  "age = 25 and",       // Incomplete logical expression
  "age like 25",        // Type mismatch
  "'unterminated",      // Unterminated string
  "age = [1,2,]",       // Trailing comma in array
];
```

### 12.3 Query Parameter Tests

```javascript
const validQueries = [
  "filter=age > 18",
  "sort=name:asc,age:desc",
  "limit=50&offset=100",
  "filter=active = true&sort=created_at:desc&limit=25"
];

const invalidQueries = [
  "filter=",            // Empty filter
  "limit=-1",           // Negative limit
  "sort=:desc",         // Empty field name
  "limit=abc",          // Non-numeric limit
];
```

This specification provides a complete definition of the query language that can be used for validation, testing, and implementation reference.