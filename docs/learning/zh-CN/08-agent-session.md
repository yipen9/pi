# 第 8 章：AgentSession 与资源生命周期

> 学完本章你能回答：
>
> 1. `AgentSession` 比 `Agent` 多了什么？为什么它有 158KB？
> 2. `createAgentSession` 与 `createAgentSessionServices` + `createAgentSessionFromServices` 两条路径有什么区别？
> 3. `AgentSessionRuntime` 解决什么问题？"替换会话"的完整流程经过哪些步骤？
> 4. `dispose()` 释放了什么、按什么顺序？不调用会怎样？
> 5. 工作目录变化时，哪些资源必须重建、哪些可以复用？

**前置知识**：第 3 章（装配与请求旅程）、第 6 章（运行收尾）、第 7 章（工具）。
**预计学习时间**：1.5 天。
**本章验证状态**：静态核对通过（`agent-session-runtime.ts`、`agent-session-services.ts`、`dispose` 逐段核对）。

---

## 8.1 为什么需要"应用会话"这一层

回顾对比：

| 维度 | `Agent`（packages/agent） | `AgentSession`（coding-agent） |
|---|---|---|
| 定位 | **运行时**：消息、工具、循环、事件 | **应用会话**：把运行时接上真实的文件、配置、扩展 |
| 认识什么 | `AgentMessage`、`AgentTool`、`streamFn` | 会话文件、设置、资源发现、扩展、压缩、重试、模型切换、权限 |
| 不认识什么 | 文件系统、终端、扩展系统、设置 | ——（它认识全部，所以大） |
| 代码量 | 约 20KB + 29KB（agent.ts + agent-loop.ts） | `agent-session.ts` 约 158KB |
| 可复用性 | 任何"模型+工具"应用都能用 | 面向编码助手这一具体产品 |

一个类比：`Agent` 是发动机与传动轴；`AgentSession` 是**整辆车的电控系统**——油量检测（token 统计）、自动换挡（模型切换）、行车记录仪（会话文件）、安全气囊（权限钩子）全在这里。"158KB"不是设计缺陷，而是它真的统筹着几十个关注点。**读它的正确姿势是"按符号跳转"**（第 0 章阅读路线），而不是从头读。

本章聚焦其中一条主线：**资源的创建、替换与释放**。其它主线（压缩、重试、扩展）分别在 10、6、13 章。

## 8.2 资源清单：谁创建、谁拥有、谁使用、谁释放

`createAgentSession` 会创建会话对象及部分默认依赖；若调用方通过 options 注入 `modelRuntime`、`resourceLoader`、`settingsManager` 或 `sessionManager`，这些对象可能由调用方创建并与别处共享。读资源表时，把“本函数使用它”与“本对象拥有它的完整生命周期”分开：

> **API 所有权规则**：选项允许注入一个对象，只能证明会话会使用它，不能据此推断 `session.dispose()` 会销毁它。当前 `CreateAgentSessionOptions` 没有一般性的“关闭所有依赖”契约；自建宿主应分别阅读被注入类型的清理 API，并显式管理自己创建的长生命周期资源。

| 资源 | 默认创建位置 | 注入时的边界 | 会话结束时实际做什么 |
|---|---|---|---|---|
| `Agent` | `sdk.ts` 新建 | SDK 不接收现成 Agent | `AgentSession.dispose()` 发出 abort，并断开事件连接；不会销毁 JS 对象 |
| `SessionManager` | `sdk.ts` 按默认配置新建 | 可由调用方传入 | 不关闭/删除；会话记录仍由它持有并写在原位置 |
| `SettingsManager` | `sdk.ts` 按默认配置新建 | 可由调用方传入 | 不执行 dispose；文件变化由设置管理器自己的写入方法处理 |
| `ModelRuntime` | `sdk.ts` 默认创建 | 可由调用方传入并复用 | `AgentSession.dispose()` 不释放它；当前类没有 `dispose()` 方法 |
| `ResourceLoader` | 默认创建 `DefaultResourceLoader` 并 reload | 可由调用方传入 | 不统一关闭 loader；session 会 invalidate 当前 extension runner/context |
| `CacheWarmer` | 每个 SDK session 在 `sdk.ts` 创建 | 不作为 SDK 参数注入 | 清除 `onWarmed` 回调并调用 `cancel()` |
| 扩展运行时 `ExtensionRunner` | 会话绑定/重载时 | 由加载结果进入 session | `invalidate()` 使旧扩展上下文失效；扩展持有的外部资源应由扩展自己的清理逻辑处理 |

加上会话自身的**请求级状态**（无需外部释放，但要知道它们存在）：

`_agentRunAbortRequested`、`_isAgentRunActive`、`_retryAttempt`、`_failedResponse`、`_lastAssistantMessage`、`_entryIdsByMessage`（消息对象 ↔ 会话条目 id 的映射，第 4.8 节）、`_deferredSettledActions`……

**读代码时的实用结论**：看到"这个字段是干什么的"，先问"它是请求级、会话级还是进程级？"——生命周期不同，创建/释放位置就不同。

## 8.3 两条创建路径：一步到位 vs 两步式

### 8.3.1 路径一：`createAgentSession`（SDK 用户常用）

第 3.5 节逐行读过：解析 cwd/agentDir → 建 ModelRuntime/SettingsManager/SessionManager → 资源发现 → 恢复模型与思考级别 → 计算工具白名单 → `new Agent` → `new AgentSession`。特点：**一步到位，适合进程内一次创建**（`01-minimal.ts`）。

### 8.3.2 路径二：services + session 两步式（CLI/运行时用）

`core/agent-session-services.ts` 把"与 cwd 绑定的服务"独立出来：

```typescript
export interface AgentSessionServices {
	cwd: string;
	agentDir: string;
	modelRuntime: ModelRuntime;
	settingsManager: SettingsManager;
	resourceLoader: ResourceLoader;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}

export async function createAgentSessionServices(options): Promise<AgentSessionServices> {
	const cwd = resolvePath(options.cwd);
	const agentDir = options.agentDir ? resolvePath(options.agentDir) : getAgentDir();
	const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ authPath, modelsPath, signal }));
	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const resourceLoader = new DefaultResourceLoader({ ...options.resourceLoaderOptions, cwd, agentDir, settingsManager });
	await resourceLoader.reload(options.resourceLoaderReloadOptions);

	// 把扩展"待注册"的供应商/虚拟模型真正注册进 modelRuntime
	for (const { name, config, extensionPath } of extensionsResult.runtime.pendingProviderRegistrations) {
		try { modelRuntime.registerProvider(name, config); }
		catch (error) { diagnostics.push({ type: "error", message: `Extension "${extensionPath}" error: ${message}` }); }
	}
	// ...（native provider、virtual model 同理）
	await modelRuntime.refresh({ allowNetwork: false });
	diagnostics.push(...applyExtensionFlagValues(resourceLoader, options.extensionFlagValues));

	return { cwd, agentDir, modelRuntime, settingsManager, resourceLoader, diagnostics };
}

export async function createAgentSessionFromServices(options): Promise<CreateAgentSessionResult> {
	return createAgentSession({ /* 把 services 的成员原样注入 */ });
}
```

对比一步式，多了三件"应用层的事"：

1. **扩展供应商注册**：扩展可以在加载时声明新供应商，这里统一注册；失败不抛出，转成**诊断**；
2. **离线刷新**：`refresh({ allowNetwork: false })`——启动阶段不联网（联网刷新由调用方在合适时机另行发起，见第 3.4.4 节 RPC 分支）；
3. **扩展 flag 校验**：`--some-ext-flag` 不认识就报 error 诊断。

**诊断（diagnostics）模式**是本仓库反复出现的边界设计：核心层**只收集、不打印**；界面/CLI 决定怎么呈现、是否致命：

```typescript
const hasRuntimeErrors = runtime.diagnostics.some((diagnostic) => diagnostic.type === "error");
if (hasRuntimeErrors) { /* 打印并退出（main.ts 的做法） */ }
```

### 8.3.3 为什么要有两步式

调用处的注释给出了答案：

```text
This keeps session creation separate from service creation so callers can
resolve model, thinking, tools, and other session inputs against the target
cwd before constructing the session.
```

**因为会话选项（模型作用域、工具白名单、设置）是 cwd 相关的**，而 CLI 可能在启动后切换会话（连带切换 cwd）。先建服务、解析选项、再建会话，才能保证"这一组服务 + 这个会话"是一致的快照。
## 8.4 `AgentSessionRuntime`：会"重生"的会话

### 8.4.1 问题：`/new`、`/resume`、`/fork` 之后，原来的对象还能用吗

CLI 支持这些操作：

- `/new`：开一个全新会话；
- `/resume`（`--continue`、`--resume`）：打开历史会话；
- `/fork`、`/clone`：从历史节点分叉；
- `/import`：导入一个会话 JSONL 文件。

这些操作的共同点：**工作目录可能变化**（历史会话属于别的项目）。而第 8.3 节说过，服务与选项是 cwd 绑定的。所以不能"在旧会话对象上打补丁"，必须**重建**。

`AgentSessionRuntime` 就是"拥有当前会话 + 负责替换"的容器。类的文档注释：

```text
Owns the current AgentSession plus its cwd-bound services.

Session replacement methods tear down the current runtime first, then create
and apply the next runtime. If creation fails, the error is propagated to the
caller. The caller is responsible for user-facing error handling.
```

### 8.4.2 工厂契约：什么叫"可重建"

替换时不能靠魔法——得有人把"如何从零建出一个会话"写下来。这就是工厂函数：

```typescript
/**
 * Creates a full runtime for a target cwd and session manager.
 *
 * The factory closes over process-global fixed inputs, recreates cwd-bound
 * services for the effective cwd, resolves session options against those
 * services, and finally creates the AgentSession.
 */
export type CreateAgentSessionRuntimeFactory = (options: {
	cwd: string;
	agentDir: string;
	sessionManager: SessionManager;
	sessionStartEvent?: SessionStartEvent;
	projectTrustContext?: ProjectTrustContext;
}) => Promise<CreateAgentSessionRuntimeResult>;

export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
	services: AgentSessionServices;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}
```

三个关键词：

- **"closes over process-global fixed inputs"**：模型运行时之外的进程级常量（比如 `--tools` 白名单、`--no-extensions` 等 CLI 决定）**闭包捕获**，不随 cwd 变化；
- **"recreates cwd-bound services"**：设置、资源发现、工具、会话管理**按新的 cwd 重建**；
- **"resolves session options against those services"**：模型作用域、思考级别等在新服务上解析（不能拿旧 cwd 的解析结果用）。

第 3.4.3 节看到的 `main.ts` 里的 `createRuntime` 就是这个类型的实现；SDK 例子 `13-session-runtime.ts` 给了一个最小版本（第 8.6 节读它）。

### 8.4.3 类结构：持有、重绑、收尾

```typescript
export class AgentSessionRuntime {
	private rebindSession?: (session: AgentSession) => Promise<void>;
	private beforeSessionInvalidate?: () => void;
	private _session: AgentSession;
	private _services: AgentSessionServices;
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private _diagnostics: AgentSessionRuntimeDiagnostic[];
	private _modelFallbackMessage?: string;

	get services() / get session() / get cwd() / get diagnostics() / get modelFallbackMessage()

	setRebindSession(fn)                     // 宿主声明"会话换了之后如何重新绑定"
	setBeforeSessionInvalidate(fn)            // 旧会话失效前的同步清理
}
```

两个 setter 都是给**宿主**（比如交互模式 TUI）用的：

- `setRebindSession`：替换完成后，runtime 会调用它，让宿主把订阅、扩展绑定、UI 组件挂到新会话上（第 8.6 节）；
- `setBeforeSessionInvalidate`：注释解释了为什么必须**同步**：

```text
This is for host-owned UI teardown that must not yield to the event loop,
such as detaching extension-provided TUI components before the old extension
context becomes stale.
```

   ——不能 `await`，因为一让出事件循环，旧扩展上下文就可能先被作废，清理逻辑再访问就晚了。

### 8.4.4 三个私有生命周期原语（替换流程的零件）

```typescript
private async teardownCurrent(reason: SessionShutdownEvent["reason"], targetSessionFile?: string): Promise<void> {
	// Settle any active response first so the aborted turn (including tool
	// results) is persisted to the outgoing session before it is replaced.
	await this.session.abort();
	await emitSessionShutdownEvent(this.session.extensionRunner, {
		type: "session_shutdown",
		reason,
		targetSessionFile,
	});
	this.beforeSessionInvalidate?.();
	this.session.dispose();
}

private apply(result: CreateAgentSessionRuntimeResult): void {
	this._session = result.session;
	this._services = result.services;
	this._diagnostics = result.diagnostics;
	this._modelFallbackMessage = result.modelFallbackMessage;
}

private async finishSessionReplacement(withSession?: (ctx: ReplacedSessionContext) => Promise<void>): Promise<void> {
	if (this.rebindSession) {
		await this.rebindSession(this.session);
	}
	if (withSession) {
		await withSession(this.session.createReplacedSessionContext());
	}
}
```

`teardownCurrent` 的**第一步是 `abort()`**，注释说明了原因：先把进行中的响应"落定"（连同工具结果写进**旧会话**文件），再替换。否则用户最后一条消息可能丢在内存里。

顺序设计（替换的完整节奏）：

```text
abort（落定进行中的工作，持久化到旧会话）
  → session_shutdown 扩展事件（reason: new/resume/fork/quit，带目标文件）
    → beforeSessionInvalidate（宿主同步清理 UI）
      → session.dispose()（旧会话释放）
        → createRuntime（新 cwd 重建服务+会话）
          → apply（切换引用）
            → finishSessionReplacement（rebindSession 重绑 + withSession 回调）
```

## 8.5 替换流程精读：四种用户操作

四种操作的代码骨架完全同构，先记口诀：

```text
① 发"即将切换"扩展事件（可取消） → ② 解析目标 SessionManager → ③ 校验目标 cwd 存在
  → ④ teardownCurrent（旧） → ⑤ createRuntime（新） → ⑥ apply + finishSessionReplacement
```

### 8.5.1 `switchSession`（/resume、--session）

```typescript
async switchSession(sessionPath: string, options?): Promise<{ cancelled: boolean }> {
	const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
	if (beforeResult.cancelled) return beforeResult;          // 扩展可以说"别切"

	const previousSessionFile = this.session.sessionFile;
	const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
	assertSessionCwdExists(sessionManager, this.cwd);         // 会话记录的 cwd 必须还能访问

	await this.teardownCurrent("resume", sessionManager.getSessionFile());
	this.apply(await this.createRuntime({
		cwd: sessionManager.getCwd(),
		agentDir: this.services.agentDir,
		sessionManager,
		sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
		projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
	}));
	await this.finishSessionReplacement(options?.withSession);
	return { cancelled: false };
}
```

注意 `createRuntime` 收到的是**新会话的 cwd**（`sessionManager.getCwd()`），不是当前 cwd——因此 `--resume` 一个别的项目的会话时，设置、资源、工具全部按那个项目重建（第 3 章注释里 "may select a session from another project" 的落地）。

### 8.5.2 `newSession`（/new）

```typescript
async newSession(options?): Promise<{ cancelled: boolean }> {
	const beforeResult = await this.emitBeforeSwitch("new");
	if (beforeResult.cancelled) return beforeResult;

	const previousSessionFile = this.session.sessionFile;
	const sessionDir = this.session.sessionManager.getSessionDir();
	const sessionManager = this.session.sessionManager.isPersisted()
		? SessionManager.create(this.cwd, sessionDir)     // 磁盘会话
		: SessionManager.inMemory(this.cwd);              // 内存会话保持内存
	if (options?.parentSession) sessionManager.newSession({ parentSession: options.parentSession });

	await this.teardownCurrent("new", sessionManager.getSessionFile());
	this.apply(await this.createRuntime({ cwd: this.cwd, agentDir, sessionManager,
		sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile } }));
	if (options?.setup) {                                  // 会话初始化钩子（SDK/RPC 用）
		await options.setup(this.session.sessionManager);
		this.session.refreshContext();
	}
	await this.finishSessionReplacement(options?.withSession);
	return { cancelled: false };
}
```

细节：**内存/磁盘形态保持不变**（你用的是 `--no-session` 或 `SessionManager.inMemory()` 开的会话，新建也还是内存的）。

### 8.5.3 `fork`（/tree 分叉、/clone）

```typescript
async fork(entryId, options?: { position?: "before" | "at"; withSession? }): Promise<{ cancelled; selectedText? }> {
	const position = options?.position ?? "before";
	const beforeResult = await this.emitBeforeFork(entryId, { position });   // session_before_fork 可取消
	if (beforeResult.cancelled) return { cancelled: true };

	const selectedEntry = this.session.sessionManager.getEntry(entryId);
	if (!selectedEntry) throw new Error("Invalid entry ID for forking");
	let targetLeafId: string | null;
	if (position === "at") targetLeafId = selectedEntry.id;
	else {
		if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user")
			throw new Error("Invalid entry ID for forking");
		targetLeafId = selectedEntry.parentId;                               // 在该消息"之前"分叉
		selectedText = extractUserMessageText(selectedEntry.message.content); // 把用户原文还回编辑器
	}
	// ...（磁盘会话：createBranchedSession(targetLeafId) 生成新文件；内存会话：直接 newSession/分叉）
	await this.teardownCurrent("fork", sessionManager.getSessionFile());
	this.apply(await this.createRuntime({ cwd, agentDir, sessionManager,
		sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile } }));
	await this.finishSessionReplacement(options?.withSession);
	return { cancelled: false, selectedText };
}
```

`position` 的两种语义值得注意：

- `"at"`：以选中条目为叶子继续（保留它）；
- `"before"`：**回到那条用户消息之前**重新开始——所以要求选中条目必须是**用户消息**，并把它的文本 `selectedText` 返回给宿主（交互模式会把它填回输入框，用户改一改再发）。

### 8.5.4 `importFromJsonl`（/import）

流程多了"把外部文件收进会话目录"的一步：

```typescript
async importFromJsonl(inputPath, cwdOverride?): Promise<{ cancelled: boolean }> {
	const resolvedPath = resolvePath(inputPath);
	if (!existsSync(resolvedPath)) throw new SessionImportFileNotFoundError(resolvedPath);

	const sessionDir = this.session.sessionManager.getSessionDir();
	// 目标名冲突时追加 -1、-2……后缀；若源文件本来就在会话目录，则原地使用
	const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
	if (beforeResult.cancelled) return beforeResult;
	if (!sourceAlreadyStored) copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
	const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
	assertSessionCwdExists(sessionManager, this.cwd);
	await this.teardownCurrent("resume", sessionManager.getSessionFile());
	this.apply(await this.createRuntime({ /* reason: "resume" */ }));
	await this.finishSessionReplacement();
	return { cancelled: false };
}
```

## 8.6 `withSession` 与重绑：宿主怎么"跟上"新会话

替换之后，**旧会话上的一切订阅都失效了**（扩展上下文被 invalidation，见 8.7）。宿主必须重新绑定。这正是 SDK 例子 `13-session-runtime.ts` 演示的模式：

```typescript
const runtime = await createAgentSessionRuntime(createRuntime, { cwd, agentDir, sessionManager });

let unsubscribe: (() => void) | undefined;

async function bindSession() {
	unsubscribe?.();                              // 先退订旧的
	const session = runtime.session;              // 再绑新的
	await session.bindExtensions({});
	unsubscribe = session.subscribe((event) => {
		if (event.type === "queue_update") {
			console.log("Queued:", event.steering.length + event.followUp.length);
		}
	});
	return session;
}

let session = await bindSession();
await runtime.newSession();
session = await bindSession();                    // 换会话 → 重新绑定
if (originalSessionFile) {
	await runtime.switchSession(originalSessionFile);
	session = await bindSession();
}
unsubscribe?.();
await runtime.dispose();
```

三种绑定出口，用途区分：

| 机制 | 谁用 | 时机 |
|---|---|---|
| 手动重绑（示例的 `bindSession`） | SDK 用户自己管理 | 每次替换后自己记得调用 |
| `runtime.setRebindSession(fn)` | 宿主（交互模式） | runtime 在 `finishSessionReplacement` 里自动调用 |
| `withSession` 回调 | 某一次替换的"一次性后续动作" | 替换完成后执行一次，拿到 `ReplacedSessionContext` |

`withSession` 与 `rebindSession` 的差别：前者是**这一次操作**的收尾（比如"fork 后立刻把选中的文本发给模型"），后者是**长期绑定**（每次替换都要做）。RPC 模式的 `newSession` 命令会把"替换后的首条消息"放进 `withSession` 里执行——这正是它存在的意义。
## 8.7 `dispose()`：释放的顺序与语义

### 8.7.1 会话级：先"止血"，再"销户"

`AgentSession.dispose`（`agent-session.ts` 第 1363 行，原样）：

```typescript
dispose(): void {
	try {
		this.abortRetry();
		this.abortCompaction();
		this.abortBranchSummary();
		this.abortBash();
		this.agent.abort();
	} catch {
		// Dispose must succeed even if an abort hook throws.
	}

	this._extensionRunner.invalidate(
		"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after " +
		"ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, " +
		"move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
	);
	this._disconnectFromAgent();
	this._eventListeners = [];
	if (this._cacheWarmer) {
		this._cacheWarmer.onWarmed = undefined;
		this._cacheWarmer.cancel();
	}
	cleanupSessionResources(this.sessionId);
}
```

五段结构，各有讲究：

1. **发出取消信号**：重试等待、压缩、分支摘要、bash 子进程、Agent run。此处的 `dispose()` 是同步方法，不等待 Agent run 收尾；若需要等待，先 `await session.abort()`，它会调用 Agent abort 并等待 `waitForIdle()`。runtime 的替换路径就是先 `await this.session.abort()`，再通知 shutdown 并 dispose；
2. **`try/catch` 包住但吞掉异常**：注释一句话道破——"**释放必须成功，哪怕某个 abort 钩子抛错**"。资源释放代码的可靠性优先级高于错误透明性（一个泄漏的下午比一条被吞的异常更糟）；
3. **`invalidate` 扩展上下文**：把"旧 ctx 已失效"从一句口头约定变成**强制失败**——旧扩展上下文后续任何使用都会报错，并且错误信息本身就是一份使用说明（该用 `withSession` 的就用 `withSession`）；
4. **断开与 Agent 的连接、清空监听器列表**：此后事件不再流向这个会话；
5. **停掉缓存预热器**（清回调 + cancel）、清理会话级资源（`cleanupSessionResources(sessionId)`）。

### 8.7.2 运行时级：先告别，再释放

```typescript
async dispose(): Promise<void> {
	await emitSessionShutdownEvent(this.session.extensionRunner, {
		type: "session_shutdown",
		reason: "quit",
	});
	this.beforeSessionInvalidate?.();
	this.session.dispose();
}
```

- **退出也是一种 `session_shutdown` 事件**（reason: `"quit"`），与替换（new/resume/fork）共用同一套扩展协议——扩展只需实现一种清理逻辑；
- 先给宿主同步清理机会（`beforeSessionInvalidate`），再真正 dispose。

有一条容易漏掉的差异：`AgentSessionRuntime.dispose()` 的顺序是**先等 `session_shutdown` handlers 完成，再调用 `session.dispose()` 发取消信号**；它本身没有先 `abort()`、也没有等待 Agent idle。内置的会话替换会走 `teardownCurrent()`，其中明确先 `await session.abort()`，所以替换路径和最终退出路径的等待保证不同。

自建宿主若可能在 prompt 仍运行时关闭 runtime，应显式等待：

```typescript
await runtime.session.abort(); // 发出取消并等 Agent run / end listeners 收尾
unsubscribe?.();               // 解除宿主自己的订阅
await runtime.dispose();       // 再发 session_shutdown 并让上下文失效
```

若程序结构已经保证所有 `prompt()` 都 await 完成，才可以直接 `await runtime.dispose()`。SDK 示例 `13-session-runtime.ts` 没有启动 prompt，因此它的直接 dispose 示例不覆盖“活动请求时关闭”的情形。当前实现没有对应的直接测试；此结论来自两个方法的源码顺序。

### 8.7.3 "忘记 dispose"会发生什么

| 忘记释放 | 后果 |
|---|---|
| `agent` 还在运行 | 事件继续流向旧回调（很多指向已卸载的 UI） |
| 缓存预热器 | 后台继续发请求（真实费用） |
| 扩展上下文 | 扩展持有的资源不清（文件监视器等，第 13 章） |
| 事件监听器数组 | 内存与回调泄漏 |

对 SDK 用户的最低要求：**照抄 `01-minimal.ts` 的 `try/finally` 结构**，保证普通异常也会释放订阅、缓存预热与扩展上下文。该例在 `finally` 执行时已 await 完 `session.prompt()`；如果需要从外部停止仍在运行的 prompt 并等它收尾，顺序应为 `await session.abort(); session.dispose();`。对用运行时的宿主：只有确认会话已 idle 时才直接 `await runtime.dispose()`；活动运行先 `await runtime.session.abort()`。替换会话则由 `teardownCurrent()` 自动先 abort 并等待。

## 8.8 工作目录变化时，什么必须重建

把资源按"绑定对象"分类，这张表是本章的最终结论：

| 资源 | 绑定级别 | 换 cwd 时的行为 | 依据 |
|---|---|---|---|
| `agentDir`（全局配置目录） | 进程级 | 复用 | `getAgentDir()` 不依赖 cwd |
| CLI 参数解析结果、`extensionFactories` | 进程级 | 闭包捕获复用 | `createRuntime` 工厂注释："closes over process-global fixed inputs" |
| 全局设置（用户级） | 进程级（存在） | 复用（同一文件） | `SettingsManager.create(cwd, agentDir)` 读两个来源；用户级部分不变 |
| 项目设置、项目信任 | cwd | **重建** | bootstrap 时 `projectTrusted: false`，切换后需按新 cwd 判定 |
| 资源发现（扩展/技能/模板/主题/AGENTS.md） | cwd | **重建** | `DefaultResourceLoader` 以 cwd 为根 |
| 内置工具（read/edit/...） | cwd | **重建** | 工厂函数都接收 `cwd` 参数 |
| 会话目录归类 | cwd | **重新计算** | 会话路径包含 cwd 编码（第 4.7.1 节） |
| `SessionManager` | 目标会话 | **替换** | 每个会话一个管理器 |
| `ModelRuntime`（认证） | agentDir | 复用（同一实例传入） | services 里显式传入 |
| `CacheWarmer` / `ExtensionRunner` | 会话 | **随会话重建** | 与会话强相关 |

一个自测方法：**"如果 cwd 从 A 变成 B，这个对象的含义会变吗？会 → cwd 绑定 → 必须重建。"**

## 8.9 实验 L05：生命周期审计

**实验性质**：代码阅读 + 可选本地运行。
**验证状态**：设计中。

### 步骤

1. 重读 `packages/coding-agent/examples/sdk/01-minimal.ts`，画出 `try { ... } finally { session.dispose(); }` 的保护范围：哪些代码在 try 内、为什么 `dispose` 放 finally；
2. 打开 `13-session-runtime.ts`，回答：
   - `createRuntime` 工厂闭包捕获了哪些"进程级固定输入"？（对照例子里的参数与注释）
   - 每次 `bindSession()` 都重新做了哪两件事？不做的后果是什么？
   - 结尾为什么先 `unsubscribe?.()` 再 `await runtime.dispose()`？
3. 制作一张"资源 × 生命周期"表：对 8.2 节清单里的每个资源，标注它由谁创建、在 `newSession()` 后是"重建"还是"复用"；
4. （可选）本地运行 `node examples/sdk/13-session-runtime.ts`（需要能启动的环境；faux/默认模型行为可能不同），观察每个 `console.log` 的顺序。

### 判定标准

- 能解释 `createRuntime` 为什么是"函数"而不是"对象"；
- 能说出至少两种"忘记重绑"的故障现象；
- 资源表与 8.8 节的一致（可能有下列几行不同，以你的代码为准）。

## 8.10 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 替换会话后事件不再触发 | 旧订阅指向旧会话 | 重绑（`setRebindSession` 或手动 `bindSession`） |
| 操作旧 ctx 报 "This extension ctx is stale..." | `dispose()` 的 invalidate 生效 | 改用 `withSession` 回调里传入的新 ctx |
| `dispose()` 后仍在发请求 | 某在途操作未取消、预热器未停 | 用 runtime/会话提供的 dispose，别只断订阅 |
| 切换到一个"别的项目"的会话后配置不对 | 用了旧 cwd 的解析结果 | 让 `createRuntime` 接手新 cwd（不要自己拼选项） |
| fork 后用户输入丢了 | `position: "before"` 的 `selectedText` 没被使用 | 把 `selectedText` 填回编辑器/传给 `withSession` |
| 以为 `newSession()` 会保留内存/磁盘形态之外的设置 | 重建会走完整工厂 | 一次性初始化放 `options.setup` 回调 |
| 直接改 `runtime.session` 的字段 | 运行时值由 apply/replace 管理 | 通过替换流程改变；只读取 `runtime.session` |

## 8.11 验收题

1. 用一句话说明 `AgentSessionRuntime` 解决的问题，并给出一个它必须存在（不能靠打补丁）的场景。
2. 按顺序写出 `switchSession` 的六个阶段（含可取消点）。
3. `dispose()` 第一段为什么用 `try/catch` 吞掉异常？`invalidate` 的错误信息为什么写得像使用文档？
4. 把下列资源分类为"进程级 / cwd 绑定 / 会话级"：`agentDir`、项目设置、内置工具、`SessionManager`、`extensionFactories`、缓存预热器。
5. SDK 用户与交互模式宿主在"重绑"上各自的义务是什么？

### 参考答案（要点）

1. 解决"会话及其 cwd 绑定服务需要整体替换"的问题；场景如 `--resume` 一个属于其他项目的历史会话（cwd 变化 → 设置/资源/工具全部要换）。
2. ① `session_before_switch`（可取消）→ ② `SessionManager.open` 目标文件 → ③ 校验目标 cwd → ④ `teardownCurrent`（abort → session_shutdown → beforeSessionInvalidate → dispose）→ ⑤ `createRuntime`（新 cwd）→ ⑥ `apply` + `finishSessionReplacement`（重绑 + withSession）。
3. 释放路径必须绝对可靠（杀进程前的最后机会）；invalidate 的文本在"错误发生处"直接告诉调用者正确迁移路径（用 withSession、别用旧 ctx）。
4. 进程级：`agentDir`、`extensionFactories`；cwd 绑定：项目设置、内置工具；会话级：`SessionManager`、缓存预热器。
5. SDK 用户：自己保证重绑（或显式 `setRebindSession`）；宿主：应通过 `setRebindSession`/`withSession` 声明重绑与一次性收尾，runtime 会在替换时自动调用。

## 8.12 来源与下一章

- `packages/coding-agent/src/core/agent-session-runtime.ts`（工厂契约、`teardownCurrent`/`apply`/`finishSessionReplacement`、`switchSession`/`newSession`/`fork`/`importFromJsonl`/`dispose`、`createAgentSessionRuntime`）；
- `packages/coding-agent/src/core/agent-session-services.ts`（services 定义与两步式创建）；
- `packages/coding-agent/src/core/agent-session.ts`（`dispose` 第 1363 行、`state` 第 1396 行）；
- `packages/coding-agent/examples/sdk/01-minimal.ts`、`13-session-runtime.ts`、`examples/sdk/README.md`。

下一章回到"记录"本身：会话文件如何组成一棵树、恢复与分支如何把树投影成模型上下文、`buildContextEntries`/`buildSessionProjection`/`buildSessionContext` 三级流水线各做什么。
