# 附录 F：验证记录

> 本手册遵循"结论 → 文件与符号 → 验证状态"的写作规则。本页记录**撰写期间实际执行的验证**，以及读者实验的记录模板。

## F.1 状态图例

| 状态 | 含义 |
|---|---|
| 设计中 | 步骤仅经过设计，尚未对照源码核对或运行 |
| 静态核对 | 已对照基线 commit 的源码/文档验证结论，但未运行 |
| 本地已运行 | 在撰写时实际运行过，记录了系统、Node 版本与结果 |
| 需外部条件 | 需要真实模型、账号或特定系统才能完成 |

## F.2 撰写期间实际执行的验证（本地已运行）

环境：Windows + PowerShell；Node `v23.9.0`；仓库基线 `200387122ca450d6387f033949423114a270b96c`（`@earendil-works/pi-coding-agent` 1.0.2）。

| 验证项 | 命令/操作 | 结果 |
|---|---|---|
| Node 直接执行可擦除 TS | 写 `ts-strip-test.ts`（类型注解 + 函数）后 `node ts-strip-test.ts` | 输出 `42`；出现 `ExperimentalWarning: Type Stripping...`（第 1.1.1 节） |
| npm 工作区链接 | `Get-Item node_modules\@earendil-works\pi-ai` | `LinkType: Junction` → `packages\ai`（第 2.3.2 节） |
| 仓库基线 | `git rev-parse HEAD` | 与手册基线一致 |
| 入口声明 | `node -e "require('./packages/coding-agent/package.json')..."` | `@earendil-works/pi-coding-agent 1.0.2 {"pi":"dist/bundle/cli.js"}`（第 0.7 节） |
| L01 Windows 源码入口 | PowerShell：`.\pi-test.ps1 --version`；并记录 Node/npm、平台、架构、PowerShell 版本、repo root 与 HEAD | Windows + PowerShell 7.6.6；Node `v23.9.0`、npm `10.9.2`、`win32 x64`；版本输出 `1.0.2`，退出码 0；显示预期的 Node Type Stripping `ExperimentalWarning`。项目树与 commit 与手册基线一致。此项不验证读者自行画图，也不代表 Linux/macOS/Git Bash 已运行 |
| workspace 依赖图 | 遍历 `packages/*/package.json` 的 `dependencies` 并抽查源码 imports | 第 0.3 节图按 manifest 边标方向；包括 `pi-ai → pi-telemetry` 类型依赖与实验协议包边界；不含 devDependencies |
| 源码阅读与引用核对 | 逐章对照源码/文档（见每章"验证状态"行） | 主线 0–25 章以静态核对为主；精读专题分列于下表，不表示所有代码示例都运行过 |
| UTF-8 无 BOM 写入 | PowerShell `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)` 往返读取中文 | 无 BOM、中文往返一致 |

**未执行**（保持"设计中/需外部条件"）：读者完成 L01（包括自行绘图和记录）；L02-L15 的读者侧运行（含 faux 实验的具体断言、tmux 交互、MCP 本地服务器、durable 恢复、评估运行）；任何真实模型调用。本机只实际运行了 L01 的 Windows 环境探查和源码 `--version` 命令，未完成读者的整套实验产物。

## F.2.1 后续专题的静态核对

以下专题在之后的文档编写中依据当前 checkout 对照了实现和测试源码；这属于静态阅读，不是测试通过证据：

| 专题 | 核对对象 | 静态证据 | 未执行 |
|---|---|---|---|
| D21 faux/harness | `packages/ai/src/providers/faux.ts`、`packages/coding-agent/test/suite/harness.ts` | response queue、事件流、session 装配和 cleanup 对照 | 未运行 D21 代码示例或 suite 测试 |
| D22 extension lifecycle | `extensions/loader.ts`、`runner.ts`、`resource-loader.ts`、`agent-session.ts` 与四个 regression tests | pending/commit/discard、cache token、invalidate 和 reload 顺序对照 | 未运行 extension tests |
| D23 provider guide | `packages/ai/src/types.ts`、Anthropic/OpenAI/Bedrock adapter 与 D17–D20 | 统一流契约和四种协议边界对照 | 未新增 adapter、未运行 provider tests |
| D24 source-change walkthrough | 当前 `agent-session.ts` / `test/suite/agent-session-prompt.test.ts` 与历史 commit `f5c946480` | issue #9631 行为契约、提交前后 prompt 顺序、归一化结果接入 user message 及 assertion 区分力 | 静态核对现有源码、测试和历史 diff；未运行 regression test |
| D25 resource loader | `resource-loader.ts`、`package-manager.ts` 与 trust/precedence/reload tests | reload 阶段、project trust 双阶段、资源 rank 与 path dedupe 对照 | 未运行 resource-loader 或 regression tests |
| D26 settings manager | `settings-manager.ts` 与 merge/reload/trust/write tests | 配置合并、字段级写入、trust 状态、写队列与 reload 错误分支对照 | 未运行 settings-manager 或 regression tests |
| D27 AgentSession prompt/settlement | `agent-session.ts` 与 `agent-session-prompt.test.ts`、`agent-session-retry-events.test.ts`、`agent-session-boundaries.test.ts` | 输入短路/排队/启动、run 后处理、重试/压缩、pre-settle continuation、settled deferred action 与 abort/idle 次序对照 | 未运行相关测试；文中测试表是源码定位，不是通过证据 |
| D28 AgentSessionRuntime replacement | `agent-session-runtime.ts`、`agent-session-services.ts`、`session-manager.ts` 与 `agent-session-runtime.test.ts`、regression #2860 | before-hook cancel、teardown 顺序、cwd 服务重建、fork/import 文件副作用、rebind 与 stale context 顺序对照 | 未运行 runtime 或 regression tests；工厂/rebind 失败表是按源码顺序推导 |
| D12 RpcClient request lifecycle supplement | `modes/rpc/rpc-client.ts`、`rpc.test.ts`、`rpc-client-process-exit.test.ts`、`rpc-prompt-response-semantics.test.ts` | `handleLine` 分流、request Map/timer 清理、stdin.write 背压边界、promptAndWait handled/reject 路径及 stop 退出顺序 | 静态核对；未运行客户端或 RPC 测试。集成测试需 Anthropic credential 才启用 |
| 第 19 章事件轨迹排障补充 | `agent-loop.ts`、`agent-session.ts`、`json-event.ts`、第 3/6/16/17 章调用链 | 从最后观察事件推断已证明的层、下一条预期边界及对应源码入口；新增 PowerShell 与 Bash 采集说明 | 源码/章节静态核对；命令示例未运行，不代表三平台已实测 |
| 第 21 章 run 术语答案修正 | `agent-session.ts` 的 `_runAgentPrompt` / `_emitAgentSettled`、`agent.ts` 的 `prompt` / `continue` | 修正“一次用户输入等于一次 Agent run”与“每个 prompt 都有一次 settled”的错误简化，补充 handled 和 deferred prompt 边界 | 源码静态核对；未运行测试 |
| 附录 A 输入/run 层级表 | `AgentSession.prompt`、`_runAgentPrompt`、`Agent.prompt`、`Agent.continue` 与 D27 | 统一输入 disposition、session 编排、低层 run、turn 和 provider 请求的术语层级 | 源码/章节静态核对；未运行测试 |
| 第 1 章 async 追踪补充 | `packages/agent/src/agent-loop.ts` 的 `executePreparedToolCall`、`executeToolCallsParallel`；第 1 章示例 | 工具执行 Promise、进度回调 Promise、`Promise.all` 与错误转换的等待/拒绝范围对照 | 静态核对；未运行示例或测试 |
| 第 3 章 text_delta 数据流补充 | `agent-loop.ts` 的 `streamAssistantResponse`、`agent.ts` 的 `processEvents`、`agent-session.ts` 的 `_handleAgentEvent` / `_emitExtensionEvent` | provider partial → Agent `message_update` → 状态归约 → listener 顺序 → `message_end` 扩展替换、公开通知与持久化的对象/时序对照 | 静态核对；未运行相关测试 |
| 第 6 章循环变量轨迹补充 | `packages/agent/src/agent-loop.ts` 的 `runLoop` | `hasMoreToolCalls`、`pendingMessages` 与 `explicitContinuation` 的赋值位置、inner/outer loop 边界及 follow-up 优先分支 | 静态核对；未运行 Agent loop 测试 |
| 第 7 章运行时参数信任边界补充 | `agent-loop.ts` 的 `prepareToolCall` / `executePreparedToolCall`、`types.ts` 的 `BeforeToolCallContext`、`agent-loop.test.ts` | schema 校验发生在 `beforeToolCall` 之前，hook 可变更共享 args，执行前不二次校验；对应测试明确断言该行为 | 源码与既有测试静态核对；未运行测试 |
| 第 7 章文件变更队列边界补充 | `file-mutation-queue.ts`、`write.ts`、`edit.ts`、`test/file-mutation-queue.test.ts` | 已核对相同路径串行、不同路径并行、存在文件 symlink 共键、edit/write 共队列及 abort 时等待底层写 Promise settle；缺失路径别名未覆盖，`realpath` 对 `ENOENT`/`ENOTDIR` 回退到解析路径 | 源码和既有测试静态核对；未运行测试 |
| 第 7 章并行工具调度顺序补充 | `packages/agent/src/agent-loop.ts` 的 `executeToolCallsParallel`、`executeToolCallsSequential`、`prepareToolCall`、`executePreparedToolCall`、`finalizeExecutedToolCall` | 核对并行路径的串行准备、immediate 结果在准备期间发 end、准备成功的闭包并发执行、`Promise.all` 保持结果数组顺序，以及 abort 截断后续准备和取消前已准备调用的结果行为；修正 end 顺序并非单一完成顺序的表述 | 源码静态核对；未运行测试；取消顺序依据控制流推导 |
| 第 6 章硬退出与 `finishTurn` 决策 | `packages/agent/src/agent-loop.ts` 的 `runLoop`；`packages/agent/src/types.ts` 的 `FinishTurn` 文档；`packages/agent/test/agent-loop.test.ts` 的 `runs finishTurn for a %s assistant before turn_end without changing the hard exit` | 对照 error/aborted 分支确认仍 await hook，但忽略已成功返回的 action，直接发送 `turn_end`/`agent_end` 且不消费 follow-up；hook rejection 则在后续结束事件前向外传播 | 源码与既有测试静态核对；未运行测试 |
| 第 5 章 assistant 流事件协议 | `packages/ai/src/types.ts` 的 `AssistantMessageEvent` / `StreamFunction`；`utils/event-stream.ts` 的 `AssistantMessageEventStream`；`test/assistant-message-frame.test.ts`、`test/faux-provider.test.ts` | 补充 `start`、增量事件与 `done`/`error` 终态契约；区分共享可变 `partial`、事件 delta 与最终消息，并说明 setup 失败可在 start 前发 error | 类型与实现、既有测试源码静态核对；未运行测试 |
| 第 5 章模型类型与 Provider capability 路由 | `packages/ai/src/types.ts` 的 `ModelTypeMap` / `Provider`；`models.ts` 的 `createProvider`、`ModelsImpl` 操作入口；图像/分类/deferred tests | 核对 chat/image/classifier 的模型类型、操作入口、API map 分发、运行时类型检查及 unsupported 时不同的失败形态；补充新增 capability 的三类测试边界 | 源码与既有测试静态核对；未运行测试 |
| 第 0 章 CLI 模式选择补充 | `main.ts` 的 `resolveAppMode`、`toPrintOutputMode`、最终分支；`cli/args.ts` 的 `Mode` 与 `parseArgs`；`test/args.test.ts` | 区分 CLI `Mode` 与运行时 `AppMode`；按分支顺序核对 RPC/JSON 优先、print 参数与 TTY 回退、最终 handler；args 测试仅覆盖 mode 值解析 | 源码/既有参数测试静态核对；未运行测试，mode 与 TTY 组合没有对应的直接单元测试 |
| 第 8 章 SDK 资源所有权与 abort/dispose 区别 | `sdk.ts` 的 `CreateAgentSessionOptions` / `createAgentSession`；`agent-session.ts` 的 `abort` / `dispose`；`agent-session-runtime.ts` 的 `teardownCurrent` / `dispose`；`examples/sdk/01-minimal.ts` / `13-session-runtime.ts` | 注入对象与 SDK 默认创建对象分开；`session.dispose()` 同步发 abort 且不 await idle，`session.abort()` 等待 idle；replacement 先 abort，runtime 最终 dispose 则不等待活动 run | 源码/示例静态核对；未运行测试；活动 run 时 runtime 最终 dispose 的组合顺序没有直接测试 |
| 第 4 章内存对象与会话投影补充 | `agent.ts` 的 `processEvents`、`agent-session.ts` 的 `_replaceMessageInPlace` / `_handleAgentEvent`、`session-manager.ts` 的 `appendContextEdit` / `buildSessionProjection` | 首次 message-end hook 对同一对象的替换，与保留原 entry 并对模型投影应用 context_edit 的差异；对照 boundary regression test | 源码与既有测试静态核对；未运行测试 |
| 第 4 章 AgentState 流式消息说明修正 | `packages/agent/src/agent.ts` 的 `processEvents` | `message_start/update` 写 `streamingMessage`，只有 `message_end` 才向 `state.messages` 追加最终消息 | 源码静态核对；未运行测试 |
| 第 9 章分支/context_edit 实验修订 | `session-manager.ts` 的 `branch` / `appendContextEdit` / `appendCompaction` 与 `session-manager/tree-traversal.test.ts`、`session-context-edit.test.ts` | 实验先切换叶子再编辑目标；活动分支校验会拒绝编辑另一分支的条目 | 源码与既有测试静态核对；未运行测试 |
| D29 ModelRuntime 请求准备与凭据同步 | `model-runtime.ts`、`runtime-credentials.ts`；`model-runtime-credential-sync.test.ts`、`model-runtime-auth-options.test.ts`、`model-runtime-modify-models-compat.test.ts`、`virtual-models.test.ts` | 对照 auth/header/env 合并、按 provider 操作队列、提交后本地刷新、快照序号保护及虚拟模型凭据隔离 | 源码与测试断言静态核对；未运行测试 |
| D30 provider 组合与刷新 | `provider-composer.ts`、`model-config.ts`、`model-runtime.ts`；`model-runtime-modify-models-compat.test.ts`、`model-registry.test.ts` | 对照 models.json upsert、extension list replacement、最终 modelOverrides、provider 能力分发与刷新候选发布 | 源码与既有测试断言静态核对；未运行测试；ModelConfig 解析错误的专门单测入口未确认 |
| 第 1 章 TypeBox 泛型贯穿例子 | `core/tools/read.ts` 的 `readSchema` / `ReadToolInput` / `createReadTool`、`packages/agent/src/types.ts` 的 `AgentTool.execute`、`packages/ai/src/utils/validation.ts` | 追踪同一 schema 怎样提供静态参数类型并在 Agent 执行前验证网络数据；补充 schema 未声明业务限制的例子 | 源码静态核对并对照第 7.4 节既有校验讲解；未运行示例或测试 |
| 第 1 章 `any` / `unknown` / `never` 修订 | `packages/agent/src/types.ts` 的 `AgentContext`、`AgentTool`、`AgentEvent`；第 1 章 1.3.6 | 更正异构工具数组、动态工具事件载荷与具体工具泛型的差别；示例验证属性存在检查后仍需检查属性值类型 | 对照类型声明静态核对；代码片段未执行 |
| 第 18 章 L12-A harness 句柄说明 | `test/suite/harness.ts` 的 `Harness` / `createHarness`；`agent-session-retry-events.test.ts` | 核实 `harness.faux.state.callCount` 和 `getPendingResponseCount()` 均为当前公开的测试句柄，删除“可能未暴露、需自行接出”的过期保留说明 | 源码和既有测试静态核对；未运行测试 |
| 第 18 章单文件测试的 PowerShell 命令 | 第 18.2 / 18.8 / 18.9 节与附录 K.5 | 补齐原生 Windows 用户可复制的 Vitest/node:test 命令，区分单文件 Node 命令与需要 Bash 的仓库级 `test.sh` | 按 PowerShell 语法和仓库命令规则静态核对；未执行测试 |
| 第 7、14 章扩展工具适配与 ctx 生命周期 | `extensions/loader.ts` 的 `registerTool`、`agent-session.ts` 的 `_bindExtensionCore` / `_refreshToolRegistry`、`extensions/wrapper.ts`、`tool-definition-wrapper.ts`、`runner.ts` 的 `createToolContext`；`agent-session-dynamic-tools.test.ts`、`extensions-runner.test.ts` | 串起加载期注册（refresh no-op）、核心绑定后的工具注册表重建、`AgentTool` 包装、逐次调用创建 `ExtensionToolContext`；说明工具并非注册后必然进入模型 loadout，及无 context factory 的直接调用边界 | 源码与既有测试断言静态核对；未运行测试 |
| D10 压缩摘要素材过滤 | `compaction.ts` 的 `getMessagesFromProjectedEntryForCompaction`；`compaction.test.ts` 的 `does not treat system messages as conversation history`；`test/suite/agent-session-compaction.test.ts` 的 checkpoint/system patch 用例 | 校正摘要素材规则：按 entry 索引切分后，再排除 compaction 源条目与 system 消息；投影用 compaction checkpoint 与保留区间的 system patch 重建 system state；区分模型上下文投影和摘要输入 | 源码注释/实现与既有测试断言静态核对；未运行测试 |
| D11 Models 流与 provider 直调的错误时机 | `models.ts` 的 `ModelsImpl.streamSimple`、`api/lazy.ts` 的 `lazyStream`、`types.ts` 的 `StreamFunction`；`models-runtime.test.ts`、`pre-generation-error.test.ts` | 更正准备工作在流创建时即启动；Models 层 setup/provider/auth 失败转为 error event 与终态消息，底层 provider API 缺少 key 可同步抛出；区分上下文规范化的同步异常 | 源码与既有测试断言静态核对；未运行测试 |
| D8 `message_end` 非法角色替换 | `extensions/runner.ts` 的 `emitMessageEnd`、`agent-session.ts` 的 `_handleAgentEvent`；`agent-session-runtime.test.ts` 的合法 assistant 替换用例 | 明确 role mismatch 会报告错误并跳过当前替换，继续后续 handler；已有合法替换会保留，否则返回 `undefined`；现有测试只覆盖合法替换，非法分支仅静态核对 | 实现与正向测试断言静态核对；未运行测试，未发现非法角色分支的专门测试 |
| D14 扩展加载事务与 warnings 来源 | `extensions/loader.ts` 的 `commit` / `discard` / `loadExtensionsInternal`；`resource-loader.ts` 的 `collectExtensionPackageWarnings` / `omitReplacedExtensions`；`extensions-discovery.test.ts`、`resource-loader.test.ts` | 将 commit 明确为 flag defaults 先写、pending changes 依序应用；修正“全有或全无”的过度承诺，说明 discard 不回滚已执行 change；区分底层 warnings 初始为空与 ResourceLoader 后续补入的来源 | 源码与既有测试断言静态核对；未运行测试 |
| D16 JSONL 导出父链重建 | `session-export.ts` 的 `serializeSessionBranch`、`session-manager.ts` 的 `getBranch`；`export-jsonl-share.test.ts` | 更正重写 `parentId` 的作用：把已回溯得到的活动分支转成独立线性链并为分享尾记录提供挂接点；不承诺修复原始断链，因为 `getBranch` 已沿父指针决定可达条目 | 源码与既有测试断言静态核对；未运行测试 |
| D8/D14 handler 与扩展加载顺序 | `extensions/runner.ts` 的 `emitMessageEnd`、`extensions/loader.ts` 的 `loadExtensionsInternal`、`ExtensionRunner.getAllRegisteredTools`；`extensions-runner.test.ts` | 删除仅凭变量名推断 `message_end` 滚动事件的说法；以源码确认每个 handler 看见先前接受的替换。确认串行加载的可见效果：扩展顺序决定同名工具“首个注册胜出” | 源码与既有测试断言静态核对；未运行测试 |
| D12 JSONL 的 Node readline 说法 | `packages/coding-agent/src/modes/rpc/jsonl.ts`、`packages/coding-agent/docs/json.md`；Node v23.9.0 官方 readline 文档 | 仓库注释称 readline 额外识别 U+2028/U+2029；官方文档列出的行结束符为 `\n`、`\r`、`\r\n`，未证实额外行为。手册改为标注证据差异，同时保留协议只按 LF 分帧的要求 | 仓库源码和官方文档静态核对；readline 实现源码未取得，具体行为未独立核实；未运行测试 |
| 第 18 章弱断言示例 | `AgentSession.retryAttempt` getter；`agent-session-retry-events.test.ts` 的事件断言 | 将私有字段 `as any` 示例改为真实公开 getter，并说明内部计数与调用方可观察的重试事件是不同断言目标 | 源码和既有测试静态核对；未运行测试 |
| 第 6 章与 D1 工具批次取消边界 | `agent-loop.ts` 的 `executeToolCallsSequential` / `executeToolCallsParallel` / `runLoop`；`transform-messages.ts`；`transform-messages-copilot-openai-to-anthropic.test.ts` | 按顺序/并行模式及“未开始、已准备、已执行”状态区分结果消息；修正 Agent loop 一定补全取消结果的说法；同步修正第 6 章验收答案；增加 A/B/C 并行准备取消轨迹，说明结束事件与结果消息顺序不同；合成结果限定为特定 provider 转换行为 | 源码与既有转换测试断言静态核对；该精确取消时序无专门测试；未运行测试或真实 provider 请求 |
| D1 流式包装器异常边界 | `agent-loop.ts` 的 `agentLoop` / `runAgentLoop`；`event-stream.ts`；`agent.ts` 的 `runPromptMessages` / `runWithLifecycle`；`agent.test.ts` 的 thrown run failure 用例；`types.ts` 的 `StreamFn` 契约 | 更正异常归因：Agent 类直接 await Promise 并由 lifecycle 转成失败事件；低层 `agentLoop` fulfillment-only `.then` 没有异常通道，rejection 时不会 end 流；新增两条调用路径图；注明该包装路径无专门 rejection 测试 | 源码、类型契约和既有 Agent lifecycle 测试静态核对；未运行测试 |
| 第 3 章 Agent lifecycle 异常传播 | `agent.ts` 的 `runWithLifecycle` / `handleRunFailure` / `processEvents`；`agent.test.ts` 的 `emits full lifecycle events for thrown run failures` | 限定“运行异常转失败事件”的条件：若失败事件的 listener 再次抛错，`handleRunFailure` reject，异常传到 `prompt()` 调用方；`finally` 仍执行 `finishRun`。现有测试覆盖普通运行异常和正常 listener，不覆盖 listener 在失败事件中抛错 | 源码与既有测试静态核对；listener 二次抛错路径未运行、未发现专门测试 |
| D27 AgentSession 异常传播到 settled/idle | `agent-session.ts` 的 `prompt` / `_runAgentPrompt` / `_emitAgentSettled` / `_emit`；`agent.ts` 的 `runWithLifecycle`；`agent.test.ts` 的普通 thrown run failure；`agent-session-boundaries.test.ts` 的 settled deferred action 用例 | 按 preflight、Agent 普通失败、Agent listener 二次抛错、session `agent_settled` listener 同步抛错区分 Promise 结果；指出 `_emitAgentSettled` 的同步 listener 抛错会跳过 deferred actions 与 idle waiter resolve，并可能覆盖 `_runAgentPrompt` 原先待传播的异常。测试只覆盖正常失败和正常 settled 顺序 | 源码及既有测试源码静态核对；两类 listener 抛错路径未运行，未发现专门测试 |
| `Agent.subscribe` 与 `AgentSession.subscribe` 回调契约 | `agent.ts` 的 `subscribe` 文档注释 / `processEvents`；`agent-session.ts` 的 `AgentSessionEventListener` / `subscribe` / `_emit`；第 15 章与 D27 §7.1 | 对照两种 listener 返回类型、是否 await、rejection 如何传播；增加 session 同步 listener 启动异步副作用时显式 `.catch()` 的示例，并澄清 `void` 不会处理 rejection | 类型声明和调用点源码静态核对；示例未执行，未运行测试 |
| 第 4 章 `AgentEvent` 联合成员数 | `packages/agent/src/types.ts` 的 `AgentEvent`；第 4.5.1 节事件表 | 删除“12 个成员”及要求读者寻找不存在成员的说法；按当前 union 确认为 10 个成员，并区分嵌套的 `AssistantMessageEvent` 与顶层 `AgentEvent` | 当前类型定义静态核对；未运行测试 |
| 第 4 章 `AgentSessionEvent` 与 `AgentEvent` 类型关系 | `agent-session.ts` 的 `WithParentToolCallId` / `AgentSessionEvent`；第 4.5.2 节 | 更正“严格超集”说法：session 类型排除 core `agent_end` 后用必需 `willRetry` 版本替换；解释其余事件复用及工具事件的可选父调用字段 | 类型定义静态核对；未运行测试 |
| `entry_appended` 事件与条目写入覆盖范围 | `agent-session.ts` 的全部 `entry_appended` 发出点、`_handleAgentEvent` 的 `message_end` 持久化与 compaction 写入；`session-manager.ts` 的 `appendMessage` / `appendCompaction`；`agent-session-codemode.test.ts` 的 store entry 用例 | 修正“每次写入都发 `entry_appended`”的说法；明确普通消息与压缩条目写入不会发该事件，事件只出现在部分辅助写入路径；修正第 9 章和 D3 把事件通知与 projection provenance 混为一谈及第 10 章压缩时序 | 源码静态核对；既有测试只覆盖 codemode store 自定义条目通知；未运行测试 |
| 第 6 章 loop hook rejection 出口 | `agent-loop.ts` 的 `runLoop` / `streamAssistantResponse`；`agent.ts` 的 `runWithLifecycle`；D1 的低层 `agentLoop()` 异常路径；`agent-loop.test.ts` 的队列时序用例 | 区分模型 `error`/`aborted` 终态消息与 awaited hook rejection；补充 Agent lifecycle 会转失败事件、低层流包装器没有 rejection end handler 的两条路径，说明事件可能在 `turn_end` 前不完整 | 源码与现有测试覆盖范围静态核对；未找到 hook rejection 专门测试；未运行测试 |

2026-10-05 文档维护检查：`docs/` 下 70 个 Markdown 文件共 32,768 行（含学习计划；按 Markdown 行统计）。本轮变更文件无 UTF-8 BOM、无尾随空白；第 7 → 第 14 章和 D14 → D22 精读链接存在。全库简单正则链接扫描在 D8 的代码示例 `toolName, (` 产生误报，因此不据此声称全库链接扫描通过。当前 `git rev-parse HEAD` 为 `200387122ca450d6387f033949423114a270b96c`，coding-agent 版本为 `1.0.2`，与手册基线一致。此检查不等同于 markdown lint、外部网页可用性、跨平台运行或代码测试。

本轮第 7 章工具调度复核：对照 `executeToolCallsParallel` 与 `executeToolCallsSequential` 修正并行模式事件顺序说明，区分逐个准备、immediate 收尾、并发执行闭包和有序结果消息；取消下未开始调用缺少结果的结论按源码静态推导。未运行测试。

本轮第 6 章硬退出复核：对照 `runLoop` 的 error/aborted 分支、`FinishTurn` 类型注释及既有 loop 测试，补充 `finishTurn` 决策不覆盖硬退出、hook reject 会中断后续结束事件的说明。静态核对，未运行测试。

本轮第 5 章流协议补充：对照 `AssistantMessageEvent` 类型、`AssistantMessageEventStream` 实现及帧/faux 测试，补充终态、共享 `partial` 与分块事件语义，定位适配器维护检查项。静态核对，未运行测试。

本轮第 5 章能力路由补充：对照 `ModelTypeMap`、`Provider`、`createProvider` 和 `ModelsImpl` 的图像/分类/deferred 入口及既有测试，区分 model type、API 实现映射和各操作的错误返回契约，并为章节验收题补充具体失败场景。静态核对，未运行测试。

三平台命令选择与限制另见 [platform-validation.md](platform-validation.md)。本文档中的平台说明是操作指引；未附对应环境和命令输出的系统不算“本地已运行”。

## F.3 读者实验记录模板

每完成一个实验，按下面格式记录（建议每个实验一条，追加在本文档副本或你的笔记里）：

```markdown
### L__（<章节>）
- 日期与设备：
- OS / shell：
- Node 版本：
- 仓库 commit：
- 运行方式：pi-test（源码）/ SDK / harness 测试
- 前置条件：无 / faux / tmux / 本地服务 / <其他>
- 结果：通过 / 部分通过 / 失败
- 关键输出（摘要）：
- 与手册预期的差异：
- 清理情况：
```

## F.4 已知的"预期差异"清单（跑实验前先读）

| 实验 | 可能与手册不同的点 | 原因 |
|---|---|---|
| L02/L03/L04/L06 | faux 的默认行为、harness 的访问路径（如 faux 句柄暴露方式） | 版本迭代；以你本地的 `harness.ts`/`faux.ts` 为准 |
| L07 | 设置字段名与合并顺序 | 以实现与 `settings.md` 为准 |
| L10/L14 | 子进程/套接字的平台差异（Windows 路径、权限） | 平台差异；必要时在 WSL/Git Bash 复验 |
| L15 | 任何真实运行 | 需先确认预算与供应商；本手册未执行 |

## F.5 更新规则

- 每次只追加/修改受影响的实验条目；
- "本地已运行"必须给出环境与关键输出，不能只写"通过"；
- 发现手册与代码不一致时：以代码为准 → 修正正文 → 在 [version-notes](version-notes.md) 记录差异。
