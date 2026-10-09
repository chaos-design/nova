import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { DocsToc } from "@/components/nova/docs-toc";
import {
  ArchitectureSection,
  DevConfigSection,
  FaqSection,
  InteractionSection,
  LocalAgentRunnerSection,
  OnboardingSection,
  QuickStartSection,
  SandboxSection,
  ScoringSection,
  TourSection,
} from "./sections";

export const metadata: Metadata = {
  title: "文档中心",
  description:
    "NOVA 控制台操作手册：快速开始、开发配置、界面导览、本地 Agent 接入与自带执行体、沙盒与混沌口径、评分与证书规则、架构图、快捷键与常见问题。",
};

/** 目录顺序即阅读顺序，与章节组件一一对应 */
const TOC_ITEMS = [
  { id: "quickstart", index: "01", label: "快速开始" },
  { id: "dev-config", index: "02", label: "开发配置" },
  { id: "tour", index: "03", label: "界面导览" },
  { id: "onboarding", index: "04", label: "接入本地 Agent" },
  { id: "local-runner", index: "05", label: "仓库自带的本地 Agent" },
  { id: "sandbox", index: "06", label: "沙盒与混沌" },
  { id: "scoring", index: "07", label: "评分与证书" },
  { id: "architecture", index: "08", label: "架构与数据流" },
  { id: "interaction", index: "09", label: "键盘与交互" },
  { id: "faq", index: "10", label: "数据说明与 FAQ" },
] as const;

/**
 * 文档中心。
 *
 * 操作手册的页内版本：内容以结构化 JSX 编写（见 ./sections.tsx），
 * 口径与 docs/*.md 同步 —— 页面职责只有取内容、排目录、渲染，
 * 因此保持 Server Component，客户端部分只有滚动高亮目录与 mermaid 渲染。
 */
export default function DocsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Documentation"
        title="文档中心"
        subtitle="控制台操作手册：从启动、开发配置、界面导览到本地 Agent 接入与自带执行体、混沌口径、评分规则与架构总览。左侧目录随阅读位置高亮，锚点直达。"
      />

      <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <aside className="sticky top-20 hidden max-h-[calc(100svh-6rem)] overflow-y-auto lg:block">
          <DocsToc items={TOC_ITEMS} />
        </aside>

        <div className="space-y-12">
          <QuickStartSection />
          <DevConfigSection />
          <TourSection />
          <OnboardingSection />
          <LocalAgentRunnerSection />
          <SandboxSection />
          <ScoringSection />
          <ArchitectureSection />
          <InteractionSection />
          <FaqSection />
        </div>
      </div>
    </div>
  );
}
