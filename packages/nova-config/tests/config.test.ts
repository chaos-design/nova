import {
  buildEnvLookup,
  coerce,
  loadConfig,
  mergeConfig,
  parseEnvFile,
  projectRoot,
} from "@chaos-design/config";
import { afterEach, describe, expect, it } from "vitest";

/**
 * 配置加载器的单元测试。
 *
 * 这里刻意不读真实文件（除了最后一组），全部用注入的 lookup 驱动：
 * 配置语义必须可脱离机器环境验证，否则换个环境结论就变了 ——
 * 那恰恰是"与具体环境解耦"要解决的问题。
 */

describe("parseEnvFile", () => {
  it("解析 KEY=VALUE，忽略注释与空行", () => {
    const parsed = parseEnvFile(`
# 这是注释
NOVA_DEV_PORT=3300

NOVA_AGENT_NAME=nova-local
`);

    expect(parsed).toEqual({
      NOVA_DEV_PORT: "3300",
      NOVA_AGENT_NAME: "nova-local",
    });
  });

  it("支持 export 前缀与成对引号", () => {
    const parsed = parseEnvFile(`
export NOVA_A="quoted value"
NOVA_B='single quoted'
`);

    expect(parsed).toEqual({
      NOVA_A: "quoted value",
      NOVA_B: "single quoted",
    });
  });

  it("剥离未加引号时的行尾注释，但保留 # 本身是值的情况", () => {
    const parsed = parseEnvFile(`
NOVA_A=value # 这是注释
NOVA_B="#notacomment"
`);

    expect(parsed.NOVA_A).toBe("value");
    expect(parsed.NOVA_B).toBe("#notacomment");
  });

  it("没有等号的行被忽略", () => {
    expect(parseEnvFile("NOT_A_PAIR\nNOVA_OK=1")).toEqual({ NOVA_OK: "1" });
  });
});

describe("buildEnvLookup", () => {
  it("进程环境变量优先于 .env 文件", () => {
    const saved = process.env.NOVA_TEST_PRECEDENCE;
    process.env.NOVA_TEST_PRECEDENCE = "from-process";

    // 直接构造 lookup：文件里有值，但进程里也有 → 进程赢
    const fileEnv: Record<string, string> = {
      NOVA_TEST_PRECEDENCE: "from-file",
    };
    const lookup = (name: string) => process.env[name] ?? fileEnv[name];

    expect(lookup("NOVA_TEST_PRECEDENCE")).toBe("from-process");

    if (saved === undefined) delete process.env.NOVA_TEST_PRECEDENCE;
    else process.env.NOVA_TEST_PRECEDENCE = saved;
  });

  it("两侧都没有时返回 undefined", () => {
    const lookup = buildEnvLookup("/nonexistent-root-for-test");
    expect(lookup("NOVA_DEFINITELY_UNSET_VAR")).toBeUndefined();
  });
});

/**
 * 带形状的加载助手。
 *
 * 单测里喂的是局部配置片段（不是完整的 NovaConfig），
 * 因此显式指定泛型，让断言拿到准确的字段类型。
 */
function loadWith<T>(
  overlay: T,
  lookup?: (name: string) => string | undefined,
) {
  return loadConfig<T>({ overlay, lookup });
}

describe("loadConfig 的插值", () => {
  const base = {
    port: "${NOVA_TEST_PORT:-3234}",
    url: "${NOVA_TEST_URL:-http://127.0.0.1:43110/v1}",
    flag: "${NOVA_TEST_FLAG:-true}",
    secret: "${NOVA_TEST_SECRET}",
    nested: { deep: "${NOVA_TEST_PORT:-3234}" },
  };

  it("缺省时取冒号后的默认值", () => {
    const { value, missing } = loadWith(base, () => undefined);

    expect(value.port).toBe(3234);
    expect(value.url).toBe("http://127.0.0.1:43110/v1");
    expect(value.flag).toBe(true);
    expect(value.nested.deep).toBe(3234);
    // secret 没有默认值 → 记为缺失
    expect(missing).toContain("NOVA_TEST_SECRET");
  });

  it("有环境变量时覆盖默认值，并还原成真实类型", () => {
    const env: Record<string, string> = {
      NOVA_TEST_PORT: "4400",
      NOVA_TEST_URL: "http://example.invalid/v1",
      NOVA_TEST_FLAG: "false",
      NOVA_TEST_SECRET: "s3cr3t",
    };

    const { value, missing } = loadWith(base, (name: string) => env[name]);

    expect(value.port).toBe(4400); // 数字，不是字符串
    expect(value.flag).toBe(false); // 布尔，不是字符串
    expect(value.url).toBe("http://example.invalid/v1");
    expect(value.secret).toBe("s3cr3t");
    expect(missing).toEqual([]);
  });

  it("空字符串环境变量会回落到默认值，而不是填成空值", () => {
    const { value } = loadWith({ port: "${NOVA_TEST_PORT:-3234}" }, () => "");

    expect(value.port).toBe(3234);
  });
});

describe("mergeConfig", () => {
  it("后者覆盖前者，对象递归合并", () => {
    const merged = mergeConfig(
      { agent: { port: 43110, model: "a" }, keep: 1 },
      { agent: { model: "b" } },
    );

    expect(merged).toEqual({ agent: { port: 43110, model: "b" }, keep: 1 });
  });

  it("数组整体替换而不是按下标合并", () => {
    expect(mergeConfig({ list: [1, 2, 3] }, { list: [9] })).toEqual({
      list: [9],
    });
  });

  it("override 为 undefined 时原样返回 base", () => {
    expect(mergeConfig({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
});

describe("真实配置文件", () => {
  it("项目根的 config.yaml 能被加载且必填项齐全", () => {
    const { value, missing } = loadConfig();

    expect(missing).toEqual([]);
    expect(value.app.port).toBeGreaterThan(0);
    expect(value.agent.port).toBeGreaterThan(0);
    expect(value.agent.limits.requiredSources).toBeGreaterThan(0);
    // 密钥不应出现在配置里被写死：要么来自环境变量，要么为空
    expect(typeof value.agent.llm.apiKey).toBe("string");
  });

  it("projectRoot 指向含 config.yaml 的目录", () => {
    expect(projectRoot()).toContain("nova");
  });
});

describe("projectRoot 的根目录覆盖链", () => {
  const saved = {
    NOVA_ROOT: process.env.NOVA_ROOT,
    VERCEL_PATH: process.env.VERCEL_PATH,
  };

  afterEach(() => {
    delete process.env.NOVA_ROOT;
    delete process.env.VERCEL_PATH;
    if (saved.NOVA_ROOT !== undefined) process.env.NOVA_ROOT = saved.NOVA_ROOT;
    if (saved.VERCEL_PATH !== undefined)
      process.env.VERCEL_PATH = saved.VERCEL_PATH;
  });

  it("VERCEL_PATH 存在时直接作为根（函数运行目录），不再向上探测", () => {
    process.env.VERCEL_PATH = "/var/task/some-function";
    expect(projectRoot()).toBe("/var/task/some-function");
  });

  it("NOVA_ROOT 优先级高于 VERCEL_PATH", () => {
    process.env.NOVA_ROOT = "/custom/root";
    process.env.VERCEL_PATH = "/var/task/some-function";
    expect(projectRoot()).toBe("/custom/root");
  });

  it("两者都未设置时退回向上探测 workspace 标记", () => {
    expect(projectRoot()).toContain("nova");
  });
});

describe("标量类型还原", () => {
  it("数字字符串还原为数字、布尔字符串还原为布尔", () => {
    const { value } = loadWith(
      { n: "${NOVA_X:-42}", b: "${NOVA_X:-false}", s: "${NOVA_X:-abc}" },
      () => undefined,
    );

    expect(value.n).toBe(42);
    expect(value.b).toBe(false);
    expect(value.s).toBe("abc");
  });

  it("coerce 处理整数、浮点、布尔与空值", () => {
    expect(coerce("42")).toBe(42);
    expect(coerce("3.14")).toBe(3.14);
    expect(coerce("true")).toBe(true);
    expect(coerce("null")).toBeNull();
    expect(coerce("abc")).toBe("abc");
  });
});
