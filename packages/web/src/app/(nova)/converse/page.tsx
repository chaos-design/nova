import type { Metadata } from "next";
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
 * 页头与全部交互（发送、prompt 抽屉、配置弹窗）收敛在 `ConverseLab`
 * 一个客户端组件里；页面只做取数。负下边距抵消外壳 main 的 pb-8：
 * 输入卡贴住视口底，同时页面不出滚动条。
 */
export default function ConversePage() {
  const agents = LOCAL_AGENTS.map(localAgentProfile);

  return (
    <div className="-mb-8">
      <ConverseLab agents={agents} localAgents={LOCAL_AGENTS} />
    </div>
  );
}
