// ============================================================================
// SHARED TEST DATABASE — In-Memory SQLite
// ============================================================================
// Used by integration tests to validate the full chain:
// descriptor → SQL → execute → verify results

import Database from "better-sqlite3";
import type { SqlColumnMap } from "../types.js";

export const TASKS_DDL = `
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'backlog',
  priority INTEGER NOT NULL DEFAULT 0,
  "assignedTo" TEXT,
  "isDeleted" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TEXT,
  "workspaceId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT
)`;

/** Column map matching the test tasks table. */
export const TASK_COLUMNS: SqlColumnMap = {
  id: "id",
  title: "title",
  status: "status",
  priority: "priority",
  assignedTo: "assignedTo",
  isDeleted: "isDeleted",
  deletedAt: "deletedAt",
  workspaceId: "workspaceId",
  order: "order",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

export interface TestTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  assignedTo: string | null;
  isDeleted: number;
  deletedAt: string | null;
  workspaceId: string;
  order: number;
  createdAt: string;
  updatedAt: string | null;
}

/** Seed rows covering all operator test scenarios. */
export const SEED_TASKS: TestTask[] = [
  {
    id: "t-1",
    title: "Design landing page",
    status: "done",
    priority: 2,
    assignedTo: "user-1",
    isDeleted: 0,
    deletedAt: null,
    workspaceId: "ws-1",
    order: 1,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-15",
  },
  {
    id: "t-2",
    title: "Implement auth",
    status: "in_progress",
    priority: 3,
    assignedTo: "user-2",
    isDeleted: 0,
    deletedAt: null,
    workspaceId: "ws-1",
    order: 2,
    createdAt: "2026-01-05",
    updatedAt: null,
  },
  {
    id: "t-3",
    title: "Write tests",
    status: "backlog",
    priority: 1,
    assignedTo: null,
    isDeleted: 0,
    deletedAt: null,
    workspaceId: "ws-1",
    order: 3,
    createdAt: "2026-01-10",
    updatedAt: null,
  },
  {
    id: "t-4",
    title: "Fix bug #42",
    status: "in_progress",
    priority: 4,
    assignedTo: "user-1",
    isDeleted: 0,
    deletedAt: null,
    workspaceId: "ws-1",
    order: 4,
    createdAt: "2026-02-01",
    updatedAt: "2026-02-10",
  },
  {
    id: "t-5",
    title: "Deploy v2",
    status: "backlog",
    priority: 0,
    assignedTo: null,
    isDeleted: 0,
    deletedAt: null,
    workspaceId: "ws-1",
    order: 5,
    createdAt: "2026-02-15",
    updatedAt: null,
  },
  {
    id: "t-6",
    title: "Deleted task",
    status: "backlog",
    priority: 1,
    assignedTo: "user-1",
    isDeleted: 1,
    deletedAt: "2026-02-20",
    workspaceId: "ws-1",
    order: 6,
    createdAt: "2026-01-20",
    updatedAt: null,
  },
  {
    id: "t-7",
    title: "Other workspace task",
    status: "done",
    priority: 3,
    assignedTo: "user-3",
    isDeleted: 0,
    deletedAt: null,
    workspaceId: "ws-2",
    order: 1,
    createdAt: "2026-01-01",
    updatedAt: null,
  },
  {
    id: "t-8",
    title: "Search feature",
    status: "in_progress",
    priority: 2,
    assignedTo: "user-2",
    isDeleted: 0,
    deletedAt: null,
    workspaceId: "ws-2",
    order: 2,
    createdAt: "2026-03-01",
    updatedAt: null,
  },
];

/**
 * Create a fresh in-memory SQLite database with the tasks table and seed data.
 */
export function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(TASKS_DDL);

  const insert = db.prepare(
    `INSERT INTO tasks (id, title, status, priority, "assignedTo", "isDeleted", "deletedAt", "workspaceId", "order", "createdAt", "updatedAt")
		 VALUES (@id, @title, @status, @priority, @assignedTo, @isDeleted, @deletedAt, @workspaceId, @order, @createdAt, @updatedAt)`,
  );

  const insertMany = db.transaction((tasks: TestTask[]) => {
    for (const task of tasks) {
      insert.run(task);
    }
  });
  insertMany(SEED_TASKS);

  return db;
}
