# 第 16 章：Print、JSON 与 CLI RPC

> 学完本章你能回答：
>
> 1. 四种前端模式（interactive/print/json/rpc）各自适合什么场景？
> 2. print 模式的成功/失败如何判定？退出码的规则是什么？
> 3. JSON 事件流的"严格 JSONL"具体严格在哪？为什么不能用 `readline`？
> 4. RPC 协议的四类记录是什么？`id` 相关、`prompt` 响应语义、完成信号分别怎么用？
> 5. 流式管道为什么要"按行重组"？分片、背压、Unicode 分隔符各有什么坑？

**前置知识**：第 4 章（事件类型）、第 6 章（agent_end/settled）、第 15 章（SDK 对比）。
**预计学习时间**：1.5 天。
**本章验证状态**：静态核对通过（`cli-integration.md`、`json.md`、`rpc.md`、`rpc-client.ts` 逐个核对）；实验 L10 设计中。

---

## 16.1 四种模式：选哪个

`cli-integration.md` 的总表（原文翻译）：

| 模式 | 输入/输出接口 | 生命周期 | 适用 |
|---|---|---|---|
| Interactive | 终端 UI | 直到用户退出 | 人类直接使用 |
| Print | stdout 输出最终文本 | 一次性 | 脚本只要最终回答 |
| JSON | stdout 输出 JSONL 事件 | 一次性 | 程序需要结构化进度 |
| RPC | JSONL 命令/响应/事件 | 长驻 | 程序需要双向控制 |

**四种模式共用同一套 agent、会话、资源与工具**（`cli-integration.md` 原话）——模式只决定"输入如何进入、输出如何暴露、进程是否继续存活"。这条与第 3 章的"入口不同、内核相同"完全呼应。

三条选择经验：

- 只要"答案"→ print；要"过程"→ JSON；要"边跑边聊"→ RPC；要进程内细粒度 → SDK（第 15 章）；
- 语言无关或需要进程隔离 → JSON/RPC；
- Node/TS 且不需隔离 → SDK（`RpcClient` 是"子进程 + TypeScript 类型"的折中，16.6 节）。

## 16.2 Print 模式：一次性，最终文本

```bash
pi --print "Summarize the changes in this repository"
```

规则（`cli-integration.md`）：

- **只暴露最终助手文本**：中间事件不可见；
- **错误写 stderr**：stdout 只留最终文本，可安全用于命令替换与管道；
- **退出码**：最终响应 `stopReason` 为 `error` 或 `aborted` → **非零退出**；其他错误（抛异常等）也会非零；
- **管道自动降级**：没有显式选模式时，stdin 或 stdout 非 TTY → 自动 print 模式（第 2.8 节的 `resolveAppMode`）。所以 `git diff | pi "review"` 这类用法不需要 `--print`。

一个组合示例（把答案直接喂给下一步）：

```bash
ANSWER=$(pi --print "List the npm scripts in this repo, comma separated")
echo "$ANSWER"
```

## 16.3 JSON 模式：一次性事件流

```bash
pi --mode json "Review this repository" > events.jsonl
```

**它不是"一个 JSON 结果"**，而是**事件流**（`json.md` 开头的强调）；流的第一行是**会话头**（与第 4.7 节的 `SessionHeader` 相同）：

```json
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path"}
```

完整的一次运行长这样（`json.md` 示例）：

```json
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"message_start","message":{"role":"user","content":"Review this repository","timestamp":1733234401000}}
{"type":"message_end","message":{"role":"user","content":"Review this repository","timestamp":1733234401000}}
{"type":"message_start","message":{"role":"assistant","content":[],"stopReason":"pending"}}
{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hello"}}
{"type":"message_end","message":{"role":"assistant","stopReason":"stop"}}
{"type":"turn_end","message":{"role":"assistant"},"toolResults":[]}
{"type":"agent_end","messages":[...],"willRetry":false}
{"type":"agent_settled"}
```

三个关键语义：

1. **进程在 prompt 跑完后就退出**，不再接受新命令（`cli-integration.md`：All prompts are supplied when the process starts）；
2. **失败的响应会出现在事件流里，但不自动导致非零退出**——只有"调用本身抛错"才非零。**要判断成败，读事件**（比如看 `message_end` 的 `stopReason`）；
3. **`agent_end` 不是终点**：重试/溢出恢复/压缩/排队可能继续；**`agent_settled` 才是**"不会再自动继续"的信号。

### 16.3.1 严格 JSONL：五条硬规则

`json.md` 的 "Framing and process I/O" 是必须背下来的规格：

```text
1. 每条记录是一个 JSON 对象，以 LF（\n）结尾；
2. 只在 LF 上拆记录，允许剥掉前面的可选 CR（兼容 CRLF）；
3. Unicode 行分隔符（U+2028）与段分隔符（U+2029）在 JSON 字符串里合法，不是记录边界；
4. 使用字节流/UTF-8 解码器并只在 LF 处切分；仓库 `json.md` 声称 Node.js readline 还识别 U+2028/U+2029，
   但 Node v23.9.0 官方 readline 文档只列出 `\n`、`\r`、`\r\n`，未证实这一额外行为；
5. stdout 持续读——不读会让管道缓冲填满，卡死 Pi；stdout 专用于 JSONL，诊断与日志走 stderr。
```

第 4、5 条是"听起来小题大做、踩过就懂"的坑：

- U+2028/U+2029 是 JSON 字符串中合法的字符，因此协议仍要求只按 LF 分帧；不要仅凭仓库注释断言 Node `readline` 会在这两个字符处拆行。
- "读得慢"不是小问题：操作系统管道缓冲区有限，客户端停止消费，Pi 的写就会阻塞（背压），表现为"Pi 卡住了"。

### 16.3.2 `message_update` 的线上格式：只有增量

这是 JSON/RPC 与 SDK 的**唯一序列化差异**（`json.md`）：

```text
Wire `message_update` records are delta-only. They omit the SDK event's cumulative `message`
field and every `assistantMessageEvent.partial` snapshot so stream size remains linear.
```

也就是说：

- SDK 事件里每条 `message_update` 都带"整条部分消息"（第 3.9 节）；
- **线上格式删掉了累积字段**，只留增量（`delta`）与元数据——否则流的大小会随消息长度**平方级**增长；
- 附带一个小扩展：`toolcall_start` 在线上**多了 `id` 与 `toolName`**（`JsonAssistantMessageEvent` 类型里能看到）：

```typescript
type JsonAgentSessionEvent =
  | Exclude<AgentSessionEvent, { type: "message_update" }>
  | {
      type: "message_update";
      usage: Usage;
      assistantMessageEvent: JsonAssistantMessageEvent<AssistantMessageEvent>;
    };
```

### 16.3.3 重建规则（客户端必读）

`json.md` 给了权威重建指南：

- **用 `contentIndex` 定位内容块**（同一条消息可能有多个块：文本、思考、工具调用）；
- `delta` 缓冲起来做**实时显示**；到了 `text_end` / `thinking_end` / `toolcall_end`，用它们的**权威内容**替换你的拼装结果；
- `message_end.message` 到达时，**整条部分消息被它替换**（它是最终事实）；
- `usage` 是"目前为止的最新累计值"；有些供应商流式期间不给用量，完成前一直是 0；
- `toolcall_delta` 里是**序列化参数的分片**（拼装后才能得到完整 `ToolCall`；`toolcall_end` 直接给完整对象）。

一句话：**流是给"快速显示"的，终态消息是给"正确性"的**——两者都要，别只信其一。

## 16.4 事件参考合订（JSON 与 RPC 共用）

`json.md` 是两种模式共用的规范；把需要的表集中到此（与第 4 章的 SDK 事件对照读）。

### 16.4.1 Agent / Turn / Message

| 事件 | 字段 | 含义 |
|---|---|---|
| `agent_start` | 无 | 低层 run 开始 |
| `agent_end` | `messages`、`willRetry` | 低层 run 结束（可能还有后续） |
| `agent_settled` | 无 | 不会再有自动继续（重试/恢复/队列都空了） |
| `turn_start` / `turn_end` | `message`、`toolResults` | 一个轮次开始/结束 |
| `message_start` / `message_end` | `message` | 消息开始/完成（`message_end` 是权威终态） |
| `message_update` | `usage`、`assistantMessageEvent` | 见 16.3.2/16.3.3 |

### 16.4.2 工具与队列/状态

| 事件 | 字段 | 含义 |
|---|---|---|
| `tool_execution_start` | `toolCallId`、`toolName`、`args` | 工具开始（用 `toolCallId` 关联整个生命周期） |
| `tool_execution_update` | 同上 + `partialResult` | 部分结果（替换还是追加取决于工具契约） |
| `tool_execution_end` | 同上 + `result`、`isError` | 工具结束 |
| `queue_update` | `steering`、`followUp` | 排队变化（字段是**完整当前队列**） |
| `entry_appended` | `entry` | 部分辅助写入路径主动发布条目；不是所有落盘记录的通知 |
| `session_info_changed` | `name`（缺省=被清除） | 会话名变化 |
| `thinking_level_changed` | `level` | 思考级别变化 |

### 16.4.3 压缩与重试

```json
{"type":"compaction_start","reason":"threshold"}
{"type":"compaction_end","reason":"threshold","result":{"summary":"...","firstKeptEntryId":"abc123","tokensBefore":150000,"estimatedTokensAfter":32000,"usage":{...},"details":{}},"aborted":false,"willRetry":false}
{"type":"auto_retry_start","attempt":1,"maxAttempts":3,"delayMs":2000,"errorMessage":"529 overloaded"}
{"type":"auto_retry_end","success":true,"attempt":2}
{"type":"summarization_retry_scheduled","attempt":1,"maxAttempts":3,"delayMs":2000,"errorMessage":"terminated"}
{"type":"summarization_retry_attempt_start","source":"compaction","reason":"threshold"}
{"type":"summarization_retry_finished"}
```

- `compaction_end`：`aborted: true` → 无 `result`；失败 → 无 `result` 且有 `errorMessage`；**溢出恢复成功后 `willRetry: true`**（第 10.5 节）；
- 重试事件直接对应第 6.6 节的状态机——客户端可以直接把它们渲染成"正在重试（第 N 次）"。

### 16.4.4 RPC 专属事件

| 事件 | 含义 |
|---|---|
| `bash_execution_update` | RPC `bash` 命令的每次输出块（`id` 对应命令 id；**流式全量**，而最终响应里的输出可能被截断） |
| `extension_error` | 扩展处理器抛错（含 `extensionPath`、`event`、`error`） |
| Extension UI 记录 | 独立子协议（16.5.5），**不是** `AgentSessionEvent` |

TypeScript 侧用导出的 `JsonAgentSessionEvent` 类型（`json.md` 给出定义）；实现位于 `modes/json-event.ts`。
## 16.5 RPC 模式：长驻双向协议

```bash
pi --mode rpc --no-session
```

适用（`rpc.md` 开篇）：语言无关集成、进程隔离、IDE、自定义 UI。它与 SDK 的对照表：

| 接口 | 进程边界 | 控制模型 | 最适合 |
|---|---|---|---|
| SDK | 同进程 | 直接 TypeScript 方法与事件 | 想要完整 API 的 Node/Bun 宿主 |
| RPC | 子进程 | JSONL 命令/响应/事件 | 其他语言、隔离进程、IDE、自定义客户端 |

启动选项与普通 CLI 相同（`--provider`、`--model`、`--session-dir` 等照常生效）；**唯一硬限制：拒绝 `@file` 参数**——提示词请走 `prompt` 命令。

### 16.5.1 四类记录

| 方向 | 记录 | 用途 |
|---|---|---|
| stdin | Command | 要求 pi 执行一次提示、查状态、改配置、管会话 |
| stdout | `response` | 某条命令是否成功、带什么数据 |
| stdout | Session event | 运行/消息/工具/队列/压缩/重试的动态流 |
| 双向 | Extension UI record | 扩展交互的独立子协议（16.5.5） |

### 16.5.2 `id` 关联：别用"响应顺序"配命令

```json
{"id":"req-1","type":"get_state"}
{"id":"req-1","type":"response","command":"get_state","success":true,"data":{"...":"..."}}
```

规则（`rpc.md`）：

- 命令可带**可选字符串 `id`**；对应响应**原样带回**；
- **命令处理是异步的**——只要可能有多个命令并行，就必须按 `id` 关联，不要假设响应按发送顺序返回；
- **会话事件一般没有命令 id**（它们描述会话活动）；唯一的例外是 `bash_execution_update`（对应 `bash` 命令的 id）；
- `extension_ui_response` 用它收到的请求 id，**不是**普通命令响应。

### 16.5.3 `prompt` 响应的语义：接受 ≠ 完成

```json
{"id":"req-2","type":"prompt","message":"Review this repository"}
{"id":"req-2","type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}
```

`data.disposition` 说明这条提示词的去向；关键分支：

- `"started"`：新的 run 已开始；
- `"queued"`：已入队（steering/follow-up）；
- `"handled"`：被扩展/命令消费——**不会启动 run，别等 `agent_settled`**。

完成信号仍是第 6 章的约定：`agent_end` 只是一个低层 run 结束；**要等 `agent_settled`**（重试、恢复、压缩、队列都清零）。

**订阅先于发送**：客户端的"完成等待"如果靠事件实现，必须在**发送 prompt 之前**装好监听器，否则快速完成会丢事件。`rpc.md` 专门点名 `RpcClient.promptAndWait()` 在内部就是这么做的；手写客户端若分两步调用，"先订阅、且只在 run 活动期间 `waitForIdle()`"。

### 16.5.4 错误：三种来源分开处理

| 来源 | 表现 | 处理 |
|---|---|---|
| 命令级失败 | 一条 `success: false` + `error` 的响应 | 按 id 关联后向用户报错 |
| JSON 解析失败 | **没有 request id** 的 `{"type":"response","command":"parse","success":false,...}` | 记录并跳过（说明写坏了协议） |
| 运行期失败（供应商错误/取消） | 出现在 message/event 流里 | 解析事件（如 `message_end.stopReason`、`auto_retry_*`） |

还要自理的（协议之外的工程问题）：**子进程启动失败、意外退出、stderr 诊断、取消、以及你自己的超时/截止时间**。一条铁律：**不要把 stderr 当协议解析**——它是给人看的日志。

### 16.5.5 扩展 UI 子协议（一句话版）

扩展的对话框/通知在 RPC 下走独立的请求-响应子协议（`rpc-extension-ui.md`）：对话框是"请求→等待响应"，其它通知是"可显示可忽略"。终端专属能力（自定义组件）在 RPC 下不可用或降级——这与第 13.6 节的模式能力矩阵一致。

### 16.5.6 关停：关 stdin

```text
Close the child's stdin to request an orderly shutdown. Pi disposes the active runtime before
exiting. Clients should still handle process signals and unexpected exits.
```

- **优雅关停 = 关 stdin**；pi 会先 dispose 运行时（第 8 章）再退出；
- 扩展也可以请求 shutdown；pi 会在"当前命令完成"或"活动 run 发出 `agent_settled`"后执行；
- 客户端仍要处理信号与意外退出（别假设每次都能优雅）。

### 16.5.7 命令面一览（以 `rpc-commands.md` 为准）

从锚点清单能看出 RPC 的控制面（读全表在 `rpc-commands.md`）：

```text
提示与运行：prompt、steer、follow_up、abort、clear_queue
会话：new_session、switch_session、fork、clone、get_fork_messages、get_entries、get_tree
状态：get_state、get_messages、get_session_stats、get_last_assistant_text、get_commands
模型：set_model、cycle_model、get_available_models
思考：set_thinking_level、cycle_thinking_level、get_available_thinking_levels
队列策略：set_steering_mode、set_follow_up_mode
压缩与重试：compact、set_auto_compaction、set_auto_retry、abort_retry
命令执行：bash、abort_bash
导出与命名：export_html、set_session_name
```

**该表就是你写 IDE 插件时的全部"遥控器"**——每一项都能在第 3、6、8、9、10 章找到对应实现。

## 16.6 `RpcClient`：TypeScript 世界的推荐入口

自己处理子进程、分帧、关联与关停很容易出坑。仓库为 Node/TS 提供了带类型的客户端（`rpc.md` 与 `examples/rpc-client.ts`）：

```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";

const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const prompt = process.argv.slice(2).join(" ") || "Explain this repository in one paragraph.";

const client = new RpcClient({
	cliPath: join(exampleDirectory, "../dist/cli.js"),   // 必须指向"可运行的 CLI"
	args: ["--no-session"],
});

const unsubscribe = client.onEvent((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	} else if (event.type === "tool_execution_start") {
		process.stderr.write(`\n[tool: ${event.toolName}]\n`);
	}
});

try {
	await client.start();
	await client.promptAndWait(prompt);       // 内部先装监听、再发 prompt、等到 settled
	process.stdout.write("\n");
} finally {
	unsubscribe();
	await client.stop();                      // 关子进程
}
```

三个使用要点：

1. **`cliPath` 指向构建产物**：示例指向 `dist/cli.js`，所以"从源码仓库直接跑这个示例"前要先构建（`examples/README.md` 也提醒了）；分发场景通常指向 npm 安装后的路径或 `pi` 可执行包装；
2. **`promptAndWait` 消灭竞态**：它先装监听器再发命令（16.5.3 的纪律被封装];
3. **退订 + `stop()` 成对**：与第 15 章的释放纪律一致。

使用边界：`promptAndWait()` 适用于会启动 Agent run 的普通 prompt。它先订阅 `agent_settled`，再调用 `prompt()`，避免快速完成时漏事件；但若扩展命令或 input hook 返回 `handled`，就不会有新的 `agent_settled`，该 helper 仍会等到 timeout。若输入可能被消费，请直接 `await client.prompt(...)` 并检查 `disposition`，只对 `started`（或确定会产生已有 run 收束的 `queued`）等待完成。preflight reject 时，当前 helper 也不会主动取消它已经建立的事件等待；精确实现边界见 [D12 客户端生命周期](deep-dives/D12-protocol-modes.md)。

## 16.7 协议硬知识：按行重组与背压

无论你用什么语言写客户端，"读 stdout"都必须按下面的伪代码做：

```text
buffer = ""
loop:
	chunk = read()                 # 任意长度：可能是半行、几行、甚至半个 UTF-8 字符
	buffer += decode(chunk)        # 用流式解码器（UTF-8 跨 chunk 的字节要缓住）
	while LF in buffer:
		line, buffer = split_at_first_LF(buffer)
		line = strip_trailing_CR(line)
		record = JSON.parse(line)  # 单条必须是完整 JSON
		handle(record)
# 进程退出时 buffer 必须为空（否则最后一条记录被截断）
```

对照四类常见错误：

| 错误做法 | 后果 |
|---|---|
| 每个 chunk 直接 `JSON.parse(chunk)` | 分片/多行都会失败 |
| 用 `readline` / `splitlines()` | U+2028/U+2029 被当行边界，偶尔炸 |
| 忽略残留在 buffer 的最后一段 | 最后一条记录（可能是 `agent_settled`）丢失 |
| 用文本模式转换换行（CRLF→LF） | 破坏协议字节；应二进制读、只剥行尾 CR |

**背压（backpressure）双向成立**：

- **读端**：不持续读 stdout → pi 的写阻塞（表现为"卡住"）——`json.md`/`rpc.md` 都点名；
- **写端**：发命令太多太快也要尊重 stdin 背压（等 `write` 的回调/`drain`）。

**stdout/stderr 严格分流**：stdout 只放协议；所有日志、警告、诊断看 stderr。你调试自己的客户端时，也把日志写 stderr——否则会污染自己的解析。

## 16.8 实验 L10：分片输入与子进程结束

**实验性质**：本地运行；可用 faux/--no-env 控制成本；不要求真实模型。
**验证状态**：设计中。目标（规划文档 L10）："分片 JSONL 与子进程结束 → 可解析的协议轨迹"。

### 步骤

1. **起一个 RPC 子进程**。源码运行：

   - Windows PowerShell：`.\pi-test.ps1 --mode rpc --no-session`
   - Linux/macOS/Git Bash：`./pi-test.sh --mode rpc --no-session`

   （你的宿主程序负责 spawn；命令行先手动验证启动输出是否只有一行行 JSON。）

2. **写最小宿主**（Node 或 Python 均可）：按 16.7 的伪代码实现"缓冲 + 只在 LF 切分"，**故意用 64 字节读取**让分片真实发生；

3. **发命令并等完成**：

```json
{"id":"p1","type":"prompt","message":"列出当前目录的前三个文件"}
```

   记录并核对轨迹：`response(id=p1, success=true)` → `message_update(text_delta...)` → …… → `agent_end` → `agent_settled`；

4. **模拟慢读者**：解析到第一个 `text_delta` 后 `sleep 2s` 再继续读，观察是否仍能跑完（小输出通常没事；理解"卡住"发生的条件即可）；
5. **异常退出**：中途 `kill` 子进程，确认宿主能捕获退出并报告（而不是永远等）；
6. **优雅关停**：关闭子进程 stdin，确认 pi 正常退出（退出码 0），且最后 `buffer` 为空；
7. **验证解析器**：把 16.7 的四类错误各犯一次（改用 `readline`、按 chunk 解析等），观察失败方式——亲手见过才会在真实项目里避开。

### 观察与思考

- 你的实现里，`agent_end` 之后是否仍可能收到记录？（重试/恢复场景）
- `prompt` 响应 `disposition: "handled"` 时，你为什么不该等 `agent_settled`？
- 如果把日志 `console.log` 混进 stdout 会发生什么？（对照第 2 章的 `takeOverStdout`）

### 清理

终止所有实验子进程；删除宿主脚本；`git status` 干净。

## 16.9 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 解析偶尔失败，日常没事 | 用了 readline / Unicode 分隔符 | 换字节流 + 只在 LF 切分（16.7） |
| 最后一条记录丢了 | 退出时没处理 buffer 残留 | flush 残留；或长度校验 |
| Pi "卡住"不输出 | 客户端停止读 stdout（背压） | 持续消费；或按需暂停的是"处理"而不是"读" |
| 命令响应配错 | 按顺序而不是按 `id` 关联 | 一律用唯一 id 相关 |
| 等不到完成信号 | 拿 `agent_end` 当完成 / `handled` 后仍等待 | 等 `agent_settled`；先看 `disposition` |
| 把日志当协议 | stdout 里混入非 JSON | 日志走 stderr；校验每条记录都是 JSON 对象 |
| 子进程死了客户端不知道 | 没监听 exit/error | 处理启动失败、意外退出与超时 |
| `RpcClient` 起不来 | `cliPath` 指向未构建的 `dist/cli.js` | 先构建或指向已安装的可执行入口（examples/README.md 的提示） |

## 16.10 验收题

1. 四种模式的选择标准各一句话；什么情况下"非 TTY 自动 print"会生效？
2. print 模式的退出码规则？"错误写 stderr"对脚本意味着什么？
3. JSON 流里 `message_update` 为什么不能带累积快照？客户端重建的正确顺序（delta/end/message_end）？
4. RPC 里 `id` 的作用域与例外？为什么"响应的顺序"不能用来配对？
5. `prompt` 的 `disposition` 三种值各代表什么？何时不该等 `agent_settled`？
6. 写出"按行重组"的核心循环，并列出必须避免的四类错误。
7. 优雅关停的动作是什么？客户端还应当防御哪些"不优雅"情况？

### 参考答案（要点）

1. 人类交互→interactive；只取最终文本→print；要结构化进度→JSON；要双向控制→RPC；无显式模式且 stdin/stdout 有任一非 TTY → print。
2. 终止响应为 error/aborted 或调用抛错 → 非零；stderr 与 stdout 分离，脚本可安全把 stdout 当作"答案"。
3. 累积快照会令流体积随消息长度超线性增长；delta 缓冲显示 → text_end/thinking_end/toolcall_end 用权威内容替换 → message_end 整体替换。
4. 字符串 id 用于命令-响应关联（会话事件一般没有，`bash_execution_update` 例外；`extension_ui_response` 用自己的请求 id）；处理是异步的，顺序无保证。
5. `started`（已开始）/`queued`（已入队）/`handled`（被消费，无 run）；`handled` 不应等 settled。
6. 循环：读 chunk → 流式解码并入缓冲 → 找 LF → 切行、剥 CR、解析 → 处理；错误：按 chunk 解析、readline、丢弃残留、文本模式换行转换。
7. 关 stdin；防御启动失败、意外退出、stderr 诊断、取消、超时。

## 16.11 来源与下一章

- `packages/coding-agent/docs/cli-integration.md`（模式选择、print/JSON/RPC 行为、fork 品牌化）；
- `packages/coding-agent/docs/json.md`（严格 JSONL、事件参考、重建规则、`JsonAgentSessionEvent`）；
- `packages/coding-agent/docs/rpc.md`（记录族、id 关联、生命周期、错误、关停、Python 最小客户端）；
- `packages/coding-agent/docs/rpc-commands.md`、`docs/rpc-extension-ui.md`；
- `packages/coding-agent/examples/rpc-client.ts`、`examples/rpc-extension-ui.ts`；
- 源码：`packages/coding-agent/src/modes/json-event.ts`、`src/modes/rpc/rpc-types.ts`、`src/modes/rpc/rpc-client.ts`。

下一章是终端 UI 的世界：差分渲染、组件模型、文本宽度、键位配置——以及"为什么字符数不等于显示宽度"。
