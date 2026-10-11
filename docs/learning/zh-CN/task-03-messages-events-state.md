# 03. 消息、事件、状态与持久化条目

> 预计时间：2 小时
> 先修：TypeScript 的判别联合与类型收窄（用一个字段区分多种对象）；一次请求从 CLI 到模型调用的路径

## 本篇你会学到

- 区分四种数据：模型消息、Agent 消息、事件、会话条目。说出每一种由谁产生、给谁用、是否写入磁盘。
- 读懂 `convertToLlm`：它把内部消息翻译成模型能接受的消息，并解释为什么需要它。
- 读懂 `AgentState` 的字段，知道哪些可以赋值，哪些只读。

## 先用一个例子理解

用户在 pi 里输入：“读取 README 并总结”。这一次操作会产生很多数据：

1. 用户的一句话。
2. 模型说“我要调用 `read`”。
3. `read` 工具返回文件内容。
4. 模型生成总结，文字一个字一个字到达。
5. 界面显示进度，磁盘上保存历史。

如果 pi 只有一种数据结构，就会出现问题。例如，把文字增量当成完整回答保存，重启后会得到半句话；把界面进度当成历史保存，恢复会话时会重复显示；把保存的历史直接发给模型，又可能带入模型不该看到的内容。

所以 pi 把这些数据分成四类：

| 数据 | 一句话 | 例子 |
| --- | --- | --- |
| 模型消息（Message） | 模型能理解的对话内容 | 用户的话、模型的回答、工具结果 |
| Agent 消息（AgentMessage） | pi 内部的对话内容，可以比模型消息多几种角色 | 模型消息加上 bash 执行记录、压缩摘要 |
| 事件（AgentEvent / AgentSessionEvent） | 过程通知，告诉订阅者“正在发生什么” | `message_update`、`tool_execution_start` |
| 会话条目（SessionEntry） | 写入磁盘的历史记录，每行一条 | `message` 条目、`compaction` 条目 |

另外还有一个“当前值”：`AgentState`，记录进程里现在的模型、工具、消息数组等。它不是历史，进程退出后就消失。

下面用一次真实运行来看这四类数据。运行内容是：用户输入“读取 README”，模型调用 `read` 工具，工具返回文件内容，模型回答“README 已读取”。这次运行由 faux 假模型（脚本化的测试模型，不调用真实服务）完成，不需要密钥。

## 核心概念

### 概念 1：模型消息（Message）

**模型消息**是 `packages/ai/src/types.ts` 中定义的 `Message`。它是供应商（如 Anthropic、OpenAI）能理解的对话格式。

```typescript
export type Message = SystemMessage | UserMessage | AssistantMessage | ToolResultMessage;
```

它有四个角色，用 `role` 字段区分。`role` 就是判别字段：TypeScript 看到 `role` 的值，就知道这是哪一种消息，并允许读取该种消息专有的字段。

| 角色 | 类型 | 谁产生 | 作用 |
| --- | --- | --- | --- |
| `system` | `SystemMessage` | pi | 提示词和工具声明 |
| `user` | `UserMessage` | 用户输入，或被转换后的内部消息 | “人在说话” |
| `assistant` | `AssistantMessage` | 模型 | “我之前说过或做过什么” |
| `toolResult` | `ToolResultMessage` | 工具执行 | “工具的答案” |

下面是一条真实的 `assistant` 消息。它来自与“动手实验”相同场景的一次本地运行（faux 假模型返回的 `read` 工具调用）。ID 和时间戳每次运行都不同，只看结构即可。每个字段的含义见表后：

```json
{
  "role": "assistant",
  "content": [
    { "type": "toolCall", "id": "tool:1791639398350:su6ofp05vem", "name": "read", "arguments": { "path": "README.md" } }
  ],
  "api": "faux:1791639398323:y48o0wsn36",
  "provider": "faux",
  "model": "faux-1",
  "usage": {
    "input": 1424,
    "output": 7,
    "cacheRead": 0,
    "cacheWrite": 0,
    "totalTokens": 1431,
    "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 }
  },
  "stopReason": "toolUse",
  "timestamp": 1791639398350,
  "thinkingLevel": "off"
}
```

| 字段 | 含义 | 本例的值 |
| --- | --- | --- |
| `role` | 角色，判别字段 | `"assistant"` |
| `content` | 内容块数组，顺序即模型产生的顺序 | 一个 `toolCall` 块 |
| `api`、`provider`、`model` | 用哪种协议、哪家供应商、哪个模型回答 | faux 假模型，不是真实服务 |
| `usage` | 本次调用的 token 数和费用；`input` 是输入 token，`output` 是输出 token | 输入 1424，输出 7 |
| `stopReason` | 模型为什么停下；`toolUse` 表示它要等工具结果 | `"toolUse"` |
| `timestamp` | Unix 毫秒数（不是 ISO 字符串） | 1791639398350 |
| `thinkingLevel` | 本次请求用的思考级别（可选字段） | `"off"` |

这条消息里有三个要点：

- `content` 是**内容块数组**。块有四种：`text`、`image`、`thinking`、`toolCall`。数组顺序就是模型产生内容的顺序。
- `toolCall.id` 是“调用”和“结果”之间的唯一连接。工具结果里的 `toolCallId` 必须等于它。
- `stopReason` 说明模型为什么停下。它有七个值：`pending`、`stop`、`length`、`toolUse`、`error`、`aborted`、`deferred`。流式过程中是 `pending`，结束后是终态值。

对应的工具结果是（同一次运行）：

```json
{
  "role": "toolResult",
  "toolCallId": "tool:1791639398350:su6ofp05vem",
  "toolName": "read",
  "content": [{ "type": "text", "text": "# Demo\nA short paragraph.\n" }],
  "isError": false,
  "timestamp": 1791639398369
}
```

| 字段 | 含义 | 本例的值 |
| --- | --- | --- |
| `role` | 角色 | `"toolResult"` |
| `toolCallId` | 对应哪一个 `toolCall.id` | 与上面的 `id` 相同 |
| `toolName` | 工具名，便于显示 | `"read"` |
| `content` | 发给模型看的结果 | 文件全文，一个文本块 |
| `isError` | 工具是否失败 | `false` |
| `timestamp` | Unix 毫秒数 | 比调用晚 19 毫秒 |

本例没有 `details`、`usage`、`nestedCalls`，因为 `read` 工具没有返回这些字段。

`ToolResultMessage` 有两个容易混淆的字段：

- `content`：发给模型看的结果。
- `details`：给界面或程序看的结构化数据。它会保存，但不会发给模型。

还有 `nestedCalls`：工具内部调用了其他工具时的记录。它保存在会话里，也不发给模型。

`SystemMessage` 不只是“系统提示词”。它的 `sections` 字段是有名字的提示词分节，`toolsAdded` 和 `toolsRemoved` 记录工具的增减。后面的系统消息可以替换某一节，值为 `null` 表示删除。这里要注意：`packages/ai/src/types.ts` 的 `SystemMessage` 没有 `replace` 字段。如果看到某份文档提到 `replace: true`，以源码为准。

### 概念 2：Agent 消息（AgentMessage）

模型消息不能覆盖 pi 内部需要的所有对话内容。例如，用户用 `!` 执行的 shell 命令，也需要出现在对话历史中，但模型不认识 `bashExecution` 这种角色。

所以 `packages/agent/src/types.ts` 定义了更宽的类型：

```typescript
export interface CustomAgentMessages {
  // Empty by default - apps extend via declaration merging
}

export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];
```

`CustomAgentMessages` 默认是空接口。应用可以用 TypeScript 的**声明合并**（declaration merging，同名接口会自动合并新成员）往里加角色。`packages/coding-agent/src/core/messages.ts` 就是这样做的：

```typescript
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    custom: CustomMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
  }
}
```

合并后，coding-agent 里的 `AgentMessage` 包含八种角色：四种模型消息，加上四种应用角色。

| 角色 | 何时产生 | 发给模型时怎么办 |
| --- | --- | --- |
| `bashExecution` | 用户用 `!` 执行命令 | 转成 `user` 文本；`excludeFromContext` 为真时丢弃（`!!` 前缀） |
| `custom` | 扩展调用 `sendMessage()` 注入内容 | 转成 `user` 消息 |
| `branchSummary` | 切换分支时，对放弃的路径做摘要 | 转成 `user` 文本，外面包一层摘要标签 |
| `compactionSummary` | 上下文压缩后 | 转成 `user` 文本，外面包一层摘要标签 |

这些角色在 pi 内部有用，但模型不认识。它们需要在发送前被翻译，这一步由 `convertToLlm` 完成（见概念 6）。

下面是一条完整的 `bashExecution` 记录，它对应用户输入 `!ls` 的结果。它的类型是 `packages/coding-agent/src/core/messages.ts` 中的 `BashExecutionMessage`：

```json
{
  "role": "bashExecution",
  "command": "ls",
  "output": "README.md",
  "exitCode": 0,
  "cancelled": false,
  "truncated": false,
  "timestamp": 3
}
```

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `role` | 角色，`bashExecution` 是 pi 自定义的角色 | 模型不认识它，必须经过 `convertToLlm` |
| `command` | 用户输入的命令 | 原样保存 |
| `output` | 命令的标准输出和错误输出 | 可能很长 |
| `exitCode` | 退出码，`0` 表示成功；类型允许 `undefined` | 非 0 时翻译后的文本会提示退出码 |
| `cancelled` | 用户是否中途取消 | 为真时翻译后的文本会提示“已取消” |
| `truncated`、`fullOutputPath?` | 输出是否被截断，以及完整输出保存在哪个文件 | 只有截断时才有路径 |
| `excludeFromContext?` | 为真时不发给模型（`!!` 前缀） | 本例没有此字段，所以会发给模型 |
| `timestamp` | Unix 毫秒数 | 与其它 AgentMessage 相同的格式 |

### 概念 3：事件（AgentEvent 与 AgentSessionEvent）

**事件**是过程通知。它说的是“刚才发生了一件事”，而不是“这是完整的对话内容”。事件只在发出的那一刻有效，发完就丢弃，不保存。

`packages/agent/src/types.ts` 的 `AgentEvent` 是一个判别联合，共有 10 个成员：

| `type` | 附带的数据 | 何时发出 | 典型用途 |
| --- | --- | --- | --- |
| `agent_start` | 无 | 一次运行开始 | 界面进入“忙碌” |
| `agent_end` | `messages` | 一次运行的循环结束 | 界面显示完成 |
| `turn_start` | 无 | 一个轮次开始 | 界面显示新一轮 |
| `turn_end` | `message`、`toolResults` | 一个轮次结束 | 收尾渲染 |
| `message_start` | `message` | 一条消息开始 | 创建消息气泡 |
| `message_update` | `message`、`assistantMessageEvent` | 助手消息的每个增量 | 显示流式文字 |
| `message_end` | `message` | 一条消息定稿 | 写入状态和磁盘 |
| `tool_execution_start` | `toolCallId`、`toolName`、`args` | 工具开始执行 | 显示“正在执行” |
| `tool_execution_update` | 同上，另加 `partialResult` | 工具上报进度 | 显示局部输出 |
| `tool_execution_end` | 同上，另加 `result`、`isError` | 工具结束 | 渲染结果 |

注释里写明：`message_update` 只对助手消息发出。

#### 每个事件什么时候发出

下面按一次“读取 README”运行中的先后顺序列出。括号里是本次运行中是否出现该事件。

- **`agent_start`**（出现）：一次运行开始时最先发出。进入 `prompt()` 后、第一条消息之前。发出后 `isStreaming` 为 `true`。
- **`turn_start`**（出现，两次）：一轮开始。一轮 = 一次助手回答，加上它调用的工具和结果。本次运行有两轮：第一轮是 `read` 调用，第二轮是最终回答。
- **`message_start`**（出现）：任何一条消息开始时发出，包括 `system`、`user`、`assistant`、`toolResult`。发出后 `streamingMessage` 指向这条消息。
- **`message_update`**（出现，多次）：助手消息每收到一个增量时发出。`assistantMessageEvent` 说明是哪种增量。本次出现的类型是 `toolcall_start`、`toolcall_delta`（两次）、`toolcall_end`、`text_start`、`text_delta`、`text_end`。`start` 类型没有出现，因为“开始”由 `message_start` 表示。
- **`message_end`**（出现）：一条消息定稿时发出。`processEvents` 把它 `push` 到 `messages`，`AgentSession` 把它写成一条 `message` 条目。
- **`tool_execution_start`**（出现）：工具真正开始执行前发出，位于助手 `toolCall` 的 `message_end` 之后。发出后 `pendingToolCalls` 含该 id。
- **`tool_execution_update`**（未出现）：工具运行中上报进度时发出，携带 `partialResult`。本次 `read` 工具很快结束，没有上报进度。
- **`tool_execution_end`**（出现）：工具返回后发出。发出后该 id 从 `pendingToolCalls` 移除。
- **`turn_end`**（出现，两次）：一轮的最后一条消息 `message_end` 之后发出。它携带 `message`（该轮的助手消息）和 `toolResults`（该轮的工具结果）。
- **`agent_end`**（出现）：整个 Agent 循环结束后发出，位于最后一个 `turn_end` 之后。`isStreaming` 此时仍为 `true`，要等监听器全部结束。
- **`agent_settled`**（出现，只属于 `AgentSessionEvent`）：会话层的工作全部结束后发出，由 `_emitAgentSettled()` 发出。此时 `isStreaming` 已是 `false`。

完整的 `tool_execution_end` 事件对象（同一次运行）：

```json
{
  "type": "tool_execution_end",
  "toolCallId": "tool:1791639398350:su6ofp05vem",
  "toolName": "read",
  "result": { "content": [{ "type": "text", "text": "# Demo\nA short paragraph.\n" }] },
  "isError": false
}
```

| 字段 | 含义 |
| --- | --- |
| `type` | 事件名，是判别字段 |
| `toolCallId` | 对应哪一次工具调用，与 `tool_execution_start` 相同 |
| `toolName` | 工具名 |
| `result` | 工具的 `AgentToolResult`；本次只有 `content` 字段 |
| `isError` | 工具是否失败 |

`message_update` 的结构由类型定义决定：`{ type, message, assistantMessageEvent }`，其中 `message` 是到目前为止的部分助手消息，`assistantMessageEvent` 是增量。字段名来自 `packages/ai/src/types.ts` 的 `AssistantMessageEvent` 定义；本篇没有打印这类对象的实际内容。

`agent_end` 事件本次运行中带有三个字段：`type`、`messages`、`willRetry`。`messages` 的长度为 5，与转录一致。`willRetry` 只在会话层出现，来自 `AgentSession` 的 `_handleAgentEvent` 对 `agent_end` 的改写。

`message_update` 里的 `assistantMessageEvent` 是另一个判别联合，定义在 `packages/ai/src/types.ts`。它的成员有：`start`、`text_start`、`text_delta`、`text_end`、`thinking_start`、`thinking_delta`、`thinking_end`、`toolcall_start`、`toolcall_delta`、`toolcall_end`、`done`、`error`。它是 `message_update` 的载荷，不是 `AgentEvent` 的第 11 个成员。

下面的代码演示收窄写法（先判断 `type`，再取字段），用于取出文字增量：

```typescript
const deltaText = h.events
  .flatMap((e) =>
    e.type === "message_update" && e.assistantMessageEvent.type === "text_delta"
      ? [e.assistantMessageEvent.delta]
      : [],
  )
  .join("");
```

只有判断了 `e.type === "message_update"`，TypeScript 才知道 `e` 上有 `assistantMessageEvent`。判断了 `type === "text_delta"`，才知道有 `delta`。

#### AgentSessionEvent：会话层的事件

`packages/coding-agent/src/core/agent-session.ts` 的 `AgentSession` 对外发出 `AgentSessionEvent`。它复用了 `AgentEvent` 的大部分成员，但做了三类改动：

- `agent_end` 被替换。会话版多了必填字段 `willRetry`，表示会不会因为自动重试再开始一次运行。
- 新增会话级事件：`agent_settled`、`queue_update`、`compaction_start`、`compaction_end`、`entry_appended`、`session_info_changed`、`thinking_level_changed`、`auto_retry_start`、`auto_retry_end`、`summarization_retry_*`、`bash_execution_update`。
- 工具执行事件可以带可选字段 `parentToolCallId`，表示这次工具调用属于哪个外层调用。

两个容易混淆的事件：

- `agent_end` 是“这一次 Agent 运行的循环结束”。一次 `session.prompt()` 可能因为自动重试产生多次 `agent_end`。
- `agent_settled` 是“会话层的全部工作结束”。它在 `_runAgentPrompt()` 的收尾阶段，由 `_emitAgentSettled()` 发出。一次 `prompt()` 只发一次。

probe 运行的事件顺序里，最后两个事件就是 `agent_end` 然后 `agent_settled`。

### 概念 4：会话条目（SessionEntry）

**会话条目**是写入磁盘的历史记录。会话文件是 JSONL 格式：每行一个 JSON 对象，每个对象就是一个条目。

`packages/coding-agent/src/core/session-manager.ts` 定义了条目的公共字段：

```typescript
export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}
```

- `id` 是这条记录自己的编号。
- `parentId` 指向上一条记录。根条目的 `parentId` 为 `null`。
- `timestamp` 是 ISO 字符串，例如 `"2026-10-10T12:00:00.000Z"`。

因为每条记录都指向父节点，所以整个文件组成一棵树，而不是一条直线。当用户从历史中间继续对话时，新记录就挂在较早的节点下面，形成分支。

`SessionEntry` 是一个判别联合，`type` 是判别字段。它的成员是：

| `type` | 类型名 | 主要字段 | 是否进入模型上下文 |
| --- | --- | --- | --- |
| `message` | `SessionMessageEntry` | `message: AgentMessage` | 是 |
| `thinking_level_change` | `ThinkingLevelChangeEntry` | `thinkingLevel` | 否，但影响后续解释 |
| `model_change` | `ModelChangeEntry` | `provider`、`modelId` | 否，但影响后续解释 |
| `usage` | `UsageEntry` | `kind`、`provider`、`model`、`usage`、`note?` | 否 |
| `compaction` | `CompactionEntry` | `summary`、`firstKeptEntryId`、`tokensBefore`、`systemMessage?` 等 | 是，替代较早的消息 |
| `branch_summary` | `BranchSummaryEntry` | `fromId`、`summary`、`details?` 等 | 是 |
| `custom` | `CustomEntry` | `customType`、`data?` | 否（源码注释明确说明） |
| `custom_message` | `CustomMessageEntry` | `customType`、`content`、`display`、`details?` | 是 |
| `context_edit` | `ContextEditEntry` | `targetId`、`replacement`（`null` 表示省略） | 间接，改变投影结果 |
| `label` | `LabelEntry` | `targetId`、`label` | 否 |
| `session_info` | `SessionInfoEntry` | `name?` | 否 |

文件第一行不是 `SessionEntry`，而是 `SessionHeader`（`type: "session"`，含 `id`、`timestamp`、`cwd`，以及 `version`）。`FileEntry` 是 `SessionHeader | SessionEntry`。

`packages/coding-agent/src/core/session-manager.ts` 中的 `CURRENT_SESSION_VERSION` 当前为 `3`。一份会话文件的形状大致如下（示意：字段已省略，ID 为假设值）：

```json
{"type":"session","version":3,"id":"s-001","timestamp":"2026-10-10T12:00:00.000Z","cwd":"/work/demo"}
{"type":"message","id":"a1b2c3d4","parentId":null,"timestamp":"2026-10-10T12:00:01.000Z","message":{"role":"system","content":"...","timestamp":1791547201000}}
{"type":"message","id":"e5f6a7b8","parentId":"a1b2c3d4","timestamp":"2026-10-10T12:00:02.000Z","message":{"role":"user","content":"读取 README","timestamp":1791547202000}}
```

第二行和第三行的 `message` 字段就是 `AgentMessage`，外层的 `id`、`parentId`、`timestamp` 是条目自己的。注意两个 `timestamp` 的格式不同。

下面是同一次运行中，助手 `toolCall` 消息写成的完整条目（一行 JSONL，这里为了可读性换行显示）。它的 `parentId` 指向上一条的用户消息条目：

```json
{
  "type": "message",
  "id": "11297909",
  "parentId": "590d64de",
  "timestamp": "2026-10-10T13:36:38.359Z",
  "message": {
    "role": "assistant",
    "content": [
      { "type": "toolCall", "id": "tool:1791639398350:su6ofp05vem", "name": "read", "arguments": { "path": "README.md" } }
    ],
    "api": "faux:1791639398323:y48o0wsn36",
    "provider": "faux",
    "model": "faux-1",
    "usage": { "input": 1424, "output": 7, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 1431, "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "stopReason": "toolUse",
    "timestamp": 1791639398350,
    "thinkingLevel": "off"
  }
}
```

| 字段 | 含义 | 来源 |
| --- | --- | --- |
| `type` | 条目类型，`"message"` 表示 `SessionMessageEntry` | 固定值 |
| `id` | 这条条目自己的编号（本次运行中是 8 位十六进制字符串） | `SessionManager.appendMessage` 中的 `generateId` |
| `parentId` | 上一条条目的 `id`；第一条条目为 `null` | `appendMessage` 使用当前叶子 `leafId` |
| `timestamp` | 写入时的 ISO 字符串 | `appendMessage` 中的 `new Date().toISOString()` |
| `message` | 完整的 `AgentMessage`，与内存中的消息相同 | 来自 `message_end` 的同一个对象 |

同一次运行的第一条条目是 `system` 消息，它的 `parentId` 为 `null`。它的内容很长（`sections` 中有提示词和工具说明），本篇不全部展示。`message` 的内部 `timestamp` 是 `1791639398350`，即 `13:36:38.350`；外层 `timestamp` 是 `13:36:38.359`。两者只差 9 毫秒：条目的时间戳在 `appendMessage` 被调用时取得，消息自己的时间戳更早。

#### 事件与条目：为什么恢复只看条目

假设 `read` 工具刚返回，界面已经收到 `tool_execution_end`，然后进程被关掉。下次打开会话时，事件已经发完，没有任何东西能重放它们。恢复依赖的是磁盘上的 `message` 条目。`message_end` 到达时，`AgentSession._handleAgentEvent` 调用 `SessionManager.appendMessage`，工具结果在那一刻就已经写成一行。

所以事件适合显示进度，不适合作为恢复的唯一数据源。

#### 两种时间戳

这是新手最容易弄错的地方：

- 条目的 `timestamp`：ISO 字符串，例如 `"2026-10-10T12:00:00.000Z"`。
- 消息内部的 `timestamp`：Unix 毫秒数，例如 `1733234400000`。

`packages/coding-agent/src/core/messages.ts` 里的 `createBranchSummaryMessage` 用 `new Date(timestamp).getTime()` 把 ISO 字符串转成毫秒，就是这个转换。

### 四种数据的对照

同一次运行中的数据，可以用四列表看清楚。下表中“未发生”表示当前步骤中该类数据还没有产生。

| 步骤 | 模型消息（发给模型的内容） | 事件（发给订阅者） | AgentState（内存当前值） | 会话条目（写入磁盘） |
| --- | --- | --- | --- | --- |
| 用户输入“读取 README” | `user` 消息 | `message_start`、`message_end`（user） | `messages` 追加 user | `message` 条目 |
| 模型开始说话 | 未定稿，不算历史 | `message_start`、`message_update`（`toolcall_start` 等） | `streamingMessage` 为部分消息 | 无记录 |
| 模型提出调用 `read` | `assistant` 消息，内含 `toolCall` | `message_end`（assistant） | `messages` 追加 assistant，`streamingMessage` 清空 | `message` 条目 |
| 工具执行 | 未发生 | `tool_execution_start`、`tool_execution_end` | `pendingToolCalls` 含该 id，结束后移除 | 无记录 |
| 工具返回 | `toolResult` 消息（`content`） | `message_start`、`message_end`（toolResult） | `messages` 追加 toolResult | `message` 条目 |
| 模型给出总结 | `assistant` 消息（text） | `message_update`（`text_delta` 等），然后 `message_end` | 同上 | `message` 条目 |
| 运行结束 | 未发生 | `agent_end`，然后 `agent_settled` | `isStreaming` 变为 `false` | 无额外条目 |

这张表的关键是“同一个事实，四个视角”：

- 模型只看“模型消息”列，并且只看经过 `convertToLlm` 翻译后的结果。
- 界面只看“事件”列。它可以显示增量，但增量不是历史。
- 进程内的 `AgentState` 保存当前值，它是进程退出后就消失的内存。
- 磁盘只保存“会话条目”列中的完整记录。

用一句话判断：一个数据是否进入下一次模型请求，取决于它是否在模型消息里，而不是它出现在界面上，也不是它写在磁盘上。

可以用四句口诀记住职责：

- **消息**：对模型说的事实；
- **事件**：对界面说的“正在发生什么”；
- **状态**：进程里的“现在”；
- **条目**：磁盘上的“曾经”。

#### 同一轮对话的逐步对照

下面用同一次运行，把每一步的四种数据并排列出。“Message”是模型能看到的形状，“AgentMessage”是内部形状（本例两者相同，因为没有应用角色），“事件”是按顺序发出的事件，“条目”是写入磁盘的 `id`。

| 步骤 | Message（模型消息） | AgentMessage（内部消息） | 事件序列（按发出顺序） | SessionEntry（磁盘条目） |
| --- | --- | --- | --- | --- |
| 1. 用户输入“读取 README” | `user`，文本 | 同一对象，`role: "user"` | `message_start`、`message_end`（user） | `7efe3bd3` 是 system；`590d64de` 是 user，`parentId` 指向 system |
| 2. 模型提出调用 `read` | `assistant`，内容块为 `toolCall` | 同一对象 | `message_start`、`message_update`（`toolcall_start`、`toolcall_delta` 两次、`toolcall_end`）、`message_end`（assistant） | `11297909`，`parentId` 为 `590d64de` |
| 3. 工具执行 | 没有 | 没有 | `tool_execution_start`、`tool_execution_end` | 没有条目，不落盘 |
| 4. 工具返回 | `toolResult`，`content` 为文件全文 | 同一对象 | `message_start`、`message_end`（toolResult） | `af902263`，`parentId` 为 `11297909` |
| 5. 模型给出总结 | `assistant`，文本块 | 同一对象 | `turn_end`（第一轮），`turn_start`，`message_start`、`message_update`（`text_start`、`text_delta`、`text_end`）、`message_end`（assistant） | `904091e4`，`parentId` 为 `af902263` |
| 6. 运行收尾 | 没有 | 没有 | `turn_end`（第二轮）、`agent_end`、`agent_settled` | 没有新条目 |

这张表说明三件事：

- 同一个对象从第 2 步起就同时是 `AgentMessage` 和 `Message`。它被写入磁盘时，内容不做转换，只加上 `id`、`parentId`、`timestamp` 外壳。
- 第 3 步没有任何持久化数据。工具正在执行的状态只在内存的 `pendingToolCalls` 中，进程退出后就没有了。
- 条目的 `parentId` 串起了一条链：`7efe3bd3`、`590d64de`、`11297909`、`af902263`、`904091e4`。这条链就是 `getBranch()` 返回的活动分支。

### 概念 5：什么时候事件会变成消息

`Agent` 类（`packages/agent/src/agent.ts`）负责把事件转成状态。它的私有方法 `processEvents` 处理每个事件：

- `message_start`、`message_update`：把 `streamingMessage` 设为当前部分消息。它们不写入 `messages`。
- `message_end`：清空 `streamingMessage`，并把完成的消息 `push` 到 `messages`。
- `tool_execution_start`、`tool_execution_end`：加入或移除 `pendingToolCalls`。
- `turn_end`：如果助手消息带有 `errorMessage`，记录到 `state.errorMessage`。

所以，“流式期间的消息”只在 `streamingMessage` 里，直到 `message_end` 才进入 `messages`。这条规则在概念 6 和 AgentState 字段中还会用到。

### 概念 6：convertToLlm（翻译桥）

`convertToLlm` 是 `AgentMessage[]` 到 `Message[]` 的转换函数。它是数据从“内部”走向“模型”的桥。

输入是 `AgentMessage[]`，输出是 `Message[]`。`packages/agent/src/types.ts` 的 `AgentLoopConfig.convertToLlm` 注释写明了契约：每次调用模型前都会执行；不能抛出异常，必须返回安全的值。

coding-agent 的实现在 `packages/coding-agent/src/core/messages.ts`，节选如下：

```typescript
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .map((m): Message | undefined => {
      switch (m.role) {
        case "bashExecution":
          if (m.excludeFromContext) return undefined; // !! 前缀：只给用户看
          return { role: "user", content: [{ type: "text", text: bashExecutionToText(m) }], timestamp: m.timestamp };
        case "custom": { /* 字符串内容转成文本块，否则原样 */ }
        case "branchSummary":
          return { role: "user", content: [{ type: "text", text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX }], timestamp: m.timestamp };
        case "compactionSummary":
          return { role: "user", content: [{ type: "text", text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX }], timestamp: m.timestamp };
        case "system":
        case "user":
        case "assistant":
        case "toolResult":
          return m; // 已经是模型消息，原样通过
        default: {
          const _exhaustiveCheck: never = m; // 新增角色却没处理时，这里编译报错
          return undefined;
        }
      }
    })
    .filter((m) => m !== undefined);
}
```

这段代码有三个值得学的地方：

1. **包装标签**。摘要不是裸文本，而是用固定的前缀和后缀包起来。模型因此能分辨“这是历史的压缩”，而不是“用户刚说了一段话”。
2. **穷尽检查**。`default` 分支里的 `never` 类型，让 TypeScript 在编译期发现遗漏的角色。
3. **过滤**。`excludeFromContext` 为真的 bash 记录返回 `undefined`，最后 `filter` 去掉。

#### 一个完整的翻译例子

下面的输入是一段假设的转录，包含 7 条 `AgentMessage`。把它交给 coding-agent 的 `convertToLlm`，得到的输出只含模型能理解的角色。下面的结果来自一次本地运行（临时测试，已删除）。

输入（`AgentMessage[]`，字段做了保留，便于对照）：

```json
[
  { "role": "system", "content": "You are a helper.", "timestamp": 1 },
  { "role": "user", "content": "读取 README", "timestamp": 2 },
  { "role": "bashExecution", "command": "ls", "output": "README.md", "exitCode": 0, "cancelled": false, "truncated": false, "timestamp": 3 },
  { "role": "bashExecution", "command": "echo secret", "output": "secret", "exitCode": 0, "cancelled": false, "truncated": false, "timestamp": 4, "excludeFromContext": true },
  { "role": "custom", "customType": "note", "content": "extension text", "display": true, "timestamp": 5 },
  { "role": "branchSummary", "summary": "tried plan A", "fromId": null, "timestamp": 6 },
  { "role": "compactionSummary", "summary": "older turns", "tokensBefore": 1000, "timestamp": 7 }
]
```

输出（`Message[]`，6 条）：

```json
[
  { "role": "system", "content": "You are a helper.", "timestamp": 1 },
  { "role": "user", "content": "读取 README", "timestamp": 2 },
  { "role": "user", "content": [{ "type": "text", "text": "Ran `ls`\n```\nREADME.md\n```" }], "timestamp": 3 },
  { "role": "user", "content": [{ "type": "text", "text": "extension text" }], "timestamp": 5 },
  { "role": "user", "content": [{ "type": "text", "text": "The following is a summary of a branch that this conversation came back from:\n\n<summary>\ntried plan A</summary>" }], "timestamp": 6 },
  { "role": "user", "content": [{ "type": "text", "text": "The conversation history before this point was compacted into the following summary:\n\n<summary>\nolder turns\n</summary>" }], "timestamp": 7 }
]
```

逐条对照：

| 输入序号 | 输入 | 输出 | 为什么 |
| --- | --- | --- | --- |
| 1 | `system` | 原样通过 | 已是模型消息（`case "system"`） |
| 2 | `user` | 原样通过 | 已是模型消息 |
| 3 | `bashExecution`，没有 `excludeFromContext` | `user`，文本为 ``Ran `ls` `` 加输出 | 调用 `bashExecutionToText` 生成文本 |
| 4 | `bashExecution`，`excludeFromContext: true` | 没有输出 | 返回 `undefined`，最后被 `filter` 去掉（`!!` 前缀） |
| 5 | `custom`，内容是字符串 | `user`，内容变成一个文本块 | 字符串被包成 `{ type: "text", text }` |
| 6 | `branchSummary` | `user`，文本前后加标签 | `BRANCH_SUMMARY_PREFIX` 与 `BRANCH_SUMMARY_SUFFIX` 包住摘要 |
| 7 | `compactionSummary` | `user`，文本前后加标签 | `COMPACTION_SUMMARY_PREFIX` 与 `COMPACTION_SUMMARY_SUFFIX` 包住摘要 |

两个细节：

- 第 4 条被丢掉，所以输出比输入少一条。`convertToLlm` 用 `map` 处理每条消息，被丢弃的消息返回 `undefined`，再用 `filter` 去掉。
- 第 6 条的后缀 `</summary>` 前面没有换行，而第 7 条的后缀前面有换行。这是 `messages.ts` 中两个常量的写法不同，不是翻译逻辑的差别。

#### 谁负责注入 convertToLlm

`convertToLlm` 是 `Agent` 的配置项，不是写死在循环里的。

- `packages/agent/src/agent.ts` 有一个默认实现 `defaultConvertToLlm`。它只保留四种模型角色（`system`、`user`、`assistant`、`toolResult`），其它角色直接丢弃。
- `packages/coding-agent/src/core/sdk.ts` 注入完整版本。它先调用 `convertToLlm`，再包一层 `convertToLlmWithBlockImages`：如果设置了屏蔽图片，就再过滤一次图片块。

两者的区别很重要。默认实现丢弃 `bashExecution`、`custom` 等角色；coding-agent 的版本会把它们转成 `user` 文本，因为这些内容对用户和模型都有用。

`convertToLlm` 还被压缩流程复用。生成摘要本身也要调用模型，所以同一份历史也要经过翻译（`messages.ts` 的注释说明了这一点；压缩流程本身不在本篇展开）。

### 概念 7：AgentState（状态）

`AgentState` 是“进程里现在的值”。它在 `packages/agent/src/types.ts` 中定义。

```typescript
export interface AgentState {
  readonly systemPrompt: string;
  model: Model<any>;
  thinkingLevel: ThinkingLevel;
  set tools(tools: AgentTool<any>[]);
  get tools(): AgentTool<any>[];
  set messages(messages: AgentMessage[]);
  get messages(): AgentMessage[];
  readonly isStreaming: boolean;
  readonly streamingMessage?: AgentMessage;
  readonly pendingToolCalls: ReadonlySet<string>;
  readonly errorMessage?: string;
}
```

字段表：

| 字段 | 类型 | 读写 | 含义 | 何时变化 |
| --- | --- | --- | --- | --- |
| `systemPrompt` | `string` | 只读 | 当前系统提示词 | 由 `messages` 中的系统消息重放得出（`getCurrentSystemPrompt`） |
| `model` | `Model<any>` | 可写 | 下一轮使用的模型 | 切换模型时 |
| `thinkingLevel` | `ThinkingLevel` | 可写 | 下一轮的思考级别 | 切换思考级别时。该类型含 `off`，共 7 个值 |
| `tools` | `AgentTool<any>[]` | 可读写 | 可执行的工具 | 赋值时复制顶层数组 |
| `messages` | `AgentMessage[]` | 可读写 | 对话转录 | 赋值时复制顶层数组；消息结束时追加 |
| `isStreaming` | `boolean` | 只读 | 是否在处理中 | 直到 `agent_end` 的监听器全部结束才变为 `false` |
| `streamingMessage` | `AgentMessage?` | 只读 | 正在形成的部分消息 | `message_start`/`message_update` 设置，`message_end` 清空 |
| `pendingToolCalls` | `ReadonlySet<string>` | 只读 | 正在执行的工具调用 id | `tool_execution_start` 加入，`tool_execution_end` 移除 |
| `errorMessage` | `string?` | 只读 | 最近一次失败或取消的错误文本 | `turn_end` 时从助手消息提取 |

几个要点：

- **`systemPrompt` 是只读的**。想改提示词，要追加一条系统消息（`content` 或 `sections`），不能直接赋值。源码注释里写明了这一点。
- **数组赋值会复制**。给 `tools` 或 `messages` 赋值时，状态保存的是新数组的副本。这样外部代码之后修改自己的数组，不会悄悄改变状态。
- **`isStreaming` 比“模型还在输出”更晚结束**。它要等 `agent_end` 的 `await` 监听器全部完成。

#### 一次运行中 AgentState 的变化

下面的图按时间顺序画出“读取 README”这次运行中状态的变化。箭头左边是事件，右边是这一步之后状态里发生的改动。

```text
用户输入“读取 README”
  |  message_start / message_end (system, user)
  |     -> streamingMessage 先设为 system，再清空
  |     -> messages: [system, user]
  v
助手流式输出 toolCall
  |  message_start            -> streamingMessage = 部分 assistant
  |  message_update x 4       -> streamingMessage 每次被替换
  |  message_end              -> streamingMessage = undefined
  |                           -> messages: [system, user, assistant]
  v
工具执行 read
  |  tool_execution_start     -> pendingToolCalls = {id}
  |  tool_execution_end       -> pendingToolCalls = {}
  v
工具结果
  |  message_start / message_end (toolResult)
  |                           -> messages: [system, user, assistant, toolResult]
  |  turn_end                 -> 第一轮结束（本次没有错误，所以不写 errorMessage）
  v
第二轮：助手流式输出文字
  |  message_start / message_update x 3 / message_end
  |                           -> messages: [system, user, assistant, toolResult, assistant]
  |  turn_end, agent_end      -> isStreaming 仍为 true（监听器尚未结束）
  v
agent_settled                 -> isStreaming = false
```

用表格看同一过程。每一行是一个事件发出后、会话监听器看到的状态（`messages` 是长度，`streaming` 是 `streamingMessage` 的角色）：

| 事件（发出后） | messages 长度 | streaming | pending | isStreaming |
| --- | --- | --- | --- | --- |
| `agent_start` | 0 | - | 0 | true |
| `message_start`（system） | 0 | system | 0 | true |
| `message_end`（system） | 1 | - | 0 | true |
| `message_end`（user） | 2 | - | 0 | true |
| `message_start`（assistant） | 2 | assistant | 0 | true |
| `message_update` 共 4 次（toolcall_*） | 2 | assistant | 0 | true |
| `message_end`（assistant toolCall） | 3 | - | 0 | true |
| `tool_execution_start` | 3 | - | 1 | true |
| `tool_execution_end` | 3 | - | 0 | true |
| `message_start`（toolResult） | 3 | toolResult | 0 | true |
| `message_end`（toolResult） | 4 | - | 0 | true |
| `turn_end`（第一轮） | 4 | - | 0 | true |
| `message_update` 共 3 次（text_*） | 4 | assistant | 0 | true |
| `message_end`（assistant 文字） | 5 | - | 0 | true |
| `agent_end` | 5 | - | 0 | true |
| `agent_settled` | 5 | - | 0 | false |

几点读法：

- `messages` 只在 `message_end` 时增加。流式期间它的长度不变，部分消息只在 `streamingMessage` 中。
- `pendingToolCalls` 在工具执行的两个事件之间非空，之后回到空集合。
- `isStreaming` 在 `agent_end` 监听器运行时仍是 `true`，到 `agent_settled` 才是 `false`。

#### 只有一个状态来源

`AgentSession` 不另外保存一份状态。`packages/coding-agent/src/core/agent-session.ts` 中的 `get state(): AgentState` 直接返回 `this.agent.state`。`model`、`thinkingLevel`、`tools` 等访问器也都读 `this.agent.state`。

排查界面显示问题时，先看 `session.state`；如果状态正确，再看事件是否漏发。

#### 为什么 message_end 要保持同一个对象

`message_end` 之后，扩展可能替换这条消息的内容。如果只让事件里的 `message` 指向新对象，那么：

- `agent.state.messages` 仍然指向旧对象；
- 界面收到的是新对象；
- 磁盘保存的可能是第三个版本。

这会导致“界面看到 A，状态里是 B，磁盘里是 C”。为了避免这种分叉，`AgentSession` 用 `_replaceMessageInPlace` 把替换内容复制到同一个对象上。源码如下（`packages/coding-agent/src/core/agent-session.ts`）：

```typescript
private _replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void {
  if (target === replacement) {
    return;
  }
  const targetRecord = target as unknown as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) {
    delete targetRecord[key];
  }
  Object.assign(targetRecord, replacement);
}
```

这是原地修改，不是新增会话条目。它只影响“首次写入磁盘之前”的那条消息。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径 | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/ai/src/types.ts` | `Message`、`SystemMessage`、`UserMessage`、`AssistantMessage`、`ToolResultMessage`、`StopReason`、`AssistantMessageEvent` | 每个角色的字段；`toolCallId` 与 `id` 的对应；`details` 与 `content` 的区别 |
| 2 | `packages/agent/src/types.ts` | `CustomAgentMessages`、`AgentMessage`、`AgentEvent`、`AgentState` | `CustomAgentMessages` 默认为空；`AgentEvent` 的 10 个成员；`AgentState` 的只读字段 |
| 3 | `packages/agent/src/agent.ts` | `defaultConvertToLlm`、`Agent`、`processEvents` | 默认翻译只保留四种角色；`message_end` 时 `push` 到 `messages` |
| 4 | `packages/coding-agent/src/core/messages.ts` | `BashExecutionMessage`、`CustomMessage`、`BranchSummaryMessage`、`CompactionSummaryMessage`、`convertToLlm` | `declare module` 如何扩展角色；每个角色转换成什么 |
| 5 | `packages/coding-agent/src/core/sdk.ts` | `convertToLlmWithBlockImages` | coding-agent 如何注入翻译函数 |
| 6 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSessionEvent`、`_handleAgentEvent`、`_replaceMessageInPlace`、`get state`、`_runAgentPrompt`、`_emitAgentSettled` | 会话层如何改写 `agent_end`；`message_end` 时何时写入磁盘 |
| 7 | `packages/coding-agent/src/core/session-manager.ts` | `SessionEntryBase`、`SessionEntry`、`SessionMessageEntry`、`ContextEditEntry`、`SessionManager.appendMessage`、`buildSessionContext`、`getBranch` | 条目的公共字段；哪些条目进入上下文；`getBranch` 返回的是哪条路径 |

读的顺序是“类型定义 → 谁创建 → 谁消费”。先看 `types.ts` 里有哪些字段，再找 `processEvents` 或 `_handleAgentEvent` 谁写入它。

## 走读一次完整过程

以“读取 README 并总结”为例，每一步写清楚发生了什么、对应哪个函数、状态有什么变化。

1. **用户输入进入会话。** `AgentSession.prompt(text)`（`packages/coding-agent/src/core/agent-session.ts`）接收输入。会话层的处理由 `_runAgentPrompt()` 负责。此时还没有模型请求。
2. **系统消息与用户消息加入转录。** 第一次运行时，转录里先有一条 `system` 消息（提示词和工具声明），再有一条 `user` 消息。`Agent.processEvents` 对每条消息依次收到 `message_start` 和 `message_end`，`message_end` 时把它 `push` 到 `state.messages`。
3. **模型流式输出工具调用。** 模型产生 `toolcall_start`、`toolcall_delta`、`toolcall_end` 等增量。每个增量作为 `message_update` 发出，`streamingMessage` 保存部分消息，`messages` 不变。
4. **助手消息定稿。** 收到 `message_end`（助手消息，`stopReason` 为 `toolUse`）。`processEvents` 清空 `streamingMessage`，把它追加到 `messages`。随后 `_handleAgentEvent` 在 `message_end` 分支中调用 `SessionManager.appendMessage`，写入一条 `message` 条目。
5. **工具执行。** 发出 `tool_execution_start`，`pendingToolCalls` 加入 `toolCallId`。工具运行结束后发出 `tool_execution_end`，该 id 从 `pendingToolCalls` 移除。这两个事件不会写入磁盘。
6. **工具结果成为消息。** 发出 `message_start`、`message_end`，角色为 `toolResult`。`messages` 追加一条工具结果，磁盘也追加一条 `message` 条目。
7. **第二次模型请求。** 下一轮开始前，`convertToLlm` 把 `messages` 翻译成 `Message[]`。这次请求的转录包含系统消息、user、assistant（toolCall）和 toolResult，模型据此生成总结。
8. **总结流式输出并定稿。** `message_update`（`text_start`、`text_delta`、`text_end`），然后 `message_end`。定稿消息追加到 `messages` 并写入磁盘。
9. **结束。** 依次发出 `turn_end`、`agent_end`，然后 `_emitAgentSettled()` 发出 `agent_settled`。`isStreaming` 在 `agent_end` 监听器结束后变为 `false`。

probe 运行的结果与这个顺序一致（见下面的动手实验）。

## 动手实验

### 实验 1：观察同一次运行的四种视角

- **目的**：看到同一次工具调用在四种数据中各出现在哪里。
- **前提**：已安装依赖（仓库根目录执行过 `npm install --ignore-scripts`）。
- **环境**：使用 faux 假模型，不需要密钥。

**第一步：在系统临时目录创建测试文件。** 下面的内容保存为 `probe.test.ts`。把其中的 `D:/Github/pi` 替换成你的仓库根目录（使用正斜杠）。

```typescript
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "D:/Github/pi/node_modules/vitest/dist/index.js";
import { fauxAssistantMessage, fauxToolCall } from "D:/Github/pi/packages/ai/src/index.ts";
import { createHarness } from "D:/Github/pi/packages/coding-agent/test/suite/harness.ts";

it("probe four views", async () => {
  const h = await createHarness();
  try {
    writeFileSync(join(h.tempDir, "README.md"), "# Demo\nA short paragraph.\n");
    h.setResponses([
      fauxAssistantMessage([fauxToolCall("read", { path: "README.md" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("README 已读取"),
    ]);
    await h.session.prompt("读取 README");
    const eventNames = h.events.map((e) =>
      e.type === "message_update" ? `message_update:${e.assistantMessageEvent.type}` : e.type,
    );
    const deltaText = h.events
      .flatMap((e) =>
        e.type === "message_update" && e.assistantMessageEvent.type === "text_delta"
          ? [e.assistantMessageEvent.delta]
          : [],
      )
      .join("");
    const last = h.session.messages.at(-1);
    const finalText =
      last?.role === "assistant" ? last.content.map((c) => (c.type === "text" ? c.text : "")).join("") : "";
    const out = [
      "MESSAGES " + JSON.stringify(h.session.messages.map((m) => m.role)),
      "EVENTS " + JSON.stringify(eventNames),
      "STATE " + JSON.stringify(h.session.state.messages.map((m) => m.role)),
      "ENTRIES " + JSON.stringify(h.sessionManager.getBranch().map((e) => e.type)),
      "CONTEXT " + JSON.stringify(h.sessionManager.buildSessionContext().messages.map((m) => m.role)),
      "DELTA_JOINED " + JSON.stringify(deltaText),
      "FINAL_TEXT " + JSON.stringify(finalText),
    ];
    writeFileSync(join(tmpdir(), "pi-task03-out.txt"), out.join("\n") + "\n");
    expect(deltaText).toBe(finalText);
  } finally {
    h.cleanup();
  }
});
```

**第二步：运行（工作目录为 `packages/coding-agent`）。**

PowerShell：

```powershell
Set-Location D:\Github\pi\packages\coding-agent
$probe = Join-Path $env:TEMP "pi-task03-probe"
New-Item -ItemType Directory -Force $probe | Out-Null
# 把上面的代码保存为 $probe\probe.test.ts 后执行：
node ../../node_modules/vitest/dist/cli.js --run --root $probe (Join-Path $probe "probe.test.ts")
Get-Content (Join-Path $env:TEMP "pi-task03-out.txt")
Remove-Item -Recurse -Force $probe, (Join-Path $env:TEMP "pi-task03-out.txt")
```

bash（Git Bash，Windows；Linux 或 macOS 把 `TMPD` 换成 `$(node -p "require('os').tmpdir()")`）：

```bash
cd "$(git rev-parse --show-toplevel)/packages/coding-agent"
TMPD="$(cygpath -m "$TEMP")"
PROBE="$TMPD/pi-task03-probe"
mkdir -p "$PROBE"
# 把上面的代码保存为 "$PROBE/probe.test.ts" 后执行：
node ../../node_modules/vitest/dist/cli.js --run --root "$PROBE" "$PROBE/probe.test.ts"
cat "$TMPD/pi-task03-out.txt"
rm -rf "$PROBE" "$TMPD/pi-task03-out.txt"
```

**预期输出**（本地运行得到的 `pi-task03-out.txt` 内容）：

```text
MESSAGES ["system","user","assistant","toolResult","assistant"]
EVENTS ["agent_start","turn_start","message_start","message_end","message_start","message_end","message_start","message_update:toolcall_start","message_update:toolcall_delta","message_update:toolcall_delta","message_update:toolcall_end","message_end","tool_execution_start","tool_execution_end","message_start","message_end","turn_end","turn_start","message_start","message_update:text_start","message_update:text_delta","message_update:text_end","message_end","turn_end","agent_end","agent_settled"]
STATE ["system","user","assistant","toolResult","assistant"]
ENTRIES ["message","message","message","message","message"]
CONTEXT ["system","user","assistant","toolResult","assistant"]
DELTA_JOINED "README 已读取"
FINAL_TEXT "README 已读取"
```

注意两点：

- `toolcall_delta` 的数量每次运行可能不同。本地两次运行分别得到一次和两次。这是流式分块的正常变化，不影响结论。
- 测试里的 `expect(deltaText).toBe(finalText)` 通过，说明把所有 `text_delta` 拼起来，与最终助手消息的文字一致。

**结果解读**：

- `MESSAGES` 比用户输入多一个 `system`。提示词和工具声明也是一条消息，它进入转录，也进入会话条目。
- `EVENTS` 中，`tool_execution_*` 出现在 `message_end`（助手 toolCall）之后、toolResult 之前。事件不包含历史，只是过程。
- `ENTRIES` 有五条 `message`，没有 `session` 头（`getBranch()` 不返回文件头）。
- `CONTEXT` 与 `ENTRIES` 的角色顺序相同。本次运行中没有压缩或省略，所以投影结果与原始条目一致。

### 实验 2：事件折叠（手工拼接增量）

- **目的**：理解“界面能显示增量，但完整消息要等 `message_end`”。
- **步骤**：读实验 1 的 `DELTA_JOINED` 和 `FINAL_TEXT`。
- **预期**：两者都是 `"README 已读取"`。

如果把最后一个 `message_end` 从事件列表中去掉，界面仍能显示文字（已经收到的 `text_delta` 都在），但是无法确认最终消息的 `stopReason` 和 `usage`。这些字段只在 `message_end` 携带的完整 `AssistantMessage` 里。

错误或取消属于另一种终态：`AssistantMessage.stopReason` 为 `error` 或 `aborted`，并带 `errorMessage`。`AgentState.errorMessage` 在 `turn_end` 时从这条消息提取。

### 实验 3：读代码填表（不需要运行）

- **目的**：练习判断一个数据属于哪一类。
- **步骤**：在下面的表中，为每一行填写“是否落盘”“是否发给模型”“是否只在内存中”。

| 数据 | 是否落盘 | 是否发给模型 | 只在内存中 |
| --- | --- | --- | --- |
| 用户的一条 `user` 消息 | | | |
| 一个 `text_delta` 事件 | | | |
| `AgentState.streamingMessage` | | | |
| `tool_execution_start` 事件 | | | |
| 一条 `bashExecution` 消息（未带 `!!`） | | | |
| 一条 `compaction` 条目 | | | |

答案见自测题的参考答案。

## 自测题

1. 一条 `bashExecution` 消息（没有 `!!` 前缀）会被发给模型吗？它以什么角色出现？它会写入磁盘吗？
2. `ToolCall.id` 与 `ToolResultMessage.toolCallId` 是什么关系？如果二者不一致，会发生什么？
3. 为什么 `message_update` 中的 `partial` 或 `streamingMessage` 不能当作历史保存？应该以哪个事件为准？
4. `agent_end` 与 `agent_settled` 有什么区别？一次 `session.prompt()` 中，哪一个可能出现多次？
5. `AgentState.systemPrompt` 为什么是只读的？想修改提示词应该怎么做？

### 参考答案

1. 会。它被 `convertToLlm` 转成 `role: "user"` 的文本，内容是 `Ran ...` 形式的命令和输出。它写入磁盘，作为 `message` 条目。只有带 `!!` 前缀（`excludeFromContext` 为真）的 bash 记录才会被丢弃，不发给模型。
2. 一一对应。工具结果的 `toolCallId` 必须等于调用的 `id`。不一致时，历史里的结果找不到对应调用，部分供应商会拒绝请求，或模型无法把结果和调用联系起来。
3. 流式过程中的消息还不完整，内容可能会变。历史以 `message_end` 带来的终态消息为准。`streamingMessage` 只在内存中，`message_end` 时被清空。
4. `agent_end` 是一次 Agent 运行的循环结束，因为自动重试可能多次出现。`agent_settled` 是会话层全部工作结束（包括重试、压缩），每次 `prompt()` 只发一次。
5. 提示词由转录中的系统消息重放得出，不是独立保存的字符串。直接赋值会破坏“转录是唯一来源”的规则。要修改提示词，应追加一条带 `content` 或 `sections` 的系统消息。

## 常见错误

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 界面把流式文字当成历史，重启后文字不完整 | 把 `message_update` 的 `partial` 当成完整消息保存 | 历史以 `message_end` 的终态消息为准 |
| 以为所有 `role: "user"` 都是人打的字 | `bashExecution`、`custom`、`branchSummary`、`compactionSummary` 都在模型侧被转成 `user` | 看原始角色（`AgentMessage` 中的 `role`），再看 `convertToLlm` 如何转换 |
| 把条目的时间戳和消息的时间戳混用 | 条目 `timestamp` 是 ISO 字符串，消息 `timestamp` 是毫秒数字 | 比较时间前先统一格式；注意 `new Date(...).getTime()` 的转换 |
| 给 `session.state.systemPrompt` 赋值，期望立即生效 | 该字段是只读的，且由系统消息重放得出 | 追加系统消息（`content` 或 `sections`），而不是直接赋值 |
| 把 `agent_end` 当成“会话彻底结束” | 自动重试时同一次 `prompt()` 会有多个 `agent_end` | 等待 `agent_settled`，它只在会话层全部工作结束后发出一次 |

## 选读：源码深入（可选，放在文件最后）

选读，跳过不影响主线。

### 选读 A：ToolResultMessage 的 details 与 structuredContent

`AgentToolResult`（`packages/agent/src/types.ts`）有 `content`、`details`、`structuredContent?`、`usage?`、`isError?`、`terminate?`。其中：

- `content` 发给模型；
- `details` 给界面和扩展；
- `structuredContent` 给程序化调用者，并且要符合工具的 `outputSchema`。

`structuredContent` 不会进入 `ToolResultMessage`，所以它不保证会被保存到会话里。后置钩子（`afterToolCall`）如果只提供 `content`、不提供 `structuredContent`，旧的结构化数据会被丢弃，这是注释里明确写的规则。

### 选读 B：context_edit 与模型投影

会话文件是追加写入的。如果要让模型“看不到”某条已保存的回答，不能删除那一行，而是追加一条 `context_edit`：

```json
{"type":"context_edit","id":"e1","parentId":"m1","targetId":"m1","replacement":null}
```

- `getBranch()` 或原始条目仍然包含 `m1`；
- 投影（`buildSessionProjection`，位于 `packages/coding-agent/src/core/session-manager.ts`）会跳过 `m1` 的内容；
- 后续模型请求看不到这条回答。

`replacement` 为 `null` 表示省略；为 `{ content: ... }` 表示只替换内容。`SessionManager.appendContextEdit(targetId, replacement)` 在 `packages/coding-agent/src/core/session-manager.ts` 中定义；`AgentSession` 在多处调用它。

区分两种“替换”：

| 机制 | 改的是什么 | 是否追加新条目 |
| --- | --- | --- |
| `_replaceMessageInPlace` | 内存里的同一个消息对象 | 否，首次写入前完成 |
| `appendContextEdit` | 不改原消息，追加一条规则 | 是 |

### 选读 C：SystemMessage 的 replace 字段

旧笔记称 `packages/coding-agent/docs/message-types.md` 描述了 `replace: true`（丢弃之前的状态，建立新基线）。本次没有核对那份文档。但 `packages/ai/src/types.ts` 的 `SystemMessage` 中没有 `replace` 字段，因此源码中不存在这个选项。读的时候以类型定义为准。

### 选读 D：JSON 线上事件

`packages/coding-agent/src/modes/rpc/rpc-mode.ts` 中，每个会话事件在输出前都经过 `toJsonEvent`（导入自 `../json-event.ts`，即 `packages/coding-agent/src/modes/json-event.ts`）。线上事件比内存事件更瘦，例如不带累积的 `partial`。具体字段规则属于 SDK 与 RPC 模式，本篇不展开。

### 选读 E：entry_appended 不是通用落盘通知

`AgentSessionEvent` 有 `entry_appended`。本次核对中，它在 context edit 的写入路径（`appendContextEdit` 之后）、缓存预热（cache warmer）的回调里、以及部分条目写入路径中被发出。它不是“文件新增了一行”的通用通知。普通助手或工具结果的 `message_end` 持久化路径，本次没有逐行确认是否发出它，不要依赖这一点。

## 下一篇

下一篇是模型与供应商。本篇讲的是“消息长什么样”。下一篇解决：这些模型消息如何被转换成具体供应商的请求格式，以及供应商返回的流式增量如何变成 `AssistantMessageEvent`。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| 模型消息（Message） | 供应商能理解的四种角色消息的联合类型 | 先用一个例子理解 |
| 内容块（content block） | 消息内容的最小单元：text、image、thinking、toolCall | 概念 1 |
| 判别字段（discriminant） | 用来区分联合类型成员的字面量字段，如 `role`、`type` | 概念 1 |
| Agent 消息（AgentMessage） | pi 内部的消息类型，模型消息加上应用角色 | 概念 2 |
| 声明合并（declaration merging） | 用同名接口扩展已有类型的 TypeScript 机制 | 概念 2 |
| 事件（AgentEvent） | 过程通知，只在发出时有效，不保存 | 概念 3 |
| 会话事件（AgentSessionEvent） | `AgentSession` 对外发出的事件，在 AgentEvent 基础上增加会话级事件 | 概念 3 |
| 流式增量（delta） | 流式输出中的一小段内容，如 `text_delta` 的 `delta` 字段 | 概念 3 |
| 会话条目（SessionEntry） | 写入会话文件的一行记录，带 `id` 与 `parentId` | 概念 4 |
| 活动分支（active branch） | 从根到当前叶子的一条路径，`getBranch()` 返回的内容 | 概念 4 |
| 翻译（convertToLlm） | 把 `AgentMessage[]` 转换成 `Message[]` 的函数 | 概念 6 |
| 状态（AgentState） | 进程里当前的模型、工具、消息等值，退出后消失 | 概念 7 |
| 只读字段（readonly） | 只能读取、不能赋值的属性 | 概念 7 |
| 原地替换（in-place replacement） | 保持同一个对象的身份，只改它的字段内容 | 概念 7 |
| 投影（projection） | 从原始条目计算出“模型实际看到的内容”的过程 | 选读 B |
