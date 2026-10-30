import { afterEach, describe, expect, it } from "vitest";
import {
  ENV_PROFILE_ID,
  envProfileOf,
  LLM_ACTIVE_PROFILE_KEY,
  LLM_PROFILES_KEY,
  type LlmConnectionProfile,
  loadStoredProfiles,
  persistProfiles,
  profileOverrides,
  sanitizeProfile,
} from "@/lib/nova";

/**
 * [V-06] 连接档案与旧键迁移。
 *
 * 档案是浏览器本地配置：可能被手工改坏、可能是旧版本写的、隐私模式下
 * 存取还会抛错。任何异常都必须降级为「空配置」，不能让整个页面白屏。
 */

const LEGACY_PROFILES_KEY = "nova:converse:profiles";
const LEGACY_ACTIVE_KEY = "nova:converse:active-profile";
const LEGACY_OVERRIDES_KEY = "nova:converse:agent-overrides";

class MemoryStorage {
  readonly map: Map<string, string>;

  constructor(seed: Record<string, string> = {}) {
    this.map = new Map(Object.entries(seed));
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function useStorage(seed: Record<string, string> = {}) {
  const storage = new MemoryStorage(seed);
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
  });
  return storage;
}

function profile(id: string): LlmConnectionProfile {
  return {
    id,
    name: `配置 ${id}`,
    endpoint: "http://127.0.0.1:43110/v1",
    model: "nova-local-agent",
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

describe("[V-06] 连接档案与旧键迁移", () => {
  it("内置档案代表无覆盖：端点规范化、id 固定", () => {
    const env = envProfileOf({
      endpoint: "http://127.0.0.1:43110/v1///",
      model: "nova-local-agent",
    });

    expect(env.id).toBe(ENV_PROFILE_ID);
    expect(env.name).toBe("默认配置");
    expect(env.endpoint).toBe("http://127.0.0.1:43110/v1");
    expect(profileOverrides(env)).toEqual({});
  });

  it("自定义档案转成覆盖值：端点规范化，密钥可选", () => {
    expect(
      profileOverrides({
        id: "p1",
        name: "自定义",
        endpoint: " https://api.example.com/v1/ ",
        model: "gpt-x",
        apiKey: "sk-1",
      }),
    ).toEqual({
      endpoint: "https://api.example.com/v1",
      model: "gpt-x",
      apiKey: "sk-1",
    });

    expect(
      profileOverrides({
        id: "p2",
        name: "无密钥",
        endpoint: "http://x/v1",
        model: "m",
      }),
    ).toEqual({ endpoint: "http://x/v1", model: "m" });
  });

  it("非法档案一律丢弃，保留 id __env__ 的伪造项也不收", () => {
    for (const raw of [null, "x", 42, {}, { id: "p1" }, { name: "n" }]) {
      expect(sanitizeProfile(raw)).toBeNull();
    }
    expect(
      sanitizeProfile({ id: ENV_PROFILE_ID, name: "伪造默认" }),
    ).toBeNull();
  });

  it("逐字段裁剪：名称 60、端点 300、模型 120、密钥 300", () => {
    const shaped = sanitizeProfile({
      id: "i".repeat(100),
      name: "n".repeat(100),
      endpoint: `https://example.com/${"e".repeat(400)}`,
      model: "m".repeat(200),
      apiKey: "k".repeat(400),
    });

    expect(shaped?.id).toHaveLength(60);
    expect(shaped?.name).toHaveLength(60);
    expect(shaped?.endpoint).toHaveLength(300);
    expect(shaped?.model).toHaveLength(120);
    expect(shaped?.apiKey).toHaveLength(300);
  });

  it("空密钥不落进档案，避免把空串当成显式覆盖", () => {
    const shaped = sanitizeProfile({
      id: "p1",
      name: "n",
      endpoint: "http://x/v1",
      model: "m",
      apiKey: "   ",
    });
    expect(shaped).not.toHaveProperty("apiKey");
  });

  it("没有 window 时读取返回空配置", () => {
    expect(loadStoredProfiles()).toEqual({ profiles: [], activeId: null });
  });

  it("存储里的 JSON 损坏时按空配置处理", () => {
    useStorage({ [LLM_PROFILES_KEY]: "{not json" });
    expect(loadStoredProfiles()).toEqual({ profiles: [], activeId: null });
  });

  it("读取时过滤非法条目，激活项失效则回到无覆盖", () => {
    useStorage({
      [LLM_PROFILES_KEY]: JSON.stringify([
        profile("p1"),
        { id: ENV_PROFILE_ID, name: "伪造" },
        { nope: true },
      ]),
      [LLM_ACTIVE_PROFILE_KEY]: "ghost",
    });

    const loaded = loadStoredProfiles();
    expect(loaded.profiles.map((item) => item.id)).toEqual(["p1"]);
    expect(loaded.activeId).toBeNull();
  });

  it("旧版档案键迁移一次：写入全局键并清掉旧键", () => {
    const storage = useStorage({
      [LEGACY_PROFILES_KEY]: JSON.stringify([profile("legacy-1")]),
      [LEGACY_ACTIVE_KEY]: "legacy-1",
    });

    const loaded = loadStoredProfiles();

    expect(loaded.profiles.map((item) => item.id)).toEqual(["legacy-1"]);
    expect(loaded.activeId).toBe("legacy-1");
    expect(storage.getItem(LEGACY_PROFILES_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_ACTIVE_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(LLM_PROFILES_KEY) ?? "[]")).toHaveLength(
      1,
    );
    expect(storage.getItem(LLM_ACTIVE_PROFILE_KEY)).toBe("legacy-1");
  });

  it("旧版单配置迁移为一条自定义档案", () => {
    const storage = useStorage({
      [LEGACY_OVERRIDES_KEY]: JSON.stringify({
        endpoint: "https://api.example.com/v1",
        model: "gpt-x",
        apiKey: "sk-1",
      }),
    });

    const loaded = loadStoredProfiles();

    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.profiles[0]).toMatchObject({
      name: "自定义配置",
      endpoint: "https://api.example.com/v1",
      model: "gpt-x",
      apiKey: "sk-1",
    });
    expect(loaded.activeId).toBe(loaded.profiles[0].id);
    expect(storage.getItem(LEGACY_OVERRIDES_KEY)).toBeNull();
  });

  it("存储读取抛错（隐私模式）时降级为空配置", () => {
    Object.defineProperty(globalThis, "window", {
      value: {
        localStorage: {
          getItem() {
            throw new Error("SecurityError");
          },
        },
      },
      configurable: true,
    });

    expect(loadStoredProfiles()).toEqual({ profiles: [], activeId: null });
  });

  it("写入最多保留 20 条，内置档案不写激活键", () => {
    const storage = useStorage();
    persistProfiles(
      Array.from({ length: 25 }, (_, index) => profile(`p${index}`)),
      ENV_PROFILE_ID,
    );

    expect(JSON.parse(storage.getItem(LLM_PROFILES_KEY) ?? "[]")).toHaveLength(
      20,
    );
    expect(storage.getItem(LLM_ACTIVE_PROFILE_KEY)).toBeNull();

    persistProfiles([profile("p1")], "p1");
    expect(storage.getItem(LLM_ACTIVE_PROFILE_KEY)).toBe("p1");
  });

  it("没有 window 时写入是静默 no-op", () => {
    expect(() => persistProfiles([profile("p1")], "p1")).not.toThrow();
  });
});
