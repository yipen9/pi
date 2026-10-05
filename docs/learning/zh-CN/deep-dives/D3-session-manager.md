# D3：`session-manager.ts` 投影与分支精读

> 精读对象：`packages/coding-agent/src/core/session-manager.ts`（63KB）中"**从磁盘条目到模型上下文**"与"**导出分支**"两部分。
> 对应主线：第 9 章（会话树、恢复与分支）。
> 范围说明：`SessionManager` 类还有大量文件 I/O、锁、索引、标签管理等代码；本篇只精读与"投影/分支"直接相关的函数——它们决定了"模型看到什么"。

---

## 0. 精读对象的清单

```text
buildEntryIndex              条目 id → 条目 的索引（可复用传入的）
buildSessionPath             从叶子回溯到根（根→叶顺序输出）
getSessionContextSettings    沿路径取最新的 thinkingLevel / model
sessionEntryToContextMessages 单条目 → 消息数组（翻译表）
buildContextEntries          压缩折叠：最新压缩 + 保留区间
projectContextEntry          应用 context_edit 的"投影器"
buildSessionProjection       投影总装（entries + messages + settings）
buildSessionContext          投影的最终形态（messages + settings）
getBranch(fromId?)           SessionManager 方法：原始条目路径
createBranchedSession(leafId) 导出"根→叶"为新会话文件
```

【陷阱】文件中还有**同名不同物**的两个层次：
- 模块级**纯函数**（`buildContextEntries(entries, leafId, byId)` 等）——输入全是参数，易于单测；
- 类上的**方法**（`buildContextEntries()` 无参）——把 `this.getEntries()`/`this.leafId`/`this.byId` 喂给纯函数。
读代码时先看清楚在调哪一层；改逻辑优先改纯函数（可测试性更好）。

---

## 1. `buildEntryIndex`：索引的"可注入"设计

【源码】

```typescript
function buildEntryIndex(entries: SessionEntry[], byId?: Map<string, SessionEntry>): Map<string, SessionEntry> {
	if (byId) return byId;
	const index = new Map<string, SessionEntry>();
	for (const entry of entries) {
		index.set(entry.id, entry);
	}
	return index;
}
```

【注解】

- **可注入 `byId`**：`SessionManager` 内部维护常驻索引（`this.byId`），投影函数接受它以免每次重建（O(n) 变 O(1)）。
- 传入的索引**直接返回**（不复制、不校验）——纯函数信任调用方给的索引与数组一致。类方法那一层保证了这个不变量（`_buildIndex()` 在加载/追加后维护）。
- 【陷阱】如果你自己调用纯函数（比如写测试）只传 `entries` 不传 `byId`，会现场建索引——**但如果你传了一个过期的 `byId`，函数会按旧索引解析 parentId**（可能找到错误条目或找不到）。索引的"新鲜度"是调用方的责任。
- 【跳转】`this._buildIndex()` 的调用时机：`SessionManager` 的加载、追加、`createBranchedSession`（本篇第 7 节）等——读类代码时把这些点连起来看。

## 2. `buildSessionPath`：叶子回溯到根

【源码】

```typescript
function buildSessionPath(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionEntry[] {
	const index = buildEntryIndex(entries, byId);
	let leaf: SessionEntry | undefined;
	if (leafId === null) {
		return [];
	}
	if (leafId) {
		leaf = index.get(leafId);
	}
	leaf ??= entries[entries.length - 1];
	if (!leaf) {
		return [];
	}

	const path: SessionEntry[] = [];
	let current: SessionEntry | undefined = leaf;
	while (current) {
		path.push(current);
		current = current.parentId ? index.get(current.parentId) : undefined;
	}
	path.reverse();
	return path;
}
```

【注解（逐分支）】

- `leafId === null` → **显式空路径**：这是"没有活动叶子"的表达（`resetLeaf` 之后的状态）；与"没传 leafId"（undefined，走默认）语义不同。三态（null/undefined/具体 id）在这个仓库里很常见——**读参数时先看类型里的 `| null`**。
- `leafId` 给了但索引里找不到 → `leaf` 仍是 undefined → **回落到最后一条**（`leaf ??= entries[entries.length - 1]`）。【陷阱】这等于"悄悄忽略无效的 leafId"；调试点在于"为什么我传的 id 没生效"——答案往往是 id 拼错/条目已被删。
- 回溯循环：`current.parentId ? index.get(...) : undefined`——`parentId` 为 `null`（根）时结束循环。
- `path.reverse()`：内部是"叶→根"，**输出统一为"根→叶"**。之后所有函数（投影、压缩、分支导出）都假设时间顺序。
- 【陷阱】如果索引中**存在环**（手改文件造成的 A→B→A），这个 while 会**死循环**（没有 visited 集合）。会话文件是追加写入的正常情况下不可能成环，但"文件是不可信输入"的教训（第 9 章）在这里有一个真实的边界——阅读时意识到它即可。

## 3. `getSessionContextSettings`：设置也是"最后一笔赢"

【源码】

```typescript
function getSessionContextSettings(path: SessionEntry[]): Pick<SessionContext, "thinkingLevel" | "model"> {
	let thinkingLevel = "off";
	let model: { provider: string; modelId: string } | null = null;

	for (const entry of path) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
		} else if (entry.type === "model_change") {
			model = { provider: entry.provider, modelId: entry.modelId };
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			model = { provider: entry.message.provider, modelId: entry.message.model };
		}
	}

	return { thinkingLevel, model };
}
```

【注解】

- 沿**根→叶**顺序遍历，"后来的覆盖先前的"。
- 三种条目影响 model：
  1. `model_change`（用户显式切换）：记录**选择**（可能是虚拟模型，第 5 章）；
  2. **助手消息**：记录**实际回答的物理模型**（`message.provider`/`message.model`）。
- 因此最终值通常是"**最后一条助手消息的物理模型**"——因为助手消息一般出现在 `model_change` 之后。为什么以物理模型优先？因为恢复会话时要用"真的能用的模型"（第 3.5 节的 `getBranchSelection` 逻辑：先取会话模型，再核对认证）。
- 【陷阱】没有任何设置条目时：`thinkingLevel = "off"`、`model = null`——注意"off"是**默认值**而不是"条目里的值"；消费方（`createAgentSession`）要用"会话里有值才恢复，否则走默认设置"的逻辑（第 3.5 节 `hasThinkingEntry` 的存在就是为了区分"真的是 off"与"什么都没记录"）。
- 【陷阱】这个函数**只读消息里的两个字段**，不关心内容——所以即使助手消息是错误消息（`stopReason: "error"`，model 字段仍是失败的模型），也会被当作"最后使用的模型"。这在恢复失败会话时是有意为之（继续用刚才那个模型重试），但也解释了某些"恢复后用的模型和我最后选的虚拟模型不一样"的现象。

## 4. `sessionEntryToContextMessages`：翻译表

【源码】

```typescript
export function sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
	if (entry.type === "message") {
		const message = entry.message;
		// Session files are parsed without validation; old versions, forks, or
		// hand-edited files can contain messages with null/missing content.
		if (message.role === "system" && message.content == null) return [{ ...message, content: "" }];
		if (
			(message.role === "user" || message.role === "assistant" || message.role === "toolResult") &&
			message.content == null
		) {
			return [{ ...message, content: [] }];
		}
		return [message];
	}
	if (entry.type === "custom_message") {
		return [
			createCustomMessage(entry.customType, entry.content ?? [], entry.display, entry.details, entry.timestamp),
		];
	}
	if (entry.type === "branch_summary" && entry.summary) {
		return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
	}
	if (entry.type === "compaction") {
		const summary = createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp);
		return entry.systemMessage ? [entry.systemMessage, summary] : [summary];
	}
	return [];
}
```

【注解（按 entry.type）】

**`message`（普通消息）**

- 正常情况下**原样返回 `[message]`**（引用同一个消息对象）——投影不会为每条消息复制内容（性能）。
- 两个 `content == null` 兜底：**文件是不可信输入**（注释原文：老版本、fork、手改都可能缺字段）：
  - system → `""`；
  - user/assistant/toolResult → `[]`；
  - 返回**新对象**（`{ ...message, content: ... }`）而不是改原对象——【陷阱】这意味着"坏数据条目"在投影里得到修复后的副本，但**磁盘上的条目没有变**；如果你用对象身份去比对"投影消息 vs 条目消息"，坏数据条目会匹配不上（仓库的 `_entryIdsByMessage` 映射不依赖坏数据场景，但写测试时要知道这个差异）。
- 其余 roles（`toolResult` 之外的 `custom` 等）——注意 `message` 条目里的角色如果不在四种里（比如 `bashExecution` 作为消息存进 `message` 条目）会**原样返回**，由下游 `convertToLlm` 处理（第 4.4.2 节的扩展角色）。这个函数的任务只是"条目→消息"，不做 LLM 适配。

**`custom_message`（扩展注入）**

- 转成 `CustomMessage`（构造器 `createCustomMessage` 在 `core/messages.ts`）——**恢复时间戳**从 ISO 字符串解析回毫秒（构造器里 `new Date(timestamp).getTime()`）。
- `entry.content ?? []`：与 message 条目同样防御空内容。

**`branch_summary`（分支摘要）**

- `entry.summary` 非空才产出（`entry.summary &&`——摘要为空就跳过，不产半成品消息）。
- 转成 `BranchSummaryMessage`（`fromId` 也带上）——具体转 user 文本发生在 `convertToLlm` 阶段（第 4.4.2 节，带 `<summary>` 包装）。

**`compaction`（压缩）**

- 产**两条**（有系统检查点时）：`[entry.systemMessage, summary]`——顺序很重要：系统消息（检查点）在前，摘要（user 文本）在后。
- `entry.systemMessage` 就是压缩时保存的"完整提示词/工具声明检查点"（第 9.4.2/10.3 节）。
- 没有检查点（老版本）时只产摘要一条。

**其余条目**（`model_change`、`thinking_level_change`、`usage`、`context_edit`、`custom`、`label`、`session_info`、`session` 头部）：

- `return []`——**静默跳过**。这是"投影"的关键：设置/元数据/扩展私有数据**不产生上下文消息**（它们或以其他方式被消费，如设置提取；或完全不进模型）。

---

> D3 第一部分到此。第二部分：`buildContextEntries`（压缩折叠的完整算法）、`projectContextEntry`（编辑应用）、`buildSessionProjection`/`buildSessionContext`（总装）、`getBranch`、`createBranchedSession`（分支导出，含标签重连与内存分支）与总结。
---

# 第二部分：压缩折叠、编辑应用与分支导出

## 5. `buildContextEntries`：压缩折叠的完整算法

【源码】

```typescript
/**
 * Build the active, compaction-aware session entry list.
 *
 * This follows the current leaf path. If the path contains compaction entries,
 * the latest compaction is represented by the compaction entry itself, followed
 * by the kept entries starting at firstKeptEntryId and all entries after the
 * compaction entry. Older summarized entries are omitted.
 */
export function buildContextEntries(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionEntry[] {
	const path = buildSessionPath(entries, leafId, byId);
	let compaction: CompactionEntry | null = null;

	for (const entry of path) {
		if (entry.type === "compaction") {
			compaction = entry;
		}
	}

	if (!compaction) {
		return path;
	}

	const compactionIdx = path.findIndex((entry) => entry.id === compaction.id);
	if (compactionIdx < 0) {
		return path;
	}

	const contextEntries: SessionEntry[] = [compaction];
	let foundFirstKept = false;
	for (let i = 0; i < compactionIdx; i++) {
		const entry = path[i];
		if (entry.id === compaction.firstKeptEntryId) {
			foundFirstKept = true;
		}
		if (foundFirstKept && !(entry.type === "message" && entry.message.role === "system")) {
			contextEntries.push(entry);
		}
	}
	contextEntries.push(...path.slice(compactionIdx + 1));
	return contextEntries;
}
```

【注解（分四步）】

**第一步：找"最新压缩"**

```typescript
	let compaction: CompactionEntry | null = null;
	for (const entry of path) {
		if (entry.type === "compaction") {
			compaction = entry;
		}
	}
```

- 正序遍历、持续覆盖 → 得到**路径上最后一条**压缩。路径是"根→叶"，所以这就是时间上最新的。
- 【陷阱】为什么"只要最新"？之前的压缩结果已经体现在最新压缩的"保留区间"与摘要里了（第 10.3.4 节的"重复压缩从上一个保留边界开始"）；把更早的压缩条目也带上会造成双重折叠的错觉。

**第二步：无压缩 → 原样返回**

```typescript
	if (!compaction) return path;
```

- 没有压缩时，`buildContextEntries` 就是 `buildSessionPath` 的转手——**投影的"折叠"部分对未压缩会话是零成本的**。

**第三步：从压缩位置分两段**

```typescript
	const compactionIdx = path.findIndex((entry) => entry.id === compaction.id);
	if (compactionIdx < 0) return path;   // 理论不可达（compaction 来自 path），防御

	const contextEntries: SessionEntry[] = [compaction];
	let foundFirstKept = false;
	for (let i = 0; i < compactionIdx; i++) {
		const entry = path[i];
		if (entry.id === compaction.firstKeptEntryId) {
			foundFirstKept = true;
		}
		if (foundFirstKept && !(entry.type === "message" && entry.message.role === "system")) {
			contextEntries.push(entry);
		}
	}
```

- 输出的**第一项是压缩条目本身**（它会贡献"检查点系统消息 + 摘要消息"，见第 4 节）。
- 循环"压缩之前的路径"：在遇到 `firstKeptEntryId` 之前**全部丢弃**（被摘要替代）；从它开始（含自己）才保留。
- **保留区间里跳过 system 消息**：`!(entry.type === "message" && entry.message.role === "system")`——因为压缩条目自带 `systemMessage` 检查点（它是该边界的完整提示词/工具声明），保留旧系统消息会重复/矛盾（第 9.4.2 节的三条规则之一）。
- 【陷阱】跳过只针对"保留区间"（`i < compactionIdx` 的部分）；**压缩之后**的系统消息（`path.slice(compactionIdx + 1)`）不跳过——因为它们是压缩之后新增的（新的提示词补丁），必须保留。
- 【陷阱】`foundFirstKept` 用一个布尔量做"区间开关"：如果 `firstKeptEntryId` **不在路径上**（条目被删/指向别的分支），循环从头到尾 `foundFirstKept` 都是 false → **前面的所有条目全被丢弃**，只剩压缩条目 + 之后的条目。这是"保留边界丢失"时的保守行为（宁少不多）；而 retain-none 的压缩会把 `firstKeptEntryId` 指向自己（第 10.3.2 节的边界情况），此时"压缩条目自己"在第二段里本来就会被处理，前面同样全丢——语义一致。

**第四步：接上压缩之后的路径**

```typescript
	contextEntries.push(...path.slice(compactionIdx + 1));
```

- 压缩条目**之后**的所有条目照单全收（它们没被摘要覆盖）。
- 输出顺序 = 时间顺序（压缩条目虚拟地"站在"被摘要的位置上）。

**走查示例**

```text
磁盘路径（根→叶）：
  a1(user) a2(assistant) a3(user) a4(assistant) c(compaction) a5(user)
                                    firstKeptEntryId = a3

输出：
  [c, a3, a4, a5]
  （a1、a2 被摘要替代；保留区间里的 system 消息若有则跳过）

随后 sessionEntryToContextMessages 展开为：
  [检查点 system?, 压缩摘要] + [a3 消息, a4 消息, a5 消息]
```

## 6. `projectContextEntry`：编辑应用器的四条规则

【源码】

```typescript
function projectContextEntry(entry: SessionEntry, edit: ContextEditEntry | undefined): AgentMessage[] {
	const messages = sessionEntryToContextMessages(entry);
	if (!edit) return messages;
	const replacement = edit.replacement;
	if (replacement === null) return [];

	return messages.map((message) => {
		if (
			message.role !== "user" &&
			message.role !== "assistant" &&
			message.role !== "toolResult" &&
			message.role !== "custom"
		) {
			return message;
		}
		const content =
			(message.role === "assistant" || message.role === "toolResult") && typeof replacement.content === "string"
				? [{ type: "text" as const, text: replacement.content }]
				: replacement.content;
		return { ...message, content } as AgentMessage;
	});
}
```

【注解（四条规则）】

1. **无编辑 → 直通**：不与翻译层纠缠（性能与对象身份都保持）。
2. **`replacement === null` → 整体省略**（返回空数组，即"从投影里删掉这条"）。这是重试省略（`_omitRecoveryAttempt`，第 6.6.2 节）的机制落点。
3. **只有四种角色的内容可被替换**：user/assistant/toolResult/custom。system 消息**不受** context_edit 影响——【陷阱】为什么？因为系统消息在压缩后由检查点管；允许单独编辑某条系统消息会破坏"提示词可回放"的不变量。想改提示词要用系统补丁（第 10 章），不是 context_edit。
4. **assistant/toolResult 的字符串替换被归一为单个文本块**：这两类角色的 `content` 在类型上是**数组**（`ToolResultMessage.content` 必须数组；`AssistantMessage.content` 必须数组）——JSON 里写字符串会类型不符，所以归一化。user/custom 则允许字符串与数组两种形态（它们的类型本来就允许 `string | 数组`）。
- 返回**新对象**（展开拷贝）：原消息/原条目不变——"编辑只改投影"的又一体现。
- 【陷阱】`replacement.content` 的类型是"字符串或块数组"，这里对"对象但非字符串"的情况直接赋值给 `content`——如果 JSON 里写了个数字/对象，**类型上就被信任了**（会话文件是"未校验解析"，第 4 节）。这类信任边界在仓库里普遍存在：**内部生成的数据可信，外部/手改数据靠防御性代码兜**，但不可能兜住所有形状错误。读代码时要能分辨"哪些是契约、哪些是兜底"。

## 7. `buildSessionProjection` 与 `buildSessionContext`：总装

【源码】

```typescript
/** Build provenance-preserving, compaction-aware model context. */
export function buildSessionProjection(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionProjection {
	const path = buildSessionPath(entries, leafId, byId);
	const { thinkingLevel, model } = getSessionContextSettings(path);
	const contextEntries = buildContextEntries(entries, leafId, byId);
	const edits = new Map<string, ContextEditEntry>();
	for (const entry of contextEntries) {
		if (entry.type === "context_edit") edits.set(entry.targetId, entry);
	}
	const projectedEntries = contextEntries.map(
		(sourceEntry, index): ProjectedSessionEntry => ({
			sourceEntry,
			// buildContextEntries() may retain an older compaction entry because its
			// raw ID lies inside the newest retained range. Only the newest compaction
			// at index zero contributes a checkpoint and summary.
			messages:
				sourceEntry.type === "compaction" && index > 0
					? []
					: projectContextEntry(sourceEntry, edits.get(sourceEntry.id)),
		}),
	);
	return {
		entries: projectedEntries,
		messages: projectedEntries.flatMap((entry) => entry.messages),
		thinkingLevel,
		model,
	};
}

/** Build the finalized model context from the canonical session projection. */
export function buildSessionContext(
	entries: SessionEntry[],
	leafId?: string | null,
	byId?: Map<string, SessionEntry>,
): SessionContext {
	const { messages, thinkingLevel, model } = buildSessionProjection(entries, leafId, byId);
	return { messages, thinkingLevel, model };
}
```

【注解（六步）】

1. **设置从完整路径取**（`getSessionContextSettings(path)`）——注意用的是 `path`（未折叠），所以"被摘要掉的设置条目"也会被尊重？【陷阱】实际上设置条目只能出现在路径上、且通常不被摘要掉（compaction 的保留区间会从 firstKeptEntryId 起保留一切非 system 条目，包括设置）——但**被摘要掉的旧 `model_change` 对新上下文仍有影响**（因为它影响"当前用什么模型"这一**全局会话状态**，而不是某条消息）。这就是"折叠用于消息、设置看全路径"的分工。
2. **消息从折叠结果取**（`buildContextEntries`）——两套输入，正是 `SessionContext` 接口同时含 messages 与 settings 的原因。
3. **收集编辑**：

```typescript
	const edits = new Map<string, ContextEditEntry>();
	for (const entry of contextEntries) {
		if (entry.type === "context_edit") edits.set(entry.targetId, entry);
	}
```

   - 只收集**在折叠结果里**的编辑条目——【陷阱】这意味着"编辑必须与目标在同一个可见区间"。如果编辑条目本身被压缩摘要掉了，它的效果也就不在了（符合"摘要替代一切旧表示"的直觉）。
   - `Map.set` 的覆盖语义：**同一目标多条编辑，后面的（更新的）赢**（第 9.4.4 节的规则）。
4. **逐条投影并保留来源**：

```typescript
		({
			sourceEntry,
			messages: sourceEntry.type === "compaction" && index > 0
				? []
				: projectContextEntry(sourceEntry, edits.get(sourceEntry.id)),
		}),
```

   - `ProjectedSessionEntry` = `{ sourceEntry, messages }`——**provenance（来源）保留**：每条投影消息都能回溯到磁盘条目。这是沿活动投影理解界面消息、以及重试省略（`_findPersistedMessageEntryId`）的基础。`entry_appended` 则直接携带新条目，不通过投影反查；它也只由部分写入路径发出（第 4.5.2 节）。
   - `compaction && index > 0 → []`：**旧的压缩条目不再产消息**（注释给了原因：折叠结果里可能保留一条较早的压缩条目，因为它的 id 落在最新保留区间里；但只有 index 0 的最新压缩贡献检查点+摘要）。【陷阱】这是投影里唯一"按位置"而不是"按类型"判定的规则——读它时不要以为"所有 compaction 都不产消息"。
5. **扁平化 messages**：`flatMap`——`SessionProjection` 同时提供"逐条带来源"与"扁平消息数组"两种视图。
6. `buildSessionContext` 只是投影的**浅层再包装**：`{ messages, thinkingLevel, model }`。它存在的意义是给"只想要最终消息列表"的调用者一个更窄的返回类型（`SessionContext`），避免他们依赖 `entries` 的细节。

## 8. `getBranch`（类方法）：原始条目 vs 投影

【源码】

```typescript
	/**
	 * Includes all entry types (messages, compaction, model changes, etc.).
	 * Use buildSessionContext() to get the resolved messages for the LLM.
	 */
	getBranch(fromId?: string): SessionEntry[] {
		const path: SessionEntry[] = [];
		const startId = fromId ?? this.leafId;
		let current = startId ? this.byId.get(startId) : undefined;
		while (current) {
			path.push(current);
			current = current.parentId ? this.byId.get(current.parentId) : undefined;
		}
		path.reverse();
		return path;
	}
```

【注解】

- 与 `buildSessionPath` 同构，但：起点默认 `this.leafId`（类的当前叶子）；用 `this.byId`（常驻索引）；**不做压缩折叠、不做编辑应用、不做翻译**。
- 文档注释一句话划清了它与投影的界限："Includes all entry types. Use buildSessionContext() to get the resolved messages."
- 【陷阱】扩展在 `session_start` 里重建状态时用的就是它（第 13.5/14.7 节）：比如 `tools.ts` 逆序找最后一条 `custom` 条目。**别用 `buildSessionContext` 干这事**——它已经把 `custom` 条目过滤掉了（翻译表里 return []）。
- 【陷阱】`fromId` 给了但不存在 → `current` undefined → 返回 `[]`（空路径），而不是回落到默认叶子。与 `buildSessionPath` 的"回落最后一条"行为**不同**——同一个仓库里两种风格，读调用点时注意。

## 9. `createBranchedSession`：把"根→叶"导成一个新会话

【源码（完整，分两段）】

```typescript
	/**
	 * Create a new session file containing only the path from root to the specified leaf.
	 * Useful for extracting a single conversation path from a branched session.
	 * Returns the new session file path, or undefined if not persisting.
	 */
	createBranchedSession(leafId: string): string | undefined {
		const previousSessionFile = this.sessionFile;
		const path = this.getBranch(leafId);
		if (path.length === 0) {
			throw new Error(`Entry ${leafId} not found`);
		}

		// Filter out LabelEntry from path - we'll recreate them from the resolved map.
		// Because labels are real tree entries, later entries can be children of labels;
		// removing labels requires re-chaining the retained path to avoid orphaned subtrees.
		const pathWithoutLabels: SessionEntry[] = [];
		const replacementByLabelId = new Map<string, string>();
		const pendingLabelIds: string[] = [];
		let pathParentId: string | null = null;
		for (const entry of path) {
			if (entry.type === "label") {
				pendingLabelIds.push(entry.id);
				continue;
			}
			for (const labelId of pendingLabelIds) {
				replacementByLabelId.set(labelId, entry.id);
			}
			pendingLabelIds.length = 0;
			pathWithoutLabels.push(
				entry.type === "compaction"
					? {
							...entry,
							parentId: pathParentId,
							firstKeptEntryId:
								entry.firstKeptEntryId === entry.id
									? entry.id
									: (replacementByLabelId.get(entry.firstKeptEntryId) ?? entry.firstKeptEntryId),
						}
					: { ...entry, parentId: pathParentId },
			);
			pathParentId = entry.id;
		}

		const newSessionId = createSessionId();
		const timestamp = new Date().toISOString();
		const fileTimestamp = timestamp.replace(/[:.]/g, "-");
		const newSessionFile = join(this.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`);

		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: newSessionId,
			timestamp,
			cwd: this.cwd,
			parentSession: this.persist ? previousSessionFile : undefined,
		};

		// Collect labels for entries in the path
		const pathEntryIds = new Set(pathWithoutLabels.map((e) => e.id));
		const labelsToWrite: Array<{ targetId: string; label: string; timestamp: string }> = [];
		for (const [targetId, label] of this.labelsById) {
			if (pathEntryIds.has(targetId)) {
				labelsToWrite.push({ targetId, label, timestamp: this.labelTimestampsById.get(targetId)! });
			}
		}
```

```typescript
		if (this.persist) {
			// Build label entries
			const lastEntryId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
			let parentId = lastEntryId;
			const labelEntries: LabelEntry[] = [];
			for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
				const labelEntry: LabelEntry = {
					type: "label",
					id: generateId(new Set(pathEntryIds)),
					parentId,
					timestamp: labelTimestamp,
					targetId,
					label,
				};
				pathEntryIds.add(labelEntry.id);
				labelEntries.push(labelEntry);
				parentId = labelEntry.id;
			}

			this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
			this.sessionId = newSessionId;
			this.sessionFile = newSessionFile;
			this._buildIndex();

			// Use the same rule as _persist(): write now if the branched path already
			// has a conversation, otherwise let _persist() create the file later.
			if (this._hasConversation()) {
				this._rewriteFile();
				this.flushed = true;
			} else {
				this.flushed = false;
			}

			return newSessionFile;
		}

		// In-memory mode: replace current session with the path + labels
		const labelEntries: LabelEntry[] = [];
		let parentId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
		for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
			const labelEntry: LabelEntry = {
				type: "label",
				id: generateId(new Set([...pathEntryIds, ...labelEntries.map((e) => e.id)])),
				parentId,
				timestamp: labelTimestamp,
				targetId,
				label,
			};
			labelEntries.push(labelEntry);
			parentId = labelEntry.id;
		}
		this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
		this.sessionId = newSessionId;
		this._buildIndex();
		return undefined;
	}
```

【注解（分五个主题）】

**主题 A：取路径与前置校验**

- `this.getBranch(leafId)` 拿原始路径（含标签、含设置等一切类型）。
- 路径空 → 抛 `Entry ${leafId} not found`（与 `getBranch` 的"静默空数组"不同——这里是**写操作**，必须响亮失败）。

**主题 B：标签的"摘除与重连"（本函数最精妙的部分）**

- **问题**：标签（`label`）是**真实树节点**（第 9.5.2 节）。路径上可能有 `[a1, label1, a2, ...]` 这样的形状——`a2` 的 `parentId` 是 `label1`。如果直接删掉标签，`a2` 就指向了不存在的父节点。
- **解法**：重建 `parentId` 链：
  - 遍历路径，遇到标签先记进 `pendingLabelIds`（不写入输出）；
  - 遇到下一个**非标签**条目时，把之前攒下的所有标签 id 都映射到**这个条目**（`replacementByLabelId.set(labelId, entry.id)`）——语义："原来指向标签后面的位置，现在直接指向这个条目"；
  - 输出条目时把 `parentId` 换成**上一个非标签条目**（`pathParentId`）——重连链条。
  - 【陷阱】`pendingLabelIds` 在每次遇到非标签条目时清空（`length = 0`）——如果标签出现在路径**末尾**（最后一条就是标签），它们永远等不到"下一个非标签条目"，于是**不会**被映射、也必然不在 `pathWithoutLabels` 里——这些标签被丢弃（合理：新文件的叶子不可能是标签本身，`getBranch` 以标签为叶子的情况在导航语义下不太出现；即使出现，丢弃标签也不破坏路径连通性）。
- **压缩条目的 `firstKeptEntryId` 重映射**：

```typescript
			entry.type === "compaction"
				? {
						...entry,
						parentId: pathParentId,
						firstKeptEntryId:
							entry.firstKeptEntryId === entry.id
								? entry.id
								: (replacementByLabelId.get(entry.firstKeptEntryId) ?? entry.firstKeptEntryId),
					}
				: { ...entry, parentId: pathParentId },
```

  - `firstKeptEntryId === entry.id`（retain-none 的自指）保持自指；
  - 否则尝试通过 `replacementByLabelId` 重映射（保留边界原本落在某个被摘除的标签上时，改指其后第一个非标签条目）；映射不到就原样保留。
- 【陷阱】普通条目（非压缩）**只改 `parentId`**，其余字段（`timestamp`、`message` 内容等）原样——这是"复制路径"而不是"重新生成历史"。

**主题 C：新会话的身份与文件头**

- 新 id（`createSessionId()`）、新时间戳、文件名 = `join(会话目录, <时间戳去冒号点>_<id>.jsonl)`。
- Header：版本、id、timestamp、`cwd: this.cwd`、`parentSession: this.persist ? previousSessionFile : undefined`——**血缘只在持久模式写**（内存会话没有文件路径可指）。
- 【陷阱】`this.cwd` 是**当前** SessionManager 的 cwd——分支会话继承当前目录，而不是"某个历史条目的目录"（目录从来不是条目字段）。

**主题 D：标签的"收集与重建"**

- 收集：遍历 `this.labelsById`（类维护的"目标条目 → 标签文本"映射），**只保留目标在新路径上的标签**（`pathEntryIds.has(targetId)`）——路径外的标签不带进新会话（它们的目标没被导出）。
- 重建（持久模式）：新标签条目**挂在路径末尾**（`parentId = 最后一个非标签条目`），依次链接彼此；id 用 `generateId(new Set(pathEntryIds))` 生成（避开已用 id）。
- 【陷阱】重建的标签与原来的标签**不是同一批对象**：时间戳沿用（`labelTimestampsById`），但 id 全新、位置从"路径中间"变成"路径末尾"。语义上（"某条目的书签"）保持，结构上（树位置）重组。理解这一点才能解释"fork 后 `/tree` 里标签的位置看起来变了"。
- 【陷阱】`this.labelTimestampsById.get(targetId)!` 的**非空断言**：收集循环保证该 target 有标签（`labelsById` 与 `labelTimestampsById` 应该同键）——这是对"两个 Map 同步维护"的信任。读类里标签相关方法（`appendLabelChange` 等）时验证这个不变量。

**主题 E：两种模式的收尾（持久 vs 内存）**

- 持久模式：
  - `this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries]`——**整个 SessionManager 被"改造成"新会话**（注意：不是"另开一个 manager"，而是**当前对象原地变身**！）；
  - 更新 `sessionId`/`sessionFile`、重建索引；
  - **写盘策略**：`this._hasConversation()`（分支路径里有没有"真正的对话内容"）决定：
    - 有 → `_rewriteFile()` 立即写、`flushed = true`；
    - 无 → 不写、`flushed = false`（让后续的 `_persist()` 在第一次真正追加时创建文件）。
    - 注释点名了"与 `_persist()` 同一规则"——这种"延迟创建空文件"的细节是为了避免"fork 出空对话留下垃圾文件"。
  - 返回**新文件路径**（调用方——`AgentSessionRuntime.fork`——据此打开新会话，第 8.5.3 节）。
- 内存模式：结构与持久模式相同（header + 路径 + 重建标签），但**不落盘、返回 `undefined`**；注意内存模式的标签 id 生成用了 `[...pathEntryIds, ...labelEntries.map(e => e.id)]`（把已生成的标签 id 也纳入避让集合）——【陷阱】持久模式的 `generateId(new Set(pathEntryIds))` 里也**在循环内 `pathEntryIds.add(labelEntry.id)`**（下一轮自然避开）；两种模式殊途同归，但写法略有差异。
- 【陷阱】"当前对象原地变身"是理解 `fork` 流程的关键：`runtime.fork()` 在内存分支里其实是**同一个 SessionManager 换了一棵树**（第 8.5.3 节读过它调用 `sessionManager.open(...)` 或直接用当前对象）。这也解释了为什么 `createBranchedSession` 需要 `previousSessionFile`（变身前的文件路径）来写 `parentSession`。

## 10. 总结

### 10.1 三级流水线的输入输出（精确版）

| 阶段 | 输入 | 输出 | 做了什么 | 不做什么 |
|---|---|---|---|---|
| `buildSessionPath` | entries、leafId、索引 | 条目数组（根→叶） | 回溯 + 反转 | 不折叠、不翻译 |
| `buildContextEntries` | 同上 | 条目数组（含压缩折叠） | 找最新压缩、切保留区间、跳 system | 不应用编辑、不翻译 |
| `buildSessionProjection` | 同上 | `{ entries: {sourceEntry, messages}[], messages, thinkingLevel, model }` | 收集编辑、逐条翻译、跳旧压缩、扁平化、取设置 | 不产出最终 LLM 形态（那要 `convertToLlm`） |
| `buildSessionContext` | 同上 | `{ messages, thinkingLevel, model }` | 投影的窄包装 | 同上 |

【陷阱】`SessionProjection` 里的 messages 仍是 **`AgentMessage[]`**（自定义角色还在）——真正的 `Message[]` 转换发生在请求前的 `convertToLlm`（D1 第 18 节）。**三级流水线 ≠ 全部翻译**。

### 10.2 一个分支场景的完整走查

```text
磁盘条目（乱序展示，实际追加顺序在文件里）：
  a1 user "做 A"        a2 assistant "B"        a3 user "C（旧方向）"
  a4 user "D（新方向）"  a4.parentId = a2       （从 B 分叉）
  c1 compaction（c1.parentId = a4，firstKeptEntryId = a1）
  a5 user "E"（a5.parentId = c1）
  leaf = a5

getBranch()        → [a1, a2, a4, c1, a5]（含全部类型）
buildSessionPath() → 同上（本例 leaf 与前同）
buildContextEntries() → [c1, a1, a2, a4, a5]（保留 a1 起；假设无 system 消息可跳）
buildSessionProjection().messages
  → [c1 的检查点 system?, c1 摘要, a1 消息, a2 消息, a4 消息, a5 消息]
  →（若 a3 不在路径上，它从不出现在任何结果里）
```

### 10.3 阅读检查清单

- [ ] 我能说出三态 leafId（null / undefined / 具体值）在 `buildSessionPath` 里的三种行为吗？
- [ ] 我知道"保留区间跳过 system 消息"的原因吗？（检查点优先）
- [ ] 我能解释"旧压缩条目 index>0 不产消息"吗？
- [ ] 我知道 `context_edit` 的收集范围（折叠结果内）与"后者覆盖"规则吗？
- [ ] 我能区分 `getBranch` 与 `buildSessionContext` 的用途吗？（原始 vs 投影）
- [ ] 我能复述标签重连的两个映射（`replacementByLabelId` 与 `pathParentId`）吗？
- [ ] 我知道 `createBranchedSession` 是"当前对象原地变身"而不是"新开对象"吗？
- [ ] 我知道 `flushed` 的两种取值分别意味着什么吗？

---

> D3 完。下一篇（D4）精读系统提示与压缩：`buildSystemPromptSections`、`diffSystemPromptSections`、`shouldCompact`、`findCutPoint`、`serializeConversation`。
