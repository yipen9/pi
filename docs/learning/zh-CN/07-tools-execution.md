# 第 7 章：工具定义、调度、结果与失败

> 学完本章你能回答：
>
> 1. 一个工具由哪些字段定义？`AgentTool` 和 `ToolDefinition` 有什么区别？
> 2. 模型怎么知道有哪些工具可用？工具清单中途变化时会发生什么？
> 3. 参数校验是怎么做的？校验失败、工具抛错、被拦截、被取消，各自变成什么？
> 4. 顺序执行与并行执行怎么选？"完成顺序"和"记录顺序"分别由哪段代码保证？
> 5. 内置工具（`read`/`write`/`bash`）是怎么写的？输出截断保护了什么？

**前置知识**：第 3 章（工具流水线概览）、第 4 章（消息与结果类型）、第 6 章（循环与取消）。
**预计学习时间**：2 天（建议把 `read.ts`、`write.ts` 两个小文件完整读一遍）。
**本章验证状态**：静态核对通过；实验 L04 需本地运行（faux 驱动）。

---

## 7.1 工具的两个形态：`AgentTool` 与 `ToolDefinition`

### 7.1.1 运行时契约：`AgentTool`

Agent 循环只认识这个接口（`packages/agent/src/types.ts`，第 1 章看过，这次逐字段精读）：

```typescript
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> extends Tool<TParameters> {
	/** Human-readable label for UI display. */
	label: string;
	/**
	 * Optional compatibility shim for raw tool-call arguments before schema validation.
	 * Must return an object that matches `TParameters`.
	 */
	prepareArguments?: (args: unknown) => Static<TParameters>;
	/**
	 * JSON Schema of `structuredContent` in successful results. Tools that declare it should always
	 * set `structuredContent`.
	 */
	outputSchema?: TSchema;
	/**
	 * Execute the tool call. Throw on failure, or return a result with `isError: true`; do not only
	 * describe the failure in `content`.
	 */
	execute: (
		toolCallId: string,
		params: Static<TParameters>,
		signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<TDetails>,
	) => Promise<AgentToolResult<TDetails>>;
	/** Recovery policy for an effect whose durable intent exists but whose outcome is unknown. */
	replay?: "never" | "safe";
	/**
	 * Per-tool execution mode override.
	 * - "sequential": this tool must execute one at a time with other tool calls.
	 * - "parallel": this tool can execute concurrently with other tool calls.
	 */
	executionMode?: ToolExecutionMode;
}
```

要点：

- **四参数执行签名**：调用 id、校验后的参数、取消信号、进度回调。工具作者要处理后三者；
- `replay` 是给"持久执行"场景（第 23 章 durable）用的：打算重放一个"意图已持久化但结果未知"的操作时，`"never"` 表示不要重放（如发邮件），`"safe"` 表示可重放（如纯读）；
- `executionMode` 是**工具自己声明**的并发限制（第 7.5 节展开）。

`execute` 的注释把错误处理规则钉死了：**"抛错，或返回 `isError: true` 的结果；不要把失败只写在 content 里。"** 为什么？因为上层的判断（是否计入失败统计、界面是否标红、重试策略）依赖 `isError` 这个布尔字段，而不是反解文本。

### 7.1.2 注册形态：`ToolDefinition`

`coding-agent` 内部用更丰富的 `ToolDefinition`（`core/extensions/types.ts`）。它比 `AgentTool` 多了"给模型看的提示元数据"和"给界面看的渲染器"：

```typescript
// 概念节选（真实定义见 extensions/types.ts）
interface ToolDefinition<TParameters, TDetails> {
	name: string;
	label: string;
	description: string;               // 模型读到的工具说明
	parameters: TParameters;           // typebox schema
	promptSnippet?: string;            // 系统提示里的"工具速览"一行
	promptGuidelines?: string[];       // 系统提示里的使用准则
	constrainedSampling?: ...;         // 请求层约束（如 json_schema strict）
	prepareArguments?: ...;
	outputSchema?: ...;
	executionMode?: ...;
	execute: (toolCallId, params, signal, onUpdate, ctx?: ExtensionContext) => ...;
	renderers?: ...;                   // 界面渲染
}
```

两个形态之间可以双向转换（`core/tools/tool-definition-wrapper.ts`）：

```typescript
/** Wrap a ToolDefinition into an AgentTool for the core runtime. */
export function wrapToolDefinition<TDetails = unknown>(
	definition: ToolDefinition<any, TDetails>,
	ctxFactory?: ToolContextFactory,
): AgentTool<any, TDetails> {
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		parameters: definition.parameters,
		outputSchema: definition.outputSchema,
		constrainedSampling: definition.constrainedSampling,
		prepareArguments: definition.prepareArguments,
		executionMode: definition.executionMode,
		execute: (toolCallId, params, signal, onUpdate, ctx?) =>
			definition.execute(toolCallId, params, signal, onUpdate,
				ctx ?? (ctxFactory?.(toolCallId, signal) as ExtensionToolContext)),
	};
}
```

以及反向：

```typescript
export function createToolDefinitionFromAgentTool(tool: AgentTool<any>): ToolDefinition<any, unknown> {
	return { name: tool.name, label: tool.label, description: tool.description, /* ... */ };
}
```

**为什么要两个形态？** 因为"运行时循环需要什么"和"应用注册/渲染需要什么"不同：

| 需求 | AgentTool | ToolDefinition |
|---|---|---|
| 循环执行 | 需要 | —— |
| 生成系统提示（速览/准则） | —— | 需要 |
| 终端渲染（不同工具不同样式） | —— | 需要 |
| 扩展上下文（`ctx`：cwd、模型等） | —— | 需要 |
| 第三方直接传 `AgentTool` | 兼容（自动合成最小定义） | —— |

读代码时注意：**`Agent` 只见到 `AgentTool`；`AgentSession` 内部维护"definition 优先"的注册表**，用 `wrapToolDefinition` 往下层喂。

扩展工具的注册、上下文创建和会话刷新之间还有一层生命周期；见[第 14 章 14.1.1 节](14-tool-extensions.md#1411-从注册到执行的端到端轨迹)。这里先记住一个边界：`ToolDefinition.execute` 的类型把 `ctx` 写成必填，但直接调用或没有传 `ctxFactory` 的适配路径不会凭空生成上下文，运行时可能收到 `undefined`。扩展通过会话注册并由 `wrapRegisteredTool` 包装时，才会在每次调用时用 `ExtensionRunner.createToolContext()` 提供它。

## 7.2 工具从哪来：工厂、组合与命名

`packages/coding-agent/src/core/tools/index.ts` 是整个内置工具库的门面。命名约定：

```typescript
export type ToolName = "read" | "bash" | "powershell" | "edit" | "write" | "grep" | "find" | "ls";
export const allToolNames: Set<ToolName> = new Set([...]);
```

工厂分两家：`createXxxTool(cwd, options)` 返回 `AgentTool`；`createXxxToolDefinition(cwd, options)` 返回 `ToolDefinition`。再往上，是**组合函数**：

| 组合 | 包含 | 场景 |
|---|---|---|
| `createCodingTools(cwd)` | read, bash, edit, write | 标准编码模式（默认） |
| `createReadOnlyTools(cwd)` | read, grep, find, ls | 只读审查（`--tools read,grep,find,ls`） |
| `createAllTools(cwd)` | 全部八个 | 需要完整能力时 |
| `createTool(name, cwd)` | 单个 | 精细控制 |

`AGENTS.md` 风格的对应关系：**"默认工具集"由 `DEFAULT_TOOL_NAMES` 与设置 `defaultTools` 决定**（第 3 章 sdk.ts 的 `initialActiveToolNames` 计算）；`--tools` 白名单和 `--exclude-tools` 再叠加。工具的**执行能力**与**声明**是两码事，下一节展开。

（扩展注册自定义工具的路径（`pi.registerTool`）在第 13、14 章；MCP 工具在 22 章。）

## 7.3 声明与"工具载入变化"：模型怎么知道你能做什么

### 7.3.1 声明进系统消息

模型不知道"进程里注册了什么"，它只知道**消息里声明了什么**。工具声明被编入系统消息（第 4 章 `SystemMessage.toolsAdded`）；`AgentContext.tools` 则是"当前进程真正可执行的集合"。两者由 `declareToolChanges` 保持同步（`agent-loop.ts`）：

```typescript
/**
 * Declare tool loadout changes to the model.
 *
 * `context.tools` is what the runtime can execute; the transcript's system messages declare
 * what the model may call. Before each request the difference becomes `toolsAdded` and
 * `toolsRemoved` on a system message. ...
 */
function declareToolChanges(context: AgentContext, pendingMessages: AgentMessage[]): AgentMessage[] {
	// 找到待注入消息里的最后一条 system 消息（若有），以它为基线
	// 计算：已声明集合（getCurrentTools）与可执行集合（context.tools）的差
	const changes = getToolStateChanges(
		getCurrentTools([...context.messages, ...baseline]),
		(context.tools ?? []).map(toToolDeclaration),
	);
	const unchanged = changes.toolsAdded.length === 0 && changes.toolsRemoved.length === 0;
	if (unchanged) return pendingMessages;
	// 有变化：在第一条非 system 待注入消息之前插入一条"工具变化"系统消息
	const update = withToolChanges({ role: "system", content: "", timestamp: Date.now() }, changes);
	// ...
}
```

三个可观察的行为：

1. **首次请求**：转录里还没有系统消息声明工具 → 生成一条 `toolsAdded: [全部工具]` 的系统消息（会话文件里你能看到它，第 4.7.4 节示例）；
2. **中途启用/禁用工具**（扩展调用 `setActiveTools`、或 `finishTurn` 改了 `state.tools`）→ 下一次请求前生成一条只含增删差异的系统消息；
3. **不变则不写**：`unchanged` 直接返回，避免历史里塞满无意义的补丁。

### 7.3.2 为什么"可执行"与"已声明"要分开

因为二者承担不同职责：

- **已声明**：模型可以调用什么（写进对话历史，可回放）；
- **可执行**：运行时真的有什么（可能是动态的、依赖当前的扩展状态）。

如果只保留一份，就不可能做到"会话回放时精确重建当时模型看到的工具清单"。**可回放性是本仓库的底层设计目标之一**，你在第 4、9 章反复看到它的影子。

### 7.3.3 模型侧的形状：`toToolDeclaration`

`toToolDeclaration`（`pi-ai`）把内部 `Tool` 转成"转录里的声明形状"（name/description/parameters）。再往下，供应商适配器把它转成各家格式（第 5.5.3 节）。所以一个工具定义从代码到模型，走了三站：

```text
ToolDefinition（应用注册，含提示元数据）
  → AgentTool（运行时）
    → toToolDeclaration（转录系统消息里的声明）
      → 供应商格式（input_schema / function.parameters ...）
```
## 7.4 参数校验：模型给的参数可信吗？

不可信。模型可能传错类型、漏字段、把数字写成字符串。pi 在工具执行前做一层**运行时校验**（`packages/ai/src/utils/validation.ts`）：

```typescript
/**
 * Validates tool call arguments against the tool's TypeBox schema
 * @returns The validated (and potentially coerced) arguments
 * @throws Error with formatted message if validation fails
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	const args = structuredClone(toolCall.arguments);        // ① 克隆：绝不改模型给的原对象
	normalizeOptionalNulls(args, tool.parameters);           // ② 把"可选字段传了 null"归一化
	Value.Convert(tool.parameters, args);                    // ③ 类型强转（如 "42" → 42）

	const validator = getValidator(tool.parameters);
	if (!Object.getOwnPropertySymbols(tool.parameters).includes(TYPEBOX_KIND)) {
		// ④ 非 typebox 的 schema：做一轮 JSON Schema 兼容强转
		const coerced = coerceWithJsonSchema(args, tool.parameters);
		if (coerced !== args) { /* 合并结果 */ }
	}

	if (validator.Check(args)) {
		return args;                                          // ⑤ 通过：返回校验后的参数
	}

	// ⑥ 失败：拼出"路径 + 原因 + 收到的参数"的错误文本
	const errors = validator.Errors(args)
		.map((error) => `  - ${formatValidationPath(error)}: ${error.message}`)
		.join("\n") || "Unknown validation error";
	throw new Error(`Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n${JSON.stringify(toolCall.arguments, null, 2)}`);
}
```

六个步骤的设计动机，逐个说：

1. **`structuredClone`**：参数对象会被后续强转/归一化**就地修改**，必须先克隆。模型的消息对象要保持原样（历史回放需要原始值）；
2. **`normalizeOptionalNulls`**：模型常把"不填的可选字段"写成 `null`。schema 里 `Type.Optional` 只接受"缺失或正确类型"，这里先把 `null` 处理掉；
3. **`Value.Convert`**：typebox 的类型强转，例如 `"3"` → `3`、`"true"` → `true`。这是对模型小失误的宽容；
4. **非 typebox schema 兼容**：工具可能声明的是纯 JSON Schema（扩展作者手写），用辅助强转兜底；
5. **通过则返回**：返回的是"校验后的副本"，`execute` 收到的一定满足 schema；
6. **失败拼详细错误**：错误里包含**收到的原始参数**（pretty JSON）。这条错误文本会作为工具结果发给模型——模型据此自我纠正（比如"哦，path 不是数组，是字符串"）。

### 7.4.1 校验失败的完整去向

```text
validateToolArguments 抛错
  → prepareToolCall 的 catch 捕获
    → 返回 { kind: "immediate", result: createErrorToolResult(错误文本), isError: true }
      → 照样走 emitToolExecutionEnd + 生成 ToolResultMessage
        → 模型下一轮看到 "Validation failed for tool ..." 并重新尝试
```

**没有一步会中断整个循环。** "错误是一种结果"在这里第二次出现。

### 7.4.2 `prepareArguments`：校验前的最后修补

有些工具需要一个"兼容垫片"，在**校验之前**修正原始参数（比如老模型把 `file_path` 写成 `path`）：

```typescript
function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
	if (!tool.prepareArguments) return toolCall;
	const preparedArguments = tool.prepareArguments(toolCall.arguments);
	if (preparedArguments === toolCall.arguments) return toolCall;   // 未修改则保持原对象
	return { ...toolCall, arguments: preparedArguments as Record<string, any> };
}
```

顺序是：**`prepareArguments`（修补）→ `validateToolArguments`（校验）→ `beforeToolCall`（也许拦截）→ `execute`（执行）**。

### 7.4.3 `unknown` 与 `as`：类型检查不能替代运行时校验

这一段同时跨过了 TypeScript 类型系统和运行时数据边界。初学者要把三件事拆开：

| 动作 | 发生时机 | 能保证什么 |
|---|---|---|
| `Static<typeof schema>` | TypeScript 检查源码时 | 编辑器知道符合 schema 的对象应有哪些字段/类型 |
| `validateToolArguments(...)` | 程序运行时 | 对模型给出的实际数据做转换和 schema 检查；失败就抛错 |
| `value as SomeType` | TypeScript 检查源码时 | 告诉编译器“按这个类型看”；不会检查或修改实际值 |

为什么需要运行时校验？模型响应从网络流中解析而来，TypeScript 编译器不会在运行时替你检查 JSON。即使模型供应商声明支持 JSON Schema，仍然需要把本地实际收到的值当作不可信数据。

真实准备路径（`packages/agent/src/agent-loop.ts` → `prepareToolCall`）可缩写为：

```typescript
const preparedToolCall = prepareToolCallArguments(tool, toolCall);
const validatedArgs = validateToolArguments(tool, preparedToolCall);

if (config.beforeToolCall) {
  const beforeResult = await config.beforeToolCall(
    { assistantMessage, toolCall, args: validatedArgs, context: currentContext },
    signal,
  );
  if (beforeResult?.block) {
    return {
      kind: "immediate",
      result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
      isError: true,
    };
  }
}

return { kind: "prepared", toolCall, tool, args: validatedArgs };
```

节选省略 abort 检查和错误分支。按时间读：

1. `toolCall.arguments` 是模型给的原始参数；
2. `prepareToolCallArguments` 可做兼容转换；
3. `validateToolArguments` 克隆、转换并检查；
4. `beforeToolCall` 收到校验后的参数，但上下文类型把 `args` 定义成 `unknown`；
5. 没被拦截就把当前这个参数对象放进 `PreparedToolCall`；
6. 后续 `executePreparedToolCall` 把它传给工具 `execute`。

这里没有第二次 schema validation。hook 收到的是共享的对象引用，可以原地改它。已有回归测试 `packages/agent/test/agent-loop.test.ts` 中的 `should execute mutated beforeToolCall args without revalidation` 正是这样验证的：schema 要求 `value: string`，hook 将 `value` 改成数字 `123`，工具实际收到数字。

```typescript
beforeToolCall: async ({ args }) => {
  const mutableArgs = args as { value: string | number };
  mutableArgs.value = 123;
  return undefined;
}
```

`as { value: string | number }` 只放宽 TypeScript 对这段代码的静态看法；真正改变对象的是下一行赋值。`as` 不会复制对象、不运行 TypeBox，也不会验证这个数字是否仍符合工具 schema。

【改代码时的意义】`execute(params)` 在没有 hook 的常规路径上收到的是已校验对象；启用可修改参数的 hook 后，工具可能收到 schema 不接受的值。若工具的安全性依赖更窄的运行时条件（例如路径必须位于工作目录、数值必须在范围内），不要只依赖入口 schema；在执行副作用之前验证该条件。若需求是让核心在 hook 修改后再次执行通用 schema 校验，那属于行为/API 变化，应先设计如何向模型报告 hook 改坏参数，再补回归测试，不能把当前实现误读成“自动二次校验”。

【关于 `unknown`】在 `BeforeToolCallContext` 里，`args: unknown` 是刻意的边界：hook 是通用的，它可能面对任何工具 schema。使用者需要先检查形状或在确认依据后写类型守卫。直接写 `any` 会让编译器放弃追问“这个值到底是什么”，因此本仓库规则要求尽量不用 `any`。部分旧的通用库类型仍出现 `any`，读者应理解为现有 API 的类型写法，不应照抄到新代码。

## 7.5 调度：从声明到执行的四步流水线

### 7.5.1 四步流水线（快照 + 完整视图）

回忆第 3.10 节，正常执行路径分四步。查无工具、准备校验失败或被 `beforeToolCall` 拦截时会得到 immediate 结果，跳过工具执行和 `afterToolCall`：

```text
① prepareToolCall        找工具 → prepareArguments → 校验 → beforeToolCall 钩子
   任何一步失败 → 直接产出 isError 结果（"immediate" 结局）
② executePreparedToolCall 调用 tool.execute(id, args, signal, onUpdate)
   抛错 → 折叠为 isError 结果；进度回调 → tool_execution_update 事件
③ finalizeExecutedToolCall afterToolCall 钩子做字段级改写
④ 记录与广播             tool_execution_end 事件 + ToolResultMessage 消息
```

用一个真实工具对照（`read` 的 `execute`）：准备阶段校验 `path/offset/limit`；执行阶段读文件；收尾阶段无钩子改动；记录阶段生成含文件内容的 `toolResult`。

### 7.5.2 顺序还是并行？

```typescript
const hasSequentialToolCall = toolCalls.some(
	(tc) => currentContext.tools?.find((t) => t.name === tc.name)?.executionMode === "sequential",
);
if (config.toolExecution === "sequential" || hasSequentialToolCall) {
	return executeToolCallsSequential(...);
}
return executeToolCallsParallel(...);
```

判定规则：**全局配置为 sequential，或批次里任意一个工具声明 `executionMode: "sequential"`，整批顺序执行。** 这是保守策略——有副作用的工具（如 edit 同一文件）不该和别的并发。

`executionMode` 的两个来源：

- 工具定义里声明（`AgentTool.executionMode` / `ToolDefinition.executionMode`）；
- 全局 `AgentOptions.toolExecution`（会话设置可覆盖）。

### 7.5.3 并行模式的准备、执行与记录顺序

```typescript
// 准备阶段：按声明顺序逐个发 start 并 await prepareToolCall
for (const toolCall of toolCalls) {
	await emit({ type: "tool_execution_start", ... });
	const preparation = await prepareToolCall(...);
	if (preparation.kind === "immediate") {
		// 查无工具、校验失败、hook 拦截等：准备期间立即发 end
		await emitToolExecutionEnd(...);
		finalizedCalls.push(...);
		continue;
	}
	finalizedCalls.push(async () => {           // ② 执行被推迟为"闭包"，稍后并发调用
		// ... executePreparedToolCall / finalize / emit end
	});
	if (signal?.aborted) break;
}

// 准备循环结束后才启动闭包；各闭包并发，end 在各自收尾后发出
const orderedFinalizedCalls = await Promise.all(
	finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
);

// 记录阶段：按已收集调用的声明顺序生成结果消息
for (const finalized of orderedFinalizedCalls) {
	const toolResultMessage = createToolResultMessage(finalized);
	await emitToolResultMessage(toolResultMessage, emit);
	messages.push(toolResultMessage);
}
```

这里有三个边界要一起读：所有调用的准备过程仍按声明顺序串行；只有准备成功的调用才会进入后面的并发执行闭包；准备立即失败/被拦截的调用会在准备循环内直接发 `tool_execution_end`。因此 `tool_execution_end` 不能笼统说成“完成顺序”：immediate 结果先于执行闭包发出，成功准备的调用则按各自执行和收尾完成次序发出。若取消信号在准备循环中变为 aborted，循环会停止，尚未准备的后续调用不会进入结果列表；已准备的闭包启动时还会再次检查 signal，已取消的调用会生成 `Operation aborted` 结果。最终结果消息按收集到的调用顺序生成，也就是模型声明顺序的已处理部分，不保证每个声明调用都有结果。

对照第 3.8.1 的结论：

| 顺序 | 由谁决定 | 代码位置 |
|---|---|---|
| `tool_execution_start` 顺序 | 模型声明顺序（准备是顺序的） | for 循环 |
| `tool_execution_end` 顺序 | immediate 结果在准备循环内发出；执行结果按闭包收尾顺序发出 | 准备循环与每个闭包内部 |
| 工具结果消息顺序 | 收集到调用的声明顺序；取消可使其成为声明序列的前缀 | `Promise.all` 后的有序循环 |
| `terminate` 判定 | 全部结果都 `terminate: true` 才生效 | `shouldTerminateToolBatch` |

### 7.5.4 `terminate` 的精确语义

```typescript
function shouldTerminateToolBatch(finalizedCalls: FinalizedToolCallOutcome[]): boolean {
	return finalizedCalls.length > 0 && finalizedCalls.every((finalized) => finalized.result.terminate === true);
}
```

- 它是"**不要因为本批工具继续循环**"的提示，不是"结束 run"；
- 一批里只要有一个结果没设 `terminate`，整批就不触发终止；
- 被 `beforeToolCall` 拦截（block）时也可以带 `terminate: true`（第 3 章代码里见过）。

## 7.6 前后钩子：beforeToolCall / afterToolCall

### 7.6.1 `beforeToolCall`：执行前的准入控制

```typescript
export interface BeforeToolCallResult {
	block?: boolean;      // 阻止执行；循环会发出错误工具结果
	reason?: string;      // 阻止原因（作为错误文本给模型）
	terminate?: boolean;  // 提示"本批结束后停止"（仍需整批都 terminate）
}
```

收到的上下文（`BeforeToolCallContext`）：`assistantMessage`（哪条消息提出的调用）、`toolCall`（原始调用块）、`args`（**已校验**的参数）、`context`（当时的 Agent 上下文）。

典型用途：权限确认（"要写文件？先问用户"）、审计日志、危险命令拦截。注意它是**异步**的，可以等待用户输入。

### 7.6.2 `afterToolCall`：结果的最终改写

字段合并语义（`AfterToolCallResult` 的注释是权威说明）：

| 字段 | 提供时 | 不提供时 |
|---|---|---|
| `content` | **整体替换**结果内容 | 保留原值 |
| `details` | 整体替换 | 保留 |
| `structuredContent` | 替换 | 若 `content` 被替换而它没给 → **丢弃**（可能不再匹配） |
| `isError` | 替换 | 保留 |
| `usage` | 替换 | 保留 |
| `terminate` | 替换 | 保留 |

"content 换了但 structuredContent 没跟上就丢弃"这条规则很细，但体现了数据一致性优先：**宁可没有结构化数据，也不留互相矛盾的两份。**

## 7.7 结果归一化：`AgentToolResult` → `ToolResultMessage`

工具返回 `AgentToolResult`，循环把它折成消息：

```typescript
function createToolResultMessage(finalized: FinalizedToolCallOutcome): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: finalized.toolCall.id,
		toolName: finalized.toolCall.name,
		// Untyped tools (JS extensions) can return results without content; normalize
		// so the null never enters session history or provider payloads.
		content: finalized.result.content ?? [],
		details: finalized.result.details,
		usage: finalized.result.usage,
		isError: finalized.isError,
		timestamp: Date.now(),
	};
}
```

字段去向表（对照第 4.3.4）：

| 字段 | 进消息？（发给模型） | 进会话文件？ | 给谁用 |
|---|---|---|---|
| `content` | 是 | 是 | 模型 + 界面 |
| `details` | 否 | 是 | 界面渲染、扩展逻辑 |
| `structuredContent` | 否（**不在消息类型里**） | 否（除非工具自己塞进 details） | 程序化调用者（`runToolCall` 返回值） |
| `usage` | 是（消息字段） | 是 | 统计工具内部模型开销 |
| `isError` | 是 | 是 | 界面标红、重试策略 |
| `terminate` | 否 | 否 | 仅循环控制 |

> `content ?? []` 的兜底是给 JS 扩展的：动态语言写的工具可能忘返回 `content`，直接透传 `null` 会污染历史与供应商请求。**归一化发生在边界上**——这是边界代码该负的责任。
## 7.8 内置工具精读：`read`

`packages/coding-agent/src/core/tools/read.ts` 约 300 行，是"一个成熟工具应该长什么样"的范本。

### 7.8.1 声明部分

```typescript
const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});

export const readToolSystemPromptContribution = {
	snippet: "Read file contents",
	guidelines: ["Use read to examine files instead of cat or sed."],
} as const;
```

- **schema 的 description 是写给模型看的**。每个字段的说明都会进入供应商请求的工具定义；
- `snippet` 与 `guidelines` 进入系统提示（工具速览与使用准则）。"用 read 而不是 cat/sed" 这种行为引导，靠的就是这一行文本；
- `export const` 让系统提示装配处可以引用同一份文本（单一来源，不会说两套话）。

工具描述里写明了截断规则：

```text
Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp).
Images are sent as attachments. For text files, output is truncated to 2000 lines or
50KB (whichever is hit first). Use offset/limit for large files. When you need the full
file, continue with offset until complete.
```

**模型能预判工具行为**（会截断、怎么续读），就不会因为"输出突然断了"而困惑。这是"面向模型写文档"的实践。

### 7.8.2 可插拔操作（Operations 注入）

```typescript
export interface ReadOperations {
	readFile: (absolutePath: string) => Promise<Buffer>;
	access: (absolutePath: string) => Promise<void>;
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),                       // 本地文件系统
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};
```

注释写明动机：**"Override these to delegate file reading to remote systems (for example SSH)."** 工具逻辑与 I/O 实现分离——第 23 章 Gondolin 扩展（把工具执行搬进微虚机）正是靠这层注入实现的。

### 7.8.3 执行部分：取消 + 文本路径

执行函数用了一个"手动 Promise"结构来精确处理取消：

```typescript
return new Promise((resolve, reject) => {
	if (signal?.aborted) { reject(new Error("Operation aborted")); return; }
	let aborted = false;
	const onAbort = () => { aborted = true; reject(new Error("Operation aborted")); };
	signal?.addEventListener("abort", onAbort, { once: true });

	(async () => {
		try {
			const absolutePath = await resolveReadPathAsync(path, ctx?.cwd || cwd);
			if (aborted) return;                       // 取消后不再继续
			await ops.access(absolutePath);            // 可读性检查（不存在会抛错）
			// ... 读内容 ...
			if (aborted) return;
			signal?.removeEventListener("abort", onAbort);   // 收尾：解除监听
			resolve({ content, details });
		} catch (error) {
			signal?.removeEventListener("abort", onAbort);
			if (!aborted) reject(error);
		}
	})();
});
```

三个模式值得学：

1. **`{ once: true }`**：abort 事件只监听一次，天然防重复；
2. **`aborted` 标志 + 每个 `await` 后检查**：取消后不再做无谓的后续步骤；
3. **收尾时 `removeEventListener`**：不留悬挂监听器（长会话里这是一个真实的泄漏点）。

文本路径的核心逻辑：

```typescript
const textContent = buffer.toString("utf-8");
const allLines = textContent.split("\n");
const totalFileLines = allLines.length;
// 1-indexed 入参 → 0-indexed 访问
const startLine = offset ? Math.max(0, offset - 1) : 0;
if (startLine >= allLines.length) {
	throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
}
// limit 优先裁剪，再交给 truncateHead 做全局截断
const truncation = truncateHead(selectedContent);
```

### 7.8.4 "可继续的截断提示"（本节的精华）

截断发生时，工具不是简单地在末尾写"……"了事，而是给出**可操作的续读指令**：

```typescript
if (truncation.firstLineExceedsLimit) {
	// 单行就超过 50KB：告诉模型绕过 read，直接用 bash 精准取一行
	const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
	outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${path} | head -c ${DEFAULT_MAX_BYTES}]`;
	details = { truncation };
} else if (truncation.truncated) {
	const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
	const nextOffset = endLineDisplay + 1;
	outputText = truncation.content;
	outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
	details = { truncation };
} else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
	const remaining = allLines.length - (startLine + userLimitedLines);
	const nextOffset = startLine + userLimitedLines + 1;
	outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
}
```

三种提示分别对应三种"截断"：

| 情况 | 提示 |
|---|---|
| 单行超限（比如压缩过的 JS） | 给出 `sed` + `head -c` 的替代命令 |
| 达到 2000 行/50KB 上限 | `[Showing lines a-b of n. Use offset=b+1 to continue.]` |
| 用户 limit 提前停下 | `[x more lines in file. Use offset=y to continue.]` |

**这就是"工具输出为模型而设计"**：模型看到提示就能自己继续读，不用人干预。

### 7.8.5 图片路径

```typescript
const processed = await processImage(buffer, mimeType, {
	autoResizeImages,
	resizeOptions: ctx?.model?.inputLimits?.images?.resize ?? fallbackResizeOptions,
});
```

- 图片按**当前模型的 inputLimits** 缩放（不同模型允许的分辨率/体积不同）；
- 缩放失败时降级为文字说明（`processed.message`）；成功时返回 `[文字说明, {type:"image",...}]` 两个内容块；
- 如果模型不支持图片（`model.input` 不含 `"image"`），附上提示"图片将在本次请求中省略"（`getNonVisionImageNote`）。发送层的 `convertToLlmWithBlockImages`（第 3 章）还会做最终屏蔽——**两道防线。**

## 7.9 截断系统：保护上下文也保护内存

### 7.9.1 三个截断函数与两个常量

`core/tools/truncate.ts`：

```typescript
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_MAX_BYTES = 50 * 1024; // 50KB

export function truncateHead(content, options): TruncationResult   // 保头（文件阅读）
export function truncateTail(content, options): TruncationResult   // 保尾（命令输出）
export function truncateLine(...)                                  // 单行截断
```

选用哪种取决于"哪里最重要"：

- **`read` 用 `truncateHead`**：文件开头是概述/导入，先看头；
- **命令输出用 `truncateTail`**：报错和结果通常在最后几行。

`TruncationResult` 携带结构化信息（`content`、`truncated`、`truncatedBy: "lines" | "bytes"`、`outputLines`、`firstLineExceedsLimit` 等），所以工具能把"怎么被截的"写进 `details`，给界面用。

### 7.9.2 流式输出的内存保护：`OutputAccumulator`

`bash` 这类工具的输出可能**持续流出且无限增长**。`core/tools/output-accumulator.ts` 的注释说明了一切：

```typescript
/**
 * Incrementally tracks streaming output with bounded memory.
 *
 * Appends decode chunks with a streaming UTF-8 decoder, keeps only a decoded
 * tail for display snapshots, and opens a temp file when the full output needs
 * to be preserved.
 */
```

机制（读接口即可）：

```typescript
export interface OutputSnapshot {
	content: string;             // 界面上要显示的部分（截断后的尾巴）
	truncation: TruncationResult;
	fullOutputPath?: string;     // 全量输出被写入的临时文件路径（若有）
}
```

- 内存里只保留**受限的尾巴**（`maxLines`/`maxBytes`）；
- 全量输出落到临时文件；`BashExecutionMessage` 的 `fullOutputPath`/`truncated` 字段（第 4.4 节）就是它的消费方；
- 用**流式 UTF-8 解码器**（`TextDecoder`，`stream: true` 语义）——避免多字节字符被块边界切断成乱码。这对中文输出尤其重要。

## 7.10 写类工具与文件变更队列

### 7.10.1 `write`：串行化同名文件的修改

`write.ts` 的执行部分：

```typescript
const absolutePath = resolveToCwd(path, ctx?.cwd || cwd);
const dir = dirname(absolutePath);
return withFileMutationQueue(absolutePath, async () => {
	// Do not reject from an abort event listener here: that would release the
	// mutation queue while an in-flight filesystem operation may still finish.
	// Checking signal.aborted after each await observes the same aborts while
	// keeping the queue locked until the current operation has settled.
	const throwIfAborted = (): void => {
		if (signal?.aborted) throw new Error("Operation aborted");
	};

	throwIfAborted();
	await ops.mkdir(dir);          // 自动建父目录
	throwIfAborted();
	await ops.writeFile(absolutePath, content);
	throwIfAborted();

	return { content: [{ type: "text", text: `Successfully wrote to ${path}` }], details: undefined };
});
```

**与 read 的取消模式对比**：write 故意**不用** `signal.addEventListener("abort", reject)`，原因写在注释里——如果在"队列锁内"的一个文件系统操作还没结束时就从 abort 监听器 reject，锁会被提前释放，另一个写操作可能插进来，造成竞态。改成"每个 await 之后检查标志"：取消依然及时（在操作边界生效），但不破坏锁的语义。

### 7.10.2 `withFileMutationQueue`：按文件键的互斥

`file-mutation-queue.ts` 的目标：**同一个文件的操作串行；不同文件并行。**

```typescript
const fileMutationQueues = new Map<string, Promise<void>>();
let registrationQueue = Promise.resolve();

async function getMutationQueueKey(filePath: string): Promise<string> {
	const resolvedPath = resolve(filePath);
	try {
		return await realpath(resolvedPath);       // 用真实路径做键
	} catch (error) {
		if (isMissingPathError(error)) return resolvedPath;   // 还不存在则用解析路径
		throw error;
	}
}

export async function withFileMutationQueue<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	// 注册阶段串行（registrationQueue），保证"算键 + 挂链"是原子的
	// 取出当前队列尾 → 挂上自己的"闸门" → await 前驱 → 执行 fn → 放行后继
}
```

用 `realpath` 做键的原因：`./a.txt`、`../dir/a.txt`、符号链接指向同一文件时，路径字符串不同但**真实文件是同一个**。键必须基于真实身份。

这里的保证有边界：现有目标可由 `realpath` 解析时，符号链接别名会归到同一键；目标不存在（或路径组件不存在）时，`ENOENT`/`ENOTDIR` 会回退为 `resolve()` 后的路径字符串。此时不同别名未必归到同一队列，测试只验证了**已存在文件**的符号链接别名。队列也只是当前进程内的协调，不是文件系统锁。

`registrationQueue` 仅串行“解析键并把本次操作接到该键队尾”的注册阶段，避免两个同时到达的调用漏掉彼此；拿到前驱 Promise 后，不同键的 `fn()` 可以并行。测试分别验证同一路径串行、不同路径并行。取消用例进一步验证 `write`/`edit` 在底层写操作尚未 settle 时仍占有队列，待写操作结束、随后检查到 abort 才释放锁；它不代表底层 I/O 能被强制取消。

一个具体场景：模型一轮里提交了"编辑 A 文件"和"重写 A 文件"两个调用（并行批次）。如果没有这个队列，两个操作可能交错读写——有了它，第二个必须等第一个完成后才执行。

## 7.11 `bash` 工具概览：外部进程是另一类问题

`bash.ts`（15KB）比 read/write 复杂一个量级，因为它面对的是**外部进程**：启动、流式输出、超时、取消（杀进程树）、退出码。要点先建立，细节留给第 17、19 章：

```typescript
export interface BashOperations {
	exec: (
		command: string,
		cwd: string,
		options: { onData: (chunk: Buffer) => void; signal?: AbortSignal; timeout?: number; env?: Record<string, string> },
	) => Promise<{ exitCode: number | null }>;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;
```

四个设计点：

1. **Operations 注入**：本地执行是默认实现（`createLocalBashOperations`），远程/容器执行可替换（与 read 的注入同理）；
2. **spawn 钩子**：启动前改写命令/环境/cwd（沙箱、前缀命令、环境变量注入都靠它）；
3. **取消 = 杀掉整棵进程树**：源码里明确处理 abort 信号并 kill 子进程；退出码按 shell 惯例映射（被信号杀死 → `128 + signal`）；
4. **输出双轨**：实时块回调（`onData`）驱动界面流式显示；`OutputAccumulator` 负责截断与全量落盘。

**退出码的语义**：工具把退出码与输出一起返回（`BashExecutionMessage.exitCode`）；非零退出通常标记为错误结果（`isError: true`），但**是否终止循环仍由模型/循环决定**——模型看到错误输出可以自行修正命令。
## 7.12 实验 L04：参数非法、工具抛错、取消、拦截

**实验性质**：本地运行（faux + 测试 harness）；四组对照实验。
**验证状态**：设计中。每组都要求"错误实现会失败、正确实现才通过"的断言（第 18 章展开测试方法论）。

### 四个用例

| # | 场景 | 构造方式 | 期望观察 |
|---|---|---|---|
| 1 | 参数非法 | 脚本响应里 `fauxToolCall("read", { path: 123 })`（错误类型） | 模型收到 `Validation failed for tool "read"`；结果 `isError: true`；`callCount` 增加（模型被再问一次） |
| 2 | 工具抛错 | 注册一个必抛错的自定义工具 | 结果 `isError: true`，错误文本来自异常 message；循环继续 |
| 3 | 取消 | 注册一个"等待信号"的工具（收到 abort 才退出） | 取消后结果文本 `Operation aborted`；run 收尾为 `aborted` |
| 4 | 钩子拦截 | 注册 `beforeToolCall` 对某工具返回 `{ block: true, reason: "blocked by policy" }` | 模型收到 `blocked by policy`；工具**未执行**（可用计数验证） |

### 步骤（以用例 1 为例）

1. 在 suite 测试里注册 faux，脚本第一步返回非法参数的工具调用，第二步返回普通文本；
2. 断言：
   - 转录里存在 `role: "toolResult"` 且 `isError === true`；
   - 其 `content[0].text` 包含 `Validation failed` 与字段路径；
   - 断言"错误文本里有收到的参数"（`Received arguments` 段）。
3. 把 schema 改成宽松类型再跑一遍，确认测试会失败——证明断言有效。

### 观察与思考

- 四类错误的**结果消息**都进入历史了吗？下一轮模型看到的是哪一种措辞？
- 用例 3 中，如果工具不检查 `signal`，结果会怎样？（提示：工具照常跑完，取消只影响"还能不能发新请求"）

### 清理

删除临时测试或还原改动；`git status` 干净。

## 7.13 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 工具没被调用，模型说"没有这个工具" | 声明与可执行不一致（第 7.3 节） | 检查 `state.tools` 与白名单设置；看系统消息里的 `toolsAdded/toolsRemoved` |
| 校验明明该失败却通过 | schema 过宽（如 `Type.Any`）或强转兜底 | 收紧 schema；用测试确证失败路径 |
| 工具报错但界面不标红 | 失败只写进 `content`，没设 `isError` | 按契约返回 `isError: true` 或抛错 |
| 大输出把上下文撑爆 | 自己拼输出时没截断 | 用 `truncate.ts` 的默认常量与函数 |
| `details` 被模型看到了 | 误以为 `details` 会发送 | `details` 只给界面/程序；模型只看 `content` |
| 同一文件两个写操作互相覆盖 | 绕过 `withFileMutationQueue` | 写工具统一走队列；相同 realpath 串行 |
| 取消后队列锁没有释放（或提前释放） | 在 abort 监听器里直接 reject | 学习 write.ts 的 `throwIfAborted` 模式 |
| 并行工具顺序不符合预期 | 混淆准备顺序、end 事件顺序与结果消息顺序 | 按 7.5.3 分别追踪 immediate 结果、执行闭包与有序消息 |

## 7.14 验收题

1. `AgentTool` 与 `ToolDefinition` 的差异是什么？谁向谁转换？
2. 模型是怎么"知道"有哪些工具的？工具清单变化时会发生什么？
3. 参数校验的六个步骤分别解决什么问题？校验失败后错误文本去哪里？
4. 一批工具里有一个声明 `executionMode: "sequential"`，会发生什么？`terminate: true` 与"结束 run"的区别？
5. `read` 的单行超限情况如何处理？为什么给出 bash 的 `sed` 提示而不是直接报错？
6. `withFileMutationQueue` 为什么用 `realpath` 做键？它保证了什么、不保证什么？
7. 写出四个用例（非法参数/抛错/取消/拦截）的预期结果字段（`isError`、结果文本来源、循环是否继续）。

### 参考答案（要点）

1. `AgentTool` 是运行时契约（循环执行用）；`ToolDefinition` 是注册形态（含提示元数据/渲染器/扩展上下文）。`wrapToolDefinition` 向下转换；`createToolDefinitionFromAgentTool` 反向兼容。
2. 工具定义被编进系统消息（`toolsAdded`/`toolsRemoved`），转录里的声明与 `context.tools` 的差异在每次请求前生成补丁系统消息；不变则不写。
3. 克隆（不可变）、可选 null 归一化、类型强转、非 typebox 兼容、检查、格式化错误。错误文本作为 `isError` 工具结果发给模型。
4. 整批顺序执行；`terminate` 只在"整批结果都为 true"时阻止"因本批工具继续"，不结束 run。
5. 提示模型改用 `bash: sed -n 'Np' file | head -c 50KB` 精准取行——因为 read 的 50KB 硬上限无法容纳这一行，报错做不到"让模型继续干活"。
6. 现有文件的不同路径写法/符号链接别名通过 `realpath` 归一；同一队列键串行、不同键可并行。目标缺失时退回解析路径，别名归一不保证；也不保证跨进程互斥或事务性（中途失败可能留下部分结果）。
7. 非法参数：`isError: true`、文本来自校验器（含路径与接收参数）、循环继续；抛错：同上但文本来自异常；取消：`isError: true`、文本 `Operation aborted`、run 以 aborted 收尾；拦截：`isError: true`、文本为 block reason、工具未执行、循环继续。

## 7.15 来源与下一章

- `packages/agent/src/types.ts`（`AgentTool`、`BeforeToolCallResult`、`AfterToolCallResult`、`AgentToolResult`）；
- `packages/agent/src/agent-loop.ts`（`prepareToolCall`、`executePreparedToolCall`、`finalizeExecutedToolCall`、两种调度、`runToolCall`）；
- `packages/ai/src/utils/validation.ts`（`validateToolArguments`）；
- `packages/coding-agent/src/core/tools/`（`index.ts`、`tool-definition-wrapper.ts`、`read.ts`、`write.ts`、`truncate.ts`、`output-accumulator.ts`、`file-mutation-queue.ts`、`bash.ts`）。

下一章回到应用层：`AgentSession` 为什么比 `Agent` 厚这么多？它拥有哪些资源、谁负责释放、工作目录变化时为什么必须重建。
