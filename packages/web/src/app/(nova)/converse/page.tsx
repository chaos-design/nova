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
 *
 * 快捷验证深链：`/converse?agent=<id>&case=<key>` —— 档案卡的
 * 「快捷验证」入口指向这里，服务端解析参数后作为 props 下发
 * （客户端组件不直接读 URL，保持首屏数据全由服务端传入的约定）。
 */
export default async function ConversePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const agentParam =
    typeof params.agent === "string" ? params.agent : undefined;
  const caseParam = typeof params.case === "string" ? params.case : undefined;

  const agents = LOCAL_AGENTS.map(localAgentProfile);

  return (
    <div className="-mb-8">
      <ConverseLab
        agents={agents}
        localAgents={LOCAL_AGENTS}
        initialAgentId={agentParam}
        initialCaseKey={caseParam}
      />
    </div>
  );
}
