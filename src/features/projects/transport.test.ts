import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Transport selection.
 *
 * The web app must keep using Server Actions and the native app must use HTTP
 * RPC — getting this wrong is silent (the wrong branch simply fails at runtime
 * on a device, or worse, drags server code into a client bundle). Asserted by
 * observing which implementation actually answers a call.
 */

const serverList = vi.fn(async () => [{ id: "from-server-action" }]);
const httpList = vi.fn(async () => [{ id: "from-http-rpc" }]);
const demoList = vi.fn(async () => [{ id: "from-demo-fixtures" }]);

// `data.ts` does `import * as server`, and an ES namespace import needs real
// named exports — a Proxy cannot stand in for one.
const SERVER_ACTION_NAMES = [
  "listProjects", "getProject", "createProject", "updateProject", "changeStage",
  "assignManager", "duplicateProject", "setArchived", "removeProject", "restoreProject",
  "getProjectRetention", "setProjectRetention", "toggleFavorite", "addDeadline",
  "toggleDeadline", "removeDeadline", "addNote", "addDocument", "removeDocument",
  "listManagers", "listProjectContractors", "setProjectContractors",
] as const;

vi.mock("./server/actions", () =>
  Object.fromEntries(SERVER_ACTION_NAMES.map((name) => [name, serverList])),
);
vi.mock("./http-repository", () => ({
  httpProjectsRepository: new Proxy({}, { get: () => httpList }),
}));
vi.mock("./demo/demo-repository", () => ({
  demoRepository: new Proxy({}, { get: () => demoList }),
}));

async function loadWith(env: { isDemoMode: boolean }, platform: { isNativeClient: boolean }) {
  vi.resetModules();
  vi.doMock("@/lib/env", () => env);
  vi.doMock("@/lib/mobile/platform", () => ({ ...platform, mobileApiBase: "" }));
  return import("./data");
}

beforeEach(() => {
  serverList.mockClear();
  httpList.mockClear();
  demoList.mockClear();
});

describe("transport selection", () => {
  it("web uses Server Actions", async () => {
    const { projectsApi } = await loadWith({ isDemoMode: false }, { isNativeClient: false });
    await expect(projectsApi.list()).resolves.toEqual([{ id: "from-server-action" }]);
    expect(httpList).not.toHaveBeenCalled();
  });

  it("native uses HTTP RPC, never Server Actions", async () => {
    // Server Actions cannot work from capacitor://localhost — there is no
    // same-origin Next server to receive them.
    const { projectsApi } = await loadWith({ isDemoMode: false }, { isNativeClient: true });
    await expect(projectsApi.list()).resolves.toEqual([{ id: "from-http-rpc" }]);
    expect(serverList).not.toHaveBeenCalled();
  });

  it("demo mode wins over both, so previews never hit a backend", async () => {
    const { projectsApi } = await loadWith({ isDemoMode: true }, { isNativeClient: true });
    await expect(projectsApi.list()).resolves.toEqual([{ id: "from-demo-fixtures" }]);
    expect(httpList).not.toHaveBeenCalled();
    expect(serverList).not.toHaveBeenCalled();
  });
});
