# 第 23 章：Chord 与 durable 持久执行（选修）

> 学完本章你能回答：
>
> 1. "存了聊天记录"和"能恢复执行"的本质差别是什么？
> 2. Chord 解决什么问题？facets、services、replicated state、delta tracking 各是什么？
> 3. durable 的 Harness / Conversation / Entry / Commit / Document / Task / Submission 各是什么？
> 4. 崩溃恢复靠什么保证？"意图先落盘、结果可重放"如何落地？
> 5. durable 与常规 pi 会话（第 3、9 章）在概念上如何一一对应？

**前置知识**：第 3、6、9 章（循环、会话、条目）。Chord/durable 都是**实验性** API（版本间可能变化），本章以当前源码与文档为准。
**预计学习时间**：1.5 天（选修）。
**本章验证状态**：静态核对通过（`packages/chord/README.md`、`packages/durable/README.md`、`packages/durable/docs/spec.md` 目录与关键段落）。

---

## 23.1 问题：崩溃发生在"一半"的时候

常规会话（第 9 章）解决的是"**记录**"问题：消息、工具结果、压缩都盖进了 JSONL。但它对"**执行**"的保证有限：

```text
场景：用户提交任务 → 模型要求执行工具 → 工具改了文件 → 进程崩溃
问：重启后，这个任务是"未完成"还是"完成"？工具要不要重跑？
    重跑会不会把"已经删过的目录再删一次"？
```

常规 pi 的答案大体是："会话记录还在，用户自己看着办"——因为它的定位是交互式助手。而**durable** 的答案是一个工程声明：

> **Conversations, model turns, tool calls, and your own state are committed to storage before anything is shown. If the process dies mid-turn, reopening the storage picks the work up where it stopped.**

关键词：**先提交、再显示**；**恢复时从"最后检查点"继续**。这就是"持久执行"（durable execution）。

## 23.2 Chord：为"同一功能、多个环境"而生的组合运行时

`packages/chord` 是仓库里最"独立"的包——**不依赖任何其他 pi 包**，甚至可以给无关应用用。它解决的问题是（README 原话）：

```text
A single application feature may need to run in several environments:
for example, an agent worker, a terminal UI, and a remote WebUI.
Chord provides the generic machinery to write such extensions...
```

六个核心构件（每个都有精确的工程含义）：

| 构件 | 一句话 | 关键约束 |
|---|---|---|
| **Plugins / Facets** | 插件是同步的"装配单元"；facet 是插件的**分片**，可以被打包到不同进程/环境（worker、浏览器、TUI） | 宿主校验依赖图；provider 先于 consumer 激活；释放按依赖逆序 |
| **Services** | 类型化、稳定的 token；单例（singleton）或按 key 的动态实例（keyed） | 进程内可有"不受限 JS 契约"；远程暴露时只允许严格 JSON；**consumer 的 facade 在 provider 断开/替换时保持稳定** |
| **Replicated state** | 权威状态以**原子变更事务**发布：`change(context, callback)` | 草稿代理只在回调期间存在；consumer 收到完整不可变值；断开/替换后副本变为 unready，直到重新水合 |
| **Delta tracking** | 记录/合并 JSON 操作（字符串/数组操作、set、delete…） | 批**保证收敛**但不必最小/规范；应用无信任操作时做校验 |
| **Remote service sources** | 声明"我这个 facet 之外有哪些服务可用"，并为所需服务开绑定 | 逻辑调用/订阅经应用提供的适配器；**不规定分帧/路由/传输** |
| **Context** | 类似 Go 的 context：取消 + 调用域值 | 应用可携带权限/遥测，但 Chord 不依赖它们 |

从"学 pi"的角度，你不需要掌握 Chord 的全部实现；需要记住的是**durable 建在它上面**：文档状态（documents）、订阅、远端传送都是 Chord 能力。

### 23.2.1 两个必须理解的设计点

**（1）replicated state 的所有权模型**（README 的 delta 一节）：

- `track(initial)` / `replicatedState(initial)` **接管**一个"无别名、严格 JSON"根值，不做防御性拷贝、不冻结；
- 通过草稿写入的值**已经拷贝**；准备（prepare）不改变权威，**采纳（adopt）**才切换根指针；
- **发布的不可变值不要改**——进程内回环 consumer 可能共享容器；改了就破坏权威（"mutating a consumed value violates the contract and can corrupt authority"）。

**（2）订阅的"帧数策略"**（背压的另一种解法）：

- 每个订阅最多保留 **100 个待交付的完整值**（不含正在回调的那个）；
- 溢出时**只保留最新值**（外加未开始的首次水合）；因此**交付序列允许跳号**；
- provider 侧订阅：最多 100 个待发更新，第 101 个到来时用 `{ type: "reset", snapshot }` **整体重置**——客户端必须处理"重置"这条元操作（早于后续普通 delta）。
- 内部"精确操作订阅"仍是同步的、不丢帧；慢的是**公共完整值回调**。

这套设计对应第 16 章的背压思想：**宁可发"最新快照"，也不让慢读者拖垮系统。**

### 23.2.2 Facet 打包与加载（与第 12 章的呼应）

`@earendil-works/chord/bundler` 用 esbuild 把入口打成**内容寻址的独立 CJS**：

- 插件在 `package.json` 的 `chord.facets` 里声明各分片入口；peerDependencies 外置（由宿主解析）；
- 输出目录含各 `.cjs` 与 `chord-facets.json` 清单；
- Node 装载器每次 `load()` **校验 SHA-256 完整性**，用 `node:vm` 直接编译 CJS（不进 Node 模块缓存）；外部依赖经受限 `require`；
- **热替换**：先加载候选 → `FacetHost.reload()` → 成功后再释放旧代（"没有不可用窗口"——稳定服务句柄不断开）。

对照第 13 章的扩展重载：思想相同（候选—切换—退役），只是粒度更重（进程/环境级）。

## 23.3 durable：把 agent 变成"可恢复的状态机"

### 23.3.1 概念表（`durable/README.md`）

| 概念 | 定义 |
|---|---|
| **Harness** | 一个打开的存储 + 在其上跑 agent 的全部机械；**所有变更经一条原子提交线**；"没提交就不显示" |
| **Conversation** | 一份转录（transcript）；`root()` 首次使用即创建根会话；句柄无状态，按 `id` 比较 |
| **Entry** | 不可变转录记录：`pi.user`、`pi.assistant`、`pi.tool-result`、`pi.system`、`pi.reset`……以及你自定义的 kind；**模型只看"最近一次 reset 之后"的条目** |
| **Commit** | 原子写：`commit((tx) => ...)` 可以同时追加条目、编辑文档、创建任务——**要么全存，要么全不存** |
| **Document** | 转录旁的**类型化 JSON 状态**，随提交变更；内置文档：`pi.agent`（agent 选择）、`pi.provider`（供应商侧会话身份）、`pi.live`（运行中的生成与工具）、`pi.inbox`（排队提交）、`pi.usage`（花费） |
| **Task** | **持久状态机**：每步保存检查点，重启后从最后检查点继续；每个任务有属主（其会话或另一个任务） |
| **Submission** | 交给会话的东西（用户输入或一条要写的条目），可等待其结果 |
| **Turn / run** | turn = 一次模型响应 + 它的工具调用；run = 从一条输入到最终答案的全部 turn |
| **Extension / Registry** | 扩展 = 工具/系统提示分节/钩子/包装器/任务的命名包；registry = 本进程安装的扩展集合，**运行中可变**（新工作用新状态） |
| **Agent** | 一个会话运行所需的：模型、思考级别、所选扩展、工具、指令、工作目录；**按名字存储**，每次使用时在 registry 上解析 |

### 23.3.2 一次"回答输入"的完整轨迹（官方示例）

```text
submit(input) → pi.user
  pi.generation → pi.system（仅当提示或工具变化）、pi.assistant（含工具调用）
    pi.tool × n → pi.tool-result × n   （属于该 generation，被它等待）
  pi.generation → pi.assistant（最终答案）→ submission done
```

对照第 6 章：

| 常规 pi | durable |
|---|---|
| `AgentSession.prompt` | `conversation.submit` |
| turn 循环 | `pi.generation` / `pi.tool` 任务（每次一个检查点） |
| 工具结果消息 | `pi.tool-result` 条目 |
| 系统提示补丁 | `pi.system` 位置性条目（只重发变化，保温供应商缓存） |
| 排队（steer/followUp） | `pi.inbox` + `whenBusy` 语义 |
| 用量统计 | `pi.usage` 文档 |

### 23.3.3 持久化、恢复与幂等

```typescript
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const harness = await Harness.open(await openNodeSqliteStorage("./session.sqlite"), { models, registry }, context);
const root = await harness.root(context);   // 与上次相同的根会话
harness.resume();                            // 继续上次进程未完成的工作
```

四条关键事实：

1. **崩溃/关闭后，未完成的工作保持 pending**；`resume()` 启动任务调度器（submit/wait 也会启动）；
2. **供应商会话身份**（UUIDv7）持久在 `pi.provider`，作为 `sessionId` 传给 pi-ai——跨重开、重试、reset、压缩、换模型都存活；**子会话/fork 获得全新身份**；
3. **重复提交幂等**：带同一 `requestId` 的提交返回既有 submission（示例中重启后用同一 `requestId` 找到同一条）；`harness.submission(id)` 可按 id 重新取得；
4. **恢复的是"任务"，不是"请求"**：任务在每一步有检查点，恢复从最后检查点继续——这正是与"只存消息"的本质差别。
## 23.4 工具即任务：`replay` 与"中断"的精确语义

durable 里**每个工具调用都是自己的持久任务**（`pi.tool`），关键规则（README原文要点）：

```text
Each call runs as its own durable task. Its intent is committed before `execute()` runs.
If the process dies mid-call, the tool reruns on reopen only when it is declared
`replay: "safe"`; otherwise the model gets an `interrupted` error result with the output
committed so far.
```

对照第 7 章的 `AgentTool.replay`（`"never" | "safe"`，当时是"持久执行恢复策略"）——这里就是它的消费方：

| 崩溃时工具状态 | `replay: "safe"`（如纯读） | `replay: "never"`（如发邮件、扣款） |
|---|---|---|
| 意图已提交、执行未完成 | 重开后**重跑** | **不重跑**；模型收到 `interrupted` 错误结果 + 已提交的部分输出 |

三条配套语义：

1. **`api.output()` 是流式输出**：`execute()` 没有返回 `content` 时，之前流出的内容成为结果；
2. **抛错 = 错误结果**（与第 7 章一致）；结果可带 `usage`（计入会话用量）、可返回 `control: { terminate: true }`——**整轮所有结果都要求 terminate 时，run 结束且不再请求模型**（与第 7.5.4 节的批次语义一致）；
3. **同名工具后装覆盖先装**；`wrapTool()` 给"最终获胜的那个"做装饰（Venv/Timing 示例）。

定义工具（durable 风格）：

```typescript
const count = defineTool({
	name: "count",
	description: "Count from 1 to n",
	parameters: Type.Object({ n: Type.Number() }),
	execute: async (args, api) => {
		for (let i = 1; i <= args.n; i++) api.output(`${i}\n`);
		return {};
	},
});
registry.install(defineExtension({ name: "count", tools: [count] }));
```

## 23.5 Agent 配置、扩展与运行环境

### 23.5.1 每个会话一个 `pi.agent`

`configure()` 一次提交改完；**未设置的字段跟随宿主默认**：

```typescript
await root.configure({
	model: { provider: "openai", modelId: "gpt-6-sol" },
	thinkingLevel: "high",
	extensions: { remove: [Coding] },   // 也可传数组=精确选择（按顺序）
	tools: [readTool, bashTool],        // 数组=精确提供；{ remove: [...] }=去掉某些
	instructions: "Only read; never edit files.",
	cwd: "/work/repo",
}, context);
await root.configure({ tools: null }, context);   // null = 清回宿主默认
const agent = await root.agent(context);          // 解析后的模型/扩展/工具/分节/cwd
```

两个"超出常规 pi"的设计：

- **扩展与工具按名字存储**："存下来的名字比代码活得久"——扩展卸载后，选择它的会话只是暂时拿不到它，装回来就恢复；
- **请求的定型时点**：模型、提示、提供的工具在**请求被准备时**固定；改动从下一次请求生效——但**工具调用与钩子按任务阶段解析**、环境按每次使用时的 `cwd` 构建，所以"cwd/扩展的变化能触达模型已发出的调用"。

### 23.5.2 扩展、重载与设置

- 扩展 = `{ tools, sections, hooks, wraps, tasks }` 的命名包；`defineExtension()` 声明；默认"每个已安装扩展都被每个会话选中（按安装顺序）"；
- **重载**：同名安装**原地替换**；已开始的工作用旧代码跑完（每个任务阶段开始时解析一次钩子与 agent）；重启后重新安装同名扩展，其 `tasks` 的待办继续；
- **设置是活的**：`settings` 每次使用都读取、从不存储（getter 可接设置文件）——`extensions` 默认选择、`stream.timeoutMs`、`retry.maxRetries`、`compaction.reserveTokens`、`toolExecution` 等；
- **环境**（`env`）：为每次工具调用/分节渲染构建执行环境（`NodeExecutionEnv({ cwd })`）；`env` 抛错 = 该调用的错误结果；没有环境时内置工具报错。`ExecutionEnv.id` 决定"哪些调用共享文件系统"——**文件变更按 `id + 路径` 串行**（与第 7.10 节同名思路）。

## 23.6 监视：UI 看到的一切都是"已提交状态"

```typescript
const view = await root.viewState(context);
view.subscribe((value) => {
	// value.entries              活动转录
	// value.docs["pi.live"]      运行中的生成（流式部分/重试/延迟）与工具（输出、details）
	// value.docs["pi.inbox"] / "pi.usage" / "pi.agent" / "pi.provider"
	render(value);
});
```

- `watch()` 给出"与提交精确对应的 Chord 操作"（可转发给远端客户端应用）；
- **慢订阅者的帧策略**：最多 100 个未交付帧，溢出后用**最新整帧**替换；迟到/重连的客户端从当前视图开始（**不重放历史**）；
- **部分输出最多每 100ms 提交一次**——所以"崩溃最多丢这一个窗口"（这是"先提交再显示"的可量化保证）。

## 23.7 Busy 会话与队列语义

会话在 run 中是 busy；此时提交由 `whenBusy` 决定：

```typescript
await root.submit({ type: "input", content: "Also run the tests" }, context);                  // follow-up（默认）
await root.submit({ type: "input", content: "Use pnpm, not npm", whenBusy: "steer" }, context);
await root.submit({ type: "input", content: "Only if idle", whenBusy: "reject" }, context);   // 抛 ConversationBusy
await root.submit({ type: "write", entry: { kind: "app.note", data: "user opened a file" } }, context);
```

对照第 6 章：**语义命名刻意与 steer/follow-up 一致**；差别在于队列是**持久文档**（`pi.inbox`），崩溃后还在。"reject" 则把"忙时拒绝"变成显式契约。

## 23.8 常规 pi 与 durable 的对照总结

| 维度 | 常规 pi（第 3、9 章） | durable |
|---|---|---|
| 存储单元 | 树形条目（JSONL） | 转录条目 + 文档 + 任务（可换 SQLite/JSONL） |
| 追加方式 | `appendMessage` 等（append-only） | `commit(tx)`（多对象原子事务） |
| 执行保证 | "记录"（尽力） | "检查点"（每步提交，崩溃可续） |
| 工具崩溃恢复 | 无内建重放语义（靠会话记录人工处理） | `replay: "safe"` 自动重跑；否则 `interrupted` |
| 排队 | 内存队列（第 6 章） | `pi.inbox` 持久文档 |
| 扩展 | 进程内注册（第 13 章） | registry + **按名选择**、原地热替换 |
| 会话身份 | `sessionId`（第 3 章） | `pi.provider` 持久 UUIDv7（跨重试/reset/压缩存活） |
| 视图 | 事件订阅（第 4 章） | 已提交状态的 Chord 订阅（帧策略/重置） |
| 成熟度 | 主线产品 | **实验性**（API 随时变） |

一句话：**durable 把"事件驱动的尽力记录"升级为"事务驱动的前置提交"**——代价是更多约束（所有异步调用带 Context、值所有权严格、扩展按名解析），收益是"崩溃不丢工作"。

## 23.9 选修实验 L14：中断恢复轨迹

**实验性质**：本地运行（离线优先）；选修。
**验证状态**：设计中。规划文档 L14 的目标是"中断恢复、断连重附着 → 持久化与路由时序图"；本章先做"中断恢复"的一半（"断连重附着"在第 24 章）。

### 步骤

1. **起一个内存/SQLite 的 Harness**（`MemoryStorage` 或 `openNodeSqliteStorage("./exp.sqlite")`）；
2. **让模型可离线**：把 faux provider 注册进 `createModels()`（`models.setProvider(...)`），用脚本化响应驱动一次"输入 → 工具 → 答案"；
3. **模拟崩溃**：任务进行到工具阶段时**不 close、直接丢弃 harness 引用**（进程内模拟"忘记清理"）；或写到脚本里在 `pi.tool` 意图提交后 `process.exit()`（真崩）；
4. **恢复**：重新 `Harness.open(同一 storage)` → `harness.resume()`；
5. **断言与观察**：
   - `pi.live` 里是否重新出现运行中的 generation/tool？
   - 工具是重跑了（safe）还是得到 `interrupted`（never）？
   - 重复提交同一 `requestId` 是否返回同一条 submission？
   - `pi.provider` 的会话身份是否保持不变？fork/子会话是否换新？
6. **画图**：按规划要求输出"持久化时序图"（提交点标在"显示"之前）。

### 判定标准

- 能指出"最后一个检查点"具体是哪条记录；
- 能解释一次真实副作用（写文件）在两种 `replay` 下的不同结局；
- 恢复过程中未出现"重复答案"（同一 submission 只有一条最终答案）。

### 清理

删除实验用的 sqlite/临时脚本。

## 23.10 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 重启后工作没继续 | 没调 `resume()`（或没重新 submit/wait） | `harness.resume()` 启动调度器 |
| 重复提交产生两份工作 | 没传 `requestId` | 用稳定的 `requestId`；`harness.submission(id)` 找回 |
| 工具"莫名被重跑" | 声明了 `replay: "safe"` 但幂等性不成立 | 有副作用的工具用 `"never"`（或自己做幂等键） |
| 改扩展没生效 | 已开始的任务阶段仍用旧代码 | 等下一阶段/下一次请求；重载按设计是"原地替换、新工作用新代码" |
| 会话改为 `null` 不生效 | `null` 是"清回宿主默认"而非"什么都不选" | 精确选择传数组；去掉某些用 `{ remove: [...] }` |
| 慢客户端导致跳帧/重置 | 100 帧策略 + `reset` 语义 | 客户端必须实现"reset 先于后续 delta"（第 23.2.1 节） |
| 崩溃窗口内输出丢失 | 部分输出最多每 100ms 提交一次 | 这是设计上限；需要更细粒度就改架构而非"运气提交" |
| 把 durable 当稳定 API 用 | 包自述 Experimental | 版本升级前读 README/spec 变更 |

## 23.11 验收题

1. 用一段话解释"存了聊天记录"与"持久执行"的区别（提示：检查点、前置提交、重放策略）。
2. Chord 的六大构件各解决什么？`change()` 的所有权/草稿/采纳规则是什么？
3. durable 的 Commit 为什么要求"原子"？举一个需要"多对象同事务"的例子。
4. `replay: "safe"` 与 `"never"` 在崩溃时分别发生什么？分别适合什么工具？
5. `pi.provider` 的作用？什么情况下会换新身份？
6. 慢订阅者为什么允许跳帧？客户端必须处理哪一条特殊操作？
7. 列出常规 pi 第 6 章的队列语义与 durable `whenBusy` 的对应关系。

### 参考答案（要点）

1. 记录只追加事实，恢复时由人或上层推断；持久执行把"意图"先事务性提交、每步有检查点，重启后从最后检查点继续，并用重放策略决定副作用是否重做。
2. Plugins/Facets（跨环境分片）、Services（稳定 token/facade）、Replicated state（原子发布）、Delta tracking（操作批）、Remote sources（远程边界）、Context（取消/调用域值）。change()：草稿仅在回调中存在；成功发布恰好一个原子版本；失败原值不动；采纳才切换权威。
3. 因为"转录条目 + 文档 + 任务"必须共同推进，例如"追加用户输入 + 记账 + 创建生成任务"不能只发生一部分。
4. safe：重跑；never：不重跑，模型收到 interrupted（含已提交输出）。safe 适合读操作/幂等操作；never 适合有真实副作用的非幂等操作。
5. 传给 pi-ai 的会话身份（缓存/亲和）；重开、重试、reset、压缩、换模型不变；fork/子会话获得新身份。
6. 因为背压策略是"最新值优先"（100 帧上限）；客户端必须处理 `{ type: "reset", snapshot }`（重置早于后续 delta，路径字典重启）。
7. followUp（默认）↔ follow-up；steer ↔ steering；reject ↔ ConversationBusy（常规 pi 是"必须显式给 streamingBehavior，否则拒绝"——同为显式契约）。

## 23.12 来源与下一章

- `packages/chord/README.md`（facets、services、replicated state、delta、远端适配、打包/加载/热替换、订阅帧策略）；
- `packages/durable/README.md`（概念表、快速开始、持久与恢复、扩展/工具/环境/重载、监视、busy、用量、存储）；
- `packages/durable/docs/spec.md`（规格目录：术语与不变量、核心记录、文档、事务与存储所有权、任务与"effect sandwich"、提交与收件箱、扩展与钩子、内置任务、观察、存储契约、后端、footguns、non-goals）。

下一章是另一条"跨进程"主线：实验性的 client/server 协议——serverId/sessionId/attachmentId、握手、CBOR 分帧、订阅快照与断连重附着。