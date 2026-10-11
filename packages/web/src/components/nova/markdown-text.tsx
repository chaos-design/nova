"use client";

import { cn } from "cn";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * NOVA 主题下的轻量 markdown 渲染。
 *
 * 只做安全的 React 节点映射（react-markdown 默认不产出原始 HTML），
 * 样式通过 components 映射贴合深空主题，不引入 typography 插件 ——
 * 这里只需要对话回复这种"短文档"的排版，不需要完整文章排版体系。
 */
export function MarkdownText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div className={cn("nova-md text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-nova-accent underline decoration-nova-accent/40 underline-offset-2 hover:decoration-nova-accent"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          h1: ({ children }) => (
            <h1 className="mt-3 mb-1.5 text-base font-semibold first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-1.5 text-sm font-semibold first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-2 mb-1 text-sm font-medium first:mt-0">
              {children}
            </h3>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-nova-accent/40 pl-2.5 text-muted-foreground">
              {children}
            </blockquote>
          ),
          code: ({ className: cls, children }) => {
            // 多行代码块由 pre 承担容器样式，这里只处理行内 code
            const inline = !cls?.includes("language-");
            if (inline) {
              return (
                <code className="rounded bg-white/8 px-1 py-0.5 font-mono text-[0.75rem] text-nova-starlight">
                  {children}
                </code>
              );
            }
            return <code className={cls}>{children}</code>;
          },
          pre: ({ children }) => (
            <pre className="my-1.5 overflow-x-auto rounded-lg border border-white/8 bg-white/3 p-2.5 font-mono text-xs">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-1.5 overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-white/10 bg-white/4 px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-white/10 px-2 py-1 align-top">
              {children}
            </td>
          ),
          hr: () => <hr className="my-2 border-white/10" />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
