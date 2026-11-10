import { describe, expect, it } from "vitest";
import type { WriteDescriptor } from "./write-descriptor.js";
import { createWriteDescriptor, mergeWriteDescriptor } from "./write-descriptor.js";

describe("createWriteDescriptor", () => {
  it("creates an insert descriptor with defaults", () => {
    const desc = createWriteDescriptor("insert");

    expect(desc.mutation).toBe("insert");
    expect(desc.values).toEqual({});
    expect(desc.preStatements).toEqual([]);
    expect(desc.targetIds).toEqual([]);
    expect(desc.afterEffects).toEqual([]);
  });

  it("creates a descriptor with initial values", () => {
    const desc = createWriteDescriptor("update", { title: "New", status: "done" });

    expect(desc.mutation).toBe("update");
    expect(desc.values).toEqual({ title: "New", status: "done" });
  });

  it("does not share references with the input values", () => {
    const input = { title: "Original" };
    const desc = createWriteDescriptor("insert", input);

    input.title = "Mutated";
    expect(desc.values.title).toBe("Original");
  });

  it("creates a frozen object", () => {
    const desc = createWriteDescriptor("insert");
    expect(Object.isFrozen(desc)).toBe(true);
  });

  it("supports all mutation types", () => {
    expect(createWriteDescriptor("insert").mutation).toBe("insert");
    expect(createWriteDescriptor("update").mutation).toBe("update");
    expect(createWriteDescriptor("delete").mutation).toBe("delete");
  });
});

describe("mergeWriteDescriptor", () => {
  it("merges values (changes overlay base)", () => {
    const base = createWriteDescriptor("update", { title: "Old", status: "todo" });
    const merged = mergeWriteDescriptor(base, { values: { title: "New" } });

    expect(merged.values).toEqual({ title: "New", status: "todo" });
  });

  it("overrides mutation type", () => {
    const base = createWriteDescriptor("delete");
    const merged = mergeWriteDescriptor(base, { mutation: "update" });

    expect(merged.mutation).toBe("update");
  });

  it("preserves mutation type when not overridden", () => {
    const base = createWriteDescriptor("insert", { title: "Task" });
    const merged = mergeWriteDescriptor(base, { values: { order: 1 } });

    expect(merged.mutation).toBe("insert");
  });

  it("concatenates preStatements", () => {
    const stmt1 = { sql: "UPDATE projects SET version = version + 1" };
    const stmt2 = { sql: "UPDATE counters SET count = count + 1" };

    const base: WriteDescriptor = {
      ...createWriteDescriptor("update"),
      preStatements: [stmt1],
    };
    const merged = mergeWriteDescriptor(base, { preStatements: [stmt2] });

    expect(merged.preStatements).toEqual([stmt1, stmt2]);
  });

  it("concatenates targetIds", () => {
    const base: WriteDescriptor = {
      ...createWriteDescriptor("delete"),
      targetIds: ["id-1"],
    };
    const merged = mergeWriteDescriptor(base, { targetIds: ["id-2", "id-3"] });

    expect(merged.targetIds).toEqual(["id-1", "id-2", "id-3"]);
  });

  it("concatenates afterEffects", () => {
    const effect1 = () => {};
    const effect2 = () => {};

    const base: WriteDescriptor = {
      ...createWriteDescriptor("insert"),
      afterEffects: [effect1],
    };
    const merged = mergeWriteDescriptor(base, { afterEffects: [effect2] });

    expect(merged.afterEffects).toHaveLength(2);
    expect(merged.afterEffects[0]).toBe(effect1);
    expect(merged.afterEffects[1]).toBe(effect2);
  });

  it("preserves base arrays when changes don't include them", () => {
    const stmt = { sql: "SELECT 1" };
    const base: WriteDescriptor = {
      ...createWriteDescriptor("update", { title: "Task" }),
      preStatements: [stmt],
      targetIds: ["id-1"],
    };
    const merged = mergeWriteDescriptor(base, { values: { status: "done" } });

    expect(merged.preStatements).toEqual([stmt]);
    expect(merged.targetIds).toEqual(["id-1"]);
    expect(merged.values).toEqual({ title: "Task", status: "done" });
  });

  it("returns a frozen object", () => {
    const base = createWriteDescriptor("insert");
    const merged = mergeWriteDescriptor(base, { values: { title: "New" } });

    expect(Object.isFrozen(merged)).toBe(true);
  });

  it("does not mutate the base descriptor", () => {
    const base = createWriteDescriptor("update", { title: "Original" });
    mergeWriteDescriptor(base, { values: { title: "Changed" } });

    expect(base.values.title).toBe("Original");
  });

  it("handles empty merge (no changes)", () => {
    const base = createWriteDescriptor("insert", { title: "Task" });
    const merged = mergeWriteDescriptor(base, {});

    expect(merged.mutation).toBe("insert");
    expect(merged.values).toEqual({ title: "Task" });
  });
});
