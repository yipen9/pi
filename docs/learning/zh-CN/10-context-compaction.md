# 第 10 章：上下文构造、系统提示与压缩

> 学完本章你能回答：
>
> 1. 系统提示是怎么"分节组装"的？为什么它能被增量补丁修改？
> 2. 上下文什么时候算"告急"？触发条件用哪个公式、哪个默认值？
> 3. 一次压缩的完整流程是什么？"切点"如何选、`firstKeptEntryId` 如何定？
> 4. 摘要请求长什么样？为什么它不会被模型当成"对话继续"？
> 5. 溢出恢复与自动重试的顺序是什么？失败了会怎样？

**前置知识**：第 4 章（系统消息与 sections）、第 6 章（重试）、第 9 章（投影流水线）。
**预计学习时间**：2 天（压缩是"长会话可用性"的核心机制，值得精读）。
**本章验证状态**：静态核对通过（`system-prompt.ts`、`compaction/compaction.ts` 关键函数与 `compaction.md` 核对）；实验 L07 设计中。

---

## 10.1 系统提示：分节组装，而不是"一个大字符串"

模型请求里的系统提示不是常量，而是每次按"输入状态"现算的**分节结构**。入口在 `packages/coding-agent/src/core/system-prompt.ts`。

### 10.1.1 输入：`BuildSystemPromptOptions`

```typescript
export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces the default prefix). */
	customPrompt?: string;
	/** Exact full prompt replacement set by a before_agent_start handler. */
	forceSystemPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write]. */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Guideline bullets contributed by each tool, keyed by tool name. */
	toolGuidelines?: Record<string, string[]>;
	/** Additional guideline bullets appended to the default system prompt rules. */
	promptGuidelines?: string[];
	/** Text appended from user configuration before project context, skills, and cwd. */
	appendSystemPrompt?: string;
	/** Additional XML-wrapped prompt sections keyed by tag name. */
	sections?: Record<string, string>;
	/** Working directory. */
	cwd: string;
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
}
```

注意 `toolSnippets` 与 `toolGuidelines`**按工具名索引**——第 7 章 `read.ts` 里的 `readToolSystemPromptContribution` 就是数据来源。**提示词是工具定义的投影**：工具写得好，提示词自然到位；这是"单一来源"的又一例。

### 10.1.2 组装：`buildSystemPromptSections`

核心函数逐段读（节选 + 注释）：

```typescript
const SYSTEM_PROMPT_SECTION_NAME = /^[a-z][a-z0-9_-]*$/;

export function buildSystemPromptSections(input: BuildSystemPromptOptions): SystemPromptSections {
	const options = normalizeBuildSystemPromptOptions(input);
	// ... 解构 ...

	// ① 自定义 section 名必须合法（小写字母开头，字母数字下划线连字符）；preamble 是保留名
	for (const name of Object.keys(customSections)) {
		if (!SYSTEM_PROMPT_SECTION_NAME.test(name) || name === "preamble") {
			throw new Error(`Invalid system prompt section name: ${name}`);
		}
	}

	const promptSections: Record<string, string> = {};
	if (customPrompt) {
		promptSections.preamble = customPrompt;      // 用户完全替换开头段
	} else {
		// ② 默认 preamble：身份与总体职责
		promptSections.preamble =
			"You are an expert coding assistant operating inside pi, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.";
		// ③ 工具速览：只列出"有 snippet"的工具
		const visibleTools = selectedTools.filter((name) => !!toolSnippets[name]);
		const tools = visibleTools.length > 0
			? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n")
			: "(none)";
		promptSections.tools = `${tools}\n\nIn addition to the tools above, you may have access to other custom tools depending on the project.`;
		// ④ 规则：按已选工具生成（含一些"没有 grep 时用 bash 找文件"的条件规则）
		promptSections.rules = buildRules(selectedTools, toolGuidelines, promptGuidelines);
		// ⑤ pi 自身文档的索引（让模型能回答"pi 怎么用"）
		promptSections.docs = `Pi documentation (read only when the user asks about pi itself, ...): ...`;
	}

	if (appendSystemPrompt) promptSections.addendum = appendSystemPrompt;
	// ⑥ 项目上下文文件（AGENTS.md 等）包在 <project_instructions path="..."> 标签里
	if (contextFiles.length > 0) promptSections.project_context = renderProjectContext(contextFiles);
	// ⑦ 技能：按"有 read 或 bash 可读技能文件"为条件生成
	const skillFileReadTool = (["read", "bash"] as const).find((tool) => selectedTools.includes(tool));
	if (skillFileReadTool && skills.length > 0) {
		const skillsPrompt = formatSkillsForPrompt(skills, skillFileReadTool).trim();
		if (skillsPrompt) promptSections.skills = skillsPrompt;
	}
	// ⑧ 工作目录（统一用正斜杠）
	promptSections.cwd = cwd.replace(/\\/g, "/");
	// ⑨ 自定义 sections 最后覆盖
	for (const [name, content] of Object.entries(customSections)) {
		if (content) promptSections[name] = content;
	}

	// ⑩ 除 preamble 外，每个 section 都包一层与名字相同的标签
	const sections: SystemPromptSections = { preamble: promptSections.preamble };
	for (const [name, content] of Object.entries(promptSections)) {
		if (name !== "preamble") sections[name] = `<${name}>\n${content}\n</${name}>`;
	}
	return sections;
}
```

七种内置 section 一览：

| section             | 内容                 | 关键点                                       |
| ------------------- | -------------------- | -------------------------------------------- |
| `preamble`        | 身份与总职责         | **唯一不加标签**的 section             |
| `tools`           | 工具速览             | 只列有 snippet 的；提示"可能还有自定义工具"  |
| `rules`           | 行为准则             | 由工具 guidelines + 通用规则去重生成         |
| `docs`            | pi 文档索引          | 让模型知道去哪里读 pi 自己的文档             |
| `addendum`        | 用户追加文本         | 来自设置                                     |
| `project_context` | AGENTS.md 等项目指令 | 包`<project_instructions path="...">` 标签 |
| `skills`          | 技能清单             | 条件：已选 read 或 bash 工具                 |
| `cwd`             | 工作目录             | 反斜杠统一转正斜杠                           |

**为什么每个 section 都包标签？** 因为第 4 章的补丁机制靠"按名字替换"工作：`<skills>...</skills>` 这样的自定界标签让模型能把"后来的更新"与"原来的内容"对应起来（`message-types.md` 的注释也提醒过：section 要自定界，避免用纯数字名）。

### 10.1.3 两种形态：结构化 vs 强制覆盖

```typescript
export function buildSystemPromptState(input: BuildSystemPromptOptions): { content: string; sections?: SystemPromptSections } {
	if (input.forceSystemPrompt !== undefined) return { content: input.forceSystemPrompt };  // 整体覆盖，无 sections
	return { content: "", sections: buildSystemPromptSections(input) };
}
```

- **普通形态**：`content` 为空，prompt 全部在 `sections` 里 → 可以增量打补丁；
- **强制形态**（`forceSystemPrompt`，扩展在 `before_agent_start` 里设置）：`content` 是完整提示词、没有 sections → **不可分节补丁**，每次变化都是整段替换。这是"扩展想要完全控制"的逃生门。

`buildSystemPrompt` 则把状态渲染成与转录回放完全一致的文本（`getSystemMessageText`）——保证"你看到的就是模型看到的"。

### 10.1.4 增量演化：`diffSystemPromptSections`

系统提示随会话演化（技能启用、工具变化、追加指令……）。会话不需要重发全部，而是算补丁：

```typescript
export function diffSystemPromptSections(
	previous: Record<string, string | null>,
	current: SystemPromptSections,
): Record<string, string | null> | undefined {
	const patch: Record<string, string | null> = {};
	for (const [name, text] of Object.entries(current)) {
		if (previous[name] !== text) patch[name] = text;          // 变了的：新内容
	}
	for (const name of Object.keys(previous)) {
		if (current[name] === undefined) patch[name] = null;      // 消失的：null 表示删除
	}
	return Object.keys(patch).length > 0 ? patch : undefined;      // 没变：undefined（不写历史）
}
```

这与第 3 章 `declareToolChanges` 对工具做的是同一件事，只是对象换成提示词分节。**"可回放 + 增量补丁"是本仓库贯穿一致的模式。**

## 10.2 上下文什么时候"告急"

### 10.2.1 判定公式与默认值

`core/compaction/compaction.ts`：

```typescript
export interface CompactionSettings {
	enabled: boolean;
	reserveTokens: number;
	keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16384,     // 给模型回复预留的空间
	keepRecentTokens: 20000,  // 压缩后至少保留的近期上下文
};

export function shouldCompact(contextTokens: number, contextWindow: number, settings: CompactionSettings): boolean {
	if (!settings.enabled) return false;
	return contextTokens > contextWindow - settings.reserveTokens;
}
```

记住这个不等式：

```text
上下文 token 数 > 模型上下文窗口 - 16384  → 触发自动压缩
```

`contextWindow` 来自 `Model` 元数据（第 5.3 节），`reserveTokens`/`keepRecentTokens` 可在设置里覆盖（全局或项目级，`settings.json`）。

### 10.2.2 token 数怎么估

两个来源，优先级不同：

1. **真实用量**（`calculateContextTokens`）：

```typescript
export function calculateContextTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
```

   来自**上一次助手消息的 `usage`**——这是供应商报的真实数字，最可信；

2. **字符估算**（`estimateTokens`，注释明确说 "conservative (overestimates tokens)"）：按 `chars / 4` 的启发式；图片按固定字符数（`ESTIMATED_IMAGE_CHARS = 4800`）折算。

对新手的重要提醒：**压缩判定是"估算 + 真实值"的混合**，所以你会看到"明明感觉没超也触发了"。要精调就调设置，而不是怀疑代码。

### 10.2.3 四个检查时机（`compaction.md` 官方口径）

```text
1. 每次新用户 prompt 之前
2. 多轮运行的轮间：工具结果追加后、下一次模型请求前（发生在 prepareNextTurn）
3. 低层 run 结束后的"最后补救"（overflow recovery）
4. 手动：/compact [instructions]
```

第 2 条有个细节**值得画星号**：轮间检查发生在 `prepareNextTurn` 里（第 6.2 节读过这个钩子），而且"这批工具结果将终止 run 且没有排队消息"时**跳过**——因为不会再发请求，压缩纯属浪费。

还有两类"事后补救"：

- **供应商报上下文溢出错误**：可以选择"压缩一次再重试"的单次恢复；
- **`stopReason: "length"`（截断）**：同样可能触发恢复；带工具调用的 length 响应保留"合成的失败工具结果"，然后按普通调度继续（第 3.14 节的轨迹 D）。

## 10.3 压缩流水线：五个步骤与"切点"算法

`compaction.md` 给出的五步流程：

```text
1. Find cut point       在"最终投影"上从最新往回走，累计 token 估算，直到 keepRecentTokens
2. Extract messages     收集"上一个保留边界（或会话开头）→ 切点"之间的投影消息
3. Generate summary     调 LLM 生成结构化摘要（有旧摘要时作为迭代上下文传入）
4. Append entry         写入 CompactionEntry（含 summary 与 firstKeptEntryId）
5. Rebuilds context     下一次请求用"摘要 + firstKeptEntryId 起的消息"重建
```

第 5 步的视觉效果（官方示意图翻译）：

```text
压缩前（条目序）：
  hdr  usr  ass  tool | usr  ass  tool  tool  ass  tool
      └── 将被摘要 ──┘ └──────── 保留 ────────┘
                          ↑ firstKeptEntryId

压缩后（追加 cmp 条目）：
  ...                                       cmp

模型看到：
  system  summary  usr  ass  tool  tool  ass  tool
     ↑       ↑      └──────── firstKeptEntryId 起 ────────┘
   提示词   压缩摘要
```

### 10.3.1 切点（cut point）规则

**合法切点**（从 `compaction.md` 的 "Cut Point Rules"）：

- 用户消息；
- 助手消息；
- `bashExecution` 消息；
- 自定义消息（`custom_message`、`branch_summary`）。

**永不切在工具结果上**——工具结果必须跟它的工具调用在一起（否则模型看到"孤儿结果"）。从"投影后"而非"原始文件"上找切点也很关键：**被 `context_edit` 省略的条目不影响切点与摘要**（`compaction.md` 原话："Omitted raw entries remain stored but do not affect cut selection, summaries, checkpoints, or token estimates."）。

### 10.3.2 `findCutPoint` 精读

```typescript
export function findCutPoint(entries, startIndex, endIndex, keepRecentTokens): CutPointResult {
	const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
	if (cutPoints.length === 0) {
		return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
	}

	// 从最新往回走，累计"投影消息"的 token 估算
	let accumulatedTokens = 0;
	let cutIndex = cutPoints[0];      // 默认：从最早的消息保留
	for (let i = endIndex - 1; i >= startIndex; i--) {
		const entry = entries[i];
		const messageTokens = sessionEntryToContextMessages(entry).reduce(
			(sum, message) => sum + estimateTokens(message), 0);
		if (messageTokens === 0) continue;
		accumulatedTokens += messageTokens;

		if (accumulatedTokens >= keepRecentTokens) {
			// 取"不早于当前位置"的最近合法切点；若尾部工具结果自身就超预算，
			// 就保留它们前面的助手工具调用，而不是退回到第一条消息
			cutIndex = cutPoints.find((candidate) => candidate >= i) ?? cutPoints[cutPoints.length - 1];
			break;
		}
	}

	// 再往前吞掉"不产生上下文"的元数据条目（model_change 等）
	while (cutIndex > startIndex) {
		const prevEntry = entries[cutIndex - 1];
		if (prevEntry.type === "compaction" || sessionEntryToContextMessages(prevEntry).length > 0) break;
		cutIndex--;
	}

	// 判断是否"切进了用户消息跨度"（split turn）
	const cutEntry = entries[cutIndex];
	const startsTurn = isTurnStartEntry(cutEntry);
	const turnStartIndex = startsTurn ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);
	return { firstKeptEntryIndex: cutIndex, turnStartIndex, isSplitTurn: !startsTurn && turnStartIndex !== -1 };
}
```

三个设计细节：

1. **"从新往旧"累计**：保证保留的是**最近** `keepRecentTokens` 量级的内容——最新上下文最重要；
2. **倾向合法切点**：宁可多保留一点，也不切出"半截工具对"；
3. **元数据前吞**：`model_change` 这类不产生消息的条目会被并入保留区间（它影响解释但不占 token），避免"保留区从一条设置变更开始"的怪异边界。

### 10.3.3 切进用户消息跨度（split user-message span）

用户的一个请求可能引发很多轮工具往返（一次"跨度"）。如果**单个跨度本身就超过 `keepRecentTokens`**，切点只能落在跨度中间——此时生成**两份摘要再合并**（官方文档）：

1. **历史摘要**：更早的上下文（如果有）；
2. **跨度前缀摘要**：这个跨度前半段（从它的用户消息到切点之前）。

图解（`compaction.md` 示意）：

```text
usr │ ass tool ass tool tool ass tool
 ↑                                    ↑
turnStartIndex = 切点所在跨度的起点    firstKeptEntryId
 └──── turnPrefixMessages（前缀）────┘ └── kept ──┘
```

### 10.3.4 重复压缩与 `tokensBefore` 的"重算"

会话被压缩多次时，第二次摘要的起点是**上一次压缩的保留边界**（`firstKeptEntryId`），而不是压缩条目本身——注释原话：

```text
On repeated compactions, the summarized span starts at the previous compaction's kept boundary
(firstKeptEntryId), not at the compaction entry itself ... This preserves messages that survived
the earlier compaction by including them in the next summarization pass as well.
```

并且 `tokensBefore` 会**在写入前重算**：从"重建后的、应用过 context_edit 的投影"计算，而不是照抄某个旧数字——保证"本次替换掉的上下文规模"是真实的。

## 10.4 摘要请求：一次"特殊的模型调用"

### 10.4.1 结构化格式

摘要不是自由发挥，而是固定骨架（`compaction.md`）。压缩摘要：

```markdown
## Goal
[用户想达成什么]

## Constraints & Preferences
- [用户提出的要求]

## Progress
### Done
- [x] [已完成]
### In Progress
- [ ] [进行中]
### Blocked
- [阻塞项]

## Key Decisions
- **[决策]**：[理由]

## Next Steps
1. [接下来该做什么]

## Critical Context
- [继续工作所需的数据]

<read-files>
path/to/file1.ts
</read-files>

<modified-files>
path/to/changed.ts
</modified-files>
```

分支摘要同骨架，但**停在 Next Steps**（没有 Critical Context）。文件列表在需要时附加。

为什么要有固定骨架？因为摘要要给**后续的模型**看：结构化让"目标、决策、进度"不随叙述风格丢失；`<read-files>`/`<modified-files>` 标签让文件轨迹可机读、可累计。

### 10.4.2 文件跟踪是"累积"的

默认压缩与分支摘要都会从被摘要消息的**工具调用**中提取文件操作，并且：

- 压缩会**继承上一次 pi 生成压缩**的文件列表；
- 分支摘要会继承被摘要条目里**pi 生成的分支摘要**的列表；
- 因此列表跨多轮压缩不断累计；
- **扩展生成的摘要（`fromHook: true`）不自动继承**——扩展自己管理 `details`（`compaction.md` 明确说明）。

文件列表的消费方：`details: { readFiles, modifiedFiles }`（`CompactionDetails` / `BranchSummaryDetails`）——界面、扩展、以及"摘要质量"的调试都靠它。

### 10.4.3 序列化：让模型"看访谈记录"，而不是"接着聊"

生成摘要前，消息被 `serializeConversation`（`compaction/utils.ts`）转成一种**第三人称速记文本**：

```text
[User]: What they said
[Assistant thinking]: Internal reasoning
[Assistant]: Response text
[Assistant tool calls]: read(path="foo.ts"); edit(path="bar.ts", ...)
[Tool result]: Output from tool
```

两个设计点：

1. **防止"对话惯性"**：如果直接把历史原样发给模型并要求总结，模型可能把总结任务当作"继续聊天"。加 `[User]:` 这类前缀，明确这是**待处理的材料**；
2. **工具结果截断到 2000 字符**（超出部分替换为截断标记）——因为 `read`/`bash` 的输出通常是上下文体积的最大来源，摘要请求本身也要控制成本。

另外 `compaction.md` 提到：**摘要请求会禁用 prompt 缓存写入**——这种一次性请求不太可能被复用，写缓存纯属浪费。

## 10.5 溢出恢复的执行顺序

把第 6 章的"重试"与本章的"压缩"拼接起来，官方给出的完整顺序（`compaction.md`）：

```text
persist final assistant response          # 最终助手响应先落盘
→ extension/public turn_end               # 对外事件照常
→ extension/public agent_end
→ append context_edit omissions for the selected attempt   # 把失败的尝试从投影中剔除
→ for overflow/length: run session_before_compact and append compaction on success
→ start the retry as a fresh run          # 以"全新 run"重试
```

对照代码（第 6.6 节）：`_handlePostAgentRun` 里先试重试（`_prepareRetry` → `_omitRecoveryAttempt` 追加省略编辑），再试压缩（`_checkCompaction(message, true, toolResults)`）。两类恢复共享同一套"先修上下文、再重跑"的骨架。

**失败时的语义**（重要）：

```text
If recovery compaction fails or is cancelled, Pi keeps the omission edits, appends no
compaction, and schedules no internal retry.
```

- 省略编辑**保留**（坏的那次尝试仍不进上下文）；
- 不写压缩条目、不再自动重试；
- `agent_before_settle`（第 6.2 节的边界钩子）看到的是**修复后的投影**；
- 但**原始历史、导出、计费、历史检索仍能看到被省略的尝试**——"修上下文"不等于"抹掉事实"。

## 10.6 分支摘要：切换分支时的"访客报告"

`/tree` 导航到另一条分支时，pi 会**询问用户是否总结**被放弃的路径。选择总结则：

```text
① 找共同祖先（old 与 new 位置的最深公共节点）
② 从旧叶子往回收集到共同祖先的条目
③ 按 token 预算准备（从新到旧纳入）
④ 调 LLM 生成结构化摘要
⑤ 在导航点追加 BranchSummaryEntry
```

官方示意图：

```text
导航前：
         ┌─ B ─ C ─ D（旧叶子，将放弃）
    A ───┤
         └─ E ─ F（目标）

导航后（带摘要）：
         ┌─ B ─ C ─ D
    A ───┤
         └─ E ─ F ─ [B、C、D 的摘要]（新叶子）
```

`BranchSummaryEntry` 的字段（`session-format.md`）：

```typescript
interface BranchSummaryEntry<T = unknown> {
	type: "branch_summary";
	id: string; parentId: string | null; timestamp: string;
	summary: string;
	fromId: string;        // 从哪个旧叶子离开
	usage?: Usage;         // 生成摘要的用量（计入会话总计）
	fromHook?: boolean;    // 是否扩展提供
	details?: T;           // 默认：{ readFiles, modifiedFiles }
}
```

在投影里，它变成一条带包装前缀的 **user 消息**（第 4.4.2 节的 `BRANCH_SUMMARY_PREFIX`）——新分支的模型因此知道"刚才在另一条路上试过什么"。

## 10.7 扩展钩子：把压缩"接管"过来

三个事件（`core/extensions/types.ts`，用法见 `compaction.md`）：

### 10.7.1 `session_before_compact`

每次自动压缩或 `/compact` 前触发，可以取消或提供自定义摘要：

```typescript
pi.on("session_before_compact", async (event, ctx) => {
	const { preparation, branchEntries, customInstructions, reason, willRetry, signal } = event;

	// preparation.messagesToSummarize  待摘要消息
	// preparation.turnPrefixMessages   分裂跨度的前缀（isSplitTurn 时）
	// preparation.previousSummary      上一次压缩摘要（迭代上下文）
	// preparation.fileOps              提取出的文件操作
	// preparation.tokensBefore         压缩前上下文 token 数
	// preparation.firstKeptEntryId     保留边界
	// preparation.settings             有效设置（含模型覆盖）
	// reason - "manual" | "threshold" | "overflow"
	// willRetry - 溢出恢复是否会重试（决定摘要要不要"接得上"）

	return { cancel: true };                       // 取消

	return {                                       // 自定义摘要
		compaction: {
			summary: "Your summary...",
			firstKeptEntryId: preparation.firstKeptEntryId,
			tokensBefore: preparation.tokensBefore,
			// usage: ...,  // 可选：计入会话总计
			details: { /* 自定义数据 */ },
		},
	};
});
```

想用**自己的模型**做摘要时，文档给出的标准路径是：`convertToLlm(preparation.messagesToSummarize)` → `serializeConversation(...)` → 自己的模型 → 返回 `compaction` 对象。仓库里有完整示例 `examples/extensions/custom-compaction.ts`。

### 10.7.2 `session_compact_failed`

压缩失败或被取消时触发（给遥测/重试逻辑配对用）：载荷含 `reason`、`errorMessage`、`aborted`、`willRetry`、`fromExtension`。

### 10.7.3 `session_before_tree`

`/tree` 导航前**总是**触发（无论用户选不选摘要）：可以取消导航，或在 `preparation.userWantsSummary` 为真时提供自定义摘要。

三个钩子合起来意味着：**压缩策略是一个开放的扩展点**，而不只是硬编码逻辑。读 `compaction.ts` 时你会看到默认实现与扩展覆盖如何合并（`fromHook` 字段、"preparation" 对象就是给钩子用的数据协议）。

## 10.8 实验 L06：压缩前后对照

**实验性质**：本地运行（faux 驱动）；零模型费用。
**验证状态**：设计中。

### 目标

用可控的假数据触发一次自动压缩，对照"压缩前后模型上下文"与"磁盘条目"，验证本章结论。

### 步骤

1. **调小阈值**：在测试 harness 的 settings 里覆盖压缩设置（等价于在 `settings.json` 里写）：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 200,
    "keepRecentTokens": 100
  }
}
```

   （字段名以 `CompactionSettings` 与设置的读取实现为准；测试里通常用 `settings: { ... }` 直接注入。）

2. **编脚本**：让 faux 返回若干条长文本响应（每次响应几百字，迅速推高估算 token），随后到达阈值；
3. **观察会话事件与磁盘分开看**：会话事件主线是 `compaction_start`（reason: `"threshold"`）→ `compaction_end`（result / aborted / willRetry）；扩展钩子另有自己的派发。成功时源码会调用 `appendCompaction()` 写入新 `compaction` 条目，但不会为它发 `entry_appended`。用 `sessionManager.getEntries()` 检查磁盘条目，不要把 `entry_appended` 当成所有写入的日志；
4. **对照上下文**：

```text
压缩前：buildSessionContext().messages 的长度与首元素
压缩后：同一次调用的结果
期望：首部被替换为“检查点系统消息 + 压缩摘要消息”，随后是 firstKeptEntryId 起的消息
```

5. **验证"事实不删"**：读 `sessionManager.getEntries()`，确认被摘要的原始条目**仍在文件里**（只是不再投影）；
6. **变体实验**：把摘要脚本改成"模型抛错"（faux 返回 `{ stopReason: "error" }`），观察 `session_compact_failed` 与"不重试"的行为（对照 10.5 节）。

### 观察与思考

- 压缩的 `tokensBefore` 与你自己估算的值差多少？（体会"估算 + 真实值"的混合）
- 摘要请求在 faux 的 `callCount` 里占几次？（提示：`generateSummary` 走的是同一条 streamSimple 链路）
- 若压缩后上下文仍超阈值，下一次检查会发生什么？（重复压缩，起点是上一个保留边界）

### 清理

还原测试文件；删除临时脚本；`git status` 干净。

## 10.9 常见错误

| 现象                                                                           | 原因                          | 处理                                                              |
| ------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------- |
| "没超窗口也压缩了"                                                             | 估算保守 + reserveTokens 预留 | 调`reserveTokens`/`keepRecentTokens`；不要改判定代码          |
| 压缩后模型"失忆"                                                               | 摘要信息损失是压缩的固有属性  | 在摘要格式里加"必须保留"的栏目；重要事实落在文件/文档里而非对话里 |
| 摘要响应被当成对话继续                                                         | 序列化没加`[User]:` 前缀    | 用仓库的`serializeConversation`，别自己拼                       |
| 工具结果孤零零出现                                                             | 切点切在工具结果上            | 只允许在合法切点切（用户/助手/bash/自定义消息）                   |
| `session_before_compact` 里直接用 `preparation.messagesToSummarize` 发模型 | 忘了转文本                    | 先`convertToLlm` + `serializeConversation`                    |
| 溢出恢复失败后系统还在循环                                                     | 期望"自动重试"                | 按 10.5 节：失败时不排重试；队列消息仍按 steer/follow-up 规则处理 |
| 扩展摘要的文件列表没有累计                                                     | 扩展摘要不自动继承列表        | 在自定义`details` 里自行管理                                    |

## 10.10 验收题

1. 写出触发自动压缩的不等式与三个默认值（enabled/reserve/keepRecent）。
2. 系统提示分节模型解决了什么问题？`forceSystemPrompt` 与 `customPrompt` 的差别？
3. `findCutPoint` 为什么"从新往旧"累计？遇到"尾部工具结果自身超预算"时它做了什么特殊处理？
4. 压缩中的 split turn 是什么？为什么要生成两份摘要？
5. 给定一段历史（含一次读文件、一次改文件、一个关键决策），写出压缩摘要里"必须保留"的信息，并指出它们分别落在模板的哪一节。
6. 溢出恢复的完整顺序是什么？压缩失败时保留了什么、不保留什么？

### 参考答案（要点）

1. `contextTokens > contextWindow - reserveTokens`；默认 `enabled: true`、`reserveTokens: 16384`、`keepRecentTokens: 20000`。
2. 分节让系统提示可以"按名字增量打补丁 + 可回放"；`customPrompt` 替换默认 preamble 但仍分节；`forceSystemPrompt` 整体覆盖且不分节（不可补丁）。
3. 最新上下文最重要，从新往旧累计保证保留"最近的 keepRecentTokens"；尾部工具结果自身超预算时，倾向保留其前面的助手工具调用（合法切点），而不是退回第一条。
4. 单个用户消息跨度超过保留预算时，切点落在跨度中间；前半段生成"跨度前缀摘要"，加上更早的"历史摘要"，两者合并。
5. 读过的文件 → `<read-files>`；改过的文件 → `<modified-files>`；关键决策 → `## Key Decisions`（含理由）；用户约束 → `## Constraints & Preferences`；下一步 → `## Next Steps`；继续所需数据 → `## Critical Context`。目标 → `## Goal`。
6. 顺序：落盘最终响应 → `turn_end` → `agent_end` → 追加省略编辑 → `session_before_compact`（溢出/长度场景）→ 成功则写压缩条目 → 以全新 run 重试。失败/取消时：保留省略编辑；不写压缩条目；不安排内部重试；`agent_before_settle` 看到修复后的投影；原始历史与导出不受影响。

## 10.11 来源与下一章

- `packages/coding-agent/src/core/system-prompt.ts`（`buildSystemPromptSections`、`buildSystemPromptState`、`buildSystemPrompt`、`diffSystemPromptSections`、`normalizeBuildSystemPromptOptions`）；
- `packages/coding-agent/src/core/compaction/compaction.ts`（`CompactionSettings`、`DEFAULT_COMPACTION_SETTINGS`、`shouldCompact`、`estimateTokens`、`calculateContextTokens`、`findCutPoint`、`prepareCompaction`、`compact`）、`compaction/branch-summarization.ts`、`compaction/utils.ts`；
- `packages/coding-agent/docs/compaction.md`、`docs/settings.md`、`docs/sessions.md`；
- `packages/coding-agent/src/core/extensions/types.ts`（`session_before_compact`、`session_compact_failed`、`session_before_tree` 事件）。

下一章把"输入从哪来"讲完整：全局/项目/环境/CLI 的配置优先级、资源发现顺序、项目信任边界——以及"配置没生效"该怎么一步步定位。
