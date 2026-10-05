# 附录 B：源码地图

> 用法：先在这里找"问题 → 文件 → 符号"，再用编辑器的"转到定义"核对。**行号会漂移，以符号名定位。** 测试列给出可以参考的现有测试（用于学写测试的样例）。

## B.1 入口与启动

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| workspace 包依赖图（manifest 边） | 各 `packages/*/package.json`；代表性边见 `packages/agent/src/agent-loop.ts`、`packages/ai/src/types.ts`、`packages/coding-agent/src/experimental/client-tui.ts`、`packages/client/src/client.ts` | `dependencies`、`import` | 静态核对；第 0.3 节标明范围与类型导入 |
| `pi` 命令的源码入口 | `packages/coding-agent/src/cli.ts` | （顶层代码） | — |
| 进程级初始化（标题/环境标记/静默警告） | `packages/coding-agent/src/cli/setup.ts` | `setupCli` | — |
| 源码运行脚本与 resolver | `pi-test.sh` / `pi-test.ps1` / `src/experimental/source-resolver.ts` | `registerHooks`（node:module） | — |
| 参数解析与帮助 | `packages/coding-agent/src/cli/args.ts` | `parseArgs`、`printHelp` | — |
| 主流程与模式分发 | `packages/coding-agent/src/main.ts` | `main`、`resolveAppMode` | — |
| CLI 请求模式与 TTY 推断 | 同上 | `resolveAppMode`、`toPrintOutputMode`、`main` | `test/args.test.ts` 覆盖 `--mode` 解析；模式/TTY 组合静态核对 |
| 版本号与全局目录 | `packages/coding-agent/src/config.ts` | `VERSION`、`getAgentDir`、`CONFIG_DIR_NAME` | — |
| 启动耗时打点 | `packages/coding-agent/src/core/timings.ts` + `main.ts` | `time`、`printTimings` | — |

## B.2 会话装配

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| 一步到位创建会话（SDK） | `packages/coding-agent/src/core/sdk.ts` | `createAgentSession` | `test/suite/agent-session-*.test.ts` |
| 两步式：cwd 绑定服务 | `packages/coding-agent/src/core/agent-session-services.ts` | `createAgentSessionServices`、`createAgentSessionFromServices`、`AgentSessionServices` | — |
| 可替换会话运行时 | `packages/coding-agent/src/core/agent-session-runtime.ts` | `AgentSessionRuntime`、`createAgentSessionRuntime`、`teardownCurrent`、`apply`、`finishSessionReplacement` | `test/suite/agent-session-runtime.test.ts` |
| 会话主体（158KB） | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession`（按符号跳转读） | 多个 suite 测试 |
| 会话释放 | 同上 | `dispose` | — |
| 取消当前工作并等待 idle | 同上、`packages/agent/src/agent.ts` | `AgentSession.abort`、`waitForIdle`、`Agent.abort` | `test/suite/agent-session-retry-events.test.ts`；runtime 替换先 abort 再 dispose 见 `agent-session-runtime.test.ts` |
| 扩展绑定与重载 | 同上 | `bindExtensions`、`reload` | — |
| 会话级事件类型 | 同上 | `AgentSessionEvent`、`AgentSessionEventListener` | — |

## B.3 请求旅程（第 3 章的地图）

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| 提示词进入会话（守卫/扩展命令/排队/压缩检查） | `agent-session.ts` | `prompt` | `agent-session-prompt.test.ts` |
| 运行循环包装（重试/压缩/边界） | `agent-session.ts` | `_runAgentPrompt`、`_handlePostAgentRun`、`_runBeforeSettleBoundary` | `agent-session-retry-events.test.ts`、`agent-session-boundaries.test.ts` |
| Agent 串行化与事件归约 | `packages/agent/src/agent.ts` | `Agent.prompt`、`runWithLifecycle`、`processEvents` | `packages/agent/test/` |
| 循环本体 | `packages/agent/src/agent-loop.ts` | `runAgentLoop`、`runAgentLoopContinue`、`runLoop` | 同上 |
| 一次请求折叠为一条消息 | 同上 | `streamAssistantResponse` | 同上 |
| 工具四步流水线 | 同上 | `prepareToolCall`、`executePreparedToolCall`、`finalizeExecutedToolCall` | 同上 |

## B.4 工具

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| 工具运行时契约 | `packages/agent/src/types.ts` | `AgentTool`、`BeforeToolCallResult`、`AfterToolCallResult`、`AgentToolResult` | — |
| 工具定义（注册形态） | `packages/coding-agent/src/core/extensions/types.ts` | `ToolDefinition`、`defineTool` | — |
| 内置工具工厂 | `packages/coding-agent/src/core/tools/index.ts` | `createReadTool` 等、`createCodingTools`、`createReadOnlyTools` | — |
| read 工具 | `core/tools/read.ts` | `createReadToolDefinition`、`truncateHead` 用法 | — |
| write/edit 与文件变更队列 | `core/tools/write.ts`、`file-mutation-queue.ts` | `withFileMutationQueue` | — |
| bash 工具 | `core/tools/bash.ts` | `createBashToolDefinition`、`BashOperations` | — |
| 截断 | `core/tools/truncate.ts` | `truncateHead/Tail/Line`、`DEFAULT_MAX_*` | — |
| 输出累积（流式） | `core/tools/output-accumulator.ts` | `OutputAccumulator` | — |
| 参数校验 | `packages/ai/src/utils/validation.ts` | `validateToolArguments` | — |
| 从 TypeBox schema 推导工具参数类型 | `packages/coding-agent/src/core/tools/read.ts`、`packages/agent/src/types.ts` | `readSchema`、`ReadToolInput`、`createReadTool`、`AgentTool.execute` | `packages/coding-agent/test/tools.test.ts`；第 1.3.5 节解释编译期与运行时边界 |

## B.5 模型层

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| 统一类型 | `packages/ai/src/types.ts` | `Model`、`Api`、`Message`、`AssistantMessageEvent`、`StopReason`、`Usage` | — |
| Provider/Models 接口与工厂 | `packages/ai/src/models.ts` | `Provider`、`Models`、`createProvider`、`createModels` | — |
| 统一流式入口 | `packages/ai/src/compat.ts` | `stream`、`streamSimple`、`registerFauxProvider` | — |
| 供应商适配器（例子） | `packages/ai/src/providers/anthropic.ts` | `anthropicProvider` | — |
| Anthropic provider 懒加载 | `packages/ai/src/api/anthropic-messages.lazy.ts`、`api/lazy.ts` | `anthropicMessagesApi`、`lazyApi` | — |
| Anthropic 请求参数与响应事件映射 | `packages/ai/src/api/anthropic-messages.ts` | `buildParams`、`stream`、`mapStopReason` | `packages/ai/test/anthropic-sse-parsing.test.ts` |
| Anthropic SSE 字节/行解码 | 同上 | `iterateSseMessages`、`decodeSseLine`、`iterateAnthropicEvents` | 同上 |
| OpenAI Responses 请求与 wrapper 生命周期 | `packages/ai/src/api/openai-responses.ts` | `stream`、`createClient`、`buildParams` | `openai-responses-terminal-event.test.ts` |
| Responses 事件归约、输出槽位与终态 | `packages/ai/src/api/openai-responses-shared.ts` | `processResponsesStream`、`finalizeResponse`、`mapStopReason` | `openai-responses-terminal-event.test.ts`、`openai-responses-partial-json-cleanup.test.ts` |
| Chat Completions chunk 流与兼容请求 | `packages/ai/src/api/openai-completions.ts` | `stream`、`buildParams`、`convertMessages`、`mapStopReason` | `openai-completions-provider-stream-event.test.ts`、`openai-completions-raw-stop-reason.test.ts` |
| Bedrock provider auth 与 Converse stream | `packages/ai/src/providers/amazon-bedrock.ts`、`packages/ai/src/api/bedrock-converse-stream.ts` | `bedrockAuth`、`stream`、`convertMessages`、`mapStopReason` | `bedrock-credentials.test.ts`、`bedrock-convert-messages.test.ts`、`bedrock-raw-stop-reason.test.ts` |
| Bedrock region/endpoint/headers/diagnostics | 同上 | `getConfiguredBedrockRegion`、`shouldUseExplicitBedrockEndpoint`、`appendBedrockFailureDiagnostic` | `bedrock-endpoint-resolution.test.ts`、`bedrock-custom-headers.test.ts`、`bedrock-error-metadata.test.ts` |
| 应用层模型运行时与请求认证 | `packages/coding-agent/src/core/model-runtime.ts` | `ModelRuntime.create`、`prepareRequest`、`getAuth`、`resolveModel` | `model-runtime-auth-options.test.ts`；精读 [D29](../deep-dives/D29-model-runtime-request-and-credentials.md) |
| 凭据提交后的模型/认证快照同步 | 同上、`core/runtime-credentials.ts` | `enqueueCredentialOperation`、`synchronizeCredentialState`、`RuntimeCredentials` | `model-runtime-credential-sync.test.ts`；精读 [D29](../deep-dives/D29-model-runtime-request-and-credentials.md) |
| provider 配置合并与动态模型刷新 | `packages/coding-agent/src/core/provider-composer.ts`、`model-config.ts`、`model-runtime.ts` | `applyModelsJson`、`applyExtension`、`composeModelProvider`、`ModelConfig.load` | `model-runtime-modify-models-compat.test.ts`、`model-registry.test.ts`；精读 [D30](../deep-dives/D30-provider-composition-and-refresh.md) |
| 假供应商与流式脚本 | `packages/ai/src/providers/faux.ts` | `fauxAssistantMessage`、`fauxToolCall`、`createFauxCore`、`streamWithDeltas` | `coding-agent/test/suite`；精读 [D21](../deep-dives/D21-faux-test-harness.md) |
| 环境变量密钥 | `packages/ai/src/env-api-keys.ts` | 各 `*_ENV` 常量 | — |
| 新增 provider 的统一流契约 | `packages/ai/src/types.ts`、`utils/event-stream.ts` | `StreamFunction`、`StreamOptions`、`StopReason`、`AssistantMessageEventStream` | `packages/ai/test/*provider*`；对照精读 [D17–D20](../deep-dives/README.md) 与 [D23](../deep-dives/D23-provider-adapter-field-guide.md) |
| 模型类型、能力路由与缺失实现 | `packages/ai/src/types.ts`、`models.ts` | `ModelTypeMap`、`Provider`、`CreateProviderOptions`、`createProvider`、`ModelsImpl.generateImages/classify/streamDeferred/cancelDeferred` | `images-models.test.ts`、`classifier-models.test.ts`、`providers.test.ts`；第 5.2.5 节 |

## B.6 会话树与压缩

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| 条目类型与插件 | `packages/coding-agent/src/core/session-manager.ts` | `SessionEntry` 家族、`SessionManager` | `test/session-manager/` |
| 三级投影 | 同上 | `buildSessionPath`、`buildContextEntries`、`buildSessionProjection`、`buildSessionContext` | — |
| 条目录消息 | 同上 | `sessionEntryToContextMessages` | — |
| 分支导出 | 同上 | `createBranchedSession` | — |
| 会话目录编码 | 同上 | `getDefaultSessionDir` | — |
| 压缩设置与判定 | `core/compaction/compaction.ts` | `CompactionSettings`、`shouldCompact`、`findCutPoint`、`prepareCompaction`、`compact` | `test/suite/agent-session-compaction.test.ts` |
| 摘要生成 | 同上 | `generateSummary`、`generateSummaryWithUsage` | — |
| 序列化 | `core/compaction/utils.ts` | `serializeConversation` | — |
| 分支摘要 | `core/compaction/branch-summarization.ts` | `collectEntriesForBranchSummary`、`generateBranchSummary` | — |

## B.7 配置、资源与信任

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| 设置加载/合并/写入 | `core/settings-manager.ts` | `SettingsManager.create`、`loadFromStorage`、`applyOverrides`、各 getter | — |
| 设置层合并、字段级保存、reload 与信任门 | `core/settings-manager.ts` | `deepMergeSettings`、`setProjectTrusted`、`persistScopedSettings`、`reload` | `test/settings-manager.test.ts`、`test/settings-manager-bug.test.ts`、`regressions/3616-settings-inmemory-reload.test.ts`；精读 [D26](../deep-dives/D26-settings-manager-state.md) |
| 资源发现 | `core/resource-loader.ts` | `DefaultResourceLoader`、`loadProjectContextFiles`、`reload` | — |
| 资源来源排序、启用过滤与路径去重 | `core/package-manager.ts`、`core/resource-loader.ts` | `resolve`、`resourcePrecedenceRank`、`toResolvedPaths`、`loadFinalExtensionSet` | `test/resource-loader.test.ts`、`regressions/2781-skill-collision-precedence.test.ts`；精读 [D25](../deep-dives/D25-resource-loader-reload.md) |
| reload 时项目授权双阶段 | `core/resource-loader.ts`、`core/settings-manager.ts` | `loadProjectTrustExtensions`、`reload`、`loadFinalExtensionSet` | `test/resource-loader.test.ts`；精读 [D25](../deep-dives/D25-resource-loader-reload.md) |
| 上下文文件候选 | 同上 | `candidates`（AGENTS.override.md 等） | — |
| 信任决策 | `core/project-trust.ts` | `resolveProjectTrusted` | — |
| 信任存储与选项 | `core/trust-manager.ts` | `ProjectTrustStore`、`getProjectTrustOptions` | — |
| 系统提示组装 | `core/system-prompt.ts` | `buildSystemPromptSections`、`diffSystemPromptSections` | — |
| 技能与模板 | `core/skills.ts`、`core/prompt-templates.ts` | `formatSkillsForPrompt`、`expandPromptTemplate` | — |

## B.8 扩展系统

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| 类型总集（82KB） | `core/extensions/types.ts` | `ExtensionAPI`、`ExtensionContext`、`ExtensionToolContext`、各事件类型 | — |
| 派发实现 | `core/extensions/runner.ts` | `ExtensionRunner`、`emit*` 系列 | — |
| 加载器与 factory 失败隔离 | `core/extensions/loader.ts` | `loadExtension`、`initializeExtension`、`createExtensionAPI`、`loadExtensionsInternal` | `test/suite/regressions/8423-extension-factory-failure.test.ts`；精读 [D22](../deep-dives/D22-extension-loader-lifecycle.md) |
| 扩展缓存与 reload 生命周期 | `core/extensions/loader.ts`、`core/resource-loader.ts`、`core/agent-session.ts` | `clearExtensionCache`、`loadExtensionsCached`、`ExtensionRuntime.invalidate`、`AgentSession.reload`、`dispose` | `extension-factory-cache.test.ts`、`7193-event-bus-lifecycle.test.ts`；精读 [D22](../deep-dives/D22-extension-loader-lifecycle.md) |
| 入口导出 | `core/extensions/index.ts` | 公共导出 | — |
| 示例：审批门 | `examples/extensions/permission-gate.ts` | `tool_call` 钩子 | — |
| 示例：输入变换 | `examples/extensions/input-transform.ts` | `input` 钩子 | — |
| 示例：状态持久化 | `examples/extensions/tools.ts` | `appendEntry` + `getBranch` | — |
| 示例：工具/渲染/终止 | `hello.ts`、`structured-output.ts`、`truncated-tool.ts` | `defineTool`、`terminate`、`renderResult` | — |

## B.9 SDK、模式与终端

| 问题 | 文件 | 符号 | 相关测试 |
|---|---|---|---|
| SDK 全量控制示例 | `examples/sdk/12-full-control.ts` | 自定义 `ResourceLoader` 接口 | — |
| 运行时重绑示例 | `examples/sdk/13-session-runtime.ts` | `bindSession` | `agent-session-runtime.test.ts` |
| JSON/RPC 事件序列化 | `src/modes/json-event.ts` | `JsonAgentSessionEvent` | — |
| RPC 类型与客户端 | `src/modes/rpc/rpc-types.ts`、`rpc-client.ts` | `RpcClient`、`promptAndWait` | — |
| TUI 组件与工具函数 | `packages/tui/src/index.ts` | `Text`、`Editor`、`visibleWidth` 等 | `packages/tui/test/` |
| 键位表 | `core/keybindings.ts` | `KEYBINDINGS`、`useWindowsKeybindings` | `packages/tui/test/keybindings.test.ts` |

## B.10 测试基础设施

| 问题 | 文件 | 符号 | 说明 |
|---|---|---|---|
| 会话测试 harness | `packages/coding-agent/test/suite/harness.ts` | `createHarness`、`HarnessOptions`、`cleanup`、断言辅助 | `agent-session-prompt.test.ts`、`agent-session-tool-orchestration.test.ts`；suite 规则见 `test/suite/README.md`；精读 [D21](../deep-dives/D21-faux-test-harness.md) |
| 图片输入受当前模型限制 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession.prompt`、`_normalizePromptImages`、`_limitsModel` | `test/suite/agent-session-prompt.test.ts`（issue #9631）；精读 [D24](../deep-dives/D24-worked-source-change.md) |
| prompt 输入分流与模型前置处理 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession.prompt`、`_runInputHandlers`、`_normalizePromptImages` | `test/suite/agent-session-prompt.test.ts`；精读 [D27](../deep-dives/D27-agent-session-prompt-settlement.md) |
| AgentSession run 收束、重试、取消与 idle | `packages/coding-agent/src/core/agent-session.ts` | `_runAgentPrompt`、`_handlePostAgentRun`、`_runBeforeSettleBoundary`、`_emitAgentSettled`、`abort`、`waitForIdle` | `agent-session-retry-events.test.ts`、`agent-session-boundaries.test.ts`；精读 [D27](../deep-dives/D27-agent-session-prompt-settlement.md) |
| 测试别名（源码直跑） | `vitest.base.ts` | `workspaceSourcePaths` | 与 source-resolver 同理 |
| 全量非 e2e | `test.sh` | —— | 隔离 HOME/凭据 |
| 交互测试指引 | `.pi/skills/interactive-testing.md` | tmux 流程 | AGENTS.md 指定先读 |

## B.11 选修模块

| 问题 | 文件 | 符号 | 章节 |
|---|---|---|---|
| MCP 客户端 | `packages/mcp/src/` | `McpClient`、`StdioTransport`、`toLlmContent` | 22 |
| MCP 配置与暴露 | `packages/coding-agent/docs/mcp.md`、`core/mcp-servers.ts` | 配置解析与连接 | 22 |
| Codemode 沙箱 | `packages/codemode/src/` | `CodemodeSandbox` | 22 |
| Codemode 工具接入 | `packages/coding-agent/src/extensions/codemode/` | `createCodemodeExtension` | 22 |
| Chord 服务/状态 | `packages/chord/src/` | `track`、`replicatedState`、facets | 23 |
| Durable Harness | `packages/durable/src/` | `Harness`、`Conversation`、`defineTool` | 23 |
| 协议帧 | `packages/protocol/src/` | `encodeClientMessage`、`ServerMessageDecoder` | 24 |
| 服务器路由 | `packages/server/src/` | `ServerHost`、`createUnixServer` | 24 |
| 客户端 | `packages/client/src/` | `Client`、`createClientServiceTransport` | 24 |
| 遥测契约 | `packages/telemetry/src/` | `TelemetryContext`、`InMemoryTelemetryContext` | 25 |
| 评估 runner | `packages/evals/src/` | `cli.ts`、`docker.ts`、`plan.ts`、`report.ts` | 25 |

## B.12 "我要改 X，该动哪"

| 想改什么 | 先看 | 注意 |
|---|---|---|
| 工具行为/新增内置工具 | `core/tools/*`、`tools/index.ts` | 声明与可执行两处；截断纪律（第 7 章） |
| Agent 循环语义 | `packages/agent/src/agent-loop.ts` | 先看 `test/` 里的既有约束；别破坏事件序列 |
| 会话存储格式 | `core/session-manager.ts` | 版本迁移（v1→v3）；回放兼容 |
| 系统提示 | `core/system-prompt.ts` | 分节补丁；`diffSystemPromptSections` |
| 设置项 | `core/settings-manager.ts` + `docs/settings.md` | getter 读合并还是全局；迁移函数 |
| 模型适配 | `packages/ai/src/providers/*` | 请求/响应两张转换表（第 5.5.3 节） |
| 扩展钩子 | `core/extensions/types.ts` + `runner.ts` | 事件语义分"通知/变换/取消" |
| SDK 导出面 | `packages/coding-agent/src/index.ts` | entry-graphs 预算（第 20 章） |
| 交互界面 | `packages/tui/src/`、`src/modes/interactive/` | 宽度工具与 IME 规则（第 17 章） |
