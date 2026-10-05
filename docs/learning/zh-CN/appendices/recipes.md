# 附录 I：任务配方（动手改源码的常用流程）

> 用法：每个配方是"目标 → 步骤 → 验证 → 常见坑"。步骤中给出的文件与符号都在本手册对应章节精读过；**动手前先读该章**，不要只照抄步骤。

---

## I.0 配方的通用纪律（先读三条）

1. **读全要改的文件**（`AGENTS.md` 要求）——不靠搜索片段下结论；
2. **改完必跑** `npm run check`（第 20.1 节；它会改写文件，跑完审 diff）；
3. **新增/修改测试必跑对应测试**（第 18.2 节的单文件命令）。

---

## I.1 加一个只读工具（扩展）

**目标**：给 pi 增加一个"读取某数据并返回摘要"的工具，模型可调用。
**主参考**：第 14 章（尤其 14.8 的 `inspect_package`）。

步骤：

1. 建文件（从 `examples/extensions/hello.ts` 抄骨架）：`defineTool({ name, label, description, parameters: Type.Object({...}), execute })`；
2. 路径解析用 `ctx.cwd` 为基（**不要**作者机器绝对路径，第 14.8.4 节）；
3. 错误用 `throw new Error("...路径与原因...")`（会变成 `isError` 结果——第 7.4.1 节）；
4. 输出保持小体积；可能大的话用 `truncate.ts` 的工具函数（第 7.9 节）；
5. 用 `pi --extension ./my-ext.ts`（或 `pi-test` 加 `-e`）加载，跑一次对话验证；再按第 18 章写 faux 测试（缺文件/坏 JSON/取消）。

验证：模型能调用；错误路径返回 `isError`；`/reload` 后不重复注册（第 13.8 节）。
常见坑：忘了 `registerTool`（工具只定义不注册）；`parameters` 不是对象 schema（`registerTool` 会抛，第 D14 第 6 节）。

## I.2 加一个 `/命令`（扩展）

**目标**：注册一个用户可输入的命令。
**主参考**：第 13.7.4 节。

步骤：

1. `pi.registerCommand("name", { description, handler: async (args, ctx) => { ... } })`；
2. 交互能力用 `ctx.ui.notify/select/confirm`（按 `ctx.hasUI`/`ctx.mode` 分支，第 13.6 节）；
3. 想触发一次模型运行：用 `pi.sendUserMessage("...")`（第 13.2 节）；
4. 命令内**不要**调死锁操作（生命周期钩子专用的动作会死锁——第 13.1.3 节）。

验证：`/name` 出现在补全；非交互模式下行为安全（无 UI 分支）。
常见坑：handler 里用了 `ctx.reload()` 后继续访问旧 ctx（reload 视为终止——第 13.1.3 节）。

## I.3 加一个快捷键

**目标**：新增一个可配置快捷键。
**主参考**：第 17.9 节（表格）与 `AGENTS.md` 的键位规则。

步骤：

1. 在**默认键位表**里加条目（`packages/coding-agent/src/core/keybindings.ts` 的 `KEYBINDINGS`，或 `packages/tui` 的 `TUI_KEYBINDINGS`——看动作属于哪层）；
2. 平台差异（如需）用 `useWindowsKeybindings()` 模式（第 17.9.3 节）；
3. 在**消费处**通过键位系统查询（`keybindings.getKeys("app.x")` / 键位管理器）——**绝不硬编码 `matchesKey` 字符串**；
4. 帮助/提示文案用 `keyHint`/`keyDisplayText` 辅助（第 D13 第 4 节）。

验证：`/hotkeys` 显示；修改 `keybindings.json` 可覆盖（第 17.9.1 节）。
常见坑：只加了 handler 没进默认表（会被评审要求改）。

## I.4 加一个设置项

**目标**：新增一个用户可配置的选项，且能被正确读取。
**主参考**：第 11.3 节 + `docs/settings.md`。

步骤：

1. 在 `core/settings-manager.ts` 的 `Settings` 类型/默认值中加入字段；
2. 加 getter（**想清楚读合并设置还是仅全局**——第 11.3.4 节）；
3. 在**消费点**决定动态读还是装配时快照（第 D5 第 5 节的取舍）；
4. 需要迁移的话在 `migrateSettings` 里加分支（第 11.3.2 节）；
5. 补 `docs/settings.md`；补测试（若有 verify 逻辑）。

验证：设置文件生效；非法值有诊断而不崩（第 11.3.2 节的容错）。
常见坑：getter 读错层（项目设置未信任时行为不同）。

## I.5 加一个供应商适配器（pi-ai）

**主参考**：第 5 章 + `docs/custom-provider.md`（扩展方式）。

步骤（以"OpenAI 兼容端点"为例，走 models.json 而非新代码）：

1. 在 `~/.pi/agent/models.json` 声明端点与模型（`baseUrl`、`api: "openai-completions"`、模型上限/价格/兼容开关——第 5.5.4 节）；
2. 认证走环境变量/`auth.json`（第 5.6 节）；
3. `--list-models` 验证出现；发一次请求验证流式。

若要**内置**新供应商：加 `providers/<name>.ts`（照抄 `anthropic.ts` 的 `createProvider` 结构）+ `providers/<name>.models.ts` 目录 + `providers/all.ts` 注册；模型数据大改走生成脚本（`packages/ai/scripts/generate-models.ts`，不手改 `models.generated.ts`——`AGENTS.md` 规则）。
常见坑：忘记子路径导出（`package.json` 的 `exports`）或入口成本预算（第 20.2.4 节）。

## I.6 做一个主题

**主参考**：第 12.3.5/17.7 节、`docs/themes.md`、`interactive/theme/theme-schema.json`。

步骤：复制一份现有主题 JSON（`dark.json`/`light.json`）→ 改语义色 token → 放 `~/.pi/agent/themes/` 或项目 `.pi/themes/` → 在设置里选择（或 `/theme`）→ `/reload`。

验证：`/settings` 或主题选择器里出现；切换后界面即时变化（`invalidate` 机制，第 17.7.2 节）。
常见坑：给的是"具体色"而 schema 要语义 token（或反之）——对照 schema 校验错误（主题 JSON 会被全量校验，第 D6 第 10 节）。

## I.7 写一个 Prompt Template 或 Skill

**主参考**：第 12.3.2/12.3.3 节。

Template：`prompts/<name>.md` + frontmatter（`description`/`argument-hint`）+ 正文用 `${1:-default}` 等替换；`/reload` 后 `/name` 可用。
Skill：目录 + `SKILL.md`（`name`/`description` 必填 —— 描述写"做什么+何时用"）；配套文件用**相对技能目录**的路径引用；`/skill:name` 强制加载验证；模型自动路由看 description 质量。
常见坑：技能无描述不加载；模板放在嵌套目录（约定只加载直接子文件——第 12.3.2 节）。

## I.8 写一个 SDK 宿主

**主参考**：第 15 章与 L09 实验。

步骤：

1. `createAgentSession({ sessionManager: SessionManager.inMemory() })`（或完整注入——第 15.4 节）；
2. 订阅事件打印流式文本与工具生命周期（`message_update`/`tool_execution_*`）；
3. `try { await session.prompt(...) } finally { unsubscribe(); session.dispose(); }`；
4. 异常/取消路径也走同一 finally（第 15.6 节的释放矩阵）。

验证：日志顺序 `agent_end` → `agent_settled` → disposed；进程能自然退出。
常见坑：忘 dispose（进程不退出）；流式中直接再 `prompt`（必须给 `streamingBehavior`——第 15.5.2 节）。
---

## I.9 写一个 RPC 客户端

**主参考**：第 16.5-16.7 节。

步骤：

1. 用 `RpcClient`（`@earendil-works/pi-coding-agent` 导出）或手写子进程 + JSONL 解析（第 16.7 节的"按行重组"循环）；
2. **订阅先于发送**（避免快速完成丢事件；`promptAndWait` 已内建该顺序——第 16.5.3 节）；
3. 完成判定等 `agent_settled`；`prompt` 响应只是"已接受"（看 `disposition`）；
4. 错误处理三来源分开：命令失败（`success:false`）/ 解析失败（无 id 的 `parse` 响应）/ 运行错误（事件流）。

验证：分片到达也能正确解析（用 64 字节读实验，第 16.8 节）；关停走"关 stdin"。
常见坑：用 `readline`；把日志写进 stdout 污染协议；按响应顺序配命令（必须按 `id`）。

## I.10 写一个回归测试（faux + harness）

**主参考**：第 18 章。

步骤：

1. 在 `packages/coding-agent/test/suite/` 建 `<行为>.test.ts`；
2. `createHarness({...})` 组装（可注入内联扩展、工具白名单、内存会话——第 18.3.1 节）；
3. `harness.setResponses([...])` 脚本化模型（`fauxAssistantMessage`/`fauxToolCall`——第 5.7 节）；
4. 断言**外部行为**（事件序列、消息形状、条目内容——第 18.5 节）；
5. **自证失败**：把实现改坏 → 必须红 → 还原（第 18.5.3 节）；
6. `afterEach` 里统一 `harness.cleanup()`。

运行（在 `packages/coding-agent`）：`node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/<file>.test.ts`。
常见坑：依赖真实计时器（用可控 Promise）；断言内部私有字段。

## I.11 调查"工具没被调用"

**主参考**：第 7.3 节 + 第 19.3 节阶段 4。

排查顺序：

1. 工具是否注册且激活？（`getActiveToolNames`/`getAllTools`——声明 vs 可执行，第 7.3 节）
2. 系统消息里有没有它的 `toolsAdded` 声明？（读会话文件或事件）
3. `tool_call` 钩子是否拦截？（`isError` 结果里的 reason——第 7.6.1 节）
4. 模型是否"看不见"（exposure/hidden——第 14 章；MCP 默认 codemode 暴露——第 22.3 节）
5. 事件流里有没有 `tool_execution_start`？（有 start 无 end = 执行中/取消路径——第 6.5 节）

## I.12 调查"配置没生效"

**主参考**：第 11.6 节（完整工作流）。

一句话版：定位 getter → 确认 agentDir/文件 → JSON 合法性（看诊断）→ 项目信任 → CLI/会话覆盖 → `/reload` → 子系统刷新时机。

## I.13 调查"上下文爆炸/压缩太频繁"

**主参考**：第 10 章 + D4/D10。

排查顺序：

1. 看 `usage`（第 4.3.5 节）的输入构成——是不是工具输出过大？（用 `truncate` 工具函数——第 7.9 节）
2. 看压缩事件（`compaction_start/end` 与 reason：threshold/overflow——第 16.4.3 节）；
3. 调整 `reserveTokens`/`keepRecentTokens`（第 10.2.1 节）；
4. 检查重试遗漏：失败尝试是否被 `context_edit` 省略（`_omitRecoveryAttempt`——第 6.6.2 节）——省略会让"看到的"小于"算的"。

## I.14 调查"会话恢复异常"

**主参考**：第 9 章 + 第 19.3 节阶段 5。

排查顺序：

1. 目标会话的 cwd 是否存在（`assertSessionCwdExists` 报错——第 8.5.1 节）；
2. 用 `/tree` 看活动叶子是不是你想的分支（第 9.1 节）；
3. 文件是否有坏行（容错读取会跳过——第 9.2.3 节）；手工修复前先备份；
4. 版本迁移是否发生（v1-v3——第 9.2.2 节）；
5. 模型恢复失败看 `modelFallbackMessage`（第 3.5 节）。

## I.15 调查"终端显示问题"

**主参考**：第 17 章 + 第 19 章。

排查顺序：

1. 复现条件：宽度/字符（中文/emoji）/模式（regular vs fullscreen）——第 17.11 节的最小复现法；
2. 组件层验证：`visibleWidth`/`truncateToWidth` 的边界（第 17.10 节）；
3. 原始字节：`PI_TUI_WRITE_LOG`（第 17.8.2 节）；
4. 交互键位/IME：`Focusable`/`CURSOR_MARKER`/focused 传递（第 17.4.2 节）。

## I.16 提交一个可评审改动（清单）

**主参考**：第 20 章 + 第 21 章。

1. 读全文件 → 最小实现 → 测试（红→绿）→ `npm run check`（完整输出）→ 审 diff（`--write` 的副作用！）；
2. 写四段式说明：问题/行为变化/测试证据/影响边界；
3. Git：只暂存自己的文件（显式路径）、消息格式 `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: ...`；
4. **不提交**除非用户要求；**不** `git add -A`/`--no-verify`（第 20.5 节）。

## I.17 打包分发（Pi package）

**主参考**：第 12.3.6/14.9 节 + `docs/packages.md`。

1. 目录约定（`extensions/`/`skills/`/`prompts/`/`themes/`）或用 `package.json` 的 `pi` manifest 声明（支持 glob/排除）；
2. host 提供的包放 `peerDependencies`（`"*"`）**且不打包**；自己的运行时依赖放 `dependencies` 并钉版本；
3. 本地验证：`pi install ./my-package`（不复制、直接加载）与 `pi -e ./my-package`（单次试用）；
4. 发布后：`pi list`/`pi update --extensions` 验证安装与更新。

---

## I.18 配方索引（按场景找）

| 场景 | 配方 |
|---|---|
| 我要给模型加能力 | I.1（工具）/ I.5（供应商） |
| 我要给用户加快捷入口 | I.2（命令）/ I.3（快捷键） |
| 我要调行为参数 | I.4（设置）/ I.6（主题） |
| 我要喂流程知识 | I.7（模板/技能） |
| 我要嵌入或远程驱动 | I.8（SDK）/ I.9（RPC） |
| 我要写测试/修 bug | I.10（测试）/ I.11-I.15（调查） |
| 我要交付改动 | I.16（提交）/ I.17（分发） |

**最后提醒**：每个配方都只有"骨架级"步骤；真正的细节在对应章节——**配方帮你找到入口，章节帮你理解为什么**。