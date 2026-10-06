import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APPEARANCE_BOOTSTRAP, NOVA_BRAND } from "@/lib/nova";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: `${NOVA_BRAND.fullName} 控制台 · ${NOVA_BRAND.sloganZh}`,
    template: `%s · ${NOVA_BRAND.fullName}`,
  },
  description: `${NOVA_BRAND.expansion} —— 面向 AI Agent 的验证、测试与编排平台。${NOVA_BRAND.sloganZh}`,
  applicationName: NOVA_BRAND.fullName,
  keywords: ["AI Agent", "基准测试", "能力评估", "混沌工程", "NOVA"],
};

export const viewport: Viewport = {
  themeColor: "#0a0d1a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // 深空模式为唯一主题：固定挂载 .dark 以启用组件库的 dark: 变体
    <html lang="zh-CN" className="dark h-full" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-full antialiased`}
      >
        {/* 主色与动效必须在首帧前落到 <html> 上，否则会先闪一次默认配色 */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: 引导脚本必须是同步内联的，放到外部文件会晚于首帧
          dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOTSTRAP }}
        />
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
