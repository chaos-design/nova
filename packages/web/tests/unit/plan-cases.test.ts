import { describe, expect, it } from "vitest";
import {
  CONVERSE_CASES,
  converseCaseByKey,
  QUICK_VERIFY_CASE_KEY,
} from "@/lib/nova";

/**
 * [V-10] 用例清单与深链契约。
 *
 * 用例面板与 `?case=` 深链共用这一份常量：key 撞车或空文案会让面板
 * 出现点不动的按钮，或者深链落到一条没有内容的用例上。
 */

describe("[V-10] 用例清单与深链契约", () => {
  it("key 唯一、非空且是稳定的英文标识", () => {
    const keys = CONVERSE_CASES.map((item) => item.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*$/);
    }
  });

  it("每条用例的标题、目标、描述与消息都不为空", () => {
    for (const item of CONVERSE_CASES) {
      for (const field of ["title", "target", "description", "text"] as const) {
        expect(item[field].trim().length).toBeGreaterThan(0);
        expect(item[field]).toBe(item[field].trim());
      }
    }
  });

  it("高危用例显式标记，普通用例不误标", () => {
    const danger = CONVERSE_CASES.filter((item) => item.danger).map(
      (item) => item.key,
    );
    expect(danger).toEqual(["injection", "hallucination"]);
  });

  it("追问类用例必须先完成一轮，且只有它带该标记", () => {
    const followups = CONVERSE_CASES.filter(
      (item) => item.requiresCompletedTurn,
    ).map((item) => item.key);

    expect(followups).toEqual(["followup"]);
  });

  it("按 key 查用例返回同一条定义，未知 key 返回 null", () => {
    for (const item of CONVERSE_CASES) {
      expect(converseCaseByKey(item.key)).toBe(item);
    }
    expect(converseCaseByKey("nope")).toBeNull();
    expect(converseCaseByKey("")).toBeNull();
  });

  it("快捷验证键存在、可自动发起，且不是高危用例", () => {
    const quick = converseCaseByKey(QUICK_VERIFY_CASE_KEY);

    expect(quick).not.toBeNull();
    expect(quick?.requiresCompletedTurn).toBeUndefined();
    expect(quick?.danger).toBeUndefined();
  });

  it("用例集合与快照一致（增删用例必须显式改这份契约）", () => {
    expect(CONVERSE_CASES.map((item) => item.key)).toEqual([
      "research",
      "tripPlan",
      "copyStats",
      "followup",
      "injection",
      "promptLeak",
      "hallucination",
      "format",
      "retry",
    ]);
  });
});
