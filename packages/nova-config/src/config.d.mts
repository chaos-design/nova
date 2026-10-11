/**
 * config.mjs 的类型声明。
 *
 * 实现是纯 ESM 的 .mjs（playground 里的 Agent 是普通 Node 进程，也要 import 它），
 * 因此类型单独放在这里交给 TypeScript 消费。两边的形状必须同步修改。
 */

/** 配置树：结构由 config.yaml 决定，这里只约束顶层分组 */
export interface NovaConfig {
  version: number;
  app: {
    name: string;
    port: number;
    hostname: string;
    env: string;
  };
  agent: {
    name: string;
    model: string;
    port: number;
    hostname: string;
    maxBodyBytes: number;
    llm: {
      baseUrl: string;
      model: string;
      maxTokens: number;
      temperature: number;
      timeoutMs: number;
      apiKey: string;
    };
    limits: {
      roundBudget: number;
      maxSearchAttempts: number;
      requiredSources: number;
    };
  };
  sandbox: {
    environment: "deterministic" | "stochastic" | "arena";
    maxSteps: number;
    maxDurationSeconds: number;
  };
  storage: {
    dir: string;
    file: string;
    maxRuns: number;
  };
  verification: {
    maxPromptChars: number;
    passScore: number;
    allowUnregistered: boolean;
  };
  release: {
    outDir: string;
    output: string;
    archiveFormat: string;
    preflight: {
      requireCleanTree: boolean;
      requireBranch: string;
      requireTests: boolean;
    };
    createGithubRelease: boolean;
  };
  test: {
    coverageDir: string;
    coverageThreshold: number;
    baseUrl: string;
    readyTimeoutMs: number;
  };
  logging: {
    level: string;
    echoPayload: boolean;
  };
}

export interface LoadConfigOptions {
  root?: string;
  file?: string;
  overlay?: unknown;
  overlayFile?: string;
  lookup?: (name: string) => string | undefined;
}

export interface LoadedConfig<T = NovaConfig> {
  value: T;
  /** 必填但缺失的环境变量名 */
  missing: string[];
  /** 实际读到的配置文件 */
  sources: string[];
}

export function parseEnvFile(content: string): Record<string, string>;
export function readEnvFile(root?: string): Record<string, string>;
export function projectRoot(): string;
export function buildEnvLookup(
  root?: string,
): (name: string) => string | undefined;
export function mergeConfig<T>(base: T, override: unknown): T;
export function readYamlFile(file: string): unknown;

/**
 * 加载配置。
 *
 * 默认是 NovaConfig；传入 overlay 做局部验证时可以指定自己的形状
 * （测试里常用），因此这里是泛型而不是写死。
 */
export function loadConfig<T = NovaConfig>(
  options?: LoadConfigOptions,
): LoadedConfig<T>;
export function getConfig(force?: boolean): NovaConfig;
export function getAgentConfig<T = NovaConfig>(
  agentDir: string,
): LoadedConfig<T>;
export function coerce(text: string): string | number | boolean | null;
export function configAt<T>(
  config: unknown,
  dottedPath: string,
  fallback?: T,
): T;
