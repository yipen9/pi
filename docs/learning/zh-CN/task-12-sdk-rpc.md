# 12. SDK 宿主与进程级协议

今天独立做一个嵌入式宿主和一个 JSONL 解析器，从进程内、进程外两侧看同一 Agent 事件。所有模型回答用 faux 提供；不用其他任务或真实密钥，预计 3 小时。

## 今日准备

Node.js >= 22.19.0，缺少依赖时在根目录执行 `npm install --ignore-scripts`。在 `packages/coding-agent/test/suite/` 新建 `task-12-learning.test.ts`，从 `packages/coding-agent` 运行：

```powershell
node ../../node_modules/vitest/dist/cli.js --run test/suite/task-12-learning.test.ts
```

本任务不启动真实 RPC 进程；先用本篇给出的 JSONL 字节样本验证解析器。进程内会话使用 `createHarness()`，它提供独立临时目录、faux 假模型和 `cleanup()`。

## 学习内容

在同一 Node 进程里嵌入 pi 时使用 SDK，可直接持有 session、订阅事件和释放资源；从外部进程控制 pi 时，Print 提供最终文本，JSON 输出事件流，RPC 提供长驻双向命令。JSONL 指“每行一个独立 JSON 对象”，读取时要按换行重组，不能假设一次 `read` 正好得到一行。RPC 的命令确认表示请求已接收，不等于 Agent 运行完成；子进程退出时还要结束所有等待中的请求。

例如宿主发送 `{"id":"p1","type":"prompt","message":"你好"}`。RPC 可先回答“命令已接收”，随后才输出 `message_update`、`agent_end`、`agent_settled`。若子进程在第二个事件前退出，客户端必须让 `p1` 的等待方得到错误。SDK 没有按行编码这层，但同样要区分事件到达、run 收束和资源释放。

## 核心源码

核心源码路径及问题：`packages/coding-agent/src/core/sdk.ts` 的 `createAgentSession` 返回谁、由谁释放；`examples/sdk/01-minimal.ts` 怎样订阅增量；`src/modes/print-mode.ts` 何时只输出最终文本；`src/modes/json-event.ts` 怎样序列化事件；`src/modes/rpc/rpc-types.ts` 有哪些命令和响应；`src/modes/rpc/rpc-client.ts` 怎样按 ID 匹配请求、在退出时拒绝未完成调用。按这六个问题读，不需要额外手册。

## TypeScript 语法小课：字节流与解码器状态

`Uint8Array` 是字节，不等于一个完整字符或一行 JSON。`TextDecoder.decode(bytes, { stream: true })` 会保留尚未凑齐的 UTF-8 字节。RPC 客户端要先解码、再按换行切分、最后 `JSON.parse`。

```typescript
const bytes = new TextEncoder().encode("中\n"); // “中”占多个 UTF-8 字节
const decoder = new TextDecoder(); // 同一个解码器跨块保留状态
let text = decoder.decode(bytes.slice(0, 1), { stream: true }); // 第一块可能为空
text += decoder.decode(bytes.slice(1), { stream: true }); // 第二块补齐字符
text += decoder.decode(); // 输入结束时冲出剩余状态
console.assert(text === "中\n");
```

练习：每次都新建 `TextDecoder`，观察乱码；再对照本篇 JSONL 解析器为何必须维护 `pending`。


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

### 第 15 章：SDK 嵌入与会话控制

**先懂这一章**：SDK 适合在自己的 Node 程序里直接创建 pi 会话。你负责选择配置、订阅事件、提交输入，并在结束后释放资源。先跑通最小宿主，再逐项替换默认行为。

```text
教学伪代码：创建会话 → 订阅需要的事件 → 提交用户输入
           → 等待处理完成 → 取消订阅并释放会话
```

排队消息、取消与 `agent_settled` 会改变“完成”的判断，第 15.5–15.6 节展开。

第 13–14 章是在 pi 内部增加能力；本章从外部程序控制 pi。下一章介绍进程级接口，两章都能集成 pi，但前者直接持有会话对象，后者通过文本或协议通信。

> 学完本章你能回答：
>
> 1. 什么时候用进程内 SDK、什么时候用第 16 章的进程级集成（print/JSON/RPC）？
> 2. `createAgentSession` 的每个选项分别替换哪一层默认实现？
> 3. 会话状态怎么读？为什么 `session.messages` 不是"事实来源"？
> 4. 事件订阅、取消、排队（steer/followUp）在 SDK 里怎么用？
> 5. 完整的释放顺序是什么？成功与异常路径分别怎么保证？

**预计学习时间**：1.5 天（面对的是"写宿主程序"，建议边写边跑）。
**本章验证状态**：静态核对通过（`sdk.md` 与 8 个 SDK 示例逐步核对）；实验 L09 设计中。

---


#### 15.1 先选集成形态：SDK 还是进程级接口

`sdk.md` 开篇就把边界划清了：

```text
`@earendil-works/pi-coding-agent` embeds Pi in a Node.js or Bun process. It provides direct
TypeScript access to the agent, sessions, tools, models, and resources used by the
command-line application.

Use the SDK for in-process TypeScript integration. For a language-independent or isolated
subprocess, see CLI Integration.
```

| 维度     | SDK（本章）                    | CLI 集成（第 16 章）        |
| -------- | ------------------------------ | --------------------------- |
| 语言     | TypeScript / JavaScript        | 任意（JSONL / 文本协议）    |
| 进程     | 与宿主同进程                   | 子进程                      |
| 隔离     | 无（共享权限与内存）           | 有进程边界（可加容器/沙箱） |
| 控制粒度 | 最细（可注入一切组件）         | 受协议命令集限制            |
| 事件     | 直接订阅`session.subscribe`  | 解析 stdout JSONL           |
| 适用     | 编辑器插件、自研工具、测试宿主 | 其他语言、需要隔离的自动化  |

**判断标准**：需要"读写宿主内部状态、注入自定义实现"选 SDK；需要"语言无关或隔离"选 CLI 集成。两者可以混用（例如 Node 宿主内部用 SDK，对外暴露 RPC 给别的工具）。


#### 15.2 最小宿主的完整骨架

`sdk.md` 的门面示例：

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();

try {
	await session.prompt("What files are in the current directory?");
	console.log(session.getLastAssistantText());
} finally {
	session.dispose();
}
```

三个必须理解的语义：

1. **`prompt()` 在"整个 run 结束"后 resolve**——包括自动重试（第 6 章）与队列处理；不是"第一次模型响应结束"；
2. **`session` 拥有什么**（`sdk.md` 原话）：一次对话、它的模型与工具、排队消息、压缩状态、扩展运行时；
3. **`dispose()` 必做**，它做四件事：

```text
abort active work
invalidate extension contexts
disconnect from the agent
remove event listeners
```

`01-minimal.ts` 的 `try/finally` 就是为此存在的（第 1 章逐行读过）。


#### 15.3 读会话状态：五个官方入口 + 一个警告

`sdk.md` 点名的读取入口：

| 读取                                          | 含义                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `session.messages`                          | 当前最终化的转录（含投影后的消息）                                                                                |
| `session.model` / `session.thinkingLevel` | 当前模型与思考级别                                                                                                |
| `session.systemPrompt`                      | **当前生效的系统提示（只读）**；包含"改了但还没发给模型"的变化；工具的变更会在下一次请求前声明（第 7.3 节） |
| `session.getActiveToolNames()`              | 当前激活工具集                                                                                                    |

警告（很多人第一次接 SDK 会踩）：

```text
`SessionManager` is authoritative for finalized model context. Restore external history by
constructing the session with a manager containing those entries. Assigning
`session.agent.state.messages` does not replace persisted context.
```

翻译：**"历史"的事实来源是 `SessionManager`**；`session.messages` 只是它的一次投影（第 9 章的三级流水线）。想恢复外部历史，正确做法是**用包含条目的 manager 构造会话**；直接给 `agent.state.messages` 赋值不会改写持久化上下文，还会让两边失同步。

如果宿主根本不想要文件：

```typescript
const { session } = await createAgentSession({
	sessionManager: SessionManager.inMemory(),
});
```


#### 15.4 逐项配置：每个开关替换哪一层

`sdk.md` 的"Configuring a session"一节给出了完整边界清单。默认情况下工厂会创建：`ModelRuntime`、文件版 `SettingsManager`、持久 `SessionManager`、`DefaultResourceLoader`、以及配置好的默认工具。每一层都可以显式提供：

| 选项                                                                | 替换的层                               | 示例出处                                   |
| ------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------ |
| `modelRuntime` / `model` / `thinkingLevel` / `scopedModels` | 模型访问与选择                         | `02-custom-model.ts`                     |
| `settingsManager`                                                 | 设置来源（文件或内存）                 | `10-settings.ts`、`12-full-control.ts` |
| `sessionManager`                                                  | 会话存储（持久/内存）                  | `11-sessions.ts`                         |
| `resourceLoader`                                                  | 资源发现（扩展/技能/模板/主题/上下文） | `03`、`04`、`06`、`07`、`08`     |
| `tools` / `noTools` / `excludeTools` / `customTools`        | 工具集                                 | `05-tools.ts`                            |

原则：**要"常规发现 + 局部覆盖"用 `DefaultResourceLoader` 的 override 选项；要"完全自己管"就实现自定义 `ResourceLoader`**（`12-full-control.ts` 给了完整接口清单）。


##### 15.4.1 模型与思考级别（02）

```typescript
const modelRuntime = await ModelRuntime.create();
const opus = modelRuntime.getModel("anthropic", "claude-opus-4-5");   // 内置目录
// 也可以查 models.json 里的自定义模型：modelRuntime.getModel("my-provider", "my-model")
const available = await modelRuntime.getAvailable();                  // 有有效凭据的模型
const { session } = await createAgentSession({ model: available[0], thinkingLevel: "medium", modelRuntime });
```

要点：`ModelRuntime` **显式创建并复用**——这样宿主可以先查模型/配凭据，再建会话；也避免每个会话重复初始化（第 5 章）。


##### 15.4.2 系统提示（03）

两种改法，差异要记牢：

```typescript
// 改法一：整体替换（连同丢弃默认 preamble）
const loader1 = new DefaultResourceLoader({
	cwd, agentDir,
	systemPromptOverride: () => `You are a helpful assistant that speaks like a pirate. ...`,
	// Needed to avoid DefaultResourceLoader appending APPEND_SYSTEM.md from ~/.pi/agent or <cwd>/.pi.
	appendSystemPromptOverride: () => [],
});

// 改法二：在默认提示基础上追加
const loader2 = new DefaultResourceLoader({
	cwd, agentDir,
	appendSystemPromptOverride: (base) => [...base, "## Additional Instructions\n- Always be concise ..."],
});
```

对照第 10 章：`systemPromptOverride` 对应"换掉 preamble"；`appendSystemPromptOverride` 对应 `addendum` 分节。第一个例子里 `appendSystemPromptOverride: () => []` 的作用注释写得很清楚：**防止默认发现流程把 `~/.pi/agent/APPEND_SYSTEM.md` 与项目版又追加进来**——只替换不兜底，会出现"pirate 提示词后面跟着系统文件内容"的意外组合。


##### 15.4.3 技能、工具、扩展、上下文、模板（04-08）

四个例子的共同模式：**先构造 `DefaultResourceLoader`（带 override/附加参数），reload 后注入会话**：

```typescript
const loader = new DefaultResourceLoader({
	cwd,
	agentDir,
	// 技能：过滤/替换 discovery 结果
	skillsOverride: (base) => ({ skills: [...base.skills.filter(/* ... */)], diagnostics: [] }),
	// 上下文文件：附加或替换
	agentsFilesOverride: (base) => ({ agentsFiles: [...base.agentsFiles, { path: "...", content: "..." }] }),
	// 扩展：文件路径 + 内联工厂
	additionalExtensionPaths: ["./my-extension.ts"],
	extensionFactories: [myInlineExtension],
});
await loader.reload();
const { session } = await createAgentSession({ resourceLoader: loader, sessionManager: SessionManager.inMemory() });
```

（具体 override 名以 `DefaultResourceLoaderOptions` 与各示例为准；`04-skills.ts`、`06-extensions.ts`、`07-context-files.ts`、`08-prompt-templates.ts` 各演示一项。）


##### 15.4.4 凭据与设置（09、10）

- `09-api-keys-and-oauth.ts`：自定义 `auth.json`/`models.json` 路径、运行时注入 API Key（`modelRuntime.setRuntimeApiKey(...)`，第 12 章示例同款）；
- `10-settings.ts`：文件版或**内存版**设置。测试与自动化里最常用：

```typescript
const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 2 },
});
```


##### 15.4.5 会话管理（11）

`SessionManager` 的静态工厂/查询一次性给全：

| API                                    | 用途                            |
| -------------------------------------- | ------------------------------- |
| `SessionManager.inMemory()`          | 不落盘的临时会话                |
| `SessionManager.create(cwd)`         | 新建持久会话                    |
| `SessionManager.continueRecent(cwd)` | 延续最近会话（没有则新建）      |
| `SessionManager.list(cwd)`           | 列出会话（用于选择器）          |
| `SessionManager.open(path)`          | 打开指定文件                    |
| 第二个参数`sessionDir`               | 自定义会话目录（不做 cwd 编码） |

`modelFallbackMessage` 在"恢复的模型不可用"时给出提示（第 3.5 节的恢复逻辑）——宿主应该展示它，而不是静默换模型。


##### 15.4.6 全控制（12）

`12-full-control.ts` 展示了"关闭所有发现"的极限形态：

```typescript
const resourceLoader: ResourceLoader = {
	getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
	getSkills: () => ({ skills: [], diagnostics: [] }),
	getPrompts: () => ({ prompts: [], diagnostics: [] }),
	getThemes: () => ({ themes: [], diagnostics: [] }),
	getAgentsFiles: () => ({ agentsFiles: [] }),
	getSystemPrompt: () => `You are a minimal assistant. ...`,
	getSystemPromptSource: () => undefined,
	getAppendSystemPrompt: () => [],
	getAppendSystemPromptSources: () => [],
	extendResources: () => {},
	reload: async () => {},
};

const { session } = await createAgentSession({
	cwd, agentDir: "/tmp/my-agent",
	model, thinkingLevel: "off",
	modelRuntime, resourceLoader,
	tools: ["read", "bash"],
	sessionManager: SessionManager.inMemory(cwd),
	settingsManager,
});
```

这份接口清单值得收藏：**它就是"资源层"的完整契约**。做纯函数测试、嵌入到别人的应用时，照这个写一个"空资源加载器"就能把 pi 变成一棵可完全预测的组件树。


##### 15.4.7 内联扩展与 builtin（13 的补充）

`sdk.md` 对扩展注入有两组细节：

- **内联扩展**（`InlineExtension`）：直接给 `extensionFactories`。只有需要"诊断与启动输出里出现稳定名字"时才命名；命名且 `replaceable: true` 的内联扩展，在**加载期**被别的扩展注册了同名工具/命令/flag 时**让位不加载**（而不是双份冲突）。CLI 内置的 codemode、tool_search、MCP 都是 replaceable；
- **`builtin: true` 的命名条目**：不是内联扩展，而是提供 `builtin:<name>` 扩展的代码；默认加载、`pi config` 可见、可用 `-builtin:<name>` 或 `noExtensions` 禁用；它在**项目信任之后**加载，因此**不能**处理 `project_trust` 事件。CLI 内置扩展用的就是它。


##### 15.4.8 codemode 与 MCP：SDK 默认没有

```text
The CLI loads `codemode`, `tool_search`, and MCP as built-in extensions. SDK sessions do not;
add `createCodemodeExtension()`, `createToolSearchExtension()`, and `createMcpExtension()` to the
`extensionFactories` of `DefaultResourceLoader`. `codemode` and `tool_search` are registered inactive:
enable them through the `defaultTools` setting (`["+codemode", "+tool_search"]` keeps the other
default tools), or let the MCP extension activate them. The MCP extension connects its servers on
`session_start`, so call `session.bindExtensions()`.
```

四步照抄：加工厂 → 用 `defaultTools` 的 `+` 语法启用 → `bindExtensions()`（让 MCP 在 `session_start` 连接服务器）→ 完整示例 `14-codemode-mcp.ts`（第 22 章展开 codemode 本身）。

#### 15.5 事件订阅、排队与取消


##### 15.5.1 订阅的正确姿势

`sdk.md` 的示例把顺序讲清了：**先订阅、再 prompt、finally 里退订**：

```typescript
const unsubscribe = session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

try {
	await session.prompt("Explain this repository");
} finally {
	unsubscribe();
}
```

会话事件覆盖：消息更新、工具执行、队列变化、压缩、重试……（完整清单就是第 4.5.2 节的 `AgentSessionEvent`）。两个行为细节回顾：

- `AgentSession.subscribe` 的回调类型是 `(event) => void`，派发时同步调用；不会等待 async listener 返回的 Promise。回调启动异步副作用时，要显式接 rejection；不要假设 `await session.prompt(...)` 会等待该副作用。示例见 D27 §7.1。
- 底层 `Agent.subscribe` 是另一份契约：listener 可返回 `Promise<void>`，Agent 会逐个等待。`AgentSession` 内部依靠这层等待完成事件处理和持久化，但不会把等待能力传给 SDK 公开的 `session.subscribe`。
- `message_update` 携带"增量 + 部分消息快照"：流式渲染用增量，整段重绘用快照。


##### 15.5.2 流式中再输入：必须"表态"

```text
A prompt sent while the session is already streaming must specify whether it should steer
the current run or follow it. Calling `prompt()` without that choice rejects rather than guessing.
```

对应代码：

```typescript
await session.prompt("补充一句", { streamingBehavior: "steer" });     // 当前轮后注入
await session.prompt("顺便再跑测试", { streamingBehavior: "followUp" }); // 收工前注入
```

不想用 `prompt()` 的话，直接调排队 API：

```typescript
const result = await session.steer("...");     // 或 session.followUp("...")
// "queued"  → 已入队（可能经过扩展改写）
// "handled" → 被扩展消费（不会进模型）
```

返回值语义很重要：`"handled"` 意味着扩展已经处理（第 13.7.3 节的 `input` 事件），宿主不要假设消息一定会到模型。


##### 15.5.3 取消与等待

| API                       | 语义                                                             |
| ------------------------- | ---------------------------------------------------------------- |
| `session.abort()`       | 停止当前操作**并等待**会话空闲（等于 abort + waitForIdle） |
| `session.waitForIdle()` | 只等待，不打断                                                   |
| `session.abortRetry()`  | 仅取消"重试等待"（第 6.6 节）                                    |

对照第 6 章：`abort()` 是信号（工具/请求要自行响应）；`waitForIdle()` resolve 的时点 = `agent_settled`（所有收尾完成）。


#### 15.6 释放矩阵：谁在什么时候释放什么

把第 8 章的释放逻辑压缩成宿主视角的清单：

| 步骤 | 动作                                                          | 谁做                                                                                 |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1    | 退订你自己的`unsubscribe()`                                 | 宿主（示例都显式做）                                                                 |
| 2    | 停止在途工作                                                  | `session.dispose()` 内部的 abort 系列（retry/compaction/branchSummary/bash/agent） |
| 3    | 失效扩展上下文                                                | `dispose()` 的 `extensionRunner.invalidate(...)`                                 |
| 4    | 断开 Agent 连接、清空监听器                                   | `dispose()`                                                                        |
| 5    | 取消缓存预热器                                                | `dispose()`                                                                        |
| 6    | （用 runtime 时）发`session_shutdown`、通知宿主、再 dispose | `runtime.dispose()` 内部完成                                                       |

两个常见误区：

- **`dispose()` 不删除会话文件**：磁盘历史归用户管理（第 9 章）；dispose 只处理"进程内资源"；
- **用 runtime 的宿主别"手动 dispose 再 dispose"**：`await runtime.dispose()` 已经包含会话释放；重复调用会话级 API 会命中"旧上下文已失效"的防御。


#### 15.7 实验 L09：写一个 SDK 宿主

**实验性质**：本地运行；建议先用 faux（第 5、18 章）跑无费用版本。
**验证状态**：设计中。任务目标（规划文档 L09）："一个输出流式文本和工具生命周期事件的终端宿主；成功与异常路径都释放 session；分清运行结束、事件回调结束和资源释放。"


##### 规格

一个好宿主应该按顺序打印：

```text
[event] agent_start
[text]  （流式文本，无换行拼接到标准输出）
[tool ]  start read {"path":"..."}
[tool ]  end   read ok
[event] turn_end / agent_end(willRetry=false)
[event] agent_settled
[host ]  disposed
```


##### 步骤

1. 建 `host.ts`（用 `01-minimal` 结构 + 13 章的事件清单）：

```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory() });
const log = (tag: string, text: string) => console.log(`[${tag}] ${text}`);
const unsubscribe = session.subscribe((event) => {
	switch (event.type) {
		case "agent_start": log("event", "agent_start"); break;
		case "message_update":
			if (event.assistantMessageEvent.type === "text_delta") process.stdout.write(event.assistantMessageEvent.delta);
			break;
		case "tool_execution_start": log("tool ", `start ${event.toolName} ${JSON.stringify(event.args)}`); break;
		case "tool_execution_end": log("tool ", `end   ${event.toolName} ${event.isError ? "ERROR" : "ok"}`); break;
		case "agent_end": log("event", `agent_end(willRetry=${event.willRetry})`); break;
		case "agent_settled": log("event", "agent_settled"); break;
	}
});

try {
	await session.prompt("读取 README.md 的第一段并总结");
} catch (error) {
	log("host ", `prompt failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
	unsubscribe();
	session.dispose();
	log("host ", "disposed");
}
```

2. **成功路径**：运行并核对顺序（`agent_end` 在 `agent_settled` 之前；`disposed` 最后）；
3. **异常路径**：把 prompt 换成"调用一个必然失败的工具"（或用不存在的模型/取消），确认 catch/finally 都执行、`disposed` 一定出现；
4. **取消路径**：在 `tool_execution_start` 后调用 `session.abort()`（用 setTimeout 或事件内触发），确认 run 以 `aborted` 收尾且 finally 生效；
5. **三个"结束"对号入座**：
   - **运行结束** = `agent_end`（可能因重试出现多次）；
   - **事件回调结束** = `agent_settled`（所有 await 的监听器与收尾完成）；
   - **资源释放** = `dispose()` 之后（`disposed` 日志）。


##### 观察与思考

- 如果监听器是 `async` 且很慢，`agent_settled` 会被推迟到什么位置？（提示：监听器被 await）
- 取消实验中，工具侧收到 `signal` 了吗？把它传给一个"等待信号"的工具验证。
- 不用 `SessionManager.inMemory()` 时，dispose 之后磁盘上留下了什么？（对照第 9 章）


##### 清理

删除临时宿主脚本与实验会话；`git status` 干净。


#### 15.8 常见错误

| 现象                                              | 原因                                                         | 处理                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 流式中`prompt()` 抛 "specify streamingBehavior" | 没表态 steer/followUp                                        | 传`streamingBehavior` 或改用 `steer()/followUp()`                                   |
| 宿主退出后进程不结束                              | 会话/预热器未释放                                            | `finally { session.dispose(); }`（runtime 用 `runtime.dispose()`）                  |
| 恢复历史后模型"看不见"旧消息                      | 用赋值`agent.state.messages` 而不是带条目的 SessionManager | 按`sdk.md` 警告：用 SessionManager 构造会话                                           |
| `session.messages` 与文件不一致                 | 前者是投影，后者（条目树）才是事实来源                       | 用`SessionManager`/`buildSessionContext` 的概念读状态（第 9 章）                    |
| 改了系统提示没生效                                | 用的是"只读读取"或没 reload loader                           | 通过`DefaultResourceLoader` 的 override 构造，并 `await loader.reload()`            |
| 内联扩展与文件扩展重名冲突                        | 两个都注册了同名工具                                         | 给内联扩展命名 +`replaceable: true`（15.4.7）                                         |
| SDK 里 codemode/MCP 工具不存在                    | SDK 不默认加载它们                                           | 加`createCodemodeExtension()` 等 + `defaultTools` `+` 语法 + `bindExtensions()` |
| 监听器重复触发                                    | 换会话/替换后没重绑或没退订                                  | 订阅与退订成对；runtime 场景按第 8.6 节重绑                                             |


#### 15.9 验收题

1. 什么时候该用 SDK、什么时候用第 16 章的 CLI 集成？各举一个场景。
2. 说出 `dispose()` 的四件事；为什么它不删除会话文件？
3. `session.messages` 与 `SessionManager` 的关系？"恢复外部历史"的正确做法？
4. 流式期间发送新输入的两种方式与返回值语义？
5. `agent_end`、`agent_settled`、`dispose()` 完成，三者分别代表什么？顺序如何？
6. 写出一个"完全关闭资源发现"的 `ResourceLoader` 需要实现哪些方法（按 15.4.6 的清单）？
7. SDK 里要启用 codemode/MCP 需要哪四步？


##### 参考答案（要点）

1. 需要进程内细粒度控制/注入组件（编辑器插件、测试宿主、自研工具）用 SDK；语言无关或需要进程隔离（Python 调用、容器化自动化）用 print/JSON/RPC。
2. abort 在途工作（重试/压缩/分支摘要/bash/agent）、失效扩展上下文、断开 Agent 连接、移除事件监听器。它只管进程内资源；会话文件属于用户数据。
3. `session.messages` 是 `SessionManager` 条目树的一次投影；恢复外部历史应构造包含这些条目的 SessionManager 再建会话，赋值 `agent.state.messages` 不会替换持久化上下文。
4. `prompt(..., {streamingBehavior})` 或 `steer()/followUp()`；返回 `"queued"`（已入队，可能被扩展改写）或 `"handled"`（被扩展消费）。
5. `agent_end` = 循环结束（可多次，重试场景）；`agent_settled` = 会话级收尾完成（监听器被 await 完）；`dispose()` 完成 = 进程内资源释放。顺序：agent_end → agent_settled → dispose。
6. `getExtensions`、`getSkills`、`getPrompts`、`getThemes`、`getAgentsFiles`、`getSystemPrompt`、`getSystemPromptSource`、`getAppendSystemPrompt`、`getAppendSystemPromptSources`、`extendResources`、`reload`。
7. ① 把 `createCodemodeExtension()`/`createToolSearchExtension()`/`createMcpExtension()` 加进 `DefaultResourceLoader` 的 `extensionFactories`；② 用 `defaultTools` 的 `+codemode`/`+tool_search` 启用（或交给 MCP 扩展激活）；③ 调 `session.bindExtensions()` 让 MCP 在 `session_start` 连接；④ 参考 `14-codemode-mcp.ts`。


#### 15.10 源码依据

- `packages/coding-agent/docs/sdk.md`（生命周期、存储、提示、订阅、配置、内联与 builtin、codemode/MCP、示例索引）；
- SDK 示例：`01-minimal.ts`、`02-custom-model.ts`、`03-custom-prompt.ts`、`04-skills.ts`、`05-tools.ts`、`06-extensions.ts`、`07-context-files.ts`、`08-prompt-templates.ts`、`09-api-keys-and-oauth.ts`、`10-settings.ts`、`11-sessions.ts`、`12-full-control.ts`、`13-session-runtime.ts`、`14-codemode-mcp.ts`（`examples/sdk/`，全部随仓库做类型检查）。


---

### 第 16 章：Print、JSON 与 CLI RPC

**先懂这一章**：当另一个程序调用 pi 时，先选“只要最终文本”“要事件流”还是“要持续双向控制”。JSONL 是按行发送的记录；读管道时先攒到完整的一行，再解析记录和请求 ID。

```text
教学伪代码：读入字节片段 → 缓存未完成的一行
           → 每拿到完整行就解析一条 JSON 记录
           → 按记录类型与请求 ID 分发给等待者
```

这是协议读取器的概念图；print 模式不用解析 JSONL，RPC 还要处理关闭、取消和异步完成通知。

第 15 章的 SDK 宿主与 pi 处于同一 Node 进程；本章的调用者隔着进程边界。先选模式，再讨论 JSONL 的逐行解析与 RPC 的请求关联；第 17 章回到交互模式的终端界面。

> 学完本章你能回答：
>
> 1. 四种前端模式（interactive/print/json/rpc）各自适合什么场景？
> 2. print 模式的成功/失败如何判定？退出码的规则是什么？
> 3. JSON 事件流的"严格 JSONL"具体严格在哪？为什么不能用 `readline`？
> 4. RPC 协议的四类记录是什么？`id` 相关、`prompt` 响应语义、完成信号分别怎么用？
> 5. 流式管道为什么要"按行重组"？分片、背压、Unicode 分隔符各有什么坑？

**预计学习时间**：1.5 天。
**本章验证状态**：静态核对通过（`cli-integration.md`、`json.md`、`rpc.md`、`rpc-client.ts` 逐个核对）；实验 L10 设计中。

---


#### 16.1 四种模式：选哪个

`cli-integration.md` 的总表（原文翻译）：

| 模式        | 输入/输出接口          | 生命周期     | 适用               |
| ----------- | ---------------------- | ------------ | ------------------ |
| Interactive | 终端 UI                | 直到用户退出 | 人类直接使用       |
| Print       | stdout 输出最终文本    | 一次性       | 脚本只要最终回答   |
| JSON        | stdout 输出 JSONL 事件 | 一次性       | 程序需要结构化进度 |
| RPC         | JSONL 命令/响应/事件   | 长驻         | 程序需要双向控制   |

**四种模式共用同一套 agent、会话、资源与工具**（`cli-integration.md` 原话）——模式只决定"输入如何进入、输出如何暴露、进程是否继续存活"。这条与第 3 章的"入口不同、内核相同"完全呼应。

三条选择经验：

- 只要"答案"→ print；要"过程"→ JSON；要"边跑边聊"→ RPC；要进程内细粒度 → SDK（第 15 章）；
- 语言无关或需要进程隔离 → JSON/RPC；
- Node/TS 且不需隔离 → SDK（`RpcClient` 是"子进程 + TypeScript 类型"的折中，16.6 节）。


#### 16.2 Print 模式：一次性，最终文本

```bash
pi --print "Summarize the changes in this repository"
```

规则（`cli-integration.md`）：

- **只暴露最终助手文本**：中间事件不可见；
- **错误写 stderr**：stdout 只留最终文本，可安全用于命令替换与管道；
- **退出码**：最终响应 `stopReason` 为 `error` 或 `aborted` → **非零退出**；其他错误（抛异常等）也会非零；
- **管道自动降级**：没有显式选模式时，stdin 或 stdout 非 TTY → 自动 print 模式（第 2.8 节的 `resolveAppMode`）。所以 `git diff | pi "review"` 这类用法不需要 `--print`。

一个组合示例（把答案直接喂给下一步）：

```bash
ANSWER=$(pi --print "List the npm scripts in this repo, comma separated")
echo "$ANSWER"
```


#### 16.3 JSON 模式：一次性事件流

```bash
pi --mode json "Review this repository" > events.jsonl
```

**它不是"一个 JSON 结果"**，而是**事件流**（`json.md` 开头的强调）；流的第一行是**会话头**（与第 4.7 节的 `SessionHeader` 相同）：

```json
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path"}
```

完整的一次运行长这样（`json.md` 示例）：

```json
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"user","content":"Review this repository","timestamp":1733234401000}}
{"type":"message_end","message":{"role":"user","content":"Review this repository","timestamp":1733234401000}}
{"type":"message_start","message":{"role":"assistant","content":[],"stopReason":"pending"}}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hello"}}
{"type":"message_end","message":{"role":"assistant","stopReason":"stop"}}
{"type":"turn_end","message":{"role":"assistant"},"toolResults":[]}
{"type":"agent_end","messages":[...],"willRetry":false}
{"type":"agent_settled"}
```

三个关键语义：

1. **进程在 prompt 跑完后就退出**，不再接受新命令（`cli-integration.md`：All prompts are supplied when the process starts）；
2. **失败的响应会出现在事件流里，但不自动导致非零退出**——只有"调用本身抛错"才非零。**要判断成败，读事件**（比如看 `message_end` 的 `stopReason`）；
3. **`agent_end` 不是终点**：重试/溢出恢复/压缩/排队可能继续；**`agent_settled` 才是**"不会再自动继续"的信号。


##### 16.3.1 严格 JSONL：五条硬规则

`json.md` 的 "Framing and process I/O" 是必须背下来的规格：

```text
1. 每条记录是一个 JSON 对象，以 LF（\n）结尾；
2. 只在 LF 上拆记录，允许剥掉前面的可选 CR（兼容 CRLF）；
3. Unicode 行分隔符（U+2028）与段分隔符（U+2029）在 JSON 字符串里合法，不是记录边界；
4. 使用字节流/UTF-8 解码器并只在 LF 处切分；仓库 `json.md` 声称 Node.js readline 还识别 U+2028/U+2029，
   但 Node v23.9.0 官方 readline 文档只列出 `\n`、`\r`、`\r\n`，未证实这一额外行为；
5. stdout 持续读——不读会让管道缓冲填满，卡死 Pi；stdout 专用于 JSONL，诊断与日志走 stderr。
```

第 4、5 条是"听起来小题大做、踩过就懂"的坑：

- U+2028/U+2029 是 JSON 字符串中合法的字符，因此协议仍要求只按 LF 分帧；不要仅凭仓库注释断言 Node `readline` 会在这两个字符处拆行。
- "读得慢"不是小问题：操作系统管道缓冲区有限，客户端停止消费，Pi 的写就会阻塞（背压），表现为"Pi 卡住了"。


##### 16.3.2 `message_update` 的线上格式：只有增量

这是 JSON/RPC 与 SDK 的**唯一序列化差异**（`json.md`）：

```text
Wire `message_update` records are delta-only. They omit the SDK event's cumulative `message`
field and every `assistantMessageEvent.partial` snapshot so stream size remains linear.
```

也就是说：

- SDK 事件里每条 `message_update` 都带"整条部分消息"（第 3.9 节）；
- **线上格式删掉了累积字段**，只留增量（`delta`）与元数据——否则流的大小会随消息长度**平方级**增长；
- 附带一个小扩展：`toolcall_start` 在线上**多了 `id` 与 `toolName`**（`JsonAssistantMessageEvent` 类型里能看到）：

```typescript
type JsonAgentSessionEvent =
  | Exclude<AgentSessionEvent, { type: "message_update" }>
  | {
      type: "message_update";
      usage: Usage;
      assistantMessageEvent: JsonAssistantMessageEvent<AssistantMessageEvent>;
    };
```


##### 16.3.3 重建规则（客户端必读）

`json.md` 给了权威重建指南：

- **用 `contentIndex` 定位内容块**（同一条消息可能有多个块：文本、思考、工具调用）；
- `delta` 缓冲起来做**实时显示**；到了 `text_end` / `thinking_end` / `toolcall_end`，用它们的**权威内容**替换你的拼装结果；
- `message_end.message` 到达时，**整条部分消息被它替换**（它是最终事实）；
- `usage` 是"目前为止的最新累计值"；有些供应商流式期间不给用量，完成前一直是 0；
- `toolcall_delta` 里是**序列化参数的分片**（拼装后才能得到完整 `ToolCall`；`toolcall_end` 直接给完整对象）。

一句话：**流是给"快速显示"的，终态消息是给"正确性"的**——两者都要，别只信其一。


#### 16.4 事件参考合订（JSON 与 RPC 共用）

`json.md` 是两种模式共用的规范；把需要的表集中到此（与第 4 章的 SDK 事件对照读）。


##### 16.4.1 Agent / Turn / Message

| 事件                                | 字段                                 | 含义                                        |
| ----------------------------------- | ------------------------------------ | ------------------------------------------- |
| `agent_start`                     | 无                                   | 低层 run 开始                               |
| `agent_end`                       | `messages`、`willRetry`          | 低层 run 结束（可能还有后续）               |
| `agent_settled`                   | 无                                   | 不会再有自动继续（重试/恢复/队列都空了）    |
| `turn_start` / `turn_end`       | `message`、`toolResults`         | 一个轮次开始/结束                           |
| `message_start` / `message_end` | `message`                          | 消息开始/完成（`message_end` 是权威终态） |
| `message_update`                  | `usage`、`assistantMessageEvent` | 见 16.3.2/16.3.3                            |


##### 16.4.2 工具与队列/状态

| 事件                       | 字段                                   | 含义                                                 |
| -------------------------- | -------------------------------------- | ---------------------------------------------------- |
| `tool_execution_start`   | `toolCallId`、`toolName`、`args` | 工具开始（用`toolCallId` 关联整个生命周期）        |
| `tool_execution_update`  | 同上 +`partialResult`                | 部分结果（替换还是追加取决于工具契约）               |
| `tool_execution_end`     | 同上 +`result`、`isError`          | 工具结束                                             |
| `queue_update`           | `steering`、`followUp`             | 排队变化（字段是**完整当前队列**）             |
| `entry_appended`         | `entry`                              | 部分辅助写入路径主动发布条目；不是所有落盘记录的通知 |
| `session_info_changed`   | `name`（缺省=被清除）                | 会话名变化                                           |
| `thinking_level_changed` | `level`                              | 思考级别变化                                         |


##### 16.4.3 压缩与重试

```json
{"type":"compaction_start","reason":"threshold"}
{"type":"compaction_end","reason":"threshold","result":{"summary":"...","firstKeptEntryId":"abc123","tokensBefore":150000,"estimatedTokensAfter":32000,"usage":{...},"details":{}},"aborted":false,"willRetry":false}
{"type":"auto_retry_start","attempt":1,"maxAttempts":3,"delayMs":2000,"errorMessage":"529 overloaded"}
{"type":"auto_retry_end","success":true,"attempt":2}
{"type":"summarization_retry_scheduled","attempt":1,"maxAttempts":3,"delayMs":2000,"errorMessage":"terminated"}
{"type":"summarization_retry_attempt_start","source":"compaction","reason":"threshold"}
{"type":"summarization_retry_finished"}
```

- `compaction_end`：`aborted: true` → 无 `result`；失败 → 无 `result` 且有 `errorMessage`；**溢出恢复成功后 `willRetry: true`**（第 10.5 节）；
- 重试事件直接对应第 6.6 节的状态机——客户端可以直接把它们渲染成"正在重试（第 N 次）"。


##### 16.4.4 RPC 专属事件

| 事件                      | 含义                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bash_execution_update` | RPC`bash` 命令的每次输出块（`id` 对应命令 id；**流式全量**，而最终响应里的输出可能被截断） |
| `extension_error`       | 扩展处理器抛错（含`extensionPath`、`event`、`error`）                                          |
| Extension UI 记录         | 独立子协议（16.5.5），**不是** `AgentSessionEvent`                                           |

TypeScript 侧用导出的 `JsonAgentSessionEvent` 类型（`json.md` 给出定义）；实现位于 `modes/json-event.ts`。

#### 16.5 RPC 模式：长驻双向协议

```bash
pi --mode rpc --no-session
```

适用（`rpc.md` 开篇）：语言无关集成、进程隔离、IDE、自定义 UI。它与 SDK 的对照表：

| 接口 | 进程边界 | 控制模型                   | 最适合                                |
| ---- | -------- | -------------------------- | ------------------------------------- |
| SDK  | 同进程   | 直接 TypeScript 方法与事件 | 想要完整 API 的 Node/Bun 宿主         |
| RPC  | 子进程   | JSONL 命令/响应/事件       | 其他语言、隔离进程、IDE、自定义客户端 |

启动选项与普通 CLI 相同（`--provider`、`--model`、`--session-dir` 等照常生效）；**唯一硬限制：拒绝 `@file` 参数**——提示词请走 `prompt` 命令。


##### 16.5.1 四类记录

| 方向   | 记录                | 用途                                         |
| ------ | ------------------- | -------------------------------------------- |
| stdin  | Command             | 要求 pi 执行一次提示、查状态、改配置、管会话 |
| stdout | `response`        | 某条命令是否成功、带什么数据                 |
| stdout | Session event       | 运行/消息/工具/队列/压缩/重试的动态流        |
| 双向   | Extension UI record | 扩展交互的独立子协议（16.5.5）               |


##### 16.5.2 `id` 关联：别用"响应顺序"配命令

```json
{"id":"req-1","type":"get_state"}
{"id":"req-1","type":"response","command":"get_state","success":true,"data":{"...":"..."}}
```

规则（`rpc.md`）：

- 命令可带**可选字符串 `id`**；对应响应**原样带回**；
- **命令处理是异步的**——只要可能有多个命令并行，就必须按 `id` 关联，不要假设响应按发送顺序返回；
- **会话事件一般没有命令 id**（它们描述会话活动）；唯一的例外是 `bash_execution_update`（对应 `bash` 命令的 id）；
- `extension_ui_response` 用它收到的请求 id，**不是**普通命令响应。


##### 16.5.3 `prompt` 响应的语义：接受 ≠ 完成

```json
{"id":"req-2","type":"prompt","message":"Review this repository"}
{"id":"req-2","type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}
```

`data.disposition` 说明这条提示词的去向；关键分支：

- `"started"`：新的 run 已开始；
- `"queued"`：已入队（steering/follow-up）；
- `"handled"`：被扩展/命令消费——**不会启动 run，别等 `agent_settled`**。

完成信号仍是第 6 章的约定：`agent_end` 只是一个低层 run 结束；**要等 `agent_settled`**（重试、恢复、压缩、队列都清零）。

**订阅先于发送**：客户端的"完成等待"如果靠事件实现，必须在**发送 prompt 之前**装好监听器，否则快速完成会丢事件。`rpc.md` 专门点名 `RpcClient.promptAndWait()` 在内部就是这么做的；手写客户端若分两步调用，"先订阅、且只在 run 活动期间 `waitForIdle()`"。


##### 16.5.4 错误：三种来源分开处理

| 来源                          | 表现                                                                                       | 处理                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| 命令级失败                    | 一条`success: false` + `error` 的响应                                                  | 按 id 关联后向用户报错                                     |
| JSON 解析失败                 | **没有 request id** 的 `{"type":"response","command":"parse","success":false,...}` | 记录并跳过（说明写坏了协议）                               |
| 运行期失败（供应商错误/取消） | 出现在 message/event 流里                                                                  | 解析事件（如`message_end.stopReason`、`auto_retry_*`） |

还要自理的（协议之外的工程问题）：**子进程启动失败、意外退出、stderr 诊断、取消、以及你自己的超时/截止时间**。一条铁律：**不要把 stderr 当协议解析**——它是给人看的日志。


##### 16.5.5 扩展 UI 子协议（一句话版）

扩展的对话框/通知在 RPC 下走独立的请求-响应子协议（`rpc-extension-ui.md`）：对话框是"请求→等待响应"，其它通知是"可显示可忽略"。终端专属能力（自定义组件）在 RPC 下不可用或降级——这与第 13.6 节的模式能力矩阵一致。


##### 16.5.6 关停：关 stdin

```text
Close the child's stdin to request an orderly shutdown. Pi disposes the active runtime before
exiting. Clients should still handle process signals and unexpected exits.
```

- **优雅关停 = 关 stdin**；pi 会先 dispose 运行时（第 8 章）再退出；
- 扩展也可以请求 shutdown；pi 会在"当前命令完成"或"活动 run 发出 `agent_settled`"后执行；
- 客户端仍要处理信号与意外退出（别假设每次都能优雅）。


##### 16.5.7 命令面一览（以 `rpc-commands.md` 为准）

从锚点清单能看出 RPC 的控制面（读全表在 `rpc-commands.md`）：

```text
提示与运行：prompt、steer、follow_up、abort、clear_queue
会话：new_session、switch_session、fork、clone、get_fork_messages、get_entries、get_tree
状态：get_state、get_messages、get_session_stats、get_last_assistant_text、get_commands
模型：set_model、cycle_model、get_available_models
思考：set_thinking_level、cycle_thinking_level、get_available_thinking_levels
队列策略：set_steering_mode、set_follow_up_mode
压缩与重试：compact、set_auto_compaction、set_auto_retry、abort_retry
命令执行：bash、abort_bash
导出与命名：export_html、set_session_name
```

**该表就是你写 IDE 插件时的全部"遥控器"**——每一项都能在第 3、6、8、9、10 章找到对应实现。


#### 16.6 `RpcClient`：TypeScript 世界的推荐入口

自己处理子进程、分帧、关联与关停很容易出坑。仓库为 Node/TS 提供了带类型的客户端（`rpc.md` 与 `examples/rpc-client.ts`）：

```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const prompt = process.argv.slice(2).join(" ") || "Explain this repository in one paragraph.";

const client = new RpcClient({
	cliPath: join(exampleDirectory, "../dist/cli.js"),   // 必须指向"可运行的 CLI"
	args: ["--no-session"],
});

const unsubscribe = client.onEvent((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	} else if (event.type === "tool_execution_start") {
		process.stderr.write(`\n[tool: ${event.toolName}]\n`);
	}
});

try {
	await client.start();
	await client.promptAndWait(prompt);       // 内部先装监听、再发 prompt、等到 settled
	process.stdout.write("\n");
} finally {
	unsubscribe();
	await client.stop();                      // 关子进程
}
```

三个使用要点：

1. **`cliPath` 指向构建产物**：示例指向 `dist/cli.js`，所以"从源码仓库直接跑这个示例"前要先构建（`examples/README.md` 也提醒了）；分发场景通常指向 npm 安装后的路径或 `pi` 可执行包装；
2. **`promptAndWait` 消灭竞态**：它先装监听器再发命令（16.5.3 的纪律被封装];
3. **退订 + `stop()` 成对**：与第 15 章的释放纪律一致。

使用边界：`promptAndWait()` 适用于会启动 Agent run 的普通 prompt。它先订阅 `agent_settled`，再调用 `prompt()`，避免快速完成时漏事件；但若扩展命令或 input hook 返回 `handled`，就不会有新的 `agent_settled`，该 helper 仍会等到 timeout。若输入可能被消费，请直接 `await client.prompt(...)` 并检查 `disposition`，只对 `started`（或确定会产生已有 run 收束的 `queued`）等待完成。preflight reject 时，当前 helper 也不会主动取消它已经建立的事件等待；精确实现边界见 D12 客户端生命周期。


#### 16.7 协议硬知识：按行重组与背压

无论你用什么语言写客户端，"读 stdout"都必须按下面的伪代码做：

```text
buffer = ""
loop:
	chunk = read()                 # 任意长度：可能是半行、几行、甚至半个 UTF-8 字符
	buffer += decode(chunk)        # 用流式解码器（UTF-8 跨 chunk 的字节要缓住）
	while LF in buffer:
		line, buffer = split_at_first_LF(buffer)
		line = strip_trailing_CR(line)
		record = JSON.parse(line)  # 单条必须是完整 JSON
		handle(record)
# 进程退出时 buffer 必须为空（否则最后一条记录被截断）
```

对照四类常见错误：

| 错误做法                             | 后果                                        |
| ------------------------------------ | ------------------------------------------- |
| 每个 chunk 直接`JSON.parse(chunk)` | 分片/多行都会失败                           |
| 用`readline` / `splitlines()`    | U+2028/U+2029 被当行边界，偶尔炸            |
| 忽略残留在 buffer 的最后一段         | 最后一条记录（可能是`agent_settled`）丢失 |
| 用文本模式转换换行（CRLF→LF）       | 破坏协议字节；应二进制读、只剥行尾 CR       |

**背压（backpressure）双向成立**：

- **读端**：不持续读 stdout → pi 的写阻塞（表现为"卡住"）——`json.md`/`rpc.md` 都点名；
- **写端**：发命令太多太快也要尊重 stdin 背压（等 `write` 的回调/`drain`）。

**stdout/stderr 严格分流**：stdout 只放协议；所有日志、警告、诊断看 stderr。你调试自己的客户端时，也把日志写 stderr——否则会污染自己的解析。


#### 16.8 实验 L10：分片输入与子进程结束

**实验性质**：本地运行；可用 faux/--no-env 控制成本；不要求真实模型。
**验证状态**：设计中。目标（规划文档 L10）："分片 JSONL 与子进程结束 → 可解析的协议轨迹"。


##### 步骤

1. **起一个 RPC 子进程**。源码运行：

   - Windows PowerShell：`.\pi-test.ps1 --mode rpc --no-session`
   - Linux/macOS/Git Bash：`./pi-test.sh --mode rpc --no-session`

   （你的宿主程序负责 spawn；命令行先手动验证启动输出是否只有一行行 JSON。）
2. **写最小宿主**（Node 或 Python 均可）：按 16.7 的伪代码实现"缓冲 + 只在 LF 切分"，**故意用 64 字节读取**让分片真实发生；
3. **发命令并等完成**：

```json
{"id":"p1","type":"prompt","message":"列出当前目录的前三个文件"}
```

   记录并核对轨迹：`response(id=p1, success=true)` → `message_update(text_delta...)` → …… → `agent_end` → `agent_settled`；

4. **模拟慢读者**：解析到第一个 `text_delta` 后 `sleep 2s` 再继续读，观察是否仍能跑完（小输出通常没事；理解"卡住"发生的条件即可）；
5. **异常退出**：中途 `kill` 子进程，确认宿主能捕获退出并报告（而不是永远等）；
6. **优雅关停**：关闭子进程 stdin，确认 pi 正常退出（退出码 0），且最后 `buffer` 为空；
7. **验证解析器**：把 16.7 的四类错误各犯一次（改用 `readline`、按 chunk 解析等），观察失败方式——亲手见过才会在真实项目里避开。


##### 观察与思考

- 你的实现里，`agent_end` 之后是否仍可能收到记录？（重试/恢复场景）
- `prompt` 响应 `disposition: "handled"` 时，你为什么不该等 `agent_settled`？
- 如果把日志 `console.log` 混进 stdout 会发生什么？（对照第 2 章的 `takeOverStdout`）


##### 清理

终止所有实验子进程；删除宿主脚本；`git status` 干净。


#### 本章源码精读

> **源码精读**：先定位导出与函数签名，再沿调用点核对输入、状态、输出和错误；最后用本篇指定的离线实验验证。

D12 把本章的 print、JSON、RPC 模式追到事件整形、JSONL 分帧、客户端等待与关停。先比较协议的数据形状，再跟踪一个输入和一个响应，不要把 CLI RPC 与第 24 章的实验服务协议混为一谈。



##### D12：三种输出模式的协议层精读（JSON 事件整形、JSONL、print/RPC）

**先懂**：同一运行事件可以显示给人，也可以写成机器可读的 JSON 行。先理解“内部事件怎样变成外部记录”，再看 print、JSON 与 RPC 各自怎样使用这些记录。

```text
教学伪代码：收到内部事件 → 选出可公开的字段
           → 编码为一条 JSONL 记录
           → 按运行模式写出、等待命令或只返回最终文本
```

print 文本输出不等于 JSONL；RPC 还要关联请求、响应和异步事件。

> 精读对象：`modes/json-event.ts`、`modes/rpc/jsonl.ts`、`modes/print-mode.ts`、`modes/rpc/rpc-types.ts`、`modes/rpc/rpc-mode.ts`、`modes/rpc/rpc-client.ts`。
> 对应主线：第 16 章（Print、JSON 与 CLI RPC）。
> 读法：先读"整形三件套"（事件 → JSON 事件 → JSONL 行），再读三个模式怎么用它（print/json/rpc），最后读客户端。

---


###### 0. 整形流水线：同一事件，两种去向

```mermaid
flowchart LR
  S[AgentSessionEvent<br/>内存里的富事件] --> J[toJsonEvent<br/>去掉累积快照]
  J --> W[serializeJsonLine<br/>JSON + \n]
  W --> O[writeRawStdout<br/>raw 写 + 背压等待]
  O --> P[print/json 进程的 stdout / RPC 的 stdout]
```

【陷阱】整形发生在**每一个订阅回调里**（`session.subscribe((event) => writeRawStdout(serializeJsonLine(toJsonEvent(event))))`）——**同步、单条、逐事件**；没有批量缓冲（正确性优先；背压靠独立的等待机制，见第 4 节）。

---


###### 第一部分：`json-event.ts` 与 `jsonl.ts`


##### 1. `json-event.ts`：把"富事件"压成"瘦事件"


###### 1.1 类型层的三个变换

【源码（完整）】

```typescript
// WithoutPartial<T>：条件类型——"如果 T 有 partial 字段，就 Omit 掉它；否则保持原样"
type WithoutPartial<T> = T extends { partial: unknown } ? Omit<T, "partial"> : T;

type ToJsonAssistantMessageEvent<T> = T extends { type: "toolcall_start"; partial: unknown }
	? WithoutPartial<T> & { id: string; toolName: string }
	: WithoutPartial<T>;

// JsonAgentSessionEvent = Exclude<AgentSessionEvent, {message_update}> | JsonMessageUpdateEvent：只有 message_update 被替换成瘦版本，其余事件原样（通知类事件的载荷都不大）
type MessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;
type JsonMessageUpdateEvent = {
	type: "message_update";
	usage: Usage;
	assistantMessageEvent: ToJsonAssistantMessageEvent<MessageUpdateEvent["assistantMessageEvent"]>;
};

/** Session event shape emitted by the JSON and RPC stdout protocols. */
// 这三个类型是纯类型层（type 声明）——运行时只体现在下面的函数里
export type JsonAgentSessionEvent = Exclude<AgentSessionEvent, { type: "message_update" }> | JsonMessageUpdateEvent;
```

【注解】

- `WithoutPartial<T>`：**条件类型**——"如果 T 有 `partial` 字段，就 Omit 掉它；否则保持原样"。`AssistantMessageEvent` 家族里**每个成员都带 `partial`**（第 4.2 节），所以实际效果=统一去掉快照。
- `ToJsonAssistantMessageEvent`：在去快照的基础上，**`toolcall_start` 额外加 `id` 与 `toolName`**——【陷阱】为什么单独给它？因为线上格式删掉了 `partial`，而流式消费方在 `toolcall_start` 时**需要知道"这是哪个工具调用"**（后续 `toolcall_delta` 只带 `contentIndex` 与分片参数）；id/name 是**常量大小**的补偿信息（下面函数注释原话："Cumulative usage, tool-call ids, and tool names remain available because their size is constant."）。
- `JsonAgentSessionEvent = Exclude<AgentSessionEvent, {message_update}> | JsonMessageUpdateEvent`：**只有 `message_update` 被替换成瘦版本**，其余事件原样（通知类事件的载荷都不大）。
- 【陷阱】这三个类型是**纯类型层**（`type` 声明）——运行时只体现在下面的函数里。读第 16 章的 `JsonAgentSessionEvent` 时别去运行时找"哪一步 Omit 了 partial"——是**编码函数逐事件构造**的结果，类型只是对同一事实的静态描述。


###### 1.2 运行时：`toJsonAssistantMessageEvent` 与 `toJsonEvent`

【源码（完整）】

```typescript
function toJsonAssistantMessageEvent(
	event: MessageUpdateEvent["assistantMessageEvent"],
): JsonMessageUpdateEvent["assistantMessageEvent"] {
	if (event.type === "toolcall_start") {
		// 去掉累计快照前先保留工具 id 和名称，供 JSONL 消费端关联后续增量。
		const toolCall = event.partial.content[event.contentIndex];
		if (toolCall?.type !== "toolCall") {
			throw new Error(`toolcall_start content at index ${event.contentIndex} is not a tool call`);
		}
		const { partial: _partial, ...deltaEvent } = event;
		return { ...deltaEvent, id: toolCall.id, toolName: toolCall.name };
	}

	if (!("partial" in event)) {
		return event;
	}

	const { partial: _partial, ...deltaEvent } = event;
	return deltaEvent;
}
```

```typescript
/**
 * Remove cumulative assistant snapshots from streaming wire events.
 * `message_start` provides the initial message, deltas build it, and
 * `message_end` provides the final authoritative message. Cumulative usage,
 * tool-call ids, and tool names remain available because their size is constant.
 */
export function toJsonEvent(event: MessageUpdateEvent): JsonMessageUpdateEvent;
export function toJsonEvent(event: AgentSessionEvent): JsonAgentSessionEvent;
export function toJsonEvent(event: AgentSessionEvent): JsonAgentSessionEvent {
	if (event.type !== "message_update") {
		return event;
	}
	if (event.message.role !== "assistant") {
		throw new Error("message_update message is not an assistant message");
	}

	return {
		type: "message_update",
		usage: event.message.usage,
		assistantMessageEvent: toJsonAssistantMessageEvent(event.assistantMessageEvent),
	};
}
```

【注解（四个决策）】

1. **`toolcall_start` 的校验 + 提取**：
   - 从 `event.partial.content[event.contentIndex]` 拿"该内容块"——**假设内容索引对齐**（partial 是累积快照，索引就是块位置）；
   - 不是 `toolCall` 块 → **抛错**（"不该发生"的内部不变量：`toolcall_start` 事件必须对应一个 toolCall 块）；【陷阱】这个 throw 发生在**事件编码层**——它会怎样冒泡？看调用方（subscribe 回调 → 编码 → 写 stdout）；**一个坏事件会打断整条输出**（而非静默输出坏数据）——符合"宁可大声失败"（对比第 2.4.1 节）。正常流程不会触发（供应商适配器的契约）。
   - 解构 `const { partial: _partial, ...deltaEvent } = event;`——**用解构做"剔除字段"**（第 D3 的 `withToolChanges` 同款手法）；`_partial` 命名以 `_` 开头表示"故意不用"（本仓库惯例）。
   - 返回 `{ ...deltaEvent, id, toolName }`——**补偿两个常量字段**。
2. **没有 `partial` 字段的事件**：直接原样返回（`if (!("partial" in event)) return event;`）——【陷阱】类型上说所有成员都有 `partial`，运行时却检查"in"——这是对**跨版本/构造来源不确定**的防御（事件可能由扩展手工构造？至少类型层允许）；多一行检查换稳健。
3. **`toJsonEvent` 的守卫**：`message_update` 的消息必须`role === "assistant"`（否则 throw）——同款内部不变量。
4. **`usage` 从哪来**：`event.message.usage`（**部分消息的累积用量**）——线上 `message_update` 的顶层 `usage` 字段（第 16.3.3 节的"最新的累积用量"）。注意它**不在瘦事件里重复 assistantMessageEvent 的字段**，而是**提到事件顶层**——结构化后"恒定的统计"与"变动的增量"分层（设计意图与注释一致）。

- 【陷阱】**重载签名**：两个 `toJsonEvent` 重载让"传 `message_update` 精确类型 → 返回精确瘦类型"成为类型事实；调用方（print-mode 的 subscribe）拿到的是**窄化后的联合**——写客户端消费代码时可以据此做穷尽收窄。

---


##### 2. `jsonl.ts`：LF-only 的分帧（服务端与客户端共用）


###### 2.1 `serializeJsonLine`

【源码】

```typescript
/**
 * Serialize a single strict JSONL record.
 *
 * Framing is LF-only. Payload strings may contain other Unicode separators such as
 * U+2028 and U+2029. Clients must split records on `\n` only.
 */
export function serializeJsonLine(value: unknown): string {
	// 一行 = JSON.stringify + LF（绝不用 \r\n）
	return `${JSON.stringify(value)}\n`;
}
```

【注解】

- 一行 = `JSON.stringify` + **LF**（绝不用 `\r\n`）。
- 注释把"为什么强调 LF-only"写给了客户端（第 16.3.1 节的五条硬规则之一在**生产端**的复述）；U+2028/U+2029 可出现在 JSON 字符串中，协议分帧仍只认 `\n`。Node v23.9.0 官方 `readline` 文档只列出 `\n`、`\r`、`\r\n`，未证实源码注释所说的额外 Unicode 分隔符行为。


###### 2.2 `attachJsonlLineReader`：跨块的"按行重组"服务端实现

【源码（完整）】

```typescript
/**
 * Attach an LF-only JSONL reader to a stream.
 *
 * This intentionally does not use Node readline. Readline splits on additional
 * Unicode separators that are valid inside JSON strings and therefore does not
 * implement strict JSONL framing.
 */
export function attachJsonlLineReader(stream: Readable, onLine: (line: string) => void): () => void {
	// StringDecoder("utf8")：跨块 UTF-8 解码（半个字符缓存在 decoder 里）——与 OutputAccumulator 的流式解码同族（D7 第 7 节）；协议层与工具输出层各自解决了同一类问题
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	// emitLine：剥掉行尾可选 \r（兼容 CRLF 输入——第 16 章"strip an optional preceding carriage return"的实现处）
	const emitLine = (line: string) => {
		onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	};

	// onData 的 while 循环：一次块里可能有多行/半行——buffer 找 \n、切出、继续；找不到就退出等下一块
	const onData = (chunk: string | Buffer) => {
		buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);

		while (true) {
			const newlineIndex = buffer.indexOf("\n");
			if (newlineIndex === -1) {
				return;
			}

			emitLine(buffer.slice(0, newlineIndex));
			buffer = buffer.slice(newlineIndex + 1);
		}
	};

	// onEnd flush 残帧（decoder.end() + 非空 buffer 也 emit）——第 16.7 节的"退出时 buffer 必须为空"在实现里的对应：最后一条没有 \n 的行也会被交付
	const onEnd = () => {
		buffer += decoder.end();
		if (buffer.length > 0) {
			emitLine(buffer);
			buffer = "";
		}
	};

	stream.on("data", onData);
	stream.on("end", onEnd);

	return () => {
		stream.off("data", onData);
		stream.off("end", onEnd);
	};
}
```

【注解（逐行）】

- **`StringDecoder("utf8")`**：跨块 UTF-8 解码（半个字符缓存在 decoder 里）——与 `OutputAccumulator` 的流式解码同族（D7 第 7 节）；**协议层与工具输出层各自解决了同一类问题**。
- `emitLine`：**剥掉行尾可选 `\r`**（兼容 CRLF 输入——第 16 章"strip an optional preceding carriage return"的实现处）。
- `onData` 的 while 循环：**一次块里可能有多行/半行**——buffer 找 `\n`、切出、继续；找不到就退出等下一块。**同步循环**（无 await）保证"事件触发后缓冲一致"。
- `onEnd` **flush 残帧**（`decoder.end()` + 非空 buffer 也 emit）——第 16.7 节的"退出时 buffer 必须为空"在实现里的对应：**最后一条没有 `\n` 的行也会被交付**。【陷阱】许多客户端实现会漏这一步（最后一条记录丢失）——pi 的内建实现做对了，可作为对照标尺。
- 返回**解绑函数**（off data/end）——与第 13 章的"订阅返回退订"同构。
- 注释里的 **"intentionally does not use Node readline"** 与第 16 章文档呼应，说明生产端与消费端共同定义了分帧契约。具体到 readline 是否会在 U+2028/U+2029 上多切，官方文档与仓库注释的证据不一致；当前手册不把该实现行为写成已核实事实。

---

> D12 第一部分到此。第二部分：`print-mode.ts`（单发运行的完整骨架与信号处理）、`rpc-types.ts`（命令/响应的联合组织）、`rpc-mode.ts`（分发、扩展 UI 子协议、关停）、`rpc-client.ts`（连接、相关、停止）与总结。

---


###### 第二部分：print / RPC 两个模式与客户端


##### 3. `print-mode.ts`：单发运行的完整骨架


###### 3.1 资源与信号：先"清场"，再干活

【源码（节选）】

```typescript
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
	const { mode, messages = [], initialMessage, initialImages } = options;
	let exitCode = 0;
	// session 是一个 let 变量（不是 const）——因为重绑会换对象（下一节）；所有对 session 的引用都走这个变量，保证"绑定后（替换会话）自动指向新 session"
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;
	// disposed 幂等闸：disposeRuntime 可能被"正常收尾"与"信号处理"两条路径触发（第 13.4 节的"清理汇聚"）——第一次真的清、之后直接返回
	let disposed = false;
	// 清理注册表（signalCleanupHandlers）：正常结束时要把信号处理器摘掉（finally 里遍历调用）——"注册即登记、结束即注销"（从第 1 章的 read.ts 到这里的进程信号，同一条纪律贯穿全书）
	const signalCleanupHandlers: Array<() => void> = [];

	const disposeRuntime = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
	};

	const registerSignalHandlers = (): void => {
		// 信号处理器：SIGTERM 全平台 + SIGHUP 仅非 Windows（Windows 没有 SIGHUP）；处理动作 = 杀追踪的分离子进程（killTrackedDetachedChildren——D7 第 8 节 trackDetachedChildPid 的消费方！）+ 释放运行时 + 按惯例退出码（SIGHUP→129、SIGTERM→143，即 128+信号号——与 D7 的 bash 退出码映射同一惯例）
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") signals.push("SIGHUP");

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void disposeRuntime().finally(() => {
					process.exit(signal === "SIGHUP" ? 129 : 143);
				});
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	registerSignalHandlers();
```

【注解（四个要素）】

1. **`disposed` 幂等闸**：`disposeRuntime` 可能被"正常收尾"与"信号处理"两条路径触发（第 13.4 节的"清理汇聚"）——第一次真的清、之后直接返回。
2. **信号处理器**：`SIGTERM` 全平台 + `SIGHUP` 仅非 Windows（Windows 没有 SIGHUP）；处理动作 = **杀追踪的分离子进程**（`killTrackedDetachedChildren`——D7 第 8 节 `trackDetachedChildPid` 的消费方！）+ 释放运行时 + **按惯例退出码**（SIGHUP→129、SIGTERM→143，即 128+信号号——与 D7 的 bash 退出码映射同一惯例）。
3. **清理注册表**（`signalCleanupHandlers`）：正常结束时要把信号处理器**摘掉**（finally 里遍历调用）——**"注册即登记、结束即注销"**（从第 1 章的 read.ts 到这里的进程信号，同一条纪律贯穿全书）。
4. 【陷阱】`session` 是一个 `let` 变量（不是 const）——因为**重绑**会换对象（下一节）；所有对 session 的引用都走这个变量，保证"绑定后（替换会话）自动指向新 session"。


###### 3.2 重绑：把"扩展上下文"接到当前会话

【源码（节选）】

```typescript
	// setRebindSession 的接线：宿主把"重绑动作"告诉 runtime（第 8.6 节的机制），替换会话时 runtime 回调它——print/json 模式也需要重绑（不只交互模式）
	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		// session = runtimeHost.session：先换本地引用（所有下游闭包经它拿新对象）
		session = runtimeHost.session;
		await session.bindExtensions({
			// mode 用 "json" | "print"——扩展的 ctx.mode 由此而来（第 13.6 节的模式判断）
			mode: mode === "json" ? "json" : "print",
			// commandContextActions 把命令专用动作接到 runtime/session（第 13.1.3 节的特权集）：waitForIdle/newSession/fork/navigateTree/switchSession/reload——print 模式下扩展命令依然可用（无 UI 但可以有命令；navigateTree/fork 等操作仍能被执行——这让"脚本化使用扩展命令"成为可能）
			commandContextActions: {
				waitForIdle: () => session.waitForIdle(),
				newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navigateOptions) => {
					const result = await session.navigateTree(targetId, {
						summarize: navigateOptions?.summarize,
						customInstructions: navigateOptions?.customInstructions,
						replaceInstructions: navigateOptions?.replaceInstructions,
						label: navigateOptions?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, switchOptions) => {
					return runtimeHost.switchSession(sessionPath, switchOptions);
				},
				reload: async () => {
					await session.reload();
				},
			},
			onError: (err) => {
				console.error(`Extension error (${err.extensionPath}): ${err.error}`);
			},
		});

		unsubscribe?.();
		unsubscribeBackpressure?.();
		unsubscribe = session.subscribe((event) => {
			if (mode === "json") {
				// 事件订阅：JSON 模式订阅 session 事件 → toJsonEvent → writeRawStdout（同步编码）；text 模式不订阅（只要最终文本——第 16.2 节）
				writeRawStdout(`${JSON.stringify(toJsonEvent(event))}\n`);
			}
		});
		unsubscribeBackpressure =
			mode === "json"
				? session.agent.subscribe(async () => {
						await waitForRawStdoutBackpressure();
					})
				: undefined;
	};
```

【注解（五件事）】

1. **`setRebindSession` 的接线**：宿主把"重绑动作"告诉 runtime（第 8.6 节的机制），替换会话时 runtime 回调它——**print/json 模式也需要重绑**（不只交互模式）。
2. **`session = runtimeHost.session`**：先换本地引用（所有下游闭包经它拿新对象）。
3. **`bindExtensions({ mode, commandContextActions })`**：
   - `mode` 用 `"json" | "print"`——扩展的 `ctx.mode` 由此而来（第 13.6 节的模式判断）；
   - `commandContextActions` 把**命令专用动作**接到 runtime/session（第 13.1.3 节的特权集）：`waitForIdle`/`newSession`/`fork`/`navigateTree`/`switchSession`/`reload`——【陷阱】**print 模式下扩展命令依然可用**（无 UI 但可以有命令；`navigateTree`/`fork` 等操作仍能被执行——这让"脚本化使用扩展命令"成为可能）。
4. **事件订阅**：JSON 模式订阅 session 事件 → `toJsonEvent` → `writeRawStdout`（**同步编码**）；text 模式**不订阅**（只要最终文本——第 16.2 节）。
5. **背压订阅**（JSON 模式）：`session.agent.subscribe(async () => await waitForRawStdoutBackpressure())`——【陷阱】**在 Agent 层再挂一个"什么都不做、只等背压"的订阅**：因为 session 订阅的回调是**被 await 的**（第 3.7 节），这个额外的 await 会**拖住事件派发**直到 stdout 可写——**用"监听器串行 await"机制实现输出背压**。聪明且依赖前文语义（如果你只看本文件，会觉得这个订阅莫名其妙）。

- 【陷阱】两个 unsubscribe 分开管理（session 与 agent 各一个），重绑时**先全退**再重建——避免旧订阅指向旧 session（第 8.6 节的纪律在模式层的落实）。


###### 3.3 主体：三次 prompt、两种输出、统一兜底

【源码（节选）】

```typescript
	try {
		if (mode === "json") {
			// JSON 头：在任何 prompt 之前写会话头（第 16.3 节的第一条记录）——session.sessionManager.getHeader()（D9 的类新增 getter 的消费方）
			const header = session.sessionManager.getHeader();
			if (header) writeRawStdout(`${JSON.stringify(header)}\n`);
		}

		await rebindSession();

		// prompt 顺序：先 initialMessage（带图片），再逐条 messages——串行 await（每个 prompt 完整跑完再下一个：一次调用多条提词是先后而非并发）
		if (initialMessage) await session.prompt(initialMessage, { images: initialImages });
		for (const message of messages) await session.prompt(message);

		if (mode === "text") {
			const state = session.state;
			const lastMessage = state.messages[state.messages.length - 1];
			if (lastMessage?.role === "assistant") {
				const assistantMsg = lastMessage as AssistantMessage;
				// error/aborted → stderr 写错误 + 退出码 1（第 16.2 节的规则）
				if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
					console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
					exitCode = 1;
				} else {
					for (const content of assistantMsg.content) {
						if (content.type === "text") writeRawStdout(`${content.text}\n`);
					}
				}
			}
		}
		return exitCode;
	// catch：调用层异常 → stderr + 1（"协议内失败"与"协议外异常"都收敛到退出码——第 16.2 节）
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	// finally：摘信号处理器 → dispose（幂等）→ flushRawStdout（第 4 节的 raw 写机制的收尾——保证退出前输出落地，对应 main.ts 的 drain 逻辑，D6 第 10 节）
	} finally {
		for (const cleanup of signalCleanupHandlers) cleanup();
		// 整个函数从不开订阅就 return 的路径（比如 text 模式）：disposeRuntime 在 finally 里照样跑（unsubscribe 为 undefined 则 ?.() 无害）——统一收口；这正是"所有路径都释放"的实现（第 15 章 L09 的验收点）
		await disposeRuntime();
		await flushRawStdout();
	}
}
```

【注解】

- **JSON 头**：在**任何 prompt 之前**写会话头（第 16.3 节的第一条记录）——`session.sessionManager.getHeader()`（D9 的类新增 getter 的消费方）。
- **prompt 顺序**：先 `initialMessage`（带图片），再逐条 `messages`——**串行 await**（每个 prompt 完整跑完再下一个：一次调用多条提词是**先后**而非并发）。
- **text 模式的输出规则**：
  - 只看**最后一条**消息；不是 assistant → 什么都不输出（退出码保持 0？——【陷阱】input 为空等边界下，print 输出空、退出 0；脚本要自己判空）；
  - `error`/`aborted` → **stderr 写错误 + 退出码 1**（第 16.2 节的规则）；
  - 正常 → **逐 content 块写文本**（跳过 thinking/toolCall 块——只要"最终回答的文字"）；每条文本后加 `\n`。【陷阱】多个文本块时**每块一行**（文本块之间本来就有语义分隔）。
- **catch**：调用层异常 → stderr + 1（"协议内失败"与"协议外异常"都收敛到退出码——第 16.2 节）。
- **finally**：摘信号处理器 → dispose（幂等）→ **`flushRawStdout`**（第 4 节的 raw 写机制的收尾——**保证退出前输出落地**，对应 main.ts 的 drain 逻辑，D6 第 10 节）。
- 【陷阱】整个函数**从不开订阅就 return 的路径**（比如 text 模式）：`disposeRuntime` 在 finally 里照样跑（unsubscribe 为 undefined 则 `?.()` 无害）——**统一收口**；这正是"所有路径都释放"的实现（第 15 章 L09 的验收点）。


##### 4. 顺带认识 `output-guard.ts` 的三件套

print/json/rpc 都使用 `writeRawStdout`/`waitForRawStdoutBackpressure`/`flushRawStdout`（来自 `core/output-guard.ts`）：

```text
writeRawStdout(value)              把字符串写入"被接管的 stdout"（绕过 console 的格式化）
waitForRawStdoutBackpressure()     等写缓冲降到水位线（可 await 的背压）
flushRawStdout()                   退出前等待全部落地
```

- 【陷阱】为什么叫 "raw"？因为 `main.ts` 在非交互模式 `takeOverStdout()`（D6 第 4 节）——**把 `process.stdout.write` 换成了带背压追踪的受控写入**；普通 `console.log` 会被重定向到 stderr（保护协议通道）。**"谁在写 stdout、怎么写"是一套被接管的机制**，读模式代码前先知道这一点，就不会困惑"这些 write 从哪来"。
- 【跳转】`core/output-guard.ts` 的实现本身很短（第 16.8 节的实验里会验证背压行为）——建议顺手读一遍（搜索 `takeOverStdout`/`writeRawStdout`/`restoreStdout` 三个符号）。


##### 5. `rpc-types.ts`：协议面的类型学


###### 5.1 命令：一个大联合（按域分组）

【源码（节选，完整分组）】

```typescript
// 命令形态极简：type + 少量字段——参数校验在服务端（handleCommand 内）；类型只保证"客户端能构造出形状正确的东西"
export type RpcCommand =
	// Prompting
	| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "clear_queue" }
	// 注意 new_session 带 parentSession?（血缘）、bash 带 excludeFromContext?（!! 语义——第 4.4.1 节）——命令字段与核心概念一一对应；读 RPC 命令参考时，每个字段都能回溯到某个章节（get_entries 带 since? = 增量拉取）
	| { id?: string; type: "new_session"; parentSession?: string }
	// State
	| { id?: string; type: "get_state" }
	// Model
	| { id?: string; type: "set_model"; provider: string; modelId: string }
	| { id?: string; type: "cycle_model" }
	| { id?: string; type: "get_available_models" }
	// Thinking
	| { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
	| { id?: string; type: "cycle_thinking_level" }
	| { id?: string; type: "get_available_thinking_levels" }
	// Queue modes
	| { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
	| { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
	// Compaction
	| { id?: string; type: "compact"; customInstructions?: string }
	| { id?: string; type: "set_auto_compaction"; enabled: boolean }
	// Retry
	| { id?: string; type: "set_auto_retry"; enabled: boolean }
	| { id?: string; type: "abort_retry" }
	// Bash
	| { id?: string; type: "bash"; command: string; excludeFromContext?: boolean }
	| { id?: string; type: "abort_bash" }
	// Session
	| { id?: string; type: "get_session_stats" }
	| { id?: string; type: "export_html"; outputPath?: string }
	| { id?: string; type: "switch_session"; sessionPath: string }
	| { id?: string; type: "fork"; entryId: string }
	| { id?: string; type: "clone" }
	| { id?: string; type: "get_fork_messages" }
	| { id?: string; type: "get_entries"; since?: string }
	| { id?: string; type: "get_tree" }
	| { id?: string; type: "get_last_assistant_text" }
	| { id?: string; type: "set_session_name"; name: string }
	// Messages
	| { id?: string; type: "get_messages" }
	// Commands (available for invocation via prompt)
	| { id?: string; type: "get_commands" };
```

【注解（三个观察）】

1. **每个成员都带可选 `id`**（第 16.5.2 节的关联机制）——**类型层强制**"每条命令都可被相关"。
2. **域分组注释**（Prompting/State/Model/…）就是第 16.5.7 节命令表的来源——**读类型文件比读文档快**（文档可能落后；类型是被编译器盯着的）。
3. **命令形态极简**：`type` + 少量字段——**参数校验在服务端**（handleCommand 内）；类型只保证"客户端能构造出形状正确的东西"。

- 【陷阱】注意 `new_session` 带 `parentSession?`（血缘）、`bash` 带 `excludeFromContext?`（`!!` 语义——第 4.4.1 节）——**命令字段与核心概念一一对应**；读 RPC 命令参考时，每个字段都能回溯到某个章节（`get_entries` 带 `since?` = 增量拉取）。


###### 5.2 状态快照与响应

【源码（节选）】

```typescript
export interface RpcSessionState {
	model?: Model<any>;
	thinkingLevel: ThinkingLevel;
	isStreaming: boolean;
	isCompacting: boolean;
	steeringMode: "all" | "one-at-a-time";
	followUpMode: "all" | "one-at-a-time";
	sessionFile?: string;
	sessionId: string;
	sessionName?: string;
	autoCompactionEnabled: boolean;
	// 12 个字段=客户端面板的全部数据源（模型/思考/流态/压缩态/队列模式/会话身份/计数）
	messageCount: number;
	pendingMessageCount: number;
}
```

【注解】

- **12 个字段=客户端面板的全部数据源**（模型/思考/流态/压缩态/队列模式/会话身份/计数）。`messageCount` 与 `pendingMessageCount` 是**摘要数字**（不是消息本体——本体要 `get_messages`）——**"状态查询轻、数据查询重"的分工**。
- 【陷阱】没有 `isRetrying` 字段？重试状态靠**事件**（`auto_retry_*`）传播——快照只包含"持续可查询"的状态；瞬时过程用事件。**状态 vs 事件的边界**在协议设计里再次出现（第 4 章）。
- `RpcResponse` 是一个**按命令一一对应的成功/失败联合**（success: true + data 形状 / success: false + error 字符串，都带 `command` 字段便于校验）——【陷阱】读响应类型时注意"同一 command 的 data 形状由联合成员决定"（例如 `prompt` 是 `{ disposition }`）；客户端 `getData<T>()` 的解包（下一节）依赖它。


##### 6. `rpc-mode.ts`：分发、扩展 UI 与关停


###### 6.1 骨架：三个小工具与一个等待表

【源码（节选）】

```typescript
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	// takeOverStdout()：RPC 也接管（同 print/json）——协议纯净的第一道保障
	takeOverStdout();
	let session = runtimeHost.session;
	// ...
	// output = writeRawStdout(serializeJsonLine(obj))——单一行写（整形与序列化的组合；第 0 节流水线的落点）
	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};
	// success/error 两个构造器把"响应形状"集中一处（避免手写对象散落各处——类型断言 as RpcResponse 因为泛型 command 无法自动匹配联合成员；这类 as 是"构造函数签名比 TS 能表达的形状更精确"的妥协——读时确认它不改变运行时行为）
	const success = <T extends RpcCommand["type"]>(id, command: T, data?) => {
		if (data === undefined) return { id, type: "response", command, success: true } as RpcResponse;
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};
	const error = (id, command, message): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	// pendingExtensionRequests：扩展对话框的等待表（id → resolve/reject）；shutdownRequested/shuttingDown：两个标志位（请求关停 vs 正在关停——幂等/重入防护第 N 次出现）
	const pendingExtensionRequests = new Map<string, { resolve; reject }>();
	let shutdownRequested = false;
	let shuttingDown = false;
```

【注解】

- `takeOverStdout()`：**RPC 也接管**（同 print/json）——协议纯净的第一道保障。
- `output` = `writeRawStdout(serializeJsonLine(obj))`——**单一行写**（整形与序列化的组合；第 0 节流水线的落点）。
- `success`/`error` 两个构造器把"响应形状"集中一处（**避免手写对象散落各处**——类型断言 `as RpcResponse` 因为泛型 `command` 无法自动匹配联合成员；【陷阱】这类 `as` 是"构造函数签名比 TS 能表达的形状更精确"的妥协——读时确认它不改变运行时行为）。
- `pendingExtensionRequests`：**扩展对话框的等待表**（id → resolve/reject）；`shutdownRequested`/`shuttingDown`：两个标志位（请求关停 vs 正在关停——**幂等/重入防护**第 N 次出现）。


###### 6.2 扩展 UI 子协议：`createDialogPromise` 与降级

【源码（节选）】

```typescript
	function createDialogPromise<T>(opts, defaultValue: T, request: Record<string, unknown>, parseResponse): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			// 默认值的语义由调用点决定（select 用 undefined、confirm 用 false——"取消=否"的安全默认，第 13.7.1 节的 fail-safe 在此呼应）
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

			// cleanup 是"三件事的合体"（清定时器 + 摘 abort 监听 + 删除等待表项）——任何结局都必须走它（资源不漏）；这也是为什么 resolve 的包装里先 cleanup 再 resolve
			const cleanup = () => {
				if (timeoutId) clearTimeout(timeoutId);
				opts?.signal?.removeEventListener("abort", onAbort);
				pendingExtensionRequests.delete(id);
			};
			const onAbort = () => { cleanup(); resolve(defaultValue); };
			opts?.signal?.addEventListener("abort", onAbort, { once: true });

			if (opts?.timeout) {
				timeoutId = setTimeout(() => { cleanup(); resolve(defaultValue); }, opts.timeout);
			}

			pendingExtensionRequests.set(id, {
				// 响应到达时先清理等待状态，再解析载荷并兑现 Promise。
				resolve: (response) => { cleanup(); resolve(parseResponse(response)); },
				reject,
			});
			output({ type: "extension_ui_request", id, ...request } as RpcExtensionUIRequest);
		});
	}
```

【注解（一个 Promise 的三种结局）】

1. **取消**（已中止或途中 abort）→ resolve **默认值**（不 reject——"取消是结果"）；
2. **超时** → resolve 默认值（**对话框不能永远挂着**——时间上限保护）；
3. **收到响应**（`pendingExtensionRequests` 里的 resolve）→ `parseResponse` 提取值。

- `cleanup` 是"三件事的合体"（清定时器 + 摘 abort 监听 + 删除等待表项）——**任何结局都必须走它**（资源不漏）；这也是为什么 resolve 的包装里先 `cleanup` 再 resolve。
- 【陷阱】默认值的语义由调用点决定（select 用 `undefined`、confirm 用 `false`——**"取消=否"的安全默认**，第 13.7.1 节的 fail-safe 在此呼应）。
- 降级原则（`createExtensionUIContext` 的实现读起来是**一张"支持/不支持"清单**）：
  - 支持：select/confirm/input/editor（请求-响应）、notify/setStatus/setTitle/setEditorText（fire-and-forget，注释 "no response needed"）；
  - **明确降级**：`onTerminalInput` 返回空函数、`setWorkingMessage/Visible/Indicator`、`setHiddenThinkingLabel`、`setFooter/setHeader`、`custom()` 返回 undefined——**每条都有注释说明"为什么不支持"**（"requires TUI access"/"requires TUI loader access"）；
  - `getEditorText()` 返回 `""` + 注释 "Synchronous method can't wait for RPC response"——**同步接口无法等异步响应**的诚实降级；
  - `setWidget`：**只支持字符串数组**（工厂函数被忽略）+ 注释说明；`pasteToEditor` **回退**到 setEditorText。
- 【陷阱】这张"降级清单"就是第 13.6 节模式能力矩阵的**实现真相**：文档说"RPC 不能自定义终端组件"——具体到代码是"`custom()` 直接返回 undefined、`setFooter` 是空函数"。**读 RPC 扩展兼容性问题时，先来这张清单里找对应方法**。


###### 6.3 输入分发：`handleInputLine`

【源码（完整）】

```typescript
	// handleInputLine 是 async 但 attachJsonlLineReader 的回调用 void 调用它（void handleInputLine(line)）——行读取（同步逐行）与行处理（异步）解耦；处理不阻塞后续行的读取（但它们会并发处理！）
	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(error(undefined, "parse", `Failed to parse command: ${...}`));
			// 三处 await waitForRawStdoutBackpressure()——背压纪律贯穿每条输出路径（连错误响应也不放过）
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
		// 扩展 UI 响应：路由到等待表（不进 handleCommand）——UI 子协议与命令协议在入口处分流（第 16.5.2 节的"extension_ui_response 不产生普通命令响应"）
		if (typeof parsed === "object" && parsed !== null && "type" in parsed && parsed.type === "extension_ui_response") {
			const response = parsed as RpcExtensionUIResponse;
			const pending = pendingExtensionRequests.get(response.id);
			if (pending) {
				pendingExtensionRequests.delete(response.id);
				pending.resolve(response);
			}
			return;
		}

		const command = parsed as RpcCommand;
		try {
			// 普通命令：handleCommand(command) → 有响应就 output + 等背压 → checkShutdownRequested()（每条命令处理后检查关停请求——让"扩展请求的 shutdown"在合适的边界执行）
			const response = await handleCommand(command);
			if (response) {
				output(response);
				await waitForRawStdoutBackpressure();
			}
			await checkShutdownRequested();
		} catch (commandError: unknown) {
			output(error(command.id, command.type, commandError instanceof Error ? commandError.message : String(commandError)));
			await waitForRawStdoutBackpressure();
		}
	};
```

【注解（四条路径）】

1. **坏行**：解析失败 → `error(undefined, "parse", ...)`（**无 id** 的解析错误响应——第 16.5.4 节；`command: "parse"` 是个"伪命令名"）；然后**等背压**（每次 output 后都等——写不进去就暂停处理下一行）。
2. **扩展 UI 响应**：路由到等待表（**不进 handleCommand**）——UI 子协议与命令协议在**入口处分流**（第 16.5.2 节的"`extension_ui_response` 不产生普通命令响应"）。
3. **普通命令**：`handleCommand(command)` → 有响应就 `output` + 等背压 → `checkShutdownRequested()`（**每条命令处理后检查关停请求**——让"扩展请求的 shutdown"在合适的边界执行）。
4. **命令异常**：`error(command.id, command.type, message)`——**带 id 的失败响应**（客户端能关联）。

- 【陷阱】三处 `await waitForRawStdoutBackpressure()`——**背压纪律贯穿每条输出路径**（连错误响应也不放过）。这是"stdout 可能堵"的严肃对待（第 16.3.1 节的规则在服务端的执行）。
- 【陷阱】`handleInputLine` 是 **async 但 attachJsonlLineReader 的回调用 `void` 调用它**（`void handleInputLine(line)`）——**行读取（同步逐行）与行处理（异步）解耦**；处理不阻塞后续行的**读取**（但它们会并发处理！）。【陷阱】如果两条命令并发处理，它们的响应顺序**可能乱**——这正是"客户端必须按 id 关联、不能按顺序配对"的**服务端根源**（第 16.5.2 节的规则在这里找到证据）。


###### 6.4 关停与"永不返回"

【源码（节选）】

```typescript
	const onInputEnd = () => { void shutdown(); };
	// stdin 的 end = 关停信号（第 16.5.6 节"关 stdin 请求有序关停"的服务端实现）
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => { void handleInputLine(line); });
		return () => { detachJsonl(); process.stdin.off("end", onInputEnd); };
	})();

	// Keep process alive forever
	// return new Promise(() => {})：永不 resolve 的 Promise（函数签名 Promise<never>）——注释直白："Keep process alive forever"
	return new Promise(() => {});
}
```

【注解】

- **stdin 的 `end` = 关停信号**（第 16.5.6 节"关 stdin 请求有序关停"的服务端实现）。
- `attachJsonlLineReader(process.stdin, ...)`：**复用与客户端同一个分帧实现**（第 2 节）——服务端读命令、客户端读事件，**同一把尺子**。
- `return new Promise(() => {})`：**永不 resolve 的 Promise**（函数签名 `Promise<never>`）——注释直白："Keep process alive forever"。进程的寿命由 stdin 结束/信号决定，不由函数返回决定。【陷阱】这是"顶层常驻循环"在 async 世界的写法——`await runRpcMode(runtime)` 在 main 里会永远挂着（D6 第 10 节的分发点）。


##### 7. `rpc-client.ts`：客户端七件套


###### 7.1 字段与启动：子进程 + 收集器

【源码（节选）】

```typescript
export class RpcClient {
	// process（子进程句柄）、stopReadingStdout（解绑器）
	private process: ChildProcess | null = null;
	private stopReadingStdout: (() => void) | null = null;
	// eventListeners（数组——允许重复订阅/顺序遍历，与 Agent 的 Set 不同！跨模块记住各自的集合类型）
	private eventListeners: RpcEventListener[] = [];
	// pendingRequests（id → resolve/reject——与 rpc-mode 的等待表镜像）
	private pendingRequests: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }> = new Map();
	// requestId（自增计数器——客户端生成 id 的简单策略："1"、"2"…跨进程唯一只需在本连接内唯一——自增够用且可调试）
	private requestId = 0;
	// stderr（累积字节串）+ exitError（最近一次退出/错误——供 stop/失败时报告）
	private stderr = "";
	private exitError: Error | null = null;
```

【注解（五个状态桶）】

1. `process`（子进程句柄）、`stopReadingStdout`（解绑器）；
2. `eventListeners`（**数组**——允许重复订阅/顺序遍历，与 `Agent` 的 Set 不同！【陷阱】跨模块记住各自的集合类型）；
3. `pendingRequests`（id → resolve/reject——与 rpc-mode 的等待表镜像）；
4. `requestId`（自增计数器——**客户端生成 id 的简单策略**："1"、"2"…【陷阱】跨进程唯一只需在本连接内唯一——自增够用且可调试）；
5. `stderr`（**累积**字节串）+ `exitError`（最近一次退出/错误——供 stop/失败时报告）。

【源码（start 的关键段）】

```typescript
	async start(): Promise<void> {
		if (this.process) throw new Error("Client already started");
		// 三类进程失败（exit/error/stdin error）→ 统一 rejectPendingRequests(error)——挂起请求全部失败（"进程死了别等"）；exitError 存下原因（之后 start/stop 的报错引用它）
		this.exitError = null;
		// cliPath 默认 "dist/cli.js"——第 16.6 节的"示例指向构建产物"的代码来源；分发场景可以覆盖
		const cliPath = this.options.cliPath ?? "dist/cli.js";
		// 参数拼装：固定 --mode rpc + 可选的 provider/model/args——client 是"带默认的启动器"，不是配置系统（复杂参数走 args 透传）
		const args = ["--mode", "rpc"];
		if (this.options.provider) args.push("--provider", this.options.provider);
		if (this.options.model) args.push("--model", this.options.model);
		if (this.options.args) args.push(...this.options.args);

		const childProcess = spawn("node", [cliPath, ...args], {
			cwd: this.options.cwd,
			env: { ...process.env, ...this.options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = childProcess;

		// stderr 双通道：累积（自己的诊断）且转发（process.stderr.write——用户的进程仍能看到子进程日志；这与第 16 章的"stderr 是给人看的"一致——客户端不解析它，只是搬运+存档）
		childProcess.stderr?.on("data", (data) => { this.stderr += data.toString(); process.stderr.write(data); });
		childProcess.once("exit", (code, signal) => { /* 记录 exitError + rejectPendingRequests */ });
		childProcess.once("error", (error) => { /* 同上（带 stderr 上下文） */ });
		childProcess.stdin?.on("error", (error) => { /* 同上（stdin 写失败） */ });

		this.stopReadingStdout = attachJsonlLineReader(childProcess.stdout!, (line) => { this.handleLine(line); });

		await new Promise((resolve) => setTimeout(resolve, 100));
		// 100ms 初始化等待 + 启动检查：拉长一点等子进程进入 RPC 循环，再检查 exitCode !== null（启动就挂的情况当场抛错——比"发第一条命令时才发现"更快失败）
		if (this.process.exitCode !== null) {
			const error = this.exitError ?? this.createProcessExitError(...);
			this.exitError = error;
			throw error;
		}
	}
```

【注解（四个决策）】

1. **`cliPath` 默认 `"dist/cli.js"`**——第 16.6 节的"示例指向构建产物"的代码来源；分发场景可以覆盖。
2. **参数拼装**：固定 `--mode rpc` + 可选的 provider/model/args——**client 是"带默认的启动器"**，不是配置系统（复杂参数走 `args` 透传）。
3. **stderr 双通道**：**累积**（自己的诊断）**且转发**（`process.stderr.write`——用户的进程仍能看到子进程日志；【陷阱】这与第 16 章的"stderr 是给人看的"一致——客户端**不解析**它，只是搬运+存档）。
4. **三类进程失败**（exit/error/stdin error）→ 统一 `rejectPendingRequests(error)`——**挂起请求全部失败**（"进程死了别等"）；`exitError` 存下原因（**之后 start/stop 的报错引用它**）。
5. **100ms 初始化等待 + 启动检查**：拉长一点等子进程进入 RPC 循环，再检查 `exitCode !== null`（**启动就挂**的情况当场抛错——比"发第一条命令时才发现"更快失败）。`this.process.exitCode !== null`（不是 `this.process`——进程对象还在，但已退出）。

- 【陷阱】`once("exit")` 里的 `if (this.process !== childProcess) return;`（在 stop 处也有同款守卫）：**防止旧进程的事件影响新进程状态**（stop→start 重启后，旧 exit 事件迟到）——"代际"思想在**客户端生命周期**的复刻（第 D11 的 provider 刷新同款）。


###### 7.2 `handleLine`：响应和事件如何分流

【源码（完整核心逻辑）】

```typescript
private handleLine(line: string): void {
  try {
    const data = JSON.parse(line);
    // 先 parse，再按待处理 id 查响应
    if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
      const pending = this.pendingRequests.get(data.id)!;
      this.pendingRequests.delete(data.id);
      pending.resolve(data as RpcResponse);
      return;
    }
    // 其余所有合法 JSON 值都被广播给 eventListeners
    for (const listener of [...this.eventListeners]) {
      listener(data as JsonAgentSessionEvent);
    }
  } catch {
    // Ignore non-JSON lines
  }
}
```

【注解】

1. **先 parse，再按待处理 id 查响应**。只有 `type === "response"`、有 truthy `id`，而且该 id 仍在 Map 里，才 resolve 对应 Promise 并 return。
2. 其余所有合法 JSON 值都被广播给 `eventListeners`。客户端没有单独的 Extension UI handler；如果收到了 `extension_ui_request`，它也会落到这里，靠事件类型断言传给 listener。具体 UI 对话协议由宿主自行处理。
3. `[...]` 快照让 listener 可以在本次派发中 unsubscribe，而不改变当前遍历序列；重复订阅仍会得到重复回调，因为容器是数组。
4. `try/catch` 也包住 listener 调用。某个 listener 抛错会被这个空 catch 吞掉，并停止本次 for 循环后续 listener；JSON 解析错误同样静默忽略。`RpcClient` 不提供 parse/dispatch error 回调。

【陷阱】如果一个 response 的 id 已不在 `pendingRequests`，它不会被丢弃或报“孤儿响应”，而会作为普通事件广播。这会在请求超时后收到迟到响应时发生：`send()` 超时时先删掉 id 并 reject；响应晚到时就找不到等待者。


###### 7.3 `send`：建立一次请求的生命周期

核心顺序如下：

```typescript
const id = `req_${++this.requestId}`;
const fullCommand = { ...command, id } as RpcCommand;
return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    this.pendingRequests.delete(id);
    reject(new Error(`Timeout waiting for response to ${command.type}. Stderr: ${this.stderr}`));
  }, 30000);

  this.pendingRequests.set(id, {
    resolve: (response) => { clearTimeout(timeout); resolve(response); },
    reject: (error) => { clearTimeout(timeout); reject(error); },
  });

  try {
    stdin.write(serializeJsonLine(fullCommand));
  } catch (error) {
    // Remove this request and reject if write throws synchronously.
  }
});
```

读法：

- `requestId` 是单调递增数字，前缀 `req_` 方便日志识别；请求先放进 Map，再写管道，因此极快返回的响应也能找到 waiter。
- Promise 的 resolve/reject 包装都会清理 30 秒 timer。进程 exit/error/stdin error 会由 `rejectPendingRequests()` 拒绝所有在途请求。
- 写入抛同步异常时，当前实现从 Map 删除这一项并 reject。**但它不检查 `stdin.write()` 的布尔返回值，也不等待 `drain`**；请求密集且输入管道拥塞时，客户端没有显式的写端背压处理。不要把服务端 `waitForRawStdoutBackpressure()` 误认为客户端已经限制 stdin 写入。
- timeout 只表示客户端停止等待并删除关联 id，不会取消服务端正在执行的命令。超时后命令可能仍运行并改变会话；应用若需要取消，应另发协议支持的 abort 命令，并考虑它与原请求之间的竞态。

方法如 `getState()`、`bash()`、`switchSession()` 是薄包装：先 `send()`，再用 `getData<T>()` 拆成功数据。`getData()` 在 `success: false` 时抛普通 Error；成功分支的 `T` 是调用者给的类型断言，并非运行时 schema 校验。协议另一端和双方版本必须匹配。


###### 7.4 `promptAndWait`：先订阅可以避免漏掉事件，但不是所有输入都能等待

实际实现：

```typescript
async promptAndWait(message, images, timeout): Promise<JsonAgentSessionEvent[]> {
  const eventsPromise = this.collectEvents(timeout); // 先装 agent_settled listener
  await this.prompt(message, images);                 // 再发 prompt 并等 preflight 响应
  return eventsPromise;                               // 最后等 settled
}
```

这个先后顺序确实避免“prompt 很快完成，之后才开始监听”的漏事件竞态；`collectEvents()` 看见 `agent_settled` 后清 timer、退订并返回包含该终止事件的数组。

但有两个重要限制：

1. `prompt()` 的文档说 `disposition === "handled"` 表示没有启动 run；`promptAndWait()` 丢弃 prompt 的返回值，仍等待 `agent_settled`，因此扩展命令/输入 hook 消费 prompt 时会等到 timeout。普通 started prompt 是它的预期用法；需要支持 handled 时，应分开调用 `prompt()` 并检查 disposition。
2. 如果 `prompt()` 因 preflight 错误 reject，`promptAndWait()` 会直接 reject，不会 await 或取消已创建的 `eventsPromise`。该 promise 内的 listener/timer 会留到 settled 或 timeout 才清理。长 timeout 下这会暂时占用 listener 和 timer。

另外 `waitForIdle()` 只是监听**未来**的 `agent_settled`，不会先查询当前 idle 状态。若 Agent 已经 idle，再调用它不会立刻 resolve。需要“发送一个 prompt 并收集它导致的事件”时，订阅必须先于发送；但调用者仍要处理 handled、reject 和 timeout 语义。

`test/rpc.test.ts` 中多处调用 `promptAndWait()` 的集成测试由 Anthropic API key/OAuth 环境变量门控；它们不能作为无外部条件、覆盖 handled/error 路径的离线证据。`rpc-prompt-response-semantics.test.ts` 测的是服务端 `prompt` response，不是 `RpcClient.promptAndWait()` 的这些客户端边界。本文没有运行测试。


###### 7.5 停止进程和在途请求

`stop()` 会先停止 stdout reader，再向子进程发 `SIGTERM`；最多等待 1 秒，超时则发 `SIGKILL`，随后设 `process = null` 并清空 pending Map。通常子进程退出事件会触发 `rejectPendingRequests()`，并让所有等待命令拒绝。

【陷阱】若 1 秒后 Promise 的退出等待分支先 resolve、而 SIGKILL 子进程的 `exit` 事件尚未送达，`stop()` 可能先清空 Map；随后 exit handler 的 `rejectPendingRequests()` 已看不到那些 waiter。不要假定 `stop()` 对每个用户请求都提供了强制 reject 保证。上层应在 stop 前结束/取消工作，并给自己的操作设截止时间。


##### 8. 总结


###### 8.1 三个模式共用/独有件一览

| 组件                       | print(text)         | json                    | rpc                     |
| -------------------------- | ------------------- | ----------------------- | ----------------------- |
| `takeOverStdout`         | ✅（main 里）       | ✅                      | ✅                      |
| `writeRawStdout` 家族    | ✅（最终文本）      | ✅（事件流）            | ✅（响应+事件）         |
| `toJsonEvent`            | ❌                  | ✅                      | ✅                      |
| `serializeJsonLine`      | ❌                  | ✅                      | ✅                      |
| `attachJsonlLineReader`  | ❌                  | ❌（产出端）            | ✅（读命令）            |
| 扩展绑定（bindExtensions） | ✅                  | ✅                      | ✅                      |
| 事件订阅                   | ❌                  | ✅                      | ✅                      |
| 背压                       | flush               | ✅（订阅 + 每次写后等） | ✅（每次写后等）        |
| 退出码                     | 0/1（最后消息状态） | 0（异常才非 0）         | 常驻（信号/stdin 决定） |


###### 8.2 五条"协议工程"经验（可迁移到任何 JSONL 协议实现）

1. **分帧只认 LF**，实现里连 readline 都换掉（换掉它还要在注释里写明为什么）；
2. **移除累积快照**让流式体积线性化，把"常量字段"（id/name/usage）留在协议里；
3. **id 关联是唯一可靠的配对方式**——因为服务端逐行并发处理（`void handleInputLine`）；
4. **背压要贯穿每条写出路径**（包括错误响应）；
5. **关停路径穷尽**（stdin end、信号、SIGKILL 超时、pending 清理、解绑器、flush）——**任何一条漏掉，长跑进程就会以某种方式泄漏**。


###### 8.3 阅读检查清单

- [ ] 我能说出 `toJsonEvent` 对 `toolcall_start` 的两个补偿字段及其理由吗？
- [ ] 我知道 `attachJsonlLineReader` 的 onEnd flush 在防什么吗？
- [ ] 我能复述 print-mode 的信号处理（信号列表、退出码、清理顺序）吗？
- [ ] 我知道"背压订阅"为什么挂在 `session.agent.subscribe` 上吗？
- [ ] 我能列出 `createDialogPromise` 的三种结局与默认值策略吗？
- [ ] 我知道 RPC 命令响应可能乱序的服务端根源吗？
- [ ] 我能说出 `RpcClient.stop` 的两段式关停吗？

---

> D12 完。精读篇（D1-D12）覆盖：循环、Agent、会话（投影/本体）、提示与压缩（读/写）、SDK、CLI、工具、扩展、模型层、协议模式。

#### 16.9 常见错误

| 现象                   | 原因                                          | 处理                                                        |
| ---------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| 解析偶尔失败，日常没事 | 用了 readline / Unicode 分隔符                | 换字节流 + 只在 LF 切分（16.7）                             |
| 最后一条记录丢了       | 退出时没处理 buffer 残留                      | flush 残留；或长度校验                                      |
| Pi "卡住"不输出        | 客户端停止读 stdout（背压）                   | 持续消费；或按需暂停的是"处理"而不是"读"                    |
| 命令响应配错           | 按顺序而不是按`id` 关联                     | 一律用唯一 id 相关                                          |
| 等不到完成信号         | 拿`agent_end` 当完成 / `handled` 后仍等待 | 等`agent_settled`；先看 `disposition`                   |
| 把日志当协议           | stdout 里混入非 JSON                          | 日志走 stderr；校验每条记录都是 JSON 对象                   |
| 子进程死了客户端不知道 | 没监听 exit/error                             | 处理启动失败、意外退出与超时                                |
| `RpcClient` 起不来   | `cliPath` 指向未构建的 `dist/cli.js`      | 先构建或指向已安装的可执行入口（examples/README.md 的提示） |


#### 16.10 验收题

1. 四种模式的选择标准各一句话；什么情况下"非 TTY 自动 print"会生效？
2. print 模式的退出码规则？"错误写 stderr"对脚本意味着什么？
3. JSON 流里 `message_update` 为什么不能带累积快照？客户端重建的正确顺序（delta/end/message_end）？
4. RPC 里 `id` 的作用域与例外？为什么"响应的顺序"不能用来配对？
5. `prompt` 的 `disposition` 三种值各代表什么？何时不该等 `agent_settled`？
6. 写出"按行重组"的核心循环，并列出必须避免的四类错误。
7. 优雅关停的动作是什么？客户端还应当防御哪些"不优雅"情况？


##### 参考答案（要点）

1. 人类交互→interactive；只取最终文本→print；要结构化进度→JSON；要双向控制→RPC；无显式模式且 stdin/stdout 有任一非 TTY → print。
2. 终止响应为 error/aborted 或调用抛错 → 非零；stderr 与 stdout 分离，脚本可安全把 stdout 当作"答案"。
3. 累积快照会令流体积随消息长度超线性增长；delta 缓冲显示 → text_end/thinking_end/toolcall_end 用权威内容替换 → message_end 整体替换。
4. 字符串 id 用于命令-响应关联（会话事件一般没有，`bash_execution_update` 例外；`extension_ui_response` 用自己的请求 id）；处理是异步的，顺序无保证。
5. `started`（已开始）/`queued`（已入队）/`handled`（被消费，无 run）；`handled` 不应等 settled。
6. 循环：读 chunk → 流式解码并入缓冲 → 找 LF → 切行、剥 CR、解析 → 处理；错误：按 chunk 解析、readline、丢弃残留、文本模式换行转换。
7. 关 stdin；防御启动失败、意外退出、stderr 诊断、取消、超时。


#### 16.11 源码依据

- `packages/coding-agent/docs/cli-integration.md`（模式选择、print/JSON/RPC 行为、fork 品牌化）；
- `packages/coding-agent/docs/json.md`（严格 JSONL、事件参考、重建规则、`JsonAgentSessionEvent`）；
- `packages/coding-agent/docs/rpc.md`（记录族、id 关联、生命周期、错误、关停、Python 最小客户端）；
- `packages/coding-agent/docs/rpc-commands.md`、`docs/rpc-extension-ui.md`；
- `packages/coding-agent/examples/rpc-client.ts`、`examples/rpc-extension-ui.ts`；
- 源码：`packages/coding-agent/src/modes/json-event.ts`、`src/modes/rpc/rpc-types.ts`、`src/modes/rpc/rpc-client.ts`。


---

## 动手任务 A：SDK 宿主。

在新测试中导入 `fauxAssistantMessage`、`createHarness`、Vitest。`const h = await createHarness()` 后用 `h.setResponses([fauxAssistantMessage("你好")])`；调用 `const unsubscribe = h.session.subscribe(event => order.push(event.type))`，再 `await h.session.prompt("你好")`。在 `finally` 中先 `unsubscribe()` 再 `h.cleanup()`，把 `"disposed"` 放进 `order`。断言有 `message_update`、`agent_end`、`agent_settled`，且 `disposed` 最后。错误变体让 faux 给出 `stopReason: "error"`，取消变体在 `tool_execution_start` 后 `void h.session.abort()`；每个变体单独创建 harness。将“run 结束”“所有事件回调结束”“资源释放”写成三行，不把它们当成同一时刻。

## 动手任务 B：JSONL 解析器。

实现一个只依赖 Node 标准库的解析器。固定输入为 `{"type":"response","id":"p1"}\n{"type":"message_update","text":"中文"}\n{"type":"agent_end"}\n`；用 `TextEncoder` 转为字节，分别按每次 1 字节、64 字节和随机切片喂给解析器。使用下面的核心逻辑，测试结束时调用 `finish()` 把 UTF-8 解码器内部剩余字节冲出，并按你的协议决定如何处理没有换行的末行。

```typescript
const decoder = new TextDecoder();
let pending = "";
const values: unknown[] = [];
function feed(bytes: Uint8Array) {
  pending += decoder.decode(bytes, { stream: true });
  let cut: number;
  while ((cut = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, cut);
    pending = pending.slice(cut + 1);
    if (line.trim()) values.push(JSON.parse(line));
  }
}
function finish() {
  pending += decoder.decode();
  if (pending.trim()) values.push(JSON.parse(pending));
  pending = "";
}
```

再加两个失败用例：非法 JSON 要抛出带行号的错误；模拟子进程提前退出时，仍等待 `p1` 的 Promise 必须 reject。对应的 RPC 命令与响应类型均可在本篇列出的 `rpc-types.ts` 中核对。

## 实验记录

1. SDK 宿主先只处理 `agent_start`、文本增量、工具开始/结束、`agent_end`、`agent_settled`。用时间戳或递增序号打印事件，避免用日志打印时机猜内部顺序。
2. 成功、失败、取消三个用例共用同一个 `finally`。每个用例断言只取消订阅一次、只释放一次，并且没有遗留待决 Promise。
3. JSONL 测试故意把一个多字节中文字符切在两个字节块之间，同时把一行 JSON 切成多个块。先按字节缓冲和 UTF-8 解码，再按换行切分；不能把每块直接交给 `JSON.parse`。
4. 交付一张“SDK 事件 → JSON/RPC 对外事件”的对应表，标明命令确认、运行结束和进程退出三种不同的完成信号。

如果字节分片后的中文乱码，检查是否复用同一个 `TextDecoder` 并设置 `{ stream: true }`；若最后少一条事件，检查 `finish()`。实验结束只清理自己的测试文件。

## 验收标准

宿主在三个路径都释放资源；解析器按行而非按 chunk 解析，且不会在子进程退出后永久等待。
