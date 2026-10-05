# 第 13 章：Extension API、加载与事件

> 学完本章你能回答：
>
> 1. 扩展的加载过程是怎样的？`ExtensionAPI` 提供哪些能力？
> 2. 事件处理器怎么注册、按什么顺序执行？`pi.on()` 的返回值有什么用？
> 3. `before_agent_start`、`tool_call`、`input`、`turn_end` 等关键钩子的返回语义是什么？
> 4. 扩展的资源（进程、定时器、订阅）应该在哪创建、哪里释放？
> 5. 交互/print/json/rpc 四种模式下，扩展的行为有什么差异？

**前置知识**：第 12 章（何时用扩展）、第 6、7 章（事件与工具语义）。
**预计学习时间**：2 天（边读边写：本章实验要求你完成第一个扩展）。
**本章验证状态**：静态核对通过（`extensions.md` 全文与 4 个官方示例核对）；实验 L08 前半部分设计中。

---

## 13.1 扩展的形态与加载

### 13.1.1 最小扩展

一个扩展就是一个模块，**默认导出工厂函数**：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("hello", {
		description: "Show a greeting",
		handler: async (name, ctx) => {
			ctx.ui.notify(`Hello, ${name || "world"}!`, "info");
		},
	});
}
```

配套的事实（`extensions.md`）：

- **工厂可同步可异步**：异步工厂会被 **await**——启动流程等它完成（这是"启动期注册 provider/配置"能工作的原因）；
- **本地 TS 无需编译**：pi 用 `jiti` 即时加载（`jiti-loader.ts` 只有 177 字节——薄包装）；
- **开发期直接加载**：`pi --extension ./hello.ts` 或 `-e`；
- **位置**：用户 `extensions/` / 项目 `.pi/extensions/`（直接文件，或含 `index.ts`/`index.js` 的子目录）；项目扩展**需要信任**（第 11 章）。

### 13.1.2 加载顺序与"谁先执行"

`extensions.md` 的一句话是很多调试问题的答案：

```text
Handlers run in extension load and registration order.
```

- 扩展按**加载顺序**排列（用户级、CLI、项目的先后由资源加载决定，第 11.4 节）；
- 同一扩展内按**注册顺序**；
- 多处理器事件里"后一个能看到前一个的修改"（如 `tool_result` 是**组合式**的），但"最后一个返回动作的生效"（如 `cache_warming_decision`）。

### 13.1.3 重载语义：`ctx.reload()`

`reload-runtime.ts` 示例展示了正确姿势：

```typescript
pi.registerCommand("reload-runtime", {
	description: "Reload extensions, skills, prompts, themes, and context files",
	handler: async (_args, ctx) => {
		await ctx.reload();
		return;      // reload 之后不要再碰旧运行时状态
	},
});
```

三条规则：

1. **`ctx.reload()` 之后旧运行时整体作废**：`extensions.md` 原话 "Reload replaces the extension runtime, so code after `await ctx.reload()` must not reuse state from the old runtime."；
2. **工具里不能直接 reload**（工具拿到的是 `ExtensionContext`，不是命令专用的 `ExtensionCommandContext`）——示例用了一个巧妙办法：工具 `sendUserMessage("/reload-runtime", { deliverAs: "followUp" })` 把命令排成跟进消息；
3. **命令上下文多出来的能力**（`waitForIdle`、`reload`、`navigateTree`、会话替换类操作）**只能在命令里用**——从生命周期钩子里调用可能死锁运行时（`extensions.md` 的警告）。

## 13.2 `ExtensionAPI` 能力全景

`extensions.md` 的集成点表（照着读 `types.ts` 能一一对应）：

| 能力 | API |
|---|---|
| 观察/修改生命周期 | `pi.on(eventName, handler)` |
| 注册模型可调用工具 | `pi.registerTool(definition)` |
| 注册 `/` 命令 | `pi.registerCommand(name, options)` |
| 注册快捷键 / CLI flag | `pi.registerShortcut()` / `pi.registerFlag()` |
| 发送用户消息 / 自定义消息 | `pi.sendUserMessage()` / `pi.sendMessage()` |
| 持久化非上下文数据 | `pi.appendEntry(customType, data)` |
| 会话控制（工具集/模型/思考级别） | `pi` 上的控制方法（setActiveTools 等） |
| 注册模型供应商 | `pi.registerProvider()` |
| 注册 MCP 服务器 | `pi.registerMcpServer(name, config)` |
| 请求级模型路由 | `pi.registerVirtualModel()` |
| 终端渲染 | renderer 注册 + `ctx.ui` |
| 扩展间通信 | `pi.events` |

先建立三组概念，细节章节分配如下：

- **工具**：第 14 章（`defineTool`、结果与渲染、`ctx.executeTool` 嵌套调用）；
- **事件**：本章 13.3；
- **UI/模式**：本章 13.6 + 第 17 章。

### 13.2.1 注册工具的两行版

官方最小示例 `examples/extensions/hello.ts`：

```typescript
const helloTool = defineTool({
	name: "hello",
	label: "Hello",
	description: "A simple greeting tool",
	parameters: Type.Object({ name: Type.String({ description: "Name to greet" }) }),
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		return {
			content: [{ type: "text", text: `Hello, ${params.name}!` }],
			details: { greeted: params.name },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(helloTool);
}
```

对照第 7 章：`defineTool` = 第 7 章 `ToolDefinition` 的工厂；`registerTool` 把它接入会话的工具注册表。

### 13.2.2 ExtensionContext：钩子里的"世界入口"

事件处理器的第二个参数是 `ctx`（`ExtensionContext`），提供：

| 字段/方法 | 作用 |
|---|---|
| `ctx.cwd` | 当前工作目录 |
| `ctx.mode` | `"tui"` / `"rpc"` / `"json"` / `"print"`（模式判断） |
| `ctx.hasUI` | 交互模式或支持 UI 转发时可用 |
| `ctx.ui` | 弹窗、通知、状态、组件（13.6） |
| `ctx.sessionManager` | 会话读取（状态重建用） |
| `ctx.modelRegistry.streamSimple()` | **供应商中立的嵌套模型调用** |
| `ctx.signal` | 当前操作信号（有活动 turn 时） |
| `ctx.contextUsage()` 等 | 上下文用量与控制（压缩、shutdown） |

`CommandContext` 在此基础上加命令专属操作（前面 13.1.3 的三条规则）。**读扩展代码第一步：看它拿到的 ctx 是哪种、在哪个钩子里。**
## 13.3 事件系统精读

### 13.3.1 三条全局规则

`extensions.md` 的 "Events and concurrency" 开篇就给了三条规则，先记它们：

1. **顺序**：处理器按"扩展加载顺序 + 注册顺序"执行；
2. **可退订**：`pi.on()` 返回一个函数，调用它取消注册；**已经在派发中的事件不受影响**（改的是下一次派发）；
3. **语义按事件区分**：有的只是"通知"（返回值无效），有的能"变换数据 / 替换结果 / 取消操作"。**不要假设返回值都有用——以每个事件的类型声明为准。**

一个写法示例（读别人扩展时最常见不过的模式）：

```typescript
const unsubscribe = pi.on("tool_call", async (event, ctx) => { /* ... */ });

export function dispose() {
	unsubscribe();     // 会话结束/重载前的清理
}
```

### 13.3.2 `before_agent_start`：改提示词的正确姿势

> `before_agent_start` exposes both the current prompt and its structured `systemPromptOptions`.
> Prefer changing prompt sections, selected tools, or guidelines so Pi can append a transcript
> delta. Returning `systemPrompt`, or setting `forceSystemPrompt`, replaces the whole prompt
> for that run while the transcript continues recording the structured sections. Providers
> receive the forced text as their leading system prompt.

翻译成两个选项：

| 做法 | 后果 |
|---|---|
| 改 `systemPromptOptions`（sections / selectedTools / guidelines） | **增量补丁**：转录里追加"系统消息分节更新"，可回放、缓存友好 |
| 返回 `systemPrompt` / 设置 `forceSystemPrompt` | **整体替换**（本次 run 内）：不可补丁；转录里记录的结构分节继续存在，但供应商收到强制文本 |

选择标准与第 10 章一致：**能分节就分节**。仓库示例 `prompt-customizer.ts`、`system-prompt-header.ts` 可以对照读。

### 13.3.3 消息与工具钩子：`message_end`、`tool_call`、`tool_result`

- **`message_end`**：可以**替换已定稿的消息**（保持 role 不变）。典型用途：脱敏、注入签名、改写文本；
- **`tool_call`**：在工具执行前的拦截点——**可以修改 `event.input`（参数）或返回 `{ block: true, reason }` 阻止执行**。这是权限系统的挂载点（13.7 的两个官方示例都在这）；
- **`tool_result`**：**组合式**——多个处理器依次执行，**后一个看到前一个的修改**。典型用途：结果脱敏、补充 `details`。

与第 7 章对照：`tool_call` 钩子对应 `beforeToolCall` 的语义（`block`/`reason`），`tool_result` 对应 `afterToolCall`。扩展系统把它们暴露成事件，同时支持"多扩展接力"。

### 13.3.4 `context` 与 `context_with_system`：变换对话的两种强度

> `context` transforms conversation messages without prompt and tool system messages;
> Pi restores that state afterward. Use `context_with_system` only when a request-local
> transformation must own the complete transcript, and keep a system message at index zero.

- **`context`（推荐）**：只能动"对话消息"，不能动系统提示/工具声明部分——Pi 事后会恢复状态，所以它是**请求局部**变换（典型的"给模型补充临时材料"场景）；
- **`context_with_system`（慎用）**：拿整个转录（含系统消息），你负责保持"索引 0 是系统消息"这个不变量。用它的人通常是深度定制上下文的扩展。

### 13.3.5 两个"可行动边界"：`turn_end` 与 `agent_before_settle`

> `turn_end` and `agent_before_settle` are actionable boundaries. Their handlers can chain
> proposed `custom`, `custom_message`, `context_edit`, or `compaction` entries and return
> `continue: true` for one next model request. Guard continuation conditions because an
> unconditional continuation can loop.

对照第 6 章：这就是 `finishTurn` 与"settle 前边界"的扩展接口。两个细节：

- 可以"链式提议条目"：自定义消息、上下文编辑、压缩——它们会**按提议顺序**进入下一轮；
- **`continue: true` 只换来"一次"额外的模型请求**；而且**必须自带收敛条件**——无条件 continue 会无限循环（第 6.4.4 节已经证明过这一点）。

### 13.3.6 其它高频钩子速览

| 事件 | 语义 |
|---|---|
| `input` | 用户输入进入系统前的第一站：可 `transform`（改写）、`handled`（接管，不发给模型）、`continue`（放行）。**扩展命令优先于模板展开**的原因就在这 |
| `provider_stream_event` | 每个供应商流事件（归一化前）的**只读通知**：给调试/观测用；**被 await**，慢处理器会拖慢流；错误不影响供应商响应；**不持久化**（示例：`debug-provider.ts`） |
| `cache_warming_decision` | 覆盖空闲缓存预热：`{ action: "warm" / "stop" }`；**最后一个返回动作的处理器获胜** |
| `user_bash` | 拦截用户 `!` 命令：返回 `undefined` 放行（下一个处理器→本地执行）；返回 `operations` 或 `result` 停止传播；**处理器抛错会直接阻止命令**（不会回落本地执行） |
| `session_start` / `session_shutdown` | 会话生命周期（13.4） |
| `session_before_switch` / `session_before_fork` | 替换/分叉前的可取消点（第 8 章） |
| `project_trust` | 信任决策（第 11 章；仅用户级/CLI 扩展可参与） |
| `session_before_compact` / `session_compact_failed` / `session_before_tree` | 摘要系统（第 10 章） |

### 13.3.7 并发下的两条纪律

> Tool calls from one assistant message can run in parallel. Do not assume a sibling call or
> result exists when another tool event runs.

也就是说：在 `tool_call` A 的处理器里，**不要假设**同批次的 B 已经/尚未执行——只能依赖你自己维护的状态与锁。第二条：

> Use `ctx.signal` for nested work owned by an active turn; commands and idle session events often have no operation signal.

嵌套模型调用/子任务要传 `ctx.signal`（可取消）；但**命令与空闲期事件往往没有信号**——这类代码要自己处理"无法取消"的情况。

## 13.4 生命周期与资源：工厂只注册，资源随会话

`extensions.md` 的 "Respect the runtime lifecycle" 是本节的权威来源，原文照抄 + 解读：

```text
Do not start processes, sockets, watchers, or timers in the factory because some invocations
load extensions without starting a session.
```

**为什么？** `pi --version` / `--list-models` 这类调用也会加载扩展（第 3.4.2 节：版本检查发生在建会话之前），但并不进入会话。工厂里启动的资源没有任何"会话"可依附，只会白占。

```text
Start long-lived resources from `session_start` or from the command or tool that needs them.
Close session-scoped resources from an idempotent `session_shutdown` handler.
```

正确模式（心智模板）：

```typescript
export default function (pi: ExtensionAPI) {
	let watcher: FSWatcher | undefined;       // 会话级资源
	let unsubscribe: (() => void) | undefined;

	pi.on("session_start", async (_event, ctx) => {
		watcher = fs.watch(ctx.cwd, () => { /* ... */ });
		unsubscribe = someEventBus.subscribe(/* ... */);
	});

	pi.on("session_shutdown", async () => {
		watcher?.close(); watcher = undefined;      // 幂等：重复调用无害
		unsubscribe?.(); unsubscribe = undefined;
	});
}
```

最后两条纪律（"Errors and cleanup"）：

- **清理必须幂等**：取消、重载、会话替换、进程退出可能**汇聚到同一路径**——`session_shutdown` 可能被多次以不同原因触发（第 8 章：`why` 有 `new`/`resume`/`fork`/`quit`）；
- `ctx.shutdown()` 请求**有序退出进程**（用于"扩展决定该退出"的场景，如 CLI 交互收尾）。

### 13.4.1 run 的事件全景（放进第 4、6 章的图里）

```text
input → before_agent_start
  → agent_start
    → turn_start → message_*（user/assistant）→ tool_call → tool 执行 → tool_result
      → turn_end
    （retry / recovery / compaction / 排队可能在期间或之后发生）
  → agent_end →（agent_before_settle → agent_settled）
```

`agent_before_settle` 是**最后一个可行动点**（能追加条目、请求一次继续）；`agent_settled` 是**最终通知**（只读）——集成方靠它判断"pi 真的不会再自动继续了"。
## 13.5 状态管理：四种存储，四种语义

`extensions.md` 的 "State" 表格是"状态该放哪"的决策表：

| 状态类型 | 存储方式 | 特点 |
|---|---|---|
| 跟随活动分支的工具状态 | 工具结果的 `details` | 随树走：切分支即切换状态（第 9 章） |
| 持久但不进模型上下文的扩展数据 | `pi.appendEntry(customType, data)` | 写 `custom` 条目；UI/导出可见，模型不见 |
| 要保存且要发给模型的自定义内容 | `pi.sendMessage(...)` | 写 `custom_message`；转成 user 消息进上下文 |
| 跨会话/跨机器的数据 | 外部存储（文件、数据库、服务） | 扩展自己管理 |

与之配对的两条实现纪律：

- **重建分支敏感状态，从 `ctx.sessionManager.getBranch()` 开始**（在 `session_start` 里）；

> Reconstruct branch-sensitive state from `ctx.sessionManager.getBranch()` during `session_start`.
> Do not rebuild it from every file entry because abandoned branches represent alternative histories.

  最后一句话是本仓库的核心世界观之一：**磁盘上的被放弃分支不是"历史"而是"另一条时间线"**。全量重放会把它们错误地合并进来。

- **自定义条目要能渲染**：注册 entry/message renderer，否则界面里看不见（第 17 章的渲染机制）。

## 13.6 UI 与模式：扩展要在四种模式下都活着

扩展会加载到**四种模式**：interactive（完整终端 UI）、RPC、JSON、print（后两者**没有 UI**）。能力矩阵（`extensions.md`）：

| 能力 | interactive | RPC | JSON / print |
|---|---|---|---|
| 弹窗/通知 | 完整 | 可转发支持的对话框与通知（RPC Extension UI 协议） | 无 |
| 自定义终端组件（`ctx.ui.custom()`） | 有 | **不**支持 | 无 |
| 事件/工具逻辑 | 有 | 有 | 有 |

写扩展的两条纪律：

```typescript
// 1. 终端专属行为要显式设防
if (ctx.mode === "tui") { /* 自定义组件 */ }

// 2. 交互与 RPC 都支持的交互用 hasUI 判断
if (ctx.hasUI) { const ok = await ctx.ui.select(...); }
else { /* 非交互：默认拒绝/跳过 */ }
```

`permission-gate.ts` 的处理是标准答案：

```typescript
if (isDangerous) {
	if (!ctx.hasUI) {
		// In non-interactive mode, block by default
		return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
	}
	const choice = await ctx.ui.select(`⚠️ Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);
	if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
}
```

**没有 UI 时"默认阻止"（fail-safe）**——安全功能在无交互环境不能降级成"默认放行"。

最后一条设计准则（"Keep tool and event behavior independent from rendering so non-interactive modes remain functional."）：**把逻辑与渲染分开**——工具在 print 模式下也要能跑。

## 13.7 官方示例精读（挑四个最能说明问题的）

### 13.7.1 `permission-gate.ts`：危险命令确认

- 危险模式用正则枚举（`rm -rf`、`sudo`、`chmod/chown 777`）；
- 挂 `tool_call`、只关心 `bash`；
- 无 UI → 阻止并给出原因；有 UI → 询问；用户拒绝 → 阻止；
- 放行时返回 `undefined`（下一个处理器继续）。

对照第 7 章：返回值最终落到 `BeforeToolCallResult`（`block`/`reason`），模型会收到"被阻止"的错误结果——**整条链闭合**。

### 13.7.2 `protected-paths.ts`：写保护

- 需要保护的是 `.env`、`.git/`、`node_modules/`；
- 挂 `tool_call`、只关心 `write`/`edit`；
- 命中即阻止（顺带 `notify` 提醒）；
- 简单直接，无需任何 UI。

这两个示例合起来就是"权限门"的最小实现——你毕业项目的候选 A（只读扩展）可以先从它们的模式里抄。

### 13.7.3 `input-transform.ts`：输入拦截的三种动作

```typescript
pi.on("input", async (event, ctx) => {
	// 扩展自己注入的消息不再处理（防止递归）
	if (event.source === "extension") return { action: "continue" };

	// ① 变换：?quick 前缀 → 改写为"简短回答"的指令
	if (event.text.startsWith("?quick ")) {
		return { action: "transform", text: `Respond briefly in 1-2 sentences: ${event.text.slice(7).trim()}` };
	}
	// ② 接管：ping/time 直接本地响应，不调用模型
	if (event.text.toLowerCase() === "ping") {
		ctx.ui.notify("pong", "info");
		return { action: "handled" };
	}
	// ③ 放行
	return { action: "continue" };
});
```

三种动作对应三种语义：**transform（改写后继续走流程）/ handled（到此为止）/ continue（放行给后面的处理器）**。这也是"扩展命令优先于模板"的实现处——输入先经过这里，才轮到技能/模板展开（第 12.3.2 节）。

### 13.7.4 `reload-runtime.ts`：命令才能 reload

```typescript
export default function (pi: ExtensionAPI) {
	pi.registerCommand("reload-runtime", {
		description: "Reload extensions, skills, prompts, themes, and context files",
		handler: async (_args, ctx) => {
			await ctx.reload();
			return;                      // reload 之后视作终止
		},
	});

	pi.registerTool({
		name: "reload_runtime",
		label: "Reload Runtime",
		description: "Reload extensions, skills, prompts, themes, and context files",
		parameters: Type.Object({}),
		async execute() {
			// 工具拿不到 CommandContext：把命令排成 follow-up
			pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
			return { content: [{ type: "text", text: "Queued /reload-runtime as a follow-up command." }], details: {} };
		},
	});
}
```

它同时演示了三件事：**命令上下文的特权**（`ctx.reload()` 只能从命令调）、**工具上下文的限制**、以及**用 `sendUserMessage(deliverAs: "followUp")` 做"回合间调度"**（第 6 章的队列语义）。

## 13.8 实验 L08（第一部分）：完成第一个扩展

**实验性质**：本地运行；用 faux 或纯命令路径验证（不需要真实模型）。
**验证状态**：设计中。第 14 章会做下半部分（工具型扩展 + 打包）。

### 目标

做一个 `practice-status` 扩展：一个命令 + 一个只读工具 + 会话状态，并验证加载、失败提示与重载行为。

### 步骤

1. 建文件（临时目录）`practice-status.ts`，先照抄 hello 结构：
   - 命令 `/practice-status`：`ctx.ui.notify` 输出"当前计数 + 提示"；
   - 工具 `practice_note`：参数 `{ note: string }`，把 note 存入 `pi.appendEntry("practice-note", { note })`，并返回文本结果；
   - `session_start`：从 `ctx.sessionManager.getBranch()` 读出所有 `custom` 条目里 `customType === "practice-note"` 的 note，恢复计数；顺便演示"不用全量 entries、只看活动分支"。
2. 用源码方式加载：`pi-test.ps1 -e ./practice-status.ts`（或 `pi --extension`）；
3. 触发失败：让工具在 `note` 为空时 `throw new Error("empty note")`，观察模型侧收到的是 `isError` 结果（用 faux 测试或直接肉眼观察界面）；
4. 重载验证：改一下命令输出文案，执行 `/reload`（或第 13.7.4 的 `/reload-runtime`），确认行为更新；
5. 泄漏验证：在事件处理器里打计数日志，**连续 reload 两次**再触发一次事件，确认每次事件只打印一次（而不是叠加三次）。

### 观察与思考

- 两次 reload 后旧订阅如果没有退订，日志会怎样异常？
- `session_shutdown` 在该实验里需要清理什么？为什么要求幂等？
- 非交互模式（`pi -p "..."`）里执行你的命令会发生什么？（提示：命令只在交互/RPC 有入口，但工具在任何模式都会加载）

### 清理

删除实验扩展文件；确认没有把 `custom` 数据写进你重要的会话（实验会话可删除）。

## 13.9 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动变慢/莫名多出后台进程 | 工厂里启动了长驻资源 | 移到 `session_start` 或首次使用处 |
| 重载后事件处理两次/三次 | 旧订阅没退订 | 保存 `pi.on()` 返回值，在 shutdown/reload 时调用 |
| 工具里调 `ctx.reload()` 报错 | 工具只有 `ExtensionContext` | 用命令，或 `sendUserMessage` 排 follow-up（13.7.4） |
| `tool_result` 的修改"丢了" | 处理器顺序理解错/前一个覆盖后一个 | 记住组合语义：按注册顺序传递，最后一个改动生效 |
| 全体阻塞：`tool_call` 处理器抛错 | 失败按 fail-safe 阻止工具 | 处理器内部 try/catch；把"拒绝"用 `{ block: true, reason }` 表达 |
| continue 后无限循环 | `turn_end`/`agent_before_settle` 无条件 continue | 加收敛条件/计数上限 |
| print 模式下扩展行为异常 | 依赖了 UI 或终端能力 | `ctx.mode`/`ctx.hasUI` 分支；逻辑与渲染分离 |
| 缓存预热莫名触发/不触发 | `cache_warming_decision` 是"最后一个动作获胜" | 明确返回值语义；不处理就返回 undefined |
| 并行工具下状态竞态 | 假设同批 sibling 已执行 | 用自维护状态与显式队列（`withFileMutationQueue` 同理） |
| 扩展注入的消息被自己再次拦截 | 没检查 `event.source === "extension"` | 参见 `input-transform.ts` 的防递归写法 |

## 13.10 验收题

1. `pi.on()` 的返回值是什么？"改动不影响进行中的派发"意味着什么？
2. 同样是改系统提示，`before_agent_start` 里"改 sections"与"forceSystemPrompt"有什么区别与代价？
3. `tool_call` 与 `tool_result` 的语义差异？各自能做什么、不能做什么？
4. `context` 与 `context_with_system` 的使用边界？后者的硬性不变量是什么？
5. `turn_end` 里返回 `continue: true` 的行为边界是什么？为什么必须自带收敛条件？
6. 一个扩展要读一个文件监视器（fs.watch），应在哪创建、哪里释放？为什么清理必须幂等？
7. 四种模式里，扩展的哪些能力可用性不同？用哪两个字段判断？

### 参考答案（要点）

1. 返回"退订函数"；正在进行的派发使用"派发开始时的处理器快照"，因此新增/移除处理器只影响后续事件。
2. 改 sections：增量补丁（可回放、缓存友好）；forceSystemPrompt/systemPrompt 返回：本次 run 整体替换（不可补丁，供应商直接收到强制文本）。
3. `tool_call` 在**执行前**：可改参数、可 `block`（fail-safe）；`tool_result` 在**执行后**：组合式改写，后处理者看到前处理者的修改。取消/重写结果不适用于执行前，阻止执行不适用于执行后。
4. `context`：只动对话消息（系统部分由 Pi 保护，事后恢复）；`context_with_system`：必须自己保证完整转录且 index 0 是系统消息。
5. 只换来**一次**额外的模型请求；无条件 continue 会形成"每次请求又要求继续"的循环（第 6 章已论证）。
6. `session_start` 创建（或首次使用处惰性创建）；`session_shutdown` 释放；因为 `session_shutdown` 可能因取消/重载/替换/退出以不同原因多次到达同一路径。
7. 差异在 UI：interactive 完整；RPC 可转发支持的对话框/通知但不能自定义组件；JSON/print 无 UI。用 `ctx.mode`（终端专属）与 `ctx.hasUI`（交互可用性）判断。

## 13.11 来源与下一章

- `packages/coding-agent/docs/extensions.md`（创建、位置、生命周期、事件与并发、工具、渲染、MCP、上下文、状态、UI、错误清理）；
- 示例：`examples/extensions/hello.ts`、`permission-gate.ts`、`protected-paths.ts`、`input-transform.ts`、`reload-runtime.ts`、`debug-provider.ts`、`prompt-customizer.ts`；
- 源码：`packages/coding-agent/src/core/extensions/`（`types.ts` 82KB 类型、`runner.ts` 派发实现、`loader.ts` 加载、`jiti-loader.ts`）；
- 相关章节：第 6 章（finishTurn/settle）、第 7 章（工具钩子）、第 10 章（压缩钩子）、第 11 章（信任钩子）。

下一章把"工具型扩展"做成可交付的形态：`defineTool` 的完整字段、结构化输出、渲染、嵌套调用、依赖与 Pi package 组织——并完成 `inspect_package` 工具。