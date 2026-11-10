# Recipes

Real-world examples showing how to integrate frizzle into different frameworks. Each recipe follows the same pattern: extract filter/sort from the request, compile to a Drizzle query, handle errors gracefully.

## Shared setup

All recipes use these shared definitions:

```typescript
import type { Schema } from "@chromav/frizzle";

// Schema defines what's filterable and validates input
const schema: Schema = {
  title: { type: "string" },
  status: { type: "enum", enumValues: ["active", "pending", "done"] },
  priority: { type: "enum", enumValues: ["low", "medium", "high"] },
  assignedTo: { type: "uuid", nullable: true },
  createdAt: { type: "date" },
};

// Column mappings translate filter fields to database columns
const columns = {
  title: "title",
  status: "status",
  priority: "priority",
  assignedTo: "assignedToUserId",
  createdAt: "createdAt",
};
```

> **Combine with `AND`, not object spread.** `{ ...where, ...result.data }`
> lets any key in the user's filter replace yours: a filter that compiles to a
> top-level `OR`, `AND` or `RAW` (or to a field you also constrain) silently
> drops your condition. `{ AND: [where, result.data] }` always keeps both.

## Express

```typescript
import express from "express";
import { isSuccess } from "@chromav/frizzle";
import { compileFilter, compileSort } from "@chromav/frizzle/drizzle";
import type { DrizzleWhere, DrizzleOrderBy } from "@chromav/frizzle/drizzle";

const app = express();

app.get("/api/tasks", async (req, res) => {
  const filterString = req.query.filter as string | undefined;
  const sortString = req.query.sort as string | undefined;

  let where: DrizzleWhere = { isDeleted: false };
  let orderBy: DrizzleOrderBy = { createdAt: "desc" };
  let filterError: string | undefined;

  if (filterString) {
    const result = await compileFilter(filterString, columns, { schema });
    if (isSuccess(result)) {
      where = { AND: [where, result.data] };
    } else {
      filterError = result.error.message;
    }
  }

  if (sortString) {
    const result = compileSort(sortString, columns);
    if (isSuccess(result)) {
      orderBy = result.data;
    }
  }

  const tasks = await db.query.tasks.findMany({ where, orderBy });

  res.json({ tasks, filterError });
});
```

## Hono

```typescript
import { Hono } from "hono";
import { isSuccess } from "@chromav/frizzle";
import { compileFilter, compileSort } from "@chromav/frizzle/drizzle";
import type { DrizzleWhere, DrizzleOrderBy } from "@chromav/frizzle/drizzle";

const app = new Hono();

app.get("/api/tasks", async (c) => {
  const filterString = c.req.query("filter");
  const sortString = c.req.query("sort");

  let where: DrizzleWhere = { isDeleted: false };
  let orderBy: DrizzleOrderBy = { createdAt: "desc" };
  let filterError: string | undefined;

  if (filterString) {
    const result = await compileFilter(filterString, columns, { schema });
    if (isSuccess(result)) {
      where = { AND: [where, result.data] };
    } else {
      filterError = result.error.message;
    }
  }

  if (sortString) {
    const result = compileSort(sortString, columns);
    if (isSuccess(result)) {
      orderBy = result.data;
    }
  }

  const tasks = await db.query.tasks.findMany({ where, orderBy });

  return c.json({ tasks, filterError });
});
```

## Next.js (App Router)

### Server component

```typescript
// app/tasks/page.tsx
import { isSuccess } from "@chromav/frizzle";
import { compileFilter, compileSort } from "@chromav/frizzle/drizzle";
import type { DrizzleWhere, DrizzleOrderBy } from "@chromav/frizzle/drizzle";

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; sort?: string }>;
}) {
  const { filter: filterString, sort: sortString } = await searchParams;

  let where: DrizzleWhere = { isDeleted: false };
  let orderBy: DrizzleOrderBy = { createdAt: "desc" };
  let filterError: string | undefined;

  if (filterString) {
    const result = await compileFilter(filterString, columns, { schema });
    if (isSuccess(result)) {
      where = { AND: [where, result.data] };
    } else {
      filterError = result.error.message;
    }
  }

  if (sortString) {
    const result = compileSort(sortString, columns);
    if (isSuccess(result)) {
      orderBy = result.data;
    }
  }

  const tasks = await db.query.tasks.findMany({ where, orderBy });

  return (
    <div>
      {filterError && <div className="error-pill">{filterError}</div>}
      <TaskList tasks={tasks} />
    </div>
  );
}
```

### Route handler

```typescript
// app/api/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isSuccess } from "@chromav/frizzle";
import { compileFilter, compileSort } from "@chromav/frizzle/drizzle";
import type { DrizzleWhere, DrizzleOrderBy } from "@chromav/frizzle/drizzle";

export async function GET(request: NextRequest) {
  const filterString = request.nextUrl.searchParams.get("filter");
  const sortString = request.nextUrl.searchParams.get("sort");

  let where: DrizzleWhere = { isDeleted: false };
  let orderBy: DrizzleOrderBy = { createdAt: "desc" };
  let filterError: string | undefined;

  if (filterString) {
    const result = await compileFilter(filterString, columns, { schema });
    if (isSuccess(result)) {
      where = { AND: [where, result.data] };
    } else {
      filterError = result.error.message;
    }
  }

  if (sortString) {
    const result = compileSort(sortString, columns);
    if (isSuccess(result)) {
      orderBy = result.data;
    }
  }

  const tasks = await db.query.tasks.findMany({ where, orderBy });

  return NextResponse.json({ tasks, filterError });
}
```

## React Router

```typescript
// app/routes/tasks.tsx
import { isSuccess } from "@chromav/frizzle";
import { compileFilter, compileSort } from "@chromav/frizzle/drizzle";
import type { DrizzleWhere, DrizzleOrderBy } from "@chromav/frizzle/drizzle";
import type { Route } from "./+types/tasks";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const filterString = url.searchParams.get("filter");
  const sortString = url.searchParams.get("sort");

  let where: DrizzleWhere = { isDeleted: false };
  let orderBy: DrizzleOrderBy = { createdAt: "desc" };
  let filterError: string | undefined;

  if (filterString) {
    const result = await compileFilter(filterString, columns, { schema });
    if (isSuccess(result)) {
      where = { AND: [where, result.data] };
    } else {
      filterError = result.error.message;
    }
  }

  if (sortString) {
    const result = compileSort(sortString, columns);
    if (isSuccess(result)) {
      orderBy = result.data;
    }
  }

  const tasks = await db.query.tasks.findMany({ where, orderBy });

  return { tasks, filterError };
}

export default function Tasks({ loaderData }: Route.ComponentProps) {
  const { tasks, filterError } = loaderData;

  return (
    <div>
      {filterError && <div className="error-pill">{filterError}</div>}
      <TaskList tasks={tasks} />
    </div>
  );
}
```

## Building a filter UI

Frizzle handles the server side — parsing and compiling filter strings into database queries. On the client side, you build a UI that writes filter strings into URL search params. Here's the general pattern.

### URL as state

Store filter and sort state in URL search params. This makes filters shareable, bookmarkable, and compatible with server-side rendering.

```
/tasks?filter=status eq 'active' AND priority eq 'high'&sort=createdAt:desc
```

### Schema drives the UI

Use the same schema that validates on the server to power the client-side UI:

```typescript
import type { Schema, FieldType, ComparisonOperator } from "@chromav/frizzle";

const schema: Schema = {
  status: { type: "enum", enumValues: ["active", "pending", "done"] },
  priority: { type: "enum", enumValues: ["low", "medium", "high"] },
  title: { type: "string" },
  createdAt: { type: "date" },
  assignedTo: { type: "uuid", nullable: true },
};

// Derive available operators from field type
const operatorsByType: Record<FieldType, ComparisonOperator[]> = {
  string: ["eq", "ne", "contains", "starts_with", "ends_with"],
  number: ["eq", "ne", "gt", "gte", "lt", "lte"],
  boolean: ["eq", "ne"],
  date: ["eq", "ne", "gt", "gte", "lt", "lte"],
  uuid: ["eq", "ne", "in", "not_in"],
  enum: ["eq", "ne", "in", "not_in"],
};
```

### Parse and serialize

Use frizzle's parser and serializer to convert between filter strings and UI-friendly condition arrays:

```typescript
import {
  parseFilterExpression,
  serializeFilterNode,
  walkFilterNode,
  isSuccess,
} from "@chromav/frizzle";
import type { FilterNodeVisitor, ComparisonNode } from "@chromav/frizzle";

// Condition: the UI's mental model of a single filter
interface Condition {
  field: string;
  operator: ComparisonOperator;
  value: unknown;
}

// Parse filter string → flat conditions array
function parseConditions(filterString: string): Condition[] {
  const result = parseFilterExpression(filterString);
  if (!isSuccess(result)) return [];

  const conditions: Condition[] = [];
  const visitor: FilterNodeVisitor<void> = {
    visitComparison(node: ComparisonNode) {
      conditions.push({
        field: node.field,
        operator: node.operator,
        value: node.value,
      });
    },
    visitLogical(node) {
      walkFilterNode(node.left, visitor);
      walkFilterNode(node.right, visitor);
    },
    visitGroup(node) {
      walkFilterNode(node.expression, visitor);
    },
  };
  walkFilterNode(result.data, visitor);
  return conditions;
}

// Serialize conditions → filter string (AND-joined)
function serializeConditions(conditions: Condition[]): string {
  if (conditions.length === 0) return "";

  const nodes = conditions.map((c) => ({
    type: "comparison" as const,
    field: c.field,
    operator: c.operator,
    value: c.value,
  }));

  const ast = nodes.reduce((left, right) => ({
    type: "logical" as const,
    operator: "and" as const,
    left,
    right,
  }));

  return serializeFilterNode(ast);
}
```

`parseConditions` returns `[]` for any error, including `LIMIT_EXCEEDED`. A filter built in the UI can grow past the server's limits (100 values and 1000 conditions by default; see [Limits](query-language.md#limits)), for example a long `in` list from a multi-select. Don't let that fail silently: check `result.error.code` and show the message (e.g. "Filter has 150 values; the limit is 100") so the user knows to narrow the filter. Parse with the same limits the server uses so the UI rejects what the server would.

### Update URL on change

When the user adds, removes, or modifies a filter condition, serialize the conditions and update the URL:

```typescript
function updateFilter(conditions: Condition[]) {
  const params = new URLSearchParams(window.location.search);

  if (conditions.length > 0) {
    params.set("filter", serializeConditions(conditions));
  } else {
    params.delete("filter");
  }

  // Update URL without full page reload
  window.history.replaceState(null, "", `?${params.toString()}`);

  // Or with your framework's router:
  // navigate({ search: params.toString() });
}
```

This pattern works with any frontend framework. The key insight is that frizzle's filter string format is the serialization format — the URL _is_ the state.
