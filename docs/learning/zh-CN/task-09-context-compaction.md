# 09. 上下文预算、系统提示与压缩

> 预计时间：2 小时（不含选读）
> 先修：消息、事件与状态（会话消息如何记录和回放），会话树与恢复（会话如何写入磁盘）

## 本篇你会学到

- 说出模型每次请求实际收到什么：系统提示的分节，加上当前会话的投影。
- 判断什么时候自动压缩，并用一个离线实验对照压缩前后的模型输入。
- 解释溢出后 pi 为什么只重试一次，失败时保留什么。

## 先用一个例子理解

假设你在同一个会话里连续让 pi 做三件事：读文件、解释一段代码、再读另一个文件。每一轮，pi 都会把之前的消息再发一遍给模型，所以输入每轮都变长。

每个模型都有一个**上下文窗口**，也就是它一次请求能接收的上限。本文用一个很小的 2600 token 窗口做演示，真实模型通常大得多。

没有压缩时：第三轮的输入超过窗口。供应商返回溢出错误，或者回答被截断。这次请求失败，之后每一轮也都更难继续。

有压缩时：pi 发现用量超过阈值，就请模型把较早的几轮写成一段摘要，然后只保留摘要和最近的回答。之后的请求用“系统提示 + 摘要 + 最近回答”。磁盘上的原始消息仍然存在，只是不再发送给模型。

模型每次请求收到的输入由三块组成：

```text
[系统提示]   preamble、tools、rules、docs、project_context、cwd 等分节
[投影]       会话中仍然有效的历史消息，压缩后可能以摘要开头
[新输入]     本次用户发送的消息
```

只有投影会因为压缩而变短。系统提示每次都要计入预算。

下面的数字来自本篇第 4 个实验，不是估计：

- 窗口 2600，预留 400，所以阈值是 2600 - 400 = 2200。
- 第一轮结束时，供应商报告的用量是 2051，没有超过阈值。
- 第二轮结束时，用量是 2360，超过阈值，触发压缩。
- 压缩后，投影从 5 条消息变成 3 条（系统提示、摘要、保留的回答）。用户再发一条新输入时，请求从 6 条变成 4 条。

实验用的是假模型（faux），它按字符数估算用量。pi 判断是否压缩的代码路径和真实供应商完全相同。

## 核心概念

### 1. 上下文窗口是预算

**上下文窗口（context window）** 是模型一次请求能接收的 **token** 上限。token 是模型计量文本的单位，大致相当于几个英文字母，或者一个汉字的一部分。

为什么需要：窗口是硬上限。每一轮都要重发完整历史，所以用量随轮次增长，直到超出窗口。

pi 把窗口当预算来用。它先留出一部分给模型的回答，叫做**预留（reserveTokens）**。默认值在 `DEFAULT_COMPACTION_SETTINGS` 中定义：

```text
enabled: true, reserveTokens: 16384, keepRecentTokens: 20000
```

小例子：窗口 200000，预留 16384，那么可用于输入的上限是 183616。用量达到 183617 时才会触发压缩（实验 1 验证了这个边界）。

预算表（实验 4 的真实运行，窗口 2600，预留 400，阈值 2200）：

| 项目 | 数值 | 来源 |
| ---- | ---- | ---- |
| 第 1 轮 usage：input 1426 + output 625 | 2051 | 假模型报告的 `totalTokens` |
| 第 2 轮 usage：input 2060 + output 300 | 2360 | 超过 2200，触发压缩 |
| 系统提示 5 个分节的估算之和（preamble 43、tools 85、rules 210、docs 311、cwd 21） | 670 | `estimateTokens`，结果等于字符数除以 4 向上取整 |
| 两轮后非系统消息的估算之和 | 934 | `estimateTokens` |
| 压缩后的 `estimatedTokensAfter` | 1735 | 本地估算（另一次运行为 1736） |
| 压缩后第 3 轮的 usage：input 1781 + output 4 | 1785 | 压缩后的真实请求 |

读表的方法：`_checkCompaction` 在有 usage 时用 usage 做阈值比较（第 1、2 轮），估算只用于压缩后的数字，以及没有 usage 的情况。假模型的 `input` 与 `estimateTokens` 之和不相等（第 1 轮 1426 对 670 加 4）。假模型的计数规则没有读取，未在本地验证具体规则。

### 2. 系统提示由分节组成

系统提示不是一整段字符串。`buildSystemPromptSections` 返回一组有名字的段，叫做**分节（section）**。

为什么需要：分节让系统提示可以按名字局部更新。会话里记录的不是整段提示，而是**补丁（patch）**：只包含变化的分节，值为 `null` 表示删除该分节。如果没有分节，任何一个字符变化都要整段重发。

每个分节都包在同名标签里，例如 `<rules>...</rules>`，只有 `preamble`（开场白）不加标签。标签让模型能把后来的更新和原来的分节对应起来。

内置分节：

- `preamble`：身份与职责，不加标签。
- `tools`：只列出有 snippet 的工具。
- `rules`：由工具准则和通用规则去重后生成。
- `docs`：pi 自身文档的位置。
- `addendum`：用户追加的文本，只在 `appendSystemPrompt` 非空时出现。
- `project_context`：AGENTS.md 等上下文文件，每个文件包在 `<project_instructions path="...">` 中，只在有文件时出现。
- `skills`：技能清单，只在已选工具包含 `read` 或 `bash` 且有技能时出现。
- `cwd`：工作目录，反斜杠统一改为正斜杠。

小例子：实验 2 中，去掉 AGENTS.md 后补丁是 `{"project_context":null}`，只有这一个分节被删除，其他分节不变。

分节渲染后就是模型看到的文本。实验 2 中 `project_context` 分节的真实输出如下：

```text
<project_context>
Project-specific instructions and guidelines:

<project_instructions path="C:/demo/AGENTS.md">
请只读当前目录
</project_instructions>
</project_context>
```

另一条路径是 `forceSystemPrompt`。它给出一整段文本，没有分节，因此不能打补丁，每次变化都是整段替换。这是扩展完全接管提示时使用的逃生口。

完整组装示例（实验 s，假输入：`cwd` 为 `C:\demo`，工具为 read、bash、edit、write，`appendSystemPrompt` 为 `Reply in Chinese.`，一个 AGENTS.md，以及 `sections: { team_rules: "Use pnpm, not npm." }`）。

分节顺序（`buildSystemPromptSections` 的返回顺序）：

```text
preamble > tools > rules > docs > addendum > project_context > cwd > team_rules
```

`addendum` 来自 `appendSystemPrompt`。`project_context` 来自 AGENTS.md。`team_rules` 不是内置分节，而是调用方在 `sections` 中给出的。构建函数在 `cwd` 之后才合并自定义分节（`promptSections[name] = content` 在 `cwd` 赋值之后执行），所以它排在最后。

`buildSystemPrompt` 按上面的顺序拼接，分节之间用一个空行分隔。每个分节在最终文本中的起始位置（字符偏移，实验 s 的真实输出）：

| 分节 | 起始偏移 | 字符数 | 估算 token |
| ---- | ---- | ---- | ---- |
| preamble | 0 | 169 | 43 |
| tools | 171 | 236 | 59 |
| rules | 409 | 146 | 37 |
| docs | 557 | 1244 | 311 |
| addendum | 1803 | 40 | 10 |
| project_context | 1845 | 163 | 41 |
| cwd | 2010 | 20 | 5 |
| team_rules | 2032 | 45 | 12 |

整段提示共 2077 字符，估算 520 token。`docs` 分节包含本机的文档路径，所以它的长度随安装位置变化。

最终文本的末尾是：

```text
<cwd>
C:/demo
</cwd>

<team_rules>
Use pnpm, not npm.
</team_rules>
```

如果之后删除 `team_rules`，补丁就是 `{"team_rules":null}`（实验 s 的 s5）。补丁只包含这一个键，其他分节都不变。

### 3. 压缩阈值

**压缩阈值（threshold）** 是判断要不要压缩的一条不等式：

```text
上下文 token 数 > 上下文窗口 - reserveTokens   →  触发自动压缩
```

注意是严格大于。`enabled: false` 时永远不自动压缩，但 `/compact` 仍可手动使用。

为什么需要：阈值要在窗口真正装满之前触发，给回答留出空间。

小例子：实验 1 中 `shouldCompact(850, 1000, { reserveTokens: 200 })` 返回 `true`，`shouldCompact(800, 1000, ...)` 返回 `false`，因为 800 等于阈值，不是大于。

“上下文 token 数”有三个来源，由 `_checkCompaction` 按情况选择：

- 正常情况：上一条助手消息的供应商用量，即 `calculateContextTokens`（用 `totalTokens`）。
- 出错或用量为零：用消息估算，即 `estimateContextTokens`，粗略地按字符数除以 4 计算。
- 有 `context_edit` 编辑记录：用投影估算，即 `estimateProjectedContextTokens`。

不同模型可以有不同的预留和保留值，通过 `compaction.modelOverrides` 配置，键必须是精确的 `provider/modelId`，例如 `faux/faux-1`。

### 4. 切点与摘要请求

**切点（cut point）** 是保留区和摘要区的分界。切点之前的消息进入摘要，切点及之后的消息原样保留。

合法切点只能是这些消息：用户消息、助手消息、bash 执行记录、自定义消息、分支摘要、压缩摘要。**工具结果永远不是切点。**

为什么需要：工具结果必须和发出它的工具调用放在一起。如果切点落在工具结果上，保留下来的结果就没有对应的调用。模型会看到一段“文件内容”，却不知道它回应的是哪一次 `read`。

切点的选择方法：pi 从最新消息往前累计估算的 token。累计到 `keepRecentTokens` 时，选择不早于该位置的第一个合法切点。如果找不到这样的切点，就取最后一个合法切点。如果整段历史都没有达到预算，切点就是第一个合法点，几乎全部保留。

小例子（实验 4）：`keepRecentTokens` 设为 300。从后往前看，最后一条助手回答约 300 token，累计达到 300，于是切点选在这条回答上。这条回答前面的用户消息属于同一轮，所以这是**分裂跨度（split turn）**：切点不在用户消息上，历史被拆成两部分，分别摘要。

`findCutPoint` 的小例子（实验 g，四条消息，每条 40 个字符，估算为 10 token）。

消息顺序是 `u1`（用户）、`a1`（助手）、`u2`（用户）、`a2`（助手）。从最新的消息往前累计：`a2` 为 10，加上 `u2` 为 20，加上 `a1` 为 30，加上 `u1` 为 40。

- `keepRecentTokens` 为 25：累计到 `a1` 时达到 30，已经大于等于 25。切点取不早于 `a1` 的第一个合法点，就是 `a1`。结果是 `{"firstKeptEntryIndex":1,"turnStartIndex":0,"isSplitTurn":true}`。切点落在助手消息上，所以是分裂跨度，`u1` 进入前缀摘要。
- `keepRecentTokens` 为 35：累计到 `a1` 时只有 30，不够；累计到 `u1` 时是 40，达到 35。切点是 `u1`，结果是 `{"firstKeptEntryIndex":0,"turnStartIndex":-1,"isSplitTurn":false}`。这次不是分裂跨度。

代码中的 `for` 循环逐条累计，遇到第一个达到预算的条目就停止，然后用 `cutPoints.find((candidate) => candidate >= i)` 取切点。如果累计始终达不到预算，切点就是第一个合法点（`cutPoints[0]`）。

`findCutPoint` 处理原始条目。它在 `packages/coding-agent/src/index.ts` 中被导出（已用 Grep 确认），测试直接调用它。会话主路径用的是 `findProjectedCutPoint`，它的累计和切点规则相同，只是作用于投影（已用 Read 确认）。

分裂跨度时，pi 发出两次摘要请求，合并结果如下（实验 4 的真实输出，假模型的回答被原样当作摘要）：

```text
## Goal
summary of the older turns

---

**Turn Context (split turn):**

answer for the split turn
```

**摘要请求（summary request）** 是压缩时发给模型的一次专用调用，它的形式很特别：

- 系统提示是 `SUMMARIZATION_SYSTEM_PROMPT`，限定模型只能输出摘要，不能继续对话。
- 只有一条用户消息。消息里先是 `<conversation>...</conversation>` 包住的历史，再是可选的 `<previous-summary>`，最后是固定指令。
- 历史用 `serializeConversation` 转成带前缀的文本：`[User]:`、`[Assistant]:`、`[Assistant tool calls]:`、`[Tool result]:`。工具结果超过 2000 字符会被截断。
- 不提供任何工具。如果模型的回答里有工具调用，pi 把它当作失败。
- 输出上限是 `min(0.8 × reserveTokens, 模型的 maxTokens)`。
- 输出结构固定为 Goal、Constraints & Preferences、Progress、Key Decisions、Next Steps、Critical Context。文件列表在末尾用 `<read-files>` 和 `<modified-files>` 追加。

为什么要用前缀格式：如果把历史原样发给模型并说“请总结”，模型可能把它当成一段要继续回答的对话。前缀让历史变成“待处理的材料”。

摘要请求的用户消息按固定顺序拼接（源码 `generateSummaryWithUsage`）：

```text
<conversation>
（serializeConversation 的结果）
</conversation>

<previous-summary>
（上一次压缩的摘要，只有存在时才有）
</previous-summary>

（SUMMARIZATION_PROMPT；有旧摘要时换成 UPDATE_SUMMARIZATION_PROMPT；
  如果用户给了 /compact 指令，末尾追加 "Additional focus: ..."）
```

提示词开头的 “The messages above...” 指的就是上面的 `<conversation>` 块，所以顺序不能随意调整。

实验 4 中，第一次摘要请求的开头是：

```text
<conversation>
[User]: seed old history
```

### 5. 压缩条目与投影

**压缩条目（compaction entry）** 是会话文件里追加的一行记录。它保存摘要文本、保留边界 `firstKeptEntryId`、压缩前的 token 数 `tokensBefore`，以及用量和文件详情。它不删除任何旧条目。

**投影（projection）** 是模型实际看到的历史，由 `buildSessionProjection` 从条目计算得出。最新的压缩条目会用它的摘要替代保留边界之前的条目；从 `firstKeptEntryId` 开始的条目保留。

为什么需要：原始历史要保留，因为导出、回放和分支都要用。但发给模型的输入要变小。把“存什么”和“发什么”分开，就能既省上下文，又不丢事实。

小例子：实验 3 中，调用 `appendCompaction` 后，`getEntries()` 仍然有 4 条消息加 1 条压缩条目；只有 `buildSessionContext()` 的结果变短了。

### 6. 溢出恢复

**溢出恢复（overflow recovery）** 是事后补救。它在两种情况下触发：供应商明确报告上下文溢出，或者回答因为长度被截断（`stopReason: "length"`），而且输出没有达到模型的 `maxTokens`。

threshold 是事前检查，overflow 是事后补救。两者都调用同一个压缩过程，但触发条件、是否重试不同。

`_checkCompaction` 中的判断：

- 溢出：`stopReason` 为 `error` 且 `isContextOverflow` 为真；或者回答是完整的（`stop`），而且 `usage.input + usage.cacheRead` 超过窗口。后一种由 `isContextOverflow` 的第二条规则判断（推断溢出）。
- 可恢复截断：`stopReason` 为 `length`，且 `usage.output` 小于模型的 `maxTokens`（`isRecoverableLength`）。这里的 `maxTokens` 是模型配置的上限，不是被上下文裁剪后的值。

是否重试由 `willRetry` 决定，它等于 `stopReason !== "stop"`：

- 回答已经完整（`stop`），但用量超过窗口：只压缩，不重试。原因是 `continue` 不能接在一条已完成的助手回答后面。实验 6（见动手实验）中，回答是 2500 字符并正常结束，输入 2922 超过窗口 2600，事件是 `overflow`，`willRetry` 为 `false`，没有重试。
- 回答是错误或截断：先用 `context_edit` 把失败的助手消息（和它的工具结果）从投影中省略，再压缩，然后自动重试一次。实验 5 中，截断的回答被省略，压缩后重试得到 `completed response`。

长度截断的一次完整恢复（实验 5 的真实顺序）：

1. 第一次请求得到 `partial response`，`stopReason` 为 `length`。
2. `_checkCompaction` 判定为可恢复截断，并把 `_overflowRecoveryAttempted` 设为 `true`。
3. `_omitRecoveryAttempt` 追加一条 `context_edit`，把截断的回答从投影中省略。
4. `_runAutoCompaction("overflow", true)` 发出摘要请求（第二次请求），压缩条目写入。
5. `_handlePostAgentRun` 返回 `true`，`_runAgentPrompt` 调用 `agent.continue()`，发出第三次请求，得到 `completed response`。

溢出恢复只能用一次。`_overflowRecoveryAttempted` 标记记录是否已经尝试过。第二次溢出时，pi 直接报错，文案是：

```text
Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.
```

这个标记在收到新的用户消息时清零，在收到非错误、非截断的助手回答时也清零。

如果恢复压缩失败，省略编辑仍然保留，因此失败的回答不会回到上下文中。pi 不写压缩条目，也不安排内部重试。用户需要自己缩短输入或换用更大窗口的模型。

恢复路径的标志位和调用顺序（名字均来自 `packages/coding-agent/src/core/agent-session.ts`）：

1. `_handlePostAgentRun` 在一次运行结束后调用 `_checkCompaction(message, true, toolResults)`。
2. `_checkCompaction` 先检查 `sameModel`（回答由当前模型产生），再检查 `assistantIsFromBeforeCompaction`（回答早于最近的压缩条目，直接返回 `false`）。
3. 计算 `contextOverflow` 与 `recoverableLength`。两者都为假时，进入阈值判断（`contextTokens` 与 `shouldCompact`）。
4. 为真时，计算 `willRetry = assistantMessage.stopReason !== "stop"`。为 `false` 时直接执行 `_runAutoCompaction("overflow", false)`，不重试。
5. 为 `true` 时，先看 `this._overflowRecoveryAttempted`。已经是 `true` 时，发出 `compaction_end`（`errorMessage` 为 `Context overflow recovery failed after one compact-and-retry attempt. ...`，截断时是另一句文案）和 `session_compact_failed`，返回 `false`。
6. 否则设置 `this._overflowRecoveryAttempted = true`，调用 `_omitRecoveryAttempt(assistantMessage, toolResults)`。它为失败的回答和它的工具结果各写入一条 `context_edit`（`replacement` 为 `null`）。如果某条消息在投影中却没有源条目，它会抛出错误。
7. 调用 `_runAutoCompaction("overflow", willRetry)`。成功时它发出 `compaction_end`（`willRetry` 为 `true`）并返回 `true`。
8. `_runAgentPrompt` 的循环看到 `true`，调用 `this.agent.continue()`，也就是重试一次。
9. `_overflowRecoveryAttempted` 回到 `false`，有两个时机：收到 `message_start`（角色为 `user` 的消息），或收到的助手消息既不是 `error` 也不是 `length`。

顺序的理由：`_omitRecoveryAttempt` 在压缩之前写入省略编辑，所以即使压缩失败，失败的回答也不会再进入上下文。标志位保证第二次溢出时直接报错，不会无限重试。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径（相对仓库根） | 符号 | 读的时候关注什么 |
| ---- | ---------------------- | ---- | ---------------- |
| 1 | `packages/coding-agent/src/core/system-prompt.ts` | `buildSystemPromptSections` | 八类分节各自的生成条件 |
| 2 | `packages/coding-agent/src/core/system-prompt.ts` | `buildSystemPromptState`、`buildSystemPrompt`、`diffSystemPromptSections` | `forceSystemPrompt` 的两态；补丁里 `null` 表示删除 |
| 3 | `packages/coding-agent/src/core/agent-session.ts` | `_preparePromptAndToolLoadout` | 新分节与转录中当前分节做 diff，生成本次系统消息补丁 |
| 4 | `packages/ai/src/utils/transcript.ts` | `getCurrentSystemMessage` | 重放所有系统消息补丁，得到当前分节 |
| 5 | `packages/ai/src/utils/text.ts` | `getSystemMessageText` | 分节如何拼接成最终的系统提示文本 |
| 6 | `packages/coding-agent/src/core/compaction/compaction.ts` | `DEFAULT_COMPACTION_SETTINGS`、`shouldCompact` | 阈值公式与三个默认值；严格大于 |
| 7 | `packages/coding-agent/src/core/compaction/compaction.ts` | `calculateContextTokens`、`estimateContextTokens`、`estimateProjectedContextTokens` | 三种 token 来源 |
| 8 | `packages/coding-agent/src/core/agent-session.ts` | `_handlePostAgentRun`、`_checkCompaction` | 每轮结束后的判断链，以及溢出与截断分支 |
| 9 | `packages/coding-agent/src/core/agent-session.ts` | `_runAutoCompaction` | 压缩执行：事件、扩展钩子、写入、失败记录 |
| 10 | `packages/coding-agent/src/core/agent-session.ts` | `_omitRecoveryAttempt`、`_overflowRecoveryAttempted` | 省略编辑与一次性标记 |
| 11 | `packages/coding-agent/src/core/compaction/compaction.ts` | `prepareCompaction`、`findProjectedCutPoint` | 切点、摘要区间和保留区间的计算（`findProjectedCutPoint` 未导出） |
| 12 | `packages/coding-agent/src/core/compaction/compaction.ts` | `findCutPoint` | 原始条目版切点。它被 `packages/coding-agent/src/index.ts` 导出，测试直接调用；会话主路径用的是投影版 |
| 13 | `packages/coding-agent/src/core/compaction/compaction.ts` | `compact`、`generateSummaryWithUsage`、`generateTurnPrefixSummary` | 摘要请求的提示词组装与分裂跨度的合并 |
| 14 | `packages/coding-agent/src/core/compaction/compaction.ts` | `completeSummarization`、`getSummarizationFailure` | 摘要调用的共享入口与失败判定 |
| 15 | `packages/coding-agent/src/core/compaction/utils.ts` | `serializeConversation`、`SUMMARIZATION_SYSTEM_PROMPT` | 历史如何变成“待处理材料”的文本 |
| 16 | `packages/coding-agent/src/core/session-manager.ts` | `buildSessionProjection`、`appendCompaction` | 投影如何被压缩条目改写，以及条目如何追加 |
| 17 | `packages/coding-agent/src/core/messages.ts` | `convertToLlm`、`COMPACTION_SUMMARY_PREFIX` | 压缩摘要发给模型时的包装文本 |
| 18 | `packages/ai/src/utils/overflow.ts` | `isContextOverflow`、`isRecoverableLength` | 溢出与可恢复截断的判定依据 |
| 19 | `packages/coding-agent/test/suite/harness.ts` | `createHarness`（异步函数） | 离线会话与假模型，实验中使用 |

## 走读一次完整过程

下面按实验 4 的真实运行顺序，描述一次阈值压缩。每一步写明发生了什么，对应哪个函数，状态有什么变化。

1. 用户发送 `seed old history`。`AgentSession.prompt` 进入 `_runAgentPrompt`。在发请求前，`_preparePromptAndToolLoadout` 调用 `buildSystemPromptSections` 生成新分节，并与转录中的当前分节 diff。首次运行时，它产生一条系统消息补丁，写入条目（条目 1）。
2. 助手回答 2500 字符。`_handlePostAgentRun` 调用 `_checkCompaction(message, true, toolResults)`。用量 2051，`shouldCompact(2051, 2600, ...)` 返回 `false`，因为阈值是 2200。
3. 用户发送 `seed recent history`，助手回答 1200 字符，用量 2360。`_handlePostAgentRun` 再次调用 `_checkCompaction`，这次 `shouldCompact` 返回 `true`。`_runAutoCompaction("threshold", false)` 发出 `compaction_start`，`reason` 为 `threshold`。
4. `prepareCompaction(pathEntries, settings)` 在投影上计算。它从后往前累计，在最后一条助手回答处达到 300 token，选择它作为切点，即 `firstKeptEntryId`。因为切点不是用户消息，所以是分裂跨度：`messagesToSummarize` 为第一轮的用户和助手消息，`turnPrefixMessages` 为第二轮的用户消息。
5. 发出 `session_before_compact` 扩展事件。本例没有扩展，因此使用默认摘要器。
6. `_runDefaultCompaction` 调用 `compact`。它先对历史发一次摘要请求，再对前缀发一次摘要请求，两次结果用分隔线合并。本例没有文件操作，因此不追加文件列表。
7. `sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, ...)` 追加压缩条目。前 5 个条目保持不变。发出 `compaction_end`：`tokensBefore` 为 2360，`estimatedTokensAfter` 为约 1735。
8. `_checkCompaction` 返回 `false`，`willRetry` 为 `false`，并且没有排队的消息。本次运行结束。
9. 之后的请求，投影是“系统提示、摘要、助手的回答”，再加上新的消息。

### 失败路径（源码路径，未单独运行）

如果摘要请求失败，例如模型返回 `error`，或摘要因为长度被截断：

1. `_runAutoCompaction` 的 `catch` 发出 `compaction_end`，`aborted` 为 `false`，`errorMessage` 为 `Auto-compaction failed: ...`（阈值压缩）或 `Context overflow recovery failed: ...`（溢出压缩）。
2. 同时发出 `session_compact_failed`。
3. 没有调用 `appendCompaction`，所以磁盘上没有新条目，投影也不变。
4. 阈值压缩不重试。下一次 `prompt` 开始时，`_checkCompaction` 会再检查一次。

### 溢出但回答完整（2500 字符案例）

实验 6 的 `d` 模式：提示是 6000 个 `x`，回答是 2500 个 `a`，模型正常结束（`stop`）。

输出（真实运行结果）：

```text
requests: 2 pending: 0
compaction_start: ["overflow"]
compaction_end: {"reason":"overflow","willRetry":false,"tokensBefore":3547,"estimatedTokensAfter":2058}
assistant input/output: 2922 625
```

过程：回答完整，所以 `willRetry` 为 `false`，代码不进入恢复分支（第 4 步）。`isContextOverflow` 的第二条规则发现 `input` 2922 超过窗口 2600，于是执行 `_runAutoCompaction("overflow", false)`。请求只有 2 次：回答本身，以及一次摘要请求。因为不走恢复分支，所以不写 `context_edit`，也不重试。

### 压缩前后：模型输入对照

下面是“如果不压缩”与“实际压缩后”两种情况下，下一次请求中模型看到的历史。

| 位置 | 压缩前（投影的 5 条消息） | 压缩后（投影的 3 条消息） |
| ---- | ------------------------- | ------------------------- |
| 1 | 系统提示（分节） | 同一份系统提示，分节未变 |
| 2 | 用户：`seed old history` | 被摘要替代 |
| 3 | 助手：2500 个字符 `a` | 被摘要替代 |
| 4 | 用户：`seed recent history` | 被摘要替代（分裂跨度的前缀） |
| 5 | 助手：1200 个字符 `b` | 助手：1200 个字符 `b`，即 `firstKeptEntryId` |
| 新增 | 无 | 压缩摘要（`compactionSummary`）：摘要文本 |
| 新输入（`next question`）后的请求 | 6 条：系统提示 + 4 条历史 + 新输入（实验 k） | 4 条：系统提示 + 摘要 + 保留的回答 + 新输入（实验 t） |
| 用量 | 约 2360 token（上一次用量） | 估算 1735（`estimatedTokensAfter`）；压缩后真实请求的 `input` 为 1781 |

发给模型时，压缩摘要会被 `convertToLlm` 包装成一条用户文本，前面是 `COMPACTION_SUMMARY_PREFIX`：

```text
The conversation history before this point was compacted into the following summary:

<summary>
...摘要文本...
</summary>
```

磁盘上的条目对照：

- 压缩前：`message:system`、`message:user`、`message:assistant`、`message:user`、`message:assistant`。
- 压缩后：同样 5 条，再加一条 `compaction`。原始消息没有被删除。

注意：实验输出中 `tokensBefore` 与 `estimatedTokensAfter` 在两次运行间可能相差 1 到 2 个 token，因为系统提示里有路径等与环境有关的内容。

## 动手实验

本篇所有实验都使用假模型（faux），不调用真实 API，也不需要密钥。

准备：

- 需要支持 `.mts` 与类型剥离的 Node。本地用 Node v23.9.0 验证。输出开头可能有一行 `ExperimentalWarning`（类型剥离的提示），可以忽略。
- 依赖缺失时，在仓库根执行 `npm install --ignore-scripts`。不要运行 `npm run build` 或完整测试套件。
- 脚本需要在仓库根目录运行，因为它用 `process.cwd()` 找到源码。

把下面的脚本保存为系统临时目录中的 `task09-exp/exp.mts`。Windows 上是 `$env:TEMP\task09-exp\exp.mts`，bash 中是 `$TEMP/task09-exp/exp.mts`。实验结束后按本节末尾的命令删除。

```ts
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const load = (rel: string) => import(pathToFileURL(join(process.cwd(), rel)).href);

if (mode === "a") {
  const comp = await load("packages/coding-agent/src/core/compaction/compaction.ts");
  const sp = await load("packages/coding-agent/src/core/system-prompt.ts");
  const sm = await load("packages/coding-agent/src/core/session-manager.ts");

  const s = { enabled: true, reserveTokens: 200, keepRecentTokens: 100 };
  console.log("1a shouldCompact(850, 1000, s):", comp.shouldCompact(850, 1000, s));
  console.log("1b enabled=false:", comp.shouldCompact(850, 1000, { ...s, enabled: false }));
  console.log("1c at the boundary 800:", comp.shouldCompact(800, 1000, s));
  console.log("1d defaults:", JSON.stringify(comp.DEFAULT_COMPACTION_SETTINGS));
  console.log("1e window 200000, 183616:", comp.shouldCompact(183616, 200000, comp.DEFAULT_COMPACTION_SETTINGS));
  console.log("1f window 200000, 183617:", comp.shouldCompact(183617, 200000, comp.DEFAULT_COMPACTION_SETTINGS));

  const input = {
    cwd: "C:/demo",
    selectedTools: ["read", "bash", "edit", "write"],
    toolSnippets: { read: "Read file contents", bash: "Execute bash commands", edit: "Make precise edits", write: "Create or overwrite files" },
    contextFiles: [{ path: "C:/demo/AGENTS.md", content: "请只读当前目录" }],
  };
  const withFile = sp.buildSystemPromptSections(input);
  const withoutFile = sp.buildSystemPromptSections({ ...input, contextFiles: [] });
  console.log("2a sections:", Object.keys(withFile).join(", "));
  console.log("2b cwd section:", JSON.stringify(withFile.cwd));
  console.log("2c patch after removing AGENTS.md:", JSON.stringify(sp.diffSystemPromptSections(withFile, withoutFile)));
  console.log("2d patch when nothing changed:", sp.diffSystemPromptSections(withFile, withFile));
  console.log("2e forced prompt state:", JSON.stringify(sp.buildSystemPromptState({ cwd: "C:/demo", forceSystemPrompt: "FORCED" })));

  const m = sm.SessionManager.inMemory("C:/demo");
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const user = (text: string, t: number) => ({ role: "user", content: text, timestamp: t });
  const asst = (text: string, t: number) => ({ role: "assistant", content: [{ type: "text", text }], api: "faux", provider: "faux", model: "faux-1", usage, stopReason: "stop", timestamp: t });
  m.appendMessage(user("early question", 1));
  m.appendMessage(asst("early answer", 2));
  const keep = m.appendMessage(user("recent question", 3));
  m.appendMessage(asst("recent answer", 4));
  const show = (label: string) =>
    console.log(label, JSON.stringify(m.buildSessionContext().messages.map((x: any) =>
      x.role === "compactionSummary" ? ["compactionSummary", x.summary] : [x.role, typeof x.content === "string" ? x.content : x.content.map((c: any) => c.text).join("")])));
  show("3a before:");
  m.appendCompaction("## Goal\nsummary of early turn", keep, 1234);
  show("3b after:");
  console.log("3c entry types:", m.getEntries().map((e: any) => e.type).join(","));
  console.log("3d early question still stored:", m.getEntries().some((e: any) => e.message?.content === "early question"));
} else if (mode === "b") {
  const { createHarness } = await load("packages/coding-agent/test/suite/harness.ts");
  const { fauxAssistantMessage } = await load("packages/ai/dist/compat.js");

  // Window 2600 - reserve 400 = 2200 allowed. Turn 2 usage is 2360, so the threshold fires.
  const h = await createHarness({
    models: [{ id: "faux-1", contextWindow: 2600, maxTokens: 100 }],
    settings: { compaction: { enabled: true, reserveTokens: 400, keepRecentTokens: 300 } },
  });
  const requests: string[] = [];
  const replies = [
    "a".repeat(2500),
    "b".repeat(1200),
    "## Goal\nsummary of the older turns",
    "answer for the split turn",
    "fourth answer",
  ];
  h.setResponses(
    replies.map((text) => (context: any) => {
      const last = context.messages.at(-1);
      const body = typeof last?.content === "string" ? last.content : last?.content?.[0]?.text ?? "";
      requests.push(`${context.messages.length} messages, last ${last?.role}: ${JSON.stringify(body.slice(0, 40))}`);
      return fauxAssistantMessage(text);
    }),
  );
  await h.session.prompt("seed old history");
  await h.session.prompt("seed recent history");

  console.log("faux requests:", requests.length, "pending:", h.getPendingResponseCount());
  requests.forEach((line, i) => console.log(`request ${i + 1}: ${line}`));
  console.log("compaction_start:", JSON.stringify(h.eventsOfType("compaction_start").map((e: any) => e.reason)));
  const end: any = h.eventsOfType("compaction_end").at(-1);
  console.log("compaction_end:", JSON.stringify({ reason: end?.reason, aborted: end?.aborted, willRetry: end?.willRetry, tokensBefore: end?.result?.tokensBefore, estimatedTokensAfter: end?.result?.estimatedTokensAfter }));
  const entries: any[] = h.sessionManager.getEntries();
  console.log("entries:", entries.map((e) => e.type + (e.type === "message" ? ":" + e.message.role : "")).join(" | "));
  const comp = entries.find((e) => e.type === "compaction");
  if (comp) {
    console.log("firstKeptEntry role:", entries.find((e) => e.id === comp.firstKeptEntryId)?.message?.role);
    console.log("summary:", JSON.stringify(comp.summary));
  }
  console.log("projection roles:", h.sessionManager.buildSessionContext().messages.map((x: any) => x.role).join(","));
  h.cleanup();
} else if (mode === "c") {
  const { createHarness } = await load("packages/coding-agent/test/suite/harness.ts");
  const { fauxAssistantMessage } = await load("packages/ai/dist/compat.js");

  // A length stop below the desired max output is a recoverable overflow.
  const h = await createHarness({
    models: [{ id: "faux-1", contextWindow: 1000, maxTokens: 100 }],
    settings: { compaction: { keepRecentTokens: 1, reserveTokens: 0 } },
  });
  h.setResponses([
    fauxAssistantMessage("partial response", { stopReason: "length" }),
    fauxAssistantMessage("## Goal\nsummary of the long prompt"),
    fauxAssistantMessage("completed response"),
  ]);
  await h.session.prompt("x".repeat(5000));
  console.log("faux requests:", h.faux.state.callCount);
  console.log("compaction_start:", JSON.stringify(h.eventsOfType("compaction_start").map((e: any) => e.reason)));
  const end: any = h.eventsOfType("compaction_end").at(-1);
  console.log("compaction_end:", JSON.stringify({ reason: end?.reason, aborted: end?.aborted, willRetry: end?.willRetry, tokensBefore: end?.result?.tokensBefore }));
  console.log("entries:", h.sessionManager.getEntries().map((e: any) => e.type + (e.type === "message" ? ":" + e.message.role : "")).join(" | "));
  console.log("last assistant:", h.session.getLastAssistantText());
  h.cleanup();
} else {
  throw new Error("usage: node exp.mts a|b|c");
}
```

### 实验 1：阈值判断（5 分钟）

目的：确认阈值公式、严格大于和默认值。

步骤：PowerShell 中执行 `node "$env:TEMP\task09-exp\exp.mts" a`，bash 中执行 `node "$TEMP/task09-exp/exp.mts" a`。只看以 `1` 开头的几行。

预期输出（前 6 行，真实运行结果）：

```text
1a shouldCompact(850, 1000, s): true
1b enabled=false: false
1c at the boundary 800: false
1d defaults: {"enabled":true,"reserveTokens":16384,"keepRecentTokens":20000}
1e window 200000, 183616: false
1f window 200000, 183617: true
```

观察：`800` 恰好等于 `1000 - 200`，不触发。这说明判断是严格大于。

### 实验 2：系统提示的分节与补丁

目的：看到分节名字、补丁形状和 `forceSystemPrompt` 的区别。

步骤：同一命令 `a`，看以 `2` 开头的几行。

预期输出（真实运行结果）：

```text
2a sections: preamble, tools, rules, docs, project_context, cwd
2b cwd section: "<cwd>\nC:/demo\n</cwd>"
2c patch after removing AGENTS.md: {"project_context":null}
2d patch when nothing changed: undefined
2e forced prompt state: {"content":"FORCED"}
```

观察与思考：

- 2c 只删除了 `project_context`。其余分节没有出现在补丁里。
- 2d 没有变化时返回 `undefined`，因此没有新的系统消息写入转录。
- 2e 的 `forceSystemPrompt` 只有 `content`，没有分节，无法打补丁。
- 字符数不能直接当作 token 数。`estimateTokens` 用字符数除以 4 粗估，中文可能偏差较大（见选读）。

### 实验 3：压缩前后的投影对照（不调用模型）

目的：确认压缩条目只改变投影，不删除原始条目。

步骤：命令 `a`，看以 `3` 开头的几行。

预期输出（真实运行结果）：

```text
3a before: [["user","early question"],["assistant","early answer"],["user","recent question"],["assistant","recent answer"]]
3b after: [["compactionSummary","## Goal\nsummary of early turn"],["user","recent question"],["assistant","recent answer"]]
3c entry types: message,message,message,message,compaction
3d early question still stored: true
```

观察：压缩条目的 `firstKeptEntryId` 指向 `recent question`。之前的两条消息被摘要替代，但仍在条目列表中。

### 实验 4：假模型触发阈值压缩

目的：从真实的会话 `prompt()` 流程看到阈值压缩，并数清模型请求。

步骤：命令 `b`。

预期输出（真实运行结果；数值可能有 1 到 2 个 token 的波动）：

```text
faux requests: 4 pending: 1
request 1: 2 messages, last user: "seed old history"
request 2: 4 messages, last user: "seed recent history"
request 3: 2 messages, last user: "<conversation>\n[User]: seed old history\n"
request 4: 2 messages, last user: "# Conversation\n[User]: seed recent histo"
compaction_start: ["threshold"]
compaction_end: {"reason":"threshold","aborted":false,"willRetry":false,"tokensBefore":2360,"estimatedTokensAfter":1735}
entries: message:system | message:user | message:assistant | message:user | message:assistant | compaction
firstKeptEntry role: assistant
summary: "## Goal\nsummary of the older turns\n\n---\n\n**Turn Context (split turn):**\n\nanswer for the split turn"
projection roles: system,compactionSummary,assistant
```

观察与思考：

- 请求 3 是历史摘要，请求 4 是分裂跨度前缀的摘要。它们的提示词格式不同：前者以 `<conversation>` 开头，后者以 `# Conversation` 开头。这两次调用都经过同一个 `completeSummarization`。
- 第 5 个假回答没有被消费，因为压缩后没有新的模型请求。
- 把 `keepRecentTokens` 改为 1750 再运行一次：2360 的用量仍超过阈值，但没有任何压缩事件。原因是非系统消息的估算总量只有 934 token，低于 1750。`findProjectedCutPoint` 从后往前累计时达不到预算，切点停在第一个合法点，摘要区为空，`prepareCompaction` 返回 `undefined`，不发任何事件（实验 6 的 `e` 模式复现了这一点）。

### 实验 5：长度截断的溢出恢复

目的：看到截断回答触发的恢复压缩，并确认失败的回答被省略，而不是删除。

步骤：命令 `c`。

预期输出（真实运行结果）：

```text
faux requests: 3
compaction_start: ["overflow"]
compaction_end: {"reason":"overflow","aborted":false,"willRetry":true,"tokensBefore":2661}
entries: message:system | message:user | message:assistant | context_edit | compaction | message:assistant
last assistant: completed response
```

观察与思考：

- 三次请求分别是：被截断的回答、摘要请求、重试的回答。
- `context_edit` 排在压缩条目之前。它把被截断的回答从投影中省略，但它仍在条目列表里。
- `willRetry` 为 `true`，所以压缩结束后 pi 会自动重试一次。

### 实验 6：保存的边界脚本（溢出完整回答、无事件、新输入后的请求数）

目的：复现两个边界。`d` 模式：回答完整，但输入超过窗口。`e` 模式：用量超过阈值，但历史太短，没有压缩事件。`t` 与 `k` 对照新输入后的请求消息数：压缩后 4 条，压缩前 6 条。

步骤：把下面的脚本保存为系统临时目录中的 `task09-exp/exp-boundary.mts`。在仓库根执行。PowerShell 中是 `node "$env:TEMP\task09-exp\exp-boundary.mts" d`；bash 中是 `node "$TEMP/task09-exp/exp-boundary.mts" d`。把最后的 `d` 换成 `e`、`t` 或 `k` 即可运行其他模式。

```ts
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Run from the repository root: node exp-boundary.mts t|k|d|e
const mode = process.argv[2];
const load = (rel: string) => import(pathToFileURL(join(process.cwd(), rel)).href);
const { createHarness } = await load("packages/coding-agent/test/suite/harness.ts");
const { fauxAssistantMessage } = await load("packages/ai/dist/compat.js");

// Context window 2600 and reserveTokens 400, so the threshold is 2200.
const models = [{ id: "faux-1", contextWindow: 2600, maxTokens: 100 }];
const compaction = (enabled: boolean, keepRecentTokens: number) => ({ compaction: { enabled, reserveTokens: 400, keepRecentTokens } });

// Each reply logs how many messages (system included) the model received.
const logged = (replies: string[]) =>
  replies.map((text, i) => (context: any) => {
    console.log(`request ${i + 1}: ${context.messages.length} messages`);
    return fauxAssistantMessage(text);
  });

const report = (h: any) => {
  console.log("requests:", h.faux.state.callCount, "pending:", h.getPendingResponseCount());
  console.log("compaction_start:", JSON.stringify(h.eventsOfType("compaction_start").map((e: any) => e.reason)));
  const end: any = h.eventsOfType("compaction_end").at(-1);
  console.log("compaction_end:", JSON.stringify({ reason: end?.reason, willRetry: end?.willRetry, tokensBefore: end?.result?.tokensBefore, estimatedTokensAfter: end?.result?.estimatedTokensAfter }));
  for (const e of h.sessionManager.getEntries().filter((x: any) => x.type === "message" && x.message.role === "assistant")) {
    console.log("assistant input/output:", e.message.usage.input, e.message.usage.output);
  }
  h.cleanup();
};

if (mode === "t" || mode === "k") {
  // t: threshold compaction (keepRecentTokens 300), then a third prompt. k: same prompts, compaction disabled.
  const enabled = mode === "t";
  const h = await createHarness({ models, settings: compaction(enabled, 300) });
  h.setResponses(logged(enabled ? ["a".repeat(2500), "b".repeat(1200), "## Goal\nsummary of the older turns", "answer for the split turn", "fourth answer"] : ["a".repeat(2500), "b".repeat(1200), "next answer"]));
  await h.session.prompt("seed old history");
  await h.session.prompt("seed recent history");
  await h.session.prompt("next question");
  report(h);
  console.log("projection roles:", h.sessionManager.buildSessionContext().messages.map((x: any) => x.role).join(","));
} else if (mode === "d") {
  // A 2500-character reply that completes (stop) while the input alone is over 2600 tokens.
  const h = await createHarness({ models, settings: compaction(true, 300) });
  h.setResponses([fauxAssistantMessage("a".repeat(2500)), fauxAssistantMessage("## Goal\nsummary of the long prompt")]);
  await h.session.prompt("x".repeat(6000));
  report(h);
} else if (mode === "e") {
  // Usage crosses 2200, but keepRecentTokens (1750) is larger than all message tokens, so no event.
  const h = await createHarness({ models, settings: compaction(true, 1750) });
  h.setResponses([fauxAssistantMessage("a".repeat(2500)), fauxAssistantMessage("b".repeat(1200))]);
  await h.session.prompt("seed old history");
  await h.session.prompt("seed recent history");
  report(h);
} else {
  throw new Error("usage: node exp-boundary.mts t|k|d|e");
}
```

预期输出（真实运行结果，即本次运行的输出）：

```text
# t
request 1: 2 messages
request 2: 4 messages
request 3: 2 messages
request 4: 2 messages
request 5: 4 messages
requests: 5 pending: 0
compaction_start: ["threshold"]
compaction_end: {"reason":"threshold","willRetry":false,"tokensBefore":2360,"estimatedTokensAfter":1735}
assistant input/output: 1426 625
assistant input/output: 2060 300
assistant input/output: 1781 4
projection roles: system,compactionSummary,assistant,user,assistant
# k
request 1: 2 messages
request 2: 4 messages
request 3: 6 messages
requests: 3 pending: 0
compaction_start: []
compaction_end: {}
assistant input/output: 1426 625
assistant input/output: 2060 300
assistant input/output: 2368 3
projection roles: system,user,assistant,user,assistant,user,assistant
# d
requests: 2 pending: 0
compaction_start: ["overflow"]
compaction_end: {"reason":"overflow","willRetry":false,"tokensBefore":3547,"estimatedTokensAfter":2058}
assistant input/output: 2922 625
# e
requests: 2 pending: 0
compaction_start: []
compaction_end: {}
assistant input/output: 1426 625
assistant input/output: 2060 300
```

观察与思考：

- `t` 中新输入的请求有 4 条消息；`k` 中同一位置有 6 条。压缩后投影变短，但原始消息仍在磁盘上。
- `d` 中 `input` 为 2922，超过 2600，所以 `reason` 是 `overflow`，`willRetry` 为 `false`。
- `e` 中第二次用量为 2360，超过 2200，但没有 `compaction_start` 事件，原因见实验 4 之后的 `keepRecentTokens` 说明。
- 这些数字来自本地运行。`estimatedTokensAfter` 在两次运行间可能有 1 个 token 的波动（另一次运行得到 1736）。

### 清理

PowerShell：

```powershell
Remove-Item -Recurse -Force "$env:TEMP\task09-exp"
```

bash：

```bash
rm -rf "$TEMP/task09-exp"
```

## 自测题

1. 窗口 8000，预留 1000，上下文用量 7000。会触发自动压缩吗？为什么？
2. 系统提示为什么要分节？如果把整段提示当成一个字符串，会出现什么问题？
3. 切点为什么不能落在工具结果上？请举一个模型会看错的例子。
4. 压缩之后，磁盘上的原始消息还在吗？模型下一次请求看到的是什么？
5. 溢出后 pi 最多重试几次？如果恢复压缩失败，省略编辑还保留吗？

### 参考答案

1. 不会。阈值是 `8000 - 1000 = 7000`，判断是严格大于，7000 不大于 7000。
2. 分节让每个部分有名字，可以单独替换或删除。会话只记录补丁，不必每次重发整段。如果是一整个字符串，任何变化都要整段重发，也无法知道哪一部分变了。
3. 工具结果必须和发出它的调用在一起。如果切点落在结果上，保留下来的结果没有对应的调用。例如模型看到“文件内容是 X”，却不知道是哪次 `read` 得到的。
4. 还在。压缩只追加一条压缩条目，并改写投影。模型下一次请求看到的是系统提示、摘要和保留边界之后的消息。
5. 只重试一次。恢复失败时，省略编辑保留，因此失败的回答不会回到上下文中；pi 不写压缩条目，也不安排内部重试。

## 常见错误

- 现象：窗口还没满，却触发了压缩。
  原因：默认 `reserveTokens` 为 16384，阈值是窗口减去它。小窗口模型的阈值会很低。
  解决：调整 `compaction.reserveTokens`，或在 `compaction.modelOverrides` 中为该模型设置精确的 `provider/modelId`。不要修改判断代码。

- 现象：用量超过阈值，但没有任何压缩事件。
  原因：历史总量比 `keepRecentTokens` 还小，`prepareCompaction` 找不到可摘要的消息，于是返回 `undefined`，不发任何事件（实验 4 的对照）。
  解决：降低 `keepRecentTokens`，或确认历史确实足够长。

- 现象：压缩事件的 `reason` 是 `overflow`，而不是 `threshold`，并且没有重试。
  原因：最后一条回答已经完整（`stopReason` 为 `stop`），但它的用量超过了窗口。这是推断溢出，压缩后不重试，因为 `continue` 不能接在完整回答后面。
  解决：这不是错误。减少输入，或换用窗口更大的模型。

- 现象：压缩后模型忘了某个细节。
  原因：摘要是按固定骨架写的，没有进入摘要的细节会丢失。
  解决：把需要长期保留的事实写入文件（例如 AGENTS.md），或用 `/compact <指令>` 指定摘要的重点。可以检查摘要末尾的 `<read-files>` 和 `<modified-files>` 是否包含需要的文件。

- 现象：`modelOverrides` 写了，但没有生效。
  原因：键必须是精确的 `provider/modelId`，例如 `faux/faux-1`。大小写或前缀不对就不会匹配。
  解决：使用 `packages/coding-agent/docs/settings.md` 中描述的完整键名。

## 选读：源码深入（可选，跳过不影响主线）

以下内容超出主线，供需要时查阅。每一段都标明了对应的源码符号。

### A. 系统提示的细节

- `normalizeBuildSystemPromptOptions` 对数组和对象做拷贝。扩展的 `before_agent_start` 处理器可以修改这些集合，但不会影响调用方传入的原对象。
- `buildRules` 用 `Set` 去重，比较时先 `trim()`。只要 `grep`、`find`、`ls` 中有一个被选中，就不加“用 shell 做文件操作”的规则。因此禁用 `grep` 会改变 `rules` 分节。这是规则组合变化的结果，不是 bug。
- 调用方传入的 `sections` 可以覆盖内置分节（例如 `rules`）。构建函数只校验名字是否匹配 `^[a-z][a-z0-9_-]*$`，并且不能叫 `preamble`，不做其他保护。
- `renderProjectContext` 不转义内容。如果 AGENTS.md 中写了 `</project_instructions>`，标签会提前闭合。标签是给模型的结构提示，不是安全边界。
- `buildSystemPromptState` 用 `forceSystemPrompt !== undefined` 判断，因此空字符串也算强制覆盖。
- `diffSystemPromptSections` 按字符串全等比较。分节中只要有一个字符变化，整段都会进入补丁。把每轮都变的内容（例如当前时间）放进分节，会让每一轮都整段重发。

### B. token 估算

- `calculateContextTokens` 写作 `usage.totalTokens || 分项之和`。`totalTokens` 为 0 时也会走分项求和。
- `estimateTokens` 用字符数除以 4，图片固定按 4800 字符计算。源码注释说它偏保守。对中文文本，一个汉字通常不止 0.25 个 token，因此中文估算可能偏小。未在本地验证，需要用真实用量校对。
- `estimateContextTokens` 有用量时，用“最后一条用量 + 之后消息的估算”。
- `estimateProjectedContextTokens` 在有编辑时使用。如果最后一条用量早于某次编辑或压缩，它不信任这条用量。

### C. `_checkCompaction` 的判断链

按顺序：

1. `settings.enabled` 为 `false` 时直接返回。
2. 用户取消的回答（`aborted`）不触发压缩。`skipAbortedCheck` 在 turn 结束后为 `true`，在 prompt 前为 `false`，因为新输入即将发出，必须检查。
3. `sameModel`：消息的模型与当前模型不同，就不做溢出判断。旧模型的溢出错误不应触发新模型的压缩。
4. `assistantIsFromBeforeCompaction`：消息时间戳早于最近的压缩条目，直接返回 `false`。
5. `assistantIsProjected` 与 `hasPostAssistantContextEdit`：已被省略或之后有编辑的消息，用量不再可信。
6. `assistantRetainedForExplicitRecovery`：显式错误只有在失败消息仍在上下文中时才恢复。
7. 三种 token 口径（见核心概念 3）。

### D. `_runAutoCompaction` 的执行过程

- 发出 `compaction_start`，创建 `AbortController`。`abortCompaction()` 可以取消它。
- 发出 `session_before_compact` 扩展事件，载荷包括 `preparation`、`branchEntries`、`reason`、`willRetry` 和 `signal`。扩展可以返回 `cancel`（按取消处理），也可以返回自定义的 `compaction`，此时跳过默认摘要器。
- 默认路径调用 `_runDefaultCompaction`，它与手动 `/compact` 共用。
- `appendCompaction` 写入条目。然后发出 `session_compact`（扩展视角，带条目对象），再发出 `compaction_end`（界面视角，带结果）。
- 失败时，`compaction_end` 的 `errorMessage` 按 `reason` 区分，文案分别是 “Context overflow recovery failed: ...” 和 “Auto-compaction failed: ...”。同时发出 `session_compact_failed`。
- 返回值有两种含义：`willRetry` 为真时，调用方续跑（溢出恢复）；否则，如果有排队的消息（`hasQueuedMessages()`），续跑一次把它们交付。
- `finally` 只清理自己的 `AbortController`，并唤醒等待空闲的调用方。

### E. 切点的细节

- `findCutPoint`（原始条目）与 `findProjectedCutPoint`（投影条目）的累计与切点规则相同。投影版还处理溢出恢复后的省略尾部：只有当尾部全是被省略的不可见条目、包含被省略的助手尝试、并且没有外部替换时，切点才前移一格。
- 紧挨切点之前的元数据条目（例如模型切换）会并入保留区，不会出现在保留区开头。
- 压缩条目既不是切点，也不作为新摘要的素材。新摘要的起点是上一次的保留边界，而不是压缩条目本身。

### F. 摘要的合并与用量

- 分裂跨度时，如果没有更早的历史，`historyText` 默认为字符串 `"No prior history."`。如果有旧摘要，就用旧摘要。
- 前缀摘要的提示词要求只概括切点之前的内容，不要重造后面的消息。它没有“更新”版本，因为前缀是一次性切出来的。
- 两次摘要的用量用 `combineUsage` 相加。
- `/compact` 的指令只传给历史摘要，不传给前缀摘要。
- 需要纯文本时，`generateSummary` 返回摘要文本，`generateSummaryWithUsage` 返回 `{ text, usage }`。

### G. 文件列表

- `extractFileOperations` 先从上一次压缩的详情中继承 `readFiles` 与 `modifiedFiles`。前提是上一次压缩不是扩展生成的（`fromHook` 为假）。
- `extractFileOpsFromMessage` 只识别 `read`、`write`、`edit` 三个工具名，并且参数中要有字符串 `path`。`bash` 的 `command` 不会被追踪。
- `computeFileLists` 中，只读列表等于 `read` 减去 `modified`，两个列表都排序，输出确定。
- 被修改过的文件只出现在 `modifiedFiles`。这样下一轮模型不会以为它看到的是最新内容。

### H. 扩展钩子与分支摘要

- 扩展事件类型 `session_before_compact`、`session_compact_failed`、`session_before_tree` 定义在 `packages/coding-agent/src/core/extensions/types.ts`。
- 分支摘要：`/tree` 切换分支时，可以对被放弃的路径生成摘要。实现在 `packages/coding-agent/src/core/compaction/branch-summarization.ts`，符号包括 `collectEntriesForBranchSummary`、`prepareBranchEntries`、`generateBranchSummary`。本篇只确认了这些符号存在，没有逐行阅读其行为，未在本地验证。

### I. TypeScript 小课：`?.`、`??` 与 `||`

`?.` 在左侧为 `null` 或 `undefined` 时停止读取属性，结果为 `undefined`。`??` 只在值为 `null` 或 `undefined` 时使用默认值。`||` 对所有假值（包括 `0`）都使用默认值。

压缩设置里 `0` 可能是有效值，比如 `reserveTokens: 0`。这时要用 `??`，不能用 `||`：

```typescript
type Config = { compaction?: { reserveTokens?: number } };
const config: Config = { compaction: { reserveTokens: 0 } };
const reserve = config.compaction?.reserveTokens ?? 200; // 保留明确设置的 0
const wrong = config.compaction?.reserveTokens || 200; // 0 被错误替换成 200
console.assert(reserve === 0 && wrong === 200);
```

练习：把配置改为 `{}`，两个表达式都得到 200。再想一想，源码中 `calculateContextTokens` 的 `||` 为什么可以接受（提示：分项之和也是 0）。

## 下一篇

下一步要解决的问题：压缩阈值等设置从哪里来，项目指令文件（如 AGENTS.md）如何被发现，以及为什么项目文件需要人工信任。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| ---- | ---------- | -------------- |
| 上下文窗口（context window） | 模型一次请求能接收的 token 上限 | 核心概念 1 |
| token | 模型计量文本的基本单位 | 核心概念 1 |
| 预留（reserveTokens） | 为模型回答留出的窗口空间 | 核心概念 1 |
| 系统提示分节（section） | 有名字、可单独替换的系统提示段 | 核心概念 2 |
| 补丁（patch） | 只包含变化分节的系统消息，`null` 表示删除 | 核心概念 2 |
| 压缩阈值（threshold） | 判断是否自动压缩的不等式 | 核心概念 3 |
| 切点（cut point） | 保留区与摘要区的分界消息 | 核心概念 4 |
| 合法切点 | 允许作为切点的消息类型，工具结果除外 | 核心概念 4 |
| 分裂跨度（split turn） | 切点落在一轮用户请求中间的情况 | 核心概念 4 |
| 摘要请求（summary request） | 压缩时发给模型的一次专用调用 | 核心概念 4 |
| 压缩条目（compaction entry） | 会话文件中记录摘要与保留边界的一行 | 核心概念 5 |
| 投影（projection） | 模型实际看到的历史，由条目计算得出 | 核心概念 5 |
| 溢出恢复（overflow recovery） | 溢出或截断后压缩并重试一次 | 核心概念 6 |
| 省略编辑（context_edit） | 把失败尝试从投影中去掉的条目 | 核心概念 6 |
