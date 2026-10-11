"use client";

import { cn } from "cn";
import { useEffect, useState } from "react";

/** 模块级渲染序号：保证多次渲染的 mermaid 图表 id 不冲突 */
let renderSeq = 0;

/** 与 NOVA 深空主题对齐的 mermaid 基础变量 */
const THEME_VARIABLES = {
  darkMode: true,
  background: "transparent",
  fontFamily: "ui-sans-serif, system-ui, 'PingFang SC', sans-serif",
  fontSize: "13px",
  primaryColor: "#123b4a",
  primaryTextColor: "#d8f3f8",
  primaryBorderColor: "#22d3ee66",
  lineColor: "#67e8f9aa",
  secondaryColor: "#1c2740",
  secondaryTextColor: "#dbe4ff",
  secondaryBorderColor: "#818cf866",
  tertiaryColor: "#14182400",
  noteBkgColor: "#2a2140",
  noteTextColor: "#e6dcff",
  noteBorderColor: "#a78bfa66",
  clusterBkg: "#ffffff08",
  clusterBorder: "#ffffff14",
  titleColor: "#e7ecf5",
  edgeLabelBackground: "#101726",
} as const;

/**
 * 文档中心的 mermaid 渲染器。
 *
 * mermaid 体积较大，进入文档页后才动态加载，不进入首屏包；
 * 图表源是代码里的静态字符串，渲染产物注入 DOM（securityLevel: "strict"）。
 * 渲染失败时回退展示图表源码，保证内容永远可读。
 */
export function DocsMermaid({
  chart,
  caption,
  className,
}: {
  chart: string;
  caption: string;
  className?: string;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        renderSeq += 1;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: THEME_VARIABLES,
        });
        const { svg: rendered } = await mermaid.render(
          `nova-mermaid-${renderSeq}`,
          chart,
        );
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <figure className={cn("max-w-4xl space-y-1.5", className)}>
      <div className="nova-panel overflow-x-auto rounded-xl px-4 py-5 [&_svg]:mx-auto [&_svg]:h-auto">
        {failed ? (
          <pre className="font-mono text-xs leading-relaxed text-muted-foreground">
            {chart}
          </pre>
        ) : svg === null ? (
          <div className="grid h-44 place-items-center text-sm text-muted-foreground">
            正在渲染图表…
          </div>
        ) : (
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: 产物是 mermaid 对本仓库内静态图表字符串的渲染结果，且已启用 securityLevel strict
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}
