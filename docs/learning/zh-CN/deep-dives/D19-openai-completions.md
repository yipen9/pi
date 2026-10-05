# D19：OpenAI Chat Completions 流式适配器

> 精读对象：`packages/ai/src/api/openai-completions.ts` 的 `stream`、`buildParams`、流式 block 累积、`finishBlock`、`mapStopReason`；对应消息转换函数 `convertMessages` 与测试。
>
> 对应主线：第 4、5、6、7 章。先读 D17 和 D18，再读本篇，可以比较三种协议如何被统一成 pi 的消息与事件。
>
> 基线：`200387122ca450d6387f033949423114a270b96c`。代码片段均为说明性的节选。

## 0. Chat Completions 与 Responses 有什么不同

Chat Completions 的历史形状是 `messages`，流中的数据通常是 `ChatCompletionChunk`。每个 chunk 的 `choices[0].delta` 携带当前轮次新来的片段；最后用 choice 的 `finish_reason` 表示完成方式。与 Responses 对照：

| 维度 | Chat Completions（本篇） | Responses（D18） |
|---|---|---|
| 请求历史字段 | `messages` | `input` |
| 流的增量单位 | chunk 中的 `choice.delta` | 有明确 `type` 的 ResponseStreamEvent |
| 内容定位 | 单 choice 下的活动 text/thinking block，工具另按 index/id map | 每个 output item 有 `output_index` |
| 正常结束信号 | `choice.finish_reason` | `response.completed` / `response.incomplete` |
| usage 所在位置 | 常见为末尾 chunk 的 `usage`，兼容其他位置 | response terminal event 的 usage |
| 接口差异 | 许多 OpenAI-compatible 服务自定义字段较多 | Responses event 通常更明确地区分 item 生命周期 |

此适配器要支持大量 OpenAI-compatible provider。代码里因此有 `getCompat(model)`、`detectCompat(model)` 等兼容能力，而不只是向 OpenAI 官方发同一种 JSON。

## 1. 外层 stream：请求生命周期

外层 `stream(model, context, options)` 的骨架与 D17/D18 接近：

```text
resolveTranscript
  → 创建 pending AssistantMessage
  → 创建 OpenAI client（apiKey/baseURL/headers/fetch）
  → buildParams（messages/tools/reasoning/cache 等）
  → onPayload 可修改请求
  → chat.completions.create(...).withResponse()，统一 retry
  → onResponse
  → push start
  → 逐 chunk 处理
  → finalize 所有活动 block
  → 校验 finish_reason / 取消状态
  → push done；catch 时清临时字段并 push error
```

响应流是 `AsyncIterable<ChatCompletionChunk>`，SDK 已经完成 HTTP/SSE framing；本适配器不再解析 SSE 文本，而直接折叠带类型的 chunk 对象。

与 D18 不同，Chat Completions 适配器把单个 provider chunk 通过 `onProviderStreamEvent` 传给观察者。OpenRouter 等 gateway 可以把 usage/cost/router metadata 放在额外字段；观察者可以看到原始 provider chunk，同时普通 UI 仍消费 pi 的统一事件。

## 2. 请求侧：`buildParams` 与兼容能力

请求主体包含 `model`、`messages`、`stream: true`。再按 provider 能力设置：

- `stream_options.include_usage`；
- `max_completion_tokens` 或旧字段 `max_tokens`；
- tools 与 tool choice；
- cache retention、prompt cache key；
- reasoning/thinking 格式；
- temperature、priority、service-specific fields。

### 2.1 为什么同一 API 要有兼容矩阵

模型声明的 API 可能都叫 `openai-completions`，但服务端行为并不完全一致。`ResolvedOpenAICompletionsCompat` 会聚合模型显式声明和 provider/baseUrl 自动检测的能力，例如：

- 能否报告 finish reason；
- 能否在流末提供 usage；
- 使用哪种 reasoning 字段/格式；
- max token 参数名；
- 工具 schema 是否支持 strict；
- 是否要求工具结果带 name；
- 是否支持某种 prompt cache/control 格式。

这不是“给每家 provider 写一份复制的 API 实现”，而是保留共享转换路径、用有限能力开关适配差异。坏处是组合会增加复杂度，所以读某项行为时需要确认：显式 compat、自动 detect、最终 resolved compat 三层的优先级。

### 2.2 tool history 下可能要传空 tools 数组

当本轮没有可用工具定义、但历史消息里存在 assistant tool call 和 tool result，部分代理会要求请求中仍包含 `tools` 字段。`buildParams` 会在特定 compat 下显式传 `tools: []`。

空数组和字段缺席不是一回事：

- 缺席：请求没有提供 tools 字段；
- 空数组：明确声明当前没有工具，但历史里可能出现工具消息。

这类兼容逻辑说明，供应商协议不仅由一条请求独立决定，还可能受 transcript 历史形状影响。

## 3. 一个 delta chunk 如何累积成完整内容

### 3.1 text 与 thinking block 是惰性创建的

流开始后 `textBlock`、`thinkingBlock` 都先是 `null`。第一次收到非空文本/推理增量时，`ensureTextBlock` 或 `ensureThinkingBlock` 才：

1. 创建空内容 block；
2. append 到 `output.content`；
3. push 对应 `text_start` / `thinking_start`；
4. 将 block 引用保存在局部变量中。

随后每个 chunk 只做两件事：先追加 delta 到完整 block，再 push 对应 pi `*_delta`。某些 provider 只返回 tool call、没有文字，因此不会产生空的 text block。

### 3.2 provider 的 reasoning 字段有多个别名

适配器按顺序检查 `reasoning_content`、`reasoning`、`reasoning_text`，使用第一个非空字符串。某些 gateway 会把相同内容同时放在 `reasoning_content` 和 `reasoning`；取第一个避免把相同 reasoning 显示两遍。

选中的字段名放在 `thinkingSignature` 里，用于后续识别如何把该 thinking block 序列化回 provider 对话历史。它是重放元数据，不是用户可见内容。

OpenRouter 的 `reasoning_details` 则是结构化数据：流式期间保存在 `streamedReasoningDetails` 中，块结束时统一 JSON 序列化进 `thinkingSignature`。不要把这些对象拼进 `thinking` 字符串，否则会把协议数据显示给用户，也会破坏回放。

### 3.3 tool call 的 index 与 id 都可能分块到达

不同 chunk 可能逐步给出工具调用的 index、id、name、arguments。适配器用两张 map 找回相同调用：

```typescript
const toolCallBlocksByIndex = new Map<number, StreamingToolCallBlock>();
const toolCallBlocksById = new Map<string, StreamingToolCallBlock>();
```

优先通过 `index` 查找；若本 chunk 没有 index，则尝试 `id`。第一次遇到时创建 block；之后若 id 或 name 才到，再补到已有 block 上。

这解决“字段并非首个 chunk 同时齐全”的情况。若实现假定 first chunk 必然含完整 id 和 name，就会错误拆出多个 tool call，或者把后续 arguments 放进错误 block。

`function.arguments` 按字符串片段累积到 `partialArgs`，并用 `parseStreamingJson` 更新尽可能可解析的 `arguments`。这是流式快照，不等于 JSON 已完整。

## 4. 工具参数和 custom tool 的两条路径

### 4.1 JSON function arguments

收到 function arguments delta 时：

```text
partialArgs = partialArgs + delta
arguments = parseStreamingJson(partialArgs)
push toolcall_delta(delta)
```

`parseStreamingJson` 要容忍 JSON 暂时不完整；真正完成时 `finishBlock` 再按完整 `partialArgs` 解析并赋值。

### 4.2 custom input 不是普通 function JSON

部分 OpenAI-compatible API 提供 custom tool input 字段。适配器通过 schema/grammar 生成的 `grammarToolInputProperties` 决定输入放在哪个参数属性里，再通过 JSON 增量 helper 构造展示给 pi 的 `toolcall_delta`。

```text
provider custom.input 字符串增量
  → 拼接为完整 input 文本
  → appendGrammarToolInputJsonDelta 维护合法 JSON 外壳
  → toolCall.arguments[property] 持有当前文本
```

`finishBlock` 结束 custom input 时关闭 JSON 增量状态；普通 function call 则 parse 完整 `partialArgs`。两种分支最终都发统一 `toolcall_end`，并清除 `partialArgs`、`customInput`、`streamIndex` 等 scratch 字段。

【陷阱】不要为了减少分支而把 custom tool input 直接当作普通 function.arguments。provider 输入字段、pi 工具 schema 参数、UI 显示的 JSON delta 是三个相关但不同的表示。

## 5. 消息结束与 finish_reason

流结束时，适配器会对 `output.content` 里尚在活动状态的 block 调 `finishBlock`。然后依次检查：

1. signal 是否取消；
2. stop reason 是否已经变成 `aborted`；
3. provider compat 是否声称会提供 finish reason；
4. stop reason 是否是错误；
5. 在要求 finish reason 的 provider 上是否真的收到它。

映射表：

| Chat Completions `finish_reason` | pi stop reason |
|---|---|
| `stop` / `end` | `stop` |
| `length` | `length` |
| `tool_calls` / `function_call` | `toolUse` |
| `content_filter` | `error`，含明确 errorMessage |
| `network_error` | `error`，含明确 errorMessage |
| 未知字符串 | `error`，保留原始原因 |

若 provider 明确 `supportsFinishReason: false`，流正常 EOF 时适配器会按是否存在 tool call 推断 `toolUse` 或 `stop`。若 provider 宣称支持 finish reason 却没发，视为协议不完整并报错。

【陷阱】“没有 finish_reason”不能一概报错，也不能一概视为正常完成。要结合 provider compat 声明：这是明确的能力差异，不是同一个 API 所有端点都保证一致。

## 6. usage 与 response model

每个 chunk 都可能带 completion id、model、usage：

- `responseId` 取流中出现的 completion id；
- 若返回 model 和请求 model 不一致，记录 `responseModel`；
- `chunk.usage` 到达时解析并更新 usage；
- 某些兼容端点把 usage 放在 `choice.usage`，提供 fallback 读取。

chunk 中 usage 可能比普通字段更多，例如 OpenRouter 的 cost、BYOK/router metadata。provider 原始 chunk 通过 hook 暴露给调用方；统一 `Usage` 只记录 pi 约定的 token/cost 字段。

### 6.1 数值为零时不能用 truthiness 判断

usage 解析需区分“计数为 0”和“字段不存在”。TypeScript/JavaScript 中 `if (0)` 为 false。读 usage parser 时注意它是否按字段存在性读取，不能只看是否有 truthy 值。

### 6.2 当前只处理第一个 choice

chunk reducer 使用 `chunk.choices[0]`，不会把同一 chunk 中的多个 choices 合并进一个 `AssistantMessage`。这是重要的行为边界：Chat Completions 的 `n > 1` 多候选响应不是此消息 reducer 当前表达的目标形状。不要为了“支持更多输出”简单循环全部 choices 并把文本拼在一起，因为每个 choice 是独立候选回答，应该定义独立消息或明确选择策略。

## 7. 中断和错误清理

provider stream 在 chunk 中断开时，外层 catch 会：

- 把 reasoning detail 合并进已有 thinking block signature；
- 清除所有 block 上的临时 index、partial args、custom input、stream index；
- 根据 AbortSignal 设 `aborted` 或 `error`；
- 规范化错误文本，并避免重复拼接 gateway raw metadata；
- push 统一 error event 并 end。

这和正常 `finishBlock` 的清理有不同边界：成功时逐 block 完成；失败时扫描所有已创建 block 全局清理。只在成功分支删 scratch field 会让半截流的临时属性进入持久化消息。

## 8. `convertMessages`：pi 历史如何变回 Chat Completions

`buildParams` 调用 `convertMessages`，它要把 pi 的统一历史重新转换为 chat `messages` 数组。

关键步骤包括：

- system message 转成 system/developer role 或特定兼容格式；
- user 的 text/image block 转成 provider 认可的 content；
- assistant 侧把 text block 合并为标准字符串，避免某些服务将内容块数组再次原样嵌套回输出；
- thinking block 按 `thinkingSignature` 识别来源字段/结构化 reasoning data；
- toolCall 转成 `tool_calls`，arguments 序列化成 JSON string；
- toolResult 转成 tool role 消息，必要时带 tool name；
- 相邻 tool result 的图片在支持时并入 user message。

这就是为什么 provider output 中的 thinking signature、工具 id 和 tool result id 不能只当 UI 元数据。它们参与下一轮请求的重建。

【建议】读 `convertMessages` 时用一段只有 user + assistant toolCall + 两条 toolResult 的 transcript 手动追踪数组顺序。tool result 必须与前面的 call id 对上，否则 server 可能拒绝历史或错误关联结果。

## 9. 与 Agent loop 的边界

Chat Completions provider 在 `tool_calls` finish reason 时产出 `AssistantMessage`，其中包括完整的 toolCall blocks。它不会在此处执行 `read`、`bash` 等本地工具。

后续由 `packages/agent/src/agent-loop.ts`：

1. 读取 assistant 的 stop reason 与 tool call 列表；
2. 根据 tool name 找到本地 AgentTool；
3. 校验 arguments；
4. 执行并发/顺序策略；
5. 将成功或错误结果写成 tool result 消息；
6. 再请求模型。

同样的分层在 D17 与 D18 都成立。provider 测试不等于 Agent 工具调度测试；反过来，Agent faux provider 测试也不能证明 Chat Completions 某个兼容字段转换正确。

## 10. 测试如何组织

按行为定位测试，而不是把 1,600 行适配器整体当成一个不可分整体：

| 行为 | 可读测试 |
|---|---|
| 原始 chunk hook 与 OpenRouter metadata | `openai-completions-provider-stream-event.test.ts` |
| finish reason 保存与错误转换 | `openai-completions-raw-stop-reason.test.ts` |
| retries 与请求错误 | `openai-completions-retry.test.ts` |
| usage/cost/cache | `openai-completions-prompt-cache.test.ts` 与 usage 相关测试 |
| tool choice 与空 tools | `openai-completions-tool-choice.test.ts`、`openai-completions-empty-tools.test.ts` |
| thinking token budget 与 reasoning 格式 | `openai-completions-thinking-token-budget.test.ts`、`openai-completions-reasoning-details.test.ts` |
| tool result image | `openai-completions-tool-result-images.test.ts` |
| response model | `openai-completions-response-model.test.ts` |

这些大多通过 mock SDK chunk 测确定性转换，不需要外网和真实 key。写新测试时先选一个行为边界，固定 chunk 序列，再断言最终 message 和事件。对于 tool streaming，至少覆盖 id/name/index 延迟到达，以及两个并行调用交错追加参数的情况。

## 11. 三种 provider 路径的总对照

```text
Anthropic Messages:
  HTTP bytes → pi SSE decoder → RawMessageStreamEvent → pi events

OpenAI Responses:
  SDK async ResponseStreamEvent → output_index slot reducer → pi events

OpenAI Chat Completions:
  SDK async ChatCompletionChunk → activity block + tool index/id maps → pi events
```

它们最后都回到 Agent 层同一组概念：assistant text/thinking/tool call、usage、stop reason、done/error。差异被限制在 provider adapter；若某个差异已经影响 Agent loop，就要确认是否应该先在 pi-ai 转换层收敛。

## 12. 练习

### 练习 A：拆一组交错 tool chunks

给两个 tool call，chunk 1 只含 index/name，chunk 2 含另一个 call 的 id/index/name，chunk 3 分别含参数 delta。解释两张 map 怎样避免把参数写到同一 block。

参考：每个 index/id 都映射到同一个 block 对象；后到字段补回对象；`getContentIndex` 使用 block 对象在 content array 的位置。

### 练习 B：兼容 finish reason

provider 未发 finish reason。分别令 compat 的 `supportsFinishReason` 为 true/false，并说明最终行为。

参考：true 时 stream 不完整，产生 error；false 时可按内容中是否有 toolCall 推断 stop 或 toolUse。

### 练习 C：区分三种数据

解释 `partialArgs`、`arguments`、`toolcall_delta.delta` 的不同。

参考：`partialArgs` 是尚未完成的 JSON 原文 scratch buffer；`arguments` 是当前尽可能解析出的对象快照；事件 delta 是本次新增的原文片段。

### 练习 D：为什么 catch 清临时字段

构造流在 tool JSON 中途失败的轨迹。说明若 catch 不删 `partialArgs`，可能污染哪两类下游数据。

参考：最终会话序列化数据，以及下一轮 `convertMessages` 产生的 provider 请求。

## 13. 本篇事实与验证边界

- **静态核对**：主函数、compat 行为、chunk reducer、convertMessages 和测试分工基于当前源码与测试文件阅读。
- **未运行**：本篇没有运行任何 Vitest；不声称测试通过。
- **离线条件**：测试大多 mock OpenAI client 与 chunk stream，不依赖真实模型账号。
- **平台**：本篇没有声称 Windows/Linux/macOS 分别运行验证。

## 14. 小结

Chat Completions 适配器要把“很多形状不完全一致的 chunk”还原为稳定的一条消息：

```text
ChatCompletionChunk
  → 收集 id/model/usage/finish_reason
  → 累积 text/reasoning/tool-call blocks
  → 清理 scratch buffers
  → 校验 stream completion
  → AssistantMessageEventStream done/error
```

相较 Responses，Chat Completions 兼容面更广、块生命周期信息更弱，因此适配器需要更多基于兼容能力的推断；相较 Anthropic，它不需要自己解 SSE 行，但仍要处理任意字段可能分散到多个 chunk 的事实。

> D19 完。下一篇适合精读 Bedrock Converse：重点看 AWS 事件 union、凭据/region 配置和 Bedrock token usage 如何映射到统一 pi 类型。
