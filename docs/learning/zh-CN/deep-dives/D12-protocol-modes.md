# D12：三种输出模式的协议层精读（JSON 事件整形、JSONL、print/RPC）

> 精读对象：`modes/json-event.ts`、`modes/rpc/jsonl.ts`、`modes/print-mode.ts`、`modes/rpc/rpc-types.ts`、`modes/rpc/rpc-mode.ts`、`modes/rpc/rpc-client.ts`。
> 对应主线：第 16 章（Print、JSON 与 CLI RPC）。
> 读法：先读"整形三件套"（事件 → JSON 事件 → JSONL 行），再读三个模式怎么用它（print/json/rpc），最后读客户端。

---

## 0. 整形流水线：同一事件，两种去向

```mermaid
flowchart LR
  S[AgentSessionEvent<br/>内存里的富事件] --> J[toJsonEvent<br/>去掉累积快照]
  J --> W[serializeJsonLine<br/>JSON + \n]
  W --> O[writeRawStdout<br/>raw 写 + 背压等待]
  O --> P[print/json 进程的 stdout / RPC 的 stdout]
```

【陷阱】整形发生在**每一个订阅回调里**（`session.subscribe((event) => writeRawStdout(serializeJsonLine(toJsonEvent(event))))`）——**同步、单条、逐事件**；没有批量缓冲（正确性优先；背压靠独立的等待机制，见第 4 节）。

---

# 第一部分：`json-event.ts` 与 `jsonl.ts`

## 1. `json-event.ts`：把"富事件"压成"瘦事件"

### 1.1 类型层的三个变换

【源码（完整）】

```typescript
type WithoutPartial<T> = T extends { partial: unknown } ? Omit<T, "partial"> : T;

type ToJsonAssistantMessageEvent<T> = T extends { type: "toolcall_start"; partial: unknown }
	? WithoutPartial<T> & { id: string; toolName: string }
	: WithoutPartial<T>;

type MessageUpdateEvent = Extract<AgentSessionEvent, { type: "message_update" }>;
type JsonMessageUpdateEvent = {
	type: "message_update";
	usage: Usage;
	assistantMessageEvent: ToJsonAssistantMessageEvent<MessageUpdateEvent["assistantMessageEvent"]>;
};

/** Session event shape emitted by the JSON and RPC stdout protocols. */
export type JsonAgentSessionEvent = Exclude<AgentSessionEvent, { type: "message_update" }> | JsonMessageUpdateEvent;
```

【注解】

- `WithoutPartial<T>`：**条件类型**——"如果 T 有 `partial` 字段，就 Omit 掉它；否则保持原样"。`AssistantMessageEvent` 家族里**每个成员都带 `partial`**（第 4.2 节），所以实际效果=统一去掉快照。
- `ToJsonAssistantMessageEvent`：在去快照的基础上，**`toolcall_start` 额外加 `id` 与 `toolName`**——【陷阱】为什么单独给它？因为线上格式删掉了 `partial`，而流式消费方在 `toolcall_start` 时**需要知道"这是哪个工具调用"**（后续 `toolcall_delta` 只带 `contentIndex` 与分片参数）；id/name 是**常量大小**的补偿信息（下面函数注释原话："Cumulative usage, tool-call ids, and tool names remain available because their size is constant."）。
- `JsonAgentSessionEvent = Exclude<AgentSessionEvent, {message_update}> | JsonMessageUpdateEvent`：**只有 `message_update` 被替换成瘦版本**，其余事件原样（通知类事件的载荷都不大）。
- 【陷阱】这三个类型是**纯类型层**（`type` 声明）——运行时只体现在下面的函数里。读第 16 章的 `JsonAgentSessionEvent` 时别去运行时找"哪一步 Omit 了 partial"——是**编码函数逐事件构造**的结果，类型只是对同一事实的静态描述。

### 1.2 运行时：`toJsonAssistantMessageEvent` 与 `toJsonEvent`

【源码（完整）】

```typescript
function toJsonAssistantMessageEvent(
	event: MessageUpdateEvent["assistantMessageEvent"],
): JsonMessageUpdateEvent["assistantMessageEvent"] {
	if (event.type === "toolcall_start") {
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

## 2. `jsonl.ts`：LF-only 的分帧（服务端与客户端共用）

### 2.1 `serializeJsonLine`

【源码】

```typescript
/**
 * Serialize a single strict JSONL record.
 *
 * Framing is LF-only. Payload strings may contain other Unicode separators such as
 * U+2028 and U+2029. Clients must split records on `\n` only.
 */
export function serializeJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}
```

【注解】

- 一行 = `JSON.stringify` + **LF**（绝不用 `\r\n`）。
- 注释把"为什么强调 LF-only"写给了客户端（第 16.3.1 节的五条硬规则之一在**生产端**的复述）；U+2028/U+2029 可出现在 JSON 字符串中，协议分帧仍只认 `\n`。Node v23.9.0 官方 `readline` 文档只列出 `\n`、`\r`、`\r\n`，未证实源码注释所说的额外 Unicode 分隔符行为。

### 2.2 `attachJsonlLineReader`：跨块的"按行重组"服务端实现

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
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	const emitLine = (line: string) => {
		onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	};

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

# 第二部分：print / RPC 两个模式与客户端

## 3. `print-mode.ts`：单发运行的完整骨架

### 3.1 资源与信号：先"清场"，再干活

【源码（节选）】

```typescript
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
	const { mode, messages = [], initialMessage, initialImages } = options;
	let exitCode = 0;
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let unsubscribeBackpressure: (() => void) | undefined;
	let disposed = false;
	const signalCleanupHandlers: Array<() => void> = [];

	const disposeRuntime = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		unsubscribeBackpressure?.();
		await runtimeHost.dispose();
	};

	const registerSignalHandlers = (): void => {
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

### 3.2 重绑：把"扩展上下文"接到当前会话

【源码（节选）】

```typescript
	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		await session.bindExtensions({
			mode: mode === "json" ? "json" : "print",
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

### 3.3 主体：三次 prompt、两种输出、统一兜底

【源码（节选）】

```typescript
	try {
		if (mode === "json") {
			const header = session.sessionManager.getHeader();
			if (header) writeRawStdout(`${JSON.stringify(header)}\n`);
		}

		await rebindSession();

		if (initialMessage) await session.prompt(initialMessage, { images: initialImages });
		for (const message of messages) await session.prompt(message);

		if (mode === "text") {
			const state = session.state;
			const lastMessage = state.messages[state.messages.length - 1];
			if (lastMessage?.role === "assistant") {
				const assistantMsg = lastMessage as AssistantMessage;
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
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		for (const cleanup of signalCleanupHandlers) cleanup();
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

## 4. 顺带认识 `output-guard.ts` 的三件套

print/json/rpc 都使用 `writeRawStdout`/`waitForRawStdoutBackpressure`/`flushRawStdout`（来自 `core/output-guard.ts`）：

```text
writeRawStdout(value)              把字符串写入"被接管的 stdout"（绕过 console 的格式化）
waitForRawStdoutBackpressure()     等写缓冲降到水位线（可 await 的背压）
flushRawStdout()                   退出前等待全部落地
```

- 【陷阱】为什么叫 "raw"？因为 `main.ts` 在非交互模式 `takeOverStdout()`（D6 第 4 节）——**把 `process.stdout.write` 换成了带背压追踪的受控写入**；普通 `console.log` 会被重定向到 stderr（保护协议通道）。**"谁在写 stdout、怎么写"是一套被接管的机制**，读模式代码前先知道这一点，就不会困惑"这些 write 从哪来"。
- 【跳转】`core/output-guard.ts` 的实现本身很短（第 16.8 节的实验里会验证背压行为）——建议顺手读一遍（搜索 `takeOverStdout`/`writeRawStdout`/`restoreStdout` 三个符号）。

## 5. `rpc-types.ts`：协议面的类型学

### 5.1 命令：一个大联合（按域分组）

【源码（节选，完整分组）】

```typescript
export type RpcCommand =
	// Prompting
	| { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
	| { id?: string; type: "steer"; message: string; images?: ImageContent[] }
	| { id?: string; type: "follow_up"; message: string; images?: ImageContent[] }
	| { id?: string; type: "abort" }
	| { id?: string; type: "clear_queue" }
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

### 5.2 状态快照与响应

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
	messageCount: number;
	pendingMessageCount: number;
}
```

【注解】

- **12 个字段=客户端面板的全部数据源**（模型/思考/流态/压缩态/队列模式/会话身份/计数）。`messageCount` 与 `pendingMessageCount` 是**摘要数字**（不是消息本体——本体要 `get_messages`）——**"状态查询轻、数据查询重"的分工**。
- 【陷阱】没有 `isRetrying` 字段？重试状态靠**事件**（`auto_retry_*`）传播——快照只包含"持续可查询"的状态；瞬时过程用事件。**状态 vs 事件的边界**在协议设计里再次出现（第 4 章）。
- `RpcResponse` 是一个**按命令一一对应的成功/失败联合**（success: true + data 形状 / success: false + error 字符串，都带 `command` 字段便于校验）——【陷阱】读响应类型时注意"同一 command 的 data 形状由联合成员决定"（例如 `prompt` 是 `{ disposition }`）；客户端 `getData<T>()` 的解包（下一节）依赖它。

## 6. `rpc-mode.ts`：分发、扩展 UI 与关停

### 6.1 骨架：三个小工具与一个等待表

【源码（节选）】

```typescript
export async function runRpcMode(runtimeHost: AgentSessionRuntime): Promise<never> {
	takeOverStdout();
	let session = runtimeHost.session;
	// ...
	const output = (obj: RpcResponse | RpcExtensionUIRequest | object) => {
		writeRawStdout(serializeJsonLine(obj));
	};
	const success = <T extends RpcCommand["type"]>(id, command: T, data?) => {
		if (data === undefined) return { id, type: "response", command, success: true } as RpcResponse;
		return { id, type: "response", command, success: true, data } as RpcResponse;
	};
	const error = (id, command, message): RpcResponse => {
		return { id, type: "response", command, success: false, error: message };
	};

	const pendingExtensionRequests = new Map<string, { resolve; reject }>();
	let shutdownRequested = false;
	let shuttingDown = false;
```

【注解】

- `takeOverStdout()`：**RPC 也接管**（同 print/json）——协议纯净的第一道保障。
- `output` = `writeRawStdout(serializeJsonLine(obj))`——**单一行写**（整形与序列化的组合；第 0 节流水线的落点）。
- `success`/`error` 两个构造器把"响应形状"集中一处（**避免手写对象散落各处**——类型断言 `as RpcResponse` 因为泛型 `command` 无法自动匹配联合成员；【陷阱】这类 `as` 是"构造函数签名比 TS 能表达的形状更精确"的妥协——读时确认它不改变运行时行为）。
- `pendingExtensionRequests`：**扩展对话框的等待表**（id → resolve/reject）；`shutdownRequested`/`shuttingDown`：两个标志位（请求关停 vs 正在关停——**幂等/重入防护**第 N 次出现）。

### 6.2 扩展 UI 子协议：`createDialogPromise` 与降级

【源码（节选）】

```typescript
	function createDialogPromise<T>(opts, defaultValue: T, request: Record<string, unknown>, parseResponse): Promise<T> {
		if (opts?.signal?.aborted) return Promise.resolve(defaultValue);

		const id = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | undefined;

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

### 6.3 输入分发：`handleInputLine`

【源码（完整）】

```typescript
	const handleInputLine = async (line: string) => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (parseError: unknown) {
			output(error(undefined, "parse", `Failed to parse command: ${...}`));
			await waitForRawStdoutBackpressure();
			return;
		}

		// Handle extension UI responses
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

### 6.4 关停与"永不返回"

【源码（节选）】

```typescript
	const onInputEnd = () => { void shutdown(); };
	process.stdin.on("end", onInputEnd);

	detachInput = (() => {
		const detachJsonl = attachJsonlLineReader(process.stdin, (line) => { void handleInputLine(line); });
		return () => { detachJsonl(); process.stdin.off("end", onInputEnd); };
	})();

	// Keep process alive forever
	return new Promise(() => {});
}
```

【注解】

- **stdin 的 `end` = 关停信号**（第 16.5.6 节"关 stdin 请求有序关停"的服务端实现）。
- `attachJsonlLineReader(process.stdin, ...)`：**复用与客户端同一个分帧实现**（第 2 节）——服务端读命令、客户端读事件，**同一把尺子**。
- `return new Promise(() => {})`：**永不 resolve 的 Promise**（函数签名 `Promise<never>`）——注释直白："Keep process alive forever"。进程的寿命由 stdin 结束/信号决定，不由函数返回决定。【陷阱】这是"顶层常驻循环"在 async 世界的写法——`await runRpcMode(runtime)` 在 main 里会永远挂着（D6 第 10 节的分发点）。

## 7. `rpc-client.ts`：客户端七件套

### 7.1 字段与启动：子进程 + 收集器

【源码（节选）】

```typescript
export class RpcClient {
	private process: ChildProcess | null = null;
	private stopReadingStdout: (() => void) | null = null;
	private eventListeners: RpcEventListener[] = [];
	private pendingRequests: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }> = new Map();
	private requestId = 0;
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
		this.exitError = null;
		const cliPath = this.options.cliPath ?? "dist/cli.js";
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

		childProcess.stderr?.on("data", (data) => { this.stderr += data.toString(); process.stderr.write(data); });
		childProcess.once("exit", (code, signal) => { /* 记录 exitError + rejectPendingRequests */ });
		childProcess.once("error", (error) => { /* 同上（带 stderr 上下文） */ });
		childProcess.stdin?.on("error", (error) => { /* 同上（stdin 写失败） */ });

		this.stopReadingStdout = attachJsonlLineReader(childProcess.stdout!, (line) => { this.handleLine(line); });

		await new Promise((resolve) => setTimeout(resolve, 100));
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

### 7.2 `handleLine`：响应和事件如何分流

【源码（完整核心逻辑）】

```typescript
private handleLine(line: string): void {
  try {
    const data = JSON.parse(line);
    if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
      const pending = this.pendingRequests.get(data.id)!;
      this.pendingRequests.delete(data.id);
      pending.resolve(data as RpcResponse);
      return;
    }
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

### 7.3 `send`：建立一次请求的生命周期

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

### 7.4 `promptAndWait`：先订阅可以避免漏掉事件，但不是所有输入都能等待

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

### 7.5 停止进程和在途请求

`stop()` 会先停止 stdout reader，再向子进程发 `SIGTERM`；最多等待 1 秒，超时则发 `SIGKILL`，随后设 `process = null` 并清空 pending Map。通常子进程退出事件会触发 `rejectPendingRequests()`，并让所有等待命令拒绝。

【陷阱】若 1 秒后 Promise 的退出等待分支先 resolve、而 SIGKILL 子进程的 `exit` 事件尚未送达，`stop()` 可能先清空 Map；随后 exit handler 的 `rejectPendingRequests()` 已看不到那些 waiter。不要假定 `stop()` 对每个用户请求都提供了强制 reject 保证。上层应在 stop 前结束/取消工作，并给自己的操作设截止时间。

## 8. 总结

### 8.1 三个模式共用/独有件一览

| 组件 | print(text) | json | rpc |
|---|---|---|---|
| `takeOverStdout` | ✅（main 里） | ✅ | ✅ |
| `writeRawStdout` 家族 | ✅（最终文本） | ✅（事件流） | ✅（响应+事件） |
| `toJsonEvent` | ❌ | ✅ | ✅ |
| `serializeJsonLine` | ❌ | ✅ | ✅ |
| `attachJsonlLineReader` | ❌ | ❌（产出端） | ✅（读命令） |
| 扩展绑定（bindExtensions） | ✅ | ✅ | ✅ |
| 事件订阅 | ❌ | ✅ | ✅ |
| 背压 | flush | ✅（订阅 + 每次写后等） | ✅（每次写后等） |
| 退出码 | 0/1（最后消息状态） | 0（异常才非 0） | 常驻（信号/stdin 决定） |

### 8.2 五条"协议工程"经验（可迁移到任何 JSONL 协议实现）

1. **分帧只认 LF**，实现里连 readline 都换掉（换掉它还要在注释里写明为什么）；
2. **移除累积快照**让流式体积线性化，把"常量字段"（id/name/usage）留在协议里；
3. **id 关联是唯一可靠的配对方式**——因为服务端逐行并发处理（`void handleInputLine`）；
4. **背压要贯穿每条写出路径**（包括错误响应）；
5. **关停路径穷尽**（stdin end、信号、SIGKILL 超时、pending 清理、解绑器、flush）——**任何一条漏掉，长跑进程就会以某种方式泄漏**。

### 8.3 阅读检查清单

- [ ] 我能说出 `toJsonEvent` 对 `toolcall_start` 的两个补偿字段及其理由吗？
- [ ] 我知道 `attachJsonlLineReader` 的 onEnd flush 在防什么吗？
- [ ] 我能复述 print-mode 的信号处理（信号列表、退出码、清理顺序）吗？
- [ ] 我知道"背压订阅"为什么挂在 `session.agent.subscribe` 上吗？
- [ ] 我能列出 `createDialogPromise` 的三种结局与默认值策略吗？
- [ ] 我知道 RPC 命令响应可能乱序的服务端根源吗？
- [ ] 我能说出 `RpcClient.stop` 的两段式关停吗？

---

> D12 完。精读篇（D1-D12）覆盖：循环、Agent、会话（投影/本体）、提示与压缩（读/写）、SDK、CLI、工具、扩展、模型层、协议模式。
