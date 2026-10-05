# pi 源码学习手册（新手向）

> 本手册依据 [`docs/learning-plan.zh-CN.md`](../../learning-plan.zh-CN.md) 的方案生成，面向"想在一个月内读懂 pi 源码并能动手改代码"的新手读者。
>
> 仓库基线：分支 `main`，提交 `200387122ca450d6387f033949423114a270b96c`；`@earendil-works/pi-coding-agent` 版本 `1.0.2`。手册中所有结论都以这个版本的源码为准；升级版本后请按 [`appendices/version-notes.md`](appendices/version-notes.md) 的方法核对差异。

**完整单文件版**：[pi 源码学习手册](pi-source-handbook-complete.md)。精读 D1–D30 已融合进对应的第 0–25 章；本页以下仍提供分章阅读入口。

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

## 一个月学习计划

按每天 3-5 小时、每周 6 天安排，四周完成主线（0-21 章），第 5 周起按兴趣选读进阶篇（22-25 章）。

```mermaid
flowchart LR
  W1[第 1 周<br/>基础与全景<br/>0-4 章] --> W2[第 2 周<br/>模型与循环<br/>5-8 章]
  W2 --> W3[第 3 周<br/>会话与扩展<br/>9-14 章]
  W3 --> W4[第 4 周<br/>开发闭环与毕业项目<br/>15-21 章]
  W4 -.-> W5[第 5 周起<br/>进阶选修<br/>22-25 章]
```

| 周 | 章节 | 主题 | 结束时要拿出的成果 |
|---|---|---|---|
| 第 1 周 | 0-4 | 项目全景、TS 补课、环境搭建、一次请求的完整旅程、消息与事件 | 包职责图、一次请求调用链、事件对照表 |
| 第 2 周 | 5-8 | 模型适配、Agent 循环、工具调度、会话生命周期 | 两条请求时序图、工具执行轨迹、生命周期图 |
| 第 3 周 | 9-14 | 会话树、上下文与压缩、配置与信任、四种扩展机制、Extension API | 分支图、配置来源链、一个可运行的只读扩展 |
| 第 4 周 | 15-21 | SDK、RPC、终端 UI、测试、调试、仓库规范、毕业项目 | SDK 宿主、回归测试、最小改动与可评审说明 |
| 第 5 周起 | 22-25 | MCP/Codemode、Chord 与 durable、client/server、可观测性（选修） | 按兴趣完成 1-2 个进阶实验 |

> 提示：如果某周卡住，优先完成"必须拿出的成果"里的东西再前进。阅读不算掌握；能解释、能定位、能验证才算。

## 章节索引

| 章 | 文件 | 要回答的核心问题 | 性质 |
|---|---|---|---|
| 0 | [00-orientation.md](00-orientation.md) | pi 是什么？由哪些包组成？从哪里开始读？ | 主线 |
| 1 | [01-typescript-node.md](01-typescript-node.md) | 读懂本仓库需要哪些 TS/Node 知识？ | 主线·补课 |
| 2 | [02-environment.md](02-environment.md) | 怎么把源码跑起来？怎么复现一个固定实验？ | 主线 |
| 3 | [03-request-journey.md](03-request-journey.md) | 一条输入到最终回答经过哪些函数？ | 主线 |
| 4 | [04-messages-events-state.md](04-messages-events-state.md) | 消息、事件、状态、持久化记录有什么区别？ | 主线 |
| 5 | [05-pi-ai-providers.md](05-pi-ai-providers.md) | pi-ai 如何屏蔽不同模型供应商的差异？ | 主线 |
| 6 | [06-agent-loop.md](06-agent-loop.md) | Agent 循环什么时候继续、什么时候结束？ | 主线 |
| 7 | [07-tools-execution.md](07-tools-execution.md) | 工具从声明到执行、失败、取消的完整路径是什么？ | 主线 |
| 8 | [08-agent-session.md](08-agent-session.md) | 应用会话为什么不能等同于底层 Agent？资源由谁释放？ | 主线 |
| 9 | [09-session-tree.md](09-session-tree.md) | 磁盘上的会话记录如何变成下一次的模型上下文？ | 主线 |
| 10 | [10-context-compaction.md](10-context-compaction.md) | 系统提示从哪里来？压缩改变了什么、没改变什么？ | 主线 |
| 11 | [11-config-resources-trust.md](11-config-resources-trust.md) | 配置没生效时怎么排查？信任边界在哪？ | 主线 |
| 12 | [12-extension-mechanisms.md](12-extension-mechanisms.md) | 需求应该用模板、Skill、扩展还是改核心？ | 主线 |
| 13 | [13-extension-api.md](13-extension-api.md) | 一个扩展的注册、加载、事件与卸载是怎么工作的？ | 主线 |
| 14 | [14-tool-extensions.md](14-tool-extensions.md) | 怎么写一个可分发、可验证的工具型扩展？ | 主线 |
| 15 | [15-sdk-embedding.md](15-sdk-embedding.md) | 怎样在自己的 Node 程序里创建、观察、释放会话？ | 主线 |
| 16 | [16-print-json-rpc.md](16-print-json-rpc.md) | 进程级集成该选 print、JSON 还是 RPC？ | 主线 |
| 17 | [17-terminal-ui.md](17-terminal-ui.md) | 终端 UI 的渲染、宽度、键位是怎么组织的？ | 主线 |
| 18 | [18-testing.md](18-testing.md) | 怎么在零模型费用的条件下写出有效的测试？ | 主线 |
| 19 | [19-debugging.md](19-debugging.md) | "pi 不工作"如何缩小成可验证的具体问题？ | 主线 |
| 20 | [20-repo-rules-contributing.md](20-repo-rules-contributing.md) | 一个可靠改动需要哪些证据才能提交？ | 主线 |
| 21 | [21-capstone.md](21-capstone.md) | 独立完成一个可评审的小改动（毕业项目）。 | 主线 |
| 22 | [22-mcp-codemode.md](22-mcp-codemode.md) | 外部工具如何接入？模型写的代码如何执行？ | 选修 |
| 23 | [23-chord-durable.md](23-chord-durable.md) | "存了聊天记录"和"能恢复执行"差在哪？ | 选修 |
| 24 | [24-client-server.md](24-client-server.md) | 跨进程会话附着与路由是怎么工作的？ | 选修 |
| 25 | [25-observability-evals.md](25-observability-evals.md) | 如何区分代码正确性、任务成功率与运行效率？ | 选修 |

附录：

- [术语表](appendices/glossary.md)：中英文术语、首次出现的章节。
- [源码地图](appendices/source-map.md)：问题 → 文件 → 符号 → 测试。
- [命令速查](appendices/commands.md)：标明 shell、工作目录与前置条件。
- [故障排查](appendices/troubleshooting.md)：现象 → 定位步骤 → 修复方向。
- [练习与参考答案](appendices/exercises-and-answers.md)。
- [数据形状对照表](appendices/data-shapes.md)：六种数据形状的字段级对照与转换矩阵。
- [任务配方](appendices/recipes.md)：加工具/命令/快捷键/设置/供应商、写测试、排障、提交与分发的常用流程。
- [API 速查](appendices/api-cheatsheet.md)：四个包按组导出清单与常用 import 组合。
- [验证记录](appendices/validation.md)：哪些实验实际运行过、环境与结果。
- [版本与维护](appendices/version-notes.md)：基线信息与更新方法。
- [三平台命令与验证边界](appendices/platform-validation.md)：区分 Windows、Git Bash、WSL、Linux 与 macOS 的实际运行条件。

## 核心代码精读

主线章节负责建立整体模型；精读篇逐段对照关键源码，补充函数输入输出、状态变化、错误路径和设计取舍。建议先完成对应主线，再打开精读篇：

- [精读篇索引](deep-dives/README.md)
- [D1：Agent loop](deep-dives/D1-agent-loop.md)：模型轮次、事件和工具批次
- [D5：SDK 与 AgentSession](deep-dives/D5-sdk-session.md)：对象装配和 prompt 路径
- [D11：模型层](deep-dives/D11-model-layer.md)：provider 注册、认证和模型解析
- [D17：Anthropic 流式请求](deep-dives/D17-anthropic-stream.md)：请求转换、SSE 解码和统一事件
- [D18：OpenAI Responses 流式请求](deep-dives/D18-openai-responses.md)：输出槽位、工具参数完整性和整轮终态
- [D19：OpenAI Chat Completions 流式请求](deep-dives/D19-openai-completions.md)：chunk 累积、兼容字段和 finish reason
- [D20：Amazon Bedrock Converse](deep-dives/D20-bedrock-converse.md)：AWS credentials/region、事件流和错误诊断
- [D21：faux Provider 与 AgentSession 测试 Harness](deep-dives/D21-faux-test-harness.md)：脚本化模型响应、真实 session 测试路径与资源清理
- [D22：扩展加载失败与运行时生命周期](deep-dives/D22-extension-loader-lifecycle.md)：事务边界、缓存、reload/dispose 与 stale context
- [D23：新增 Provider 适配器路线](deep-dives/D23-provider-adapter-field-guide.md)：协议转换、流状态机、终态语义与测试矩阵
- [D24：真实 issue 的源码改动演练](deep-dives/D24-worked-source-change.md)：从测试契约追到历史 diff、AgentSession 调用顺序与验证边界
- [D25：资源解析与 reload 生命周期](deep-dives/D25-resource-loader-reload.md)：项目授权双阶段、包资源优先级、来源元数据与排障
- [D26：SettingsManager 配置状态与写入生命周期](deep-dives/D26-settings-manager-state.md)：配置合并、信任门、异步保存、外部编辑与 reload
- [D27：AgentSession.prompt() 与 run 收束边界](deep-dives/D27-agent-session-prompt-settlement.md)：输入分流、retry/compaction 续跑、扩展边界、取消与 idle
- [D28：AgentSessionRuntime 的会话替换生命周期](deep-dives/D28-agent-session-runtime-replacement.md)：new/resume/fork/import、旧运行时收尾、新运行时重建与失败边界

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
2. 按 [`appendices/version-notes.md`](appendices/version-notes.md) 记录差异；
3. 优先检查对应章节的"验证状态"标注，是否本来就是"设计中/静态核对"。
