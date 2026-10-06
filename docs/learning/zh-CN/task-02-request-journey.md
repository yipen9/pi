# 02. 从 CLI 到一次完整请求

今天从零追踪一次“读文件再回答”的请求。只需要本篇、列出的源码和本地依赖；不需要完成其他任务，也不需要模型账号。预计 2–3 小时。

## 今日准备

在仓库根目录确认 `node --version` 至少为 22.19.0，且存在 `node_modules`；缺少依赖时执行 `npm install --ignore-scripts`。动手测试在 `packages/coding-agent/test/suite/` 新建 `task-02-learning.test.ts`，不改现有测试。以下命令均从 `packages/coding-agent` 目录运行：

```powershell
node ../../node_modules/vitest/dist/cli.js --run test/suite/task-02-learning.test.ts
```

这里的 faux provider 是按预设脚本回答的假模型；`createHarness()` 会创建临时目录、内存会话和事件收集器，`cleanup()` 会清理这些资源。

## 学习内容

用“请读取 README 第一段并总结”作固定场景。一次用户请求先被 CLI 解析，主流程选择运行模式，SDK 装配应用会话，`AgentSession.prompt()` 做命令、输入和会话级准备，`Agent.prompt()` 启动 run，`runAgentLoop` 请求模型。模型若返回工具调用，工具结果进入上下文，再问一次模型，直到产出最终回答。这里的 **run** 是一次 Agent 启动到收束，**turn** 是一轮模型请求和可能的工具执行；同一 run 可以有多个 turn。CLI 的 print、JSON、RPC、interactive 模式共享核心逻辑，只是输入输出方式不同。

## 核心源码

`packages/coding-agent/src/cli/args.ts`的 `parseArgs` 决定用户输入是什么；`packages/coding-agent/src/main.ts`的 `main`、`resolveAppMode` 选择运行模式；`packages/coding-agent/src/core/sdk.ts`的 `createAgentSession` 创建对象；`packages/coding-agent/src/core/agent-session.ts`的 `prompt` 处理会话规则；`packages/agent/src/agent.ts`的 `prompt` 启动 run；`packages/agent/src/agent-loop.ts`的 `runAgentLoop` 决定请求模型与执行工具的次序。按此顺序阅读，给每个函数写“输入、输出、下一跳”。

## TypeScript 语法小课：`await`、回调与 `finally`

`await` 等待一个 Promise 结束，但事件订阅是另一条回调路径。一次 `session.prompt()` 的返回与 `message_update` 事件不能混作同一时刻。资源释放放在 `finally`，成功和抛错都能执行。

```typescript
const order: string[] = []; // 数组保存真实发生顺序
async function run(): Promise<void> {
  order.push("start"); // 这行同步执行
  await Promise.resolve(); // 从这里开始把后续步骤排到微任务
  order.push("end"); // Promise 完成后才执行
}
try {
  await run(); // 等待 run 结束，不等于等待所有无关回调
} finally {
  order.push("cleanup"); // 出错也要释放订阅与临时资源
}
console.assert(order.join(",") === "start,end,cleanup");
```

练习：在 `await` 后加 `throw new Error("stop")`，确认 `finally` 仍执行；再把同样的顺序标到 `AgentSession.prompt` 的调用链上。

## 完整学习资料

先按下列正文完成学习，再执行本篇的动手任务。正文中原书的实验与验收题先作为案例阅读，实际动手统一放到文末；只运行本篇“今日准备”和动手任务明确指定的离线命令。章节编号保留知识主题的原编号；源码精读、示例、边界条件、常见错误和参考答案均直接收录在本文件中。开头的预计用时仅指核心主线，完整源码精读需另留时间。

### 本篇共同基础

以下运行图和术语均在本文件内。学习正文保留原手册的知识主题编号，但那些编号不构成本任务的阅读前置；实际操作按本篇的动手任务与验收标准执行。学习正文基于原手册注明的 `200387122ca450d6387f033949423114a270b96c` 源码基线，当前工作区若有差异，以当前源码为准。

### 15 分钟主线：pi 怎样完成一件事

假设用户输入“读取 demo.txt，并总结三点”。模型自己不能读取你电脑里的文件。pi 把用户问题和可用工具告诉模型；模型提出 `read` 调用；pi 在本地执行；模型拿到文件内容后才生成总结。这就是全书反复使用的同一个例子。

**先看不带 TypeScript 细节的主流程（教学伪代码）：**

```text
收到用户输入，把它加入当前会话
重复：
    用当前上下文向模型发起请求
    收集模型的回答并把过程通知界面
    如果回答要求执行工具：
        校验参数，在本地执行工具，记录结果
        继续循环，让模型看到工具结果
    否则，检查是否还有排队输入或明确的继续决定
    如果都没有：结束本次运行
```

第一行确定这次任务和已有历史。模型请求只负责生成回答或提出工具调用。工具校验与执行由 pi 负责，结果回到对话后才可能有下一轮模型请求。界面接收运行事件，历史保存完成的消息；它们都与“模型请求”有关，但不是同一种数据。真实实现还处理工具并发、错误、取消、重试和压缩，后面分别讲。

**先分清四对容易混淆的词：**

| 两个词                | 直观区别                                           | 在“读文件并总结”中的例子                   |
| --------------------- | -------------------------------------------------- | -------------------------------------------- |
| 模型请求 / 用户输入   | 用户只说一次话，pi 可以多次询问模型                | 先请模型选择工具，读完文件后再请模型总结     |
| 事件 / 消息           | 事件告诉界面过程；消息承载一次完整的对话内容       | “正在输出第几个字”是事件；完成的总结是消息 |
| 工具调用 / 工具结果   | 调用提出想做什么；结果记录本地执行所得             | `read("demo.txt")` 是调用；文件文字是结果  |
| 会话历史 / 模型上下文 | 历史保留记录；上下文是这一次请求实际送给模型的内容 | 分支 C 仍在文件里，沿分支 D 继续时不必送 C   |

```text
一次用户输入
  → 第一次模型请求：请调用 read("demo.txt")
  → 本地工具执行：读出文件文本
  → 第二次模型请求：根据工具结果总结三点
  → 没有后续工作：结束
```

### 附录 A：术语表

> 用法：每个术语给出"一句话解释 + 首次出现的章节"。读代码遇到不认识的词，先查这里；查不到再搜源码（用英文名搜）。

#### A.1 核心概念

| 中文                  | 英文                    | 一句话                                                                                                             | 章节      |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ | --------- |
| 智能体外壳 / 运行框架 | agent harness           | 组织模型、工具、状态、界面的框架，本身不"聪明"                                                                     | 0.1       |
| 智能体                | agent                   | "模型 + 工具 + 循环"组成的执行体                                                                                   | 0.1       |
| 轮次                  | turn                    | 一次助手响应 + 它引发的工具执行                                                                                    | 3.3.3     |
| 低层运行              | Agent run               | 一次`Agent.prompt()` 或 `Agent.continue()` 调用建立的生命周期；以 `agent_end` 和已等待的 listener 收尾为边界 | 3.3.3、D2 |
| 会话 prompt 编排      | session prompt workflow | `AgentSession.prompt()` 在 `started` 后进入 `_runAgentPrompt()`；可串起 retry、压缩恢复和多个低层 Agent run  | 8、D27    |
| 用户请求              | user request            | 用户提交一次输入；与模型请求不等价                                                                                 | 3.3.3     |
| 模型请求              | model request           | 真正发给供应商 API 的一次请求                                                                                      | 3.3.3     |
| 转录                  | transcript              | 发给模型看/被记录的消息序列                                                                                        | 4.1       |
| 投影                  | projection              | 从会话树/文档到"模型实际看到的内容"的计算过程                                                                      | 9.4       |
| 活动分支              | active branch           | 从根到当前叶子的一条路径                                                                                           | 9.1       |
| 叶子                  | leaf                    | 会话树中的"当前位置"                                                                                               | 4.7.3     |
| 条目                  | entry                   | 会话文件里的一行（JSONL）                                                                                          | 4.7       |
| 会话                  | session                 | 一次对话的全部记录与状态                                                                                           | 8.1       |
| 压缩                  | compaction              | 用摘要替换旧上下文表示的机制                                                                                       | 10        |
| 上下文窗口            | context window          | 模型一次能接受的最大 token 量                                                                                      | 5.3       |
| 思考级别              | thinking level          | off/minimal/low/medium/high/xhigh/max                                                                              | 5.3       |
| 停止原因              | stop reason             | pending/stop/length/toolUse/error/aborted/deferred                                                                 | 4.3.3     |
| 用量                  | usage                   | token 与成本统计                                                                                                   | 4.3.5     |

#### A.2 消息与事件

| 中文           | 英文                | 一句话                                             | 章节        |
| -------------- | ------------------- | -------------------------------------------------- | ----------- |
| Agent 消息     | AgentMessage        | 内部消息（模型消息 + 应用自定义角色）              | 4.4         |
| 模型消息       | Message             | 供应商能理解的四角色联合                           | 4.3         |
| 内容块         | content block       | 消息内容的最小单元（text/image/thinking/toolCall） | 4.2         |
| 判别联合       | discriminated union | 用共同字面量字段区分成员的类型联合                 | 1.3.4       |
| 类型收窄       | narrowing           | 判断判别字段后类型自动缩小                         | 1.3.4       |
| 事件           | event               | 运行时广播（过程），不是消息（结果）               | 3.3.2       |
| 队列更新       | queue update        | 排队消息变化的会话事件                             | 4.5.2       |
| 边界（结算前） | agent_before_settle | 最后一个可行动钩子                                 | 6.2、13.3.5 |
| 已结算         | agent_settled       | "不会再自动继续"的最终信号                         | 4.5.2、16.3 |
| 延迟句柄       | deferred handle     | 异步应答的取回凭据                                 | 4.3.3       |

#### A.3 工具与模型

| 中文                | 英文                            | 一句话                                    | 章节  |
| ------------------- | ------------------------------- | ----------------------------------------- | ----- |
| 工具                | tool                            | 模型可调用的本地操作                      | 7.1   |
| 工具定义            | ToolDefinition                  | 扩展/应用注册工具的"富"形态               | 7.1.2 |
| 参数校验            | argument validation             | 用 typebox schema 在运行时校验调用参数    | 7.4   |
| 前置钩子            | beforeToolCall                  | 执行前可拦截（block）的钩子               | 7.6   |
| 后置钩子            | afterToolCall                   | 结果字段级改写的钩子                      | 7.6   |
| 顺序 / 并行执行     | sequential / parallel execution | 工具批次的两种调度                        | 7.5   |
| 终止提示            | terminate                       | "整批都同意时不因本批继续"的调度提示      | 7.5.4 |
| 模型                | model                           | 模型静态元数据（api/provider/限制/价格）  | 5.2.2 |
| 协议方言            | api                             | 供应商接口族标识（如 anthropic-messages） | 5.2.1 |
| 供应商              | provider                        | 认证 + 模型目录 + 请求实现                | 5.2.3 |
| 简单流式 / 完整流式 | streamSimple / stream           | 供应商无关档位 vs 协议特有选项            | 5.4   |
| 兼容开关            | compat                          | OpenAI 兼容生态的行为微调                 | 5.5.4 |
| 假供应商            | faux provider                   | 脚本化、离线的测试模型                    | 5.7   |

#### A.4 会话与持久化

| 中文       | 英文             | 一句话                             | 章节   |
| ---------- | ---------------- | ---------------------------------- | ------ |
| 会话管理器 | SessionManager   | 会话文件的对象化句柄               | 9.3    |
| 分支会话   | branched session | 只包含"根到叶子"路径的新文件       | 9.5.2  |
| 分支摘要   | branch summary   | 放弃某分支时生成的摘要条目         | 10.6   |
| 上下文编辑 | context edit     | 只改"投影"、不改原始条目的追加编辑 | 9.4.4  |
| 保留边界   | firstKeptEntryId | 压缩后从哪条开始保留               | 10.3.2 |
| 保留预算   | keepRecentTokens | 压缩后至少保留的近期上下文         | 10.3   |
| 预留       | reserveTokens    | 为模型回复预留的窗口               | 10.2.1 |
| 检测点替换 | checkpoint       | 压缩条目携带的提示词/工具检查点    | 9.4.3  |

#### A.5 扩展与集成

| 中文       | 英文            | 一句话                             | 章节       |
| ---------- | --------------- | ---------------------------------- | ---------- |
| 上下文文件 | context files   | AGENTS.md 等纯文本指令             | 11.4.2     |
| 项目信任   | project trust   | 允许加载项目可执行资源前的人工决定 | 11.5       |
| 提示词模板 | prompt template | Markdown 变成`/命令`             | 12.3.2     |
| 技能       | skill           | 目录 + SKILL.md 的按需说明书       | 12.3.3     |
| 扩展       | extension       | 可执行 TypeScript 模块（进程权限） | 12.3.4、13 |
| Pi 包      | Pi package      | 分发多资源的 npm/git 单元          | 12.3.6     |
| 钳制       | clamp           | 按模型能力压低思考级别             | 5.3        |
| 重绑       | rebind          | 会话替换后重新挂订阅/扩展绑定      | 8.6        |

#### A.6 协议与架构（选修）

| 中文     | 英文                   | 一句话                                          | 章节   |
| -------- | ---------------------- | ----------------------------------------------- | ------ |
| MCP      | Model Context Protocol | 外部工具/资源接入协议                           | 22     |
| 暴露方式 | exposure               | codemode/deferred/direct 三种工具到达模型的方式 | 22.3   |
| 工具搜索 | tool_search            | deferred 工具的"发现后再直调"机制               | 22.3   |
| 沙箱     | codemode sandbox       | QuickJS VM + worker 的脚本执行环境              | 22.9   |
| 面片     | facet                  | Chord 插件可独立打包到不同环境的分片            | 23.2   |
| 服务     | service                | Chord 的类型化稳定 token（singleton/keyed）     | 23.2   |
| 复制状态 | replicated state       | 原子发布、完整不可变值消费的状态                | 23.2   |
| 增量跟踪 | delta tracking         | 记录/合并 JSON 操作的机制                       | 23.2   |
| 持久执行 | durable execution      | 意图先提交、崩溃可续的执行模型                  | 23.1   |
| 检查点   | checkpoint             | 任务每一步的持久落点                            | 23.3.1 |
| 附着     | attachment             | 一条表现层连接绑定到一个会话                    | 24.2   |
| 信封     | envelope               | 协议中包裹 payload 的定向记录                   | 24.3   |
| span     | span                   | 一次操作的时间记录（遥测）                      | 25.2   |
| lift     | lift                   | 处理组相对对照组的提升（评估）                  | 25.5   |
| 阻断配对 | blocked pair           | 两臂未各得恰好一个分数，禁止计入头条            | 25.6   |

#### A.7 容易混淆的成对术语

| 对                                              | 区分                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| message vs event                                | 结果 vs 过程（3.3.2）                                                                  |
| turn vs run                                     | 一个轮次 vs 整次运行（3.3.3）                                                          |
| `agent_end` vs `agent_settled`              | 低层 run 结束 vs 自动工作清零（4.5.2）                                                 |
| 声明 vs 可执行                                  | 系统消息里的工具声明 vs 运行时工具集（7.3）                                            |
| details vs content                              | 给界面/程序 vs 给模型（14.2）                                                          |
| 完成顺序 vs 记录顺序                            | 并发完成 vs 声明序记录（7.5.3）                                                        |
| 停止原因`length` vs `stop`                  | 被截断 vs 正常说完（4.3.3）                                                            |
| `AgentSession.prompt()` vs `Agent.prompt()` | 应用层输入分流/会话编排 vs 低层 Agent run 入口（8、D2、D27）                           |
| `handled` vs `queued` vs `started`        | 输入被消费、不创建该输入自己的 run / 放入当前运行队列 / 进入会话 run 编排（8、16.5.3） |
| 提示词模板 vs 技能                              | 一段话 vs 一套流程+文件（12.3.3）                                                      |
| 扩展 vs Pi 包                                   | 可执行单元 vs 分发单元（12.3.6）                                                       |
| compaction 摘要 vs branch summary               | 压缩历史 vs 放弃分支（10.6）                                                           |
| durable cheat sheet：`replay: safe/never`     | 崩溃后重跑 vs 报 interrupted（23.4）                                                   |
| JSONL RPC vs client/server                      | 进程内 stdio 协议 vs 跨进程服务路由（24.1）                                            |
| 单测 vs 评估                                    | 确定性 vs 配对统计（25.1、25.6）                                                       |

#### A.8 输入与运行的层级

不要按“用户按了一次回车”推断低层 run 或模型请求的数量。实际层级是：

| 层级       | 代表符号                                           | 次数关系                                                                                      |
| ---------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 输入调用   | `AgentSession.prompt(text)`                      | 一次调用只表达一次输入尝试；结果可能是`handled`、`queued` 或 `started`                  |
| 会话编排   | `_runAgentPrompt(messages)`                      | 只在开始处理输入时进入；在里面管理重试、压缩恢复、边界 continuation 与取消                    |
| Agent run  | `Agent.prompt(messages)` 或 `Agent.continue()` | 一次会话编排可包含多个 run；每个低层 run 都发出自己的`agent_start` / `agent_end` 生命周期 |
| Agent turn | `turn_start` 到 `turn_end`                     | 一个 run 可包含多个 turn；每个 turn 通常包含一次助手响应及其引发的工具执行                    |
| 模型请求   | `streamSimple` / provider stream                 | 通常发生在助手响应阶段；自动重试会再次请求模型，压缩摘要等内部工作也可能有独立请求            |

两个边界例子：

- 扩展命令被消费时，`prompt()` 返回 `handled`，没有为该输入启动 `_runAgentPrompt()`；
- `prompt()` 在 Agent 已运行时以 `steer`/`followUp` 方式排队，返回 `queued`。这条输入会影响现有流程，但它本身不是新的 `Agent.prompt()` 调用。

因此，统计“模型请求次数”不能数 prompt、turn 或 `agent_end`：应按 provider 请求事件/日志，或明确的测试探针计数。章节 21 的自测题也按这个区分评分。

#### A.9 索引方式说明

- 想找"某行为在哪个文件" → 用 source-map；
- 想找"某命令怎么跑" → 用 commands；
- 想找"某现象怎么排" → 用 troubleshooting；
- 想找"哪些练习要做" → 用 exercises-and-answers。

---

### 第 3 章：从输入到最终回答的完整旅程

**先懂这一章**：用户输入“读文件并总结”，模型先要求调用工具，pi 执行后把结果交回模型，模型再总结。本章沿这件事从入口走到结束，先找到每层负责什么，再看函数细节。

```text
教学伪代码：输入消息 → 创建或取得会话 → 启动 Agent 运行
           → 模型提出工具调用 → 本地执行并回填结果
           → 再次请求模型 → 显示回答并保存记录
```

这里省略了配置、排队、失败和取消。先用这条线区分“进入程序”“请求模型”“执行工具”“更新界面”，再逐节对照真实源码。

第 0–2 章让你能找到包、读懂 TypeScript 并运行源码；从本章开始，把这些知识连成一次真实请求。第 4 章会把本章沿途遇到的消息、事件和会话条目分开定义。

> 学完本章你能回答：
>
> 1. 一条用户输入，从命令行到最终回答，中间经过哪些文件、哪些函数？
> 2. 为什么"读文件并总结"需要**两次**模型请求？两次分别发生在哪里？
> 3. "一次用户请求"、"一个 turn（轮次）"、"一次模型请求"这三个概念怎么区分？
> 4. 界面上的流式文字是从哪个环节产生的？它和最终的完整消息是什么关系？

**预计学习时间**：2 天（本章是全书的地标章节，值得慢读）。
**本章验证状态**：静态核对通过（所有引用已对照基线 commit 的源码逐段检查）；实验留待第 5-6 章用 faux provider 落地。

---

#### 3.1 本章要追踪的场景

固定输入（后文所有追踪都以它为准）：

```text
用户输入：读取 demo.txt，并总结三点。
```

假设 `demo.txt` 存在、模型也按预期工作。你要建立的直觉是下面这条轨迹（先看图，别急着看代码）：

```text
用户消息 "读取 demo.txt 并总结三点"
  │
  ├─ 第 1 次模型请求（携带系统提示、历史消息、工具清单）
  │    模型流式回答：我先调用 read 工具 { path: "demo.txt" }
  │
  ├─ pi 在本地执行 read 工具，得到文件内容
  │
  ├─ 第 2 次模型请求（在上面的历史后追加"工具结果"消息）
  │    模型流式回答：三点总结（不再调用工具）
  │
  └─ 运行结束，界面显示总结
```

两个常见误解先破掉：

- **误解一："一次用户请求 = 一次模型请求"**。不对。只要模型提出工具调用，pi 就要执行工具、把结果发回去、再问一次模型。上例是两次；如果模型连续调用三个工具，可能就是四次。
- **误解二："模型自己读文件"**。不对。模型只输出"我想调用 read，参数是 demo.txt"这种**意图**；真正读文件的是你本机上的 pi 进程。

#### 3.2 五层地图：本章的目录

整个旅程可以分成五层。每层都有明确的职责、明确的文件、明确的"下一层入口"：

```mermaid
flowchart TD
  L1[入口层<br/>src/cli.ts → main.ts<br/>解析参数、组装服务、选择模式]
  L2[会话层<br/>core/agent-session.ts<br/>AgentSession.prompt：校验、扩展、压缩检查]
  L3[Agent 层<br/>packages/agent/src/agent.ts<br/>串行化运行、事件分发、状态维护]
  L4[循环层<br/>packages/agent/src/agent-loop.ts<br/>runLoop：请求模型→执行工具→判断继续]
  L5[模型层<br/>packages/ai/src/models.ts + providers/*<br/>统一接口→具体供应商]
  L1 --> L2 --> L3 --> L4 --> L5
  L5 -.事件流.-> L4
  L4 -.工具.-> L4
```

| 层       | 职责                                                 | 关键文件                                       | 深入章节        |
| -------- | ---------------------------------------------------- | ---------------------------------------------- | --------------- |
| 入口层   | 把命令行变成"可运行的会话运行时"                     | `src/cli.ts`、`src/main.ts`                | 本章 + 第 16 章 |
| 会话层   | 把"一条用户输入"变成"Agent 可以跑的提示消息"         | `src/core/agent-session.ts`                  | 第 8 章         |
| Agent 层 | 保证一次只跑一个 run、维护状态、派发事件             | `packages/agent/src/agent.ts`                | 第 6 章         |
| 循环层   | 真正决定"继续还是结束"的循环                         | `packages/agent/src/agent-loop.ts`           | 第 6、7 章      |
| 模型层   | 把统一请求转换成供应商请求，把供应商流转换成统一事件 | `packages/ai/src/models.ts`、`providers/*` | 第 5 章         |

**分层读法是本项目的核心读法**：遇到任何行为问题，先问"这是哪一层的问题"，再往下钻。

#### 3.3 三个必须区分的概念

在进入代码之前，先把三个容易混淆的概念钉死（它们的代码证据在本章随文给出）。

##### 3.3.1 概念一：AgentMessage（内部消息）vs Message（模型消息）

pi 内部流动的消息类型叫 `AgentMessage`。它比"模型能理解的消息"更宽：

- 标准角色：`system`、`user`、`assistant`、`toolResult`；
- 应用自定义消息：如 `custom`（扩展注入的内容），模型不需要看到。

在真正调用模型前，有一道"翻译关卡" `convertToLlm`（`packages/agent/src/agent.ts` 的默认实现）：

**先想它的作用**：内部历史可能包含模型不认识的自定义消息。默认实现先筛掉这些消息，让模型只接收标准角色；应用层还可以定义更完整的转换。下面的伪代码只描述这里的默认筛选。

```text
教学伪代码：遍历内部消息
           → 是 system/user/assistant/toolResult 就保留
           → 其他角色交给上层转换规则或从本次模型输入中排除
```

```typescript
function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter(
		(message) =>
			message.role === "system" ||
			message.role === "user" ||
			message.role === "assistant" ||
			message.role === "toolResult",
	);
}
```

注意它是"过滤 + 转换"：丢掉模型不该看的内容，把自定义类型翻译成标准类型。`coding-agent` 包的 `core/messages.ts` 提供了更完整的转换（第 4 章精读）。

##### 3.3.2 概念二：消息（给模型/历史）vs 事件（给界面/订阅者）

- **消息**：会被记录、会被发给模型的"事实"（用户说了什么、模型回答了什么、工具返回了什么）；
- **事件**：运行过程中的"广播"（刚开始流式输出、工具开始执行、某个增量文本到达），给界面和订阅者看，**不等于**消息本身。

两者的关系：事件是过程，消息是结果。`text_delta` 事件来了五次，最终只形成**一条** assistant 消息。第 4 章会给出完整对照表。

##### 3.3.3 概念三：用户请求、run、turn、模型请求

| 名称         | 定义                            | 在本例中的数量                            |
| ------------ | ------------------------------- | ----------------------------------------- |
| 用户请求     | 用户提交一次输入                | 1                                         |
| run（运行）  | 从开始处理到 Agent 空闲         | 1                                         |
| turn（轮次） | 一次助手响应 + 它引发的工具执行 | 2（第一次响应调用工具、第二次响应给总结） |
| 模型请求     | 真正发给供应商 API 的请求       | 2                                         |
| 工具执行     | 本地实际执行工具                | 1（read）                                 |

这张表是本章的骨架。现在开始逐层追踪。

#### 3.4 入口层：从命令行到 `main()`

##### 3.4.1 第一站：`src/cli.ts`（构建产物 `dist/bundle/cli.js` 的源码）

`packages/coding-agent/src/cli.ts` 只有 139 字节：

**先想它的作用**：这是进程入口，只负责做启动准备，再把命令行参数交给 `main()`；这里还没有向模型提问。

```text
教学伪代码：启动 Node 进程 → 设置 CLI 运行环境
           → 去掉 Node 自带的两个 argv 项 → 调用 main
```

```typescript
#!/usr/bin/env node
import { setupCli } from "./cli/setup.ts";
import { main } from "./main.ts";

setupCli();
main(process.argv.slice(2));
```

三个信息：

1. `#!/usr/bin/env node`：shebang，让打包后的文件可以当作可执行命令运行（`bin` 入口约定）；
2. `setupCli()`：在任何业务代码前做进程级初始化；
3. `main(process.argv.slice(2))`：把命令行参数（去掉 node 路径和脚本路径）交给主函数。

`setupCli()` 在 `src/cli/setup.ts`：

**先想它的作用**：后面的模型请求和输出模式依赖进程级设置，因此启动时先统一处理进程标记、告警输出和 HTTP 连接配置。

```text
教学伪代码：标记当前进程为 pi → 调整进程输出行为
           → 在供应商请求前准备 HTTP 调度器
```

```typescript
export function setupCli(): void {
	process.title = APP_NAME;
	process.env.PI_CODING_AGENT = "true";
	process.env.AI_AGENT = "pi";
	process.emitWarning = (() => {}) as typeof process.emitWarning;

	// Configure undici before provider SDKs issue requests. Settings are applied
	// once SettingsManager has loaded global/project configuration.
	configureHttpDispatcher();
}
```

- 设置进程标题和两个标记环境变量（其他工具/扩展靠它们识别"我在 pi 里运行"）；
- **静音 `process.emitWarning`**：因为第 1 章看到的 `ExperimentalWarning: Type Stripping` 之类警告会污染输出（尤其 print/json/rpc 模式的 stdout/stderr），源码运行体验更好；
- 提前配置 HTTP 调度器（代理、超时），保证后面所有供应商请求走同一套底层配置。

> 源码版 `pi-test.sh` 走的是 `src/experimental/cli.ts`（第 2 章 2.4.3），它先尝试 `runExperimentalCommand`（如 `pi client ...` 实验命令），没命中再调用同一个 `main(args)`。两条路最终合流。

##### 3.4.2 第二站：`main()` 的前半段（启动与装配）

`packages/coding-agent/src/main.ts` 第 573 行开始是主函数。按顺序（节选 + 注释，省略与本章无关的分支）：

**先想它的作用**：不是每个命令都需要创建 Agent。`main()` 先处理能够立即完成的命令，再确定工作目录、配置和运行模式。这样 `--version` 之类的调用不必走完整启动流程。

```text
教学伪代码：检查离线等启动选项 → 处理可提前完成的子命令
           → 固定工作目录 → 读取安全的初始配置
           → 解析参数与模式 → 为后续会话装配做准备
```

```typescript
export async function main(args: string[], options?: MainOptions) {
	resetTimings();                 // 启动耗时打点器归零
	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.PI_OFFLINE);
	if (offlineMode) {
		process.env.PI_OFFLINE = "1";
		process.env.PI_SKIP_VERSION_CHECK = "1";
	}

	if (await runAuthCommand(args)) return;   // `pi auth ...` 子命令分流

	const cwd = process.cwd();                 // 【重要】后面一切"项目相关"行为都以它为准
	const agentDir = getAgentDir();            // 全局配置目录（默认 ~/.pi/agent）
	const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher();

	if (await handlePackageCommand(args, { extensionFactories })) { /* pi install/remove/... */ }
	if (await handleConfigCommand(args, { extensionFactories })) { /* pi config ... */ }
	// ... `pi mcp` 子命令分流

	const parsed = parseArgs(args);            // 参数解析（定义在 cli/args.ts）
	// ... 打印诊断；有 error 则退出

	if (parsed.version) { console.log(VERSION); process.exit(0); }   // --version 快速退出
	if (parsed.export) { /* 导出会话为 HTML 后退出 */ }

	let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
	const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
	if (shouldTakeOverStdout) takeOverStdout();
	// ... RPC 模式拒绝 @file；校验 --fork/--session-id 组合
	runMigrations(cwd);                        // 配置迁移
	// ... 首次启动引导、主题覆盖
```

这里已经能读出四个设计点，写代码的直觉就是这么积累起来的：

1. **快速命令先分流**：`auth`、`install`、`config`、`mcp`、`--version`、`--export` 都在"创建会话"之前处理掉。跑一次 `pi --version` 不会加载模型、不会扫资源。
2. **`cwd` 显式落盘**：`process.cwd()` 只取一次。之后所有模块传的都是这个值，避免"运行中途有人改了工作目录"导致状态割裂。
3. **信任先于加载**：bootstrap 设置管理器用 `projectTrusted: false` 创建——项目资源是否可信还没判定，先不能执行项目里的代码（第 11 章展开）。
4. **stdout 接管**：非交互模式下调用 `takeOverStdout()`，把裸写 stdout 的日志重定向到 stderr，保证协议输出干净（第 16 章的伏笔）。

##### 3.4.3 第三站：会话目录与运行时工厂

继续往下（这是 `main()` 中最关键的一段）：

**先想它的作用**：用户可能指定会话目录，也可能恢复一个与当前目录不同的会话。运行时工厂保存“如何按目标工作目录重新建会话”的办法，所以会话切换后不会继续沿用旧目录的资源。

```text
教学伪代码：按参数/环境/设置确定会话目录 → 创建会话管理器
           → 定义运行时工厂：判断项目信任、加载资源、创建会话
           → 用工厂建立当前运行时
```

```typescript
	const envSessionDir = process.env[ENV_SESSION_DIR];
	const sessionDir = (parsed.sessionDir ? normalizePath(parsed.sessionDir) : undefined)
		?? (envSessionDir ? expandTildePath(envSessionDir) : undefined)
		?? startupSettingsManager.getSessionDir();
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
	// ...（处理会话指向的 cwd 缺失等边界）

	const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
	// ... 同样的 skill / promptTemplate / theme 路径解析

	const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext }) => {
		// ... 项目信任判定（首次运行可能弹交互询问）
		const runtimeSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
		const services = await createAgentSessionServices({
			cwd, agentDir, settingsManager: runtimeSettingsManager,
			resourceLoaderOptions: { /* 扩展/技能/模板/主题/上下文文件等发现配置 */ },
		});
		// ... 诊断信息收集；--model/--models 作用域解析（resolveModelScope）
		const created = await createAgentSessionFromServices({
			services, sessionManager, sessionStartEvent,
			model: sessionOptions.model, thinkingLevel: sessionOptions.thinkingLevel,
			tools: sessionOptions.tools, excludeTools: sessionOptions.excludeTools, noTools: sessionOptions.noTools,
			customTools: sessionOptions.customTools,
		});
		return { ...created, services, diagnostics };
	};
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: sessionManager.getCwd(), agentDir, sessionManager,
	});
```

三个要点：

- **会话目录的三个来源，优先级从高到低**：`--session-dir` 参数 → 环境变量 `PI_CODING_AGENT_SESSION_DIR` → 设置里的 `sessionDir`。
- **`createRuntime` 是"工厂函数"，不是一次性的对象**。因为会话可能切换工作目录（或恢复别的项目的会话），"cwd 绑定"的东西（项目设置、资源、工具、会话）需要**能重建**。`createAgentSessionRuntime` 把它包成运行时，第 8 章讲透。
- **`createAgentSessionServices` / `createAgentSessionFromServices` 与 SDK 的 `createAgentSession` 是两套入口**：SDK 走"一步到位"的 `createAgentSession`（3.5 节读它）；CLI 为了支持运行时可重建，拆成"服务 + 会话"两步。**读代码时先确认你读的是哪一条路**，这是很多人第一次读 `sdk.ts` 会迷路的原因。

##### 3.4.4 第四站：模式分发（本章旅程的岔路口）

`main()` 的结尾：

**先想它的作用**：启动准备完成后，按模式交给不同界面；这些界面接收输入的方式不同，但最终都会使用同一套会话处理能力。

```text
教学伪代码：准备初始输入 → 如果是 RPC，持续读取命令
           → 否则如果是交互模式，打开终端界面
           → 否则执行一次 print/JSON 任务
```

```typescript
	if (parsed.help) { /* 打印帮助后退出 */ }
	if (parsed.listModels !== undefined) { /* 列出模型后退出 */ }

	let stdinContent: string | undefined;
	if (appMode !== "rpc") {
		stdinContent = await readPipedStdin();          // 管道输入：`git diff | pi -p ...`
		if (stdinContent !== undefined && appMode === "interactive") appMode = "print";
	}

	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, stdinContent);
	// ... 初始化主题

	if (appMode === "rpc") {
		await runRpcMode(runtime);                       // ① RPC：stdin 收 JSONL，stdout 回响应
	} else if (appMode === "interactive") {
		const interactiveMode = new InteractiveMode(runtime, { /* ... */ });
		await interactiveMode.run();                     // ② 交互：全屏 TUI
	} else {
		const exitCode = await runPrintMode(runtime, {   // ③ print/json：一次性运行
			mode: toPrintOutputMode(appMode),            //    "text" 或 "json"
			messages: parsed.messages, initialMessage, initialImages,
		});
		// ...
	}
```

`resolveAppMode` 的规则（依据 `cli.md` 与代码）：显式 `--print` 或 `--mode json|rpc` 直接定；否则看 stdin/stdout 是否都是终端（TTY）——都是终端进交互模式，任一被重定向则退化为 print 模式。

**三个模式最终都会调用同一个东西**：`session.prompt(...)`。这就是为什么本章只讲一条公共路径。

```mermaid
flowchart LR
  A[pi 命令] --> B{appMode}
  B -->|rpc| C[runRpcMode]
  B -->|interactive| D[InteractiveMode]
  B -->|print/json| E[runPrintMode]
  C --> F[session.prompt]
  D --> F
  E --> F
  F --> G[第 3.6 节：会话层]
```

（提示：交互模式里，用户每次回车都会触发一次 `session.prompt`；print 模式在启动流程中触发一次；RPC 模式收到 `prompt` 命令时触发。三种触发时机不同，进入 3.5 节后就完全一样了。）

#### 3.5 装配层：`createAgentSession` 到底组装了什么

在进入 `session.prompt` 之前，先花几分钟看清"会话里到底有什么"。SDK 的 `packages/coding-agent/src/core/sdk.ts` 是最好读的装配入口（CLI 走的是等价的两步式流程，见 3.4.3）。

以下按源码顺序（`sdk.ts` 第 175 行起）节选并注释：

**先想它的作用**：`createAgentSession` 不直接回答问题，它准备回答问题所需的模型、设置、历史和资源。调用者提供某个部件时使用它，否则创建默认部件。

```text
教学伪代码：确定 cwd 和配置目录
           → 取得或创建模型运行时、设置、会话存储
           → 如果没有自定义资源加载器，就创建并加载默认资源
           → 继续选择工具并创建 AgentSession
```

```typescript
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
	const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
	const agentDir = options.agentDir ? resolvePath(options.agentDir) : getDefaultAgentDir();
	let resourceLoader = options.resourceLoader;

	// 1. 模型运行时：谁来发请求、怎么认证
	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ authPath, modelsPath }));

	// 2. 三件套：设置、会话存储、资源加载器
	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));

	if (!resourceLoader) {
		resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await resourceLoader.reload();   // 真正去磁盘上"发现"扩展/技能/模板/主题/上下文文件
		time("resourceLoader.reload");
	}
```

这段值得单独说三点：

- **一切皆可注入**：每个组件都是 `options.X ?? 默认实现`。测试通过注入假实现完成离线运行，SDK 用户也可以只替换其中一个（第 15 章逐个演示）。
- **默认行为不是"空"而是"发现"**：`DefaultResourceLoader.reload()` 会扫描工作目录与 `~/.pi/agent`，这正是 `01-minimal.ts` 注释里说的 "discovers skills, extensions, tools, context files from cwd and ~/.pi/agent"。
- **`ModelRuntime` 是认证与模型的统一门面**：具体认证逻辑（API Key / OAuth / 环境变量）都在它和 `model-resolver.ts` 里，第 5、11 章展开。

继续读"恢复"逻辑：

```typescript
	// 3. 会话恢复：如果这个会话文件里已有内容，尽量把模型也恢复回来
	const existingSession = sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");

	let model = options.model;
	const sessionModel = getBranchSelection(sessionManager.getBranch(), (provider, modelId) =>
		modelRuntime.getModel(provider, modelId),
	);
	if (!model && hasExistingSession && sessionModel) {
		const restoredModel = modelRuntime.getModel(sessionModel.provider, sessionModel.modelId);
		if (restoredModel && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
			model = restoredModel;   // 之前的会话用哪个模型，继续用它
		}
		// ... 否则记录 modelFallbackMessage（恢复失败的原因）
	}

	// 4. 仍然没有模型：按"设置里的默认 → 各供应商默认"顺序找
	if (!model) {
		const result = await findInitialModel({ scopedModels: [], isContinuing: hasExistingSession, /* ... */ });
		model = result.model;
		if (!model) modelFallbackMessage = formatNoModelsAvailableMessage();
	}
```

然后是思考级别与工具白名单：

```typescript
	// 5. thinkingLevel（思考深度）：会话恢复值 → 每模型设置 → 全局默认，最后按模型能力钳制
	thinkingLevel = clampThinkingLevel(model, thinkingLevel) as ThinkingLevel;

	// 6. 工具选择：显式 tools > defaultTools 设置 > 内置默认（DEFAULT_TOOL_NAMES）
	const configuredDefaultToolNames = settingsManager.getDefaultTools();
	const allowedToolNames = options.tools ?? (options.noTools === "all" ? [] : undefined);
	const excludedToolNames = options.excludeTools;
	const initialActiveToolNames = (
		options.tools ?? (options.noTools ? [] : (configuredDefaultToolNames ?? DEFAULT_TOOL_NAMES))
	).filter((name) => !excludedToolNameSet?.has(name));
```

再往下是"图片屏蔽"包装、缓存预热器和请求选项构建（选中读，不需要背）：

```typescript
	// 7. 消息转换包装：如果设置里禁止读图，就把图片块替换为文字占位符（纵深防御）
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => { /* ... */ };

	const extensionRunnerRef: { current?: ExtensionRunner } = {};
	const cacheWarmer = new CacheWarmer(modelRuntime, sessionManager,
		() => settingsManager.getCacheWarmingMode(),
		async (event) => extensionRunnerRef.current?.emitCacheWarmingDecision(event) ?? event.action,
	);
	const buildRequestOptions = (requestModel: Model<any>, options: ModelsSimpleStreamOptions = {}):
		ModelsSimpleStreamOptions => {
		// 超时 / 重试参数来自设置；合并供应商归因请求头；给扩展留 before_provider_headers 钩子
	};
```

最后是本层的主角——创建 `Agent` 与 `AgentSession`：

```typescript
	const agent = new Agent({
		initialState: { systemPrompt: "", model, thinkingLevel, tools: [], messages: existingSession.messages },
		convertToLlm: convertToLlmWithBlockImages,
		streamFn: async (model, context, options) => {
			const requestOptions = buildRequestOptions(model, options);
			// 只有"会话请求"才更新缓存预热的水位：压缩、摘要有自己的 sessionId
			if (options?.sessionId === sessionManager.getSessionId()) {
				cacheWarmer.start({ model, context, options: requestOptions }, cacheContextIsCurrent(model));
			}
			return modelRuntime.streamSimple(model, context, requestOptions);
		},
		onPayload: transformProviderPayload,         // 扩展钩子：before_provider_request
		onResponse: handleProviderResponse,           // 扩展钩子：after_provider_response
		onProviderStreamEvent: handleProviderStreamEvent,
		sessionId: sessionManager.getSessionId(),
		transformContext: async (messages) => {
			const runner = extensionRunnerRef.current;
			if (!runner) return messages;
			return runner.emitContext(messages);      // 扩展钩子：context 变换（第 13 章）
		},
		steeringMode: settingsManager.getSteeringMode(),
		followUpMode: settingsManager.getFollowUpMode(),
		// ...
	});

	// 7.5 记录初始模型/思考级别，供下次恢复
	if (hasExistingSession) {
		if (!hasThinkingEntry) sessionManager.appendThinkingLevelChange(thinkingLevel);
	} else {
		if (model) sessionManager.appendModelChange(model.provider, model.id);
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	const session = new AgentSession({
		agent, sessionManager, settingsManager, cwd,
		scopedModels: options.scopedModels,
		resourceLoader, customTools: options.customTools, modelRuntime, cacheWarmer,
		initialActiveToolNames, usesDefaultTools: options.tools === undefined && !options.noTools,
		allowedToolNames, excludedToolNames, extensionRunnerRef,
		sessionStartEvent: options.sessionStartEvent,
	});

	return { session, extensionsResult: resourceLoader.getExtensions(), modelFallbackMessage };
}
```

请把这一段的"对象关系"画成图（第 8 章会逐项解释所有权与释放）：

```mermaid
flowchart TD
  AS[AgentSession<br/>应用会话] --> A[Agent<br/>运行时]
  AS --> SM[SessionManager<br/>会话存储]
  AS --> ST[SettingsManager<br/>设置]
  AS --> RL[DefaultResourceLoader<br/>扩展/技能/模板/主题]
  AS --> MR[ModelRuntime<br/>模型与认证]
  A --> SF[streamFn 包装<br/>请求选项 + 缓存预热]
  SF --> MR
```

注意两个"跨层"点：

- `Agent` 的 `systemPrompt` 初始是空字符串——真正的系统提示由 `AgentSession` 在每次 prompt 前组装（第 10 章）；
- `Agent` 是**纯运行时**，它不知道文件、扩展、设置；它拿到的 `streamFn` 是 `AgentSession`（实际上是 sdk.ts 装配处）包装过的版本。这就是第 0 章讲的"下层只提供机制、上层决定用法"的具体体现。

#### 3.6 会话层：`AgentSession.prompt` 在进入循环前做了什么

**先懂**：`prompt()` 先判断这段输入是不是扩展命令、是否要排队、是否允许在当前压缩状态下提交。只有真正要交给模型的输入，才会组装成消息并启动 Agent。

```text
教学伪代码：收到输入 → 若处于收束阶段则延后
           → 若是扩展命令则执行命令并结束这条输入
           → 检查当前能否提交或需要排队
           → 准备消息和资源 → 启动 Agent
```

同样的文字输入，在不同会话状态下走的路径不同；以下按分支顺序看源码。

入口找到 `packages/coding-agent/src/core/agent-session.ts` 第 1921 行（文件太大，请用"转到定义/搜索符号"定位，不要从头读）。方法很长，但结构是线性的。我们按分支顺序过一遍（节选 + 注释，删减了与本章无关的细节）：

```typescript
async prompt(text: string, options?: PromptOptions): Promise<void> {
	// ① 如果正在收尾（agent_settled 等收尾事件的处理过程中），先排队延后执行
	if (this._isEmittingAgentSettled) {
		this._deferredSettledActions.push(async () => await this.prompt(text, options));
		return;
	}

	// ② 以 "/" 开头且是扩展命令：立即执行，不发送给模型
	if (expandPromptTemplates && text.startsWith("/")) {
		const handled = await this._tryExecuteExtensionCommand(text);
		if (handled) { preflightResult?.("handled"); return; }
	}

	// ③ 压缩进行中不许提交（避免上下文在生成中变化）
	if (this._compactionAbortController !== undefined) {
		throw new Error("Cannot submit a prompt while compaction is in progress. ...");
	}

	// ④ 扩展的输入拦截钩子（可以改写文本、取消发送、决定入队行为）
	const processedInput = await this._runInputHandlers(text, options?.images,
		options?.source ?? "interactive", this.isStreaming ? options?.streamingBehavior : undefined);
	if (!processedInput) { preflightResult?.("handled"); return; }

	// ⑤ 展开 /skill:名称 与提示词模板
	let expandedText = currentText;
	if (expandPromptTemplates) {
		expandedText = this._expandSkillCommand(expandedText);
		expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
	}

	// ⑥ 正在流式输出时：不允许直接再发，必须明确行为（steer 或 followUp 入队）
	if (this.isStreaming) {
		if (!options?.streamingBehavior) throw new Error("Agent is already processing. ...");
		if (options.streamingBehavior === "followUp") await this._queueFollowUp(expandedText, currentImages);
		else await this._queueSteer(expandedText, currentImages);
		preflightResult?.("queued");
		return;
	}

	// ⑦ 冲刷之前积累的 bash 输出/自定义消息（它们要排在本次输入之前）
	this._flushPendingBashMessages();
	this._flushPendingCustomMessages();

	// ⑧ 必须已选择模型、且该供应商认证可用，否则立刻报错
	if (!this.model) throw new Error(formatNoModelSelectedMessage());
	const hasConfiguredAuth = this._modelRuntime.hasConfiguredAuth(this.model.provider)
		|| (await this._modelRuntime.checkAuth(this.model.provider)) !== undefined;
	if (!hasConfiguredAuth) { /* OAuth 过期提示 或 "没有 API Key" 提示 */ }

	// ⑨ 发送前检查是否需要先压缩上下文（例如上一次响应被取消留下了过长历史）
	const lastAssistant = this._findLastAssistantMessage();
	if (lastAssistant) await this._checkCompaction(lastAssistant, false);

	// ⑩ 扩展钩子 before_agent_start：可以改系统提示、选模型、注入消息
	const result = await this._extensionRunner.emitBeforeAgentStart(expandedText, currentImages, this._baseSystemPromptOptions);
	// ... 工具清单一致性处理（handler 显式改动优先，否则以当前激活工具为准）

	// ⑪ 图片归一化 + 组装本次要注入的消息数组
	const normalized = await this._normalizePromptImages(currentImages);
	const userText = normalized.hints.length > 0 ? `${expandedText}\n\n${normalized.hints.join("\n")}` : expandedText;
	const messages: AgentMessage[] = [];
	messages.push({ role: "user", content: [{ type: "text", text: userText }, ...normalized.images], timestamp: Date.now() });
	// ... 追加 pendingNextTurn 消息、扩展注入的 custom 消息

	// ⑫ 组装/更新系统提示选项（含工具载入变更的 system 消息），并入队
	const updateMessage = this._preparePromptAndToolLoadout(result.systemPromptOptions);
	this._runSystemPromptOptions = result.systemPromptOptions;
	if (updateMessage) messages.unshift(updateMessage);

	preflightResult?.("started");
	await this._runAgentPrompt(messages);   // 交给下一步：真正驱动 Agent
}
```

对本章的追踪来说，②③⑥⑧⑨ 是"守卫"（不合格就停下或入队），⑤⑩⑪ 是"改写"（把用户输入加工成一批待注入消息），最后 `_runAgentPrompt(messages)` 才是"运行"。

`_runAgentPrompt`（同一文件第 1775 行）是会话层与 Agent 层之间的桥梁：

```typescript
private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
	this._agentRunAbortRequested = false;
	this._failedResponse = undefined;          // 之前的失败响应记录先清除
	this._recordSelection();
	this._pendingToolNames.clear();
	this._isAgentRunActive = true;
	try {
		await this.agent.prompt(messages);     // ← 控制权交给 Agent（下一节）
		// 运行后循环：处理重试、自动压缩、队列里的新消息
		while (!this._agentRunAbortRequested) {
			if (await this._handlePostAgentRun()) {
				if (this._agentRunAbortRequested) break;
				await this.agent.continue();    // 同一会话里继续跑（不新增用户消息）
				continue;
			}
			if (this._agentRunAbortRequested || !(await this._runBeforeSettleBoundary())) break;
			if (this._agentRunAbortRequested) break;
			await this.agent.continue();
		}
	} finally {
		// ... 收尾：清理请求级状态、冲刷待发消息、发出 agent_settled
		await this._emitAgentSettled();
	}
}
```

为什么 `agent.prompt()` 回来之后还要循环？因为在这些情况下"工作还没完"：

- **重试**：可重试的错误（如网络抖动）由 `_handlePostAgentRun` 判断后触发 `agent.continue()`；
- **自动压缩**：发现上下文超限，先压缩再继续；
- **运行期间新排队的消息**：用户在流式输出中按了回车（steering / follow-up），它们会在合适时机被排进来再跑一轮；
- **扩展边界**：`agent_before_settle` 钩子允许扩展在"即将空闲"前再塞一轮。

这些细节属于第 6、8 章；本章只要记住：**`session.prompt()` 返回时，指的是"这一轮会话相关工作全都结束了"（包括上述循环），而不是"第一次模型响应结束了"。**

#### 3.7 Agent 层：`Agent.prompt` 与"一次只跑一个 run"

**先懂**：会话已经准备好一条输入，但同一个 Agent 不能让两次运行同时修改历史。因此先检查是否正在运行，再规范输入的形状，最后开始执行。

```text
教学伪代码：如果已有运行，就拒绝新的 prompt
           → 把字符串/消息统一成消息数组
           → 等待这一批消息的运行结束
```

控制权从会话层进入 `packages/agent/src/agent.ts`。第一站是 `Agent.prompt`（第 371 行）：

```typescript
async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
	if (this.activeRun) {
		throw new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.");
	}
	const messages = this.normalizePromptInput(input, images);
	await this.runPromptMessages(messages);
}
```

三个行为：

1. **同一时刻只允许一个 run**：`activeRun` 非空时直接抛错。想"边跑边插话"必须用 `steer()` / `followUp()` 排队，而不是再调一次 `prompt()`。这是有意的约束——避免同一份消息历史被两个 run 并发改写。
2. **输入归一化**：`normalizePromptInput` 把字符串包装成标准用户消息：

```typescript
private normalizePromptInput(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): AgentMessage[] {
	if (Array.isArray(input)) return input;
	if (typeof input !== "string") return [input];
	const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
	if (images && images.length > 0) content.push(...images);
	return [{ role: "user", content, timestamp: Date.now() }];
}
```

3. **进入生命周期包装**：

```typescript
private async runPromptMessages(messages: AgentMessage[], options: { skipInitialSteeringPoll?: boolean } = {}): Promise<void> {
	await this.runWithLifecycle(async (signal) => {
		await runAgentLoop(
			messages,
			this.createContextSnapshot(),        // 当前消息 + 工具的浅拷贝快照
			this.createLoopConfig(options),      // 把 Agent 的回调整理成循环配置
			(event) => this.processEvents(event),// 循环发出的事件先进入 Agent 的状态归约
			signal,
			this.streamFunction,
		);
	});
}
```

`runWithLifecycle` 是"run 的边界"，也是状态位的唯一管理者：

```typescript
private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
	if (this.activeRun) throw new Error("Agent is already processing.");

	const abortController = new AbortController();
	let resolvePromise = () => {};
	const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
	this.activeRun = { promise, resolve: resolvePromise, abortController };

	this._state.isStreaming = true;
	this._state.streamingMessage = undefined;
	this._state.errorMessage = undefined;

	try {
		await executor(abortController.signal);
	} catch (error) {
		await this.handleRunFailure(error, abortController.signal.aborted);   // 把异常变成"错误消息 + 事件"
	} finally {
		this.finishRun();     // isStreaming=false；唤醒 waitForIdle()；清空 activeRun
	}
}
```

读这段要抓住一个设计：**executor 的运行异常通常会转成失败事件，而不是直接从 `prompt()` 抛出**。异常被 `handleRunFailure` 捕获后，会转成一条骨架 assistant 消息（`stopReason` 为 `"error"` 或 `"aborted"`），再走 `message_start → message_end → turn_end → agent_end` 事件序列；前提是这段失败事件派发顺利完成。若监听器在派发失败事件时再次抛错，`handleRunFailure` 的 Promise 会 reject，异常会继续从 `prompt()` 冒出。`finally` 仍会运行并清理 run 状态。比如 provider 抛错且监听器正常时，调用方可读 `agent.state.errorMessage`；若监听器也抛错，`await session.prompt(...)` 仍应由调用方捕获处理。这样：

- 订阅者（界面）用同一套逻辑处理成功与失败；
- 上层（`session.prompt`）可从 `agent.state.errorMessage` 或消息内容读取通常的运行失败；调用方仍应考虑监听器抛错等失败处理本身出错的路径。

`processEvents` 是"事件 → 状态"的归约器（第 4 章会有完整表格，这里先看主循环需要的部分）：

```typescript
private async processEvents(event: AgentEvent): Promise<void> {
	switch (event.type) {
		case "message_start":
		case "message_update":
			this._state.streamingMessage = event.message;   // 正在流式形成中的消息
			break;
		case "message_end":
			this._state.streamingMessage = undefined;
			this._state.messages.push(event.message);        // 完整消息进入历史
			break;
		case "tool_execution_start": /* pendingToolCalls.add(id) */ break;
		case "tool_execution_end":   /* pendingToolCalls.delete(id) */ break;
		case "turn_end":
			if (event.message.role === "assistant" && event.message.errorMessage) {
				this._state.errorMessage = event.message.errorMessage;
			}
			break;
		case "agent_end": this._state.streamingMessage = undefined; break;
	}

	const signal = this.activeRun?.abortController.signal;
	if (!signal) throw new Error("Agent listener invoked outside active run");
	for (const listener of this.listeners) {
		await listener(event, signal);   // 逐个 await：订阅顺序 = 处理顺序
	}
}
```

两个关键语义（第 1 章预告过，现在证据齐了）：

- **监听器被逐个 `await`**：一个订阅者处理慢，会拖慢后续订阅者和整个 run。所以订阅回调要快；慢活（网络、渲染大计算）要自己异步化并管理错误。
- **`isStreaming` 直到 `agent_end` 的所有监听器结束才变 false**：`await session.prompt(...)` 返回时，界面已收完最后一批事件。

#### 3.8 循环层：`runLoop` 的完整决策过程

**先懂**：循环重复“让模型回答、处理工具、判断是否继续”。每次重复叫一个 turn。先看正常的两轮例子，再阅读钩子、排队和取消如何插入。

```text
教学伪代码：发起本轮模型请求 → 收到回答
           → 如有工具，执行并加入结果
           → 完成本轮 → 有后续工作则再来一轮，否则结束
```

`packages/agent/src/agent-loop.ts` 是全书的"心脏"。先看入口，它很薄：

```typescript
export async function runAgentLoop(
	prompts: AgentMessage[],
	context: AgentContext,
	config: AgentLoopConfig,
	emit: AgentEventSink,
	signal: AbortSignal | undefined,
	streamFn: StreamFn,
): Promise<AgentMessage[]> {
	const initialMessages = declareToolChanges(context, prompts);
	const newMessages: AgentMessage[] = [...initialMessages];
	const currentContext: AgentContext = { ...context, messages: [...context.messages, ...initialMessages] };

	await emit({ type: "agent_start" });
	await emit({ type: "turn_start" });
	for (const message of initialMessages) {
		await emit({ type: "message_start", message });
		await emit({ type: "message_end", message });
	}

	await runLoop(currentContext, newMessages, config, signal, emit, streamFn ?? getDefaultStreamFn());
	return newMessages;
}
```

- `declareToolChanges`：如果这次请求涉及"工具清单变化"（比如扩展在运行中启用了新工具），它会**插入一条 system 消息**声明增删了哪些工具。这样模型看到的消息序列始终自洽，回放（第 9 章）也精确一致。
- `newMessages`：这次 run 新产生的消息（用户消息 + 助手消息 + 工具结果），最后作为 `agent_end.messages` 发出、也用于会话持久化（第 9 章）。
- 开头三条事件：`agent_start` → `turn_start` → 用户消息的 `message_start/message_end`。请对照 `packages/agent/README.md` 的事件序列图，一模一样。

真正的决策在 `runLoop`（同一文件）。它是**双层循环**，这段代码值得逐行读：

```typescript
async function runLoop(initialContext, newMessages, initialConfig, signal, emit, streamFunction): Promise<void> {
	let currentContext = initialContext;
	let config = initialConfig;
	let lastCompletedTurn: PrepareNextTurnContext | undefined;
	let explicitContinuation = false;
	// 用户在等待期间可能已经打了字：进入循环前先取一次 steering 消息
	let pendingMessages: AgentMessage[] = (await config.getSteeringMessages?.()) || [];

	// 外层循环：当"原本要停下来"时，还有 follow-up 消息就再跑一轮
	while (true) {
		let hasMoreToolCalls = true;

		// 内层循环：只要有工具要执行、或有排队的消息，就继续请求模型
		while (hasMoreToolCalls || pendingMessages.length > 0) {
			// ① 如果上一轮结束了，先给"下一轮开始"一个准备机会（prepareNextTurn）
			let preparedMessages: AgentMessage[] = [];
			if (lastCompletedTurn) {
				const nextTurnSnapshot = await config.prepareNextTurn?.(lastCompletedTurn);
				if (nextTurnSnapshot) {
					currentContext = nextTurnSnapshot.context ?? currentContext;
					preparedMessages = nextTurnSnapshot.messages ?? [];
					config = { ...config, model: nextTurnSnapshot.model ?? config.model, /* reasoning 更新 */ };
				}
				// 准备可能耗时（例如压缩）；这期间新排队的 steering 消息要补取
				if (pendingMessages.length === 0) {
					pendingMessages = (await config.getSteeringMessages?.()) || [];
				}
				await emit({ type: "turn_start" });
			}

			// ② 注入准备好的消息与排队消息（附工具变化声明），逐条发消息事件
			for (const message of declareToolChanges(currentContext, [...preparedMessages, ...pendingMessages])) {
				await emit({ type: "message_start", message });
				await emit({ type: "message_end", message });
				currentContext.messages.push(message);
				newMessages.push(message);
			}
			pendingMessages = [];

			// ③ 发请求前最后一次修改请求的机会（prepareRequest 钩子）
			const requestUpdate = await config.prepareRequest?.({ context: currentContext, model: config.model, thinkingLevel: config.reasoning ?? "off" }, signal);
			if (requestUpdate) { /* 更新 currentContext / model / reasoning */ }

			// ④ 请求模型并流式收集一条完整 assistant 消息（见 3.9 节）
			const message = await streamAssistantResponse(currentContext, config, signal, emit, streamFunction);
			newMessages.push(message);

			// ⑤ 失败/取消：收尾本轮并直接结束整个 run
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				lastCompletedTurn = { message, toolResults: [], context: currentContext, newMessages };
				await config.finishTurn?.(lastCompletedTurn, signal);
				await emit({ type: "turn_end", message, toolResults: [] });
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}

			// ⑥ 检查模型是否要求调用工具
			const toolCalls = message.content.filter((c) => c.type === "toolCall");
			const toolResults: ToolResultMessage[] = [];
			hasMoreToolCalls = false;
			if (toolCalls.length > 0) {
				// 输出被 max_tokens 截断时，工具参数可能"能解析但不完整"：全部拒绝执行
				const executedToolBatch = message.stopReason === "length"
					? await failToolCallsFromTruncatedMessage(toolCalls, emit)
					: await executeToolCalls(currentContext, message, config, signal, emit);
				toolResults.push(...executedToolBatch.messages);
				hasMoreToolCalls = !executedToolBatch.terminate;
				for (const result of toolResults) {
					currentContext.messages.push(result);
					newMessages.push(result);
				}
			}

			// ⑦ 本轮完成：交给 finishTurn 决策，然后发 turn_end
			lastCompletedTurn = { message, toolResults, context: currentContext, newMessages };
			const decision = await config.finishTurn?.(lastCompletedTurn, signal);
			await emit({ type: "turn_end", message, toolResults });

			if (decision?.action === "end") {
				await emit({ type: "agent_end", messages: newMessages });
				return;
			}
			explicitContinuation = decision?.action === "continue";
			pendingMessages = (await config.getSteeringMessages?.()) || [];
			if (hasMoreToolCalls || pendingMessages.length > 0) explicitContinuation = false;
		}

		// ⑧ 内层退出：Agent 本来要停了，检查 follow-up 队列
		const followUpMessages = (await config.getFollowUpMessages?.()) || [];
		if (followUpMessages.length > 0) {
			explicitContinuation = false;
			pendingMessages = followUpMessages;
			continue;                        // 回到外层开头，重新进入内层
		}
		if (explicitContinuation) {          // finishTurn 明确要求再来一轮（不新增消息）
			explicitContinuation = false;
			continue;
		}
		break;                               // 真的没活了
	}

	await emit({ type: "agent_end", messages: newMessages });
}
```

把"继续还是结束"整理成决策表（这是本章验收的核心）：

| 运行中的情况                                       | 判定 | 结果                                                                  |
| -------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| 模型响应`stopReason` 为 `error`/`aborted`    | ⑤   | 收尾本轮后**直接结束**整个 run                                  |
| 有工具调用且批次未要求 terminate                   | ⑥   | 执行工具，`hasMoreToolCalls = true`，**再请求模型**           |
| 有工具调用但**全部**结果 `terminate: true` | ⑥   | 不再因工具继续                                                        |
| `finishTurn` 返回 `{ action: "end" }`          | ⑦   | 立即结束（扩展/上层主动叫停）                                         |
| `finishTurn` 返回 `{ action: "continue" }`     | ⑦   | 记下`explicitContinuation`，内层退出后空转一轮（context-only turn） |
| 有 steering 消息                                   | ⑦   | 下一轮注入后继续                                                      |
| 内层退出、有 follow-up 消息                        | ⑧   | 重新进入内层继续                                                      |
| 都没有                                             | ⑧   | `break` → `agent_end`，run 结束                                  |

回到我们的场景：

- 第一次 `streamAssistantResponse` 返回的 assistant 消息里有一个 `toolCall`（read）。⑥执行工具 → `hasMoreToolCalls = true`；
- 第二次请求返回纯文本（无工具调用）、也没有排队消息 → 内层 `while` 条件为 false，退出；
- 没有 follow-up → 外层 `break`；
- 发出 `agent_end`，run 结束。

##### 3.8.1 并行工具的"两个顺序"

第 7 章会用实验证明，这里先把代码事实说清。`executeToolCallsParallel`（同文件）的执行顺序是：

```text
准备阶段：按模型声明顺序，逐个 emit tool_execution_start（A 开始、B 开始）
执行阶段：所有允许的工具并发执行（B 可能先完成）
完成阶段：谁先完成谁先 emit tool_execution_end（B 结束、A 结束）
记录阶段：await Promise.all(有序结果) → 按声明顺序生成 toolResult 消息（A、B）
```

对照代码：完成事件在各自 `finalized` 闭包里发出，而结果消息在 `Promise.all` 之后用 `orderedFinalizedCalls` 循环发出。**"界面反馈按完成顺序、历史记录按声明顺序"**，两个顺序各有用途。

#### 3.9 模型层：一次请求如何变成一条完整消息

**先懂**：发送请求前，内部消息要变成供应商能够理解的消息；返回时，多个增量事件要合成一条最终回答。先抓住这两个转换方向。

```text
教学伪代码：取当前上下文 → 转为模型消息并准备认证
           → 调用流式模型接口 → 每个增量发给订阅者
           → 在流结束时得到完整回答
```

`streamAssistantResponse`（`agent-loop.ts`）是"循环层"与"模型层"的接缝。它做四件事：变换上下文 → 转换消息类型 → 发请求 → 把事件流折叠成一条完整消息。

```typescript
async function streamAssistantResponse(context, config, signal, emit, streamFunction): Promise<AssistantMessage> {
	// ① 扩展可先变换 Agent 消息（AgentMessage[] → AgentMessage[]）
	let messages = context.messages;
	if (config.transformContext) messages = await config.transformContext(messages, signal);

	// ② 翻译成模型消息（AgentMessage[] → Message[]）：过滤 + 转格式
	const llmMessages = await config.convertToLlm(messages);
	const llmContext = normalizeContext({ messages: llmMessages });

	// ③ 解析 API Key（每次请求都解析：OAuth 令牌可能过期刷新）
	const resolvedApiKey =
		(config.getApiKey ? await config.getApiKey(config.model.provider) : undefined) || config.apiKey;

	// ④ 交给 streamFn（这里指向 sdk.ts 的包装函数 → modelRuntime.streamSimple）
	const response = await streamFunction(config.model, llmContext, { ...config, apiKey: resolvedApiKey, signal });

	// ⑤ result() 只可调用一次：拿到最终消息，并记录本次请求的思考级别
	const result = async () => Object.assign(await response.result(), { thinkingLevel: config.reasoning ?? "off" });

	let partialMessage: AssistantMessage | null = null;
	let addedPartial = false;

	for await (const event of response) {
		switch (event.type) {
			case "start":
				// 流开始：把"部分消息"放进上下文并通知订阅者
				partialMessage = event.partial;
				context.messages.push(partialMessage);
				addedPartial = true;
				await emit({ type: "message_start", message: { ...partialMessage } });
				break;

			case "text_start": case "text_delta": case "text_end":
			case "thinking_start": case "thinking_delta": case "thinking_end":
			case "toolcall_start": case "toolcall_delta": case "toolcall_end":
				// 任何增量：更新上下文里那条部分消息，并广播 message_update
				if (partialMessage) {
					partialMessage = event.partial;
					context.messages[context.messages.length - 1] = partialMessage;
					await emit({ type: "message_update", assistantMessageEvent: event, message: { ...partialMessage } });
				}
				break;

			case "done": case "error": {
				// 流结束：以最终消息替换部分消息（或补齐缺失的 start）
				const finalMessage = await result();
				if (addedPartial) context.messages[context.messages.length - 1] = finalMessage;
				else { context.messages.push(finalMessage); await emit({ type: "message_start", message: { ...finalMessage } }); }
				await emit({ type: "message_end", message: finalMessage });
				return finalMessage;
			}
		}
	}
	// 流意外关闭（没有 done/error 事件）的兜底：同样产出最终消息
	// ...
}
```

逐点解释：

- **`message_update` 里携带两个东西**：`assistantMessageEvent`（刚发生的增量，如 `text_delta` 的 `delta` 文本）和 `message`（截至此刻累积出的部分消息快照）。界面两者都能用：前者决定"再写几个字"，后者用于"整段重绘"。
- **部分消息会临时进入 `context.messages`**：所以订阅者在运行中读 `agent.state.messages` 时，最后一条可能是"还没完成的助手消息"。`message_end` 之后它被**最终消息替换**（同一位置）。这解释了为什么消息数量在运行中会"保持不变"而内容在变。
- **`stopReason` 是外层循环的判据**：`done` 事件带 `reason`（`stop` / `length` / `toolUse` / `deferred`），最终消息里的 `stopReason` 决定 3.8 的 ⑤⑥ 分支。

接下来是模型层内部：`streamFunction` 指向 `sdk.ts` 里的包装（先缓存预热、再调 `modelRuntime.streamSimple`）。`ModelRuntime` → `pi-ai` 的 `streamSimple` → 找到对应 `Api` 的适配器（如 `providers/anthropic.ts`）→ 供应商 SDK → 返回统一事件流。**这一段的细节全部留到第 5 章**，本章你只需要记住接缝位置：

```text
agent-loop.ts streamAssistantResponse
  → streamFn（sdk.ts 包装：缓存预热 + 请求选项）
    → modelRuntime.streamSimple（coding-agent）
      → pi-ai compat.streamSimple（统一入口，处理重试/兼容）
        → providers/<供应商>.ts（请求转换、SSE 解析）
          → 供应商原生事件
        ← 统一为 AssistantMessageEvent（start/text_*/thinking_*/toolcall_*/done/error）
      ← AssistantMessageEventStream
  ← for await 折叠为一条 AssistantMessage
```

#### 3.10 工具层：从 toolCall 到 toolResult 消息

**先懂**：模型一次可以提出多个工具调用。执行前先决定这一批能否并行；每个调用再经过准备、执行、后置处理和生成结果消息。

```text
教学伪代码：查看全局模式与每个工具的顺序要求
           → 选择整批顺序或允许并行的调度
           → 分别取得最终结果 → 回填到对话
```

并行时完成事件可先后到达，但回填顺序按模型提出调用的顺序处理；第 7 章会展开准备和取消边界。

回到 `agent-loop.ts` 的 ⑥：一旦模型消息里含 `toolCall`，就调用 `executeToolCalls`。调度规则很简单：

```typescript
const hasSequentialToolCall = toolCalls.some(
	(tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
);
if (config.toolExecution === "sequential" || hasSequentialToolCall) {
	return executeToolCallsSequential(...);   // 顺序执行：准备、执行、收尾一个接一个
}
return executeToolCallsParallel(...);         // 并行执行：准备顺序进行，执行允许并发
```

一个批次里只要**有任何一个**工具被声明为 `executionMode: "sequential"`（或全局配置为顺序），整个批次就顺序执行。这是保证"有副作用的工具不乱序"的保守策略。

每个工具调用都经历**四步流水线**（`prepareToolCall` → `executePreparedToolCall` → `finalizeExecutedToolCall` → 记录），单独看 `prepareToolCall`：

```typescript
async function prepareToolCall(currentContext, assistantMessage, toolCall, config, signal, tools = ...) {
	const tool = tools.find((t) => t.name === toolCall.name);
	if (!tool) {
		return { kind: "immediate", result: createErrorToolResult(`Tool ${toolCall.name} not found`), isError: true };
	}
	try {
		const preparedToolCall = prepareToolCallArguments(tool, toolCall); // 可选兼容层：修正原始参数
		const validatedArgs = validateToolArguments(tool, preparedToolCall); // 运行时 schema 校验（typebox）
		if (config.beforeToolCall) {
			const beforeResult = await config.beforeToolCall({ assistantMessage, toolCall, args: validatedArgs, context: currentContext }, signal);
			if (signal?.aborted) return { kind: "immediate", result: createErrorToolResult("Operation aborted"), isError: true };
			if (beforeResult?.block) {
				const result = createErrorToolResult(beforeResult.reason || "Tool execution was blocked");
				if (beforeResult.terminate === true) result.terminate = true;
				return { kind: "immediate", result, isError: true };  // 被拦截：不执行，回一条错误结果
			}
		}
		if (signal?.aborted) return { kind: "immediate", result: createErrorToolResult("Operation aborted"), isError: true };
		return { kind: "prepared", toolCall, tool, args: validatedArgs };
	} catch (error) {
		return { kind: "immediate", result: createErrorToolResult(error instanceof Error ? error.message : String(error)), isError: true };
	}
}
```

四个"提前结束"分支——**工具不存在、参数非法、被钩子拦截、已取消**——全部返回 `isError: true` 的结果对象，而不是抛异常。这是本仓库贯穿性的错误哲学：

> **错误是一种结果，不是一种崩溃。** 出错信息要能返回给模型，让它自己决定下一步。

执行与收尾（简化注释）：

```typescript
async function executePreparedToolCall(prepared, signal, onUpdate) {
	try {
		// 工具自己的实现：read 工具在这里读文件（packages/coding-agent/src/core/tools/read.ts）
		const result = await prepared.tool.execute(prepared.toolCall.id, prepared.args, signal, (partialResult) => {
			// 工具的进度回调 → tool_execution_update 事件（界面即时反馈）
			updateEvents.push(Promise.resolve(onUpdate(partialResult)));
		});
		return { result, isError: result.isError === true };
	} catch (error) {
		// 抛出的异常被折叠成错误结果，run 继续
		return { result: createErrorToolResult(error instanceof Error ? error.message : String(error)), isError: true };
	}
}

async function finalizeExecutedToolCall(...) {
	// afterToolCall 钩子可以改写结果（字段级替换，见 types.ts 的 AfterToolCallResult 注释）
	// 注意：content 被替换而 structuredContent 未同时提供时，structuredContent 会被丢弃（可能不再匹配）
}
```

最后两步：`emitToolExecutionEnd` 发 `tool_execution_end` 事件；`createToolResultMessage` 生成**工具结果消息**（这条会进入历史、发给模型）：

```typescript
function createToolResultMessage(finalized) {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,   // 与请求它的 toolCall 一一对应
		toolName: finalized.toolCall.name,
		content: finalized.result.content ?? [],
		details: finalized.result.details,
		usage: finalized.result.usage,
		isError: finalized.isError,
		timestamp: Date.now(),
	};
}
```

然后 `message_start` / `message_end` 两个事件把这条消息广播出去。**到这里，"read 工具的结果"正式成为对话历史的一部分**，下一轮模型请求就能看到它。

#### 3.11 第二轮请求：循环如何自然结束

**先懂**：工具结果已经加入历史，模型这次终于能看到文件内容。如果它直接给出总结，而且没有排队输入或续跑决定，运行就会结束。

```text
教学伪代码：把 read 的结果放入上下文 → 再请求模型
           → 得到无工具调用的总结 → 检查续跑与队列
           → 发结束事件并等待会话收束
```

工具结果入队后，`hasMoreToolCalls = true`，内层循环再次执行。第二次迭代与第一次结构相同，四处不同：

1. `lastCompletedTurn` 已有值 → 先调 `prepareNextTurn`（在基础用法里是 `undefined`；`AgentSession` 会在这里挂接压缩等准备逻辑，第 10 章）。
2. 没有新的用户消息要注入（除非排队）。
3. 模型看到的上下文变成：`[system, user, assistant(read 工具调用), toolResult(文件内容)]`——这是它第一次能"看到"文件。
4. 这次响应通常没有 `toolCall`，`stopReason` 为 `"stop"`。

随后：`finishTurn` 返回空 → `turn_end` → 内层条件（无工具、无排队）为假 → 退出内层 → 无 follow-up → `break` → 发出 `agent_end`。

与此同时，会话层在背后做了两件事（都发生在事件流上）：

- **持久化**：`AgentSession` 订阅了 Agent 事件，在 `message_end` 时把消息写入会话文件。真实代码（`agent-session.ts` 约第 1113 行）：

```typescript
if (event.type === "message_end") {
	let entryId: string | undefined;
	if (event.message.role === "custom") {
		entryId = this.sessionManager.appendCustomMessageEntry(/* ... */);
	} else if (event.message.role === "system" || event.message.role === "user"
		|| event.message.role === "assistant" || event.message.role === "toolResult") {
		entryId = this.sessionManager.appendMessage(event.message);
	}
	if (entryId) this._entryIdsByMessage.set(event.message, entryId);
	// ...
}
```

  也就是说：**"发给模型的消息"和"写进会话文件的消息"来自同一个 `message_end` 事件**——但存储格式与发送格式可能不同（第 9 章）。

- **收尾循环**：`_runAgentPrompt` 里 `agent.prompt()` 返回后，还要检查重试/压缩/队列（3.6 节）。本例都没有，于是 `session.prompt()` 返回。

#### 3.12 完整时序图

把本章所有结论合成一张图（参与者就是五个层）：

```mermaid
sequenceDiagram
    participant U as 用户 / Print 模式
    participant S as AgentSession
    participant A as Agent
    participant L as runLoop
    participant F as streamFn / ModelRuntime
    participant P as 供应商 API
    participant T as 工具 (read)

    U->>S: session.prompt("读取 demo.txt，并总结三点")
    S->>S: 扩展命令检查 / 输入钩子 / 模板展开 / 模型与认证校验 / 压缩检查
    S->>A: agent.prompt(用户消息)
    A->>L: runAgentLoop(...)
    L-->>U: agent_start / turn_start / user message 事件
    L->>F: streamAssistantResponse(第 1 次)
    F->>P: HTTP/流式请求（含工具定义）
    P-->>F: 增量事件
    F-->>L: AssistantMessageEvent 流
    L-->>U: message_update(text_delta...) 事件
    L->>L: 得到 assistant 消息：toolCall(read demo.txt)
    L->>T: tool_execution_start → execute(id,{path},signal)
    T-->>L: 文件内容
    L-->>U: tool_execution_end + toolResult 消息事件
    L->>F: streamAssistantResponse(第 2 次)
    F->>P: 请求（历史含 toolResult）
    P-->>F: 增量事件
    L-->>U: message_update(text_delta：三点总结)
    L->>L: assistant 消息 stopReason=stop，无工具
    L-->>U: turn_end / agent_end
    S->>S: 每次 message_end → sessionManager.appendMessage 持久化
    S->>U: session.prompt() 返回（界面可显示最终总结）
```

##### 3.12.1 放大一段 `text_delta`：同一内容经过四层

时序图把整条路压在一页上，第一次阅读时容易把几个同名近似的对象混成一个。先只追一小段文本，例如供应商陆续返回 `"读取"`、`"完成"` 两个片段。它们会被拼进一条 assistant 消息，但事件流中仍是两个增量。

```mermaid
sequenceDiagram
    participant P as 供应商协议适配器
    participant L as streamAssistantResponse
    participant A as Agent.processEvents
    participant S as AgentSession listener
    participant UI as session.subscribe 观察者

    P-->>L: AssistantMessageEvent(text_delta, partial)
    L->>L: partialMessage = event.partial
    L->>A: message_update(assistantMessageEvent, message 副本)
    A->>A: state.streamingMessage = event.message
    A->>S: await listener(event, signal)
    S->>UI: _emit(message_update)
    UI-->>UI: 渲染本次 delta
    Note over L,UI: 本次只有过程更新，尚未追加最终会话记录
    P-->>L: done event
    L->>P: await response.result()
    P-->>L: finalMessage
    L->>A: message_end(finalMessage)
    A->>A: streamingMessage 清空，finalMessage 追加到 state.messages
    A->>S: await listener(event, signal)
    S->>S: 扩展 message_end hook
    S->>UI: _emit(message_end)
    S->>S: sessionManager.appendMessage(finalMessage)
```

###### 第一层：协议适配器产出统一事件

供应商原始 SSE/HTTP chunk 不是 Agent 事件。Anthropic、OpenAI 等 adapter 先把供应商协议转换成 `AssistantMessageEvent`；例如 `{ type: "text_delta", delta, partial }`。这里的 `partial` 是 adapter 当前累积到的部分 assistant message。不同供应商的事件格式在 D17–D20 分别精读。

###### 第二层：`streamAssistantResponse` 折叠成 Agent 事件

阅读 `packages/agent/src/agent-loop.ts` → `streamAssistantResponse`。该函数用 `for await...of` 逐个取模型流事件：

```typescript
for await (const event of response) {
  switch (event.type) {
    case "start":
      partialMessage = event.partial;
      context.messages.push(partialMessage);
      await emit({ type: "message_start", message: { ...partialMessage } });
      break;
    case "text_delta":
      if (partialMessage) {
        partialMessage = event.partial;
        context.messages[context.messages.length - 1] = partialMessage;
        await emit({
          type: "message_update",
          assistantMessageEvent: event,
          message: { ...partialMessage },
        });
      }
      break;
    // 其他 thinking/tool-call 事件也更新同一条 partial message
  }
}
```

节选只展开了 `start` 和 `text_delta` 两种分支；真实 switch 还处理 thinking 与 tool-call 事件。注意两个对象：

- `assistantMessageEvent` 是本次细粒度增量，如 text delta；
- `message` 是到目前为止累积出的 assistant 消息快照。

如果模型发送两次 `text_delta`，`streamAssistantResponse` 就会发两次 `message_update`。不要把每次快照都当成独立 assistant 消息；它们服务于流式展示和状态观察。

###### 第三层：`Agent.processEvents` 先更新状态，再等待订阅者

阅读 `packages/agent/src/agent.ts` → `processEvents`。对于 `message_update`，它执行 `this._state.streamingMessage = event.message`，随后依次 `await listener(event, signal)`。

这里的状态分工是：

| 字段                       | `message_update` 时      | `message_end` 时           |
| -------------------------- | -------------------------- | ---------------------------- |
| `state.streamingMessage` | 指向最新累积消息快照       | 清空为`undefined`          |
| `state.messages`         | 尚不追加这条最终消息       | 追加最终 assistant message   |
| listeners                  | 等待本事件的 listener 完成 | 等待结束事件的 listener 完成 |

由于先归约再派发，监听器处理 `message_update` 时读取 `agent.state.streamingMessage` 已能看到这次快照。`await listener` 又意味着慢 listener 会拖住事件源推进；这不是 UI 渲染“自动在旁边跑”。

###### 第四层：`AgentSession` 转发可观察事件，再持久化

`AgentSession` 作为 Agent listener 收到事件后，先执行会话层预处理，再 `await _emitExtensionEvent(event)`，接着通知公开 `session.subscribe(...)` 观察者。对 `message_end`，之后才调用 `sessionManager.appendMessage(event.message)` 或 `appendCustomMessageEntry(...)`。扩展的 message-end hook 可以返回替代消息；session 会先把替代内容写回当前消息对象，再公开派发和持久化，使 Agent 状态、后续事件与 transcript 看到同一对象内容。

所以同一个运行时的先后关系是：

```text
Agent state 归约
  → Agent listeners 按注册顺序 await
    → AgentSession listener:
        → 扩展事件/hook
        → 公开 session listeners（UI 通常订阅这里）
        → message_end 时写入 SessionManager
```

这不表示界面收到 `message_end` 就能单独证明磁盘已经落盘；公开事件在当前 handler 的持久化分支之前派发。若代码在 `session.subscribe` 回调里立刻查询会话记录，必须先检查具体的同步/异步边界，不能凭“事件名字叫 end”推断落盘顺序。

`message_end` 也不是“供应商给出 done 字段”的直接同义词。模型流的 `done` / `error` 事件后，`streamAssistantResponse` 还会调用 `response.result()` 取得最终消息，再发出 Agent 的 `message_end`；之后 `Agent` 更新最终状态，`AgentSession` 再做应用层扩展、公开通知和 transcript 写入。

###### 用四个观察点定位 bug

| 症状                                  | 先观察                                           | 可能所在层                           |
| ------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| 增量文字缺字/重复                     | adapter 输出的`delta` 与 `partial`           | provider adapter 或协议解码          |
| UI 没更新但最终回答正确               | `message_update` 是否到达 Agent listener       | Agent event sink / subscriber        |
| `streamingMessage` 与最终消息对不上 | `processEvents` 中的状态归约和 message_end     | Agent 状态管理或扩展替换             |
| UI 有最终回答但 transcript 不含它     | `AgentSession` 的 message_end handler 是否完成 | session persistence / SessionManager |

排查时按层确认“输入对象是什么、输出对象是什么”，不要先在 UI 末端加字符串拼接补丁。否则可能只修了显示，却让 Agent state 或恢复后的历史继续错误。

#### 3.13 对比：简单请求 vs 有工具的请求

| 维度           | "1+1 等于几？"                        | "读取 demo.txt 并总结三点" |
| -------------- | ------------------------------------- | -------------------------- |
| 用户请求       | 1                                     | 1                          |
| run            | 1                                     | 1                          |
| turn           | 1                                     | 2                          |
| 模型请求       | 1                                     | 2                          |
| 工具执行       | 0                                     | 1                          |
| assistant 消息 | 1                                     | 2                          |
| 循环继续的原因 | 无（一次响应即结束）                  | 第一次响应有 toolCall      |
| 结束原因       | `stopReason: "stop"` 且无工具无队列 | 同上（第二轮）             |

对照这个表自查：如果你把某次真实运行理解成了"1 个请求 1 个回合"，而模型用过工具，那说明你把 turn 和用户请求混了——这正是本章要防止的错误。

#### 3.14 错误与取消的轨迹（先立直觉，细节见第 6、7 章）

**轨迹 A：工具失败（demo.txt 不存在）**。模型照样提出 `read` 调用；执行阶段读文件失败；异常被折叠为 `isError: true` 的工具结果消息（错误文本会发给模型）。模型看到错误后可能改用 `ls` 确认目录，或直接告诉你"找不到文件"。**关键结论：单个工具失败不等于 run 结束。** run 何时结束取决于循环的决策表（3.8），而不是某一次工具的结果。

**轨迹 B：用户取消（Esc / Ctrl+C）**。`abort()` → `activeRun.abortController.abort()` → 信号经过 `streamFn` 传给正在进行的供应商请求、传给正在执行的工具。供应商请求中止后在流中产生 `error` 事件（`reason: "aborted"`），最终消息的 `stopReason` 是 `"aborted"`；循环在 ⑤ 收尾并结束 run。`how-pi-works.md` 补充了一个交互行为：**取消会把排队中的消息还给编辑器**，避免用户的输入被静默吞掉。

**轨迹 C：模型请求失败（网络断开、认证失效）**。流以 `error` 事件结束，最终消息带 `errorMessage`；循环同样在 ⑤ 结束。此后 `_handlePostAgentRun` 可能触发**自动重试**（受设置与错误类型控制）——这就是"malformed 响应后 pi 又自己跑了一次"的现象来源（第 6 章）。

**轨迹 D：输出被 max_tokens 截断**。`stopReason` 为 `"length"`，此时消息里可能仍有"看似完整"的工具调用，但参数可能被截断。代码选择**全部拒绝执行**，并让模型重新发起：

```text
Tool call "X" was not executed: the response hit the output token limit, so its arguments may be truncated.
Re-issue the tool call with complete arguments.
```

#### 3.15 练习：手绘三张图

1. **五层调用链**：从 `src/cli.ts` 到 `providers/faux.ts`，写出每一层的文件与入口函数名（不查手册，从记忆写；写完再对照 3.2 节的表）。
2. **事件序列图**：把 3.12 改成"事件名序列"（只写 `agent_start`、`turn_start`、`message_start(user)`、……），并与 `packages/agent/README.md` 的两张序列图对照。多出来的事件（比如两次 `turn_start`）想清楚为什么。
3. **消息时间线**：画出 `agent.state.messages` 数组从"空"到"最终"的每一步变化（哪些元素被临时插入、何时被替换、何时被追加）。

**自我判定标准**：三张图都能不看资料画出，且能解释每个箭头"为什么存在"，本章即过关。

#### 本章源码精读

> **源码精读**：先定位导出与函数签名，再沿调用点核对输入、状态、输出和错误；最后用本篇指定的离线实验验证。

先把第 3 章的五层调用链记牢，再精读启动装配。D6 负责解释 `main.ts` 如何把命令行选择变成可运行会话；遇到 Agent 与工具细节时，继续读第 6、7 章。

##### D6：`main.ts` 启动与装配选段精读

**先懂**：`main()` 像一次开工前的准备：认出命令、确定工作目录、读取允许的配置、建立会话，最后把控制交给交互、print 或 RPC。快速命令可能在创建会话前直接结束。

```text
教学伪代码：识别快速命令 → 读取启动配置 → 解析模式与会话
           → 创建可重建的运行时 → 交给相应模式处理输入
```

后文每段源码都对应一个阶段；先问“这段是在准备资源，还是在执行一次输入”，再读具体参数。

> 精读对象：`packages/coding-agent/src/main.ts`（约 1000 行）的 `main()` 主函数——从进程参数到"三种模式分发"的完整启动装配。
> 对应主线：第 3 章（入口与装配）。
> 读法：顺着 `main()` 的执行顺序读；先用本篇导读和伪代码认清阶段，再读每段源码及注解。

---

###### 0. 为什么 `main.ts` 值得读

`main.ts` 是"**产品决策的沉积层**"：哪些命令要在装配前短路、什么顺序建对象、出错时退出码是什么、哪些东西要动态重算——全在这里。对照 D5（`sdk.ts` 是"给嵌入方的最干净装配"），`main.ts` 是"给 CLI 的完整装配 + 模式分发"。

【陷阱】`main.ts` 里同一件事常出现**两次**（比如 SettingsManager），因为"信息不足时先粗略建、信息足够后精确重建"。读时给每个对象标注"第几次创建、为什么"。

---

###### 1. 段落零：打点、离线与扩展工厂

【源码】

```typescript
export async function main(args: string[], options?: MainOptions) {
	// resetTimings()：把启动打点表归零（第 19.2.2 节的 time()/printTimings() 同一体系）
	resetTimings();
	// 内置扩展（builtInExtensions，来自 src/core/experimental.ts 或类似模块）+ 宿主注入的扩展 → 统一进 extensionFactories，之后随 ResourceLoader 一起向会话传递
	// options?.extensionFactories ?? []：MainOptions 是给测试/嵌入的注入点（main(args, options)）——CLI 从 cli.ts 调用时不传第二参
	const extensionFactories = [...builtInExtensions, ...(options?.extensionFactories ?? [])];
	// 离线模式的两个来源：命令行参数或环境变量（isTruthyEnvFlag——"truthy 解析"：1/true/yes 之类；第 11.7 节的变量表）
	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.PI_OFFLINE);
	if (offlineMode) {
		// 进程级开关会被后续的模型目录刷新和版本检查读取。
		process.env.PI_OFFLINE = "1";
		process.env.PI_SKIP_VERSION_CHECK = "1";
	}
```

【注解】

- `resetTimings()`：把启动打点表归零（第 19.2.2 节的 `time()`/`printTimings()` 同一体系）。
- **内置扩展**（`builtInExtensions`，来自 `src/core/experimental.ts` 或类似模块）+ 宿主注入的扩展 → 统一进 `extensionFactories`，之后随 ResourceLoader 一起向会话传递。
- 离线模式的两个来源：**命令行参数**或**环境变量**（`isTruthyEnvFlag`——"truthy 解析"：`1`/`true`/`yes` 之类；第 11.7 节的变量表）。
- 离线模式的副作用：写两个环境变量——**`PI_OFFLINE` 与 `PI_SKIP_VERSION_CHECK`**。【陷阱】为什么要"写入环境变量"而不是就地用布尔？因为后面更深层的代码（模型目录刷新、版本检查）**也读环境变量**——用"环境变量作为进程级广播"能让分散的模块共享这个决定，而不用把布尔一层层传下去。这是"进程级开关"与"参数级开关"的分工示例。
- 【陷阱】`options?.extensionFactories ?? []`：`MainOptions` 是给测试/嵌入的注入点（`main(args, options)`）——CLI 从 `cli.ts` 调用时不传第二参。

###### 2. 短路命令：`auth`、Windows 清理、包/配置/mcp

【源码（节选）】

```typescript
	if (await runAuthCommand(args)) {
		return;
	}

	if (process.platform === "win32") {
		cleanupWindowsSelfUpdateQuarantine(getPackageDir());
	}
	cleanupManagedInstall();

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	// 信任判定前只允许读取全局配置，项目配置尚不能生效。
	const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher();

	// 包管理依赖扩展工厂（{ extensionFactories }）——因为安装/更新会触发扩展 reconcile
	if (await handlePackageCommand(args, { extensionFactories })) {
		// Windows + pi update + 成功退出码的特例注释：正常情况下"包命令跑完就 process.exit"（防止坏扩展挂住进程），但 Windows 上 Node 在 fetch() 之后 teardown 里退出会触发断言（引用了 nodejs/node#56645），所以成功时改为自然返回（让事件循环自己 drain）
		const exitCode = process.exitCode ?? 0;
		if (process.platform === "win32" && exitCode === 0 && args[0] === "update") {
			// We normally prefer process.exit(0) for package commands so bad extensions cannot keep
			// one-shot commands alive. On Windows, Node can assert after fetch() if process.exit(0)
			// runs during teardown; let successful `pi update` drain naturally instead.
			// https://github.com/nodejs/node/issues/56645
			return;
		}
		process.exit(exitCode);
		return;
	}

	if (await handleConfigCommand(args, { extensionFactories })) {
		return;
	}

	if (args[0] === "mcp") {
		// mcp 用动态导入（await loadMcpCommand()）——一个真实的"按需加载"
		const { runMcpCommand } = await loadMcpCommand();
		process.exitCode = await runMcpCommand(args.slice(1), { cwd, agentDir });
		return;
	}
```

【注解（顺序即优先级）】

- **`auth` 最先**：`pi auth ...` 连 cwd/agentDir 都不需要（它自己解析凭据路径）。短路 return。
- Windows 自更新隔离清理 + 托管安装清理：**平台杂务**（被杀毒/更新流程打扰后的残骸处理）；只在 win32 跑（另一个平台也不会有那些文件）。
- `cwd`/`agentDir` **只取一次**（第 3.4.2 节的"显式落盘"）；bootstrap 设置管理器用 **`projectTrusted: false`**——此刻还没做信任判定，**先不允许任何项目设置生效**；只读它的**全局**设置（`getGlobalSettings().httpProxy`）来配置代理与 HTTP 调度器。【陷阱】注意读的是 `getGlobalSettings()` 而不是合并后的 `getSettings()`——**在信任前只信全局**，这是第 11.5 节"信任边界"在启动期的体现。
- 四个子命令按序短路：包管理（`install/remove/list/update`）→ 配置（`pi config`）→ MCP（`pi mcp`）。要点：
  - 包管理**依赖扩展工厂**（`{ extensionFactories }`）——因为安装/更新会触发扩展 reconcile；
  - Windows + `pi update` + 成功退出码的**特例注释**：正常情况下"包命令跑完就 `process.exit`"（防止坏扩展挂住进程），但 Windows 上 Node 在 `fetch()` 之后 teardown 里退出会触发断言（引用了 nodejs/node#56645），所以**成功时改为自然返回**（让事件循环自己 drain）。
  - 【陷阱】这段是"**平台特定 workaround + 引用上游 issue**"的范例：注释写清"Why + 链接"，而不是"magic return"。读到时能理解，而不是当成可疑代码删掉。
  - `mcp` 用**动态导入**（`await loadMcpCommand()`）——一个真实的"按需加载"（MCP 支持不在所有启动路径都需要；这也是入口成本预算（第 20.2.4 节）允许的少数动态导入之一。【陷阱】为什么这里可以而其它地方不许？因为它是**命令分发层的懒加载**，不改变模块依赖图（`main.ts` 仍静态可知它可能加载 mcp 包的哪个入口——通过 helper）。

###### 3. 参数解析与"早退"命令

【源码（节选）】

```typescript
	const parsed = parseArgs(args);
	if (parsed.diagnostics.length > 0) {
		for (const d of parsed.diagnostics) {
			const color = d.type === "error" ? chalk.red : chalk.yellow;
			console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
		}
		if (parsed.diagnostics.some((d) => d.type === "error")) {
			// 诊断三态（info/warning/error）：warning 写入 stderr 但继续；任何 error → process.exit(1)
			process.exit(1);
		}
	}
	time("parseArgs");

	if (parsed.version) {
		// --version 极速路径：只打印 VERSION（来自 config.ts，第 0.7 节的实验就是它）——不建任何服务、不加载扩展（注意此刻 extensionFactories 只存在于数组里，还没有实例化）
		console.log(VERSION);
		process.exit(0);
	}

	if (parsed.export) {
		let result: string;
		try {
			// --export 路径：导出会话为 HTML 后退出；parsed.messages[0] 当输出路径（位置参数复用——第 16 章的 CLI 文档里 --export <input> [output] 的 "output" 走的其实是非选项参数）；错误统一格式化 + 退出码 1
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			result = await exportFromFile(parsed.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		console.log(`Exported to: ${result}`);
		process.exit(0);
	}
```

【注解】

- 诊断三态（info/warning/error）：**warning 写入 stderr 但继续**；任何 error → `process.exit(1)`。这就是"参数解析器把校验问题收集起来、调用方统一裁决"的模式（第 8.3.2 节的 diagnostics 同族）。
- **`--version` 极速路径**：只打印 `VERSION`（来自 `config.ts`，第 0.7 节的实验就是它）——**不建任何服务、不加载扩展**（注意此刻 `extensionFactories` 只存在于数组里，还没有实例化）。
- **`--export` 路径**：导出会话为 HTML 后退出；`parsed.messages[0]` 当输出路径（位置参数复用——第 16 章的 CLI 文档里 `--export <input> [output]` 的 "output" 走的其实是非选项参数）；错误统一格式化 + 退出码 1。
- 【陷阱】这两条路径都在**任何会话装配之前**——"快速命令不建会话"的实例（第 3.4.2 节的设计点之一）。也解释了为什么"改扩展 bug 后 `pi --version` 还慢"会令人困惑——扩展工厂此刻确实没跑，但如果慢就说明慢在别处（模块加载等）。

###### 4. 模式解析与 stdout 接管

【源码】

```typescript
	let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
	// isPlainRuntimeMetadataCommand(parsed) 的例外：某些命令（如纯元数据输出，比如 list-models？）需要真正的 stdout——它们不做接管
	const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
	if (shouldTakeOverStdout) {
		// takeOverStdout()：非交互模式下把"直接写 stdout"重定向到 stderr，保护协议通道（JSON/RPC 的 stdout 只许放协议记录；第 16.3.1 节的"stdout 专用于 JSONL"）
		takeOverStdout();
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		// RPC 的 @file 拒绝：在任何装配之前报错退出（比"装配完再发现"省时间，也避免产生副作用）
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	// validateForkFlags：组合校验（--fork 与 --session/--continue/--resume/--no-session 互斥；第 16 章的 CLI 文档列了约束）
	validateForkFlags(parsed);
```

【注解】

- `resolveAppMode(parsed, stdin.isTTY, stdout.isTTY)`：三态输入——显式模式（`--print`/`--mode json|rpc`）优先；否则"两个流都是 TTY → interactive，否则 print"（第 3.4.4 节）。
- **`takeOverStdout()`**：非交互模式下把"直接写 stdout"重定向到 stderr，**保护协议通道**（JSON/RPC 的 stdout 只许放协议记录；第 16.3.1 节的"stdout 专用于 JSONL"）。
  - `isPlainRuntimeMetadataCommand(parsed)` 的例外：某些命令（如纯元数据输出，比如 list-models？）**需要**真正的 stdout——它们不做接管。【陷阱】这个例外函数的名字与语义要合起来读："平凡的运行时元数据命令"输出的是人/机共读的短信息，不算协议流。
- RPC 的 `@file` 拒绝：在**任何装配之前**报错退出（比"装配完再发现"省时间，也避免产生副作用）。
- `validateForkFlags`：组合校验（`--fork` 与 `--session/--continue/--resume/--no-session` 互斥；第 16 章的 CLI 文档列了约束）。

###### 5. 迁移、启动设置与首次引导

【源码（节选）】

```typescript
	// Run migrations (pass cwd for project-local migrations)
	// 迁移（runMigrations(cwd)）：配置文件/凭据的版本迁移（第 11.3.2 节的 settings 迁移是另一处）
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(cwd);
	time("runMigrations");

	// 第二个 SettingsManager（startupSettingsManager）：注意这次没有 projectTrusted: false → 按默认信任加载项目设置
	const startupSettingsManager = SettingsManager.create(cwd, agentDir);
	const startupSettingsDiagnostics = collectSettingsDiagnostics(startupSettingsManager);

	// Experimental first-time setup: theme choice and analytics opt-in.
	// Runs before any runtime services are created so the chosen settings apply everywhere.
	// 首次引导（主题选择 + 遥测同意）：shouldRunFirstTimeSetup() 守卫（只在交互、非 help、非 list-models 时跑）；注释说明为什么必须最早跑——"让选定的设置在所有地方生效"（晚了的话，runtime 服务已按旧设置创建）
	if (appMode === "interactive" && !parsed.help && parsed.listModels === undefined && shouldRunFirstTimeSetup()) {
		await showFirstTimeSetup(startupSettingsManager);
		time("firstTimeSetup");
	}

	if (appMode === "interactive" && parsed.useTheme !== undefined) {
		startupSettingsManager.applyOverrides({ theme: parsed.useTheme });
	}
```

【注解】

- **迁移**（`runMigrations(cwd)`）：配置文件/凭据的版本迁移（第 11.3.2 节的 settings 迁移是另一处）。返回"迁移过的认证供应商"（给交互层提示）与**弃用警告**（后面在交互模式展示）。
- **第二个 SettingsManager**（`startupSettingsManager`）：注意这次**没有** `projectTrusted: false` → **按默认信任加载项目设置**。为什么？因为下一步的"会话目录解析"需要读 `sessionDir` 设置——而 `sessionDir` 是文档明确允许"信任前读取"的**引导期例外**（第 11.5 节）。
  - 【陷阱】所以进程里会有三个设置管理器阶段：bootstrap（trusted:false，只读全局）→ startup（默认信任，用于会话目录/首次引导）→ runtime（真实信任结论，第 7 节工厂里创建）。读 `main.ts` 时必须把这三者的**职责与信任级别**分开，否则会以为"项目设置没信任却生效了"。
- **首次引导**（主题选择 + 遥测同意）：`shouldRunFirstTimeSetup()` 守卫（只在交互、非 help、非 list-models 时跑）；注释说明为什么**必须最早跑**——"让选定的设置在所有地方生效"（晚了的话，runtime 服务已按旧设置创建）。
- `--theme` 的会话覆盖：`applyOverrides({ theme })`——**不落盘**的会话期覆盖（第 11.3.3 节）。

###### 6. 会话目录与会话管理器

【源码（节选）】

```typescript
	// Decide the final runtime cwd before creating cwd-bound runtime services.
	// --session and --resume may select a session from another project, so project-local
	// settings, resources, provider registrations, and models must be resolved only after the
	// target session cwd is known. ...
	const envSessionDir = process.env[ENV_SESSION_DIR];
	// 会话目录三级优先：--session-dir → 环境变量（PI_CODING_AGENT_SESSION_DIR）→ 设置里的 sessionDir（第 3.4.3 节）
	const sessionDir =
		(parsed.sessionDir ? normalizePath(parsed.sessionDir) : undefined) ??
		(envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
		startupSettingsManager.getSessionDir();
	// createSessionManager(parsed, cwd, sessionDir, startupSettingsManager)：处理 --continue/--resume/--session/--session-id/--fork/--no-session 等组合（cli/session-picker.ts 等模块配合）——它可能打开别的项目的会话，所以紧接着要处理"目标会话的 cwd 与当前进程 cwd 不同"的问题
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
	// getMissingSessionCwdIssue：目标会话的 cwd 不存在（目录被删/换机器）时的处理——交互模式询问新目录；非交互报错退出（第 9 章的"恢复报错"排障项）
	const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
	// ...（缺 cwd 时的交互询问/非交互报错）
```

【注解】

- **会话目录三级优先**：`--session-dir` → 环境变量（`PI_CODING_AGENT_SESSION_DIR`）→ 设置里的 `sessionDir`（第 3.4.3 节）。
- `createSessionManager(parsed, cwd, sessionDir, startupSettingsManager)`：处理 `--continue`/`--resume`/`--session`/`--session-id`/`--fork`/`--no-session` 等组合（`cli/session-picker.ts` 等模块配合）——它可能**打开别的项目的会话**，所以紧接着要处理"目标会话的 cwd 与当前进程 cwd 不同"的问题。
- `getMissingSessionCwdIssue`：目标会话的 cwd **不存在**（目录被删/换机器）时的处理——交互模式询问新目录；非交互报错退出（第 9 章的"恢复报错"排障项）。**这就是"cwd 必须在建 runtime 服务之前定下来"的实践**：注释原文说"项目本地设置、资源、provider 注册、模型都必须等目标 cwd 确定后再解析"。

---

> D6 第一部分到此。第二部分：`createRuntime` 工厂（信任解析、服务创建、模型作用域、会话选项、会话创建）、`createAgentSessionRuntime`、help/list-models、管道输入与初始消息、主题、诊断输出与三种模式分发，最后是总结。

---

###### 第二部分：运行时工厂与模式分发

##### 7. `createRuntime` 工厂：可重建装配的完整实现

先看它的"闭包捕获"部分（函数外，装配一次）：

【源码（节选）】

```typescript
	// 提前把 CLI 相对路径固定为绝对路径，后续切换会话 cwd 时不重新解释它们。
	const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
	const resolvedSkillPaths = resolveCliPaths(cwd, parsed.skills);
	const resolvedPromptTemplatePaths = resolveCliPaths(cwd, parsed.promptTemplates);
	const resolvedThemePaths = resolveCliPaths(cwd, parsed.themes);
```

【注解】

- 四类 CLI 路径**在工厂外解析一次**（相对 cwd → 绝对路径）——第 11.4.3 节的注释："so later cwd switches do not reinterpret them"（切目录后不会被重新解释）。**相对路径转绝对 = 冻结语义**，这是"可重建装配"能正确工作的前提之一。

###### 7.1 信任解析：三重判定

【源码】

```typescript
	// createRuntime 的参数由 runtime 调用方提供（{ cwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext }）而不是直接用外部闭包里的 cwd——这就是"重建"的关键：每次替换会话时传入新 cwd
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext,
	}) => {
		// isInitialRuntime（sessionStartEvent === undefined）用于后续决定信任提示的 UI 形态（启动时可用交互弹窗；替换时用当前 appMode）
		const isInitialRuntime = sessionStartEvent === undefined;
		const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
		// 本次进程的缓存（projectTrustByCwd——同一 cwd 只判定一次，见下）
		const cachedProjectTrust = projectTrustByCwd.get(cwd);
		const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd);
		// shouldResolveProjectTrust 为真 = "还没有结论且确实需要判定" → 先置 false（安全默认），把真正的判定推迟到 ResourceLoader 的 resolveProjectTrust 回调里（第 7.2 节）——因为判定需要先加载一部分扩展（project_trust 事件只能由用户级/CLI 扩展处理，第 11.4.3 节）
		const shouldResolveProjectTrust =
			// CLI 覆盖（parsed.projectTrustOverride，来自 --approve/--no-approve）最高
			parsed.projectTrustOverride === undefined && cachedProjectTrust === undefined && hasTrustRequiringResources;
		const projectTrusted = shouldResolveProjectTrust
			? false
			: (cachedProjectTrust ??
				parsed.projectTrustOverride ??
				// 资源存在性 + 存储的决定：没有受保护资源 → 信任（不需要判定）；否则查 trustStore（第 11.5.3 节）
				(!hasTrustRequiringResources || trustStore.get(cwd) === true));
		const runtimeSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
```

【注解（三重）：**

1. **CLI 覆盖**（`parsed.projectTrustOverride`，来自 `--approve`/`--no-approve`）最高；
2. **本次进程的缓存**（`projectTrustByCwd`——同一 cwd 只判定一次，见下）；
3. **资源存在性 + 存储的决定**：没有受保护资源 → 信任（不需要判定）；否则查 `trustStore`（第 11.5.3 节）。

- `shouldResolveProjectTrust` 为真 = "**还没有结论且确实需要判定**" → 先置 `false`（安全默认），把真正的判定推迟到 ResourceLoader 的 `resolveProjectTrust` 回调里（第 7.2 节）——因为**判定需要先加载一部分扩展**（`project_trust` 事件只能由用户级/CLI 扩展处理，第 11.4.3 节）。
- 【陷阱】`createRuntime` 的**参数由 runtime 调用方提供**（`{ cwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext }`）而不是直接用外部闭包里的 `cwd`——这就是"重建"的关键：每次替换会话时传入新 cwd。**但四类资源路径是闭包（第一次的 cwd 解析结果）**——所以"切目录后自定义扩展路径仍指向老位置"这种语义是**刻意的**（用户传入的路径不该被切目录悄悄改变）。两套"cwd 相关"的处理不同，读时注意区分。
- `isInitialRuntime`（`sessionStartEvent === undefined`）用于后续决定信任提示的 UI 形态（启动时可用交互弹窗；替换时用当前 appMode）。

###### 7.2 服务创建与信任回调的接线

【源码（节选）】

```typescript
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			settingsManager: runtimeSettingsManager,
			// modelRuntimeSignal: AbortSignal.timeout(15_000)：模型运行时创建带15 秒超时（目录刷新/凭据读取不能无限等——第 5.6.2 节的动态目录在启动期受限）
			modelRuntimeSignal: AbortSignal.timeout(15_000),
			// extensionFlagValues: parsed.unknownFlags：未识别的 CLI flag 传给服务层——由它对照扩展注册的 flag 做校验（第 8.3.2 节：不认识的报 error 诊断）
			extensionFlagValues: parsed.unknownFlags,
			resourceLoaderReloadOptions: shouldResolveProjectTrust
				? {
						// 它接收 { extensionsResult }（预加载的扩展结果）——正是"先加载用户级/CLI 扩展、再判定"的机制接口
						resolveProjectTrust: async ({ extensionsResult }) => {
							const trusted = await resolveProjectTrusted({
								cwd, trustStore,
								trustOverride: parsed.projectTrustOverride,
								defaultProjectTrust: startupSettingsManager.getDefaultProjectTrust(),
								extensionsResult,
								projectTrustContext:
									projectTrustContext ??
									createProjectTrustContext({
										cwd,
										// trustPromptMode 的来源没在这段显示（main.ts 前面按模式算好：交互=可弹窗、非交互=自动）；hasUI: isInitialRuntime && trustPromptMode === "interactive"——只有启动期且交互才给 UI，重建时不给（替换场景不弹信任窗）
										mode: isInitialRuntime ? trustPromptMode : appMode,
										settingsManager: startupSettingsManager,
										hasUI: isInitialRuntime && trustPromptMode === "interactive",
									}),
								// onExtensionError 把扩展错误收成 warning 诊断（不中断信任流程）
								onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
							});
							// 判定结果写进 projectTrustByCwd 缓存（同 cwd 的重建不再判定——避免每次切会话都重新问用户）
							projectTrustByCwd.set(cwd, trusted);
							return trusted;
						},
					}
				: undefined,
			resourceLoaderOptions: {
				additionalExtensionPaths: resolvedExtensionPaths,
				additionalSkillPaths: resolvedSkillPaths,
				additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
				additionalThemePaths: resolvedThemePaths,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				noContextFiles: parsed.noContextFiles,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
				extensionFactories,
			},
		});
```

【注解】

- `extensionFlagValues: parsed.unknownFlags`：未识别的 CLI flag 传给服务层——由它对照扩展注册的 flag 做校验（第 8.3.2 节：不认识的报 error 诊断）。
- **信任回调的四个要点**：
  1. 它接收 `{ extensionsResult }`（预加载的扩展结果）——正是"先加载用户级/CLI 扩展、再判定"的机制接口；
  2. `trustPromptMode` 的来源没在这段显示（`main.ts` 前面按模式算好：交互=可弹窗、非交互=自动）；`hasUI: isInitialRuntime && trustPromptMode === "interactive"`——**只有启动期且交互**才给 UI，重建时不给（替换场景不弹信任窗）；
  3. 判定结果写进 `projectTrustByCwd` 缓存（同 cwd 的重建不再判定——**避免每次切会话都重新问用户**）；
  4. `onExtensionError` 把扩展错误收成 warning 诊断（不中断信任流程）。
- `modelRuntimeSignal: AbortSignal.timeout(15_000)`：模型运行时创建带**15 秒超时**（目录刷新/凭据读取不能无限等——第 5.6.2 节的动态目录在启动期受限）。
- `resourceLoaderOptions` 十项：四个路径 + 五个 no* 开关 + 两个提示注入——**CLI 的全部资源控制面**都在这里（对照第 11.4 节的发现器）。

###### 7.3 诊断收集与模型作用域

【源码（节选）】

```typescript
		// 五类诊断来源合并：信任诊断、服务诊断、设置诊断、扩展加载错误、扩展包警告——全部变成 AgentSessionRuntimeDiagnostic（第 8.3.2 节的"只收集不打印"）
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...projectTrustDiagnostics,
			...services.diagnostics,
			...collectSettingsDiagnostics(settingsManager),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({ type: "error", message: `Failed to load extension "${path}": ${error}` })),
			...(resourceLoader.getExtensions().warnings ?? []).map(({ path, warning }) => ({ type: "warning", message: `Extension package "${path}": ${warning}` })),
		];

		// 模型作用域：parsed.models（CLI）或设置里的 enabledModels；resolveModelScope(..., { signal: 15s }) 把模式解析成模型列表（第 5.3.1 节）——又一次 15 秒超时（启动期的网络操作有统一预算）
		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels = modelPatterns && modelPatterns.length > 0
			? await resolveModelScope(modelPatterns, modelRuntime, { signal: AbortSignal.timeout(15_000) })
			: [];
		// buildSessionOptions(parsed, scopedModels, isContinuing, modelRuntime, settingsManager)：把 CLI 选项 + 作用域解析成"会话创建选项"（sessionOptions），还返回 cliThinkingFromModel（"思考级别来自模型后缀 provider/model:high"这种来源标记）与诊断
		const { options: sessionOptions, cliThinkingFromModel, diagnostics: sessionOptionDiagnostics } =
			buildSessionOptions(parsed, scopedModels, sessionManager.buildSessionContext().messages.length > 0, modelRuntime, settingsManager);
		diagnostics.push(...sessionOptionDiagnostics);
```

【注解】

- **五类诊断来源合并**：信任诊断、服务诊断、设置诊断、扩展加载错误、扩展包警告——全部变成 `AgentSessionRuntimeDiagnostic`（第 8.3.2 节的"只收集不打印"）。**运行时把它交给 main 层统一展示/裁决**（第 7.5 节）。
- 模型作用域：`parsed.models`（CLI）或设置里的 `enabledModels`；`resolveModelScope(..., { signal: 15s })` 把模式解析成模型列表（第 5.3.1 节）——**又一次 15 秒超时**（启动期的网络操作有统一预算）。
- `buildSessionOptions(parsed, scopedModels, isContinuing, modelRuntime, settingsManager)`：把 CLI 选项 + 作用域解析成"会话创建选项"（`sessionOptions`），还返回 `cliThinkingFromModel`（"思考级别来自模型后缀 `provider/model:high`"这种来源标记）与诊断。**这是 CLI 与 SDK 的最后一个接缝**：再往下就是 D5 的 `createAgentSessionFromServices`。

###### 7.4 运行时 API Key 与"从服务建会话"

【源码（节选）】

```typescript
		if (parsed.apiKey) {
			if (!sessionOptions.model) {
				// --api-key 的前置校验：必须有明确模型（因为 key 要绑定到 provider）——否则报 error 诊断（最终会阻止启动，见第 7.5 节）；有模型时 setRuntimeApiKey（第 5 章的"运行时覆盖"）
				diagnostics.push({ type: "error", message: "--api-key requires a model to be specified via --model, --provider/--model, or --models" });
			} else {
				await modelRuntime.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
			}
		}

		const created = await createAgentSessionFromServices({
			services, sessionManager, sessionStartEvent,
			model: sessionOptions.model, thinkingLevel: sessionOptions.thinkingLevel, scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools, excludeTools: sessionOptions.excludeTools, noTools: sessionOptions.noTools, customTools: sessionOptions.customTools,
		});
		// cliThinkingOverride 与 created.session.setThinkingLevel(created.session.thinkingLevel) 这一对：重新应用一次思考级别
		const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
		if (created.session.model && cliThinkingOverride) {
			created.session.setThinkingLevel(created.session.thinkingLevel);
		}

		// 返回 { ...created, services, diagnostics }：CreateAgentSessionRuntimeResult 的三件套（D5 §0 的返回 + services + diagnostics）
		return { ...created, services, diagnostics };
	};
```

【注解】

- `--api-key` 的**前置校验**：必须有明确模型（因为 key 要绑定到 provider）——否则报 error 诊断（最终会阻止启动，见第 7.5 节）；有模型时 `setRuntimeApiKey`（第 5 章的"运行时覆盖"）。
- `createAgentSessionFromServices(...)`：**D5 的 `createAgentSession` 的服务注入版**（第 8.3.2 节）——把装配好的服务原样传给会话创建。
- 【陷阱】`cliThinkingOverride` 与 `created.session.setThinkingLevel(created.session.thinkingLevel)` 这一对：**重新应用一次思考级别**。为什么？注释没写，但结合 D5 第 4 节：`createAgentSession` 内部按"恢复/设置"逻辑算出级别并 clamp；CLI 显式指定（`--thinking` 或模型后缀）时，要**覆盖回去并触发 setter 的副作用**（setter 可能会同步相关状态/写条目，第 13 章）。读这种"调用自己的 getter 再 set 回去"的写法时要**找出 setter 的副作用**才知道为什么需要——否则会觉得是 no-op。
- 返回 `{ ...created, services, diagnostics }`：`CreateAgentSessionRuntimeResult` 的三件套（D5 §0 的返回 + services + diagnostics）。

##### 8. `createAgentSessionRuntime` 与运行时取值

【源码（节选）】

```typescript
	time("createRuntime");
	// createAgentSessionRuntime（第 8.4 节）内部：assertSessionCwdExists → 调用工厂 → 包成 AgentSessionRuntime
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir,
		sessionManager,
	});
	time("createAgentSessionRuntime");
	const { services, session, modelFallbackMessage } = runtime;
	const { settingsManager, modelRuntime, resourceLoader } = services;
	// 拿到 runtime 后：解构服务与会话、重设终端能力覆盖（setCapabilityOverrides——终端能力探测的覆盖项，第 17 章）、再次应用代理与 HTTP 调度器（这次用 runtime 的合并设置——全局代理在 bootstrap 时已应用过一次，这里用"合并后"的设置再应用：即"项目设置里的代理也能生效"；这正是"必须等 cwd 确定"的价值）
	setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());
	applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());
```

【注解】

- `createAgentSessionRuntime`（第 8.4 节）内部：`assertSessionCwdExists` → 调用工厂 → 包成 `AgentSessionRuntime`。注意传的 cwd 是 **`sessionManager.getCwd()`**（会话的目标 cwd，可能是别的项目）而不是进程 cwd。
- 拿到 runtime 后：解构服务与会话、**重设终端能力覆盖**（`setCapabilityOverrides`——终端能力探测的覆盖项，第 17 章）、**再次应用代理与 HTTP 调度器**（这次用 runtime 的**合并设置**——【陷阱】全局代理在 bootstrap 时已应用过一次，这里用"合并后"的设置再应用：即"项目设置里的代理也能生效"；这正是"必须等 cwd 确定"的价值）。

##### 9. help / list-models / 管道输入与初始消息

【源码（节选）】

```typescript
	// help：先报启动设置诊断（帮助也要能看到配置问题），再合并扩展注册的 flag 后打印帮助（extensionFlags——扩展可以通过 pi.registerFlag 增加 CLI 选项，第 13.2 节）
	if (parsed.help) {
		reportDiagnostics(startupSettingsDiagnostics);
		const extensionFlags = resourceLoader.getExtensions().extensions.flatMap((extension) => Array.from(extension.flags.values()));
		printHelp(extensionFlags);
		process.exit(0);
	}

	if (parsed.listModels !== undefined) {
		reportDiagnostics(startupSettingsDiagnostics);
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRuntime, searchPattern, AbortSignal.timeout(15_000));
		process.exit(0);
	}

	let stdinContent: string | undefined;
	if (appMode !== "rpc") {
		// 管道输入：RPC 模式不读 stdin（它是协议通道！）；其他模式读；读到内容且当前是 interactive → 降级为 print（第 16.2 节的"管道自动降级"）
		stdinContent = await readPipedStdin();
		if (stdinContent !== undefined && appMode === "interactive") {
			appMode = "print";
		}
	}
	time("readPipedStdin");

	// prepareInitialMessage(parsed, stdinContent)：把位置参数消息、@file 附件、stdin 文本、图片整理成 initialMessage/initialImages（第 16 章的 CLI 文档："Piped stdin 内容前置到第一个 prompt"）
	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, stdinContent);
	time("prepareInitialMessage");
```

【注解】

- **help**：先报启动设置诊断（帮助也要能看到配置问题），再**合并扩展注册的 flag** 后打印帮助（`extensionFlags`——扩展可以通过 `pi.registerFlag` 增加 CLI 选项，第 13.2 节）。
- **list-models**：15 秒超时的列表（含搜索）；同样先报诊断。
- **管道输入**：RPC 模式**不读** stdin（它是协议通道！）；其他模式读；读到内容且当前是 interactive → **降级为 print**（第 16.2 节的"管道自动降级"）。`readPipedStdin` 读的是"非 TTY stdin 的全部内容"（`git diff | pi ...` 的场景）。
- `prepareInitialMessage(parsed, stdinContent)`：把位置参数消息、`@file` 附件、stdin 文本、图片整理成 `initialMessage`/`initialImages`（第 16 章的 CLI 文档："Piped stdin 内容前置到第一个 prompt"）。

##### 10. 主题、诊断与三种模式分发

【源码（节选）】

```typescript
	setThemeJsonValidator(validateThemeJson);
	// 主题初始化：先设置 JSON 校验器（用户主题全量校验，第 17 章的"主题是用户数据"），再按模式初始化（appMode === "interactive" 决定要不要真的动终端）
	initTheme(settingsManager.getTheme(), appMode === "interactive");
	time("initTheme");

	if (appMode === "interactive" && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	time("resolveModelScope");
	const startupDiagnostics = deduplicateDiagnostics([...startupSettingsDiagnostics, ...runtime.diagnostics]);
	const hasRuntimeErrors = runtime.diagnostics.some((diagnostic) => diagnostic.type === "error");
	if (appMode !== "interactive" || hasRuntimeErrors) {
		reportDiagnostics(startupDiagnostics);
	}
	if (hasRuntimeErrors) {
		if (runtime.diagnostics.some((diagnostic) => diagnostic.message.includes("Failed to load extension"))) {
			console.error(chalk.yellow(EXTENSION_LOAD_FAILURE_HINT));
		}
		process.exit(1);
	}
	time("createAgentSession");

	if (appMode !== "interactive" && !session.model) {
		console.error(chalk.red(formatNoModelsAvailableMessage()));
		process.exit(1);
	}

	// PI_STARTUP_BENCHMARK 仅交互：非交互直接报错（它依赖 TUI 的初始化路径才有意义，第 19.2 节）
	const startupBenchmark = isTruthyEnvFlag(process.env.PI_STARTUP_BENCHMARK);
	if (startupBenchmark && appMode !== "interactive") {
		console.error(chalk.red("Error: PI_STARTUP_BENCHMARK only supports interactive mode"));
		process.exit(1);
	}

	if (!offlineMode && appMode === "rpc") {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		// RPC 的后台目录刷新：非离线 + RPC → 20 秒超时的 modelRuntime.refresh()，不 await（fire-and-forget，.catch(() => {}) 吞错、.finally 清定时器）——注释说"interactive 模式在 TUI 初始化后再刷新"（时机不同）
		void modelRuntime.refresh({ signal: controller.signal }).catch(() => {}).finally(() => clearTimeout(timeout));
	}

	if (appMode === "rpc") {
		printTimings();
		// 三模式分发：runRpcMode(runtime) / new InteractiveMode(runtime, {...}) + run() / runPrintMode(runtime, { mode: toPrintOutputMode(appMode), ... })
		await runRpcMode(runtime);
	} else if (appMode === "interactive") {
		const interactiveMode = new InteractiveMode(runtime, { /* migratedProviders, startupDiagnostics, modelFallbackMessage, autoTrustOnReloadCwd, initialMessage, initialImages, initialMessages, verbose, tuiMode, initialThemeSetting */ });
		if (startupBenchmark) { /* 初始化后立刻退出并打印耗时 */ }
		printTimings();
		await interactiveMode.run();
	} else {
		printTimings();
		const exitCode = await runPrintMode(runtime, { mode: toPrintOutputMode(appMode), messages: parsed.messages, initialMessage, initialImages });
		stopThemeWatcher();
		restoreStdout();
		if (exitCode !== 0) {
			process.exitCode = exitCode;
		}
		return;
	}
```

【注解（收尾的六个决定）】

1. **主题初始化**：先设置 JSON 校验器（用户主题全量校验，第 17 章的"主题是用户数据"），再按模式初始化（`appMode === "interactive"` 决定要不要真的动终端）。
2. **弃用警告**：只在交互模式弹（非交互会污染协议输出）。
3. **诊断裁决**：交互且无错 → 不打印（TUI 会展示）；非交互或**有 error** → 打印；有 error → 追加"扩展加载失败提示"（针对性建议）→ **退出码 1**。这就是"收集-裁决"闭环的终点（第 8.3.2 节）。
4. **非交互无模型 → 报错退出**（print/json 没法"进界面再选"）。
5. **`PI_STARTUP_BENCHMARK` 仅交互**：非交互直接报错（它依赖 TUI 的初始化路径才有意义，第 19.2 节）。交互模式下：初始化 TUI → 给 150ms 让 stdin 处理器消费终端查询应答（Kitty 协议、设备属性、单元格尺寸）→ 停 → 打印耗时 → **等待 stdout/stderr drain** → return（不进入主循环）。这段"等 drain"是"退出前不丢输出"的细节（第 17 章的终端查询主题）。
6. **RPC 的后台目录刷新**：非离线 + RPC → 20 秒超时的 `modelRuntime.refresh()`，**不 await**（fire-and-forget，`.catch(() => {})` 吞错、`.finally` 清定时器）——注释说"interactive 模式在 TUI 初始化后再刷新"（时机不同）。
7. **三模式分发**：`runRpcMode(runtime)` / `new InteractiveMode(runtime, {...})` + `run()` / `runPrintMode(runtime, { mode: toPrintOutputMode(appMode), ... })`。print 分支的收尾：`stopThemeWatcher()` + `restoreStdout()`（把第 4 节接管的 stdout 还回去）+ 退出码传递（`process.exitCode = exitCode`——**不强制 process.exit**，让进程自然退出，避免截断输出）。

##### 11. 总结

###### 11.1 `main()` 的阶段表（背下来）

```text
① 打点/离线/扩展工厂
② auth 短路 → Windows 清理 → bootstrap 设置（只全局）→ 包/配置/mcp 短路
③ parseArgs → 诊断裁决 → version/export 短路
④ appMode 解析 → takeOverStdout → RPC @file 拒绝 → fork 校验
⑤ 迁移 → startup 设置（默认信任）→ 首次引导 → 主题覆盖
⑥ 会话目录三级 → 会话管理器 → 缺 cwd 处理
⑦ createRuntime 工厂（信任解析/服务/诊断/作用域/会话选项/运行时 key/建会话）
⑧ createAgentSessionRuntime → 能力/代理/调度器
⑨ help / list-models → stdin → 初始消息 → 主题
⑩ 诊断裁决（error 退出）→ 无模型（非交互）退出 → benchmark 校验
⑪ RPC 后台刷新 → 三模式分发
```

###### 11.2 与 D5 的关系

```text
main.ts        = 环境/命令行 → 决定"往哪儿装配"（模式、会话、信任、路径）
sdk.ts         = 决定"装配什么"（服务、Agent、AgentSession 的连线）
agent-session  = 决定"运行起来后怎么活"（prompt 主路径、压缩、重试）
```

###### 11.3 阅读检查清单

- [ ] 我能说出"三个 SettingsManager 阶段"的信任级别与用途吗？
- [ ] 我知道 `sessionDir` 为什么在信任前可读吗？（引导期例外）
- [ ] 我能解释 `takeOverStdout` 与它的例外吗？
- [ ] 我知道信任回调为什么接收 `extensionsResult` 吗？（预加载用户级扩展）
- [ ] 我能说出 `createRuntime` 哪些输入是闭包（冻结）、哪些是参数（随替换变化）吗？
- [ ] 我知道 print 分支为什么不 `process.exit` 吗？（自然退出、避免截断）

---

> D6 完。下一篇（D7）精读内置工具：`read.ts`、`write.ts`、`truncate.ts`、`output-accumulator.ts`、`bash.ts` 的关键段。

#### 3.16 常见错误

| 现象/误解                                         | 纠正                                           |
| ------------------------------------------------- | ---------------------------------------------- |
| 以为`session.prompt()` 在第一次模型响应后就返回 | 它要等整个 run（含工具、重试、压缩、队列）结束 |
| 把`message_update` 当成"消息"存起来             | 它是过程事件；消息以`message_end` 为准       |
| 在订阅回调里做耗时操作                            | 监听器被逐个`await`，会拖慢整个 run          |
| 用"完成顺序"理解工具结果消息顺序                  | 完成事件按完成顺序；结果消息按声明顺序         |
| 以为工具抛错会让 pi 崩溃                          | 异常被折叠成错误结果，模型可据此调整           |
| 认为`abort()` 会强杀一切                        | 它是信号；工具/请求需要自行响应并清理          |
| 修改工作目录后继续用旧的会话对象                  | 资源是 cwd 绑定的，需要重建（第 8、11 章）     |

#### 3.17 验收题

1. 按顺序写出：从用户按下回车（print 模式）到发出第一个模型请求，经过的**文件与函数**（至少 6 个）。
2. 场景："读取 demo.txt 并总结三点"运行中，一共发生了几次 `turn_start`？几次 `message_end`？分别属于哪些角色？
3. `session.prompt()` 返回的前提是什么？列出至少两种"返回前还可能发生"的情况。
4. 工具执行被 `beforeToolCall` 钩子拦截时，模型会看到什么？run 会继续吗？
5. 用户按 Esc 取消时，为什么"当前正在执行的工具"可能还要运行一会儿才停？

##### 参考答案（要点）

1. `src/cli.ts` → `setupCli`（`cli/setup.ts`）→ `main`（`main.ts`，parseArgs、建 runtime、模式分发）→ `runPrintMode` → `AgentSession.prompt`（`core/agent-session.ts`）→ `_runAgentPrompt` → `Agent.prompt`（`packages/agent/src/agent.ts`）→ `runAgentLoop`（`agent-loop.ts`）→ `streamAssistantResponse` → `streamFn` 包装（`core/sdk.ts`）→ `ModelRuntime.streamSimple` → `pi-ai streamSimple` → 供应商适配器。（答出主链即可。）
2. `turn_start` 2 次（两个 turn）；`message_end` 4 次：user、assistant#1（含工具调用）、toolResult、assistant#2。若有工具变化声明，可能多一条 system 消息（本例没有）。
3. 前提：整个 run 结束且会话收尾循环（重试、压缩、队列、before_settle 边界）都完成。返回前还可能发生：自动重试、自动压缩后再跑、注入排队消息再跑、扩展边界钩子触发继续。
4. 模型看到一条 `isError: true` 的工具结果，文本是拦截原因（或默认 "Tool execution was blocked"）；run 是否继续取决于该批次其余结果与循环决策——单次拦截本身不会结束 run（除非结果携带 terminate 且批次全部 terminate，或被上层 `finishTurn` 判定 end）。
5. `abort()` 只是"请求取消"；工具实现需要主动检查 `signal` 并自行退出。正在等待 I/O 或子进程的工具若没有检查信号，就会继续运行到自然结束。

#### 3.18 源码依据

- `packages/coding-agent/src/cli.ts`、`src/cli/setup.ts`、`src/experimental/cli.ts`；
- `packages/coding-agent/src/main.ts`（启动、装配、模式分发）；
- `packages/coding-agent/src/core/sdk.ts`（`createAgentSession`）；
- `packages/coding-agent/src/core/agent-session.ts`（`prompt` 第 1921 行、`_runAgentPrompt` 第 1775 行、持久化分支约第 1113 行）；
- `packages/agent/src/agent.ts`（`prompt`、`runWithLifecycle`、`processEvents`）；
- `packages/agent/src/agent-loop.ts`（`runAgentLoop`、`runLoop`、`streamAssistantResponse`、工具执行四步流水线）；
- `packages/coding-agent/docs/how-pi-works.md`、`packages/agent/README.md`。

---

## 动手任务 A：画两条时序。

第一条让 faux 直接返回文本，第二条让 faux 先返回 `read` 工具调用、再返回文本。写入下面这个完整测试文件；它在临时目录创建 README，不会读取你的真实文件。

```typescript
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { createHarness } from "./harness.ts";

it("traces a tool turn and a final answer", async () => {
  const h = await createHarness();
  try {
    writeFileSync(join(h.tempDir, "README.md"), "# Demo\nFirst paragraph.\n");
    h.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("First paragraph."),
    ]);
    await h.session.prompt("读取 README 第一段");
    expect(h.faux.state.callCount).toBe(2);
    expect(h.session.messages.some((m) => m.role === "toolResult")).toBe(true);
    expect(h.events.some((e) => e.type === "agent_end")).toBe(true);
  } finally {
    h.cleanup();
  }
});
```

运行通过后，把 `setResponses` 改为只有 `fauxAssistantMessage("First paragraph.")`，把请求次数断言改为 1，记录两次的事件类型顺序。恢复测试文件到你希望保留的版本。

## 动手任务 B：反向定位。

假设“终端已经看到 `text_delta`，但会话文件中没有最后一条 assistant 消息”，从显示层往回追四个观察点：provider 事件、Agent 事件、会话订阅事件、持久化追加。为每点写出一个源码符号和可观察证据。

## 实验记录

1. 固定输入为“读取 README 第一段并总结”，固定模型脚本为“调用 read → 给出一句总结”。在表中给每轮编号 T1、T2，填模型输入的消息条数和 `h.events` 的事件类型。
2. 从 `main()` 顺着调用进入 `createAgentSession`、`AgentSession.prompt` 和 `Agent.prompt`。每次跨模块都写明“谁等待谁”，把事件通知与函数返回分开画。
3. 对比纯文本脚本：用同一张表划掉工具执行及第二次模型请求，说明哪些阶段仍完全相同。
4. 最后交付两张时序图和一张故障定位表。故障定位表的每一行都要有“若此处有事件而下一处没有，优先查哪个函数”。

测试结束后删除自己的 `task-02-learning.test.ts`，或保留它并记录单文件运行结果；不要清理工作区中原本就存在的文件。

## 验收标准

能解释工具调用为什么通常带来第二次模型请求；能区分“文本增量已显示”和“完整消息已持久化”。
