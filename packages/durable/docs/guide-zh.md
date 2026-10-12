# pi-durable 完整学习手册（中文）

> 对象：`packages/durable`，npm 包名 `@earendil-works/pi-durable`，实验性 API，版本之间可能不兼容。
> 主线材料三份：`packages/durable/README.md`（包的自述，面向使用者）、`packages/durable/docs/spec.md`（规范性规格，本文所有「应该 / 必须」的最终依据）、`packages/durable/src/`（61 个源文件，17,716 行，本文所有「实际实现」的依据）。
> 实测环境：Node v23.9.0 / Windows。文中标注「你会看到」的输出都来自真实运行。
>
> 本文约定：
>
> - 源码引用写成 `包内相对路径:起-止行`，例如 `src/session/transaction.ts:120-180`；示例引用写成 `test/examples/14-chat.ts:31-37`。
> - 伪代码统一用 ```text 代码块，真实代码用 ```typescript。
> - 名词一律保留英文（Commit、Entry、Document、Task、Phase、Checkpoint、Submission、Hook、Wrap……），中文只用于解释；完整对照见第 8.1 节术语表。
> - 「规范」指 `docs/spec.md`，「README」指包自述，「实测」指本机运行结果。
> - 本手册按「先直觉 → 再结构 → 再源码」的顺序组织；只想用 API 的读者可以跳过第 4 部分，想改内核的读者请按顺序读。

---

## 目录

- [第 0 部分：前置知识](#第-0-部分前置知识)
  - [0.1 这份手册怎么用](#01-这份手册怎么用)
  - [0.2 必备概念：崩溃、幂等与持久执行](#02-必备概念崩溃幂等与持久执行)
  - [0.3 Chord 前置：Context、提交线与状态](#03-chord-前置context提交线与状态)
  - [0.4 pi-ai 前置：模型、消息、工具与 faux provider](#04-pi-ai-前置模型消息工具与-faux-provider)
  - [0.5 运行环境与子路径导入](#05-运行环境与子路径导入)
  - [0.6 怎么跑示例、跑测试、读源码](#06-怎么跑示例跑测试读源码)
- [第 1 部分：全景](#第-1-部分全景)
  - [1.1 一个具体的事故，和三个危险窗口](#11-一个具体的事故和三个危险窗口)
  - [1.2 核心规则与八条不变式](#12-核心规则与八条不变式)
  - [1.3 分层、数据流与职责边界](#13-分层数据流与职责边界)
  - [1.4 记录与标识（Id / Seq / Cursor）](#14-记录与标识id--seq--cursor)
  - [1.5 一次输入的完整时间线](#15-一次输入的完整时间线)
  - [1.6 源码地图：61 个文件各自负责什么](#16-源码地图61-个文件各自负责什么)
  - [1.7 速查术语表](#17-速查术语表)
- [第 2 部分：关键类逐个精讲](#第-2-部分关键类逐个精讲)
  - [2.1 Storage：三种后端与存储契约](#21-storage三种后端与存储契约)
  - [2.2 Session：一条提交线 + 五张记录表](#22-session一条提交线--五张记录表)
  - [2.3 Tx：事务里能做什么](#23-tx事务里能做什么)
  - [2.4 Entry：不可变转录条目](#24-entry不可变转录条目)
  - [2.5 Document：类型化 JSON 状态](#25-document类型化-json-状态)
  - [2.6 ContextView：转录如何变成模型上下文](#26-contextview转录如何变成模型上下文)
  - [2.7 Task：持久状态机](#27-task持久状态机)
  - [2.8 Scheduler：调度、唤醒与中止](#28-scheduler调度唤醒与中止)
  - [2.9 Submission 与 Inbox](#29-submission-与-inbox)
  - [2.10 Harness：顶层门面](#210-harness顶层门面)
  - [2.11 Conversation：会话句柄](#211-conversation会话句柄)
  - [2.12 Registry 与 Extension](#212-registry-与-extension)
  - [2.13 Agent 与 Settings：按会话 vs 宿主级](#213-agent-与-settings按会话-vs-宿主级)
  - [2.14 Prompt：系统提示的渲染与差量](#214-prompt系统提示的渲染与差量)
  - [2.15 Environment：执行环境](#215-environment执行环境)
  - [2.16 Tool 运行时：一次工具调用的完整生命周期](#216-tool-运行时一次工具调用的完整生命周期)
  - [2.17 View 与 Watch：把状态交给 UI](#217-view-与-watch把状态交给-ui)
  - [2.18 Agent Events：高层事件流](#218-agent-events高层事件流)
  - [2.19 Task Graph：活任务图](#219-task-graph活任务图)
  - [2.20 Usage：用量与花费](#220-usage用量与花费)
  - [2.21 Testing：断言、运行器、一致性套件与基准](#221-testing断言运行器一致性套件与基准)
- [第 3 部分：内建任务与自写任务](#第-3-部分内建任务与自写任务)
  - [3.1 三个内建任务总览](#31-三个内建任务总览)
  - [3.2 pi.generation：一个 run 的推进器](#32-pigeneration一个-run-的推进器)
  - [3.3 pi.tool：意图先于执行](#33-pitool意图先于执行)
  - [3.4 pi.compaction：压缩](#34-picompaction压缩)
  - [3.5 工具轮、run 的边界与控制](#35-工具轮run-的边界与控制)
  - [3.6 恢复语义速查：崩溃后每个环节会发生什么](#36-恢复语义速查崩溃后每个环节会发生什么)
  - [3.7 写自己的持久任务：从零到上线](#37-写自己的持久任务从零到上线)
- [第 4 部分：源码逐文件精读](#第-4-部分源码逐文件精读)
  - [4.1 包根](#41-包根)
  - [4.2 session/](#42-session)
  - [4.3 harness/ 核心](#43-harness-核心)
  - [4.4 harness/ 生成栈](#44-harness-生成栈)
  - [4.5 harness/ 配置与提示](#45-harness-配置与提示)
  - [4.6 harness/ 观察与支持](#46-harness-观察与支持)
  - [4.7 storage/](#47-storage)
  - [4.8 env/ 与 tools/](#48-env-与-tools)
  - [4.9 testing/](#49-testing)
- [第 5 部分：示例逐题精讲](#第-5-部分示例逐题精讲)
  - [5.1 怎么读这些示例](#51-怎么读这些示例)
  - [5.2 A 组：Session 底层（00–05）](#52-a-组session-底层0005)
  - [5.3 B 组：Harness 基础（06–13）](#53-b-组harness-基础0613)
  - [5.4 C 组：agent 运行时（14–21）](#54-c-组agent-运行时1421)
  - [5.5 D 组：进阶模式（22–31）](#55-d-组进阶模式2231)
  - [5.6 32 个示例总索引](#56-32-个示例总索引)
- [第 6 部分：测试地图](#第-6-部分测试地图)
  - [6.1 84 个测试文件总览](#61-84-个测试文件总览)
  - [6.2 关键行为断言精选](#62-关键行为断言精选)
  - [6.3 崩溃恢复类测试的设计](#63-崩溃恢复类测试的设计)
  - [6.4 一致性套件与基准](#64-一致性套件与基准)
- [第 7 部分：实战手册](#第-7-部分实战手册)
  - [7.1 常见问题（FAQ）](#71-常见问题faq)
  - [7.2 陷阱清单](#72-陷阱清单)
  - [7.3 选型与部署](#73-选型与部署)
  - [7.4 性能与调优](#74-性能与调优)
  - [7.5 API 速查](#75-api-速查)
- [第 8 部分：附录](#第-8-部分附录)
  - [8.1 术语表（完整版）](#81-术语表完整版)
  - [8.2 行号索引](#82-行号索引)
  - [8.3 实测记录（32 个示例）](#83-实测记录32-个示例)
  - [8.4 延伸阅读与源码对照](#84-延伸阅读与源码对照)

---

# 第 0 部分：前置知识

这一部分不涉及任何 durable 的实现细节，只补齐「读这个包之前必须先有的东西」。如果你已经熟悉「持久化执行（durable execution）」这个概念、用过 Chord 的 `Context`、用 pi-ai 调过模型，可以直接从第 1 部分开始，遇到不懂再回来查。

## 0.1 这份手册怎么用

### 0.1.1 四种读者，四条路线

| 你是 | 你关心什么 | 建议路线 | 预估 |
|---|---|---|---|
| **使用者**：把 durable 当库用，写自己的 agent / 产品 | API 怎么调、语义边界在哪、踩什么坑 | 0.1 → 0.2 → 0.4 → 0.5 → 1.5 → 2.10–2.13 → 2.17 → 3.7 → 5（示例）→ 7 | 1–2 天 |
| **集成者**：把 durable 接进 TUI / HTTP 服务 / 现有框架 | 状态怎么订阅、事件流、忙时行为、多进程 | 0.2 → 1.3 → 2.17–2.19 → 3.5 → 7.3 | 半天 |
| **内核改造者**：改调度器、加内建任务、优化存储 | 每个类的不变式、调度算法、崩溃语义 | 按顺序通读，重点 2.2–2.9、3.1–3.6、4、6 | 3–5 天 |
| **评审者**：判断这个包能不能托付生产 | 设计是否自洽、崩溃语义是否闭合、边界条件 | 0.2 → 1.2 → 3.6 → 6.3 → 7.2–7.4 | 半天 |

### 0.1.2 各部分的定位

- **第 0 部分（本节所在）**：外部依赖与运行环境。这里出现的东西在后续章节被反复引用，但不会再解释。
- **第 1 部分（全景）**：先建立「这个包由什么组成、数据怎么流、崩溃时谁负责什么」的整体图。读完应当能画出一张分层图并说出八条不变式。
- **第 2 部分（关键类逐个精讲）**：本文的主体。每个类一节，结构固定为：**它是什么 → 它负责什么 → 它不负责什么 → 关键方法与伪代码 → 关键代码（带中文注释）→ 不变式与边界 → 常见误解**。这一部分回答「怎么用」和「为什么这样设计」。
- **第 3 部分（内建任务与自写任务）**：三个内建任务（`pi.generation`、`pi.tool`、`pi.compaction`）逐个 phase 精讲，再加一份「从零写一个持久任务」的完整教程。这一部分回答「一轮对话在持久层到底发生了什么」。
- **第 4 部分（源码逐文件精读）**：61 个源文件，每个文件一节，偏机械、偏细节，用于查阅与改造。行号引用都在这里。
- **第 5 部分（示例逐题精讲）**：32 个可运行示例，每个示例「运行命令 → 逐行注释 → 实测输出 → 动手改 → 对应源码」。这是最好的练习题来源。
- **第 6 部分（测试地图）**：84 个测试文件、27,962 行在断言什么。当你怀疑某条规则时，测试是最快的证据。
- **第 7 部分（实战手册）**：FAQ、陷阱清单、选型、性能、API 速查。日常查阅主要看这里。
- **第 8 部分（附录）**：术语表、行号索引、实测记录、延伸阅读。

### 0.1.3 三份材料的关系，以及「冲突时信谁」

这个包有三份互相补充的文档，读的时候很容易混：

| 材料 | 性质 | 什么时候看 | 冲突时 |
|---|---|---|---|
| `README.md` | 面向使用者的自述，章节与概念命名（Extensions、Tools、Settings……） | 想知道某个功能「叫什么、怎么开」 | 以源码为准 |
| `docs/spec.md` | 规范（normative）。定义记录、不变式、契约，但**不保证实现完全跟上** | 想判断「这个行为是设计意图还是 bug」 | 规范描述意图，源码描述现状；两者都列出 |
| `src/` | 实现。17,716 行，61 个文件 | 想知道「到底怎么做的」 | 最终依据 |

本手册采取的态度：**先讲源码事实，再引规范解释意图，最后标注二者的差**。凡是本手册写「规范要求」的段落，都能在 `docs/spec.md` 里找到对应小节；写「实现是」的段落，都能在 `src/` 里找到行号。

另外三份设计文档值得知道存在：`docs/pico-v5-handoff.md`（实现计划，讲分层理由）、`docs/pico-v5-chord-usage.md`（这个包怎么用 Chord 的文档/事务/watch，是理解文档层的钥匙）、`docs/chord-delta-findings.md`（delta 与 checkpoint 策略的实测发现）。

### 0.1.4 阅读时的几条纪律

1. **区分「这次调用」和「这份工作」。** 这是全文最容易被误解的一点：传给异步 API 的 `context` 只控制「这一次调用」的取消；工作本身（模型生成、工具执行、任务）不受它影响。停工作要 `conversation.abort()` / `harness.abortTask()`。详见 0.3.2。
2. **区分「提交态」和「内存态」。** 存储里只有提交态；UI、日志、监控能看到的也应当只有提交态。任何「我先更新内存、等会儿再落盘」的想法都和这个包的设计相冲突。
3. **每读一条规则，问一句「崩溃点在它中间会怎样」。** 这个包的全部设计都是为了回答这个问题。
4. **看到 `[待核]` 标注时，把它当成「有证据但没被直接钉死」。** 这类句子表示：结论来自代码结构、注释或相邻测试的间接证据，规范与测试**没有**直接固定该行为；本手册宁可标出来，也不编造确定性。全部待核点都可以在对应用例与源码注释里复核。

---

## 0.2 必备概念：崩溃、幂等与持久执行

这一节是全文的地基。durable 的每一个 API 形状，都是下面这些约束的直接结果；如果你觉得某个设计「绕」，回到这一节通常能找到原因。

### 0.2.1 崩溃模型：进程可以在任意两条指令之间消失

先做一个思想实验。你写了一个最朴素的 agent 循环：

```text
while (true) {
  reply = await model(messages)          // 调模型
  if (reply.hasToolCalls) {
    for (call of reply.toolCalls) {
      result = await runTool(call)       // 跑工具（读文件、跑命令、发请求）
      messages.push(result)              // 追加进历史
    }
  } else {
    print(reply.text)                    // 展示给用户
    break
  }
}
```

这段代码在 demo 里永远是对的，因为它默认「进程活着、内存不丢」。真实环境里这个默认不成立：用户按 Ctrl+C、笔记本合盖、容器被 OOM Kill、宿主机重启、CI 超时、函数计算实例被回收。业界把这种环境叫**崩溃模型（crash model）**：进程可能在任意两条指令之间消失，且消失时不执行任何清理代码（没有 `finally`、没有 `process.on('exit')`）。

崩溃模型下，「内存里的状态」和「已经发生的外部副作用」会脱节。下一节把脱节拆成三个具体的窗口。

### 0.2.2 三个危险窗口

把上面那段循环的每一处 `await` 都当成一个可能的崩溃点，会得到三类事故：

**窗口 A：输出了一半。** 模型流式吐出了 900 个 token，崩溃发生在第 901 个 token 之前。内存里的半截回答随进程消失，用户重开后看到空白，只能重问一遍。更糟的是重问会再花一次钱。

**窗口 B：副作用做完了，但结果没记下来。** 工具已经执行完了：文件改了、订单下了、邮件发了。崩溃发生在 `messages.push(result)` 之前。重开后，历史里没有这条工具结果，模型会认为「这个调用还没做」，于是再调用一次——文件被改第二遍、订单下了两笔。

**窗口 C：输入收下了，但还没处理。** 用户在模型回答到一半时又输入了一句「顺便把测试跑了」。程序把它放进内存队列，还没轮到这个队列，进程死了。这句话凭空消失——注意这不是「处理失败」，是**用户说过的话丢了**。

三类窗口的共同点是：**副作用已经发生（或用户已表达），但记录还没落盘。** 只要记录落后于现实，重启就必然做出错误决策（重复做、或者根本不继续）。

### 0.2.3 为什么不能简单地「只做一次」

初学者常有的直觉是：「那我保证这段逻辑只执行一次不就行了？」崩溃模型下这句话无法直接实现，原因是**执行和记录是两次独立的写**：

```text
t0: 打算做 X          （还没做）
t1: 做了 X            （现实变了）
t2: 记录「X 做过了」   （需要落盘）
```

如果 t1 和 t2 之间崩溃，重放时你无法区分「X 还没做」和「X 做过了但没记」。想真正区分，需要业务侧提供一个**幂等键**：同一把键做两次，效果等同于做一次。这就是分布式系统里的经典结论：

- **at-least-once（至少一次）**：实现容易（重试即可），代价是可能重复。
- **exactly-once（恰好一次）**：在崩溃模型下不存在「纯靠框架实现」的版本；能实现的是「at-least-once + 幂等」或「at-least-once + 去重」。
- **at-most-once（至多一次）**：崩溃时选择「不重跑」，代价是可能什么都没做（durable 用它来处理「不可重跑」的工具，见下）。

durable 在框架层面对这三者各留了位置：

| 策略 | durable 里对应什么 | 例子 |
|---|---|---|
| at-least-once + 幂等 | 工具声明 `replay: "safe"`，执行体自己幂等 | 子 agent 工具：重跑时用 `scanConversations({ ownerTaskId })` 找回已建的子会话 |
| at-least-once + 去重 | 固定 `requestId`，同一 id 只准入一次 | 重发同一条用户消息不会问两遍 |
| at-most-once | 工具不声明 `replay`（默认 `unsafe`），崩溃中断后不重跑，模型收到 `interrupted` 结果 | 「发一封邮件」这类不可重复的副作用 |

**记住这张表**：第 3.6 节把它展开成「每个环节崩溃后会发生什么」的完整速查。

### 0.2.4 提交（Commit）：一次原子写

不能只靠「小心地写」解决，那就换一个结构：把「一次逻辑更新」变成一个**原子写**，落盘成功才算数。这个原子写就是 **Commit（提交）**。

```text
session.commit(async (tx) => {
  entry = await tx.appendEntry(chatId, { kind: "pi.user", data: ... })  // 写转录
  (await tx.doc(Todos, chatId)).items.push("a")                        // 改文档
  await tx.createTask(Payment, { amount: 5 }, { ownership })            // 建任务
  return entry
}, context)
```

三条规则：

1. **回调里的写要么全部落盘、要么一条不留。** 回调抛错 = 这笔提交作废（规范不变式 1：一笔 Session 提交对所有记录与文档写是原子的）。
2. **回调里不允许有外部副作用。** 不能在提交回调里调模型、起进程、发网络请求（规范不变式 4：外部效果不在 Session 变更事务内执行）。原因：这个回调会被重试、会被回滚，而外部世界不会跟着回滚。提交回调只做「把已决定的事实写下来」这一件事。
3. **只有提交成功之后，变化才能被观察。** 规范不变式 2、3、7 说的都是这件事：文档更新在存储提交成功后才发布；没有易失的发布路径；提交线一路持有到「存储结算 + 提交态采用」完成。

### 0.2.5 检查点（Checkpoint）与持久状态机

原子提交解决了「一笔写要么全有要么全无」，但一轮对话显然不止一笔写。一个 run 可能包含：写用户条目 → 写系统提示 → 调模型 → 写 assistant 条目 → 建 N 个工具任务 → 写 N 条结果 → 再调模型 → …… 每一步都可能崩。

durable 的答案是：把这条链做成**持久状态机**，每一步结束时把「下一步该干什么」和这一步已经发生的事实**写在同一笔提交里**。这个「下一步」就是 **Checkpoint（检查点）**。

```text
普通函数：       输入 → [所有步骤都在内存] → 输出          崩溃 = 全部重来
持久任务：       输入 → phase1 → commit(检查点=phase2,副作用记录) → phase2 → commit(终局)
                                      ↑ 崩溃只能丢「最后一个未提交的动作」
```

这就是 durable 里 **Task** 的本质（第 2.7 节）。写任务时有一条黄金法则：

> **先保存你要做什么（意图）→ 去做（副作用）→ 保存结果（检查点）。**

推演一下崩溃点：

| 崩在哪 | 重开后会发生什么 |
|---|---|
| 保存意图之前 | 这一步没发生过，从头做 |
| 保存意图之后、副作用之前 | 这一步会被重跑：副作用还没做，正确 |
| 副作用之后、保存结果之前 | 这一步会被重跑：副作用**做第二遍**，所以执行体必须幂等 |
| 保存结果之后 | 从结果继续，不会重跑 |

最后一行是关键：**「重跑」这件事不是异常，而是常态**。写任务时每一段都要假设自己被跑过好几次。

### 0.2.6 落盘粒度：WAL、fsync，与「最多丢 100ms」

「提交成功」到底意味着数据在哪一层？durable 的三种后端给的保证不同：

| 后端 | 提交成功的含义 | 崩溃语义 |
|---|---|---|
| Memory | 只是进入内存数据结构 | 进程退出即全丢；只适合测试与 demo |
| SQLite | 一次 SQLite 事务提交；WAL 模式 + `synchronous = NORMAL` | 进程崩溃可幸存；断电 / 宿主机故障可能丢最新若干提交 |
| JSONL | 一个追加写落盘（默认不 fsync，可传 `{ fsync: true }`） | 未 fsync 时与 SQLite 类似；fsync 后每笔提交都强刷 |

也就是说，「提交先于展示」并没有魔法地把数据送进磁盘的最内层；它保证的是**可见性与存储状态一致**。代价上限在文档里被明确写成一句话：流式输出与工具输出**至多每 100 ms 提交一次**，因此崩溃最多损失这个窗口。这个 100ms 是硬编码的节流窗口（见 `src/harness/output.ts` 与 generation 的流式提交路径，第 3.2 节与 4.4 节）。

顺带一个反直觉的结论：**「丢 100ms 输出」比「丢整个回答」好，但比「丢 100ms 输出且副作用重复」好得多。** durable 把两者的处理分开：输出可以丢窗口，副作用不能重复——所以才有 `replay` 声明（0.2.3 的表）。

### 0.2.7 结构化并发：所有权、自底向上中止、background 边界

崩溃恢复解决了「怎么继续」，还剩「怎么停止」。普通并发里 `abort()` 是个开关，durable 把它做成一棵树：

- 每个 Task 有一个 **owner**：要么是某个会话（`{ kind: "conversation" }`），要么是另一个任务（`{ kind: "task", taskId }`）。子 agent 的子会话就是被一个工具任务拥有的。
- **abort 自底向上传播**：中止一个任务，先中止它拥有的工作（子任务、子会话），等它们都收尾完，才运行这个任务自己的 abort 处理器。于是「每个任务负责撤销自己的副作用」成为结构性保证，而不是纪律问题。
- **`background: true` 是边界**：这类任务拥有的工作可以躲过父级的普通 `abort()`，也不让父级「忙」。常驻后台 subagent 就建立在这条边界上（示例 `23`）。
- 一个推论：**「会话空闲」的定义是「它拥有的前台工作全部排空」**。前台 subagent 没答完，父会话就一直 busy。

第 2.8 节讲调度器怎么实现这套规则，第 3.6 节给出每种中止路径的可观察结果。

### 0.2.8 事实与视图：为什么历史永远不删

最后一个概念，也是最优雅的一个。

如果「模型看到了什么」是可以被就地修改的（比如压缩时把旧消息删掉、编辑时把旧消息改掉），那么：

- 审计不可能（历史被改过，你无法证明模型当时看到了什么）；
- 恢复不可能（崩溃后重放需要原始事实，而已被改写）；
- 并发不可能（有人在改历史，有人在读历史）。

durable 的做法是把两者分开：

> **历史（entries）是事实来源，永远只追加、永不修改；模型上下文是这份事实的派生视图（derived view）。**

压缩、编辑、重置都**不删除任何东西**，只是追加一条「新的解读方式」：

- **`head` 标记**：某条 entry 带 `head: "self"`，表示「从这里开始是新上下文」，更早的 entry 仍在存储里，但不再进入模型请求（压缩摘要、reset 都用它）。
- **`edits` 字段**：一条 entry 可以声明「我替换/省略了更早某条 entry 对模型的贡献」。编辑过的用户消息不是改旧条目，而是追加一条带 `edits` 的新条目。

这条设计同时解释了本包敢说「never lose」的原因：UI 上的东西都是提交态，存储里的东西只增不减，模型上下文随时可以从事实重新算出来。

### 0.2.9 代价：什么时候不该用它

天下没有免费的午餐，这套设计换来崩溃恢复，代价是：

1. **所有变更必须走提交**，不能随手改个变量再「稍后同步」。
2. **任务代码必须按「保存意图 → 执行 → 保存结果」写**，且每一步都要能接受重跑。
3. **概念比普通 agent 框架多**：Entry、Document、Task、Submission、Owner、Replay……这正是本手册存在的原因。
4. **写放大**：流式输出每 100ms 一笔提交，状态下沉到存储，比纯内存实现慢（第 7.4 节给出量级与调优手段）。

判断标准很简单：**你的程序会不会因为一次崩溃而丢失用户可见的进度或重复副作用？** 会，就值得用它；不会（一次性脚本、纯演示），它可能太重。

---

## 0.3 Chord 前置：Context、提交线与状态

durable 站在 `@earendil-works/chord` 上（包版本 `^1.0.2`，源码在 `packages/chord/src`，约 8,300 行）。你不需要读懂 Chord，但必须知道它在这个包里扮演的三个角色：**取消语义的载体（Context）**、**变更串行化的载体（提交线 + 事务草稿）**、**状态观察的载体（delta / 文档状态 / watch 帧）**。

### 0.3.1 Context：取消令牌，不是「工作开关」

Chord 的 `Context` 接口只有三个成员（`packages/chord/src/types.ts:15-19`）：

```typescript
/** Immutable invocation-scoped values passed explicitly through operations. */
export interface Context {
	readonly abortSignal: AbortSignal | undefined;
	value<T>(key: ContextKey<T>): T | undefined;
	toString(): string;
}
```

- `abortSignal`：这次调用是否已被取消。它是 `AbortSignal`，所以 `signal.aborted` / `signal.reason` / `addEventListener("abort", ...)` 都能用。
- `value(key)`：调用范围内携带的额外值（权限、遥测上下文等）。`ContextKey` 是一个带类型标记的 symbol 包装（`packages/chord/src/types.ts:8-12`），用途和 React 的 context key、Go 的 `context.WithValue` 一样。
- `toString()`：调试用的自描述字符串，例如 `[Context BACKGROUND_CONTEXT]`。

两个现成常量、四个派生函数（`packages/chord/src/context/index.ts`）：

| 名称 | 位置 | 含义 |
|---|---|---|
| `BACKGROUND_CONTEXT` | `context/index.ts:55` | 永不取消。示例里到处出现的 `const context = BACKGROUND_CONTEXT` 就是这个 |
| `TODO_CONTEXT` | `context/index.ts:56` | 占位用的空 context，语义上表示「还没想好传什么」 |
| `createContextKey<T>(description)` | `context/index.ts:58-60` | 建一把类型化的 key |
| `withContextValue(key, value, parent)` | `context/index.ts:63-65` | 派生一个新 context，携带一个值；父 context 不变 |
| `withAbortSignal(signal, context)` | `context/index.ts:71-75` | 派生一个「父信号或给定信号任一中止即中止」的 context（内部用 `AbortSignal.any`） |
| `withoutAbortSignal(context)` | `context/index.ts:78-80` | 去掉取消能力，**只用于必须执行的清理** |
| `withCancel(context)` | `context/index.ts:83-92` | 派生一个可独立取消的子 context，返回 `{ context, cancel }` |

还有一个工具函数 `awaitWithContext(promise, context)`（`context/index.ts:98-116`），它的注释把整个 Chord 的取消哲学写得很清楚：

```typescript
/**
 * Observe a promise until it settles or the invocation is cancelled.
 * Cancellation rejects only this waiter; it does not cancel the underlying promise.
 */
export function awaitWithContext<T>(promise: Promise<T>, context: Context): Promise<T>
```

翻译过来就是本文反复强调的第一条纪律：**取消的是「你在等」这件事，不是「工作在跑」这件事**。实现上它只是给 signal 挂一个 `abort` 监听，取消时 `reject` 这个等待者，原 promise 继续跑。

在 durable 里，这条规则的表现是：

```text
submission.wait(cancelledContext)  →  抛错：你不再等了
                                      模型还在跑，输出还在按 100ms 窗口提交
                                      之后可以用 harness.submission(id) 重新拿句柄接着等
conversation.abort(context)        →  真正停掉工作（撤回排队输入、中止任务及其拥有的工作）
harness.abortTask(id, context)     →  真正停掉某个任务（先自底向上中止它拥有的工作）
```

**怎么传 context**：durable 的每个异步 API 都把 `context` 放在最后一个参数。子任务、工具、section 渲染里的代码会拿到一个「本次调用」的 context；把调用方的 context 继续往下传是默认礼仪（`docs/pico-v5-chord-usage.md:10`：「转发调用方的 context」）。

### 0.3.2 提交线与事务草稿

Chord 的 `ReplicatedState` 提供「原子发布一次同步变更」的能力；durable 把 Session 的**全部变更**放在**一条串行化的提交线**上。

```text
session.commit(callback, context)
   ├─ 申请提交线（同一时刻只有一个提交在跑；后来的排队）
   ├─ 回调里拿到 tx：
   │    await tx.doc(TodosDoc, chatId)  → 返回草稿（draft）
   │    直接改草稿；赋进去的对象被「按值复制」，且必须是严格 JSON
   ├─ 回调结束（return / throw）的瞬间：
   │    草稿全部同步「prepare 或 abort」，句柄立刻失效（规范不变式 6）
   ├─ 准备结果（值 + 精确 op 批次）交给 Storage，落盘
   ├─ 落盘成功 → 采用（adopt）新值 + 排队发布；仍持有提交线
   └─ 释放提交线 → 投递已提交的 ops 给本地/远程订阅者
```

几个必须记住的点：

1. **草稿只在回调内有效。** 回调一结束，草稿（以及草稿里嵌套的对象、绑定的数组方法）全部失效。不要把它存进变量留到下一个提交——`docs/pico-v5-chord-usage.md:370` 把它列为头号 footgun。
2. **赋进草稿的值是按值复制的。** `draft.strokes.push(stroke)` 里 `stroke` 会被复制；你之后改原对象不影响已提交的值。
3. **提交回调是「同步准备 + 快速落盘」，不是「慢工作」。** 不要在提交回调里等模型、等进程、等网络、等人（规范不变式 4）。等待放进 phase 里，用 commit 只落盘结果。
4. **不确定的存储失败是致命的**（规范不变式 8）：它什么都不发布，并把当前 Session「毒化」，正确做法是关闭并重新打开，而不是继续用。
5. **提交线一直持有到「存储结算 + 提交态采用」完成**，这样「提交成功的顺序」和「观察到的顺序」一致。

### 0.3.3 delta：文档变更被表示成一串操作

durable 的文档（Document）不是「存一个 JSON 快照」，而是「存一个完整基准（base）+ 一串 Chord 操作（op）」；到一定条件再写一个新 base。op 的七种元组（`packages/chord/src/delta/README.md:153-166`）：

| 元组 | 含义 |
|---|---|
| `["r", value]` | 整值替换（root replace） |
| `["s", path, value]` | 设置对象属性 / 数组元素 |
| `["d", path]` | 删除对象属性 / 移除数组元素 |
| `["a", path, text]` | 字符串尾部追加 |
| `["t", path, count]` | 从字符串**头部**删除 `count` 个 UTF-16 码元 |
| `["p", path, index, remove, items]` | 数组 splice |
| `["m", path, permutation]` | 数组重排：`new[i] = old[permutation[i]]` |

这几种操作之所以被特别保留，是因为它们正是「流式输出」需要的最小集合：`["a"]` 对应「追加一段文本」，`["t"]` 对应「裁掉前面一段」（有界窗口），`["r"]` 对应「整段替换」（比如输出被折叠时）。第 5 部分示例 `21-late-join.ts` 的合并算法就是围绕它们写的。

什么情况下写 base、什么情况下只写 delta，由每个文档定义的 `checkpointWhen(value, ops, info)` 决定：它返回 `true` 时，这一笔提交会写入完整基准而不是增量（`info.deltasSinceBase` 是当前累计的增量数）。durable 内部的 `pi.live`、`pi.usage` 等文档都用了这个机制（第 2.5 节）。

### 0.3.4 观察：帧、背压与 hydrate/update

Chord 的状态订阅有两个必须知道的行为：

- **每个订阅串行投递**，异步回调不会被并发调用；
- **慢消费者保护**：最多积压 **100 帧**，超过后**只用最新的一帧（完整值）替换待投递队列**，因此订阅者可能「跳号」。这是帧数策略，不是字节数策略。

投递回调拿到 `(value, context, delivery)`，其中 `delivery.kind` 是 `"hydrate"`（首帧，完整值）或 `"update"`，`delivery.sequence` 是该订阅自己的流序号（**不是** Session 的提交号，见 `docs/pico-v5-chord-usage.md:20-22`）。

durable 在这个基础上做了两套面向 UI 的封装（第 2.17 节）：

| API | 你拿到什么 | 适合谁 |
|---|---|---|
| `conversation.viewState(ctx)` | 一个只读 Chord 状态：`value` 是结构化视图（entries + docs），`subscribe` 收完整值 | 本地 TUI，自己渲染一切 |
| `conversation.watch(ctx)` | 快照 + **每笔提交的精确 ops**（`watch.start(async (value, ops) => ...)`） | 远端客户端、带宽敏感 |
| `watchEvents(harness, id, ctx)` | 高层 agent 事件（`message_start`、`tool_execution_end`……），每笔提交一批 | 对接现成的 coding-agent 事件协议 |

以及文档级的 `harness.watchDoc(...)` / `harness.documentState(...)`（第 2.5、2.17 节）。

### 0.3.5 durable 与 Chord 的分工边界

记住这条分界线，读源码时就不会迷路：

```text
Chord 知道：Context（取消）、事务与提交线、文档值的表示（base + ops）、状态订阅与帧背压
Chord 不知道：conversation、entry、task、submission、owner、replay —— 这些全是 durable 的概念

durable 知道：上面这些全部
durable 不直接用的 Chord 部分：facet / service / 远程绑定 / bundler（那是给「跨进程组装应用」用的，
                              durable 只把文档状态暴露成 Chord 状态，让需要远程同步的宿主自己接）
```

`docs/pico-v5-chord-usage.md` 把「文档 → 视图」的映射也写清楚了：内置文档按**稳定的 kind** 挂到视图的 `docs` 下（`docs["pi.live"]`、`docs["pi.inbox"]`……），第三方文档**不会自动挂载**，要用它们自己的服务或 watch（`docs/pico-v5-chord-usage.md:334-351`）。

---

## 0.4 pi-ai 前置：模型、消息、工具与 faux provider

第二个依赖是 `@earendil-works/pi-ai`（包版本 `^1.0.2`）。它提供模型访问、消息类型、工具参数校验，以及测试用的假模型。你只需要五组东西。

### 0.4.1 Models 与 provider

```typescript
import { createModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

const models = createModels();          // MutableModels：可注册 provider
models.setProvider(openaiProvider());   // 按 provider.id 覆盖注册（key 从 OPENAI_API_KEY 读）
const model = models.getModel("openai", "gpt-6-sol");   // Model<Api> | undefined
```

`Models` 接口（`packages/ai/src/models.ts:244-353`）里与 durable 相关的主要成员：

| 成员 | 作用 |
|---|---|
| `getModel(provider, id)` | 同步查表（拿最近一次已知的模型列表），返回 `Model<Api> \| undefined` |
| `getModels(provider?)` / `getAllModels(provider?)` | 列举模型 |
| `stream(model, context, options?)` | 返回 `AssistantMessageEventStream`（异步可迭代 + 事件回调） |
| `complete(model, context, options?)` | 一次性拿完整 `AssistantMessage` |
| `streamSimple / completeSimple` | 统一接口版本（不需要显式 api 类型） |
| `getAuth / login / logout` | 认证解析与 OAuth 登录 |

`MutableModels`（`models.ts:355-360`）额外有 `setProvider` / `deleteProvider` / `clearProviders`。

**同名陷阱**：这里 `stream(model, context, options)` 的 `context` 是 pi-ai 的 `Context`（`packages/ai/src/types.ts:734-738`）：

```typescript
export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}
```

它是**转录上下文**（要发给模型的消息与工具列表），和 Chord 的 `Context`（取消令牌）**完全不是一个东西**，只是撞名。本手册统一叫前者「pi-ai 的转录 context」，后者「Chord 的 context」。durable 在内部把它们分得很清楚：generation 任务自己构造转录 context，同时把 Chord 的 context 一路往下传。

durable 会往请求 options 里塞两个和会话身份有关的字段：`sessionId`（来自 `pi.provider` 文档里的 UUIDv7）与 `cacheRetention`（prompt cache 保留策略）。它们的作用见 2.13 与 3.2 节。

### 0.4.2 消息类型：Entry 的 `model` 字段就是这些对象

durable 的每条 entry 有一个 `model` 字段（「给模型看的部分」），它的类型就是 pi-ai 的 `Message`（`packages/ai/src/types.ts:612`）：

```typescript
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;
```

四者的关键形状（摘录自 `packages/ai/src/types.ts:524-612`，省略了与本包无关的字段）：

```typescript
export interface SystemMessage {
	role: "system";
	content: string | TextContent[];          // 前导消息是基础提示；后续消息是追加指令
	sections?: Record<string, string | null>; // 命名段落：后写覆盖先写，null 表示移除
	toolsAdded?: Tool[];                      // 从这一刻起可用的工具（完整定义）
	toolsRemoved?: ToolReference[];           // 从这一刻起不可用的工具（按名字）
	timestamp: number;
}

export interface UserMessage {
	role: "user";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
}

export interface AssistantMessage {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	api: Api; provider: ProviderId; model: string;
	usage: Usage;
	stopReason: StopReason;
	deferred?: DeferredHandle;                // 延迟取回的响应（deferred）
	errorMessage?: string;
	timestamp: number;
}

export type ToolResultMessage<TDetails = JsonValue> = {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	isError: boolean;
	timestamp: number;
	details?: TDetails;                        // 结构化细节（durable 用它带 diagnostics）
};
```

三种内容块（`types.ts:397-427`）：`TextContent{type:"text",text}`、`ThinkingContent{type:"thinking",thinking}`、`ToolCall{type:"toolCall",id,name,arguments}`。

`StopReason`（`types.ts:452`）：`"pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred"`。durable 对它的用法：`toolUse` 表示这一轮要开工具任务；`aborted` / `error` 的 assistant 消息**不会**被送进模型上下文（示例 `09` 专门验证）；`deferred` 表示响应稍后取回。

`Usage`（`types.ts:429-450`）：`input / output / cacheRead / cacheWrite / totalTokens / cost{...}`，`reasoning` 与 `cacheWrite1h` 是可选细分。durable 把每个模型响应的 usage 累加进 `pi.usage` 文档（第 2.20 节）。

**`SystemMessage` 的位置性是理解 `pi.system` 的关键**：注释里说得很清楚——「前导 system 消息就是系统提示；后续的 system 消息改变它：`content` 追加指令，`sections` 按名字替换或移除段落，`toolsAdded` / `toolsRemoved` 改变工具集合。按顺序重放所有 system 消息，就得到当前的提示与工具集。」durable 的 `SystemEntry` 就是一条「位置性的 system 消息」（`src/entries.ts:19`：「Positional prompt and tool change: `model` is `[SystemMessage]` with empty `content`」），prompt cache 保温靠的就是这条设计（第 2.14 节）。

### 0.4.3 工具与参数校验

```typescript
export interface Tool<TParameters extends TSchema = TSchema> {
	name: string;
	description: string;
	parameters: TParameters;          // TypeBox schema
	constrainedSampling?: false | ConstrainedSamplingConfig;
}
```

- `ToolCall`（`types.ts:419-427`）是模型要求调用某个工具时给出的对象：`{ type: "toolCall", id, name, arguments }`。**`id` 是模型生成的**，工具结果要按 `toolCallId` 配对。
- durable 的工具参数用 TypeBox（`typebox` 依赖，版本 `1.3.27`）声明，`defineTool()` 从 schema 反推 `args` 的 TypeScript 类型。
- 校验发生在 `execute()` 之前，函数签名是 `validateToolArguments(tool: Tool, toolCall: ToolCall): any`（`packages/ai/src/utils/validation.ts:317`）。模型胡编的参数到不了你的代码；校验失败会变成一条 error 结果，模型可以自我纠正。
- 参数 schema 也会被序列化进 `SystemMessage.toolsAdded`，provider 侧可以做 constrained sampling（`constrainedSampling`）。

### 0.4.4 流式事件：15 种 `AssistantMessageEvent`

`Models.stream()` 返回一个可迭代的事件流，事件联合类型在 `packages/ai/src/types.ts:769-785`。完整清单：

| 事件 | 何时发 | 关键字段 |
|---|---|---|
| `start` | 流开始 | `partial`（当前完整快照） |
| `text_start` / `text_delta` / `text_end` | 文本块开始 / 增量 / 结束 | `contentIndex`、`delta`、`content`、`partial` |
| `thinking_start` / `thinking_delta` / `thinking_end` | 思考块同上 | 同上 |
| `toolcall_start` / `toolcall_delta` / `toolcall_end` | 工具调用同上（`delta` 是**参数 JSON 的文本片段**） | `toolCall`（结束时才有完整对象） |
| `done` | 正常结束 | `reason: "stop" \| "length" \| "toolUse" \| "deferred"`、`message` |
| `error` | 失败结束 | `reason: "aborted" \| "error"`、`error`（AssistantMessage） |

durable 的 generation 任务消费这个流，把 `_delta` 类事件按 ≤100ms 窗口提交成 `pi.live` 里的流式片段（第 2.17 节的增量编码就是从这些 delta 派生的）。**注意区分两层事件**：这一层是 **provider 流事件**；durable 还用同一套命名风格提供了自己的 **agent 事件**（`message_start`、`tool_execution_start`……），那是从**提交**派生的（第 2.18 节）。两者别混。

### 0.4.5 faux provider：没有 API key 也能跑

`fauxProvider()`（`packages/ai/src/providers/faux.ts:687`）是一个内存假模型：你给它一个剧本，它按顺序演出。所有示例几乎都用它，好处是**没有网络、没有花费、100% 可复现**。

```typescript
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";

const faux = fauxProvider();                      // 默认 provider id "faux"，默认模型 "faux-1"
const models = createModels();
models.setProvider(faux.provider);

faux.setResponses([
	fauxAssistantMessage("Paris."),                                          // 第 1 次请求 → 纯文本
	fauxAssistantMessage(                                                    // 第 2 次请求 → 工具调用
		[fauxThinking("先读文件"), fauxToolCall("read", { path: "notes.txt" })],
		{ stopReason: "toolUse" },
	),
	(context, options, state) => fauxAssistantMessage(`第 ${state.callCount} 次`), // 第 3 次请求 → 动态决定
]);
```

`FauxProviderHandle` 的完整 API（`faux.ts:146-156`）：

| 成员 | 说明 |
|---|---|
| `provider` | 交给 `models.setProvider()` 的 `Provider` 对象 |
| `api` | api id，默认 `"faux"` |
| `models` / `getModel()` / `getModel(id)` | 假模型定义与查询（`getModel()` 返回第一个） |
| `setResponses(list)` | **替换**剩余剧本队列 |
| `appendResponses(list)` | 追加剧本 |
| `getPendingResponseCount()` | 还剩几条剧本没演 |
| `state.callCount` | 已经处理过多少次请求（写动态剧本时有用） |

构造选项（`RegisterFauxProviderOptions`，`faux.ts:118-132`）：

| 选项 | 作用 |
|---|---|
| `api` / `provider` | 自定义 api id 与 provider id（想同时跑多个 faux 时必须区分，见下） |
| `models` | 模型列表：`{ id, name?, reasoning?, contextWindow?, maxTokens?, cost?, inputLimits? }` |
| `tokensPerSecond` | 按真实时间给流式分片限速（默认每片一个 microtask，跑得飞快） |
| `tokenSize` | 分片大小范围 |
| `deferred` | 模拟「延迟取回」的响应（`pendingFetches`、`pollAfterMs`） |

行为细节（`packages/ai/README.md:1506-1515`）：

- 剧本**按请求开始顺序**消费；队列空了会返回一条错误 assistant 消息，`errorMessage: "No more faux responses queued"`。
- usage 按「约 1 token / 4 字符」估算；带 `sessionId` 且 `cacheRetention !== "none"` 时会自动模拟 prompt cache 的读写。
- 工具调用参数以 `toolcall_delta` 分片流式给出。
- 「一个 handle 配一条确定性剧本」是推荐用法；需要**并发**的不同剧本，要建两个 provider id 不同的 faux（示例 `23` 用「按请求内容动态决定回复」让一个 faux 同时扮演主 agent 和子 agent，也是可行的）。
- 真的想打 OpenAI 就设 `OPENAI_API_KEY`（示例 `16`）；没设时示例会打印 `skipped` 并正常退出。

### 0.4.6 durable 与 pi-ai 的接缝

一张表收尾，列出 durable 从 pi-ai 取用的全部东西（这些在第 2、3 部分会反复出现）：

| durable 概念 | 来自 pi-ai 的什么 | 备注 |
|---|---|---|
| `models` 选项（`Harness.open` 必填） | `MutableModels`（`createModels()`） | 任务里用它查模型、发起 stream |
| entry 的 `model` 字段 | `Message` 家族 | `pi.user`→`UserMessage`，`pi.assistant`→`AssistantMessage`，`pi.tool-result`→`ToolResultMessage`，`pi.system`→`SystemMessage` |
| 工具定义与校验 | `Tool` + `validateToolArguments()` | schema 用 TypeBox 写 |
| 流式输出 | `AssistantMessageEvent`（15 种） | 由 generation 消费，节流提交 |
| 重试与错误分类 | `AssistantMessage.errorMessage`、`stopReason` | 溢出重试、取消、延迟响应都要看它 |
| usage / 花费 | `Usage`（含 `cost`） | 累加进 `pi.usage` |
| 会话身份 | `sessionId` / `cacheRetention` 请求选项 | 值来自 `pi.provider` 文档 |

---

## 0.5 运行环境与子路径导入

### 0.5.1 Node 版本与两个命令行开关

`packages/durable/package.json:99-101` 要求 `node >= 22.19.0`；本手册实测用 v23.9.0。这两个版本门槛来自两个实验特性：

**① `--experimental-strip-types`（类型擦除）**：让 Node 直接运行 `.ts` 文件。它只把类型标注删掉，不做任何代码生成，因此**代码里不能出现需要生成 JS 的语法**：`enum`、`namespace`、构造器参数属性（`constructor(private x: T)`）、`import =`、`export =`。这个仓库把这条限制写进了开发规则，所以你在 `src/` 里看到的所有类都是这样的写法（显式字段 + 构造器赋值）：

```typescript
export class Foo {
	readonly #bar: string;      // 显式字段
	constructor(bar: string) {  // 构造器里赋值
		this.#bar = bar;
	}
}
```

读源码时这点很有用：**没有任何「隐藏的运行时行为」来自类型系统**，类型纯粹是给人（和编译器）看的注释。

**② `--conditions=source`（条件解析）**：`package.json` 的 `exports` 每个入口都有 `source` 条件（`package.json:8-70`）。给 Node 传 `--conditions=source` 时，导入 `@earendil-works/pi-durable` 会解析到 `src/index.ts`（源码），而不是 `dist/index.js`（构建产物）。好处是改源码立即生效；代价是你在跑带 TypeScript 的源码，所以前一行的 `--experimental-strip-types` 必不可少。

跑任何示例的标准命令因此是（**在 `packages/durable` 目录下**）：

```bash
node --conditions=source --experimental-strip-types test/examples/14-chat.ts
```

### 0.5.2 子路径导入表

包的公开入口（`package.json:8-70`，11 个）：

| 导入路径 | 源码 | 提供什么 |
|---|---|---|
| `@earendil-works/pi-durable` | `src/index.ts` | 主入口：`Harness`、`createSession`、`MemoryStorage`、`defineDoc`、`defineEntry`、`defineTask`、`defineTool`、`defineExtension`、`hook`、`section`、`wrapTool`、`wrapSection`、`createRegistry`、`watchEvents`、`configure`、`ROOT_CONVERSATION_ID`，以及全部公开类型 |
| `./env` | `src/env/index.ts` | 执行环境的抽象：`ExecutionEnv`、`FileSystem` 等接口 |
| `./env/node` | `src/env/node.ts` | Node 实现：`NodeExecutionEnv` |
| `./tools` | `src/tools/index.ts` | 内建工具：`read`、`write`、`edit`、`bash` 与打包的 `CodingTools` |
| `./storage/memory` | `src/storage/memory.ts` | `MemoryStorage`（主入口也导出同一个） |
| `./storage/jsonl` | `src/storage/jsonl/index.ts` | JSONL 后端的**可移植核心**（不依赖 Node API） |
| `./storage/jsonl/node` | `src/storage/jsonl/node.ts` | `openNodeJsonlStorage(directory, context)` |
| `./storage/sqlite` | `src/storage/sqlite/index.ts` | SQLite 后端的可移植核心（依赖一个异步 `SqliteDatabase` 外观） |
| `./storage/sqlite/node` | `src/storage/sqlite/node.ts` | `openNodeSqliteStorage(file)`，基于 Node 内置 `node:sqlite` 的 `DatabaseSync` |
| `./testing` | `src/testing/index.ts` | 存储一致性套件、基准、断言助手 |
| `./package.json` | — | 版本号等元信息 |

**为什么要分子路径**：主入口会加载 TypeBox（工具参数校验需要），README 给出量级：未打包时峰值 RSS 约 +23 MB，tree-shaken 打包后约 4 MB（`README.md:556`）。只想要存储或环境抽象、不需要 agent 的场景，从子路径导入就不会背上这份开销。

### 0.5.3 依赖清单

| 依赖 | 版本 | 在本包里的角色 |
|---|---|---|
| `@earendil-works/chord` | `^1.0.2` | Context、提交线、文档状态与 delta（0.3 节） |
| `@earendil-works/pi-ai` | `^1.0.2` | 模型访问、消息类型、工具校验、faux provider（0.4 节） |
| `typebox` | `1.3.27` | 工具参数 schema（`Type.Object` 等） |
| `diff` | `8.0.4` | `edit` 工具的 diff 计算（`src/tools/edit-diff.ts`） |

开发依赖只有 `shx`（跨平台脚本）与 `vitest`（测试/基准）。SQLite 与 JSONL 都不依赖第三方驱动：SQLite 用 Node 内置的 `node:sqlite`，JSONL 用 `node:fs/promises`。

---

## 0.6 怎么跑示例、跑测试、读源码

### 0.6.1 跑示例

32 个示例都在 `test/examples/`，每个都是独立脚本、可单独运行。先确保仓库根目录已经 `npm install`（示例导入 workspace 包 `@earendil-works/pi-ai`、`@earendil-works/chord`，靠 `node_modules/@earendil-works/*` 的链接指到本仓库）。

```bash
cd packages/durable
# 单个：
node --conditions=source --experimental-strip-types test/examples/14-chat.ts
# 全部（bash）：
for f in test/examples/*.ts; do echo "== $f"; node --conditions=source --experimental-strip-types "$f"; done
```

Windows PowerShell 等价写法：

```powershell
cd packages\durable
Get-ChildItem test\examples\*.ts | ForEach-Object {
  Write-Host "== $($_.Name)"
  node --conditions=source --experimental-strip-types $_.FullName
}
```

几个预期内的「噪音」，不要当成错误：

- 每个脚本开头会打印 `ExperimentalWarning: Type Stripping`（用 SQLite 时还有 `ExperimentalWarning: SQLite`）。
- 示例 `16-real-model` 在没有 `OPENAI_API_KEY` 时打印 `skipped: OPENAI_API_KEY is not set` 并正常退出。
- 示例 `17`、`19` 会故意留下临时目录/SQLite 文件供检查（运行完会打印路径）；`13`、`23`、`24`、`30`、`31` 自己清理，其中 `30` 在 Windows 上收尾 `rm()` 可能报 `EBUSY`（退出码 1，功能断言全过）。
- 示例 `30`、`31` 会用 `process.kill` / 临时目录做「重启」实验，杀进程时看到非零退出码是设计的一部分。

三类「成品形态」示例值得先知道它们在模仿什么：`18-print`（像 `pi -p "问题"`，提交一次、打印答案、退出）、`19-json`（像 `pi --mode json`，把每个 agent 事件打成一行 JSON）、`22`–`31`（自带打印的产品级演示：子 agent、子任务、压缩、按会话隔离环境等）。

### 0.6.2 跑测试

测试共 84 个 `.ts` 文件、27,962 行（含 32 个示例与三个基准脚本），覆盖度很高；**当你怀疑某条规则时，测试是最快的裁判**。

```bash
# 包级：跑本包全部测试（vitest --run）
cd packages/durable && npm test

# 单文件（从包目录，跨平台写法）
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/harness-tasks.test.ts
```

仓库根目录还有一个 `test.sh`：它把非 e2e 测试跑在隔离的临时 HOME/环境里（避免测试碰到你真实的凭据与配置），是 CI 用的入口（需要 bash）。注意：e2e 测试只在设置了 endpoint/auth 环境变量时才会激活，普通开发不需要管。

基准测试（了解量级时用）：

```bash
cd packages/durable
npm run bench:storage          # vitest bench，存储后端对比
npm run bench:storage:memory   # 单跑内存后端
npm run bench:tool-output      # 工具输出提交的开销（需要 --expose-gc）
```

### 0.6.3 读源码的六条路径

这个包的源码有 61 个文件，直接从头读会迷路。推荐按下面的顺序接近它：

1. **先看导出面**：`src/index.ts`（182 行）列全了包对外的所有名字。读一遍就知道「这个包提供什么」。
2. **再看类型总表**：`src/types.ts`（989 行）定义 Id、Entry、Document、Task、Tx、Storage 等核心结构。这是唯一一处「把全貌写在一页里」的地方。
3. **找规范对应小节**：`docs/spec.md` 的目录（第 1–13 节）与源码目录几乎一一对应：`## 3. Documents` ↔ `src/documents.ts`、`## 5. Tasks` ↔ `src/tasks.ts` + `src/harness/scheduler.ts`、`## 8. Built-in tasks` ↔ `src/harness/{generation,tool,compaction}.ts`。规范写意图，源码写现状。
4. **grep 调用点**：想知道某个函数被谁调用、在什么时机被调用，直接在 `src/` 里搜名字（例如搜 `resume(`、`placeInbox(`、`commitStreaming(`），比读注释快。
5. **用测试找反例**：每条规则通常至少有一个测试在断言它。文件名与主题对应得很直白：`harness-submissions.test.ts`（提交与忙时放置）、`harness-tools-recovery.test.ts`（工具崩溃恢复）、`harness-compaction.test.ts`（2,164 行，压缩的所有分支）、`sqlite-storage.test.ts` / `jsonl-storage.test.ts` / `memory-storage.test.ts`（后端）、`storage-conformance-*`（一致性套件）。
6. **用示例做最小复现**：想验证一个理解，写一个 20 行的脚本（照抄对应示例的开头），比在脑子里推理可靠。

### 0.6.4 关于本手册的练习

第 5 部分的每个示例讲解里都有一节「动手改」，那是刻意设计的练习：每条都会让你把某个机制**改坏**，观察崩溃或语义的差别（例如去掉 `requestId`、把 `replay` 改成 `unsafe`、删掉 `runtime.memo`）。这类「改坏 — 观察 — 改回」的过程，比读十遍设计文档更能建立直觉。

---

# 第 1 部分：全景

第 0 部分讲的是「为什么需要持久化」与外部依赖。这一部分把镜头拉到中间：这个包由哪些部分组成、数据怎么流、崩溃时每一层各负责什么。读完这一部分，你应该能在白纸上画出分层图、说出八条不变式、并解释一次输入从提交到答案的全部提交点。

## 1.1 一个具体的事故，和三个危险窗口

抽象地讲「崩溃会丢状态」很难建立直觉。看一个具体的事故。

### 1.1.1 事故现场

场景：用户在一个 Web 应用里对 agent 说「把这个仓库里失败的测试修好，然后提交」。agent 的循环按第 0.2.1 节的朴素写法实现，状态全在内存。

```text
14:02:00  用户输入 → 进内存队列
14:02:01  run 开始：调模型 #1（模型说：我先看一下失败原因）
14:02:05  工具 read(failing-test.log) 执行完，结果 push 进内存 messages
14:02:07  调模型 #2（模型说：我要改 three files）
14:02:12  工具 edit(a.ts) 执行完：磁盘上的 a.ts 已经改了     ← 副作用发生
14:02:13  工具 edit(b.ts) 执行完：磁盘上的 b.ts 已经改了     ← 副作用发生
14:02:14  进程被 OOM Kill                                   ← 崩溃
```

崩溃后的现实：**磁盘上 a.ts、b.ts 已被修改；内存里的 messages 全部消失**。

14:10 用户重新打开应用，看到的是一个空白的会话。他再问一次「修好测试并提交」，于是模型从零开始：重新读日志、重新改 a.ts / b.ts（可能改出不一样的结果）、再跑一次 `git commit`。这就是三个危险窗口在同一个事故里叠加的样子：

| 窗口 | 这次事故里的表现 | 后果 |
|---|---|---|
| A 输出丢了一半 | 模型 #2 已经想清楚要改哪三个文件，这部分推理消失 | 重问、重复计算、答案可能变差 |
| B 副作用重复或丢失 | a.ts / b.ts 已改，但「改过」这件事没记录 | 重复改；或者（如果第二次运行改了别的地方）工作互相覆盖 |
| C 输入丢失 | 用户后续又输入过一句「顺便把日志里的 warning 也清掉」 | 那句话永远消失，用户以为 agent 收到了 |

### 1.1.2 同一个场景，交给 durable

durable 对上面的循环做了三处结构性改动。逐条对上三个窗口：

**① 输入先落盘（对窗口 C）**：

```typescript
const submission = await root.submit({ type: "input", content: "把这个仓库里失败的测试修好，然后提交" }, context);
```

`submit()` 返回时，输入已经作为一条 `pi.user` entry 提交进存储了（不是「准备写」、不是「写进队列」，是已提交）。进程死在下一行，重启后这条输入仍在转录里，`harness.submission(id)` 还能拿回句柄继续等它被回答。

**② 每个工具调用先落盘「意图」（对窗口 B）**：

```text
pi.tool 任务的 phase 顺序（第 3.3 节展开）：
  intent   : commit(「我要执行 edit(a.ts)，参数是 {...}」)   ← 先落盘
  execute  : 真正调用 edit(a.ts)                             ← 副作用
  result   : commit(工具结果 + 下一个检查点)                  ← 结果与检查点同笔落盘
```

崩溃发生在 `intent` 与 `result` 之间时，重启后**能不能重跑是明确决定过的**：工具声明了 `replay: "safe"` 就重跑（执行体必须幂等），没声明（默认 `unsafe`）就**不重跑**——模型会收到一条 `interrupted` 的错误结果，并附上「已经提交的输出」。durable 宁可告诉模型「这次没做完」，也不替用户决定「再改一次文件」。

**③ 流式输出节流提交（对窗口 A）**：

```text
provider 的 text_delta 事件 → 累积进 pi.live 文档 → 至多每 100ms 提交一次
崩溃最多丢掉最后一个 100ms 窗口的文本；之前提交过的部分在 pi.live 里仍然可读
```

**④ 会话状态机接管「下一步」（对整体）**：

如果崩溃发生在「模型说完了、工具还没建」的瞬间，重启后 `resume()` 或任何「要求进展」的调用会让 generation 任务从最后一个检查点继续：它知道「我已经产出了带工具调用的 assistant 消息」，于是把缺的工具任务补建出来。

### 1.1.3 一句话对照

```text
朴素循环：内存是真相 → 崩溃 = 真相消失 → 重启后凭猜测重建（重复副作用 / 丢输入）
durable ：存储是真相，内存只是缓存 → 崩溃 = 重放最后一个检查点 → 重启后行为确定
```

「行为确定」这四个字的含义值得展开：不是「一定成功」，而是**每一个中间状态都有明确定义的处理方式**。第 3.6 节会给出「崩在任意一个环节会怎样」的完整速查表。

---

## 1.2 核心规则与八条不变式

### 1.2.1 一句话核心规则

`docs/spec.md:41-44` 把整个系统浓缩成一句话：

> A Session atomically commits immutable entries, full task records, and
> Chord-tracked documents. Only committed state is observable.
>
> （Session 原子地提交不可变的 entry、完整的任务记录、以及由 Chord 跟踪的文档。**只有已提交的状态是可观察的**。）

三个关键词：**immutable**（entry 不可变，只追加）、**atomically**（一笔提交是一个整体）、**observable**（可见性 = 提交状态，没有第二条路）。

### 1.2.2 八条不变式，逐条翻译

规范 `docs/spec.md:63-78` 列出了八条必须成立的不变式。它们是判断「某个实现是否合规」的标准，也是本手册后面反复引用的依据：

| # | 原文 | 中文 | 违反它会发生什么 |
|---|---|---|---|
| 1 | One Session commit is atomic across all record and document writes. | 一笔 Session 提交对所有记录与文档写是原子的 | 「建了子任务但没记等待名单」这类半成品状态；恢复时任务凭空消失或永久卡住 |
| 2 | A document update is published only after its storage commit succeeds. | 文档更新只在存储提交成功之后才发布 | UI 先看到、崩溃后消失——「幽灵状态」 |
| 3 | All visible progress is durable. There is no volatile publication path. | 一切可见进度都是持久的，不存在易失的发布路径 | 用户以为 agent 做了，重启后发现没做 |
| 4 | External effects do not run inside the Session mutation transaction. | 外部效果不在 Session 变更事务内执行 | 事务重试导致副作用重复；事务回滚时外部世界无法回滚 |
| 5 | Entries and IDs are immutable and never reused after a committed write. | entry 与各种 ID 在提交后不可变、永不复用 | 审计失效；旧引用指向新对象 |
| 6 | Document drafts are fully revoked when their transaction callback settles: the Session synchronously prepares or aborts every open change at that point. Values assigned into a draft are copied by value and must be strict JSON. | 提交回调结束时草稿被完全吊销：Session 同步 prepare/abort 每一个未决变更。赋入草稿的值按值复制，且必须是严格 JSON | 跨提交持有草稿 = 读到被吊销的代理，或写出未追踪的修改 |
| 7 | The mutation line remains held through storage settlement and committed-state adoption. Commit/close observers run synchronously only to capture immutable state; document-state and watch user callbacks run later, off the line. | 提交线一路持有到「存储结算 + 提交态采用」完成。提交/关闭观察者同步运行且只用来捕获不可变状态；文档状态与 watch 的用户回调之后在提交线之外运行 | 提交成功与可见顺序不一致；慢回调阻塞整条提交线 |
| 8 | An uncertain storage failure is fatal to the open Session. It publishes nothing and must be reopened. Preparation and checkpoint failures occur before storage admission and roll back normally. | 不确定的存储失败对当前 Session 是致命的：它不发布任何东西，必须重新打开。**准备失败与检查点失败发生在存储准入之前，正常回滚** | 存储出错后继续用 = 在不确定的地基上继续写 |

第 8 条把失败分成两类，这是读源码时特别有用的一把尺子：

```text
准备阶段失败（草稿校验不通过、checkpointWhen 抛错、strict JSON 校验失败）
  → 发生在「存储准入」之前 → 正常回滚，提交没发生，Session 可以继续用

存储阶段失败（SQLite 报错、磁盘满、IO 错误）
  → 已经进入「存储准入」→ 但结果未知（可能写入了一部分）→ Session 被毒化
  → 正确反应：关掉、重新打开（靠后端的原子性保证回到一致的旧状态）
```

`docs/pico-v5-chord-usage.md:363-366` 用一句话总结了同一件事：「不存在『可见但未持久』的路径；不确定的存储失败不发布任何东西，并毒化打开的 Session，应该关闭并重开而不是继续。」

### 1.2.3 三条派生规则

从八条不变式还能推出三条日常使用时最常撞到的规则，它们不在规范里单独编号，但同样硬：

1. **提交回调里不能「先写后读」。** 在同一个回调里写了一张表再去读它，语义上有歧义（读的是写之前还是写之后？），durable 直接抛 `ReadAfterWrite`（`src/errors.ts`）。正确的做法是「先读后写」，或者把读放到下一笔提交。
2. **一个存储同一时间只被一个进程拥有。** 没有跨进程锁（README「Storage」）。多进程访问要自己加单实例锁；这个仓库的 coding-agent 实验版加了 10 秒过期的锁。
3. **只读观察不推进工作。** `viewState()`、`watch()`、`watchDoc()`、`taskGraph()`、`snapshot()` 都不会启动调度器；能让任务动起来的只有 `resume()` 与「要求进展」的调用（`submit` / `wait` / `waitForTask` / `waitForIdle` / `abort` / `compact`）。示例 `13` 的第二段专门证明「只读端看到的检查点不会被它推动」。

---

## 1.3 分层、数据流与职责边界

### 1.3.1 四层结构

```text
┌──────────────────────────────────────────────────────────────────────┐
│ 应用层（你的代码：CLI、TUI、HTTP 服务、任务面板……）                  │
│   扩展（tools / sections / hooks / wraps / tasks）+ settings + env    │
│   只消费「已提交状态」：viewState / watch / watchEvents / taskGraph    │
└──────────────────────────────────────────────────────────────────────┘
                                 │  submit / commit / configure / abort
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Harness（src/harness/*）：Session + 调度 + 内建任务 + 扩展机制        │
│   ├─ 调度器：挑可跑任务、跑 phase、结算终局、传播 abort、维护所有权    │
│   ├─ 内建任务：pi.generation（调模型）/ pi.tool（跑工具）/ pi.compaction│
│   ├─ Registry：进程内的扩展代码表（存代码，不存数据）                  │
│   └─ 视图/事件：把提交态投影给 UI                                     │
└──────────────────────────────────────────────────────────────────────┘
                                 │  一笔提交 = 一个原子写
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Session（src/session/*, src/documents.ts, src/entries.ts）：          │
│   一条提交线 + 五张记录表（conversations/entries/documents/tasks/      │
│   submissions）+ 文档语义（scope/history/fork/version/migrate）       │
└──────────────────────────────────────────────────────────────────────┘
                                 │  Storage 接口（11 个方法）
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Storage（src/storage/*）：Memory / SQLite / JSONL（或你自己的后端）    │
│   负责：原子写、分页游标、文档基准+增量、崩溃语义（WAL / fsync）        │
└──────────────────────────────────────────────────────────────────────┘
```

两条推论，记住它们能省很多时间：

- **只想读写持久数据、不想跑 agent** → 用 `createSession(storage)`。这时任务记录只是数据，不会被任何调度器执行（示例 `00`–`05`）。
- **要跑 agent** → `Harness.open(storage, options, context)`。`Harness` 本身就是 `Session`（它的 API 是超集），所以 `commit` / `snapshot` 一样可用。

### 1.3.2 谁在写什么：entry 与文档的作者表

**六种内建 entry**（`src/entries.ts:15-34`），以及它们的作者：

| kind | 记录什么 | `model` 字段 | 谁写 |
|---|---|---|---|
| `pi.user` | 用户输入 | `[UserMessage]` | submission 放置（准入+边界） |
| `pi.assistant` | 模型响应（任何 stop reason） | `[AssistantMessage]` | generation 任务 |
| `pi.system` | 位置性的提示与工具变更 | `[SystemMessage]`（`content` 恒为 `""`） | generation 任务（渲染差量时） |
| `pi.tool-result` | 工具结果 | `[ToolResultMessage]`（末尾附诊断块） | tool 任务；模型要了但没提供的调用由 generation 补一条合成的错误结果 |
| `pi.reset` | 新上下文起点（`head: "self"`） | 无，或 `[UserMessage]`（交接说明） | `Conversation.reset()`、工具的 `control.handoff` |
| `pi.compaction` | 压缩摘要（`head` = 保留的第一条 entry） | `[UserMessage]`（包裹摘要） | compaction 任务 |

你自己的 entry 用 `defineEntry("app.xxx")` 定义，用 `tx.appendEntry(...)` 或 `{ type: "write" }` 提交写。

**五个内建文档**（都挂在 conversation 作用域）：

| kind | 内容 | 谁写 | 定义文件 |
|---|---|---|---|
| `pi.agent` | 该会话的运行配置：model、thinkingLevel、extensions、tools、instructions、cwd | `configure()`；创建/ fork 时的 `agent` 参数 | `src/harness/agent.ts` |
| `pi.provider` | provider 侧的会话身份（UUIDv7），作为 `sessionId` 转发 | generation / compaction 的请求准备阶段（老会话首次使用时补写） | `src/harness/provider.ts` |
| `pi.live` | 当前 run 的现场：run、流式片段、工具槽、压缩进度、重试退避 | generation / tool / compaction 任务 | `src/harness/live.ts` |
| `pi.inbox` | 忙时排队中的提交（含模式与顺序） | 提交准入与边界放置 | `src/harness/inbox.ts` |
| `pi.usage` | 按 provider/model 与按工具名累计的 token 与花费 | generation 的响应结算、tool 结果带 usage 时 | `src/harness/usage.ts` |

这张表解释了为什么「UI 只要读文档就行」：会话的配置、身份、现场、队列、花费全都在文档里，而文档又和 entry 走同一条提交线——**同一笔提交里写的东西，一定同时可见**。

### 1.3.3 两条数据流

**写路径（自上而下）**：

```text
应用调用 conversation.submit / commit / configure / reset / compact / abort
  → Harness 把「要做什么」翻译成一笔提交（或一个任务，如 compact）
  → Session 在提交线内执行回调：校验、分配 id、计算文档增量
  → Storage 原子落盘（文档可能是 base 或 base+ops）
  → 提交成功 → 采用新值 → 释放提交线 → 通知观察者（watch / view / 事件流）
  → 调度器在需要时启动：把可跑的任务（pending→running）推进到下一个检查点
```

**读路径（自下而上）**：

```text
session.snapshot(doc, id)            直接读文档最新值（不创建、不推进）
session.snapshotAsOf(doc, id, entry) 读「与该 entry 同笔提交时」的值（需要 rewindable）
conversation.entries({...})          分页读转录（最新在前）
conversation.context(ctx)            读派生视图：活跃 entries + head + 下一次请求的 messages
conversation.viewState(ctx)          读结构化视图（entries + 挂载的文档），可订阅
harness.taskGraph(ctx)               读活任务图
harness.usage(ctx)                   读全 Session 用量
```

**读路径有一条铁律**：以上全部是纯读，**不会启动调度、不会创建文档、不会推进任何工作**（例外是 `context()` 会在返回前确保必要的数据已加载，但它不改变状态）。

### 1.3.4 职责边界：什么不属于 durable

- **不做 UI**。它只把提交态投影成视图与事件；怎么画、怎么排版、怎么处理键盘输入是应用的事。
- **不做跨进程协调**。一个存储同时只归一个进程；多实例要用自己的锁（或每个实例一份存储）。
- **不做传输**。远端同步交给 Chord 的远程绑定/你的协议；durable 只保证「提交态可订阅」。
- **不做认证与权限**。`owner` 是**归属关系**，用来决定中止与空闲遍历，不是访问控制能力（`docs/spec.md:250` 明说：「It is not an access-control capability」）。
- **不做业务幂等**。框架提供 `replay` 声明、`requestId` 去重、`runtime.memo`、所有权索引这些**工具**，但「重跑一次会不会重复扣款」最终取决于你的执行体（第 3.6 节）。

---

## 1.4 记录与标识（Id / Seq / Cursor）

### 1.4.1 Id 只是「编译期的品牌」

```typescript
declare const idBrand: unique symbol;
type Id<Kind extends string, Type = unknown> = number & {
	readonly [idBrand]: { readonly kind: Kind; readonly type: Type };
};
type ConversationId = Id<"conversation">;
type EntryId = Id<"entry">;
type TaskId<Result = unknown> = Id<"task", Result>;
type SubmissionId = Id<"submission">;
type DocumentId = Id<"document">;
```

规范 `docs/spec.md:85-102` 的这段注释值得抄下来：

> ID brands are compile-time only. IDs and sequences remain ordinary numbers in memory, JSON, JSONL, and SQLite.
> （品牌只是编译期的：ID 与序列在内存、JSON、JSONL、SQLite 里都是普通数字。）
> The distinct sequence brand prevents an entity ID from being used as a document commit point.
> （给序列单独的品牌，是为了防止「实体 ID」被误当成「文档提交点」用。）

实践含义有三条：

1. **日志里看到的是数字**（`conversation: 1`、`entry: 42`），不要觉得奇怪。
2. **`Seq` 与实体 ID 类型上不可互换**：`Seq` 是「提交序列号」，严格递增、允许跳号（`docs/spec.md:99-101`）。
3. **别手写数字当 ID**。虽然运行时就是数字，但把 `2` 当 `ConversationId` 传，会在跨版本、跨存储时变成定时炸弹；要用 `tx.createConversation()` 等工厂产出的值。

### 1.4.2 三个全局约定

| 约定 | 值 | 说明 |
|---|---|---|
| `ROOT_CONVERSATION_ID` | `1` | 根会话永远保留 id 1。宿主自建的第一个会话从 2 开始（示例 `00` 的 `{ id: 2 }` 就是这么来的） |
| Entry id 作用域 | Session 全局 | 在同一份 Session 里唯一且有序，跨会话也不重复 |
| Document id | 每次「化身（incarnation）」一个新数字 | 逻辑地址是 `(kind, scope, key?)`，持久化的数字 id 标识**这一代**；文档被退休再用同地址重建时，数字 id 不复用 |

### 1.4.3 五张记录表

Session 里持久化的东西只有五类记录。理解它们各自的字段，就理解了持久层能表达什么。

**① `ConversationRecord`**（`docs/spec.md:108-118`）

```typescript
type ConversationRecord = {
	readonly id: ConversationId;
	readonly parent?: { readonly conversationId: ConversationId; readonly at: EntryId };
	readonly owner?: { readonly conversationId: ConversationId; readonly taskId: TaskId };
};
```

- `parent` 表示「fork 自谁、fork 在哪条 entry」，决定**继承哪些 entry 与历史文档**。
- `owner` 表示「被哪个任务拥有」，决定**中止传播与空闲遍历的连接**。
- 两者**互相独立**（规范 `docs/spec.md:247-255`）：一个被任务拥有的会话可以同时是 fork；`owner` 在拥有的任务终态之后仍然保留在记录里。
- 创建时你只会给出 `ConversationOwnership`（`{ kind: "ownerless" }` 或 `{ kind: "task", taskId }`）；持久化记录里的那个 `{ conversationId, taskId }` 二元组由 Session 从任务记录推导，调用方不构造（规范同处）。

**② `EntryRecord`**（`docs/spec.md:151-160`）

```typescript
type EntryRecord = {
	readonly id: EntryId;
	readonly conversationId: ConversationId;
	readonly kind: string;
	readonly model?: readonly Message[];   // 给模型看的内容（第 2.6 节）
	readonly data?: JsonValue;             // 给应用看的内容
	readonly head?: EntryId;               // 「新上下文从这里开始」的标记
	readonly edits?: readonly ContextEdit[]; // 对更早 entry 的模型贡献的覆盖
	readonly byTaskId?: TaskId;            // 是哪次任务执行写下的（可追溯）
};
```

写入时用的是 `EntryDraft`：它把 `id` / `conversationId` / `byTaskId` / `head` 去掉，再加回一个 `head?: EntryId | "self"`——也就是说，**只有草稿阶段能写 `head: "self"`**，落盘时 `self` 已经被解析为「这条 entry 自己的 id」（`docs/spec.md:162-164`）。

`ContextEdit`（`docs/spec.md:144-149`）是 `edits` 的元素：

```typescript
type ContextEdit = { readonly target: EntryId } & (
	| { readonly action: "omit"; readonly messages?: never }        // 让目标不进入上下文
	| { readonly action: "replace"; readonly messages: readonly Message[] } // 用这些消息替换它的贡献
);
```

**③ `DocumentRecord`**：一个文档的持久化身份 = `(id, kind, scope{kind, conversationId?|taskId?}, key?)`，加上 `history` / `fork` 语义（仅 conversation 作用域有）与当前 `version`。文档值本身以「base + ops」或「base」的形式落在文档表里（第 2.1、2.5 节）。

**④ `TaskRecord`**：`{ id, conversationId, kind, owner, background?, state, outcome? }`，其中 `state` 又是一个判别联合：`pending`（可跑）/`running`（本进程正在跑）/`waiting`（等 `on` 列表里的任务，带 `policy`）/`completing`（结果已定，等拥有的工作排空）/终态（`completed`/`failed`/`aborted`，带 `outcome`）。第 2.7 节逐个字段展开。

**⑤ `SubmissionRecord`**（`docs/spec.md:166-229`）：两种类型 × 三种状态：

```text
input：queued（已准入、还没进转录）
     → placed（已落成 pi.user entry，等回答）
     → done（被回答，带 answer entry id）
     → unanswered（失败，带 reason："aborted" 等，可带 detail）
write：queued → done（落成 entry，不叫模型）/ unanswered
```

联合类型把「哪种状态下哪些字段存在」编码进类型：`queued` 时不可能有 `entry`，`done` 时必然有 `entry`，`input.done` 必然有 `answer`——**类型系统在帮你防「读了不该存在的字段」**。

---

## 1.5 一次输入的完整时间线

这一节把一次 `submit({ type: "input" })` 到最终答案之间的所有提交点摊开。它是后面第 3 部分的索引：每一行在第 3 部分都有对应的 phase 精讲。

```text
t0  应用：conversation.submit({ type: "input", content: "..." }, ctx)
    └─ 提交 A：写 SubmissionRecord{status:"queued"}（+ 若会话忙，还会写 pi.inbox）
       submit() 返回 Submission 句柄；此时答案还不存在

t1  某个「要求进展」的调用发生（wait() / waitForTask() / waitForIdle() / resume()）
    └─ 调度器启动：把 pi.generation 任务从 pending 唤醒

t2  pi.generation / prepare 阶段
    ├─ 解析 agent（model / tools / sections / cwd）
    ├─ 渲染系统提示；与「模型已见的提示」比较，有变化才产生 pi.system 差量
    ├─ 确保 provider 身份（pi.provider 文档）存在
    └─ 提交 B：pi.user entry（放置这条输入）+ Submission 置 placed
                 + pi.system entry（若有变化）+ pi.live.run 标记 + pi.agent/pi.provider（若需）

t3  pi.generation / stream 阶段
    ├─ 发起 provider 请求（流式）
    ├─ text_delta / thinking_delta / toolcall_delta → 累积进 pi.live 的流式片段
    └─ 至多每 100ms 提交一次：pi.live（片段增量）

t4  模型响应结束 → 提交 C：pi.assistant entry（完整响应，含 usage）
                              + pi.live 清掉流式片段 + pi.usage 累加

t5  若响应里有工具调用（stopReason = "toolUse"）：
    ├─ 提交 D：为每个调用创建一个 pi.tool 子任务（owner = 本 generation 任务），
    │           generation 进入 waiting（带 on=[工具任务…]）
    ├─ 调度器开跑工具任务：
    │     intent  → 提交 E：工具意图（名称、参数、任务记录 checkpoint）
    │     execute → 真正执行（读文件、跑命令、发请求……按 settings.toolExecution 并行或串行）
    │     result  → 提交 F：pi.tool-result entry + 任务终局（结果 + 下一检查点）+ pi.usage
    ├─ generation 等全部工具结束（failFast 语义只用于子任务的等待策略）
    └─ 回到 t3：发起下一轮请求（一个新的 turn）

t6  模型给出最终答案（无工具调用）：
    └─ 提交 G：pi.assistant entry（答案）→ 回答 submission：
               Submission 置 done（answer = 该 entry id）+ 清 pi.live.run

t7  submission.wait() 解析：{ status: "done", type: "input", answer: <EntryId> }
    └─ 应用用 commit((tx) => tx.entry(AssistantEntry, answer)) 读出完整 entry
```

几个容易忽略的点：

- **`submit()` 本身不调模型。** 它只做准入 + 落盘（t0），把「要做什么」交给调度器。
- **t1 的「要求进展」不可省。** 没有任何调用要求进展时，调度器不动（第 1.2.3 节第 3 条）。
- **t4/t5 之间还可能有别的提交**：hook（`afterResponse`、`afterTools`）可以改写结果，压缩可能在这一步插入（第 3.4 节），`control.terminate` 可能让 run 直接结束。
- **`pi.live` 是「现场」而不是「历史」**：run 结束时会清空，所以它不是审计材料；审计看 entries。
- **每一行都是「可恢复点」**：崩溃发生在任意两行之间，重启后的行为在第 3.6 节逐行给出。

---

## 1.6 源码地图：61 个文件各自负责什么

先建立「文件 ↔ 职责」的对应关系，后面读代码时就能直接跳到正确的位置。行数是实测值（src/ 合计 17,716 行）。第 4 部分会逐文件精读；这里只给一行定位。

### 1.6.1 包根（8 个文件，1,744 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/index.ts` | 182 | 全部公开导出（包的门面） |
| `src/types.ts` | 1085 | 类型总表：Id、记录、Entry/Document/Task/Submission/Tx、Storage 接口、TaskRuntime、HookRunner…… |
| `src/documents.ts` | 208 | `defineDoc` / `defineDocFamily` 与文档语义校验、地址解析、版本与迁移检查 |
| `src/entries.ts` | 34 | `defineEntry` 与六个内建 entry 定义 |
| `src/ids.ts` | 11 | 数字 ↔ 品牌 Id 的转换 |
| `src/errors.ts` | 28 | 三个公开错误：`ConversationBusy`、`ReadAfterWrite`、`StorageRejected` |
| `src/tasks.ts` | 8 | `defineTask`（把定义包成 token） |
| `src/truncate.ts` | 188 | 输出截断策略（尾部/头部保留、落盘、诊断信息） |

### 1.6.2 `src/session/`（4 个文件，1,989 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/session/session.ts` | 568 | Session 本体：提交线、五张记录表的读写、文档值的装载与提交、watch 注册中心 |
| `src/session/transaction.ts` | 1023 | 事务实现：`tx` 上的每个方法（appendEntry、doc、createTask、createConversation、forkConversation、configure……）、草稿吊销、ReadAfterWrite 检查、id 分配 |
| `src/session/forks.ts` | 97 | fork 的继承规则实现（entry 继承边界、文档按 `fork` 语义取值） |
| `src/session/observation.ts` | 301 | 观察层：文档 watch / documentState / 提交帧投递与背压折叠 |

### 1.6.3 `src/harness/` 核心（2 个文件，1,773 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/harness/scheduler.ts` | 1337 | 调度器：唤醒、挑任务、跑 phase、结算终局、abort 传播、所有权与空闲判定、background 边界 |
| `src/harness/harness.ts` | 436 | `Harness` 门面：open/close/resume、会话句柄工厂、waitForTask/waitForIdle、inspect、usage、taskGraph、env 构建 |

### 1.6.4 `src/harness/` 生成栈（6 个文件，1,999 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/harness/generation.ts` | 679 | `pi.generation` 任务：请求准备、流式消费、工具轮、重试与溢出、run 的推进与收尾 |
| `src/harness/tool.ts` | 488 | `pi.tool` 任务：意图-执行-结果三明治、参数校验、replay 判定、hook 调用、输出提交 |
| `src/harness/compaction.ts` | 453 | `pi.compaction` 任务：三触发（阈值/后台/溢出）、摘要生成与放置、stale 判定 |
| `src/harness/inbox.ts` | 132 | `pi.inbox` 文档与排队项模型（followUp / steer / write 及放置策略） |
| `src/harness/live.ts` | 175 | `pi.live` 文档：run、流式片段、工具槽、压缩状态、重试信息的结构 |
| `src/harness/usage.ts` | 72 | `pi.usage` 文档与累加规则 |

### 1.6.5 `src/harness/` 配置与提示（6 个文件，1,368 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/harness/agent.ts` | 251 | `pi.agent` 文档、`configure()`、agent 解析（存名字 → 活对象）、重试/压缩默认策略 |
| `src/harness/types.ts` | 643 | Harness 层类型总表（HarnessOptions、Settings、Extension、各 Hook 类型、ToolExecutionApi……） |
| `src/harness/prompt.ts` | 158 | 系统提示渲染：section 组合、wrap 应用、差量计算 |
| `src/harness/context.ts` | 163 | 转录 → 模型上下文的派生（head/edits/排序/补位）实现的对外部分 |
| `src/harness/provider.ts` | 39 | `pi.provider` 文档（会话身份） |
| `src/harness/registry.ts` | 114 | 扩展注册表：install / uninstall / 同名替换 / 按会话解析 |

### 1.6.6 `src/harness/` 观察与支持（8 个文件，1,519 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/harness/view.ts` | 244 | `ConversationView`：把 entries + 挂载文档投影成 Chord 状态 |
| `src/harness/events.ts` | 425 | `watchEvents`：从提交派生 agent 事件（消息/工具增量、run/turn、usage、compaction） |
| `src/harness/output.ts` | 288 | 工具输出的有界增量窗口与 100ms 节流提交 |
| `src/harness/task-graph.ts` | 222 | `taskGraph` / `watchTaskGraph`：活任务图投影 |
| `src/harness/submissions.ts` | 207 | Submission 句柄：wait / abort、按 id 重取、状态迁移 |
| `src/harness/json.ts` | 31 | JSON 值的安全克隆与严格性校验的 Harness 侧封装 |
| `src/harness/util.ts` | 58 | 小工具：id 生成、时间、节流器等 |
| `src/harness/define.ts` | 44 | `defineExtension` / `defineTool` / `section` / `hook` / `wrapTool` / `wrapSection` 的包装 |

### 1.6.7 `src/storage/`（9 个文件，2,926 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/storage/memory.ts` | 810 | 内存后端：完整实现 Storage 接口（含游标、事务、原子性模拟） |
| `src/storage/sqlite/storage.ts` | 870 | SQLite 后端的可移植核心（只依赖异步 `SqliteDatabase` 外观） |
| `src/storage/sqlite/migrations.ts` | 125 | SQLite 表结构与迁移 |
| `src/storage/sqlite/node.ts` | 210 | Node 适配：`openNodeSqliteStorage` + `node:sqlite` 的 `DatabaseSync` |
| `src/storage/sqlite/database.ts` | 38 | `SqliteDatabase` / `SqliteExecutor` 接口定义（自定义适配器的契约） |
| `src/storage/sqlite/index.ts` | 8 | 子路径入口 |
| `src/storage/jsonl/storage.ts` | 845 | JSONL 后端的可移植核心（按目录追加写） |
| `src/storage/jsonl/node.ts` | 14 | Node 适配：用 `NodeExecutionEnv` 当 FileSystem |
| `src/storage/jsonl/index.ts` | 6 | 子路径入口 |

### 1.6.8 `src/env/` 与 `src/tools/`（12 个文件，2,219 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/env/index.ts` | 174 | `ExecutionEnv` / `FileSystem` 等执行环境接口 |
| `src/env/node.ts` | 957 | `NodeExecutionEnv`：文件读写、进程、glob、目录操作等 Node 实现 |
| `src/tools/index.ts` | 22 | 工具导出与 `CodingTools` 扩展 |
| `src/tools/read.ts` | 111 | `read`（文本/目录读取，带上限与诊断） |
| `src/tools/write.ts` | 39 | `write`（整文件写入） |
| `src/tools/edit.ts` | 144 | `edit`（按 edits 列表替换文本） |
| `src/tools/edit-diff.ts` | 500 | `edit` 的匹配与 diff 算法（模糊匹配、上下文定位） |
| `src/tools/bash.ts` | 90 | `bash`（执行命令，带超时与输出上限） |
| `src/tools/image.ts` | 89 | 图片相关内容（当前不支持读图，README 明确） |
| `src/tools/env.ts` | 8 | 工具如何取到调用处的 environment |
| `src/tools/path-utils.ts` | 30 | 路径处理（相对/绝对、规范化） |
| `src/tools/file-mutation-queue.ts` | 55 | 按「环境 id + 路径」串行化文件修改 |

### 1.6.9 `src/testing/`（6 个文件，2,179 行）

| 文件 | 行 | 职责 |
|---|---|---|
| `src/testing/storage-conformance.ts` | 1583 | 存储后端共享一致性测试套件（自定义后端跑一遍即达标） |
| `src/testing/storage-benchmark.ts` | 489 | 存储基准 |
| `src/testing/assertions.ts` | 39 | 断言助手 |
| `src/testing/runner.ts` | 24 | 运行器适配（Vitest/Jest 兼容） |
| `src/testing/types.ts` | 22 | 套件类型 |
| `src/testing/index.ts` | 22 | 导出 |

### 1.6.10 阅读顺序建议

如果目的是**改造内核**，推荐的文件顺序（也是第 4 部分内部的顺序，但更强调依赖方向）：

1. `types.ts` → `session/session.ts` → `session/transaction.ts`（先弄清「一笔提交是什么」）
2. `scheduler.ts`（弄清「任务怎么被推进」）→ `harness/harness.ts`（弄清「入口在哪」）
3. `generation.ts` → `tool.ts` → `compaction.ts`（三个内建任务）
4. `agent.ts` → `registry.ts` → `prompt.ts` → `context.ts`（配置与提示）
5. `view.ts` → `events.ts` → `output.ts` → `inbox.ts` → `live.ts`（观察与现场）
6. `storage/*`（后端）→ `env/*` + `tools/*`（执行能力）
7. `testing/storage-conformance.ts`（最后读，它把存储契约写成可执行断言，是校验理解的镜子）

---

## 1.7 速查术语表

完整版在第 8.1 节；这一张是一屏能扫完的最小集合。

| 术语 | 一句话 | 详见 |
|---|---|---|
| **Session** | 一份存储 + 一条提交线 + 五张记录表 | 2.2 |
| **Harness** | Session + 调度 + 内建任务 + 扩展机制 | 2.10 |
| **Entry** | 不可变转录条目；`model` 给模型、`data` 给应用 | 2.4 |
| **Document** | 与会话/任务绑定、和 entry 同笔提交的类型化 JSON | 2.5 |
| **Commit** | 一次原子写；要么全落盘要么全作废 | 2.3 |
| **Task** | 带检查点的持久状态机，必有 owner | 2.7 |
| **Phase** | 任务状态机里的一「关」，一个处理器函数 | 2.7 |
| **Checkpoint** | 「下一步干什么」的存档，`runtime.commit()` 写入 | 2.7 |
| **Memo** | 任务内「先写先赢」的小记录，比检查点轻 | 2.7 |
| **Outcome** | 任务终局：completed / failed / aborted | 2.7 |
| **Owner / Ownership** | 归属关系（不是权限）：决定中止传播与空闲判定 | 2.8 |
| **background** | 任务标记：它是 abort 边界，拥有的工作躲过普通 abort | 2.8 |
| **Submission** | 宿主交给会话的 input 或 write，可等待、可撤回 | 2.9 |
| **Inbox** | 忙时排队中的提交（`pi.inbox`） | 2.9 |
| **Turn / Run** | 一次模型响应+它的工具调用 / 从输入到最终答案 | 1.5 |
| **Busy** | 有 run 在进行（`pi.live.run !== undefined`） | 2.9 |
| **Extension** | 代码打包单位：tools / sections / hooks / wraps / tasks | 2.12 |
| **Registry** | 进程内的扩展代码表（存代码，不存数据） | 2.12 |
| **Section / Wrap / Hook** | 提示段落 / 按名字装饰工具或段落 / 观察干预点 | 2.12、2.14 |
| **Agent** | 一个会话的运行配置：model、thinkingLevel、extensions、tools、instructions、cwd | 2.13 |
| **Settings** | 宿主级运行策略，每次使用现场读取、从不存储 | 2.13 |
| **Environment** | 工具与 section 的执行环境（文件/进程），按每次使用构建 | 2.15 |
| **replay** | 工具声明「崩溃后可安全重跑」；默认 unsafe（不重跑） | 2.16、3.6 |
| **ContextView** | 转录的派生视图：活跃 entries + head + 下一次请求的 messages | 2.6 |
| **head / edits** | 「新上下文起点」标记 / 「覆盖更早 entry 贡献」的声明 | 2.6 |
| **viewState / watch / watchEvents** | 三种观察方式：结构视图 / 快照+ops / agent 事件 | 2.17、2.18 |
| **Task Graph** | 所有活任务的图（面板与调试用） | 2.19 |
| **Usage** | token 与花费累计（`pi.usage`） | 2.20 |
| **Compaction** | 把旧上下文摘要成一条带 head 的 entry（不删历史） | 3.4 |
| **stale** | 压缩摘要落入「当前上下文起点之前」时的作废判定 | 3.4 |
| **Anchor / Reporter** | 后台 subagent 的两个构造：拥有子会话的锚任务 / 汇报任务 | 5.5 |

---

# 第 2 部分：关键类逐个精讲

这一部分逐个讲清这个包的核心构件。每节的顺序固定：**它是什么 → 它负责什么 / 不负责什么 → 关键方法与伪代码 → 关键代码（带中文注释）→ 不变式与边界 → 常见误解**。读完后你应当能回答「某个操作在持久层留下了什么、崩溃时会发生什么、谁负责保证哪一条不变式」。

第 1 部分给的是地图，这一部分给的是每块地皮的边界。源码行号可以对照第 4 部分的逐文件精读。

## 2.1 Storage：三种后端与存储契约

### 2.1.1 一句话职责

**Storage 是「一次原子提交 + 一个全局数字 ID 命名空间 + 一组只读查询」**。

认清它的**信任边界**，是理解整个持久层的关键（`docs/spec.md:4299-4305` 原文）：

> Trusts the owning Session to supply semantically valid records, references, ancestry, and transitions.
> Enforces atomicity, global ID ownership, immutable conversation/entry creation, document record consistency, and detached values;
> Session serializes commits.
>
> （它**信任**拥有它的 Session 提供语义有效的记录、引用、祖先链与状态转移；它自己只强制五件事：原子性、全局 ID 归属、conversation/entry 的不可变创建、文档记录一致性、值的「脱离（detached）」性；**串行化由 Session 负责**。）

这条分工带来两个直接后果：

- 后端**不做业务校验**。写自定义后端时不需要检查「这个 submission 状态转移合法吗」「这条 entry 的会话存在吗」——那是 Session 的活。
- 后端**不提供跨进程互斥**。「一个存储同一时间归一个进程」是使用纪律，不是 API 保证（`README.md:529`：「One process owns a storage at a time; there is no cross-process locking.」）。

它**不负责**：记录语义校验、状态机、调度、视图投影、缓存（缓存由 Session 的 tracker 层持有）。

### 2.1.2 接口全表

`Storage` 接口定义在 `src/types.ts:993-1084`，规范版本见 `docs/spec.md:4306-4331`。全部成员：

| 方法 | 语义 | 边界与返回 |
|---|---|---|
| `commit(writes, context): Promise<Seq>` | 原子落盘一批写，返回该批次的提交序号 | `writes` 是 `StorageWrite[]`；**resolve 之后**通过同一 storage 的读就能看到这批写。失败语义见 2.1.6 |
| `mintId<I>(): Promise<I>` | 从**唯一的全局数字命名空间**分配一个新 ID | 泛型品牌只是编译期的；分配必须全局单调且不复用 |
| `conversation(id, context)` | 按 ID 取会话记录 | 不存在返回 `undefined` |
| `scanConversations(query, limit, cursor, context)` | 按 owner 过滤、**升序**分页 | `limit` 是**最大页大小**；`cursor` 只能原样回传 |
| `entry(id, context)` | 全局按 ID 取 entry，**附带 `commitSeq`** | 返回 `{ entry, commitSeq }`；`commitSeq` 是历史文档读（`snapshotAsOf`）必需的 |
| `entry(conversationId, id, context)` | 同一查询，但要求该 entry 在指定会话的**祖先链内可见** | 不可见返回 `undefined`（不是抛错） |
| `findLatestHeadMarker(conversationId, atOrBeforeEntryId, context)` | 找「≤ 给定 entry」的**最新一条带 `head` 的 entry** | 返回的是**标记本身**；调用方要用它的 `head` 字段做上下文下界 |
| `scanEntries(query, limit, cursor, context)` | **降序（最新优先）**分页，逐层应用祖先链上界 | `minEntryId` / `maxEntryId` 都是**闭区间** |
| `task(id, context)` | 查任务记录 | 不存在返回 `undefined` |
| `scanTasks(query, limit, cursor, context)` | 按会话 / kind / 状态 / abort 标记 / background 过滤，升序分页 | 过滤条件是**合取**（AND） |
| `submission(id, context)` | 查提交记录 | — |
| `scanSubmissions(query, limit, cursor, context)` | 按会话 / 状态过滤，升序分页 | — |
| `submissionByRequest(conversationId, requestId, context)` | 按 `requestId` 找回提交（去重键） | 不存在返回 `undefined` |
| `findDocument(address, at, context)` | 按**逻辑地址**（kind + scope + key?）解析出「那一刻活着的化身」 | 没有 key 表示**单例**，不是「随便一个 family 成员」 |
| `document(id, at, context)` | 按**化身 ID**物化一个具体 incarnation 的值 | 永远不跟随同地址的替换；未知 ID 返回 `undefined`；`"current"` 下已退役返回 `undefined` |
| `scanDocuments(query, limit, cursor, context)` | 枚举某个 scope 在某一刻活着的 incarnation，按化身 ID 升序 | 可再按 kind 限制一个 family/单例 |
| `close(context)` | 关闭后端 | 关闭之后所有操作都必须 reject |

`StorageWrite` 的 8 种成员（`src/types.ts:686-702`，规范 `docs/spec.md:4277-4297`）：

```text
conversation    整条会话记录
entry           整条 entry 记录
task            整条任务记录（状态机原地替换）
submission      整条提交记录（状态机原地替换）
document.create 新化身 + 完整 base 内容（create 的内容必须是 base）
document.copy   新化身 + 源（{id, at}）：值由后端从源物化出**独立**的一份
document.change 对已有化身的增量或 base
document.retire 退役某个化身
```

**一次归一化批次的规则**（规范 `docs/spec.md:4389-4394`）：

1. 一个化身在**一个批次里至多一条** create/change 内容命令（可以再叠一条 retire）；
2. 内容的生效**先于**退役，与数组顺序无关；
3. 「create + retire 同批」= 生命周期为空，两个时间点盖**同一个 `Seq`**；「retire + create 同地址」= 新化身从该 `Seq` 起成为 current；
4. **delta 不能跨存储版本边界**：版本变了必须写 base。

### 2.1.3 一笔提交在存储内部发生什么

所有后端都实现成同一形状的三段式：

```text
commit(writes, context):
  1. prepare（可失败、无副作用）：解析 document.copy → 检查全局 ID 归属 → 归一化文档动作
                                → 检查地址唯一性 / delta 版本边界
  2. admit  （原子落盘）：把全部表写与文档命令在一次事务/一次追加序列里落下去，分配 Seq
  3. return Seq
```

三种后端把这三段映射到各自的机制上：

| 后端 | prepare | admit |
|---|---|---|
| Memory（`src/storage/memory.ts`） | `prepareCommit()` 完成所有可能失败的检查，产出 `{seq, writes: frozen, apply}`；`apply()` **不会失败**且幂等（重复调用返回同一个 `seq`），见 `memory.ts:250-271` | 首次 `apply()` 把表写与文档动作写进内存索引，并推进 `nextSeq` |
| SQLite（`src/storage/sqlite/storage.ts`） | 组装 SQL 语句与参数；文档动作归一化 | `db.transaction()` 内一次执行：`durable_metadata`（`next_seq`/`next_id`）、各表、`document_revisions`。要么全提交要么全回滚 |
| JSONL（`src/storage/jsonl/storage.ts`） | 同样先做全部可失败检查 | 先把文档/任务内容写进 sidecar 文件（`doc-<id>.jsonl` / `task-<id>.jsonl`），再往 `main.jsonl` **追加一行 commit marker**；marker 是「这批写生效」的唯一权威 |

Memory 的 `apply()` 幂等是一个刻意设计的形状：它让「准备」与「生效」分离，从而**所有可失败的逻辑都发生在存储准入之前**（规范不变式 8 的两类失败就是这么分出来的）。

### 2.1.4 读的语义：四条容易搞混的规则

**① 游标（cursor）不属于你。** `Cursor = Readonly<Record<string, JsonValue>>`（`src/types.ts:607`），内容由后端自定义，只能「原样回传给同一个 storage 的同一次 scan」。跨存储、跨查询复用不受支持（规范 `docs/spec.md:4347-4349`）。Memory 的实现是 `{ after: <number> }`，SQLite 用索引列，JSONL 也用 ID——但不要依赖任何具体形状。

**② 两种 entry 查询用途不同。** `entry(id)` 是「全局精确查」并顺手带回该 entry 的 `commitSeq`；`entry(conversationId, id)` 才做**祖先链可见性**检查（fork 出来的会话看不到父会话 fork 点之后的 entry）。历史文档读必须用前者拿到的 `commitSeq`——这就是它要一起返回的原因。

**③ `head` 标记 ≠ 上下文起点。** `findLatestHeadMarker()` 返回的是**标记 entry**，真正的下界是它的 `head` 字段。规范给出的读法（`docs/spec.md:4352-4358`）：

```text
要读「到 entry E 为止」的上下文：
  marker = findLatestHeadMarker(conversationId, E)
  scanEntries({ conversationId, minEntryId: marker?.head, maxEntryId: E })   // 降序返回，自行反转
当前上下文：上界省略（即到最新）
```

**④ `findDocument` 与 `document` 是两种不同的问题。**

```text
findDocument(address, at)   「这个逻辑地址（kind+scope+key）在 at 时刻活着的是哪个化身？」→ DocumentRecord
document(id, at)            「这个化身（具体数字 ID）在 at 时刻的值是什么？」→ StoredDocument（已物化）
```

物化规则（规范 `docs/spec.md:4375-4387`）：取**最新的可用 base**，再按顺序应用其后的 delta 尾；返回 `{ record, version, value, deltasSinceBase }`。错误与「缺席」要分清：

| 情况 | 结果 |
|---|---|
| 未知 ID | `undefined`（缺席） |
| `at === "current"` 且化身已退役 | `undefined`（缺席） |
| 数值点查 rewindable conversation 化身，落在半开生命周期 `[createdAt, retiredAt)` 之外 | `undefined` |
| 数值点查 current-only 化身（session / latest 文档）的历史点 | **抛错**（不依赖被回收的内容） |
| 缺必需的 base、delta 尾里出现版本变化、操作无法应用 | **存储损坏**（抛错），不是缺席 |

最后一行值得强调：**「读不到」和「坏了」是两件不同的事**，后端必须能区分。这也是自定义后端最容易被一致性套件抓出来的地方。

### 2.1.5 三种后端对比

| | Memory | SQLite | JSONL |
|---|---|---|---|
| 引入 | `MemoryStorage`（包根） | `openNodeSqliteStorage(file)`（`/storage/sqlite/node`） | `openNodeJsonlStorage(dir, ctx)`（`/storage/jsonl/node`） |
| 持久性 | 无（进程退出即全丢） | 单文件（+WAL 侧文件） | 单目录 |
| 崩溃语义 | 不适用 | WAL + `synchronous = NORMAL`：进程崩溃可幸存；掉电/宿主机故障可能丢**最新若干笔**，但库不损坏 | 默认只承诺进程崩溃一致；`{ fsync: true }` 时每笔提交前强刷（代价是每次提交一次 fsync） |
| 人可读性 | — | 需要 SQLite 工具 | 高：每行一个 JSON |
| 适合 | 测试、demo、短命会话 | 生产默认选择 | 调试、审计、教学、需要逐行查看的场景 |

**SQLite 后端的结构**（`src/storage/sqlite/migrations.ts:9-85`，表全部 `STRICT`）：

```text
durable_metadata    单行：next_id（TEXT！）、next_seq
durable_schema      迁移版本
record_ids          全局 ID 归属（id → record_type）
conversations       + 两个 owner 索引
entries             + entries_by_conversation(conversation_id, id DESC)
                    + 部分索引 entry_heads_by_conversation … WHERE head IS NOT NULL
tasks               + status / conversation / kind / abort_requested / background 五个索引
submissions         + by_request(conversation_id, request_id) 等三个索引
documents           + documents_by_address(...) / by_scope / by_scope_kind 三个索引
document_revisions  PRIMARY KEY(document_id, seq)：base 与 delta 的有序序列
```

`next_id` 之所以是 **TEXT**：`node:sqlite` 拒绝把超出 JS 安全整数范围的 INTEGER 读回来——这个细节写在迁移文件注释里，是「Node 内置 SQLite 的边界」的一个真实例子。node 适配器（`src/storage/sqlite/node.ts`）负责三件与持久性有关的事：

```text
openNodeSqliteDatabase(path, { timeout }):
  mkdir(dirname(path))
  new DatabaseSync(path, { timeout })     // busy timeout，默认 5000ms
  PRAGMA journal_mode = WAL               // 崩溃一致性与并发读的关键
  PRAGMA synchronous = NORMAL             // 不每笔 fsync：更快，但极端掉电可能丢最后几笔
  PRAGMA wal_autocheckpoint = N
close(): PRAGMA wal_checkpoint(TRUNCATE)  // 放在 finally 里，保证 database.close() 一定执行
```

**JSONL 后端的结构**（`src/storage/jsonl/storage.ts`）：

```text
<dir>/main.jsonl        每个 commit 一行 marker：{format:1, type:"commit", seq, writes:[...]}
<dir>/doc-<id>.jsonl    一个文档化身的内容序列（base/delta）
<dir>/task-<id>.jsonl   一个「非终态任务」记录的替换序列
<dir>/*.reclaim         回收时的临时替换文件（打开时会无条件删除，见下）
sidecar 行形状：{format:1, type:"record", seq, ordinal, payload}
```

哪些写进 `main.jsonl`、哪些进 sidecar（`encodeCommit`）：

| 写 | 去处 |
|---|---|
| `conversation` / `entry` / `submission` / `document.retire` | 直接进 main |
| `task`（**终态**） | 进 main |
| `task`（非终态） | 进 `task-<id>.jsonl`；main 里放 `{type:"task.sidecar", id, ordinal}` |
| `document.create` / `document.change` | 内容进 `doc-<id>.jsonl`；main 里放带 `ordinal` 的引用 |

`ordinal` 是同一提交内的全局递增序号，marker 用 `(file, seq, ordinal)` 反查 sidecar 行。`fsync: true` 时先刷每个 sidecar、再追加 main marker；**普通发布不刷 main**。回收（reclaim）在动手之前先刷一次 main，写完临时文件再刷一次、然后 rename——刷失败就推迟回收，已发布状态保持不变（`test/jsonl-storage.test.ts:703-755`）。

`open()` 会**无条件删除它看到的 `.reclaim` 残留**并对目录做独占假设（没有锁、没有租约）。所以「同一目录被两个进程打开」在 JSONL 后端是**明确不支持**的。

### 2.1.6 失败分类：`StorageRejected` 与「毒化」

规范不变式 8 在存储层的落地（`src/errors.ts:12-17`、`docs/spec.md:4334-4338`）：

```text
StorageRejected
  = 「这一批写在任何持久效果之前就被拒绝了，保证什么都没提交」
  → Session 可以正常回滚，继续使用

其它任何存储错误 / adopt 阶段的错误
  = 「提交状态未知」
  → Session 被 poison（毒化）：之后所有操作抛
    “Session is poisoned by a failed commit after storage admission; reopen it”
  → 正确反应：关闭并重新打开（后端的原子性保证回到一个一致的旧状态）
```

后端**只**在能保证回滚时使用 `StorageRejected`（例如 `document.copy` 的源不匹配、一致性检查失败）。这条约定是自定义后端最容易搞错的地方之一：把「确定失败」误报成普通 Error，会让 Session 无谓地毒化；把「不确定失败」误报成 `StorageRejected`，则会让 Session 在不一致的地基上继续跑——两者都是 bug。

### 2.1.7 可移植核心、自定义后端与一致性套件

`/storage/sqlite` 与 `/storage/jsonl` 两个子路径导出的是**不依赖 Node API 的可移植核心**：

- SQLite 核心（`src/storage/sqlite/storage.ts`）只依赖一个异步 `SqliteDatabase` 外观（`exec` / `run` / `get` / `all` / `transaction` / `close`，`src/storage/sqlite/database.ts`）。给它一个适配器，就能跑在 Bun、Cloudflare Durable Objects 等环境——`node:sqlite` 只是其中一个适配器。
- JSONL 核心（`src/storage/jsonl/storage.ts`）依赖一个来自 `/env` 的 `FileSystem` 接口；Node 适配（`src/storage/jsonl/node.ts`，仅 14 行）只是把 `NodeExecutionEnv` 当成 FileSystem 用。

**事务句柄的契约**（`src/storage/sqlite/database.ts:18-34`，README 也强调）：事务回调收到的句柄，**回调内的一切操作都必须用它**；句柄随回调结束失效（再用抛 `"SQLite transaction handle is no longer active"`）；适配器必须把其它操作与其它事务排队到本事务结束——所以在回调里直接用 `database` 会**排队等自己**，永远不会 settle（`test/sqlite-facade.test.ts:224-239` 是这条的回归测试）。如果再叠上 rollback 失败，适配器抛 `AggregateError([error, rollbackError])`，**不会**假装「已经保证回滚」（`test/sqlite-facade.test.ts:281-293`）。

**自定义后端怎么验证**：跑共享的一致性套件（第 6.4 节详述）：

```typescript
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vitest";

registerStorageConformance({ describe, expect, it }, "My Storage", async (use) => {
	const storage = await openMyStorage();
	try { await use(storage); } finally { await closeMyStorage(storage); }
});
```

Memory、SQLite、JSONL 三个后端跑的是**同一套**断言（`test/memory-storage.test.ts`、`test/sqlite-storage.test.ts`、`test/jsonl-storage.test.ts` 都调用了同一个注册函数），所以「能过一致性套件」就是「满足存储契约」的实操判据。

### 2.1.8 常见误解

| 误解 | 事实 |
|---|---|
| 「存储会帮我校验记录之间的关系」 | 不会。它只强制原子性、ID 归属、不可变创建、文档一致性、脱离值；语义有效性由 Session 保证 |
| 「`StorageRejected` 是通用存储错误」 | 它是一个**精确承诺**：什么都没提交。普通错误意味着结果未知，会毒化 Session |
| 「一个存储可以多进程共享」 | 不支持。没有跨进程锁；需要单实例就自己实现锁（coding-agent 的 durable 实验版用 10 秒过期锁） |
| 「`document(id, at)` 会给我这个地址的最新值」 | 不会，它永远只看**这一个化身**。要「地址最新」用 `findDocument` 先解析地址 |
| 「cursor 就是 offset」 | 它是后端私有 JSON。只能原样回传；跨查询/跨存储没有意义 |
| 「JSONL 天生比 SQLite 慢很多」 | 它用内存索引做读，写入是顺序追加；代价主要在 fsync 选项与文件数量。真实量级见第 7.4 节 |

---

## 2.2 Session：一条提交线 + 五张记录表

### 2.2.1 一句话职责

**Session kernel 拥有三样东西**（`src/session/session.ts`）：

1. **唯一的 mutation line（提交线）**：所有提交、所有「线内只读作业」、以及存储的关闭，全部串行化在这条线上；
2. **已提交文档的 tracker 缓存**：每个逻辑地址当前活着的 incarnation 对应一个 Chord `Tracker`；
3. **一次提交的完整生命周期**：回调整理 → 存储结算 → 内存 adopt → 发布。

它同时是**文档观察的宿主**：把已提交变更桥接给 Chord 的 `DocumentState`（replicated state）与 `watchDoc`；关闭时先封准入、再结算已准入工作、最后关闭存储。

`Harness` 通过继承复用它（`src/harness/harness.ts` 里的 `HarnessImpl extends SessionImpl`），所以「一条提交线」在 Harness 上同样成立。

### 2.2.2 导出面

对外只有一个工厂（`src/session/session.ts:49-51`）：

```typescript
export function createSession(storage: Storage): Session;
```

`SessionImpl` 是实现类，**不在公共面**（`src/index.ts` 只导出 `createSession`）。它的公开/受保护成员：

| 成员 | 位置 | 作用 |
|---|---|---|
| `commit(change, context)` | `session.ts:85-87` | 公共提交入口，转调 `commitWith` |
| `commitWith(change, context, scope?)` | `session.ts:94-101` | 内部提交入口：先 `#assertUsable()` 再排进 line。`scope` 提供「默认会话」与「给 entry 盖 `byTaskId` 章」 |
| `readOnLine(job)` | `session.ts:104-114` | **内部只读作业**：排在线上执行，使多次读看到同一份已提交状态（Harness 的 view / scheduler / task-graph / submissions 都用它） |
| `conversationDocumentOnLine(token, id, ctx)` | `session.ts:120-132` | 供「已经在线上」的作业读某会话文档的当前 incarnation（视图挂载用）；缺省返回 `undefined` |
| `snapshot`（六重载） | `session.ts:134-179` | 读已提交只读值，**不创建**、不落盘迁移 |
| `documentState`（六重载） | `session.ts:181-237` | 返回绑定到某个已提交 incarnation 的**可释放 Chord 状态** |
| `watchDoc`（六重载） | `session.ts:239-301` | 非创建型观察：返回 `DocumentWatch \| undefined`，并把 acquisition 时的取消接进自己的生命周期 |
| `snapshotAsOf`（两重载） | `session.ts:303-348` | 只对 `history: "rewindable"` 的会话文档，按「可见 entry 所在提交点」读历史化身 |
| `close(context)` | `session.ts:350-368` | 幂等关闭 |
| `conversationCreated(_tx, _record)`（protected） | `session.ts:374-376` | 每个创建/fork 会话的事务里、会话记录入队之后调用；基类空实现，Harness 覆写以写内建文档 |
| `beforeClose()`（protected） | `session.ts:379-381` | 「准入已封、存储未关」之间运行，**必须不 reject**；Harness 用它 join 任务调用 |
| `subscribeCommits(listener)` | `session.ts:384-388` | 注册**同步** post-adoption 监听器；listener 不得抛、不得阻塞、不得调用 Session API |
| `subscribeClose(listener)` | `session.ts:391-395` | 关闭开始时同步调用 |
| `unloadDocuments()` | `session.ts:398-402` | 在线上清空 tracker 缓存（测试用：证明「缓存不是真相来源」） |

内部状态（`session.ts:59-67`）：

```text
#storage        Storage
#documents      Map<addressId, LoadedDocument>   tracker 缓存（key 是 documents.ts 的 addressId 字符串）
#commitListeners Set<...>                         提交发布订阅者
#closeListeners  Set<() => void>                  关闭开始订阅者
#host           TransactionHost                   交给 Transaction 的四个服务 + conversationCreated
#tail           Promise<void>                     mutation line 的链尾
#closing        Promise<void> | undefined         非 undefined = 已关闭/正在关闭
#poison         { error } | undefined             存储准入之后的不确定失败标记
```

### 2.2.3 一笔提交的十个步骤

这是全包最核心的一段流程（`session.ts:404-444`，源码见 2.2.4）：

```text
1. #assertHealthy()                poison 则抛 “Session is poisoned by a failed commit after storage admission; reopen it”
2. context.abortSignal?.throwIfAborted()   调用方取消在开始前仍可中断
3. tx = new Transaction(#host, context, scope)
4. result = await change(tx)       回调运行（staging 阶段，见 2.3）
5. 回调抛错 → await tx.settleFailure()（seal + abort 所有 change + 排空 pending）→ 原样 rethrow
6. writes = await tx.settleSuccess()
     seal；有未结算的 pending 操作 → abort + 排空 + 抛 “Session commit callback settled before its pending Tx operations”
     同步 prepare 每个 open change（这一步**立刻吊销所有 draft**）
     再 #assemble() 组装原子批次
7. writes.length === 0 → tx.discard()；直接返回 result（无 Seq、无发布）
8. seq = await #storage.commit(writes, withoutAbortSignal(context))
     ← 注意：**准入之后**调用方取消不再中断结算
9. 存储抛错 → tx.discard()；非 StorageRejected 则 #poison = { error }；rethrow
10. documents = tx.adopt(seq)（失败 → poison）→ #publish(seq, writes, documents, context) → return result
```

三个细节值得单独记住：

- **第七步的「零写入提交」是真实的**：回调成功但没有任何写（比如只读了一遍文档、或文档变更产生了空 op 批次），不会产生 `Seq`、不会发布任何东西，但仍会返回回调的结果。
- **第八步的取消语义**：一旦进入存储结算，调用方取消不再中断——否则会出现「存储提交了、但内存没 adopt」的裂缝。
- **第十步的 adopt 与 publish 是同步的、在线上进行的**：文档 state 帧与 watch 回调则被安排到**线外**（microtask）。这正是规范不变式 7 的要求：提交/关闭观察者同步且只捕获不可变状态；用户回调之后在线外运行。

### 2.2.4 关键代码

```typescript
// src/session/session.ts:404-444（核心提交路径，注释为本次添加）
async #runCommit<T>(change: (tx: Transaction) => T | Promise<T>, context: Context, scope?: TransactionScope): Promise<T> {
	this.#assertHealthy();                        // poisoned Session 一律拒绝
	context.abortSignal?.throwIfAborted();        // 开始前仍可被调用方取消
	const tx = new Transaction(this.#host, context, scope);
	let result: T;
	try {
		result = await change(tx);
	} catch (error) {
		await tx.settleFailure();                 // 回调失败：seal + abort 所有 change + 排空 pending
		throw error;
	}
	const writes = await tx.settleSuccess();      // seal + prepare（吊销 draft）+ 装配原子批次
	if (writes.length === 0) {
		tx.discard();                             // 空批次：不提交、不发布，但仍返回回调结果
		return result;
	}
	let seq: Seq;
	try {
		// Once admitted, caller cancellation does not interrupt Storage settlement.
		seq = await this.#storage.commit(writes, withoutAbortSignal(context));   // 准入后取消不再中断
	} catch (error) {
		tx.discard();
		// StorageRejected 是唯一「确定没有效果」的失败，Session 可以继续
		if (!(error instanceof StorageRejected)) this.#poison = { error };       // 不确定失败 → poison，必须重开
		throw error;
	}
	let documents: DocumentCommitChange[];
	try {
		documents = tx.adopt(seq);                // 指针交换 + 缓存更新（同步，无 IO）
	} catch (error) {
		this.#poison = { error };                 // 存储已提交而内存没跟上 —— 同样必须重开
		throw error;
	}
	this.#publish(seq, writes, documents, context);   // 在线上同步通知提交订阅者
	return result;
}
```

### 2.2.5 tracker 缓存与冷加载

缓存里的每个条目是 `LoadedDocument`（定义在 `src/session/transaction.ts:86-96`）：

```text
{
  addressId,                 // 逻辑地址的字符串身份（documents.ts:addressId）
  record,                    // 存储里的 DocumentRecord
  storedVersion,             // 存储里的定义版本（可能比 valueVersion 旧：只做过内存迁移）
  valueVersion,              // tracker 当前值是按哪个定义版本物化的
  deltasSinceBase,           // 自最近 base 以来累计的 delta 数（checkpoint 判定用）
  tracker                    // Chord Tracker<JsonObject>
}
```

**唯一的冷加载路径**是 `#loadDocument`（`session.ts:502-527`）：

```text
cached = #documents.get(addressId)
cached?.valueVersion === definition.version → 直接返回 cached
cached 存在但版本不符 → 从缓存删除（一个 tracker 只服务一个 token 版本）
record = storage.findDocument(address, "current")     → undefined 则返回 undefined
stored = storage.document(record.id, "current")       → undefined 则抛 “Current document … cannot be read”
value  = materializeDocument(definition, stored)      （旧版本在这里做内存迁移，不落盘）
装进缓存，key 是 addressId
```

由此得到三条重要推论：

- **缓存只在两个位置被写入**：`#loadDocument`（读存储之后）与 `tx.adopt()` 的 `host.install`（存储提交成功之后）。所以 `snapshot()` 返回的永远是**已提交**的 revision（规范不变式 3）。
- **`snapshot()` 有一条缓存快路径不进线**（命中且版本一致时直接返回 `tracker.value`）。这条推理在源码里没有额外注释背书，但 adopt 在线上进行，缓存内容始终对应某个已提交 seq，因此观察不到半提交状态。
- **同一个地址同一时间只会有一个版本的 tracker**：用另一个版本的 token 访问会让缓存条目失效并重新加载（`session-definitions.test.ts:363-378` 验证了「rewindable token 访问 latest 文档」会抛语义不匹配）。

### 2.2.6 观察桥：`#attachDocument` 与帧的投递

`documentState()` 与 `watchDoc()` 都走 `#attachDocument`（`session.ts:472-500`）：

```text
checkRecordScope / checkRecordVersion
create(loaded.tracker.value, detach)          // 交给 observation.ts 的桥
订阅 commits：只处理 change.type === "document" && change.record.id === loaded.record.id
  observed = { version: loaded.valueVersion }
  ops = observedOperations(observed, change)   // 见下
  ops.length === 0 → 跳过（迁移专用的 base 对新版本观察者什么都没变）
  否则 observer.advance(change.value, ops, frameContext)
    · CommittedStateSource 用 withoutAbortSignal(context)
    · watch 用原 context
订阅 close → observer.closeSession()
```

`observedOperations`（`session.ts:556-564`）决定「这次变更对观察者意味着什么」：

| 情况 | 投递给观察者的 ops |
|---|---|
| 退役（`value === null`） | `[["r", null]]`（规范终态：根替换成 null） |
| 观察者版本 == 变更版本 | 直接使用发布里的 `ops`（精确增量） |
| 观察者版本 ≠ 变更版本（旧形状） | `[["r", newValue]]`（整值替换——旧形状无法解释增量） |

线外的投递语义（`src/session/observation.ts`，第 4.2 节源码精读有逐行说明）：

- **串行**：同一个 watch 的回调不会被并发调用（`test/session-watches.test.ts:83-116` 统计 `maxActive === 1`）；
- **不内联**：`start()` 永不直接调用 listener，第一次交付总在微任务之后；
- **100 帧背压**：待交付帧超过 100 时，把它们折叠成**一帧根替换**（`ops = [["r", replacement]]`）；
- **交付上下文剥离取消**：帧的 context 值被保留，但 `abortSignal` 被剥掉，生产者取消不会传播到消费者；
- **退役或会话关闭**会终止 watch：退役帧交付后以 `retired` 关闭；会话关闭以 `session_closed` 终止，**已缓冲但未交付的帧被丢弃**。

### 2.2.7 关闭顺序

`close()`（`session.ts:350-368`）的顺序是刻意设计的：

```text
第一次调用（#closing === undefined）时同步设置 #closing，内部顺序：
  1. beforeClose()              ← Harness 在这里 join 所有任务调用（准入已封、存储未关）
  2. 排到线上：清空 #commitListeners、清空 #documents 缓存、await #storage.close(cleanup)
     其中 cleanup = withoutAbortSignal(context)，保证强制清理不被取消打断
  3. 同步取出并清空 #closeListeners，逐个调用（「关闭开始」通知）
返回 awaitWithContext(#closing, context)：调用方等待时可被取消，但 close 本身继续
```

要点：

- **幂等**：第二次调用返回同一个 promise；
- **已经排队的提交仍会结算**（关闭作业排在它们后面），但 `#closing` 一设置，新的 `commit` / `snapshot` / `watchDoc` / `documentState` / `snapshotAsOf` 就同步抛 `"Session is closed"`；
- **`beforeClose()` 必须不 reject**，否则关闭流程本身会变成失败路径；
- 关闭之后 `storage` 的读也会失败（测试 `session-documents.test.ts:632-655` 覆盖了这三段）。

### 2.2.8 不变式与边界

1. **只可见已提交状态**：缓存的写入点只有冷加载与 adopt（见 2.2.5）。
2. **严格串行**：`#enqueue` 把每个作业挂到 `#tail` 之后，且 `#tail` **永远吞错**（`#tail = run.then(() => undefined, () => undefined)`），所以一个失败的提交不会卡死后续作业。
3. **失败三分类**：回调阶段失败 = 回滚，Session 可继续；`StorageRejected` = 确定无效果，可继续；其它存储错误与 adopt 错误 = poison，必须重开。
4. **提交监听器在线上同步执行**（`session.ts:384-388` 的注释明确禁止它们抛错、阻塞或调用 Session API）；文档帧在线外。
5. **`conversationCreated` 覆盖一切创建路径**：`root()` / `createConversation()` / `forkConversation()`，甚至工具里裸 `tx.createConversation()`——只要经过同一个 Session，它都会在**同一笔提交**里跑，这就是「每个会话都带上你的文档」的实现基础（见 2.10.3 与示例 `11`）。

### 2.2.9 常见误解

| 误解 | 事实 |
|---|---|
| 「Session 会帮我跑任务」 | 不会。`createSession` 没有任何调度器；任务记录只是数据（示例 `03` 演示了这点） |
| 「`snapshot()` 会顺手创建文档」 | 不会。只有 `tx.doc()` 会创建；`snapshot` / `documentState` / `watchDoc` 对缺席返回 `undefined` |
| 「`watchDoc` 能看到未提交的变化」 | 不能。桥只和已提交的发布对接；草稿阶段完全不可观察 |
| 「`close()` 会丢未完成的工作」 | 不会。已准入的提交先结算，`beforeClose` 会 join 任务调用；未完成的任务留在存储里等下次 `resume()` |
| 「提交监听器里可以读存储、发通知」 | 不行。它必须同步、不得抛错、不得调用 Session API；要发通知请在线外微任务里做 |

---

## 2.3 Tx：事务里能做什么

### 2.3.1 一句话职责

**`Transaction` 是一次 commit 回调内的事务面**（`src/session/transaction.ts`，简称 `tx`）。它维护三件事：

1. **表读 / 表写的规则**（第一次表写之后禁止表读 —— `ReadAfterWrite`）；
2. **把候选记录与文档变更收集成一个原子批次**（`StorageWrite[]`）；
3. **存储成功之后执行 adopt**（指针交换 + 缓存更新）并产出发布描述。

它也是唯一同时了解「Chord draft 生命周期」与「Storage 批次形状」的地方，所以「草稿什么时候被吊销」「空 ops 要不要写」「checkpoint 什么时候判定」这些问题的答案都在这个文件里。

### 2.3.2 表读与表写：一条硬规则

```typescript
// src/session/transaction.ts:919-937（表读/表写规则）
#read<T>(method: string, read: () => Promise<T>): Promise<T> {
	try {
		this.#assertOpen();                                  // settle 之后连读也拒绝
		if (this.#hasTableWrite) throw new ReadAfterWrite(method);   // 第一次表写之后所有表读抛错
		return this.#track(read());                          // 登记进 #pendingOperations，settlement 时检查
	} catch (error) {
		return Promise.reject(error);                        // 同步错误转成 rejected promise（Tx 全是异步签名）
	}
}

#write<T>(write: () => Promise<T>): Promise<T> {
	try {
		this.#assertOpen();
		this.#hasTableWrite = true;                          // 立即置位：后续表读一律 ReadAfterWrite
		return this.#track(write());                         // 同样被追踪：未结算的创建会让整笔提交失败
	} catch (error) {
		return Promise.reject(error);
	}
}
```

覆盖范围：

| 走 `#read`（表读） | 走 `#write`（表写） |
|---|---|
| `conversation` / `entry` / `task` / 四种 `scan*` / `latestHeadMarker` / `submission` / `submissionByRequest` | `createConversation` / `forkConversation` / `appendEntry` / `createTask` / `createSubmission` |

两个例外与补充：

- **文档访问（`doc` / `retireDoc`）不走 `#read`**，所以表写之后仍可用（`test/session-tables.test.ts:98-99`）。
- **同步的 `settleSubmission` / `placeSubmission` / `setTask` 也算第一次表写**（`test/session-tables.test.ts:121-130` 用 `setTask` 验证）。

**为什么要有这条规则**：同一笔提交里「先写表再读表」的语义是歧义的（读的是写之前还是写之后？），而且会掩盖「本来应该先读到再决定」的逻辑错误。正确姿势：**要读的行在读之前全部读完**，或者拆成两笔提交。

### 2.3.3 导出面：`Tx` 的全部方法

| 方法 | 阶段 | 说明 |
|---|---|---|
| `conversation(id)` | 表读 | 按 ID 取**已提交**会话记录 |
| `entry(id)` / `entry(token, id)` | 表读 | 前者全局；后者先取全局记录再按 `kind` 过滤（不符返回 `undefined`），并把类型收窄成 `TypedEntry<D>` |
| `task(id)` | 表读 | 只返回**已提交**任务记录（看不到本事务刚建的候选） |
| `scanConversations(query, limit, cursor?)` / `scanEntries(...)` / `scanTasks(...)` | 表读 | 直接透传 Storage，`limit`/`cursor` 语义一致 |
| `latestHeadMarker(conversationId)` | 表读 | 等价于 `storage.findLatestHeadMarker(conversationId, undefined, ctx)` |
| `submissionByRequest(conversationId, requestId)` | 表读 | 去重键查询 |
| `createConversation({ ownership })` | 表写 | 创建会话；返回 `ConversationRecord` |
| `forkConversation(parentId, at, { ownership })` | 表写 | fork；同时准备父会话文档的复制清单（`session/forks.ts`） |
| `appendEntry(conversationId, value)` / `appendEntry(token, conversationId, value)` | 表写 | 追加 entry；`head: "self"` 在这里被解析成刚分配的 entry id |
| `createTask(task, input, options)` | 表写 | 创建任务；**只返回 `TaskId`**（要读记录请用 `task(id)`，但它只看已提交） |
| `createSubmission(create)` | 表写 | 建提交记录（**没有准入规则**，准入在 Harness 层） |
| `settleSubmission(id, settlement)` / `placeSubmission(id, entry)` | 表写（同步 void） | 记录状态变更意图；真正的解析推迟到装配阶段 |
| `doc(token, ...args)` / `retireDoc(...)`（各六重载） | 文档 | 获取可编辑草稿 / 退役 |
| `setTask(record)`（内部） | 表写 | 整条替换任务记录（调度器用） |
| `stagedTasks()` / `stagedConversations()`（内部） | — | 供调度器构建任务图 |

### 2.3.4 settlement：三个阶段

```text
回调抛错 → settleFailure():  seal；abort 所有 open change；allSettled(#pendingOperations)
回调成功 → settleSuccess():
   1) seal
   2) #pendingOperations.size > 0 → abort 全部 change → 排空 pending
        → 抛 “Session commit callback settled before its pending Tx operations”
   3) for document of #documents: document.change?.prepare()   ← 同步，立刻 revoke 每个 draft
   4) return await #assemble()                                  ← 装配原子批次（可 await storage）
        失败 → #abortChanges() 后 rethrow（此时存储还没被调用）
存储失败 / 零写入 → discard(): #abortChanges()
存储成功 → adopt(seq): 指针交换 + 缓存更新 + 发布描述
```

关键代码：

```typescript
// src/session/transaction.ts:659-694（settlement 三段，注释为本次添加）
async settleFailure(): Promise<void> {
	this.#sealed = true;                       // 之后任何 Tx 操作都抛 “Transaction has settled”
	this.#abortChanges();                      // 所有 open change 全部 abort（draft 全部 revoke）
	await Promise.allSettled(this.#pendingOperations);
}

async settleSuccess(): Promise<readonly StorageWrite[]> {
	this.#sealed = true;
	if (this.#pendingOperations.size > 0) {    // 回调返回时仍有未结算的异步操作 → 拒绝整笔提交
		this.#abortChanges();
		await Promise.allSettled(this.#pendingOperations);   // 先把它们排空，避免悬空写入
		throw new Error("Session commit callback settled before its pending Tx operations");
	}
	try {
		// Synchronously prepare every open change; this revokes every draft.
		for (const document of this.#documents) {
			if (document.change !== undefined) document.prepared = document.change.prepare();
		}                                      // 同步 prepare：立刻 revoke 所有 draft，产出不可变 prepared
		return await this.#assemble();          // 组装原子批次
	} catch (error) {
		this.#abortChanges();                   // 装配失败：存储还没被调用，全部回滚
		throw error;
	}
}

discard(): void {
	this.#abortChanges();
}
```

「回调结束前有未结算的异步操作」这件事会**直接拒绝整笔提交**，这条规则很容易踩到：如果你在提交回调里 `void tx.appendEntry(...)` 而不 await，回调结束时那个操作还没结算，整笔提交会被拒绝（并且先被 abort）。**规则：提交回调里每个 `tx.*` 调用都要 await。**

### 2.3.5 装配：`#assemble` 的九步

```text
1. plans = #documents.map(planDocument)（跳过没有 target 的条目）
2. #rejectForkSourceWrites(plans)：
     写到/退役 fork 源文档 → “Cannot change fork source document ${id} in the fork transaction”
     在 fork 事务里改父会话的 fork:"current" 文档 → “Cannot fork conversation … while changing its current-policy documents”
3. #validateOwners()：新会话 / 新子任务的 owner 任务必须存在、非 terminal、非 completing、非 abort-marked
4. 校验每个 task 替换：已提交记录存在、非 terminal、会话不变（“cannot change conversations”）
5. terminal 结算 → 退役任务文档：
     本事务写为 terminal 的候选任务 → 相关 plan.retire = true
     非本事务创建的 terminal 任务 → 扫描 storage.scanDocuments({scope:{kind:"task",taskId}, at:"current"}) 逐个退役
6. 解析发布归属：会话文档取 scope.conversationId；任务文档取候选/已提交任务的 conversationId
7. 解析 submission changes：current = 候选 ?? storage.submission(id)；不存在抛 “Submission ${id} does not exist”
     next = applySubmissionChange(current, change)；变了才写回
8. 组装 writes：先 conversation/entry，再 submissions，再 tasks
9. 逐个 plan：
     a) checkpoint 判定（在**所有校验之后**）：仅当内容是 delta 且 loaded 存在时，
        change.definition?.checkpointWhen?.(prepared.value, prepared.ops, { deltasSinceBase })
        为真 → 把 delta 换成 base
     b) plan.content 存在 → 推入 writes
     c) plan.retire → 推入 {type:"document.retire", id}
```

其中几个「为什么」值得说清：

- **第 5 步的「terminal 结算退役任务文档」**：任务文档（scope: task）随任务终态退役。包括**同一事务里新建又终结**的任务（create + retire 同批，生命周期为空，两个时间点同一 `Seq`）。
- **第 9a 步的 checkpoint 判定在最末尾**：`checkpointWhen` 是用户代码（可能抛错），放在所有校验之后是为了「一旦它抛错，前面已经确认的事实不会被半写进去」——整个装配失败会走 `#abortChanges()`，存储从未被调用。
- **`deltasSinceBase` 不含本次变更**：它是「该 base 之后**已经**存了多少 delta」，由 adopt 维护（base → 0，delta → +1）。

### 2.3.6 `planDocument` 四分支与「写不写」

```text
target.kind === "created"     → content = document.create + base（即使值等于初始值也要写）
target.kind === "fork-copy"   → content = document.copy（值由后端物化；本进程不读源值）
target.kind === "retire-only" → 只有 record，没有 content
target.kind === "loaded"      → storedVersion < definition.version（需要迁移）→ document.change + **base**（即使 ops 为空）
                                prepared.ops.length > 0                → document.change + **delta**
                                否则                                   → 不写（普通空批次不写）
```

发布（`publishes(plan)`，`transaction.ts:1021-1023`）的判据：

```text
plan.retire  ||  change?.loaded === undefined（创建或 fork-copy） ||  content !== undefined（任何写了内容的已载入文档）
```

也就是说：**已载入、什么都没写的文档不发布**；而「只做迁移、ops 为空」的 base 仍然发布（旧版本的观察者需要它来做根替换）。示例 `01` 与测试 `session-checkpoints-migrations.test.ts:376-438` 都能观察到这两条的组合效果。

### 2.3.7 adopt：指针交换与发布描述

```text
for plan of #plans:
  record = committed ? plan.record : { ...plan.record, createdAt: seq }    // 新建：盖提交序号
  if (plan.retire) record = { ...record, retiredAt: seq }                  // 同批创建+退役 → 同一 seq
  if (change) {
    if (loaded === undefined ? !plan.retire : prepared.ops.length > 0) change.tracker.adopt(prepared)
    else prepared.abort()                                                  // 超出计划的变化被撤销
    if (loaded) {
      loaded.storedVersion < version → loaded.storedVersion = version       // 迁移已经在内存里生效
      content 是 base → loaded.deltasSinceBase = 0
      content 是 delta → loaded.deltasSinceBase += 1
    } else if (!plan.retire) host.install({...})                            // 新 incarnation 进缓存
  }
  发布描述：
    retire            → host.evict(addressId, record.id)（若是已提交的化身）
                        push { type:"document", record, conversationId, version: undefined, value: null, ops: [] }
    document.copy     → push { type:"document.copy", record, conversationId, source }
    publishes(plan)   → push { type:"document", record, conversationId, version, value: prepared.value, ops: prepared.ops }
```

三个发布细节：

1. **创建与退役发布的 `ops` 是 `[]`**；只有普通更新才带真实 ops（且就是写进存储的那批**同一对象**，所以观察者可以 `applyImmutable` 重放）。
2. **`document.copy` 只发布元数据**，不带值——消费者要用 state/watch 的 acquisition 去水合。
3. **退役发布 `value: null`**，观察者据此把 t`[["r", null]]` 投给消费者（见 2.2.6）。

### 2.3.8 不变式与边界（速查）

| 主题 | 规则 |
|---|---|
| 表规则 | 第一次表写之后禁止所有表读；文档访问不受限；同步的 `settleSubmission`/`placeSubmission`/`setTask` 也算表写 |
| 创建方法 | 不回读：`createConversation`/`forkConversation`/`appendEntry`/`createTask`/`createSubmission` 直接返回创建结果；`tx.task()` 只看已提交 |
| ID 分配 | mint 前后各做一次 `#assertOpen()`；sealed 事务不再产生 ID/记录 |
| draft | 回调结束同步 prepare（revoke）；装配/checkpoint 失败 → 全部 abort；存储失败 → discard |
| 空批次 | 同版本、无 ops 的已载入文档不写不发布；但「结构 no-op 产生了 ops」仍写 delta 并发布 |
| checkpoint | 只对 delta、只在所有校验之后、只判定一次；`deltasSinceBase` 不含本次变更 |
| task owner | 创建时用候选优先的快速校验 + 准入前对**最终候选**再校验一次（存在 / 非 terminal / 非 completing / 非 abort-marked） |
| 任务会话 | 不可变：改 `conversationId` 被拒 |
| 任务文档 | terminal 候选之后 `tx.doc(TaskDoc, taskId)` 抛 “Task ${id} is terminal”；已获取的 draft 仍可写完再退役 |
| fork 事务 | 禁止写/退役 fork 源文档；禁止在 fork 父会话的同时改它 `fork:"current"` 的文档 |
| submission | 状态机由 `applySubmissionChange` 在运行时收口：已 settled 不变；placement 只对 `queued`；只有 `placed` 的 input 才能被回答 |

### 2.3.9 常见误解

| 误解 | 事实 |
|---|---|
| 「我可以在回调里先 `createConversation` 再 `scanConversations` 看它」 | 不行（`ReadAfterWrite`）。创建方法直接返回记录，要用它就用返回值 |
| 「不 await 某个 tx 方法也没关系」 | 有关系：未结算操作会让整笔提交被拒（“settled before its pending Tx operations”） |
| 「`tx.doc()` 属于表读/表写违规范围」 | 不属于。文档访问可以发生在表写之后 |
| 「草稿可以存起来下笔提交再改」 | 不行。回调结束草稿全部吊销，逃逸的 draft 读写都会抛错 |
| 「`createTask` 返回记录」 | 只返回 `TaskId`。要记录的当前状态用 `runtime.getTask()` / `harness.waitForTask()`（见第 3.7 节） |
| 「同版本文档改了但值没变就不会写」 | 取决于 ops：真无变更不写；但如果产生了 ops（哪怕值相等），仍会写 delta 并发布 |

---

## 2.4 Entry：不可变转录条目

### 2.4.1 一句话职责

**Entry 是转录里的一行不可变记录**。它有「两个面」：

- **`model`**：给模型看的部分（pi-ai 的 `Message` 数组；可以缺席）；
- **`data`**：给应用看的部分（任意 JSON；可以缺席）。

一条 entry 不一定要有 `model`（纯展示数据），但只要有 `model`，它就会参与「转录 → 模型上下文」的派生（第 2.6 节）。

### 2.4.2 定义与类型收窄

```typescript
// src/entries.ts:6-12
export function defineEntry<D extends JsonValue = never>(kind: string): Entry<D> {
	if (typeof kind !== "string" || kind.length === 0) throw new TypeError("Entry kind must be a non-empty string");
	return {
		kind,
		is: (entry: EntryRecord | undefined): entry is TypedEntry<D> => entry !== undefined && entry.kind === kind,
	};
}
```

- `kind` **必须是非空字符串**（注意：`defineDoc` 反而允许空 kind，两者不一致是历史原因，写代码时别踩）。
- `is()` 只比较 `kind`，**不检查 `data` 是否存在**。`TypedEntry<D>` 的 `data` 字段本身仍是可选的，所以正确写法是 `ToolResultEntry.is(entry) && entry.data.diagnostics`（`test/harness-tools.test.ts:106` 就是这个写法）。
- `D = never` 表示「这个 kind 没有 data」；此时 `TypedEntry<never>` 的 `data` 是不可赋值的类型。

### 2.4.3 六个内建 kind

| token | kind | `model` 是什么 | `data` 是什么 | 谁写 |
|---|---|---|---|---|
| `UserEntry` | `pi.user` | `[UserMessage]` | 通常无 | submission 放置 |
| `AssistantEntry` | `pi.assistant` | `[AssistantMessage]`（任意 stop reason） | 通常无 | generation |
| `SystemEntry` | `pi.system` | `[SystemMessage]`，且 `content` 恒为 `""` | 无 | generation（提示/工具差量） |
| `ToolResultEntry` | `pi.tool-result` | `[ToolResultMessage]`，内容末尾附渲染后的诊断块 | `{ diagnostics: ToolDiagnostic[] }`（可能为空数组） | tool 任务；模型要了但未提供的调用由 generation 合成 |
| `ResetEntry` | `pi.reset` | 无，或 `[UserMessage]`（交接文本） | 无 | `Conversation.reset()`、工具 `control.handoff` |
| `CompactionEntry` | `pi.compaction` | `[UserMessage]`（包裹后的摘要） | `{ reason: CompactionReason }` | compaction 任务 |

`pi.system` 的 `content` 恒为空串是一条硬约定（规范 `docs/spec.md:140`）：**所有提示内容都是命名 section**，靠 `SystemMessage.sections` / `toolsAdded` / `toolsRemoved` 表达差量。这样每次请求只需要把「变化的那一段」再发一遍，prompt cache 才能保温（第 2.14 节）。

`pi.reset` 与 `pi.compaction` 都**总是** `head: "self"`（reset）或带 `head`（compaction 指向保留的第一条）——它们是「新上下文起点」的两种形态。

### 2.4.4 记录字段与 draft

```typescript
// src/types.ts:317-338
type EntryRecord = {
	readonly id: EntryId;
	readonly conversationId: ConversationId;
	readonly kind: string;
	readonly model?: readonly Message[];
	readonly data?: JsonValue;
	readonly head?: EntryId;
	readonly edits?: readonly ContextEdit[];
	readonly byTaskId?: TaskId;
};

type EntryDraft = Omit<EntryRecord, "id" | "conversationId" | "byTaskId" | "head"> & {
	readonly head?: EntryId | "self";
};
```

两个字段需要额外解释：

- **`byTaskId`**：由提交的 `scope` 盖章（`appendEntry` 实现里写死 `byTaskId: this.#scope.taskId`），所以「这条 entry 是哪次任务执行写的」是**框架自动记录**的。它不参与上下文派生，但对调试与审计很有用（`test/harness-tools.test.ts:107` 断言工具结果带 `byTaskId`）。
- **`head: "self"`**：只有草稿阶段能这么写；落盘时被解析成「刚分配的那个 entry id」（`transaction.ts:358-379`）。所以 `head` 在存储里永远是一个具体的 entry id。

写入时的 JSON 处理：`copyJson(record, { omitUndefinedProperties: true })`——`undefined` 的属性被省略而不是写进存储。对 entry 而言这意味着 `head` / `byTaskId` / `model` / `data` 缺席时**不会**在存储里出现 `null`。

### 2.4.5 不可变，以及为什么

entry 一旦提交就永不修改、永不删除。三个理由：

1. **审计**：「模型当时看到了什么」必须能事后证明。上下文是派生视图（有 head 与 edits 两种覆盖机制），派生自不可变事实。
2. **恢复**：崩溃后重放依赖原始记录；如果记录会被改写，重放结果不确定。
3. **并发**：有人读历史、有人改历史是不可能的组合；只增不减让读路径可以自由分页与缓存。

要「修改历史」怎么办？追加一条**带 `edits` 的新 entry**（`ContextEdit` 的 `omit` / `replace`，见第 2.6 节），或者追加一条带 `head` 的摘要/重置 entry。两种做法都不动旧记录。

### 2.4.6 不变式与边界

| 主题 | 规则 |
|---|---|
| id 与顺序 | entry id 是 **Session 全局**且有序；跨会话不重复 |
| 可见性 | fork 出来的会话只能看到父会话**至 fork 点**为止的 entry（`storage.entry(conversationId, id)` 的可见性检查） |
| kind | 是持久化协议的一部分（`pi.user` 等名字与磁盘数据绑定，改名即破坏兼容） |
| `is()` | 只比较 kind；不保证 `data` 存在 |
| `edits` | 只影响模型上下文，不影响存储中的原 entry；`target` 必须指向更早的 entry |
| `head` | 只能指向「自己」或更早；`head: "self"` 只在草稿层合法 |

### 2.4.7 常见误解

| 误解 | 事实 |
|---|---|
| 「`entries()` 返回的第一条就是最新用户消息」 | 第一条是**最新 entry**（可能是工具结果或系统提示）。要用户消息请按 kind 过滤（示例 `09`、`17`） |
| 「entry 里既有 `model` 又有 `data`，所以它们是同一份东西的两种格式」 | 不是。两者独立：`model` 参与上下文派生，`data` 只给应用。两者都可以缺席 |
| 「编辑用户消息需要改旧 entry」 | 不行，也不需要：追加一条带 `edits: [{ target, action: "replace", messages }]` 的新 entry |
| 「删掉某条 entry 就能让它不进上下文」 | 不能删。用 `omit` 编辑、或追加带 `head` 的 entry 把上下文起点往后挪 |

---

## 2.5 Document：类型化 JSON 状态

### 2.5.1 一句话职责

**Document 是与会话（或任务、或整个 Session）绑定的类型化 JSON 对象**，它与 entry 走**同一条提交线**——同一笔提交里写的 entry 和文档，要么同时可见，要么都不存在。

凡是「状态」而不是「对话」的东西都放文档里：待办列表、计划、注册表、统计、UI 现场……

### 2.5.2 定义：`defineDoc` 与六个字段

```typescript
const Todos = defineDoc<{ items: string[] }>({
	kind: "app.todos",          // 持久化种类名（协议的一部分）
	version: 1,                 // 值形状的版本（正整数；变了要配 migrate）
	scope: "conversation",      // session | conversation | task
	history: "latest",          // latest（只留最新）| rewindable（旧值可寻址）
	fork: "initial",            // initial | current | asOf（fork 会话时副本的起点）
	initial: () => ({ items: [] }),
});
```

| 字段 | 必填 | 含义与边界 |
|---|---|---|
| `kind` | 是 | 持久化种类名。**允许空字符串**（与 `defineEntry` 不同） |
| `version` | 是 | 必须是**安全的正整数**，否则 `defineDoc` 抛 `TypeError("Document ${kind} version must be a positive integer")` |
| `scope` | 是 | `session`（全 Session 一份）/ `conversation`（每会话一份）/ `task`（每任务一份） |
| `history` | conversation 必填 | `latest`：只保留最新值；`rewindable`：旧值可寻址（支持 `snapshotAsOf`） |
| `fork` | conversation 必填 | `initial`：副本从初始值开始；`current`：复制父的当前值；`asOf`：取 fork 条目那一刻的值 |
| `initial()` | 是 | 首次创建时的值 |
| `migrate(value, fromVersion)` | 否 | 读到更旧版本时用它升级（**纯函数**，框架决定何时落盘） |
| `checkpointWhen(value, ops, info)` | 否 | 返回 `true` 时把这一笔写成**完整 base** 而不是 delta |
| `family: true` + `initial(seed)` | family 才有 | 一个定义服务多个实例，用 key 区分；`initial` 收一个 seed |

作用域与语义的组合（`src/documents.ts:39-80` 的四个重载把它编码进类型）：

```text
scope: "session"       → 不带 history / fork（session 文档永远只有当前值，不参与 fork）
scope: "conversation"  → history: "latest"     ⇒ fork 只能是 "current" | "initial"
                         history: "rewindable" ⇒ fork 可以是 "asOf" | "current" | "initial"
scope: "task"          → 不带 history / fork（任务文档不参与 fork，任务终结即退役）
```

类型系统在这里做了两件事：**禁止非法组合**（`latest` + `asOf` 直接编译不过，示例 `01` 的「动手改」就是让你体验这个错误），以及**让 `snapshotAsOf` 只接受 rewindable token**。

### 2.5.3 地址：逻辑地址 vs 化身

```text
逻辑地址（DocumentAddress）= { kind, scope, key? }
   · scope 决定「挂在谁身上」：{kind:"session"} | {kind:"conversation", conversationId} | {kind:"task", taskId}
   · key 只有 family 才有（单例没有 key）
字符串身份（addressId）= JSON.stringify([kind, scopeKind, ownerId|null, key|null])
化身（incarnation）  = 一个具体的 DocumentId（数字），一次创建到一次退役
```

`resolveAddress`（`src/documents.ts:109-127`）负责把「重载参数列表」翻译成地址：

```text
session      → 不消费参数
conversation → 消费一个 conversationId（必须是 safe integer）
task         → 消费一个 taskId（同上）
family       → 再消费一个 key: string
返回 { address, id: addressId(address), nextArgument }   ← nextArgument 指向后面的 context 参数
```

三个容易忽略的点：

1. **owner 是否存在由 Transaction 校验**，不在 `resolveAddress`（它只校验参数是 safe integer）。
2. **`key` 参与身份**：`kind` 相同的 family 成员与单例不会互相顶替。
3. **family 的 seed 只在首次创建时使用**：之后再传 seed 会被忽略（`tx.doc(Token, id, key, seed)` 的 `seed` 只在「这个地址还没有化身」时生效）。

### 2.5.4 读写：谁创建、谁只读

| 操作 | 会创建吗 | 会写吗 | 说明 |
|---|---|---|---|
| `tx.doc(token, ...)` | **会**（首次访问即创建） | 会（改草稿，提交时落盘） | 返回可编辑草稿；同一事务同一地址只初始化一次、只 mint 一次 |
| `tx.retireDoc(token, ...)` | 不会 | 会（退役） | 缺席地址是 no-op（不写、不 mint） |
| `session.snapshot(token, ...)` | **不会** | 不会 | 只读最新值；缺席返回 `undefined` |
| `session.snapshotAsOf(token, id, entryId)` | 不会 | 不会 | 读「与该 entry 同笔提交时」的值；仅 rewindable |
| `session.documentState(token, ...)` | 不会 | 不会 | 返回可释放的 Chord 状态（订阅用） |
| `session.watchDoc(token, ...)` | 不会 | 不会 | 返回 `DocumentWatch`（快照 + 精确 ops） |

**「只有 `tx.doc()` 会创建」**是全包最容易被误用的规则之一：观察（`snapshot` / `documentState` / `watchDoc`）永远不写存储、不分配 ID。这让「只读的 UI 进程/面板」不会因为多看一眼就改变数据。

### 2.5.5 版本与迁移

```typescript
// src/documents.ts:179-208（校验与物化，注释为本次添加）
export function checkRecordVersion(definition, record, version: number): void {
	if (version > definition.version) {
		throw new Error(`Document ${record.id} (${record.kind}) has newer version ${version} than ${definition.version}`);
	}                                                                  // 比定义更新的存储版本：永远拒绝（不能降级解释）
	if (version < definition.version && definition.migrate === undefined) {
		throw new Error(`Document ${record.id} (${record.kind}) requires migration from version ${version}`);
	}                                                                  // 更旧且没有 migrate：拒绝
}

export function materializeDocumentValue(definition, record, version, value): JsonObject {
	checkRecordScope(definition, record);      // scope / history / fork 必须与 token 一致
	checkRecordVersion(definition, record, version);
	if (version === definition.version) return value;                  // 同版本：不拷贝，直接用存储已 detached 的值
	return copyJson(definition.migrate!(value, version)) as JsonObject; // 迁移结果要拷贝并做严格 JSON 校验
}
```

四条规则：

1. **迁移是纯函数**：`migrate` 不写存储；写不写由调用方（Session/Transaction）决定。
2. **同版本不做防御性拷贝**（值已经是存储层 detached 的）；**迁移结果一定拷贝**并校验 strict JSON。
3. **迁移可以在内存里发生但不落盘**：`LoadedDocument` 的 `storedVersion`（存储里）与 `valueVersion`（内存里）就是为此分开的；只有当这个地址真的被写入时，新版本才落盘（`test/session-forks.test.ts:231-279` 演示了「存储里还是 v1，进程里已经是 v3」的组合）。
4. **迁移抛错或产出非严格 JSON → 整笔回滚，Session 仍可用**（`test/session-checkpoints-migrations.test.ts:496-527`）。

### 2.5.6 生命周期：创建 → 访问 → 退役 → 重建

```text
创建   第一个 tx.doc()  → document.create + base（值来自 initial()/initial(seed)）
                         → 新 DocumentId（全局命名空间分配）
访问   同版本再访问     → 命中缓存 tracker；不同版本 → 缓存失效 + 冷加载 + 内存迁移
       新事务再访问     → 走装配阶段，产生 delta（或有条件 base）
退役   tx.retireDoc()   → document.retire；发布 value: null；缓存 evict
       任务终结         → 框架自动退役该任务的 task 文档（见 2.3.5 第 5 步）
重建   退役后再 tx.doc() → **新化身、新 DocumentId、新 tracker**（旧化身的内容留在存储里）
                         → 旧 watch/state 不会跟随新化身（它们绑定旧 record.id）
```

两条推论：

- **「先退役再重建」在同一条提交里也成立**：`retireDoc` 之后 `tx.doc()` 会创建一个新 incarnation（`test/session-documents.test.ts:479-517` 覆盖）。
- **数字 ID 永不复用**：逻辑地址不变，但每次化身都拿新 ID——这让「引用某个化身」的语义永远稳定。

### 2.5.7 fork 时文档怎么走

fork 的文档复制在 `src/session/forks.ts`（`prepareForkDocumentCopies`），规则很清楚：

```text
1. 用 storage.entry(parentConversationId, at) 做可见性检查（不可见抛 “Entry ${at} is not visible from conversation …”）
2. 第一遍：scope = **entry 所属会话**（可能是祖先！），at = entry 的 commitSeq，policy = "asOf"
3. 第二遍：scope = 直接父会话，at = "current"，policy = "current"
4. 只复制 conversation scope 的文档；`fork: "initial"` 的文档**永不复制**
5. 每个副本分配一个新的 DocumentId，记录里保留源的 kind/key/history/fork
6. 子地址查重：同一 child 地址被两个源选中 → 抛 “Fork selects multiple source documents for ${member}”
```

要点：

- **as-of 的源不是「直接父会话」**：如果 fork 点是一条被继承的祖先 entry，那么 as-of 值取自**拥有那条 entry 的会话**在**那个提交点**的状态（`test/session-forks.test.ts:180-229` 用三层 fork 验证）。
- **复制的是「存储里的值 + 存储里的版本」**，不是进程里已迁移的缓存（`test/session-forks.test.ts:231-279`）。
- **值不在这里物化**：本文件只拿 `DocumentRecord`，值由后端在 `document.copy` 时物化成一份**独立的 base**；如果 fork 事务里又对这个地址做了 typed access，才会读一次源值并把它合并成普通 `document.create`（`transaction.ts:622-647`）。

### 2.5.8 `checkpointWhen`：什么时候写 base

- 判定发生在装配阶段的**最后一步**，且**只对 delta**、**只判定一次**；
- 传入的 `info = { deltasSinceBase }` 是「自最近 base 以来已存的 delta 数」，**不含本次变更**；
- 返回 `true` → 这一笔写 base（`deltasSinceBase` 归零）；否则写 delta（`deltasSinceBase` +1）；
- 判定抛错 → 整笔回滚（存储尚未准入）。

内置文档的用法可以当模板：`pi.live`、`pi.usage` 这类高频小对象如果每笔都写 base 会很浪费，所以用阈值（累计若干 delta 后压一次 base）；而 `pi.agent` 这类低频对象基本每次都写 base。第 4 部分（`4.4.5 live.ts`）给出了每个内建文档的具体策略。

### 2.5.9 不变式与边界

| 主题 | 规则 |
|---|---|
| 定义 | `version` 必须安全正整数；session/task 文档不声明 history/fork；conversation 文档的 history/fork 必须与存储记录一致 |
| 创建 | 只有 `tx.doc()` 创建；family 的 seed 只在创建时生效 |
| 身份 | 地址由 (kind, scope, key) 决定；化身 ID 每次重建都换新且不复用 |
| 写入 | 赋入草稿的值按值复制且必须是严格 JSON；草稿回调结束即吊销 |
| 读取 | `snapshotAsOf` 只对 rewindable；数值点读 current-only 化身会抛错（不是返回旧值） |
| 退役 | 缺席地址退役是 no-op；任务终结强制退役其 task 文档 |
| fork | 只复制 conversation 文档；`initial` 不复制；每个副本新 ID；child 地址冲突即整笔拒绝 |

### 2.5.10 常见误解

| 误解 | 事实 |
|---|---|
| 「快照能顺手初始化文档」 | 不能。要初始化必须提交一次 `tx.doc()`（示例 `11` 的「缺失即默认值」正是靠这个语义） |
| 「`history: "rewindable"` 会保存每一次变更的值」 | 它保存的是**可寻址的化身与提交点**：你能按 entry 的提交点读值，但不能逐次列出所有中间值 |
| 「fork 会把父的最新文档复制过来」 | 取决于 `fork`：`initial` 不复制、`current` 取父当前、`asOf` 取 fork 条目那一刻 |
| 「task 文档会在任务结束后还留着」 | 不会。任务进入终态时，它的 task 文档在同批提交里被退役 |
| 「同一个 kind 的 family 成员会互相干扰」 | 不会。key 参与地址身份；但同一个 child 地址被两个源同时选中会整笔失败 |

---

## 2.6 ContextView：转录如何变成模型上下文

### 2.6.1 两个概念：事实与视图

```text
事实（存储）  entries 表：永远只追加，含所有被中止的尝试、被编辑掉的旧消息、被摘要覆盖的旧上下文
视图（派生）  ContextView：{ entries, head, messages }
              · entries  当前活跃的原始 entry（应用看）
              · head     最新的 head 标记（如果有）
              · messages 下一次 provider 请求真正要发的消息（模型看）
```

`conversation.context(ctx)` 返回的就是这个视图。它**不写入任何东西**；每次调用都从事实重新算一遍（可以理解为「快速重放」）。

### 2.6.2 派生规则

按顺序应用以下规则，得到 `messages`：

1. **确定上下文起点**：找最新的 `head` 标记；它指向的 entry（以及它之后）才进入上下文。没有标记则从转录开头开始。
2. **应用 `edits`**：一条 entry 可以声明对更早 entry 的 `model` 贡献做 `omit`（省略）或 `replace`（替换成给定 messages）。多个编辑指向同一目标时，**后者胜**（按 entry 顺序）。
3. **过滤不该发给模型的 assistant 消息**：`stopReason` 为 `aborted` / `error`（以及 `deferred`）的 assistant entry **保存在存储里但不进上下文**——模型不应该看到「上一次失败的半成品」。
4. **重排工具结果**：工具结果 entry 总是**紧跟它的调用**，并且按**调用顺序**排列（与它们在存储里的写入顺序无关）。崩溃恢复或并行执行时写入顺序可能与调用顺序不同，这一步把它们摆正。
5. **补位缺失的工具结果**：某个工具调用没有任何结果（例如模型要了一个不存在的工具），会合成一条错误结果，保证消息序列对 provider 合法。
6. **无 `model` 的 entry 完全不影响上下文**：纯展示 entry（如 `kind: "note"`）只出现在 `entries` 里。

示例 `09-context.ts` 把以上每一条都做成了可观察实验（见第 5.3 节），输出里能直接看到「存储里有 6 种 kind、`messages` 里只有该出现的几条」。

### 2.6.3 为什么这样设计

- **上下文是「可重算的」，所以历史可以随便追加覆盖手段**：压缩（`head`）、编辑（`edits`）、重置（`head`）都不需要改历史。
- **模型看到的必须是可证明的**：给定一份存储，任何人都能重算出「当时模型看到了什么」。
- **重排与补位是「面向 provider 的规整」**：provider 对消息序列有硬性要求（tool call 必须配对、顺序必须合法）。把规整放在派生层，意味着存储不必为了满足 provider 而做妥协。

### 2.6.4 常见误解

| 误解 | 事实 |
|---|---|
| 「`context()` 返回的是存储里的 entry 列表」 | 它返回的是**派生视图**：`entries` 是活跃原始 entry，`messages` 是规整后的请求消息 |
| 「中止的 assistant 消息从存储里删掉了」 | 没有。它在存储里，只是不进 `messages` |
| 「工具结果按写入顺序发给模型」 | 不是。按**调用顺序**重排，缺的还会补位 |
| 「`head` 之后的 entry 才是唯一存在的」 | `head` 只影响 `messages`；`entries` 与存储都保留更早的内容 |

---

## 2.7 Task：持久状态机

### 2.7.1 一句话职责

**Task 是一个「每一步都存档的函数」**。普通函数崩了就没了；Task 把执行拆成若干 **phase（阶段）**，每个 phase 结束把「下一步做什么」连同已发生的事实**写在同一笔提交里**。重启后从最近的存档继续。

结构上它是一个定义 + 一个记录：

```typescript
// 定义（代码，存在 registry 里，按 name 找回）
const Payment = defineTask<Input, State, Result>({
	name: "example.payment",                  // 持久化在 TaskRecord.kind
	version: 1,
	initial: (input) => ({ phase: "prepare", /* … */ }),   // 起点状态
	phases: {                                 // 对 State["phase"] 穷尽的映射
		prepare: async (task, runtime, context) => { /* … */ },
		charge:  async (task, runtime, context) => { /* … */ },
	},
	abort: async (task, runtime, context) => { /* … */ },  // 被中止时走它（不跑 phases）
	migrate: (input, checkpoint, fromVersion) => { /* … */ }, // 可选：旧版本状态升级
});

// 记录（数据，存在存储里）
type TaskRecord = {
	id, conversationId, kind, version, input,
	owner?, background, abortRequested,
	state,      // 状态机（见下）
	memos?,     // 只在 pending/running/waiting 存在
};
```

### 2.7.2 状态机

```text
pending     可以跑（重启后看到的未完成任务都是这个状态）
running     **本进程正在跑**（纯内存态；重启后不会保留，见下）
waiting     在等 on 列表里的任务；不占执行资源（不跑代码）
completing   结果已定（outcome 已经产生），但它拥有的工作还没排空
terminal     终局，带 outcome
```

`TaskState` 用判别式联合把「哪些字段在哪个状态下存在」编码进类型（`src/types.ts:486-520`）：

| 状态 | 必有 | 必无 |
|---|---|---|
| `pending` / `running` | `checkpoint` | `outcome` / `on` / `policy` |
| `waiting` | `checkpoint`、`on: TaskId[]`、`policy: "failFast" \| "allSettled"` | `outcome` |
| `completing` / `terminal` | `outcome` | `checkpoint`、`memos` |

终局有五种（`TaskOutcome`，`src/types.ts:449-483`）：

| outcome | 含义 | 谁产生 |
|---|---|---|
| `completed { result }` | 正常完成 | phase 提交 `terminal` |
| `failed { error, result? }` | 失败 | phase 提交 `terminal`（或 fault 的收尾） |
| `aborted { reason?, result? }` | 被中止 | abort 处理器提交终态 |
| `orphaned { reason }` | 拥有的任务消失/代码缺失导致无法继续，被结算成孤儿 | 调度器（第 2.8 节） |
| `faulted { error }` | 任务代码违反契约（例如 abort 处理器没提交终态） | 调度器 |

`TaskOutcomeError` 是 `{ message, detail? }`——错误在存储里是 **JSON 快照**，不是运行时 `Error` 对象。

### 2.7.3 `TaskRuntime`：phase 内能做什么

`TaskRuntime`（`src/types.ts:170-230`）是一次任务调用的能力面。它是 `DocumentObserver` + `DocumentReader` 的扩展，所以任务里能读写文档（这也是「任务文档」的由来）。

| 成员 | 作用 | 关键约束 |
|---|---|---|
| `taskId` / `conversationId` | 身份 | — |
| `signal: AbortSignal` | 本次调用的取消信号 | 取消的是**调用**，任务的持久状态由 abort 流程决定 |
| `registry` | phase 开始时解析的注册表快照 | 在途工作保持旧代码语义（第 2.12 节） |
| `agent(context)` / `settings` | 解析后的 agent；settings 每次访问重新求值 | — |
| `models` / `env(context)` | 模型管理器；执行环境 | `env` 每次使用重新构建 |
| `hooks` | `HookRunner`：按快照顺序调用匹配的 handler | 普通抛错只上报并继续；invocation 被取消则传播 |
| `commit(change, context)` | **在自己的 Session line 上重读任务记录再提交**，回调返回下一个状态 | 见 2.7.4 |
| `memo(name, value?, context)` | 两个重载：读 / 先写先赢地写 | 只存在于 live 状态（`pending`/`running`/`waiting`） |
| `getTask(id?)` / `waitForTask(id)` | 读任务记录 / 等终局 | — |
| `outcomes(ids, context)` | 读一组任务的终局，顺序与传入一致 | 需要它们都已终局 |
| `conversation(id)` / `entry(...)` / `context(...)` | 会话与转录访问（只读） | — |
| `now()` / `sleep(until, ctx)` | 时间与睡眠（Harness 的时钟） | `close()` 会取消睡眠（取消的是等待，不是检查点） |
| `report(error)` | 上报非致命诊断 | — |

### 2.7.4 黄金法则与 effect sandwich

```text
先保存你要做什么（意图） → 去做（副作用） → 保存结果（下一个检查点或终局）
```

这段形状在规范里叫 **effect sandwich**（`docs/spec.md:1849`），它是崩溃语义的来源：

| 崩在哪 | 重开后 |
|---|---|
| 保存意图之前 | 这一步没发生过，从头做 |
| 意图之后、副作用之前 | 这一步会重跑（副作用还没做，正确） |
| 副作用之后、保存结果之前 | 这一步会重跑 → **副作用可能重复**，执行体必须幂等 |
| 保存结果之后 | 从结果继续，不重跑 |

`runtime.commit(cb, ctx)` 的回调返回 `NextTaskState`（`src/types.ts:145`）：`running`（带新 checkpoint）、`waiting`（带 `on` + `policy`）、或 `terminal`（带 outcome）。注意一个细节：**如果返回值是 `terminal` 而任务名下仍有存活的 owned 工作，实际会被存成 `completing`**——结果已定，但要等拥有的工作排空。

`runtime.commit()` 的实现方式是「在自己的 Session 提交线上重读任务记录再提交」：这样即使期间有别的东西改过这条记录，也不会把过期状态写回去。

### 2.7.5 等待子任务：`waiting` / `on` / `policy`

```typescript
// 建子任务 + 进入等待 + 等待名单，同一笔提交原子完成（示例 24 的写法）
await runtime.commit(async (tx) => {
	const payments = [];
	for (const card of task.input.cards) {
		payments.push(await tx.createTask(Payment, { card }, { ownership: { kind: "task", taskId: task.id } }));
	}
	return { status: "waiting", checkpoint: { phase: "decide", payments }, on: payments, policy: "failFast" };
}, taskContext);
```

- `on` 可以写**任何任务 id**（不限于自己的子任务），配合 `allSettled`。
- `"allSettled"`：等全部结束；`"failFast"`：第一个失败会**中止其余**子任务。
- 等待中的任务**不跑代码、不占执行资源**；被唤醒后从 `checkpoint` 恢复。
- `runtime.outcomes(ids)` 在唤醒后读结果，**顺序与传入一致**。

### 2.7.6 abort：自底向上与 abort 处理器

```text
harness.abortTask(id) / conversation.abort()
  → 任务被标记 abortRequested
  → 先中止它拥有的工作（子任务、拥有的子会话），等它们收尾完
  → 才运行任务自己的 abort 处理器（在一个新的 invocation 里）
  → abort 处理器**必须提交终态**（aborted / completed / failed 都行）
    没提交 → 该任务被结算成 faulted
```

两条推论：

1. **每个任务负责撤销自己的副作用**——因为 abort 是先子后父，子任务在自己的 abort 处理器里退款/回滚，父任务处理自己那一层。
2. **`background: true` 是边界**：它拥有的工作躲过普通 `abort()`，也不让父级「忙」；要中止它必须显式 `abort(ctx, { background: true })`。

### 2.7.7 memo：比检查点更轻的「做过没」

```typescript
// 示例 13 的用法：先查「做过没」，再做副作用，并且先写 memo 再打印
if ((await runtime.memo(`printed-${n}`, taskContext)) === undefined) {
	await runtime.memo(`printed-${n}`, true, taskContext);   // 先写先赢
	console.log(`tick ${n}`);                                // 再做副作用
}
```

- **先写先赢**：同名第二次写不会覆盖（也不会报错）。
- **只在 live 状态存在**：任务进入 `completing`/`terminal` 后 `memos` 不再存在（类型层面 `memos?: never`）。
- 适合记「这种一次性副作用做过没有」；不适合当正式检查点（正式状态请用 `commit` 的 checkpoint）。

### 2.7.8 不变式与边界

| 主题 | 规则 |
|---|---|
| 定义 | `phases` 必须对 `State["phase"]` 穷尽；`name` 是持久化的 kind（重命名即破坏已有任务） |
| 状态 | 非终态必有 checkpoint；终态/`completing` 必有 outcome 且无 checkpoint、无 memos |
| 提交 | phase 必须通过 `runtime.commit()` 提交变化；不提交就结束 → fault |
| owner | 创建时必须给 `ownership`；`background` 只对 conversation-owned 任务有效；子任务不能是 background |
| 等待 | `waiting` 不占资源；`failFast` 会中止其余子任务 |
| 终局 | outcome 一旦产生不可变；`completing` 只等 owned 工作排空 |
| abort | 自底向上；abort 处理器必须提交终态，否则 faulted |
| 缺代码 | 重启后注册表里没有该 `kind` → 保持 pending 且被视为 blocked（`harness.inspect()` 可见），或按策略结算成 `orphaned` |

### 2.7.9 常见误解

| 误解 | 事实 |
|---|---|
| 「`running` 会被持久化，重启后继续 `running`」 | `running` 只是本进程的占用标记；重启后显示 `pending`（`open` 时会把遗留的 `running` 改回 `pending`） |
| 「任务崩了会自动重跑」 | 需要有不要求进展的调用（`resume` 等）来启动调度；且 phase 必须能从 checkpoint 恢复 |
| 「`runtime.memo` 会覆盖旧值」 | 先写先赢，第二次写无效 |
| 「abort 就等于立刻停」 | abort 是标记 + 自底向上传播 + 让处理器收尾；处理器没提交终态会 fault |
| 「`waiting` 的任务占着一个执行槽」 | 不占。它是纯数据状态，被唤醒时才重新占用调度 |


## 2.8 Scheduler：调度、唤醒与中止

### 2.8.1 一句话职责

**调度器把「存储里的任务记录」推进成「实际跑过的 phase」**（`src/harness/scheduler.ts`，1337 行）。它负责：唤醒、挑任务、跑 phase、结算状态、传播 abort、维护所有权与空闲判定、处理各种异常路径。

它**不做**：不创建任务（那是 `tx.createTask`）、不决定业务语义（那是 phase 代码）、不实现内建任务（那是 generation/tool/compaction）。

### 2.8.2 什么时候会动

`Harness.open()` 之后调度器处于 **paused**。会启动（或继续）它的路径只有几类：

| 路径 | 位置 |
|---|---|
| `harness.resume()` | 显式启动 |
| `harness.waitForTask(id)` / `harness.waitForIdle()` | `harness.ts:275` / `280` |
| `conversation.compact()` / `conversation.abort()` / `conversation.waitForIdle()` | `harness.ts:105` / `146` / `151`（三处隐式 `resume()`） |
| 提交回调链（例如某个 submission 内部要求进展） | `harness.ts:200` |

**纯读永远不启动调度**：`viewState` / `watch` / `watchEvents` / `watchDoc` / `documentState` / `snapshot` / `taskGraph` / `inspect` / `usage` / `entries` / `context` 都只读（示例 `13` 的第二段专门证明这点）。

### 2.8.3 唤醒机制

调度器不轮询，靠**微任务合并的唤醒**：

```text
#scheduleReconcile()  把一次 reconcile 排进微任务；同一批里多次请求只跑一次（scheduler.ts:429-433）
#kick() / #drain()    唤醒循环：取出可跑任务，逐个推进（scheduler.ts:675-696）
join / waitForTask    在线上做一次「现在还有没有要等的」检查，必要时登记等待（scheduler.ts:264-308）
```

`#reconcile` 是「按已提交状态重算一遍该跑什么」的核心：它处理 waiting 的兑现、abort 标记的落地、终态的提交（`scheduler.ts:461-469`）。

### 2.8.4 一轮调度：挑任务 → 跑 phase → 结算

```text
1. #reserve(task)   判定这个任务现在能不能跑；能跑就写入 running（scheduler.ts:699-742）
2. #run(task)       执行 phase 循环（scheduler.ts:852-873）
3. #decide(task)    六条优先级规则决定这一步做什么（scheduler.ts:879-912）
4. #step(task)      三态决策：继续 / 等待 / 终止（scheduler.ts:937-959）
5. #commitState()   phase 提交后的状态结算（scheduler.ts:980-997）
   #terminate()     终态提交（scheduler.ts:965-973）
```

phase 的执行体（`PhaseHandler`）拿到的 `task.state.checkpoint` 是**进入这个 phase 时的存档**；它必须用 `runtime.commit()` 提交「下一个 checkpoint 或终局」，否则这次调用会被判 fault（`scheduler.ts:927-928`）。

### 2.8.5 `waiting` 的兑现

```text
等待登记   #waitingOn(task) 读出 on 列表（scheduler.ts:744-752）
观察子任务 #observe(...)     在子任务状态变化时登记/解除 failFast 的联动（scheduler.ts:379-394）
兑现      #reconcile 发现「on 全部满足」→ 把任务重新放回可跑（scheduler.ts:461-469）
校验      #validateWait 四条校验（scheduler.ts:1003-1024）：on 非空、policy 合法、id 存在、没有自等
```

`failFast` 的联动是**双向登记**的：父任务进入 waiting 时把「谁在等我」记在子任务上，子任务失败时能直接找到要中止的兄弟任务（`#observe:379-394`）。

### 2.8.6 `completing`、所有权与空闲

```text
#ownedLive(task)   这个任务名下还有多少存活的 owned 工作（含拥有的会话）；background 子树在这里被截断
                   （scheduler.ts:613-631）
#finalize(...)     结果已定但 owned 工作还在 → 写成 completing；排空后写 terminal（scheduler.ts:491-513）
#idle(...)         会话空闲判定：它拥有的前台工作全部排空（scheduler.ts:1037-1044）
#inScope(...)      遍历作用域三态：会话自己的任务 / 子树 / roots（scheduler.ts:633-648）
```

三条推论：

1. **父会话要等它拥有的子会话空闲才算空闲**——前台 subagent 没答完，父会话就一直忙（示例 `22`）。
2. **`background: true` 的任务不计入「忙」**，它拥有的工作也不参与父级的 abort（示例 `23` 的常驻 subagent 就是这么活的）。
3. **`completing` 是「结果已定、等排空」**：`waitForTask()` 要等它变成 `terminal` 才返回。

### 2.8.7 abort 传播

```text
上升沿      #observe 检测到任务的 abortRequested 由 false → true：abort 该调用的 controller（scheduler.ts:368-373）
自底向上    #runAbort：先中止 owned 工作（scheduler.ts:914-929）；#belowCancelled 判断「子工作是否都已取消」（650-663）
abort 处理器 在一个新的 invocation 里跑，必须提交终态；没提交 → faulted（scheduler.ts:927-928）
```

注意与「取消调用」的区别：`abort` 传播的是**任务的持久状态意图**（`abortRequested` 标记），不是仅仅掐掉某个 promise。这也解释了为什么 `abort()` 能在**另一个进程重启之后**继续生效——标记在存储里。

### 2.8.8 异常路径

| 情况 | 调度器的反应 |
|---|---|
| 任务的 `kind` 在注册表里找不到 | 保持 `pending`（不改状态），`harness.inspect()` 报为 blocked；abort 通道下会被结算成 `orphaned`（`scheduler.ts:716-720`） |
| phase 抛错 | 任务被判 fault → `faulted { error }`（`scheduler.ts:927-928` 附近的路径） |
| `runtime.commit()` 的返回值非法（例如 `on` 里写了不存在的 id） | `#validateWait` 拒绝，任务 fault |
| 任务在 `running` 期间进程崩溃 | 重启后 `open` 把 `running` 改回 `pending`（`scheduler.ts:244-246`），下一次唤醒重跑该 phase |

### 2.8.9 不变式与边界

| 主题 | 规则 |
|---|---|
| 单一写入点 | 任务记录在内存中的「活」视图只有一个写入点（`#live`）；状态变化都要经提交 |
| 内存态 vs 提交态 | `running` 只在内存；`LIVE_STATUSES` 决定什么算活任务 |
| 唤醒 | 微任务合并；同一批多次请求只 reconcile 一次 |
| 等待 | `on` 必须非空、不能自等；`failFast` 双向登记 |
| 空闲 | 只看 owned 前台工作；background 子树被截断 |
| abort | 标记驱动、自底向上；处理器必须提交终态 |
| 纯读 | 任何 `taskGraph`/视图类调用都不推进调度 |

### 2.8.10 常见误解

| 误解 | 事实 |
|---|---|
| 「有任务在存储里就会自动跑」 | 不会。必须有调用要求进展 |
| 「`abort()` 会立刻返回，工作已经被停」 | `abort()` 解析时会话已空闲，但**中间**要走完自底向上的中止与收尾 |
| 「后台任务也能用普通 abort 停掉」 | 只有 `abort(ctx, { background: true })` 能跨过边界 |
| 「子任务失败时父任务会自动失败」 | 取决于 `policy`：`failFast` 会中止其余子任务并唤醒父任务；`allSettled` 等全部结束后由父任务自己决定 |
| 「`taskGraph` 上看得到缺代码的任务」 | 看不到。缺定义要用 `harness.inspect()` 查 |


## 2.9 Submission 与 Inbox

### 2.9.1 一句话职责

**Submission 是宿主交给会话的「请求单」**：要么是用户输入（`input`，会触发一轮 run），要么是一条只写入转录的 entry（`write`，不叫模型）。**Inbox 是忙时会话的排队区**（文档 `pi.inbox`）。

### 2.9.2 两种提交与状态机

```text
input： queued → placed（落成 pi.user entry，等回答）→ done（有 answer entry id）
                                                  → unanswered（reason: "aborted" 等）
write： queued → done（落成 entry）/ unanswered
```

类型层面用 `?: never` 排除非法字段组合（`src/types.ts:363-427`）：

| 状态 | 必有 | 必无 |
|---|---|---|
| `queued` | — | `entry` / `answer` / `reason` / `detail` |
| `placed`（仅 input） | `entry` | `answer` / `reason` |
| `done` | `entry`（input 还要 `answer`） | `reason` |
| `unanswered` | `reason`（可带 `detail`） | `answer` |

运行时由 `applySubmissionChange` 收口（`transaction.ts:67-79`）：已 settled 的记录不再变化；placement 只对 `queued` 合法；**只有 `placed` 的 input 才能被回答**；write 永远不带 `answer`。

### 2.9.3 `requestId`：崩溃恢复的第一道防线

```typescript
const first = await root.submit({ type: "input", content: "Hello", requestId: "greeting-1" }, context);
// 重启后再发同一条：
const again = await root.submit({ type: "input", content: "Hello", requestId: "greeting-1" }, context);
// again.id === first.id —— 不会提交第二次
```

去重发生在准入层：先 `submissionByRequest(conversationId, requestId)` 查，命中就返回已有提交。这条机制是所有「不该重复的投递」的基础（子 agent 的问题不被问两遍、后台 subagent 的汇报不重复送）。

### 2.9.4 忙时会发生什么

会话在 run 进行中是 **busy**（判据：`docs["pi.live"].run !== undefined`）。此时再 submit 的四种处理方式：

| 提交方式 | 行为 | 放置时机 |
|---|---|---|
| `input`（默认 `followUp`） | 进 `pi.inbox`，`mode: "followUp"` | 当前 run 给出答案后，**开启下一次 run** |
| `input` + `whenBusy: "steer"` | 进 inbox，`mode: "steer"` | **当前工具轮结束后**并入正在跑的工作 |
| `write` | 进 inbox，`mode: "write"` | 下一个边界直接追加 entry，**不叫模型** |
| `input` + `whenBusy: "reject"` | 抛 `ConversationBusy`，**什么都不写** | — |

设置项 `followUpMode` / `steeringMode`（`"all"` vs 默认的一次一项）决定边界处放几个排队项。

### 2.9.5 放置：边界与顺序

```text
边界（boundary）有两类：
  postTools   一个工具轮结束后（steer 在这里并入）
  final       run 给出最终答案时（followUp 在这里放到下一次 run）

放置顺序（同一批里）：
  writes 先于 users       ← 因为 write 只是追加 entry，不会改变「这一轮要不要再请求模型」
  同样类型的项按最旧优先
  位置性：某项被放置后从 inbox 删除
```

`pi.inbox` 里能看到每项的 `mode`、顺序与（必要时）来源信息——这既是 UI 的数据源，也是「用户说的话不会丢」的证据。

### 2.9.6 等待、撤回与「失败不清空」

```typescript
const submission = await root.submit({ type: "input", content: "..." }, context);
const settled = await submission.wait(context);
// settled.status === "done"       → settled.answer 是答案 entry id
// settled.status === "unanswered" → settled.reason 说明原因（如 "aborted"）

await submission.abort(context);   // 只能撤回还没被放置的提交
// 返回 "aborted" | "already_placed" | "settled"
```

- **`wait()` 只是等待**：取消它（取消 context）不会停掉正在跑的生成；输出仍按 ≤100ms 窗口提交，之后可以用 `harness.submission(id)` 重新拿句柄接着等。
- **run 失败 ≠ 清空队列**：剩下的项留在 inbox，等下一次提交按最旧优先放置。好处是「用户说的话不会丢」；代价是失败后的下一次提交可能带出一批旧消息——产品上要想清楚这个行为。
- **`reset()` 忙时也排队**：像 write 一样进 inbox；如果落在工具轮中间，当前 run 结束。

### 2.9.7 不变式与边界

| 主题 | 规则 |
|---|---|
| 准入 | 忙 + `whenBusy: "reject"` → 抛 `ConversationBusy`（带 `conversationId`），且不产生任何写 |
| 去重 | 同会话同 `requestId` 只准入一次 |
| 状态机 | 终态不可变；placement 只对 queued；只有 placed 的 input 能被回答 |
| 顺序 | writes 先于 users；同类最旧优先 |
| 撤回 | 只对 queued 有效 |
| 失败 | 队列不清空，留待下一次提交 |

### 2.9.8 常见误解

| 误解 | 事实 |
|---|---|
| 「busy 时 submit 会报错」 | 默认不报错，进 inbox 排队；要报错得显式 `whenBusy: "reject"` |
| 「`write` 会立刻写进转录」 | busy 时同样进 inbox，在下一个边界放置。别拿它做实时日志 |
| 「`submission.wait()` 内部会推动调度」 | 会（它是「要求进展」的调用之一），但取消这次等待**不会**推动或停止工作 |
| 「撤回一个已放置的提交能撤销那句话」 | 不能，返回 `already_placed`。已放置意味着 entry 已经落盘 |
| 「run 失败后剩下的排队项会丢」 | 不会，留在 inbox 里 |

---

## 2.10 Harness：顶层门面

### 2.10.1 一句话职责

**Harness = 一份打开的存储 + 跑 agent 的全部机制**：调度器、内建任务、扩展注册表、视图与事件、观察辅助。它本身是一个 `Session`（`HarnessImpl extends SessionImpl`），所以 `commit` / `snapshot` / `watchDoc` 这一整套在 Harness 上一样可用。

```typescript
const harness = await Harness.open(storage, { models, registry }, context);
```

`Harness.open` 的三个参数：

| 参数 | 必填 | 内容 |
|---|---|---|
| `storage` | 是 | 任何满足 `Storage` 契约的后端 |
| `options` | 是 | `models`（必给）、`registry`、`settings`、`env`、`conversationCreated` 等 |
| `context` | 是 | Chord 的 context（打开过程本身可被取消） |

打开之后调度器处于 **paused**——没有任何工作会自己动，直到有调用要求进展（第 2.8.2 节）。

### 2.10.2 导出面

| 成员 | 作用 |
|---|---|
| `Harness.open(storage, options, context)` | 打开（静态方法） |
| `root(context, init?)` | 根会话句柄；**首次**调用时创建（连同内建文档、agent 配置、`init` 写的文档，一笔提交），之后忽略 `agent`/`init` |
| `conversation(id, context)` | 按 id 取会话句柄（重启后恢复句柄的标准方式） |
| `createConversation(options, context)` | 新建会话 |
| `resume()` | 启动调度器 |
| `waitForTask(id, context)` | 等任务终局（含它的 owned 工作排空） |
| `waitForIdle(context, options?)` | 等会话的前台工作全部空闲 |
| `abortTask(id, context)` | 中止任务（走 abort 处理器） |
| `taskGraph(context)` / `watchTaskGraph(context)` | 活任务图（第 2.19 节） |
| `inspect(context)` | 诊断：blocked 任务、缺代码的任务等 |
| `usage(context)` | 全 Session 用量（第 2.20 节） |
| `submission(id, context)` | 按 id 重新拿 Submission 句柄（重启后接着等） |
| `close(context)` | 收尾：join 任务调用 → 结算已准入提交 → 关存储 |

### 2.10.3 内部结构与「隐式 resume」

`HarnessImpl` 在构造时装配 `TaskScheduler`，并把 `conversationCreated` 覆写成「写内建文档」（`pi.live` / `pi.inbox` / `pi.usage` / `pi.provider` / `pi.agent`），这样**任何**创建会话的路径（包括工具里裸 `tx.createConversation()`）都会带上它们。

会话句柄 `ConversationImpl` 的几处方法会**隐式要求进展**：

```text
compact()      → resume()
abort()        → resume()
waitForIdle()  → resume()
(submission 内部链路也会要求进展)
```

而**句柄本身是无状态的**：两个句柄只要 `id` 相同就指向同一份持久会话；跨重启的唯一身份就是 `id`（陷阱：不要把句柄当有状态对象缓存）。

### 2.10.4 不变式与边界

| 主题 | 规则 |
|---|---|
| 打开即暂停 | `open` 之后不会自动跑任何任务 |
| 首次创建语义 | `root()` / `createConversation({init})` 的 `agent`+`init` 只在**创建那一笔**生效；之后要改配置用 `configure()` |
| 关闭顺序 | `Harness.close()` → `Session.close()`（先 `beforeClose` join 任务调用，再关存储） |
| 只读不推进 | `inspect`/`usage`/`taskGraph`/`viewState`/`watch*` 都不启动调度 |

---

## 2.11 Conversation：会话句柄

### 2.11.1 一句话职责

**Conversation 是「一场对话」的句柄**：一串 entry + 一组会话级文档。它对外提供提交、配置、转录读取、观察、fork 等操作。

**句柄无状态**：`Conversation` 不是对象缓存，`id` 相同即同一场对话；重启后用 `harness.conversation(id, ctx)` 取回。

### 2.11.2 方法表

| 方法 | 作用 | 关键语义 |
|---|---|---|
| `submit(request, context)` | 提交 input / write | 返回 `Submission`；忙时按 `whenBusy` 处理（2.9.4） |
| `commit((tx) => ..., context)` | 事务写 | 详见第 2.3 节 |
| `configure(change, context)` | 改 `pi.agent` | 一笔提交生效；数组 = 恰好这些，`{ remove: [...] }` = 差量，`null` = 清除回宿主默认 |
| `agent(context)` | 解析后的 agent | 把存储里的名字解析成活对象（扩展实例、工具函数） |
| `reset(note?, context)` | 新上下文 | 追加 `pi.reset`（可带交接文本）；更早 entry 保留在存储里 |
| `compact(instructions?, context)` | 手动压缩 | 返回任务 id；不受 `settings.compaction.enabled` 影响 |
| `abort(context, options?)` | 中止当前工作 | 撤回排队中的 input（**write 保留**）；中止它拥有的任务；`{ background: true }` 才跨边界 |
| `entries(filter?, limit, cursor, context)` | 分页读转录 | **最新在前**；含从父会话继承的部分 |
| `context(context)` | 派生视图 | `{ entries, head, messages }`（第 2.6 节） |
| `viewState(context)` / `watch(context)` | 视图快照 / 快照 + ops | 第 2.17 节 |
| `waitForIdle(context, options?)` | 等空闲 | 只等前台工作（background 不算） |
| `fork(entryId, options, context)` | 分叉 | 继承到 `entryId` 为止；文档按各自 `fork` 语义取值（第 2.5.7 节） |

### 2.11.3 三条容易踩的语义

1. **`abort()` 的撤回是有选择的**：排队的 `input` 被撤回成 `unanswered(aborted)`，但排队的 **write 保留**（因为它是「把用户说的话记下来」，不是「要求模型做事」）。
2. **`reset()` 忙时排队**：像 write 一样进 inbox；如果落在工具轮中间，当前 run 结束。工具也能用 `control: { handoff: "..." }` 请求同样的效果。
3. **`entries()` 的顺序与「活跃」无关**：它分页的是**存储里的转录**（最新在前），不做 head/edits 过滤。要看「模型实际会看到什么」用 `context()`。

---

## 2.12 Registry 与 Extension

### 2.12.1 扩展是什么

**Extension = 命名的一包代码**，可以有五种构件（`src/harness/define.ts`）：

| 构件 | 定义方式 | 作用 |
|---|---|---|
| `tools` | `defineTool({...})` | 模型可调用的工具 |
| `sections` | `section(name, render, options?)` | 系统提示的段落 |
| `hooks` | `hook(TaskKind, {...})` | 观察/干预内建任务 |
| `wraps` | `wrapTool(...)` / `wrapSection(...)` | 按名字装饰别的工具或段落 |
| `tasks` | `defineTask({...})` | 自定义持久任务 |

```typescript
const registry = createRegistry();
registry.install(CodingTools);      // 按名字安装（同名 = 原地替换）
registry.install(defineExtension({ name: "guard", hooks: [hook(ToolTask, {...})] }));
```

### 2.12.2 三条铁律

1. **注册表由你的进程拥有**：它是**代码表**，不是数据表。存储里只记**名字**（`pi.agent.extensions` 存 `["files"]`）。
2. **默认全选**：不配置时，每个会话按 install 顺序选择所有已装扩展；`settings.extensions` 或 `configure()` 可以改变选择。
3. **名字比代码长寿**：卸载扩展后，选着它的会话只是「拿不到它的贡献」；装回同名扩展立即恢复（示例 `07`、`31`）。重启后必须重新 install，否则任务找不到定义（`blocked` / `missing_task`）。

### 2.12.3 解析时机与在途工作

- **agent 解析（名字 → 活对象）发生在「每次使用」**：请求准备时解析 model/prompt/tools；工具调用与 hook 在 phase 解析时用当时注册表里的代码。
- **同名 `install` 是原地替换**：一步到位，没有「短暂消失」的窗口（示例 `10`）。
- **在途工作保持旧代码**：已开始的工具调用用旧实现跑完；下一个 phase / 请求 / 调用才用新代码（示例 `31` 把它做成可观察实验）。
- **wrap 装饰「最终获胜的那个」**：如果两个扩展提供同名工具，后安装的替换先安装的；`wrapTool()` 装饰胜出的那一个（示例 `30`）。

---

## 2.13 Agent 与 Settings：按会话 vs 宿主级

### 2.13.1 `pi.agent`：会话存什么

```typescript
await root.configure({
	model: { provider: "openai", modelId: "gpt-6-sol" },
	thinkingLevel: "high",
	extensions: { remove: [Coding] },   // 差量：在宿主默认上移除；数组 = 恰好选这些（按顺序）
	tools: [readTool, bashTool],        // 数组 = 恰好提供这些；{ remove: [...] } = 移除部分
	instructions: "Only read; never edit files.",
	cwd: "/work/repo",
}, context);
await root.configure({ tools: null }, context);   // null = 清除，回到宿主默认
```

| 字段 | 含义 | 未设置时 |
|---|---|---|
| `model` / `thinkingLevel` | 用哪个模型与思考档位 | 跟随宿主 settings / 默认 |
| `extensions` | 选哪些扩展（数组或 `{ remove }` 差量） | 跟随宿主默认选择（不给 = 全选已装） |
| `tools` | 提供哪些工具（数组或 `{ remove }`） | 由所选扩展贡献 |
| `instructions` | 追加给该会话的指令（渲染成 `instructions` section） | 无 |
| `cwd` | 工作目录（影响 environment 构建） | 宿主默认 |

**解析管线**（`src/harness/agent.ts`）：扩展选择 → 应用 wraps → 工具过滤 → instructions 合并 → 产出「活对象」的 agent。三个来源的优先级：**会话的 `pi.agent` > 宿主 `settings` > 内建默认**（未设置的字段逐项回退）。

### 2.13.2 什么时候生效

- **请求级**：一次请求的 model / prompt / 工具列表在**准备那一刻固定**；配置变化从**下一个**请求生效。
- **使用级**：工具调用与 hook 在 phase 解析时取**当时**的 agent；environment 按**每次使用时的当前 cwd** 构建。所以 `cwd` 或扩展变化**能影响模型已经发出的调用**（示例 `26`）。
- **创建时**：`root()` / `createConversation()` / `fork()` 都接受同样的 `agent` 参数，在创建那一笔提交里生效；fork 继承 fork 点时刻的父 agent（`pi.agent` 是 `asOf` 型文档）；任务拥有的会话以 owner 会话的 agent 副本起步。

### 2.13.3 `settings`：宿主级策略，只读不存

```typescript
settings: {
	extensions: [CodingTools, Coding],           // 默认选择；不给 = 全选
	stream: { timeoutMs: 120_000 },
	retry: { maxRetries: 3 },
	compaction: { reserveTokens: 16384 },
	toolExecution: "parallel",                   // 一轮里多个工具调用并行/串行
	get followUpMode() { return userSettings.followUpMode; },   // getter = 实时配置
}
```

- **每次使用现场读取、从不存储**：所以用 getter 就能让它「活」起来（例如读配置文件）。
- 常用字段：`followUpMode` / `steeringMode`（忙时放置策略）、`compaction.{enabled,reserveTokens,keepRecentTokens,backgroundTokens}`、`stream.timeoutMs`、`retry.maxRetries`、`toolExecution`。

### 2.13.4 不变式与边界

| 主题 | 规则 |
|---|---|
| 存名字 | 会话里存的是扩展/工具**名字**；代码由进程提供 |
| 回退 | 每个字段独立回退：会话 → settings → 默认 |
| 时机 | 模型/提示/工具在请求准备时固定；agent 与 env 在每次使用时解析 |
| 创建语义 | `agent` 只在创建那一笔生效；后续修改用 `configure()` |

### 2.13.5 常见误解

| 误解 | 事实 |
|---|---|
| 「第二次 `root(ctx, { agent })` 能改配置」 | 不能，根会话只在**首次创建**时接受 `agent`/`init`；之后用 `configure()` |
| 「卸载扩展会清掉会话里的选择」 | 不会。存的是名字，装回来即生效 |
| 「`settings` 会被写进存储」 | 不会。它每次使用现场读取 |
| 「改了 `cwd` 对正在跑的工具没有影响」 | 有影响：environment 按每次使用时的当前 `cwd` 构建 |

---

## 2.14 Prompt：系统提示的渲染与差量

### 2.14.1 一句话职责

**系统提示不是一根存下来的字符串，而是「每次请求前重新渲染，再与模型已见内容算差量」的结果**（`src/harness/prompt.ts`）。

```typescript
section("cwd", (input) => input.env?.cwd);   // 渲染成 <cwd>…</cwd>；返回 undefined 则整段省略
```

### 2.14.2 渲染模型

1. **选择的扩展按顺序贡献 section**；每个 section 的 `render(input)` 能看到：解析后的 agent、为本次请求构建的 environment、已提交文档的读取能力（`input.read`）。
2. **默认渲染成 `<name>\n内容\n</name>` 包裹的段落**；`{ tag: false }` 可以关掉包裹；返回 `undefined` **整段省略**（连标签都没有）。
3. **会话的 `instructions` 最后渲染**，作为名为 `instructions` 的段落。
4. 渲染结果与「模型已见的提示状态」比较，产出**位置性的 `pi.system` entry**：只包含变化的部分（`sections` 的增删改、`toolsAdded` / `toolsRemoved`）。
5. 下一次请求只把**变化的部分**再发给模型——prompt cache 因此能保温。

### 2.14.3 稳定性要求（一个硬约束）

```text
section 内容必须稳定：返回时间戳、随机数、每次不同的东西
  → 每次渲染都不同 → 每次都追加 pi.system → 每次都让 provider 的 prompt cache 失效
```

要放动态信息（例如当前时间、变更中的目录），用「**初始稳定 + 差量**」的设计：把稳定部分作为 section，把变化作为**位置性更新**（新增一条 `pi.system`），而不是整段重写。

### 2.14.4 差量规划的几个细节（`src/harness/prompt.ts`）

- 有 **baseline**：以「模型已见的状态」为基准计算最小补丁；
- 顺序重写会被折叠成最小 patch（而不是每次整段重发）；
- 工具声明的增删用 `toolsAdded` / `toolsRemoved` 表达；规范明确 `toolsRemoved` 在同一消息内**先于** `toolsAdded` 应用（`docs/spec.md:137`）；
- `pi.system` 的 `content` 恒为 `""`——所有内容都在 `sections` 里（第 2.4.3 节）。

### 2.14.5 常见误解

| 误解 | 事实 |
|---|---|
| 「系统提示是会话开始时算一次、之后不变」 | 每次请求重新渲染 + 算差量 |
| 「section 里可以随便放动态内容」 | 可以放，但代价是 prompt cache 失效（示例 `15` 用 cwd 差量演示正确做法） |
| 「section 返回空字符串等于省略」 | 空字符串仍然是一个段落；要省略请返回 `undefined` |

---

## 2.15 Environment：执行环境

### 2.15.1 一句话职责

**Environment 是「工具与 section 接触外部世界的方式」**：文件、目录、进程。它不是全局单例，而是**按每次使用构建**：每次工具调用、每次 section 渲染、每次 `runtime.env()` 都会调用宿主提供的 `env` 回调。

```typescript
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";

const harness = await Harness.open(storage, {
	models,
	registry,
	env: ({ cwd }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() }),
}, context);
```

`env` 回调能拿到：会话 id、agent 的 `cwd`、已提交状态读取能力。因此一个函数就能实现「每个会话一个目录」或「每个会话一个容器」（示例 `29` 从应用文档里查沙箱配置）。

### 2.15.2 边界情况（全都要记住）

| 情况 | 行为 |
|---|---|
| `env` 回调抛错 | 变成**该调用的 error 结果**（不是 run 崩溃） |
| 没配 environment | 内建工具全部以 error 结果失败 |
| 每次新建环境对象 | 没问题：`edit`/`write` 按「环境的 `id` + 路径」串行化对同一文件的修改 |
| 自定义 `ExecutionEnv` 的 `id` | **相同 id = 看到同一批文件的同一批路径**（例如一个容器一个 id）；这是崩溃重放与并发修改正确性的依据 |
| 环境变化 | environment 按**每次使用时的当前 `cwd`** 构建，所以配置变化能影响模型已发出的调用 |

### 2.15.3 `NodeExecutionEnv`

Node 环境实现（`src/env/node.ts`，957 行）提供文件读写、目录列举、进程执行、glob 等原语，也是 JSONL 后端的 `FileSystem` 实现。内建工具只通过 environment 接触文件与进程——这意味着**换一个 environment 就换了一整套沙箱**（示例 `29`）。

### 2.15.4 常见误解

| 误解 | 事实 |
|---|---|
| 「environment 是单例，可以缓存起来复用」 | 它按每次使用构建。缓存它会让 `cwd` 变化失效（示例 `26`、`29`） |
| 「工具直接读磁盘」 | 不直接。工具只通过调用处的 environment 接触文件与进程 |
| 「两个不同的 environment 可以安全地同时改一个文件」 | 只要 `id` 不同就**不保证**；相同 `id` 才会被串行化 |

---

## 2.16 Tool 运行时：一次工具调用的完整生命周期

### 2.16.1 定义工具

```typescript
const count = defineTool({
	name: "count",
	description: "Count from 1 to n",
	parameters: Type.Object({ n: Type.Number() }),     // TypeBox schema；args 类型由它推导
	replay: "safe",                                      // 声明「崩溃后可安全重跑」（默认 unsafe）
	execute: async (args, api) => {
		for (let i = 1; i <= args.n; i++) api.output(`${i}\n`);   // 运行中输出（节流提交）
		return {};                                                 // 没给 content 时，output 累积内容即结果
	},
});
```

### 2.16.2 一次调用的四个阶段

```text
1. 意图（intent）
   generation 为每个工具调用建一个 pi.tool 子任务（owner = 本 generation）
   任务的第一笔提交就把「我要执行这个调用、参数是什么」落盘
2. 校验与拦截
   Harness 用 pi-ai 的 validateToolArguments() 按 schema 校验参数（不合格 → error 结果，模型可自我纠正）
   beforeTool hook 可以 { block }（拦截）或 { arguments }（改参数）
3. 执行（execute）
   在调用处的 environment 里跑；api.output() 的运行中输出按 ≤100ms 节流提交
   afterTool hook 可以替换结果
4. 结果（result）
   工具结果与下一个检查点**同笔提交**：pi.tool-result entry + 任务终局
```

### 2.16.3 结果与 `api`

| 成员 | 作用 |
|---|---|
| `api.output(text)` | 流式输出，节流提交；有界窗口（默认尾部 2000 行 / 50KB，超出落盘并在 diagnostic 给路径） |
| `api.commit(cb, ctx)` | 在工具执行中间做一次提交（例如建子会话） |
| `api.conversation(id, ctx)` | 拿到会话句柄（子 agent 用法） |
| `api.details(obj, ctx)` | 给 UI 的细节（写进 `pi.live` 的工具槽，事件流会带 `conversationId`） |
| `api.taskId` / `api.conversationId` | 身份 |
| 返回值 `content` | 显式结果；不给 `content` 时用累积的 `output` |
| 返回值 `usage` | 计入 `pi.usage`（按工具名） |
| 返回值 `control: { terminate: true }` | 当**一轮里所有结果**都这么要求时，run 直接结束不再请求模型 |
| 返回值 `control: { handoff: "..." }` | 等价于在工具轮边界触发一次 reset（第 3.5 节） |

### 2.16.4 `replay` 与崩溃语义

| 情况 | 结果 |
|---|---|
| `execute` 抛错 | 模型收到 error 结果（run 不一定死） |
| 进程死在调用中途，工具声明了 `replay: "safe"` | 重开时**重跑**——执行体必须幂等 |
| 进程死在调用中途，工具是默认 `unsafe` | **不重跑**；模型收到 `interrupted` 错误结果（附已提交的输出） |

**怎么选**：副作用可幂等（或有 memo 保护）→ `"safe"`；不可重复（例如「发一封邮件」）→ 保持 `unsafe`，宁可报 interrupted 也不重复副作用。注意 `replay: "safe"` **只是声明**，你还要让 `execute` 真的幂等（示例 `22` 的「三件套」，见第 3.3、3.6 节）。

### 2.16.5 同名替换与 wrap

- 后安装扩展里的同名工具**替换**先安装的（在两者都被选择的会话里）；
- `wrapTool()` 装饰「最终获胜的那个」（示例 `30` 用计时器包住获胜的 `bash`）；
- 一轮里的多个调用是并行还是串行由 `settings.toolExecution` 决定；语义不变：**一轮全部结束后才发起下一轮请求**。

---

## 2.17 View 与 Watch：把状态交给 UI

### 2.17.1 一句话职责

**UI 需要的一切都是「已提交状态」**。这个包提供三种消费方式，分别适合三类客户端（`src/harness/view.ts`、`src/session/observation.ts`）。

```typescript
// ① 一次性快照 + 订阅完整值（本地 TUI 最常用）
const view = await root.viewState(context);
view.subscribe((value) => render(value));         // value.entries / value.docs["pi.live"] / …

// ② 快照 + 每笔提交的精确 ops（远端同步）
const watch = await root.watch(context);
render(watch.value);
watch.start(async (value, ops) => { await send(ops); });

// ③ agent 事件流（对接 coding-agent 风格的协议）
const stream = await watchEvents(harness, root.id, context);
```

### 2.17.2 `ConversationView` 的内容

```text
ConversationView = {
  conversation,                        // ConversationRecord（含 owner / parent）
  entries,                             // 活跃转录（按 head 截断）
  docs: Readonly<Record<string, JsonObject>>   // 按「稳定的 document kind」挂载的内建文档
}
```

`docs` 里能拿到 `pi.live`（当前 run 的流式片段、工具槽与 details、压缩进度、重试退避）、`pi.inbox`、`pi.usage`、`pi.agent`、`pi.provider`。

挂载机制（`view.ts`）有三个特点：

1. **原子附着**：捕获某个已提交快照 + 登记之后的每一帧精确变更，返回时已经水合（不会「先看到旧值再等更新」）；
2. **不重投**：快照已覆盖的 ops 不会再发一次；
3. **第三方文档不自动挂载**：只有内建/已知 kind 会进 `docs`；你自己的文档用 `watchDoc` / `documentState`。

`view.dispose()` 释放的是**观察**，不是文档本身。

### 2.17.3 `watch()`：快照 + 精确 ops

`watch()` 返回 `{ value, start, stop }`：

- `value` 是**附着时刻**的状态（之后每次交付时更新）；
- `start(listener)` 安装唯一 listener，**绝不内联调用**（第一次交付总在微任务之后）；
- 交付是**串行**的（不会并发调用同一个 listener）；
- **慢消费者保护**：最多积压 100 帧，超过后未交付的帧被**一帧「完整最新视图」**替换——所以交付序列可能跳号，但一定收敛到最新；
- `stop()` 幂等，返回终止原因（`stopped` / `cancelled` / `session_closed` / `retired` / `listener_error`）。

### 2.17.4 文档级观察：`watchDoc` 与 `documentState`

```typescript
const watch = await harness.watchDoc(Todos, root.id, context);
if (watch === undefined) return;                  // 文档缺席：观察不会创建它
console.log(watch.value);                         // 附着时的值（null = 已退役）
watch.start(async (value, ops) => { /* 串行交付，永不重叠 */ });
await watch.stop();
```

- `watchDoc` 给「快照 + 精确 ops」，绑定的是一**个化身**；
- `documentState` 给 Chord 的 `ReplicatedState`（`value` + `subscribe`），适合把文档接到 Chord 的服务体系里；
- 退役时投递 `[["r", null]]`（根替换成 null）；**重建的化身不会被旧 watch/state 跟随**（第 2.2.6 节）。

### 2.17.5 100ms 提交窗口与「最多丢多少」

流式片段与工具输出**至多每 100ms 提交一次**（`src/harness/output.ts`）。因此：

- UI 看到的是「已提交的部分」，崩溃最多丢掉最后一个 100ms 窗口；
- 有界输出窗口（默认尾部 2000 行 / 50KB）超出时会落盘并在诊断里给出路径，避免「一次 `cat` 大文件把存储撑爆」；
- 观察者（watch）的背压是**帧数**策略（100 帧），不是字节数策略。

### 2.17.6 常见误解

| 误解 | 事实 |
|---|---|
| 「`viewState()` 是实时流」 | 它是「快照 + 订阅已完成提交的值」；要 ops 用 `watch()`，要事件用 `watchEvents()` |
| 「迟到的客户端需要重放历史」 | 不需要：快照就是当前状态；不重投已覆盖的 ops |
| 「`watchDoc` 会创建缺失的文档」 | 不会，返回 `undefined` |
| 「`stop()` 会中止正在执行的回调」 | 不会。它只是不再启动新回调；在途回调由调用方自己负责 |

---

## 2.18 Agent Events：高层事件流

### 2.18.1 什么时候用它

`watchEvents(harness, conversationId, context)` 给的是**coding-agent 风格的高层事件**，而不是结构状态。适合：对接「message_start / tool_execution_end」这类现成协议（例如 pi 的 `--mode json`）。

| 需求 | 用哪个 |
|---|---|
| 本地 TUI，自己渲染一切 | `viewState()` / `watch()` |
| 远端客户端，带宽敏感 | `watch()` 的 ops |
| 接现成的 agent 事件协议 | `watchEvents()` |

### 2.18.2 语义

- **从提交派生**：每笔提交一批事件，叠加在快照之上；
- **首帧是 `snapshot`**：迟到/重连的消费者从当前状态开始，不需要重放；
- **增量编码**：消息与工具更新带增量——文本/思考的追加、工具参数文本的追加、工具输出的裁剪与追加（形如 `{ append }` / `{ trimStart, append }` / `{ set }`）；
- **掉队保护**：消费者落后超过 100 批时，收到一个全新的 `snapshot` 事件；
- 事件族覆盖：消息（start/update/end）、工具执行（start/update/end）、turn 与 run 的边界、submission 状态、usage 变化、compaction 起止。

完整事件清单与字段级说明见第 4.6.2 节；示例 `19` 打印了一次真实 run 的全部事件。

### 2.18.3 示例：合并工具输出增量

```typescript
let output = stream.snapshot.tools[0]?.output ?? "";
stream.start(async (events) => {
	for (const event of events) {
		if (event.type !== "tool_execution_update") continue;
		const change = event.output;                 // { append } | { trimStart, append } | { set }
		if ("set" in change) output = change.set;
		else {
			const kept = change.trimStart === undefined ? output : output.slice(change.trimStart);
			output = change.append === undefined ? kept : kept + change.append;
		}
	}
});
```

这就是「有界窗口」在客户端侧的样子：窗口会裁剪头部，所以客户端必须按 `trimStart` 对本地缓冲做同样的裁剪，否则两边会漂移。

---

## 2.19 Task Graph：活任务图

### 2.19.1 一句话职责

`harness.taskGraph(context)` 把 Session 里**所有活任务**呈现为一个 Chord 状态（适合任务面板或调试）；`harness.watchTaskGraph(context)` 是它的 watch 版本（`src/harness/task-graph.ts`）。

```typescript
const graph = await harness.taskGraph(context);
graph.subscribe((value) => {
	for (const node of Object.values(value.tasks)) {
		const status = node.state.status === "waiting" ? `waiting on ${node.state.on.join(", ")}` : node.state.status;
		console.log(`${node.id} ${node.kind} ${status}`, node.owner ?? `conversation ${node.conversationId}`);
	}
});
```

### 2.19.2 节点字段与边界

- **owner 边**：`owner`（父任务 id），会话直属任务没有 owner；
- **status**：提交态（`pending` / `running` / `waiting` / `completing` / `terminal`）；
- **`background` 与 abort 标记**：能看到；
- **它拥有的会话**：能看到。

三条注意：

1. 任务**随创建它的提交出现、随置终态的提交消失**；
2. 重启后原 `running` 显示为 `pending`（`running` 是内存态）；
3. **图上看不到「缺代码」**：pending 任务是否因扩展未装而阻塞，要查 `harness.inspect()`；
4. 图只列活任务：subagent 的 owner 任务终态后，它会话里的新任务是**顶层节点**，父子关系经 `ConversationRecord.owner`（视图的 `conversation` 字段）维系。

---

## 2.20 Usage：用量与花费

### 2.20.1 数据在哪

每个会话把 token 与花费累计在 `docs["pi.usage"]`（`src/harness/usage.ts`）：

```text
UsageState = {
  models: { "<provider>/<modelId>": Usage }    // 模型响应
  tools:  { "<toolName>": Usage }              // 带 usage 的工具结果
}
```

- **失败与中止的尝试也计数**——这点很重要：不然「为什么账单比 UI 显示的贵」会成为常见困惑；
- 整个 Session 的汇总：`const usage = await harness.usage(context)`；
- 累计发生在**同一笔提交**里（响应落盘时、工具结果落盘时），所以不会出现「UI 显示了花费但崩溃后不见了」。

---

## 2.21 Testing：断言、运行器、一致性套件与基准

`@earendil-works/pi-durable/testing` 提供四类东西（`src/testing/*`，约 2,100 行）：

| 导出 | 作用 |
|---|---|
| `registerStorageConformance` | **存储一致性套件**：把存储契约拆成一组可执行断言，交给 Vitest/Jest 兼容的运行器 |
| 断言助手（`assertions.ts`） | 测试里常用的小工具 |
| 运行器适配（`runner.ts`） | 让套件能跑在 Vitest 或 Jest 上 |
| 基准（`storage-benchmark.ts`） | 存储后端的基准测量 |

自定义后端的接入方式（第 2.1.7 节给出了完整代码）。**为什么值得跑**：这套断言就是「存储契约」的可执行版本——原子性、ID 归属、游标分页、文档 base/delta、copy 的独立性、退役语义、错误分类。能过套件，基本就能上生产。

套件与基准的具体内容见第 4.9 与 6.4 节。

---

---


# 第 3 部分：内建任务与自写任务

第 2 部分讲的是「每个构件是什么」，这一部分讲「一次 run 在持久层到底发生了什么」：三个内建任务逐个 phase 精讲、控制流与边界、崩溃恢复速查表，最后一节是写自定义持久任务的完整教程。

## 3.1 三个内建任务总览

durable 的内建任务只有三个：`pi.generation` 推进一次 run，`pi.tool` 执行一个被模型调用的工具，`pi.compaction` 在上下文压力出现时把旧前缀换成一个摘要。

三者都是普通的 durable task（见 2.7 节）：

- 状态存在 TaskRecord 的 input / checkpoint 里；
- 每个 phase 必须用 `runtime.commit()` 提交「改变的 checkpoint」或「终态 outcome」，否则任务 fault；
- 任务可以通过 `ownership: { kind: "task", taskId }` 挂在另一个任务下面，于是 abort 与 idle 等待会沿着 owner 边传播；
- 崩溃后 Harness 重开、调度器重新保留任务时，从 checkpoint 记录的 phase 继续，不重放整个任务。

区别不在机制，而在职责、owner，以及「重开后能做什么」。

### 逐项对照

| 维度 | `pi.generation` | `pi.tool` | `pi.compaction` |
|---|---|---|---|
| kind / version | `pi.generation` / 1 | `pi.tool` / 1 | `pi.compaction` / 1 |
| 谁创建 | `admitSubmission()` 在 idle 输入落库时经 `startRun()` 创建；工具轮结束时由 generation 创建后继实例 | `pi.generation` 在开始工具轮时创建；串行轮里每启动下一个调用再创建一个 | `Conversation.compact()`（manual）、generation 的 `prepare`（阈值）、generation 的 `classify`（溢出） |
| owner | conversation-owned（顶层任务） | task-owned，owner 是那个 generation | 阻塞型：owner 是等待它的 generation；manual / background：conversation-owned |
| background 标记 | 否 | 否 | manual / 阈值后台为 `true`；阻塞型无所谓（它被 owner 持有） |
| input | `{}`；run 的输入在 `pi.live.run.inputs` | `{ assistant: EntryId; callId: string }` | `{ reason: "manual" \| "threshold" \| "overflow"; instructions?: string }` |
| 检查点 | `prepare` / `request` / `retry` / `poll` / `tools` | `call` / `execute` | `select` / `summarize` / `retry` |
| 是否拥有 `pi.live.run` | 是，唯一持有者；可用 `handOver()` 交给后继实例 | 否 | 否 |
| 写入的条目 | `pi.system`、`pi.assistant`；未提供的工具调用直接写 `pi.tool-result` | `pi.tool-result` | `pi.compaction`（直接写或经 write submission） |
| 终局 | `completed{ entryId }` / `failed(no_model \| model_error)` / `aborted` | `completed{ entryId, control? }` / `failed{ entryId }` / `aborted{ entryId }` | `completed{ entryId? \| submissionId? }` / `failed(model_error \| no_model)` / `aborted` |
| 延迟量级（定性） | 一次 provider 请求加流式消费；重试与 deferred 轮询可能把它拉到分钟级 | 由工具实现决定，可能瞬时也可能数分钟 | 与一次非流式 provider 请求同级 |
| 崩溃后可否重跑 | 每个 phase 都可从 checkpoint 重跑：`prepare` 重做准备工作，`request` / `poll` 重发同一请求，`tools` 阶段重新观察已完成的任务 | 只有「存储的与当前的 `replay` 都为 `safe`」才重跑；否则写 `interrupted` 结果 | `select` 可重跑（含 hook）；`summarize` 重发同一 pinned 请求；已放置的摘要不会重复 |

两点说明：

- 「延迟量级」是定性描述。仓库里的 `test/tool-output-bench.ts` 与 `test/storage.bench.ts` 测的是输出窗口与存储，不测这三个任务，因此本手册不给出它们的耗时数字。
- 「终局」列里的 `failed` 不是「工具业务失败」：工具返回 `isError: true` 仍然让任务 `completed`，只有执行抛错、运行环境构建失败、被中断才 `failed`（见 3.3 节）。

### 三者如何接力

一次 run 的主线只有一条：generation 发请求 → 模型要求调用工具 → 它为每个调用创建 `pi.tool` 子任务并等它们终态 → 自己进入下一轮请求。

```text
submission(input) ─place→ pi.user 条目 + pi.live.run{taskId: G1, inputs:[S]}
                                        │
   G1.prepare ─ 追加 pi.system（差量）─→ G1.request ─ 流式 ─→ 分类
        │                                                        │
        │                                   ┌──── toolUse ───────┤
        │                                   │                    │
        │                          pi.tool T1..Tn（owner=G1）     │ stop/length → answer → endRun
        │                          并行同时跑 / 串行逐个跑        │
        │                                   │                    │
        └────────── G1.tools 阶段等全部终态，然后：               │
              ├ terminate / handoff → final boundary → endRun(完成)┘
              └ 否则 postTools boundary → handOver → G2（run 不变）
```

几个容易被忽略的所有权事实：

- 工具任务**从不是** run 的持有者。`pi.live` 的 `RUN_TASK_KINDS` 只包含 `pi.generation`（`src/harness/live.ts:79-81`），工具只出现在 `pi.live.tools` 的槽位数组里。
- 同一个 run 会跨多个 generation 实例。每轮工具结束、boundary 决定继续时，`finishToolRound()` 创建一个**新的** generation 并把 `run.taskId` 改指它，输入列表不变（`src/harness/generation.ts:639-641`、`677-679`）。
- 因此「这次 run 有几个模型请求」与「这次 run 创建了几个 generation 任务」是同一个数字，而「这次 run 创建了几个工具任务」是它的另一维度。

### compaction 与 run 的三种关系

| 关系 | owner | generation 是否等待 | 摘要怎么落 | 谁能中止它 |
|---|---|---|---|---|
| 阻塞型（阈值 blocking / 溢出） | 那个 generation | 是（`allSettled`） | 直接 `appendEntry()`——此刻会话只有这一个写入者 | 随 generation 一起被 abort（先于 generation 的 abort handler） |
| 后台型（阈值 background） | conversation | 否 | write submission，等 boundary | 只有 `abortTask()` 或 `Conversation.abort(ctx, { background: true })` |
| 手动型（`Conversation.compact()`） | conversation | 否 | write submission，等 boundary | `Conversation.abort()`（它是 ordinary work） |

这张表解释了三个常见问题：

- 「为什么后台压缩不会让 `waitForIdle()` 挂住？」因为它是 background 任务，idle 等待与普通 abort 都跳过 background 子树。
- 「为什么阻塞压缩可以直接写条目？」因为 generation 正拿着 run 并 `waiting`，会话在它的保护下没有其他写入者，不存在竞争。
- 「为什么手动压缩会被 abort 掉，而后台压缩不会？」手动压缩是调用者主动发起的工作，按 ordinary work 处理；后台压缩是 harness 的自我维护，默认不随会话 abort 一起死。

### 一次 run 上各任务的时间线

```text
t0  admission:  pi.user + submission(placed) + G1 + pi.live.run{inputs:[S]}   （一个 commit）
t1  G1.prepare: pi.system（差量）+ checkpoint{request, cutoff}                （一个 commit）
t2  G1.request: pi.live.generation{attempt}；流式期间每 ≤100ms 写一次 partial
t3  G1 收到 toolUse: pi.assistant + T1..Tn（owner=G1）+ pi.live.tools[] + checkpoint{tools}（一个 commit）
t4  T* 各自: 意图（execute）→ 执行（进度节流写槽位）→ 结果条目 + 槽位 done（一个 commit）
t5  G1.tools: 串行轮逐个启动；pending 清空后读 outcomes、跑 afterTools
t6  G1 收尾: 应用 control（addTools/terminate/handoff）+ boundary + 端 run 或 handOver（一个 commit）
t7  G2.request → ...（重复 t2 起）→ answer：pi.assistant + boundary + endRun（inputs done）
```

每个箭头都是一条 commit 边界，也是「崩在这里会怎样」的分界线（完整清单见 3.6 节）。

### 条目写入者速查

| 条目 kind | 谁写 |
|---|---|
| `pi.user` | submissions（准入与 boundary 放置）、generation 的 `onYield` continuation |
| `pi.assistant` | generation（答案、失败尝试、转换的 partial） |
| `pi.system` | generation 的 `prepare` |
| `pi.tool-result` | `pi.tool`；generation 为「请求未提供」的调用直接写 `tool_unavailable` |
| `pi.reset` | `Conversation.reset()`；generation 消费 `control.handoff` 时 |
| `pi.compaction` | `pi.compaction`（阻塞型直接写，其他经 write submission） |

**设计取舍：为什么不是一个任务**

把「请求、工具执行、压缩」塞进同一个任务看起来更省事，但会毁掉三件事：

1. **checkpoint 的表达力**。checkpoint 必须能回答「现在停在哪一步、下一步做什么」。一个任务里塞三种不可回滚的动作，checkpoint 就得变成一个小型解释器；拆成三个任务后，每个 phase 的 checkpoint 都是「这份工作的当前进度」——`{ attempt, cutoff }`、`{ arguments, replay }`、`{ tail, firstKept }`。
2. **可恢复边界的粒度**。工具执行是不可回滚的，所以它需要一条自己的意图记录；模型请求是可重发的，所以它需要一份自己的 pinned 参数；压缩是可重选的，所以它需要一份自己的范围。三种恢复语义不同，混在一起就只能取最保守（也最慢）的那种。
3. **副作用隔离**。只有 `pi.tool` 会碰到外部世界。把外部操作单独关在一个任务里，也让「这个 run 现在是否安全」这句话有意义——只要没有 `running` 的工具槽位，模型上下文与 transcript 都是可推导的。

另外两个实际差异：

| 差异 | generation | tool | compaction |
|---|---|---|---|
| 生命周期与谁对齐 | 一个 run（跨多轮请求） | 一个 tool call | 一次压缩需求，可能比多次 run 都长（background） |
| 并发形态 | 自身串行（一次一个请求） | 一轮之内 N 个并发 | 可与 run 并行，多个可同时存在 |

**ownership 的传播**

ownership 边决定 abort 与 idle 等待能走多远：

| 关系 | 边的形式 | abort 时 | idle 等待时 |
|---|---|---|---|
| conversation → generation | conversation-owned | 标记并等待 | 计入 |
| generation → tool | `ownership: { kind: "task", taskId: G }` | generation 被标记时，工具任务在它终止前先跑完自己的 abort handler | generation 等它，因此也计入 |
| generation → blocking compaction | `ownership: { kind: "task", taskId: G }` | 随 generation 一起被标记（先于 generation 的 abort handler） | 计入 |
| conversation → background compaction | conversation-owned + `background: true` | 默认跳过；`{ background: true }` 时标记 | 不计入 |
| tool → 它创建的子任务 / 子会话 | `{ kind: "task", taskId: T }` | 工具任务 `failed` / `aborted` 时，owned 会话被中止（它们已无监督者） | 工具任务等它，因此也计入 |

这张表也解释了「为什么工具抛错要让任务 `failed`」：`failed` 是取消意图的持久表达，只有当任务不再监督它创建的会话时，这些会话才该被中止。

**三个任务与规范章节、参考手册小节的对应**

| 任务 | 规范 | 本手册的叙述讲解 | 参考手册（按源文件） |
|---|---|---|---|
| `pi.generation` | `docs/spec.md` §8.3 | 3.2 节 | 4.4.1 |
| `pi.tool` | `docs/spec.md` §8.4、§8.5 | 3.3 节、3.5 节 | 4.4.2 |
| `pi.compaction` | `docs/spec.md` §8.7 | 3.4 节 | 4.4.3 |
| 展示面（run / 工具槽位 / 压缩状态） | `docs/spec.md` §8.2 | 3.5 节 | 4.4.5 |
| 条目与账本 | `docs/spec.md` §8.1、§8.6 | 3.2 节（条目）、3.4 节（计费） | 4.4.6 |
| 提交与 boundary | `docs/spec.md` §6 | 3.5 节 | 4.4.4 |

分工原则：规范是契约（「必须这样」），本部分是故事与取舍（「为什么这样、崩了会怎样」），4.4 是逐文件参考（「导出什么、代码在哪一行」）。三者有冲突时以源码与测试为准，并在第 6 部分核对。

## 3.2 pi.generation：一个 run 的推进器

这一节按时间顺序走完一次 run。主角是 generation，每个阶段回答三个问题：**提交了什么**（durable 事实）、**崩在这里会怎样**（重开后发生什么）、**如何从检查点继续**。

### 起点：submission placed 与 run 的诞生

`Conversation.submit()` 在 idle 且 inbox 为空时走快路径，一个 commit 里做四件事：

1. 追加 `pi.user` 条目（内容与时间戳在此刻定稿）；
2. 创建状态为 `placed` 的 submission 记录；
3. 创建 conversation-owned 的 `pi.generation`（`initial()` 给出 `{ phase: "prepare", attempt: 1 }`）；
4. 写 `pi.live.run = { taskId, inputs: [id] }`（`src/harness/submissions.ts:201-206`）。

从这一刻起会话是 busy，而 `run` 是 busy 的唯一定义。提交记录的 `placed` 表示「已进 transcript，等一个 run 来回答」，不是「已送达模型」。

**崩溃点**：这个 commit 是原子的。重开后要么四件事都不存在（submission 也没被创建），要么都在。此后任何崩溃都不会改变 `run.inputs` 的语义——它是「必须被结清」的清单，直到某个 generation 把它 settle 成 `done` 或 `unanswered`。

**如何继续**：`run.inputs` 是纯数据，调度器只要重新保留那个 generation 就能从 checkpoint 继续。

### prepare：请求前的所有决定

`prepare` 是唯一会「重新做决定」的 phase：重试会回到它，阻塞压缩结束后也会回到它。它做五件事。

**第一件：解析 agent 与 settings，固定本次请求的模型。**

- `runtime.agent()` 在每个 phase 内首次使用时解析一次并固定（见 2.13 节）；
- `runtime.settings` 每次访问都重新解析，但这里把它存进局部变量，因此这次请求的 stream options 是此刻的快照；
- agent 没配模型，或 `models.getModel(provider, modelId)` 不认识它 → `failNoModel()`：把 run 的 inputs settle 成 `unanswered/no_model`，任务 `failed`；
- 模型未知时连一条条目都不会写——此时 transcript 里只有 `pi.user`。

**第二件：把「这次要说什么」变成持久事实。**

- 派生当前上下文（见 2.6 节），重放 `pi.system` 链得到「现在生效的 section 文本」；
- 按 agent 的 section 顺序渲染（`renderSections()`）；返回 `undefined` 的 section 省略，其余按 `<key>…</key>` 包裹；
- 用 `planSystemEntries()` 规划差量：正常情况只写变化的值、需要删的写 `null`；只在「存在 head marker 且它之后没有 `pi.system` 条目」时才写一条完整 baseline 并 `omit` 掉范围内的旧系统条目；
- 工具清单以声明差量的形式跟在最后一条 section 条目上；
- section 渲染抛错不会让请求失败：保留旧文本并 `runtime.report()`，只有 invocation 已被 signal 时才向上抛。

**第三件：估算压力，必要时先压缩。**

```text
tokens = estimateContext(view, planned system messages)
         // 基准：head 之后、usage 非零的最新 assistant 的 calculateContextTokens()
         // 加上：其后每条上下文消息 + 计划中的 system 消息的 estimateMessageTokens()
blocking    = contextWindow - reserveTokens
background  = blocking - backgroundTokens
over        = tokens > blocking ? "blocking"
            : (backgroundTokens > 0 && tokens > background) ? "background"
            : undefined
if (over === undefined || selectCut(view, keepRecentTokens) === undefined) → 不压缩
```

- blocking 时：单独提交一次，创建 owner 为自己的 compaction（reason `threshold`）并 `waiting`，checkpoint 回到 `{ prepare, attempt, compacted }`；
- 这次提交里**没有** `pi.system`——transcript 直到压缩落地前不变，所以 `prepare` 稍后会从头重做；
- 重做时 `compacted` 已存在，阈值判定被跳过，于是不会为同一件事再压一次。

**第四件：提交请求参数。**

一个 commit 里：

1. 追加 planned `pi.system` 条目，`cutoff` 随之推进到最新条目；
2. 若阈值是 `"background"` 且 `pi.live.compactions` 仍为空，创建 conversation-owned、`background: true` 的 compaction（generation 不等它）；
3. 写 checkpoint `{ phase: "request", attempt, compacted?, model, thinkingLevel, streamOptions, cutoff }`。

`cutoff` 是「本次请求包含到的最新条目」，也是重发请求时的边界；`streamOptions`、model、thinking level 随之固定，后续的 `request` / `retry` / `poll` 都用它们。

**崩溃点**：

| 崩在 | 重开后 | 结果 |
|---|---|---|
| 渲染或估算期间（未提交） | checkpoint 仍是 `{ prepare, attempt: 1 }`，`prepare` 整体重跑 | 只写一份 `pi.system`（`test/harness-generation-recovery.test.ts:41-72`） |
| blocking 分支提交之后 | checkpoint 带 `compacted`，先检查压缩结果 | 压缩产出摘要 → 正常发请求；否则按阈值型规则照发 |
| 正常提交之后 | 从 `request` 继续 | 不再触发阈值判定（一次 generation 只压一次） |

### request：把请求变成一条流

`request` 的第一笔提交先处理上次的残局，再准备请求。

**残局：** 如果 `pi.live.generation.message` 里还有一条已提交的 partial（上次崩在流式过程中），`convertPartial()` 把它做成 `stopReason: "aborted"` 的 `pi.assistant` 条目——模型产出过的内容因此留在 transcript 与 usage 里；随后写 `live.generation = { attempt }`，清掉旧 partial。

**请求准备的四要素：**

| 要素 | 来源 | 恢复/重试时的行为 |
|---|---|---|
| 消息 | `runtime.context(conversationId, ctx, cutoff)` | 按 checkpoint 的 `cutoff` 重新派生；`aborted` / `error` / `deferred` 的 assistant 会被排除 |
| hook 机会 | `beforeRequest` 链 | 每次请求都重新跑；替换只对本请求有效，不改持久状态 |
| provider 身份 | `ensureProviderSessionId()` 读 `pi.provider` 的 sessionId | 正常路径只读；legacy 会话缺文档时用一个迁移 commit 写入 `uuidv7`；fork 的 `pi.provider` 是 `fork: "initial"`，各自独立 |
| 选项 | pinned 的 streamOptions + invocation 的 AbortSignal + （thinking level 非 `off` 时的）`reasoning` | 完全来自 checkpoint，重开后的设置变化不影响这次尝试 |

**流式消费**由 `streamResponse()` 完成，节流策略是「≤100 ms 一次、最多一个提交在飞」：

```text
for await (event of models.streamSimple(model, { messages }, options)) {
  if (event.type === "done" || event.type === "error") continue       // 终态事件不产生 partial
  if (event.partial.content.length === 0) continue                    // 开场 start 事件没有内容
  pending = event.partial                                             // 只留最新一份
  if (timer === undefined && inFlight === undefined) schedule(flush, 100)
}
flush():
  copyJson(pending)                       // 同步拷贝：provider 会继续改写同一个对象
  commit { live.generation ??= { attempt }; assignJson(..., "message", message) }
  finally: if (pending !== undefined && !stopped) schedule(flush, 100)
finally: stopped = true; clearTimeout; await inFlight                  // 分类前不再有旧 partial 落地
```

`assignJson` 逐叶写 `message`，因此 Chord 记录的是文本叶片的 append，而不是整条消息的 set；这条规则在 `test/harness-live-deltas.test.ts:259-277` 里被逐 op 断言。

**崩溃点有三档**（`test/harness-generation-recovery.test.ts:74-162`）：

1. 崩在请求发出前 → checkpoint 是 `{ request, ... }`、`pi.live.generation` 只有 `{ attempt }`；重开后**直接重发**，且用 pinned 的 streamOptions（测试把重开后的 `timeoutMs` 从 1234 改成 999，重发仍用 1234）。
2. 崩在流式过程中、partial 已提交 → `generation.message` 保留已提交的那段文本；重开后先把它转成 aborted 条目，再用同一批消息重发。模型因此看到「自己上次被打断的半截回答」，但那条消息的 stop reason 是 `aborted`，不会进入之后的请求。
3. 崩在终态消息已收到、分类提交之前 → 什么都没提交（既没有 assistant 条目也没有新 checkpoint），重开后重发；provider 侧可能多一次调用，durable 状态不会重复。

### 分类：一笔提交决定下一步

终态消息到手后，`classify()` 按固定顺序判断，顺序本身就是语义：

| # | 条件 | 提交 | 下一状态 | 恢复行为 |
|---|---|---|---|---|
| 1 | invocation 已被 signal / Harness 关闭 | 无 | 交给 abort 处理器 | abort 标记是持久的，重开后运行 abort handler |
| 2 | `stopReason === "deferred"` 且有 handle | `generation = { attempt, deferred: { pollAt } }` | `poll` | `pollAt` 是时钟绝对时刻，到点继续轮询 |
| 3 | （先跑 `afterResponse` 链） | 无 | — | 观察者可能重复触发一次（重发时） |
| 4 | `toolUse` 且有 tool call | assistant 条目 + 工具任务 + 槽位 + `{ tools }`（一个 commit） | `tools`（`waiting`） | 从工具轮继续 |
| 5 | `stop` / `length` / 没有 call 的 `toolUse` | 答案条目 + boundary + 结束或交接（一个 commit） | 终态 `completed` | 要么这次 run 已结束，要么完全没结束 |
| 6 | `error` + `isContextOverflow()` + 未 `compacted` + 策略启用 + 有切点 | 错误条目 + 移除 generation + 创建阻塞 compaction（reason `overflow`）+ `{ prepare, compacted, overflow }` | `prepare`（重跑） | attempt 不变，不花重试预算 |
| 7 | `error` + 可重试 + 策略允许（`attempt <= maxRetries`） | 错误条目 + `generation.retry = { at, error }` + `{ retry, until }` | `retry` | 时钟到 `until` 后回 `prepare` |
| 8 | 其余（不可重试错误、第二次溢出、溢出但压缩不可用、无 mark 的 aborted） | 错误条目 + `endRun(unanswered/model_error)` | `failed` | 失败终局不碰 inbox |

关于第 6 行的两个细节：

- durable 调 `isContextOverflow(message)` 时只传一个参数，所以只匹配错误文本类溢出；`stop` 型的「静默溢出」不在这里判定，交给下一次阈值检查。
- `checkpoint.overflow` 保存的是当初的错误文本——恢复时没有别的办法还原那句话；这也是溢出型 generation 在压缩没产出摘要时能「用原错误失败」的依据。

### 分支：retry、poll 与溢出

**retry** 是最短的 phase：`sleep(until)` 后把 attempt 加一、回到 `prepare`。

- 回 `prepare` 而不是重发请求，是为了让退避期间的修改生效：换模型、换 thinking level、换 stream options、换策略都会作用于下一次尝试；
- 这与恢复（resend）形成明确分工：**重试是新尝试，恢复是同一尝试的续命**；
- 退避时长由 pi-ai 的 `retryDelayMs()` 计算：`baseDelayMs * 2^(attempt-1)`，上限默认 60 s；
- 崩溃后 checkpoint 是 `{ retry, attempt, until }`，`pi.live.generation.retry` 里还留着 `{ at, error }` 供迟到的观察者看到（`test/harness-generation-recovery.test.ts:164-199`）。

**poll** 只在 provider 支持 deferred continuation 时出现：

- sleep 到 `pollAt` 后调 `models.fetchDeferred()`；
- 仍是 deferred 就继续往后排，且 `pollAt` 严格前进（`max(now + pollAfterMs, 上次 pollAt + 1)`）；
- 否则按与 `request` 相同的规则分类；
- abort 时尝试 `models.cancelDeferred()`，失败只上报；
- 崩溃后 checkpoint 是 `{ poll, handle, pollAt }`，到点后继续（`test/harness-generation-recovery.test.ts:201-228`）。

**溢出路径**是唯一会「凭空多出一段等待」的分支：

1. 错误 assistant 条目先落盘（带 usage，因此计费不丢）；
2. generation 阻塞在压缩上（`pi.live.compactions` 里出现 `blocking: true` 的状态）；
3. 压缩结束后 generation 重跑 `prepare`，再发同一次请求（attempt 不变）；
4. 若压缩没产出摘要（无切点、decline、失败、被直接 abort、fault），溢出型 generation 用 `checkpoint.overflow` 里的文本以 `model_error` 失败。

### 工具轮：建子任务、等它们、再收尾

**第一步：开始一轮（一个 commit）。**

`startToolRound()` 在一个 commit 里：

1. 用 pi-ai `getCurrentTools()` 从提交态消息 replay 出「本次请求提供过哪些工具」（`request` 阶段已持有上下文，`poll` 阶段重新派生）；
2. 调用名不在其中 → 直接写 `tool_unavailable` 结果，槽位起始即 `done`，不建任务；
3. 判定轮的模式：`toolExecution === "sequential"`，或任一「被提供且被调用」的工具声明 `executionMode: "sequential"`；读一次，整轮固定；
4. 为其余每个调用创建 `pi.tool` 任务（input `{ assistant, callId }`，owner 是本 generation）；串行轮里只有「已创建至少一个任务之后」的调用进入 `pending`；
5. 追加 tool-calling 答案条目、删 `live.generation`、写 `live.tools` 槽位数组、checkpoint 转 `{ phase: "tools", assistant, tools, pending }` 并 `waiting`（`allSettled`）。

关键性质：**不存在「assistant 已落盘但工具任务还没建」的状态**。四样东西在同一笔提交里，要么全有要么全无。

**第二步：`tools` 阶段循环。**

```text
tools_phase(checkpoint):
  if (pending.length > 0) {
    callId = pending.shift()
    commit { createTask(ToolTask, { assistant, callId }, owner=this) ; slot.taskId = id ; shrink pending }
    return waiting(on: [newTask], allSettled)
  }
  finishToolRound()          // 所有任务终态：读 outcomes、跑 afterTools、应用控制与 boundary
```

**第三步：收尾（一个 commit）。**

1. `runtime.outcomes(tools)` 取每个子任务的终态；`control` 只从 `completed` 的结果里取；
2. 从 `pi.live.tools` 的槽位读结果条目（fault 的槽位没有 entry，自然缺席），跑 `afterTools`；
3. 汇总控制：`addTools` 合并；`terminate` 要求**每个**槽位都有 `taskId` 且都要求终止；`handoff` 取最后一个；
4. 应用：`terminate` / `handoff` → final 行为；否则 `postTools`，选中 reset 则 run `unanswered/reset`，否则 steer 加入 `run.inputs` 并交接后继 generation；
5. 任务的 result 是 `{ entryId: assistant }`。

**崩溃点**：崩在开始轮之后、收尾之前，checkpoint 是 `{ tools, ... }`，恢复时重新观察已完成的任务，不会重复启动已建的任务；崩在收尾 commit 之前，`afterTools` 会再执行一次（`test/harness-tools-recovery.test.ts:252-287` 观察到 hook 调用两次，但工具只执行一次）。

### 下一轮：新 generation 接力

`postTools` 之后，run 的 `taskId` 被改指新 generation，输入列表保持原样。新 generation 的 `prepare` 会看到：

- 上下文里多了工具结果；
- 可能多了 steer 消息（它们被追加进 `run.inputs`，会与初始输入一起被结清）；
- `pi.agent` 可能被 `control.addTools` 改过，于是差量 `pi.system` 会写出新的工具声明。

这就是「一次 run 多轮模型调用」的实现方式：不是循环，而是不断交接给新的任务实例，每一段都有完整的崩溃恢复边界和独立的 checkpoint 语义。

### final：答案与 submission 结算

`stop` / `length` / 无 call 的 `toolUse` 走 final 路径：

1. `onYield` 链先跑，取第一个 `{ continue }`；
2. 一个 commit：
   - 追加答案条目；
   - `prepareBoundary()` 读队列模式（在 Session 线上）；
   - `applyBoundary(..., "final")`；
   - 若 continuation 存在**且** boundary 没有选中 user 项、也没有 reset：追加一条 `pi.user`、创建后继 generation、`handOver`、`delete live.generation`——run 与 inputs 保持打开；
   - 否则 `endRun(done, answer)`；若选中了 user 项就 `startRun()` 起新一轮。

**崩溃点**：final 的所有效果在一笔提交里。重开后要么这次 run 已经结束（输入 `done`、`run` 删除、后继 run 已存在），要么完全没结束。不存在「答案写了但 submission 没 settle」的状态——`tx.settleSubmission()` 是暂存操作，与条目写入在同一事务里解析并生效。

### 阶段速查

| 阶段 | 提交 | 崩在这里，重开后 | 模型看到什么 |
|---|---|---|---|
| 准备（渲染/差量/阈值判定） | `pi.system` + `{ request, cutoff }` | 若未提交则整段重跑；若已提交则直接重发 | 一份完整的当前提示 + 工具声明 |
| 请求（流式） | `generation.attempt`、节流 partial | 无 partial：重发；有 partial：partial → aborted 条目 + 重发 | 上次被中断的半截回答（stop reason `aborted`，不进后续请求） |
| 分类 | assistant 条目 + 新 checkpoint/outcome（一个 commit） | 分类整体重做（provider 可能多调用一次） | 取决于分类结果 |
| 工具轮 | assistant + 工具任务 + 槽位 + `{ tools }` | 各工具按自己的规则恢复 | 每个 call 的工具结果（或合成的缺失结果） |
| 收尾 | `addTools` + boundary + run 交接/结束 | `afterTools` 重跑，其余重做一次 | 下一轮请求或最终答案 |
| 终局 | 答案 + boundary + inputs settle | 要么全部生效要么完全没有 | 最终答案 + 排队项按 boundary 落地 |

**差量 `pi.system` 的三种形态**

`prepare` 每次都要让「重放出的系统提示」与「agent 现在想说的话」一致，而 transcript 只能追加。于是它把差异表达成三种形态之一（`src/harness/prompt.ts:66-142`）：

```text
1. baseline（重写）
   条件：存在 head marker，且它之后没有 pi.system 条目
   产物：一条完整条目：所有 section 的当前值 + 所有工具的声明；
        并带 edits：omit 掉范围内每一条旧 pi.system
   触发场景：压缩摘要之后、reset 之后——活动范围被 head 切过，旧差量链的起点可能已经不在范围里

2. 最小 patch
   条件：重放结果与期望的「顺序」一致
   产物：只写变化的值、需要删除的 null、以及新增的 key；无变化 → 一条都不写
   触发场景：绝大多数请求

3. 顺序重写
   条件：按最小 patch 得到的新顺序与期望顺序不同（例如把一个曾删除的 section 加回原位）
   产物：两条：先把所有旧 key 置 null，再整体写入期望值
   触发场景：section 顺序变化、或「重新添加一个位于中间的 key」

工具声明的增减总是搭在「最后一条 section 条目」上；如果这一轮只有工具变化，就单独写一条。
若一次 prepare 里 section 与工具都没有变化，planSystemEntries 返回空数组——请求照发，cutoff 停在当前最新条目。
```

**一次 run 的完整示意时间线（两个工具轮）**

下面这段是结构示意（来自代码与测试断言的行为组合，不是某次运行的原样日志）：

```text
S1 placed → G1
  G1.prepare   : pi.system（baseline 或 patch）+ { request, cutoff: 最新条目 }
  G1.request   : 模型回答 toolUse(c1, c2)
  G1 开始轮    : pi.assistant(c1,c2) + T1 + T2 + live.tools[2] + { tools, pending: [] }
  T1/T2 并行   : 意图 → 执行 → 结果条目 + 槽位 done（各自一笔提交）
  G1.tools     : pending 空 → 收尾
  G1 收尾      : 无 control；postTools 选中一条 steer
                 → run.inputs.push(steer)；live.tools 删除；handOver → G2
  G2.prepare   : pi.system（可能只有工具差量）+ { request }
  G2.request   : 模型回答 toolUse(c3)
  G2 开始轮    : pi.assistant(c3) + T3 + live.tools[1] + { tools: [T3], pending: [] }
  T3           : 结果条目
  G2 收尾      : 无 control；postTools 无选中项 → 再交接给 G3
  G3.request   : 模型给出最终答案 stop
  G3.final     : pi.assistant(答案) + final boundary（选中一条 followUp）
                 → endRun(done, answer)；startRun([followUp]) → G4
  G4.request   : 回答 followUp → answer → endRun
```

注意两处容易误解的地方：

- 每个「回答」都是一次独立请求；run 的长度是「模型调用次数」，不是「用户消息条数」。
- steer 在 G1 的 `postTools` 进上下文，但它会与 S1 一起被 G1 结清；如果 G2 失败，steer 也变成 `unanswered`。

**onYield 的边界**

| 场景 | 结果 |
|---|---|
| 第一个 hook 返回 `{ continue }`，boundary 未选中 user 项、无 reset | continuation 生效：追加 `pi.user`、交出新 generation、run 与 inputs 保持打开 |
| 已有别的 hook 给出 continuation | 第一个胜出，后续被忽略 |
| boundary 选中了 followUp | continuation 被丢弃（不重试）；followUp 起新 run |
| boundary 选中了 reset | 同上 |
| 排队的是一条 plain write | 不阻止 continuation（write 不触发 run，也不与 continuation 冲突） |
| hook 抛错 | 上报并继续后续 handler（invocation 被 signal 时向上抛） |

continuation 期间这次 run 的输入一直是 `placed`：它最终由后继 generation 的**最终答案**结清。因此 `onYield` 适合做「同一问句下的多步自我延续」（例如让模型先规划再执行），而不是「再问一个新问题」——后者用 followUp 更直白。

**重做 / 重发 / 重试：三个容易混淆的概念**

| 概念 | 触发 | 重新解析 agent/settings | 请求怎么来 | attempt 变化 | 典型场景 |
|---|---|---|---|---|---|
| 重做（rerun phase） | `prepare` 崩溃、阻塞压缩结束、`retry` 到点 | 是 | 重新走阈值判定与差量规划，得到新的 `cutoff` | 有时（`retry` 会 +1） | 崩溃恢复、退避结束 |
| 重发（resend） | `request` / `poll` 崩溃且 checkpoint 已在 | 否 | 按 checkpoint 的 `cutoff` 重新派生消息，用 pinned 选项 | 不变 | 请求已定稿但中断 |
| 重试（retry phase） | 分类判定为可重试错误 | 是（因为回到 `prepare`） | 下一次尝试 | +1 | 503、超时、限流 |

三者的共同点是都会产生「同一个 run 的又一次模型调用」；区别在于「这次调用还是不是原来的那次」——只有重发是，重试与重做都是新尝试。

**一次请求的失败清单**

| 失败 | 判定依据 | run 的结局 | inbox |
|---|---|---|---|
| `no_model` | 没配模型 / `getModel` 不认识 | inputs `unanswered/no_model` | 不动 |
| `model_error`（不可重试） | 错误文本不被接受为可重试 | inputs `unanswered/model_error` + detail | 不动 |
| `model_error`（重试耗尽） | `attempt > maxRetries` | 同上 | 不动 |
| `model_error`（第二次溢出） | `compacted` 已存在或无切点 | 同上 | 不动 |
| 溢出 → 压缩 → 压缩失败 | 压缩没有 `entryId` | inputs `unanswered/model_error`（detail = 原溢出文本） | 不动 |
| 可重试错误 | `isRetryableAssistantError` | 继续（`retry`） | 不动 |
| deferred | provider 明确返回 | 继续（`poll`） | 不动 |
| abort / close | invocation signal | inputs `unanswered/aborted` | 不动（conversation abort 另行撤回 input） |
| fault / orphan | 任务机器判定 | inputs `unanswered/faulted` / `orphaned` | 不动 |

**`cutoff` 为什么可以当作「这次请求的快照」**

`prepare` 提交时把 `cutoff` 定在「追加完 planned `pi.system` 之后的最新条目」，`request` 与 `poll` 都用它派生消息。这个边界之所以可信，靠的是两条不变量：

1. **busy 会话只有 run 的持有者会写 transcript**：工具任务写结果、压缩写摘要、submission 写用户消息——它们都发生在 generation `waiting` 的时候（工具轮、阻塞压缩、boundary 放置），而 generation 自己发请求时正是它在跑的时候，没有别的写入者。
2. **head 只在没有请求在飞时被放置**：压缩摘要与 reset 都通过 boundary 或阻塞等待的空档落地；一次请求的流式期间不会出现新的 head。

由此得到两个可观察的事实：

- 同一次请求的重发（恢复）拿到的消息与首次完全相同——除非 `beforeRequest` hook 改了消息，因为 hook 每次都会重新运行；
- 一个正在流式输出的请求看不到「中途落地的摘要」；它对模型上下文的改变只在下一次 `prepare` 生效，而那时 `cutoff` 会被重新计算。

**`prepare` 的读与写顺序**

`prepare` 里所有「读」都发生在那一笔提交之前（上下文派生、section 渲染、工具声明比较、阈值估算），提交里只做写：追加差量 `pi.system`、可能创建后台压缩、写 checkpoint。这个顺序不是风格问题，而是约束：事务里表读必须全部先于第一次表写（boundary 的准备也是同一个道理，见 4.4.4），否则存储会拒绝。

## 3.3 pi.tool：意图先于执行

工具是唯一会碰到外部世界（文件、网络、进程）的内建任务，所以它的持久化设计围绕一个问题展开：**执行不可回滚，那么该在什么时候把「将要执行什么」写下来？**

答案是：在真正执行之前、参数定稿之后，写一条 checkpoint。

这条 checkpoint 让「执行」这个动作本身可以被审计，也让恢复时能区分三件事：还没开始（可以安全重做）、可能做了一半（需要风险提示）、已经做完（结果在盘上）。

### 三明治的第一片：意图提交的确切内容

`call` 阶段在解析、修复、校验、`beforeTool` 之后，用**一个 commit** 完成三件事（`src/harness/tool.ts:85-90`）：

| 写入 | 内容 | 为什么在这里 |
|---|---|---|
| checkpoint | `{ phase: "execute", arguments: <最终参数>, replay: tool.replay ?? "unsafe" }` | 让「将要执行什么」成为持久事实，恢复时不用再解析模型参数 |
| `pi.live.tools` 槽位 | `status = "running"` | 让外部观察者知道「这个调用已经开始动真格」 |
| （无） | 没有条目写入 | 结果要等执行完才有 |

意图里的 `arguments` 是**校验并被迫类型之后**的参数，不是模型原样发出的 JSON。两个后果：

- 恢复重跑时用的是定稿参数，不会因为 schema 校验器换版本而变成别的值；
- `beforeTool` 的改写只发生一次——崩在意图之前时 hook 会再跑一次，崩在意图之后则不会（`test/harness-tools-recovery.test.ts:213-251` 明确断言）。

意图被写下的前提是前四步都成功：

1. `readCall()`：从 `assistant` 条目里找到 `id === callId` 的 tool call；找不到直接抛错（程序性 bug 的守卫，任务 fault）；
2. 在当前 phase 的 agent 里按名字解析工具；解析不到 → `tool_unavailable` 结果，任务 `completed`；
3. `prepareArguments()` 修复模型常犯的参数错误（抛错 → `invalid_arguments`）；
4. `validateToolArguments()` 按 schema 校验并强制类型（抛错 → `invalid_arguments`）。

然后 `beforeTool` 链有一次改写机会（见下），改写后的参数要**再次校验**：校验失败的调用仍然不写意图、不执行。

**崩溃点**：崩在意图提交之前，checkpoint 还是 `{ phase: "call" }`，什么都没执行过；重开后 `call` 整体重做——工具解析、参数修复、`beforeTool`、两次校验都会再跑一遍，然后照常执行一次。崩在意图提交之后，就有了「可能已执行」的不确定性，交给 replay 规则裁决。

### beforeTool：唯一的执行前干预点

| 返回值 | 效果 | 后续 |
|---|---|---|
| `{ block: "理由" }` | 第一个 `block` 胜出，后续 handler 被跳过 | 写 `blocked` 结果（`Tool call blocked: 理由`），任务 `completed`，不写意图、不执行 |
| `{ arguments: {...} }` | 覆盖当前参数 | **重新校验**；通过后再写意图 |
| 抛错（invocation 未 abort） | 错误文本当作 block 理由 | 同上 |
| 抛错（invocation 已 abort） | 向上传播 | 由 abort 处理器结算 |
| `undefined` | 无操作 | 下一个 handler 继续 |

一个设计后果：`beforeTool` 既能做策略（拒绝危险调用），也能做参数改写，但**不能**做「执行一次的副作用」——它在崩溃重跑时会被再次调用。

### 三明治的第二片：执行

执行阶段由 `run()` 完成，它对工具暴露一个 `ToolExecutionApi`（`src/harness/types.ts:166-195`）：

| API | 作用 | 落盘路径 |
|---|---|---|
| `output(chunk)` | 追加运行输出 | `OutputBuffer` → 节流写槽位 |
| `diagnostic(diag)` | 记一条给模型看的备注 | 追加进槽位 diagnostics |
| `details(value, ctx)` | 覆盖结构化细节 | `assignJson` 逐叶写槽位 |
| `commit(change, ctx)` | 自定义持久化 | 包一层 runtime.commit |
| `createTask` / `getTask` / `waitForTask` / `conversation` | 子任务与子会话 | 直接转发 runtime；子任务 owner 是本工具任务 |
| `memo` | 幂等/缓存 | 任务级 memo，终态时退休 |

所有操作在结果结算后失效——再调用会抛 `Tool call <id> has settled`。这是防止工具在收尾之后继续写状态的硬门闩。

**环境是每次调用构建的**：`runtime.env(context)` 在 `execute()` 之前调用，所以「工具看到的 cwd / 文件系统」是调用那一刻的会话配置。恢复重跑（safe）时会重新构建一次，于是环境变化会体现在重跑里；反过来，如果工具在重开后不再被选择，解析不到实现，就等价于 `unsafe`，不会重跑（`test/harness-tools-recovery.test.ts:165-212`）。

**执行期间的两个节流管道：**

| 管道 | 保留策略 | 落盘节流 |
|---|---|---|
| 运行输出 | `OutputBuffer` 按 `outputLimits` 保留窗口（默认 2000 行 / 50 KiB，`retain: "head"`），并统计丢弃的行数与字节数 | 由 `Progress` 控制：空闲后第一次变化立刻提交，此后至少 100 ms 间隔，并按写入字节数以 100 KiB/s 追加延迟；同时最多一个提交在飞 |
| 细节与诊断 | `details` 逐叶 diff；diagnostics 只追加新增项 | 同一个节流提交里一起写 |

**抛出与 `isError` 的区别：**

- 工具返回 `isError: true` → 仍写结果、仍 `completed`；它的副作用被视为「业务上失败」，不触发取消；
- `execute()` 抛错，或 `runtime.env()` 抛错 → 写 `tool_error` 结果 + 任务 `failed`；`failed` 记录取消意图，该调用拥有的会话会被中止（它们已经没有监督者）；
- invocation 已被 signal（abort）时抛错 → 不写结果，向上传播，由 abort 处理器用槽位的持久输出写 `aborted` 结果。

**崩溃点**：崩在执行中，checkpoint 是 `{ execute, arguments, replay }`，槽位里可能已有若干次节流提交（运行输出、details、diagnostics）。abort 或关闭走同一条路：只保留**已提交**的部分，缓冲区里没提交的丢弃（`test/harness-tools.test.ts:1059` 断言「只保留 durable output」）。

### afterTool：执行后的唯一改写点

`afterTool` 链在结果条目之前运行，每个 handler 可以整体替换结果对象（`final = hook(...) ?? final`）。替换后的字段全部生效：

| 字段 | 来源优先级 |
|---|---|
| `content` | 工具显式返回的 content；否则运行输出窗口的文本（空窗口 → 空数组） |
| `details` | 工具显式返回的 details；否则最后一次 `details()` 报告的值 |
| `diagnostics` | `api.diagnostic()` 记录的 → 工具返回的 → Harness 的截断诊断 |
| `usage` | 工具返回的（替换后生效），记进 `pi.usage.tools` |
| `control` | 工具返回的，由 generation 在轮收尾消费 |

因此工具可以「先产出原始结果，再让扩展把它裁成模型该看到的样子」，也可以用 `afterTool` 给结果补 usage（例如工具内部调用了一次模型）。

### 三明治的第三片：结果与下一检查点同笔提交

`settle()` 在一笔提交里写三样东西：

1. `pi.tool-result` 条目；
2. 槽位 `done`（并清掉 output / dropped* / details / diagnostics）；
3. 任务的终态 outcome。

结果条目的形状与诊断：

- `model` 是一条 `ToolResultMessage`：`toolCallId`、`toolName`、`content`、可选 `details`、可选 `usage`、`isError`、`timestamp`；
- content 末尾追加渲染后的诊断块 `<harness>\n[severity] message\n</harness>`，因此「模型看到的」与「存储里查得到的」一致；
- `data` 保留结构化诊断列表（没有诊断时也是空数组）；
- 截断诊断分两层：运行输出窗口的丢弃量（仅当 `afterTool` 保留了那段 content 时）与显式 content 的边界丢弃量（最后追加）。

终态有四种组合，区别在「任务怎么算结束」与「调用拥有的会话怎么处理」：

| 情况 | 结果条目 | 任务终态 | 该调用拥有的会话 | run |
|---|---|---|---|---|
| 正常返回 | 有 | `completed{ entryId, control? }` | 继续被监督 | 正常继续 |
| `isError: true`（业务失败） | 有 | `completed{ entryId }` | 继续被监督 | 正常继续 |
| `execute()` / 建环境抛错 | 有（`tool_error`） | `failed{ entryId }` | 取消 | 继续（结果条目在） |
| 被 abort / 中断（execute 阶段） | 有（`aborted` / `interrupted`） | `aborted{ entryId }` / `failed{ entryId }` | `failed` 时取消 | 继续 |

**崩溃点**：结果与终态同笔提交，重开后只有「完全没结算」或「完全结算」两种状态。已经结算的任务不会因为恢复再写一条结果；没有结算的任务才进入 `execute` 的 replay 判定。

### replay 判定表

`execute` 是恢复专用 phase。它的判定只看两个字符串：checkpoint 里存下来的 `replay`，与「重开后按当时的 agent 重新解析这个工具」得到的 `replay`。

| 存储的 replay | 当前解析出的 replay | 重开后行为 | 结果条目 | 副作用 |
|---|---|---|---|---|
| `safe` | `safe` | 清掉上次 attempt 的进度，用存储参数重跑（不跑 `beforeTool`） | 新执行的真实结果 | 可能重复执行——声明 `safe` 就是承诺「重跑无害」 |
| `safe` | `unsafe` | 不重跑 | `interrupted` | 不重复；不可逆的那一半已发生 |
| `unsafe` | `safe` | 不重跑 | `interrupted` | 不重复 |
| `unsafe` | `unsafe` | 不重跑 | `interrupted` | 不重复 |
| 任意 | 工具不再解析（被取消选择 / 实现没了） | 不重跑 | `interrupted` | 不重复 |

`interrupted` 结果的正文是槽位里已提交的输出、details 与 diagnostics，末尾追加 `Tool <name> was interrupted and may have partially run`。这句话是给模型看的风险提示，不是给人看的日志。

清理规则：safe 重跑前会先 commit 一次 `clearProgress`，把上次 attempt 发布的运行进度清掉，避免新旧输出在同一窗口里拼在一起（`test/harness-tools-recovery.test.ts:366-405`）。

### 控制流：谁能改变下一轮

工具不直接改控制流，它返回 `control` 对象，由 generation 在轮收尾时消费（`src/harness/generation.ts:611-620`）：

| control | 语义 | 生效位置 | 细节 |
|---|---|---|---|
| `control.addTools: string[]` | 追加工具名 | 轮收尾 commit 里改写 `pi.agent` | `tools` 未设置表示「全部工具已提供」，此时不写；数组追加缺失名；`{remove}` 时从移除名单里撤销这些名字 |
| `control.terminate: true` | 要求整轮结束后 run 就此完结 | 轮收尾 commit 决定是否走 final | 需要**每个**槽位都有 `taskId` 且都要求终止；`tool_unavailable` 的调用没有任务，会让整轮无法 terminate |
| `control.handoff: string` | 用一段文本开新上下文 | 轮收尾 commit 追加 `pi.reset`（`head: "self"`，文本作为 user 消息） | 多个 handoff 时调用顺序里最后一个胜出；活动范围起点指向 reset |

结果对象里的 control 会去掉 `undefined` 键（保持 strict JSON）；如果工具返回非 JSON 值导致结果提交失败，任务会 fault，而 run 仍能继续——上下文派生会为缺失的结果合成一条 `Tool result unavailable: history ends before this call completed.`（`test/harness-tools-recovery.test.ts:310-336`）。

### 一轮里的多个工具调用：串行与并行

轮的模式在**轮开始时**读一次并固定：

```text
sequential = settings.toolExecution === "sequential"
          || calls.some(call => offered.has(call.name)
                        && tools.find(t => t.name === call.name)?.executionMode === "sequential")
```

- 并行：所有调用立刻得到任务，同时执行。结果条目按完成顺序追加，但上下文派生会按 assistant 消息里的调用顺序重排工具结果，所以模型看到的一定是「call 1、result 1、call 2、result 2……」。
- 串行：只有第一个（实际创建了任务的）调用立刻得到任务，其余留在 `pending`；每完成一个，generation 在 `tools` 阶段启动下一个。好处是下一个工具能看到前一个的效果，代价是整轮耗时是各工具之和。
- 未提供的调用在两种模式下都一样：立即得到 `tool_unavailable` 结果、没有任务，不阻塞后面的调用。

| 对比项 | 并行 | 串行 |
|---|---|---|
| 槽位初始状态 | 全部 `pending` 且带 `taskId` | 第一个 `pending` 带 `taskId`，其余 `pending` 无 `taskId` |
| `pi.live.tools` 的 `taskId` 回填 | 一次完成 | 每启动一个回填一次 |
| 结果顺序 | 完成顺序 | 调用顺序 |
| `terminate` 的通过条件 | 全部 control 都 terminate 且都有 taskId | 同左 |
| 失败影响 | 一个失败不阻止其他工具完成 | 一个失败不阻止后续工具启动（`allSettled`） |

**参数修复与校验的分工**

`prepareArguments()` 与 `validateToolArguments()` 解决的是两个不同的问题：

| 步骤 | 目标 | 输入 | 失败结果 |
|---|---|---|---|
| `prepareArguments` | 修复模型常犯的表示错误（把数组写成 JSON 字符串、把数字写成 `"7"`） | 模型原样的参数 | `invalid_arguments`（修复抛错） |
| 第一次 `validate` | 按 `parameters` schema 校验并强制类型 | 修复后的参数 | `invalid_arguments`（pi-ai 的错误文本） |
| `beforeTool` | 策略与改写 | 校验后的参数 | `blocked`（block 或抛错） |
| 第二次 `validate` | 校验 hook 改写后的参数 | hook 返回的参数 | `invalid_arguments` |

`prepareArguments` 必须是纯函数、不得改动入参；它会在「意图提交前的重跑」里再执行一次，所以带状态的修复会让第二次结果不同。存储的 call 参数永远是模型原样发出的值（`test/harness-tools.test.ts:410-443` 断言存储的 arguments 仍是 `{ text: 7 }`，而工具收到的是修复后的 `{ text: "#7" }`）。

**诊断 code 速查**

| code | severity | 谁写 | 触发 |
|---|---|---|---|
| `tool_unavailable` | error | generation（未提供的调用）或工具任务（解析不到实现） | 名称不在本次请求提供的清单里 |
| `invalid_arguments` | error | 工具任务 | 修复抛错或 schema 校验失败 |
| `blocked` | error | 工具任务 | `beforeTool` 返回 block 或抛错 |
| `tool_error` | error | 工具任务 | `execute()` 或建环境抛错 |
| `interrupted` | error | 工具任务（`execute` 恢复） | 中断后不可安全重跑 |
| `aborted` | error | 工具任务 / generation | abort 结算 |
| `truncated` | **warn** | 工具任务 | 输出窗口或显式 content 超出限制 |

诊断最终会被渲染进结果条目的 content 末尾（`<harness>` 块），并保留结构化列表在条目的 `data` 里。`truncated` 是唯一非 error 的诊断，因为截断不代表调用失败。

**输出边界细节**

| `outputLimits` 字段 | 默认 | 语义 |
|---|---|---|
| `maxBytes` | 50 KiB | 保留窗口的字节上限 |
| `maxLines` | 2000 | 保留窗口的行数上限 |
| `retain` | `head` | 保留开头；`tail` 保留结尾（滑动的尾部窗口） |

两种保留模式的落盘形状不同，这也是 `pi.live` 的 delta 规则要处理的：

- `head`：窗口填满后不再存新内容，只更新 `droppedBytes` / `droppedLines`；
- `tail`：通常表现成「前剪 + append」；当 Chord 的有界重叠搜索找不到共享部分（例如高度重复的输出、或窗口超过 64 KiB 扫描范围）时，整窗写成一次 set。

计数是精确的：`OutputBuffer` 记录整个流的字节数与行数，快照时减去保留部分，因此诊断里的「dropped」是真实丢弃量而不是估算。单行超长时按字节上限切在字符边界上，不会产生半个 UTF-8 字符。

**实现被替换时的语义**

- `call` 阶段解析到的工具实现会在这一次执行里用到底；如果执行中途注册表被替换，这次调用仍由原实现完成（`test/harness-tools.test.ts:931-961`）；
- `execute`（恢复）阶段会**重新**解析：这正是「工具被取消选择 → 视为 unsafe」的机制来源；
- 因此「改一个工具的 replay 策略」在恢复时会立刻生效：存储的与当前的策略必须同时为 `safe` 才重跑。

**`api.memo` 的用途**

`api.memo(name, candidate)` 提供「除非已有值否则写入」的幂等原语，值随任务终态退休。典型用法是把「一次昂贵且需要确定性的准备动作」（例如解析一个远端资源、算一个稳定 ID）放进 memo，然后在崩溃重跑时复用已有的结果，避免重复计算或重复请求。它不能用来记录「已经执行过副作用」——那是 replay 策略与意图 checkpoint 的职责。

**一次并行轮的提交顺序**

两个工具并行时，`pi.live` 上的写入序列是可预测的（`test/harness-live-deltas.test.ts:100-162` 逐 op 断言）：

```text
1. 轮开始 commit : [ pi.assistant 条目 + T1 + T2 + live.tools = [slot1, slot2] + { tools } ]
2. T1 意图 commit: [ tools[0].status = "running" ]
3. T2 意图 commit: [ tools[1].status = "running" ]        // 顺序取决于调度，不保证 T1 先
4. 运行期若干次   : [ tools[i].output / details / diagnostics 的字段级 op ]
5. T* 结果 commit: [ tools[i].status = "done", tools[i].entry = <结果条目>，
                    并删除 output/details/diagnostics/dropped* ]
6. 收尾 commit   : [ 删除 tools；可能改 run.taskId 或 run.inputs ]
```

两个细节：

- 结果顺序按完成先后，不按调用顺序；重排发生在**上下文派生**时（见 2.6 节），而不是写入时；
- 槽位的进度字段在结算时被清空，内容搬进结果条目——「运行输出」是临时的，「结果」才是持久的。

**afterTool 的三种典型用法**

| 用途 | 做什么 | 注意 |
|---|---|---|
| 裁剪 | 把工具的超长输出替换成摘要或摘录 | 只有保留运行输出那段 content 时才自动带截断诊断；自己替换后要自己补诊断 |
| 补 usage | 工具内部调用了模型，把这次调用的 usage 补进结果 | 账本记的是**替换后**的 usage |
| 脱敏 | 去掉结果里的密钥、路径、内部 ID | 结果条目一旦写入就是历史；脱敏必须在写入前完成 |

**崩溃点**：串行轮崩在两个工具之间时，checkpoint 是 `{ tools, assistant, tools: [...], pending: [...] }`，已完成的任务终态在盘上，重开后从 `pending` 的第一个继续启动——不跳过，也不重复启动已建的任务。

## 3.4 pi.compaction：压缩

压缩的目标不是省空间，而是让下一次请求仍然放得下。它把模型上下文里一段旧前缀换成一个摘要条目，原始条目全部留着（transcript 不删任何东西），只是 `head` 让模型从那之后开始看。

这一节讲三个常量的关系、三个触发路径、摘要怎么生成与放置，以及并发压缩之间靠什么排序。

### 三个常量决定什么时候压、压掉多少

| 常量（默认值） | 作用 | 相关代码 |
|---|---|---|
| `reserveTokens`（16384） | 给答案留的空间：请求估算超过 `contextWindow - reserveTokens` 就触发 blocking 压缩；同时是摘要输出上限的来源 | `src/harness/generation.ts:153-156`、`src/harness/compaction.ts:139-142` |
| `backgroundTokens`（32768） | 提前量：估算超过 `contextWindow - reserveTokens - backgroundTokens` 时启动后台压缩；设为 0 关闭后台压缩 | `src/harness/generation.ts:318-321` |
| `keepRecentTokens`（20000） | 摘要保留的最近上下文规模：从尾往前累加，达到这个量就找切点；它同时决定「有没有可压缩内容」 | `src/harness/compaction.ts:255-273` |

前两个是**触发线**，第三个是**切点线**。

```text
contextWindow 200000, reserveTokens 16384, backgroundTokens 32768:
  blocking 线   = 183616   （超过就阻塞压缩）
  background 线 = 150848   （超过就顺手起一个后台压缩，不等它）
contextWindow 32000, reserveTokens 16384:
  blocking 线   = 15616 < keepRecentTokens 20000
  → 上下文还没长到足够切时就已经越过 blocking 线，
    阈值压缩找不到切点，溢出可能先发生（规范 §8.7 描述了这种窗口）
```

摘要输出上限的公式是 `min(floor(0.8 * reserveTokens), model.maxTokens > 0 ? model.maxTokens : +∞)`：既不超过模型自己的输出上限，也保证摘要不会把为答案预留的空间吃掉太多。

### 三种触发与它们的差别

**1. 阻塞阈值（blocking）。**

- 触发点：`prepare` 发现估算超过 blocking 线且能找到切点；
- 行为：单独提交一次，创建 owner 为自己的 compaction（reason `threshold`）并 `waiting` 它；
- 结束：generation 重跑 `prepare`——不管压缩有没有产出摘要，它都会发这次请求（已经等过一次，不会为同一件事再等）；
- 若没产出摘要，请求可能再次溢出，而那时 `compacted` 已存在，溢出路径不会再压缩，只能失败。

**2. 后台阈值（background）。**

- 触发点：估算落在 blocking 线以下、background 线以上；
- 行为：在转 `request` 的同一个 commit 里创建 conversation-owned、`background: true` 的 compaction，然后照常请求；
- 特点：不延迟这次 run；摘要稍后通过 write submission 进 transcript；
- 去重：同一 commit 里若 `pi.live.compactions` 已经非空（例如手动压缩正在跑），就不再创建第二个——「一次一个」的判定就在那里。

**3. 溢出（overflow）。**

- 触发点：模型明确报上下文溢出（`stopReason === "error"` 且错误文本被 `isContextOverflow()` 认出）；
- 前置条件：这次 generation 还没压缩过、策略启用、范围选择有切点；
- 行为：错误 assistant 条目先落盘、generation 移除、创建阻塞型 compaction（reason `overflow`）、checkpoint 回 `prepare` 并带上溢出文本；
- 恢复请求 attempt 不变，因此不花重试预算；
- 失败收场：压缩失败/无摘要/被直接 abort 时，generation 用 `checkpoint.overflow` 里的文本以 `model_error` 失败。

**4. 手动（manual）** 是第四条入口，不属于阈值驱动：`Conversation.compact()` 创建它，它是会话的 ordinary work——`waitForIdle()` 会等它，`Conversation.abort()` 会中止它，而 background 压缩两者都跳过。

| 对比项 | 阻塞阈值 | 后台阈值 | 溢出 | 手动 |
|---|---|---|---|---|
| 触发者 | generation | generation | generation | 应用调用 |
| reason | `threshold` | `threshold` | `overflow` | `manual` |
| owner | generation | conversation | generation | conversation |
| background 标记 | 否 | **是** | 否 | 否 |
| generation 等待 | 是 | 否 | 是 | 否 |
| 消耗重试预算 | 否（attempt 不变） | 否 | 否 | — |
| 摘要落地方式 | 直接 append | write submission | 直接 append | write submission |
| 失败时 generation | 照发请求 | 不受影响 | `model_error`（带原溢出文本） | 不受影响 |

### 范围选择：keepRecentTokens 怎么变成切点

范围选择是纯函数，只要 `ContextView` 与 `keepRecentTokens` 相同，结果永远相同。规则（`src/harness/compaction.ts:255-295`）：

1. 候选 = 贡献第一条消息是 user 或 assistant 的非 marker 条目；
2. tool result 与 `pi.system` 永不是候选——保留下来的 assistant 一定连着自己的工具结果；
3. 紧跟在同一个 assistant 的结果之前的 user 条目（例如工具轮之间插入的 steer）也不能当切点，否则切掉它会留下「调用在，结果不在」的错位；
4. 从尾往前累加每条贡献的 `estimateMessageTokens()`；
5. 达到 `keepRecentTokens` 后，取「在或晚于该下标的第一个候选」，没有就取最新候选；
6. 若切点之前没有任何条目贡献模型消息，视为没有可压缩内容。

规范里的例子（`docs/spec.md` §8.7）：

```text
1 user   2 assistant（调用 read）   3 tool result，30k tokens   4 assistant   5 user   6 assistant
keepRecentTokens = 20k：
  从 6 往前走，到 3 时累计达到 20k
  3 是 tool result，不是候选 → 取在它之后的第一个候选 = 4
  摘要覆盖 1–3；模型上下文变成 [summary, 4, 5, 6]
```

### 摘要生成：一个被钉住的请求

`select` 阶段一次性决定并写进 checkpoint：

| 字段 | 值 | 作用 |
|---|---|---|
| `attempt` | 1 | 重试用 |
| `model` / `thinkingLevel` | 取自 agent | 摘要用与主对话同级的模型 |
| `streamOptions` | 取自 settings | 但 `deferred` 会被去掉、`cacheRetention` 强制 `"none"` |
| `maxTokens` | `min(floor(0.8 * reserveTokens), model.maxTokens)` | 限制摘要长度 |
| `tail` | 选择范围时的最新条目 | 让重发时能精确回到同一范围（`tail` 之前不可变） |
| `firstKept` | 切点条目 | 摘要条目的 `head` |

请求本身只有两条消息：内置的摘要系统提示，与一条 user 消息——`<conversation>` 包裹的序列化文本 + 内置的结构化摘要提示；带 `instructions` 时追加 `Additional focus: …`。

序列化规则（纯文本，防止摘要器「接着聊」）：

```text
[User]: ...
[Assistant thinking]: ...
[Assistant]: ...
[Assistant tool calls]: read(path="a.ts", limit=10)
[Tool result]: ...（超过 2000 字符截断，并标注截断了多少）
```

`pi.system` 消息被省略；thinking 也被保留，因为它是上下文的一部分。

摘要成功的判定很严格：必须 `stopReason === "stop"`、没有 tool call、拼接文本非空。任何其他情况都算失败，错误文本会区分 `length`、调用了工具、没有文本、不可重试错误四种原因。

### 放置：谁等它，决定怎么落

摘要条目的形状固定：

```ts
{
  kind: "pi.compaction",
  head: firstKept,
  model: [{ role: "user", content: [{ type: "text", text: 前缀 + 摘要 + 后缀 }], timestamp: now }],
  data: { reason },
}
```

前缀是「The conversation history before this point was compacted into the following summary: … <summary>」，后缀是 `</summary>`——模型因此知道这不是用户新说的话，而是一段被压缩的历史。

| owner | 放置路径 | 完成时的 result | 何时真正进 transcript |
|---|---|---|---|
| generation（阻塞型） | 直接 `appendEntry()` | `{ entryId }` | 立刻（此时没有其他写入者） |
| conversation（manual / background） | `admitSubmission()` 写一条 `requestId = compaction:<taskId>` 的 write submission | `{ submissionId }` | idle + 空 inbox 立刻；busy 或 inbox 非空时等 boundary |

`requestId` 保证同一个摘要不会被重复准入；任务在准入完成时就 `completed`，**不等**放置——要知道摘要是否真的进了 transcript，得订阅那个 submission（`test/harness-compaction.test.ts:1687-1703` 断言排队摘要跨 reopen 后仍会在下一个 boundary 落地）。

放置完成后，下一次 `prepare` 会发现「head 之后没有 `pi.system` 条目」，于是写一条完整 baseline 重建系统提示（见 4.5 节）。

### stale 与并发压缩

摘要条目是 head write，于是 head 规则自动接管：boundary 拒绝「目标早于当前活动范围起点」的 head write。两个并发压缩因此不需要互相协调：

```text
背景压缩 B 在 tail=100 时选择切点 70，开始摘要。
同时阻塞压缩 A 选择切点 150，先完成并追加（活动范围起点变成 150）。
B 完成后放置摘要 → 70 < 150 → stale，settle 为 unanswered/stale（不写条目）。

若 A 的切点更早（60）：
B 的切点 70 ≥ 60 → B 正常放置。
因为 B 的摘要基于「当时的上下文」，它覆盖 A 摘要之后的所有内容，信息不重复也不缺失。
```

这个推理成立的前提是「唯一会移动 head 的是压缩摘要与 reset」。应用层如果在压缩期间放了一条作用在被切掉区间上的 edit，那条 edit 会随区间一起从模型上下文消失——这是规范里已知的取舍，不是 bug（`test/harness-compaction.test.ts:1780-1811` 记录了这一点）。

### beforeCompact：不花模型钱的压缩

`beforeCompact` 在范围选择之后、摘要之前运行，看到「将被替换的条目」与「摘要来源的消息」，可以做两类决定：

| 返回 | 效果 |
|---|---|
| `{ decline: true }` | 这次不压：任务 `completed({})`，调用方照常继续 |
| `{ summary: "..." }` | 使用这个摘要：任务在同一笔提交里放置它，不调用模型 |
| `undefined` | 无操作，继续下一个 handler |
| 抛错 | 上报并跳过，后续 hook 照常运行 |

**第一个决定胜出**（`src/harness/compaction.ts:129-131`）。这给应用层留了一个口子：可以用更便宜的规则（例如按条目数量）自己合成摘要，或者在临近阈值时选择「这次不压，让模型自己撞一次溢出」。

### 压缩失败与重试

| 情况 | 判定 | 终局 |
|---|---|---|
| 可重试错误 | `isRetryableAssistantError()` 通过且策略允许 | `retry`：退避后重发同一 pinned 请求，attempt+1 |
| `length` | 摘要被截断，不完整 | `model_error` |
| 带 tool call | 摘要器违反指令 | `model_error` |
| 无文本 | 空摘要没有意义 | `model_error` |
| 不可重试错误 | — | `model_error` |
| 被 abort / 崩溃打断（没有提交响应） | — | 不计费；abort 时移除状态并 `aborted` |

计费规则：**每次拿到响应都记一次 usage**（成功、失败、`length` 都算），被 abort 或崩溃打断而没有提交响应的尝试不计——`test/harness-compaction.test.ts:1623-1645` 断言重发后只多出一次回答的用量。

**崩溃点**：

| 崩在 | 重开后 |
|---|---|
| `select` 中（含 `beforeCompact`） | `select` 重跑，hook 再调用一次 |
| 无切点/decline 之后 | 没有 checkpoint 变化，任务已完成或即将重跑 |
| `summarize` 中（请求已发出或响应已到、分类提交前） | 重发同一请求；摘要文本可能不同（模型不确定），但只会放置一次 |
| `retry` 中 | 时钟到 `until` 后重发同一请求 |
| 摘要已放置 | 什么都不重复：条目、usage、任务列表都和关闭前一致 |
| 摘要已排队 | 队列留在 `pi.inbox`，下一个 boundary 或 idle 准入时放置；过期则 `stale` |

**摘要提示的结构化格式**

内置提示要求摘要器输出固定小标题，并显式禁止它继续对话（系统提示里写着「Do NOT continue the conversation / Do NOT respond to any questions」）。六个小节与各自的用途：

| 小节 | 要求摘要器写什么 |
|---|---|
| `## Goal` | 用户想达成什么；一个会话覆盖多个任务时可以有多条 |
| `## Constraints & Preferences` | 用户提过的约束与偏好；没有就写 `(none)` |
| `## Progress` | Done（`[x]`）/ In Progress（`[ ]`）/ Blocked 三块 |
| `## Key Decisions` | 做过的关键决定与理由 |
| `## Next Steps` | 有序的下一步 |
| `## Critical Context` | 继续工作所需的资料、示例、引用；没有就写 `(none)` |

提示还要求「保持各节简短、保留精确的文件路径、函数名与错误信息」，并说明「如果对话开头已经有一段更早的摘要，就保留它的信息，把新消息折叠进去」。后半句是压缩可以**连续发生**的关键：第二次压缩会把上一段摘要当作普通 user 文本重新摘要，而不是丢弃它（`test/harness-compaction.test.ts:1999` 断言「第二次压缩会摘要上一次的摘要」）。

**两种估算器的差别**

压缩相关有两处 token 估算，它们服务不同目的：

| 估算 | 用在哪 | 算法 | 为什么这样 |
|---|---|---|---|
| `estimateContext(view, extra)` | generation 的阈值判定 | 找到 head 之后、usage 非零的最新 assistant，用它的 `calculateContextTokens()` 作基准，加上其后每条消息与计划中的 system 消息的估算 | 阈值要的是「这次请求大概多大」，用真实 usage 锚定最接近真实值 |
| `selectCut()` 里的累加 | 切点选择 | 纯 `estimateMessageTokens()` 逐条累加 | 切点要的是「保留最近多少内容」，只要相对量级；真实 usage 会把「最近一次请求的输入」误当成「最近的对话内容」 |

两者的差异意味着：阈值判定可能说「已经 90% 满」，而切点判定认为「最近的内容只有 10k」——这时压缩会切掉很老的一小段，把省下来的空间留给下一次请求。这类不一致不是 bug，而是两个问题本来就不同。

**两个排队摘要落进同一个 boundary**

boundary 按 ID 顺序放置 writes，每放一个 head write 就推进一次活动范围起点。于是两个排队摘要的命运是确定的：

```text
摘要 A 先放（切点 150）→ 活动范围起点变成 150
摘要 B（切点 70）随后 → 70 < 150 → stale，settle unanswered/stale
摘要 B（切点 160）同样随后 → 160 ≥ 150 → 正常放置（它基于更新的上下文）
```

规范里的排序理由是：B 的摘要基于「选择时的上下文」，如果它的切点不早于 A，它覆盖的内容就包含 A 覆盖的内容，因此两者叠加不会丢信息。这也是为什么 durable 不需要在压缩之间做互斥——顺序由已放置的 head 自然决定。

**`instructions` 的用途**

`Conversation.compact(instructions)` 可以把一段聚焦要求带进摘要请求：它会以 `Additional focus: <instructions>` 追加在提示末尾，只影响摘要内容，不出现在最终摘要条目的包裹文本里。适合的场景是「这次压缩特别关注文件改动」或「保留所有错误信息」这类一次性要求；要长期生效的规则应该写进 `beforeCompact` hook。

**切点与 `keepRecentTokens` 的取舍**

`keepRecentTokens` 决定「模型还能逐字看到多少最近的历史」。它太小 → 摘要覆盖的内容多，模型丢掉细节（尤其是工具输出的原文）；它太大 → 压缩省不下多少空间，阈值可能反复触发。默认 20000 与默认 `reserveTokens` 16384 是同一量级，意味着一次压缩大约省出「为答案预留的空间」那么多。真正要调的时候先看两件事：模型窗口有多大、以及工具输出里有多少是「必须逐字保留」的（若是，考虑让工具用 `details` 承载结构化信息，或让它自己把输出压到 `keepRecentTokens` 以内）。

**压缩之后，模型看到的是什么**

一次成功的压缩把模型上下文从「全部历史」变成：

```text
[ 摘要条目（head = firstKept） ]
[ firstKept 及其后的全部条目（逐字保留） ]
[ 新的 pi.system baseline（下一次 prepare 写入） ]
```

三件事同时发生变化：

| 变化 | 谁负责 |
|---|---|
| 模型不再逐字看到切点之前的历史 | `head` 的作用（见 2.6 节） |
| 原始 transcript 一条不少，应用还能查到 | entries 从不删除 |
| 系统提示被重建成 baseline | 下一次 `prepare` 命中「head 之后没有 `pi.system`」分支（见 4.5 节） |

因此「压缩后模型忘掉了什么」这个问题的准确答案是：它忘掉的是**切点之前的原始文本**，而摘要里保留的是「目标、约束、进度、决定、下一步、关键上下文」这六类信息。工具的原始输出在摘要里只剩截断到 2000 字符的片段——这也是为什么关键结论最好让模型写进回答或文件，而不是留在工具输出里。

**摘要条目的读者**

| 字段 | 读者 | 用途 |
|---|---|---|
| `head` | 上下文派生 | 决定活动范围起点 |
| `model`（包裹后的 user 消息） | 模型 | 作为「被压缩的历史」进入后续请求 |
| `data.reason` | 应用与观察者 | 区分这次压缩是 manual / threshold / overflow |
| 任务 checkpoint 的 `tail` / `firstKept` | 恢复 | 重发摘要请求时定位同一切点 |
| `pi.usage.models` 里对应的键 | 计费 | 摘要尝试的消耗 |

注意 `pi.compaction` 条目**没有**携带摘要任务 ID 之类的内部标识：它与普通 head write 走同一套 stale 规则，因此一个手工构造的、切点合理的 `pi.compaction` 条目在语义上不可分辨——扩展如果需要严格的溯源，应该用 `byTaskId`（条目记录里自带）而不是 `data`。

## 3.5 工具轮、run 的边界与控制

3.2 节讲的是「run 怎么向前走」，这一节讲「run 在哪些点上停下来，谁有权决定它停不停」。全部机制都挂在两个概念上：

- `pi.live.run`：busy 的定义，以及「谁负责结清这次 run 的输入」；
- boundary：`postTools` 与 `final` 两个切面，以及它们各自的选取规则。

### busy 的定义与所有权

| 状态 | `pi.live.run` | 会话 busy？ | 谁能结束它 |
|---|---|---|---|
| idle | 不存在 | 否 | — |
| 普通 run（generation 在 prepare/request/poll/retry） | `{ taskId: G, inputs }` | 是 | G 自己（answer / 失败 / abort） |
| 工具轮进行中 | `{ taskId: G, inputs }`（G 在 `tools` 阶段 `waiting`） | 是 | G 收尾时或它的 abort handler |
| 阻塞压缩进行中 | `{ taskId: G, inputs }`（G `waiting` 在压缩上） | 是 | G 与压缩两个任务，各自终态后 G 继续 |
| 后台压缩进行中 | 可能不存在（若会话空闲） | 不一定 | 压缩自己 |
| 交接瞬间（`postTools` → 后继 generation） | `{ taskId: G2, inputs }` | 是 | G2 |

由此推出几条容易记错的规则：

- 工具任务从不写 `run`：它们只出现在 `pi.live.tools` 的槽位里；
- 压缩任务也不写 `run`：阻塞型只是被 generation 等待；
- 「busy」与「有没有压缩在跑」是两个独立问题；
- 失败、abort、fault、orphan 都会删除 `run`（连同 `generation` 与 `tools` 的展示面），并把 inputs settle 成对应的 `unanswered`。

### 三种提交进入 transcript 的时机

| 提交类型 | 准入 | 进入 transcript 的时机 | 是否触发新一轮 run |
|---|---|---|---|
| `input`（默认当 followUp） | idle + inbox 空 → 立刻 `placed`；否则排队 | 立刻，或 boundary 的 `final` | 立刻落库时起一轮；排队时由选中它的 final boundary 起一轮 |
| `input` + `whenBusy: "steer"` | 同上；busy 且 `whenBusy: "reject"` 时抛 `ConversationBusy`（不写记录） | `postTools`（普通轮）或 `final` | steer 不自己起一轮：加入当前 run 的 inputs；若不在 run 中，就在下一个 boundary 被选中 |
| `write`（被动条目） | idle + inbox 空 → 立刻 `done`；否则排队；写没有 `whenBusy` | 立刻，或 boundary（writes 先于 users） | 永不触发 run——即使它带 `head` |

`requestId` 在准入前按会话去重：同一个 ID 重复提交拿到同一个 submission，不产生第二个 inbox item；跨类型复用同一个 ID 直接抛错。

三个真实轨迹（都来自测试断言）：

```text
忙碌会话里连续提交 f1（followUp）、write（note）、f2（followUp），随后 answer 完成：
  pi.user:a → pi.assistant:first → note → pi.user:f1 → pi.assistant:second → pi.user:f2 → pi.assistant:third
  即：write 先落，然后每个 run 只取一条 followUp（默认 one-at-a-time）

工具轮运行中提交 steer 与 followUp：
  pi.user:a → pi.assistant（工具轮）→ pi.tool-result → pi.user:s → pi.assistant:after tools
            → pi.user:f → pi.assistant:follow-up
  即：steer 在 postTools 进上下文，followUp 留到 final

工具轮运行中提交 followUp 并 reset：
  pi.user:a → pi.assistant → pi.tool-result → pi.reset → pi.user:f → pi.assistant:fresh
  并且 followUp 的请求只包含 user:f（reset 之后的新上下文）
```

### boundary 选择表

两个切面用同一套规则挑选，差别只在 followUp：

| boundary | write | steer | followUp | 典型触发 |
|---|---|---|---|---|
| `postTools` | 全部 | 按 `steeringMode`（`one-at-a-time` 取第一条 / `all` 全部） | 不取 | 普通工具轮收尾（run 继续） |
| `final` | 全部 | 同上 | 按 `followUpMode` | 答案解析、`terminate`、`handoff`；`postTools` 选中 reset 时升级为 final |

选择是确定性的：

1. 先按模式过滤（`one-at-a-time` 只取第一条，`all` 取全部）；
2. steer 与 followUp 混排后按 item ID 排序；
3. 放置时 **writes 先于 users**，各自保持 ID 顺序；
4. 被选中与被判 `stale` 的项按**位置**从列表移除，其余项相对顺序不变——不可以用 ID 代替位置语义。

一个 write 若 `head` 目标早于当前活动范围起点就是 `stale`：settle 成 `unanswered/stale`，不写条目。`head: "self"` 永不 stale；没有 head marker 时也永不 stale。

### 「steer 不是打断」

durable 没有任何机制能中途把用户消息塞进正在跑的模型请求。steer 的现实语义是：

- 它进 `pi.inbox`，在某个 boundary 被选中；
- 选中后追加成 `pi.user` 条目，并把 ID 加入当前 `run.inputs`；
- 于是它和初始输入一起被同一个 generation 结清（如果那个 generation 失败，steer 也随之 `unanswered`）。

所以 steer 的延迟是「当前工具轮 + 当前请求的剩余时间」，而不是「立刻」。想立刻改变方向，只能用 `Conversation.abort()` 或外部中断，然后重新提交。

### reset 与 handoff：把上下文切断

`reset` 是 `head: "self"` 的 write：它让活动范围从这条条目重新开始，模型之后看不到更早的历史。它有三种进入方式：

| 进入方式 | 行为 |
|---|---|
| `Conversation.reset(handoff?, ctx)` | admission 时 idle 就立刻放置（带文本时 `pi.reset` 的 model 里是一条 user 消息）；busy 就排队等下个 boundary |
| 工具 `control.handoff` | generation 在收尾 commit 里直接追加 `pi.reset` 并把 `boundary.head` 指向它，然后按 final 处理 |
| 应用直接 submit `{ kind: "pi.reset", head: "self" }` 的 write | 与 reset() 等价，只是没有便捷方法 |

`postTools` 遇到排队的 reset 时会「升级」为 final：上下文已经被切断，当前 run 无法再给出与旧上下文匹配的答案，所以 run 以 `unanswered/reset` 结束，随后被选中的 user 项起新一轮。

`final` 上放的 reset 正好相反：答案已经写完，inputs 已经是 `done`，reset 只是给下一次输入换一个起点。

### abort：三种调用，三种范围

| 调用 | 撤回排队 input | 打标记的范围 | background 子树 | 等待 |
|---|---|---|---|---|
| `Submission.abort()` | 只撤这一条 `queued` | — | — | 不等；对 `placed` 报 `already_placed`，对终态报 `settled` |
| `Conversation.abort(ctx)` | 撤本会话排队 input（write 保留） | 本会话 + 它的非 background 任务拥有的会话 | 跳过 | 等到这些任务终态、会话空闲 |
| `Conversation.abort(ctx, { background: true })` | 撤每个到达会话的排队 input | 跨过 background 边界，标记所有能到达的活任务 | 一并标记 | 同上；之后新建的 background 工作不再被标记或等待 |

abort 标记是持久事实：携带标记的任务不会再启动新 phase，而是运行它的 abort handler（见 2.8 节）。各自的 abort 补偿：

| 任务 | abort handler 做什么 |
|---|---|
| `pi.generation` | poll 阶段尝试 `cancelDeferred()`（失败只上报）；为仍 `pending` 的调用写 `aborted` 结果；把已提交 partial 转成 aborted 条目；`endRun(unanswered/aborted)` |
| `pi.tool` | 用槽位里的持久输出、details、diagnostics 写 `aborted` 结果并结算槽位；缓冲区里未提交的输出丢弃 |
| `pi.compaction` | 移除 `pi.live.compactions` 状态、`aborted`，不写任何条目 |

### waitForIdle 的判定

| 等待 | 范围 | 是否包含 background |
|---|---|---|
| `Conversation.waitForIdle()` | 本会话及被它的任务拥有的会话 | 不含 |
| `Harness.waitForIdle()` | 每个 ownerless 会话的同一范围 | 不含 |
| `harness.inspect()` | 只读快照：任务与未结提交，不产生等待 | — |

因此：

- 一次普通 run（generation + 工具任务 + 它们的子任务）会让 idle 等待挂住；
- manual compaction 是 ordinary work，也会挂住；
- background compaction 不会；工具在 background 子树里创建的任务也不会。

### 边界情况的组合表

| 场景 | run 的结局 | 排队项 | 后继 run |
|---|---|---|---|
| 模型给出 `stop` 答案，boundary 选中一条 followUp | `done`（answer = 答案条目） | followUp 变成新 run 的 inputs，其余留队 | 有 |
| 模型给出 `stop` 答案，无选中项，`onYield` 给出 continuation | 仍开着（run 交给后继 generation） | 不动 | 有（后继 generation） |
| 模型给出 `stop` 答案，无选中项，无 continuation | `done` | 不动 | 无，会话变 idle |
| 工具轮 `control.terminate` 且 boundary 选中 followUp | `done` | followUp 起新一轮 | 有 |
| 工具轮 `control.handoff` | `done`；`pi.reset` 在答案之后 | 选中项在新上下文里执行 | 视选中项而定 |
| `postTools` 选中 reset | `unanswered/reset` | 选中项在新上下文里执行 | 有 |
| 非重试错误 / 第二次溢出 / 预算耗尽 | `unanswered/model_error` | **不动**，留到下次提交或撤回 | 无 |
| 任务被 abort / fault / orphan | `unanswered/aborted` / `faulted` / `orphaned` | 不动（conversation abort 另行撤回 input） | 无 |
| idle 且 inbox 非空时提交新 input | 先跑 final boundary 放置等待项 | 新 input 排在队尾 | 视选中项而定 |

**崩溃点**：boundary 的全部放置在一笔提交里。重开后要么整批已生效，要么整批未生效；`pi.reset`、`addTools`、`run` 的交接也在同一笔提交里。排队项在提交前是纯数据，重开后由下一次 boundary 或 idle 准入继续处理。

**submission 的状态机**

```text
input:
  queued ──boundary 选中──> placed ──run 成功──> done{ answer }
    │                          │
    │                          └──run 失败/abort/fault/orphan──> unanswered{ reason }
    └──Submission.abort() / conversation abort──> unanswered{ aborted }

write:
  queued ──boundary 放置──> done{ entry }
    ├──head 太旧──> unanswered{ stale }
    └──Submission.abort()──> unanswered{ aborted }（conversation abort 不撤 write）
```

`placed` 只表示「已进 transcript、被某个 run 认领」，不表示送达模型；`done` 必须带 `answer`（一个 assistant 条目 ID），因此「这次 run 用哪条回答结清了这条输入」是可查的。

**prepareBoundary 的三个调用点**

| 调用点 | 何时 | 切面 | 备注 |
|---|---|---|---|
| `admitSubmission()` | idle 但 inbox 非空，新提交入队后 | `final` | 同一个 commit 里放置等待项，因此新提交不会越过旧等待项 |
| `generation.answer()` | 模型给出 `stop` / `length` / 无 call 的 `toolUse` | `final` | 先读模式、再追加答案、再放置——顺序保证 write 与 followUp 都排在答案之后 |
| `generation.finishToolRound()` | 工具轮收尾 | `postTools`，或 `terminate` / `handoff` / 选中 reset 时 `final` | `addTools` 与 `pi.reset` 也在同一笔提交里 |

队列模式（`steeringMode` / `followUpMode`）在每个 boundary 当场读取，而不是在提交准入时快照——所以「提交时设置是 one-at-a-time、放置时已改成 all」会按后者执行（`test/harness-inbox.test.ts:169-201` 就是占住 Session 线后改设置来验证这一点）。

**abort 的时间线**

```text
abortTask(id) 或 Conversation.abort()
  1. commit abort 标记                     // 持久事实：任务不会再启动新 phase
  2. signal 与 join 正在跑的 invocation     // 让工具/请求尽快返回
  3. 对被标记任务排队一次 abort invocation
  4. abort handler 运行（内联补偿，不能 return waiting）
  5. 任务终态；等待方（waitForTask / waitForIdle）解析
```

对 generation 调 `abortTask()` 等于中止整轮：它的工具任务会在 generation 的 abort handler 之前先跑完各自的 abort handler（因为 handler 只在子任务全部终态后运行），所以「未启动的调用写 aborted 结果」这一步看到的是最终的轮状态。

**busy / idle 的诊断入口**

| 想知道什么 | 看哪里 |
|---|---|
| 现在忙不忙、谁负责这次 run | `pi.live.run`（`snapshot(LiveDoc, conversationId)`） |
| 当前尝试到哪了 | `pi.live.generation`（attempt / retry / deferred / partial） |
| 哪些工具在跑 | `pi.live.tools` 的 `status` 与 `taskId` |
| 有哪些压缩在跑 | `pi.live.compactions`（含 `blocking` 标记） |
| 队列里有什么 | `pi.inbox.items`（按 ID 顺序） |
| 未结提交与活任务的总览 | `harness.inspect()`（只读，不产生等待） |
| 某个任务的历史与 checkpoint | `harness.getTask(id)` |
| 什么时候真正空闲 | `Conversation.waitForIdle()` / `Harness.waitForIdle()` |

**为什么不是每个工具轮都结束 run**

工具轮结束时有两种走法，选择权在工具（`control.terminate` / `control.handoff`）与 boundary（reset）：

| 走法 | 谁触发 | run 结局 | 适用于 |
|---|---|---|---|
| 继续（postTools） | 默认 | inputs 保持，交给后继 generation | 绝大多数工具轮：模型还要基于结果继续思考 |
| 终止（final） | 全部 control 都 `terminate` | inputs `done`（answer = tool-calling 回答） | 工具已经完成整个任务，不再需要模型续写 |
| 换上下文（final） | 任一 control `handoff` | inputs `done`，`pi.reset` 开新上下文 | 任务已完成但后续对话应在新上下文里进行 |
| 切上下文（final） | boundary 选中 reset | inputs `unanswered/reset` | 用户在工具轮期间要求重置 |

设计含义：`terminate` 让「工具结束整个 run」成为可表达的意图，而不用伪造一条答案；`handoff` 让「完成之后换个上下文」不需要额外一次模型调用。两者都在**轮收尾的那一笔提交**里决定，因此不存在「工具已返回但控制流半应用」的状态。

**steer / followUp / write 的选择建议**

| 你的意图 | 用哪个 | 理由 |
|---|---|---|
| 补充约束、纠正方向，希望模型尽快看到 | steer | 在下一个 `postTools` 就进上下文，且不会中断正在跑的工具 |
| 追加一个「答完这轮再说」的任务 | followUp | 在 final 才取，不会污染当前回合 |
| 写入应用自己的上下文数据/标记 | write | 不触发 run、不打断当前回合；按 ID 序先于用户消息落库 |
| 让模型完全忘记之前的历史 | reset（`Conversation.reset()` 或 `control.handoff`） | `head: "self"` 切断活动范围 |
| 立刻停止当前 run | `Conversation.abort()` + 重新提交 | steer 做不到「立刻」，abort 才是真正的打断 |

**boundary 的原子性与位置语义**

两条规则值得用例子记住：

```text
例 1（位置语义）：inbox = [f1(followUp), write, f2(followUp)]
  final boundary 选中 f1 与 f2（followUpMode = all）+ write
  放置顺序：write → f1 → f2
  删除：把下标 0、1、2 降序删掉，剩下的项相对顺序不变
  → 如果只选中 f1：inbox 变成 [write, f2]，write 的 id 仍然排在原来的位置

例 2（先写后说）：inbox = [summary(head=150), f1]
  放置 summary → 活动范围起点 = 150；再放 f1
  → f1 落在摘要之后，因此它在新上下文里执行

例 3（同 boundary 内的 stale）：inbox = [reset(head="self"), summary(head=100)]
  放置 reset → 活动范围起点 = reset 条目 id；summary 的 100 < 起点 → stale
  → 若顺序反过来（summary 在前）则两个都能落地
```

`write` 的 `head` 是「这条条目从哪个旧条目开始替换活动范围」，因此它既是语义（模型看到什么），也是排序信号（谁让谁过期）。应用自己造 head write 时，这两个作用都要考虑。

相关测试：`test/harness-inbox.test.ts`（三条轨迹、stale 的三种成因、撤回、失败后保留队列、跨 reopen）、`test/harness-tools.test.ts`（`control.addTools` / `terminate` 的消费）、`test/harness-compaction.test.ts`（background 与 manual 在 idle 等待与 abort 上的差别）。

## 3.6 恢复语义速查：崩溃后每个环节会发生什么

这张表按「崩在哪」组织。三个前提对每一行都成立：

1. Harness 关闭或进程被杀不会写任何 outcome（`test/harness-tasks.test.ts:1111`）；
2. 重开 Harness 并让调度恢复（`resume()`，或任何请求进度的调用，例如 `Submission.wait()`）后，每个未终态的任务从自己的 checkpoint 重新开始；
3. 「模型看到什么」指重开后下一次真正发出去的请求里包含的内容。

| 崩在哪 | 重开后发生什么 | 模型看到什么 | 可能重复的副作用 |
|---|---|---|---|
| 输入准入的 commit 之前 | 什么都没有：submission 不存在，transcript 无 `pi.user` | 无关（没有请求） | 无 |
| 输入已 `placed`、`prepare` 提交前（渲染或阈值判定中） | checkpoint 仍是 `{ prepare, attempt: 1 }`；`prepare` 整体重跑，重跑后只写一份 `pi.system` | 完整的当前系统提示与工具声明 | section 的 `render()` 被再次调用（应是纯函数） |
| 阻塞压缩已创建、generation 在 `waiting` | generation 恢复等待，压缩按自己的 checkpoint 继续；两者都终态后 `prepare` 重跑 | 若压缩产出摘要：摘要 + 保留区间 + 新的系统 baseline；否则原上下文照发 | 压缩的模型调用可能重发一次（只计费已提交响应） |
| `request` 已提交、请求尚未产生 partial | checkpoint 是 `{ request, model, thinkingLevel, streamOptions, cutoff }`；**直接重发**，pinned 选项不因重开后的设置变化而改变 | 与崩溃前完全相同的消息 | provider 侧多一次请求（可能计费） |
| 流式过程中、partial 已提交 | `request` 先把 partial 转成 `stopReason: "aborted"` 的 assistant 条目，再用同一批消息重发 | 提示 + 上次那半截 aborted 回答（它不会进入之后的请求，但这次重发包含它） | provider 多一次调用；已产出的半截文本被永久保留（这是特性） |
| 流式过程中、partial 尚未提交（不到 100 ms 窗口） | 同「尚未产生 partial」 | 与崩溃前相同的消息 | 无 durable 痕迹 |
| 终态消息已到、分类提交前 | 分类整体重做：同一条消息再走一遍判定 | 由判定结果决定 | provider 多一次调用；工具轮可能因此重新建立（任务与槽位是一个 commit，不会半建） |
| `retry` 退避中 | checkpoint 是 `{ retry, attempt, until }`，`pi.live.generation.retry` 保留 `{ at, error }`；时钟到 `until` 后回 `prepare` | 新一轮尝试（重新解析 agent/settings） | 无（退避本身无副作用） |
| `poll` 等待中 | checkpoint 是 `{ poll, handle, pollAt }`；到点后 `fetchDeferred()` | 取决于 provider 返回的结果 | 无；仍 deferred 则继续往后排，`pollAt` 严格前进 |
| pinned 模型在重开后消失 | `request` / `poll` 解析不到模型 → `no_model` 失败，inputs `unanswered` | 无关（无请求） | 无 |
| 「assistant 已落盘、工具任务未建」 | **不存在这个状态**：assistant 条目、工具任务、槽位数组、`{ tools }` checkpoint 在一个 commit 里 | — | — |
| 工具意图已落盘、执行中 | 工具任务从 `execute` phase 恢复，按 replay 表决定重跑或写 `interrupted` | 重跑：真实结果；不重跑：`interrupted` + 「may have partially run」诊断 | 仅当存储与当前策略都为 `safe` 时重复执行工具代码；否则不重复 |
| 工具执行中、意图尚未落盘 | 从 `{ phase: "call" }` 重做：解析、修参数、`beforeTool` 再跑一遍，然后执行一次 | 正常结果 | `beforeTool` 会被再次调用；工具代码只执行一次 |
| 工具结果已落盘、generation 收尾 commit 前 | `tools` 阶段的 checkpoint 仍在；恢复后重新读 `outcomes()`，进入 `finishToolRound()` | 每个 call 的工具结果（含 fault 时合成的缺失结果） | `afterTools` hook 会**再次执行**（`test/harness-tools-recovery.test.ts:252-287`）；工具本身不会重跑 |
| 工具任务被 fault（结果提交被存储拒绝） | 调度器把槽位标 `done` 且不带 entry；上下文派生为缺失结果合成「Tool result unavailable: history ends before this call completed.」；run 继续 | 合成的缺失结果 | 无结果条目可重复；工具真实副作用是否发生取决于错误发生在哪一步 |
| 工具任务被 abort（`abortTask`） | abort handler 用槽位持久输出写 `aborted` 结果并结算槽位；run 继续到下一轮 | `aborted` 结果 + 已提交的部分输出 | 无（未提交的缓冲区丢弃） |
| 压缩 `select` 中（含 `beforeCompact`） | `select` 重跑，hook 再调用一次 | 是否压缩取决于这次决定 | hook 可能重复执行；未产生摘要则无 dangling 状态 |
| 压缩 `summarize` 中（响应已到、分类提交前） | 重发同一 pinned 请求；只有提交了响应的那次计费 | 无直接可见变化（摘要尚未放置） | provider 多一次调用 |
| 压缩 `retry` 退避中 | 时钟到 `until` 后重发同一 pinned 请求 | 无直接可见变化 | 无 |
| 摘要已放置、任务终态提交前 | **不存在这个状态**：放置、移除状态、终态 outcome 在一个 commit 里 | — | — |
| 摘要已排队（write submission，等 boundary） | 队列保留在 `pi.inbox`；下一个 boundary 或 idle 准入放置它 | 摘要出现在它被放置的位置之后 | 无；过期时 settle 为 `stale` 且不写条目 |
| boundary 放置中（writes、steer、reset 混在一起） | boundary 的全部放置在一个 commit 里，要么整批生效要么整批不生效；重开后由下一次 boundary 或 idle 准入继续 | 与生效后的状态一致 | 无重复放置；被 settle 的项不会被选出第二次 |
| abort 传播中 | abort 标记是持久事实；受影响任务运行各自的 abort handler（generation 取消 deferred、为未启动的 call 写 `aborted` 结果、转换 partial、结清 inputs；工具写 `aborted` 结果） | run 终止且 inputs `unanswered`；已提交的部分输出仍在 | 无重复条目——每个 abort handler 的效果都在单笔提交里 |
| Harness `close()`（不是崩溃） | 不写 outcome、不启动新 phase 或 abort invocation；重开后按 checkpoint 继续 | 同对应行的「重开后」描述 | 关停自身不造成重复 |

### 每行的测试证据

| 行 | 证据 |
|---|---|
| prepare 重跑 | `test/harness-generation-recovery.test.ts:41-72`（重开后 checkpoint 仍是 prepare，最终只有一份 `pi.system`） |
| request 重发 + pinned 选项 | 同上 `:74-123`（重开后把 `timeoutMs` 改成 999，重发仍用 1234） |
| partial 转换 | 同上 `:124-163`（转换后的条目 stopReason 为 `aborted`，文本与崩溃前观察到的 partial 一致） |
| retry / poll 续期 | 同上 `:164-228`（`until: 61000`、`pollAt: 61000`，时钟拨过去后继续） |
| pinned 模型消失 | 同上 `:230-268`（request 与 poll 两种 phase 都得到 `no_model`） |
| 工具 interrupted / safe 重跑 | `test/harness-tools-recovery.test.ts:109-163`（checkpoint 落在 `execute`、`replay: "unsafe"`；runs 计数 1 或 2） |
| 无意图重跑 | 同上 `:213-251`（`beforeTool` 调两次，工具执行一次） |
| `tools` 阶段重跑 | 同上 `:252-287`（`afterTools` 调两次，条目只有一份工具结果） |
| fault 合成结果 | 同上 `:310-336`（`requests` 里是那句 missing result 文本） |
| abort 的工具 | 同上 `:289-308`（结果文本 = 部分输出 + `Tool work was aborted` 诊断） |
| 压缩放置后不重复 | `test/harness-compaction.test.ts:1558-1574`（条目、usage、任务、提交列表都与关闭前相同） |
| 溢出压缩失败 | 同上 `:1576-1596`（settle 为 `model_error`，detail 是当初的溢出文本） |
| select 重跑 | 同上 `:1598-1621`（hook 调用两次） |
| 摘要重发与计费 | 同上 `:1623-1645`（重发消息与首次相同，usage 只多一次回答） |
| 阻塞等待跨 reopen | 同上 `:1668-1685`（重开后条目顺序是 summary → system → assistant） |
| 排队摘要跨 reopen | 同上 `:1687-1703`（下一个 boundary 放置，submission 最终 `done`） |

### 不可能出现的中间态

下面这些「看起来应该存在」的状态被提交边界消掉了，写代码时不要假设它们：

| 假设的状态 | 为什么不存在 |
|---|---|
| 答案条目已写、submission 未 settle | 答案、boundary、`settleSubmission` 在同一事务里解析并生效 |
| assistant 条目已写、工具任务未创建 | 四样东西（assistant、任务、槽位、checkpoint）是一个 commit |
| 工具结果条目已写、槽位仍 `running` | 结果、槽位 `done`、终态 outcome 是一个 commit |
| 摘要条目已写、压缩状态仍在 `pi.live` | 放置、移除状态、终态 outcome 是一个 commit |
| `run` 还在、inputs 全部已 settle | `endRun` 在同一个 commit 里 settle 并删除 `run` |
| 排队项已从 inbox 移除、submission 仍 `queued` | 移除与 settle 在同一个 commit |

### 重复副作用清单

| 种类 | 会重复吗 | 条件 |
|---|---|---|
| provider 请求 | 会（可能计费） | 任何「请求已发出、响应未提交」的崩溃 |
| 工具代码执行 | 会 | 仅当存储与当前的 `replay` 都为 `safe` |
| section `render()` | 会 | `prepare` 重跑（渲染失败、阻塞压缩后、崩溃后） |
| `beforeTool` | 会 | 崩溃发生在意图提交之前 |
| `beforeCompact` | 会 | `select` 阶段崩溃或重跑 |
| `afterTool` | 不会 | 它在 `run()` 内、结果提交之前；但那一次执行本身可能重复 |
| `afterTools` | 会 | `finishToolRound` 重跑（`tools` 阶段崩溃后或收尾 commit 前） |
| `afterResponse` / `onYield` | 会 | 分类重做或重发时 |
| 条目写入 | 不会 | 每类条目都在单笔提交里，且写前有终态判定 |
| submission settle | 不会 | `settleSubmission` 只在终态路径调用，且已有终态不会被覆盖（`test/harness-generation.test.ts:142-160`） |
| usage 累加 | 不会 | 只在与条目/响应同笔提交时累加 |

结论：把有副作用的东西放在工具实现里、并保持默认 `unsafe`；hook 与 section 只做纯计算或幂等操作。

### 计费与恢复

- 拿到响应并提交的分类 commit 都计费：失败、`length`、被 abort 的 partial 都会进 `pi.usage`；
- 没有提交响应的尝试不计：provider 可能已经消耗了 token，但 durable 看不到，也就不会记账；
- 压缩的恢复重发只多计「已提交的那次回答」的用量；
- fork 从 `initial()` 开始，计数不会重复。

### 时钟与恢复

- `retry.until` 与 `poll.pollAt` 都是 Harness 时钟上的**绝对**时刻，不受重启影响；
- `pollAt` 每次重排都严格前进（至少 +1 ms），所以不会出现「同一时刻反复轮询」；
- 测试里的做法是把 `HarnessOptions.now` 固定成可控值，重开后把时钟拨到目标时刻再 `resume()`；
- 生产环境里这意味着「退避与轮询的剩余时间」在重启后自然继续，而不是重新开始计时。

### 恢复测试的写法

从这批测试里可以提炼出一个固定套路（想给自己的扩展任务补恢复测试时照抄）：

```text
1. 用可持久化的存储（sqlite 文件）打开 Harness，提交输入；
2. waitFor 一个 durable 标记（live 上的某字段、或任务 checkpoint）；
3. close()（模拟进程结束）；
4. 重新 open 同一个文件，必要时改设置或注册表；
5. 先断言「崩溃前提交了什么」（checkpoint 字段、live 状态、条目）；
6. resume() 并等待 submission settle；
7. 断言终局（条目序列、usage、任务 outcome、live 是否清空）。
```

**崩溃与重开的时间线**

```text
运行中:  task 状态 = running（checkpoint 已提交）        pi.live = 当前展示
崩溃:    close() 或进程被杀
         ── 不写任何 outcome；内存里的缓冲丢失（未提交的 partial / 输出 / 轮询等待）
重开:    open 同一个存储
         ── pi.live、pi.inbox、条目、usage、任务记录、提交记录都还在
         ── 任务仍是未终态；没有任务处于 running invocation
恢复:    resume()（或任何请求进度的调用）→ 调度器保留任务 → 从 checkpoint 的 phase 进入
继续:    每个任务按自己的规则重做该 phase；父任务用 runtime.outcomes() 重新观察子任务
```

**症状对照：你现在停在哪一行**

重开后不用猜，看几个 durable 信号就能定位：

| 观察 | 说明 |
|---|---|
| `pi.live.generation.message` 非空 | 上一条流式 partial 已提交 → 走「partial 转换 + 重发」 |
| checkpoint 的 phase 是 `request` 且无 partial | 请求已定稿但未产生可持久化的输出 → 直接重发 |
| checkpoint 的 phase 是 `poll` | provider 侧还有 deferred 响应在等 → 到 `pollAt` 后取回 |
| checkpoint 的 phase 是 `retry` | 退避中；`live.generation.retry.at` 是恢复时刻 |
| `pi.live.compactions` 里有 `blocking: true` | 某个 generation 在等压缩 → 压缩先走完，generation 再重跑 `prepare` |
| `pi.live.compactions` 里有 `retry.at` | 摘要请求在退避 |
| `pi.live.tools` 里有 `status: "running"` 的槽位 | 工具执行中 → 走 replay 表 |
| `pi.live.tools` 全部 `done` 但 checkpoint 仍是 `tools` | 工具已终态、收尾 commit 未发生 → 重跑 `finishToolRound`（`afterTools` 会再跑一次） |
| `pi.live.tools` 里有 `status: "pending"` 且无 `taskId` | 串行轮里尚未启动的调用 → 从它继续启动 |
| `pi.inbox.items` 非空且没有 `run` | 排队项在等下一个 boundary；下一次提交会顺带处理它们 |
| `submission.status === "placed"` 且有 `run` | 正常进行中；它的 ID 应出现在某个 `run.inputs` 里 |
| `submission.status === "placed"` 且没有 `run` | 不应出现。若观察到，先检查是否有别的进程/实例在写同一个存储 |

最后一行值得强调：durable 假定「同一时刻只有一个 Harness 拥有一个 Session」。规范要求在新的 Harness 打开之前先 `close()` 旧的，并等到它解析完成（`docs/spec.md:3184-3190`）——两个实例同时持有同一存储时，`pi.live` 的这两个不变量都可能被破坏，而这不是恢复能修复的状态。

**恢复后的一致性判据（自检清单）**

重开并恢复后，如果下面几条不成立，那就不是「恢复逻辑」的问题，而是外部干预（多实例写同一存储、手工改文档、扩展任务越权写别人的会话）：

1. `run` 不存在时，`generation` 与 `tools` 也不存在（每个终态路径都在同一笔提交里一起删除）；
2. `tools` 里出现 `status: "running"` 的槽位时，`run` 必然存在；
3. 任何 `status: "placed"` 的 input 都能在某个 `run.inputs` 里找到；
4. `compactions` 里的每个任务 ID 都能在任务表里找到对应记录；
5. `pi.inbox.items` 里的每个 ID 都能找到一条 `queued` 的提交记录。

### 与恢复相关的测试文件

| 文件 | 覆盖 |
|---|---|
| `test/harness-generation-recovery.test.ts` | prepare 重跑、request 重发与 pinned 选项、partial 转换、retry/poll 续期、pinned 模型消失、print 风格回合的读回 |
| `test/harness-tools-recovery.test.ts` | unsafe 中断、双 safe 重跑、环境重取、无意图重跑、`tools` 阶段重跑、abort 与 fault 的续行、真实命令跨 close/reopen、重跑前清进度 |
| `test/harness-compaction.test.ts`（recovery 段） | 放置后不重复、溢出压缩失败、select 重跑、摘要重发与计费、退避续期、阻塞等待跨 reopen、排队摘要跨 reopen |
| `test/harness-tasks-recovery.test.ts` | 任务机器的通用崩溃/重保留语义（见第 6 部分） |
| `test/harness-tasks.test.ts` | 通用任务生命周期：phase 推进、fault、abort、close 的边界（见 2.7、2.8 节） |

**每个环节的最小验证集**

如果你给自己的扩展任务写恢复测试，不需要复制上面所有断言；按阶段取最小的那几条就够证明恢复语义：

| 阶段 | 最小验证集 |
|---|---|
| prepare | 重开后 checkpoint 仍是 `{ prepare, attempt }`；终局 transcript 里 `pi.system` 只有一份 |
| request（无 partial） | checkpoint 保留 `model/thinkingLevel/streamOptions`；重开后改设置不影响重发；只多一次 provider 调用 |
| request（有 partial） | partial 被转成 `aborted` 条目；转换后的文本与崩溃前观察到的 partial 一致 |
| classify 前 | 重开后没有多余的 assistant 条目（分类是单个 commit） |
| retry / poll | checkpoint 里的 `until` / `pollAt` 是绝对时刻；把时钟拨过去后继续；usage 不重复 |
| tool（意图后） | checkpoint 落在 `execute` 且带 `replay`；`unsafe` 时结果是 `interrupted`、`safe` 时结果来自第二次执行 |
| tool（意图前） | `beforeTool` 被调用两次，工具代码执行一次 |
| 工具轮收尾 | `afterTools` 被调用两次，transcript 里只有一份工具结果 |
| compaction（select） | hook 被调用两次；最终 `completed` |
| compaction（summarize） | 重发消息与首次相同；usage 只多一次回答 |
| 放置 | 条目、usage、任务、提交列表与关闭前一致；排队摘要在下一个 boundary 落地 |

**重开后第一次请求是怎么构建出来的**

按 `prepare` 的真实顺序走一遍，能看清「恢复」到底恢复了什么：

```text
1. 调度器保留任务，从 checkpoint 的 phase 进入（这里假设是 prepare）
2. runtime.agent()  -> 用**当前**注册表与 pi.agent 文档重新解析（可能与你上次跑时不同）
3. runtime.context() -> 从盘上派生：head、edits、排除 aborted/error/deferred、工具结果重排
4. replaySections() + renderSections() -> 重新渲染每个 section（hook/扩展可能给出不同文本）
5. planSystemEntries() -> 与重放结果比较，写出差量；若 head 之后没有 pi.system，写 baseline
6. thresholdCompaction() -> 用真实 usage + 估算判断是否需要压缩
7. commit：追加差量 + （必要时创建后台压缩）+ 写 { request, model, thinkingLevel, streamOptions, cutoff }
8. request 阶段：转换残留 partial、重新派生消息、跑 beforeRequest、发请求
```

两个跟恢复直接相关的结论：

- **第 2、4 步是「重新做决定」的地方**：agent 与扩展是当前进程里的，所以重开后的第一次请求可能用不同的提示文本、不同的工具集。这是设计意图（部署更新后立即生效），但意味着「同一 attempt 的可复现性」只在 `request` 之后成立。
- **第 8 步的「转换残留 partial」是恢复特有的动作**：正常路径下 `pi.live.generation.message` 已被分类清掉，只有崩溃才会留下它。

若 checkpoint 是 `request` / `poll` / `tools` / `retry`，则跳过 1–7 中对应的部分，直接复用已提交的决策（pinned 请求或轮状态）——这正是「重发」与「重做」的分界（见 3.2 节的对照表）。

---

## 3.7 写自己的持久任务：从零到上线

这一节是一份**教程**：从「我需要一个持久任务」到「它能扛住崩溃、能被中止、能被测试」。所有 API 语义都在第 2.7 节讲过，这里只讲「怎么组装」。

### 3.7.1 先判断：要不要写成任务

| 你的工作 | 用普通函数 | 用 Task |
|---|---|---|
| 一次性的纯计算（格式化、解析） | ✅ | 太重 |
| 有外部副作用、可能中途崩溃（下单、发邮件、跑长命令） | ❌ 崩溃即丢失/重复 | ✅ |
| 需要跨重启继续（批量索引、长流程） | ❌ | ✅ |
| 需要被 `abort()` 中止并各自清理 | ❌ | ✅（abort 处理器） |
| 需要等待子工作（并行子任务） | ❌ | ✅（`waiting` + `on`） |

判据一句话：**这段工作需要「崩溃后能接着做」或「能被中止并收尾」吗？** 会，就写成任务。

### 3.7.2 骨架清单

写一个任务前，把下面九个问题回答完（对应 `defineTask` 的字段）：

```text
1. name       持久化的 kind 名（改了就找不到老任务）→ "app.index-repo"
2. version    检查点形状的版本（形状变了要配 migrate）
3. input      创建时传入的数据（必须 JSON 可序列化）
4. State      状态机的形状：{ phase: "…", … 各阶段的字段 }
5. initial    input → 起点状态
6. phases     每个 phase 一个处理器；必须对 State["phase"] 穷尽
7. 检查点      每个 phase 结束时提交「下一步 + 已发生的事实」
8. abort      被中止时怎么收尾（必须提交终态）
9. owner      谁拥有它：会话（conversation）还是某个任务（task）
```

再加两条纪律：

- **每个 phase 都要假设自己被跑过多次**（重跑不是异常）；
- **每个 phase 要么提交检查点/终局，要么把状态推进成 `waiting`**，否则调度器会判 fault。

### 3.7.3 完整例子：`indexRepo`（含并行子任务、文档、abort）

需求：把一个仓库的若干目录并行索引，全部成功才算成功；任何失败要中止其余；被中止时要标记「已中止」。索引进度写进一个会话文档（UI 可观察）。

```typescript
import { defineDoc, defineTask, type TaskId } from "@earendil-works/pi-durable";

// ① 进度文档（会话级，UI 通过 watchDoc / viewState 观察）
const IndexProgress = defineDoc<{ done: string[]; failed: string[] }>({
	kind: "app.index-progress", version: 1, scope: "conversation",
	history: "latest", fork: "initial",
	initial: () => ({ done: [], failed: [] }),
});

// ② 子任务：索引一个目录（幂等的副作用 + memo 保护）
const IndexOne = defineTask<{ dir: string }, { phase: "run" }, { files: number }>({
	name: "app.index-one", version: 1,
	initial: () => ({ phase: "run" }),
	phases: {
		run: async (task, runtime, ctx) => {
			// 先查「这个目录我索引过没有」——memo 是先写先赢的，存在任务记录里
			const done = await runtime.memo("indexed", ctx);
			if (done === undefined) {
				await runtime.memo("indexed", true, ctx);            // 先落盘「我要做」（memo 自己完成一次提交）
				await indexDirectory(task.input.dir, ctx);           // 幂等副作用（重跑安全）
			}
			await runtime.commit(
				() => ({ status: "terminal", outcome: { status: "completed", result: { files: countOf(task.input.dir) } } }),
				ctx,
			);
		},
	},
	abort: async (_task, runtime, ctx) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
	},
});

// ③ 顶层任务：先做准备，再并行开子任务并等待
const IndexRepo = defineTask<{ dirs: string[] }, { phase: "prepare" | "fan" | "report"; children?: TaskId[] }, { total: number }>({
	name: "app.index-repo", version: 1,
	initial: (input) => ({ phase: "prepare" }),
	phases: {
		prepare: async (task, runtime, ctx) => {
			await runtime.commit(async (tx) => {
				(await tx.doc(IndexProgress, runtime.conversationId)).done = [];   // 初始化进度
				return { status: "running", checkpoint: { phase: "fan" } };
			}, ctx);
		},
		fan: async (task, runtime, ctx) => {
			await runtime.commit(async (tx) => {
				const children = [];
				for (const dir of task.input.dirs) {
					// 子任务与父任务在同一个会话里；owner 是父任务
					children.push(await tx.createTask(IndexOne, { dir }, { ownership: { kind: "task", taskId: task.id } }));
				}
				// 建子任务 + 进入等待 + 等待名单：同一笔提交，原子
				return { status: "waiting", checkpoint: { phase: "report", children }, on: children, policy: "failFast" };
			}, ctx);
		},
		report: async (task, runtime, ctx) => {
			const outcomes = await runtime.outcomes(task.state.checkpoint.children!, ctx);
			const total = outcomes.reduce((sum, o) => sum + (o.status === "completed" ? o.result.files : 0), 0);
			await runtime.commit(async (tx) => {
				const progress = await tx.doc(IndexProgress, runtime.conversationId);
				progress.done = task.input.dirs;                       // 简单起见：全部成功才写 done
				return { status: "terminal", outcome: { status: "completed", result: { total } } };
			}, ctx);
		},
	},
	abort: async (task, runtime, ctx) => {
		await runtime.commit(async (tx) => {
			(await tx.doc(IndexProgress, runtime.conversationId)).failed.push("aborted");
			return { status: "terminal", outcome: { status: "aborted", reason: "user cancelled" } };
		}, ctx);
	},
});
```

把这三个任务装进注册表（重启后必须重新装，否则任务找不到代码）：

```typescript
const registry = createRegistry();
registry.install(defineExtension({ name: "indexer", tasks: [IndexRepo, IndexOne] }));
```

创建与等待：

```typescript
const id = await root.commit(
	(tx) => tx.createTask(IndexRepo, { dirs: ["src", "test", "docs"] }, { ownership: { kind: "conversation" } }),
	context,
);
const settled = await harness.waitForTask(id, context);    // 会启动调度
console.log(settled.state);                                 // { status: "terminal", outcome: { status: "completed", … } }
```

### 3.7.4 逐点解释

**① 为什么 `fan` 阶段要把三件事写在一笔提交里。**

```text
tx.createTask(...) × 3   ← 子任务记录
{ status: "waiting", … } ← 本任务的下一状态
on: children             ← 等待名单
```

如果分成两笔提交，就可能出现「子任务建好了、父任务还没进入 waiting」的中间态。崩溃后重启：父任务还是 `running`，它会**再建三个子任务**——重复副作用。写在一笔提交里，这个中间态根本不存在。

**② 为什么 `policy: "failFast"` 是需求的一部分。**

`createTask` 的场景里，一张卡被拒就该退掉其余的钱。`failFast` 让「第一个失败」直接中止其余子任务；父任务在 `report` 阶段看到的结果里就包含失败。若要「全部跑完再决定」，用 `allSettled`。

**③ 为什么 memo 的写法是「先写 memo 再干活」。**

```text
查 memo（没有）→ 写 memo=true → 干活 → 提交终局
```

崩溃点在「干活」中间时，重跑会**发现 memo 已是 true**，于是跳过副作用，直接提交终局。这就是示例 `13` 的模式：`tick 2` 打印过就不会再打印。

**注意 memo 的语义边界**：memo 记录的是「这个一次性副作用我打算做过」，不是「它成功了」。崩在「写 memo」与「副作用完成」之间时，重跑会**跳过**副作用——对「打印一行日志」这没问题（最坏少打一行），但对「必须真正完成」的业务动作**不行**。要求「结果必须出现」时，用检查点或文档记录**已完成的事实**（例如把「已索引的目录」写进 checkpoint / 会话文档），并让副作用本身幂等；memo 只适合「重复执行代价小、漏执行代价也小」的一次性动作。上面例子里 `IndexOne` 用 memo 只是为了演示模式，真实产品应把「索引完成的目录」放进 checkpoint。

**④ 为什么每个任务都有自己的 abort 处理器。**

`harness.abortTask(IndexRepo)` 会先中止它拥有的三个子任务（各自走自己的 abort 处理器），等它们收尾完，才跑 `IndexRepo.abort`。这样每个任务只负责**自己那一层**的收尾——子任务不重复写进度，父任务不替子任务擦屁股。

**⑤ 文档与任务的关系。**

`runtime.conversationId` 是任务所属会话；`tx.doc(IndexProgress, conversationId)` 需要这个 id。任务自己的临时产出更适合放在**任务文档**（`scope: "task"`）里，任务进入终态时会自动退役——永久结果请写进 entry 或会话/ Session 文档（`docs/pico-v5-chord-usage.md:328-332` 明确建议）。

### 3.7.5 崩溃清单：逐 phase 自检

写完任务后，对着这张表逐行问「如果在这里崩溃会怎样」：

| 崩溃点 | 重开后 | 你要做的保证 |
|---|---|---|
| `initial` 提交前后 | 从头/从起点开始 | 起点状态不含「已经做过的副作用」的假设 |
| phase 内、第一次 `commit` 之前 | 该 phase 重跑 | phase 开头不能有不可重跑的副作用 |
| 提交「意图」之后、副作用之前 | 重跑，副作用未发生 | — |
| 副作用之后、提交结果之前 | 重跑 → 副作用重复 | 幂等（memo / 去重键 / 可覆盖的写） |
| 提交结果之后 | 从检查点继续 | 检查点必须包含恢复所需的一切字段 |
| `waiting` 期间 | 由 `on` 重新兑现 | 等待名单与 policy 必须在检查点里 |
| `completing` 期间 | 等 owned 工作排空 | 不要在新 phase 里假设 owned 工作已经结束 |
| abort 处理器里 | 重新跑 abort 处理器（幂等） | abort 处理器也必须可重跑 |

### 3.7.6 测试你的任务

任务代码是普通函数，测试起来不需要真模型：

```typescript
const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, BACKGROUND_CONTEXT);
const root = await harness.root(BACKGROUND_CONTEXT);
const id = await root.commit((tx) => tx.createTask(Ticker, { n: 3 }, { ownership: { kind: "conversation" } }), BACKGROUND_CONTEXT);
const settled = await harness.waitForTask(id, BACKGROUND_CONTEXT);
expect(settled.state).toMatchObject({ status: "terminal", outcome: { status: "completed" } });
await harness.close(BACKGROUND_CONTEXT);
```

要测试**恢复**，用 SQLite/JSONL 存储：第一个 Harness 跑到一半 `close()`，然后开第二个 Harness `waitForTask()` 继续（`test/harness-tasks-recovery.test.ts` 的做法，第 6.3 节给出设计细节）。

### 3.7.7 版本与迁移

任务的 `version` 对应**检查点形状**。改形状时要提供 `migrate`：

```typescript
const Task2 = defineTask({ …, version: 2, migrate: (input, checkpoint, fromVersion) => ({ phase: "prepare", … }) });
```

规则与文档迁移一致：**存储版本比定义新 → 拒绝**；存储版本更旧且没有 `migrate` → 拒绝并报错。区别是任务的迁移对象是「input + checkpoint」，由框架在启动任务时调用。

### 3.7.8 常见错误清单

| 错误 | 症状 | 修法 |
|---|---|---|
| phase 结束不提交任何状态 | 任务被判 `faulted` | 每个 phase 都要 `runtime.commit()` |
| 在 phase 里直接改 `task.state` | 状态没落盘，重启后回到旧检查点 | 通过 `runtime.commit()` 的返回值提交 |
| 用普通变量保存「做过了没」 | 重跑时状态丢失 → 副作用重复 | 用 `runtime.memo` 或检查点 |
| 把子任务与等待分成两笔提交 | 崩溃后重复建子任务 | 写在同一笔提交里 |
| 忘了重新安装扩展 | 重启后任务 `blocked`（`missing_task`） | 启动时 install 同名扩展；用 `harness.inspect()` 检查 |
| abort 处理器抛错 | 任务 `faulted` | abort 处理器要能容忍「资源已不存在」，并提交终态 |
| 在任务里等人类输入 | 任务卡在 `running`，重启后被重跑 | 拆成「提交问题 + 结束任务」，用新的提交把答案带回来 |
| 把大输出写在 task 文档里 | 任务退役时文档一起退役 | 永久结果写 entry / 会话文档 |

### 3.7.9 一张检查表（上线前）

```text
[ ] name/version 已确定，改名/改形状有迁移方案
[ ] 每个 phase 都可重跑，副作用幂等（memo / 去重键）
[ ] 每个 phase 都提交检查点或 waiting
[ ] 子任务与等待写在同一笔提交里
[ ] policy 选对了（failFast / allSettled）
[ ] abort 处理器收尾自己的副作用并提交终态
[ ] owner 选对了（会话顶层任务 vs 子任务）；需要背景执行用 background + anchor 模式
[ ] 有恢复测试：跑到一半关闭，重开后能继续（SQLite/JSONL）
[ ] 尝试过 abort 与「失败子任务」两条路径
```

---

---


# 第 4 部分：源码逐文件精读

这一部分按目录与文件逐节精读 61 个源文件（17,716 行）。每节的固定结构是：职责 → 导出面 → 关键流程 → 关键代码（带中文注释与行号）→ 不变式与边界 → 相关测试。它偏机械、偏细节，用于查阅与改造，不必顺序通读。

## 4.1 包根

包根目录的六个文件分成两类：`src/index.ts` 是公共入口，`src/types.ts` 是整个系统的类型总表，`src/documents.ts` /
`src/entries.ts` / `src/ids.ts` / `src/errors.ts` 是 kernel 依赖的四个小模块。它们都不依赖 `src/session/` 与
`src/harness/`，因此是理解上层实现之前的必要地基。`src/tasks.ts` 与 `src/truncate.ts` 一个是任务定义入口，
一个是工具输出截断工具，放在本节末尾。

### 4.1.1 src/index.ts

公共入口。它不定义任何值、不做初始化，只把「文档定义 + entry token + 三个错误类 + Harness 面 + Session 工厂 +
MemoryStorage + 全部公共类型」重新导出成 `@earendil-works/pi-durable`。因此这个文件的导出清单就是**公共协议**：
不在清单里的符号（`Transaction`、`SessionImpl`、`addressId`、`idFromNumber` 等）属于 kernel 内部，测试需要它们时走
相对路径 `../src/...` 直接导入。

#### 导出面

按来源模块分组（括号内是 `src/index.ts` 的行号）：

- `./documents.ts`（1 行）：`defineDoc`、`defineDocFamily`。同文件的 `AnyDocDefinition`、`AnyDocToken`、
  `ResolvedAddress`、`resolveAddress`、`addressId`、`documentCreate`、`checkRecordScope`、`checkRecordVersion`、
  `materializeDocument`、`materializeDocumentValue` **未导出**。
- `./entries.ts`（2-10 行）：`AssistantEntry`、`CompactionEntry`、`defineEntry`、`ResetEntry`、`SystemEntry`、
  `ToolResultEntry`、`UserEntry`。
- `./errors.ts`（11 行）：`ConversationBusy`、`ReadAfterWrite`、`StorageRejected`。
- `./harness/agent.ts`（12-17）：`AgentDoc`、`configure`、`DEFAULT_COMPACTION_POLICY`、`DEFAULT_RETRY_POLICY`。
- `./harness/compaction.ts`（18-23）：type `CompactionCheckpoint`、type `CompactionInput`、`CompactionTask`、
  type `SummaryRequest`。
- `./harness/define.ts`（24）：`defineExtension`、`defineTool`、`hook`、`section`、`wrapSection`、`wrapTool`。
- `./harness/events.ts`（25-31）：type `AgentEvent`、`AgentEventStream`、`MessageChange`、`SnapshotEvent`、`watchEvents`。
- `./harness/generation.ts`（32-37）：type `GenerationCheckpoint`、`GenerationInput`、`GenerationResult`、`GenerationTask`。
- `./harness/harness.ts`（38）：`Harness`。
- `./harness/inbox.ts`（39）：`InboxDoc`、type `InboxItem`、type `InboxState`。
- `./harness/live.ts`（40）：type `CompactionStatus`、`LiveDoc`、type `LiveState`、type `ToolSlot`。
- `./harness/provider.ts`（41）：`ProviderDoc`、type `ProviderState`。
- `./harness/registry.ts`（42）：`createRegistry`。
- `./harness/task-graph.ts`（43，type-only）：`TaskGraph`、`TaskGraphNode`、`TaskGraphState`、`TaskGraphWatch`。
- `./harness/tool.ts`（44）：`ToolTask`、type `ToolTaskCheckpoint`、`ToolTaskInput`、`ToolTaskResult`。
- `./harness/types.ts`（45-96，type-only）：`Agent`、`AgentChange`、`AgentState`、`AnyTask`、`CompactionHooks`、
  `CompactionPolicy`、`CompactionReason`、`CompactionResult`、`ContextView`、`Conversation`、`ConversationAbortOptions`、
  `ConversationCreateOptions`、`ConversationHandle`、`ConversationInit`、`ConversationRetryPolicy`、
  `ConversationStreamOptions`、`ConversationWatch`、`EnvTarget`、`Extension`、`GenerationHooks`、`HarnessInspection`、
  `HarnessOptions`、`HarnessSettings`、`HookApi`、`HookRegistration`、`HookResult`、`HooksOf`、`InputSubmissionDraft`、
  `ModelRef`、`PromptInput`、`PromptSection`、`QueueMode`、`Registry`、`RegistryReader`、`RegistrySnapshot`、`Settings`、
  `SettledSubmissionRecord`、`SettledTask`、`Submission`、`SubmissionDraft`、`TaskInspection`、`ToolControl`、
  `ToolDiagnostic`、`ToolExecutionApi`、`ToolExecutionMode`、`ToolExecutionResult`、`ToolHooks`、`ToolRegistration`、
  `UserInput`、`Wrap`。
- `./harness/usage.ts`（97）：`UsageDoc`、type `UsageState`；`./harness/view.ts`（98）：type `ConversationView`。
- `./session/session.ts`（99）：`createSession`；**`SessionImpl` 未导出**。
- `./storage/memory.ts`（100）：`MemoryStorage`。`src/storage/jsonl/`、`src/storage/sqlite/` 不在根入口，
  只能从各自子路径导入。
- `./tasks.ts`（101）：`defineTask`。
- `./types.ts`（102-181，type-only 列表；182 行是唯一的常量值导出 `ROOT_CONVERSATION_ID`）。

#### 关键流程

没有控制流。唯一的结构规则是两条导出形式：

```text
export { <值> } from "./module.ts"          // 运行时存在：类、函数、常量
export type { <类型> } from "./module.ts"   // 仅编译期：接口、类型别名
```

因此 `ROOT_CONVERSATION_ID` 单独写成 `export { ROOT_CONVERSATION_ID } from "./types.ts";`（182 行），
而 `types.ts` 的其余 100 多个导出全部走 `export type { ... }`（102-181 行）。

#### 关键代码

```ts
// src/index.ts:1-11
export { defineDoc, defineDocFamily } from "./documents.ts";   // 文档定义：单例与 family
export {
	AssistantEntry,        // pi.assistant：provider 结果
	CompactionEntry,       // pi.compaction：摘要 entry
	defineEntry,           // 自定义 entry kind 的唯一入口
	ResetEntry,            // pi.reset：新上下文起点
	SystemEntry,           // pi.system：位置化 prompt/tool 变更
	ToolResultEntry,       // pi.tool-result：工具结果（带 diagnostics）
	UserEntry,             // pi.user：用户输入
} from "./entries.ts";
export { ConversationBusy, ReadAfterWrite, StorageRejected } from "./errors.ts";   // 三个语义错误类
```

#### 不变式与边界

- 公共面与内部面在此切开：`createSession` 公共，`SessionImpl`（带 `commitWith` / `readOnLine` /
  `conversationDocumentOnLine` / `unloadDocuments`）不公共；`Transaction`、`TransactionHost`、`TransactionScope`、
  `LoadedDocument`、`CommittedStateSource`、`CommittedWatch`、`RETIREMENT_OPERATIONS` 全部不公共。
- `MemoryStorage` 是唯一出现在公共面的后端实现；SQLite / JSONL 走子路径。
  `[待核]: src/storage/jsonl/index.ts` 与 `src/storage/sqlite/index.ts` 的导出名本次未读，无法列出。
- 根入口不导出 `idFromNumber` / `seqFromNumber`（见 4.1.5 节）：贴牌函数被刻意留在内部，避免应用层伪造 ID。
- 根入口是纯 re-export，因此「导入这个包」不会触发任何副作用（不建连接、不读写文件）。

#### 相关测试

- `test/spec-usage.test.ts:1-33`：把 `docs/spec.md` 的用法示例逐块编译检查，导入源就是本包入口——覆盖「公共面能否表达
  spec 全部示例」。
- `test/examples/00-conversation.ts:5`、`01-documents.ts:5`、`02-forks.ts:5`、`03-owned-conversations.ts:5`、
  `04-chord-state.ts:5`、`05-watches.ts:5`：示例从 `../../src/index.ts` 导入同样的符号，端到端验证入口可用。
- `test/session-tables.test.ts:2-11`、`test/session-documents.test.ts:1-11`、`test/session-forks.test.ts:1-10`：
  测试只从包名取公共符号，内部件（`SessionImpl`、`idFromNumber`）另走相对导入——反向证明内外面边界。

### 4.1.2 src/types.ts

整个 durable 的**类型总表**：持久化记录的 JSON 形状、文档语义与 token 家族、Task / Submission / Document 的状态机，
以及 `Tx`、`Session`、`Storage` 三个边界接口。文件里只有类型声明和一个常量 `ROOT_CONVERSATION_ID`（39 行），
没有运行时逻辑。读这一节的价值在于：**kernel 的每条运行时规则都能在这里找到它的静态对应物**，反过来
`src/session/` 的实现只是把这些类型落实成流程，见 4.2 节。

#### 导出面

（签名按源文件原样摘录；长类型用 `…` 截断但不改写标识符。）

**一、JSON 与 brand**

- `type JsonObject = { [key: string]: JsonValue }`（15）—— 每个 durable document 的根必须是 JSON 对象。
- `type Id<Kind extends string, Type = unknown> = number & { readonly [idBrand]: { readonly kind: Kind;
  readonly type: Type } }`（20-25）—— *Kind* 区分记录种类，*Type* 携带附加类型（目前只有 Task 的结果）。
  `idBrand` 是 `declare const` 的 `unique symbol`（17），**运行期不存在**。
- `ConversationId = Id<"conversation">`（27）、`EntryId = Id<"entry">`（28）、`TaskId<Result = unknown> = Id<"task", Result>`
  （29）、`SubmissionId = Id<"submission">`（30）、`DocumentId = Id<"document">`（31）。
- `type Seq = number & { readonly [seqBrand]: "sequence" }`（36）—— 一次原子提交的序号，严格递增、允许空洞；
  独立 brand 防止实体 ID 被当提交点使用。
- `const ROOT_CONVERSATION_ID = 1 as ConversationId`（39）—— root conversation 的保留 ID（Storage 不得再分配 1）。

**二、文档语义、定义与 token**

- `type LatestConversationSemantics = { scope:"conversation"; history:"latest"; fork:"current" | "initial" }`（42-46）。
- `type RewindableConversationSemantics = { scope:"conversation"; history:"rewindable"; fork:"asOf" | "current" | "initial" }`（49-53）。
- `type DocumentSemantics`（56-60）= `{ scope:"session"; history?: never; fork?: never }` | 上面两种 | `{ scope:"task"; … }`
  —— 只有 conversation 文档声明 history / fork。
- `type CheckpointInfo = { readonly deltasSinceBase: number }`（63-66）—— 传给 `checkpointWhen` 的「最新 base 之后已存
  delta 数」，**不含**正在评估的这次变更。
- `type CommonDocDefinition<T extends JsonObject>`（69-78）：`kind`（稳定持久化种类，属于公共协议）、`version`（存储值
  形状的正整数版本）、`initial(): T`、可选 `migrate?(value: JsonObject, fromVersion: number): T`、
  可选 `checkpointWhen?(value: Readonly<T>, ops: readonly Op[], info: CheckpointInfo): boolean`。
- `type DocDefinition<T> = CommonDocDefinition<T> & DocumentSemantics`（81）。
- `type DocFamilyDefinition<T, I extends JsonValue> = Omit<CommonDocDefinition<T>, "initial"> & DocumentSemantics &
  { readonly family: true; initial(seed: I): T }`（84-88）—— family 成员缺失时才调用 `initial(seed)`。
- `interface DocToken<T, D> { readonly definition: D; readonly [docType]?: T }`（93-96）；`DocFamilyToken<T, I, D>`（99-102）
  同理。`docType`（90）只是类型层符号，token 运行时就是 `{ definition }` 一个对象。
- 八个 token 别名（104-134）：`SessionDocToken`、`ConversationDocToken`、`RewindableConversationDocToken`、
  `TaskDocToken`，以及四者的 `*FamilyToken` 版本。区别只在 `definition` 被约束到什么语义：`ConversationDocToken`
  允许 latest 或 rewindable，`RewindableConversationDocToken` 只允许 rewindable（`snapshotAsOf` 需要它）。

**三、Task**

- `type RunningTask<I, S, R> = TaskRecord<I, S, R> & { readonly state: Extract<TaskState<S, R>,
  { readonly status: "running" }> }`（137-139）—— 内存中「已被某次调用保留」的记录。
- `type NextTaskState<S, R> = Extract<TaskState<S, R>, { status: "running" | "waiting" | "terminal" }>`（145）——
  phase handler 允许提交的三种状态。
- `type PhaseHandler<I, P, S, R, H extends object> = (task: RunningTask<I, P, R>,
  runtime: TaskRuntime<I, S, R, H>, context: Context) => Promise<void>`（151-155）—— *task* 是按 phase 收窄的已保留记录；
  *runtime* 是本次调用的能力面；*context* 是可取消上下文。
- `interface HookRunner<H extends object>`（158-164）：`each<K extends keyof H>(name: K,
  invoke: (handler: NonNullable<H[K]>) => void | Promise<void>): Promise<void>` —— 按 phase 快照的 registry 顺序调用
  所有匹配 handler；`invoke` 普通抛错只上报并继续下一个，一旦 invocation 被 signal 则错误传播。
- `interface TaskRuntime<I, S, R, H> extends DocumentObserver, DocumentReader`（170-230）—— 只读字段
  `taskId`、`conversationId`、`signal`（abortTask / Harness 关闭 / invocation 结束时 abort）、`registry`
  （phase 边界刷新）、`settings`（每次访问重新解析）、`models`、`hooks`；方法 `agent(context)`（每 phase 最多解析一次）、
  `env(context)`、`commit(change, context)`、`memo(name, context)` / `memo(name, candidate, context)`、
  `getTask(id, context)`、`waitForTask(id, context)`、`outcomes(ids, context)`、`conversation(id, context)`、
  `entry(id, context)` / `entry(token, id, context)`、`context(conversationId, context, at?)`、
  `now()`（Harness 时钟）、`report(error)`（把非致命失败转发给 `HarnessOptions.onReport`）、
  `sleep(until, context)`（等到 Harness 时钟到达 `until`）。
  `commit` 的语义：返回值替换任务状态（返回 `undefined` 则不变），并在同一提交里重读任务。
- `type TaskDefinition<I, S extends { phase: string }, R, H extends object>`（233-256）：`name`（注册名，持久化到
  `TaskRecord.kind`）、`version`（持久化版本）、`initial(input): S`、`phases`（对 `S["phase"]` **穷尽**的 phase map）、
  `abort(task, runtime, context)`（在 abort 标记后于新 invocation 中运行，必须提交终态）、
  可选 `migrate(input, checkpoint, fromVersion)`（在 reservation 时转换更旧版本）、可选 `hooks?: H`。
- `interface Task<I, S, R, H> { readonly definition: TaskDefinition<I, S, R, H> }`（259-261）。
- `type TaskOwnership = { kind:"conversation" } | { kind:"task"; taskId: TaskId }`（264）；
  `type JoinPolicy = "failFast" | "allSettled"`（267）。
- `type TaskOptions = { readonly ownership: TaskOwnership; readonly conversationId?: ConversationId;
  readonly background?: boolean }`（270-280）—— `ownership` 必填；`conversationId` 默认取 owner 任务的会话或事务绑定的
  会话，未绑定会话的 Session 提交创建 conversation-owned 任务时必须显式给；`background` 只对 conversation-owned 任务
  有效（排除在普通 idle 等待、会话 abort、级联之外）。
- `type TaskOutcomeError = { readonly message: string; readonly detail?: JsonValue }`（442-446）。
- `type TaskOutcome<R>`（449-483）= `completed{result}` | `failed{error, result?}` | `aborted{reason?, result?}` |
  `orphaned{reason}` | `faulted{error}`。
- `type TaskState<S, R>`（486-520）= `pending{checkpoint}` | `running{checkpoint}` |
  `waiting{checkpoint, on: readonly TaskId[], policy: JoinPolicy}` | `completing{outcome}` | `terminal{outcome}`。
- `type TaskRecord<I, S, R> = TaskRecordBase<I, R> & (…live 状态 + 可选 memos | completing/terminal + memos?: never)`
  （541-552）；`TaskRecordBase`（523-538）= `id`、`conversationId`、`kind`、`version`、`input`、`owner?`（子任务的拥有者，
  immutable）、`background`、`abortRequested`。

**四、Conversation / Entry / 上下文编辑 / Submission**

- `type ConversationOwnership = { kind:"ownerless" } | { kind:"task"; taskId: TaskId }`（283）。
- `type ConversationRecord`（286-298）：`id`、`parent?: { conversationId; at: EntryId }`（fork 源与继承上界，含端点）、
  `owner?: { conversationId; taskId }`（归属边，用于归因、子树 abort、子树 idle 遍历，**不是**访问控制）。
- `type ContextEdit`（301-314）= `{ target: EntryId } & ({ action:"omit"; messages?: never } |
  { action:"replace"; messages: readonly Message[] })` —— 对某个可见 entry 贡献给模型上下文的不可变覆盖。
- `type EntryRecord`（317-332）：`id`、`conversationId`、`kind`（应用自定义判别符）、可选 `model`（贡献给模型上下文的消息）、
  可选 `data`（视图/扩展/记账用的 JSON）、可选 `head`（本 entry 选中的活动上下文起点）、可选 `edits`、可选 `byTaskId`。
- `type EntryDraft = Omit<EntryRecord, "id" | "conversationId" | "byTaskId" | "head"> & { head?: EntryId | "self" }`（335-338）
  —— `"self"` 表示「以刚分配的 entry ID 作为 head」。
- `type TypedEntry<D extends JsonValue> = Omit<EntryRecord, "data"> & ([D] extends [never] ? { data?: never } : { data: D })`
  （341-342）；`TypedEntryDraft<D>`（345-346）再额外去掉 `kind`。
- `interface Entry<D extends JsonValue = never> { readonly kind: string; is(entry: EntryRecord | undefined):
  entry is TypedEntry<D> }`（349-352）。
- `type SubmissionRecord`（363-427）= `{ id, conversationId, requestId? }` & `type:"input" | "write"` & 状态分支：
  input 为 `queued | placed{entry} | done{entry, answer} | unanswered{entry?, reason, detail?}`；
  write 为 `queued | done{entry} | unanswered{reason, detail?}`。
- `type SubmissionSettlement = { status:"done"; answer: EntryId } | { status:"unanswered"; reason: string; detail?: JsonValue }`（430-432）。
- `type SubmissionCreate`（435-439）= 分配式条件类型，把 `id` 从联合的每个成员上移除。

**五、文档记录、存储写与发布**

- `type DocumentRecord`（555-591）：`id`（唯一 incarnation，重建不复用）、`kind`、`key?`（仅 family）、
  `createdAt: Seq`（由存储盖章）、`retiredAt?: Seq`，再按 scope 分联合：session | conversation（额外带
  `history`/`fork`）| task。成员资格是半开区间 `createdAt <= at < retiredAt`。
- `type DocumentCreate`（594-598）= `Omit<DocumentRecord, "createdAt" | "retiredAt">`——不是另一个持久记录。
- `type Page<T, C> = { readonly items: readonly T[]; readonly next?: C }`（601-604）。
- `type Cursor = Readonly<Record<string, JsonValue>>`（607）—— 后端私有的续扫状态；调用方只能原样回传。
- 查询类型：`ConversationQuery`（610-613，`ownerConversationId` / `ownerTaskId`）、`EntryQuery`（616-622，必填
  `conversationId` + 可选 `minEntryId` / `maxEntryId` 闭区间）、`TaskQuery`（625-631，`conversationId` / `kind` /
  `status` / `abortRequested` / `background`）、`SubmissionQuery`（634-637，`conversationId` / `status`）。
- `type DocumentPoint = Seq | "current"`（640）—— 读文档时选当前还是某个历史提交点。
- `type DocumentAddress = { readonly kind: string; readonly scope: DocumentRecord["scope"]; readonly key?: string }`（643-648）
  —— 逻辑地址：kind + scope +（family 的）key。
- `type DocumentQuery = { readonly scope: DocumentRecord["scope"]; readonly at: DocumentPoint; readonly kind?: string }`（651-655）。
- `type DocumentContent`（658-668）= `{ version; kind:"base"; value: JsonObject }` |
  `{ version; kind:"delta"; ops: readonly Op[] }`。
- `type DocumentCopySource = { readonly id: DocumentId; readonly at: DocumentPoint }`（671-674）。
- `type StoredDocument = { readonly record: DocumentRecord; readonly version: number; readonly value: JsonObject;
  readonly deltasSinceBase: number }`（677-683）—— 某点物化后的 detached 值与其后的 delta 数。
- `type StorageWrite`（686-702）八种：`conversation` | `entry` | `task` | `submission` |
  `document.create{record, content: base}` | `document.copy{record, source}` | `document.change{id, content}` |
  `document.retire{id}`。
- `type DocumentCommitChange`（705-724）= `{ type:"document"; record; conversationId: ConversationId | undefined;
  version: number | undefined; value: JsonObject | null; ops: readonly Op[] }` |
  `{ type:"document.copy"; record; conversationId; source }`。
- `type TableCommitChange = Extract<StorageWrite, { type: "conversation" | "entry" | "task" | "submission" }>`（727-730）；
  `type CommitChange = TableCommitChange | DocumentCommitChange`（732）。
- `type CommitPublication = { readonly seq: Seq; readonly changes: readonly CommitChange[] }`（735-738）——
  **顺序未定义**。

**六、Tx：一次提交回调可见的事务面**

`interface Tx`（744-839）。方法与其语义：

- `conversation(id: ConversationId): Promise<ConversationRecord | undefined>`（745）—— 按 ID 读会话。
- `entry(id: EntryId): Promise<EntryRecord | undefined>`（746）；`entry<D extends JsonValue>(token: Entry<D>,
  id: EntryId): Promise<TypedEntry<D> | undefined>`（748）—— 后者在 kind 不符时返回 `undefined`。
- `task(id: TaskId): Promise<TaskRecord<JsonValue, JsonValue, JsonValue> | undefined>`（749）。
- `scanConversations(query, limit, cursor?): Promise<Page<ConversationRecord, Cursor>>`（750-754）；
  `scanEntries(query, limit, cursor?): Promise<Page<EntryRecord, Cursor>>`（755）；
  `scanTasks(query, limit, cursor?): Promise<Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Cursor>>`（758-762）。
- `latestHeadMarker(conversationId): Promise<(EntryRecord & { readonly head: EntryId }) | undefined>`（757）——
  最新的、带 `head` 的可见 entry（它就是上下文范围标记）。
- `submissionByRequest(conversationId, requestId): Promise<SubmissionRecord | undefined>`（764）—— 按
  conversation 级去重键查 submission。
- `createConversation(options: { ownership: ConversationOwnership }): Promise<ConversationRecord>`（767）。
- `forkConversation(parentConversationId, at, options: { ownership }): Promise<ConversationRecord>`（769-773）。
- `appendEntry(conversationId, value: EntryDraft): Promise<EntryRecord>`（775）；
  `appendEntry<D extends JsonValue>(token: Entry<D>, conversationId, value: TypedEntryDraft<NoInfer<D>>):
  Promise<TypedEntry<D>>`（777-781）。
- `createTask<I, S extends { phase: string }, R, H extends object>(task: Task<I,S,R,H>, input: I,
  options: TaskOptions): Promise<TaskId<R>>`（782-786）。
- `createSubmission(create: SubmissionCreate): Promise<SubmissionRecord>`（791）—— 明确「无准入规则：不查忙、不排队、
  不放置」，宿主应优先用 `Conversation.submit()` 或 conversation handle。
- `settleSubmission(id: SubmissionId, settlement: SubmissionSettlement): void`（797）—— 同步；只对 placed input 可
  回答；已结算的不变；解析发生在装配阶段，因此可以在表写之后调用。
- `placeSubmission(id: SubmissionId, entry: EntryId): void`（802）—— 同步；input 变 `placed`、write 变 `done`。
- `doc(...)` 六个重载（804-823）：`SessionDocToken` / `ConversationDocToken` + conversationId / `TaskDocToken` + taskId，
  以及三者对应的 family 重载（family 额外接 `key: string, seed: I`）。返回 `Promise<Draft<T>>`。
- `retireDoc(...)` 六个重载（825-838）：地址型 `Promise<void>`，family 要 key、**不要** seed。

**七、观察与 Session**

- `type DocumentState<T> = AttachedReplicatedState<Readonly<T> | null>`（842）—— 绑定到一个已提交 incarnation 的
  可释放只读 Chord state；`null` 表示退役。
- `type WatchEnd = { reason: "stopped" | "cancelled" | "session_closed" | "retired" } |
  { reason: "listener_error"; error: Error }`（845-847）。
- `interface WatchHandle<T>`（850-859）：`readonly value: T`（acquisition 时是初始 revision，之后是最新交付的 revision）、
  `start(listener: (value, ops, context) => Promise<void>): void`（唯一 listener，绝不内联调用）、
  `stop(): Promise<WatchEnd>`、`readonly closed: Promise<WatchEnd>`。
- `type DocumentWatch<T> = WatchHandle<Readonly<T> | null>`（861）。
- `type DocumentReader = Pick<Session, "snapshot" | "snapshotAsOf">`（864）。
- `interface DocumentObserver`（867-896）：`watchDoc` 六个重载，非创建型观察获取，返回
  `Promise<DocumentWatch<T> | undefined>`。
- `interface Session extends DocumentObserver`（899-983）：
  - `commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T>`（901）—— 在 Session 的唯一 mutation
    line 上跑一笔原子事务，返回回调结果。
  - `close(context: Context): Promise<void>`（903）—— 封准入、结算已准入提交、关闭存储。
  - `subscribeCommits(listener: (publication: CommitPublication, context: Context) => void): () => void`（905）——
    adopt 之后同步可观，listener 不得抛/阻塞/调 Session API。
  - `subscribeClose(listener: () => void): () => void`（907）—— close 开始时同步调用。
  - `snapshot` 六个重载（909-936）：返回当前共享的不可变 revision，缺席返回 `undefined`，**永不创建**。
  - `documentState` 六个重载（938-968）：返回一次性只读 Chord state。
  - `snapshotAsOf` 两个重载（970-982，只接受 rewindable conversation token / family token + `at: EntryId`）。

**八、Storage**

`interface Storage`（993-1084）。注释先规定了职责边界：**Storage 信任 Session 提供语义有效的记录**，自己只强制
原子性、全局 ID 归属、conversation/entry 的不可变创建、DocumentRecord 一致性与 detached 值；串行化由 Session 负责。
方法：

- `commit(writes: readonly StorageWrite[], context: Context): Promise<Seq>`（997）—— 原子持久化一批并返回序号；
  一旦 resolve，之后经同一 storage 的读必能观察到它。
- `mintId<I extends Id<string>>(): Promise<I>`（1000）—— 从 Session 全局数字 ID 命名空间发一个新 ID。
- `conversation(id, context): Promise<ConversationRecord | undefined>`（1003）。
- `scanConversations(query, limit, cursor, context): Promise<Page<ConversationRecord, Cursor>>`（1006-1011）—— 按 ID 升序。
- `entry(id, context): Promise<{ entry: EntryRecord; commitSeq: Seq } | undefined>`（1014）—— 全局按 ID 查，附带
  持久化它的提交序号；`entry(conversationId, id, context)`（1016-1020）—— 只在请求会话的 ancestry 可见时返回。
- `findLatestHeadMarker(conversationId, atOrBeforeEntryId: EntryId | undefined, context): Promise<(EntryRecord &
  { readonly head: EntryId }) | undefined>`（1026-1030）—— 返回的 entry 是标记，其 `head` 才是范围真正下界。
- `scanEntries(query, limit, cursor, context): Promise<Page<EntryRecord, Cursor>>`（1033-1038）—— 闭区间、新的在前。
- `task(id, context)`（1041）；`scanTasks(query, limit, cursor, context)`（1044-1049）。
- `submission(id, context)`（1052）；`scanSubmissions(query, limit, cursor, context)`（1055-1060，ID 升序）；
  `submissionByRequest(conversationId, requestId, context)`（1063-1067）。
- `findDocument(address: DocumentAddress, at: DocumentPoint, context): Promise<DocumentRecord | undefined>`（1070）——
  解析某点占据该逻辑地址的 incarnation。
- `document(id: DocumentId, at: DocumentPoint, context): Promise<StoredDocument | undefined>`（1073）—— 按 incarnation ID
  物化，**不**跟随地址上的替换。
- `scanDocuments(query, limit, cursor, context): Promise<Page<DocumentRecord, Cursor>>`（1076-1081）。
- `close(context): Promise<void>`（1084）—— 释放后端资源；之后所有操作必须 reject。

#### 关键流程

类型层没有调用栈，但这里编码了四条会直接决定 runtime 行为的「流程」，实现见 4.2.2 节：

1. **Submission 状态转移**（只有被允许的边存在，字段级用 `?: never` 互斥）：

```text
input : queued --place--> placed --settle(done)--> done{entry, answer}
                          placed --settle(unanswered)--> unanswered{entry?, reason, detail?}
write : queued --place--> done{entry}
                          queued --settle(unanswered)--> unanswered{reason, detail?}
终态（done / unanswered）不可再变；placed 的 input 是唯一能"被回答"的状态
```

2. **Task 状态转移**（`checkpoint` 与 `outcome` 互斥，`memos` 只在 live 状态）：

```text
pending --reserve--> running --commit--> running | waiting{on, policy} | terminal
waiting --(on 全终态)--> pending/running（重新可调度）
running|waiting --commit(terminal)--> completing   // 名下仍有普通 owned 工作时
completing --(owned 工作全结束)--> terminal
```

3. **文档读/写形状**：`DocumentContent` 只允许两种表示（base 或 delta）；`StorageWrite` 的
   `document.create` 强制 `content` 是 base，`document.change` 才可能带 delta。因此「创建永远是 base」是类型级规则。

4. **发布形状**：`CommitPublication.changes` 混合表写（`TableCommitChange`，直接复用 `StorageWrite` 对象）与文档发布
   （`DocumentCommitChange`，带 `value`/`ops` 或 `document.copy` 元数据），并且**顺序未定义**——消费者不得依赖数组顺序。

#### 关键代码

```ts
// src/types.ts:704-738
/** Committed change of one document incarnation. */
export type DocumentCommitChange =
	| {
			readonly type: "document";
			readonly record: DocumentRecord;
			/** Conversation owning the document; task documents derive it from their task record. Undefined only for Session documents. */
			readonly conversationId: ConversationId | undefined;   // Session 文档没有会话归属
			/** Definition version of `value`; absent when this commit retired the incarnation. */
			readonly version: number | undefined;                   // 退役提交里为 undefined
			/** Exact adopted immutable revision, or `null` when this commit retired the incarnation. */
			readonly value: JsonObject | null;                      // null = 退役
			/** Exact adopted operations for an ordinary update; empty for creation and retirement. */
			readonly ops: readonly Op[];                            // 创建/退役为 []
	  }
	| {
			/** Definition-free child initialization; consumers hydrate through state or watch acquisition. */
			readonly type: "document.copy";                        // fork 的 definition-free 复制：只有元数据，没有值
			readonly record: DocumentRecord;
			readonly conversationId: ConversationId;
			readonly source: DocumentCopySource;
	  };

/** Complete table record committed without another publication copy. */
export type TableCommitChange = Extract<
	StorageWrite,
	{ readonly type: "conversation" | "entry" | "task" | "submission" }
>;   // 表写以 StorageWrite 的同一对象发布，不再拷贝

export type CommitChange = TableCommitChange | DocumentCommitChange;

/** Every immutable change from one successful Session commit. Change order is unspecified. */
export type CommitPublication = {
	readonly seq: Seq;                     // 本次提交的序号，被 adopt 用作 createdAt / retiredAt
	readonly changes: readonly CommitChange[];   // 顺序未定义
};
```

#### 不变式与边界

- **brand 只在编译期**：`Id` / `Seq` / `docType` 都是 `unique symbol` 声明，运行期是普通 `number`；
  不同 kind 的 ID、以及 ID 与 `Seq` 之间在类型上互斥。给数字贴牌只能发生在可信边界（见 4.1.5 节）。
- `TaskId<Result>` 携带结果类型；擦除后不能反向收窄（`test/types.test.ts:55-58`）。
- `TaskState`：非终态必带 `checkpoint`；`completing` / `terminal` 必带 `outcome` 且 `checkpoint?: never`；
  `waiting` 额外带 `on` 与 `policy`。`TaskRecord` 的 `memos` 只在 `pending | running | waiting` 存在，终结后不得保留。
- `DocumentRecord`：`history` / `fork` 只出现在 conversation scope；task 文档不能声明 conversation 策略；
  `DocumentCreate` 不能带 `createdAt`。成员资格是半开区间，因此「同批创建 + 退役」的 incarnation 生命周期为空。
- `DocumentContent`：base 不能带 `ops`、delta 不能带 `value`；`document.create` 的 content 必须是 base。
- `SubmissionRecord`：queued 不引用 entry；input 的 `done` 必须有 `answer`；write 永不带 `answer`；
  `SubmissionCreate` 不能带 `id`。
- `Tx`：`settleSubmission` / `placeSubmission` 是同步 `void`，解析推迟到装配阶段，所以它们可以在第一次表写之后调用；
  而所有表读在第一次表写之后禁止（运行时抛 `ReadAfterWrite`，见 4.1.6 与 4.2.2 节）。文档访问与 read-your-writes
  不受表写限制。
- `Session.subscribeCommits` / `subscribeClose` 的 listener 必须在 mutation line 上同步返回，不得抛错、阻塞或调用
  Session API；文档 state / watch 的用户回调则在线外投递（见 4.2.4 节）。
- `Storage`：`findDocument`（按逻辑地址解析 alive incarnation）与 `document`（按 incarnation ID 物化，不跟随替换）
  是两个不同语义；`entry(conversationId, id)` 只在 ancestry 内可见；`commit` 是唯一的写入入口；`close` 之后一切拒绝。
- `[待核]:` `DocumentState<T>` 依赖的 `AttachedReplicatedState`（`subscribe` / `dispose` / `value` /
  `delivery.sequence` 等）定义在 `@earendil-works/chord`，本次未读该包，本节只写测试断言到的可观察行为。
- `[待核]:` `Cursor` 的内部字段由各后端自定义，`src/storage/*` 未读，无法给出字段级说明。

#### 相关测试

- `test/types.test.ts`（全篇）：`49-70` brand 的运行期表现（`typeof === "number"`、`JSON.stringify(taskId) === "4"`）与
  跨 kind / 跨 `Seq` 的编译期互斥；`72-254` 逐条 `@ts-expect-error` 固定判别式字段（`ContextEdit`、`TaskState`、
  `SubmissionRecord`、`DocumentRecord`、`DocumentContent`、`StorageWrite`）的合法组合；`256-346` 更高层的类型
  （`SubmissionDraft`、`hook`、`defineTask` 的 phase 穷尽性、`SettledTask` 的结果类型）。
- `test/session-definitions.test.ts:69-176`：`defineDoc` / `defineDocFamily` 的版本校验、六个 `tx.doc` / `tx.retireDoc`
  重载与六个 `snapshot` 重载的类型，以及 `defineEntry` 的类型收窄。
- `test/memory-storage.test.ts:8`：`registerStorageConformance(...)` 在 MemoryStorage 上跑 `Storage` 契约；
  `10-32` 断言 `prepareCommit` 不暴露内部留存状态、`apply()` 幂等返回同一 `Seq`。`test/sqlite-storage.test.ts`、
  `test/jsonl-storage.test.ts` 调同一个注册函数覆盖另外两个后端。
- `test/session-support.ts:37-113`：`ControlledStorage extends MemoryStorage` 覆写 `commit` / `mintId` / `document` /
  `findDocument`，签名必须与 `Storage` 契约一致——间接测试接口形状。
- `test/session-tables.test.ts:155-164`、`330-352`：对 `TaskRecord`（`state.pending`、`memos`）做运行期断言。

### 4.1.3 src/documents.ts

文档机制的纯函数层：制造 definition token、把「token + 重载参数」解析成逻辑地址、把 definition 与地址组装成存储创建
记录，以及对持久化记录做语义/版本校验与迁移物化。它不碰 Session、Storage 或 Chord draft —— 那些在 `src/session/`
里（见 4.2 节）。`src/session/session.ts` 与 `src/session/transaction.ts` 的所有文档访问都经过本文件的函数。

#### 导出面

- `defineDoc<T extends JsonObject>(definition: CommonDocDefinition<T> & { scope: "session" }): SessionDocToken<T>`（39-41）；
  另有三个重载：`& LatestConversationSemantics → ConversationDocToken<T>`（43-45）、
  `& RewindableConversationSemantics → RewindableConversationDocToken<T>`（47-49）、
  `& { scope: "task" } → TaskDocToken<T>`（51-53）。实现签名（54-57）
  `defineDoc<T extends JsonObject>(definition: DocDefinition<T>): DocToken<T, DocDefinition<T>>`：
  *参数*是完整定义（kind / version / initial / migrate? / checkpointWhen? + scope 语义），*返回* `{ definition }`，
  即一个只包住定义引用的轻量 token。
- `defineDocFamily<T extends JsonObject, I extends JsonValue>(definition: FamilyInput<T, I> & …): *FamilyToken<T, I>`
  四个重载（60-74）；实现（75-80）同样先 `validateDefinition` 再返回 `{ definition }`。
  `type FamilyInput`（33-36）= `Omit<CommonDocDefinition<T>, "initial"> & { readonly family: true; initial(seed: I): T }`。
- `type AnyDocDefinition`（83-90）= 擦除形状：`DocumentSemantics & { kind; version; family?: true; initial(seed?);
  migrate?; checkpointWhen? }`——Session 做完重载解析后使用它。
- `type AnyDocToken = { readonly definition: AnyDocDefinition }`（93）。
- `type ResolvedAddress = { readonly address: DocumentAddress; readonly id: string; readonly nextArgument: number }`（102-106）。
- `resolveAddress(definition: AnyDocDefinition, args: readonly unknown[]): ResolvedAddress`（109-127）——
  *args* 是调用方原样的重载实参（后面还跟着 `Context`）；*返回* 逻辑地址、地址字符串 ID、以及**下一个未消费参数的
  下标**（调用方用它取 `context` 或 family seed）。
- `addressId(address: DocumentAddress): string`（137-145）—— *返回* `JSON.stringify([kind, scope.kind, owner, key ?? null])`，
  是 tracker 缓存的 Map key，也是「同一逻辑地址」的判定依据。
- `documentCreate(definition: AnyDocDefinition, address: DocumentAddress, id: DocumentId): DocumentCreate`（148-165）——
  *返回* 存储创建记录；conversation 文档额外带 `history: definition.history!` 与 `fork: definition.fork!`。
- `checkRecordScope(definition: AnyDocDefinition, record: DocumentCreate | DocumentRecord): void`（168-176）——
  scope kind 不符、或 conversation 文档的 `history`/`fork` 与 definition 不符时抛 `TypeError`。
- `checkRecordVersion(definition: AnyDocDefinition, record: DocumentCreate | DocumentRecord, version: number): void`（179-190）
  —— `version > definition.version` 抛 “has newer version …”；更旧且 definition 无 `migrate` 时抛 “requires migration from …”。
- `materializeDocument(definition, stored: StoredDocument): JsonObject`（193-195）—— 委托下一函数。
- `materializeDocumentValue(definition, record, version: number, value: JsonObject): JsonObject`（198-208）——
  校验 scope 与版本；同版本**原样返回**，旧版本 `copyJson(definition.migrate!(value, version))`。
- 未导出：`validateDefinition`（95-99），只检查 `Number.isSafeInteger(version) && version >= 1`。

#### 关键流程

1. 定义阶段：`defineDoc` / `defineDocFamily` → `validateDefinition` → 返回 token。**kind 允许空串**，
   只有 version 被校验（非正整数抛 `TypeError("Document ${kind} version must be a positive integer")`）。
2. 地址解析（`resolveAddress`，109-127）：按 `definition.scope` 决定是否消费一个 owner 参数（session 不消费、
   conversation 消费 conversationId、task 消费 taskId）；若 `definition.family === true` 再消费一个 `key: string`。
   `ownerId`（129-134）要求参数是 safe integer，否则抛 `TypeError("Document ${kind} requires a ${scope} ID")`。
3. 身份字符串：`addressId` 用 4 元组 `[kind, scopeKind, owner|null, key|null]`；session 文档 owner 为 `null`。
   单例与 family 成员靠 `key` 区分，不会互相顶替。
4. 物化三步：`checkRecordScope` → `checkRecordVersion` → 同版本直接返回存储的 detached 值，旧版本走
   `copyJson(migrate(...))`。迁移是**纯函数**，不写存储。
5. 创建记录：session/task 直接带 scope；conversation 额外把 definition 的 `history`/`fork` 写进记录，使读取时能反向校验
   「token 语义 == 持久化语义」。

#### 关键代码

```ts
// src/documents.ts:109-134
/** Resolve an overloaded argument list and return the index after the owner and family key. */
export function resolveAddress(definition: AnyDocDefinition, args: readonly unknown[]): ResolvedAddress {
	let index = 0;
	let scope: DocumentAddress["scope"];
	switch (definition.scope) {
		case "session":
			scope = { kind: "session" };                    // session 文档不消费 owner 参数
			break;
		case "conversation":
			scope = { kind: "conversation", conversationId: ownerId<ConversationId>(args[index++], definition) };
			break;
		case "task":
			scope = { kind: "task", taskId: ownerId<TaskId>(args[index++], definition) };
			break;
	}
	const key = definition.family === true ? (args[index++] as string) : undefined;   // 只有 family 消费 key
	const address: DocumentAddress =
		key === undefined ? { kind: definition.kind, scope } : { kind: definition.kind, scope, key };
	return { address, id: addressId(address), nextArgument: index };   // nextArgument 指向后续的 Context/seed
}

function ownerId<I extends Id<string>>(value: unknown, definition: AnyDocDefinition): I {
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		throw new TypeError(`Document ${definition.kind} requires a ${definition.scope} ID`);
	}
	return idFromNumber<I>(value);   // 可信边界：校验过 safe integer 才贴 brand（见 4.1.5 节）
}
```

#### 不变式与边界

- 版本规则：definition 的 `version` 必须是 safe positive integer；kind 不做非空校验（对比 4.1.4 节的 `defineEntry`）。
- `resolveAddress` 校验 owner 是 safe integer，**不校验 owner 是否存在**；存在性由 Transaction 在获取/创建时检查
  （`src/session/transaction.ts:599-604`、`939-944`）。
- `checkRecordScope` 对 conversation 文档比较 `history`/`fork`，对 session/task 只比较 scope kind —— 后两类在类型层就
  不允许声明 history/fork。
- `checkRecordVersion`：更新的存储版本**永远拒绝**（不能降级解释）；更旧版本必须提供 `migrate` 才放行。
- `materializeDocumentValue` 同版本不做防御性拷贝，返回存储层已 detached 的同一引用；旧版本才对迁移结果做
  `copyJson` —— 对应「migration 回调永远拿不到活着的 tracker revision」。
- `documentCreate` 的 conversation 分支依赖 `definition.history!` / `definition.fork!` 非空断言，没有运行时兜底：
  `[待核]:` 一个被 `as AnyDocDefinition` 强转进来的畸形 definition 会写出 `undefined`，无法从源码证明它被拒绝——
  只能说四条重载不允许这么调用。
- `[待核]:` `copyJson`（来自 `@earendil-works/chord`）未读其实现，本节只依据测试断言「非严格 JSON 会抛含
  “strict JSON” 的错误」。

#### 相关测试

- `test/session-definitions.test.ts:69-76`：version `0` 与 `1.5` 抛 “positive integer”；`kind: ""` 合法；
  token 的 `definition.kind` 可读。
- `test/session-definitions.test.ts:78-124`：六个 `tx.doc` / `tx.retireDoc` 重载与六个 `snapshot` 重载的类型；
  session 文档不能带 owner、conversation 文档必须带 conversationId、family 必须给 seed、retire 不带 seed。
- `test/session-documents.test.ts:363-378`：rewindable token 访问 latest 文档抛
  “does not match the supplied definition semantics”；v2 token 访问 v1 存储抛 “requires migration from version 1”。
- `test/session-checkpoints-migrations.test.ts:529-562`：v1 token 读 v2 存储抛 “newer version 2 than 1”；
  v3 无 migrate 读 v2 抛 “requires migration from version 2”。
- `test/session-checkpoints-migrations.test.ts:496-527`：migrate 返回非严格 JSON 时 `snapshot` 与 `tx.doc()` 都抛
  “strict JSON”，不写存储且 Session 仍可用。
- `test/session-tables.test.ts:451-459`：`tx.doc()` 对不存在的 task / conversation owner 抛
  “Task 4242 does not exist” / “Conversation 4242 does not exist”。

### 4.1.4 src/entries.ts

entry token 的定义与六个内建 kind 的声明。`defineEntry` 是应用声明自定义 entry 的唯一入口，返回的 `is()` 提供按 `kind`
收窄的类型守卫；六个内建常量把 agent 协议里固定的 kind 名（`pi.user` 等）连同它们的模型侧/数据侧语义写在一处。
本文件不写 entry、不碰存储。

#### 导出面

- `defineEntry<D extends JsonValue = never>(kind: string): Entry<D>`（6-12）——
  *kind* 必须是非空字符串，否则抛 `TypeError("Entry kind must be a non-empty string")`；*返回* `{ kind, is(entry) }`，
  `is()` 在 `entry !== undefined && entry.kind === kind` 时把类型收窄为 `TypedEntry<D>`。`D` 是 `data` 字段的类型，
  默认 `never`（该 kind 不携带 data）。
- `UserEntry = defineEntry("pi.user")`（15）—— `model` 为 `[UserMessage]`；由 submissions 写入。
- `AssistantEntry = defineEntry("pi.assistant")`（17）—— provider 结果（任意 stop reason）；`model` 为 `[AssistantMessage]`；
  由 generation 写入。
- `SystemEntry = defineEntry("pi.system")`（19）—— 位置化 prompt 与 tool 变更；`model` 为 `[SystemMessage]` 且
  `content` 为空串。
- `ToolResultEntry = defineEntry<{ diagnostics: ToolDiagnostic[] }>("pi.tool-result")`（24）—— `model` 为
  `[ToolResultMessage]`，其内容以渲染后的 diagnostics 块结尾；`data` 是结构化 diagnostics（可能为空数组）；
  由 tool 任务写入，generation 也会为「自己没提供过的调用」写。
- `ResetEntry = defineEntry("pi.reset")`（29）—— 新上下文起点；总是 `head: "self"`；纯 reset 时 `model` 缺席，
  带 handoff 文本时是 `[UserMessage]`；由 `Conversation.reset()` 与 `handoff` tool control 写入。
- `CompactionEntry = defineEntry<{ reason: CompactionReason }>("pi.compaction")`（34）—— 摘要 entry；`model` 为
  `[UserMessage]`（包装后的摘要），`head` 指向第一个保留的 entry；由 compaction 任务直接或经 write submission 写入。

#### 关键流程

```text
defineEntry(kind)
  typeof kind !== "string" || kind.length === 0 → TypeError("Entry kind must be a non-empty string")
  返回 { kind, is }        // is 只比较 kind；undefined 一律 false
```

六个内建常量只是六次调用，没有额外逻辑；它们的差异在于谁是写入者、`model` 装什么消息、`data` 携带什么。

#### 关键代码

```ts
// src/entries.ts:14-34
/** User input: `model` is `[UserMessage]`. Written by submissions. */
export const UserEntry = defineEntry("pi.user");                      // 用户输入
/** Provider result with any stop reason: `model` is `[AssistantMessage]`. Written by generation. */
export const AssistantEntry = defineEntry("pi.assistant");            // 任意 stop reason 的 assistant 结果
/** Positional prompt and tool change: `model` is `[SystemMessage]` with empty `content`. */
export const SystemEntry = defineEntry("pi.system");                  // prompt / tool 变更，content 固定空串
/**
 * Tool result: `model` is `[ToolResultMessage]`, whose content ends with the rendered diagnostics block; `data` holds
 * the structured diagnostics, possibly none. Written by tool tasks, and by generation for calls it did not offer.
 */
export const ToolResultEntry = defineEntry<{ diagnostics: ToolDiagnostic[] }>("pi.tool-result");   // 带 diagnostics
/**
 * Start of a new context: always `head: "self"`, with `model` absent for a plain reset or `[UserMessage]` carrying the
 * handoff text. Written by `Conversation.reset()` and the `handoff` tool control.
 */
export const ResetEntry = defineEntry("pi.reset");                    // 上下文起点，head 固定 "self"
/**
 * Compaction summary: `model` is `[UserMessage]` with the wrapped summary, `head` the first kept entry. Written by
 * compaction tasks, directly or through a write submission.
 */
export const CompactionEntry = defineEntry<{ reason: CompactionReason }>("pi.compaction");   // 摘要携带 reason
```

#### 不变式与边界

- `defineEntry` 是**唯一**校验 kind 的地方（非空字符串），`defineDoc` 不校验 kind（见 4.1.3 节）。
- `is()` 只看 `kind`：不看会话、不看 `model`/`data` 是否存在。因此对 `ToolResultEntry` 这类带 data 的 kind，
  判定成功后仍要短路访问 `data`（测试写法 `ToolResultEntry.is(entry) && entry.data.diagnostics`，
  `test/harness-tools.test.ts:106`）。
- `D = never` 时 `TypedEntry<never>` 的 `data` 不可赋值，`tx.appendEntry(Marker, id, {})` 只能给空对象。
- kind 字符串是持久化协议：六个内建名字与磁盘数据绑定，改名即破坏兼容。
- 本文件只用 `import type` 引用 `./harness/types.ts` 的 `CompactionReason` / `ToolDiagnostic`，不引入运行时依赖。

#### 相关测试

- `test/harness-submissions.test.ts:260-277`：`defineEntry` 的运行期行为 —— 追加/读回同一记录、
  `entry(Marker, counter.id)` 返回 `undefined`（kind 不符）、不存在的 ID 返回 `undefined`、`Counter.is(counter) === true`、
  `AssistantEntry.is(counter) === false`、`UserEntry.kind` / `AssistantEntry.kind` 等于 `"pi.user"` / `"pi.assistant"`。
- `test/session-definitions.test.ts:126-176`：typed entry 的类型收窄；无数据 kind 不能带 `data`。
- `test/harness-tools.test.ts:106`：`ToolResultEntry` 的 `data` 是 `{ diagnostics: [] }`，且该 entry 带 `byTaskId`（107 行）。
- `test/harness-inbox.test.ts:257`：用 `ResetEntry.is(entry)` 找 transcript 里的 reset 边界。
- `test/harness-prompt.test.ts:27`、`:226`：用 `SystemEntry` 追加 prompt 变更 entry。
- `test/harness-generation.test.ts:99`、`:286`、`:608`、`test/harness-generation-recovery.test.ts:224`、`:280`、`:286`：
  用 `AssistantEntry` / `UserEntry` 读回生成结果与输入。
- `test/examples/25-compaction.ts:109`：`CompactionEntry.is(view.head) ? view.head.data.reason : undefined`。

### 4.1.5 src/ids.ts

kernel 的 brand 可信边界：把运行期数字变成编译期 branded 的 ID 或 `Seq`。文件共 11 行，只有两个 `as` 断言，零运行时
校验；安全性完全靠调用点约定 —— 只在「刚 mint 出来」或「刚从存储解码出来」的位置调用。这也是它**不在根入口导出**的
原因（见 4.1.1 节）。

#### 导出面

- `idFromNumber<I extends Id<string>>(value: number): I`（4-6）—— *value*：已经过分配或解码的可信 safe integer；
  *返回* 同一个数字，类型上成为 `I`（如 `ConversationId`）。无运行时检查。
- `seqFromNumber(value: number): Seq`（9-11）—— 同上，用于提交序号。

#### 关键流程

没有流程：两个函数体各一行 `return value as …`。约定是「谁调用它，谁负责证明这个数字可信」。

#### 关键代码

```ts
// src/ids.ts:1-11（文件共 11 行，整段摘录）
import type { Id, Seq } from "./types.ts";

/** Apply an erased ID brand at a trusted numeric allocation or decoding boundary. */
export function idFromNumber<I extends Id<string>>(value: number): I {
	return value as I;              // 纯类型断言：调用点必须保证这是可信的分配/解码结果
}

/** Apply the erased commit-sequence brand at a trusted storage boundary. */
export function seqFromNumber(value: number): Seq {
	return value as Seq;            // 同上；Seq 与实体 ID 在类型层互斥，防止混用
}
```

#### 不变式与边界

- 零运行时成本、零运行时校验：传入非整数也原样返回。安全依赖调用点 —— `src/documents.ts:133`（已校验 safe integer）、
  `src/session/session.ts:328`（`snapshotAsOf` 已校验 `at` 是 safe integer）。
- 两个函数都不出现在 `src/index.ts`；测试需要时走 `../src/ids.ts` 相对导入。
- 与 `types.ts` 的 `idBrand` / `seqBrand` 成对：`Seq` brand 独立，保证实体 ID 不会被当作提交点（见 4.1.2 节）。

#### 相关测试

- `test/types.test.ts:3`、`39-45`：用它们构造 branded 值，断言 `typeof === "number"`、`JSON.stringify(taskId) === "4"`，
  以及跨 kind / 跨 `Seq` 的编译期互斥（55-68）。
- `test/session-tables.test.ts:13`、`:93`、`:184`；`test/session-definitions.test.ts:20`、`:109`；
  `test/memory-storage.test.ts:4`、`:13`：全部相对导入 `../src/ids.ts` 造内部 ID —— 反向证明它不在公共面。

### 4.1.6 src/errors.ts

声明三个有语义含义的错误类，让 kernel 与宿主区分「事务规则违规」「存储可判定拒绝」「会话忙」。本文件不抛错、
不写日志，只固定类型身份、消息模板与少量附加字段。

#### 导出面

- `class ReadAfterWrite extends Error`（4-9）：`constructor(method: string)`，消息固定为
  `Tx.${method}() cannot read tables after the first table write`，`name = "ReadAfterWrite"`。
  *method* 是被拒绝的表读方法名（如 `conversation`、`task`、`scanEntries`）。
- `class StorageRejected extends Error`（12-17）：`constructor(message: string, options?: ErrorOptions)`，
  `name = "StorageRejected"`，`options` 透传给 `Error` 以支持 `cause`。语义：存储在**产生任何持久效果之前**拒绝了整批
  写入，因此所属 Session 可以安全继续。
- `class ConversationBusy extends Error`（20-28）：`constructor(conversationId: ConversationId)`，消息
  `Conversation ${conversationId} is busy`，`name = "ConversationBusy"`，并持有 `readonly conversationId`。
  语义：一次 submission 撞上忙碌会话且未被准入。

#### 关键流程

三个类都是「构造时固定 `message` + `name`」的最小实现，没有分支。

#### 关键代码

```ts
// src/errors.ts:4-28
/** A transaction read a table after its first table write. Read every required row before writing. */
export class ReadAfterWrite extends Error {
	constructor(method: string) {
		super(`Tx.${method}() cannot read tables after the first table write`);   // 消息模板是测试断言的一部分
		this.name = "ReadAfterWrite";
	}
}

/** Storage rejected a batch before any durable effect; the owning Session may continue safely. */
export class StorageRejected extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);      // 透传 cause
		this.name = "StorageRejected";
	}
}

/** A submission reached a busy conversation and was not admitted. */
export class ConversationBusy extends Error {
	readonly conversationId: ConversationId;      // 宿主可据此定位/重试

	constructor(conversationId: ConversationId) {
		super(`Conversation ${conversationId} is busy`);
		this.name = "ConversationBusy";
		this.conversationId = conversationId;
	}
}
```

#### 不变式与边界

- `ReadAfterWrite` 的判定在 `src/session/transaction.ts:919-927` 的 `#read`（见 4.2.2 节）；本文件只承载身份与消息模板，
  消息里带方法名以便区分触发点。
- `StorageRejected` 是**唯一**允许 Session 继续运行的提交失败：`src/session/session.ts:428-433` 只在
  `!(error instanceof StorageRejected)` 时把 Session 标记为 poisoned。因此自定义 Storage 必须准确使用该类型。
- `ConversationBusy` 的 `conversationId` 是只读字段，测试用 `toMatchObject({ conversationId })` 断言。
- 三个类都显式设置 `name`，便于按名字分支；都不是内建错误子类。

#### 相关测试

- `test/session-tables.test.ts:91-97`：第一次表写之后 `tx.conversation` / `tx.task` / `tx.entry` /
  `tx.scanConversations` / `tx.scanEntries` 全部 `rejects.toBeInstanceOf(ReadAfterWrite)`，其中 `tx.task()` 同时断言消息
  `"Tx.task() cannot read tables after the first table write"`；同段断言文档访问仍可用。
- `test/session-tables.test.ts:121-130`：同步 `tx.setTask()` 也算第一次表写。
- `test/session-forks.test.ts:553-579`：注入 `StorageRejected("copy rejected")` 时整笔 fork 回滚且会话可继续；
  对照组见 `test/session-documents.test.ts:440-457`（普通 `Error` 会让 Session poisoned）。
- `test/harness-submissions.test.ts:74-78`：忙碌会话上 `whenBusy: "reject"` 的提交
  `rejects.toBeInstanceOf(ConversationBusy)` 且 `toMatchObject({ conversationId: root.id })`，不产生新提交。

### 4.1.7 src/tasks.ts

任务定义的公共入口。它把 `TaskDefinition` 包成 `Task` token，供 `tx.createTask()` 与 registry 使用；除包装之外不做
任何校验（`name` 非空、phase 穷尽性等由类型系统与 Harness 注册时保证）。文件只有 8 行，是第 2、3 部分里所有任务例子的
起点。

#### 导出面

- `defineTask<I, S extends { phase: string }, R, H extends object = object>(definition: TaskDefinition<I, S, R, H>):
  Task<I, S, R, H>`（4-7）—— *definition*：完整任务定义（`name` / `version` / `initial` / `phases` / `abort` /
  `migrate?` / `hooks?`，见 4.1.2 节）；*返回* `{ definition }`，即 `Task` token。

#### 关键流程

```text
defineTask(definition) → { definition }     // 无校验、无副作用、无注册
```

注册是另一件事：任务必须被放进 extension / registry，Harness 才能运行该 kind 的任务（`src/harness/registry.ts`，
本次未读，见 4.3 节）。

#### 关键代码

```ts
// src/tasks.ts:1-8（文件共 8 行，整段摘录）
import type { Task, TaskDefinition } from "./types.ts";

/** Define an executable task. Register it in the registry so a Harness can run tasks of its kind. */
export function defineTask<I, S extends { phase: string }, R, H extends object = object>(
	definition: TaskDefinition<I, S, R, H>,
): Task<I, S, R, H> {
	return { definition };          // 纯包装：校验由类型系统与注册阶段负责
}
```

#### 不变式与边界

- `defineTask` **不做**运行时校验：`name` 为空、`version` 非正整数、phase map 缺项都不会在定义时抛错；phase 穷尽性只是
  类型约束（`S["phase"]` 映射），`version` / `name` 的持久化语义由 Harness 的注册与 `TaskRecord` 承担。
- `H extends object = object`：不声明 hooks 的任务得到空 hooks 类型，此时 `keyof object` 为 `never`，
  因此 `runtime.hooks.each()` 无法用任何名字调用。
- 返回的 token 只包住定义引用；同一个 definition 可以被多处复用（测试里大量这样做）。
- `[待核]:` 是否有注册时的重复 `name` 检查、`version` 校验，需要读 `src/harness/registry.ts` 才能确认，本次未读。

#### 相关测试

- `test/types.test.ts:267-295`：`defineTask` 的类型推断 —— `initial(input)` 的收窄、`phases` 内 `task.state.checkpoint`
  按 phase 收窄、`HooksOf<typeof Stepper>` 提取 hooks；`:335-342` 用 `@ts-expect-error` 断言 **phase map 必须穷尽**。
- `test/harness-tasks.test.ts:35-41`：测试辅助 `oneStep()` 用 `defineTask` 造一相任务（`name` / `version` / `initial` /
  `phases.run` / `abort`）；`:86-119` 断言同一 invocation 通过多次 `runtime.commit()` 推进 checkpoint（`seen === [0,1,2]`，
  runtime 实例唯一）并最终完成；`:121-143` 断言「phase 没有持久进展」与「phase 抛错」都 fault，消息分别是
  `Task test.idle phase run returned without durable progress` 与 `boom`。
- `test/session-tables.test.ts:16-23`、`test/session-forks.test.ts:631-637`：测试用 `defineTask` 造任务再走
  `tx.createTask()`（不涉及 Harness 运行）。
- `test/spec-usage.test.ts:202`、`:229`：spec 示例里的 `Payment` / `Follow` 任务定义。
- `test/harness-inspect.test.ts:12`、`test/harness-ownership.test.ts:50`、`:74`、`:91`、`test/harness-registry.test.ts:35`、
  `test/harness-structured.test.ts:98`、`:127` 等：各测试自建任务定义。

### 4.1.8 src/truncate.ts

工具输出的共享截断工具。截断基于两个互相独立的上限——行数与字节数，**先到者胜**；永远不返回半个行。文件顶部注释
同时划清边界：它只处理「一次性字符串」，而**流式**输出的边界由 `src/harness/output.ts` 负责，别把两者混用。

#### 导出面

- `const DEFAULT_MAX_LINES = 2000`（11）—— 默认行上限。
- `const DEFAULT_MAX_BYTES = 50 * 1024`（12）—— 默认字节上限（50KB）。
- `interface TruncationResult`（14-37）—— 11 个字段，全部由 `truncateHead` 产出：
  `content`（截断后的内容）、`truncated`（是否发生截断）、`truncatedBy: "lines" | "bytes" | null`（命中哪个上限）、
  `totalLines` / `totalBytes`（原始总量）、`outputLines` / `outputBytes`（输出量）、
  `lastLinePartial`（是否为尾部截断的半行；`truncateHead` 恒为 `false`）、
  `firstLineExceedsLimit`（首行自身就超字节上限时为 `true`）、`maxLines` / `maxBytes`（本次实际生效的上限）。
- `interface TruncationOptions`（39-44）—— `maxLines?` / `maxBytes?`，缺省各取上面的常量。
- `utf8ByteLength(content: string): number`（53-79）—— *返回* UTF-8 字节数。运行时有 `Buffer` 就走
  `runtimeBuffer.byteLength(content, "utf8")`；没有则用手写循环（先 `search(/[^\x00-\x7f]/)` 直接返回 `content.length`
  的纯 ASCII 快路径，再逐码元累加 1/2/3/4 字节，正确处理代理对与孤立代理码元）。
- `formatSize(bytes: number): string`（91-99）—— `< 1024` 返回 `"NB"`，`< 1MiB` 返回一位小数的 `"N.NKB"`，
  否则 `"N.NMB"`（例如 `1023 → "1023B"`、`1536 → "1.5KB"`）。
- `truncateHead(content: string, options: TruncationOptions = {}): TruncationResult`（108-188）—— 从头部保留
  「前 N 行 / N 字节」。*content* 是完整字符串；*options* 可覆盖两个上限。
- 未导出：`interface RuntimeBuffer`（46-48）、`const runtimeBuffer`（50，从 `globalThis.Buffer` 取）、
  `nonAsciiPattern`（51）、`splitLinesForCounting(content)`（81-86）。

#### 关键流程

```text
truncateHead(content, options)
  maxLines / maxBytes = options ?? DEFAULT_*
  totalBytes = utf8ByteLength(content)
  lines = splitLinesForCounting(content)          // 空串 → []；结尾 "\n" 不额外算一行
  totalLines = lines.length

  1) totalLines <= maxLines && totalBytes <= maxBytes
       → truncated: false，truncatedBy: null，outputLines = totalLines，outputBytes = totalBytes
  2) 首行字节 > maxBytes
       → content: ""、truncatedBy: "bytes"、outputLines/outputBytes = 0、firstLineExceedsLimit: true
  3) 逐行收集（i 从 0 起，同时受 i < maxLines 限制）
       lineBytes = utf8ByteLength(line) + (i > 0 ? 1 : 0)        // 续行前的换行符计入字节
       outputBytesCount + lineBytes > maxBytes → truncatedBy = "bytes"，break
       否则收下该行并累加
  4) truncatedBy 收尾判定
       循环因字节 break → "bytes"
       否则：outputLines < totalLines → "lines"；相等 → "bytes"
         （相等只可能是"行数刚好打满 + 结尾换行超字节"，见测试）
  outputContent = outputLinesArr.join("\n")
  outputBytes = utf8ByteLength(outputContent)   // 重新计算，因此不含分隔用的换行
```

#### 关键代码

```ts
// src/truncate.ts:151-173
	// Collect complete lines that fit
	const outputLinesArr: string[] = [];
	let outputBytesCount = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	for (let i = 0; i < lines.length && i < maxLines; i++) {
		const line = lines[i];
		const lineBytes = utf8ByteLength(line) + (i > 0 ? 1 : 0); // +1 for newline：分隔符也算进字节上限

		if (outputBytesCount + lineBytes > maxBytes) {
			truncatedBy = "bytes";       // 字节先到：整行放弃，绝不返回半行
			break;
		}

		outputLinesArr.push(line);
		outputBytesCount += lineBytes;
	}

	// Without a byte break, only omitted lines prove the line limit was reached; otherwise a trailing newline exceeded bytes.
	if (truncatedBy !== "bytes") truncatedBy = outputLinesArr.length < totalLines ? "lines" : "bytes";

	const outputContent = outputLinesArr.join("\n");
	const finalOutputBytes = utf8ByteLength(outputContent);   // 重算：outputBytes 不含末尾分隔换行
```

#### 不变式与边界

- **不返回半行**：字节上限只能让整行被丢弃；若首行本身就超限，返回空串并置 `firstLineExceedsLimit = true`，
  由调用方决定如何提示（`src/tools/read.ts:70` 用它截断选中内容，`:77-88` 另有一处按字节上限截断单行并给出
  “exceeds the … limit; showing its first …” 消息的分支）。
- 空内容走第 1 步快路径（`totalLines === 0`、`totalBytes === 0`），因此不会访问不存在的 `lines[0]`。
- `splitLinesForCounting`：空串返回 `[]`；以 `"\n"` 结尾的内容不会把结尾空段计成一行（`"a\nb\n"` 是 2 行）。
- 字节计数含换行分隔符（第 158 行 `+ (i > 0 ? 1 : 0)`），但返回的 `outputBytes` 是对 `join("\n")` 结果重算的，
  所以两者在「最后一个收集行之后还有换行」时相差 1；`truncatedBy` 的收尾判定正是为了表达这种情况（测试
  `test/env-truncate.test.ts:63-71` 中 `"hello\nworld\n"` + `maxBytes: 11` 报 `"bytes"`）。
- `utf8ByteLength` 的两条路径必须给出相同结果；无 `Buffer` 时手写算法对孤立代理码元按 3 字节计（`\ud83d` 单独出现时
  不等于 emoji 的 4 字节）。
- `lastLinePartial` 在本文件恒为 `false`：它服务于尾部截断（tail）语义，而 `truncateHead` 不做尾部截断。
  `[待核]:` 本次未在包内找到导出 `truncateTail` 的文件（grep 全包只有本文件出现该字段），因此该字段目前的读者
  未确认。
- 常量被多处复用：`src/tools/bash.ts:5`、`:50`、`:72`（spill 阈值）、`src/harness/tool.ts:177-178`（工具输出上限）、
  `src/tools/read.ts:28`、`:70`（读文件提示与截断）。

#### 相关测试

- `test/env-truncate.test.ts:13-21`：`"aé🙂\nb"` 的 `totalBytes` / `outputBytes` 等于 `TextEncoder` 的 UTF-8 长度（9）且
  未截断。
- `test/env-truncate.test.ts:23-43`：用 `test/fixtures/delete-buffer.ts` 删掉 `globalThis.Buffer` 后另起进程运行
  `test/fixtures/utf8-byte-length-without-buffer.ts`，断言 `bufferAvailable === false`、10 个边界输入的字节数与
  `TextEncoder` 一致（含 `""`、`"é"`、`"中"`、`"🙂"`、孤立代理 `"\ud83d"`、`"\ude42"`、`"\u07ff\u0800\uffff"`），
  并且 `truncateHead("aé🙂\nb", { maxBytes: 7, maxLines: 10 })` 得到 `{ content: "aé🙂", outputBytes: 7, truncatedBy: "bytes" }`。
- `test/env-truncate.test.ts:45-50`：结尾换行不计入行数（3 行内容 + `"\n"` → `totalLines === 3` 且未截断）。
- `test/env-truncate.test.ts:52-61`：行上限截断（`maxLines: 2` → `content: "one\ntwo"`、`truncatedBy: "lines"`）。
- `test/env-truncate.test.ts:63-71`：行数刚好打满但结尾换行超字节 → `truncatedBy: "bytes"`。
- `test/env-truncate.test.ts:73-82`：UTF-8 字节上限截断不产生半行（`"éé\nabc"` + `maxBytes: 4` → `"éé"`、`outputBytes: 4`、
  `firstLineExceedsLimit: false`）。
- `test/env-truncate.test.ts:84-91`：首行超限 → `content: ""`、`firstLineExceedsLimit: true`。
- `test/env-truncate.test.ts:93-97`：`formatSize` 的三个分支。
- `test/tools.test.ts:31`、`:168`：测试用 `DEFAULT_MAX_LINES` 造出 `MAX_LINES + 1` 行的输出；
  `:538-551`（“reports the spill of a command that times out”）断言报告里的 `Full output: <path>` 指向的临时文件包含第
  `DEFAULT_MAX_LINES` 行与第 `DEFAULT_MAX_LINES + 1` 行——即截断只影响展示，完整输出仍被保留（spill 由
  `src/tools/bash.ts:72` 的 `spill: { afterBytes: DEFAULT_MAX_BYTES, afterLines: DEFAULT_MAX_LINES }` 触发）。

---

## 4.2 session/

`src/session/` 是 durable 的 kernel 层：`session.ts` 拥有唯一 mutation line 与 tracker 缓存，`transaction.ts` 实现一次
提交的事务语义与原子批次组装，`forks.ts` 负责 fork 时的文档复制选源，`observation.ts` 把已提交变更桥接给 Chord 的
state 与 watch。四者的关系是「Session 调用 Transaction，Transaction 读/写 Storage 并调用 forks，Session 通过
observation 对外发布」。第 1 部分的 1.3 分层数据流与 2.2 / 2.3 节的接口说明以本层为实现。

### 4.2.1 src/session/session.ts

Session kernel。它拥有 Session 的**唯一 mutation line**（所有提交与只读作业串行化）、已提交文档 incarnation 的
tracker 缓存，并实现一次提交的完整生命周期：回调 → 同步 prepare / 组装 → 存储结算 → 内存 adopt → 发布。
它同时是文档观察的宿主（`DocumentState` 与 `watchDoc` 的 Session 端），并在关闭时先封准入、再结算已准入工作、
最后关闭存储。`Harness` 通过继承它复用这条 line（`src/harness/harness.ts:165`，见 4.3 节）。

#### 导出面

- `createSession(storage: Storage): Session`（49-51）—— *storage* 是任一后端；*返回* `new SessionImpl(storage)` 暴露的
  `Session` 接口。
- `class SessionImpl implements Session`（59）—— 实现类（不在根入口导出，见 4.1.1 节）。
  - `constructor(storage: Storage)`（69-83）：保存 `#storage`，构造 `#host: TransactionHost`，把四个服务交给 Transaction：
    `cached(id)`（只查缓存）、`load(definition, addressId, address, context)`（冷加载 + 内存迁移）、
    `install(document)`（写缓存）、`evict(id, recordId)`（仅当缓存仍是同一 incarnation 时删除），
    `conversationCreated(tx, record)`（转给 protected 钩子）。
  - `commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T>`（85-87）—— 公共提交入口，
    转调 `commitWith`；*change* 是事务回调，*返回* 回调结果。
  - `commitWith<T>(change: (tx: Transaction) => T | Promise<T>, context: Context, scope?: TransactionScope): Promise<T>`
    （94-101）—— 内部提交入口；*scope* 设定默认 `tx.createTask()` 会话与 appended entry 的 `byTaskId`；
    先同步 `#assertUsable()`（关闭/poison 直接 reject），再排进 line。
  - `readOnLine<T>(job: () => Promise<T>): Promise<T>`（104-114）—— 内部只读作业，排在 line 上，使多读派生看到同一
    已提交状态（`harness/view.ts`、`scheduler.ts`、`task-graph.ts`、`submissions.ts` 使用）。
  - `conversationDocumentOnLine(token: ConversationDocToken<JsonObject>, conversationId: ConversationId,
    context: Context): Promise<{ record: DocumentRecord; version: number; value: JsonObject } | undefined>`（120-132）
    —— 供**已在 line 上**的作业读某会话文档当前 incarnation；`version` 是 `loaded.valueVersion`，`value` 是 tracker
    当前 revision；缺席返回 `undefined`。
  - `snapshot` 六个重载（134-161，实现 162-179）—— 读已提交的共享不可变值，**永不创建**，缺席 `undefined`。
  - `documentState` 六个重载（181-211，实现 212-237）—— 返回绑定某个已提交 incarnation 的一次性只读 Chord state。
  - `watchDoc` 六个重载（239-266，实现 267-301）—— 非创建型观察获取，返回 `DocumentWatch<T> | undefined`，
    并把 acquisition context 的 abort signal 接成自己的取消。
  - `snapshotAsOf` 两个重载（303-315，实现 316-348）—— 仅 rewindable conversation 文档，按可见 entry 所属提交点读
    历史 incarnation。
  - `close(context: Context): Promise<void>`（350-368）—— 幂等关闭：封准入 → `beforeClose()` → 清监听与缓存 →
    `storage.close()`。
  - `protected conversationCreated(_tx, _record): Promise<void>`（374-376）—— 每个创建/fork 会话的事务里、
    会话记录入队之后调用；基类空实现，Harness 覆写以写内建文档。
  - `protected beforeClose(): Promise<void>`（379-381）—— 准入已封、存储未关之间运行，必须不 reject。
  - `subscribeCommits(listener: (publication: CommitPublication, context: Context) => void): () => void`（384-388）、
    `subscribeClose(listener: () => void): () => void`（391-395）—— 同步监听器，返回幂等 disposer。
  - `unloadDocuments(): Promise<void>`（398-402）—— 在 line 上清空 tracker 缓存，之后访问冷加载（测试接口）。
  - 私有：`#runCommit`（404-444）、`#publish`（446-466）、`#attachDocument`（472-500）、`#loadDocument`（502-527）、
    `#enqueue`（529-536）、`#assertUsable`（538-541）、`#assertHealthy`（543-549）。
- 模块级：`observedOperations(observed, change)`（556-564）、`cancellationError(signal)`（566-568）。

#### 关键流程

**A. 一笔提交的十个步骤**（`#runCommit`，404-444）：

```text
#runCommit(change, context, scope)
  1. #assertHealthy()                                  // poisoned → 抛 “Session is poisoned by a failed commit …; reopen it”
  2. context.abortSignal?.throwIfAborted()             // 准入前仍可被调用方取消
  3. tx = new Transaction(#host, context, scope)
  4. result = await change(tx)
  5. 回调抛错 → await tx.settleFailure()               // seal + abort 所有 change + allSettled 所有 pending
               → 原样 rethrow
  6. writes = await tx.settleSuccess()                 // seal + 同步 prepare（吊销所有 draft）+ 组装原子批次
  7. writes.length === 0 → tx.discard()；return result // 空批次：既不提交也不发布
  8. seq = await storage.commit(writes, withoutAbortSignal(context))   // 准入后调用方取消不再中断结算
  9. 抛错 → tx.discard()；非 StorageRejected → #poison = { error }；rethrow
 10. documents = tx.adopt(seq)（失败 → poison）→ #publish(seq, writes, documents, context) → return result
```

**B. `#publish`**（446-466）：没有 commit 订阅者时立刻返回；否则把 `writes` 里的四种表写**原对象**按顺序收进
`changes`，再追加 `adopt()` 产出的文档发布，组成 `{ seq, changes }`，对 `[...#commitListeners]` 逐个同步调用
（传入本次提交的 context）。

**C. `#loadDocument`**（502-527）——tracker 缓存的唯一冷加载路径：

```text
cached = #documents.get(addressId)
cached?.valueVersion === definition.version → 直接返回
cached 存在但版本不符 → #documents.delete(addressId)     // 一个 tracker 只服务一个 token 版本
record = storage.findDocument(address, "current")         // undefined → 返回 undefined（文档缺席）
stored = storage.document(record.id, "current")           // undefined → 抛 “Current document … cannot be read”
value = materializeDocument(definition, stored)           // 必要时迁移，仅内存
#documents.set(addressId, { addressId, record: stored.record, storedVersion: stored.version,
                            valueVersion: definition.version, deltasSinceBase: stored.deltasSinceBase,
                            tracker: track(value) })
```

**D. `snapshot`**（162-179）：`#assertUsable()` → `resolveAddress` → 取 `context` → 缓存命中且版本一致时**不排队**直接
返回 `tracker.value`；否则排在 line 上冷加载；最后 `checkRecordScope` + `checkRecordVersion(storedVersion)`。

**E. `documentState`**（212-237）：在 line 上 load → `#attachDocument(..., (value, release) =>
new CommittedStateSource(value, release))` → `replicatedState(source)`；构造 state 抛错时 `detach()`。

**F. `watchDoc`**（267-301）：先看 acquisition signal 是否已 aborted，并挂一次性 abort listener 置 `cancelled`；
在 line 上再检查一次；`#attachDocument(..., (value, release) => new CommittedWatch(value, release))`（注意只传两个参数，
`replace` 为 undefined）；若期间取消 → `watch.cancel()` + 抛 `cancellationError(signal)`；否则
`watch.observeCancellation(signal)`；`finally` 移除临时 listener。

**G. `snapshotAsOf`**（316-348）：地址必须是 conversation scope（否则 `TypeError`），`at` 必须是 safe integer
（否则 `TypeError`）；在 line 上：`storage.entry(conversationId, at)` 做可见性检查（不可见抛
“Entry ${at} is not visible from conversation …”）→ 把地址 scope 换成 **entry 所属会话** →
`storage.findDocument(address, storedEntry.commitSeq)` → `storage.document(record.id, storedEntry.commitSeq)`
（读不到抛 “Historical document … cannot be read”）→ `materializeDocument`。

**H. `#attachDocument`**（472-500）：`checkRecordScope` / `checkRecordVersion` → `create(loaded.tracker.value, detach)` →
订阅 commits：只处理 `change.type === "document" && change.record.id === loaded.record.id` 的变更；
`observed = { version: loaded.valueVersion }`；`ops = observedOperations(observed, change)`；`ops.length === 0` 时跳过
（「只迁移的 base 对新版本观察者什么都没变」）；否则 `observer.advance(change.value, ops, frameContext)`，
其中 `CommittedStateSource` 用 `withoutAbortSignal(context)`、watch 用原 context；同时订阅 close →
`observer.closeSession()`。

**I. `close`**（350-368）：首次调用时同步设置 `#closing`，其后依次
`Promise.resolve().then(() => this.beforeClose())` → `#enqueue(async () => { #commitListeners.clear();
#documents.clear(); await #storage.close(cleanup) })`（`cleanup = withoutAbortSignal(context)`）；
同一同步块里取 `[...#closeListeners]`、清空并逐个调用；返回 `awaitWithContext(#closing, context)`
（等 close 的调用方仍可被取消，但 close 继续）。

**J. `#enqueue`**（529-536）：`run = #tail.then(job)`；`#tail = run.then(() => undefined, () => undefined)`——
链尾永远吞错，一次失败不会卡死后续作业。

**K. `observedOperations`**（556-564）：

```text
change.value === null                → [["r", null]]         // 退役：根替换 null
change.version === observed.version  → change.ops            // 同形状：原始 op 批次
否则                                  → [["r", change.value]]  // 观察者持旧形状：整值根替换，并更新 observed.version
```

#### 关键代码

```ts
// src/session/session.ts:404-443（方法在 444 行以 `}` 结束）
	async #runCommit<T>(
		change: (tx: Transaction) => T | Promise<T>,
		context: Context,
		scope?: TransactionScope,
	): Promise<T> {
		this.#assertHealthy();                                    // poisoned Session 一律拒绝
		context.abortSignal?.throwIfAborted();                     // 准入前仍可被调用方取消
		const tx = new Transaction(this.#host, context, scope);
		let result: T;
		try {
			result = await change(tx);
		} catch (error) {
			await tx.settleFailure();                              // 回调失败：seal + abort + 排空 pending
			throw error;
		}
		const writes = await tx.settleSuccess();                   // seal + 同步 prepare + 组装
		if (writes.length === 0) {
			tx.discard();                                          // 空批次：不提交、不发布，但仍返回回调结果
			return result;
		}
		let seq: Seq;
		try {
			// Once admitted, caller cancellation does not interrupt Storage settlement.
			seq = await this.#storage.commit(writes, withoutAbortSignal(context));   // 准入后不可中断
		} catch (error) {
			tx.discard();
			// Callback errors never reach this branch; StorageRejected alone guarantees that no batch effect committed.
			if (!(error instanceof StorageRejected)) this.#poison = { error };       // 不确定失败 → poison，必须重开
			throw error;
		}
		let documents: DocumentCommitChange[];
		try {
			documents = tx.adopt(seq);                             // 指针交换 + 描述发布（同步、无 IO）
		} catch (error) {
			// Storage already committed; a failed adoption leaves memory behind durable state.
			this.#poison = { error };
			throw error;
		}
		this.#publish(seq, writes, documents, context);             // 在 line 上同步通知 commit 订阅者
		return result;
	}
```

#### 不变式与边界

- **只可见已提交状态**：tracker 缓存只有两处写入——`#loadDocument`（读存储后）与 `transaction.adopt()` 的
  `#host.install`（存储提交成功后）；因此 `snapshot()` 返回的 revision 一定是已提交值（1.2 节的第 3 条不变式）。
- **串行化**：所有 commit / `readOnLine` / close 的存储关闭都走 `#enqueue`，`#tail` 吞错保证链不断；同一时刻 line 上只有
  一个作业，因此「prepare → Storage 结算 → adopt → 发布」之间没有其它提交插入（见 1.2 节的第 7 条不变式与 2.2 节）。
- **零写入提交**：回调成功但 `writes.length === 0`（只读、或文档变更产生空 op 批次）时 `discard()` 撤销 prepared
  change，不产生 `Seq`、不产生 publication，但回调结果照常返回。
- **失败分类**：只有 `StorageRejected` 表示「确定没有效果」，Session 可继续；其它存储错误与 adopt 错误都置
  `#poison`，此后任何操作抛 `Session is poisoned by a failed commit after storage admission; reopen it`。
  回调阶段（prepare / 校验 / checkpoint）的失败发生在存储准入之前，正常回滚。
- **缓存与版本**：`LoadedDocument.valueVersion` 是 tracker 值形状对应的 definition 版本，`storedVersion` 是存储里的版本
  （可能更旧，说明只做了内存迁移）。访问其它版本的 token 会删掉缓存条目并重新加载，因此缓存里同时只有一个版本。
- **观察语义**：commit / close 监听器在 line 上同步执行；文档 state 帧与 watch 回调在线外 microtask 投递
  （见 4.2.4 节）。`observedOperations` 的三条规则见流程 K。
- **关闭语义**：`#closing` 一旦设置，新的 `commit` / `snapshot` / `watchDoc` / `documentState` / `snapshotAsOf` 同步抛
  `Session is closed`；**已排队的提交仍会结算**（close 的关闭作业排在它们之后）。`close()` 幂等；等待 close 时的取消
  不会重新打开准入。`beforeClose()` 必须不 reject，且只能做「封准入后仍需完成」的收尾（Harness 用它 join 任务调用）。
- `conversationCreated()` 在每个创建或 fork 会话的事务里被调用，必须只用同一个 `Transaction` 工作。
- `unloadDocuments()` 让所有 tracker 一起失效；之后访问从存储冷加载——这是测试「缓存不是真相来源」的手段。
- `cancellationError(signal)`（566-568）：优先用 `signal.reason`（若是 `Error`），否则造
  `DOMException("The operation was aborted", "AbortError")`。
- `[待核]:` `snapshot()` 的缓存快路径不在 line 上，是否与「line 内一致读」等价只能由「缓存只在 adopt 后更新」
  推断，源码没有额外注释背书。

#### 相关测试

- `test/session-documents.test.ts:78-107`：首次访问产生 `document.create` + base；发布的 `record.createdAt === seq`；
  `published.value` 与 `snapshot` 同一引用；admitted 写里的 base 与发布值是同一对象。
- `test/session-documents.test.ts:137-156`：adopt 是指针交换——发布的 op 载荷与 snapshot 子树同引用。
- `test/session-documents.test.ts:174-205`：空批次不写不发布；非空结构 no-op 仍写 delta 并发布。
- `test/session-documents.test.ts:207-264`：逃逸 draft 在 settle 后读写都抛；回调失败 abort 全部 change；
  并发重复获取只 init / mint 一次。
- `test/session-documents.test.ts:284-361`：回调成功但有 pending acquisition → 抛 “pending Tx operations”，line 保持到
  迟到操作结算，之后该 Tx 抛 “Transaction has settled”；迟到且缺省的获取不会 init / mint；回调抛错时以回调错误为准。
- `test/session-documents.test.ts:405-457`：装配失败回滚全部 prepared 文档；普通存储错误 poison 且不发布。
- `test/session-documents.test.ts:459-477`：存储结算期间旧 revision 保持不变。
- `test/session-documents.test.ts:605-655`：`subscribeCommits` 同步送达同一 context；`subscribeClose` 同步调用且
  unsubscribe 生效；close 时已准入提交先结算、之后准入被拒、close 之后 storage 读失败。
- `test/session-watches.test.ts`（全篇 24 例）与 `test/session-states.test.ts`（全篇 10 例）：`watchDoc` /
  `documentState` 的全部行为。
- `test/session-checkpoints-migrations.test.ts:647-772`：`snapshotAsOf` 按 entry 提交点与 fork ancestry 选祖先会话与
  incarnation；跨 fork 不可见 entry 抛 “not visible”；create / retire / recreate 之间选出当时活着的 incarnation；
  close 后抛 “closed”。
- Harness 侧调用点：`src/harness/harness.ts:97`、`:107`、`:120`、`:138`、`:195`、`:243`、`:249`、`:286`、`:314`、`:334`；
  `src/harness/scheduler.ts:235`、`:275`、`:300`、`:327`、`:448`、`:702`、`:942`、`:1126`、`:1134`、`:1163`、`:1196`；
  `src/harness/submissions.ts:56`、`:65`、`:70`、`:78`、`:91`；`src/harness/view.ts:140`、`:164`；
  `src/harness/task-graph.ts:115`；`src/harness/context.ts:49`。

### 4.2.2 src/session/transaction.ts

一次 commit 回调的事务实现（`class Transaction implements Tx`）。它维护表读/表写规则，把 conversation / entry / task /
submission 的候选记录与文档的 draft / change / prepared 状态收集成一个原子 `StorageWrite[]`，并在存储成功后执行
**adopt**（指针交换 + 缓存更新）与发布描述。它是唯一同时了解「Chord draft 生命周期」与「Storage 批次形状」的地方，
也是 fork 文档复制的接入点（调用 `forks.ts`，见 4.2.3 节）。

#### 导出面

- `type LoadedDocument`（86-96）= `{ readonly addressId: string; readonly record: DocumentRecord; storedVersion: number;
  readonly valueVersion: number; deltasSinceBase: number; readonly tracker: Tracker<JsonObject> }`。
  `storedVersion` 是持久化的 definition 版本（值只做内存迁移时更旧），`valueVersion` 是 tracker 值形状对应的版本，
  `deltasSinceBase` 由 adopt 推进，使下一次 `checkpointWhen` 判定无需读存储。
- `interface TransactionHost`（99-116）—— Transaction 需要的 Session 服务：`storage`、`cached(addressId)`、
  `load(definition, addressId, address, context)`、`install(document)`、`evict(addressId, recordId)`、
  `conversationCreated(tx, record)`（含义见 4.2.1 节）。
- `type TransactionScope = { readonly conversationId?: ConversationId; readonly taskId?: TaskId }`（126-130）——
  提交绑定的默认：`tx.createTask()` 的目标会话与 appended entry 的 `byTaskId`。
- `class Transaction implements Tx`（192）—— 方法（行号为实现位置）：
  - 表读：`conversation(id)`（227-229）、`entry(id)` / `entry(token, id)`（231-240，后者按 kind 过滤）、`task(id)`（242-244）、
    `scanConversations(query, limit, cursor?)`（246-250）、`scanEntries(...)`（252-254）、
    `latestHeadMarker(conversationId)`（256-260）、`scanTasks(...)`（262-264）、`submission(id)`（267-269，内部）、
    `submissionByRequest(conversationId, requestId)`（272-276）。
  - 表写：`createConversation({ ownership })`（280-282）、`createRootConversation()`（285-287，内部，保留 root 身份）、
    `forkConversation(parentConversationId, at, { ownership })`（289-297）、`appendEntry(…)`（343-379）、
    `createTask(task, input, options)`（381-424）、`createSubmission(create)`（427-437）、
    `settleSubmission(id, settlement)`（443-447）、`placeSubmission(id, entry)`（450-454）、`setTask(value)`（457-472，内部）。
  - 内部视图：`stagedTasks()`（475-479）、`stagedConversations()`（482-486），供 scheduler 构建 task graph。
  - 文档：`doc(...)` 六个重载（489-508，实现 509-538）、`retireDoc(...)` 六个重载（540-553，实现 554-583）。
  - 结算：`settleFailure()`（662-666）、`settleSuccess()`（672-689）、`discard()`（692-694）、
    `adopt(seq: Seq): DocumentCommitChange[]`（697-751）。
- 模块级（未导出）：`type SubmissionChange`（61）、`applySubmissionChange(current, change)`（67-79）、
  `INTERNAL_SCAN_PAGE_SIZE = 256`（81）、`EMPTY_OPERATIONS`（82）、`TABLE_JSON_COPY_OPTIONS`（83）、
  `type TransactionTask`（119-123）、`type DocumentTarget`（133-146）、`type DocumentEntry`（149-161）、
  `type DocumentPlan`（167-184）、`planDocument(document)`（968-1015）、`publishes(plan)`（1021-1023）。

#### 关键流程

**内部表**（193-217 行）——每个表维护什么：

```text
#pendingOperations: Set<Promise>    回调发起过的每个异步操作；settlement 要求为空，否则拒绝整笔提交
#sealed                            settle 后为 true；此后一切 Tx 操作抛 “Transaction has settled”
#hasTableWrite                     第一次表写后为 true → 之后的表读抛 ReadAfterWrite
#writes: StorageWrite[]            原子批次：conversation / entry 立即入队，task / submission / document 装配阶段追加
#createdConversationIds            本事务创建或 fork 的会话（#requireConversation 短路 + scope 校验）
#forkSourceConversationIds         fork 源会话（禁止在同事务改它 fork:"current" 的文档）
#forkSourceDocumentIds             fork 复制的源文档 incarnation（禁止在同事务写/退役它们）
#tasksById: Map<TaskId, TransactionTask>   每个被读/写/作为文档 owner 的任务：
                                    { committedRead?: Promise, write?: {kind:"create"|"replace", record},
                                      publicationConversationId? }
#submissions                      本事务创建或改过的 submission 最新候选
#submissionChanges                按调用顺序的 settle/place 记录，装配阶段对最新候选依次应用
#plans                            装配阶段为每个 staged document 生成的「写什么 + 发布什么」
#documents                        按 staging 顺序的全部获取/退役标记
#latestDocumentByAddress          每个逻辑地址的最新标记（决定重复获取/退役语义）
```

**一笔提交从进入回调到落盘**（跨文件视角，行号见括号）：

```text
session.commit(change, ctx)                                     // src/session/session.ts:85-87
  #enqueue(...)                                                 // 排到唯一 mutation line，串行化
  tx = new Transaction(#host, ctx, scope)                        // src/session/transaction.ts:219-223
  await change(tx)                                              // 应用回调运行期间：
    tx.conversation/entry/task/scan*  → #read → #pendingOperations  // 表读：第一次表写前才允许
    tx.createConversation/appendEntry → #write → #writes      立即入队
    tx.createTask/createSubmission    → 只登记候选（#tasksById / #submissions）
    tx.doc(token, …)                  → 获取或创建 tracker，返回可写 Draft
                                        （memoize：同地址同 draft；family 的首个 seed 生效）
    tx.retireDoc(token, …)            → 标记 retireOnCommit 或登记 retire-only 条目
    tx.settleSubmission/placeSubmission → #submissionChanges（同步返回）
  tx.settleSuccess()                                            // src/session/transaction.ts:672-689
    seal → pending 非空则拒绝 → for doc: change.prepare()        // 同步：吊销每个 draft，产出不可变 value + ops
    #assemble()                                                  // 9 步校验与组装，见下
  storage.commit(writes, withoutAbortSignal(ctx))                // src/session/session.ts:427
  tx.adopt(seq)                                                  // 指针交换 + 缓存更新 + 发布描述
  #publish(seq, writes, documents, ctx)                          // 只在 line 上通知订阅者
```

**`#assemble` 九步**（753-845）：

```text
1. plans = #documents.map(planDocument)（跳过没有 target 的条目）
2. #rejectForkSourceWrites(plans)
     plan 写/退役 fork 源文档 → “Cannot change fork source document ${id} in the fork transaction”
     在 fork 事务里改父会话 fork:"current" 文档 → “Cannot fork conversation … while changing its current-policy documents”
3. #validateOwners()：新 conversation / 新 child task 的 owner 必须存在、非 terminal/completing、非 abort-marked
4. 校验每个 task replace：已提交记录存在、非 terminal、会话不变（“Task ${id} cannot change conversations”）
5. terminal 结算 → 退役任务文档
     先把 plans 里属于 terminal 任务的文档 plan.retire = true（含本事务新建，按 DocumentId 去重）
     再对**不是本事务创建**的 terminal 任务扫 storage.scanDocuments({scope:{kind:"task",taskId}, at:"current"}, 256, …)
     把每个活着的记录变成 retire plan
6. 解析发布归属：conversation 文档取 scope.conversationId；task 文档取候选/已提交任务的 conversationId
7. 解析 submission changes：current = #submissions.get(id) ?? storage.submission(id)
     current 不存在 → “Submission ${id} does not exist”
     next = applySubmissionChange(current, change)；next !== current 时写回
8. 组装 writes 顺序：先是 #writes（conversation / entry）→ 所有 #submissions → 所有 task 写
9. 逐 plan：
     a) checkpoint 判定（“after every validation”）：仅当 content 是 delta 且 change.loaded 存在
          info = { deltasSinceBase: change.loaded.deltasSinceBase }
          change.definition?.checkpointWhen?.(prepared.value, prepared.ops, info) 为真 → delta 改写成 base
     b) plan.content 存在 → 推入 writes
     c) plan.retire → 推入 { type: "document.retire", id: plan.record.id }
```

**`#stageConversation`**（299-341）——创建与 fork 的唯一实现：

```text
1. ownerTaskId = ownership.kind === "task" ? ownership.taskId : undefined
2. id = reservedId ?? await storage.mintId<ConversationId>()；#assertOpen()
3. ownerTaskId 存在 → task = await #currentTask(ownerTaskId)（候选优先，回退已提交）
     task 不存在 → “Conversation owner task ${id} does not exist”
     owner = { conversationId: task.conversationId, taskId }
4. record = { id, ...(parent && { parent }), ...(owner && { owner }) }
5. parent 存在 → copies = await prepareForkDocumentCopies(storage, parent.conversationId, parent.at, id, ctx)
     每个 copy：copy.source.id 记入 #forkSourceDocumentIds；DocumentEntry{target:{kind:"fork-copy", record, source}}
     推入 #documents 并设 #latestDocumentByAddress
6. parent 存在 → #forkSourceConversationIds.add(parent.conversationId)
7. #createdConversationIds.add(id)；#writes.push({ type: "conversation", value: record })
8. await #host.conversationCreated(this, record)     // Harness 在这里写 LiveDoc / InboxDoc / UsageDoc / ProviderDoc / AgentDoc
9. #assertOpen()；return record
```

**`#appendEntry`**（358-379）：

```text
#write(async () => {
  await #requireConversation(conversationId)；#assertOpen()
  id = await storage.mintId<EntryId>()；#assertOpen()
  { head, ...rest } = value
  record = copyJson({ ...rest, id, conversationId,
                      head: head === "self" ? id : head,     // "self" 解析成刚分配的 entry id
                      byTaskId: this.#scope.taskId },        // 由提交 scope 盖章
                    { omitUndefinedProperties: true })       // undefined 的 head / byTaskId 被省略
  #writes.push({ type: "entry", value: record })；return record
})
```

**`createTask`**（381-424）：

```text
1. ownership.kind === "task" → owner = await #currentTask(ownership.taskId)
     owner 不存在 → “Task owner ${id} does not exist”
     options.background === true → TypeError “A child task cannot be background”
     options.conversationId 与 owner.conversationId 不同 → “A child task lives in its owner's conversation ${id}”
2. conversationId = owner?.conversationId ?? options.conversationId ?? #scope.conversationId
     undefined → TypeError “Tx.createTask() requires options.conversationId”
3. await #requireConversation(conversationId)；#assertOpen()
4. checkpoint = definition.initial(input)
5. id = await storage.mintId<TaskId<R>>()；#assertOpen()
6. record = copyJson({ id, conversationId, kind: definition.name, version: definition.version, input,
                       ...(owner && { owner: owner.id }), background: options.background ?? false,
                       abortRequested: false, state: { status: "pending", checkpoint } })
7. #tasksById.set(id, { write: { kind: "create", record } })；return id
```

`createSubmission`（427-437）：`#requireConversation` → mint `SubmissionId` → `copyJson({ ...create, id })` →
`#submissions.set(id, record)`；**不**写入 `#writes`，submission 写统一在装配阶段追加。

**`doc` 的三条获取路径**（509-538）：

```text
1. #assertOpen()；resolveAddress(definition, args)；#assertTaskDocumentsOpen(resolved)
     （task 文档：本事务已把该 task 写成 terminal 候选 → 抛 “Task ${id} is terminal”）
2. latest = #latestDocumentByAddress.get(addressId)
     latest 存在且 !retireOnCommit：
       已有 draftPromise → 直接返回（同地址同 draft）
       target 是 fork-copy → draftPromise = track(#acquireForkCopy(...))
     否则：
3. seed = definition.family === true ? copyJson(args[nextArgument]) : undefined   // 第一个 seed 获胜
4. 新建 DocumentEntry 推入 #documents，设为 #latestDocumentByAddress
5. draftPromise = track(#acquire(entry, seed, skipLoad = latest?.retireOnCommit === true))
     skipLoad：上一个 incarnation 已在同事务退役，本次必须创建新 incarnation
```

`#acquire`（585-620）：`skipLoad ? undefined : await host.load(...)`；命中已有 incarnation →
`checkRecordScope` / `checkRecordVersion(storedVersion)` → `target = {kind:"loaded"}` →
`change = tracker.beginChange()` → 返回 `change.state`（draft）。未命中 → 校验 owner 存在
（conversation 用 `#requireConversation`；task 用 `#currentTask`，不存在抛 “Task ${id} does not exist”、
terminal 抛 “Task ${id} is terminal”）→ `value = copyJson(initial(seed))` → `mintId<DocumentId>()` →
`tracker = track(value)` → `target = {kind:"created", record: documentCreate(...), version, tracker}` →
`change = tracker.beginChange()` → 返回 draft。

`#acquireForkCopy`（622-647）：读 `storage.document(source.id, source.at)`（读不到抛 “Fork source document … cannot be read”）；
校验 stored record 与 copy record 的 `scope.kind === "conversation"`、`kind`、`key`、`history`、`fork` 全一致
（否则抛 “does not match the copied record”）；`materializeDocumentValue` 在当前事务里完成迁移；把 entry 变成普通
`created` target —— 于是装配阶段写的是带最终值的 `document.create`，而不是 `document.copy`。

**`retireDoc` 四个分支**（554-583）：

```text
1. #assertOpen()；resolveAddress；latest = #latestDocumentByAddress.get(addressId)
2. latest?.retireOnCommit → 立即 resolve（幂等）
3. latest.target.kind === "fork-copy"（尚未被 typed access 替换成 created）→ checkRecordScope(target.record)；
     latest.retireOnCommit = true（该 copy 不会被写入）；resolve
4. latest.draftPromise 存在 → latest.retireOnCommit = true；
     return track(draftPromise.then(() => undefined))    // 先让最终内容落盘，再退役
5. 否则新建 DocumentEntry{ retireOnCommit: true } → #documents / #latestDocumentByAddress → #findRetirement(entry)
```

`#findRetirement`（649-657）：从缓存取 record，否则 `storage.findDocument(address, "current")`；没有则直接返回
（退役缺席地址是 no-op，不产生写入）；有则 `checkRecordScope` 并设 `target = {kind:"retire-only", record}`。

**`planDocument` 四个分支**（968-1015）：

```text
created      → content = { type:"document.create", record, content:{ version, kind:"base", value: prepared.value } }
               change = { tracker, prepared, version }（没有 loaded）
fork-copy    → content = { type:"document.copy", record, source }（没有 change；值由后端物化）
retire-only  → 只有 record，没有 content
loaded       → storedVersion < version          → document.change + base（即使 ops 为空）
               prepared.ops.length > 0         → document.change + delta
               否则                             → content 为 undefined（不写）
               change = { tracker: loaded.tracker, prepared, version, loaded, definition }
```

`publishes(plan)`（1021-1023）：`plan.retire || plan.change?.loaded === undefined || plan.content !== undefined`
——退役、创建、fork-copy、以及任何写了内容的已载入文档（含「只迁移、ops 为空」的 base）都发布；
已载入且什么都没写的不发布。

**`adopt(seq)`**（697-751）：

```text
for plan of #plans:
  committed = "createdAt" in plan.record
  record = committed ? plan.record : { ...plan.record, createdAt: seq }      // 新建：盖提交序号
  if (plan.retire) record = { ...record, retiredAt: seq }                    // 同批退役：两个序号相同（空生命周期）
  if (plan.change)
    loaded === undefined ? !plan.retire : prepared.ops.length > 0
      → tracker.adopt(prepared)（指针交换；无 diff、无 apply、无回调）
      → 否则 prepared.abort()
    loaded 存在 → storedVersion < version 时提升 storedVersion；
                  content 是 base → deltasSinceBase = 0；是 delta → ++
    loaded 不存在且 !retire → host.install({ addressId, record, storedVersion: version, valueVersion: version,
                                             deltasSinceBase: 0, tracker })
  发布：retire → host.evict + push { type:"document", value: null, version: undefined, ops: [] }
        content 是 document.copy → push { type:"document.copy", record, conversationId, source }
        publishes(plan) → ops = change.loaded === undefined ? [] : change.prepared.ops
                          push { type:"document", record, conversationId, version, value: prepared.value, ops }
```

**辅助规则**（847-964）：`#validateOwners`（853-871）在准入前用**最终候选**校验 owner；`#rejectForkSourceWrites`
（873-892）执行 fork 写入禁令；`#abortChanges`（894-896）遍历 `#documents` 调 `change?.abort()`；
`#assertOpen`（898-900）检查 `#sealed`；`#assertTaskDocumentsOpen`（902-907）检查候选任务是否 terminal；
`#track`（909-917）登记/移除 `#pendingOperations`；`#read`（919-927）与 `#write`（929-937）见下面的代码摘录；
`#requireConversation`（939-944）校验会话存在；`#taskEntry`（946-953）、`#currentTask`（955-958，候选优先）、
`#committedTask`（960-964，每个任务只读一次存储）。

#### 关键代码

```ts
// src/session/transaction.ts:659-694（settlement 三段）
	// ─── Settlement ─────────────────────────────────────────────────────────

	/** Seal after callback failure: abort every change and observe every pending operation. */
	async settleFailure(): Promise<void> {
		this.#sealed = true;                            // 之后任何 Tx 操作都抛 “Transaction has settled”
		this.#abortChanges();                           // 所有 open change 全部 abort（draft 全部 revoke）
		await Promise.allSettled(this.#pendingOperations);
	}

	/**
	 * Seal after callback success, prepare every open change, and assemble the atomic batch.
	 * Any failure aborts every change before Storage admission.
	 */
	async settleSuccess(): Promise<readonly StorageWrite[]> {
		this.#sealed = true;
		if (this.#pendingOperations.size > 0) {         // 回调返回时仍有未结算的异步操作 → 拒绝整笔提交
			this.#abortChanges();
			await Promise.allSettled(this.#pendingOperations);   // 先把它们排空，避免悬空写入
			throw new Error("Session commit callback settled before its pending Tx operations");
		}
		try {
			// Synchronously prepare every open change; this revokes every draft.
			for (const document of this.#documents) {
				if (document.change !== undefined) document.prepared = document.change.prepare();
			}                                           // 同步 prepare：立刻吊销所有 draft，产出不可变 prepared
			return await this.#assemble();               // 组装原子批次（可能 await storage；此时尚未准入）
		} catch (error) {
			this.#abortChanges();                        // 装配失败：存储还没被调用，全部回滚
			throw error;
		}
	}

	/** Abort every prepared change after Storage failure or when no write is required. */
	discard(): void {
		this.#abortChanges();
	}
```

```ts
// src/session/transaction.ts:919-937（表读/表写规则与 pending 追踪）
	#read<T>(method: string, read: () => Promise<T>): Promise<T> {
		try {
			this.#assertOpen();                               // settle 之后读也拒绝
			if (this.#hasTableWrite) throw new ReadAfterWrite(method);   // 第一次表写之后所有表读抛错
			return this.#track(read());                       // 登记进 #pendingOperations，settlement 时检查
		} catch (error) {
			return Promise.reject(error);                     // 同步错误转成 rejected promise（Tx 全是异步签名）
		}
	}

	#write<T>(write: () => Promise<T>): Promise<T> {
		try {
			this.#assertOpen();
			this.#hasTableWrite = true;                       // 立即置位：后续表读一律 ReadAfterWrite
			return this.#track(write());                      // 同样被追踪：未结算的创建会让整笔提交失败
		} catch (error) {
			return Promise.reject(error);
		}
	}
```

#### 不变式与边界

- **表规则**：`#read` 覆盖 `conversation` / `entry` / `task` / 四种 scan / `latestHeadMarker` / `submission` /
  `submissionByRequest`；`#write` 覆盖 `createConversation` / `forkConversation` / `appendEntry` / `createTask` /
  `createSubmission`。文档 `doc()` / `retireDoc()` **不走 `#read`**，所以表写之后仍可用；同步的 `settleSubmission` /
  `placeSubmission` / `setTask` 也会置 `#hasTableWrite`（`test/session-tables.test.ts:121-130` 用 `setTask` 证明）。
- **创建方法不读回**：创建方法直接返回记录或 ID；`createTask` 只返回 `TaskId`；`Tx.task()` 只返回**已提交**记录，
  看不到本事务候选，候选通过内部 `#currentTask` 读取。
- **id 分配**：`#stageConversation` / `#appendEntry` / `createTask` / `createSubmission` / `#acquire` 都在 mint 前后各
  `#assertOpen()` 一次，`#acquire` 在每次 await 后重新检查（585-611）；sealed 事务不再产生新 ID 或新记录。
  entry 的 `head: "self"` 在 mint 之后才解析成刚分配的 entry ID。
- **游标分页语义**：Tx 的扫描只是把调用方的 `limit` / `cursor` 原样透传给 Storage，`Page.next` 由后端提供，
  调用方只能把它回传给同一个 scan；内核内部扫描固定用 256/页（`INTERNAL_SCAN_PAGE_SIZE`，81 行）并循环
  `page.next` 直到结束——terminal 任务文档退役扫描（789-801）与 `forks.ts` 的复制扫描都是这样写的。
- **draft 与 prepared 的 all-or-nothing**：`settleSuccess` 同步 `prepare()` 每个 open change（吊销 draft）；
  装配或 checkpoint 失败 → 全部 `abort()`；存储失败 → `discard()`；成功 → `adopt()` 指针交换。
- **空批次与非空 no-op**：同版本、同 tracker 且 `prepared.ops.length === 0` 的已载入文档不写不发布；
  op 非空的结构 no-op 仍写 delta 并发布；创建与「版本迁移必需的 base」即使 ops 为空也写 base。
- **checkpoint 判定只跑一次、只对 delta、只在全部校验之后**：条件为
  `plan.content?.type === "document.change" && plan.content.content.kind === "delta" && change?.loaded`；
  调用形状 `checkpointWhen(prepared.value, prepared.ops, { deltasSinceBase })`。`deltasSinceBase` 不含本次变更，
  由 adopt 维护（base → 0，delta → +1）。判定抛错 → 整笔回滚。
- **owner 双重校验**：创建时用 `#currentTask` 快速失败，`#validateOwners()` 在准入前对最终候选再判一次
  （存在 / 非 terminal / 非 completing / 非 abort-marked）——一条提交不可能在终结自己的同时创建新的 owned 工作。
- **任务会话不可变**：`setTask` 与装配校验都拒绝改 `conversationId`；terminal 候选再次 `setTask` 抛
  “already has a terminal candidate”；装配时若已提交记录 terminal 抛 “Task ${id} is already terminal”。
- **terminal 结算退役任务文档**：包括本事务新建的（同批 `document.create` + `document.retire`，空生命周期）。
  terminal 候选之后 `tx.doc(TaskDoc, taskId)` 抛 “Task ${id} is terminal”；已获取的 draft 仍可修改，最终内容先落盘再退役。
- **fork 事务的写入禁令**：禁止写/退役 `#forkSourceDocumentIds` 中的任何源文档，也禁止 fork 父会话的同时改它
  `fork:"current"` 的文档（current copy 的源必须唯一确定）。
- **submission 状态机在运行时收口**（`applySubmissionChange`，67-79）：已 settled 的记录不变；placement 只对 `queued`
  合法（否则 “is not queued”），input → `placed`、write → `done`；settlement 的 `done` 只对 `placed` input 合法
  （否则 “is not a placed input”）。
- **发布形状**：创建/退役的 `ops` 是 `[]`；已载入文档发布的就是写进存储的同一批 op 对象，可直接 `applyImmutable`
  重放；fork copy 只发布元数据，不带值。
- `[待核]:` `adopt()` 的分支条件 `loaded === undefined ? !plan.retire : prepared.ops.length > 0`（707 行）对
  「已载入、prepared.ops 非空但 plan.retire 为真」的组合会执行指针交换；无法从源码证明该组合不可达，测试只覆盖
  「先写后退役」与「先退役后重建」两条路径。
- `[待核]:` `settleSubmission` 的 `copyJson(settlement)` 未带 `omitUndefinedProperties`，与
  `applySubmissionChange` 的 `{ ...current, ...change }` 合并叠加后，`detail: undefined` 是否会清掉已有字段取决于
  Chord `copyJson` 的默认行为（影响极小）。

#### 相关测试

- `test/session-tables.test.ts`（全篇）：表读只能发生在第一次表写之前（82-102）；limit / cursor 透传（104-119）；
  同步 `setTask` 视为第一次表写（121-130）；一次提交创建会话/entry/task 的 ID 唯一性、`head: "self"`、
  `createTask` 缺 conversationId 抛错、appendEntry 到不存在会话抛错（132-186）；同事务 staged task 作为新会话 owner
  （188-211）；owner 的 missing / terminal / abort-marked / 会话变更四种原子拒绝（213-301）；表 JSON 所有权转移与
  `undefined` 省略、非严格 JSON 拒绝（303-328）；`setTask` 完整替换（330-352）；同事务创建 task 再写 task 文档
  （不触发 `ReadAfterWrite`，发布带从 task 推导的 conversationId，354-385）；terminal 候选之后拒绝 task 文档与重复
  setTask（387-403）；terminal 结算退役任务文档的精确批次 1 create + 3 retire（405-449）；文档 owner 校验（451-459）。
- `test/session-checkpoints-migrations.test.ts:19-329`：checkpoint 选择（receiver 语义 20-40；predicate 只对非空普通批次
  调用 42-110；`deltasSinceBase` 计数含 unload 与版本 base 112-158；空批次不调用、结构 no-op 调用 160-194；predicate
  抛错整笔回滚 196-250；连续 delta 尾 252-277；根替换仍是 delta 279-304；退役前仍走普通 checkpoint 选择 306-329）。
- `test/session-forks.test.ts`（全篇）：fork copy 策略、ancestry 选择、stored version 复制、override 合并、incarnation
  选择、不可见 fork 点、重复选择、源写禁令、装配失败回滚、`StorageRejected` 回滚、copy 退役重建、scope 过滤、
  跨页 260 个 family 成员。
- `test/session-documents.test.ts:479-603`：退役与重建的四种组合（含退役与 pending acquisition 竞争、缺席地址退役 no-op、
  重建后重新加载）。
- `test/session-states.test.ts:143-168`、`test/session-watches.test.ts:353-364`：未被 typed access 的 fork copy 在获取时
  才读存储（`storage.documentReadCount` 断言），即「unaccessed copy 只在内存里留 descriptor」。

### 4.2.3 src/session/forks.ts

为一次 conversation fork 选出**要复制的全部 conversation 文档**，产出 definition-free 的复制清单（child 的
`DocumentCreate` + 源 incarnation / 提交点）。真正的值物化交给 Storage 的 `document.copy` 命令；Session 只负责选源、
分配新 `DocumentId`、保证 child 地址不冲突。函数在创建/fork 事务中被 `src/session/transaction.ts:322` 调用。

#### 导出面

- `type ForkDocumentCopy = { readonly record: DocumentCreate; readonly source: DocumentCopySource }`（20-23）——
  *record*：child 的新 incarnation（不含 `createdAt`/`retiredAt`）；*source*：`{ id: DocumentId; at: DocumentPoint }`，
  指父侧被复制的 incarnation 与该点。
- `prepareForkDocumentCopies(storage: Storage, parentConversationId: ConversationId, at: EntryId,
  childConversationId: ConversationId, context: Context): Promise<readonly ForkDocumentCopy[]>`（26-59）——
  *parentConversationId* / *at*：fork 的父会话与被 fork 的可见 entry；*childConversationId*：已分配 ID 的子会话；
  *返回*：按「先 as-of 后 current」顺序排列的清单（可能为空）。
  抛出：`Entry ${at} is not visible from conversation ${parentConversationId}`（33-34）；child 地址冲突时
  `Fork selects multiple source documents for ${member}`（89-90）。
- 未导出：`SCAN_PAGE_SIZE = 256`（15）、`type ForkPolicy = "asOf" | "current"`（17）、
  `collectCopies(storage, scope, at, policy, childConversationId, copies, copiedAddresses, context)`（61-97）。

#### 关键流程

```text
prepareForkDocumentCopies(storage, parentId, at, childId, ctx)
1. entry = storage.entry(parentId, at)            // 可见性检查：entry 必须在该会话 ancestry 内可见
     undefined → 抛 “Entry ${at} is not visible from conversation ${parentId}”
2. collectCopies(scope = { kind:"conversation", conversationId: entry.entry.conversationId },   // entry 所属（可能是祖先）
                 at = entry.commitSeq, policy = "asOf")
     ← as-of copy 取「E 所在提交结束时」的状态，源是**拥有该 entry 的会话**
3. collectCopies(scope = { kind:"conversation", conversationId: parentId },
                 at = "current", policy = "current")
     ← current copy 取「fork 提交运行时」直接父会话的当前状态
4. return copies

collectCopies(...)
5. do { page = storage.scanDocuments({ scope, at }, SCAN_PAGE_SIZE, cursor, ctx) } while (page.next !== undefined)
6. for source of page.items：
     跳过 scope.kind !== "conversation"；跳过 source.fork !== policy（"initial" 永不复制）
     id = await storage.mintId<DocumentId>()               // 每个 copy 一个新 incarnation
     identity = { id, kind: source.kind, ...(key && { key }),
                  scope: { kind:"conversation", conversationId: childId } }
     record = { ...identity, history: source.history, fork: source.fork }   // 保留源的两项语义
     copyAddress = addressId(record)
     copiedAddresses 已有 → 抛 “Fork selects multiple source documents for ${kind}[/${key}]”
     copies.push({ record, source: { id: source.id, at } })                 // 值由 Storage 在 document.copy 时物化
```

#### 关键代码

```ts
// src/session/forks.ts:61-97
async function collectCopies(
	storage: Storage,
	scope: Extract<DocumentRecord["scope"], { readonly kind: "conversation" }>,
	at: DocumentPoint,                       // as-of 时是 entry 所在提交的 Seq；current 时是字面量 "current"
	policy: ForkPolicy,                      // 只复制这个 fork 策略的文档
	childConversationId: ConversationId,
	copies: ForkDocumentCopy[],
	copiedAddresses: Set<string>,            // child 侧逻辑地址，用于查重
	context: Context,
): Promise<void> {
	let cursor: Cursor | undefined;
	do {
		const page = await storage.scanDocuments({ scope, at }, SCAN_PAGE_SIZE, cursor, context);   // 256/页
		for (const source of page.items) {
			if (source.scope.kind !== "conversation" || source.fork !== policy) continue;   // 只复制 conversation 文档
			const id = await storage.mintId<DocumentId>();          // 每个复制都是新的 incarnation
			const identity = {
				id,
				kind: source.kind,
				...(source.key === undefined ? {} : { key: source.key }),
				scope: { kind: "conversation" as const, conversationId: childConversationId },
			};
			const record: DocumentCreate =
				source.history === "latest"
					? { ...identity, history: "latest", fork: source.fork }        // 保留源的 history/fork
					: { ...identity, history: "rewindable", fork: source.fork };
			const copyAddress = addressId(record);
			if (copiedAddresses.has(copyAddress)) {                 // 同一 child 地址被两个源选中
				const member = record.key === undefined ? record.kind : `${record.kind}/${record.key}`;
				throw new Error(`Fork selects multiple source documents for ${member}`);
			}
			copiedAddresses.add(copyAddress);
			copies.push({ record, source: { id: source.id, at } });   // 值由 Storage 在 document.copy 时物化
		}
		cursor = page.next;
	} while (cursor !== undefined);
}
```

#### 不变式与边界

- **两次扫描、两个源**：as-of 用「entry 所属会话 + entry 的 `commitSeq`」；current 用「直接父会话 + `"current"`」。
  entry 可能在祖先会话里，所以 as-of 的源会话不一定是 `parentConversationId`（`test/session-forks.test.ts:180-229`
  用三层 fork 证明：继承 entry 取 root 的 as-of 值，current 取直接 parent 的当前值）。
- **只复制 conversation scope**：session 文档与 task 文档永不复制（`test/session-forks.test.ts:610-662`）。
- **策略过滤**：`fork: "initial"` 既不匹配 as-of 也不匹配 current，因此不产生 copy；child 首次 typed access 时才由
  definition 初始化（`test/session-forks.test.ts:101-103`）。
- **每个 copy 一个新 `DocumentId`**：扫描循环里 `mintId`；child incarnation 与父不同 ID（129-139）。
- **child 地址唯一**：`copiedAddresses` 以 `addressId(record)` 为键；两次扫描可能选中同一 child 地址（祖先里退休的
  as-of incarnation + 父里 current 的新 incarnation），此时整笔 fork 在准入前失败（412-448）。
- **不读值、不迁移**：本文件只 `scanDocuments` 拿 `DocumentRecord`，不调用 `storage.document`；值/版本由后端在
  `document.copy` 时物化，因此 fork 提交的 `documentReadCount` 不变（92-99）。只有该事务里再做 typed access 时才读一次
  源值并合并成普通 `document.create`（281-337 断言只多了 1 次 document 读）。
- **分页完整**：`do/while (cursor !== undefined)` 保证跨页取完（664-694 用 260 个 family 成员覆盖多页）。
- 抛错发生在存储准入之前（本函数在 `#stageConversation` 中被 await），因此失败 = 整笔回滚。

#### 相关测试

- `test/session-forks.test.ts:30-150`：三种 fork 策略 + family 一起复制；5 个 `document.copy`；发布的
  `createdAt === publication.seq`、`conversationId === child`、`source` 与写批次一致；child 与 parent incarnation ID 不同；
  child 独立演进；`initial` 文档在 child 首次访问时初始化。
- `test/session-forks.test.ts:152-178`：复制 fork 点所在提交的**最终**文档状态，但同一提交中 fork 点之后的 entry 不被
  继承（child 可见 entry 含 `forkAt`、不含 `excluded`）。
- `test/session-forks.test.ts:231-279`：复制「存储的值 + 存储的版本」，即使进程里有已迁移的 tracker；child 存储版本仍为 1，
  child 上再访问 v3 token 会再迁移一次（计数 1 → 2）。
- `test/session-forks.test.ts:339-381`、`412-448`、`450-501`、`503-551`、`553-579`、`581-608`、`610-694`：
  incarnation 选择、重复选择拒绝、源写禁令、装配失败回滚、`StorageRejected` 不 poison、copy 退役重建、scope 过滤、
  跨页复制。
- `test/session-states.test.ts:143-168`：definition-free fork copy 的 `documentState` 冷加载会触发一次 `storage.document` 读。

### 4.2.4 src/session/observation.ts

Session 与 `@earendil-works/chord` 之间的两种桥及其缓冲/终止语义：`CommittedStateSource`（供 `replicatedState()`
消费的 `ReplicatedStateSource`）与 `CommittedWatch`（`watchDoc` 返回的 `WatchHandle`）。两者都被「一个已提交
incarnation」一对一拥有，收到 `null` 值即视为退役。本文件还定义退役的标准操作批次 `RETIREMENT_OPERATIONS`。

#### 导出面

- `type ObservedDocumentValue = Readonly<JsonObject> | null`（12）—— 值域；`null` = 退役。
- `const RETIREMENT_OPERATIONS: readonly Op[] = [["r", null]]`（18）—— 退役的规范终态更新（Chord 根替换 null）。
- `class CommittedStateSource<T = ObservedDocumentValue> implements ReplicatedStateSource<T>`（24-76）：
  - `constructor(value: T, release: () => void)`（33-36）—— *value*：acquisition 时刻的不可变 revision；
    *release*：最后一个 attachment 释放（或会话关闭）时调用一次。
  - `attach(): ReplicatedStateSourceAttachment<T>`（38-46）—— 新建 attachment，快照携带当前 `{ value, cursor }`；
    source 已关闭时抛 `State source is closed`。
  - `advance(value: T, ops: readonly Op[], context: Context): void`（48-60）—— 应用一次已提交变更：更新值、
    `#cursor += 1`、`value === null` 时标记 retired、向所有 attachment 广播 `{ cursor, value, ops, context }`；
    已 closed / retired 时忽略。
  - `closeSession(): void`（62-66）—— dispose 所有 attachment 并完成释放。
- `class CommittedWatch<T = ObservedDocumentValue> implements WatchHandle<T>`（155-297）：
  - `constructor(value: T, detach: () => void, replace?: () => T)`（174-181）—— *value*：acquisition revision；
    *detach*：终止时取消 Session 订阅；*replace*：溢出折叠时取替换值的函数（缺省用最新值）。Session 的文档 watch
    只传前两个参数（`src/session/session.ts:288`）。
  - `get value(): T`（183-185）—— start 前恒为 acquisition revision，之后在交付每个帧时更新。
  - `get closed(): Promise<WatchEnd>`（187-189）。
  - `start(listener: (value: T, ops: readonly Op[], context: Context) => Promise<void>): void`（191-197）——
    安装唯一 listener；重复 start 抛 `Watch is already started`，已终止抛 `Watch is stopped`；**绝不内联调用**。
  - `stop(): Promise<WatchEnd>`（199-202）—— 终止为 `{ reason: "stopped" }` 并返回同一个 `closed` promise（幂等）。
  - `observeCancellation(signal: AbortSignal): void`（204-211）—— 重复安装抛 `Watch cancellation is already installed`；
    已终止则忽略；signal 已 aborted 时立即 `cancel()`。
  - `cancel(): void`（213-215）→ `{ reason: "cancelled" }`；`closeSession(): void`（217-219）→ `{ reason: "session_closed" }`。
  - `advance(value, ops, context): void`（221-232）—— 缓冲一帧；溢出（≥100 帧）时折叠成单个根替换帧；
    已终止或 retired 时忽略；`value === null` 时标记 retired。
- 未导出：`MAX_PENDING_WATCH_FRAMES = 100`（15）、`class SessionSourceAttachment<T>`（78-143）、`toError(error)`（299-301）。

#### 关键流程

state 侧（`CommittedStateSource` + 内部 `SessionSourceAttachment`）：

```text
CommittedStateSource                       // 一个已提交 incarnation（或一个 conversation view）一个实例
  #attachments: Set<attachment>            // 每次 replicatedState()/挂载 一个 attachment
  #value / #cursor / #retired / #closed
  attach()      → attachment 拿 { value, cursor } 快照；release 在最后一个 attachment 释放时执行一次
  advance()     → #value = value；#cursor += 1；同步向所有 attachment 广播 frame
  closeSession()→ dispose 所有 attachment → release

SessionSourceAttachment                    // 每个 attachment 独立缓冲与交付
  snapshot      = { value, cursor }        // 交给 Chord 的增量基线
  activate(l)   → 记录 listener 并立即 #drain()（按序交付已缓冲帧）
  publish(f)    → push 帧；已激活且不在交付/调度中 → queueMicrotask 调度 #drain
  #drain()      → while 有帧：listener(frame)；listener 抛错 → dispose()（只影响该 attachment）
  dispose()     → 清空帧与 listener，release 一次
  （注意：state 侧缓冲没有帧数上限）
```

watch 侧（`CommittedWatch`）：

```text
start() 之前：advance() 只缓冲（start 后按序交付，不丢帧、不内联）
start() 之后：advance() 缓冲 + #schedule()（microtask）
#drain()：串行交付
  while (#end === undefined) {
    frame = #pending.shift()；空 → break
    #value = frame.value                                  // watch.value 在交付瞬间等于 listener 收到的值
    await listener(frame.value, frame.ops, withoutAbortSignal(frame.context))   // 交付上下文不继承生产者取消
    抛错 → #terminate({ reason: "listener_error", error })
    frame.value === null → #terminate({ reason: "retired" })
  }
  finally：仍有 pending → 再调度；尝试 resolve closed
溢出：push 前 #pending.length >= 100 → 清空并只保留一帧 { value: replace?.() ?? value, ops: [["r", replacement]] }
终止：#terminate(end) → 记录 end、detach（取消 Session 订阅）、清空 pending、resolve closed promise；
     在途 listener 调用不被 join（调用方自己拥有）
```

#### 关键代码

```ts
// src/session/observation.ts:243-273
	async #drain(): Promise<void> {
		if (this.#running || this.#end !== undefined || !this.#started) {
			this.#finishIfReady();
			return;
		}
		this.#running = true;
		try {
			while (this.#end === undefined) {
				const frame = this.#pending.shift();          // 严格按提交顺序取帧
				if (frame === undefined) break;
				this.#value = frame.value;                    // 交付前更新 watch.value
				const deliveryContext = withoutAbortSignal(frame.context);   // 保留 context 值，剥离生产者取消
				try {
					await this.#listener!(frame.value, frame.ops, deliveryContext);   // 串行：不并发调用
				} catch (error) {
					if (this.#end === undefined) {
						this.#terminate({ reason: "listener_error", error: toError(error) });   // 只终止这个 watch
					}
					break;
				}
				if (frame.value === null) {
					this.#terminate({ reason: "retired" });   // 退役帧交付后即关闭
					break;
				}
			}
		} finally {
			this.#running = false;
			if (this.#end === undefined && this.#pending.length > 0) this.#schedule();   // 交付期间又来了帧 → 继续
			this.#finishIfReady();
		}
	}
```

#### 不变式与边界

- **cursor 语义**：`CommittedStateSource.#cursor` 从 0 开始，每次 `advance()` 加 1；attachment 的 `snapshot.cursor`
  是起点。测试断言投递序列为 `[0, 1, 2]`（acquisition 帧 + 两次提交，`test/session-states.test.ts:40-60`）。
  它是 source 自己的帧号，不是 `Seq`。
- **退役是 `null`**：`advance(null, …)` 标记 retired（之后忽略全部后续帧），watch 交付该帧后以 `"retired"` 关闭；
  state 侧广播 `[["r", null]]`；**重建的 incarnation 不会被旧 watch/state 跟随**（它们按 `record.id` 过滤）。
- **溢出折叠**：阈值 100，折叠只保留一帧根替换（`ops = [["r", replacement]]`）。101 个缓冲提交 → 1 次交付
  （`test/session-watches.test.ts:142-157`）；在途 1 帧 + 101 个后续提交 → 2 次交付（159-187）；100 个提交 + 退役 →
  折叠成退役帧并关闭（189-204）。
- **串行且不重入**：`#running` 保证同一 watch 的回调不并发（83-116 统计 `maxActive === 1`）；回调期间的帧只缓冲。
- **start 不内联**：`start()` 永不直接调用 listener；测试用 `inline = false` 断言首次交付在微任务之后，且
  `watch.value` 在交付前保持 acquisition revision（48-81）。
- **交付上下文**：帧的 context 来自提交时（自定义 key 可见），但 abortSignal 被剥离（229-258）。
- **终止幂等**：`#terminate` 只认第一次；`stop()` 重复调用返回同一 promise；已停止的 watch `start()` 抛
  `Watch is stopped`，重复 `start()` 抛 `Watch is already started`（338-351）。
- **会话关闭**：`closeSession()` 以 `"session_closed"` 终止；**已缓冲未交付的帧（含退役帧）被丢弃**
  （304-313 断言 `watch.value` 保持基线、随后 `start()` 抛 `stopped`）；在途回调不被 join（315-336、388-407）。
- **listener 错误隔离**：某个 watch 的 listener 抛错只终止它自己为 `listener_error`，其它 watch 照常交付（409-429）。
- **release 恰好一次**：`#finishDisposal` 与 `dispose()` 都用「取走再调用」的写法保证幂等；source 关闭后 `attach()` 抛
  `State source is closed`。
- 桥传递的是已 adopt 的不可变 revision 与 Chord op 批次**原对象**，不做拷贝；测试断言 state/watch 收到的 `ops` 与
  publication 的 `ops` 同一引用、值可 `applyImmutable` 重放（`test/session-states.test.ts:84-100`、
  `test/session-watches.test.ts:467-483`）。
- `[待核]:` `SessionSourceAttachment` 的帧缓冲没有上限，背压/丢弃策略取决于 Chord `replicatedState` 消费端；
  本次未读 `@earendil-works/chord`，无法判断未消费帧是否会无界增长。
- `[待核]:` `CommittedWatch` 的 `replace` 参数在 `src/session/session.ts:288` 未传，是否存在其它调用点
  （例如 `src/harness/view.ts` 的 conversation view 挂载）会传入，需读该文件确认。

#### 相关测试

- `test/session-states.test.ts`（全篇）：`31-38` 永不创建缺席文档（不写、不 mint）；`40-60` 立即水合 + 连续 cursor；
  `62-82` 同一 incarnation 的多个独立 state；`84-100` 与 Chord 共享精确值/op 引用；`102-114` 迟到基线不重投已覆盖提交；
  `116-141` 退役发布 `[["r", null]]` 且不跟随重建；`143-168` fork copy 冷加载；`170-203` 迁移水合不写、等值版本 base 被
  跳过；`205-221` 缓存卸载后从精确已提交值继续；`223-231` 共享不可变值**不冻结**。
- `test/session-watches.test.ts`（全篇 24 例）：见上面各条不变式对应的行号。
- `test/session-checkpoints-migrations.test.ts:376-438`：观察旧形状的 watch 在「迁移-only base」上收到根替换
  `[["r", value]]`，观察新形状的 watch 什么都不收（`observedOperations` + `ops.length === 0` 跳过共同作用）。
- `test/session-checkpoints-migrations.test.ts:810-831`：旧 token 的 state/watch 在更近 token 写入后收到 `[["r", …]]`。

---

## 4.3 harness/ 核心

### 4.3.1 src/harness/scheduler.ts

`src/harness/scheduler.ts` 是 Harness 里唯一**决定并写入任务状态**的组件。它把「持久任务记录」（Task record）与「进程内的一次执行」（invocation）分开：记录活在 Session 的提交线上，执行活在线的外面。调度器的全部职责可以概括成三件事：挑选可跑任务、按 phase 驱动 runtime、在提交线内把结果结算成终态或 `waiting`/`completing`。

#### 导出面

本文件导出四个符号，全部是给 `harness.ts` 使用的：

- `export type SchedulerOutcome`（`src/harness/scheduler.ts:106`）：`Extract<TaskOutcome<JsonValue>, { status: "faulted" | "orphaned" }>`。它是「调度器自己写的终态」——不运行任何任务代码就落盘的两种结局。其他终态（`completed`/`failed`/`cancelled`）必须由 runtime 通过 `commit()` 给出。
- `export type InvocationBinding`（`src/harness/scheduler.ts:109`）：`{ readonly signal: AbortSignal; check(): void }`。一个 conversation handle 绑定的 invocation：`signal` 用于传播取消，`check()` 在 invocation 结束后抛错，防止 handle 被继续使用。
- `export type TaskSchedulerOptions`（`src/harness/scheduler.ts:132-157`）：构造 `TaskScheduler` 的全部依赖。逐项含义：
  - `session: SessionImpl`（135）：提交线与 `commitWith`/`readOnLine` 的来源。
  - `storage: Storage`（134）：`waitForTask` 在任务不在内存时直接读持久记录。
  - `registry: RegistryReader`（135）：任务定义（`TaskDefinition`）的唯一来源，且可订阅变更（`#unsubscribeRegistry`，见 234 行）。
  - `models: Models`（136）：传给 runtime 的模型集合。
  - `agent(conversationId, snapshot, context)`（137-138）：按 registry 快照解析某个 conversation 的 Agent；文档承诺「每个 phase 最多调用一次」，这也是 `Phase.agent` 缓存的原因（83-88 行）。
  - `settings()`（140）：每次访问都重新读，不做快照。
  - `env(conversationId, context)`（142）：用 `HarnessOptions.env` 构造执行环境。
  - `now()`（143）、`report(error)`（144）：时钟与错误上报。
  - `settleOutcome(tx, record, outcome)`（145-146）：当调度器自己写的结局变成终态时，在同一笔提交里做 Harness 清理。注释强调清理和结局必须在**同一笔** commit 里。
  - `withdrawInputs(tx, conversationId)`（147-148）：撤回某个 conversation 排队中的输入，用于 conversation abort 与 abort 级联。
  - `conversation(id, binding, context)`（149-154）：拿到已有 conversation 的 invocation 绑定 handle。
  - `context: Context`（155-156）：调度器自身提交与 invocation 用的 context，**不携带调用者的取消**（即调用者 abort 不会打断调度器内部流程）。
- `export class TaskScheduler`（`src/harness/scheduler.ts:174`）：见下。

#### 类的自我约束（源码里的类注释）

类注释（`src/harness/scheduler.ts:159-173`）本身就是一节可执行的规格说明，值得逐句拆开：

- `#live`（188 行）镜像**每一个已提交的非终态记录**：`pending`、`running`、`waiting`、`completing` 四种（`LIVE_STATUSES`，54 行）。同步的 commit 监听器在 Session 线上更新它，所以在线上跑的代码从 `#live` 读到的**恰好是已提交状态**，而不是某个中间态。
- 任务与 conversation 组成一棵**所有权树**（spec §5.5）：一个 task 的父节点是它的 `owner` 任务，否则是它的 conversation；conversation 的父节点是它的 owner 任务（如果有）。沿着这棵树往上走，决定三件事：级联取消的范围、空闲判定的范围、以及「一个任务的普通 owned work 是否还活着」——后者把结局**扣住为 `completing`** 并**推迟它的 abort handler**。
- 不变式：每一次任务状态转移都由**一个在 Session 线上串行执行的回调**决定并写入。覆盖范围包括 reservation、mark、runtime commit、finalization，以及每个 phase 之前的那一次同步 step（它施加优先级规则，写出 fault 或 handover）。handler 与 join 都在线外跑。invocation **在决定其结束的那一次 step 内结束**，因此它排队的 runtime commit 「要么在该决定之前落地，要么被拒绝」。

#### 核心数据结构

这些内部类型（`src/harness/scheduler.ts:40-130`）是整个文件的名词表，读完之后面的流程才有意义：

- `AnyTaskRecord`（40）：类型擦除后的任务记录。下面所有算法都在擦除类型上跑，只在真正执行时把定义/运行时的泛型还原（`ErasedDefinition`/`ErasedRuntime`/`ErasedRunningTask`，47-49）。
- `RunnableTaskRecord`（41-45）：`Extract<AnyTaskRecord, { state: { status: "pending" | "running" | "waiting" } }>`。注意它**不包含 `completing`**——一个已经定好结局、正在等 owned work 排空的任务，不可能再被当成「可跑任务」重新拉起。
- `Checkpoint`（46）：`{ readonly phase: string }`。检查点只记 phase 名；真正的数据由 runtime 自己管。
- `BlockedReason`（56-57）：`"missing_task" | "task_too_old" | "migration_failed"`。注释明确它是**推导出来的，从不持久化**：一个 pending 任务在当前 registry 快照下无法被预留的原因。
- `Resolution`（59-61）：`ready`（拿到 task 与可跑记录）或 `blocked`（带 `BlockedReason`）。注释强调「决定它不运行任何任务代码」。
- `Fit`（63-66）：某个定义能否接住这条记录；`{ task, migrates }` 或 `{ reason, error? }`。与 `Resolution` 的区别是它只回答「配不配」，不回答「跑不跑」。
- `Invocation`（68-81）：进程内的一次执行。字段：`taskId`、`conversationId`、`mode: "run" | "abort"`（同一个任务可能有两种 invocation）、`controller: AbortController`、`context: Context`（被 `controller` 取消）、`watches: Set<DocumentWatch<JsonObject>>`（invocation 结束时统一停掉）、`ended`、`done: Promise<void>`、`finish()`。
- `Phase`（83-88）：一个 phase handler 读到的视图——`snapshot()`（registry 快照）、`task()`、以及**惰性解析、被缓存的** `agent: Promise<Agent> | undefined`。
- `Reservation`（90-94）：`invocation` + `task` + `snapshot`，即「已经占住的任务 + 它绑定的快照」。
- `ReportedTask`（96-97）：按 invocation 记录「已经报告过无法接管的替代定义」，避免重复上报。
- `PhaseResult`（99-100）：刚返回的 phase 的结果，**由下一步来判定**：`checkpoint` 加可选的 `failure`。
- `Decision`（102-103）：单步决策——`true` 继续下一个 phase，`false` 结束 invocation，或 `{ fault }` 以 `faulted` 结束。
- `TaskNode`（111-112）：任务中**不可变**的所有权字段：`conversationId`、`owner`、`background`。
- `Up`（114-115）：向上走一步的落点——`{ task }` 或 `{ conversation }`。
- `Step`（117-121）：向上走一步的实际结果——带节点的 owner 任务、conversation、或**尚未加载的 owner 边**（`{ unknown: true }`）。第三种存在说明漫游允许遇到「没加载进来的边」，必须显式处理而不是当成 null。
- `Overlay`（123-127）：一笔提交里暂存的候选记录（`tasks`）与 owner 边（`edges`），在所有权漫游中**覆盖**已提交记录。没有它，同一笔提交里刚设置的 `owner` 边就看不见。
- `Scope`（129-130）：普通所有权漫游的起点——单个 conversation，或「所有无主 conversation」（`{ roots: true }`）。

#### 关键流程（一）：开启、恢复与等待

```text
scheduler.open(context)
  subscribeCommits(#observe)          // 提交线上同步更新 #live
  subscribeClose(#seal)
  registry.subscribe(#kick)           // registry 变化 → kick
  commitWith(tx):                     // 一笔提交，先读后写
    scans = for status in LIVE_STATUSES: scanAll(tx.scanTasks({status}))
    for record in scans:
      #live.set(record.id, record)
      if status == "running": tx.setTask(pending, keep checkpoint)   // 重启后 running 一律降级
      if status == "waiting" and policy == "failFast": #failFastChecks.add(id)
  #cascadePending = true               // 补齐崩溃时未应用的 abort 标记
  #scheduleReconcile()

scheduler.resume()
  #enabled = true
  #kick()                             // 幂等；closing 之后 kick 什么也不做
```

要点逐条：

1. **何时启动调度**：`open()` 只**加载**不调度；`resume()` 才是「要求进展」的入口（`src/harness/scheduler.ts:258-262`）。`open()` 在最后把 `#cascadePending` 置真并排一次 reconcile（253-255）——注释说明这是为了「推导出崩溃后遗留在被取消 owner 之下、尚未应用的 abort 标记，并结算被扣住的结局」。
2. **`open()` 的读放大是刻意的**：它先按四种 live 状态各扫一遍（`SCAN_PAGE_SIZE = 256`，51 行），**所有读都发生在第一次写之前**（236 行注释），因为 `tx.setTask` 之后同一事务里的表读语义不可靠。逐行读表换成一次 `scanTasks(status)` 是存储层的能力，不是调度器的选择。
3. **重启后 `running` 退回 `pending`**：244-246 行。这是「内存态 vs 提交态」最直接的证据：`running` 只是本进程的状态，进程死掉后没有任何东西能让它继续跑，因此重新打开时**保留 checkpoint、把状态改写成 `pending`**，等待被重新挑选。
4. `waiting` + `failFast` 的任务在 `open()` 时就被登记进 `#failFastChecks`（247-249），在线的检查点由下一次 reconcile 统一执行。
5. `join()`（264-267）只等 `#seal()` 已经发过信号的 invocation，**不写任何东西**；用 `allSettled` 是为了不因一个 invocation 失败而打断等待。
6. `waitForTask(id, context)`（298-308）在**线上**做「检查 + 登记」：如果 `#live` 有它就挂 waiter；否则直接读 storage；记录不存在则抛 `Task ${id} does not exist`。注释说明线上执行的目的是「不让某个终态发布插在检查与登记之间」——否则可能出现任务已经终结、但 waiter 还没挂上去的窗口。
7. `waitForIdle(conversationId | undefined, context)`（314-319）：先判空闲（`#idle`），空闲直接 resolve；否则排一次 reconcile 再挂 waiter。`undefined` 表示等整个 Harness。
8. `abort(id, context)`（269-296）的语义分三种情况，注释写得比代码还清楚：a) 已终态 → 返回 `"terminal"`，什么都不写（278）；b) 已经不在跑（没有 invocation）且不是 `completing`：加载 scope、检查它是否拥有还活着的 owned work，若**没有**且当前 registry 里没有任何定义能接住它，就在同一笔提交里把它写成 `orphaned`（281-288）；c) 其余情况只把 `abortRequested` 置真（290）。**`completing` 只被标记，不被结算**（272 行注释）。最后如果拿到的是 `run` 模式的 invocation，就在线外 `await` 它（293-294）。

#### 关键代码：`open()` 的状态重写（`src/harness/scheduler.ts:241-255`）

```typescript
		// 逐条记录把提交态投影进内存镜像 #live；#live 与提交态在此刻完全一致
		for (const records of scans) {
			for (const record of records) {
				this.#live.set(record.id, record);
				// running 是本进程态，重启后不可能继续存在：降级为 pending，并保留 checkpoint
				if (record.state.status === "running") {
					tx.setTask(withState(record, { status: "pending", checkpoint: record.state.checkpoint }));
				}
				// failFast 的等待组在打开时就要进入待检查集合，检查动作交给下一次 reconcile
				if (record.state.status === "waiting" && record.state.policy === "failFast") {
					this.#failFastChecks.add(record.id);
				}
			}
		}
	}, context);
	// 推导出崩溃时遗留在被取消 owner 之下、尚未应用的 abort 标记，并结算被扣住的结局
	this.#cascadePending = true;
	this.#scheduleReconcile();
```

#### 本段可证明的规则

- 状态全集是五种：`pending` / `running` / `waiting` / `completing` / `terminal`；其中只有前四种是 live（`src/harness/scheduler.ts:54`，`LIVE_STATUSES`）。
- `#live` 的内容只由「提交线」写入（`open()` 的投影 + 同步 commit 监听器），因此它是**提交态的镜像**而非调度器的私有状态。
- 只有 `pending`/`running`/`waiting` 能被 runtime 接管；`completing` 永远不重新接管（41-45）。
- `abortRequested` 是**单向标记**（290 行 `if (!current.abortRequested)`），并且只在「任务还没跑完」时有意义——它落盘、跨重启存活，由 `#cascadePending` 触发重放（253-255）。
- 「谁拥有什么」由不可变字段 `conversationId` / `owner` / `background` 决定（111-112）；`background` 是**边界**而不是标志位：普通漫游遇到它就停。
- 任何「读-判-写」都不能跨线：`waitForTask` 的检查与登记、`abort` 的判定与落盘都在 `commitWith`/`readOnLine` 内部（298-308、275-292）。

#### `abortConversation` 的收尾（承接上一段）

`abortConversation` 那一笔提交返回 `reached`（被标记的任务 id 列表）之后（`src/harness/scheduler.ts:341-344`）：

```text
	if (background) for (id of reached) await waitForTask(id)   // 跨 background 时，连它们一起等
	await waitForIdle(conversationId)                           // 最后等这个 conversation 空闲
```

注意 `background: false`（默认）时**不等**被标记的任务，只等空闲——因为普通漫游本来就会在 background 边界停下。

#### 提交线上的镜像：`#observe`

`#observe(publication)`（`src/harness/scheduler.ts:348-419`）是注册在 Session 上的同步 commit 监听器。它不写提交，只做三件事：投影 `#live`、从「新记录蕴含的意图」推导需要重算的标记、然后 `kick` 调度。逐类处理如下（`publication.changes` 里非 task 的变更会被单独扫描，见 395-406）：

```text
#observe(publication)
  for change of publication.changes where type == "task":
    record = change.value; previous = #live.get(record.id)
    if failedOutcome(record) and it just became failed: failed.push(id)
    if record.state.status == "terminal":
        #live.delete, #failedMigrations.delete, #failFastChecks.delete
        if #conversationOwners.has(id): #settled.set(id, nodeOf(record))   // 漫游要穿过它
        #taskWaiters.resolve(id, record); #scheduleReconcile()             // owner 现在可能可以结算
        continue
    if record.abortRequested and previous was not:
        #cascadePending = true
        if #invocations[id].mode == "run": controller.abort()              // 它的下一步会结束自己
    if status just became "completing":
        if cancellationIntent(record): #cascadePending = true
        #scheduleReconcile()
    if status just became "waiting" with policy "failFast":
        #failFastChecks.add(id); #scheduleReconcile()
    #live.set(id, record)
  for failed id: 扫描 #live 里所有 waiting+failFast 且 on 包含该 id 的组 → 登记检查 + 排 reconcile
  for conversation changes not loaded: #setEdge(id, owner?.taskId ?? null)
  for queued input submissions: 若链未加载 或 #belowCancelled → #cascadePending = true
  for 本段更新过的 record: 链未加载 → 排 reconcile；否则若 !background && !abortRequested && belowCancelled(parent) → cascadePending
  if #cascadePending: #scheduleReconcile()      // 提交失败的 cascade 会在下一次任意提交时重试
  if changed: #resolveIdleWaiters(); #kick()
```

值得单独指出的机制：

1. **`terminal` 记录的清理是「三删一留」**（`src/harness/scheduler.ts:358-366`）：从 `#live`、`#failedMigrations`、`#failFastChecks` 里删掉，但如果这个任务拥有某个已加载的 conversation（`#conversationOwners`），它的 `TaskNode` 要留在 `#settled` 里（362）——否则漫游走到这里就断了，无法判断「某个 waiting 任务是否还在某个已终结 owner 之下」。
2. **`abortRequested` 的上升沿是取消传播的唯一入口**（368-373）：标记落盘后，若该任务正在以 `run` 模式执行，调度器**直接 `abort()` 那个 invocation 的 controller**。注释写得很明确：真正结束 invocation 的是「它的下一步」（370），而不是监听器本身。这就是「abort 处理器不会被硬切、而是在 phase 边界以确定状态运行」的保证来源。
3. **`failFast` 的唤醒是双向登记的**：组自己进入 `waiting` 时登记（379-382），以及**成员失败时反向扫描所有组**（386-394）。反向扫描只挑 `state.on.includes(id)` 的组，因此 `allSettled` 组不会因单个成员失败被唤醒——它是靠 `on` 全空才被唤醒的（由 `#finalize`/terminal 变更推动）。
4. **queued input 会在「链未加载」时也置 `cascadePending`**（400-406）。注释说明：被取消 owner 之下的排队输入必须撤回，**即便它的级联早就跑过了**。
5. **新记录也要检查 owner 链**（407-413）：链没加载就排 reconcile，链已加载且落在被取消 owner 之下、又不是 `background`、又没标过 abort，就置 `cascadePending`。这是「在取消之后才创建出来的工作同样被取消」的落点。
6. `#observe` 结束时若确实有 task 变更，才做 `#resolveIdleWaiters()` + `#kick()`（416-418）：先同步地把「现在已经空闲」的 waiter 兑现，再把控制权交给 `#kick`。
7. `#resolveIdleWaiters()`（421-425）遍历所有 idle waiter，逐个用 `#idle(conversationId)` 判定；这是**唯一的空闲兑现点**（`waitForIdle` 自身只在入口判一次）。

#### 唤醒机制：`#scheduleReconcile` 与 `#kick` / `#drain`

两条互补的唤醒路径：

- `#scheduleReconcile()`（`src/harness/scheduler.ts:429-433`）：微任务级的**合并**。`#reconcileScheduled` 保证同一轮只排一次；`#closing` 之后不再排。它会在四处被调用：`open()` 结尾（255）、`<terminal 变更>`（365）、`waitForIdle`（317），以及 `#observe` 里的各种意图推导（377/381/391/409/415）。
- `#kick()`（675-680）：把 `#dirty` 置真，然后如果没在 drain、已 `resume()`、且没关闭，就 `#draining = true` 并 `queueMicrotask(#drain)`。676-679 行的注释是关键约束：**绝不在 commit 监听器或 registry 监听器里同步提交**，必须让出到微任务。

也就是说：`#observe` 负责「记下意图」，`#reconcile` 负责「把意图落成一笔提交」，`#kick`/`#drain` 负责「真正跑任务」。三者的分工在代码里是物理隔离的。

#### `#reconcile`：一笔提交补齐「记录里蕴含的意图」

`#reconcile()`（`src/harness/scheduler.ts:435-480`）的文档注释（435-440）就是它的规格：**一笔提交**，施加四类由已提交记录推导出的动作——被取消 owner 之下的 abort 标记（spec §5.4）、`failFast` 标记（spec §5.5）、被取消 owner 之下的排队输入撤回、以及每个普通 owned work 已消失的 `completing` 任务的终态记录。注释还强调：**持久记录就是意图**，所以这一趟同时也修复崩溃留下的未应用状态。

```text
#reconcile()
  取走并清空 #cascadePending 与 #failFastChecks（局部变量持有）
  try:
    commitWith(tx):
      if closing: return
      queued = #loadScopes(cascade)          // 加载所有 live 任务的 owner 链（+ 有排队提交的 conversation）
      for record of #live:                   // 每趟都重新推导：加载边可能暴露出新的取消 owner（457 行注释）
        if !record.background and #belowCancelled(parentOf(record)): mark(record)
      for id of checks:                      // failFast 组的兑现
        waiter = #live.get(id)
        if waiter.state.status != "waiting" or !await #anyFailed(waiter.state.on): continue
        for member of waiter.state.on:       // 失败者保留自己的结局，其余标记取消（464 行注释）
          if member 仍 live 且非 failed: mark(member)
      for id of queued: if #belowCancelled({conversation: id}): await #withdrawInputs(tx, id)
      await #finalize(tx)
  catch error:                               // 任何一趟都可能已经 staged 标记，失败就等下次提交重试
    #cascadePending = true; 把 checks 放回 #failFastChecks; if !closing: #report(error)
  #resolveIdleWaiters()
```

`mark(record)` 是个幂等的局部助手（452-456）：已经 `abortRequested` 或本趟已标记过就跳过，因此**在同一趟里合并多个取消理由**不会重复写。

`#anyFailed(ids)`（482-489）的判定是「持有或已经以 `completed` 以外的结局结束」：先看 `#live`，拿不到再读 storage——也就是**终态任务也能让 `failFast` 组失败**，不会因为记录已经离开 `#live` 而漏判。

`#loadScopes(queued)`（515-530）只负责加载：遍历 `#live` 逐个 `#loadChain(parentOf(record))`；`queued` 为真时再扫一遍 `scanSubmissions({ status: "queued" })`，把出现的 conversation 的链也加载进来，并把它们返回给 `#reconcile`。它的注释（517）说明它**直接读已提交的 Storage，所以可以在 commit 回调里跑**——这是它区别于其他读取路径的许可。

#### `#finalize`：`completing` 的终态提交

`#finalize(tx)`（`src/harness/scheduler.ts:491-513`）是 `completing` → `terminal` 的唯一出口，也是「结果已定、只等拥有的工作排空」这句语义的具体实现：

```typescript
		for (;;) {                                                        // 反复扫描：结算一个可能解放它的 owner
			const overlay = overlayOf(tx);                                 // 本笔提交里暂存的候选记录/边
			const owned = this.#ownedLive(overlay);                        // 谁还有活着的普通 owned work
			const done = [...this.#liveRecords(overlay)].filter(
				(record) => record.state.status === "completing" && !owned.has(record.id),
			);
			if (done.length === 0) return;
			for (const record of done) {
				const outcome = (record.state as { readonly outcome: TaskOutcome<JsonValue> }).outcome;
				tx.setTask(withState(record, { status: "terminal", outcome }));   // 把扣住的结局写下去
				// 只有调度器写 faulted 与 orphaned（spec §5.4）；它们的清理要等这笔提交
				if (outcome.status === "faulted" || outcome.status === "orphaned") {
					await this.#settleOutcome(tx, record, outcome);
				}
			}
		}
```

两个细节。第一，「`completing` 任务持有的结局」是从 `record.state.outcome` 里读出来的（505）——即结局在进入 `completing` 时就已写进状态，`#finalize` 只是把它搬到 `terminal`。第二，`faulted`/`orphaned` 的 Harness 清理必须和终态**同一笔提交**（507-510 注释），因为调度器是这两种结局的唯一作者。

#### 所有权漫游：六个原语

所有权树的一切判断都由这几个方法完成，它们都在 `#live` + `#settled` + `#edges` + commit overlay 上工作：

- `#above(start, overlay?)`（571-593）：生成器，从 `start` 向上产出 `Step`。遇到「节点/边未加载」时产出一个 `{ unknown: true }` 并**立即结束**（578-579、586-589）——漫游不会猜测，只会报告不确定。
- `#chainKnown(start, overlay?)`（595-599）：遍历 `#above`，只要见到 `unknown` 就是 false。「链是否加载完整」是所有决策的前置条件。
- `#liveRecords(overlay?)`（601-611）：产出 live 记录，overlay 里的候选替换已提交版本，**终态候选直接消失**（605）；此外还补上 overlay 里不在 `#live` 的新记录（608-610）。这是「同一笔提交内新写入的记录也要参与判断」的关键。
- `#ownedLive(overlay?)`（613-631）：核心语义，注释写为「每个 live 非 background 任务，为**它上方的每一个 owner 任务**计数，直到并包含第一个 background 的那个」。代码上：从 `parentOf(record)` 向上，遇到 task 步就计入，**`step.node.background` 为真时计入后 break**（627）。因此一个 background owner 自己仍算「被占住」，但 background 之上的祖先不算。返回值是 `Map<ownerTaskId, 支撑它的任务 id 列表>`。
- `#inScope(start, scope, crossBackground=false)`（633-648）：普通遍历的落点判定。向上走，遇到 conversation 步且与 `scope.conversation` 相同 → `true`（642）；遇到 background 的 task 且不跨边界 → `false`（643-644）；遇到 `unknown` → `undefined`（640，三态而不是布尔）；走完全程后返回 `"roots" in scope`（647），即「scope 是 roots 时，只有走到无主根才算在内」。
- `#belowCancelled(start)`（650-663）：取消意图是否笼罩 `start`。向上走，遇到 task 步先查 `#live` 里它是否 `cancellationIntent`，是则 `true`；再遇到 background owner 则 `false`。注释给出结论：**终态 owner 从不级联**——机制上是因为终态任务已经被 `#observe` 从 `#live` 删除（359），第 658 行取不到它。

`#loadChain`（532-555）与 `#loadScopes`（515-530）负责把这些结构填满：逐层向上，任务节点先查内存（`#node`，567-569：overlay → `#live` → `#settled`），缺失时读 storage 并**把终态任务缓存进 `#settled`**（542）；conversation 边缺失时读 `storage.conversation` 并把结果存进 `#edges`（548-550）。`parentOf(node)` 把「任务节点」映射成「向上一步的落点」，`nodeOf(record)` 抽出不可变的所有权字段（两个函数在文件末尾，1243-1265 附近）。

#### `#seal`：关闭是一次同步的「拒绝一切」

`#seal()`（`src/harness/scheduler.ts:665-673`）由 `session.subscribeClose` 触发，注释强调它「在 admission 封板后同步运行，且早于 `join()`」：置 `#closing`、退订 registry、用 `closedError()` 一次性 reject 掉所有 task waiter 与 idle waiter、并把**所有** invocation 的 controller abort 掉（672）——包括 `abort` 模式的那些。

#### 本段可证明的规则

- `#live` 的每一次变更都发生在 `#observe` 里（383 行是唯一的无条件写入点），而 `#observe` 是提交监听器，因此 `#live` 与提交态**在线上同步一致**。
- 取消传播有两条独立路径：**自底向上的推导**（`#belowCancelled` + `#reconcile` 的 mark）与**明确的 `abort()`/`abortConversation()` 标记**；两者最终都表现为 `abortRequested` 落盘，然后由 `#observe` 的上升沿分支 abort 正在跑的 controller。`background` 会截断推导（643-644、660），显式 `abortConversation(…, background=true)` 才能穿过它（326、333、338、342）。
- `failFast` 的兑现需要三步同时成立：组仍是 `waiting`、`on` 里确实有非 `completed` 结局（`#anyFailed`，482-489）、且组不在被取消状态（`#observe` 在终态时已把它从 `#failFastChecks` 删掉，361）。
- `completing` → `terminal` 只有一个写入点（506），且必须在 `#ownedLive` 报告「没有任何 live 非 background 任务指向它」时才能发生。
- 每笔提交后的重算都是**幂等**的：`mark` 去重（453）、`#finalize` 循环到不动点（497）、`#reconcile` 失败后把 `#cascadePending` 与 checks 恢复以便重试（473-478）。
- 所有写操作都在 `commitWith` 内；`#scheduleReconcile`/`#kick` 只排队微任务，从不在监听器里同步提交（429-433、675-680）。

#### `#drain`：一轮调度

`#kick()` 排下的微任务就是 `#drain()`（`src/harness/scheduler.ts:683-696`）：

```typescript
	async #drain(): Promise<void> {
		try {
			while (this.#dirty && this.#enabled && !this.#closing) {
				this.#dirty = false;                                        // 先把本轮唤醒消费掉
				for (const reservation of await this.#reserve()) this.#start(reservation);
			}
		} catch (error) {
			if (!this.#closing) this.#report(error);
		} finally {
			this.#draining = false;
			// 在一趟失败的 pass 期间到达的唤醒仍然需要它自己的那一趟
			if (this.#dirty) this.#kick();
		}
	}
```

「一轮调度」= 一次 `#reserve()` + 对每个 reservation 调 `#start()`。`#start` 是发射后不管的（`void (async () => …)`，836-850），**执行不在这一轮里等待**；因此一轮调度只负责「把可以跑的跑起来」，`#dirty` 会在执行期间被再次置真，形成下一轮。`finally` 里的重排（693-694）修掉了「失败 pass 吃掉唤醒」的漏洞。

#### 挑选可跑任务：`#reserve`

`#reserve()`（`src/harness/scheduler.ts:699-742`）在**一笔提交**里完成「判定 + 写入 `running` + 创建 invocation」。判定条件与取舍逐条如下：

```text
#reserve() -> Reservation[]      // 一笔 commitWith
  loadScopes(false)                                     // owner 链必须完整，否则无法判定 owned work
  owned = #ownedLive()                                  // 「谁还有活着的普通 owned work」（已提交态）
  snapshot = undefined                                  // 每趟只取一次 registry 快照，且仅在有候选时才取（706-707）
  for record of [...#live.values()]:
    if #invocations.has(id): continue                   // 同一任务同时只能有一个 invocation（709）
    if #waitingOn(record, owned).length > 0: continue   // 还在等 owned work / 还在等 on（709）
    if record.state.status == "completing": continue    // completing 不再被接管（710）
    mode = record.abortRequested ? "abort" : "run"      // 标记过的任务走 abort 通道（712）
    resolution = #resolve(runnable, snapshot)
    if blocked:
        if mode == "abort": terminate(orphaned, reason)  // abort 通道里「定义接不住」直接终结（716-718）
        continue                                        // run 通道里什么都不写：保持 pending，等下次（719-720）
    if resolution.record !== runnable or status != "running":
        tx.setTask(running, checkpoint)                 // 迁移后的记录在这里被写回（721-728）
    invocation = #createInvocation(record, mode)        // 在线上登记，见下（730）
    reservations.push({ invocation, task, snapshot })
  // catch：把本趟已创建的 invocation 全部撤销并 finish，然后抛出（734-740）
```

四个要点：

1. **`running` 是在挑选时就写下的**（722-727）。也就是说 `running` 不是「handler 开始跑」的产物，而是「本轮已被预订」的标记，并且它与 invocation 的创建在**同一笔提交**里——这保证了「已提交的 `running`」与「内存里的 `#invocations`」不会出现只有一方存在的窗口（730 行注释：在线上登记，标记与后续预订都能看见它，关闭时也能 join 到它）。
2. **`resolution.record !== runnable || status !== "running"` 这个条件包含三种重写**（721）：迁移产生的新记录、把 `waiting` 重新变成 `running`、以及把重启后残留的 `pending` 变成 `running`。后两种都是为了把 checkpoint 原样带过去。
3. **`run` 通道遇到 blocked 是静默的**（719-720）。任务保持 `pending`，不进 `#failedMigrations`（那是迁移失败专用的），也不会被反复上报；下一个触发它的条件（registry 变化、某笔提交、`resume()`）会再来一次。而 `abort` 通道遇到 blocked 会立刻终结为 `orphaned`（717-718）——因为标记过取消的任务已经没有「等以后再跑」的意义了。
4. **快照的取用是懒惰且共享的**（707、713）：只有真的出现候选任务时才 `this.#registry.snapshot()`，且同一趟里所有候选共用同一个快照。这决定了同一趟里的定义选择是一致的。

#### 一个任务此刻在等什么：`#waitingOn`

`#waitingOn(record, owned)`（`src/harness/scheduler.ts:744-752`）是 `#reserve` 的门闩，也是 `inspect` 的输出来源。它的规则按优先级排列：

```text
#waitingOn(record, owned)
  if record.abortRequested: return owned.get(record.id) ?? []   // 被标记取消：等它的普通 owned work 先排空
  if record.state.status != "waiting": return []                // pending/running 不等任何人
  return record.state.on.filter((id) => this.#live.has(id))      // waiting：只算仍然 live 的 on 成员
```

两个必然推论：

- **abort 是自底向上执行的**：被标记取消的任务不会立刻跑 abort handler，而是先等 `owned` 里那批支撑着它的普通 owned work 消失（749、注释 745-746）。
- **`on` 里的终态成员会自动消失**（751 用 `#live.has` 过滤），因此 `allSettled` 组在最后一个成员终结后 `on` 变空，下一轮 `#reserve` 立刻就会把它挑起来。这也是终态变更必须调 `#scheduleReconcile()`（365）的原因——空闲与可跑性都在那一趟里重算。

#### 定义解析：`#resolve` 与 `#fit`

`#fit(record, task)`（773-781）纯判定，不写任何东西，返回三种拒绝理由或迁移许可：

- `task === undefined` → `missing_task`（774）。
- `version === record.version` → 直接可用（776）。
- `version < record.version` → `task_too_old`（777）。**旧定义不允许接住新记录**，这是降级保护。
- 曾对**同一个** `task` 迁移失败过 → `migration_failed` 并带上原错误（778-779）。key 是任务 id，值里存了 `task`，所以 registry 解析出**另一个**定义时会自动重试。
- 否则 → `migrates: true`（780）。

`#resolve(record, snapshot)`（754-771）在 `#fit` 之上做实际迁移：用 `definition.migrate(record.input, record.state.checkpoint, record.version)` 得到新的 `{ input, checkpoint }`，然后用 `copyJson` 复制两份数据，把 `version` 换成 `definition.version`，构造出新的 `RunnableTaskRecord`（762-765）。迁移抛错时写 `#failedMigrations`、`#report(error)`，并返回 `migration_failed`（766-770）。

`missingMigration(record, definition)`（1285-1287 附近）是「版本更高但没有 `migrate` 实现」时抛的错——`#resolve` 在 761 行显式检查 `definition.migrate === undefined`。

#### 关键代码：跑一个 phase（`src/harness/scheduler.ts:859-872`）

```typescript
		for (;;) {
			// #step 在 Session 线上做一次同步决策：任务是否还该继续、要不要写 fault/handover（860 行）
			const current = await this.#step(invocation, (tx, current) => this.#decide(tx, current, previous, state));
			// 决策与派发之间可能被 close 封板（861 行注释）
			if (current === undefined || this.#closing) return;
			const checkpoint = current.state.checkpoint;
			// 每个 phase handler 在首次使用时才重新解析自己的 agent（864-865 行注释）
			phase.agent = undefined;
			try {
				// 真正执行任务代码：phases[checkpoint.phase](current, runtime, invocation.context)
				await erased(state.task).phases[checkpoint.phase]!(current, runtime, invocation.context);
				previous = { checkpoint };                     // handler 正常返回：只记下 phase 名
			} catch (error) {
				previous = { checkpoint, failure: { error } }; // 异常不在这里处理，交给下一次 #decide
			}
		}
```

这个循环揭示了三条容易误读的规则：

1. **循环的每一步都以「线上决策」开头**。handler 的返回值本身不决定任何事——它只被折成 `previous`，下一步的 `#decide` 才决定继续、结束还是 fault。
2. **phase handler 抛出的异常不会立即失败**：它被记住为 `failure`，由下一次 `#decide` 的第 4 条规则（889 行）转成 `faulted`。因此「handler 抛错」与「handler 返回但 checkpoint 没动」是两条不同的错误路径。
3. **`phase.agent` 每个 phase 都重置**（865），所以文档承诺的「每个 phase 最多解析一次 agent」在代码上表现为「每个 phase 一次新解析」。

#### 一个 phase 之后的优先级规则：`#decide`

`#decide`（`src/harness/scheduler.ts:879-912`）在线内运行，注释里的编号对应 spec 的规则表（代码中的检查顺序是 3 → 首步 → 4 → 6 → 5，不是编号顺序）：

```typescript
		// 3. 取消标记：结束这次 invocation；等它的普通 owned work 排空后会新起一次 abort invocation（885-886）
		if (current.abortRequested) return false;
		if (previous === undefined) return true;              // 本次 invocation 的第一次决策：开跑
		// 4. handler 未捕获的错误
		if (previous.failure !== undefined) return { fault: previous.failure.error };
		// 6. 没有推进任何持久状态
		if (jsonEqual(current.state.checkpoint, previous.checkpoint)) {
			const message = `Task ${current.kind} phase ${previous.checkpoint.phase} returned without durable progress`;
			return { fault: new Error(message) };
		}
```

第 5 条规则（895-910）是**定义交接**：有持久进展时先刷新 registry 快照；如果这个 `kind` 现在由**另一个** `task` 定义服务：

- 新定义能接住当前记录（`canReserve(next, current)`，1305-1310 附近）→ 写回 `pending`（checkpoint 保留）并结束本次 invocation（900-901）。下一次 `#reserve` 会用新定义重新跑，必要时先做 migrate。
- 接不住 → `#report` 一次「任务仍然在旧定义下继续跑」的错误，`cause` 是 `missing_task` 或 `incompatible_task`（903-909）。上报去重按「替代定义对象」判断（`state.reported.task !== next`），所以同一个坏定义不会每步刷一条。

`#decide` 的返回值有三态：`true` 继续、`false` 结束（不写终态）、`{ fault }` 结束并写 `faulted`。这个三态是 `#step` 唯一的输入契约。

#### `#step`：一次线内决策，以及「invocation 在决定里结束」

`#step(invocation, decide)`（931-959）把上面的契约落成一次提交：

```text
#step(invocation, decide) -> ErasedRunningTask | undefined
  try:
    commitWith(tx):
      found = #live.get(invocation.taskId)
      current = found 且 status == "running" 时才取（规则 1：terminal/completing/waiting 一律不再继续）
      decision = current 存在且未 closing 时才调用 decide（规则 2：closing 直接结束）
      if decision === true: return current
      #end(invocation)                       // 在回调内部结束，早于 fault 的 Harness 清理（934-935 行注释）
      if decision !== false:                 // 即 { fault }
        #terminate(tx, current, { status: "faulted", error: { message } })
      return undefined
  catch: #end(invocation); if !closing: #report(error); return undefined
```

规则 1 的过滤条件是**状态必须恰好是 `running`**（944）。它同时解释了三个现象：任务被写成 `waiting` 后，正在跑的 invocation 会在下一步自动停掉；任务被写成 `completing`（结果已定、等排空）时 invocation 同样停掉；任务被显式 `abort()` 标记后（886 行返回 false）也停掉，但**没有终态写入**——终态由随后的 abort invocation 负责。

#### `#terminate` 与 `#commitState`：两个终态写入点，同一套「先扣住」规则

调度器自己决定的结局走 `#terminate`（961-973），runtime 通过 `commit()` 提交的结局走 `#commitState`（975-997）。两者共享同一条规则：**如果这个任务还有活着的普通 owned work，终态先扣住为 `completing`**。

- `#terminate(tx, record, outcome)`（965-973）：`loadScopes(false)` 补齐链后判 `#ownedLive(overlayOf(tx)).has(record.id)`。有 → 写 `completing` 带 `outcome`，**不做 Harness 清理**；没有 → 写 `terminal` 并立即 `#settleOutcome`（971-972）。注释明确说清理要等最终那笔提交（spec §5.5、rule 4）。
- `#commitState(tx, invocation, current, next)`（980-997）：先按状态分派——`waiting` 要先通过 `#validateWait`（986）；`terminal` 时先在 overlay 上判 owned work（988-995）；其余状态直接 `tx.setTask(withState(current, next))`（996）。注释里有一句很关键的设计说明（976-978）：**判断是在本笔提交的候选记录上做的，因此「同一笔提交里刚刚在这个任务下面创建的工作」也算数**。

区别只有一个：`#terminate` 写调度器自己的 `faulted`/`orphaned`，`#commitState` 写 runtime 给的结局（`completed`/`failed`/`cancelled`）。

#### `#runAbort`：abort handler 何时以什么状态运行

`#runAbort(reservation)`（914-929）短但信息量大：

```text
#runAbort(reservation)
  current = #live.get(taskId)             // 必须是 ErasedRunningTask（已在 abort 模式下被 #reserve 写成 running）
  if current === undefined or closing: return
  try: await erased(reservation.task).abort(current, runtime, context)   // 只调用一次
  catch error: failure = { error }
  // 无论 handler 是否返回，都提交一次决策：失败 → fault(error)；正常返回但没写终态 → fault(固定消息)
  await #step(invocation, () => ({ fault: failure?.error ?? new Error(message) }))
```

三个结论：

1. **abort handler 看到的状态是 `running`**，且 `#live` 里存在这条记录——因为 `#reserve` 已经为 `mode: "abort"` 的预订写过 `running`（712、721-727）。
2. **handler 只被调用一次，且不进入 phase 循环**。它没有 `previous`、没有 checkpoint 比较，直接 `abort(current, runtime, context)`（923）。
3. **abort handler 必须自己写出终态**。它返回时如果没留下终态记录，调度器就用固定消息 `Abort handler of task ${id} returned without a terminal outcome` 把它写成 `faulted`（927-928）。这是「abort 不是一条逃生通道」的强制约束。

注意 `#runAbort` 传入的 `#step` 回调**忽略 `tx` 和 `current`、永远返回 fault**，所以 abort 路径下 `#step` 的作用只是「在线上把任务判定为异常终止」；如果此时任务已经不在 `running`（规则 1）或 Harness 正在关闭（规则 2），`#step` 会走 945 行的分支，什么都不写。

#### `#validateWait`：一个 wait 在什么条件下合法

`#validateWait(tx, invocation, current, on, policy)`（1003-1020+）在 `#commitState` 写 `waiting` 之前运行：

- **abort handler 不能 wait**：`if (invocation.mode === "abort") throw new Error(\`Abort handler of task ${current.id} cannot wait\`)`（1010）。这是硬错误而不是 fault——它会直接从 runtime 的 `commit()` 抛出。
- **不能等自己，也不能等自己的祖先**：先 `#loadChain(parentOf(current))` 补齐，再用 `#above(parentOf(current))` 收集全部 owner 任务进 `owners`（1012-1014）；随后对 `on` 的每个 id 检查 `id === current.id || owners.has(id)` 并抛错（1016-1018）。理由写在文档注释里（1000-1001）：祖先或自己**永远不可能先结束**，这样的等待是死锁。
- **成员必须存在**：按 overlay → `#live` → storage 的顺序解析，找不到就抛 `Task ${id} does not exist`（1019-1020）。这一步顺带保证了 `on` 里的 id 一定能在后续 `#waitingOn` 的 `#live.has` 过滤中正确工作。

`on` 剩下部分的校验（`failFast` 只能等自己拥有的任务等）延续到 1021 行之后。

#### 本段可证明的规则

- `running` 的写入点在 `#reserve`（722）与迁移重写处；`#start` 之后 handler 才开始跑，所以**「已提交 running」可能先于「handler 真的在跑」**，也可能在 handler 已经结束后仍然短暂为 `running`（直到 `#end` 后的下一笔提交）。
- 一个任务同时最多一个 invocation：唯一创建点 `#createInvocation` 写进按 `TaskId` 索引的 `#invocations`（832），且 `#reserve` 先跳过已存在的（709）。
- abort 的顺序保证来自 `#waitingOn` 的第一条分支（749）加上 `#ownedLive` 的定义（617-631）：**先排空 owned work，再跑 abort handler**。
- 每个 phase 都必须在 checkpoint 上留下可观测的变化，否则 `#decide` 的第 6 条规则会把它写成 `faulted`（891-894）——`jsonEqual` 是深比较（1327 行附近）。
- phase handler 的异常被 `#decide` 转成 `faulted`，而 `#terminate` 又会先检查 owned work；因此**一个还有活着的子工作的任务可以以 `faulted` 的结局挂在 `completing` 上等待**（965-969）。
- `inspect()`（788-799）给出的 `scheduling` 只有三值：`closing` / `running` / `paused`（797）；`#inspectTask`（801-816）**不运行任何任务代码**——迁移只显示为 `ready`（`migrates: true`），只有「已经试过失败的迁移」或「根本不存在迁移实现」才显示为 blocked（810-814）。

#### `#validateWait` 的其余规则与 `#end`

`on` 列表的最后一条校验（`src/harness/scheduler.ts:1021-1023`）：**`failFast` 只能等自己拥有的任务**。判定用的是成员记录的 `member.owner !== current.id`，不满足就抛 `Task ${current.id} can wait failFast only on tasks it owns; ${id} is not one`。合起来，一个合法 wait 的条件是：不是 abort handler（1010）、不包含自己与祖先（1016-1018）、id 都存在（1019-1020）、`failFast` 时每个成员都直接归自己所有（1021）。

`#end(invocation)`（1027-1035）是 invocation 的收尾，它自己**不写任何提交**，只做四件内存操作：

1. `ended` 幂等标记（1029-1030）；
2. 如果 `#invocations` 里登记的确实是这个对象才删除（1031）——避免删掉后来者的登记；
3. `for (const watch of invocation.watches) void watch.stop()`（1032）：**所有通过 runtime 拿到的 DocumentWatch 在 invocation 结束时统一停掉**，调用方不需要自己清理；
4. `invocation.controller.abort(endedError(invocation))`（1034）：用 `Task ${id} invocation has ended` 作为 abort reason。注释（1033）说明这同时会 reject 掉「绑定在这次 invocation 上的等待」，例如工具里的 `waitForTask()`。

#### 会话何时空闲：`#idle`

`#idle(conversationId | undefined)`（`src/harness/scheduler.ts:1037-1044`）是 `waitForIdle` 与 `#resolveIdleWaiters` 的唯一判据：

```typescript
	#idle(conversationId: ConversationId | undefined): boolean {
		const scope: Scope = conversationId === undefined ? { roots: true } : { conversation: conversationId };
		for (const record of this.#live.values()) {
			if (!record.background && this.#inScope(parentOf(record), scope) !== false) return false;
		}
		return true;
	}
```

三个必须记住的点：

1. **只有非 `background` 的任务会阻止空闲**（1041 行的 `!record.background`）。`background` 任务永远不参与「会话是否空闲」的判定，这是它作为边界的第一层含义。
2. **`!== false` 而不是 `=== true`**（1041）。`#inScope` 的三态（633-648）在这里被有意放宽：`true`（在范围内）和 `undefined`（owner 边还没加载）都算「在里面」，于是**未加载的边会把空闲判定压住**，宁可多等也不误报空闲。注释（1037）写的就是这句话。
3. `conversationId === undefined` 时 scope 是 `{ roots: true }`（1039），即「所有无主 conversation」——这是「等整个 Harness 空闲」的实现。

#### 关键代码：`#gated`（`src/harness/scheduler.ts:1193-1211`）

runtime 的每一个写操作（`commit()`、`memo` 的写形式）都要穿过 `#gated`。这段代码是「一个还在跑的 invocation 到底允许写什么」的完整规则：

```typescript
		if (invocation.ended) return Promise.reject(endedError(invocation));
		return this.#session.commitWith(
			async (tx) => {
				if (invocation.ended) throw endedError(invocation);            // 进入线上再检查一次
				if (this.#closing) throw closedError();
				const found = this.#live.get(invocation.taskId);
				if (found === undefined) throw new Error(`Task ${invocation.taskId} is terminal`);
				if (found.state.status !== "running") throw new Error(`Task ${invocation.taskId} is ${found.state.status}`);
				const current = found as ErasedRunningTask;
				// run 模式的 invocation 一旦任务带上持久 abort 标记，就不允许再写（abort 通道仍然可以写）
				if (invocation.mode === "run" && current.abortRequested) {
					throw new Error(`Task ${invocation.taskId} has a durable abort mark`);
				}
				return change(tx, current);
			},
			context,
			{ conversationId: invocation.conversationId, taskId: invocation.taskId },
		);
```

它给出的保证：**被拒绝的写永远不会以「半个提交」的形式落地**；`running` 之外的任何状态（`waiting`/`completing`/`terminal`）都直接抛错，错误消息里带着实际状态（1202）；第 1210 行的第三个参数把提交归属到具体的 conversation/task——这是记录与标识的一部分（见 1.4 节）。

#### `#runtime`：invocation 能看到的完整能力面

`#runtime(invocation, phase)`（1048-1181）返回 runtime 对象。它值得按「读」与「写」两类看：

- **每 phase 一次的 agent**（1050-1058）：`phase.agent` 懒创建，创建后 `phase.agent.catch(() => {})` 挂一个空 catch（1055），注释说明这是为了「停止等待的调用方不会留下无人观察的 rejection」。`runtime.agent(context)` 再用 `awaitWithContext` 把 phase 缓存与调用方 context 组合（1079-1080）。
- **hooks**（1059-1072）：按 `agentHooks(await agent(), phase.task().definition.name)` 取 handler 列表，逐个 `handler.bind(handlers)` 调用；**handler 抛错时，如果 invocation 的 signal 已经 aborted 就重抛，否则只 `#report` 并继续下一个**（1066-1069）。也就是说 hook 错误默认是「记录并跳过」，只有取消时才向上冒。
- **settings 与 registry 都是读取器而不是快照**（1081-1088）：`runtime.settings` 每次访问都调 `#settings()`；`runtime.registry` 返回 `phase.snapshot()`。
- **`commit(change, context)`**（1089-1097）：在 `#gated` 内先执行 `change(tx, current)`，若它返回了 `NextTaskState`（不是 `undefined`）就交给 `#commitState`。**返回 `undefined` 表示「这一笔只做副作用，不改状态」**。
- **`memo(name)` / `memo(name, value, context)`**（1098-1113）：读取形式走 `#read` + `memoOf`；写入形式是**先到先得**——如果 `memoOf(current, name)` 已经存在就返回既有值、不覆盖（1106-1107），否则写入并返回候选值。`memoOf` 用 `Object.hasOwn`（1271-1275），所以 `toString` 之类的名字不会命中原型属性。
- **`sleep(until, context)`** → `#sleep`（1214-1226）：用 `AbortSignal.any([invocation.controller.signal, context.abortSignal])` 合成信号，循环 `remaining = until - now()`，每次 `delay(min(remaining, MAX_TIMER_DELAY))` 之后**重新读表**（1220-1225）。因此「睡到某个 Harness 时钟时刻」在时钟被推进/回拨时也能正确结束，并且长睡会被 `MAX_TIMER_DELAY`（2_147_483_647，53 行）切段。
- **`watchDoc(...args)`** → `#watchDoc`（1228-1239）：创建成功后登记进 `invocation.watches`，并在 `watch.closed` 时自动从集合里删除（1237）；如果创建过程中 invocation 已经结束，则立刻 `watch.stop()` 再抛 `endedError`（1232-1235）。
- **只读能力**：`snapshot` / `snapshotAsOf` 通过 `sessionMethod` 转发（1116-1123、1277-1283）；`getTask`、`entry`、`context` 都包在 `#read` + `#session.readOnLine` 里（1124-1127、1157-1171）——即**读的是已提交态，且在线上读**。
- **`waitForTask(id, context)`**（1128-1131）把 invocation 的 signal 叠加到调用方 context 上，所以 invocation 一结束，这个等待就会以 `endedError` reject。
- **`outcomes(ids, context)`**（1132-1143）要求**每个 id 都已终结**，否则抛 `Task ${id} is not terminal`；这是「一次性收集一组结果」的入口，与 `waiting.policy: allSettled` 配合使用。
- **`conversation(id, context)`**（1144-1156）传下去的 `InvocationBinding` 是 `{ signal, check }`：`check()` 在 invocation 已结束时抛 `endedError`（1150-1152）。这就是任务运行时拿到 conversation handle 后仍无法「跨 invocation 存活」的原因。
- `now()` 与 `report(error)`（1172-1179）也做 `ended` 检查——**结束之后连读时钟和上报都不允许**。

`#read`（1183-1187）只有三行：`ended` 就抛，否则执行读取。

#### 文件末尾的纯函数

这些定义在类外面的小函数（1242-1337）是前面所有规则的词汇表：

- `cancellationIntent(record)`（1242-1245）：**非终态**且（`abortRequested` 或 `failedOutcome`）。第二个或项很关键——一个以非 `completed` 结局**挂在 `completing`** 的任务，会立刻对它的子树产生取消意图，这就是「owner 失败会级联取消子任务」的机制（在 `#observe` 的 375-378 行被检测到）。
- `failedOutcome(record)`（1247-1251）：只在 `completing`/`terminal` 状态下有定义，且 `outcome.status !== "completed"`。
- `parentOf(node)`（1253-1255）：有 `owner` 就向上到那个任务，否则向上到 `conversationId`。
- `nodeOf`（1257-1263）：抽取三个不可变字段，且 **`owner` 为空时不会写成 `undefined` 键**（1260）。
- `overlayOf(tx)`（1265-1269）：由 `tx.stagedTasks()` / `tx.stagedConversations()` 构造 overlay，`conversation.owner?.taskId ?? null` 把「无主」与「未加载」区分开。
- `withState(record, state)`（1297-1302）：写 `terminal`/`completing` 时**把 `memos` 摘掉**（1300）。理由：结局一旦决定，memo 的生命周期就结束了，不应继续留在记录里。
- `canReserve(task, record)`（1304-1310）：版本相同，或版本更高且有 `migrate` 实现——这就是 `#decide` 第 5 条规则判定「新定义能不能接管」用的函数。
- `jsonEqual(left, right)`（1326-1337）：结构化比较，数组按位置、对象按键集合，**忽略键顺序**；它不是 `JSON.stringify` 比较，所以 `{a:1,b:2}` 与 `{b:2,a:1}` 相等。
- `delay(ms, signal)`（1312-1324）：`setTimeout` + abort 监听，abort 时 `reject(signal.reason)`。
- `endedError` / `erased` / `missingMigration` / `memoOf` / `sessionMethod`（1271-1295）：错误构造与类型擦除的辅助。

#### 本段可证明的规则

- `#end` 是幂等的，且**watch 与等待都随 invocation 一起结束**；任何依赖 invocation 的能力在结束后都会以 `Task ${id} invocation has ended` 失败（1027-1035、1172-1179）。
- `runtime.commit()` 的三重门：invocation 未结束、Harness 未 closing、任务仍 `running`（1195-1203）；此外 `run` 模式下有持久 abort 标记就不能再写（1204-1206）——**abort 标记是单向闩锁**。
- `memo(name, value)` 是**先到先得**的（1106-1108），重放或重复执行不会覆盖先写入的值。
- hook 的错误默认被吞掉并上报（1066-1069），**只有取消时的错误才向上传播**——因此 hook 不应该被用来实现必须成功的关键路径。
- 空闲判定把「未加载的边」当成「在里面」（1041），所以 `waitForIdle` 可能因为依赖未加载而延后兑现，而不是提前兑现。
- `withState` 摘除 memos（1297-1302）；因此 `terminal`/`completing` 记录上不可能再有 memo，读 memo 的路径在结局决定后必然返回 `undefined`。

### 4.3.2 src/harness/harness.ts

`src/harness/harness.ts` 是 harness/ 的装配层与门面：它把 `Storage`、`SessionImpl`、`TaskScheduler`、`Submissions`、`ConversationViews`、`TaskGraphView` 拼成一个 `Harness`，并给上层提供 `Conversation` 句柄。**调度逻辑不在这里**——这里只决定「谁在什么时候被 `resume()`」。

#### 导出面

本文件导出两样东西：`export type Harness = HarnessType`（`src/harness/harness.ts:408`）与同名的值 `export const Harness`（410-436），后者只有一个方法 `open`。两个 `class`（`ConversationImpl`、`HarnessImpl`）与几个内部类型（`CreateTarget`、`CreateOptions`、`ConversationHost`）都**不导出**——它们只在本文件与 `Conversation` 句柄之间使用，见本小节末尾「唯一开箱入口」。

内部类型：

- `CreateTarget`（59-67）：创建 conversation 的三种目标——`root`、`independent`（带 `ConversationOwnership`）、`fork`（带 `parentId` + `at` + ownership）。
- `CreateOptions`（69-70）：`{ agent?: AgentChange; init?: ConversationInit }`，注释说明它们由便捷方法在**创建那笔提交里、创建 hook 之后**应用。
- `ConversationHost<Tool>`（72-81）：Conversation 句柄能用的私有服务集合——`harness`、`storage`、`tasks: TaskScheduler`、`submissions`、`views`、`now`、`create`。`ConversationImpl` 自身只持有 `id` 与这份 host（84-90），所以句柄是轻量的；所有句柄共享同一个 host 对象，也就是同一个 `TaskScheduler` 实例。

#### `ConversationImpl`：句柄方法，以及「要求进展」

`ConversationImpl`（83-162）每个方法都是一次委派，但有三处显式调用 `this.#host.tasks.resume()`：

- `compact(instructions, context)`（104-108）：**先 `resume()`**，再用 `commitWith` 在提交里 `createCompaction(tx, this.id, input)`。input 的 `reason` 固定为 `"manual"`。
- `abort(context, options?)`（145-148）：先 `resume()`，再 `tasks.abortConversation(this.id, options?.background === true, context)`。注意 `background` 的默认值是**严格等于 `true`**，不是真值判断。
- `waitForIdle(context)`（150-153）：先 `resume()` 再等——否则一个没人启动的调度器可能永远不产生「空闲」这个事件。

`reset(handoff, context)`（110-117）走的是另一条路：它把一条 `ResetEntry` 作为 `{ type: "write", entry }` 提交给 `submissions.submit`；`handoff` 存在时作为一条 `user` 消息塞进 `model` 数组，时间戳用 `this.#host.now()`（114）。

`submit`（100-102）自己不 resume，但 `HarnessImpl` 构造 `Submissions` 时传入了 `() => this.#tasks.resume()`（200 行）——所以**投递输入同样会推动调度器**。

其余方法的要点：`agent` 走 `harness.resolveAgent(this.id, undefined, context)`（92-94，`undefined` 表示用当前 registry 快照）；`configure` 在提交里调 `configure(tx, id, change)`（96-98）；`entries` 把 `EntryQuery` 的 `conversationId` 钉死成 `this.id` 并在线上读（127-139）；`fork` 把 `ownership` 透传成 `CreateTarget`（141-143）；`viewState`/`watch` 委派给 `ConversationViews`（155-161）。

#### `HarnessImpl` 的构造：装配 `TaskScheduler`

`HarnessImpl`（165-211）继承 `SessionImpl` 并实现 `Harness` 接口。构造函数里最有信息量的是 `TaskScheduler` 的装配（182-199）：

```typescript
		// 调度器的 context 不携带调用者的取消：构造器里用 withoutAbortSignal 剥掉传入 context 的信号
		this.#tasks = new TaskScheduler({
			session: this,                                    // 调度器直接跑在被当作 Session 的 this 上
			storage,
			registry: options.registry,
			models: options.models,
			agent: (id, snapshot, callContext) => this.resolveAgent(id, snapshot as RegistrySnapshot<Tool>, callContext),
			settings,                                         // () => resolveSettings(options.settings)，每次访问都重解
			env: (id, callContext) => this.buildEnv(id, callContext),
			now,                                              // options.now ?? Date.now
			report: this.#report,                             // options.onReport ?? (() => {})
			settleOutcome: settleSchedulerOutcome,            // live.ts
			withdrawInputs: withdrawQueuedInputs,             // inbox.ts
			conversation: async (id, binding, callContext) => {
				const record = await this.readOnLine(() => storage.conversation(id, callContext));
				return record === undefined ? undefined : boundConversation(id, binding, this.#submissions, this.#tasks);
			},
			context: withoutAbortSignal(context),
		});
```

逐条对应调度器的依赖（见 4.3.1 的 `TaskSchedulerOptions`）：`report` 与 `now` 都有默认值（179-180）；`settings` 是个**每次调用都重新解析的闭包**（181），这正是调度器文档里「每次访问都重新读」的实现；`settleOutcome` 与 `withdrawInputs` 直接指向同目录的 `live.ts` / `inbox.ts`；`conversation` 先在线内读记录，不存在就返回 `undefined`，否则用 `boundConversation(id, binding, …)` 造出一个绑定到该 invocation 的句柄（194-197）。

最后一行是本文件里最容易被忽略的约束：`context: withoutAbortSignal(context)`（198）。**传给调度器的 context 主动剥掉了调用者的 abort 信号**，因此「调用者取消」不会打断调度器内部的提交与 reconcile；调度器对取消的响应只通过 `abortRequested` 这条持久通道发生。

同一次构造里还创建了两个同级服务：

- `Submissions`（200）：拿到 `() => this.#tasks.resume()` 作为「有新输入就推一把」的回调。
- `TaskGraphView`（201）与 `ConversationViews`（207）：只依赖 `this` 与 `storage`，不依赖调度器。
- `#host`（202-210）：把 `harness`、`storage`、`tasks`、`submissions`、`views`、`now`、`create` 打包成 `ConversationHost`，供所有 `ConversationImpl` 使用。

#### `resolveAgent`、`buildEnv`、`openTasks`、`resume`

- `resolveAgent(id, snapshot, context)`（213-222）：`snapshot ?? this.#options.registry.snapshot()`（219）——传入快照就用传入的，否则取当前快照。随后 `this.snapshot(AgentDoc, id, context)` 读**已提交**的 agent 配置，交给 agent.ts 的 `resolveAgent(state, registry, resolveSettings(...), this.#report)`。这就是调度器「每个 phase 最多解析一次 agent」背后真正做的事：读一条 `pi.agent` 文档 + 在给定 registry 快照里解析。
- `buildEnv(id, context)`（224-230）：没有 `options.env` 就直接返回 `undefined`；否则从 `AgentDoc` 里取 `cwd`，调 `build({ conversationId, cwd?, read: this }, context)`。`read: this` 把 Harness 自身作为读取器交给环境——环境因此能读文档，但拿不到调度器。
- `openTasks(context)`（232-235）：`return this.#tasks.open(context)`。注释写明「把幸存的 `running` 任务改回 `pending`；属于 open 的一部分」，与调度器 230 行的注释一致。
- `resume()`（237-240）：先 `#assertOpen()`（未 open 就抛），再 `this.#tasks.resume()`。它是**公开的推进入口**：`ConversationImpl` 的 `compact`/`abort`/`waitForIdle` 与 `Submissions` 都会调用它。

#### 本段可证明的规则

- 调度器的启动点有三类：`HarnessImpl.resume()`（237-240，公开 API）、`ConversationImpl` 的 `compact`/`abort`/`waitForIdle`（105、146、151，方法内部的隐式推进）、以及 `Submissions` 的输入回调（200）。**没有任何一条路径在构造时自动启动调度**——`resume()` 是显式的。
- 调度器的 context 与调用者的取消隔离（198）；调用者取消只影响它自己那一笔提交（`commitWith` 的 `context`），不影响 reconcile。
- Conversation 句柄拿到的是**同一份** `TaskScheduler` 实例（205），不是代理或副本。
- `Conversation.abort()` 的 `background` 默认 `false`（147 的 `=== true`）。

#### `HarnessImpl` 的其余门面

- `getTask(id, context)`（`src/harness/harness.ts:242-246`）：在线内读 storage 的任务记录并做一次泛型断言，**不做任何状态推导**。想要「任务现在处于什么状态」应该用 `inspect()`。
- `inspect(context)`（248-256）：整个方法在 `readOnLine` 里执行。它把 `#tasks.inspect(registry.snapshot())` 的结果（`scheduling` + `tasks`）与两次 `scanSubmissions({ status: "queued" | "placed" })` 合并，提交列表按 `id` 升序排列（253）。注意它**只扫 `queued` 与 `placed`**，已结算的提交不出现。
- `submission(id, context)` / `abortSubmission(id, context, conversationId?)`（258-268）：直接委派给 `Submissions`，返回 `"aborted" | "already_placed" | "settled" | "not_found"` 四态。
- `abortTask(id, context)`（270-272）：直接转 `#tasks.abort(id, context)`，**不调用 `resume()`**。原因在调度器那边：`abort` 会自己走提交线与取消通道，不依赖 `#enabled`。
- `waitForTask` / `waitForIdle`（274-282）：两者都**先 `resume()` 再等**。Harness 级的 `waitForIdle` 传的是 `undefined`（281），即等整个 Harness 空闲。
- `usage(context)`（284-295）：线上扫出所有 conversation（287），逐个 `snapshot(UsageDoc, id, context)`，存在就 `addUsageState(total, state)` 累加。注释（284）说明「每份文档在自己的时刻被读取；总量只会增长」——它不是一致性快照，而是单调累加。
- `taskGraph` / `watchTaskGraph`（297-303）：转给 `TaskGraphView`。
- `conversation(id, context)`（312-316）：`#assertOpen()` 后在线内读出记录；不存在返回 `undefined`，否则包装成 `new ConversationImpl(record.id, this.#host)`。**句柄是每次调用新建的轻量对象**，没有任何缓存。
- `close(context)`（322-325）：先把 `#closed = true`，再 `super.close(context)`。`#assertOpen()`（365-367）抛的固定消息是 `Harness is closed`。
- `beforeClose()`（327-330，`protected override`）：返回 `this.#tasks.join()`。注释把时机说清楚了：**在 admission 封板之后、Storage 关闭之前**等待所有 invocation，且**不写任何任务结局**。

#### 创建 conversation：`#create` 与创建 hook

`#create(target, options, context)`（332-349）把三种目标压成同一笔提交：

```text
#create(target, options, context)
  #assertOpen()
  id = commitWith(tx):
    if target.kind == "root" and tx.conversation(ROOT_CONVERSATION_ID) 已存在: return ROOT_CONVERSATION_ID   // root 幂等
    record = root ? tx.createRootConversation()
           : fork ? tx.forkConversation(parentId, at, { ownership })
           : tx.createConversation({ ownership })
    if options.agent !== undefined: configure(tx, record.id, options.agent)
    if options.init !== undefined: options.init(tx, record.id)
    return record.id
  return new ConversationImpl(id, this.#host)
```

两点：**root 的创建是幂等的**（335-337，已存在就直接复用 `ROOT_CONVERSATION_ID`）；`agent` 与 `init` 都在**同一笔**创建提交里、且在创建 hook 之后应用（344-345，与 69-70 行注释一致）。

`conversationCreated(tx, record)`（351-363）是内建的创建 hook，会在**每一笔创建或 fork conversation 的提交**里跑，顺序固定：空 `pi.live`、`pi.inbox`、`pi.usage` 文档各写一次（357-359），`pi.provider` 用 `tx.doc(ProviderDoc, record.id)`（360，注释说 fresh，即回到初始态），然后 `createAgent(tx, record)`（361），最后才是外部钩子 `options.conversationCreated?.(tx, record)`（362）。这个顺序解释了为什么 `pi.agent` 一定存在——它由 harness 自己写，而不是等用户配置。

#### `boundConversation`：任务与工具看到的 bounded 句柄

`boundConversation(id, binding, submissions, tasks)`（374-405）由调度器的 `conversation` 依赖调用（见构造里的 194-197）。它的文档注释（370-373）给出了契约：**每个操作、以及它返回的 submission 的每个操作，都先检查 invocation，并在它的 signal 下运行，因此 invocation 一结束就 reject；已经被 admit 的工作仍然是持久的（durable）。**

```typescript
	// bind: 把 invocation 的 signal 叠加到调用者的 context 上
	const bind = (context: Context): Context => withAbortSignal(binding.signal, context);
	// bound: 每次调用先 check()，再用叠加后的 context 执行
	const bound = <T>(operation: (context: Context) => Promise<T>) => {
		return async (context: Context): Promise<T> => {
			binding.check();
			return operation(bind(context));
		};
	};
	return {
		id,
		submit: async (draft, context) => {
			binding.check();
			const submission = await submissions.submit(id, draft, bind(context));
			// 返回的 submission 只有 id 是裸值，status/wait/abort 都被 bound 包裹
			return {
				id: submission.id,
				status: bound((callContext) => submission.status(callContext)),
				wait: bound((callContext) => submission.wait(callContext)),
				abort: bound((callContext) => submission.abort(callContext)),
			};
		},
		// abort 走调度器的 abortConversation；background 同样严格判 true
		abort: async (context, options) => {
			binding.check();
			return tasks.abortConversation(id, options?.background === true, bind(context));
		},
		waitForIdle: bound((callContext) => tasks.waitForIdle(id, callContext)),
	};
```

注意 `submit` 之外还有一条：**它返回的 submission 句柄也被 bound 了**（392-397）。所以一个任务即使拿到了 submission 对象，也不能在 invocation 结束后继续 `wait()`。

#### `Harness.open`：唯一的开箱入口

文件末尾导出的是 `Harness` 这个「命名空间式」常量对象（`src/harness/harness.ts:407-436`），它有唯一的方法 `open`：

```typescript
	async open<Tool extends ToolRegistration>(
		storage: Storage,
		options: HarnessOptions<Tool>,
		context: Context,
	): Promise<Harness> {
		context.abortSignal?.throwIfAborted();                       // 一开始就被取消：直接抛出
		const snapshot = options.registry.snapshot();
		// 打开前先校验 registry 是否包含全部内建任务
		const missing = BUILTIN_TASKS.filter((task) => snapshot.task(task.definition.name) === undefined);
		if (missing.length > 0) {
			const names = missing.map((task) => task.definition.name).join(", ");
			throw new Error(`Registry lacks built-in tasks ${names}; create it with createRegistry()`);
		}
		const harness = new HarnessImpl(storage, options, context);
		try {
			await harness.openTasks(context);                        // 这里做 running → pending，并排第一次 reconcile
		} catch (error) {
			// 可能是调用者的 context 让 open 失败：用剥掉信号的 context 关掉它，再抛出原始错误
			await harness
				.close(withoutAbortSignal(context))
				.catch((closeError: unknown) => options.onReport?.(closeError));
			throw error;
		}
		return harness;
	},
```

三个要点：

1. **打开前校验内建任务**（419-423）：`BUILTIN_TASKS` 的每个 `definition.name` 都必须能被 registry 解析；缺失时抛出的消息直接给出补救方式（`createRegistry()`）。这保证了调度器永远不会因为「某个内建 kind 没有定义」而在运行时大面积 `missing_task`。
2. **`open` 包含 `openTasks`**（426）：`Harness.open()` 与 `TaskScheduler.open()` 是两个层次的操作——前者还做 registry 校验与失败清理。
3. **失败路径用剥掉信号的 context 关闭**（428-431）：注释解释了原因——失败的很可能就是调用者的 context，用它去 close 会再次失败；close 自身的错误走 `options.onReport`，**原始错误始终被重抛**。

注意 `Harness.open` **不调用 `resume()`**：打开之后调度器是 paused 状态（`inspect()` 会报 `"paused"`，见 `src/harness/scheduler.ts:797`），直到有人调用 `resume()`。这是「打开」与「推进」分离的直接证据。

#### 本段可证明的规则

- `Harness.open` 之后调度器处于 paused；唯一的开闸方式是 `HarnessImpl.resume()`（237-240）及其在各个便捷方法里的隐式调用（`waitForTask`/`waitForIdle` 274-282、`ConversationImpl.compact/abort/waitForIdle` 105/146/151、`Submissions` 的输入回调 200）。
- `close` 的顺序保证：`#closed = true` → `super.close()` → `beforeClose()` 里的 `tasks.join()`（322-330）。`join()` 只等已经开始的 invocation，**不写结局**，因此关闭不会凭空终结任何任务。
- 每个 conversation 在创建时必然拥有 `pi.live` / `pi.inbox` / `pi.usage` / `pi.provider` / `pi.agent` 五份文档（356-361）；`conversationCreated` 外部钩子在这些之后运行，因此它可以依赖它们存在。
- `boundConversation` 提供的是「一次性」句柄：`binding.check()` 会在 invocation 结束后抛 `Task ${id} invocation has ended`（调度器 1293-1295），而 admit 过的提交仍然会落盘（370-373 注释）。
- `Harness` 的两处导出（`export type Harness` / `export const Harness`）意味着**类型与值同名**：类型来自 `./types.ts` 的接口，值是本文件里的开箱工具对象。

#### 不变式与边界

下面这一组规则是 4.3 节两个文件合起来能证明的**系统级约束**；方括号里标明它主要由哪个文件保证。

**1. 单写者，且写入点有限**［scheduler］。每一次任务状态转移都由「一个在 Session 线上串行执行的回调」决定并写入（`src/harness/scheduler.ts:159-173`）。全部写入点可以穷举：`open()` 里 `running → pending`（245）、`abort()` 的标记（290）、`abortConversation()` 的标记（335）、`#reconcile` 的 mark（455）、`#finalize` 的终态（506）、`#reserve` 的 `running`（722-727）、`#decide` 的 handover（900）、`#terminate` 的两种结局（968、971）、`#commitState` 的两条分支（992、996）、以及 `memo` 写入（1108）。**没有任何其他代码路径能写任务状态**，`runtime.commit()` 也必须穿过 `#gated`。

**2. 状态机只有五种状态，`running` 是易失的**［scheduler］。`LIVE_STATUSES`（54）给出四种非终态，加上 `terminal`。`running` 只代表「本进程的某次 invocation 正在（或刚刚）持有它」；重启时 `open()` 把所有 `running` 改回 `pending` 并保留 checkpoint（230、244-246），因此**任何依赖 `running` 跨重启存活的逻辑都是错的**。

**3. `#live` 与提交态同步**［scheduler］。它唯一的无条件写入点是 `#observe`（383），而 `#observe` 是同步提交监听器；终态记录被三删一留（358-366）。因此线上代码从 `#live` 读到的状态不会领先或落后于提交。

**4. 每个任务同时最多一个 invocation**［scheduler］。`#createInvocation` 以 `TaskId` 为键写入 `#invocations`（832），`#reserve` 先跳过已有 invocation 的任务（709）。`#end` 只在登记对象确实是自己时才删除（1031），避免误删后来者的登记。

**5. 写入的准入规则**［scheduler + harness］。`run` 模式的 invocation 只能写一个仍为 `running` 的任务，且该任务不能带持久 abort 标记（1200-1206）；invocation 结束后所有能力（包括 `now()`/`report()`）都以 `Task ${id} invocation has ended` 拒绝（1172-1179、1293-1295）。**取消一个调用方的等待不会取消被共享的工作**：Harness 层用 `withoutAbortSignal` 隔离调度器 context（`src/harness/harness.ts:198`），`boundConversation` 则把 invocation 的 signal 叠加到调用方 context 上（380）。

**6. invocation 在「决定它结束的那一步」内结束**［scheduler］。`#step` 在回调内部调用 `#end`（947），所以 runtime 在决定之前排队的提交要么已经落地、要么之后被拒——不存在「决定之后写进来」的中间态。这一点由 `test/harness-tasks.test.ts:572` 断言。

**7. 取消有两条来源、一个闩锁、一个方向**［scheduler］。来源是显式 `abort()`/`abortConversation()` 与自底向上的 `cancellationIntent`（1242-1245：非终态且（abort 标记 或 非 `completed` 结局））；闩锁是单向的 `abortRequested`（290 的 `if (!current.abortRequested)`）；方向是**自底向上执行**——被标记的任务先等它拥有的普通工作排空，才轮到 abort handler（749、617-631）。abort handler 必须自己写出终态，否则被写成 `faulted`（927-928）。

**8. `completing` 的定义是「结局已定 + 普通 owned work 未排空」**［scheduler］。判定函数是 `#ownedLive`（613-631）：每个 live 非 `background` 任务为它上方的 owner 计数，**直到并包含第一个 `background` 的 owner**。因此 `background` 只保护自己与自己的祖先、不保护自己的子工作；`completing` 记录不参与重新接管（41-45、710）。

**9. 等待必须「有可能结束」**［scheduler］。wait 的入口校验拒绝三类死锁：abort handler 不能 wait（1010）、不能等自己或祖先（1016-1018）、`failFast` 只能等自己直接拥有的任务（1021-1023）；成员不存在会抛 `Task ${id} does not exist`（1019-1020）。

**10. 所有「推导状态」都可重算，且重算幂等**［scheduler］。`#reconcile` 失败时恢复 `#cascadePending` 与 `#failFastChecks`（473-478），`#drain` 在失败后重排未消费的唤醒（693-694），`#reserve` 失败时撤销本趟创建的 invocation（735-738），`mark` 与 `#finalize` 都收敛到不动点（453、497）。没有一条推导结果被当作「一次性」消费掉。

**11. 崩溃恢复的语义 = 「重算记录蕴含的意图」**［scheduler］。持久记录是唯一真相来源（437-439）；`open()` 之后的第一次 reconcile 会补齐崩溃遗留的 abort 标记与被扣住的结局（253-255）。死在 reservation 那笔提交里的任务留下的记录仍是 `pending`，见 `test/harness-tasks-recovery.test.ts:379-390`。

**12. 边界（必须记住的否定式）**［harness］。`background` 任务不阻止空闲（1041）；未加载的 owner 边**会**阻止空闲（1041 的 `!== false`）；`memos` 在结局决定时被摘除（1297-1302）；`Harness.open` 之后调度器是 `paused`（`src/harness/scheduler.ts:797`、`src/harness/harness.ts:426`）；`Harness.close` 不写任何任务结局（327-330）。

**13. 性能相关的显式取舍**［scheduler］。分页大小 256（51）用于 `open` 的全表扫描与提交扫描；registry 快照每趟 `#reserve`/每 phase 只取一次（707、896）；`#failedMigrations` 阻止对同一失败迁移的重复尝试（778-779）；`sleep` 用 `MAX_TIMER_DELAY`（2_147_483_647，53）分片且每段之后重新读时钟（1220-1225）；`#loadScopes` 只在需要时做，`queued` 扫描仅在可能级联时才跑（450、523）。

**14. 平台差异**［scheduler］。本文件没有平台分支：`delay`、`AbortSignal.any`、`Promise.withResolvers` 都是运行时无关原语（1312-1324、820、1219）。内存 / JSONL / SQLite 的差异被 `Storage` 接口吸收，调度器只通过 `tx.scanTasks`、`storage.task`、`scanSubmissions` 等统一入口访问。

#### 相关测试

本节的行为主要由 `test/harness-tasks.test.ts`、`test/harness-tasks-recovery.test.ts`、`test/harness-ownership.test.ts`、`test/harness-lifecycle.test.ts`、`test/harness-inspect.test.ts` 断言（总览见 6.1 节，精选断言见 6.2 节，崩溃恢复设计见 6.3 节）。

**`test/harness-tasks.test.ts`**（1340 行，五个 describe）：`task phases`（86）、`task runtime`（471）、`task scheduling`（694）、`task abort`（864）、`task close`（1110）。与本节强相关的条目：

- `:572` "orders runtime commits against the step: one queued before it lands, one after it rejects" —— 直接证明不变式 6（runtime 提交与 step 的先后顺序）。
- `:695` / `:723` "retries reservation on the next wakeup after a rejected reservation commit" / "keeps a wakeup that arrives while a rejected reservation commit is in storage" —— 对应 `#reserve` 的撤销逻辑（735-738）与 `#drain` 的重排（693-694）。
- `:746` "reruns a task whose fault write was rejected" —— `#step` 写 `faulted` 失败后任务仍会重跑。
- `:767` "waits for Harness and conversation idleness, counting blocked work and ignoring background tasks" —— 断言被 gate 住、尚未开跑的工作算 live（779）、取消一个等待只拒绝那个等待（783）、`root.waitForIdle` 在别处还有工作时仍不兑现（789-793）、`background` 任务在 Harness 已空闲时仍是 `running`（795-798）、close 后两个 `waitForIdle` 都抛 `closed`（800-801）。
- `:804` "rejects unknown tasks and reports terminal tasks" —— `getTask` 对未知 id 返回 `undefined`（810），`waitForTask`/`abortTask` 抛 `does not exist`（811-812），已终态任务 `abortTask` 返回 `"terminal"`（817），close 后 `resume()` 抛 `closed`（819）。
- `task abort` 组的 `:909`、`:946`、`:968`、`:1003`、`:1084` 覆盖 abort 标记在 phase 中/预订中落地、abort handler 抛错或不写终态被 fault、以及「abort 标记赢过竞争的 fault」。
- `task close` 组的 `:1111`–`:1322` 覆盖关闭时不写结局、不启动新的 phase 或 abort invocation、以及关闭与在途提交/预订的交互。

**`test/harness-tasks-recovery.test.ts`**（857 行）：`task recovery`（111）、`task crash recovery`（223）、`blocked tasks`（399）、`definition handover`（576）、`Harness open`（826）。要点：

- `:379` "crash while the reservation commit is in storage: the task is still pending" —— 重启后 `getTask(id).state.status === "pending"` 且没有任何 handler 跑过（389-390），随后 `abortTask` + `resume()` 只跑 abort handler（391-394）。
- `:400` "keeps a task with a missing definition pending, and live for idle waits, until registration" —— `missing_task` 的任务既保持 `pending`、又**继续阻止空闲**；注册定义后自己终结为 `completed`（406-414）。
- `:418` "keeps a task stored by a newer version pending until a fitting definition is registered"（`task_too_old`）；`:432` "migrates at reservation, leaves the record unchanged when migration fails, and retries only for a new definition"（`migration_failed`）。
- `:497`、`:521`、`:553` 覆盖 `orphaned` 的三种来路：被标记但没有定义、运行中定义消失、重开后无定义。
- `definition handover` 组的 `:627`–`:782` 覆盖 `#decide` 第 5 条规则：同版本替换、带迁移的升级、迁移失败保持 blocked、替换不可用时继续用旧定义跑。

**`test/harness-ownership.test.ts`**（965 行）：`ownership`（172）与 `owned conversations from tools and supervisors`（591）。要点：

- `:173` "keeps a conversation busy while its owned foreground subtree has live work, holding the completed owner" —— 已 `completed` 的 owner 仍显示为 `completing`，`waitForIdle` 直到内部工作终结才兑现（177-184），即不变式 8。
- `:188` "stops idle traversal at a background owner" —— 背景子树不影响外层空闲判定，它自己是一个 scope（193-195）。
- `:200` "cascades an abort mark to the owned foreground subtree and withdraws its queued inputs" —— 标记 owner 后 owner/inner/deeper 的结局都是 `aborted`，而 `shielded`（background）不在其中（209-211）。
- `:224`、`:266`、`:305` 分别覆盖「失败的 owner 级联、完成的 owner 不级联」「在被扣住的失败 owner 之下新建的工作会被取消，终态 owner 之下不会」「嵌套 background owner 的子树在它被取消时被保留」。
- `:319`、`:357`、`:410`、`:522`、`:559` 覆盖「重开后要先加载 owner 边才能判定空闲」「崩溃遗留标记的推导」「重开后经未加载边 admit 的工作」「提交被拒时重试标记与级联」。

**`test/harness-lifecycle.test.ts`**（613 行）：`Harness open`（84）、`Harness close`（126）、`scheduling on a paused Harness`（515）、`registry changes before resume`（589）。要点：

- `:533` "never schedules from a read-only viewer" —— 把 `inspect`、`getTask`、`usage`、`conversation`、`snapshot`、`submission.status`、`agent`、`context`、`entries`、各类 watch 全跑一遍，任务**一次都没跑**（560），且 `inspect().scheduling === "paused"`（561）。这是「读不推进」的反证。
- `:565` "schedules from every progress call" —— 逐个验证七个入口能启动调度：`submit`、`compact`、`abort`、`Conversation.waitForIdle`、`submission.wait`、`Harness.waitForTask`、`Harness.waitForIdle`（566-575）。这是「调度器何时被启动」的测试答案。
- `:590` "runs what the registry holds at resume: a definition installed or replaced after open" —— 打开时 `inspect` 报 `blocked / missing_task`（600-602），装上定义后报 `ready`（604），resume 后实际执行的是**最后安装的那个**定义（610 的 `expect(log).toEqual(["v2"])`）。
- `Harness close` 组的 `:127`、`:197`、`:230` 覆盖「忽略信号的 handler 也要被 join」「close 解决后同一 Storage 可重新打开且旧 invocation 代码不再跑」「被取消的 close 仍继续关闭、第二次 close 等同一个 shutdown」。

**`test/harness-inspect.test.ts`**（162 行）：`Harness.inspect()`（38）。`:39` "derives every live task's state without running task code" 与 `:145` "lists unsettled submissions"，分别对应 `#inspectTask`（801-816）与 `HarnessImpl.inspect`（248-256）的语义。

**相邻测试**：`test/harness-tools-recovery.test.ts`、`test/harness-generation-recovery.test.ts` 覆盖 4.3 之外（工具与生成栈）的恢复语义；`test/harness-live-deltas.test.ts`、`test/harness-task-graph.test.ts` 覆盖观察面。

---

## 4.4 harness/ 生成栈

这一节覆盖一次 run 真正跑起来之后用到的 6 个文件：`generation.ts` 驱动请求与工具轮，`tool.ts` 执行单个 tool call，`compaction.ts` 在压力下改写模型上下文，`inbox.ts` 决定排队输入在哪个边界进入 transcript，`live.ts` 把「现在在跑什么」投影成可观察的文档，`usage.ts` 记账。提示词渲染、agent/settings 解析、上下文派生分别在 `prompt.ts`、`agent.ts`、`context.ts`（见 4.5 节），本节只描述生成栈如何调用它们。三个内建任务的整体行为见 3.2–3.4 节，工具轮与 run 的边界见 3.5 节。

### 4.4.1 src/harness/generation.ts

`pi.generation` 是一次模型请求的持久状态机：准备提示词与工具清单、发起流式请求或轮询 deferred 响应、按策略重试或转入 compaction、分类终态消息，并在需要时建立工具轮、等待子任务、按 `terminate` / `handoff` / boundary 结束或交接 run。run 的输入列表不放在任务 input 里，而在 `pi.live.run`（任务 input 恒为 `{}`），因此「谁负责结清这次 run 的 submission」在崩溃重开后仍可从文档读出。所有 `pi.assistant` 条目都经由本文件的 `appendAssistant()` 写入，`pi.usage.models` 的完整性由这一点保证（见 2.20 节）。

#### 导出面

```ts
export type GenerationInput = Record<string, never>;

export type GenerationCheckpoint =
  | { phase: "prepare"; attempt: number;
      compacted?: TaskId<CompactionResult>;   // 本次 generation 等待过的阻塞 compaction
      overflow?: string };                     // 触发该 compaction 的溢出错误文本，prepare 恢复时检查一次
  | { phase: "request"; attempt: number; compacted?: TaskId<CompactionResult>;
      model: ModelRef; thinkingLevel: ModelThinkingLevel;
      streamOptions: ConversationStreamOptions; // 准备时提交的设置快照，恢复时原样复用
      cutoff: EntryId };                        // 本次请求包含到的最新条目
  | { phase: "retry"; attempt: number; compacted?: TaskId<CompactionResult>; until: number }
  | { phase: "poll"; attempt: number; compacted?: TaskId<CompactionResult>;
      model: ModelRef; cutoff: EntryId; handle: DeferredHandle; pollAt: number }
  | { phase: "tools"; assistant: EntryId;                    // tool-calling 的答案条目
      tools: TaskId<ToolTaskResult>[];                       // 已创建的 tool task，按调用顺序
      pending: string[] };                                   // 串行轮里尚未启动的 callId

export type GenerationResult = { entryId: EntryId };          // 答案解析或 tool-calling 答案的条目

export const GenerationTask = defineTask<GenerationInput, GenerationCheckpoint,
  GenerationResult, GenerationHooks>({ name: "pi.generation", version: 1, ... });
```

- `initial()` 返回 `{ phase: "prepare", attempt: 1 }`（`src/harness/generation.ts:119`）；`compacted` 一旦出现就随 checkpoint 一直携带到 `request` / `retry` / `poll` / 下一次 `prepare`，用于保证「一次 generation 只启动一次 compaction」。
- `convertPartial(tx, live, conversationId)`：把 `pi.live.generation.message`（节流提交的流式 partial）转成 `stopReason: "aborted"` 的 `pi.assistant` 条目；调用方负责随后替换或删除 `generation`（`src/harness/generation.ts:353-358`）。
- `startRun(tx, conversationId, live, inputs)`：为已 placed 的 input submission 创建 conversation-owned 的 `pi.generation` 并写 `live.run = { taskId, inputs }`（`src/harness/generation.ts:662-669`）。
- `handOver(live, from, to)`：仅当 `live.run.taskId === from` 时把 run 交给 `to`，inputs 不动（`src/harness/generation.ts:677-679`）。

`GenerationHooks`（`src/harness/types.ts:592-606`）的调用点与返回值用途：

| hook | 调用位置 | 返回值如何被使用 |
|---|---|---|
| `beforeRequest({ messages })` | `request` 阶段、流式请求之前（`generation.ts:198-201`） | 返回 `{ messages }` 则**仅替换本次请求**；工具轮的 offered tools 仍按提交态上下文计算（见「不变式与边界」第 8 条） |
| `afterResponse(message)` | 分类之前（`generation.ts:449`） | 只观察；deferred 结果不算终态，不会触发 |
| `onYield(answer)` | `answer()` 里、final boundary 之前（`generation.ts:514-517`） | 第一个 `{ continue }` 胜出，条件满足时追加一条 `pi.user` 并把 run 交给后继 generation |
| `afterTools(assistant, results)` | `finishToolRound()` 里、轮收尾 commit 之前（`generation.ts:610`） | 只观察；`results` 按 slot 顺序给出本轮结果条目 |

#### 关键流程

`phases` 只有 5 个键，但每个键在不同 checkpoint 下走不同分支，实际状态转移如下表。

| phase | 进入时 checkpoint | 这一步做什么 | 提交什么 | 可能的下一状态 |
|---|---|---|---|---|
| `prepare` | `{ attempt, compacted?, overflow? }` | 解析 agent/settings、检查阻塞 compaction 结果、派生上下文、渲染 sections、规划 `pi.system`、估算阈值 | 或创建阻塞 compaction 并等待；或追加 planned `pi.system` 条目后转 `request` | `request` / `prepare`（重跑）/ `failed(no_model)` / `failed(model_error)` |
| `request` | `{ attempt, model, thinkingLevel, streamOptions, cutoff }` | 转换残留 partial、发请求、消费流 | 流式 partial（节流）+ 一次分类决定 | `poll` / `tools`（`waiting`）/ `retry` / `prepare`（溢出压缩）/ `completed` / `failed` |
| `retry` | `{ attempt, until }` | `sleep(until)` | 下一次 `prepare` 的 checkpoint 与 `generation.attempt = attempt+1` | `prepare` |
| `poll` | `{ attempt, model, cutoff, handle, pollAt }` | `sleep(pollAt)` 后 `fetchDeferred` | 仍 deferred 则更新 `pollAt`；否则同 `request` 的分类 | `poll` / `tools` / `retry` / `prepare` / `completed` / `failed` |
| `tools` | `{ assistant, tools, pending }` | 串行轮启动下一个 call 并等待；`pending` 为空时收尾 | 新 `pi.tool` 任务 + 槽位 `taskId`；或轮的终态（含 boundary 应用） | `tools`（再次 `waiting`）/ `completed` |
| （abort handler） | 任意 | poll 时 `cancelDeferred`；为未启动的 call 写 `aborted` 结果 | `endRun(unanswered/aborted)` | `aborted` |

**1. `prepare`：请求前的所有决定（`generation.ts:126-183`）**

1. `runtime.agent(context)` 解析 agent，`runtime.settings` 取一次设置；缺 model 或 `models.getModel()` 不认识它 → `failNoModel()`（`reason: "no_model"`，同时把 run 的 inputs settle 为 `unanswered`）。
2. 若 checkpoint 同时带 `compacted` 与 `overflow`（上一次是溢出转 compaction）：读该 compaction 的 outcome；不是 `completed` 或没有 `entryId` → 用溢出文本 `failModelError()`；否则继续。阈值型阻塞 compaction 不带 `overflow`，所以不管它是否产出了摘要，都会照常发请求。
3. 派生上下文（`runtime.context()`，见 2.6 节），`replaySections(view.messages)` 得到当前生效的 section 文本；随后 `renderSections()` 渲染 agent 的全部 section（返回 `undefined` 的省略，其余按 `<key>…</key>` 包裹），某个 section 抛错时保留其旧文本并 `runtime.report()`。
4. `planSystemEntries(view, desired, agent.tools, now)` 规划要追加的 `pi.system` 条目：正常路径写**最小差量**（值变化、`null` 删除、新增、必要时的顺序重写），只有「存在 head marker 且它之后没有 `pi.system` 条目」时才写完整 baseline 并 `omit` 掉范围内的旧系统条目（细节见 4.5 节）。
5. 阈值判定（`thresholdCompaction`，`generation.ts:307-324`）：仅当 compaction 启用、`model.contextWindow > 0`、`compacted` 缺失时计算。
   - 估算 `estimateContext(view, planned 的 system 消息)`：以「head 之后、usage 非零的最新 assistant」的 `calculateContextTokens()` 为基准，加上其后每条上下文消息与计划中的 system 消息的 `estimateMessageTokens()`；没有这样的 assistant 就全量估算。
   - `blocking = contextWindow - reserveTokens`，`background = blocking - backgroundTokens`；估算值超过 `blocking` → `"blocking"`；否则 `backgroundTokens > 0` 且超过 `background` → `"background"`。
   - 两种阈值都要求 `selectCut()` 能找到切点，否则视为没有可压缩内容。
6. `"blocking"`：一个独立 commit 创建 owner 为当前 generation 的 compaction（reason `"threshold"`）并 `waiting` 它（`allSettled`），checkpoint 回到 `{ prepare, attempt, compacted }`。注释点明：transcript 在该 compaction 追加摘要之前不会变化，所以 `prepare` 会完整重跑。
7. 正常提交（一个 commit）：`cutoff` 先取「当前最新条目」，随后每追加一条 planned `pi.system` 就更新为它的 ID，因此 `cutoff` 就是本次请求能看到的最新条目；若会话里没有任何条目则抛 `Conversation <id> has no entries to send`。同一 commit 里若阈值是 `"background"` 且 `pi.live.compactions` 仍为空，则创建 conversation-owned 的 compaction（generation 不等待）。最后写 checkpoint `{ phase: "request", attempt, compacted?, model, thinkingLevel, streamOptions: settings.stream, cutoff }`——这些值对本请求固定。

**2. `request`：请求准备与 provider 身份（`generation.ts:185-211`）**

1. 先在一个 commit 里 `convertPartial()`（把上次被打断的 partial 落成 aborted 条目）并写 `live.generation = { attempt }`；随后重新 `getModel()`，模型消失则 `no_model`。
2. `runtime.context(conversationId, context, cutoff)` 按 checkpoint 的 `cutoff` 取上下文——重试/恢复后重发的是**同一批消息**。
3. `beforeRequest` 链逐个调用，返回的 `messages` 覆盖本次请求的消息。
4. 组装 `SimpleStreamOptions`：设置的 `streamOptions` 快照 + `signal: runtime.signal`（invocation 的 AbortSignal）+ `sessionId: await ensureProviderSessionId(...)` + 当 `thinkingLevel !== "off"` 时的 `reasoning`。provider 身份来自 `pi.provider` 文档：正常路径只读不写，legacy 会话缺该文档时用一个迁移 commit 触发 `initial()`（`uuidv7`），fork 使用 `fork: "initial"` 因此每个 fork 有独立身份（`src/harness/provider.ts:22-39`）。
5. `streamResponse()` 发起请求并消费流，返回终态 `AssistantMessage`；`classify()` 用它做全部决定。传给 classify 的 `Request.messages` 是**替换前**的 `view.messages`，工具轮用它 replay offered tools。

**3. 流式消费与 100ms 节流（`generation.ts:364-415`）**

- 常量 `PARTIAL_THROTTLE_MS = 100`（`generation.ts:109`）。
- 事件循环跳过 `done` / `error` 事件与 `content.length === 0` 的 partial（pi-ai 的开场 `start` 事件没有内容，deferred 响应也永远越不过它，所以不会留下 partial）。
- 最新 partial 存在局部 `pending`；当「没有定时器且没有 in-flight 提交」时排一个 100 ms 的 `flush`。`flush()` 先同步 `copyJson(partial, { omitUndefinedProperties: true })`（provider 会继续改动同一个对象），再在 commit 里 `live.generation ??= { attempt }` 并用 `assignJson` **逐叶**写 `message`：Chord 只记录文本叶片的 append，而不是整条消息的 set。
- 同一时刻最多一个提交在飞；提交完成后若期间又有 `pending` 且未 stopped，再排一个 100 ms 定时——窗口内的多次变化合并成一次提交。
- `finally` 置 `stopped = true`、清定时器、`await inFlight`，保证分类开始前不再有旧 partial 落地。

**4. 分类、重试与溢出（`classify`，`generation.ts:418-505`）**

顺序固定，每一步都有意义：

1. `runtime.signal.throwIfAborted()`：abort 标记或 Harness 关闭时，交给 abort 处理器 / 重开后的 run 处理。
2. `stopReason === "deferred"` 且有 handle → `pollAt = max(now + (handle.pollAfterMs ?? 5000), 上次 pollAt + 1)`，写 `live.generation = { attempt, deferred: { pollAt } }`，转 `poll`。
3. `afterResponse` 链（只观察）。
4. `stopReason === "toolUse"` 且有 `toolCall` → `startToolRound()`。
5. `stop` / `length` / **没有 call 的 `toolUse`** → `answer()`。
6. 溢出：`stopReason === "error" && isContextOverflow(message)`（durable 只传一个参数，因此只匹配错误文本类溢出；`stop` 型「静默溢出」不在此判定，交给下一次阈值检查）。条件还要求 `compacted` 缺失、compaction 启用、`selectCut()` 有切点；满足则一个 commit 追加错误条目、移除 `generation`、创建 owner 为 generation 的 compaction（reason `"overflow"`），checkpoint 回 `{ prepare, attempt, compacted, overflow }`（attempt 不变，恢复请求不计入重试预算）。
7. 可重试错误：`error` 且非溢出、`isRetryableAssistantError()`、策略 `enabled`、`attempt <= maxRetries` → `until = now + retryDelayMs(policy, attempt)`（pi-ai 的指数退避 `baseDelayMs * 2^(attempt-1)`，上限默认 60 s），写 `generation.retry = { at, error }`，转 `retry`。
8. 其余（非重试错误、没有 abort 标记的 `aborted`、第二次溢出、溢出但压缩不可用）→ 追加错误条目，`endRun(unanswered/model_error)`，任务 `failed`。

`retry` 阶段 `sleep(until)` 后**回到 `prepare`**（attempt+1），因此退避期间的 agent/settings 变化在下一尝试生效；`poll` 阶段 `sleep(pollAt)` 后 `fetchDeferred()`，仍 deferred 则 `pollAt` 严格增大。

**5. `answer` 与 `onYield`（`generation.ts:512-537`）**

1. `onYield` 链取第一个 `{ continue }`。
2. 一个 commit：`prepareBoundary()`（队列模式在 Session 线上读取）→ 追加答案条目 → `applyBoundary(..., "final")`。
3. 若 continuation 存在且 final boundary **没有**选中任何 user 项、也没有 reset：追加一条 `pi.user`（内容为 continuation），创建后继 generation 并 `handOver`，run 与 inputs 保持打开——这次 run 会被后继 generation 的最终答案结清；被丢弃的 continuation 不会重试。
4. 否则 `endRun(done, answer = 条目)`；若 boundary 选中了 user 项就 `startRun()` 起新一轮。

**6. 工具轮的建立与等待（`startToolRound` / `tools` 阶段）**

`startToolRound`（`generation.ts:544-589`）在一个 commit 里完成：

1. offered tools 用 pi-ai `getCurrentTools()` 从提交态消息 replay（`request` 已持有，`poll` 重新派生）；调用名不在其中 → 立刻写 `tool_unavailable` 结果并让该槽位 `done`，**不建任务**。
2. 串行判定：设置的 `toolExecution === "sequential"`，或任一（被 offered 且被调用的）工具声明了 `executionMode: "sequential"`——在轮开始时读一次并固定。
3. 每个剩余调用创建一个 `pi.tool` 任务，input `{ assistant, callId }`，owner 是本 generation。串行轮里只有**第一个实际创建了任务之后**的调用进入 `pending`；并行轮所有调用立刻建任务。
4. 同一个 commit 里追加 tool-calling 答案、删 `live.generation`、写 `live.tools` 槽位数组（`pending` / `done`），checkpoint 转 `{ phase: "tools", assistant, tools, pending }` 并 `waiting`（`allSettled`）；`pi.live.run` 仍挂在本 generation 上。

`tools` 阶段（`generation.ts:234-251`）：`pending` 非空则取第一个 callId，一个 commit 创建它的任务、回填槽位 `taskId`、缩短 `pending` 后再次 `waiting`；`pending` 为空则进入 `finishToolRound()`。

**7. 收尾：control、boundary、交接（`finishToolRound`，`generation.ts:595-646`）**

1. `runtime.outcomes(tools)` 读本轮每个任务的终态；`controls[taskId] = completed ? result.control : undefined`。
2. 从 `pi.live.tools` 快照读出 `results`（有 `entry` 的槽位），跑 `afterTools`。
3. `control.terminate` 成立的条件是**每个**槽位都有 `taskId` 且其 control 的 `terminate === true`——`tool_unavailable` 的槽位没有 `taskId`，会让 terminate 失效。`addTools` 合并所有 control 的名单；`control.handoff` 取调用顺序里**最后一个**，它的文本会成为 `pi.reset` 条目里的 user 消息。
4. 一个 commit：先 `prepareBoundary()`；有 `addTools` 就先改 `pi.agent`（数组追加缺失名；`{remove}` 收回名字；`tools` 未设置表示「全部已提供」，不写）。随后分两支：
   - `terminate || handoff`：若有 handoff，追加 `pi.reset`（`head: "self"`，`model` 里带 handoff 文本）并把 `boundary.head` 指到它；`applyBoundary(..., "final")`；`endRun(done, answer = tool-calling 答案)`；有 user 项则 `startRun()`。
   - 否则 `applyBoundary(..., "postTools")`：选中了 reset → `endRun(unanswered/reset)` 并让 user 项起新一轮；否则删 `live.tools`，把选中的 steer ID push 进当前 `live.run.inputs`，创建后继 generation 并 `handOver`。
5. 任务的 result 恒为 `{ entryId: assistant }`。

**8. abort（`generation.ts:254-282`）**

`poll` 阶段先尝试 `cancelDeferred()`（模型已知才调，失败只 `runtime.report`）；`tools` 阶段用 `readCalls()` 取回仍 `pending` 的调用，为每个写一条 `aborted` 结果（它们在轮里从未启动）；随后 `convertPartial()`、`endRun(unanswered/aborted)`、任务 `aborted`。abort 处理器只在它的工具任务全部终态之后运行，因此 `abortTask()` 打在 generation 上等于中止整轮。

#### 关键代码

流式节流（`src/harness/generation.ts:372-399`）：

```ts
	let pending: AssistantMessage | undefined;                    // 最新 partial，等待节流窗口
	let timer: ReturnType<typeof setTimeout> | undefined;
	let inFlight: Promise<void> | undefined;                       // 同时最多一个提交
	let stopped = false;
	const flush = (): void => {
		timer = undefined;
		const partial = pending;
		pending = undefined;
		if (partial === undefined || stopped) return;
		inFlight = (async () => {
			// Copy synchronously: the provider keeps mutating its partial.
			const message = copyJson(partial, { omitUndefinedProperties: true });   // 先同步拷贝
			await runtime.commit(async (tx) => {
				const live = await tx.doc(LiveDoc, runtime.conversationId);
				live.generation ??= { attempt };
				assignJson(live.generation as Draft<Record<string, JsonValue>>, "message", message); // 逐叶写
				return undefined;
			}, context);
		})()
			.catch((error: unknown) => {
				// Rejections after an abort mark or close are expected; the committed state stays consistent.
				if (!runtime.signal.aborted) runtime.report(error);   // abort/close 之后的拒绝属预期
			})
			.finally(() => {
				inFlight = undefined;
				if (pending !== undefined && !stopped) timer = setTimeout(flush, PARTIAL_THROTTLE_MS); // 有变化再排
			});
	};
```

`terminate` / `handoff` / `addTools` 的判定与应用（`src/harness/generation.ts:610-621`）：

```ts
	await runtime.hooks.each("afterTools", (hook) => hook(assistant, results, runtime, context));
	// Every call of the round, including those answered without a task, must ask to terminate.
	const terminate =
		slots.length > 0 &&
		slots.every((slot) => slot.taskId !== undefined && controls.get(slot.taskId)?.terminate === true); // 槽位须有 taskId
	const added = [...controls.values()].flatMap((control) => control?.addTools ?? []);
	// The last handoff in call order wins.
	const handoff = [...controls.values()].findLast((control) => control?.handoff !== undefined)?.handoff;
	await runtime.commit(async (tx): Promise<Next> => {
		const boundary = await prepareBoundary(tx, conversationId, runtime.settings);
		if (added.length > 0) await addTools(tx, conversationId, added);
```

#### 不变式与边界

1. 每个 phase 必须以「改变的 checkpoint 或终态 outcome」提交，否则任务 fault（见 2.7 节）；`classify` 的终态决定与清 partial 在同一个 commit 内完成。
2. `request` / `poll` 重发的请求必须与首次完全一致：消息按 `cutoff` 重新派生、model / thinkingLevel / streamOptions 来自 checkpoint；只有 `prepare` 会重新解析 agent 与 settings。
3. 顺序保证：`afterResponse` 在分类前；`onYield` 在 final boundary commit 前；`afterTools` 在轮收尾 commit 前；`signal.throwIfAborted()` 在 `afterResponse` 之前。
4. 一次 generation 最多启动一个 compaction：`compacted` 字段在 prepare/request/retry/poll 间携带；溢出恢复请求不消耗重试预算（attempt 不变）。
5. 失败不动 inbox：`failNoModel` / `failModelError` / 非重试错误只结清 run 的 inputs 并清 `pi.live`，排队项留待下一次 boundary 或被撤回（见 4.4.4）。
6. fault / orphan 由 scheduler 走 `settleSchedulerOutcome()`：把已提交 partial 转成 aborted 条目，再把 inputs settle 为 `unanswered/faulted`（带 detail）或 `unanswered/<reason>`（见 4.4.5）。
7. 工具轮里「未提供」与「已提供但任务失败」是两种结局：前者由 generation 直接写结果条目、槽位 `done`；后者槽位 `done` 但可能没有 `entry`，由上下文派生合成缺失结果，run 继续（见 4.4.2、4.4.5）。
8. `beforeRequest` 替换消息只影响本次请求内容，工具轮的 offered tools 仍由提交态上下文 replay 得出；若 hook 替换掉了工具声明，工具轮看到的是提交态版本。
9. abort 处理器不得返回 `waiting`，也不能创建受级联的子任务（见 2.8 节），因此 generation 的 abort 只做内联补偿。

#### 相关测试

- `test/harness-generation.test.ts`：input → answer → submission `done`（`pi.user` → `pi.system` → `pi.assistant` 顺序、条目的 `byTaskId` 归属、任务 outcome）；partial 以 delta 提交、终态提交写 base；`no_model` 的两种情况；可重试错误退避后成功、预算耗尽后 `model_error`、策略关闭不重试；section 抛错只上报；deferred 轮询与 abort 时取消、取消失败仍 `aborted`；stream options 与 thinking level 透传；provider sessionId 请求级隔离与 legacy 迁移；settings 每次决策读取；fault 与 orphan 的 run 清理。
- `test/harness-generation-recovery.test.ts`：`prepare` 未提交即中断则重跑；`request` 未产生 partial 即中断则重发且不重复 `prepare`；已有 partial 则转 aborted 条目并重发同一批消息；retry 退避与 poll 跨 reopen 继续；pinned model 消失 → `no_model`。
- `test/harness-live-deltas.test.ts`：交接与工具启动的精确 Chord op；`generation.message` 以 append 写入；无运行物时写完整 base。
- `test/harness-tools.test.ts`（generation hooks 部分）：`beforeRequest` / `afterResponse` / `onYield` 的行为与 memo 持久化。
- `test/harness-compaction.test.ts`：阈值与溢出 compaction 与 generation 的交互、`stale` 与计费。

### 4.4.2 src/harness/tool.ts

`pi.tool` 是单个 tool call 的持久状态机，形状是「意图—执行—结果」三明治：解析工具、修复并校验参数、跑 `beforeTool`，在 commit 里记下**意图**（最终参数与 replay 策略）并把 `pi.live.tools` 的槽位置为 `running`，随后在同一个 handler 里执行、跑 `afterTool`、把结果写成 `pi.tool-result` 条目并结算槽位。`phase: "execute"` 只由恢复进入，且只有「存储的与当前的 replay 策略都为 `safe`」才真正重跑；否则用槽位里已提交的 partial 输出写一条 `interrupted` 结果。工具返回 `isError` 仍算任务 `completed`，只有执行抛错或被中断才让任务 `failed`（后者记录取消意图，会终止该调用拥有的会话）。

#### 导出面

```ts
export type ToolTaskInput = { assistant: EntryId; callId: string };   // 调用从 assistant 条目读回，input 保持小

export type ToolTaskCheckpoint =
  | { phase: "call" }
  | { phase: "execute"; arguments: JsonObject; replay: "safe" | "unsafe" };  // 意图：最终参数 + replay 策略

export type ToolTaskResult = { entryId: EntryId; control?: ToolControl };

export const ToolTask = defineTask<ToolTaskInput, ToolTaskCheckpoint,
  ToolTaskResult, ToolHooks>({ name: "pi.tool", version: 1, ... });     // initial(): { phase: "call" }

export function harnessError(code: string, message: string): ToolExecutionResult;
export async function appendToolResult(tx: Tx, conversationId: ConversationId,
  call: ToolCall, result: ToolExecutionResult, timestamp: number,
): Promise<TypedEntry<{ diagnostics: ToolDiagnostic[] }>>;
```

- `harnessError()` 构造「无 content、一个 `error` 诊断」的结果，本文件与 `generation.ts` 都用它写 `tool_unavailable` / `invalid_arguments` / `blocked` / `aborted`。
- `appendToolResult()` 把结构化诊断渲染成 `<harness>\n[severity] message\n</harness>` **追加在 content 末尾**，因此存储的 `ToolResultMessage` 与模型看到的内容完全一致；`data` 保留结构化列表（无诊断时也是空数组）。若结果带 `usage`，同一个 commit 里记进 `pi.usage.tools`（键为工具名，见 4.4.6）。

`ToolHooks`（`src/harness/types.ts:608-623`）——本文件只有这两个 hook：

| hook | 调用位置 | 返回值如何被使用 |
|---|---|---|
| `beforeTool(call)` | `call` 阶段、第一次参数校验之后、写意图之前（`tool.ts:67-77`） | 第一个 `block` 胜出并跳过后续 handler；否则 `arguments` 覆盖当前参数**并重新校验**；hook 抛错且 invocation 未 abort 时，错误文本当作 block 原因 |
| `afterTool(call, result)` | 执行之后、结果条目之前（`tool.ts:346-348`） | 依次替换结果对象（`?? final`），替换后的 content / details / diagnostics / usage / control 全部生效 |

`ToolControl`（`src/harness/types.ts:129-134`）由工具通过结果的 `control` 字段返回，`generation` 在轮收尾时消费：`control.addTools`（把工具名追加进 `pi.agent`）、`control.terminate`（要求整轮终止）、`control.handoff`（带文本的重置，取调用顺序里最后一个）。

#### 关键流程

| phase | 进入时 checkpoint | 这一步做什么 | 提交什么 | 可能的下一状态 |
|---|---|---|---|---|
| `call` | `{ phase: "call" }` | 读回 call、解析实现、修参数、校验、`beforeTool`、再校验 | 或直接写错误结果；或写意图（`execute` + 参数 + replay）并置槽位 `running`，然后继续执行 | `completed` / `failed`（执行抛错）/ `aborted`（abort 处理器） |
| `execute` | `{ phase: "execute", arguments, replay }` | 恢复专用：双 `safe` 时清槽位进度并用存储参数重跑；否则用槽位持久输出写 `interrupted` | 结果条目 + 槽位 `done` | `completed` / `failed` |
| （abort handler） | 任意 | 读回 call | 用槽位持久输出写 `aborted` 结果 + 槽位 `done` | `aborted` |

**1. `call`：从解析到意图（`tool.ts:55-92`）**

1. `readCall()`：`runtime.entry(AssistantEntry, input.assistant)` 取回消息，找 `id === input.callId` 的 `toolCall`；找不到直接抛错——这是程序性 bug 的守卫，会让任务 fault。
2. 在**该 phase 的 agent** 里按名字解析工具。解析不到（包括准备之后被取消注册）→ `settle(..., COMPLETED, () => harnessError("tool_unavailable", ...))`。
3. `prepare()`：调用工具的 `prepareArguments()` 修复模型常犯的参数错误（抛错 → `invalid_arguments`）。
4. `validate()`：`validateToolArguments()` 按 `parameters` schema 校验并强制类型（抛错 → `invalid_arguments`）。
5. `beforeTool` 链（语义见上表）。
6. 被 block → `blocked` 结果，任务 `completed`，**不写意图、不执行**。
7. 第二次 `validate()`；通过后的参数即最终参数。
8. 意图 commit：读槽位并置 `status = "running"`；checkpoint 转 `{ phase: "execute", arguments: final, replay: tool.replay ?? "unsafe" }`。
9. 同一个 handler 里 `await run(...)`——解析与结算之间不被任何等待分开，因此「意图已写但结果未写」是唯一的中断窗口。

**2. 执行：环境、API、输出与进度（`run()`，`tool.ts:169-270`）**

- 输出限制：`tool.outputLimits` 覆盖 `DEFAULT_MAX_BYTES`（50 KiB）与 `DEFAULT_MAX_LINES`（2000），`retain` 默认 `head`（默认值在 `src/truncate.ts:11-12`）。
- 每次执行都重新 `runtime.env(context)`（注释：rerun 拿到的是当时的环境），所以「工具执行时的工作目录」以调用那一刻的会话配置为准。
- `api` 是传给 `execute()` 的 `ToolExecutionApi`：`output()` 写运行输出、`diagnostic()` 记诊断、`details()` 覆盖运行细节、`commit()` / `createTask()` 包一层提交、`memo` / `getTask` / `waitForTask` / `conversation` 直接转发 runtime。所有操作都有 `ended` 门闩：结算之后再调用会抛 `Tool call <id> has settled`。
- 抛错处理：若 invocation 已被 signal（abort），把 `progress.stop()` 的 waiter 全部 reject 并原样抛（不写结果，交给 abort 处理器）；否则写 `tool_error` 结果，并让任务以 `failed` 结束（结果条目仍保留错误文本）。
- `publishProgress()` 把槽位当作**增量视图**维护：text 变化时用「前缀相同则 append」或 `overlap()` 的重叠搜索计算要写的字节；details 用 `assignJson` 逐叶 diff；diagnostics 只追加新增项。节流由 `Progress` 负责：空闲后的第一次变化立刻提交，之后每次提交至少延迟 100 ms，并按写入大小以 100 KiB/s 追加延迟（`src/harness/output.ts:208-288`）。
- `details()` 返回的 Promise 由「包含该变化的进度提交或终态提交」结算；等待被取消时更新仍然留在槽位里。

**3. 结果：边界、诊断与结算（`finalResult()` / `settle()`，`tool.ts:329-388`）**

1. content：工具显式给了 `content` 就用它；否则用运行输出（空窗口 → 空数组）。details 取 `result.details ?? 最后报告的值`。diagnostics 顺序是「`api.diagnostic()` 记录的 → 工具返回的 → Harness 的截断诊断」。
2. `afterTool` 链替换结果对象。
3. 只有当 `afterTool` 保留了运行输出那段 content 时，才把运行输出窗口的丢弃量写成 `truncated` 诊断；随后对显式 content 再做一次边界（合并 text 项为一个 head/tail 窗口），它的丢弃量作为最后一条诊断追加。
4. `settle()` 在一个 commit 里：追加 `pi.tool-result` 条目 → `finishSlot(slot, entry.id)`（槽位 `done`、清掉运行期字段）→ 按 `Ending` 返回 `completed{ entryId, control? }`、`failed{ error, entryId }` 或 `aborted{ entryId }`。`control` 会去掉值为 `undefined` 的键，保证任务结果是 strict JSON。

**4. `execute`：恢复与 replay 规则（`tool.ts:94-111`）**

恢复时若「存储的 `replay` 与当前工具解析出的 `replay`」都是 `safe`：先 commit 清空槽位里上次 attempt 发布的进度，再用**存储的参数**执行（不跑 `beforeTool`，因为参数已经在意图里定稿）。否则写 `interrupted` 结果——content 取槽位的持久输出、details 取槽位 details、诊断 = 槽位诊断 + 截断诊断 + `interrupted`——任务以 `failed` 结束。工具在重开后不再被选择（解析不到）等价于 `unsafe`。

**5. abort（`tool.ts:113-117`）**

用槽位里已提交的输出、details、diagnostics 写一条 `aborted` 结果并结算槽位，任务 `aborted`。缓冲区里尚未提交的输出被丢弃——被 abort 的调用只保留持久化的那部分。

#### 关键代码

`call` 阶段的参数语义与意图（`src/harness/tool.ts:62-91`）：

```ts
			const prepared = prepare(tool, call.arguments as JsonObject);          // prepareArguments：修复模型参数
			const checked = "error" in prepared ? prepared : validate(tool, call, prepared.args);
			if ("error" in checked) return settle(runtime, call, COMPLETED, () => invalid(checked.error), context);
			let args = checked.args;
			let block: string | undefined;
			await runtime.hooks.each("beforeTool", async (hook) => {
				if (block !== undefined) return;                                    // 第一个 block 胜出
				try {
					const decision = await hook({ ...call, arguments: args }, runtime, context);
					if (decision?.block !== undefined) block = decision.block;
					else if (decision?.arguments !== undefined) args = decision.arguments;
				} catch (error) {
					if (runtime.signal.aborted) throw error;                        // abort 后抛错向上传播
					block = errorText(error);                                       // 否则把错误当 block 原因
				}
			});
			if (block !== undefined) {
				const blocked = harnessError("blocked", `Tool call blocked: ${block}`);
				return settle(runtime, call, COMPLETED, () => blocked, context);
			}
			const validated = validate(tool, call, args);                           // hook 改过的参数要重新校验
			if ("error" in validated) return settle(runtime, call, COMPLETED, () => invalid(validated.error), context);
			const final = validated.args;
			await runtime.commit(async (tx) => {
				const slot = toolSlot(await tx.doc(LiveDoc, runtime.conversationId), runtime.taskId);
				if (slot !== undefined) slot.status = "running";                    // 槽位 running 与意图同 commit
				const intent = { phase: "execute", arguments: final, replay: tool.replay ?? "unsafe" } as const;
				return { status: "running", checkpoint: intent };
			}, context);
			await run(runtime, call, tool, final, context);                         // 同一 handler 内执行并结算
```

恢复路径的 replay 判定（`src/harness/tool.ts:94-111`）：

```ts
		execute: async (task, runtime, context) => {
			const { arguments: args, replay } = task.state.checkpoint;
			const call = await readCall(runtime, task.input, context);
			const tool = (await runtime.agent(context)).tools.find((each) => each.name === call.name);
			if (replay === "safe" && tool?.replay === "safe") {                     // 两次策略都为 safe 才重跑
				// The rerun reports from scratch; clear what the interrupted attempt published.
				await runtime.commit(async (tx) => {
					const slot = toolSlot(await tx.doc(LiveDoc, runtime.conversationId), runtime.taskId);
					if (slot !== undefined) clearProgress(slot);                    // 清掉上次 attempt 的进度
					return undefined;
				}, context);
				return run(runtime, call, tool, args, context);                      // 不跑 beforeTool，用存储参数
			}
			const message = `Tool ${call.name} was interrupted and may have partially run`;
			// `failed` records cancellation intent, so the call's owned conversations, left unsupervised, are aborted.
			const ending = { status: "failed", message } as const;
			await settle(runtime, call, ending, (slot) => fromSlot(slot, "interrupted", message), context);
		},
```

#### 不变式与边界

1. 意图之前的任何失败（解析不到、参数无效、被 block）都不产生副作用：只写结果条目，不写 intent、不建环境、不执行。
2. 「可安全重跑」= 存下来的与当前的 replay 策略同时为 `safe`；默认 `unsafe`。恢复重跑不跑 `beforeTool`，因此不能用 hook 在重跑时改参数。
3. `isError` 结果仍 `completed`；只有执行抛错（写 `tool_error`）与中断（`interrupted`）让任务 `failed`，从而取消该调用拥有的会话。
4. 输出边界分两层：运行输出由 `OutputBuffer` 在写入时按 head/tail 窗口保留，`boundContent()` 只再作用于工具显式返回的 content；诊断会说明丢弃的行数与字节数。
5. 结果是 strict JSON：`control` 里的 `undefined` 键被丢弃；工具返回非 JSON 值（例如函数）会让结果 commit 抛错，任务 fault，由 scheduler 清理槽位（见 4.4.5）。
6. `api` 的每个操作在 invocation 结束后 reject；`runtime.commit` 在任务终态、Harness 关闭或 abort 标记后 reject。
7. 槽位更新只在「存在 `taskId` 等于本任务」的槽位时生效；轮结束（槽位数组被删）之后迟到的进度提交变成空操作。

#### 相关测试

- `test/harness-tools.test.ts`：完整轮（`pi.user` → `pi.assistant` → `pi.tool-result` → `pi.assistant`）；未提供的工具不建任务；准备后被取消注册与「实现被取消注册」都得到 `tool_unavailable`；executionMode 在轮开始时读取并固定；并行默认、配置或工具声明要求时串行；retained output / details 回退与诊断顺序；显式 content 的边界；抛错 → `tool_error` 且保留 partial；前后两次校验、block、参数替换；`prepareArguments` 与抛错修复；第一个 block 胜出；`afterTool` 链与 `afterTools` 观察；扩展 hook 选择与 task-owned 子会话继承；`addTools` 与「全部 terminate 才终止」；默认输出限制、输出脱敏、`undefined` control 键、显式 `null` details、`details()` 的合并提交、被替换实现仍用解析时的实现完成本次调用、abort 时只保留持久输出。
- `test/harness-tools-recovery.test.ts`：unsafe 中断后用槽位 partial 回答（并断言 checkpoint 落在 `execute` 与存储的 replay）；只有双 `safe` 才重跑；safe 重跑用 rerun 时的 env、被取消选择则不重跑；未写意图时重跑 `beforeTool` 且只执行一次；`tools` 阶段未提交即中断则重跑；abort 的工具保留 partial 并让 run 继续；faulted 工具由上下文派生合成结果；真实命令跨 close/reopen 的行为；安全重跑前清空进度。
- `test/harness-live-deltas.test.ts`：意图、结果、abort 各阶段对 `pi.live.tools[i]` 的字段级 Chord op；head/tail 窗口的写入形状；faulted 槽位只写 `status = "done"`。

### 4.4.3 src/harness/compaction.ts

`pi.compaction` 用一条带 `head` 的摘要条目替换模型上下文中一段旧前缀：`select` 用纯函数 `selectCut()` 选出「保留最近 `keepRecentTokens`」的切点并把被切掉的消息序列化成文本，`summarize` 用固定（pinned）的请求参数调用 `models.completeSimple()`，`retry` 按设置退避重试。放置方式由 owner 决定：generation 等待的**阻塞型**直接追加条目并返回 `entryId`；conversation-owned（manual / background）走 write submission（`requestId = compaction:<taskId>`）并返回 `submissionId`，摘要何时真正进入 transcript 由 boundary 决定，因此「切点太旧」的摘要会以 `stale` 收场。

#### 导出面

```ts
export type CompactionInput = { reason: CompactionReason; instructions?: string };  // reason: "manual" | "threshold" | "overflow"

export type SummaryRequest = {
  attempt: number; model: ModelRef; thinkingLevel: ModelThinkingLevel;
  streamOptions: ConversationStreamOptions; maxTokens: number;
  tail: EntryId;        // 选择范围时的上下文最新条目
  firstKept: EntryId;   // 第一段逐字保留的条目，也是摘要条目的 head
};

export type CompactionCheckpoint =
  | { phase: "select" }
  | ({ phase: "summarize" } & SummaryRequest)
  | ({ phase: "retry"; until: number } & SummaryRequest);

export const CompactionTask = defineTask<CompactionInput, CompactionCheckpoint,
  CompactionResult, CompactionHooks>({ name: "pi.compaction", version: 1, ... });

export async function createCompaction(tx: Tx, conversationId: ConversationId,
  input: CompactionInput, owner?: TaskId): Promise<TaskId<CompactionResult>>;
export function selectCut(view: ContextView, keepRecentTokens: number): number | undefined;
export function summarizedMessages(view: ContextView, cut: number): Message[];
export function estimateContext(view: ContextView, extra: readonly Message[]): number;
export function serializeConversation(messages: readonly Message[]): string;
```

- `createCompaction()`：`owner` 缺省即 conversation-owned，`background = owner === undefined && reason !== "manual"`；任务与它的 `pi.live.compactions` 状态在同一个 commit 里出现（状态含 `reason`、`blocking`、`attempt: 1`）。
- `CompactionResult`（`src/harness/types.ts:385-389`）：阻塞型的摘要给 `entryId`，conversation-owned 的给 `submissionId`，没有可压缩内容时两者都缺。
- `selectCut()` 返回「第一个逐字保留条目的下标」，`undefined` 表示没有可压缩内容；`summarizedMessages()` 按模型上下文顺序给出被摘要的条目消息（供 `beforeCompact` 观察与序列化）；`estimateContext()` 是 generation 阈值用的请求大小估算。
- Hook `CompactionHooks.beforeCompact`（`src/harness/types.ts:626-642`）：范围选择之后、摘要之前；参数含 `reason`、将被替换的 `entries`（head marker 第一）、摘要来源 `messages`、`firstKept` 与可选 `instructions`；返回 `{ decline: true }` 或 `{ summary }`，**第一个决定胜出**。

#### 关键流程

三种触发方式（owner / background / 是否等待 / 放置）：

| 触发 | owner | background | generation 等待 | 放置 |
|---|---|---|---|---|
| `Conversation.compact()`（reason `manual`） | conversation | 否 | 否 | write submission，能进队列 |
| generation 超过 background 阈值（reason `threshold`） | conversation | 是 | 否 | write submission |
| generation 超过 blocking 阈值，或收到溢出（reason `threshold` / `overflow`） | 该 generation | 否 | 是（`allSettled`） | 直接 append |

阻塞型独有的保证是「会话里没有别的写入者」：generation 正拿着 run 并在等待，所以它可以直接追加摘要；其余两种都必须经过 admission，才不会破坏「只有一个写入者往 busy 会话追加」的规则。

**1. `select`（`compaction.ts:108-147`）**

1. 解析 agent 与 settings；无 model 或模型未知 → `no_model` 并移除状态。
2. 派生当前上下文并 `selectCut(view, keepRecentTokens)`；没有切点 → `completed({})`（什么都不压缩）。
3. `firstKept = entries[cut].id`；构造 hook 载荷（`entries` = 切点之前的活动条目，`messages` = 它们的模型消息）。
4. `beforeCompact` 链：`decline` → `completed({})`；给出 `summary` → 在自己的 commit 里放置并完成。
5. 否则构造 pinned 请求：`attempt: 1`、agent 的 model 与 thinking level、settings 的 stream options、`maxTokens = min(floor(0.8 * reserveTokens), model.maxTokens > 0 ? model.maxTokens : ∞)`、`tail` = 当前上下文的最新条目、`firstKept` = 切点。
6. 一个 commit 转 `summarize`。

`selectCut()` 的规则（`compaction.ts:255-295`）：候选是「贡献第一条消息是 user 或 assistant」的非 marker 条目；tool result 与 `pi.system` 永不是候选，因此保留下来的 assistant 一定连着自己的结果；一个 user 条目若「它之前的 assistant 的某个调用的结果」还在它之后、下一个 assistant 之前，也不是候选。从尾往前累加每条贡献的 `estimateMessageTokens()`，达到 `keepRecentTokens` 后取「在或晚于该下标的第一个候选」，没有就取最新候选；若切点之前没有任何条目贡献模型消息，则视为没有可压缩内容。

**2. `summarize`（`compaction.ts:148-207`）**

1. 按 `tail` 重新派生上下文——`tail` 处的上下文不可变，所以范围与 `select` 时一致——再定位 `firstKept` 的下标。
2. 请求只有两条消息：内置的摘要系统提示，以及 `user` 消息：`<conversation>` 包裹的序列化文本 + 内置的结构化摘要提示（Goal / Constraints、Progress、Key Decisions、Next Steps、Critical Context），带 `instructions` 时追加 `Additional focus: …`。序列化把 user / assistant thinking / assistant 文本 / tool calls（`name(key=json, …)`）/ tool result（截断到 2000 字符）写成纯文本，`pi.system` 消息省略。
3. 请求选项：pinned 的 stream options 去掉 `deferred`、强制 `cacheRetention: "none"`、pinned `maxTokens`、invocation signal、持久 provider `sessionId`、thinking level 作为 `reasoning`。恢复时重发同一请求。
4. `models.completeSimple()` 之后 `throwIfAborted()`，再用 `summaryText()` 判定：只有 `stopReason === "stop"`、无 tool call、文本非空才算摘要。
5. 一个 commit 里：**先记 usage**（无论成功失败），有摘要就放置；否则按 retry 策略决定转 `retry`（同时更新状态的 `retry`）或移除状态并以 `model_error` 失败（错误文本区分 error/aborted、`length`、调用了工具、没有文本四种原因）。
6. `retry` 阶段 `sleep(until)` 后 attempt+1，pinned 请求原样复用。

**3. 放置与 `stale`（`compaction.ts:407-436`）**

摘要条目形状是 `{ kind: "pi.compaction", head: firstKept, model: [user(前缀+摘要+后缀)], data: { reason } }`，前缀/后缀把摘要包成「The conversation history before this point was compacted into the following summary: … <summary>…</summary>」。放置时先移除任务状态，再按 owner 分两支：conversation-owned 调 `admitSubmission()` 写入一条 `requestId = compaction:<taskId>` 的 write submission（idle + 空 inbox 立即落库，busy 或 inbox 非空则排队等下个 boundary），完成时返回 `submissionId`、**不等**放置；阻塞型直接 `appendEntry()`，返回 `entryId`。

`stale` 由 head 语义自动产生：摘要条目带 `head: firstKept`，而 boundary 会拒绝「目标早于当前活动范围起点」的 head write。因此两个并发压缩不需要互相协调——切点更靠后的摘要把更早的摘要判成 `stale`；切点相同或更晚的则能落地（先落地的那个决定了活动范围起点）。

**4. 取消（`compaction.ts:222-227`）**

abort 处理器只移除 `pi.live.compactions` 里的状态并结束 `aborted`，不写任何条目；被 abort 或崩溃打断的尝试没有提交响应，因此不计 usage。manual compaction 是会话的 ordinary work，`Conversation.abort()` 会 abort 它并撤回其尚在队列的摘要；background 只由 `abortTask()` 或 `Conversation.abort(ctx, { background: true })` 中止；阻塞型随它的 generation 一起中止，且先于 generation 的 abort handler 运行。

#### 关键代码

`selectCut()` 的候选与预算走查（`src/harness/compaction.ts:255-273`）：

```ts
export function selectCut(view: ContextView, keepRecentTokens: number): number | undefined {
	const { contributions } = view;
	const start = view.head === undefined ? 0 : 1;                  // 有 head marker 时第 0 条是 marker
	const candidates: number[] = [];
	for (let index = start; index < contributions.length; index++) {
		if (isCandidate(contributions, index)) candidates.push(index); // 候选：贡献以 user/assistant 开头
	}
	let kept = 0;
	let cut: number | undefined;
	for (let index = contributions.length - 1; index >= start; index--) {
		for (const message of contributions[index]!) kept += estimateMessageTokens(message); // 从尾往前累加
		if (kept < keepRecentTokens) continue;
		cut = candidates.find((candidate) => candidate >= index) ?? candidates.at(-1);
		break;
	}
	if (cut === undefined) return undefined;
	for (let index = start; index < cut; index++) if (contributions[index]!.length > 0) return cut;
	return undefined;                                               // 切点前没有贡献 → 无可压缩内容
}
```

放置的所有权分支（`src/harness/compaction.ts:423-435`）：

```ts
	const result: CompactionResult =
		current.owner === undefined
			? {
					submissionId: await admitSubmission(             // conversation-owned：走 write submission
						tx,
						runtime.conversationId,
						{ type: "write", requestId: `compaction:${runtime.taskId}`, entry },
						runtime.now(),
						runtime.settings,
					),
				}
			: { entryId: (await tx.appendEntry(runtime.conversationId, entry)).id }; // 阻塞型：直接追加
```

#### 不变式与边界

1. 范围选择是 `ContextView` 与 `keepRecentTokens` 的纯函数：同输入同输出，可在测试里穷举；但 compression 的摘要文本不可复跑，重试复用 pinned 请求而不是重新选择。
2. 「没有摘要」不是错误：无切点、被 decline、无模型以外的一切都 `completed({})`；阻塞型的 generation 无论如何都会重跑 `prepare` 并发请求，溢出型的 generation 因拿不到 `entryId` 而以 `model_error` 失败。
3. usage 只在拿到终态响应时记一次（同一 commit 写进 `pi.usage.models`），放置、失败、`stale` 与否不影响计费。
4. pinned 字段（model / thinking level / stream options / maxTokens / tail / firstKept）在 `select` 提交后固定；恢复只在崩溃发生在 `select` 期间才重跑选择。
5. 摘要永远不删除原始历史，只通过 `head` 改变模型看到的范围（见 2.6 节）。
6. `retry` 的退避与 generation 共用同一套策略与函数，因此上限（默认 60 s）与指数底数一致。
7. 摘要进队列后，谁先落地由 boundary 的 ID 顺序与 `stale` 规则决定；应用层在压缩进行中放置、且作用于被切掉区间的 edit 会随该区间一起从模型上下文中消失（规范 §6 末段把它列为已知取舍）。

#### 相关测试

- `test/harness-compaction.test.ts`：范围选择 9 例（含规范里的切点例子、user/assistant 候选、tool result 永不切、巨型尾部 tool result 与它的 assistant 一起保留、被 edit 成空的条目不参与、user 条目后仍有未决结果时不切、预算不足时返回 undefined、旧摘要被再次摘要）；序列化与 2000 字符截断；manual compaction 立即放置且保留原始历史、busy 时排队到下个 final boundary、在 postTools 落地后 run 在压缩后的上下文里继续、失败 run 遗留的 follow-up 在放置后执行、reset 使其 `stale`、不让会话忙碌、`stale` 也计费且不写条目、切得更远的摘要胜出、abort 与 ordinary work 语义；`beforeCompact` 首个决定与抛错；`no_model`；重试与每次尝试各计一次 usage；`maxTokens` 上限与请求不带工具；背景阈值不阻塞 run 且不重复启动；阻塞阈值等待、只压缩一次、「压缩失败/被 abort/无切点也照发请求」；溢出压缩复用同一 attempt、第二次溢出不重试；恢复语义（放置后不重复、摘要中断重发一次、退避跨 reopen、阻塞等待跨 reopen、排队摘要跨 reopen）；与 inbox 的顺序和 `stale`；faulted compaction 的状态清理。

### 4.4.4 src/harness/inbox.ts

`pi.inbox` 是每个会话的排队提交列表：busy（`pi.live.run` 存在）或「idle 但 inbox 非空」时新提交入队，run 结束时由 boundary 决定谁进入 transcript。`applyBoundary()` 按设置里的 `steeringMode` / `followUpMode` 选择项：先放 write（可能因 head 太旧判 `stale`），再放 user 项，最后按**位置**删除选中项。admission（何时排队、何时立即放置、`requestId` 去重）在 `src/harness/submissions.ts` 的 `admitSubmission()` 里，本文件只负责队列与放置。

#### 导出面

```ts
export type InboxItem =
  | { id: SubmissionId; mode: "steer" | "followUp"; content: JsonRepresentation<UserInput> }
  | { id: SubmissionId; mode: "write"; entry: JsonObject };      // entry 是 EntryDraft 的纯 JSON

export type InboxState = { items: InboxItem[] };

export const InboxDoc = defineDoc<InboxState>({ kind: "pi.inbox", version: 1, scope: "conversation",
  history: "latest", fork: "initial", initial: () => ({ items: [] }),
  checkpointWhen: (value) => value.items.length === 0 });        // 空即完整 base

export type QueueModes = Pick<Settings, "steeringMode" | "followUpMode">;

export type Boundary = {
  readonly conversationId: ConversationId; readonly inbox: Draft<InboxState>;
  readonly steeringMode: QueueMode; readonly followUpMode: QueueMode;
  head: EntryId | undefined;      // 活动范围起点；本 commit 写下的 head 会推进它
};
export type BoundaryResult = { readonly users: SubmissionId[]; readonly reset: boolean };

export async function prepareBoundary(tx: Tx, conversationId: ConversationId, modes: QueueModes): Promise<Boundary>;
export async function applyBoundary(tx: Tx, boundary: Boundary, at: "postTools" | "final", now: number): Promise<BoundaryResult>;
export function isStale(boundary: Boundary, entry: EntryDraft): boolean;
export async function removeInboxItem(tx: Tx, conversationId: ConversationId, id: SubmissionId): Promise<void>;
export async function withdrawQueuedInputs(tx: Tx, conversationId: ConversationId): Promise<void>;
```

- `prepareBoundary()` 读两样东西：`tx.latestHeadMarker(conversationId)?.head`（活动范围起点）与 inbox 文档；队列模式取自 settings，因此调用方在 Session 线上取到的就是当时的模式。**表读取必须先于 commit 的第一次表写**，所以 boundary 必须在 commit 开头准备。
- `isStale()` 只对带**数字** `head` 的 write 生效：`entry.head < boundary.head`。没有 head marker 时永不 stale；`head: "self"` 永不 stale。
- `removeInboxItem()` 按 id 定位并移除（撤回单个排队提交时用）；`withdrawQueuedInputs()` 从尾到头撤掉所有 **input** 项（`unanswered/aborted`），**保留 write** 等后续放置，`Conversation.abort()` 与 abort 级联用它。

#### 关键流程

submission 的生命周期与准入（`src/harness/submissions.ts:148-207`）：

| 时机 | submission 状态 | 其它写入 |
|---|---|---|
| input，idle 且 inbox 空 | `placed`（带 `pi.user` 条目） | 创建 run + generation |
| write，idle 且 inbox 空 | `done`（追加条目），或 head 太旧 → `unanswered/stale` | 无 run |
| input/write，busy 或 inbox 非空 | `queued`（写 inbox item） | busy + `whenBusy: "reject"` 的 input 改为抛 `ConversationBusy`，不写记录 |
| input，idle 但 inbox 非空 | 先 `queued` 再在**同一 commit** 跑 final boundary | 被选中的项立即进入 transcript；有 user 项则起新一轮 |
| boundary 选中 user 项 | `placed`（带条目） | ID 加入当前 run 或成为后继 run 的 inputs |
| boundary 放置 write | `done`（带条目） | 追加条目 |
| run 成功结束 | `done`（带 answer 条目） | 删 run 或交接给后继 generation |
| run 失败 / 任务 abort / fault / orphan | `unanswered`（带 reason） | 删 `pi.live` 的 run，**inbox 不动** |
| 撤回排队项 / head write 判 stale | `unanswered`（`aborted` / `stale`） | 移除 inbox item |

`requestId` 去重发生在 `admitSubmission()` 的入口、任何写之前：按会话查 `tx.submissionByRequest()`，命中且类型相同直接返回既有 ID（不产生第二个 item），类型不同则抛错。因此重复提交同一 `requestId` 是幂等的，且 busy 检查在去重之后——重复 ID 不会因为忙而被拒。

`applyBoundary()` 的选择与放置（`src/harness/inbox.ts:65-106`）：

```text
applyBoundary(tx, boundary, at, now)
  reset = 存在 write 项且 entry.head === "self"
  final = (at === "final") || reset                     // postTools 一旦选中 reset 就按 final 处理
  writes = 全部 write 项（ID 序）
  users  = pick("steer", steeringMode) + (final ? pick("followUp", followUpMode) : [])
           pick: "all" → 该模式全部；"one-at-a-time" → 第一条
  users.sort(升序)                                      // steer 与 followUp 混排后仍按 ID 序
  for write in writes:                                  // ① 先写后说
    if isStale(write.entry): settle(unanswered/stale); continue
    appendEntry(write.entry); placeSubmission(id, entry.id)
    if write.entry.head !== undefined: boundary.head = (head === "self" ? entry.id : head)
  for user in users:                                    // ② user 项
    appendEntry(pi.user, { content, timestamp: now }); placeSubmission(id, entry.id)
  removed = [...writes, ...users] 降序 splice            // ③ 位置性删除，保留其余项顺序
  return { users: placed, reset }
```

boundary 的四种使用场合：

1. `postTools`（普通工具轮收尾）：写 + steer；选中 reset 时升级为 final 并让 run 以 `unanswered/reset` 结束。
2. `final`（答案解析、`terminate`、`handoff`、idle 提交触发的收尾）：写 + steer + followUp；被选中的 user ID 起**一轮**后继 run。
3. `handoff` 的 reset 由 generation 追加，并把 `boundary.head` 指向它，因此同一 boundary 里更旧的 head write 会判 `stale`。
4. 失败、abort、fault、orphan 都不跑 boundary：排队项留到下一次提交的 boundary，或被 `Submission.abort()` / conversation abort 撤回。

#### 关键代码

`applyBoundary()` 的选择与位置性删除（`src/harness/inbox.ts:73-104`）：

```ts
	const reset = items.some((item) => item.mode === "write" && item.entry.head === "self"); // head:"self" 即 reset
	const final = at === "final" || reset;                                                  // postTools 遇 reset 也按 final
	const pick = (mode: "steer" | "followUp", queueMode: QueueMode): number[] => {
		const indexes = items.flatMap((item, index) => (item.mode === mode ? [index] : []));
		return queueMode === "all" ? indexes : indexes.slice(0, 1);                          // one-at-a-time 只取第一条
	};
	const writes = items.flatMap((item, index) => (item.mode === "write" ? [index] : []));
	const users = [...pick("steer", boundary.steeringMode), ...(final ? pick("followUp", boundary.followUpMode) : [])];
	users.sort((a, b) => a - b);

	// `appendEntry()` copies the drafts' values; the items are removed only afterwards.
	for (const index of writes) {
		const item = items[index] as Draft<Extract<InboxItem, { mode: "write" }>>;
		const draft = item.entry as unknown as EntryDraft;
		if (isStale(boundary, draft)) {
			tx.settleSubmission(item.id, { status: "unanswered", reason: "stale" });         // stale：settle，无条目
			continue;
		}
		const entry = await tx.appendEntry(conversationId, draft);
		if (draft.head !== undefined) boundary.head = draft.head === "self" ? entry.id : draft.head;
		tx.placeSubmission(item.id, entry.id);
	}
	const placed: SubmissionId[] = [];
	for (const index of users) {
		const item = items[index] as Draft<Extract<InboxItem, { mode: "steer" | "followUp" }>>;
		const message = { role: "user", content: item.content as UserInput, timestamp: now } as const;
		const entry = await tx.appendEntry(UserEntry, conversationId, { model: [message] });
		tx.placeSubmission(item.id, entry.id);
		placed.push(item.id);
	}
	const removed = [...writes, ...users].sort((a, b) => b - a);                             // 位置性删除（降序）
	for (const index of removed) items.splice(index, 1);
```

#### 不变式与边界

1. writes 永远先于 users，且两者各自按 ID 顺序，所以「reset / 摘要之前排队的 user 项」在新上下文里执行；位置性删除保证其余项的相对顺序不变（不能用 ID 替代位置语义）。
2. `settleSubmission()` / `placeSubmission()` 是暂存操作，在事务 assembly 时解析提交记录，因此可以在 commit 的第一次表写之后使用；而 boundary 的**表读**必须在第一次表写之前完成。
3. `run` 的 inputs 是可变列表：postTools 选中的 steer ID 被 push 进当前 run，因此它们与初始输入一起被同一个 generation 结清；abort 会把它们一起 settle。
4. write 没有 `whenBusy`：它只在 idle + 空 inbox 时立即落库，否则一律排队。
5. `Submission.abort()` 只撤回 `queued`，对 `placed` 报 `already_placed`，对终态报 `settled`；conversation abort 撤 input、留 write。
6. inbox 文档在空列表时写完整 base，因此空闲会话的 inbox 不会留下 delta 链。

#### 相关测试

- `test/harness-inbox.test.ts`：busy 排队并在 final boundary 先 write 后 user、每个 run 只取一条 followUp；`followUpMode: "all"` 一次 run 放全部；队列模式在 Session 线读取（提交排队占住 Session 线后再改设置）；postTools 放 steer、final 放 followUp；queued reset 在工具后结束 run、在答案后生效、idle 时立即生效；head write 三种 `stale` 情形（目标早于活动范围、同一 boundary 里先放 reset、范围内的更旧目标不 stale）；handoff tool → run `done` + `pi.reset`；`onYield` continuation 被 followUp 挤掉、被 queued write 保留、被 reset 挤掉；撤回排队项、失败后保留队列并在下次提交时按顺序放置、跨 reopen 保留；Chord 位置操作与空列表 base；`requestId` 重复不产生第二个 item；中间项的位置性移除。
- `test/harness-submissions.test.ts`：idle write 不带 turn 落库；idle input 与 `whenBusy: "reject"`；`requestId` 在任何写之前按会话去重；abort 返回值的三种情况与按会话查找；关闭时等待的拒绝；reopen 后重新获取并结清；提交/等待会启用调度；按事务里的当前记录 settle；token 化的条目读写。
- `test/harness-compaction.test.ts`（与 inbox 的交叉）：摘要作为 write 的放置顺序、reset 使其 `stale`、失败 run 遗留摘要的落地时机。

### 4.4.5 src/harness/live.ts

`pi.live` 是「当前在跑什么」的唯一投影，也是 run 控制状态的所在：`run` 指明哪个任务负责结清 run 的 inputs（`run !== undefined` 即 busy），`generation` 描述当前尝试（attempt、节流 partial、重试退避、deferred 轮询），`tools` 按调用顺序列出本轮每个槽位，`compactions` 列出活动的压缩任务。本文件同时集中了「结束 run / 完成槽位 / 清进度 / 移除压缩状态」的清理原语，以及 scheduler 在 fault 或 orphan 时使用的收尾钩子。

#### 导出面

```ts
export type ToolSlot = {
  callId: string; name: string;
  taskId?: TaskId;                    // 串行轮未启动、以及请求未提供的调用没有 taskId
  status: "pending" | "running" | "done";
  output?: string; droppedBytes?: number; droppedLines?: number;  // 运行输出的保留窗口与丢弃量
  details?: JsonValue;                // 最后一次 details()
  diagnostics?: ToolDiagnostic[];     // api.diagnostic() 记录的内容
  entry?: EntryId;                    // done 后的结果条目；fault/orphan 时缺失
};

export type CompactionStatus = {
  taskId: TaskId<CompactionResult>; reason: CompactionReason;
  blocking: boolean;                  // 是否有 generation 在等它
  attempt: number; retry?: { at: number; error: string };
};

export type LiveState = {
  run?: { taskId: TaskId; inputs: SubmissionId[] };     // 存在即 busy
  generation?: { attempt: number; message?: JsonRepresentation<AssistantMessage>;
                 retry?: { at: number; error: string }; deferred?: { pollAt: number } };
  tools?: ToolSlot[];
  compactions?: CompactionStatus[];
};

export const LiveDoc = defineDoc<LiveState>({ kind: "pi.live", version: 1, scope: "conversation",
  history: "latest", fork: "initial", initial: () => ({}), checkpointWhen: ... });

export function endRun(tx: Tx, live: Draft<LiveState>, taskId: TaskId, settlement: SubmissionSettlement): void;
export function addCompactionStatus(live: Draft<LiveState>, status: CompactionStatus): void;
export function compactionStatus(live: Draft<LiveState>, taskId: TaskId): Draft<CompactionStatus> | undefined;
export function removeCompactionStatus(live: Draft<LiveState>, taskId: TaskId): void;
export function toolSlot(live: Draft<LiveState>, taskId: TaskId): Draft<ToolSlot> | undefined;
export function finishSlot(slot: Draft<ToolSlot>, entry: EntryId | undefined): void;
export function clearProgress(slot: Draft<ToolSlot>): void;
export async function settleSchedulerOutcome(tx: Transaction,
  record: TaskRecord<JsonValue, JsonValue, JsonValue>, outcome: SchedulerOutcome): Promise<void>;
```

- `endRun()`：**仅当** `live.run.taskId === taskId` 时对 inputs 逐个 `settleSubmission()` 并删除 `run`；无论谁结束，都删除 `generation` 与 `tools`（它们的展示属于结束的 run）。
- `finishSlot()`：`status = "done"`、有 entry 就写 entry，并 `clearProgress()`。
- `settleSchedulerOutcome()`：按任务 kind 分派清理——`pi.tool` 把槽位标 `done` 且不带 entry（上下文派生会合成缺失结果），`pi.compaction` 移除状态，`pi.generation` 在它拥有 run 时先 `convertPartial()` 把已提交 partial 转成 aborted 条目，再把 inputs settle 为 `unanswered/faulted`（带 detail）或 `unanswered/<reason>`；其它 kind 一律不动，避免在别处意外创建 `pi.live`。

#### 关键流程

各字段的写入者与时机：

| 字段 | 写入者 | 时机 |
|---|---|---|
| `run` | `startRun()` / `handOver()` / `endRun()` | 准入时创建；postTools 交接时改 `taskId`；run 终态或交接完成时删除或转移 |
| `run.inputs` | `finishToolRound()` | postTools 选中的 steer ID push 进当前 run |
| `generation.attempt` | generation 的 `request` / `retry` | 每次尝试开始，重试时 attempt+1 |
| `generation.message` | `streamResponse().flush()` | 流式片段，100 ms 节流、`assignJson` 逐叶写 |
| `generation.retry` | generation 的 `classify()` | 决定退避时写 `{ at, error }` |
| `generation.deferred` | generation 的 `classify()` | 收到 deferred 时写 `{ pollAt }` |
| `tools[]` | generation 的 `startToolRound()` | 与 tool-calling 答案同 commit；一次写完整数组 |
| `tools[i].status/taskId` | generation 的 `tools` 阶段、tool 的意图与结算 | 串行轮启动下一个；意图 `running`；结算 `done` |
| `tools[i].output/details/diagnostics` | tool 的 `publishProgress()` | ≤100 ms 一次，只写变化 |
| `tools` 整体 | generation 的 `finishToolRound()` | 轮结束删除；`endRun()` 也会删 |
| `compactions` | `createCompaction()` / compaction 的 summarize、retry、放置、abort / scheduler 清理 | 任务创建 commit 加入；决定 outcome 的 commit 移除 |

基础/增量的规则是 `checkpointWhen`：`generation` 不存在且没有 `running` 的槽位时写完整 base。典型 base 时点包括：idle、run 终态、(工具轮交接的 commit 里所有槽位都还是 `pending`/`done`)、串行轮两个工具之间、并行轮没有槽位在跑时。因此 delta 链最长只跨一次 generation（含它的重试与 deferred 轮询）或一轮工具的并发执行；槽位只在 `running` 期间持有输出，所以每个 base 都很小。

#### 关键代码

`endRun()` 与调度器收尾（`src/harness/live.ts:87-94`、`153-175`）：

```ts
export function endRun(tx: Tx, live: Draft<LiveState>, taskId: TaskId, settlement: SubmissionSettlement): void {
	if (live.run?.taskId === taskId) {                                        // 只有 run 的拥有者能结清 inputs
		for (const id of live.run.inputs) tx.settleSubmission(id, settlement);
		delete live.run;
	}
	delete live.generation;                                                   // 展示面属于结束的 run
	delete live.tools;
}

export async function settleSchedulerOutcome(tx: Transaction,
	record: TaskRecord<JsonValue, JsonValue, JsonValue>, outcome: SchedulerOutcome): Promise<void> {
	if (record.kind === TOOL_TASK_KIND) {
		const slot = toolSlot(await tx.doc(LiveDoc, record.conversationId), record.id);
		if (slot !== undefined) finishSlot(slot, undefined);                   // 槽位 done、无 entry
		return;
	}
	if (record.kind === COMPACTION_TASK_KIND) {
		removeCompactionStatus(await tx.doc(LiveDoc, record.conversationId), record.id);
		return;
	}
	if (!RUN_TASK_KINDS.has(record.kind)) return;                              // 其它 kind 不动 pi.live
	const live = await tx.doc(LiveDoc, record.conversationId);
	if (live.run?.taskId !== record.id) return;
	await convertPartial(tx, live, record.conversationId);                     // 已提交 partial → aborted 条目
	endRun(tx, live, record.id,
		outcome.status === "faulted"
			? { status: "unanswered", reason: "faulted", detail: outcome.error.message }
			: { status: "unanswered", reason: outcome.reason });
}
```

#### 不变式与边界

1. `run !== undefined` 就是 busy 的定义；「idle 文档的 get-or-create」不会写 `run`。
2. 每个 run 任务的终态路径都在「settle inputs 的同一个 commit」里删 `run`、`generation`、`tools`；例外是 `onYield` continuation 的交接——那条路径不结算 run，只删 `generation` 并把 `taskId` 交给后继 generation（inputs 保持打开）。
3. 槽位更新只认 `taskId`：`toolSlot()` 找不到本任务的槽位时什么都不写，因此轮结束后的迟到进度提交是无害的空操作。
4. `generation.message` 必须是 strict JSON；partial 在提交前同步拷贝并丢弃 `undefined` 字段，否则 commit 会被存储拒绝。
5. fault 与 abort 同构：能还原的已提交 partial 都会变成 aborted 条目，`pi.usage` 也随之计费；fault 由任务 bug、非法 provider 数据或存储拒绝引起，不确定的存储失败则是毒化 Session 而不是写 outcome（见 2.8 节）。
6. `pi.live` 是 latest 文档且 fork 从 `initial()` 开始：fork 出来的会话是 idle 的，不继承父会话的 run 或槽位。

#### 相关测试

- `test/harness-live-deltas.test.ts`：交接与工具启动的精确 Chord op；head 窗口填满后只更新丢弃计数；tail 窗口的「前剪 + append」；重叠搜索失败时整窗写；details 逐叶 diff 与 diagnostics 追加；`generation.message` 以 append 写入；base/delta 规则（直接调用 `checkpointWhen` 断言 `pending`/`done` 槽位不阻止 base、`running` 阻止）；未提供的调用起始即 `done`、faulted 槽位只写 `status = "done"`；一轮的答案、任务、等待与工具状态在同一 commit；abort 槽位的字段级 op。
- `test/harness-tools-recovery.test.ts`：reopen 后槽位与条目的状态；faulted 槽位由上下文派生补结果后 run 继续。
- `test/harness-generation.test.ts`：partial 以 delta、终态以 base 提交；retry 状态对迟到的观察者可见。

### 4.4.6 src/harness/usage.ts

`pi.usage` 是每个会话自己的支出账本，两个 bucket：`models` 按 `provider/modelId` 累计 assistant 条目与压缩摘要尝试的 usage，`tools` 按工具名累计工具结果里的 usage（没有模型身份）。`recordUsage()` 在写入条目/分类响应的同一个 commit 里累加，`addUsage()` 逐计数器相加，`addUsageState()` 支持把多个会话的账本汇总成 Session 总数（`Harness.usage()`，见 2.10 节）。

#### 导出面

```ts
export type UsageState = {
  models: Record<string, JsonRepresentation<Usage>>;   // assistant 与摘要尝试
  tools: Record<string, JsonRepresentation<Usage>>;    // 工具结果的 usage
};

export const UsageDoc = defineDoc<UsageState>({ kind: "pi.usage", version: 1, scope: "conversation",
  history: "latest", fork: "initial", initial: () => ({ models: {}, tools: {} }),
  checkpointWhen: () => true });                       // 每次变更都是完整 base

export async function recordUsage(tx: Tx, conversationId: ConversationId,
  bucket: keyof UsageState, key: string, usage: Usage): Promise<void>;
export function addUsage(total: Draft<Usage> | Usage, usage: Usage): void;
export function addUsageState(sum: UsageState, state: Readonly<UsageState>): void;
```

- `recordUsage()`：`totals[key]` 不存在时写入 `copyJson(usage, { omitUndefinedProperties: true })`，存在则 `addUsage()` 就地累加；用 `Object.hasOwn` 判定自有键，避免工具名撞上原型链上的名字（例如 `toString`）。
- `addUsage()`：`input` / `output` / `cacheRead` / `cacheWrite` / `totalTokens` 与 `cost.*` 必加；`cacheWrite1h` 与 `reasoning` 只在 `usage` 侧出现时累加（`total` 侧缺省视为 0）。
- `addUsageState()`：对 `models`、`tools` 两个 bucket 逐键累加；新键用 `Object.defineProperty` 定义而不是赋值，避免名为 `__proto__` 的键改写原型。

#### 关键流程

| 写入者 | bucket / key | 位置 |
|---|---|---|
| `generation.appendAssistant()` | `models` / `${message.provider}/${message.model}` | 每个 `pi.assistant` 条目（答案、失败尝试、转换的 partial） |
| `tool.appendToolResult()` | `tools` / `call.name` | 结果带 usage 时，用的是 `afterTool` 替换后的结果 |
| `compaction.summarize()` 的分类 commit | `models` / `${message.provider}/${message.model}` | 每次摘要尝试（放置、失败、`stale` 都算） |

要点是「记账与写入同一个 commit」：生成侧唯一入口是 `appendAssistant()`，因此不会漏记；压缩没有条目，所以它在分类 commit 里单独记。fork 从 `initial()` 开始（计数不会重复），`Harness.usage()` 通过 `addUsageState()` 汇总所有会话。

#### 关键代码

`recordUsage()`（`src/harness/usage.ts:25-39`）：

```ts
export async function recordUsage(
	tx: Tx,
	conversationId: ConversationId,
	bucket: keyof UsageState,
	key: string,
	usage: Usage,
): Promise<void> {
	const totals = (await tx.doc(UsageDoc, conversationId))[bucket];
	// Own keys only: a tool may be called `toString`.
	const total = Object.hasOwn(totals, key) ? totals[key] : undefined;     // 只认自有键
	// Providers may leave optional counters `undefined`; drafts take strict JSON.
	if (total === undefined)
		totals[key] = copyJson(usage, { omitUndefinedProperties: true }) as JsonRepresentation<Usage>;
	else addUsage(total, usage);                                            // 已存在则就地累加
}
```

#### 不变式与边界

1. 完整性靠「唯一入口 + 同 commit」两点：assistant 条目必记账，工具结果的 usage 只有在工具真的返回 `usage` 时才记，压缩尝试在分类 commit 记账（无论放置与否）。
2. 失败的尝试也计费：`error` / `aborted` 的 assistant 条目与转换的 partial 都会写进账本，符合「花掉的钱要算」的原则；被 abort 或崩溃打断、没有提交响应的尝试不计。
3. `undefined` 计数字段被丢弃，语义是「该计数不存在」；可选计数器在任一侧出现后才开始累加。
4. 原型安全：读用 `Object.hasOwn`，新键用 `Object.defineProperty`，工具名可以是任意字符串。
5. `pi.usage` 的 `checkpointWhen` 恒为 true，每次变更都是完整 base；账本很小，不需要 delta 链。

#### 相关测试

- `test/harness-inbox.test.ts`（usage 段）：assistant 按模型、工具按名汇总，`Harness.usage()` 等于各会话之和；失败尝试、转换的 partial、被 `afterTool` 替换的 tool usage 都被计入；`toString` / `__proto__` 这类工具名不会破坏账本与总数；跨 reopen 精确且不重复计数（含 reopen 后才转换的 partial）；账本以数值 set 的形式写在条目所在的 commit 里。
- `test/spec-usage.test.ts`：规范中的 usage 示例与实现一致。
- `test/harness-compaction.test.ts`：摘要成功、失败、`stale` 与「分类 commit 被拒绝」时的计费边界。

---

## 4.5 harness/ 配置与提示

这一节覆盖把「应用怎么配 Harness」变成「会话实际怎么请求模型」的那批文件：`agent.ts` 负责把持久的选择（名字）解析成活对象，`types.ts` 是全部公共形状，`prompt.ts` 与 `context.ts` 负责「下一次请求到底带哪些 section、哪些工具、哪些消息」，`provider.ts` 给请求打上会话身份，`registry.ts` 是 Extension 的安装台。

### 4.5.1 src/harness/agent.ts

`agent.ts` 是「配置 → 活对象」的唯一解析器。它定义内建的 `pi.agent` 文档（持久、只存名字与少量设置）、三个默认值常量（重试、压缩、保留 section key），以及 `resolveSettings()` / `resolveAgent()` 两个纯解析函数；另外它还负责会话创建时的 agent 复制规则（`createAgent`）与运行期追加工具（`addTools`）。理解这一文件就理解了「为什么重新 install 一个 Extension 立刻生效、却不产生任何 Commit」。

#### 导出面

```ts
// src/harness/agent.ts:18-30
export const DEFAULT_RETRY_POLICY: ConversationRetryPolicy =
  { enabled: true, maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 60000 };
export const DEFAULT_COMPACTION_POLICY: CompactionPolicy =
  { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000, backgroundTokens: 32768 };

// src/harness/agent.ts:33
export const INSTRUCTIONS_KEY = "instructions";   // 保留的 section key

// src/harness/agent.ts:36-44
export const AgentDoc = defineDoc<AgentState>({
  kind: "pi.agent", version: 1, scope: "conversation",
  history: "rewindable",                          // 可倒带：fork 能取到「分叉点当时」的 agent
  fork: "asOf",                                   // 分叉取 asOf 拷贝，而不是父的当前值
  initial: () => ({}),
  checkpointWhen: () => true,
});

// src/harness/agent.ts:47-58
export function resolveSettings(settings: HarnessSettings | undefined): Settings;

// src/harness/agent.ts:61-64
export async function configure(tx: Tx, conversationId: ConversationId, change: AgentChange): Promise<void>;

// src/harness/agent.ts:70-82
export async function addTools(tx: Tx, conversationId: ConversationId, added: readonly string[]): Promise<void>;

// src/harness/agent.ts:126-132
export async function createAgent(tx: Tx, conversation: ConversationRecord): Promise<void>;

// src/harness/agent.ts:135-141
export function agentHooks(agent: Agent, taskName: string): object[];

// src/harness/agent.ts:147-152
export function resolveAgent<Tool extends ToolRegistration>(
  state: Readonly<AgentState> | undefined,
  snapshot: RegistrySnapshot<Tool>,
  settings: Settings,
  report: (error: unknown) => void,
): Agent<Tool>;
```

逐个说明：

- `resolveSettings`：`extensions` 缺省时不写入结果（表示「所有已安装」）；`stream` 浅合并（`{...settings?.stream}`，默认空对象）；`retry` / `compaction` 是 `{...DEFAULT_X, ...settings?.X}` 的字段级合并；`toolExecution` 默认 `"parallel"`，`steeringMode` / `followUpMode` 默认 `"one-at-a-time"`。
- `configure`：在事务里取 `pi.agent` 并应用一次 `AgentChange`（三态：给出即替换、`null` 清除、`undefined` 不动）。
- `addTools`：工具轮结束后把 `control.addTools` 写回 `pi.agent.tools`。存的是数组时逐个追加缺失的名字；存的是 `{remove}` 时把命中的名字从黑名单里删掉（等于把它重新放出来）；**`tools` 未设置时直接返回**（未设置 = 已提供全部工具，无需写）。
- `createAgent`：会话创建的内建 hook。fork（`conversation.parent !== undefined`）直接返回，保留 `asOf` 拷贝；无 owner 的会话保持空 `{}`；有 owner 的会话把 owner 那个会话的 `pi.agent` 整体拷贝过来。
- `agentHooks`：按 `agent.extensions` 的顺序，取出「注册的 task 名等于 `taskName`」的 handlers，返回数组（不做类型检查、不查 task 是否存在）。
- `resolveAgent(..., report)`：`report` 接收 wrapper 失败；`state` 为 `undefined` 等价于「所有字段未设置」。

#### 关键流程

```text
resolveAgent(state, snapshot, settings, report)
  1. extensions = selectExtensions(state.extensions, snapshot, settings)
       Array.isArray(stored) → 直接用该名字序列
       否则 base = settings.extensions?.map(e => e.name) ?? snapshot.installed().map(e => e.name)
            selected = [...base, ...(add ?? [])] 过滤掉 remove
       用 new Set 去重（保留第一次位置），逐个 snapshot.extension(name)，未安装的跳过
  2. composed = Map<toolName, Tool>
       for ext of extensions: for tool of ext.tools ?? []: composed.set(tool.name, tool)
       // 同名工具：后来的实现替换先前的对象，但保留第一次出现的位置
  3. sections = Map<key, PromptSection>（同样的“同名就地替换”语义）
  4. for ext of extensions: for wrap of ext.wraps ?? []:
       "tool" in wrap  → applyWrap(composed, wrap.tool, ...)
       else            → applyWrap(sections, wrap.section, ...)
       // applyWrap：目标不存在 → 静默 return；wrap() 抛错或改名 → delete(target) + report(error)
  5. 工具过滤：state.tools 未设置 → 全部；数组 → 按数组顺序取名字（去重）；{remove} → 删除这些名字
  6. sections 转数组；state.instructions 存在 → push {key: "instructions", render: () => instructions}
  7. 组装 Agent：model（可选）、thinkingLevel（默认 "off"）、extensions、tools、sections、
     instructions（可选）、cwd（可选）

configure(tx, id, change)           // 落库只保留名字
  model/thinkingLevel/instructions/cwd：undefined 跳过，null → delete，其它 → 覆盖
  extensions：数组 → names()；{add,remove} → {add: names(add), remove: names(remove)}
  tools：数组 → names()；{remove} → {remove: names(remove)}

addTools(tx, id, added)
  tools === undefined → 不写
  数组 → 逐个追加缺失的名字
  {remove} → 命中 added 的名字从 remove 里删掉
```

#### 关键代码

`src/harness/agent.ts:155-180`：

```ts
	const composed = new Map<string, Tool>();
	for (const extension of extensions) for (const tool of extension.tools ?? []) composed.set(tool.name, tool);
	// 同名工具：Map.set 覆盖值，但保留首次插入的位置 —— 这就是“就地替换”
	const sections = new Map<string, PromptSection<Tool>>();
	for (const extension of extensions) {
		for (const section of extension.sections ?? []) sections.set(section.key, section);
	}
	for (const extension of extensions) {
		for (const wrap of extension.wraps ?? []) {
			if ("tool" in wrap)
				applyWrap(
					composed,
					wrap.tool,
					(tool) => wrap.wrap(tool),
					(tool) => tool.name,
					report,
				);
			else
				applyWrap(
					sections,
					wrap.section,
					(section) => wrap.wrap(section),
					(section) => section.key,
					report,
				);
		}
	}
```

`src/harness/agent.ts:234-250` 的 `applyWrap` 是这套语义的兜底：先 `items.get(target)`，取不到直接返回；`wrap(item)` 抛错或返回的名字/键变了，就 `items.delete(target)` 并调用 `report(error)`——于是「这个工具在这次解析里不存在」，而不是让整次解析失败。

#### 不变式与边界

- **解析是纯函数**：`resolveAgent` 不改 `state`、不写存储、不 publish；settings 与 snapshot 都是调用时传入的值。因此同一个会话在不同时刻可以解析出不同结果（注册表变了、设置改了），而 `pi.agent` 本身没变。
- **只有名字入库**：`AgentChange.extensions` / `tools` 收的是对象数组，`configure` 用 `names()` 投影成名字；未安装的名字会被存下来但解析时跳过（`test/harness-conversations.test.ts:362-365`：存了 `"missing"`，`agent.tools` 只提供 `read`）。
- **wrap 失败清目标**：抛错或改名都会让该工具/section 在本次解析中被删除，并通过 `onReport` 上报；`Timing` 这类「目标不存在」的 wrap 静默通过（见 2.12 节解析规则表）。
- **`instructions` 不参加 wrap**：它在 wrap 之后才 push 成 section，且没有 `tag: false`（模板由渲染层决定，见 4.5.3）。
- **fork 不继承体的当前值**：`AgentDoc.fork === "asOf"` + `createAgent` 对 `parent !== undefined` 直接返回，两者共同保证 fork 拿到分叉点当时的 agent。
- **owner 拷贝是一次性快照**：owner 之后 `configure` 不会传给孩子（`test/harness-conversations.test.ts:404-406`）。
- **`checkpointWhen: () => true`**：`pi.agent` 每个 Commit 都存完整 base，不做 delta 链；这是有意的，因为它的体积固定很小。
- 幂等点：`addTools` 对已存在的名字不重复追加；`configure({field: undefined})` 完全不写。

#### 相关测试

- `test/harness-registry.test.ts:140-291`：扩展选择（默认 / 数组 / `{add,remove}`）、同名工具就地替换后被 wrap、过滤顺序、wrapper 抛错/改名丢弃目标、section 顺序与 `instructions` 收尾、hook 收集顺序、字段默认值。
- `test/harness-conversations.test.ts:287-327`：`conversationCreated` 在每个创建提交里运行，顺序是「内建文档 → conversationCreated → agent → init」，且抛错会让创建提交失败。
- `test/harness-conversations.test.ts:330-421`：「Harness agent」整组：字段替换 / `null` 清除 / `undefined` 不动；新过滤器替换旧过滤器；名字不做注册表校验；无主会话空 agent、task-owned 会话拷贝 owner 快照、task-owned fork 保留 asOf 拷贝。
- `test/harness-tools.test.ts:537-566`、`877-893`：`addTools` 追加到数组、从 `{remove}` 里删除。
- `test/harness-generation.test.ts:452-500`：settings 通过 getter 在每个决策点重新读取；`resolveSettings` 的默认值与字段合并。

### 4.5.2 src/harness/types.ts

`types.ts` 是 Harness 的**全部公共类型**：宿主配置、会话创建与提交、Extension/Registry/hook/wrap/section、agent 解析结果、工具执行 API 与结果、设置与策略、Hook 签名。它只有类型、没有运行时代码，包根几乎逐项 re-export（`src/index.ts:45-96`），因此这一节可以当作整套 API 的索引来读。它不定义存储协议：`Storage` 在 `src/types.ts:993`，`DocDefinition` 在 `src/types.ts:81`。

#### 导出面

**（a）基础**

| 导出 | 行号 | 内容 |
| --- | --- | --- |
| `ModelRef` | `:46-50` | `{ readonly provider: string; readonly modelId: string }`，交给 pi-ai `Models` 解析。 |
| `UserInput` | `:52` | `= UserMessage["content"]`。 |

**（b）配置面：宿主设置 → 解析后设置**

| 导出 | 行号 | 内容 |
| --- | --- | --- |
| `HarnessSettings` | `:392-401` | 全可选：`extensions?: readonly Extension[]`（默认选择；缺省 = 所有已安装、按安装顺序）、`stream?: ConversationStreamOptions`、`retry?: Partial<ConversationRetryPolicy>`、`compaction?: Partial<CompactionPolicy>`、`toolExecution?: ToolExecutionMode`、`steeringMode?: QueueMode`、`followUpMode?: QueueMode`。注释要求它**同步可读**（某些读取发生在 Session line 上）且允许 getter。 |
| `Settings` | `:404-413` | 解析后：`extensions?` 保持可选，其余必填——`stream`、`retry`、`compaction`、`toolExecution`、`steeringMode`、`followUpMode`。 |
| `ConversationStreamOptions` | `:350-360` | 精选的 pi-ai 请求选项，缺省用 pi-ai 默认值：`transport?`、`timeoutMs?`、`maxRetries?`（单次尝试内的 SDK 重试）、`maxRetryDelayMs?`、`headers?`、`metadata?`、`cacheRetention?`、`deferred?: boolean \| { window?: "15m"\|"1h"\|"24h" }`。注意：**会话不存 stream 选项**，它每次从 settings 现读。 |
| `ConversationRetryPolicy` | `:363-368` | `enabled`、`maxRetries`、`baseDelayMs` 必填；`maxAgentDelayMs?`。 |
| `CompactionPolicy` | `:371-380` | `enabled`、`reserveTokens`、`keepRecentTokens`、`backgroundTokens` 全必填；手动压缩忽略 `enabled`。 |
| `CompactionReason` | `:383` | `"manual" \| "threshold" \| "overflow"`。 |
| `CompactionResult` | `:389` | `{ entryId?: EntryId; submissionId?: SubmissionId }`。 |
| `ToolExecutionMode` | `:157` | `"parallel" \| "sequential"`。 |
| `QueueMode` | `:160` | `"all" \| "one-at-a-time"`。 |
| `EnvTarget` | `:416-421` | `HarnessOptions.env` 的入参：`conversationId`、`cwd?`、`read: DocumentReader`。 |
| `HarnessOptions<Tool>` | `:423-439` | `models: Models`（必填）、`registry: RegistryReader<Tool>`（必填）、`settings?`、`env?`（每次使用重新构造；**从不在 Session line 上调用、可 async**）、`conversationCreated?`（每个创建/分叉提交里运行，包括裸 `tx.createConversation()`，在内建 `pi.*` 文档之后、`agent`/`init` 之前；读表会抛 `ReadAfterWrite`；抛错让创建提交失败）、`now?: () => number`、`onReport?`（接收不使调用失败的 Extension 失败，**不得抛错**）。 |

**（c）Extension、Registry、hook、wrap、section**

| 导出 | 行号 | 内容 |
| --- | --- | --- |
| `Extension<Tool>` | `:257-266` | `name`；`tools?`；`sections?`；`hooks?: readonly HookRegistration[]`；`wraps?: readonly Wrap<Tool>[]`（在选中它的会话里按序应用）；`tasks?: readonly AnyTask[]`（**按名字对所有会话可解析**，不受选中影响）。 |
| `AnyTask` | `:91-101` | 擦除类型参数的 task 定义：`{ definition: { name; version; initial: unknown; phases: Readonly<Record<string,unknown>>; abort: unknown; migrate?: unknown; hooks?: object } }`。 |
| `HookRegistration` | `:249` | `{ readonly task: string; readonly handlers: object }`——由 `hook()` 构造，**按 task 名匹配**。 |
| `Wrap<Tool>` | `:252-254` | `{ tool: string; wrap(tool) }` 或 `{ section: string; wrap(section) }`；目标是名字，wrapper 必须纯。 |
| `PromptSection<Tool>` | `:241-246` | `key`；`render(input, context): string \| undefined \| Promise<string\|undefined>`；`tag?: boolean`（默认 true：渲染成 `<key>\n...\n</key>`）。 |
| `PromptInput<Tool>` | `:228-238` | section 渲染的入参：`conversationId`、`agent: Agent<Tool>`（本次请求的解析结果）、`env`、`shown: Readonly<Record<string,string>>`（重放后的已生效 section）、`read: DocumentReader`。 |
| `RegistrySnapshot<Tool>` | `:269-278` | `installed()`、`extension(name)`、`tools()`（**安装顺序**，名字可跨 Extension 重复）、`sections()`、`tasks()`（内置 + 已安装）、`task(name)`——纯不可变值，无需释放。 |
| `RegistryReader<Tool>` | `:281-286` | `snapshot()`；`subscribe(listener): () => void`（每次发布后同步调用，用来唤醒调度器重评 blocked task）。 |
| `Registry<Tool>` | `:289-294` | `extends RegistryReader`；`install(extension)`（安装或**同名就地替换**，立即发布）、`uninstall(extension)`（按名字移除；再安装会追加到末尾）。 |
| `HooksOf<K>` | `:114` | 从 task token 取出 hooks 接口的类型。 |

**（d）agent 解析面**

| 导出 | 行号 | 内容 |
| --- | --- | --- |
| `AgentState` | `:297-308` | 持久化的选择，全是名字：`model?`、`thinkingLevel?`、`extensions?: string[] \| { add?: string[]; remove?: string[] }`、`tools?: string[] \| { remove: string[] }`、`instructions?`、`cwd?`。 |
| `AgentChange` | `:311-321` | 三态修改：`model?: ModelRef\|null`、`thinkingLevel?: ...\|null`、`extensions?: readonly Extension[] \| { add?: readonly Extension[]; remove?: readonly Extension[] } \| null`、`tools?: readonly ToolRegistration[] \| { remove: readonly ToolRegistration[] } \| null`、`instructions?: string\|null`、`cwd?: string\|null`。**给出即替换，`null` 清除，`undefined` 不动**。 |
| `Agent<Tool>` | `:324-334` | 解析结果：`model?`、`thinkingLevel`（必填）、`extensions`、`tools`（**本次提供的工具，有序**）、`sections`（Extension section，其后是 `instructions`）、`instructions?`、`cwd?`。 |
| `ConversationInit` | `:340` | `(tx, conversationId) => void \| Promise<void>`：创建提交内运行；读表抛 `ReadAfterWrite`，文档访问可用。 |
| `ConversationCreateOptions` | `:342-347` | `ownership`（必填）、`agent?: AgentChange`（创建 hook 之后、`init` 之前）、`init?: ConversationInit`。 |

**（e）提交（submission）面**

| 导出 | 行号 | 内容 |
| --- | --- | --- |
| `SubmissionDraft` | `:54-70` | `{ requestId?: string } & ({ type:"input"; content: UserInput; whenBusy?: "steer"\|"followUp"\|"reject"; entry?: never } \| { type:"write"; entry: EntryDraft; content?: never; whenBusy?: never })`——`never` 字段让非法组合成为编译错误。 |
| `InputSubmissionDraft` | `:72` | `Extract<SubmissionDraft, {type:"input"}>`。 |
| `SettledSubmissionRecord` | `:74-76` | `SubmissionRecord & { status: "done" \| "unanswered" }`。 |
| `Submission` | `:79-84` | `id`、`status(context)`、`wait(context)`、`abort(context): Promise<"aborted"\|"already_placed"\|"settled">`。 |
| `ConversationAbortOptions` | `:104-111` | `{ background?: boolean }`：abort 时忽略 background 标记、撤回所有可达排队输入并等它们终态。 |
| `ConversationHandle` | `:120-127` | 调用期绑定：`id`、`submit`、`abort`、`waitForIdle`；**调用结束后全部 reject**。 |
| `SettledTask<R>` | `:86-88` | `TaskRecord` 且 `state` 收窄为 `terminal`。 |
| `TaskInspection` | `:442-461` | `record` + `state: running \| ready({migrates}) \| waiting({on}) \| completing \| blocked({reason: "missing_task"\|"task_too_old"\|"migration_failed"; error?})`。 |
| `HarnessInspection` | `:464-469` | `scheduling: "paused"\|"running"\|"closing"`、`tasks`、`submissions`（按 ID 升序）。 |

**（f）工具执行面**

| 导出 | 行号 | 内容 |
| --- | --- | --- |
| `ToolRegistration<TParameters, TDetails>` | `:201-225` | `= Tool<TParameters> & {...}`：`replay?: "safe"\|"unsafe"`（默认 `unsafe`）、`executionMode?`（默认 settings 的值；一个 sequential 调用让整轮 sequential）、`prepareArguments?(args: unknown): Static<TParameters>`（必须纯、不得改 `args`、重试会再跑、输出仍要过 schema 校验）、`outputLimits?: { maxBytes?; maxLines?; retain?: "head"\|"tail" }`、`execute(args, api, context): Promise<ToolExecutionResult<TDetails>>`。 |
| `ToolExecutionResult<TDetails>` | `:143-154` | `content?`（省略时用 `output()` 保留的文本）、`isError?`、`details?`（省略时用最后一次 `details()`）、`diagnostics?`（追加在 `api.diagnostic()` 记录之后）、`usage?`、`control?`。 |
| `ToolExecutionApi<TDetails>` | `:166-195` | `extends DocumentObserver, DocumentReader`。字段/方法：`taskId`、`conversationId`、`callId`、`registry: RegistrySnapshot`（本 phase 的快照）、`agent(context): Promise<Agent>`、`env: ExecutionEnv \| undefined`、`output(chunk: string\|Uint8Array)`、`diagnostic(d)`、`details(value, context)`、`commit(change, context)`、`memo(name, context)` / `memo(name, candidate, context)`、`createTask(task, input, Omit<TaskOptions,"conversationId">, context)`、`getTask`、`waitForTask`、`conversation(id, context)`。普通对象，可 spread；**调用结束后每个操作 reject**。 |
| `ToolControl` | `:130-134` | `addTools?`、`terminate?: true`、`handoff?`。 |
| `ToolDiagnostic` | `:137-141` | `severity: "info"\|"warn"\|"error"`、`message`、`code?`；给模型和 UI 的说明，**不属于工具数据**。 |

**（g）Hook 面**

| 导出 | 行号 | 内容 |
| --- | --- | --- |
| `HookApi` | `:583-588` | `extends DocumentReader`；`taskId`、`conversationId`、`memo(name, context)` / `memo(name, candidate, context)`（与 task 共享同一 memo 命名空间）。 |
| `HookResult<T>` | `:590` | `T \| undefined \| Promise<T \| undefined>`。 |
| `GenerationHooks` | `:593-606` | `beforeRequest({messages}, api, context): HookResult<{messages}>`（每次请求尝试前，含恢复；结果只用于该次请求）、`afterResponse(message, api, context): void \| Promise<void>`（每个终态 provider 消息，分类前）、`onYield(answer, api, context): HookResult<{continue: UserInput}>`（**第一个 `continue` 胜出**，追加 user 消息继续 run）、`afterTools(assistant: EntryId, results: readonly EntryId[], api, context)`（本轮工具全终态后，`results` 按调用顺序）。 |
| `ToolHooks` | `:609-623` | `beforeTool(call, api, context): HookResult<{arguments?: JsonObject; block?: string}>`（intent 前；**第一个 `block` 胜出**，否则替换参数；**抛错即 block**）、`afterTool(call, result, api, context): HookResult<ToolExecutionResult>`（执行后、结果 entry 前）。 |
| `CompactionHooks` | `:626-642` | `beforeCompact({reason, entries, messages, firstKept, instructions?}, api, context): HookResult<{decline:true} \| {summary:string}>`（范围选择后、摘要前；**第一个决定胜出**）。 |

（hook 的调度顺序与抛错处理见 3.2 节与 3.3 节。）

#### 关键流程

```text
HarnessSettings（宿主写入设计）        Settings（每次解析时构造）
  extensions?  ──────────────────────── extensions?（缺省 = 全部已安装）
  stream?      ── 浅合并 ─────────────── stream
  retry?       ── 字段合并默认值 ────── retry
  compaction?  ── 字段合并默认值 ────── compaction
  toolExecution? ── 默认 "parallel" ── toolExecution
  steeringMode?/followUpMode? ──────── 默认 "one-at-a-time"

AgentState（持久，名字）  ──resolveAgent──▶  Agent（活对象：Extension[] + Tool[] + PromptSection[]）
AgentChange（三态修改）   ──configure──▶    AgentState

ToolExecutionApi 的操作在「调用期」有效：task/tool 的 invocation 结束后全部 reject；
ConversationHandle 同理；被动 entry 写入请用 tx，而不是 submit()。
```

#### 关键代码

`src/harness/types.ts:392-413`：

```ts
/** Harness-wide run policy. Read at every resolution and never copied; getters are fine. Synchronous: some readers run on the Session line. */
export type HarnessSettings = {
	/** Default extension selection; absent: every installed extension, in install order. */
	readonly extensions?: readonly Extension[];
	readonly stream?: ConversationStreamOptions;
	readonly retry?: Partial<ConversationRetryPolicy>;
	readonly compaction?: Partial<CompactionPolicy>;
	readonly toolExecution?: ToolExecutionMode;
	readonly steeringMode?: QueueMode;
	readonly followUpMode?: QueueMode;
};

/** Resolved settings: every field over its built-in default, object fields merged. */
export type Settings = {
	/** Absent: every installed extension, in install order. */
	readonly extensions?: readonly Extension[];
	readonly stream: ConversationStreamOptions;      // 每层都必填：解析后的值已经可以直用
	readonly retry: ConversationRetryPolicy;
	readonly compaction: CompactionPolicy;
	readonly toolExecution: ToolExecutionMode;
	readonly steeringMode: QueueMode;
	readonly followUpMode: QueueMode;
};
```

#### 不变式与边界

- **`HarnessSettings` 的读取时机不受控**：它是「活对象」，允许 getter，且每次解析都重新读（`test/harness-generation.test.ts:452-485` 用一个可变 `timeoutMs` 证明重试时读到新值）。任何需要「快照一致性」的字段都不能依赖它。
- **`Settings` 是值快照**：解析完就固定，后续读取不会变。
- **`env` 与 `settings` 的调用位置相反**：`env` 明确「从不在 Session line 上调用、可 async」；settings 必须同步。
- **`conversationCreated` 覆盖所有创建路径**（含裸 `tx.createConversation()`），且必须在 `pi.*` 文档之后、`agent`/`init` 之前；它抛错会让创建提交回滚。
- **类型层面互斥**：`SubmissionDraft` 的两个分支用 `never` 字段阻止 input 带 `entry`、write 带 `content`/`whenBusy`（编译期约束，见 6.1 节的 `types.test.ts` 条目）。
- **调用期边界**：`ToolExecutionApi`、`ConversationHandle` 的每个操作在 invocation 结束后 reject；`ToolExecutionApi.env` 是**字段**（值为当次构造的环境），不是方法。
- 存疑：任务描述里的「DocumentDefinitions」在仓库中没有同名导出；本手册以 `src/types.ts:81` 的 `DocDefinition` 与 `src/documents.ts:83` 的 `AnyDocDefinition` 为准。`types.ts` 实测 643 行。

#### 相关测试

- `test/types.test.ts`：纯类型断言——ID 品牌不可互换（`:49-70`）、判别字段编码与 `@ts-expect-error` 反例（`:72-254`）、`SubmissionDraft`/`hook()`/`defineTask` 的推导（`:256-345`）。
- `test/harness-generation.test.ts:365-384`：stream options 走 settings、thinkingLevel 走 `pi.agent`。
- 其余形状级断言散落在各自的功能测试里（例如 `test/harness-submissions.test.ts` 对 `SubmissionDraft` 行为的验证）。

### 4.5.3 src/harness/prompt.ts

`prompt.ts` 负责 system prompt 的**差分更新**：它把「本轮应该生效的 section 文本 + 工具声明」与「重放 transcript 后已经生效的」做比较，产出一到两条 `pi.system` entry，使模型上下文以最小写入达到目标状态。核心约束是「顺序」——section 的顺序与工具的顺序都参与等价判断，顺序变了就必须整体重写（先清空再按目标顺序重加）。

#### 导出面

```ts
// src/harness/prompt.ts:9
export function replaySections(messages: readonly Message[]): Map<string, string>;

// src/harness/prompt.ts:25-31
export async function renderSections<Tool extends ToolRegistration>(
  sections: readonly PromptSection<Tool>[],
  input: PromptInput<Tool>,
  shown: ReadonlyMap<string, string>,       // 已生效的 section（replaySections 的结果）
  report: (error: unknown) => void,         // section 抛错时上报（中止错误除外）
  context: Context,
): Promise<Map<string, string>>;            // 目标 section 表（含标签包裹）

// src/harness/prompt.ts:66-71
export function planSystemEntries(
  view: ContextView,
  desired: ReadonlyMap<string, string>,
  tools: readonly Tool[],
  timestamp: number,
): SystemDraft[];                            // 要追加的 pi.system entry 草稿
```

- `replaySections`：按顺序重放所有 `role === "system"` 且带 `sections` 的消息；`null` 删除、字符串就地设置、删除后再设置会**追加到 Map 末尾**（因此能表达「重新加回一个 section 会改变顺序」）。
- `renderSections`：按 `sections` 顺序渲染；`undefined` 表示省略该 section；`tag` 非 `false` 时包成 `<key>\n{text}\n</key>`；抛错时**保留已显示文本**并上报，若此时 `context` 已中止则直接抛出。
- `planSystemEntries`：产出 0–2 条 entry（见流程）；工具声明的变化挂在这些 entry 的最后一条上，或者单独占一条。

#### 关键流程

```text
planSystemEntries(view, desired, tools, timestamp)
  1. head = view.head
     若 head 存在且 head 之后没有任何 pi.system entry（即“head 把基线切掉了”）：
         基线 entry = { sections: desired 全量, toolsAdded: tools 全量, toolsRemoved: [] }
         edits = 范围内每条 pi.system entry 的 { action: "omit" }
         返回 1 条（有 edits 就带上），即使它和重放结果完全相同也照样写
  2. sections = planSections(replaySections(view.messages), desired)
     changes  = planTools(getCurrentTools(view.messages), tools)
  3. 没有工具变化：把每个 section patch 变成一条 entry
     没有 section patch：把工具变化变成一条 entry
     否则：每个 section patch 一条 entry，工具变化挂在最后一条上

planSections(shown, desired)
  patchedOrder = [shown 中仍被 desired 拥有的键（保持 shown 顺序）] + [desired 中 shown 没有的键]
  若 patchedOrder 与 desiredOrder 不同：
     返回 [把 shown 全部置 null, desired 全量]      // 两条 entry：清空 + 重建
  否则最小补丁：值变化的键、以及 desired 里新增的键；删除用 null；空补丁返回 []

planTools(offered, desired)
  kept = offered 中“名字仍在 desired 且声明相等”的
  added = desired 中名字不在 kept 的
  若 [...kept, ...added] 的名字顺序 ≠ desired 顺序：
     全部移除 + 全部重加（声明的相等性用 pi-ai 的 declarationsEqual）
  否则返回 [移除 offered 中不再保留的, 添加 added]
```

#### 关键代码

`src/harness/prompt.ts:66-93`：

```ts
export function planSystemEntries(
	view: ContextView,
	desired: ReadonlyMap<string, string>,
	tools: readonly Tool[],
	timestamp: number,
): SystemDraft[] {
	const head = view.head;
	if (head !== undefined && !view.entries.some((entry) => SystemEntry.is(entry) && entry.id > head.id)) {
		// head 之后没有 pi.system：必须写一条完整基线，并 omit 掉范围内所有更早的 pi.system entry
		const edits: ContextEdit[] = view.entries
			.filter((entry) => SystemEntry.is(entry))
			.map((entry) => ({ target: entry.id, action: "omit" }));
		const baseline = systemEntry(
			Object.fromEntries(desired),
			{ toolsRemoved: [], toolsAdded: tools.map(toToolDeclaration) },
			timestamp,
		);
		return [edits.length === 0 ? baseline : { ...baseline, edits }];
	}
	const sections = planSections(replaySections(view.messages), desired);
	const changes = planTools(getCurrentTools(view.messages), tools);
	if (changes.toolsRemoved.length === 0 && changes.toolsAdded.length === 0) {
		return sections.map((patch) => systemEntry(patch, undefined, timestamp));   // 只有 section 变化
	}
	if (sections.length === 0) return [systemEntry(undefined, changes, timestamp)]; // 只有工具变化
	return sections.map((patch, index) =>
		systemEntry(patch, index === sections.length - 1 ? changes : undefined, timestamp),  // 工具挂在最后一条
	);
}
```

#### 不变式与边界

- **写入最小化是三个分支的优先级**：head 基线（必须写）> 顺序重写（两条 entry）> 最小补丁（0–1 条）。
- **基线一定会写**：即使重放出来的值与目标完全一致，只要 head 之后没有 `pi.system`，就写完整基线并用 `omit` 把保留的更早 `pi.system` 排除掉（否则模型会同时看到旧基线与新基线）。
- **顺序是等价的一部分**：section 顺序变化或工具顺序变化都触发「清空 + 重建」。
- **section 渲染失败不破坏已有内容**：抛错时保留 `shown` 里的旧文本并上报；若要区分「中止导致的失败」，看 `context.abortSignal`。
- **工具声明变化会被视为「移除 + 重加」**：`declarationsEqual` 不相等就是不同工具（同名的旧声明先移除，新声明再添加）。
- `systemEntry` 只在非空时写 `toolsRemoved` / `toolsAdded` / `sections`，避免写空字段。

#### 相关测试

- `test/harness-prompt.test.ts:72-119`：渲染顺序、标签包裹、`undefined` 省略、抛错保留旧文本并上报、中止后错误传播。
- `test/harness-prompt.test.ts:121-139`：`replaySections` 的就地设置 / `null` 删除 / 重新加回追加。
- `test/harness-prompt.test.ts:141-203`：最小补丁、顺序重写（两条 entry）、head 之后的重基线（带 `omit`、即使重放已匹配也要写）。
- `test/harness-prompt.test.ts:206-273`：工具声明的新增/删除/替换/顺序重写，以及「工具变化挂在最后一条 section entry 上」「head 之后重新声明全部工具」。

### 4.5.4 src/harness/context.ts

`context.ts` 从存储里重建「活跃 transcript 与模型上下文」：先用两次 O(1) 读取在 Session line 上固定上下文范围（`ContextBounds`），再脱离 line 扫描这个范围内的 entry，套用 edit、按 head marker 截断、排除不该发给模型的 assistant 消息，最后把 tool result 按调用顺序重排。`Conversation.context()`、`pi.live` 的视图、prompt 规划与压缩都依赖它。

#### 导出面

```ts
// src/harness/context.ts:12-15
export type ContextBounds = {
  readonly head: (EntryRecord & { readonly head: EntryId }) | undefined;
  readonly tail: EntryId;
};

// src/harness/context.ts:22-27
export async function captureContextBounds(
  storage: Storage, conversationId: ConversationId, context: Context, at?: EntryId,
): Promise<ContextBounds | undefined>;      // at 省略：取最新 entry 作为 tail；at 给出：以它为 tail

// src/harness/context.ts:42-48
export async function readContext(
  session: SessionImpl, storage: Storage, conversationId: ConversationId, context: Context, at?: EntryId,
): Promise<ContextView>;                    // bounds 在 line 上取，其余在 line 外推导

// src/harness/context.ts:59-64
export async function deriveContext(
  storage: Storage, conversationId: ConversationId, bounds: ContextBounds | undefined, context: Context,
): Promise<ContextView>;

// src/harness/context.ts:85-90
export async function activeEntries(
  storage: Storage, conversationId: ConversationId, bounds: ContextBounds | undefined, context: Context,
): Promise<EntryRecord[]>;                  // 只要原始活跃 entry，不推导模型上下文（视图挂载用）

// src/harness/context.ts:129
export function orderToolResults(messages: readonly Message[]): Message[];
```

内部常量：`SCAN_PAGE_SIZE = 256`、`EXCLUDED_STOP_REASONS = {aborted, error, deferred}`、`MISSING_RESULT_TEXT`。

#### 关键流程

```text
captureContextBounds(storage, cid, context, at?)      // 必须在 Session line 上
  at 省略 → tail = 最新一条 entry 的 id（scanEntries 取 1 条）；没有 entry → undefined
  at 给出 → 该 entry 必须可见，否则抛 `Entry <id> is not visible from conversation <cid>`
  head = storage.findLatestHeadMarker(cid, tail)      // 第二个 O(1) 读
  → { head, tail }

deriveContext(storage, cid, bounds, context)          // 可以脱离 line
  bounds 为 undefined → { head: undefined, entries: [], contributions: [], messages: [] }
  range  = scanRange(...)      // 从 head.head（或 transcript 起点）到 tail，按页 256 扫，再 reverse 成 oldest-first
  edits  = Map<EntryId, ContextEdit>：遍历 range 中每条 entry 的 edits，后者覆盖前者
           // 注意：范围内更早的 head marker 自身的 edits 也算（即使 selectActive 会丢掉那个 marker）
  entries = selectActive(head, range)                  // head 存在：head + 范围内非 head entry；否则整个 range
  contributions = entries.map(entry =>
       edit?.action === "omit"    → []
       edit?.action === "replace" → edit.messages
       否则                        → entry.model ?? []
       再过滤掉 assistant 且 stopReason ∈ {aborted, error, deferred} 的消息
  )
  messages = orderToolResults(contributions.flat())

orderToolResults(messages)
  跳过所有 toolResult（它们由所属 assistant 决定位置）
  其余消息按原顺序入列；遇到 assistant：
      收集它之后、下一条 assistant 之前的 toolResult（同 toolCallId 只取第一条）
      按该 assistant 的 toolCall 顺序，把结果接在它后面
      没有对应结果 → 合成一条 isError 的结果（details.reason = "missing_result"）
  没有匹配到任何 call 的 toolResult → 丢弃
```

#### 关键代码

`src/harness/context.ts:129-151`：

```ts
export function orderToolResults(messages: readonly Message[]): Message[] {
	const ordered: Message[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!;
		if (message.role === "toolResult") continue;      // 结果的位置由它的 assistant 决定
		ordered.push(message);
		if (message.role !== "assistant") continue;       // system / user 原样入列
		const calls = message.content.filter((content): content is ToolCall => content.type === "toolCall");
		if (calls.length === 0) continue;
		const results = new Map<string, number>();        // callId → 消息下标（首个）
		for (let next = index + 1; next < messages.length && messages[next]!.role !== "assistant"; next++) {
			const candidate = messages[next]!;
			if (candidate.role === "toolResult" && !results.has(candidate.toolCallId)) {
				results.set(candidate.toolCallId, next);
			}
		}
		for (const call of calls) {
			const resultIndex = results.get(call.id);
			ordered.push(resultIndex === undefined ? missingResult(call, message.timestamp) : messages[resultIndex]!);
		}
	}
	return ordered;
}
```

#### 不变式与边界

- **bounds 的读取必须在 Session line 上**：tail 以下（含）的 entry 是不可变的，因此随后的扫描可以脱离 line；`readContext` 就是这么分工的。
- **head 语义**：`head` 是 tail 之前最新的 head marker；活跃范围是「`head.head`（或 transcript 起点）到 tail」，`entries` 是「head marker + 范围内的非 head entry」。`head === "self"` 由写入层解析成自身 ID（`test/harness-context.test.ts:45-49`）。
- **edit 的胜负**：同一个 target 取范围内**最新**的一条；`omit` 影响 `contributions`（该 entry 不贡献消息），但 `entries` 仍然包含它（原始视图不变）。
- **排除的 stopReason**：`aborted` / `error` / `deferred` 的 assistant 消息不进入 `messages`，但它们的 entry 仍在 `entries` 里（`test/harness-context.test.ts:32-43` 验证 `length` 与消息序列）。
- **缺失结果一定补上**：分叉或 head 切断导致结果缺失时，合成一条 `isError` 的 toolResult（`details.reason: "missing_result"`），保证 assistant 的每次 tool call 都有对应结果。
- **孤儿结果被丢弃**：`toolCallId` 不在任何 call 里的结果不发送（用例中 `toolResult("zz")`）。
- **head 切断调用与结果时**：范围里只剩孤立结果 → 全部丢弃，`messages` 为空（`test/harness-context.test.ts:129-133`）。
- 抛错条件：`captureContextBounds` 在 `at` 指定的 entry 不可见时抛错；`deriveContext` 对 `bounds === undefined` 返回空视图而不抛。
- 性能注意：`SCAN_PAGE_SIZE = 256`、按页扫描后 `reverse`，因此范围越大成本线性；`captureContextBounds` 固定两次读取。

#### 相关测试

- `test/harness-context.test.ts:21-30`：无 head 时返回整条 transcript，模型消息排除无 model 的 entry。
- `:32-43`：排除 `aborted` / `error` / `deferred` 的 assistant，但保留其原始 entry。
- `:45-63`：self head、最新 head marker、compaction summary 指向更早保留 entry。
- `:65-84`：同一 target 取最新 edit；范围之外的 edit 不再生效。
- `:86-106`：位置性 system 消息保留在原始位置，tool result 按调用顺序重排。
- `:108-134`：fork 后缺失结果被合成（含 `missing_result` 标记），被 head 切断的孤儿结果不发送。

### 4.5.5 src/harness/provider.ts

`provider.ts` 给每个会话定义一个持久、稳定的 provider 侧身份（`sessionId`），随每次模型请求转发给 pi-ai，用于 provider 的 prompt cache 与会话粘性。身份由内建文档 `pi.provider` 承载：创建会话时生成新的 UUIDv7，fork 取新身份而不继承父，缺失时（legacy 会话）在第一次请求前用一次迁移提交补上。

#### 导出面

```ts
// src/harness/provider.ts:7-9
export type ProviderState = { sessionId: string };

// src/harness/provider.ts:12-20
export const ProviderDoc = defineDoc<ProviderState>({
  kind: "pi.provider", version: 1, scope: "conversation",
  history: "latest",
  fork: "initial",                          // 分叉取“初始值” → 新 UUIDv7，不继承父身份
  initial: () => ({ sessionId: uuidv7() }),
  checkpointWhen: () => true,               // 每次都存完整 base
});

// src/harness/provider.ts:26-29
export async function ensureProviderSessionId<I, S, R, H extends object>(
  runtime: TaskRuntime<I, S, R, H>,
  context: Context,
): Promise<string>;
```

#### 关键流程

```text
ensureProviderSessionId(runtime, context)
  existing = await runtime.snapshot(ProviderDoc, runtime.conversationId, context)
  if existing !== undefined: return existing.sessionId        // 正常路径：零写入
  created = undefined
  await runtime.commit(async (tx) => {                        // 迁移提交（只会发生一次）
      created = (await tx.doc(ProviderDoc, conversationId)).sessionId   // tx.doc 触发 initial()
      return undefined
  }, context)
  if created === undefined: throw new Error(`Conversation <cid> has no provider session ID`)
  return created

请求侧（src/harness/generation.ts:202-207）：options = { ...streamOptions, signal, sessionId, reasoning? }
压缩侧（src/harness/compaction.ts:171）：同样带上 sessionId
```

#### 关键代码

`src/harness/provider.ts:22-39`：

```ts
/**
 * Return the persisted identity without writing in the normal path. A legacy conversation without `pi.provider` gets
 * one migration commit whose `tx.doc()` runs `initial()` before the provider request starts.
 */
export async function ensureProviderSessionId<I, S, R, H extends object>(
	runtime: TaskRuntime<I, S, R, H>,
	context: Context,
): Promise<string> {
	const existing = await runtime.snapshot(ProviderDoc, runtime.conversationId, context);
	if (existing !== undefined) return existing.sessionId;      // 已存在：不写
	let created: string | undefined;
	await runtime.commit(async (tx) => {
		created = (await tx.doc(ProviderDoc, runtime.conversationId)).sessionId;   // initial() 生成 UUIDv7
		return undefined;
	}, context);
	if (created === undefined) throw new Error(`Conversation ${runtime.conversationId} has no provider session ID`);
	return created;
}
```

#### 不变式与边界

- **正常路径零写入**：只要 `pi.provider` 存在，就只读一次。
- **fork 不继承**：`fork: "initial"` 保证分叉拿到新身份（回归 #10424）；三会话（root/child/fork）身份互不相同且都是 UUIDv7。
- **每会话独立、请求局部**：同一会话的多轮请求用同一个 sessionId，不同会话不同，并发请求不会串号。
- **持久稳定**：reopen 后 identity 保持不变。
- **迁移提交在请求之前**：`tx.doc()` 先运行 `initial()`，因此不存在「请求已发出但身份还没落库」的窗口。
- `checkpointWhen: () => true`：该文档每个提交都记完整 base（体积很小，换来简单性）。
- 防御式分支：`created === undefined` 的抛错在当前写入路径下不可达。

#### 相关测试

- `test/harness-conversations.test.ts:97-99`、`:120-128`、`:140-148`、`:392-419`：UUIDv7 形状、root/child/fork 三者不同、reopen 稳定、task-owned 会话与其 owner 不同、task-owned fork 与父不同。
- `test/harness-generation.test.ts:365-386`：请求 options 中的 `sessionId` 与存储值一致；`:388-429`：并发会话的 sessionId 是请求局部的；`:431-450`：legacy 会话在请求前创建并持久化身份（并断言 UUIDv7 正则）。
- `test/harness-compaction.test.ts:395`、`:414-418`、`:834`：压缩路径与退休后重建。
- `test/provider-session-cache-e2e.test.ts`：真实 Codex 端到端（无凭证时 skip），断言 `forwarded` 全等于存储 sessionId 且缓存命中率 ≥ 0.9。

### 4.5.6 src/harness/registry.ts

`registry.ts` 是 Extension 的安装台：`createRegistry()` 返回一个进程内、不持久化、可跨 Harness 存活的注册表；`install()` / `uninstall()` 同步发布新的不可变 `RegistrySnapshot`，并在发布前按「替换后的状态」校验。内建 task 定义（`pi.generation` / `pi.tool` / `pi.compaction`）永远在注册表里，不属于任何 Extension，也不能被卸载或替换。

#### 导出面

```ts
// src/harness/registry.ts:10
export const BUILTIN_TASKS: readonly AnyTask[] = [GenerationTask, ToolTask, CompactionTask];

// src/harness/registry.ts:112-114
export function createRegistry<Tool extends ToolRegistration = ToolRegistration>(): Registry<Tool>;
```

内部实现（对理解行为必要）：`RegistryState`（`:13-58`，不可变快照）、`RegistryImpl`（`:60-93`，发布器）、`validateExtension`（`:96-109`）、`SECTION_KEY = /^[a-z][a-z0-9_-]*$/`（`:7`）。

`RegistryState` 的查询语义：`installed()` 返回发布时的 Extension 数组；`tools()` / `sections()` 按**安装顺序**摊平（工具名可跨 Extension 重复）；`tasks()` 是「内建在前，其次按安装顺序」，`task(name)` 按名字取。构造函数会检查 task 名冲突：与内建或已安装 Extension 同名 → 抛错。

#### 关键流程

```text
install(E)
  validateExtension(E)                    // 工具名、section key 的规则
  next = 同名位置就地替换，或追加到末尾
  publish(next):
      state = new RegistryState(next)     // 这里校验 task 名冲突；抛错则什么都不发布
      current = state
      for listener of listeners: listener()   // 同步通知，不调用任何 Extension 回调

uninstall(E)
  没有同名 Extension → 直接返回（不发布）
  否则 publish(按名字过滤后的列表)          // 之后再 install 同名会追加到末尾

validateExtension(E)
  tools：重复工具名 → 抛 `Extension <name> has two tools named <tool>`
  sections：key 不匹配正则 → TypeError
            key === "instructions" → 抛 `Section key instructions is reserved for the agent's instructions`
            重复 key → 抛
  （hooks / wraps 不校验；task 名冲突在 RegistryState 构造时校验）
```

#### 关键代码

`src/harness/registry.ts:73-92`：

```ts
	install(extension: Extension<Tool>): void {
		validateExtension(extension);                                                // 规则校验
		const current = this.#current.installed();
		const index = current.findIndex((installed) => installed.name === extension.name);
		const next =
			index < 0 ? [...current, extension] : current.map((installed, at) => (at === index ? extension : installed));
		this.#publish(next);                                                         // 替换保持位置
	}

	uninstall(extension: Extension): void {
		const current = this.#current.installed();
		if (!current.some((installed) => installed.name === extension.name)) return;  // 幂等：无此 Extension 则不发布
		this.#publish(current.filter((installed) => installed.name !== extension.name));
	}

	/** Build and validate the next state, which throws on a task name collision, then publish it synchronously. */
	#publish(extensions: readonly Extension<Tool>[]): void {
		this.#current = new RegistryState(extensions);                               // 失败 → current 不变
		for (const listener of [...this.#listeners]) listener();                     // 同步、无 try/catch
	}
```

#### 不变式与边界

- **校验对象是「替换之后的状态」**：把持有某个 task 名的 Extension 换成另一个同样持有该 task 名的版本是合法的。
- **失败不发布**：`#current` 在构造成功之后才赋值，因此校验失败时快照对象不变、订阅者一次都不被通知。
- **快照不可变**：旧的 `RegistrySnapshot` 保留旧值，已开始的解析继续使用它拿到的对象。
- **发布是同步且无扩展回调**：Extension 是重载单位（一次发布替换它的工具、section、hook、wrap、task，并保持位置）。
- **内建 task 不可移除**：`uninstall` 只能按 Extension 名字操作。
- 边界：`#publish` 对 listener 没有 try/catch——某个 listener 抛错会中断后续 listener 并冒泡给 `install()` 调用者（新状态已经发布）；正常实现里调度器注册的 listener 不抛。
- 边界：`validateExtension` 不校验 hook 的目标 task 是否存在、wrap 的目标是否存在；这两者都在解析时惰性处理（目标不存在即静默跳过）。

#### 相关测试

- `test/harness-registry.test.ts:72-102`：安装 / 就地替换 / 卸载；`tools()` 顺序；旧快照不变；订阅者收到的发布序列（替换也会发布）。
- `:104-125`：六类非法安装各自抛错且不发布；「替换持有 task 名的 Extension」合法。
- `:127-137`：内建 task 恒在、可安装/卸载自定义 task。
- `:140-291`：与解析联动（同名工具替换、wrap、过滤、section 顺序）——细节见 4.5.1 的相关测试。

---

## 4.6 harness/ 观察与支持

这一节覆盖「把已提交状态变成可消费的数据」以及支撑它的工具：会话结构视图、Agent 事件流、输出截断与进度节流、子任务图、提交受理、逐叶写入，以及等待器/构造器这两个小件。共同前提只有一条：它们消费的都是**已经 durable 的提交**，不做语义重放，不拥有自己的持久化。

### 4.6.1 src/harness/view.ts

`view.ts` 把「一个会话的活跃 transcript + 5 个内建文档」挂载成一个只读 Chord 值 `ConversationView`，并以两种方式暴露：`Conversation.viewState()`（`AttachedReplicatedState`）与 `Conversation.watch()`（序列化精确 frame watch）。每个会话最多一个 mount，由第一个观察者在 Session line 上构建、随最后一个观察者脱离而丢弃；此后每个 Session 提交都推进 mount 并派生一批 Chord op。它不做语义投影、不拥有持久化，因此「视图里出现的东西一定已经落库」。

#### 导出面

```ts
// src/harness/view.ts:26-32
export type ConversationView = {
  readonly conversation: ConversationRecord;
  readonly entries: readonly EntryRecord[];        // head marker 在前，其后是 head 之后的非 head entry
  readonly docs: Readonly<Record<string, JsonObject>>;   // 按 kind 键控；不存在的文档就没有键
};

// src/harness/view.ts:35-46
export type ViewObserver = {
  advance?(value: ConversationView, ops: readonly Op[], context: Context): void;
  publication?(before, after, ops, publication: CommitPublication, context): void;
  closeSession(): void;
};

// src/harness/view.ts:68
export function conversationViews(harness: object): ConversationViews;   // 取某个 Harness 的 view mounts

// src/harness/view.ts:78
export class ConversationViews {
  state(id: ConversationId, context: Context): Promise<AttachedReplicatedState<ConversationView>>;
  watch(id: ConversationId, context: Context): Promise<WatchHandle<ConversationView>>;
  attach<O extends ViewObserver>(id, create, context): Promise<{ observer: O; detach: () => void }>;
}
```

行为要点：

- `advance` 只在本次提交真的产生 ops 时调用；`publication` **每次发布都调用**（`ops` 可能为空数组），适合做「提交级」的旁路统计。
- `docs` 只包含挂载的 5 个 kind：`pi.agent`、`pi.live`、`pi.inbox`、`pi.provider`、`pi.usage`（`src/harness/view.ts:48-55`）。第三方文档走各自的 Chord 服务，不挂载。
- `watch()` 返回的 `WatchHandle` 就是 `CommittedWatch` 本身：`value`、`start(listener)`、`stop()`、`closed`。

#### 关键流程

```text
attach(id, create, context)                      // 在 session.readOnLine 内，保证原子
  mount = mounts.get(id) ?? build(id, context)   // build：读会话记录 + activeEntries + 5 个文档
  detach = 删 observer；最后一个离开且仍是当前 mount 时删 mount
  observer = await create(mount.value, detach, storage)   // 从当前 revision 出发
  closed → throw closedError()；context 已取消 → throwIfAborted()
  mounts.set(id, mount); mount.observers.add(observer)

advance(id, mount, publication, context)
  docOps = []; entryOps = []; entries = mount.value.entries
  for change of publication.changes:
    entry 且属于本会话：
        无 head → ["p", ["entries"], entries.length, 0, [entry]]（尾部插入）
        有 head → kept = 首个「非 head 且 id >= head」的下标（找不到则 entries.length）
                  ["p", ["entries"], 0, kept, [entry]]（删 [0,kept)，marker 插到最前）
                  entries = [marker, ...entries.slice(kept)]
    document 且属于本会话、kind 已挂载、非 family key：
        value === null → 化身匹配才 ["d", ["docs", kind]]（退休）；不匹配则跳过
        同化身同版本   → 逐条 change.ops 用 prefixed() 搬到 ["docs", kind] 下
        其它           → ["s", ["docs", kind], value]（新化身/新版本，整值）
  ops = [...docOps, ...entryOps]
  有 ops → applyImmutable 得到新值（entries 没变则复用原数组）→ 每个 observer.advance
  每个 observer.publication(before, after, ops, publication, frameContext)   // 无条件
  frameContext = withoutAbortSignal(context)     // 投递用的 Context 不继承生产者的取消
```

`prefixed()`（`:226-243`）把文档自身的 op 平移到挂载路径下：`["r", v]` 降级为 `["s", prefix, v]`，其余 op 的路径前插 prefix。

#### 关键代码

`src/harness/view.ts:183-213`：

```ts
			if (entry.head === undefined) {
				entryOps.push(["p", ["entries"], entries.length, 0, [value]]);   // 普通追加：尾部 splice 插入
				entries = [...entries, entry];
				continue;
			}
			// A head marker keeps the non-head entries from its head, which are always a suffix, and goes in front.
			const target = entry.head;
			let kept = entries.findIndex((candidate) => candidate.head === undefined && candidate.id >= target);
			if (kept < 0) kept = entries.length;                              // 目标比挂载的都新：全保留
			entryOps.push(["p", ["entries"], 0, kept, [value]]);              // 删 [0,kept)，marker 放最前
			entries = [entry, ...entries.slice(kept)];
			continue;
		}
		if (change.type !== "document" || change.conversationId !== id) continue;
		const kind = change.record.kind;
		if (!MOUNTED_KINDS.has(kind) || change.record.key !== undefined) continue;   // 只挂 5 个 kind，非 family
		const path: NonEmptyPath = ["docs", kind];
		const mounted = mount.docs.get(kind);
		if (change.value === null) {                                         // 退休：匹配化身才删键
			if (mounted?.id !== change.record.id) continue;
			mount.docs.delete(kind);
			docOps.push(["d", path]);
		} else if (mounted?.id === change.record.id && mounted.version === change.version) {
			for (const op of change.ops) docOps.push(prefixed(op, path));    // 同化身同版本：逐 op 搬运
		} else {                                                             // 新化身/新版本：整值 set
			mount.docs.set(kind, { id: change.record.id, version: change.version! });
			docOps.push(["s", path, change.value]);
		}
	}
	const before = mount.value;
	const ops = [...docOps, ...entryOps];                                    // 文档 op 在前，entry op 在后
	const frameContext = withoutAbortSignal(context);
	if (ops.length > 0) {
		const value = docOps.length === 0 ? mount.value : applyImmutable(mount.value, docOps);
		mount.value = entries === value.entries ? value : { ...value, entries };   // entries 未变则结构共享
```

#### 不变式与边界

- **一提交一帧**：`ops.length === 0` 时不产生 revision；触碰了挂载内容就一定产生一帧（`test/harness-view.test.ts:103-131` 用独立计数验证）。改未挂载的文档（例如自定义 `app.*`）不产帧。
- **watch 的帧/ops 语义**：`start()` 之前 `watch.value` 是获取时的 revision；每帧给出「产生该值的那批 op」，从获取 revision 起逐帧 `applyImmutable` 可以重建每个投递值。
- **100 帧背压折叠**：待投递队列上限 100；第 101 帧把整个未投递后缀替换为一帧 `["r", 最新值]`。语义是**收敛**而非审计：需要每个转换的消费者必须自行持久化。
- **head 只保留已挂载条目**：对更早位置的 raw head 写入，mount 只显示已挂载的、且 `id >= head` 的条目；重新构建的 mount 会显示更多（`test/harness-view.test.ts:170-182`）。内建写入者不会写这种 head。
- **退休与重建**：退休发 `["d", ["docs", kind]]`；同一 kind 重建发整值 `["s", ...]`；旧化身退休不会误删新化身的键。
- **结构共享**：未变的部分（entries 数组、docs 对象）在相邻 revision 间是同一对象；挂载值在可信不可变契约下可自由传递。
- **生命周期**：close 后 state 保留最后值、watch 以 `{reason:"session_closed"}` 结束、后续获取被拒（`closedError()`）；获取期间取消/关闭会 reject 且不留下观察者。
- 边界：`#build` 遇到不存在的会话抛普通 `Error("Conversation <id> does not exist")`。

#### 相关测试

`test/harness-view.test.ts`：`:89-101`（挂载内容与空闲文档形状）、`:103-131`（一提交一帧 + 逐帧 replay + 文档 op 形态）、`:133-149`（结构共享与不产帧）、`:151-182`（head 截断与「只显示已挂载条目」）、`:184-212`（fork 只跟随自己）、`:214-229`（退休/重建的两帧形态）、`:231-247`（100 帧折叠为根替换）、`:249-268`（mount 共享与重挂载）、`:270-305`（关闭与取消）、`:307-324`（listener 失败隔离）、`:326-352`（一个提交多条 entry + 一个文档 = 1 帧）。

### 4.6.2 src/harness/events.ts

`events.ts` 提供实验性适配器 `watchEvents(harness, conversationId, context)`：把一个会话已提交的 publication 翻译成「与 coding agent 同形」的 Agent 事件批次。它只覆盖该会话（不含其拥有的子会话），每笔提交产生一批事件，批次本身也走同一个 100 帧有界 watch（溢出时用最新快照替换所有未投递批次）。事件始终相对于附着时的 `snapshot`，不暴露 Chord 文档布局。

#### 导出面

```ts
// src/harness/events.ts:28-33
export type MessageChange =
  | { type: "text_start" | "thinking_start" | "toolcall_start"; contentIndex: number; block: Block }
  | { type: "text_delta" | "thinking_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_delta"; contentIndex: number; path: readonly (string | number)[]; delta: string }
  | { type: "block"; contentIndex: number; block: Block }
  | { type: "message"; message: AssistantMessage };

// src/harness/events.ts:35-53
export type SnapshotEvent = {
  type: "snapshot"; entries: readonly EntryRecord[];
  run?: { inputs: readonly SubmissionId[] };
  generation?: { attempt: number; message?: AssistantMessage;
                 retry?: { at: number; error: string }; deferred?: { pollAt: number } };
  tools: readonly ToolSlot[];
  compactions: readonly CompactionStatus[];
  inbox: readonly { id: SubmissionId; mode: InboxItem["mode"] }[];
  agent: AgentState;            // 缺省 {}
  usage: UsageState;
};

// src/harness/events.ts:92-98
export interface AgentEventStream {
  readonly snapshot: SnapshotEvent;
  start(listener: (events: readonly AgentEvent[], context: Context) => Promise<void>): void;
  stop(): Promise<WatchEnd>;
  readonly closed: Promise<WatchEnd>;
}

// src/harness/events.ts:140-144
export async function watchEvents(harness: Harness, conversationId: ConversationId, context: Context): Promise<AgentEventStream>;
```

#### 全部事件种类、字段与触发时机

| 事件 | 载荷 | 触发时机（相对已提交状态） |
| --- | --- | --- |
| `snapshot` | `entries`、`run?`、`generation?`、`tools`、`compactions`、`inbox`、`agent`、`usage` | 附着时一次；此后**只在背压溢出**时作为唯一一批发出（替换所有未投递批次）。 |
| `run_start` | `inputs: readonly SubmissionId[]` | `pi.live.run` 的 `inputs[0]` 变化（新 run）。steer 加入当前 run、run 内 task 交接都不触发。 |
| `run_end` | `inputs` | `pi.live.run` 消失，或 `inputs[0]` 变成后继 run 的另一个值。 |
| `turn_start` | 无 | 本次提交新建了一个 `pi.generation` task，且它成为当前 `run.taskId`。 |
| `turn_end` | 无 | 该 generation 的 outcome 被提交——**在 `completing` 持有或变终态时，两者取先到者**；生成轮因此总能先于其后继创建的轮结束。 |
| `message_start` | `message: Message` | 一次尝试的**首个已提交 partial**；或者一条带 model 消息的 entry 在没有任何 partial 的情况下被发现（直接以 entry 自身开头）。 |
| `message_update` | `usage: Usage` + `changes: readonly MessageChange[]` | 已提交 partial 变化；只改 `usage` 时 `changes` 为空数组。 |
| `message_end` | `entry: EntryRecord` | 追加的 entry 带 model 消息。工具结果消息的 `message_start` 紧跟在它的 `tool_execution_end` 之后。 |
| `tool_execution_start` | `toolCallId`、`toolName`、`args: JsonObject` | slot 从非 `running` 变为 `running`；`args` 取自同提交里该 tool task 的 intent checkpoint（没有则 `{}`）。 |
| `tool_execution_update` | `toolCallId`、`toolName`、`output?`、`details?`、`diagnostics?` | 运行中的 slot 的保留窗口、details 或 diagnostics 变化（编码见下）。 |
| `tool_execution_end` | `toolCallId`、`toolName`、`entry?: EntryRecord` | slot 变 `done`（带结果 entry）；或未完成的 slot 随 run 结束消失（用同提交追加的结果 entry）；fault / orphan 时无 `entry`。 |
| `entry_appended` | `entry: EntryRecord` | 追加的 entry 没有 model 消息（例如 reset、纯数据 entry）。 |
| `submission` | `record: SubmissionRecord` | 本会话的 submission 记录变化（放置、排队、结算）。同一批内按 submission ID 升序。 |
| `inbox_update` | `items: readonly {id, mode}[]` | `pi.inbox` 文档值变化。 |
| `agent_changed` | `agent: AgentState` | `pi.agent` 文档值变化；退休的文档读作初始值 `{}`。 |
| `usage_changed` | `usage: UsageState` | `pi.usage` 文档值变化；退休读作初始值。 |
| `auto_retry_start` | `attempt`、`at`、`errorMessage` | `pi.live.generation.retry` 出现。 |
| `auto_retry_end` | `attempt` | `pi.live.generation.retry` 消失。 |
| `deferred_poll` | `pollAt` | `pi.live.generation.deferred.pollAt` 变化。 |
| `compaction_start` | `taskId`、`reason`、`blocking` | `pi.live.compactions` 出现一个新 taskId；`blocking` 表示 generation 在等它。 |
| `compaction_end` | `taskId`、`reason` | `pi.live.compactions` 少了一个 taskId。**compaction 的重试退避只出现在快照里**，不发事件。 |
| `task_failed` | `taskId`、`kind`、`message` | 本会话某个 task 以 `faulted` 或 `orphaned` 终态（`aborted` / `completed` 不发）。 |

#### 关键流程

```text
watchEvents(harness, conversationId, context)
  在 Session line 上 attach：
      scanTasks({conversationId, kind: "pi.generation", status: "completing"}, 100, ...)
      → held = 已结束过一轮的 generation 集合（防重复 turn_end）
      watch = CommittedWatch<readonly AgentEvent[]>([], release, () => [snapshotOf(current)])
      publication(before, after, ops, publication, ctx):
          current = after
          events = translate(conversationId, before, after, ops, publication, held)
          events.length > 0 → watch.advance(events, [], ctx)      // 批次不携带 Chord op
  获取用 context 决定流的寿命：取消/关闭都结束它

translate：一笔提交 → 一批（批内顺序固定）
  1. 收集本会话的 entries / tasks / submissions；全空且 viewOps 空 → 不发批
     submissions 按 ID 升序
  2. tool_execution_start（slot 刚变 running）
  3. message_start（首个 partial）或 message_update（partial 变化）
  4. tool_execution_update（每个“现在 running 且之前也 running”的 slot）
  5. auto_retry_start / auto_retry_end / deferred_poll
  6. 计算 toolEnds（见下表）
  7. entries 按 append 顺序：先发属于该 entry 的 tool_end，再发 message_start（非 streamed）/message_end
     或 entry_appended
  8. 无 entry 的 tool_end
  9. compaction_end → task_failed → turn_end
 10. run_end
 11. submission（按 ID 升序）
 12. inbox_update → agent_changed → usage_changed
 13. compaction_start → run_start → turn_start
```

**消息增量的编码形式**（`messageChanges`，`:352-389`）——消费端只靠这些增量即可重建每个已提交 partial：

```text
op 路径是 ["docs","pi.live","generation","message"] 的前缀  → { type: "message", message }   // 整条替换
rest[0] === "usage"                                        → 跳过（只更新事件里的 usage）
rest[0] !== "content"                                      → { type: "message", message }
rest.length === 1（整个 content）：
    ["p", path, index, 0, blocks] → 每个新 block 一个 start（text_start / thinking_start / toolcall_start），
                                    contentIndex = index + offset，block 带全文
    其它 op                        → { type: "message", message }
rest.length >= 2：
    ["a", ..., "text"|"thinking"] →  text_delta / thinking_delta（delta = op[2]）
    ["a", ..., "arguments", ...]  →  toolcall_delta（path 相对 arguments）
    其它                          →  { type: "block", block: <该 index 的完整 block> }
    // 先用 block 整发的 index 会被记入 whole 集合，本批后续对它的 op 全部跳过
```

**工具增量的编码形式**（`toolUpdate`，`:392-421`）——output 有三种形态，details/diagnostics 各自有「移除」的表达：

```text
沿 ["docs","pi.live","tools", index, "output"] 汇总本批 op：
    "t"（前部裁剪）→ trimStart += op[2]
    "a"（追加）    → append += op[2]
    其它           → set = true
output 取值：
    set 或（值变了但识别不出 trim/append）→ { set: slot.output ?? "" }
    否则 trimStart>0 或 append!==""        → { trimStart?, append? }        // 消费端 text.slice(trimStart) + append
    （都不满足则不产生 output 字段）
details     变化 → { details: slot.details ?? null }      // 被移除时显式 null（safe replay 清进度）
diagnostics 变化 → { diagnostics: slot.diagnostics ?? [] } // 被移除时显式空数组
三者都没变化 → 不发 tool_execution_update
```

**工具 end 的判定**（`:256-277`）：

```text
for previous of 之前的 slots:
    previous.status === "done" → 跳过（它更早就结束了）
    现在同名 slot 变 done       → end(用现在 slot 的 entry)
    现在同名 slot 消失          → end(用本批中该 callId 的 tool-result entry；可能是 run 结束一起追加的)
for 现在的 slots 中「之前不存在且已 done」→ end(用它的 entry)
    // 「请求未提供的调用」会直接以 done 出现，因此只有 end、没有 start
```

#### 关键代码

`src/harness/events.ts:352-388`：

```ts
function messageChanges(viewOps: readonly Op[], message: AssistantMessage): MessageChange[] {
	const changes: MessageChange[] = [];
	// A block sent whole already holds every later change to it in this batch.
	const whole = new Set<number>();
	for (const op of viewOps) {
		// View operations never replace the root.
		const path = op[1] as Path;
		if (!startsWith(path, PARTIAL_PATH)) {                       // 不在 partial 子树里
			// The whole message or generation was replaced.
			if (startsWith(PARTIAL_PATH, path)) return [{ type: "message", message }];   // op 路径更短 → 整条替换
			continue;
		}
		const rest = path.slice(PARTIAL_PATH.length);
		if (rest[0] === "usage") continue;                           // 只改了 usage：不发 changes
		if (rest[0] !== "content") return [{ type: "message", message }];
		if (rest.length === 1) {                                     // 整个 content
			if (op[0] !== "p" || op[3] !== 0) return [{ type: "message", message }];
			for (const [offset, block] of (op[4] as unknown as Block[]).entries()) {
				const type =
					block.type === "text" ? "text_start" : block.type === "thinking" ? "thinking_start" : "toolcall_start";
				changes.push({ type, contentIndex: op[2] + offset, block });
			}
			continue;
		}
		const contentIndex = rest[1] as number;
		const field = rest[2];
		if (whole.has(contentIndex)) continue;                       // 该 block 已整发，后续改动已包含
		if (op[0] === "a" && rest.length === 3 && (field === "text" || field === "thinking")) {
			changes.push({ type: field === "text" ? "text_delta" : "thinking_delta", contentIndex, delta: op[2] });
		} else if (op[0] === "a" && field === "arguments") {
			changes.push({ type: "toolcall_delta", contentIndex, path: rest.slice(3), delta: op[2] });
		} else {
			whole.add(contentIndex);
			changes.push({ type: "block", contentIndex, block: message.content[contentIndex]! });
		}
	}
	return changes;
}
```

#### 不变式与边界

- **一提交一批，批内顺序固定**（列表见上）；注意 `run_start` 与 `turn_start` 排在批尾，`run_end` 紧跟 `turn_end` 之后、submission 之前。
- **只覆盖一个会话**；其他会话的提交不产生批次（测试断言批次数量不变）。
- **只推进已提交的 partial**：没有已提交 partial 的尝试不产生任何 `message_start`；每次尝试最多一个 `message_start`，且总有对应的 `message_end`（abort 时 partial 会先被转成 `aborted` 的 assistant entry）。
- **背压 100 批**：第 101 批把未投递批次替换为一个 `snapshot` 批；之后的新提交照常追加。溢出后仍能收到正确的增量（快照里带 in-flight partial 时，之后的 `text_delta` 依样可叠加）。
- **不写任何东西**：事件流是只读观察者；`registry.install()` 与设置修改不产生提交，因此不产生事件——需要最新解析结果的 UI 应重新调用 `Conversation.agent()`（见 2.13 节）。
- 边界：`snapshot` 是附着时固定的对象，不会自我更新；消费者必须把它当作「全量重置点」。
- 存疑：`SnapshotEvent.generation.message` 的类型是 `AssistantMessage`，而 `pi.live` 里存的是 `JsonRepresentation<AssistantMessage>`；构造时直接转型（`:123`）。手册层面应把它理解为「已提交的 JSON 表示」。

#### 相关测试

`test/harness-events.test.ts`：`:106-152`（生命周期序列 + 逐事件重建文本==已提交 partial）、`:154-211`（工具 start/output/end 位置）、`:213-245`（inbox、retry、submission 状态序列）、`:247-264`（100 批折叠）、`:266-302`（thinking/text/toolcall 三种增量重建）、`:304-358`（tail 窗口 `{trimStart, append}` 重建）、`:360-396`（边界批次顺序）、`:398-445`（未提供的调用与随轮 abort 的调用）、`:447-485`（steer 无 run 事件、reset 为 `entry_appended`、其他会话无批次）、`:487-534`（取消与溢出后继续增量）、`:536-584`（usage-only、清进度、fault 无 entry、deferred、退休文档读初始值）、`:586-615`（关闭与 abort 的 start/end 配对）。

### 4.6.3 src/harness/output.ts

`output.ts` 处理工具输出的两个工程问题：**有界保留**（按字节/行数保留 head 或 tail，同时给出精确的丢弃统计）与**节流提交**（进度写入 `pi.live` 既不能每个 chunk 都提交，也不能无限退避）。它提供纯函数（`boundOutput`、`sanitizeOutput`）与两个有状态类：`OutputBuffer` 管窗口与计数，`Progress` 管提交节奏。

#### 导出面

```ts
// src/harness/output.ts:4-15
export type OutputLimits = { readonly maxBytes: number; readonly maxLines: number; readonly retain: "head" | "tail" };
export type BoundedOutput = { readonly text: string; readonly droppedBytes: number; readonly droppedLines: number };
export type OutputSlice = { readonly text: string; readonly bytes: number;
                            readonly droppedBytes: number; readonly droppedLines: number };

// src/harness/output.ts:23
export function sanitizeOutput(text: string): string;

// src/harness/output.ts:32
export function boundOutput(text: string, limits: OutputLimits): OutputSlice;

// src/harness/output.ts:85
export function characterEnd(bytes: Uint8Array, index: number): number;

// src/harness/output.ts:110
export class OutputBuffer {
  constructor(limits: OutputLimits);
  get storedBytes(): number;
  push(chunk: string | Uint8Array): boolean;
  end(): void;
  snapshot(): BoundedOutput;
}

// src/harness/output.ts:217-230
export class Progress {
  constructor(write: () => Promise<number>, onError: (error: unknown) => void);
  mark(): void;
  markAndWait(): Promise<void>;
  stop(): Promise<PromiseWithResolvers<void>[]>;
}
```

- `sanitizeOutput`：删除 `/[\x00-\x08\x0b-\x1f\ufff9-\ufffb]/g`——**保留 `\t`(0x09) 与 `\n`(0x0a)**，删除 `\r` 等其余控制字符。
- `boundOutput`：head 取开头若干整行、tail 取结尾若干整行，结果是含尾换行的精确切片；单行超过 `maxBytes` 时在**字符边界**（按 UTF-8 续接字节判断）截断；未截断时原样返回输入字符串。
- `OutputBuffer.push`：接受字符串或字节块（跨块 UTF-8 安全）；返回值表示「是否有内容被接受」（空块为 `false`，窗口满后仍然 `true`——有内容，只是不再存储）。`end()` 冲刷不完整尾部字符。
- `OutputBuffer.snapshot()`：返回已驻留、已 sanitize 的保留文本，以及相对**整条流**的 `droppedBytes` / `droppedLines`。
- `Progress`：`write()` 必须返回本次提交写入的字节数；`markAndWait()` 的 promise 在「包含该变更的提交」settle 时 settle；`stop()` 等待在飞行中的提交并把未被覆盖的等待者交回调用方。

#### 关键流程

```text
OutputBuffer.#accept(text)
  空 → false
  累计 totalBytes / totalNewlines / endsWithNewline         // 整条流的账目，永不清零
  已满（#full）→ 只记账，不存储
  存入 chunk
  head 保留：storedBytes > maxBytes 或 storedNewlines >= maxLines → #full = true
  tail 保留：只要「去掉最旧 chunk 之后」仍超过 maxBytes+1 或 maxLines+1，就 shift 最旧的 chunk
             （多留一点，保证窗口行首仍能找到；每个 chunk 只丢一次）

Progress 的提交节奏
  nextAt = 0（初始）→ 空闲期后的第一个 mark() 立即提交
  提交成功 → nextAt = started + max(100ms, bytes * 1000 / 100KiB)     // 下限 100ms + 按写入量退避
  提交失败 → nextAt = started + 100ms，reject 该批等待者并上报
  同一时刻最多一个提交在飞行；期间的新变更合并进下一批
  已停止或已有在飞行提交时不调度；timer 与 in-flight 互斥

逐字段去重（由调用方 src/harness/tool.ts:276-322 实现）
  written = { text, details, 已写诊断条数 }
  只写变化：output 作为“一个字符串字段”赋值（让 Chord 自己 diff 成 append / trim+append / 整体 set）
            details 用 assignJson 逐叶写；diagnostics 只 push 新增项
  写入量按 Chord 会写多少估算（命中前缀只算后缀，否则在 64 KiB 内找重叠，找不到算整窗），返回给 Progress
```

#### 关键代码

`src/harness/output.ts:266-287`（节流核心；`#accept` 的存储/丢弃规则见 4.6.3 的流程与 `:144-172`）：

```ts
	#flush(): void {
		if (this.#stopped || !this.#dirty) return;
		this.#dirty = false;                                    // 先清脏：期间的新变更会重新置脏
		const waiters = this.#waiters.splice(0);                // 这批等待者由本次提交负责 settle
		const started = Date.now();
		this.#inFlight = this.#write()
			.then(
				(bytes) => {
					this.#nextAt = started + Math.max(MIN_PROGRESS_INTERVAL_MS, (bytes * 1000) / PROGRESS_BYTES_PER_SECOND);
					for (const waiter of waiters) waiter.resolve();
				},
				(error: unknown) => {
					this.#nextAt = started + MIN_PROGRESS_INTERVAL_MS;      // 失败至少退避 100ms
					for (const waiter of waiters) waiter.reject(error);
					this.#onError(error);
				},
			)
			.finally(() => {
				this.#inFlight = undefined;
				if (this.#dirty) this.#schedule();              // 又有变更 → 重新调度（仍受 nextAt 约束）
			});
	}
```

#### 不变式与边界

- **丢弃统计是精确的**：`droppedBytes` / `droppedLines` 相对整条流（`totalBytes` / `totalNewlines` 永不清零），即使只保留窗口 + 1 个 chunk。测试把「多次 push、间隔取快照」与「对整条流调用 `boundOutput`」逐项比对。
- **sanitize 只作用于保留文本**，计数仍按原始流。
- **零限额**：`maxLines === 0` 或 `maxBytes === 0` 时什么都不留。
- **`end()` 必须调用**：否则尾部不完整字符不会被冲刷成替换字符。
- **tail 的滑窗语义**：`snapshot()` 之后只留窗口，后续滑动是最小 `trim + append`；重复内容能被 Chord 的重叠搜索识别，超过 64 KiB 的扫描窗口时退化为整窗写入（见 `test/harness-live-deltas.test.ts:204-227`）。
- **节流下限**：任何两次提交之间至少 100 ms；写入越大退避越久（50 KiB → 500 ms）。
- **去重是调用方的责任**：`Progress` 只按时间与写入量调度，「只写变化部分」在 `tool.ts` 的 `publishProgress` 里完成——这样 Chord 才能把一次提交记成若干小 op，而不是整个 slot 对象的替换。
- **取消与关闭不破坏一致性**：提交失败只 reject 等待者并上报，`pi.live` 里已提交的内容保持自洽。

#### 相关测试

- `test/harness-output.test.ts:56-130`（`boundOutput` / `sanitizeOutput` 的精确切片、零限额、字符边界、与 Buffer 的穷举与随机比对）、`:134-198`（`OutputBuffer` 的跨块解码、计数、head 满后不存储、tail 滑窗）、`:206-271`（`Progress` 的首发立即、按写入量退避、失败上报、`stop()` 交回等待者）。
- `test/harness-live-deltas.test.ts:164-227`：从 Chord op 形态验证 head（只更新 dropped 计数）、tail（`trim + append`）、超窗退化。
- `test/harness-tools.test.ts:910-929`：一个节流窗口内的三次 `api.details()` 合并提交，三个 promise 依序 settle（`["first","second","third"]`），且最终 `details` 是最后一次的值（`{n:3}`）。

### 4.6.4 src/harness/task-graph.ts

`task-graph.ts` 把整个 Session 的活 task 挂载成一个结构值 `TaskGraph`：每个节点带 owner 边、状态、以及它拥有的会话列表，供 UI 与调试回答「什么在跑、谁在等谁、谁拥有哪些会话」。它是会话视图在 Session 任务层面的对应物：最多一个 mount，由第一个观察者在 Session line 上构建（扫 4 个 live 状态的所有 task，再为每个 task 扫它拥有的会话），之后按提交增量推进；只读，不启用调度。

#### 导出面

```ts
// src/harness/task-graph.ts:19-28
export type TaskGraphState =
  | { readonly status: "pending" | "running"; readonly phase: string }
  | { readonly status: "waiting"; readonly phase: string;
      readonly on: readonly TaskId[]; readonly policy: JoinPolicy }
  | { readonly status: "completing"; readonly outcome: TaskOutcome<JsonValue>["status"] };

// src/harness/task-graph.ts:30-41
export type TaskGraphNode = {
  readonly id: TaskId;
  readonly kind: string;
  readonly conversationId: ConversationId;
  readonly owner?: TaskId;                 // 会话自有 task 没有 owner
  readonly background: boolean;
  readonly abortRequested: boolean;
  readonly state: TaskGraphState;
  readonly conversations: readonly ConversationId[];   // 它拥有的会话，按 ID 升序
};

// src/harness/task-graph.ts:44-47
export type TaskGraph = { readonly tasks: Readonly<Record<string, TaskGraphNode>> };  // 键是十进制 ID 字符串

// src/harness/task-graph.ts:49
export type TaskGraphWatch = WatchHandle<TaskGraph>;

// src/harness/task-graph.ts:62
export class TaskGraphView { state(context); watch(context); }
```

#### 关键流程

```text
构建（在 Session line 上，src/harness/task-graph.ts:131-148）
  for status of ["pending","running","waiting","completing"]:
      scanTasks({status}, 256, cursor) 翻完所有页
  records.sort(按 id 升序)
  for record of records:
      owned = scanConversations({ownerTaskId: record.id}, 256) 翻完所有页
      tasks[String(record.id)] = { id, kind, conversationId, owner?, background, abortRequested, state, owned 升序 }

推进（src/harness/task-graph.ts:152-190）
  第一遍：task 变更
      terminal → 节点存在才 ["d", ["tasks", key]]
      否则 next = 节点候选（复用旧的 conversations）；与旧值 JSON 相等则跳过；否则 ["s", ["tasks", key], next]
  第二遍：conversation 变更（owner 存在且 owner 节点可见）
      created[ownerKey] += conversationId
      对每个 owner：conversations = [...旧列表, ...新增].sort() → ["s", ["tasks", key, "conversations"], ...]
  ops 非空 → applyImmutable + 通知 observer（frameContext 去掉 abort signal）

state 映射
  pending / running → { status, phase: checkpoint.phase }
  waiting           → { status: "waiting", phase, on, policy }
  completing        → { status: "completing", outcome: <状态字符串> }
```

#### 关键代码

`src/harness/task-graph.ts:158-185`：

```ts
	for (const change of publication.changes) {
		if (change.type !== "task") continue;
		const record = change.value;
		const key = String(record.id);
		const previous = node(key);
		if (record.state.status === "terminal") {                    // 终态 → 节点离开图
			if (previous === undefined) continue;
			ops.push(["d", ["tasks", key]]);
			changed.set(key, undefined);
			continue;
		}
		const next = nodeOf(record, previous?.conversations ?? []);  // 复用已收集的 owned 会话列表
		if (previous !== undefined && JSON.stringify(next) === JSON.stringify(previous)) continue;   // 无变化不发 op
		ops.push(["s", ["tasks", key], next as unknown as JsonValue]);
		changed.set(key, next);
	}
	// After the tasks, so a conversation created with its owner task in one commit finds the owner's node. Change order
	// within a publication is unspecified, so each owner's list is sorted again.
	const created = new Map<string, ConversationId[]>();
	for (const change of publication.changes) {
		if (change.type !== "conversation" || change.value.owner === undefined) continue;
		const key = String(change.value.owner.taskId);
		if (node(key) !== undefined) created.set(key, [...(created.get(key) ?? []), change.value.id]);
	}
	for (const [key, ids] of created) {
		const conversations = [...node(key)!.conversations, ...ids].sort((a, b) => a - b);
		ops.push(["s", ["tasks", key, "conversations"], conversations]);
	}
```

#### 节点里有什么、看不到什么

有：`id`、`kind`、`conversationId`、`owner?`、`background`、`abortRequested`、`state`（status + phase；waiting 带 `on`/`policy`；completing 带 outcome 的**状态字符串**）、`conversations`（升序 ID）。

看不到：**input**、**checkpoint 载荷**（只取 `phase`）、**outcome 载荷**（只取 `status`）、**memos**、**定义版本**；也看不到「某个 pending 是否 blocked」与「`on` 里哪些还活着」——这两者依赖注册表与图的其余部分，要读 `Harness.inspect()`（见 2.19 节）。终态 task 不在图里；owner 已终态但仍在的会话也没有节点列出它，要把它挂到父级需读 `ConversationRecord.owner`（`ConversationView.conversation` 也带）。另外 `running` 是**持久状态**：reopen 时 open 会把存活 task 改回 `pending`，直到调度器重新预留。

#### 不变式与边界

- 节点从「创建 task 的提交」存在到「task 终态的提交」；owner 边不可变，所以 `conversations` 在节点活着期间只增不减。
- 一次 publication 最多一个 revision；不改变任何节点就不产生 revision（memo 类提交不发更新）。
- 同一提交里创建 owner 与其 owned 会话时，第二遍用「已更新的节点」查找 owner，结果与提交内的 change 顺序无关。
- 只读：`state()` / `watch()` 都不触发 `resume()`。
- 获取原子性：mount 的构建与登记都在 Session line 上；构建期间取消或关闭会 reject 且不留 observer，下一次获取得到「值相等、引用不同」的新 revision；多个观察者共享同一 mount。
- 边界：`stateOf` 的 `completing`/`terminal` 共用同一分支（终态节点已被删除，不会走到）；`conversations` 只有追加路径（当前不存在「转移 owner」的写入）。

#### 相关测试

- `test/harness-task-graph.test.ts:84-166`：父任务全生命周期（pending → waiting(on/policy) → completing(outcome)）、owned 列表升序、节点删除、每 revision 都不同、一提交建两个会话产生一次设置。
- `:168-238`：reopen 后显示 `pending`、`background: true`、exact frame 逐帧 replay、abort 标记与终态删除。
- `:240-282`：同一提交 fork + create 的顺序无关性。
- `:284-310`：挂起在 line 上时取消 → reject 且不留观察者。
- `:312-357`：memo 提交不产 revision；共享 mount 与重挂载。

### 4.6.5 src/harness/submissions.ts

`submissions.ts` 实现提交协议：把 `Conversation.submit()` 的草稿**持久受理**成一条 submission 记录（`queued` / `placed` / `done` / `unanswered`），决定「立刻放置并开 run」「排进 `pi.inbox`」还是「拒绝」，并提供等待、按 `requestId` 去重与撤回排队项。`admitSubmission()` 是核心：它必须在**一个提交内**完成「读状态 → 写 submission → 写 entry / inbox → 起 run」，因此需要读表的边界准备被放在任何写之前。

#### 导出面

```ts
// src/harness/submissions.ts:23
export class Submissions {
  constructor(session, storage, now: () => number, queueModes: () => QueueModes, resume: () => void);
  submit(conversationId, draft: SubmissionDraft, context): Promise<Submission>;
  get(id, context): Promise<Submission | undefined>;
  status(id, context): Promise<SubmissionRecord>;          // 不存在 → 抛 `Submission <id> does not exist`
  wait(id, context): Promise<SettledSubmissionRecord>;
  abort(id, context, conversationId?): Promise<"aborted" | "already_placed" | "settled" | "not_found">;
}

// src/harness/submissions.ts:148-154
export async function admitSubmission(
  tx: Tx, conversationId: ConversationId, draft: SubmissionDraft, now: number, queueModes: QueueModes,
): Promise<SubmissionId>;
```

#### 关键流程

```text
admitSubmission(tx, cid, draft, now, queueModes)
  1. requestId 去重（在任何写之前）：已有同 id 的 submission
         type 不同 → 抛 `Request <id> already identifies a submission of type <type>`；type 相同 → 直接返回它的 id
  2. live = tx.doc(LiveDoc, cid)；busy = live.run !== undefined
  3. busy 且 input 且 whenBusy === "reject" → 抛 ConversationBusy(cid)（零写入）
  4. boundary = busy ? undefined : await prepareBoundary(tx, cid, queueModes)    // 先读表，再写表
  5. busy 或队列非空：
         createSubmission(status "queued")；内容 copyJson(omitUndefinedProperties)
         input → 入 pi.inbox：mode = whenBusy === "steer" ? "steer" : "followUp"
         write → 入 pi.inbox：mode = "write"
         busy → 直接返回；否则 applyBoundary(..., "final", now)，有 users 就 startRun
  6. 否则（idle 且队列空）：
         write → stale 则记 unanswered/stale；否则 appendEntry + 记 done（entry）
         input → appendEntry(UserEntry, {role:"user", content, timestamp: now}) + 记 placed(entry) + startRun

Submissions 的等待与撤回
  subscribeCommits：任何 done/unanswered 的 submission → resolve 内存等待者
  wait：在 Session line 上「检查是否已结算 + 注册」，避免错过结算提交；取消 context 只取消本次等待
  abort：queued → settle({unanswered, reason:"aborted"}) + 从 pi.inbox 移除；placed → "already_placed"；其它 → "settled"
```

#### 关键代码

`src/harness/submissions.ts:164-191`：

```ts
	const live = await tx.doc(LiveDoc, conversationId);
	const busy = live.run !== undefined;                                    // 繁忙只看 run
	if (busy && draft.type === "input" && draft.whenBusy === "reject") throw new ConversationBusy(conversationId);
	const requestId = draft.requestId === undefined ? {} : { requestId: draft.requestId };
	// A boundary reads the table, so it is prepared before the first table write; a busy one needs none.
	const boundary = busy ? undefined : await prepareBoundary(tx, conversationId, queueModes);
	if (boundary === undefined || boundary.inbox.items.length > 0) {        // 忙，或已有排队项
		const { id } = await tx.createSubmission({ conversationId, ...requestId, type: draft.type, status: "queued" });
		// Hosts may leave optional fields `undefined`; drafts take strict JSON.
		const value = copyJson(draft.type === "write" ? draft.entry : draft.content, { omitUndefinedProperties: true });
		const items = (boundary?.inbox ?? (await tx.doc(InboxDoc, conversationId))).items;
		if (draft.type === "write") items.push({ id, mode: "write", entry: value as JsonObject });
		else {
			const mode = draft.whenBusy === "steer" ? "steer" : "followUp";   // 默认 followUp
			items.push({ id, mode, content: value as JsonRepresentation<UserInput> });
		}
		if (boundary === undefined) return id;                              // 纯排队：不跑边界
		const { users } = await applyBoundary(tx, boundary, "final", now);
		if (users.length > 0) await startRun(tx, conversationId, live, users);
		return id;
	}
```

#### 不变式与边界

- **两层幂等**：同一个 `requestId` 在同一会话里重复提交返回同一条 submission 且**零写入**（去重发生在 busy 检查之前）；`wait()` 的「读 + 注册」在 Session line 上完成，不会漏掉结算。
- **拒绝路径零写入**：busy + `whenBusy: "reject"` 直接抛 `ConversationBusy`，存储提交数不变。
- **唯一会立刻开 run 的路径**是「idle 且队列为空」的 input；busy 只入队。
- **被动写不生成**：`write` 成功后 `pi.live` 仍为 `{}`、不产生 task；stale 写以 `unanswered/stale` 结算且不写 entry。
- **结算合法性由 Session 把关**：对非 `placed` 的 input 调 `settleSubmission` 会抛错；同一提交里二次结算不覆盖第一次。
- **取消与关闭**：取消调用方的 context 只取消那次等待；Harness 关闭 reject 所有挂起等待（含「读记录过程中开始关闭」的竞态）。
- **撤回**：只有 `queued` 可撤回并同时移除 inbox 项；已 `placed` 返回 `"already_placed"`（要真正打断请用 `Conversation.abort()` / `Harness.abortTask()`）。

#### 相关测试

`test/harness-submissions.test.ts`：`:38-55`（idle 写立即 done、无 task）、`:57-80`（idle 输入开 run；busy + reject 零写入）、`:82-107`（requestId 去重与类型冲突、跨会话独立）、`:109-132`（abort 四种结果）、`:134-176`（取消只取消等待、关闭 reject 挂起等待）、`:178-202`（reopen 重新获取并结算）、`:204-221`（submit/wait 启用调度）、`:223-258`（结算合法性）。配套：`test/harness-inbox.test.ts`（边界与 queue modes）、`test/harness-events.test.ts:213-245`（submission 事件序列）。

### 4.6.6 src/harness/json.ts

`json.ts` 只有一个函数 `assignJson`，用来把一个 JSON 值**逐叶**写进目标容器。动机是 Chord 的记账方式：一次容器赋值会被记成完整的 `set`，只有当字符串叶被更长的字符串重写时才产生 append；如果每次节流都整体写回 partial 消息，就会反复存储并发布整条消息。逐叶写入把变更退化成 `["a", [...path], "..."]` 这类小 op，同时让删除以 `["d", [...]]` 显式表达。

#### 导出面

```ts
// src/harness/json.ts:3
type JsonContainer = Record<string, JsonValue> | JsonValue[];

// src/harness/json.ts:10
export function assignJson(target: JsonContainer, key: string | number, value: JsonValue): void;
```

参数：`target` 就地修改的容器；`key` 容器内槽位；`value` 期望达到的 JSON 值。无返回值。

#### 关键流程

```text
assignJson(target, key, value)
  current = target[key]
  两者都是对象 → 先删掉 current 里 value 没有的键（显式删除），再对 value 的每个键递归
  两者都是数组且 current 不更长 → 长度内的下标递归，多出来的元素 push
  否则 current !== value 时整体赋值
```

#### 关键代码

`src/harness/json.ts:5-27`：

```ts
/**
 * Assign `value` at `target[key]` leaf by leaf. Chord records a container assignment as one full set and only emits an
 * append when a string leaf is reassigned with a longer string, so writing the partial whole would store and publish the
 * complete message on every flush.
 */
export function assignJson(target: JsonContainer, key: string | number, value: JsonValue): void {
	const slots = target as Record<string | number, JsonValue>;
	const current = slots[key];
	if (isRecord(current) && isRecord(value)) {                        // 对象对对象：逐叶
		for (const name of Object.keys(current)) if (!Object.hasOwn(value, name)) delete current[name];
		for (const [name, child] of Object.entries(value)) assignJson(current, name, child);
		return;
	}
	if (Array.isArray(current) && Array.isArray(value) && current.length <= value.length) {   // 数组只增不减
		const items = current as JsonValue[];
		for (let index = 0; index < value.length; index++) {
			if (index < items.length) assignJson(items, index, value[index]!);
			else items.push(value[index]!);                            // 新元素 push → Chord 记成 splice
		}
		return;
	}
	if (current !== value) slots[key] = value;                         // 兜底：不同才写（幂等点）
}
```

#### 不变式与边界

- **就地修改、无需释放**：不做拷贝，也不做 JSON 校验；调用方负责传入已经是 JSON 的值（调用点先 `copyJson(..., {omitUndefinedProperties:true})`）。
- **删除是显式的**：`current` 有而 `value` 没有的键会被 `delete`，这正是「safe replay 清进度」能表现为 `["d", ...]` 的原因。
- **数组只在「不更长」时走逐元素路径**；数组变短或类型改变会落到整体赋值。
- **值相同不写**（幂等点）；写字符串叶时 Chord 据此识别为 append。
- 不做循环引用保护。

#### 相关测试

- 没有专门测试文件；行为由输入侧断言覆盖：`test/harness-live-deltas.test.ts:259-277`（partial 文本只发 `["a", [...]]`，首笔是整值 `["s", ...]`）、`:229-257`（details 逐叶 set / append / delete）、`test/harness-events.test.ts:266-302`（用这些 op 的翻译结果重建 partial）。调用点：`src/harness/generation.ts:387`、`src/harness/tool.ts:306`。

### 4.6.7 src/harness/util.ts

`util.ts` 是三个小件：`Waiters` 管理「按键等待某个未来事件」的内存等待者（一次结算、支持取消与批量失败），`scanAll` 把 cursor 分页扫完，`closedError` 统一「Harness 已关闭」的错误文本。它们被提交受理、事件附着、任务图构建等使用。

#### 导出面

```ts
// src/harness/util.ts:5-42
export class Waiters<K, T> {
  add(key: K, context: Context): Promise<T>;
  keys(): K[];
  resolve(key: K, value: T): void;
  rejectAll(error: unknown): void;
}

// src/harness/util.ts:45
export async function scanAll<T>(scan: (cursor: Cursor | undefined) => Promise<Page<T, Cursor>>): Promise<T[]>;

// src/harness/util.ts:56
export function closedError(): Error;
```

#### 关键流程

```text
Waiters.add(key, context)
  signal 已中止 → 立即 reject(signal.reason)
  建 waiter 加入该 key 的集合
  有 signal → 挂 abort(once)：从集合删除（集合空则删 key）+ reject(signal.reason)
              waiter settle 后一定移除监听
Waiters.resolve(key, value)
  先删整个 key（每个 key 只结算一次），再逐个 resolve
Waiters.rejectAll(error)
  收集全部集合并清空，逐个 reject（用于 Harness 关闭，同步执行）

scanAll(scan)：循环 cursor 直到 next 为 undefined，按页顺序收集
```

#### 关键代码

`src/harness/util.ts:8-35`：

```ts
	add(key: K, context: Context): Promise<T> {
		const signal = context.abortSignal;
		if (signal?.aborted) return Promise.reject(signal.reason);       // 已取消：立即失败
		const waiter = Promise.withResolvers<T>();
		const set = this.#sets.get(key) ?? new Set();
		this.#sets.set(key, set.add(waiter));
		if (signal !== undefined) {
			const onAbort = (): void => {
				set.delete(waiter);                                      // 取消只影响这一个等待
				if (set.size === 0 && this.#sets.get(key) === set) this.#sets.delete(key);
				waiter.reject(signal.reason);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			const detach = (): void => signal.removeEventListener("abort", onAbort);
			waiter.promise.then(detach, detach);                         // settle 后一定移除监听
		}
		return waiter.promise;
	}

	keys(): K[] {
		return [...this.#sets.keys()];
	}

	resolve(key: K, value: T): void {
		const set = this.#sets.get(key);
		this.#sets.delete(key);                                          // 一次结算：删 key
		for (const waiter of set ?? []) waiter.resolve(value);
	}
```

#### 不变式与边界

- **一个 key 只结算一次**：`resolve` 先删 key，`rejectAll` 清空全部；之后的等待必须重新 `add`。
- **取消是局部的**：只从集合里删自己，不影响同 key 的其他等待者，也不改变底层状态。
- **关闭路径同步**：`rejectAll` 同步执行，因此「读记录过程中开始关闭」的竞态也能被捕获。
- **监听器不泄漏**：成功与失败都会 detach。
- `scanAll` 没有循环上限保护，依赖 `Page.next` 严格前进；返回顺序 = 页顺序（调用方通常随后排序）。
- `closedError()` 的文本是契约：测试用 `rejects.toThrow("Harness is closed")` 匹配。
- 存疑：`Waiters.keys()` 在 `src/` 下没有调用点（只有定义），可能是测试或未来使用的预留。

#### 相关测试

- 无独立单测；由使用方覆盖：`test/harness-submissions.test.ts:134-176`（取消只取消一次等待、关闭 reject 全部）、`test/harness-view.test.ts:281-305`、`test/harness-task-graph.test.ts:284-310`（取消与 "Harness is closed"）。

### 4.6.8 src/harness/define.ts

`define.ts` 是六个纯构造/恒等函数：不做任何校验，只把字面量收窄成正确泛型（`Extension`、`ToolRegistration`、`PromptSection`、`HookRegistration`、`Wrap`），并在需要时把「对象」投影成「名字」。它是类型面与注册表之间的人机接口；spec 明确「`defineExtension()` 与 `section()` 什么都不检查」，真正校验发生在 `Registry.install()`（见 4.5.6）与解析时。

#### 导出面

```ts
// src/harness/define.ts:6
export function defineExtension<Tool extends ToolRegistration = ToolRegistration>(extension: Extension<Tool>): Extension<Tool>;

// src/harness/define.ts:13
export function defineTool<TParameters extends TSchema, TDetails extends JsonValue = JsonValue>(
  tool: ToolRegistration<TParameters, TDetails>,
): ToolRegistration<TParameters, TDetails>;

// src/harness/define.ts:20-24
export function section<Tool extends ToolRegistration = ToolRegistration>(
  key: string, render: PromptSection<Tool>["render"], options?: { readonly tag?: boolean },
): PromptSection<Tool>;

// src/harness/define.ts:29
export function hook<K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): HookRegistration;

// src/harness/define.ts:34
export function wrapTool<Tool extends ToolRegistration>(tool: Tool, wrapper: (tool: Tool) => Tool): Wrap<Tool>;

// src/harness/define.ts:39-42
export function wrapSection<Tool extends ToolRegistration = ToolRegistration>(
  key: string, wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>,
): Wrap<Tool>;
```

#### 关键流程

```text
defineExtension / defineTool   → 原样返回（只做类型收窄）
section(key, render, tag?)     → { key, render }；tag 明确给出时才写 { tag }
hook(task, handlers)           → { task: task.definition.name, handlers }    // 名字匹配，重载 task 后仍命中
wrapTool(tool, wrapper)        → { tool: tool.name, wrap: wrapper }          // 目标用名字表示
wrapSection(key, wrapper)      → { section: key, wrap: wrapper }
```

#### 关键代码

`src/harness/define.ts:28-44`：

```ts
/** Hook handlers for tasks with `task`'s name. */
export function hook<K extends AnyTask>(task: K, handlers: Partial<HooksOf<K>>): HookRegistration {
	return { task: task.definition.name, handlers };        // 只保留 task 名：task 定义重载后 hook 仍能命中
}

/** Wrap the tool named like `tool` wherever the wrapping extension is selected. */
export function wrapTool<Tool extends ToolRegistration>(tool: Tool, wrapper: (tool: Tool) => Tool): Wrap<Tool> {
	return { tool: tool.name, wrap: wrapper };              // 找不到目标时什么都不做（静默）
}

/** Wrap the section `key` wherever the wrapping extension is selected. */
export function wrapSection<Tool extends ToolRegistration = ToolRegistration>(
	key: string,
	wrapper: (section: PromptSection<Tool>) => PromptSection<Tool>,
): Wrap<Tool> {
	return { section: key, wrap: wrapper };
}
```

#### 不变式与边界

- 六个函数都是运行时恒等或纯构造：不注册、不校验、不发布。
- `hook()` 的类型参数只约束 `handlers` 的键，运行时不静态过滤：`runtime.hooks.each` 只会跳过「不是函数」的项。
- `hook()` 按**任务名**匹配，因此 hook 的签名跨 task 版本保持兼容是 task 作者的责任。
- `wrapTool` / `wrapSection` 的目标是名字：「找不到目标」合法且静默；wrapper 抛错或改名会让目标在那次解析中被丢弃并上报。
- `section()` 不写 `tag` 字段时由渲染层按默认（包裹）处理。
- `defineExtension()` 不校验工具名/ section key 是否重复、task 名是否冲突——这些留给 `install()`。

#### 相关测试

- `test/harness-registry.test.ts:71-138`（注册表规则）、`:140-291`（用这些构造器做解析行为验证）。
- `test/harness-prompt.test.ts:59-61`、`:72-109`（`section()` 的 `tag` 语义与渲染顺序）。
- `test/types.test.ts:256-345`（`hook()` 的类型约束：错误 handler 名或签名是编译错误）。
- `test/harness-support.ts:118-158`（`addTool` / `addSection` / `addTask` / `addHooks` 辅助，返回可 `dispose()` 的句柄）。

---

## 4.7 storage/

`src/storage/` 是 `Storage` 契约（`src/types.ts:993-1085`）的三个实现：`memory.ts` 是参考语义，`sqlite/` 把它落成 SQL 事务，`jsonl/` 落成追加式文件加内存索引。三者跑同一套一致性套件（`src/testing/storage-conformance.ts`），差别只在「一笔提交怎么落盘」「崩溃后能恢复到什么」「谁能同时打开它」。`Storage` 的方法分三组：精确查找（`conversation`/`entry`/`task`/`submission`/`submissionByRequest`/`findDocument`/`document`）、有序 scan（4 种，签名都是 `(query, limit, cursor, context)` → `Page<T, Cursor>`）、生命周期与 ID（`commit`/`mintId`/`close`）。

| 维度 | Memory | SQLite | JSONL |
|---|---|---|---|
| 原子单元 | `prepareCommit` 全量校验 + 幂等 `apply()` | `db.transaction()`（`BEGIN IMMEDIATE`/`COMMIT`） | 追加全部 sidecar → 追加 main marker → 才发布内存态 |
| 一笔提交写什么 | 内存索引 + `nextSeq` | 事件表行、`documents` 行、`document_revisions` 行、`record_ids` 行、`durable_metadata` | 受影响的 `doc-*.jsonl`/`task-*.jsonl` 追加 + `main.jsonl` 一条 marker |
| 崩溃语义 | 无持久化 | WAL + `synchronous = NORMAL`：进程崩溃不损坏，可能丢最后若干已提交事务 | 默认只保证普通进程崩溃一致；已确认尾部提交可能消失，但幸存的 marker 不越过它的 sidecar 数据 |
| fsync | 不适用 | SQLite 内部（NORMAL 档，不逐笔 fsync） | `fsync:true` 时 sidecar 逐个 flush 再写 marker；回收前 flush 一次 main |
| 单进程所有权 | 实例私有状态 | 一个连接 + 进程内串行队列；跨进程只有文件锁 + busy timeout（默认 5000ms），无仓库级承诺 | 目录独占：`open()` 删 `.reclaim`、无条件校验全部 sidecar，无锁 |
| 重开 | 不适用 | migration 检查 → 读 `durable_metadata` | 删 `.reclaim` → 截断撕裂行 → 校验并 replay 全部 marker → 回收 |
| 出口 | 包根 `.` | `./storage/sqlite`（便携）+ `./storage/sqlite/node` | `./storage/jsonl`（便携）+ `./storage/jsonl/node` |

游标在所有后端里同形：`{ after: <上一页最后一项的数值 ID> }`；升序 scan 表示「继续取更大的 ID」，`scanEntries` 因为是最新优先（DESC）表示「继续向更旧的方向」。`limit` 永远是页大小上限，分页通过「多取第 limit+1 项」判断是否给 `next`。

### 4.7.1 src/storage/memory.ts

`Storage` 的参考实现：状态全在内存，但刻意对保留的写入与返回的读取做深拷贝（必要时递归冻结），用来模拟序列化后端天然具备的 ownership 边界，而不是防御性校验（`src/storage/memory.ts:213-218`）。它的第二个身份是 `prepareCommit()`——把一笔提交拆成「全部校验 + 可幂等应用的 `apply()`」，`JsonlStorage` 直接复用这套机制做「先校验、后落盘」（`src/storage/jsonl/storage.ts:279`）。

#### 导出面

- `interface PreparedMemoryCommit`（`:205-211`）：`seq: Seq`、`writes: readonly StorageWrite[]`（**深冻结**的 clone，可安全交给持久化）、`apply(): Seq`（首次真正改状态并返回 `seq`，之后幂等返回同一值）。
- `class MemoryStorage implements Storage`（`:219`）：

| 方法 | 语义 |
|---|---|
| `commit(writes, _context): Promise<Seq>`（`:245`） | `prepareCommit(writes).apply()` |
| `prepareCommit(writes, seq = seqFromNumber(nextSeq)): PreparedMemoryCommit`（`:250`） | 非接口方法；`seq` 必须安全整数且 `>= nextSeq`，否则抛 `Commit sequence N does not strictly increase` |
| `mintId<I>(): Promise<I>`（`:410`） | 实例级 `nextId`（初值 2）取号自增；耗尽 → `ID space is exhausted` |
| `conversation(id, _context)`（`:416`） | 精确查找，返回克隆 |
| `scanConversations(query, limit, cursor, _context)`（`:422`） | 升序；`ownerTaskId` 索引优先，`ownerConversationId` 作合取过滤 |
| `entry(id, ctx)` / `entry(conversationId, id, ctx)`（`:448-472`） | 单参=全局精确查；双参额外要求经该 conversation 的祖先链可见；都返回 `{entry, commitSeq}` |
| `findLatestHeadMarker(conversationId, atOrBeforeEntryId, _ctx)`（`:474`） | 沿祖先链找最新带 `head` 的 entry，截止 ID 包含式 |
| `scanEntries(query, limit, cursor, _ctx)`（`:499`） | 最新优先；应用每层 `conversation.parent.at` cap |
| `task` / `scanTasks(query, limit, cursor, _ctx)`（`:517`/`:523`） | 过滤 `conversationId`/`kind`/`status`/`abortRequested`/`background`（合取） |
| `submission` / `scanSubmissions`（`:545`/`:551`） | 过滤 `conversationId`/`status` |
| `submissionByRequest(conversationId, requestId, _ctx)`（`:571`） | conversation 作用域 requestId 去重键 |
| `findDocument(address, at, _ctx)`（`:582`） | `at === "current"` 走 `currentId`；数值点按 incarnation 升序取第一个存活者 |
| `document(id, at, _ctx)`（`:599`） | 物化具体 incarnation，不跟随同地址替换 |
| `scanDocuments(query, limit, cursor, _ctx)`（`:612`） | 只枚举 `query.scope` 内 `query.at` 存活的 incarnation，升序 ID |
| `close(_context)`（`:631`） | 置 `closed`；之后一切操作抛 `MemoryStorage is closed` |

#### 关键流程

```text
prepareCommit(writes, seq)                                  （:250-271）
  1. assertOpen()
  2. seq 校验：安全整数且 >= nextSeq
  3. detachedWrites = freeze(resolveDocumentCopies(clone(writes)))
       copy 源在同批被改 / 无法读取 / 形状不匹配 → 抛；非 StorageRejected 的失败包成 StorageRejected
  4. checkGlobalIds           // conversation/entry/document 全局唯一且批内唯一；
                              // task/submission 允许同类型重写，不允许跨类型
  5. prepareDocumentActions   // 同一 incarnation 折叠成 {create?, content?, retire}
  6. checkDocumentActions     // 地址唯一、create/retire 合法、delta 版本边界
  7. 返回 { seq, writes, apply }
apply() 首次：
  写各表 Map/有序数组/owner 与 status 索引/请求去重 Map → applyDocumentActions
  （create 盖 createdAt，同批 retire 再盖 retiredAt；base 覆盖 current-only 的 revisions；retire 清空）
  → nextSeq = seq + 1
```

游标：`cursorId()` 只接受 `{ after: <安全整数> }`，否则抛 `TypeError("Invalid storage cursor")`（`:120-125`）；`page()` 靠「调用方是否多取了第 limit+1 项」决定 `next`（`:199-203`）；`scanEntries` 把游标换算成上界 `min(maxEntryId ?? +∞, after - 1)`（`:507-508`）。祖先可见性（`:654-677`）：从目标对话开始倒序 yield，再用 `conversation.parent.at` 收缩上界并跳到父对话。文档物化（`:635-652`）：数值点先拒绝 current-only → 半开区间 `createdAt <= at < retiredAt` 判断存活 → 取 `seq <= at` 的切片 → 回扫最新 base → 逐个应用 delta（版本不一致即抛）→ 返回 `{record, version, value, deltasSinceBase}`。

#### 关键代码

`src/storage/memory.ts:199-203`、`250-271`：

```ts
const page = <T extends { readonly id: Id<string> }>(values: readonly T[], limit: number): Page<T, Cursor> => {
	const items = values.slice(0, limit);
	if (values.length <= limit) return { items: clone(items) };         // 没有第 limit+1 项 → 无 next
	return { items: clone(items), next: { after: items.at(-1)!.id } };  // 游标只编码最后一项的数值 ID
};

	prepareCommit(writes: readonly StorageWrite[], seq: Seq = seqFromNumber(this.nextSeq)): PreparedMemoryCommit {
		this.assertOpen();
		if (!Number.isSafeInteger(seq) || seq < this.nextSeq) {
			throw new Error(`Commit sequence ${seq} does not strictly increase`);   // 严格递增，允许跳号
		}
		const detachedWrites = freeze(this.resolveDocumentCopies(writes.map((write) => clone(write))));
		this.checkGlobalIds(detachedWrites);
		const documentActions = this.prepareDocumentActions(detachedWrites);
		this.checkDocumentActions(documentActions);
		let applied = false;
		return {
			seq,
			writes: detachedWrites,                                     // 深冻结：可安全交给持久化
			apply: () => {
				if (!applied) {                                         // 幂等
					applied = true;
					this.applyPreparedCommit(detachedWrites, documentActions, seq);
				}
				return seq;
			},
		};
	}
```

#### 不变式与边界

- 抛错清单（都是确定性拒绝，Session 可安全回滚）：游标非法（`:123`）、seq 不递增（`:253`）、ID 跨表或批内重复（`:689-695`）、文档多内容命令/重复 retire（`:716-726`）、`Unknown document`/`already exists`/`is retired`/`delta has no base`/`version transition requires a base`（`:738-746`）、`Document address already has a current incarnation`（`:759`）、`does not retain historical content`（`:639`）、缺 base（`:646`）、copy 源非法（`:287-308`，最终形态是 `StorageRejected`）、未知对话（`:481`/`:660`）、已关闭（`:808`）、ID 耗尽（`:412`）。
- 出站克隆、入站冻结是契约（`src/types.ts:1583-1590`）：`test/memory-storage.test.ts:10-31` 固定「`prepared.writes` 不可改」「两次 `apply()` 同 seq」「读仍是克隆」。
- `clone` 保留 null-prototype，并用 `Object.defineProperty` 处理 `key in result` 的原型键，避免 `constructor`/`toString` 之类被原型吞掉（`:92-112`）。
- 无锁：并发由 Session 的 mutation line 负责（`docs/spec.md:4347-4350`），Memory 只有 `closed` 标志。
- current-only 定义：`scope.kind !== "conversation" || history === "latest"`（`:194-195`），只在收到 base 或 retire 时丢历史。

#### 相关测试

`test/memory-storage.test.ts`（`:8` 注册全套一致性用例，`:10-31` 断言冻结/幂等/克隆）。一致性套件中与本文件直接相关的用例：`reserves ID 1 for the immutable root conversation`（`src/testing/storage-conformance.ts:94`）、`commits mixed table writes atomically and rolls all of them back on failure`（`:103`）、`detaches retained writes and every returned record`（`:165`）、`detaches prototype-like JSON keys without changing object prototypes`（`:222`）、`indexes entries committed out of ID order`（`:247`）、`continues an entry cursor below its last item after a newer commit`（`:269`）、`scans deep fork history newest-first through every ancestor cap`（`:363`）、`reconstructs rewindable documents and preserves half-open incarnations`（`:715`）、`keeps one global record ID namespace and rejects exhausted ID minting`（`:1555`）、`rejects every operation after close`（`:1575`）。

### 4.7.2 src/storage/sqlite/storage.ts

一次 Session commit = 一个 SQL 事务。事件表存「索引列 + 完整 JSON 记录」，文档 incarnation 存 `documents`，base/delta 按 `(document_id, seq)` 存 `document_revisions`；读侧只做索引范围查并回放 Chord delta，不把操作翻译成 SQLite JSON 函数。它只依赖 `SqliteDatabase` 门面（见 4.7.5 节），因此不 import `node:sqlite`。

#### 导出面

- `static async open(db: SqliteDatabase): Promise<SqliteStorage>`（`src/storage/sqlite/storage.ts:144-160`）：先 `applySqliteMigrations`，再读 `durable_metadata`（缺行 → `Durable SQLite metadata is missing`）；初始化失败尽力 `db.close()` 但保留原错误。构造器私有（`:138`）。
- `class SqliteStorage implements Storage`（`:130`）：方法语义与 Memory 相同，SQLite 侧的取巧点是：

| 方法与行 | SQLite 特有之处 |
|---|---|
| `commit`（`:162-185`） | 事务内重读 metadata 取 `committedSeq`；成功后（settle 后）才把 `candidateNextId` 采纳进内存 `nextId` |
| `mintId`（`:187-191`） | 只动内存 `nextId`，号在 commit 时随 `next_id` 落库 |
| `scanConversations`/`scanTasks`/`scanSubmissions`（`:199`/`:359`/`:405`） | `id > ?` + 可选过滤列 + `ORDER BY id LIMIT limit+1` |
| `entry` 双参重载（`:258-289`） | 顺祖先链收缩 `upperEntryId`，`entry.id > upperEntryId` → undefined；`commitSeq` 取自 `entries.commit_seq` |
| `findLatestHeadMarker`（`:291-315`） | `head IS NOT NULL [AND id <= ?] ORDER BY id DESC LIMIT 1`，逐层向上 |
| `scanEntries`（`:317-351`） | 逐层 `ORDER BY id DESC LIMIT limit+1-已取数`，到根或超限即停 |
| `findDocument`（`:447-467`） | current：`retired_at IS NULL ORDER BY created_at DESC LIMIT 1`；历史：`created_at <= ? AND (retired_at IS NULL OR retired_at > ?)` |
| `document`（`:469-473`） | **包在 `db.transaction()` 内**：record 与 revision 两条查询必须看同一已提交状态 |
| `scanDocuments`（`:475-504`） | `scope_kind/owner_id/id > ?` + 可选 kind + 存活条件 |
| `close`（`:506-512`） | 幂等：首次置 `closed` 并保存 `closing` promise，重复调用返回同一 promise |

#### 关键流程

表结构与索引（全部 `STRICT`，来自 `src/storage/sqlite/migrations.ts:9-85`）：

| 表 | 列 | 索引 |
|---|---|---|
| `durable_metadata` | `singleton`（恒 1）、`next_id TEXT`、`next_seq INTEGER` | 单行 |
| `record_ids` | `id`、`record_type`（CHECK 5 种） | 全局 ID 归属 |
| `conversations` | `id`、`owner_conversation_id`、`owner_task_id`、`record`(json_valid) | `(owner_conversation_id,id)`、`(owner_task_id,id)` |
| `entries` | `id`、`conversation_id`、`head`、`commit_seq`、`record` | `(conversation_id, id DESC)`、部分索引 `WHERE head IS NOT NULL` |
| `tasks` | `id`、`conversation_id`、`kind`、`status`(5 态)、`abort_requested`、`background`、`record` | status/conversation/kind/abort_requested/background 各 `(列,id)` |
| `submissions` | `id`、`conversation_id`、`request_id`、`status`(4 态)、`record` | `(conversation_id,request_id)`、`(conversation_id,id)`、`(status,id)` |
| `documents` | `id`、`kind`、`family`、`key_value`、`scope_kind`、`owner_id`、`created_at`、`retired_at`、`record` | `(kind,scope_kind,owner_id,family,key_value,created_at DESC,retired_at)`、`(scope_kind,owner_id,id)`、`(scope_kind,owner_id,kind,id)` |
| `document_revisions` | `document_id`、`seq`、`kind`(base/delta)、`version`、`content`，`PRIMARY KEY (document_id,seq)` | `(document_id,kind,seq DESC)` |

```text
commit(writes, ctx)                                                   （:162-185）
  1. prepareDocumentActions(writes)      // 纯内存折叠文档命令
  2. candidateNextId(writes)             // max(内存 nextId, 各 write 的 id + 1)
  3. db.transaction(tx => {
       metadata = SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1
       committedSeq = metadata.next_seq                     // 序号在事务内取，保证递增
       checkGlobalIds(tx, writes)                           // 逐 ID 查 record_ids
       checkDocumentActions(tx, documentActions)            // 地址唯一 / delta 版本 / copy 源
       for write of writes: applyTableWrite(tx, write, committedSeq)
         conversation → INSERT； entry → INSERT（commit_seq = committedSeq）
         task/submission → INSERT … ON CONFLICT(id) DO UPDATE（状态机原地替换整行）
         document.* → no-op（交给下一步）
       applyDocumentActions(tx, documentActions, committedSeq)
       UPDATE durable_metadata SET next_id = max(...), next_seq = committedSeq + 1
     })
  4. nextId = max(nextId, candidateNextId)  // 只有成功 settle 才采纳
```

文档动作（`:779-865`）：`document.copy` 在同一事务内物化源 base（读不到或形状不匹配 → `StorageRejected`）；create 时盖 `createdAt = seq`（同批 retire 再盖 `retiredAt`）并 INSERT `documents`；base 且 current-only → 先 `DELETE document_revisions` 再插入（delta 只插入）；retire → `UPDATE documents SET retired_at`，current-only 再清 revision。`document()` 的物化（`:542-577`）：取 record → 数值点拒绝 current-only → 半开区间存活判断 → 取最新 base（缺 → `is missing a required base`）→ 取 `seq > base.seq` 的 delta 尾并逐个 `apply`。多查询读（`entry`/`findLatestHeadMarker`/`scanEntries`）走 `admitRead` 计数，`close()` 等它们结束再关库（`:506-535`）。

#### 关键代码

`src/storage/sqlite/storage.ts:162-185`：

```ts
	async commit(writes: readonly StorageWrite[], _context: Context): Promise<Seq> {
		this.assertOpen();
		const documentActions = this.prepareDocumentActions(writes);
		const candidateNextId = this.candidateNextId(writes);
		const seq = await this.db.transaction(async (transaction) => {     // 一个提交 = 一个 SQL 事务
			const metadata = await transaction.get<MetadataRow>(
				"SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1",
			);
			if (metadata === undefined) throw new Error("Durable SQLite metadata is missing");
			const committedSeq = seqFromNumber(metadata.next_seq);         // 事务内取号
			await this.checkGlobalIds(transaction, writes);
			await this.checkDocumentActions(transaction, documentActions);
			for (const write of writes) await this.applyTableWrite(transaction, write, committedSeq);
			await this.applyDocumentActions(transaction, documentActions, committedSeq);
			await transaction.run(
				"UPDATE durable_metadata SET next_id = ?, next_seq = ? WHERE singleton = 1",
				String(Math.max(Number(metadata.next_id), candidateNextId)),
				committedSeq + 1,                                          // 序号只在成功提交时推进
			);
			return committedSeq;
		});
		this.nextId = Math.max(this.nextId, candidateNextId);              // 只有 settle 成功才采纳 ID
		return seq;
	}
```

#### 不变式与边界

- `encodeIndexedString`（`:63-64`）：索引列里的字符串用 `JSON.stringify` 编码，因为某些 binding 会替换孤立 UTF-16 代理；一致性套件有 `keeps indexed string identities lossless` 用例（`src/testing/storage-conformance.ts:1453`）。
- ID 归属：`checkGlobalIds` 逐 ID 查 `record_ids`（`:588-608`），`claimId` 用 `INSERT OR IGNORE`（`:775-777`），因为 task/submission 会重复声明自己的 ID。
- 提交时校验地址唯一并拒绝「copy 源在同批被改」（这里是 `StorageRejected`，`:663-665`）。
- current-only 回收与 Memory 一致（base 或 retire 清 revision，`:836-838`/`:860-862`）；`test/sqlite-storage.test.ts:441-491` 固定 11 → 1 → 2 → 0。
- 事务失败会连 `next_id`/`next_seq` 一起回滚（`test/sqlite-storage.test.ts:307-340`）。
- 查询计划被测试固定（`test/sqlite-storage.test.ts:383-439`）：地址/scope/entry 历史/revision 尾走对应索引，前三处不得 `SCAN documents`。
- `ReadAfterWrite` 不在这里：它是 `Tx`（Session 层）的约束（`src/errors.ts:3-9`）。

#### 相关测试

`test/sqlite-storage.test.ts`：一致性套件两次注册——普通实例（`:113-115`）与「每次 commit 后关库重开」的包装器（`:117-129`）；重开后记录/序号/ID 连续（`:170-191`）；删 metadata 抛错（`:193-204`）；删 revision 后物化抛 `is missing a required base`（`:206-229`）；base/delta 四步回放与返回值免疫修改（`:231-305`）；事务整体回滚（`:307-340`）；rewindable 历史点重建（`:342-381`）；查询计划（`:383-439`）；current-only 回收（`:441-491`）；WAL 与 close 截断（`:493-521`）；页复用（`:523-565`）；体积上界（`:567-616`）。

### 4.7.3 src/storage/sqlite/migrations.ts

SQLite schema 的不可变有序历史，当前只有 `version: 1`。`applySqliteMigrations()` 在一个事务内建 `durable_schema`、读版本、拒绝「库比代码新」，再按序执行全部 pending migration 并逐个推进版本号；任何一条失败都会把 bootstrap 与所有 pending migration 一起回滚。

#### 导出面

```ts
export type SqliteMigration = { readonly version: number; readonly statements: readonly string[] };  // :3-6
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [{ version: 1, statements: INITIAL_SCHEMA }];  // :88
export const CURRENT_SQLITE_SCHEMA_VERSION = SQLITE_MIGRATIONS.at(-1)?.version ?? 0;                  // :90（当前 1）
export async function applySqliteMigrations(database: SqliteDatabase, migrations = SQLITE_MIGRATIONS): Promise<void>;  // :95-98
```

（行号属 `src/storage/sqlite/migrations.ts`；第二个参数供测试注入自定义历史。注释要求新迁移追加在数组尾部，不要改历史（`:87`）。）

#### 关键流程

```text
applySqliteMigrations(database, migrations)
  1. migrations[i].version 必须 === i + 1，否则
     "Durable SQLite migrations must have contiguous versions starting at 1"        （:99-103）
  2. database.transaction(tx => {
       CREATE TABLE IF NOT EXISTS durable_schema (singleton … CHECK(=1), version … CHECK(>=0)) STRICT
       INSERT OR IGNORE INTO durable_schema (singleton, version) VALUES (1, 0)
       row = SELECT version …                                        // 缺 → "…schema metadata is missing"
       row.version > currentVersion → `Durable SQLite schema version N is newer than supported version M`
       for migration of migrations:
         if (migration.version <= row.version) continue              // 已应用
         for statement: tx.exec(statement)
         UPDATE durable_schema SET version = migration.version
     })                                                              （:105-124）
```

#### 关键代码

`src/storage/sqlite/migrations.ts:105-124`：

```ts
	await database.transaction(async (transaction) => {          // bootstrap 与全部 pending 迁移同一事务
		await transaction.exec(`CREATE TABLE IF NOT EXISTS durable_schema (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			version INTEGER NOT NULL CHECK (version >= 0)
		) STRICT`);
		await transaction.run("INSERT OR IGNORE INTO durable_schema (singleton, version) VALUES (1, 0)");
		const row = await transaction.get<SchemaRow>("SELECT version FROM durable_schema WHERE singleton = 1");
		if (row === undefined) throw new Error("Durable SQLite schema metadata is missing");
		const currentVersion = migrations.at(-1)?.version ?? 0;
		if (row.version > currentVersion) {                       // 旧代码拒绝打开新库
			throw new Error(
				`Durable SQLite schema version ${row.version} is newer than supported version ${currentVersion}`,
			);
		}
		for (const migration of migrations) {
			if (migration.version <= row.version) continue;
			for (const statement of migration.statements) await transaction.exec(statement);
			await transaction.run("UPDATE durable_schema SET version = ? WHERE singleton = 1", migration.version);
		}
	});
```

#### 不变式与边界

- 初始数据 `INSERT INTO durable_metadata (singleton, next_id, next_seq) VALUES (1, '2', 1)`（`:15`）：ID 1 恒留给 root conversation（`test/sqlite-migrations.test.ts:38-41`）。
- `next_id` 是 `TEXT`：`node:sqlite` 拒绝超出 JS 安全整数范围的 INTEGER 结果（`:8` 注释）；存储层读出 `Number(...)`、写回 `String(...)`。
- 所有表 `STRICT`，JSON 列带 `CHECK (json_valid(...))`；幂等靠 `IF NOT EXISTS` + `INSERT OR IGNORE`。
- 版本兼容单向：库比代码新 → 失败；库比代码旧 → 执行 pending。

#### 相关测试

`test/sqlite-migrations.test.ts`：重复应用幂等（`:30-45`）；把版本改成 `CURRENT + 1` 后打开抛 `is newer than supported version`（`:47-58`）；注入「v2 含非法 SQL」的历史并断言整批回滚、修好后可成功重跑（`:60-96`）；在真实存储文件上验证失败迁移不动既有数据与 `next_id`/`next_seq`（`:98-159`）。

### 4.7.4 src/storage/sqlite/node.ts

把 `node:sqlite` 的 `DatabaseSync` 适配成 `SqliteDatabase`：所有操作经一个串行队列（同一时刻一条语句），prepared statement 按 SQL 文本缓存并跨事务复用，事务用 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` 手工管理且句柄结束后立即失效；开库设置 WAL 与 checkpoint 策略，close 先 checkpoint 再关连接。

#### 导出面

- `type NodeSqliteStorageOptions`（`src/storage/sqlite/node.ts:9-14`）：`walAutoCheckpointPages?`（默认 1000 = SQLite 默认；`0` 关闭）、`busyTimeoutMs?`（SQLite 默认 0，本适配器默认 5000）
- `class NodeSqliteDatabase extends NodeSqliteExecutor implements SqliteDatabase`（`:132`）
- `openNodeSqliteDatabase(path, options?): Promise<NodeSqliteDatabase>`（`:180-202`）：非 `:memory:` 先 `mkdir(dirname(path), {recursive:true})`；`new DatabaseSync(path, { timeout })`；依次 `PRAGMA journal_mode = WAL`、`synchronous = NORMAL`、`wal_autocheckpoint = N`；配置失败尽力 close 但抛原错误
- `openNodeSqliteStorage(path, options?): Promise<SqliteStorage>`（`:205-210`）= `SqliteStorage.open(await openNodeSqliteDatabase(...))`

#### 关键流程

```text
SerialOperationQueue（:27-70）
  run(op)       pending === 0 → 立即执行；否则挂在 tail 之后
  runAsync(op)  pending === 0 → 先发布 barrier（Promise.withResolvers）再启动 op，finally 释放
                pending > 0  → enqueue
transaction(cb)（:140-159）
  access.runAsync(async () => {
    database.exec("BEGIN IMMEDIATE")          // 立即取写锁
    scope = { active: true }
    try { result = await cb(new NodeSqliteTransaction(database, statements, scope))
          scope.active = false; database.exec("COMMIT"); return result }
    catch (error) { scope.active = false
          try { database.exec("ROLLBACK") }
          catch (rollbackError) { throw new AggregateError([error, rollbackError], "…rollback failed") }
          throw error }
  })
close()（:161-172）
  access.run(() => { if (closed) return; closed = true; statements.clear();
                     try { database.exec("PRAGMA wal_checkpoint(TRUNCATE)") } finally { database.close() } })
```

prepared statement 缓存在 `NodeSqliteExecutor`（`:76-115`）：数据库实例持有 Map 并传给每个事务句柄，因此事务内外共享同一批 statement。

#### 关键代码

`src/storage/sqlite/node.ts:140-159`、`184-188`：

```ts
	transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T> {
		return this.access.runAsync(async () => {                      // 串行队列：同一时刻只有一个事务
			this.database.exec("BEGIN IMMEDIATE");                     // 立即拿写锁，避免锁升级
			const scope = { active: true };
			try {
				const result = await callback(new NodeSqliteTransaction(this.database, this.statements, scope));
				scope.active = false;                                  // 句柄在任何后续使用前先失效
				this.database.exec("COMMIT");
				return result;
			} catch (error) {
				scope.active = false;
				try {
					this.database.exec("ROLLBACK");
				} catch (rollbackError) {
					// 回滚本身失败：不能把回调错误伪装成「已保证回滚」
					throw new AggregateError([error, rollbackError], "SQLite transaction failed and rollback failed");
				}
				throw error;
			}
		});
	}

	const checkpointPages = options.walAutoCheckpointPages ?? DEFAULT_WAL_AUTO_CHECKPOINT_PAGES;  // 1000
	const timeout = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;                             // 5000
	if (path !== ":memory:") await mkdir(dirname(path), { recursive: true });      // 自动建父目录
	const database = new DatabaseSync(path, { timeout });                          // busy timeout
	const adapter = new NodeSqliteDatabase(database);
```

#### 不变式与边界

- `runAsync` 在启动操作**之前**发布 barrier（`:43-45`），因此事务回调里误用 `database` 会排队等自己（`test/sqlite-facade.test.ts:224-239`）。
- 句柄失效后任何调用抛 `SQLite transaction handle is no longer active`（`:125-128`；测试 `:266-279`）。
- 回滚失败以 `AggregateError` 报出，调用方不能当作「已保证回滚」（测试 `:281-293`）。
- `synchronous = NORMAL` 是崩溃语义的分界：进程崩溃不损坏、掉电可能丢最后若干事务；`test/sqlite-storage.test.ts:493-521` 断言 WAL 有界、close 后 WAL 归零。
- close 幂等，且 checkpoint 失败也会关连接（`finally`，`:167-170`）。

#### 相关测试

`test/sqlite-facade.test.ts`：statement 每连接只 prepare 一次并跨事务复用（`:83-111`）；事务提交可见与 close 幂等（`:113-122`）；并发事务串行（`:124-157`）；事务期间的普通调用既不看到未提交行也不参与回滚（`:159-185`）；普通操作排在活跃事务之后（`:187-222`）；barrier 语义（`:224-239`）；准入读在 close 前完成、之后抛 `SqliteStorage is closed`（`:241-264`）；句柄事后失效（`:266-279`）；rollback 失败（`:281-293`）；`ControlledSettlementDatabase` 验证 settle 前不算完成、ID 只在成功后采纳（`:295-345`）；文档读与覆盖 base 并发只观察到两种完整状态（`:347-372`）。

### 4.7.5 src/storage/sqlite/database.ts

`SqliteStorage` 与具体 SQLite binding 之间的最小契约，也是**自定义适配器的规范**：值类型、4 个异步执行方法、事务与关闭；事务句柄专属、无关操作必须排队、回滚顺序都有明文要求，因此换 binding 或换远端实现只需满足这份接口。

#### 导出面

```ts
export type SqliteValue = null | number | bigint | string | Uint8Array;          // src/storage/sqlite/database.ts:2

export interface SqliteExecutor {                                               // :11-16
  exec(sql: string): Promise<void>;                       // 无绑定，可含多条语句
  run(sql: string, ...params: SqliteValue[]): Promise<void>;
  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined>;
  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]>;
}

export interface SqliteDatabase extends SqliteExecutor {                        // :35-38
  transaction<T>(callback: (transaction: SqliteExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

`exec` 跑 SQL 文本、`run/get/all` 一次一条语句带位置绑定（`:6-10` 注释提醒适配器可缓存 prepared statement，所以必须用绑定）；`transaction(callback)` 的回调收到唯一可用的事务句柄，返回的 promise 在 commit 或 rollback 之后 settle。

#### 关键流程

```text
调用方（SqliteStorage）：commit()/document() → database.transaction(tx => …)
自定义适配器必须保证：
  · 事务内一切走 tx 句柄；句柄在回调 settle 后失效
  · 无关操作与其他事务在本事务结束前被排队
  · 回调 reject → 先 ROLLBACK，再用同一个错误 reject
  · ROLLBACK 也失败 → reject 一个不同的错误（如 AggregateError）
```

#### 关键代码

`src/storage/sqlite/database.ts:18-34`（契约原文）：

```ts
/**
 * Minimal database facade required by `SqliteStorage`.
 *
 * All operations are asynchronous so adapters may execute outside the harness runtime.
 *
 * `transaction` passes the callback a transaction handle. All work in the transaction
 * must use that handle; the handle is invalid after the callback settles. Adapters must
 * queue unrelated operations and other transactions until the transaction finishes. The
 * returned promise settles after commit or rollback. Calling the database itself (including
 * `transaction` or `close`) from inside a callback therefore waits for that transaction and
 * never settles.
 *
 * When the callback rejects, the adapter must roll the transaction back before rejecting
 * with that same error. If rollback fails, it must reject with a different error (for
 * example an `AggregateError`) so callers cannot mistake the callback error for a
 * guaranteed rollback.
 */
```

#### 不变式与边界

- `SqliteValue` 不含 `boolean`：布尔在存储层物化为 `0/1`（`src/storage/sqlite/storage.ts:749-750`）。
- 事务句柄不是便利选项：`materializeDocument(transaction, …)` 只接受 `SqliteExecutor`，文档 copy 的物化必须与写入同一事务。
- 「在回调里调用 database 自身会永久等待」是规范明文，也是 `NodeSqliteDatabase` 的 barrier 要保证的性质。

#### 相关测试

`test/sqlite-facade.test.ts` 全篇（`:13-67` 的 `ControlledSettlementDatabase` 演示自实现适配器如何满足异步 settle 契约）；`test/sqlite-migrations.test.ts:60-96` 把自定义历史喂给门面，证明可替换。

### 4.7.6 src/storage/sqlite/index.ts

`@earendil-works/pi-durable/storage/sqlite` 的入口：只导出便携部分（门面类型、migrations、`SqliteStorage`），刻意不含 Node 适配器；要落本地文件必须显式 import `.../storage/sqlite/node`。

#### 导出面

```ts
export type { SqliteDatabase, SqliteExecutor, SqliteValue } from "./database.ts";      // src/storage/sqlite/index.ts:1
export {
	applySqliteMigrations, CURRENT_SQLITE_SCHEMA_VERSION, SQLITE_MIGRATIONS, type SqliteMigration,
} from "./migrations.ts";                                                              // :2-7
export { SqliteStorage } from "./storage.ts";                                          // :8
```

#### 关键流程

无流程；它决定的是可见面：`INITIAL_SCHEMA` 本身不导出，只经 `SQLITE_MIGRATIONS[0].statements` 可见。

#### 关键代码

`src/storage/sqlite/index.ts:1-8`（即上表全文）。

#### 不变式与边界

- 便携核心与 Node 适配的分界由测试固定：从该入口出发的 import 图不得出现 `storage/sqlite/node.ts`（`test/storage-runtime-boundary.test.ts:33-36`）。
- 包根 `.` 也不含 `storage/sqlite/`、`storage/jsonl/`、`env/`（同文件 `:26-31`）。

#### 相关测试

`test/storage-runtime-boundary.test.ts:33-36`；`test/sqlite-migrations.test.ts:7-12` 从该入口 import。

### 4.7.7 src/storage/jsonl/storage.ts

追加式后端：每次提交先把完整记录追加到受影响的 sidecar（`doc-<id>.jsonl` / `task-<id>.jsonl`），再把一条列出这些记录的 main marker 追加到 `main.jsonl`，**只有 marker 写成功才在内存里发布**。内存态复用 `MemoryStorage` 作为索引，`open()` 时 replay 全部 marker 重建它，并顺手删 `.reclaim` 残片、截断撕裂末行、回收不再需要的 sidecar 记录。默认 `fsync:false` 只承诺普通进程崩溃一致。

#### 导出面

- `type JsonlStorageOptions = { readonly fsync?: boolean }`（`src/storage/jsonl/storage.ts:76-79`）：`true` 时在追加 main marker 前 flush 每个受影响的 sidecar
- `class JsonlCorruptionError extends Error`（`:81-86`）：格式/一致性损坏；`class JsonlStoragePoisonedError extends Error`（`:88-93`）：追加/flush 失败后打开的后端被毒化，固定消息 `JSONL storage is poisoned and must be reopened`
- `class JsonlStorage implements Storage`（`:241`）
  - `static async open(directory, fs: FileSystem, context, options?): Promise<JsonlStorage>`（`:260-275`）：绝对路径 → `createDir(recursive)` → 拼 `main.jsonl` → `recover()`
  - 其余方法全部转发给内部 `MemoryStorage`（`this.store`，`:831-834`），`entry` 的两个重载只多一层 `idFromNumber`；`close()` 幂等且只关内存态

目录与行格式：

```text
<directory>/main.jsonl            每个 commit 一行 marker（MAIN_FILE，:29）
<directory>/doc-<id>.jsonl        一个文档 incarnation 的 base/delta 序列（:100）
<directory>/task-<id>.jsonl       live（非 terminal）task 记录的替换序列
<directory>/*.jsonl.reclaim       回收用临时替换文件（RECLAIM_SUFFIX，:30）

MainMarker    { format: 1, type: "commit", seq, writes: MainOperation[] }     （:42-47）
SidecarRecord { format: 1, type: "record", seq, ordinal, payload }            （:53-59）
payload        { type: "task", value } | { type: "document", id, content }     （:49-51）
```

main 里的 `MainOperation` 是写本身或对 sidecar 的引用：`conversation`/`entry`/`submission`/`document.retire` 原样；**terminal** task 原样，否则变成 `{type:"task.sidecar", id, ordinal}`；`document.create`/`document.change` 变成带 `ordinal` 的引用（`:383-448`）。`ordinal` 是同一提交内的全局递增序号，`(file, seq, ordinal)` 就是 sidecar 行的身份（`:109`）。

#### 关键流程

```text
commit(writes, ctx)                                                       （:277-306）
  1. assertUsable()                            // closed / poisoned → 抛
  2. prepared = memory.prepareCommit(writes)    // 与 Memory 同一套校验；seq 尚未推进
  3. encoded = encodeCommit(prepared.seq, prepared.writes)     // marker 文本 + 各 sidecar 追加内容
  4. reclamations = planReclamations(prepared.writes, encoded) // 本批提交授权的回收计划
  5. 解析 sidecar 绝对路径
  6. for sidecar: fs.appendFile(...)            // 失败 → poison
  7. if (fsync) for sidecar: fs.flushFile(...)  // 失败 → poison
  8. fs.appendFile(mainPath, marker)            // 失败 → poison（sidecar 成为未确认尾巴）
  9. prepared.apply()                           // 发布点：marker 已落地
 10. adoptSidecarState(writes)                   // 更新 currentOnlyDocuments / liveTaskSidecars
 11. reclaimSidecars(reclamations)               // marker 之后才允许动 sidecar
```

回收（`:450-532`）只针对三类情形：current-only 文档 retire → 删文件；current-only 文档收到 base → 用新 base 重写整个 sidecar（压缩）；terminal task 且曾有 live sidecar → 删文件。执行时空内容走 `remove({force:true})`，否则写 `<file>.reclaim`（`fsync` 时先 flush）再 `rename` 原子替换；`fsync:true` 时回收前先 flush 一次 `main.jsonl`，flush 失败则**推迟回收**（已提交状态保持发布）。

恢复（`:534-764`）：

```text
recover(ctx)
  1. readLines(main.jsonl)：末字节不是 \n → 截断到最后一条完整行（torn-line truncation）
  2. 校验 main 的 seq 严格递增
  3. 删除所有 *.reclaim；收集并排序全部 sidecar
  4. 逐个 sidecar readLines + 校验 (seq, ordinal) 严格递增；建立 (file,seq,ordinal) → 行 索引
  5. 扫 main 得 currentOnlyDocuments / retiredDocuments / finalTaskIsLive
  6. 再扫 main 得每个 current-only 文档的 latestBases（最新 confirmed base）
  7. 按 main 顺序 replay：每行 marker 组装 writes[]，再 memory.prepareCommit(writes, marker.seq).apply()
       task.sidecar     → confirmRecord(optional = 该 task 已 terminal)
       document.create  → 已回收或无内容 → 回填 {kind:"base", version:1, value:{}}
       document.change  → 已回收则跳过
  8. 未确认尾巴：confirmed 行之后还有行 → 抛；否则从第一个未确认行起 truncate
  9. 回收：terminal task → 删；retired 的 current-only 文档 → 删；
     有 latestBase 的文档 → 只留 latestBase 及其之后的 confirmed 行
 10. 重建内存集合
```

#### 关键代码

`src/storage/jsonl/storage.ts:277-306`（发布协议）：

```ts
	async commit(writes: readonly StorageWrite[], context: Context): Promise<Seq> {
		this.assertUsable();
		const prepared = this.memory.prepareCommit(writes);        // 先全部校验；此时还不推进内存序号
		const encoded = this.encodeCommit(prepared.seq, prepared.writes);
		const reclamations = this.planReclamations(prepared.writes, encoded);
		const sidecars = await Promise.all(
			[...encoded.sidecars].map(async ([file, content]) => ({
				file, content, path: await this.resolveFile(file, context),
			})),
		);

		for (const sidecar of sidecars) {
			const result = await this.fs.appendFile(sidecar.path, sidecar.content, context);
			if (!result.ok) throw this.poison(errorFromFile(`append to ${sidecar.file}`, result.error));
		}
		if (this.fsync) {                                          // 1) 可选：flush 每个 sidecar
			for (const sidecar of sidecars) {
				const result = await this.fs.flushFile(sidecar.path, context);
				if (!result.ok) throw this.poison(errorFromFile(`flush of ${sidecar.file}`, result.error));
			}
		}
		const marker = await this.fs.appendFile(this.mainPath, encoded.marker, context);   // 2) 提交点
		if (!marker.ok) throw this.poison(errorFromFile(`append to ${MAIN_FILE}`, marker.error));
		const seq = prepared.apply();                              // 3) marker 落地后才发布内存态
		this.adoptSidecarState(prepared.writes);
		await this.reclaimSidecars(reclamations, context);         // 4) 回收永远在提交点之后
		return seq;
	}
```

#### 不变式与边界

- **poison**：任何 sidecar/marker 的 append 或 flush 失败都记录 `JsonlStoragePoisonedError`，之后所有操作（含读）都抛它（`:836-844`）。
- **损坏检测**：非法 JSON、非法 marker/write/内容形状、sidecar 记录乱序、缺必需 confirmed 记录、confirmed 行排在未确认尾巴之后都抛 `JsonlCorruptionError`；其中缺必需数据会让 `open()` 直接失败（`test/jsonl-storage.test.ts:1039-1058`）。
- 撕裂行修复是破坏性的：main 与 sidecar 共用 `readLines`，都会把最后一个不完整行截掉（`:798-803`；测试 `:978-1010` 断言两个文件回到原大小、下一次提交复用未确认的 seq）。
- 先校验后落盘：序列化/校验失败时不产生任何 I/O（`test/jsonl-storage.test.ts:415-446`）。
- `isCurrentOnly = scope.kind !== "conversation" || history === "latest"`（`:106-107`）；rewindable 文档历史**永不回收**（测试 `:866-910`）。
- 单进程所有权：`open()` 无条件删除所有 `.reclaim`（`:551-555`）并解析目录内全部匹配文件，同一目录不能被两个进程同时打开；无锁。
- `[待核]: docs/spec.md:4472-4473 要求回收时「invalidate cached file descriptors so future appends cannot target an unlinked inode」，但本文件与其 Node 适配器都没有显式 fd 缓存/失效逻辑（每次 append/flush 重新 open）；效果等价，但该对应关系没有测试固定。`

#### 相关测试

`test/jsonl-storage.test.ts`：一致性套件两次注册（普通 `:123`，每次 commit 后重开 `:125-134`）；回收后 sidecar 被删除、main 累积 marker（`:326-370`）；同批多次替换按 `ordinal` 排序（`:372-388`）；「完整 + 撕裂」追加的清理（`:390-413`）；先校验后 I/O（`:415-446`）；append 8 组与 flush 4 组注入矩阵（`:448-531`）；发布顺序的精确断言（`:533-612`，含 fsync 的 flush 插入点与 `write/.reclaim`→`rename`）；回收失败矩阵（`:614-824`）；base 之后的 delta 追加到替换后的 sidecar（`:826-864`）；rewindable 不回收（`:866-910`）；retire/terminal 的删除（`:912-976`）；撕裂 UTF-8 尾与未确认尾（`:978-1037`）；损坏与畸形行（`:1039-1155`）。

### 4.7.8 src/storage/jsonl/node.ts

用本地 `NodeExecutionEnv` 打开/创建 JSONL 目录，并再导出存储类与选项类型。它把「JSONL 依赖 `FileSystem` 而不是 `ExecutionEnv`」落实到 Node 侧：只利用环境里的文件能力。

#### 导出面

```ts
export async function openNodeJsonlStorage(directory: string, context: Context, options: JsonlStorageOptions = {}): Promise<JsonlStorage>;  // src/storage/jsonl/node.ts:6-12
export { JsonlStorage, type JsonlStorageOptions } from "./storage.ts";                                                                     // :14
```

#### 关键流程

```text
openNodeJsonlStorage(directory, context, options)
  → JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: process.cwd() }), context, options)
```

每次调用新建一个环境；`NodeExecutionEnv.id` 恒为 `"node:local"`，同一进程的不同 env 对象仍属同一文件命名空间。

#### 关键代码

`src/storage/jsonl/node.ts:11-13`：

```ts
): Promise<JsonlStorage> {
	return JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: process.cwd() }), context, options);
}
```

#### 不变式与边界

- 目录由 `JsonlStorage.open` 内部 `createDir(recursive)` 创建，本函数不做 `mkdir`。
- `directory` 的相对/绝对语义取决于 `NodeExecutionEnv.resolvePath` 以 `process.cwd()` 为基准（见 4.8.2 节）。

#### 相关测试

`test/jsonl-storage.test.ts:318-324`；`test/storage-runtime-boundary.test.ts:43-47` 断言从 `src/storage/jsonl/index.ts` 出发的图里不出现 `storage/jsonl/node.ts` 或 `env/node.ts`。

### 4.7.9 src/storage/jsonl/index.ts

`@earendil-works/pi-durable/storage/jsonl` 的入口：只导出便携部分（存储类与两个错误类型），`FileSystem` 由调用方注入，因此可用于容器或远端实现。

#### 导出面

```ts
export {
	JsonlCorruptionError, JsonlStorage, type JsonlStorageOptions, JsonlStoragePoisonedError,
} from "./storage.ts";                                   // src/storage/jsonl/index.ts:1-6
```

#### 关键流程

无流程；布局、发布协议、恢复与回收全部定义在 `src/storage/jsonl/storage.ts`（见 4.7.7 节）。

#### 关键代码

`src/storage/jsonl/index.ts:1-6`（即上表全文）。

#### 不变式与边界

- 想用本地文件系统必须显式 import `.../storage/jsonl/node`（`package.json` 把两者拆成不同 subpath）。
- 可移植性由 `test/storage-runtime-boundary.test.ts:43-47` 断言。

#### 相关测试

`test/storage-runtime-boundary.test.ts:43-47`；`test/jsonl-storage.test.ts:11` 从该入口 import `JsonlStorage`，`:12` 另从 `storage/jsonl/node` import Node 打开器。

---

## 4.8 env/ 与 tools/

`src/env/` 定义 agent 能对外部世界做的两件事：`FileSystem`（文件原语）与 `Shell`（跑进程），合称 `ExecutionEnv`；`src/tools/` 是四个内建工具（`read`/`write`/`edit`/`bash`），它们只通过 `api.env` 拿能力。分界很清楚：`env/index.ts` 是纯接口（无 `node:`），`env/node.ts` 是本地实现；工具层不含平台代码，副作用（含 spill）都由环境提供。工具的「截断提示」「完整输出路径」走 `diagnostic` 通道，正文只有数据本身（诊断的顺序与渲染见 2.16 节）。

### 4.8.1 src/env/index.ts

可移植能力接口：`FileSystem` 的 21 个方法、`Shell` 的 `exec`/`cleanup`、合成类型 `ExecutionEnv`，以及「可预期失败返回 `Result` 而非抛异常」的整套约定。它没有任何 I/O 实现，因此容器、远端或 test double 都能实现同一份接口。

#### 导出面

```ts
export type Result<TValue, TError> = { ok: true; value: TValue } | { ok: false; error: TError };   // src/env/index.ts:4
export function ok<TValue, TError>(value: TValue): Result<TValue, TError>;                          // :6
export function err<TValue, TError>(error: TError): Result<TValue, TError>;                         // :10
export function getOrThrow<TValue, TError>(result: Result<TValue, TError>): TValue;                 // :14
export function getOrUndefined<TValue extends object, TError>(result): TValue | undefined;          // :19
export function toError(error: unknown): Error;                                                     // :23
export type FileKind = "file" | "directory" | "symlink";                                           // :33
export type FileErrorCode = "aborted" | "not_found" | "permission_denied" | "not_directory"
  | "is_directory" | "invalid" | "not_supported" | "unknown";                                      // :35-43
export type ExecutionErrorCode = "aborted" | "timeout" | "shell_unavailable" | "spawn_error"
  | "callback_error" | "unknown";                                                                  // :57-63
```

`FileError`（`:45-55`）：`code: FileErrorCode`、`path?: string`、`constructor(code, message, path?, cause?)`；`ExecutionError`（`:65-75`）：`code: ExecutionErrorCode`、`spillPath?: string`（超时/中止且已 spill 时挂上）、`constructor(code, message, cause?)`。

`FileSystem`（`:96-140`）——每个方法都返回 `Promise<Result<…, FileError>>`：

```ts
export interface FileSystem {
	/**
	 * The file namespace: equal ids see the same files at the same paths, whatever their `cwd`. Every local Node
	 * environment shares one id; each container or remote host has its own.
	 */
	readonly id: string;
	cwd: string;
	absolutePath(path, context); joinPath(parts, context);                            // 路径解析
	readTextFile(path, context); openTextLineReader(path, context); readTextLines(path, {maxLines?}, context);
	readBinaryFile(path, context);                                                    // 读取（文本 / 行 / 字节）
	writeFile(path, content, context); appendFile(path, content, context);
	truncateFile(path, size, context);   // Truncate or extend a file to exactly `size` bytes.
	flushFile(path, context);            // Flush contents and metadata needed to retrieve them from an open handle.
	renameFile(sourcePath, destinationPath, context);
	fileInfo(path, context); listDir(path, context); canonicalPath(path, context); exists(path, context);
	createDir(path, {recursive?}, context); remove(path, {recursive?, force?}, context);
	createTempDir(prefix, context); createTempFile({prefix?, suffix?}, context); cleanup(context);
}
export interface FileInfo { name: string; path: string; kind: FileKind; size: number; mtimeMs: number }  // :77-83
export interface TextLine { text: string; terminated: boolean }                                    // :85-88
export interface TextLineReader {                                                                 // :90-93
  readLine(context): Promise<Result<TextLine | undefined, FileError>>;   // undefined = EOF
  close(context): Promise<void>;
}
```

`Shell`（`:142-174`）：

```ts
export interface ShellSpillOptions { afterBytes: number; afterLines: number }        // :143-147（行数是「完整或部分行」）
export interface ShellExecResult { exitCode: number; spillPath?: string }             // :149-153
export interface ShellExecOptions {                                                   // :155-163
  cwd?: string; env?: Record<string, string>; inheritEnv?: boolean; timeout?: number;   // 秒
  /** Every decoded chunk of combined stdout and stderr as it arrives: raw, unbounded, and unthrottled. */
  onOutput?: (text: string, context: Context) => void;
  spill?: ShellSpillOptions;
}
export interface Shell { exec(command, options, context): Promise<Result<ShellExecResult, ExecutionError>>;
                         cleanup(context): Promise<void> }                           // :165-172
export interface ExecutionEnv extends FileSystem, Shell {}                            // :174
```

关键语义：

- `id`：**文件命名空间**标识。id 相同的环境无论 `cwd` 是什么都看到同一批文件；所有本地 Node 环境共享 `"node:local"`，容器/远端各有自己的 id。`edit`/`write` 的串行化 key 就是「id + canonical path」（见 4.8.12 节），`docs/spec.md:3019-3024` 把这条写成工具契约。
- `cwd` 可写：`bash` 工具的 `prepare` 钩子改 `execution.cwd/env`（见 4.8.8 节）。
- `truncateFile` 能截断**或扩展**；`flushFile` 要 flush 到「足以从打开句柄取回内容」，这是 JSONL 的 fsync 语义基础（见 4.7.7 节）。
- `ShellExecResult.exitCode` 非零**不是** `Result` 失败；只有 aborted/timeout/shell 不可用/spawn 错误/`onOutput` 回调抛错才 `err`。

#### 关键流程

```text
工具（tools/*）→ requireEnv(api) → ExecutionEnv
   ├─ FileSystem：read/write/edit、路径归一、file-mutation-queue、JSONL 存储（见 4.7.7 节）
   └─ Shell：bash 工具
Harness → HarnessOptions.env(conversation) 构建环境（见 2.15 节）
```

#### 关键代码

`src/env/index.ts:96-101`、`174`：

```ts
/** Portable filesystem capability. Operations return failures rather than throwing. */
export interface FileSystem {
	/**
	 * The file namespace: equal ids see the same files at the same paths, whatever their `cwd`. Every local Node
	 * environment shares one id; each container or remote host has its own.
	 */
	readonly id: string;
	cwd: string;
	absolutePath(path: string, context: Context): Promise<Result<string, FileError>>;
	// ...（其余 20 个方法见上方清单）
}

export interface ExecutionEnv extends FileSystem, Shell {}
```

#### 不变式与边界

- 「不抛异常」只针对可预期失败；实现内部的意外错误（如 spill 保存失败）也用 `ExecutionError("unknown", …)` 表达，调用方只需处理 `Result`。
- `FileErrorCode` 没有 `already_exists`：`createDir` 冲突落到平台 errno 映射（见 4.8.2 节）。
- `ExecutionErrorCode` 的 `"callback_error"` 专指 `onOutput` 抛错；`"unknown"` 被 spill 失败复用。
- `ReadAfterWrite`/`StorageRejected`/`ConversationBusy` 不在本文件（`src/errors.ts:1-28`），属于 Session/Storage 层。

#### 相关测试

`test/storage-runtime-boundary.test.ts:38-41` 断言本文件的 import 图不含 `node:`；`test/env-node.test.ts` 以 `NodeExecutionEnv` 覆盖全部方法；`test/tools.test.ts:17-30` 使用这些类型并用自实现 `fakeApi` 注入 `env`（`:50-69`）。

### 4.8.2 src/env/node.ts

`ExecutionEnv` 的本地 Node 实现，也是本包最大的文件（957 行）。文件原语走 `node:fs/promises`，统一做路径解析（`~`、`file://`、相对 `cwd`）与 abort 检查，并把 errno 映射成 `FileError`；行读取用自写的严格 LF reader（`node:readline` 不报告最后一行是否被换行终止）；进程执行用 `spawn` 跑 bash（legacy WSL bash 走 stdin 传输），实时转发合并输出、按阈值把**完整原始字节**spill 到临时文件、支持超时/abort/进程树 kill。

#### 导出面

```ts
export class NodeExecutionEnv implements ExecutionEnv {                                        // src/env/node.ts:437
  readonly id: string = "node:local";         // 所有本地环境共享（:439）
  cwd: string;                                // 可写（:440）
  constructor(options: { cwd: string; shellPath?: string; shellEnv?: NodeJS.ProcessEnv });      // :445-449
}
```

原语清单（**没有 glob、没有 edit**）：

| 类别 | 方法（行） | 要点 |
|---|---|---|
| 路径 | `absolutePath`/`joinPath`（`:451-457`） | `resolvePath` 支持 `~`、`~/`、`~\`（win32）、`file://` |
| 进程 | `exec`（`:459-691`） | 见下方流程 |
| 读 | `openTextLineReader`（`:693`）、`readTextFile`（`:710`）、`readTextLines`（`:722`）、`readBinaryFile`（`:744`） | `maxLines <= 0` → `ok([])` |
| 写 | `writeFile`（`:756`）、`appendFile`（`:772`） | 都先 `mkdir(resolve(path,".."), {recursive:true})` |
| 写 | `truncateFile(path,size)`（`:789`） | size 必须非负安全整数；`open(path,"r+")`；缺失文件 → `not_found`，不创建 |
| 写 | `flushFile`（`:810`）、`renameFile`（`:828`） | `file.sync()`；`rename` 原子替换，失败报 source 路径 |
| 元数据 | `fileInfo`（`:841`）、`listDir`（`:852`）、`canonicalPath`（`:877`）、`exists`（`:888`） | `lstat`（不跟随 symlink）、`realpath`、`exists` 把 `not_found` 变 `ok(false)` |
| 目录/删除 | `createDir`（`:895`）、`remove`（`:911`） | `recursive` 默认 true；`recursive`/`force` 默认 false |
| 临时 | `createTempDir`（`:927`）、`createTempFile`（`:938`） | `mkdtemp(tmpdir()/prefix)`，文件名 `${prefix}${randomUUID()}${suffix}` |
| 生命周期 | `cleanup`（`:953`） | kill `activeChildPids` 里的全部进程树 |

#### 关键流程

```text
exec(command, options, context)                                                （:459-691）
 1. abort 预检；resolveTimeoutMs：非有限数或 <=0 → ExecutionError("timeout")
 2. cwd = options.cwd ? resolvePath(this.cwd, options.cwd) : this.cwd
 3. getShellConfig(this.shellPath)：自定义路径不存在 → "shell_unavailable"
 4. access(cwd) 失败 → "spawn_error"，消息 "Working directory does not exist: …"（spawn 之前）
 5. spawn(shell, commandFromStdin ? args : [...args, command], {
      cwd, detached: process.platform !== "win32",
      env: getShellEnv(this.shellEnv, options?.env, options?.inheritEnv),
      stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"], windowsHide: true })
 6. timeout 定时器与 abortSignal 监听 → killProcessTree
 7. stdout/stderr 各一个 TextDecoder；每个 chunk：emit(decode(chunk, {stream:true})) → onOutput
    开了 spill：未越阈值累积在 spillPrefix；越阈值（bytes > afterBytes 或 lines > afterLines）→ 懒建 spill 并补写前缀
 8. 背压：spill 写不进去 → pause stdout/stderr；"drain" → resume
 9. waitForChildProcess：exit 后等两条流 end；100ms 宽限期内 spill 仍在 drain 则续期
10. finishSpill() → flush 两个 decoder 的尾巴
11. 结果优先级：callbackError → timeout → aborted（挂 spillPath）→ spillError → ok({exitCode})
     exitCode = code ?? (exitSignal ? 128 + signals[exitSignal] ?? 0 : 1)

shell 选择（:199-245）  custom → %ProgramFiles%\Git\bin\bash.exe / %ProgramFiles(x86)%\… / where bash.exe（win32）
                      → /bin/bash / which bash / 兜底 {shell:"sh", args:["-c"]}（其他平台）
  isLegacyWslBashPath（^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$）→ -s + stdin 传输
killProcessTree（:260-289）  win32: taskkill /F /T /PID；其他: process.kill(-pid, SIGKILL) → process.kill(pid)
行读取器（:373-435）  64KiB chunk + 显式 position；TextDecoder({stream:true})；返回 {text, terminated}
```

#### 关键代码

`src/env/node.ts:789-808`：

```ts
	async truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const signal = context.abortSignal;
		const aborted = abortResult<void>(signal, resolved);
		if (aborted) return aborted;
		if (!Number.isSafeInteger(size) || size < 0) {
			return err(new FileError("invalid", "File size must be a non-negative safe integer", resolved));
		}
		let file: Awaited<ReturnType<typeof openFile>> | undefined;
		try {
			file = await openFile(resolved, "r+");                            // "r+"：缺失 → not_found，不创建
			await file.truncate(size);
			const afterTruncateAbort = abortResult<void>(signal, resolved);
			return afterTruncateAbort ?? ok(undefined);
		} catch (error) {
			return err(toFileError(error, resolved));
		} finally {
			await file?.close().catch(() => undefined);                       // 句柄总是关闭
		}
	}
```

#### 不变式与边界

- abort 覆盖全部 17 个文件方法，入口预检 + 关键步骤之间复查（`test/env-node.test.ts:329-359` 断言预 abort 下全 `code:"aborted"` 且无副作用）；`writeFile`/`appendFile` 在 `mkdir` 之后、写入之后都会再查一次（`src/env/node.ts:756-787`）。
- errno 映射（`:104-128`）：`ABORT_ERR→aborted`、`ENOENT→not_found`、`EACCES/EPERM→permission_denied`、`ENOTDIR→not_directory`、`EISDIR→is_directory`、`EINVAL→invalid`，其余 `unknown`；`path` 取 errno 的 `path` 或 fallback。
- `flushFile` 失败返回 `code:"unknown"`，且句柄仍被关闭（`test/env-node.test.ts:417-443` 断言 `fd === -1`）。
- 退出码：信号杀死 → `128 + signal`（`:685`；回归测试 `test/env-node.test.ts:763-769`，issues/8992）；非零退出仍是 `ok`。
- spill：阈值命中才建文件（`test/env-node.test.ts:884-897`）；内容是原始字节（`:899-915`）；超时/中止把 `spillPath` 挂在 error 上（`:917-929`）；spill 失败必须显式报错（`:931-945`）；500KB 与 15,000 行都完整落盘（`:947-981`）。
- 输出背压：spill 背压时暂停读端，`drain` 后恢复；shell 退出后 100ms 宽限期内在 spill 未排空时续期（`test/env-node-spill.test.ts:52-88`，Windows 上 skip）。
- Windows 特例：`~\` 前缀（`:62`）、`taskkill /F /T`（`:261-278`）、`detached: process.platform !== "win32"`（`:601`）、`where bash.exe`（`:181`）、Git Bash 候选目录（`:212-215`）、legacy WSL 的 stdin 传输（`:194-201`，测试 `:637-681`）。
- 行读取器保留 CR：`test/env-node.test.ts:453-474` 断言 `one\r\n\ntwo\npartial` → `{"one\r",true}`、`{"",true}`、`{"two",true}`、`{"partial",false}`。

#### 相关测试

`test/env-node.test.ts`（982 行）：文件原语基本面（`:131-165`）、`~`/`file://`（`:167-175`）、`fileInfo`/`canonicalPath`/symlink（`:177-224`）、`readTextLines` 上限（`:226-231`）、错误码（`:233-259`）、append/rename（`:261-296`）、临时目录/文件（`:298-309`）、`recursive`/`force`（`:311-327`）、预 abort 全方法（`:329-359`）、字节精确截断（`:361-395`）、flush（`:397-443`）、行读取器（`:452-566`）、shell 环境合并（`:568-635`）、WSL 传输（`:637-681`）、退出后 stdio 保持（`:683-708`）、cleanup kill（`:710-720`）、流式输出与跨 chunk UTF-8（`:722-743`）、缺 cwd（`:745-754`）、退出码与信号（`:756-769`）、超时（`:771-789`）、`callback_error`（`:791-805`）、shell 不可用/spawn 错误（`:807-821`）、abort（`:823-882`）、spill（`:884-981`）。`test/env-node-spill.test.ts` 覆盖 spill 背压与宽限期续期。

### 4.8.3 src/tools/index.ts

`@earendil-works/pi-durable/tools` 的入口：再导出四个工厂与它们的输入/细节类型，并提供一次注册四个工具的 `CodingTools` extension。注释明确「没有任何东西自动安装它」。

#### 导出面

```ts
export { type BashExecution, type BashPrepare, type BashToolInput, type BashToolOptions, createBashTool } from "./bash.ts";   // src/tools/index.ts:7-13
export { createEditTool, type EditToolDetails, type EditToolInput } from "./edit.ts";     // :14
export { createReadTool, type ReadToolDetails, type ReadToolInput } from "./read.ts";     // :15
export { createWriteTool, type WriteToolInput } from "./write.ts";                        // :16
export const CodingTools = defineExtension({ name: "coding-tools", tools: [...] });       // :19-22
```

#### 关键流程

```text
registry 选中 CodingTools → agent.tools = [read, write, edit, bash]
模型产生 toolCall → pi.tool 任务（见 3.3 节）：resolve → prepareArguments → validate
                 → beforeTool → 记录 intent → execute → afterTool → 落 pi.tool-result entry
```

#### 关键代码

`src/tools/index.ts:18-22`：

```ts
/** `read`, `write`, `edit`, and `bash`; nothing installs it automatically. */
export const CodingTools = defineExtension({
	name: "coding-tools",
	tools: [createReadTool(), createWriteTool(), createEditTool(), createBashTool()],
});
```

#### 不变式与边界

- 四个工厂都无必填参数（`createBashTool(options?)` 例外），每个扩展被选择时构造独立实例。
- 工具不声明 `replay`，默认 `unsafe`：被中断的调用恢复时不重跑，产出 `interrupted` 结果（见 3.6 节）。
- 只有 `bash` 声明 `outputLimits`（`retain:"tail"`）；其余三个用默认 `50 KiB / 2000 行 / retain:"head"`（`docs/spec.md:2744`）。

#### 相关测试

`test/tools.test.ts:30` 从该入口 import 四个工厂；任务层的重放/恢复/诊断渲染由 `test/harness-tools.test.ts` 与 `test/harness-tools-recovery.test.ts` 覆盖。

### 4.8.4 src/tools/read.ts

读文本文件：按 `offset`/`limit` 选段后用 `truncateHead`（2000 行 / 50KB，先命中者胜）截断，把「还能继续读」的提示放进 `diagnostic` 而不是正文；字节内容嗅探为图片时直接返回 `isError`。正文只包含文件文本。

#### 导出面

```ts
const readSchema = Type.Object({                                                     // src/tools/read.ts:11-15
  path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
export type ReadToolInput = Static<typeof readSchema>;                                // :17
export type ReadToolDetails = { truncation?: Omit<TruncationResult, "content"> };     // :19-22
export function createReadTool(): ToolRegistration<typeof readSchema, ReadToolDetails>;  // :25
```

`name = "read"`；description 内联上限：`Output is truncated to 2000 lines or 50KB (whichever is hit first)`（`:28`）。`details.truncation` 是去掉 `content` 的 `TruncationResult`（字段全集见 `src/truncate.ts:14-37`）。

#### 关键流程

```text
execute(args, api, context)
 1. env = requireEnv(api)；absolutePath = resolveReadToolPath(env, path, context)（见 4.8.11 节）
 2. bytes = env.readBinaryFile(...)（先嗅探再解码）；命中图片 → { content: [], isError: true,
      diagnostics: [{ severity:"error", code:"unsupported_image",
                      message: `<path> is an image (<mime>); reading images is not supported` }] }   （:36-49）
 3. text = decode(bytes)；allLines = split("\n")；startLine = offset ? max(0, offset-1) : 0
    startLine >= allLines.length → throw `Offset N is beyond end of file (M lines total)`       （:56-58）
 4. limit ? slice(startLine, startLine+limit) : slice(startLine) → selectedContent
 5. { content: headText, ...truncation } = truncateHead(selectedContent)                         （:70）
 6. 三种诊断分支：
      a. firstLineExceedsLimit → 用 characterEnd(lineBytes, 50KB) 在字符边界截断首行；
         warn/code:"truncated"，文案含 `Use bash: sed -n 'Np' <path> | tail -c +<end+1>`；
         details.truncation 覆盖 outputBytes/outputLines                                        （:74-84）
      b. truncated → info/code:"truncated"：
         `Showing lines A-B of TOTAL[( 50.0KB limit)]. Use offset=<next> to continue.`          （:85-94）
      c. 只是用户 limit 截断 → info（无 code）：`N more lines in file. Use offset=<next> to continue.`（:95-102）
 7. content 为空串 → []；否则一个 text item
```

#### 关键代码

`src/tools/read.ts:74-95`：

```ts
			if (truncation.firstLineExceedsLimit) {
				// Show the start of the line, cut at the byte limit on a character boundary.
				const lineBytes = new TextEncoder().encode(allLines[startLine]);
				const end = characterEnd(lineBytes, DEFAULT_MAX_BYTES);
				outputText = new TextDecoder().decode(lineBytes.subarray(0, end));
				diagnostics.push({
					severity: "warn",
					code: "truncated",
					message: `Line ${startLineDisplay} is ${formatSize(lineBytes.byteLength)}, exceeds the ${formatSize(DEFAULT_MAX_BYTES)} limit; showing its first ${formatSize(end)}. Use bash: sed -n '${startLineDisplay}p' ${path} | tail -c +${end + 1}`,
				});
				details = { truncation: { ...truncation, outputBytes: end, outputLines: 1 } };
			} else if (truncation.truncated) {
				const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
				const nextOffset = endLineDisplay + 1;
				const limitText = truncation.truncatedBy === "lines" ? "" : ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`;
				diagnostics.push({
					severity: "info",
					code: "truncated",
					message: `Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}${limitText}. Use offset=${nextOffset} to continue.`,
				});
				details = { truncation };
			}
```

#### 不变式与边界

- 正文纯度：截断/继续信息都在 diagnostics；`test/tools.test.ts:265` 断言 `details` 不含 `truncation.content`。
- 行数口径有两套：`allLines = split("\n")` 的段数用于文案，`truncateHead` 按「结尾换行不算新行」计数（`src/truncate.ts:81-86`）；`test/tools.test.ts:235-247` 固定「2000 行 + 尾换行」不触发截断。
- 首行超字节时返回的是**半行**（唯一例外，切在 UTF-8 字符边界）；`test/tools.test.ts:249-266` 断言 40,000 个 `é` 输出 25,600 字符、`outputBytes === 51200`。
- 图片判定优先于文本解码；返回 `isError` 结果而非抛错。`offset` 越界则抛错（会变成 `tool_error` 结果）。

#### 相关测试

`test/tools.test.ts:192-289`：GIF 签名（`:192-194`）、offset/limit 与 continuation 诊断（`:196-213`）、2500 行按行截断与 details（`:215-233`）、尾换行边界（`:235-247`）、首行超字节（`:249-266`）、offset 越界（`:268-274`）、PNG 判为不支持（`:276-288`）、无环境（`:187-189`）。截断算法本身的用例在 `test/env-truncate.test.ts`。

### 4.8.5 src/tools/write.ts

整文件覆盖写：不存在则创建、自动建父目录，并与 `edit` 共享同一条按文件串行的队列（见 4.8.12 节），因此同进程内的读-改-写不会互相踩。

#### 导出面

```ts
const writeSchema = Type.Object({                                                    // src/tools/write.ts:9-12
  path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
  content: Type.String({ description: "Content to write to the file" }),
});
export type WriteToolInput = Static<typeof writeSchema>;                              // :14
export function createWriteTool(): ToolRegistration<typeof writeSchema>;              // :16
```

#### 关键流程

```text
execute(args, api, context)
  env = requireEnv(api)；absolutePath = resolveToolPath(env, path, context)          （:24-25）
  withFileMutationQueue(env, absolutePath, async () => {                             （:26-36）
     abort 检查 → env.writeFile(...)（失败抛 FileError）；
     abort 再检查 → { content: [{ type:"text", text: `Successfully wrote to ${path}` }] }
  }, context)
```

#### 关键代码

`src/tools/write.ts:29-34`：

```ts
				async () => {
					if (context.abortSignal?.aborted) throw new Error("Operation aborted");
					getOrThrow(await env.writeFile(absolutePath, content, context));   // 覆盖写 + mkdir -p
					if (context.abortSignal?.aborted) throw new Error("Operation aborted");  // 写完再查一次
					return { content: [{ type: "text", text: `Successfully wrote to ${path}` }] };
				},
```

#### 不变式与边界

- abort 不打断已开始的底层写，但会在 `writeFile` settle 后抛 `Operation aborted`；队列必须等这次写结束（`test/tools.test.ts:299-318`）。
- 结果文本用调用方给的 `path`（原样回显），便于模型对齐输入。
- 工具不截断 `content`：写入字节数只受输入 token 与磁盘限制。

#### 相关测试

`test/tools.test.ts:291-318`（写文件 + 建父目录；abort 时队列保持）、`:439-452`（经 symlinked 目录新建文件与 canonical 路径共用队列）、`:488-502`（不同 `FileSystem.id` 不互相排队）。

### 4.8.6 src/tools/edit.ts

单文件多块精确替换：所有 `edits[].oldText` 对着**同一份原文**匹配、互不重叠；写回前统一剥 BOM、换行归一化为 LF，写完恢复原换行风格与 BOM；成功时返回展示用 `diff` 与标准 `patch`。`prepareArguments` 修复模型常见的参数形状错误（`edits` 是 JSON 字符串或单对象、顶层 `oldText`/`newText`）。

#### 导出面

```ts
const replaceEditSchema = Type.Object({                                              // src/tools/edit.ts:19-25
  oldText: Type.String({ description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call." }),
  newText: Type.String({ description: "Replacement text for this targeted edit." }),
});
const editSchema = Type.Object({                                                     // :27-33
  path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
  edits: Type.Array(replaceEditSchema, { description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. …" }),
});
export type EditToolInput = Static<typeof editSchema>;                                // :35
export type EditToolDetails = { diff: string; patch: string; firstChangedLine?: number };   // :73-77
export function createEditTool(): ToolRegistration<typeof editSchema, EditToolDetails>;     // :90
```

#### 关键流程

```text
prepareArguments(input)（:49-71，纯函数，不改入参）
  edits 是字符串 → JSON.parse：数组直接用 / 单个 {oldText,newText} → 包成数组 / 解析失败保持原样
  edits 是单个对象 → 包成数组；顶层 oldText+newText 同时存在 → 追加进 edits 并删顶层字段

execute（:97-143）
  1. validateEditInput：edits 必须非空数组，否则抛 "Edit tool input is invalid. …"
  2. env = requireEnv(api)；absolutePath = resolveToolPath(...)
  3. withFileMutationQueue(env, absolutePath, async () => {
       abort 检查；fileInfo 失败 → Could not edit file: <path>. Error code: <code>.
       kind 不是 file/symlink → Could not edit file: <path>. Path is not a file.
       readTextFile → {bom, text} = stripBom；ending = detectLineEnding(text)；LF 归一化
       {baseContent, newContent} = applyEditsToNormalizedContent(normalized, edits, path)（见 4.8.7 节）
       finalContent = bom + restoreLineEndings(newContent, ending)；writeFile；失败 → 访问错误
       details = { diff: generateDiffString(...).diff, patch: generateUnifiedPatch(...), firstChangedLine? }
       content = `Successfully replaced ${edits.length} block(s) in ${path}.`
     }, context)
```

#### 关键代码

`src/tools/edit.ts:116-134`（第 125 行还有一次 abort 检查，此处省略）：

```ts
					const { bom, text: content } = stripBom(readResult.value);        // BOM 单独保存
					const originalEnding = detectLineEnding(content);                // "\r\n" | "\n"
					const normalizedContent = normalizeToLF(content);                // 内部只处理 LF
					const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);
					if (context.abortSignal?.aborted) throw new Error("Operation aborted");

					const finalContent = bom + restoreLineEndings(newContent, originalEnding);   // 原样还原
					const writeResult = await env.writeFile(absolutePath, finalContent, context);
					if (!writeResult.ok) throw editAccessError(path, writeResult.error);
					// ...（第 125 行：context.abortSignal?.aborted 时抛 "Operation aborted"）

					const diffResult = generateDiffString(baseContent, newContent);
					const details: EditToolDetails = {
						diff: diffResult.diff,                                        // 带行号、上下文裁剪
						patch: generateUnifiedPatch(path, baseContent, newContent),    // 可 applyPatch 的标准 patch
						...(diffResult.firstChangedLine === undefined
							? {}
							: { firstChangedLine: diffResult.firstChangedLine }),
					};
```

#### 不变式与边界

- `prepareArguments` 必须纯：一次调用可能在记录 intent 前被重试（`src/harness/types.ts:209-214`）；`test/tools.test.ts:345-358` 断言入参对象未被改。
- 失败即不写：匹配、唯一性、重叠检查都在写回之前完成；`test/tools.test.ts:360-377` 断言重叠被拒后文件未变。
- BOM 与 CRLF 原样保留（`test/tools.test.ts:512-517`）；symlink 可编辑（`fileInfo` 允许 `symlink`，写跟随链接，`:504-510`）。
- `details.diff`/`details.patch` 不受输出上限影响：`outputLimits` 只约束文本内容，`details` 原样入库（`test/tools.test.ts:337-341` 用 `applyPatch` 验证 patch 可用）。

#### 相关测试

`test/tools.test.ts:321-518`：两块替换的文本/diff/patch 与落盘一致（`:322-343`）；`prepareArguments` 四种修复（`:345-358`）；重叠被拒且文件未变（`:360-377`）；找不到/重复（`:379-389`）；abort 时队列保持（`:391-412`）；canonical + symlink 并发（`:414-424`）；跨 env 对象（`:426-437`）；经 symlink 编辑（`:504-510`）；BOM/CRLF（`:512-517`）。

### 4.8.7 src/tools/edit-diff.ts

`edit` 的匹配与渲染层：精确匹配优先，失败后做模糊匹配（NFKC、逐行去尾空白、弯引号/破折号/特殊空格归一化）；所有 edit 对着同一 base 匹配，重复出现拒绝、重叠拒绝；模糊匹配时把改动按行叠加回原文，使未触碰行的字节保持不变。渲染提供可应用的标准 unified patch 与带行号、上下文裁剪的展示 diff。

#### 导出面

```ts
export function detectLineEnding(content: string): "\r\n" | "\n";                    // src/tools/edit-diff.ts:7
export function normalizeToLF(text: string): string;                                 // :15
export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string;      // :19
export function normalizeForFuzzyMatch(text: string): string;                        // :30
export function applyReplacementsPreservingUnchangedLines(originalContent, baseContent, replacements): string;  // :128-132
export interface FuzzyMatchResult { found; index; matchLength; usedFuzzyMatch; contentForReplacement }          // :171-185
export interface Edit { oldText: string; newText: string }                            // :187-190
export interface AppliedEditsResult { baseContent: string; newContent: string }        // :192-195
export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult;     // :203
export function stripBom(content: string): { bom: string; text: string };              // :244
export function applyEditsToNormalizedContent(normalizedContent, edits, path): AppliedEditsResult;  // :301-305
export function generateUnifiedPatch(path, oldContent, newContent, contextLines = 4): string;       // :366
export function generateDiffString(oldContent, newContent, contextLines = 4): { diff: string; firstChangedLine: number | undefined };  // :377-381
```

#### 关键流程

```text
fuzzyFindText(content, oldText)                                          （:203-241）
  exact = content.indexOf(oldText) 命中 → { index: exact, matchLength: oldText.length,
                                            usedFuzzyMatch: false, contentForReplacement: content }
  否则在归一化空间匹配：命中 → { index: fuzzyIndex, matchLength: fuzzyOldText.length,
                                 usedFuzzyMatch: true, contentForReplacement: fuzzyContent }
  未命中 → { found: false, index: -1, matchLength: 0, usedFuzzyMatch: false }

applyEditsToNormalizedContent(normalizedContent, edits, path)            （:301-363）
  1. 每个 oldText/newText 先 normalizeToLF；任一 oldText 为空 → 抛
  2. 用**原文**试匹配一遍，决定是否整体切到归一化空间
  3. 对 replacementBaseContent 逐 edit 重新匹配：未找到 → not-found 文案；
     countOccurrences > 1 → duplicate 文案（重复数在归一化空间统计）
  4. 按 matchIndex 升序检查重叠：prev.matchIndex + prev.matchLength > cur.matchIndex → 抛
  5. 无模糊 → 在 base 上**逆序**替换；有模糊 → applyReplacementsPreservingUnchangedLines
  6. 结果与 base 完全相同 → 抛 no-change
```

模糊匹配下「未触碰行原样保留」（`:128-169`）：按行 span 把每个 replacement 扩到实际触及的行区间，相交的合并成组；每组只用 base 切片做替换，组外的行从原文逐行拷回。若两者行数不同，抛 `Cannot preserve unchanged lines because the base content has a different line count.`

#### 关键代码

`src/tools/edit-diff.ts:341-360`：

```ts
	matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
	for (let i = 1; i < matchedEdits.length; i++) {
		const previous = matchedEdits[i - 1];
		const current = matchedEdits[i];
		if (previous.matchIndex + previous.matchLength > current.matchIndex) {
			throw new Error(
				`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
			);
		}
	}

	const baseContent = normalizedContent;
	const newContent = usedFuzzyMatch
		? applyReplacementsPreservingUnchangedLines(normalizedContent, replacementBaseContent, matchedEdits)
		: applyReplacements(replacementBaseContent, matchedEdits);

	if (baseContent === newContent) {
		throw getNoChangeError(path, normalizedEdits.length);
	}
```

`normalizeForFuzzyMatch`（`:30-51`）的归一化阶梯：`normalize("NFKC")` → 逐行 `trimEnd()` → `[\u2018\u2019\u201A\u201B] → '`、`[\u201C\u201D\u201E\u201F] → "` → `[\u2010\u2011\u2012\u2013\u2014\u2015\u2212] → -` → `[\u00A0\u2002-\u200A\u202F\u205F\u3000] → 空格`。

#### 不变式与边界

失败模式与文案（单 edit / 多 edit 两套）：

| 情形 | 消息 |
|---|---|
| 空 `oldText` | `oldText must not be empty in <path>.` / `edits[i].oldText must not be empty in <path>.` |
| 找不到 | `Could not find the exact text in <path>. The old text must match exactly including all whitespace and newlines.` / `Could not find edits[i] in <path>. …` |
| 不唯一 | `Found N occurrences of the text in <path>. The text must be unique. …` / `Found N occurrences of edits[i] in <path>. Each oldText must be unique. …` |
| 重叠 | `edits[a] and edits[b] overlap in <path>. Merge them into one edit or target disjoint regions.` |
| 无变化 | `No changes made to <path>. The replacement produced identical content. …` / `The replacements produced identical content.` |
| 行数不匹配（模糊叠加） | `Cannot preserve unchanged lines because the base content has a different line count.` |

- 唯一性判定在**归一化空间**：原文的 `foo` 与全角 `ｆｏｏ` 会被判为重复（`countOccurrences`，`:248-252`）。
- `baseContent` 始终是 LF 化后的原文；无模糊匹配时 `newContent` 直接在原文上逆序替换，逐字节保留未触碰部分。
- `generateUnifiedPatch` 设 `headerOptions: FILE_HEADERS_ONLY`（`:366-371`），patch 只有文件名、无时间戳；`generateDiffString` 的 `firstChangedLine` 是**新文件**行号（`:404-406`）。
- `[待核]: 模糊匹配路径（usedFuzzyMatch === true）与「行数不匹配」失败分支在 test/ 下没有直接用例；现有工具测试的 oldText 都是精确匹配。`

#### 相关测试

`test/tools.test.ts:337-341`（`applyPatch(original, details.patch)` 还原）、`:360-389`（重叠/找不到/重复文案）、`:512-517`（BOM/CRLF 往返依赖 `detectLineEnding`/`restoreLineEndings`）。`normalizeForFuzzyMatch`/`fuzzyFindText` 无独立测试文件。

### 4.8.8 src/tools/bash.ts

执行命令并把合并输出**流式**交给 harness 的有界缓冲（`retain:"tail"`：保留最后 2000 行或 50KB），同时在输出越过同样阈值时让环境把完整输出 spill 到临时文件、把路径作为 `info` 诊断报出；非零退出码或超时抛错，错误结果仍带着已保留的输出与诊断。它自己不截断、不缓存。

#### 导出面

```ts
const bashSchema = Type.Object({                                                    // src/tools/bash.ts:10-13
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});
export type BashToolInput = Static<typeof bashSchema>;                               // :15
export interface BashExecution { command: string; cwd: string; env: Record<string, string>; inheritEnv: boolean }   // :17-22
export type BashPrepare = (execution: BashExecution, api: ToolExecutionApi, context: Context) => void | Promise<void>;  // :24
export interface BashToolOptions { commandPrefix?: string; prepare?: BashPrepare }    // :26-29
export function createBashTool(options?: BashToolOptions): ToolRegistration<typeof bashSchema>;   // :47
```

#### 关键流程

```text
execute(args, api, context)                                                       （:53-88）
 1. validateTimeout：非有限数或 <=0 → "Invalid timeout: must be a finite number of seconds"；
    > 2_147_483.647 秒 → "Invalid timeout: maximum is … seconds"                    （:31-39）
 2. env = requireEnv(api)
 3. execution = { command: commandPrefix ? `${prefix}\n${command}` : command,
                  cwd: env.cwd, env: {}, inheritEnv: true }
 4. await options.prepare?.(execution, api, context)      // 可改 command/cwd/env/inheritEnv
 5. env.exec(execution.command, { cwd, env, inheritEnv, timeout?,
                onOutput: text => api.output(text), spill: { afterBytes: 50KB, afterLines: 2000 } }, context)
 6. spillPath（成功取 value，失败取 error）存在 → api.diagnostic({ severity:"info", code:"full_output",
                                                   message:`Full output: ${spillPath}` })
 7. !result.ok：已 abort 且 context 已 abort → 原样 throw；timeout → `Command timed out after N seconds`；
    aborted → "Command aborted"；其他 → throw result.error
 8. exitCode !== 0 → throw `Command exited with code ${exitCode}`
 9. return {}    // 无 content：harness 用保留的输出当正文
```

#### 关键代码

`src/tools/bash.ts:52-88`（节选）：

```ts
		outputLimits: { retain: "tail" },                       // harness 保留最后 2000 行 / 50KB
		async execute(args, api, context) {
			const { command, timeout } = args;
			validateTimeout(timeout);
			const env = requireEnv(api);
			const execution: BashExecution = {
				command: options?.commandPrefix ? `${options.commandPrefix}\n${command}` : command,
				cwd: env.cwd,                                    // 默认用环境的 cwd
				env: {}, inheritEnv: true,                       // 默认继承宿主环境
			};
			await options?.prepare?.(execution, api, context);    // 记录 intent 之前可任意调整执行参数
			const result = await env.exec(
				execution.command,
				{
					cwd: execution.cwd, env: execution.env, inheritEnv: execution.inheritEnv,
					...(timeout === undefined ? {} : { timeout }),
					onOutput: (text) => api.output(text),         // 原始块 → harness 的有界、节流缓冲
					spill: { afterBytes: DEFAULT_MAX_BYTES, afterLines: DEFAULT_MAX_LINES },
				},
				context,
			);
			const spillPath = result.ok ? result.value.spillPath : result.error.spillPath;
			if (spillPath !== undefined) {
				api.diagnostic({ severity: "info", code: "full_output", message: `Full output: ${spillPath}` });
			}
			if (!result.ok) {
				if (result.error.code === "aborted" && context.abortSignal?.aborted) throw result.error;
				if (result.error.code === "timeout") throw new Error(`Command timed out after ${timeout} seconds`);
				if (result.error.code === "aborted") throw new Error("Command aborted");
				throw result.error;
			}
			if (result.value.exitCode !== 0) throw new Error(`Command exited with code ${result.value.exitCode}`);
			return {};
		},
```

#### 不变式与边界

- 输出上限有两个独立作用点：**保留**由 harness 的 `OutputBuffer`（`src/harness/output.ts:110-195`，`retain:"tail"` 保留末尾窗口，超限追加 `warn`/`code:"truncated"` 诊断）；**spill** 由环境按原始字节阈值触发（见 4.8.2 节）。数值相同但计量对象不同。
- 无 content 时 harness 把保留输出当一个 text item 写进结果（`src/harness/tool.ts:337-339`）；工具抛出的异常被任务层转成 `isError` + `tool_error` 诊断，内容仍是已保留的输出（`src/harness/tool.ts:247-257`）。
- 超时消息里的数字是调用方给的秒数，不是上限值；超时/中止会带 `spillPath` 并成为第一条诊断（`test/tools.test.ts:538-551`）。
- `commandPrefix` 用换行拼接保证前缀先执行；`prepare` 里改的 `cwd`/`env`/`inheritEnv` 原样传给环境（`test/tools.test.ts:553-589`）。

#### 相关测试

`test/tools.test.ts:520-609`：流式合并输出且自身无 content（`:521-526`）；非零退出与超时（`:528-536`）；超时 + spill 诊断（`:538-551`）；`prepare`/`commandPrefix`（`:553-589`）；3000 行输出全部流过 `output()` 且 spill 完整（`:591-603`）；未越界不产生诊断（`:605-608`）。底层行为见 `test/env-node.test.ts` 的 shell 段与 `test/env-node-spill.test.ts`。

### 4.8.9 src/tools/image.ts

按**字节内容**（不看扩展名）判断是否为受支持的图片，返回 MIME 类型；`read` 用它把图片文件判为不支持。支持 JPEG、静态 PNG、GIF87a/89a、WebP、结构合法的 BMP；动画 PNG（含 `acTL` 块）与可疑 BMP 返回 `undefined`。

#### 导出面

```ts
export function detectSupportedImageMimeType(buffer: Uint8Array): string | undefined;   // src/tools/image.ts:3
```

返回 `"image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/bmp" | undefined`。

#### 关键流程

```text
detectSupportedImageMimeType(buffer)
  [FF D8 FF] → 第 4 字节 === 0xF7 ? undefined : "image/jpeg"
  PNG 签名 → isPng && !isAnimatedPng ? "image/png" : undefined
  "GIF87a"/"GIF89a" → "image/gif"；  "RIFF" + 偏移 8 "WEBP" → "image/webp"；  "BM" + isBmp → "image/bmp"
  其他 → undefined

isPng：长度 >= 16 且偏移 8 的 uint32BE === 13 且偏移 12 是 "IHDR"
isAnimatedPng：从偏移 8 遍历 chunk（长度4 + 类型4 + 数据 + CRC4）：
               遇 "acTL" → true；遇 "IDAT" → false；越界/不前进 → false
isBmp：长度 >= 26；一致性校验 declaredFileSize/pixelDataOffset/dibHeaderSize；
       DIB 12 取 planes@22、bpp@24；DIB 40..124 取 planes@26、bpp@28；
       最终 planes === 1 且 bpp ∈ {1,4,8,16,24,32}
```

#### 关键代码

`src/tools/image.ts:3-10`、`18-30`（`isPng` 见上方流程）：

```ts
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectSupportedImageMimeType(buffer: Uint8Array): string | undefined {
	if (startsWith(buffer, [0xff, 0xd8, 0xff])) return buffer[3] === 0xf7 ? undefined : "image/jpeg";
	if (startsWith(buffer, PNG_SIGNATURE)) return isPng(buffer) && !isAnimatedPng(buffer) ? "image/png" : undefined;
	if (startsWithAscii(buffer, 0, "GIF87a") || startsWithAscii(buffer, 0, "GIF89a")) return "image/gif";
	if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) return "image/webp";
	if (startsWithAscii(buffer, 0, "BM") && isBmp(buffer)) return "image/bmp";
	return undefined;
}
// ...（第 11-17 行：isPng 的实现）

function isAnimatedPng(buffer: Uint8Array): boolean {
	let offset = PNG_SIGNATURE.length;
	while (offset + 8 <= buffer.length) {
		const chunkLength = readUint32BE(buffer, offset);
		const chunkTypeOffset = offset + 4;
		if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) return true;    // 动画控制块
		if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) return false;   // 先见像素数据 → 静态
		const nextOffset = offset + 8 + chunkLength + 4;
		if (nextOffset <= offset || nextOffset > buffer.length) return false;
		offset = nextOffset;
	}
	return false;
}
```

#### 不变式与边界

- 纯函数：只用 `Uint8Array` 索引与手写大小端读取，无 I/O、无依赖（`:56-88`）。
- 保守优先：无法确认一律 `undefined`，宁可当普通文本处理。
- `[待核]: JPEG 分支在第 4 字节为 0xF7 时返回 undefined，代码无注释说明原因；test/ 也没有 JPEG/WebP/BMP/动画 PNG 分支的直接用例（只覆盖 GIF 与静态 PNG）。`

#### 相关测试

`test/tools.test.ts:192-194`（GIF87a/GIF89a）、`:276-288`（1×1 PNG base64 被判 `image/png`，`read` 返回 `unsupported_image` 诊断）。

### 4.8.10 src/tools/env.ts

工具取得本次调用执行环境的唯一入口；没有环境时抛普通错误，由任务层转成 `tool_error` 结果。它的存在让四个工具都不需要知道环境是谁提供、何时构建。

#### 导出面

```ts
export function requireEnv(api: ToolExecutionApi): ExecutionEnv;   // src/tools/env.ts:5-8
```

#### 关键流程

```text
execute(args, api, ctx) → requireEnv(api) → api.env（缺失 → throw Error("No execution environment is configured")）
```

#### 关键代码

`src/tools/env.ts:4-8`：

```ts
/** The call's execution environment; a tool without one fails with an ordinary error result. */
export function requireEnv(api: ToolExecutionApi): ExecutionEnv {
	if (api.env === undefined) throw new Error("No execution environment is configured");
	return api.env;
}
```

#### 不变式与边界

- `api.env` 是**每次调用**构建的：`pi.tool` 任务在 `execute` 前 `await runtime.env(context)`（`src/harness/tool.ts:245-246`），重放恢复时拿到的是当时的环境。
- 错误是普通 `Error`（不是 `FileError`），因为「没有环境」不是文件系统失败。

#### 相关测试

`test/tools.test.ts:187-189`；`:50-69` 的 `fakeApi` 是它的测试替身（提供 `env`/`output`/`diagnostic`）。

### 4.8.11 src/tools/path-utils.ts

把模型/用户给的路径整理成环境能解析的形式：Unicode 空格 → 普通空格、剥掉开头的 `@`，再交给 `env.absolutePath`；`read` 额外尝试 macOS 常见的变体（AM/PM 前的窄不换行空格、NFD 分解、弯引号），命中已存在的那个。

#### 导出面

```ts
export async function resolveToolPath(env: ExecutionEnv, path: string, context: Context): Promise<string>;      // src/tools/path-utils.ts:12
export async function resolveReadToolPath(env: ExecutionEnv, path: string, context: Context): Promise<string>;  // :16
```

#### 关键流程

```text
normalizeToolPath(path)（私有）
  path.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ")，若以 "@" 开头则 slice(1)

resolveToolPath = getOrThrow(await env.absolutePath(normalizeToolPath(path), ctx))

resolveReadToolPath
  variants = 去重([resolved,
                   resolved.replace(/ (AM|PM)\./gi, "\u202F$1."),    // 10.30 AM.txt 这类名字
                   resolved.normalize("NFD"),                         // macOS 的分解形式
                   resolved.replace(/'/g, "\u2019"),                   // 弯引号
                   resolved.normalize("NFD").replace(/'/g, "\u2019")])
  返回第一个 env.exists(variant) 为真的；都不存在 → 返回原 resolved
```

#### 关键代码

`src/tools/path-utils.ts:16-29`：

```ts
export async function resolveReadToolPath(env: ExecutionEnv, path: string, context: Context): Promise<string> {
	const resolved = await resolveToolPath(env, path, context);
	const variants = [
		resolved,
		resolved.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`),
		resolved.normalize("NFD"),
		resolved.replace(/'/g, "\u2019"),
		resolved.normalize("NFD").replace(/'/g, "\u2019"),
	];

	for (const variant of new Set(variants)) {
		if (getOrThrow(await env.exists(variant, context))) return variant;   // 探测已存在的变体
	}
	return resolved;
}
```

#### 不变式与边界

- 只有 `read` 做变体探测；`write`/`edit` 用 `resolveToolPath`，避免把猜测出来的路径写进磁盘。
- `@` 只剥一层（`@@x` → `@x`）；不处理引号或转义。
- 探测顺序固定、取第一个存在的；都不存在时返回归一化后的原路径，让后续读操作自己报 `not_found`。
- `[待核]: test/ 下没有直接针对本文件的用例，只有 read/write/edit 的普通相对路径间接覆盖。`

#### 相关测试

无独立测试文件；间接覆盖见 `test/tools.test.ts` 全部工具用例的 `path` 解析路径。

### 4.8.12 src/tools/file-mutation-queue.ts

在**单个进程内**把 `edit`/`write` 对同一文件的读-改-写串行化：key 是「`FileSystem.id` + canonical path」，因此经 symlink 的不同入口、不同环境对象都会落到同一条队列；不同文件与不同文件系统互不等待。注释明确它不是针对 `bash` 或其他进程的锁。

#### 导出面

```ts
export async function withFileMutationQueue<T>(
  env: ExecutionEnv, path: string, fn: () => Promise<T>, context: Context,
): Promise<T>;                                                       // src/tools/file-mutation-queue.ts:33-39
```

模块级 `const queues = new Map<string, Promise<void>>()`（`:5`）保存每个 key 的链尾。

#### 关键流程

```text
mutationKey(env, path, ctx)（:7-10）
  absolutePath = getOrThrow(await env.absolutePath(path, ctx))
  key = `${env.id}\0${await canonical(env, absolutePath, ctx)}`

canonical(env, absolutePath)（:16-26）
  env.canonicalPath 成功 → realpath；"not_supported" → absolutePath；其他错误（非 not_found）→ 抛出
  not_found（文件还不存在）：
    parent = joinPath([absolutePath, ".."])
    parent === absolutePath 或 absolutePath 不以 parent 开头 → absolutePath
    name = absolutePath.slice(parent.length + (/[/\\]$/.test(parent) ? 0 : 1))   // 名字里可能含分隔符
    return joinPath([await canonical(env, parent), name])                        // 递归到存在的祖先

withFileMutationQueue(env, path, fn, ctx)（:33-54）
  previous = queues.get(key) ?? Promise.resolve()
  构造 done/release；tail = previous.then(() => done)
  queues.set(key, tail)          // **不 await 就占位**：中间不会有别的调用插队
  await previous                 // 前一个持有者释放后才进入
  try { return await fn() } finally { release(); if (queues.get(key) === tail) queues.delete(key) }
```

#### 关键代码

`src/tools/file-mutation-queue.ts:39-54`：

```ts
	const key = await mutationKey(env, path, context);        // `${env.id}\0${canonicalPath}`
	// Take the slot without awaiting, so no other call can take it in between.
	const previous = queues.get(key) ?? Promise.resolve();
	let release = (): void => {};
	const done = new Promise<void>((resolve) => {
		release = resolve;
	});
	const tail = previous.then(() => done);
	queues.set(key, tail);
	await previous;
	try {
		return await fn();
	} finally {
		release();                                            // 唤醒后继
		if (queues.get(key) === tail) queues.delete(key);      // 链空则回收 key
	}
```

#### 不变式与边界

- key 的两段：`env.id` 决定文件命名空间（本地 Node 恒为 `"node:local"`，见 4.8.1 节）；canonical path 让 symlink 与目标归一。
- 尚不存在的文件用「canonical 父目录 + 名字」归一，因此「`write` 新建」与「随后 `edit` 同一文件」共用 key。
- 跨环境对象串行（同 id + 同路径），不同 `id` 不串行：`test/tools.test.ts:426-437`、`:488-502`。
- 取消/异常都不提前释放队列，直到 `fn` 的 promise settle（`test/tools.test.ts:299-318`、`:391-412`）。
- 只在本进程有效：注释明确不是针对 `bash` 或其他进程的锁（`:31`；`docs/spec.md:3019-3024`）。

#### 相关测试

`test/tools.test.ts`：write 的 abort 队列（`:299-318`）、edit 的 abort 队列（`:391-412`）、canonical + symlink 并发（`:414-424`）、跨 env 对象（`:426-437`）、新建文件经 symlinked 目录归一（`:439-452`）、文件名含 `\` 的 key 一致（`:454-486`，win32 skip）、不同文件系统 id 不互等（`:488-502`）。

---

## 4.9 testing/

### 4.9.1 src/testing/index.ts

`src/testing/index.ts` 是 `@earendil-works/pi-durable/testing` 子路径的唯一入口（见 `package.json:63-67` 的导出映射，导出到 `./src/testing/index.ts` 与 `./dist/testing/index.js`）。它本身不含任何逻辑，只做再导出，把「与测试运行器无关的存储契约用例」「把用例注册进 Vitest/Jest 的胶水」「可复现的存储基准数据与场景」三块能力拼成一个对外 API。整个 `src/testing/` 只被测试代码使用，生产代码不 import 它，因此它可以自由依赖 `@earendil-works/chord/context` 的 `BACKGROUND_CONTEXT` 这类测试专用上下文。

#### 导出面

不定义新类型，全部是转发导出，按用途分三组：

- 断言适配：`createExpectAssertions`（值）、`type ExpectLike`（类型），来自 `./assertions.ts`。
- 契约注册：`registerStorageConformance`（值）、`type StorageConformanceRunner`（类型），来自 `./runner.ts`。
- 契约用例本体：`createStorageConformance`（值），来自 `./storage-conformance.ts`。
- 契约用例的类型：`StorageConformanceAssertions`、`StorageConformanceCase`、`StorageConformanceOptions`、`StorageConformanceProvider`，来自 `./types.ts`。
- 基准数据与场景：`STORAGE_MEMORY_SCALES`、`STORAGE_READ_BENCHMARKS`、`STORAGE_WRITE_BENCHMARKS`、`seedStorageBenchmark`、`seedStorageWriteBenchmark`、`storageBenchmarkPrimaryRecordCount`、`TIMING_SCALE`（值），`StorageBenchmarkDataset`、`StorageBenchmarkScale`、`StorageReadBenchmark`、`StorageWriteBenchmark`（类型），来自 `./storage-benchmark.ts`。

```typescript
// src/testing/index.ts:1-22（全文）
export { createExpectAssertions, type ExpectLike } from "./assertions.ts";
export { registerStorageConformance, type StorageConformanceRunner } from "./runner.ts";
export {
	STORAGE_MEMORY_SCALES,
	STORAGE_READ_BENCHMARKS,
	STORAGE_WRITE_BENCHMARKS,
	type StorageBenchmarkDataset,
	type StorageBenchmarkScale,
	type StorageReadBenchmark,
	type StorageWriteBenchmark,
	seedStorageBenchmark,
	seedStorageWriteBenchmark,
	storageBenchmarkPrimaryRecordCount,
	TIMING_SCALE,
} from "./storage-benchmark.ts";
export { createStorageConformance } from "./storage-conformance.ts";
export type {
	StorageConformanceAssertions,
	StorageConformanceCase,
	StorageConformanceOptions,
	StorageConformanceProvider,
} from "./types.ts";
```

#### 关键流程

没有流程；唯一的规则是**导出面稳定**：`createStorageConformance` 与 `registerStorageConformance` 是两条并列入口，前者面向任何自研 runner（返回 case 数组），后者面向 Vitest/Jest。`StorageConformanceAssertions`/`StorageConformanceOptions`/`StorageConformanceProvider`/`StorageConformanceCase` 只随 `createStorageConformance` 一起使用；`ExpectLike`/`StorageConformanceRunner` 只随 `registerStorageConformance` 一起使用。

#### 不变式与边界

- 没有任何运行时副作用：导入它不会注册测试、不会创建存储、不会读文件。
- 该子路径不导出 `Storage` 实现；MemoryStorage 要从包根导入（见 2.1 节）。
- `src/testing/` 里的文件全部使用 erasable TypeScript 语法，`index.ts` 里 `export type` 与 `export { type X }` 混用是刻意的，两者都在擦除后不产生 JS 语句。

#### 相关测试

无直接测试。间接覆盖来自三处：`test/storage-memory.ts` 与 `test/storage.bench.ts`（用基准 API），以及 `test/memory-storage.test.ts`、`test/sqlite-storage.test.ts`、`test/jsonl-storage.test.ts`（用契约 API）。`test/storage-runtime-boundary.test.ts` 只检查包根与 portable 子路径的依赖图，不覆盖 `/testing`。

### 4.9.2 src/testing/types.ts

`src/testing/types.ts` 是契约套件的类型层，只有 22 行，定义四个接口。它把「怎么断言」「怎么拿到一个可用 Storage」「一个用例长什么样」与具体测试框架彻底解耦：契约用例代码只依赖这里的抽象，因此同一份用例可以跑在 Vitest、Jest，甚至自研 runner 上。

#### 导出面

```typescript
// src/testing/types.ts:3-21
export interface StorageConformanceAssertions {
	ok(value: unknown, message?: string): void;
	strictEqual(actual: unknown, expected: unknown): void;
	deepEqual(actual: unknown, expected: unknown): void;
	partialDeepEqual(actual: unknown, expected: unknown): void;
	greaterThan(actual: number, expected: number): void;
	rejects(operation: Promise<unknown>, messageIncludes: string): Promise<void>;
}

export type StorageConformanceProvider = (use: (storage: Storage) => Promise<void>) => Promise<void>;

export interface StorageConformanceOptions {
	readonly assertions: StorageConformanceAssertions;
	readonly withStorage: StorageConformanceProvider;
}

export interface StorageConformanceCase {
	readonly name: string;
	run(): Promise<void>;
}
```

- `StorageConformanceAssertions`：契约用例能用的全部断言语义。6 个方法各自对应一种「存储必须满足的关系」：
  - `ok(value, message?)`：真值断言，`message` 是失败时给人看的原因（例如 `"Expected value to be defined"`，见 `storage-conformance.ts:71`）。
  - `strictEqual(actual, expected)`：`===`/`Object.is` 语义，用于 ID、`Seq`、枚举字符串这类不需要结构比较的值。
  - `deepEqual(actual, expected)`：结构深比较，用于整条 `EntryRecord`/`TaskRecord`/`SubmissionRecord` 的往返一致性。
  - `partialDeepEqual(actual, expected)`：只比较 expected 里出现的字段（`toMatchObject`），用于「我只关心这几个字段」的场景。
  - `greaterThan(actual, expected)`：数值偏序，用于「回滚后的下一次提交号必须大于回滚前」这类单调性断言。
  - `rejects(operation, messageIncludes)`：返回 Promise，等 `operation` 被拒且错误消息包含给定子串。`messageIncludes` 是**子串**而不是正则，所以调用点写的是 `"ID 1 already belongs to conversation"`、`"closed"`、`"version transition requires a base"` 这样的原文片段。
- `StorageConformanceProvider`：签名为 `(use) => Promise<void>`。调用方负责创建一个（或每次重新打开一个）`Storage`，把它交给 `use` 并 **await**；`use` 内部就是一条用例的全部断言。名字里没有 `storage` 参数是刻意的：每次调用都可能是**新的**存储实例，所以 `withStorage` 必须自己决定「这条用例用哪个后端、要不要跨 reopen」。
- `StorageConformanceOptions`：`createStorageConformance` 的唯一入参，把断言表和存储供应器组合起来。
- `StorageConformanceCase`：`{ name, run }`。`name` 直接用作测试名（`runner.ts:22`），`run()` 无参无返回值，因此可以被任何 runner 以「无参异步函数」的形式执行。

#### 关键流程

无分支逻辑，但有一条隐藏约束贯穿整套 API：

```text
createStorageConformance({ assertions, withStorage })
  → cases[i] = { name, run: () => withStorage(test_i) }
  → runner 调用 cases[i].run()
  → withStorage 创建 Storage S，调用 test_i(S)，await 完成后返回
```

因此 `run()` 被调用几次，就应该创建几次存储；套件在 23 个用例上各调用一次 `withStorage`（见 4.9.6）。

#### 不变式与边界

- `withStorage` 每个 case 必须**恰好调用一次 `use` 并 await 它**（`storage-conformance.ts:90` 的注释把这个约定写成契约）。若某实现了 `use` 而没 await，用例里的断言会在存储关闭后才跑，失败会变成未捕获拒绝。
- `rejects` 是 `Promise<void>` 而不是 `void`：不 await 它等于丢弃断言。
- 接口只描述能力，不含默认实现：`types.ts` 不 import 任何 runner。

#### 相关测试

无直接测试；它的正确性由「同一份用例在三种后端上通过」间接证明（`test/memory-storage.test.ts:8`、`test/sqlite-storage.test.ts:113,117`、`test/jsonl-storage.test.ts:123,125`）。

### 4.9.3 src/testing/assertions.ts

`src/testing/assertions.ts` 把 Vitest/Jest 风格（也兼容 Node `assert` 风格扩展）的 `expect` 函数适配成 `StorageConformanceAssertions`。它的价值在于：契约用例读起来和普通 Vitest 测试一样，但源码里**不 import vitest**，因此同一个文件既能在 vitest 里跑，也能在 node:test 或自研 runner 里跑。

#### 导出面

```typescript
// src/testing/assertions.ts:3-14
export type ExpectLike = (actual: unknown, message?: string) => unknown;

type ExpectResult = {
	toBe(expected: unknown): unknown;
	toBeGreaterThan(expected: number): unknown;
	toEqual(expected: unknown): unknown;
	toMatchObject(expected: unknown): unknown;
	toBeTruthy(): unknown;
	readonly rejects: {
		toThrow(expected?: string | RegExp): unknown;
	};
};

// src/testing/assertions.ts:17
export function createExpectAssertions(expect: ExpectLike): StorageConformanceAssertions
```

- `ExpectLike`：只要求「给我一个值，返回一个带断言方法的对象」。`message?: string` 是第二个可选参数，Vitest 的 `expect(actual, message)` 支持它，用作失败描述。
- `ExpectResult`：内部类型（未导出），列出适配器实际会调用的方法。注意它只声明了契约套件用到的那几个方法，而不是完整的 Jest matcher 面。
- `createExpectAssertions(expect)`：返回 6 个方法组成的断言表；参数就是 runner 自己的 `expect` 函数（`runner.ts:18` 传的是 `runner.expect`）。

#### 关键流程

映射是逐一的、无分支的：

```text
ok(v, msg)               → expect(v, msg).toBeTruthy()
strictEqual(a, e)        → expect(a).toBe(e)
deepEqual(a, e)          → expect(a).toEqual(e)
partialDeepEqual(a, e)   → expect(a).toMatchObject(e)
greaterThan(a, e)        → expect(a).toBeGreaterThan(e)
rejects(op, msgIncludes) → await expect(op).rejects.toThrow(msgIncludes)
```

唯一有「时序」的是最后一行：`expect(op)` 拿到的是 Promise，`rejects.toThrow(...)` 在 Vitest 里返回 Promise，所以适配器本身也返回 Promise 并且 await 它（`assertions.ts:35-37`）。

#### 关键代码

```typescript
// src/testing/assertions.ts:16-38
/** Adapts a Vitest/Jest-compatible `expect` function without importing either runner. */
export function createExpectAssertions(expect: ExpectLike): StorageConformanceAssertions {
	const result = (actual: unknown, message?: string): ExpectResult => expect(actual, message) as ExpectResult;
	return {
		ok(value, message) {
			result(value, message).toBeTruthy();          // message 只在 ok 这一条路径上透传
		},
		strictEqual(actual, expected) {
			result(actual).toBe(expected);                // 其余路径不传 message，靠调用点的名称表达意图
		},
		deepEqual(actual, expected) {
			result(actual).toEqual(expected);
		},
		partialDeepEqual(actual, expected) {
			result(actual).toMatchObject(expected);
		},
		greaterThan(actual, expected) {
			result(actual).toBeGreaterThan(expected);
		},
		async rejects(operation, messageIncludes) {
			await result(operation).rejects.toThrow(messageIncludes);
		},
	};
}
```

#### 不变式与边界

- `expect` 被强转成 `ExpectResult`（`as ExpectResult`，L18），所以传入一个不支持这些 matcher 的断言库时，错误发生在**断言时刻**而不是适配时刻，报错信息可能是 `undefined is not a function`。这是刻意换取「零依赖」的代价。
- `rejects` 的 `messageIncludes` 只支持字符串/正则参数直传；契约用例传的都是普通字符串子串。
- 适配器不缓存 `ExpectResult`，每次断言都重新调用一次 `expect`，因此与 runner 的「软断言/失败收集」模式兼容。

#### 相关测试

无直接单元测试。间接覆盖：只要任一后端违反 `strictEqual`/`deepEqual` 语义，`memory-storage.test.ts`、`sqlite-storage.test.ts`、`jsonl-storage.test.ts` 注册的那批用例就会失败。

### 4.9.4 src/testing/runner.ts

`src/testing/runner.ts` 只有 24 行，是「runner 无关的用例」与「具体测试框架」之间的注册器。它把 `describe`/`it`/`expect` 三个函数收进一个结构体，因此调用方不需要把 vitest 当成全局变量，也不需要类型上依赖 vitest。

#### 导出面

```typescript
// src/testing/runner.ts:5-16
export interface StorageConformanceRunner {
	readonly describe: (name: string, suite: () => void) => unknown;
	readonly expect: ExpectLike;
	readonly it: (name: string, test: () => Promise<void>) => unknown;
}

export function registerStorageConformance(
	runner: StorageConformanceRunner,
	name: string,
	withStorage: StorageConformanceProvider,
): void
```

- `describe(name, suite)`：需要**同步**执行 `suite`（Vitest/Jest/node:test 都满足）。返回类型是 `unknown`，为了不假设 runner 的返回值。
- `it(name, test)`：`test` 被声明为必须返回 Promise——契约用例全部是异步的，同步用例注册进来也没意义。
- `expect`：直接是 `ExpectLike`，交给 `createExpectAssertions`。
- `name`：suite 名字，实际测试名是 `name` + 用例名两层。
- `withStorage`：一个 case 一个存储的策略，见 4.9.2。

#### 关键流程

```text
registerStorageConformance(runner, name, withStorage)
  cases = createStorageConformance({ assertions: createExpectAssertions(runner.expect), withStorage })
  runner.describe(name, () => {
    for (testCase of cases) runner.it(testCase.name, testCase.run)
  })
```

要点：
1. 用例列表在**注册时**构建一次（L17-20），之后不再重建。
2. `describe` 体内只做 `it` 注册，没有任何 await/IO，符合所有主流 runner 对 suite 回调同步的要求。
3. `testCase.run` 被直接当作测试函数传入（L22），没有包一层 `async () => { await testCase.run() }`，因此调用栈里能看到真实的用例函数。

#### 关键代码

```typescript
// src/testing/runner.ts:11-23
/** Registers the runner-independent cases with a Vitest/Jest-compatible test runner. */
export function registerStorageConformance(
	runner: StorageConformanceRunner,
	name: string,
	withStorage: StorageConformanceProvider,
): void {
	const cases = createStorageConformance({
		assertions: createExpectAssertions(runner.expect),
		withStorage,
	});
	runner.describe(name, () => {
		for (const testCase of cases) runner.it(testCase.name, testCase.run);
	});
}
```

#### 不变式与边界

- 想给同一条契约加第二种运行条件（例如「每次提交后重开存储」），做法是**再次调用** `registerStorageConformance` 并换一个 `withStorage`，suite 名字也换掉。仓库里就是这么做的：`"SqliteStorage"` 与 `"SqliteStorage across reopen"` 各注册一次（`test/sqlite-storage.test.ts:113,117`），`"JsonlStorage"` 与 `"JsonlStorage across reopen"` 同理（`test/jsonl-storage.test.ts:123,125`）。
- 不返回任何东西；测试数量 = 23 × 注册次数。
- 不清理 `withStorage` 创建的资源，清理责任在 `withStorage` 自己（两个 «across reopen» 实现都在 `finally` 里关存储并删临时目录）。
- 没有「跳过用例」的能力：23 个用例对所有后端都是全量的，后端必须全部满足。`[待核]: 本套件没有 per-case skip 机制——若某个后端在某个运行环境里确实无法满足某条契约，只能选择不注册该 suite，仓库里也没有这样的先例。`

#### 相关测试

`test/memory-storage.test.ts:8`、`test/sqlite-storage.test.ts:113,117`、`test/jsonl-storage.test.ts:123,125`——五个注册点，共 115 个测试用例；它们断言的行为由 4.9.6 列出的 23 组规则决定。

### 4.9.5 src/testing/storage-benchmark.ts

`src/testing/storage-benchmark.ts` 是存储基准的「数据工厂 + 场景表」。它只通过公共 `Storage` 契约写入数据（注释明写 "Seed deterministic representative data through only the public `Storage` contract"，L87），因此同一份数据集可以喂给 MemoryStorage、SqliteStorage、JsonlStorage 三种后端，用来比较它们的读放大与写延迟。文件本身**不测时间**：它导出「怎么造数据」「有哪些场景」「场景的正确结果是多少」，计时与输出交给 `test/storage.bench.ts`、`test/storage-memory.ts`。

#### 导出面

- `StorageBenchmarkScale`（L17-22）：`{ name, entryCount, taskCount, documentCount }`，描述一个规模的形状。
- `STORAGE_MEMORY_SCALES`（L24-27）：两档 `1k`（1000 entry / 200 task / 200 document）与 `10k`（10000 / 2000 / 2000），给内存占用测量用。
- `TIMING_SCALE`（L29-34）：`{ name: "timing", entryCount: 1_000, taskCount: 300, documentCount: 300 }`，是 `seedStorageBenchmark` 的默认规模，给计时基准用。
- `storageBenchmarkPrimaryRecordCount(scale)`（L42-52）：返回数据集里「主记录」条数，公式是 `1 + entryCount + taskCount + documentCount + REPLAY_TAILS.length + 1 + FORK_DEPTH * (1 + ENTRIES_PER_FORK)`；`1` 是根 conversation，中间的 `+1` 是历史文档，最后一项是 8 层 fork 每层 1 个 conversation + 32 条 entry。内存基准用它把 heap 差值换算成「每个主记录多少字节」。
- `StorageBenchmarkDataset`（L56-67）：造完数据后返回的「查询坐标」，含 `firstEntryId`、`filteredTaskCount`、`exactDocumentId`/`exactDocumentKey`、`replayDocumentIds`、`historicalDocumentId`、`ancientAt`/`recentAt`、`deepestConversationId`、`ancestorHeadEntryId`。
- `seedStorageBenchmark(storage, scale = TIMING_SCALE)`（L88-276）：唯一的数据写入函数，返回 `StorageBenchmarkDataset`。
- `StorageReadBenchmark`（L278-282）：`{ name, run(storage, dataset): Promise<number>, expected(dataset): number }`。
- `STORAGE_READ_BENCHMARKS`（L284-382）：11 个读场景。
- `StorageWriteBenchmark`（L384-388）：`{ name, expected, run(storage): Promise<number> }`——注意写场景只拿 `storage`，所以 `seedStorageWriteBenchmark` 是它的一部分。
- `seedStorageWriteBenchmark(storage)`（L391-407）：写场景的公共前置状态（1 个根 conversation + 100 条 `benchmark.baseline` entry）。
- `STORAGE_WRITE_BENCHMARKS`（L409-488）：3 个写场景。

内部常量（未导出，但解释数据形状必须知道）：`REPLAY_TAILS = [0, 16, 128, 1_024]`、`HISTORY_SEGMENT_LENGTH = 128`、`FORK_DEPTH = 8`、`ENTRIES_PER_FORK = 32`、`BATCH_SIZE = 100`（L36-40）。

#### 关键流程

`seedStorageBenchmark` 是严格串行、按阶段写入的；每段都用 `BATCH_SIZE = 100` 分批 commit：

```text
seedStorageBenchmark(storage, scale)
  1. commit 根 conversation（ROOT_CONVERSATION_ID）
  2. scale.entryCount 条 entry，kind="benchmark.entry"；第 0 条带 head=自身      // L94-112
  3. scale.taskCount 条 task（三种 status 轮转 + background/abortRequested 位）   // L114-120
  4. scale.documentCount 个 session 作用域文档，kind="benchmark.family"         // L122-135
  5. 4 个 replay 文档（history="rewindable", fork="asOf"）：第 n 轮给 tail>=n 的文档各追一条 delta ["s",["count"],n]  // L137-169
  6. 1 个历史文档：128 条 delta 后写一个 base（记下 ancientAt），再 128 条 delta（记下 recentAt）  // L171-225
  7. 8 层 fork：每层新 conversation（parent=上一层最后一条 entry）+ 32 条 entry   // L227-258
  返回查询坐标
```

读场景各自只做一次 `Storage` 调用，返回一个数字用于校验：

- `exact entry lookup`（L285-291）：`storage.entry(firstEntryId)`，期望 `firstEntryId`。
- `entry page scan (100)`（L292-300）：根会话 `scanEntries(..., 100, undefined)`，期望 `100`。
- `filtered task scan (50)`（L301-314）：`{ kind: "benchmark.filtered", status: "pending", background: true }`，期望 `filteredTaskCount = min(50, ceil(taskCount / 60))`（L263）。
- `exact document address among many`（L315-329）：按 `kind+key+session` 地址 `findDocument`，期望 `exactDocumentId`。
- 4 个 `document replay tail (n)`（L330-340，由 `REPLAY_TAILS` 展开）：读 `count`，期望 `n`——这条同时验证「tail 更长的文档 delta 链更长、重建结果仍是 n」。
- `ancient historical read before newer base`（L341-349）：按 `ancientAt` 读，期望 `128`。
- `recent historical read after newer base`（L350-358）：按 `recentAt` 读，期望 `256`——这两条专门压 rewindable 历史的重建路径：一个点落在 base 之前、一个落在 base 之后。
- `fork-depth history scan (100)`（L359-372）：最深层 fork 的 `scanEntries(..., 100)`，期望 `100`。
- `fork-depth head lookup`（L373-381）：`findLatestHeadMarker(deepest)`，期望 `ancestorHeadEntryId`（即最初的 `firstEntryId`）——验证 8 层祖先回溯的 head 解析。

写场景不消耗数据集，各自返回写入条数用于校验：

- `commit one entry`，期望 1（L410-431）。
- `commit 100 entries`，期望 100（L432-453）。
- `commit mixed entry/task/submission/document`，期望 4（L454-488）——一条 commit 里塞四种表，压混合写事务。

#### 关键代码

```typescript
// src/testing/storage-benchmark.ts:158-169
	for (let count = 1; count <= REPLAY_TAILS.at(-1)!; count++) {
		await storage.commit(
			replayEntries
				.filter(({ tail }) => count <= tail)      // 只给 tail 还在后面的文档追加
				.map(({ id }) => ({
					type: "document.change" as const,
					id,
					content: { kind: "delta" as const, version: 1, ops: [["s", ["count"], count] as const] },
				})),
			BACKGROUND_CONTEXT,
		);
	}
```

```typescript
// src/testing/storage-benchmark.ts:189-200
	let ancientAt: Seq | undefined;
	for (let count = 1; count <= HISTORY_SEGMENT_LENGTH; count++) {
		ancientAt = await storage.commit(              // 记住「base 之前」的提交号
			[
				{
					type: "document.change",
					id: historicalDocumentId,
					content: { kind: "delta", version: 1, ops: [["s", ["count"], count]] },
				},
			],
			BACKGROUND_CONTEXT,
		);
	}
	await storage.commit(                             // L202-211：写入 base，把前 128 条 delta 折叠
		[
			{
				type: "document.change",
				id: historicalDocumentId,
				content: { kind: "base", version: 1, value: { count: HISTORY_SEGMENT_LENGTH } },
			},
		],
		BACKGROUND_CONTEXT,
	);
```

```typescript
// src/testing/storage-benchmark.ts:454-462（写场景：混合事务）
	{
		name: "commit mixed entry/task/submission/document",
		expected: 4,
		async run(storage) {
			const entryId = await storage.mintId<EntryId>();
			const taskId = await storage.mintId<TaskId<JsonValue>>();
			const submissionId = await storage.mintId<SubmissionId>();
			const documentId = await storage.mintId<DocumentId>();
			// ... 四种写：entry / task / submission / document.create，最后一次 commit 提交
```

#### 不变式与边界

- 所有数据都用 `BACKGROUND_CONTEXT` 提交；数据集**不含**任何后台任务或真实执行（task 记录只是表里的行）。
- `filteredTaskCount` 是算出来的而不是数出来的：`min(50, ceil(taskCount / 60))`（L263）与 `task()` 里 `index % 4 === 0 && index % 5 === 0` 的过滤交集一致——`ceil(taskCount/60)` 对 `1k`(200)/`10k`(2000)/`timing`(300) 三档分别是 4/34/5，都小于 50，所以上界永远取不到，这个 `min` 是防御性的。
- `seedStorageBenchmark` 对三个规模假设有显式失败：`firstEntryId === undefined` 抛 `"Benchmark scale must create entries"`（L227），`exactDocumentId === undefined` 抛 `"Benchmark scale must create documents"`（L260），`ancientAt === undefined` 抛 `"Benchmark history seed produced no commits"`（L212）。所以 `entryCount`、`documentCount` 为 0 的规模不可用。
- 每次调用都会按 `scale` 重新创建数据；调用方要给「每次迭代都是一次真实写入」的场景准备足够多的**独立**存储实例（`test/storage.bench.ts:94-98` 就是为每个写场景预建 25 个 fixture 池）。
- `DocumentCreate` 的 `satisfies`（L178、L952…）保证字段拼写错误在编译期暴露，例如 `history: "rewindable"` 与 `fork: "asOf"` 必须成对出现。

#### 相关测试

- `test/storage.bench.ts`：11 个读场景 × 3 后端 + 3 个写场景 × 3 后端 + 2 个 «reopen and first exact read» 场景，全部先 `strictEqual(run(...), expected(...))` 校验再计时（L58-65、L90-100、L166-170）。
- `test/storage-memory.ts`：`1k`/`10k` 两档 × 3 后端，在子进程里测 heap/RSS/磁盘占用，并用 `storageBenchmarkPrimaryRecordCount` 换算出「JS heap bytes/primary record」（L211-213）。
- `test/harness-output.test.ts:201-249` 的 `Progress` 组（不是基准，但同属「输出量级」的确定性断言）。

### 4.9.6 src/testing/storage-conformance.ts

`src/testing/storage-conformance.ts` 是整套测试基础设施里最重要的一份文件：1583 行，把「一个存储后端要满足的全部语义」拆成 **23 个可执行 case**。文件名里没有 `test`，因为它不是测试而是**契约本体**——`test/memory-storage.test.ts`、`test/sqlite-storage.test.ts`、`test/jsonl-storage.test.ts` 通过 `registerStorageConformance` 把同一份 case 注册到各自的 runner，任何新增后端只要接上 `Storage` 接口，就能用同一套断言证明自己没偷工减料。

#### 导出面

```typescript
// src/testing/storage-conformance.ts:90-91
/** Creates runner-independent cases. `withStorage` must call and await its callback exactly once per case. */
export function createStorageConformance(options: StorageConformanceOptions): readonly StorageConformanceCase[]
```

- 只导出这一个函数：入参是 `{ assertions, withStorage }`（见 4.9.2），返回 23 个 `{ name, run }`。
- 文件内不导出任何类型；所有辅助类型都是私有的：`ConformanceTest = (storage: Storage) => Promise<void>`（L54）、`AssertionResult`（L56-66）、`assertionFacade`（L68-84）、`createCase`（L86-88）。
- 另外两个构造函数也是私有的：`createRoot(storage)`（L27-30，提交根 conversation 并返回 `ROOT_CONVERSATION_ID`）、`pendingTask(id, conversationId, phase = "ready")`（L32-43，造一条 `kind: "test.task"` 的 pending task）、`entry(id, conversationId, kind = "message", extra)`（L45-52）。

私有 `assertionFacade` 是「用例写起来像 Vitest」的关键：它把 6 个抽象断言方法投影成 `toBe`/`toBeDefined`/`toBeGreaterThan`/`toBeUndefined`/`toEqual`/`toHaveLength`/`toMatchObject`/`rejects.toThrow`/`resolves.toBe`（L69-83）。注意 `toHaveLength` 走的是 `strictEqual(actual.length, expected)`（L75），`resolves.toBe` 会先 `await`（L81），`rejects.toThrow` 会 `Promise.resolve(actual)` 再交给 `assertions.rejects`（L78）。

#### 关键流程

```text
createStorageConformance({ assertions, withStorage })
  expect = assertionFacade(assertions)
  cases = [ createCase(options, "<case name>", test_1 … test_23) ]
  createCase(options, name, test) = { name, run: () => options.withStorage(test) }   // L86-88
```

每个 case 的固定形状是：

```text
async (storage) => {
  rootId = await createRoot(storage)        // 除少数用例，几乎每条都先建根会话
  ... 用 storage.commit / storage.mintId 造状态
  expect(...).toEqual/toBe/...              // 正向断言
  await expect(storage.someOp(...)).rejects.toThrow("...")   // 负向断言
}
```

#### 23 个 case 与它们证明的规则

按语义分组（分组是本节为了阅读而加的，case 名与行号是原文）：

**A. 身份与根会话（1 条）**

1. `reserves ID 1 for the immutable root conversation`（L94-101）：`mintId<ConversationId>()` 第一次就必须返回 `2`（ID 1 留给根）；`conversation(1)` 读回 `{ id: 1 }`；再提交一次同 ID 的 conversation 必须以 `"ID 1 already belongs to conversation"` 被拒。这条规则保证「根会话」在任何后端上都是**无需创建**的常量地址。

**B. 事务原子性（5 条）**

2. `commits mixed table writes atomically and rolls all of them back on failure`（L103-163）：一次 commit 里写 entry+task+submission；然后构造一条**必定失败**的 commit（4 条写：task 转 running、submission 转 done、entry、以及重复的 conversation）。断言失败后 `task`、`submission` 仍是旧值、`entry` 不存在（L154-156），并且下一次 commit 的 `Seq` 严格大于之前（L157-161）。这是「要么全成，要么全不成，且提交号仍单调」三件事一起证明。
3. `keeps document lifecycle failures atomic and gives create-plus-retire an empty lifetime`（L1310-1375）：`document.create` 撞上「同一地址已有 current incarnation」时整条 commit 被拒，旧文档不受影响；同一 commit 里 `create + retire` 的文档在 `"current"` 与**那个提交号**上都读不到（L1361-1362），地址查询也为空（L1363-1373）。
4. `rolls back record tables and secondary indexes when a document command fails`（L1377-1451）：失败点是文档命令，但回滚必须覆盖 task 表、submission 表、entry 表以及 `scanTasks`、`submissionByRequest`、`findDocument` 这些**二级索引**视图（L1431-1438）。
5. `keeps one global record ID namespace and rejects exhausted ID minting`（L1555-1573）：手写 ID 100 的 entry 后，`mintId` 必须返回 101（ID 空间全局共享，不是按表分配）；拿 100 去当 TaskId 会被拒（`"ID 100 already belongs to entry"`）；写入 `Number.MAX_SAFE_INTEGER` 后连续两次 `mintId` 都抛 `"ID space is exhausted"`（L1571-1572，断言两次是为了证明错误不会「先成功一次」）。
6. `rejects every operation after close`（L1575-1581）：`close` 之后 `conversation`、`commit([])`（空写也拒绝）、`mintId` 全部抛含 `"closed"` 的错误。

**C. 值隔离 / detach（2 条）**

7. `detaches retained writes and every returned record`（L165-220）：写入后修改调用方对象（`entryData.nested.push(3)` 等），读回必须是原值；再修改**读出来的**对象，下一次读仍是原值。覆盖 entry.data、task.state.checkpoint、submission.detail 三处嵌套结构。
8. `detaches prototype-like JSON keys without changing object prototypes`（L222-245）：数据里带 `__proto__`、`constructor`、`toString` 三个键，读回后 `Object.getPrototypeOf(firstRead) === Object.prototype`、`Object.hasOwn(firstRead, "__proto__")` 为真、`({}).polluted` 仍为 `undefined`（L233-238）。这条防的是后端用 `JSON.parse` 直接赋值或 `Object.assign` 时把 `__proto__` 变成原型污染。

**D. 顺序、游标与分页（5 条）**

9. `indexes entries committed out of ID order`（L247-267）：同一 commit 里写 ID 30、10 和一条 head=10 的 marker 20，`scanEntries` 必须按**ID 降序**返回 `[30,20,10]`，`findLatestHeadMarker` 返回 20——扫描顺序由 ID 决定，而不是提交顺序。
10. `continues an entry cursor below its last item after a newer commit`（L269-290）：读到一半后新提交一条 entry，用旧游标继续翻页只能看到更旧的那条（`[oldestId]`）且 `next` 为 `undefined`（L287-289）。这就是「游标是位置而不是快照」的语义：新数据不插队。
11. `paginates conversations by opaque cursor in ascending ID order`（L292-311）：conversation 扫描按 ID **升序**（与 entry 相反），并且游标要能 `JSON.parse(JSON.stringify(...))` 往返（L307），即游标必须可序列化。
12. `filters and pages conversations by durable owner edges`（L313-361）：`{ ownerConversationId }`、`{ ownerTaskId }`、两者组合三种过滤各自只返回匹配的 conversation，分页仍按 ID 升序。
13. `scans deep fork history newest-first through every ancestor cap`（L363-500）：三层 fork 链上翻页必须按「孙→子→父」交叉拼接出 `[grandchildTail, grandchildHead] → [childForkPoint, rootForkPoint] → [rootFirst]`（L425-431），同时证明 ancestor cap（`maxEntryId`）与 `minEntryId` 的半开区间语义（L458-471），以及 `entry(conversationId, entryId)` 的历史可见性（L482-493）。

**E. Task 表（2 条）**

14. `replaces complete task records and pages filtered task scans`（L502-551）：task 更新是**整条替换**（`running` 之后提交 `terminal`，中间 `memos` 之类的字段会消失），`scanTasks` 支持 `status`/`background`/`abortRequested` 过滤并分页。
15. `stores owners and scans waiting and completing tasks by status`（L553-587）：`waiting`（带 `on`/`policy`）与 `completing`（带 held outcome）能被原样存回，`owner` 字段保留；状态改变后旧状态的扫描里不再出现该任务（L585-586）。

**F. Submission 表（2 条）**

16. `indexes request IDs per conversation and replaces complete submission records`（L589-663）：`requestId` 唯一性作用域是**会话内**——两个会话可以有同一个 `"same"`（L628-629）；`scanSubmissions` 支持 `conversationId`/`status` 过滤，并且状态变化会让记录在两个状态扫描之间「搬家」（L652-658）。
17. `stores passive write submissions without input-only lifecycle states`（L665-713）：`type: "write"` 的 submission 只走 `queued → done / unanswered`，可以直接落成 `done`＋`entry`，也可以用 `unanswered + reason + detail`，两种都按记录整条替换。

**G. Document：基准 + 增量 + 历史（6 条）**

18. `reconstructs rewindable documents and preserves half-open incarnations`（L715-836）：base+delta 重建出 `{items:["a","b"], nested:{count:2}}` 且 `deltasSinceBase === 1`（L753-755）；写入 `version:2` 的 base 后，**旧提交号**（`changedAt`）仍读到旧版本 1（L786-789）；同一条 delta 被重复 `commit` 两次是幂等的（`deltasSinceBase` 仍为 1，L795-799）；`document.retire` 后同一地址的新 incarnation 从**退役提交号**那一刻起对地址查询可见（L818-835），而已退役的 id 读出来是 `undefined`。
19. `streams long document tails across root replacement deltas`（L838-929）：512 行结构上做 24 次字段级 delta、再整根替换（`["r", ...]`）、再来 24 次 delta；四个时间点（创建、替换前、替换点、current）各自读到对应值（L922-928）。这条专压 Chord delta 的区间重建与 root replacement 的边界。
20. `copies stored document bases independently and rejects ambiguous sources`（L931-1129）：`document.copy` 复制的是**存储里的值**而不是引用——源文档随后被整根替换甚至退役，副本仍是旧值（L1032-1035）；`history:"latest"` 的源复制后同样独立（L1081-1084）。负例：copy 与 retire 同一目标、copy 的 `kind` 与源不一致，都必须以 `StorageRejected` 失败且不留下半成品（L1086-1127）。
21. `uses bases for version transitions and rejects historical reads of current-only documents`（L1131-1169）：`version` 从 1 升到 2 必须用 base（delta 会以 `"version transition requires a base"` 被拒，L1159-1164）；非 rewindable（无 `history` 声明）的文档读历史点要抛 `"does not retain historical content"`（L1155-1157）；退役后 `"current"` 读不到。
22. `indexes logical addresses and exact-scope scans independently`（L1171-1308）：地址（`kind+scope+key`）唯一性在 session/conversation/task 三种 scope 上各自成立；`key: "__proto__"` 与 `key: "constructor"` 这种危险字符串也是合法地址（L1194-1255）；`scanDocuments` 的 scope 精确匹配（session 扫描不会带出 conversation 文档，L1272-1281）；task scope 下「无 key 的单例」与「有 key 的家族成员」是不同地址（L1283-1294）。
23. `keeps indexed string identities lossless`（L1453-1553）：用两个**孤立代理项** `"\ud800"`、`"\ud801"` 作为 task kind、requestId、document kind、document key，四种索引都必须把它们当作不同字符串（L1513-1542）。这条件专打「把字符串当 UTF-8 规范化后再比较」或「用 lone surrogate 当分隔符拼接键」的实现。

另外还有两条也属于 document 组但在上面按编号已并入 B 组（第 3、4 条），它们分别覆盖 lifecycle 原子性与索引回滚。

**H. 未被覆盖的两类语义（重要）**

任务书里提到的「并发/串行化」与「崩溃可重入」**不在**这 23 个 case 里：`storage-conformance.ts` 全文没有 `Promise.all` 并发提交、没有制造错误注入或 reopen 的辅助函数（`createRoot`/`pendingTask`/`entry` 之外只有 `assertionFacade`/`createCase`）。这两类语义在仓库里由别的测试承担：

- 串行化：`test/sqlite-facade.test.ts:124`（`serializes concurrent transactions`）、`:159`（按调用顺序）、`:187`（普通操作排在活跃事务之后）、`:347`（`reads a document from one committed state while a commit replaces its base`）。
- 崩溃/重入：`test/jsonl-storage.test.ts:390`（删除「完整但撕裂」的未确认 sidecar 追加）、`:458`/`:502`（在指定 append/flush 次数注入失败后只恢复已确认状态）、`:978`（按精确字节偏移截断撕裂的 UTF-8 尾）、`:1060`（确认记录出现在未确认记录之后要拒绝）；`test/sqlite-migrations.test.ts:60`（bootstrap 与迁移一起回滚）。

因此：**接入自定义后端时，23 个 case 是下限而不是全部**；`[待核]: storage-conformance.ts 未覆盖并发与崩溃可重入，若要在自定义后端上证明这两类语义，需另写后端特化测试（参照 sqlite-facade / jsonl-storage 的做法）。**

#### 自定义后端如何接入

接入点只有三步：

```text
1. 让后端实现 Storage 接口（src/types.ts）
2. import { registerStorageConformance } from "@earendil-works/pi-durable/testing"
3. registerStorageConformance({ describe, expect, it }, "<名字>", async (use) => { ... await use(storage) ... })
```

`registerStorageConformance` 的签名与语义（`src/testing/runner.ts:12-23`）：

```typescript
export function registerStorageConformance(
	runner: StorageConformanceRunner,          // 提供 describe / it / expect 三个函数
	name: string,                              // suite 名，例如 "SqliteStorage"
	withStorage: StorageConformanceProvider,   // (use) => Promise<void>，必须恰好 await use 一次
): void
```

`withStorage` 里要自己负责创建与清理。仓库里的三种写法可以直接照抄：

```typescript
// test/memory-storage.test.ts:8 —— 最简单的写法：一条 case 一个新实例
registerStorageConformance({ describe, expect, it }, "MemoryStorage", (use) => use(new MemoryStorage()));
```

```typescript
// test/sqlite-storage.test.ts:113-129 —— 常规写法 + 每次提交后重开存储的加固写法
registerStorageConformance({ describe, expect, it }, "SqliteStorage", async (use) =>
	use((await createSqliteStorage()).storage),
);

registerStorageConformance({ describe, expect, it }, "SqliteStorage across reopen", async (use) => {
	const directory = await mkdtemp(join(tmpdir(), "pi-durable-sqlite-conformance-"));
	const path = join(directory, "storage.sqlite");
	const created = await openNodeSqliteStorage(path);
	await created.close(context);
	const storage = new ReopeningStorage(await openNodeSqliteStorage(path), path);   // 每次 commit 后 close + reopen
	try {
		await use(storage);
	} finally {
		await storage.close(context);
		await rm(directory, { recursive: true, force: true });
	}
});
```

`ReopeningStorage` 是测试文件里定义的包装器（`test/jsonl-storage.test.ts:69-77` 展示了它的 `commit`）：先转发提交，然后在 `finally` 里 `close` 再重新 `open`，并且**关闭后不再重开**（`if (this.closed) return this.current.commit(...)`，L70）。这样一来 23 个 case 会在「每次写都经历一次真正的打开/关闭」的条件下重跑一遍——同一份断言，两种持久化生命周期。

```typescript
// test/jsonl-storage.test.ts:123-134 —— 目录式后端的写法
registerStorageConformance({ describe, expect, it }, "JsonlStorage", async (use) => use(await createStorage()));

registerStorageConformance({ describe, expect, it }, "JsonlStorage across reopen", async (use) => {
	const directory = await tempDirectory("pi-durable-jsonl-conformance-");
	const current = await JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context);
	const storage = new ReopeningStorage(current, directory);
	try {
		await use(storage);
	} finally {
		await storage.close(context);
	}
});
```

接入检查清单（每条都能在 23 个 case 里找到对应失败）：

| 想验证的语义 | 对应 case（行号） |
| --- | --- |
| 根会话常量与 ID 空间 | L94、L1555 |
| 多表事务的原子回滚 | L103、L1310、L1377 |
| 值与 JSON 结构的隔离（含 `__proto__`） | L165、L222 |
| 扫描顺序、游标语义与祖先合并 | L247、L269、L292、L313、L363 |
| task/submission 的整条替换与过滤索引 | L502、L553、L589、L665 |
| document 的 base/delta 重建、历史点、拷贝独立、地址索引 | L715、L838、L931、L1131、L1171、L1453 |
| close 之后全部拒绝 | L1575 |

#### 关键代码

```typescript
// src/testing/storage-conformance.ts:103-163（截取：一次「必定失败」的混合事务）
		createCase(
			options,
			"commits mixed table writes atomically and rolls all of them back on failure",
			async (storage) => {
				const rootId = await createRoot(storage);
				const entryId = await storage.mintId<EntryId>();
				const taskId = await storage.mintId<TaskId<JsonValue>>();
				const submissionId = await storage.mintId<SubmissionId>();
				const input: SubmissionRecord = {              // 先记下成功写入的期望值
					id: submissionId,
					conversationId: rootId,
					requestId: "request-1",
					type: "input",
					status: "placed",
					entry: entryId,
				};
				const initialSeq = await storage.commit(
					[
						{ type: "entry", value: entry(entryId, rootId, "user", { data: { text: "hello" } }) },
						{ type: "task", value: task },
						{ type: "submission", value: input },
					],
					context,
				);
				// ...（L129-140 校验读回值，并准备 transientEntryId / runningTask / doneInput）
				const transientEntryId = await storage.mintId<EntryId>();
				await expect(
					storage.commit(
						[
							{ type: "task", value: runningTask },
							{ type: "submission", value: doneInput },
							{ type: "entry", value: entry(transientEntryId, rootId, "assistant") },
							{ type: "conversation", value: { id: rootId } },   // 冲突点：根会话重复创建
						],
						context,
					),
				).rejects.toThrow(`ID ${rootId} already belongs to conversation`);

				expect(await storage.task(taskId, context)).toEqual(task);          // 前三张表都回到旧值
				expect(await storage.submission(submissionId, context)).toEqual(input);
				expect(await storage.entry(transientEntryId, context)).toBeUndefined();
				const afterRollbackSeq = await storage.commit(                      // 回滚不消耗失败之外的东西
					[{ type: "entry", value: entry(await storage.mintId<EntryId>(), rootId, "after-rollback") }],
					context,
				);
				expect(afterRollbackSeq).toBeGreaterThan(initialSeq);
			},
		),
```

```typescript
// src/testing/storage-conformance.ts:222-245（原型污染专项）
		createCase(options, "detaches prototype-like JSON keys without changing object prototypes", async (storage) => {
			const rootId = await createRoot(storage);
			const entryId = await storage.mintId<EntryId>();
			const data = JSON.parse(
				'{"__proto__":{"polluted":false},"constructor":{"label":"stored"},"toString":"value"}',
			) as Record<string, JsonValue>;
			await storage.commit([{ type: "entry", value: entry(entryId, rootId, "note", { data }) }], context);

			(Reflect.get(data, "__proto__") as Record<string, JsonValue>).polluted = true;
			(Reflect.get(data, "constructor") as Record<string, JsonValue>).label = "mutated";
			const firstRead = (await storage.entry(entryId, context))!.entry.data as Record<string, JsonValue>;
			expect(Object.getPrototypeOf(firstRead)).toBe(Object.prototype);   // 读回来的对象原型没被改
			expect(Object.hasOwn(firstRead, "__proto__")).toBe(true);          // __proto__ 是普通自有属性
			expect(Reflect.get(firstRead, "__proto__")).toEqual({ polluted: false });
			expect(({} as { polluted?: boolean }).polluted).toBeUndefined();   // 全局没被污染
```

```typescript
// src/testing/storage-conformance.ts:715-755（截取：base+delta 重建与"提交点"读）
		createCase(options, "reconstructs rewindable documents and preserves half-open incarnations", async (storage) => {
			// ... 文档声明 history: "rewindable" / fork: "asOf"
			const createdAt = await storage.commit(
				[{ type: "document.create", record: firstRecord, content: { kind: "base", version: 1, value: initial } }],
				context,
			);
			const ops: Op[] = [
				["p", ["items"], 1, 0, appended],              // 追加一个元素
				["s", ["nested", "count"], 2],                 // 改一个字段
			];
			const changedAt = await storage.commit(
				[{ type: "document.change", id: firstId, content: { kind: "delta", version: 1, ops } }],
				context,
			);
			(initial.items as string[]).push("caller mutation");   // 调用方事后改对象，不应影响存储
			expect(await storage.document(firstId, createdAt, context)).toMatchObject({
				version: 1,
				value: { items: ["a"], nested: { count: 1 } },
				deltasSinceBase: 0,
			});
			const changed = (await storage.document(firstId, changedAt, context))!;
			expect(changed.value).toEqual({ items: ["a", "b"], nested: { count: 2 } });
			expect(changed.deltasSinceBase).toBe(1);           // 从最新 base 起累计的 delta 条数
```

#### 不变式与边界

- `withStorage` 必须**每个 case 调用并 await `use` 恰好一次**（L90 注释）；调用两次会让断言跑在同一个存储上互相污染，不 await 则断言不会被 runner 观察到。
- 契约用例全部通过 `storage.mintId` 取 ID、通过 `storage.commit` 写数据，**只使用公共 `Storage` 接口**；唯一从内部导入的是 `idFromNumber`（`src/ids.ts`，L4），用来表达「显式 ID」和「越界 ID」。
- 所有 case 都用 `BACKGROUND_CONTEXT`（L24）作为调用上下文；因此后端不能依赖前台/后台的语义差异。
- 负向断言依赖**错误消息子串**：`"Unknown conversation"`（L494-499）、`"closed"`（L1578-1580）、`"does not retain historical content"`（L1155、L1305）、`"version transition requires a base"`（L1164）、`"already has a current incarnation"`（L1338、L1429）、`"ID ... already belongs to ..."`（L100、L1565）、`"ID space is exhausted"`（L1571-1572）。实现后端时这些文案是契约的一部分。
- `StorageRejected` 这个**错误类型名**也是契约：L1103 与 L1126 断言 `(error as Error).name === "StorageRejected"`（而不是消息子串），用于「拷贝冲突」和「拷贝 kind 不一致」两种拒绝。
- 未覆盖：并发/串行化、崩溃中途与 reopen 重入（见上文 H 组），以及性能量级——性能与内存量级分别由 `test/storage.bench.ts`、`test/storage-memory.ts`、`test/sqlite-storage.test.ts:567-616` 承担。
- 23 个 case 的名字会原样成为测试名，改动 case 名等于改动所有后端的测试报告，属于破坏性变更。

#### 相关测试

- `test/memory-storage.test.ts:8`：`MemoryStorage` 注册一次；同文件 `:10-32` 另有一条 **不进契约** 的断言——`storage.prepareCommit` 返回的 `writes[0].value` 是冻结/受保护对象，往 `data.nested` 里 push 会抛错（L27），并且 `prepared.apply()` 重复调用返回同一个 `Seq`（L29-30）。契约套件刻意不要求 `prepareCommit` 存在（它不在 `Storage` 接口的公共用法里）。
- `test/sqlite-storage.test.ts:113,117`：`SqliteStorage` 与 `SqliteStorage across reopen`（每次提交后 close+reopen 的包装器）。
- `test/jsonl-storage.test.ts:123,125`：`JsonlStorage` 与 `JsonlStorage across reopen`。
- `test/storage-runtime-boundary.test.ts:26-47`：保证 portable 子路径（包根、`storage/sqlite`、`env`、`storage/jsonl`）的源码图里不出现 `node:`，即这些后端能在无 Node 内置模块的运行时里加载——这是「同一份契约能跑在三种后端上」的前提。

---


# 第 5 部分：示例逐题精讲

32 个可运行示例逐个精讲。每个示例：它演示什么 → 运行 → 关键代码 → 逐点解释 → 实测输出 → 动手改 → 对应源码/测试。

## 5.1 怎么读这些示例

32 个示例全部是可独立运行的脚本，位于 `test/examples/`。每个示例的讲解按固定节奏展开：

```text
它演示什么 → 运行命令 → 关键代码（带中文注释）→ 逐点解释 → 你会看到（真实输出）→ 动手改 → 对应源码/测试
```

### 5.1.1 运行

```bash
cd packages/durable
node --conditions=source --experimental-strip-types test/examples/14-chat.ts
```

全部跑一遍（bash）：

```bash
for f in test/examples/*.ts; do echo "== $f"; node --conditions=source --experimental-strip-types "$f"; done
```

PowerShell：

```powershell
cd packages\durable
Get-ChildItem test\examples\*.ts | ForEach-Object {
  Write-Host "== $($_.Name)"
  node --conditions=source --experimental-strip-types $_.FullName
}
```

### 5.1.2 三个预期内的「噪音」

1. 每个脚本开头有 `ExperimentalWarning: Type Stripping`（用 SQLite 时多一行 `ExperimentalWarning: SQLite`）。
2. `16-real-model` 没设 `OPENAI_API_KEY` 时会打印 `skipped: OPENAI_API_KEY is not set`。
3. **本机没有 Git Bash 时**，`17`、`19`、`26`、`30` 里的 `bash` 工具会返回 `No bash shell found` 的工具错误（示例仍退出 0）。这不是示例的缺陷，而是环境差异——第 8.3.1 节列了两处需要 Git Bash 才能观察的点。

### 5.1.3 建议的读法

1. **先跑再看**：不看输出读代码，容易把「我以为它会做什么」当成事实。
2. **看转录**：很多示例最后打印 `transcript`（entry 的 kind 序列）。那是理解「这一轮到底写了什么」最快的方式。
3. **动手改**：每个示例末尾的「动手改」是刻意设计的破坏性实验（去掉 `requestId`、把 `replay` 改成 unsafe、删掉 `memo`……）。**改坏再改回来**的过程比读十遍设计文档更有效。
4. **对照源码**：每个示例都给出相关源文件与测试。想看某条规则的边界条件，去测试文件里找反例。

### 5.1.4 三组之外还有两个「成品形态」

`18-print`（像 `pi -p "问题"`）与 `19-json`（像 `pi --mode json`）不是教学示例，而是「同一套 API 怎么变成两种产品形态」的示范：前者只等自己的 Submission，后者把每个 agent 事件打成一行 JSON。`22`–`31` 则是产品级构造的参考实现。

### 5.1.5 附：把 README 的 Quick Start 逐行拆开

README 的 Quick Start 是大多数人读的第一段代码。它是示例 `14-chat.ts` 的真实模型版，逐行拆开如下：

```typescript
const models = createModels();
models.setProvider(openaiProvider());                    // ① 模型访问（读 OPENAI_API_KEY）

const harness = await Harness.open(                      // ② 打开 Harness
	new MemoryStorage(), { models, registry: createRegistry() }, context);

const root = await harness.root(context, {               // ③ 根会话（首次创建）
	agent: { model: { provider: "openai", modelId: "gpt-6-sol" } },
});

const submission = await root.submit(                    // ④ 提交输入（先落盘）
	{ type: "input", content: "What is the capital of France?" }, context);

const settled = await submission.wait(context);          // ⑤ 等答案（这一步才启动调度）
if (settled.status === "done" && settled.type === "input") {
	const answer = await root.commit(                     // ⑥ 从转录里取答案
		(tx) => tx.entry(AssistantEntry, settled.answer), context);
	console.log(answer?.model?.[0]);
}
await harness.close(context);                            // ⑦ 收尾
```

1. **① 模型访问**：`createModels()` 是 pi-ai 的模型管理器；`setProvider()` 按 provider id 注册。示例里这一行通常换成 faux（`models.setProvider(faux.provider)`）。
2. **② 打开 Harness**：三个参数是存储、选项（`models` 必给，`registry` 装扩展）、context。从这里开始一切变更走同一条提交线；调度器处于 paused。
3. **③ 根会话**：`root()` 第一次调用时**创建**它（连同内建文档与 agent 配置，一笔提交）；之后的调用（包括重启后）直接返回现有根会话并**忽略** `agent`。想改配置用 `configure()`。
4. **④ 提交输入**：`submit()` 返回时输入已作为 `pi.user` entry 落盘。`submit()` 本身**不等模型**，只做准入。
5. **⑤ 等答案**：`wait()` 是「要求进展」的调用之一——调度在这里被启动。它解析为 `done`（带答案 entry id）或 `unanswered`（带 reason）。
6. **⑥ 取答案**：拿到的是 entry **id**，要用 `commit((tx) => tx.entry(AssistantEntry, id))` 从存储读出完整 entry。读数据也走提交（线内一致读）。
7. **⑦ 收尾**：`close()` 会先 join 任务调用、结算已准入的提交，再关存储。

这一轮背后发生的所有提交点，见第 1.5 节的时间线；每个 phase 的细节见第 3.2 节。

---

---

## 5.2 A 组：Session 底层（00–05）

A 组六个示例只用一个 `Session` 加一个 `Storage`：不起 Harness、不调用模型、不安装扩展。它们把 Session 的写入单元（`commit`）、文档（Document）、分叉（fork）、所有权（ownership）与两种观察通道（Chord state、watch）逐个拆开。读这一组时把「谁在什么时候把什么写进了存储」当主线：5.3 开始的 Harness 行为，全部建立在这些写入之上。概念对照见 2.2 节（Session）、2.3 节（Tx）、2.5 节（Document）、2.17 节（View 与 Watch）。

**关于下面所有实测输出**：来自本机真实运行（`node v23.9.0` / Windows，命令见每节的「运行」）。输出里的**实体 id**（`id: 2`、任务 3、会话 4 之类）与**毫秒时间戳**随每次运行变化，摘录时保留当次运行的原始值；除这两类字段外，同一示例重复运行逐字一致（两轮比对确认，差异只出现在 17、19 两例的时间戳与随机目录名上，不涉及本组）。想复现时请忽略 id 的具体数值，只看它们的相对关系。

**关于「关键代码」块**：块首标注的行号范围是该段代码在示例文件中的真实位置（用 read 工具核对过）。块内的中文注释为本手册所加；为了控制篇幅，摘录时删减了原文的英文注释并保留全部代码行——**没有任何一行代码被改写或重排**，省略处会写 `// ...` 说明。

### 5.2.1 00-conversation.ts —— 一次 commit 建一个会话

**它演示什么**：Session 的写入只有一个入口：`session.commit(callback, context)`。回调收到一个事务 `tx`，回调返回时整批落盘，抛错则整批丢弃。本例用最小的一步——创建一个「无主」（不属于任何任务）的会话——把这条规则跑通；`MemoryStorage` 意味着进程退出后什么都不剩。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/00-conversation.ts
```

**关键代码**（`test/examples/00-conversation.ts:4-21`，注释为本手册所加，代码行原样）：

```typescript
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, MemoryStorage } from "../../src/index.ts";

// 全部状态放在内存里；换成 SQLite / JSONL 存储后下面的代码不变（见 13）
const session = createSession(new MemoryStorage());

// 每个 Session 调用都要一个 Context，用途是取消；BACKGROUND_CONTEXT 表示永不取消
const context = BACKGROUND_CONTEXT;

// ... 原文注释：所有写入都发生在 session.commit() 里，回调拿到事务 tx
// 回调返回时整批保存，抛错则整批丢弃。"ownerless" 表示没有任务创建这个会话。
const standalone = await session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context);
console.log("standalone conversation:", standalone);

await session.close(context);
```

**逐点解释**：

1. `createSession(storage)` 把「持久化介质」和「运行时」分开：Session 本身不知道数据存在哪，全部通过 Storage 接口（见 2.1 节）。
2. `commit` 的回调返回什么，`commit` 就解析成什么：这里返回的是刚创建的会话记录，所以 `standalone` 上直接有 `id`。回调可以是 async（01 就在里面写了两样东西）。
3. `ownership: { kind: "ownerless" }` 是会话的归属声明。三种归属（无主 / 属于会话 / 属于任务）在 03 与 12 用到，完整语义见 2.7 节。
4. `BACKGROUND_CONTEXT` 适合脚本与后台工作：它不会被取消，所以不需要处理取消分支。
5. `await session.close(context)` 之后 Session 不再接受调用（见 2.2 节）。示例顺序固定为「先 commit 再 close」，就是为了不踩这个边界。

**你会看到**（实测输出，原样引用）：

```text
standalone conversation: { id: 2 }
```

6. `id: 2` 不是笔误：会话、任务、entry 的 id 来自同一套单调分配，Harness 的 root 会话固定占 1（见 5.3.1）。**不要**把它当作「从 0 或 1 开始的局部计数」，也不要依赖具体数值，只依赖「新 id 大于旧 id」。

**动手改**：

1. 把 `MemoryStorage` 换成 SQLite 存储（写法照抄 13），连续运行两次：第二次会看到 id 继续变大而不是重新回到 2，因为计数器存在存储里。这是理解「id 由存储分配」最快的方式。
2. 在 commit 回调里 `throw new Error("boom")`：进程以异常结束，且什么都没写进去（整批丢弃）。对照 `test/session-documents.test.ts:228`「回调失败时撤销全部改动」。
3. 把 owner 改成 `{ kind: "task", taskId: 999 }` 指向不存在的任务：提交被拒绝，Session 保持可用。`test/session-tables.test.ts:213` 断言了「缺失 / 已终止 / 已标记中止的会话 owner 被原子拒绝」。

**边界与易错点**：

- **同一事务里先读后写**。`test/session-tables.test.ts:82` 的断言是「表读取只允许发生在第一次表写入之前」，所以「先扫一批、再写一批」必须分成两个 commit（02 里的 `scanEntries` 都单独提交，就是这条规则的形状）。
- **回调抛错是整批丢弃**，不是部分成功。想亲手验证，就在写完两样东西之后抛错，再重新打开存储数一数。
- **`close` 是硬边界**：之后再调用 Session 会被拒绝；示例把 `close` 留在最后一行是纪律（对照 `test/harness-conversations.test.ts:442` 对句柄的同类约束）。
- **`MemoryStorage` 只适合演示与测试**：它无法验证任何恢复行为（13 换 SQLite 才有意义），也不代表存储侧的性能特征。
- **不要给 id 赋予业务含义**：它单调递增、全局唯一，但起点与跨类型关系（2 → 3 → 4）只是可观察现象，不是契约。

**和后面的示例怎么接**：

- 01 在同一份「commit + tx」形状上加第二样东西（文档），02 加第三样（分叉）；00 是这条主线的起点。
- 03 把「一个 commit 建多个实体」用到极致（任务 + 会话 + 文档）；12 再把这样的任务真正跑起来。
- 想看「同样的代码换存储」的效果，13 是现成模板（SQLite + 多次 open/close）。

**再读一遍输出，容易漏看的两处**：

- 输出没有时间戳、路径、版本号——`MemoryStorage` 的会话是纯对象，唯一外部可见量是 id。**输出越少说明副作用越少**，这在 A 组是好用的判据。
- `{ id: 2 }` 的行内格式来自 Node 对对象的打印；字段更多时会展开成多行（03 的 registry 就是）。别把「单行 / 多行」当成两种不同的 API 行为。

**再练两个实验**：

- 把 `console.log(standalone)` 换成 `console.log(JSON.stringify(standalone))`：看到记录的真实字段（`id`，以及有主会话时的 `owner`）——ownerless 会话没有 `owner` 字段。
- 连续创建 3 个会话并打印它们的 id：看到的是 2、3、4（单调但会被任务 / entry 插队，所以不要按步长 1 推断下一个值）。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `createSession(storage)` | 建 Session；存储决定数据留在哪 | `src/session/session.ts` |
| `session.commit(callback, context)` | 唯一写入入口，返回值就是提交结果 | `src/session/session.ts` |
| `tx.createConversation({ ownership })` | 建会话并声明归属 | `src/session/transaction.ts` |
| `session.close(context)` | 收尾并停止接受调用 | `src/session/session.ts` |
| `BACKGROUND_CONTEXT` | 永不取消的上下文 | `@earendil-works/chord/context` |

**对应源码/测试**：`src/session/session.ts`（`createSession`、`close` 与文档读 API）、`src/session/transaction.ts`（`tx.createConversation` / `appendEntry` / `createTask` 的表写入）、`src/types.ts`（记录与 Ownership 类型）、`test/session-tables.test.ts:132`（「creates conversations, entries, and tasks with minted IDs」——id 分配）、`test/session-tables.test.ts:213`（非法 owner 的拒绝）、`test/harness-conversations.test.ts:72`（root 会话连内置文档、agent 与 init 一起在一个 commit 里创建）。

### 5.2.2 01-documents.ts —— 文档与 entry 同批提交，按 entry 回看

**它演示什么**：给一个会话挂结构化状态（这里是一份 Notes），并演示两种读法：`snapshot()` 读最新值，`snapshotAsOf()` 读「某条 entry 提交时」的值。后者依赖 `history: "rewindable"`；它同时也是 02 里 fork 取值的依据。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/01-documents.ts
```

**关键代码**（`test/examples/01-documents.ts:14-43`）：

```typescript
const Notes = defineDoc<{ text: string }>({
	kind: "example.notes",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ text: "" }),
});

// ... 第 23 行先创建 chat 会话
const firstEntry = await session.commit(async (tx) => {
	const entry = await tx.appendEntry(chat.id, { kind: "note", data: "hello" });
	(await tx.doc(Notes, chat.id)).text = "after hello";
	return entry;
}, context);

const secondEntry = await session.commit(async (tx) => {
	const entry = await tx.appendEntry(chat.id, { kind: "note", data: "goodbye" });
	(await tx.doc(Notes, chat.id)).text = "after goodbye";
	return entry;
}, context);

console.log("latest notes:", await session.snapshot(Notes, chat.id, context));
console.log("notes at first entry:", await session.snapshotAsOf(Notes, chat.id, firstEntry.id, context));
console.log("notes at second entry:", await session.snapshotAsOf(Notes, chat.id, secondEntry.id, context));
```

**逐点解释**：

1. `defineDoc` 声明文档的地址与策略：`kind` 是全局唯一的命名空间，`scope: "conversation"` 表示每个会话一份，`version` 参与存储里的版本校验，`initial` 只在首次创建时被调用一次（`test/session-documents.test.ts:78`）。
2. `history: "rewindable"` 保留历史修订，所以同一个文档能回答「第一条 entry 提交那一刻它是什么」。改成 `"latest"` 只留当前值（03、29 用它）。
3. 每个 commit 里 `appendEntry`（写转录）与 `tx.doc(...)`（改文档）是同一批：要么都落盘、要么都不落。`tx.doc()` 第一次访问就创建文档，初值来自 `initial`——不需要预先初始化。
4. `snapshot()` 是最新值；`snapshotAsOf(token, conversationId, entryId, context)` 是「与那条 entry 同批提交时」的值。它要求 conversation 作用域 + 合法 entry id，否则抛 `TypeError`（`src/session/session.ts:316-330`）。
5. 三行输出正好构成时间线：`latest` 是最后写入的值，两个 `asOf` 分别回到各自那次提交。注意第一次 `asOf` 读到的是 `after hello`——即「第一条 entry 的提交里文档被写成什么」，而不是文档初始值。
6. `fork: "asOf"` 在本例没参与，但决定了 02 中分叉副本的起点：分叉 entry 那个时刻的值。

**你会看到**（实测输出，原样引用）：

```text
latest notes: { text: 'after goodbye' }
notes at first entry: { text: 'after hello' }
notes at second entry: { text: 'after goodbye' }
```

**动手改**：

1. 把 `history: "rewindable"` 改成 `"latest"` 再跑：`notes at first entry` 会变成 `after goodbye`（与 `latest` 相同）——历史不再保留，`snapshotAsOf` 只能给你当前修订。
2. 在第二个 commit 里把文档草稿带出回调之外再改（例如 `const notes = await tx.doc(Notes, chat.id)` 存到外部变量，commit 结束后再改 `notes.text`）：改动不会被保存，而且这样的草稿在回调结束后会被吊销（`test/session-documents.test.ts:207`）。
3. 把 `initial: () => ({ text: "" })` 改成 `() => ({ text: "seeded" })`：已经存在的文档不会重新初始化（仍读到 `after ...`）；只有在「首次创建」的路径上能看到 `seeded`。

**边界与易错点**：

- **`tx.doc()` 是草稿，不是句柄**：赋值立刻反映在草稿上，落盘发生在 commit 结束；把草稿带出回调继续使用会被吊销（`test/session-documents.test.ts:207`）。
- **`snapshotAsOf` 有前置条件**：只支持 conversation 作用域文档 + 合法 entry id，其它组合抛 `TypeError`（`src/session/session.ts:316-330`）。
- **`rewindable` 要付存储代价**：每个修订都被保留，只为「回看」买单；不需要历史就写 `latest`（03、29 就是这么做的）。
- **`initial` 只跑一次**：它是「首次创建」的初值，不是「读不到就兜底」的默认值。
- **改 `version` 是改契约**：版本字段参与存储记录校验；升级文档形状前先想清楚已有数据怎么处理，别把它当注释。

**和后面的示例怎么接**：

- 02 的 fork 取值完全由本节的 `history` 与 `fork` 两个字段决定；02 只是换了起点。
- 03 与 29 的文档用 `history: "latest"`：不需要回看时就不付历史的存储成本。
- 11 把文档当成扩展状态：同一个 `defineDoc` + `snapshot` 组合，只是写入方从脚本变成工具。

**再读一遍输出，容易漏看的两处**：

- 三个值里有**两个**来自同一份文档：说明文档不是「一行记录」，而是带修订的时间线；读法不同，切片就不同。
- `latest notes` 与 `notes at second entry` 相同，是因为第二次提交之后没有再改文档——别把它误读成「asOf 退化成 snapshot」。再写一次文档，两者立刻分叉。

**再练两个实验**：

- 追加第三次提交（只改文档、不写 entry）：`latest` 变而两个 `asOf` 不变——as-of 锚在 entry 上，不锚在「最后一次写文档」。
- 打印 `JSON.stringify(await session.snapshot(Notes, chat.id, context))`：看到的就是存储里的值本身（不是草稿、不是代理），可以和 `tx.doc()` 的草稿对照着改。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `defineDoc({ kind, version, scope, history, fork, initial })` | 声明文档的地址与策略 | `src/documents.ts:39` |
| `tx.appendEntry(conversationId, { kind, data })` | 写一条 entry（`data` 只给应用） | `src/session/transaction.ts` |
| `tx.doc(token, conversationId)` | 取可写草稿，首次访问即创建 | `src/session/transaction.ts` |
| `session.snapshot(token, id, context)` | 读最新值，不创建 | `src/session/session.ts:162` |
| `session.snapshotAsOf(token, id, entryId, context)` | 读与该 entry 同批提交时的值 | `src/session/session.ts:316` |

**对应源码/测试**：`src/documents.ts:39-54`（`defineDoc` 的重载）、`src/session/session.ts:162-179`（`snapshot` 只读、不管创建）、`src/session/session.ts:316-330`（`snapshotAsOf` 的前置条件）、`test/session-documents.test.ts:120`（返回共享的不可变快照、旧修订保持稳定）、`test/session-checkpoints-migrations.test.ts:647`（历史文档快照）、2.5 节。

### 5.2.3 02-forks.ts —— fork 继承到分叉点，副本独立

**它演示什么**：在某个历史 entry 处开一条新分支。分叉出来的新会话看到的转录只到那条 entry；每个文档按自己的 `fork` 策略取值（`asOf` 取分叉点的值、`initial` 取空值）。分叉之后两边互不影响——这是「重试一轮对话」或「并行探索两个方案」的基础操作。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/02-forks.ts
```

**关键代码**（`test/examples/02-forks.ts:30-53`）：

```typescript
// 在 firstEntry 处分叉。第三个参数与 createConversation 一样是归属声明。
const branch = await session.commit(
	(tx) => tx.forkConversation(chat.id, firstEntry.id, { ownership: { kind: "ownerless" } }),
	context,
);

// scanEntries 默认新到旧：分叉点之后的 "goodbye" 不可见
const branchEntries = await session.commit((tx) => tx.scanEntries({ conversationId: branch.id }, 10), context);
console.log(
	"fork transcript:",
	branchEntries.items.map((entry) => entry.data),
);
// 文档 fork: "asOf" —— 分叉点的值，而不是父会话最新值
console.log("fork notes:", await session.snapshot(Notes, branch.id, context));

// 在分支上改文档：父会话不受影响
await session.commit(async (tx) => {
	(await tx.doc(Notes, branch.id)).text = "changed only in the fork";
}, context);
console.log("fork notes after edit:", await session.snapshot(Notes, branch.id, context));
console.log("parent notes after edit:", await session.snapshot(Notes, chat.id, context));
```

**逐点解释**：

1. `tx.forkConversation(parentId, entryId, { ownership })` 的分叉点是**一条可见 entry**；不可见或不存在的 entry 会在准入前被拒绝，且 Session 仍可用（`test/session-forks.test.ts:383`）。
2. `scanEntries` 按页从新到旧扫「这个会话可见的 entry」：输出 `['hello']` 说明分叉只继承到 `firstEntry`，之后写入的 `goodbye` 不在里面。
3. 文档的起点由 `fork` 字段决定：该字段在**定义时**声明，不在分叉时传。`asOf` 取「分叉 entry 那次提交的最终值」，`current` 取父会话当前值，`initial` 表示分叉副本从一个全新的初始值开始（`test/session-forks.test.ts:30`）。
4. 分叉复制文档的时机与同批 entry 的边界很讲究：同一 commit 里在分叉 entry 之后写入的内容不算（`test/session-forks.test.ts:152`），继承值也不是通过迁移定义重新计算出来的（`:231`）。
5. 最后两行是隔离性的直接证据：分支上改成 `changed only in the fork`，父会话仍是 `after goodbye`。

**你会看到**（实测输出，原样引用）：

```text
fork transcript: [ 'hello' ]
fork notes: { text: 'after hello' }
fork notes after edit: { text: 'changed only in the fork' }
parent notes after edit: { text: 'after goodbye' }
```

**动手改**：

1. 把分叉点从 `firstEntry.id` 换成 `secondEntry.id`（第二条 entry）：`fork transcript` 会变成 `['goodbye', 'hello']`（新到旧），`fork notes` 变成 `after goodbye`——同一个文档，起点随分叉点移动。
2. 把 Notes 的 `fork: "asOf"` 改成 `"initial"`：分叉副本的 notes 变成 `{ text: "" }`，与父会话彻底无关。这解释了 03 里 registry 文档为什么用 `initial`（子 agent 不该继承父的 agent 列表）。
3. 在分叉之后对**父会话**再写一条 entry 并重新 `scanEntries` 两个会话：父会话多一条，分支不多——分叉是复制历史，不是共享历史。

**边界与易错点**：

- **分叉点必须可见**：不可见或不存在的 entry 在准入前被拒绝，Session 保持可用（`test/session-forks.test.ts:383`）。
- **复制范围只有会话作用域**：Session 级与任务级文档留在原作用域，不会跟着走（`:610`）。
- **as-of 与 current 的祖先不同**：`asOf` 取「拥有那条 entry 的祖先」，`current` 取直接父级（`:180`）。
- **同 commit 的边界**：分叉 entry 所在提交里、它之后写入的内容不计入继承（`:152`）。
- **复制不是共享**：分叉之后父会话的写入不会出现在分支里，反之亦然——想「同步」只能再显式提交。

**和后面的示例怎么接**：

- 03 的 registry 与 29 的 sandbox 都用 `fork: "initial"`，它们回答的是同一个问题：子会话该不该继承这份状态。
- 08 把 fork 用在 agent 上（as-of 的 agent 选择），机制与文档完全同源。
- 分叉是时间维度的复制，24 的子任务是结构维度的拆分；生产代码里两者经常叠加（在一条分支上再开一个子任务）。

**再读一遍输出，容易漏看的两处**：

- `fork transcript` 是数组字面量，而 09 起你会看到同一份数据被渲染成 `user: ...` 这样的单行——同一个转录的两种展示，别混淆。
- `fork notes` 与 `parent notes after edit` 的对比说明复制发生在**分叉那一刻**，不是延迟到第一次读取；所以分叉后父会话的写入不会「追进」分支。

**再练两个实验**：

- 在分支上再 fork 一次（三级链）：文档取值遵循同样的 as-of 规则，验证它取的是「拥有那条 entry 的祖先」而不是直接父级（`:180`）。
- 把分叉点改到最新 entry：transcript 变成完整历史，但文档仍是 as-of 的值——「历史到哪」与「文档从哪开始」是两件独立的事。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `tx.forkConversation(parentId, entryId, { ownership })` | 在一条可见 entry 处开分支 | `src/session/transaction.ts` |
| `tx.scanEntries({ conversationId }, limit)` | 按页扫可见 entry（新到旧） | `src/session/transaction.ts` |
| `session.snapshot(token, branchId, context)` | 读分支的文档值（as-of 或 initial） | `src/session/session.ts` |
| 文档字段 `fork: "asOf" \| "current" \| "initial"` | 决定分叉副本的起点 | `src/documents.ts` |

**对应源码/测试**：`src/session/forks.ts`（分叉时文档复制的实现）、`src/session/transaction.ts`（`forkConversation` 的准入校验）、`test/session-forks.test.ts:30`（as-of / current / initial 的复制行为）、`:152`（同一 commit 内的选取边界）、`:610`（只复制会话作用域文档，Session 与任务文档留在原作用域）、2.5 节。

### 5.2.4 03-owned-conversations.ts —— 一个 commit 建任务、子会话与 registry

**它演示什么**：一个常见的 agent 结构：主会话上跑一个后台监督任务，任务拥有一个子会话（研究助手），主会话用一个文档记住「agent 名字 → 子会话 id + 首条消息的 requestId」。三样东西在一个 commit 里创建，所以崩溃后不会出现半成品。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/03-owned-conversations.ts
```

**关键代码**（`test/examples/03-owned-conversations.ts:40-67`）：

```typescript
const main = await session.commit((tx) => tx.createConversation({ ownership: { kind: "ownerless" } }), context);

const setup = await session.commit(async (tx) => {
	// 任务属于 main 会话，并且是 background：等 main 空闲不会等它（见 2.7 节）
	const supervisorId = await tx.createTask(Supervisor, null, {
		ownership: { kind: "conversation" },
		conversationId: main.id,
		background: true,
	});

	// 子会话属于上面这个任务；同一个 commit 里刚建的任务 id 可以立刻被引用
	const child = await tx.createConversation({ ownership: { kind: "task", taskId: supervisorId } });

	// registry 文档：agent 名 -> 会话 id + 首条消息的固定 requestId
	(await tx.doc(AgentRegistry, main.id)).agents.researcher = {
		conversationId: child.id,
		requestId: `researcher:first-message:${supervisorId}`,
	};
	return { supervisorId, child };
}, context);

console.log("supervisor task:", setup.supervisorId);
console.log("child conversation:", setup.child);
console.log("registry:", await session.snapshot(AgentRegistry, main.id, context));
```

**逐点解释**：

1. 任务定义在同一个文件的第 18-24 行：`defineTask<Input, State, Result>({ name, version, initial, phases, abort })`（`src/tasks.ts:4`）。本例只创建记录，`phases` 里的 `ready` 处理器永远不会被执行。
2. `createTask` 的归属参数是 `ownership: { kind: "conversation" }, conversationId: main.id`，比会话的 `ownership` 多一个 `background` 开关：`background: true` 表示「等主会话空闲时跳过它」，而 `abort`（不限定 background）仍能顺着所有权到达它（见 2.7 节）。
3. 子会话的 `ownership: { kind: "task", taskId: supervisorId }` 引用的是**同一事务里刚创建**的任务。这是允许的，也是「一次提交建好整棵结构」的关键（`test/session-tables.test.ts:188`「creates a conversation with an explicitly staged task owner」）。
4. 三样东西同批提交带来的保证：要么都有，要么都没有。否则崩溃后可能出现「registry 指向一个不存在的会话」这种不可修复的半成品。
5. `requestId` 是应用给「首条消息」起的固定名字。将来用同一个 requestId 提交同一条消息时，重试不会重复投递（幂等投递，见 2.9 节）。
6. 纯 Session 不执行任务：示例只打印记录，没有任何 phase 运行。要真的跑起来必须有 Harness（12-tasks.ts）。

**你会看到**（实测输出，原样引用）：

```text
supervisor task: 3
child conversation: { id: 4, owner: { conversationId: 2, taskId: 3 } }
registry: {
  agents: {
    researcher: { conversationId: 4, requestId: 'researcher:first-message:3' }
  }
}
```

7. 三个 id 的关系能直接读出来：主会话 2（先建）、任务 3、子会话 4（后建）；子会话的 `owner` 里同时记着它属于哪个会话（2）和哪个任务（3）。多行 `{ ... }` 是 Node `console.log` 对嵌套对象的展开格式，不是文档结构本身。

**动手改**：

1. 把子会话的 `taskId: supervisorId` 改成不存在的 `taskId: 999`：提交被拒绝（对照 `test/session-tables.test.ts:213` 对非法 owner 的原子拒绝）。可以把这一步理解成「所有权是硬约束，不是注释」。
2. 把三件写入拆成两次 commit（先建任务，再建子会话与 registry）：输出里的 id 段不再连续，更重要的是——你刚刚制造了一个「崩溃后可能只剩监督任务」的窗口。这正是本例把它们放进一个 commit 的理由。
3. 在示例末尾追加一段：先用 `session.commit((tx) => tx.scanEntries({ conversationId: main.id }, 1), context)` 取 main 会话最新一条 entry 的 id，再 `tx.forkConversation(main.id, thatId, { ownership: { kind: "ownerless" } })` 分叉，然后 `snapshot(AgentRegistry, forked.id)`。因为 `AgentRegistry` 用的是 `fork: "initial"`，fork 拿到的是空 `agents` 表；把定义里的 `fork` 改成 `"asOf"` 再跑一次，就会看到 fork 继承了父会话的助手列表。

**边界与易错点**：

- **owner 必须已存在且未终态**：缺失 / 已终止 / 已标记中止的 owner 会让整个提交被原子拒绝（`test/session-tables.test.ts:213`）。同一个 commit 里「刚建的任务」是合法 owner，但「还没建的」不是。
- **`background: true` 只影响「等空闲」**：它让等待跳过这个任务，而 abort 这类主动操作仍会顺着所有权到达它（2.7 节的边界说明，测试见 `test/harness-ownership.test.ts:172`）。
- **registry 用 `fork: "initial"` 是有意的**：子 agent 不该继承父会话的助手列表；改成 `asOf` 会得到一个会「记得别人」的助手。
- **`requestId` 的幂等窗口**：同一个 requestId 只投递一次，重复提交返回第一次的结果（2.9 节）；它必须是**稳定的名字**，不能用随机数或时间戳生成。
- **纯 Session 不调度任务**：这里 `phases.ready` 永远不会执行；要看任务真正运行，需要 Harness（12）。

**和后面的示例怎么接**：

- 12 把这里的 `Supervisor` 换成真会被调度的任务；24 让任务之间用 owner 组成树。
- 23 把 registry 文档放大成生产形态：`agents` 里多了 `reported` 数组，`reporters` 记任务 id。
- `requestId` 的幂等在 22（`subagent:<taskId>`）与 23（`subagent:<reporterId>`）里各用了一次。

**再读一遍输出，容易漏看的两处**：

- `child conversation` 的 `owner` 同时有 `conversationId` 与 `taskId`：参与 abort 传播时两个字段都会用到（2.7 节）。
- `registry` 是**文档当前值**的多行展开；用 01 的 `snapshotAsOf` 能让它回到这次提交时的样子，即使之后 `agents` 被改过。

**再练两个实验**：

- 把子会话的创建挪进 main 会话的创建提交（同一个 commit 建 main + supervisor + child）：结构与 id 顺序都会变，你能直观看到「事务边界就是一致性边界」。
- 在 `Supervisor` 的 `phases.ready` 里加一行 `console.log`：用纯 Session 跑它，日志不会出现——再次确认「记录 ≠ 执行」。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `defineTask({ name, version, initial, phases, abort })` | 声明任务的状态机 | `src/tasks.ts:4` |
| `tx.createTask(definition, input, { ownership, conversationId, background })` | 建任务并声明归属 | `src/session/transaction.ts` |
| `tx.createConversation({ ownership: { kind: "task", taskId } })` | 建一个属于任务的会话 | `src/session/transaction.ts` |
| `tx.doc(token, conversationId)` | 改会话文档（registry） | `src/session/transaction.ts` |
| `defineDoc({ history: "latest", fork: "initial" })` | 只留当前值、分叉不继承 | `src/documents.ts` |
| `session.snapshot(token, id, context)` | 读 registry 当前值 | `src/session/session.ts` |

**对应源码/测试**：`src/tasks.ts:4`（`defineTask`）、`src/harness/define.ts:6`（`defineExtension`）、`src/session/transaction.ts`（`createTask` / `createConversation` 的 owner 校验）、`test/session-tables.test.ts:188`、`:213`、`test/harness-ownership.test.ts:172`（ownership 的完整语义，含 background 与 abort 的边界）、2.7 节、2.9 节。

### 5.2.5 04-chord-state.ts —— 文档即 Chord state：先 hydrate，再 update

**它演示什么**：应用想让 UI 跟着文档变，但不想自己去轮询。`documentState()` 把一份已提交的会话文档暴露成一个**只读、已 hydrate** 的 Chord state：订阅者立即拿到当前值（hydrate），之后每次提交拿到一次增量（update）。与 05 的 watch 相比，它更轻：没有显式 start/stop 的分段，也没有缓冲策略，投递直接跟着提交走。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/04-chord-state.ts
```

**关键代码**（`test/examples/04-chord-state.ts:26-35`；原文 24-25 行的注释是「documentState() never creates a document. It returns a hydrated read-only Chord state bound to the current concrete incarnation.」）：

```typescript
// 文档不存在时返回 undefined，不会创建
const notesState = await session.documentState(Notes, chat.id, context);
if (notesState === undefined) throw new Error("notes are absent");
// subscribe 的第三个参数是 Chord 的 delivery：kind 是 hydrate 或 update，sequence 单调递增
const stopNotes = notesState.subscribe((value, _deliveryContext, delivery) => {
	console.log("Chord notes:", delivery.kind, delivery.sequence, value);
});
// 写入仍然必须走 commit：state 是只读的
await session.commit(async (tx) => {
	(await tx.doc(Notes, chat.id)).text = "published through Chord";
}, context);
stopNotes();
notesState.dispose();
```

**逐点解释**：

1. `documentState()` 是**读**接口：文档不存在就返回 `undefined`（`test/session-documents.test.ts:109`「never creates on snapshot and returns undefined when absent」对应的读语义）。示例里紧跟的 `throw` 就是把「不存在」当成前置条件来检查。
2. 返回的 state 绑定「当前具体 incarnation」（文档被 retire 后在同一地址重建，是新的 incarnation）。这是它有别于普通值快照的地方：它知道自己绑定的是哪一代文档。
3. `subscribe(value, deliveryContext, delivery)` 的回调签名里，第三个参数是 Chord 的投递元数据：`delivery.kind` 区分「订阅时给的当前值」（`hydrate`）与「后续提交」（`update`）；`delivery.sequence` 在同一订阅上递增。输出里的 `hydrate 0` / `update 1` 就是这两次投递。
4. 改值只有一条路：`session.commit` + `tx.doc(...)`。state 自身没有写入能力，这保证了「观察到的值永远是已提交的值」。
5. `stopNotes()` 取消订阅，`notesState.dispose()` 释放 state。两者职责不同：前者停止投递，后者结束一个观察对象的生命周期。示例按这个顺序收尾是有意的。

**你会看到**（实测输出，原样引用）：

```text
Chord notes: hydrate 0 { text: 'first' }
Chord notes: update 1 { text: 'published through Chord' }
```

6. 两行的顺序就是这套 API 的契约：先现状、后增量。注意 hydrate 给的是 `first`——文档在**订阅前**就已经是第一段 commit 写下的值（第 18-22 行的 commit），订阅不会重放历史，只给当前修订。

**动手改**：

1. 把 `documentState` 换成 05 的 `watchDoc` 再跑同样两行 `console.log`：你会看到「基线值 + 显式 start/stop」的另一种形态，以及慢回调缓冲的差异。同一个文档、同一次提交，两条通道的语义不同。
2. 对一个**不存在的文档**调用 `documentState`（把第 20 行的首次写入删掉）：返回 `undefined`，示例在下一行抛错。这一条把「观察接口一律不创建文档」讲清楚了。
3. 在 subscribe 之前再插一次 commit（把值改成 `before subscribe`）：hydrate 给的就是这个最新值——hydrate 是「订阅这一刻」，不是「文档创建时」。

**边界与易错点**：

- **观察接口一律不创建文档**：`documentState` 与 `watchDoc` 都返回 `undefined`（`test/session-documents.test.ts:109`、`test/session-watches.test.ts:40`），判空是调用方责任。
- **state 绑定 incarnation**：文档 retire 后在同一地址重建属于新一代，旧 state 不会跟过去；需要跟上就重新获取。
- **hydrate 不重放历史**：它给「订阅这一刻」的值。要历史请开 `rewindable` 并用 `snapshotAsOf`（01）。
- **退订与 dispose 是两件事**：前者停止投递，后者结束观察对象本身；顺序按示例（先 stop 再 dispose）最直观。
- **通道选择**：需要显式 start/stop、串行回调与积压折叠时用 watch（05）；只要「当前值 + 增量」就用 Chord state。

**和后面的示例怎么接**：

- 05 是同一份文档的另一种观察方式；21 在「运行中」用 Chord state（`viewState`）拿正在执行工具的槽位。
- 19 的 `--ops` 模式把「一次提交产生哪些操作」直接打出来，那是 state 的底层形态（0.3 节）。
- 16 用 `watchDoc(LiveDoc)` 打印流式回答，是 watch 版本的真实用途。

**再读一遍输出，容易漏看的两处**：

- `delivery.sequence` 从 0 开始，它是**这次订阅**的计数，不是全局文档修订号；重新订阅会重新计数。
- 两行之间没有任何「空投递」：没有产生可回放操作的提交不会触发回调（对照 `test/session-watches.test.ts:206` 对结构性 no-op 的处理）。

**再练两个实验**：

- 挂两个订阅者分别打印：各自都会拿到 hydrate + update，sequence 各自递增——投递按订阅者独立。
- 在 `subscribe` 回调里 `await session.commit(...)` 做一次「写回」（例如把收到的文本加个后缀再写）：观察它会不会再触发一次 update、以及你在哪里需要停止，体验「回调里发起写入」的边界。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `session.documentState(token, conversationId, context)` | 只读 Chord state（已 hydrate） | `src/session/session.ts:181` |
| `state.subscribe(cb)` / `stopNotes()` | 订阅 / 退订 | `src/session/observation.ts` |
| `state.dispose()` | 结束观察对象 | `src/session/observation.ts` |
| `delivery.kind` / `delivery.sequence` | 投递类型（hydrate / update）与序号 | `@earendil-works/chord` |
| `session.commit(...)` + `tx.doc(...)` | 改值的唯一路径 | `src/session/session.ts` |

**对应源码/测试**：`src/session/observation.ts`（`DocumentState` / `DocumentWatch` 的实现）、`src/session/session.ts:181-237`（`documentState` 的六个重载）、`test/session-documents.test.ts:605`（adoption 之后同步投递完整发布）、`:622`（close 的同步发布与退订）、`test/session-states.test.ts`（document states 一族）、`test/chord-guide.test.ts:268`（Chord 集成用法：facet host、远程客户、withdrawal、detach 直到 Harness close）、0.3 节、2.17 节。

### 5.2.6 05-watches.ts —— watch：稳定基线 + 串行交付

**它演示什么**：watch 是比 Chord state 更「工程化」的观察接口：它在采集时定下一个稳定修订作为基线，`start()` 之后把每次提交的**精确帧**交给一个串行化的回调——慢回调不会重叠，积压过多时折叠成一次整值重置。适合把文档变化同步到外部系统（写文件、发通知）的场景。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/05-watches.ts
```

**关键代码**（`test/examples/05-watches.ts:26-39`；原文 24-25 行注释是「A watch starts from one stable acquisition revision. Slow callbacks never overlap; exact committed frames buffer, with a full-value reset after 100.」）：

```typescript
// 与 documentState 一样：文档不存在时返回 undefined，不创建
const notesWatch = await session.watchDoc(Notes, chat.id, context);
if (notesWatch === undefined) throw new Error("notes are absent");
// 基线的值（采集修订时的快照）
console.log("watch baseline:", notesWatch.value);
const delivered = new Promise<void>((resolve) => {
	// start 之后才投递；回调串行执行
	notesWatch.start(async (value, _ops, _deliveryContext) => {
		console.log("watch update:", value);
		resolve();
	});
});
await session.commit(async (tx) => {
	(await tx.doc(Notes, chat.id)).text = "observed asynchronously";
}, context);
await delivered;
// stop 幂等
await notesWatch.stop();
```

**逐点解释**：

1. `watchDoc()` 不创建文档（`test/session-watches.test.ts:40`），所以调用者必须处理 `undefined`。
2. 采集（`watchDoc` 返回时）就确定了**基线修订**；`notesWatch.value` 是这个基线的快照，输出为 `first`。采集之后、`start()` 之前发生的提交不会被丢掉——它们作为待交付的精确帧排在 `start` 后面（`test/session-watches.test.ts:48`「keeps the acquisition revision until start and delivers exact committed frames」）。
3. 回调具有串行化保证：一个回调在跑的时候到达的提交会缓冲，不会并发调用你的回调（`:83`）。缓冲超过 100 帧时折叠成一次「整值重置」，`reset` 之后你拿到的是完整值而不是差分（`:142`）；正在进行中的那一帧不会被折叠进重置（`:159`）。
4. 交付的是**已提交帧**，所以不需要防抖：一次 commit 一次投递。示例只提交一次，回调也只跑一次。
5. `stop()` 幂等，重复 stop 与「stop 之后又 start」的非法组合都有明确行为（`:338`）。`await delivered` 之后才 stop，是为了让示例的退出点确定。

**你会看到**（实测输出，原样引用）：

```text
watch baseline: { text: 'first' }
watch update: { text: 'observed asynchronously' }
```

**动手改**：

1. 在 `watchDoc()` 与 `start()` 之间插入一次提交（值写成 `between`），再 start：baseline 仍是 `first`，但 start 之后你会先收到 `between`、再收到后续提交——验证「采集修订」与「start 时间点」是两个不同的锚。
2. 在回调里 `await` 一个 200ms 的定时器，同时连续提交 3 次：三次回调依次串行完成，不会并发、不会乱序。这是「慢回调不重叠」的直接体验。
3. 把提交次数改成 101 次（循环写同一个文档）：你会看到一次整值重置而不是 101 次等量回调——这正是 `:142` 断言的折叠阈值。

**边界与易错点**：

- **`value` 是基线不是最新值**：采集之后、`start()` 之前发生的提交会作为待交付帧排队（`:48`）。
- **串行与折叠**：慢回调不会重叠；积压超过 100 帧折叠成一次整值重置，而正在投递中的那一帧不参与折叠（`:83`、`:142`、`:159`）。
- **start / stop 的纪律**：`stop()` 幂等，重复 `start()` 与 `start()` 之后再 `stop()` 再 `start()` 这类组合有明确行为（`:338`）。
- **回调里可以发起提交**：投递发生在提交之后，所以不会自锁（`:118`）；但别在回调里做长时间阻塞的操作，否则后面的帧只能排队。
- **watch 不创建文档**，与 Chord state 一致：读接口不产生副作用。

**和后面的示例怎么接**：

- 21 用 `watchEvents`（事件流）与 `root.viewState()`（结构化视图）做同一件事的另外两种通道：watch 是文档级、事件流是对话级。
- 16 用 watch 打印流式回答；23 用 `watchEvents` 渲染整条时间线。
- 选择标准很好记：慢回调也要每条都到 → watch；只要最新状态 → Chord state / `viewState`。

**再读一遍输出，容易漏看的两处**：

- `watch baseline` 在 `start()` **之前**打印：值的获取与投递的启动是两步，这个顺序让「采集修订」与「订阅时刻」可以不同。
- `watch update` 只有一行：示例只提交了一次。若你在真实应用里看到多行，先检查是不是有别的提交（工具写文档、系统提示词追加）在同一时间发生。

**再练两个实验**：

- 在 `watchDoc()` 与 `start()` 之间连续提交 5 次：你会收到 5 帧（超过阈值时折叠），而不是「最新值一次」——这就是 watch 与 state 的差别。
- 在同一时刻打印 `notesWatch.value` 与 `session.snapshot(Notes, ...)`：有 pending 提交时两者不同，「基线」与「最新」的界限一目了然。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `session.watchDoc(token, conversationId, context)` | 采集一条观察通道（含基线快照） | `src/session/session.ts:267` |
| `watch.value` | 采集修订的快照 | `src/session/observation.ts` |
| `watch.start(cb)` | 开始投递（串行、精确帧、可折叠） | `src/session/observation.ts` |
| `watch.stop()` | 停止投递（幂等） | `src/session/observation.ts` |

**对应源码/测试**：`src/session/observation.ts`、`test/session-watches.test.ts:48`、`:83`、`:142`、`:159`、`:467`（可以从采集修订起重放每一个投递批次）、2.17 节。

## 5.3 B 组：Harness 基础（06–13）

B 组把 Session 之上的一层「agent 运行时」拆开：root 会话与进程内 registry（06）、会话配置与宿主 settings（07）、类型化 entry 与 fork 的 agent 继承（08）、转录到模型上下文的推导（09）、扩展热重载（10）、扩展私有的会话状态与提示词段落（11）、持久任务（12）、崩溃恢复（13）。

这一组示例都需要两个**非持久**依赖：`models`（pi-ai 的模型集合，见 0.4 节）与 `registry`（本进程安装的扩展代码）。06–08 只做登记与解析，不真的调用模型；09 之后开始出现 faux provider（脚本化的假模型），所以全部输出可离线复现。读到 09 时请把「存储里的转录」与「发给模型的消息」当成两个不同的东西，这是本组最重要的一条分界。

### 5.3.1 06-harness.ts —— root 会话、进程内 registry 与 agent 解析

**它演示什么**：Harness 的第一次接触：注册一个扩展、打开 Harness、拿到 root 会话。示例同时演示「存储里只记名字、代码在进程里」这条贯穿全书的规则——`snapshot(AgentDoc)` 读出来是 `{ thinkingLevel: 'low' }`，而 `root.agent()` 解析出扩展与工具。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/06-harness.ts
```

**关键代码**（`test/examples/06-harness.ts:23-34` 与 `:49-64`）：

```typescript
// ---- 扩展与注册表（进程内代码）----
const read = defineTool({
	name: "read",
	description: "Read a file",
	parameters: Type.Object({ path: Type.String() }),
	execute: async (args) => ({ content: [{ type: "text", text: `contents of ${args.path}` }] }),
});
const Files = defineExtension({ name: "files", tools: [read] });
const registry = createRegistry();
registry.install(Files);

// ---- 打开 Harness：只有 storage 是持久的 ----
const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);

// ---- root 是惰性的：第一次调用创建会话 1，并在同一个 commit 里执行 init ----
const root = await harness.root(context, {
	agent: { thinkingLevel: "low" },
	init: async (tx, rootId) => {
		(await tx.doc(Notes, rootId)).text = "root notes";
	},
});
console.log("root:", root.id, await harness.snapshot(Notes, root.id, context));
// 存储里只有选择的名字
console.log("stored agent:", await harness.snapshot(AgentDoc, root.id, context));
// agent() 把名字解析成本进程的扩展与工具
const agent = await root.agent(context);
console.log(
	"resolved:",
	agent.thinkingLevel,
	agent.extensions.map((extension) => extension.name),
	agent.tools.map((tool) => tool.name),
);
```

**逐点解释**：

1. 三样东西的寿命不同：`registry` 与 `models` 属于**这次进程**；`storage` 属于**这次数据**；root 会话属于**这次数据里的一个实体**。`Harness.open` 的第二个参数里，只有第一项（storage）会被持久化。
2. `registry.install(Files)` 会校验「安装后的注册表」是否自洽，不自洽就整体不发布（`test/harness-registry.test.ts:104`）；内置任务永远在注册表里、且不属于任何扩展（`:127`）。
3. `harness.root(context, { agent, init })` 是惰性创建：首次调用把 root 会话、内置文档、`agent` 选择与 `init` 的写入放在**同一个 commit**（`test/harness-conversations.test.ts:72`）。之后重复调用直接返回它、忽略这些参数（`:112` 验证跨重开身份与状态不变）。
4. `init` 是普通事务回调：能写文档也能写 entry，用来给 root 做一次性初始化。
5. `snapshot(AgentDoc, root.id)` 输出 `{ thinkingLevel: 'low' }`：**存储里没有扩展对象、没有工具对象，只有选择**。`root.agent()` 把选择与本进程注册表结合，得到解析后的 agent（`test/harness-registry.test.ts:140`「agent resolution」）。
6. 输出三行分别是：root 会话 id 与 init 的结果、存储的选择、解析后的 agent（`low` / `['files']` / `['read']`）。

**你会看到**（实测输出，原样引用）：

```text
root: 1 { text: 'root notes' }
stored agent: { thinkingLevel: 'low' }
resolved: low [ 'files' ] [ 'read' ]
```

**动手改**：

1. 把 `agent: { thinkingLevel: "low" }` 改成 `"high"`：第二、三行都跟着变。再把 `init` 整个删掉：第一行的文档值变成 `undefined`（文档根本没被创建）——`init` 不是可选项装饰，它就是那次创建提交的一部分。
2. 把 `registry.install(Files)` 注释掉：`stored agent` 不变，`resolved` 变成 `low [] []`。这条实验是「名字与代码解耦」最直观的证明，也是 10 与 31 的前置知识。
3. 把 `MemoryStorage` 换成 SQLite（照抄 13 的 `openNodeSqliteStorage`）连续运行两次：第二次 root 仍是 1、`init` 不再执行、notes 仍是第一次写的 `root notes`——root 是「第一次创建、之后复用」。

**边界与易错点**：

- **`models` 只是能力集合**：06 不发起任何请求；真正调用发生在生成任务里（0.4 节、3.2 节）。
- **安装前整体校验**：注册表在安装后不自洽时**不发布任何东西**（`test/harness-registry.test.ts:104`），所以「半个扩展生效」这种情况不会出现。
- **内置任务独立于扩展**：它们永远在注册表里，且不属于任何一个扩展（`:127`）。
- **创建提交的顺序**：内置文档 → `conversationCreated` 钩子 → agent → `init`（`test/harness-conversations.test.ts:287` 的标题即这个顺序）。把初始化写进 `init` 会比写进钩子更晚生效。
- **root 只创建一次**：之后调用忽略 `agent` 与 `init` 参数（`:112` 验证跨重开身份与状态不变）。

**和后面的示例怎么接**：

- 07 展开 `agent` 与 settings；08 展开会话句柄；09 展开上下文；10–13 分别展开扩展、状态、任务与恢复。
- 14 起才真的「跑一轮对话」（faux provider），届时 `models` 第一次被使用。
- `Harness.open` 的 storage 参数在 13、23、24、31 里换成 SQLite，其它调用一行都不用改。

**再读一遍输出，容易漏看的两处**：

- `root: 1 { text: 'root notes' }` 一行两件事：会话 id 与 `init` 的结果；`init` 有没有跑，看后面那个对象就知道。
- `resolved: low [ 'files' ] [ 'read' ]` 的三个字段是 thinkingLevel、扩展名、工具名；扩展名只存在于解析结果里，存储里没有它。

**再练两个实验**：

- 把 `read` 工具改名（例如 `cat`）再装进 `Files`：`resolved` 的工具名跟着变、`stored agent` 不变——名字来自代码。
- 用两个不同的对象、同一个扩展名连续 `install` 两次：`resolved` 里只有一个扩展，后装的对象胜出，不会出现两份。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `createRegistry()` / `registry.install(ext)` | 本进程的扩展注册表 | `src/harness/registry.ts` |
| `defineTool({ name, description, parameters, execute })` | 定义工具 | `src/harness/define.ts:13` |
| `defineExtension({ name, tools })` | 打包成命名的扩展 | `src/harness/define.ts:6` |
| `Harness.open(storage, { models, registry }, context)` | 打开运行时（storage 持久） | `src/harness/harness.ts` |
| `harness.root(context, { agent, init })` | 惰性创建 root 会话 | `src/harness/harness.ts` |
| `conversation.agent(context)` | 用注册表解析出扩展与工具 | `src/harness/agent.ts` |

**对应源码/测试**：`src/harness/harness.ts`（`open` / `root` / `snapshot` / `close`）、`src/harness/registry.ts`、`src/harness/agent.ts`（选择 → 解析）、`src/harness/define.ts:6`、`:13`（`defineExtension` / `defineTool`）、`test/harness-conversations.test.ts:72`、`:112`、`test/harness-registry.test.ts:104`、`:127`、`:140`、2.10 节、2.13 节。

### 5.3.2 07-configuration.ts —— 会话配置存名字，宿主 settings 不存

**它演示什么**：两类配置的区别。会话级配置（模型、思考级别、选中的扩展与工具）**存在会话里**，跨重启有效；Harness 级 settings（stream、retry、toolExecution）是宿主策略，**每次使用读取**，改了立即生效、不进存储。示例还演示「卸载扩展 ≠ 取消选择」。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/07-configuration.ts
```

**关键代码**（`test/examples/07-configuration.ts:65-94`；第 50-59 行是 settings 的定义）：

```typescript
const tools = async () => (await root.agent(context)).tools.map((tool) => tool.name);
// 新会话没写任何选择 -> 跟随宿主：所有扩展、所有工具
console.log("default tools:", await tools());

// configure 一个 commit 写一次：字段整体替换，对象按名字存
await root.configure(
	{
		model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
		thinkingLevel: "high",
		tools: [write, read],
	},
	context,
);
console.log("stored:", await harness.snapshot(AgentDoc, root.id, context));
const agent = await root.agent(context);
console.log("model:", agent.model, "thinking:", agent.thinkingLevel, "tools:", await tools());

// tools: null 把这一字段清回宿主默认；extensions.remove 从选择里删掉一个扩展
await root.configure({ extensions: { remove: [Search] }, tools: null }, context);
console.log("without search:", await tools());

// 显式选中两个扩展；然后卸载代码，再装回来
await root.configure({ extensions: [Files, Search] }, context);
registry.uninstall(Files);
console.log("files uninstalled:", await tools());
registry.install(Files);
console.log("files reinstalled:", await tools());
```

**逐点解释**：

1. 「跟随宿主」是**缺省**而不是继承某个模板：没有存储选择时，agent 解析出所有已安装扩展的全部工具，所以 `default tools: ['read', 'write', 'grep']`（三个工具分别来自 files 与 search 两个扩展）。
2. `configure()` 一次调用一个 commit；每个字段是**整体替换**语义——没提到的字段保持原值，`null` 表示清回宿主默认（`test/harness-conversations.test.ts:331`「replaces whole fields, clears them with null, and leaves undefined fields alone」）。
3. 传的是**对象**（`write`、`read`、`Files`、`Search`），存的是**名字**。类型系统因此能挡住「拼错的扩展名」，而存储里的名字让会话选择可以跨重载与重启存活（10、31 会验证这一点）。
4. `tools: null` 让工具选择回到宿主默认，输入仍是三个工具；`extensions: { remove: [Search] }` 则是把扩展从显式选择里摘掉——两者效果不同，前者清空选择，后者改选择内容。
5. `registry.uninstall(Files)` 之后会话仍然选中 `files`，只是这个名字解析不到代码，于是它的工具不再出现：`files uninstalled: ['grep']`。重装后 `read`、`write` 立刻回来。`test/harness-registry.test.ts:171`（跳过未安装的名字，安装后再解析出来）与 `:180`（同名工具就地替换、wrap 胜出者、再应用过滤）覆盖了这条链路。
6. settings 完全不在存储里：第 52 行的 `timeoutMs` 与第 97 行的 `timeoutMs = 120_000` 之间没有任何 commit，但下一次请求就会用新的超时。getter 形式（`get stream()`）让设置可以来自应用自己的配置文件。

**你会看到**（实测输出，原样引用）：

```text
default tools: [ 'read', 'write', 'grep' ]
stored: {
  model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' },
  thinkingLevel: 'high',
  tools: [ 'write', 'read' ]
}
model: { provider: 'anthropic', modelId: 'claude-sonnet-4-5' } thinking: high tools: [ 'write', 'read' ]
without search: [ 'read', 'write' ]
files uninstalled: [ 'grep' ]
files reinstalled: [ 'read', 'write', 'grep' ]
```

7. 对照 `stored` 与解析后的 `tools` 两行：存储里的顺序是 `['write', 'read']`（configure 的传参顺序），解析后的顺序一致——**选择顺序是配置的一部分**，不是集合。

**动手改**：

1. 把第一次 `configure` 的 `tools` 改成 `null`：`stored` 里不再有 `tools` 字段，解析出的工具仍是三个默认工具。`null` 是「清除覆盖」，不是「一个工具都不给」；后者要传空数组。
2. 把 `extensions: [Files, Search]` 改成 `[Files]`：`grep` 消失，`read`/`write` 留下。此时没有卸载任何代码——工具集由「选择 × 已安装」共同决定，这两个输入可以分别破坏性地验证。
3. 把 `settings.toolExecution` 从 `"sequential"` 改成 `"parallel"`：输出不变（本例只有单次工具调用），但你要意识到它不会进 `stored`——settings 是宿主策略，对照 26 里运行时修改 settings 的做法。

**边界与易错点**：

- **替换语义**：`configure` 整体替换字段、`null` 清除覆盖、未提及的字段保持原值（`test/harness-conversations.test.ts:331`）。「只想改一个字段」不需要先把其它字段读出来再写回去。
- **传对象、存名字**：对象让类型系统挡住拼错；存名字让会话选择对代码保持独立——10 与 31 的所有热重载能力都建立在这条规则上。
- **`add` / `remove` 是在默认选择上增减**：`test/harness-registry.test.ts:155` 的标题是「selects the default, an array, or the default edited by add and remove」，三种写法别混用。
- **卸载 ≠ 取消选择**：卸载只让名字暂时解析不到（07 的 `files uninstalled` 只剩 `grep`）。
- **settings 不进存储**：改它不需要 commit；它属于宿主策略，进程重启后由应用自己的配置来源决定（见 26）。

**和后面的示例怎么接**：

- 26 展示 settings 的 getter 在运行时被改（`parallelTools` 开关），以及 env 如何按会话 cwd 构造。
- 27 用 `extensions: { add: [...] }` 进入 plan 模式，是本节 `remove` 的镜像操作。
- 28 直接用「两个会话、两套 agent 配置」搭出 reviewer 角色。

**再读一遍输出，容易漏看的两处**：

- `stored` 里的 model 是 `anthropic/claude-sonnet-4-5`：**没有 API key 也能配置**，因为「配置」与「调用」是两件事（真正调用见 16）。
- `files uninstalled: [ 'grep' ]` 一行里叠了两个事实：会话仍然选中 `files`，但它的工具解析不出来。要拆开验证就对照 `stored` 与 `resolved` 两行。

**再练两个实验**：

- 先 `configure({ tools: [read] })` 再 `configure({ tools: null })`：先收窄再清回宿主默认，两次输出连起来看，就能确认「null ≠ 空数组」。
- 在每次 `configure` 前后各打印一次 `harness.snapshot(AgentDoc, ...)`：看到「一次 configure = 一个 commit = 一次文档值变化」，配合 01 的 as-of 读法可以做配置审计。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `root.configure(patch, context)` | 一个 commit 写一次会话配置 | `src/harness/agent.ts` |
| `AgentDoc` | 会话配置所在的文档 token | `src/harness/agent.ts` |
| `conversation.agent(context)` | 解析出 model / thinking / extensions / tools | `src/harness/agent.ts` |
| `HarnessSettings { stream, retry, toolExecution }` | 宿主策略，每次使用读取 | `src/harness/types.ts` |
| `settings: { extensions: [...] }` | 宿主的默认扩展选择 | `src/harness/types.ts` |

**对应源码/测试**：`src/harness/agent.ts`（`configure` 的字段替换与解析）、`src/harness/registry.ts`（选择 × 安装的求交）、`src/harness/types.ts`（`HarnessSettings` 与 `AgentDoc` 的形状）、`src/harness/define.ts:34`（`wrapTool`）、`test/harness-conversations.test.ts:330`、`test/harness-registry.test.ts:171`、`:180`、2.12 节、2.13 节。

### 5.3.3 08-harness-conversations.ts —— 类型化 entry、会话句柄与 fork 的 agent 继承

**它演示什么**：三件事拼在一起：用 `defineEntry` 给 entry 的 `data` 加类型；用无状态句柄操作会话（比较 id、按 id 查回）；以及 fork 的 agent 继承——新会话继承的是**分叉点那一刻**的 agent，而不是父会话的最新配置。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/08-harness-conversations.ts
```

**关键代码**（`test/examples/08-harness-conversations.ts:19-40`；第 15 行是 `await root.configure({ thinkingLevel: "high" }, context);`）：

```typescript
// 类型令牌：is() 只做窄化；appendEntry 的 data 因此有类型
const Message = defineEntry<{ from: string }>("message");
const hello = await root.commit(
	(tx) =>
		tx.appendEntry(Message, root.id, {
			data: { from: "example" },
			model: [{ role: "user", content: "hello", timestamp: 1 }],
		}),
	context,
);
console.log("typed entry:", Message.is(hello), hello.data.from);

// createConversation / fork 都在创建提交里应用 agent 与 init；fork 取分叉点的 agent
const helper = await harness.createConversation(
	{ ownership: { kind: "ownerless" }, agent: { thinkingLevel: "minimal" } },
	context,
);
const retry = await root.fork(hello.id, { ownership: { kind: "ownerless" } }, context);
console.log("helper thinking:", (await helper.agent(context)).thinkingLevel);
console.log("fork thinking:", (await retry.agent(context)).thinkingLevel);
// 句柄无状态：按 id 查回来是同一个会话
console.log("lookup:", (await harness.conversation(retry.id, context))?.id === retry.id);
```

**逐点解释**：

1. `defineEntry<{ from: string }>("message")` 产出的令牌只做两件事：记住 `kind` 字符串，以及把 `is()` 写成类型守卫（`src/entries.ts:6-12`）。它不做运行时校验、不做转换——这一点决定了：鉴定一枚令牌不会失败，只会给你更窄的静态类型。
2. `appendEntry` 的两个字段分工明确：`data` 只给应用读（这里 `{ from: "example" }`），`model` 是送给模型的消息数组（这里一条 user 消息）。09 会把这份 `model` 拿去推导上下文。
3. 会话句柄是**无状态视图**：`root`、`helper`、`retry` 都只是「绑定到某个会话 id 的包装」，比较它们要比较 `id`。`harness.conversation(id)` 取回的会话满足 `lookup: true`，说明句柄可以随时重建（`test/harness-conversations.test.ts:442`「returns stateless handles and rejects operations after close」）。
4. `createConversation({ ... agent ... })` 的 `agent` 与 `init` 在**创建提交**里生效（`test/harness-conversations.test.ts:156`），所以 helper 一出生就是 `minimal`，不存在「先创建再用默认值跑一轮」的窗口。
5. fork 的 agent 是 as-of 语义：`retry` 在 `hello` 处建立，那时 root 已经是 `high`（第 15 行 configure），所以 `fork thinking: high`（`test/harness-conversations.test.ts:194`「forks at a concrete entry with the as-of agent and applies agent and init overrides」）。这与 01/02 里文档的 `fork: "asOf"` 是同一种时间观。
6. 输出四行分别对应：令牌窄化（`true example`）、新会话自己的配置（`minimal`）、fork 的 as-of 结果（`high`）、句柄查找（`true`）。

**你会看到**（实测输出，原样引用）：

```text
typed entry: true example
helper thinking: minimal
fork thinking: high
lookup: true
```

**动手改**：

1. 把第 15 行的 `configure` 移到 `root.fork(...)` **之后**：`fork thinking` 不再是 `high`，因为分叉点早于那次配置。这一步能把「as-of 继承」与「最新的父配置」彻底分开，也是 02 里文档分叉的同一套规则。
2. 用另一枚令牌判定：`const Note = defineEntry("note"); Note.is(hello)` 得到 `false`，并且要访问 `hello.data.from` 必须先窄化——令牌不会把 entry 变形成另一种类型。
3. 把 `harness.conversation(retry.id, context)` 换成一个不存在的 id：返回 `undefined`，示例里的 `?.id === retry.id` 变成 `false`。句柄查找失败是返回值，不是异常——写 UI 时不要把两者混起来。

**边界与易错点**：

- **令牌只做类型窄化**：不做运行时校验、不做转换（`src/entries.ts:6-12`）；鉴定失败只意味着「它不是这个 kind」。
- **`data` 与 `model` 分工严格**：前者给应用，后者给模型。09 的推导只读 `model`，所以写错字段不会报错，只会静默地不生效。
- **句柄按 id 比较**：`harness.conversation(id)` 找不到返回 `undefined`；`close` 之后的句柄操作被拒绝（`test/harness-conversations.test.ts:442`）。
- **fork 可以带覆盖**：`agent` 与 `init` 会覆盖继承值；不传时才是分叉点的 as-of 值（`:194`）。
- **`entries()` 是 fork-aware 分页**：会翻到继承自父会话的条目，并按祖先上限分页（`:233`）——别把「翻页」当成「只有本会话写入的」。

**和后面的示例怎么接**：

- 09 解释 `model` 字段如何被推导成请求消息；08 先看它怎么写进去。
- 22 与 23 的子 agent 用同样的创建 / fork 语义搭子会话（23 是「复制主 agent 配置后删掉 subagent 工具」）。
- 31 的跨重启场景里，存储的扩展名会与新进程的代码重新绑定——08 是同一件事的进程内版本。

**再读一遍输出，容易漏看的两处**：

- `typed entry: true example` 一行两个值：令牌匹配的布尔结果与 `data.from` 的值。
- `fork thinking: high` 里的 `high` 不是默认值，而是**分叉点的值**；把第 15 行的 configure 挪到 fork 之后（动手改第 1 条）就会变。

**再练两个实验**：

- fork 之后给 `retry` 单独 `configure({ thinkingLevel: "low" })`：分叉后的配置可以覆盖，且不影响父会话——`root`、`helper`、`retry` 是三个独立配置域。
- 对同一条 entry 连续 fork 两次：两个分支 id 不同、内容相同，说明 fork 是「复制」而不是「共享一条分支」。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `defineEntry<D>(kind)` | 声明类型化 entry 令牌 | `src/entries.ts:6` |
| `token.is(entry)` | 类型窄化（不改数据） | `src/entries.ts` |
| `conversation.commit((tx) => tx.appendEntry(token, id, { data, model }), context)` | 写类型化 entry | `src/harness/harness.ts` |
| `harness.createConversation({ ownership, agent, init })` | 建会话并配置 agent | `src/harness/harness.ts` |
| `conversation.fork(entryId, ownership)` | 在 entry 处 fork（agent 为 as-of） | `src/harness/harness.ts` |
| `harness.conversation(id, context)` | 按 id 取回句柄（无则 `undefined`） | `src/harness/harness.ts` |

**对应源码/测试**：`src/entries.ts:6-12`（`defineEntry`）、`src/harness/harness.ts`（`createConversation` / `fork` / `conversation` / `commit` 的句柄方法）、`test/harness-conversations.test.ts:156`、`:194`、`:233`（fork-aware 历史分页）、`:265`（把 commit 与建任务绑定到会话）、`:442`、2.11 节。

### 5.3.4 09-context.ts —— 转录 → 模型上下文：六条规则逐条对上输出

**它演示什么**：存储里的是**转录**（entry 序列），发给模型的是**上下文**（message 列表）。两者不是一一对应：`context()` 会应用 head（重开上下文）、edits（替换/省略旧贡献）、过滤（中止与出错的助手消息不发）、工具结果重排、缺失结果合成，而没有任何 `model` 的 entry 完全不参与。本示例刻意构造一份「不整齐」的转录，把六条规则一次性暴露在输出里。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/09-context.ts
```

**关键代码 A：构造一份不整齐的转录**（`test/examples/09-context.ts:77-99`）：

```typescript
const question = await say("message", { role: "user", content: "read a and b", timestamp: 1 });
// 中止的助手消息：存储里留着，但不会发给模型
await say("message", assistantMessage("I crashed", [], "aborted"));
// 一次助手消息里两个工具调用
const calls = await say("message", assistantMessage("reading", ["a", "b"]));
// 结果按完成顺序写：b 先完成、a 后完成
await say("message", toolResultMessage("b"));
// 位置化的 system entry（它就是一条要发给模型的消息）
await say("pi.system", { role: "system", content: "", sections: { cwd: "<cwd>/repo</cwd>" }, timestamp: 4 });
await say("message", toolResultMessage("a"));
await say("message", assistantMessage("a and b look fine"));
// edit 替换第 1 条 entry 的贡献（不是删除）
await transcript.commit(
	(tx) =>
		tx.appendEntry(transcript.id, {
			kind: "edit",
			data: "user fixed a typo",
			edits: [
				{
					target: question.id,
					action: "replace",
					messages: [{ role: "user", content: "read files a and b", timestamp: 1 }],
				},
			],
		}),
	context,
);
// 纯展示 entry：只有 data，没有 model
await transcript.commit((tx) => tx.appendEntry(transcript.id, { kind: "note", data: "display only" }), context);
```

上面的 `say()` 是第 74-75 行的本地助手：`const say = (kind, ...model) => transcript.commit((tx) => tx.appendEntry(transcript.id, { kind, model }), context);`；`assistantMessage()`（第 24-45 行）与 `toolResultMessage()`（第 47-56 行）构造的是真实的 pi-ai 消息对象，`assistantMessage` 的第三个参数就是 `stopReason`。

**关键代码 B：读上下文、分叉、加 head、再读转录**（`test/examples/09-context.ts:101-134`）：

```typescript
let view = await transcript.context(context);
console.log(
	"raw active entries:",
	view.entries.map((entry) => entry.kind),
);
console.log("request messages:", view.messages.map(show));

// 在工具调用处 fork：那时还没有结果，context() 会把它们补上
const cut = await transcript.fork(calls.id, { ownership: { kind: "ownerless" } }, context);
console.log("fork messages:", (await cut.context(context)).messages.map(show));

// head 指向的 entry 之前的贡献整体被替换；"self" 表示指向自己
await transcript.commit(
	(tx) =>
		tx.appendEntry(transcript.id, {
			kind: "summary",
			head: "self",
			model: [{ role: "user", content: "Summary: a and b are fine.", timestamp: 5 }],
		}),
	context,
);
view = await transcript.context(context);
console.log("after summary:", view.head?.kind, view.messages.map(show));

// entries() 翻的是存储：head 与 edit 从不删除任何东西
const history = await transcript.entries({}, 3, undefined, context);
console.log(
	"newest stored entries:",
	history.items.map((entry) => entry.kind),
	"more:",
	history.next !== undefined,
);
```

**逐点解释**（六条规则 + 视图形状）：

1. **head 开新上下文，不删历史**。`captureContextBounds()` 先取「最新可见 head 标记」与「当前尾部」，范围从 `head.head`（或转录起点）到尾部（`src/harness/context.ts:22-39`）；`selectActive()` 把范围变成「head 标记 + 非 head 的 entry」（`:121-122`）。所以 `head: "self"` 的 summary 提交之后，`view.head?.kind` 是 `summary`，`view.messages` 只剩 summary 自己贡献的那条 user 消息。
2. **edits 替换或省略旧贡献，最新一条生效**。`deriveContext()` 先收集范围内的全部 edits（按 target 收敛，最新的赢），再对每条 entry 应用：`omit` 贡献空数组，`replace` 用 edit 里的消息替换 entry 自己的 `model`（`:68-76`）。输出里第一条消息从 `read a and b` 变成 `read files a and b` 就是它。
3. **中止、出错、延迟的助手消息不发**。排除集合是 `EXCLUDED_STOP_REASONS = new Set(["aborted", "error", "deferred"])`（`:8`），在逐条 entry 的过滤里应用（`:77-79`）。注意被排除的只是「贡献」，原始 entry 仍在存储里——所以 `raw active entries` 里还能看到它。
4. **工具结果紧跟调用、按调用顺序**。`orderToolResults()` 遍历消息：遇到助手消息就把它声明的 `toolCall` 按顺序取出，然后从「下一个助手之前」的消息里按 `toolCallId` 找结果（`:129-151`）。存储里 `result(b)` 先写、`result(a)` 后写，请求里却是 `result(a)`、`result(b)`——顺序由 call 顺序决定。副作用是：`pi.system` 这条消息的相对位置保持在结果之后（结果被整体上移了）。
5. **缺失结果被合成，多余结果被丢弃**。找不到结果时合成 `ToolResultMessage`：文案 `MISSING_RESULT_TEXT`（`:9`）、`isError: true`、`details.reason: "missing_result"`（`:153-163`）。分叉在 `calls` 处时就命中这条规则：`result(a) error`、`result(b) error` 都是合成的。反方向也成立：没有对应 call 的结果消息在遍历中被直接跳过（`:133`），不会凭空出现在上下文里。
6. **没有 `model` 的 entry 不参与上下文**。贡献来自 `entry.model ?? []`（`:76`），与 `kind` 无关。`note`（只有 `data`）因此是纯展示 entry；反过来说，任何 entry 只要写了 `model` 就会进上下文，哪怕它的 `kind` 叫 `note`。

`context()` 返回的视图包含四个字段：`head`（最新可见的 head 标记 entry，或 `undefined`）、`entries`（范围内的活跃 entry，新到旧）、`contributions`（每条 entry 贡献的消息）、`messages`（把所有贡献按规则 4/5 重排后的最终列表）。`raw active entries` 打印的是第三个字段之外的 `entries`，所以「9 条 entry 对 6 条消息」的差额正好是规则 2/3/6 吃掉的贡献。

**你会看到**（实测输出，原样引用）：

```text
raw active entries: [
  'message',   'message',
  'message',   'message',
  'pi.system', 'message',
  'message',   'edit',
  'note'
]
request messages: [
  'user: read files a and b',
  'assistant: reading call(a) call(b)',
  'result(a)',
  'result(b)',
  'system: {"cwd":"<cwd>/repo</cwd>"}',
  'assistant: a and b look fine'
]
fork messages: [
  'user: read a and b',
  'assistant: reading call(a) call(b)',
  'result(a) error',
  'result(b) error'
]
after summary: summary [ 'user: Summary: a and b are fine.' ]
newest stored entries: [ 'summary', 'note', 'edit' ] more: true
```

**六条规则的执行顺序**：推导不是「按规则逐条扫描」，而是固定顺序流水线，顺序本身解释了大部分边界行为：

1. **定范围**：取最新可见 head 标记与尾部，范围从 `head.head`（没有标记就从转录起点）到尾部（`captureContextBounds`）。
2. **收 edits**：扫整个范围，把每条 entry 携带的 edits 按 target 收敛（最新的赢）。
3. **选活跃 entry**：head 标记 + 范围内所有非 head 的 entry（`selectActive`）。
4. **形成贡献**：`omit` → 空；`replace` → 用 edit 的消息；否则 → `entry.model ?? []`（规则 2 与 6 在这里生效）；紧接着过滤掉被排除的助手消息（规则 3）。
5. **重排与补全**：`flat()` 之后交给 `orderToolResults()`——按调用顺序放结果、合成缺失的、丢弃无主的（规则 4 与 5）。

记住这个顺序，就不需要背规则之间的关系：范围 → 来源 → 排除 → 顺序，后面每一步只能看到前面留下的东西。

**输出 ↔ 规则对照**：

| 输出里的现象 | 规则与代码位置 |
| --- | --- |
| `raw active entries` 列出 9 项，含 `'edit'`、`'note'` | 存储视角：edits 与纯展示 entry 都是普通 entry（规则 1/2/6） |
| `'user: read files a and b'` | 规则 2：`edit` 的 `replace` 生效（`src/harness/context.ts:73-76`） |
| 看不到 `assistant: I crashed` | 规则 3：`aborted` 被 `EXCLUDED_STOP_REASONS` 过滤（`:8`、`:77-79`） |
| `'result(a)'` 在 `'result(b)'` 之前 | 规则 4：结果按 call 顺序重排（`:129-151`） |
| `'system: {"cwd":"<cwd>/repo</cwd>"}'` 排在两个 result **之后**、最终 assistant **之前** | 规则 4 的副作用：两个 result 被上移到调用之后，其余消息保持相对顺序 |
| 9 条 entry 只产出 6 条消息（`edit` 与 `note` 各自贡献 0 条，`aborted` 贡献被滤掉） | 规则 2/3/6 |
| `fork messages` 里是 `read a and b`（原文） | 规则 2 的边界：分叉点在 edit 之前，edit 不可见 |
| `'result(a) error'`、`'result(b) error'` | 规则 5：合成缺失结果（`:147`、`:153-163`） |
| `after summary: summary [...]`，只剩 1 条消息 | 规则 1：head 把之前的一切替换掉（`:121-122`） |
| `newest stored entries: ['summary','note','edit'] more: true` | 规则 1/2 不删除数据：`entries()` 仍能翻到，且还有更多页 |

**动手改**：

1. 把 edit 的 `action: "replace"` 改成 `"omit"`：`request messages` 从 6 条变 5 条，第一条变成 `assistant: reading call(a) call(b)`。同一条 edit、同一条目标 entry，两种动作的差别会直接写在你眼前。
2. 给 `note` entry 补一个 `model: [{ role: "user", content: "x", timestamp: 6 }]`：它会进入上下文——因为准入条件是「有没有 `model`」，`kind` 只是标签。这条实验能纠正一个常见误解：「纯展示 entry」不是由 kind 决定的，而是由缺 `model` 决定的。
3. 把 `assistantMessage("I crashed", [], "aborted")` 的第三个参数换成 `"deferred"`（或 `"error"`）：消息同样不进上下文，验证三条排除原因是同一条规则（`:8`）。同时可以顺手改掉 `usage` 等字段，确认构造的消息只需要形状合法即可。

**边界与易错点**：

- **head 只影响推导**：它不改存储；`entries()` 仍能翻到被覆盖的部分（输出里的 `more: true` 就是还有更多页）。
- **edits 的收集范围比想象的大**：同一 target 以最新一条为准，且范围内**所有** entry 携带的 edits 都参与，包括被 `selectActive()` 丢掉的更早 head 标记（`src/harness/context.ts:69-70` 的注释专门说明这点）。
- **排除只作用于「贡献」**：被中止的助手消息仍在存储里——UI 可以照常显示「这一轮被中止了」，只有模型看不到它。
- **结果匹配的边界**：只在「下一个助手消息之前」找结果；跨过一条 assistant 之后，更早未配对的结果不会被捡回来（`:139`）。
- **合成结果可识别**：`isError: true` + `details.reason: "missing_result"`（`:153-163`），UI 可以据此把「真结果」和「补的结果」分开显示。
- **`contributions` 与 `messages` 是两层**：前者是每条 entry 的原始贡献，后者是重排 + 补全之后的最终列表。排查顺序问题时先看前者，确认「谁贡献了什么」再看后者。

**同一份转录的三种视角**：

- **存储视角**（`entries()` / `view.entries`）：所有写入都在，包括被 head 覆盖的、被 edit 替换来源的、被排除的助手消息。适合 UI 展示与审计。
- **上下文视角**（`view.messages`）：模型实际会收到的消息，规则 1–6 全部生效。排查「模型为什么这样回答」时看这一层。
- **请求视角**：生成栈还会做它自己的事——按 `cutoff` 固定请求边界、把 system entry 按位置拼进去（3.2 节）。这一层不在本示例的输出里。

把「转录 → 上下文」看成一个**纯函数**是理解恢复语义的关键：给定同一份存储与同一个 head 标记，推导结果必然相同，所以重放不需要额外状态。25 的 compaction 之所以能用「一条 head entry」概括一次压缩，也是因为这个函数只认存储。

**更细的读输出方法**：

- 想知道「哪条 entry 贡献了几条消息」：打印 `view.contributions`（示例没打印它）并按 index 与 `view.entries` 对齐——比数 `messages` 更直接。
- 想知道「为什么这条 system 消息排在这里」：看它在存储里的位置。09 的 `pi.system` 在 `result(b)` 与 `result(a)` 之间，重排后落到两条 result 之后——**重排只动工具结果，其它消息保持相对顺序**。

**再加两个实验**：

- 把 `pi.system` entry 移到两条 result 之后再提交：上下文里它的位置也跟着走，验证上一条判断。
- 删掉 `await say("message", toolResultMessage("a"))`：`request messages` 里会出现一条合成的 `result(a) error`，而存储里没有对应的 tool-result entry——合成确实发生在推导层。

**对应源码/测试**：`src/harness/context.ts:8`（排除集合）、`:9`（合成结果文案）、`:22-39`（边界采集）、`:59-82`（推导主流程）、`:121-122`（`selectActive`）、`:125-163`（`orderToolResults` 与 `missingResult`）、`src/session/session.ts`（`Conversation.context()` 的入口）、`test/harness-context.test.ts:21`（无 head 时返回整段转录、排除无 `model` 的 entry）、`:32`（排除 aborted / error / deferred，但保留原始 entry）、`:45`（`self` head 与最新 head 标记）、`:65`（同一目标的最新 edit 生效）、`:86`（位置化 system 消息与按调用顺序的工具结果）、`:108`（分叉后合成缺失结果、丢弃被截断的结果）、2.6 节、3.2 节（生成时如何使用这些消息）。

### 5.3.5 10-registry-reload.ts —— 同名 install 就是原子重载

**它演示什么**：扩展代码要能热替换，但会话又不能在中途看到「工具不存在」。注册表的答案是：**同名 install = 就地替换，一次发布**。同时演示 `wraps`——另一个扩展可以装饰「胜出的」工具，而且在被包装工具重载后依然有效。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/10-registry-reload.ts
```

**关键代码**（`test/examples/10-registry-reload.ts:31-46`；原文 27-30 行的注释是「Reloading is installing a new object with the same name: it replaces the old one in place, in one publication, so no conversation ever sees it missing. A task phase that already started keeps the snapshot it took; the next phase uses the new code.」）：

```typescript
// 同名 install：grep 的描述被换成新版本，一次发布里完成
registry.install(defineExtension({ name: "files", tools: [read, exampleTool("grep", "Search files, faster")] }));
console.log("after reload:", await tools());

// audit 扩展不提供工具，只包装 read（按工具对象包装，不按名字）
const Audit = defineExtension({
	name: "audit",
	wraps: [wrapTool(read, (tool) => ({ ...tool, description: `${tool.description} (audited)` }))],
});
registry.install(Audit);
console.log("with audit:", await tools());

// 卸载 audit：描述恢复，files 不受影响
registry.uninstall(Audit);
console.log("after uninstall:", await tools());
```

**逐点解释**：

1. 两个 `files` 扩展同名：新的替换旧的，`grep` 的描述从 `Search files` 变成 `Search files, faster`。替换是**一次发布**——没有「旧的先删、新的再装」的中间态（`test/harness-registry.test.ts:72`「installs, replaces in place, and uninstalls extensions by name」）。
2. 热重载不碰存储：会话里存的仍是 `files` 这个名字，所以「重载」只影响解析结果，不影响任何会话的持久状态。31 会在跨进程的场景里把这条规则再验证一次。
3. `wrapTool(read, wrapper)` 的包装在**解析时**应用，而不是在安装时改写原对象：包装者没被选中，包装就不生效；原工具被重载，包装仍然作用在「胜出者」上（`test/harness-registry.test.ts:180`「replaces same-name tools in place, wraps the winner, then applies the filter」）。
4. 卸载 audit 后描述回到 `Read a file`，说明 wrap 的寿命跟着包装者，而不是把改动写进了 `read` 本体。
5. 「已经跑起来的 phase 用旧代码」这条来自定义时注释的承诺：任务在一个 phase 里取一次注册表快照，phase 边界才刷新（`test/harness-tasks.test.ts:310`「keeps one registry snapshot per phase and refreshes it at the phase boundary」）。10 是纯进程内演示，没有跑任务，但这是重载安全性的另一半。

**你会看到**（实测输出，原样引用）：

```text
after reload: [ 'read: Read a file', 'grep: Search files, faster' ]
with audit: [ 'read: Read a file (audited)', 'grep: Search files, faster' ]
after uninstall: [ 'read: Read a file', 'grep: Search files, faster' ]
```

6. 输出里 `tools()` 打印的是 `名字: 描述`，所以三行就能看出「谁被重载了、谁被包装了、包装撤掉之后是什么样」。

**动手改**：

1. 把新 `files` 的工具数组改成只有 `[read]`（删掉 grep）：`after reload` 只剩一行；再把旧版本装回来，`grep` 又出现。重载不仅能改实现，也能改**工具集合本身**。
2. 把 `wrapTool(read, ...)` 的包装器改成直接 `throw new Error("boom")`：被包装的工具会被丢弃并报告失败（`test/harness-registry.test.ts:214`「drops a tool or section whose wrapper throws or renames it and reports the failure」）。这能让你看清「包装失败」不会拖垮整个注册表。
3. 把 `registry.uninstall(Audit)` 之后的两行改成先 `install(Audit)` 再 `uninstall(Audit)`：立刻看到描述来回切换。如果会话里存的是代码对象而不是名字，这种来回切换是不可能实现的——对照 07 的 `stored` 输出。

**边界与易错点**：

- **同名替换分两层**：扩展整包替换（一次发布），同名工具就地替换且 **wrap 之后再套过滤**（`test/harness-registry.test.ts:180`）。
- **包装失败是显式的**：wrapper 抛错或者把工具改名，会让该工具 / 段落被丢弃并报告失败（`:214`），不会静默生效一半。
- **phase 级快照**：跑在 phase 里的任务用的是 phase 开始时的注册表快照，phase 边界才刷新（`test/harness-tasks.test.ts:310`）——这就是「热重载不打断正在跑的调用」的机制。
- **重载对存储零影响**：会话里存的是名字；31 会跨进程验证同一条规则。
- **重载是替换不是追加**：同名 install 不会产生两份选择项，也不会让旧版本继续被解析到。

**和后面的示例怎么接**：

- 31 把这条规则推到跨进程：重启后同名扩展由新进程重新安装，会话选择自动重新绑定。
- 30 用 `wrapTool` 包装 bash 并计时，是 wrap 的生产用法。
- 27 用选择（`extensions: { add }`）切换工具集，而不是卸载代码——两种手段的区别值得对照。

**再读一遍输出，容易漏看的两处**：

- `(audited)` 只出现在 read 那一行：包装只作用于被包装的那个工具，且只在包装者被选中时生效。
- `after reload` 与 `after uninstall` 的 grep 描述相同：重载的结果被保留，卸载 audit 不影响它——两件事互不干扰。

**再练两个实验**：

- 调换安装顺序（先 audit 后 files）：由于 wrap 作用于「胜出者」，观察描述是否仍然加在最终生效的那个 `read` 上（`:180` 的规则）。
- 在 `wraps` 里返回改名后的工具（`{ ...tool, name: "read2" }`）：按 `:214` 的规则会被丢弃并报告失败——包装不能改名是一条硬约束。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `registry.install(extension)` | 安装 / 同名替换（一次发布） | `src/harness/registry.ts` |
| `registry.uninstall(name)` | 按名字卸载 | `src/harness/registry.ts` |
| `defineExtension({ name, tools, sections, hooks, tasks, wraps })` | 扩展的全部声明面 | `src/harness/define.ts:6` |
| `wrapTool(tool, wrapper)` | 按工具装饰（解析时应用） | `src/harness/define.ts:34` |
| `wrapSection(key, wrapper)` | 按 section key 装饰 | `src/harness/define.ts:39` |

**对应源码/测试**：`src/harness/registry.ts`（install / uninstall / 解析）、`src/harness/define.ts:6`、`:34`（`defineExtension` / `wrapTool`）、`test/harness-registry.test.ts:71`、`:72`、`:180`、`:214`、`test/harness-tasks.test.ts:310`、2.12 节、3.7 节。

### 5.3.6 11-extension-state.ts —— 扩展自己的文档：工具写、section 读

**它演示什么**：一个扩展怎么拥有「每个会话一份」的状态。答案是文档：扩展在模块里声明 `defineDoc`，工具在执行时写它，section 在每次请求前把它渲染成提示词段落。示例用一个 todo 工具走完整条链路，并展示「文档为空时段落不出现」这个细节。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/11-extension-state.ts
```

**关键代码 A：扩展声明**（`test/examples/11-extension-state.ts:34-55`）：

```typescript
const Todo = defineExtension({
	name: "todo",
	tools: [
		defineTool({
			name: "todo",
			description: "Add an item to your todo list",
			parameters: Type.Object({ item: Type.String() }),
			// 工具通过 api 提交：api.conversationId 是这次调用所属的会话
			execute: async (args, api, callContext) => {
				await api.commit(async (tx) => {
					(await tx.doc(Todos, api.conversationId)).items.push(args.item);
				}, callContext);
				return { content: [{ type: "text", text: `added ${args.item}` }] };
			},
		}),
	],
	// section 在每次请求前渲染；返回 undefined 表示这一段没有内容
	sections: [
		section("todos", async (input, renderContext) => {
			const todos = await input.read.snapshot(Todos, input.conversationId, renderContext);
			return todos === undefined || todos.items.length === 0 ? undefined : todos.items.join("\n");
		}),
	],
});
```

**关键代码 B：跑两轮并检查 system entry**（`test/examples/11-extension-state.ts:65-84`）：

```typescript
// faux provider：脚本化模型，第一次回一个 todo 工具调用，后面的回文本
faux.setResponses([
	fauxAssistantMessage(fauxToolCall("todo", { item: "fix the build" }), { stopReason: "toolUse" }),
	fauxAssistantMessage("Noted."),
	fauxAssistantMessage("Working on it."),
]);
await (await root.submit({ type: "input", content: "Remember to fix the build." }, context)).wait(context);
console.log("todos:", await harness.snapshot(Todos, root.id, context));

// 下一轮请求的 system prompt 里带上清单；第一轮的 system entry 只有工具变化、没有段落
await (await root.submit({ type: "input", content: "What is next?" }, context)).wait(context);
const { messages } = await root.context(context);
console.log(
	"system messages:",
	messages.flatMap((message) =>
		message.role === "system"
			? [{ sections: message.sections, toolsAdded: message.toolsAdded?.map((tool) => tool.name) }]
			: [],
	),
);
```

**逐点解释**：

1. 文档定义（第 22-29 行）用 `history: "rewindable"` + `fork: "asOf"`：todo 列表保留历史，分叉副本继承分叉点的清单。扩展状态的可见性完全由这两个字段决定。
2. 工具写状态走 `api.commit`，与普通 `session.commit` 同语义；`api.conversationId` 让同一个工具在多会话下各写各的文档。工具返回的 `content` 与「写入」是两条独立输出：前者给模型看，后者进存储（见 2.16 节）。
3. section 读文档用的是**已提交读**（`input.read.snapshot(...)`，`renderContext` 提供提交上下文）：渲染发生在生成任务的一次提交里，所以它只能看到已提交值。这个限制是好事——它保证「模型看到的状态」是可复现的。
4. section 返回 `undefined` 表示「这段没有内容」，不会写入空段落：第一轮请求的 system entry 里 `sections: undefined`、只有 `toolsAdded: ['todo']`；第二轮才有 `sections.todos`。
5. 段落默认渲染成 `<key>...</key>` 包裹：输出里是 `'<todos>\nfix the build\n</todos>'`。想原样发送要写 `tag: false`（15 的 `preamble` 就是这么做的）。
6. 两轮请求合起来说明 system entry 是**增量的**：第一轮只记工具变化，第二轮补上段落——存储里留下的是「模型当时看到过什么」的证据。

**你会看到**（实测输出，原样引用）：

```text
todos: { items: [ 'fix the build' ] }
system messages: [
  { sections: undefined, toolsAdded: [ 'todo' ] },
  {
    sections: { todos: '<todos>\nfix the build\n</todos>' },
    toolsAdded: undefined
  }
]
```

**动手改**：

1. 把 section 渲染改成 `todos.items.join(", ")`：第二轮 system entry 的 `sections.todos` 变成单行，而 `todos:` 那行（存储里的真值）不变。section 只影响提示词，不影响状态。
2. 把工具返回的 `content` 文本改成空串 `""`：文档照样写入，但模型看到的工具结果为空。这能帮你区分「持久化的副作用」和「本次工具调用的回报」。
3. 把第一轮 faux 响应从工具调用改成普通文本（`fauxAssistantMessage("ok")`）：todos 不会被写，第二轮 system entry 里也就没有 `todos` 段——状态完全由工具写的文档决定，模型说了什么都不影响它。

**边界与易错点**：

- **文档定义在模块级声明一次**：`kind` 是全局命名空间；同一份文档不要声明两个 token，否则会出现「同名不同代」的解析歧义。
- **section 的排序与替换**：按扩展顺序排列，同 key 就地替换，`instructions` 永远最后且不包裹（`test/harness-prompt.test.ts:241` 的标题即这三条）。
- **渲染失败有处理路径**：`test/harness-prompt.test.ts:72` 的断言覆盖了 wrapper 与 failures 场景；别让 section 抛错成为唯一没被验证的角落。
- **空段落用 `undefined` 表达**：返回空字符串会写出一条内容为空的段落，语义不同。
- **工具的 `content` 与持久写入是两条路**：一条给模型看、一条进存储（2.16 节）；把「工具是否成功」和「状态是否写入」分开检查。

**和后面的示例怎么接**：

- 14 用同样的 section 机制写「一句话回答」的提示词；15 深入标签、增量与 `wrapSection`。
- 27 把扩展状态换成计划文档，并用 `control: { terminate: true }` 结束回合。
- 28 用 `onYield` 钩子在回答之间循环，是「扩展状态驱动流程」的另一种写法。

**再读一遍输出，容易漏看的两处**：

- `sections: undefined` 与 `sections: { todos: ... }` 的对比说明 system entry 是**按需生成**的，不是每轮写一份完整提示词。
- `toolsAdded: [ 'todo' ]` 出现在第一条 system entry 上：工具清单的变化也走 system entry，与段落是同一条通道（15 会展开）。

**再练两个实验**：

- 给 section 加 `{ tag: false }`：输出里 `sections.todos` 从 `'<todos>\n...\n</todos>'` 变成裸文本，一行代码改变包裹方式。
- 把 `Todos` 的 `history` 改成 `"latest"`：本例输出不变（只读最新值），但分叉副本的行为会变——把它和 02 的 `rewindable` 对照，这两个字段的组合就齐了。

**本节 API 速查**：

| API | 作用 | 定义位置 |
| --- | --- | --- |
| `defineDoc({ kind, history: "rewindable", fork: "asOf" })` | 扩展私有的会话状态 | `src/documents.ts:39` |
| `defineTool({ execute: (args, api, callContext) => ... })` | 工具拿到 `api` 与调用上下文 | `src/harness/define.ts:13` |
| `api.commit(fn, callContext)` | 工具里的提交入口 | `src/harness/tool.ts` |
| `api.conversationId` | 本次调用所属会话 | `src/harness/tool.ts` |
| `section(key, render, options?)` | 每次请求前渲染提示词段落 | `src/harness/define.ts:20` |
| `input.read.snapshot(token, id, ctx)` | section 里的已提交读 | `src/harness/prompt.ts` |
| `fauxProvider()` / `faux.setResponses([...])` | 脚本化模型（离线可复现） | `@earendil-works/pi-ai/providers/faux` |

**对应源码/测试**：`src/harness/prompt.ts`（section 渲染与 system entry 规划）、`src/harness/tool.ts`（`ToolExecutionApi` 与 `api.commit`）、`src/documents.ts:39-54`、`test/harness-prompt.test.ts:72`（按顺序渲染、标签、省略、包装与失败）、`:206`（tool loadout 的准备）、`test/harness-tools.test.ts:695`（tool execution api）、`test/harness-context.test.ts:86`（system 消息进入上下文）、2.14 节、2.16 节。

### 5.3.7 12-tasks.ts —— 持久任务：phase、checkpoint、owner 与「不等到有人要结果就不跑」

**它演示什么**：把一段有副作用的业务逻辑（这里是一次支付）写成**持久任务**：状态机由 phase 组成，每一步的「下一步做什么」与「结果」通过 checkpoint 落盘，进程重启后从最后一个 checkpoint 继续。示例还演示两件常被误解的事：任务归属（owner）决定 abort 与空闲等待能到哪；`createTask` 只是登记，**没有调用要求进展，任务就不会被执行**。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/12-tasks.ts
```

**关键代码 A：任务定义**（`test/examples/12-tasks.ts:15-45`）：

```typescript
const payments = new Map<string, number>();
type PaymentState = { phase: "prepare" } | { phase: "charge"; key: string };
const Payment = defineTask<{ amount: number }, PaymentState, { receipt: number }>({
	name: "example.payment",
	version: 1,
	initial: () => ({ phase: "prepare" }),
	// 一个 phase 一个 handler；每个 handler 都要用 runtime.commit() 保存进展
	phases: {
		prepare: async (task, runtime, taskContext) => {
			// 先把「要做什么」写进 checkpoint：key 就是这次收费的幂等键
			await runtime.commit(
				() => ({ status: "running", checkpoint: { phase: "charge", key: `payment-${task.id}` } }),
				taskContext,
			);
		},
		charge: async (task, runtime, taskContext) => {
			const key = task.state.checkpoint.key;
			// 假支付服务：同一个 key 只收一次（真实系统里这个去重要在服务端）
			if (!payments.has(key)) payments.set(key, task.input.amount * 100);
			const receipt = payments.get(key)!;
			// 把「结果」写进终态，与回调里写的其它东西同批落盘
			await runtime.commit(
				() => ({ status: "terminal", outcome: { status: "completed", result: { receipt } } }),
				taskContext,
			);
		},
	},
	// harness.abortTask() 之后跑它而不是 phases；终态由它决定
	abort: async (_task, runtime, taskContext) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext);
	},
});
```

**关键代码 B：注册、创建、等待**（`test/examples/12-tasks.ts:50-62`）：

```typescript
// 任务定义住在扩展里：Harness 按任务 name 到注册表里找它
const registry = createRegistry();
registry.install(defineExtension({ name: "payments", tasks: [Payment] }));
const harness = await Harness.open(new MemoryStorage(), { models: createModels(), registry }, context);
const root = await harness.root(context);
// 每个任务都要声明归属：这个属于 root 会话
const paymentId = await root.commit(
	(tx) => tx.createTask(Payment, { amount: 5 }, { ownership: { kind: "conversation" } }),
	context,
);
// 完成的记录就是持久收据；waitForTask() 知道它的 result 类型
const paid = await harness.waitForTask(paymentId, context);
console.log("payment outcome:", paid.state.outcome);
```

**逐点解释**：

1. **任务定义就是一个类型化的状态机**。`defineTask<Input, State, Result>`（`src/tasks.ts:4`）里，`State` 是 checkpoint 的类型：`{ phase: "prepare" } | { phase: "charge"; key: string }`。phase 名与状态字段写在同一个联合类型里，所以读到 `{ phase: "charge", key }` 时 `key` 的类型是确定的——不需要断言，也不需要把状态塞进 `any`。
2. **一个 phase 一个 handler**，签名固定为 `(task, runtime, taskContext)`。`task.id` / `task.input` / `task.state.checkpoint` 是持久数据；`runtime` 是这一步的能力面：`commit`、`memo`、`sleep`、`conversation`、`outcomes` 等（2.7 节）。示例只用了 `commit`，其他能力分别在 13（`memo`、`sleep`）与 24（`outcomes`）出现。
3. **checkpoint 由 `runtime.commit` 的返回值决定**：回调返回 `{ status: "running", checkpoint }` 表示「还没完，下一步从这里继续」，返回 `{ status: "terminal", outcome }` 表示「结束，这是结果」。回调里写的**其它东西**（比如 entry 或文档）与这个返回值同批落盘——`test/harness-tasks.test.ts:189` 的断言是「commits results with entries atomically, keeps memos until terminal, and retires task documents」。
4. **没有持久进展的 phase 会被 fault**。handler 跑完却不 commit 任何 checkpoint/终态时，任务不会静默成功（`test/harness-tasks.test.ts:121`「faults a phase without durable progress and a throwing phase」）。这条规则把「忘了保存进度」从隐性 bug 变成显式失败——值得记住，因为它是运行时唯一能替你发现的恢复缺陷。
5. **`prepare` 保存的是「意图」，不是结果**。它先写 `{ phase: "charge", key: "payment-<id>" }` 才进入 charge。这样无论崩溃点落在哪，恢复时都有「我打算做什么」的记录；`key` 是在**效果发生前**就固定下来的幂等键。
6. **`charge` 用 key 表达幂等**：`if (!payments.has(key)) payments.set(...)`。注意这个 `Map` 在进程内、不持久——示例用它模拟「同一个 key 只收一次」的支付服务。示例注释直说：the step must be safe to repeat。真正的幂等要么由服务端的 key 去重保证，要么由 `runtime.memo` 在本地记录（13 会演示后者）。
7. **owner 决定传播方向**：`{ ownership: { kind: "conversation" } }` 让任务挂在这个会话下，abort 与「等会话空闲」都会顺着所有权走到它（2.7、3.6 节）。任务也可以被另一个任务拥有（24-child-tasks 的父子结构就是这么建的）。
8. **任务定义在进程里、任务记录在存储里**。`registry.install(defineExtension({ name: "payments", tasks: [Payment] }))` 提供代码，`createTask` 只写记录。两者分开带来一个必须知道的后果：**定义缺失时任务会阻塞而不是失败**（`test/harness-tasks-recovery.test.ts:400`「keeps a task with a missing definition pending, and live for idle waits, until registration」），31 会在跨进程场景里碰到它。
9. **创建不等于执行**。任务在被调度前一直是 `pending`：示例注释写明「Nothing runs until resume() or a call that waits for progress, such as waitForTask()」。`harness.waitForTask(paymentId, context)` 同时扮演两个角色——**要求进展**（否则调度器不动）与**等待结果**；返回的是已完成的任务记录，所以 `paid.state.outcome` 直接是终态。
10. **结果形状**：`{ status: 'completed', result: { receipt: 500 } }`，其中 `receipt = amount × 100 = 5 × 100`。`status` 的终态有 `completed` / `failed` / `aborted` 三种；`failed` 的形状（`{ status: 'failed', error: { message } }`）在 24-child-tasks 里能看到。

**你会看到**（实测输出，原样引用）：

```text
payment outcome: { status: 'completed', result: { receipt: 500 } }
```

**这个示例的崩溃窗口在哪**：任务一旦真的跑起来，崩溃点只可能落在两个位置——(a) 某个 `runtime.commit` 之前，(b) 之后。

- 落在 `charge` 的 commit **之前**：任务仍是 `{ phase: "charge", key }`，重跑会再次执行 charge。进程内的 `Map` 在这次运行里没问题，但换成真实支付就必须靠服务端 key 去重。
- 落在 `charge` 的 commit **之后**：任务已经 terminal，重跑什么都不做（`test/harness-tasks-recovery.test.ts:359`「crash after the terminal outcome: nothing runs again」）。

示例本身没有真的中断（它是单进程的一口气跑完），所以这两个窗口要靠 13 那种「在窗口里关掉 Harness」的手法才能看到。把 12 和 13 连起来读，你会得到完整的「意图 / 效果 / 结果」三件套。

**动手改**：

1. 删掉 `charge` 里的整个 `runtime.commit(...)`（保留计算与 `receipt`）：phase 结束时没有持久进展，任务会被判 fault，`payment outcome` 不再是 `completed`。这条实验让你亲眼看到规则 4 在起作用。
2. 把 `await harness.waitForTask(paymentId, context)` 换成 `const waiting = await harness.getTask(paymentId, context); console.log("record:", waiting?.state);`（打印要在 `harness.close` 之前）：任务停在 `pending`，永远不会被执行——「没有调用要求进展就不跑」这句话的最短证明。
3. 把 `{ amount: 5 }` 改成 `{ amount: 7 }`：`receipt: 700`。结果完全由 input 与 phase 代码算出来，checkpoint 只保存「下一步做什么」；这能帮你分清「状态」和「结果」在任务记录里的不同位置。
4. 把 `prepare` 的 commit 改成一直回到 `prepare`（`{ phase: "prepare" }`）：任务会反复准备下去，永远不终态。这是理解「phase 的推进完全由你的返回值决定」的反面教材——真写出来时记得加一个次数上限或 memo 判断。

**任务记录里到底存了什么**（把 `paid` 整个打印出来就能对上）：

- `state.status`：`pending` / `waiting` / `running` / `terminal` 之一。13 会看到 `pending`，24 会看到 `waiting`。
- `state.checkpoint`：你的联合类型实例——恢复时读的就是它（`phase` 与 `key` / `n` 这些字段）。
- `memos`：任务级的「已完成副作用」记录（13 详述）。
- `state.outcome`：终态才有，`completed` / `failed` / `aborted` 之一。输出里的 `{ status: 'completed', result: { receipt: 500 } }` 是 `outcome`，不是 `state`。

**三个时间点，决定了重启后会发生什么**：

1. **创建提交**：记录出现（`owner`、`input` 落盘），此时没有任何代码在跑。
2. **phase 开始**：调度器从注册表取定义（phase 级快照），handler 开始执行；`input` 与 `checkpoint` 是这一轮的输入。
3. **phase 结束**：`runtime.commit` 的返回值决定下一步——同一个 phase 再来、换 phase、或终态。

记录在存储里、定义在进程里、checkpoint 决定继续的位置：这三句话就是恢复语义的全部（3.6 节）。

**再加两个实验**：

- 先把存储换成 SQLite（照抄 13），再在 `charge` 里 `await runtime.sleep(Date.now() + 60_000, taskContext)` 后提交终态：任务会停在 `running`。进程结束后重新运行脚本，观察它是否从 charge 继续并完成——这是 13 的跨进程续跑在 12 上的最小版本。
- 给 `abort` 处理器加一行 `console.log`，并在 `waitForTask` 之前插入 `await harness.abortTask(paymentId, context)`：观察终态与 abort 处理器的执行情况，并与 2.7 节描述的 abort 语义逐条对照——12 定义了 `abort`，这个实验才让你真正用到它。

**phase 边界与注册表快照**：任务不是「每次调用定义都重新解析」——phase 开始时取一次 agent 与注册表快照，phase 内保持一致，到 phase 边界才刷新（`test/harness-tasks.test.ts:310`、`:359`）。这条与 10 的「热重载不打断正在跑的调用」是同一机制的两面：长任务能横跨多次重载，而每个 phase 的行为在它开始时就被固定。想亲手验证：写一个两个 phase 的任务，在第一个 phase 的 `sleep` 期间用同名对象 `install` 一份改了行为的定义——第一个 phase 仍按旧代码跑完，第二个 phase 才换新定义（`test/harness-tasks.test.ts:627` 的「hands over at the next phase boundary to a same-version replacement without overlap」就是这条）。

**这一档状态机不是全部**：需要等别的任务时，phase 不用忙等，而是返回 `{ status: "waiting", checkpoint, on: [...], policy }`——调度器在 `on` 里的任务全部终态后继续（`test/harness-tasks.test.ts:258`）。`failFast` 之类的策略在 24-child-tasks 里演示；12 的顺序 phase 是最简单的一档，读到 24 时回头对照本节的状态机更清楚。

**再补两个实验**：

- 把 `version: 1` 改成 `2`，用同一个 SQLite 存储再跑一次：旧记录与新定义的版本不一致，会进入阻塞 / 迁移路径（`test/harness-tasks-recovery.test.ts:418`「keeps a task stored by a newer version pending until a fitting definition is registered」、`:432`）。这是「任务定义可以升级」的现实入口，也是跨版本部署时必须想清楚的一步。
- 把 `phases` 拆成 `prepare → charge → receipt` 三个 phase（加一个只打印的 phase）：checkpoint 每步落盘、`waitForTask` 的返回不变——phase 的**数量**不影响对外结果，只影响恢复粒度与可观察的中间状态。

**对应源码/测试**：`src/tasks.ts:4`（`defineTask`）、`src/harness/scheduler.ts`（phase 执行、checkpoint 提交、调度与 fault）、`src/harness/types.ts`（`TaskDefinition` / `Runtime` / `Next` 的形状）、`test/harness-tasks.test.ts:87`（一条调用穿过 checkpoint 并带类型结果完成）、`:121`、`:189`、`:258`（`waiting` 状态在 `on` 里的任务全部终态后继续）、`:310`（phase 级注册表快照）、`test/harness-tasks-recovery.test.ts:112`、`:359`、`:400`、`test/harness-task-graph.test.ts:83`、2.7 节、3.1 节、3.7 节。

### 5.3.8 13-recovery.ts —— 崩溃点与 memo：副作用不重复

**它演示什么**：把「崩溃」精确地放在**副作用已经发生、结果还没保存**的窗口里，然后用 memo 证明重跑不会重复副作用。这是「意图 / 效果 / 结果」三段式最完整的一次演示：SQLite 存储、一个每 tick 都会打印的任务、三次打开关闭，最后自己清理临时目录。

**运行**：

```bash
node --conditions=source --experimental-strip-types test/examples/13-recovery.ts
```

**关键代码 A：tick phase 的三段式**（`test/examples/13-recovery.ts:21-53`）：

```typescript
const Ticker = defineTask<{ to: number }, { phase: "tick"; n: number }, string>({
	name: "example.ticker",
	version: 1,
	initial: () => ({ phase: "tick", n: 1 }),
	phases: {
		tick: async (task, runtime, taskContext) => {
			const n = task.state.checkpoint.n;
			// memo 保留同名第一次写入的值：进程若在「打印后、保存前」死掉，
			// 重跑会看到这个 memo，于是不再打印同一个 tick
			if ((await runtime.memo(`printed-${n}`, taskContext)) === undefined) {
				await runtime.memo(`printed-${n}`, true, taskContext);
				console.log(`tick ${n}`);
			}
			reachedTick(n);
			// 保存结果：下一个 tick，或最终结果
			await runtime.commit(
				() =>
					n === task.input.to
						? { status: "terminal", outcome: { status: "completed", result: `counted to ${n}` } }
						: { status: "running", checkpoint: { phase: "tick", n: n + 1 } },
				taskContext,
			);
			// 每 tick 之间等一小会。关闭 Harness 会取消这个等待；
			// 上面保存的 checkpoint 就是下一个 Harness 继续的位置。
			await runtime.sleep(Date.now() + 50, taskContext);
		},
	},
	abort: async (_task, runtime, taskContext) => {
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext);
	},
});
```

**关键代码 B：三次打开关闭**（`test/examples/13-recovery.ts:62-89`）：

```typescript
// 第一次运行：开始数到 5，并在 tick 2 打印后立刻关闭——正好落在「效果已发生、结果未保存」的窗口里
const firstRun = await open();
const tickerId = await (await firstRun.root(context)).commit(
	(tx) => tx.createTask(Ticker, { to: 5 }, { ownership: { kind: "conversation" } }),
	context,
);
const tickTwo = new Promise<void>((resolve) => {
	reachedTick = (n) => {
		if (n === 2) resolve();
	};
});
firstRun.resume();
await tickTwo;
await firstRun.close(context);
reachedTick = () => {};

// 用一个从不 resume 的 Harness 只读记录：不要求进展，就什么都不会跑
const reader = await open();
const saved = (await reader.getTask(tickerId, context))!;
await reader.close(context);
console.log("closed; saved checkpoint:", saved.state, "memos:", saved.memos);

// 第二次运行：不需要任何「恢复」代码。等待未完成的任务会开启调度并继续它；
// tick 2 会重跑（结果没保存），但 memo 说它已经打印过。
const secondRun = await open();
const counted = await secondRun.waitForTask(tickerId, context);
console.log("after reopen:", counted.state.outcome);
await secondRun.close(context);
```

上面省略的第 17-18 行是存储的建立，第 54-57 行的 `open()` 每次新建 Harness 并指向同一个文件：

```typescript
const directory = await mkdtemp(join(tmpdir(), "pi-durable-example-"));
const databasePath = join(directory, "session.sqlite");
// ...
const open = async () =>
	Harness.open(await openNodeSqliteStorage(databasePath), { models: createModels(), registry }, context);
```

**逐点解释**：

1. **存储换了，运行时不用换**。`openNodeSqliteStorage(databasePath)` 让三次打开共享同一份数据；每次 `open()` 都是一个**全新的 Harness**，没有任何内存状态被继承。恢复能力来自存储里的任务记录，不来自进程。
2. **三段式的顺序就是全部设计**：先写 memo（意图：我要开始副作用了）→ 打印（效果）→ commit（结果：下一步是 n+1，或者终态）。顺序换来的是「哪个窗口可重复、哪个窗口不可重复」的确定性。
3. **memo 的语义**：`runtime.memo(name, context)` 读，`runtime.memo(name, value, context)` 写；同名只保留**第一次**写入的值，并且一直保留到任务终态（`test/harness-tasks.test.ts:189` 明确断言 memos 保留到 terminal）。所以 `printed-2 = true` 的含义是「这个副作用已经做过了」，而不是「这个 tick 的数字」。
4. **关闭时机是刻意选的**：`reachedTick` 在 tick 2 之后 resolve，`await tickTwo` 紧接着 `await firstRun.close(context)`。关闭会取消之后的等待（第 47 行的 `runtime.sleep`），所以这次关闭落点正好是「tick 2 已打印、`commit` 还没执行」。这不是伪造的状态，而是真在那一刻掐掉的进程。
5. **只读也要开 Harness**。`reader` 从不 `resume()`，只用 `getTask` 读数：不要求进展就什么都不跑（12 的规则 9），这正是它适合做「验尸」的原因。
6. **两个窗口的逐行对照**：

```text
tick(2)                                 // 第一次运行
  memo("printed-2") == undefined ?  yes -> write memo -> print "tick 2"
  close lands here                      // 效果已发生；结果尚未保存
  commit({ phase: "tick", n: 3 })       // 未执行

tick(2) again                           // 重开之后
  memo("printed-2") == true  ->  skip print
  commit({ phase: "tick", n: 3 })       // 保存，继续到 3、4、5
```

7. **输出里最关键的三个证据**（对应下一节的原始输出）：`saved checkpoint` 显示 `{ phase: 'tick', n: 2 }`（结果没保存）、`memos` 显示 `printed-1`、`printed-2` 都已置位（副作用记录已保存）、第二轮从 `tick 3` 开始且**没有**重复打印 1、2。
8. **恢复不需要恢复代码**。第二次运行只是「打开存储 + 要求进展」，`waitForTask` 触发的调度器看到 pending 的任务、按最新 checkpoint 继续。示例里没有任何一行是「检测崩溃并修复」。
9. **收尾由示例负责**：最后一行 `await rm(directory, { recursive: true, force: true })` 删掉临时 SQLite 目录。13、23、24、31 都属于「自己清理」的一类；17、19 则故意保留产物供检查。

**你会看到**（实测输出，原样引用）：

```text
tick 1
tick 2
closed; saved checkpoint: { status: 'pending', checkpoint: { phase: 'tick', n: 2 } } memos: { 'printed-1': true, 'printed-2': true }
tick 3
tick 4
tick 5
after reopen: { status: 'completed', result: 'counted to 5' }
```

10. 注意 `status: 'pending'`：任务在存储里的状态是「待继续」而不是失败或取消，所以重开会自然地接着跑。`after reopen` 的终态是 `counted to 5`，说明恢复后的推进与一路顺畅跑完没有区别。

**动手改**：

1. 去掉 memo 判断，让 `console.log` 无条件执行：重开后 tick 2 会打印两次（`tick 1, tick 2, tick 2, tick 3, tick 4, tick 5`）。这是「没有 memo 就会重复副作用」的最直接证据，也是 12 里那句 the step must be safe to repeat 的现实版。
2. 把关闭时机从 `n === 2` 改成 `n === 4`：`saved checkpoint` 那行变成 `n: 4`、`memos` 到 `printed-4`，重开后从 4 继续、依旧不重复打印。机制与崩溃点位置无关——这是「检查点 + memo」比「记住最后一次」更可靠的原因。
3. 把 `runtime.commit(...)` 整段挪到 `console.log` **之前**：崩溃窗口变成「已前进、没打印」，重开后不会重复打印（`n` 已经推进），但输出里会**少**一条 `tick 2`。两种顺序对应两种可观测的失败模式，选择取决于副作用能否重做：可重做的（幂等写）适合先 commit，不可重做的（发通知、扣款）适合先 memo。
4. 把 `to: 5` 改成 `to: 10` 并把每 tick 的等待调到 200ms（`runtime.sleep(Date.now() + 200, taskContext)`）：你会看到同样的三段行为只是更长，同时能体会 `sleep` 的 deadline 是墙钟时间、close 会立刻取消它（第 47 行的注释）。

**memo / checkpoint / sleep 的分工**：

| 机制 | 记录什么 | 生命周期 | 典型用途 |
| --- | --- | --- | --- |
| `checkpoint` | 「下一步做什么」（phase + 数据） | 每次 `runtime.commit` 覆盖 | 决定恢复的起点 |
| `memo` | 「这件事已经做过了」（同名只留第一次的值） | 保留到任务终态 | 让不可重复的副作用幂等 |
| `sleep` | 「等到这个墙钟时刻」 | 可被 close 立即取消 | 轮询、退避、限速 |

三者可以组合，但职责不能互换：checkpoint 回答「走到哪」，memo 回答「副作用做过没有」。13 的欣赏点就在于它把两者放在了同一个 phase 里，并且顺序正确。

**这个示例能证明的三条不变量**：

1. 恢复的起点永远是**最后一个已提交的 checkpoint**，不是「最后打印的一行」。`saved checkpoint` 显示 `n: 2` 而 `tick` 已经打到 2，这两件事同时为真并不矛盾。
2. 已写入存储的东西（checkpoint、memo、entry）在重跑里只增不改，所以重跑不会退回更早的状态。
3. 「副作用是否已发生」只能由 memo 或服务端幂等回答；不要试图从 checkpoint 推断它——12 的 `charge` 就是这么踩在边界上的。

**再加两个实验**：

- 把 memo 的名字改成与 `n` 无关的常量（例如 `"printed"`）：第一个 tick 之后所有 tick 都不再打印，任务却照样推进到终态——memo 的粒度完全由你决定，它不会替你做「按轮次去重」。
- 把 `runtime.sleep` 的 deadline 改成 `Date.now() + 5000`，并在 tick 1 之后立刻 close：任务停在 `{ phase: 'tick', n: 1 }`，重开后先跑完 tick 1（memo 阻止重复打印）再继续——sleep 被取消不会留下半保存状态。

**对应源码/测试**：`src/harness/scheduler.ts`（`memo` / `sleep` / checkpoint 的运行时实现）、`src/harness/types.ts`（`memo` 与 `sleep` 的签名）、`src/storage/sqlite/node.ts`（`openNodeSqliteStorage`）、`test/harness-tasks-recovery.test.ts:112`（intent/effect/outcome 任务在 close/reopen 后从意图继续）、`:223`（崩溃矩阵：标记已写入、abort 各阶段、终态之后……）、`test/harness-tasks.test.ts:189`（memo 保留到终态）、`test/harness-generation-recovery.test.ts`（生成栈的同类恢复）、3.6 节（恢复语义速查）。

---

## 5.4 C 组：agent 运行时（14–21）

C 组的八个示例回答同一个问题：`Harness` 接上之后，一次真实对话究竟发生了什么。14 是最小闭环（输入 → 系统提示词 → 回答），15 把系统提示词的存储形态摊开，16 换成真实 provider 并演示流式中间态，17 让模型真正动用工具，18 与 19 是两个宿主形态（print 模式、JSON 事件流），20 讲忙时排队，21 讲运行中途接入。除 17 用 JSONL、19 用 SQLite 之外都用 `MemoryStorage`，跑完不留状态，适合反复运行对照。

本组所有示例都用 `BACKGROUND_CONTEXT`（不可取消的调用上下文）和 faux provider 的脚本模型；脚本模型的输出固定，因此除时间戳外输出可逐字复现。

### 5.4.1 14-chat.ts —— 一轮聊天 = pi.user + pi.system + pi.assistant

**它演示什么**：把「提问 → 等回答 → 读回答」压到最短。它同时演示了持久化 harness 与普通 LLM 客户端的两点不同：用户输入和系统提示词都被存成 entry，而 `submit()`/`wait()` 是持久化的两段式（先落盘受理，再等结果），不是一次函数调用。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/14-chat.ts
```

**关键代码**（`test/examples/14-chat.ts:12-25`、`test/examples/14-chat.ts:31-44`）：

```typescript
const faux = fauxProvider();
const models = createModels();
// provider 挂在 pi-ai 的 Models 集合上，Harness 只通过 Models 接触模型。
models.setProvider(faux.provider);
// 脚本模型：下一次请求固定返回这段话。
faux.setResponses([fauxAssistantMessage("Paris.")]);

const registry = createRegistry();
registry.install(
	defineExtension({
		name: "terse",
		// 扩展携带系统提示词段落；tag: false 表示原样发送，不包 <preamble>。
		sections: [section("preamble", () => "You answer in one word.", { tag: false })],
	}),
);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
// root() 首次调用创建保留的根会话（id 固定为 1），第二次调用忽略参数。
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });

// submit() 在一次提交里持久化地受理输入，返回 Submission；空闲会话会同时创建 run。
const capital = await root.submit({ type: "input", content: "Capital of France?" }, context);
// wait() 等到这条输入被回答（done）或再也不可能被回答（unanswered）。
const answered = await capital.wait(context);
if (answered.status === "done" && answered.type === "input") {
	// answered.answer 是助手 entry 的 id；用一次只读提交把它取回来。
	const entry = await root.commit((tx) => tx.entry(AssistantEntry, answered.answer), context);
	const reply = entry?.model?.[0];
	console.log("answer:", reply?.role === "assistant" ? reply.content : reply);
}

// transcript 里存着用户输入、位置化的系统提示词和回答三类 entry。
const transcript = await root.entries({}, 10, undefined, context);
console.log(
	"transcript:",
	// entries() 是最新优先；reverse() 后按写入顺序打印 kind。
	[...transcript.items].reverse().map((entry) => entry.kind),
);
```

**逐点解释**：

1. `models.setProvider(faux.provider)` 之后，Harness 只能通过 `Models` 拿模型（`HarnessOptions.models`，`src/harness/types.ts:423-425`）。写错的地方是「Harness 直连 provider」——那样 16-real-model.ts 换 provider 就得改 Harness 代码，而这里只换 `Models` 的内容。
2. `faux.setResponses([...])` 是队列：每发一次请求取一条。所以 17、22 这类示例能靠「按顺序脚本化多次回答」把多轮工具调用演出来；一旦某轮多发了请求，后面的脚本就会错位。
3. `section("preamble", ..., { tag: false })` 决定提示词进 `pi.system` 的形态：`tag: false` 原样，默认则包 `<key>\n…\n</key>`（`src/harness/prompt.ts:44-45`）。示例输出里看不到系统提示词，但它确实在 `pi.system` 里。
4. `Harness.open(storage, options, context)` 的第三参是所有 Harness 调用的 `Context`；示例统一用 `BACKGROUND_CONTEXT`，表示「这次调用不可取消」。
5. `root.submit()` 不是「发一条消息」，而是一次持久化受理：空闲且 inbox 空时，同一个提交里写入 `pi.user` entry、创建 submission 和 run（`src/harness/submissions.ts:201-205`）。因此进程在 `submit()` 返回后崩溃，输入也不会丢。
6. `capital.wait(context)` 返回的是终态记录（`status: "done" | "unanswered"`）；`answered.type` 的存在是因为 `SubmissionRecord` 是 input/write 的联合类型，TypeScript 需要这个判断才能取 `answered.answer`（`src/types.ts:362-399`）。
7. `root.commit((tx) => tx.entry(AssistantEntry, answered.answer))` 里只有读、没有写。宿主没有「只读的 tx 入口」，只能借 `commit` 拿到 `Tx`；`tx.entry(token, id)` 会校验 kind（`src/types.ts:746-748`，kind 不匹配返回 `undefined`）。本轮运行退出码 0，说明这种空提交被接受。
8. `reply.role === "assistant" ? reply.content : reply` 的分支只是为了在类型收窄失败时也能打印：entry 的 `model` 是 `Message[]`。
9. `entries({}, 10, undefined, context)` 的查询对象里没有 `conversationId`（句柄自带），第二个参数是 limit，第三个是 cursor（`src/harness/types.ts:511-517`）。最新优先的顺序解释了为什么必须 `reverse()` 才能得到 `pi.user → pi.system → pi.assistant`。

**你会看到**（实测输出，退出码 0，耗时 0.63s）：

```text
answer: [ { type: 'text', text: 'Paris.' } ]
transcript: [ 'pi.user', 'pi.system', 'pi.assistant' ]
```

`transcript` 这三类 entry 是整个 C 组的地基：用户输入是一等 entry，系统提示词是按需计算后又存下来的 entry，助手回答也是 entry。任何「把提示词临时拼在请求里」的实现都会在这里露馅——它不会出现在 `entries()` 里。

**动手改**：

- 把第 21 行的 `tag: false` 删掉，看 `pi.system` 的内容变成 `<preamble>\nYou answer in one word.\n</preamble>`：用 `root.context(context)` 打印 `messages[1]` 即可。理解 tag 规则后，15 的输出就不再神秘。
- 把第 15 行的 `faux.setResponses([...])` 删掉再运行：faux provider 没有脚本响应，请求会失败，`capital.wait()` 会拿到 `unanswered`/`model_error`，打印不出 `answer:`。这说明「answer 分支的 if」不是装饰，而是真实存在失败路径。
- 在 `submit()` 之后、`wait()` 之前插入 `await harness.close(context)`：`wait()` 会以 `closed` 拒绝。这是理解「wait 由 Harness 的生命周期兜底」最直接的方式（8.3 节会讲 `wait()` 内部在看什么）。

**对应源码/测试**：`src/harness/submissions.ts:148-207`（受理与 run 的创建）、`src/harness/generation.ts:126-184`（`prepare`：渲染系统提示词并追加 `pi.system`）、`src/harness/prompt.ts:66-93`（`planSystemEntries`）、`src/types.ts:744-803`（`Tx` 读接口）。端到端的同类断言见 `test/harness-conversations.test.ts` 与 `test/harness-generation.test.ts`（`pi.system` 与回答 entry 的落盘顺序）。

### 5.4.2 15-system-prompt.ts —— 系统提示词是增量的 entry，不是每轮重写的字符串

**它演示什么**：section 的渲染规则（标签包裹、`tag: false`、`wrapSection` 装饰）、子会话如何通过扩展选择与 `instructions` 得到不同的提示词，以及「提示词变化时只追加变化部分」的存储形态。这是理解「为什么模型看到的系统提示词和存储里的历史是两份东西」的关键示例。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/15-system-prompt.ts
```

**关键代码**（`test/examples/15-system-prompt.ts:29-76`、`test/examples/15-system-prompt.ts:88-91`）：

```typescript
const Coding = defineExtension({
	name: "coding",
	sections: [
		// tag: false 原样发送；默认会被包成 <key>...</key>。
		section("preamble", () => "You are a coding agent.", { tag: false }),
		// section 能看到这次请求构建的环境，这里用到了它的工作目录。
		section("cwd", (input) => input.env?.cwd),
	],
});
const AgentsMd = defineExtension({
	name: "agents-md",
	sections: [section("agents_md", () => "Run npm run check after changes.")],
});
// 另一个扩展按 key 装饰 section，而不是替换它。
const Terse = defineExtension({
	name: "terse",
	wraps: [
		wrapSection("preamble", (preamble) => ({
			...preamble,
			render: async (input, renderContext) => `${await preamble.render(input, renderContext)} Be terse.`,
		})),
	],
});

const registry = createRegistry();
registry.install(Coding);
registry.install(AgentsMd);
registry.install(Terse);
// 环境跟随每个会话的 agent.cwd。
const env = ({ cwd = "/" }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd });
const harness = await Harness.open(new MemoryStorage(), { models, registry, env }, context);
const model = { provider: "faux", modelId: "faux-1" };
const root = await harness.root(context, { agent: { model, cwd: "/repo" } });

// 子会话取消选择 AGENTS.md，并带上自己的 instructions（最后渲染成 instructions 段）。
const subagent = await harness.createConversation(
	{
		ownership: { kind: "ownerless" },
		agent: {
			model,
			cwd: "/repo",
			extensions: { remove: [AgentsMd] },
			instructions: "Only read; never edit files.",
		},
	},
	context,
);

async function systemEntries(conversation: Conversation) {
	const page = await conversation.entries({}, 20, undefined, context);
	// 收集所有 pi.system entry 里的模型消息，按写入顺序。
	return [...page.items].reverse().flatMap((entry) => (SystemEntry.is(entry) ? (entry.model ?? []) : []));
}

await (await root.submit({ type: "input", content: "Fix the build." }, context)).wait(context);
await (await subagent.submit({ type: "input", content: "Read the logs." }, context)).wait(context);
console.log("root system prompt:", await systemEntries(root));
console.log("subagent system prompt:", await systemEntries(subagent));

// section 的输出变了：下一次请求只追加变化。
await root.configure({ cwd: "/repo/packages" }, context);
await (await root.submit({ type: "input", content: "Now the package." }, context)).wait(context);
console.log("root system entries after cwd change:", await systemEntries(root));
```

**逐点解释**：

1. 扩展只声明「怎么渲染」，不保存渲染结果。保存发生在 generation 的 `prepare` 阶段：它把 `planSystemEntries()` 算出的 entry 追加到转录里（`src/harness/generation.ts:151-183`）。所以系统提示词是**捕获在当时**的产物，而不是每次打开历史时重新算的。
2. `tag: false` 与默认行为在同一个数组里对比出现（`preamble` vs `cwd`/`agents_md`）。`renderSections()` 里 `section.tag === false ? text : \`<${key}>\n${text}\n</${key}>\`` 是唯一的分叉（`src/harness/prompt.ts:44-45`）。
3. `section("cwd", (input) => input.env?.cwd)` 用到 `PromptInput.env`——为这次准备构建的环境（`src/harness/types.ts:228-238`）。用 `input.env?.cwd` 而不是闭包里的常量，是让「会话改 cwd」能影响提示词的唯一途径；渲染时 `env` 是每次调用 `HarnessOptions.env` 新建的。
4. `wrapSection` 让 `terse` 扩展在不替换 `preamble` 的前提下追加 ` Be terse.`。装饰发生在扩展选好之后、按扩展顺序应用到**组合后的 map** 上（`src/harness/agent.ts:161-180`），所以谁先谁后决定装饰顺序；`applyWrap` 还会拒绝「把 key 改名」的 wrapper（`src/harness/agent.ts:245`）。
5. 子会话用 `extensions: { remove: [AgentsMd] }` 而不是重写数组：存进 `pi.agent` 的是名字列表的增删（`src/harness/agent.ts:92-103`），解析时以宿主默认选择为基准做差集（`src/harness/agent.ts:213-232`）。这样宿主之后新增扩展，子会话会自动继承——如果写成固定数组就不会。
6. `instructions` 被追加为**最后一个** section，key 固定为 `instructions`（`src/harness/agent.ts:32-33`、`:196-198`）。因此它排在所有扩展 section 之后，这也是输出里子会话最后一段是 `instructions` 的原因。
7. 改 cwd 后只追加一条 `{ cwd: '<cwd>\n/repo/packages\n</cwd>' }`。这是 `planSections()` 的「最小补丁」路径：只写变化的 key、值为 `null` 时表示删除（`src/harness/prompt.ts:135-141`）。顺序被打乱时它会退化成「先全部置 null，再全部重加」（`src/harness/prompt.ts:126-133`）。
8. 旧的第一条 system entry 仍在转录里。模型侧靠 `replaySections()` 顺序重放得到当前值（`src/harness/prompt.ts:9-19`），所以历史不会被删——这正是 25-compaction 能压缩「系统提示词基线」的前提。
9. 输出里的 `timestamp` 是毫秒时间戳，每次运行都不同；不要把它当断言。

**你会看到**（实测输出，退出码 0，耗时 0.83s）：

```text
root system prompt: [
  {
    role: 'system',
    content: '',
    sections: {
      preamble: 'You are a coding agent. Be terse.',
      cwd: '<cwd>\n/repo\n</cwd>',
      agents_md: '<agents_md>\nRun npm run check after changes.\n</agents_md>'
    },
    timestamp: 1791811008854
  }
]
subagent system prompt: [
  {
    role: 'system',
    content: '',
    sections: {
      preamble: 'You are a coding agent. Be terse.',
      cwd: '<cwd>\n/repo\n</cwd>',
      instructions: '<instructions>\nOnly read; never edit files.\n</instructions>'
    },
    timestamp: 1791811008865
  }
]
root system entries after cwd change: [
  {
    role: 'system',
    content: '',
    sections: {
      preamble: 'You are a coding agent. Be terse.',
      cwd: '<cwd>\n/repo\n</cwd>',
      agents_md: '<agents_md>\nRun npm run check after changes.\n</agents_md>'
    },
    timestamp: 1791811008854
  },
  {
    role: 'system',
    content: '',
    sections: { cwd: '<cwd>\n/repo/packages\n</cwd>' },
    timestamp: 1791811008871
  }
]
```

对照三块输出可以读出三件事：`terse` 的装饰只作用于 `preamble`（`agents_md` 不受影响）；子会话少了 `agents_md`、多了 `instructions`，而 `cwd` 两处都全（说明 section 是按会话的扩展选择渲染的）；cwd 变化只产生「一条只有 cwd 的新 entry」。

**动手改**：

- 把 `Terse` 的 `registry.install(Terse)` 挪到 `registry.install(Coding)` 之前，输出不变（装饰目标是组合后的 `preamble`，与安装顺序无关）；但把 `Coding` 从 `settings.extensions` 里去掉后再跑，`preamble` 本身就没了，装饰也无处可施——`applyWrap` 找不到目标时静默跳过（`src/harness/agent.ts:241-242`）。这条实验能区分「安装顺序问题」与「选择问题」。
- 把子会话的 `extensions: { remove: [AgentsMd] }` 改成 `extensions: [Coding, Terse]`（固定数组）：再改宿主的默认选择，子会话不再跟随。这是理解「数组 = 恰好这些，对象 = 在默认选择上增删」最省钱的办法。
- 在第二次 `submit` 前插入 `await root.configure({ cwd: "/repo" }, context)`（改回原值）再改成 `/repo/packages`：中间那次会在下一次请求里追加 `cwd: '<cwd>\n/repo\n</cwd>'`，证明「最小补丁」按值比较，而不是按调用次数。

**对应源码/测试**：`src/harness/prompt.ts:9-19`（重放）、`:25-48`（渲染）、`:66-158`（计划补丁与工具变化）、`src/harness/agent.ts:126-132`（新建会话复制 owner 的 agent）、`:196-232`（instructions 与扩展选择）。测试见 `test/harness-prompt.test.ts`（重放顺序、`null` 删除、重新添加追加、head 后的完整基线）。

### 5.4.3 16-real-model.ts —— 真实 provider 与流式中间态（pi.live）

**它演示什么**：把 faux 换成 OpenAI，并把「回答正在生成」这件事变成可观察状态：generation 把节流的中间态写进会话的 `pi.live` 文档，宿主 watch 这个文档就能边生成边打印。它还演示了「没有 API key 时优雅退出」的写法。

**运行**（本轮不设置 `OPENAI_API_KEY`）：
```bash
node --conditions=source --experimental-strip-types test/examples/16-real-model.ts
```

**关键代码**（`test/examples/16-real-model.ts:24-38`、`test/examples/16-real-model.ts:40-67`）：

```typescript
if (process.env.OPENAI_API_KEY === undefined) {
	console.log("skipped: OPENAI_API_KEY is not set");
} else {
	const models = createModels();
	// openaiProvider() 自己读 OPENAI_API_KEY。
	models.setProvider(openaiProvider());
	const registry = createRegistry();
	registry.install(
		defineExtension({
			name: "concise",
			sections: [section("preamble", () => "You are a concise assistant.", { tag: false })],
		}),
	);
	const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
	const root = await harness.root(context, {
		agent: { model: { provider: "openai", modelId: "gpt-6-sol" }, thinkingLevel: "high" },
	});
	const liveWatch = (await harness.watchDoc(LiveDoc, root.id, context))!;
	// 只打印「这次提交的完整中间态」比上次多出来的那一段。
	let printed = "";
	const printText = (text: string): void => {
		if (text.length <= printed.length || !text.startsWith(printed)) return;
		process.stdout.write(text.slice(printed.length));
		printed = text;
	};
	liveWatch.start(async (value) => {
		const block = value?.generation?.message?.content.find((content) => content.type === "text");
		if (block?.type === "text") printText(block.text);
	});
	harness.resume();
	process.stdout.write("answer: ");
	const poem = await root.submit({ type: "input", content: "Write a long poem" }, context);
	const settledPoem = await poem.wait(context);
	await liveWatch.stop();
	if (settledPoem.status === "done" && settledPoem.type === "input") {
		// 最后一个节流窗口可能还没被提交为中间态；答案 entry 里才有剩下的文本。
		const entry = await root.commit((tx) => tx.entry(AssistantEntry, settledPoem.answer), context);
		const message = entry?.model?.[0];
		const block =
			message?.role === "assistant" ? message.content.find((content) => content.type === "text") : undefined;
		if (block?.type === "text") printText(block.text);
		process.stdout.write("\n");
	} else {
		console.log("unanswered:", settledPoem.reason, settledPoem.detail);
	}
	await harness.close(context);
}
```

**逐点解释**：

1. 整个真实路径包在 `else` 里，而不是「先建 harness 再打补丁」。没有 key 时进程只输出一行、退出码 0——示例以「可跳过」的方式存在，才能进无人值守的示例回归。
2. `openaiProvider()` 从环境读 key，再 `models.setProvider(...)`。Harness 侧只认 `model: { provider: "openai", modelId: "gpt-6-sol" }`（`ModelRef`，`src/harness/types.ts:46-50`），provider 实例由宿主提供。这就是「换模型不改 agent 之外的代码」的实现方式。
3. `watchDoc(LiveDoc, root.id, context)` watch 的是会话的 `pi.live` 文档；返回类型带 `| undefined`，所以示例用 `!`。`LiveState.generation.message` 是「节流后的完整助手消息快照」（`src/harness/live.ts:44-56`），不是增量差分——这决定了下面的打印必须自己做前缀差分。
4. `printText` 的两条守卫是有针对性的：`text.length <= printed.length` 丢弃「更短或等长的旧快照」（例如某次提交晚到），`!text.startsWith(printed)` 丢弃「不是同一段前缀的增长」（消息被替换）。少了任何一条，UI 上都会出现重复或错乱的回退文本。
5. `LiveDoc` 的 `history` 是 `"latest"`，`fork` 是 `"initial"`，并且 `checkpointWhen` 在「没有 generation、没有 running 的工具槽」时写完整基线（`src/harness/live.ts:63-76`）。这是「流式中间态不会把存储撑爆」的机制：连续提交只存差分，空闲时回到一个小的完整基线。
6. `harness.resume()` 打开调度。它幂等，`submit()`/`wait()` 等调用也会打开它（`src/harness/types.ts:539-544`）；示例显式调用是为了「先装好监视器、再让运行开始」，避免第一段文本在订阅之前就被提交。
7. 等 `wait()` 返回后仍要再读一次答案 entry：最后一个节流窗口（`PARTIAL_THROTTLE_MS = 100`，`src/harness/generation.ts:109`）可能没有落成中间态，`streamResponse()` 的 `finally` 会停止节流并等掉在途提交（`src/harness/generation.ts:410-414`），但不保证最后一次 partial 一定提交过。少这一步，末尾会缺字。
8. `process.stdout.write` 而非 `console.log`：流式打印要求不换行、不加分隔符。
9. 失败分支打印 `settled.reason` 与 `detail`：`unanswered` 记录里 `reason` 是 `model_error`/`aborted`/`no_model` 这类枚举，`detail` 才是 provider 的原文（`src/types.ts:391-398`）。

**你会看到**（实测输出，退出码 0，耗时 0.65s）：

```text
skipped: OPENAI_API_KEY is not set
```

本轮**没有**执行真实模型路径，所以上面 9 条里的流式行为没有实测输出。想观察它：设置 `OPENAI_API_KEY` 后重跑，会依次看到 `answer: ` 前缀、逐步流出的长诗文本、以及结尾换行；`pi.live` 的中间态会在每次节流提交后触发一次回调。[待核]: 真实 provider 的流式分段形态（每次 `message_update` 覆盖的 token 数）未实测；不同 provider 的 `partial` 更新粒度可能不同，别把 faux 的 200 tokens/s 行为当成真实模型的节奏。

**动手改**：

- 把 `printText` 的第一条守卫删掉（只留 `startsWith`），观察是否出现重复文本：如果某次提交的快照比上次短（例如消息被替换），`slice(printed.length)` 会切出空串或错位内容。这条实验能把「中间态是完整快照」这个事实变成可见的错误。
- 把 `harness.resume()` 移到最后（`harness.close(context)` 之前）：`submit()` 仍会打开调度，所以结果不变；但把 `liveWatch.start(...)` 之后到 `submit()` 之间插入一个 `await new Promise(r => setTimeout(r, 0))`，你会发现首段文本可能缺失——订阅生效与运行开始之间没有顺序保证，必须显式先订阅。
- 把 `thinkingLevel: "high"` 改成 `"off"` 再跑（需要 key）：请求不再带 reasoning，`pi.live` 的中间态里思考内容消失。这是检查「思考级别通过 `SimpleStreamOptions.reasoning` 传递」的实验（`src/harness/generation.ts:202-207`）。

**对应源码/测试**：`src/harness/generation.ts:364-415`（节流提交中间态）、`:417-505`（分类与失败）、`src/harness/live.ts:32-76`（`LiveState` 与文档语义）、`test/harness-live-deltas.test.ts`（中间态提交的差分与基线）、`test/harness-generation.test.ts`（`stopReason` 分类）。

### 5.4.4 17-coding-tools.ts —— 工具回合：read/edit/bash + 钩子计时 + JSONL 存储

**它演示什么**：一个完整的工具回合。模型连续调用 `read`、`edit`、两次 `bash`，每次调用都由一个持久的 `pi.tool` 任务执行，结果是 `pi.tool-result` entry；扩展通过 `ToolTask` 钩子在调用前后插入逻辑（这里是给一次大文件读取计时）。存储换成了 JSONL 目录，用来证明「工具回合与存储实现无关」。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/17-coding-tools.ts
```

**关键代码**（`test/examples/17-coding-tools.ts:30-42`、`test/examples/17-coding-tools.ts:44-76`）：

```typescript
// faux 扮演模型：四次工具调用，然后一个最终回答。
const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const toolCall = (name: string, args: Parameters<typeof fauxToolCall>[1], id: string) =>
	fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
faux.setResponses([
	toolCall("read", { path: "notes.txt" }, "r"),
	toolCall("edit", { path: "notes.txt", edits: [{ oldText: "world", newText: "durable" }] }, "e"),
	toolCall("bash", { command: "cat notes.txt" }, "b"),
	toolCall("bash", { command: "cat /tmp/1gb.txt" }, "c"),
	fauxAssistantMessage([fauxText("The file now greets durable.")]),
]);

// 钩子看到每一次调用在执行前和执行后的样子；这里给大文件 cat 计时。
const isBigCat = (call: { name: string; arguments: unknown }) =>
	call.name === "bash" && (call.arguments as BashToolInput).command.includes("1gb.txt");
let start = 0;
const Timing = defineExtension({
	name: "timing",
	hooks: [
		hook(ToolTask, {
			beforeTool: (call) => {
				if (isBigCat(call)) start = Date.now();
				return undefined;
			},
			afterTool: (call) => {
				if (isBigCat(call)) console.log(`cat /tmp/1gb.txt took ${Date.now() - start} ms`);
				return undefined;
			},
		}),
	],
});
const registry = createRegistry();
// CodingTools 带来 read、write、edit、bash；工具只能通过 Harness 为每次调用构建的环境访问文件与进程。
registry.install(CodingTools);
registry.install(Timing);

// 环境按需构建，跟随会话的 agent.cwd。
const storage = await openNodeJsonlStorage(directory, context);
const harness = await Harness.open(
	storage,
	{ models, registry, env: (target) => new NodeExecutionEnv({ cwd: target.cwd ?? process.cwd() }) },
	context,
);
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" }, cwd: directory } });

// 每次工具调用都是一个持久任务（pi.tool），由 generation 拥有；generation 等它们全部结束再用下一次生成继续这个 run。
const settled = await (await root.submit({ type: "input", content: "Greet durable instead." }, context)).wait(context);
```

**逐点解释**：

1. 脚本必须与工具调用一一对应：`read` → `edit` → `bash` → `bash` → 文本回答，共 5 步。工具调用的 `id`（`r`/`e`/`b`/`c`）是结果配对的唯一依据（`readCall()` 按 `call.id` 在助手 entry 里找回调用，`src/harness/tool.ts:121-132`），重复 id 会让配对错乱。
2. `stopReason: "toolUse"` 告诉 generation「这一轮不是最终回答」。classification 里 `toolUse` + 至少一个 call 才走工具轮（`src/harness/generation.ts:450-453`）；`toolUse` 但没有 call 会被当成普通回答（`:454-456`）。
3. 钩子挂在 `ToolTask` 上、写在扩展里：`beforeTool` 在「记录执行意图」之前运行，可以改写参数或 `block`；`afterTool` 在结果 entry 写入之前运行，可以替换结果（`src/harness/tool.ts:67-81`、`:346-348`）。示例返回 `undefined` 表示不干预。
4. `let start = 0` 是模块级变量，能安全复用是因为这两个 `bash` 调用分属不同的工具轮（各自一轮），不会重叠；同一轮内的多个调用默认并行（`toolExecution: "parallel"` 默认值，`src/harness/agent.ts:54`），用共享变量就会互相踩。
5. `env` 是函数、不是对象：`HarnessOptions.env` 在每次工具调用与每次提示词渲染时被调用（`src/harness/types.ts:428-429`），目标里带着会话的 `cwd`。写成「open 时建一个 env」就会让「改 cwd 立刻生效」失效（26 会专门验证这点）。
6. `CodingTools` 的工具通过 `requireEnv(api)` 取环境，拿不到就抛错——错误会变成普通的错误结果，而不是让进程崩溃（`src/tools/env.ts:4-8`、`src/harness/tool.ts:247-257`）。这就是下面「bash 失败但退出码仍是 0」的原因。
7. JSONL 存储换掉的只是 `Storage`：`openNodeJsonlStorage(directory, context)`（`src/storage/jsonl/node.ts`）。条目、任务、文档都以 JSONL 追加写在这一个目录里，示例有意**不删除**它并把路径打印出来供检查；本轮采集结束后由运行者统一清理。
8. 打印转录时用 `entry.model![0] as ToolResultMessage` 取结果消息，再把内容片段拼成文本；超过 200 字符截断并加 `…`。这跟 harness 内部「渲染诊断信息进文本末尾」的做法一致（`src/harness/tool.ts:438-460`），所以看到 `<harness>` 开头的文本属于正常结果内容，不是异常。

**你会看到**（实测输出，退出码 0，耗时 0.89s）：

```text
cat /tmp/1gb.txt took 5 ms
status: done
pi.user
pi.system
pi.assistant
pi.tool-result read: "hello world\n"
pi.assistant
pi.tool-result edit: "Successfully replaced 1 block(s) in notes.txt."
pi.assistant
pi.tool-result bash: "<harness>\n[error] No bash shell found. Options:\n  1. Install Git for Windows: https://git-scm.com/download/win\n  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n  3. Configure an explicit shellPath\n\nSe…"
pi.assistant
pi.tool-result bash: "<harness>\n[error] No bash shell found. Options:\n  1. Install Git for Windows: https://git-scm.com/download/win\n  2. Add your bash to PATH (Cygwin, MSYS2, etc.)\n  3. Configure an explicit shellPath\n\nSe…"
pi.assistant
answer: [ { type: 'text', text: 'The file now greets durable.' } ]
file: "hello durable\n"
storage: C:\Users\54995\AppData\Local\Temp\dsh-xpPfzl\pi-durable-example-4LXRZo
```

读这段输出要注意三点。第一，`read` 与 `edit` 的真实结果都在（`"hello world\n"`、`Successfully replaced 1 block(s)`），最后文件内容确实是 `hello durable`，说明编辑路径与存储无关地工作。第二，**本机没有可用的 bash**（未安装 Git Bash；Harness 只搜索 `C:\Program Files\Git\bin\bash.exe` 与 `C:\Program Files (x86)\Git\bin\bash.exe`），两次 `bash` 都返回 `No bash shell found` 且 `isError: true`——所以 `cat /tmp/1gb.txt took 5 ms` 计时的是**失败路径**，它只证明钩子被调用了，不证明读取 1GB 文件很快。第三，`storage:` 这一行是示例有意保留的产物路径。

**动手改**：

- 先在 Git Bash 的 `/tmp` 里创建一个 1GB 文件再重跑：先 `cygpath -w /tmp`（Git Bash 的 `/tmp` 通常落到用户临时目录，不一定是 `C:\tmp`）确认真实路径，再用 `fsutil file createnew <那个路径>\1gb.txt 1073741824` 创建。此时 `took … ms` 才是真实 I/O 时间，并且 `bash` 的结果会带上 spill 诊断（输出超过限制时溢出到临时文件）。
- 把 `faux.setResponses([...])` 里的第 3 条（`cat notes.txt`）删掉：模型会直接开始 `cat /tmp/1gb.txt`，但结果顺序、`read`/`edit` 的落盘都不变。说明脚本里的调用与工具实现完全解耦——工具是宿主装好的，不是模型选的。
- 把 `Timing` 钩子的 `afterTool` 改成返回 `{ ...result, content: [{ type: "text", text: "redacted" }] }`：转录里的工具结果会被替换成 `redacted`，但文件已经被真正改过。这是「钩子能改模型所见、不能改副作用」的直观演示。

**对应源码/测试**：`src/harness/tool.ts:50-118`（`pi.tool` 阶段：解析、校验、钩子、意图、执行）、`:272-322`（进度提交）、`:438-460`（结果 entry 与诊断渲染）、`src/harness/generation.ts:544-646`（工具轮的建立与收尾）、`src/tools/bash.ts:47-89`（环境、前缀、溢出与错误）。测试见 `test/harness-tools.test.ts`、`test/tools.test.ts`、`test/env-node-spill.test.ts`。

### 5.4.5 18-print.ts —— print 模式：只等自己的 Submission，不等全局空闲

**它演示什么**：`pi -p` 那种「一个 prompt 进、一段文本出」的宿主形态。关键在等待语义：宿主等的是自己这条 Submission 的终态，而不是「整个 Harness 空闲」。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/18-print.ts
```

**关键代码**（`test/examples/18-print.ts:14-41`、`test/examples/18-print.ts:43-52`）：

```typescript
const context = BACKGROUND_CONTEXT;
// 命令行第一参就是 prompt。
const prompt = process.argv[2] ?? "What is in this directory?";

const models = createModels();
let model = { provider: "openai", modelId: "gpt-6-sol" };
// 有 key 就用真实模型，否则用脚本模型；两者走完全相同的宿主代码路径。
if (process.env.OPENAI_API_KEY !== undefined) {
	models.setProvider(openaiProvider());
} else {
	const faux = fauxProvider();
	models.setProvider(faux.provider);
	model = { provider: "faux", modelId: "faux-1" };
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "ls" }, { id: "call-1" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("This directory holds the durable package sources, tests, and docs.")]),
	]);
}

const registry = createRegistry();
registry.install(
	defineExtension({
		name: "coding",
		tools: [createReadTool(), createBashTool()],
		sections: [section("preamble", () => "You are a concise coding assistant.", { tag: false })],
	}),
);
const env = new NodeExecutionEnv({ cwd: process.cwd() });
// 一个进程一个会话，所以 env 直接复用同一个对象。
const harness = await Harness.open(new MemoryStorage(), { models, registry, env: () => env }, context);
const root = await harness.root(context, { agent: { model } });

const submission = await root.submit({ type: "input", content: prompt }, context);
const settled = await submission.wait(context);
if (settled.status === "done" && settled.type === "input") {
	const entry = await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
	const answer = entry?.model?.[0] as AssistantMessage;
	// 只取文本片段；思考与工具调用不打印。
	console.log(answer.content.flatMap((content) => (content.type === "text" ? [content.text] : [])).join(""));
} else {
	console.error(`unanswered: ${settled.status === "unanswered" ? settled.reason : settled.status}`);
	process.exitCode = 1;
}
```

**逐点解释**：

1. `process.argv[2]` 带默认值，默认 prompt 让示例无参数可跑。它只取第一个参数、不做 flag 解析（复杂解析在 19 里）。
2. `let model` 与 provider 分支必须成对：`models.getModel()` 找不到 `ModelRef` 时 generation 直接以 `no_model` 失败（`src/harness/generation.ts:131-132`），不会回退到别的 provider。
3. 脚本先 `bash ls` 再文本回答，正好演示 print 模式「中间的工具轮不进 stdout，只有最终文本出来」。
4. `env: () => env` 复用同一个环境对象是安全的：一个会话、一个目录。README「Environment」节说明 `edit`/`write` 靠环境的 `id` + 路径串行化同一文件，所以复用不会引入竞态。
5. `submission.wait(context)` 只承诺「这条输入不再等回答」，不承诺全局空闲——后台任务（如 23 的后台 subagent）仍可能活着。要等全局空闲必须显式 `harness.waitForIdle(context)`（19 就这么做）。
6. 打印只取 `type === "text"` 的片段：助手消息还带思考块与工具调用块，整体 `JSON.stringify` 会污染 stdout。
7. 失败时写 `process.exitCode = 1` 而不是调 `process.exit(1)`，`harness.close()` 才能正常跑完、进程自然退出。这也让「退出码 = 本轮是否被回答」的语义成立。

**你会看到**（实测输出，退出码 0，耗时 0.63s）：

```text
This directory holds the durable package sources, tests, and docs.
```

只有一行，正是 print 模式的形状。注意这行**不能**当作目录清单的真实来源：它是 faux 脚本写死的文本；本机没有 bash，`bash ls` 那一步返回的是 `No bash shell found` 错误结果（见 5.4.4 的偏差说明），脚本照样走完。有 API key 时同样的代码会换成 OpenAI 模型并真正列目录。

**动手改**：

- 传自己的 prompt 再跑：`node --conditions=source --experimental-strip-types test/examples/18-print.ts "list files"`。faux 的脚本不看 prompt 内容，答案不变——这正是 23 里必须用「按最后一条消息路由」的 `FauxResponseStep` 才能演多轮的原因。
- 在 `wait()` 之后加 `await harness.waitForIdle(context)`：本示例两条都立即返回，因为 `bash` 的工具任务已经结束。要看差异得配合 21 那种「工具还在跑」的脚本，届时 `wait()` 先返回、`waitForIdle()` 后返回。
- 把 `settled.status === "done"` 改成 `!== "done"` 强制走失败分支：stdout 为空、stderr 打印 `unanswered: done`、退出码 1。这确认「print 模式的退出码 = 本轮是否被回答」，而不是「进程有没有报错」。

**对应源码/测试**：`src/harness/submissions.ts:75-87`（`wait()` 与关闭时的拒绝）、`src/harness/types.ts:539-544`（`resume()` 的触发条件）、`test/harness-submissions.test.ts`（终态与等待语义）。

### 5.4.6 19-json.ts —— JSON 模式：先 snapshot，再增量事件

**它演示什么**：把一次运行流成 JSON Lines。两种模式——默认的 `--events`（实验性 agent 事件，第一行固定是 `snapshot`）与 `--ops`（会话视图的原始帧，每行一次提交的 ops）。存储可选 sqlite/jsonl/memory，路径打到 stderr。

**运行**（本轮按默认参数：`--events` + sqlite）：
```bash
node --conditions=source --experimental-strip-types test/examples/19-json.ts
```

**关键代码**（`test/examples/19-json.ts:31-52`、`test/examples/19-json.ts:80-103`）：

```typescript
const args = process.argv.slice(2);
// 模式二选一：默认 events。
const mode = args.includes("--ops") ? "ops" : "events";
const storageIndex = args.indexOf("--storage");
const storageKind = storageIndex < 0 ? "sqlite" : args[storageIndex + 1];
// 第一个「不以 -- 开头、且不是 --storage 的值」的参数就是 prompt。
const prompt =
	args.find((arg, index) => !arg.startsWith("--") && (storageIndex < 0 || index !== storageIndex + 1)) ??
	"What is in this directory?";

let storage: Storage;
let location: string | undefined;
if (storageKind === "sqlite") {
	location = join(tmpdir(), `pi-durable-json-${Date.now()}.sqlite`);
	storage = await openNodeSqliteStorage(location);
} else if (storageKind === "jsonl") {
	location = await mkdtemp(join(tmpdir(), "pi-durable-json-"));
	storage = await openNodeJsonlStorage(location, context);
} else if (storageKind === "memory") {
	storage = new MemoryStorage();
} else {
	throw new Error(`Unknown --storage ${storageKind}; use sqlite, jsonl, or memory`);
}
// 一行一个 JSON；用 stdout.write 保证每次调用一行。
const print = (value: unknown): void => void process.stdout.write(`${JSON.stringify(value)}\n`);

// 在提交之前挂载，让流覆盖整个 run。
let stop: () => Promise<unknown>;
if (mode === "events") {
	const stream = await watchEvents(harness, root.id, context);
	print(stream.snapshot);
	stream.start(async (events) => {
		for (const event of events) print(event);
	});
	stop = () => stream.stop();
} else {
	const watch = await root.watch(context);
	print({ view: watch.value });
	watch.start(async (_value, ops) => print({ ops }));
	stop = () => watch.stop();
}

const submission = await root.submit({ type: "input", content: prompt }, context);
await submission.wait(context);
await harness.waitForIdle(context);
// 等最后一批事件到达监听器再停。
await new Promise((resolve) => setTimeout(resolve, 0));
await stop();
await harness.close(context);
if (location !== undefined) console.error(`${storageKind} storage: ${location}`);
```

**逐点解释**：

1. 三种存储都必须实现同一个 `Storage` 接口；`location` 只在非 memory 时存在，所以末尾用 `if (location !== undefined)` 打印。SQLite 路径带 `Date.now()`、JSONL 用 `mkdtemp`，两者都**不删**，故意留给检查（本轮采集结束后由运行者清理）。
2. `--events` 与 `--ops` 是两种抽象层级：前者是给 UI 的语义事件，后者是给「我要自己维护视图副本」的消费者的原始帧。后者的第一行是完整视图 `{ view: ... }`，之后每行 `{ ops }` 是一次提交的结构差分（视图形状见 `src/harness/view.ts:26-32`）。
3. 必须**先挂载再提交**（第 80 行注释）。事件由提交发布派生，订阅建立之前的提交不会补发——只有 `snapshot` 会。这是 21 的实验基础。
4. `snapshot` 自带 `entries`、`tools`、`compactions`、`inbox`、`agent`、`usage`（`src/harness/events.ts:93-135`）；消费者先建立基线，之后的事件都作用在它上面。
5. `--ops` 模式打印的 `watch.value` 是**获取时**的视图；`start` 之后的帧按提交顺序交付，回调不会重入。但「串行化的精确帧」不等于「无限缓冲」：未交付帧的缓存上限是 `MAX_PENDING_WATCH_FRAMES = 100`，超过时丢弃中间帧、改投一帧替换值（事件流被替换成一枚新的 `snapshot`，`src/session/observation.ts:14-15`、`:221-232`、`src/harness/events.ts:150-160`）。慢消费者靠这个机制自愈，代价是可能跳过中间状态。
6. `waitForIdle()` 之后还要 `setTimeout(0)`：事件回调在其提交之后运行，最后一批可能还在微任务队列里。少这一行，末尾会随机丢几行事件。
7. 退出码 0 只表示「流跑完了」。**事件里的工具失败不会让进程失败**：`bash ls` 的结果是 `isError: true` 的工具结果 entry，generation 把它当一轮工具结果继续请求模型。
8. 存储路径打到 **stderr**：这样 stdout 可以整体当 JSON Lines 管道消费。这也是本组唯一一个「stdout 只放数据」的示例。

**你会看到**（实测输出，退出码 0，耗时 0.82s；下面是摘录，原始记录是完整的 JSON Lines，`…` 处为长字段的一部分）：

```text
{"type":"snapshot","entries":[],"tools":[],"compactions":[],"inbox":[],"agent":{"model":{"provider":"faux","modelId":"faux-1"}},"usage":{"models":{},"tools":{}}}
{"type":"message_start","message":{"role":"user","content":"What is in this directory?","timestamp":1791811011682}}
{"type":"message_end","entry":{"model":[{"role":"user","content":"What is in this directory?","timestamp":1791811011682}],"kind":"pi.user","id":7,"conversationId":1}}
{"type":"submission","record":{"conversationId":1,"type":"input","status":"placed","entry":7,"id":8}}
{"type":"run_start","inputs":[8]}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"system","content":"","sections":{"preamble":"You are a concise coding assistant."},"toolsAdded":[…bash、read 的完整声明…],"timestamp":1791811011692}}
{"type":"message_end","entry":{"model":[{"role":"system","content":"",…}],"kind":"pi.system","id":10,"conversationId":1,"byTaskId":9}}
{"type":"message_start","message":{"role":"assistant","content":[{"type":"toolCall","id":"call-1","name":"bash","arguments":{"command":"ls"}}],…,"stopReason":"toolUse","timestamp":1791811011673}}
{"type":"message_end","entry":{"model":[{"role":"assistant",…}],"kind":"pi.assistant","id":11,"conversationId":1,"byTaskId":9}}
{"type":"usage_changed","usage":{"models":{"faux/faux-1":{"input":290,"output":6,"cacheRead":0,"cacheWrite":290,"totalTokens":586,…}},"tools":{}}}
{"type":"tool_execution_start","toolCallId":"call-1","toolName":"bash","args":{"command":"ls"}}
{"type":"tool_execution_end","toolCallId":"call-1","toolName":"bash","entry":{"model":[{"role":"toolResult","toolCallId":"call-1","toolName":"bash","content":[{"type":"text","text":"<harness>\n[error] No bash shell found. …"}],"isError":true,…}],"data":{"diagnostics":[{"severity":"error","code":"tool_error","message":"No bash shell found. …"}]},"kind":"pi.tool-result","id":13,"conversationId":1,"byTaskId":12}}
{"type":"turn_end"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"assistant","content":[{"type":"text","text":"This directory holds the durable package sources, tests,"}],…,"stopReason":"pending","timestamp":1791811011673}}
{"type":"message_end","entry":{"model":[{"role":"assistant","content":[{"type":"text","text":"This directory holds the durable package sources, tests, and docs."}],…,"stopReason":"stop",…}],"kind":"pi.assistant","id":15,"conversationId":1,"byTaskId":14}}
{"type":"turn_end"}
{"type":"run_end","inputs":[8]}
{"type":"submission","record":{"conversationId":1,"type":"input","status":"done","entry":7,"id":8,"answer":15}}
{"type":"usage_changed","usage":{"models":{"faux/faux-1":{"input":380,"output":23,"cacheRead":290,"cacheWrite":380,"totalTokens":1073,…}},"tools":{}}}
```

stderr（有效行）：

```text
sqlite storage: C:\Users\54995\AppData\Local\Temp\dsh-xpPfzl\pi-durable-json-1791811011660.sqlite
```

这段流本身就是教学材料：

- 第一行 `snapshot` 是基线，此时还没有任何 entry（流在 `submit()` 之前挂载）。
- `entry` 里的 `byTaskId`（`pi.system` 由 9 号任务写、工具结果由 12 号写、两次助手消息由 9/14 号写）说明「谁写的」在记录里可见；工具轮期间 run 的属主任务从 9 换成 14，正是 `handOver()`（`src/harness/generation.ts:676-679`）。
- `usage_changed` 把 faux/faux-1 的账累加（586 → 1073），是 `pi.usage` 的实时投影。
- 第二条助手消息先在 `message_start` 里以 `stopReason: "pending"` 出现、文本是半句，再在 `message_end` 里变成 `"stop"` 和完整句子——这是流式中间态被真实提交过的证据（与 16 的 `pi.live.generation.message` 是同一机制）。
- `run_start → turn_start → message_* → tool_execution_* → turn_end → turn_start → … → run_end → submission(done) → usage_changed` 就是一次运行的事件骨架；工具的结束先于它结果的消息，和 coding agent 的观感一致（`src/harness/events.ts:279-285`）。

**动手改**：

- 换存储：`--storage memory` 与 `--storage jsonl` 各跑一次。memory 不打印路径行；jsonl 在 stderr 打印一个临时**目录**。三者 stdout 的事件序列一致——这是「Storage 是实现细节」的验证。
- 用 `--ops` 跑同一句话：第一行变成 `{"view":{...}}`，之后每行是一个提交的 ops 数组。对比 `--events` 能看出事件是语义层、ops 是结构层。[待核]: 本轮 `--ops` 模式没有实测记录，ops 的具体切分未在本机验证。
- 把挂载挪到 `submit()` 之后：`snapshot` 不再空，增量事件从「已经进行到一半」开始。这就是 21-late-join 的场景。

**对应源码/测试**：`src/harness/events.ts:36-135`（快照与事件类型）、`:215-300`（从提交派生事件）、`src/harness/view.ts:26-119`（视图与 watch）、`src/harness/live.ts:44-76`（run/generation/tools 的展示字段）。测试见 `test/harness-events.test.ts`、`test/harness-view.test.ts`。

### 5.4.7 20-inbox.ts —— 忙时会话：排队、分流与撤销

**它演示什么**：会话正忙时提交会发生什么。默认排队（follow-up），`whenBusy: "steer"` 排队为 steer，`write` 也排队，`whenBusy: "reject"` 直接拒绝；排队项在边界放置之前可以撤销。它还演示 `followUpMode: "all"` 这个设置。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/20-inbox.ts
```

**关键代码**（`test/examples/20-inbox.ts:12-46`、`test/examples/20-inbox.ts:48-65`）：

```typescript
// 第一个回答等我们放行，因此继续提交时会话一直是忙的。
let release!: () => void;
const held = new Promise<void>((resolve) => {
	release = resolve;
});
const slow: FauxResponseStep = async () => {
	await held;
	return fauxAssistantMessage("Answer to the first question.");
};
const faux = fauxProvider();
faux.setResponses([slow, fauxAssistantMessage("Answer to the follow-up and the steer.")]);
const models = createModels();
models.setProvider(faux.provider);

// settings 作用于每个会话：把所有排队的 follow-up 一次放完，而不是每次 run 放一个。
const harness = await Harness.open(
	new MemoryStorage(),
	{ models, registry: createRegistry(), settings: { followUpMode: "all" } },
	context,
);
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });

const first = await root.submit({ type: "input", content: "First question" }, context);

// 忙时输入排队成 follow-up（默认）或 steer，write 也排队。
const followUp = await root.submit({ type: "input", content: "A follow-up" }, context);
const steer = await root.submit({ type: "input", content: "A steer", whenBusy: "steer" }, context);
const note = await root.submit({ type: "write", entry: { kind: "app.note", data: "noted while busy" } }, context);
const withdrawn = await root.submit({ type: "input", content: "Never mind" }, context);
// whenBusy: "reject" 不排队，直接拒绝。
await root.submit({ type: "input", content: "Now or never", whenBusy: "reject" }, context).catch((error: Error) => {
	console.log("rejected:", error.message);
});
// 排队中的提交可以在边界放置它之前撤销。
console.log("withdraw:", await withdrawn.abort(context));

const inbox = await harness.snapshot(InboxDoc, root.id, context);
console.log(
	"inbox:",
	inbox?.items.map((item) => `${item.id} ${item.mode}`),
);

// 第一条回答在 final 边界结束这个 run：先放置 write，再放置 steer 与 follow-up，它们一起开下一轮 run。
release();
const status = async (name: string, submission: Submission) => {
	const record = await submission.wait(context);
	console.log(`${name}:`, record.status, record.status === "unanswered" ? record.reason : "");
};
```

**逐点解释**：

1. 用一个「等外部放行」的 `FauxResponseStep`（函数步骤，`await held` 后返回消息）把「忙」变成确定性状态，而不是靠 sleep 猜时间。23 与 25 用的是同一手法。
2. `followUpMode: "all"` 在边界选人时生效：`pick()` 是 `queueMode === "all" ? indexes : indexes.slice(0, 1)`（`src/harness/inbox.ts:75-78`）。本示例只排了一条 follow-up，所以 `"all"` 与默认 `one-at-a-time` 的选择结果**相同**；它的价值在「一次排了多条 follow-up」时才显现。别把输出里的「两条一起开新 run」归因于这个设置——那是 `final` 边界同时选 steer 与 follow-up 的结果。
3. `whenBusy` 默认 follow-up：`const mode = draft.whenBusy === "steer" ? "steer" : "followUp"`（`src/harness/submissions.ts:184`）。
4. `whenBusy: "reject"` 在**写任何记录之前**判断：`if (busy && draft.type === "input" && draft.whenBusy === "reject") throw new ConversationBusy(...)`（`src/harness/submissions.ts:166`）。所以拒绝不留痕迹——inbox 快照里没有它。
5. `write` 提交类型上没有 `whenBusy`（`src/harness/types.ts:64-69`），它只写一条被动 entry；忙时同样排队，等边界放置。
6. `withdrawn.abort(context)` 返回 `"aborted"` 而不是抛错：只有仍 `queued` 的提交能撤销，已 placed 返回 `already_placed`、已终态返回 `settled`（`src/harness/submissions.ts:90-103`）。撤销同时删 inbox 项并把 submission 置为 `unanswered`/`aborted`。
7. `harness.snapshot(InboxDoc, root.id, context)` 读的是持久化的队列：条目按 ID 顺序，`mode` 就是排队模式（`src/harness/inbox.ts:7-24`）。重启后队列仍在。
8. 边界放置顺序是「先所有 write，再所有 user 项，各自按 ID 顺序」（`src/harness/inbox.ts:79-105`）。这解释了 transcript 里 `app.note` 出现在两条 `pi.user` 之前——注意提交顺序是 follow-up 在 note 之前，输出顺序则是反的。
9. 被放置的两条 user 项加入**新的 run**（`startRun()`），第一条 run 已经 `done`。因此四条提交都是 `done`，被撤销的那条是 `unanswered`/`aborted`。
10. `record.status === "unanswered" ? record.reason : ""` 解释了输出里 `first: done ` 行尾的空格：`console.log` 收到的是 `"first:", "done", ""` 三个参数。

**你会看到**（实测输出，退出码 0，耗时 0.56s）：

```text
rejected: Conversation 1 is busy
withdraw: aborted
inbox: [ '10 followUp', '11 steer', '12 write' ]
first: done 
follow-up: done 
steer: done 
note: done 
withdrawn: unanswered aborted
transcript: [
  'pi.user',
  'pi.assistant',
  'app.note',
  'pi.user',
  'pi.user',
  'pi.assistant'
]
```

`inbox` 那一行是「排队状态本身也被持久化」的证据：三条待放置项带着各自的 ID 与模式。`transcript` 把两个 run 摊开：第一个 run（`pi.user` + `pi.assistant`）、被放置的 `app.note`、然后 steer 与 follow-up 两条 `pi.user` 加它们的共同回答。

**动手改**：

- 把 `whenBusy: "steer"` 改成不写 `whenBusy`：inbox 快照变成 `['10 followUp', '11 followUp', '12 write']`，最终 transcript 里两条 `pi.user` 按 ID 排序（先 follow-up 后 steer）。这验证「模式在排队时决定、放置时按 ID 排序」。
- 把 `followUpMode: "all"` 改成 `"one-at-a-time"`，并再排一条 follow-up（多写一次 `root.submit`）：`one-at-a-time` 下边界只放第一条，剩下那条要等下一次边界。这是唯一能看出该设置作用的实验。
- 把 `withdrawn.abort(context)` 挪到 `release()` 之后：那条提交可能已被放置，`abort()` 返回 `already_placed`（已 settle 则 `settled`），不再是 `aborted`。理解「撤销只对 queued 有效」对做 UI 取消按钮很关键。

**对应源码/测试**：`src/harness/submissions.ts:148-207`（受理、排队、拒绝、放置、stale）、`src/harness/inbox.ts:46-132`（边界选择、放置顺序、撤销、stale 判定）、`src/harness/errors.ts`（`ConversationBusy`）。测试见 `test/harness-inbox.test.ts`、`test/harness-submissions.test.ts`。

### 5.4.8 21-late-join.ts —— 迟到订阅者：先给状态，再给增量

**它演示什么**：一个客户端在运行中途才挂上来。两条通道（结构化的 `viewState()` 与语义化的 `watchEvents()`）都先给「当前状态」，之后只交付挂载之后的变化，包括正在运行的工具的部分输出与半句话的文本增量。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/21-late-join.ts
```

**关键代码**（`test/examples/21-late-join.ts:23-56`、`test/examples/21-late-join.ts:58-93`）：

```typescript
// 一个每 100ms 打印一行的工具，然后是一个缓慢流式的回答。
const registry = createRegistry();
registry.install(
	defineExtension({
		name: "count",
		tools: [
			defineTool({
				name: "count",
				description: "Counts to ten",
				parameters: Type.Object({}),
				execute: async (_args, api) => {
					for (let n = 1; n <= 10; n++) {
						// 增量输出：每次都会变成 pi.live 里这个工具槽的 output。
						api.output(`${n}\n`);
						await pause(100);
					}
					return {};
				},
			}),
		],
	}),
);
// 40 tokens/s、每次 1 token：让文本增量足够碎，便于观察。
const faux = fauxProvider({ tokensPerSecond: 40, tokenSize: { min: 1, max: 1 } });
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("count", {}, { id: "call-1" })], { stopReason: "toolUse" }),
	fauxAssistantMessage([fauxText("Counted to ten, and this answer streams slowly.")]),
]);
const models = createModels();
models.setProvider(faux.provider);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, context);
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });

const submission = await root.submit({ type: "input", content: "Count to ten, then tell me." }, context);
// 在工具跑到一半时接上来。
await pause(500);

// 结构化客户端：视图里有已提交的转录与文档，包括正在运行的工具输出。
const view = await root.viewState(context);
const live = view.value.docs["pi.live"] as LiveState;
console.log(
	"view entries:",
	view.value.entries.map((entry) => entry.kind),
);
console.log("view tool slot:", live.tools?.[0]?.status, JSON.stringify(live.tools?.[0]?.output));
view.subscribe((value) => {
	const slot = (value.docs["pi.live"] as LiveState).tools?.[0];
	if (slot?.status === "running") console.log("view output now:", JSON.stringify(slot.output));
});

// 事件客户端：snapshot 事件带着同一份状态；之后的事件作用在它上面。
const stream = await watchEvents(harness, root.id, context);
console.log(
	"snapshot tools:",
	stream.snapshot.tools.map((slot) => `${slot.name} ${slot.status}`),
);
let output = stream.snapshot.tools[0]?.output ?? "";
stream.start(async (events: readonly AgentEvent[]) => {
	for (const event of events) {
		if (event.type === "tool_execution_update" && event.output !== undefined) {
			// update 要么整体替换（set），要么先裁掉前 N 个字符再追加（trimStart + append）。
			output =
				"set" in event.output
					? event.output.set
					: output.slice(event.output.trimStart ?? 0) + (event.output.append ?? "");
			console.log("event output now:", JSON.stringify(output));
		} else if (event.type === "message_update") {
			const deltas = event.changes.flatMap((change) => (change.type === "text_delta" ? [change.delta] : []));
			console.log("event text delta:", JSON.stringify(deltas.join("")));
		} else {
			console.log("event:", event.type);
		}
	}
});
```

**逐点解释**：

1. 工具用 `api.output()` 增量输出，harness 节流写进 `pi.live.tools[slot].output`（`src/harness/tool.ts:276-322`）。写的是**一个字符串字段**，因此 Chord 能把它 diff 成追加或「裁剪 + 追加」（`src/harness/tool.ts:299-303` 的 REMINDER）。这是「运行中工具输出可被外部实时看到」的实现；17 里只有 spill 诊断，没有第二种进度通道。
2. `pause(500)` 之后再接入，正好落在第 5–6 行之间。示例用真实时间，所以**切分位置每次运行都不同**（记录里从第 6 行起）；断言该输出必须用「从第 N 行开始直到 10」这类形状，不能写死数字。
3. `viewState()` 给的 `ConversationView` 有三块：`conversation`、`entries`（已提交的活跃转录）、`docs`（内建文档按 kind 索引，`src/harness/view.ts:26-32`）。工具槽的 `status`/`output` 在 `docs["pi.live"]` 里。
4. `as LiveState` 断言是必要的：`docs` 的值类型是 `JsonObject`，视图不知道每个 kind 的具体形状。
5. `view.subscribe(...)` 是 Chord 的可复制状态订阅：状态对象在任意时刻都是自洽的当前值，回调收到完整新值。对 UI 而言这是「先渲染状态、再按帧刷新」，不像事件流那样要求自己维护重建逻辑。
6. 事件通道第一件事是读 `stream.snapshot`：它和 `view.value` 描述同一份状态（这就是两条通道等价的含义）。`snapshot.tools` 已经列出 `count running`，说明订阅者知道有工具在跑，只是不知道它之前打印了什么。
7. `tool_execution_update.output` 是两种形态之一：`{ set: string }`（整体替换，例如槽位被重置或输出被 trim 到找不到重叠）或 `{ trimStart?: number; append?: string }`（先砍掉前 N 个字符再追加）。示例用 `output.slice(trimStart) + append` 重建，正是 `src/harness/events.ts:397-413` 生成它的逆运算。**写错这里**（当成纯 append 拼接）会在长输出触发滑动窗口时把旧文本拼回来。
8. `message_update.changes` 里挑 `text_delta` 累加：文本增量**只交付挂载之后的部分**，所以第一段是 `"en, and this ans"` 这种半句话。这不是 bug，而是「迟到订阅者不补发历史」的直接证据；要完整文本就等 `message_end`，或读 `pi.live.generation.message` 的完整快照。
9. 收尾顺序：`submission.wait()` → `harness.waitForIdle()` → `pause(0)`（让最后一批事件打印）→ `stream.stop()` → `view.dispose()`。`view` 是 Chord 状态，必须 `dispose()` 释放；watch 用 `stop()`。

**你会看到**（实测输出，退出码 0，耗时 2.10s）：

```text
view entries: [ 'pi.user', 'pi.system', 'pi.assistant' ]
view tool slot: running "1\n2\n3\n4\n5\n"
view output now: "1\n2\n3\n4\n5\n"
snapshot tools: [ 'count running' ]
view output now: "1\n2\n3\n4\n5\n6\n"
event output now: "1\n2\n3\n4\n5\n6\n"
view output now: "1\n2\n3\n4\n5\n6\n7\n"
event output now: "1\n2\n3\n4\n5\n6\n7\n"
view output now: "1\n2\n3\n4\n5\n6\n7\n8\n"
event output now: "1\n2\n3\n4\n5\n6\n7\n8\n"
view output now: "1\n2\n3\n4\n5\n6\n7\n8\n9\n"
event output now: "1\n2\n3\n4\n5\n6\n7\n8\n9\n"
view output now: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"
event output now: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"
event: tool_execution_end
event: message_start
event: message_end
event: turn_end
event: turn_start
event: message_start
event text delta: "en, and this ans"
event text delta: "wer streams slow"
event: message_end
event: turn_end
event: run_end
event: submission
event: usage_changed
```

两点值得强调：两条通道从第 6 行起**逐步一致**地收到工具输出，事件通道的起点是 snapshot 里的 `count running`——「先状态、后增量」的完整证据链；事件流末尾把一次运行的收尾顺序完整暴露出来（`tool_execution_end → turn_end → turn_start → … → run_end → submission → usage_changed`）。

**动手改**：

- 把 `pause(500)` 改成 `pause(1000)`：`view tool slot` 会从第 9/10 行附近开始，`event text delta` 的第一段也可能完全不同。这确认「迟到订阅只交付新变化、切分点随挂载时刻浮动」。
- 删掉事件通道对 `trimStart` 的处理（只做 `output + append`）：本示例输出太短看不出差别，但把 `count` 改成打印 500 行并给工具加 `outputLimits: { maxLines: 50, retain: "tail" }` 之后，就会看到重复的尾巴。这是写出正确工具面板的前提。
- 在 `viewState()` 之前再加一次 `await pause(600)`（总等待 1.1s），让工具在接入前就结束：`view tool slot` 的 `status` 会变成 `done`，`output` 可能已被清空（`finishSlot()` 会 `clearProgress()`，`src/harness/live.ts:122-135`），此时客户端**看不到**工具输出，却能在 `entries` 里找到结果 entry。这个对比解释了「运行中状态为什么要单独放进 pi.live」。

**对应源码/测试**：`src/harness/tool.ts:272-322`（进度提交与差分）、`src/harness/live.ts:10-31`（`ToolSlot` 字段）、`:122-135`（完成后清理）、`src/harness/events.ts:36-135`（快照）、`:397-413`（输出更新的两种形态）、`src/harness/view.ts:26-119`（视图与 watch）。测试见 `test/harness-live-deltas.test.ts`、`test/harness-events.test.ts`。

## 5.5 D 组：进阶模式（22–31）

D 组的十个示例把 C 组建立起来的概念组合成真实产品形态：前台子 agent（22）、后台持久 subagent（23）、父子任务与 `failFast`（24）、上下文压缩（25）、一个小组装出来的 coding agent（26）、计划模式（27）、reviewer agent（28）、每会话沙箱（29）、同名工具替换与装饰（30）、热重载与跨重启绑定（31）。

四个最难的示例（5.5.1–5.5.4）展开讲：所有权与 replay 三件套、anchor/reporter 的构造、`failFast` 与 `allSettled` 的差别、压缩的三种触发与 `stale` 判定。它们共同的主线是：**把「谁拥有什么」写进记录，崩溃与中止才有确定语义**。

### 5.5.1 22-subagent-foreground.ts —— 前台子 agent：工具调用拥有子会话

**它演示什么**：一个 `subagent` 工具，被调用时创建并拥有一个子会话，把任务发进去、等它回答、把回答作为工具结果返回。它是「子 agent」在这个 harness 里的最小完整形态：所有权（abort 会传递）、replay 三件套（重启不重复创建、不重复投递），以及 UI 通过工具调用的 `details` 发现子会话并按层级缩进展示它的事件。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/22-subagent-foreground.ts
```

**关键代码**（`test/examples/22-subagent-foreground.ts:33-77`）：

```typescript
async function answerText(api: ToolExecutionApi, answer: EntryId, callContext: Context): Promise<string> {
	const entry = await api.commit((tx) => tx.entry(AssistantEntry, answer), callContext);
	const message = entry?.model?.[0] as AssistantMessage;
	return message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
}

const Subagent: Extension = defineExtension({
	name: "subagent",
	tools: [
		defineTool({
			name: "subagent",
			description: "Delegate a self-contained task to a subagent and get its answer back.",
			parameters: Type.Object({ task: Type.String({ description: "What the subagent should do" }) }),
			// replay 三件套之一：崩溃后可以安全重跑，重跑会找到已建好的子会话与已发出的提交。
			replay: "safe",
			execute: async (args, api, callContext) => {
				const { task } = args;
				// 子会话由「这次工具调用的任务」拥有：中止调用就中止子会话，调用也只有在子会话干完活后才会结束。
				const child = await api.commit(async (tx) => {
					// replay 三件套之二：所有权索引就是幂等键，重跑找到它而不是再建一个。
					const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
					if (existing !== undefined) return existing.id;
					// 子会话初始是本会话 agent 的副本：模型、思考级别、cwd、扩展、工具。
					const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
					// 没有这一步，子会话也会被提供这个工具，从而可以无限递归地开子 agent。
					await configure(tx, created.id, { extensions: { remove: [Subagent] } });
					return created.id;
				}, callContext);
				// UI 看着父会话，看到这个 details 就能挂到子会话上。
				await api.details({ conversationId: child }, callContext);

				const handle = (await api.conversation(child, callContext))!;
				// replay 三件套之三：固定 requestId，重跑拿到的是崩溃前已经发出的那条提交。
				const request = { type: "input", content: task, requestId: `subagent:${api.taskId}` } as const;
				const settled = await (await handle.submit(request, callContext)).wait(callContext);
				if (settled.status !== "done" || settled.type !== "input") {
					throw new Error(`Subagent failed: ${settled.status}`);
				}
				const text = await answerText(api, settled.answer, callContext);
				return { content: [{ type: "text", text }], details: { conversationId: child } };
			},
		}),
	],
});
```

宿主与 UI 侧（`test/examples/22-subagent-foreground.ts:104-135`）：

```typescript
const print = (indent: string, event: AgentEvent): void => {
	if (event.type === "message_end" && event.entry.kind === "pi.assistant") {
		const message = event.entry.model?.[0] as AssistantMessage;
		const text = message.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
		if (text !== "") console.log(`${indent}assistant: ${text}`);
	} else if (event.type === "tool_execution_start") {
		console.log(`${indent}tool ${event.toolName}(${JSON.stringify(event.args)})`);
	}
};
const attached = new Set<ConversationId>();
const attach = async (id: ConversationId, indent: string): Promise<void> => {
	attached.add(id);
	const stream = await watchEvents(harness, id, context);
	stream.start(async (events) => {
		for (const event of events) {
			print(indent, event);
			// 缩进层级不是硬编码的：从工具调用的 running details 里发现子会话，再递归挂上去。
			if (event.type !== "tool_execution_update") continue;
			const child = (event.details as { conversationId?: ConversationId } | undefined)?.conversationId;
			if (child !== undefined && !attached.has(child)) await attach(child, `${indent}  `);
		}
	});
};
await attach(root.id, "");

const submission = await root.submit(
	{ type: "input", content: "Use the subagent tool to find three prime numbers, then tell me what it said." },
	context,
);
await submission.wait(context);
await harness.waitForIdle(context);
// 事件回调在其提交之后运行；让最后几个回调打印完。
await new Promise((resolve) => setTimeout(resolve, 0));
await harness.close(context);
```

**逐点解释**：

1. `replay: "safe"` 是「崩溃后自动重跑」的开关。`pi.tool` 在真正执行前会把意图（最终参数 + replay 策略）落成 checkpoint（`src/harness/tool.ts:85-90`）；若进程在这之后崩溃，恢复时任务从 `execute` 阶段重进，只有**存储的策略与当前注册的工具策略都是 `safe`** 才重跑（`src/harness/tool.ts:94-105`）。默认是 `unsafe`：恢复时不重跑，把调用结算成「被中断、可能已部分执行」的失败结果；而 `failed` 记录的是取消意图，所以这个调用拥有的子会话会被中止（`src/harness/tool.ts:107-110`）。**标成 `unsafe` 的后果**：一次崩溃重启后子会话被中止、父 agent 只收到「工具被中断」——对只读委托是白丢工作，对已经扣款的工具则是正确的谨慎。
2. `tx.scanConversations({ ownerTaskId: api.taskId }, 1)` 是幂等键的实现：所有权是**不可变的记录边**（`src/types.ts:263-264`、`:285-298`），一个工具任务至多拥有一个子会话，所以「按 owner 查、查到就用」等价于「这次调用已经建过子会话」。它必须与创建写在同一个 `api.commit()` 里——否则「建了但没记住」的崩溃窗口会留下孤儿会话。
3. `ownership: { kind: "task", taskId: api.taskId }` 决定中止的传播方向。工具任务被中止（父会话按 Esc，或调用所属的 generation 被中止）时，子会话作为它拥有的工作被级联标记并中止；空闲等待也要等它（`waitForIdle` 的范围是「普通所有权范围内没有活着的非后台任务」，`src/harness/types.ts:524-528`）。**写成 `ownerless` 的后果**：父子关系不存在，父会话可以在子会话还在生成时就空闲，UI 的折叠与中止全部失效。
4. `configure(tx, created.id, { extensions: { remove: [Subagent] } })`：新建的 task-owned 会话会复制 owner 会话存储的 `pi.agent`（`src/harness/agent.ts:126-132`），默认继承模型、扩展、工具、cwd。移除自身扩展是最小防递归手段；`configure` 只存扩展**名字**的增删（`src/harness/agent.ts:92-103`），所以之后热重载 `Subagent` 对象也不会失效（31 会验证这个性质）。
5. `api.details({ conversationId: child })` 是给 UI 的挂载点。details 会进入工具的进度提交（`src/harness/tool.ts:202-210`），也会作为工具结果的 details 返回（返回值里又写了一遍，因为结果未必读到运行时进度）。事件流里它以 `tool_execution_update.details` 出现——这就是 `attach()` 的发现通道。
6. `requestId: \`subagent:${api.taskId}\`` 是幂等投递：admission 先查 `submissionByRequest()`，命中就返回原记录 id、不写任何东西（`src/harness/submissions.ts:155-163`）；同一 requestId 换类型会直接抛错（`:158-160`）。**不写 requestId 的后果**：重跑会往子会话追加第二条一样的用户消息，子 agent 答两遍。测试 `test/harness-ownership.test.ts:845-898` 正断言这一点：重启后应只有一条 `pi.user` entry，且两次拿到的是同一个子会话 id。
7. `handle.submit(...).wait(...)` 让工具调用**阻塞到子会话被回答**，这就是「前台」的定义：父 agent 这一回合什么都不做，只等子会话。返回值只用 `settled.answer`（子会话里助手 entry 的 id），再由 `answerText()` 用一次只读提交取回文本。
8. `settled.status !== "done"` 时抛错是刻意的：抛错让 `pi.tool` 以 `failed` 结算（`src/harness/tool.ts:247-257`），触发第 1 条的取消意图——子会话被中止，而不是留一个半死不活的对话继续烧 token。
9. UI 的缩进来自数据而非硬编码：`attach()` 递归地按 `details.conversationId` 发现子会话，用 `indent + "  "` 挂载它的流；`attached` 集合防止同一会话被挂两次。
10. `waitForIdle()` 之后还要 `setTimeout(0)`：事件回调在其提交之后被调用，最后一批可能还在队列里（与 19 同理）。少了它，输出可能缺最后一行 `assistant:`。

**你会看到**（实测输出，退出码 0，耗时 0.63s）：

```text
tool subagent({"task":"Name three prime numbers."})
  assistant: 2, 3, and 5.
assistant: The subagent says: 2, 3, and 5.
```

三行就是「父委托 → 子回答 → 父汇报」：第一行来自父会话事件流里的 `tool_execution_start`；第二行缩进两格，来自**子会话**的事件流；第三行是父会话的第二条助手消息（faux 脚本的最后一条）。子会话只贡献一个 `assistant:` 行，是因为 `print()` 只打印助手消息与工具调用开始，不打印系统/user/tool-result。

一个隐藏前提值得点出：示例让父、子共用一个 faux 响应队列，脚本顺序（委托调用 → 子回答 → 父汇报）之所以稳定，是因为父 agent 在工具调用里**同步等待**子回答、期间不会发第二次请求。真实多 agent 场景里这个假设不成立，模型响应必须靠 provider 的会话身份隔离，而不是全局队列。

**动手改**：

- 删掉 `replay: "safe"`（默认 `unsafe`），把存储换成 `openNodeSqliteStorage(join(directory, "session.sqlite"))`，在子会话回答到一半时 `harness.close(context)` 再重新打开：工具调用会被结算成「被中断、可能已部分执行」的失败结果，子会话被中止。对照 23 的后台版本，这是「前台委托为什么必须能安全重跑」的最好证明。[待核]: 本示例用的是 `MemoryStorage`，跨重启验证需要先换存储；仓库里现成的跨重启断言在 `test/harness-ownership.test.ts:845-898`。
- 注释掉 `configure(...)` 那一行（移除 `Subagent`），并把脚本改成让子会话再调用一次 `subagent`：子会话会拥有自己的子会话，UI 因为递归挂载继续缩进。这演示了「扩展选择是防止 agent 无限自复制的手段」。
- 保留 `replay: "safe"`，但去掉 `scanConversations` 查找、直接 `createConversation`：重跑会创建第二个子会话，而 `requestId` 又让第二次提交命中第一条记录——于是父 agent 拿到旧子会话的答案，UI 却挂到一个空的新会话上。这种「部分幂等」是最难查的 bug 形态。

**对应源码/测试**：`src/harness/tool.ts:35-118`（`replay` 意图与恢复规则）、`:160-270`（`ToolExecutionApi` 的 `details`/`commit`/`conversation`）、`src/harness/submissions.ts:141-207`（admission 与 requestId）、`src/harness/agent.ts:121-132`（子会话复制父 agent）、`:212-232`（扩展选择）、`src/types.ts:263-298`（`TaskOwnership`/`ConversationOwnership`/`ConversationRecord.owner`）、`src/harness/scheduler.ts:321-344`（会话中止的所有权遍历）。测试：`test/harness-ownership.test.ts:845-898`（safe replay 重跑：同一子会话、只一条用户消息、工具结果不是错误）、`test/harness-tools-recovery.test.ts:136-200`（只有两侧都 `safe` 才重跑）、`test/spec-usage.test.ts:166-190`（同一模式的紧凑断言）。

### 5.5.2 23-subagent-background.ts —— 后台持久 subagent：anchor + reporter

**它演示什么**：一组可以 `spawn`/`send`/`stop`/`status` 的命名 subagent。它们独立于主 agent 的回合工作，答案到达后作为**新消息**送回主会话；主 agent 会话关闭再打开，未完成的传送与报告照常继续。这是全套示例里最长的一个（339 行），也是「所有权 + 幂等 + 后台边界」三件事组合起来的产品形态。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/23-subagent-background.ts
```

**关键代码 1/4：注册表文档与 anchor 任务**（`test/examples/23-subagent-background.ts:38-71`）：

```typescript
// 每个 subagent 是自己的会话，有自己的转录，所以它能记住之前的消息。
// 主会话用一个小组文档把 subagent 名字映射到会话。文档是与转录并列的持久状态，和 entry 一样在提交里改。
type Subagent = {
	conversationId: ConversationId;
	/** 已经报告给主 agent 的回答：多条消息可能落在同一个回答上，只报告一次。 */
	reported: EntryId[];
};
const Subagents = defineDoc<{ agents: Record<string, Subagent>; reporters: Record<string, TaskId> }>({
	kind: "app.subagents",
	version: 1,
	scope: "conversation",
	history: "latest",
	// 主会话的 fork 不带 subagent。
	fork: "initial",
	initial: () => ({ agents: {}, reporters: {} }),
});

// 每个任务和会话都有所有者，所有者决定一次 abort 或一次空闲等待能到达哪里……
// subagent 必须比主 agent 的回合活得更久，所以它的会话由一个 anchor 拥有：一个立刻结束的后台任务。
// 后台任务是一条边界：主 agent 的 Esc 与空闲等待停在这里，但 abort({ background: true }) 还能穿过它。
const Anchor = defineTask<null, { phase: "done" }, null>({
	name: "app.subagent-anchor",
	version: 1,
	initial: () => ({ phase: "done" }),
	phases: {
		// 唯一的阶段立刻提交终态：anchor 存在的意义只是「提供一个所有者」。
		done: (_anchor, runtime, taskContext) =>
			runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), taskContext),
	},
	abort: (_anchor, runtime, taskContext) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext),
});
```

**关键代码 2/4：reporter 任务**（`test/examples/23-subagent-background.ts:77-126`）：

```typescript
type ReporterInput = { name: string; conversationId: ConversationId; message: string; followUp: boolean };
type ReporterState = { phase: "deliver" } | { phase: "report"; report?: string };
const Reporter = defineTask<ReporterInput, ReporterState, null>({
	name: "app.subagent-reporter",
	version: 1,
	initial: () => ({ phase: "deliver" }),
	phases: {
		// 发送消息、等它的回答，然后决定要报告什么。
		deliver: async (reporter, runtime, taskContext) => {
			const { name, conversationId, message, followUp } = reporter.input;
			// subagent 忙时，steer 在它的下一个边界到达，follow-up 在它当前回答之后到达。
			const subagent = (await runtime.conversation(conversationId, taskContext))!;
			const request = { type: "input", content: message, whenBusy: followUp ? "followUp" : "steer" } as const;
			// 固定的 requestId：重启后重跑这个阶段，拿到的是已经发出的那条提交。
			const submission = await subagent.submit({ ...request, requestId: `subagent:${reporter.id}` }, taskContext);
			const settled = await submission.wait(taskContext);
			// 一个提交同时决定报告内容并记录「这个回答已经送达」，所以重启后不会重新决定一次。
			await runtime.commit(async (tx) => {
				const next = (report?: string) => ({ status: "running", checkpoint: { phase: "report", report } }) as const;
				// aborted：被停止，或排队时被撤销。没有什么可报告的。
				if (settled.status === "unanswered") {
					return next(settled.reason === "aborted" ? undefined : `[subagent ${name} failed: ${settled.reason}]`);
				}
				// 这里一定是被回答的 input；这个判断只是给 TypeScript 看的。
				if (settled.type !== "input") return next();
				const agent = (await tx.doc(Subagents, runtime.conversationId)).agents[name]!;
				if (agent.reported.includes(settled.answer)) return next();
				agent.reported.push(settled.answer);
				const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as AssistantMessage;
				return next(`[subagent ${name} answered, no reply needed] ${textOf(answer)}`);
			}, taskContext);
		},
		// 把报告作为 follow-up 输入投出去：主 agent 空闲时它开一个回合，否则等它的当前回答结束。
		// 用户在主 agent 的队列里按 Esc 时，它和其他输入一起被丢弃；Esc 之后到达的报告会开一个新回合。
		report: async (reporter, runtime, taskContext) => {
			const report = reporter.state.checkpoint.report;
			if (report !== undefined) {
				const main = (await runtime.conversation(runtime.conversationId, taskContext))!;
				const input = { type: "input", content: report, whenBusy: "followUp" } as const;
				// 第二个固定 requestId：报告也只送达一次。
				await main.submit({ ...input, requestId: `subagent-report:${reporter.id}` }, taskContext);
			}
			await runtime.commit(
				() => ({ status: "terminal", outcome: { status: "completed", result: null } }),
				taskContext,
			);
		},
	},
	abort: (_reporter, runtime, taskContext) =>
		runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext),
});
```

**关键代码 3/4：管理工具**（`test/examples/23-subagent-background.ts:144-206`）：

```typescript
	// 被崩溃打断的调用不会重跑：重复 stop 可能停掉更新的工作。模型会看到调用被中断，并可以用 status 检查。
	replay: "unsafe",
	execute: async (args, api, callContext) => {
		const { action, name, message, followUp } = args;
		// …reply() 与 snapshot(Subagents) 的读取见源码 149-157 行…
		if (action === "status") {
			const names = name === undefined ? Object.keys(registry.agents) : [name];
			const lines: string[] = [];
			for (const each of names) {
				const found = Object.hasOwn(registry.agents, each) ? registry.agents[each] : undefined;
				if (found === undefined) continue;
				// 有 run 的会话就是忙的：从一次输入到它最终的回答。
				const busy = (await api.snapshot(LiveDoc, found.conversationId, callContext))?.run !== undefined;
				lines.push(`${each}: ${busy ? "working" : "idle"}`);
			}
			return reply(lines.length === 0 ? "No subagents." : lines.join("\n"));
		}
		if (name === undefined) return reply(`${action} needs a name.`);
		const agent = Object.hasOwn(registry.agents, name) ? registry.agents[name] : undefined;
		if (action !== "spawn" && agent === undefined) return reply(`No subagent named ${name}.`);

		if (action === "stop") {
			// 中止 subagent 当前的回答与工具，并丢弃它排队的消息。它仍然可用。
			await (await api.conversation(agent!.conversationId, callContext))!.abort(callContext);
			return reply(`Stopped ${name}.`, agent!.conversationId);
		}
		if (message === undefined) return reply(`${action} needs a message.`);

		// spawn 与 send：一个提交为这条消息启动一个 reporter。
		const result = await api.commit(async (tx) => {
			const state = await tx.doc(Subagents, api.conversationId);
			// 两个任务都属于主会话并且是后台的：主会话的 Esc 与空闲等待都会跳过它们。
			const background = { ownership: { kind: "conversation" }, background: true } as const;
			if (action === "spawn") {
				if (Object.hasOwn(state.agents, name)) return `${name} already exists; use send.`;
				const anchor = await tx.createTask(Anchor, null, background);
				// 由主会话的某个任务拥有：初始是主 agent 的副本。
				const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
				// subagent 不能再开 subagent，并且知道自己的名字。
				await configure(tx, child.id, {
					extensions: { remove: [SubagentTools] },
					instructions: `You are the subagent "${name}". Answer the main agent's requests.`,
				});
				state.agents[name] = { conversationId: child.id, reported: [] };
			}
			const conversationId = state.agents[name]!.conversationId;
			const input = { name, conversationId, message, followUp: action === "send" && followUp === true };
			state.reporters[api.taskId] = await tx.createTask(Reporter, input, background);
			return action === "send" ? `Sent to ${name}.` : `Started ${name}.`;
		}, callContext);
		const current = (await api.snapshot(Subagents, api.conversationId, callContext))?.agents[name];
		return reply(result, current?.conversationId);
	},
});
```

**关键代码 4/5：UI 与轮询助手**（`test/examples/23-subagent-background.ts:284-310`、`test/examples/23-subagent-background.ts:327-335`）：

```typescript
/** 主会话的消息在提交时打印。subagent 在自己的会话里工作。 */
async function follow(harness: Harness, id: ConversationId): Promise<void> {
	const stream = await watchEvents(harness, id, context);
	stream.start(async (events: readonly AgentEvent[]) => {
		for (const event of events) {
			if (event.type !== "message_end") continue;
			const message = event.entry.model?.[0];
			if (message?.role === "user") {
				const text = contentText(message.content);
				// 输入要么来自用户，要么来自 subagent 的报告——报告在 subagent 完成时随时到达。
				const report = /^\[subagent (\S+) ([^\]]*)\] ?(.*)$/s.exec(text);
				if (report === null) console.log(`\n${cyan(bold(">"))} ${bold(text)}`);
				else console.log(`\n${magenta(bold(`> ${report[1]}:`))} ${report[3] || report[2]}`);
			} else if (message?.role === "assistant") {
				for (const part of message.content) {
					if (part.type !== "toolCall") continue;
					const { action, name, message: sent } = part.arguments as Record<string, string | undefined>;
					const quoted = sent === undefined ? "" : ` ${JSON.stringify(sent)}`;
					console.log(yellow(`  ${part.name} ${action}${name === undefined ? "" : ` ${name}`}${quoted}`));
				}
				if (textOf(message) !== "") console.log(textOf(message));
			} else if (message?.role === "toolResult") {
				console.log(dim(`  → ${contentText(message.content)}`));
			}
		}
	});
}

/** 轮询 `check`，最多 10 秒。 */
const until = async (check: () => Promise<boolean>): Promise<void> => {
	for (let tries = 0; tries < 1000 && !(await check()); tries++)
		await new Promise((resolve) => setTimeout(resolve, 10));
};
const working = async (name: string): Promise<boolean> => {
	const agent = (await harness.snapshot(Subagents, root.id, context))?.agents[name];
	return agent !== undefined && (await harness.snapshot(LiveDoc, agent.conversationId, context))?.run !== undefined;
};
```

**关键代码 5/5：重启与观察**（`test/examples/23-subagent-background.ts:319-363`）：

```typescript
/** 等到发给每个 subagent 的消息都被回答并报告，且主 agent 已经反应完。 */
const settle = async (): Promise<void> => {
	const reporters = (await harness.snapshot(Subagents, root.id, context))?.reporters ?? {};
	// 显式等每个 reporter 任务终态：它们不是主会话的普通工作，waitForIdle 不会等它们。
	for (const id of Object.values(reporters)) await harness.waitForTask(id, context);
	await root.waitForIdle(context);
	// 事件回调在其提交之后运行；让最后几个打印完。慢机器可能需要更久。
	await new Promise((resolve) => setTimeout(resolve, 50));
};

// 进程在 subagent 处理消息时停掉；重启后它的回答仍会送达。
const reporters = async () =>
	Object.keys((await harness.snapshot(Subagents, root.id, context))?.reporters ?? {}).length;
const before = await reporters();
await root.submit({ type: "input", content: "Ask reader for the whale's name." }, context);
await until(async () => (await reporters()) > before);
await harness.close(context);
console.log(dim("\n  (process restarts)"));
({ harness, root } = await open());
await follow(harness, root.id);
await settle();
```

**逐点解释**：

1. 每个 subagent 是**独立会话**而不是「一个更长的转录」：它有自己的 `pi.agent`（模型、扩展、工具、cwd）、自己的 provider 会话身份、自己的转录，因此能记住之前的消息；主会话只保存「名字 → 会话 id」的映射。测试里的对照实现（`test/harness-ownership.test.ts:900-964`）同样把子会话 id 放进一个应用文档。
2. `Subagents` 文档用 `fork: "initial"`：主会话 fork 出来的副本从空表开始。若写成 `fork: "current"`，fork 会指向父会话的 subagent 会话——那是另一条转录，语义上是共享而非复制。`history: "latest"` 则说明这张表不需要回看历史（与 27 的 `PlanDoc` 相反）。
3. anchor 的构造要点有三条。**为什么需要**：`createConversation({ ownership: { kind: "task", taskId } })` 要求所有者是一个任务，而 subagent 不能由主会话当前的 generation 拥有——那个 generation 会在本轮结束时终态，subagent 就活不过它。**为什么立刻完成**：anchor 不需要做任何事，它的价值是提供一条不可变的所有者边；conversation 在所有者完成后仍然可用（spec §5.5），所以「所有者已完成、会话仍活着」是合法状态。**为什么是后台**：`background: true` 让 anchor（以及它拥有的子会话）成为普通空闲等待与级联中止的边界。
4. `background: true` 只对**会话拥有的**任务有效（`TaskOptions.background`，`src/types.ts:270-280`）；`reporters` 也是会话拥有 + 后台，所以 `root.waitForIdle()` 永远不等它们。这就是 `settle()` 必须显式 `waitForTask` 每个 reporter 的原因——空闲等待不会替你做这件事。
5. `Conversation.abort({ background: true })` 是唯一能穿透后台边界的路径（`src/harness/types.ts:103-111`、`src/harness/scheduler.ts:321-344`）。主 agent 的 Esc 停在这里：这正是「用户打断主 agent 不会顺手杀死后台 subagent」的设计。
6. reporter 是**两阶段状态机**：`deliver`（发送 + 等待 + 决定报告）与 `report`（投递报告）。每个阶段结束都提交一个 checkpoint（`runtime.commit` 返回 `{ status: "running", checkpoint }` 或终态），所以进程在任意时刻崩溃都能从最后一个 checkpoint 继续。恢复时调度器把 `running` 改回 `pending` 再重新派发（`src/harness/scheduler.ts:231-256`）。
7. **replay 三件套在这里是「两个 requestId」**：`subagent:${reporter.id}` 保证「一条消息只送达一次」，`subagent-report:${reporter.id}` 保证「一份报告只投递一次」。两个 requestId 分属两个会话（子会话与主会话），admission 的幂等范围也是「一个会话内」（`src/types.ts:355-360`）。它们与 22 的 `scanConversations` 属于同一件事的不同侧面：**用记录而不是用内存状态判断「这件事做过了」**。
8. `deliver` 的提交把「报告文本」与「`reported` 标记」写在一起（第 92-93 行的注释）。这是最容易写错的地方：如果先推 `reported`、再在别的地方投递报告，崩溃会永久丢掉报告；如果先投递、后推标记，崩溃会重复报告。写在一个提交里，两种坏情况都不存在——代价是「报告内容」必须在提交前算出来（所以要先 `tx.entry()` 取回答文本）。
9. `reported.includes(settled.answer)` 用**回答 entry 的 id** 去重，而不是用消息 id：多条消息可能落在同一个回答上（报告阶段的注释就是这么写的），用回答做键才能「一次报告覆盖多条消息」。写错成「每条消息报一次」，用户在等待期间连发两条消息时会收到两份几乎相同的报告。
10. `settled.status === "unanswered"` 时 `reason === "aborted"` 不报告，其他原因（如 `model_error`）报告成 `[subagent X failed: …]`。这区分了「用户主动停止」与「subagent 自己失败」——前者不该打扰主 agent，后者必须让它知道。
11. `replay: "unsafe"` 是刻意的：管理工具里 `stop` 有破坏性，重复执行可能停掉更新的工作。模型会看到「调用被中断、可能已部分执行」的结果，并可以用 `status` 自己核对。这与 22 的 `subagent` 形成对照：**replay 安全性是工具语义的属性，不是 harness 的全局开关**。
12. `status` 判定忙闲用 `pi.live.run !== undefined`（`src/harness/live.ts:44-46` 说明 run 存在恰好等价于忙）。所以 `Stop reader.` 之后 `subagent status` 显示 `reader: idle`：abort 只中止当前回答、丢弃排队消息，会话本身还在。
13. `spawn` 的提交一次性完成四件事：建 anchor、建子会话（拥有者 = anchor，因此复制主 agent 的配置）、`configure` 移除 `SubagentTools` 并写入身份 instructions、在文档里登记名字。`state.reporters[api.taskId] = …` 记录「哪个工具任务起了哪个 reporter」——这是 `settle()` 与重启场景查找待办 reporter 的索引。
14. 任务定义必须随扩展一起安装：`const SubagentTools = defineExtension({ name: "subagent-tools", tasks: [Anchor, Reporter], tools: [subagentTool] })`（`:211`）。任务按**名字**从 registry 快照解析（`RegistrySnapshot.tasks()`，`src/harness/types.ts:275-277`），所以重启后只要宿主重新安装这个扩展，pending 的 reporter 就能继续；没安装则它们停在那里（可 abort，settle 成 `orphaned`）。
15. UI 只 watch 主会话（`follow()`），报告以**用户消息**的形式出现，用正则 `/^\[subagent (\S+) ([^\]]*)\] ?(.*)$/s` 把它渲染成 `> reader: …`。这就是为什么输出里 `reader:` 开头的行和用户输入长得不一样——它们其实是同一个 `pi.user` entry。
16. 脚本模型是一个函数步骤（`FauxResponseStep`），按「最后一条非系统消息」路由：`toolResult` → `OK. …`；含 `Start a subagent` → spawn；含 `[subagent` → `Noted.`；子会话侧含 `Summarize the plot` → 一句短答；其余 → 135 章的流式长答（50 tokens/s，正好让 `Stop reader.` 落在生成中途）。`faux.setResponses(Array.from({ length: 40 }, () => route))` 把同一个路由重复 40 次，所以不必精确数请求次数。
17. `until()` / `working()` 是观察助手而不是业务代码：它们靠轮询「reporter 是否出现」「子会话是否忙」来把示例的顺序固定下来（上限 10 秒）。真实产品不该用轮询，而应订阅 `pi.live` 与任务图；示例选轮询只是为了让时间线可控。
18. `follow()` 只订阅**主会话**，但主会话里会自然出现子 agent 的痕迹：工具调用的参数与结果（`subagent send reader "…"`、`→ Sent to reader.`）加上报告消息。这不意味着子会话的事件被转发了——`follow()` 从头到尾没有订阅任何子会话，报告是**新提交**，不是转发。
19. 两个 requestId 与两个阶段的对应关系可以用一张小表记：

| 阶段 | 提交对象 | requestId | 作用 |
|---|---|---|---|
| `deliver` | 子会话 | `subagent:${reporter.id}` | 一条消息只送一次 |
| `report` | 主会话 | `subagent-report:${reporter.id}` | 一份报告只投一次 |

两者都以 **reporter 任务 id** 为键，而不是以「消息序号」或「时间」为键——任务 id 在创建时就固定，且一个 reporter 只负责一条消息，所以这套键天然一一对应。

**你会看到**（实测输出，退出码 0，耗时 3.50s；行首 `>` 的是主会话的输入/报告，黄色工具行在非 TTY 下不带颜色，`→` 是工具结果）：

```text

> Start a subagent named reader that summarizes Moby Dick.
  subagent spawn reader "Summarize the plot of Moby Dick."
  → Started reader.
OK. Started reader.

> reader: A whale, a captain, an obsession.
Noted.

> Ask reader to summarize every chapter.
  subagent send reader "Now go through all chapters in detail."
  → Sent to reader.
OK. Sent to reader.

> Stop reader.
  subagent stop reader
  → Stopped reader.
OK. Stopped reader.

> What are my subagents doing?
  subagent status
  → reader: idle
OK. reader: idle

> Ask reader for the whale's name.
  subagent send reader "What is the whale called?"
  → Sent to reader.

  (process restarts)
OK. Sent to reader.

> reader: Moby Dick.
Noted.
```

把这份时间线读成状态机：

- 第二幕（`Summarize the plot`）里子会话给出短答后，reporter 的 `deliver` 提交把回答登记为 `reported` 并把报告排进主会话 → 主会话在空闲后开新回合 → `> reader: A whale, a captain, an obsession.` + `Noted.`。注意报告不是「回执」，而是**新输入**：主 agent 必须再花一个回合处理它。
- 第三幕的 135 章长答被 `Stop reader.` 打断：`until(() => working("reader"))` 先确认子会话在忙，`stop` 调 `conversation.abort()`，当前回答被中止、排队的 steer 被撤销；因为 reason 是 `aborted`，reporter 不报告，所以没有任何 `reader: …` 行。
- 第五幕的关键在 `(process restarts)` 的位置：示例在「reporter 任务已出现、主 agent 的命令还没回答完」时关闭 Harness。重开后调度器把 pending 的 generation 与 pending 的 reporter 一起恢复：前者产出 `OK. Sent to reader.`，后者等子会话答出 `Moby Dick.` 之后把报告作为 follow-up 投回主会话，于是最后两行是 `> reader: Moby Dick.` 与 `Noted.`。整条链路（子会话、reporter 的 checkpoint、报告）都是持久化的，这是本示例唯一无法用别的示例替代的演示点。

**动手改**：

- 把 `report` 阶段提交里的 `requestId: \`subagent-report:${reporter.id}\`` 删掉，然后在同一句 `send` 后立刻再发一次 `send`（两条消息、同一个回答窗口）：报告会变成两份。这是验证「报告幂等靠 requestId + `reported` 双保险」的最直接方式。
- 把 `const background = { ownership: { kind: "conversation" }, background: true }` 里的 `background: true` 去掉：`settle()` 里的 `root.waitForIdle()` 会一直等到子会话也空闲（示例里子会话正在跑 135 章，会明显变慢），并且 `root.abort()` 会杀掉后台 subagent。这条实验区分「boundary」与「普通工作」。
- 把 `deliver` 里「先推 `reported`、再返回报告」改成两个提交（一个提交只推 `reported`，下一个提交返回报告），再在两步之间 `harness.close(context)` 重启：报告会永久丢失（标记说已报告、实际没投递）。这就是第 8 条说的窗口，值得亲手制造一次。

**对应源码/测试**：`src/types.ts:263-283`（所有权与 `background`）、`:485-520`（`TaskState` 五个状态）、`src/harness/scheduler.ts:231-256`（open 时把 `running` 改回 `pending`、收集 failFast 检查）、`:321-344`（会话 abort 的所有权遍历）、`:435-480`（reconcile：级联标记与 failFast）、`src/harness/submissions.ts:148-207`（requestId 幂等）、`src/harness/live.ts:44-46`（busy = `run !== undefined`）、`src/harness/define.ts`（`defineTask`/`defineDoc`/`defineTool` 的注册形态）。测试：`test/harness-ownership.test.ts:900-964`（后台 supervisor 重启后只提交一次、root 从不等它）、`test/harness-tasks-recovery.test.ts`（checkpoint 恢复）、`test/harness-lifecycle.test.ts:516`（后台任务与排队写跨关闭）。

### 5.5.3 24-child-tasks.ts —— 父子任务：`failFast`、取消与重启

**它演示什么**：一个 `example.checkout` 任务创建四个 `example.payment` 子任务，等待它们并结算；一个卡被拒时其余支付被中止并各自退款；用户取消时先退款再决定 checkout 的终态；进程在支付中途死掉，新进程继续跑完。三个场景共用同一套任务图，输出里能看到 `owner` 边构成的树。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/24-child-tasks.ts
```

**关键代码 1/2：支付任务**（`test/examples/24-child-tasks.ts:24-55`）：

```typescript
// 一个假银行：立刻拒绝过期卡，其他扣款过一会儿确认。
const charged = new Set<string>();

type PaymentInput = { card: string };
type PaymentResult = { card: string };
const Payment = defineTask<PaymentInput, { phase: "charge"; at: number }, PaymentResult>({
	name: "example.payment",
	version: 1,
	// 初始 checkpoint 就带一个时间点：durable 的 sleep 目标。
	initial: () => ({ phase: "charge", at: Date.now() + 100 }),
	phases: {
		charge: async (task, runtime, taskContext) => {
			const card = task.input.card;
			if (card.startsWith("expired")) {
				const error = { message: `${card} declined` };
				await runtime.commit(() => ({ status: "terminal", outcome: { status: "failed", error } }), taskContext);
				return;
			}
			charged.add(card);
			// 不是 setTimeout：这是持久化的等待，重启后仍从同一个时间点继续。
			await runtime.sleep(task.state.checkpoint.at, taskContext);
			await runtime.commit(
				() => ({ status: "terminal", outcome: { status: "completed", result: { card } } }),
				taskContext,
			);
		},
	},
	// 每个支付在被中止时撤销自己的副作用。
	abort: async (task, runtime, taskContext) => {
		const refunded = charged.delete(task.input.card);
		console.log(`  payment ${task.input.card} aborted${refunded ? ", refunded" : ""}`);
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext);
	},
});
```

**关键代码 2/2：checkout 任务与宿主**（`test/examples/24-child-tasks.ts:57-93`、`test/examples/24-child-tasks.ts:118-138`）：

```typescript
// checkout 创建它的支付子任务并等它们全部结束。
// failFast：第一个失败的支付会中止其他支付；checkout 自己不被中止，等所有支付都结束后再决定自己的终态。
type CheckoutState = { phase: "pay" } | { phase: "decide"; payments: TaskId<PaymentResult>[] };
const Checkout = defineTask<{ cards: string[] }, CheckoutState, string>({
	name: "example.checkout",
	version: 1,
	initial: () => ({ phase: "pay" }),
	phases: {
		pay: async (task, runtime, taskContext) => {
			// 创建子任务与提交等待状态在同一个提交里：不存在「子任务已存在但没人等它们」的窗口。
			await runtime.commit(async (tx) => {
				const payments: TaskId<PaymentResult>[] = [];
				for (const card of task.input.cards) {
					payments.push(await tx.createTask(Payment, { card }, { ownership: { kind: "task", taskId: task.id } }));
				}
				return { status: "waiting", checkpoint: { phase: "decide", payments }, on: payments, policy: "failFast" };
			}, taskContext);
		},
		decide: async (task, runtime, taskContext) => {
			// 醒来时四个子任务都已终态，可以读它们的结果。
			const outcomes = await runtime.outcomes(task.state.checkpoint.payments, taskContext);
			console.log(`  payments: ${outcomes.map((outcome) => outcome.status).join(", ")}`);
			const paid = outcomes.every((outcome) => outcome.status === "completed");
			await runtime.commit(
				() =>
					paid
						? { status: "terminal", outcome: { status: "completed", result: "order placed" } }
						: { status: "terminal", outcome: { status: "failed", error: { message: "payment failed" } } },
				taskContext,
			);
		},
	},
	// 只有在每个支付都结束后才会运行，所以退款已经发生。
	abort: async (_task, runtime, taskContext) => {
		console.log("  checkout aborted");
		await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), taskContext);
	},
});

console.log("One card is declined:");
let id = await checkout(root, ["visa-1", "expired-2", "visa-3", "visa-4"]);
console.log(`  checkout: ${(await harness.waitForTask(id, context)).state.outcome.status}`);

console.log("The customer cancels:");
id = await checkout(root, ["visa-5", "visa-6", "visa-7", "visa-8"]);
harness.resume();
await new Promise((resolve) => setTimeout(resolve, 20));
const graph = await harness.taskGraph(context);
printGraph(graph.value);
graph.dispose();
await harness.abortTask(id, context);
console.log(`  checkout: ${(await harness.waitForTask(id, context)).state.outcome.status}`);

console.log("The process stops while the payments run, and a new one continues:");
id = await checkout(root, ["visa-9", "visa-10", "visa-11", "visa-12"]);
await new Promise((resolve) => setTimeout(resolve, 20));
await harness.close(context);
harness = await open();
root = await harness.root(context);
console.log(`  checkout: ${(await harness.waitForTask(id, context)).state.outcome.status}`);
```

**逐点解释**：

1. `initial: () => ({ phase: "charge", at: Date.now() + 100 })` 把「什么时候可以完成」写进 checkpoint。这就是任务做定时工作的正确方式：`runtime.sleep(until, context)` 是持久等待，不是 `setTimeout`（`src/types.ts:228-229`）；进程重启后仍等到同一个绝对时间点，而不是重新计时。用 `setTimeout` 写会怎样：重启即丢，任务可能永不醒来（没有 checkpoint 变化，调度器不会重新派发它）。
2. `charge` 里「先判断过期卡、再记账、再等待、再提交完成」的顺序是有意的：`charged.add(card)` 是**副作用**，`runtime.commit` 才是**记录**。二者之间就是 13-recovery 讲的崩溃窗口；示例用 `abort` 处理器里的 `charged.delete` 来补偿，而没有用 memo（第 8 条会讲这个简化的代价）。
3. 一个阶段的「创建子任务 + 提交等待」必须**在同一个提交里**。任务状态只有 `waiting` 时才不会被再次派发；如果分成两个提交，进程可能在「子任务已创建、父任务还没进入 waiting」之间崩溃，恢复后 `pay` 阶段重跑并再建四个支付——重复扣款。写在同一个 `runtime.commit` 里，创建与等待原子生效，重跑时 `pay` 不会再被进入（状态已经是 `waiting`）。
4. `policy: "failFast"` 与 `allSettled` 的差别在等待者的行为：`allSettled` 只等，全部终态后继续；`failFast` 额外规定「`on` 里第一个失败（持有可能非 `completed` 的结果）的任务，会让 `on` 里其他还活着的任务获得 abort 标记」，由调度器在下一次 reconcile 提交里落实（`src/harness/scheduler.ts:461-469`）。**等待者自己不会被标记**：它照常等到 `on` 全部终态，然后自己读结果决定终态（spec §5.5；测试 `test/harness-structured.test.ts:370-382` 断言 checkout 的 `abortRequested === false`）。
5. 被级联标记的子任务走各自的 `abort` 处理器——这就是「退款」的落点。abort 处理器**自己提交终态**（`{ status: "aborted" }`），并且可以补偿副作用；这里每个支付只删自己那张卡，符合「abort 是自底向上、每个任务撤销自己的效果」的规则（README「Child Tasks」节）。
6. `runtime.outcomes(payments)` 只能读到终态任务的结果（`src/types.ts:211-212`），所以它只能在 `decide` 里用——在 `pay` 里调用会抛错。`decide` 的判定是 `every(completed)`：因为第一个场景里那个 `failed` 是「支付失败」而不是「checkout 失败」，checkout 自己决定结算成 `failed` 并给出自己的错误文本。
7. `checkout()` 辅助函数在会话上提交 `tx.createTask(Checkout, …, { ownership: { kind: "conversation" } })`——**顶层任务**（属于会话，不是某个任务的子任务）。它就是下面任务图里的根。若把 ownership 写成 `{ kind: "task", taskId: someTask }`，它就会挂在别的任务下面，`printGraph` 的根集合也会变。
8. `harness.resume()` + `setTimeout(20)` 是「让任务图长出来」的观察手法：`Harness.open()` 只加载任务、不做派发（`src/harness/scheduler.ts:230-256`），必须 `resume()` 或某个会要进度的调用（`waitForTask`、`submit`、`abort`）才开始调度；20ms 足够四个 `sleep(100ms)` 的支付进入 `running`。
9. `printGraph()` 直接从 `taskGraph()` 的节点重放树：`state.status === "waiting"` 时打印 `waiting on ${state.on.join(", ")}`，其余用 `node.owner` 分组。`TaskGraphView` 自己维护的是「只含活任务的图」——终态节点在提交时被删除（`src/harness/task-graph.ts:158-173`），所以印出来的树就是「此刻还在跑的东西」。
10. `harness.abortTask(id)` 只标记 checkout；级联在 reconcile 里把四个支付标记掉，它们的 abort 处理器先跑（打印四行退款），随后 checkout 的 abort 处理器才启动（打印 `checkout aborted`）。这个顺序由「abort 处理器只在它拥有的普通工作不再活着时才开始」保证（spec §5.5）。示例里 checkout 的注释正是这个意思：它运行时退款已经发生。
11. 第三个场景：`setTimeout(20)` 之后 `close()`，此时四个支付都在 `sleep` 中途。重开后 `waitForTask(id)` 既触发调度又等待结果，四个支付从各自的 checkpoint 继续 → `completed` ×4、checkout `completed`。**这就是「任务图整体持久化」的直接证据**：没有额外代码，没有重放日志，恢复到的是「谁在等谁」的结构而不是一堆孤立任务。
12. 一个必须点明的简化：`charged` 是**进程内**的 `Set`，重启后它的内容消失，所以「重启后 abort 一个支付」不会真的退掉钱（`refunded` 会是空）。示例的第三场景只关心完成，所以看不出来。真实实现里「已扣款」应该是 durable 状态：要么写进任务 memo（`runtime.memo`，首次写入即胜，`src/types.ts:203-206`），要么写进一张应用文档。[待核]: 示例注释未说明这一点是否有意；从 `charged` 的用法看它只是「假银行」的占位实现。

**你会看到**（实测输出，退出码 0，耗时 0.77s）：

```text
One card is declined:
  payment visa-1 aborted, refunded
  payment visa-3 aborted, refunded
  payment visa-4 aborted, refunded
  payments: aborted, failed, aborted, aborted
  checkout: failed
The customer cancels:
  example.checkout 12: waiting on 13, 14, 15, 16
    example.payment 13: running
    example.payment 14: running
    example.payment 15: running
    example.payment 16: running
  payment visa-5 aborted, refunded
  payment visa-6 aborted, refunded
  payment visa-7 aborted, refunded
  payment visa-8 aborted, refunded
  checkout aborted
  checkout: aborted
The process stops while the payments run, and a new one continues:
  payments: completed, completed, completed, completed
  checkout: completed
```

三个场景各自的证据：第一段里「三行退款 + `aborted, failed, aborted, aborted` + `checkout: failed`」证明 `failFast` 只标记同伴、失败者保留自己的结果、等待者自己决定终态。第二段的树（`example.checkout 12: waiting on 13, 14, 15, 16`）是 `owner` 边直接从存储读出来的；随后的四行退款发生在 `checkout aborted` 之前，证明 abort 是自底向上的。第三段没有任何「恢复」代码，重开同一个 SQLite 文件后 `payments: completed, completed, completed, completed`，说明四个支付从 checkpoint 接着跑完了。

**动手改**：

- 把 `policy: "failFast"` 改成 `"allSettled"`：第一个场景会变成「四个支付全部完成或失败，checkout 读完再结算」——`expired-2` 仍然失败，但 visa-1/3/4 会完成而不是退款，输出里没有三行退款。这是两条等待策略最清楚的对照。
- 把 `runtime.sleep(task.state.checkpoint.at, taskContext)` 换成 `await new Promise((r) => setTimeout(r, 100))`：支付在重启后**仍会完成**（阶段从头重跑），但两个后果值得观察：`initial()` 里算出的 `at` 不再被使用，记录也无法解释「它等了多久」；更重要的是，崩溃发生在 `setTimeout` 期间时阶段会整体重跑，`charged.add(card)` 这类副作用就被重放了一遍——这正是 13-recovery 用 memo（`runtime.memo`，`src/types.ts:203-206`）防重复副作用的原因。把这条实验和 13 对照着看，`sleep` 与 `setTimeout` 的差别才完整。
- 把 `abort` 处理器里的 `charged.delete(...)` 删掉，只提交 `aborted`：第一、二场景的输出里 `, refunded` 消失——说明「退款」完全是 abort 处理器的责任，harness 不会替任何人回滚副作用。

**对应源码/测试**：`src/types.ts:263-283`（`TaskOwnership`/`TaskOptions`）、`:485-520`（`TaskState`：`waiting` 带 `on` 与 `policy`）、`src/harness/scheduler.ts:198-205`（`#failFastChecks`）、`:379-394`（何时安排 failFast 检查）、`:461-469`（标记除失败者以外的成员）、`:996-1030`（等待校验：不能等自己/所有者，`failFast` 只能对自有任务）、`src/harness/task-graph.ts:18-47`（节点与状态投影）、`:131-148`（按 owner 扫描会话）。测试：`test/harness-structured.test.ts:369-437`（failFast 的两种结束方式与「父任务不被标记」）、`:439-460`（`allSettled` 可以等不属于自己的任务）、`:462-497`（非法等待被 faulted）、`test/harness-tasks.test.ts` 与 `test/harness-tasks-recovery.test.ts`（checkpoint 与恢复）、`test/harness-task-graph.test.ts`（任务图的增量与终态移除）。

### 5.5.4 25-compaction.ts —— 压缩的三种触发与 `stale` 判定

**它演示什么**：一个很长的旅行计划对话，被三种不同的路径压缩：后台阈值压缩（对话照常进行）、手动 `compact()`（对话忙时排队）、以及 provider 报「上下文过长」后的溢出压缩。它同时给出了「存储的 entry 数」与「送进模型的消息数」的对照表——这是理解压缩到底改了什么的最直观材料。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/25-compaction.ts
```

**关键代码 1/3：假模型与策略**（`test/examples/25-compaction.ts:19-55`）：

```typescript
// 一个只有 3000 token 窗口的假模型。它回答聊天消息，在被要求总结时写摘要，
// 并且会拒绝一次「太长了」的请求，模仿真实 provider 报告上下文溢出。
let overflowOnce = false;
let summaries = 0;
// 它被设置时，下一次聊天回答会等它，这样会话就一直是忙的。
let hold: Promise<void> | undefined;
async function respond(transcript: TranscriptContext): Promise<AssistantMessage> {
	const first = transcript.messages[0];
	// 摘要请求的判据：第一条是系统消息，且内容里有专门写给摘要器的提示词。
	if (first?.role === "system" && typeof first.content === "string" && first.content.includes("summarization")) {
		summaries++;
		return fauxAssistantMessage(`## Goal\nPlan a week in Lisbon (summary #${summaries}).`);
	}
	if (overflowOnce) {
		overflowOnce = false;
		return fauxAssistantMessage("", { stopReason: "error", errorMessage: "prompt is too long" });
	}
	const held = hold;
	hold = undefined;
	await held;
	const question = transcript.messages.findLast((message) => message.role === "user");
	return fauxAssistantMessage(`A detailed answer to "${text(question)}": ${"details ".repeat(200)}`);
}
// 3000 的窗口、1000 的输出上限：阻塞阈值 = 3000 - 1000 = 2000。
const faux = fauxProvider({ models: [{ id: "tiny", contextWindow: 3000, maxTokens: 1000 }] });
faux.setResponses(Array.from({ length: 100 }, () => respond));
const models = createModels();
models.setProvider(faux.provider);

// 超过 3000 - 1000 = 2000 token 时 generation 会阻塞等待压缩；超过 2000 - 800 时它会启动后台压缩。
// settings 每次使用时都会读，所以 getter 让 backgroundTokens 是活的。
let backgroundTokens = 800;
const settings = {
	get compaction() {
		return { reserveTokens: 1000, keepRecentTokens: 400, backgroundTokens };
	},
};
const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry(), settings }, context);
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "tiny" } } });
```

**关键代码 2/3：三种触发的调用方式**（`test/examples/25-compaction.ts:57-100`）：

```typescript
async function ask(question: string): Promise<void> {
	const submission = await root.submit({ type: "input", content: question }, context);
	const record = await submission.wait(context);
	// 让这一轮启动的后台压缩跑完，它的摘要在下面才看得到。
	const running = (await harness.snapshot(LiveDoc, root.id, context))?.compactions ?? [];
	for (const { taskId } of running) await harness.waitForTask(taskId, context);
	await show(root, `after "${question}" (${record.status === "done" ? "answered" : record.reason})`);
}

// 1. 长对话：上下文越过后台阈值后，聊天继续的同时完成一次压缩；
// 对话空闲时摘要立刻落位，否则在下一个回合边界落位。
for (const question of [
	"Where should we stay?",
	"What should we eat?",
	"Which day trips?",
	"Any museums?",
	"Nightlife?",
]) {
	await ask(question);
}

// 2. 回答还在写的时候做手动压缩。摘要先做好，在 inbox 里等待，然后紧跟在回答之后落位。
let finishAnswer!: () => void;
hold = new Promise((resolve) => {
	finishAnswer = resolve;
});
const busy = await root.submit({ type: "input", content: "How do we get around?" }, context);
const manual = await root.compact("Keep the hotel shortlist", context);
const { state } = await harness.waitForTask(manual, context);
const placement = state.outcome.status === "completed" ? state.outcome.result.submissionId : undefined;
const summary = (await harness.submission(placement!, context))!;
console.log("\nmanual compaction finished; its summary is", (await summary.status(context)).status);
finishAnswer();
await busy.wait(context);
console.log("after the answer, the summary is", (await summary.wait(context)).status);
await show(root, "after compact()");

// 3. provider 把一次请求判为太长：generation 压缩并重试一次。后台压缩被关掉，这样下面的摘要就是溢出那次。
backgroundTokens = 0;
await ask("What should we pack?");
overflowOnce = true;
await ask("Summarize the plan for my partner");
```

**关键代码 3/3：上下文与存储的对照**（`test/examples/25-compaction.ts:104-116`）：

```typescript
/** 打印模型上下文：一条消息一行，以及它背后存了多少条 entry。 */
async function show(conversation: Conversation, label: string): Promise<void> {
	const view = await conversation.context(context);
	const stored = (await conversation.entries({}, 1000, undefined, context)).items.length;
	console.log(`\n${label}: ${view.messages.length} messages in context, ${stored} entries stored`);
	// 如果当前 head 是压缩摘要，打印它为什么被压缩。
	const reason = CompactionEntry.is(view.head) ? view.head.data.reason : undefined;
	if (reason !== undefined) console.log(`  (${reason} compaction summary first)`);
	for (const message of view.messages) {
		console.log(
			`  ${message.role.padEnd(9)} ${message.role === "system" ? "(system prompt)" : text(message).slice(0, 70)}`,
		);
	}
}
```

**逐点解释**：

1. 假模型用「第一条是系统消息且包含 `summarization`」判断自己正在被要求总结。这对应实现事实：摘要请求只有两条消息，第一条是内置的 `SUMMARIZATION_SYSTEM_PROMPT`（`src/harness/compaction.ts:61-63`、`:157-164`），第二条是 `<conversation>…</conversation>` 包起来的序列化转录加总结指令。**这意味着「摘要请求和普通请求必须能被 provider 侧区分」**；靠别的特征（例如消息条数）判断会很脆。
2. 窗口参数决定两个阈值：`blocking = contextWindow - reserveTokens = 3000 - 1000 = 2000`；`background = blocking - backgroundTokens = 2000 - 800 = 1200`；两者都只在「选得出切点」时才生效（`src/harness/generation.ts:307-324`）。示例注释给的是「超过 2000 阻塞、超过 1200 后台」这两个数。
3. `settings.compaction` 用 getter：`HarnessSettings` 每次使用时读取、从不复制（`src/harness/types.ts:391`），所以示例能在第 3 阶段把 `backgroundTokens` 改成 0 立刻关掉后台压缩。**若把 settings 当快照缓存**，这个开关就得重启进程。
4. 触发一（**后台阈值**）：`prepare` 阶段的提交里，`threshold === "background"` 时创建一个会话拥有、`background: true` 的压缩任务（`src/harness/generation.ts:171-173`、`src/harness/compaction.ts:240-243`），generation **不等它**，请求照发。它的摘要通过 write submission（`compaction:${taskId}`）落位：空闲时立刻，否则排到下一个边界（`src/harness/compaction.ts:424-433`）。`ask()` 里 `waitForTask` 每个正在跑的压缩任务，就是为了让摘要在这轮打印之前落位。
5. 触发二（**手动**）：`root.compact("Keep the hotel shortlist")` 无条件可用（策略里的 `enabled` 只约束自动压缩）。它返回 `TaskId<CompactionResult>`；任务完成后结果里是 `submissionId`（不是 `entryId`），宿主再 `harness.submission(...)` 观察落位——示例正是这么打印 `queued → done` 的（`src/harness/types.ts:502-506`、`src/harness/compaction.ts:423-435`）。
6. 触发三（**阻塞阈值**）：`tokens > blocking` 时 `prepare` 不追加 system entry，而是提交一个**由 generation 拥有**的压缩任务并 `waiting`，checkpoint 记 `compacted`（`src/harness/generation.ts:157-165`）。它是阻塞式：摘要由任务直接 append（`entryId` 结果），generation 醒来后再发请求——所以那一次请求的上下文里已经有摘要。
7. 触发四（**溢出**）：`classify()` 看到 `isContextOverflow(message)`、策略开启、`compacted === undefined` 且能切出范围时，先追加错误助手 entry，再创建 reason 为 `overflow` 的压缩任务并 `waiting`（`src/harness/generation.ts:459-475`）。压缩成功后回到 `prepare`，`overflow` 文本留在 checkpoint 里；若压缩没能给出 `entryId`，run 直接以 `model_error` 结束（`src/harness/generation.ts:134-139`）。**溢出永远不会走重试路径**：源码注释写得很直白——「An overflow is never retried: only a compaction can make the next request fit」（`src/harness/generation.ts:477`）。
8. 三种触发**互斥**的关键是 checkpoint 里的 `compacted`：一旦某次 generation 起过压缩，阈值检查（`compacted === undefined ? thresholdCompaction(...) : undefined`，`src/harness/generation.ts:153-156`）与溢出分支（`:460`）都不再触发。这正是本机第 3 阶段的实际走向：`prepare` 已因阻塞阈值创建过一次压缩（`compacted` 置位），随后模型返回 `prompt is too long`，溢出分支跳过 → 本次 submission 以 `model_error` 收尾，示例注释所说的「压缩后重试成功」在本轮没有出现。仓库里有一条同名测试把这条行为钉死：`test/harness-compaction.test.ts:1203-1213`（「fails after a blocking threshold compaction in the same generation」），而成功路径的对照在 `test/harness-compaction.test.ts:1146-1173`。
9. `stale` 是并发压缩的正确性阀门。摘要 entry 是 **head write**（`head: firstKept`），放置时必须满足「它的 head 不早于当前活动范围的起点」，否则会把已经被切掉的历史重新接回来（`src/harness/inbox.ts:58-111` 的 `isStale()`）。效果是：多个压缩同时在飞时，**切得最远的那份生效**，落后者以 `unanswered`/`stale` 收场（spec §6，README「Compaction」节）。相关测试：`test/harness-compaction.test.ts:1119-1140`（阻塞压缩赢过后台压缩，后者 `stale`）、`:505-524`（总结期间落下的 reset 让摘要 stale）、`:556-579`（stale 的摘要算 usage、但不写 entry）。
10. 「entry 数一路涨、上下文一直 4–7 条」的原因是压缩**只加一条 head marker，不删任何东西**：摘要 entry 的 `head` 指向保留的第一条 entry，`pi.compaction` 自己也是普通 entry，所以 `entries()` 数得出来（`src/harness/compaction.ts:407-436`）。这解释了为什么压缩「不破坏历史」，也解释了 `pi.usage` 能一直算下去。
11. `show()` 的 `view.head` 就是最新 head marker；`CompactionEntry.is(view.head)` 为真时打印它的 `data.reason`。所以看到 `(threshold compaction summary first)` 与 `(manual compaction summary first)` 就等于知道了「当前上下文是哪一类压缩切出来的」。
12. 手动压缩在忙时**不插队**：摘要先算好，然后作为 write submission 排在 inbox 里，等当前回答结束的 `final` 边界落位（示例打印的 `queued` → `done` 就是这个过程）。注意写入在边界里排在 user 项之前（`src/harness/inbox.ts:84-102`），所以摘要落在「Next 一条用户消息」之前、而不是之后——输出里 `after compact()` 那段能直接看到这个顺序。
13. `await ask("What should we pack?")` 之后 `backgroundTokens = 0`：此后不再有后台压缩，因此第 3 阶段唯一可能出现的压缩就是溢出的那次——示例的意图是让读者对照 reason。但因为第 8 条的原因，本轮实际看到的是 `threshold`。
14. 摘要请求本身花掉的钱算在 `pi.usage` 里（`src/harness/compaction.ts:186-192`），即使摘要最后 `stale`（测试 `:556`）。成本视角下这点重要：压缩不是免费的，`maxTokens` 被限制在 `min(floor(0.8 * reserveTokens), model.maxTokens)`（`src/harness/compaction.ts:139-142`）。

**你会看到**（实测输出，退出码 0，耗时 0.60s；量较大，原样引用）：

```text

after "Where should we stay?" (answered): 2 messages in context, 2 entries stored
  user      Where should we stay?
  assistant A detailed answer to "Where should we stay?": details details details 

after "What should we eat?" (answered): 4 messages in context, 4 entries stored
  user      Where should we stay?
  assistant A detailed answer to "Where should we stay?": details details details 
  user      What should we eat?
  assistant A detailed answer to "What should we eat?": details details details de

after "Which day trips?" (answered): 4 messages in context, 7 entries stored
  (threshold compaction summary first)
  user      The conversation history before this point was compacted into the foll
  assistant A detailed answer to "What should we eat?": details details details de
  user      Which day trips?
  assistant A detailed answer to "Which day trips?": details details details detai

after "Any museums?" (answered): 7 messages in context, 10 entries stored
  (threshold compaction summary first)
  user      The conversation history before this point was compacted into the foll
  assistant A detailed answer to "What should we eat?": details details details de
  user      Which day trips?
  assistant A detailed answer to "Which day trips?": details details details detai
  user      Any museums?
  system    (system prompt)
  assistant A detailed answer to "Any museums?": details details details details d

after "Nightlife?" (answered): 5 messages in context, 14 entries stored
  (threshold compaction summary first)
  user      The conversation history before this point was compacted into the foll
  assistant A detailed answer to "Any museums?": details details details details d
  user      Nightlife?
  system    (system prompt)
  assistant A detailed answer to "Nightlife?": details details details details det

manual compaction finished; its summary is queued
after the answer, the summary is done

after compact(): 4 messages in context, 17 entries stored
  (manual compaction summary first)
  user      The conversation history before this point was compacted into the foll
  assistant A detailed answer to "Nightlife?": details details details details det
  user      How do we get around?
  assistant A detailed answer to "How do we get around?": details details details 

after "What should we pack?" (answered): 7 messages in context, 20 entries stored
  (manual compaction summary first)
  user      The conversation history before this point was compacted into the foll
  assistant A detailed answer to "Nightlife?": details details details details det
  user      How do we get around?
  assistant A detailed answer to "How do we get around?": details details details 
  user      What should we pack?
  system    (system prompt)
  assistant A detailed answer to "What should we pack?": details details details d

after "Summarize the plan for my partner" (model_error): 4 messages in context, 24 entries stored
  (threshold compaction summary first)
  user      The conversation history before this point was compacted into the foll
  assistant A detailed answer to "What should we pack?": details details details d
  user      Summarize the plan for my partner
  system    (system prompt)
```

几处值得逐条读出来的信息：

- 第三段（`Which day trips?`）是后台阈值压缩第一次落位：`entries stored` 从 4 跳到 7，而上下文仍只有 4 条，head 变成 `threshold` 摘要。它证明后台压缩既不阻塞 run，也不删除历史。
- 第四、五段里 `system` 行会周期性出现：`pi.system` 是位置化的提示词 entry，`planSystemEntries()` 在 head 之后补一条完整基线（`src/harness/prompt.ts:72-83`）。所以「上下文里有 system 行」不代表提示词变了。
- 手动那段先打印 `queued`、回答结束后打印 `done`，然后 `after compact()` 的 head 是 `manual` 摘要——`compact()` 的摘要**不插队**，这是忙碌会话里唯一的落位方式。
- 最后一段是**本轮的偏差**：标签是 `model_error` 而不是 `answered`，head 是 `threshold` 摘要。原因见第 8 条——阻塞阈值压缩抢先，`compacted` 已置位，于是溢出路径不再触发，submission 以 `model_error` 收尾。这不是退出码层面的失败（退出码 0），但和示例注释的预期不同，读输出时不要把它当成「压缩后重试成功」。

**动手改**：

- 想看到「溢出 → 压缩 → 重试成功」那条路径，必须先把**阻塞阈值**抬到这一步的上下文之上（否则 `prepare` 又会抢先起一个 blocking 压缩、`compacted` 置位、溢出分支照样被跳过）。做法：把第 3 阶段的策略改成 `reserveTokens: 500`（阻塞阈值 `3000 - 500 = 2500`），先跑 `What should we pack?` 并读 `show()` 打印的条数与内容估算，确认下一步的上下文低于 2500；若仍看到 `(threshold compaction summary first)`，就把 `reserveTokens` 继续调小（阈值继续升高）。届时最后一步应给出 `(overflow compaction summary first)` 与一句回答，示例注释描写的路径就出现了。
- 把 `keepRecentTokens: 400` 改成 `100000`：`selectCut()` 找不到切点，三种触发都不会发生（`src/harness/compaction.ts:255-273` 返回 `undefined`），溢出会变成不可重试的 `model_error`。这解释了 spec 里那句提醒——窗口小于 `keepRecentTokens` 时，溢出可能先于任何阈值压缩到来（spec §8.7）。
- 把第 2 阶段整段改简单：删掉 `hold` 那几行（也就是让回答不卡住），改成先 `await busy.wait(context)` 再 `root.compact(...)`：摘要会立刻落位（`summary.status()` 直接是 `done`），而不是先 `queued`。同一段代码在忙/闲两种情况下落位路径不同，这是 `placeSummary()` 分派的直接体现（`src/harness/compaction.ts:407-436`）。

**对应源码/测试**：`src/harness/generation.ts:302-324`（阈值判定）、`:153-183`（阻塞与后台分派）、`:417-505`（溢出与重试分类）、`src/harness/compaction.ts:98-247`（`pi.compaction` 三个阶段与创建）、`:249-300`（切点选择）、`:401-436`（落位：blocking 直接 append、否则 write submission）。测试：`test/harness-compaction.test.ts:1010-1047`（阻塞压缩先于请求）、`:1119-1140`（阻塞赢过后台、后者 `stale`）、`:1146-1173`（溢出压缩后同 attempt 重试）、`:1203-1213`（先有阻塞阈值压缩时，溢出不再压缩而是失败）、`:505-524`/`:556-579`（stale 的两种来源与 usage）、`:1725-1747`（reset 与摘要的排队顺序）。

### 5.5.5 26-coding-agent.ts —— coding agent：跟会话目录走的环境 + 活设置

**它演示什么**：把「应用自己的提示词 + 内建 coding 工具 + 跟随会话 cwd 的环境 + 运行时可改的设置」拼成一个最小 coding agent，并验证两件事无需重启即可生效：改会话的 cwd、改用户的 `settings.json`。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/26-coding-agent.ts
```

**关键代码**（`test/examples/26-coding-agent.ts:28-63`、`test/examples/26-coding-agent.ts:65-78`）：

```typescript
// 应用自己的提示词，紧挨着 coding 工具。
const Coding = defineExtension({
	name: "coding",
	sections: [
		section("preamble", () => "You are a coding agent. Use the tools to inspect the project.", { tag: false }),
		// 渲染时读这次请求构建的环境的 cwd。
		section("cwd", (input) => input.env?.cwd),
	],
});
const registry = createRegistry();
registry.install(CodingTools);
registry.install(Coding);

// 用户在 agent 运行期间编辑的设置，就像一个被监听的 settings.json。
// getter 让 Harness 的每次读取都看到当前文件名下的值；什么都不复制、不存储。
const userSettings = { parallelTools: true, maxRetries: 3 };
const settings: HarnessSettings = {
	get toolExecution() {
		return userSettings.parallelTools ? "parallel" : "sequential";
	},
	get retry() {
		return { maxRetries: userSettings.maxRetries };
	},
};

// Harness 对每次工具调用和每次请求都调用它，并带上会话的 cwd，所以改会话目录不需要重启。
const env = ({ cwd = workspace }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd });

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
const pwd = () => fauxAssistantMessage(fauxToolCall("bash", { command: "pwd" }), { stopReason: "toolUse" });
faux.setResponses([pwd(), fauxAssistantMessage("Done."), pwd(), fauxAssistantMessage("Done.")]);

const harness = await Harness.open(new MemoryStorage(), { models, registry, settings, env }, context);
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" }, cwd: workspace } });

const lastBashOutput = async () => {
	const page = await root.entries({}, 10, undefined, context);
	// entries() 最新优先，find 拿到的就是最近一条工具结果。
	const result = page.items.find((entry) => ToolResultEntry.is(entry))?.model?.[0] as ToolResultMessage;
	return result.content.map((part) => (part.type === "text" ? part.text.trim() : "")).join("");
};

await (await root.submit({ type: "input", content: "Where are we?" }, context)).wait(context);
console.log("bash ran in:", await lastBashOutput());

// 用户切换项目目录并关掉并行工具。两者从下一次使用开始生效。
await root.configure({ cwd: join(workspace, "app") }, context);
userSettings.parallelTools = false;
await (await root.submit({ type: "input", content: "And now?" }, context)).wait(context);
console.log("bash ran in:", await lastBashOutput());
```

**逐点解释**：

1. `settings` 用 getter 而不是快照：`HarnessSettings` 的契约是「每次解析都读、从不复制」（`src/harness/types.ts:391`），所以 `userSettings.parallelTools = false` 会在下一次工具轮被看到（`src/harness/generation.ts:556-561` 在读 `toolExecution`）。
2. `retry` 同理：重试策略在**分类响应时**读，而不是在准备请求时固定（`src/harness/generation.ts:457-458` 的注释）。示例改的是 `maxRetries`，效果与「中途改重试次数」一致。
3. `env` 是普通函数：Harness 在每次工具调用、每次提示词渲染时调用它，参数里带会话的 `cwd` 与已提交读取（`src/harness/types.ts:415-429`）。`section("cwd", (input) => input.env?.cwd)` 与它配合，让提示词里的目录也随会话走。
4. 没有环境时内建工具会「干净地失败」：`createBashTool` 里的 `requireEnv(api)` 抛错（`src/tools/env.ts:4-8`），`pi.tool` 把它变成一条 `isError` 的工具结果而不是让进程崩溃（`src/harness/tool.ts:247-257`）。这条规则在 29 里被用来做安全默认。
5. `lastBashOutput()` 依赖 `entries()` 的**最新优先**顺序：`find` 取到的是最近一条 `pi.tool-result`，所以两次调用不会互相污染。
6. `root.configure({ cwd })` 写的是会话的 `pi.agent.cwd`（`AgentState.cwd`，`src/harness/types.ts:306-307`）；它不影响已经发出的工具调用，只影响之后的解析——这正是「改目录不需要重启」的实现方式。
7. `mkdir(join(workspace, "app"))` 与 `writeFile` 是有意的准备：没有目标目录，第二轮的 env 会指向一个不存在的路径，bash 的错误就更难解读。
8. 两次 `bash` 都通过 `NodeExecutionEnv` 执行；本机没有 Git Bash，所以两次都返回同一条「找不到 shell」的错误结果。

**你会看到**（实测输出，退出码 0，耗时 0.65s）：

```text
bash ran in: <harness>
[error] No bash shell found. Options:
  1. Install Git for Windows: https://git-scm.com/download/win
  2. Add your bash to PATH (Cygwin, MSYS2, etc.)
  3. Configure an explicit shellPath

Searched Git Bash in:
  C:\Program Files\Git\bin\bash.exe
  C:\Program Files (x86)\Git\bin\bash.exe
</harness>
bash ran in: <harness>
[error] No bash shell found. Options:
  1. Install Git for Windows: https://git-scm.com/download/win
  2. Add your bash to PATH (Cygwin, MSYS2, etc.)
  3. Configure an explicit shellPath

Searched Git Bash in:
  C:\Program Files\Git\bin\bash.exe
  C:\Program Files (x86)\Git\bin\bash.exe
</harness>
```

两次打印完全相同，说明**本机无法验证 cwd 切换**：`pwd` 从未真正执行。要验证这一点，需要一台装有 Git Bash 的 Windows 或 Linux/macOS 机器；届时第一行应是临时 workspace 的路径（例如 `/tmp/pi-durable-agent-XXXXXX`），第二行是它的 `app` 子目录。[待核]: Windows + Git Bash 下 `pwd` 的具体字符串形式（Git Bash 会打印 `/c/Users/...` 还是别的映射）未实测；断言时应比较「第二轮路径以第一轮路径 + `/app` 结尾」，而不是比较固定字符串。

值得注意的是**失败行为本身是对的**：工具失败被包装成工具结果（`<harness>…</harness>`），示例仍以退出码 0 结束，说明「环境/工具出错不等于进程出错」这条设计在示例中得到了验证（这与 17、19、30 的 bash 偏差是同一现象）。

**动手改**：

- 把 `settings` 换成普通对象（`{ toolExecution: "parallel", retry: { maxRetries: 3 } }`）：`userSettings.parallelTools = false` 之后不再生效（值在 open 时就被读走了）。要观察到差异，得让一轮发出**多个**工具调用（让脚本一条 assistant 消息里带两个 `fauxToolCall`）：`parallel` 时两个 `pi.tool` 任务同时被创建，`sequential` 时第二个调用要等第一个结束（`src/harness/generation.ts:575-583` 的 `pending`）。注意示例原脚本每轮只有一个调用，两种模式看不出区别。
- 在第二次 `submit` 之前插入 `await root.configure({ cwd: null }, context)`：cwd 被清空，`env` 用它的默认值 `workspace`，`section("cwd")` 渲染成 workspace 路径。这说明 `null` 是「清除」而不是「保留」（`src/harness/agent.ts:84-90`）。
- 把 `env` 改成返回 `undefined`（`env: () => undefined`）：两次 `bash` 的失败原因会变成 `No execution environment is configured`（来自 `requireEnv`），而不是 shell 找不到。这能区分「没有环境」与「环境里没有 shell」两种失败。

**对应源码/测试**：`src/harness/types.ts:391-413`（`HarnessSettings`/`Settings`）、`:415-439`（`EnvTarget` 与 `HarnessOptions.env`）、`src/tools/env.ts`（`requireEnv`）、`src/tools/bash.ts:47-89`、`src/harness/generation.ts:556-561`（`toolExecution` 决定并行/串行）。测试见 `test/harness-generation.test.ts:480-500`（设置解析）、`test/env-node.test.ts`（环境行为）、`test/tools.test.ts`。

### 5.5.6 27-plan-mode.ts —— 计划模式：一次 `configure()` 收缩工具集

**它演示什么**：把「只读规划」做成一个扩展：进入计划模式时只提供 `read` 与 `submit_plan`，模型把计划写进扩展自己的文档，然后退出计划模式、恢复完整工具集。它同时演示了 `configure()` 的三种形态（数组、`null` 清除）如何反映到系统提示词的 entry 里。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/27-plan-mode.ts
```

**关键代码**（`test/examples/27-plan-mode.ts:29-62`、`test/examples/27-plan-mode.ts:83-112`）：

```typescript
// 会话当前的计划。fork 保留它在分叉点的值。
const PlanDoc = defineDoc<{ steps: string[] }>({
	kind: "app.plan",
	version: 1,
	scope: "conversation",
	history: "rewindable",
	fork: "asOf",
	initial: () => ({ steps: [] }),
});

const submitPlan = defineTool({
	name: "submit_plan",
	description: "Submit the plan as a list of steps.",
	parameters: Type.Object({ steps: Type.Array(Type.String()) }),
	execute: async (args, api, callContext) => {
		// 计划写进扩展自己的文档，而不是对话文本。
		await api.commit(async (tx) => {
			(await tx.doc(PlanDoc, api.conversationId)).steps = args.steps;
		}, callContext);
		// control.terminate：这一轮之后结束 run，不再多要一次模型请求。
		return { content: [{ type: "text", text: "Plan submitted." }], control: { terminate: true } };
	},
});

const Plan = defineExtension({
	name: "plan",
	tools: [submitPlan],
	sections: [
		section("plan_mode", () => "You are in plan mode. Read the code, then call submit_plan. Change nothing."),
	],
});

// 计划模式是对会话 agent 的一次改动：选中 plan 扩展，并且只提供读与提交计划。
// 两项都清空就回到宿主的默认选择与全部工具。
const read = createReadTool();
const enterPlanMode = { extensions: { add: [Plan] }, tools: [read, submitPlan] };
const leavePlanMode = { extensions: null, tools: null };

const registry = createRegistry();
registry.install(CodingTools);
registry.install(Plan);
const harness = await Harness.open(
	new MemoryStorage(),
	// 装上了，但默认只选 CodingTools：会话自行选择进入 plan 模式。
	{ models, registry, settings: { extensions: [CodingTools] }, env: () => new NodeExecutionEnv({ cwd: directory }) },
	context,
);
const root = await harness.root(context, { agent: { model: { provider: "faux", modelId: "faux-1" } } });
const tools = async () => (await root.agent(context)).tools.map((tool) => tool.name);
console.log("tools:", await tools());

await root.configure(enterPlanMode, context);
console.log("plan mode tools:", await tools());
await (await root.submit({ type: "input", content: "Make the port configurable." }, context)).wait(context);
console.log("plan:", (await harness.snapshot(PlanDoc, root.id, context))?.steps);

await root.configure(leavePlanMode, context);
console.log("tools again:", await tools());
await (await root.submit({ type: "input", content: "Go ahead." }, context)).wait(context);

// 模型把每次切换都看成转录里的一次系统提示词变化。
const { messages } = await root.context(context);
for (const message of messages) {
	if (message.role !== "system") continue;
	console.log("system:", {
		// section 的值为 null 表示删除它。
		sections: message.sections,
		added: message.toolsAdded?.map((tool) => tool.name),
		removed: message.toolsRemoved?.map((tool) => tool.name),
	});
}
```

**逐点解释**：

1. `PlanDoc` 用 `history: "rewindable"` + `fork: "asOf"`：计划需要回看（例如「上一版计划是什么」），fork 时也从分叉点取值。这与 23 的 `Subagents`（`latest` + `initial`）形成对照——文档语义要按「这张表会被怎么用」来选，而不是随手抄一个。
2. 工具里用 `api.commit` 写文档：一次提交里既改文档又（隐式地）完成工具结果的后半段。工具的副作用必须走这条路径，否则崩溃后「工具说成功了但什么都没写」。
3. `control: { terminate: true }` 让工具轮结束后直接结束 run（`src/harness/generation.ts:611-631`）：示例里 `submit_plan` 之后**没有**第三次模型请求，父会话不会继续说废话。注意 terminate 要求**这一轮所有调用**都请求终止（`slots.every(...)`，`:612-614`），所以它适合「这一轮的唯一目的就是提交计划」这种场景。
4. `enterPlanMode = { extensions: { add: [Plan] }, tools: [read, submitPlan] }`：扩展是**在默认选择上增加**（`settings.extensions` 是 `[CodingTools]`，所以结果是 `CodingTools + Plan`）；工具是**恰好这些**（数组形态，`src/harness/agent.ts:185-190`）。
5. 传给 `tools` 的对象只用来取名字：`applyChange()` 里 `set("tools", … isList(tools) ? names(tools) : …)`（`src/harness/agent.ts:104-108`），存进 `pi.agent` 的是 `["read","submit_plan"]`。真正提供工具的是**选中扩展的组合**（`composed`，`:155-156`）；解析时按名字在组合里查（`:187-190`），所以示例里新建的 `createReadTool()` 实例并不会替换 CodingTools 的 read，只是借用了 `read` 这个名字。
6. `leavePlanMode = { extensions: null, tools: null }`：`null` 表示清除字段（`src/harness/agent.ts:87-88`），于是扩展选择回到宿主默认（`settings.extensions = [CodingTools]`，`:221`），工具过滤消失、恢复全部工具。若写成空数组 `[]`，语义完全不同：扩展一个都不选、工具一个都不给。
7. 第一条 `system:` entry 是**这段对话的第一条系统提示词**（示例在第一次 `submit` 之前就进了 plan 模式，见 `test/examples/27-plan-mode.ts:91-95`）。没有 head marker、转录里也没有别的 `pi.system`，所以 `planSystemEntries()` 走「完整基线」分支：sections 全部写出，工具则因为「此前一个都没提供过」而全部计入 `toolsAdded`（`src/harness/prompt.ts:72-83`）。这就是输出里第一条 `added: [ 'read', 'submit_plan' ]`、`removed: undefined` 的原因——**不是**「宿主默认工具被重写了一遍」。
8. 第二条 `system:` entry 才是真正的**差量**：上一次请求提供的是 `[read, submit_plan]`，这次期望 `[read, write, edit, bash]`，于是 `kept = [read]`、`added = [write, edit, bash]`、`removed = [submit_plan]`（`planTools()` 的顺序判断与差量计算，`src/harness/prompt.ts:100-119`）；section 侧 `plan_mode: null` 是删除标记（`planSections()`，`:135-141`，重放时 `replaySections()` 会 `delete`，`:9-19`）。`removed` 里是「工具引用」而不是完整声明，所以只打印名字。
9. `settings: { extensions: [CodingTools] }` 让 Plan **安装但不默认选中**。这就是「宿主装好能力、会话按需选择」的实现方式；7-configuration 里的同一手法在工具层面展示过。
10. 三次模型请求共用一份脚本：`read` → `submit_plan` → 文本。第三次回答（`Implementing step 1.`）来自退出计划模式后的那次 `submit`——它证明恢复工具后 run 还能继续。

**你会看到**（实测输出，退出码 0，耗时 0.66s）：

```text
tools: [ 'read', 'write', 'edit', 'bash' ]
plan mode tools: [ 'read', 'submit_plan' ]
plan: [ 'Read PORT from the environment', 'Default to 3000' ]
tools again: [ 'read', 'write', 'edit', 'bash' ]
system: {
  sections: {
    plan_mode: '<plan_mode>\n' +
      'You are in plan mode. Read the code, then call submit_plan. Change nothing.\n' +
      '</plan_mode>'
  },
  added: [ 'read', 'submit_plan' ],
  removed: undefined
}
system: {
  sections: { plan_mode: null },
  added: [ 'write', 'edit', 'bash' ],
  removed: [ 'submit_plan' ]
}
```

读法：工具集随 `configure()` 精确变化（默认四个 → `read` + `submit_plan` → 恢复四个）；计划落在**文档**里（`plan: [...]`）而不是对话文本里；两条 `pi.system` entry 分别是「plan 模式下的第一条提示词（完整基线）」与「退出 plan 模式的差量（删除段 + 工具增减）」。把这两条 entry 分开读很关键：`added`/`removed` 是相对于**上一次请求**而言的，不是相对于宿主默认值。

**动手改**：

- 把 `leavePlanMode` 改成 `{ extensions: null, tools: [] }`：退出后工具集变成空数组，`tools again: []`，模型连 `read` 都没有。这能把「`null` = 清除字段」与「空数组 = 明确的空集合」区分开。
- 把 `enterPlanMode.tools` 改成 `{ remove: [write, edit, bash] }`（对象形态）：效果看起来一样（只留 read + submit_plan），但存进 `pi.agent` 的是 `{"remove":[...]}` 而不是名字数组。之后给 CodingTools 热重载一个新工具，前者不会出现、后者会出现——这是两种形态最重要的差别。
- 把 `submit_plan` 的 `control: { terminate: true }` 删掉：工具轮结束后 generation 会再发一次请求，于是计划提交之后模型还会说一句（脚本里第三次回答会被提前用掉）。这条实验直接展示 `terminate` 的作用范围是「本轮 run」。

**对应源码/测试**：`src/harness/agent.ts:60-119`（`configure` 与 `applyChange` 的 null/数组/对象语义）、`:143-232`（`resolveAgent`：组合、包装、工具过滤、instructions）、`src/harness/types.ts:296-334`（`AgentState`/`AgentChange`/`Agent`）、`src/harness/prompt.ts:100-119`（工具变化计算）、`src/harness/generation.ts:595-646`（工具轮控制：terminate/handoff/addTools）。测试见 `test/harness-registry.test.ts`（扩展选择与解析）、`test/harness-prompt.test.ts`（工具与 section 的变化计划）、`test/harness-conversations.test.ts`。

### 5.5.7 28-reviewer.ts —— 另一个 agent：便宜模型 + 只读工具 + 复查循环

**它演示什么**：主 agent 旁边再放一个 reviewer 会话。它的模型更便宜、只给 `read` 工具、只选两个扩展、在自己的 worktree 里工作，并且用 `onYield` 钩子把「复查」做成一个循环（没看到 `No further findings.` 就再问一遍）。所有配置都写在会话上，重启后原样恢复。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/28-reviewer.ts
```

**关键代码**（`test/examples/28-reviewer.ts:29-59`、`test/examples/28-reviewer.ts:75-107`）：

```typescript
const DONE = "No further findings.";
// 一个角色 + 一次复查循环：每个还带发现的回答都会被再问一遍。
const Reviewer = defineExtension({
	name: "reviewer",
	sections: [section("role", () => `You review diffs. Report problems as a list. Never edit files.`)],
	hooks: [
		hook(GenerationTask, {
			// onYield 只在「最终回答」上被调用；返回 continue 就是「再追加一条用户消息，继续同一个 run」。
			onYield: (answer) =>
				textOf(answer).includes(DONE)
					? undefined
					: { continue: `Look again for anything you missed. Say "${DONE}" when there is nothing left.` },
		}),
	],
});

// reviewer 在自己的 checkout 里工作，实践中就是 `git worktree add`。
const worktree = await mkdtemp(join(tmpdir(), "pi-durable-review-"));
await writeFile(join(worktree, "user.ts"), "export const name = (user) => user.name;\n");

const faux = fauxProvider({ models: [{ id: "big" }, { id: "small" }] });
const models = createModels();
models.setProvider(faux.provider);
faux.setResponses([
	fauxAssistantMessage(fauxToolCall("read", { path: "user.ts" }), { stopReason: "toolUse" }),
	fauxAssistantMessage("1. `name` does not handle a missing user."),
	fauxAssistantMessage(`2. \`user\` has no type. ${DONE}`),
]);

const registry = createRegistry();
registry.install(CodingTools);
registry.install(Reviewer);
const harness = await Harness.open(
	new MemoryStorage(),
	// 主 agent 只选 CodingTools；reviewer 自己 opt in。
	{
		models,
		registry,
		settings: { extensions: [CodingTools] },
		env: ({ cwd = process.cwd() }) => new NodeExecutionEnv({ cwd }),
	},
	context,
);
await harness.root(context, { agent: { model: { provider: "faux", modelId: "big" } } });

// reviewer 的一切都存在它的会话上：模型、恰好这些扩展且按这个顺序、只有 read 工具、以及它的目录。
// 重启后这些全都保留。
const reviewer = await harness.createConversation(
	{
		ownership: { kind: "ownerless" },
		agent: {
			model: { provider: "faux", modelId: "small" },
			extensions: [CodingTools, Reviewer],
			tools: [createReadTool()],
			cwd: worktree,
		},
	},
	context,
);
const agent = await reviewer.agent(context);
console.log(
	"reviewer:",
	agent.model?.modelId,
	agent.extensions.map((extension) => extension.name),
	agent.tools.map((tool) => tool.name),
	agent.cwd === worktree,
);
```

**逐点解释**：

1. `extensions: [CodingTools, Reviewer]` 是**数组形态**：存进 `pi.agent` 的是这两个名字，解析时按名字取安装好的扩展，顺序也保留（`src/harness/agent.ts:92-103`、`:185-232`）。顺序重要：钩子按选中扩展的顺序收集（`src/harness/agent.ts:134-141`），`role` section 也按这个顺序渲染。
2. `tools: [createReadTool()]` 只取名字（`names(tools)`，`src/harness/agent.ts:104-108`），解析时从组合里拿 `read`（`:187-190`）。所以「只读」不是靠说什么，而是靠工具集本身——reviewer 的模型**没有** `write`/`edit`/`bash` 可调用，写代码这条路被物理封死。
3. `model: { provider: "faux", modelId: "small" }` 与主 agent 的 `big` 不同：模型是会话配置的一部分（`AgentState.model`），不是全局设置。这就是「多 agent」在这个 harness 里的定义——多个会话，各自一份 `pi.agent`。
4. `cwd: worktree` 配合宿主 `env: ({ cwd = process.cwd() }) => new NodeExecutionEnv({ cwd })`：环境每次按会话的 cwd 新建，所以 reviewer 的文件读取落在自己的 checkout 里。用 `git worktree add` 的真实做法正是这个字段。
5. `hook(GenerationTask, { onYield })` 是循环的引擎。`onYield` 在一次**最终回答**（`stop`/`length`）上被调用，第一个返回 `{ continue }` 的钩子获胜；随后 generation 在同一个提交里追加一条 `pi.user`（内容是 continue 文本）、创建后继 generation 并交出 run——**当前 submission 保持打开**（`src/harness/generation.ts:512-537`）。因此一次 `submit()` 能产生两轮模型回答。
6. `onYield` 只在「final 边界没有选中用户项、也没有 reset」时才生效（源码注释与 `:526`）。如果有排队的用户输入，continuation 会被丢弃而不是插队——写循环时要注意这个条件。
7. 循环的终止靠哨兵字符串 `DONE`：`textOf(answer).includes(DONE)` 为真则返回 `undefined`，不追加。用标记字符串而不是「第二次就不循环」是因为**循环次数由内容决定**，模型自己决定什么时候复查够了。代价是提示词必须把哨兵字面量写清楚（示例的 continue 文本就带着它）。
8. reviewer 是 `ownerless` 会话：它不属于任何任务，所以既不会被主 agent 的 Esc 级联中止，也不会让某个任务一直「未完成」。这与 22/23 的 task-owned 子会话是两种取舍：ownerless 适合「长期存在的角色」，task-owned 适合「一次委托」。
9. `settings: { extensions: [CodingTools] }` 让主 agent 不会被套上 reviewer 的角色提示词；主 agent 甚至没有在这段脚本里发过请求（`harness.root(...)` 只是建立它）。
10. 打印时 `agent.cwd === worktree` 的结果是 `true`，一行里同时验证了四处配置。这种「一行断言式打印」在排查配置问题时比逐条 `console.log` 高效。

**你会看到**（实测输出，退出码 0，耗时 0.62s）：

```text
reviewer: small [ 'coding-tools', 'reviewer' ] [ 'read' ] true
> Review user.ts.
reviewer: 1. `name` does not handle a missing user.
> Look again for anything you missed. Say "No further findings." when there is nothing left.
reviewer: 2. `user` has no type. No further findings.
```

第一行是四处配置的快照（便宜模型、恰好两个扩展、只有 read、cwd 命中）。接下来 `>` 开头的两条都是 `pi.user` entry——第二条不是人输入的，而是 `onYield` 追加的 continue 消息，这从它的文本能一眼认出。两次 `reviewer:` 是两次助手回答；循环在第二次回答含 `No further findings.` 时结束，所以一次 `submit()` 共产生 2 次模型请求。

**动手改**：

- 把 `onYield` 改成无条件返回 `{ continue: "…" }`（不检查 `DONE`）：run 会一直循环下去（脚本只有三条响应，之后 faux 队列耗尽，会看到失败路径）。这能确认「循环的终止条件完全由钩子负责」，harness 不会保护你。
- 把 `tools: [createReadTool()]` 改成 `tools: null`：reviewer 拿到 `CodingTools` 的全部四个工具，`read` 仍在其中。对照输出里的 `[ 'read' ]`，可以看出「工具过滤」与「扩展选择」是两个独立维度。
- 把 `extensions: [CodingTools, Reviewer]` 换成 `{ add: [Reviewer] }`（对象形态，宿主默认已是 `[CodingTools]`）：结果一样，但存储里从固定数组变成增删描述——之后宿主默认选择变化时 reviewer 会跟着变。在「这个角色应该永远固定」的场景里，固定数组才是正确选择。

**对应源码/测试**：`src/harness/types.ts:296-334`（`AgentState`/`Agent`）、`:592-606`（`GenerationHooks.onYield` 的契约）、`src/harness/agent.ts:134-141`（钩子收集顺序）、`:143-232`（解析）、`src/harness/generation.ts:507-537`（`answer()`：continuation 与边界）。测试见 `test/harness-generation.test.ts`（onYield 与边界交互）、`test/harness-registry.test.ts:140-178`（扩展选择形态）、`test/harness-conversations.test.ts`。

### 5.5.8 29-sandbox-per-conversation.ts —— 每个会话一个沙箱

**它演示什么**：应用把「这个会话跑在哪个沙箱里」存进自己的文档，宿主的环境函数每次按 `conversationId` 查这张表再构造环境。两个用户的会话各自写文件、各自读到自己的内容，互不串。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/29-sandbox-per-conversation.ts
```

**关键代码**（`test/examples/29-sandbox-per-conversation.ts:18-71`）：

```typescript
// 一个会话跑在哪个沙箱里。fork: "initial"：fork 出来的会话一开始没有沙箱，直到应用给它分配一个。
const Sandbox = defineDoc<{ path?: string }>({
	kind: "app.sandbox",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({}),
});

const harness = await Harness.open(
	new MemoryStorage(),
	{
		models,
		registry,
		// 只读已提交值；没有沙箱的会话拿不到环境，于是它的工具干净地失败。
		env: async ({ conversationId, read }, envContext) => {
			const sandbox = await read.snapshot(Sandbox, conversationId, envContext);
			return sandbox?.path === undefined ? undefined : new NodeExecutionEnv({ cwd: sandbox.path });
		},
	},
	context,
);

// 每个用户的会话在创建提交里拿到一个新沙箱。
const model = { provider: "faux", modelId: "faux-1" };
async function conversationFor(user: string) {
	const path = await mkdtemp(join(tmpdir(), `pi-durable-sandbox-${user}-`));
	const conversation = await harness.createConversation(
		{
			ownership: { kind: "ownerless" },
			agent: { model },
			// init 在创建提交里运行，写文档是允许的。
			init: async (tx, id) => {
				(await tx.doc(Sandbox, id)).path = path;
			},
		},
		context,
	);
	return { conversation, path };
}
```

**逐点解释**：

1. `env` 是 **async** 的，并且用参数里的 `read`（`DocumentReader`，只提供提交读 `snapshot`/`snapshotAsOf`）而不是直接拿 `harness`：这样环境构造不会读到未提交的中间状态（`HarnessOptions.env` 的契约，`src/harness/types.ts:428-429`）。宿主说明里还特意指出它**从不在 Session 线上被调用**，所以里面可以做异步 I/O。
2. `read.snapshot(Sandbox, conversationId, envContext)` 是「每会话沙箱」的全部魔法：沙箱身份来自**存储里这个会话的文档**，不是进程内共享变量。因此重启、换进程、甚至换机器后，只要存储还在，会话仍然指向同一个沙箱。
3. `fork: "initial"` 让 fork 出来的会话没有沙箱（文档回到初始值 `{}`）。应用必须显式分配，`env` 才会返回环境；`fork: "current"` 会让新会话共享父会话的沙箱目录——对隔离场景是危险的默认值。
4. `init` 钩子在创建提交里跑，文档写在这里是允许的（`ConversationInit` 的注释：创建本身已是表写入，表读会抛 `ReadAfterWrite`，文档访问仍可用，`src/harness/types.ts:336-340`）。把「分配沙箱」和「创建会话」放进同一个提交，就不存在「有会话没沙箱」的中间态。
5. 没有沙箱时返回 `undefined` 而不是抛错：这是刻意的安全默认——工具会因为没有环境而失败（`requireEnv` 抛错 → 错误结果，`src/tools/env.ts:4-8`），而不是偷偷跑在宿主的 cwd 里。示例源码注释把这一点写成了「未配置就不可用」。
6. 两个 `mkdtemp` 目录由示例自己清理（`rm(…, { recursive: true, force: true })`），与 17/19 故意保留产物形成对照。
7. 两个会话都用同一个 faux 脚本（`write note.txt` + 一句「Saved.」），所以差异只可能来自环境——这正是想验证的变量。

**你会看到**（实测输出，退出码 0，耗时 0.64s）：

```text
alice's sandbox: from alice
bob's sandbox: from bob
```

两行分别读自两个临时目录，内容互不串。这条输出同时证明三件事：`write` 工具确实按会话的 env 落盘、`read` 时 `cwd` 也按会话走、两个会话的隔离来自存储关联而不是任何进程内状态。

**动手改**：

- 把 `conversationFor` 里 `init` 的赋值删掉，只建会话不分配沙箱：两次 `submit` 都会得到 `No execution environment is configured` 的工具错误结果，`readFile` 也会因目录里没有 `note.txt` 而抛错。这是「未配置就不可用」的直接验证。
- 把 `fork: "initial"` 改成 `"current"`，再用 `alice.conversation.fork(entryId, { ownership: { kind: "ownerless" } })` 建一个 fork 并让它写文件：fork 会写进 alice 的沙箱，产生串扰。对多租户产品这是安全问题，值得亲手看一次。
- 把 `env` 改成 `env: () => new NodeExecutionEnv({ cwd: process.cwd() })`（忽略会话）：两个会话会写进**同一个**仓库目录，`note.txt` 会互相覆盖，输出变成两行相同的 `from bob`。这是最直观的「不隔离会怎样」。

**对应源码/测试**：`src/harness/types.ts:415-439`（`EnvTarget` 与 `env` 契约）、`:336-347`（`ConversationInit`）、`src/tools/env.ts`（`requireEnv`）、`src/documents.ts:39-57`（`defineDoc` 的语义检查）。测试见 `test/harness-conversations.test.ts`（会话创建与 init）、`test/session-documents.test.ts`（文档语义与 fork）、`test/env-node.test.ts`。

### 5.5.9 30-tool-override.ts —— 同名工具替换与「装饰胜出者」的包装器

**它演示什么**：同一个 `bash` 名字被两个扩展提供，后选中的那个**原地替换**先选中的；一个包装扩展通过 `wrapTool` 装饰「最终胜出的那个 bash」，无论它来自谁。这是「同名工具替换」与「包装器不捕获基座工具」两条规则的组合演示。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/30-tool-override.ts
```

**关键代码**（`test/examples/30-tool-override.ts:26-51`、`test/examples/30-tool-override.ts:68-99`）：

```typescript
// 一个同名的 bash：在 CodingTools 之后被选中时，它原地替换 CodingTools 的 bash。
const Venv = defineExtension({
	name: "venv",
	tools: [createBashTool({ commandPrefix: "source .venv/bin/activate" })],
});

// 包装最终胜出的那个 bash，无论它是谁。包装器从不捕获基座工具，所以重载任何一个 bash 都仍然生效。
const timings: number[] = [];
const Timing = defineExtension({
	name: "timing",
	wraps: [
		wrapTool(createBashTool(), (bash) => ({
			...bash,
			execute: async (args, api, callContext) => {
				const start = Date.now();
				try {
					return await bash.execute(args, api, callContext);
				} finally {
					// 无论成功、失败还是抛错都记账。
					timings.push(Date.now() - start);
				}
			},
		})),
	],
});

const registry = createRegistry();
registry.install(CodingTools);
registry.install(Timing);
registry.install(Venv);
const harness = await Harness.open(
	new MemoryStorage(),
	{
		models,
		registry,
		// Venv 装了但默认不选。
		settings: { extensions: [CodingTools, Timing] },
		env: () => new NodeExecutionEnv({ cwd: project }),
	},
	context,
);
const model = { provider: "faux", modelId: "faux-1" };
const plain = await harness.root(context, { agent: { model } });
const python = await harness.createConversation(
	{ ownership: { kind: "ownerless" }, agent: { model, extensions: { add: [Venv] } } },
	context,
);

async function probeBash(conversation: Conversation): Promise<string> {
	await (await conversation.submit({ type: "input", content: "Which venv?" }, context)).wait(context);
	const page = await conversation.entries({}, 10, undefined, context);
	const result = page.items.find((entry) => ToolResultEntry.is(entry))?.model?.[0] as ToolResultMessage;
	return result.content.map((part) => (part.type === "text" ? part.text.trim() : "")).join("");
}

console.log("plain conversation:", await probeBash(plain));
console.log("python conversation:", (await probeBash(python)).replace(project, "<project>"));
console.log("timed bash calls:", timings.length);
```

**逐点解释**：

1. 替换规则在 `resolveAgent()` 的组合循环里：`composed.set(tool.name, tool)`（`src/harness/agent.ts:155-156`）——**后写入者胜**，所以 `bash` 由「选中顺序里最后一个提供 bash 的扩展」决定。python 会话的选中顺序是 `[coding-tools, timing, venv]`（宿主默认 + add 追加，`:221-224`），因此它的 bash 是 Venv 的那个。
2. `Timing` 的 `wraps` 声明的是**工具名**（`wrapTool(createBashTool(), …)` 里的第一个参数只用于取 `name`），实际包装发生在组合完成之后：`applyWrap(composed, wrap.tool, …)`（`src/harness/agent.ts:161-180`）。所以它包装的是「此刻在 map 里的那个 bash」——python 会话里就是 Venv 的 bash，plain 会话里是 CodingTools 的。**包装器从不在闭包里捕获具体基座对象**，这就是注释说的「重载任何一个 bash 都仍然生效」：热重载后组合会重新算，包装自然跟到新对象上。
3. `applyWrap` 还会拒绝「把工具改名」的 wrapper（`src/harness/agent.ts:245`），改名被视为包装器 bug 而不是特性——否则按名字索引的整个模型就失效了。
4. `wraps` 只在**被选中的扩展**里生效：`Venv` 没有 `wraps`，`Timing` 被默认选中，所以两个会话都被计时（`timings.length === 2`）。若把 `Timing` 从 `settings.extensions` 里去掉，替换仍然生效但计数为 0。
5. `try { … } finally { timings.push(…); }` 是测量工具耗时的正确写法：失败的工具会抛错（`bash` 在退出码非 0 或找不到 shell 时抛），`finally` 保证记账不丢。
6. `commandPrefix: "source .venv/bin/activate"` 的机制在 `createBashTool` 里：命令前缀和新命令用换行拼成一条脚本（`src/tools/bash.ts:57-59`），所以激活环境与用户命令在同一次 shell 调用里发生。`prepare` 钩子（`BashPrepare`）可以做更复杂的环境改写（例如改 `env`/`cwd`）。
7. `.replace(project, "<project>")` 是输出卫生：临时目录名每次不同，替换后才好比对。

**你会看到**（实测输出，退出码 0，耗时 0.64s）：

```text
plain conversation: <harness>
[error] No bash shell found. Options:
  1. Install Git for Windows: https://git-scm.com/download/win
  2. Add your bash to PATH (Cygwin, MSYS2, etc.)
  3. Configure an explicit shellPath

Searched Git Bash in:
  C:\Program Files\Git\bin\bash.exe
  C:\Program Files (x86)\Git\bin\bash.exe
</harness>
python conversation: <harness>
[error] No bash shell found. Options:
  1. Install Git for Windows: https://git-scm.com/download/win
  2. Add your bash to PATH (Cygwin, MSYS2, etc.)
  3. Configure an explicit shellPath

Searched Git Bash in:
  C:\Program Files\Git\bin\bash.exe
  C:\Program Files (x86)\Git\bin\bash.exe
</harness>
timed bash calls: 2
```

三点解读：`timed bash calls: 2` 证明包装器生效——两次探测都过了一遍 `Timing.execute`，而且是**替换后的**那个 bash（否则第二次不会经由同一个包装器计数）。第二，**本机没有 bash**，两次探测只拿到同一条 shell 错误，所以 `echo venv: $VIRTUAL_ENV` 的差异（示例本意是 python 会话打印 `venv: <project>/.venv`、plain 会话打印空值或宿主环境里的值）**在本轮输出里不可见**。要验证替换效果，需要装有 Git Bash 的机器；届时比较两行 `venv:` 后面的路径即可。[待核]: plain 会话在没有 VIRTUAL_ENV 的宿主环境里应打印 `venv: `（空），但如果宿主 shell 恰好设了该变量，`inheritEnv: true` 会让它透出来——本机未实测。第三，题目提示的 Windows `rm()` EBUSY **本轮两轮运行都没有出现**（两次 `rm(project, …)` 都成功、退出码 0、stderr 无 EBUSY 字样）；不能据此认为该问题不存在，只能说在这个环境下没有复现。

**动手改**：

- 把 `settings.extensions` 改成 `[CodingTools, Timing, Venv]`：plain 会话也会用 venv 的 bash（因为 Venv 变成了默认选中），两个会话的探测结果相同。这验证「替换只看选中顺序」。
- 在 python 会话上用 `conversation.agent(context)` 打印 `agent.tools.map(t => t.name)`：仍然是 `['read','write','edit','bash']`，名字层面看不出替换。替换只体现在**执行行为**上（以及 `agent.tools` 里那个对象的内存身份），所以别用名字去断言替换是否成功。
- 把 `wraps` 里的 `wrapTool(createBashTool(), …)` 换成 `wrapTool(createReadTool(), …)`：包装目标不存在（没有 read 被选中的情况下会静默跳过），`timings` 保持 0。`applyWrap` 找不到目标时直接返回而不报错（`src/harness/agent.ts:241-242`），这也是排查「我的 wrapper 为什么没生效」时最常踩的坑。

**对应源码/测试**：`src/harness/agent.ts:143-180`（组合、同名覆盖、包装应用顺序）、`:234-251`（`applyWrap` 的失败处理）、`src/harness/types.ts:251-254`（`Wrap` 类型）、`src/tools/bash.ts:26-29`/`:57-63`（`commandPrefix` 与 `prepare`）、`src/harness/registry.ts`（`install` 的同名替换语义）。测试见 `test/harness-registry.test.ts`（解析与包装）、`test/tools.test.ts`。

### 5.5.10 31-reload-and-restart.ts —— 热重载与跨重启绑定

**它演示什么**：两件事各验证一半。第一半：扩展在**调用进行中**被换成新版本，正在跑的调用仍用旧代码、下一次调用用新代码。第二半：换一个进程打开同一个存储，会话仍然选中 `versioned`，但这个进程还没安装它——于是工具列表是空的；安装之后工具立刻出现，全程没有改存储。

**运行**：
```bash
node --conditions=source --experimental-strip-types test/examples/31-reload-and-restart.ts
```

**关键代码**（`test/examples/31-reload-and-restart.ts:17-55`、`test/examples/31-reload-and-restart.ts:62-89`）：

```typescript
// 代替「从磁盘加载的代码」：每次调用都按文件当前的内容构造扩展。
let started = (): void => {};
let gate = Promise.resolve();
function loadVersioned(version: string) {
	return defineExtension({
		name: "versioned",
		tools: [
			defineTool({
				name: "version",
				description: "Report the tool's code version",
				parameters: Type.Object({}),
				execute: async () => {
					started();
					await gate;
					return { content: [{ type: "text", text: version }] };
				},
			}),
		],
	});
}

// 第一个进程。
let registry = createRegistry();
registry.install(loadVersioned("v1"));
let harness = await open(registry);
let root = await harness.root(context, {
	// 按名字选中。被存储的永远是名字，绝不是代码。
	agent: { model: { provider: "faux", modelId: "faux-1" }, extensions: [loadVersioned("v1")] },
});

// 调用进行中文件变了：正在跑的调用用 v1 跑完，下一次调用用 v2。
let release = (): void => {};
gate = new Promise((resolve) => {
	release = resolve;
});
const running = new Promise<void>((resolve) => {
	started = resolve;
});
const submission = await root.submit({ type: "input", content: "Which version?" }, context);
await running;
registry.install(loadVersioned("v2"));
release();
await submission.wait(context);
console.log("call running during the reload:", await lastResult());
await (await root.submit({ type: "input", content: "And now?" }, context)).wait(context);
console.log("next call:", await lastResult());
await harness.close(context);

// 第二个进程：会话仍然选中 "versioned"，但这个进程还没有安装它。
registry = createRegistry();
harness = await open(registry);
root = await harness.root(context);
const tools = async () => (await root.agent(context)).tools.map((tool) => tool.name);
console.log("after restart, before install:", await tools());
registry.install(loadVersioned("v3"));
console.log("after install:", await tools());
```

**逐点解释**：

1. `loadVersioned(version)` 每次调用都构造一个新的扩展对象——这是「从磁盘读到的代码」的替身。文件改了，对象就换了；对象换了，注册表里的同名扩展被原地替换（`Registry.install` 的语义：同名安装即替换，`src/harness/types.ts:289-294`）。
2. **正在跑的调用为什么还能用旧代码**：工具对象是在 `pi.tool` 的 `call` 阶段解析出来的（`const tool = (await runtime.agent(context)).tools.find(...)`，`src/harness/tool.ts:57`），随后 `run()` 用的是这一个对象（`:91`）。注册表替换不影响已经捕获的引用。README「Reload」节把这条说得很清楚：已经开始的调用保留它拿到的代码，每个阶段、每次请求或调用才重新解析。
3. `started` / `gate` 是测试用的握手：工具一开始执行就 resolve `started`（主流程据此知道「调用在飞行中」），然后 `await gate` 卡住它，直到替换完成、`release()` 放行。没有这个握手，「替换发生在调用中途」就成了竞态。
4. `extensions: [loadVersioned("v1")]` 存的是**名字** `["versioned"]`（`src/harness/agent.ts:92-103`）。这就是第二半能成立的全部原因：会话里没有代码，只有名字。
5. 第二个进程 `createRegistry()` 是空的（只带内建的三个任务）。`root.agent(context)` 解析时按名字查 `snapshot.extension("versioned")`，查不到就跳过——不报错、不回退（`src/harness/agent.ts:226-231`）。于是工具列表是**空数组**：`after restart, before install: []`。仓库里有一条对应的单元测试断言这个行为（`test/harness-registry.test.ts:171-178`：「skips uninstalled names and resolves them again once they are installed」）。
6. `registry.install(loadVersioned("v3"))` 之后工具立刻出现，**没有写任何存储**：解析发生在每次 `agent()` 调用时（`Conversation.agent()` 的注释：用当前 registry 快照与 settings 解析，`src/harness/types.ts:487-488`）。版本是 `v3` 而不是 `v1`：名字绑定、代码自由，宿主可以在重启后加载一个更新的实现。
7. `harness.root(context)` 第二次调用不带 options：`root()` 只在会话不存在时创建，存在时忽略 `agent`/`init`（README 与 06-harness.ts 的输出都印证了这点）。
8. `lastResult()` 用最新优先的 `entries()` 找最近一条工具结果，所以两次调用不会读串。这个方法在 26、30 里也出现过，是本组读工具结果的标准写法。

**你会看到**（实测输出，退出码 0，耗时 0.66s）：

```text
call running during the reload: v1
next call: v2
after restart, before install: []
after install: [ 'version' ]
```

四行对应四个断言：飞行中的调用用旧代码；下一次调用用新代码；重启后未安装的扩展让工具列表为空；安装后立刻可用。整段演示没有一行涉及「序列化扩展」或「迁移工具对象」——**存储里只有名字**这个设计让热重载与跨重启变成同一件事的两个侧面。

**动手改**：

- 把 `agent.extensions` 改成 `[loadVersioned("v1")]` 之外的形态，例如 `{ add: ["versioned"] }`：语义变成「在宿主默认选择上增加」，而宿主默认是「所有已安装扩展」；第一个进程里两者等价，但第二个进程（空注册表）下 `[]` 的结果不变。这能帮助区分「固定数组」与「增删描述」在跨进程解析时的差别。
- 在第二个进程里把 `registry.install(loadVersioned("v3"))` 换成 `registry.install(defineExtension({ name: "versioned" }))`（没有工具）：`after install` 变成 `[]`——安装的是名字、工具来自扩展的内容。这验证「解析按名字、能力由代码决定」。
- 把 `registry.install(loadVersioned("v2"))` 移到 `release()` 之后、`submission.wait()` 之前：结果仍应是 `v1`（工具在执行前就拿到了对象）。把 `install` 放到第二次 `submit` 之后，`next call` 会变成 `v1`。这两次微调可以精确标出「新代码从哪一刻开始生效」——答案是「下一个阶段/调用」，不是「提交完成」也不是「进程重启」。

**对应源码/测试**：`src/harness/tool.ts:50-118`（每阶段的工具解析与执行）、`src/harness/types.ts:288-294`（`Registry` 的安装语义）、`:483-490`（`Conversation.agent()` 的解析时机）、`src/harness/agent.ts:212-232`（按名字选择、缺失即跳过）、`src/harness/registry.ts`（快照与发布）。测试：`test/harness-registry.test.ts:120-178`（同名替换、未安装名字被跳过、安装后恢复）、`test/harness-tools-recovery.test.ts`（代码变化与已记录意图的交互）。

---

## 5.6 32 个示例总索引

| 示例 | 主题 | 讲解 | 难度 |
|---|---|---|---|
| `00-conversation` | 最小 Session：建一个会话 | 5.2.1 | 入门 |
| `01-documents` | 文档、`rewindable`、`snapshotAsOf` | 5.2.2 | 入门 |
| `02-forks` | fork 的历史继承与文档语义 | 5.2.3 | 入门 |
| `03-owned-conversations` | 任务拥有会话；一笔提交建三样东西 | 5.2.4 | 入门 |
| `04-chord-state` | 文档暴露成 Chord 订阅状态 | 5.2.5 | 入门 |
| `05-watches` | `watchDoc` 基线与增量 | 5.2.6 | 入门 |
| `06-harness` | Harness、扩展、配置「存名字、用时解析」 | 5.3.1 | 核心 |
| `07-configuration` | `configure()` 增删扩展/工具/指令 | 5.3.2 | 核心 |
| `08-harness-conversations` | 多会话；fork 继承 `pi.agent` | 5.3.3 | 核心 |
| `09-context` | 转录 → 模型上下文（head / edits / 排序 / 补位） | 5.3.4 | **重点** |
| `10-registry-reload` | 扩展热替换；wrap 按名字生效 | 5.3.5 | 核心 |
| `11-extension-state` | 扩展自己的文档 + section 自足渲染 | 5.3.6 | 核心 |
| `12-tasks` | 写第一个持久任务 | 5.3.7 | **重点** |
| `13-recovery` | 崩溃点、memo、重启继续 | 5.3.8 | **重点** |
| `14-chat` | 一轮问答（faux provider） | 5.4.1 | 核心 |
| `15-system-prompt` | section 组装与差量系统提示 | 5.4.2 | 核心 |
| `16-real-model` | 真实 OpenAI 流式（无 key 自动跳过） | 5.4.3 | 核心 |
| `17-coding-tools` | 工具轮、hook 计时、JSONL 存储 | 5.4.4 | 核心 |
| `18-print` | print 模式 | 5.4.5 | 核心 |
| `19-json` | agent 事件流 / 原始 ops 流 | 5.4.6 | 核心 |
| `20-inbox` | 忙时排队：followUp / steer / write / reject | 5.4.7 | 核心 |
| `21-late-join` | 中途接入：快照 + 增量事件 | 5.4.8 | 核心 |
| `22-subagent-foreground` | 前台子 agent（replay 三件套） | 5.5.1 | 进阶 |
| `23-subagent-background` | 常驻后台子 agent（anchor / reporter） | 5.5.2 | **最难** |
| `24-child-tasks` | 子任务、`failFast`、自底向上 abort | 5.5.3 | **重点** |
| `25-compaction` | 压缩三触发：阈值 / 后台 / 溢出 | 5.5.4 | 进阶 |
| `26-coding-agent` | CodingTools + 实时 settings + 跟随会话的目录 | 5.5.5 | 进阶 |
| `27-plan-mode` | plan 模式扩展（自己的文档 + `configure()`） | 5.5.6 | 进阶 |
| `28-reviewer` | reviewer 会话与「审一轮再改一轮」循环 | 5.5.7 | 进阶 |
| `29-sandbox-per-conversation` | 按会话隔离环境 | 5.5.8 | 进阶 |
| `30-tool-override` | 同名工具覆盖与计时 wrap | 5.5.9 | 进阶 |
| `31-reload-and-restart` | 热重载扩展；重启后「选择」与「代码」分离 | 5.5.10 | 进阶 |

**实测汇总**（32/32 退出码 0、环境偏差、逐示例看点）见第 8.3 节；那里也记录了本机缺少 bash 导致的两处无法验证的点。

**推荐顺序**：

1. 第一遍（核心概念）：`00` → `01` → `06` → `14` → `09` → `12` → `13`
2. 第二遍（UI 与运行时）：`15` → `16` → `17` → `20` → `21` → `25`
3. 第三遍（所有权与恢复）：`22` → `24` → `23` → `31`
4. 其余按主题按需查表。

---

---


# 第 6 部分：测试地图

84 个测试文件、约 28,000 行，是这个包最完整的「行为说明书」。这一部分给出「哪个文件断言哪条规则」的地图，并讲清恢复类测试如何构造崩溃点。

## 6.1 84 个测试文件总览

`test/` 下共有 **84 个 `.ts` 文件、27,962 行**（本次用 `Get-ChildItem -Recurse -Filter *.ts` 加逐文件行数统计得到）。这 84 个文件按角色分成五类，读表时先看清属于哪一类，否则会把语义读偏：

| 类别 | 数量 | 特征 |
| --- | --- | --- |
| `*.test.ts`（Vitest 用例） | 43 | 含 `describe`/`it`，是断言的主要来源 |
| `test/examples/*.ts`（可运行示例） | 32 | 每个是可独立运行的脚本，见第 5 部分 |
| `test/*-support.ts`（支撑库） | 4 | 提供 faux provider、Harness 打开、控制存储、deferred 等工具 |
| `test/fixtures/*.ts`（固定装置） | 2 | 给「无 `Buffer` 运行时」等边界用的小文件 |
| 基准/测量脚本 | 3 | `storage.bench.ts`（vitest bench）、`storage-memory.ts`、`tool-output-bench.ts` |

下表的「行数」是逐文件实测；「关键断言」列的每一项都取自该文件里真实的 `it`/`test` 标题（英文原文即测试名，行号是标题所在行），不是概括性描述。`examples/` 与支撑文件没有断言，其最后一列写的是它们的作用或要点。

| 文件 | 行数 | 覆盖主题 | 关键断言 / 要点（`文件:行号`） |
| --- | --- | --- | --- |
| `test/chat-support.ts` | 118 | 支撑库 | `chatSetup`/`openChat` 组装 faux 模型与根会话；`allEntries`/`textOf`/`waitFor`/`unanswered` 供恢复测试使用 |
| `test/chord-guide.test.ts` | 394 | Chord 用法指南的可执行版 | `:269` canvas 的 facet host、远端 client、withdraw 与 detach 都在 Harness close 前结束；`:327` 带 keyed consumer 的 diff review；`:356` job output watch 直到生产方 retire 文档 |
| `test/env-node-spill.test.ts` | 89 | spill 背压（仅非 Windows） | `:53-54` spill 写未完成时，继承的 stdio 在 exit grace 之后仍需保持打开 |
| `test/env-node.test.ts` | 982 | NodeExecutionEnv：文件系统、行读取、shell | `:269` rename 原子替换目标；`:329` 预先 abort 的文件操作无副作用；`:756` 非零退出码是成功结果；`:764` 被信号杀死的进程映射为非零退出码；`:840` abort 期间忽略异步 taskkill 错误；`:683` Windows 上 detached 后代持有 stdio 时仍能 settle；`:899` spill 保留精确原始字节；`:583` 字符串环境变量覆盖的三种语义 |
| `test/env-truncate.test.ts` | 98 | UTF-8 截断工具 | `:23` 无 `Buffer` 运行时也能正确计数与截断；`:45` 末尾换行不算多一行；`:73` 按字节上限截断时不切开半行 |
| `test/harness-compaction.test.ts` | 2299 | 压缩：切点、串行化、手动/后台/阻塞/溢出、事件、恢复、inbox | `:226` spec §8.7 的切点示例；`:248` 不在 tool result 处切；`:580` 切得最远的压缩胜出；`:1010` 阻塞压缩先落 summary 再发请求；`:1146` 溢出压缩后同 attempt 重试；`:1558` reopen 后不重复；`:1623` 被打断的摘要只重发一次且只计已答尝试 |
| `test/harness-context.test.ts` | 135 | ContextView 组装 | `:21` 无 head 时给全量转录且排除无 model 的 entry；`:32` aborted/error/deferred 的助手消息排除但原始 entry 保留；`:108` fork 后合成缺失 tool result 并丢弃被切断的 result |
| `test/harness-conversations.test.ts` | 473 | root/会话/agent/lifecycle | `:72` root 懒创建且 agent change 与 init 同一 commit；`:156` 会话创建原子、失败回滚；`:287` `conversationCreated` 在内建之后、agent/init 之前；`:331` agent 字段整体替换、`null` 清除、`undefined` 不动 |
| `test/harness-events.test.ts` | 616 | agent 事件流 | `:106` 生命周期事件 + 文本 delta 重建答案；`:247` 100 个未投递 batch 后折叠成一个快照；`:266` 从 message change 重建每个已提交 partial；`:360` run 结束 + 排队 follow-up 起新 run 时只发一个精确 batch；`:586` 流随 Harness 结束 |
| `test/harness-generation-recovery.test.ts` | 289 | 生成栈崩溃恢复 | `:41` 提交前被打断的 preparation 重跑；`:74` 无 partial 的请求重发且不重复 preparation；`:124` 已提交 partial 转成 aborted entry 后按相同 messages 重发；`:164` retry backoff 跨 reopen；`:201` 继续轮询 deferred；`:230` pinned model 消失时报 `no_model` |
| `test/harness-generation.test.ts` | 660 | 生成栈常态 | `:89` 回答问题并 settle submission；`:119` partial 存为 delta、静止时存完整 base；`:187` 可重试错误经持久 backoff 后重试；`:389` provider session ID 在并发会话间是 request-local；`:554` 空 start 事件后转 deferred 则不提交 partial |
| `test/harness-inbox.test.ts` | 923 | Inbox、队列模式、steer、reset、usage | `:106` 忙碌时排队、最终边界 write 优先于 user item、每 run 一个 follow-up；`:231` 排队 reset 在 tool 之后结束 run；`:301` 指向 active range 之前的排队 head write 变 stale；`:431` 排队提交跨 reopen；`:451` inbox 以 positional Chord ops 提交、空时写 base；`:874` 跨 reopen 后 usage 精确（重开后才转换的 partial 只计一次） |
| `test/harness-inspect.test.ts` | 162 | `Harness.inspect()` | `:39` 不运行 task 代码就推导每个 live task 状态；`:145` 列出未 settle 的 submission |
| `test/harness-lifecycle.test.ts` | 613 | open/close、暂停调度、注册表变更 | `:127` close 先 join 忽略信号的 task handler 再关 Storage；`:197` close 完成后新 Harness 可用且旧 invocation 代码不再运行；`:256` 提交期间 close 的 commit 仍持久 settle；`:275` close 期间 settle 的 commit 不发布帧；`:450` seal 后排队读完成、排队 wait/acquisition 拒绝；`:533` 只读 viewer 不触发调度 |
| `test/harness-live-deltas.test.ts` | 454 | `pi.live` 的字段级增量 | `:100` generation→tool round→tool 交接各写一个字段；`:181` tail 窗口滑动 = 前裁剪 + 追加；`:204` Chord 找不到重叠时写整个窗口；`:279`/`:443` 无运行时精确写完整 base |
| `test/harness-output.test.ts` | 272 | 工具输出限界与 Progress 节流 | `:90`/`:95` 代理项边界切尾与 `Buffer` 逐字节一致（含确定性模糊用例）；`:134` 跨 chunk 的 UTF-8 解码；`:183`/`:195` 窗口上限；`:206` 首个变更立即提交、之后 ≥100 ms 且按 100 KiB/s 后退；`:236` 失败提交拒绝等待者并报错 |
| `test/harness-ownership.test.ts` | 965 | ownership 边、abort 级联、工具拥有的子会话 | `:173` foreground 子树有活时会话保持 busy 并 hold 已完成的 owner；`:200` abort 标记级联到 owned foreground 子树并撤回排队输入；`:224` failed owner 级联而 completed 不级联；`:319` 重开后根据需先加载的 owner 边判定 idle；`:845` 重开后重放安全 subagent 工具以同一 child 与 submission 重跑；`:900` 后台 supervisor 重启后不重复提交 |
| `test/harness-prompt.test.ts` | 274 | 系统提示与工具装载准备 | `:121` 段落原地重放、`null` 删除、重加追加；`:169` head marker 后重新基线并省略两侧保留的 delta；`:240` 工具声明增删改并在需要时重写顺序 |
| `test/harness-registry.test.ts` | 291 | 注册表与 agent 解析 | `:72` 按名字安装/原地替换/卸载扩展；`:104` 校验失败时不发布任何东西；`:127` 永远持有内建 task（它不是扩展）；`:180` 同名工具原地替换 → 包装赢家 → 再过滤；`:214` wrapper 抛错或改名则该工具被丢弃并报告；`:241` 段落按扩展排序、相同 key 原地替换、instructions 最后且不包装 |
| `test/harness-structured.test.ts` | 1712 | 结构化任务语义与恢复 | `:338` `allSettled` 等所有被等待任务 terminal 并按序读 outcome；`:370` `failFast` 子任务失败中止兄弟但不中止父；`:542` completing 持有到 owned work 排空；`:670` abort handler 自底向上、每层在下一层 terminal 之后；`:891` 恢复等待已 terminal 子任务的父；`:963` 恢复等待 live 支付的任务；`:1259` 缺定义时 waiting 阻塞、注册新版本后迁移恢复 |
| `test/harness-submissions.test.ts` | 278 | Submission 生命周期 | `:38` idle write 立即 done 且不产生 turn；`:57` `whenBusy: reject` 时不写入；`:82` 请求 ID 在任何写入前按会话去重；`:149` 读跨过 close 开始的 wait 被拒；`:178` reopen 后重新获取并持久 settle；`:223` 按事务里的当前记录 settle |
| `test/harness-support.ts` | 158 | 支撑库 | `openHarness`、`user`/`assistant`/`toolResult`/`system` 消息构造、`addTool`/`addTask`/`addHooks`/`addSection` 一键装卸 |
| `test/harness-task-graph.test.ts` | 358 | 任务图视图 | `:84` 跟随每个 live task 的 status、owner 边与 owned 会话；`:168` 重开后存活任务显示为 pending 并标出 abort；`:312` 无节点变化的提交不发布 revision 且多观察者共享一个 mount |
| `test/harness-tasks-recovery.test.ts` | 857 | 任务崩溃恢复、blocked 任务、定义移交 | `:112` intent/effect/outcome 任务在 intent 之后被打断可恢复（效果靠 request key 幂等）；`:262` mark commit 在 storage 里崩溃后 run 恢复；`:359` terminal outcome 之后不再跑任何东西；`:432` 迁移失败不改记录、只对新定义重试；`:497` blocked 任务被 abort 时 orphaned 并退役其文档；`:627` 同版本替换在相位边界移交且无重叠；`:782` 与 handover 竞争的 abort mark 被保留 |
| `test/harness-tasks.test.ts` | 1340 | 任务相位、runtime、调度、abort、close | `:145` handler 之后抛错仍保留已提交的 terminal outcome；`:189` 结果与 entry 原子提交、memos 保留到 terminal、退役 task 文档；`:359` agent 每相位解析一次并保持该相位；`:572` runtime commit 与 step 的顺序（之前入队的落线、之后的被拒）；`:723` 失败的 reservation commit 期间到达的 wakeup 保留；`:865` abort mark 后拒绝 run 的 commit 与 memo 写；`:1084` abort mark 胜过与它竞争的 fault；`:1111` close 时不产生 outcome 也不启动新相位 |
| `test/harness-tools-recovery.test.ts` | 405 | 工具崩溃恢复与 replay 策略 | `:109` unsafe 工具在 intent 之后被打断，用持久 partial 输出回答；`:136` 仅当 stored 与 current 策略都 safe 才重跑；`:213` 打断在 intent 之前会重跑 `beforeTool` 而 execute 只一次；`:252` 重跑 generation 的 tools 相位；`:338` 真实 bash 命令被 close 打断后回答并完成 run |
| `test/harness-tools.test.ts` | 1091 | 工具轮、结果、钩子、进度、生命周期 | `:239` 默认并行、配置或工具要求时串行；`:365` `beforeTool` 前后校验参数并应用 block/替换；`:444` 第一个 `beforeTool` block 胜出并跳过后续 handler；`:537` `addTools` 生效且仅当整轮结果都要终止才终止；`:931` 工具运行中被替换仍按调用开始时解析的实现完成；`:1059` aborted 工具只用持久输出回答、丢弃缓冲 |
| `test/harness-view.test.ts` | 353 | 会话视图与订阅 | `:103` 每个触及提交发布一帧且操作可重建每个 revision；`:133` 未变化部分共享、无关提交不发帧；`:151` 按 head marker 切分；`:231` 100 个未投递帧后替换为最新视图；`:307` 并发观察者共享一个 mount 且单个 listener 失败被隔离 |
| `test/jsonl-storage.test.ts` | 1156 | JsonlStorage：发布顺序、崩溃恢复、回收 + 契约注册 | `:326` 回收 current-only 文档与 terminal task sidecar 之前先发布每次提交；`:390` 删除「完整 + 撕裂」的未确认 sidecar 追加；`:458`/`:502` 在指定 append/flush 次数注入失败后只恢复已确认状态；`:866` 永不回收 rewindable 文档历史；`:978` 按精确字节偏移截断撕裂 UTF-8 尾并复用未确认序号；`:1100` 拒绝非递增的主提交序号 |
| `test/memory-storage.test.ts` | 32 | MemoryStorage 契约注册 + `prepareCommit` 隔离 | `:8` 注册全部一致性用例；`:10-31` prepared commit 不暴露 retained 状态（borrowed 写入冻结、`apply()` 重复调用返回同一 `Seq`） |
| `test/provider-session-cache-e2e.test.ts` | 124 | 真实 Codex prompt cache 回归（无凭据自动跳过） | `:48-49` 跨 Durable turn 复用 Codex prompt cache；`:112` 首次请求 ≥4000 tokens；`:118` 缓存命中率 ≥0.9 |
| `test/session-checkpoints-migrations.test.ts` | 844 | 检查点谓词与文档迁移 | `:20` `checkpointWhen` 以定义自身为 receiver；`:42` 只有非空普通批次才选 base 且传入精确的已准备 revision 与 ops；`:112` `deltasSinceBase` 在 unload 与版本 base 之后重置；`:196` 谓词抛错时回滚所有已准备文档；`:333` 冷加载只迁移一次且不写入；`:376` 首次成功事务写必需 base、之后写 delta；`:648` 当前与历史 rewindable 值独立迁移并跟随 fork 祖先 |
| `test/session-definitions.test.ts` | 177 | 文档定义的类型层 | `:69` 校验持久化的 version 语义；`:78` 类型化 owner/key/seed 重载；`:126` 类型化历史读、state、watch 与 typed entry |
| `test/session-documents.test.ts` | 656 | Session 文档事务 | `:137` 指针交换式采用并共享 operation payload；`:174` 空批次抑制写与发布；`:190` 可重放的非空结构 no-op 仍会写并发布；`:228` 回调失败时中止所有变更；`:440` Storage 不确定失败后 Session 中毒且不发布；`:479` 退役并在同地址创建新 incarnation |
| `test/session-forks.test.ts` | 695 | fork 时的文档拷贝 | `:30` as-of/current 的单例与家族 base 被拷贝，`initial` 文档保持不存在；`:152` 使用 fork entry commit 的最终文档状态并排除同 commit 之后的 entry；`:383` 不可见 fork point 在 admission 前被拒且 Session 仍可用；`:503` 后续组装失败时回滚每个已拷贝 base |
| `test/session-states.test.ts` | 232 | 文档 state | `:31` 不创建不存在的文档；`:40` 立即 hydrate 的只读 state 与 Chord 交付连续；`:116` 发布 null retirement 且不跟随替换 incarnation；`:170` hydrate 迁移 tracker 不写入并跳过等值版本 base |
| `test/session-support.ts` | 155 | 支撑库 | `ControlledStorage`（`holdCommits`/`holdFindDocument`/`crash`/`failNextCommit`）、`openTestSession`、`flush`、publication 提取辅助 |
| `test/session-tables.test.ts` | 460 | 事务表 API | `:82` 表读只允许在首次表写之前；`:213` 缺失/terminal/abort-marked 的会话 owner 被原子拒绝；`:330` 整条替换 task 记录；`:387` terminal 候选之后拒绝 task 文档；`:405` terminal 结算时退役 task 文档（含同事务创建的） |
| `test/session-watches.test.ts` | 503 | 文档 watch | `:83` 串行化回调并缓冲在飞行期间提交的精确帧；`:142` 101 个待处理提交折叠为一个 root replacement；`:229` 保留提交 Context 值且不继承生产者取消；`:304` close 丢弃 start 前缓冲的 retirement；`:467` 可从 acquisition revision 重放每个已交付的精确 operation batch |
| `test/spec-usage.test.ts` | 380 | spec 示例的可编译性 | `:377` 编译 spec 里的用法示例 |
| `test/sqlite-facade.test.ts` | 373 | 便携 SQLite facade 的结算与串行化 | `:83` 每连接只 prepare 一次并跨事务复用；`:124` 串行化并发事务；`:159` 操作按调用顺序执行；`:224` 事务同步发起的数据库调用被排队；`:347` 提交替换 base 时仍从同一已提交状态读文档 |
| `test/sqlite-migrations.test.ts` | 160 | SQLite schema 迁移 | `:30` 当前 schema 可重复应用；`:47` 拒绝比 portable core 更新的数据库；`:60` bootstrap 与所有待应用迁移一起回滚；`:98` 失败迁移回滚并保留数据以便成功重试 |
| `test/sqlite-storage.test.ts` | 617 | SqliteStorage 细节 + 契约注册 | `:170` 记录、序列分配、全局 ID 分配跨 reopen；`:193` 拒绝持久化元数据损坏；`:307` SQL 行与序列分配作为单事务回滚；`:441` 只在 base 或退役后回收 current-only revision；`:493` WAL 自动 checkpoint 且 close 时截断；`:523` 复用 current-only checkpoint 释放的页；`:567` 代表性行与文档存储有界 |
| `test/storage-memory.ts` | 238 | 内存/磁盘占用测量（脚本，非 vitest 用例） | 每个后端 × 规模起一个子进程；`:136-152` 基线 → seed → 读 3 轮 ×10 后取快照；`:164` 用 `storageBenchmarkPrimaryRecordCount` 换算每记录字节 |
| `test/storage-runtime-boundary.test.ts` | 48 | portable 子路径的依赖图 | `:26` 包根不含 `env/`、`storage/jsonl/`、`storage/sqlite/`；`:33`/`:38`/`:43` portable sqlite、env、jsonl 的源码图里没有 `node:` 导入 |
| `test/storage.bench.ts` | 191 | 存储基准（vitest bench） | `:18` 三后端；`:58-65` 计时前先校验每个读场景的正确结果；`:90-115` 写场景按迭代数预建 fixture 池；`:172` reopen + 首次精确读 |
| `test/task-support.ts` | 113 | 支撑库 | `deferred`/`aborted`/`eventually`/`settled`/`openTasks`/`completed`/`abortedWith`/`countingReader` |
| `test/tool-output-bench.ts` | 301 | 工具输出基准（脚本） | `:40-47` 三档速率（200 ms/行、25 行/50 ms、800 行/0 ms）；`:57-70` 场景矩阵（3 后端 × 速率 × retain × 工具数 + firehose + cat 1 GiB）；`:217-224` close 中途重开并计时 replay |
| `test/tools.test.ts` | 610 | 内建工具 read/write/edit/bash 与文件变更队列 | `:196` 文本 offset/limit 读并报告续读诊断；`:299` aborted write settle 前占住变更队列；`:360` 所有 edit 对原文匹配并拒绝重叠；`:426`/`:488` 同一文件系统串行、不同文件系统不串行；`:512` 保留 BOM 与 CRLF；`:528` 非零退出/超时在流式输出之后抛错；`:591` 超出默认限制时仍可得完整输出 |
| `test/types.test.ts` | 346 | 类型层（编译期 + 运行期断言） | `:49` 数字 ID 按记录类型 brand 且携带 task result 类型；`:72` 判别式依赖字段的编码；`:256` submission、task wait、compaction 与擦除进 extension 的 task 类型 |
| `test/examples/00-conversation.ts` | 21 | 示例 | 见 5.2 节 |
| `test/examples/01-documents.ts` | 45 | 示例 | 见 5.2 节 |
| `test/examples/02-forks.ts` | 55 | 示例 | 见 5.2 节 |
| `test/examples/03-owned-conversations.ts` | 69 | 示例 | 见 5.2 节 |
| `test/examples/04-chord-state.ts` | 37 | 示例 | 见 5.2 节 |
| `test/examples/05-watches.ts` | 41 | 示例 | 见 5.2 节 |
| `test/examples/06-harness.ts` | 66 | 示例 | 见 5.3 节 |
| `test/examples/07-configuration.ts` | 99 | 示例 | 见 5.3 节 |
| `test/examples/08-harness-conversations.ts` | 42 | 示例 | 见 5.3 节 |
| `test/examples/09-context.ts` | 136 | 示例 | 见 5.3 节 |
| `test/examples/10-registry-reload.ts` | 48 | 示例 | 见 5.3 节 |
| `test/examples/11-extension-state.ts` | 86 | 示例 | 见 5.3 节 |
| `test/examples/12-tasks.ts` | 64 | 示例 | 见 5.3 节 |
| `test/examples/13-recovery.ts` | 90 | 示例 | 见 5.3 节 |
| `test/examples/14-chat.ts` | 45 | 示例 | 见 5.4 节 |
| `test/examples/15-system-prompt.ts` | 93 | 示例 | 见 5.4 节 |
| `test/examples/16-real-model.ts` | 69 | 示例 | 见 5.4 节 |
| `test/examples/17-coding-tools.ts` | 101 | 示例 | 见 5.4 节 |
| `test/examples/18-print.ts` | 53 | 示例 | 见 5.4 节 |
| `test/examples/19-json.ts` | 103 | 示例 | 见 5.4 节 |
| `test/examples/20-inbox.ts` | 72 | 示例 | 见 5.4 节 |
| `test/examples/21-late-join.ts` | 100 | 示例 | 见 5.4 节 |
| `test/examples/22-subagent-foreground.ts` | 136 | 示例 | 见 5.5 节 |
| `test/examples/23-subagent-background.ts` | 363 | 示例 | 见 5.5 节 |
| `test/examples/24-child-tasks.ts` | 141 | 示例 | 见 5.5 节 |
| `test/examples/25-compaction.ts` | 123 | 示例 | 见 5.5 节 |
| `test/examples/26-coding-agent.ts` | 81 | 示例 | 见 5.5 节 |
| `test/examples/27-plan-mode.ts` | 115 | 示例 | 见 5.5 节 |
| `test/examples/28-reviewer.ts` | 111 | 示例 | 见 5.5 节 |
| `test/examples/29-sandbox-per-conversation.ts` | 82 | 示例 | 见 5.5 节 |
| `test/examples/30-tool-override.ts` | 102 | 示例 | 见 5.5 节 |
| `test/examples/31-reload-and-restart.ts` | 90 | 示例 | 见 5.5 节 |
| `test/fixtures/delete-buffer.ts` | 2 | 固定装置 | 让 `Buffer` 在运行时不可见，配合「无 Buffer」的截断用例 |
| `test/fixtures/utf8-byte-length-without-buffer.ts` | 11 | 固定装置 | 无 `Buffer` 时的 UTF-8 字节长度实现 |

三个数字值得单独记住：`test/harness-compaction.test.ts` 2299 行、`test/harness-structured.test.ts` 1712 行、`test/harness-tasks.test.ts` 1340 行——压缩、任务语义、任务调度这三块是语义密度最高的地方，也是最容易改坏的地方。

**怎么用这张表**：文件名与源码目录基本一一对应，找某块语义的证据时可以直接按名字定位——

- `src/session/`（Session、Tx、Entry、Document、ContextView）→ `test/session-*.test.ts`（`documents`、`tables`、`states`、`watches`、`forks`、`checkpoints-migrations`、`definitions`）与 `test/spec-usage.test.ts`。
- `src/harness/` → `test/harness-*.test.ts`。其中 `-recovery` 后缀的两个文件（`tasks-recovery`、`generation-recovery`、`tools-recovery`）只放跨 close/reopen 的语义，常态语义在无后缀的同名文件里。
- `src/storage/` → `test/{memory,sqlite,jsonl}-storage.test.ts`（契约 + 后端细节）、`test/sqlite-facade.test.ts`、`test/sqlite-migrations.test.ts`、`test/storage-runtime-boundary.test.ts` 与两个脚本 `test/storage.bench.ts`、`test/storage-memory.ts`。
- `src/env/` → `test/env-node.test.ts`、`test/env-node-spill.test.ts`、`test/env-truncate.test.ts`；`src/tools/` → `test/tools.test.ts`；`src/types.ts` → `test/types.test.ts`；`src/testing/` 自己不被直接测试，其正确性由三个后端的契约注册证明（见 6.4）。
- 第一次读这套测试，建议的顺序是：6.3 → `harness-tasks-recovery` → `harness-generation-recovery` → `harness-tools-recovery` → `session-checkpoints-migrations`。先建立「崩溃点—恢复语义」的框架，再读常态语义会顺得多。

## 6.2 关键行为断言精选

下面 39 条按主题分组，每条给出 `test/文件:行号`（行号是 `it`/`test` 标题所在行）、它断言什么、以及为什么这条规则重要。所有测试名都是原文。

挑选标准有两条，读者可以据此扩展自己的清单：一是**违反它会在跨 reopen / 跨 fork 之后产生可观察差异**（所以恢复与提交类规则占比最高）；二是**它是修改实现时最容易顺手破坏的边界**（所以「第一个 handler 胜出」「最后渲染 instructions」这类顺序规则也在列）。要做一次破坏性验证时，按这里的文件与行号跑单文件即可（例如 `node node_modules/vitest/dist/cli.js --run test/harness-inbox.test.ts`），不必跑全量套件。

#### 提交原子性

1. `test/harness-lifecycle.test.ts:256` —— 一条 commit 的 committer 在 Storage 里被取消时，该 commit 仍要**持久地 settle**。重要性：close 与提交同时发生时，不允许出现「调用方拿到异常但数据已入库」或反过来的模糊状态。
2. `test/sqlite-storage.test.ts:307` —— SQL 行与序列分配作为**一个事务**回滚。重要性：`Seq` 分配与数据行必须在同一次事务里原子生效，否则失败后会留下序号空洞或重复。
3. `test/session-documents.test.ts:228` —— 文档事务回调失败时中止所有变更。重要性：Session 的 Tx 是 all-or-nothing，回调内部的半成品不能泄漏到内存视图。
4. `test/session-tables.test.ts:213` —— 缺失、terminal、abort-marked 的会话 owner 被**原子**拒绝。重要性：owner 校验与写入是同一步，失败时不能留下「会话已创建但没有 owner」。

#### 转录与上下文

5. `test/harness-context.test.ts:32` —— aborted、error、deferred 的助手消息**不进** `messages`，但它们的原始 entry 保留。重要性：模型看不到半截或失败的回复，而审计与回放仍能拿到原始记录。
6. `test/harness-context.test.ts:108` —— fork 之后为缺失的 tool call 合成 tool result，并丢弃被切断的 result。重要性：上下文必须对模型保持「每个 tool call 都有结果」的合法形状，否则 provider 会拒绝请求。
7. `test/harness-prompt.test.ts:169` —— head marker 之后重新基线，并省略 marker 两侧保留的 delta。重要性：重放（replay）必须能在 head 处截断，否则历史越长重放越慢。

#### 任务与调度

8. `test/harness-tasks.test.ts:145` —— handler 在提交 terminal outcome 之后抛错，已提交的 outcome 仍然保留。重要性：任务的终局由「已提交的记录」决定，而不是由异常决定，重试也不会二次执行。
9. `test/harness-tasks.test.ts:189` —— 结果与 entry 原子提交，memos 保留到 terminal，task 文档在终局时退役。重要性：这三件事把「任务产出」「一次性副作用」绑定在同一个提交点上。
10. `test/harness-tasks.test.ts:1084` —— abort mark 胜过与它竞争的 fault。重要性：用户按 Esc 时，即使同一瞬间发生错误，语义也应该是「被中止」而不是「失败」。
11. `test/harness-structured.test.ts:542` —— 完成的任务被持有（completing）直到它拥有的工作全部排空，等待者与 task 文档也要等最终提交。重要性：这是「父任务不能在自己的子任务还在写文件时对外宣称完成」的具体实现。
12. `test/harness-structured.test.ts:370` —— `failFast` 下子任务失败会中止存活的兄弟，但**不中止父任务**。重要性：失败传播是单向的，父任务的处理权必须留在自己手里。

#### 提交与信箱

13. `test/harness-submissions.test.ts:82` —— 请求 ID 在任何写入之前按会话去重。重要性：网络重试同一个请求不能产生第二条 user entry，也不能让同一次输入跑两轮。
14. `test/harness-inbox.test.ts:106` —— 忙碌时排队；最终边界上 write 优先于用户项；每个 run 只起一个 follow-up。重要性：它决定「排队期间的多条输入如何变成一次后续 run」，以及应用写入的相对顺序。
15. `test/harness-inbox.test.ts:301` —— 排队中的 head write 若指向 active range 之前的 entry，则结算为 stale。重要性：已经不可见的写入不能悄悄生效，它的失败必须是显式的。

#### 工具与恢复

16. `test/harness-tools-recovery.test.ts:109` —— `replay: "unsafe"` 的工具在 execute 之后被打断，用**持久 partial 输出**加一段固定说明回答。重要性：不安全工具不能重跑（可能有副作用），但必须给模型一个诚实的错误结果。
17. `test/harness-tools-recovery.test.ts:136` —— 只有 stored 与 current 两侧策略都是 safe 才重跑。重要性：工具实现的 replay 声明可能在重启之间被改小，两侧取交集是唯一安全的选择。
18. `test/harness-tools-recovery.test.ts:213` —— 打断发生在 intent 提交**之前**时重跑 `beforeTool`，但 execute 只执行一次。重要性：把「还没生效的准备」与「已经发生的副作用」严格分开。
19. `test/harness-tools.test.ts:931` —— 工具在中途被替换或卸载，本次调用仍按调用开始时解析到的实现完成。重要性：一次调用内部不允许实现漂移，否则同一结果会用不同逻辑算出。
20. `test/harness-tools.test.ts:1059` —— 被中止的工具只用持久输出回答，丢弃内存里缓冲的输出。重要性：观察者看到的和模型收到的是同一个「持久化事实」。

#### 压缩

21. `test/harness-compaction.test.ts:248` —— 切点可以落在长 run 中间的 assistant 上，但**永不**落在 tool result 上。重要性：tool result 必须与它的调用成对保留，否则上下文形状非法。
22. `test/harness-compaction.test.ts:580` —— 多次压缩并发时，**切得最远**的那个胜出，与完成顺序无关。重要性：压缩结果必须与「谁先跑完」这个时间细节解耦。
23. `test/harness-compaction.test.ts:1010` —— 阻塞式阈值压缩先把 summary 追加进上下文，再发本次请求。重要性：请求必须在压缩后的上下文上发出，否则溢出会重演。
24. `test/harness-compaction.test.ts:1146` —— 溢出（overflow）触发压缩后，用**同一个 attempt** 重试，并把错误文本排除在重试之外。重要性：溢出不算一次失败尝试，重试预算不被压缩消耗。
25. `test/harness-compaction.test.ts:1623` —— 被打断的摘要只重发一次，usage 只统计已答复的那次尝试。重要性：崩溃恢复既不能重复计费，也不能重复写 summary entry。

#### 扩展与配置

26. `test/harness-registry.test.ts:104` —— 注册表在「安装后会是什么样」的前提下校验，非法时**不发布**任何变更。重要性：扩展安装是原子的，坏扩展不会留下半个注册表。
27. `test/harness-registry.test.ts:180` —— 同名工具原地替换 → 先跑 wrapper → 再应用过滤器。重要性：覆盖与包装的顺序决定了扩展能看到的工具集合，这个顺序是 API 的一部分。
28. `test/harness-registry.test.ts:241` —— 段落按扩展排序、同 key 原地替换、instructions 最后渲染且不被包装。重要性：系统提示的字节顺序影响 prompt cache 命中，必须是确定性的。
29. `test/harness-conversations.test.ts:287` —— `conversationCreated` 在每个创建提交里都跑，位置在内建逻辑之后、agent 与 init 之前。重要性：扩展拿到的会话一定已有内建结构，且能在 agent/init 落定前插手。

#### 视图与事件

30. `test/harness-view.test.ts:103` —— 每个触及视图的提交发布一帧，帧里的操作足以重建每个 revision。重要性：视图是提交日志的纯函数投影，任何「补丁式」状态都会在重放时露馅。
31. `test/harness-view.test.ts:231` —— 超过 100 个未投递帧后，用最新视图整体替换待发帧。重要性：慢消费者不能让内存无界增长，同时不能丢最终状态。
32. `test/harness-task-graph.test.ts:312` —— 不改变任何节点的提交不发布 revision，多个观察者共享同一个 mount。重要性：观察者数量与帧数量解耦，避免 N 个视图把提交放大成 N 倍开销。

#### 存储

33. `test/sqlite-storage.test.ts:342` —— reopen 之后重建 recent 与 ancient 两个 rewindable 点。重要性：历史点必须能跨进程重建，「当前值正确」不代表历史可用。
34. `test/sqlite-storage.test.ts:615` —— 100 条 1 KiB 的 entry 加 100 次文档 delta 之后，数据库文件 < 1 MiB。重要性：给出了「有界存储」的可验证量级，防止索引或 WAL 悄悄膨胀。
35. `test/jsonl-storage.test.ts:978` —— 撕裂的 UTF-8 尾按精确字节偏移截断，并复用被截掉的未确认序号。重要性：崩溃后既不能读出半个字符，也不能留下序号空洞。
36. `test/storage-runtime-boundary.test.ts:26` —— 包根的源码图里不出现 `env/`、`storage/jsonl/`、`storage/sqlite/`。重要性：它保证 core 能在没有 Node 内置模块的运行时里跑，是三种后端共享同一套契约的前提。

#### 类型层

37. `test/types.test.ts:49` —— 数字 ID 按记录类型 brand，且 task 记录携带自己的 result 类型。重要性：`EntryId`/`TaskId`/`DocumentId` 混用是这类系统最常见的 bug，靠类型系统在编译期拦住。
38. `test/types.test.ts:72` —— 判别式字段决定其余字段的编码（discriminated union 的精确性）。重要性：`SubmissionRecord` 的 `status` 与 `TaskRecord` 的 `state` 都是判别式，漏掉一个分支就等于漏掉一种运行时状态。
39. `test/session-definitions.test.ts:69` —— 文档定义的 version 语义被校验（持久化的 version 必须与定义匹配）。重要性：迁移逻辑的正确性完全建立在 version 判定上。

## 6.3 崩溃恢复类测试的设计

这一节只看一件事：这些测试**怎么**在「提交了一半就死」的位置上精确地把进程按停，以及每个位置分别证明了哪条恢复语义。

#### 崩溃点是怎么造出来的

仓库里有两种互补的手段，读恢复测试时先认出手法，再读断言。

**手法一：真实后端 + 精确卡点 + `close()`。** 用真的 SQLite 文件（`test/harness-generation-recovery.test.ts:20-24` 建临时目录与 `session.sqlite`），让某个 handler 在指定位置阻塞在一个 `deferred()` 上，等测试确认「卡点已经到达」后调用 `harness.close(context)`。close 会信号化并 join 正在跑的 handler，于是「这一相位已经做完但下一步还没提交」的状态被留在磁盘上。重开同一个文件就是一次崩溃恢复。

**手法二：`ControlledStorage` 注入崩溃与失败。** `test/session-support.ts` 里的 `ControlledStorage extends MemoryStorage` 提供三个钩子：`holdCommits()` 让下一次 `commit` 卡在「已进入 Storage、但还没生效」的位置；`crash()` 让被卡住的提交**永不落地**（后续提交照常进行）；`failNextCommit(error)` 让下一次提交直接失败。任务恢复测试用这套装置精确制造「提交在飞行中进程死了」的窗口。

```typescript
// test/session-support.ts:36-89（截取）：可控存储的崩溃钩子
/** Memory storage with observable commits, held calls, and injected commit failures. */
export class ControlledStorage extends MemoryStorage {
	/** Exact borrowed batches admitted by Session. */
	readonly admittedCommits: (readonly StorageWrite[])[] = [];
	/** Simulate a crash during the held commit: it never reaches storage, and later commits proceed. */
	crash(): void {
		this.#commitGate = undefined;          // 丢掉闸门：被卡住的 commit 永远不会生效
	}

	failNextCommit(error: Error): void {
		this.#commitFailure = error;           // 下一次 commit 抛错（用于"提交被拒"的恢复路径）
	}

	override async commit(writes: readonly StorageWrite[], commitContext: Context): Promise<Seq> {
		this.admittedCommits.push(writes);     // 记录「Session 真的把它交给了 Storage」
		this.commits.push(structuredClone(writes));
		const held = this.#commitGate;
		if (held !== undefined) {
			held.entered.resolve();            // 告诉测试：提交已经进入 Storage
			await held.gate.promise;           // 卡在这里，直到 release() 或 crash()
		}
		const failure = this.#commitFailure;
		if (failure !== undefined) {
			this.#commitFailure = undefined;
			throw failure;
		}
		return super.commit(writes, commitContext);
	}
	// ...（类里还有 mintId/document/findDocument 的计数与 holdFindDocument 闸门，见 :91-112）
```

任务崩溃测试把上面这套封装成「放弃崩溃的 Harness，用同一个 storage 开一个新的」：

```typescript
// test/harness-tasks-recovery.test.ts:219-251（截取）：崩溃模拟的写法
/**
 * Crash simulation: the crashed Harness is abandoned without close, its held storage commit never lands, and its
 * blocked handlers never return. A new Harness then opens the same storage.
 */
describe("task crash recovery", () => {
	/** A task whose run ignores its signal and whose abort handler blocks while `blockAbort` is set. */
	function crashTask(log: Log, options: { blockAbort: boolean }) {
		return defineTask<null, Step, null>({
			name: "test.crash",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: {
				run: async () => {
					log.push("run");
					await new Promise(() => {});            // 永不返回：模拟"进程已经死了"
				},
			},
			abort: async (_task, runtime, ctx) => {
				log.push("abort");
				if (options.blockAbort) await new Promise(() => {});
				await runtime.commit(() => abortedWith("recovered"), ctx);
			},
		});
	}

	async function recover(storage: ControlledStorage, log: Log) {
		storage.crash();                                    // 被卡住的提交就此消失
		const { harness } = await openTasks(storage, [crashTask(log, { blockAbort: false })]);
		const page = await harness.commit((tx) => tx.scanTasks({ kind: "test.crash" }, 1), context);
		return { harness, id: page.items[0]!.id };          // 从存储里找出那个任务，继续观察它
	}
	// ...（同一 describe 里还有 crashedRun 等辅助函数，见 :253-260）
```

#### 公共装置：`deferred` / `aborted` / `eventually` / `waitFor` 的分工

写一条新的恢复测试，只需要四个小工具，它们都在 `test/task-support.ts` 与 `test/chat-support.ts` 里，分工不能混用：

| 工具 | 定义处 | 语义 | 用在什么场合 |
| --- | --- | --- | --- |
| `deferred<T>()` | `task-support.ts:20-28` | 一个可手动 resolve/reject 的 Promise | 让 handler 卡在精确的一点上；测试用它的 `promise` 作为「到达卡点」的信号 |
| `aborted(signal)` | `task-support.ts:31-36` | 返回一个 Promise：signal 一 abort 就以 `signal.reason` 拒绝；**已经 abort 时立刻拒绝** | handler 里写「等到被取消」，这是把 close 变成可控卡点的关键 |
| `eventually(check)` | `task-support.ts:39-45` | 最多 200 轮宏任务 flush 直到 `check` 成立，否则抛 `"Condition was not reached"` | 纯异步推进（任务状态、日志长度）的等待，不依赖真实时间 |
| `waitFor(check, timeoutMs = 5000)` | `chat-support.ts:84-90` | 每 5 ms 轮询一次，默认 5 秒超时 | 涉及节流窗口与真实计时器的等待（进度提交、deferred 轮询） |
| `flush()` | `session-support.ts:153-155` | `new Promise((resolve) => setTimeout(resolve, 0))` | 把微任务与一个宏任务轮次排空，让「已入队的提交」有机会落到存储 |

`aborted()` 的两个分支值得写进肌肉记忆，因为它决定了「卡点是否可能被无限等待」：

```typescript
// test/task-support.ts:30-36
/** Reject with the signal's reason once it aborts; for handlers that block until cancelled. */
export function aborted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) reject(signal.reason);                             // 已经取消：立即拒绝
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
}
```

三条经验规则（都是从这些文件的写法里读出来的）：

1. **等待要区分「异步推进」与「真实时间」**：`eventually` 用于前者（例如 `test/harness-tasks-recovery.test.ts:124` 等 `service.calls === 1`），`waitFor` 用于后者（例如 `test/harness-generation-recovery.test.ts:177-180` 等 live 文档里出现 `retry`）。用 `eventually` 等计时器事件会白等 200 轮，用 `waitFor` 等纯异步推进会把测试变成对机器负载敏感的轮询。
2. **卡点必须自己报到达**：每个 `blockingTool`、`gated()`、`unanswered()` 都让 handler 在阻塞前 resolve 一个 `reached`/`started` Promise，测试先 `await` 它再 `close()`；否则 close 可能发生在提交之前或之后，测试会变成随机失败。
3. **`close()` 是「制造崩溃」的手段，不是清理**：恢复类测试刻意在 `close` 之后**不**断言最终状态，而是重开一个新 Harness 再断言；`close` 的语义是「信号化并 join」，所以忽略信号的 handler 会让 close 挂住（`test/harness-lifecycle.test.ts:127` 专门测这个），这也正是恢复测试要避免的写法——结论只能是 `Harness.open` 的 reconcile 步骤读出正确状态。

#### 任务：Intent / Effect / Outcome 的中断

`test/harness-tasks-recovery.test.ts` 用一个「转账」任务把「已发生的副作用」与「已提交的意图」分开：`prepare` 提交 intent（含一个由任务 ID 派生的 request key），`apply` 调用外部服务并把结果提交为 outcome。外部服务按 request key 幂等（`:47-57`）。

```typescript
// test/harness-tasks-recovery.test.ts:65-91（截取）：intent/effect/outcome 任务
function transferTask(service: TransferService, interrupt: { first: boolean }) {
	return defineTask<{ amount: number }, TransferState, { receipt: number }>({
		name: "test.transfer",
		version: 1,
		initial: () => ({ phase: "prepare" }),
		phases: {
			prepare: async (task, runtime, ctx) => {
				await runtime.memo("requested", task.input.amount, ctx);
				await runtime.commit(
					() => ({ status: "running", checkpoint: { phase: "apply", key: `transfer-${task.id}` } }),
					ctx,                                   // 意图：把 request key 写进 checkpoint
				);
			},
			apply: async (task, runtime, ctx) => {
				const receipt = await service.apply(task.state.checkpoint.key, task.input.amount);
				if (interrupt.first) {
					interrupt.first = false;
					await aborted(runtime.signal);         // 效果已经发生，但 outcome 还没提交 —— 崩溃点
				}
				await runtime.commit(() => completed({ receipt }), ctx);
			},
		},
		abort: async (_task, runtime, ctx) => {
			await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), ctx);
		},
	});
}
```

对应断言（`:112-145`）：close + 重开之后任务状态是 `pending`、checkpoint 停在 `apply`、memos 里 `requested: 7` 仍在（`:129-133`）——**open 时把 running 和解为 pending，但 checkpoint 与 memos 原样保留**；resume 后服务被调用第二次（`calls === 2`）但请求只生效一次（`applied.size === 1`），最终 outcome 是 `{ receipt: 70 }`（`:136-139`）。第三次重开时记录已经 terminal，什么都不再跑。

「提交在飞行中被丢弃」的六个位置（同一文件 `:262-396`）分别证明：

| 崩溃点（测试标题原文） | 行号 | 存储里留下的状态 | 证明的语义 |
| --- | --- | --- | --- |
| crash while the mark commit is in storage: the run resumes | `:262` | `abortRequested: false`、`pending` | mark 没落地就等于没按过 Esc，任务照常重跑（`log === ["run","run"]`） |
| crash after the mark before the run joins | `:278` | `abortRequested: true`、`pending` | 已落地的 mark 必须被执行：重开后只跑 abort handler，不再跑 run |
| crash while the abort handler runs | `:303` | `running` | 中断在 abort handler 内部时，重开要派一个新的 abort invocation 把任务结算掉 |
| crash while the abort outcome is in storage | `:324` | 无 outcome | 结算提交没落地，abort handler 必须再跑一次（最终 reason 用新定义的 `"recovered"`，而不是死掉那次想写的 `"lost"`） |
| crash after the terminal outcome | `:359` | terminal | 终局是幂等的：重开后 log 仍只有一条 `abort` |
| crash while the reservation commit is in storage | `:379` | `pending`、log 为空 | 保留（reserve）没成功就不算开始过，run 一次都没跑 |

另外 `:782-823` 用 `ControlledStorage.commits` 直接读出整个状态迁移序列，把「mark 与 handover 竞争」的每一步都固定下来：

```typescript
// test/harness-tasks-recovery.test.ts:804-823（截取）
		const states = storage.commits.flatMap((writes) =>
			writes.flatMap((write) =>
				write.type === "task" && write.value.id === id
					? [`${write.value.state.status}${write.value.abortRequested ? "+mark" : ""}`]
					: [],
			),
		);
		// created, reserved, progress, handover, mark, abort reservation, aborted
		expect(states).toEqual([
			"pending",
			"running",
			"running",
			"pending",          // handover：新定义接管，任务回到 pending
			"pending+mark",     // abort 标记落在 handover 之后
			"running+mark",     // abort invocation 被预留
			"terminal+mark",
		]);
		expect(log).toEqual(["old:a start", "old:a end", "new:abort"]);   // 由新定义执行 abort
```

#### 生成栈：prepare / request / partial / retry / poll

`test/harness-generation-recovery.test.ts` 的七个用例把生成栈切成五段，每段一个崩溃点：

```typescript
// test/harness-generation-recovery.test.ts:41-70（截取）：「准备阶段提交前被打断」
	it("reruns preparation interrupted before its commit", async () => {
		const path = await sqlitePath();
		const setup = chatSetup();
		const reached = deferred();
		let block = true;
		addSection(setup.registry, "preamble", async (_input, ctx) => {
			if (block) {
				block = false;
				reached.resolve();                    // 告诉测试：渲染系统提示已经到达这个点
				await aborted(ctx.abortSignal!);      // 卡住，直到 close 取消它
			}
			return "p";
		});
		setup.faux.setResponses([fauxAssistantMessage("answer")]);
		let opened = await open(path, setup);
		opened.harness.resume();
		const id = (await opened.root.submit({ type: "input", content: "hi" }, context)).id;
		await reached.promise;
		const taskId = await runTaskId(opened.harness);
		await opened.harness.close(context);          // 崩溃：prepare 尚未提交

		opened = await open(path, setup);
		expect(await checkpoint(opened.harness, taskId)).toEqual({ phase: "prepare", attempt: 1 });
		opened.harness.resume();                      // 重跑 prepare，然后正常完成
		expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe("done");
		expect((await allEntries(opened.root)).map((entry) => entry.kind)).toEqual([
			"pi.user",
			"pi.system",
			"pi.assistant",
		]);
```

关键在最后一行断言**entry 种类序列**：`pi.user`、`pi.system`、`pi.assistant` 各一条，说明重跑没有写出重复的 system 或 user entry。第二个用例（`:74-122`）把崩溃点推进到「请求已发出、任何 partial 都还没提交」，它额外证明重发用的是**固定的（pinned）请求**而不是重新读设置——测试在重开前把 `settings.stream.timeoutMs` 从 1234 改成 999，断言真正发出的 `timeoutMs` 仍是 1234（`:105-115`）。

第三个用例是「partial 已经持久化」的情形（`:124-162`）：

```typescript
// test/harness-generation-recovery.test.ts:147-160
		opened = await open(path, setup);
		const stored = await opened.harness.snapshot(LiveDoc, opened.root.id, context);
		const partial = textOf(stored?.generation?.message as Message)!;
		// Everything observers saw before the crash is durable.
		expect(partial.startsWith(watched!)).toBe(true);   // 崩溃前观察者看过的内容，存储里一份不少
		opened.harness.resume();
		expect((await (await opened.harness.submission(id, context))!.wait(context)).status).toBe("done");
		expect(sent).toEqual([["user"]]);                  // 第二次请求只带 user，不带那个半截 partial
		const entries = await allEntries(opened.root);
		expect(entries.map((entry) => entry.kind)).toEqual(["pi.user", "pi.assistant", "pi.assistant"]);
		const converted = entries[1]!.model![0] as AssistantMessage;
		expect(converted.stopReason).toBe("aborted");      // 半截内容被转成 aborted entry
		expect(textOf(converted)).toBe(partial);
		expect(await opened.harness.snapshot(LiveDoc, opened.root.id, context)).toEqual({});
```

这段是 6.3 里最该记住的一条：**崩溃时已经提交的 partial 不会被丢弃，而是转成一个 `stopReason: "aborted"` 的 entry**；新请求的 messages 里只有 `user`（没有 partial），live 文档被清空。剩下两个点分别是 retry backoff（`:164-199`，断言 checkpoint 里的 `until: 61_000` 与 live 的 `retry.at`，把时钟拨到该时刻后继续）和 deferred 轮询（`:201-228`，断言 `pollAt: 61_000`，且 `deferredFetchCount === 1`，重启没有重复取一次已经拿到的响应）。

#### 工具：replay 策略与 durable partial output

工具恢复的崩溃点是「tool 已经开始执行并写了输出，然后进程死掉」。测试用 `blockingTool` 制造它：

```typescript
// test/harness-tools-recovery.test.ts:84-106（截取）
/**
 * A tool that writes output, then blocks until its invocation is cancelled the first `blocking` times it runs.
 * `started` resolves once the output is durable.
 */
function blockingTool(name: string, extra: Partial<ToolRegistration> = {}) {
	const started = deferred();
	const state = { runs: 0, blocking: 1 };
	const registration = tool(
		name,
		async (_args, api, callContext) => {
			state.runs++;
			api.output(`run ${state.runs}\n`);           // 先写输出，让它变成持久事实
			await api.details({ run: state.runs }, callContext);
			if (state.runs <= state.blocking) {
				started.resolve();                       // 输出已 durable，通知测试
				await aborted(callContext.abortSignal!); // 卡住，直到 close 取消这次调用
			}
			return {};
		},
		extra,                                          // 调用方在这里传 replay: "safe" / "unsafe"
	);
	return { registration, started, state };
}
```

断言分三处，合起来定义了 replay 策略的全貌：

- `:109-134`（unsafe）：重开后 task 的 checkpoint 是 `{ phase: "execute", arguments: {}, replay: "unsafe" }`，`state.runs === 1`（**没有重跑**），结果 entry 的文本是 `"run 1\n|<harness>\n[error] Tool work was interrupted and may have partially run\n</harness>"`（`:129-131`），live 文档清空。
- `:136-163`（策略交集）：三组 `[stored, current, reruns]` 为 `["safe","safe",true]`、`["safe","unsafe",false]`、`["unsafe","safe",false]`——只有两侧都 safe 才 `runs === 2`，否则结果是 error。
- `:165-211`（重新解析环境）：safe 工具重跑时用**重跑时**的 cwd（`["/one","/two"]`）；但如果工具在重开后被取消选择，就退化成 unsafe 处理（`text(result)` 含 `"was interrupted"`）。

另有一条容易被忽略的规则在 `:366-404`：重跑前要先**清掉中断那次的 progress**，断言重跑后 slot 的 `diagnostics` 与 `details` 只剩第二次的值（`[{ severity: "info", message: "second" }]`、`{ run: 2 }`）。

#### 压缩：queued summary 与 retry backoff

`test/harness-compaction.test.ts` 的 `compaction recovery` 组（`:1538-1704`）复用同一种「卡在 gated 摘要请求上 → close → 重开」的手法。其中一条最能说明压缩的恢复语义：

```typescript
// test/harness-compaction.test.ts:1623-1643（截取）
	it("resends an interrupted summarization once and counts only the answered attempt", async () => {
		const path = await sqlitePath();
		let chat = await first(path);
		const reached = deferred();
		chat.faux.summaries.push(gated(deferred(), summary(), reached));   // 第一次摘要请求发出去就卡住
		const id = await chat.root.compact(undefined, context);
		await reached.promise;
		const usageBefore = (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models["faux/faux-1"]!;
		expect((await chat.harness.getTask(id, context))?.state).toMatchObject({ checkpoint: { phase: "summarize" } });
		await chat.harness.close(context);                                 // 崩溃点：摘要已发出、未被回答
		chat = await reopen(path, chat.setup, chat.faux);
		chat.faux.summaries.push(summary());                               // 第二次给出答案
		expect((await result(chat, id)).status).toBe("completed");
		expect(chat.faux.summaryRequests).toHaveLength(2);                 // 只重发一次
		const [, resent] = chat.faux.summaryRequests;
		expect(resent!.messages).toEqual(                                  // 重发的 messages 与首次逐字段一致
			chat.faux.summaryRequests[0]!.messages.map((message) => ({ ...message, timestamp: expect.any(Number) })),
		);
		const usage = (await chat.harness.snapshot(UsageDoc, chat.root.id, context))!.models["faux/faux-1"]!;
		expect(usage.output - usageBefore.output).toBe(2);                 // 只计入"已答复"的那次尝试
```

另一条 `:1668-1685` 证明**跨 reopen 的依赖关系**：generation 的 checkpoint 停在 `{ phase: "prepare", overflow: OVERFLOW }`（`waiting`），重开后阻塞式压缩完成，最终 entry 序列的末尾是 `["pi.compaction", "pi.system", "pi.assistant"]`——summary 一定排在新系统提示与答案之前。`:1687-1703` 则证明**排队中的 summary 不丢**：压缩在 run 忙碌期间完成、结果排队，close 后重开，下一个 submission 到来时先落 summary 再回答。

任务层面还有一条更基础的保证：`test/harness-tasks-recovery.test.ts:826-856` 里，`Harness.open` 若在 reconcile 提交上失败（注入 `"disk full"`），必须释放注册表订阅并关掉 Session——断言 `reader.subscriptions() === 0` 且之后读 task 会抛错。它保证「open 失败不留半开句柄」。

#### 检查点与迁移：半截提交的另一面

`test/session-checkpoints-migrations.test.ts` 不模拟进程崩溃，但它从**数据形状**这一侧回答了同一个问题：如果每次提交都写 delta，重启后靠什么重建？答案是 `checkpointWhen` 谓词——文档定义自己决定「什么时候写一份完整 base」。

```typescript
// test/session-checkpoints-migrations.test.ts:112-158（截取）
	it("passes the stored delta count since the newest base, including after unload and version bases", async () => {
		const seen: number[] = [];
		const V1 = defineDoc<{ count: number }>({
			kind: "checkpoint.deltas-since-base",
			version: 1,
			scope: "session",
			initial: () => ({ count: 0 }),
			checkpointWhen: (_value, _ops, info) => {
				seen.push(info.deltasSinceBase);          // 谓词能拿到"自最新 base 以来累计了多少 delta"
				return info.deltasSinceBase >= 2;
			},
		});
		// ...（V2 同 kind、version 2）
		await increment(V1);
		await increment(V1);
		await increment(V1);
		await session.unloadDocuments();                  // 卸掉内存缓存 ≈ 重启后的冷读
		await increment(V1);
		expect(seen).toEqual([0, 1, 2, 0]);               // 卸载后计数从 0 重新开始
		const kinds = storage.commits
			.slice(-4)
			.map((writes) => (writes[0]!.type === "document.change" ? writes[0]!.content.kind : writes[0]!.type));
		expect(kinds).toEqual(["delta", "delta", "base", "delta"]);
```

三条与「崩溃 / 原子性」直接相关的规则：

- **谓词抛错 = 整批回滚**（`:196-250`）：第二个文档的 `checkpointWhen` 抛错时，第一个文档的检查点决策也要撤销，`firstCalls === 1`、`storage.commits` 长度不变、`publications` 长度不变，且两个快照仍是原来那两个对象（`:237-241`）。
- **delta 尾巴必须可重放**（`:252-277`）：8 次编辑全部选择 `false`（写成 delta），`unloadDocuments()` 之后快照仍是 `{ values: [1..8] }`——即 delta 链在冷读时能被完整重建。
- **迁移的 base 是强制的**（`:376-438`、`:564-595`）：冷读旧版本只做**内存迁移、不写存储**（`:333-374` 断言 `storage.commits` 长度不变，且回调返回的对象被复制，改动它不影响已发布的快照）；第一次成功事务必须写一个 `{ kind: "base", version: 3 }`，之后才是 delta（`:415-434`）；退役时这份必需 base 要在 retire 之前落盘，且**不咨询** `checkpointWhen`（`:577-580` 的谓词直接 `throw new Error("must not run")`）。

#### 崩溃点对照表

| 崩溃点 | 测试（`test/文件:行号`） | 证明的恢复语义 |
| --- | --- | --- |
| resume 提交在 Storage 里被丢弃 | `harness-tasks-recovery.test.ts:379` | 没落地的保留不算开始，run 一次都没跑 |
| run 正在跑、abort mark 提交在飞行中 | `harness-tasks-recovery.test.ts:262` | mark 丢失 = 没按过 Esc，run 重跑 |
| mark 已落地、run 忽略信号未 join | `harness-tasks-recovery.test.ts:278` | 已落地的 mark 必须执行，但只跑 abort |
| abort handler 内部 | `harness-tasks-recovery.test.ts:303` | 派新的 abort invocation 收尾 |
| abort 的终局提交在飞行中 | `harness-tasks-recovery.test.ts:324` | abort handler 再跑一次，写新的终局 |
| 终局已提交 | `harness-tasks-recovery.test.ts:359` | 终局幂等，不再执行任何 handler |
| 定义的 handover 与 abort mark 竞争 | `harness-tasks-recovery.test.ts:782` | 状态迁移固定为 `pending → running → running → pending → pending+mark → running+mark → terminal+mark` |
| preparation 提交前 | `harness-generation-recovery.test.ts:41` | 重跑 prepare，entry 序列不重复 |
| 请求已发出、无 partial | `harness-generation-recovery.test.ts:74` | 按 pinned 请求重发，不重读设置 |
| partial 已提交 | `harness-generation-recovery.test.ts:124` | partial 转 aborted entry；重发只带 user；live 清空 |
| retry backoff 中 | `harness-generation-recovery.test.ts:164` | checkpoint 的 `until` 与 live 的 `retry.at` 一致，时钟到达后继续 |
| deferred 轮询中 | `harness-generation-recovery.test.ts:201` | `pollAt` 持久，`deferredFetchCount` 不重复 |
| pinned model 在重开后不存在 | `harness-generation-recovery.test.ts:230` | 请求与轮询两条路径都报 `no_model` |
| 工具已 execute、输出已持久 | `harness-tools-recovery.test.ts:109` | 按 replay 策略回答（unsafe 用持久输出加固定文案） |
| intent 之前被打断 | `harness-tools-recovery.test.ts:213` | 重跑 beforeTool，execute 仍只一次 |
| 摘要请求在飞行中 | `harness-compaction.test.ts:1623` | 只重发一次、messages 一致、usage 只计已答 |
| 摘要重试退避中 | `harness-compaction.test.ts:1647` | 退避跨 reopen 继续 |
| 阻塞压缩等待中 | `harness-compaction.test.ts:1668` | summary 落在新系统提示与答案之前 |
| summary 已排队、run 仍忙碌 | `harness-compaction.test.ts:1687` | 排队摘要跨 reopen 保留，下个边界落盘 |
| Harness.open 的 reconcile 提交失败 | `harness-tasks-recovery.test.ts:827` | 释放注册表订阅并关闭 Session，不留半开句柄 |

#### 写一条新的恢复测试：五步模板

上面这些测试的结构高度一致，可以照抄成模板：

1. **造一个能被按停的 handler**：在你要证明的那一步**之后**放 `await aborted(ctx.abortSignal!)` 或 `await gate.promise`，并在阻塞前 resolve 一个 `reached`/`started`——没有这一步，测试就无法确定崩溃发生在提交之前还是之后。
2. **决定崩溃方式**：要跨进程语义就用真实后端（SQLite 文件 + `harness.close()`，参照 `harness-generation-recovery.test.ts:26-28` 的 `open`）；要「提交在飞行中丢包」就用 `ControlledStorage.holdCommits()` + `crash()`；要「提交被拒」就用 `failNextCommit()`（`harness-tasks.test.ts:746` 的 `reruns a task whose fault write was rejected` 是后者的典型用法）。
3. **先把身份记下来**：崩溃前读出 `taskId`（`runTaskId`/`toolTaskId`）或 `submissionId`，重开后用它重新定位对象——恢复测试的断言几乎都以「同一个 ID 的记录现在是什么状态」开头。
4. **先断言中间状态，再 resume**：例如 `harness-tasks-recovery.test.ts:129-133` 先断言 `pending` + checkpoint + memos，`harness-generation-recovery.test.ts:101-106` 先断言 checkpoint 里的 `phase`/`attempt`/`streamOptions`；`resume()` 之后才断言终局与 entry 序列。
5. **用计数证明幂等**：断言 `service.calls === 2` 而 `applied.size === 1`（`harness-tasks-recovery.test.ts:138-139`）、`state.runs` 的具体值（`harness-tools-recovery.test.ts:158`）、`summaryRequests` 的长度（`harness-compaction.test.ts:1636`）。只断言「没有抛错」无法区分「重跑一次」与「重跑两次」。

## 6.4 一致性套件与基准

这一节回答三个问题：一致性套件怎么接入（`registerStorageConformance`）、三种后端怎样被同一套断言覆盖（含「跨 reopen」加固）、基准脚本各自测什么以及它给出的是哪一档量级。23 个 case 的完整清单与它们分别证明的规则见 4.9.6；本节只讲怎么用它。

#### registerStorageConformance 的用法

签名（`src/testing/runner.ts:12-16`）：

```typescript
export function registerStorageConformance(
	runner: StorageConformanceRunner,          // { describe, expect, it }
	name: string,                              // suite 名
	withStorage: StorageConformanceProvider,   // (use) => Promise<void>
): void
```

最小用法只有一行：

```typescript
// test/memory-storage.test.ts:8
registerStorageConformance({ describe, expect, it }, "MemoryStorage", (use) => use(new MemoryStorage()));
```

要点：

1. 把 vitest 的 `describe`/`expect`/`it` 当作**值**传进去，不要依赖全局——契约源码不 import 任何 runner（`src/testing/assertions.ts:16` 的注释即为此）。
2. `withStorage` 每次调用要创建（或重开）一个存储，await 完 `use`，然后自己清理；清理放在 `finally` 里。
3. 同一条契约可以用不同的 `withStorage` 注册多次，得到不同的运行条件——仓库里就是「正常」与「每次提交后重开」两套（`test/sqlite-storage.test.ts:113,117`、`test/jsonl-storage.test.ts:123,125`）。
4. 用例数量固定为 23 个（`src/testing/storage-conformance.ts` 里 23 次 `createCase`）；接入新后端后某条失败，测试名就是那条语义的名字，不需要自己写断言。

#### 三种后端怎么跑同一套断言

| 后端 | 注册处 | `withStorage` 做什么 | 额外加固 |
| --- | --- | --- | --- |
| MemoryStorage | `test/memory-storage.test.ts:8` | `use(new MemoryStorage())` | 无（内存实现没有 reopen 概念）；另有 `:10-31` 断言 `prepareCommit` 不暴露内部状态 |
| SqliteStorage | `test/sqlite-storage.test.ts:113` / `:117` | 临时目录里的 `session.sqlite` | `:117` 用 `ReopeningStorage`：每次 `commit` 之后 `close` 再 `open`，让 23 个 case 都在「每次写都跨一次进程边界」的条件下重跑 |
| JsonlStorage | `test/jsonl-storage.test.ts:123` / `:125` | 临时目录 + `NodeExecutionEnv({ cwd: directory })` | 同上，`ReopeningStorage.commit` 在 `finally` 里关掉再打开 |

`ReopeningStorage` 的关键是「关闭后不再重开」，避免测试收尾阶段反复开关：

```typescript
// test/jsonl-storage.test.ts:69-77
	async commit(writes: readonly StorageWrite[], commitContext: Context): Promise<Seq> {
		if (this.closed) return this.current.commit(writes, commitContext);
		try {
			return await this.current.commit(writes, commitContext);
		} finally {
			await this.current.close(context);
			this.current = await JsonlStorage.open(this.directory, new NodeExecutionEnv({ cwd: this.directory }), context);
		}
	}
```

于是总用例数是 **23 × 5 = 115**（memory 注册 1 次、sqlite 2 次、jsonl 2 次）。这套装置同时回答「三种后端是否语义等价」：任何一个 case 在任一后端上失败，都说明该后端偏离契约，而不是测试写得不兼容。

要接入自有后端：实现 `Storage`（见 2.1 节），在自己的测试文件里 `import { registerStorageConformance } from "@earendil-works/pi-durable/testing"`，注册一次即可；若后端有持久化，建议像 sqlite/jsonl 那样再注册一次 «across reopen»。注意 `storage-conformance.ts` **不覆盖并发与崩溃恢复**（见 4.9.6 的 H 组），这两类语义要另写测试，可参考 `test/sqlite-facade.test.ts:124`（串行化并发事务）与 `test/jsonl-storage.test.ts:458`（在指定 append/flush 注入失败）。

#### 基准怎么跑

`package.json:80-83` 定义三个入口：

```bash
npm run bench:storage          # vitest bench --config vitest.benchmark.config.ts   → test/storage.bench.ts
npm run bench:storage:memory   # node --conditions=source --experimental-strip-types test/storage-memory.ts
npm run bench:tool-output      # node --conditions=source --experimental-strip-types --expose-gc test/tool-output-bench.ts
```

三者职责不同：

- `bench:storage`（`test/storage.bench.ts`，191 行）：vitest 的 `bench`，三后端 × 11 个读场景 + 3 个写场景，外加「reopen 后首次精确读」。它**先校验再计时**：读场景在计时前用 `strictEqual(await scenario.run(...), scenario.expected(...))` 过一遍（`:58-65`），写场景同样先跑一个 validation fixture（`:93`）。写场景会消耗存储，所以按迭代数预建 fixture 池（`:94-99`，`iterations + warmupIterations = 25` 个）。计时参数（`:21-23`）：读 `{ time: 300, iterations: 10, warmupTime: 75, warmupIterations: 3 }`，写 `{ time: 0, iterations: 20, warmupTime: 0, warmupIterations: 5 }`，reopen `{ time: 0, iterations: 20, warmupTime: 0, warmupIterations: 3 }`。
- `bench:storage:memory`（`test/storage-memory.ts`，238 行）：不是计时而是**占用测量**。driver 用 `execFile(process.execPath, ["--conditions=source","--expose-gc","--experimental-strip-types", workerPath, "--worker", backend, scale])` 为「后端 × 规模」各起一个子进程（`:185-197`），这样峰值 RSS 是各自的；worker 里 `collectGarbage()` 后取 baseline，seed 后再取一次，然后跑 10 轮全部读场景（第一轮校验结果、其余累计 checksum 防止被优化掉，`:142-150`），最后量磁盘（SQLite 读 `pragma_page_count`/`pragma_freelist_count` 并累加 `-wal`/`-shm`；JSONL 统计 `main.jsonl`、`auxiliaryBytes` 与 `doc-*.jsonl`/`task-*.jsonl` 文件数，`:79-118`、`:154-163`）。输出表格的列见 `:203-226`。
- `bench:tool-output`（`test/tool-output-bench.ts`，301 行）：驱动**真实**的工具任务、自适应节流与 `pi.live` 提交，测「输出洪泛时会话文件长多大、重放要多久、内存峰值多高」。每个场景同样在独立子进程里跑（`:73-80`）。

#### 基准测什么量级

**数据规模**（`src/testing/storage-benchmark.ts`）：`TIMING_SCALE` = 1000 entry / 300 task / 300 document；`STORAGE_MEMORY_SCALES` = `1k`（1000/200/200）与 `10k`（10000/2000/2000）。数据集还固定包含 4 条 replay 文档（tail = 0/16/128/1024）、1 条 256 次编辑的历史文档（中间插一个 base）、8 层 fork ×（1 conversation + 32 entry）。主记录数由 `storageBenchmarkPrimaryRecordCount` 给出：`1k` → `1 + 1000 + 200 + 200 + 4 + 1 + 8 × 33 = 1670`。

**工具输出场景**（`test/tool-output-bench.ts`）：三档速率 `low` = 1 行/200 ms；`normal` = 25 行/50 ms（注释标为 ~40 KB/s，像编译器或测试跑）；`high` = 800 行/0 ms（64 KiB 块，块间让出事件循环）（`:40-47`）。每个后端跑 3 速率 × 2 retain（`head`/`tail`）× 2 工具数（1/4），加 2 个 firehose（普通与 repetitive）、加一个 30 秒的长 run（仅持久后端）、加一个 `bash cat` 1 GiB 文件（`:57-70`）。固定文件在 `tmpdir()` 下的 `pi-durable-bench-1gib.txt`，按 64 MiB 块写、恰好在 1 GiB 处截断（`:94-110`）。指标字段见 `:112-125`：`ms`、`liveCommits`、`liveOpKiB`、`outputSets`、`commitP50Ms`/`commitP99Ms`、`midRoundKiB`、`replayMs`、`finalKiB`、`peakRssMiB`、`heapAfterGcMiB`——即「提交次数与字节数、提交延迟分位、中途关闭后的重放耗时、最终文件大小、内存峰值」。

**怎么读 tool-output 的输出**：`commitP50Ms`/`commitP99Ms` 是提交延迟分位，而 `commit` 被 `Proxy` 包了一层计时（`test/tool-output-bench.ts:261-278`），所以这个数字包含持久化时间，不是纯函数开销；`outputSets` 只统计「整串写 `["s", ["output", ...]]`」的次数，其余写是 append/trim（`:116-117`、`:203`），它的占比反映 Chord 重叠搜索的命中率——一次 tail 窗口滑动理想上只有 1 次前裁剪加 1 次追加，`outputSets` 高说明窗口频繁被整串重写；`midRoundKiB` 与 `finalKiB` 的差值是「round 的 base 落盘并回收后省下的体积」，也就是 delta 链被折叠的效果；`replayMs` 是 reopen 到 `snapshot(LiveDoc)` 完成的时间（`:219-223`），衡量崩溃后第一次拿到 live 视图的代价；`peakRssMiB` 与 `heapAfterGcMiB` 分别是进程峰值与 GC 后的堆（`:246-247`）。

**断言里的量级**（这些是仓库里**唯一**被固定下来的数字门槛，其余都是运行时打印的观测值）：

- `test/sqlite-storage.test.ts:511`：`walAutoCheckpointPages: 1` 时，20 次 32 KiB 提交后 WAL < 512 KiB；`:517` close 之后 WAL 必须为 0 字节。
- `test/sqlite-storage.test.ts:560-561`：回收后页数 `≤ pagesAfterDelete + 2` 且空闲页数下降（页被复用而不是无限增长）。
- `test/sqlite-storage.test.ts:615`：100 条 1 KiB entry 加一条 rewindable 文档的 100 次编辑之后，数据库文件 < 1 MiB。
- `test/harness-output.test.ts:206`：progress 提交的节流是「首个变更立即提交，之后至少 100 ms 且按已写字节 / 100 KiB/s 后退」；`:183`/`:195` 断言保留窗口的上界。
- `test/provider-session-cache-e2e.test.ts:112,118`：真实 Codex 请求 ≥4000 prompt tokens、缓存命中率 ≥0.9（需要凭据，否则 `it.skipIf` 跳过）。

#### 实测数据（本次运行：三个后端 × 1k 规模）

为了给出「量级」而不是「脚本长什么样」，本次在 `packages/durable` 下直接跑了内存测量脚本的 worker 模式：

```bash
node --conditions=source --experimental-strip-types --expose-gc test/storage-memory.ts --worker memory 1k
node --conditions=source --experimental-strip-types --expose-gc test/storage-memory.ts --worker sqlite 1k
node --conditions=source --experimental-strip-types --expose-gc test/storage-memory.ts --worker jsonl 1k
```

实测输出（原样引用，单位 bytes）：

```text
{"backend":"memory","scale":"1k","recordCount":1670,"baseline":{"heapUsed":9748648,"rss":86831104,"external":11574703},
 "postSeed":{"heapUsed":11188296,"rss":72671232,"external":11574743},
 "postRead":{"heapUsed":11362296,"rss":73658368,"external":11574743}}

{"backend":"sqlite","scale":"1k","recordCount":1670,"baseline":{"heapUsed":9763384,"rss":91951104,"external":11574903},
 "postSeed":{"heapUsed":10008232,"rss":69799936,"external":11574943},
 "postRead":{"heapUsed":10145744,"rss":73973760,"external":11574943},
 "disk":{"kind":"sqlite","mainBytes":638976,"auxiliaryBytes":4185760,"fileCount":3,"pageCount":167,"freelistCount":0}}

{"backend":"jsonl","scale":"1k","recordCount":1670,"baseline":{"heapUsed":9780200,"rss":85417984,"external":11574903},
 "postSeed":{"heapUsed":11441984,"rss":72511488,"external":11582935},
 "postRead":{"heapUsed":11598088,"rss":74985472,"external":11582935},
 "disk":{"kind":"jsonl","mainBytes":430987,"auxiliaryBytes":330430,"fileCount":340,"documentFiles":205,"taskFiles":134}}
```

读法与结论：

- `recordCount: 1670` 与公式一致（三个后端都一样），说明「主记录」口径是确定的。
- seed 之后的 heap 增量：memory ≈ 1,439,648 B（1.37 MiB，约 **862 B/主记录**）；sqlite ≈ 244,848 B（0.23 MiB，约 147 B/记录）；jsonl ≈ 1,661,784 B（1.58 MiB，约 **995 B/记录**）。随后的 10 轮读只再各涨 0.16–0.17 MiB。
- 磁盘：sqlite 主库 638,976 B（0.61 MiB，恰为 156 × 4 KiB 页），而 `pragma_page_count` 报 167 页——差的 11 页是快照时仍留在 WAL 里、尚未 checkpoint 回主库的页（快照发生在 `close` 之前，可对照 `test/sqlite-storage.test.ts:517` 的 close 后 WAL = 0）；`freelistCount 0` 说明此时没有空洞页。`-wal`/`-shm` 合计 4,185,760 B（≈3.99 MiB）。jsonl 主日志 430,987 B（0.41 MiB）、辅助 sidecar 合计 330,430 B（0.32 MiB），共 **340 个文件**（205 个 `doc-*`、134 个 `task-*`）——这正是「按文档/任务分 sidecar」这一设计的直接代价。
- 三行的 `rss` 都是**负增长**（postSeed < baseline），说明 `process.memoryUsage()` 的进程增量在 GC 之后并不可靠；脚本本身就标注了 values are process deltas, not limits（`:202`），引用这些数字时要保留这个限定。
- `[待核]: 本次未运行 bench:storage（vitest bench，三后端 × 11 读 + 3 写）与 bench:tool-output（会创建 1 GiB 临时文件并跑 20+ 子进程场景），仓库里也没有提交基准结果文件，因此这两组只有脚本参数与断言门槛，没有可引用的耗时或体积数字。`

---


# 第 7 部分：实战手册

日常查阅用：FAQ、陷阱清单、选型与部署、性能与调优、API 速查。

## 7.1 常见问题（FAQ）

**Q1：`context` 到底什么时候会取消我的操作？**
Chord 的 `context` 只控制**这一次调用**的取消（等待、IO 观察）。取消 `wait()` 不会停掉正在跑的生成；取消 `submit()` 之前会中断准入，但一旦进入存储结算就不再中断（`src/session/session.ts:427` 附近用 `withoutAbortSignal`）。停止工作要用 `conversation.abort()` / `harness.abortTask()`。

**Q2：我把 `wait()` 的 context 取消了，模型还在跑，输出会丢吗？**
不会。输出按 ≤100ms 窗口提交，存储里的进度完好。用 `harness.submission(id, ctx)` 重新拿句柄接着等即可。

**Q3：`Session` 和 `Harness` 用哪个？**
要跑 agent（调模型、工具、任务调度）→ `Harness.open()`。只想用持久化原语（账本、文档、任务记录）→ `createSession()`。`Harness` 本身就是 `Session`（API 超集）。

**Q4：任务什么情况下会自动跑？**
不会自动跑。必须由 `resume()` 或「要求进展」的调用启动：`submit()`、`wait()`、`waitForTask()`、`waitForIdle()`、`abort()`、`compact()`。纯读（`viewState`、`watchDoc`、`taskGraph`、`inspect`、`usage`）永远不启动。

**Q5：为什么我的任务重启后不动了？**
九成是注册表里没有它的代码。任务按 `kind`（定义里的 `name`）找回代码；找不到时保持 `pending` 且被视为 blocked。用 `harness.inspect()` 查，并确保启动时 `registry.install()` 了同名扩展。

**Q6：`replay: "safe"` 是不是加上就万事大吉？**
不是。它只是声明「允许重跑」。你还必须让 `execute` 幂等：`scanConversations({ ownerTaskId })` 复用已建对象、固定 `requestId` 防重复提交、副作用前写 memo（示例 `22` 的三件套）。

**Q7：busy 时 submit 会报错吗？**
默认不会——进 `pi.inbox` 排队。要报错得显式 `whenBusy: "reject"`（抛 `ConversationBusy`，且不产生任何写）。

**Q8：`write` 类型的提交会立刻写进转录吗？**
忙时不会立刻：它一样进 inbox，在下一个边界放置。别拿它做实时日志。

**Q9：怎么知道会话忙不忙？**
`docs["pi.live"].run !== undefined` 就是忙。也可以看事件流的 `run_start` / `run_end`。

**Q10：fork 之后改配置会互相影响吗？**
不会。`pi.agent` 是 `asOf` 型文档——fork 拿到 fork 点的副本，之后各自 `configure()` 各自独立（示例 `08`）。

**Q11：系统提示里能放当前时间吗？**
能，但每次渲染都不同 → 每次都追加 `pi.system` → prompt cache 失效。放动态信息前先想「能不能用差量」。

**Q12：一次响应里有多个工具调用，是并行还是串行？**
由 `settings.toolExecution` 决定。语义不变：一轮全部结束后才发起下一轮请求。

**Q13：哪里能看 token 花了多少？**
`docs["pi.usage"]`（单会话）或 `harness.usage(ctx)`（全 Session）。失败/中止的尝试也计数。

**Q14：两个进程能同时打开同一个 SQLite 吗？**
不要。「一个进程独占一份存储，没有跨进程锁」。多实例要自己实现单实例锁，或每进程一份存储。

**Q15：在提交回调里 `void tx.appendEntry(...)` 会怎样？**
整笔提交被拒：`settleSuccess` 发现还有未结算的异步操作，会 abort 所有 change 并抛 `"Session commit callback settled before its pending Tx operations"`。**规则：每个 `tx.*` 调用都要 await。**

**Q16：我能在提交回调里读刚写的数据吗？**
不能（`ReadAfterWrite`）。表读必须发生在第一次表写之前；文档访问不受此限制。要「先写后读」请拆成两笔提交。

**Q17：草稿能存到变量里下笔提交再改吗？**
不能。回调结束（`settleSuccess` 同步 prepare）时所有草稿被吊销，逃逸的 draft 读写都会抛错。

**Q18：`snapshot()` 会不会顺手创建文档？**
不会。只有 `tx.doc()` 创建；`snapshot` / `documentState` / `watchDoc` / `snapshotAsOf` 对缺席返回 `undefined`。

**Q19：任务文档在任务结束后还能读吗？**
不能。任务进入终态时它的 task 文档在同一批提交里退役。永久结果写 entry 或会话/ Session 文档。

**Q20：`abort()` 之后后台 subagent 为什么还活着？**
因为 `background: true` 是 abort 的边界。要中止它得用 `abort(ctx, { background: true })`。

**Q21：`waiting` 的任务占资源吗？**
不占。它在等待期间不跑代码；被唤醒后才重新占用调度。`completing` 才是「结果已定、等 owned 工作排空」。

**Q22：手动 `compact()` 会被 `settings.compaction.enabled = false` 影响吗？**
不会。`enabled` 只管自动阈值触发；手动压缩永远可用。

**Q23：两个压缩同时在飞会怎样？**
一个摘要若要切到「当前上下文起点之前」，放置时被判 `stale` 作废——**切得最靠后的生效**。

**Q24：`Harness.close()` 会丢未完成的工作吗？**
不会。它先 join 任务调用（`beforeClose`）、结算已准入的提交，再关存储；未完成的工作留在存储里等下次 `resume()`（示例 `13`、`23`）。

**Q25：怎么把 durable 接到我自己的 UI？**
用 `viewState()`（本地）或 `watch()`（远端 ops）或 `watchEvents()`（agent 事件）。三者都只消费已提交状态；迟到的客户端从当前快照开始，不需要重放。

**Q26：能不能把同一个会话跑在两个模型上（A/B）？**
可以：`fork()` 复制出另一条分支，各自 `configure()` 不同的 model。注意 `pi.provider`（provider 侧会话身份）会新建，所以对模型服务来说那是另一场对话。

**Q27：能不能不用 Node？**
能。`/storage/sqlite` 与 `/storage/jsonl` 是**可移植核心**（分别依赖一个异步 `SqliteDatabase` 外观与一个 `FileSystem`）；执行环境也可以自己实现。`/env/node` 与 `node:sqlite` 只是 Node 适配。

**Q28：为什么我的类型报错说「Document ... requires migration」？**
存储里的 `version` 比你的 defin
ition 旧，而定义没有 `migrate`。补一个 `migrate`，或把 `version` 调回一致（后者只在确实没有形状变化时才对）。

---

## 7.2 陷阱清单

按「踩了会花时间」排序；每条给出正确做法与证据位置。

| # | 陷阱 | 正确做法 / 证据 |
|---|---|---|
| 1 | 以为取消 `context` 会停止工作 | 取消的只是这次调用。停工作用 `conversation.abort()` / `harness.abortTask()`（0.3.1） |
| 2 | 一个进程开两次同一个 SQLite/JSONL | 「One process owns a storage at a time; there is no cross-process locking」（`README.md:529`）；JSONL 打开还会删掉 `.reclaim` 残片 |
| 3 | 提交回调里「先写表再读表」 | 抛 `ReadAfterWrite`（`src/session/transaction.ts:919-927`）。要读的行先读完 |
| 4 | 第二次 `root(ctx, { agent })` 想改配置 | 只在**首次创建**时生效；之后用 `configure()`（示例 `06`） |
| 5 | 把 `Conversation` 句柄当有状态对象缓存 | 句柄无状态；跨重启的唯一身份是 `id`（2.11.1） |
| 6 | 以为卸载扩展会清掉会话里的选择 | 存的是名字；装回来即生效（示例 `07`、`31`） |
| 7 | 重启后忘了重新 `install` 扩展 | 任务按名字找代码；缺定义 → `blocked` / `missing_task`，用 `harness.inspect()` 查（示例 `31`） |
| 8 | 给有副作用的工具漏了 `replay` 声明 | 默认 `unsafe`：崩溃中断的调用不会重跑，模型收到 `interrupted` 结果（2.16.4） |
| 9 | 以为 `replay: "safe"` 就安全 | 它只声明「可重跑」；执行体必须幂等，还要配 `scanConversations` + 固定 `requestId`（示例 `22`） |
| 10 | 拿 provider 原始流当 UI 数据 | UI 读 `pi.live` 的已提交片段；节流窗口 ≤100ms，慢 watch 100 帧折叠（示例 `16`、`21`） |
| 11 | section 输出不稳定（时间戳、随机数） | 每次不一样 → 每次追加 `pi.system` → prompt cache 失效（2.14.3） |
| 12 | 以为 busy 时的 `write` 会立刻写 | write 一样进 `pi.inbox`，在下一个边界放置（示例 `20`） |
| 13 | 以为 run 失败后队列会清空 | 剩余项留在 inbox，等下一次提交按最旧优先放出（2.9.6） |
| 14 | 用 `entries()` 第一条当「最新用户消息」 | 它是最新 entry；顺序是**最新在前**，且可能不是用户消息（示例 `09`、`17`） |
| 15 | 在 `env` 回调之外缓存 `ExecutionEnv` | 环境按每次使用构建；cwd 变化能影响已发出的调用（示例 `26`、`29`） |
| 16 | 用普通 `abort()` 想停后台 subagent | `background: true` 是边界，必须 `abort(ctx, { background: true })`（示例 `23`） |
| 17 | 把 `waiting` 当成「还占资源」 | 等待期不跑代码；`completing` 才是等 owned 工作排空（示例 `24`） |
| 18 | 以为手动压缩受 `compaction.enabled` 影响 | 手动 `compact()` 总是可用（2.11.2） |
| 19 | 并发压缩互相覆盖 | 落入当前上下文起点之前的摘要判 `stale`，切得最靠后的生效（3.4） |
| 20 | 以为 fork 会复制父的最新文档 | 看文档的 `fork`：`initial` / `current` / `asOf`；`pi.agent` 是 `asOf`（示例 `02`、`08`） |
| 21 | 忽略工具输出的上限 | 默认尾部 2000 行 / 50KB，超出落盘并在 diagnostic 给出路径（`src/truncate.ts`） |
| 22 | 担心只读观察会启动调度 | 不会。`watchDoc`/`viewState`/`watchEvents`/`taskGraph`/`inspect` 都是纯读 |
| 23 | `close()` 会不会弄丢没干完的工作 | 不会。先 join 任务调用、结算已准入提交，再关存储（2.2.7） |
| 24 | 提交回调里不 await `tx.*` | 整笔提交被拒：`"…settled before its pending Tx operations"`（2.3.4） |
| 25 | 把草稿（draft）存起来跨提交使用 | 回调结束草稿全部吊销；逃逸的 draft 读写抛错（2.3.4） |
| 26 | 以为 `snapshot()` 会创建文档 | 只有 `tx.doc()` 创建（2.5.4） |
| 27 | 对 `history: "latest"` 的文档调 `snapshotAsOf` | 类型层就报错；历史读需要 `rewindable`（2.5.2） |
| 28 | 以为 `document(id, at)` 会跟随地址替换 | 它只看**一个化身**；要地址最新先用 `findDocument`（2.1.4） |
| 29 | 把 `Cursor` 跨查询/跨存储复用 | 游标是后端私有、只能原样回传给同一次 scan（2.1.4） |
| 30 | 把普通存储错误当成 `StorageRejected` | 只有确定「什么都没提交」才是 `StorageRejected`；其它错误会毒化 Session，必须重开（2.1.6） |
| 31 | 退役后再 `tx.doc()` 以为是同一个化身 | 是**新化身、新 DocumentId**；旧 watch/state 不会跟随（2.5.6） |
| 32 | 忘了「create + retire 同批」是空生命周期 | 两个时间点盖同一个 `Seq`；任务文档的「建了就退役」就是这样（2.3.5） |
| 33 | `migrate` 里做副作用 | 迁移必须是纯函数；它可能被多次调用且不落盘（2.5.5） |
| 34 | 指望 `checkpointWhen` 每次都调用 | 只对 delta、只判定一次、只在装配最后一步（2.5.8） |
| 35 | 让 delta 跨存储版本边界 | 版本变了必须写 base，否则后端报「version transition requires a base」 |
| 36 | 在 fork 事务里改父会话的当前值文档 | 被拒：`"Cannot fork conversation … while changing its current-policy documents"`（2.3.8） |
| 37 | 给子任务加 `background: true` | 直接 `TypeError`：只有 conversation-owned 任务能是 background（2.7.3） |
| 38 | 建子任务时给了别的会话 id | `"A child task lives in its owner's conversation …"`：子任务必须与 owner 同会话 |
| 39 | 以为撤回排队提交能撤销已放置的输入 | `submission.abort()` 对 `placed` 返回 `already_placed`（2.9.6） |
| 40 | 以为 write 提交也能被「回答」 | write 永远不带 `answer`；只有 `placed` 的 input 能被回答 |
| 41 | phase 结束不提交状态 | 任务被判 `faulted`（2.8.8） |
| 42 | abort 处理器不提交终态 | 同样 `faulted`；abort 处理器必须提交 `aborted`/`completed`/`failed`（2.7.6） |
| 43 | 把「做过没」记在普通变量里 | 重跑时丢失 → 副作用重复；用 `runtime.memo` 或检查点（示例 `13`） |
| 44 | 以为 `abortRequested` 只在本进程有效 | 它在存储里；重启后仍会生效（2.8.7） |
| 45 | 在 `pi.system` 里塞内容文本 | 那个 entry 的 `content` 恒为 `""`，一切内容都走命名 section（2.4.3） |
| 46 | 以为 head 标记本身是上下文起点 | `findLatestHeadMarker` 返回标记；真正的下界是它的 `head` 字段（2.1.4） |
| 47 | 以为 fork 能看见父会话后续的 entry | 不可见：可见性只在祖先链内（2.1.4） |
| 48 | 大对象/长日志塞进文档 | 文档每次变更都写 delta（可能整段替换）；大输出用工具输出窗口 + 截断落盘（`src/truncate.ts`） |
| 49 | 在 section/工具里等人类输入 | 会把 run 卡住并把任务拖在 `running`；把「问」和「答」拆成两次提交（3.7.8） |
| 50 | 只想用存储却从包根导入 | 包根会加载 TypeBox（未打包峰值 RSS 约 +23MB，tree-shaken 约 4MB）；按子路径导入（0.5.2） |

---

---

## 7.3 选型与部署

这一节回答四个部署问题：用哪个后端；为什么不能两个进程同时打开同一份存储；WAL + `synchronous = NORMAL` 到底承诺了什么；以及把 Harness 搬出 Node（Bun、Cloudflare Durable Objects、你自己的运行时）时需要做什么。最后给出一份「自定义存储适配器」的接入清单。

### 7.3.1 三种后端的定位

| 后端 | 导入路径 | 持久化 | 一句话定位 |
| --- | --- | --- | --- |
| Memory | 包根 `MemoryStorage`（也可 `./storage/memory`） | 无 | 参考语义实现：一致性套件以它为准，用来做测试与「不需要持久化」的工具 |
| SQLite | `./storage/sqlite/node` 的 `openNodeSqliteStorage(file)` | 一个数据库文件（外加 `-wal`/`-shm`） | 生产默认：单文件、索引化查询、崩溃安全由 SQLite 的 WAL 提供 |
| JSONL | `./storage/jsonl/node` 的 `openNodeJsonlStorage(directory, context)` | 一个目录的追加式文件 | 可读、可拷、可移植：每笔提交一行 marker，文档/任务各有 sidecar |

README 的描述与上表一一对应（`README.md:523-527`），后文所有细节都来自源码与测试。

### 7.3.2 对照：崩溃语义、fsync、文件布局、可观测性

| 维度 | Memory | SQLite（`node:sqlite` 适配器） | JSONL |
| --- | --- | --- | --- |
| 原子单元 | 内存 `prepareCommit` + 幂等 `apply()` | 一个 `BEGIN IMMEDIATE` … `COMMIT` | 三步协议：追加全部 sidecar → 追加 main marker → 在内存发布 |
| 进程崩溃 | 全部丢失（无持久化） | 已提交事务存活 | 已确认的尾部提交可能消失，但**幸存 marker 不会越过它的 sidecar 数据** |
| 掉电 / 宿主故障 | 不适用 | **可能丢失最后若干笔已提交事务**（`synchronous = NORMAL`） | 默认不承诺（`fsync: false`）；`fsync: true` 后 sidecar 先落盘，但普通发布仍不 flush `main.jsonl` |
| flush 代价 | 无 | SQLite 内部按 NORMAL 档（不是每笔 fsync WAL） | `fsync: true` 时**每笔提交** flush 每个受影响的 sidecar（`src/storage/jsonl/storage.ts:294-299`） |
| 文件布局 | 无 | `<file>` + `<file>-wal` + `<file>-shm`（共 3 个） | `<dir>/main.jsonl` + `doc-<id>.jsonl` + `task-<id>.jsonl`（+ 回收临时文件 `.reclaim`） |
| 提交内容 | 内存索引与 `nextSeq` | 5 张记录表 + `documents` + `document_revisions` + `record_ids` + `durable_metadata` | 受影响的 sidecar 追加 + main 一行 marker |
| 读实现 | 内存索引 | 索引化 SQL（查询计划被测试固定） | **全量 replay 进 `MemoryStorage`** 后走内存索引 |
| 内存特征 | 与数据量成正比（参考语义） | 记录不驻留内存，只有 prepared statement 与少量状态 | 与 Memory 同量级——打开时把整个目录重建成内存索引 |
| 启动代价 | 无 | 迁移检查 + 读 metadata（O(1)） | 解析并 replay 整个 `main.jsonl`（随历史增长） |
| 可观测性 | 无文件 | `pragma_page_count` / `pragma_freelist_count` / WAL 大小都可查 | 直接读文本文件；文件数与 sidecar 数量可统计 |
| 多进程 | 不适用 | SQLite 文件锁 + `busyTimeoutMs`（默认 5000 ms），但仓库**不承诺**多进程用法 | 目录独占，无锁（见 7.3.4） |
| 适合 | 测试、一次性脚本、只读回放 | 长期运行的服务与 CLI | 需要「能看懂、能 rsync、能给别的语言读」的部署 |

### 7.3.3 怎么选

- **要持久化、要长期跑、要查询快**：SQLite。它是唯一有索引、有事务、有 WAL 的后端；`test/sqlite-storage.test.ts:383-439` 用查询计划断言把「不许全表扫」钉住了。
- **要可观测、可迁移、可被人肉检查**：JSONL。代价是**打开时全量 replay**（时间与内存都随历史线性增长）和**目录里文件数随文档/任务增长**。6.4 节的实测里，1k 规模（1670 条主记录）的 JSONL 目录是 **340 个文件**（205 个 `doc-*`、134 个 `task-*`），heap 增量约 **995 B/主记录**。
- **只跑测试或做一次性转换**：Memory。它与 SQLite/JSONL 跑同一套 23 个一致性用例，因此「在 Memory 上通过」不代表「在磁盘上也通过」——并发与崩溃语义不在那 23 个用例里（见 7.3.8）。
- **不要**用 JSONL 当高频写入的持久层：每笔提交都要 `append` 到每个受影响文件；`fsync: true` 会把这个代价乘以「每笔提交的 sidecar 数」。
- **不要**用 Memory 当「临时缓存」拼在其他后端前面：Harness 的一次运行只有一个 `Storage`，没有分层缓存的概念。

#### 一次决策树

```text
需要跨进程/跨机器共享同一份数据吗？
  需要 → 不要共享存储：收敛到一个进程（7.3.4）
  不需要 ↓
数据会长期增长、需要按 ID/全文范围查询、需要崩溃安全吗？
  是 → SQLite
  否 ↓
会有人（或别的语言）直接读这些文件，或需要 rsync/归档吗？
  是 → JSONL（接受打开时全量 replay 与数百个 sidecar）
  否 → Memory（仅测试/一次性进程）
```

#### 一份可复制的部署骨架

```typescript
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
// JSONL 换这一行：import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";

const context = BACKGROUND_CONTEXT;

// 1) 打开存储：SQLite 的两个旋钮都是可选参数（默认 1000 页 / 5000 ms）
const storage = await openNodeSqliteStorage("./data/session.sqlite", {
	walAutoCheckpointPages: 1_000,
	busyTimeoutMs: 5_000,
});
// const storage = await openNodeJsonlStorage("./data/session", context, { fsync: false });

// 2) 开 Harness：models 与 registry 是必填；settings 是活对象，可随时替换
const models = createModels();
models.setProvider(/* 例如 openaiProvider()；见 README 的 Quick Start */);
const harness = await Harness.open(
	storage,
	{
		models,
		registry: createRegistry(),
		settings: { toolExecution: "sequential", compaction: { backgroundTokens: 0 } },
		env: ({ cwd }) => envFor(cwd), // 每次调用都会执行，缓存你自己的环境实例
	},
	context,
);

// 3) 取根会话并启用调度（submit/wait 也会顺带启用）
const root = await harness.root(context, {
	agent: { model: { provider: "openai", modelId: "gpt-6-sol" }, cwd: process.cwd() },
});
harness.resume();

// 4) 正常收尾：先等工作空，再关；close 会 join 在跑的任务
await harness.waitForIdle(context);
await harness.close(context);
```

要点：`Harness.open()` 会校验注册表是否含全部内建任务（缺了直接抛错），`env` 是**每次使用**都重新构造的函数（所以示例里按目录缓存），而 `close()` 的顺序与原因见 7.3.6。

### 7.3.4 单进程所有权与「多实例怎么办」

README 的规则一句话：**同一时刻一个 Storage 由一个进程拥有，没有跨进程锁**（`README.md:529`）。代码里的证据：

- JSONL 的 `open()` 会**无条件删除**目录里看到的 `.reclaim` 残片，并假定整个目录归自己（`src/storage/jsonl/storage.ts:259-275` 的 `recover()` 里做这三件事：删残片、截断撕裂尾行、回收）。两个进程同时打开同一目录，会互相破坏回收结果。
- SQLite 的 `NodeSqliteDatabase` 用一个串行队列把「同一连接上的所有语句」排成一条线（`src/storage/sqlite/node.ts:23-70`、`:140-159`），同一时刻只有一条 SQL 在执行；跨进程只剩 SQLite 自己的文件锁 + `busyTimeoutMs`（`src/storage/sqlite/node.ts:9-17`）。仓库没有任何多进程协作的测试或文档承诺。

实践建议（按代价从低到高）：

1. **一台机器一个进程**：默认部署形态。进程退出即释放。
2. **要并行**：让多个进程各自用**不同的**存储文件/目录，而不是共享一个。会话本身就是隔离单位：每个会话有自己的文档、任务与 `pi.provider` 身份，可以在不同进程里分别打开各自的库。
3. **要共享**：把访问收敛到一个进程（一个常驻服务持有 Storage，其它进程通过你自己的 RPC 调它）。不要试图用 SQLite 的 `busyTimeoutMs` 当分布式协调：它只解决「短暂的文件锁竞争」，而 `mintId` 的取号是**内存态**（`test/storage-env-tools` 笔记 §25 第 9 条已标注：两个 `SqliteStorage` 实例同开一个文件可能取到重复号）。
4. **要迁移/备份**：按 7.3.6 的步骤做「停写 → 关库 → 拷贝」。

#### 部署前检查清单

- [ ] **只有一个进程打开这份存储**；文件/目录的写权限只给这个进程（7.3.4）。
- [ ] SQLite：确认磁盘能容纳「主库 + WAL + shm」三份之和；关库后 WAL 会归零，但在线期间它可能存在。
- [ ] SQLite：确认 `walAutoCheckpointPages` 与你的写入密度匹配（默认 1000 页）；如果设 0，你自己要有 checkpoint 计划。
- [ ] JSONL：确认目录不会被 rsync/备份工具在写入中途快照；备份按目录级做。
- [ ] JSONL：确认 `fsync` 取舍写进文档——默认只保进程崩溃，开了仍不 flush `main.jsonl`。
- [ ] 确认进程会调用 `harness.close()`（或至少 `storage.close()`），否则 SQLite 的 WAL 不会被截断、JSONL 的回收不会被触发。
- [ ] 确认崩溃后的启动路径是「重新 `Harness.open()`」，而不是复用旧句柄：Session 在「存储准入之后提交失败」时会 poison，之后每个操作都抛「Session is poisoned … reopen it」（`src/session/session.ts:543-549`）。
- [ ] SQLite：如果程序会被升级回滚，确认旧版本能接受新 schema（旧程序遇到更新的 `durable_schema` 会**拒绝打开**，`src/storage/sqlite/migrations.ts:114-118`）。
- [ ] 给工具输出设置合适的上限（默认 2000 行 / 50 KiB，见 7.4.5），避免某个话多的工具把每笔提交撑大。
- [ ] 观测项落地：提交次数、每笔 ops 字节数、watch 的待投递量（见 7.4.7 的「怎么量你自己的部署」）。

### 7.3.5 WAL 与 `synchronous = NORMAL` 的实际含义

`openNodeSqliteDatabase()` 在打开后执行三条 PRAGMA（`src/storage/sqlite/node.ts:186-193`）：

```text
PRAGMA journal_mode = WAL
PRAGMA synchronous = NORMAL
PRAGMA wal_autocheckpoint = <walAutoCheckpointPages ?? 1000>   // 0 = 关闭自动 checkpoint
```

- **WAL 让「读」和「写」不互相阻塞**：已提交事务先落在 `-wal` 文件里，checkpoint 时才合并回主库。因此任何时候的磁盘占用是「主库 + WAL + shm」三份之和，而不是单文件大小。
- **`synchronous = NORMAL` 的含义**：提交不需要每笔都把 WAL fsync 到盘。它换来的是：
  - **进程崩溃（kill、panic、`process.exit`）不丢、也不损坏已提交数据**——因为进程没死时 WAL 内容已经写进内核页缓存，操作系统仍然持有；
  - **掉电 / 宿主故障 / 内核崩溃可能丢掉最后若干笔已提交事务**——README 的措辞是「commits survive process crashes; the newest may be lost on power or host failure」（`README.md:526`）；
  - 它**不会**把「已提交」变成「未提交」以外的东西：不会出现半笔事务、不会出现索引与 JSON 记录不一致（SQL 事务本身就是原子的）。
- **checkpoint 时机**：`wal_autocheckpoint`（默认 1000 页）触发自动 checkpoint；`close()` 会显式执行 `PRAGMA wal_checkpoint(TRUNCATE)` 再关连接（`src/storage/sqlite/node.ts:161-172`），因此**正常关闭之后 WAL 归零**。测试固定了这两点：`walAutoCheckpointPages: 1` 时 20 笔 32 KiB 提交后 WAL < 512 KiB，且 `close()` 之后 WAL 必须为 0 字节（`test/sqlite-storage.test.ts:493-521`）。
- **调 `walAutoCheckpointPages` 的方向**：调小 → WAL 更小、主库更热、checkpoint 更频繁（写放大与延迟尖峰）；调大 → 提交更快、WAL 更大、崩溃后恢复要 replay 更多页；`0` 关闭自动 checkpoint，只在你**自己**安排了 checkpoint 时机时使用（例如低峰期手动 `PRAGMA wal_checkpoint`）。
- **JSONL 的对应旋钮**只有布尔 `fsync`（`src/storage/jsonl/storage.ts:76-79`）：默认 `false`（只承诺普通进程崩溃一致），`true` 时「先 flush 每个 sidecar，再写 marker」（`:290-301`）。注意两个已知边界：普通发布**不 flush `main.jsonl`**；回收之前会先 flush 一次 main（`:507-514`），且回收是「marker 已发布」之后的最佳努力维护（注释原文：`The marker already published this state, so reclamation is retryable best-effort maintenance.`）。

#### 故障模式速查

| 故障 | Memory | SQLite | JSONL |
| --- | --- | --- | --- |
| 进程被 kill / panic | 全丢 | **已提交存活**（WAL 已在页缓存） | 已确认的尾部提交可能消失；幸存 marker 不越过其 sidecar 数据 |
| 掉电 / 内核崩溃 / 宿主故障 | 不适用 | **可能丢最后若干笔已提交事务**（NORMAL 档） | 默认不承诺；`fsync: true` 只保证 sidecar 先于 marker 落盘，main 仍未 flush |
| 磁盘满 / 写入 EIO | 不适用 | 事务回滚（`src/storage/sqlite/node.ts:149-157` 的 ROLLBACK 路径）；回滚也失败会抛 `AggregateError` | `append` 失败即 **poison**，之后必须重开（`src/storage/jsonl/storage.ts:290-301` 的三处 `poison(...)`） |
| 只读文件系统 / 权限不足 | 不适用 | 打开失败：`mkdir`、PRAGMA 配置或迁移任一步失败都会让 `open()` 抛错，并尽力关掉连接（`src/storage/sqlite/node.ts:186-201`） | 打开失败：`createDir` 失败即抛（`src/storage/jsonl/storage.ts:266-269`） |
| 数据文件被外部改写 | 不适用 | 缺 `durable_metadata` → 打开抛 `Durable SQLite metadata is missing`（`test/sqlite-storage.test.ts:193-204`） | 缺必需的已确认记录、marker 序列不严格递增 → `JsonlCorruptionError`（`src/storage/jsonl/storage.ts:541-545`） |
| 提交失败但结果不明 | 不适用 | Session 可能被 **poison**，必须重开（`src/session/session.ts:543-549`） | 同上（poison 由 Session 决定，与后端无关） |
| 两个进程同时打开 | 不适用 | 有文件锁与 busy timeout，但**无承诺、无测试** | 目录独占、无锁；`open()` 会删掉别的进程写的 `.reclaim` 残片 |

一句话总结：**进程崩溃是两种持久后端都覆盖的故障；掉电只保证「不坏」，不保证「不丢最后一笔」。** 需要更强保证，只能换更强的持久层（例如自己在 SQLite 上开 `synchronous = FULL` 的适配器），JSONL 侧则没有对应开关。

### 7.3.6 备份、迁移与关闭顺序

**关闭顺序**（`Harness.close()` → `Session.close()`）：

```text
Harness.close(context)
  1. HarnessImpl.#closed = true                       // 之后的 root()/conversation()/... 直接抛 "Harness is closed"
  Session.close(context)
  2. 同步封盘：this.#closing 被赋值 → 之后一切操作抛 "Session is closed"
  3. 同步通知 close listeners：view/task-graph/event 流的 state 与 watch 进入终态
  4. beforeClose()  →  HarnessImpl: await tasks.join()  // 等在跑的 task invocation 结束
  5. 在会话线上：清 commit listeners、清文档缓存、storage.close()
```

对应代码：`src/harness/harness.ts:322-330`（`#closed` 与 `beforeClose` 的 join）、`src/session/session.ts:350-368`（封盘 → `beforeClose()` → `enqueue` 里清监听与缓存后关存储）、`src/session/session.ts:378-381`（`beforeClose` 的注释：在封盘之后、关存储之前运行，且**不得 reject**）。

为什么必须先 join 任务再关存储：**已受理的工作要先结算**（`session.ts:353` 的注释原文：`admitted work settles before Storage closes`）。一个正在提交检查点的 task 如果撞上已关闭的 Storage，要么把状态写丢、要么把错误散布到恢复路径；所以关闭把「拒绝新操作」与「等旧操作」分成两步：第 2 步立刻拒绝，第 4 步等干净。`close(context)` 返回的是 `awaitWithContext(this.#closing, context)`（`session.ts:367`），因此**取消调用方的 context 只取消这次等待**，不会中断关闭本身。

**备份**：

- SQLite：正确做法是**先关闭存储再拷贝单个文件**——`close()` 里的 `wal_checkpoint(TRUNCATE)` 会把 WAL 合并回主库（`test/sqlite-storage.test.ts:517` 断言 WAL 归零），此时主库自洽。仓库里的基准就是这么拷贝的：seed 存储 `close()` 之后才 `copyFile`（`test/storage.bench.ts:140-142`、`:129-132`）。如果必须在线拷贝，就要把 `<file>`、`<file>-wal`、`<file>-shm` **三个一起**拷，并且不能只拷其中一个。
- JSONL：备份就是拷**整个目录**（`test/storage.bench.ts:129-132` 用 `cp(source, destination, { recursive: true })`）。打开时残留的 `.reclaim` 会被删掉，所以不必单独处理它们；但要保证「拷贝期间没有进程在写」，否则 `main.jsonl` 会领先或落后于 sidecar。
- 两种后端都**没有**压缩命令：`main.jsonl` 永不压缩（spec 明确），SQLite 只靠 `pragma_freelist_count` 反映的空洞页复用（`test/sqlite-storage.test.ts:523-565` 断言回收后页数增长 ≤ 2）。

**迁移（schema / 格式）**：

- SQLite 侧有真正的迁移表：`applySqliteMigrations()` 要求迁移版本从 1 连续递增，在一个事务里建 `durable_schema`、读出当前版本、逐个执行未应用的迁移；**读到比代码支持的版本更新时直接拒绝**（`src/storage/sqlite/migrations.ts:95-125`）。因此「新版本程序读旧库」是安全的，「旧程序读新库」会明确失败而不是悄悄写坏。
- JSONL 侧用格式版本号：每行 marker/record 都带 `format: 1`（`src/storage/jsonl/storage.ts:42-59`），格式不匹配属于损坏路径而不是兼容路径。
- **文档形状**的迁移与两者都无关：那是 `DocDefinition.version` + `migrate(value, fromVersion)`（`src/types.ts:69-78`），由 `Document`/task 的 checkpoint 机制驱动（见 2.5 节）。

#### 把一个后端的数据搬到另一个后端

仓库里**没有**内置转换器，但用公共 `Storage` 契约可以自己写一个，因为每条记录都带显式 ID：

```text
1. 停写源库（7.3.4）→ 打开源与目标两个 Storage
2. conversation：scanConversations（升序游标）→ commit([{ type: "conversation", value }])
3. entry：scanEntries 逐会话翻页 → commit([{ type: "entry", value }])   // value 就是 EntryRecord
4. task：scanTasks（可以不带状态过滤扫全量，也可以按 5 个状态各扫一遍）
        → commit([{ type: "task", value }])                              // 终态 task 也要搬，恢复要靠它
5. submission：scanSubmissions → commit([{ type: "submission", value }])
6. document：findDocument(address, "current") 拿 record（kind/scope/key/history/fork）
             → document(id, "current") 拿物化值 { value, version, deltasSinceBase }
             → 在目标写 [{ type: "document.create", record, content: { kind: "base", version, value } }]
7. 每 100 条一批提交（`src/testing/storage-benchmark.ts:95-111` 的 seed 就是这么做的），
   写完关两个 Storage
```

会变形的地方（写进你的迁移说明）：

- **文档只会得到一条 base**：源里的 base/delta 链形状不可搬（那是后端私有格式），目标历史点读出来的值仍正确，但 `deltasSinceBase` 从 0 开始。
- **`Seq` 与游标不可跨后端**：不要试图保留提交号或游标；按 ID 顺序重建即可。
- **`record_ids` 的全局归属**：条目 ID 是全局唯一的，写入顺序不影响正确性，但显式 ID 必须原样带上（`StorageWrite` 的记录里就有 `id`）。
- 目标后端的选择决定这次搬迁的收益：JSONL → SQLite 会消掉「打开时全量 replay」和「数百个 sidecar 文件」；反向搬迁会把这些代价带回来（7.3.2）。

### 7.3.7 非 Node 环境：可移植核心

包把「可移植核心」与「运行时适配器」拆成不同的入口（`package.json:8-70`）：

| 入口 | 内容 | 运行时依赖 |
| --- | --- | --- |
| `.` | 包根：Harness、Session、文档、工具任务校验 | 会加载 TypeBox（README：非打包峰值 RSS 约 23 MB，tree-shaken 约 4 MB，`README.md:556`） |
| `./storage/sqlite` | 便携 SQLite 实现 + 迁移 + `SqliteDatabase` 门面 | 无 `node:`（`test/storage-runtime-boundary.test.ts:33-36` 断言 import 图里不出现 `node.ts`） |
| `./storage/sqlite/node` | `node:sqlite` 适配器与 `openNodeSqliteStorage()` | Node 内置 `node:sqlite` |
| `./storage/jsonl` | 追加式后端核心，接受一个 `FileSystem` | 无 `node:` |
| `./storage/jsonl/node` | 用 `NodeExecutionEnv` 提供 `FileSystem` 的打开器 | Node |
| `./env` / `./env/node` | 执行环境能力接口 / Node 实现 | 前者可移植 |
| `./tools` | `read`/`write`/`edit`/`bash` 与 `CodingTools` | 取决于各工具 |
| `./testing` | 一致性套件与基准装置 | 无（断言由调用方的 runner 提供） |

在 Bun / Cloudflare Durable Objects / 其他运行时里用可移植核心，需要提供两样东西之一：

- **SQLite**：实现 `SqliteDatabase` 门面。README 给出的适配器契约（`README.md:531`）是：`exec`、`run`、`get`、`all`、`transaction`、`close` 都返回 promise；`run`/`get`/`all` 接 SQL 文本加**位置绑定**；适配器可以按 SQL 文本缓存 prepared statement（Node 适配器就是这样做的，见 7.4.6）；`transaction(callback)` 传进来的句柄在回调 settle 后失效；**适配器必须把无关操作与其它事务排在当前事务之后**——因此「在事务回调里直接调用 `database` 本身」永远不会 settle（README 原文）。
- **JSONL**：提供一个 `FileSystem`（来自 `./env`）。`JsonlStorage.open(directory, fs, context, options)` 只用到 `absolutePath`、`createDir`、`joinPath`、`appendFile`、`readFile`/`readLines`、`writeFile`、`flushFile`、`renameFile`、`remove` 这些能力（`src/storage/jsonl/storage.ts:259-275`、`:516-532`）。

### 7.3.8 自定义存储适配器清单

**第一步：实现 `Storage` 接口**（`src/types.ts:993-1085`，17 个成员——`entry` 是两个重载；下表按契约分组，12 行覆盖全部）：

| 方法 | 契约要点 |
| --- | --- |
| `commit(writes, context): Promise<Seq>` | 一笔批次原子生效；resolve 之后**通过本 storage 的后续读必须能观察到它**；返回的 `Seq` 严格递增 |
| `mintId<I>()` | 从**全局唯一**数值命名空间取号；可以跳号；ID 1 保留给根会话 |
| `conversation` / `scanConversations` | 精确查 + 升序游标扫描（owner 过滤是合取过滤，见下） |
| `entry(id)` / `entry(conversationId, id)` | 单参返回记录与 `commitSeq`；双参只在「经该会话祖先链可见」时返回 |
| `findLatestHeadMarker(conversationId, atOrBefore, context)` | 返回「在含式截止以下最新的带 `head` 可见 entry」 |
| `scanEntries(query, limit, cursor, context)` | **最新优先**、含式区间、应用全部祖先 cap；`limit` 是最大页大小 |
| `task` / `scanTasks` | task 记录是**整条替换**；过滤条件是合取 |
| `submission` / `scanSubmissions` / `submissionByRequest` | `requestId` 的唯一性作用域是**会话内** |
| `findDocument(address, at, context)` | 按 `kind`+scope+key 解析「该点占位的 incarnation」；`at` 是 `"current"` 或数值 |
| `document(id, at, context)` | 物化**特定** incarnation，不跟随同地址替换；返回 detached 值、定义版本、`deltasSinceBase` |
| `scanDocuments(query, limit, cursor, context)` | 只枚举某 scope 在该点**存活**的 incarnation，升序 |
| `close(context)` | 释放资源；此后一切操作必须 reject |

**第二步：满足这些语义（不是可选项）**：

- **原子性**：任何失败都必须让整笔批次无效，且不得留下二级索引的残影（一致性套件里有专门的「文档命令失败要回滚记录表 + 二级索引」用例）。
- **值隔离**：提交参数在 `commit()` settle 前是借用的，settle 后保留的任何东西必须先 detach；**每次读都必须返回 detached JSON**，且要防原型污染（`__proto__`/`constructor` 这类键必须当作普通数据）。
- **游标**：后端自有、可 `JSON.parse(JSON.stringify())` 往返；只允许同一个 scan + 同一个 storage 内使用；游标是「位置」不是「快照」——期间的新提交不插队。
- **文档语义**：base + 有序 delta 尾；delta 不得跨 `version` 边界（换版本必须用 base）；current-only 文档只在「已提交的 base 或退休」之后回收；`document.copy` 必须落一份**独立的完整 base**（复制值而不是引用），且源在同批次被改要拒绝。
- **索引字符串无损**：`kind`、`requestId`、文档 key 这些被索引的字符串不能用规范化或拼接的方式编码——SQLite 实现用 `JSON.stringify` 编码索引列就是为了让孤立代理项（lone surrogate）保持不同身份，套件里有专门用例。
- **关闭**：`close()` 幂等，之后所有操作（含空 `commit([])` 与 `mintId`）都抛含 `"closed"` 的错误。

**第三步：接一致性套件**（三步，`README.md:540-554`）：

```typescript
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { describe, expect, it } from "vitest";

registerStorageConformance({ describe, expect, it }, "My Storage", async (use) => {
	const storage = await openMyStorage();
	try {
		await use(storage);
	} finally {
		await closeMyStorage(storage);
	}
});
```

套件本体是 `src/testing/storage-conformance.ts` 的 **23 个 case**（身份与根会话、事务原子性、值隔离、顺序/游标/分页、task/submission 表、文档基准+增量+历史、索引字符串身份），细节与逐条清单见 4.9.6。

**必须补的两类测试**：这 23 个 case **不覆盖并发与崩溃可重入**（4.9.6 已给出结论）。要证明这两类语义，参照仓库里的做法：

- 并发/串行化 → 仿 `test/sqlite-facade.test.ts`（活跃事务期间的排队、读一致性）。
- 崩溃/重入 → 仿 `test/jsonl-storage.test.ts`（撕裂尾行截断、未确认追加丢弃、注入 append/flush 失败后只恢复已确认状态）与 `test/sqlite-migrations.test.ts`（bootstrap 与迁移一起回滚）。

### 7.3.9 不变式与边界

- **一个 Storage 一个进程**：JSONL 目录与 SQLite 连接都没有租约；跨进程共享同一份存储不在承诺范围内（`README.md:529`）。
- **`commit()` 的可见性**：一旦 resolve，后续本 storage 的读必须看到它；这一条比「最终一致」更强，任何异步刷盘都必须发生在此之前。
- **`close()` 是两段式**：先同步拒绝新操作，再等待已受理的工作；`beforeClose()` 不得 reject；调用方取消 context 只影响等待。
- **WAL 与 NORMAL 的边界**：进程崩溃安全；掉电/宿主故障可能丢最近若干笔**已提交**事务；正常关闭后 WAL 归零。
- **备份必须在停写后做**：SQLite 单文件拷贝以「已 close」为前提，否则三件套一起拷；JSONL 必须目录级拷贝。
- **schema 版本是单向兼容**：旧程序遇到新库会拒绝打开（`src/storage/sqlite/migrations.ts:114-118`）。
- 平台差异：`./storage/*/index.ts` 与 `./env` 不得依赖 `node:`（由 `test/storage-runtime-boundary.test.ts` 固定）；Node 专有的只有 `node.ts` 适配器。
- 存疑：`main.jsonl` 永不压缩，长期运行只有「回收 sidecar」这一种写放大缓解（notes §25 第 10 条已记录）；仓库没有针对它的基准。

### 7.3.10 相关测试

- `test/memory-storage.test.ts` / `test/sqlite-storage.test.ts` / `test/jsonl-storage.test.ts`：三后端跑同一套 `registerStorageConformance`；SQLite 另有「每次提交后关库重开」的包装器版本（`test/sqlite-storage.test.ts:117-129`）。
- `test/sqlite-storage.test.ts:193-204`：删除 `durable_metadata` 后打开失败；`:493-521`：WAL 自动 checkpoint 与 close 截断；`:523-565`：页复用；`:567-616`：代表性数据体积 < 1 MiB。
- `test/sqlite-facade.test.ts`：事务串行化、事务期间的操作排队、读一致性。
- `test/jsonl-storage.test.ts:390`、`:458`、`:502`、`:978`、`:1060`：崩溃/重入与损坏检测。
- `test/sqlite-migrations.test.ts:60`：bootstrap 与迁移一起回滚；`test/storage-runtime-boundary.test.ts:33-36`：便携入口不引 `node:`。

---

## 7.4 性能与调优

这一节把「哪些机制决定开销」讲清：提交窗口、有界输出窗口、document base/delta、工具输出上限、SQLite 的 prepared statement 与索引；然后给出仓库里**可核对的数字**（以及为什么有些数字没有），最后是一份调优清单与「会毁掉 prompt cache / 制造提交风暴」的做法。

### 7.4.1 开销从哪里来：一次输入写几笔提交

理解性能前先数提交。以「一次输入 → 一次工具调用 → 一次回答」为例，落到存储上的提交至少包括：

```text
submit（放置输入 + 起 run）                      → 1 笔
generation.prepare / request                     → 若干（checkpoint、pi.live.generation）
模型的流式 partial（每 100 ms 最多一笔，见 7.4.2）→ 若干
把回答写进 pi.assistant + 起工具轮                 → 1 笔
工具 intent（slot 变 running）                    → 1 笔
工具进度（output/details/diagnostics，每 100 ms） → 若干
工具结果 + slot done                             → 1 笔
generation 收尾 / run 结束 / 下一轮 prepare       → 若干
```

每一次 submission/task 状态变化都伴随 superproject 之外的文档写入（`pi.live`、`pi.usage`、`pi.inbox`），而**每笔提交都是一次存储往返**，并在 SQLite 上打开一个事务。因此「性能」主要是三个问题：**提交次数**、**每笔提交写多少字节**、**每次提交要不要等磁盘**。

#### 一次提交的成本分解（按后端）

| 后端 | 一笔提交实际做什么 | 主导成本 |
| --- | --- | --- |
| Memory | `prepareCommit`（clone 写值 + 校验 ID/文档动作）→ 幂等 `apply()` 更新内存索引与 `nextSeq` | **序列化/克隆的体积**：写进去多少 JSON，就复制多少；与提交次数线性相关 |
| SQLite | `BEGIN IMMEDIATE` → `SELECT next_id,next_seq` → 逐 ID 查 `record_ids` → 逐条 INSERT/UPSERT → 文档 base/delta 行 → `COMMIT` | **写事务的 I/O**（WAL 追加 + 未来 checkpoint）；句子是 prepared 复用的，解析开销近似为零 |
| JSONL | `MemoryStorage.prepareCommit` → 编码 → 追加每个受影响 sidecar → 追加 main marker → 内存 `apply()` → 回收（若有） | **追加字节数**：`marker + Σ sidecar`；开 `fsync` 后还要加「每个 sidecar 一次 flush」，以及回收前的一次 main flush |

由此得到三条实用判断：

- 同样的负载下，**Memory 测的是「代码路径 + 克隆」**，是理想上界，不代表磁盘后端。
- **SQLite 的提交成本与「一笔提交里写多少行」强相关**，与「值多大」弱相关（行里存 JSON 文本）；因此把 N 条 entry 合成一笔提交，比写 N 笔提交便宜得多。
- **JSONL 的提交成本与「影响多少文件」强相关**：一笔提交改 1 个文档 = 1 个 sidecar + main；改 10 个文档 = 10 个 sidecar + main（`src/storage/jsonl/storage.ts:277-306` 的循环）。

### 7.4.2 100 ms 提交窗口

两处节流，都是**编译期常量**（没有 settings 可以调）：

- 模型 partial：`PARTIAL_THROTTLE_MS = 100`（`src/harness/generation.ts:109`），`streamResponse()` 里「同时最多一个提交在飞；期间的更新合并」，`finally` 会停表并等最后一笔（`src/harness/generation.ts:361-409`）。
- 工具进度：`Progress` 的 `MIN_PROGRESS_INTERVAL_MS = 100` 与 `PROGRESS_BYTES_PER_SECOND = 100 * 1024`（`src/harness/output.ts:209-210`）。规则是（`src/harness/output.ts:255-287`）：

```text
空闲期后的第一个变更 → 立即提交
之后每次提交 → 下一次最早在 started + max(100ms, 已写字节 / 100 KiB/s)
同一时刻最多一个提交在飞；期间变更合并进下一批
提交失败 → 下一次仍至少 100 ms 之后，并上报
```

含义：**写 50 KiB 就买 500 ms 的安静期**（`test/harness-output.test.ts:206-234` 用 fake timer 固定了 0/500/600 ms 三个时间点）；小写入仍至少 100 ms 一笔。所以「高吞吐的工具输出」不会变成「高提交频率」，而是「每次提交写得多一点」。

**去重**不在 `Progress` 里，而在调用方 `publishProgress()`（`src/harness/tool.ts:276-322`）：它只写变化的部分——`output` 作为一个字符串字段赋值（让 Chord 自己 diff 成 append 或「前剪 + append」），`details` 用 `assignJson` 逐叶写，`diagnostics` 只追加新增项；写入量按「Chord 实际会写多少」估算后返回给 `Progress` 做退避。细节见 4.6.3。

#### 提交频率与容量的估算

以下是**由常量推导的上界**，不是实测值；用它做量级判断，再用 7.4.7 的方法量真实系统：

```text
每个进度流的提交频率上限      ≈ 10 笔/秒                       （100 ms 下限）
   写 B 字节的退避            ≈ max(100 ms, B / 100 KiB/s)
实际频率                      ≤ (并行工具数 + 1 个模型流) × 10 笔/秒
   ——并行 4 个工具时，pi.live 的理论提交上限约 50 笔/秒（还没算 checkpoint 类提交）

SQLite WAL 稳态上界           ≈ walAutoCheckpointPages × 页大小
                              ≈ 1000 × 4096 B ≈ 3.9 MiB          （默认值；0 则无自动上界）
   再加上「当前未 checkpoint 的事务」与 `-shm`（实测 1k 规模下 -wal/-shm 合计约 3.99 MiB，
   与这个量级一致；快照发生在 close 之前，因此当时主库比 page_count 少 11 页）

JSONL 目录规模                ≈ main markers 总量 + Σ sidecar
   sidecar 数量                ≈ 活跃文档数 + 非终态 task 数（量级）
   实测（1k 规模）= 340 个文件（205 doc-* / 134 task-*），main 0.41 MiB + sidecar 0.32 MiB

常驻内存（heap，进程增量口径）  memory ≈ 862 B/主记录
                              jsonl  ≈ 995 B/主记录（打开时全量 replay 到内存索引）
                              sqlite ≈ 147 B/主记录（只有 prepared statement 与元数据常驻）
```

三条推论：

1. **提交频率由「并行度」而非「输出速度」决定**：输出越快，每笔提交写得越多（退避），但笔数上限仍是 10/秒/流。
2. **JSONL 的内存与磁盘随历史线性增长**，且打开时间也随历史增长；SQLite 的常驻内存与历史**无关**（这是它在长会话部署里胜出的主因）。
3. **`deltasSinceBase` 与重开耗时同向**：delta 链越长，重开读 `pi.live` 越慢（7.4.4），这也是长 run 场景（30 秒 high+tail）要单独测的原因。

### 7.4.3 有界输出窗口与增量编码

工具输出保留窗口是**有界的**：`OutputBuffer` 只驻留「窗口 + 一个 chunk」，head 保留在窗口满后**不再存储**（只累计丢弃计数），tail 保留在快照时丢掉窗口不再需要的头部 chunk（`src/harness/output.ts:110-195`）。这直接决定了每笔进度提交的 op 形态：

| 场景 | 每笔提交的 Chord op | 证据 |
| --- | --- | --- |
| head 窗口未满 | `["s", ["tools",0,"output"], "..." ]` 首笔，之后 `["a", ...]` | `test/harness-live-deltas.test.ts:164-179` |
| head 窗口已满 | 只写 `droppedBytes` / `droppedLines` 两个计数 | 同上（窗口满后不再写 output） |
| tail 窗口滑动 | `["t", output, n]` + `["a", output, text]`（前剪 + append） | `test/harness-live-deltas.test.ts:181-202` |
| 重叠搜索失败（> 64 KiB 扫描窗或不可辨内容） | 整窗 `["s", ...]` | `test/harness-live-deltas.test.ts:204-227` |

**结论**：head 适合「日志开头就够用」的工具（`read` 这种一次性输出），tail 适合「只看最近的报错」的工具（`bash`）。head 的稳态成本是 O(1)（只写计数），tail 的稳态成本是每笔提交写一个滑动窗口（可能高达整窗字节数）。

### 7.4.4 document base/delta 与 `checkpointWhen`

文档每次变化可以存成 **base**（完整值）或 **delta**（`Op` 批）。选择由定义的 `checkpointWhen(value, ops, info)` 决定（`src/types.ts:69-78`；`info.deltasSinceBase` 是「最新 base 之后已经存了多少 delta，不含正在评估的这次」）。内建文档的策略：

| 文档 | 策略 | 行号 |
| --- | --- | --- |
| `pi.agent` | 永远 base | `src/harness/agent.ts:43` |
| `pi.provider` | 永远 base | `src/harness/provider.ts:19` |
| `pi.usage` | 永远 base | `src/harness/usage.ts:21` |
| `pi.inbox` | 队列为空时 base | `src/harness/inbox.ts:23` |
| `pi.live` | 「没有 generation 且没有 running 的工具 slot」时 base | `src/harness/live.ts:74-76` |

这套策略的性能含义：

- 小文档（agent/provider/usage）每次写整值也不贵，换来「读一条就是完整状态」。
- `pi.live` 是最热的文档：流式 partial 与工具进度全落在它上面。它的 base 只在「什么都不跑」的位置出现——空闲、交接到工具轮、工具轮结束、run 结束——因此 **delta 链的长度上界是「一次 generation 或一轮工具的重叠执行」**，而不是整个会话。`test/harness-live-deltas.test.ts:279-341` 用「记录每笔提交写的是 base 还是 delta」的存储包装器断言：base 恰好出现在那些什么都没有在跑的提交上，且至少出现 5 次；`:443-453` 直接对 `checkpointWhen` 做单元断言。
- **重开代价**与 delta 链长度直接相关：读 `pi.live` 需要「最近 base + 有序 delta 尾」。`test/tool-output-bench.ts` 专门在 rate 场景里**中途关闭再重开**并计时（`replayMs`，`test/tool-output-bench.ts:214-223`），就是量这个成本。
- 写自己的文档时：**高频小改动**（例如每次心跳改一个计数）适合让它保持 delta；**结构性重写**（数组重排、整体替换）应当让 `checkpointWhen` 在该情形返回 true，否则每条 delta 都记一次「整值替换」，链越长读得越慢。`pi.live` 的注释里明确写了「不要给 delta 数量加上界，工具输出基准会检查这条规则」（`src/harness/live.ts:70-73`）。

#### 压缩与上下文成本（`pi.compaction`）

压缩是「花一次额外模型调用，换更小的上下文」的交易，它的成本结构是：

- **触发**：`CompactionPolicy` 三个阈值（默认 `reserveTokens: 16384`、`keepRecentTokens: 20000`、`backgroundTokens: 32768`，`src/harness/agent.ts:25-30`）。生成准备阶段计算：超过 `contextWindow - reserveTokens` → **blocking**（生成停下来等它）；再低 `backgroundTokens`（默认 32768）且还没有活跃压缩 → **background**；`backgroundTokens: 0` 关闭后台压缩；只有范围选择能切出范围时才启动（`src/harness/generation.ts:302-324`）。`CompactionPolicy.enabled` 为 false 时阈值/溢出压缩都不做，但**手动** `Conversation.compact()` 忽略 `enabled`（`src/harness/types.ts:370-373`）。
- **产物**：摘要 entry + head marker。摘要通过写提交放置：空闲时立刻，否则下个边界（`src/harness/types.ts:501-506`）；`CompactionResult` 用 `entryId`（阻塞式）或 `submissionId`（会话自有）指出它落在哪里。
- **成本**：① 一次摘要模型调用（单独请求，可被 `beforeCompact` 干预或拒绝，`src/harness/types.ts:626-642`）；② 一笔较大的提交（摘要 entry + head marker）；③ **prompt cache 从切点开始失效**（摘要替换了那段上下文）。进行中的压缩会出现在 `pi.live.compactions`（`CompactionStatus` 带 `blocking`/`attempt`/`retry`，`src/harness/live.ts:32-41`），事件流会发 `compaction_start`/`compaction_end`，但**重试退避只在快照里可见**（`src/harness/events.ts:298-304`、`:337-341`）。
- **调参方向**：上下文压力大 → 调小 `reserveTokens`（更早阻塞压缩）或调小 `keepRecentTokens`（摘要留得更少）；不想让压缩打断在线请求 → 调大 `backgroundTokens` 的**触发余量**（后台更早开始）或保持默认；完全不想自动压缩 → `enabled: false`，改由业务在低峰调用 `compact()`。

### 7.4.5 大对象与长文本：工具输出上限

- 默认上限：**2000 行 / 50 KiB，`retain: "head"`**（`src/truncate.ts:11-12`，应用到工具上的位置是 `src/harness/tool.ts:176-180`）。工具可以用 `outputLimits` 覆盖（`src/harness/types.ts:215-219`），`bash` 显式声明 `retain: "tail"`（`src/tools/bash.ts:52`）。
- `read` 走的是另一条截断路径：`truncateHead`（`src/truncate.ts:109-110`），并且对「单行超过 50 KiB」有专门处理：截到字符边界并在 diagnostic 里给出用 `sed`/`tail -c` 取完整行的提示（`src/tools/read.ts:77-88`）。
- 环境侧还有 spill：`bash` 的 `spill` 参数（`src/tools/bash.ts:72`）把超过阈值的完整输出写进临时文件并把路径报给模型——**harness 不做 spill**，只做有界保留（4.6.3）。
- 结论：**工具输出上限是唯一能约束「单笔提交字节数」的旋钮**。调大 `maxBytes` 不会让模型看得更全（超过上限的部分只会出现在 diagnostic 或 spill 文件里），但会让每笔进度提交、每次重放都更大；调小则相反。对「会吐大量文本」的工具（编译、测试、日志），`tail` + 适中上限通常是性价比最高的组合。

### 7.4.6 SQLite prepared statement 缓存与索引

- **prepared statement 缓存**：`NodeSqliteExecutor` 用一个 `Map<string, StatementSync>` 按 SQL 文本缓存，数据库与事务句柄**共享**同一个 Map（`src/storage/sqlite/node.ts:73-114`）。因此热路径（插入 entry、更新 task、materialize 文档）不会重复 prepare；`close()` 会先 `statements.clear()` 再关连接（`:161-172`）。这也是 README 允许自定义适配器「按 SQL 文本缓存」的原因（`README.md:531`）。
- **串行队列**：所有语句经 `SerialOperationQueue` 排队，异步操作在 settle 前一直占住队列（`src/storage/sqlite/node.ts:23-70`）。代价是「同一连接没有并行 SQL」；收益是不需要锁、事务边界清晰。事务用 `BEGIN IMMEDIATE` 打开（`:140-159`），意味着写事务一开始就拿写锁。
- **索引**：schema 里为每条热路径建了索引（`src/storage/sqlite/migrations.ts:26-84`），其中值得注意的三处：
  - `entries_by_conversation (conversation_id, id DESC)` 与**部分索引** `entry_heads_by_conversation (conversation_id, id DESC) WHERE head IS NOT NULL`——前者服务「最新优先翻页」，后者只服务「找 head marker」，体积远小于全表索引。
  - `documents_by_address (kind, scope_kind, owner_id, family, key_value, created_at DESC, retired_at)`——把「地址解析」变成一次索引区间查，`documents_by_scope_kind` 服务按 scope 的枚举。
  - `document_revisions_by_kind (document_id, kind, seq DESC)` + 主键 `(document_id, seq)`——「找最新 base」与「读 delta 尾」各一条索引。
  - 查询计划被测试固定：`test/sqlite-storage.test.ts:383-439` 断言热查询走上这些索引，并断言**不得**出现 `SCAN documents`、revision 查询不得 `SCAN document_revisions`。
- **页复用**：current-only 文档的回收用 `DELETE`，SQLite 因此能复用空页；测试断言「回收后页数增长 ≤ 2 且 freelist 下降」（`test/sqlite-storage.test.ts:523-565`），以及代表性数据量级下关库文件 < 1 MiB（`:567-616`）。

### 7.4.7 仓库里的基准：怎么跑、测什么

三条命令（`README.md:595`、`package.json:81-83`）：

```bash
npm run bench:storage          # vitest bench --config vitest.benchmark.config.ts
npm run bench:storage:memory   # node --conditions=source --experimental-strip-types test/storage-memory.ts
npm run bench:tool-output      # node --conditions=source --experimental-strip-types --expose-gc test/tool-output-bench.ts
```

**`test/storage.bench.ts`（计时）**：数据由 `seedStorageBenchmark()` 用**公共 Storage 契约**造（`src/testing/storage-benchmark.ts:87-276`），默认 `TIMING_SCALE` = 1000 entry / 300 task / 300 document，另有 `REPLAY_TAILS = [0,16,128,1024]` 的 delta 尾、128 段历史+一次 base 重启、8 层 fork 各 32 条 entry。

- 读场景 **12 个** × 3 后端：exact entry lookup、entry page scan (100)、filtered task scan (50)、exact document address、document replay tail (0/16/128/1024) 四个、ancient/recent historical read、fork-depth history scan (100)、fork-depth head lookup（`src/testing/storage-benchmark.ts:284-382`）。参数：`time: 300` ms 采样、`iterations: 10`、warmup 75 ms × 3（`test/storage.bench.ts:21`）。
- 写场景 **3 个** × 3 后端：commit one entry、commit 100 entries、commit mixed entry/task/submission/document（`src/testing/storage-benchmark.ts:409-489`）。参数：`iterations: 20`、warmup 5，且每个样本用**独立的 fixture 池**（先 seed 再测，避免测到同一份增长中的存储，`test/storage.bench.ts:83-115`）。
- reopen 场景 1 个 × 2 持久后端：`reopen and first exact read`（`iterations: 20`、warmup 3），样本是「拷出来的独立副本」，因此测的是「打开 + 读第一条」而不是「打开同一个文件多次」（`test/storage.bench.ts:134-185`）。
- **先校验再计时**：每个场景在计时前都跑一次并 `strictEqual(run(...), expected(...))`（`:58-65`、`:90-100`、`:166-170`），防止把「查错了但很快」当成基准结果。

**`test/storage-memory.ts`（占用测量，不计时）**：driver 为「后端 × 规模」各起一个子进程（`--expose-gc` 才能测），规模 `1k`/`10k`（`src/testing/storage-benchmark.ts:24-27`）。worker 的流程是：GC → baseline → seed → GC → postSeed → 10 轮全部读场景（第一轮校验、其余累计 checksum）→ GC → postRead → 统计磁盘（SQLite 读 `pragma_page_count`/`pragma_freelist_count` 并把 `-wal`/`-shm` 计入 auxiliary；JSONL 统计 `main.jsonl` 与 sidecar 文件数）（`test/storage-memory.ts:120-170`）。表格列包括「JS heap bytes/primary record」（`:211-213`）。

**`test/tool-output-bench.ts`（端到端工具输出）**：默认 50 个场景，每个场景跑在自己的子进程里（峰值 RSS 各算各的）：

- 速率场景：`low` = 1 行/200 ms；`normal` = 25 行/50 ms（注释标 ~40 KB/s）；`high` = 800 行/0 ms（约 64 KiB 一块，块间让出事件循环）× 3 后端 × 2 retain × 2 工具数（1 与 4），每场景跑 3 秒（`test/tool-output-bench.ts:40-47`、`:56-62`）。
- firehose 场景：`api.output` 连灌 **1 GiB**，分 head / tail / tail+repetitive（重复行用来触发 Chord 重叠搜索退化为整窗）三种（`:63-66`）。
- 长 run 场景：持久后端多跑一个 30 秒的 high+tail，看「一个话多的 tail 工具在轮次 base 之前能堆出多长的 delta 链」（`:67-68`）。
- `bash cat 1 GiB` 场景（`:69`）：走真实环境与 spill 路径。
- 指标字段（`:112-125`）：`ms`、`liveCommits`、`liveOpKiB`、`outputSets`（被记成整串 set 的次数）、`commitP50Ms`/`commitP99Ms`、中途关闭时的 `midRoundKiB`、重开的 `replayMs`、收尾后的 `finalKiB`、`peakRssMiB`、`heapAfterGcMiB`。

#### 怎么量你自己的部署

三个探针，全部来自仓库里已经在用的做法，不需要改源码：

**（1）提交次数与每笔写多大**——订阅提交，只统计 `pi.live` 的写入（`test/tool-output-bench.ts:197-206` 的写法）：

```typescript
let commits = 0;
let opBytes = 0;
harness.subscribeCommits((publication) => {
	for (const change of publication.changes) {
		if (change.type !== "document" || change.record.kind !== "pi.live") continue;
		commits++;
		opBytes += JSON.stringify(change.ops).length; // 近似“这次写了多少”
	}
});
```

把 `commits / 会话时长` 与 `opBytes / commits` 与 7.4.2 的上界对照，就能判断是「提交太碎」还是「单笔太大」。

**（2）SQLite 的 WAL 与页**——直接查 pragma（`test/storage-memory.ts:79-99` 的写法）：

```sql
SELECT page_count, freelist_count FROM pragma_page_count(), pragma_freelist_count();
```

再叠加 `stat(<file>)`、`stat(<file>-wal)`、`stat(<file>-shm)` 三个大小。判读：WAL 长期偏大 → 调大/关闭 `walAutoCheckpointPages` 或自己安排 checkpoint；`freelist_count` 持续上涨 → 有大量删除（例如文档回收）但页没被复用，值得看是不是每次都重建文档。

**（3）JSONL 的目录**——统计文件数与大小（`test/storage-memory.ts:101-118` 的写法）：`main.jsonl` 的大小（marker 总量）、sidecar 总数、`doc-*`/`task-*` 的个数。判读：sidecar 数量远大于「活跃文档 + 非终态任务」→ 有大量已回收但没删的文件（或文档创建过快）；`main.jsonl` 只增不减是设计使然。

**（4）观测背压**：`Conversation.watch()` / `watchEvents()` 的待投递队列上限是常量 100（`src/session/observation.ts:15`）。消费者一旦跟不上就会收到「折叠后的快照」而不是逐帧，因此「收到 `["r", value]` 根替换帧」本身就是背压信号（4.6.1）。

**不建议**为了量开销而改源码里的节流常量：它们同时影响正确性边界（`pi.live` 的 base 位置、`checkpointWhen`），改完测出的数字不代表出厂行为。

### 7.4.8 可核对的数字，以及为什么有些数字没有

仓库里**没有提交任何基准结果文件**（README 只列命令）；能被引用的数字有两类：

**（a）测试里固定的门槛（这些是仓库自己的断言，可复跑验证）**

| 数字 | 出处 | 含义 |
| --- | --- | --- |
| WAL < 512 KiB；close 后 WAL = 0 | `test/sqlite-storage.test.ts:493-521` | `walAutoCheckpointPages: 1` 时 20 笔 32 KiB 提交的 WAL 上界；正常关闭一定截断 WAL |
| 回收后页数 ≤ 删除后页数 + 2 且 freelist 下降 | `test/sqlite-storage.test.ts:523-565` | DELETE 回收的页会被复用 |
| 100 条 1 KiB entry + 100 次文档编辑 → 文件 < 1 MiB | `test/sqlite-storage.test.ts:567-616` | 代表性负载的存储上界 |
| 首个变更立即提交；之后 ≥ 100 ms 且按已写字节 / 100 KiB/s 退避 | `test/harness-output.test.ts:206-234` | 进度提交的节流 |
| 真实 Codex 请求 ≥ 4000 prompt tokens，缓存命中率 ≥ 0.9 | `test/provider-session-cache-e2e.test.ts:110-118` | sessionId 复用带来的 prompt cache 效果（需凭据，否则 skip） |

**（b）一次真实运行的占用测量（来自 6.4 节，`1k` 规模，1670 条主记录，单位 bytes）**

```text
memory: postSeed - baseline heap = 1,439,648 B   （≈1.37 MiB，≈862 B/主记录）
sqlite: postSeed - baseline heap =   244,848 B   （≈0.23 MiB，≈147 B/主记录）
        disk: main 638,976 B；auxiliary(-wal + -shm) 4,185,760 B；pageCount 167；freelist 0；fileCount 3
jsonl:  postSeed - baseline heap = 1,661,784 B   （≈1.58 MiB，≈995 B/主记录）
        disk: main 430,987 B；auxiliary 330,430 B；fileCount 340（205 doc-* / 134 task-*）
```

读法（沿用 6.4 节的限定）：这些是**进程增量**而不是上限（脚本自己打印 `values are process deltas, not limits`）；`rss` 在 GC 后出现负增量，说明它不能当可靠指标；SQLite 的 `pageCount`（167）比主库实际页数（156）多，是因为快照发生在 `close()` 之前、有 11 页仍在 WAL 里。

**为什么没有 bench:storage 与 bench:tool-output 的耗时数字**：这两条会创建 1 GiB 临时文件、跑 50 个子进程场景（tool-output），以及一个 vitest bench 进程（storage），仓库里没有提交结果文件，本轮也没有运行它们。要数字，请在目标机器上按 7.4.7 的命令自己跑；指标字段名已经列好，便于比对。

### 7.4.9 调优清单

**settings（`HarnessSettings`，每次解析时实时读取，见 4.5.2）**

| 设置 | 影响 | 什么时候调 |
| --- | --- | --- |
| `toolExecution: "parallel"`（默认） / `"sequential"` | 并行工具会同时产生多条进度流 → 提交更多、CPU 更忙；串行则一次一个 | 磁盘慢、提交延迟 p99 高、或工具之间有依赖时改 `"sequential"`；追求墙钟时间用默认 |
| `steeringMode` / `followUpMode`（默认都是 `"one-at-a-time"`） | 一个边界放置一个还是全部排队项：`"all"` 会在一个边界塞入多条 user entry 并立刻起 run（突发提交） | 批量灌输入（脚本化）时可临时 `"all"`；交互式保持默认 |
| `compaction.enabled` / `reserveTokens` / `keepRecentTokens` / `backgroundTokens` | 压缩会**替换一段上下文**（写摘要 entry + head marker），既是一次大提交，也会让 prompt cache 从该点失效 | 长会话必开；`backgroundTokens: 0` 关后台压缩；上下文压力大就调小 `reserveTokens` 或调大 `keepRecentTokens`（摘要少留一点） |
| `retry.maxRetries` / `baseDelayMs` / `maxAgentDelayMs` | 重试会重复「prepare + 请求」，而每次 prepare 都会重新解析 settings、重新写 checkpoint | 稳定 provider 上可减小；抖动网络下保持默认 |
| `stream.timeoutMs` / `maxRetries` / `cacheRetention` / `deferred.window` | 单次请求的成本与延迟；`cacheRetention` 影响 provider 侧的缓存策略 | 按 provider 与网络调；`deferred` 适合长答案的异步 provider |
| `extensions` 选择 | 选中的 Extension 决定 prompt 的 section 与工具表（前缀大小）；未安装/未选中的不产生任何成本 | 只装真正要用的：每个 tool 声明都进 system entry |

**工具级**

| 旋钮 | 影响 | 方向 |
| --- | --- | --- |
| `outputLimits.maxBytes` / `maxLines` / `retain` | 直接决定每笔进度提交与重放的字节数 | 高频输出用 `tail` + 适中上限；只关心开头的用 `head`（稳态只写丢弃计数） |
| `executionMode` | 覆盖 settings 的并行/串行 | 单个「重」工具要独占时可以设 `"sequential"` |
| `replay: "safe"` | 允许恢复后重跑；重跑会先清 slot 进度再重发 | 幂等的工具才设 `safe`；否则恢复只能报「可能已部分执行」 |
| `prepareArguments` | 每次调用（含重试）都跑一次纯函数 | 保持 O(小)；别在里面做 I/O |

**后端级**

| 旋钮 | 影响 | 方向 |
| --- | --- | --- |
| SQLite `walAutoCheckpointPages`（默认 1000，0 关闭） | WAL 大小 ↔ checkpoint 频率 | 写入很密 → 调大或关闭并自己在低峰 checkpoint；WAL 体积敏感 → 调小 |
| SQLite `busyTimeoutMs`（默认 5000） | 竞争文件锁时的等待上限 | 只有在你知道有别的进程/连接竞争时才需要动；不要用它替代单进程约束 |
| JSONL `fsync`（默认 false） | 每笔提交 flush 每个 sidecar 的代价 | 只有「进程崩溃也不许丢」时才开；开了仍然不 flush main（尾部提交仍可能消失） |
| 后端选择本身 | JSONL 打开要全量 replay；SQLite 是索引读 | 历史会很长 → SQLite；需要人可读/可搬运 → JSONL |

**环境与宿主**

- `HarnessOptions.env` **每次使用都会重新构造**（`src/harness/types.ts:428-429`），所以示例里把 `NodeExecutionEnv` 按目录缓存起来复用；构造一个有状态环境（虚拟文件系统、沙箱）比想象中贵。
- 包根会加载 TypeBox（约 23 MB 峰值 RSS，tree-shaken 约 4 MB，`README.md:556`）。只做存储/回放的工具进程可以只引 `./storage/*` 与 `./testing`。
- watch/事件流的 100 帧上限是常量（`src/session/observation.ts:15`）：消费者慢不会拖慢 Session，但会看到「折叠成快照」而不是每一帧。

### 7.4.10 会毁掉 prompt cache 或制造提交风暴的做法

**prompt cache（provider 侧的前缀复用）**

- 前缀靠两条机制维持：**每会话稳定的 provider 身份**（`pi.provider.sessionId`，随每次请求转发，7.4.8 的 e2e 测得命中率 ≥ 0.9，见 4.5.5）与 **system prompt 的差分更新**（`planSystemEntries`：不变的部分保持原 entry，只追加最小补丁；顺序变化才「清空 + 重建」两条 entry，见 4.5.3）。
- 因此以下做法会让缓存失效：
  1. **删掉/退休 `pi.provider` 文档**（下一次请求会生成新 UUIDv7 → 新身份 → 冷启动）；
  2. **fork 后继续请求**（fork 取 `initial`，新身份，符合设计但不是「免费续用」）；
  3. **每轮重写系统提示**：section 渲染结果每次都不同（例如把时间戳/随机数写进 section）会让每个请求都补一条新 system entry；工具声明顺序不稳定（Map/对象键顺序抖动）会触发「全量重写」分支；
  4. **频繁压缩**：摘要替代上下文后，被替代范围之后的缓存全部重算；
  5. **切模型 / 切 thinking level**：请求参数变了，过去的前缀无法复用。
- 反过来：`Conversation.agent()` 与 `settings` 的变化**不产生提交**（4.5.2 已列），所以调设置本身不会立刻扰动上下文；真正会写的是「下一次 prepare 追加的 system delta」。

**提交风暴**

- **并行工具 × 高频输出**：每个工具都有自己的 `Progress`，节流是**每工具**的；`test/tool-output-bench.ts` 的 `tools: 4` 与 `outputSets` 指标就是为量这个而设。想让提交数降下来：串行执行、或给这些工具设更小的 `outputLimits`。
- **把「很小的改动」拆成多次 commit**：每次 `api.commit()`、每次 `tx.doc()` 写都是独立提交；循环里逐个 append entry 会得到 N 笔提交，批量写（`commit([...])`）才是 1 笔。
- **在 `checkpointWhen` 该返回 true 的位置返回 false**：结构性重写被记成 delta 会拉长 delta 链，重开与读取都变慢（7.4.4）。
- **给 `harness.subscribeCommits` / watch 的 listener 里做重活**：提交回调是同步的（`Session.subscribeCommits` 的 listener 不得抛错、不得阻塞）；慢 listener 会把提交线拖住。
- **不用 `waitForIdle()` 收尾就关闭**：`close()` 会 join 任务（7.3.6），但等待发生在关闭路径上；在应用层先 `waitForIdle()` 能让「关库」与「最后一笔提交」的边界更清楚。

### 7.4.11 相关测试

- 节流与输出窗口：`test/harness-output.test.ts:134-271`（`OutputBuffer` 的窗口与计数、`Progress` 的 100 ms/100 KiB/s 与失败路径）；`test/harness-live-deltas.test.ts:164-227`（head/tail/整窗三种 op 形态）；`test/tool-output-bench.ts`（端到端指标）。
- 文档 base/delta：`test/harness-live-deltas.test.ts:279-341`（哪些提交写 base）、`:443-453`（`checkpointWhen` 单元断言）、`:259-277`（partial 全为 append）。
- SQLite 侧：`test/sqlite-storage.test.ts:383-439`（查询计划）、`:493-521`（WAL）、`:523-565`（页复用）、`:567-616`（体积上界）。
- prompt cache：`test/provider-session-cache-e2e.test.ts:110-118`（命中率 ≥ 0.9）；`test/harness-generation.test.ts:365-386`（sessionId 与请求参数来源）。
- 基准装置本身：`test/storage.bench.ts`、`test/storage-memory.ts`、`src/testing/storage-benchmark.ts`（场景与数据集定义）。

### 7.4.12 存疑点

- `test/storage.bench.ts` 的读场景数量按源码枚举是 **12**（3 个基础 + 4 个 `REPLAY_TAILS` + 2 个历史点 + 2 个 fork-depth），而 6.4 节写作「11 个读场景」；本节的数字以源码为准，若要统一请以 7.4.7 的枚举为准。
- `test/tool-output-bench.ts` 默认场景数按源码计算为 **50**（速率 3 后端 × 3 速率 × 2 retain × 2 工具数 = 36；firehose 3 后端 × 3 种 = 9；持久后端长 run 2；`bash cat` 3），脚本自身不打印总数，因此这个数字是枚举得出的。
- 6.4 节的实测数据只在 `1k` 规模、单次运行、本机环境（Windows + Node）上成立；它没有跑 `10k` 规模，也没有跑计时基准。
- `PROGRESS_BYTES_PER_SECOND` / `MIN_PROGRESS_INTERVAL_MS` / `MAX_PENDING_WATCH_FRAMES` / `PARTIAL_THROTTLE_MS` 都是编译期常量，**不是 settings**；如果你需要不同节奏，只能改源码或在外面减少写入量（这也是本节把它们单列的原因）。

---

## 7.5 API 速查

这一节按「你会按什么名字去找」组织。签名给出形状与关键可选参数；每个方法的行为细节见对应小节与第 4 部分的源码精读。

### 7.5.1 入口与打开

```typescript
import { Harness, createSession, MemoryStorage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools, read, write, edit, bash } from "@earendil-works/pi-durable/tools";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";

const harness = await Harness.open(storage, options, context);   // 打开（+ 调度器，初始 paused）
const session = createSession(storage);                          // 只要持久化原语
```

`Harness.open` 的 `options`（详见 2.10、4.3.2）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `models` | ✅ | pi-ai 的 `Models`（`createModels()`） |
| `registry` | — | 扩展注册表（`createRegistry()`） |
| `settings` | — | 宿主级运行策略（每次使用现场读取） |
| `env` | — | `({ conversationId, cwd, read }) => ExecutionEnv \| Promise<ExecutionEnv>` |
| `conversationCreated` | — | `(tx, conversation) => Promise<void>`：**每次**创建/fork 会话时在同笔提交里运行 |

### 7.5.2 Harness

```typescript
harness.root(context, { agent?, init? }): Promise<Conversation>          // 首次创建；之后忽略 agent/init
harness.conversation(id, context): Promise<Conversation | undefined>     // 重启后恢复句柄
harness.createConversation(options, context): Promise<Conversation>      // options: { ownership, agent?, init? }
harness.resume(): void                                                   // 启动调度
harness.waitForTask(id, context): Promise<SettledTask>                   // 等任务终局（含 owned 工作排空）
harness.waitForIdle(context, options?): Promise<void>                    // 等前台工作空闲
harness.abortTask(id, context): Promise<void>                            // 中止任务（自底向上）
harness.taskGraph(context): Promise<TaskGraph>                           // 活任务图
harness.watchTaskGraph(context): Promise<TaskGraphWatch>
harness.inspect(): HarnessInspection                                     // 诊断（blocked / missing_task 等）
harness.usage(context): Promise<UsageState>                              // 全 Session 用量
harness.submission(id, context): Promise<Submission | undefined>         // 按 id 找回提交
harness.close(context): Promise<void>                                    // 收尾关闭

// Session 层的读写（Harness 同样具备）
harness.commit((tx) => ..., context)
harness.snapshot(token, ...args, context)
harness.snapshotAsOf(token, conversationId, entryId, context)
harness.documentState(token, ...args, context)
harness.watchDoc(token, ...args, context)
```

### 7.5.3 Conversation（句柄无状态，按 `id` 等价）

```typescript
conversation.id: ConversationId

conversation.submit(request, context): Promise<Submission>
//   request = { type: "input", content, requestId?, whenBusy?: "steer" | "reject" }
//           | { type: "write", entry, requestId?, whenBusy? }

conversation.commit((tx) => ..., context): Promise<T>
conversation.configure(change, context): Promise<void>       // change: AgentChange
conversation.agent(context): Promise<Agent>                  // 解析后的活对象
conversation.reset(note?, context): Promise<void>            // 新上下文（可带交接文本）
conversation.compact(instructions?, context): Promise<TaskId> // 手动压缩，返回任务 id
conversation.abort(context, options?): Promise<void>         // options: { background?: true }
conversation.waitForIdle(context, options?): Promise<void>

conversation.entries(filter?, limit, cursor, context): Promise<Page<EntryRecord, Cursor>>  // 最新在前
conversation.context(context): Promise<ContextView>          // { entries, head, messages }

conversation.viewState(context): Promise<ConversationView>   // 快照 + subscribe(value)
conversation.watch(context): Promise<ConversationWatch>      // { value, start, stop }

conversation.fork(entryId, options, context): Promise<Conversation>   // options: { ownership, agent?, init? }
```

### 7.5.4 Submission

```typescript
submission.id: SubmissionId
await submission.wait(context): Promise<SettledSubmissionRecord>
//   { status: "done", type: "input", answer: EntryId }
//   { status: "done", type: "write", entry: EntryId }
//   { status: "unanswered", reason: string, detail?: JsonValue }
await submission.abort(context): Promise<"aborted" | "already_placed" | "settled">
```

### 7.5.5 Tx（`commit` 回调内）

```typescript
// 表读（必须在第一次表写之前）
tx.conversation(id) / tx.entry(id) / tx.entry(token, id) / tx.task(id)
tx.scanConversations(query, limit, cursor?) / tx.scanEntries(...) / tx.scanTasks(...)
tx.latestHeadMarker(conversationId) / tx.submissionByRequest(conversationId, requestId)

// 表写
tx.createConversation({ ownership }) / tx.forkConversation(parentId, at, { ownership })
tx.appendEntry(conversationId, value) / tx.appendEntry(token, conversationId, value)
tx.createTask(task, input, { ownership, conversationId?, background? }): Promise<TaskId>
tx.createSubmission(create)
tx.settleSubmission(id, settlement) / tx.placeSubmission(id, entry)

// 文档（不受表写限制）
tx.doc(token, ...args): Promise<Draft<T>>
tx.retireDoc(token, ...args): Promise<void>
```

### 7.5.6 定义：任务、文档、entry、扩展

```typescript
// 任务
const Task = defineTask<Input, State, Result, Hooks?>({
	name, version, initial(input), phases, abort, migrate?, hooks?,
});
//   PhaseHandler: (task: RunningTask, runtime: TaskRuntime, context: Context) => Promise<void>
//   runtime.commit(cb, ctx) 的 cb 返回 NextTaskState:
//     { status: "running", checkpoint } | { status: "waiting", checkpoint, on, policy } | { status: "terminal", outcome }

// TaskRuntime（节选）
runtime.taskId / conversationId / signal / registry / settings / models
runtime.agent(ctx) / runtime.env(ctx)
runtime.commit(cb, ctx) / runtime.memo(name, ctx) / runtime.memo(name, value, ctx)
runtime.getTask(id?) / runtime.waitForTask(id) / runtime.outcomes(ids, ctx)
runtime.conversation(id, ctx) / runtime.entry(...) / runtime.context(conversationId, ctx, at?)
runtime.now() / runtime.sleep(until, ctx) / runtime.report(error)
runtime.hooks / runtime.watchDoc(...) / runtime.snapshot(...)

// 文档
const Doc = defineDoc<T>({ kind, version, scope, history?, fork?, initial, migrate?, checkpointWhen? });
const Family = defineDocFamily<T, Seed>({ kind, version, family: true, scope, history?, fork?, initial(seed), ... });

// entry
const Note = defineEntry<{ text: string }>("app.note");
Note.is(entry)   // 类型收窄（只比较 kind）

// 扩展与工具
const Ext = defineExtension({ name, tools?, sections?, hooks?, wraps?, tasks? });
const Tool = defineTool({ name, description, parameters, replay?, execute });
const Sec = section(name, (input) => string | undefined, { tag?: boolean });
const H = hook(ToolTask, { beforeTool, afterTool });
const H2 = hook(GenerationTask, { beforeRequest, afterResponse, onYield, afterTools });
const H3 = hook(CompactionTask, { beforeCompact });
const W = wrapTool(bash, (inner) => ({ ...inner, execute: ... }));
const W2 = wrapSection("preamble", (text, input) => ...);
```

### 7.5.7 设置、环境、存储

```typescript
settings: {
	extensions?: Extension[],                       // 默认选择；不给 = 全选已装
	stream?: { timeoutMs?: number },
	retry?: { maxRetries?: number },
	compaction?: { enabled?, reserveTokens?, keepRecentTokens?, backgroundTokens? },
	toolExecution?: "parallel" | "serial",
	followUpMode?: "one-at-a-time" | "all",
	steeringMode?: "one-at-a-time" | "all",
}

env: ({ conversationId, cwd, read }) => new NodeExecutionEnv({ cwd: cwd ?? process.cwd() })

MemoryStorage                                   // 不持久
await openNodeSqliteStorage("./session.sqlite", options?)        // WAL + synchronous=NORMAL
await openNodeJsonlStorage("./dir", context, { fsync?: boolean }) // 追加目录；可选强刷
```

### 7.5.8 内建 kind 速查

| 类别 | 名称 |
|---|---|
| entry kind | `pi.user` · `pi.assistant` · `pi.system` · `pi.tool-result` · `pi.reset` · `pi.compaction` |
| 文档 kind | `pi.agent` · `pi.provider` · `pi.live` · `pi.inbox` · `pi.usage` |
| 任务 kind | `pi.generation` · `pi.tool` · `pi.compaction` |

### 7.5.9 错误类型

| 错误 | 何时抛 | 处理方式 |
|---|---|---|
| `ReadAfterWrite` | 提交回调里「先写表再读表」 | 调整顺序：先读后写 |
| `StorageRejected` | 存储在产生任何持久效果前拒绝了整批写 | Session 可继续（正常回滚） |
| `ConversationBusy` | `whenBusy: "reject"` 撞上忙会话 | 退避、排队或用 followUp |
| 其它存储错误 / adopt 错误 | 提交结果未知 | Session 被 poison，必须 close 后重开 |

### 7.5.10 三个「要求进展」的清单（容易忘）

```text
会启动调度：resume() · submit() · wait() · waitForTask() · waitForIdle() · abort() · abortTask() · compact()
不会：viewState() · watch() · watchEvents() · watchDoc() · documentState() · snapshot() · snapshotAsOf()
      · entries() · context() · taskGraph() · watchTaskGraph() · inspect() · usage()
```

---

---


# 第 8 部分：附录

术语表、行号索引、32 个示例的实测记录、延伸阅读与练习。

## 8.1 术语表（完整版）

| 术语 | 含义 | 一句话记法 | 详见 |
|---|---|---|---|
| **Session** | 一份存储 + 一条提交线 + 五张记录表 | 没有 agent 的「数据库会话」 | 2.2 |
| **Harness** | Session + 调度器 + 内建任务 + 扩展机制 | Session 的超集 | 2.10 |
| **Commit** | 一次原子写；回调里的所有变更同生共死 | 要么都落盘，要么都不留 | 2.3 |
| **Commit line**（提交线） | 串行化所有提交与线内读作业 | 同一时刻只有一个提交在跑 | 2.2.3 |
| **Entry** | 不可变转录条目；`model` 给模型、`data` 给应用 | 事实来源，永不删除 | 2.4 |
| **EntryDraft** | 写入 entry 时的形状（`head` 可为 `"self"`） | 草稿阶段才有的写法 | 2.4.4 |
| **Head** | entry 上的「上下文起点」标记 | 压缩/重置/摘要共用 | 2.6.2 |
| **Edits / ContextEdit** | 声明「覆盖更早 entry 的模型贡献」（omit / replace） | 不改历史，追加解读 | 2.6.2 |
| **ContextView** | 转录的派生视图：`{ entries, head, messages }` | 模型看到的是派生结果 | 2.6 |
| **Document** | 与会话/任务/Session 绑定的类型化 JSON | 和 entry 同笔提交的「旁路状态」 | 2.5 |
| **Document family** | 一个定义服务多个实例（kind + scope + key 定位） | 带 key 的文档 | 2.5.3 |
| **scope（文档）** | `session` / `conversation` / `task` | 挂在哪，决定生命周期 | 2.5.2 |
| **history（文档）** | `latest`（只留最新）/ `rewindable`（旧值可寻址） | 要不要「回到过去」 | 2.5.2 |
| **fork（文档）** | fork 时副本的起点：`initial` / `current` / `asOf` | 分身带不带行李、带哪份 | 2.5.7 |
| **Incarnation（化身）** | 文档一次创建到一次退役的生命周期，有独立数字 ID | 地址不变，化身会换 | 2.5.6 |
| **base / delta** | 文档内容以「完整基准 + 操作序列」存储 | 定期压 base，平时写 delta | 2.1.3 |
| **checkpointWhen** | 决定这一笔写 base 还是 delta 的谓词 | 返回 true 才压 base | 2.5.8 |
| **migrate（文档/任务）** | 旧版本数据升级的纯函数 | 旧版本 + 没 migrate = 报错 | 2.5.5 |
| **Storage** | 原子提交 + 全局 ID 命名空间 + 只读查询 | 只管持久，不管语义 | 2.1 |
| **Cursor** | 分页续扫的不透明 JSON（后端私有） | 只能原样回传 | 2.1.4 |
| **StorageRejected** | 「确定什么都没提交」的失败 | 唯一能继续用的提交失败 | 2.1.6 |
| **poisoned** | 存储失败后 Session 的不可用状态 | 必须关闭重开 | 2.1.6 |
| **Seq** | 提交序号：严格递增、允许跳号 | 不是实体 ID | 1.4.1 |
| **Task** | 带检查点的持久状态机 | 「保存意图 → 做 → 保存结果」 | 2.7 |
| **Phase** | 状态机的一「关」，一个处理器函数 | 每关结束要存档 | 2.7.2 |
| **Checkpoint** | 「下一步干什么」的存档 | `runtime.commit()` 写入 | 2.7.2 |
| **Memo** | 任务内「先写先赢」的小记录 | 比检查点轻的「做过没」 | 2.7.7 |
| **Outcome** | 任务终局：completed / failed / aborted / orphaned / faulted | 任务的「收据」 | 2.7.2 |
| **waiting** | 等 `on` 列表里的任务；不占执行资源 | 等待名单 + policy | 2.7.5 |
| **completing** | 结果已定、等 owned 工作排空 | 还没到 terminal | 2.8.6 |
| **Owner / Ownership** | 归属关系（不是权限）：决定中止与空闲遍历 | 自底向上的中止 | 2.8.7 |
| **background** | abort 边界：拥有的工作躲过普通 abort、不让父级忙 | 常驻 subagent 的基础 | 2.8.6 |
| **Effect sandwich** | 「保存意图 → 执行 → 保存结果」 | 恢复语义的形状 | 2.7.4 |
| **Scheduler** | 唤醒、挑任务、跑 phase、结算、传播 abort | 存储态 → 实际执行 | 2.8 |
| **Submission** | 宿主交给会话的 input 或 write | 可等待、可撤回的请求单 | 2.9 |
| **requestId** | 提交去重键 | 同会话同 id 只准入一次 | 2.9.3 |
| **Inbox** | 忙时会话的排队区（`pi.inbox`） | 用户说的话不会丢 | 2.9.4 |
| **followUp / steer / write** | 三种排队模式与放置时机 | final / postTools 边界 | 2.9.4 |
| **Turn / Run** | 一次模型响应+工具 / 从输入到最终答案 | run = 若干 turn | 1.5 |
| **Busy** | 有 run 在进行（`pi.live.run !== undefined`） | 忙时会话的判据 | 2.9.4 |
| **Extension** | 代码打包单位：tools/sections/hooks/wraps/tasks | 按名字安装与选择 | 2.12 |
| **Registry** | 进程内的扩展代码表 | 存代码不存数据 | 2.12 |
| **Section** | 系统提示的段落（每次请求重新渲染） | 变化才追加 `pi.system` | 2.14 |
| **Wrap** | 按名字装饰工具或 section | 装饰「最终获胜者」 | 2.12.3 |
| **Hook** | 观察/干预内建任务的回调点 | before/after 系列 + onYield | 2.16、3.2 |
| **Agent** | 一个会话的运行配置（model/tools/extensions/cwd/instructions） | 存 `pi.agent` 文档 | 2.13 |
| **Settings** | 宿主级运行策略，每次使用现场读取 | getter = 实时配置 | 2.13.3 |
| **Environment / ExecutionEnv** | 工具与 section 接触外部世界的方式 | 每次使用构建；`id` 相同 = 同一批文件 | 2.15 |
| **replay** | 工具声明「崩溃后可安全重跑」 | 默认 unsafe（不重跑） | 2.16.4 |
| **interrupted** | 不可重跑的工具被崩溃打断后给模型的结果 | 附已提交的输出 | 2.16.4 |
| **View / viewState** | 结构视图（entries + 挂载文档）的快照与订阅 | 本地 UI 最常用 | 2.17 |
| **watch** | 快照 + 每笔提交的精确 ops | 远端同步用 | 2.17.3 |
| **Agent Events** | 从提交派生的高层事件（message_*、tool_execution_* …） | 对接 JSON 模式 | 2.18 |
| **Task Graph** | 所有活任务的图（面板/调试用） | 看不到「缺代码」 | 2.19 |
| **Usage** | token 与花费累计（`pi.usage`） | 失败也计数 | 2.20 |
| **Compaction** | 把旧上下文摘要成一条带 head 的 entry | 不删历史 | 3.4 |
| **stale** | 摘要落入「当前上下文起点之前」时的作废判定 | 切得最靠后的生效 | 3.4 |
| **Anchor / Reporter** | 后台 subagent 的锚任务 / 汇报任务 | 拥有子会话 + 投递答案 | 5.5.2 |
| **Conformance suite** | 存储契约的可执行断言集 | 自定义后端跑一遍即达标 | 6.4 |
| **Provider identity** | `pi.provider` 里的 UUIDv7，作为 `sessionId` 转发 | 子会话/fork 会新建 | 4.5.5 |

---

## 8.2 行号索引

需要直接跳到源码时用这张表。行号来自源码精读（第 4 部分），以文件为单位标注区间。

### 8.2.1 包根与 Session 层

| 概念 | 位置 |
|---|---|
| 公共导出面 | `src/index.ts:1-182` |
| Id / Seq / brand / 语义定义 | `src/types.ts:15-60` |
| 文档定义与 token 家族 | `src/types.ts:69-134` |
| 任务定义 / Runtime / 状态 / 记录 | `src/types.ts:137-552` |
| EntryRecord / EntryDraft / ContextEdit | `src/types.ts:301-346` |
| SubmissionRecord 状态机 | `src/types.ts:363-439` |
| DocumentRecord / base-delta 内容 / StorageWrite | `src/types.ts:555-702` |
| CommitPublication | `src/types.ts:705-738` |
| `Tx` 接口 | `src/types.ts:744-839` |
| `DocumentState` / `WatchHandle` / `DocumentObserver` | `src/types.ts:842-896` |
| `Session` 接口 | `src/types.ts:899-983` |
| `Storage` 接口 | `src/types.ts:993-1084` |
| `defineDoc` / `defineDocFamily`（含重载） | `src/documents.ts:39-80` |
| 地址解析与地址字符串身份 | `src/documents.ts:109-145` |
| 创建记录 / 作用域与版本校验 / 迁移物化 | `src/documents.ts:148-208` |
| `defineEntry` 与六个内建 kind | `src/entries.ts:6-34` |
| brand 贴牌边界 | `src/ids.ts:4-11` |
| 三个语义错误 | `src/errors.ts:4-28` |
| 提交主路径 `#runCommit` | `src/session/session.ts:404-444` |
| 发布 `#publish` | `src/session/session.ts:446-466` |
| 观察桥 `#attachDocument` | `src/session/session.ts:472-500` |
| 冷加载 `#loadDocument` | `src/session/session.ts:502-527` |
| `snapshot` / `documentState` / `watchDoc` / `snapshotAsOf` | `src/session/session.ts:162-348` |
| `close` 顺序 | `src/session/session.ts:350-368` |
| 提交/关闭订阅 | `src/session/session.ts:384-395` |
| 退役与观察者 ops 归约 | `src/session/session.ts:556-568` |
| 表读/表写规则 `#read` / `#write` | `src/session/transaction.ts:919-937` |
| settlement 三段 | `src/session/transaction.ts:659-694` |
| adopt（指针交换 + 发布描述） | `src/session/transaction.ts:697-751` |
| 装配 `#assemble` | `src/session/transaction.ts:753-845` |
| `planDocument` / `publishes` | `src/session/transaction.ts:968-1023` |
| 建会话与 fork `#stageConversation` | `src/session/transaction.ts:299-341` |
| `appendEntry` | `src/session/transaction.ts:358-379` |
| `createTask` | `src/session/transaction.ts:381-424` |
| `createSubmission` / `settleSubmission` / `placeSubmission` | `src/session/transaction.ts:427-454` |
| `doc` 获取路径与 `#acquire` | `src/session/transaction.ts:509-620` |
| fork copy 的 typed access 合并 | `src/session/transaction.ts:622-647` |
| `retireDoc` 四分支 | `src/session/transaction.ts:554-583` |
| `applySubmissionChange` | `src/session/transaction.ts:67-79` |
| fork 文档选源 | `src/session/forks.ts:26-97` |
| 状态桥 `CommittedStateSource` | `src/session/observation.ts:24-76` |
| watch 桥 `CommittedWatch` 与交付循环 | `src/session/observation.ts:155-297`（`#drain` 在 243-273） |

### 8.2.2 Harness 层

| 概念 | 位置 |
|---|---|
| 调度器常量与 live 状态集合 | `src/harness/scheduler.ts:54` |
| 打开时把遗留 `running` 改回 `pending` | `src/harness/scheduler.ts:244-246` |
| 唤醒合并 `#scheduleReconcile` | `src/harness/scheduler.ts:429-433` |
| 唤醒循环 `#kick` / `#drain` | `src/harness/scheduler.ts:675-696` |
| 挑任务与写入 `running`（`#reserve`） | `src/harness/scheduler.ts:699-742` |
| phase 执行 `#run` | `src/harness/scheduler.ts:852-873` |
| 决策 `#decide` / `#step` | `src/harness/scheduler.ts:879-959` |
| 状态结算 `#commitState` / 终态 `#terminate` | `src/harness/scheduler.ts:965-997` |
| `completing` 与 owned 工作 `#ownedLive` | `src/harness/scheduler.ts:613-631` |
| 终局收尾 `#finalize` | `src/harness/scheduler.ts:491-513` |
| waiting 兑现 `#waitingOn` / `#reconcile` / `#validateWait` | `src/harness/scheduler.ts:744-752`、`461-469`、`1003-1024` |
| abort 观察与传播 | `src/harness/scheduler.ts:368-373`、`914-929`、`650-663` |
| 空闲判定 `#idle` / 作用域 `#inScope` | `src/harness/scheduler.ts:1037-1044`、`633-648` |
| 异常路径 `#fit` / `#resolve` | `src/harness/scheduler.ts:754-781` |
| Harness 隐式 `resume()` 的三处 | `src/harness/harness.ts:105`、`146`、`151` |
| `waitForTask` / `waitForIdle` | `src/harness/harness.ts:275`、`280` |
| `beforeClose`（join 任务） | `src/harness/harness.ts:328-330` |
| `conversationCreated`（写内建文档） | `src/harness/harness.ts:356-363` |
| 生成栈（generation / tool / compaction / inbox / live / usage） | `src/harness/{generation,tool,compaction,inbox,live,usage}.ts`（第 4.4 节逐节给行号） |
| 配置与提示（agent / types / prompt / context / provider / registry） | `src/harness/{agent,types,prompt,context,provider,registry}.ts`（第 4.5 节） |
| 观察栈（view / events / output / task-graph / submissions / json / util / define） | `src/harness/{view,events,output,task-graph,submissions,json,util,define}.ts`（第 4.6 节） |

### 8.2.3 存储、环境与工具

| 概念 | 位置 |
|---|---|
| 分页（多取一项判断 next） | `src/storage/memory.ts:199-203` |
| 提交准备与幂等 apply | `src/storage/memory.ts:250-271` |
| 全局 ID / 文档动作 / 地址唯一性检查 | `src/storage/memory.ts:679-761` |
| 物化（找 base + 应用 delta 尾） | `src/storage/memory.ts:635-652` |
| fork 感知的可见 entry 生成器 | `src/storage/memory.ts:654-677` |
| SQLite 表结构与索引 | `src/storage/sqlite/migrations.ts:9-85` |
| SQLite 迁移执行 | `src/storage/sqlite/migrations.ts:106-124` |
| Node SQLite 打开（WAL / synchronous）与 close（checkpoint） | `src/storage/sqlite/node.ts:161-202` |
| 事务句柄契约 | `src/storage/sqlite/database.ts:18-34` |
| JSONL 提交（sidecar → marker）与编码 | `src/storage/jsonl/storage.ts:277-306`、`383-448` |
| JSONL 回收与 fsync 顺序 | `src/storage/jsonl/storage.ts:506-530` |
| 工具输出截断与落盘 | `src/truncate.ts:133-170` |
| 内建工具（read/write/edit/bash/image） | `src/tools/*.ts`（第 4.8 节） |
| 文件修改串行化 | `src/tools/file-mutation-queue.ts`（第 4.8.12 节） |
| Node 执行环境 | `src/env/node.ts`（第 4.8.2 节） |
| 一致性套件入口 | `src/testing/storage-conformance.ts`（23 个 case，第 4.9.6 节） |

---

## 8.3 实测记录（32 个示例）

环境：Node **v23.9.0** / Windows 10.0.26300（Microsoft Windows NT 10.0.26300.0）。命令：

```bash
cd packages/durable
node --conditions=source --experimental-strip-types test/examples/NN-name.ts
```

实测结论：**32/32 全部退出码 0，无超时**（串行总耗时约 25 秒；最长 `23-subagent-background` 约 3.5 秒）。每个脚本开头会打印 `ExperimentalWarning: Type Stripping`（用 SQLite 时另有 `ExperimentalWarning: SQLite`）——这是 Node 的实验特性提示，不是错误。

### 8.3.1 本机环境的两点偏差（重要）

1. **本机没有可用的 bash**（未安装 Git Bash，而 Harness 只查找 Git Bash 路径）。因此示例 `17`、`19`、`26`、`30` 里的 `bash` 工具调用返回 `No bash shell found` 的工具错误：
   - `17` 的 `cat /tmp/1gb.txt took … ms` 计的是**失败路径**；
   - `26` 的 cwd 切换、`30` 的 `VIRTUAL_ENV` 差异**无法在本机输出里验证**，需要装好 Git Bash 后复跑（对应示例讲解里已按此标注）；
   - 这不影响其它示例，也不影响 bash 之外的功能。
2. **示例 25 第 3 阶段以 `model_error` 结束**，与示例注释里写的「compacts and retries it once」不一致。原因：该 generation 的准备阶段已经因**阻塞阈值**创建过压缩（`compacted` 已置位），于是溢出路径不再触发「压缩 + 重试」——正好说明三种触发之间的互斥关系（详见 5.5.4）。这是**语义正确、示例注释略旧**的情况，不是 bug。
3. 示例 `30` 的已知 Windows `EBUSY`（收尾 `rm()`）本次**未复现**（两轮运行退出码 0）——该问题与文件句柄释放时机有关，视环境而定。

非确定性字段：时间戳、实体 id、随机临时目录名。两轮运行的输出忽略这些字段后逐字一致，说明示例可复现。

### 8.3.2 逐示例看点

| 示例 | 退出 | 实测看点 | 详解 |
|---|---|---|---|
| `00-conversation` | 0 | 宿主自建会话 id = 2（1 保留给根会话） | 5.2.1 |
| `01-documents` | 0 | `latest` 与 `as-of` 读法的差别（`after goodbye` / `after hello`） | 5.2.2 |
| `02-forks` | 0 | fork 只见 fork 点之前的 entry；文档按 `asOf` 取值且与父独立 | 5.2.3 |
| `03-owned-conversations` | 0 | 一笔提交同时建「后台任务 + 子会话 + 注册表文档」；`requestId` 防重复投递 | 5.2.4 |
| `04-chord-state` | 0 | Chord 状态两帧：`hydrate 0` → `update 1` | 5.2.5 |
| `05-watches` | 0 | `watchDoc` 的基线帧与增量帧 | 5.2.6 |
| `06-harness` | 0 | 存的 `{ thinkingLevel: 'low' }` 解析回 `low ['files'] ['read']` | 5.3.1 |
| `07-configuration` | 0 | 工具选择在 `['read','write','grep']` / `['write','read']` / `['grep']` 之间变化 | 5.3.2 |
| `08-harness-conversations` | 0 | fork 继承 `asOf` 配置（`high`），新建会话用默认（`minimal`） | 5.3.3 |
| `09-context` | 0 | 编辑生效、aborted 消息被跳过、工具结果重排、summary 截断上下文 | 5.3.4 |
| `10-registry-reload` | 0 | 同名重载换描述；wrap 加后缀；卸载即失效 | 5.3.5 |
| `11-extension-state` | 0 | 第二次请求的 `todos` section 渲染 `<todos>\nfix the build\n</todos>` | 5.3.6 |
| `12-tasks` | 0 | `{ status: 'completed', result: { receipt: 500 } }` | 5.3.7 |
| `13-recovery` | 0 | 检查点停在 `n: 2`（`pending`）；重跑不重复打印；最终数到 5 | 5.3.8 |
| `14-chat` | 0 | `answer: [ { type: 'text', text: 'Paris.' } ]`；转录 3 条 | 5.4.1 |
| `15-system-prompt` | 0 | 三个 section + wrap 后的 `preamble`；cwd 变化只追加一条差量 | 5.4.2 |
| `16-real-model` | 0 | 无 key 时打印 `skipped: OPENAI_API_KEY is not set` | 5.4.3 |
| `17-coding-tools` | 0 | 5 个 turn（4 工具 + 答案）；本机 bash 缺失 → 工具错误结果；JSONL 目录留在磁盘 | 5.4.4 |
| `18-print` | 0 | 一行最终答案（print 模式） | 5.4.5 |
| `19-json` | 0 | 首行 `snapshot`，随后每条事件一行 JSON；SQLite 路径被打印 | 5.4.6 |
| `20-inbox` | 0 | inbox 三项（followUp/steer/write）、reject 抛错、撤回 `aborted` | 5.4.7 |
| `21-late-join` | 0 | 接入时工具已输出 5 行；视图与事件流同步到十 | 5.4.8 |
| `22-subagent-foreground` | 0 | 子 agent 的回答缩进打印在工具调用下 | 5.5.1 |
| `23-subagent-background` | 0 | spawn/send/stop/status；重启后 `> reader: Moby Dick.` 仍被投递 | 5.5.2 |
| `24-child-tasks` | 0 | 三个场景（failFast 退款、取消、中断恢复）全部符合预期 | 5.5.3 |
| `25-compaction` | 0 | 手动压缩 `queued → done`；阈值与后台触发可见；溢出路径见 8.3.1 第 2 条 | 5.5.4 |
| `26-coding-agent` | 0 | CodingTools + 实时 settings；cwd 切换本机因缺 bash 未能验证 | 5.5.5 |
| `27-plan-mode` | 0 | 工具集切换与两条 `pi.system` 差量 | 5.5.6 |
| `28-reviewer` | 0 | `small ['coding-tools','reviewer'] ['read']`；`onYield` 追加一轮后收敛 | 5.5.7 |
| `29-sandbox-per-conversation` | 0 | 两个会话各自沙箱，互不可见 | 5.5.8 |
| `30-tool-override` | 0 | 同名 `bash` 覆盖与计时 wrap | 5.5.9 |
| `31-reload-and-restart` | 0 | 运行中的调用返回 `v1`、下一个 `v2`；重启未装扩展时工具为空，装回即 `['version']` | 5.5.10 |

---

## 8.4 延伸阅读与源码对照

### 8.4.1 README 章节 → 示例 → 源码

| README 章节 | 相关示例 | 源码位置 | 本手册 |
|---|---|---|---|
| Quick Start / Concepts | `14`、`00`–`05` | `src/harness/*`、`src/session/*` | 1.5、2.2–2.6 |
| Persist and Resume | `13`、`31` | `src/harness/submissions.ts`、`src/harness/generation.ts` | 3.6、7.1 |
| Extensions / Tools / Reload | `06`、`07`、`10`、`30`、`31` | `src/harness/{registry,define,tool}.ts`、`src/tools/*` | 2.12、2.16 |
| System Prompt | `15`、`27` | `src/harness/prompt.ts`、`src/entries.ts` | 2.14 |
| Per-Conversation Agent / Settings | `07`、`26`、`27`、`28` | `src/harness/agent.ts` | 2.13 |
| Environment | `17`、`26`、`29` | `src/env/{index,node}.ts`、`src/tools/env.ts` | 2.15 |
| Watching / Busy / Late join | `05`、`16`、`19`、`20`、`21` | `src/harness/{view,events,inbox,live}.ts`、`src/session/observation.ts` | 2.17–2.18、2.9 |
| Reset and Handoff | `09`（head 机制） | `src/entries.ts`、`src/harness/generation.ts` | 2.6.2、3.5 |
| Compaction | `25` | `src/harness/compaction.ts` | 3.4 |
| Hooks | `17`、`25`、`28` | `src/harness/types.ts` | 2.16、3.2 |
| Forks | `02`、`08`、`09` | `src/session/forks.ts` | 2.5.7 |
| Abort and Subagents | `22`、`23` | `src/harness/scheduler.ts`、`src/harness/tool.ts` | 2.8.7、3.3、5.5 |
| Child Tasks / Task Graph | `24` | `src/tasks.ts`、`src/harness/task-graph.ts` | 2.7、2.19 |
| Your Own State | `01`、`11`、`27`、`29` | `src/documents.ts`、`src/session/transaction.ts` | 2.5 |
| Usage and Cost | 任意示例后调 `harness.usage(ctx)` | `src/harness/usage.ts` | 2.20 |
| Storage | `13`、`17`、`19` 的 `--storage` 分支 | `src/storage/*`、`src/testing/storage-conformance.ts` | 2.1、6.4、7.3 |

### 8.4.2 其它材料

- `packages/durable/README.md`：包自述（面向使用者）。
- `packages/durable/docs/spec.md`：**规范**（4,628 行）。遇到「到底该不该」的争议查它；本手册引用它的地方都标了行号。
- `packages/durable/docs/pico-v5-handoff.md`：实现计划（分层理由、各阶段目标）。
- `packages/durable/docs/pico-v5-chord-usage.md`：本包如何用 Chord（文档、事务、watch 的边界条件与 footguns）。
- `packages/durable/docs/chord-delta-findings.md`：delta 与 checkpoint 策略的实测发现。
- `packages/durable/test/`：84 个文件、约 28,000 行；第 6 部分的测试地图给出「哪个文件断言哪条规则」。
- `packages/coding-agent/src/experimental/durable/`：把本手册的概念做成真 TUI 的参考实现（视图只渲染 `viewState()`、Esc、`/agents`、`/tasks`、`--continue`）。
- `packages/chord/README.md` 与 `packages/chord/src/delta/README.md`：Context、状态与 delta 的权威说明（第 0.3 节的延伸）。

### 8.4.3 学习路径（按目标）

| 目标 | 路径 | 时间 |
|---|---|---|
| 会用 API 写产品 | 0.1 → 0.2 → 0.4 → 1.5 → 2.10–2.13 → 2.17 → 5（示例）→ 7 | 1–2 天 |
| 接 UI / HTTP 服务 | 2.17–2.19 → 3.5 → 7.3 | 半天 |
| 写持久任务 | 2.7 → 3.3 → 3.7 → 6.3 | 半天 |
| 改造内核 | 通读第 2、3 部分 → 第 4 部分 → 第 6 部分 → 回到 `spec.md` | 3–5 天 |
| 评审可用性 | 1.2 → 3.6 → 6.3 → 7.2 → 7.4 | 半天 |

### 8.4.4 练习清单（可当作结课作业）

1. 把示例 `00` 换成 SQLite，跑两遍，验证「重开即同一份状态」。
2. 在 `06` 里加一个扩展提供 `grep` 工具，用 `tools: { remove: [read] }` 去掉一个工具，打印 `agent.tools` 验证顺序与过滤。
3. 给 `11` 的 `Todos` 加 `fork: "initial"`，fork 一个会话，观察 todos 从空开始（对照 `asOf`）。
4. 把 `13` 的 `runtime.memo` 换成「直接打印」，跑两遍观察副作用重复；再用 memo 修回来。
5. 给 `17` 加一个 `beforeTool` 钩子，拦截含 `rm -rf` 的 bash 命令并返回 `{ block }`，验证模型收到的是被拦的结果。
6. 在 `20` 里把 `followUpMode` 改成默认的 `one-at-a-time`，对比 inbox 与转录的变化。
7. 在 `24` 里把 `failFast` 换成 `allSettled`，再加一张过期卡，观察 `outcomes` 与退款打印顺序。
8. 在 `27` 里加第三个模式（例如「只读调研」），用同一个 `configure()` 机制切换，并检查 `pi.system` 的 `toolsAdded` / `toolsRemoved`。
9. 用 `harness.taskGraph()` 观察 `22` 的运行：父 generation 与它的 `pi.tool` 子任务成树；子会话自己的 generation 是**独立的顶层节点**。
10. 给 `29` 的 `env` 回调加一个「容器 id → ExecutionEnv」缓存（按 `id` 复用），对照 `ExecutionEnv.id` 的语义。
11. 给 `25` 写一个 `beforeCompact` hook，直接提供自己的摘要（省掉一次模型调用），观察 `stale` 判定与放置时机。
12. 写一个自己的持久任务（例如「把三个目录并行索引」），跑到一半 `close()`，用新 Harness `waitForTask()` 验证恢复（第 3.7 节的检查表逐条过）。

---
