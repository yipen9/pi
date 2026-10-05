# 附录 C：命令速查

> 约定：`bash` 表示 Bash 类 shell（Linux/macOS/Git Bash），`powershell` 表示 Windows PowerShell；未标注的命令跨平台通用。所有 `git rev-parse --show-toplevel` 指仓库根。

## C.1 环境准备

```bash
node --version        # 需要 >= 22.19.0
npm --version
git --version
git log -1 --format="%H %s"   # 记录你的基线
```

## C.2 安装与依赖（工作目录：仓库根）

```bash
npm install --ignore-scripts           # 日常；不跑生命周期脚本
npm ci --ignore-scripts                # CI/干净复现
npm install --package-lock-only --ignore-scripts   # 仅刷新 lockfile（元数据变化时）
```

注意：提交 lockfile 会被 pre-commit 拦截（除非 `PI_ALLOW_LOCKFILE_CHANGE=1`，见第 20.4 节）。

## C.3 源码运行 pi（工作目录：仓库根或任意目录）

```powershell
# Windows PowerShell
.\pi-test.ps1                       # 交互
.\pi-test.ps1 --version             # 版本
.\pi-test.ps1 --help                # 帮助
.\pi-test.ps1 --no-env              # 清空 API Key 环境后启动
.\pi-test.ps1 -e .\my-extension.ts  # 加载单个扩展
.\pi-test.ps1 --mode rpc --no-session
```

```bash
# Linux / macOS / Git Bash
./pi-test.sh
./pi-test.sh --no-env
./pi-test.sh -e ./my-extension.ts
./pi-test.sh --mode json "任务描述" > events.jsonl
```

```cmd
REM Windows CMD（转发给 PowerShell 脚本）
pi-test.bat --version
```

要点：

- 脚本**保留你的工作目录**（第 2.4.2 节）；在哪个项目目录启动，pi 就以它为项目根；
- `--no-env` 清空供应商密钥（列表见第 2.4 节）。

## C.4 一次性与协议模式（与安装版 `pi` 用法相同）

```bash
pi --print "Summarize this repository"          # print：只要最终文本（错误走 stderr）
git diff | pi "review this change"              # 管道输入自动降级为 print
pi --mode json "Review this repository" > events.jsonl   # JSON 事件流
pi --mode rpc --no-session                      # RPC：stdin/stdout JSONL
pi --model sonnet:high -p "hello"               # 模型与思考级别
pi --tools read,grep,find,ls --print "review"   # 工具白名单
pi --continue  /  pi --resume  /  pi --session <path|id>   # 会话
pi --export <input> [output]                    # 导出 HTML
pi --list-models [search]                       # 列模型
```

## C.5 测试（工作目录：仓库根 / 对应包）

```bash
./test.sh                       # 全部非 e2e（隔离 HOME/凭据；仓库根）
```

```bash
# 单文件测试（在对应 package 目录下执行）
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/xxx.test.ts
```

```bash
# packages/tui 专用（node:test）
cd packages/tui
node --test test/keys.test.ts
```

禁止：直接跑全量 vitest（会激活 e2e，第 18.2 节）。

## C.6 质量门（工作目录：仓库根）

```bash
npm run check        # biome --write + 5 个脚本 + tsc + browser smoke（会改写文件！）
```

子项单独跑：

```bash
npm run check:pinned-deps
npm run check:runtime-deps
npm run check:ts-imports
npm run check:entry-graphs
npm run check:install-lock:coding-agent
npm run check:browser-smoke
```

## C.7 构建与生成（默认不要跑，见 AGENTS.md）

```bash
npm run build                # 刷新模型数据 + 全部构建
npm run build:offline        # 离线构建
npm run build:native:win32   # 原生终端模块（平台对应）
npm run generate:models      # 模型目录生成（改 ai 生成脚本后）
npm run generate:model-catalog
npm run update:model-catalog-pin
node scripts/generate-coding-agent-install-lock.mjs [--check]
```

## C.8 性能剖析（仓库根）

```bash
npm run profile:tui
npm run profile:rpc
```

```powershell
$env:PI_STARTUP_BENCHMARK="1"; .\pi-test.ps1      # 交互模式启动基准（初始化后退出）
```

## C.9 包与子命令（安装版 pi）

```bash
pi install npm:@example/pi-tools@1.0.0
pi install git:github.com/example/pi-tools@v1
pi install ./local-package [--local]
pi list / pi remove <source> / pi update [--extensions]
pi config [--local]
pi auth check / pi auth print-api-key / pi auth print-bearer-token
pi mcp add <name> -- <command...> | pi mcp add <name> --url <url>
pi mcp list | pi mcp login <name> | pi mcp logout <name>
```

## C.10 交互内命令（常用）

```text
/settings /model /thinking /login /logout
/new /resume /name /session /tree /fork /clone /compact /import
/export /share /bug
/trust /reload /hotkeys /changelog /quit
/mcp（状态/登录/重连/暴露方式） /skill:<name> <args> /<template>
```

## C.11 交互测试（tmux；先读 `.pi/skills/interactive-testing.md`）

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p
tmux send-keys -t pi-test "你的输入" Enter
tmux send-keys -t pi-test Escape          # 特殊键：C-o=ctrl+o 等
tmux resize-window -t pi-test -x 40 -y 24
tmux kill-session -t pi-test
```

## C.12 评估（**真实模型调用，需预算确认**）

```bash
PI_PROVIDER=... PI_MODEL=... npm run eval -w packages/evals
PI_PROVIDER=... PI_MODEL=... npm run eval:host -w packages/evals [-- evals/xxx.eval.ts]
npm run eval:docs -w packages/evals -- --provider <p> --model <m> [--runs-per-variant 5]
```

## C.13 环境变量速查

| 变量 | 用途 |
|---|---|
| `PI_CODING_AGENT_DIR` | 全局配置目录（默认 `~/.pi/agent`） |
| `PI_CODING_AGENT_SESSION_DIR` | 会话目录 |
| `PI_PACKAGE_DIR` | 包资源目录覆盖（打包环境） |
| `PI_OFFLINE` / `--offline` | 离线模式 |
| `PI_SKIP_VERSION_CHECK` | 跳过版本检查 |
| `PI_NO_LOCAL_LLM` | 禁本地 LLM 探测（测试） |
| `PI_STARTUP_BENCHMARK` | 启动基准（仅交互） |
| `PI_TUI_WRITE_LOG` | 捕获原始 ANSI 流 |
| `PI_ALLOW_LOCKFILE_CHANGE` | 允许提交 lockfile（谨慎） |
| `PI_PROVIDER` / `PI_MODEL` | 评估的模型 |
| `PI_EVAL_RUNS_PER_VARIANT` | 评估重复次数 |
| `ANTHROPIC_API_KEY` 等 | 供应商密钥（第 5 章） |

## C.14 路径速查

```text
全局配置      ~/.pi/agent/            （Windows: C:\Users\<你>\.pi\agent）
  settings.json / keybindings.json / mcp.json / models.json / auth.json / trust.json / crashes.json / mcp.log / mcp-auth.json
用户资源      ~/.pi/agent/{extensions,skills,prompts,themes}/
项目配置      <项目>/.pi/{settings.json,mcp.json,SYSTEM.md,APPEND_SYSTEM.md,extensions/,skills/,prompts/,themes/}
上下文文件    <agent-dir 或 各级目录>/AGENTS.override.md|AGENTS.md|AGENTS.MD|CLAUDE.md|CLAUDE.MD
会话          <agent-dir>/sessions/--<cwd编码>--/<timestamp>_<id>.jsonl
评估产物      packages/evals/.eval/<timestamp>_<id>/
```