# 第 15 章：SDK 嵌入与会话控制

> 学完本章你能回答：
>
> 1. 什么时候用进程内 SDK、什么时候用第 16 章的进程级集成（print/JSON/RPC）？
> 2. `createAgentSession` 的每个选项分别替换哪一层默认实现？
> 3. 会话状态怎么读？为什么 `session.messages` 不是"事实来源"？
> 4. 事件订阅、取消、排队（steer/followUp）在 SDK 里怎么用？
> 5. 完整的释放顺序是什么？成功与异常路径分别怎么保证？

**前置知识**：第 3 章（装配）、第 8 章（生命周期与 runtime）、第 13 章（扩展）。
**预计学习时间**：1.5 天（面对的是"写宿主程序"，建议边写边跑）。
**本章验证状态**：静态核对通过（`sdk.md` 与 8 个 SDK 示例逐步核对）；实验 L09 设计中。

---

## 15.1 先选集成形态：SDK 还是进程级接口

`sdk.md` 开篇就把边界划清了：

```text
`@earendil-works/pi-coding-agent` embeds Pi in a Node.js or Bun process. It provides direct
TypeScript access to the agent, sessions, tools, models, and resources used by the
command-line application.

Use the SDK for in-process TypeScript integration. For a language-independent or isolated
subprocess, see CLI Integration.
```

| 维度 | SDK（本章） | CLI 集成（第 16 章） |
|---|---|---|
| 语言 | TypeScript / JavaScript | 任意（JSONL / 文本协议） |
| 进程 | 与宿主同进程 | 子进程 |
| 隔离 | 无（共享权限与内存） | 有进程边界（可加容器/沙箱） |
| 控制粒度 | 最细（可注入一切组件） | 受协议命令集限制 |
| 事件 | 直接订阅 `session.subscribe` | 解析 stdout JSONL |
| 适用 | 编辑器插件、自研工具、测试宿主 | 其他语言、需要隔离的自动化 |

**判断标准**：需要"读写宿主内部状态、注入自定义实现"选 SDK；需要"语言无关或隔离"选 CLI 集成。两者可以混用（例如 Node 宿主内部用 SDK，对外暴露 RPC 给别的工具）。

## 15.2 最小宿主的完整骨架

`sdk.md` 的门面示例：

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();

try {
	await session.prompt("What files are in the current directory?");
	console.log(session.getLastAssistantText());
} finally {
	session.dispose();
}
```

三个必须理解的语义：

1. **`prompt()` 在"整个 run 结束"后 resolve**——包括自动重试（第 6 章）与队列处理；不是"第一次模型响应结束"；
2. **`session` 拥有什么**（`sdk.md` 原话）：一次对话、它的模型与工具、排队消息、压缩状态、扩展运行时；
3. **`dispose()` 必做**，它做四件事：

```text
abort active work
invalidate extension contexts
disconnect from the agent
remove event listeners
```

`01-minimal.ts` 的 `try/finally` 就是为此存在的（第 1 章逐行读过）。

## 15.3 读会话状态：五个官方入口 + 一个警告

`sdk.md` 点名的读取入口：

| 读取 | 含义 |
|---|---|
| `session.messages` | 当前最终化的转录（含投影后的消息） |
| `session.model` / `session.thinkingLevel` | 当前模型与思考级别 |
| `session.systemPrompt` | **当前生效的系统提示（只读）**；包含"改了但还没发给模型"的变化；工具的变更会在下一次请求前声明（第 7.3 节） |
| `session.getActiveToolNames()` | 当前激活工具集 |

警告（很多人第一次接 SDK 会踩）：

```text
`SessionManager` is authoritative for finalized model context. Restore external history by
constructing the session with a manager containing those entries. Assigning
`session.agent.state.messages` does not replace persisted context.
```

翻译：**"历史"的事实来源是 `SessionManager`**；`session.messages` 只是它的一次投影（第 9 章的三级流水线）。想恢复外部历史，正确做法是**用包含条目的 manager 构造会话**；直接给 `agent.state.messages` 赋值不会改写持久化上下文，还会让两边失同步。

如果宿主根本不想要文件：

```typescript
const { session } = await createAgentSession({
	sessionManager: SessionManager.inMemory(),
});
```

## 15.4 逐项配置：每个开关替换哪一层

`sdk.md` 的"Configuring a session"一节给出了完整边界清单。默认情况下工厂会创建：`ModelRuntime`、文件版 `SettingsManager`、持久 `SessionManager`、`DefaultResourceLoader`、以及配置好的默认工具。每一层都可以显式提供：

| 选项 | 替换的层 | 示例出处 |
|---|---|---|
| `modelRuntime` / `model` / `thinkingLevel` / `scopedModels` | 模型访问与选择 | `02-custom-model.ts` |
| `settingsManager` | 设置来源（文件或内存） | `10-settings.ts`、`12-full-control.ts` |
| `sessionManager` | 会话存储（持久/内存） | `11-sessions.ts` |
| `resourceLoader` | 资源发现（扩展/技能/模板/主题/上下文） | `03`、`04`、`06`、`07`、`08` |
| `tools` / `noTools` / `excludeTools` / `customTools` | 工具集 | `05-tools.ts` |

原则：**要"常规发现 + 局部覆盖"用 `DefaultResourceLoader` 的 override 选项；要"完全自己管"就实现自定义 `ResourceLoader`**（`12-full-control.ts` 给了完整接口清单）。

### 15.4.1 模型与思考级别（02）

```typescript
const modelRuntime = await ModelRuntime.create();
const opus = modelRuntime.getModel("anthropic", "claude-opus-4-5");   // 内置目录
// 也可以查 models.json 里的自定义模型：modelRuntime.getModel("my-provider", "my-model")
const available = await modelRuntime.getAvailable();                  // 有有效凭据的模型
const { session } = await createAgentSession({ model: available[0], thinkingLevel: "medium", modelRuntime });
```

要点：`ModelRuntime` **显式创建并复用**——这样宿主可以先查模型/配凭据，再建会话；也避免每个会话重复初始化（第 5 章）。

### 15.4.2 系统提示（03）

两种改法，差异要记牢：

```typescript
// 改法一：整体替换（连同丢弃默认 preamble）
const loader1 = new DefaultResourceLoader({
	cwd, agentDir,
	systemPromptOverride: () => `You are a helpful assistant that speaks like a pirate. ...`,
	// Needed to avoid DefaultResourceLoader appending APPEND_SYSTEM.md from ~/.pi/agent or <cwd>/.pi.
	appendSystemPromptOverride: () => [],
});

// 改法二：在默认提示基础上追加
const loader2 = new DefaultResourceLoader({
	cwd, agentDir,
	appendSystemPromptOverride: (base) => [...base, "## Additional Instructions\n- Always be concise ..."],
});
```

对照第 10 章：`systemPromptOverride` 对应"换掉 preamble"；`appendSystemPromptOverride` 对应 `addendum` 分节。第一个例子里 `appendSystemPromptOverride: () => []` 的作用注释写得很清楚：**防止默认发现流程把 `~/.pi/agent/APPEND_SYSTEM.md` 与项目版又追加进来**——只替换不兜底，会出现"pirate 提示词后面跟着系统文件内容"的意外组合。

### 15.4.3 技能、工具、扩展、上下文、模板（04-08）

四个例子的共同模式：**先构造 `DefaultResourceLoader`（带 override/附加参数），reload 后注入会话**：

```typescript
const loader = new DefaultResourceLoader({
	cwd,
	agentDir,
	// 技能：过滤/替换 discovery 结果
	skillsOverride: (base) => ({ skills: [...base.skills.filter(/* ... */)], diagnostics: [] }),
	// 上下文文件：附加或替换
	agentsFilesOverride: (base) => ({ agentsFiles: [...base.agentsFiles, { path: "...", content: "..." }] }),
	// 扩展：文件路径 + 内联工厂
	additionalExtensionPaths: ["./my-extension.ts"],
	extensionFactories: [myInlineExtension],
});
await loader.reload();
const { session } = await createAgentSession({ resourceLoader: loader, sessionManager: SessionManager.inMemory() });
```

（具体 override 名以 `DefaultResourceLoaderOptions` 与各示例为准；`04-skills.ts`、`06-extensions.ts`、`07-context-files.ts`、`08-prompt-templates.ts` 各演示一项。）

### 15.4.4 凭据与设置（09、10）

- `09-api-keys-and-oauth.ts`：自定义 `auth.json`/`models.json` 路径、运行时注入 API Key（`modelRuntime.setRuntimeApiKey(...)`，第 12 章示例同款）；
- `10-settings.ts`：文件版或**内存版**设置。测试与自动化里最常用：

```typescript
const settingsManager = SettingsManager.inMemory({
	compaction: { enabled: false },
	retry: { enabled: true, maxRetries: 2 },
});
```

### 15.4.5 会话管理（11）

`SessionManager` 的静态工厂/查询一次性给全：

| API | 用途 |
|---|---|
| `SessionManager.inMemory()` | 不落盘的临时会话 |
| `SessionManager.create(cwd)` | 新建持久会话 |
| `SessionManager.continueRecent(cwd)` | 延续最近会话（没有则新建） |
| `SessionManager.list(cwd)` | 列出会话（用于选择器） |
| `SessionManager.open(path)` | 打开指定文件 |
| 第二个参数 `sessionDir` | 自定义会话目录（不做 cwd 编码） |

`modelFallbackMessage` 在"恢复的模型不可用"时给出提示（第 3.5 节的恢复逻辑）——宿主应该展示它，而不是静默换模型。

### 15.4.6 全控制（12）

`12-full-control.ts` 展示了"关闭所有发现"的极限形态：

```typescript
const resourceLoader: ResourceLoader = {
	getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
	getSkills: () => ({ skills: [], diagnostics: [] }),
	getPrompts: () => ({ prompts: [], diagnostics: [] }),
	getThemes: () => ({ themes: [], diagnostics: [] }),
	getAgentsFiles: () => ({ agentsFiles: [] }),
	getSystemPrompt: () => `You are a minimal assistant. ...`,
	getSystemPromptSource: () => undefined,
	getAppendSystemPrompt: () => [],
	getAppendSystemPromptSources: () => [],
	extendResources: () => {},
	reload: async () => {},
};

const { session } = await createAgentSession({
	cwd, agentDir: "/tmp/my-agent",
	model, thinkingLevel: "off",
	modelRuntime, resourceLoader,
	tools: ["read", "bash"],
	sessionManager: SessionManager.inMemory(cwd),
	settingsManager,
});
```

这份接口清单值得收藏：**它就是"资源层"的完整契约**。做纯函数测试、嵌入到别人的应用时，照这个写一个"空资源加载器"就能把 pi 变成一棵可完全预测的组件树。

### 15.4.7 内联扩展与 builtin（13 的补充）

`sdk.md` 对扩展注入有两组细节：

- **内联扩展**（`InlineExtension`）：直接给 `extensionFactories`。只有需要"诊断与启动输出里出现稳定名字"时才命名；命名且 `replaceable: true` 的内联扩展，在**加载期**被别的扩展注册了同名工具/命令/flag 时**让位不加载**（而不是双份冲突）。CLI 内置的 codemode、tool_search、MCP 都是 replaceable；
- **`builtin: true` 的命名条目**：不是内联扩展，而是提供 `builtin:<name>` 扩展的代码；默认加载、`pi config` 可见、可用 `-builtin:<name>` 或 `noExtensions` 禁用；它在**项目信任之后**加载，因此**不能**处理 `project_trust` 事件。CLI 内置扩展用的就是它。

### 15.4.8 codemode 与 MCP：SDK 默认没有

```text
The CLI loads `codemode`, `tool_search`, and MCP as built-in extensions. SDK sessions do not;
add `createCodemodeExtension()`, `createToolSearchExtension()`, and `createMcpExtension()` to the
`extensionFactories` of `DefaultResourceLoader`. `codemode` and `tool_search` are registered inactive:
enable them through the `defaultTools` setting (`["+codemode", "+tool_search"]` keeps the other
default tools), or let the MCP extension activate them. The MCP extension connects its servers on
`session_start`, so call `session.bindExtensions()`.
```

四步照抄：加工厂 → 用 `defaultTools` 的 `+` 语法启用 → `bindExtensions()`（让 MCP 在 `session_start` 连接服务器）→ 完整示例 `14-codemode-mcp.ts`（第 22 章展开 codemode 本身）。
## 15.5 事件订阅、排队与取消

### 15.5.1 订阅的正确姿势

`sdk.md` 的示例把顺序讲清了：**先订阅、再 prompt、finally 里退订**：

```typescript
const unsubscribe = session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

try {
	await session.prompt("Explain this repository");
} finally {
	unsubscribe();
}
```

会话事件覆盖：消息更新、工具执行、队列变化、压缩、重试……（完整清单就是第 4.5.2 节的 `AgentSessionEvent`）。两个行为细节回顾：

- `AgentSession.subscribe` 的回调类型是 `(event) => void`，派发时同步调用；不会等待 async listener 返回的 Promise。回调启动异步副作用时，要显式接 rejection；不要假设 `await session.prompt(...)` 会等待该副作用。示例见 D27 §7.1。
- 底层 `Agent.subscribe` 是另一份契约：listener 可返回 `Promise<void>`，Agent 会逐个等待。`AgentSession` 内部依靠这层等待完成事件处理和持久化，但不会把等待能力传给 SDK 公开的 `session.subscribe`。
- `message_update` 携带"增量 + 部分消息快照"：流式渲染用增量，整段重绘用快照。

### 15.5.2 流式中再输入：必须"表态"

```text
A prompt sent while the session is already streaming must specify whether it should steer
the current run or follow it. Calling `prompt()` without that choice rejects rather than guessing.
```

对应代码：

```typescript
await session.prompt("补充一句", { streamingBehavior: "steer" });     // 当前轮后注入
await session.prompt("顺便再跑测试", { streamingBehavior: "followUp" }); // 收工前注入
```

不想用 `prompt()` 的话，直接调排队 API：

```typescript
const result = await session.steer("...");     // 或 session.followUp("...")
// "queued"  → 已入队（可能经过扩展改写）
// "handled" → 被扩展消费（不会进模型）
```

返回值语义很重要：`"handled"` 意味着扩展已经处理（第 13.7.3 节的 `input` 事件），宿主不要假设消息一定会到模型。

### 15.5.3 取消与等待

| API | 语义 |
|---|---|
| `session.abort()` | 停止当前操作**并等待**会话空闲（等于 abort + waitForIdle） |
| `session.waitForIdle()` | 只等待，不打断 |
| `session.abortRetry()` | 仅取消"重试等待"（第 6.6 节） |

对照第 6 章：`abort()` 是信号（工具/请求要自行响应）；`waitForIdle()` resolve 的时点 = `agent_settled`（所有收尾完成）。

## 15.6 释放矩阵：谁在什么时候释放什么

把第 8 章的释放逻辑压缩成宿主视角的清单：

| 步骤 | 动作 | 谁做 |
|---|---|---|
| 1 | 退订你自己的 `unsubscribe()` | 宿主（示例都显式做） |
| 2 | 停止在途工作 | `session.dispose()` 内部的 abort 系列（retry/compaction/branchSummary/bash/agent） |
| 3 | 失效扩展上下文 | `dispose()` 的 `extensionRunner.invalidate(...)` |
| 4 | 断开 Agent 连接、清空监听器 | `dispose()` |
| 5 | 取消缓存预热器 | `dispose()` |
| 6 | （用 runtime 时）发 `session_shutdown`、通知宿主、再 dispose | `runtime.dispose()` 内部完成 |

两个常见误区：

- **`dispose()` 不删除会话文件**：磁盘历史归用户管理（第 9 章）；dispose 只处理"进程内资源"；
- **用 runtime 的宿主别"手动 dispose 再 dispose"**：`await runtime.dispose()` 已经包含会话释放；重复调用会话级 API 会命中"旧上下文已失效"的防御。

## 15.7 实验 L09：写一个 SDK 宿主

**实验性质**：本地运行；建议先用 faux（第 5、18 章）跑无费用版本。
**验证状态**：设计中。任务目标（规划文档 L09）："一个输出流式文本和工具生命周期事件的终端宿主；成功与异常路径都释放 session；分清运行结束、事件回调结束和资源释放。"

### 规格

一个好宿主应该按顺序打印：

```text
[event] agent_start
[text]  （流式文本，无换行拼接到标准输出）
[tool ]  start read {"path":"..."}
[tool ]  end   read ok
[event] turn_end / agent_end(willRetry=false)
[event] agent_settled
[host ]  disposed
```

### 步骤

1. 建 `host.ts`（用 `01-minimal` 结构 + 13 章的事件清单）：

```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory() });
const log = (tag: string, text: string) => console.log(`[${tag}] ${text}`);
const unsubscribe = session.subscribe((event) => {
	switch (event.type) {
		case "agent_start": log("event", "agent_start"); break;
		case "message_update":
			if (event.assistantMessageEvent.type === "text_delta") process.stdout.write(event.assistantMessageEvent.delta);
			break;
		case "tool_execution_start": log("tool ", `start ${event.toolName} ${JSON.stringify(event.args)}`); break;
		case "tool_execution_end": log("tool ", `end   ${event.toolName} ${event.isError ? "ERROR" : "ok"}`); break;
		case "agent_end": log("event", `agent_end(willRetry=${event.willRetry})`); break;
		case "agent_settled": log("event", "agent_settled"); break;
	}
});

try {
	await session.prompt("读取 README.md 的第一段并总结");
} catch (error) {
	log("host ", `prompt failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
	unsubscribe();
	session.dispose();
	log("host ", "disposed");
}
```

2. **成功路径**：运行并核对顺序（`agent_end` 在 `agent_settled` 之前；`disposed` 最后）；
3. **异常路径**：把 prompt 换成"调用一个必然失败的工具"（或用不存在的模型/取消），确认 catch/finally 都执行、`disposed` 一定出现；
4. **取消路径**：在 `tool_execution_start` 后调用 `session.abort()`（用 setTimeout 或事件内触发），确认 run 以 `aborted` 收尾且 finally 生效；
5. **三个"结束"对号入座**：
   - **运行结束** = `agent_end`（可能因重试出现多次）；
   - **事件回调结束** = `agent_settled`（所有 await 的监听器与收尾完成）；
   - **资源释放** = `dispose()` 之后（`disposed` 日志）。

### 观察与思考

- 如果监听器是 `async` 且很慢，`agent_settled` 会被推迟到什么位置？（提示：监听器被 await）
- 取消实验中，工具侧收到 `signal` 了吗？把它传给一个"等待信号"的工具验证。
- 不用 `SessionManager.inMemory()` 时，dispose 之后磁盘上留下了什么？（对照第 9 章）

### 清理

删除临时宿主脚本与实验会话；`git status` 干净。

## 15.8 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 流式中 `prompt()` 抛 "specify streamingBehavior" | 没表态 steer/followUp | 传 `streamingBehavior` 或改用 `steer()/followUp()` |
| 宿主退出后进程不结束 | 会话/预热器未释放 | `finally { session.dispose(); }`（runtime 用 `runtime.dispose()`） |
| 恢复历史后模型"看不见"旧消息 | 用赋值 `agent.state.messages` 而不是带条目的 SessionManager | 按 `sdk.md` 警告：用 SessionManager 构造会话 |
| `session.messages` 与文件不一致 | 前者是投影，后者（条目树）才是事实来源 | 用 `SessionManager`/`buildSessionContext` 的概念读状态（第 9 章） |
| 改了系统提示没生效 | 用的是"只读读取"或没 reload loader | 通过 `DefaultResourceLoader` 的 override 构造，并 `await loader.reload()` |
| 内联扩展与文件扩展重名冲突 | 两个都注册了同名工具 | 给内联扩展命名 + `replaceable: true`（15.4.7） |
| SDK 里 codemode/MCP 工具不存在 | SDK 不默认加载它们 | 加 `createCodemodeExtension()` 等 + `defaultTools` `+` 语法 + `bindExtensions()` |
| 监听器重复触发 | 换会话/替换后没重绑或没退订 | 订阅与退订成对；runtime 场景按第 8.6 节重绑 |

## 15.9 验收题

1. 什么时候该用 SDK、什么时候用第 16 章的 CLI 集成？各举一个场景。
2. 说出 `dispose()` 的四件事；为什么它不删除会话文件？
3. `session.messages` 与 `SessionManager` 的关系？"恢复外部历史"的正确做法？
4. 流式期间发送新输入的两种方式与返回值语义？
5. `agent_end`、`agent_settled`、`dispose()` 完成，三者分别代表什么？顺序如何？
6. 写出一个"完全关闭资源发现"的 `ResourceLoader` 需要实现哪些方法（按 15.4.6 的清单）？
7. SDK 里要启用 codemode/MCP 需要哪四步？

### 参考答案（要点）

1. 需要进程内细粒度控制/注入组件（编辑器插件、测试宿主、自研工具）用 SDK；语言无关或需要进程隔离（Python 调用、容器化自动化）用 print/JSON/RPC。
2. abort 在途工作（重试/压缩/分支摘要/bash/agent）、失效扩展上下文、断开 Agent 连接、移除事件监听器。它只管进程内资源；会话文件属于用户数据。
3. `session.messages` 是 `SessionManager` 条目树的一次投影；恢复外部历史应构造包含这些条目的 SessionManager 再建会话，赋值 `agent.state.messages` 不会替换持久化上下文。
4. `prompt(..., {streamingBehavior})` 或 `steer()/followUp()`；返回 `"queued"`（已入队，可能被扩展改写）或 `"handled"`（被扩展消费）。
5. `agent_end` = 循环结束（可多次，重试场景）；`agent_settled` = 会话级收尾完成（监听器被 await 完）；`dispose()` 完成 = 进程内资源释放。顺序：agent_end → agent_settled → dispose。
6. `getExtensions`、`getSkills`、`getPrompts`、`getThemes`、`getAgentsFiles`、`getSystemPrompt`、`getSystemPromptSource`、`getAppendSystemPrompt`、`getAppendSystemPromptSources`、`extendResources`、`reload`。
7. ① 把 `createCodemodeExtension()`/`createToolSearchExtension()`/`createMcpExtension()` 加进 `DefaultResourceLoader` 的 `extensionFactories`；② 用 `defaultTools` 的 `+codemode`/`+tool_search` 启用（或交给 MCP 扩展激活）；③ 调 `session.bindExtensions()` 让 MCP 在 `session_start` 连接；④ 参考 `14-codemode-mcp.ts`。

## 15.10 来源与下一章

- `packages/coding-agent/docs/sdk.md`（生命周期、存储、提示、订阅、配置、内联与 builtin、codemode/MCP、示例索引）；
- SDK 示例：`01-minimal.ts`、`02-custom-model.ts`、`03-custom-prompt.ts`、`04-skills.ts`、`05-tools.ts`、`06-extensions.ts`、`07-context-files.ts`、`08-prompt-templates.ts`、`09-api-keys-and-oauth.ts`、`10-settings.ts`、`11-sessions.ts`、`12-full-control.ts`、`13-session-runtime.ts`、`14-codemode-mcp.ts`（`examples/sdk/`，全部随仓库做类型检查）。

下一章换一条路线：不用 SDK，让别的语言或隔离进程也能驱动 pi——print、JSON 事件流与 CLI RPC 协议，以及"流式管道必须按行重组"这类硬知识。
