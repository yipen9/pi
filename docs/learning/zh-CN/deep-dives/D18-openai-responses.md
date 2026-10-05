# D18：OpenAI Responses 事件流与输出槽位

> 精读对象：`packages/ai/src/api/openai-responses.ts` 的 `stream`、`buildParams`、`createClient`；`packages/ai/src/api/openai-responses-shared.ts` 的 `processResponsesStream`、输出槽位、终态与 stop reason 映射。
>
> 对应主线：第 4、5、6、7 章；与 D17 Anthropic SSE provider 对照阅读。
>
> 基线：`200387122ca450d6387f033949423114a270b96c`。本文围绕关键状态与边界解释，不重复请求参数中每个兼容开关。

## 0. 与 D17 的关系

Anthropic provider 自己实现了 SSE 行解码；OpenAI Responses provider 使用 OpenAI SDK 的异步事件流。两者传输细节不同，最终都要实现相同的 pi 契约：`AssistantMessageEventStream` 中产生统一事件，并在结束时填好一个 `AssistantMessage`。

| 问题 | Anthropic（D17） | OpenAI Responses（本文） |
|---|---|---|
| 谁解析 SSE 字节和行 | pi 的 `iterateSseMessages` | OpenAI SDK |
| provider 收到什么 | `{ event, data }` 再 parse JSON | 已解析的 `ResponseStreamEvent` |
| 活跃内容定位方式 | provider block `index` | `output_index` |
| 整轮终态事件 | `message_stop`，并检查 start/stop 完整性 | `response.completed` 或 `response.incomplete` |
| 工具参数结束信号 | `content_block_stop` | `response.output_item.done` |
| 统一层职责 | 翻译成 pi 事件、维护累积消息 | 翻译成 pi 事件、维护输出槽位和最终态 |

【术语】这里的“输出槽位”（slot）是一个很小的索引表：Responses API 的事件用数字 `output_index` 指明是哪一项输出；pi 消息则把内容按数组顺序放进 `output.content`。槽位保存二者之间的对应关系。

## 1. 从 API provider 进入共享处理器

### 1.1 外层 `stream` 管请求生命周期

`openai-responses.ts` 的 `stream` 和 Anthropic 外层结构相似：同步创建 `AssistantMessageEventStream`，异步创建请求并消费 provider stream，然后返回流对象。

```text
resolveTranscript
  → 初始化 output（stopReason=pending）
  → 解析 key / cache / compatibility
  → createClient
  → buildParams
  → onPayload
  → responses.create(...).withResponse() + retryProviderRequest
  → onResponse
  → push start
  → processResponsesStream(openaiStream, output, stream, model)
  → 检查取消和 stopReason
  → push done；异常则 push error
```

`withResponse()` 同时给出 SDK 的异步事件流和原始 HTTP response metadata，所以 `onResponse` 能先看到 HTTP status/headers，再开始消费 provider 事件。

与 Anthropic 一样，SDK 的重试设为 `maxRetries: 0`，实际重试统一由 `retryProviderRequest` 处理。这样不会把 SDK 内部重试与 pi 层重试叠加。

### 1.2 API key 占位值不是认证凭据

`getClientApiKey` 的规则是：

1. 有 `apiKey` 就用它；
2. 没 key，但请求 headers 已经带 `authorization` 或 `cf-aig-authorization`，给 SDK 一个占位 key，避免 SDK 在客户端构造时拒绝；
3. 两者都没有则立即抛出 `No API key for provider`。

占位字符串 `"unused"` 不能被解释成真正发给服务器的 credential。调用方显式提供的 headers 才是请求认证来源。

`createClient` 先设置 User-Agent、model headers、Copilot 动态 headers 和 session affinity headers，最后合并调用选项 headers，因此调用选项可覆盖默认值。OpenRouter 与 OpenAI-compatible gateway 使用不同的 session header 格式。

### 1.3 `buildParams` 翻译 transcript

响应 API 的请求主干很短：

```typescript
// 结构示意：buildParams 还会按兼容能力增加可选字段。
const params: ResponseCreateParamsStreaming = {
  model: model.id,
  input: messages,
  stream: true,
  store: false,
};
```

其余字段根据模型兼容能力和选项添加：tools、reasoning、service tier、max output tokens、sampling 参数等。

几个对读码有帮助的设计点：

- `convertResponsesMessages` 把 pi transcript 转成 Responses 的 `input` 项；它与 D17 的 `convertMessages` 目标结构不同。
- `resolveTranscriptTools` 可能把“当前请求直接提供的工具”和“动态追加/搜索的工具能力”分开处理。
- ChatGPT Sign In 某些调用不接受的字段会被显式省略；这属于 credential/mode 差异，不是一般 OpenAI API 的默认行为。
- `max_output_tokens` 最小值钳制到 16，因为接口拒绝低于该值。钳制是 API 约束的实现，不表示模型一定会输出 16 个 token。
- reasoning effort 通过 `model.thinkingLevelMap` 映射供应商级别；适配器最终要保留统一的调用选项，但线上字段服从 provider 的词表。
- `samplingParams` 最后合并，因此模型定义和显式采样参数可以覆盖之前生成的命名参数。

【陷阱】配置对象的“默认”“兼容默认”“供应商参数”分散在 `getCompat`、`buildParams`、`resolveSamplingParams`。定位字段不生效时，沿这三处追踪最终 `params`，不要只看 CLI option 是否解析到了。

## 2. 为什么共享处理器需要输出槽位

Responses 事件的 `output_index` 指明事件属于哪个 response output item。文本、reasoning、多个 function call 可以交错到达。pi 侧每个 block 则被追加进 `output.content`，以数组下标作为 `contentIndex`。

```typescript
type ResponsesOutputSlot =
  | { type: "thinking"; block: ThinkingContent; contentIndex: number }
  | { type: "text"; block: TextContent; contentIndex: number }
  | { type: "toolCall"; block: StreamingToolCall; contentIndex: number };

const outputSlots = new Map<number, ResponsesOutputSlot>();
```

例子：

```text
provider output_index 4 -> pi contentIndex 0 -> text block
provider output_index 7 -> pi contentIndex 1 -> toolCall block
provider output_index 9 -> pi contentIndex 2 -> thinking block
```

`getSlot(output_index, "toolCall")` 还会核对槽位类型。若事件类型说“这是工具参数增量”，但该 index 的槽不是工具调用，就忽略不匹配输入，而不是把 delta 塞入错误内容块。

【新手 TS 提示】`ResponsesOutputSlot` 是判别联合类型。`slot.type === "toolCall"` 后，TypeScript 才允许访问工具块需要的字段；`Map<number, ResponsesOutputSlot>` 表示 map 的 key 是数字、value 是上述三种对象之一。

### 2.1 `response.output_item.added` 建立 pi block

`createSlot(outputIndex, item)` 根据 item 类型做第一次转换：

- `reasoning` 创建空的 `ThinkingContent`，保存槽位，push `thinking_start`；
- `message` 创建空 `TextContent`，push `text_start`；
- `function_call` 创建 `ToolCall`，并保存 `partialJson` scratch string，push `toolcall_start`；
- `custom_tool_call` 创建特殊参数收集状态，并同样映射成统一 `toolCall`。

响应项不是“先完整收完再一次性创建”。start 事件先创建部分 block，随后的 delta 不断更新同一对象，消费者可以实时显示进度。

### 2.2 为什么工具调用 ID 拼接两部分

函数调用块 id 是 `` `${item.call_id}|${item.id}` ``：`call_id` 标识对话中的调用，`item.id` 标识 Responses 输出项。把二者保留下来，能在同一消息里维持 provider 需要的关联信息；转换回请求时再按协议还原。

后续 `convertResponsesMessages` 会在竖线处分回 `call_id` 与 item id，并按当前模型与工具类型决定是否保留 item id。工具调用 ID 会进入会话记录与后续 message conversion，变化属于跨轮协议行为；不要擅自删除分隔符或只留一半。

## 3. delta：多个事件名汇入统一消息块

### 3.1 文本与拒绝文本

`response.output_text.delta` 与 `response.refusal.delta` 都追加到当前 text slot，并发出 `text_delta`。上层 UI 和 Agent 只需要处理统一文本事件，不需要为了拒绝内容增加新的字符串渲染协议。

事件处理顺序通常是：

```text
找 slot → 修改 slot.block.text → push 统一增量（contentIndex + delta + partial）
```

这与 D17 相同：先更新共享 accumulator，再 push 事件，保证监听器读取 `partial` 时看到当前增量。

### 3.2 Reasoning summary 和 reasoning text

Responses 有 `response.reasoning_summary_text.delta`、`response.reasoning_summary_part.done`、`response.reasoning_text.delta` 等事件。它们都映射成 pi 的 `thinking_delta`。

`reasoning_summary_part.done` 会额外追加两个换行符作为段落分隔。这是把 Responses 的分段语义展平到 pi thinking string 的选择。若移除，会改变 UI/持久化内容的分段可读性。

最终 `response.output_item.done` 会用完整 item 里的 summary 或 content 覆盖累积文本，并保存完整 reasoning item 的 JSON 到 `thinkingSignature`。签名是后续请求重放的重要供应商元数据，不等同于屏幕展示的思考文本。

## 4. 工具 JSON：delta 不是执行许可

### 4.1 函数参数的增量与 done

`response.function_call_arguments.delta` 到达时：

1. 通过 `output_index` 找到工具 slot；
2. 把字符串片段追加到 `partialJson`；
3. 调 `parseStreamingJson` 尽量得到当时可解析的 arguments；
4. 发 `toolcall_delta` 给观察者。

`response.function_call_arguments.done` 会收到完整 arguments 字符串。实现先记下以前的前缀，再用完整文本替换 scratch buffer。如果最终文本以已观察前缀开头，只把缺少的尾段作为额外 delta 推出；如果两者不是前缀关系，不伪造一个拼接增量。

但 `function_call_arguments.done` 仍不是整个 output item 的终点。真正 finalize 在 `response.output_item.done`：此时解析最终 item.arguments、去掉 `partialJson`、发 `toolcall_end`、删除该 index 的活动 slot。

### 4.2 自定义工具 input

Responses custom tool call 的输入是文本，不一定是 JSON object。pi 仍要交给统一 Agent 工具系统一个 arguments 对象，因此处理器使用 `grammarToolInputProperties` 确定承载字段名（默认 `input`），再通过 `appendGrammarToolInputJsonDelta` 生成满足结构的 JSON 增量。

也就是说 `customInput` 是转换过程的 scratch state；它不应出现在最终保存消息中。`output_item.done` 时处理器补齐 input、删除 scratch 字段、发 `toolcall_end`。

【陷阱】不能假定所有 Responses tool call 参数都是一个逐片 JSON object。custom tool 的协议输入与 function call arguments 不同，共享处理器需要两个解析分支。

### 4.3 为什么必须拒绝未完成的工具调用

provider stream 结束后，如果最终 stop reason 是 `toolUse`，处理器会检查每个工具块：

```typescript
if (toolCall.partialJson !== undefined || toolCall.customInput !== undefined) {
  throw new Error(`... unfinished tool call ...`);
}
```

原因是 Agent 会对最终消息里的每个 toolCall 执行本地工具。若 `output_item.done` 缺失，arguments 可能被截断，或者在缺失 `output_index` 的非合规服务端响应里串到另一调用。把这种调用交给 Agent 就会把不完整协议数据变成真实文件读写/命令执行。

因此这是行为安全边界，不是为了让流“更严格好看”。测试 `openai-responses-terminal-event.test.ts` 覆盖未完成调用与并行调用缺 index 的拒绝行为。

## 5. 多层终态：item 结束与 response 结束不同

这套协议至少有两种结束：

1. `response.output_item.done`：一个 text/reasoning/tool item 完成。
2. `response.completed` 或 `response.incomplete`：整个 response 进入终态。

还有 `response.failed`，它直接带失败详情并转成异常。整个事件流如果只是 EOF、没有 response terminal event，处理器抛出 `OpenAI Responses stream ended before a terminal response event`。

```text
response.output_item.added
  → ... item delta ...
  → response.output_item.done      # 单项完成
  → 其他 output items...
  → response.completed             # 整个回答完成
```

【陷阱】不能把 SDK async iterator 正常结束等同于 API response 成功。iterator 只是“没有更多事件”，业务协议仍可能缺少终态。处理器用 `sawTerminalResponseEvent` 检查这个差别。

### 5.1 message phase 会先给临时 stopReason

当 `response.output_item.added/done` 上的 message phase 是 `final_answer`，`applyMessagePhaseStopReason` 会暂时把 `output.stopReason` 设成 `stop`。后续 `response.incomplete` 仍可把它覆盖成 `length` 或 `error`。

这表示增量监听器观察到的 `partial.stopReason` 可能是暂定值；最终决定由 response terminal event 再次裁决。`openai-responses-terminal-event.test.ts` 中有“provisional final answer 被 incomplete 原因替换”的测试。

### 5.2 `response.completed` / `response.incomplete` 统一结算

`finalizeResponse` 最终处理：

- response id；
- reasoning signature 的 terminal backfill；
- usage 字段与 cache token 拆分；
- 模型成本与 service tier 倍率；
- status 与 incomplete reason 到 pi stop reason 的映射；
- 如果 stop status 是 stop 但内容含 tool call，则更正成 `toolUse`。

OpenAI 的 `input_tokens` 包含 cached 和 cache-write token，因此 pi 的普通 input 要做减法：

```text
pi input = max(0, provider input_tokens - cached_tokens - cache_write_tokens)
pi cacheRead = cached_tokens
pi cacheWrite = cache_write_tokens
```

`reasoning_tokens` 是 output 的子集，不应再叠加到 output 上。`total_tokens` 直接取 provider 的总值。

### 5.3 stop reason 映射

| Responses status | incomplete reason | pi stopReason |
|---|---|---|
| `completed` | 任意/无 | `stop` |
| `incomplete` | `max_output_tokens` | `length` |
| `incomplete` | 其他已知或未知字符串 | `error`，保留原因 |
| `failed` / `cancelled` | - | `error` |
| 无 status | - | `stop`（函数的 best-effort 缺省） |

这里 `queued`、`in_progress` 也映射为 `stop`，代码注释称其为特殊情况。注意：外层还要求 terminal event，而共享函数中的 status 映射只决定结果字段；不要把这张表误读成这些状态就一定代表整次请求正常完成。

## 6. reasoning signature 的补齐

Azure OpenAI 可能在 `response.output_item.done` 的 reasoning item 中省略 `encrypted_content`，但在 terminal response 的 `response.output` 中才提供。处理器先按 reasoning item id 保存 thinking block：

```typescript
const reasoningBlocksById = new Map<string, ThinkingContent>();
```

最终 response 到达时，`backfillReasoningSignatures` 遍历 terminal output：

1. 只处理带 `encrypted_content` 的 reasoning item；
2. 按 id 找到此前已经结束的 thinking block；
3. 解析已有 signature；
4. 若已有内容没有 encrypted value，把 terminal value 补入并重新序列化。

为什么要在最终事件修补已结束 block？Responses 请求常用 `store: false`，后续对话不能简单依赖服务器保存上一轮 response；pi 必须保留可重放所需的 reasoning signature。否则界面看到回答结束了，但下一轮发回供应商的 reasoning history 可能不完整。

【陷阱】signature 是 provider replay metadata，不是用户可见的 thinking 文本。改写 `thinkingSignature` 不能只做 UI 层快照测试，还要考虑下一轮 `convertResponsesMessages` 如何重放。

## 7. 错误清理与终态统一

`processResponsesStream` 抛错后回到外层 `stream` 的 `catch`。外层清理 output 中的 `index`、`partialJson`、`customInput`，设置 `stopReason` 为 `aborted` 或 `error`，格式化 provider error，再 push 统一 error event 并 end。

这与正常 `output_item.done` 路径的清理形成双保险：

- 正常完成：在 item 完成处清理对应 block；
- 请求失败、取消、断流：在外层 catch 清理所有剩余 scratch state。

`normalizeProviderError` 与 `formatProviderError` 负责把 SDK 错误变成可读、相对稳定的错误文本；ChatGPT Sign In 的 subscription usage limit 错误会补充 usage URL。

【陷阱】不要在共享处理器 catch 并静默继续。缺失终态、坏工具参数或 provider failure 应传播到外层统一错误出口；吞掉错误会让 Agent 误以为 response 正常完成。

## 8. 端到端工具轨迹

```text
OpenAI Responses stream:
  response.created(response id)
  response.output_item.added(output_index=2, function_call)
  response.function_call_arguments.delta(...)
  response.function_call_arguments.done(...)
  response.output_item.done(output_index=2, function_call)
  response.completed(response.status=completed)

pi shared processor:
  保存 response id
  创建 toolCall block 与 slot
  累积 partialJson / arguments
  确认完整 item，清 scratch buffer，发 toolcall_end
  根据 terminal response 填 usage 与 stopReason
  将含 toolCall 的 stop 修正为 toolUse

Agent loop:
  收到最终 assistant message
  匹配本地工具，验证参数，执行工具
  把工具结果加进 transcript
  发起下一次模型请求
```

Responses 的 API 可能把 message 和 tool call 作为不同 output item 并行排列。`contentIndex` 按 pi block 创建顺序分配；`output_index` 负责把后续 delta 路由回正确的 item。

## 9. 推荐源码阅读路线

1. `packages/ai/src/api/openai-responses.lazy.ts` → `openaiResponsesApi`：provider lazy wrapper。
2. `packages/ai/src/api/openai-responses.ts` → `stream`：认证、client、HTTP、重试、终态出口。
3. 同文件 → `buildParams`：请求消息、tools、reasoning、cache 和 sampling。
4. `packages/ai/src/api/openai-responses-shared.ts` → `processResponsesStream`：事件 reducer 主体。
5. 同文件 → `createSlot`、`getSlot`、`getOrCreateSlot`：output_index 与 contentIndex 对照。
6. 同文件 → `finalizeResponse`、`backfillReasoningSignatures`、`mapStopReason`：终态结算。
7. `packages/ai/test/openai-responses-terminal-event.test.ts`：EOF、未完成工具、终态、phase、usage。
8. `packages/ai/test/openai-responses-partial-json-cleanup.test.ts`：参数增量与 scratch 清理。
9. 回到 `packages/agent/src/agent-loop.ts`：统一 toolcall_end 之后的执行边界。

## 10. 测试证据怎么读

这组测试直接把 `ResponseStreamEvent` 作为 async iterable 交给 `processResponsesStream`，并用 mock OpenAI SDK 测外层 wrapper。核心覆盖包括：

- provider iterator 结束但没有 terminal response event；
- terminal response 有未结束的 function call；
- 并行工具事件缺少 `output_index`，不应混合或误执行；
- provider callback 按顺序被 await；
- `final_answer` phase 暂时改变 stopReason；
- `response.incomplete` 覆盖 provisional stop；
- completed/incomplete usage 与 cache token 账目；
- failed event 将 provider error 传播到外层 error event；
- `partialJson` 在 output item 完成后被移除。

这些测试不要求真实模型。它们测试的是协议 reducer 与 wrapper 行为；不能据此推断所有真实供应商 gateway 都严格遵守 Responses event order。

## 11. 练习

### 练习 A：手算槽位映射

事件依次创建 `output_index=3` 的 reasoning、`output_index=8` 的 function call、`output_index=10` 的 text。假设按此顺序 push 到 pi content：写出各自 `contentIndex`。

答案：3→0、8→1、10→2。provider index 与数组下标不是同一个编号。

### 练习 B：识别两种终止

若收到 `response.output_item.done`，但没有 `response.completed/incomplete` 后 iterator EOF，结果是什么？

答案：共享处理器看到没有 terminal response event 会抛错，外层将结果转换成统一 error event。item 完成不代表整次 response 完成。

### 练习 C：为何不运行半截工具参数

一个 function call 有 `toolcall_start` 和多次 delta，却没有 `output_item.done`；最终 response 表明有 tool call。解释为何必须失败。

答案：参数是否完整不可证明；Agent 会把最终 toolCall 交给本地工具执行，继续运行可能把损坏的 provider 流变成错误的文件或命令操作。

### 练习 D：写出最小新增回归

要修复并行调用缺 index 的问题，测试输入应该包含几个 call？应断言什么？

答案：至少两个 call 共用缺失/冲突的索引条件；断言 reducer 抛出未完成调用错误或外层得到 error 终态，并确认没有构造出可被执行的混合参数。测试应固定 event sequence，不依赖真实网络时序。

## 12. 本篇事实与验证边界

- **静态核对**：符号、状态流转、参数清理与测试类别均依据当前源码和测试文件阅读。
- **未运行**：本篇没有运行相关 Vitest 文件，因此没有声称测试通过。
- **离线条件**：协议 reducer 测试可使用 async generator 和 SDK mock，不需要 API key 或模型调用。
- **平台**：代码使用 Node/Fetch 与 SDK；本篇没有声称三平台分别实测。

## 13. 小结

OpenAI Responses provider 的主要难点不是自己拆 SSE 行，而是将 SDK 解码出的异步事件安全地折叠成一条 pi 消息：

```text
ResponseStreamEvent
  → output_index 槽位
  → 增量更新 content block
  → output_item.done 清理单项状态
  → response.completed/incomplete 结算整轮
  → AssistantMessageEventStream done/error
```

与 D17 对照：provider-specific wire protocol 可以完全不同，但 provider adapter 对上层承诺的 pi event/message 契约保持一致。修复这类代码时，先区分传输解析、单项生命周期、整轮终态、Agent 工具执行四层。

> D18 完。下一篇可以转向扩展 loader 的失败隔离和 reload 生命周期，或继续补齐 AI 包中其他 API 的对照表。
