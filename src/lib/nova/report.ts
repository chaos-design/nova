import { CAPABILITY_VECTORS, DEMO_EPOCH, NOVA_BRAND } from "./constants";
import { round } from "./format";
import { vectorScoreMap } from "./scoring";
import type {
  AgentProfile,
  NovaCertificate,
  NovaReport,
  VerificationRun,
} from "./types";

/** 报告结构版本，字段变更时必须同步递增 */
const REPORT_VERSION = "1.0.0";

/** FNV-1a 32 位散列，用于生成可复现的证书校验码 */
function checksum(input: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).toUpperCase().padStart(8, "0");
}

/** 生成 NOVA 证书 */
export function buildCertificate(agent: AgentProfile): NovaCertificate | null {
  if (!agent.certificateId) return null;

  return {
    id: agent.certificateId,
    agentId: agent.id,
    grade: agent.grade,
    compositeScore: agent.compositeScore,
    issuedAt: agent.lastVerifiedAt ?? DEMO_EPOCH,
    checksum: checksum(
      `${agent.id}:${agent.version}:${agent.compositeScore}:${agent.lastVerifiedAt}`,
    ),
    vectorSnapshot: vectorScoreMap(agent),
  };
}

/** 由档案批量生成证书 */
export function buildCertificates(
  agents: readonly AgentProfile[],
): NovaCertificate[] {
  return agents
    .map(buildCertificate)
    .filter((item): item is NovaCertificate => item !== null);
}

/**
 * 构建可下载的 JSON 评测报告。
 *
 * 报告是 NOVA 对外输出的唯一契约：字段稳定、可机读、可长期存档，
 * 因此评分快照与生命周期结果都在此固化，不依赖运行时的可变状态。
 */
export function buildReport(
  agent: AgentProfile,
  run: VerificationRun | null,
): NovaReport {
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: DEMO_EPOCH,
    generator: `${NOVA_BRAND.fullName} Console / ${NOVA_BRAND.expansion}`,
    standard: NOVA_BRAND.standard,
    agent: {
      id: agent.id,
      name: agent.name,
      codename: agent.codename,
      model: agent.model,
      version: agent.version,
    },
    verdict: {
      compositeScore: agent.compositeScore,
      grade: agent.grade,
      certificateId: agent.certificateId,
    },
    capabilities: CAPABILITY_VECTORS.map((meta) => {
      const score = agent.capabilities.find((item) => item.vector === meta.id);
      return {
        vector: meta.id,
        label: meta.label,
        weight: meta.weight,
        score: score?.score ?? 0,
        readings: score?.readings ?? [],
      };
    }),
    lifecycle: run
      ? run.stages.map((stage) => ({
          stage: stage.stage,
          state: stage.state,
          durationMs: stage.durationMs,
          summary: stage.summary,
        }))
      : [],
  };
}

/** 报告中的准确率口径：已通过场景 / 总场景 */
export function passRateOf(agent: AgentProfile): number {
  if (agent.scenarios.total === 0) return 0;
  return round((agent.scenarios.passed / agent.scenarios.total) * 100, 1);
}

/**
 * 触发浏览器下载（仅客户端可用）。
 *
 * 刻意不引入任何下载库：Blob + ObjectURL 是标准能力，
 * 一次性的十几行代码不值得一个依赖。
 */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
