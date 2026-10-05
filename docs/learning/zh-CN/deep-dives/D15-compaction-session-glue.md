# D15：压缩的"触发端"精读（`_checkCompaction` + `_runAutoCompaction`）

> 精读对象：`core/agent-session.ts` 的压缩触发与编排段（`_checkCompaction` 第 2900 行、`_runAutoCompaction` 第 3050 行、`_runDefaultCompaction` 与手动 `compact()` 的共享点）。
> 对应主线：第 10 章；与 D4/D10 的关系：D4 精读"读侧素材"（阈值/估算/切点/序列化），D10 精读"纯函数写路径"（prepare → compact），**D15 精读"会话侧的触发与编排"**（何时查、查什么、失败怎么记）。
> 读法：先读 `_checkCompaction` 的**决策树**（这是一份"什么时候压、什么时候不压"的判例集），再读 `_runAutoCompaction` 的**执行事务**（事件、扩展拦截、写盘、重试信号）。

---

## 0. 三段职责的分工图

```mermaid
flowchart TD
  T1[prompt 前检查<br/>_checkCompaction(lastAssistant, false)] --> C
  T2[turn 后检查<br/>_handlePostAgentRun → _checkCompaction(message, true, toolResults)] --> C
  T3[手动 /compact<br/>AgentSession.compact] --> M[手动路径]
  C[_checkCompaction 决策树] -->|overflow / recoverableLength| A1[_runAutoCompaction 'overflow']
  C -->|threshold| A2[_runAutoCompaction 'threshold']
  A1 --> P[prepareCompaction D10]
  A2 --> P
  M --> P2[prepareCompaction 同款 + _runDefaultCompaction]
  P --> X{session_before_compact 扩展钩子}
  P2 --> X
  X -->|cancel| F
  X -->|自定义 compaction| W[appendCompaction]
  X -->|默认| D[_runDefaultCompaction → compact D10] --> W
  W --> E[compaction_end / session_compact 事件]
  F[compaction_end aborted + session_compact_failed]
```

【陷阱】**同一个 `prepareCompaction`/`compact` 被三条路径复用**（自动-阈值、自动-溢出、手动）——会话侧只决定"何时触发、失败如何记账、要不要续跑"；**纯函数边界（D10）是三条路径的公因子**。

---

# 第一部分：`_checkCompaction` 决策树（十二个判定）

## 1. 函数签名与两道前置门

【源码（节选）】

```typescript
	private async _checkCompaction(
		assistantMessage: AssistantMessage,
		skipAbortedCheck = true,
		toolResults: AgentMessage[] = [],
	): Promise<boolean> {
		const settings = this.settingsManager.getCompactionSettings(this.model);
		if (!settings.enabled) return false;

		// Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
		if (skipAbortedCheck && assistantMessage.stopReason === "aborted") return false;
```

【注解】

- **参数三件套**：`assistantMessage`（要检查的那条助手消息）、`skipAbortedCheck`（**默认 true**）、`toolResults`（溢出恢复时要一起省略的证据）。
- 【陷阱】`skipAbortedCheck` 的**两种调用点语义**（第 0 节的 T1/T2）：
  - **turn 后检查**（1837 行）：`true`——刚被取消的消息不触发压缩（取消是用户意图，不要顺手压缩）；
  - **prompt 前检查**（2009 行）：`false`——"上一次响应被取消后留下的历史"仍可能超限；**新输入即将发出，必须检查**（否则下一条请求直接撞溢出）。**同一个布尔在两个场景的默认值相反**——这是读调用点时最容易看漏的地方。
- `getCompactionSettings(this.model)`：**按当前模型取设置**（可能含 per-model 覆盖——`reserveTokens`/`keepRecentTokens` 可因模型而异）。
- `settings.enabled` 是**第一道门**（关掉自动压缩就什么都不查）。

## 2. 三道"数据一致性"守卫

【源码（节选）】

```typescript
		// Skip overflow check if the message came from a different model. ...
		const messageModel = this._modelForMessage(assistantMessage);
		const sameModel = messageModel !== undefined;
		const contextWindow = (messageModel ?? this.model)?.contextWindow ?? 0;

		// Skip compaction checks if this assistant message is older than the latest
		// compaction boundary. ...
		const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
		const assistantIsFromBeforeCompaction =
			compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
		if (assistantIsFromBeforeCompaction) {
			return false;
		}
```

【注解】

1. **同模型守卫**（`sameModel`）：把"哪条消息、哪个模型的窗口"绑在一起——注释举的例子极具体：从 opus（小窗口）切到 codex（大窗口）后，**旧模型留下的溢出错误不该触发新模型的压缩**（新窗口大得多，那个错误过时了）。
   - `_modelForMessage(assistantMessage)`：从消息里解析出**实际回答的物理模型**（虚拟选择下"物理模型提供限制"——注释原文）——与 D3 的 `getSessionContextSettings`"物理模型优先"同源。
2. **压缩边界守卫**（`assistantIsFromBeforeCompaction`）：**时间戳比较**（消息毫秒 vs 条目 ISO → `new Date(...).getTime()` 转换——第 4.7.1 节的两种时间戳在此相遇）。作用：**压缩刚完成时，第一条"旧消息"不该把压缩再触发一遍**（老 usage 反映的是压缩前的更大上下文）。
   - 【陷阱】用时间戳而不是 id/引用——因为调用方拿到的可能是**同一条消息的不同副本**（状态与投影的对象身份不完全稳定，第 D5 的引用比较教训）；时间戳是"语义相同"的可行代理。

## 3. 投影与分支上的一串布尔判定

【源码（完整）】

```typescript
		// Automatic cases 1 and 2: context overflow.
		// A length stop is recoverable when output ended below the model's original desired limit,
		// independent of the configured context size or any context-clamped provider request limit.
		const currentProjection = this.sessionManager.buildSessionProjection();
		const assistantEntryId = this._findPersistedMessageEntryId(assistantMessage);
		const assistantIsProjected =
			assistantEntryId === undefined ||
			currentProjection.entries.some(
				(entry) =>
					entry.sourceEntry.id === assistantEntryId &&
					entry.messages.some((message) => message.role === "assistant"),
			);
		const branch = this.sessionManager.getBranch();
		const assistantIndex = assistantEntryId ? branch.findIndex((entry) => entry.id === assistantEntryId) : -1;
		const entriesAfterAssistant = assistantIndex >= 0 ? branch.slice(assistantIndex + 1) : [];
		const hasPostAssistantContextEdit = entriesAfterAssistant.some((entry) => entry.type === "context_edit");
		const latestAssistantEdit = entriesAfterAssistant
			.filter(
				(entry): entry is ContextEditEntry => entry.type === "context_edit" && entry.targetId === assistantEntryId,
			)
			.at(-1);
		const assistantRetainedForExplicitRecovery =
			assistantEntryId === undefined ||
			(!entriesAfterAssistant.some((entry) => entry.type === "compaction") &&
				latestAssistantEdit?.replacement !== null);
		const assistantUsageMatchesProjection = assistantIsProjected && !hasPostAssistantContextEdit;
		const explicitOverflow = assistantMessage.stopReason === "error" && isContextOverflow(assistantMessage);
		const contextOverflow =
			sameModel &&
			((explicitOverflow && assistantRetainedForExplicitRecovery) ||
				(assistantUsageMatchesProjection && isContextOverflow(assistantMessage, contextWindow)));
		const recoverableLength =
			sameModel && assistantIsProjected && isRecoverableLength(assistantMessage, messageModel.maxTokens);
```

【注解（按依赖顺序）】

1. **`currentProjection`**（D3 的投影）与 **`assistantEntryId`**（消息对象 → 条目 id 的反查，`_entryIdsByMessage` 那条链）——先建立"这条消息在磁盘与投影中的落点"。
2. **`assistantIsProjected`**：消息**仍在模型可见投影里**（条目 id 找不到时**按可见处理**——`undefined ||` 的宽松分支：非持久化消息（测试/内存）不该被排除）。作用：**已被 `context_edit` 省略的消息不该再触发压缩**（它不在上下文里，没有"上下文超限"可言）。
3. **`assistantIndex`/`entriesAfterAssistant`**：在**原始分支**上找位置与后续条目——为下面两个"事后状态"判定提供范围。
4. **`hasPostAssistantContextEdit`**：这条消息产生**之后**发生过任何上下文编辑——若有，**usage 与投影可能不一致**（usage 是"编辑前"的）→ 相关的溢出判定要降级。
5. **`latestAssistantEdit`**：针对**这条消息本身**的最后一条编辑——`replacement !== null` 表示"没被省略"（被替换或原样）。
6. **`assistantRetainedForExplicitRecovery`**：显式溢出恢复的**保留判定**——`有后续压缩 → 不保留`；`被编辑省略（replacement === null）→ 不保留`；否则保留。用途：**显式报错的溢出**只有在"这条失败消息还会进入下一轮"时才值得压缩重试（否则压缩对象都不在上下文里）。
7. **`assistantUsageMatchesProjection`**：投影可见 **且** 无事后编辑——usage 数字与当前投影匹配（估计才可信）。
8. **`explicitOverflow`**：`stopReason === "error"` 且 `isContextOverflow(assistantMessage)`——**供应商明确报的溢出错误**。
9. **`contextOverflow`** 的**双分支**：
   - 显式溢出 **且** 消息会被保留（`assistantRetainedForExplicitRecovery`）→ 算溢出；
   - 或者 usage 与投影匹配 **且** `isContextOverflow(assistantMessage, contextWindow)`（用窗口数字做**推断溢出**——messages 本身没报错，但用量已超窗）。
   - 两者都要求 `sameModel`。
10. **`recoverableLength`**：`stopReason === "length"` 且 `isRecoverableLength(assistantMessage, model.maxTokens)`——**"可恢复的截断"**：注释给了定义（"output ended below the model's original desired limit"**独立于**配置的上下文大小与供应商的钳制请求限制——即**截断不是因为我们要求的 maxTokens 小，而是撞了别的壁**）。**这是 D4/D10 里 `"length"` 场景在触发端的入口**。
- 【陷阱】这一串布尔的**共同主题是"防误判"**：模型不对别压、消息被编辑/省略别压、过期 usage 别信、明确截断但可恢复才压。**任何一条读错，压缩就会在错误的时机触发或漏触发**——第 10 章的"反复压缩/不压缩"类故障大多落在这几行。

## 4. 溢出/可恢复截断分支：一击制（compact-and-retry 一次）

【源码（节选）】

```typescript
		if (contextOverflow || recoverableLength) {
			const willRetry = assistantMessage.stopReason !== "stop";

			// Case 2: the response completed successfully. Compact, but do not retry because
			// agent.continue() cannot continue from a completed assistant response.
			if (!willRetry) {
				return await this._runAutoCompaction("overflow", false);
			}

			if (this._overflowRecoveryAttempted) {
				const errorMessage = contextOverflow
					? "Context overflow recovery failed after one compact-and-retry attempt. ..."
					: "Truncated response recovery failed after one compact-and-retry attempt.";
				this._emit({ type: "compaction_end", reason: "overflow", result: undefined, aborted: false, willRetry: false, errorMessage });
				await this._emitSessionCompactFailed({ reason: "overflow", errorMessage, aborted: false, willRetry: false, fromExtension: false });
				return false;
			}

			this._overflowRecoveryAttempted = true;
			this._omitRecoveryAttempt(assistantMessage, toolResults);
			const retry = await this._runAutoCompaction("overflow", willRetry);
			if (retry) this._failedResponse = assistantMessage;
			return retry;
		}
```

【注解（四步）】

1. **`willRetry` 的判定** = `stopReason !== "stop"`：
   - **正常完成**（`stop`）但已超窗 → **只压缩、不重试**（注释原文："agent.continue() cannot continue from a completed assistant response"——上下文末尾是完成态助手消息，`continue()` 的守卫会拒（第 6.1.2 节））；
   - 出错（`error`/`length`）→ 压缩后**重试**（失败消息会被省略，续跑从更前面的合法位置开始）。
2. **`_overflowRecoveryAttempted` 一击制**：**整个会话只允许一次溢出恢复**（不是"每次溢出一次"——标志位没有按轮重置？【陷阱】读它的重置点：成功响应后清零（message_end 处理里 `stopReason !== "error" && !== "length"` 时 `_overflowRecoveryAttempted = false`——第 3.13 节的读段）。所以是"**连续溢出**只救一次；一旦有正常响应，资格恢复"。）
   - 第二次溢出 → **双事件**（`compaction_end` 失败版 + `session_compact_failed`）并返回 false——**明确放弃**（错误文案给出行动建议："reduce context or switch to a larger-context model"）。
3. **先省略、再压缩**：`_omitRecoveryAttempt(assistantMessage, toolResults)`（第 6.6.2 节）——把失败的尝试从投影剔除（连同工具结果）；**然后**才压缩（`prepareCompaction` 基于修好的投影）。
4. **`_failedResponse = assistantMessage`**：重试成功后供上报/展示（失败响应引用）；`retry` 返回 true → 调用方的收尾循环会 `agent.continue()`（第 6.6 节）。

## 5. 阈值分支：三种 token 口径

【源码（节选）】

```typescript
		let contextTokens: number;
		const projection = currentProjection;
		const hasContextEdits = projection.entries.some((entry) => entry.sourceEntry.type === "context_edit");
		const directContextTokens = assistantMessage.usage ? calculateContextTokens(assistantMessage.usage) : 0;
		if (hasContextEdits) {
			contextTokens = estimateProjectedContextTokens(projection, branch).tokens;
		} else if (assistantMessage.stopReason === "error" || directContextTokens === 0) {
			const messages = this.agent.state.messages;
			const estimate = estimateContextTokens(messages);
			if (estimate.lastUsageIndex !== null) {
				// Verify the usage source is post-compaction. ...
				const usageMsg = messages[estimate.lastUsageIndex];
				if (compactionEntry && usageMsg.role === "assistant" && (usageMsg as AssistantMessage).timestamp <= new Date(compactionEntry.timestamp).getTime()) {
					return false;
				}
			}
			contextTokens = estimate.tokens;
		} else {
			contextTokens = directContextTokens;
		}
		if (shouldCompact(contextTokens, contextWindow, settings)) {
			return await this._runAutoCompaction("threshold", false);
		}
		return false;
	}
```

【注解（三级选择）】

1. **有 context_edit** → 用**投影估算**（`estimateProjectedContextTokens`——D10 同款；编辑改变了实际输入，只有投影估算反映"编辑后"）。
2. **出错或零用量** → 用 `estimateContextTokens(messages)`（纯消息估算），并且：
   - 若估算找到了"最后一次有效 usage"的来源消息，**校验它不是压缩前的旧消息**（同样的 stale 时间戳检查）——旧 usage 会给出过大的数字（压缩前的上下文），导致**刚压完又压**（注释原文）。**不满足就直接返回 false**（这轮不压——下次有新鲜数据再说）。
3. **其余** → 直接用 `calculateContextTokens(usage)`（供应商报的真实数字，最可信）。
- 最后统一进 `shouldCompact(contextTokens, contextWindow, settings)`（第 10.2.1 节的不等式）。
- 【陷阱】三个口径的**选择条件**要背下来：**编辑 → 投影估；错误/零用量 → 消息估（带 stale 校验）；正常 → usage 实数**。

---

> D15 第一部分到此。第二部分：`_runAutoCompaction` 的执行事务（abortController、扩展拦截、默认/自定义摘要、写盘与事件、重试信号、失败记账）、触发点总表与总结。
---

# 第二部分：`_runAutoCompaction` 的执行事务

## 6. 签名与文档注释（先看契约）

【源码（节选）】

```typescript
	/**
	 * Execute threshold or overflow compaction. Manual compaction uses
	 * `AgentSession.compact()` instead. Both paths call the lower-level `compact()`
	 * function imported from `./compaction/index.ts` after preparation and extension
	 * interception.
	 *
	 * @param reason Automatic trigger selected by `_checkCompaction()`
	 * @param willRetry Whether to continue the interrupted turn after overflow compaction
	 * @returns Whether the post-run loop should call `agent.continue()`
	 */
	private async _runAutoCompaction(reason: "overflow" | "threshold", willRetry: boolean): Promise<boolean> {
```

【注解】

- **返回值是一个"要不要续跑"的信号**（`@returns Whether the post-run loop should call agent.continue()`）——调用方（`_handlePostAgentRun`）据此决定 `agent.continue()`（第 6.6 节）。**压缩函数不只是"做完事"，还承担"调度建议"**。
- 两个 reason：`"overflow"`（溢出恢复）与 `"threshold"`（常规阈值）；手动路径不走这里（走 `AgentSession.compact()`）——**但两者都经过扩展拦截与同一个默认摘要器**（注释原文）。

## 7. 准备段：守卫、控制器、起始事件

【源码（节选）】

```typescript
		const model = this.model;
		const settings = this.settingsManager.getCompactionSettings(model);
		let abortController: AbortController | undefined;
		let started = false;
		let fromExtension = false;
		let cancelledByExtension = false;

		try {
			if (!model) return false;

			const pathEntries = this.sessionManager.getBranch();
			const preparation = prepareCompaction(pathEntries, settings);
			if (!preparation) return false;

			abortController = new AbortController();
			this._autoCompactionAbortController = abortController;
			started = true;
			this._emit({ type: "compaction_start", reason });
			abortController.signal.throwIfAborted();
```

【注解（四个状态位各司其职）】

- `abortController`：本次压缩的取消信号（与全局的 `_autoCompactionAbortController` 同一对象——`abortCompaction()` 方法据此取消）。
- `started`：**"已经发过 `compaction_start`"**——失败路径据此决定是否补发 `compaction_end`（没开始过就别说结束）。
- `fromExtension`：最终摘要是否来自扩展（进 `appendCompaction` 的字段 + `session_compact` 事件）。
- `cancelledByExtension`：钩子取消的标记（最后在 catch 里并入 `aborted` 判定）。
- 【陷阱】**准备失败不算"开始"**（`started` 仍 false）：`prepareCompaction` 返回 undefined（幂等守卫/无事可做）→ 直接 false 返回、**零事件**——"没有可压的东西"不是失败，别报事件。
- `throwIfAborted()` 在**发事件之后**立刻检查——**取消优先于一切后续**（包括扩展钩子）。

## 8. 扩展拦截：可取消点与自定义摘要

【源码（节选）】

```typescript
			let extensionCompaction: CompactionResult | undefined;

			if (this._extensionRunner.hasHandlers("session_before_compact")) {
				const extensionResult = (await this._extensionRunner.emit({
					type: "session_before_compact",
					preparation,
					branchEntries: pathEntries,
					customInstructions: undefined,
					reason,
					willRetry,
					signal: abortController.signal,
				})) as SessionBeforeCompactResult | undefined;

				if (extensionResult?.cancel) {
					cancelledByExtension = true;
					throw new Error("Compaction cancelled");
				}

				if (extensionResult?.compaction) {
					extensionCompaction = extensionResult.compaction;
					fromExtension = true;
				}
			}
			abortController.signal.throwIfAborted();
```

【注解】

- 事件载荷**六件套**：`preparation`（D10 的施工图——扩展拿得到待摘要消息/保留边界/文件操作/设置）、`branchEntries`（原始分支——自定义逻辑可能要全量看）、`customInstructions`（自动路径为 undefined；手动路径才有）、`reason`、`willRetry`、`signal`（**扩展的模型调用也要可取消**——第 10.7.1 节的示例里显式把 signal 传给了自己的调用）。
- **cancel 用"标记 + throw"**（而不是 return false）：统一的 catch 处理会做"aborted 记账"（事件 + `session_compact_failed`）——**取消与失败共用收尾通道，但结果字段不同**（`aborted: true` vs `errorMessage`）。
- 自定义摘要（`extensionResult.compaction`）：直接给出 `CompactionResult`——**跳过默认摘要器**（不花 token），但保留边界的 `firstKeptEntryId`/`tokensBefore` **由扩展负责正确**（契约在 `SessionBeforeCompactResult` 类型与 compaction.md 的示例里）。
- 【陷阱】`hasHandlers` 前置检查：没有扩展处理时**连事件对象都不构造**（第 D8 第 7 节的快速门）；构造 `emit` 的载荷本身要读 `pathEntries` 等——省掉。

## 9. 生成与写盘：默认摘要器与"共享收口"

【源码（节选）】

```typescript
			if (extensionCompaction) {
				summary = extensionCompaction.summary;
				firstKeptEntryId = extensionCompaction.firstKeptEntryId;
				tokensBefore = extensionCompaction.tokensBefore;
				usage = extensionCompaction.usage;
				details = extensionCompaction.details;
			} else {
				// Shared default summary generator, also used by manual compaction.
				const compactResult = await this._runDefaultCompaction(preparation, model, undefined, abortController.signal, reason);
				summary = compactResult.summary;
				firstKeptEntryId = compactResult.firstKeptEntryId;
				tokensBefore = compactResult.tokensBefore;
				usage = compactResult.usage;
				details = compactResult.details;
			}
			abortController.signal.throwIfAborted();

			this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension, usage);
			const newEntries = this.sessionManager.getEntries();
			this._refreshFinalizedContext();
			const estimatedTokensAfter = estimateMessagesTokens(this.sessionManager.buildSessionProjection().messages);

			// Get the saved compaction entry for the extension event
			const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary) as CompactionEntry | undefined;

			if (this._extensionRunner && savedCompactionEntry) {
				await this._extensionRunner.emit({ type: "session_compact", compactionEntry: savedCompactionEntry, fromExtension, reason, willRetry });
			}

			const result: CompactionResult = { summary, firstKeptEntryId, tokensBefore, estimatedTokensAfter, usage, details };
			this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });

			if (willRetry) return true;
			// Auto-compaction can complete while follow-up/steering/custom messages are waiting.
			// Continue once so queued messages are delivered.
			return this.agent.hasQueuedMessages();
```

【注解（六个动作）】

1. **两条摘要来源归一**成五个局部量（summary/firstKeptEntryId/tokensBefore/usage/details）——**下游代码不关心摘要从哪来**（扩展 or 默认）。
2. `_runDefaultCompaction(...)`：**共享默认摘要器**（注释点名"also used by manual compaction"）——把 D10 的 `compact()` 包成"会话语境版"（注入 key/headers/retry/streamFn 之类的会话资产——具体参数以函数实现为准）。**找到它就读懂了"手动与自动的唯一差异"**。
3. **写盘**：`appendCompaction`（D9 第 11.3 节）——一次性事务的"提交点"。
4. **刷新与估算**：`getEntries` + `_refreshFinalizedContext()`（把投影刷给 `state.messages` 等消费方）+ `estimateMessagesTokens(projection.messages)`（压缩**后**的估算——进 `compaction_end` 的 `estimatedTokensAfter`，事件消费者能看到"省了多少"）。
5. **回找条目**：`find(e => e.type === "compaction" && e.summary === summary)`——**按 summary 匹配**（【陷阱】没有更稳的关联？`appendCompaction` 返回 id，但这里用 summary 匹配——如果两条摘要文本完全相同会匹配到第一条；实践里摘要几乎不可能同文，但这是一个"可改进点"式的观察。读代码时识别这类"概率上没问题"的写法，是审阅能力的一部分）。
6. **两个事件的顺序**：先 `session_compact`（**扩展视角**——带条目对象）→ 后 `compaction_end`（**UI/通用视角**——带 result 摘要）。【陷阱】顺序有含义：扩展可以**在界面前**看到/改后处理？不——事件都是通知；但"谁先收到"仍影响扩展的数据可见性（比如扩展在 `session_compact` 里又 append 了条目——会排在 `compaction_end` 之前被观察）。
7. **返回信号**（两条）：
   - `willRetry` → true（溢出恢复：调用方续跑）；
   - 否则 **`agent.hasQueuedMessages()`**——注释原文解释：压缩期间可能有 follow-up/steering/自定义消息在排队，**续跑一次把队列交付**（第 6.3 节的取数点语义——压缩占住运行，队列攒着）。
   - 【陷阱】这条返回值回答了"**压缩自身为什么可能带来一次额外模型请求**"——不只是恢复，也可能是"把排队消息送出去"。

## 10. 失败记账：`catch` 与 `finally`

【源码（节选）】

```typescript
		} catch (error) {
			const message = error instanceof Error ? error.message : "compaction failed";
			const aborted = abortController?.signal.aborted === true || cancelledByExtension;
			if (started) {
				const errorMessage = aborted
					? undefined
					: reason === "overflow"
						? `Context overflow recovery failed: ${message}`
						: `Auto-compaction failed: ${message}`;
				this._emit({ type: "compaction_end", reason, result: undefined, aborted, willRetry: false, errorMessage });
				await this._emitSessionCompactFailed({ reason, errorMessage, aborted, willRetry: false, fromExtension });
			}
			return false;
		} finally {
			if (this._autoCompactionAbortController === abortController) {
				this._autoCompactionAbortController = undefined;
			}
			this._resolveIdleWaitIfIdle();
		}
```

【注解】

- **aborted 的双来源**：`signal.aborted`（用户取消/`abortCompaction()`）**或** `cancelledByExtension`（钩子取消）——两者语义合并（"不是失败，是被中止"）；**取消时 `errorMessage` 为 undefined**（`aborted` 分支）——事件消费者据此区分"取消"与"失败"。
- **失败文案按 reason 分流**（"Context overflow recovery failed" vs "Auto-compaction failed"）——排障时按文案定位触发路径。
- 双事件（`compaction_end` + `session_compact_failed`）——与成功路径的"两视角"对称。
- **finally 两件事**：
  - 清 `_autoCompactionAbortController`（**身份比对**：只有还是"我"的控制器才清——防更晚的压缩覆盖时的错清；第 D11/D12 的"代际"守卫在单字段版）；
  - `_resolveIdleWaitIfIdle()`：**如果一切空闲，唤醒 `waitForIdle` 的等待者**——压缩也是"工作"，压缩期间"会话不空闲"（`isCompacting` 状态、`get_state` 的字段——H.8）。**收尾的统一"重新判定空闲"**。

## 11. 三条路径的对照总结

| 维度 | 自动-阈值 | 自动-溢出 | 手动 `/compact` |
|---|---|---|---|
| 触发 | `shouldCompact` 判定 | 溢出错误/可恢复截断 | 用户命令 |
| 入口 | `_checkCompaction` → `_runAutoCompaction("threshold")` | 同上（"overflow"）+ 先 `_omitRecoveryAttempt` | `AgentSession.compact()` |
| 重试 | 否（除非有队列消息） | 是（一击制；`willRetry`） | 否 |
| 扩展钩子 | `session_before_compact`（reason/threshold） | 同（reason/overflow） | 同（reason/manual + customInstructions） |
| 摘要器 | `_runDefaultCompaction` | 同 | 同（共享） |
| 写盘 | `appendCompaction` | 同 | 同 |
| 事件 | `compaction_start/end` + `session_compact` | 同 | 同 |

【陷阱】"共享"是理解这段代码的钥匙：**五件事（钩子、摘要、写盘、事件、空闲唤醒）在三条路径上完全一致**；差异集中在"触发条件、重试信号、自定义指令"。**读会话侧压缩不要重读三遍——读一遍共享段 + 三条触发段即可。**

## 12. 阅读检查清单

- [ ] 我能说出 `skipAbortedCheck` 在 T1/T2 两个调用点的相反语义吗？
- [ ] 我能解释三道一致性守卫（同模型/压缩边界/投影与编辑）各自防的误判吗？
- [ ] 我知道 `contextOverflow` 的两个分支与 `recoverableLength` 的定义吗？
- [ ] 我能复述溢出恢复的"一击制"与标志位重置点吗？
- [ ] 我能背出阈值分支的三种 token 口径与选择条件吗？
- [ ] 我知道 `_runAutoCompaction` 返回值两种 `true` 的含义吗？（恢复续跑 vs 队列交付）
- [ ] 我能说出成功/取消/失败三种收尾的事件组合吗？

---

> D15 完。精读篇（D1-D15）覆盖：循环、Agent、会话（投影/本体/压缩触发）、提示与压缩（读/写/触发）、SDK、CLI、工具、扩展（类型/派发/加载）、模型层、协议模式、交互模式。