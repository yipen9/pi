# D24：真实 issue 的源码改动演练

> 本篇用仓库已有的 issue #9631 测试与历史实现提交，演示怎样从行为契约走到真实源码改动，再判断回归测试覆盖了什么。
>
> 历史提交 `f5c946480` 是增加模型图片输入限制的功能提交，提交信息为 `feat(ai,coding-agent): add image input limits (closes #9631)`；当前 checkout 已包含该实现。本篇不重放提交、不修改测试。当前源码与测试引用来自基线 `200387122ca450d6387f033949423114a270b96c`；本轮未执行测试。
>
> 前置：第 8、13、18、19、20、21 章和 D21 faux harness。

## 0. 练习目标

读完后，你应该能：

1. 从一个测试标题抽出可观察契约；
2. 解释测试中的闭包、可选类型收窄和 mock；
3. 顺着 `session.prompt` → extension hook → 当前 model → image process → history 的路径定位行为；
4. 说出测试能证明什么、不证明什么；
5. 改一个相邻行为时选择正确测试层并遵守仓库质量门。

本例的关键时序是：

```text
session 最初选中 wide 模型
  → before_agent_start 扩展选择 strict 模型
  → 当前模型带有图片 resize 限制
  → 本次 prompt 的图片归一化使用 strict 模型限制
  → 处理后的图片进入 session history
```

## 1. 先读测试，而不是从大文件开头读

测试位于：

```text
packages/coding-agent/test/suite/agent-session-prompt.test.ts
```

关注测试名：

```typescript
it("uses the model selected by before_agent_start for image normalization", async () => {
```

把句子改写成契约：

> `before_agent_start` 改变当前模型后，同一个 prompt 的图片处理必须采用新选模型的 input limits。

这句话里至少有四个要核实的点：

- hook 的修改是否已经提交到 session/Agent 当前 model；
- 图片归一化在 hook 前还是 hook 后；
- resize 配置究竟从哪个 model 读取；
- 是否不仅调用了 processor，还把处理结果写进 user message。

测试名是索引，不是实现说明。后面的 setup 和 assertions 才把契约具体化。

## 2. 拆解测试 setup

缩小后的核心代码：

```typescript
let strictModel: Model<string> | undefined;
const harness = await createHarness({
  models: [{ id: "wide" }, { id: "strict" }],
  extensionFactories: [
    (pi) => {
      pi.on("before_agent_start", async () => {
        if (!strictModel) throw new Error("Expected strict model");
        await pi.setModel(strictModel);
      });
    },
  ],
});
```

### 2.1 `Model<string> | undefined` 的读法

```typescript
let strictModel: Model<string> | undefined;
```

- `Model<string>`：某个 API/provider 的模型描述；这里 `string` 表示 api 名类型比较宽；
- `| undefined`：变量初始化时还没有模型对象；
- `let`：之后会给变量赋值。

扩展 factory 创建时，模型还需要通过 harness 的 getter 获得。hook 执行时再读取这个闭包变量，所以代码用显式检查来把 `undefined` 分支转成可诊断失败：

```typescript
if (!strictModel) throw new Error("Expected strict model");
await pi.setModel(strictModel);
```

检查之后，TypeScript 能把 `strictModel` 收窄为 `Model<string>`。这比 `strictModel!` 非空断言更可靠：前者在运行时真的检测，后者只是告诉编译器“相信我”。

### 2.2 为什么 hook 读到闭包变量

`extensionFactories` 中的箭头函数捕获了外层 `strictModel` 变量。随后测试执行：

```typescript
strictModel = harness.getModel("strict");
```

当 `session.prompt()` 发出 hook 时，闭包读取的是变量当前值，而不是 factory 创建时的 `undefined` 快照。

时间线：

```text
t0: 声明 strictModel = undefined
t1: createHarness 保存 factory
t2: strictModel = getModel("strict")
t3: session.prompt -> 运行 factory/hook
t4: hook 读取当前 strictModel
```

如果工厂在 `t1` 就执行 hook，检查会失败；实际 hook 是 prompt 生命周期事件，因此这个 setup 有意把引用先存起来、后填入。

### 2.3 `await pi.setModel(...)` 为什么不是装饰

hook 声明为 `async`，并 `await` 模型切换操作。这表达了后续逻辑必须等设置完成。若不等待，代码可能在 setter 完成前就开始图片处理或继续 prompt 流程。

TypeScript 的 `async` 函数总返回 Promise。`await` 会暂停当前 async 函数，等 Promise settle 后再继续；它不会阻塞整个 Node 事件循环。

## 3. harness 提供的观测面

测试创建两个模型：

```typescript
models: [{ id: "wide" }, { id: "strict" }]
```

随后通过 harness 拿到严格模型并添加 input limit：

```typescript
strictModel = harness.getModel("strict");
if (!strictModel) throw new Error("Expected strict model");
const resizeOptions = { maxWidth: 1000, maxHeight: 1000, maxBytes: 500000, jpegQuality: 70 };
strictModel.inputLimits = { images: { resize: resizeOptions } };
```

这种测试安排把两个变量隔开：

- 初始模型 `wide` 没有这个 resize 配置；
- hook 选择的 `strict` 明确带配置。

若生产代码错误地在 hook 前读取 model limit，`processImage` 会收到 `undefined`；若读当前 model，spy 会观察到 `resizeOptions`。

【陷阱】测试动态给 fake model 写 `inputLimits`，这是 harness 允许的 test setup，不代表所有生产 model 都在运行时可任意变更。新增代码仍需遵守 `Model` 类型和 provider registry 的所有权。

## 4. Faux 响应与图片处理 mock 各自替换什么

### 4.1 faux 让模型回答固定结果

```typescript
harness.setResponses([fauxAssistantMessage("done")]);
```

这保证 agent/session 流程不调用真实模型。faux 不是本例的图片处理器；它只替换最外层 provider response。

### 4.2 spy/mock 隔离图片处理实现

测试文件顶部使用 `vi.mock` 替换 `processImage`，mock 版本返回固定数据：

```typescript
const processImage = vi.hoisted(() =>
  vi.fn(async (_bytes: Uint8Array, mimeType: string) => ({
    ok: true as const,
    data: Buffer.from("normalized").toString("base64"),
    mimeType,
    hints: [],
  })),
);
```

本例不验证图像缩放算法本身。它验证 AgentSession 调用 processor 时给了正确配置，以及 processor 返回的图片被接进 history。

类型细节：

- `vi.fn(...)` 创建可观察调用记录的 mock function；
- `async` 令结果为 Promise；
- `as const` 把 `ok: true` 保留为字面量类型，便于匹配结果联合类型中的成功分支；
- `_bytes` 里的下划线惯例表示参数在 mock 中不使用。

这个 mock 边界很清楚：图片 processor 的真实实现有单独责任，session 的调度参数和消息组装由本测试负责。

## 5. assertions：分开检查选择、调用和持久化结果

### 5.1 当前 session model

```typescript
expect(harness.session.model?.id).toBe("strict");
```

`?.` 是可选链：model 存在时读 `id`，不存在时表达式为 `undefined`。断言确保 hook 真的改变当前 model。

它单独还不够：model 选对了，不代表图片代码用了它。

### 5.2 processor 收到的 options

```typescript
expect(processImage).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", {
  autoResizeImages: true,
  resizeOptions,
});
```

该断言检查调用参数：

- 图片数据先转为 `Uint8Array`；
- mime type 仍为 `image/png`；
- 设置层的自动 resize 值为 true；
- model 的 `inputLimits.images.resize` 成为 resize options。

这比只断言“mock 被调用一次”强，因为它钉住本例要修复的配置来源。

### 5.3 归一化输出进入 session history

```typescript
const userMessage = harness.session.messages.find((message) => message.role === "user");
expect(userMessage?.content).toContainEqual({
  type: "image",
  data: Buffer.from("normalized").toString("base64"),
  mimeType: "image/png",
});
```

这个断言证明处理结果并未只被计算，而是作为 image block 写进用户消息。它覆盖了从 processor 返回值到 transcript 的连接。

因此测试从三面夹住行为：

```text
最终选择 strict model
       ↓
processor 调用拿到 strict model 的配置
       ↓
规范化输出成为 session user message 的图片
```

## 6. 从测试反向追源码

现在开始读实现，不必从 `agent-session.ts` 第一行顺序读到底。

### 6.1 找 prompt 生命周期的 hook 发射点

在 `AgentSession.prompt` 中找到：

```typescript
const result = await this._extensionRunner.emitBeforeAgentStart(
  expandedText,
  currentImages,
  this._baseSystemPromptOptions,
);
```

这一步把扩展 hook 放在用户输入完成预处理之后、Agent 正常接收本次消息之前。应继续追 `emitBeforeAgentStart`，确定 handler 是否按顺序运行以及 `pi.setModel` 是否等到实际完成。

### 6.2 观察 hook 与 image normalization 的先后

生产代码中的注释直接记录了设计理由：

```typescript
// Emit before_agent_start before normalizing images so extension-driven model
// selection determines the resize profile used for the request and history.
```

接下来是：

```typescript
const normalized = await this._normalizePromptImages(currentImages);
```

顺序是关键。若改成先 normalize 再发 hook，resize 会基于旧 model；之后即使当前模型变成 strict，已经处理的 image 也不会自动重做。

### 6.3 `_normalizePromptImages` 如何取限制

方法对每个输入 image：

1. base64 解码为 `Buffer`；
2. 调 `processImage`；
3. 从 SettingsManager 读取全局 `autoResizeImages`；
4. 从 `this._limitsModel()?.inputLimits?.images?.resize` 取当前限制；
5. 失败时记录 hint 并跳过该图片；成功时创建新的规范化 `ImageContent`；
6. 汇总 images 与 hints 返回调用者。

`?.` 链让“当前没有可用于限制判断的 model”自然得到 `undefined`，processor 按自己的参数约定处理缺省值。不要把这个可选链简化成强制非空断言，除非能证明整个调用路径有更强不变量。

### 6.4 规范化结果如何进入 user message

`prompt` 收到 `normalized` 后生成 user text（若有 hint 会附加提示），构造 `userContent`，先加入 text，再追加规范化图片，最后 push 到 messages。

再继续沿 session message 保存路径读，才能说明测试观察的是哪种投影。此处的 `session.messages` 是 AgentSession 面向当前上下文的消息视图；若要证明磁盘持久化细节，还需要额外检查 SessionManager entries。

## 7. 旧实现会如何失败

一个可能的缺陷形态：

```text
prompt() 进入
→ 先用 this.model 读 resize options
→ 图片以 wide 模型配置 normalize
→ 再 emit before_agent_start
→ hook 设置 strict
→ 发模型请求
```

此时 test assertions 的结果：

- `session.model.id === "strict"`：可能通过；
- processor 收到 strict resize options：失败，参数是旧配置或 undefined；
- 规范化图片进入 history：可能仍通过，因为 mock 无论如何都返回 normalized。

这解释了为什么只看最终模型和最终消息还不够：若 processor mock 忽略 options，就需要 spy 参数断言来证明 resize profile 来源正确。

另一个错误实现可能在 hook 后仍读取一个之前缓存的 `modelForPrompt` 局部变量。于是事件顺序看似正确，实际参数仍 stale。追代码时同时检查“调用先后”和“读取哪个可变对象”。

## 8. 历史补丁：把测试契约落实为源码变化

使用只读命令查看当时的提交，不切换工作树：

```bash
git show --format=fuller f5c946480 -- packages/coding-agent/src/core/agent-session.ts packages/coding-agent/test/suite/agent-session-prompt.test.ts
```

提交前，prompt 路径先建 user message，并把未经归一化的输入图像放进去；之后才调用 `emitBeforeAgentStart(...)`。新提交引入 `_normalizePromptImages(...)`，并把顺序改为：

```text
原来：构造 user message（带原始 images）→ before_agent_start → 运行 Agent
改后：before_agent_start（扩展可换 model）→ 按当前 model limits 归一化图片
    → 构造 user message（带归一化 images）→ 运行 Agent
```

关键不是“把一段代码搬到另一处”，而是建立新的数据依赖：

```typescript
const result = await this._extensionRunner.emitBeforeAgentStart(...);
const normalized = await this._normalizePromptImages(currentImages);
const userText = normalized.hints.length > 0
  ? `${expandedText}\n\n${normalized.hints.join("\n")}`
  : expandedText;

messages = [];
const userContent: (TextContent | ImageContent)[] = [{ type: "text", text: userText }];
userContent.push(...normalized.images);
messages.push({ role: "user", content: userContent, timestamp: Date.now() });
```

逐行看这个补丁：

1. 先 `await` hook，保证异步 `pi.setModel(...)` 完成后才继续；
2. 再调用归一化方法，使它读取到 hook 更新后的 model input limits；
3. processor 返回 hints 时，把提示并入 user text；失败图片不会进入 `normalized.images`；
4. 最后才创建 user message，所以发给 Agent 的内容与会话记录使用同一批归一化图片。

测试也在同一个提交里增加：`wide` 初始模型不带 resize 限制，hook 切到带限制的 `strict`；spy 检查 `processImage` 确实收到该 `resizeOptions`；再检查规范化输出出现在 session 的 user message。它同时防住“模型切换成功但处理器仍用旧 profile”和“处理结果没有接入消息”两类断裂。

【读历史的陷阱】提交标题是 feature，不是声称旧代码已经有完整图片限制功能、后来只修了一个 bug。这里借它学习的是一个真实 issue 驱动的实现过程：类型/模型能力、处理函数、调用时机、工具结果路径和回归测试一起变化。历史 diff 说明变更范围；当前 checkout 才是写新代码时的事实来源。

## 9. 测试证据分层

| 断言 | 能证明 | 不能单独证明 |
|---|---|---|
| `session.model?.id` | session 当前 model 是 strict | image normalizer 采用 strict 的限制 |
| `processImage` 参数匹配 | 调用传入了 resize options | 真实图像算法一定按这些 options 缩放 |
| session user content 含 mock 输出 | 调用结果进入消息 | 该消息已写到磁盘 session file |
| faux response 消耗完成 | 请求用固定结果正常跑完 | 某个线上 provider 接受该 transcript |

一个集成测试覆盖多个边界是有价值的，但报告结论要受断言范围约束。

## 10. 用这个结构设计一个相邻用例

不要改现有 issue 回归测试的意图。可在练习分支中为相邻行为单独设计测试，例如：

> 图片处理失败时，不能把失败图片伪装成正常 image block；应产生可见 hint，并继续保持 user prompt 本身可处理。

写之前先检查当前 `processImage` union 和 `_normalizePromptImages` 实现，确认确切行为。不要把这句需求直接当作现状事实。

设计思路：

1. 用 `vi.mock` 让 processor 返回明确 failure branch；
2. 使用 faux 接收下一次 provider context；
3. 观察 user text 是否携带可诊断 hint；
4. 观察 failed image 是否未进入 content；
5. 断言整个 session 是正常回答、部分处理，还是按当前契约报错；
6. 先读代码、现有 tests 与 image processor docs，定下正确预期。

如果发现预期行为本身未定义，先提出一个清晰契约再实现，而不是依测试作者第一反应塑造行为。

## 11. TypeScript 初学者读测试的逐步方法

### 11.1 从测试声明看到真实类型

`createHarness` 接受 options，测试中 `models` 是精简模型配置；harness 返回 `session`、模型 getter 和 faux response control。IDE 转到类型定义比猜类型准确。

读每个表达式时问：

- 这里是值还是类型？
- Promise 是否被 `await`？
- union 哪个分支被 `if` 收窄？
- 对象属性是可选还是必有？
- mock 返回值是否仍符合 production function 的返回类型？

### 11.2 区分 `as const`、类型注解和断言

- `const x: Model<string> = ...` 是类型注解；
- `{ ok: true as const }` 把属性缩窄成 literal type；
- `x as SomeType` 是编译期断言，不会运行时验证。

测试里出现 `as` 不代表输入已经校验。若是外部数据，应找 runtime validator，而不是相信类型断言。

### 11.3 闭包和异步顺序

扩展 factory 把 hook 函数传给 runner；之后 prompt 才调用 hook。变量被 closure 捕获，异步事件发生的时间晚于定义时间。通过画 t0/t1/t2 能避免把“定义了 callback”当成“callback 当场运行”。

### 11.4 `find` 和 `?.`

```typescript
const user = messages.find((message) => message.role === "user");
```

`find` 可能找不到，类型通常包含 `undefined`。`user?.content` 不会在 user 缺失时崩溃，但测试断言也可能因 `undefined` 而失败。这比 `messages[1]!.content` 更明确表达“我在按角色找，而不是赌索引”。

## 12. 如果真的要修改这个行为

### 12.1 先确认目标不是已经满足

当前测试和实现已表达 hook 先于 normalize。不要仅因读到一个 issue 编号就假设本地代码尚未修复。先在当前 checkout 检查测试、实现、git history（只读）和工作树状态。

### 12.2 变更前的证据

在工作说明中记录：

```text
行为目标：
当前观察：
期望观察：
责任函数：
测试 owner：
已确认不改的边界：
```

读完准备修改的完整源码文件与测试文件，尤其是 `AgentSession.prompt` 与 `_normalizePromptImages` 的邻近逻辑。这个文件很大，按符号定位后仍要读完相关函数及其上下游。

### 12.3 写出区分新旧行为的测试

测试要能回答：如果把正确实现换回有缺陷版本，哪个 assertion 会失败？

在本例中，关键区分断言是 processor 收到 `resizeOptions`；只断言 model id 或 processImage called 都不足以区分旧行为。

### 12.4 选择最小 owner

如果问题是 normalize 时取错 model limits，通常责任在 AgentSession 提取 resize options 的时机/来源，不在：

- `processImage` 算法内部；
- provider adapter；
- TUI；
- Agent loop。

如果问题其实是图像压缩参数被忽略，则应转读 `image-process.ts`，并给该模块添加算法级测试。判断 owner 由失败 assertion 的输入输出契约决定。

### 12.5 按项目规则验证

若实际修改代码：

1. 修改测试文件后必须执行该测试；
2. 按 `AGENTS.md` 在 coding-agent package root 用 Vitest CLI 跑单个测试文件；
3. 再运行 `npm run check`，阅读完整输出；
4. 不运行 `npm run build` 或 `npm test`，除非用户明确要求；
5. 如果是修复 GitHub issue 的回归测试，在测试附近按仓库规则加 issue 注释；
6. 检查 `git status`，不暂存、不提交，除非用户要求。

这份学习手册不替读者执行这些命令。本篇引用的是存在的测试源码，不是本轮运行证据。

## 13. 评审练习：找出测试可能留下的空白

以 #9631 现有测试为基础，逐项判断是否需要另一个 case：

1. hook 选择 strict 后，图片 data 是否改变？mock 对固定输出只测试管线，不测算法。
2. 输入两张图时是否每张都使用相同 resize profile？当前测试只有一张。
3. 图片处理返回 failure 时，hint 和剩余图片怎样处理？当前测试只 mock success。
4. hook 没改 model 时，使用默认 model 限制吗？需读 `_limitsModel` 语义后决定。
5. hook 抛错时，processor 是否应该完全不调用？需读 extension error policy。
6. prompt 中断/取消会不会中止 processor？processor 的 signal 支持要单独查。
7. 规范化图片是否只是当前模型输入，还是持久化 message 本身也使用归一化内容？沿 SessionManager 写路径验证。

不是所有空白都必须补进这个测试文件。每个 case 要对应一个具体契约和回归风险；不能为了表格全勾而制造无意义测试。

## 14. 可迁移的回归阅读模板

读任何测试，可以复制这个表：

| 问题 | 本例答案 |
|---|---|
| 测试名宣告什么行为？ | hook 选出的模型控制图片 normalization |
| 输入如何被控制？ | 两个 faux models，一个图片，faux response |
| 外部副作用如何隔离？ | `processImage` mock；无真实模型网络 |
| 哪一处模拟时间顺序？ | extension `before_agent_start` 在 prompt 中运行 |
| 最关键区分断言是什么？ | processor 收到 strict model resizeOptions |
| 结果如何观察？ | session 当前 model 和 user message content |
| 已知不覆盖什么？ | 真实 resize 算法、磁盘序列化、线上 provider 接受度 |
| 测试文件 owner？ | coding-agent suite；harness + faux |
| 若改实现需要跑什么？ | 目标 Vitest 测试 + `npm run check` |

这个模板可用于 issue 调查、扩展行为测试、provider reducer 测试和 TUI 组件测试；具体替身与断言应随 owner 改变。

## 15. 小结

本例最值得记住的是顺序和状态来源：`before_agent_start` 先更新当前模型，随后 `_normalizePromptImages` 再从当前 limits model 读取 resize 配置，处理结果进入本次 user message。

好的回归测试不会只说“跑完了”，而是分别观察状态已更新、关键依赖收到正确输入、结果通过公开消息面可见。它也明确不覆盖图像算法、磁盘保存和真实 provider 协议。

> D24 完。把这个读法用于自己的改动：先从观察断言反推契约，再由责任函数定位 owner，最后用失败测试和工程检查给出证据。
