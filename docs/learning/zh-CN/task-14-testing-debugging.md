# 14. 测试、调试与可评审改动

> 预计时间：2.5 小时
> 先修：Agent 循环（`packages/agent/src/agent-loop.ts`）与 `AgentSession`（`packages/coding-agent/src/core/agent-session.ts`）的基本用法；终端测试部分需要知道按键与渲染的基本概念

## 本篇你会学到

- 说出本仓库有哪些测试层，并为一个行为选出最低、够用的那一层。
- 用 faux（脚本化的假模型）和 harness（测试装配函数）写一条会失败的回归测试，并用单文件命令运行它。
- 把一个"pi 不工作"的现象缩小到一层，整理成一个可评审的小改动。

## 先用一个例子理解

假设有一个工具 `boom`，每次执行都抛出 `Error("boom failed")`。用户说："调用 boom，然后告诉我结果。"

正确行为应该是：

1. 模型请求调用 `boom`。
2. pi 执行 `boom`，它抛错。
3. pi 不能让整个会话中断。它要把错误包装成一条 `toolResult` 消息，标记 `isError: true`，放回对话。
4. 模型再被请求一次，看到这条错误，给出回答。

没有这套机制会怎样？工具异常直接冒到 `prompt()` 外面，会话中断，界面没有结果。

现在考虑一个更隐蔽的坏实现：它把错误吞掉，只留下一条空的工具结果。如果测试只断言"最后有一段回答"，这个坏实现也能通过，因为 faux 脚本本来就会给出回答。所以测试要同时断言四件事：

- `isError === true`；
- 结果文本包含 `boom failed`；
- `boom` 实际执行了 1 次；
- 模型被请求了 2 次。

只有这四条一起，才能区分"正确实现"和"吞错实现"。

### 一次吞错的坏实现会怎样跑

假设有人把工具的错误分支改成了"静默返回空结果"。逐步看会发生什么：

1. 模型请求调用 `boom`，第一条脚本生效。
2. `boom` 抛出 `boom failed`，坏实现捕获它，返回 `{ content: [] }`，没有设置 `isError`。
3. 循环把这条空结果写回会话，然后继续。
4. 第二条脚本返回 `The tool failed`，界面显示这句话，看起来一切正常。
5. 如果测试只断言"最后一条 assistant 消息有文字"，测试通过。
6. 如果测试同时断言 `isError`、错误文本、执行次数和脚本消耗数，第一个失败的断言会停下测试，并指出坏的地方。

所以"界面看起来正常"不是证据。测试要检查中间的 `toolResult`，不能只看最后一句回答。

## 核心概念

1. **测试层**：按"要验证的东西"划分的测试类别。越靠下的层越快、越确定；越靠上的层越接近真实系统，但越慢、越不稳定。
2. **harness**：测试装配函数 `createHarness`。它搭出真实的 `AgentSession`，但把模型换成 faux，把会话、设置和认证放在内存或临时目录里。
3. **faux provider**：脚本化的假模型。测试提前写好"第 1 次请求返回什么、第 2 次返回什么"，按顺序交给真实的 Agent 消费。
4. **区分力**：测试能否在坏实现上失败。一个坏实现也能通过的测试，等于没有测试。
5. **类型谓词**：返回类型写成 `value is X` 的函数。条件成立时，TypeScript 把类型收窄为 `X`，之后可以安全读取 `X` 的字段。
6. **最后一条正确事件**：排障方法。按顺序读事件流，找到最后一条确认出现的事件；它后面缺失的那一环，就是下一步要查的层。

### 三个对象怎么连起来

测试代码只和 `Harness` 打交道。`Harness` 内部的 `AgentSession` 是真实对象，只有模型一端被换成了假的：

```text
测试代码
  |  await createHarness(...)
  v
Harness
  |- session  ---> AgentSession（真实） ---> Agent 循环（真实）
  |                                              |  每次请求模型
  |- setResponses / appendResponses              v
  '----------------------------------------> faux provider（假模型）
                                             从队列取出下一条脚本
```

这样分工的原因：如果连 `AgentSession` 也换成假的，测试就只能证明假对象的行为，无法证明 pi 自己的逻辑是对的。换掉模型，是因为真模型输出不固定、要花钱、还需要密钥。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径（相对仓库根） | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/coding-agent/test/suite/README.md` | 五条规则 | 只允许 harness 与 faux；禁止真实 API、密钥和网络 |
| 2 | `packages/coding-agent/test/suite/harness.ts` | `HarnessOptions`、`Harness`、`createHarness`、`getToolResult` | 选项如何映射到真实对象；`cleanup()` 释放什么 |
| 3 | `packages/ai/src/providers/faux.ts` | `fauxText`、`fauxToolCall`、`fauxAssistantMessage`、`FauxResponseStep`、`FauxResponseFactory` | 脚本的形状；工厂函数在哪一刻被调用 |
| 4 | `packages/ai/src/compat.ts` | `registerFauxProvider` | 假 provider 注册到哪里；为什么必须注销 |
| 5 | `packages/coding-agent/src/core/agent-session.ts` | `AgentSession`、`prompt`、`retryAttempt`、`bindExtensions`、`ExtensionBindings` | 测试的入口与断言对象 |
| 6 | `packages/agent/src/agent-loop.ts` | 构造 `isError: true` 结果的分支（调用 `createErrorToolResult`） | 工具抛错如何变成结果；"Operation aborted" 来自哪里 |
| 7 | `packages/coding-agent/test/suite/agent-session-prompt.test.ts` | 各 `it` 用例 | 真实测试如何组织 `describe`、`afterEach` 和断言 |
| 8 | `vitest.base.ts` | `packages/*/src` 别名 | 测试跑的是源码，不是 `dist` 产物 |
| 9 | `test.sh` | 环境隔离，然后执行 `npm test` | 为什么全量非 e2e 测试只能从这里跑 |
| 10 | `package.json`（根） | `check` 脚本 | 代码改动后的质量门 |

读源码时用符号名定位，不要依赖行号。行号在版本更新后会变。

## 走读一次完整过程

下面以"工具抛错"测试为例，说明一次测试从开始到结束的每一步。

1. **装配**：测试调用 `await createHarness({ ... })`。
   函数：`createHarness`（`harness.ts`）。
   状态：创建临时目录、内存会话、内存设置，并注册 faux provider。返回 `Harness` 对象。

2. **写脚本**：测试调用 `harness.setResponses([...])`，放入两条脚本。
   函数：`setResponses`（由 faux provider 提供，`Harness` 把它暴露出来）。
   状态：待消费队列长度为 2，顺序固定。

3. **提交输入**：测试调用 `harness.session.prompt("call boom")`。
   函数：`AgentSession.prompt`（`agent-session.ts`）。
   状态：用户消息进入会话；Agent 开始一次运行。

4. **第一次模型请求**：Agent 向 faux 发出请求。faux 取出队首脚本（一条带 `toolCall` 且 `stopReason: "toolUse"` 的消息）。
   函数：faux 的流式实现（`faux.ts`）。
   状态：队列剩 1 条；请求计数加 1。

5. **执行工具并捕获错误**：Agent 找到 `boom`，执行它。`boom` 抛错。Agent 循环把错误转成结果。
   函数：`packages/agent/src/agent-loop.ts` 中构造 `isError: true` 结果的分支。
   状态：会话中新增一条 `toolResult`，`isError` 为 `true`。

6. **第二次模型请求**：Agent 再次请求模型。faux 取出第二条脚本，返回文字回答。
   状态：队列为空；请求计数为 2。

7. **断言**：测试用类型谓词找出 `toolResult`，然后检查错误标记、文本、执行次数和待消费队列。
   状态：测试通过或失败，结论只来自这四条断言。

8. **清理**：`afterEach` 调用 `harness.cleanup()`。
   函数：`cleanup`（`harness.ts`）。
   状态：释放会话，注销 faux provider，删除临时目录。

如果第 8 步被跳过，会发生什么？注册的假 provider 会留在全局注册表中。下一个测试可能拿到旧的脚本队列，结果取决于测试执行顺序。这类问题很难复现，所以每个 harness 都必须在 `afterEach` 中清理。

### 走读中的队列状态

下表把"工具抛错"测试的关键状态列出来。每一行都是一次观察点，方便你对照断言：

| 时刻 | 待消费脚本数 | 模型请求次数 | `boom` 执行次数 | 会话里最后一条消息 |
| --- | --- | --- | --- | --- |
| `setResponses` 之后 | 2 | 0 | 0 | 无 |
| 第一次模型请求返回之后 | 1 | 1 | 0 | 带 `toolCall` 的 assistant 消息 |
| 工具执行并抛错之后 | 1 | 1 | 1 | `toolResult`（`isError: true`） |
| 第二次模型请求返回之后 | 0 | 2 | 1 | assistant 文字回答 |

注意第三行：`boom` 已经执行，但模型还没有被再次请求。如果你在这一行停下来看日志，会误以为"工具结果没有被模型看到"；其实第二次请求还没发生，因为它要等工具结果写回之后才会发起。

## 测试分层

仓库有五类测试，下表逐一说明。其中第五类"行为评估"的统计方法不在本篇展开，本篇只做定位。

| 层 | 测什么 | 本仓库的位置 | 不适合验证什么 |
| --- | --- | --- | --- |
| 单元 | 纯函数、小模块（如按键解析） | 各包的 `test/` 目录，例如 `packages/tui/test/keys.test.ts` | 多个模块配合后的行为 |
| 会话集成（suite） | `AgentSession`、循环、工具调度，由 faux 驱动 | `packages/coding-agent/test/suite/` | 供应商的 HTTP 或 SSE 协议转换 |
| 交互 | 真终端里的按键、渲染、中文宽字符 | `.pi/skills/interactive-testing.md` 描述的 tmux 流程 | 需要大量时间，且结果依赖终端模拟 |
| 端到端（e2e） | 真模型、真供应商 | 由环境变量激活的测试 | 费用、凭据和模型随机性；本篇不运行 |
| 行为评估 | 任务成功率等统计指标 | `packages/evals` | 单次运行的确定性检查 |

选择原则：**能在低层测的，不要上高层。** 判断"工具抛错后循环是否继续"，用 suite 就够了。判断"中文在终端里是否错位"，才需要交互层。判断"某供应商真实返回的 JSON 是否被正确解析"，才需要 provider 适配器测试或 e2e。

### 决策表：一个行为该放在哪一层

| 要验证的行为 | 最低够用的层 | 本仓库中的例子 |
| --- | --- | --- |
| 一个按键字节序列被识别为某个按键名 | 单元 | `packages/tui/test/keys.test.ts`（纯函数，不需要会话） |
| 工具抛错后，循环把错误写回并再请求模型 | suite | `packages/coding-agent/test/suite/agent-session-prompt.test.ts` 的同类用例 |
| 扩展注册的工具出现在本轮可用工具里 | suite | 用 `HarnessOptions.extensionFactories` 注册，再断言 `getActiveToolNames()` |
| 修复某个 issue 后，旧错误不再出现 | suite 的回归目录 | `packages/coding-agent/test/suite/regressions/8935-parallel-preflight-abort.test.ts`，文件名以 issue 或 PR 号开头 |
| 中文宽字符在终端里的列宽计算 | 单元（再加交互确认） | `packages/tui/src/utils.ts` 的 `visibleWidth`，回归示例如 `packages/tui/test/regression-regional-indicator-width.test.ts` |
| 某供应商的 SSE 数据被切成小块后仍能解析 | 适配器测试 | `packages/ai/src/providers/` 下的供应商文件，使用受控分块 |
| 模型在一组任务上的成功率 | 评测 | `packages/evals` |

读这张表时注意一个规律：越往下，测试越难写、越慢、越依赖外部条件。遇到新需求，先从上往下找"能证明它的最低层"。

提交 `afda4d620` 同时修改了 `packages/agent/src/agent-loop.ts` 并加入 `regressions/8935-parallel-preflight-abort.test.ts`，它是"修改加回归测试放在同一提交"的实例。文件名中的 `8935` 与提交说明中的 `(#8936)` 不同；它们代表什么，未在本地验证，以提交说明或 issue 页面为准。

### 运行命令

| 范围 | 命令 | 说明 |
| --- | --- | --- |
| 单个 vitest 文件 | 在包根目录执行 `node "$repo/node_modules/vitest/dist/cli.js" --run <文件>` | `AGENTS.md` 规定的格式；`$repo` 为仓库根 |
| 单个 tui 文件 | 在 `packages/tui` 执行 `node --test <文件>` | tui 使用 Node 内置的 `node:test`，不是 vitest |
| 全部非 e2e 测试 | 在仓库根，于 Git Bash 或 WSL 中执行 `./test.sh` | 清空环境变量，隔离 HOME，设置 `LANG=C`、`TZ=UTC`，然后执行 `npm test` |
| 禁止 | 直接运行全量 vitest（如 `npx vitest`） | 会激活 e2e，可能产生费用 |

`./test.sh` 是 Bash 脚本，不能直接在 PowerShell 中运行。它会跑完整的非 e2e 套件，耗时较长。学习时先跑单个文件即可。

### 读懂单文件运行的摘要行

单文件运行结束时，vitest 输出几行摘要。以本地实测为例（三个用例的文件，其中一个故意失败）：

```text
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
   Start at  21:19:35
   Duration  8.86s (transform 3.50s, setup 0ms, import 8.55s, tests 116ms, environment 0ms)
```

- `Test Files` 统计文件，`Tests` 统计用例。一个文件里只要有一个用例失败，文件计数就变成 `failed`。
- `Start at` 和 `Duration` 每次都不同，不用关心。`tests` 那一段是测试本身的耗时，`transform`、`import` 是加载时间。
- 退出码也要看。本次失败时 shell 中 `$LASTEXITCODE` 为 `1`（Bash 中为 `$?`）。脚本或 CI 只看退出码，所以不能只看屏幕上的颜色或最后一行。
- `--run` 表示只跑一次然后退出。不加它时，vitest 的行为取决于终端环境（未在本地验证是否会进入监听模式），所以按 AGENTS.md 的写法始终带上 `--run`。

### 怎么读 `vitest.base.ts` 的 alias

`vitest.base.ts` 的 `alias` 数组里，每一条都是正则到源码入口的映射。例如 `^@earendil-works/chord$` 映射到 chord 包的源码入口。别名只覆盖数组里列出的包名，判断某个包是否走源码，要看 `alias` 数组本身，而不是猜。对于数组里列出的包，你改了源码，下一次运行就会生效。

### 为什么测试跑的是源码

根目录的 `vitest.base.ts` 配置了别名，把 `@earendil-works/*` 包名指向各包的 `src/` 目录（例如 chord、telemetry、mcp 都有这样的别名）。所以你修改源码后，测试立即使用新代码，不需要先构建。这也意味着：**不要为了让测试"看起来通过"而去构建 dist。**

### 为什么不能直接跑全量 vitest

`AGENTS.md` 的原话：

```text
Never run the full vitest suite directly: it includes e2e tests that activate when endpoint/auth
env vars are present. For all non-e2e tests, run ./test.sh from the repo root.
```

e2e 测试文件会检查环境变量。只要你的机器上设置了端点或认证变量，它们就会真正调用模型。`test.sh` 先清空环境，所以它不会误触 e2e。

注意名字的陷阱：`packages/agent/test/e2e.test.ts` 文件名里有 e2e，但它不等于需要真模型的测试。判断风险要看它的 setup 和环境变量条件，不能只看文件名。

## harness 与 faux 怎么用

### harness 提供什么

`createHarness(options)` 返回一个 `Harness`。下表列出你最常用的字段。

| 字段或选项 | 作用 |
| --- | --- |
| `HarnessOptions.tools` | 直接传入 `AgentTool` 数组，适合测试普通工具的参数校验和执行 |
| `HarnessOptions.extensionFactories` | 传入内联扩展工厂，适合测试扩展注册的工具 |
| `HarnessOptions.initialActiveToolNames` | 初始激活的工具名。只传入 `tools` 不等于工具已激活 |
| `HarnessOptions.settings`、`withConfiguredAuth` | 覆盖设置，或关闭模拟认证 |
| `Harness.session` | 真实的 `AgentSession`，用于 `prompt()` 和读取 `messages` |
| `Harness.sessionManager` | 会话管理器，用于读取持久化的条目 |
| `Harness.faux` | faux provider 的注册句柄 |
| `Harness.setResponses`、`appendResponses`、`getPendingResponseCount` | 管理脚本队列 |
| `Harness.events`、`eventsOfType(type)` | 事件数组，以及按类型筛选的辅助函数 |
| `Harness.cleanup()` | 清理资源，应在 `afterEach` 中调用 |

`harness.ts` 还导出了几个断言辅助函数：`getMessageText`、`getUserTexts`、`getAssistantTexts`、`getToolResult(harness, toolName)`、`createTestUiContext(overrides)`。

### 测试骨架

以下骨架来自 `test/suite/` 的常见写法。注意 `createHarness` 需要 `await`。

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createHarness, type Harness } from "./harness.ts";

describe("我的行为", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("描述外部行为，而不是实现细节", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("hello")]);

		await harness.session.prompt("hi");
		expect(harness.getPendingResponseCount()).toBe(0);
	});
});
```

`harnesses` 数组的作用：一个测试里可能创建多个 harness，把每个都放进数组，`afterEach` 统一清理。即使断言失败，清理也会执行。

### 脚本是一个先进先出的队列

faux 的脚本规则有三条：

- `setResponses(steps)` 用新数组替换队列；`appendResponses(steps)` 追加到末尾；`getPendingResponseCount()` 返回还没被消费的脚本数量。
- 每次模型请求都取出队首的一条脚本。所以**队列顺序就是请求顺序。**
- 脚本用完后再请求，faux 不会复用上一条回答。它把错误 `No more faux responses queued` 写成一条 `stopReason` 为 `error` 的 assistant 消息（见 `packages/ai/src/providers/faux.ts` 的 `createErrorMessage`），而不是让 `prompt()` 抛出异常。所以测试要去检查消息列表，才能看到这个错误。

一次 `prompt()` 如果包含工具调用，会产生两次模型请求：第一次要求调用工具，第二次在工具结果回来后给出回答。所以这种测试至少需要两条脚本。只写一条，第二次请求会因为脚本耗尽而失败。

### 构造脚本的函数

```typescript
fauxAssistantMessage("hello");
fauxAssistantMessage([fauxText("answer")]);
fauxAssistantMessage([fauxToolCall("echo", { text: "hi" })], { stopReason: "toolUse" });
```

- `fauxAssistantMessage` 构造一条 pi-ai 的 `AssistantMessage`。
- `fauxToolCall(name, args)` 构造一个工具调用内容块。
- 带工具调用的消息必须显式写 `stopReason: "toolUse"`，否则 Agent 不会把它当作"请求执行工具"。

### 工厂函数：在请求发出的那一刻取快照

脚本条目也可以是一个函数。函数接收本次请求的上下文，返回一条消息：

```typescript
harness.setResponses([
	(context) => {
		const hasToolResult = context.messages.some((message) => message.role === "toolResult");
		return fauxAssistantMessage(hasToolResult ? "tool result reached model" : "missing tool result");
	},
]);
```

这个函数是一个**探针**。它在模型请求发出时运行，所以能检查"模型此刻真正看到了什么"，而不是测试结束后的状态。适合用来断言：

- 工具结果是否已经进入下一轮上下文；
- 当前分支里有哪些消息；
- 模型看到的工具清单是什么。

### 类型谓词与 `find`

`harness.session.messages` 的元素类型是一个联合类型，里面有 `user`、`assistant`、`toolResult` 等。直接用 `find` 得到的结果，你不能读取 `isError`，因为编译器不知道它是工具结果。

类型谓词解决这个问题：

```typescript
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";

const result = harness.session.messages.find(
	(message): message is ToolResultMessage => message.role === "toolResult",
);
// 这里 result 的类型是 ToolResultMessage | undefined，可以安全读取 result?.isError
```

逐步看这个写法：

- `(message): message is ToolResultMessage` 是返回类型。它告诉 TypeScript：如果函数返回 `true`，那么 `message` 就是 `ToolResultMessage`。
- 函数体 `message.role === "toolResult"` 才是运行时的真实判断。谓词本身不会检查数据，它只是告诉编译器结论。
- 导入路径是 `@earendil-works/pi-ai/compat`。`harness.ts` 也从这里导入 `ToolResultMessage`。

如果没有谓词，你只能写 `(result as ToolResultMessage).isError`。这种强转会掩盖错误：如果 `find` 实际找到的是别的消息，代码仍会运行，只是读到 `undefined`。谓词让编译器帮你检查这一步。

同样的写法也用在 `harness.ts` 的 `getToolResult` 中（它额外按 `toolName` 过滤，并用 `findLast`）。

## 写一条有区分力的回归测试

下面的测试对应上面的"工具抛错"例子。它按 AGENTS.md 的规则放在 `packages/coding-agent/test/suite/` 中（学习时请使用你自己的文件名）。

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { createHarness, type Harness } from "./harness.ts";

describe("工具抛错的回归测试", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("工具抛错转为 isError 结果，并让模型再回答一次", async () => {
		let executions = 0;
		const harness = await createHarness({
			initialActiveToolNames: ["boom"],
			extensionFactories: [
				(pi) =>
					pi.registerTool({
						name: "boom",
						label: "Boom",
						description: "Always fails",
						parameters: Type.Object({}),
						execute: async () => {
							executions++;
							throw new Error("boom failed");
						},
					}),
			],
		});
		harnesses.push(harness);

		// bindExtensions 的参数是 ExtensionBindings 对象，所有字段可选；空对象即可让扩展工具进入当前会话。
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("boom", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("The tool failed"),
		]);

		await harness.session.prompt("call boom");

		const result = harness.session.messages.find(
			(message): message is ToolResultMessage => message.role === "toolResult",
		);
		expect(result?.isError).toBe(true);
		expect(JSON.stringify(result?.content)).toContain("boom failed");
		expect(executions).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(0);
	});
});
```

### 断言为什么是这四条

| 断言 | 它能抓住的坏实现 |
| --- | --- |
| `result?.isError` 为 `true` | 错误被当作普通成功结果返回 |
| 文本包含 `boom failed` | 错误被替换成空字符串或通用文字 |
| `executions` 为 1 | 工具根本没执行（例如被提前拦截），或被重复执行 |
| 待消费脚本数为 0 | 第二次模型请求没有发生，循环在工具错误后提前结束 |

只保留最后一条"模型有回答"，会漏掉前三类问题。

### 完整走一遍：从写文件到读输出

上面的测试在本地实际运行过。做法是：把它保存为 `packages/coding-agent/test/suite/task14-tmp-boom.test.ts`，再在同一文件里加入两个用例：

1. 第二个用例故意把期望写成 `executions` 为 `2`，用来制造一次失败，观察失败输出。
2. 第三个用例只给一条脚本，然后调用两次 `prompt()`，检查最后一条消息是否含 `No more faux responses queued`。

下面是三个用例合在一起的完整文件（本地运行过的版本）。第一个用例与上文的回归测试相同，只是 `describe` 与 `it` 的名字不同：

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { createHarness, type Harness } from "./harness.ts";

describe("tmp boom", () => {
	const harnesses: Harness[] = [];
	afterEach(() => {
		while (harnesses.length > 0) harnesses.pop()?.cleanup();
	});

	it("passes: boom error becomes isError result and model answers", async () => {
		let executions = 0;
		const harness = await createHarness({
			initialActiveToolNames: ["boom"],
			extensionFactories: [
				(pi) =>
					pi.registerTool({
						name: "boom",
						label: "Boom",
						description: "Always fails",
						parameters: Type.Object({}),
						execute: async () => {
							executions++;
							throw new Error("boom failed");
						},
					}),
			],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("boom", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("The tool failed"),
		]);

		await harness.session.prompt("call boom");

		const result = harness.session.messages.find(
			(message): message is ToolResultMessage => message.role === "toolResult",
		);
		expect(result?.isError).toBe(true);
		expect(JSON.stringify(result?.content)).toContain("boom failed");
		expect(executions).toBe(1);
		expect(harness.getPendingResponseCount()).toBe(0);
	});

	it("fails on purpose: wrong expected execution count", async () => {
		let executions = 0;
		const harness = await createHarness({
			initialActiveToolNames: ["boom"],
			extensionFactories: [
				(pi) =>
					pi.registerTool({
						name: "boom",
						label: "Boom",
						description: "Always fails",
						parameters: Type.Object({}),
						execute: async () => {
							executions++;
							throw new Error("boom failed");
						},
					}),
			],
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({});
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("boom", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("The tool failed"),
		]);

		await harness.session.prompt("call boom");
		expect(executions).toBe(2);
	});

	it("shows the faux exhaustion message when only one script step is given", async () => {
		const harness = await createHarness({
			initialActiveToolNames: [],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("only one")]);

		await harness.session.prompt("first");
		await harness.session.prompt("second");
		expect(JSON.stringify(harness.session.messages.at(-1))).toContain("No more faux responses queued");
	});
});
```

为什么临时文件必须放在 `test/suite/` 里？因为它要 `import ... from "./harness.ts"`，系统临时目录里没有这个文件，无法导入。运行后要删除它。

运行命令（在包根目录）：

```text
node "D:/Github/pi/node_modules/vitest/dist/cli.js" --run test/suite/task14-tmp-boom.test.ts
```

本地实测的输出，失败部分原样保留：

```text
 RUN  v4.1.11 D:/Github/pi/packages/coding-agent

·x·

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/suite/task14-tmp-boom.test.ts > tmp boom > fails on purpose: wrong expected execution count
AssertionError: expected 1 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 1

 ❯ test/suite/task14-tmp-boom.test.ts:75:22
     73|
     74|   await harness.session.prompt("call boom");
     75|   expect(executions).toBe(2);
       |                      ^
     76|  });
     77|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

退出码为 `1`。三个用例中，第一个（上文的回归测试）和第三个（脚本耗尽）都通过了。

### 读懂失败输出，一步一步

这份输出可以按下面六步读。每一步都回答一个问题：

1. **哪个测试失败？** 看 `FAIL` 行。它给出文件、`describe` 名、`it` 名，三者连起来就是定位地址。
2. **失败的断言是什么？** 看 `AssertionError` 行。`expected 1 to be 2` 的意思是：实际值是 `1`，你写的期望是 `2`。`Object.is equality` 说明比较方式是严格相等。
3. **差在哪里？** 看 `Expected` 和 `Received` 的 diff。`- 2` 是期望，`+ 1` 是实际。
4. **在哪一行？** 看 `❯ test/suite/...:75:22`。`75` 是行号，`22` 是列号。下面的代码帧用 `^` 指向失败的表达式。注意这是测试文件的行号，不是源码的行号。
5. **总共怎样？** 看 `Tests 1 failed | 2 passed (3)`。其他用例没有受影响，说明问题是局部的。
6. **接下来怎么判断？** 问一个问题："期望 `2` 是需求要求的，还是我随手写的？" 这里是我故意写错的，所以应该改测试。如果是需求要求的，那么 `1` 就说明实现有问题，要去看 `agent-loop.ts` 中工具执行的分支。

这一步判断最容易出错。失败输出只说明"实际与期望不同"，它不说明谁错了。测试和实现都可能是错的，必须回到需求上确认。

### 自证区分力

写完测试后，要证明它真的会失败：

1. 运行测试，确认通过。
2. 在你自己的实现中做一个小的破坏。例如，让错误分支不设置 `isError`，或删掉错误文本。
3. 再次运行，测试必须失败。失败信息应指向你改坏的那一行行为。
4. 还原改动，再次运行，确认通过。
5. 用 `git diff` 确认工作区只剩你想保留的改动。

如果第 3 步仍然通过，说明断言太弱，要重写断言。

### 自证示例（练习，未在本地执行）

本篇不修改源码，所以下面的"破坏实现"只作为练习描述，没有在本地执行。

假设你在本地一个临时分支里，把 `packages/agent/src/agent-loop.ts` 中工具执行抛错的分支改成不设置 `isError`。那么：

- 第 1 步：上文的回归测试应当通过（已在本地运行过，结果为通过）。
- 第 3 步：测试应当在 `expect(result?.isError).toBe(true)` 这一行失败。预期的错误信息类似 `expected undefined to be true`（未在本地验证，具体文字以 vitest 实际输出为准）。
- 第 4 步：还原改动后，测试应当重新通过。

判断"断言是否有区分力"的清单：

- 失败发生在你改坏的那一行附近，而不是在无关的断言上。
- 失败信息里的实际值和你的改动一致（例如 `undefined` 对应"没有设置标记"）。
- 还原后 `git status` 只剩你想保留的文件。本篇的测试临时文件要删除。

如果你改坏了实现，测试却没有失败，不要急着说测试"通过了"。先看断言是否覆盖到了改动的那一行。

## 动手实验

以下命令在本机 Windows PowerShell 7 中运行过，结果写在每个实验中。bash 版本没有在本地运行，会明确标注。

运行前确认：Node 版本 `>= 22.19.0`（见根 `package.json` 的 `engines`）；依赖已安装。如果没有安装，在仓库根执行 `npm install --ignore-scripts`。

### 实验 1：运行一个现成的单文件测试（5 分钟内完成）

目的：确认测试命令能跑，并看懂输出。

PowerShell：

```powershell
$repo = git rev-parse --show-toplevel
Push-Location "$repo/packages/coding-agent"
node "$repo/node_modules/vitest/dist/cli.js" --run test/suite/agent-session-prompt.test.ts
Pop-Location
```

bash（未在本地运行）：

```bash
cd "$(git rev-parse --show-toplevel)/packages/coding-agent" && \
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/agent-session-prompt.test.ts
```

本地预期输出（PowerShell 7 实测）：

```text
 RUN  v4.1.11 D:/Github/pi/packages/coding-agent
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

退出码为 0。耗时取决于机器，本次约 13 秒。

### 实验 2：运行一个 tui 的 node:test 文件

目的：区分 vitest 与 node:test 两种运行器。

PowerShell：

```powershell
$repo = git rev-parse --show-toplevel
Push-Location "$repo/packages/tui"
node --test test/keys.test.ts
Pop-Location
```

bash（未在本地运行）：`cd packages/tui && node --test test/keys.test.ts`

本地预期输出的末尾（实测）：

```text
ℹ tests 60
ℹ pass 60
ℹ fail 0
```

退出码为 0。

### 实验 3：用 PowerShell 过滤事件流

目的：学会读 JSON Lines（每行一个 JSON 对象）格式的事件，并筛出关键事件。

这里用一份手写的小样本，不需要模型。真实的 `pi --mode json` 运行需要模型配置，不在本篇实验范围内。

```powershell
$dir = Join-Path $env:TEMP "pi-task14-json"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$events = Join-Path $dir "events.jsonl"
@'
{"type":"agent_start"}
{"type":"tool_execution_start","toolCallId":"call-1","toolName":"read"}
{"type":"tool_execution_end","toolCallId":"call-1","toolName":"read","isError":false}
{"type":"agent_end","willRetry":false}
'@ | Set-Content -Path $events -Encoding utf8
Get-Content $events | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.type -match '^(agent_|turn_|message_end$|tool_execution_(start|end)$|error)' } | ForEach-Object { $_.type }
Remove-Item -Recurse -Force $dir
```

本地预期输出（实测）：

```text
agent_start
tool_execution_start
tool_execution_end
agent_end
```

这段命令做了三件事：逐行读取文件，每行用 `ConvertFrom-Json` 解析成对象，然后按 `type` 字段过滤。最后删除临时目录。

bash 版本（未在本地运行）：

```bash
jq -c 'select(.type | test("agent_|turn_|message_end|tool_execution_(start|end)|error"))' events.jsonl
```

### 实验 4：确认你运行的是哪份代码

目的：排障前先确认用的是源码版还是安装版。`pi-test` 脚本从源码启动。

```powershell
.\pi-test.ps1 --version
```

本地预期输出（实测）：第一行可能是 Node 的 `ExperimentalWarning: Type Stripping ...`，这是 Node 直接运行 TypeScript 的提示，可忽略。最后一行是版本号：

```text
1.0.2
```

bash（未在本地运行）：`./pi-test.sh --version`

### 实验 5：写一条失败测试（写作练习，未在本地运行）

目的：亲手完成"写测试、自证失败、还原通过"的闭环。

1. 在 `packages/coding-agent/test/suite/` 下新建你自己的测试文件，例如 `my-boom.test.ts`。内容可以参考上面的"写一条有区分力的回归测试"。
2. 在包根目录运行单文件命令（见实验 1），确认它通过。
3. 在你的实现中做一处小的破坏（例如让错误分支不设置 `isError`），再次运行，确认测试失败，并观察失败信息是否指向 `isError`。
4. 还原改动，再次运行，确认通过。
5. 用 `git status` 确认只有你新增的测试文件。实验结束后删除它，或在你自己的分支上保留。

这个实验没有在本地运行。上面的测试代码是按 harness 的类型和现有用法编写的，你需要自己跑一遍确认。（实验 6 中的三用例文件已在本地运行，结果以那里的输出为准。）

### 实验 6：读懂一次失败输出（10 分钟内完成）

目的：亲眼看到一次失败，并按六步读出它的含义。

步骤：

1. 把上文"完整走一遍"中的三用例文件保存为 `packages/coding-agent/test/suite/task14-tmp-boom.test.ts`。
2. 在 `packages/coding-agent` 目录运行单文件命令（PowerShell）：

```powershell
$repo = git rev-parse --show-toplevel
Push-Location "$repo/packages/coding-agent"
node "$repo/node_modules/vitest/dist/cli.js" --run test/suite/task14-tmp-boom.test.ts
"exit=$LASTEXITCODE"
Pop-Location
```

3. 对照上文的输出，找到 `FAIL` 行、`AssertionError` 行和代码帧中的 `^`。
4. 删除临时文件：

```powershell
Remove-Item "$repo/packages/coding-agent/test/suite/task14-tmp-boom.test.ts"
```

bash（未在本地运行）：把 `$LASTEXITCODE` 换成 `$?`，`Remove-Item` 换成 `rm`。

预期结果：最后一行 `exit=1`；`Tests 1 failed | 2 passed (3)`。耗时和启动时间每次都不同。（本地实测的是 Git Bash 中的同一命令，退出码为 1；上面的 PowerShell 写法未单独运行，未在本地验证。）

### 实验 7：用只读的 git 命令找回归的候选提交

目的：不修改工作区，只用 `git log` 和 `git show` 缩小"哪次提交改了这段逻辑"。

步骤（在仓库根运行）：

```powershell
git log --oneline -5 -- packages/agent/src/agent-loop.ts
git log --oneline -S "createErrorToolResult" -- packages/agent/src/agent-loop.ts
git show --format= --name-only afda4d620
```

预期输出的形状：第一条列出最近 5 次改过该文件的提交；第二条列出改过 `createErrorToolResult` 出现次数的提交；第三条列出 `afda4d620` 改动的文件。这三条命令的实测输出见"排障"部分的"用 git 二分缩小回归（只读演示）"一节。

这三条命令都是只读的，不会切换分支，也不会改动工作区。输出是在 Git Bash 中得到的；PowerShell 中的同名命令未单独运行（未在本地验证）。

bash（未在本地运行）：命令相同，把 `-S "createErrorToolResult"` 保留即可。

## 排障：六段定位法

pi 的一次运行有六个主要阶段。定位问题的顺序是：**从外到内，从静到动。** 每一步都问同一个问题："到这一步为止，哪些东西已经被证明是正确的？"

| 阶段 | 检查点 | 常见根因 | 第一个查看的代码 |
| --- | --- | --- | --- |
| 1. 启动 | Node 版本、依赖、运行的是源码还是安装版、`crashes.json` | 版本过低，依赖缺失，改了源码却跑安装版 | `packages/coding-agent/src/main.ts`（入口）、`packages/coding-agent/src/core/crash-log.ts` |
| 2. 配置与资源 | 设置来源、项目信任、`/reload` 是否生效 | 项目未信任，改了文件但没重载，JSON 语法错误 | `packages/coding-agent/src/core/settings-manager.ts`、`packages/coding-agent/src/core/extensions/loader.ts` |
| 3. 模型请求 | 认证、模型是否可用、是否出现 assistant 的 `message_start`、是否在重试 | 凭据缺失，模型名错误，限流后自动重试 | `packages/coding-agent/src/core/auth-storage.ts`、`packages/ai/src/providers/`、`packages/agent/src/agent-loop.ts` |
| 4. 工具 | 工具是否声明、是否调用、参数是否合法、是否被拦截、是否抛错或超时 | 工具没有激活，参数校验失败，异常被转为错误结果 | `packages/agent/src/agent-loop.ts`（`prepareToolCall`、`createErrorToolResult`） |
| 5. 持久化 | 历史是否在另一条分支，恢复时 cwd 是否存在，压缩后是否"丢"了内容 | 看的是另一条分支，压缩只替换了表示 | `packages/coding-agent/src/core/session-manager.ts` |
| 6. UI | 状态对不对，事件到没到，组件刷没刷 | 订阅已失效，缺少重新渲染请求 | `packages/tui/src/terminal.ts`、`packages/tui/src/utils.ts` |

### 用"最后一条正确事件"定位

不要只看最后一个错误字符串。把事件按到达顺序读，找到**预期轨迹中最后一条确实出现的事件**，然后检查它后面应该出现却没有出现的那一层。

| 最后观察到的事件 | 它证明了什么 | 下一步查哪里 |
| --- | --- | --- |
| 没有 `agent_start` | Agent 运行还没开始，或订阅没有捕获事件 | `AgentSession.prompt()` 的入口与预检查（`packages/coding-agent/src/core/agent-session.ts` 的 `prompt`） |
| `agent_start`，但没有 assistant 的 `message_start` | 运行已开始，模型请求还没有开始 | `agent-loop.ts` 的模型调用，以及 provider 流的创建（`packages/agent/src/agent-loop.ts`、`packages/ai/src/providers/`） |
| `tool_execution_start`，没有同 `toolCallId` 的 `tool_execution_end` | 工具已开始执行，但没有观察到结束 | 工具的执行 Promise、取消信号，以及事件派发是否被阻塞（`packages/agent/src/agent-loop.ts` 的工具执行分支） |
| `tool_execution_end`，之后没有新的 assistant `message_start` | 工具已结束，下一轮模型请求没有发生 | 工具结果写回，以及循环继续的条件（`packages/agent/src/agent-loop.ts`） |
| `agent_end` 且 `willRetry` 为 `true` | 这次运行结束了，但会话层准备重试 | 等待 `auto_retry_start` 与后续事件，不要判定为挂死（`packages/coding-agent/src/core/agent-session.ts` 的重试逻辑） |
| `agent_settled` 之后界面仍显示忙碌 | 会话已经不会自动继续，问题在监听器或渲染 | 订阅是否绑定到了新的会话，组件是否请求了重绘（`packages/tui/src/` 与订阅事件的代码） |

几个区分要记住：

- `agent_end` 不等于"完成"。`agent_settled` 才表示会话不会再自动继续。
- `message_update` 里只有增量内容，不一定带完整的消息快照。要看最终消息，应读 `message_end`。
- 事件 id 和数值只是例子。排障时必须用你本地日志里真实出现的值。

一条合格的定位记录应该长这样（以下 id 为示例值）：

```text
预期：tool_execution_start(id=call-7) 之后应有 tool_execution_end(id=call-7)
实际：start 出现；之后只有 assistant message_end(stopReason=aborted)，没有 end
已证明：模型已经选中工具；工具已注册
下一步：从 call-7 检查执行 Promise、abort 信号与工具的 finally 清理
```

### 症状 -> 层 -> 第一个文件

下表是快速入口。左列是你看到的现象，中列是它大概属于哪一层，右列是第一个该打开的文件。这些是起点，不是结论：打开文件后，仍要用上一节的"最后一条正确事件"确认。

| 症状 | 层 | 第一个打开的文件 |
| --- | --- | --- |
| 启动后立即退出，或报入口错误 | 启动 | `packages/coding-agent/src/main.ts` |
| 启动后立即崩溃，之后出现崩溃记录 | 启动 | `packages/coding-agent/src/core/crash-log.ts` |
| 改了设置，行为没变 | 配置 | `packages/coding-agent/src/core/settings-manager.ts` |
| 扩展注册的工具没有出现 | 配置与扩展 | `packages/coding-agent/src/core/extensions/loader.ts` |
| 模型报认证相关的错误 | 模型请求 | `packages/coding-agent/src/core/auth-storage.ts` |
| 模型请求的供应商与预期不符 | 模型请求 | `packages/ai/src/providers/`（目录中有 `all.ts` 等文件，本篇未核对它们各自的职责） |
| 工具结果是 `Tool X not found` | 工具 | `packages/agent/src/agent-loop.ts`（找不到工具的分支） |
| 工具结果是 `Operation aborted` | 工具与取消 | `packages/agent/src/agent-loop.ts`（取消信号的分支） |
| 工具结果是 `Tool execution was blocked`，或参数被拒绝 | 工具 | `packages/agent/src/agent-loop.ts` 的 `prepareToolCall` 分支 |
| 工具执行了，但模型没有收到结果 | 循环 | `packages/agent/src/agent-loop.ts`（工具结果写回的位置） |
| 工具没有激活，或激活状态与预期不同 | 会话 | `packages/coding-agent/src/core/agent-session.ts` 的 `setActiveToolsByName` 与 `getActiveToolNames` |
| 重试次数不对，或没有重试 | 会话 | `packages/coding-agent/src/core/agent-session.ts` 的 `retryAttempt` 与重试逻辑 |
| 恢复会话后内容不对 | 持久化 | `packages/coding-agent/src/core/session-manager.ts` |
| 中文或宽字符显示错位 | 界面 | `packages/tui/src/utils.ts` 的 `visibleWidth`，以及调用它的组件（如 `packages/tui/src/components/editor.ts`） |
| 按键没有反应，或按键识别错误 | 界面 | `packages/tui/src/keys.ts` |
| 要分享日志，需要先脱敏 | 报告 | `packages/coding-agent/src/core/bug-report.ts` |
| `npm run check` 的某一步失败 | 质量门 | 根 `package.json` 的 `check` 脚本，再看 `scripts/` 中对应的脚本 |

表中 `Tool X not found`、`Operation aborted`、`Tool execution was blocked` 这三条文字都能在 `packages/agent/src/agent-loop.ts` 中找到，它们是 `createErrorToolResult` 的参数。所以"看到一段错误文字"就能直接定位到分支，不必从头读循环。

一个具体的例子：用户说"中文字符右边框错位"。

1. 层：界面。宽字符的列宽由 `visibleWidth` 计算，它在 `packages/tui/src/utils.ts`。
2. 第一个文件：`packages/tui/src/utils.ts`。先看 `visibleWidth` 的实现，确认它对宽字符返回的数值。
3. 第二步：查哪些组件调用它。在 `packages/tui/src/components/` 中 grep 可以看到 `editor.ts` 与 `input.ts` 都引用了这类宽度函数。
4. 证明：如果 `visibleWidth` 的返回值是对的，而错位仍然出现，问题就在调用方的截断或拼接。如果返回值是错的，问题在 `utils.ts`。
5. 回归测试：`packages/tui/test/` 下已有 `regression-regional-indicator-width.test.ts` 之类的文件，可以仿照它写一个 node:test 单元测试。

这个例子只说明找层的思路。具体的修复要看实际的代码。

### 缩小范围的手段

| 手段 | 做法 | 适合的问题 |
| --- | --- | --- |
| 二分回退 | 一半一半地禁用扩展或设置，看问题是否消失 | 资源冲突、配置覆盖 |
| 事件断点 | 在 JSON 事件流里找"最后一条符合预期的"和"第一条不符合的" | 循环、工具、重试等流程问题 |
| 确定性替换 | 固定输入，用 faux 模型代替真模型 | 偶发问题、竞态 |
| 分层隔离 | 用 harness 复现原本在终端里发生的问题 | 与渲染无关的会话问题 |
| `git bisect` | 已知"某个提交开始出问题"时，二分查找提交 | 回归问题，配合 issue 号 |
| 对照实验 | 同一输入，比较"有工具与无工具"或"模型 A 与模型 B" | 找出差异点 |

"偶发"往往意味着你还没找到触发条件。与其重复运行十次等它出现，不如用可控的 Promise 或固定的完成顺序，把时序条件显式构造出来。

### 用 git 二分缩小回归（只读演示）

场景（假设）：用户说"工具抛错后，界面没有显示错误"。你记得一个月前这还是正常的。问题是：哪次提交改坏了它？

二分的想法很简单：候选提交排成一列，每次测试中间的那个。如果中间的正常，坏的在后半段；如果中间的坏，坏的在前半段或就是中间的那个。每一步把范围减半。

第一步：找出候选。只改了某个文件的提交可以用 `git log -- <路径>` 列出：

```text
git log --oneline -5 -- packages/agent/src/agent-loop.ts
```

第二步：缩小到"改过相关字符串的提交"。`-S` 会找出某个字符串出现次数发生变化的提交：

```text
git log --oneline -S "createErrorToolResult" -- packages/agent/src/agent-loop.ts
```

本地实测输出的前三条是 `afda4d620`、`351efc828`、`b94482762`。

第三步：看一个候选改了什么。`git show --stat` 只列文件，不列内容：

```text
git show --stat --format="%h %s" afda4d620
```

实测输出为：`afda4d620 fix(agent): stop prepared tools after preflight abort (#8936)`，`packages/agent/src/agent-loop.ts` 新增了 9 行，同时新增了 `packages/coding-agent/test/suite/regressions/8935-parallel-preflight-abort.test.ts`（72 行）。这个提交本身就带了回归测试，这是你做二分时最想要的证据。要看具体改了哪几行，用 `git show afda4d620 -- packages/agent/src/agent-loop.ts`（未在本地运行）。

第四步：数一数范围。`git rev-list --count A..B` 统计 A 之后、B 之前（含 B）的提交数。本地实测：

```text
git rev-list --count 82be77572..HEAD   -> 3
```

3 个候选，线性逐个检查最多要 3 次；二分最多需要 `ceil(log2(3))`，即 2 次。候选越多，差距越大：100 个候选约需 7 次（`ceil(log2(100))`，算术结果，未在本地验证）。

第五步：真正的二分命令（未在本地运行）。它们会改变 `HEAD` 和工作区，所以不要在多个会话共用的目录中直接运行：

```text
git bisect start
git bisect bad                 # 当前提交有问题
git bisect good <已知正常的提交>
# git 检出中间提交，你运行一次复现测试，然后：
git bisect good                # 或 git bisect bad
git bisect reset               # 结束，回到原来的分支
```

AGENTS.md 规定多个会话可能同时修改同一目录。安全的做法是在单独的 worktree 中做二分，或者只用上面的只读命令找到候选，再到一个干净的副本中验证。

得到候选提交后，回到"写一条有区分力的回归测试"：先用一个会失败的测试固定这个行为，再决定如何修。

### 写一份最小复现说明

一份合格的复现说明应包含以下部分：

```markdown
## 环境
- 仓库基线：<commit>
- 运行方式：源码（pi-test）/ 安装版 / SDK / RPC
- 操作系统与 shell：<Windows + PowerShell 7 ...>
- Node 版本：<v23.9.0>

## 预期
（一句话，可以被观察到）

## 实际
（原始输出或事件片段）

## 最小步骤
1. ...
2. ...

## 失败断言
（如果写成测试，断言什么？写不出来，通常说明还没定位到问题）

## 已排除项
（试过什么，结果如何）
```

"失败断言"是最关键的一行。它迫使你把"感觉不对"翻译成"某个字段的值与期望不同"。

### 必需的五部分，以及一份完整示例

一份报告要有五个部分才能被别人重现：**环境、预期、实际、最小步骤、失败断言**。"已排除项"不是必需，但它能避免别人重复你做过的排查，建议保留。

先看一份差的报告：

```text
pi 的工具坏了，界面上没有错误，求修。
```

它缺少全部五部分。维护者无法知道是哪个版本、哪个工具、哪一步、哪个值不对。

下面是一份结构完整的报告。注意：它描述的是一个假设的问题，**不是**仓库中真实的缺陷，示例中的"实际"输出也不是真实运行的结果。这里只用来说明每个部分该写什么。环境一节中的版本号是本地实测的。

```markdown
## 环境
- 仓库基线：1437ee663（my_learning 分支，git rev-parse --short HEAD 实测）
- 运行方式：源码，在 packages/coding-agent 中用 vitest 单文件运行
- 操作系统与 shell：Windows 11，PowerShell 7
- Node 版本：v23.9.0（node -v 实测）

## 预期
工具 `boom` 抛错后，会话中有一条 `toolResult`，其 `isError` 为 `true`，之后模型会被再请求一次。

## 实际
（示例，非真实运行）
AssertionError: expected undefined to be true
toolResult 只有 content，没有 isError 标记。

## 最小步骤
1. 保存 `test/suite/task14-tmp-boom.test.ts`（内容与本篇"完整走一遍"相同）。
2. 在 `packages/coding-agent` 运行 `node <仓库根>/node_modules/vitest/dist/cli.js --run test/suite/task14-tmp-boom.test.ts`。
3. 第一个用例失败。

## 失败断言
`expect(result?.isError).toBe(true)`，实际值为 `undefined`。

## 已排除项
- 没有使用 `await createHarness`：代码中已加 `await`。
- 扩展工具未激活：测试中已调用 `bindExtensions({})`，并且 `initialActiveToolNames` 包含 `boom`。
```

这份示例的价值在于每一行都可以被检查。"失败断言"那一行可以直接改成一条 `expect`，在测试中运行。如果你写不出这一行，通常说明还没有定位到问题，应该回到"最后一条正确事件"那一节。

## 可评审的改动

"可评审"的意思是：另一个人打开你的 diff，能在几分钟内判断它是否应该合并，并且能自己重新验证。

### 一次改动包含什么

1. **问题说明**：用户或开发者能观察到的现象，或者缺失的能力。
2. **最小代码改动**：只改必要的文件和必要的行。不要顺手重构、不要顺手格式化无关代码。
3. **回归测试**：先写一个会失败的测试，再修实现，使测试通过。
4. **质量门输出**：`npm run check` 的完整输出，以及你检查过的 `git diff`。
5. **变更说明**：问题、行为变化（包括"什么没变"）、测试证据、影响范围。

先写失败测试的好处：失败测试本身就是复现说明。它把"我以为的问题"固定成可执行的证据，也能防止"改 A 时弄坏 B"。

### 修复 GitHub issue 的回归测试

`AGENTS.md` 规定：为修复 GitHub issue 而添加的回归测试，要在测试旁边加注释，写明 issue 号。例如：

```typescript
// Regression for github issue #1234
it("keeps the tool error visible to the model", async () => {
	// ...
});
```

本篇的示例没有对应真实的 issue 号，所以没有加注释。

### 质量门：`npm run check`

根 `package.json` 中的 `check` 脚本依次执行以下步骤（按脚本中的顺序）：

| 步骤 | 命令 | 检查什么 |
| --- | --- | --- |
| 1 | `biome check --write --error-on-warnings .` | 格式与 lint，**会自动改写文件**；警告也算失败 |
| 2 | `check:pinned-deps` | 外部依赖必须是精确版本 |
| 3 | `check:runtime-deps` | 源码 import 的包必须已在依赖中声明 |
| 4 | `check:ts-imports` | 相对导入必须使用 `.ts` 后缀 |
| 5 | `check:entry-graphs` | 包入口的模块图不能超过预算 |
| 6 | `check:install-lock:coding-agent` | 独立安装锁与生成结果一致 |
| 7 | `tsc --noEmit` | 全仓库类型检查 |
| 8 | `check:browser-smoke` | 浏览器环境的冒烟检查 |

使用时的三条规则：

- 修改代码后执行 `npm run check`，保留完整输出。`AGENTS.md` 要求修完所有错误、警告和提示再提交。
- 第 1 步会改文件。执行完后必须看 `git diff`，把无关的格式变化去掉，或者单独处理。
- 本篇文档改动不需要执行 `npm run check`。本篇写作时也没有执行它，因为它会改写仓库中的其他文件。

`AGENTS.md` 禁止在没有用户要求时运行 `npm run build` 和 `npm test`。

### 变更日志（CHANGELOG）

位置：`packages/*/CHANGELOG.md`，每个包一份。

规则：

- 新条目放在 `## [Unreleased]` 下。先读完整的 Unreleased 段，追加到已有的小节中，不要重复创建同名小节。
- 小节名固定为 `### Breaking Changes`、`### Added`、`### Changed`、`### Fixed`、`### Removed`。
- 已发布版本的段落（如 `## [0.12.2]`）不可修改。
- **只有在 `main` 分支或 PR 分支上工作时才创建条目。** 本篇所在的分支是 `my_learning`，所以学习文件的改动不需要 changelog 条目。

归因格式：

```markdown
Fixed foo bar ([#123](https://github.com/earendil-works/pi/issues/123))
Added feature X ([#456](https://github.com/earendil-works/pi/pull/456) by [@username](https://github.com/username))
```

### Git 纪律：共享工作区

同一个工作目录里可能同时有多个会话在修改不同文件。因此：

- 只提交**你自己改过的文件**。提交前用 `git status` 核对。
- 暂存时使用显式路径，例如 `git add <路径1> <路径2>`。**禁止 `git add -A` 与 `git add .`。**
- 以下命令会破坏别人的未保存工作，禁止使用：`git reset --hard`、`git checkout .`、`git clean -fd`、`git stash`、`git commit --no-verify`。
- 只有用户明确要求时才提交。
- 提交信息格式：`{feat,fix,docs}[(ai,tui,agent,coding-agent)]: <说明>`。例如：`docs: rewrite zh-CN task 14 testing guide`。

## 常见错误

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 测试通过了，但工具错误其实被吞掉了 | 只断言了"模型有回答" | 同时断言 `isError`、错误文本、执行次数和脚本消耗数 |
| 运行 `npx vitest` 后出现意外的网络或费用 | 全量运行激活了 e2e 测试 | 只跑单个文件，或在 Git Bash 中运行 `./test.sh` |
| 最后一条 assistant 消息含 `No more faux responses queued`，但 `prompt()` 没有抛异常 | 工具调用需要两次模型请求，但只写了一条脚本 | 补上工具结果之后的那条回答脚本；断言时检查 `messages`，不要只看 `prompt()` 是否抛异常 |
| 认为会话已经完成，因为看到了 `agent_end` | `agent_end` 只表示一次运行结束，可能还会重试 | 等待 `agent_settled`，并检查 `willRetry` |
| `npm run check` 后 diff 里全是格式改动 | 第 1 步 `biome --write` 改写了无关文件 | 先审查 diff，撤销无关改动，只保留自己的修改 |

### 两条最容易误判的症状

**"prompt() 没报错" 不等于 "模型回答了"。** 上面第二条错误的真实表现就是这样。在本地的第三个用例中，第二次 `prompt()` 没有抛异常，但会话最后一条消息是一条 `stopReason` 为 `error` 的 assistant 消息，内容含 `No more faux responses queued`。测试如果只写 `await harness.session.prompt("...")` 而不检查消息，就会错误地通过。

**"看到 agent_end" 不等于 "结束"。** 当 `agent_end` 带着 `willRetry: true` 时，会话还会自动再试一次。把这一刻当作结束，会导致你在中途读取结果，得到一份不完整的记录。正确的判断点是 `agent_settled`。

## 自测题

1. "工具抛错后循环继续"与"tui 按键解析"各应该放在哪一层测试？为什么？
2. 一次 `prompt()` 包含一次工具调用时，faux 脚本至少需要几条？为什么是这个数？
3. 类型谓词 `message is ToolResultMessage` 在运行时会检查类型吗？它改变了什么？
4. 你写了一条测试并且它通过了。用什么步骤证明它有区分力？
5. 为什么运行 `npm run check` 之后要看 `git diff`？

### 参考答案

1. "工具抛错后循环继续"需要 Agent 循环和会话配合，所以用 suite（harness 加 faux）。"tui 按键解析"是纯函数，用 `packages/tui/test/` 下的 node:test 单元测试即可。
2. 至少两条。第一条让模型请求工具调用，第二条在工具结果返回后给出回答。faux 脚本是先进先出的队列，每次模型请求消耗一条。
3. 不会。谓词只是告诉编译器："返回 `true` 时，这个值是 `ToolResultMessage`。"运行时的判断仍然是函数体里的 `message.role === "toolResult"`。它的作用是让编译器在之后的代码中允许读取 `isError` 等字段。
4. 故意把实现改坏（例如吞掉错误），确认测试失败；还原后确认测试通过。断言失败的信息应指向你改坏的行为。
5. `npm run check` 的第 1 步会用 biome 自动改写文件。审查 diff 可以确认改动只来自你的修改，避免把无关的格式变化混进评审。

## 选读：源码深入（可选，跳过不影响主线）

以下内容超出主线。读完主线后再看。

### 选读 A：faux 的内部行为

- faux 不会一次性把完整消息交给 Agent。它把内容拆成 `start`、`delta`、`end`、`done` 等流事件。文本按估算的 token 大小分块。
- `tokenSize.min` 和 `tokenSize.max` 控制伪 token 的长度。默认是一个区间，所以 delta 的数量不稳定。想检查精确的 delta 次数，需要把 min 和 max 设成相同的值，或者只断言拼接后的最终文本。
- 脚本消息的 `stopReason` 如果还是 `pending`，faux 会报错。`error` 与 `aborted` 会发出错误事件；其他终止原因发出完成事件。
- 工厂函数抛出异常，与工厂返回 `stopReason: "error"` 的消息，走的路径不同。前者进入异步任务的 catch，后者按终态分支发出错误事件。写测试前要先想清楚你要模拟哪一种。

### 选读 B：两种 faux 入口

| 工厂 | 注册位置 | 常见用途 |
| --- | --- | --- |
| `registerFauxProvider`（`packages/ai/src/compat.ts`） | 全局的 API provider 注册表 | 标准的 `getModel` 路径，harness 使用它 |
| `fauxProvider` | 返回一个 `Provider` 对象，由测试自己放入 `Models` | 测试 `Models` 与 provider 注册表本身 |

注册不是永久的。测试结束必须注销，否则后续测试可能遇到冲突的 API，或者使用旧的脚本队列。

### 选读 C：harness 装配的细节

- 每个 harness 创建唯一的临时目录，作为会话的 cwd。默认使用内存的 `SessionManager`、`SettingsManager` 和 `AuthStorage`，所以不会读写你的真实会话、设置或凭据。
- 默认 `withConfiguredAuth` 为 true 时，harness 会在内存的认证存储中放入一个假的密钥 `faux-key`，让会话走正常的模型查找路径。这个假密钥不会被发送到网络。设为 false 时，适合测试"缺少认证"的行为。
- `modelsJson` 选项会把 JSON 写入临时目录下的 `models.json`，用于测试模型配置的加载。
- `cleanup()` 按顺序执行：`session.dispose()`，注销 faux provider，删除临时目录（递归删除，仅当目录仍存在时）。
- `vi.clearAllMocks()` 不会注销 provider，不会释放会话，也不会删除临时目录。不同资源由不同的所有者清理，要分别处理。

### 选读 D：一个更复杂的样板测试

`packages/coding-agent/test/suite/agent-session-tool-orchestration.test.ts` 把工具调度、嵌套调用和持久化放在同一个测试里。阅读它时注意三点（只读，未在本地运行）：

- 扩展可以用 `prepareLoadout` 改变模型看到的工具描述，同时不改变可以执行的工具集合。这体现了"声明"与"可执行"的区别。
- 工厂探针可以在请求发出时读取 `context.messages`，精确断言模型当时看到的工具列表。
- 同一个结果同时出现在内存的消息与持久化的条目中。好的测试会两边都断言。

### 选读 E：强断言与弱断言

```typescript
// 弱：只检查内部计数
expect(harness.session.retryAttempt).toBe(1);

// 强：检查调用方能观察到的生命周期事件
expect(harness.eventsOfType("auto_retry_start")).toHaveLength(1);
```

`retryAttempt` 是 `AgentSession` 公开的 getter，所以它不需要 `as any`。但它只说明内部计数是 1，不说明订阅者收到了通知。如果需求是"订阅者要知道重试何时开始"，就应该断言事件。

本仓库的测试大多属于第二种：事件序列、消息形状、条目内容、错误文本。这些是"契约"，改动后应该有测试提醒。

### 选读 F：排障设施

- **事件轨迹**：`pi --mode json "..." > events.jsonl` 把运行过程写入文件。它会包含用户输入、模型输出、工具参数和结果。分享前要检查并脱敏。
- **启动耗时**：`PI_STARTUP_BENCHMARK=1` 只在交互模式下有效（`packages/coding-agent/src/main.ts`）。它会初始化后立即退出，并打印耗时。
- **原始 ANSI 流**：`PI_TUI_WRITE_LOG` 让终端层把写出的原始字节记录到文件（`packages/tui/src/terminal.ts`）。渲染问题的第一步是看这些字节，而不是只看屏幕。
- **崩溃记录**：`packages/coding-agent/src/core/crash-log.ts` 把未捕获异常写入 agent 目录下的 `crashes.json`。它的保留规则是：
  - 写入时只保留最新 5 条（`MAX_CRASH_RECORDS`）。
  - `MAX_AGE`（7 天）只用于启动时决定是否提示那条未通知的崩溃（`takeUnnotifiedCrash` 的过滤条件）。它不会删除记录。
- **报告脱敏**：`packages/coding-agent/src/core/bug-report.ts` 中，`SENSITIVE_KEY` 正则匹配的键，其值会被替换；`redactUrl` 去掉 URL 中的用户名、密码和敏感查询参数；`redactJsonValue` 递归处理 JSON。贴日志之前，自己做同样的检查：密钥、内部地址和文件内容都可能出现在事件流中。

### 选读 G：质量门中的各项检查

- `check:pinned-deps`：遍历所有 `package.json`，要求 `dependencies`、`devDependencies`、`optionalDependencies` 使用精确版本，不允许 `^` 或 `~`。内部工作区包与非注册表形式（如 `workspace:`、`file:`、`git+`）豁免。
- `check:runtime-deps`：防止"幽灵依赖"。源码 import 的包如果只在本地 `node_modules` 中存在，但没有声明在依赖里，发布后用户安装会失败。
- `check:ts-imports`：相对导入写成 `./foo.js` 会被拒绝。源码应写真实存在的 `.ts` 路径。
- `check:entry-graphs`：包的 `exports` 入口有模块图预算。一个 `export *` 可能把整个模块桶拖进来。只有值导入计入成本，`import type` 在运行时被擦除。
- `check:install-lock:coding-agent`：检查独立安装锁与生成结果一致。锁文件由 `scripts/generate-coding-agent-install-lock.mjs` 生成，加 `--check` 只检查不写入。新增带生命周期脚本的依赖，必须在该脚本中显式加入白名单，不能悄悄加入。

### 选读 H：依赖与 lockfile

- 日常安装用 `npm install --ignore-scripts`；干净复现用 `npm ci --ignore-scripts`。默认不运行生命周期脚本，因为它们是供应链攻击的常见入口。
- 依赖元数据变化后，用 `npm install --package-lock-only --ignore-scripts` 刷新 `package-lock.json`。
- pre-commit 钩子会拦截 lockfile 的提交。只有用户明确要求提交 lockfile 时，才设置 `PI_ALLOW_LOCKFILE_CHANGE=1`。
- 升级 `undici` 之前，必须先阅读目标版本的发行说明，评估对功能的影响。

### 选读 I：上游贡献规则（摘要）

以下内容来自仓库的 `CONTRIBUTING.md` 与 `AGENTS.md`，本次没有重新核对原文，以原文件为准。

- 不属于核心的功能应做成扩展。核心要保持小。
- 贡献者要理解自己提交的代码。
- 新贡献者的 issue 与 PR 默认会被自动关闭，直到维护者用 `lgtm` 或 `lgtmi` 批准。`lgtmi` 只对 issue 生效；PR 必须有 `lgtm`。
- 提交 PR 之前，`npm run check` 与 `./test.sh` 都应通过。

### 选读 J：不同测试层能证明什么

| 需求 | faux 与 harness 能否证明 | 更合适的测试层 |
| --- | --- | --- |
| Agent 遇到 `toolUse` 时是否调用工具 | 能 | `packages/coding-agent/test/suite/` |
| 工具参数不合法时是否变成错误结果 | 能 | harness 加 faux |
| 某个供应商的原始停止原因如何映射 | 不能直接证明 | provider 适配器测试（`packages/ai/src/providers/` 下的供应商文件） |
| SSE 数据被网络切分后能否正确解析 | 不能 | SSE 解码器测试，使用受控的分块 |
| 终端的宽字符布局、输入法、按键 | 不能 | `packages/tui` 单元测试或 tmux 交互测试 |
| 某任务在多个模型上的成功率 | 不能 | `packages/evals` |

这张表的作用是防止把"一个集成用例通过"扩大成"整条模型链都正确"。

## 下一篇

进阶包：protocol、client、server、chord、durable、mcp、codemode、telemetry、evals 和 session-backends。下一步讲每个包解决什么问题、核心类型是什么，以及它们与 coding-agent 的关系。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| 测试层 | 按验证对象划分的测试类别，越低越快越确定 | 核心概念 |
| harness | `createHarness` 返回的测试装配对象，内含真实的 `AgentSession` | 核心概念 |
| faux provider | 脚本化的假模型，按先进先出顺序返回预先写好的消息 | 核心概念 |
| 区分力 | 测试在坏实现上失败的能力 | 核心概念 |
| 类型谓词 | `value is X` 形式的返回类型，让编译器把类型收窄为 X | 核心概念 |
| 最后一条正确事件 | 排障时最后一个被确认出现的事件，它后面的缺失环节就是下一层 | 核心概念 |
| 单文件测试 | 只运行一个测试文件的命令，避免全量运行 | 测试分层 |
| 质量门 | `npm run check`，代码改动后必须通过的检查序列 | 可评审的改动 |
| Unreleased 段 | changelog 中尚未发布的条目所在的段落 | 可评审的改动 |
| 共享工作区 | 多个会话同时修改同一目录，因此提交必须使用显式路径 | 可评审的改动 |
| 探针 | 工厂形式的脚本条目，在模型请求发出时运行，读取当时的上下文 | 工厂函数：在请求发出的那一刻取快照 |
| 失败输出 | 断言失败时 vitest 打印的 FAIL 行、期望与实际的 diff 和代码帧 | 完整走一遍：从写文件到读输出 |
| 二分查找提交 | 用 git 在候选提交中逐步减半，找出首次出错的提交 | 用 git 二分缩小回归（只读演示） |
| 症状表 | 把现象映射到层和第一个打开文件的表 | 排障：症状 -> 层 -> 第一个文件 |
