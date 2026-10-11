# 06. 工具

> 预计时间：2 小时（核心主线；选读另计）
> 先修：消息与事件（`message_start`、`message_end`）、Agent 循环（`agentLoop`）

## 本篇你会学到

- 说明一个工具由哪些部分组成，模型实际看到什么。
- 区分 `AgentTool` 与 `ToolDefinition`，并跟踪内置 `read` 工具从定义到执行的路径。
- 按顺序说出一次工具调用的校验、钩子、执行、结果记录，以及顺序与并行两种调度的差别。

## 先用一个例子理解

用户输入："读取 demo.txt，并总结三点。"

模型自己看不到你电脑上的文件。如果没有工具机制，模型只能猜内容，或者开发者必须为每个任务写死代码。工具机制让流程变成下面这样：

1. pi 把 `read` 工具的名字、说明和参数格式发给模型。
2. 模型回复一个**调用块**（assistant 消息里 `type: "toolCall"` 的内容块），内容是 `{ name: "read", arguments: { path: "demo.txt" } }`。
3. pi 在本地检查参数，执行 `read`，得到文件文本。
4. pi 把文本包装成一条 `toolResult` 消息，放回对话。
5. pi 再次请求模型。模型读到文本后，写出三点总结。

模型只负责**提出**调用。真正读文件的是 pi。整个过程可以画成一条线：

```text
用户输入
  -> 模型请求（带上工具声明和历史）
  -> 模型输出调用块  read {path: "demo.txt"}
  -> pi 在本地执行 read，得到文本
  -> toolResult 消息写入历史
  -> 模型请求（带上 toolResult）
  -> 模型输出总结
```

失败也走同一条路。如果模型给出 `{ path: ["demo.txt"] }`（路径写成了数组），pi 不会读文件，而是生成一条错误结果 `isError: true`，文字里写明哪个字段错了。模型看到错误后可以改参数再试。循环不会因为一次工具失败而崩溃。

> 一个要点：循环是否执行工具，看的是 assistant 消息里有没有 `toolCall` 内容块，而不是 `stopReason` 是不是 `"toolUse"`。`stopReason` 只在三种情况改变流程：`error`、`aborted`、`length`。

## 核心概念

### 1. 工具对模型是什么

**工具**（tool）是模型可以请求执行的一个本地操作。模型只看到它的**声明**，声明由三部分组成：

- **name**：工具名，例如 `read`。模型调用时必须用这个名字。
- **description**：一段说明，告诉模型工具做什么、有什么限制。
- **参数 schema**（参数格式规则）：规定每个参数的名字、类型和是否可选。

本仓库用 **TypeBox**（一个 TypeScript 库，用代码写 schema）书写参数格式。`read` 的参数写在 `packages/coding-agent/src/core/tools/read.ts`：

```typescript
const readSchema = Type.Object({
	path: Type.String({ description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
});
```

这段代码有两个作用。第一，TypeScript 编译器能从它推出参数类型。第二，运行时可以用它检查模型给的数据。每个字段的 `description` 也会发给模型，所以它是写给模型看的说明。

工具执行后有**结果**（result）。结果中的 `content` 是给模型看的文本或图片；`details` 是给界面或扩展程序看的结构化数据，不发给模型。

模型的调用请求放在 assistant 消息的内容块里，形状是：

```typescript
{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "demo.txt" } }
```

`id` 把调用和之后的结果对应起来。`arguments` 是模型给出的原始参数，还没有被检查。这个类型定义在 `packages/ai/src/types.ts` 的 `ToolCall` 接口中。

#### 从零写一个玩具工具

下面写一个最小的工具 `wait`。它收到毫秒数后等待，然后返回一句话。它只用来说明结构。下面的代码与本篇“实际运行”中使用的工具相同（注释为本篇加入）。

```typescript
import { Type } from "typebox";                                    // 取出 Type，用它生成 schema

const waitSchema = Type.Object({                                   // 参数是一个对象
	label: Type.String({ description: "Name shown in the result" }),   // 必填字符串；description 会发给模型
	ms: Type.Number({ description: "How long to wait, in milliseconds" }), // 必填数字
});

const waitTool = {
	name: "wait",                                                  // 模型调用时必须写这个名字
	label: "wait",                                                 // 界面显示用的名字
	description: "Wait for a number of milliseconds, then report the label.", // 发给模型的说明
	parameters: waitSchema,                                        // 参数格式：校验与类型推导都用它
	async execute(_toolCallId, params) {                           // 只有校验通过后才会被调用
		await new Promise((resolve) => setTimeout(resolve, params.ms)); // 等待 params.ms 毫秒
		return {                                                   // 返回 AgentToolResult
			content: [{ type: "text", text: `done ${params.label}` }], // 模型看到的内容
			details: { label: params.label, ms: params.ms },         // 给界面或程序用，不发给模型
		};
	},
};
```

逐行说明：

- `import { Type } from "typebox"`：`Type` 是一组函数。`Type.String`、`Type.Number`、`Type.Object` 各自生成一种 schema。
- `Type.Object({ ... })`：对象参数。每个属性默认必填。想让某个参数可选，要用 `Type.Optional` 包起来（`read` 的 `offset` 与 `limit` 就是这样写的）。
- 字段的 `description`：会随工具声明发给模型，帮助模型填对参数。
- `name`：模型调用时写的名字。它必须和 `context.tools` 中的名字一致，否则循环返回 `Tool wait not found`（见下文四步流水线）。
- `label`：`AgentTool` 类型要求的界面名字。
- `parameters`：同一份 schema 既决定 `params` 的 TypeScript 类型（这里是 `{ label: string; ms: number }`），也用于运行时校验。
- `execute(_toolCallId, params)`：真正做事的函数。第一个参数是这次调用的 id，本例用不到，所以名字以下划线开头。第二个参数 `params` 已经通过校验。
- `await new Promise(...)`：本例的“工作”。真实工具在这里读写文件、执行命令。
- `return { content, details }`：返回值的形状见下一小节。

这个玩具工具省略了第三个参数 `signal`。`signal` 是取消信号（标准的 `AbortSignal`，调用 `abort()` 后它的 `aborted` 变为真）。真实工具应当监听它，`read` 的做法见选读 A。玩具工具收到取消后是否仍会等待完成，本篇未在本地验证。

把它交给循环不需要 wrapper。`waitTool` 已经具有 `AgentTool` 的形状（`name`、`label`、`description`、`parameters`、`execute`）。运行时的上下文写成：

```typescript
const context = { messages: [], tools: [waitTool] };
```

`AgentTool` 还有几个可选字段：`prepareArguments`（在校验前修补原始参数）、`outputSchema`（声明 `structuredContent` 的格式，供程序化调用方使用）、`executionMode`（`"sequential"` 或 `"parallel"`，见下文调度一节）。

模型看到的是声明：`name`、`description` 与参数格式。pi 如何把 TypeBox 转成供应商请求中的格式，取决于各供应商的适配代码。本篇没有逐个验证这一步（未在本地验证）。

#### AgentToolResult 的形状与模型看到的内容

`execute` 返回的类型是 `AgentToolResult`（定义在 `packages/agent/src/types.ts`）。精简后的字段如下：

```typescript
export interface AgentToolResult<T = JsonValue | undefined> {
	content: (TextContent | ImageContent)[]; // 给模型看：文本或图片组成的数组
	details: T;                              // 给界面或扩展程序看的结构化数据
	structuredContent?: JsonValue;           // 给程序化调用方看，不发给模型
	usage?: Usage;                           // 工具自身的开销统计，可选
	isError?: boolean;                       // true 表示失败；content 中写原因
	terminate?: boolean;                     // 提示本批工具之后不再请求模型
}
```

`details` 在类型中是必填的，所以即使没有额外数据，也要写 `details: {}`（循环自己生成的错误结果就是这样做的，见 `createErrorToolResult`）。

下面是本地运行得到的两个真实值。第一个是 `wait` 成功时 `execute` 的返回值，并且通过 `tool_execution_end` 事件（即循环的收尾结果）输出：

```json
{"content":[{"type":"text","text":"done str"}],"details":{"label":"str","ms":50}}
```

第二个是循环在模型下一次请求时收到的 toolResult 消息（两条都来自同一批次，已截取，`timestamp` 为运行时的毫秒数）：

```json
{"role":"toolResult","toolCallId":"v1","toolName":"wait","content":[{"type":"text","text":"Validation failed for tool \"wait\":\n  - ms: must be number\n\nReceived arguments:\n{\n  \"label\": \"bad\",\n  \"ms\": \"abc\"\n}"}],"details":{},"isError":true,"timestamp":1791639470927}
{"role":"toolResult","toolCallId":"v2","toolName":"wait","content":[{"type":"text","text":"done str"}],"details":{"label":"str","ms":50},"isError":false,"timestamp":1791639470927}
```

有三点要看清楚。

- 返回值没有 `isError` 字段（校验失败的结果只有 `content` 与 `details`）。`isError: true` 是循环在生成消息时加上的（由 `prepareToolCall` 的 `createErrorToolResult` 路径决定）。
- 消息里有 `toolName`、`timestamp`、`details` 等字段。它们是 pi 内部的对象，不是发给模型的全部内容。
- 模型真正读到的是 `content` 中的文字。以 `packages/ai/src/api/openai-completions.ts` 为例，它的 `toolResult` 分支只取 `content` 中的文本块，拼成一个字符串后放进请求。

### 2. AgentTool 与 ToolDefinition

同一个工具有两种形态。

| 形态 | 位置 | 用途 | 包含的主要字段 |
| --- | --- | --- | --- |
| `AgentTool` | `packages/agent/src/types.ts` | Agent 循环真正执行时使用 | `name`、`label`、`description`、`parameters`、`execute`，以及可选的 `prepareArguments`、`executionMode` |
| `ToolDefinition` | `packages/coding-agent/src/core/extensions/types.ts` | 应用注册工具时使用 | 上面的字段，外加 `promptSnippet`、`promptGuidelines`、渲染函数；`execute` 还多一个扩展上下文参数 `ctx` |

**为什么要两种？** 因为两方的需求不同。Agent 循环只需要知道怎么执行。系统提示需要一句话的速览和使用准则。终端界面需要知道怎么显示调用和结果。如果把这些都塞进 `AgentTool`，循环代码会被无关的显示信息污染。

**例子：`read` 工具。** `createReadToolDefinition` 返回 `ToolDefinition`，里面同时写了给模型的说明、提示词片段和执行函数：

```typescript
export function createReadToolDefinition(cwd: string, options?: ReadToolOptions): ToolDefinition<...> {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images ...`,
		promptSnippet: readToolSystemPromptContribution.snippet,
		promptGuidelines: [...readToolSystemPromptContribution.guidelines],
		parameters: readSchema,
		async execute(_toolCallId, { path, offset, limit }, signal, _onUpdate, ctx) {
			// 读取文件并返回 { content, details }
		},
		...readRenderers,
	};
}
```

然后 `createReadTool` 把它转换成 `AgentTool`：

```typescript
export function createReadTool(cwd: string, options?: ReadToolOptions): AgentTool<typeof readSchema> {
	return wrapToolDefinition(createReadToolDefinition(cwd, options));
}
```

`wrapToolDefinition` 在 `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts`。它把 `ToolDefinition` 变成 `AgentTool`，并在调用 `execute` 时补上上下文参数。循环只接触 `AgentTool`。

> 读源码时要记住：`Agent` 类只看到 `AgentTool`。扩展和内置工具先以 `ToolDefinition` 的形式注册，再转换。

### 3. 参数校验

**问题。** TypeScript 的类型只在编写代码时有效，编译后就消失。模型返回的 JSON 是运行时才到达的外部数据。即使 `read` 的类型写着 `path: string`，模型仍可能给出数字、数组或者缺字段的对象。

**解决。** 执行前，pi 用同一份 schema 检查模型给的参数。入口函数是 `validateToolArguments`，位于 `packages/ai/src/utils/validation.ts`。它的步骤是：

1. 复制一份参数（`structuredClone`），不修改模型原始的对象。
2. 把可选字段里的 `null` 归一化为“未提供”。
3. 用 `Value.Convert` 做有限的类型转换，例如字符串 `"3"` 转成数字 `3`。
4. 按 schema 检查。通过则返回校验后的副本。
5. 不通过则抛出错误，错误文字包含失败字段、原因，以及模型发来的原始参数。

**实际运行的结果。** 下面三个例子来自本篇“动手实验”，在本地 Node v23.9.0 上运行得到：

| 模型给的参数 | 结果 | 说明 |
| --- | --- | --- |
| `{ path: 123 }` | 通过，得到 `{"path":"123"}` | `Value.Convert` 把数字转成了字符串 |
| `{ path: ["a.txt"] }` | 失败：`path: must be string` | 数组无法转换，必须失败 |
| `{ path: "a.txt", offset: "abc" }` | 失败：`offset: must be number` | 无法转换为数字 |

这说明校验不是“只看类型是否一致”。能安全转换的值会被修正，不能转换的值会被拒绝。

**完整的一次失败（本地运行）。** 把上面的 `wait` 工具放进循环。模型在一条消息里声明两个调用：`{ label: "bad", ms: "abc" }` 与 `{ label: "str", ms: "50" }`。第一个调用失败，第二个通过。

```text
+10ms start v1 {"label":"bad","ms":"abc"}
+10ms end   v1 isError=true
+10ms start v2 {"label":"str","ms":"50"}
+70ms end   v2 isError=false
+70ms msg   v1 (toolResult, isError=true)
+70ms msg   v2 (toolResult, isError=false)
```

第一个调用失败时，`tool.execute` 没有被调用。模型收到的错误文字（已换行展示，内容与运行输出一致）是：

```text
Validation failed for tool "wait":
  - ms: must be number

Received arguments:
{
  "label": "bad",
  "ms": "abc"
}
```

这段文字包含三样东西：失败的字段路径（`ms`）、原因（`must be number`）、模型发来的原始参数。模型下一轮可以据此修正。第二个调用的 `"50"` 被转换为数字 `50`，`execute` 收到的 `params.ms` 是数字（结果的 `details` 为 `{"label":"str","ms":50}`）。转换发生在循环内部，工具自己不需要处理字符串。

下面是 `validateToolArguments` 的简化骨架（省略了非 TypeBox schema 的兼容分支）：

```typescript
// 简化自 packages/ai/src/utils/validation.ts
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
	const args = structuredClone(toolCall.arguments); // 1. 复制，不修改模型的原始对象
	normalizeOptionalNulls(args, tool.parameters);     // 2. 可选字段的 null 视为未提供
	Value.Convert(tool.parameters, args);              // 3. 能转换的值就转换
	const validator = getValidator(tool.parameters);
	if (validator.Check(args)) {
		return args;                                    // 4. 通过：返回校验后的副本
	}
	// 5. 不通过：抛错，文字包含字段路径、原因和收到的原始参数
	const errors = validator.Errors(args).map((e) => `  - ${formatValidationPath(e)}: ${e.message}`).join("\n");
	throw new Error(`Validation failed for tool "${toolCall.name}":\n${errors}\n\nReceived arguments:\n...`);
}
```

为什么要把错误文字发给模型？因为模型是修改参数的人。错误中写明 `path: must be string` 和原始参数，模型下一轮就知道该改哪个字段。如果只在日志里记录，模型就只能盲目重试。

**校验失败去了哪里。** 错误被 `prepareToolCall` 捕获，变成一个 `isError: true` 的结果。循环不会中断。模型在下一轮会看到错误文字，然后可以修改参数重试。

### 4. 四步流水线

**问题。** 一次工具调用要经过找工具、检查参数、问钩子能否放行、执行、收尾、记录结果。每一步都可能失败。如果每一步各写一套错误处理，代码会很难读。

**解决。** `packages/agent/src/agent-loop.ts` 把整个过程拆成四步。每一步都有明确的输入和输出，失败时要么直接产生一个错误结果，要么继续下一步。

| 步骤 | 函数 | 做什么 | 失败时 |
| --- | --- | --- | --- |
| 1. 准备 | `prepareToolCall` | 按名字找工具；`prepareArguments` 修补；`validateToolArguments` 校验；`beforeToolCall` 决定放行或阻止 | 返回 `kind: "immediate"`，直接产生错误结果，不执行工具 |
| 2. 执行 | `executePreparedToolCall` | 调用 `tool.execute(id, args, signal, onUpdate)` | 抛出的异常转成 `isError: true` 的结果 |
| 3. 收尾 | `finalizeExecutedToolCall` | 调用 `afterToolCall`，可以改写内容、错误标记等字段 | 钩子抛错时结果变成错误结果 |
| 4. 记录 | `emitToolExecutionEnd`、`createToolResultMessage`、`emitToolResultMessage` | 发 `tool_execution_end` 事件，生成 `ToolResultMessage`，发 `message_start` 与 `message_end` | 不会失败 |

下表列出流水线中每一步的输入、输出，以及提前结束这一步的情况。函数名与 `packages/agent/src/agent-loop.ts` 一致。

| 步骤 | 输入 | 输出 | 提前结束的情况 |
| --- | --- | --- | --- |
| 批次选择 `executeToolCalls` | assistant 消息中所有 `toolCall` 块，以及 `config.toolExecution` | `{ messages, terminate }` | 无 |
| 1a 找工具 | `toolCall.name` 与 `context.tools` | 找到的 `AgentTool`，或 `undefined` | 找不到：立即结果 `Tool X not found` |
| 1b 修补参数 `prepareToolCallArguments` | 原始 `arguments` 与 `tool.prepareArguments` | 修补后的调用块；没有 `prepareArguments` 时原样返回 | 修补函数抛错：走 `catch`，立即结果 |
| 1c 校验 `validateToolArguments` | 修补后的调用块与 `tool.parameters` | 校验后的 `args` 副本 | 抛错：立即结果，文字为校验错误 |
| 1d 钩子 `beforeToolCall` | `{ assistantMessage, toolCall, args, context }` 与 `signal` | `undefined`，或 `{ block, reason, terminate }` | `block` 为真：立即结果，文字为 `reason`；`signal` 已取消：`Operation aborted` |
| 1e 产出准备结果 | 以上各步的结果 | `{ kind: "prepared", toolCall, tool, args }` | 无 |
| 2 执行 `executePreparedToolCall` | `tool`、`args`、`signal`、`onUpdate` | `{ result, isError }`，其中 `isError` 为 `result.isError === true` | `execute` 抛错：`createErrorToolResult(message)`，`isError` 为真 |
| 3 收尾 `finalizeExecutedToolCall` | 执行结果与 `config.afterToolCall` | `{ toolCall, result, isError }` | `afterToolCall` 抛错：变为错误结果；返回 `undefined`：原样保留 |
| 4a 结束事件 `emitToolExecutionEnd` | 收尾结果 | `tool_execution_end` 事件 | 无 |
| 4b 结果消息 `createToolResultMessage` | 收尾结果 | `ToolResultMessage`；`content` 缺失时补为 `[]` | 无 |
| 4c 消息事件 `emitToolResultMessage` | `ToolResultMessage` | `message_start` 与 `message_end` 事件 | 无 |

立即结果（1a 到 1d 的失败）只走 4a 到 4c，不经过 2 与 3。执行结果（2 之后）四步都走。

注意两个区别：

- **立即结果**（`immediate`）发生在第 1 步。例如找不到工具（`Tool X not found`）、校验失败、`beforeToolCall` 阻止。它们跳过第 2 步和第 3 步。
- **执行结果**（`prepared` 之后）经过第 2 到第 4 步。工具自己返回 `isError: true`，或者抛出异常，都会走同一个结果格式。

```mermaid
sequenceDiagram
	participant Loop as agent-loop
	participant Val as validateToolArguments
	participant Hook as beforeToolCall
	participant Tool as tool.execute
	participant After as afterToolCall
	Loop->>Loop: prepareToolCallArguments (可选 prepareArguments)
	Loop->>Val: 校验参数
	alt 校验失败
		Val-->>Loop: 抛错
		Loop->>Loop: 错误结果 isError true 直接进入记录
	else 校验通过
		Loop->>Hook: beforeToolCall(args)
		alt block
			Hook-->>Loop: block true
			Loop->>Loop: 错误结果 isError true 直接进入记录
		else 放行
			Loop->>Tool: execute(id, args, signal, onUpdate)
			Tool-->>Loop: result 或抛错
			Loop->>After: afterToolCall(result, isError)
			After-->>Loop: 可选覆盖字段
			Loop->>Loop: tool_execution_end，生成 ToolResultMessage
		end
	end
```

下面是 `prepareToolCall` 的简化骨架。真实代码还会在 `beforeToolCall` 前后检查 `signal.aborted`，这里省略：

```typescript
// 简化自 packages/agent/src/agent-loop.ts 的 prepareToolCall
async function prepareToolCall(context, assistantMessage, toolCall, config, signal) {
	const tool = context.tools?.find((t) => t.name === toolCall.name);
	if (!tool) {
		return { kind: "immediate", result: createErrorToolResult(`Tool ${toolCall.name} not found`), isError: true };
	}
	try {
		const prepared = prepareToolCallArguments(tool, toolCall); // 可选的参数修补
		const args = validateToolArguments(tool, prepared);         // 校验
		if (config.beforeToolCall) {
			const before = await config.beforeToolCall({ assistantMessage, toolCall, args, context }, signal);
			if (before?.block) {
				return {
					kind: "immediate",
					result: createErrorToolResult(before.reason || "Tool execution was blocked"),
					isError: true,
				};
			}
		}
		return { kind: "prepared", toolCall, tool, args };
	} catch (error) {
		return {
			kind: "immediate",
			result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
			isError: true,
		};
	}
}
```

注意 `immediate` 结果没有经过第 3 步。也就是说，`afterToolCall` 不会看到找不到工具、校验失败或被阻止的调用。这是有意的：这些调用没有执行结果可以改写。

**示例：`read` 的第 2 步。** `read` 的 `execute` 先解析路径，再检查是否可读，然后读取文件内容，最后用 `truncateHead` 截断。截断规则见下一节走读的第 5 步。

#### 为什么失败要变成结果，而不是让异常冒出去

假设循环对每个工具调用都用 `try/catch` 包住，失败就直接抛出，让外层运行函数结束。

这样做的问题：模型把 `read` 的参数写错了，整个 Agent 运行就中止。用户看到的是“运行失败”，而不是“路径写错了，请修正”。模型没有机会修正，历史里也没有这次失败的记录。

pi 的做法是把失败转换成一条 `isError: true` 的 `toolResult`。失败依然可见（界面标红，日志可查），而且会话历史保持完整：模型的调用、失败的结果、下一轮的修正都在同一条时间线上。

这不等于“所有错误都被吞掉”。循环外层仍然处理模型请求本身的错误（例如网络故障，此时 `stopReason` 为 `error`）。工具层只有一条规则：工具失败是数据，不是控制流。

### 5. 顺序执行与并行执行

模型一次可能在同一条 assistant 消息里请求多个工具。例如同时请求读两个文件。pi 要决定它们怎么跑。

**选择规则**在 `executeToolCalls` 中（`packages/agent/src/agent-loop.ts`）：

- 如果全局配置 `toolExecution` 是 `"sequential"`，或者这批调用里有任何一个工具的 `executionMode` 是 `"sequential"`，整批顺序执行。
- 其他情况，走并行执行。
- `Agent` 的默认值是 `"parallel"`（见 `packages/agent/src/agent.ts` 中 `runtimeOptions.toolExecution ?? "parallel"`）。

这是一种保守的设计。有副作用、会互相影响的工具（例如两个 `edit` 同时改同一个文件）应该声明 `executionMode: "sequential"`，这样整批都会顺序执行。

**两种执行方式的差别**：

- **顺序执行**（`executeToolCallsSequential`）：每个调用完整走完四步，包括它的结果消息，然后才开始下一个调用。
- **并行执行**（`executeToolCallsParallel`）：准备阶段仍然按声明顺序一个一个进行；准备成功的调用，其执行与收尾放进闭包里，然后用 `Promise.all` 同时等待。

**两种“顺序”**。并行执行时，有两个顺序可能不同：

| 顺序 | 由谁决定 | 代码位置 |
| --- | --- | --- |
| `tool_execution_end` 事件的顺序 | 完成的先后。立即结果在准备阶段就发出；执行结果在各自收尾时发出 | 准备循环，以及每个闭包内部 |
| `ToolResultMessage` 的顺序 | 模型声明的顺序。`Promise.all` 返回的数组保持输入顺序 | `Promise.all` 之后的 `for` 循环 |

**例子（由源码推导，未运行验证）。** 模型一次声明两个调用：先 `read("demo.txt")`，再 `read("README.md")`。假设 `demo.txt` 较大，读得慢。两个调用都通过准备：

- 开始事件（`tool_execution_start`）顺序：`demo.txt`、`README.md`。
- 结束事件（`tool_execution_end`）顺序：`README.md`、`demo.txt`。完成得快的先发事件。
- 结果消息（`ToolResultMessage`）顺序：`demo.txt`、`README.md`。消息仍然按声明顺序写入历史。

这样做的原因：界面可以尽快显示完成的工具，而会话历史保持稳定、可回放。

同样两个调用，两种方式产生的事件序列不同：

```text
顺序执行
  tool_execution_start   demo.txt
  tool_execution_end     demo.txt
  message_start/end      toolResult(demo.txt)
  tool_execution_start   README.md
  tool_execution_end     README.md
  message_start/end      toolResult(README.md)

并行执行（准备顺序进行，执行并发）
  tool_execution_start   demo.txt
  tool_execution_start   README.md
  tool_execution_end     README.md        (先完成)
  tool_execution_end     demo.txt
  message_start/end      toolResult(demo.txt)
  message_start/end      toolResult(README.md)
```

**三个调用的实际运行（本地运行，临时脚本）。** 模型在一条消息里声明三个调用：`wait(A, 300ms)`、`wait(B, 100ms)`、`wait(C, 200ms)`。脚本中模型回复是预先写好的（使用 `registerFauxProvider` 模拟），循环代码是仓库中的 `agentLoop`。

时间为近似值，每次运行有约 10ms 的抖动。下图每格约 50ms，从 0 开始：

```text
并行  (toolExecution: "parallel")
  A |######            0 - 310ms
  B |##                0 - 110ms
  C |####              0 - 210ms

顺序  (toolExecution: "sequential")
  A |######            0 - 310ms
  B |      ##          310 - 410ms
  C |        ####      410 - 620ms
```

并行时三个调用的开始事件几乎同时出现。实际输出（`start` 与 `end` 是事件名，`msg` 表示 `message_end` 中的 toolResult）：

```text
+0ms start A
+0ms start B
+0ms start C
+110ms end   B
+210ms end   C
+310ms end   A
+310ms msg   A
+310ms msg   B
+310ms msg   C
```

顺序时，每个调用完整结束（包括它的结果消息）后，下一个才开始：

```text
+0ms start A
+310ms end   A
+310ms msg   A
+310ms start B
+410ms end   B
+410ms msg   B
+410ms start C
+620ms end   C
+620ms msg   C
```

从这两段输出可以读出三件事。

- 并行的总耗时约等于最慢的那个调用（约 310ms）；顺序的总耗时约等于三者相加（约 620ms）。
- 并行时，结果消息都在三个执行完成后才写入。源码中 `executeToolCallsParallel` 先用 `Promise.all` 等待所有闭包，然后才用 `for` 循环生成消息。
- 两种方式下，消息的顺序都是 A、B、C。完成事件的顺序（并行时是 B、C、A）只影响界面显示的先后。

顺序执行的代价是速度慢；并行执行的代价是需要保证结果顺序。两者的正确性都依赖同一件事：每个调用的四步都完整走完。

**终止提示 `terminate`。** 如果一批结果全部设置了 `terminate: true`，`shouldTerminateToolBatch` 返回真。它表示“不要因为这一批工具再请求模型一次”。它不是“结束整个运行”。只要有一个结果没设置，整批都不终止。

### 6. 钩子：beforeToolCall 与 afterToolCall

**钩子**（hook）是调用方在 `Agent` 上提供的函数。它们在工具执行前后被调用，可以阻止调用或改写结果。它们的类型在 `packages/agent/src/types.ts`。

**`beforeToolCall`**：在参数校验之后、执行之前调用。收到的上下文包括：

- `assistantMessage`：发出这个调用的消息。
- `toolCall`：原始调用块。
- `args`：校验后的参数。类型是 `unknown`，使用前需要检查。
- `context`：当前 Agent 上下文。

返回值 `BeforeToolCallResult` 可以包括 `block`（为真则阻止执行）、`reason`（阻止时显示给模型的文字）、`terminate`。阻止时，循环生成一个 `isError: true` 的结果，工具的 `execute` 不会被调用。

**`afterToolCall`**：在执行之后、发出结束事件之前调用。它返回一个 `AfterToolCallResult`，字段合并规则如下：

- `content`：提供了就整体替换，不做深合并。
- `details`、`usage`、`isError`、`terminate`：提供了就替换，否则保留原值。
- `structuredContent`：如果只替换了 `content` 而没有给出它，这个字段会被丢弃，因为它可能已经和内容不一致。

下面是一个假想的 `afterToolCall`（不是仓库代码），用来说明字段合并。它把 `bash` 的超长输出替换为一句提示，并保留原始的 `details`。

```typescript
const afterToolCall = async ({ toolCall, result, isError }) => {
	if (toolCall.name !== "bash" || isError) return undefined; // 失败结果保持原样
	const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
	if (text.length < 100_000) return undefined;                // 不够长，不改
	return {
		content: [{ type: "text", text: "[输出过长，已由钩子替换。请缩小命令范围后重试。]" }],
		// 没有提供 details，所以沿用原值（合并规则：未提供的字段保留）
		// 没有提供 structuredContent，而 content 被替换了，所以它会被丢弃
	};
};
```

这个例子体现两条规则。第一，`afterToolCall` 只改写已经执行过的结果。`immediate` 结果（找不到工具、校验失败、被阻止）不会经过它。第二，它不能改变结果来自哪一步。如果 `execute` 抛错，`afterToolCall` 收到的 `isError` 为真。它可以把它改为假，但这会让模型看到一个“成功”的结果，应当谨慎使用。

实际设计中，改写输出更常见的做法是在工具内部截断（见选读 B），而不是在钩子中事后替换。钩子更适合审计、标记或统一的格式化。

**注意一个边界。** 参数在 `beforeToolCall` 之后不会再次校验。测试 `should execute mutated beforeToolCall args without revalidation`（位于 `packages/agent/test/agent-loop.test.ts`）说明：钩子可以修改 `args`，工具会收到修改后的值。因此，如果工具的安全条件比 schema 更严格（例如路径必须在工作目录内），应该在工具内部再检查一次，不能只依赖入口的 schema。

下面是一个假想的钩子（不是仓库代码），用来说明参数形状。它阻止 `bash` 执行一个危险命令。把它作为 `beforeToolCall` 选项传给 Agent。

```typescript
const beforeToolCall = async ({ toolCall, args }) => {
	if (toolCall.name !== "bash") return undefined;           // 只检查 bash
	const command = (args as { command: string }).command;    // 已校验过的参数
	if (command.includes("rm -rf /")) {
		return { block: true, reason: "blocked by policy: rm -rf /" };
	}
	return undefined;                                          // 放行
};
```

模型会收到 `blocked by policy: rm -rf /`，`bash` 的 `execute` 不会运行。

#### 前后对比：一个改变结果的钩子（本地运行）

**问题。** 工具返回的文字可能很长，或者含有不该让模型看到的内容。钩子可以在收尾时改写结果。但它只能改写已经执行过的结果，不能改写被阻止或参数非法的调用。

**做法。** 下面两个钩子加在同一批次（`wait` A 300ms、B 100ms、C 200ms，并行）上：

- `beforeToolCall`：如果 `ms` 超过 250，阻止该调用，并把理由写进 `reason`。
- `afterToolCall`：对成功的结果，在 `content` 的文字前加上 `[audited] `。

```typescript
const hooks = {
	beforeToolCall: async ({ args }) =>
		args.ms > 250 ? { block: true, reason: `blocked: ${args.label} waits ${args.ms} ms, limit is 250 ms` } : undefined,
	afterToolCall: async ({ result, isError }) => {
		if (isError) return undefined;                                 // 失败结果保持原样
		const text = result.content.map((c) => c.text).join("");       // 取出文字（本例中只有文本）
		return { content: [{ type: "text", text: `[audited] ${text}` }] }; // 只给 content；未给 details，所以 details 保留
	},
};
```

把 `hooks` 展开到循环配置中即可：`{ model, convertToLlm, toolExecution: "parallel", ...hooks }`。

**结果对比。** 同一批次，不带钩子与带钩子两次运行的 toolResult 消息如下：

| 调用 | 不带钩子（before） | 带钩子（after） | 原因 |
| --- | --- | --- | --- |
| A（300ms） | `done A`，`isError: false` | `blocked: A waits 300 ms, limit is 250 ms`，`isError: true` | `beforeToolCall` 返回 `block: true`，`execute` 没有调用。立即结果不经过 `afterToolCall` |
| B（100ms） | `done B`，`details` 为 `{"label":"B","ms":100}` | `[audited] done B`，`details` 不变 | `afterToolCall` 只给了 `content`，合并规则保留其余字段 |
| C（200ms） | `done C`，`details` 为 `{"label":"C","ms":200}` | `[audited] done C`，`details` 不变 | 同 B |

带钩子时的事件输出（实际运行）：

```text
+0ms start A {"label":"A","ms":300}
+0ms end   A isError=true
+0ms start B {"label":"B","ms":100}
+0ms start C {"label":"C","ms":200}
+110ms end   B isError=false
+210ms end   C isError=false
+210ms msg   A {"content":[{"type":"text","text":"blocked: A waits 300 ms, limit is 250 ms"}],"details":{},"isError":true}
+210ms msg   B {"content":[{"type":"text","text":"[audited] done B"}],"details":{"label":"B","ms":100},"isError":false}
+210ms msg   C {"content":[{"type":"text","text":"[audited] done C"}],"details":{"label":"C","ms":200},"isError":false}
```

这个例子说明三条规则。

1. 被阻止的调用在 `beforeToolCall` 之后直接成为结果。它的 `end` 事件在准备阶段就发出（+0ms），而 `afterToolCall` 没有看到它。
2. `afterToolCall` 返回的对象中，没有给出的字段保留原值。`details` 没有被覆盖，所以界面仍能拿到结构化数据。
3. 消息顺序仍是 A、B、C，与各调用完成的先后无关。

### 7. 结果变成 ToolResultMessage

`createToolResultMessage` 把收尾后的结果转换成一条会话消息，类型是 `ToolResultMessage`（定义在 `packages/ai/src/types.ts`）。字段去向如下：

| 字段 | 是否进入消息（发给模型） | 用途 |
| --- | --- | --- |
| `content` | 是 | 模型看到的文本或图片；界面也显示它 |
| `details` | 否（消息里保留，但不发给模型） | 界面渲染、扩展逻辑 |
| `structuredContent` | 否，不在消息类型里 | 程序化调用方使用 |
| `usage` | 是（消息字段） | 工具内部的模型开销统计 |
| `isError` | 是 | 界面标红；模型知道这是失败 |
| `terminate` | 否 | 只给循环控制使用 |

`createToolResultMessage` 有一处兜底：`content: finalized.result.content ?? []`。JavaScript 扩展写的工具可能忘记返回 `content`。如果直接传 `undefined` 或 `null`，会污染会话历史和发给供应商的请求。归一化在边界处完成，是这段代码的职责。

消息写入后会发 `message_start` 和 `message_end` 两个事件，两者的 `message` 都是这条 `ToolResultMessage`。

一次成功的 `read` 写入会话后，这条消息的形状大致如下（示意，字段值为假设）：

```typescript
{
	role: "toolResult",
	toolCallId: "call_1",
	toolName: "read",
	content: [{ type: "text", text: "line 1\nline 2\n..." }], // 模型下一轮读到的文字
	details: undefined,                                       // 未截断时没有 details
	isError: false,
	timestamp: 1733000000000,
}
```

如果 `read` 截断了输出，`details` 会包含 `truncation` 统计，界面可以据此显示“已截断”，模型则从 `content` 末尾的续读提示中得知下一个 `offset`。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径（相对仓库根） | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/agent/src/types.ts` | `ToolExecutionMode`、`BeforeToolCallResult`、`AfterToolCallResult`、`AgentToolResult`、`AgentTool` | 运行时契约：`execute` 签名、`isError` 与 `terminate` 的含义、`executionMode` |
| 2 | `packages/coding-agent/src/core/extensions/types.ts` | `ToolDefinition` | 注册形态：提示片段、渲染函数、`execute` 的第五个参数 `ctx` |
| 3 | `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts` | `wrapToolDefinition` | 如何把 `ToolDefinition` 变成 `AgentTool` |
| 4 | `packages/coding-agent/src/core/tools/read.ts` | `readSchema`、`createReadToolDefinition`、`createReadTool` | 一个完整工具的样子：schema、说明、执行、截断提示 |
| 5 | `packages/ai/src/utils/validation.ts` | `validateToolArguments` | 复制、归一化、转换、检查、格式化错误 |
| 6 | `packages/agent/src/agent-loop.ts` | `executeToolCalls` | 选择顺序或并行 |
| 7 | `packages/agent/src/agent-loop.ts` | `executeToolCallsSequential`、`executeToolCallsParallel` | 两种调度中事件与消息的先后 |
| 8 | `packages/agent/src/agent-loop.ts` | `prepareToolCall`、`executePreparedToolCall`、`finalizeExecutedToolCall` | 四步流水线的核心，留意 `immediate` 与 `prepared` 两种结果 |
| 9 | `packages/agent/src/agent-loop.ts` | `shouldTerminateToolBatch`、`createErrorToolResult`、`createToolResultMessage` | 批次终止条件、错误结果的统一格式、消息字段 |
| 10 | `packages/coding-agent/src/core/tools/truncate.ts` | `truncateHead`、`DEFAULT_MAX_LINES`、`DEFAULT_MAX_BYTES` | `read` 的输出上限是 2000 行或 50KB |

## 走读一次完整过程

以模型请求 `read("demo.txt")` 为例。假设没有钩子，文件存在且小于 50KB。

1. **模型输出调用块。** assistant 消息的 `content` 中有一个 `type: "toolCall"` 块，`name` 是 `read`，`arguments` 是 `{ path: "demo.txt" }`。Agent 循环（`runLoop`）在 `stopReason` 为 `"toolUse"` 等普通值时，同样会取出这些调用块。
2. **选择调度方式。** `executeToolCalls` 过滤出所有 `toolCall` 块。如果没有任何工具声明 `executionMode: "sequential"`，且全局设置为 `"parallel"`，走 `executeToolCallsParallel`。只有一个调用时，两种方式结果相同。
3. **发出开始事件。** 循环发出 `tool_execution_start`，带上 `toolCallId`、`toolName`、`args`。
4. **准备（第 1 步）。** `prepareToolCall` 在 `currentContext.tools` 中按名字找到 `read`。然后：`prepareToolCallArguments` 检查是否有 `prepareArguments`（没有则原样返回）；`validateToolArguments` 检查 `{ path: "demo.txt" }`，通过；没有 `beforeToolCall`，于是返回 `kind: "prepared"`。
5. **执行（第 2 步）。** `executePreparedToolCall` 调用 `tool.execute(id, args, signal, onUpdate)`。`read` 的执行函数依次做：`resolveReadPathAsync` 把路径解析为绝对路径；`ops.access` 检查可读；`ops.readFile` 读出 Buffer；按 `\n` 切分成行。它没有指定 `offset` 或 `limit`，所以从第 1 行开始，调用 `truncateHead(selectedContent)`。文件不超过 2000 行且不超过 50KB 时，`truncated` 为假，直接返回全部文本。
6. **收尾（第 3 步）。** `finalizeExecutedToolCall`。没有 `afterToolCall`，结果原样保留。
7. **记录（第 4 步）。** `emitToolExecutionEnd` 发出结束事件，`isError` 为假。`createToolResultMessage` 生成 `{ role: "toolResult", toolCallId, toolName, content, details, isError, timestamp }`。`emitToolResultMessage` 发出 `message_start` 与 `message_end`，然后把消息加入 `messages`。
8. **返回批次结果。** 调度函数返回 `{ messages, terminate }`。`terminate` 由 `shouldTerminateToolBatch` 决定。外层循环据此决定是否再次请求模型。

**截断的情况。** 如果文件有 2500 行，短行，`truncateHead` 返回 `truncatedBy: "lines"`，前 2000 行被保留。`read` 在文本末尾追加：

```text
[Showing lines 1-2000 of 2500. Use offset=2001 to continue.]
```

这段提示由 `read.ts` 中的模板拼接，行号由 `truncation.outputLines` 计算得出（这一行是根据代码推导的，未在本地运行）。模型看到它后，可以用 `offset=2001` 继续读取。

**并行的情况。** 如果同一条消息里有两个调用 `read("demo.txt")` 与 `read("README.md")`，并且两者都能通过准备，它们的执行会并发运行。`executeToolCallsParallel` 先依次完成两次 `prepareToolCall`，把两个执行闭包放进 `finalizedCalls`，然后 `Promise.all` 同时运行它们。每个闭包结束时各自发出 `tool_execution_end`。`Promise.all` 返回后，循环按声明顺序为两个调用生成 `ToolResultMessage`，所以历史中的顺序仍是 `demo.txt`，然后 `README.md`。

**失败的情况。** 如果模型的参数是 `{ path: ["demo.txt"] }`：第 4 步的校验抛错。`prepareToolCall` 的 `catch` 返回 `kind: "immediate"`，`isError: true`，文字以 `Validation failed for tool "read":` 开头。第 2 步不执行。第 4 步仍然生成 `ToolResultMessage`，模型在下一轮看到这条错误。

**取消的情况。** 假设 `read` 执行中途收到取消信号。`read` 的 `abort` 监听器立即 reject，错误为 `Operation aborted`。`executePreparedToolCall` 的 `catch` 把它转成 `isError: true` 的结果。顺序执行时，循环在记录完这一次结果后检查 `signal.aborted` 并 `break`，后面的调用不再开始。如果取消发生在准备阶段，`prepareToolCall` 返回 `Operation aborted` 的立即结果，`execute` 不会被调用。

## 动手实验

### 实验 1：参数校验（需要本地运行，不调用模型）

**目的。** 观察同一份 schema 对不同的参数给出的结果。确认“能转换的会被转换，不能转换的会被拒绝”。

**前提。** 本地有仓库，依赖已安装（`npm install --ignore-scripts`）。Node.js 能直接运行 `.mts` 文件（本地使用 v23.9.0，类型剥离是实验特性，会在 stderr 打印一行 `ExperimentalWarning`）。

**步骤。** 在系统临时目录创建脚本 `exp.mts`，内容如下。如果仓库不在 `D:\Github\pi`，修改 `root`。

```typescript
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// 把 root 改成你的仓库 packages 目录
const root = "D:/Github/pi/packages";
const validation = await import(pathToFileURL(`${root}/ai/src/utils/validation.ts`).href);
const truncate = await import(pathToFileURL(`${root}/coding-agent/src/core/tools/truncate.ts`).href);
const require = createRequire(pathToFileURL(`${root}/ai/package.json`).href);
const { Type } = require("typebox");

const tool = {
	name: "read",
	description: "Read a file",
	parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Number()) }),
};

function tryCall(label, args) {
	console.log(`== ${label} ==`);
	try {
		const value = validation.validateToolArguments(tool, { type: "toolCall", id: "c", name: "read", arguments: args });
		console.log("passed:", JSON.stringify(value));
	} catch (error) {
		console.log(error.message.split("\n").slice(0, 3).join("\n"));
	}
}

tryCall("A. path: 123", { path: 123 });
tryCall('B. path: ["a.txt"]', { path: ["a.txt"] });
tryCall('C. offset: "abc"', { path: "a.txt", offset: "abc" });

const many = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join("\n");
const r1 = truncate.truncateHead(many);
console.log("== D. truncateHead, 2500 short lines ==");
console.log(JSON.stringify({ truncatedBy: r1.truncatedBy, totalLines: r1.totalLines, outputLines: r1.outputLines }));

const r2 = truncate.truncateHead("x".repeat(60 * 1024));
console.log("== E. truncateHead, one 60KB line ==");
console.log(JSON.stringify({ firstLineExceedsLimit: r2.firstLineExceedsLimit, content: r2.content }));
```

PowerShell：

```powershell
$dir = Join-Path $env:TEMP "pi-task06-exp"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# 用编辑器把上面的脚本保存为 $dir\exp.mts
node (Join-Path $dir "exp.mts")
Remove-Item -Recurse -Force $dir
```

bash：

```bash
dir="${TEMP:-/tmp}/pi-task06-exp"
mkdir -p "$dir"
# 用编辑器把上面的脚本保存为 "$dir/exp.mts"
node "$dir/exp.mts"
rm -rf "$dir"
```

**预期输出**（本地实际运行得到，已去掉 stderr 中的 `ExperimentalWarning` 两行）：

```text
== A. path: 123 ==
passed: {"path":"123"}
== B. path: ["a.txt"] ==
Validation failed for tool "read":
  - path: must be string

== C. offset: "abc" ==
Validation failed for tool "read":
  - offset: must be number

== D. truncateHead, 2500 short lines ==
{"truncatedBy":"lines","totalLines":2500,"outputLines":2000}
== E. truncateHead, one 60KB line ==
{"firstLineExceedsLimit":true,"content":""}
```

**观察。** 用 `123` 时校验通过，因为 `Value.Convert` 把数字转成了字符串。这说明运行时校验会修正值。用数组或不可转换的字符串时校验失败，错误文字包含字段名。D 与 E 显示两种截断：行数超限时保留前 2000 行；单行超过 50KB 时返回空内容，并把 `firstLineExceedsLimit` 置为真，由 `read` 给出 `bash` 的替代提示。

### 实验 2：观察四类失败的去向（设计，未在本地运行）

**目的。** 比较参数非法、工具抛错、取消、钩子阻止四种情况，它们在 `ToolResultMessage` 中有何区别。

**做法。** 在一个单元测试中使用 `packages/coding-agent/test/suite/harness.ts` 的 `createHarness()` 与假模型（faux provider）`fauxAssistantMessage`、`fauxToolCall`，脚本第一轮让模型调用工具，第二轮回复文本。为每种情况记录：工具的 `execute` 是否被调用、结果的 `isError`、结果文字的来源。

**为什么不在这里给出运行结果。** 写测试需要在仓库中新增文件，本篇只要求读懂流程。如果你要运行，请遵守仓库规则：只运行单个测试文件，并在结束后删除自己新增的测试文件。预期结论由本篇“4. 四步流水线”中的分支推导：

| 情况 | `execute` 是否被调用 | 结果 `isError` | 结果文字来源 |
| --- | --- | --- | --- |
| 参数非法 | 否 | `true` | 校验器错误，含 `Validation failed` |
| 工具抛错 | 是 | `true` | 异常的 `message` |
| 取消 | 取决于取消的时机 | `true` | `Operation aborted` |
| 钩子阻止 | 否 | `true` | `beforeToolCall` 返回的 `reason` |

记录每种情况时，同时记下下一轮模型请求的次数。每个情况应该都是两次模型请求：第一次产生工具调用，第二次收到结果后回复文本。

## 自测题

1. 模型给出的参数为 `{ path: 123 }`，`validateToolArguments` 会怎样处理？为什么它不是“直接报错”？
2. `AgentTool` 与 `ToolDefinition` 各自服务谁？`createReadTool` 做了哪一步转换？
3. 并行执行时，`tool_execution_end` 与 `ToolResultMessage` 的顺序为什么可能不同？
4. `beforeToolCall` 返回 `{ block: true, reason: "blocked" }` 时，`execute` 会被调用吗？模型会看到什么？
5. 一批工具全部返回 `terminate: true`，会结束整个 Agent 运行吗？

## 参考答案

1. 先复制参数，再用 `Value.Convert` 转换。数字 `123` 能转成字符串 `"123"`，所以校验通过，`execute` 收到 `"123"`。只有无法转换的值（例如数组）才会失败。
2. `AgentTool` 服务 Agent 循环，负责执行。`ToolDefinition` 服务注册与显示，还包含提示片段和渲染函数。`createReadTool` 调用 `wrapToolDefinition(createReadToolDefinition(...))`，把定义转换成运行时形态。
3. 完成事件按完成的先后发出；结果消息按模型声明的顺序写入。`Promise.all` 返回的数组保持输入顺序，所以消息顺序不变。
4. 不会调用。阻止时 `prepareToolCall` 返回 `kind: "immediate"`，生成 `isError: true` 的结果，文字为 `reason`。模型在下一轮看到 `blocked`。
5. 不会。`terminate` 只表示“不要因为这一批工具再请求模型”。只有整批都设置了它才生效。它不会结束运行。

## 常见错误

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 模型说“没有这个工具” | 工具没有出现在当前请求的 `context.tools` 中，或者名字不一致 | 检查注册的 `name` 是否与模型调用一致；检查当前启用的工具集设置（默认工具与白名单） |
| 工具明显会失败，界面却没标红 | 只在 `content` 中写了错误文字，没有设置 `isError: true` | 抛出异常，或返回 `isError: true` 的结果 |
| 大输出撑满上下文 | 工具没有截断输出 | 使用 `truncateHead` 或 `truncateTail`，并提示模型如何继续读取 |
| 并行工具的顺序看起来不对 | 把完成事件的顺序当成消息顺序 | 完成顺序看 `tool_execution_end`；历史顺序看 `ToolResultMessage` |
| 修改了参数，工具却收到了不合法的值 | `beforeToolCall` 修改 `args` 后不会再次校验 | 在工具内部检查关键条件，再执行副作用 |

## 选读：源码深入（跳过不影响主线）

> 以下内容超出主线。读完前面的内容后再看。

### 选读 A：`read` 的取消与截断细节

`read` 的执行函数用手动 `Promise` 包裹异步操作，以便精确处理取消：

- 进入时若 `signal.aborted` 已为真，立即拒绝，错误为 `Operation aborted`。
- 注册一个 `abort` 监听器，使用 `{ once: true }`，只触发一次。
- 每个 `await` 之后检查局部变量 `aborted`，取消后不再做后续步骤。
- 收尾时调用 `removeEventListener`，避免长会话中的监听器泄漏。

截断提示有三种，分别对应三种情况（来自 `read.ts` 的 `execute`）：

| 情况 | 提示形式 |
| --- | --- |
| 单行超过 50KB | `[Line N is XKB, exceeds 50KB limit. Use bash: sed -n 'Np' <path> \| head -c 51200]` |
| 行数或字节达到上限 | `[Showing lines a-b of n. Use offset=b+1 to continue.]`；字节限制时括号中多一句 `(50KB limit)` |
| 用户的 `limit` 提前停止 | `[x more lines in file. Use offset=y to continue.]` |

图片路径会调用 `processImage`，按当前模型的 `inputLimits.images.resize` 缩放。模型不支持图片时，文本中附加一条说明。

### 选读 B：`truncate.ts` 的规则

`packages/coding-agent/src/core/tools/truncate.ts` 提供三个函数：

- `truncateHead`：保留开头，用于文件阅读。
- `truncateTail`：保留结尾，用于命令输出（报错通常在最后）。
- `truncateLine`：按字符数截断单行，用于 grep 命中行（上限 `GREP_MAX_LINE_LENGTH` 为 500）。

截断有两个独立上限：行数（`DEFAULT_MAX_LINES = 2000`）和字节数（`DEFAULT_MAX_BYTES = 50 * 1024`）。两者先到先停。字节按 UTF-8 计算，而不是按 JavaScript 字符串的 `length`。

`truncateHead` 的例外：如果第一行本身就超过字节上限，返回空内容并把 `firstLineExceedsLimit` 置为真。调用方据此给出替代方案，而不是返回一个误导性的“空文件”。

`truncateTail` 的例外：如果最后一行超过字节上限，取它的末尾部分，并设置 `lastLinePartial: true`。这样报错信息中最后的部分仍然可见。`truncateStringToBytesFromEnd` 会跳过 UTF-8 续字节，避免切断多字节字符。

### 选读 C：`bash` 与 `OutputAccumulator`

`bash` 的输出可能持续增长，所以不能把全部内容放进内存再截断。`packages/coding-agent/src/core/tools/output-accumulator.ts` 中的 `OutputAccumulator` 解决这个问题：

- `append(data: Buffer)`：接收每一块输出。它用 `TextDecoder` 的流式解码（`{ stream: true }`），跨块的多字节字符会等下一块补齐后再输出。
- 内存中只保留解码后的尾部；当原始输出超过阈值时，全部内容写入一个临时文件。
- `finish()`：必须调用，用于冲刷解码器剩余字节。调用多次是安全的。
- `snapshot({ persistIfTruncated })`：返回给模型的截断内容、`truncation` 统计，以及临时文件路径（如果有）。
- `closeTempFile()`：等待文件流真正关闭。
- `readFullOutput(maxBytes)`：给程序化调用方读取全部或首尾内容。注意它的参数 `maxBytes` 与实例上的上限不是同一个概念。

`bash` 的 `execute` 在 `packages/coding-agent/src/core/tools/bash.ts`，使用 `output.append(data)` 接收输出，并在结束时调用 `output.snapshot({ persistIfTruncated: true })`。

进程层面的要点：

- `BashOperations.exec` 是可替换的接口，本地实现是 `createLocalShellOperations`（由 `createLocalBashOperations` 调用）。远程执行可以替换它。
- `BashSpawnHook` 允许在启动前修改命令、环境或工作目录。
- `timeout` 参数的单位是秒，`resolveTimeoutMs` 负责检查。没有默认超时。超时后会杀掉整个进程树，并抛出 `timeout:<秒>` 错误。
- 退出码映射：正常退出码直接使用；如果被信号终止，使用 `128 + 信号编号`；都没有则为 `1`。接口文档要求 `null` 退出码视为失败。
- 取消信号到达时，`onAbort` 杀掉进程树，并抛出 `aborted`（注意：这个文案与工具层其他地方的 `Operation aborted` 不同）。

### 选读 D：`edit` 与 `write` 的文件变更队列

`write` 与 `edit` 修改文件，两个调用同时修改同一文件会互相覆盖。`packages/coding-agent/src/core/tools/file-mutation-queue.ts` 中的 `withFileMutationQueue(filePath, fn)` 让同一文件的操作串行，不同文件之间可以并行。

- 队列的键是 `realpath`（真实路径），所以 `./a.txt` 与符号链接指向同一文件时会排在同一队列。目标文件不存在时，键退回为 `resolve()` 的结果，此时别名可能不被归并。
- 这是进程内的协调，不是文件系统锁，也不保证事务性。

`write` 的执行函数（`packages/coding-agent/src/core/tools/write.ts`）在队列内做三件事：`ops.mkdir(dir)` 自动创建父目录，`ops.writeFile` 写入，最后返回 `Successfully wrote to <path>`。它用 `throwIfAborted()` 检查取消，而不是注册 `abort` 监听器直接 reject。原因写在源码注释中：直接 reject 会在底层写操作仍未结束时提前释放队列锁。`edit` 使用同样的模式（`packages/coding-agent/src/core/tools/edit.ts`）。

`edit` 的差异匹配与补丁生成在 `packages/coding-agent/src/core/tools/edit-diff.ts`（例如 `fuzzyFindText`、`generateDiffString`）。这部分本篇未逐行精读。

### 选读 E：并行调度中的取消

并行执行的准备循环中，如果 `signal` 在某次迭代后变为已取消，循环会 `break`，后面的调用不会进入结果列表。已经准备好的闭包在启动时会再次检查 `signal`，已取消的调用生成 `Operation aborted` 结果。因此，最终的结果消息可能只覆盖声明序列的一部分。

测试 `should emit tool_execution_end in completion order but persist tool results in source order`（位于 `packages/agent/test/agent-loop.test.ts`）验证了上一节描述的顺序约定。

## 下一篇

下一篇讲 `AgentSession`。它负责把工具集、会话文件、模型选择和资源释放组织在一起，让一次工具调用能在真实会话中持续保存和恢复。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| 工具（tool） | 模型可以请求执行的本地操作 | 先用一个例子理解 |
| 工具声明 | 发给模型的 name、description 与参数 schema | 1. 工具对模型是什么 |
| 调用块（toolCall） | assistant 消息中请求执行工具的内容块 | 1. 工具对模型是什么 |
| 参数 schema | 描述参数名称、类型与可选性的规则 | 1. 工具对模型是什么 |
| TypeBox | 用 TypeScript 代码书写 schema 的库 | 1. 工具对模型是什么 |
| `AgentTool` | 循环执行时使用的运行时工具形态 | 2. AgentTool 与 ToolDefinition |
| `ToolDefinition` | 注册与显示时使用的富形态工具 | 2. AgentTool 与 ToolDefinition |
| 参数校验 | 执行前按 schema 检查并转换模型参数 | 3. 参数校验 |
| 钩子 | 调用方提供的、在执行前后运行的函数 | 6. 钩子 |
| 顺序执行 | 一次只执行一个工具调用，并完整记录后才开始下一个 | 5. 顺序执行与并行执行 |
| 并行执行 | 准备按顺序进行，执行可以同时进行 | 5. 顺序执行与并行执行 |
| `isError` | 标记一个工具结果是否为失败 | 3. 参数校验 |
| `terminate` | 提示本批工具之后不再请求模型 | 5. 顺序执行与并行执行 |
| `ToolResultMessage` | 会话中记录一次工具输出的消息 | 7. 结果变成 ToolResultMessage |
| `details` | 给界面或扩展程序的结构化数据，不发给模型 | 1. 工具对模型是什么 |
