"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ConverseOverrides,
  ENV_PROFILE_ID,
  envProfileOf,
  type LlmConnectionProfile,
  type LlmEnvDefault,
  loadStoredProfiles,
  persistProfiles,
  profileOverrides,
} from "@/lib/nova";

/**
 * 全局大模型连接配置的状态机。
 *
 * 沙盒模拟器与对话验证共用同一个 hook，读写的是同一份 localStorage 键，
 * 因此在一处新增的档案，另一处立刻可见 —— 这正是"全局配置"的含义：
 * 两条验证路径不会各自指向不同的模型。
 *
 * 首帧与 SSR 一致（只有内置默认档案），挂载后再读 localStorage，
 * 避免 hydration 不一致；存储里的人为损坏由领域层 sanitize 兜住。
 */
export function useLlmProfiles(defaults: LlmEnvDefault) {
  // 依赖按原始值取：服务端每次渲染都会传新的对象字面量，
  // 以对象为依赖会让 memo 恒失效（并让 useExhaustiveDependencies 报缺失）
  const { endpoint, model } = defaults;
  const [profiles, setProfiles] = useState<LlmConnectionProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  useEffect(() => {
    const stored = loadStoredProfiles();
    setProfiles(stored.profiles);
    setActiveProfileId(stored.activeId);
  }, []);

  const envProfile = useMemo(
    () => envProfileOf({ endpoint, model }),
    [endpoint, model],
  );

  const allProfiles = useMemo(
    () => [envProfile, ...profiles],
    [envProfile, profiles],
  );

  const activeProfile =
    allProfiles.find((item) => item.id === activeProfileId) ?? envProfile;

  /** 本轮请求随 body 下发的覆盖值；内置档案即为「无覆盖」 */
  const overrides: ConverseOverrides = useMemo(
    () => profileOverrides(activeProfile),
    [activeProfile],
  );

  const commit = useCallback(
    (next: LlmConnectionProfile[], activeId: string | null) => {
      setProfiles(next);
      setActiveProfileId(activeId);
      persistProfiles(next, activeId);
    },
    [],
  );

  /** 切换激活档案；是否清空会话由调用方决定（沙盒没有会话概念） */
  const selectProfile = useCallback(
    (id: string) => {
      const exists =
        id === ENV_PROFILE_ID || profiles.some((item) => item.id === id);
      if (!exists) return;
      setActiveProfileId(id === ENV_PROFILE_ID ? null : id);
      persistProfiles(profiles, id);
    },
    [profiles],
  );

  /** 新增或编辑一条档案；保存后即激活，刚填的配置就是用户想用的 */
  const saveProfile = useCallback(
    (profile: LlmConnectionProfile) => {
      const exists = profiles.some((item) => item.id === profile.id);
      const next = exists
        ? profiles.map((item) => (item.id === profile.id ? profile : item))
        : [...profiles, profile];
      commit(next, profile.id);
    },
    [profiles, commit],
  );

  const deleteProfile = useCallback(
    (id: string) => {
      commit(
        profiles.filter((item) => item.id !== id),
        activeProfileId === id ? null : activeProfileId,
      );
    },
    [profiles, activeProfileId, commit],
  );

  /** 是否为自定义（有覆盖）连接：界面据此提示"本次实际调用哪里" */
  const overridden = activeProfile.id !== ENV_PROFILE_ID;

  return {
    /** 内置默认档案（.env / 登记连接），配置弹窗的列表首项 */
    envProfile,
    /** 用户自定义档案（不含内置默认） */
    profiles,
    /** 内置默认 + 自定义，供下拉与弹窗统一渲染 */
    allProfiles,
    activeProfile,
    activeProfileId,
    overrides,
    overridden,
    selectProfile,
    saveProfile,
    deleteProfile,
  };
}
