# 附录 J：API 速查（按包）

> 用途：写 SDL/扩展时"该从哪个包 import 什么"。**完整清单以各包 `src/index.ts` 为准**（本表按组列"最常用"的，不是全量导出）。查找方法见 J.7。

---

## J.1 四个包的导入原则

| 你要做什么 | 从哪导入 | 备注 |
|---|---|---|
| 直接跟模型交互（自建 agent/工具循环） | `@earendil-works/pi-ai`（核心，无副作用） | 供应商工厂在子路径 `pi-ai/providers/*` |
| 自建"模型+工具+事件"运行时 | `@earendil-works/pi-agent-core` | 不认识文件/终端/扩展 |
| 画终端界面 | `@earendil-works/pi-tui` | 与业务无关的独立库 |
| 嵌入完整编码助手 / 写扩展 | `@earendil-works/pi-coding-agent` | 含 SDK、扩展类型、工具、组件 |

`pi-ai` 的根入口刻意"无副作用"（源码注释原文）：

```text
Core only, side-effect free: no generated catalogs, no provider factories,
no api-registry, no OAuth implementations, no compat. Provider factories live under
"@earendil-works/pi-ai/providers/*", API implementations under "@earendil-works/pi-ai/api/*",
the old global API under "@earendil-works/pi-ai/compat".
```

——意思是：**只想用类型/工具函数的人，`import ... from "pi-ai"` 不会把几十个供应商 SDK 拖进内存**（入口成本预算，第 20.2.4 节）。

## J.2 `pi-ai` 速查

| 组 | 常用导出 | 说明 |
|---|---|---|
| typebox 再导出 | `Type`（值）、`Static`/`TSchema`（类型） | 工具 schema 的唯一推荐来源（不用直接依赖 typebox） |
| 核心类型 | `Model`、`Api`、`Message` 四角色、内容块、`AssistantMessageEvent`、`Usage`、`StopReason`、`Context`、`TranscriptContext` | 第 4、5 章 |
| 模型集合 | `createModels`、`Provider`/`Models` 接口、`createProvider` | 第 5.2 节 |
| 事件流 | `EventStream` | 第 3.8 节的"流出事件"容器 |
| 转录工具 | `normalizeContext`、`getCurrentSystemMessage`、`getCurrentTools`、`getToolStateChanges`、`toToolDeclaration` | 第 4、7.3 节 |
| 校验 | `validateToolArguments` | 第 7.4 节 |
| 文本工具 | `contentText`、`getSystemMessageText`、`renderSystemMessageUpdate` | 消息文本提取 |
| 判定工具 | `isContextOverflow`、`isRecoverableLength`、重试辅助（`utils/retry`） | 第 6、10 章 |
| 错误分类/诊断 | `utils/diagnostics` | |
| 其他 | `uuidv7`（`utils/uuid`）、`json-parse` 工具、`session-resources` | |
| faux | `fauxAssistantMessage`、`fauxToolCall`、`fauxText`、`fauxThinking`、`createFauxCore`、`fauxProvider` | 第 5.7 节（测试） |
| 认证类型 | `auth/context`、`auth/credential-store`、`auth/types` 的导出、OAuth 类型 | 第 5.6 节 |

子路径（`package.json` 的 exports）：`./models`、`./compat`、`./providers/*`、`./api/*`、`./utils/*`、`./oauth`、`./bedrock-provider`、`./bun-oauth`。

- **要流式入口/假供应商注册**：`pi-ai/compat` 的 `stream`/`streamSimple`/`complete`/`completeSimple`/`registerFauxProvider`/`registerApiProvider`（第 5.4 节）。
- **要具体供应商**：`pi-ai/providers/anthropic` 的 `anthropicProvider()` 等（目录见 `providers/*.ts`）。

## J.3 `pi-agent-core` 速查

| 组 | 导出 | 说明 |
|---|---|---|
| 有状态运行时 | `Agent`、`AgentOptions`、`AgentInitialState` | 第 3.7、D2 章 |
| 循环函数 | `agentLoop`、`agentLoopContinue`、`runAgentLoop`、`runAgentLoopContinue`、`runToolCall` | D1 |
| 默认流函数 | `setDefaultStreamFn` | 只导出 setter（getter 是内部） |
| 类型 | `AgentMessage`、`AgentEvent`、`AgentTool`、`AgentToolResult`、`AgentState`、`AgentLoopConfig`、`FinishTurn`、`QueueMode` 等 | 第 4、6、7 章 |
| 代理 | `proxy.ts` 的导出（Agent 的事件/状态代理） | 少见用途 |

【陷阱】`Agent` 需要一个 `streamFn`（或用 `setDefaultStreamFn` 安装宿主提供的实现——`pi-coding-agent` 的 `sdk.ts` 顶部就干了这件事，第 3.5 节）。
## J.4 `pi-tui` 速查

| 组 | 常用导出 | 说明 |
|---|---|---|
| 渲染器 | `TuiMainScreen`（含 `TuiMainScreenRenderState`）、`TuiAltScreen`（含 `TuiAltScreenOptions`）、`TUI` 接口 | 第 17.1、D13 第 1 节 |
| 终端 | `ProcessTerminal`、`Terminal`、`StdinBuffer`、`WheelScrollLines`、`isAppleTerminalSession` | 输入与能力探测 |
| 组件 | `Text`、`TruncatedText`、`Markdown`（`MarkdownTheme`/`MarkdownOptions`）、`Image`（`ImageTranscoder`/`setImageTranscoder`）、`Box`、`Container`、`VStack`、`HStack`、`Spacer`、`Input`、`Editor`（`EditorTheme`/`EditorOptions`）、`SelectList`、`SettingsList`（`SettingItem`）、`ScrollView`（`ScrollViewScrollbar`）、`Loader`、`CancellableLoader`、`MouseRegion` | 第 17.3 节 |
| 自定义编辑器 | `EditorComponent`、`CustomEditor`（在 coding-agent 侧导出，见 J.5） | 第 17.4.3 节 |
| 输入 | `Key`、`parseKey`、`matchesKey` | 第 17.4.1 节 |
| 宽度/文本 | `visibleWidth`、`truncateToWidth`、`sliceByColumn`、`wrapTextWithAnsi`（以 index.ts 为准） | 第 17.2/17.10 节 |
| 模糊匹配 | `fuzzyFilter`、`fuzzyMatch`、`FuzzyMatch` | 选择器搜索 |
| 其他工具 | `renderLatex`、`oklabToOkhslLightness`、`getNativeClipboard`、图片协议辅助（`allocateImageId`/`calculateImageRows`/`deleteAllKittyImages` 等） | 按需 |

【陷阱】终端光标与 IME 相关常量（`CURSOR_MARKER`、`Focusable`）也在本包——写自定义光标组件时查它们（第 17.4.2 节）。

## J.5 `pi-coding-agent` 速查（按组）

### J.5.1 装配与 SDK（第 15 章）

| 导出 | 说明 |
|---|---|
| `createAgentSession`、`CreateAgentSessionOptions`、`CreateAgentSessionResult` | 一步式会话创建 |
| `createAgentSessionServices`、`createAgentSessionFromServices`、`AgentSessionServices` | 两步式（cwd 绑定服务） |
| `createAgentSessionRuntime`、`AgentSessionRuntime`、`CreateAgentSessionRuntimeFactory` | 可替换运行时（第 8 章） |
| `AgentSession`（+ `AgentSessionConfig`/`AgentSessionEvent`/`AgentSessionEventListener`/`PromptOptions`/`SessionStats`） | 会话本体 |
| `ModelRuntime`、`ModelRegistry`（视导出）、`findInitialModel`、`restoreModelFromSession` | 模型解析（第 D11） |
| `SessionManager`、`getDefaultSessionDir`（视导出） | 会话存储（第 9 章） |
| `SettingsManager` | 设置（第 11 章） |
| `DefaultResourceLoader`、`ResourceLoader` | 资源发现（第 11 章） |
| `parseArgs`、`Args` | CLI 参数解析 |
| `VERSION`、`getAgentDir`、`getPackageDir`、`getDocsPath`、`getReadmePath`、`getExamplesPath`、`CONFIG_DIR_NAME` | 路径与版本（第 11.2 节） |

【陷阱】名字里带 `types` 的接口一般与对应函数配对导出（如 `CreateAgentSessionOptions`）；写代码时优先让编辑器补全而不是背名单。

### J.5.2 扩展系统（第 13、14 章）

| 组 | 导出 |
|---|---|
| 注册/定义 | `defineTool`、`ToolDefinition`、`ExtensionAPI`、`ExtensionFactory`、`InlineExtension`、`Extension`、`RegisteredTool`、`RegisteredCommand` |
| 运行时 | `ExtensionRunner`、`createExtensionRuntime`、`discoverAndLoadExtensions`、`LoadExtensionsResult`、`createEventBus`、`EventBus` |
| 上下文 | `ExtensionContext`、`ExtensionToolContext`、`ExtensionCommandContext`、`ExecuteToolOptions`、`ExtensionUIContext`、`ExtensionUIDialogOptions` |
| 事件与结果（按族） | `BeforeAgentStartEvent(Result)`、`ToolCallEvent(Result)`、`ToolResultEvent(Result)`、`MessageEndEvent(Result)`、`InputEvent(Result)`、`SessionBefore*Event(Result)`、`Session*Event`、`TurnEndEvent(Result)`、`UserBashEvent(Result)`、`Provider*Event`、`CacheWarmingDecisionEvent(Result)`、`ProjectTrust*`、`AgentBeforeSettleEvent(Result)` 等 |
| 工具渲染 | `ToolRenderers`、`ToolRendererResolver`、`ToolRenderResultOptions`、各类 `*ToolCallEvent/*ToolResultEvent`、`is*ToolResult` 类型守卫 |
| 工具实现工厂 | `createReadToolDefinition`、`createBashToolDefinition`、`createEditToolDefinition`、`createWriteToolDefinition`、`createGrepToolDefinition`、`createFindToolDefinition`、`createLsToolDefinition`、`createPowerShellToolDefinition`、`createLocalBashOperations`、`withFileMutationQueue` |
| 截断工具 | `truncateHead`、`truncateTail`、`truncateLine`、`formatSize`、`DEFAULT_MAX_LINES`、`DEFAULT_MAX_BYTES` |
| 压缩工具 | `compact`、`prepareBranchEntries`、`collectEntriesForBranchSummary`、`generateBranchSummary`、`generateSummary(WithUsage)`、`serializeConversation`、`shouldCompact`、`findCutPoint`、`findTurnStartIndex`、`estimateTokens`、`calculateContextTokens`、`getLastAssistantUsage`、`DEFAULT_COMPACTION_SETTINGS` |
| 自带扩展 | `createCodemodeExtension`、`createMcpExtension`、`createToolSearchExtension`（SDK 需显式加入，第 15.4.8 节） |
| 信任 | `ProjectTrustStore`、`hasTrustRequiringProjectResources` |
| 虚拟模型 | `VirtualModelDefinition`、`ModelRoute*`、`VIRTUAL_MODEL_STATE_ENTRY` |
| 技能/模板 | `loadSkills`、`loadSkillsFromDir`、`Skill`、`SkillFrontmatter`、`PromptTemplate`、`parseSkillBlock`、`parseFrontmatter`、`stripFrontmatter` |

### J.5.3 运行模式与 UI（第 16、17 章）

| 组 | 导出 |
|---|---|
| 模式 | `main`、`MainOptions`、`InteractiveMode`、`InteractiveModeOptions`、`runPrintMode`、`PrintModeOptions`、`runRpcMode` |
| RPC 客户端 | `RpcClient`、`RpcClientOptions`、`RpcEventListener`、`RpcCommand/RpcResponse/RpcSessionState/RpcExtensionUIRequest/RpcExtensionUIResponse`、`JsonAgentSessionEvent` |
| 组件（扩展可用） | `AssistantMessageComponent`、`ToolExecutionComponent`、`FooterComponent`、`CustomEditor`、`ModelSelectorComponent`、`SessionSelectorComponent`、`SettingsSelectorComponent`、`TreeSelectorComponent`、`LoginDialogComponent`、`OAuthSelectorComponent`、`UserMessageComponent`、`BorderedLoader`、`DynamicBorder`、`renderDiff`、`truncateToVisualLines` 等 |
| 键位辅助 | `keyHint`、`keyText`、`rawKeyHint` |
| 主题 | `Theme`、`getMarkdownTheme`、`getSelectListTheme`、`getSettingsListTheme`、`highlightCode`、`initTheme`、`ThemeToken` 等 |
| 系统工具 | `copyToClipboard`、`convertToPng`、`resizeImage`、`formatDimensionNote`、`detectSupportedImageMimeTypeFromFile`、`getShellConfig`、`getPowerShellConfig`、`generateDiffString`、`generateUnifiedPatch` |

子路径：`./rpc-entry`（RPC 子进程入口）、`./client`（实验客户端，source 条件）、`./experimental/plugin`。

## J.6 常用 import 组合（照抄起步）

**SDK 最小**（第 15 章）：

```typescript
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
```

**扩展**（第 13、14 章）：

```typescript
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";        // 自定义渲染时
```

**直接调模型（pi-ai 核心 + 供应商）**：

```typescript
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { streamSimple } from "@earendil-works/pi-ai/compat";
```

**自建 Agent**（agent README 的写法）：

```typescript
import { Agent } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
```

**测试（faux + harness）**：

```typescript
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createHarness } from "./harness.ts";          // 仓库内相对路径
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
```

**RPC 客户端**：

```typescript
import { RpcClient } from "@earendil-works/pi-coding-agent";
```

## J.7 怎么查"到底导出了什么"

1. **读 `src/index.ts`**（四个包各一个）——权威、最快；
2. **编辑器转定义**：对任意符号 F12；悬停看签名与文档注释；
3. **`dist/*.d.ts`**：安装形态下的类型入口（与 src 对应）；
4. **docs**：`packages/coding-agent/docs/sdk.md`（SDK 面）、`docs/extensions.md`（扩展面）、各包 README；
5. **本手册**：H（数据形状）、I（配方）、[source-map](source-map.md)（问题→文件→符号）。

【陷阱】不要凭记忆猜导出名：**本仓库同名概念多、子路径多**（`pi-ai` vs `pi-ai/compat`、`toolDefinition` vs `AgentTool`）。查一下的成本远低于改错的成本。