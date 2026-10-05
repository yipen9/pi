# D27：AgentSession.prompt() 与 run 收束边界

> 本篇沿一条输入追踪到会话变为空闲，重点看 `prompt()` 的分流、重试/压缩后的续跑、扩展收束钩子和取消。它补充 D5 的 SDK 装配、D15 的压缩编排、D24 的图片归一化，不重复讲这些机制本身。
>
> 验证状态：静态核对 `agent-session.ts` 与列出的测试源码；没有运行测试。

## 1. 先区分三个“结束”

读 `AgentSession` 时容易把一次模型响应、Agent 一轮和整个 prompt 操作当成同一件事。实际上：

| 名称 | 发生点 | 意义 |
|---|---|---|
| assistant 消息结束 | `message_end` | 一条消息完成并写入会话记录；后续仍可能有工具或新请求 |
| Agent run 结束 | 底层 `agent_end` | 当前低层循环结束；session 包装层还可能 retry、压缩或继续 |
| session settled | `_emitAgentSettled` | 包装层决定不再继续，发出 `agent_settled` 并处理收束期间延迟的动作 |

因此 `await session.prompt(...)` 等待的并非“第一个回答 token”，也不是单次 `streamSimple()`。它会等 `_runAgentPrompt()` 所管理的循环收束。

## 2. 总体路线

```mermaid
flowchart TD
  A[prompt(text, options)] --> B{正在发 agent_settled?}
  B -- 是 --> B1[延迟 action，立即返回]
  B -- 否 --> C{扩展命令命中?}
  C -- 是 --> C1[执行命令并返回]
  C -- 否 --> D[输入 hooks 与文本展开]
  D --> E{当前 streaming?}
  E -- 是 --> E1[按 steer/followUp 入队并返回]
  E -- 否 --> F[flush、校验 model/auth、压缩检查]
  F --> G[before_agent_start、图片归一化、组装消息]
  G --> H[_runAgentPrompt]
  H --> I[agent.prompt]
  I --> J[处理 run 结束: retry / compaction / queued work]
  J --> K{需要继续?}
  K -- 是 --> I
  K -- 否 --> L[agent_before_settle 边界]
  L --> M{继续或队列非空?}
  M -- 是 --> I
  M -- 否 --> N[finally: flush 并 agent_settled]
```

图中的“立即返回”是 `prompt()` 这个调用不启动自己的 Agent run；例如流式期间它只安排输入。原先那个 run 仍在进行。

## 3. `prompt()` 前半段：输入可能被消费、转换或排队

阅读入口：`packages/coding-agent/src/core/agent-session.ts` → `AgentSession.prompt`。

【源码节选】

```ts
if (this._isEmittingAgentSettled) {
  this._deferredSettledActions.push(async () => await this.prompt(text, options));
  return;
}
const expandPromptTemplates = options?.expandPromptTemplates ?? true;
const preflightResult = options?.preflightResult;
```

【注解】扩展收到 `agent_settled` 时，`isStreaming` 已可能是 false，但收束事件尚未派发完。这里将新 prompt 延后，避免它插进“正在通知 settled”的过程中。`?? true` 表示只有选项为 `undefined` 或 `null` 时才采用默认展开。

入口接下来按顺序处理：

1. 默认允许展开时，先检查 `/...` 是否是扩展命令。命中就由命令处理器执行，标记 `preflightResult("handled")` 后返回。
2. 正在手动压缩时拒绝新 prompt，避免输入与压缩改写的上下文竞争。
3. `_runInputHandlers` 可返回 `handled`（消费输入）、`transform`（替换文本/图片）或继续原输入。
4. 展开 `/skill:name` 与 prompt template。未知 skill 会原样通过。
5. 如果仍在 streaming，必须显式给 `streamingBehavior`；`followUp` 等当前工作自然结束后再处理，`steer` 尽快进入循环下一次模型调用。两者均入队后返回。

`preflightResult` 是调用方观察入口处理结果的回调：可能是 `handled`、`queued` 或 `started`。不要把它当成模型结果回调。

【陷阱】扩展命令检测发生在 input handler 之前，只有 `expandPromptTemplates` 为真才尝试；输入 handler 返回 handled 则不会进入模型路径。

## 4. 空闲时组装输入，再启动 run

没有排队返回时，入口先 flush 延迟的 bash/custom 消息，再验证 model 与认证。失败会在 `_runAgentPrompt` 前抛出，所以不会进入该 run 的 `finally`，也不会由这次调用发出 `agent_settled`。

后续顺序有意安排：

1. `_checkCompaction(lastAssistant, false)` 检查之前留下的回答是否需要压缩；`false` 表示新 prompt 将马上发送，不在这里额外调用 `agent.continue()`。
2. `emitBeforeAgentStart` 让扩展调整系统提示选项、工具集或模型相关状态。
3. `_normalizePromptImages` 按当前限制模型处理图片；因此先执行 hook，hook 所选模型可以决定图片缩放配置。
4. 组装 user message、pending next-turn custom messages、hook 返回的 custom messages，以及可能更新过的 system message。
5. `preflightResult("started")`，调用 `_runAgentPrompt(messages)`。

消息数组是底层 Agent 的输入，而不是会话文件的一行。消息在后续 `message_end` 事件中持久化；pending next-turn 队列此处被取出并清空。

## 5. run 包装循环：底层结束不等于 settled

【源码节选】

```ts
this._isAgentRunActive = true;
try {
  await this.agent.prompt(messages);
  while (!this._agentRunAbortRequested) {
    if (await this._handlePostAgentRun()) {
      await this.agent.continue();
      continue;
    }
    if (!(await this._runBeforeSettleBoundary())) break;
    await this.agent.continue();
  }
} finally {
  // 清理与 settled 派发
}
```

【注解】为便于初学者阅读，节选省略了每个 await 后的 abort 再检查。实际代码会在续跑前检查取消标志。`await` 表示暂停当前 async 函数，等待这一阶段完成；不是创建一个新的线程。

`_handlePostAgentRun()` 依次消费最近的 assistant 与工具结果：

- 遇到可重试错误时，按配置退避，持久化 context omission，再让 Agent 续跑。重试记录保留在原始历史中，但从模型投影中排除。
- 遇到适合恢复的长度/上下文问题时，可以执行压缩恢复；压缩具体策略见 D15。
- 最后检查底层 Agent 是否仍有队列消息。队列不空就继续，follow-up 不会被错误重试抢先处理。

`_handleAgentEvent` 在 `message_end` 时追加 session entry，并记录最后 assistant；在 `turn_end` 保存工具结果、flush pending custom messages。扩展事件先于公开订阅者派发，这让扩展能在公开观察者读取前完成它的同步影响。

## 6. `agent_before_settle` 是可提交的边界

当 post-run 阶段无需继续时，session 才调用 `_runBeforeSettleBoundary()`。没有对应扩展处理器时，只看 Agent 是否有队列。

有处理器时，扩展可返回 boundary entries，并通过 `continue: true` 请求继续。entries 提交后，代码重新构造 context 检查是否允许继续：例如只有 system message 的上下文不能执行 continuation。扩展请求不合法时会报告错误；已有的自然工具/排队续跑不应被这个错误请求抑制。

示例轨迹：

```text
assistant 回答 first
  -> agent_before_settle 扩展提交 custom_message("continue now") + continue=true
  -> 新上下文包含该 custom message
  -> agent.continue()
  -> assistant 回答 second
  -> 下次边界不再要求继续
  -> agent_settled
```

边界 handler 执行期间若收到 abort，`_abortDuringBeforeSettle` 会抑制续跑。已提交的 drafts 仍按边界逻辑处理；取消的含义是不要继续生成，不是回滚已提交会话记录。

## 7. `finally`、取消与 idle

无论 Agent 正常结束还是 run 内抛错，`_runAgentPrompt` 的 `finally` 都会清理 retry 状态、临时 system prompt options，并 flush pending bash/custom messages，然后 await `_emitAgentSettled()`。

`abort()` 设置 run abort 标志（若 run active），取消 retry sleep 与压缩/分支摘要，并调用底层 `agent.abort()`，最后等待 `waitForIdle()`。因此取消是协作式的：当前 await 的 handler/IO 需要返回或响应 signal，包装层才能走到清理边界。

`_emitAgentSettled()` 的关键次序：

1. 先把 `_isAgentRunActive` 设为 false，并标记正在派发 settled。
2. 扩展先收到 `agent_settled`，再通知公开 listeners。
3. 派发期间产生的新 prompt/custom run 放进 deferred actions。
4. 两类 settled listener 都完成后，顺序执行延迟动作；有新 run 时 idle waiter 不会过早醒来。
5. 没有延迟动作，或延迟动作也结束后，检查 idle 并唤醒 `waitForIdle()`。

这解释了为什么 `_isEmittingAgentSettled` 单独存在：仅看 `isStreaming` 不够，它表示 run 已停止但生命周期通知仍在进行。

### 7.1 异常在哪一层发生，决定 Promise 怎么结束

`prompt()` 返回 `Promise<void>`，但不是所有失败都会以同一种方式结束。读调用方的错误处理时，要先找出失败发生在启动前、Agent run 内，还是 session 收束事件中：

| 失败位置 | `prompt()` 的结果 | 收尾行为 |
|---|---|---|
| 模型/认证校验、输入处理等 `_runAgentPrompt()` 之前的步骤 | reject | 本次调用未进入 `_runAgentPrompt()`，因此没有对应的 `agent_settled` |
| provider/Agent loop 的普通异常，失败事件监听器正常返回 | 通常 resolve | `Agent` 把异常转成错误消息和事件；session 随后执行 `_runAgentPrompt()` 的 `finally` 并派发 `agent_settled` |
| `Agent` 正在派发失败事件时，Agent listener 再次同步抛错 | reject | `Agent.runWithLifecycle()` 的 `finally` 仍执行；session 的 `finally` 仍尝试清理并派发 `agent_settled` |
| `agent_settled` 的公开 session listener 同步抛错 | reject | `_emitAgentSettled()` 会重置 `_isEmittingAgentSettled`，但抛错会跳过后面的 deferred actions 和 idle waiter resolve |

第三行是 D2 §13–14 的异常边界：`runWithLifecycle` 捕获 executor 的 rejection，但不会再捕获 `handleRunFailure` 自身的 rejection。第四行则发生在另一层：`AgentSession._emit()` 同步逐个调用公开 listener，`_emitAgentSettled()` 的 `finally` 只复位标志；listener 抛错后，后续唤醒逻辑不会执行。若此前已有 `waitForIdle()` 调用在等待，源码轨迹显示该 Promise 可能无法由这条收尾路径解除。另一个 Promise 规则也在这里生效：若 `_runAgentPrompt()` 原本因 Agent 异常而 reject，但 `finally` 中的 settled listener 又抛错，调用方观察到的是后抛出的收尾异常，原始异常会被它遮住。

```text
provider / Agent loop 出错
  -> Agent 转成失败事件
  -> 失败事件的 Agent listener 再抛错？
     -> 是：Agent.prompt reject；Agent finally 仍 finishRun
     -> 否：Agent.prompt resolve
  -> AgentSession._runAgentPrompt finally
  -> 发 agent_settled
  -> session listener 同步抛错？
     -> 是：session.prompt reject；本次 idle waiter resolve 被跳过
     -> 否：处理 deferred actions，再检查并唤醒 idle waiter
```

因此，“运行异常已变成失败消息”不等于“整个 `session.prompt()` 不会 reject”。作为扩展作者，`agent_settled` 的同步订阅回调应自行捕获预期错误；不要把返回 Promise 的异步函数当成受支持的等待式 listener，公开 listener 类型是 `(event) => void`，`_emit()` 也不会 await 它。

#### 容易混淆的两个 `subscribe`

名字一样不代表回调契约一样。读类型签名时，重点看回调的返回类型；再追到调用点，看调用者有没有 `await`：

| API | listener 返回类型 | 调用时是否等待 | `async` listener 的含义 |
|---|---|---|---|
| `Agent.subscribe` | `void \| Promise<void>` | 是，按订阅顺序 await | Agent run 会等 listener 完成；listener rejection 会进入 Agent 的失败路径 |
| `AgentSession.subscribe` | `void` | 否，同步调用 | 返回的 Promise 不会纳入 `session.prompt()`；拒绝可能成为未处理 rejection |

所以 `Agent.subscribe(async (...) => { await save(...); })` 是受等待的；把相同写法传给 `session.subscribe`，并不会让 session 等 `save()`。需要在 session listener 中启动异步工作时，应显式处理它自己的失败：

```typescript
session.subscribe((event) => {
	if (event.type !== "agent_settled") return;
	void saveDiagnostics().catch((error: unknown) => {
		console.error("Could not save diagnostics", error);
	});
});
```

这里 `.catch(...)` 负责接住保存失败；`void` 只是告诉读者“有意不等待这个 Promise”，**它本身不会处理 rejection**。如果诊断写入必须在 prompt 完成前结束，不能把它藏在这个同步通知里；应在宿主自己的 async 流程中显式 `await`。

【验证边界】`agent.test.ts` 的 `emits full lifecycle events for thrown run failures` 覆盖普通 run 异常和 listener 正常返回；D27 列出的 settled 测试覆盖 deferred action 的正常顺序。没有找到 Agent listener 在失败事件中二次抛错、也没有找到公开 session listener 在 `agent_settled` 同步抛错的专门测试。上表后两条及 idle waiter 被跳过的结论是按 `try/catch/finally` 和同步调用顺序作的源码推导，不是运行实验结果。

## 8. 常见轨迹速查

| 情形 | 入口结果 | run 收束行为 |
|---|---|---|
| 普通回答 | `started` | 一次底层 prompt → post-run → 边界 → settled |
| 工具调用 | `started` | 工具结果入历史 → Agent 自然继续 → 最终边界/settled |
| 流式时 `followUp` | `queued` | 当前回复/工具循环完后再消费队列 |
| 可重试错误 | 已 `started` | `agent_end` 后 retry；成功/耗尽/取消后才收束 |
| `agent_before_settle` continuation | 已 `started` | 提交边界记录后再 `agent.continue()` |
| settled handler 中 prompt | 新调用立即排 deferred | 当前 settled 派发完成后启动下一 run |
| abort | 已启动操作完成取消传播 | 不再继续，清理、settled、idle waiter 收尾 |

## 9. 对照测试

以下是测试源码中可定位的断言场景；本篇没有运行这些测试。

| 文件 | 测试名称 | 它验证什么 |
|---|---|---|
| `test/suite/agent-session-prompt.test.ts` | `uses the model selected by before_agent_start for image normalization` | hook 发生在图片处理之前 |
| 同上 | `throws when prompted during streaming without a streamingBehavior` | streaming 输入必须明确队列语义 |
| 同上 | `dispatches extension commands without consuming a provider response` | 扩展命令可短路模型调用 |
| `test/suite/agent-session-retry-events.test.ts` | `emits the expected event order for a single prompt` | 普通 prompt 的事件次序 |
| 同上 | `prompt waits for retry completion even when assistant message_end handling is delayed` | prompt 等待完整异步事件处理与 retry |
| 同上 | `keeps follow-up work behind an automatic error retry`（在 boundaries 文件） | retry 成功前不消费后续输入 |
| `test/suite/agent-session-boundaries.test.ts` | `continues from an agent_before_settle custom message before final settlement` | boundary entries 能进入下一次上下文 |
| 同上 | `defers runs started by agent_settled handlers until every settled handler completes` | settled 通知期间新 run 延后 |
| 同上 | `commits pre-settlement drafts but suppresses continuation when aborted during the hook` | hook 内取消阻止 continuation |

## 10. 阅读路线与修改练习

按下面顺序在编辑器搜索符号：

1. `AgentSession.prompt` → 画出短路、队列和 started 三类出口。
2. `_runAgentPrompt` → 标记每个 `await` 前后哪些状态可能变化。
3. `_handleAgentEvent` → 找出事件派发与 session 持久化发生的先后。
4. `_handlePostAgentRun` → 对 retry、compaction、queued messages 分支分别画轨迹。
5. `_runBeforeSettleBoundary` → 找 continue 决策与取消守卫。
6. `_emitAgentSettled`、`abort`、`waitForIdle` → 验证延迟 run 是否会让 idle waiter 过早返回。

修改练习：若要增加一个“run 收束前记录诊断消息”的行为，先确定它是普通扩展事件、boundary draft 还是 custom message；再追踪它应在哪个阶段写入 transcript。用 `agent-session-boundaries.test.ts` 的 faux harness 固定模型回应，并断言消息顺序、公开事件顺序及最终 idle。不要只断言一个 handler 被调用。

## 11. 小结

`prompt()` 负责从输入入口分流并构造消息；`_runAgentPrompt()` 负责把多个低层 Agent run、重试、压缩和扩展边界串成一次完整操作；`agent_settled` 则是该操作进入空闲通知阶段的边界。修改其中任一处，都要同时检查事件顺序、session 投影和取消后的收尾。
