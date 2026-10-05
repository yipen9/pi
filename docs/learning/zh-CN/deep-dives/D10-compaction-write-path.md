# D10：压缩的"写入路径"精读（`prepareCompaction` + `compact`）

> 精读对象：`core/compaction/compaction.ts` 的**后半段**——`CompactionPreparation`、`findProjectedCutPoint`、`prepareCompaction`、`compact`（生成摘要并产出结果）。
> 对应主线：第 10 章；与 D4 的关系：D4 精读"阈值/估算/切点/序列化/摘要调用"（读侧素材），D10 精读"从当前会话到 `CompactionEntry` 的完整写路径"。
> 读法：先读 `prepareCompaction`（决定"摘要什么、保留什么"），再读 `compact`（决定"怎么摘要、怎么合并"）。

---

## 0. 写路径全景

```text
AgentSession._checkCompaction（触发端：阈值/溢出/手动）
  → prepareCompaction(pathEntries, settings)          ← 本篇第一部分：算出"预备方案"
      · buildSessionProjection（D3 的投影）
      · findProjectedCutPoint（投影版切点算法）
      · messagesToSummarize / turnPrefixMessages / firstKeptEntryId / fileOps
  → compact(preparation, ...)                          ← 本篇第二部分：真正生成摘要
      · generateSummaryWithUsage（历史摘要；D4 第 9 节）
      · generateTurnPrefixSummary（分裂跨度前缀摘要）
      · 合并 + 文件列表 + 用量
      · 返回 CompactionResult
  → sessionManager.appendCompaction(...)（D9 第 11.3 节：写检查点条目）
```

【陷阱】三层职责**不要混**：`prepareCompaction` 不调模型（纯计算）；`compact` 调模型但**不写会话**（只返回结果）；写入由 `SessionManager.appendCompaction` 完成（D9）。**"算 → 生成 → 落盘"三段分离**——哪段失败、哪段可重试、哪段是纯函数，一目了然。

---

# 第一部分：`prepareCompaction`（预备方案）

## 1. `CompactionPreparation`：一份"施工图"

【源码】

```typescript
export interface CompactionPreparation {
	/** UUID of first entry to keep */
	firstKeptEntryId: string;
	/** Messages that will be summarized and discarded */
	messagesToSummarize: AgentMessage[];
	/** Messages that will be turned into turn prefix summary (if splitting) */
	turnPrefixMessages: AgentMessage[];
	/** Whether this is a split turn (cut point in middle of turn) */
	isSplitTurn: boolean;
	tokensBefore: number;
	/** Summary from previous compaction, for iterative update */
	previousSummary?: string;
	/** File operations extracted from messagesToSummarize */
	fileOps: FileOperations;
	/** Compaction settions from settings.jsonl	*/
	settings: CompactionSettings;
}
```

【注解（八个字段就是全部决策）】

1. `firstKeptEntryId`：**保留边界**（D3 折叠算法的输入，也是最终写入 `CompactionEntry` 的字段）；
2. `messagesToSummarize`：要**被摘要替代**的历史消息（投影后）；
3. `turnPrefixMessages`：分裂跨度的前缀消息（可能要**第二份摘要**）；
4. `isSplitTurn`：是否分裂（决定走不走两段摘要路径）；
5. `tokensBefore`：压缩前的 token 数（用于 `CompactionEntry` 与报告）；
6. `previousSummary`：上一次压缩的摘要（作为**迭代更新的输入**——第 10.3.4 节）；
7. `fileOps`：从被摘要消息里提取的文件操作（第 D4 第 8 节的追踪器）；
8. `settings`：生效的设置（`reserveTokens`/`keepRecentTokens`——可能含模型覆盖）。
- 【陷阱】注释里有个拼写错误（"Compaction settions from settings.jsonl"——`settings.json` 拼成 `jsonl`、`settions` 拼成 `sections` 的兄弟？）。**读注释不要被笔误带偏**；以字段名与实现为准。

## 2. `findProjectedCutPoint`：投影版切点（与 D4 的差别）

【源码（核心段）】

```typescript
function findProjectedCutPoint(
	entries: ProjectedSessionEntry[],
	startIndex: number,
	endIndex: number,
	keepRecentTokens: number,
): CutPointResult {
	const cutPoints: number[] = [];
	for (let i = startIndex; i < endIndex; i++) {
		const entry = entries[i];
		if (entry.sourceEntry.type !== "compaction" && entry.messages.some(isCutPointMessage)) cutPoints.push(i);
	}
	if (cutPoints.length === 0) {
		return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
	}

	let accumulatedTokens = 0;
	let exceededBudget = false;
	let cutIndex = cutPoints[0];
	for (let i = endIndex - 1; i >= startIndex; i--) {
		const messageTokens = entries[i].messages.reduce((sum, message) => sum + estimateTokens(message), 0);
		if (messageTokens === 0) continue;
		accumulatedTokens += messageTokens;
		if (accumulatedTokens >= keepRecentTokens) {
			exceededBudget = true;
			cutIndex = cutPoints.find((candidate) => candidate >= i) ?? cutPoints[cutPoints.length - 1];
			break;
		}
	}

	// A recovery attempt and its omission edits are context-invisible after the last
	// visible input. Advance only for a closed suffix containing an omitted assistant
	// attempt; ...
	const suffix = entries.slice(cutIndex + 1, endIndex);
	const isIntrinsicallyVisible = (entry: ProjectedSessionEntry): boolean =>
		entry.sourceEntry.type !== "context_edit" && sessionEntryToContextMessages(entry.sourceEntry).length > 0;
	const isOmitted = (entry: ProjectedSessionEntry): boolean =>
		isIntrinsicallyVisible(entry) && entry.messages.length === 0;
	const omittedSuffixIds = new Set(suffix.filter(isOmitted).map((entry) => entry.sourceEntry.id));
	const hasExternalReplacement = suffix.some(
		(entry) =>
			entry.sourceEntry.type === "context_edit" &&
			entry.sourceEntry.replacement !== null &&
			!omittedSuffixIds.has(entry.sourceEntry.targetId),
	);
	const isRecoveryOmissionSuffix =
		exceededBudget &&
		!hasExternalReplacement &&
		suffix.some(
			(entry) =>
				entry.sourceEntry.type === "message" && entry.sourceEntry.message.role === "assistant" && isOmitted(entry),
		) &&
		suffix.every(
			(entry) => entry.sourceEntry.type !== "compaction" && (!isIntrinsicallyVisible(entry) || isOmitted(entry)),
		);
	if (isRecoveryOmissionSuffix) cutIndex++;

	while (cutIndex > startIndex) {
		const previous = entries[cutIndex - 1];
		if (previous.sourceEntry.type === "compaction" || previous.messages.length > 0) break;
		cutIndex--;
	}
	const startsTurn = isProjectedTurnStart(entries[cutIndex]);
	const turnStartIndex = startsTurn ? -1 : findProjectedTurnStartIndex(entries, cutIndex, startIndex);
	return {
		firstKeptEntryIndex: cutIndex,
		turnStartIndex,
		isSplitTurn: !startsTurn && turnStartIndex !== -1,
	};
}
```

【注解（与 D4 的 `findCutPoint` 逐点对照）】

| 维度 | D4 的 `findCutPoint`（原始条目） | 本函数（投影条目） |
|---|---|---|
| 输入 | `SessionEntry[]` + 索引起止 | `ProjectedSessionEntry[]`（每项含 `sourceEntry` 与 `messages`） |
| 切点判定 | `findValidCutPoints`（内部实现） | 内联：`sourceEntry.type !== "compaction" && messages.some(isCutPointMessage)`（**注意 `isCutPointMessage` 判的是"消息"而不是"条目"**） |
| 预算累加 | `sessionEntryToContextMessages(entry)` 再估算 | 直接用 `entry.messages`（投影已经翻译好——**不再重复翻译**） |
| 恢复省略的特殊处理 | 无 | **有**（见下） |
| 元数据吞并 / split 判定 | 同构 | 同构（用投影版判定函数） |

**核心差异：recursive 省略后缀的处理**（注释与那段五连逻辑）：

- 场景：**溢出恢复**把失败的尝试用 `context_edit`（replacement=null）抹掉后，投影里那些条目 **`messages` 为空**——它们"在上下文里不可见"，但仍占 `entries` 的位置。
- 问题：切点如果落在"最后一个可见输入"之后（即后缀全是"不可见条目"），会白保留一段"什么都看不见"的尾巴，让下一次压缩早触发/晚触发得莫名其妙。
- 解法（**只在严格条件下**前进一位）：

```text
isIntrinsicallyVisible(entry) = 不是 context_edit 且 原始条目能转出消息
isOmitted(entry)              = 本来可见（源条目有消息）但投影后 messages 为空（被省略）

isRecoveryOmissionSuffix =
  exceededBudget                                  ← 确实超预算了
  && !hasExternalReplacement                      ← 后缀里的 context_edit 不是"替换内容"（可能改变语义）
  && 后缀里至少有一条"被省略的 assistant 消息"        ← 是"恢复省略"而不是别的删除
  && 后缀里没有 compaction 且每条都"不可见或本来就不可见" ← 后缀是"闭合的不可见段"

满足 → cutIndex++（把切点前移一格，把这段不可见尾巴留在"待摘要"侧）
```

- 【陷阱】四个条件的**防守对象**不同：`exceededBudget` 防"没超预算也乱切"；`!hasExternalReplacement` 防"把用户主动的编辑（替换文本）当垃圾吞掉"；"含被省略的 assistant"防"误判无关的隐身条目"；"后缀闭合"防"跨过还有可见内容的条目"。**注释原文**（"Advance only for a closed suffix containing an omitted assistant attempt; arbitrary metadata must not move the cut past unsent input."）就是这四条的白话版——这种"复杂判定只前进一位"的保守设计，是"宁可不优化也不能切错"的又一次体现。
- 【陷阱】`cutPoints` 收集时**排除 compaction 源条目**：不能拿压缩条目当切点（它是边界标记，D3 同款处理）。
- 【陷阱】`estimateTokens`/`isCutPointMessage` 等判定**只传消息**——如果未来加"条目级"的切点规则（比如"设置条目也可以切"），这些内联条件要改；D4 的版本有独立的 `findValidCutPoints` 函数（更易扩展），版本之间**没有共享**（两套算法各自演化——读时别以为一个改另一个也变）。

## 3. `prepareCompaction`：从路径到施工图

【源码（完整，分段注解）】

```typescript
export function prepareCompaction(
	pathEntries: SessionEntry[],
	settings: CompactionSettings,
): CompactionPreparation | undefined {
	if (pathEntries.length > 0 && pathEntries[pathEntries.length - 1].type === "compaction") {
		return undefined;
	}

	const projection = buildSessionProjection(pathEntries);
	const projectedEntries = projection.entries;
	const sourceEntries = projectedEntries.map((entry) => entry.sourceEntry);
	// The newest compaction is projected first. Older compaction entries can still
	// occur in its retained raw range, but their projected contribution is empty.
	const prevCompactionIndex = projectedEntries.findIndex(
		(entry) => entry.sourceEntry.type === "compaction" && entry.messages.length > 0,
	);

	let previousSummary: string | undefined;
	let boundaryStart = 0;
	if (prevCompactionIndex >= 0) {
		previousSummary = (projectedEntries[prevCompactionIndex].sourceEntry as CompactionEntry).summary;
		// The canonical projection has already selected the previous compaction's retained tail.
		boundaryStart = prevCompactionIndex + 1;
	}
	const boundaryEnd = projectedEntries.length;
	const tokensBefore = estimateProjectedContextTokens(projection, pathEntries).tokens;
	const cutPoint = findProjectedCutPoint(projectedEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);

	const firstKeptEntry = projectedEntries[cutPoint.firstKeptEntryIndex]?.sourceEntry;
	if (!firstKeptEntry?.id) return undefined;
	const firstKeptEntryId = firstKeptEntry.id;
	const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;

	const messagesToSummarize = projectedEntries
		.slice(boundaryStart, historyEnd)
		.flatMap(getMessagesFromProjectedEntryForCompaction);
	const turnPrefixMessages = cutPoint.isSplitTurn
		? projectedEntries
				.slice(cutPoint.turnStartIndex, cutPoint.firstKeptEntryIndex)
				.flatMap(getMessagesFromProjectedEntryForCompaction)
		: [];

	if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0) return undefined;

	// Extract file operations from edited model-visible messages and the previous compaction.
	const fileOps = extractFileOperations(messagesToSummarize, sourceEntries, prevCompactionIndex);

	if (cutPoint.isSplitTurn) {
		for (const msg of turnPrefixMessages) extractFileOpsFromMessage(msg, fileOps);
	}

	return {
		firstKeptEntryId, messagesToSummarize, turnPrefixMessages,
		isSplitTurn: cutPoint.isSplitTurn, tokensBefore, previousSummary, fileOps, settings,
	};
}
```

【注解（七步）】

1. **幂等守卫**：路径的最后一条已经是 `compaction` → 返回 undefined（"刚压过就别再压"——防止连续触发重复压缩；对应第 10.2.3 节的检查时机）。
2. **构建投影**（D3 的 `buildSessionProjection`）——**一切基于投影而非原始条目**（被省略/被编辑的内容不参与摘要；这正是第 10.3.1 节"从投影找切点"的依据）。
3. **找上一次压缩**：
   - 投影里**只有最新压缩**贡献消息（D3 的 `index > 0 → []` 规则），所以"messages 非空的 compaction"就是**最新那次**；`findIndex` 找它；
   - `previousSummary` 取它的 `summary`——**用于迭代更新**（第 10.3.4 节）；
   - `boundaryStart = prevCompactionIndex + 1`——【陷阱】注释点明："投影已经选好了上一次压缩的保留尾巴"，所以**本轮摘要的起点是它的下一个条目**（不是从会话开头！）——这就是"重复压缩从上一个保留边界开始"的实现位置（第 10.3.4 节的另一处表述）。
4. **`boundaryEnd`** = 投影长度；`tokensBefore` 用 `estimateProjectedContextTokens(projection, pathEntries)`（**投影后的估算**——第 10.3.4 节的"重算 tokensBefore"）；切点用 `findProjectedCutPoint(projectedEntries, boundaryStart, boundaryEnd, keepRecentTokens)`。
5. **取保留边界与历史终点**：
   - `firstKeptEntry` 必须存在且有 id，否则返回 undefined（防御）；
   - `historyEnd`：分裂时是 **turnStartIndex**（跨度的起点——"历史"只到前缀之前），否则是切点本身。
6. **切出两段消息**：
   - `messagesToSummarize = [boundaryStart, historyEnd)`（历史摘要素材）；
   - `turnPrefixMessages = 分裂时 [turnStartIndex, firstKeptEntryIndex)`（前缀摘要素材）；
   - 都空 → undefined（**无事可做**，不生成空压缩）。
7. **文件追踪**：`extractFileOperations(messagesToSummarize, sourceEntries, prevCompactionIndex)`（注意三个参数：被摘要消息、**源条目数组**、上一次压缩的位置——说明这个提取器还会从"源条目"和"旧压缩的文件列表"里累计，第 10.4.2 节的"累积"）；分裂时**再**从 `turnPrefixMessages` 提取一遍（两段都要计入）。
- 【陷阱】`projectedEntries.slice(...).flatMap(getMessagesFromProjectedEntryForCompaction)`：不能直接沿用投影的扁平 `messages`，因为压缩切点定义在**条目索引**上；先切条目区间，才能保持 `firstKeptEntryId` 与摘要边界一致。提取函数还有两条明确过滤规则：源条目是 `compaction` 时返回空数组，避免把旧 checkpoint/summary 再摘要；投影消息中的 `system` 消息也被排除，因为它们表示 prompt 状态，不是对话历史。压缩后，会话投影用最新 compaction checkpoint 加上保留区间内的 system patch 重建模型所需的 system state。`packages/coding-agent/test/compaction.test.ts` 的 `does not treat system messages as conversation history` 验证 system 消息不进入 `messagesToSummarize`；`test/suite/agent-session-compaction.test.ts` 的 `checkpoints the replayed system state and folds summarized and retained system patches into it` 验证 checkpoint 与两侧 patch 的重建结果。所以“投影给模型看的消息”与“交给摘要模型的消息”不是同一集合。
- 【陷阱】`sourceEntries` 是 `projectedEntries` 的映射——条目数一致，索引可对齐（第 7 步的 `prevCompactionIndex` 同时用于两个数组）。

---

> D10 第一部分到此。第二部分：`findProjectedCutPoint` 的姊妹函数（`isProjectedTurnStart`/`findProjectedTurnStartIndex`）、`TURN_PREFIX_SUMMARIZATION_PROMPT`、`compact()` 的完整流程（两段摘要合并、用量合并、文件列表追加、结果形状），以及与"触发端"的衔接、总结。
---

# 第二部分：`compact()` 与结果组装

## 4. 两个投影版 turn 判定（切点算法的零件）

【源码】

```typescript
function isProjectedTurnStart(entry: ProjectedSessionEntry): boolean {
	if (entry.sourceEntry.type === "compaction") return false;
	return entry.messages.some(isTurnStartMessage);
}

function findProjectedTurnStartIndex(entries: ProjectedSessionEntry[], entryIndex: number, startIndex: number): number {
	for (let i = entryIndex; i >= startIndex; i--) {
		if (isProjectedTurnStart(entries[i])) return i;
	}
	return -1;
}
```

【注解】

- `isProjectedTurnStart`：
  - **压缩条目永远不是 turn 起点**（第一行显式排除）——即便它的投影消息（检查点+摘要）里可能含"看起来像"的消息；这是语义规则，不是内容推断。
  - 其余条目看**投影消息**里有没有 `isTurnStartMessage`（turn 起点消息的定义——用户消息/bash/自定义消息一族，与 D4 的 `isTurnStartEntry` 对应但作用于**消息**层）。
- `findProjectedTurnStartIndex`：从切点往前**找最近的 turn 起点**；返回 -1 表示"找不到"（`isSplitTurn` 据此为 false——防御性）。
- 【陷阱】与 D4 的函数关系：**同一个概念的两套实现**（原始条目版 vs 投影版）。D4 的 `findTurnStartIndex(entries, cutIndex, startIndex)`（条目数组）与这里的 `findProjectedTurnStartIndex(entries /*投影*/, ...)` 参数形状不同、包在不同函数里。**读压缩两段代码时，先看函数名里的 `Projected` 前缀**——这是本文件区分两套算法的唯一标记。

## 5. `TURN_PREFIX_SUMMARIZATION_PROMPT`：前缀摘要的专用提示

【源码】

```typescript
const TURN_PREFIX_SUMMARIZATION_PROMPT = `The messages above are earlier context from an ongoing conversation. Later messages are stored separately and do not need to be reconstructed.

Create a concise checkpoint of the user's request and the progress shown above. This checkpoint will be placed before the later messages so the conversation can continue with the necessary context.

## Original Request
[What did the user ask for?]

## Progress So Far
- [Key decisions and work completed in these messages]

## Context Needed to Continue
- [Information from these messages needed to understand the later work]

Only summarize information explicitly present above. Do not infer or recreate later messages.`;
```

【注解】

- **与主摘要模板的三处差别**（对照 D4 第 9 节的两条模板）：
  1. 开场强调"**后面还有消息，且它们被单独存放**"——防止模型"把后面的补出来"；
  2. 模板更短（三节：Original Request / Progress So Far / Context Needed）——因为它的目标是"**让后段能被理解**"，不是完整复盘；
  3. 结尾双重禁令："**只总结上面明确出现的信息；不要推断或重造后面的消息**"。
- 【陷阱】为什么这么强调"不要重造"？因为前缀摘要会**插在后段消息之前**（合并摘要的前半段）——如果模型凭"对话直觉"补出后段内容，恢复后的上下文会出现**幻觉重复**（摘要里说了一遍、真实消息里又有一遍）。**提示词的每一句都在防一个具体的失效模式**——读压缩/摘要这类提示词模板时，把"这句话要防什么"问出来，才算真的读懂。
- 【陷阱】它没有 `UPDATE_` 版本（不像主摘要）：前缀摘要不做"迭代更新"（前缀是即时切出来的、一次性的）。

## 6. `compact()`：生成与合并的完整流程

【源码（按分支）】

```typescript
export async function compact(
	preparation: CompactionPreparation,
	model: Model<any>,
	apiKey: string | undefined,
	headers?: Record<string, string>,
	customInstructions?: string,
	signal?: AbortSignal,
	thinkingLevel?: ThinkingLevel,
	streamFn?: StreamFn,
	env?: Record<string, string>,
	retry?: RetryPolicy,
	callbacks?: RetryCallbacks,
	sessionId?: string,
): Promise<CompactionResult> {
	const {
		firstKeptEntryId, messagesToSummarize, turnPrefixMessages, isSplitTurn,
		tokensBefore, previousSummary, fileOps, settings,
	} = preparation;

	let summary: string;
	let summaryUsage: Usage;

	if (isSplitTurn && turnPrefixMessages.length > 0) {
		let historyText = previousSummary ?? "No prior history.";
		let historyUsage: Usage | undefined;
		if (messagesToSummarize.length > 0) {
			const historyResult = await generateSummaryWithUsage(
				messagesToSummarize, model, settings.reserveTokens, apiKey, headers, signal,
				customInstructions, previousSummary, thinkingLevel, streamFn, env, retry, callbacks, sessionId,
			);
			historyText = historyResult.text;
			historyUsage = historyResult.usage;
		}
		const turnPrefixResult = await generateTurnPrefixSummary(
			turnPrefixMessages, model, settings.reserveTokens, apiKey, headers, env, signal,
			thinkingLevel, streamFn, retry, callbacks, sessionId,
		);
		// Merge into single summary
		summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult.text}`;
		summaryUsage = historyUsage ? combineUsage(historyUsage, turnPrefixResult.usage) : turnPrefixResult.usage;
	} else {
		const result = await generateSummaryWithUsage(
			messagesToSummarize, model, settings.reserveTokens, apiKey, headers, signal,
			customInstructions, previousSummary, thinkingLevel, streamFn, env, retry, callbacks, sessionId,
		);
		summary = result.text;
		summaryUsage = result.usage;
	}

	// Compute file lists and append to summary
	const { readFiles, modifiedFiles } = computeFileLists(fileOps);
	summary += formatFileOperations(readFiles, modifiedFiles);

	if (!firstKeptEntryId) {
		throw new Error("First kept entry has no UUID - session may need migration");
	}

	return { summary, firstKeptEntryId, tokensBefore, usage: summaryUsage, /* ... */ };
}
```

【注解（六个决策点）】

1. **分裂分支的两段逻辑**：
   - `historyText` 的默认值是 **`"No prior history."`**——不是空串！这个默认值会在"没有更早历史"时**显式写进合并摘要**（告诉未来的模型"这段是新的"）。
   - `messagesToSummarize.length > 0` 才调历史摘要——**空历史跳过模型调用**（省一次请求）；此时 `historyText` 保持"No prior history."或 `previousSummary`（**有旧摘要时用旧的整段**——它也属于"历史"）。
   - 前缀摘要**总是生成**（前置条件 `turnPrefixMessages.length > 0`）。
2. **合并格式固定**：

```text
{historyText}

---

**Turn Context (split turn):**

{turnPrefixResult.text}
```

   - 分隔线 + 粗体标题——**结构标记让未来的模型/人**能看出"这前半段是分裂跨度的前缀摘要"（`**Turn Context (split turn):**` 同时也是给"读摘要的人"的信号）。
3. **用量合并**：`historyUsage ? combineUsage(historyUsage, turnPrefixResult.usage) : turnPrefixResult.usage`——两次模型调用的用量相加（哪个分支没有就取另一个）。`combineUsage` 来自 pi-ai（用量分项相加的正确实现——不要手写，避免漏字段）。
4. **非分裂分支**：单次 `generateSummaryWithUsage`（**必须成功**——`messagesToSummarize` 一定非空，因为 `prepareCompaction` 的空守卫）。
5. **文件列表追加**（`computeFileLists` + `formatFileOperations`，D4 第 8 节的两个函数）：
   - 【陷阱】**追加发生在摘要文本的最后**——说明格式化函数返回的"前置换行"（`\n\n...`）就是为这种直接拼接设计的（D4 里看到的那个细节在这里闭环）。
   - 【陷阱】即使两个列表都空（`formatFileOperations` 返回 `""`），拼接也无害（`summary += ""`）——不需要分支。
6. **`firstKeptEntryId` 非空断言**（否则抛"session may need migration"——**指针缺失指向老会话**）：这是"结果完整性"的最后一道闸（类型上 `CompactionPreparation.firstKeptEntryId` 是 string，理论上不该为空——这个 throw 防的是类型系统管不到的历史数据路径）。

【陷阱】`customInstructions`（用户 `/compact 指令`）**只在两处透传给 `generateSummaryWithUsage`**：分裂分支的历史摘要、非分裂分支的单次摘要——**前缀摘要的 `generateTurnPrefixSummary` 调用里没有它**（前缀的性质决定"聚焦指令"不适用）。读参数流动时要逐调用点核对，不要假设"一个参数全程都在"。

【陷阱】`sessionId` 同样只透传主摘要路径（前缀摘要的调用里也传了……看代码：`generateTurnPrefixSummary(..., sessionId)` 有传）。等等——两处确认：历史摘要传了 `sessionId`；前缀摘要的调用末尾也有 `sessionId`。所以差异**只在 `customInstructions`**。（这类"读到一半觉得有差异、再核对发现只差一个参数"的反复，正是逐调用点核对的必要性。）

## 7. 与触发端的衔接（会话侧）

`compact()` 的输入全部来自 `prepareCompaction`，而**触发时机**由会话层决定（第 10.2.3 节的四个检查点）。会话侧的基本流程（以主线第 10 章与第 8.3.2 节为准，具体函数以 `agent-session.ts` 的实现为准）：

```text
检查点触发（阈值/溢出/手动）
  → session_before_compact 扩展钩子（可 cancel 或提供自定义 compaction）
      · 取消 → 不写条目、不重试（区分"失败"与"拒绝"）
      · 自定义 → 直接得到 CompactionEntry 草稿（fromHook）
  → prepareCompaction + compact（本 D10）
  → sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details?, usage?)
      · details 默认是 { readFiles, modifiedFiles }——但注意 compact() 已经把列表拼进 summary 文本；
        details 的来源见会话侧对 fileOps 的消费（以实现为准，别凭文档猜）
  → compaction 事件（start/end、failed）+ 可能的重试（willRetry）
```

【陷阱】**不要把 `details` 与"摘要里的文件标签"混为一谈**：两者都源自 `fileOps`，但一个是**给界面/扩展的结构化数据**、一个是**给模型的文本**（第 10.4.2 节的 `CompactionDetails`）。会话侧如何填充 `details`（是否复用 preparation.fileOps、是否加别的字段）**以 `agent-session.ts` 的 `_checkCompaction` 实现为准**——本 D10 只负责 `prepareCompaction`/`compact` 两个纯函数边界的准确性。

## 8. 总结

### 8.1 三阶段职责再强调

| 阶段 | 函数 | 是否调用模型 | 是否写磁盘 | 纯函数？ |
|---|---|---|---|---|
| 预备 | `prepareCompaction` | 否 | 否 | **是**（给定输入必得同输出） |
| 生成 | `compact` | **是**（1 或 2 次） | 否 | 否（但无副作用：不写会话，仅返回结果） |
| 落盘 | `appendCompaction`（D9） | 否 | **是** | 否 |

- 【陷阱】"`compact` 不写盘"这个事实让**失败重试**变得简单：失败就重跑（幂等安全，因为还没写）；而 `appendCompaction` 是单次写（重复调用会写两条压缩条目——**所以重试逻辑必须挂在 `compact` 而非它之后**）。**副作用的边界决定重试策略**——这是本 D10 最实用的一个结论。

### 8.2 阅读检查清单

- [ ] 我能说出 `prepareCompaction` 的七步，以及 `boundaryStart` 为什么从"上一次压缩之后"开始吗？
- [ ] 我能解释恢复省略后缀的四个守卫条件各防什么吗？
- [ ] 我知道前缀摘要提示词的"三节 + 双重禁令"吗？
- [ ] 我能背出分裂合并的文本格式吗？（`---` + `**Turn Context (split turn):**`）
- [ ] 我知道 `combineUsage` 在哪个分支被用吗？为什么不手动相加？
- [ ] 我能说清"三阶段"哪个可重跑、哪个必须只跑一次吗？

---

> D10 完。精读篇（D1-D10）至此覆盖：循环、Agent、会话投影与类本体、提示与压缩（读侧 + 写侧）、SDK、CLI、工具、扩展。
