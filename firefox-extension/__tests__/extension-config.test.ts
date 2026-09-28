import {
  getConfig, getAuditLog, isToolEnabled, getDomainDenyList,
  setToolEnabled, setDomainDenyList, setPorts, addAuditLogEntry,
} from "../extension-config";

let stored: Record<string, any>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  stored = { config: {
    secret: "synthetic-test-key", ports: [8089], domainDenyList: ["example.invalid"],
    toolSettings: { "close-browser-tabs": true, "open-browser-tab": true }, auditLog: [],
  }};
  (browser.storage.local.get as jest.Mock).mockImplementation(async () => copy(stored));
  (browser.storage.local.set as jest.Mock).mockImplementation(async values => Object.assign(stored, copy(values)));
});

test("reads legacy configuration without changing its secret or permissions", async () => {
  stored.config.toolSettings["close-browser-tabs"] = false;
  const config = await getConfig();
  expect(config.secret).toBe("synthetic-test-key");
  expect(config.ports).toEqual([8089]);
  expect(await isToolEnabled("close-browser-tabs")).toBe(false);
});

test("a delayed audit write cannot restore permissions or domain settings", async () => {
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  (browser.storage.local.set as jest.Mock).mockImplementation(async values => {
    if (values.auditLog || values.config?.auditLog?.length) {
      entered(); await new Promise<void>(resolve => { release = resolve; });
    }
    Object.assign(stored, copy(values));
  });
  const audit = addAuditLogEntry({ toolId: "get-list-of-open-tabs", command: "get-tab-list", timestamp: 1 });
  await waiting;
  await setToolEnabled("close-browser-tabs", false);
  await setDomainDenyList(["blocked.example.invalid"]);
  await setPorts([8090]);
  release(); await audit;
  expect(await isToolEnabled("close-browser-tabs")).toBe(false);
  expect(await getDomainDenyList()).toEqual(["blocked.example.invalid"]);
  expect((await getConfig()).ports).toEqual([8090]);
});

test("concurrent tool changes do not overwrite each other", async () => {
  await Promise.all([
    setToolEnabled("open-browser-tab", false),
    setToolEnabled("close-browser-tabs", false),
  ]);
  expect(await isToolEnabled("open-browser-tab")).toBe(false);
  expect(await isToolEnabled("close-browser-tabs")).toBe(false);
});

test("audit appends preserve concurrent entries and do not write legacy config", async () => {
  await Promise.all(Array.from({ length: 5 }, (_, timestamp) => addAuditLogEntry({
    toolId: "get-list-of-open-tabs", command: "get-tab-list", timestamp,
  })));
  expect(await getAuditLog()).toHaveLength(5);
  expect(stored.config.auditLog).toEqual([]);
});
