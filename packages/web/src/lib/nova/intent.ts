/**
 * 意图分类的领域层（纯逻辑，无 server-only）。
 *
 * 意图分发只回答一个问题：「这条消息最该发给哪个候选 Agent」。
 * 分类调用与请求转发在服务端 route（`/api/agents/intent`、
 * `/api/agents/dispatch`），这里沉淀的是它们共用的形状、上限与
 * 解析/提示词构造的纯函数 —— 服务端与单测共享同一份实现，
 * 兜底语义（单发，绝不广播）因此只有一处定义。
 */

/** 意图分类的单个候选 */
export interface IntentCandidate {
  /** 稳定主键，形如 `agt-local-research` */
  id: string;
  /** 英文代号，如 `NOVA-RESEARCH` */
  name: string;
  /** 模型标识：分类提示词里的辅助线索（如 nova-research-agent） */
  model?: string;
  /**
   * 领域描述（来自登记条目的 tagline）。
   *
   * 只有 id/name/model 时，分类器只能靠代号猜边界；领域描述
   * 把「调研专员做什么、工程搭档做什么」写进提示词，是多候选
   * 场景下分类准确率的主要来源。
   */
  description?: string;
}

/** 意图分类的解析结论 */
export interface IntentResolution {
  /** 命中的候选 id */
  agentId: string;
  /** 模型原始输出（诊断与界面提示用） */
  output: string;
  /** 命中方式：id 原文 / 名称 / 兜底首个候选 */
  matchedBy: "id" | "name" | "fallback";
}

/** 用户消息参与分类的最大长度：分类只需要意图，不需要全文 */
export const INTENT_MAX_TEXT_CHARS = 2_000;

/** 候选数量上限：超过后提示词膨胀且分类质量下降 */
export const INTENT_MAX_AGENTS = 10;

/** 单条领域描述的截断长度 */
export const INTENT_DESCRIPTION_MAX_CHARS = 200;

/** 单次分类的超时（毫秒）：分类挂起时整个转发链路都在等它 */
export const INTENT_TIMEOUT_MS = 15_000;

/**
 * 解析分类输出，从候选里确定唯一目标。
 *
 * 解析逐级放宽：精确等于 id → 包含 id（取最长）→ 包含名称（取最长）→
 * 兜底落第一个候选。取最长是为了避免候选 id 互为前缀时短 id 抢先命中。
 * 兜底**绝不广播**——意图分发的语义是单发，宁可单调也不能把同一
 * 问题重复投递给多个 Agent。匹配不区分大小写：模型回 `NOVA-RESEARCH`
 * 或 `nova-research-agent`（含名称前缀的模型 id）都能命中对应候选。
 *
 * 候选为空返回 null（调用方在此之前的校验保证非空，这里兜住类型）。
 */
export function parseIntentOutput(
  output: string,
  candidates: readonly IntentCandidate[],
): IntentResolution | null {
  if (candidates.length === 0) return null;

  const text = output.trim();

  // 精确命中优先：模型按提示词只回 id 时，这一步就该结束，
  // 不进入包含匹配（否则 id 互为子串时会被更短的候选抢走）
  const exact = candidates.find(
    (item) => item.id.length > 0 && sameIgnoreCase(text, item.id),
  );
  if (exact) return { agentId: exact.id, output: text, matchedBy: "id" };

  // 包含匹配取**最长**命中：`agt-local-a` 与 `agt-local-ab` 同时出现在
  // 候选里时，`agt-local-ab` 的输出必须落到长 id，而不是数组里靠前的短 id
  const hitById = mostSpecificHit(text, candidates, (item) => item.id);
  if (hitById) return { agentId: hitById.id, output: text, matchedBy: "id" };

  const hitByName = mostSpecificHit(text, candidates, (item) => item.name);
  if (hitByName)
    return { agentId: hitByName.id, output: text, matchedBy: "name" };

  return { agentId: candidates[0].id, output: text, matchedBy: "fallback" };
}

/** 包含匹配：命中多个时取待匹配串最长的那个（更具体），等长取靠前者 */
function mostSpecificHit(
  text: string,
  candidates: readonly IntentCandidate[],
  select: (candidate: IntentCandidate) => string,
): IntentCandidate | null {
  let best: IntentCandidate | null = null;
  let bestLength = 0;

  for (const candidate of candidates) {
    const needle = select(candidate);
    if (needle.length === 0 || !includesIgnoreCase(text, needle)) continue;
    if (needle.length > bestLength) {
      best = candidate;
      bestLength = needle.length;
    }
  }

  return best;
}

/**
 * 请求体里的候选清单整形：截断、补默认 id、丢弃无辨识度的条目。
 *
 * 候选来自客户端，字段全部按不可信输入处理；name 与 model 都为空的
 * 条目对分类没有贡献，直接丢弃。
 */
export function sanitizeIntentCandidates(raw: unknown): IntentCandidate[] {
  const list = Array.isArray(raw) ? raw : [];

  return list
    .slice(0, INTENT_MAX_AGENTS)
    .map((item, index) => {
      const record = (
        typeof item === "object" && item !== null ? item : {}
      ) as Record<string, unknown>;

      const id =
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim().slice(0, 120)
          : `agent-${index}`;
      const name =
        typeof record.name === "string" ? record.name.trim().slice(0, 120) : "";
      const model =
        typeof record.model === "string"
          ? record.model.trim().slice(0, 120)
          : "";
      const description =
        typeof record.description === "string" && record.description.trim()
          ? record.description.trim().slice(0, INTENT_DESCRIPTION_MAX_CHARS)
          : "";

      return { id, name, model, description };
    })
    .filter((item) => item.name || item.model || item.description)
    .map((item) => ({
      id: item.id,
      name: item.name,
      ...(item.model ? { model: item.model } : {}),
      ...(item.description ? { description: item.description } : {}),
    }));
}

/**
 * 构造分类提示词。
 *
 * 系统侧写死判定规则与输出格式；用户侧拼候选清单（含领域描述）与
 * 消息原文。领域描述是可选的：没传时候选行退化为 id + 名称 + 模型，
 * 与历史行为一致。
 */
export function buildIntentPrompt(
  text: string,
  candidates: readonly IntentCandidate[],
): { system: string; user: string } {
  const candidateText = candidates
    .map((item) => {
      const head = `- id=${item.id} 名称=${item.name}${item.model ? ` 模型=${item.model}` : ""}`;
      return item.description ? `${head}\n  领域：${item.description}` : head;
    })
    .join("\n");

  return {
    system:
      "你是任务分发器。根据用户消息的意图，从候选 Agent 中选出最合适的一个。" +
      "候选清单里的「领域」是各自的职责边界，优先按领域匹配：" +
      "消息落进哪个领域就选哪个 Agent；没有任何领域匹配时选第一个。" +
      "只输出该 Agent 的 id 原文（形如 agt-local-xxx），禁止输出名称、解释、标点或其他任何文字。",
    user: `候选 Agent：\n${candidateText}\n\n用户消息：${text.slice(0, INTENT_MAX_TEXT_CHARS)}\n\n只输出最合适候选的 id。`,
  };
}

function includesIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function sameIgnoreCase(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** 分类器形状：dispatch 路由只依赖这一个调用签名，便于注入桩做单测 */
export type IntentClassifier = (
  text: string,
  candidates: readonly IntentCandidate[],
) => Promise<IntentResolution>;

/**
 * 意图分发的路由决策：单候选直落，多候选分类、失败兜底首个。
 *
 * 把「兜底单发」的接线从 dispatch route 里抽出来，让这条关键
 * 语义可以脱离 server-only 模块做单测（真实分类器由调用方注入，
 * 路由本身只关心：分类给出什么就用什么；分类挂了就单发首个并
 * 标注 fallback——绝不广播）。
 */
export async function resolveDispatchTarget(
  text: string,
  candidates: readonly IntentCandidate[],
  classify: IntentClassifier,
): Promise<{ agentId: string; fallback: boolean }> {
  if (candidates.length <= 1) {
    // 单候选没有分类价值：直接返回，省一次模型调用
    return { agentId: candidates[0].id, fallback: false };
  }

  try {
    const resolved = await classify(text, candidates);
    // 分类器是可注入的边界：它给出的目标必须落在候选清单内，
    // 否则下游按 id 反查会落空（dispatch 路由会变成 500）。越界即兜底。
    const hit = candidates.find((item) => item.id === resolved.agentId);
    if (!hit) return { agentId: candidates[0].id, fallback: true };
    return { agentId: hit.id, fallback: false };
  } catch {
    return { agentId: candidates[0].id, fallback: true };
  }
}
