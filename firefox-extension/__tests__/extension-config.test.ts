import { getConfig, ExtensionConfig } from "../extension-config";

describe("extension-config ports default/migration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("defaults ports to [8089, 8090, 8091] when unset, and persists it", async () => {
    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: { secret: "test-secret" } as ExtensionConfig,
    });

    const config = await getConfig();

    expect(config.ports).toEqual([8089, 8090, 8091]);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      config: expect.objectContaining({ ports: [8089, 8090, 8091] }),
    });
  });

  it("migrates the old single-port default [8089] to the new default array", async () => {
    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: { secret: "test-secret", ports: [8089] } as ExtensionConfig,
    });

    const config = await getConfig();

    expect(config.ports).toEqual([8089, 8090, 8091]);
    expect(browser.storage.local.set).toHaveBeenCalledWith({
      config: expect.objectContaining({ ports: [8089, 8090, 8091] }),
    });
  });

  it("leaves a custom, deliberately-chosen ports list untouched", async () => {
    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: { secret: "test-secret", ports: [9000, 9001] } as ExtensionConfig,
    });

    const config = await getConfig();

    expect(config.ports).toEqual([9000, 9001]);
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });

  it("leaves an already-migrated default array untouched (no repeat writes)", async () => {
    (browser.storage.local.get as jest.Mock).mockResolvedValue({
      config: { secret: "test-secret", ports: [8089, 8090, 8091] } as ExtensionConfig,
    });

    const config = await getConfig();

    expect(config.ports).toEqual([8089, 8090, 8091]);
    expect(browser.storage.local.set).not.toHaveBeenCalled();
  });
});
