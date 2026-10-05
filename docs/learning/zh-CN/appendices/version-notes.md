# 附录 G：版本与维护

## G.1 基线信息

| 项 | 值 |
|---|---|
| 仓库 | `github.com/earendil-works/pi`（本地 `D:\Github\pi`） |
| 分支 | `main` |
| 提交 | `200387122ca450d6387f033949423114a270b96c`（`200387122`） |
| `@earendil-works/pi-coding-agent` | `1.0.2` |
| Node 要求 | `>= 22.19.0`（编写时验证环境：Node v23.9.0，Windows） |
| 计划文档基线与本手册一致 | `docs/learning-plan.zh-CN.md` |

**写作约定**：用"包路径 → 文件 → 符号名"定位，不依赖行号；行号会随版本漂移。个别处给出的行号仅作撰写时的导航提示。

## G.2 升级仓库后，哪些章节要重读

| 变化类型 | 先读 | 通常影响 |
|---|---|---|
| 包名/导出变化 | 各包 `package.json`、`src/index.ts` | 0、5、7、15 章 |
| 入口/启动流程 | `src/cli.ts`、`src/main.ts`、`src/cli/setup.ts` | 2、3 章 |
| 消息/事件类型 | `packages/ai/src/types.ts`、`packages/agent/src/types.ts`、`core/agent-session.ts`（`AgentSessionEvent`） | 3、4、6、16 章 |
| 会话格式/条目 | `core/session-manager.ts`、`docs/session-format.md` | 4、9、10 章 |
| 工具调度 | `packages/agent/src/agent-loop.ts`、`core/tools/*` | 3、6、7、14 章 |
| 配置解析 | `core/settings-manager.ts`、`core/resource-loader.ts`、`docs/settings.md` | 11、12 章 |
| 扩展系统 | `core/extensions/types.ts`、`runner.ts`、`docs/extensions.md` | 13、14 章 |
| SDK 面 | `core/sdk.ts`、`examples/sdk/*`、`docs/sdk.md` | 15 章 |
| JSON/RPC | `docs/json.md`、`docs/rpc*.md`、`src/modes/rpc/*` | 16 章 |
| TUI | `packages/tui/src/index.ts`、`docs/tui.md`、`core/keybindings.ts` | 17 章 |
| 测试设施 | `test/suite/harness.ts`、`vitest.base.ts` | 18 章 |
| 检查脚本 | `scripts/check-*.mjs`、`package.json` | 20 章 |
| MCP/Codemode | `packages/mcp`、`packages/codemode`、`docs/mcp.md`、`docs/codemode.md` | 22 章 |
| Chord/durable | `packages/chord`、`packages/durable`（含 `docs/spec.md`） | 23 章 |
| client/server/protocol | 三个包的 README | 24 章 |
| telemetry/evals | 两个包的 README | 25 章 |

## G.3 更新流程（照做即可）

```text
① 记录新基线：git log -1 --format="%H %s" + 相关包版本
② 按 G.2 的表格找出受影响章节
③ 重读对应源码与文档（以符号定位）
④ 重跑受影响的实验（能在离线条件下进行的），更新 validation.md
⑤ 修正正文中所有"验证状态"行与示例；检查链接
⑥ 在本页"手册变更记录"追加一条
```

**不需要**因一个局部变化重写全书；也**不要**保留与新代码冲突的旧结论（宁可删除并指向新符号）。

## G.4 撰写期间发现的"文档与实现差异"（已按"以代码为准"处理）

| 位置 | 差异 | 手册处理 |
|---|---|---|
| 键位规则 | `AGENTS.md` 提到 `DEFAULT_EDITOR_KEYBINDINGS`/`DEFAULT_APP_KEYBINDINGS`；当前源码实际是 `packages/tui` 的 `TUI_KEYBINDINGS` 与 `coding-agent` 的 `KEYBINDINGS` | 第 17.9 节按实际结构写，并说明原则不变（新增快捷键进默认表） |
| `SystemMessage.replace` | `docs/message-types.md` 描述了 `replace` 语义；本地 `packages/ai/src/types.ts` 的 `SystemMessage` 未见该字段 | 第 4.3.1 节以本地类型为准并提示读者用编辑器自行确认 |
| 行号 | 手册个别处给出行号（撰写时导航用） | 版本升级后会漂移；一律以符号名定位 |

## G.5 手册变更记录

| 版本 | 日期 | 变化 |
|---|---|---|
| v0.1 | 2026-10-04/05 | 初版：README + 0-25 章 + 附录；对基线 commit 做静态核对；本地执行了极少量只读验证（见 `validation.md`） |
| v0.2 | 2026-10-05 | 增补 D25 资源解析与 reload 生命周期；更新精读篇索引、源码地图、验证记录及学习计划进度；当前手册含 11 个附录与 D1–D25 精读篇 |
| v0.3 | 2026-10-05 | 增补 D26 SettingsManager 配置状态、来源合并、项目授权、字段级写入与 reload；更新源码地图、验证记录和索引；当前手册含 11 个附录与 D1–D26 精读篇 |
| v0.4 | 2026-10-05 | 按 workspace manifests 与代表性 imports 核实第 0 章包依赖图；补出 pi-ai 对 pi-telemetry 的类型依赖，并区分 manifest 依赖和运行时调用关系 |
| v0.5 | 2026-10-05 | 在 Windows PowerShell 实际运行 L01 的源码 `--version` 路径；记录 Node/npm/PowerShell、平台、commit、退出码及实验警告，并明确未实测平台 |
| v0.6 | 2026-10-05 | 增补 D27 AgentSession 输入分流与 run 收束边界；更新 README、精读索引、源码地图、验证记录及学习计划 |
| v0.7 | 2026-10-05 | 扩写第 1 章异步入门：await 的错误传播、Promise.all 失败边界及 Agent 工具进度回调的源码追踪；更新验证记录与学习计划进度锚点 |
| v0.8 | 2026-10-05 | 扩写第 3 章 `text_delta` 到最终消息的四层数据流，解释 Agent 状态归约、异步 listener 顺序、message-end 扩展替换和 transcript 持久化时序 |
| v0.9 | 2026-10-05 | 扩写第 6 章 `runLoop` 三个关键变量的逐步轨迹，解释 inner/outer loop 裁决与 follow-up 对显式 continuation 的优先处理 |
| v1.0 | 2026-10-05 | 扩写第 7 章模型参数的运行时信任边界：区分 schema 校验、TypeScript `unknown`/`as` 与 `beforeToolCall` 可变参数行为，并引用现有回归测试 |
| v1.1 | 2026-10-05 | 扩写第 4 章内存 message 原地替换与持久化 `context_edit` 的区别，追踪原始 JSONL、活动分支与模型投影三种视图 |
| v1.2 | 2026-10-05 | 修正第 4 章对流式状态的说明：partial message 位于 `streamingMessage`，最终 `message_end` 才追加到 `AgentState.messages`；补充 session hook 替换和 `context_edit` 的独立时序 |
| v1.3 | 2026-10-05 | 修订第 9 章 L05 分支编辑步骤，使用真实 `SessionManager.branch` API，并把“跨分支编辑应拒绝”列为观察项，避免实验尝试编辑不在活动分支上的目标 |
| v1.4 | 2026-10-05 | 新增 D29：补充 ModelRuntime 请求认证参数的合并顺序、runtime 凭据覆盖、按 provider 串行操作、提交后同步错误与快照并发保护；更新精读索引、源码地图和验证记录 |
| v1.5 | 2026-10-05 | 新增 D30：补充 provider 组合层次、模型 upsert/replacement 差异、provider 能力委托和动态刷新发布；更新精读索引、源码地图、验证记录与学习计划进度 |
| v1.6 | 2026-10-05 | 扩写第 1.3.5 节：以 `read` 工具串起 TypeBox 运行时 schema、`Static<T>` 泛型推导、`AgentTool.execute` 参数和 Agent 执行前校验，补足 TS 新手理解静态类型与真实输入验证的桥接 |
| v1.7 | 2026-10-05 | 修订第 1.3.6 节 `any` / `unknown` / `never` 说明：区分异构工具集合、动态工具事件载荷和具体工具的精确泛型，并演示 unknown 属性存在与属性值类型的两阶段收窄 |
| v1.8 | 2026-10-05 | 校准第 18 章 faux/harness 示例：确认 `Harness.faux.state.callCount` 和 `getPendingResponseCount()` 是当前显式公开的测试句柄，移除要求读者自行接出 faux 的过时提示 |
| v1.9 | 2026-10-05 | 补全第 18 章 PowerShell 单文件 Vitest/node:test 命令，明确隔离全量 `test.sh` 仍需 Git Bash/WSL，并链接到附录 K.5 的平台命令说明 |
| v2.0 | 2026-10-05 | 补充第 7、14 章扩展工具从加载期注册、核心绑定、AgentTool 包装到逐次 ctx 创建的端到端轨迹，明确 loadout 暴露条件与无 ctx factory 的直接调用边界；更新验证记录 |
| v2.1 | 2026-10-05 | 修正 D10 对 `getMessagesFromProjectedEntryForCompaction` 的未确认猜测，依据实现与既有测试说明 compaction/system 消息过滤及 checkpoint 回放边界；更新验证记录 |
| v2.2 | 2026-10-05 | 修正 D11 对 `lazyStream` 启动时机和错误传播的描述，区分 Models 层 error stream、直接 provider API 同步认证异常与上下文规范化异常；补充调用轨迹及验证记录 |
| v2.3 | 2026-10-05 | 补全 D8 `message_end` 角色不匹配时的处理结果：报告错误、跳过非法替换并继续派发，保留先前合法替换或回退原消息；注明当前未发现该非法分支的专门测试 |
| v2.4 | 2026-10-05 | 校正 D14 扩展加载事务边界与 commit 顺序；解释低层 loader 的空 warnings 如何由 ResourceLoader 根据包依赖和内置扩展替代情况补充 |
| v2.5 | 2026-10-05 | 修正 D16 `parentId` 重写的理由与能力边界：导出把可达活动分支规范成独立线性链，不负责修复原始父链断裂；引用分享导出测试 |
| v2.6 | 2026-10-05 | 将 D8 `message_end` handler 滚动事件语义改为源码确认；修正 D14 对扩展间 provider 顺序依赖的猜测，改为文档化顺序对同名工具首个注册胜出的影响 |
| v2.7 | 2026-10-05 | 修订第 16 章与 D12 对 Node `readline` 识别 U+2028/U+2029 的确定性表述；对照 Node v23.9.0 官方文档标注证据不一致和未核实边界 |
| v2.8 | 2026-10-05 | 修正第 18 章弱断言示例：改用 `AgentSession.retryAttempt` 公开 getter，区分内部计数与重试事件契约 |
| v2.9 | 2026-10-05 | 修正 D1 顺序工具批次取消后的转录描述：区分事件与消息完整性、Agent loop 与模型转换层，并限定孤立调用合成结果的适用范围 |
| v3.0 | 2026-10-05 | 同步修正第 6 章取消说明：区分顺序与并行批次中未开始、已准备和已执行的工具；明确 Agent loop 不保证每个声明调用都有结果消息 |
| v3.1 | 2026-10-05 | 修正第 6 章取消验收答案，使工具准备阶段与模型流取消分别按源码轨迹回答 |
| v3.2 | 2026-10-05 | 为第 6 章并行工具取消增加 A/B/C 时序轨迹，展示准备阶段取消如何改变结束事件与结果消息顺序，并标注缺少直接测试 |
| v3.3 | 2026-10-05 | 修正 D1 对 `agentLoop` rejected Promise 的异常归因；区分低层流包装器缺少失败通道与 `Agent.runWithLifecycle` 的正常失败收尾 |
| v3.4 | 2026-10-05 | 为 D1 增加 `Agent.prompt` 与低层 `agentLoop` 的 Promise 异常路径对照图 |
| v3.5 | 2026-10-05 | 修正第 3 章 `runWithLifecycle` 异常说明：普通运行异常转失败事件，但失败事件监听器再抛错时 `prompt()` 仍会 reject；补充验证边界 |
| v3.6 | 2026-10-05 | 扩写 D27：区分 AgentSession 启动前、Agent run 与 `agent_settled` listener 的异常传播，并追踪同步 listener 抛错对原始异常、deferred actions 和 idle waiter 的影响 |
| v3.7 | 2026-10-05 | 对照 `Agent.subscribe` 与 `AgentSession.subscribe` 的 await 契约；更正第 15 章表述并补充 SDK listener 异步错误处理示例 |
| v3.8 | 2026-10-05 | 更正第 4 章 `AgentEvent` 成员数为 10；说明嵌套 `AssistantMessageEvent` 不属于顶层事件联合 |
| v3.9 | 2026-10-05 | 更正第 4 章 `AgentSessionEvent` 并非 `AgentEvent` 严格超集；注释 `Exclude` 替换 `agent_end` 及工具事件父调用字段 |
| v3.10 | 2026-10-05 | 更正 `entry_appended` 覆盖范围；同步第 4、9、10、16 章、D3 与数据形状表，区分事件通知和完整条目持久化 |
| v3.11 | 2026-10-05 | 为第 6 章正常 loop 终止表补充 hook rejection 的异常出口，并对照 Agent lifecycle 与低层流包装器的收尾差异 |
| v3.12 | 2026-10-05 | 校准第 7 章并行工具调度顺序：准备阶段串行，immediate 结果在准备期间发 end，执行结果按闭包收尾次序发 end，结果消息保持已处理调用的声明顺序；补充取消边界与验证记录 |
| v3.13 | 2026-10-05 | 补充第 6 章 error/aborted 响应下 `finishTurn` 仍 await 但其 action 被忽略的硬退出语义，并说明 hook rejection 会中断后续结束事件；依据源码与既有测试静态核对 |
| v3.14 | 2026-10-05 | 扩写第 5 章 `AssistantMessageEventStream` 事件协议：补充 `start`/增量/终态顺序、共享可变 `partial`、最终消息权威性及适配器检查项；依据类型、实现和既有测试静态核对 |
| v3.15 | 2026-10-05 | 补充第 5 章模型类型与 Provider 能力路由及验收题：对比 chat/image/classifier 与 deferred 能力，说明 API map 分派、运行时类型检查和不同错误形态；更新源码地图与验证记录 |

## G.6 反馈与勘误

发现手册与代码不一致时，按 G.3 更新；若你愿意上交流程建议（不是必须），最小改动 + 说明即可（第 20 章的四段式）。**本手册是学习材料，不是本仓库的权威文档——权威永远是代码与本仓库自带的 docs/。**
