# 第 2 章：开发环境与最小运行闭环

> 学完本章你能回答：
>
> 1. 安装版、源码运行、测试环境有什么区别？各自适合什么场景？
> 2. `pi-test.sh` / `pi-test.ps1` 到底做了什么？为什么它不切换目录？
> 3. `test.sh` 为什么要在"隔离环境"里跑测试？隔离了什么？
> 4. 遇到"改了源码没生效"时，第一时间应该检查什么？

**前置知识**：第 1 章（Node/TypeScript 基本概念）；会使用终端。
**预计学习时间**：半天（安装 + 跑通实验 L01）。
**本章验证状态**：静态核对通过；本机（Windows + Node v23.9.0）实际执行了依赖安装状态检查和脚本阅读，启动实验留给读者执行。

---

## 2.1 三种运行形态：先想清楚"我在跑哪一种"

同一个 pi，在你的机器上可能以三种形态存在。区分它们是排查一切环境问题的前提。

| 形态 | 来源 | 命令 | 代码版本 | 适用场景 |
|---|---|---|---|---|
| 安装版 | 官网安装脚本或 npm 全局安装 | `pi` | 已发布的构建产物（`dist/`） | 日常使用 |
| 源码运行 | 你 clone 的仓库 | `./pi-test.sh`（三平台的对应脚本） | **工作区源码**（`src/`），改了立刻生效 | 学习、调试、开发 |
| 测试环境 | 仓库 + `test.sh` | `./test.sh` | 源码，但运行在隔离的假 HOME 里 | 跑测试，避免污染你的真实配置 |

**新手最容易混的点**：安装版的 `pi` 和源码版的 `./pi-test.sh` 是两个进程、两套代码。你改了源码后运行 `pi` 发现没变化——不是改错了，而是你运行的还是安装版。

> 本手册所有实验默认使用**源码运行**。等你能改代码了，再考虑要不要重新安装。

## 2.2 准备阶段：Node、Git、编辑器

### 2.2.1 版本要求

仓库根 `package.json` 写明了要求（已核对基线）：

```json
"engines": {
	"node": ">=22.19.0"
}
```

检查你符合条件：

```bash
node --version
npm --version
git --version
```

只要 Node 的 major 版本 >= 22 且完整版本 >= 22.19.0 即可。作者撰写本手册时使用的版本是 Node v23.9.0。

为什么要求这么新的 Node？两个直接原因：

1. **原生类型擦除**（第 1 章 1.1）：源码里的 `.ts` 要能直接执行；
2. **较新的标准库与运行时能力**：仓库使用了较新的 Node API（如 `registerHooks` 模块钩子、`node:test` 等）。

低于要求的版本会出现各种奇怪错误（语法不识别、API 不存在），**遇到无法解释的启动错误，先回去确认 Node 版本**。

### 2.2.2 三平台安装 Node（如果你还没有）

Windows（推荐使用官方安装包或 winget）：

```powershell
winget install OpenJS.NodeJS.LTS
# 安装后重开终端
node --version
```

如果 winget 不方便，也可以从 nodejs.org 下载 LTS 安装包；或者使用 nvm-windows 管理多版本。

Linux（以 nvm 为例）：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22
nvm use 22
```

macOS（Homebrew）：

```bash
brew install node@22
```

> 说明：以上安装命令指向"至少 22 的大版本"；如果你的发行版仓库提供更新的 LTS，也可以用更新版本。安装命令属于外部环境操作，作者未在本机对三平台逐一执行，请以各官方文档为准。

### 2.2.3 Git 与编辑器

- Git：用于克隆仓库、查看历史、运行 `git log` 确认基线；
- 编辑器：推荐 VS Code。三个必会操作：**转到定义**（F12 / Ctrl+点击）、**工作区搜索**（Ctrl+Shift+F / Cmd+Shift+F）、**悬停看类型**。本手册大量使用"符号名"引用，靠这几个功能定位。

Windows 用户注意：安装 [Git for Windows](https://git-scm.com/download/win) 会附带 **Git Bash**，pi 的 `bash` 工具和编辑器 `!` 命令默认需要它（详见 `packages/coding-agent/docs/windows.md`，本章 2.8 节会再讲）。

## 2.3 获取源码与安装依赖

### 2.3.1 克隆并确认基线

```bash
git clone https://github.com/earendil-works/pi.git
cd pi
git log -1 --format="%H %s"
```

本手册基线是 `200387122ca450d6387f033949423114a270b96c`（提交 `200387122`）。如果你的提交不同，阅读时以你手头的代码为准（方法与第 0 章相同）。

### 2.3.2 安装依赖：一条带 `--ignore-scripts` 的命令

```bash
npm install --ignore-scripts
```

两个要点：

**要点一：这是 monorepo（多包仓库）**。根 `package.json` 的 `workspaces` 字段声明了所有子包：

```json
"workspaces": [
	"packages/*",
	"packages/coding-agent/examples/extensions/with-deps",
	...
]
```

`npm install` 在根目录执行一次，会把所有工作区包的依赖一起装好，并建立互相链接。验证方法（作者已在本机核对）：

```powershell
Get-Item node_modules\@earendil-works\pi-ai | Select-Object Name, LinkType, Target
```

输出类似：

```text
Name     : pi-ai
LinkType : Junction
Target   : D:\Github\pi\packages\ai
```

也就是说 `node_modules/@earendil-works/pi-ai` 是一个**指向 `packages/ai` 的链接**（Windows 上是 Junction，Unix 上是符号链接）。所以：

- 用包名 `@earendil-works/pi-ai` 导入时，Node 解析到的是链接后的真实目录；
- 子包之间共享同一份根 `node_modules`，没有 N 份重复依赖。

**要点二：`--ignore-scripts` 是刻意加上去的**。npm 的依赖在安装时可能执行"生命周期脚本"（postinstall 等），这是供应链攻击的常见载体。仓库规则（`AGENTS.md`）要求：

- 日常补充安装用 `npm install --ignore-scripts`；
- CI/干净复现用 `npm ci --ignore-scripts`；
- **不主动运行生命周期脚本**（除非用户明确要求）。

如果某个依赖真的必须有安装脚本才能工作，那会体现在"安装锁"（`packages/coding-agent/install-lock/`）的审查清单里——这是维护者的事，新手不用操心。

### 2.3.3 安装后有什么、没有什么

安装完成后：

- **有**：`node_modules/`（依赖 + 工作区链接）、`package-lock.json` 记录的精确版本；
- **没有**：各包的 `dist/`。`dist` 是构建产物，只有运行 `npm run build` 才会出现。

等等——那没有 `dist`，源码运行能不能跑？能。这正是下一节的主角：**源码解析器**（source resolver）让内部导入直接走 `src/*.ts`，绕开 `dist`。

> 提示：本机（作者环境）此前执行过构建，所以 `packages/coding-agent/dist` 是存在的。你可以用 `Test-Path packages\coding-agent\dist`（PowerShell）或 `ls packages/coding-agent/dist`（Bash）检查自己的状态。

## 2.4 源码运行：三个脚本逐行读

源码运行的入口不是 `pi`，而是仓库根目录的三个脚本：

```text
pi-test.sh    # Bash（Linux / macOS / Windows 的 Git Bash）
pi-test.ps1   # PowerShell（Windows）
pi-test.bat   # 命令提示符转发器（Windows，转发给 .ps1）
```

以下逐行讲解（这三个脚本都不长，读完整）。先看 `pi-test.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

- `#!/usr/bin/env bash`：用环境里的 bash 执行；
- `set -euo pipefail`：三件安全设置——出错立刻退出（`-e`）、引用未定义变量报错（`-u`）、管道中任一环失败整体失败（`pipefail`）；
- `SCRIPT_DIR`：根据脚本自身位置算出仓库根目录。这使得**你可以在任何目录调用它**（照抄路径即可）。

接下来的参数预处理：

```bash
NO_ENV=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-env" ]]; then
    NO_ENV=true
  else
    ARGS+=("$arg")
  fi
done
```

它把 `--no-env` 这个自定义参数"吃掉"，其余参数放进 `ARGS` 原样转发。`--no-env` 的作用是**临时清空所有模型供应商的 API Key 环境变量**，让你在"没有凭据"的干净状态下启动（列表见下，来源是 `packages/ai/src/env-api-keys.ts` 对应的变量名）：

```text
ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN, OPENAI_API_KEY, GEMINI_API_KEY,
GROQ_API_KEY, CEREBRAS_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY, ZAI_API_KEY,
MISTRAL_API_KEY, MINIMAX_API_KEY, MINIMAX_CN_API_KEY, AI_GATEWAY_API_KEY,
OPENCODE_API_KEY, COPILOT_GITHUB_TOKEN, GH_TOKEN, GITHUB_TOKEN, HF_TOKEN,
GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT,
GOOGLE_CLOUD_LOCATION, AWS_PROFILE, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
AWS_SESSION_TOKEN, AWS_REGION, AWS_DEFAULT_REGION, AWS_BEARER_TOKEN_BEDROCK,
AWS_CONTAINER_CREDENTIALS_RELATIVE_URI, AWS_CONTAINER_CREDENTIALS_FULL_URI,
AWS_WEB_IDENTITY_TOKEN_FILE, AZURE_OPENAI_API_KEY, AZURE_OPENAI_BASE_URL,
AZURE_OPENAI_RESOURCE_NAME
```

这个开关对学习非常有用：它让你**确定性的知道"当前没有凭据"**，从而观察 pi 在无凭据时的行为，而不是被某台机器上遗留的环境变量干扰。

最后是真正的启动行：

```bash
RESOLVER_URL="$(node -p 'require("node:url").pathToFileURL(process.argv[1]).href' "$SCRIPT_DIR/packages/coding-agent/src/experimental/source-resolver.ts")"
node --import "$RESOLVER_URL" "$SCRIPT_DIR/packages/coding-agent/src/experimental/cli.ts" ${ARGS[@]+"${ARGS[@]}"}
```

拆开看：

1. **先算解析器的 file:// URL**。注释写明了原因："`--import` 接收模块说明符，原始 Windows 路径在包含 `#`、`?`、`%` 时会出错"。`node -p` 调用 Node 把本地路径转成标准 URL（如 `file:///D:/Github/pi/...`）。这是一个很好的工程细节：**路径里有特殊字符时，拼字符串是错误做法，转成 URL 才安全**。
2. **用 `--import` 预载解析器**：`packages/coding-agent/src/experimental/source-resolver.ts`。它注册 Node 模块解析钩子，把 `@earendil-works/*` 这类包名解析到本仓库的 `src/*.ts`（依据根目录 `tsconfig.json` 的 `paths` 映射）。
3. **启动入口**：`packages/coding-agent/src/experimental/cli.ts`——一个薄壳，先调用 `setupCli()`，再判断是否走实验性命令，否则交给 `main()`（第 3 章细读）。
4. **`${ARGS[@]+"${ARGS[@]}"}`**：bash 的"数组非空才展开"写法。当没有任何参数时避免一个空字符串参数被传进去（配合 `set -u` 使用的小技巧）。

### 2.4.1 `source-resolver.ts`：为什么要这么麻烦

打开 `packages/coding-agent/src/experimental/source-resolver.ts`，文件顶部的注释直接回答了：

```text
Node strips TypeScript natively, but it does not apply the workspace source
aliases from tsconfig.json. Internal source processes preload this resolver so
they cannot silently fall through to stale package dist files.
```

翻译：Node 能擦除类型，但**不认识 tsconfig 里的路径别名**。如果不管，`import "@earendil-works/pi-ai"` 会走 npm 解析，落在 `packages/ai` 包的 `"exports"` 字段声明的 `dist/index.js` 上——那是**构建产物，可能是旧的**。解析器让内部导入强制走 `src`，保证"你改的源码就是你在跑的代码"。

它的工作方式（读懂这四步就够）：

1. 读取根 `tsconfig.json`，取出所有 `@earendil-works/` 开头的 `paths` 映射；
2. 按模式长度排序（长模式优先匹配，避免短模式抢匹配）；
3. 对每个导入说明符找到映射，再把目标路径解析到真实存在的文件（尝试 `.ts` 等候选后缀）；
4. 如果**匹配上了别名却找不到文件**，直接抛错——注释说得很清楚：不允许"悄悄回退到旧的 dist"。

这句话值得单独记住，它是本项目的一个重要设计原则：

> **宁可大声失败，也不悄悄使用过期产物。**

### 2.4.2 保留调用者工作目录：为什么脚本不 `cd`

你可能注意到：三个脚本都**没有** `cd "$SCRIPT_DIR"`。它们算出仓库位置后，只用绝对路径调用 Node。为什么？

因为 pi 的行为强依赖"你在哪个目录启动它"。`packages/coding-agent/docs/cli.md` 写道：

```text
Pi resolves @path from the current working directory. The working directory
also controls project configuration, resource discovery, and session grouping.
```

翻译：`@文件` 的解析、项目配置、资源发现、会话归类，全部基于**当前工作目录**。如果脚本擅自 `cd` 到仓库目录：

- 你在 `D:\my-project` 下运行 `D:\Github\pi\pi-test.ps1`，pi 会把 `D:\Github\pi` 当成项目目录；
- 项目配置、AGENTS.md、会话记录全都会认错地方。

所以脚本的设计是："**脚本可以躺在任何地方，但你启动它的目录必须被原样保留。**"这是你验收时要能解释的一个点。

### 2.4.3 PowerShell 与 BAT 版本

`pi-test.ps1` 与 bash 版逻辑对应：

```powershell
$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
```

- `$ErrorActionPreference = "Stop"`：让非终止错误也当异常处理（对应 bash 的 `set -e`）；
- 同样的 `--no-env` 收集逻辑，只是用 PowerShell 的数组语法；
- 用 `[System.Uri]` 把路径转成 URL（原因同 2.4 的注释："Windows 路径不是模块说明符"）；
- 启动命令是 `& node --import $resolverUrl $cliPath @forwardArgs`，其中 `@forwardArgs` 是 PowerShell 的"数组展开成参数"写法；
- 末尾检查 `$LASTEXITCODE` 并传递退出码，保证上层脚本能感知失败。

一个与 bash 版**不同**的细节（读代码时不要被绊倒）：`pi-test.ps1` 启动的是 `packages/coding-agent/src/cli.ts`，而 `pi-test.sh` 启动的是 `packages/coding-agent/src/experimental/cli.ts`。两者的差异只在"是否支持实验性命令"（bash 版额外挂载了 `client` 等实验命令的分发）；日常使用没有区别。

`pi-test.bat` 是最薄的一层：找到 `powershell.exe`，把参数原样转发给 `pi-test.ps1`。它存在的意义是让习惯 `cmd` 或从某些工具（如非交互式任务计划）调用的人也能一键运行。

## 2.5 实验 L01：第一次把 pi 从源码跑起来

**实验性质**：只读启动实验，不需要任何模型凭据。
**验证状态**：设计中（脚本逻辑已静态核对；请在本地执行并记录结果）。

### 目标

1. 验证依赖安装正确；
2. 用源码方式启动 pi 并观察启动行为；
3. 记录你的环境信息，作为后续所有实验的基线。

### 步骤

**第 1 步：确认环境**（三平台通用，在仓库根执行）：

```bash
node --version
git log -1 --format="%H %s"
```

把输出抄到你的学习笔记（或 `appendices/validation.md` 模板）里。

**第 2 步：看版本号（不启动完整界面）**。

Windows PowerShell：

```powershell
.\pi-test.ps1 --version
```

Linux / macOS / Git Bash：

```bash
./pi-test.sh --version
```

预期：打印形如 `1.0.2` 的版本号后退出。源码里的依据：`packages/coding-agent/src/main.ts` 在参数解析后有一行 `if (parsed.version) { console.log(VERSION); ... }`——解析到 `-v` / `--version` 就直接输出并退出，不会连接任何模型。（`-v` / `--version` 的文档见 `packages/coding-agent/docs/cli.md`。）

**第 3 步：看帮助文本**：

```powershell
.\pi-test.ps1 --help
```

预期：打印完整的选项列表，包括五类内容——运行模式（`--print`、`--mode json`、`--mode rpc`）、模型选项（`--model`、`--thinking`）、会话选项（`--continue`、`--session`）、工具选项（`--tools`）、以及内置命令。帮助文本由参数解析器动态生成，**以你本地输出为准**。

**第 4 步：观察"无凭据启动"**：

```powershell
.\pi-test.ps1 --no-env
```

预期：pi 以交互模式启动，但由于没有凭据，会引导你登录或提示没有可用模型。**看到提示后直接退出（Ctrl+C 或 Esc 退出界面）**，不要输入真实凭据。这个观察点的意义：认清"没有凭据时系统停在哪一步"——这是第 11 章排查认证问题的起点。

**第 5 步：验证"改源码立刻生效"**。

这次实验不修改任何文件，改为**观察确认**：用编辑器打开 `packages/coding-agent/src/main.ts`，找到公式化的版本处理分支（搜索 `parsed.version`），对照你第 2 步看到的输出，确认"你运行的确实就是这份源码"。原理就是 2.4.1 的 source-resolver。

### 观察与思考

- `pi-test.ps1 --version` 的输出与 `packages/coding-agent/package.json` 里的 `"version"` 一致吗？（`main.ts` 的 `VERSION` 来自 `src/config.ts`，第 3 章会读）
- 运行 `--no-env` 时，先出现的提示是什么？据此推断"启动顺序：先加载什么、后加载什么"。
- 如果把 `pi-test.ps1` 复制到别的目录还能运行吗？为什么？（提示：`$scriptDir` 的计算方式与 `Join-Path`）

### 清理

无需清理。如果你在真实 HOME 里生成了 `~/.pi/agent/` 配置目录，可以保留；它不会影响后续实验（测试用 `test.sh` 会隔离）。

## 2.6 测试环境：`test.sh` 的隔离哲学

跑测试不能碰你的真实配置，也不能把测试生成的文件留在系统里。根目录的 `test.sh` 用一个很干净的办法实现"隔离"：

```bash
temp_parent="${TMPDIR:-/tmp}"
test_root="$(mktemp -d "$temp_parent/pi-test.XXXXXX")"
```

它在临时目录创建一个全新的测试根，然后**用最小环境变量清单**启动子进程：

```bash
test_env=(
	"PATH=$PATH"
	"PWD=$PWD"
	"HOME=$test_root/home"
	"USERPROFILE=$test_root/home"
	"TMPDIR=$test_root/tmp"
	...
	"NPM_CONFIG_CACHE=$test_root/cache/npm"
	"PI_NO_LOCAL_LLM=1"
	"AWS_EC2_METADATA_DISABLED=true"
)

...

env -i "${test_env[@]}" npm test
```

逐项读：

| 项 | 作用 |
|---|---|
| `HOME` / `USERPROFILE` | 指向测试目录：测试里读写 `~/.pi/agent` 都落在测试根里，**不碰你的真实配置** |
| `TMPDIR` / `TMP` / `TEMP` | 临时文件也隔离 |
| `XDG_CONFIG_HOME` / `XDG_CACHE_HOME` | Linux 应用的配置/缓存路径隔离 |
| `LANG=C`、`LC_ALL=C`、`TZ=UTC` | 固定语言与时区，避免本机设置影响断言 |
| `GIT_*` 系列 | 禁用交互式凭据提示（`GIT_TERMINAL_PROMPT=0`）、禁用系统/全局 git 配置 |
| `NPM_CONFIG_*` | npm 的配置、缓存隔离 |
| `PI_NO_LOCAL_LLM=1` | 禁用本地 LLM 探测（避免测试试图加载本机模型） |
| `AWS_EC2_METADATA_DISABLED=true` | 禁止 AWS SDK 探测云元数据服务 |
| `env -i` | **清空全部环境变量**，只保留上面清单里的 |

而 `npm test`（根 `package.json` 的 script）会依次运行 `test:scripts` 和所有工作区的测试。这就是本仓库的标准测试入口。

**待你验证**：在仓库根运行 `./test.sh` 需要 Bash；Windows 上请在 Git Bash 中运行（WSL 也可）。第一次运行时间较长，属正常现象。作者的规划文档要求"不直接运行全量 vitest"（有 e2e 场景会被环境变量激活），一律走 `test.sh`。学习期间你不需要频繁跑全量测试，第 18 章会教你只跑指定测试。

### 2.6.1 单测定位速查（第 18 章会展开）

先记住"不要全量跑"的原则和两个字面命令（来自 `AGENTS.md`）：

```bash
# Vitest 单文件（在对应 package 目录下执行）
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/some.test.ts

# packages/tui 用 Node 自带测试运行器（在 packages/tui 下执行）
node --test test/some.test.ts
```

## 2.7 三平台差异速查

同样的目标，三个平台的操作差异如下（内容与 `packages/coding-agent/docs/windows.md` 及平台常识核对过；表中"未实测"项请谨慎对待）。

| 主题 | Windows | Linux | macOS |
|---|---|---|---|
| 源码运行入口 | `.\pi-test.ps1`（或 `pi-test.bat`）；Git Bash 里也可 `./pi-test.sh` | `./pi-test.sh` | `./pi-test.sh` |
| 模型 `bash` 工具用的 shell | 默认 **Git Bash**（按 `shellPath` 设置 → Program Files 下的 Git Bash → PATH 上的 bash.exe 顺序查找） | 系统 Bash | 系统 Bash |
| 可选 `powershell` 工具 | 有：优先 `pwsh.exe`，回退 Windows PowerShell；启动参数 `-NoProfile -NonInteractive -ExecutionPolicy Bypass` | 无 | 无 |
| 编辑器 `!` 命令 | 仍使用 Bash（即使模型工具换成了 powershell） | Bash | Bash |
| 全局配置目录 | `C:\Users\<你>\.pi\agent` | `~/.pi/agent` | `~/.pi/agent` |
| 路径写法 | 反斜杠；JSON 里写 `\\` 或 `/` | 正斜杠 | 正斜杠 |
| 终端建议 | Windows Terminal；注意 `Shift+Enter` 等键位需配置 | 常规终端均可 | Terminal / iTerm 均可 |

两个交叉信息：

- **WSL 用户**：在 WSL 里运行 Linux 版的一切（含 `./pi-test.sh`），pi 使用 WSL 内的 Bash 与工具链；
- **想改用 PowerShell 作为模型工具**（仅原生 Windows）：在 `~/.pi/agent/settings.json` 写：

```json
{
  "defaultTools": ["read", "powershell", "edit", "write"]
}
```

或 `["-bash", "+powershell"]`（保持其他默认工具不变的前提下替换）。改完重启 pi。文档特别提醒：**`!` 和 `!!` 编辑器命令不受此设置影响，仍然使用 Bash。**

## 2.8 构建与检查命令：什么时候用哪个

根 `package.json` 里与本手册相关的主要命令（已核对）：

| 命令 | 作用 | 什么时候用 |
|---|---|---|
| `npm install --ignore-scripts` | 安装依赖（不跑生命周期脚本） | 首次获取、更新依赖 |
| `npm run check` | Biome 检查+格式化+多种仓库级检查+`tsc --noEmit` | **改完代码后**（`AGENTS.md` 要求） |
| `./test.sh` | 隔离环境跑全部非 e2e 测试 | 需要全量测试时 |
| `npm run build` | 刷新模型数据 + 构建全部包 | **不要主动运行**（本书读者不需要，除非用户要求） |
| `npm run build:offline` | 不联网、用现有模型数据构建 | 同上 |

`npm run check` 的一个关键细节：它的第一个子命令带 `--write`（自动改写格式），也就是说**它是"边修边查"的**。运行之后必须 `git diff` 审查它改了什么，别把无关的格式变更混进你的改动里。这一点在 `AGENTS.md` 和规划文档里都被特别强调，第 20 章再展开。

## 2.9 常见错误

| 现象 | 可能原因 | 定位方式 |
|---|---|---|
| `pi-test.ps1` 报"无法加载文件，因为在此系统上禁止运行脚本" | PowerShell 执行策略限制 | 用 `powershell -ExecutionPolicy Bypass -File .\pi-test.ps1 ...`，或调整执行策略（了解安全影响后再做） |
| 启动时报找不到模块 / 类型错误 | 依赖没装，或 Node 版本太低 | 重跑 `npm install --ignore-scripts`；核对 `node --version` |
| 改了源码没生效 | 你跑的是安装版 `pi` 而不是 `pi-test` | 用 `.\pi-test.ps1` / `./pi-test.sh` 运行 |
| 运行结果像是旧版本 | 有第三方工具在直接加载 `dist` | 确认走的是 `pi-test` 脚本（source-resolver 只作用于它启动的进程） |
| Windows 下 `bash` 工具不可用 | 没装 Git for Windows，且 PATH 里没有 bash | 看 pi 报出的"查找过的位置"清单；装 Git for Windows 或设置 `shellPath` |
| `./test.sh` 提示 permission denied | 没有执行位（Windows 克隆常见） | `bash test.sh` 直接调用，或在 Git Bash 中 `chmod +x test.sh` |
| `npm test` 触发联网或加载本地模型 | 直接跑了 npm 脚本而非 `test.sh` | 回到 `./test.sh`（它设置了 `PI_NO_LOCAL_LLM=1` 等隔离项） |

## 2.10 验收题

1. 说出三种运行形态各自"代码从哪来"，以及你日常学习该用哪一种。
2. `pi-test.sh` 为什么特意不 `cd` 到自己所在的目录？如果它 `cd` 了，会发生什么具体问题？
3. `source-resolver.ts` 解决的是什么问题？它宁可抛错也不做什么？
4. `test.sh` 至少隔离了哪三类东西？各自防止了什么后果？
5. 你不小心用 `pi`（安装版）测试自己修改的源码，发现"没变化"，正确的下一步是什么？

### 参考答案

1. 安装版来自发布产物（dist）；源码运行来自工作区源码（src，经 source-resolver）；测试环境来自源码但运行在隔离 HOME 中。日常学习用源码运行（`pi-test`）。
2. 因为 pi 的一切（`@文件` 解析、项目配置、资源发现、会话归类）都以"启动时的工作目录"为基准。若 `cd` 到仓库目录，会认错项目、读错配置、把会话记到错误的项目分组下。
3. 解决 Node 不认识 tsconfig 路径别名、内部导入可能落到过期 `dist` 的问题。它宁可抛错（匹配到别名却解析不到文件时报错），也不回退到旧产物。
4. 隔离了用户目录（HOME/USERPROFILE，防污染真实配置）、临时目录（TMPDIR 等，防残留）、凭据与网络探测（环境变量清空、云端元数据禁用，防测试意外联网或用真实密钥）。另加语言/时区隔离（防本机设置影响断言）。
5. 换用源码运行入口：`.\pi-test.ps1`（Windows）或 `./pi-test.sh`（Linux/macOS/Git Bash），它跑的是你修改的源码。

## 2.11 来源与下一章

- 根目录：`package.json`（engines、workspaces、scripts）、`tsconfig.json`（paths 映射）、`pi-test.sh`、`pi-test.ps1`、`pi-test.bat`、`test.sh`、`README.md`；
- `packages/coding-agent/src/experimental/cli.ts`、`packages/coding-agent/src/experimental/source-resolver.ts`；
- `packages/coding-agent/src/main.ts`（版本分支）、`packages/coding-agent/docs/cli.md`、`packages/coding-agent/docs/windows.md`；
- 本机核对：`node_modules/@earendil-works/pi-ai` 是指向 `packages/ai` 的 Junction。

下一章正式进入主线：追踪"一条用户输入变成最终回答"的完整旅程。你会第一次把 `main.ts`、`sdk.ts`、`agent-session.ts`、`agent-loop.ts`、`models.ts` 串成一条线。