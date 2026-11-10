import { describe, expect, it, vi } from "vitest";
import type { DrizzleQueryTable } from "./drizzle-query-adapter.js";
import { createDrizzleAdapter } from "./drizzle-query-adapter.js";
import { createExecutableQuery } from "./query.js";

interface TestEntity {
  id: string;
  name: string;
  status: string;
}

function mockQueryTable(): DrizzleQueryTable<TestEntity> & {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
} {
  return {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createDrizzleAdapter", () => {
  it("passes filter as where to findMany", async () => {
    const table = mockQueryTable();
    const adapter = createDrizzleAdapter(table);

    await createExecutableQuery(adapter).filter({ status: "active" }).findMany();

    expect(table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "active" },
      }),
    );
  });

  it("passes sort as orderBy to findMany", async () => {
    const table = mockQueryTable();
    const adapter = createDrizzleAdapter(table);

    await createExecutableQuery(adapter).sort({ createdAt: "desc" }).findMany();

    expect(table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  it("passes take as limit and skip as offset", async () => {
    const table = mockQueryTable();
    const adapter = createDrizzleAdapter(table);

    await createExecutableQuery(adapter).take(20).skip(40).findMany();

    expect(table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        offset: 40,
      }),
    );
  });

  it("passes with from adapter options", async () => {
    const table = mockQueryTable();
    const adapter = createDrizzleAdapter(table, {
      with: { assignedToUser: true },
    });

    await createExecutableQuery(adapter).filter({ id: "1" }).findMany();

    expect(table.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        with: { assignedToUser: true },
      }),
    );
  });

  it("passes columns from adapter options", async () => {
    const table = mockQueryTable();
    const adapter = createDrizzleAdapter(table, {
      columns: { id: true, name: true },
    });

    await createExecutableQuery(adapter).filter({ id: "1" }).findFirst();

    expect(table.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: { id: true, name: true },
      }),
    );
  });

  it("findFirst delegates to queryTable.findFirst", async () => {
    const table = mockQueryTable();
    table.findFirst.mockResolvedValue({ id: "1", name: "Test", status: "active" });

    const adapter = createDrizzleAdapter(table);
    const result = await createExecutableQuery(adapter).filter({ id: "1" }).findFirst();

    expect(result).toEqual({ id: "1", name: "Test", status: "active" });
  });

  it("returns adapter results unchanged", async () => {
    const items = [
      { id: "1", name: "A", status: "active" },
      { id: "2", name: "B", status: "draft" },
    ];
    const table = mockQueryTable();
    table.findMany.mockResolvedValue(items);

    const adapter = createDrizzleAdapter(table);
    const result = await createExecutableQuery(adapter).findMany();

    expect(result).toBe(items);
  });

  it("composes filter + sort + pagination + options correctly", async () => {
    const table = mockQueryTable();
    const adapter = createDrizzleAdapter(table, {
      with: { project: true },
    });

    await createExecutableQuery(adapter)
      .filter({ workspaceId: "ws-1" })
      .filter({ status: "active" })
      .sort({ createdAt: "desc" })
      .take(10)
      .skip(20)
      .findMany();

    expect(table.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", status: "active" },
      orderBy: { createdAt: "desc" },
      with: { project: true },
      columns: undefined,
      limit: 10,
      offset: 20,
    });
  });
});
