# 05. Agent 循环：轮次、结束、排队与取消

> 预计时间：2 小时（不含选读）
> 先修：03 消息、事件、状态；04 模型与供应商

## 本篇你会学到

- 说出一次 `Agent.prompt()` 中有几个轮次（turn），以及循环在什么条件下停止。
- 说出 steer 与 followUp 两个队列各在哪个检查点被取走。
- 说出 `abort()` 发出的取消信号被谁收到，以及运行为什么要等到 `agent_end` 之后才真正结束。

## 先用一个例子理解

用户输入："读取 demo.txt，并总结三点。"

模型只能输出文字，读不到你电脑上的文件。要完成这件事，pi 需要请求模型两次：

1. 第一次请求。模型回答："请调用 `read` 工具读取 `demo.txt`。" 这条回答里带一个 `toolCall`（工具调用）内容块。
2. pi 在本地执行 `read`，拿到文件文字，把它记为 `toolResult`（工具结果）消息，加入对话。
3. 第二次请求。模型读到文件内容，回答三点总结。

假设没有循环，第一次回答后 pi 就停了。工具结果永远不会送回模型，模型也无法总结。所以需要一段代码反复判断三件事：

- 要不要再请求模型？（模型刚才调用了工具，或者钩子要求继续）
- 有没有运行中新加入的消息要插进来？
- 能不能结束？（上面两件都没有，并且没有出错或被取消）

本篇按这个顺序读：先看无工具的一次回答（循环在第一次回答后结束），再看工具调用（循环继续），然后看结束条件表，接着看排队，最后看取消。

## 核心概念

本篇有 6 个核心概念。其他术语在第一次出现时解释。

1. **运行（run）**：一次 `Agent.prompt()` 或 `Agent.continue()` 调用，从 `agent_start` 开始，到 `agent_end` 结束。一次运行可以包含多个轮次。
2. **轮次（turn）**：一次模型回答，加上这次回答引发的工具执行。`turn_start` 开始，`turn_end` 结束。"读文件并总结"的运行有两个轮次。
3. **钩子（hook）**：宿主传给循环的回调函数，循环在固定时间点调用它，例如 `finishTurn`。钩子返回 `undefined` 表示"不改变原有调度"。
4. **队列（steering 与 followUp）**：运行中新输入的消息先放进队列，由循环在固定检查点取走。steering 在当前轮结束后、下一次请求前插入；followUp 在 agent 准备停止时才处理。
5. **取消信号（AbortSignal）**：Web 与 Node 标准的取消标记。`agent.abort()` 把它的 `aborted` 设为 `true`。代码必须主动检查它，信号本身不会终止异步函数。
6. **结算（settle）**：所有 `agent_end` 监听器结束、运行状态清理完成之后。`waitForIdle()` 在结算后才 resolve。

### 1. 无工具：一次回答后循环结束

问题：用户输入 "hi"，模型回答 "Hello"。循环要判断这次运行是否还有事要做。

例子的源码路径：`packages/agent/src/agent-loop.ts` 的 `runLoop` 内层 `while (hasMoreToolCalls || pendingMessages.length > 0)`。第一次进入时 `hasMoreToolCalls` 为 `true`，所以请求模型。回答里没有 `toolCall`，代码把 `hasMoreToolCalls` 设为 `false`。之后 T2 取 steering 得到空数组，内层条件为假，退出。T3 取 follow-up 也为空，于是发出 `agent_end` 并返回。

实际运行得到的事件序列（`message_update` 已省略，见动手实验 1）：

```text
agent_start
turn_start
message_start user / message_end user
message_start assistant / message_end assistant
turn_end assistant stop=stop
agent_end
```

要点：用户消息的事件由 `runAgentLoop` 发出，不是模型流发出的。`stop` 表示模型正常说完。

### 2. 有工具：工具结果送回模型，循环继续

问题：模型要求调用工具，但它还不知道结果。如果此时结束，模型永远看不到文件内容。

例子：`read demo.txt`。模型回答里带 `toolCall`。`streamAssistantResponse` 返回这条消息后，`runLoop` 调用 `executeToolCalls`，它返回 `{ messages, terminate }`。代码写的是：

```text
hasMoreToolCalls = !executedToolBatch.terminate
```

`terminate` 默认是 `false`，所以 `hasMoreToolCalls` 为 `true`。工具结果消息被加入 `currentContext.messages`，因此下一次请求能看到它。循环回到内层开头，发起第二次请求。

实际运行得到的事件序列（动手实验 2）：

```text
turn_start
message_start user / message_end user
message_start assistant / message_end assistant      （toolCall 那一条）
tool_execution_start read
tool_execution_end read isError=false
message_start toolResult / message_end toolResult
turn_end assistant stop=toolUse
turn_start
message_start assistant / message_end assistant      （文字总结）
turn_end assistant stop=stop
agent_end
```

要点：两对 `turn_start` 和 `turn_end`，属于同一次运行。`tool_execution_*` 不增加轮次。工具结果也有完整的 `message_start` 与 `message_end`，与模型消息一样。

### 3. 结束条件表

问题：只看"模型有没有调用工具"不够。循环还要看队列、钩子的决定，以及是否出错或被取消。

下面的表来自 `packages/agent/src/agent-loop.ts` 的 `runLoop`，钩子的类型来自 `packages/agent/src/types.ts`。

| # | 条件 | 发生位置（`runLoop`） | 结果 |
| - | ---- | --------------------- | ---- |
| 1 | 回答的 `stopReason` 是 `error` | 失败早退分支 | 调用 `finishTurn`（返回值被忽略）→ `turn_end` → `agent_end`，然后 `return` |
| 2 | 回答的 `stopReason` 是 `aborted` | 同上 | 同上 |
| 3 | `finishTurn` 返回 `{ action: "end" }` | `turn_end` 之后 | 发 `agent_end` 并 `return`，不读取两个队列 |
| 4 | 本批工具结果全部 `terminate: true` | `hasMoreToolCalls = !terminate` | 内层不再因工具而继续；其他条件仍可能续跑 |
| 5 | 没有工具调用、没有 steering、没有 follow-up、没有 continue | 内层退出 → T3 → `break` | 发 `agent_end` |
| 6 | 内层退出时有 follow-up | T3 | `pendingMessages` 设为 follow-up，回到外层，重新进入内层 |
| 7 | `finishTurn` 返回 `{ action: "continue" }` | `explicitContinuation` | 外层重进内层：多一次不带新消息的模型请求 |
| 8 | 有 steering 消息 | T2 | 注入后继续 |
| 9 | 运行被取消 | 工具执行器与模型流的检查点 | 不会立即结束；最终按 #2 的 `aborted` 分支收尾（见下文"5. 取消"） |
| 10 | 被 `await` 的钩子抛错或 reject，例如 `prepareRequest` | `runLoop` 中的调用处 | 异常从 `runLoop` 抛出。`Agent` 类在 `runWithLifecycle` 中捕获，转为 `error` 消息（见常见错误 5） |

另一种情况：`stopReason` 是 `length`（输出被 token 上限截断）且含 `toolCall` 时，循环不执行任何工具。`failToolCallsFromTruncatedMessage` 为每个调用生成错误结果，并返回 `terminate: false`，所以模型会在下一次请求里看到错误并重新发起。

三条必须记住的规则：

- **错误和取消是硬退出。** `finishTurn` 仍会被调用并被 `await`，但它的返回值被丢弃。即使返回 `{ action: "continue" }`，循环也不会再请求模型。
- **`terminate: true` 不结束运行。** 它只表示"这一批工具不因工具而继续"。如果模型下一轮又调用工具，或者有排队消息，循环照常继续。要硬停，要用 `finishTurn` 返回 `{ action: "end" }`。
- **`{ action: "continue" }` 每次都会多一次模型请求。** 源码中没有最大轮数计数器。如果钩子无条件返回 `continue`，循环不会停止，每一轮都是真实请求。写钩子时要有外部计数或预算兜底。

### 4. 排队：steer 与 followUp

问题：模型正在执行 `read demo.txt`，用户想补一句"顺便把 README 也看一下"。如果直接调用 `prompt()`，会得到错误，因为 `Agent.prompt()` 在已有运行时抛出 "Agent is already processing a prompt"（`packages/agent/src/agent.ts`）。所以新输入要先入队。

`Agent` 提供两个入队方法：

```typescript
agent.steer(message);     // 放入 steeringQueue
agent.followUp(message);  // 放入 followUpQueue
```

两个方法只做入队，不发出任何事件。队列变化的事件由会话层 `AgentSession` 发出（见下文"会话层入口"）。

循环在四个固定检查点取队列。下表对应 `runLoop` 的代码：

| 检查点 | 代码位置 | 取哪个队列 | 取到的消息何时进入模型请求 |
| ------ | -------- | ---------- | -------------------------- |
| T0 | 循环开始前的第一次 `getSteeringMessages()` | steering | 本次运行的第一次请求之前 |
| T1 | `prepareNextTurn` 之后、注入消息之前；只有 T0 或前一次取值为空时才再取 | steering | 本轮注入时。这是为了覆盖压缩等耗时准备期间新入队的消息 |
| T2 | `turn_end` 之后，决定是否继续时 | steering | 下一轮注入，即下一次模型请求之前 |
| T3 | 内层循环退出之后 | follow-up | 外层重进内层，作为新的一轮注入 |

两种队列的区别，用实际运行看最清楚。

- steering 的例子：工具运行时入队 `STEER`。工具结束后，T2 取到它，第二次请求的上下文里就有 `STEER`。实际输出见动手实验 3。
- follow-up 的例子：工具运行时入队 `FOLLOW`。工具结束后模型给出普通文字回答，没有工具、没有 steering，内层退出。T3 取到 `FOLLOW`，外层重进内层，于是多跑一个轮次。第三次请求的上下文里才有 `FOLLOW`。

**队列模式（one-at-a-time）。** `PendingMessageQueue` 有两种取用模式。`"all"` 一次取走全部消息；`"one-at-a-time"` 每次只取最旧的一条。`Agent` 构造器对两个队列的默认值都是 `"one-at-a-time"`。好处是：用户连发两条 steering 时，模型不会一次面对两条矛盾指令，而是一条一条处理。实际运行见动手实验 3 之后的选读 C：两条 steering 分两个轮次注入，第二次请求只看到 `STEER1`。

**会话层入口。** `AgentSession.steer()` 与 `AgentSession.followUp()` 会先把消息记入会话自己的 `_steeringMessages`，发出 `queue_update` 事件，然后调用 `agent.steer()` 或 `agent.followUp()`（`packages/coding-agent/src/core/agent-session.ts`）。`AgentSession.prompt(text, { streamingBehavior })` 在运行中会按这个选项入队；没有该选项时抛错。

### 5. 取消：abort() 从头到尾

问题：用户按 Esc。模型流可能正在输出，工具可能正在运行。pi 要让所有异步步骤都知道"停止"，并且运行结束后状态仍然一致。

从入口到收束的链路如下：

```text
AgentSession.abort()                 会话层：设置 _agentRunAbortRequested，取消重试与压缩，调用 agent.abort()，然后等待空闲
  └─ Agent.abort()                   activeRun.abortController.abort()，signal.aborted 立即变为 true
       ├─ streamFunction             收到 options.signal；供应商流应以 stopReason "aborted" 结束
       ├─ tool.execute               第三个参数 signal，由工具自己检查
       ├─ 钩子                        transformContext、prepareRequest、prepareNextTurn、finishTurn、beforeToolCall、afterToolCall 都收到 signal
       ├─ 工具执行器                  检查 signal.aborted，决定是否跳过未开始的工具
       └─ subscribe 监听器            第二个参数就是本次运行的 signal
runLoop 收尾 → 发 agent_end → runWithLifecycle 的 finally → finishRun → activeRun.resolve()（waitForIdle 返回）
```

各处的检查点（来自 `packages/agent/src/agent-loop.ts`）：

| 位置 | 检查方式 | 结果 |
| ---- | -------- | ---- |
| `executeToolCallsSequential` | 每个工具收尾后检查 `signal?.aborted`，为真则 `break` | 后续工具没有 start/end 事件，也没有结果消息 |
| `executeToolCallsParallel` 准备阶段 | 每个调用准备后检查，为真则 `break` | 尚未准备的调用没有事件 |
| `executeToolCallsParallel` 执行闭包 | 闭包开头检查，为真则不执行，返回错误结果 `Operation aborted` | 工具不被调用，但有 `tool_execution_end` |
| `prepareToolCall` | 钩子返回后、以及返回 `prepared` 前检查 | 返回错误结果 `Operation aborted` |
| `runLoop` 请求模型之前 | 没有检查 | 循环直接请求模型，由流以 `aborted` 结束 |

`runLoop` 请求模型之前没有检查，这一点很重要。实际运行显示：即使取消发生在工具之后，循环仍会发起下一次模型请求，faux 计数为 2。真正的供应商是否会拒绝或跳过这次请求，本篇没有在本地验证。

三个时刻可能不同，要分开看。

1. **取消请求的时刻**：`agent.abort()` 调用的那一刻，`signal.aborted` 同步变为 `true`。
2. **工具看到信号的时刻**：工具自己检查 `signal` 的时刻，可能很晚，也可能从不检查。
3. **运行收束的时刻**：工具返回、循环走完、发出 `agent_end`、监听器结束、`isStreaming` 变为 `false` 的时刻。

实际运行的三个场景（动手实验 4）：

| 场景 | `execute` 是否被调用 | 工具结束事件的 `isError` | faux 请求次数 | 结果 |
| ---- | -------------------- | ------------------------ | ------------- | ---- |
| abort 发生在工具开始之后、`execute` 之前 | 否 | `true`（结果文字为 `Operation aborted`） | 2 | 最终 `turn_end stop=aborted` |
| 工具内部监听 `signal`，收到后返回 | 是，且工具看到 `signal.aborted` 为 `true` | `false` | 2 | 最终 `turn_end stop=aborted` |
| 工具忽略信号，等外部释放后才返回 | 是 | `false` | 2 | `abort()` 返回后 `isStreaming` 仍为 `true`，`await` 运行结束后为 `false` |

第三行说明时间差：`abort()` 本身很快返回，但运行只有在工具真正返回、循环收束后才结束。所以取消请求与"所有异步工作完成"之间可能隔很久。

会话层还有一层。`AgentSession.abort()` 在运行活跃时设置 `_agentRunAbortRequested`，取消重试、压缩和分支摘要，调用 `agent.abort()`，然后 `await this.waitForIdle()`。`_runAgentPrompt` 的 `finally` 中调用 `_emitAgentSettled()`，它会发出 `agent_settled` 事件（源码核对，本篇没有运行会话层）。`agent_settled` 只存在于会话层；低层 `Agent` 没有这个事件，等价的信号是 `waitForIdle()` 的 resolve。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径 | 符号 | 读的时候关注什么 |
| ---- | -------- | ---- | ---------------- |
| 1 | `packages/agent/src/agent.ts` | `Agent.prompt` | 检查 `activeRun`，然后调用 `runPromptMessages` |
| 2 | `packages/agent/src/agent.ts` | `Agent.continue` | 最后一条是 assistant 时，先用队列消息开新运行 |
| 3 | `packages/agent/src/agent.ts` | `Agent.runWithLifecycle` | 创建 `AbortController`，设置 `isStreaming`，`finally` 中调用 `finishRun` |
| 4 | `packages/agent/src/agent.ts` | `Agent.createLoopConfig` | 队列如何接到 `getSteeringMessages` 与 `getFollowUpMessages` |
| 5 | `packages/agent/src/agent-loop.ts` | `runAgentLoop` | 发出 `agent_start` 和第一个 `turn_start`，然后进入 `runLoop` |
| 6 | `packages/agent/src/agent-loop.ts` | `runLoop` | 外层 follow-up 循环、内层 turn 循环，以及 T0 到 T3 |
| 7 | `packages/agent/src/agent-loop.ts` | `streamAssistantResponse` | 请求模型，把流折叠成一条 `AssistantMessage` |
| 8 | `packages/agent/src/agent-loop.ts` | `executeToolCalls` | 选择顺序执行还是并行执行 |
| 9 | `packages/agent/src/agent-loop.ts` | `executeToolCallsSequential`、`executeToolCallsParallel` | 取消检查点的位置 |
| 10 | `packages/agent/src/agent-loop.ts` | `prepareToolCall` | 工具不存在、参数校验失败、钩子拦截、取消，都在这里变成错误结果 |
| 11 | `packages/agent/src/types.ts` | `AgentLoopConfig`、`FinishTurn`、`PrepareRequest` | 钩子的名字、参数和返回类型 |
| 12 | `packages/agent/src/agent.ts` | `Agent.abort`、`Agent.waitForIdle`、`Agent.finishRun` | 取消入口，等待空闲的 Promise，清理状态 |
| 13 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession.abort`、`AgentSession._runAgentPrompt`、`AgentSession._emitAgentSettled` | 会话层取消与 `agent_settled` |

### 钩子名称与类型

以下名称与类型都来自 `packages/agent/src/types.ts`。

| 名称 | 类型 | 何时调用 | 能改什么 |
| ---- | ---- | -------- | -------- |
| `transformContext` | `(messages, signal?) => Promise<AgentMessage[]>` | 每次模型请求前，转换成 LLM 消息之前 | 返回要参与转换的消息 |
| `convertToLlm` | `(messages) => Message[] \| Promise<Message[]>` | 每次模型请求前 | 把内部消息转成模型消息 |
| `prepareNextTurn` | `(context: PrepareNextTurnContext) => AgentLoopTurnUpdate \| undefined` | `turn_end` 之后，且循环将继续，下一轮开始前 | 替换 `context`、注入 `messages`、换 `model` 或 `thinkingLevel` |
| `prepareRequest` | `(request: PrepareRequestContext, signal?) => AgentRequestUpdate \| void` | 每次模型请求前，包括第一次；消息已注入 | 替换 `context`、`model`、`thinkingLevel`，不能注入消息 |
| `finishTurn` | `(turn: AgentTurnContext, signal?) => AgentTurnDecision \| void` | 工具结果之后，`turn_end` 之前 | 返回 `{ action: "end" }` 或 `{ action: "continue" }`；返回 `undefined` 保持默认调度 |
| `getSteeringMessages` | `() => Promise<AgentMessage[]>` | T0、T1、T2 | 返回要注入的 steering 消息；返回 `[]` 表示没有 |
| `getFollowUpMessages` | `() => Promise<AgentMessage[]>` | T3 | 返回要注入的 follow-up 消息 |
| `beforeToolCall` | `(context: BeforeToolCallContext, signal?) => Promise<BeforeToolCallResult \| undefined>` | 参数校验通过后，执行前 | `{ block: true }` 阻止执行，循环产生错误结果 |
| `afterToolCall` | `(context: AfterToolCallContext, signal?) => Promise<AfterToolCallResult \| undefined>` | 工具执行后，`tool_execution_end` 之前 | 按字段覆盖 `content`、`details`、`isError`、`usage`、`terminate` |

`AgentTurnDecision` 的类型是 `{ action: "continue" } | { action: "end" }`，是对象，不是字符串。

`Agent` 类上的 `prepareNextTurn` 签名与 `AgentLoopConfig` 不同：它接收 `signal`，不接收 `context`。需要 `context` 时使用 `prepareNextTurnWithContext`。`createLoopConfig` 负责把两者接到循环上（见选读 A.4）。

## 走读一次完整过程

下面三张表是状态轨迹。每一步写清楚发生了什么、调用哪个函数，以及循环变量变成什么。

变量含义：

- `hasMoreToolCalls`：是否因为工具结果需要再请求一次模型。
- `pendingMessages`：下一次注入前已取到的队列消息。

### 轨迹 A：无工具

输入：`prompt("hi")`，模型回答 "Hello from faux."

| 步 | 发生了什么 | 对应函数 | hasMoreToolCalls | pendingMessages | 发出的事件 |
| -- | ---------- | -------- | ---------------- | --------------- | ---------- |
| 1 | 检查 `activeRun` 为空，创建 `AbortController`，`isStreaming` 设为 `true` | `Agent.prompt` → `runWithLifecycle` | — | — | 无 |
| 2 | 用户消息进入上下文，发出 `agent_start` 与第一个 `turn_start`，逐条发出用户消息事件 | `runAgentLoop` | — | — | `agent_start`，`turn_start`，`message_start/end user` |
| 3 | T0：取 steering，得到空数组 | `runLoop` | `true` | `[]` | 无 |
| 4 | 首轮不调用 `prepareNextTurn`；没有待注入消息；`prepareRequest`（若有）执行后请求模型 | `runLoop` → `streamAssistantResponse` | `true` | `[]` | `message_start/end assistant` |
| 5 | 回答没有 `toolCall`，设 `hasMoreToolCalls = false` | `runLoop` | `false` | `[]` | 无 |
| 6 | 调用 `finishTurn`（若有），发出 `turn_end` | `runLoop` | `false` | `[]` | `turn_end stop=stop` |
| 7 | T2：取 steering，得到空数组；`explicitContinuation` 为 `false` | `runLoop` | `false` | `[]` | 无 |
| 8 | 内层条件为假，退出；T3：取 follow-up，得到空数组 | `runLoop` | `false` | `[]` | 无 |
| 9 | 发出 `agent_end` 并返回 | `runLoop` | `false` | `[]` | `agent_end` |
| 10 | `finally` 中执行 `finishRun`：`isStreaming` 置为 `false`，`activeRun` 清空，`waitForIdle` 的 Promise resolve | `runWithLifecycle` → `finishRun` | — | — | 无 |

### 轨迹 B：有工具

输入：`prompt("read demo.txt and summarize")`。第一次回答带 `read` 调用，第二次回答是文字总结。

| 步 | 发生了什么 | 对应函数 | hasMoreToolCalls | pendingMessages | 发出的事件 |
| -- | ---------- | -------- | ---------------- | --------------- | ---------- |
| 1 | 与轨迹 A 的步 1 到 2 相同 | `Agent.prompt`，`runAgentLoop` | — | — | `agent_start`，`turn_start`，用户消息事件 |
| 2 | T0：取 steering，得到空数组 | `runLoop` | `true` | `[]` | 无 |
| 3 | 请求模型，回答带 `toolCall`（`read`） | `streamAssistantResponse` | `true` | `[]` | `message_start/end assistant` |
| 4 | 回答有工具调用：先设 `hasMoreToolCalls = false`，再执行批次 | `runLoop` → `executeToolCalls` → `executeToolCallsParallel` | `false` | `[]` | `tool_execution_start read` |
| 5 | 工具返回；`terminate` 默认为 `false`，批次结果 `hasMoreToolCalls = !false` | `executePreparedToolCall` → `finalizeExecutedToolCall` | `true` | `[]` | `tool_execution_end read isError=false`，`message_start/end toolResult` |
| 6 | 工具结果加入 `currentContext.messages` 与 `newMessages` | `runLoop` | `true` | `[]` | 无 |
| 7 | 记录 `lastCompletedTurn`，调用 `finishTurn`（若有） | `runLoop` | `true` | `[]` | 无 |
| 8 | 发出 `turn_end` | `runLoop` | `true` | `[]` | `turn_end stop=toolUse` |
| 9 | T2：取 steering，得到空数组；`hasMoreToolCalls` 为真，内层继续 | `runLoop` | `true` | `[]` | 无 |
| 10 | 进入第二轮：有 `lastCompletedTurn`，调用 `prepareNextTurn`（若有），补取 steering（仍为空），发出 `turn_start` | `runLoop` | `true` | `[]` | `turn_start` |
| 11 | 请求模型，回答没有 `toolCall` | `streamAssistantResponse` | `false` | `[]` | `message_start/end assistant` |
| 12 | 调用 `finishTurn`（若有），发出 `turn_end`；T2 取得空数组；内层退出；T3 取得空数组 | `runLoop` | `false` | `[]` | `turn_end stop=stop` |
| 13 | 发出 `agent_end`，`finally` 执行 `finishRun` | `runLoop`，`finishRun` | `false` | `[]` | `agent_end` |

这次运行有两个轮次、两次模型请求。工具执行没有增加轮次。

### 轨迹 C：排队的 steering

输入：`prompt("start")`。第一次回答调用 `wait` 工具。工具开始执行时，监听器调用 `agent.steer(STEER)`。

| 步 | 发生了什么 | 对应函数 | hasMoreToolCalls | pendingMessages | 发出的事件 |
| -- | ---------- | -------- | ---------------- | --------------- | ---------- |
| 1 | 与轨迹 B 的步 1 到 3 相同：请求模型，回答带 `toolCall`（`wait`） | `streamAssistantResponse` | `true` | `[]` | `message_start/end assistant` |
| 2 | 工具开始。监听器调用 `agent.steer(STEER)`，消息进入 `steeringQueue`。此时循环变量还没有变化 | `executeToolCallsParallel`，`Agent.steer` | `false` | `[]` | `tool_execution_start wait` |
| 3 | 工具结束，结果加入上下文 | `executePreparedToolCall`，`finalizeExecutedToolCall` | `true` | `[]` | `tool_execution_end wait`，`message_start/end toolResult` |
| 4 | 记录 `lastCompletedTurn`，调用 `finishTurn`（若有），发出 `turn_end` | `runLoop` | `true` | `[]` | `turn_end stop=toolUse` |
| 5 | T2：`getSteeringMessages` 调用 `steeringQueue.drain()`，取走 `[STEER]` | `runLoop`，`createLoopConfig` 中的闭包 | `true` | `[STEER]` | 无 |
| 6 | 进入第二轮：`prepareNextTurn`（若有）；`pendingMessages` 非空，不再补取；发出 `turn_start` | `runLoop` | `true` | `[STEER]` | `turn_start` |
| 7 | 注入 `STEER`：逐条发出事件，并加入上下文；清空 `pendingMessages` | `runLoop` | `true` | `[]` | `message_start/end user` |
| 8 | 请求模型，第二次请求的上下文已包含 `STEER`；回答没有 `toolCall` | `streamAssistantResponse` | `false` | `[]` | `message_start/end assistant` |
| 9 | `turn_end`；T2 与 T3 都取得空数组；发出 `agent_end` | `runLoop` | `false` | `[]` | `turn_end stop=stop`，`agent_end` |

注意第 2 步：`agent.steer()` 只是入队。消息在第 5 步才被取走，并且只有在工具结束后的 T2 才会进入模型请求。

## 动手实验

实验只使用 faux 假模型，不调用真实 API，不需要密钥。脚本直接加载仓库中的 TypeScript 源码，不需要 `npm run build`。

### 准备（所有实验共用）

- Node.js 版本需要 `>= 22.19.0`（与根目录 `package.json` 的 `engines` 一致）。本篇输出是在 Node v23.9.0 上得到的。
- 依赖需要已安装。若未安装，在仓库根目录执行 `npm install --ignore-scripts`。
- 在系统临时目录中建立一个文件夹，放入三个文件：`register.mjs`、`hooks.mjs`、`doc-lab.mjs`。

`register.mjs`：

```javascript
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
```

`hooks.mjs`。把 `REPO` 改成你的仓库根目录，并使用正斜杠。

```javascript
import { pathToFileURL } from "node:url";

const REPO = "D:/Github/pi";
const SRC = {
	"@earendil-works/pi-ai": `${REPO}/packages/ai/src/index.ts`,
	"@earendil-works/pi-ai/compat": `${REPO}/packages/ai/src/compat.ts`,
	"@earendil-works/pi-agent-core": `${REPO}/packages/agent/src/index.ts`,
};
const REPO_PARENT = pathToFileURL(`${REPO}/packages/agent/src/probe.ts`).href;

export async function resolve(specifier, context, nextResolve) {
	if (SRC[specifier]) {
		return { url: pathToFileURL(SRC[specifier]).href, shortCircuit: true };
	}
	const isBare = !/^(\.|\/|node:|file:)/.test(specifier);
	if (isBare) {
		return nextResolve(specifier, { ...context, parentURL: REPO_PARENT });
	}
	return nextResolve(specifier, context);
}
```

`doc-lab.mjs`：

```javascript
import { Agent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

const reg = registerFauxProvider();
const log = [];

function makeAgent(tools) {
	const agent = new Agent({
		streamFn: streamSimple,
		initialState: { model: reg.getModel(), systemPrompt: "", tools },
	});
	agent.subscribe((event) => {
		if (event.type === "message_update") return;
		const parts = [event.type];
		if (event.message) parts.push(event.message.role);
		if (event.toolName) parts.push(event.toolName);
		if (event.type === "turn_end") parts.push(`stop=${event.message.stopReason}`);
		if (event.type === "tool_execution_end") parts.push(`isError=${event.isError}`);
		log.push(parts.join(" "));
	});
	return agent;
}

function tool(name, execute) {
	return { name, label: name, description: name, parameters: Type.Object({}), execute };
}

function user(text) {
	return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function gate() {
	let open = () => {};
	const promise = new Promise((resolve) => {
		open = resolve;
	});
	return { promise, open };
}

const scenarios = {
	async "no-tools"() {
		reg.setResponses([fauxAssistantMessage("Hello from faux.")]);
		await makeAgent([]).prompt("hi");
	},
	async tool() {
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("read", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("Summary: demo text"),
		]);
		const read = tool("read", async () => ({ content: [{ type: "text", text: "demo text" }], details: {} }));
		await makeAgent([read]).prompt("read demo.txt and summarize");
	},
	async steer() {
		const g = gate();
		let sawSteer = false;
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			(context) => {
				sawSteer = JSON.stringify(context.messages).includes("STEER");
				return fauxAssistantMessage("ok");
			},
		]);
		const wait = tool("wait", async () => {
			await g.promise;
			return { content: [{ type: "text", text: "released" }], details: {} };
		});
		const agent = makeAgent([wait]);
		agent.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				agent.steer(user("STEER"));
				g.open();
			}
		});
		await agent.prompt("start");
		log.push(`request 2 saw STEER: ${sawSteer}`);
	},
	async followup() {
		const g = gate();
		let sawFollow = false;
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("first answer"),
			(context) => {
				sawFollow = JSON.stringify(context.messages).includes("FOLLOW");
				return fauxAssistantMessage("follow-up answer");
			},
		]);
		const wait = tool("wait", async () => {
			await g.promise;
			return { content: [{ type: "text", text: "released" }], details: {} };
		});
		const agent = makeAgent([wait]);
		agent.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				agent.followUp(user("FOLLOW"));
				g.open();
			}
		});
		await agent.prompt("start");
		log.push(`request 3 saw FOLLOW: ${sawFollow}`);
	},
	async "abort-in-tool"() {
		let executed = false;
		let toolSawAbort = null;
		const wait = tool("wait", async (_id, _params, signal) => {
			executed = true;
			await new Promise((resolve) => signal?.addEventListener("abort", resolve, { once: true }));
			toolSawAbort = signal?.aborted ?? null;
			return { content: [{ type: "text", text: "tool stopped" }], details: {} };
		});
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("never shown"),
		]);
		const agent = makeAgent([wait]);
		const run = agent.prompt("start");
		while (!executed) await new Promise((resolve) => setTimeout(resolve, 0));
		agent.abort();
		await run;
		log.push(`tool saw signal.aborted: ${toolSawAbort}; isStreaming: ${agent.state.isStreaming}`);
	},
	async "abort-early"() {
		const g = gate();
		let executed = false;
		const wait = tool("wait", async () => {
			executed = true;
			await g.promise;
			return { content: [{ type: "text", text: "released" }], details: {} };
		});
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("never shown"),
		]);
		const agent = makeAgent([wait]);
		const started = gate();
		agent.subscribe((event) => {
			if (event.type === "tool_execution_start") started.open();
		});
		const run = agent.prompt("start");
		await started.promise;
		agent.abort();
		g.open();
		await run;
		log.push(`tool executed: ${executed}`);
	},
	async "abort-ignored"() {
		const g = gate();
		let executed = false;
		const wait = tool("wait", async () => {
			executed = true;
			await g.promise;
			return { content: [{ type: "text", text: "released" }], details: {} };
		});
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("never shown"),
		]);
		const agent = makeAgent([wait]);
		const run = agent.prompt("start");
		while (!executed) await new Promise((resolve) => setTimeout(resolve, 0));
		agent.abort();
		log.push(`right after abort(): isStreaming=${agent.state.isStreaming}`);
		g.open();
		await run;
		log.push(`after await run: isStreaming=${agent.state.isStreaming}`);
	},
	async "steer-two"() {
		const g = gate();
		reg.setResponses([
			fauxAssistantMessage([fauxToolCall("wait", {})], { stopReason: "toolUse" }),
			(context) => {
				log.push(`request 2 saw STEER1=${JSON.stringify(context.messages).includes("STEER1")} STEER2=${JSON.stringify(context.messages).includes("STEER2")}`);
				return fauxAssistantMessage("first text");
			},
			(context) => {
				log.push(`request 3 saw STEER1=${JSON.stringify(context.messages).includes("STEER1")} STEER2=${JSON.stringify(context.messages).includes("STEER2")}`);
				return fauxAssistantMessage("second text");
			},
		]);
		const wait = tool("wait", async () => {
			await g.promise;
			return { content: [{ type: "text", text: "released" }], details: {} };
		});
		const agent = makeAgent([wait]);
		agent.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				agent.steer(user("STEER1"));
				agent.steer(user("STEER2"));
				g.open();
			}
		});
		await agent.prompt("start");
	},
	async "hook-throws"() {
		reg.setResponses([fauxAssistantMessage("never reached")]);
		const agent = makeAgent([]);
		agent.prepareRequest = async () => {
			throw new Error("hook exploded");
		};
		let rejected = null;
		await agent.prompt("hi").catch((error) => {
			rejected = error.message;
		});
		log.push(`prompt rejected: ${rejected}; errorMessage: ${agent.state.errorMessage}`);
	},
};

try {
	await scenarios[process.argv[2]]();
	console.log(`== ${process.argv[2]} ==`);
	console.log(log.join("\n"));
	console.log(`faux callCount: ${reg.state.callCount}`);
} finally {
	reg.unregister();
}
```

运行命令。Windows PowerShell：

```powershell
$lab = Join-Path $env:TEMP 'pi-task05-lab'
New-Item -ItemType Directory -Force $lab | Out-Null
# 把 register.mjs、hooks.mjs、doc-lab.mjs 保存到 $lab 中
$register = 'file:///' + ($lab -replace '\\', '/') + '/register.mjs'
$script = Join-Path $lab 'doc-lab.mjs'
node --no-warnings --import $register $script no-tools
```

Git Bash（Windows）：

```bash
LAB="$(cygpath -m "$(node -p "require('os').tmpdir()")")/pi-task05-lab"
mkdir -p "$LAB"
# 把三个文件保存到 "$LAB" 中
node --no-warnings --import "file:///$LAB/register.mjs" "$LAB/doc-lab.mjs" no-tools
```

Linux 或 macOS 的 bash 把 `LAB` 改为 `/tmp/pi-task05-lab`，其余命令相同。最后一个参数是场景名，可以是 `no-tools`、`tool`、`steer`、`followup`、`abort-in-tool`、`abort-early`、`abort-ignored`、`steer-two`、`hook-throws`。

### 实验 1：无工具的一次运行（约 5 分钟）

- 目的：确认没有工具时，循环在第一次回答后结束。
- 步骤：运行场景 `no-tools`。
- 预期输出（实际运行得到）：

```text
== no-tools ==
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
turn_end assistant stop=stop
agent_end
faux callCount: 1
```

- 对照：`faux callCount` 为 1，说明只请求了一次模型。

### 实验 2：工具调用后循环继续

- 目的：确认工具结果会触发第二次模型请求，两个轮次属于同一次运行。
- 步骤：运行场景 `tool`。
- 预期输出（实际运行得到）：

```text
== tool ==
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
tool_execution_start read
tool_execution_end read isError=false
message_start toolResult
message_end toolResult
turn_end assistant stop=toolUse
turn_start
message_start assistant
message_end assistant
turn_end assistant stop=stop
agent_end
faux callCount: 2
```

- 对照：只有一个 `agent_start` 和一个 `agent_end`，但有两个 `turn_start`。

### 实验 3：steer 与 followUp 的取数点

- 目的：确认 steering 在工具结束后的 T2 取到，followUp 在内层退出后的 T3 取到。
- 步骤：先运行 `steer`，再运行 `followup`。
- 预期输出，`steer`（实际运行得到）：

```text
== steer ==
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
tool_execution_start wait
tool_execution_end wait isError=false
message_start toolResult
message_end toolResult
turn_end assistant stop=toolUse
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
turn_end assistant stop=stop
agent_end
request 2 saw STEER: true
faux callCount: 2
```

- 预期输出，`followup`（实际运行得到）：

```text
== followup ==
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
tool_execution_start wait
tool_execution_end wait isError=false
message_start toolResult
message_end toolResult
turn_end assistant stop=toolUse
turn_start
message_start assistant
message_end assistant
turn_end assistant stop=stop
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
turn_end assistant stop=stop
agent_end
request 3 saw FOLLOW: true
faux callCount: 3
```

- 对照：`steer` 的 `user` 消息紧跟在第一次 `turn_end` 之后；`followup` 的 `user` 消息出现在模型第一次普通回答之后，多了一个轮次。

### 实验 4：取消的三种情况

- 目的：区分"取消请求"、"工具看到信号"、"运行收束"。
- 步骤：依次运行 `abort-in-tool`、`abort-early`、`abort-ignored`。
- 预期输出，`abort-in-tool`（实际运行得到）：

```text
== abort-in-tool ==
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
tool_execution_start wait
tool_execution_end wait isError=false
message_start toolResult
message_end toolResult
turn_end assistant stop=toolUse
turn_start
message_start assistant
message_end assistant
turn_end assistant stop=aborted
agent_end
tool saw signal.aborted: true; isStreaming: false
faux callCount: 2
```

- 预期输出，`abort-early`（实际运行得到）：

```text
== abort-early ==
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
tool_execution_start wait
tool_execution_end wait isError=true
message_start toolResult
message_end toolResult
turn_end assistant stop=toolUse
turn_start
message_start assistant
message_end assistant
turn_end assistant stop=aborted
agent_end
tool executed: false
faux callCount: 2
```

- 预期输出，`abort-ignored`（实际运行得到）：

```text
== abort-ignored ==
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
tool_execution_start wait
right after abort(): isStreaming=true
tool_execution_end wait isError=false
message_start toolResult
message_end toolResult
turn_end assistant stop=toolUse
turn_start
message_start assistant
message_end assistant
turn_end assistant stop=aborted
agent_end
after await run: isStreaming=false
faux callCount: 2
```

- 对照：三次运行的 `faux callCount` 都是 2。循环在工具之后仍请求了一次模型，这次请求的流以 `aborted` 结束。`abort-ignored` 中，`abort()` 返回后运行仍在进行，直到工具返回才结束。

### 清理

Windows PowerShell：`Remove-Item -Recurse -Force $lab`

Git Bash：`rm -rf "$LAB"`

仓库内没有任何文件被修改。

## 自测题

1. 用户输入 "hi"，模型只回答文字，没有工具。循环在哪一个检查点决定结束？这时 `hasMoreToolCalls`、`pendingMessages`、`explicitContinuation` 分别是什么？
2. 工具返回普通结果后，为什么循环会再请求一次模型？哪一行代码决定了这一点？
3. 工具运行时调用 `agent.steer()`，消息在哪个检查点被取走？如果换成 `agent.followUp()`，同一条消息会在哪个检查点被取走？
4. `finishTurn` 返回 `{ action: "continue" }`，但模型回答的 `stopReason` 是 `aborted`。循环会不会再请求一次模型？为什么？
5. 调用 `agent.abort()` 后，`isStreaming` 什么时候变为 `false`？为什么不是调用 `abort()` 的那一刻？

### 参考答案

1. 在 `runLoop` 的 T3 之后的 `break` 处结束，之前 T2 也没有取到消息。循环变量为：`hasMoreToolCalls` 为 `false`，`pendingMessages` 为 `[]`，`explicitContinuation` 为 `false`。发出 `agent_end` 后结束。
2. 工具结果不为 `terminate: true`，所以 `hasMoreToolCalls = !executedToolBatch.terminate` 为 `true`。内层 `while (hasMoreToolCalls || ...)` 条件成立，于是再次请求模型，并且工具结果已在上下文中。
3. steering 在工具结束后的 T2 被取走，在下一轮注入，即下一次模型请求之前。followUp 不在 T2 取走：内层退出后，在 T3 取走，然后外层重进内层，作为新的一轮注入。
4. 会请求模型的条件不成立。`aborted` 是硬退出。`finishTurn` 仍会被调用，但其返回值被丢弃，循环直接发 `turn_end` 与 `agent_end` 并返回。
5. 在所有 `agent_end` 监听器结束、`finishRun` 把 `isStreaming` 设为 `false` 之后。`abort()` 只是设置信号，工具和循环需要在检查点观察到信号，然后运行才会收束。如果工具忽略信号，`isStreaming` 会一直为 `true`，直到工具返回。

## 常见错误

| 现象 | 原因 | 解决 |
| ---- | ---- | ---- |
| 运行中调用 `prompt()` 报 "Agent is already processing a prompt" | 同一个 `Agent` 同一时间只允许一个运行，`activeRun` 不为空 | 用 `steer()` 或 `followUp()` 入队，或者等待 `waitForIdle()` |
| `continue()` 报 "Cannot continue from message role: assistant"，并且队列是空的 | 上下文最后一条是 assistant 消息，供应商不允许连续两条 assistant 消息 | 先调用 `prompt()` 提供新的用户消息，或者先把消息放进队列 |
| 工具设置了 `terminate: true`，但循环还在运行 | `terminate` 只表示"这一批工具不因工具而继续"。有 steering、follow-up，或钩子返回 `continue`，循环仍会继续 | 要硬停，让 `finishTurn` 返回 `{ action: "end" }` |
| 调用 `abort()` 后以为工具马上停止，或 `isStreaming` 立刻变成 `false` | 取消只是信号。工具不检查 `signal` 就会一直运行；`isStreaming` 要等 `agent_end` 结算后才变 `false` | 在工具的 `execute` 里检查并响应 `signal`；测试中用 `await agent.waitForIdle()` 等待结束 |
| 钩子（如 `prepareRequest`）抛错，却以为 `prompt()` 会 reject | `Agent` 类在 `runWithLifecycle` 中捕获异常，`handleRunFailure` 生成一条 `stopReason` 为 `error` 的消息，并发出 `turn_end` 与 `agent_end`。实际运行中 `prompt()` 没有 reject，错误写在 `agent.state.errorMessage` 中 | 读 `agent.state.errorMessage`，或监听 `turn_end`。直接调用低层 `runAgentLoop()` 时，Promise 会 reject（源码没有 try/catch，本篇未单独运行验证） |

## 选读：源码深入（可选，跳过不影响主线）

以下内容超出主线。跳过不影响后面的学习。

### 选读 A：`packages/agent/src/agent.ts` 逐段精读

#### A.1 构造器的默认值

| 选项 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `streamFn` | 未传时调用 `getDefaultStreamFn()` | 构造时就求值；没有默认则构造器抛错，比第一次 `prompt()` 时才失败更早暴露问题 |
| `steeringMode`、`followUpMode` | `"one-at-a-time"` | 两个队列每次只取一条 |
| `transport` | `"auto"` | 传给 `streamFn` |
| `toolExecution` | `"parallel"` | 工具批次的调度方式，见 `executeToolCalls` |
| `convertToLlm` | 过滤掉非标准角色的 `defaultConvertToLlm` | 只保留 `system`、`user`、`assistant`、`toolResult` |

`EMPTY_USAGE` 与 `DEFAULT_MODEL` 是模块级常量。`DEFAULT_MODEL` 的 `input` 为空数组，表示不接收图片。这些常量会被共享，代码不应修改它们。

#### A.2 `PendingMessageQueue`

`PendingMessageQueue` 是 `agent.ts` 中未导出的类。它只有四个操作：

```typescript
enqueue(message)  // 追加到末尾
peek()            // 按模式返回将被取走的消息，不修改队列
drain()           // peek() 的结果，并把这些消息从队列前部删除
clear()           // 清空
```

`peek()` 在 `"all"` 模式下返回整个数组副本；在 `"one-at-a-time"` 模式下只返回 `[first]`。`drain()` 用 `this.messages = this.messages.slice(drained.length)` 删除已取出的部分。队列没有锁，因为所有操作都是同步的，中间没有 `await`。

#### A.3 `prompt()` 与 `continue()` 的守卫

`prompt()` 的守卫是 `if (this.activeRun)`，报错文字里包含替代方案 `steer()` 或 `followUp()`。`activeRun` 在 `finishRun()` 中清空，而 `finishRun()` 在 `runWithLifecycle` 的 `finally` 中执行。所以只有前一次运行完全结束后，新的 `prompt()` 才能通过守卫。

`continue()` 的分支有三层：

1. 没有消息，或者只有系统消息：报错。
2. 最后一条是 assistant，并且 steering 队列非空：把 steering 取出，作为新的 `prompt` 运行，并设置 `skipInitialSteeringPoll: true`。
3. 最后一条是 assistant，并且 follow-up 队列非空：同样处理，但不设置该选项。
4. 都为空：报错 "Cannot continue from message role: assistant"。
5. 否则调用 `runContinuation()`，不新增消息。

`skipInitialSteeringPoll` 的作用是：第二种分支已经取出了 steering 消息，T0 不能再取一次，否则 `one-at-a-time` 模式会多送一条。

#### A.4 `createLoopConfig`：闭包与配置快照

`createLoopConfig()` 把 `Agent` 的字段复制到一个 `AgentLoopConfig` 中。有三点需要注意。

- 配置是一次性快照：`model`、`reasoning` 等在运行开始时读取。运行中改 `state.model` 不会影响本次运行。
- `reasoning` 的转换：状态中用 `"off"` 表示关闭，循环配置中用 `undefined`。转换写在这一行：`this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel`。
- `prepareNextTurn` 的适配：如果设置了 `prepareNextTurnWithContext` 或 `prepareNextTurn`，就生成一个接收 `context` 的闭包。它调用 `prepareNextTurnWithContext(context, this.signal)`，或者调用 `prepareNextTurn?.(this.signal)`。

队列回调也在这里接线。`skipInitialSteeringPoll` 是每次调用 `createLoopConfig` 时新建的局部变量，被 `getSteeringMessages` 闭包捕获：第一次调用返回 `[]` 并把它设为 `false`，之后正常 `drain()`。

#### A.5 生命周期：`runWithLifecycle`、`handleRunFailure`、`finishRun`

`runWithLifecycle` 做三件事：

```typescript
const abortController = new AbortController();
// ... 创建 promise 与 resolvePromise
this.activeRun = { promise, resolve: resolvePromise, abortController };
this._state.isStreaming = true;
this._state.streamingMessage = undefined;
this._state.errorMessage = undefined;
try {
	await executor(abortController.signal);
} catch (error) {
	await this.handleRunFailure(error, abortController.signal.aborted);
} finally {
	this.finishRun();
}
```

`handleRunFailure` 构造一条骨架 assistant 消息：空文本内容、当前模型的 `api`/`provider`/`model`、`EMPTY_USAGE`，`stopReason` 为 `aborted` 或 `error`。然后依次发出 `message_start`、`message_end`、`turn_end`、`agent_end`。它不发 `turn_start` 或 `agent_start`，因为循环可能已经发过了。`agent_end` 的 `messages` 只有这条失败消息，不是完整历史。

`finishRun` 把 `isStreaming` 设为 `false`，清空 `streamingMessage` 与 `pendingToolCalls`，然后调用 `activeRun.resolve()`，最后把 `activeRun` 设为 `undefined`。`errorMessage` 在这里不清空，它保留到下一次运行开始时才清空。

注意 `resolve()` 在 `activeRun = undefined` 之前调用。Promise 的回调是微任务，所以等待者被唤醒时通常能看到 `activeRun` 已清空。

#### A.6 `processEvents`：先归约状态，再通知监听器

`processEvents` 是循环的 `emit` 接收端。它先根据事件更新 `_state`，再按订阅顺序 `await` 每个监听器。

| 事件 | 状态动作 |
| ---- | -------- |
| `message_start`、`message_update` | `streamingMessage` 设为事件里的消息 |
| `message_end` | 清空 `streamingMessage`，并把消息加入 `messages` |
| `tool_execution_start` | 复制 `pendingToolCalls` 集合，加入 `toolCallId` |
| `tool_execution_end` | 复制集合，删除 `toolCallId` |
| `turn_end` | 如果是带 `errorMessage` 的 assistant 消息，写入 `state.errorMessage` |
| `agent_end` | 清空 `streamingMessage` |

每次修改集合都创建新的 `Set`，所以外部拿到的旧快照不会被修改。`switch` 没有 `default` 分支，TypeScript 不会在新增事件类型时提醒你，需要手动检查。

监听器抛错会中断后续监听器，并沿 `await` 链向上传播。这也是 `runWithLifecycle` 的 `catch` 可能被触发的一条路径。

### 选读 B：`runLoop` 中三个变量的变化

`explicitContinuation` 不在内层 `while` 的条件中。它只在内层退出后决定是否重进外层：

```typescript
while (true) {
	let hasMoreToolCalls = true;
	while (hasMoreToolCalls || pendingMessages.length > 0) {
		// 注入、请求、执行工具
		explicitContinuation = decision?.action === "continue";
		pendingMessages = await getSteeringMessages();
		if (hasMoreToolCalls || pendingMessages.length > 0) {
			explicitContinuation = false;
		}
	}
	const followUpMessages = await getFollowUpMessages();
	if (followUpMessages.length > 0) {
		explicitContinuation = false;
		pendingMessages = followUpMessages;
		continue;
	}
	if (explicitContinuation) {
		explicitContinuation = false;
		continue;
	}
	break;
}
```

规则如下。

- 如果本轮还要处理工具结果，或者有 steering，`explicitContinuation` 被清零。内层本来就会继续，额外的 continue 只会多跑一轮。
- follow-up 优先于 continuation。两者同时出现时，只处理 follow-up。
- `hasMoreToolCalls` 在每次外层循环开始时重置为 `true`。它不记录"上一轮是否有工具"，而是"本轮是否需要再来一次"。

这就是为什么 `finishTurn` 返回 `continue` 会导致一次不带新消息的请求：外层重进后，内层条件因为 `hasMoreToolCalls = true` 而成立。

### 选读 C：已运行的其他轨迹

**两条 steering，one-at-a-time 模式（场景 `steer-two`）。** 工具运行时入队 `STEER1` 与 `STEER2`。

```text
turn_end assistant stop=toolUse
turn_start
message_start user / message_end user          （STEER1）
request 2 saw STEER1=true STEER2=false
message_start assistant / message_end assistant
turn_end assistant stop=stop
turn_start
message_start user / message_end user          （STEER2）
request 3 saw STEER1=true STEER2=true
message_start assistant / message_end assistant
turn_end assistant stop=stop
agent_end
faux callCount: 3
```

第一次 T2 只取走 `STEER1`，第二次轮次结束时才取走 `STEER2`。

**钩子抛错（场景 `hook-throws`）。** `prepareRequest` 抛出 `hook exploded`。

```text
agent_start
turn_start
message_start user
message_end user
message_start assistant
message_end assistant
turn_end assistant stop=error
agent_end
prompt rejected: null; errorMessage: hook exploded
faux callCount: 0
```

`prompt()` 没有 reject。错误被转成一条 `error` 消息，faux 没有被请求。

## 下一篇

本篇解决了"一次运行怎么走"：什么时候请求模型、什么时候执行工具、什么时候结束，队列和取消如何插入。下一篇 06 讲工具：工具如何声明参数、参数如何校验，以及执行结果如何变成发给模型的 `toolResult` 消息。

本篇预计 2 小时（不含选读）。

## 术语小结（本篇新出现的术语，不超过 15 个）

| 术语 | 一句话定义 | 首次出现的小节 |
| ---- | ---------- | -------------- |
| 运行（run） | 一次 `prompt()` 或 `continue()` 从 `agent_start` 到 `agent_end` 的过程 | 核心概念 |
| 轮次（turn） | 一次模型回答及其引发的工具执行，`turn_start` 到 `turn_end` | 核心概念 |
| 钩子（hook） | 宿主传给循环、在固定时间点调用的回调 | 核心概念 |
| steering | 运行中入队、在下一次模型请求前注入的消息 | 核心概念 |
| followUp | 运行中入队、等 agent 准备停止时才处理的消息 | 核心概念 |
| AbortSignal | 取消标记；`abort()` 设置后，代码需主动检查 | 核心概念 |
| 结算（settle） | `agent_end` 的监听器结束、状态清理完成之后 | 核心概念 |
| 检查点 T0–T3 | `runLoop` 中取队列的四个固定位置 | 4. 排队 |
| one-at-a-time | 队列模式：每次只取最旧的一条 | 4. 排队 |
| 硬退出 | `error` 或 `aborted` 的回答，忽略 `finishTurn` 的决定 | 3. 结束条件表 |
| terminate | 工具结果上的提示，表示这一批不因工具而继续 | 3. 结束条件表 |
| toolResult | 工具执行结果形成的消息，发给模型 | 2. 有工具 |
| stopReason | 回答结束的原因：`stop`、`toolUse`、`length`、`error`、`aborted` | 1. 无工具 |
| explicitContinuation | `finishTurn` 返回 `continue` 时设置的内部标记 | 3. 结束条件表 |
| agent_settled | 会话层在运行结算后发出的事件；低层 `Agent` 没有此事件 | 5. 取消 |
