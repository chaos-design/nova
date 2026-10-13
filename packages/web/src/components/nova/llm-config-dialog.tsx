"use client";

import { cn } from "cn";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ENV_PROFILE_ID, type LlmConnectionProfile } from "@/lib/nova";

/**
 * 全局大模型配置弹窗。
 *
 * 沙盒模拟器与对话验证共用的同一个弹窗：连接档案在浏览器本地增删改，
 * 列表视图切换激活档案，表单视图新增 / 编辑单条（端点、模型、密钥）。
 * 内置的「默认配置」不进存储、不可编辑删除，代表按 .env 与登记连接
 * 解析的兜底连接。
 */
export function LlmConfigDialog({
  open,
  onOpenChange,
  envProfile,
  profiles,
  activeProfileId,
  onSelect,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 内置默认档案：列表首项与表单占位符的来源 */
  envProfile: LlmConnectionProfile;
  profiles: readonly LlmConnectionProfile[];
  /** null = 激活的是内置默认档案 */
  activeProfileId: string | null;
  onSelect: (id: string) => void;
  onSave: (profile: LlmConnectionProfile) => void;
  onDelete: (id: string) => void;
}) {
  // null = 列表视图；{ id } = 新增（无 id）或编辑（有 id）表单视图
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const envActive =
    activeProfileId === null || activeProfileId === ENV_PROFILE_ID;

  // 打开弹窗 / 进入表单时预填
  useEffect(() => {
    if (!open) {
      setEditing(null);
      return;
    }
    if (editing) {
      const existing = editing.id
        ? profiles.find((item) => item.id === editing.id)
        : undefined;
      setName(existing?.name ?? `配置 ${profiles.length + 1}`);
      setEndpoint(existing?.endpoint ?? envProfile.endpoint);
      setModel(existing?.model ?? envProfile.model);
      setApiKey(existing?.apiKey ?? "");
      setErrors({});
    }
  }, [open, editing, profiles, envProfile]);

  // 必填校验：名称 / 端点 / 模型缺一不可，错误内联提示
  const validate = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "配置名称为必填项";
    if (!endpoint.trim()) next.endpoint = "端点为必填项";
    else if (!/^https?:\/\//.test(endpoint.trim()))
      next.endpoint = "端点必须以 http:// 或 https:// 开头";
    if (!model.trim()) next.model = "模型标识为必填项";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = () => {
    if (!validate()) return;
    onSave({
      id: editing?.id ?? `profile-${Date.now()}`,
      name: name.trim(),
      endpoint: endpoint.trim(),
      model: model.trim(),
      apiKey: apiKey.trim() || undefined,
    });
    setEditing(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">大模型配置</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            沙盒模拟器与对话验证共用这份全局配置；保存在浏览器本地，密钥留空则使用
            默认配置。带
            <span aria-hidden="true" className="mx-0.5 text-nova-rose">
              *
            </span>
            为必填项。
          </DialogDescription>
        </DialogHeader>

        {editing ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-name" className="text-xs">
                配置名称
                <span aria-hidden="true" className="ml-0.5 text-nova-rose">
                  *
                </span>
              </Label>
              <Input
                id="cfg-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="如：Agnes 直连 / 本地 Ollama"
                className="h-8 text-xs"
              />
              {errors.name && (
                <p className="text-[0.625rem] text-nova-rose">{errors.name}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-endpoint" className="text-xs">
                端点
                <span aria-hidden="true" className="ml-0.5 text-nova-rose">
                  *
                </span>
              </Label>
              <Input
                id="cfg-endpoint"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder="https://api.example.com/v1"
                className="h-8 font-mono text-xs"
              />
              {errors.endpoint && (
                <p className="text-[0.625rem] text-nova-rose">
                  {errors.endpoint}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-model" className="text-xs">
                模型标识
                <span aria-hidden="true" className="ml-0.5 text-nova-rose">
                  *
                </span>
              </Label>
              <Input
                id="cfg-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="agnes-3.0-flash / gpt-4o-mini / …"
                className="h-8 font-mono text-xs"
              />
              {errors.model && (
                <p className="text-[0.625rem] text-nova-rose">{errors.model}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-api-key" className="text-xs">
                密钥（可选，留空使用默认配置）
              </Label>
              <Input
                id="cfg-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                className="h-8 font-mono text-xs"
                autoComplete="off"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => onSelect(ENV_PROFILE_ID)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                envActive
                  ? "border-nova-accent/40 bg-nova-accent/8"
                  : "border-white/8 bg-white/2 hover:border-white/15",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">
                  默认配置
                  {envActive && (
                    <span className="nova-mono-label ml-2 text-[0.5625rem] text-nova-accent">
                      当前
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate font-mono text-[0.625rem] text-muted-foreground">
                  {envProfile.model} · {envProfile.endpoint || "沿用登记连接"}
                </p>
              </div>
            </button>

            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={cn(
                  "flex items-center gap-1 rounded-lg border px-3 py-2 transition-colors",
                  activeProfileId === profile.id
                    ? "border-nova-accent/40 bg-nova-accent/8"
                    : "border-white/8 bg-white/2",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(profile.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-xs font-medium">
                    {profile.name}
                    {activeProfileId === profile.id && (
                      <span className="nova-mono-label ml-2 text-[0.5625rem] text-nova-accent">
                        当前
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[0.625rem] text-muted-foreground">
                    {profile.model} · {profile.endpoint}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`编辑 ${profile.name}`}
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditing({ id: profile.id })}
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`删除 ${profile.name}`}
                  className="size-6 text-muted-foreground hover:text-nova-rose"
                  onClick={() => onDelete(profile.id)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => setEditing({})}
            >
              <Plus />
              新增配置
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2">
          {editing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => setEditing(null)}
              >
                取消
              </Button>
              <Button size="sm" className="text-xs" onClick={save}>
                保存
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={() => onOpenChange(false)}
            >
              关闭
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
