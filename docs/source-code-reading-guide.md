# pi 源码阅读入门指南

> 写给不熟悉 Node.js / TypeScript 的读者。目标：读完这篇，你能看懂这个仓库的布局，理解 `npm install`、启动、测试、构建背后的完整原理，并知道从哪里开始读代码。

---

## 目录

- [A. 先建立整体心智模型](#a-先建立整体心智模型)
1. [预备知识：Node.js 和 npm 是什么](#1-预备知识)
2. [TypeScript：为什么代码里全是类型](#2-typescript)
3. [什么是 monorepo，这个仓库的布局](#3-仓库布局)
4. [package.json 逐字段解读](#4-packagejson-详解)
5. [各个 package 是干什么的](#5-各-package-职责)
6. [源码阅读路线图（推荐顺序）](#6-源码阅读路线图)
7. [把项目跑起来](#7-把项目跑起来)
8. [读代码的实用技巧](#8-读代码的实用技巧)
9. [Node.js 标准库速查](#9-nodejs-标准库速查)
10. [术语表](#10-术语表)

**深入篇：运行时原理**

- [11. Node 模块系统与依赖解析原理](#11-node-模块系统与依赖解析原理)
- [12. npm install 到底做了什么](#12-npm-install-到底做了什么)
- [13. pi 从敲下命令到启动的完整链路](#13-pi-从敲下命令到启动的完整链路)
- [14. 依赖在运行时是怎么被加载的](#14-依赖在运行时是怎么被加载的)
- [15. 构建产物是怎么来的：tsgo 与 esbuild](#15-构建产物是怎么来的tsgo-与-esbuild)
- [16. 测试是怎么跑起来的](#16-测试是怎么跑起来的)
- [17. Node 生态链全貌](#17-node-生态链全貌)

---

## A. 先建立整体心智模型

在深入细节前，先记住一句话：

> **Node.js 是一个 JavaScript 运行时；npm 是它的包管理器；package.json 是项目说明书；node_modules 是装好的依赖仓库；Node 在 import 时按一套固定算法去 node_modules 里找文件并执行。**

pi 这个仓库最特殊的一点：它是 **monorepo + TypeScript + 全 ESM**，并且源码可以直接被新版 Node 运行（类型只是"可擦除"的标注）。理解这三点，后面所有东西都顺了。

一条完整的生命周期：

```
你写的 .ts 源码
   │  (tsgo 编译，擦掉类型)
   ▼
dist/ 里的 .js
   │  (esbuild 打包，把许多文件合成少数几个)
   ▼
dist/bundle/cli.js
   │  (npm publish)
   ▼
npm registry
   │  (npm install)
   ▼
node_modules/  (每个包一个目录，workspace 用软链接)
   │  (node 解析 import，找到文件)
   ▼
进程运行：main() 开始干活
```

下面从基础讲起，最后一节（第 17 节）会把这张图再完整展开。

---

## 1. 预备知识

### 1.1 Node.js 是什么

Node.js 是一个能直接运行 JavaScript 的程序（运行时）。浏览器里的 JS 只能操作网页，而 Node.js 让 JS 能读写文件、发网络请求、启动子进程——也就是做系统级的事。pi 就是一个纯 Node.js 程序：你在终端输入 `pi`，实际是 Node.js 在执行 pi 的 JS 代码。

三个核心概念：

- **单线程 + 事件循环（event loop）**：Node.js 默认只有一个线程跑你的代码，遇到耗时操作（读文件、等网络响应）不会傻等，而是注册一个"回调"，继续干别的，等操作完成后再回来执行回调。这就是为什么代码里到处是 `async/await`。
- **模块化**：每个 `.js`/`.ts` 文件是一个独立模块，通过 `import` / `export` 共享代码。pi 全部使用 **ESM**（ECMAScript Modules，官方标准）。
- **npm**：Node.js 的包管理器。别人写好的库发布到 npmjs.com，你用 `npm install xxx` 装进 `node_modules/`，然后 `import` 它。

### 1.2 npm 项目的基本骨架

```
my-project/
├── package.json      # 项目说明书：名字、依赖、脚本命令
├── node_modules/     # npm install 装下来的所有第三方依赖（巨大，不进 git）
├── package-lock.json # 依赖的精确版本锁（保证每个人装到完全相同的版本）
├── src/              # 你的源代码
├── test/             # 测试代码
└── dist/             # 编译/构建产物（源码 → 可运行 JS），不进 git
```

### 1.3 常用 npm 命令

| 命令 | 作用 |
|---|---|
| `npm install` | 按 package.json 安装所有依赖到 node_modules |
| `npm run <脚本名>` | 执行 package.json 里 `scripts` 定义的命令 |
| `npm run build` | 通常执行编译/打包 |
| `npm test` | 通常执行测试 |
| `npx <命令>` | 临时运行某个命令行工具（不必全局安装） |

---

## 2. TypeScript

TypeScript (TS) = JavaScript + **静态类型**。你多写了类型标注，编译器帮你提前抓 bug。浏览器和 Node.js 本身不认识 TS，所以要先"编译"成 JS 才能运行。

```ts
// TypeScript
function greet(name: string): string {
	return `hello, ${name}`;
}
```

`: string` 就是类型标注，表示"这个参数必须是一个字符串"。

**本仓库的特殊之处**（读代码前必须知道）：

- 源码在 `packages/*/src`，全部是 TypeScript。
- 这个仓库用 `erasableSyntaxOnly` 编译选项：TS 代码里只允许"可以擦除"的语法（纯类型标注）。编译 = 把类型擦掉，剩下的就是 JS。所以**源码可以被新版 Node 直接运行**（Node 22.18+ 默认支持类型擦除）。
- 源码里的相对导入**带 `.ts` 后缀**，例如 `import { main } from "./main.ts"`。这不是写错，是本仓库的约定（配合 `rewriteRelativeImportExtensions` 选项）。编译时会被改写成 `./main.js`。
- 编译工具不是传统 `tsc`，而是 `tsgo`（TypeScript 的原生加速版），打包用 `esbuild`（极快的打包器）。

这一点非常关键，第 14、15 节会详细解释"为什么源码能带 `.ts`、编译后变 `.js`、而运行时又能正确找到文件"。

---

## 3. 仓库布局

### 3.1 什么是 monorepo

monorepo = 一个 git 仓库里装多个独立的包（package）。pi 由十几个包组成，它们互相依赖、版本同步发布，放一个仓库方便统一管理。npm 用 **workspaces**（工作区）机制支持这种结构：根目录 `npm install` 一次，所有包的依赖都装好，包之间互相引用也不用发布到 npm。

### 3.2 根目录一览

```
pi/
├── package.json          # monorepo 根配置：workspaces 列表、全局脚本
├── package-lock.json     # 全仓库依赖锁
├── tsconfig.json         # TypeScript 根配置（各包继承 tsconfig.base.json）
├── tsconfig.base.json    # 所有包共享的编译选项
├── biome.json            # Biome 配置（代码格式化 + lint 检查工具）
├── vitest.base.ts        # Vitest 测试框架的基础配置
├── AGENTS.md             # 给 AI 编码助手看的开发规则
├── CONTRIBUTING.md       # 贡献指南
├── scripts/              # 仓库级维护脚本（构建、发布、各种一致性检查）
├── node_modules/         # 依赖（不进 git）
├── test.sh               # 跑非 e2e 测试的入口
└── packages/             # ★ 所有源代码都在这里
```

### 3.3 packages/ 目录

```
packages/
├── ai/              # 统一的多家大模型 API 封装
├── agent/           # 通用 Agent 运行时（工具调用循环、状态管理）
├── coding-agent/    # ★ pi 本体：终端编码助手 CLI（你每天用的就是它）
├── tui/             # 终端 UI 库（差分渲染、编辑器组件等）
├── chord/           # 应用组合运行时（服务、RPC、插件）
├── client/          # 远程会话客户端（走 CBOR 二进制协议）
├── server/          # 实验性的 pi 服务器
├── protocol/        # 远程会话的二进制协议定义
├── durable/         # 持久化运行时（会话/任务/文档存储）
├── telemetry/       # 遥测（tracing/指标）契约
├── session-backends/  # 会话存储后端（如 sqlite）
└── evals/           # 评测套件（私有，不发布）
```

依赖方向大致是：

```
coding-agent ──► agent ──► ai
     │            │
     └────► tui ◄──┘        （tui 是纯 UI，不依赖上面的业务包）
```

每个包内部结构高度一致（这是读代码的好消息）：

```
packages/xxx/
├── package.json    # 包名、导出路径、构建脚本
├── src/            # ★ 源码，你 99% 的时间都在这里
│   └── index.ts    # 包的公共出口：想知道"这个包对外提供什么"，先看它
├── test/           # 测试
└── dist/           # 构建产物（tsgo 编译输出，不进 git）
```

---

## 4. package.json 详解

以根 `package.json` 和 `packages/coding-agent/package.json` 为例，逐个解释关键字段：

```jsonc
{
	"name": "@earendil-works/pi-coding-agent",  // 包名，@开头是 npm 的"组织/包名"格式
	"version": "0.87.1",                        // 版本号：主版本.次版本.补丁
	"type": "module",                           // ★ 表示用 ESM（import/export），不是老的 require
	"main": "./dist/index.js",                  // 别的包 import 它时默认加载的文件（旧字段）
	"types": "./dist/index.d.ts",               // 类型声明文件（编辑器靠它做代码提示）
	"bin": { "pi": "dist/bundle/cli.js" },      // ★ 全局安装后，终端敲 pi 就执行这个文件
	"exports": { ... },                         // ★ 对外暴露哪些子路径（白名单）
	"files": [ "dist", "docs", ... ],           // 发布到 npm 时只带这些目录
	"scripts": { ... },                         // 可用 npm run 执行的命令
	"dependencies": { ... },                    // 运行时依赖（打进发布包）
	"devDependencies": { ... },                 // 开发期依赖（编译/测试用，不发布）
	"engines": { "node": ">=22.19.0" }          // 要求的 Node.js 最低版本
}
```

三个最值得理解的字段：

- **`bin`**：说明 pi 这个命令怎么来的。全局安装 `@earendil-works/pi-coding-agent` 后，系统里出现 `pi` 命令，它指向 `dist/bundle/cli.js`。
- **`exports`**：包的"API 窗口"。例如 `"./providers/*": "./dist/providers/*.js"` 表示你可以 `import ... from "@earendil-works/pi-ai/providers/anthropic"`。不在 exports 里的路径 import 不到。
- **`scripts`**：根目录常用的有：

| 脚本 | 干什么 |
|---|---|
| `npm run build` | 按依赖顺序编译所有包（chord → tui → ... → coding-agent） |
| `npm run check` | 一站式检查：格式、lint、类型检查、依赖一致性（改完代码必跑） |
| `npm test` | 跑所有包的测试 |

---

## 5. 各 package 职责

按"由底向上"的层次说明：

### `packages/ai` — 大模型统一接口

把 OpenAI、Anthropic、Google 等几十家模型 API 封装成一套统一接口。

- `src/types.ts` — 核心类型：`Context`（对话上下文）、`Message`、`Tool`、`AssistantMessage` 等，**整个仓库的"词汇表"**
- `src/models.ts` + `src/models.generated.ts` — 模型目录（后者是脚本自动生成的，别手改）
- `src/providers/` — 每个厂商一个文件（`anthropic.ts`、`openai.ts`…），`.models.ts` 是模型元数据
- `src/index.ts` — 对外的流式补全入口

### `packages/agent` — Agent 运行时

"Agent = 大模型 + 工具调用循环"这层抽象。

- `src/agent-loop.ts` — **核心循环**：发请求 → 收到工具调用 → 执行工具 → 把结果喂回模型 → 重复，直到模型不再调工具
- `src/agent.ts` — Agent 对象与状态管理
- `src/types.ts` — `AgentTool`、事件等类型
- `src/harness/` — 会话、压缩（compaction）、系统提示词等"驾驶舱"组件

### `packages/coding-agent` — pi 本体（CLI）

最大的包，pi 的全部产品逻辑。

- `src/cli.ts` / `src/main.ts` — **进程入口**：解析命令行参数，组装会话
- `src/cli/` — 参数定义、首次启动引导、会话选择器等启动期 UI
- `src/core/` — 核心业务：
  - `agent-session.ts` — AgentSession，pi 的心脏（消息、队列、steering、abort）
  - `tools/` — 内置工具实现：`read.ts`、`bash.ts`、`edit.ts`、`write.ts`、`grep.ts`…（每个文件自带渲染器）
  - `system-prompt.ts` — 系统提示词的组装
  - `session-manager.ts` / `compaction/` — 会话保存（JSONL）与上下文压缩
- `src/modes/` — 四种运行模式：
  - `interactive/` — 交互式 TUI（最大的一块，用 pi-tui 渲染）
  - `print-mode.ts` — 一次性输出
  - `json-event.ts` — JSONL 事件流输出
  - `rpc/` — RPC 模式（stdin/stdout 上的 JSONL 协议）
- `src/config.ts` — 配置目录、版本号等全局常量

### `packages/tui` — 终端 UI 库

自研的终端渲染库，被 interactive 模式使用。

- `src/tui.ts` — TUI 主类（差分渲染：只重画变化的格子）
- `src/components/` — 组件：编辑器 `editor.ts`、`markdown.ts`、`select-list.ts`、布局（`v-stack.ts`/`h-stack.ts`）等
- `src/keys.ts` / `src/keybindings.ts` — 按键解析与可配置键位
- `native/` — 各平台的 C 原生模块（剪贴板等），可忽略

### 其余包

`chord`（服务/RPC 运行时）、`client`+`protocol`+`server`（远程会话三件套）、`durable`（持久化）、`telemetry`（遥测）、`session-backends/sqlite-node`（sqlite 存储后端）、`evals`（评测）。第一遍阅读可以全部跳过。

---

## 6. 源码阅读路线图

不要从第一个文件顺着读。按下面的顺序，每一步都有明确的问题驱动：

**第 0 步：先读两篇文档**
- `packages/coding-agent/docs/how-pi-works.md` — 10 分钟讲清 pi 的工作原理（agent loop、会话树、上下文组装）
- `README.md` — 包之间的关系

**第 1 步：搞清"一次对话发生了什么"（packages/agent）**
1. `packages/ai/src/types.ts` — 认识 `Context`、`Message`、`ToolCall` 这些名词
2. `packages/agent/src/agent-loop.ts` — 工具调用循环。带着问题读：模型返回一个工具调用后，代码走到哪里？结果怎么拼回请求？

**第 2 步：看 pi 怎么启动（packages/coding-agent）**
1. `src/cli.ts`（只有几行）→ `src/main.ts` — 参数解析、创建会话
2. `src/core/agent-session.ts` — AgentSession 类。不用读完，重点看事件和消息队列

**第 3 步：挑一个工具看实现**
- `src/core/tools/read.ts` — 读文件工具。看它如何校验参数、读文件、截断、渲染给模型看的结果。再对比 `bash.ts`、`edit.ts`。

**第 4 步：看会话怎么存**
- `src/core/session-manager.ts` — JSONL 格式，每条记录一个事件，形成树

**第 5 步（可选）：UI 层**
- `src/modes/interactive/interactive-mode.ts` + `packages/tui/src/tui.ts`

每读一个包，先看 `src/index.ts`（公共出口），它告诉你这个包认为哪些东西是"正式 API"。

---

## 7. 把项目跑起来

前置要求：Node.js >= 22.19（`node -v` 检查）。

```bash
# 1. 安装依赖（整个 monorepo 一次装完）
npm install --ignore-scripts

# 2. 构建所有包（产出各包 dist/）
npm run build

# 3. 直接运行本地构建的 pi
node packages/coding-agent/dist/cli.js --help

# 或者用 tsx 直接跑 TypeScript 源码（免编译，改完即生效）
npx tsx packages/coding-agent/src/cli.ts --help
```

开发工作流：

```bash
npm run build --workspace=@earendil-works/pi-tui   # 只构建某个包
# 在某个包目录下跑单个测试文件：
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/xxx.test.ts
./test.sh                                           # 仓库根目录，跑全部非 e2e 测试
npm run check                                       # 格式 + lint + 类型 + 一致性检查（提交前必跑）
```

调试建议：在 VS Code 里用 `npx tsx --inspect-brk packages/coding-agent/src/cli.ts` 启动，然后在浏览器 `chrome://inspect` 里打断点单步执行——这是理解调用链最快的方式。

---

## 8. 读代码的实用技巧

1. **用 IDE 的跳转**。VS Code + TypeScript：`F12` 跳到定义、`Shift+F12` 找所有引用。读不熟悉的代码，沿着"调用链"跳着读，比顺序读有效得多。
2. **用 ripgrep 全局搜索**：

   ```bash
   rg "createAgentSession" packages/       # 找一个函数在哪定义/使用
   rg -t ts "steering" packages/coding-agent/src   # 按关键词搜
   ```

3. **从 import 语句反推结构**。看 `main.ts` 顶部 import 了哪些本地模块，就知道了入口依赖图。
4. **类型即文档**。遇到不懂的函数，先看参数和返回值的类型定义（`types.ts` 通常是起点）。本仓库注释密度高，函数头部注释值得读。
5. **git log 看演化**：`git log --oneline -- packages/agent/src/agent-loop.ts` 看某个文件的历史，比读代码更快理解"为什么这样写"。
6. **问 AI**：pi 本身就能读自己的代码。在仓库里运行 pi，直接问"agent loop 是怎么处理工具调用的？"。

---

## 9. Node.js 标准库速查

读源码时高频出现的 Node 内置模块（都以 `node:` 前缀导入）：

| 导入 | 用途 |
|---|---|
| `node:fs` | 读写文件（`readFileSync`、`createReadStream`…） |
| `node:path` | 路径拼接/解析（`join`、`resolve`、`dirname`），跨平台安全 |
| `node:process` | 进程信息：`process.argv`（命令行参数）、`process.env`（环境变量）、`process.exit` |
| `node:child_process` | 启动子进程（pi 的 bash 工具就靠它） |
| `node:events` | 事件发射器 `EventEmitter`（on/emit 模式） |
| `node:stream` | 流式数据处理（模型的流式响应就是流） |
| `node:http` / `node:https` | HTTP 服务与请求 |
| `node:readline` | 逐行读取（交互输入、JSONL 解析） |
| `node:url` | `fileURLToPath(import.meta.url)`：把模块 URL 转成文件路径 |
| `node:module` | `createRequire`、`enableCompileCache` 等模块系统工具 |
| `node:crypto` | 哈希、随机数 |

异步语法速记：

```ts
const data = await fs.readFile(p);   // await：等 Promise 完成，拿到结果再往下走
try { ... } catch (e) { ... }        // async 函数里用 try/catch 捕获错误
```

---

## 10. 术语表

| 术语 | 含义 |
|---|---|
| monorepo | 一个 git 仓库管理多个包 |
| workspace | npm workspaces，monorepo 里互相可链接的子包 |
| ESM / CJS | JS 的两代模块系统；`import/export` vs `require`。pi 全用 ESM |
| `dist/` | 编译产物目录（TS → JS），由 build 生成，不进 git |
| tsgo | TypeScript 原生加速编译器（`@typescript/native-preview`），本仓库用它构建 |
| esbuild | 极快的 JS 打包器，把很多文件打成少量 bundle 文件 |
| bundle | 打包产物；pi 的 `pi` 命令就是 `dist/bundle/cli.js` |
| Biome | 代码格式化 + lint 工具（本仓库用 `npm run check` 调它） |
| Vitest | 测试框架（`tui` 包用 Node 自带的 `node --test`） |
| JSONL | 每行一个 JSON 对象的文本格式；pi 的会话文件和 JSON/RPC 模式都用它 |
| CBOR | 二进制 JSON 替代格式，用于远程会话协议（packages/protocol） |
| steering | 在模型回答生成期间插入新消息改变其方向 |
| compaction | 压缩历史上下文为摘要，避免超出模型窗口 |
| e2e test | 端到端测试，会真实调用模型 API，默认不跑 |
| husky | git 钩子工具，本仓库用它做 pre-commit 检查 |
| bare specifier | 不带 `./` 或 `/` 的导入名，如 `"@earendil-works/pi-ai"`，Node 会去 node_modules 找 |
| symlink（软链接） | 一个指向真实文件的"快捷方式"；npm workspaces 就靠它把包互相连起来 |

---

# 深入篇：运行时原理

下面几节回答"为什么"和"怎么发生"。如果你想真正看懂 Node 项目，这部分比记住目录结构更重要。

---

## 11. Node 模块系统与依赖解析原理

### 11.1 为什么要"解析"

代码里写 `import { x } from "some-pkg"` 时，Node 需要把它翻译成一个**磁盘上的真实文件路径**，然后读取、执行。这个翻译过程就叫 **模块解析（module resolution）**。

JS 历史上有两套模块系统：

| | CommonJS (CJS) | ES Modules (ESM) |
|---|---|---|
| 语法 | `const x = require("pkg")` | `import { x } from "pkg"` |
| 出现 | 2009，Node 早期 | 2015 起，JS 官方标准 |
| 加载 | 同步，运行时按需 | 静态分析（import 在顶层），异步准备 |
| 文件扩展名 | 可省略（`require("./x")` 能找到 `x.js`） | 必须写全（`import "./x.js"`） |

**pi 全部用 ESM。** package.json 里的 `"type": "module"` 就是在告诉 Node："这个包里的 `.js` 文件请按 ESM 解析"。没有这行，Node 会把 `.js` 当成老的 CJS。

### 11.2 import 说明符的四种类型

Node 看到 `import ... from "X"` 时，先给 X 分类：

1. **内置模块**：以 `node:` 开头，如 `node:fs`、`node:path`。直接由 Node 提供。
2. **相对/绝对路径**：以 `./`、`../`、`/` 开头。直接按路径找文件，**ESM 下必须带扩展名**。这就是 pi 源码写 `"./main.ts"` 的原因。
3. **URL**：以 `file://`、`data:`、`http:` 开头（ESM 特有）。
4. **裸说明符（bare specifier）**：其它一切，如 `"chalk"`、`"@earendil-works/pi-ai"`。这种要去 `node_modules` 里找——下面详细说。

### 11.3 裸说明符的解析算法（重点）

假设你的代码在 `packages/coding-agent/src/main.ts`，写了一句：

```ts
import { createAgentSession } from "@earendil-works/pi-agent-core";
```

Node 的步骤：

1. **从当前文件所在目录开始**，逐级向上查找名为 `node_modules` 的目录：
   ```
   packages/coding-agent/src/node_modules
   packages/coding-agent/node_modules
   packages/node_modules
   pi/node_modules          ← 找到了
   /mnt/d/Github/node_modules
   ...
   ```
   一直找到文件系统的根目录为止。
2. 在该 `node_modules` 下找**与包名完全对应的目录**。包名 `@earendil-works/pi-agent-core` 会映射到 `node_modules/@earendil-works/pi-agent-core/`（`@scope/name` 是两级目录）。
3. 进入这个包目录，读**它自己的 `package.json` 的 `exports` 字段**（或旧的 `main` 字段），确定"`.` 这个子路径对应哪个文件"。例如 `packages/agent/package.json` 里：
   ```jsonc
   "exports": {
     ".": {                            // "." 表示裸包名本身（无子路径）
       "types": "./dist/index.d.ts",
       "import": "./dist/index.js"
     },
     "./node": { "import": "./dist/node.js" }   // 对应 import ".../pi-agent-core/node"
   }
   ```
   条件是 `import`（因为我们现在是 ESM 导入），所以最终文件是 `.../pi-agent-core/dist/index.js`。
4. 读取该 `.js` 文件，递归解析它自己的 import，形成一个模块图。

如果 `exports` 里没有匹配的子路径，Node 会报 `ERR_PACKAGE_PATH_NOT_EXPORTED`——这就是 `exports` 作为"API 白名单"的作用。

### 11.4 workspace 的下手：软链接

在 monorepo 里，`node_modules/@earendil-works/pi-agent-core` **不是一个真实目录，而是指向 `packages/agent/` 的软链接**。实际装出来是这样：

```
node_modules/@earendil-works/
├── chord            -> /mnt/d/Github/pi/packages/chord
├── pi-agent-core    -> /mnt/d/Github/pi/packages/agent
├── pi-ai            -> /mnt/d/Github/pi/packages/ai
├── pi-coding-agent  -> /mnt/d/Github/pi/packages/coding-agent
├── pi-tui           -> /mnt/d/Github/pi/packages/tui
└── ...
```

所以第 11.3 节的第 2 步找到的目录，其实就是 `packages/agent/`。这就是"包之间互相 import 却不用先发布"的原理。

> 注意：Node 默认会**解析软链接到真实路径**（除非加 `--preserve-symlinks`）。所以 `@earendil-works/pi-agent-core` 实际加载的是 `packages/agent/dist/index.js`。

### 11.5 "带 `.ts` 后缀的源码导入"如何自洽

这可能是本仓库最让人困惑的点，一次性讲清：

| 场景 | 导入写法 | 谁在处理 | 实际加载 |
|---|---|---|---|
| 直接跑源码（tsx / Node 类型擦除） | `import "./main.ts"` | tsx / Node 类型擦除 | `main.ts` 源码 |
| 编译后（tsgo） | 源码写 `./main.ts`，编译产物里变成 `./main.js` | tsgo 的 `rewriteRelativeImportExtensions` | `main.js` |
| 打包后（esbuild） | esbuild 从 `dist/*.js` 出发 | esbuild | 内联进 bundle |

关键点：**源码里写的 `.ts` 是给运行时看的，编译时会被改写成 `.js`。** 因为编译前 Node/tsx 看到 `.ts` 能直接加载；编译后 `dist/` 里只有 `.js`，所以导入路径必须也跟着改成 `.js`。`rewriteRelativeImportExtensions` 这个选项自动完成改写。

这样一来：
- 开发时 `npx tsx src/cli.ts` 能跑（源码带着 `.ts` 导入）。
- 构建后 `node dist/cli.js` 也能跑（导入已被改成 `.js`）。

### 11.6 条件导出（conditional exports）

`exports` 里的对象可以按条件选不同文件：

```jsonc
"exports": {
  ".": {
    "source": "./src/index.ts",   // 某些工具（如 vitest）优先用这个，直接吃源码
    "types": "./dist/index.d.ts", // 编辑器/类型检查用
    "import": "./dist/index.js",  // 运行时（ESM）用这个
    "require": "./dist/index.cjs" // 若有人用 CJS require（pi 基本不用）
  }
}
```

Node 按顺序匹配条件：它总带 `import`/`require`/`node`/`default` 这些条件；`types`、`source` 是给 TS/vitest 等工具用的。第 16 节会看到 vitest 正是用 `source` 或 alias 直接跑源码、跳过构建。

### 11.7 模块缓存

一个模块**只会被求值一次**。第一次 import 时执行它，结果缓存起来；后续任何再 import 同一路径都直接拿缓存。所以 Node 里没有"重新执行一次模块"的概念（除非删缓存或换 URL）。`import.meta.url` 是当前模块自己的文件 URL，常用 `fileURLToPath(import.meta.url)` 拿到路径来做相对定位。

---

## 12. npm install 到底做了什么

`npm install` 远不止"下载文件"。它是一条流水线：

### 步骤 1：读说明书
npm 读根 `package.json`，看到：

```jsonc
"workspaces": [
  "packages/*",
  "packages/session-backends/*",
  "packages/coding-agent/examples/extensions/with-deps",
  ...
]
```

这告诉 npm："`packages/*` 每个目录都是一个子包，请一起处理"。

### 步骤 2：解析依赖图
npm 读所有子包的 `dependencies` / `devDependencies`，构建一张**依赖图**。依赖有版本范围（如 `^0.87.1`），npm 要算出每个包最终用哪个精确版本。若版本冲突，可能需要在不同层级放不同版本（node_modules 允许嵌套）。

### 步骤 3：读/写 lockfile
`package-lock.json` 记录了上次安装的**精确版本 + 下载地址 + 完整性哈希**。有它就复现完全一致的依赖树；没有（或 package.json 变了）就重新向 registry 查询并更新 lockfile。

### 步骤 4：下载并解压
npm 把每个包从 npm registry 下载（tarball，`.tgz`），解压到 `node_modules/<包名>/`。相同包尽量"扁平化"提升到顶层，减少重复。

### 步骤 5：为 workspace 建软链接（关键）
对每个 workspace 子包，npm 在 `node_modules/<包名>` 建立**软链接**指向 `packages/<真实目录>`（就是第 11.4 节看到的那些）。这样包 A import 包 B 时，走的是源码所在的真实目录，拿到的永远是本地最新代码，无需发布。

### 步骤 6：建立可执行文件（.bin）
若某个包声明了 `bin`（如 pi 的 `"pi": "dist/bundle/cli.js"`），npm 会在 `node_modules/.bin/pi` 建一个入口（软链接或 Windows 下的 `.cmd`/`.ps1` 包装脚本）。当你在终端或脚本里直接写 `pi` 时，npm/npx 会把 `node_modules/.bin` 加进 PATH，于是找到它。

本仓库因为你还没构建 `dist/`，所以现在 `node_modules/.bin/pi` 可能不存在；构建后再装/链接才出现。日常本地运行直接用 `node packages/coding-agent/dist/cli.js` 即可。

### 步骤 7：运行 lifecycle scripts
npm 会执行包声明的 `preinstall` / `install` / `postinstall` 等脚本。这些脚本能运行任意代码，是**安全风险点**（恶意包可借此执行命令）。

本仓库用：

```bash
npm install --ignore-scripts
```

`--ignore-scripts` 表示**跳过所有 lifecycle 脚本**，只做下载和解压。仓库还有 `scripts/check-runtime-deps.mjs` 等检查、`generate-coding-agent-shrinkwrap.mjs` 的白名单机制，专门审查带脚本的依赖。这是"依赖供应链安全"的实践。

### 步骤 8：husky（git 钩子）
根 `package.json` 有 `"prepare": "husky"`。`prepare` 是 npm 的一个生命周期：在 `npm install` 后自动跑。husky 会安装 git 钩子（如 pre-commit 时跑检查）。因为你用了 `--ignore-scripts`，这步会被跳过——需要时手动 `npx husky` 或按项目文档处理。

### 一句话总结

> `npm install` = 读 workspaces → 解析并锁定版本 → 下载解压依赖 → 软链接本地包 → 建 .bin → （可选）跑脚本。

---

## 13. pi 从敲下命令到启动的完整链路

现在把"启动"拆开看。pi 有三种启动方式，先看最标准的（全局安装）。

### 13.1 方式一：全局安装后敲 `pi`

```
$ pi
```

发生的事：

1. **shell 找命令**：shell 在 `PATH` 里逐个目录找名为 `pi` 的可执行文件。npm 全局安装时把它放在全局 `bin` 目录（如 `~/.npm-global/bin/pi` 或 Windows 的 `%APPDATA%\npm\pi.cmd`）。
2. **shebang**：`pi` 文件的第一行是 `#!/usr/bin/env node`。操作系统据此知道"用 node 来执行这个文件"。
3. **Node 启动我们的 bundle**：Node 进程启动，加载入口文件 `dist/bundle/cli.js`。
4. **bundle 的 launcher 内容**（源码见 `scripts/build-coding-agent-bundle.mjs` 末尾）：
   ```js
   #!/usr/bin/env node
   import { createRequire, enableCompileCache } from "node:module";
   enableCompileCache();                     // 开启 V8 编译缓存，二次启动更快
   createRequire(import.meta.url)("./cli-runtime.js");  // 加载真正的程序
   ```
   真正的逻辑在 `cli-runtime.js`（由 esbuild 从编译后的 `dist/cli.js` 打包而来）。
5. **进入源码入口**。`cli-runtime.js` 对应的源码是 `src/cli.ts`，全文只有几行：
   ```ts
   #!/usr/bin/env node
   import { setupCli } from "./cli/setup.ts";
   import { main } from "./main.ts";

   setupCli();                              // 一次性初始化（设置标题、HTTP 代理等）
   main(process.argv.slice(2));             // 把命令行参数（去掉 node 和脚本路径）交给 main
   ```
   `process.argv` 是 Node 给的原始参数数组：`[node路径, 脚本路径, ...用户参数]`，所以 `.slice(2)` 取用户真正传的参数。
6. **`main()` 做这些事**（`src/main.ts`）：
   - 调用 `parseArgs()` 解析 `--help`、`--model`、`--mode` 等参数（`src/cli/args.ts`）
   - 决定运行模式：`interactive` / `print` / `json` / `rpc`
   - 构建 `ModelRuntime`（模型列表、凭据、刷新）
   - 组装 Agent 服务（`createAgentSessionServices` / `createAgentSessionRuntime`）
   - 需要时做项目信任检查、首次启动引导、会话选择
7. **按模式分派**（`src/main.ts` 末尾）：
   ```ts
   if (appMode === "rpc") {
     await runRpcMode(runtime);
   } else if (appMode === "interactive") {
     const interactiveMode = new InteractiveMode(runtime, {...});
     await interactiveMode.run();           // 进入终端 UI 主循环
   } else {
     const exitCode = await runPrintMode(runtime, {...});  // 打印模式
   }
   ```
8. **进程结束**：模式返回后，事件循环里没有待处理任务，Node 进程退出（退出码由 `process.exitCode` 决定）。

### 13.2 方式二：源码构建后直接跑

```bash
node packages/coding-agent/dist/cli.js --help
```

区别只在第 3 步：直接执行的是**未打包的** `dist/cli.js`（tsgo 从 `src/cli.ts` 编译而来），它 `import "./main.js"`，Node 按第 11 节的算法加载 `dist/` 下的一堆 `.js` 文件。此时依赖（`chalk`、`undici` 等）通过 `node_modules` 解析，本地 `@earendil-works/*` 包通过第 11.4 节的软链接解析。

### 13.3 方式三：不构建，直接跑源码

```bash
npx tsx packages/coding-agent/src/cli.ts --help
```

`tsx` 是一个"能直接执行 TS 的 Node 包装器"。它在内部即时把 TS 转成 JS 再交给 Node 运行（类似"运行时编译"）。适合开发时改一行立刻见效。注意：Node 22.18+ 本身也能类型擦除运行 `.ts`（这正是本仓库 `erasableSyntaxOnly` 的原因），但 tsx 兼容性更广、支持更多场景。

### 13.4 为什么要有 esbuild 打包

未打包的 `dist/cli.js` 启动时要 import 成百上千个文件，磁盘 I/O 多、启动慢。esbuild 把所有内部模块**静态合并**成少数几个文件（`cli-runtime.js` + 一些按需加载的 chunk），带来：

- **启动快**：文件数从上千降到个位数
- **分发简单**：`bin` 就指向一个稳定的 `cli.js`
- **可选懒加载**：某些大依赖（如 Bedrock、各 OAuth 实现）被 esbuild 拆成独立文件，只有真正用到时才 `import()`（见脚本里的 lazy loaders），进一步减小常驻内存和启动成本

打包时有一份 `external` 名单（`@earendil-works/chord`、`photon-node`、`jiti`、原生加速模块等），这些保持"外部依赖"，运行时再去 `node_modules` 里加载。打包脚本最后还会**校验**：bundle 里不允许出现名单之外的外部 import，防止意外漏打包。

---

## 14. 依赖在运行时是怎么被加载的

把第 11 节的解析算法和第 13 节的启动串起来，运行时加载依赖的全景是：

### 14.1 内置 vs 第三方 vs 本地包

| import 写法 | 解析方式 | 例子 |
|---|---|---|
| `import ... from "node:fs"` | Node 内置，不走磁盘 | `node:path`、`node:process` |
| `import ... from "chalk"` | 逐级向上找 `node_modules/chalk`，读其 package.json 的 exports/main | 大量第三方库 |
| `import ... from "@earendil-works/pi-ai"` | 找到 `node_modules/@earendil-works/pi-ai`（workspace 软链接）→ 真实目录 `packages/ai` → 其 exports | 仓库内部包 |
| `import ... from "./tools/read.ts"` | 相对路径，直接定位文件 | 包内模块 |
| `import("./big-module.js")` | 动态 import，运行时才加载（懒加载） | OAuth、Bedrock 等 |

### 14.2 三个解析上下文（同一份代码，不同解析结果）

这是理解 monorepo 的关键：**同一句 `@earendil-works/pi-ai` 在不同上下文里会被解析到不同地方**。

1. **生产/普通 Node 运行**：走 `packages/ai/dist/index.js`（编译产物），依赖各包的 `dist/`。
2. **类型检查（tsgo / 编辑器）**：走 `tsconfig.json` 的 `paths`，映射到 `packages/ai/src/index.ts`（源码），这样编辑器能看到最新源码类型。
3. **测试（vitest）**：走 `vitest.base.ts` 的 `resolve.alias`，也映射到 `packages/*/src/index.ts`（源码），见第 16 节。

所以 monorepo 里"源码 / 编译产物 / 测试"三套解析路径是**故意分开配置**的。读代码时如果奇怪"为什么编辑器能跳到源码而运行的是 dist"，答案就在这里。

### 14.3 依赖的传递性（transitive dependencies）

pi 的 `node_modules/` 里不仅有直接依赖，还有依赖的依赖。`packages/coding-agent` 依赖 `chalk`，`chalk` 又可能有自己的依赖。它们都被装进（尽量扁平的）`node_modules`。Node 只认"从当前文件逐级向上找"的规则，所以无论嵌套多深，只要在最上层或就近的 node_modules 里，就能找到。

### 14.4 版本冲突怎么解决

如果包 A 要 `foo@1`，包 B 要 `foo@2`，npm 无法在同一个 `node_modules/foo` 放两个版本。它会：
- 把其中一个（通常是较顶层常用的）放顶层 `node_modules/foo`
- 另一个放进冲突包自己的 `node_modules/foo`（`packages/A/node_modules/foo`）

Node 的"逐级向上查找"天然支持这种嵌套：A 先找到自己目录下的，B 找到顶层的。pi 里用 `overrides`（根 package.json 的 `"protobufjs": "7.6.6"`）强制统一某些有问题的传递依赖版本。

---

## 15. 构建产物是怎么来的：tsgo 与 esbuild

构建分两个独立阶段，都在各包 `package.json` 的 `scripts.build` 里：

### 15.1 阶段一：tsgo 编译（TS → JS + 类型声明）

```jsonc
// packages/coding-agent
"build:unbundled": "tsgo -p tsconfig.build.json && shx chmod +x dist/cli.js dist/rpc-entry.js && npm run copy-assets"
```

`tsgo -p tsconfig.build.json` 做：
- 把所有 `src/**/*.ts` 编译成 `dist/**/*.js`
- 生成 `.d.ts` 类型声明（供别的包/编辑器用）
- 把 `import "./main.ts"` 改写成 `import "./main.js"`（`rewriteRelativeImportExtensions`）
- 把 `@earendil-works/pi-ai` 等 workspace 导入**保留为裸说明符**（不内联），这样发布后运行时还能通过 node_modules 找到它

`tsconfig.build.json` 里还有一份 `paths`，把 workspace 包指向**别的包的 `dist/*.d.ts`**（而不是源码）——因为编译本包时假设别的包已构建完成。这就是为什么根 `npm run build` 必须按依赖顺序（chord → tui → telemetry → ai → durable → agent → sqlite → protocol → client → server → coding-agent）执行。

### 15.2 阶段二：esbuild 打包（多文件 → 少数文件）

```jsonc
"build": "npm run build:unbundled && node ../../scripts/build-coding-agent-bundle.mjs"
```

`build-coding-agent-bundle.mjs` 从**已编译的** `dist/*.js` 出发（注意：是 dist，不是 src），用 esbuild：
- `bundle: true`：追踪所有 import，把内部模块内联
- `format: "esm"`、`platform: "node"`、`target: "node22.19"`：产出 Node ESM
- `external: [...]`：列表里的包不打进去
- 多个 `entryPoints`：`cli`、`index`、`rpc-entry` 各一个入口
- `splitting: true`：把共享代码拆成 chunk，减少重复
- 自定义 plugins：如把 `jiti/static` 换成懒加载 require、修正 `https-proxy-agent` 的具名导出
- 最后写一个 launcher `cli.js`（`enableCompileCache` + require 真身）

注意脚本注释里一句重要的话：打包时 `tsconfigRaw: { compilerOptions: {} }`，即**故意不套用 monorepo 的源码路径别名**。因为发布后要按"安装成 npm 包"的方式解析依赖，而不是按源码开发时的别名。

### 15.3 为什么构建顺序重要

`coding-agent` 的 `tsconfig.build.json` 把 `@earendil-works/pi-ai` 指向 `../ai/dist/index.d.ts`。如果 ai 还没构建，就没有 `dist/`，编译会失败。所以构建必须是拓扑序（依赖先构建）。这也是根脚本拆成一长串 `cd` 的原因。

---

## 16. 测试是怎么跑起来的

### 16.1 测试的基本组成

任何测试框架都提供三件事：

1. **测试运行器**：发现测试文件、执行、汇总结果。
2. **断言**：判断"实际值是否等于期望值"，如 `expect(x).toBe(2)`。
3. **隔离/mock**：让测试不依赖真实环境（真实网络、真实 API key）。

pi 仓库里有**两套**测试机制。

### 16.2 机制一：Vitest（绝大多数包）

`packages/coding-agent/package.json`：

```jsonc
"test": "vitest --run"
```

执行 `npm test` 时：

1. 找到 `node_modules/.bin/vitest`，运行它。
2. Vitest 读配置文件（`packages/coding-agent/vitest.config.ts`，它 `mergeConfig` 了根 `vitest.base.ts`）。
3. Vitest 基于 **Vite**，用 esbuild **即时转译** TS 源码——所以测试**不需要先构建**，直接吃 `.ts`。
4. 关键：`vitest.base.ts` 的 `resolve.alias` 把所有 `@earendil-works/*` 包映射到 `packages/*/src/index.ts`（源码），而不是 `dist/`：
   ```ts
   { find: /^@earendil-works\/pi-ai$/, replacement: workspaceSourcePaths.aiIndex }
   // aiIndex = <repo>/packages/ai/src/index.ts
   ```
   这样测试跑的是最新源码，跳过构建，也避免"dist 过期导致测试结果不对"。
5. 测试文件里 `import { ... } from "@earendil-works/pi-ai"` 被 alias 重定向到源码。
6. Vitest 执行断言、收集结果、按 reporter 输出（`packages/coding-agent` 里用 `dot` + 可选 `github-actions`）。
7. 配置里 `env: { PI_OFFLINE: "1" }` 强制离线；测试要联网必须显式调用 `allowNetwork()`（见 `test/test-network-env.ts`）。这防止测试意外花费真实 API token。

**跑单个测试文件**（在包目录下）：

```bash
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/xxx.test.ts
```

（直接调 vitest 的入口 JS，避免依赖 `npx`/PATH。）

### 16.3 机制二：Node 内置测试器（tui 包）

`packages/tui/package.json`：

```jsonc
"test": "node --test --test-reporter=dot --test-reporter-destination=stdout test/*.test.ts"
```

这里完全不用第三方框架：
- `node --test`：Node 22 自带的测试运行器，会发现并执行指定文件。
- 文件是 `.ts`：Node 22.18+ 默认启用类型擦除，**可以直接运行删掉类型后的 TS**（这正是仓库强制 `erasableSyntaxOnly` 的原因——否则 Node 无法擦除）。这也说明为什么源码导入要写 `.ts` 扩展名：Node 需要显式文件名。
- 断言用 Node 内置的 `node:assert`。
- `--test-reporter=dot` 只打印点状进度。

选 Node 内置而非 Vitest，通常是为了**零依赖、贴近真实 Node 行为**（tui 是底层库，希望测试环境最纯粹）。

### 16.4 `./test.sh` 做了什么，为什么需要它

在仓库根目录直接 `npm test` 会跑所有包的测试，但有个隐患：测试可能读到**你真实的 `~/.pi` 配置、真实 API key、真实临时目录**，导致结果不可重复、甚至产生费用。`test.sh` 就是为此而生。

它做的事（`set -euo pipefail`：出错即停、未定义变量报错、管道错误传播）：

1. **建临时沙盒**：`mktemp -d` 创建一个隔离目录，里面造出假的 `home/`、`tmp/`、`cache/npm`，并打上 `.pi-test-owned` 标记。
2. **重设环境变量**：用 `env -i` 清空环境，然后只注入必要变量：
   - `HOME`/`USERPROFILE` 指向假 home（这样 pi 找不到你真实的 `~/.pi` 配置和凭据）
   - `TMPDIR`/`TMP`/`TEMP` 指向假临时目录
   - `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` 指向沙盒
   - 语言/时区固定（`LANG=C`、`TZ=UTC`）保证跨机一致
   - git 配置隔离（`GIT_CONFIG_GLOBAL=/dev/null`、禁止终端交互）
   - npm 配置隔离（`NPM_CONFIG_USERCONFIG` 等指向沙盒）
   - `PI_NO_LOCAL_LLM=1`、`AWS_EC2_METADATA_DISABLED=true`：关掉本地模型探测和云元数据请求
3. **保留必要变量**：Windows 需要的 `SystemRoot`、`COMSPEC` 等；CI 检测变量 `CI`、`GITHUB_ACTIONS`（只影响报告格式）。
4. **运行 `npm test`**：在干净环境里跑全部测试。
5. **退出时清理**：`trap cleanup EXIT` 删除沙盒，但会**先核验**目录确实是自己创建的那个（检查 `.pi-test-owned` 标记 + 路径前缀），防止误删。

一句话：

> `test.sh` = 在"没有你的配置、没有你的密钥、没有你的临时文件"的隔离环境里跑测试，保证结果可重复、无副作用。

日常约定：
- 全量非 e2e 测试：`./test.sh`
- 单文件测试：在包目录下用 vitest 或 `node --test`
- 绝不要直接跑完整 vitest 套件（仓库含 e2e 测试，一旦环境里有 endpoint/auth 就会被激活，可能产生真实调用）

---

## 17. Node 生态链全貌

最后把整条链串成一个表和图。

### 17.1 每个工具的角色

| 工具 | 属于哪一层 | 作用 | 在本仓库怎么用 |
|---|---|---|---|
| **Node.js** | 运行时 | 执行 JS/TS，提供 `fs`/`http` 等 API | 版本要求 `>=22.19` |
| **npm** | 包管理器 | 安装依赖、跑脚本、管理 monorepo | `npm install` / `npm run` |
| **package.json** | 配置 | 声明包名、依赖、入口、脚本 | 每个包一份 + 根一份 |
| **package-lock.json** | 配置 | 锁定依赖精确版本 | 保证全组环境一致 |
| **node_modules** | 依赖仓库 | 存放所有依赖 + workspace 软链接 | `npm install` 生成 |
| **TypeScript** | 语言/编译器 | 给 JS 加类型，编译成 JS | 源码全是 `.ts` |
| **tsgo** | 构建工具 | TS 原生加速编译器 | `tsgo -p tsconfig.build.json` |
| **esbuild** | 打包器 | 把多文件合成 bundle | `build-coding-agent-bundle.mjs` |
| **Biome** | 质量工具 | 格式化 + lint | `npm run check` |
| **Vitest** | 测试框架 | 跑测试（Vite 驱动，直接吃 TS） | 多数包 `vitest --run` |
| **node --test** | 测试框架 | Node 内置测试器 | `packages/tui` |
| **husky** | git 钩子 | 提交前自动检查 | `prepare` 脚本 |
| **tsx** | 开发工具 | 直接运行 TS，无需构建 | `npx tsx src/cli.ts` |

### 17.2 完整生命周期图

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 开发期（源码）                                                     │
│    packages/ai/src/*.ts  ← 你在这里写代码                             │
│    ├─ 编辑器/tsgo 用 tsconfig.json 的 paths 解析：源码 → 源码         │
│    └─ vitest 用 vitest.base.ts 的 alias 解析：源码 → 源码             │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  npm run build
┌─────────────────────────────────────────────────────────────────────┐
│ 2. 构建期                                                            │
│    tsgo：擦掉类型，src/*.ts → dist/*.js + *.d.ts                     │
│          （把 import "./x.ts" 重写成 "./x.js"）                      │
│    esbuild：从 dist 入口出发，把内部模块内联                          │
│          → dist/bundle/cli.js（launcher）+ cli-runtime.js + chunks   │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  npm publish
┌─────────────────────────────────────────────────────────────────────┐
│ 3. 发布期                                                            │
│    按 package.json 的 "files" 打包，上传 npm registry                 │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  npm install --ignore-scripts
┌─────────────────────────────────────────────────────────────────────┐
│ 4. 安装期                                                            │
│    读 workspaces → 解析/锁定版本 → 下载解压 → 建 workspace 软链接     │
│    → 建 node_modules/.bin → （跳过 lifecycle 脚本）                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  执行 pi
┌─────────────────────────────────────────────────────────────────────┐
│ 5. 运行期（Node 运行时）                                              │
│    shell 按 PATH 找到 pi → shebang 用 node 执行 bundle/cli.js         │
│    → Module Resolution：按 exports/main 找到真实文件                  │
│      · node:fs        → 内置                                         │
│      · chalk          → node_modules/chalk                           │
│      · @earendil/...  → node_modules/<scope>/<pkg>（软链接→真实目录） │
│    → 模块只求值一次（缓存）→ main() → 进入模式（TUI/print/json/rpc）  │
└─────────────────────────────────────────────────────────────────────┘
```

### 17.3 命令与链路阶段的对应

| 你想做的事 | 命令 | 命中链路哪一环 |
|---|---|---|
| 装依赖 | `npm install --ignore-scripts` | 阶段 4 |
| 编译所有包 | `npm run build` | 阶段 2 |
| 改完代码快速跑源码 | `npx tsx packages/coding-agent/src/cli.ts` | 阶段 1 → 5（跳过 2） |
| 跑本地构建的 pi | `node packages/coding-agent/dist/cli.js` | 阶段 2 产物 → 5 |
| 跑全部测试 | `./test.sh` | 阶段 1（vitest 直接吃源码） |
| 质量检查 | `npm run check` | Biome + tsgo 类型检查 |
| 查某个包 | `npm run build --workspace=@earendil-works/pi-tui` | 阶段 2（单包） |

### 17.4 记住这三句话

1. **import 是"按名字找文件"**：裸名去 node_modules 逐级向上找，读 exports 决定真实文件；monorepo 用软链接把本地包接进来。
2. **源码和产物是两套世界**：开发/测试解析到 `src/`，运行解析到 `dist/`；`.ts` 导入靠编译期重写变成 `.js`。
3. **install / build / test / run 四个阶段各自解决一件事**：装依赖、生产物、验行为、跑程序。理解 pi 的任何问题，先定位它发生在哪个阶段。

---

## 附：一分钟记住这个仓库

- pi = `packages/coding-agent`，入口 `src/cli.ts` → `src/main.ts`
- 大模型请求 = `packages/ai`，工具调用循环 = `packages/agent/src/agent-loop.ts`
- 内置工具实现 = `packages/coding-agent/src/core/tools/`
- 界面 = `src/modes/interactive/`（用 `packages/tui` 渲染）
- 会话文件 = 用户目录下的 JSONL，一棵事件树
- 改完代码：`npm run check`；跑测试：`./test.sh`
- 启动链路：`pi` → shebang → `bundle/cli.js` → `cli-runtime.js` → `main()` → 模式分派