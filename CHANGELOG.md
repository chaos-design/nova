# 更新日志

本文件记录所有值得记录的变更，格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。
版本号遵循语义化版本（SemVer）：`主版本.次版本.修订号`。

- **修订号（patch）**：缺陷修复、不影响接口的改动
- **次版本（minor）**：向后兼容的新能力
- **主版本（major）**：不兼容的变更

条目由 `npm run release:version` 自动插入骨架，内容需要人工补充。

## [0.1.0] - 2026-10-09

### 变更

- **配置体系**：新增根目录 `config.yaml` 作为唯一配置事实来源，按
  app / agent / sandbox / storage / verification / release / test / logging
  八个模块分组，每项注释说明用途、默认值与是否必填；敏感值与环境相关值
  以 `${VAR}` 插值由环境变量填充。
- **环境变量**：新增 `.env.example`（提交）与 `.env`（不提交，已 gitignore），
  统一 `NOVA_` 前缀命名；加载优先级为 进程环境 > `.env` > config.yaml 默认值。
- **统一加载器**：新增 `src/lib/nova/config.mjs`（及 `.d.mts` 类型声明），
  控制台与 playground Agent 共用同一份加载逻辑。
- **本地 Agent**：新增 `playground/nova-local/`（入口 `index.mjs`、策略
  `policy.mjs`、私有配置 `agent.config.yaml`、说明 `README.md`），
  读取根 `config.yaml` 与 `.env`，零依赖可真实运行。
- **工程链路**：补齐开发（安装 / 启动热重载 / lint 与格式化）、
  测试（单元 / 集成 / e2e / 覆盖率）、发布（版本管理 / 构建 / 产物 / 发布 /
  发布前校验）三阶段脚本。

### 注意

- 原先位于 `examples/local-agent/` 的 Agent 实现已迁移至
  `playground/nova-local/`，`npm run agent:local` 指向新路径。
- `npm run dev` / `npm run start` 改为经 `scripts/dev.mjs` / `scripts/start.mjs`
  读取配置后启动，端口不再硬编码在 npm script 里。
