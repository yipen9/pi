# 12. SDK 与进程级协议（print / json / rpc）

> 预计时间：3 小时（不含选读）
> 先修：消息与事件（`AgentSessionEvent` 的种类与顺序）；`AgentSession` 的基本生命周期（创建、`prompt`、`dispose`）。本文用到的最小定义会在用处再说一次。

## 本篇你会学到

- 根据调用方的需要，在 print、json、rpc、SDK 四种入口中选出一种。
- 用离线的 faux 假模型（脚本化的模型，按预设返回回答，不联网、不花钱），在 Node.js 进程里创建会话、订阅事件，并在结束时释放资源。
- 解析 JSONL（每行一个 JSON 对象的文本流），并说明为什么不能对每个网络数据块直接调用 `JSON.parse`。

## 先用一个例子理解

假设三个调用方都想让 pi 评审同一份 `git diff`。

- CI 脚本只需要最后的文字，然后把它写进 PR 评论。它不关心中间过程，所以用 print 模式：`pi -p "..."`。
- 编辑器插件要显示"正在读取哪个文件"，还要允许用户中途取消。它需要持续接收事件，并能发送"取消"命令。所以它用 rpc 模式：让 pi 作为长驻子进程运行，通过 stdin 发命令，通过 stdout 收响应和事件。
- 一个 Node.js 宿主程序想直接拿到会话对象、订阅事件、在结束时释放资源。它用 SDK：在同一个进程里调用 `createAgentSession()`，不需要子进程，也不需要编解码。

如果没有这些入口，调用方只能去解析终端界面上的文字。界面排版一改，解析就会出错；而且这种方式无法发出取消命令。pi 把同一套 agent、会话和工具包装成四种入口，每种只暴露调用方需要的部分。

## 先选入口：决策表

| 你的需求 | 选择 | 进程边界 | 输出形式 | 能否中途控制 |
| --- | --- | --- | --- | --- |
| 宿主是 Node.js 或 TypeScript 程序，可以共进程 | SDK（`createAgentSession`） | 同一进程 | 直接调用方法，订阅回调 | 能 |
| 脚本只要最终回答 | print（`-p`，或 stdin/stdout 非终端时自动进入） | 子进程 | stdout 纯文本 | 不能 |
| 要看过程事件，但只跑一次 | json（`--mode json`） | 子进程 | stdout 为 JSONL 事件流 | 不能 |
| 长驻进程，多次发命令，可取消 | rpc（`--mode rpc`） | 子进程 | stdin 收命令，stdout 收响应和事件（JSONL） | 能 |

判断顺序：

1. 宿主是不是 Node.js 或 TypeScript 程序，并且能和 pi 共用一个进程？是，用 SDK。
2. 否则，是否需要多次发命令，或随时取消？是，用 rpc。
3. 否则，是否需要过程事件？是，用 json；否，用 print。

还有第五种：交互模式（interactive），即人在终端里直接使用的界面。它不是给程序调用的入口。`packages/coding-agent/src/main.ts` 的 `resolveAppMode` 决定实际进入哪种模式，细节见下文"print 模式"一节。

四种入口共用同一套 agent、会话、资源和工具。区别只在于输入怎么进来、输出怎么出去、进程什么时候结束。

下表把四种入口放在一起比较。"谁拥有会话"指由谁创建会话、并在结束时释放它。

| 项目 | print | json | rpc | SDK |
| --- | --- | --- | --- | --- |
| 进程边界 | 子进程，运行一次后退出 | 子进程，运行一次后退出 | 子进程，长驻，直到 stdin 关闭 | 宿主进程内，没有子进程 |
| stdin | 没有协议输入。提示词来自命令行参数，`@文件` 也会读入 | 同 print | JSONL 命令，每行一条 | 不适用，直接调用方法 |
| stdout | 最后一条助手消息的文字，每个 `text` 块一行 | JSONL：会话头（如果有）加每个事件一行 | JSONL：响应、事件、扩展请求 | 不使用 stdout 协议，输出由宿主自己决定 |
| 错误怎么报告 | 模型错误或异常写到 stderr | 模型错误在事件里（`stopReason` 为 `error`）；异常写到 stderr | 命令失败返回 `success: false` 的响应，带 `error` 字符串 | 异常由 `prompt()` 或 `createAgentSession()` 抛出 |
| 退出码 | 模型错误或异常为 1，正常为 0 | 模型错误仍为 0（实验 E 验证）；异常为 1（读代码，未运行） | stdin 结束时为 0（实验 F 验证）；收到信号时的退出码本次未验证 | 由宿主决定 |
| 谁拥有会话 | `runPrintMode` 的 `finally` 调用运行时的 `dispose()` | 同 print | `shutdown()` 调用运行时的 `dispose()` | 宿主自己调用 `session.dispose()` |
| 中途取消 | 不能 | 不能 | 能，发送 `abort` 命令 | 能，调用 `session.abort()` |

读表要点：

- print 和 json 都是一次性的。stdin 只在启动时读一次，之后不再接收命令。
- rpc 的区别在于 stdin 保持打开，可以多次发命令，也可以中途取消。
- SDK 没有进程边界，所以它的错误是异常（`try` / `catch` 能捕获），而不是 stdout 上的文字。

## 核心概念

### 1. JSONL：每行一个 JSON 对象

**JSONL**（JSON Lines）是一种文本格式：每条记录是一个完整的 JSON 对象，后面紧跟一个换行符 `\n`。json 模式的 stdout，以及 rpc 模式的 stdin 和 stdout，都使用它。

为什么需要它：流式输出没有"文件结束"的标记，读取端需要知道每条记录在哪里结束。换行符是最简单的分隔符。

```text
{"type":"agent_start"}
{"type":"turn_start"}
{"type":"agent_end","messages":[...],"willRetry":false}
```

规则只有两条：

- 只在 `\n`（LF）处切分记录。字符串内部的 U+2028、U+2029 是合法字符，不是记录边界（实验 C 验证了这一点）。
- 如果一行末尾有 `\r`（CRLF 换行），读取时去掉它。`packages/coding-agent/src/modes/rpc/jsonl.ts` 的 `attachJsonlLineReader` 就是这样做的。

读取细节和它的内部结构放在文末的选读中。主线上只需要记住：按行读、每行单独 `JSON.parse`。

### 2. print 模式：只输出最终文本

**print 模式**是一次性运行：发送提示词，等待运行结束，输出最后一条助手消息的文字，然后退出。

| 项目 | 内容 |
| --- | --- |
| 入口 | `packages/coding-agent/src/modes/print-mode.ts` 的 `runPrintMode`，mode 为 `"text"` |
| 输入 | 提示词作为位置参数，或紧跟在 `-p` / `--print` 之后；`@文件名` 作为文件参数读入（`packages/coding-agent/src/cli/args.ts`） |
| 输出 | stdout 只写最后一条助手消息中每个 `text` 内容块，每块一行。工具调用、中间消息和事件都不写出 |
| 结束条件 | 运行结束后，`runPrintMode` 的 `finally` 释放运行时并刷新 stdout |
| 退出码 | 见下表 |

stdout 只放结果，错误信息写到 stderr。因此 `ANSWER=$(pi -p "...")` 这类命令替换拿到的只有最终文字，错误信息不会混进变量。这是 print 模式便于脚本使用的原因。

退出码规则（`runPrintMode` 中的实际逻辑）：

| 情况 | stderr | 退出码 |
| --- | --- | --- |
| 最后一条助手消息的 `stopReason` 为 `error` 或 `aborted` | 输出 `errorMessage`，没有则输出 `Request <stopReason>` | 1 |
| 运行时抛出异常 | 输出异常信息 | 1 |
| 正常结束 | 无 | 0 |

真实输出（实验 E，faux 假模型）。正常结束时，stdout 只有最后一条助手消息的文字，末尾多一个换行：

```text
这是假模型的回答。
```

模型返回错误时（助手消息的 `stopReason` 为 `error`），stdout 为空，`errorMessage` 写到 stderr，退出码为 1：

```text
stdout: 0 字节
stderr: 模拟的模型错误
exit=1
```

stderr 中还可能有 Node.js 的 `ExperimentalWarning`（类型剥离仍是实验性功能的提示）。它与 pi 无关，上面已省略。

这说明 print 模式的设计：stdout 只放结果，状态通过退出码和 stderr 传递。脚本如果只读 stdout，就必须同时检查退出码。

什么时候进入 print 模式，由 `packages/coding-agent/src/main.ts` 的 `resolveAppMode` 决定。它按顺序判断：

1. `parsed.mode === "rpc"`，返回 `rpc`。
2. `parsed.mode === "json"`，返回 `json`。
3. `-p` / `--print` 存在，或 stdin 不是终端，或 stdout 不是终端，返回 `print`。
4. 其余情况返回 `interactive`。

所以 `git diff | pi ...` 这类管道用法不需要写 `--print`：管道让 stdin 不再是终端，pi 自动进入 print 模式。注意，这里只验证了模式选择的规则；管道里的数据如何变成提示词，本次没有验证。

最小例子（需要本机已配置模型，本篇没有运行）：

```text
pi -p "用一句话说明这个仓库是做什么的"
```

可能出错的地方：

- 脚本只看 stdout，忽略退出码。模型失败时 stdout 可能为空，脚本会把空结果当成成功。CI 脚本应检查退出码。
- 最后一条助手消息没有 `text` 内容块，stdout 为空。这是代码路径如此，本次没有实际触发。
- 以为能看到进度。print 模式不输出中间事件；需要进度时改用 json。

### 3. json 模式：一次运行的事件流

**json 模式**（`--mode json`）也是一次性运行，但 stdout 输出的是事件流，而不是最终文字。每个事件占一行 JSONL。

| 项目 | 内容 |
| --- | --- |
| 入口 | `runPrintMode`，mode 为 `"json"` |
| 输入 | 与 print 相同：提示词是位置参数 |
| 输出 | 第一行（如果会话有头信息）是会话头；之后每个会话事件一行 |
| 结束条件 | 与 print 相同：运行结束后进程退出，不接受新命令 |
| 退出码 | 只有运行时抛出异常时为 1；模型错误不改变退出码 |

会话头来自 `session.sessionManager.getHeader()`，只有它返回非空值时才写出。

每个会话事件先经过 `packages/coding-agent/src/modes/json-event.ts` 的 `toJsonEvent`，再用 `JSON.stringify` 加换行写出。事件种类与 SDK 相同。实验 A 的真实输出中出现过这些类型：`agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`turn_end`、`agent_end`、`agent_settled`。

`message_update` 是唯一被改写的事件。改写后的形状是：

```json
{"type":"message_update","usage":{...},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"Hello"}}
```

被删掉的是两个累积字段：顶层的 `message`（整条消息的当前状态），以及 `assistantMessageEvent.partial`（累积快照）。只保留增量 `delta`。

为什么要删？如果每条事件都带完整快照，消息越长，每条事件就越大，整个流的总字节数增长得越快。增量加上 `message_start` 和 `message_end`，已经足够让消费方重建内容。

**事件顺序（实验 E 的真实输出，成功的一次运行共 15 行）**

下表按输出行号列出每一行的 `type`。长字段用 `…` 省略，原始输出中它们都存在。

| 行 | type | 含义 | 样例 |
| --- | --- | --- | --- |
| 1 | `session` | 会话头。只有 `getHeader()` 返回非空值时才写出 | `{"type":"session","version":3,"id":"01a125f8-…","timestamp":"…","cwd":"D:\\Github\\pi"}` |
| 2 | `agent_start` | 一次低层运行开始 | `{"type":"agent_start"}` |
| 3 | `turn_start` | 一轮开始。一轮是一次模型调用 | `{"type":"turn_start"}` |
| 4 | `message_start` | 系统提示词也作为一条消息发出，`role` 为 `system` | `{"type":"message_start","message":{"role":"system","content":"","sections":{…},…}}` |
| 5 | `message_end` | 系统消息结束。内容很长，本文省略 | `{"type":"message_end","message":{"role":"system",…}}` |
| 6–7 | `message_start`、`message_end` | 用户消息 | `{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"你好"}],"timestamp":…}}` |
| 8 | `message_start` | 助手消息开始。此时 `stopReason` 为 `pending` | `{"type":"message_start","message":{"role":"assistant","content":[],"stopReason":"pending",…}}` |
| 9–11 | `message_update` | 三个增量：`text_start`、`text_delta`、`text_end` | `{"type":"message_update","usage":{…},"assistantMessageEvent":{"type":"text_delta","contentIndex":0,"delta":"这是假模型的回答。"}}` |
| 12 | `message_end` | 助手消息的最终版本，`stopReason` 为 `stop` | `{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"这是假模型的回答。"}],"stopReason":"stop",…}}` |
| 13 | `turn_end` | 一轮结束。`toolResults` 为空数组，因为没有调用工具 | `{"type":"turn_end","message":{…},"toolResults":[]}` |
| 14 | `agent_end` | 低层运行结束。`messages` 是本次运行的全部消息 | `{"type":"agent_end","messages":[…],"willRetry":false}` |
| 15 | `agent_settled` | 没有更多自动工作。完成信号 | `{"type":"agent_settled"}` |

注意两点：

- 系统提示词作为 `message_start` 和 `message_end` 出现。消费方如果只想要用户和助手消息，要按 `role` 过滤。
- `message_update` 的 `usage` 是累积值。`message_start` 中的 `usage` 与 `message_end` 中的 `usage` 也都存在。消费方不要把各条 `usage` 相加。

模型错误时（实验 E 的 `json error`），第 12 行的 `message_end` 与第 14 行 `agent_end` 的最后一条消息都带 `"stopReason":"error"` 和 `"errorMessage":"模拟的模型错误"`。进程退出码仍为 0。

最小例子（需要模型，本篇没有运行）：

```text
pi --mode json "用一句话说明这个仓库是做什么的" > events.jsonl
```

读取事件文件的示意代码（未运行）：

```typescript
import { readFileSync } from "node:fs";

let text = "";
for (const line of readFileSync("events.jsonl", "utf8").split("\n")) {
	if (!line) continue;
	const event = JSON.parse(line);
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		text += event.assistantMessageEvent.delta;
	}
}
console.log(text);
```

可能出错的地方：

- 把整个 stdout 当成一个 JSON 解析。它有多行，直接 `JSON.parse` 会失败。必须按行解析。
- 用退出码判断模型是否成功。json 模式下，模型错误只出现在事件里，例如 `message_end` 的 `stopReason` 为 `error`。退出码仍然是 0。要判断成败，读事件。
- 用 `agent_end` 当作结束。`agent_end` 之后仍可能有重试或排队的工作。完成信号是 `agent_settled`。

### 4. rpc 模式：长驻的双向 JSONL

**rpc 模式**是长驻进程。它从 stdin 读取命令，向 stdout 写出响应和事件，直到 stdin 关闭。调用方可以在运行过程中继续发命令，比如 `abort`。

| 项目 | 内容 |
| --- | --- |
| 入口 | `pi --mode rpc`，或 `packages/coding-agent/src/rpc-entry.ts`（它设置进程标题和环境变量，然后以 `--mode rpc` 调用 `main`） |
| 输入（stdin） | 每行一条命令：`{"id":"...","type":"...", ...}` |
| 输出（stdout） | 响应、事件、扩展请求，每行一条 JSON |
| 结束条件 | stdin 关闭（`end` 事件），或收到 SIGTERM / SIGHUP |
| 类型定义 | `packages/coding-agent/src/modes/rpc/rpc-types.ts` 的 `RpcCommand`、`RpcResponse`、`RpcSessionState` |

命令分组（都来自 `RpcCommand` 联合类型）：

| 组别 | 命令 `type` |
| --- | --- |
| 发送输入 | `prompt`、`steer`、`follow_up`、`abort`、`clear_queue` |
| 读取状态 | `get_state`、`get_messages`、`get_session_stats`、`get_last_assistant_text`、`get_commands` |
| 模型与思考级别 | `set_model`、`cycle_model`、`get_available_models`、`set_thinking_level`、`cycle_thinking_level`、`get_available_thinking_levels` |
| 队列模式 | `set_steering_mode`、`set_follow_up_mode` |
| 压缩与重试 | `compact`、`set_auto_compaction`、`set_auto_retry`、`abort_retry` |
| 工具输出 | `bash`、`abort_bash` |
| 会话 | `new_session`、`switch_session`、`fork`、`clone`、`get_fork_messages`、`get_entries`、`get_tree`、`export_html`、`set_session_name` |

响应的形状：

```json
{"id":"g1","type":"response","command":"get_state","success":true,"data":{...}}
{"id":"p1","type":"response","command":"prompt","success":false,"error":"错误信息"}
```

成功响应带 `data`，失败响应带 `error` 字符串。两者都带同一个 `id`。

关键规则：

1. **响应可能乱序。** `runRpcMode` 对每一行都调用 `void handleInputLine(line)`，不等待前一条命令处理完。两条命令并发处理时，后发的可能先返回。客户端必须按 `id` 配对，不能按到达顺序配对。
2. **`prompt` 的响应只表示"已接受"。** 它的 `data.disposition` 有三个值：
   - `started`：开始了一次新的运行。
   - `queued`：排到了当前运行之后。
   - `handled`：被扩展或命令消费，没有启动运行。

   响应在 preflight（运行前的检查）通过后才发出。preflight 失败时，发出的是 `success: false` 的错误响应。
3. **完成信号是 `agent_settled`。** `agent_end` 只表示一次低层运行结束，重试时可能再次出现（`agent_end` 带 `willRetry` 字段）。`agent_settled` 表示没有更多自动工作。`handled` 的 prompt 不会产生新的 `agent_settled`。
4. **stdin 关闭会让进程关停。** `runRpcMode` 监听 `process.stdin` 的 `end` 事件，调用 `shutdown()`。

**完整的交互（实验 F 的真实输出）**

下面的交互由实验 F 产生。客户端依次发送 `get_state`、`prompt`、`abort`，最后发送一条会失败的 `set_model`。`->` 表示客户端写入 stdin 的一行，`<-` 表示 stdout 上的一行。`(省略)` 表示这一行很长，内容与上文 json 模式的同类事件相同，本文不再重复。

```text
-> {"id":"g1","type":"get_state"}
<- {"id":"g1","type":"response","command":"get_state","success":true,"data":{"model":{"id":"faux-1","name":"Faux Model","api":"faux:1791638422079:mi5p7i13kc","provider":"faux","baseUrl":"http://localhost:0","reasoning":false,"input":["text","image"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":128000,"maxTokens":16384},"thinkingLevel":"off","isStreaming":false,"isCompacting":false,"steeringMode":"one-at-a-time","followUpMode":"one-at-a-time","sessionId":"01a125f8-c240-7174-9fa0-61335f0a7379","autoCompactionEnabled":true,"messageCount":0,"pendingMessageCount":0}}
-> {"id":"p1","type":"prompt","message":"慢速回答"}
<- {"id":"p1","type":"response","command":"prompt","success":true,"data":{"disposition":"started"}}
-> {"id":"a1","type":"abort"}
<- {"type":"agent_start"}
<- {"type":"turn_start"}
<- {"type":"message_start","message":{"role":"system",…}}            (省略)
<- {"type":"message_end","message":{"role":"system",…}}              (省略)
<- {"type":"message_start","message":{"role":"user","content":[{"type":"text","text":"慢速回答"}],…}}  (省略)
<- {"type":"message_end","message":{"role":"user",…}}                (省略)
<- {"type":"message_start","message":{"role":"assistant","content":[],"stopReason":"aborted","errorMessage":"Request was aborted",…}}
<- {"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"aborted","errorMessage":"Request was aborted",…}}
<- {"type":"turn_end","message":{…},"toolResults":[]}                (省略)
<- {"type":"agent_end","messages":[…],"willRetry":false}             (省略)
<- {"type":"agent_settled"}
<- {"id":"a1","type":"response","command":"abort","success":true}
-> {"id":"g2","type":"get_state"}
<- {"id":"g2","type":"response","command":"get_state","success":true,"data":{…,"isStreaming":false,…,"messageCount":3,"pendingMessageCount":0}}
-> {"id":"e1","type":"set_model","provider":"no-such-provider","modelId":"none"}
<- {"id":"e1","type":"response","command":"set_model","success":false,"error":"Model not found: no-such-provider/none"}
```

实验 F 的 stdin 在最后一条命令后关闭，进程输出 `exit=0` 并退出。

从这段输出可以看出：

- `prompt` 的响应在运行开始前返回，`disposition` 为 `started`。运行本身在之后才进行。
- `abort` 的响应出现在 `agent_settled` 之后。本次运行中，假模型在 3 秒后才返回，`abort` 在那之后才让这一轮以 `aborted` 结束。这是假模型的行为。真实的 provider 响应时间不同，未在真实 provider 上验证。
- `messageCount` 为 3，与 `agent_end` 的 `messages` 数组一致：系统提示词、用户消息、被中止的助手消息。这是本次输出的事实，不是 pi 的文档约定。
- `set_model` 失败时，`success` 为 `false`，`error` 是一个字符串。客户端按 `success` 分支处理即可，进程不会退出。

下面是一个示意，说明为什么要按 `id` 配对。客户端先后发出两条命令：

```text
→ {"id":"a","type":"get_state"}
→ {"id":"b","type":"get_messages"}
← {"id":"b","type":"response","command":"get_messages","success":true,"data":{...}}
← {"id":"a","type":"response","command":"get_state","success":true,"data":{...}}
```

`get_messages` 的响应可能先到。如果客户端按到达顺序，把第一条响应当作 `a` 的答复，两个答复就会对调。按 `id` 查找等待方可以避免这个错误。（上面的箭头表示方向，不是 pi 的输出格式。）

最小例子（真实运行过，见实验 B）：

```text
{"id":"g1","type":"get_state"}
```

把这一行写进 stdin，然后关闭 stdin。pi 输出一行 `get_state` 的响应，然后以退出码 0 结束。

可能出错的地方：

- `echo '{"id":"g1","type":"get_state"}' | pi --mode rpc` 写完一行后 stdin 立即关闭，触发关停。`get_state` 这种快速命令的响应能输出（实验 B）。但 `prompt` 这类长运行命令不会等到 `agent_settled` 才退出。需要多次发命令、等待结果时，宿主程序必须保持 stdin 打开，分次写入。
- 假设第一行一定是响应。实验 B 的 stdout 先出现了一行 `extension_ui_request`，它由本机的扩展配置产生。客户端必须逐行判断 `type`。
- 按到达顺序配对响应（见规则 1）。
- 把 `agent_end` 当作完成（见规则 3）。
- 不设超时。如果子进程卡住，等待方会一直等。客户端应为每个请求设置时限。`RpcClient` 的默认值是 30 秒（见选读）。

RPC 的客户端封装 `RpcClient`（`packages/coding-agent/src/modes/rpc/rpc-client.ts`）已经实现了按 `id` 配对、超时和关停。它依赖构建产物 `dist/cli.js`。本篇没有构建，也没有运行它；它的内部在选读中说明。

### 5. SDK：在同一进程里持有会话

**SDK** 是 `@earendil-works/pi-coding-agent` 的 TypeScript 接口。宿主程序与 pi 在同一个 Node.js 进程里运行，直接拿到 `AgentSession` 对象，调用它的方法，订阅它的事件。它没有子进程，也没有 JSONL 编解码。

代价是：宿主与 pi 共享内存和权限。如果需要隔离，应选 print、json 或 rpc。

| 项目 | 内容 |
| --- | --- |
| 入口 | `packages/coding-agent/src/core/sdk.ts` 的 `createAgentSession(options)`，从包的入口导出 |
| 返回值 | `{ session, extensionsResult, modelFallbackMessage? }`（类型 `CreateAgentSessionResult`） |
| 主要对象 | `AgentSession`，定义在 `packages/coding-agent/src/core/agent-session.ts` |

`CreateAgentSessionResult` 的三个字段：

- `session`：创建好的 `AgentSession`。
- `extensionsResult`：扩展加载的结果，交互模式用它来设置界面。SDK 宿主通常不需要它。
- `modelFallbackMessage`：恢复的会话所用模型不可用时给出的提示。宿主应该展示它，而不是静默换模型。

`AgentSession` 上的四个常用操作：

- `session.subscribe(listener)`：订阅事件，返回一个取消订阅的函数（实验 A 调用了它）。
- `session.prompt(text)`：提交一次输入。它在整个运行结束后才 resolve。实验 A 的事件顺序支持这一点：`agent_settled` 在 `finally` 记录 `disposed` 之前就已出现，而 `finally` 只在 `prompt` 结束之后才执行。
- `session.bindExtensions(bindings)`：把宿主模式和命令动作接到会话上。签名要求一个参数。宿主不需要特殊绑定时传 `{}`，`examples/sdk/14-codemode-mcp.ts` 就是这样写的。
- `session.dispose()`：中止进行中的工作，让扩展上下文失效，断开 agent，清空事件监听器，取消缓存预热器。它的目的是释放进程内资源。`dispose()` 的函数体中没有删除会话文件的调用；它调用的 `cleanupSessionResources` 本次没有读，所以只说到这里。

**生命周期：创建、订阅、运行、取消订阅、释放**

宿主的正确顺序是：创建会话，订阅事件，调用 `prompt`，取消订阅，释放会话。订阅必须发生在 `prompt` 之前，否则会漏掉事件。

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession(); // 1. 创建
const unsubscribe = session.subscribe((event) => { // 2. 订阅（返回取消函数）
	console.log(event.type);
});
try {
	await session.prompt("你好"); // 3. 运行，返回时整个运行已结束
} finally {
	unsubscribe(); // 4. 取消订阅
	session.dispose(); // 5. 释放进程内资源
}
```

`createAgentSession()` 的签名在 `packages/coding-agent/src/core/sdk.ts` 中：`export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult>`。参数有默认值，所以可以不带参数调用。上面的代码需要本机配置真实模型，本文没有运行它；实验 G 用的是测试工具 `createHarness`，两者的事件顺序相同，但 harness 不是公开 API。

实验 G 的真实输出对比了两种订阅时机：

```text
subscribe-before-prompt: agent_start -> turn_start -> message_start -> message_end -> message_start -> message_end -> message_start -> message_update -> message_update -> message_update -> message_end -> turn_end -> agent_end -> agent_settled -> disposed
subscribe-after-prompt: disposed
```

第二行的问题是：`prompt` 返回时运行已经结束，所有事件都已经发出，之后才订阅的监听器一个事件也收不到。第二行末尾的 `disposed` 不是事件，而是脚本自己在 `finally` 中写入的标记。解决办法是先订阅。

会话存在哪里，由 `SessionManager` 决定（同一个包导出）：

- `SessionManager.inMemory()`：不写磁盘的临时会话。
- `SessionManager.create(cwd)`：新建一个持久会话。
- `SessionManager.list(cwd)`：列出会话。它是异步函数，返回 `Promise<SessionInfo[]>`，必须 `await`。

最小例子（实验 A，使用测试工具 `createHarness`）。`createHarness` 位于 `packages/coding-agent/test/suite/harness.ts`。它注册 faux 假模型、创建临时目录和会话，并提供 `setResponses` 与 `cleanup`。它是异步函数，必须 `await`。它是测试工具，不是公开 API。

真实宿主应按 `packages/coding-agent/examples/sdk/01-minimal.ts` 的写法调用 `createAgentSession()`。下面是那个示例的形状，需要本机配置真实模型，本篇没有运行：

```typescript
import { createAgentSession } from "@earendil-works/pi-coding-agent";

const { session } = await createAgentSession();
const unsubscribe = session.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});

try {
	await session.prompt("What files are in the current directory?");
} finally {
	unsubscribe();
	session.dispose();
}
```

可能出错的地方：

- 调用 `session.bindExtensions()` 不带参数：TypeScript 会报错。传 `{}`。
- `SessionManager.list(cwd)` 不加 `await`：得到的是 Promise，不是数组。
- 忘记 `dispose()`：进程内的监听器和正在进行的工作不会被释放。这种情况的具体后果本次没有测量。
- 直接给 `session.agent.state.messages` 赋值来恢复历史。`packages/coding-agent/docs/sdk.md` 说明 `SessionManager` 是已定稿上下文的权威来源，赋值不会替换持久化的上下文。正确做法是用包含这些条目的 `SessionManager` 创建会话。本次没有运行恢复实验，这一条依据文档说明。

## 源码导览

按阅读顺序排列。路径都相对于仓库根目录。

| 顺序 | 文件路径 | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/coding-agent/src/rpc-entry.ts` | 顶层脚本 | 设置进程标题和环境变量，以 `--mode rpc` 调用 `main` |
| 2 | `packages/coding-agent/src/main.ts` | `resolveAppMode` | 模式选择顺序：rpc、json、print、interactive |
| 3 | `packages/coding-agent/src/modes/print-mode.ts` | `runPrintMode` | text 只输出最后一条助手文本；json 模式订阅事件并写 JSONL；错误退出码为 1 |
| 4 | `packages/coding-agent/src/modes/json-event.ts` | `toJsonEvent`、`JsonAgentSessionEvent` | 删除 `message` 与 `partial`；保留 `usage`；`toolcall_start` 增加 `id` 与 `toolName` |
| 5 | `packages/coding-agent/src/modes/rpc/jsonl.ts` | `serializeJsonLine`、`attachJsonlLineReader` | 只在 LF 切分；去掉行尾 `\r`；流结束时处理残留行 |
| 6 | `packages/coding-agent/src/modes/rpc/rpc-types.ts` | `RpcCommand`、`RpcResponse`、`RpcSessionState` | 命令与响应的联合类型；`prompt` 响应里的 `disposition` |
| 7 | `packages/coding-agent/src/modes/rpc/rpc-mode.ts` | `runRpcMode`、`handleInputLine`、`handleCommand` | stdin 结束即关停；每行 `void` 调用处理函数，因此命令并发 |
| 8 | `packages/coding-agent/src/modes/rpc/rpc-client.ts` | `RpcClient`、`send`、`promptAndWait`、`stop` | 按 `id` 配对；30 秒超时；两段式关停 |
| 9 | `packages/coding-agent/src/core/sdk.ts` | `createAgentSession`、`CreateAgentSessionResult` | 返回值的三个字段 |
| 10 | `packages/coding-agent/src/core/agent-session.ts` | `prompt`、`bindExtensions`、`dispose` | 何时 resolve；`bindExtensions` 的参数；释放了什么 |
| 11 | `packages/coding-agent/examples/sdk/01-minimal.ts` | 顶层脚本 | 订阅、`prompt`、`finally` 中释放的基本形状 |
| 12 | `packages/coding-agent/test/suite/harness.ts` | `createHarness`、`cleanup` | 异步创建；注册 faux；`cleanup()` 会调用 `session.dispose()` |
| 13 | `packages/coding-agent/src/core/output-guard.ts` | `takeOverStdout`、`writeRawStdout`、`waitForRawStdoutBackpressure` | 协议模式独占 stdout；所有协议行都经过 `writeRawStdout` 写出 |

## 走读一次完整过程

以 `rpc-entry.ts` 处理一条 `get_state` 命令为例。`get_state` 只读取状态，不调用模型。

1. **启动入口。** `packages/coding-agent/src/rpc-entry.ts` 设置 `process.title` 与环境变量，然后调用 `main(["--mode", "rpc", ...])`。此时还没有会话。
2. **选择模式。** `main` 解析参数。`resolveAppMode` 看到 `mode === "rpc"`，返回 `"rpc"`。
3. **进入 rpc 循环。** `runRpcMode`（`rpc-mode.ts`）首先调用 `takeOverStdout()`，把 stdout 留给协议输出（实现在 `core/output-guard.ts`，本次没有读）。然后它注册 `process.stdin` 的 `end` 事件，处理函数是 `onInputEnd`，它调用 `shutdown()`。最后用 `attachJsonlLineReader(process.stdin, ...)` 按行切分输入。
4. **接收一行。** 读取器每遇到一个 `\n`，就把这一行交给 `void handleInputLine(line)`。`handleInputLine` 先调用 `JSON.parse`，再把得到的命令交给 `handleCommand`。
5. **分派命令。** `handleCommand` 用 `switch (command.type)` 分支。`get_state` 进入对应分支。
6. **构造状态。** 该分支构造一个 `RpcSessionState`，字段包括 `model`、`thinkingLevel`、`isStreaming`、`sessionId`、`messageCount` 等。这一步只读取会话，不改变它。
7. **写回响应。** `success(id, "get_state", state)` 构造 `{ id, type: "response", command, success: true, data }`，交给 `output`。`output` 调用 `serializeJsonLine`（JSON 字符串加 `\n`），再由 `writeRawStdout` 写入 stdout。
8. **客户端读取。** 在 `RpcClient` 一侧，`attachJsonlLineReader` 切出这一行，`handleLine` 解析它。因为 `type === "response"`，且 `id` 在 `pendingRequests` 中，所以 resolve 对应的 Promise，并删除这个等待者。（这一步是代码阅读的结果，本次没有运行 `RpcClient`。）
9. **结束。** stdin 关闭，触发 `onInputEnd`，进而调用 `shutdown()`。`shutdown` 暂停 stdin，刷新 stdout（非 SIGTERM 时），然后以 `process.exit(exitCode)` 退出，此处 `exitCode` 为 0。实验 B 中退出码确实为 0。（`shutdown` 的其余步骤本次没有读完。）

实验 B 的真实输出，第 7 步对应的那一行（为便于阅读，`data` 中间省略）：

```text
{"type":"extension_ui_request","id":"...","method":"setWidget","widgetKey":"prompt-url"}
{"id":"g1","type":"response","command":"get_state","success":true,"data":{"model":{...},"thinkingLevel":"medium","isStreaming":false,...}}
```

第一行由本机的扩展配置产生，不是对 `get_state` 的响应。第二行才是响应。`data` 中的模型和配置取决于本机设置。

## 动手实验

实验只使用 faux 假模型，或不需要模型的命令。预期输出都是本地真实运行的结果。直接运行 `.ts` 文件需要能做类型剥离的 Node.js。本次运行时，Node.js 在 stderr 打印了 `ExperimentalWarning`（类型剥离仍是实验性功能）。下面的命令都把 stderr 丢弃，使输出只剩预期内容。

Windows PowerShell 与 bash 的命令不同的地方都写了两份。bash 版本在 Git Bash 中运行。

### 实验 A：用 SDK 和 faux 假模型跑一次完整运行（约 5 分钟）

目的：观察一次 `prompt` 产生的事件顺序，确认 `prompt` 在 `agent_settled` 之后才返回，并确认释放发生在最后。

步骤：

1. 在系统临时目录新建 `pi-task12-sdk-host.ts`，内容如下。
2. 把两处 `D:/Github/pi` 换成你的仓库路径（保持正斜杠）。

```typescript
import { fauxAssistantMessage } from "file:///D:/Github/pi/packages/ai/src/providers/faux.ts";
import { createHarness } from "file:///D:/Github/pi/packages/coding-agent/test/suite/harness.ts";

const h = await createHarness();
h.setResponses([fauxAssistantMessage("你好，这是假模型的回答。")]);
const order: string[] = [];
const unsubscribe = h.session.subscribe((event) => {
	order.push(event.type);
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		process.stdout.write(event.assistantMessageEvent.delta);
	}
});
try {
	await h.session.prompt("你好");
} finally {
	unsubscribe();
	h.cleanup();
	order.push("disposed");
}
console.log(`\nevents: ${order.join(" -> ")}`);
```

3. 运行。PowerShell：

```powershell
node "$env:TEMP\pi-task12-sdk-host.ts" 2>$null
```

bash：

```bash
node "${TMPDIR:-/tmp}/pi-task12-sdk-host.ts" 2>/dev/null
```

预期输出（真实运行结果）：

```text
你好，这是假模型的回答。
events: agent_start -> turn_start -> message_start -> message_end -> message_start -> message_end -> message_start -> message_update -> message_update -> message_update -> message_end -> turn_end -> agent_end -> agent_settled -> disposed
```

观察：

- `agent_end` 出现在 `agent_settled` 之前。`agent_settled` 之后，`prompt` 才返回。
- `disposed` 最后出现。`h.cleanup()` 内部调用了 `session.dispose()`，所以本实验没有再显式调用它。
- 文本增量（三次 `message_update`）通过 `process.stdout.write` 逐段输出，最后才打印 `events:` 行。

清理：删除 `pi-task12-sdk-host.ts`。

PowerShell：

```powershell
Remove-Item "$env:TEMP\pi-task12-sdk-host.ts"
```

### 实验 B：用 RPC 发送一条不需要模型的命令（约 5 分钟）

目的：确认 RPC 的命令、响应，以及 stdin 关闭后的关停。`get_state` 不调用模型。

步骤：在仓库根目录执行。stdin 只有一行，写完后管道关闭，pi 收到 stdin 结束信号并退出。

PowerShell：

```powershell
'{"id":"g1","type":"get_state"}' | node packages/coding-agent/src/rpc-entry.ts --no-session 2>$null
```

bash：

```bash
printf '%s\n' '{"id":"g1","type":"get_state"}' | node packages/coding-agent/src/rpc-entry.ts --no-session 2>/dev/null
```

预期输出（真实运行结果，`data` 因本机配置而异）：

```text
{"type":"extension_ui_request","id":"...","method":"setWidget","widgetKey":"prompt-url"}
{"id":"g1","type":"response","command":"get_state","success":true,"data":{...}}
```

PowerShell 中使用 `Select-String` 只保留响应行时，输出的是 `{"id":"g1","type":"response","command":"get_state","success":true,"data":{...}`，且 `$LASTEXITCODE` 为 0。

观察：

- 响应的 `id` 与请求的 `id` 相同。
- 第一行是扩展请求，不是响应。客户端要按 `type` 分流。
- 写完一行后 stdin 关闭，进程输出响应并退出，退出码为 0。

注意：`echo ... | pi` 这类管道会立即关闭 stdin，RPC 进程随之关停。要做多条命令的交互，宿主程序必须持续持有 stdin，并分次写入。

### 实验 C：JSONL 分块解析（约 10 分钟）

目的：验证按字节分块、只在 LF 处切分的解析器，结果与整段解析一致；确认字符串中的 U+2028、U+2029 不会切分记录；观察末尾残缺的记录会抛出错误。

步骤：在系统临时目录新建 `pi-task12-jsonl-check.mjs`，内容如下。它只使用 Node.js 标准库。

下面的代码用转义写法 `\u2028`、`\u2029` 表示这两个字符。运行时使用的字符串相同。

```javascript
const input = '{"type":"response","id":"p1"}\n{"type":"message_update","text":"中文"}\n{"type":"agent_end"}\n';
const bytes = new TextEncoder().encode(input);

function parse(chunks) {
	const decoder = new TextDecoder();
	let pending = "";
	const values = [];
	const feed = (chunk) => {
		pending += decoder.decode(chunk, { stream: true });
		let cut;
		while ((cut = pending.indexOf("\n")) >= 0) {
			const line = pending.slice(0, cut);
			pending = pending.slice(cut + 1);
			if (line.trim()) values.push(JSON.parse(line));
		}
	};
	for (const chunk of chunks) feed(chunk);
	pending += decoder.decode();
	if (pending.trim()) values.push(JSON.parse(pending));
	return values;
}

function split(size) {
	const out = [];
	for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
	return out;
}

const whole = JSON.stringify(parse([bytes]));
for (const size of [1, 64, 7]) {
	const values = parse(split(size));
	console.log(`chunk=${size} records=${values.length} sameAsWhole=${JSON.stringify(values) === whole}`);
}
const separators = new TextEncoder().encode('{"text":"a\u2028b\u2029c"}\n');
const parsedSeparators = parse([separators]);
console.log(
	`U+2028/U+2029 inside string: records=${parsedSeparators.length} codePoints=${[...parsedSeparators[0].text].map((c) => c.codePointAt(0).toString(16)).join(",")}`,
);
try {
	parse([new TextEncoder().encode('{"type":"agent_end"')]);
	console.log("truncated tail: no error");
} catch (error) {
	console.log(`truncated tail: ${error.name}`);
}
```

运行。PowerShell 与 bash 命令相同，只是重定向写法不同：

PowerShell：

```powershell
node "$env:TEMP\pi-task12-jsonl-check.mjs" 2>$null
```

bash：

```bash
node "${TMPDIR:-/tmp}/pi-task12-jsonl-check.mjs" 2>/dev/null
```

预期输出（真实运行结果）：

```text
chunk=1 records=3 sameAsWhole=true
chunk=64 records=3 sameAsWhole=true
chunk=7 records=3 sameAsWhole=true
U+2028/U+2029 inside string: records=1 codePoints=61,2028,62,2029,63
truncated tail: SyntaxError
```

观察：

- 每次只给 1 字节时结果仍然正确，因为解码器和缓冲区跨块保留状态。
- 字符串内部的 U+2028、U+2029 没有切分记录（`records=1`），它们作为字符保留在解析结果中（码点 `2028`、`2029`）。
- 末尾没有换行、且不是完整 JSON 的残留内容会抛出 `SyntaxError`。这说明协议要求每条记录完整。

清理：删除 `pi-task12-jsonl-check.mjs`。

PowerShell：

```powershell
Remove-Item "$env:TEMP\pi-task12-jsonl-check.mjs"
```

### 实验 D：确认 print 与 json 模式的参数名（约 3 分钟，不需要模型）

目的：确认 `--mode`、`--print` 和 `--no-session` 的写法，不调用模型。

PowerShell：

```powershell
node packages/coding-agent/src/cli.ts --help 2>$null | Select-String -Pattern "--print|--mode|--no-session"
```

bash：

```bash
node packages/coding-agent/src/cli.ts --help 2>/dev/null | grep -E -- "--print|--mode|--no-session"
```

预期输出（真实运行结果）：

```text
  --mode <mode>                  Output mode: text (default), json, or rpc
  --print, -p                    Non-interactive mode: process prompt and exit
  --no-session                   Don't save session (ephemeral)
```

说明：要真正运行 `pi -p "..."` 或 `pi --mode json "..."`，需要本机配置真实模型和密钥，可能产生费用。本篇没有运行这些命令，只通过源码和帮助文本确认参数。

### 实验 E：print 与 json 模式的真实输出（约 5 分钟，faux 假模型）

目的：看到 print 模式的 stdout，确认模型错误时的退出码，并看到 json 模式的事件顺序。

脚本 `pi-task12-run.ts` 用 harness 创建会话，再把它交给 `runPrintMode`。`runPrintMode` 只读取 `session`、`setRebindSession` 和 `dispose` 三项，所以脚本传入一个只含这三项的对象，代替真实的运行时。这是学习用的替身，不是公开 API。真实的 `pi -p` 需要本机模型配置。

在系统临时目录新建 `pi-task12-run.ts`，内容如下。第一个参数是 `text` 或 `json`，第二个参数是 `ok` 或 `error`。

```typescript
import { fauxAssistantMessage } from "file:///D:/Github/pi/packages/ai/src/providers/faux.ts";
import { createHarness } from "file:///D:/Github/pi/packages/coding-agent/test/suite/harness.ts";
import { runPrintMode } from "file:///D:/Github/pi/packages/coding-agent/src/modes/print-mode.ts";

// Usage: node pi-task12-run.ts <text|json> <ok|error>
const [modeArg = "text", outcome = "ok"] = process.argv.slice(2);
const h = await createHarness();
h.setResponses([
	outcome === "error"
		? fauxAssistantMessage("", { stopReason: "error", errorMessage: "模拟的模型错误" })
		: fauxAssistantMessage("这是假模型的回答。"),
]);

// Runtime shim: runPrintMode only needs session, setRebindSession, and dispose.
const runtime = {
	session: h.session,
	setRebindSession() {},
	async dispose() {
		h.cleanup();
	},
};

process.exitCode = await runPrintMode(runtime, {
	mode: modeArg === "json" ? "json" : "text",
	initialMessage: "你好",
});
```

运行。PowerShell：

```powershell
node "$env:TEMP\pi-task12-run.ts" text ok 2>$null
node "$env:TEMP\pi-task12-run.ts" text error 2>$null; "exit=$LASTEXITCODE"
node "$env:TEMP\pi-task12-run.ts" json ok 2>$null
node "$env:TEMP\pi-task12-run.ts" json error 2>$null; "exit=$LASTEXITCODE"
```

bash（未在本地验证，本次只在 PowerShell 中运行过）：

```bash
node "${TMPDIR:-/tmp}/pi-task12-run.ts" text ok 2>/dev/null
node "${TMPDIR:-/tmp}/pi-task12-run.ts" text error 2>/dev/null; echo "exit=$?"
node "${TMPDIR:-/tmp}/pi-task12-run.ts" json ok 2>/dev/null
node "${TMPDIR:-/tmp}/pi-task12-run.ts" json error 2>/dev/null; echo "exit=$?"
```

预期输出（真实运行结果）：

- `text ok`：`这是假模型的回答。`，stdout 只有这一行。
- `text error`：stdout 为空，`exit=1`。`模拟的模型错误` 写到 stderr，被 `2>$null` 丢弃。
- `json ok`：上文"事件顺序"表中的 15 行 JSONL，第一行是 `session`。
- `json error`：事件中的 `stopReason` 为 `error`，`exit=0`。

在实验 E 的早期运行中（用一个只针对模型错误的临时脚本），`json error` 也输出了上表的同样 15 种事件，其中第 12 行的 `message_end`、第 13 行的 `turn_end` 与第 14 行的 `agent_end` 的 `stopReason` 都为 `error`。

清理：

PowerShell：

```powershell
Remove-Item "$env:TEMP\pi-task12-run.ts"
```

### 实验 F：RPC 的完整交互（约 10 分钟，faux 假模型）

目的：用真实的 JSONL 交互，看到 `get_state`、`prompt`、`abort` 和一条失败命令的请求与响应，并确认 `abort` 的响应出现在 `agent_settled` 之后。

这个实验需要两个文件，都放在系统临时目录：

- `pi-task12-rpc-host.ts`：创建 faux 会话，然后调用 `runRpcMode`。它的假回答延迟 3 秒，给 `abort` 留出时间。
- `pi-task12-rpc-driver.mjs`：用 `child_process.spawn` 启动 host，依次写入命令。它等到每条命令的响应（按 `id` 查找）和 `agent_settled` 之后，才发送下一条。

`pi-task12-rpc-host.ts`：

```typescript
import { fauxAssistantMessage } from "file:///D:/Github/pi/packages/ai/src/providers/faux.ts";
import { createHarness } from "file:///D:/Github/pi/packages/coding-agent/test/suite/harness.ts";
import { runRpcMode } from "file:///D:/Github/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts";

const h = await createHarness();
// Slow scripted answer (3 s) so that an abort can arrive while the run is in progress.
h.setResponses([
	async () => {
		await new Promise((resolve) => setTimeout(resolve, 3000));
		return fauxAssistantMessage("这是慢速的假回答。");
	},
]);

// Runtime shim: runRpcMode needs session, setRebindSession, and dispose for these commands.
await runRpcMode({
	session: h.session,
	setRebindSession() {},
	async dispose() {
		h.cleanup();
	},
} as never);
```

`pi-task12-rpc-driver.mjs`：

```javascript
import { spawn } from "node:child_process";

const hostPath = process.argv[2];
const child = spawn(process.execPath, [hostPath], { stdio: ["pipe", "pipe", "ignore"] });
child.stdout.setEncoding("utf8");

const pending = new Map();
const settledListeners = [];
let settledCount = 0;
let buffer = "";

child.stdout.on("data", (chunk) => {
	buffer += chunk;
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index).replace(/\r$/, "");
		buffer = buffer.slice(index + 1);
		index = buffer.indexOf("\n");
		if (!line) continue;
		console.log(`<- ${line}`);
		const message = JSON.parse(line);
		if (message.type === "response" && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
		}
		if (message.type === "agent_settled") {
			settledCount++;
			for (const listener of settledListeners.splice(0)) listener();
		}
	}
});

function send(command) {
	console.log(`-> ${JSON.stringify(command)}`);
	child.stdin.write(`${JSON.stringify(command)}\n`);
	return new Promise((resolve) => pending.set(command.id, resolve));
}

function waitForSettled(count) {
	return new Promise((resolve) => {
		const check = () => {
			if (settledCount >= count) resolve();
			else settledListeners.push(check);
		};
		check();
	});
}

const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
const guard = setTimeout(() => {
	console.log("timeout: killing host");
	child.kill();
}, 30000);

await send({ id: "g1", type: "get_state" });
await send({ id: "p1", type: "prompt", message: "慢速回答" });
const settled = waitForSettled(settledCount + 1);
await send({ id: "a1", type: "abort" });
await settled;
await send({ id: "g2", type: "get_state" });
await send({ id: "e1", type: "set_model", provider: "no-such-provider", modelId: "none" });
child.stdin.end();
const code = await exited;
clearTimeout(guard);
console.log(`exit=${code}`);
```

运行。PowerShell：

```powershell
node "$env:TEMP\pi-task12-rpc-driver.mjs" "$env:TEMP\pi-task12-rpc-host.ts"
```

bash（未在本地验证，本次只在 PowerShell 中运行过）：

```bash
node "${TMPDIR:-/tmp}/pi-task12-rpc-driver.mjs" "${TMPDIR:-/tmp}/pi-task12-rpc-host.ts"
```

预期输出：与核心概念 4 中"完整的交互"相同。`->` 行是 driver 发出的命令，`<-` 行是 host 的输出。`sessionId` 和时间戳每次运行都不同。最后一行是 `exit=0`。

清理：

PowerShell：

```powershell
Remove-Item "$env:TEMP\pi-task12-rpc-host.ts", "$env:TEMP\pi-task12-rpc-driver.mjs"
```

### 实验 G：SDK 中订阅的时机（约 5 分钟，faux 假模型）

目的：确认 `prompt` 的运行期间发出的事件，只有在 `prompt` 之前订阅才能收到。

脚本 `pi-task12-sdk-order.ts` 运行两次：一次先订阅，一次在 `prompt` 返回之后订阅。每次运行都创建新的 harness，并在结束时调用 `cleanup()`。

```typescript
import { fauxAssistantMessage } from "file:///D:/Github/pi/packages/ai/src/providers/faux.ts";
import { createHarness } from "file:///D:/Github/pi/packages/coding-agent/test/suite/harness.ts";

async function run(label: string, subscribeFirst: boolean): Promise<void> {
	const h = await createHarness();
	h.setResponses([fauxAssistantMessage("你好")]);
	const order: string[] = [];
	const listener = (event: { type: string }) => {
		order.push(event.type);
	};
	const unsubscribe = subscribeFirst ? h.session.subscribe(listener) : undefined;
	try {
		await h.session.prompt("你好");
	} finally {
		if (!subscribeFirst) {
			// Subscribing after prompt() has returned: the listener is attached too late for this run.
			h.session.subscribe(listener);
		}
		unsubscribe?.();
		h.cleanup();
		order.push("disposed");
	}
	console.log(`${label}: ${order.join(" -> ")}`);
}

await run("subscribe-before-prompt", true);
await run("subscribe-after-prompt", false);
```

运行。PowerShell：

```powershell
node "$env:TEMP\pi-task12-sdk-order.ts" 2>$null
```

bash（未在本地验证，本次只在 PowerShell 中运行过）：

```bash
node "${TMPDIR:-/tmp}/pi-task12-sdk-order.ts" 2>/dev/null
```

预期输出（真实运行结果）：

```text
subscribe-before-prompt: agent_start -> turn_start -> message_start -> message_end -> message_start -> message_end -> message_start -> message_update -> message_update -> message_update -> message_end -> turn_end -> agent_end -> agent_settled -> disposed
subscribe-after-prompt: disposed
```

`disposed` 是脚本自己写入的标记，不是事件。第二行只有它，说明晚订阅的监听器没有收到本次运行的任何事件。

清理：

PowerShell：

```powershell
Remove-Item "$env:TEMP\pi-task12-sdk-order.ts"
```

## 自测题

1. CI 脚本只需要最终回答，编辑器插件需要中途取消。两者各选哪种入口？为什么？
2. `session.prompt()` 和 RPC 的 `prompt` 命令的响应，各在什么时候返回？哪个信号表示运行已经完成？
3. json 模式为什么要删除 `message_update` 的 `message` 和 `partial`，却保留 `toolcall_start` 的 `id` 和 `toolName`？
4. 解析 JSONL 时，为什么不能对每个网络数据块直接调用 `JSON.parse`？
5. 调用 `session.dispose()` 会做哪些事？它会删除会话文件吗？

## 参考答案

1. CI 脚本用 print（`pi -p "..."`，或管道自动进入 print）。编辑器插件用 rpc，因为它需要长驻进程、事件流和取消命令。
2. `session.prompt()` 在整个运行结束后才 resolve，包括重试和排队的工作。RPC 的 `prompt` 响应在 preflight 通过后发出，只表示命令被接受；它的 `data.disposition` 说明是 `started`、`queued` 还是 `handled`。运行完成的信号是 `agent_settled`。`agent_end` 只是一次低层运行结束。
3. `message` 和 `partial` 是累积快照，消息越长，每条事件就越大。`toolcall_start` 的 `id` 和 `toolName` 是短字符串，大小固定。`toJsonEvent` 的注释说明：`usage`、工具调用的 `id` 和 `toolName` 大小固定，保留它们的代价很小。`id` 和 `toolName` 让消费方知道这段增量属于哪个工具调用。这一点是从字段含义推断的，未在本地验证具体消费方的用法。
4. 一个数据块可能只包含半行，也可能包含多行，甚至半个 UTF-8 字符。直接解析会失败或得到错误的结果。正确做法是：用流式解码器保留未完成的字符，缓冲，只在 `\n` 处切分，每行单独解析，流结束时处理残留内容。
5. `dispose()` 中止进行中的工作，让扩展上下文失效，断开 agent，清空事件监听器，取消缓存预热器。它的函数体中没有删除会话文件的调用。它的目的是释放进程内资源；会话文件由宿主或用户自己管理。

## 常见错误

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 解析偶尔失败，多数时候正常 | 对每个数据块直接 `JSON.parse`，一行被切成两段 | 先缓冲，只在 `\n` 处切分，再逐行解析 |
| 最后一条记录丢失 | 流结束时没有处理缓冲区中没有换行的残留内容 | 流结束时把残留内容当作最后一行处理（见选读中的 `onEnd`） |
| 响应配到了错误的命令 | 按到达顺序配对，但命令是并发处理的 | 每条命令带唯一 `id`，按 `id` 找等待方 |
| 把 `agent_end` 当成完成信号 | 它只是一次低层运行结束，重试或排队之后可能继续 | 等待 `agent_settled`；`handled` 的 prompt 不会产生它 |
| `echo '...' \| pi --mode rpc` 之后进程很快退出 | 管道写完即关闭 stdin，触发 `shutdown` | 宿主程序保持 stdin 打开，分次写入命令 |

## 下一篇

下一篇讲终端 UI：交互模式如何把同样的会话事件画到屏幕上，以及它与本篇的 print、json、rpc 模式如何分工。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| JSONL | 每行一个独立 JSON 对象、以换行结尾的文本格式 | 核心概念 1 |
| print 模式 | 一次性运行，只输出最终文本的模式 | 核心概念 2 |
| json 模式 | 一次性运行，stdout 输出 JSONL 事件流 | 核心概念 3 |
| rpc 模式 | 长驻进程，stdin 收命令，stdout 出响应与事件 | 核心概念 4 |
| 命令 id | 客户端为命令指定的字符串，响应原样带回，用于配对 | 核心概念 4 |
| disposition | `prompt` 响应中的字段，值为 `started`、`queued` 或 `handled` | 核心概念 4 |
| agent_end | 一次低层运行结束的事件，之后仍可能有重试或排队的工作 | 核心概念 4 |
| agent_settled | 没有更多自动工作时发出的完成信号 | 核心概念 4 |
| RpcClient | 封装子进程、JSONL 读取与请求配对的 TypeScript 客户端 | 核心概念 4 |
| SDK | 在 Node.js 进程内直接调用 pi 的 TypeScript 接口 | 核心概念 5 |
| createAgentSession | SDK 的创建函数，返回会话与扩展加载结果 | 核心概念 5 |
| dispose | 释放会话持有的进程内资源，不负责删除用户的会话文件 | 核心概念 5 |
| faux 假模型 | 脚本化的离线模型，按预设返回回答 | 动手实验 A |
| 会话头 | json 模式 stdout 的第一行，`type` 为 `session`，记录会话的 id、版本和工作目录 | 核心概念 3 |
| 背压 | 写入方等待读取方消费，防止缓冲区无限增长 | 选读 4 |

## 选读：源码深入（可选，跳过不影响主线）

**选读，跳过不影响主线。** 这一节解释 JSONL 读取器、`RpcClient` 的内部和部分模式细节。它们对写宿主有帮助，但读懂前面的内容并不需要它们。

### 选读 1：`attachJsonlLineReader` 的实现

源码（`packages/coding-agent/src/modes/rpc/jsonl.ts`）的结构如下：

- 解码器是 `node:string_decoder` 的 `StringDecoder`，不是 `TextDecoder`。两者都能跨块保留未完成的 UTF-8 字符。实验 C 用 `TextDecoder` 演示的是同一个原理。
- `onData`：`buffer += decoder.write(chunk)`，然后循环查找 `\n`。每找到一个，就取出一行；如果行尾是 `\r`，去掉它，再交给 `onLine`。
- `onEnd`：调用 `decoder.end()` 冲出解码器里剩余的字节。如果缓冲区非空，把它当作最后一行交给 `onLine`。这是防止"最后一条记录丢失"的代码。
- 返回值是一个解绑函数，内部调用 `stream.off("data", ...)` 和 `stream.off("end", ...)`。

源码注释说明，这里不使用 Node `readline`，因为 `readline` 还会在其他 Unicode 分隔符处切分。仓库的 `packages/coding-agent/docs/rpc.md` 与 `packages/coding-agent/docs/json.md` 也有相同的说法。

未验证：本次没有运行 Node `readline` 来测试 U+2028、U+2029 的行为。本篇只依据协议规定（只在 LF 切分）和实验 C 的结果。实验 C 测的是本文件的解析函数，不是 `readline`。

### 选读 2：`RpcClient` 的内部

`RpcClient` 位于 `packages/coding-agent/src/modes/rpc/rpc-client.ts`。本次没有构建 `dist/cli.js`，也没有运行它。下面的描述来自代码阅读。

- `start()`：用 `spawn("node", [cliPath, "--mode", "rpc", ...])` 启动子进程。`cliPath` 默认是 `"dist/cli.js"`，所以在源码仓库中要先构建，或显式传入 `cliPath`。`start()` 用 `attachJsonlLineReader` 读取子进程的 stdout，然后等待 100 毫秒（`setTimeout`）。如果子进程这时已经退出，就抛出错误。
- `send(command)`：生成 `req_1`、`req_2`……形式的 id，把等待方放进 `pendingRequests`，启动一个 30 秒的 `setTimeout`，然后写入 `serializeJsonLine` 的结果。超时的请求会从 `pendingRequests` 删除并被拒绝。
- `handleLine(line)`：如果 `type === "response"` 且 id 在 `pendingRequests` 中，就 resolve 对应的等待方。否则，这一行被当作事件分发给所有监听器。JSON 解析失败的行会被静默忽略。
- `promptAndWait(message, images, timeout)`：先调用 `collectEvents`，它订阅事件；然后才调用 `prompt`。这样做的目的是：如果运行很快结束，事件不会在订阅之前就发出。但 `collectEvents` 只在收到 `agent_settled` 时结束。如果 prompt 的结果是 `handled`，不会有新的 `agent_settled`，函数会一直等到超时（默认 60 秒）。遇到这种情况，应该分开调用 `prompt()`，检查返回的 `disposition`，只在 `started` 时等待。
- `stop()`：先停止读取 stdout，然后调用 `this.process.kill("SIGTERM")`。如果 1 秒内没有收到 `exit`，调用 `kill("SIGKILL")` 并结束等待。最后把 `process` 设为 `null`，并清空 `pendingRequests`。

`stop()` 的一个细节（从代码推断，未运行验证）：正常退出时，`start()` 注册的 `exit` 处理器先调用 `rejectPendingRequests`，等待方立即被拒绝。如果走的是 SIGKILL 超时路径，`stop()` 在 `exit` 到达前就清空了 `pendingRequests`，之后的 `exit` 处理器看到 `process` 已经不是当前子进程，直接返回。这时等待方不会立即被拒绝，而是等它们自己的 30 秒计时器到期，才以超时错误拒绝。因此调用方应在 `stop()` 之前结束或取消自己的工作。

Windows：本次没有在 Windows 上运行 `RpcClient`。因此不声称 `SIGTERM` 或 `SIGKILL` 在 Windows 上的具体效果。需要确认时，可以用 `child.kill()` 发出结束请求，监听 `exit` 事件，并用 `setTimeout` 设置等待上限。示意（未运行）：

```typescript
// child 是已经启动的 ChildProcess（示意）
const limit = setTimeout(() => child.kill(), 5000); // 5 秒后请求结束子进程
child.once("exit", () => clearTimeout(limit));
```

### 选读 3：print 模式的信号处理与退出码

`runPrintMode`（`packages/coding-agent/src/modes/print-mode.ts`）注册信号处理器：

- 所有平台注册 `SIGTERM`。非 Windows 平台另外注册 `SIGHUP`，因为 Windows 没有这个信号。
- 处理器先调用 `killTrackedDetachedChildren()`，杀掉 pi 记录过的后台子进程；然后释放运行时，并以 `process.exit(143)`（SIGTERM）或 `process.exit(129)`（SIGHUP）退出。退出码遵循 128 加信号编号的惯例。
- `finally` 中会注销这些处理器，释放运行时，并调用 `flushRawStdout()`，保证退出前 stdout 的内容已经写完。

本次没有发送信号来测试这些处理器。

### 选读 4：背压挂在哪一层

json 模式除了订阅会话事件，还调用：

```typescript
session.agent.subscribe(async () => {
	await waitForRawStdoutBackpressure();
});
```

"背压"（backpressure）指写入方等待读取方消费。如果 stdout 的缓冲区满了，`waitForRawStdoutBackpressure` 会等待它降下来。这样事件派发会被拖住，pi 不会把整个输出堆在内存里。

这个订阅挂在 `session.agent` 上，而不是 `session`。代码的写法说明作者的意图是在 agent 层等待。本次没有验证 `Agent.subscribe` 是否真的逐个等待 listener 返回的 Promise，也没有验证 `session.subscribe` 的回调是否不被等待。这两点都未验证。

### 选读 5：`toJsonEvent` 的细节

`toJsonEvent`（`packages/coding-agent/src/modes/json-event.ts`）的处理规则：

- `message_update` 的 `message.role` 不是 `"assistant"` 时抛出错误。
- `toolcall_start` 从 `partial.content[contentIndex]` 取出工具调用。如果取不到，或者该内容不是 `toolCall` 类型，抛出错误。成功时，输出里去掉 `partial`，并加上 `id` 与 `toolName`。
- 其他 `message_update`：去掉 `partial`，保留其他字段（包括 `usage`）。
- 其他事件类型：原样返回。
- 文件中的两个重载签名让传入 `message_update` 时的返回类型收窄为 `JsonMessageUpdateEvent`。

### 选读 6：rpc 模式如何回复 `prompt`

`handleCommand` 的 `prompt` 分支先启动 `session.prompt(...)`，然后立即返回 `undefined`，表示这条命令暂时不产生响应。真正的响应在 `preflightResult` 回调中用 `success(id, "prompt", { disposition })` 发出。如果 `session.prompt` 在 preflight 之前就抛出异常，则发出 `error(id, "prompt", message)`。

这就是 `prompt` 的响应早于运行结束的原因。本次只通过 `get_state` 的实验验证了响应路径；没有运行 `prompt` 命令。

### 选读 7：未验证的内容清单

- Node `readline` 对 U+2028、U+2029 的行为：未运行验证。
- `pi -p` 与 `pi --mode json` 的真实模型调用：未运行，需要模型配置。
- `RpcClient` 的 `start`、`promptAndWait`、`stop`：未运行，需要先构建 `dist/cli.js`。
- Windows 上的信号行为（`SIGTERM`、`SIGKILL`、`SIGHUP`）：未验证。
- `dispose()` 调用的 `cleanupSessionResources` 的实现：未读。
