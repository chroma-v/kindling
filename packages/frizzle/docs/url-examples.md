# Real-World URL Query Examples

This document provides realistic URL query examples for project management and SaaS applications using actual domain entities.

## Table of Contents

- [Logical Operators & Nesting](#logical-operators--nesting)
- [Task Management](#task-management)
- [Project Management](#project-management)
- [User & Team Management](#user--team-management)
- [Combined Queries](#combined-queries)
- [URL-Safe vs Traditional Operators](#url-safe-vs-traditional-operators)
- [Common Patterns](#common-patterns)

---

## Logical Operators & Nesting

### Case-Insensitive Keywords & Operators

All keywords and operators are **case-insensitive**. Field names and string values remain case-sensitive.

```
# Logical operators
filter=status eq "active" and priority eq "high"
filter=status eq "active" and priority eq "high"

# Comparison operators
filter=status EQ "active"
filter=status Eq "active"
filter=age GTE 18

# All keywords: AND, OR, EQ, NE, GT, GTE, LT, LTE, LIKE, ILIKE,
# IN, NOT_IN, STARTS_WITH, ENDS_WITH, CONTAINS, BETWEEN,
# IS_NULL, IS_NOT_NULL, NULL, TRUE, FALSE
```

**Recommendation**: Use lowercase for cleaner, more readable URLs.

### Operator Precedence

**AND binds tighter than OR** (like multiplication vs addition):

```
# Without parentheses: (age > 18 and status eq "active") or role eq "admin"
GET /api/users?filter=age gt 18 and status eq "active" or role eq "admin"
```

This is parsed as: `(age > 18 and status = "active") or (role = "admin")`

### Nested Expressions with Parentheses

Use parentheses to control evaluation order:

**Example 1: High-priority OR urgent tasks that are in progress**
```
GET /api/tasks?filter=(priority eq "high" or priority eq "urgent") and status eq "in_progress"
```

**Example 2: Active projects for specific clients OR high-budget projects**
```
GET /api/projects?filter=(clientPartyId in ["01CLIENT123","01CLIENT456"] and status eq "active") or totalBudget gt "1000000"
```

**Example 3: Complex user permissions**
```
GET /api/users?filter=(role eq "admin" or role eq "moderator") and (active eq true or createdAt gt "2025-01-01")
```

**Example 4: Multi-level nesting**
```
GET /api/tasks?filter=((priority eq "urgent" and assignedToUserId is_not_null) or (priority eq "high" and targetEndDate lt "2025-02-01")) and status ne "completed"
```

### How Precedence Works

**Without parentheses:**
```
a and b or c and d
→ Parsed as: (a AND b) OR (c AND d)
```

**With parentheses (override precedence):**
```
a and (b or c) and d
→ Parsed as: a AND (b OR c) AND d
```

**Complex example:**
```
filter=priority eq "high" and status eq "active" or role eq "admin" and verified eq true

→ Parsed as: (priority = "high" and status = "active") or (role = "admin" and verified = true)
```

**Same query with explicit parentheses (clearer):**
```
filter=(priority eq "high" and status eq "active") or (role eq "admin" and verified eq true)
```

---

## Task Management

### Basic Task Filtering

**Show all high-priority tasks:**
```
GET /api/tasks?filter=priority eq "high"
```

**Show incomplete tasks:**
```
GET /api/tasks?filter=status ne "completed"
```

**Show tasks assigned to a specific user:**
```
GET /api/tasks?filter=assignedToUserId eq "01H5XYZ123"
```

**Show urgent tasks that are overdue:**
```
GET /api/tasks?filter=priority eq "urgent" and targetEndDate lt "2025-01-15"
```

**Note**: All keywords and operators are **case-insensitive** - `AND`/`and`, `EQ`/`eq`, `CONTAINS`/`contains` all work. Lowercase is recommended for cleaner URLs.

### Task Status Queries

**Show tasks waiting for materials or inspection:**
```
GET /api/tasks?filter=status in ["waiting_materials","waiting_inspection"]
```

**Show active tasks (not completed, not on hold):**
```
GET /api/tasks?filter=status not_in ["completed","on_hold"]
```

**Show tasks in progress for a specific project:**
```
GET /api/tasks?filter=status eq "in_progress" and projectId eq "01PROJ123"
```

### Task Date Queries

**Show tasks due this week:**
```
GET /api/tasks?filter=targetEndDate between ["2025-01-13","2025-01-19"]
```

**Show tasks with no due date:**
```
GET /api/tasks?filter=targetEndDate is_null
```

**Show overdue tasks:**
```
GET /api/tasks?filter=targetEndDate lt "2025-01-15" and status ne "completed"
```

**Show tasks starting next month:**
```
GET /api/tasks?filter=targetStartDate gte "2025-02-01" and targetStartDate lt "2025-03-01"
```

### Task Progress Queries

**Show tasks that are 50% or more complete:**
```
GET /api/tasks?filter=percentComplete gte 50
```

**Show nearly complete tasks:**
```
GET /api/tasks?filter=percentComplete gte 90 and status ne "completed"
```

### Task Search Queries

**Find tasks by title:**
```
GET /api/tasks?filter=title contains "painting"
```

**Find tasks by description:**
```
GET /api/tasks?filter=descriptionText contains "exterior"
```

**Find tasks by title or description:**
```
GET /api/tasks?filter=title contains "paint" or descriptionText contains "paint"
```

### Task Hierarchy Queries

**Show parent tasks only (no subtasks):**
```
GET /api/tasks?filter=parentTaskId is_null
```

**Show subtasks of a specific parent:**
```
GET /api/tasks?filter=parentTaskId eq "01TASK789"
```

### Complex Task Queries

**Show my high-priority tasks due this week:**
```
GET /api/tasks?filter=assignedToUserId eq "01USER123" AND priority eq "high" and targetEndDate between ["2025-01-13","2025-01-19"]&sort=targetEndDate:asc
```

**Show unassigned urgent tasks:**
```
GET /api/tasks?filter=assignedToUserId is_null and priority eq "urgent"&sort=createdAt:desc
```

**Show blocked tasks (waiting for materials or inspection):**
```
GET /api/tasks?filter=status in ["waiting_materials","waiting_inspection"]&sort=status:asc,targetEndDate:asc
```

**Show team tasks (multiple assignees):**
```
GET /api/tasks?filter=assignedToUserId in ["01USER123","01USER456","01USER789"]&sort=priority:desc,targetEndDate:asc
```

---

## Project Management

### Basic Project Filtering

**Show active projects:**
```
GET /api/projects?filter=status eq "active"
```

**Show projects by type:**
```
GET /api/projects?filter=projectType eq "residential_construction"
```

**Show projects for a specific client:**
```
GET /api/projects?filter=clientPartyId eq "01CLIENT123"
```

### Project Status Queries

**Show projects in planning or active phase:**
```
GET /api/projects?filter=status in ["planning","active"]
```

**Show completed or cancelled projects:**
```
GET /api/projects?filter=status in ["completed","cancelled"]
```

**Show on-hold projects:**
```
GET /api/projects?filter=status eq "on_hold"
```

### Project Timeline Queries

**Show projects starting next quarter:**
```
GET /api/projects?filter=plannedStartDate gte "2025-04-01" and plannedStartDate lt "2025-07-01"
```

**Show overdue projects:**
```
GET /api/projects?filter=plannedEndDate lt "2025-01-15" and status not_in ["completed","cancelled"]
```

**Show long-running projects (over 6 months):**
```
GET /api/projects?filter=actualStartDate lt "2024-07-15" and status eq "active"
```

### Project Budget Queries

**Show high-budget projects:**
```
GET /api/projects?filter=totalBudget gt "500000"
```

**Show projects within budget range:**
```
GET /api/projects?filter=totalBudget between ["100000","500000"]
```

### Project Search Queries

**Find projects by name:**
```
GET /api/projects?filter=name contains "residential"
```

**Find projects by description:**
```
GET /api/projects?filter=description contains "renovation"
```

### Complex Project Queries

**Show active projects for a specific client, sorted by budget:**
```
GET /api/projects?filter=status eq "active" and clientPartyId eq "01CLIENT123"&sort=totalBudget:desc
```

**Show overdue active projects:**
```
GET /api/projects?filter=status eq "active" and plannedEndDate lt "2025-01-15"&sort=plannedEndDate:asc
```

**Show projects by multiple project managers:**
```
GET /api/projects?filter=projectManagerPartyId in ["01PM123","01PM456"]&sort=plannedStartDate:asc
```

---

## User & Team Management

### User Filtering

**Show admin users:**
```
GET /api/users?filter=role eq "admin"
```

**Show active users:**
```
GET /api/users?filter=active eq true
```

**Show users in a specific workspace:**
```
GET /api/users?filter=workspaceId eq "01WORKSPACE123"
```

### User Search Queries

**Find users by name:**
```
GET /api/users?filter=name contains "smith"
```

**Find users by email domain:**
```
GET /api/users?filter=email ends_with "@company.com"
```

**Find users by partial email:**
```
GET /api/users?filter=email contains "gmail"
```

### User Role Queries

**Show admins or moderators:**
```
GET /api/users?filter=role in ["admin","moderator"]
```

**Show non-admin users:**
```
GET /api/users?filter=role ne "admin"
```

### Complex User Queries

**Show active admins in a workspace:**
```
GET /api/users?filter=active eq true AND role eq "admin" and workspaceId eq "01WORKSPACE123"&sort=name:asc
```

**Show inactive users (for cleanup):**
```
GET /api/users?filter=active eq false&sort=updatedAt:asc
```

---

## Combined Queries

### Dashboard Views

**My Tasks Dashboard:**
```
GET /api/tasks?filter=assignedToUserId eq "01USER123" and status not_in ["completed","cancelled"]&sort=priority:desc,targetEndDate:asc&limit=50
```

**Team Overview:**
```
GET /api/tasks?filter=projectId eq "01PROJ123" and status in ["in_progress","not_started"]&sort=assignedToUserId:asc,priority:desc
```

**Project Health Check:**
```
GET /api/projects?filter=status eq "active" and (plannedEndDate lt "2025-02-01" or totalBudget gt "1000000")&sort=plannedEndDate:asc
```

### Report Queries

**Overdue Tasks by Priority:**
```
GET /api/tasks?filter=targetEndDate lt "2025-01-15" and status ne "completed"&sort=priority:desc,targetEndDate:asc&limit=100
```

**Project Portfolio Summary:**
```
GET /api/projects?filter=status in ["planning","active"]&sort=totalBudget:desc,plannedStartDate:asc
```

**Team Workload Analysis:**
```
GET /api/tasks?filter=assignedToUserId in ["01USER123","01USER456","01USER789"] and status in ["in_progress","not_started"]&sort=assignedToUserId:asc,priority:desc
```

### Advanced Filtering

**Critical Path Tasks:**
```
GET /api/tasks?filter=(priority eq "urgent" or priority eq "high") AND status in ["in_progress","not_started","waiting_materials"] and targetEndDate lt "2025-02-01"&sort=targetEndDate:asc,priority:desc
```

**Blocked Work Items:**
```
GET /api/tasks?filter=status in ["waiting_materials","waiting_inspection","on_hold"] and assignedToUserId is_not_null&sort=status:asc,targetEndDate:asc
```

**Recently Updated Active Projects:**
```
GET /api/projects?filter=status eq "active" and updatedAt gte "2025-01-01"&sort=updatedAt:desc&limit=25
```

---

## URL-Safe vs Traditional Operators

### Comparison Operators

**URL-Safe (Recommended):**
```
GET /api/tasks?filter=priority eq "high" and targetEndDate lt "2025-01-31"
```

**Traditional (Requires URL encoding):**
```
GET /api/tasks?filter=priority%20%3D%20%22high%22%20AND%20targetEndDate%20%3C%20%222025-01-31%22
```

### Why URL-Safe is Better

**Readable URLs:**
```
✅ /api/tasks?filter=status eq "active"
❌ /api/tasks?filter=status%20%3D%20%22active%22
```

**No Firewall Issues:**
- Some WAFs block angle brackets (`<`, `>`) in URLs
- URL-safe operators (`lt`, `gt`, `eq`, `ne`) work everywhere

**Better Logs:**
- URL-safe queries are human-readable in server logs
- Easier debugging and monitoring

### Operator Mapping

| Traditional | URL-Safe | Example |
|-------------|----------|---------|
| `=` | `eq` | `status eq "active"` |
| `!=` | `ne` | `status ne "completed"` |
| `>` | `gt` | `budget gt "100000"` |
| `>=` | `gte` | `progress gte 50` |
| `<` | `lt` | `endDate lt "2025-02-01"` |
| `<=` | `lte` | `priority lte "medium"` |

---

## Common Patterns

### Pagination

**First page (default):**
```
GET /api/tasks?limit=25
```

**Second page:**
```
GET /api/tasks?limit=25&offset=25
```

**Third page:**
```
GET /api/tasks?limit=25&offset=50
```

**Large result set with filtering:**
```
GET /api/tasks?filter=status eq "active"&sort=createdAt:desc&limit=100&offset=200
```

### Sorting

**Single field ascending:**
```
GET /api/tasks?sort=targetEndDate:asc
```

**Single field descending:**
```
GET /api/tasks?sort=createdAt:desc
```

**Multiple fields:**
```
GET /api/tasks?sort=priority:desc,targetEndDate:asc,title:asc
```

**Default direction (ascending):**
```
GET /api/tasks?sort=name
```

### Full-Text Search

**Search task titles:**
```
GET /api/tasks?filter=title contains "painting"&sort=relevance:desc
```

**Search across multiple fields:**
```
GET /api/tasks?filter=title contains "paint" or descriptionText contains "paint"&sort=createdAt:desc
```

**Case-insensitive search:**
```
GET /api/tasks?filter=title ilike "PAINTING"
```

### Date Ranges

**This week:**
```
GET /api/tasks?filter=targetEndDate between ["2025-01-13","2025-01-19"]
```

**This month:**
```
GET /api/tasks?filter=createdAt gte "2025-01-01" and createdAt lt "2025-02-01"
```

**Last 7 days:**
```
GET /api/tasks?filter=createdAt gte "2025-01-08"
```

**Next 30 days:**
```
GET /api/tasks?filter=targetEndDate gte "2025-01-15" and targetEndDate lt "2025-02-14"
```

### Null Handling

**Has value:**
```
GET /api/tasks?filter=assignedToUserId is_not_null
```

**Missing value:**
```
GET /api/tasks?filter=targetEndDate is_null
```

**Optional with fallback:**
```
GET /api/tasks?filter=assignedToUserId is_null or assignedToUserId eq "01USER123"
```

### Array Operations

**In list:**
```
GET /api/tasks?filter=status in ["in_progress","not_started","waiting_materials"]
```

**Not in list:**
```
GET /api/tasks?filter=priority not_in ["low"]
```

**Multiple IDs:**
```
GET /api/tasks?filter=id in ["01TASK123","01TASK456","01TASK789"]
```

---

## Best Practices

### 1. Always Use URL-Safe Operators

**✅ Good:**
```
GET /api/tasks?filter=priority eq "high"
```

**❌ Avoid:**
```
GET /api/tasks?filter=priority = "high"  # May require encoding
```

### 2. Use Pagination for Large Datasets

**✅ Good:**
```
GET /api/tasks?limit=50&offset=0
```

**❌ Avoid:**
```
GET /api/tasks  # Returns all tasks (could be thousands)
```

### 3. Sort for Predictable Results

**✅ Good:**
```
GET /api/tasks?filter=status eq "active"&sort=createdAt:desc
```

**❌ Avoid:**
```
GET /api/tasks?filter=status eq "active"  # Unpredictable order
```

### 4. Use Specific Filters

**✅ Good:**
```
GET /api/tasks?filter=projectId eq "01PROJ123" and status eq "active"
```

**❌ Avoid:**
```
GET /api/tasks  # Fetch all, filter client-side
```

### 5. Combine Filters for Precision

**✅ Good:**
```
GET /api/tasks?filter=assignedToUserId eq "01USER123" AND priority in ["high","urgent"] and targetEndDate lt "2025-02-01"
```

**❌ Avoid:**
```
GET /api/tasks?filter=assignedToUserId eq "01USER123"  # Too broad
```

---

## API Design Tips

### Consistent Endpoints

```
GET /api/tasks?filter=...          # List with filtering
GET /api/tasks/:id                 # Single item
POST /api/tasks                    # Create
PATCH /api/tasks/:id               # Update
DELETE /api/tasks/:id              # Delete
```

### Default Behavior

```
GET /api/tasks                     # Returns active tasks by default
GET /api/tasks?filter=all          # Opt-in to see all (including archived)
```

### Query String Limits

- **Max filter length**: 2048 characters (URL limit)
- **Max limit value**: 1000 by default (`maxLimit` option)
- **Max offset**: Reasonable limit (e.g., 10,000) — frizzle only checks it is a non-negative integer
- **Max nesting**: 32 levels of parentheses (`maxDepth`)
- **Max values**: 100 bound values across the whole filter (`maxParameters`), and optionally per field (`SchemaField.maxValues`)
- **Max conditions**: 1000 comparisons (`maxConditions`)

Exceeding a filter limit returns a `LIMIT_EXCEEDED` error. See [Limits](query-language.md#limits).

### Error Responses

```json
{
  "error": {
    "code": "UNKNOWN_FIELD",
    "message": "Unknown field 'invalidField'",
    "suggestions": ["title", "status", "priority"]
  }
}
```

---

## Integration Examples

### React Query

```typescript
import { useQuery } from '@tanstack/react-query';

function useTasks(filters: TaskFilters) {
  const queryString = buildQueryString(filters);

  return useQuery({
    queryKey: ['tasks', queryString],
    queryFn: () => fetch(`/api/tasks?${queryString}`).then(r => r.json())
  });
}

// Usage
const { data: tasks } = useTasks({
  status: 'active',
  priority: ['high', 'urgent'],
  assignedTo: currentUserId,
  sort: 'targetEndDate:asc',
  limit: 50
});
```

### Next.js Server Component

```typescript
export default async function TasksPage({
  searchParams
}: {
  searchParams: { filter?: string; sort?: string; limit?: string }
}) {
  const queryString = new URLSearchParams(searchParams).toString();
  const tasks = await fetch(`/api/tasks?${queryString}`).then(r => r.json());

  return <TaskList tasks={tasks} />;
}
```

### Express.js API

```typescript
import { createCompiler, parseQueryString, isError } from '@chromav/frizzle';
import { DrizzleCodeGenerator } from '@chromav/frizzle/drizzle';

const compiler = createCompiler({ schema, codeGenerator: new DrizzleCodeGenerator() });

app.get('/api/tasks', async (req, res) => {
  const params = parseQueryString(new URL(req.url, 'http://localhost'));
  if (isError(params)) return res.status(400).json({ error: params.error });

  const ast = compiler.parse(params.data);
  if (isError(ast)) return res.status(400).json({ error: ast.error });

  const query = compiler.compile(ast.data, {
    baseQuery: db.select().from(tasks),
    tableColumns: tasks,
  });
  if (isError(query)) return res.status(400).json({ error: query.error });

  res.json({ data: await query.data });
});
```

---

**Last Updated:** 2025-01-27
**Status:** ✅ Production Examples
**Version:** 1.0
