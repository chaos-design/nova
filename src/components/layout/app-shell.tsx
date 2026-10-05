import { CosmicBackground } from "./cosmic-background";
import { NovaSidebar } from "./nova-sidebar";
import { NovaTopBar } from "./nova-top-bar";

/**
 * 控制台外壳：固定侧边栏 + 吸顶顶栏 + 内容区。
 *
 * `(nova)` 路由组的所有页面共享此布局，切换页面时不重挂载，
 * 因此侧边栏与背景不会闪烁。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <CosmicBackground />
      <NovaSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <NovaTopBar />
        <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-6 lg:px-8 lg:py-8">
          {children}
        </main>
        <footer className="border-t border-white/8 px-4 py-4 lg:px-8">
          <p className="text-xs text-muted-foreground/70">
            NOVA 控制台 · 当前为演示数据层（mock），所有指标由
            <code className="mx-1 font-mono text-nova-cyan/80">
              src/lib/nova/mock-data.ts
            </code>
            生成，不含真实评测结论。
          </p>
        </footer>
      </div>
    </div>
  );
}
