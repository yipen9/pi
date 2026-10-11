# 07. AgentSession 与资源生命周期

> 预计时间：2 小时（不含选读）
> 先修：第 06 篇（`task-06-tools.md`）。需要知道 `Agent` 的一次运行、事件（`event`）和工具调用是什么。

## 本篇你会学到

- 说清 `AgentSession` 比 `Agent` 多管了哪些资源，以及为什么它不能只替换消息。
- 对照资源表，说出每个资源由谁创建、谁持有、谁释放，并画出 `new`、`resume`、`fork` 时“拆除旧会话、建立新会话”的顺序。
- 按正确顺序写出会话释放（`dispose`）的代码，并解释每一步为什么不能颠倒。

## 先用一个例子理解

用户在项目 A 里和 pi 聊了一段。然后输入 `/resume`，打开项目 B 的一个历史会话。

如果 pi 只把消息数组换成 B 的历史，会出现三个问题：

1. 工具仍然绑定项目 A 的目录。模型请求 `read("README.md")` 时，读到的是 A 的文件。
2. A 的设置、`AGENTS.md`、扩展仍在生效。B 自己的配置没有被加载。
3. 界面仍订阅旧会话对象。新回答写进了新会话，屏幕上却没有更新。

所以 pi 不“打补丁”，而是整体替换。替换的骨架如下：

```text
先让旧会话的进行中工作落定，再释放旧会话
  → 用 B 的目录重新建立服务（设置、资源、工具）
  → 建立新的 AgentSession，装入 B 的历史
  → 通知宿主重新订阅新会话
```

这一篇的主线就是这条替换链，以及链上每个对象的所有权。

## 核心概念

下面的 6 个概念是本篇的主线。每个概念先给定义，再说为什么需要，最后给一个小例子。之后的几个小节把这些概念用到具体的资源表、创建路径、替换流程和释放顺序上。

### 概念 1：AgentSession（应用会话）

**AgentSession** 是包住一个 `Agent` 的应用层对象。`Agent` 只负责一次运行：收消息、调模型、执行工具、发事件。`AgentSession` 在它外面增加了模型选择、设置、会话文件、扩展、重试、压缩和事件订阅。

为什么要分两层：`Agent` 不认识文件系统和终端，所以任何“模型加工具”的程序都能复用它。读写项目文件、保存会话、加载扩展只属于编码助手这个产品。把这些放进 `Agent` 会让它失去通用性。

| 维度 | `Agent`（`packages/agent/src/agent.ts`） | `AgentSession`（`packages/coding-agent/src/core/agent-session.ts`） |
| --- | --- | --- |
| 认识的对象 | 消息、工具、`streamFn` | 会话文件、设置、资源、扩展、模型切换 |
| 不认识的对象 | 文件系统、终端、设置 | 无（它包含编码助手的全部应用逻辑） |
| 文件大小（本仓库） | `agent.ts` 约 20 KB，`agent-loop.ts` 约 29 KB | `agent-session.ts` 约 158 KB |

`AgentSession` 的体积大，是因为它统筹很多关注点，不是设计错误。读它时应按符号查找，不要从头读到尾。

### 概念 2：资源所有权（创建、持有、使用、释放）

**资源所有权** 指一个资源由谁创建、谁持有、谁负责释放。这四个角色可能不是同一个对象。

例子：调用方先创建 `SettingsManager`，再通过 `createAgentSession({ settingsManager })` 传进去。会话会使用它读设置。但会话的 `dispose()` 不会关闭它，因为 `SettingsManager` 根本没有 `dispose` 方法。所以“会话用了它”不等于“会话拥有它”。

`packages/coding-agent/src/core/sdk.ts` 的 `CreateAgentSessionOptions` 没有给出一般性的“关闭所有依赖”的约定。读代码时要逐个资源确认。

### 概念 3：cwd 绑定服务（AgentSessionServices）

工作目录（cwd，即 current working directory）是 pi 启动时所在的目录。很多资源依赖它：项目设置、项目里的扩展和技能、内置工具的根目录。

**cwd 绑定服务** 是一组依赖 cwd 的对象，类型是 `AgentSessionServices`，字段包括 `cwd`、`agentDir`、`modelRuntime`、`settingsManager`、`resourceLoader` 和 `diagnostics`。换一个 cwd，这组服务就应当重建。

例子：项目 A 有 `.pi/settings.json`，项目 B 没有。对同一个用户目录，`SettingsManager.create(cwd, agentDir)` 在 A 和 B 下读到的项目设置不同。所以从 A 切到 B 时，设置必须按 B 重新读取。

`agentDir`（全局配置目录，默认是用户目录下的 `.pi/agent`）不依赖 cwd，换目录时可以复用。

### 概念 4：AgentSessionRuntime 与工厂

**AgentSessionRuntime** 是“当前会话”的容器。它持有当前的 `session` 和 `services`，并负责 `new`、`switchSession`、`fork`、`importFromJsonl` 这些替换动作。源码在 `packages/coding-agent/src/core/agent-session-runtime.ts`。

**工厂**（类型 `CreateAgentSessionRuntimeFactory`）是一个函数：输入目标 cwd 和 `SessionManager`，输出一套新的 `session + services`。runtime 在创建时把工厂存下来，之后每次替换都调用它。

为什么要存工厂：替换时需要“从零重建”的能力。如果 runtime 不保存工厂，它就不知道该如何为新目录重新创建设置、资源和工具。

例子：用户输入 `/new` 时，runtime 调用 `this.createRuntime({ cwd: this.cwd, ... })`。`createRuntime` 就是创建 runtime 时保存下来的那个工厂。

创建 runtime 的形式（与 `examples/sdk/13-session-runtime.ts` 相同）：

```typescript
const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: process.cwd(),
  agentDir: getAgentDir(),
  sessionManager: SessionManager.create(process.cwd()),
});
// runtime.session 是当前会话；以后每次替换都会再次调用 createRuntime
```

### 概念 5：拆除（teardown）与释放（dispose）

**拆除** 指替换前对旧会话做的一串收尾动作。它的顺序是：取消（abort）→ 发 `session_shutdown` 事件 → 宿主同步清理 → 释放（dispose）。

**释放** 指 `AgentSession.dispose()` 本身。它停掉后台工作、断开与 `Agent` 的连接、让扩展上下文失效、停止缓存预热。

两者的区别：拆除包含释放，但多了“先让进行中的工作落定”和“通知扩展”两步。直接调用 `dispose()` 不会等待进行中的回复结束。

**取消（abort）** 是请求当前工作尽快停止。`AgentSession.abort()` 会设置取消标志、取消重试与压缩、调用 `agent.abort()`，然后等待 `waitForIdle()`。**等待空闲（waitForIdle）** 指等当前运行和它的事件监听器全部结束。

### 概念 6：重绑（rebind）与 withSession

替换完成后，旧会话上的订阅已经没有用。宿主（例如终端界面）必须把自己重新挂到新会话上，这叫 **重绑**。

runtime 不知道宿主的界面结构，所以提供两个出口：

- `setRebindSession(fn)`：每次替换完成后都会调用。这是宿主的长期绑定。
- `withSession(callback)`：只属于某一次操作。替换完成后执行一次，拿到的是新会话的 `ReplacedSessionContext`。

例子：交互模式在创建 runtime 后调用 `setRebindSession`（见 `packages/coding-agent/src/modes/interactive/interactive-mode.ts`）。以后每次 `/new`、`/resume`、`/fork` 完成，界面都会自动挂到新会话上，不需要每次手动处理。

### 小课：get、set 与副本

TypeScript 的 `get` 和 `set` 让外部读写对象属性时执行函数。读 `AgentSessionRuntime` 时，先要分清两件事：变量指向了新的会话，和旧会话上的订阅仍然存在。下面的小例子说明“读出副本”和“替换时复制”的区别。

```typescript
function createHolder() {
  let values = ["old"]; // 私有数组由闭包持有
  return {
    get values() { return values.slice(); }, // 读出副本，避免外部直接改内部数组
    set values(next: string[]) { values = next.slice(); }, // 替换时也复制
  };
}
const holder = createHolder();
const seen = holder.values; // seen 保持旧快照
holder.values = ["new"];
console.assert(seen[0] === "old" && holder.values[0] === "new");
```

真实的 `Agent.state` 与上面的 `values` 不同，要分三层看：

1. `AgentSession` 的 `get state()` 只是转发：`return this.agent.state`。
2. `packages/agent/src/agent.ts` 中 `Agent` 的 `get state()` 返回内部的 `this._state`，没有 `.slice()`。所以每次读取拿到的是同一个对象。
3. `this._state` 由 `createMutableAgentState` 创建。它只给 `tools` 和 `messages` 定义了 `set`，`set` 内部调用 `.slice()`。`Agent` 本身没有 `set state()`。

结论：读取时不复制，赋值 `state.messages` 时才复制。下面的脚本在系统临时目录中运行，结束后已删除。它直接导入仓库里的 `agent.ts`（需要 Node 23 的类型剥离），输出为本地真实运行结果，`ExperimentalWarning` 已过滤：

```typescript
import { Agent } from "file:///D:/Github/pi/packages/agent/src/agent.ts";

const agent = new Agent({
  initialState: { messages: [] },
  streamFn: async () => { throw new Error("unused"); }, // 构造时需要流函数，这里不会被调用
});

const oldMessages = agent.state.messages; // 读取：拿到内部数组本身
const input = [{ role: "user", content: "hi", timestamp: 1 }];
agent.state.messages = input;             // 赋值：内部保存的是 input.slice()
console.log(agent.state.messages === input);  // false
console.log(oldMessages.length);              // 0，旧引用不受影响
input.push({ role: "user", content: "later", timestamp: 2 });
console.log(agent.state.messages.length);     // 1，调用方改 input 不影响状态
agent.state.messages.push({ role: "user", content: "direct", timestamp: 3 });
console.log(agent.state.messages.length);     // 2，直接 push 会改内部数组
```

```text
1. state 每次返回同一对象: true
2. 赋值前 messages 长度: 0
3. 赋值后拿到的是副本: false
4. 旧引用长度: 0 新状态长度: 1
5. 改调用方数组后状态长度: 1
6. 直接 push 改内部数组，状态长度: 2 快照长度: 1
```

这个例子说明：`set` 复制的是顶层数组。数组里的消息对象没有被复制，所以直接修改消息对象的字段，仍会影响状态（未在本地验证，由 `slice()` 是浅复制的语义推出）。另外，上面 `createHolder` 小课的运行结果为 `old new`，断言通过（本次重新运行）。

### 资源清单：谁创建、谁持有、谁使用、谁释放

下表是本篇的核心结论。“换目录时”一列回答：当 cwd 变化时，这个资源是重建、复用还是替换。

| 资源 | 默认由谁创建 | 由谁持有 | 谁使用 | 释放时做什么 | 换目录时 |
| --- | --- | --- | --- | --- | --- |
| `Agent` | `createAgentSession` 中的 `new Agent` | `AgentSession` 的 `agent` 字段 | 会话调用它运行一次 | `dispose()` 调用 `agent.abort()`，然后断开会话在构造时建立的事件订阅 | 随会话重建 |
| `AgentSession` | `createAgentSession`，或 runtime 替换时的工厂 | `AgentSessionRuntime`（替换时）或调用方 | 宿主（终端界面、SDK 调用者、RPC） | 见“释放顺序” | 替换为新对象 |
| `SessionManager` | `createAgentSession` 未传入时调用 `SessionManager.create`；替换动作中新建 | 会话的 `sessionManager` 字段 | 会话读写历史条目 | 没有 `dispose`。会话文件留在原处 | 每个会话一个，替换为新对象 |
| `SettingsManager` | `createAgentSession` 未传入时调用 `SettingsManager.create(cwd, agentDir)` | cwd 绑定服务，也被会话引用 | 会话、资源加载器、工具 | 没有 `dispose`。写入由它自己的方法完成 | 项目层按新 cwd 重读；用户层文件共享 |
| `ModelRuntime` | `createAgentSession` 或 `createAgentSessionServices` | cwd 绑定服务（`modelRuntime` 字段） | 会话发起模型请求 | 没有 `dispose`。会话释放时不处理它 | 工厂不传入时每次都新建 |
| `ResourceLoader`（`DefaultResourceLoader`） | 未传入时创建并调用 `reload()` | cwd 绑定服务，或会话 | 会话读取扩展、技能、提示词模板 | 没有统一的关闭方法。扩展上下文由 `ExtensionRunner.invalidate` 作废 | 重建，以新 cwd 为根 |
| `ExtensionRunner` | `_buildRuntime`（会话构造时，以及 `reload()` 时） | 会话的 `_extensionRunner` 字段 | 会话向扩展发事件 | `emitSessionShutdownEvent` 发 `session_shutdown`，再 `invalidate()` | 随会话重建 |
| `CacheWarmer` | `createAgentSession` 中直接 `new CacheWarmer` | 会话的 `_cacheWarmer` 字段 | 会话请求完成后做后台预热 | 清除 `onWarmed` 回调，调用 `cancel()` | 随会话重建 |
| 宿主订阅（listener） | 宿主调用 `session.subscribe` | 宿主 | 宿主接收会话事件 | 调用返回的取消函数；`dispose` 也会清空监听器列表 | 替换后必须重新订阅 |

#### 所有权图

下图的箭头表示“引用”，不表示“拥有”。标注“释放”的对象，由所在的那一层负责停止。没有标注的对象只是被引用。

```text
AgentSessionRuntime（替换时持有当前会话）
├── _services: AgentSessionServices（cwd 绑定，换目录时整组重建）
│     ├── modelRuntime: ModelRuntime            没有 dispose
│     ├── settingsManager: SettingsManager      没有 dispose
│     ├── resourceLoader: DefaultResourceLoader 没有统一的关闭方法
│     └── diagnostics                           只读的诊断列表
└── _session: AgentSession（替换时拆除，再新建）
      ├── agent: Agent ──订阅──> _handleAgentEvent   释放：agent.abort()，然后断开订阅
      ├── sessionManager: SessionManager            没有 dispose
      ├── settingsManager / _modelRuntime / _resourceLoader
      │     └ 与 _services 中的是同一对象（两步式路径直接传入）
      ├── _extensionRunner: ExtensionRunner ──> 扩展实例   释放：invalidate 作废上下文
      ├── _cacheWarmer: CacheWarmer ──> 后台预热请求       释放：cancel
      └── _eventListeners ──> 宿主的订阅（界面）           释放：清空数组
```

读图的要点：

- 会话内标注“释放”的四项（`agent`、扩展实例、预热、宿主订阅）都在 `AgentSession.dispose()` 中处理。
- 左侧 `_services` 的对象不由 `dispose()` 释放。替换时，runtime 直接丢弃整组 services，并让工厂重建。
- 宿主（界面）只持有订阅，不持有会话。替换后，宿主要重新订阅新会话。

#### 注入对象的边界

创建选项允许你传入 `modelRuntime`、`resourceLoader`、`settingsManager`、`sessionManager`。这表示“会话会使用这个对象”，不表示“会话拥有它”。

规则：

- 你传入的对象，由你负责释放。
- 会话创建的对象（`Agent` 和 `CacheWarmer`），由会话释放。`createAgentSession` 无条件创建这两个对象，没有对应的选项可以传入，所以它们不属于“调用方传入”的情况。`packages/coding-agent/src/core/sdk.ts` 中可以看到 `new Agent` 和 `new CacheWarmer` 都在函数体内直接调用。
- 对于没有 `dispose` 方法的对象（`SettingsManager`、`SessionManager`、`ModelRuntime`、`DefaultResourceLoader`），释放就是停止使用它们。

#### 请求级状态

会话里还有一批字段只在一次请求期间有意义，例如 `_agentRunAbortRequested`、`_isAgentRunActive`、`_retryAttempt`、`_failedResponse`、`_lastAssistantMessage`、`_isEmittingAgentSettled`。它们不占用外部资源，但替换会话时要知道它们属于旧会话。

读代码时，对每个字段问一句：它是请求级、会话级，还是进程级？生命周期不同，创建和释放的位置就不同。

#### 字段状态表：创建、提示、替换、释放

下表列出 `AgentSession` 中与生命周期有关的字段。字段名都在 `packages/coding-agent/src/core/agent-session.ts` 中以 `private` 或 `readonly` 声明。“提示”指一次 `prompt()`，它经过 `_runAgentPrompt`。

| 字段 | 创建时 | 一次提示期间 | 替换时（旧会话） | 释放时（`dispose`） |
| --- | --- | --- | --- | --- |
| `agent`（`readonly`） | `sdk.ts` 中 `new Agent`，作为 `agent` 传入 | 运行 `agent.prompt()`，`Agent` 内部的 `isStreaming` 为 `true` | 旧会话不再被使用，新会话有自己的 `Agent` | `agent.abort()`，然后 `_disconnectFromAgent()` |
| `_unsubscribeAgent` | 构造函数中 `this.agent.subscribe(this._handleAgentEvent)` 的返回值 | 不变 | 不变 | `_disconnectFromAgent()` 调用后置为 `undefined` |
| `_eventListeners` | `[]` | 宿主调用 `subscribe` 时增加，取消函数移除 | 随旧对象，不再接收新事件 | 置为 `[]` |
| `_extensionRunner` | `_buildRuntime` 创建 `ExtensionRunner`；`reload()` 时再次调用 `_buildRuntime` | 事件经它发给扩展 | 扩展收到 `session_shutdown`，然后被 `invalidate` | `invalidate(...)`，之后旧的 `pi`/`ctx` 调用报错 |
| `_isAgentRunActive` | `false` | `_runAgentPrompt` 开始时为 `true`；`_emitAgentSettled` 中置回 `false` | 随旧对象 | 不修改 |
| `_agentRunAbortRequested` | `false` | `_runAgentPrompt` 开始时置 `false`；运行中调用 `abort()` 时置 `true` | 随旧对象 | 不修改。`dispose()` 直接调用 `agent.abort()`，没有设置它 |
| `_isEmittingAgentSettled` | `false` | 发出 `agent_settled` 期间为 `true` | 随旧对象 | 不修改 |
| `_failedResponse` | `undefined` | `_runAgentPrompt` 开始和 `finally` 中清空；可重试错误时记录失败消息 | 随旧对象 | 不修改 |
| `_retryAttempt` | `0` | 自动重试时递增；`_handlePostAgentRun` 中结束重试时清零 | 随旧对象 | `dispose()` 调用 `abortRetry()`；本次未核对它是否清零该字段 |
| `_lastAssistantMessage` | `undefined` | 助手消息事件到达时记录；`_handlePostAgentRun` 读取后清空 | 随旧对象 | 不修改 |
| `_cacheWarmer` | `sdk.ts` 中 `new CacheWarmer`，作为 `cacheWarmer` 传入 | 请求时，`sdk.ts` 的流函数调用 `start` 启动预热 | 随旧对象 | `onWarmed = undefined`，然后 `cancel()` |
| `sessionManager`（`readonly`） | 选项传入，或 `SessionManager.create` | 追加会话条目 | 替换为新的管理器 | 不处理（没有 `dispose`） |
| `_eventListeners` 以外的宿主状态 | 无 | 无 | 由宿主重绑 | 由宿主自己的代码处理 |

怎么读这张表：

- 同一个字段在不同阶段的值，由“谁写入它”决定。例如 `_isAgentRunActive` 只在 `_runAgentPrompt` 和 `_emitAgentSettled` 中改变。
- 大多数请求级标志会在一次提示结束时清理，例如 `_failedResponse` 在 `_runAgentPrompt` 的 `finally` 中清空。
- 替换时，旧会话的字段不会被逐个重置。旧对象不再被 runtime 引用，它的字段就不再有人读取。
- `dispose()` 不修改大多数字段。它的作用是停止工作、断开连接、作废扩展，而不是把对象恢复为初始状态。

### 两条创建路径

pi 提供两条路径创建会话。它们得到的 `AgentSession` 类型相同，区别在于调用方能否在创建会话之前先检查服务。

#### 路径一：createAgentSession（一步式）

`createAgentSession(options)` 一次完成全部装配。所有选项都可以省略，省略的部分自己创建。

例子：`packages/coding-agent/examples/sdk/01-minimal.ts` 调用 `createAgentSession()`，不传任何参数。它会从当前目录和用户目录发现扩展、技能和工具，并从设置或第一个可用的供应商里选模型。

适用场景：程序只需要一个会话，不需要在创建会话之前改动任何服务。

#### 路径二：createAgentSessionServices + createAgentSessionFromServices（两步式）

第一步 `createAgentSessionServices(options)` 只建 cwd 绑定服务，返回 `AgentSessionServices`。它做的事是：规范化 cwd 和 agentDir，创建或复用 `ModelRuntime` 和 `SettingsManager`，创建 `DefaultResourceLoader` 并 `reload()`，注册扩展提供的 provider，最后离线刷新模型列表。

第二步 `createAgentSessionFromServices(options)` 在这些服务之上建会话。它把服务中的对象传给 `createAgentSession`。由于 `resourceLoader` 已经传入，`createAgentSession` 不会再次调用 `reload()`。

两步式额外做的事有三件：

1. 扩展注册的 provider 和虚拟模型在这里注册。注册失败不会抛出，而是转成诊断（`diagnostics`）。
2. 刷新模型列表时使用 `allowNetwork: false`。启动阶段不联网。
3. 检查扩展的命令行 flag。不认识的 flag 产生 `error` 诊断。

诊断是核心层的约定：核心层只收集，不打印。调用方决定是显示、忽略，还是退出。CLI 的 `main.ts` 就是这样做的。

两条路径的调用形式对比（示意，未运行）：

```typescript
// 路径一：一步式
const { session } = await createAgentSession({ cwd: projectB });

// 路径二：两步式。先建服务，再用服务建会话。
const services = await createAgentSessionServices({ cwd: projectB });
const created = await createAgentSessionFromServices({
  services,
  sessionManager: SessionManager.create(projectB),
});
// created.session 与路径一得到的 session 类型相同
```

#### 为什么两条路径都要保留

问题：会话的很多选项依赖目录。模型作用域、工具白名单、设置都可能因为目录不同而不同。如果先建会话再读服务，会话里的选项可能是按旧目录算出来的。

解决：先建服务，用服务解析选项，再建会话。这样“这组服务加这个会话”是一致的。

例子：`pi --resume B` 启动时，CLI 先用 B 的 cwd 建服务，读取 B 的设置，然后在这些服务上解析模型和工具白名单，最后才建会话。如果顺序颠倒，模型可能来自 A 的设置。

所以：

- 一步式适合“一次性程序”。
- 两步式适合“需要先看服务，再决定会话选项”的场景。CLI 和 runtime 替换都走两步式。

`main.ts` 里的 `createRuntime` 就是两步式的实际使用：它先调用 `createAgentSessionServices({ cwd, agentDir, ... })`，再调用 `createAgentSessionFromServices({ services, sessionManager, ... })`。初始会话和之后的每次替换都经过它。

### AgentSessionRuntime：替换时拆什么、建什么

#### 问题：/new、/resume、/fork 之后，旧对象还能用吗

pi 支持四种替换操作：

- `/new`：开一个新会话。
- `/resume`（以及 `--resume`、`--continue`）：打开一个历史会话。
- `/fork`：从历史的某一条消息分叉出新会话。
- `/import`：导入一个会话 JSONL 文件。JSONL 是每行一个 JSON 对象的文本文件。

这四种操作有一个共同点：目标会话的 cwd 可能和当前不同。历史会话可能属于另一个项目。所以旧的 cwd 绑定服务不能继续用，必须重建。

#### 替换时的对象去向

| 对象 | 替换时怎样处理 | 原因 |
| --- | --- | --- |
| 旧 `AgentSession`（含 `Agent`、订阅、扩展运行器） | 拆除：abort → shutdown → 宿主清理 → dispose | 它绑定旧会话文件和旧目录 |
| 旧 `ExtensionRunner` 的上下文 | 通过 `session_shutdown` 通知，然后 `invalidate` | 扩展持有的旧上下文不能再用 |
| 旧 `SessionManager` | 不再使用；新会话使用新的管理器 | 每个会话一个管理器 |
| cwd 绑定服务（设置、资源、工具、模型运行时） | 由工厂按目标 cwd 重建 | 目录变了，结果可能不同 |
| 工厂函数本身 | 保留，被反复调用 | 替换需要它 |
| 进程级输入（CLI 参数、扩展工厂列表、`agentDir`） | 保留；工厂通过闭包捕获 | 它们与目录无关 |
| 宿主界面的订阅 | 由宿主重绑（`setRebindSession` 或手动 `subscribe`） | runtime 不知道界面的结构 |
| `ModelRuntime` | 默认重建 | 工厂不传入它时每次都新建 |

最后一行值得注意。`main.ts` 的工厂没有把同一个 `modelRuntime` 传给 `createAgentSessionServices`，所以 CLI 中每次替换都会新建 `ModelRuntime`。`examples/sdk/13-session-runtime.ts` 也是如此。如果你想复用，需要自己在工厂里传入同一个实例。

#### 四种操作的入口

| 操作 | 入口方法 | 目标 cwd | 会话文件 | 可以取消的事件 |
| --- | --- | --- | --- | --- |
| 新建 | `newSession` | 当前 runtime 的 cwd | 持久化会话则新建文件；内存会话则保持内存 | `session_before_switch`，原因 `new` |
| 恢复 | `switchSession(path)` | 会话记录中的 cwd | 打开已有文件 | `session_before_switch`，原因 `resume` |
| 分叉 | `fork(entryId, { position })` | 按分支方式决定（见选读） | 写出只含目标路径的新文件 | `session_before_fork` |
| 导入 | `importFromJsonl(path)` | 会话记录中的 cwd | 先复制到会话目录，再打开 | `session_before_switch`，原因 `resume`，目标为复制后的路径 |

导入有一个容易忽略的副作用：复制文件发生在 cwd 检查之前。如果检查失败，复制出来的文件仍留在会话目录里。

#### 替换的六个阶段

以 `switchSession` 为例，阶段如下（完整代码在选读）：

1. **可取消检查。** 调用 `emitBeforeSwitch("resume", path)`。若扩展返回取消，直接返回 `{ cancelled: true }`。此时旧会话完全不变。
2. **准备目标。** 用 `SessionManager.open(path)` 打开目标文件，然后调用 `assertSessionCwdExists`。如果目标的 cwd 不存在，抛出 `MissingSessionCwdError`。此时旧会话仍然可用。
3. **拆除旧会话。** 调用 `teardownCurrent("resume", targetFile)`：先 `abort()`，再发 `session_shutdown`，再调用宿主的 `beforeSessionInvalidate`，最后 `dispose()`。从这一步开始，旧会话不能再用。
4. **建立新 runtime。** 调用工厂 `createRuntime({ cwd: 目标 cwd, agentDir, sessionManager, sessionStartEvent })`。工厂内部重建服务，再建会话。
5. **应用结果。** 调用 `apply(result)`，把 `_session`、`_services`、`_diagnostics` 换成新值。
6. **重绑与收尾。** 调用 `finishSessionReplacement(withSession)`：先调用 `rebindSession(newSession)`，再调用 `withSession(newSession.createReplacedSessionContext())`。

顺序的理由：`rebindSession` 必须先于 `withSession`。`withSession` 里可能要发消息或注册监听，宿主必须已经把命令路由到新会话上。

把阶段画成时间线，三个角色交替工作：

```text
时间 →
旧 runtime   取消 → session_shutdown → 宿主清理 → dispose
工厂                                          建服务 → 建会话
runtime 字段                                                  apply
宿主                                                          rebind → withSession
```

旧 runtime 的四步全部完成后，工厂才开始；工厂完成后，字段才切换；字段切换后，宿主才重绑。任何一步失败，后面的步骤都不会执行。

#### 一次替换的事件轨迹

项目里的回归测试 `packages/coding-agent/test/suite/regressions/2860-replaced-session-context.test.ts` 记录了一次替换的事件顺序。它的断言是：

```text
start:1 → shutdown:1 → start:2 → with:1
```

含义：第一个扩展实例先收到 `session_start`；替换时收到 `session_shutdown`；新会话的扩展实例收到 `session_start`；最后执行 `withSession` 回调。这个顺序是公开的生命周期约定，改动拆除和工厂的先后会改变它。

#### 失败时的状态：没有自动回滚

替换过程没有统一的回滚。阶段 3 之后失败，旧会话已经释放，runtime 的字段仍指向它。

具体地说：`this.apply(await this.createRuntime(...))` 先等待工厂完成，只有成功才执行 `apply`。如果工厂抛错：

- `runtime.session` 仍然是那个已经 `dispose` 的旧会话；
- 旧会话不会自动恢复；
- 新会话没有被 `apply`，runtime 中也看不到它。

所以，替换失败应当被当作需要重建 runtime 的错误，而不是可以继续使用旧会话的错误。各阶段的失败细节见选读。

### 释放顺序（dispose order）

释放分两层：会话级的 `AgentSession.dispose()`，和运行时级的 `AgentSessionRuntime.dispose()`。

#### 会话级：AgentSession.dispose()

`dispose()` 是同步方法。它按下面五步工作：

1. **发出取消信号。** 取消重试等待、压缩、分支摘要、bash 子进程和 `Agent` 运行。这一步不等待运行结束。
2. **吞掉取消中的异常。** 整段用 `try/catch` 包住，并注释“Dispose must succeed even if an abort hook throws”。释放要能完成，即使某个取消钩子出错。
3. **作废扩展上下文。** 调用 `_extensionRunner.invalidate(...)`。之后任何扩展继续使用旧 `pi` 或旧 `ctx`，都会报错，错误信息说明应改用 `withSession` 传入的新上下文。
4. **断开 Agent 并清空监听器。** 调用 `_disconnectFromAgent()`，然后把 `_eventListeners` 置为空数组。之后事件不再流向这个会话。
5. **停止后台预热并清理资源。** 清除 `_cacheWarmer.onWarmed` 回调，调用 `cancel()`，然后调用 `cleanupSessionResources(this.sessionId)`。

为什么是这个顺序：

- 取消在最前：`teardownCurrent` 的源码注释给出的理由是，要让进行中的回复（包括工具结果）先写进旧会话文件，再替换。例如模型刚调用完 `edit` 工具，工具结果还在内存中；按注释的意图，先取消并等待，这条结果会先落盘。如果先 `dispose`，这条结果就可能丢失。
- 作废上下文在后：扩展在第 2 步之前仍能访问自己的上下文。
- 断开监听在最后：前面的收尾过程中，宿主仍能收到事件。

#### 运行时级：AgentSessionRuntime.dispose()

`dispose()` 是异步方法，用于宿主退出。它的顺序是：

1. 发 `session_shutdown`，原因为 `quit`。扩展在这里清理资源，并且 `await` 它的处理器完成。
2. 调用宿主的 `beforeSessionInvalidate()`。这是同步回调，用于在旧扩展上下文失效前拆掉扩展提供的界面组件。
3. 调用 `session.dispose()`。

注意：运行时级的 `dispose()` 没有先调用 `abort()`，也没有等待空闲。内置的替换动作走 `teardownCurrent()`，它先 `await session.abort()`。两条路径的等待保证不同。

#### 调用方的写法

对于一般程序，把 `dispose` 放进 `finally`：

```typescript
const { session } = await createAgentSession();
try {
  await session.prompt("...");
} finally {
  session.dispose();
}
```

如果退出时可能仍有请求在运行，先取消并等待，再释放：

```typescript
await runtime.session.abort(); // 取消，并等待运行和事件监听结束
unsubscribe?.();               // 解除宿主自己的订阅
await runtime.dispose();       // 发 session_shutdown，然后释放
```

只有在确认所有 `prompt()` 都已经结束时，才可以直接调用 `runtime.dispose()`。

#### 忘记释放会怎样

下表按源码语义推断，没有运行实验。

| 忘记的动作 | 可能的后果 |
| --- | --- |
| `abort` | 旧运行仍在进行，它的事件流向已经不再显示的界面 |
| 缓存预热的 `cancel()` | 后台继续发模型请求，产生费用 |
| 扩展上下文的 `invalidate` | 扩展继续使用旧上下文，行为不可预测 |
| 清空监听器列表 | 监听器和它们引用的对象不能被回收 |

## 源码导览（按阅读顺序）

按下表顺序阅读。表中路径相对仓库根目录；符号都在该文件中出现。

| 顺序 | 文件路径 | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/agent/src/agent.ts` | `Agent`（`subscribe`、`state`、`abort`、`waitForIdle`） | 一次运行的边界。`subscribe` 的监听器返回 Promise 时，`Agent` 会等待它。 |
| 2 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession`、`subscribe`、`abort`、`waitForIdle`、`dispose`、`bindExtensions`、`reload`、`_buildRuntime` | 应用层会话持有的资源。`dispose` 的五个动作。扩展运行器在 `_buildRuntime` 中创建。 |
| 3 | `packages/coding-agent/src/core/sdk.ts` | `createAgentSession` | 一步式装配。每个资源在哪里被创建，是否可以由调用方传入。 |
| 4 | `packages/coding-agent/src/core/agent-session-services.ts` | `AgentSessionServices`、`createAgentSessionServices`、`createAgentSessionFromServices` | 两步式装配。先建 cwd 绑定服务，再建会话。扩展的 provider 注册以诊断形式返回。 |
| 5 | `packages/coding-agent/src/core/agent-session-runtime.ts` | `CreateAgentSessionRuntimeFactory`、`AgentSessionRuntime`、`teardownCurrent`、`apply`、`finishSessionReplacement`、`newSession`、`switchSession`、`fork`、`importFromJsonl`、`dispose`、`createAgentSessionRuntime` | 替换动作的骨架。注意哪一步之后旧会话已经不能用。 |
| 6 | `packages/coding-agent/src/core/extensions/runner.ts` | `emitSessionShutdownEvent`、`ExtensionRunner`（`invalidate`、`hasHandlers`） | 扩展收到的 `session_shutdown`。旧扩展上下文如何被作废。 |
| 7 | `packages/coding-agent/src/core/cache-warmer.ts` | `CacheWarmer`（`start`、`cancel`、`onWarmed`） | 会话释放时必须取消的后台请求。 |
| 8 | `packages/ai/src/session-resources.ts` | `cleanupSessionResources` | 会话释放时清理的进程内资源。`pi-ai/compat` 会再导出它。 |
| 9 | `packages/coding-agent/src/core/model-runtime.ts` | `ModelRuntime`、`create`、`hasConfiguredAuth` | 模型与凭据的运行时。它没有 `dispose` 方法。 |
| 10 | `packages/coding-agent/src/core/session-cwd.ts` | `assertSessionCwdExists`、`MissingSessionCwdError` | 目标会话的 cwd 不存在时，在拆除旧会话之前失败。 |
| 11 | `packages/coding-agent/src/main.ts` | `createRuntime`（函数内局部常量）、`createAgentSessionRuntime` 的调用 | CLI 如何把两步式装配接入 runtime。 |
| 12 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | `InteractiveMode`（`setRebindSession`、`setBeforeSessionInvalidate`、`runtimeHost.switchSession`、`runtimeHost.dispose`） | 交互模式的重绑、替换入口和退出。 |
| 13 | `packages/coding-agent/examples/sdk/01-minimal.ts` | `createAgentSession`（`try` / `finally`） | SDK 用户最低限度的释放写法。 |
| 14 | `packages/coding-agent/examples/sdk/13-session-runtime.ts` | `createRuntime`、`bindSession` | 手动重绑的标准写法。 |
| 15 | `packages/coding-agent/test/suite/harness.ts` | `createHarness`、`cleanup` | 测试中如何构造会话并释放它。 |
| 16 | `packages/coding-agent/test/suite/agent-session-runtime.test.ts` | `createRuntimeForTest` | 替换时的事件顺序断言（动手实验 3）。 |

阅读建议：先看表中 `agent-session.ts` 的 `dispose`，再看 `sdk.ts` 与 `agent-session-services.ts` 的两条创建路径，最后看 `agent-session-runtime.ts` 的替换动作。

## 走读一次完整过程

场景：用户在项目 A 中输入 `/resume`，选中项目 B 的会话文件 `B.jsonl`。下面按时间顺序写出每一步发生了什么、调用哪个函数、状态有什么变化。

1. **宿主发出请求。** 交互模式选中会话后调用 `runtimeHost.switchSession(path)`，方法定义在 `AgentSessionRuntime`。状态：runtime 仍持有旧会话 A，`cwd` 仍是 A 的目录。
2. **询问扩展是否允许切换。** `emitBeforeSwitch("resume", path)` 检查是否注册了 `session_before_switch` 处理器。没有处理器则直接返回“不取消”。若扩展返回取消，流程在这里结束，runtime 保持 A。状态：不变。
3. **打开目标会话。** `SessionManager.open(path)` 读取 `B.jsonl` 的条目，生成一个新的会话管理器。状态：多了一个尚未使用的管理器，旧会话 A 仍完整可用。
4. **检查 B 的 cwd。** `assertSessionCwdExists(sessionManager, this.cwd)` 确认 B 记录的目录存在。若不存在，抛出 `MissingSessionCwdError`。状态：仍然是 A，旧会话没有被拆除。
5. **拆除 A。** `teardownCurrent("resume", B.jsonl)` 依次执行：
   - `session.abort()`：A 中进行中的回复和工具结果先落盘到 A 的文件中；
   - `emitSessionShutdownEvent`：扩展收到 `session_shutdown`，原因是 `resume`，目标文件是 B；
   - `beforeSessionInvalidate()`：宿主同步摘除界面组件；
   - `A.dispose()`：取消后台工作，作废扩展上下文，断开 Agent，清空监听器，停止预热。

   状态：A 已释放，不能再用。runtime 的字段仍指向 A。
6. **为 B 建立新 runtime。** 调用工厂 `createRuntime({ cwd: B 的目录, agentDir, sessionManager, sessionStartEvent })`。工厂内部先调用 `createAgentSessionServices({ cwd: B })`，读取 B 的项目设置、发现 B 的扩展和技能、建立 B 的工具；再调用 `createAgentSessionFromServices` 建立 B 的 `AgentSession`，装入 B 的历史。新扩展实例在这一阶段收到 `session_start`。状态：新的 `services` 和 `session` 已经存在，但 runtime 字段仍是旧的。
7. **应用结果。** `this.apply(result)` 把 `_session`、`_services`、`_diagnostics`、`_modelFallbackMessage` 换成 B 的值。状态：`runtime.session` 指向 B。
8. **重绑宿主。** `finishSessionReplacement(withSession)` 先调用 `rebindSession(B)`。交互模式在这里把界面重新订阅到 B。若调用方传入了 `withSession`，再执行它。状态：界面的订阅指向 B。
9. **返回。** `switchSession` 返回 `{ cancelled: false }`。状态：B 是当前会话。A 只剩磁盘上的 `A.jsonl`。

调用链（交互模式）：输入 `/resume` 后，`InteractiveMode` 调用 `showSessionSelector()` 打开会话选择器。用户选中后，选择器回调调用 `handleResumeSession(sessionPath)`。它再调用 `this.runtimeHost.switchSession(sessionPath, { withSession, projectTrustContextFactory })`。如果目标目录不存在，错误是 `MissingSessionCwdError`，界面会再次调用 `switchSession`，并传入 `cwdOverride`。

下表是逐步状态表。A 是当前会话，B 是目标会话，`M_B` 是为 `B.jsonl` 打开的 `SessionManager`。

| 步骤 | 函数 | 执行前 | 执行后 |
| --- | --- | --- | --- |
| 1 | `switchSession`（入口） | `runtime.session` 为 A，`cwd` 为 A 的目录 | 不变 |
| 2 | `emitBeforeSwitch("resume", B.jsonl)` | 同上 | 不变。若扩展返回取消，直接返回 `{ cancelled: true }` |
| 3 | `SessionManager.open(path, undefined, cwdOverride)` | 只有 A 存在 | 多出 `M_B`，它指向 `B.jsonl`；A 不变 |
| 4 | `assertSessionCwdExists(M_B, this.cwd)` | 同上 | 目标目录存在则不变；否则抛出 `MissingSessionCwdError`，A 仍可用 |
| 5a | `teardownCurrent` 中的 `session.abort()` | A 可能有进行中的运行 | 运行结束；未完成的回复和工具结果已写入 `A.jsonl` |
| 5b | `emitSessionShutdownEvent`（`reason: "resume"`，`targetSessionFile: B`） | 扩展仍可用 | 扩展收到 `session_shutdown` |
| 5c | `beforeSessionInvalidate()` | 界面组件仍挂载 | 界面组件已摘除 |
| 5d | `A.dispose()` | A 可用 | A 已释放：扩展上下文失效，监听器清空，预热取消 |
| 6 | 工厂 `createRuntime({ cwd: B, agentDir, sessionManager: M_B, sessionStartEvent })` | runtime 字段仍指向 A | 工厂内部建立 B 的 `services` 和 `session`；新扩展实例收到 `session_start`；runtime 字段仍指向 A |
| 7 | `apply(result)` | `runtime._session` 为 A（已释放） | `_session` 为 B，`_services`、`_diagnostics`、`_modelFallbackMessage` 同步替换 |
| 8 | `finishSessionReplacement(withSession)` 中的 `rebindSession(B)` | 界面订阅 A | 界面订阅 B；若传入了 `withSession`，随后执行它 |
| 9 | `switchSession` 返回 | 同上 | `{ cancelled: false }`；B 是当前会话 |

步骤 5 和步骤 6 的顺序很重要。A 在工厂开始前已经释放，所以步骤 6 出错时，runtime 仍指向一个已释放的 A。这一点在“失败时的状态”中说明。

失败点只有两类需要区分。第 2 步取消或第 4 步校验失败，旧会话完全不变。第 5 步之后失败，旧会话已经释放，要按“没有自动回滚”处理。

## 动手实验

所有实验都不调用真实模型，不需要密钥。实验 1 到 5 的输出都是本地运行的真实结果。实验 6 是练习，没有运行。

### 实验 1：数替换的拆除点（5 分钟）

目的：确认所有替换都经过同一个 `teardownCurrent`。

PowerShell：

```powershell
(Select-String -Path packages/coding-agent/src/core/agent-session-runtime.ts -Pattern 'teardownCurrent\(').Count
```

bash：

```bash
grep -c "teardownCurrent(" packages/coding-agent/src/core/agent-session-runtime.ts
```

预期输出：`7`。含义：1 处定义，6 处调用。6 处调用分别在 `switchSession`、`newSession`、`fork` 的三个分支（持久化且无叶子、持久化且有叶子、内存会话），以及 `importFromJsonl`。

### 实验 2：确认模型运行时和管理器没有释放方法

目的：验证“会话释放不处理这些对象”。

PowerShell：

```powershell
(Select-String -Path packages/coding-agent/src/core/model-runtime.ts -Pattern 'dispose').Count
```

bash：

```bash
grep -c dispose packages/coding-agent/src/core/model-runtime.ts
```

预期输出：`0`。

本地用同样的 `grep` 方法检查 `settings-manager.ts`、`session-manager.ts`、`resource-loader.ts` 时，用的是更严格的正则 `^\s*(async )?(dispose|close)\(`，结果都是 `0`。

### 实验 3：运行替换测试（faux 假模型，离线）

目的：确认新建、恢复、分叉、导入、取消的事件顺序与文档一致。

在 `packages/coding-agent` 目录运行。

PowerShell：

```powershell
Set-Location packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-runtime.test.ts
```

bash：

```bash
cd packages/coding-agent
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/agent-session-runtime.test.ts
```

预期输出（本地运行的结果）：

```text
Test Files  1 passed (1)
     Tests  12 passed (12)
```

注意：本地有一次运行出现过 `1 failed | 11 passed`，耗时异常长（约 22 分钟）。之后各运行一次 bash 和 PowerShell 版本，都是 12 通过。失败的测试名称没有保存下来，原因未查清。如果你遇到失败，请把完整输出保存到文件再查。本次修订没有重跑 `agent-session-runtime.test.ts`，因此不能据此判断它是否稳定。本次只重跑了实验 4 对应的 `2860-replaced-session-context.test.ts`（3 通过）。

### 实验 4：运行替换回归测试

目的：确认替换后扩展回调拿到新上下文，旧 `pi` 和 `ctx` 失效。

PowerShell：

```powershell
Set-Location packages/coding-agent
node ../../node_modules/vitest/dist/cli.js --run test/suite/regressions/2860-replaced-session-context.test.ts
```

bash：

```bash
cd packages/coding-agent
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/regressions/2860-replaced-session-context.test.ts
```

预期输出（本地运行的结果）：

```text
Test Files  1 passed (1)
     Tests  3 passed (3)
```

这个测试文件中的关键断言是事件顺序 `start:1 → shutdown:1 → start:2 → with:1`，见“一次替换的事件轨迹”。

### 实验 5：闭包小课（不需要模型）

目的：验证“读出副本”和“替换时复制”的行为。

步骤：把小课代码，加上一行 `console.log("assert ok:", seen[0], holder.values[0]);`，保存为系统临时目录下的一个 `.ts` 文件，用 Node 运行，结束后删除。

PowerShell：

```powershell
$f = Join-Path $env:TEMP 'pi-task07-closure-demo.ts'
# 把小课代码（加上 console.log 那一行）写入 $f，然后：
node $f
Remove-Item -LiteralPath $f
```

bash：

```bash
f="${TMPDIR:-/tmp}/pi-task07-closure-demo.ts"
# 把小课代码（加上 console.log 那一行）写入 "$f"，然后：
node "$f"
rm -f "$f"
```

预期输出（本地运行的结果）：

```text
assert ok: old new
(node:…) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
```

退出码为 0。Node 23 会打印类型剥离的实验性警告，这不影响结果。

### 实验 6：练习（未运行）

目的：用 `createHarness` 的 faux 假模型验证“每个 harness 有独立会话”。

本次没有在仓库中创建测试文件，因此下面的代码没有运行，也没有输出。要运行它，需要把它保存为 `packages/coding-agent/test/suite/` 下的临时文件，运行后删除。运行命令与实验 3 相同，只是文件路径不同。

```typescript
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { createHarness } from "./harness.ts";

it("two harnesses keep their own event lists", async () => {
  const first = await createHarness();
  const second = await createHarness();
  try {
    first.setResponses([fauxAssistantMessage("one")]);
    second.setResponses([fauxAssistantMessage("two")]);
    await first.session.prompt("hello");
    expect(first.eventsOfType("agent_end")).toHaveLength(1);
    expect(second.eventsOfType("agent_end")).toHaveLength(0);
  } finally {
    first.cleanup();
    second.cleanup();
  }
});
```

要点：

- `createHarness()` 是异步函数，必须 `await`。
- `cleanup()` 会调用 `session.dispose()`、注销 faux 供应商，并删除临时目录。把它放进 `finally`。

练习问题：如果把 `cleanup()` 放在 `await first.session.prompt(...)` 之后，但不放进 `finally`，测试失败时会发生什么？

## 自测题

1. 用户在项目 A 中输入 `/resume`，打开项目 B 的会话。为什么不能只把 `session.messages` 替换成 B 的消息？请至少给出两个会出错的对象。
2. 按顺序写出 `switchSession` 的六个阶段，并指出哪一阶段之后旧会话已经不能再用。
3. `AgentSession.dispose()` 的第一段为什么用 `try/catch` 包住并吞掉异常？`invalidate` 的错误信息为什么写成使用说明？
4. 把下列资源分类为“进程级”“cwd 绑定”或“会话级”：`agentDir`、项目设置、内置工具、`SessionManager`、扩展工厂列表、`CacheWarmer`。
5. 宿主（SDK 调用者和交互模式）在“重绑”上各自要做什么？

### 参考答案

1. 旧会话的工具、设置、资源加载器和扩展都绑定项目 A 的目录。只替换消息，工具仍然在 A 中读文件，A 的设置和扩展仍在生效。至少两个对象会出错：内置工具（按 cwd 建立）和项目设置（`SettingsManager` 按 cwd 读取项目层）。扩展和资源加载器也会出错。
2. 阶段为：(1) `emitBeforeSwitch`，扩展可取消；(2) `SessionManager.open` 并 `assertSessionCwdExists`；(3) `teardownCurrent`，之后旧会话已经释放；(4) 工厂 `createRuntime`；(5) `apply`；(6) `finishSessionReplacement`，先 `rebindSession` 再 `withSession`。阶段 3 之后旧会话不能再用。
3. 释放必须完成，哪怕某个取消钩子出错。否则会留下没有释放的资源。`invalidate` 的错误信息写成使用说明，是为了在旧上下文被误用时，直接告诉开发者应该改用 `withSession` 传入的新上下文。
4. `agentDir`：进程级。项目设置：cwd 绑定。内置工具：cwd 绑定。`SessionManager`：会话级。扩展工厂列表：进程级（由 CLI 在闭包中捕获）。`CacheWarmer`：会话级。
5. SDK 调用者：在每次替换后重新 `subscribe`（或调用自己的 `bindSession`），或者在创建 runtime 后用 `setRebindSession` 注册一次。交互模式：通过 `setRebindSession` 重新挂界面，通过 `setBeforeSessionInvalidate` 同步拆除扩展提供的界面组件。

## 常见错误

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 替换会话后，界面不再显示新回答 | 订阅仍绑在旧 `AgentSession` 上 | 用 `setRebindSession` 注册重绑，或在每次替换后重新调用 `subscribe` |
| 扩展报错 “This extension ctx is stale …” | 替换或 `reload` 后，旧 `ctx` 已被 `invalidate` | 把替换后的工作放进 `withSession`，只使用回调传入的新上下文 |
| 切到另一个项目的会话后，设置或工具还是旧项目的 | 用旧 cwd 算好的选项去建新会话 | 让工厂接收新 cwd，重新创建服务和选项，不要手拼选项 |
| 程序退出后仍有模型请求，产生费用 | 只断开了订阅，没有释放缓存预热；或退出时仍有运行中的请求 | 在 `finally` 中调用 `dispose`；若可能仍在运行，先 `await session.abort()` |
| 工厂抛错后，`runtime.session` 不能正常使用 | 拆除在前、`apply` 在后。失败时 runtime 仍指向已释放的旧会话 | 把创建失败当作需要重建 runtime 的错误；不要假设会自动回滚 |

### 每种错误的细节

下面对每条错误写出现象、复现情况和源码依据。“未在本地验证”表示没有运行过对应的场景，只根据源码推断。

1. 替换后界面不显示新回答

- 现象：`/resume` 之后，界面仍停在旧内容，新回答没有出现。
- 为什么会这样：订阅挂在旧会话的 `_eventListeners` 上。替换时旧列表被清空，新会话没有这个订阅者，所以新事件不会到达界面。
- 复现：未在本地验证（需要交互终端）。
- 源码依据：交互模式在构造函数中调用 `setRebindSession`，见 `packages/coding-agent/src/modes/interactive/interactive-mode.ts`。

2. 扩展报 “This extension ctx is stale”

- 现象：扩展在替换后继续使用旧的 `pi` 或 `ctx`，调用时抛出错误，错误文本以 “This extension ctx is stale” 开头。
- 为什么会这样：`dispose()` 调用 `_extensionRunner.invalidate(...)`，旧上下文被标记为失效。
- 复现：`packages/coding-agent/test/suite/regressions/2860-replaced-session-context.test.ts` 中的用例“invalidates stale pi/ctx”会记录旧 `ctx` 与旧 `pi` 的调用是否抛错。本次修订时运行该文件，结果为 3 通过，耗时约 8 秒。`packages/coding-agent/test/agent-session-runtime-events.test.ts` 中也有同一段错误文本的断言。
- 解决：把替换后的工作放进 `withSession`，只使用回调参数中的新上下文。

3. 切到另一个项目的会话后，设置或工具仍是旧项目的

- 现象：打开项目 B 的会话后，B 的 `.pi/settings.json` 没有生效，工具或扩展仍像项目 A 的。
- 为什么会这样：如果替换时复用了旧的 `services`，或者用旧 cwd 算出的选项去建新会话，就会出现这种情况。
- 复现：未在本地验证。
- 源码依据：`switchSession` 把 `sessionManager.getCwd()`（B 的目录）传给工厂，工厂再调用 `createAgentSessionServices({ cwd })`。
- 解决：不要在替换前从旧 `services` 读出设置再拼给新会话。让工厂接收新 cwd。

4. 程序退出后仍有模型请求

- 现象：退出后，模型服务仍有用量，或者日志中仍有预热请求。
- 为什么会这样：`dispose()` 不等待运行结束，它只发出取消信号。如果运行还在进行，它的请求可能继续。另外，只断开订阅而不调用预热的 `cancel()`，后台预热也会继续。
- 复现：未在本地验证（需要能产生预热请求的模型或假模型）。`packages/coding-agent/test/cache-warmer.test.ts` 中有对 `cancel()` 的测试，但它不是这个错误的复现。
- 源码依据：`abort()` 会调用 `waitForIdle()`，`dispose()` 不会。`dispose()` 对 `_cacheWarmer` 调用 `cancel()`。
- 解决：退出前先 `await session.abort()`，再调用 `dispose()`。把 `dispose()` 放进 `finally`。

5. 工厂抛错后，`runtime.session` 不能正常使用

- 现象：`/new` 或 `/resume` 报错后，`runtime.session` 指向的会话已经释放。之后对它的操作会出错，或者行为不完整。
- 为什么会这样：`teardownCurrent` 先于工厂执行，所以旧会话在工厂开始前已经释放。工厂抛错时，`apply` 不会执行，runtime 没有切换到新会话。
- 复现：未在本地验证（需要让工厂抛错）。
- 源码依据：`switchSession` 中是 `this.apply(await this.createRuntime(...))`，只有工厂成功才会执行 `apply`。
- 解决：把这类错误当作需要重建 runtime 的信号。不要假设 runtime 会回滚到旧会话。

## 选读：源码深入（可选，跳过不影响主线）

选读，跳过不影响主线。以下内容是细节，需要时再读。

### A. createAgentSession 的装配顺序

`createAgentSession` 在 `packages/coding-agent/src/core/sdk.ts`。它的装配顺序是：

1. 确定 cwd 与 agentDir。cwd 的来源依次为：`options.cwd`、会话管理器已有的 cwd、`process.cwd()`。这是因为恢复的会话可能属于别的目录。注意这里用 `??`，空字符串会继续向后回落。
2. 创建 `ModelRuntime`、`SettingsManager`、`SessionManager`。`authPath` 和 `modelsPath` 只有在显式给出 `options.agentDir` 时才设置；否则传 `undefined`，让 `ModelRuntime.create` 使用它自己的默认路径。
3. 若未传入 `resourceLoader`，创建 `DefaultResourceLoader` 并 `reload()`。
4. 检查会话是否已有历史。`buildSessionContext()` 给出消息；`getBranch()` 查找 `thinking_level_change` 条目。两者要分开看，因为 `buildSessionContext()` 默认的 `thinkingLevel` 是 `"off"`，无法表达“未记录”。
5. 决定模型，四步降级：
   - 显式 `options.model`；
   - 会话恢复：模型必须同时满足“仍在目录中”和“有配置好的认证”，缺一不可；
   - `findInitialModel`，先看设置里的默认值，再看供应商默认值；
   - 都没有时，`modelFallbackMessage` 为 `formatNoModelsAvailableMessage()` 的结果。
6. 决定思考级别：显式选项 → 会话恢复（有记录用记录，老会话用设置默认）→ 每个模型的覆盖 → 全局默认。最后按模型能力钳制（`clampThinkingLevel`）。没有模型时强制为 `"off"`。
7. 计算工具集，用三个变量：`allowedToolNames`（上限）、`initialActiveToolNames`（初始激活）、`excludedToolNames`（黑名单）。`usesDefaultTools` 交给会话，用来区分 `noTools: "builtin"` 和 `"all"`。
8. 包装 `convertToLlm`：若设置了 `blockImages`，把图片替换为占位文本。设置在每次调用时动态读取，中途修改立即生效。
9. 创建 `extensionRunnerRef`（一个空盒子 `{ current?: ExtensionRunner }`）。`CacheWarmer` 和各个 provider 钩子都通过它访问扩展运行器。运行器稍后由会话填入，因此在未绑定时钩子安全地跳过。
10. 创建 `Agent`，初始 `systemPrompt` 为空字符串，`tools` 为空数组，`messages` 为投影出的历史。`streamFn` 在会话请求时启动缓存预热，并调用 `modelRuntime.streamSimple`。
11. 若是新会话，追加 `model_change` 和 `thinking_level_change` 条目；若是老会话且缺少思考级别条目，补写一条。
12. 创建 `AgentSession`，把上面的 15 项全部传入。返回 `{ session, extensionsResult, modelFallbackMessage }`。

### B. 替换的完整代码

以下代码来自 `packages/coding-agent/src/core/agent-session-runtime.ts`，已对照源码核对。`...` 表示省略了与主线无关的参数或分支。

拆除、应用、重绑三个私有方法：

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

`switchSession`（恢复）：

```typescript
async switchSession(sessionPath: string, options?: { cwdOverride?: string; withSession?: ...; projectTrustContextFactory?: ... }): Promise<{ cancelled: boolean }> {
  const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
  if (beforeResult.cancelled) {
    return beforeResult;
  }

  const previousSessionFile = this.session.sessionFile;
  const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
  assertSessionCwdExists(sessionManager, this.cwd);
  await this.teardownCurrent("resume", sessionManager.getSessionFile());
  this.apply(
    await this.createRuntime({
      cwd: sessionManager.getCwd(),
      agentDir: this.services.agentDir,
      sessionManager,
      sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
      projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
    }),
  );
  await this.finishSessionReplacement(options?.withSession);
  return { cancelled: false };
}
```

注意 `createRuntime` 收到的 cwd 是 `sessionManager.getCwd()`，即目标会话记录的 cwd，不是当前 runtime 的 cwd。

`newSession`（新建）：

```typescript
async newSession(options?: { parentSession?: string; setup?: ...; withSession?: ... }): Promise<{ cancelled: boolean }> {
  const beforeResult = await this.emitBeforeSwitch("new");
  if (beforeResult.cancelled) {
    return beforeResult;
  }

  const previousSessionFile = this.session.sessionFile;
  const sessionDir = this.session.sessionManager.getSessionDir();
  const sessionManager = this.session.sessionManager.isPersisted()
    ? SessionManager.create(this.cwd, sessionDir)
    : SessionManager.inMemory(this.cwd);
  if (options?.parentSession) {
    sessionManager.newSession({ parentSession: options.parentSession });
  }

  await this.teardownCurrent("new", sessionManager.getSessionFile());
  this.apply(
    await this.createRuntime({
      cwd: this.cwd,
      agentDir: this.services.agentDir,
      sessionManager,
      sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
    }),
  );
  if (options?.setup) {
    await options.setup(this.session.sessionManager);
    this.session.refreshContext();
  }
  await this.finishSessionReplacement(options?.withSession);
  return { cancelled: false };
}
```

注意：内存会话新建后仍是内存会话。`setup` 在新会话应用之后执行，因此它不是只读的校验回调。若它抛错，runtime 已经指向新会话，但还没有完成重绑。

`fork`（分叉）有三个分支。下面是骨架，省略了错误处理：

```typescript
// position 为 "before" 时，选中的必须是 user 消息；targetLeafId 取它的 parentId，
// 并把它的文本作为 selectedText 返回给编辑器。position 为 "at" 时，targetLeafId 就是选中条目。
if (this.session.sessionManager.isPersisted()) {
  if (!targetLeafId) {
    // 分支一：持久化，且目标为空（在第一条消息之前分叉）
    // 新建管理器，newSession({ parentSession })，然后 teardown、createRuntime
  }
  // 分支二：持久化，有目标叶子
  // 打开当前文件，createBranchedSession(targetLeafId) 先写出新文件，
  // 然后 teardown、createRuntime
} else {
  // 分支三：内存会话
  // 先 teardown，再在同一个 SessionManager 上 newSession 或 createBranchedSession，
  // 然后 createRuntime
}
```

分支二的顺序需要注意：分支文件在拆除旧会话之前已经写出。

`importFromJsonl`（导入）：

```typescript
async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
  const resolvedPath = resolvePath(inputPath);
  if (!existsSync(resolvedPath)) {
    throw new SessionImportFileNotFoundError(resolvedPath);
  }

  const sessionDir = this.session.sessionManager.getSessionDir();
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }

  let destinationPath = join(sessionDir, basename(resolvedPath));
  const sourceAlreadyStored = resolve(destinationPath) === resolvedPath;
  if (!sourceAlreadyStored) {
    const { name, ext } = parse(destinationPath);
    let suffix = 1;
    while (existsSync(destinationPath)) {
      destinationPath = join(sessionDir, `${name}-${suffix++}${ext}`);
    }
  }
  const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
  if (beforeResult.cancelled) {
    return beforeResult;
  }

  const previousSessionFile = this.session.sessionFile;
  if (!sourceAlreadyStored) {
    copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
  }

  const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
  assertSessionCwdExists(sessionManager, this.cwd);
  await this.teardownCurrent("resume", sessionManager.getSessionFile());
  this.apply(
    await this.createRuntime({
      cwd: sessionManager.getCwd(),
      agentDir: this.services.agentDir,
      sessionManager,
      sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
    }),
  );
  await this.finishSessionReplacement();
  return { cancelled: false };
}
```

`COPYFILE_EXCL` 保证不覆盖已有文件。同名时，代码会追加 `-1`、`-2` 等后缀。

### C. 释放的完整代码

会话级（`packages/coding-agent/src/core/agent-session.ts`）：

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
    "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().",
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

这里的 `dispose` 是同步的。它发出取消信号，但不等待 `Agent` 运行结束。若需要等待，先 `await session.abort()`。

运行时级（同一文件）：

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

`session_shutdown` 的 `reason` 取值为 `"quit" | "reload" | "new" | "resume" | "fork"`，定义在 `packages/coding-agent/src/core/extensions/types.ts`。退出与替换共用同一种事件，扩展只需实现一种清理逻辑。

### D. 替换失败时的状态表

替换代码没有统一的 `try/catch` 回滚。下表按阶段列出失败时的状态。

| 失败阶段 | 旧会话是否已拆除 | 可能留下的影响 |
| --- | --- | --- |
| `session_before_switch` 等前置钩子抛错 | 否 | 异常向上传播；旧会话不变 |
| 打开目标文件，或 `assertSessionCwdExists` 失败（switch） | 否 | 旧 runtime 仍在；目标文件未修改 |
| `importFromJsonl` 复制之后 cwd 检查失败 | 否 | 复制出的文件仍在会话目录中，代码不会删除它 |
| `teardownCurrent` 中 abort、shutdown 或 dispose 抛错 | 不确定 | 取决于失败发生在哪一步 |
| 拆除完成后工厂抛错 | 是 | runtime 字段仍指向已释放的旧会话；新对象没有被 `apply` |
| `apply` 之后 `rebindSession` 或 `withSession` 抛错 | 是 | runtime 已指向新会话，但宿主绑定或后续动作可能未完成 |

需要新增替换阶段时，先决定失败时应该怎样：传播异常、保留副本、清理目标文件，还是提供恢复界面。然后用测试固定行为。不要假设有事务语义。

### E. 两种 subscribe 的契约不同

`Agent.subscribe` 的监听器类型是 `(event, signal) => Promise<void> | void`。`Agent` 在派发时逐个 `await`（见 `packages/agent/src/agent.ts` 中的派发循环）。因此异步监听器的工作会被等待。

`AgentSession.subscribe` 的监听器类型是 `(event) => void`。`_emit` 逐个同步调用，不 `await`。如果监听器返回 Promise，它的拒绝不会被会话等待，可能成为未处理的拒绝。

因此，在会话监听器里启动异步工作时，要自己处理失败：

```typescript
session.subscribe((event) => {
  if (event.type !== "agent_settled") return;
  void saveDiagnostics().catch((error: unknown) => {
    console.error("Could not save diagnostics", error);
  });
});
```

`void` 只表示“有意不等待”，并不处理拒绝。`.catch` 才负责处理。如果保存必须在 `prompt()` 完成前结束，应当在宿主自己的异步流程中显式 `await`。

### F. 与 CLI 和示例的对应关系

- `main.ts` 的 `createRuntime` 是一个局部工厂。它先调用 `createAgentSessionServices`，再调用 `createAgentSessionFromServices`，并把扩展工厂列表（`extensionFactories`）放在闭包中。初始会话和之后的每次替换都走它。
- `examples/sdk/13-session-runtime.ts` 演示了与 `main.ts` 相同的结构，但它每次工厂调用都新建 `ModelRuntime`。
- `interactive-mode.ts` 在 `InteractiveMode` 中用 `setBeforeSessionInvalidate` 拆除界面组件，用 `setRebindSession` 重新挂界面。退出时先停止界面，再调用 `runtimeHost.dispose()`。
- `print-mode.ts` 与 `rpc-mode.ts` 在退出时先取消自己的订阅，再调用 `runtimeHost.dispose()`。在这些调用点上没有看到显式的 `abort()`。这些退出路径是否只在会话空闲时发生，本次没有验证。

### G. 文档与实现的不一致（只记录，未修改源码）

1. `sdk.ts` 中 `createAgentSession` 的 JSDoc 示例写了 `continueSession: true`，但 `CreateAgentSessionOptions` 中没有这个字段。
2. `CreateAgentSessionOptions.modelRuntime` 的注释写“默认使用 `agentDir/auth.json` 和 `models.json`”。实际上，只有显式传入 `options.agentDir` 时，代码才设置这两个路径；否则由 `ModelRuntime.create` 自己决定默认路径。

### H. 两条创建路径的细节差异

`createAgentSession` 只在显式给出 `options.agentDir` 时设置 `authPath` 和 `modelsPath`。`createAgentSessionServices` 则始终使用 `join(agentDir, "auth.json")` 和 `join(agentDir, "models.json")`。两条路径在“没有显式 agentDir”时的默认值来源不同。这是有意的还是遗漏，本次没有确认。

### I. 未运行的示例

`examples/sdk/01-minimal.ts` 和 `examples/sdk/13-session-runtime.ts` 通过包名 `@earendil-works/pi-coding-agent` 导入。该包的 `exports` 指向 `dist/`，所以运行它们需要先构建。仓库规则不允许在未经请求时运行 `npm run build`，因此本篇没有运行它们。它们也需要模型或默认模型的配置。

## 下一篇

下一篇 `task-08-session-tree.md` 解决新的问题：会话文件里的条目如何组成树，恢复或分叉时，“当前位置”和“活动分支”怎样从文件中重新算出来。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| AgentSession | 包住 `Agent`、接上设置、会话文件和扩展的应用层会话 | 核心概念 1 |
| 资源所有权 | 资源由谁创建、谁持有、谁释放 | 核心概念 2 |
| cwd 绑定服务 | 依赖工作目录的设置、资源、工具等对象的集合 | 核心概念 3 |
| AgentSessionServices | cwd 绑定服务的类型 | 核心概念 3 |
| AgentSessionRuntime | 持有当前会话和服务，并负责替换会话的容器 | 核心概念 4 |
| 工厂 | 保存“如何从零创建 runtime”的函数，类型为 `CreateAgentSessionRuntimeFactory` | 核心概念 4 |
| 拆除（teardown） | 替换前对旧会话做的收尾动作序列 | 核心概念 5 |
| 释放（dispose） | `AgentSession.dispose()`，停止后台工作并作废扩展上下文 | 核心概念 5 |
| 取消（abort） | 请求当前工作尽快停止，并等待收束 | 核心概念 5 |
| 等待空闲（waitForIdle） | 等待当前运行和事件监听器结束 | 核心概念 5 |
| session_shutdown | 通知扩展会话即将结束的事件，`reason` 说明原因 | 核心概念 5 |
| 重绑（rebind） | 替换后，宿主把订阅和界面挂到新会话上 | 核心概念 6 |
| withSession | 替换完成后执行一次的回调，拿到新会话的上下文 | 核心概念 6 |
| 诊断（diagnostics） | 创建服务或会话时收集的非致命问题，由调用方决定如何显示 | 两条创建路径 |
| 进程级 / 会话级 | 资源随进程存在，或随会话存在的范围 | AgentSessionRuntime：替换时拆什么、建什么 |
