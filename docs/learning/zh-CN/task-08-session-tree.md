# 08. 会话树、活动分支与恢复

> 预计时间：2 小时（不含选读）
> 先修：AgentSession 与资源生命周期

## 本篇你会学到

- 解释为什么 pi 把会话存成树，而不是一条线性消息列表。
- 读懂会话 JSONL 文件的每一行，并用 `parentId` 还原当前分支。
- 说明模型下一轮看到的消息，是怎样从“活动分支”算出来的。

## 先用一个例子理解

用户先问 pi 一个问题，pi 回答：

```text
A  用户：写一个求和函数
B  助手：给出了一个 for 循环版本
```

用户不满意 B，想回到 B 之后换一种问法：

```text
C  用户：改成 reduce 写法      （第一次尝试）
D  用户：改成递归写法          （换方向，从 B 重新开始）
```

这里有一个设计问题：C 和 D 都挂在 B 下面，两条路都要保留，同时当前只能有一条路是“正在继续的对话”。

**没有树会怎样？** 线性日志只能按时间记录 `A B C D`。有两种做法，都不好：

1. 覆盖：删掉 C，写入 D。旧路径丢失，用户后悔时无法回去。
2. 新文件：把 A、B 复制到新会话文件。同样的内容会被复制多份，标签和用量也要各存一份。

**pi 的做法：** 同一个文件里，每条记录都带一个 `parentId`，指向它的上一条。B 的两个孩子是 C 和 D。文件里有四行，但当前位置（叶子）是 D。

```text
A (user) ── B (assistant) ─┬─ C (user)   旧分支，仍在文件里
                           └─ D (user)   当前叶子
```

下一轮模型只看到从根到 D 的路径：A、B、D。C 在文件里，但不在这条路径上。

这一点是本篇的核心：**文件里有多少条目** 与 **模型看到多少内容** 是两件事。

## 核心概念

### 1. 会话文件：每行一个条目（JSONL）

**JSONL**（JSON Lines）是“每行一个 JSON 对象”的文本格式。pi 的会话文件就是 JSONL。文件第一行是会话头（`type` 为 `session`），其余每一行是一个**条目**（entry）。

条目的公共字段：

- `type`：条目类型，例如 `message`、`compaction`、`context_edit`；
- `id`：条目的短 ID；
- `parentId`：父条目的 ID，根条目为 `null`；
- `timestamp`：ISO 时间字符串。

下面是示意（字段已简化，实际行更长）：

```json
{"type":"session","version":3,"id":"<会话 ID>","timestamp":"...","cwd":"D:\\my-project"}
{"type":"message","id":"a1b2c3d4","parentId":null,"timestamp":"...","message":{"role":"user","content":"A"}}
{"type":"message","id":"e5f6a7b8","parentId":"a1b2c3d4","timestamp":"...","message":{"role":"assistant","content":[...]}}
```

**为什么用 JSONL？** 每次新增只需要在文件末尾追加一行，不必重写整个文件。这也让“坏了一行”不至于毁掉全部内容（见“读取时的容错”）。

**完整示例：6 个条目，其中一个分支**

下面的文件是脚本生成的真实输出。脚本依次写入 A、B、C、D，再把叶子移回 B，写入 E、F。文件建在系统临时目录，运行后已删除。每次运行的 ID 和时间戳都不同；路径里的临时目录用 `<tmp>` 代替。

```jsonl
{"type":"session","version":3,"id":"01a12607-a0d6-7113-9d42-9bed9b27cd34","timestamp":"2026-10-10T13:36:36.567Z","cwd":"<tmp>\\project"}
{"type":"message","id":"68693d1e","parentId":null,"timestamp":"2026-10-10T13:36:36.568Z","message":{"role":"user","content":"写一个求和函数","timestamp":1791639396568}}
{"type":"message","id":"5c642c29","parentId":"68693d1e","timestamp":"2026-10-10T13:36:36.569Z","message":{"role":"assistant","content":[{"type":"text","text":"for 循环版本"}],"api":"faux","provider":"faux","model":"faux-1","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1791639396569}}
{"type":"message","id":"2b00c36e","parentId":"5c642c29","timestamp":"2026-10-10T13:36:36.570Z","message":{"role":"user","content":"改成 reduce 写法","timestamp":1791639396570}}
{"type":"message","id":"553233c3","parentId":"2b00c36e","timestamp":"2026-10-10T13:36:36.570Z","message":{"role":"assistant","content":[{"type":"text","text":"reduce 版本"}],"api":"faux","provider":"faux","model":"faux-1","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1791639396570}}
{"type":"message","id":"ecd3442a","parentId":"5c642c29","timestamp":"2026-10-10T13:36:36.571Z","message":{"role":"user","content":"改成递归写法","timestamp":1791639396571}}
{"type":"message","id":"60d86ac2","parentId":"ecd3442a","timestamp":"2026-10-10T13:36:36.571Z","message":{"role":"assistant","content":[{"type":"text","text":"递归版本"}],"api":"faux","provider":"faux","model":"faux-1","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},"stopReason":"stop","timestamp":1791639396571}}
```

逐行说明（第 1 行是文件头，第 2 至 7 行是条目）：

| 行 | `type` | `id` | `parentId` | 含义 |
| --- | --- | --- | --- | --- |
| 1 | `session` | `01a12607-...` | 无 | 文件头。`version` 为 3，`cwd` 记录项目目录 |
| 2 | `message` | `68693d1e` | `null` | 条目 A，根节点，用户消息 |
| 3 | `message` | `5c642c29` | `68693d1e` | 条目 B，A 的孩子，助手回复 |
| 4 | `message` | `2b00c36e` | `5c642c29` | 条目 C，B 的第一个孩子，第一条分支 |
| 5 | `message` | `553233c3` | `2b00c36e` | 条目 D，C 的孩子，这条分支的末端 |
| 6 | `message` | `ecd3442a` | `5c642c29` | 条目 E，B 的第二个孩子，第二条分支 |
| 7 | `message` | `60d86ac2` | `ecd3442a` | 条目 F，E 的孩子。写入时它是叶子 |

几点观察：

- 助手消息（第 3、5、7 行）比用户消息长得多，因为它带 `api`、`provider`、`model`、`usage`、`stopReason` 等字段。用户消息只有 `role`、`content`、`timestamp`。
- 文件里没有“叶子”这一项。叶子不写入文件；打开文件时，`_buildIndex` 把最后一行当作叶子（这里是 F）。
- 行级 `timestamp` 是 ISO 字符串；`message.timestamp` 是 Unix 毫秒数。两种格式不同，读文件时不要混用。

**条目类型与写入时机**

文件里每一行都有 `type`。下表列出 `SessionManager` 的写入方法、应用中调用它们的时机，以及该条目是否变成模型消息。调用位置只写文件名；`agent-session.ts` 指 `packages/coding-agent/src/core/agent-session.ts`。

| `type` | 写入方法 | 什么时候写入 | 进入模型消息 |
| --- | --- | --- | --- |
| `session` | 无单独方法（新建文件或导出文件时写第一行） | 新建会话文件，或导出分支、分叉文件时 | 不适用（文件头） |
| `message` | `appendMessage` | 每条用户、助手、工具结果消息；bash 执行结果也用它（`agent-session.ts`） | 是 |
| `thinking_level_change` | `appendThinkingLevelChange` | 思考强度改变（`sdk.ts`、`agent-session.ts`） | 否，参与设置提取 |
| `model_change` | `appendModelChange` | 切换模型（`sdk.ts`、`agent-session.ts`） | 否，参与设置提取 |
| `usage` | `appendUsage` | 缓存预热等场景记录用量（`cache-warmer.ts`） | 否 |
| `compaction` | `appendCompaction` | 压缩完成后（`agent-session.ts`） | 是，摘要消息 |
| `custom` | `appendCustomEntry` | 扩展或内部状态，例如虚拟模型状态（`agent-session.ts`） | 否 |
| `custom_message` | `appendCustomMessageEntry` | 扩展或系统注入的消息（`agent-session.ts`） | 是 |
| `session_info` | `appendSessionInfo` | 设置会话名称（`main.ts`、`agent-session.ts`） | 否 |
| `label` | `appendLabelChange` | 给条目加标签或清除标签（`interactive-mode.ts`、`agent-session.ts`） | 否 |
| `context_edit` | `appendContextEdit` | 把某条消息从模型输入中去掉，例如 `_omitRecoveryAttempt`（`agent-session.ts`） | 否，改变投影 |
| `branch_summary` | `branchWithSummary` | 带摘要切换分支时（`navigateTree`，`agent-session.ts`） | 是，`branchSummary` 消息 |

说明：同一个 `type` 可能有多个调用方，表中只列代表性位置。`thinking_level_change` 和 `model_change` 不产生消息，但 `getSessionContextSettings` 沿活动路径读取它们，决定恢复会话时的思考强度和模型。

### 2. parentId 与树

**树**（tree）是每个节点只有一个父节点的结构。在会话里，`parentId` 就是这条父子边。

- 根条目的 `parentId` 为 `null`。
- 一个条目可以有多个孩子，这就是分支。
- 从任一条目沿 `parentId` 一路往上走，最终会到根。

例如：

```text
id=a1 parent=null
id=b2 parent=a1
id=c3 parent=b2
id=d4 parent=b2     ← b2 有两个孩子：c3 和 d4
```

把上面 6 个条目的文件画成树。叶子用 `<- leaf` 标记。结构与脚本中 `getTree()` 的输出一致，标记是脚本手工加的：

```text
A (user)                        id=68693d1e
└─ B (assistant)                id=5c642c29
   ├─ C (user)                  id=2b00c36e     第一条分支
   │  └─ D (assistant)          id=553233c3     第一条分支的末端
   └─ E (user)                  id=ecd3442a     第二条分支
      └─ F (assistant)          id=60d86ac2     <- leaf
```

读这张图要抓两点：

- 每个节点只有一个父节点，线只从上往下连。B 有两个孩子，所以出现分叉。
- 叶子只有一个。C、D 仍在文件里，但从根到 F 的路径（A、B、E、F）不经过它们。

### 3. 叶子指针（leaf）

**叶子**（leaf）是当前所在的条目，也就是“正在继续的这条路”的末端。`SessionManager` 用一个字段 `leafId` 记录它。

两条规则决定了叶子怎么变化：

- 追加新条目时，新条目的 `parentId` 等于当前叶子，然后叶子移动到新条目。
- `branch(id)` 只移动叶子，不删除也不改写任何条目。

所以“分支”在 pi 里不是复制文件，而是**把叶子移到更早的条目上**，之后的追加会长出新的孩子。

### 4. 活动分支（active branch）

**活动分支**（active branch）是从根到叶子的那条路径。`SessionManager.getBranch()` 返回这条路径上的**原始条目**（包括设置条目、标签等所有类型）。

它沿着叶子向上走，直到根，然后反转为“根到叶”的顺序。

**逐步回溯：两个叶子的例子。** 上面说的回溯由 `buildSessionPath` 完成。它是模块内函数，没有导出，所以下面两张表是按它的循环逐步写出的。脚本用同样的步骤跑了一遍，结果与 `getBranch()` 和 `buildContextEntries()` 完全一致。

叶子为 F（当前叶子）：

| 步 | 当前条目 | 它的 `parentId` | 动作 |
| --- | --- | --- | --- |
| 1 | F | E | 放入 `path`，`current` 移到 E |
| 2 | E | B | 放入 `path`，`current` 移到 B |
| 3 | B | A | 放入 `path`，`current` 移到 A |
| 4 | A | `null` | 放入 `path`；`parentId` 为空，`current` 变为 `undefined`，循环结束 |

反转后得到 `A -> B -> E -> F`。

叶子为 D（旧分支的末端）：

| 步 | 当前条目 | 它的 `parentId` | 动作 |
| --- | --- | --- | --- |
| 1 | D | C | 放入 `path`，`current` 移到 C |
| 2 | C | B | 放入 `path`，`current` 移到 B |
| 3 | B | A | 放入 `path`，`current` 移到 A |
| 4 | A | `null` | 放入 `path`，循环结束 |

反转后得到 `A -> B -> C -> D`。

两个叶子共用了 A 和 B，只有末端不同。路径只由叶子决定，同一份文件可以得到不同的路径。

源码中还有两个边界。以下是按源码阅读的结论，未单独运行：`leafId` 为 `null` 时直接返回空数组；给定的 ID 在索引中找不到（或 `leafId` 缺省）时，退回到数组的最后一条。

### 5. 投影（projection）：活动分支变成模型消息

**投影**（projection）是把原始条目算成“模型实际看到的消息”的过程。它分三步，每一步都是纯计算，不修改文件：

1. 找活动路径（叶子回溯到根）。
2. 压缩折叠：**压缩**（compaction）是用一段摘要代替较早的消息。读取时，如果活动路径上有压缩条目，它前面的旧消息会被丢弃，只保留摘要和 `firstKeptEntryId` 开始的保留区间。摘要本身如何生成，放在下一篇讲。
3. 编辑与转换：**上下文编辑**（context edit）是一条追加的规则，它替换某个条目的模型内容，或把它从模型输入中去掉。设置类条目（如模型切换）不产生消息，但会参与设置提取。最后把每个条目翻译为消息。

`SessionManager.buildSessionContext()` 返回最终结果：`{ messages, thinkingLevel, model }`。`messages` 才是下一轮要送给模型的历史（系统提示和工具声明另外处理，不在本篇范围内）。

以 6 条目文件、叶子为 F 为例，三步的结果如下：

| 步 | 结果 |
| --- | --- |
| 1. 活动路径 | A、B、E、F |
| 2. 压缩折叠 | 没有压缩条目，路径原样保留 |
| 3. 编辑与转换 | 没有编辑条目；四个 `message` 条目各翻译为一条消息 |

脚本输出的模型消息如下：

```text
user:写一个求和函数 | assistant:for 循环版本 | user:改成递归写法 | assistant:递归版本
```

C 和 D（reduce 那一支）没有出现。如果要让它们进入模型输入，应当把叶子移到 D（`branch(D)`），活动路径就会变成 A、B、C、D。改文件不是正确做法。

### 6. SessionManager：会话文件的句柄

`SessionManager` 是会话文件的对象化句柄。它保存：

- 会话文件路径和会话 ID；
- 全部条目的数组 `fileEntries`，以及按 ID 查找的索引 `byId`；
- 叶子指针 `leafId`；
- 是否已经落盘的标记 `flushed`。

创建方式有三个常用静态工厂：

| 工厂 | 用途 | 是否写文件 |
| --- | --- | --- |
| `SessionManager.create(cwd, sessionDir?)` | 新会话 | 是（第一条用户或助手消息之后） |
| `SessionManager.open(path, sessionDir?, cwdOverride?)` | 打开已有文件 | 是（追加） |
| `SessionManager.inMemory(cwd?, options?, entries?)` | 内存会话，用于测试 | 否 |

**叶子不落盘。** 文件里没有记录“叶子在哪”。`_buildIndex` 打开文件时总是把最后一行当作叶子。脚本验证了这一点：

- 在内存中调用 `branch(A)` 后，`getLeafId()` 为 A，文件内容不变。
- 关闭后重新 `open`，叶子变成 C（文件中最后一条有效条目），`getBranch()` 为 `A -> B -> C`。

按源码，无摘要的分支切换只移动叶子，不追加条目。所以用 `/tree` 切换到别处、但没有发送新消息就退出，下次打开时叶子会回到文件末尾。`navigateTree` 本身未在本地运行，这一结论未在本地验证。要让叶子停在别处，需要在新位置发送一条消息，或打开后再次调用 `branch(id)`。

**惰性建文件的例子。** 脚本验证了“第一条用户或助手消息才建文件”这条规则。输出是真实运行结果：

```text
after setup entries: file exists = false | entries in memory = 2
after first user message: file exists = true
line types: session, model_change, thinking_level_change, message
```

先写入模型切换和思考强度两条设置，文件不存在，它们只在内存里。第一条用户消息出现时才创建文件，并把此前的设置条目一起写入。所以文件里 `model_change` 和 `thinking_level_change` 排在 `message` 前面。

### 分支操作：/tree、/fork 与分支摘要

以下是基于这些原语的用户操作，不是新的数据结构。

- **`/tree`**：在同一个文件里切换分支。交互模式把 `/tree` 交给 `AgentSession.navigateTree`，它按用户选择调用 `branch`、`resetLeaf` 或 `branchWithSummary`。（`navigateTree` 的完整流程未逐行精读。）
- **分支摘要**：离开一条分支时，`branchWithSummary(branchFromId, summary)` 追加一条 `branch_summary` 条目。它的 `parentId` 是新的起点，`fromId` 记录被放弃的旧叶子。下一轮模型会收到一条 `branchSummary` 消息，内容是这段摘要。摘要的文字由调用方提供；生成摘要的流程属于 `navigateTree`，未在本篇展开。

**分支摘要如何进入模型消息。** 问题：用户离开 C、D 这条路以后，如果模型对那段尝试一无所知，就可能重复同样的做法。例子：实验的第 3 步之后，模型消息多出一条 `branchSummary`，内容为 `[summary] summary of the reduce and map attempts`。它的处理分三步：

1. 存储：`branch_summary` 条目保存摘要文字和 `fromId`（被放弃的旧叶子）。
2. 投影：`sessionEntryToContextMessages` 调用 `createBranchSummaryMessage(summary, fromId, timestamp)`，生成 `branchSummary` 消息。
3. 发送：转换为模型请求时（`messages.ts` 中的转换逻辑），文字是 `BRANCH_SUMMARY_PREFIX` + 摘要 + `BRANCH_SUMMARY_SUFFIX`。前缀说明“以下是对话刚刚离开的一条分支的摘要”，让模型知道这段内容的性质。

这样做的原因是：`branch_summary` 不是用户说过的话，而是对被放弃分支的说明。把它单独标成 `branchSummary`，模型才能区分“用户的消息”和“摘要描述的旧尝试”。
- **`/fork`**：把当前路径另存为一个新文件。运行时的分叉路径调用 `createBranchedSession(leafId)`（位于 `agent-session-runtime.ts`，未逐行精读）。它只复制根到目标叶子的路径，其他分支不带过去。

**工作示例：在 F 上用 `/tree` 回到 C。** 文件是上面的 6 条目文件，叶子为 F。用户想换掉“改成 reduce 写法”这条消息，重新提问。

问题在于 C 是用户消息。如果把叶子直接设为 C，下一条助手回复会挂在 C 下面，但用户还没有输入新内容。所以 `navigateTree` 对用户消息做了特殊处理，规则如下：

- 目标是 `user` 或 `custom_message` 消息：新叶子设为它的父条目，它的文字放进输入框，用户编辑后再发送。
- 目标是其他类型（如助手消息）：新叶子就是目标本身。
- 目标与当前叶子相同：直接返回，什么都不做。
- 没有摘要：新叶子为 `null` 时调用 `resetLeaf()`，否则调用 `branch(新叶子)`。
- 有摘要：调用 `branchWithSummary(新叶子, 摘要)`，摘要挂在新叶子下面。

脚本用 `SessionManager` 的 `branch`、`resetLeaf`、`branchWithSummary` 复现了这段分支逻辑。`AgentSession.navigateTree` 本身没有运行（它需要模型和扩展运行时），未在本地验证；摘要文字由脚本给定，没有调用模型生成。下表是脚本的真实输出：

| 步 | 操作 | 叶子 | 活动分支 | 输入框 | 模型消息 |
| --- | --- | --- | --- | --- | --- |
| 0 | 初始状态 | F | A -> B -> E -> F | 空 | 写一个求和函数；for 循环版本；改成递归写法；递归版本 |
| 1 | `/tree` 选中 C（用户消息） | B | A -> B | 改成 reduce 写法 | 写一个求和函数；for 循环版本 |
| 2 | 用户发送新消息 G（改成 map 写法） | G | A -> B -> G | 空 | 未打印 |
| 3 | `/tree` 选中 B，选择带摘要的切换 | S | A -> B -> S | 空 | 前两条不变，多出 `branchSummary`：`[summary] summary of the reduce and map attempts` |

观察：

- C、D、E、F 都还在文件里。第 3 步之后，`getEntries()` 共 8 个条目（A 到 G 加 S），一个都没删。
- 第 1 步之后，C 不在活动分支上，模型看不到它。只有用户编辑输入框并发送，它才会以新的内容出现在新分支上。
- 第 3 步的摘要挂在 B 下面。`branchSummary` 消息告诉模型那段被放弃的尝试是什么。

## 三种视图：同一份文件，三个答案

对同一个会话文件（叶子为 D），三个调用给出三种不同结果：

| 视图 | 调用 | 本例结果 | 用途 |
| --- | --- | --- | --- |
| 原始条目 | `getEntries()` | A、B、C、D | 导出、审计、界面上的完整树 |
| 活动分支 | `getBranch()` | A、B、D（原始条目，可能含非消息类型） | 确定当前位置，查找某类条目 |
| 模型上下文 | `buildSessionContext().messages` | user A、assistant B、user D | 下一次请求发给模型的历史 |

所以“把 `getEntries()` 直接发给模型”是错的：它会把 C 这条已经放弃的分支、设置条目、编辑条目等全部塞进去。模型只应收到第三列。

### 压缩如何改变第三列（按源码推导，未运行）

压缩会让第三列变短。假设活动路径（根到叶）是 `a1 user`、`a2 assistant`、`a3 user`、`a4 assistant`、`c compaction`、`a5 user`，其中 `c` 的 `firstKeptEntryId` 是 `a3`。

按 `buildContextEntries` 的逻辑：

- 压缩条目 `c` 排在最前面；
- `a1`、`a2` 在 `firstKeptEntryId` 之前，被丢弃；
- `a3`、`a4` 从 `firstKeptEntryId` 开始保留；
- `a5` 在压缩之后，原样保留。

结果顺序为 `c, a3, a4, a5`。模型消息则是：`c` 对应的摘要消息（有检查点时先是系统检查点），后面跟 `a3`、`a4`、`a5` 的消息。`a1`、`a2` 不再出现在第三列，但仍在文件中。

这一段是按源码逻辑推导的示意，本篇的实验都没有调用 `appendCompaction`，因此没有在本地运行验证。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径（相对仓库根） | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/coding-agent/src/core/session-manager.ts` | `CURRENT_SESSION_VERSION` | 当前格式版本，值为 3 |
| 2 | 同上 | `parseSessionEntryLine`、`loadEntriesFromFile` | 坏行返回 `null` 并跳过；文件头无效时返回空数组 |
| 3 | 同上 | `SessionManager.create`、`open`、`inMemory` | 三种入口的区别：是否落盘，文件从哪里来 |
| 4 | 同上 | `_setSessionFile`、`newSession` | 空文件怎样初始化；非空但无效的文件为什么拒绝打开 |
| 5 | 同上 | `_buildIndex` | 打开文件时叶子默认是最后一行 |
| 6 | 同上 | `appendMessage`、`_appendEntry` | `parentId` 取自当前叶子；写入后叶子前进 |
| 7 | 同上 | `_persist`、`_hasConversation` | 文件何时真正创建（惰性建文件） |
| 8 | 同上 | `branch`、`resetLeaf`、`branchWithSummary` | 只移动叶子；不删除条目 |
| 9 | 同上 | `getEntries`、`getBranch`、`getTree` | 原始条目视图，三者含义不同 |
| 10 | 同上 | `buildSessionPath`（模块内函数，未导出） | 从叶子回溯到根，再反转 |
| 11 | 同上 | `buildContextEntries`（导出） | 压缩折叠：只认活动路径上最新的压缩 |
| 12 | 同上 | `sessionEntryToContextMessages`（导出） | 条目到消息的翻译表；哪些类型不产生消息 |
| 13 | 同上 | `buildSessionProjection`、`buildSessionContext`（导出） | 编辑应用、设置提取，最终 `messages` |
| 14 | 同上 | `appendContextEdit` | 目标必须在活动分支上，否则抛错 |
| 15 | 同上 | `appendCompaction` | 压缩条目的写法；`firstKeptEntryId` 为 `null` 时指向自己 |
| 16 | 同上 | `createBranchedSession` | 导出一条路径为新文件 |
| 17 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession.navigateTree` | `/tree` 怎样调用上面的分支原语（只读调用点） |
| 18 | `packages/coding-agent/src/core/messages.ts` | `createBranchSummaryMessage`、`BRANCH_SUMMARY_PREFIX` | 分支摘要如何变成模型消息 |
| 19 | `packages/coding-agent/docs/session-format.md` | （文档） | 格式说明；选读部分的字段表以它和源码为准 |

## 走读一次完整过程

以下步骤对应“动手实验 1”。每一步写明：发生了什么，调用哪个函数，状态怎样变化。

1. **创建会话。** 调用 `SessionManager.create(cwd, sessionDir)`。
   - 函数：`create` → 私有构造器 → `newSession`。
   - 状态：生成会话 ID 和文件路径，`leafId = null`，`flushed = false`。此时还没有写文件。

2. **追加用户消息 A。** 调用 `appendMessage(user("A"))`。
   - 函数：`appendMessage` → `_appendEntry` → `_persist`。
   - 状态：`parentId` 取 `leafId`，也就是 `null`；`fileEntries` 加入 A；`byId` 加入 A；`leafId = A`。
   - `_persist` 发现 `flushed` 为假，而且 `_hasConversation()` 为真（A 是用户消息），于是创建文件，把当前全部条目（会话头和 A）一次写入。之后 `flushed = true`。

3. **追加助手消息 B 和用户消息 C。** 每次调用 `appendMessage`。
   - 状态：B 的 `parentId = A`，C 的 `parentId = B`；叶子依次变为 B、C。
   - `_persist` 这时走追加分支，只写一行。

4. **移动叶子到 B。** 调用 `branch(B)`。
   - 函数：`branch` 检查 B 存在，然后设置 `leafId = B`。
   - 状态：文件没有任何变化。C 仍在文件里。

5. **追加用户消息 D。** 调用 `appendMessage(user("D"))`。
   - 状态：D 的 `parentId = B`，叶子变为 D。文件末尾追加一行。文件现在有 A、B、C、D 四个条目。

6. **重新打开文件。** 调用 `SessionManager.open(file)`。
   - 函数：`open` → `loadEntriesFromFile` → 构造器 → `_buildIndex`。
   - `_buildIndex` 遍历全部条目，把最后一条的 ID 设为叶子。文件最后一行是 D，所以叶子是 D。
   - 注意：`_buildIndex` 不会恢复“叶子在别处”的状态。要停在别的位置，需要调用方再次 `branch(id)`。

7. **取活动分支。** 调用 `getBranch()`。
   - 函数：`getBranch` 从 `leafId` 出发，沿 `byId` 查父条目，直到 `parentId` 为 `null`，然后反转。
   - 结果：D → B → A，反转后为 A、B、D。C 不在这条路径上。

8. **算模型上下文。** 调用 `buildSessionContext()`。
   - 函数：`buildSessionContext` → `buildSessionProjection` → `buildSessionPath` → `buildContextEntries` → `projectContextEntry` → `sessionEntryToContextMessages`。
   - 本例没有压缩和编辑，所以压缩折叠不生效。每条 `message` 原样转为消息。
   - 结果：`messages` 为 A、B、D 三条。这就是下一轮模型看到的历史。

上面 6 步每一步之后，文件和叶子的状态如下。文件行数包含会话头。第 5、6 步的结果来自实验 1 的真实输出（最终文件为 5 行）；第 1 至 4 步的中间行数按 `_persist` 的逻辑推导，未逐步运行。

| 步 | 动作 | 文件行数 | 叶子 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | `create` | 0 | `null` | 文件尚未创建 |
| 2 | 追加 A | 2 | A | 第一条用户消息触发建文件，写入头和 A |
| 3 | 追加 B、C | 4 | C | 每次追加一行 |
| 4 | `branch(B)` | 4 | B | 文件不变 |
| 5 | 追加 D | 5 | D | D 的父是 B，不是 C |
| 6 | `open` | 5 | D | 叶子取文件最后一行 |

## 读取时的容错

会话文件是追加写的。如果程序在写入中途退出，文件末尾可能留下半行。pi 的读取逻辑有三条规则：

1. **坏行直接跳过。** `parseSessionEntryLine` 对每一行做 `JSON.parse`，失败就返回 `null`，`loadEntriesFromFile` 跳过它。一行损坏不会让整个会话打不开。
2. **末尾的半行会被修复。** 如果文件最后一段没有换行符，`loadEntriesFromFile` 在读完后追加一个换行。这样下一次追加的新行不会和半行粘在一起。
3. **文件头无效则拒绝打开。** 如果第一条有效记录不是会话头，`loadEntriesFromFile` 返回空数组。`_setSessionFile` 发现文件非空但没有有效条目，会抛出 `Session file is not a valid ... session`，并且不修改文件。

规则 1 和 2 偏向“尽量读出来”，规则 3 偏向“不要毁掉用户的文件”。两者都是为了文件损坏时保护用户数据。

**真实的损坏文件示例。** 下面的文件由脚本生成：先写入 A、B 两条消息，再追加一行垃圾文本，最后追加一个没有换行符的半行，模拟程序在写入中途退出。文件内容如下。为便于阅读，第 1 至 3 行省略了部分字段，用 `...` 标出；其余与运行输出一致。

```text
line 1: {"type":"session","version":3,"id":"01a12607-...","timestamp":"...","cwd":"<tmp>\\project2"}
line 2: {"type":"message","id":"231071f2","parentId":null,"timestamp":"...","message":{"role":"user","content":"A",...}}
line 3: {"type":"message","id":"c984ce3c","parentId":"231071f2","timestamp":"...","message":{"role":"assistant","content":[...],...}}
line 4: this is not json
line 5: {"type":"message","id":"x
```

第 5 行末尾没有换行符，这就是“半行”。对这个文件运行 `loadEntriesFromFile` 和 `SessionManager.open`，脚本的输出如下：

```text
loadEntriesFromFile count: 3 types: session,message,message
repair appended: "\n"
open getBranch roles: user -> assistant
```

逐行看发生了什么：

1. 第 4 行：`JSON.parse` 失败，`parseSessionEntryLine` 返回 `null`，`loadEntriesFromFile` 跳过它。
2. 第 5 行：没有换行符，所以它一直留在读取缓冲区里。读到文件末尾时它仍然解析失败，同样被跳过。
3. 修复：读完后缓冲区不为空，`loadEntriesFromFile` 追加一个 `\n`。这就是输出中 `repair appended` 那一行。之后追加的新行会从单独一行开始，不会接在半行后面。
4. 打开：`_buildIndex` 把最后一条有效条目（B）当作叶子。坏行不会成为叶子。

结果是读出 3 条（文件头、A、B），而不是 4 条或 5 条。

如果没有第 3 步，下一次 `appendMessage` 写出的 JSON 会接在 `"x` 后面，变成一行无法解析的文本，新消息也会丢失。这是按代码推导的结论，没有单独运行。

另一种情况是文件头无效。脚本写入一个第一行为 `garbage line`、第二行为一条有效消息的文件：

```text
loadEntriesFromFile count: 0
open error: Session file is not a valid pi session: <tmp>\bad.jsonl
file unchanged: true
```

第一条有效记录不是会话头，所以 `loadEntriesFromFile` 返回空数组。这个判断在修复之前进行，因此文件不会被改写。`open` 发现文件非空却没有有效会话，于是报错。pi 宁可拒绝打开，也不改写用户的文件。

## 动手实验

以下实验只使用内存会话或临时目录，不调用模型，不需要密钥，也不读取你的真实会话文件。

所有输出都是在 Node v23.9.0 上运行得到的。输出前可能有 Node 的 `ExperimentalWarning`（类型剥离警告），可忽略。脚本中的 `as never` 只为跳过类型检查，因为临时脚本不做类型检查；仓库代码中不要这样写。

### 实验 1：构造分支会话并打印活动路径

**目的：** 观察“文件中的全部条目”“活动分支”“模型消息”三者的差别。

**步骤：**

1. 把下面的脚本保存为临时文件 `pi-task08-run.mts`。第一行 `import` 中的路径改为你本机仓库的 `file:///` 绝对路径（Windows 形如 `file:///D:/.../packages/coding-agent/src/core/session-manager.ts`）。
2. 运行它。
3. 运行后删除脚本文件。

脚本会在系统临时目录里创建会话文件，并在结束时删除该目录。

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "file:///D:/Github/pi/packages/coding-agent/src/core/session-manager.ts";

const root = mkdtempSync(join(tmpdir(), "pi-task08-"));
const cwd = join(root, "project");
const sessionDir = join(root, "sessions");
mkdirSync(cwd, { recursive: true });

const user = (text: string) => ({ role: "user", content: text, timestamp: Date.now() });
const assistant = (text: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "faux",
	provider: "faux",
	model: "faux-1",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: Date.now(),
});

// Build A -> B -> C, then move the leaf back to B and append D.
const s = SessionManager.create(cwd, sessionDir);
const labels = new Map<string, string>();
const a = s.appendMessage(user("A") as never);
labels.set(a, "A");
const b = s.appendMessage(assistant("B") as never);
labels.set(b, "B");
const c = s.appendMessage(user("C") as never);
labels.set(c, "C");
s.branch(b);
const d = s.appendMessage(user("D") as never);
labels.set(d, "D");

const file = s.getSessionFile();
if (!file) throw new Error("no session file");
const name = (id: string | null) => (id === null ? "null" : (labels.get(id) ?? id));

console.log("== 1. JSONL file lines (one per entry) ==");
for (const line of readFileSync(file, "utf8").trim().split("\n")) {
	const e = JSON.parse(line);
	if (e.type === "session") {
		console.log(`header version=${e.version}`);
	} else {
		const text = e.type === "message" ? (typeof e.message.content === "string" ? e.message.content : e.message.content[0].text) : "";
		console.log(`${name(e.id)} type=${e.type} parent=${name(e.parentId)} ${text}`);
	}
}

// Reopen from disk: open() selects the last line as the leaf.
const reopened = SessionManager.open(file);
console.log("\n== 2. Reopened: leaf and active path (getBranch) ==");
console.log("leaf =", name(reopened.getLeafId()));
console.log("getBranch =", reopened.getBranch().map((e) => name(e.id)).join(" -> "));
console.log("getEntries =", reopened.getEntries().map((e) => name(e.id)).join(", "));

console.log("\n== 3. Model context (buildSessionContext().messages) ==");
for (const m of reopened.buildSessionContext().messages) {
	const text = typeof m.content === "string" ? m.content : (m.content as Array<{ text?: string }>)[0]?.text;
	console.log(`${m.role}: ${text}`);
}

rmSync(root, { recursive: true, force: true });
console.log("\ntemp dir removed:", !existsSync(root));
```

**运行命令：**

PowerShell：

```powershell
node "$env:TEMP\pi-task08-run.mts"
Remove-Item "$env:TEMP\pi-task08-run.mts"
```

bash：

```bash
node "${TMPDIR:-/tmp}/pi-task08-run.mts"
rm "${TMPDIR:-/tmp}/pi-task08-run.mts"
```

**预期输出（真实运行结果）：**

```text
== 1. JSONL file lines (one per entry) ==
header version=3
A type=message parent=null A
B type=message parent=A B
C type=message parent=B C
D type=message parent=B D

== 2. Reopened: leaf and active path (getBranch) ==
leaf = D
getBranch = A -> B -> D
getEntries = A, B, C, D

== 3. Model context (buildSessionContext().messages) ==
user: A
assistant: B
user: D

temp dir removed: true
```

**观察：** 文件有四个条目，但活动路径只有 A、B、D。C 留在文件里，只是不在当前路径上。

### 实验 2：上下文编辑与分支摘要

**目的：** 观察 `appendContextEdit` 和 `branchWithSummary` 怎样改变模型输入，而不改变原始条目。

**步骤：**

1. 把下面脚本保存为临时文件 `pi-task08-run2.mts`，改好 `import` 路径，然后运行。
2. 运行后删除脚本文件。

这个脚本只用内存会话，不写文件。

```ts
import { SessionManager } from "file:///D:/Github/pi/packages/coding-agent/src/core/session-manager.ts";

const user = (text: string) => ({ role: "user", content: text, timestamp: Date.now() });
const assistant = (text: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "faux",
	provider: "faux",
	model: "faux-1",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: Date.now(),
});

const s = SessionManager.inMemory(process.cwd());
const labels = new Map<string, string>();
const name = (id: string | null) => (id === null ? "null" : (labels.get(id) ?? id));
const text = (m: { content?: unknown; summary?: string }): string => {
	if (m.summary !== undefined) return `[summary] ${m.summary}`;
	return typeof m.content === "string" ? m.content : (m.content as Array<{ text?: string }>).map((p) => p.text ?? "").join("");
};
const show = (title: string) => {
	console.log(`== ${title} ==`);
	console.log("leaf =", name(s.getLeafId()));
	console.log("getEntries =", s.getEntries().map((e) => `${name(e.id)}(${e.type})`).join(", "));
	console.log("getBranch =", s.getBranch().map((e) => `${name(e.id)}(${e.type})`).join(" -> "));
	for (const m of s.buildSessionContext().messages) {
		console.log(`  model ${m.role}: ${text(m).slice(0, 60)}`);
	}
};

const a = s.appendMessage(user("A") as never); labels.set(a, "A");
const b = s.appendMessage(assistant("B") as never); labels.set(b, "B");
const c = s.appendMessage(user("C") as never); labels.set(c, "C");

s.appendContextEdit(c, null);
const edit = s.getLeafId(); if (edit) labels.set(edit, "E(edit C=null)");
show("1. after context_edit(C, null) on active branch");

const sum = s.branchWithSummary(b, "summary of abandoned C");
labels.set(sum, "S");
show("2. after branchWithSummary(B, ...)");

try {
	s.appendContextEdit(c, null);
} catch (err) {
	console.log("3. appendContextEdit(C) on the new branch throws:", (err as Error).message);
}
```

**预期输出（真实运行结果；`Entry` 后的 ID 每次运行不同）：**

```text
== 1. after context_edit(C, null) on active branch ==
leaf = E(edit C=null)
getEntries = A(message), B(message), C(message), E(edit C=null)(context_edit)
getBranch = A(message) -> B(message) -> C(message) -> E(edit C=null)(context_edit)
  model user: A
  model assistant: B
== 2. after branchWithSummary(B, ...) ==
leaf = S
getEntries = A(message), B(message), C(message), E(edit C=null)(context_edit), S(branch_summary)
getBranch = A(message) -> B(message) -> S(branch_summary)
  model user: A
  model assistant: B
  model branchSummary: [summary] summary of abandoned C
3. appendContextEdit(C) on the new branch throws: Entry 32517ede is not on the active branch
```

**观察：**

- 第一步：C 仍在 `getEntries()` 和 `getBranch()` 里，但模型输入中没有 C。`context_edit` 只改投影，不改原条目。
- 第二步：叶子移到 B，然后追加的 `branch_summary` 挂在 B 下。模型输入多了一条 `branchSummary` 消息。C 和编辑条目都不在新的活动路径上。
- 第三步：C 已不在活动分支上，所以 `appendContextEdit(C, ...)` 抛错。编辑只能指向活动分支上的条目。

### 实验 3：坏行容错

**目的：** 验证一个损坏的文件仍能读出有效条目，并且新追加的内容不会和坏行粘在一起。

**步骤：** 把下面脚本保存为 `pi-task08-run3.mts`，改好 `import` 路径，运行，然后删除。脚本只在临时目录中写文件。

```ts
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, loadEntriesFromFile } from "file:///D:/Github/pi/packages/coding-agent/src/core/session-manager.ts";

const user = (text: string) => ({ role: "user", content: text, timestamp: Date.now() });
const root = mkdtempSync(join(tmpdir(), "pi-task08-corrupt-"));

const s = SessionManager.create(join(root, "project"), join(root, "sessions"));
const a = s.appendMessage(user("A") as never);
const b = s.appendMessage(user("B") as never);
const file = s.getSessionFile();
if (!file) throw new Error("no file");

// Simulate damage: one garbage line, then a half-written line with no trailing newline.
appendFileSync(file, "this is not json\n");
appendFileSync(file, '{"type":"message","id":"x');

const loaded = loadEntriesFromFile(file);
console.log("entries read (header + valid entries):", loaded.length);

const r = SessionManager.open(file);
const label = (id: string) => (id === a ? "A" : id === b ? "B" : id);
console.log("reopened getBranch:", r.getBranch().map((e) => label(e.id)).join(" -> "));

r.appendMessage(user("C") as never);
console.log("after appending C, entries read:", loadEntriesFromFile(file).length);

rmSync(root, { recursive: true, force: true });
```

**预期输出（真实运行结果）：**

```text
entries read (header + valid entries): 3
reopened getBranch: A -> B
after appending C, entries read: 4
```

**观察：** 两行坏数据被跳过。追加 C 之后读到 4 条（会话头加 A、B、C），说明半行被换行符隔开，没有影响新行。

### 实验 4：打印分支树

**目的：** 看到 `getTree()` 返回的树结构。`/tree` 界面显示的就是这种结构。

**步骤：** 把下面脚本保存为 `pi-task08-run4.mts`，改好 `import` 路径，运行，然后删除。脚本只用内存会话。

```ts
import { SessionManager } from "file:///D:/Github/pi/packages/coding-agent/src/core/session-manager.ts";

const user = (text: string) => ({ role: "user", content: text, timestamp: Date.now() });
const assistant = (text: string) => ({
	role: "assistant",
	content: [{ type: "text", text }],
	api: "faux",
	provider: "faux",
	model: "faux-1",
	usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	stopReason: "stop",
	timestamp: Date.now(),
});

const s = SessionManager.inMemory(process.cwd());
const labels = new Map<string, string>();
const a = s.appendMessage(user("A") as never); labels.set(a, "A");
const b = s.appendMessage(assistant("B") as never); labels.set(b, "B");
const c = s.appendMessage(user("C") as never); labels.set(c, "C");
s.branch(b);
const d = s.appendMessage(user("D") as never); labels.set(d, "D");

const print = (node: ReturnType<SessionManager["getTree"]>[number], depth: number): void => {
	const mark = node.entry.id === s.getLeafId() ? "  <- leaf" : "";
	console.log(`${"  ".repeat(depth)}${labels.get(node.entry.id) ?? node.entry.id}${mark}`);
	for (const child of node.children) print(child, depth + 1);
};
for (const root of s.getTree()) print(root, 0);
```

**预期输出（真实运行结果）：**

```text
A
  B
    C
    D  <- leaf
```

**观察：** `getTree()` 返回整棵树，包括未激活的 C。B 有两个孩子，C 排在 D 前面，因为子节点按时间戳排序，C 先写入。“leaf” 标记是打印脚本加上的，`getTree()` 本身不标记叶子。

## 自测题

1. 文件里有 A、B、C、D 四行，叶子在 D，`parentId` 分别为 `null`、A、B、B。`getBranch()` 返回哪些条目？`getEntries()` 呢？
2. 为什么 `branch(id)` 不需要改写文件？请用“叶子”和“追加”两个词解释。
3. 为什么 `buildSessionContext().messages` 不能直接用 `getEntries()` 替代？请至少举出两种差异。
4. `appendContextEdit(C, null)` 在叶子为 D（C 不在活动分支）时会怎样？为什么？
5. 打开一个文件时，叶子默认是哪一行？如果你想停在 B 上，应该调用什么方法？

### 参考答案

1. `getBranch()` 返回 A、B、D（沿 D 的父链回到根，再反转）。`getEntries()` 返回 A、B、C、D 四个条目，顺序为文件顺序。
2. 叶子只是一个指针，`branch` 只改这个指针；之后的 `appendMessage` 会以新叶子为父节点写入新行。旧条目保持原样，所以不需要重写。
3. `getEntries()` 包含全部条目，包括不在活动路径上的分支、`context_edit`、`label`、`session_info` 等非消息条目。`buildSessionContext()` 只取活动路径，应用压缩折叠和编辑，并且只把能产生消息的条目翻译成消息。
4. 抛出 `Entry <id> is not on the active branch`。`appendContextEdit` 要求目标在当前活动分支上，否则拒绝写入。先 `branch` 到包含 C 的分支，再调用。
5. 文件的最后一行（即最后追加的条目）。要停在 B 上，调用 `branch(bId)`。

## 常见错误

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 文件里有某条消息，但模型下一轮没有看到 | 该条目不在活动路径上（叶子在别的分支） | 用 `getBranch()` 看活动路径；需要模型视图用 `buildSessionContext().messages` |
| 手改 JSONL 删掉一行后，历史“少了一截” | 被删行是某些条目的父节点，子条目的 `parentId` 悬空；`getBranch()` 在断点处停止 | 不要手改；需要修复时从备份恢复 |
| `appendContextEdit` 抛出 `is not on the active branch` | 目标条目不在当前叶子的祖先链上 | 先 `branch(目标所在分支的某条目)`，再调用 |
| 调用 `setLeaf` 或 `appendBashMessage` 报 `is not a function` | 这两个方法不存在。切换叶子用 `branch(id)`，回到开头用 `resetLeaf()`；bash 执行结果也是普通消息，用 `appendMessage` 写入 | 按上面的方法替换 |
| 打开文件报 `Session file is not a valid ... session` | 文件非空，但没有有效的会话头；pi 拒绝修改它 | 检查文件是否为 pi 会话；不要用编辑器覆盖它 |

## 选读：源码深入（可选，跳过不影响主线）

以下内容超出主线。字段表和版本史以 `session-manager.ts` 的源码为准，`docs/session-format.md` 作为辅助参考。

### A. 会话头字段

`SessionHeader`（文件第一行）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `type` | `"session"` | 固定值 |
| `version` | number | 格式版本，当前为 `CURRENT_SESSION_VERSION`（值为 3） |
| `id` | string | 会话 ID；通过 `assertValidSessionId` 检查（字母数字、`.`、`_`、`-`） |
| `timestamp` | string | 创建时间，ISO 格式 |
| `cwd` | string | 会话所属的工作目录 |
| `parentSession` | string? | 血缘：分支或分叉产生的新文件记录源文件路径 |

### B. 条目类型与载荷

所有条目都有 `type`、`id`、`parentId`、`timestamp`（ISO 字符串）。下表列出 `append*` 方法写入的载荷字段（以源码签名为准）。

| 类型 | 写入方法 | 载荷字段 | 是否产生模型消息 |
| --- | --- | --- | --- |
| `message` | `appendMessage` | `message` | 是（user、assistant、toolResult 等） |
| `thinking_level_change` | `appendThinkingLevelChange` | `thinkingLevel` | 否（参与设置提取） |
| `model_change` | `appendModelChange` | `provider`、`modelId` | 否（参与设置提取） |
| `usage` | `appendUsage` | `kind`、`provider`、`model`、`usage`、`note?` | 否 |
| `compaction` | `appendCompaction` | `summary`、`firstKeptEntryId`、`tokensBefore`、`details?`、`usage?`、`fromHook?`、`systemMessage?` | 是（摘要，以及可选的系统检查点） |
| `custom` | `appendCustomEntry` | `customType`、`data?` | 否（扩展私有数据） |
| `custom_message` | `appendCustomMessageEntry` | `customType`、`content`、`display`、`details?` | 是 |
| `session_info` | `appendSessionInfo` | `name`（换行被替换为空格，首尾去空白） | 否 |
| `label` | `appendLabelChange` | `targetId`、`label?`（缺省表示清除） | 否 |
| `context_edit` | `appendContextEdit` | `targetId`、`replacement`（`null` 表示省略） | 否（改变投影） |
| `branch_summary` | `branchWithSummary` | `summary`、`fromId`、`details?`、`usage?`、`fromHook?` | 是（`branchSummary` 消息） |

`appendCompaction` 的 `firstKeptEntryId` 传 `null` 时，写入的值是条目自己的 ID（表示“不保留旧条目”）。

### C. 版本历史

版本号记录在会话头的 `version` 字段中。

| 版本 | 变化 | 源码 |
| --- | --- | --- |
| v1 | 线性条目序列，没有 `id` 和 `parentId` | 早期格式 |
| v2 | 增加 `id` 与 `parentId`，形成树；压缩条目的 `firstKeptEntryIndex` 改为 `firstKeptEntryId` | `migrateV1ToV2` |
| v3 | 消息角色 `hookMessage` 改名为 `custom` | `migrateV2ToV3` |

旧文件在加载时自动迁移（`migrateToCurrentVersion`）。迁移发生后，`_loadEntries` 会把结果写回文件。

### D. 两种时间戳

- 条目的 `timestamp` 是 ISO 字符串（例如 `2026-...Z`）。
- 消息内部的 `message.timestamp` 是 Unix 毫秒数。

读文件时不要把两者混用。`appendCompaction` 在写入时同时生成两种形式。

### E. 文件位置

默认会话目录由 `getDefaultSessionDir(cwd)` 决定，路径由 `getDefaultSessionDirPath` 生成：工作目录的路径去掉开头分隔符，再把 `/`、`\`、`:` 替换为 `-`，放在 `--...--` 形式的子目录中。因此同一个项目的会话总在同一个文件夹里。

### F. 惰性建文件

`_persist` 只在会话中出现第一条用户或助手消息时才创建文件（`_hasConversation`）。原因有两个：

1. 只打开又关闭、没有说话的会话，不应留下空文件。
2. 边界选在用户消息而不是助手回复。这样即使第一轮没有完成就退出，磁盘上也保留了用户的提问。源码注释引用了 issue #10000。

首次写入时，`_persist` 以 `wx` 模式创建文件（已存在则报错，防止覆盖），并一次性写入此前积累的全部条目（包括模型设置等）。之后的写入只追加一行。

### G. 写入的几个边界

- `_appendEntry` 的四步（推入数组、更新索引、移动叶子、落盘）没有回滚。如果 `_persist` 抛错（例如磁盘满），内存状态已变，但磁盘没有写入。
- `_rewriteFile` 用 `"w"` 模式覆盖整个文件，不是原子写入。它只用于迁移、初始化空文件、分支导出等低频场景。
- `getChildren(parentId)` 线性扫描全部条目，没有反向索引。
- `buildSessionPath` 沿父链回溯时没有 visited 集合。如果手改文件造成环（A 的父是 B，B 的父是 A），循环不会结束。正常追加不会产生环。

### H. 标签（label）如何参与分支导出

`label` 也是树中的条目，它的 `targetId` 指向被标记的条目。`createBranchedSession(leafId)` 导出路径时：

1. 去掉路径上的 label 条目，并把后续条目的 `parentId` 重连到前一个非 label 条目，避免孤儿子树。
2. 压缩条目的 `firstKeptEntryId` 如果指向被去掉的 label，改为指向 label 之后的第一个保留条目。
3. 在导出文件末尾重新生成 label 条目（新 ID，原时间戳），只保留目标仍在路径上的标签。

`createBranchedSession` 只导出一条路径，不同于 `SessionManager.forkFrom`。`forkFrom` 复制整个源文件（所有条目），并把 `cwd` 改为目标目录，用于跨项目分叉。两者名字相近，用途不同。

### I. 投影函数的细节

- `buildContextEntries`：只认活动路径上最新的压缩。它之前的条目被丢弃；从 `firstKeptEntryId` 开始的条目保留（跳过保留区间里的 `system` 消息，因为压缩条目自带系统检查点）；压缩之后的条目原样保留。若 `firstKeptEntryId` 不在路径上，前面的条目全部丢弃。
- `buildSessionProjection`：`context_edit` 收集在折叠后的条目里，同一目标的多条编辑以最后一条为准。旧压缩条目（位置不是 0）不产生消息。
- `sessionEntryToContextMessages`：对 `content` 为 `null` 的旧文件做兜底，system 消息变为空字符串，user、assistant、toolResult 变为空数组。
- `getSessionContextSettings`：沿完整路径取最后一次 `thinking_level_change` 和 `model_change`；助手消息中记录的实际模型覆盖 `model_change`。

### J. 已知的过时注释

`session-manager.ts` 中 `appendMessage` 的注释提到 `appendBranchSummary()`，但源码中没有这个方法。分支摘要的实际入口是 `branchWithSummary`。

## 下一篇

下一步讲上下文构造与压缩：压缩摘要怎样生成、何时触发，以及 `firstKeptEntryId` 怎样决定保留哪些消息。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| JSONL | 每行一个 JSON 对象的文本格式 | 核心概念 1 |
| 条目（entry） | 会话文件中的一行记录，有 `id` 和 `parentId` | 核心概念 1 |
| parentId | 指向父条目的 ID；根为 `null` | 核心概念 2 |
| 树（tree） | 每个节点只有一个父节点的结构，会话里的分支形成树 | 核心概念 2 |
| 叶子（leaf） | 当前所在的条目，新条目以它为父节点 | 核心概念 3 |
| 活动分支（active branch） | 从根到叶子的路径 | 核心概念 4 |
| 投影（projection） | 把活动分支算成模型消息的过程 | 核心概念 5 |
| 压缩（compaction） | 用摘要代替较早消息的条目类型 | 核心概念 5 |
| 上下文编辑（context edit） | 追加的规则，改变某条目在模型输入中的内容或去掉它 | 核心概念 5 |
| firstKeptEntryId | 压缩之后保留区间的起点条目 ID | 核心概念 5 |
| 分支摘要（branch summary） | 离开某分支时追加的摘要条目 | 分支操作 |
| SessionManager | 会话文件的对象化句柄，保存叶子、索引和文件路径 | 核心概念 6 |
| 惰性建文件 | 会话在出现第一条用户或助手消息之前不写文件 | 选读：惰性建文件 |
