# pi 源码学习手册（新手向）

> 本手册依据 [`docs/learning-plan.zh-CN.md`](../../learning-plan.zh-CN.md) 的方案生成，面向“想在地铁通勤中读懂 pi 源码并能动手改代码”的新手读者。
>
> 仓库基线：分支 `main`，提交 `200387122ca450d6387f033949423114a270b96c`；`@earendil-works/pi-coding-agent` 版本 `1.0.2`。手册中所有结论都以这个版本的源码为准；升级版本后请按[附录 G：版本与维护](pi-source-handbook-complete.md#appendices-version-notes-h1)的方法核对差异。

**完整单文件版**：[pi 源码学习手册](pi-source-handbook-complete.md)。第 0–25 章正文、源码精读 D1–D30 和附录 A–L 都在同一个文件里，开头是“7 天 14 小时通关路线”，标出车上读什么、车下做什么。本页以下提供章节、附录与精读索引，链接都指向该文件内的锚点。

**每日任务版**：`task-00` – `task-15` 共 16 个任务文件，每个任务自带当天要读的正文、源码查看任务、动手任务与验收标准，可以脱离本页单独打开。入口见[任务索引](#任务索引)。

## 这份手册是什么

pi 是一个"agent harness"（智能体外壳 / 运行框架）：它把大语言模型（LLM，Large Language Model）、本地工具（读写文件、执行命令）、会话状态和终端界面组织成一个可以持续干活的编码助手。

本手册带你从最外层的行为出发，一层层读到最底层的实现：

- 一条用户输入，是如何变成若干次模型请求、若干次工具执行，并最终变成屏幕上的一段回答的；
- 模型、消息、事件、工具、会话、上下文、压缩这些名词在源码里各自对应什么数据结构、哪个文件、哪个函数；
- 每一层为什么这么设计，如果改动它，会牵动哪些代码；
- 最后，你能独立完成一个小改动：定位代码、写测试、跑检查、描述影响范围。

全书的写作顺序是"先跑一遍行为，再读代码，最后解释设计"：

1. **问题**：为什么要这个机制？没有它会怎样？
2. **轨迹**：给一个具体输入，标出代码从上到下经过的函数。
3. **设计**：解释关键分支、错误处理和资源释放为什么这样做。

## 这份手册不是

- 不是 API 参考手册。查函数签名请直接看源码 `packages/*/src`，本手册负责告诉你"该看哪里、为什么"。
- 不是已全部验证的实验报告。每个实验都标注验证状态；`设计中` 表示步骤经过静态核对但没有实际运行，`本地已运行` 表示在撰写时实际执行并记录了环境与结果。
- 不要求你有真实模型账号。核心实验全部使用仓库内置的 faux provider（假的模型，按固定脚本返回内容）离线完成。

## 读者画像与前置知识

| 项目 | 要求 |
|---|---|
| 编程经验 | 至少熟悉一门编程语言（Java、Python、C#、Go 等均可） |
| TypeScript | **不要求**。第 1 章用仓库真实代码补课：类型收窄、泛型、ESM、异步、事件流 |
| 操作系统 | Windows / Linux / macOS 均可。每处环境操作给出三平台命令 |
| 终端 | 会打开终端、切换目录、运行命令即可 |
| 模型 | 不需要付费账号；第 5 章的实验用 faux provider 离线完成 |

## 7 天 14 小时通关路线（通勤版）

面向每天约 2 小时的地铁通勤读者，一周读完核心主线（第 0–10 章）。源码精读（D1–D30）需要打开源码，属于“车下”内容；第 11–25 章是进阶与选修，通关后再按需回查。

```mermaid
flowchart LR
  D1[第 1 天<br/>全景] --> D2[第 2 天<br/>TS 补课]
  D2 --> D3[第 3 天<br/>一次请求]
  D3 --> D4[第 4 天<br/>消息与模型]
  D4 --> D5[第 5 天<br/>循环与工具]
  D5 --> D6[第 6 天<br/>会话与分支]
  D6 --> D7[第 7 天<br/>上下文与验收]
```

| 天 | 车上读（约 2 小时） | 读完成果 | 车下可选 |
|---|---|---|---|
| 第 1 天 | 15 分钟主线；第 0 章 | 说出 pi 是什么、四个核心包各负责哪一段 | 第 2 章环境搭建 |
| 第 2 天 | 第 1 章（重点 1.1、1.2、1.4、1.7） | 读懂一个真实的事件监听器 | 第 2 章实验 L01 |
| 第 3 天 | 第 3 章主线 | 手绘一次请求的五层调用链 | D6 |
| 第 4 天 | 第 4 章；第 5 章主线 | 四列表；讲清模型适配的三个抽象 | D11、D17 |
| 第 5 天 | 第 6、7 章主线 | 四条状态轨迹；工具四步流水线 | D1、D2、D7 |
| 第 6 天 | 第 8、9 章主线 | 资源生命周期图；分支会话与活动分支 | D5、D3、D9 |
| 第 7 天 | 第 10 章主线；验收清单 | 对比压缩前后输入；解释四条路径 | D4、D10、D15 |

> 提示：卡住时先完成“读完成果”那一项再前进。阅读不算掌握；能解释、能定位、能验证才算。需要完整四周计划时，见 [`docs/learning-plan.zh-CN.md`](../../learning-plan.zh-CN.md)。


## 任务索引

每个任务文件是一天的量，包含：**今日准备**、**学习内容**、**核心源码**（要打开的文件与符号）、**TypeScript 语法小课**、**动手任务 A/B**、**实验记录**和**验收标准**。正文不做外链，术语表、对应章节、源码精读和附录选段都直接收录在同一个文件里，所以每个任务都能单独打开阅读。

| 任务 | 主题 | 收录正文 |
|---|---|---|
| [00](task-00-typescript-core.md) | TypeScript 核心与常用语法（独立语法课，不依赖前序章节） | 语法课正文 |
| [01](task-01-orientation.md) | 仓库地图与运行环境 | 第 0–2 章；附录 A、B、K、L |
| [02](task-02-request-journey.md) | 从 CLI 到一次完整请求 | 第 3 章；附录 A |
| [03](task-03-messages-events-state.md) | 消息、事件、状态与持久化条目 | 第 4 章；附录 A、H |
| [04](task-04-providers.md) | 模型目录、认证与流式适配 | 第 5 章；附录 A |
| [05](task-05-agent-loop.md) | Agent 循环、轮次、排队与取消 | 第 6 章；附录 A |
| [06](task-06-tools.md) | 工具定义、调度与失败处理 | 第 7 章；附录 A |
| [07](task-07-agent-session.md) | AgentSession 与资源生命周期 | 第 8 章；附录 A |
| [08](task-08-session-tree.md) | 会话树、活动分支与恢复 | 第 9 章；附录 A |
| [09](task-09-context-compaction.md) | 系统提示、上下文预算与压缩 | 第 10 章；附录 A |
| [10](task-10-config-resources-trust.md) | 设置来源、资源发现与项目信任 | 第 11 章；附录 A |
| [11](task-11-extensions.md) | 技能、模板、Extension 与自定义工具 | 第 12–14 章；附录 A、J |
| [12](task-12-sdk-rpc.md) | SDK 宿主与进程级协议 | 第 15–16 章；附录 A |
| [13](task-13-terminal-ui.md) | 终端 UI、输入和宽度 | 第 17 章；附录 A |
| [14](task-14-testing-debugging.md) | 测试、调试与可评审改动 | 第 18–20 章；附录 A、C、D、E、F、G |
| [15](task-15-advanced-capstone.md) | 进阶系统与毕业项目 | 第 21–25 章；附录 A、I |

每个任务另有一份同名的 EPUB 版本，放在仓库根的 `epub/` 目录，例如 [`epub/task-02-request-journey.epub`](../../../epub/task-02-request-journey.epub)，用于在电纸书或手机上离线阅读。

## 章节索引（单文件手册内）

下表链接都指向 [`pi-source-handbook-complete.md`](pi-source-handbook-complete.md)；源码精读（D1–D30）在各章“本章源码精读”小节内，见[核心代码精读](#核心代码精读)。

| 章 | 位置 | 要回答的核心问题 | 性质 |
|---|---|---|---|
| 0 | [§0](pi-source-handbook-complete.md#00-orientation-h1) | pi 是什么？由哪些包组成？从哪里开始读？ | 主线 |
| 1 | [§1](pi-source-handbook-complete.md#01-typescript-node-h1) | 读懂本仓库需要哪些 TS/Node 知识？ | 主线·补课 |
| 2 | [§2](pi-source-handbook-complete.md#02-environment-h1) | 怎么把源码跑起来？怎么复现一个固定实验？ | 主线 |
| 3 | [§3](pi-source-handbook-complete.md#03-request-journey-h1) | 一条输入到最终回答经过哪些函数？ | 主线 |
| 4 | [§4](pi-source-handbook-complete.md#04-messages-events-state-h1) | 消息、事件、状态、持久化记录有什么区别？ | 主线 |
| 5 | [§5](pi-source-handbook-complete.md#05-pi-ai-providers-h1) | pi-ai 如何屏蔽不同模型供应商的差异？ | 主线 |
| 6 | [§6](pi-source-handbook-complete.md#06-agent-loop-h1) | Agent 循环什么时候继续、什么时候结束？ | 主线 |
| 7 | [§7](pi-source-handbook-complete.md#07-tools-execution-h1) | 工具从声明到执行、失败、取消的完整路径是什么？ | 主线 |
| 8 | [§8](pi-source-handbook-complete.md#08-agent-session-h1) | 应用会话为什么不能等同于底层 Agent？资源由谁释放？ | 主线 |
| 9 | [§9](pi-source-handbook-complete.md#09-session-tree-h1) | 磁盘上的会话记录如何变成下一次的模型上下文？ | 主线 |
| 10 | [§10](pi-source-handbook-complete.md#10-context-compaction-h1) | 系统提示从哪里来？压缩改变了什么、没改变什么？ | 主线 |
| 11 | [§11](pi-source-handbook-complete.md#11-config-resources-trust-h1) | 配置没生效时怎么排查？信任边界在哪？ | 主线 |
| 12 | [§12](pi-source-handbook-complete.md#12-extension-mechanisms-h1) | 需求应该用模板、Skill、扩展还是改核心？ | 主线 |
| 13 | [§13](pi-source-handbook-complete.md#13-extension-api-h1) | 一个扩展的注册、加载、事件与卸载是怎么工作的？ | 主线 |
| 14 | [§14](pi-source-handbook-complete.md#14-tool-extensions-h1) | 怎么写一个可分发、可验证的工具型扩展？ | 主线 |
| 15 | [§15](pi-source-handbook-complete.md#15-sdk-embedding-h1) | 怎样在自己的 Node 程序里创建、观察、释放会话？ | 主线 |
| 16 | [§16](pi-source-handbook-complete.md#16-print-json-rpc-h1) | 进程级集成该选 print、JSON 还是 RPC？ | 主线 |
| 17 | [§17](pi-source-handbook-complete.md#17-terminal-ui-h1) | 终端 UI 的渲染、宽度、键位是怎么组织的？ | 主线 |
| 18 | [§18](pi-source-handbook-complete.md#18-testing-h1) | 怎么在零模型费用的条件下写出有效的测试？ | 主线 |
| 19 | [§19](pi-source-handbook-complete.md#19-debugging-h1) | "pi 不工作"如何缩小成可验证的具体问题？ | 主线 |
| 20 | [§20](pi-source-handbook-complete.md#20-repo-rules-contributing-h1) | 一个可靠改动需要哪些证据才能提交？ | 主线 |
| 21 | [§21](pi-source-handbook-complete.md#21-capstone-h1) | 独立完成一个可评审的小改动（毕业项目）。 | 主线 |
| 22 | [§22](pi-source-handbook-complete.md#22-mcp-codemode-h1) | 外部工具如何接入？模型写的代码如何执行？ | 选修 |
| 23 | [§23](pi-source-handbook-complete.md#23-chord-durable-h1) | "存了聊天记录"和"能恢复执行"差在哪？ | 选修 |
| 24 | [§24](pi-source-handbook-complete.md#24-client-server-h1) | 跨进程会话附着与路由是怎么工作的？ | 选修 |
| 25 | [§25](pi-source-handbook-complete.md#25-observability-evals-h1) | 如何区分代码正确性、任务成功率与运行效率？ | 选修 |

附录（同收录在单文件手册末尾）：

- [附录 A：术语表](pi-source-handbook-complete.md#appendices-glossary-h1)：中英文术语、首次出现的章节。
- [附录 B：源码地图](pi-source-handbook-complete.md#appendices-source-map-h1)：问题 → 文件 → 符号 → 测试。
- [附录 C：命令速查](pi-source-handbook-complete.md#appendices-commands-h1)：标明 shell、工作目录与前置条件。
- [附录 D：故障索引](pi-source-handbook-complete.md#appendices-troubleshooting-h1)：现象 → 定位步骤 → 修复方向。
- [附录 E：练习与参考答案索引](pi-source-handbook-complete.md#appendices-exercises-and-answers-h1)。
- [附录 F：验证记录](pi-source-handbook-complete.md#appendices-validation-h1)：哪些实验实际运行过、环境与结果。
- [附录 G：版本与维护](pi-source-handbook-complete.md#appendices-version-notes-h1)：基线信息与更新方法。
- [附录 H：数据形状对照表](pi-source-handbook-complete.md#appendices-data-shapes-h1)：六种数据形状的字段级对照与转换矩阵。
- [附录 I：任务配方](pi-source-handbook-complete.md#appendices-recipes-h1)：加工具/命令/快捷键/设置/供应商、写测试、排障、提交与分发的常用流程。
- [附录 J：API 速查](pi-source-handbook-complete.md#appendices-api-cheatsheet-h1)：四个包按组导出清单与常用 import 组合。
- [附录 K：三平台命令与验证边界](pi-source-handbook-complete.md#appendices-platform-validation-h1)：区分 Windows、Git Bash、WSL、Linux 与 macOS 的实际运行条件。
- [附录 L：读源码速查](pi-source-handbook-complete.md#appendices-read-code-h1)：读源码的定位三步、本仓库 10 个高频写法（TypeBox、EventStream、判别联合等）、检索模板与动态观察。

## 核心代码精读

主线章节负责建立整体模型；精读篇逐段对照关键源码，补充函数输入输出、状态变化、错误路径和设计取舍，已按主题并入第 3–21 章的“本章源码精读”小节。建议先完成对应主线，再打开精读篇。

打开精读篇之前，先看[附录 L：读源码速查](pi-source-handbook-complete.md#appendices-read-code-h1)：里面有定位方法、本仓库高频写法，以及“读不懂时的降级顺序”。

| 精读 | 所在章 | 主题 |
|---|---|---|
| [D1](pi-source-handbook-complete.md#deep-dives-d1-agent-loop-h1) | 第 6 章 | `agent-loop.ts` 逐段精读：模型轮次、事件和工具批次 |
| [D2](pi-source-handbook-complete.md#deep-dives-d2-agent-h1) | 第 6 章 | `agent.ts` 逐段精读 |
| [D3](pi-source-handbook-complete.md#deep-dives-d3-session-manager-h1) | 第 9 章 | `session-manager.ts` 投影与分支精读 |
| [D4](pi-source-handbook-complete.md#deep-dives-d4-prompt-compaction-h1) | 第 10 章 | 系统提示与压缩逐段精读 |
| [D5](pi-source-handbook-complete.md#deep-dives-d5-sdk-session-h1) | 第 8 章 | `sdk.ts` 装配与 `agent-session.ts` 主路径精读 |
| [D6](pi-source-handbook-complete.md#deep-dives-d6-main-h1) | 第 3 章 | `main.ts` 启动与装配选段精读 |
| [D7](pi-source-handbook-complete.md#deep-dives-d7-tools-h1) | 第 7 章 | 内置工具四件套精读（截断、累积、进程） |
| [D8](pi-source-handbook-complete.md#deep-dives-d8-extensions-h1) | 第 13 章 | 扩展系统逐段精读 |
| [D9](pi-source-handbook-complete.md#deep-dives-d9-session-manager-class-h1) | 第 9 章 | `SessionManager` 类内部机制精读 |
| [D10](pi-source-handbook-complete.md#deep-dives-d10-compaction-write-path-h1) | 第 10 章 | 压缩的“写入路径”精读（`prepareCompaction` + `compact`） |
| [D11](pi-source-handbook-complete.md#deep-dives-d11-model-layer-h1) | 第 5 章 | 模型层精读（`pi-ai` 与 coding-agent 的模型运行时） |
| [D12](pi-source-handbook-complete.md#deep-dives-d12-protocol-modes-h1) | 第 16 章 | 三种输出模式的协议层精读（JSON 事件整形、JSONL、print/RPC） |
| [D13](pi-source-handbook-complete.md#deep-dives-d13-interactive-h1) | 第 17 章 | 交互模式（TUI 装配与启动序列）精读 |
| [D14](pi-source-handbook-complete.md#deep-dives-d14-extension-loader-h1) | 第 13 章 | 扩展加载器（`extensions/loader.ts`）精读 |
| [D15](pi-source-handbook-complete.md#deep-dives-d15-compaction-session-glue-h1) | 第 10 章 | 压缩的“触发端”精读（`_checkCompaction` + `_runAutoCompaction`） |
| [D16](pi-source-handbook-complete.md#deep-dives-d16-export-share-h1) | 第 9 章 | 导出、分享与报告精读 |
| [D17](pi-source-handbook-complete.md#deep-dives-d17-anthropic-stream-h1) | 第 5 章 | Anthropic 流式请求与 SSE 解码 |
| [D18](pi-source-handbook-complete.md#deep-dives-d18-openai-responses-h1) | 第 5 章 | OpenAI Responses 事件流与输出槽位 |
| [D19](pi-source-handbook-complete.md#deep-dives-d19-openai-completions-h1) | 第 5 章 | OpenAI Chat Completions 流式适配器 |
| [D20](pi-source-handbook-complete.md#deep-dives-d20-bedrock-converse-h1) | 第 5 章 | Amazon Bedrock Converse 流式适配器 |
| [D21](pi-source-handbook-complete.md#deep-dives-d21-faux-test-harness-h1) | 第 18 章 | faux Provider 与 AgentSession 测试 Harness |
| [D22](pi-source-handbook-complete.md#deep-dives-d22-extension-loader-lifecycle-h1) | 第 13 章 | 扩展加载失败、缓存与运行时生命周期 |
| [D23](pi-source-handbook-complete.md#deep-dives-d23-provider-adapter-field-guide-h1) | 第 5 章 | 新增 Provider 的适配器对照与实现路线 |
| [D24](pi-source-handbook-complete.md#deep-dives-d24-worked-source-change-h1) | 第 21 章 | 真实 issue 的源码改动演练 |
| [D25](pi-source-handbook-complete.md#deep-dives-d25-resource-loader-reload-h1) | 第 11 章 | 资源解析与 `reload()` 生命周期 |
| [D26](pi-source-handbook-complete.md#deep-dives-d26-settings-manager-state-h1) | 第 11 章 | `SettingsManager` 的配置状态与写入生命周期 |
| [D27](pi-source-handbook-complete.md#deep-dives-d27-agent-session-prompt-settlement-h1) | 第 8 章 | `AgentSession.prompt()` 与 run 收束边界 |
| [D28](pi-source-handbook-complete.md#deep-dives-d28-agent-session-runtime-replacement-h1) | 第 8 章 | `AgentSessionRuntime` 的会话替换生命周期 |
| [D29](pi-source-handbook-complete.md#deep-dives-d29-model-runtime-request-and-credentials-h1) | 第 5 章 | `ModelRuntime` 的请求准备与凭据同步 |
| [D30](pi-source-handbook-complete.md#deep-dives-d30-provider-composition-and-refresh-h1) | 第 5 章 | Provider 组合、模型覆盖与动态刷新 |

## 怎么读：三轮法

每章建议读三轮，不要一遍求全：

1. **第一轮（20 分钟）**：只读"场景、轨迹、图"，建立直觉；跳过所有代码细节。
2. **第二轮（2-4 小时）**：打开源码，沿着"源码阅读路线"走一遍，对照手册里的关键代码解释。
3. **第三轮（1 小时）**：做实验和验收题。做不出来说明第二轮漏了什么，回到对应小节。

## 手册使用的约定

**代码定位**。所有源码引用格式为 `包路径` → `文件` → `符号（函数/类型/常量名）`，例如：

```text
packages/agent/src/types.ts → AgentEvent
```

不依赖行号，因为行号会随版本漂移。"符号"指 TypeScript 里的 `export function`、`export type`、`export interface`、`const` 等具名声明，用编辑器搜索就能秒定位。

**命令行标注**。所有命令都用代码块语言标注区分：

```powershell
# powershell：Windows 默认终端
node --version
```

```bash
# bash：Linux / macOS / Git Bash
node --version
```

没有标注的命令在三个平台通用。

**验证状态**。实验中出现的结论分四档，手册会在实验小结处显式标注：

| 状态 | 含义 |
|---|---|
| 设计中 | 步骤设计完成，尚未静态核对源码或运行 |
| 静态核对 | 已对照当前 commit 的源码验证结论，但未运行 |
| 本地已运行 | 在撰写时实际运行过，记录了系统、Node 版本与输出 |
| 需外部条件 | 需要真实模型、账号或特定系统才能完成，正文给出替代方案 |

## 你需要准备的软件

- **Node.js >= 22.19.0**（仓库根 `package.json` 的 `engines` 字段要求，见第 2 章）。
- **Git**。
- 一个编辑器，推荐 VS Code（对 TypeScript 跳转定义支持好）。
- 终端：Windows 推荐 Windows Terminal（PowerShell 7 或自带的 Windows PowerShell 5.1 都可）；Linux/macOS 用系统终端。
- 可选：Git Bash（Windows 上很多 Bash 脚本实验需要它，第 2 章详述）。

## 进度清单

可以复制下面这份清单到自己的笔记里，每完成一项打勾：

- [ ] 第 0 章：画出四个核心包的职责图
- [ ] 第 1 章：读懂一个真实的事件监听器
- [ ] 第 2 章：用源码方式跑起 pi 并复现实验 L01
- [ ] 第 3 章：手绘一次请求的调用链
- [ ] 第 4 章：填写"消息/事件/状态/持久化"四列表
- [ ] 第 5 章：用 faux provider 观察固定响应序列
- [ ] 第 6 章：写出无工具/有工具/排队/取消四条状态轨迹
- [ ] 第 7 章：验证工具并发完成顺序与记录顺序
- [ ] 第 8 章：画出会话资源生命周期图
- [ ] 第 9 章：构造一个分支会话并解释活动分支
- [ ] 第 10 章：对比压缩前后的模型输入
- [ ] 第 11 章：为一个设置画出配置来源链
- [ ] 第 12 章：对五个需求选择最轻量的扩展机制
- [ ] 第 13 章：完成 hello 扩展并验证重载
- [ ] 第 14 章：完成 inspect_package 工具型扩展
- [ ] 第 15 章：写一个带取消与释放的 SDK 宿主
- [ ] 第 16 章：解析一段分片到达的 JSONL
- [ ] 第 17 章：构造一个终端宽度问题的最小输入
- [ ] 第 18 章：写一个 faux provider 回归测试
- [ ] 第 19 章：写一份合格的复现说明
- [ ] 第 20 章：跑通 `npm run check` 并审查它改了什么
- [ ] 第 21 章：完成毕业项目并通过验收
- [ ] 第 22-25 章（选修）：完成 1-2 个进阶实验

## 免责与维护

本手册中的每个结论都尽量给出源码出处。如果你发现手册与当前代码不一致：

1. 以代码为准，手册是辅助材料；
2. 按[附录 G：版本与维护](pi-source-handbook-complete.md#appendices-version-notes-h1)记录差异；
3. 优先检查对应章节的"验证状态"标注，是否本来就是"设计中/静态核对"。
