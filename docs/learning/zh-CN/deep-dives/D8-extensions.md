# D8：扩展系统逐段精读

> 精读对象：`core/extensions/types.ts`（82KB，类型总集）与 `core/extensions/runner.ts`（51KB，派发实现）的**关键段**。
> 对应主线：第 13 章（Extension API、加载与事件）、第 14 章（工具型扩展）。
> 说明：`types.ts` 有几百个类型——本篇不复述全部，只精读"扩展作者每天用的那一圈"与"runner 的派发语义"。查全量定义请直接搜 `types.ts` 的符号。

---

# 第一部分：类型总集（扩展作者视角）

## 0. 文件地图

```text
types.ts 里的五圈东西：
① 上下文       ExtensionContext / ExtensionToolContext / ExtensionCommandContext / ReplacedSessionContext
② 能力面       ExtensionAPI（50+ 个 on() 重载 + 注册方法 + 会话控制动作）
③ 工具与渲染   ToolDefinition / defineTool / ToolExposure / ToolLoadout / 各 renderer 类型
④ 事件族       每个事件一个 interface（Session*/Context*/Provider*/Agent*/Message*/Tool*/Input 等）
⑤ 结果类型     与事件配对的 *Result（改数据/拦截/续跑的形状）
runner.ts 里的四件事：
构造与绑定（bindCore）→ 查表（hasHandlers/getXxx）→ 派发（emit/emitXxx 家族）→ 错误与诊断
```

【陷阱】类型文件名"types"，但它同时导出**值**（`defineTool`、若干 type guard、`normalizeBuildSystemPromptOptions` 的 re-export）——**这个仓库不以文件名区分"类型文件/值文件"**，以导出内容为准（第 1.2.2 节的 `import type` 判断法在这里最有用）。

## 1. 四个"上下文"

### 1.1 `ExtensionContext`：钩子里的世界入口

【源码（完整）】

```typescript
export interface ExtensionContext {
	/** UI methods for user interaction */
	ui: ExtensionUIContext;
	/** Current run mode. Use "tui" to guard terminal-only UI such as custom components. */
	mode: ExtensionMode;
	/** Whether dialog-capable UI is available (true in TUI and RPC modes) */
	hasUI: boolean;
	/** Current working directory */
	cwd: string;
	/** Session manager (read-only) */
	sessionManager: ReadonlySessionManager;
	/** Model registry for API key resolution */
	modelRegistry: ModelRegistry;
	/** Current model (may be undefined) */
	model: Model<any> | undefined;
	/** Models scoped to this session (...). Read-only snapshot. */
	scopedModels: readonly ScopedModel[];
	/** Current thinking level, when provided by the session runtime. */
	thinkingLevel?: ThinkingLevel;
	/** Whether the agent is idle (not streaming) */
	isIdle(): boolean;
	/** Whether project-local trust is active for this context. */
	isProjectTrusted(): boolean;
	/** The current abort signal, or undefined when the agent is not streaming. */
	signal: AbortSignal | undefined;
	/** Abort the current agent operation */
	abort(): void;
	/** Whether there are queued messages waiting */
	hasPendingMessages(): boolean;
	/** Gracefully shutdown pi and exit. Available in all contexts. */
	shutdown(): void;
	/** Get current context usage for the active model. */
	getContextUsage(): ContextUsage | undefined;
	/** Trigger compaction without awaiting completion. */
	compact(options?: CompactOptions): void;
	/** Get the current effective system prompt. */
	getSystemPrompt(): string;
}
```

【注解（五组）】

1. **UI**：`ui`（第 13.6 节的能力集）、`mode`（`"tui" | "rpc" | "json" | "print"`）、`hasUI`（TUI/RPC 为真）——三者的关系：**能用什么**看 `ui` 的实现与 `hasUI`，**能不能用终端组件**看 `mode === "tui"`。
2. **会话数据（只读）**：`sessionManager`（`ReadonlySessionManager` 类型——**类型层面禁止你写会话**）、`cwd`。
3. **模型元信息（只读快照）**：`modelRegistry`（解析 key 用）、`model`（可 undefined）、`scopedModels`（本会话的模型作用域快照）、`thinkingLevel?`。注释点名"Read-only snapshot"——**不要把它当作能随会话变化的实时列表**（要变更走 `pi.setModel` 等动作）。
4. **状态查询（函数形式）**：`isIdle()`、`isProjectTrusted()`、`hasPendingMessages()`、`getContextUsage()`、`getSystemPrompt()`、`signal`——【陷阱】为什么是**函数**而不是字段？因为要**读取当下值**：字段快照会把"钩子捕获时"的状态冻结；函数调用保证"你调用那一刻"的状态。这与 D2 的"配置点快照 vs 动态读设置"是同一权衡的两端。
5. **动作（有副作用）**：`abort()`、`shutdown()`、`compact()`（注释："Trigger compaction without awaiting completion"——**不 await**，想等结果就监听 `compaction_end` 事件）。

### 1.2 三个派生上下文

【源码（节选）】

```typescript
export interface ExtensionToolContext extends ExtensionContext {
	/** Tools {@link executeTool} can call. */
	readonly tools: readonly AgentTool[];
	/**
	 * Run another tool. The call gets the id `<calling id>/<n>`, and the `tool_call`, `tool_result`,
	 * and `tool_execution_*` events carry `parentToolCallId`. It does not appear in the transcript;
	 * a bounded record of it is kept as `nestedCalls` on the calling tool's result message.
	 * Never rejects for tool failures: ...
	 */
	executeTool(name: string, args: unknown, options?: ExecuteToolOptions): Promise<AgentToolCallOutcome>;
}
```

【注解】

- **工具上下文 = 基础上下文 + 嵌套调用能力**（第 14.4 节精读过 `runToolCall`——这里是它的暴露面）。
- 文档注释把嵌套调用的四条事实一次说全：**id 规则**（`<calling id>/<n>`）、**事件带 `parentToolCallId`**、**不进转录**（"It does not appear in the transcript"）、**`nestedCalls` 有界记录**（第 18.4.2 节的断言对象）。
- 【陷阱】"不进转录"与"nestedCalls 在结果消息上"不矛盾：转录里只有**外层工具的结果消息**；嵌套记录**挂在它的字段里**（所以恢复会话也能看到嵌套调用史）。
- `ExtensionCommandContext`（命令专用）：在基础上下文上**加命令专属动作**（`waitForIdle`、`reload`、树导航、会话替换——第 13.1.3 节的"特权"）；`ReplacedSessionContext` 是"替换完成回调"里给的新上下文（第 8.6 节）。

## 2. `ExtensionHandler` 与 `ExtensionAPI`

### 2.1 处理器的统一签名

【源码】

```typescript
export type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;
```

【注解】

- 泛型两参：**事件类型 `E` 与返回值类型 `R`**。返回 `R | void`——"可以改数据（R），也可以只是看看（void）"；同步或异步均可。
- 【陷阱】`R` 的默认值是 `undefined`——**不是所有事件都能改东西**（第 13.3.1 节的三分法：通知/变换/拦截）。读 `on()` 重载时，**看第二个泛型参数**就知道该事件"有没有返回值效果"：
  - `ExtensionHandler<SessionStartEvent>`（无 R）→ 纯通知；
  - `ExtensionHandler<SessionBeforeSwitchEvent, SessionBeforeSwitchResult>` → 有 `{cancel}` 结果；
  - `ExtensionHandler<ToolCallEvent, ToolCallEventResult>` → 有拦截/改参结果。

### 2.2 `on()` 重载清单：一页纸看全事件面

【源码（重载的"目录"，按族整理）】

```typescript
// 资源与信任
on(event: "project_trust", handler: ProjectTrustHandler): () => void;
on(event: "resources_discover", handler: ExtensionHandler<ResourcesDiscoverEvent, ResourcesDiscoverResult>): () => void;

// 会话生命周期
on(event: "session_start", ...): () => void;
on(event: "session_info_changed", ...): () => void;
on(event: "session_before_switch", ... SessionBeforeSwitchResult): () => void;
on(event: "session_before_fork", ... SessionBeforeForkResult): () => void;
on(event: "session_before_compact", ... SessionBeforeCompactResult): () => void;
on(event: "session_compact", ...): () => void;
on(event: "session_compact_failed", ...): () => void;
on(event: "session_shutdown", ...): () => void;
on(event: "mcp_servers_change", ...): () => void;
on(event: "session_before_tree", ... SessionBeforeTreeResult): () => void;
on(event: "session_tree", ...): () => void;

// 上下文变换
on(event: "context", ... ContextEventResult): () => void;
on(event: "context_with_system", ... ContextEventResult): () => void;
on(event: "cache_warming_decision", ... CacheWarmingDecisionEventResult): () => void;

// 供应商
on(event: "before_provider_request", ... BeforeProviderRequestEventResult): () => void;
on(event: "before_provider_headers", ...): () => void;
on(event: "after_provider_response", ...): () => void;
on(event: "provider_stream_event", ...): () => void;

// Agent / 轮次 / 消息
on(event: "before_agent_start", ... BeforeAgentStartEventResult): () => void;
on(event: "agent_start" / "agent_end" / "agent_settled", ...): () => void;
on(event: "agent_before_settle", ... AgentBeforeSettleEventResult): () => void;
on(event: "ui_prompt_start" / "ui_prompt_end", ...): () => void;
on(event: "turn_start", ...): () => void;
on(event: "turn_end", ... TurnEndEventResult): () => void;
on(event: "message_start" / "message_update", ...): () => void;
on(event: "message_end", ... MessageEndEventResult): () => void;

// 工具
on(event: "tool_execution_start" / "tool_execution_update" / "tool_execution_end", ...): () => void;
on(event: "model_select" / "thinking_level_select", ...): () => void;
on(event: "tool_call", ... ToolCallEventResult): () => void;
on(event: "tool_result", ... ToolResultEventResult): () => void;

// 用户输入
on(event: "user_bash", ... UserBashEventResult): () => void;
on(event: "input", ... InputEventResult): () => void;
```

【注解（按族对照前文）】

- **带 `Result` 的都是"可行动"事件**（变换/拦截/续跑）；不带的是通知。这是本文件最有信息量的"元规律"。
- 族与章节的对应：资源/信任（第 11 章）、会话生命周期（第 8 章）、上下文（第 10、13 章）、供应商（第 5 章）、Agent/轮次/消息（第 4、6 章）、工具（第 7、14 章）、输入（第 13.7.3 节）。
- 【陷阱】`on()` 的**返回类型永远是 `() => void`**（退订函数）——因为 `registerTool` 等**注册**类方法返回 void（一次性），而 `on` 是**订阅**（可撤销）。**"注册 vs 订阅"的差别只看返回值**。
- `project_trust` 用专门的 `ProjectTrustHandler`（不是泛型 `ExtensionHandler`）——因为它的**上下文参数不同**（`ProjectTrustContext`，第 11.5 节：只有受限 UI/模式字段）。**参数类型也是契约的一部分**。

### 2.3 注册与动作：`ExtensionAPI` 的其余能力（速览表）

| 方法 | 返回 | 关键语义 |
|---|---|---|
| `registerTool(tool)` | void | 注册工具（第 14 章） |
| `registerCommand(name, {description, handler})` | void | 注册 `/` 命令（`sourceInfo` 由 runner 填） |
| `registerShortcut(keyId, {description, handler})` | void | 注册快捷键（`KeyId`——与第 17.9 节的键位系统衔接） |
| `registerFlag(name, {type, default})` | void | 注册 CLI 选项（`getFlag` 读值；帮助里出现） |
| `registerMessageRenderer(customType, renderer)` | void | 给自定义消息条目渲染 |
| `registerMarkdownTransformer(transformer)` | void | 渲染前改写 Markdown（终端展示用，**不改发给模型的内容**） |
| `registerEntryRenderer(customType, renderer)` | void | 自定义条目（`custom` 条目）的渲染 |
| `registerToolRenderer(resolver)` | void | 工具渲染决议器（第 14.5.1 节的 `next()` 链） |
| `sendMessage(msg, {triggerTurn?, deliverAs?})` | void | 注入自定义消息（`nextTurn` 是第三种排队语义！） |
| `sendUserMessage(content, {deliverAs?, expandPromptTemplates?})` | void | 注入用户消息；`expandPromptTemplates: true` 会走命令/技能/模板展开（第 13.7.4 节的 reload 工具就靠它） |
| `appendEntry(customType, data?)` | void | 追加 `custom` 条目（不进上下文，第 13.5 节） |
| `setSessionName(name)` / `getSessionName()` | void / string? | 会话命名（`session_info` 条目） |
| `setLabel(entryId, label?)` | void | 书签（`label` 条目） |
| `exec(command, args, options?)` | Promise | 执行外部命令（`ExecOptions`/`ExecResult` 在 `core/exec.ts`） |
| `getActiveTools()` / `setActiveTools(names)` | string[] / void | 活动工具集（声明侧）；`hidden` 工具被忽略、codemode/deferred 工具照样可从脚本调用（注释原文） |
| `getAllTools()` | ToolInfo[] | 全部工具元信息（含参数 schema/指引/exposure/来源） |
| `getSettings()` | Settings | 合并后的设置**副本** |
| `getCommands()` | SlashCommandInfo[] | 当前会话的斜杠命令清单 |
| `setModel(model)` | Promise\<boolean\> | 会话模型（**不动默认**；认证缺失返回 false） |
| `getThinkingLevel()` / `setThinkingLevel(level)` | …… | 会话思考级别（钳制到模型能力） |
| `registerProvider(name, config)` | void | 注册供应商（注释讲清了 `models`/`baseUrl`/`oauth`/`streamSimple` 的四种用法；**初始加载期排队、绑定后即时生效**——第 8.3.2 节的 pendingProviderRegistrations） |
| `registerMcpServer(name, config)` / `unregisterMcpServer` | void | MCP 服务器注册（第 22.2 节） |
| `registerVirtualModel(definition)` | void | 虚拟模型（按请求路由，第 5 章） |

【陷阱】表格里藏着三个"排队语义"的扩展点：
1. `sendMessage` 的 `deliverAs: "nextTurn"`——**第三种**入队行为（不同于 steer/followUp；读第 6 章时没讲过它，因为它只从扩展侧产生）；
2. `sendUserMessage` 的 `expandPromptTemplates`——**把文本再走一遍输入管线**（命令/技能/模板）；
3. `registerProvider` 的"初始加载期排队"——**加载器与 runner 的时序协商**（下面的 runner 段会看到 queue 的实现）。

### 2.4 `defineTool` 的类型视角（第 14 章已精读实现）

【源码（签名）】

```typescript
export function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
	tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition;
```

【注解】

- **泛型三参**：`TParams`（参数 schema）、`TDetails`（结果的 details 类型）、`TState`（**渲染状态**——第 14.5 节 `ToolRenderContext.TState`；渲染器可以在多次渲染间保存状态）。
- 返回 `ToolDefinition & AnyToolDefinition`——**"保留精确类型 + 满足通配注册形状"的交叉**：注册表按 `AnyToolDefinition` 收，作者拿到精确类型（`execute` 的 params/details 都有类型）。
- 【陷阱】`defineTool` 是**恒等函数**（运行时不做任何事，可能仅返回原对象）——它的全部价值在类型推断。这类"类型工具函数"在本仓库还有 `defineTelemetrySchema`（D4/第 25 章）——**读到时不要找运行时代码，它不存在**。

## 3. 事件族与结果类型：命名规律

```text
事件名                 → 事件接口                        → 结果接口（若有）
session_before_*       → SessionBefore*Event            → SessionBefore*Result（[]含 cancel/自定义）
session_start/...      → SessionStartEvent ...          → （无）
context/context_with_system → ContextEvent/...          → ContextEventResult
before_provider_request→ BeforeProviderRequestEvent     → BeforeProviderRequestEventResult
tool_call              → ToolCallEvent                   → ToolCallEventResult
tool_result            → ToolResultEvent                 → ToolResultEventResult
message_end            → MessageEndEvent                 → MessageEndEventResult
input                  → InputEvent                      → InputEventResult
```

【注解】

- **命名三件套**（`XxxEvent` / `XxxEventResult` / `XxxHandler`）= 事件协议的标准形状。找任何一个事件的语义，就去看它的**文档注释 + 结果类型字段**（比读实现快）。
- 【跳转】结果类型的字段语义已在第 13.3 节逐条讲过（`block`/`reason`、`content` 替换、`continue`、`action`、`cancel` 等）；这里只提醒**查阅路径**：`types.ts` 搜事件名 → 读接口注释。

---

> D8 第一部分到此。第二部分：`runner.ts`——类的依赖注入（`bindCore`）、`hasHandlers`、`snapshotEventHandlers`、`emit`（错误隔离与 cancel 短路）、`emitCacheWarmingDecision`（last-wins）、`emitMessageEnd`（角色保持校验）、`resolveToolRenderers`（next 链）与总结。
---

# 第二部分：`runner.ts` 的派发实现

## 4. 类字段：默认值是"全空操作"

【源码（节选）】

```typescript
export class ExtensionRunner {
	private extensions: Extension[];
	private runtime: ExtensionRuntime;
	private uiContext: ExtensionUIContext;
	private mode: ExtensionMode = "print";
	private cwd: string;
	private sessionManager: SessionManager;
	private modelRegistry: ModelRegistry;
	private errorListeners: Set<ExtensionErrorListener> = new Set();
	private getModel: () => Model<any> | undefined = () => undefined;
	private getScopedModels: () => readonly ScopedModel[] = () => [];
	private isIdleFn: () => boolean = () => true;
	private isProjectTrustedFn: () => boolean = () => true;
	private getSignalFn: () => AbortSignal | undefined = () => undefined;
	private waitForIdleFn: () => Promise<void> = async () => {};
	private abortFn: () => void = () => {};
	private hasPendingMessagesFn: () => boolean = () => false;
	private getContextUsageFn: () => ContextUsage | undefined = () => undefined;
	private compactFn: (options?: CompactOptions) => void = () => {};
	private getSystemPromptFn: () => string = () => "";
	private getSystemPromptOptionsFn: () => BuildSystemPromptOptions = () => normalizeBuildSystemPromptOptions({ cwd: this.cwd });
	private executeToolFn: ExtensionContextActions["executeTool"];
	private getCallableToolsFn: () => readonly AgentTool[] = () => [];
	/** Registered MCP servers already reported as unhandled. */
	private readonly reportedMcpServers = new Set<string>();
	private newSessionHandler: NewSessionHandler = async () => ({ cancelled: false });
	private forkHandler: ForkHandler = async () => ({ cancelled: false });
	private navigateTreeHandler: NavigateTreeHandler = async () => ({ cancelled: false });
	private switchSessionHandler: SwitchSessionHandler = async () => ({ cancelled: false });
	private reloadHandler: ReloadHandler = async () => {};
	private shutdownHandler: ShutdownHandler = () => {};
	// ...（诊断、stale 消息、UI 提示计数等）
```

【注解（两类字段）】

- **直接持有的依赖**：`extensions`（扩展数组）、`runtime`（运行时状态：flag 值、注册队列等）、`uiContext`/`mode`/`cwd`/`sessionManager`/`modelRegistry`——构造器里从参数赋值。
- **"待注入"的函数指针**（`bindCore` 填）：注意**每个都有安全的默认值**：
  - 查询类默认"最保守诚实"：`getModel → undefined`、`getScopedModels → []`、`isIdleFn → true`、`isProjectTrustedFn → true`（未绑定时"视为已信任"？【陷阱】这是"绑定前没有人会问它"的假设——绑定前的调用是内部错误，但用宽松默认避免崩）、`getSignalFn → undefined`；
  - 动作类默认全空：`abortFn → () => {}`、`compactFn → () => {}`、`shutdownHandler → () => {}`；
  - 会话替换类默认"未取消的空结果"：`async () => ({ cancelled: false })`——**"没绑定 = 操作成功但没做事"**？——这防止"未绑定时调用替换会崩"，但语义上是有争议的；实际流程里绑定总是先于这些调用（读 `AgentSession` 的初始化和 `bindExtensions` 时序时验证）。
  - `getSystemPromptOptionsFn` 的默认**就地构造**一个"只有 cwd 的归一化选项"——比返回 undefined 更友好（调用方能拿到一个合法形状）。
- 【陷阱】**"默认全空操作 + 启动时统一绑定"**是本仓库的另一个高频模式（对比 `stream-fn.ts` 的 defaultStreamFn、缓存预热器的回调）。读到 `xxxFn` 字段时，找 `bindCore` 看它被换成什么，以及**绑定发生在哪个生命周期点**（太早/太晚会读出"钩子不生效"的 bug）。
- `reportedMcpServers`：去重集合（同一 MCP 没被任何扩展接管的警告只报一次——第 22.2 节的"报告一次"语义的小实现）。

## 5. `bindCore`：把"动作"注入进来

【源码（签名）】

```typescript
	bindCore(
		actions: ExtensionActions,
		contextActions: ExtensionContextActions,
		providerActions?: {
			registerProvider?: (name: string, config: ProviderConfig) => void;
			registerNativeProvider?: (provider: Provider) => void;
			unregisterProvider?: (name: string) => void;
			registerVirtualModel?: (definition: VirtualModelDefinition) => void;
			unregisterVirtualModel?: (provider: string, id: string) => void;
		},
	): void {
```

【注解】

- **三组动作**：
  1. `actions`（`ExtensionActions`）——会话级动作（发送消息、设置模型、append 条目等，第 2.3 节的表）；
  2. `contextActions`（`ExtensionContextActions`）——上下文级动作（`executeTool`、`getCallableTools`、会话替换等）；
  3. `providerActions`（**可选**）——供应商注册（第 5 章；作为可选组是因为"不带模型运行时的宿主"不需要它）。
- 【陷阱】把"谁需要谁"变成**分组参数**：runner 本身不 import 会话/模型实现（避免循环依赖，第 0 章的分层原则——`extensions` 目录被 `agent-session` 用，不能让 extensions 反向依赖会话）。**依赖注入在这里是解环的手段，不只是测试性**。
- 绑定后，`pi.registerProvider(...)` 的"加载期排队"被 flush（第 2.3 节注释说的 `pendingProviderRegistrations`——`createAgentSessionServices` 里消费它，第 8.3.2 节）。

## 6. `snapshotEventHandlers`：派发前先拍快照

【源码】

```typescript
function snapshotEventHandlers(extensions: Extension[], event: ExtensionEvent["type"]) {
	return extensions.map((ext) => ({ ext, handlers: ext.handlers.get(event)?.slice() ?? [] }));
}
```

【注解】

- 每次派发时构造 `[{ext, handlers}]` 数组：**扩展顺序保持**（load 顺序）；每个扩展的 handler 列表 `slice()` 复制。
- 复制解决两件事（第 13.3.1 节的契约）：
  1. 派发中途的注册/退订**不影响本轮**（遍历的是快照）；
  2. 循环里不担心迭代器失效（对比 D2 的"Set 实时遍历"【陷阱】——那里我们说过 Set 遍历能反映改动；**两个系统两种选择**，读代码时要分别记住）。
- 【陷阱】复制的只是**数组**（handler 函数的引用不变）——它不能保护"handler 内部状态被并发改"这类问题；快照解决的是**集合结构**的一致。

## 7. `hasHandlers`：快速门

【源码】

```typescript
	hasHandlers(eventType: string): boolean {
		for (const ext of this.extensions) {
			const handlers = ext.handlers.get(eventType);
			if (handlers && handlers.length > 0) {
				return true;
			}
		}
		return false;
	}
```

【注解】

- 线性扫描（扩展数×Map 查找），在**每个钩子点**被调用（比如 D5 的 `transformProviderPayload`：`runner?.hasHandlers("before_provider_request")`）——先用它短路，避免为"没人监听的事件"构造事件对象/上下文。
- 【陷阱】`eventType: string`（不是事件名联合）——运行时字符串；这与 `on()` 重载的强类型形成对比：**注册端强类型，查询端宽松**（内部实现不想被类型系统拖慢/复杂化）。这类"边界宽松、入口严格"的组合在性能敏感处常见。

## 8. `emit`：通用派发（含取消短路与错误隔离）

【源码】

```typescript
	async emit<TEvent extends RunnerEmitEvent>(event: TEvent): Promise<RunnerEmitResult<TEvent>> {
		const ctx = this.createContext();
		let result: SessionBeforeEventResult | undefined;

		for (const { ext, handlers } of snapshotEventHandlers(this.extensions, event.type)) {
			for (const handler of handlers) {
				try {
					const handlerResult = await handler(event, ctx);

					if (this.isSessionBeforeEvent(event) && handlerResult) {
						result = handlerResult as SessionBeforeEventResult;
						if (result.cancel) {
							return result as RunnerEmitResult<TEvent>;
						}
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					this.emitError({ extensionPath: ext.path, event: event.type, error: message, stack });
				}
			}
		}

		return result as RunnerEmitResult<TEvent>;
	}
```

【注解（四件事）】

1. **上下文只创建一次**（`const ctx = this.createContext()`）——该事件的所有 handler 共享一个 ctx 实例。这与 `ExtensionContext.isIdle()` 等**函数形式**呼应：ctx 可复用，因为查询走函数读"当下值"。
2. **逐 handler `await`**（顺序 = 扩展加载顺序 + 注册顺序）；同步 handler 的返回值直接拿到（await 一个非 Promise 立刻返回）。
3. **session_before_* 的取消短路**（`isSessionBeforeEvent` 列表：switch/fork/compact/tree 四种）：只要某个 handler 返回 `{cancel: true}`，**立即 return**——后面的 handler 不再跑。【陷阱】`result` 会被**后来的 handler 覆盖**（`result = handlerResult`），但 `cancel` 立即短路；如果没人 cancel，返回的是**最后一个**返回结果的 handler 的 result（"last-wins"合并）。这两条要分开记。
4. **错误隔离**：handler 抛错 → `emitError({extensionPath, event, error, stack})`（第 13.4 节的"报告并继续"）→ **循环继续**（不会让一个坏扩展阻断大家）。对照第 13.3.3 节：`tool_call` 的失败会阻止工具（在更专门的 emit 里处理），而通用 `emit` 只是"记录并继续"。

## 9. 三个专门 emitter：合并语义各不同

### 9.1 `emitCacheWarmingDecision`：最后一个动作获胜

【源码（节选）】

```typescript
	/** Returns the event's own action unless a handler overrides it; the last override wins. */
	async emitCacheWarmingDecision(event: CacheWarmingDecisionEvent): Promise<CacheWarmingAction> {
		const ctx = this.createContext();
		let action = event.action;

		for (const { ext, handlers } of snapshotEventHandlers(this.extensions, event.type)) {
			for (const handler of handlers) {
				try {
					const result = (await handler(event, ctx)) as CacheWarmingDecisionEventResult | undefined;
					if (result?.action !== undefined) action = result.action;
				} catch (err) { this.emitError({ ... }); }
			}
		}
		return action;
	}
```

【注解】

- 初始值 = **事件自带的建议动作**（`event.action`——第 5 章缓存预热器的建议）；每个返回 `action` 的 handler **覆盖**它（last-wins，注释原文）。
- 【陷阱】判定用 `result?.action !== undefined`（而不是 falsy）——动作值是 `"warm" | "stop"`，**都 truthy**，但显式判 undefined 更稳（防未来加入空串/0 类值）；且"没返回动作"与"返回未定义动作"被正确区分。

### 9.2 `emitMessageEnd`：替换消息 + 角色校验

【源码（节选）】

```typescript
	async emitMessageEnd(event: MessageEndEvent): Promise<AgentMessage | undefined> {
		const ctx = this.createContext();
		// ...
		for (const { ext, handlers } of snapshotEventHandlers(this.extensions, "message_end")) {
			for (const handler of handlers) {
				try {
					const handlerResult = await handler(currentEvent, ctx);
					// ...
				} catch (err) {
					this.emitError({ extensionPath: ext.path, event: "message_end", error: err.message });
				}
			}
		}
		// ... validation error path:
		this.emitError({ ..., error: "message_end handlers must return a message with the same role" });
	}
```

【注解（要点与陷阱）】

- **组合语义**：每个 handler 看到的是**上一位已接受修改后的消息**（第 13.3.3 节）。实现是在内层循环每次迭代时重建 `currentEvent = { ...event, message: currentMessage }`；handler 返回同角色的新 message 后更新 `currentMessage`，下一位 handler 因此读到更新后的对象。抛错或角色不匹配的返回值不会覆盖它。
- **角色校验失败的精确行为**：若某 handler 返回的 message.role 与当前消息不同，runner 调用 `emitError()` 报告错误，然后 `continue` 到下一个 handler；非法替换不采纳，也不会抛出中断派发。若前面已有合法替换，`currentMessage` 保持那份最新合法消息；若没有，最后 `modified` 仍为 false，runner 返回 `undefined`，会话保留 Agent 原消息。有效替换则由 `AgentSession._handleAgentEvent` 归一化缺失 content 后，原地写回 Agent 状态，再由既有 `message_end` 持久化路径保存。现有 `agent-session-runtime.test.ts` 的 `persists message_end assistant replacements to the session manager` 覆盖合法替换；本仓库未定位到专门断言“角色不一致后继续派发”的用例，因此该错误路径是源码静态核对结论。
- 返回值 `AgentMessage | undefined`：**无 handler/无人修改时返回 undefined**（调用方保持原消息）；有修改时返回新消息。第 3.7 节的 `Agent.processEvents` 并不直接调它——`message_end` 的消费在**会话层**（`_handleAgentEvent`，第 4 章的点表），因为"替换定稿消息"是应用行为。

### 9.3 `resolveToolRenderers`：`next()` 链

【源码】

```typescript
	/** Renderers of calls to `toolName`: extension resolvers in load order, then `base`. */
	resolveToolRenderers(toolName: string, base: () => ToolRenderers | undefined): ToolRenderers | undefined {
		const resolvers = this.extensions.flatMap((ext) => ext.toolRenderers ?? []);
		const resolve = (index: number): ToolRenderers | undefined =>
			index < resolvers.length ? resolvers[index](toolName, () => resolve(index + 1)) : base();
		return resolve(0);
	}
```

【注解】

- 把"决议器数组"变成**递归链**：第 0 个 resolver 收到 `next = () => resolve(1)`，第 1 个收到 `next = () => resolve(2)`……最后一个之后是 `base()`（工具自身/注册表）。
- 这就是第 14.5.1 节 `next() ?? mine` 的运行时本体：**填充式**渲染（只在没人提供时用你的），而不是覆盖式。
- 【陷阱】递归而非循环：`next()` 必须能**被调用多次/被延迟调用**（resolver 内部可以选择先调 next 再决定包装与否）——递归闭包天然支持"调用方决定何时继续链条"；循环实现做不到这种"延续式"语义。读高阶函数进阶例子时（第 1 章的"回调返回回调"），这就是现实版。

## 10. 总结

### 10.1 派发语义速查表

| 事件族 | 顺序 | 结果合并 | 短路 | 错误 |
|---|---|---|---|---|
| 通用 `emit`（通知类） | load+注册序 | 无 | 无 | 记录并继续 |
| `session_before_*` | load+注册序 | last-wins（兜底） | **cancel 立即返回** | 记录并继续 |
| `cache_warming_decision` | load+注册序 | **last action wins** | 无 | 记录并继续 |
| `message_end` | load+注册序 | **组合（后见前者结果）** + 角色校验 | 无 | 记录并继续（非法替换被拒/报告） |
| `tool_result` | load+注册序 | **组合（compose）** | 无 | 记录并继续 |
| `tool_call` | load+注册序 | 可改参数/block（专门实现） | block 生效于该工具 | **失败阻止工具**（fail-safe，第 13.3.3 节） |
| `resolveToolRenderers` | load 序 + base 兜底 | **填充式（next() ?? mine）** | 无 | — |

**一句总结**：`on()` 是同一个入口，但每个事件的**结果语义**（通知/变换/替换/取消/组合）由各自的 emit 实现决定——**"名字像"不代表"行为像"**（本表就是防呆）。

### 10.2 阅读检查清单

- [ ] 我能说出 `ExtensionHandler` 的两个泛型参数如何提示"事件是否有返回值效果"吗？
- [ ] 我知道 `on()` 与 `registerTool()` 在返回值上的区别（订阅 vs 注册）吗？
- [ ] 我能列出四个 `session_before_*` 事件与它们的取消语义吗？
- [ ] 我知道 `snapshotEventHandlers` 防的是什么、不防什么吗？
- [ ] 我能复述 `resolveToolRenderers` 的递归链与 `next() ?? mine` 的关系吗？
- [ ] 我能在 `bindCore` 的三组动作里找到"会话动作 / 上下文动作 / 供应商动作"的分界吗？

---

> D8 完。至此精读篇覆盖了：循环、Agent 对象、会话投影、提示与压缩、SDK 装配、CLI 启动、工具三件套、扩展系统——所有"核心代码流程"都至少有一处逐段注解。
