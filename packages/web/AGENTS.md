# @chaos-design/web 包约定

本包是 NOVA 控制台的 Next.js 应用。项目级约定（目录职责、评分口径、
不可违背的约束）见仓库根 [`AGENTS.md`](../../AGENTS.md)，本文件只放
与 Next.js 版本行为直接相关的内容。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
