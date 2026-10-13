import type { ConverseOverrides } from "./executor";
import { normalizeEndpoint } from "./local-agents";

/**
 * 全局大模型连接配置。
 *
 * 为什么放在领域层：沙盒模拟器与对话验证必须连**同一个**大模型，
 * 否则两条路径跑的根本不是一件事 —— 对话验证里调通的端点，到了沙盒
 * 就换了模型，观测结论无法互相印证。因此档案只有一份，存在浏览器
 * localStorage，两个页面共用（`useLlmProfiles`）。
 *
 * 默认项不出现在存储里，也不可编辑删除：它代表「服务端按本地 .env
 * （NOVA_LLM_BASE_URL / NOVA_LLM_MODEL）与目标 Agent 登记连接解析」，
 * 即"不做任何覆盖"。自定义档案才会随请求下发 overrides。
 *
 * 密钥永不进存储明文以外的地方：档案里的 apiKey 留空即沿用 .env 的
 * NOVA_LLM_API_KEY；服务端只在本次请求内使用，不落任何存储。
 */

/** 一条大模型连接档案（浏览器本地管理） */
export interface LlmConnectionProfile {
  id: string;
  /** 展示名，如「默认配置」「Agnes 直连」 */
  name: string;
  endpoint: string;
  model: string;
  /** 留空 = 沿用 .env 的 NOVA_LLM_API_KEY */
  apiKey?: string;
}

/**
 * 内置档案 id：代表"无覆盖"。
 *
 * 沙盒侧无覆盖 = 沿用目标 Agent 登记的端点与模型（AGNES 系列的登记值
 * 本身就读自 .env 的 NOVA_LLM_*）；对话验证侧无覆盖 = 同样落到登记值。
 */
export const ENV_PROFILE_ID = "__env__";

/** 全局存储键：沙盒与对话验证共用同一份档案，改名等于清空用户配置 */
export const LLM_PROFILES_KEY = "nova:llm:profiles";
export const LLM_ACTIVE_PROFILE_KEY = "nova:llm:active-profile";

/** 旧版对话验证私有键：读到即迁移到全局键，之后废弃 */
const LEGACY_PROFILES_KEY = "nova:converse:profiles";
const LEGACY_ACTIVE_KEY = "nova:converse:active-profile";
const LEGACY_OVERRIDES_KEY = "nova:converse:agent-overrides";

/** 存储上限：档案是人工维护的连接配置，超过一屏就该整理了 */
const MAX_PROFILES = 20;
const MAX_NAME_CHARS = 60;
const MAX_ENDPOINT_CHARS = 300;
const MAX_MODEL_CHARS = 120;
const MAX_API_KEY_CHARS = 300;

/** 由服务端从本地 .env 解析出的默认连接（密钥不下发） */
export interface LlmEnvDefault {
  endpoint: string;
  model: string;
}

/** 内置默认档案：仅用于展示与"无覆盖"判定，不进 localStorage */
export function envProfileOf(defaults: LlmEnvDefault): LlmConnectionProfile {
  return {
    id: ENV_PROFILE_ID,
    name: "默认配置",
    endpoint: normalizeEndpoint(defaults.endpoint),
    model: defaults.model,
  };
}

/**
 * 档案 → 随请求下发的覆盖值。
 *
 * 内置档案即「无覆盖」：端点、模型、密钥全部交给服务端按登记条目与
 * .env 解析，客户端不越过这条线。
 */
export function profileOverrides(
  profile: LlmConnectionProfile,
): ConverseOverrides {
  if (profile.id === ENV_PROFILE_ID) return {};
  return {
    endpoint: normalizeEndpoint(profile.endpoint),
    model: profile.model,
    ...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
  };
}

/** 逐字段裁剪一条外部数据（存储可能被手工改坏，也可能是旧版本写的） */
export function sanitizeProfile(raw: unknown): LlmConnectionProfile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  // 内置档案 id 是保留值：存储里出现一律丢弃，避免伪造"无覆盖"
  if (!id || id === ENV_PROFILE_ID || !name) return null;

  return {
    id: id.slice(0, MAX_NAME_CHARS),
    name: name.slice(0, MAX_NAME_CHARS),
    endpoint:
      typeof record.endpoint === "string"
        ? record.endpoint.trim().slice(0, MAX_ENDPOINT_CHARS)
        : "",
    model:
      typeof record.model === "string"
        ? record.model.trim().slice(0, MAX_MODEL_CHARS)
        : "",
    ...(typeof record.apiKey === "string" && record.apiKey.trim()
      ? { apiKey: record.apiKey.trim().slice(0, MAX_API_KEY_CHARS) }
      : {}),
  };
}

/** 从 localStorage 读档案与激活 id；损坏或缺失一律回退为空 */
export function loadStoredProfiles(): {
  profiles: LlmConnectionProfile[];
  activeId: string | null;
} {
  if (typeof window === "undefined") return { profiles: [], activeId: null };

  try {
    const storage = window.localStorage;
    const raw = storage.getItem(LLM_PROFILES_KEY);
    const profiles = parseProfiles(raw ? safeParse(raw) : []);

    // 旧版对话验证私有键：迁移到全局键，之后废弃（只做一次）
    if (profiles.length === 0) {
      const legacyProfiles = parseProfiles(
        safeParse(storage.getItem(LEGACY_PROFILES_KEY) ?? "null"),
      );
      const legacyOverrides = parseLegacyOverrides(
        storage.getItem(LEGACY_OVERRIDES_KEY),
      );
      const migrated =
        legacyProfiles.length > 0
          ? legacyProfiles
          : legacyOverrides
            ? [legacyOverrides]
            : [];

      if (migrated.length > 0) {
        const activeId =
          storage.getItem(LEGACY_ACTIVE_KEY) ??
          (legacyOverrides ? legacyOverrides.id : null);
        persistProfiles(migrated, activeId);
        storage.removeItem(LEGACY_PROFILES_KEY);
        storage.removeItem(LEGACY_ACTIVE_KEY);
        storage.removeItem(LEGACY_OVERRIDES_KEY);
        return {
          profiles: migrated,
          activeId: migrated.some((item) => item.id === activeId)
            ? activeId
            : null,
        };
      }
    }

    const activeId = storage.getItem(LLM_ACTIVE_PROFILE_KEY);
    return {
      profiles,
      activeId: profiles.some((item) => item.id === activeId) ? activeId : null,
    };
  } catch {
    // 隐私模式 / 配额满：配置只在本次会话生效
    return { profiles: [], activeId: null };
  }
}

/** 全量覆写档案与激活项；写不进去只影响下次打开 */
export function persistProfiles(
  profiles: readonly LlmConnectionProfile[],
  activeId: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LLM_PROFILES_KEY,
      JSON.stringify(profiles.slice(0, MAX_PROFILES)),
    );
    if (activeId && activeId !== ENV_PROFILE_ID) {
      window.localStorage.setItem(LLM_ACTIVE_PROFILE_KEY, activeId);
    } else {
      window.localStorage.removeItem(LLM_ACTIVE_PROFILE_KEY);
    }
  } catch {
    // 隐私模式 / 配额满
  }
}

/** 解析数组形态的档案列表；逐条过 sanitize，丢弃不合法项 */
function parseProfiles(raw: unknown): LlmConnectionProfile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(sanitizeProfile)
    .filter((item): item is LlmConnectionProfile => item !== null)
    .slice(0, MAX_PROFILES);
}

/** 旧版单配置形态（{ endpoint, model, apiKey }）→ 一条档案 */
function parseLegacyOverrides(raw: string | null): LlmConnectionProfile | null {
  if (!raw) return null;
  const parsed = safeParse(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (!record.endpoint || !record.model) return null;
  return sanitizeProfile({
    id: `profile-${Date.now()}`,
    name: "自定义配置",
    endpoint: record.endpoint,
    model: record.model,
    apiKey: record.apiKey,
  });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
