import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { ConverseLab } from "@/components/nova/converse-lab";
import { LOCAL_AGENTS, localAgentProfile } from "@/lib/nova";

export const metadata: Metadata = {
  title: "对话验证",
  description:
    "向已登记的 Agent 发送消息，实时观察它的回复、工具调用、注入免疫与 token 成本。纯观测路径：不产生评分，不进排行榜。",
};

/** Agent 由本地登记派生，读的是运行时登记，按请求渲染 */
export const dynamic = "force-dynamic";

/**
 * 对话验证（Converse Lab）。
 *
 * 布局验证优先：主栏是逐轮验证记录，配置、用例与口径说明
 * 收敛在左侧旁置模块（见 `ConverseLab`）。页面本身只做取数与页头。
 */
export default function ConversePage() {
  const agents = LOCAL_AGENTS.map(localAgentProfile);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Converse Lab"
        title="对话验证"
        subtitle="从左侧验证用例发起或自定义输入，每轮生成一张验证卡：Agent 回复、工具调用、注入判定与 token 成本全部来自服务端真实执行，读不到就如实显示「尚未执行」，没有 mock 回复。"
      />

      <ConverseLab agents={agents} localAgents={LOCAL_AGENTS} />
    </div>
  );
}
