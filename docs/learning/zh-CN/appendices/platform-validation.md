# 附录 K：三平台命令与验证边界

> 本附录把“有 Windows/Linux/macOS 步骤”和“已在这些系统实测”分开。本文撰写与仓库核对环境是 Windows + PowerShell；Linux/macOS 命令依据脚本与项目文档静态核对，没有声称在这两个系统运行通过。
>
> 读法：先识别你实际所在的操作系统和 shell，再选择命令。Git Bash、WSL 与原生 Windows 各自有不同的 Node、HOME、路径和进程环境。

## K.1 先分清操作系统、终端和 shell

“我在 Windows Terminal”只说明终端应用，不说明里面跑的是哪一种 shell 或 OS。Windows Terminal 可以运行 PowerShell、Git Bash 或 WSL；它们看到的路径、`HOME` 和可执行文件可能完全不同。

| 运行环境 | Node 看到的平台 | 常见交互 shell | pi `bash` 工具常见目标 | 配置目录是否共用 |
|---|---|---|---|---|
| 原生 Windows PowerShell | `win32` | PowerShell | Git Bash；可配置 `shellPath` | `%USERPROFILE%\.pi\agent` |
| 原生 Windows + Git Bash | 仍为 `win32` | Bash | 默认发现的 Bash | 与原生 Windows 通常共用用户 profile；工具链路径要检查 |
| WSL 发行版 | `linux` | Bash 或 zsh | WSL 的 Bash | WSL 内 Linux home，与 Windows profile 分开 |
| Linux | `linux` | Bash 或 zsh | 系统 Bash | `$HOME/.pi/agent` |
| macOS | `darwin` | zsh 或 Bash | pi 发现的 Bash | `$HOME/.pi/agent` |

【陷阱】PowerShell 是 shell，不是平台；Git Bash 是 shell 环境，不会把 Node 从 Windows 变成 Linux；WSL 才是在 Linux 用户空间运行另一套进程和 home。

## K.2 记录基线：先确认自己在哪里

在每个准备验证的平台分别执行下面的命令，并把输出记入实验记录。不要把另一台机器的 Node 版本复制过来。

### PowerShell（原生 Windows）

```powershell
node --version
npm --version
git --version
git rev-parse --show-toplevel
git rev-parse HEAD
node -p "process.platform + ' ' + process.arch"
$PSVersionTable.PSVersion
```

### Bash（Linux、macOS、Git Bash、WSL）

```bash
node --version
npm --version
git --version
git rev-parse --show-toplevel
git rev-parse HEAD
node -p "process.platform + ' ' + process.arch"
printf 'shell=%s\n' "$SHELL"
```

Git Bash / WSL 还可以对照：

```bash
uname -a
pwd
printf 'HOME=%s\n' "$HOME"
```

Node 版本必须满足根 `package.json` 当前 `engines.node` 要求（基线要求 `>=22.19.0`）。版本不够时，先换 Node 再分析类型/API 报错；不同 Node 版本会让实验比较失去意义。

## K.3 源码启动命令

仓库根目录下的源码入口脚本保留调用者当前工作目录。按运行环境选择：

| 环境 | 源码启动 | 版本检查 |
|---|---|---|
| Windows PowerShell | `.\pi-test.ps1` | `.\pi-test.ps1 --version` |
| Windows CMD | `.\pi-test.bat` | `.\pi-test.bat --version` |
| Windows Git Bash | `./pi-test.sh` | `./pi-test.sh --version` |
| WSL、Linux、macOS | `./pi-test.sh` | `./pi-test.sh --version` |

从仓库外的项目目录调用时，要给入口脚本绝对路径，别先 `cd` 到 pi 仓库：项目 cwd 决定资源发现与会话分组。

### PowerShell 示例

```powershell
$repo = (Get-Location).Path # 先在仓库根目录执行此行
Set-Location 'D:\work\my-project'
& "$repo\pi-test.ps1" --version
```

### Bash 示例

```bash
repo=$(pwd) # 先在仓库根目录执行此行
cd "/work/my-project"
"$repo/pi-test.sh" --version
```

Git Bash 下路径要使用 Bash 能理解的格式。若 Windows 路径含空格，务必引用完整路径；不要把 PowerShell 的 `&` 调用符号复制进 Bash 命令。

### `--no-env` 的范围

`--no-env` 让源码启动器清掉已知 provider 凭据环境变量后再启动；它不等同于“整个 OS 没有凭据”，也不会删除 auth 文件或系统级 credential provider。用于学习时，它能排除常见 API key 环境变量干扰；如果需要证明认证存储行为，应另外使用隔离 HOME 或内存存储测试。

## K.4 原生 Windows 与 WSL 的分界

### 原生 Windows

- Node 的 `process.platform` 是 `win32`；跨平台条件分支按 Windows 执行；
- pi 的内置 `bash` 工具通常调用 Git Bash；`!` / `!!` 编辑器命令也走 Bash；
- 可选 `powershell` 工具只在原生 Windows 可用；它使用 `pwsh.exe`，否则回退 Windows PowerShell；
- JSON 中的 Windows 路径反斜杠需要转义，例如 `C:\\tools\\bash.exe`；
- Windows Terminal 可能占用或重写部分组合键，应按 `windows.md` 设置，而不能把按键问题先归因于 pi。

项目资料：[Windows 运行说明](../../../../packages/coding-agent/docs/windows.md)、[shell 实现](../../../../packages/coding-agent/src/core/tools/bash.ts)、[PowerShell 工具](../../../../packages/coding-agent/src/core/tools/powershell.ts)。

### WSL

- Node 的平台值是 `linux`，命令查找、路径与文件权限按 Linux 环境；
- `HOME` 是 WSL 用户的 Linux home，不自动等于 Windows `%USERPROFILE%`；
- WSL 的 pi 默认 Bash 是发行版内的 Bash，而非 Windows Git Bash；
- 在 `/mnt/c/...` 与 Linux 文件系统内工作，文件权限、大小写和性能可能不同；实验记录要写明实际目录；
- `powershell` 工具不因终端应用是 Windows Terminal 就变成可用；它由 Node 运行平台决定。

先在 WSL 终端运行 `node -p process.platform` 确认，不要依据桌面终端名称猜平台。

## K.5 安装依赖和测试命令

依赖安装在仓库根执行，并遵守 `--ignore-scripts`：

```text
npm install --ignore-scripts
npm ci --ignore-scripts
```

这两个 npm 命令不需要为 PowerShell 改写。`npm ci` 会按 lockfile 重建依赖树，确认删除/重建 `node_modules` 符合你的本地工作状态后再使用。

### 单个 Vitest 测试：PowerShell

在对应 package 根目录执行。例：

```powershell
$repo = git rev-parse --show-toplevel
node "$repo/node_modules/vitest/dist/cli.js" --run test/suite/agent-session-prompt.test.ts
```

### 单个 Vitest 测试：Bash

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/agent-session-prompt.test.ts
```

路径相对当前 package 根目录。若在仓库根误跑 `test/suite/...`，测试文件当然找不到；先 `pwd` 确认工作目录。

### TUI 的 node:test

在 `packages/tui` 根目录：

```text
node --test test/keys.test.ts
```

仓库级 `./test.sh` 是 Bash 脚本：Linux/macOS/WSL 依照仓库规则运行；原生 Windows 应用 Git Bash，或者使用 WSL。它会创建隔离临时 HOME，并用 `env -i` 控制测试子进程环境。此脚本不是单个测试快捷命令；定位回归时应先按上面的命令跑具体测试。

### 质量检查

```text
npm run check
```

它从仓库根运行多个检查，包含 `biome --write`（会改写文件）、依赖/入口检查、TypeScript 检查和 browser smoke。执行后审阅 `git diff`，识别格式化写入；该命令不运行测试。若本任务只改 Markdown，不因本附录要求额外运行代码质量命令。

不要用 `npm test` 或直接启动根全量 Vitest 来代替指定测试；按根 `AGENTS.md` 的测试规则操作。

## K.6 交互式 TUI 的平台边界

仓库的交互测试指引使用 tmux 创建固定尺寸终端、发送按键、抓取屏幕。tmux 是 Unix 风格工具：

- Linux/macOS：可在本机按 `.pi/skills/interactive-testing.md` 执行；
- WSL：在 WSL 内安装并运行 tmux，目标进程也从 WSL 启动；
- 原生 Windows：不要假设存在同样的 tmux 能力；对纯组件布局先跑 `packages/tui` 的 node:test，交互验证使用 WSL 或记录为尚未运行。

启动 UI 后立刻出现提示不代表输入、resize、IME、取消和退出都正确。交互验证记录至少包括终端宽高、输入序列、抓屏、pi/Node 版本与退出清理情况。

## K.7 协议实验不要跨环境偷换结论

实验性的 client/server Unix transport 有明确的平台判断：`packages/client/src/unix.ts` 在 `process.platform === "win32"` 时抛出“不支持 Unix transport”。因此：

- 原生 Windows 不运行 Unix socket 实验；
- WSL 按 Linux 条件验证，但 server 与 client 都应在相同 WSL 环境；
- Linux/macOS 的 socket 路径、权限与长度限制仍须按具体实现核对；
- 可以在原生 Windows 研究协议编码/分帧纯函数，但这不证明 Unix transport 可工作。

这正是“代码逻辑平台无关”和“传输能力跨平台”两条不同主张。实验 L14 需把它们分别记录。

## K.8 按实验分组的平台检查点

| 实验 | 跨平台敏感点 | 最低记录 |
|---|---|---|
| L01 环境与入口 | PowerShell/Bash 启动器、Node 版本、当前 cwd | OS、shell、Node、入口路径、commit |
| L02–L09 faux / session | 测试进程通常可跨平台，但路径 fixture 与环境隔离仍受 OS 影响 | 测试文件、命令 cwd、通过/失败完整摘要 |
| L10 JSONL/RPC | stdout 编码、换行、子进程关闭与信号 | 子进程入口、stdin/stdout 样例、退出码 |
| L11 TUI | 键位、终端宽度、中文/emoji、IME、resize | 终端实现、列宽、输入事件与截图 |
| L12 毕业项目 | 所选模块决定平台约束 | 选题、工具依赖、目标平台 |
| L13 MCP/Codemode | 子进程命令行和传输启动方式 | server command、cwd、关闭顺序 |
| L14 durable/client-server | 持久恢复与 Unix transport 支持范围 | transport 名称、platform、socket/path 与恢复轨迹 |
| L15 evals | 模型供应商、认证和费用 | 设计可以无网络；实际执行另记预算和授权 |

测试结果只证明运行命令的那个环境。Windows 通过不代表 macOS/Linux 通过；WSL 通过代表 Linux 用户空间路径，不代表原生 Windows transport。

## K.9 验证记录模板

每个平台、每个重要命令各记一条。不要只写“跨平台通过”。

```markdown
### <行为 / 实验编号>
- 日期：
- OS / 版本：
- 环境：原生 Windows / Git Bash / WSL（发行版）/ Linux（发行版）/ macOS（版本）
- CPU 架构：
- 终端应用：
- shell / 版本：
- Node / npm：
- cwd：
- 仓库 commit：
- 命令：
- 退出码：
- 观察结果：
- 外部条件：无 / faux / tmux / 本地服务 / provider
- 与其他平台的差异：
- 清理情况：
```

粘贴命令输出前先检查有没有 API key、token、用户目录隐私或临时凭据。错误诊断要保留原因，但不要把秘密加入文档。

## K.10 报告平台问题时的最小对照

当 Windows 可复现而 Linux 不可复现（或相反）时，按顺序排除：

1. `git rev-parse HEAD` 是否相同？
2. Node/npm 版本和架构是否相同？
3. 是否在同一个仓库 package/cwd 运行？
4. 实际 shell 是否相同，子进程工具是否调用同一命令？
5. 输入路径、大小写、空格、Unicode 字符是否相同？
6. 环境变量、HOME、凭据配置是否隔离？
7. 问题是纯转换逻辑、Node API 还是终端/transport？
8. 是否能用纯函数或 fake transport 把平台差异从真实终端中隔离出来？

一次只改变一个变量。若同时换 Node、shell、cwd 和模型，结果变了也很难知道是哪项导致。

## K.11 本附录能证明什么

- 提供按环境选命令的路线与记录格式；
- 标明原生 Windows、Git Bash、WSL 和 POSIX 系统不是互换概念；
- 把 Unix transport 的平台限制与协议纯逻辑分开；
- 明确哪些检查实际只在当前 Windows/PowerShell 环境做过。

它不能证明用户机器的安装、测试或终端表现，也不能替代 `npm run check`、指定测试、tmux 交互验证或真实外部服务测试。运行后将证据追加到本机验证记录，并注明准确平台。
