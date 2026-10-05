# 第 19 章：调试、故障定位与回归修复

> 学完本章你能回答：
>
> 1. "pi 不工作"应该按什么顺序缩小范围？六个阶段的检查点分别是什么？
> 2. 仓库里有哪些排障设施（事件流、耗时打点、渲染日志、崩溃记录、报告脱敏）？
> 3. 一份合格的"最小复现说明"包含什么？
> 4. "工具完成了但界面还在转圈"这类问题怎么逐层定位？
> 5. 修复一个问题的最小闭环是什么？回归测试怎么带 issue 号？

**前置知识**：第 3-11 章（各层如何工作）、第 18 章（测试）。
**预计学习时间**：1 天（配一次真实排障练习）。
**本章验证状态**：静态核对通过（`slash-commands.md`、`crash-log.ts`、`bug-report.ts`、`main.ts` 打点；方法论部分按各章结论整合）。

---

## 19.1 总原则：分层缩小，而不是猜

排障的目标不是"改到好为止"，而是：**把"pi 不工作"缩小成一个有明确期望、可重复、能断言的最小问题**。

规划文档给出的定位顺序是有道理的（从外到内、从静到动）：

```text
启动 → 配置/资源 → 模型请求 → 工具 → 持久化 → UI
```

每一步都问同一个问题：**"到这一步为止，哪些东西已经被证明是好的？"** 用排除法推进，而不是"凭最后那条报错文本改代码"（`AGENTS.md` 对排障的态度）。

一个实用心法：**先复现、再定位、后修复**。定位之前不要动任何实现。

## 19.2 内置排障设施一览

### 19.2.1 事件流：飞行记录仪

第 4、16 章建立的直觉在这里变成工具：

- **交互模式**：界面本身就是事件流的渲染（但会聚合）；
- **JSON 模式**：`pi --mode json ... > events.jsonl`——把轨迹落盘，事后 `jq` 分析：

```bash
pi --mode json "复现步骤" > events.jsonl 2> stderr.log
jq -c 'select(.type | test("agent_|turn_|message_end|tool_execution_(start|end)|error"))' events.jsonl
```

仓库源码运行时，显式使用对应平台的源码入口，避免误把已安装版本当成本次 checkout：

```powershell
# Windows PowerShell；命令会按当前模型配置发送真实请求
& .\pi-test.ps1 --mode json "复现步骤" 1> events.jsonl 2> stderr.log
Get-Content events.jsonl | ForEach-Object { $_ | ConvertFrom-Json }
```

```bash
# Linux / macOS / Git Bash
./pi-test.sh --mode json "复现步骤" > events.jsonl 2> stderr.log
jq -c 'select(.type | test("agent_|turn_|message_end|tool_execution_(start|end)|error"))' events.jsonl
```

JSONL 通常包含用户输入、assistant 内容、工具参数和结果；在分享前检查两个文件并脱敏。不要为了排障把带凭据的 prompt 或文件内容发到 issue。

- **SDK 宿主**：`session.subscribe` 里打点（第 15 章的 L09 宿主就是为排障设计的）。

**判断"完成到哪一步"的铁律**（第 6、16 章）：`agent_end` ≠ 结束，`agent_settled` 才是"不会再自动继续"。

### 19.2.2 启动与耗时：`--verbose` 与打点

- `main.ts` 用 `time("...")` 给各启动阶段打点（parseArgs、resourceLoader.reload、createAgentSession 等），由 `printTimings()` 输出；
- `PI_STARTUP_BENCHMARK=1`（仅交互模式）会初始化后立刻退出并打印耗时——**一条命令定位"启动慢在哪一步"**；
- `--verbose` 让启动过程更啰嗦（诊断信息更多）。

### 19.2.3 渲染层：`PI_TUI_WRITE_LOG`

第 17.8 节的"原始 ANSI 流捕获"。UI 显示类问题的第一步：**看发出去的字节**，而不是盯着屏幕猜。

### 19.2.4 崩溃记录：`crashes.json`

`core/crash-log.ts` 把未捕获异常/致命错误写进**agent 目录**下的 `crashes.json`：

```typescript
export interface CrashRecord {
	timestamp: string;
	version: string;
	kind: "uncaught_exception" | "fatal_error";
	message: string;
	stack: string | null;
	sessionFile: string | null;
	cwd: string;
	notified?: boolean;
}
```

保留策略（源码常量）：**最多 5 条、最长 7 天**。它是"进程直接死了"这类问题的第一现场。

### 19.2.5 会话与设置类命令

| 命令 | 用途 |
|---|---|
| `/session` | 当前会话信息与统计（session id、文件、用量） |
| `/tree` | 查看/切换会话树（第 9 章）——判断"活动分支是不是你想的" |
| `/export` | 导出会话（HTML/JSONL）用于分析（注意隐私） |
| `/settings` | 查看/修改设置（第 11 章） |
| `/reload` | 重载键位/扩展/技能/模板/主题/上下文文件——**资源类问题的第一步** |
| `/hotkeys` | 确认键位实际生效值 |
| `/trust` | 项目信任决定（第 11 章） |

### 19.2.6 上报设施：`/bug` 与脱敏

交互模式可以 `/bug [描述]` 准备一份**给 pi 开发者**的报告。`core/bug-report.ts` 的工程细节值得学习：

- 敏感键名匹配（`SENSITIVE_KEY` 正则覆盖 api key、secret、token、password、credential、authorization、cookie 等）→ 值替换为 `<redacted>`；
- `redactUrl()`：剥掉 URL 里的用户名/密码与敏感查询参数；
- `redactJsonValue()`：递归脱敏 JSON；
- 报告以 `custom` 条目（`customType: "pi.bug-report"`）随会话携带。

**给你自己的排障用**：贴日志/贴会话前，先做同样的自查——**密钥、内部地址、文件内容都可能在事件流里**（安全文档的提醒同样适用）。

## 19.3 六阶段定位手册

### 阶段 1：启动

| 检查点 | 方法 | 常见根因 |
|---|---|---|
| Node 版本与依赖 | `node --version`、重跑 `npm install --ignore-scripts` | 版本过低（<22.19）、依赖缺失 |
| 看的是哪份代码 | 用 `pi-test`（源码）还是 `pi`（安装版）？ | 改了源码但跑安装版（第 2.9 节） |
| 工作目录 | 启动时的 cwd 是否正确 | 项目配置/会话认错目录（第 2.4.2 节） |
| 崩溃现场 | 读 `crashes.json` | 未捕获异常、扩展加载崩溃 |
| 启动慢 | `PI_STARTUP_BENCHMARK=1` | 某阶段耗时异常（资源扫描、模型目录刷新） |

### 阶段 2：配置与资源

按第 11.6 节的顺序：定位 getter → 找文件 → 验 JSON → 查信任 → 查覆盖 → `/reload` → 子系统特例。**别忘了启动诊断列表**：坏配置不会崩启动，只会出现在诊断里。

### 阶段 3：模型请求

| 检查点 | 方法 | 对应章节 |
|---|---|---|
| 认证优先级 | 逐层核对（已存凭据 → 环境变量 → 联合身份） | 第 5.5.1 节 |
| 模型可用性 | `--list-models`、`getAvailable()` | 第 5.2 节 |
| 请求有没有发出去 | 事件流里有没有 `message_start(assistant)` | 第 3、16 章 |
| 失败了在重试吗 | `auto_retry_*` 事件 | 第 6.6 节 |
| 超时/代理 | `getHttpIdleTimeoutMs`、`httpProxy` 设置 | 第 11.3.4 节 |

### 19.3.1 用“最后一条正确事件”定位模型/工具轨迹

不要只看最后一个错误字符串。把事件按到达顺序读，找**预期轨迹中最后一条确实出现的记录**，然后检查紧接着应该发生的下一层：

| 最后观察到的内容 | 它能证明什么 | 下一步读哪里 |
|---|---|---|
| 没有 `agent_start` | 低层 Agent run 尚未开始，或模式/订阅没有捕获事件 | `AgentSession.prompt()` 的命令短路、input handler、model/auth preflight；RPC 看 prompt `response.disposition` 与 `success` |
| `agent_start`，但没有 assistant `message_start` | run 已进入 Agent，尚无可见的 assistant 消息开始 | `agent-loop.ts` 的模型调用与 provider stream 创建；检查 `agent_end` 的结束消息及 retry 事件 |
| assistant `message_start`，没有 `message_update` | 有 assistant 消息开始，但没有 JSON 可见增量 | 适配器是否发出事件、流是否立即终止/报错；对照 SDK 里的 `assistantMessageEvent` 与 JSON 瘦事件格式 |
| `tool_execution_start`，没有同 id 的 `tool_execution_end` | Agent 已决定调用工具，执行生命周期未观察到结束 | `executePreparedToolCall`、工具的 abort signal/进度 Promise，以及输出背压是否阻塞事件派发 |
| `tool_execution_end`，但没有后续 assistant `message_start` | 工具已结束，下一轮模型请求尚未可见 | `hasMoreToolCalls`、工具结果写回和 `runLoop` 的下一轮条件；若这是 abort/错误，查对应结束事件 |
| `agent_end` 且 `willRetry: true`，暂时没有 settled | 一个低层 run 结束，session 层准备 retry/恢复 | `AgentSession._handlePostAgentRun()` 的 retry/compaction 分支；此时不能判定挂死 |
| 有 `agent_settled`，界面仍显示忙碌 | session 生命周期已发出 settled，问题在监听器、状态归约或渲染层 | UI 是否绑定了替换后的 session、settled listener 是否完成、组件是否 invalidate/requestRender |

`message_update` 的线上形状不带 SDK 的累积 `message`/`partial` 快照（第 16.3.2 节）。所以“没有找到 `.message` 字段”不能说明模型没输出；JSON 客户端要看 `assistantMessageEvent` 的 delta，并以 `message_end.message` 为最终事实。

最小定位记录可以写成：

```text
预期：tool_execution_start(id=call-7) 后应有 tool_execution_end(id=call-7)
实际：start 出现；后续只有 assistant message_end(stopReason=aborted)，没有 end
当前证明：模型已选中工具；异常位于工具执行/取消/事件派发区间，不是工具未注册
下一步：从同一个 toolCallId 检查执行 Promise、abort signal 与工具 finally 清理
```

示例中的 id 与事件只是说明记录格式；实际排障必须填写从当前版本日志里观察到的值，不能把示例值当作系统行为。

### 阶段 4：工具

按第 7 章的链路逐点检查：

```text
声明在不在？（系统消息 toolsAdded / state.tools / 白名单设置）
→ 调用到了吗？（tool_execution_start 事件）
→ 参数合法吗？（Validation failed 文本）
→ 被钩子拦截了吗？（block 结果与 reason）
→ 工具抛错了吗？（isError 结果文本）
→ 取消了还是超时了？（Operation aborted / 信号）
```

**声明 vs 可执行**（第 7.3 节）是工具类问题最高频的根因。

### 阶段 5：持久化

| 症状 | 检查 |
|---|---|
| 历史"丢"了 | 是不是在另一条分支？（`/tree`、活动叶子） |
| 恢复报错 | 会话的 cwd 不存在（`assertSessionCwdExists`）；用 `--session-dir` 或恢复目录 |
| 压缩后"失忆" | 压缩是表示替换不是删除；看压缩条目与 `firstKeptEntryId`（第 9、10 章） |
| 文件打不开 | 坏行会被跳过（容错读取）；严重损坏时用导出/手工修复副本 |

### 阶段 6：UI

顺序：**状态对不对 → 事件到没到 → 组件刷没刷**。

1. `session.state` / 事件流：数据层是否正确（第 4.6 节）；
2. 订阅链：回调是否被调用（第 3.7 节的 await 语义、重绑问题见第 8.6 节）；
3. 渲染层：`invalidate()`/`requestRender` 是否触发；宽度/主题/IME（第 17 章）；`PI_TUI_WRITE_LOG` 看字节。
## 19.4 最小复现（MRE）：把问题变成一份"可断言"的说明

### 19.4.1 模板

一份合格的复现说明包含（规划文档的要求 + 本章的格式建议）：

```markdown
## 环境
- 仓库基线：<commit>
- 运行方式：pi-test（源码）/ 安装版 / SDK / RPC
- OS 与 shell：<Windows + PowerShell 7 / macOS + zsh ...>
- Node 版本：<v23.9.0>

## 预期
（一句话，可观察）

## 实际
（含原始输出/事件片段；必要时附 events.jsonl 片段）

## 最小步骤
1. ...
2. ...
（每一步都能独立重复；不掺杂无关操作）

## 失败断言
（如果写成测试，断言什么？—— 这句话逼你把"感觉不对"翻译成"可验证差异"）

## 已排除项
（试过什么、结果如何——避免别人重走弯路）
```

模板里最关键的是**"失败断言"**：写不出断言，往往说明还没定位到"到底哪里不对"。

### 19.4.2 缩小手段工具箱

| 手段 | 做法 | 适用 |
|---|---|---|
| 二分回退 | 禁用一半扩展/设置，看问题是否消失 | 资源类问题（扩展冲突、配置覆盖） |
| 事件断点 | 在 JSON 流里找"最后一个符合预期的记录"与"第一个不符合的" | 流程类问题（循环、工具、重试） |
| 确定性替换 | 把"偶发"换成"必现"：固定输入、faux 模型、fake 计时器 | 竞态与顺序问题 |
| 分层隔离 | 用 SDK/harness 复现原本在 TUI 里的问题 | 渲染无关的会话/循环问题 |
| git bisect | 已知"某版本开始坏"时按提交二分 | 回归类问题（配合 issue 号） |
| 对照实验 | 同一输入跑"有工具/无工具""A 模型/B 模型" | 差异定位 |

一个反直觉但重要的提醒（来自本仓库的测试纪律）：**"偶发"往往是"你还没找到触发条件"**。与其 rerun 十次等它出现，不如把时序条件显式构造出来（可控 Promise、先排队的消息、特定的完成顺序）。

### 19.4.3 什么时候停

当你满足以下三条，就停止缩小、进入修复：

1. 有一份**别人照着能复现**的步骤；
2. 有一个**写得出来的断言**（期望 vs 实际）；
3. 能指出**修改点所在的那一层**（哪怕函数还没最终确定）。

## 19.5 回归修复闭环：测试先行

本仓库的标准闭环（结合 `AGENTS.md`）：

```text
① 写一个当前会失败的回归测试（faux/harness，见第 18 章）
    └─ 修复 GitHub issue 时：在测试旁加注释写明 issue 号
② 修最小实现（只改必要范围；不做无关重构）
③ 跑该测试 → 通过；再跑相关邻近测试
④ 改完必须 npm run check（第 20 章）并保留完整输出
⑤ 组织变更说明：问题、行为变化、测试证据、影响边界
```

为什么不"先修再补测试"？因为**先失败的测试本身就是复现说明**——它把"我以为的问题"固化成可执行的证据；而且能防止"改 A 坏 B"。

两条纪律：

- **回归测试要带 issue 号注释**（`AGENTS.md` 原文："When regressions tests for fixing a github issue, add a comment with the github issue number next to the test."）；
- **不要顺手清理**：修复 PR 里混入无关重构是评审大忌（第 20 章展开）。

## 19.6 案例走查

### 案例 A："工具已经完成，界面还显示运行中"

按第 19.3 的"状态 → 事件 → 渲染"顺序逐层问：

| 问题 | 验证方法 | 结论指向 |
|---|---|---|
| 循环真的结束了吗？ | 事件流里有没有该有的 `turn_end`/`agent_end`？ | 没有 → 循环层（第 6 章）：还有工具在跑？还有排队消息？`finishTurn` 是否返回了 continue？ |
| `agent_end` 发了吗？ | JSON 流/SDK 订阅检查 | 发了但界面没收 → 订阅链（第 8.6 节重绑？第 3.7 节监听器 await？） |
| `agent_settled` 发了吗？ | 同上 | 没发 → 会话收尾循环未结束（重试/压缩/边界钩子在忙） |
| 状态归约对了吗？ | `session.state.pendingToolCalls` 是否已删干净？ | 有残留 → `tool_execution_end` 没配对（工具名/id 变了？事件漏发？） |
| UI 刷了吗？ | 界面组件的 `invalidate`/`requestRender` 日志 | 没刷 → 渲染层（第 17 章） |

**这个顺序的价值**：任何答案都能被"某一层的事件/状态"证伪，而不是靠读界面猜。

### 案例 B："改了配置但不生效"

直接套用第 11.6 节工作流（定位 getter → 文件 → JSON → 信任 → 覆盖 → `/reload` → 子系统）。特别提醒两个高频陷阱：

- 改的是**项目设置**但**未信任**（整体被跳过）；
- 改完没 `/reload`，或该值只在启动期读一次（如模型目录刷新）。

### 案例 C："中文输入法候选框位置不对"

按第 17.4.2 节三条要求核查：`Focusable` + `CURSOR_MARKER` + 容器**传递 focused**。用第 17.11 的 tmux 最小复现（80/40 列两档）拿到稳定证据；若仍对不上，用 `PI_TUI_WRITE_LOG` 对比"光标标记发出的字节"与终端实际行为。

## 19.7 常见错误

| 反模式 | 后果 | 正确做法 |
|---|---|---|
| 看到报错文本就改代码 | 改错层、反复回滚 | 先分层定位（19.3） |
| 没有复现就"顺手修" | 无法验证、可能引入回归 | MRE → 失败测试 → 修 |
| rerun 等偶发复现 | 浪费时间、证据不可靠 | 显式构造时序条件 |
| 一次改多处 | 不知道是哪处生效 | 最小改动；一次一个变量 |
| 测试断言了常量/内部字段 | 永远通过或一重构就碎 | 断言外部行为（第 18.5 节） |
| 贴日志不脱敏 | 泄漏密钥/内部信息 | 学 `bug-report.ts` 的 redact 思路 |
| 拿 `agent_end` 当完成 | 误判"卡住" | 等 `agent_settled`（第 6 章） |
| 忘了 `crashes.json` | 与崩溃现场擦肩而过 | 启动失败先读它 |
| 修改与问题无关的"顺手清理" | 评审被拒/掩盖根因 | 独立提交、最小 diff |

## 19.8 实验 L12-B：写一份合格的复现说明

**实验性质**：写作 + 本地验证；题材自选。
**验证状态**：设计中。规划文档对本阶段的验收就是"写复现说明，包含预期/实际结果、基线、必要输入与失败断言"。

### 步骤

1. 从以下题材选一个（或换你自己的）：

   - 用当前仓库复现一个**已知的边界行为**（如"length 截断时工具全部拒绝执行"，第 3.14 节）；
   - 故意制造一个小故障（改坏本地分支的一行、坏配置、错键位），走完整定位流程；
   - 从 GitHub issue（若你已关注）挑一个**不需要真模型**的问题尝试复现。

2. 按 19.4.1 模板写说明，**必须包含失败断言**；
3. 按 19.4.2 至少使用两种缩小手段，并把过程写进"已排除项"；
4. 如果该问题适合测试化：按第 18 章写成 suite 测试（当时应失败），保留为实验产物（不算入仓库提交）。

### 判定标准

- 他人照步骤能复现（或明确指出需要的外部条件）；
- 断言具体（字段/事件/退出码级），不含"看起来不对"这类描述；
- 定位结论指向某一层的**具体机制**（引用本手册的对应章节）。

### 清理

实验改动全部还原；`git status` 干净；删除临时脚本与实验会话。

## 19.9 来源与下一章

- `packages/coding-agent/src/core/crash-log.ts`（`CrashRecord`、`crashes.json`、保留策略）、`core/bug-report.ts`（脱敏与报告形态）、`core/timings.ts` 与 `main.ts` 的打点（`time`/`printTimings`、`PI_STARTUP_BENCHMARK`、`--verbose`）；
- `packages/coding-agent/docs/slash-commands.md`（`/session`、`/tree`、`/export`、`/bug`、`/reload`、`/trust`、`/hotkeys`）；
- 第 11.6 节（配置排查）、第 17.8 节（`PI_TUI_WRITE_LOG`）、第 18.5 节（可区分的测试）；
- `AGENTS.md`（回归测试 issue 注释、`npm run check`、最小改动）。

下一章回答"改动如何变成可评审的提交"：仓库规范、依赖与锁文件、`npm run check` 到底改了什么、以及上游贡献的准入规则。
