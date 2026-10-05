# 第 14 章：工具型扩展与资源分发

> 学完本章你能回答：
>
> 1. `defineTool` / `registerTool` 的完整字段有哪些？各自面向谁（模型/界面/程序）？
> 2. 工具结果的 `content`、`details`、`structuredContent`、`usage` 分别给谁用？
> 3. 工具怎么调用另一个工具（嵌套调用）？它和模型发起的调用有何异同？
> 4. 渲染器怎么写？为什么截断与"告诉模型完整输出在哪"是强制纪律？
> 5. 一个工具型扩展怎么打包、分发、复用？

**前置知识**：第 7 章（工具系统内核）、第 13 章（扩展 API）。
**预计学习时间**：1.5 天（含动手：完成 `inspect_package`）。
**本章验证状态**：静态核对通过（对照 `extensions.md` 的 Tools/Rendering 章节与四个官方示例）；实验 L08 下半部分设计中。

---

## 14.1 `defineTool`：工具型扩展的字段全景

`hello.ts` 已经给了最小形态；把字段展开成完整地图（对照 `core/extensions/types.ts` 的 `ToolDefinition`）：

```typescript
const myTool = defineTool({
	// ① 身份
	name: "inspect_package",
	label: "Inspect Package",

	// ② 面向模型的说明（进供应商请求的工具定义）
	description: "Read a package.json and report name, scripts, and dependencies.",

	// ③ 进系统提示的元数据（第 10 章 tools/rules 分节）
	promptSnippet: "Inspect package.json metadata",
	promptGuidelines: ["Use inspect_package before suggesting npm scripts."],

	// ④ 参数 schema（运行时校验 + 编译期类型来源）
	parameters: Type.Object({
		path: Type.Optional(Type.String({ description: "Directory or package.json path" })),
	}),

	// ⑤ 结构化输出的声明（14.3）
	outputSchema: Type.Object({ /* ... */ }),

	// ⑥ 调度与兼容
	executionMode: "sequential",          // 有共享状态时
	prepareArguments: (args) => args,     // 老模型参数兼容垫片

	// ⑦ 执行：注意第五个参数 ctx
	async execute(toolCallId, params, signal, onUpdate, ctx) { /* ... */ },

	// ⑧ 渲染（14.5）
	renderCall(args, theme, context) { /* ... */ },
	renderResult(result, options, theme, context) { /* ... */ },
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(myTool);
}
```

三组字段对应三个受众，这是本章的主线：

| 组 | 字段 | 受众 |
|---|---|---|
| 说明 | `description`、`promptSnippet`、`promptGuidelines` | 模型（请求定义 + 系统提示） |
| 契约 | `parameters`、`outputSchema`、`executionMode` | 运行时（校验、调度、程序化调用） |
| 呈现 | `renderCall`、`renderResult` | 终端与 HTML 导出 |

`execute` 的第五参 `ctx` 是 `ExtensionContext`（第 13 章）：能读 `ctx.cwd`、`ctx.mode`、`ctx.sessionManager`，也能做嵌套模型调用（`ctx.modelRegistry.streamSimple`）。

### 14.1.1 从注册到执行的端到端轨迹

只看 `pi.registerTool(tool)` 容易误以为它会直接把定义放进 Agent。实际有两个阶段：扩展加载时先把定义存入扩展对象；会话把 runner 绑定到核心后，再把定义整理成注册表并包装为 `AgentTool`。工具执行时 wrapper 才创建本次调用的 `ctx`。

```text
扩展工厂调用 pi.registerTool(definition)
  → loader 校验 parameters 是对象 schema，写入 extension.tools
  → 加载阶段调用 runtime.refreshTools，但此时它是 no-op
  → AgentSession 绑定核心操作，refreshTools 接到 _refreshToolRegistry
  → 刷新 definition registry，并用 wrapRegisteredTools 生成 AgentTool
  → Agent 循环调用 AgentTool.execute(toolCallId, params, signal, onUpdate)
  → wrapToolDefinition 调用 ctxFactory(toolCallId, signal)
  → ExtensionRunner.createToolContext 创建本次调用的上下文
  → 原始 ToolDefinition.execute(..., ctx)
```

这里的刷新并不表示工具必然已经暴露给模型。`_refreshToolRegistry` 先重建完整定义/执行注册表，再依据 allowlist、`exposure`、活动工具集和默认激活规则决定哪些工具进入 Agent 当前 loadout；第 7.3 节继续解释运行时可执行集合与模型声明集合的差别。

这条顺序解释了两个看似矛盾的事实：加载扩展期间注册工具时 `refreshTools` 可以暂时不做事，因为稍后的会话绑定会建立完整注册表；而会话启动后（例如 `session_start` 处理器中）再注册工具时，已经绑定的回调会立即刷新注册表。`agent-session-dynamic-tools.test.ts` 的动态注册用例覆盖了后一个路径。

**`ctx` 的类型与运行时边界**：`ToolDefinition.execute` 把第五参声明为必填，但 TypeScript 签名不能保证每个调用方都经过同一个 wrapper。`wrapToolDefinition` 的工厂参数可选；没有 `ctx` 且没有工厂时，实际传入值就是 `undefined`。因此直接测试 `definition.execute(...)` 的调用者应传入假的上下文，或让工具逻辑不依赖上下文。扩展注册工具的标准会话路径由 `wrapRegisteredTool` 提供工厂，`createToolContext` 每次新建上下文，并把该工具的调用 id 与 abort signal 绑定到 `executeTool()` 嵌套调用。

与 ctx 生命周期有关的源码定位：`extensions/loader.ts` 的 `registerTool`、`agent-session.ts` 的 `_bindExtensionCore` / `_refreshToolRegistry`、`extensions/wrapper.ts` 的 `wrapRegisteredTool`、`tools/tool-definition-wrapper.ts` 的 `wrapToolDefinition`、`extensions/runner.ts` 的 `createToolContext`。类型注释也明确说，缺少 context factory 的普通 `Agent` 或直接调用可能没有 ctx（`extensions/types.ts` 的 `ExtensionToolContext`）。

## 14.2 结果设计：四个字段，四种用途

`extensions.md` 的 Tools 一节把"结果怎么设计"讲成了纪律（原文要点 + 对照第 4、7 章）：

```text
Its result requires model-facing `content` and a `details` field for rendering or state reconstruction.
Use `details: undefined` when there are no structured details.
If the tool makes nested model calls, include their `usage` in the result so session totals remain accurate.

Throw from `execute()` to produce a failed tool result.
Returning an object does not mark it as an error.
Return `terminate: true` only when the agent should skip its automatic follow-up after every
completed tool in that batch agrees to terminate.
```

四个字段的去向（综合第 4、7 章的表格）：

| 字段 | 模型看到 | 界面/状态 | 程序化调用者 | 备注 |
|---|---|---|---|---|
| `content` | ✅ | ✅ | （没有 structuredContent 时退化用） | **必须**给模型看的内容 |
| `details` | ❌ | ✅ | ✅ | 渲染与"状态重建"；可以 `undefined` |
| `structuredContent` | ❌ | ❌ | ✅（codemode 脚本等） | 需与 `outputSchema` 配套 |
| `usage` | 进消息统计 | ✅ | ✅ | 嵌套模型调用必须带上，否则会话计费失真 |

失败的两条通道，语义不同：

```typescript
// 通道一：抛错 → 模型收到 isError 工具结果（details 拿不到）
throw new Error("package.json not found");

// 通道二：带数据的失败 → 模型看到错误，同时程序化调用者拿到结构化数据
return { content: [{ type: "text", text: "not found" }], details: {}, structuredContent: {...}, isError: true };
```

第二条正是 `extensions.md` 强调的场景："To report a failure that still carries data, return the result with `isError: true` instead of throwing: the model sees an error, and scripts still receive `structuredContent`."

`terminate: true` 的规则与第 7 章完全一致：**整批工具都同意终止**才免除自动跟进；不要用它表达"这个工具有错"。

## 14.3 结构化输出：`structured-output.ts` 精读

官方示例展示了一个"**终结型工具**"模式：

```typescript
const structuredOutputTool = defineTool({
	name: "structured_output",
	label: "Structured Output",
	description: "Return a final structured answer. Use this as your last action when the user asks for structured output or a machine-readable summary.",
	promptSnippet: "Emit a final structured answer as a terminating tool result",
	promptGuidelines: [
		"Use structured_output as your final action when the user asks for structured output, JSON-like output, or a machine-readable summary.",
		"After calling structured_output, do not emit another assistant response in the same turn.",
	],
	parameters: Type.Object({
		headline: Type.String({ description: "Short title for the result" }),
		summary: Type.String({ description: "One-paragraph summary" }),
		actionItems: Type.Array(Type.String(), { description: "Concrete next steps or key bullets" }),
	}),
	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text", text: `Saved structured output: ${params.headline}` }],
			details: { headline: params.headline, summary: params.summary, actionItems: params.actionItems },
			terminate: true,
		};
	},
	renderResult(result, _options, theme) { /* 用 details 画出标题/摘要/清单 */ },
});
```

三个教学点：

1. **`terminate: true` 省一轮模型请求**：工具已经给出了"最终答案"，不需要模型再总结一次——**省钱也省时**；
2. **`promptGuidelines` 是行为约束**：告诉模型"这是最后一步、之后不要再产出"；
3. **`renderResult` 用 `details` 渲染**：模型侧只看到一行"Saved..."，用户在终端看到完整的结构化展示——**两个受众，两种呈现**（14.5 展开）。

## 14.4 嵌套工具调用：工具内部再调工具

`extensions.md` Tools 一节的原文（节选）：

```text
A tool can run other tools with `ctx.executeTool(name, args, { signal, onUpdate })`.
Nested calls go through argument validation and the `tool_call` and `tool_result` handlers
like model-issued calls, and emit `tool_...`（事件携带 parentToolCallId）
```

与第 7 章的 `runToolCall` 对照：嵌套调用**复用同一条流水线**（prepare → beforeToolCall → execute → afterToolCall），所以：

- 权限扩展（`permission-gate`）对嵌套调用同样生效；
- 审计/日志扩展能看到它们；
- 会话事件里通过 `parentToolCallId` 标明"我属于哪个外层调用"（`AgentSessionEvent` 的 `WithParentToolCallId`，第 4.5.2 节）。

**什么时候用**：组合型工具（"先 grep 再 read 指定行"）、批处理工具（对多个目标执行同一动作）、以及 codemode 这类"程序化编排"场景（第 22 章）。**注意**：嵌套调用会上报事件但**不会**生成新的模型消息——只有最外层工具的结果进入对话。

## 14.5 渲染定制：`renderCall` / `renderResult`

工具在终端里的样子，由这对函数决定（HTML 导出复用同一套渲染，`extensions.md`）：

```typescript
	renderCall(args, theme, _context) {
		let text = theme.fg("toolTitle", theme.bold("rg "));
		text += theme.fg("accent", `"${args.pattern}"`);
		if (args.path) text += theme.fg("muted", ` in ${args.path}`);
		return new Text(text, 0, 0);
	},

	renderResult(result, { expanded, isPartial }, theme, _context) {
		if (isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);
		const details = result.details as RgDetails | undefined;
		if (!details || details.matchCount === 0) return new Text(theme.fg("dim", "No matches found"), 0, 0);
		/* ...用 details 拼出多行展示... */
	},
```

要点：

- **`isPartial`**：流式执行中的中间态（配合 `onUpdate` 上报的 partial result）；给"正在执行"的视觉反馈；
- **`expanded`**：用户是否展开了结果（折叠/展开两种布局）；
- **渲染的输入是 `details`，不是 `content`**：所以"给模型的内容"和"给人看的内容"可以完全不同（14.2 的表）；
- 不写渲染器也有默认渲染（按内容文本显示）——**渲染是增强，不是必需**。

### 14.5.1 `registerToolRenderer`：给"别人的工具"换皮

```text
`pi.registerToolRenderer((toolName, next) => renderers)` chooses renderers for calls to any tool,
including tools that are not registered yet, such as MCP tools in a resumed session before their
server connected. `next()` returns what the remaining resolvers (in extension load order), then
the registered tool, would use, so `next() ?? mine` only fills in.
```

两个使用场景：

- **还没注册的工具**：恢复的会话里有 MCP 工具调用，但服务器还没连上——此刻没有工具定义，渲染器依然能工作；
- **"只是补缺"**：`next() ?? mine` 表示"如果别人（或工具自己）已经提供了渲染器就用别人的，否则用我的"——**尊重既有定义，做叠加而不是覆盖**。

## 14.6 输出截断纪律：`truncated-tool.ts` 精读

自定义工具**必须**控制面向模型的输出大小（为什么：第 7.9 节的上下文与内存保护）。官方示例把完整套路拆给读者：

**第一步：把限制写进 description**（让模型提前知道）：

```typescript
	description: `Search file contents using ripgrep. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)} (whichever is hit first). If truncated, full output is saved to a temp file.`,
```

**第二步：用内置工具截断**：

```typescript
	const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
```

注释把选择讲清了："truncateHead keeps the first N lines/bytes (good for search results)；truncateTail keeps the last N (good for logs/command output)."

**第三步：全量输出落盘 + 把路径告诉模型**：

```typescript
	if (truncation.truncated) {
		const tempDir = await mkdtemp(join(tmpdir(), "pi-rg-"));
		const tempFile = join(tempDir, "output.txt");
		await withFileMutationQueue(tempFile, async () => { await writeFile(tempFile, output, "utf8"); });

		details.truncation = truncation;
		details.fullOutputPath = tempFile;

		resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`;
		resultText += ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
		resultText += ` ${truncatedLines} lines (${formatSize(truncatedBytes)}) omitted.`;
		resultText += ` Full output saved to: ${tempFile}]`;
	}
```

**第四步（隐含）：`details` 里保留 `truncation` 与 `fullOutputPath`**——界面可以显示"已截断"，用户/扩展能顺着路径拿到全部。

这四步与内置 `read` 的"可继续提示"是同一哲学（第 7.8.4 节）：**截断不是丢数据，而是换一种访问方式。**

## 14.7 会话状态的持久化：`tools.ts` 精读

`tools.ts` 示例把"扩展状态"的完整生命周期演示了一遍：

```typescript
interface ToolsState { enabledTools: string[]; }

export default function toolsExtension(pi: ExtensionAPI) {
	let enabledTools: Set<string> = new Set();
	let allTools: ToolInfo[] = [];

	function persistState() {
		pi.appendEntry<ToolsState>("tools-config", { enabledTools: Array.from(enabledTools) });
	}
	function applyTools() { pi.setActiveTools(Array.from(enabledTools)); }

	function restoreFromBranch(ctx: ExtensionContext) {
		allTools = pi.getAllTools();
		const branchEntries = ctx.sessionManager.getBranch();     // 只读活动分支
		let savedTools: string[] | undefined;
		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "tools-config") {
				const data = entry.data as ToolsState | undefined;
				if (data?.enabledTools) savedTools = data.enabledTools;
			}
		}
		if (savedTools) {
			const allToolNames = allTools.map((t) => t.name);
			enabledTools = new Set(savedTools.filter((t: string) => allToolNames.includes(t)));
			applyTools();
		} else {
			enabledTools = new Set(pi.getActiveTools());
		}
	}

	pi.registerCommand("tools", { /* TUI 选择器：ctx.ui.custom + SettingsList；改动即 applyTools + persistState */ });
	pi.on("session_start", async (_event, ctx) => { restoreFromBranch(ctx); });
	pi.on("session_tree", async (_event, ctx) => { restoreFromBranch(ctx); });   // 树导航后重新恢复
}
```

记住这个骨架，因为它是**所有"带状态的扩展"的通用模式**：

```text
状态变化 → appendEntry（只追加，不改写）
会话开始/树导航 → 从 getBranch() 逆序找最后一个 custom 条目 → 恢复
过滤已不存在的工具/资源 → 应用
```

对照第 9 章：`getBranch()` 沿活动分支回溯，所以"工具状态"天然是**分支相对**的——在分支 A 禁用了某工具，切到分支 B 时按 B 的历史恢复。这正是 `extensions.md` 表格里"Tool state that follows the active branch"的含义。
## 14.8 实验 L08（下半部分）：`inspect_package` 工具

**实验性质**：本地运行；先直测工具（无模型），再用 faux 走一遍模型调用。
**验证状态**：设计中。这是规划文档里 L08 的正题：一个"读取练习目录 package.json，给出项目概览和脚本清单"的只读工具。

### 14.8.1 规格（先写验收条件，再写代码）

- 参数：`{ path?: string }`——目录路径，默认当前工作目录；
- 成功输出（给模型）：包名与版本、脚本**数量与名称**、依赖计数——**保持小体积**；
- 失败必须明确：文件不存在 / JSON 非法 / 内容不是对象，分别给出可定位的错误文本；
- 支持取消：`signal` 在关键等待点前后检查；
- 只读：不做任何写操作（毕业项目的安全边界）。

### 14.8.2 参考实现（可运行骨架，含逐行注释）

```typescript
/**
 * inspect_package - read-only tool that summarizes a package.json.
 * 实验用工具；教学目录里的 package.json 是唯一输入。
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const parameters = Type.Object({
	path: Type.Optional(Type.String({ description: "Directory containing package.json (default: current directory)" })),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "inspect_package",
			label: "Inspect Package",
			description:
				"Read a package.json from a directory and report the package name, version, script names, and dependency counts. Read-only.",
			parameters,

			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				// 1. 路径解析：一律相对 ctx.cwd（当前会话工作目录），而不是进程启动目录或作者机器
				const dir = resolve(ctx.cwd, params.path ?? ".");
				const file = join(dir, "package.json");

				// 2. 取消检查点（模式同第 7 章 read.ts：每个 await 之间检查）
				if (signal?.aborted) throw new Error("Operation aborted");

				let text: string;
				try {
					text = await readFile(file, "utf8");
				} catch (error) {
					// 3. 缺失文件：错误信息里带上完整路径，模型/用户能直接定位
					throw new Error(
						`package.json not found in ${dir}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				if (signal?.aborted) throw new Error("Operation aborted");

				// 4. JSON 解析：独立捕获，错误文本带文件路径
				let data: unknown;
				try {
					data = JSON.parse(text);
				} catch {
					throw new Error(`Invalid JSON in ${file}`);
				}
				if (typeof data !== "object" || data === null || Array.isArray(data)) {
					throw new Error(`Unexpected package.json content in ${file}: expected a JSON object`);
				}

				// 5. 汇总：只输出摘要（小体积），细节放 details
				const pkg = data as {
					name?: string;
					version?: string;
					scripts?: Record<string, string>;
					dependencies?: Record<string, string>;
					devDependencies?: Record<string, string>;
				};
				const scripts = Object.keys(pkg.scripts ?? {});
				const deps = Object.keys(pkg.dependencies ?? {});
				const devDeps = Object.keys(pkg.devDependencies ?? {});

				return {
					content: [
						{
							type: "text",
							text: [
								`package: ${pkg.name ?? "(unnamed)"}${pkg.version ? `@${pkg.version}` : ""}`,
								`scripts (${scripts.length}): ${scripts.join(", ") || "(none)"}`,
								`dependencies: ${deps.length}, devDependencies: ${devDeps.length}`,
							].join("\n"),
						},
					],
					details: { file, scripts, deps, devDeps },
				};
			},
		}),
	);
}
```

### 14.8.3 用例表（"错误实现会失败"的断言）

| 用例 | 构造 | 断言 |
|---|---|---|
| 正常 | 教学目录放合法 package.json | 文本含包名、脚本数；`details.file` 是绝对路径 |
| 文件缺失 | 指向空目录 | 抛出 `package.json not found in <dir>`；模型侧是 `isError: true` |
| JSON 非法 | 写入 `{ bad` | 抛出 `Invalid JSON in <file>` |
| 内容非对象 | 写入 `[1,2]` | 抛出 `expected a JSON object` |
| 取消 | 在 `readFile` 前 abort | 抛 `Operation aborted`；run 以 aborted 收尾 |
| 路径默认值 | 不传 `path` | 使用 `ctx.cwd`（换工作目录后结果跟着变） |

### 14.8.4 为什么"路径不能依赖作者机器"

分发之后，别人的机器上不存在你写代码时的绝对路径（比如 `D:\tutorial\demo`）。正确做法：

- 参数用**相对路径**语义，基准是 `ctx.cwd`（会话工作目录）；
- 需要包内资源时走包自身解析（`import.meta.url` 或 Pi 的资源路径 helper），而不是硬编码；
- 测试用例覆盖"默认路径"与"相对路径"两种输入——它们证明工具**不依赖运行环境**。

### 14.8.5 从直测到模型调用

1. **直测**（无模型）：写临时脚本直接 `import` 你的实现并调用 `execute`（或写 vitest）；断言四类错误文本；
2. **模型链路**（faux）：注册 faux，第一步脚本返回 `fauxToolCall("inspect_package", {})`，第二步返回文本；断言 `callCount === 2` 且工具结果进入消息数组（第 5、18 章的设施）；
3. **打包（可选）**：把目录放到 `extensions/inspect-package/`，加 `package.json`（`pi` manifest 或约定目录），用 `pi --extension ./extensions/inspect-package` 验证加载。

## 14.9 分发之前：打包与依赖（回顾 + 落地）

第 12.3.6 节讲过 Pi package 的规则；做工具型扩展时，把这三条当成**发布前检查**：

1. **host 提供的包放 `peerDependencies`**（`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui`、`typebox`，`"*"` 范围）——**绝不放进 `dependencies`、绝不打包**（会导致类/注册表重复与初始化冲突；`packages.md` 明确警告，pi 也会报扩展警告）；
2. **自己的运行时依赖**（如你用的 HTTP 客户端）放 `dependencies`；npm 规格钉版本；
3. **资源路径**：扩展里引用自带文件一律相对"扩展/包自身"解析；用 Pi 包的 manifest 声明资源（`pi.extensions`/`pi.skills`/...），支持 glob 与排除。

分发流程速查：

```bash
pi install ./my-package            # 本地开发：不复制、直接加载
pi install npm:@you/my-package@1.0.0
pi -e npm:@you/my-package          # 单次试用，不写设置
pi list / pi remove <source> / pi update --extensions
```

## 14.10 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 模型看不到工具/报"not found" | 没 `registerTool`、加载失败（诊断里有错）、或工具被禁用 | 查 `getAllTools()`/活动工具集与启动诊断 |
| `details` 渲染不出来 | 忘了 `renderResult` 或 details 结构不符 | 对照 `structured-output.ts`；渲染只读 details |
| 大输出把上下文撑爆 | 没截断 | 用 `truncateHead/Tail` + 临时文件 + 提示（14.6） |
| 嵌套调用绕过权限检查 | 以为工具内部调用不触发钩子 | 记忆：`ctx.executeTool` 走同一流水线；用 `runToolCall` 语义理解 |
| 运行别人的机器上路径全错 | 硬编码绝对路径 | 相对 `ctx.cwd`；包内资源相对自身解析 |
| 失败时"只写文本不算错" | 没抛错也没 `isError: true` | 按 14.2 两条通道处理；要带数据用 `isError: true` |
| `structuredContent` 缺失/不匹配 | 声明了 `outputSchema` 却没给或形状不符 | 让二者同源（同一 schema 生成/校验） |
| 打包后宿主模块重复 | host 包进了 dependencies | 改 peerDependencies（14.9） |
| 工具状态跨分支串了 | 全量读 entries 而不是活动分支 | 学 `tools.ts`：`getBranch()` + 逆序找最后一条 custom |

## 14.11 验收题

1. `defineTool` 的字段分哪三组？各组字段的受众是谁？
2. `content`/`details`/`structuredContent` 的可见性矩阵？`usage` 为什么必须带回嵌套调用？
3. "失败但带数据"与"直接抛错"的差异？各自的接收方分别看到什么？
4. `terminate: true` 生效的完整条件？为什么不能拿它表达错误？
5. 写一个"给尚未注册的工具补渲染器"的场景，并说明 `next() ?? mine` 的含义。
6. `inspect_package` 的四类失败用例，错误文本各自应包含什么（为了可定位）？
7. 为什么扩展的包内资源不能用作者机器的绝对路径引用？给出两条可行替代。

### 参考答案（要点）

1. 说明（description/promptSnippet/promptGuidelines）→模型；契约（parameters/outputSchema/executionMode）→运行时；呈现（renderCall/renderResult）→终端与导出。
2. content：模型+界面；details：界面/程序（模型不可见）；structuredContent：仅程序化调用者；usage 计入会话统计，缺了会让计费与用量失真。
3. 抛错：模型收到错误结果，程序化调用者拿不到结构化数据；`isError: true` + `structuredContent`：模型看到错误文本，脚本仍拿到数据。
4. 整批工具的结果都为 `terminate: true`，且没有排队消息/显式续跑等其它继续理由；它是"调度建议"，不是错误标记。
5. 恢复的会话里出现 MCP 工具调用但服务器未连接；`next()` 给出"后续解析器或工具自身"的渲染器，`next() ?? mine` 表示仅在无人提供时使用你的渲染器。
6. 缺失：完整路径 + 底层原因；非法 JSON：文件路径；非对象：路径 + "expected a JSON object"；取消：`Operation aborted`。
7. 分发后路径不存在/不同。替代：相对 `ctx.cwd` 解析输入；包内资源相对包自身（manifest/`import.meta.url`）解析。

## 14.12 来源与下一章

- `packages/coding-agent/docs/extensions.md`（Tools、Tool rendering 章节）；
- 示例：`examples/extensions/hello.ts`、`structured-output.ts`、`truncated-tool.ts`、`tools.ts`、`tool-override.ts`、`todo.ts`、`qna.ts`；
- 源码：`packages/coding-agent/src/core/extensions/types.ts`（`defineTool`、`ToolDefinition`、`ExtensionToolContext`）、`core/tools/truncate.ts`、`core/tools/file-mutation-queue.ts`；
- `packages/coding-agent/docs/packages.md`（分发规则）。

下一章进入 SDK：在自己的 Node 程序里创建、观察、替换、释放会话——把第 3、8 章的装配流程变成你可以编程控制的 API。
