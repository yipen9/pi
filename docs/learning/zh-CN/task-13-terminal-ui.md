# 13. 终端 UI、输入和宽度

今天独立研究终端“显示列数”与字符串长度的差别，并写一个无需模型和交互终端的复现测试。只用本篇和源码即可完成，预计 2 小时。

## 今日准备

需要 Node.js >= 22.19.0 和仓库依赖；未安装时在根目录执行 `npm install --ignore-scripts`。在 `packages/tui/test/` 新建 `task-13-learning.test.ts`，从 `packages/tui` 运行：

```powershell
node --test test/task-13-learning.test.ts
```

本篇只做组件与宽度函数测试，不运行 pi 交互模式，因此无需模型账号、tmux 或真实终端截图。

## 学习内容

TUI 的组件把状态渲染为给定终端宽度下的字符串行。字符个数、UTF-16 字符串长度和终端占用列数并不相等；中文、组合字符、emoji、ANSI 样式会放大这个差别。输入还牵涉焦点、键位、IME 组合输入和窗口缩放。应用交互层负责把 Agent 事件变成视图，`pi-tui` 负责布局与终端渲染。排查错位时先判断是组件生成的行已超宽，还是终端显示/光标状态异常。

例子：`"A中文B".length` 是 4，但可见宽度通常是 6 列：A 与 B 各 1 列，两个汉字各 2 列。再给它加 ANSI 颜色码，JS 字符串更长，可见宽度却仍应是 6。用 `slice(0, 4)` 裁剪会按 UTF-16 单元切，可能截断 emoji 或保留不完整的颜色控制序列；组件应按终端列数使用 `truncateToWidth`。

## 核心源码

核心源码及问题：`packages/tui/src/utils.ts` 的 `visibleWidth`、`truncateToWidth` 怎样处理字素与控制码；`packages/tui/src/layout.ts` 如何给组件宽度；`packages/tui/src/tui.ts` 如何刷新终端；`packages/tui/src/editor-component.ts` 如何处理输入与光标；`packages/tui/src/keybindings.ts` 怎样映射按键；`packages/coding-agent/src/modes/interactive/` 怎样组合应用视图。今天先精读前两个，后几个用来给故障定位分层。

## TypeScript 语法小课：数组映射与渲染契约

TUI 的 `render(width)` 返回若干行字符串。TypeScript 能约束返回的是 `string[]`，却不能证明字符串的终端可见宽度；运行时还要调用 `visibleWidth`。

```typescript
type Renderer = { render(width: number): string[] }; // 只描述返回形状
const renderer: Renderer = {
  render(width) {
    const label = "A中文B"; // JS length 与终端列宽可能不同
    return [width > 0 ? label : ""]; // 返回一行，真实布局仍需测量宽度
  },
};
console.assert(renderer.render(8).length === 1);
```

练习：记录 `"A中文B".length` 与本篇 `visibleWidth("A中文B")` 的结果；解释为什么类型正确仍会出现界面错位。


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

### 第 17 章：终端 UI

**先懂这一章**：终端屏幕会不断收到模型的新文字，也要保留用户正在编辑的输入。界面组件按照可用宽度渲染；更新时只改变必要的屏幕内容。先用一个中文长行的例子认识显示宽度，再读组件接口。

第 15–16 章分别讲程序内和进程间的入口；本章讲人直接使用 pi 时看到的界面。入口到界面的主线到此完整，后面转向测试、排障与实际开发。

> 学完本章你能回答：
>
> 1. `pi-tui` 的组件模型是什么？"差分渲染"与"同步输出"各解决什么问题？
> 2. 为什么"字符长度 ≠ 终端显示宽度"？该用哪些工具函数？
> 3. 输入、焦点与 IME（中文输入法）之间的坑在哪？
> 4. 键位系统怎么工作？为什么不能硬编码按键判断？
> 5. 自定义界面（widget/overlay/自定义编辑器）应该怎么做、不该怎么做？

**预计学习时间**：1.5 天（偏实践：用 tmux 做交互实验）。
**本章验证状态**：静态核对通过（`packages/coding-agent/docs/tui.md`、`keybindings.md`、`packages/tui/README.md` 与键位代码结构核对）；实验 L11 设计中。

---


#### 17.1 `pi-tui`：一套独立的终端 UI 框架

`packages/tui` 是**与业务无关**的终端 UI 库（第 0 章的"核心四包"之一），`coding-agent` 的交互模式建立在它之上。它的特性清单（`packages/tui/README.md`）几乎就是"终端应用的难题列表"及其答案：

| 特性                                                                        | 解决的问题                                                  |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **可互换渲染器**（main-screen / alternate-screen，共享 `TUI` 接口） | 有的场景要保留回滚缓冲（main），有的要全屏自管（alternate） |
| **差分渲染**（只更新变化的行/视口行）                                 | 每次全量重绘会闪烁、且浪费带宽                              |
| **同步输出**（CSI 2026 原子更新）                                     | 帧内多行更新对用户"同时出现"，不闪                          |
| **括号粘贴模式**（bracketed paste）                                   | 大段粘贴（>10 行）需要标记起止，避免被逐字符解释            |
| **组件模型**（`Component.render()`）                                | 界面由可组合单元构成                                        |
| **应用自管滚动**（alt-screen 视口支持鼠标/触控板/键盘）               | 全屏模式下回滚缓冲归应用所有                                |
| **内联图片**（Kitty / iTerm2 图形协议）                               | 终端里显示图片                                              |
| **自动补全**（文件路径、斜杠命令）                                    | 编辑器体验                                                  |

一个最小程序（README 的 Quick Start 改写 + 注释）：

```typescript
import { ProcessTerminal, Text, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TuiMainScreen(terminal);          // 具体渲染器只在这里出现
tui.addChild(new Text("Welcome to my app!"));
tui.setFocus(/* 某个组件 */);
tui.addInputListener((data) => {
	// 原始模式下 Ctrl+C 不会送 SIGINT，需要自己拦截
	if (matchesKey(data, "ctrl+c")) { tui.stop(); process.exit(0); }
});
tui.start();
```

三个要点：

1. **`TUI` 是共享接口**（组件管理、焦点、overlay、输入、生命周期、终端查询、渲染）；只有"构造应用"时才选具体渲染器——业务代码不绑死 main/alternate；
2. **raw 模式下没有 SIGINT**：Ctrl+C 只是普通按键数据，必须自己拦截（这是所有终端框架的共性，不是 pi 特有）；
3. **不要自己造第二套渲染器**（`tui.md` 原文：Do not create a second terminal renderer inside an extension）——直接画 ANSI 会与差分渲染打架。


#### 17.2 组件模型：`render(width)` 的契约

`tui.md` 的组件定义（ paraphrase + 原文要点）：

- 组件为**给定宽度**渲染一个**行数组**（每行一个字符串）；
- 可选处理键盘/鼠标输入；
- **状态或主题变化时，必须让缓存输出失效**（`invalidate()`）。

三条硬规则：

```text
1. 每一行都必须适配传入的宽度；
2. 测量"可见终端列数"，而不是字符串长度——ANSI 转义、宽字符（CJK）、emoji、
   组合字符都会改变显示宽度；
3. 每一行末尾 pi 会重置样式与超链接，所以每行都要重新施加样式。
```

对应工具函数（**不要自己实现宽度处理**）：

| 函数                                | 用途                                     |
| ----------------------------------- | ---------------------------------------- |
| `visibleWidth(text)`              | 可见列数（忽略 ANSI、按 Unicode 宽度算） |
| `truncateToWidth(text, width)`    | 按可见宽度截断                           |
| `sliceByColumn(text, start, end)` | 按列区间切片                             |
| `wrapTextWithAnsi(text, width)`   | 保留 ANSI 的换行                         |

渲染刷新流程：

```text
改状态 → 相关组件 invalidate() → tui.requestRender()
（TUI 会合并多次请求，统一更新终端——不用自己防抖）
```


#### 17.3 内置组件库：先组合，再自造

`tui.md` 点名的组件（写扩展 UI 的"标准件"）：

| 分类   | 组件                                                       |
| ------ | ---------------------------------------------------------- |
| 内容   | `Text`、`Markdown`、`Image`、`TruncatedText`       |
| 布局   | `Container`、`VStack`、`HStack`、`Box`、`Spacer` |
| 输入   | `Input`、`Editor`                                      |
| 选择   | `SelectList`（可搜索）、`SettingsList`（设置流）       |
| 视口   | `ScrollView`（有界可滚动）                               |
| 进行中 | `Loader`、`CancellableLoader`                          |
| 指针   | `MouseRegion`                                            |

原则：**选择、滚动、文本编辑、宽度处理都优先复用**——这些正是"看起来简单、边界极多"的模块（第 14.7 节的 `tools.ts` 示例就是 `SettingsList` + `Container` 的组合）。


#### 17.4 输入、焦点与 IME：中文用户最关心的一节


##### 17.4.1 按键解析与可配置键位

- 用 `matchesKey()` / `Key` 解析键盘输入；解析器考虑了终端协议差异与修饰键；
- **扩展组件应使用注入的 `KeybindingsManager`** 处理"可配置的应用动作"——而不是写死按键。


##### 17.4.2 光标与 IME（中文输入法的正确位置）

两条原文要求：

```text
A component that displays a text cursor should implement `Focusable` and place
`CURSOR_MARKER` immediately before its visual cursor. The TUI uses that marker to position
the hardware cursor for input method editors.

Containers that wrap an `Input` or `Editor` must propagate their `focused` state to that child.
Without propagation, Chinese, Japanese, Korean, and other IME candidate windows can appear at
the wrong screen position.
```

翻译成场景：你自定义了一个"带边框的输入区"，把 `Input` 包在 `Box` 里。如果 `Box` 没有把"聚焦状态"传给孩子，**输入法候选框会飘到屏幕中间或左上角**——因为系统不知道真实光标在哪。修法就是两条：实现 `Focusable` + 放 `CURSOR_MARKER`；容器**传递 focused 状态**。


##### 17.4.3 替换主编辑器：扩展 `CustomEditor`

要换掉主输入框时：

- **继承 `CustomEditor`**（不要从零写），它会保留应用快捷键与 agent 控制；
- **不认识的键要转发给基类**（否则用户熟悉的快捷键失灵）；
- 想恢复默认：清掉自定义编辑器工厂。


#### 17.5 鼠标：全屏模式才是"应用处理"

两种模式的行为差异（`tui.md`）：

| 模式                     | 鼠标归属                                                    |
| ------------------------ | ----------------------------------------------------------- |
| 全屏（alternate screen） | 归一化事件路由到组件：可标记已处理、捕获拖拽、请求焦点/渲染 |
| 常规模式                 | **留给终端**（终端拥有回滚缓冲），应用不要抢          |

全屏内的默认路由规则：

- **未处理的滚轮事件** → 滚动最近的 `ScrollView`；
- **未处理的主键拖拽** → 保留给"转录区选择"；
- **OSC 8 链接优先于包围它的点击区域**（点链接打开链接，不是命中父区域）。

最后一条设计纪律（与你写的任何扩展交互相关）：

```text
Design every interaction with a keyboard path even when fullscreen mouse input is available.
```

**鼠标是增强，键盘是基线**——在 print/RPC/不支持鼠标的环境里，功能不能丢。

#### 17.6 自定义屏幕与 overlay

当内置对话框不够用时，才轮到 `ctx.ui.custom()`。它的契约（`tui.md` 原文要点）：

```text
`ctx.ui.custom()` temporarily gives one component control of the interactive area and resolves
when that component calls the supplied completion callback.
```

一个最小形态：

```typescript
await ctx.ui.custom((tui, theme, keybindings, done) => {
	const component = {
		render(width: number) { return [theme.fg("accent", "按 Esc 关闭")]; },
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "escape")) done(undefined);   // 结束交互 → Promise resolve
		},
	};
	return component;
});
```

规则清单（全部来自官方文档，逐条重要）：

| 规则                          | 说明                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `overlay: true`             | 画在既有内容**之上**；选项控制尺寸、锚点、偏移、边距、响应式可见性                                   |
| `OverlayHandle.setHidden()` | 临时隐藏/显示，**交互仍然活跃**（不是结束）                                                          |
| 焦点所有权                    | 已聚焦的 overlay 会在普通渲染中**保持输入所有权**；要让别的组件收输入，必须**显式**释放/改焦点 |
| 一实例一交互                  | 每次开始交互都**新建**组件实例；不要复用                                                             |
| 完成方式                      | 调工厂收到的**完成回调**（它 resolve Promise 并销毁组件）                                            |
| 禁止                          | 对`ctx.ui.custom()` 创建的 overlay 调 `OverlayHandle.hide()`                                           |

定位/堆叠/焦点/响应式/动画的完整行为参考 `examples/extensions/overlay-qa-tests.ts`（仓库里最大的示例之一，专门做 QA 矩阵）——**要写复杂 overlay 前先读它**。


#### 17.7 主题：语义色与具体色的分工


##### 17.7.1 用传进来的 theme

```typescript
return new Text(
	theme.style("Done!", { fg: "success", bg: "toolSuccessBg", bold: true }),
	0, 0,
);
```

- `theme.style()`：前景/背景 + 属性（粗体等）组合；
- 颜色值可以是**语义 token**（accent、muted、success、warnings、errors、tool 输出、Markdown 等）或**具体 `Color`**；
- **位置有讲究**：前景 token 放 `fg`、背景 token 放 `bg`；要"把背景色当文字色"，取具体值：`{ fg: theme.colors.userMessageBg }`；
- 需要颜色运算用 `mixColors()`；
- token 被主题设为"终端默认色"时，用终端自己的颜色；`theme.colors` 报"终端宣告的颜色"（没宣告则给猜测值）；`theme.appearance`（`"dark"`/`"light"`）用于决定"提亮还是压暗"；
- pi 按终端能力把结果转成 truecolor 或 256 色；**token 每主题只转换一次**——能预算的具体色就别放进 render 路径。


##### 17.7.2 两个"存储陷阱"

```text
Do not permanently store strings with theme colors unless invalidate() rebuilds them.
A theme change clears render caches, but it cannot remove old ANSI colors embedded in
application state.
```

翻译：**不要把带颜色的字符串长期存在你的状态里**——主题切换清的是渲染缓存，清不掉你状态里已固化的 ANSI 序列。要么每次渲染现算（无状态组件完全没问题），要么在 `invalidate()` 里重建。

Markdown 渲染用 `getMarkdownTheme()`，保证与应用主题一致。


#### 17.8 渲染性能与调试


##### 17.8.1 性能纪律（`tui.md`）

```text
1. 渲染跑在交互关键路径上——把昂贵的布局/高亮按"宽度 + 内容"缓存，
   并在 invalidate() 里清掉；
2. 默认视图保持紧凑，细节用展开或独立屏幕呈现；
3. 自定义工具渲染要处理 partial results，并在能安全更新时复用上一个组件。
```


##### 17.8.2 调试渲染问题

- **`PI_TUI_WRITE_LOG` 环境变量**：捕获发给终端的原始 ANSI 流——"看得见的乱码"背后到底发了什么字节，一目了然；
- 必测矩阵（写/改组件时）：**窄宽度、宽字符、resize 事件、主题切换、焦点迁移、常规与全屏两种模式**。


#### 17.9 键位系统：从配置文件到代码表


##### 17.9.1 用户视角

- pi 的快捷键由**命名动作**（如 `app.session.new`）到按键的映射组成；
- 用户在 `<agent-dir>/keybindings.json` 里覆盖：

```json
{
  "app.session.new": "ctrl+shift+n",
  "app.session.tree": ["ctrl+shift+t", "alt+shift+t"],
  "tui.altScreen.pageUp": []
}
```

- 配置值**替换**该动作的默认键位；**空数组 = 禁用**；
- `/hotkeys` 查看当前生效键位；改文件后 `/reload` 生效。


##### 17.9.2 键语法

```text
modifier+key：修饰键 ctrl / shift / alt / super（可组合）
字母 a-z；数字 0-9；
特殊键：escape(esc) enter(return) tab space backspace delete insert clear
        home end pageUp pageDown up down left right
功能键 f1-f12；符号（` - = [ ] \ ; ' , . / ! @ # $ % ^ & * ( ) _ + | ~ { } : < > ?）
示例：ctrl+shift+x、alt+ctrl+x、super+k、ctrl+1
```

`super` 需要终端单独上报修饰键（通常是 Kitty 键盘协议）——不支持的终端里可能无效（第 2 章 Windows 键位配置一节也提过）。


##### 17.9.3 代码视角：默认表怎么组织

- `pi-tui` 提供基础表（`TUI_KEYBINDINGS`）与 `Keybindings` 接口；
- `coding-agent` 的 `core/keybindings.ts` 合并出应用总表（`KEYBINDINGS`），其中 `app.*` 动作带 `defaultKeys` 与 `description`；
- **平台差异**在同一处处理：`useWindowsKeybindings()` 判断 Windows 与 WSL，并调整默认值。例如：

```typescript
export const KEYBINDINGS = {
	...TUI_KEYBINDINGS,
	"tui.editor.undo": {
		...TUI_KEYBINDINGS["tui.editor.undo"],
		defaultKeys: process.platform === "win32" ? "ctrl+z" : windowsKeybindings ? "alt+z" : "ctrl+-",
	},
	"app.suspend": {
		defaultKeys: process.platform === "win32" ? [] : "ctrl+z",   // Windows 上禁用挂起
		description: "Suspend to background",
	},
	// ...
};
```


##### 17.9.4 开发规则（来自 `AGENTS.md`）

```text
Never hardcode key checks (e.g. matchesKey(keyData, "ctrl+x")).
Add defaults to DEFAULT_EDITOR_KEYBINDINGS or DEFAULT_APP_KEYBINDINGS so they stay configurable.
```

注意：仓库规则给的是历史名称；当前代码里的实际结构是 `pi-tui` 的 `TUI_KEYBINDINGS` 与 `coding-agent` 的 `KEYBINDINGS`（见 17.9.3）。**原则不变**：新增快捷键要进默认键位表（保持可配置），代码里通过键位系统查询动作，而不是写死按键字符串。查代码时以当前表为准。

Windows Terminal 可能保留或改写 Shift+Enter、Alt+Enter；从输入事件和 `packages/tui/src/keybindings.ts` 核对实际收到的键位。


#### 17.10 宽度问题的本质：为什么"字符数"是错的

把一段中英文混排文本按"字符数"对齐，常见三种错：

| 元素                        | 字符数   | 实际列数            |
| --------------------------- | -------- | ------------------- |
| ASCII`abc`                | 3        | 3                   |
| 中文`你好`                | 2        | **4**（全角） |
| ANSI 颜色序列`\x1b31m`   | 5 个字符 | **0 列**      |
| emoji`👨👩👧`（ZWJ 序列） | 多个码点 | 2 列                |
| 组合音标`é`（e + ́）    | 2        | 1                   |

所以：

- `text.length` 只该用于"码点数量"这类场景，**不能用于布局**；
- `slice(0, width)` 可能把 ANSI 序列或 emoji 序列**切一半**——终端显示直接坏掉；
- 正确工具：`visibleWidth` / `truncateToWidth` / `sliceByColumn` / `wrapTextWithAnsi`（17.2 节）。

**测试输入清单**（写组件时固定用它们验收）：`中文标题`、`👨👩👧 家庭 emoji`、`\x1b[31m彩色\x1b[0m`、超长单行、窄宽度（如 20 列）、窗口 resize。


#### 17.11 实验 L11：中文与宽度的最小复现

**实验性质**：交互实验（tmux）+ 组件级验证；不依赖真实模型。
**验证状态**：设计中。目标（规划文档 L11）："中文、长行、缩放输入 → 终端问题最小复现"。


##### 材料

仓库自带的交互测试指引 `.pi/skills/interactive-testing.md`（AGENTS.md 要求交互测试前先读它）：

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p
tmux send-keys -t pi-test "输入一段中文：你好，世界 🌏" Enter
tmux resize-window -t pi-test -x 40 -y 24   # 模拟缩放
tmux capture-pane -t pi-test -p
tmux kill-session -t pi-test
```


##### 步骤

1. 按上面流程启动、输入含中文与 emoji 的文本，观察 80 列下的换行位置；
2. **缩放到 40 列**，再观察：文本是否重排？边框是否错位？输入光标在字中/行尾位置是否正确？
3. 写一个**最小组件实验**（不接模型）：一个扩展，用 `visibleWidth`/`truncateToWidth` 渲染固定文本，分别用"正确工具"和"`slice` 硬切"两版对比，在 40/80 列下截图；
4. 用 `PI_TUI_WRITE_LOG=1` 启动，找出两种实现的原始输出差异；
5. 产出：一份"最小复现说明"——**输入文本 + 宽度 + 操作序列 + 期望/实际**（第 19 章会把这套格式用于故障报告）。


##### 判定标准

- 复现不依赖模型调用，可在组件层稳定重现；
- 能解释错位发生在哪一层（渲染字符串生成 vs 终端显示），并给出正确工具的选择理由；
- 缩放操作不破坏"每行必须适配宽度"的契约。


##### 清理

`tmux kill-session`；删除临时扩展；`git status` 干净。


#### 本章源码精读

> **车下内容**：本节要打开源码逐段对照，通勤（车上）时可以先跳过，直接读本章的“常见错误”和“验收题”；需要修改对应代码时再回来。 读法见[附录 L。

D13 沿渲染器、视口和交互模式启动顺序读源码。读到终端宽度或输入区刷新时，再回到本章的最小复现，观察到底是布局、渲染还是键位状态发生了变化。



##### D13：交互模式（TUI 装配与启动序列）精读

**先懂**：交互界面启动时先创建终端组件、编辑器和会话事件订阅，然后把收到的运行事件变成屏幕更新。先找装配点和订阅点，大文件的其他渲染细节按问题定位。

```text
教学伪代码：准备终端与主题 → 创建消息视口和输入编辑器
           → 绑定当前会话事件 → 接收输入并发起 prompt
           → 用事件更新组件 → 退出时解除绑定
```

这只是启动与运行的骨架；重绘、焦点和宽度问题在第 17 章及后文独立展开。

> 精读对象：`modes/interactive/tui-renderer.ts`、`modes/interactive/chat-viewport.ts` 与 `modes/interactive/interactive-mode.ts`（247KB！）的**装配与启动段**（`init`/`run`）与整体结构。
> 对应主线：第 17 章（终端 UI）、第 3 章（入口）。
> 读法：`interactive-mode.ts` 太大，**不要通读**。本篇给"结构地图 + 启动序列逐段"；其余部分（大量 selector/渲染组件）按需从地图定位。

---


###### 0. 目录地图：交互模式由什么组成

```text
modes/interactive/
├── interactive-mode.ts        主类（247KB）：装配、启动、编辑提交、渲染派发、选择器管理、停止
├── tui-renderer.ts            渲染器组合根（main/alt screen + 主题样式注入 + Proxy 引用）
├── chat-viewport.ts           布局：ScrollView 转录区 + 固定输入坞（VStack）
├── footer-data-provider.ts    页脚数据（分支、上下文用量等）的提供者/订阅
├── model-catalog-refresh.ts   启动时的目录刷新
├── session-share.ts           会话分享（/share）
├── external-editor.ts         外部编辑器（$EDITOR）
├── components/                40+ 个 UI 组件（消息、工具、选择器、页脚、头图、主题等）
└── theme/                     主题系统（dark/light/system、schema、控制器）
```

【陷阱】"交互模式"的代码量远大于核心会话——但**职责边界很清晰**（第 17 章反复强调的"逻辑与渲染分离"）：它**只消费** `AgentSession` 的公开面（事件/状态/方法），不反向修改核心。本 D13 关注的正是这条边界的**装配方式**。

---


###### 第一部分：两个组合根与一个巨型类


##### 1. `tui-renderer.ts`：渲染器的"选择"与"注入"

【源码（完整，含重载）】

```typescript
export interface InteractiveTuiOptions {
	readonly tuiMode: "regular" | "fullscreen";
	readonly showHardwareCursor: boolean;
	readonly logDirectory: string;
	readonly terminal?: Terminal;
	readonly onRightClickPaste?: () => void;
	readonly fullscreenCopyOnSelect?: boolean;
	readonly fullscreenWheelScrollLines?: WheelScrollLines;
}

/** Composition root shared by coding-agent presentations. */
// 重载把"模式→具体渲染器类型"变成编译期事实：传 tuiMode: "fullscreen" 的调用方拿到的类型就是 TuiAltScreen（能调它的特有方法）；"regular" 拿 TuiMainScreen
export function createInteractiveTui(options: InteractiveTuiOptions & { readonly tuiMode: "fullscreen" }): TuiAltScreen;
export function createInteractiveTui(options: InteractiveTuiOptions & { readonly tuiMode: "regular" }): TuiMainScreen;
export function createInteractiveTui(options: InteractiveTuiOptions): TuiMainScreen | TuiAltScreen;
export function createInteractiveTui(options: InteractiveTuiOptions): TuiMainScreen | TuiAltScreen {
	const terminal = options.terminal ?? new ProcessTerminal();
	if (options.tuiMode === "fullscreen") {
		// 主题通过闭包而非参数：样式函数直接引用模块级 theme 单例（theme.bg(...)）——主题是渲染期读取的全局状态（第 17.7 节"不要在渲染路径外缓存带色字符串"的实践背景：theme 单例在切换时整体替换/失效）
		const styleSearchMatch = (text: string) => theme.bg("searchMatchBg", theme.fg("searchMatchText", text));
		return new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, {
			searchMatchStyle: (text) => theme.underline(styleSearchMatch(text)),
			searchCurrentMatchStyle: (text) => theme.bold(theme.inverse(styleSearchMatch(text))),
			searchNavigationButtonStyle: (text, hovered) => (hovered ? theme.underline(text) : text),
			scrollToEndIndicator: () => {
				// 全屏渲染器的行为全部"依赖注入"：搜索高亮样式（用了主题的语义色 + 下划线/反显修饰）、"跳到最新"的指示器（keyDisplayText 生成快捷键提示——键位系统进 UI 文案）、打开 URL（openBrowser 平台工具）、右键粘贴、选择复制、滚轮行数、"复制成功/失败消息"的回传
				const shortcut = keyDisplayText("tui.altScreen.bottom");
				const label = ` ↓ Jump to latest message${shortcut ? ` · ${shortcut}` : ""} `;
				return theme.bg("selectedBg", theme.fg("text", label));
			},
			openUrl: openBrowser,
			onRightClickPaste: options.onRightClickPaste,
			copyOnSelect: options.fullscreenCopyOnSelect,
			wheelScrollLines: options.fullscreenWheelScrollLines ?? "auto",
			// copySelection 返回 true 或错误字符串（成功/失败两种类型并存的返回值）——调用方（renderer 内部）据此决定提示什么
			copySelection: async (text) => {
				try { await copyToClipboard(text); return true; }
				catch (error) { return error instanceof Error ? error.message : String(error); }
			},
		});
	}
	return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}
```

【注解（三个设计点）】

1. **重载把"模式→具体渲染器类型"变成编译期事实**：传 `tuiMode: "fullscreen"` 的调用方拿到的类型就是 `TuiAltScreen`（能调它的特有方法）；`"regular"` 拿 `TuiMainScreen`。**联合返回类型让调用方各自收窄**——比"返回基接口 + 运行时断言"更安全。
2. **全屏渲染器的行为全部"依赖注入"**：搜索高亮样式（用了主题的语义色 + 下划线/反显修饰）、"跳到最新"的指示器（`keyDisplayText` 生成快捷键提示——**键位系统进 UI 文案**）、**打开 URL**（`openBrowser` 平台工具）、右键粘贴、选择复制、滚轮行数、"复制成功/失败消息"的回传。
   - 【陷阱】`copySelection` 返回 **`true` 或错误字符串**（成功/失败两种类型并存的返回值）——调用方（renderer 内部）据此决定提示什么。**"布尔 + 原因"的合并形态**在小接口里很常见；如果你写类似 API，注意消费端要能区分。
3. **主题通过闭包而非参数**：样式函数直接引用模块级 `theme` 单例（`theme.bg(...)`）——**主题是渲染期读取的全局状态**（第 17.7 节"不要在渲染路径外缓存带色字符串"的实践背景：`theme` 单例在切换时整体替换/失效）。


###### 1.1 `createInteractiveTuiReference`：可替换渲染器的稳定引用

【源码（节选）】

```typescript
/** Stable reference for components while InteractiveMode replaces the active renderer. */
// 要解决的问题：组件在构造时拿到 TUI 引用；但用户可以在运行时切换模式（regular ↔ fullscreen）——渲染器对象被整体替换，旧引用会调用到"死对象"
export function createInteractiveTuiReference(getTui: () => TUI): TUI {
	return new Proxy({} as TUI, {
		get: (_target, property) => {
			// 这是"稳定句柄 + 可变实现"模式的又一实现（对比第 23 章 Chord 的服务 facade、D5 的 extensionRunnerRef）：组件永远持有 Proxy，实现随便换
			const tui = getTui();
			// 非函数属性：每次读时实时取（Reflect.get）
			const value = Reflect.get(tui, property, tui);
			if (typeof value !== "function") return value;
			let methodTui = tui;
			let method = value;
			return (...args: unknown[]) => {
				const currentTui = getTui();
				// 方法：返回一个闭包，每次调用时检查"渲染器是否被替换"（currentTui !== methodTui）——被替换则重新取方法并换绑 this（Reflect.apply(method, methodTui, args)）；未替换则复用上次的方法引用（少一次 Reflect.get 的微优化）
				if (currentTui !== methodTui) {
					// 重新取方法并换绑
					const currentMethod = Reflect.get(currentTui, property, currentTui);
					if (typeof currentMethod !== "function") throw new TypeError(...);
					methodTui = currentTui;
					method = currentMethod;
				}
				return Reflect.apply(method, methodTui, args);
			};
		},
		set: (_target, property, value) => Reflect.set(getTui(), property, value, getTui()),
		has: (_target, property) => Reflect.has(getTui(), property),
		// set/has/getPrototypeOf 全部透传给当前渲染器（保持对象语义完整）
		getPrototypeOf: () => Reflect.getPrototypeOf(getTui()),
	});
}
```

【注解】

- **要解决的问题**：组件在构造时拿到 `TUI` 引用；但**用户可以在运行时切换模式（regular ↔ fullscreen）**——渲染器对象被整体替换，旧引用会调用到"死对象"。
- **解法**：Proxy 包装"动态取当前渲染器"的 getter：
  - **方法**：返回一个闭包，每次调用时检查"渲染器是否被替换"（`currentTui !== methodTui`）——被替换则**重新取方法并换绑 `this`**（`Reflect.apply(method, methodTui, args)`）；未替换则复用上次的方法引用（**少一次 Reflect.get** 的微优化）。
  - **非函数属性**：每次读时实时取（`Reflect.get`）。
  - `set`/`has`/`getPrototypeOf` 全部透传给当前渲染器（保持对象语义完整）。
- 【陷阱】这是**"稳定句柄 + 可变实现"**模式的又一实现（对比第 23 章 Chord 的服务 facade、D5 的 `extensionRunnerRef`）：组件永远持有 Proxy，实现随便换。**代价**：每次属性访问多一层（热路径上的属性读会被放大——所以方法路径做了缓存）。读这一段你要能回答："为什么不能直接让组件每次去 `getTui()`？"——【答】组件是**第三方（扩展）写的**，只能收一个 TUI 对象；Proxy 让它们"不用改代码"就获得动态性。


##### 2. `chat-viewport.ts`：转录区 + 输入坞的固定布局

【源码（完整）】

```typescript
export interface ChatViewport {
	readonly root: Component;
	readonly transcript: ScrollView;
}

/** Shared fullscreen transcript and fixed input-dock layout. */
export function createChatViewport(options: ChatViewportOptions): ChatViewport {
	const transcript = new ScrollView(options.document, {
		// 顶部 = ScrollView（转录区），follow: "end"（自动跟随尾部——流式输出时滚到底）、primary: true（主视口——键盘翻页/搜索的默认目标）、overscroll: "chain"（到边界后把滚动"链"给外层——第 17.5 节的滚动语义）
		follow: "end",
		primary: true,
		overscroll: "chain",
		scrollbar: options.scrollbar ?? "auto",
		...(options.scrollbarTrackStyle === undefined ? {} : { scrollbarTrackStyle: options.scrollbarTrackStyle }),
		...(options.scrollbarThumbStyle === undefined ? {} : { scrollbarThumbStyle: options.scrollbarThumbStyle }),
	});
	const dock = new VStack([
		// minSize: 3 是编辑器的"不可压缩底线"（别人 shrink 到 0 时它也要保住三行——收缩优先级通过 minSize 表达）
		{ component: options.pendingMessages, shrink: 1, minSize: 0 },
		{ component: options.status, shrink: 1, minSize: 0 },
		...(options.widgetsAbove === undefined ? [] : [{ component: options.widgetsAbove, shrink: 1, minSize: 0 }]),
		// 底部 = VStack（固定输入坞），顺序从上有：待发消息区 → 状态行 → 用户 widget（上）→ 编辑器（minSize: 3——至少三行） → 用户 widget（下）→ 页脚
		{ component: options.editor, shrink: 1, minSize: 3 },
		...(options.widgetsBelow === undefined ? [] : [{ component: options.widgetsBelow, shrink: 1, minSize: 0 }]),
		{ component: options.footer, shrink: 1, minSize: 0 },
	]);
	return {
		transcript,
		root: new VStack([
			// 根 = 垂直两段：转录区 grow: 1（吃掉剩余空间）+ 输入坞 basis: "auto"（按内容需要）
			{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]),
	};
}
```

【注解（布局的四个声明）】

1. **顶部 = ScrollView（转录区）**，`follow: "end"`（**自动跟随尾部**——流式输出时滚到底）、`primary: true`（主视口——键盘翻页/搜索的默认目标）、`overscroll: "chain"`（到边界后把滚动"链"给外层——第 17.5 节的滚动语义）。
2. **底部 = VStack（固定输入坞）**，顺序从上有：待发消息区 → 状态行 → 用户 widget（上）→ **编辑器（`minSize: 3`——至少三行）** → 用户 widget（下）→ 页脚。
   - 【陷阱】`minSize: 3` 是编辑器的"不可压缩底线"（别人 shrink 到 0 时它也要保住三行——收缩优先级通过 minSize 表达）。
   - 【陷阱】widget 的插入用**条件展开**（`...(x === undefined ? [] : [...])`）——undefined 时不占布局（不是"渲染空组件"）；**布局数组由"存在的组件"构成**。
3. **根 = 垂直两段**：转录区 `grow: 1`（吃掉剩余空间）+ 输入坞 `basis: "auto"`（按内容需要）。**"上面弹性、下面自适应"**是聊天类 TUI 的经典骨架。
4. 滚动条样式**由调用方注入**（track/thumb 两个可选函数——主题语义色在组合根组装，第 1 节同款）。

【跳转】`ScrollView` 与 `VStack` 的完整语义（follow/primary/overscroll/个字段）在 `packages/tui`（第 17 章 + tui README）；这里只需读懂"谁在上、谁弹性、谁保底"。

---

> D13 第一部分到此。第二部分：`InteractiveMode` 的字段总览、`init()` 的启动序列（12 步逐段）、`run()` 的主循环与异步检查、与核心的边界总结。

---


###### 第二部分：`InteractiveMode` 的字段、启动序列与主循环


##### 3. 字段总览：一个 TUI 应用的全部状态

`InteractiveMode` 的字段（源码 447-501 行，按职责分组）：

| 组        | 字段（节选）                                                                                                                                                                                                            | 说明                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 运行时    | `runtimeHost`、`renderer`、`ui`、`mainScreenRenderState`                                                                                                                                                        | 会话运行时 + 当前渲染器 + TUI 接口 + main-screen 渲染态        |
| 组件树    | `loadedResourcesContainer`、`chatContainer`、`documentContainer`、`transcriptScrollView`、`fullscreenLayoutRoot`、`pendingMessagesContainer`、`statusContainer`、`editorContainer`、`footerContainer` | **每个区域一个容器**（第 2 节的输入坞就是这些容器拼的）  |
| 编辑器    | `defaultEditor`（`CustomEditor`）、`editor`（`ActiveEditor`）、`editorComponentFactory`、`autocompleteProvider(+Wrappers)`、`fdPath`                                                                      | 默认编辑器与"当前活动编辑器"分离（扩展可替换——第 17.4.3 节） |
| 选择器    | `activeSelectorToken`、`activeSelectorDispose`                                                                                                                                                                      | "同一时刻只能有一个选择器"的令牌与释放器                       |
| 键位/版本 | `keybindings`、`version`                                                                                                                                                                                            | 键位管理器与版本号（头部/通知用）                              |
| 生命周期  | `isInitialized`、`onInputCallback`、`pendingUserInputs`                                                                                                                                                           | 初始化幂等 +**输入 Promise 的 resolver** + 排队输入      |
| 状态指示  | `idleStatus`、`activeStatusIndicator`、`activeWorkingIndicatorEmbedded`、`workingMessage/Visible/IndicatorOptions`、`hiddenThinkingLabel`                                                                     | 忙碌/空闲指示器族                                              |
| 交互计时  | `lastSigintTime`、`lastEscapeTime`                                                                                                                                                                                  | **双击检测**（Ctrl+C 两次退出、Esc 两次…）              |
| 展示开关  | `changelogMarkdown`、`startupNoticesShown`、`anthropicSubscriptionWarningShown`、`managedToolStatusStarted`                                                                                                     | "只提示一次"的旗标族                                           |
| 流式渲染  | `streamingComponent`、`entriesRenderedByBoundaryCompaction`（Set）                                                                                                                                                  | 当前流式组件引用 +**压缩边界已渲染条目的去重集**         |

- 【陷阱】`entriesRenderedByBoundaryCompaction` 的命名与类型（Set<string></string>）暗示一个真实需求：**压缩后同一批"保留条目"可能被重复渲染**（压缩事件 + 投影刷新两条路径）——用条目 id 去重。读 UI 问题时这是"消息重复显示"类 bug 的第一嫌疑点。
- 【陷阱】`pendingUserInputs` + `onInputCallback`：**交互循环的"输入侧"是一个 Promise 的 resolver 对**（`getUserInput` 返回新 Promise 并保存 resolve；编辑器提交时 resolve）——**把"事件驱动的提交"桥接成"顺序的 await 循环"**。这是 TUI 与异步主循环结合的经典写法（下面 `run()` 的 while 直接读它）。
- 【陷阱】大量"只提示一次"旗标：**状态机式的 UI 一致性**（避免重复通知）；它们都是布尔/时间戳的平凡类型，但**每个都对应一个"重复触发"的坑**。


##### 4. `init()`：十二步启动序列

`init()`（932-1134 行）是全书**最长的单一函数之一**。按执行顺序拆成十二步（每步都有"为什么必须是这个顺序"）：


###### 步骤 1-2：幂等守卫与信号处理

```typescript
	async init(): Promise<void> {
		if (this.isInitialized) return;
		this.registerSignalHandlers();
```

- **幂等**（`run()` 与手动初始化可能都调）；信号处理**最早注册**（初始化中途被 Ctrl+C/SIGTERM 也要能优雅退——覆盖"启动一半"的窗口）。


###### 步骤 3-4：变更日志与模型作用域提示

```typescript
		this.changelogMarkdown = this.getChangelogForDisplay();
		if (this.session.scopedModels.length > 0 && this.shouldShowStartupDetails()) {
			// ...（拼模型列表 + 循环键提示 → console.log 到"启动前"的终端）
```

- changelog 先拿（后面头部的"新版本提示"用）；模型作用域提示**用 `console.log` 直接打印**——【陷阱】此刻 TUI 还没 `start()`，**stdout 还是普通终端**（这行输出会留在终端回滚区，成为启动日志的一部分）；之后进入全屏就看不到了。
- 提示文案**用键位系统生成**（`this.keybindings.getKeys("app.model.cycleForward")` + `formatKeyText`）——**按键提示永远从键位表来**（第 17.9.4 节的"不硬编码"）。


###### 步骤 5：一次建树、可重挂

```typescript
		// Keep one component tree and remount it when changing renderers.
		this.renderWidgets(); // Initialize with default spacer
		const viewport = createChatViewport({ /* ... 各容器 ... */ });
		this.transcriptScrollView = viewport.transcript;
		this.fullscreenLayoutRoot = viewport.root;
		this.mountInteractiveTui(this.renderer, [ /* 七个容器 */ ]);
```

- 注释就是设计：**组件树只建一次**（所有容器/编辑器/页脚都在树上），切换 regular/fullscreen 时**重挂**（`mountInteractiveTui` 把树挂到新渲染器）——配合第 1 节的 Proxy 引用，组件无需感知切换。
- `renderWidgets()` 先跑一次（默认 spacer）——**保证布局数组里"widget 位置"始终存在**（后续更新只是替换内容）。


###### 步骤 6-7：先用"启动期编辑器"，UI 先于扩展

```typescript
		// Accept text while startup completes, but only enable interrupt, exit, and submission feedback.
		this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onSubmit = (text) => this.handleStartupSubmit(text);
		this.ui.setFocus(this.editor);

		// Start the UI before initializing extensions so session_start handlers can use interactive dialogs
		this.ui.start();
		this.isInitialized = true;
```

- **启动期只绑三个动作**（清屏/退出/提交）——其余键位要等"工具与处理器就绪"（步骤 11）再启用；**启动期间允许打字但不允许乱触发**。
- 【陷阱】**`ui.start()` 必须在扩展初始化之前**——注释原文："so session_start handlers can use interactive dialogs"。扩展的 `session_start` 可以弹选择框（第 13 章），而对话框需要已启动的 TUI。**顺序 = 能力**的又一实例。
- `isInitialized = true` 紧跟在 `ui.start()` 后——后续异步步骤失败也不会重复初始化（但组件可能没齐……读代码时注意这个"早设旗标"的取舍）。


###### 步骤 8：主题先于"烘烤颜色"的内容

```typescript
		this.ensurePngTranscoder();
		this.themeController.applyFromSettings();
		// The header and startup notices bake theme colors into their text, so build them once the terminal
		// reported its colors. This ends at the terminal's DA1 reply, or after 100 ms if it answers nothing.
		await this.themeController.waitForTerminalColors();
```

- `ensurePngTranscoder()`：图片转码器（内联图片，第 17.1 节）**惰性准备**。
- **注释解释了一个纯技术依赖**：头部与启动提示会把主题色**烘进字符串**（第 17.7 节的【陷阱】：带色字符串不能事后跟随主题变化）——所以必须等**终端上报自身颜色**（DA1 查询的答复）之后才构建；终端不应答则 100ms 超时（**不让慢终端卡死启动**）。**"配色感知的 100ms 等待"**是终端 UI 的独特工程点。


###### 步骤 9：头部构建（有 logo / 无 logo 两种）

```typescript
		if (this.shouldShowStartupHeader()) {
			const showDetails = this.shouldShowStartupDetails();
			const showLogo = supportsPiLogo();
			const withLogo = (hints: string) => { /* logo 两行 + 版本 + hints；无 logo 用 piWordmark + vX */ };
			const expandedInstructions = () => [ /* 完整快捷键清单（20 条） */ ].join("\n");
			const compactInstructions = () => [ /* 5 条精简 */ ].join(theme.fg("muted", " · "));
			const compactOnboarding = () => theme.fg("dim", `Press ... to show full startup help...`);
			const onboarding = () => theme.fg("dim", `Pi can explain its own features...`);
			const header = new BuiltInHeader(
				() => `${withLogo(compactInstructions())}\n${compactOnboarding()}\n\n${onboarding()}`,
				() => `${withLogo(expandedInstructions())}\n\n${onboarding()}`,
				this.getStartupExpansionState(), 1, 0,
			);
			if (showLogo) header.onLogoClick = (column, row) => playPiLogo3d(this.renderer, column, row);
			// ...（Spacer + header + Spacer 入 headerContainer）
		} else { this.builtInHeader = new Text("", 0, 0); /* ... */ }
		this.ui.requestRender();
```

【注解（四个要点）】

1. **"按需构建"**（两个函数而不是两个字符串）：注释说 "Built on demand so the header follows theme changes"——**头部内容在渲染时求值**（主题切换后重新取色）；`BuiltInHeader(compactFn, expandedFn, expansionState, ...)` 接收的是**函数**。
2. **指令集两档**：`compactInstructions`（5 条常用）与 `expandedInstructions`（20 条全量）——**按展开状态切换**（`app.tools.expand` 键）；快捷键提示全部来自 `hint()`/`keyHint()` 辅助（键位表驱动）。
3. **onboarding 文案**："Pi can explain its own features... Ask it how to use or extend Pi."——**教用户"用模型回答 pi 的问题"**（第 10 章的 docs 分节为它提供知识）。
4. **彩蛋**：`header.onLogoClick = playPiLogo3d`——点击 logo 放 3D 动画（`interactive/components/easter-egg-3d.ts` 48KB！）。【陷阱】读大仓库时遇到这类"无关正式功能"的代码——**跳过即可**，但要认出它（否则会浪费半天猜"这个 3D 模块在主链路哪里用"）。


###### 步骤 10：先挂 UI，再下载外部工具

```typescript
		// Ensure fd and rg are available after mounting the TUI (downloads if missing, adds to PATH via getBinDir)
		// so slow downloads do not make startup appear frozen.
		// Both are needed: fd for autocomplete, rg for grep tool and bash commands.
		const [fdPath] = await Promise.all([
			ensureTool("fd", (status) => this.showManagedToolStatus(status)),
			ensureTool("rg", (status) => this.showManagedToolStatus(status)),
		]);
		this.fdPath = fdPath;
```

- **托管二进制**（`fd` 用于自动补全、`rg` 用于 grep 工具与 bash）——缺失时**下载**。
- 【陷阱】注释点明顺序原因："slow downloads do not make startup appear frozen"——**UI 先挂载**（用户立刻看到界面与下载状态——`showManagedToolStatus` 把进度显示在状态行），再等下载。**"先反馈、后等待"**的启动体验铁律。
- 两个工具**并行下载**（`Promise.all`）。


###### 步骤 11-12：启用完整输入、重绑、渲染、挂后台观察者

```typescript
		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();
		this.ui.requestRender();

		// Initialize extensions first so resources are shown before messages
		await this.rebindCurrentSession();
		this.renderInitialMessages();

		onThemeChange(() => { this.ui.invalidate(); this.updateEditorBorderColor(); this.ui.requestRender(); });
		this.footerDataProvider.onBranchChange(() => { this.ui.requestRender(); });
		await this.updateAvailableProviderCount();
		this.ui.renderNow();
		void loadAllHighlightLanguages().then(() => { if (!this.isInitialized) return; this.ui.invalidate(); this.ui.requestRender(); });
	}
```

- **输入处理在工具就绪后才全量启用**（`setupKeyHandlers`/`setupEditorSubmitHandler`）——**"编辑器可用的前提是它依赖的能力已就绪"**。
- `rebindCurrentSession()`：把扩展绑到会话（`session_start` 在此触发——**在消息渲染之前**，注释："resources are shown before messages"）。
- `renderInitialMessages()`：处理恢复会话的历史渲染（第 9 章的条目树 → 组件）。
- **两类观察者**：主题变更（invalidate + 边框色 + 重渲染）与 git 分支变更（仅重渲染——数据由 `footerDataProvider` 提供，第 0 节文件）。
- `await this.updateAvailableProviderCount()`（页脚显示可用供应商数）；`ui.renderNow()` **同步渲染一帧**（把完成态先落屏）；**语法高亮语言包异步加载**（`void ... .then`）——**重任务后台化**（加载完只 invalidate + 重渲染）。
- 【陷阱】`loadAllHighlightLanguages` 的回调里再查 `isInitialized`（**异步回调可能发生在 stop 之后**——防御"已经关了还在刷 UI"）。


##### 5. `run()`：启动检查 + 主循环

```typescript
	async run(): Promise<void> {
		await this.init();

		if (!process.env.PI_OFFLINE) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15_000);
			void refreshModelCatalogs(this.session.modelRuntime, controller.signal)
				.then(() => this.updateAvailableProviderCount())
				.catch(() => {})
				.finally(() => clearTimeout(timeout));
		}

		checkForNewPiVersion(this.version).then((newRelease) => { if (newRelease) this.showNewVersionNotification(newRelease); });
		this.checkForPackageUpdates().then((updates) => { if (updates.length > 0) this.showPackageUpdateNotification(updates); })
			.finally(() => { if (process.platform === "win32" && this.isInitialized) this.updateTerminalTitle(); });
		this.checkTmuxKeyboardSetup().then((warning) => { if (warning) this.showWarning(warning); });

		// ...（启动警告分发：diagnostics / migratedProviders / models.json error / modelFallbackMessage / crash / anthropic 订阅）
		void this.maybeWarnAboutAnthropicSubscriptionAuth();

		if (initialMessage) { try { await this.session.prompt(initialMessage, { images: initialImages }); } catch (e) { this.showError(...); } }
		if (initialMessages) { for (const message of initialMessages) { try { await this.session.prompt(message); } catch (e) { this.showError(...); } } }

		while (true) {
			const userInput = await this.getUserInput();
			try { await this.session.prompt(userInput); } catch (error) { this.showError(...); }
		}
	}
```

【注解（三段结构）】

1. **四个后台检查**（全部 `void`/`.then`——**不阻塞主循环**）：
   - 目录刷新（非离线；15 秒超时；成功后更新供应商计数；`.catch(() => {})` **吞掉刷新错误**——启动体验优先，错误已经由 `getError()` 在别处呈现）；
   - 版本检查 → 新版通知；
   - 包更新检查 → 通知；`.finally` 里有个 **Windows 专属修复**（注释："npm can overwrite the shared console title while checking extension package versions"——检查时 npm 可能改了控制台标题，恢复 pi 的标题）；
   - tmux 键盘配置检查 → 警告。
   - 【陷阱】四个都是"**发现什么就通知**"模式（`.then(if (x) show)`）——**启动路径零阻塞**；任何"启动时必须等待"的诱惑都被拒绝了（除了 init 里明确需要顺序的步骤）。
2. **启动警告的统一分发**：`startupDiagnostics` 按级别推给 `showError`/`showWarning`/`showStatus`；`migratedProviders`（迁移过的凭据）；`models.json` 错误；`modelFallbackMessage`（模型回退）；**崩溃记录**（`takeUnnotifiedCrash()`——取一条"未通知过"的崩溃，显示时间与消息 + "Run /bug to report it"）；Anthropic 订阅鉴权提示（`maybeWarnAboutAnthropicSubscriptionAuth`——只提示一次，旗标在字段里）。**第 8.3.2 节的"诊断收集、边界裁决"在交互层的最终呈现**。
3. **初始消息 + 主循环**：初始消息（来自 CLI 参数/管道）逐条 `prompt`（**错误就地显示、不退出**——交互模式下"报错后还能继续打字"）；主循环 `while (true)`：`getUserInput()`（等编辑器提交）→ `session.prompt`（**串行**——一次运行完再收下一个输入）→ 出错 `showError`。
   - 【陷阱】主循环**不处理"运行中再提交"**？——那是 `getUserInput` 与编辑器/队列的领域（流式期间的回车走 steer/followUp 的交互路径，第 6 章）；**主循环只负责"空闲时的下一次提交"**。读交互输入行为时要沿着 `getUserInput` 与编辑器事件继续往组件层读（本篇止于结构与顺序，具体提交分支以源码为准）。


##### 6. 交互模式与核心的边界（本节是结论）

| 维度 | 核心（AgentSession）负责             | 交互模式负责                                                                            |
| ---- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| 运行 | prompt 循环、工具、压缩、重试        | **触发 prompt 的时机**（编辑器/初始消息）                                         |
| 状态 | 唯一数据源（`session.state`/事件） | 把事件变成组件更新、把状态变成页脚数字                                                  |
| 资源 | 会话/扩展/设置的拥有与释放           | 终端的启动、恢复、`stop()`                                                            |
| 扩展 | 扩展的运行与钩子                     | **提供交互上下文**（对话框/状态/widget/自定义编辑器）                             |
| 失败 | 错误成"结果"、事件携带原因           | 把原因显示成`showError/showWarning/showStatus`                                        |
| 顺序 | 不感知 UI                            | **承接全部启动顺序问题**（UI 先于扩展、颜色先于头部、工具后于挂载、消息后于资源） |

【核心结论】交互模式的复杂度全在**"顺序与体验"**：把 200 行的启动序列拆成十二步后，你会发现**每一步的注释都在回答"为什么不能更早/更晚"**——这正是 247KB 文件里最应该被精读的部分（其余是大量组件的重复模式）。


##### 7. 阅读检查清单

- [ ] 我能说出 `createInteractiveTuiReference` 这个 Proxy 解决的问题与代价吗？
- [ ] 我知道 `chat-viewport` 里 `minSize: 3` 与 `grow/basis` 的分工吗？
- [ ] 我能背出 init 十二步里"为什么 UI 必须先于扩展""颜色必须先于头部""工具必须后于挂载"的原因吗？
- [ ] 我知道启动期编辑器只绑了哪三个动作、为什么吗？
- [ ] 我能说出 `run()` 的四个后台检查与"零阻塞"原则吗？
- [ ] 我知道主循环的 `while(true)` 与流式排队（steer/follow-up）的分工吗？

---

> D13 完。精读篇（D1-D13）覆盖：循环、Agent、会话（投影/本体）、提示与压缩（读/写）、SDK、CLI、工具、扩展、模型层、协议模式、交互模式。

#### 17.12 常见错误

| 现象                     | 原因                                                              | 处理                                        |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------- |
| 中文/emoji 行错位        | 用`length`/`slice` 处理宽度                                   | 一律用 pi-tui 宽度工具（17.10）             |
| 界面闪烁/撕裂            | 绕过差分渲染自己画 ANSI                                           | 只通过组件与`requestRender`               |
| UI 不更新                | 改了状态没`invalidate()`                                        | 状态变化的组件必须失效缓存                  |
| 切换主题后旧颜色残留     | 把带色字符串存进了状态                                            | 渲染现算，或在`invalidate()` 重建         |
| 输入法候选框位置飘       | 容器没把`focused` 传给 `Input/Editor`，或缺 `CURSOR_MARKER` | 17.4.2 两条要求                             |
| overlay 关了但交互没结束 | 调了`hide()` 而不是完成回调                                     | `ctx.ui.custom` 的 overlay 用完成回调结束 |
| overlay 复用导致状态串   | 一个实例跑了多次交互                                              | 一交互一实例                                |
| 新增快捷键改键位文件无效 | 代码写死了`matchesKey`                                          | 进默认键位表 + 通过键位系统查询（17.9.4）   |
| 常规模式下鼠标不生效     | 常规模式鼠标归终端                                                | 设计键盘路径；只有全屏才路由组件            |
| Windows 下某些键不工作   | 终端保留/改写了组合键（super 需 Kitty 协议）                      | 查`terminal-setup.md` 与平台默认键位表    |


#### 17.13 验收题

1. 差分渲染与同步输出（CSI 2026）分别解决什么问题？两者为什么互补？
2. 列出"每行适配宽度"的四个工具函数，并解释为什么不能按字符数算。
3. 自定义带边框输入区时，为了中文输入法位置正确，必须做哪三件事？
4. `ctx.ui.custom()` overlay 的结束方式？为什么不能对 Hide 调用 `hide()`？焦点如何交还？
5. `theme.style()` 中"前景 token 与背景 token"的互换怎么做？为什么不能长期存储带色字符串？
6. 新增一个快捷键的完整步骤（用户配置、代码默认表、平台差异、验证命令）？
7. 复现一个宽度问题的实验流程（tmux 会话、缩放、最小组件、原始日志）？


##### 参考答案（要点）

1. 差分渲染减少更新量、避免重绘闪烁；同步输出让"一帧的多次写"在终端上原子呈现；两者结合=只写变化且写到一半不会被看到。
2. `visibleWidth`、`truncateToWidth`、`sliceByColumn`、`wrapTextWithAnsi`；ANSI 零宽、CJK 双宽、emoji/组合字符长度不定，字符数不等于列数。
3. 组件实现 `Focusable` 并在视觉光标前放 `CURSOR_MARKER`；容器把 `focused` 状态传给子组件；使用内置 `Input/Editor`（而非自绘光标）。
4. 调工厂给的完成回调（resolve Promise 并销毁）；`hide()` 只是临时隐藏、交互仍活跃；焦点通过 overlay handle 显式释放/改焦点。
5. `{ fg: theme.colors.someBgToken }`（取具体色值放另一位置）；主题切换只能清渲染缓存，清不掉状态里固化的 ANSI。
6. 在 `keybindings.json` 支持覆盖（无需改代码即可生效）→ 代码里把默认值加进默认键位表（`TUI_KEYBINDINGS`/`KEYBINDINGS` 对应条目，含平台差异）→ `/reload` 或重启 → `/hotkeys` 验证；不要硬编码按键判断。
7. tmux 起 80x24 → 输入中文/emoji/长行 → `resize-window` 到 40 → 组件级最小复现（两版实现对照）→ `PI_TUI_WRITE_LOG` 看原始字节 → 产出"输入+宽度+序列+期望/实际"说明。


#### 17.14 源码依据

- `packages/coding-agent/docs/tui.md`（集成点、组件模型、宽度、键盘/IME、鼠标、overlay、主题、性能）；
- `packages/coding-agent/docs/keybindings.md`、`docs/themes.md`、`docs/terminal-setup.md`、`docs/windows.md`；
- `packages/tui/README.md` 与 `packages/tui/src/index.ts`（组件与工具导出）；
- `packages/coding-agent/src/core/keybindings.ts`（`KEYBINDINGS`、`useWindowsKeybindings`、`AppKeybinding`）；
- 示例：`examples/extensions/preset.ts`、`tools.ts`、`qna.ts`、`modal-editor.ts`、`custom-footer.ts`、`widget-placement.ts`、`overlay-qa-tests.ts`、`doom-overlay/`；
- `.pi/skills/interactive-testing.md`（tmux 交互测试指引）。


---

## 动手任务 A：构造错位。

在自己的新测试文件写入下面的基线。运行后再加入 `"🙂界🙂"`、组合字符 `"e\u0301"`，把宽度改为 4、8、40 分别比较。

```typescript
import assert from "node:assert/strict";
import { it } from "node:test";
import { truncateToWidth, visibleWidth } from "../src/utils.ts";

it("measures terminal columns rather than string length", () => {
  const plain = "A中文B";
  const styled = `\x1b[31m${plain}\x1b[0m`;
  assert.equal(plain.length, 4);
  assert.equal(visibleWidth(plain), 6);
  assert.equal(visibleWidth(styled), 6);
  assert.ok(visibleWidth(truncateToWidth(styled, 4)) <= 4);
});
```

另外故意实现一版 `text.slice(0, width)`，给相同输入写断言；预期它至少在一个中文、emoji 或 ANSI 用例上不能同时保持宽度与完整字符。保留失败输入作为最小复现。

## 动手任务 B：交互复现。

写一个最小组件，其 `render(width)` 只返回 `truncateToWidth("A中文B🙂", width)` 这一行。用 8→4→8 三次调用模拟窗口缩放，逐次断言 `visibleWidth(line) <= width`，记录每次返回的行与光标预期列。再给组件加 ANSI 样式，重复测试。若纯组件通过而真实界面仍错位，排查方向应转到布局、overlay、光标或终端状态；若纯组件失败，先修宽度处理。

## 实验记录

1. 对同一个输入分别测量 JS 字符串长度和 `visibleWidth`。给出至少一个两者不相等的例子，写下“组件能占用多少列”的计算方法。
2. 在固定宽度下先渲染、再缩窄、再放宽，记录每次行数、每行可见宽度、光标位置。检查 ANSI 色彩控制序列是否错误地占用显示列。
3. 用只含文字的最小组件重复实验，再加入输入框或 overlay。如果仅后者出错，缩小到布局或焦点层；如果两者都出错，先查通用宽度函数。
4. 交付一个无需模型的回归测试和一页复现说明，写明终端尺寸、输入文本、操作顺序、期望与实际。

若测试文件无法加载，先确认 Node 版本与本包测试使用的 `node --test` 入口；若你所在平台对 emoji 显示宽度不同，以 `visibleWidth` 的仓库契约和当前测试为准，记录平台差异。实验结束只处理自己新建的测试文件。

## 验收标准

能复现并定位一类宽度错误；能说明哪个工具处理“显示列数”，哪个层处理“键盘输入”；测试不依赖真实模型。
