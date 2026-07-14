import { describe, it, expect, beforeEach } from "vitest";
import { demoRepository as repo } from "./demo-repository";

beforeEach(() => {
  localStorage.clear();
});

const newProject = () =>
  repo.create({
    name: "Test Tower",
    type: "COMMERCIAL",
    budgetPaise: 10_000_000,
    contractValuePaise: 11_000_000,
    tags: ["test"],
  });

describe("demoRepository", () => {
  it("seeds and lists non-archived projects", async () => {
    const list = await repo.list();
    expect(list.length).toBe(5); // 6 seeded, 1 archived
    expect(list.some((p) => p.code === "PRJ-0142")).toBe(true);
  });

  it("includes archived when asked", async () => {
    const all = await repo.list({ includeArchived: true });
    expect(all.length).toBe(6);
  });

  it("creates a project with an auto-generated code", async () => {
    const p = await newProject();
    expect(p.code).toMatch(/^PRJ-\d{4}$/);
    expect(p.stage).toBe("CREATED");
    const list = await repo.list();
    expect(list.some((x) => x.id === p.id)).toBe(true);
  });

  it("changes stage and records activity", async () => {
    const p = await newProject();
    await repo.changeStage(p.id, "CONSTRUCTION");
    const detail = await repo.get(p.id);
    expect(detail?.stage).toBe("CONSTRUCTION");
    expect(detail?.activity.some((a) => a.action === "stage.changed")).toBe(true);
  });

  it("toggles favorite", async () => {
    const p = await newProject();
    expect(await repo.toggleFavorite(p.id)).toBe(true);
    expect((await repo.get(p.id))?.isFavorite).toBe(true);
    expect(await repo.toggleFavorite(p.id)).toBe(false);
  });

  it("duplicates with a new code and (copy) suffix", async () => {
    const p = await newProject();
    const copy = await repo.duplicate(p.id);
    expect(copy.id).not.toBe(p.id);
    expect(copy.name).toBe("Test Tower (copy)");
    expect(copy.code).not.toBe(p.code);
  });

  it("archives and restores", async () => {
    const p = await newProject();
    await repo.setArchived(p.id, true);
    expect((await repo.list()).some((x) => x.id === p.id)).toBe(false);
    await repo.setArchived(p.id, false);
    expect((await repo.list()).some((x) => x.id === p.id)).toBe(true);
  });

  it("adds deadlines and notes", async () => {
    const p = await newProject();
    await repo.addDeadline(p.id, "Slab casting", "2026-08-01");
    await repo.addNote(p.id, "Client approved layout");
    const detail = await repo.get(p.id);
    expect(detail?.deadlines).toHaveLength(1);
    expect(detail?.notes[0].body).toBe("Client approved layout");
  });

  it("filters by search across name, code, and tags", async () => {
    expect((await repo.list({ search: "skyline" })).length).toBe(1);
    expect((await repo.list({ search: "PRJ-0138" })).length).toBe(1);
    expect((await repo.list({ search: "nonexistent" })).length).toBe(0);
  });
});
