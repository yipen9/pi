# 11. 扩展 pi：模板、技能、扩展、供应商与热重载

> 预计时间：3 小时
> 先修：配置、资源与信任（项目信任与资源加载）

## 本篇你会学到

- 按需求选择最轻的扩展机制：提示词模板、技能、扩展，或自定义供应商。
- 写一个带一个工具的扩展，并用 faux 假模型离线测试它。
- 用 `tool_call` 与 `user_bash` 钩子拦截操作，并遵守"出错时拒绝"的安全规则。
- 用 `/reload` 或 `ctx.reload()` 重新加载扩展，并知道旧实例何时失效。

## 先用一个例子理解

团队有三个需求：

1. 每次代码评审都用同一个格式输出。
2. 发布前要按固定清单检查仓库，清单有十几条，还要读参考文档。
3. 模型要能查询公司内部的工单系统；同时禁止 `rm -rf` 这类危险命令。

如果没有扩展机制，只能靠手工：每次把长提示粘贴给模型；把清单写进系统提示，每次请求都占用上下文；危险命令只能靠用户注意。这三种做法各有问题。

pi 给出四种不同的机制，对应三个需求：

| 需求                     | 机制                     | 为什么是这一种                              |
| ------------------------ | ------------------------ | ------------------------------------------- |
| 固定格式的评审提示       | 提示词模板 (template)    | 只是一段参数化文本，用户手动触发            |
| 发布检查清单与参考文档   | 技能 (skill)             | 多步流程加配套文件，只在需要时加载          |
| 查询工单系统、拦截命令   | 扩展 (extension)         | 必须执行 TypeScript 代码，才能发请求或拦截  |

本篇按"最轻到最重"的顺序讲：先模板，再技能，最后扩展；扩展里再讲工具、钩子、供应商和热重载。

## 核心概念

### 机制从轻到重排序

**定义**：机制的"重量"由两件事决定：是否执行代码，以及影响范围有多大。

**为什么需要**：能用文本解决的问题，不应该写代码。代码要求信任、测试和维护。

```text
文本指令 < 提示词模板 < 技能 < 扩展
轻: 不执行代码，易改易删                  重: 执行代码，拥有进程权限
```

判断顺序可以记成一句话：能用模板解决，就不做技能；能用技能解决，就不写扩展。

### 决策表

| 需求                                   | 选择                    | 理由                                                     | 更重的方案为什么没必要                                 |
| -------------------------------------- | ----------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| 一段固定的评审提示，参数不同           | 提示词模板              | 文本固定，人手动触发                                     | 写扩展要承担代码的信任与维护成本                       |
| 多步检查流程，带脚本或参考文档         | 技能                    | 按需加载，平时不占上下文                                 | 扩展会把说明书和执行逻辑耦合在一起                     |
| 让模型调用外部系统                     | 扩展（工具）            | 需要执行代码和发请求                                     | 模板与技能只能"指导"模型，不能新增能力                 |
| 在工具执行前拦截，或拦截 `!` 命令      | 扩展（`tool_call`、`user_bash`） | 需要在运行时读取事件并返回结果                  | 文本无法阻止执行                                       |
| 提供一个 `/命令`，执行一段逻辑         | 扩展（命令）            | 命令的 handler 运行代码，可以调用 `ctx.ui.notify`        | 模板只会把文本发给模型，不会执行逻辑                   |
| 读取或处理用户的原始输入               | 扩展（`input` 事件）    | 处理器收到原始输入，返回值类型为 `InputEventResult`      | 模板只在用户输入 `/命令` 时展开，不处理普通输入        |
| 会话开始时建立连接或读取配置           | 扩展（`session_start`） | 资源的创建与释放都由事件控制                             | 在工厂函数里初始化会违反生命周期规则，且无法在释放时清理 |
| 接入一个 pi 不支持的模型服务           | 扩展（供应商）          | 需要注册 API 地址、密钥与模型列表                        | 没有内置的办法让 pi 认识新服务                         |
| 跨重载、跨会话保存扩展自己的状态       | 扩展 + `appendEntry`    | 状态写入会话文件，重载后从当前分支恢复                   | 模块顶层的变量不会随会话保存，重载后也会丢失           |
| 同一套资源分给多人                     | Pi 包                   | 把模板、技能、扩展打包发布                               | 分发是最后一步，不是第一步                             |

**怎么读这张表**：从上往下看。第一条能解决需求就停止；只有前一种办法无法满足时，才换成更重的机制。

**小例子**：把"每次评审的格式"写进扩展，是典型的过度设计。它只是一段文本，模板就够了。

### 提示词模板 (prompt template)

**定义**：一个 Markdown 文件，文件名变成 `/命令`，内容变成发给模型的用户消息。

**为什么需要**：同一段话经常要发，只有参数不同。模板让你用 `/review API` 代替复制粘贴。

**创建**：在项目里放 `.pi/prompts/review.md`：

```markdown
---
description: Review staged git changes
argument-hint: "[focus]"
---
Review the staged changes. Focus on ${1:-correctness, security, and error handling}.
```

- `description` 显示在补全菜单里。
- `$1` 是第一个参数；`${1:-默认值}` 表示没有参数时用默认值。
- 输入 `/review API 兼容性` 时，`$1` 被替换为 `API` 之类的单词。

**位置与规则**：

- 用户级目录是 `~/.pi/agent/prompts/`，项目级目录是 `<项目>/.pi/prompts/`。
- 只加载目录下的直接子文件，且扩展名必须是 `.md`。嵌套子目录不会被扫描。
- 项目级模板需要项目信任。未信任的项目不会加载它。
- 修改后执行 `/reload`，或重启 pi。

源码入口是 `packages/coding-agent/src/core/prompt-templates.ts` 中的 `loadPromptTemplates`（目录扫描，只取 `.md` 文件）和 `expandPromptTemplate`（展开 `$1` 等占位符）。

**顺序提醒**：扩展的 `input` 事件先看到原始输入。如果扩展注册了同名命令，扩展命令优先；否则才轮到模板展开。

### 技能 (skill)

**定义**：一个目录加一个 `SKILL.md` 文件。目录里还可以放脚本和参考资料。pi 启动时只把技能的名称和描述放进系统提示；只有任务需要时，模型才读取 `SKILL.md` 的全文。

**为什么需要**：长流程如果放进 `AGENTS.md`，每次请求都要带上。技能让这些内容按需出现。

**创建**：

```text
.pi/skills/release-check/
├── SKILL.md
└── references/
    └── checklist.md
```

`SKILL.md`：

```markdown
---
name: release-check
description: Check a repository before a release. Use when the user asks to prepare, tag, or publish a release.
---

# Release check

1. Run the project's check command and report any failure.
2. Read `references/checklist.md` before writing the report.
```

**规则**（源码在 `packages/coding-agent/src/core/skills.ts`）：

- `name` 最多 64 个字符，`description` 最多 1024 个字符。
- 描述是模型的"路由依据"：要写清做什么，以及什么时候用。"Helps with PDFs." 这种描述太模糊，模型很难选中它。
- 语法错误的 `SKILL.md` 或没有描述的技能不会被加载。
- 技能可以指导模型运行脚本，但技能本身不执行任何代码。脚本只有被模型或用户调用时才运行。
- 项目级技能需要项目信任。

**加载的两个阶段**：

1. 启动时，`loadSkills` 读取每个技能的名称、描述和路径；`formatSkillsForPrompt` 把它们格式化进系统提示。
2. 任务匹配时，模型用 `read` 工具读取 `SKILL.md`，然后按步骤操作。

**强制加载**：用户输入 `/skill:release-check`，可以跳过模型的判断直接加载。这是确定性的入口。

**模板和技能的分界**：模板是"一段话"；技能是"一套流程加附带文件"。提示词超过一屏，或需要引用脚本时，就该升级为技能。

### 扩展 (extension) 与工厂函数

**定义**：扩展是一个 TypeScript 模块，默认导出一个工厂函数。pi 启动时调用这个函数，把它收到的 `ExtensionAPI` 对象用来注册工具、命令和钩子。

**为什么需要**：只有扩展能真正执行代码：发 HTTP 请求、读写文件、拦截工具调用。

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	// 这里只做注册。不要在这里启动进程、定时器或网络连接。
	pi.registerCommand("hello", {
		description: "Show a greeting",
		handler: async (args, ctx) => {
			ctx.ui.notify(`Hello, ${args || "world"}!`, "info");
		},
	});
}
```

**三条生命周期规则**（来自 `packages/coding-agent/docs/extensions.md`）：

- 工厂函数只注册，不做长时间运行的工作。有些调用只加载扩展、不创建会话（例如版本检查），工厂里启动的资源会白白占用进程。
- 长期资源应在 `session_start` 事件里创建，或在真正需要它的命令或工具里创建。
- 在 `session_shutdown` 里释放资源。这个处理器可能被多次调用，所以清理代码必须幂等（重复调用也安全）。

**加载位置**：

- 用户级：`~/.pi/agent/extensions/`。
- 项目级：`<项目>/.pi/extensions/`，需要项目信任。
- 开发时直接加载：`pi --extension ./my-ext.ts`，或 `pi -e ./my-ext.ts`。pi 使用 jiti 即时编译 TypeScript，不需要先 `tsc`。

扩展目录里可以放直接的 `.ts` 或 `.js` 文件，也可以放含 `index.ts` 的子目录。发现逻辑只看一层，不递归。

### 手把手：第一个扩展 hello.ts

**问题**：前面的例子都是片段。这里给出一个完整文件，每一行都在本地运行过。

**例子**：用户想要两件事。第一，在输入框中输入 `/hello Ada`，看到 "Hello, Ada!" 的提示。第二，模型在需要问候时能调用一个 `hello` 工具。两件事都要执行代码，所以必须写成扩展。

完整文件（保存为 `hello.ts`）：

```typescript
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const helloTool = defineTool({
	name: "hello",
	label: "Hello",
	description: "Greet a person by name. Use when the user asks for a greeting.",
	parameters: Type.Object({
		name: Type.String({ description: "Name to greet" }),
	}),

	async execute(_toolCallId, params) {
		return {
			content: [{ type: "text", text: `Hello, ${params.name}!` }],
			details: { greeted: params.name },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(helloTool);

	pi.registerCommand("hello", {
		description: "Show a greeting",
		handler: async (args, ctx) => {
			ctx.ui.notify(`Hello, ${args || "world"}!`, "info");
		},
	});
}
```

**逐段说明**（代码片段，不写行号）：

| 代码 | 作用 |
| --- | --- |
| `import { Type } from "@earendil-works/pi-ai";` | 导入 `Type`，用来描述参数的结构。pi-ai 对 typebox 做了再导出。 |
| `import { defineTool, type ExtensionAPI } ...` | `defineTool` 把工具描述整理成 pi 认识的格式。`ExtensionAPI` 只是类型标注，运行时会被擦除。 |
| `const helloTool = defineTool({` | 定义工具。变量名只在本文件内使用，模型看不到它。 |
| `name: "hello"` | 模型调用工具时使用的名字。 |
| `label: "Hello"` | 界面中显示的名字。 |
| `description: "..."` | 模型据此判断何时调用。写"什么时候用"，不写实现细节。 |
| `parameters: Type.Object({ name: ... })` | 参数是一个对象，必须有字符串字段 `name`。pi 在执行前按它校验模型给出的参数。 |
| `async execute(_toolCallId, params)` | 真正执行的函数。第一个参数是调用 ID，第二个是通过校验的参数。后面的参数（取消信号、进度回调、ctx）这里用不到，所以省略。 |
| `content: [{ type: "text", text: ... }]` | 给模型看的结果，会进入模型上下文。 |
| `details: { greeted: params.name }` | 给界面和程序读取的结构化数据。 |
| `export default function (pi: ExtensionAPI)` | 工厂函数。pi 加载扩展时调用它，并传入 `ExtensionAPI`。 |
| `pi.registerTool(helloTool)` | 把工具交给 pi。 |
| `pi.registerCommand("hello", { ... })` | 注册 `/hello` 命令。`description` 显示在补全列表中。 |
| `handler: async (args, ctx) => { ... }` | 用户输入 `/hello Ada` 时运行。`args` 是命令名后面的文字（这里是 `Ada`）。`ctx.ui.notify` 在界面弹出一条提示。 |

**与 `package_summary` 的区别**：`hello` 不访问文件系统，适合先看懂结构。下面的 `package_summary` 会读文件，并处理"文件不存在"等错误。

**在本地运行的结果**（临时测试，结束后已删除）：

- 模型发出 `hello` 调用，参数为 `{"name":"Ada"}`。工具结果的 content 是 `Hello, Ada!`，isError 为 false，details 为 `{"greeted":"Ada"}`。当前激活的工具为 `read`、`bash`、`edit`、`write`、`hello`。
- 输入 `/hello Ada` 时，界面收到一条通知 `Hello, Ada!`。模型调用次数保持为 2，说明命令没有经过模型。

### 注册一个工具 (registerTool)

**定义**：工具是模型可以调用的本地操作。`defineTool` 用来描述工具，`pi.registerTool` 把它交给 pi。

**为什么需要**：模型只能输出文本。要让它"查工单"，就必须有一个工具让 pi 替它执行请求，再把结果送回模型。

**最小工具**（对照 `packages/coding-agent/examples/extensions/hello.ts`）。这个工具读取当前项目的 `package.json`，返回包名和脚本名。

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const packageSummary = defineTool({
	name: "package_summary",
	label: "Package summary",
	description: "Read package.json in the working directory and report the package name and script names. Read-only.",
	parameters: Type.Object({}),

	async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
		if (signal?.aborted) throw new Error("Operation aborted");

		const file = join(ctx.cwd, "package.json");
		let text: string;
		try {
			text = await readFile(file, "utf8");
		} catch (error) {
			// 抛错会让模型收到 isError 结果，并带上完整路径，便于定位。
			throw new Error(`package.json not found at ${file}: ${String(error)}`);
		}

		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			throw new Error(`Invalid JSON in ${file}`);
		}
		if (typeof data !== "object" || data === null || Array.isArray(data)) {
			throw new Error(`Expected a JSON object in ${file}`);
		}

		const pkg = data as { name?: unknown; scripts?: Record<string, string> };
		const name = typeof pkg.name === "string" ? pkg.name : "(unnamed)";
		const scripts = Object.keys(pkg.scripts ?? {}).slice(0, 20);

		return {
			// content 给模型看；details 给界面和测试读取。
			content: [{ type: "text", text: `${name}; scripts (${scripts.length}): ${scripts.join(", ") || "(none)"}` }],
			details: { file, name, scripts },
		};
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(packageSummary);
}
```

**工具的四个字段**：

| 字段          | 给谁看        | 作用                                                         |
| ------------- | ------------- | ------------------------------------------------------------ |
| `name`        | 模型          | 模型调用时使用的名称，要简短且唯一                           |
| `description` | 模型          | 告诉模型什么时候用这个工具                                   |
| `parameters`  | pi 与模型     | 用 `Type.Object` 描述参数；pi 用它在运行时校验模型的输入     |
| `execute`     | pi            | 真正执行的函数；返回 `content` 与 `details`                  |

**两个结果通道**：

- 抛出异常：模型收到 `isError: true` 的结果，`details` 拿不到。适合"文件不存在"这种普通失败。
- 返回对象：`content` 给模型，`details` 给界面或程序。不要用返回一个普通对象来表示错误，因为 pi 不会把它标记为错误。

**输出大小**：工具的 `content` 会进入模型上下文。输出可能很长时，要自己截断，并把完整内容写到临时文件，在 `content` 里告诉模型路径。内置的 `truncateHead` 可以做截断（见 `packages/coding-agent/examples/extensions/truncated-tool.ts`）。本篇的示例只返回前 20 个脚本名，是同一思路的简单版本。

**`execute` 的第五个参数** `ctx` 的类型是 `ExtensionToolContext`，它能读取 `ctx.cwd`、`ctx.mode`、`ctx.sessionManager`，但没有 `reload` 方法。只有命令里的 `ExtensionCommandContext` 才有 `reload()`，下一节会用到。

### 事件钩子 (tool_call 与 user_bash)

**定义**：钩子 (hook) 是在某个时刻被 pi 调用的函数。`pi.on(事件名, 处理器)` 注册钩子，返回一个取消订阅的函数。

**为什么需要**：工具和命令可以由模型或用户触发。权限检查、审计、脱敏都应在执行前或执行后统一处理，而不是靠每个工具自己检查。

**`tool_call`：执行前拦截**。处理器可以返回 `{ block: true, reason }` 阻止工具执行，也可以直接修改 `event.input`（参数对象）。

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return undefined; // 放行：返回 undefined

		const command = String(event.input.command ?? "");
		if (!/\brm\s+-rf\b/.test(command)) return undefined;

		if (!ctx.hasUI) {
			// 没有界面可以确认时，直接拒绝。
			return { block: true, reason: "rm -rf blocked (no UI to confirm)" };
		}
		const choice = await ctx.ui.select(`Dangerous command:\n\n  ${command}\n\nAllow?`, ["Yes", "No"]);
		if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
		return undefined;
	});
}
```

这个写法参考了 `packages/coding-agent/examples/extensions/permission-gate.ts`，逻辑相同，只是正则更简单。

#### 完整例子：拦截 rm -rf 并观察模型看到的内容

**问题**：模型想执行 `rm -rf build`。拦截必须发生在执行之前；同时模型需要知道被拒绝的原因，才能换一种做法。

**例子**：扩展使用上面 `tool_call` 的代码（实际测试文件内容与之一致）。测试没有绑定界面，所以 `ctx.hasUI` 为 false，走"没有界面，直接拒绝"的分支。

假模型的两次回复：

1. 发起一个 `bash` 调用，参数为 `{"command":"rm -rf build"}`。
2. 读取它收到的上下文，然后回复 `Done.`。

**调用过程**（每一步都能在源码中找到）：

1. 模型返回工具调用。`packages/agent/src/agent-loop.ts` 在执行前调用 `config.beforeToolCall`。
2. `AgentSession._beforeToolCall`（`packages/coding-agent/src/core/agent-session.ts`）先检查 `runner.hasHandlers("tool_call")`，然后调用 `ExtensionRunner.emitToolCall`。
3. `emitToolCall`（`packages/coding-agent/src/core/extensions/runner.ts`）依次运行处理器。`guard` 返回 `{ block: true, reason: "rm -rf blocked (no UI to confirm)" }`。因为 `result.block` 为真，循环立即返回。
4. `agent-loop.ts` 看到 `beforeResult.block`，调用同文件中的 `createErrorToolResult(reason)`。它把 reason 原样放进文本内容，并把 `isError` 设为 true。`bash` 没有执行。
5. 第二次请求时，模型收到的 toolResult 与会话中保存的相同。

**实际结果**（为阅读删去了 `toolCallId` 和时间戳）：

```json
{"role":"toolResult","toolName":"bash","content":[{"type":"text","text":"rm -rf blocked (no UI to confirm)"}],"details":{},"isError":true}
```

调用次数为 2：一次工具调用，一次收尾回复。

**换成有界面的确认**：`ctx.hasUI` 为真时，`ctx.ui.select` 显示 Yes 与 No。选择 No 时 reason 为 `Blocked by user`。这条分支本次未运行（测试没有界面），未在本地验证。

**抛错的情况**：把处理器改为 `throw new Error("policy file missing")`。实际结果是：toolResult 的文本为 `policy file missing`，isError 为 true，命令 `echo hi` 没有输出 `hi`。`emitToolCall` 不捕获异常，`AgentSession._beforeToolCall` 原样抛出，`agent-loop.ts` 再把它转成错误结果。

**为什么返回 block 比抛错更好**：两者都能阻止执行。但抛错时模型看到的是程序内部的异常文字；返回 `block` 时 reason 由你写，可以告诉模型"换一种做法"或"需要用户确认"。例如：`rm -rf is not allowed here; use the clean script instead`（这是写法示例，未在本地运行）。

**`user_bash`：拦截用户输入的 `!` 命令**。用户在交互界面输入 `!ls` 时，pi 先发出 `user_bash` 事件。返回值有三种意义：

| 返回值                    | 结果                                                  |
| ------------------------- | ----------------------------------------------------- |
| `undefined`               | 放行，交给下一个处理器；都放行时由 pi 在本地执行      |
| `{ operations }`          | 接管执行，使用扩展提供的操作实现                      |
| `{ result }`              | 直接给出结果，不执行命令                              |

**源码事实**：`ExtensionRunner.emitUserBash`（位于 `packages/coding-agent/src/core/extensions/runner.ts`）在处理器抛错时会调用 `emitError` 然后重新抛出。也就是说，抛错会阻止这条命令，不会回退到本地执行。

### 失败时的安全规则

**规则**：安全相关的钩子，遇到异常时必须拒绝操作（fail closed），不能放行（fail open）。

**为什么需要**：钩子的目的通常是挡住危险操作。如果钩子的代码出错，而错误被吞掉、然后放行，危险操作就会执行。

**错误写法**（出错时放行）：

```typescript
pi.on("tool_call", async (event) => {
	try {
		const verdict = await checkPolicy(event); // 可能抛错
		if (verdict.deny) return { block: true, reason: verdict.reason };
	} catch {
		return undefined; // 错误：吞掉异常等于放行
	}
	return undefined;
});
```

**正确写法**（出错时拒绝）：

```typescript
pi.on("tool_call", async (event) => {
	try {
		const verdict = await checkPolicy(event);
		if (verdict.deny) return { block: true, reason: verdict.reason };
		return undefined;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { block: true, reason: `policy check failed: ${message}` };
	}
});
```

**源码事实**：

- `ExtensionRunner.emitToolCall` 不捕获处理器的异常。异常传到 `AgentSession` 的 `_beforeToolCall`，该函数重新抛出；如果异常不是 `Error` 对象，会包装成 `Extension failed, blocking execution` 的错误。
- `packages/agent/src/agent-loop.ts` 中，`beforeToolCall` 位于一个 `try` 块内。`catch` 把异常转成 `isError: true` 的错误结果，工具不会执行。也就是说，抛错的效果等同于拒绝。
- 但这条规则不适用于普通的通知类钩子。普通钩子的异常只会记录，不影响主流程。

**小结**：`tool_call` 与 `user_bash` 是拦截点，出错时都应拒绝。普通通知类钩子则只需要记录错误。

### 自定义供应商 (registerProvider)

**定义**：供应商 (provider) 是一组模型加上连接它们的方式（地址、密钥、协议）。`pi.registerProvider` 让扩展把 pi 原本不认识的服务注册成一个新的供应商。

**为什么需要**：公司内部网关，或本地的 OpenAI 兼容服务，都不在 pi 的内置列表里。扩展可以在不修改 pi 源码的情况下接入它们。

**最小形式**（字段来自 `packages/coding-agent/src/core/extensions/types.ts` 的 `ProviderConfig`）：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerProvider("local-gateway", {
		name: "Local gateway",
		baseUrl: "http://localhost:8080/v1",
		apiKey: "$LOCAL_GATEWAY_KEY", // 支持环境变量插值，不要把密钥写进代码
		api: "openai-completions",
		models: [
			{
				id: "demo-model",
				name: "Demo model",
			},
		],
	});
}
```

**字段表**（`ProviderConfig`，定义在 `packages/coding-agent/src/core/extensions/types.ts`）：

| 字段 | 是否必填 | 含义 |
| --- | --- | --- |
| `name` | 否 | 界面中显示的供应商名称。 |
| `baseUrl` | 定义模型时必填 | 请求发往的地址。 |
| `apiKey` | 定义模型时必填（使用 `oauth` 时除外） | 密钥。可以写字面量、`$ENV_VAR`、`${ENV_VAR}`，或以 `!` 开头的命令。 |
| `api` | 供应商级或模型级至少一处必填 | 协议类型（类型为 `Api`），决定请求格式。 |
| `models` | 否 | 模型列表。如果提供，会替换该供应商已有的全部模型。 |
| `models[].id` / `models[].name` | 必填 | `id` 是模型的唯一标识，`name` 用于显示。 |
| `headers` | 否 | 每次请求附加的请求头。 |
| `authHeader` | 否 | 为 true 时加上 `Authorization: Bearer` 头，值为解析后的 API 密钥。 |
| `streamSimple` | 否 | 自定义协议的流式处理器，本篇不展开。 |
| `oauth` | 否 | 让 `/login` 支持该供应商。 |
| `refreshModels` | 否 | 刷新模型列表的函数。 |

**逐字段读上面的例子**：

- `name: "Local gateway"` 只影响界面显示。
- `baseUrl: "http://localhost:8080/v1"` 是请求地址，这里指向本机的 8080 端口。
- `apiKey: "$LOCAL_GATEWAY_KEY"` 表示读取环境变量 `LOCAL_GATEWAY_KEY` 的值，源码中不出现真正的密钥。环境变量未设置时的行为，未在本地验证。
- `api: "openai-completions"` 选择协议。它必须是 pi 认识的协议类型，见 `types.ts` 中的 `ProviderConfig`。
- `models` 列出模型。`id` 用于在 pi 中唯一标识模型，`name` 只用于显示。

**注册后的检查清单**：

1. 确认 `apiKey` 来自环境变量，源码里没有字面量密钥。
2. 确认 `models` 中的 `id` 与服务端的模型名一致。
3. 运行 `pi --list-models` 查看模型列表（输出格式未在本地验证）。

这段注册代码未在本地运行。注册后模型能否出现在模型列表中，未在本地验证。

**规则**：

- 注册可以在工厂里调用。pi 会先把它排队，等绑定到会话后再生效。
- `apiKey` 支持 `$ENV_VAR`、`${ENV_VAR}` 形式，也支持以 `!` 开头的命令。不要把密钥直接写进扩展源码。
- 如果要接入一个全新的协议（不是 OpenAI 或 Anthropic 那样的已知协议），需要提供 `streamSimple` 处理器。这超出本篇范围，源码位置是 `ProviderConfig.streamSimple` 的注释。

**如何验证**：可以用 `pi --list-models` 查看模型列表（未在本地验证输出格式）。更稳妥的方式是读 `ExtensionCommandContext` 或测试里的模型注册表。

### 热重载 (hot reload)

**定义**：热重载是在不退出 pi 的情况下，重新读取扩展、技能、模板、主题和上下文文件。

**三种触发方式**：

1. 交互界面输入 `/reload`（内置命令，见 `packages/coding-agent/src/core/slash-commands.ts`）。
2. 扩展命令里调用 `await ctx.reload()`。这个方法只存在于 `ExtensionCommandContext`。
3. 工具里不能直接调用 reload。工具拿到的是 `ExtensionToolContext`，没有 `reload` 方法。变通办法是用 `pi.sendUserMessage("/reload", { deliverAs: "followUp" })` 把 `/reload` 排到后续队列，由命令上下文执行。

**示例**（对照 `packages/coding-agent/examples/extensions/reload-runtime.ts`）：

```typescript
export default function (pi: ExtensionAPI) {
	pi.registerCommand("reload-runtime", {
		description: "Reload extensions, skills, prompts, themes, and context files",
		handler: async (_args, ctx) => {
			await ctx.reload();
			// reload 之后，旧扩展实例已经失效，这里不要再读写旧状态。
		},
	});
}
```

**热重载时序**

**问题**：你改了扩展的代码，不想退出 pi。pi 必须先让旧扩展停止，再加载新扩展。如果顺序乱了，旧扩展可能还在写文件，新扩展却已经开始读同一个文件。

`AgentSession.reload` 的源码顺序如下（`packages/coding-agent/src/core/agent-session.ts`）：

1. 向旧运行器发出 `session_shutdown`，`reason` 为 `"reload"`。只有旧运行器注册过这个事件的处理器时才会发出（`emitSessionShutdownEvent`）。
2. 调用旧运行器的 `invalidate()`。它记下失效原因，之后旧的 `pi` 与 ctx 调用时会报错。运行时还会取消 `pi.events.on()` 留下的订阅（见 `packages/coding-agent/src/core/extensions/loader.ts`）。
3. 重新读取设置，重置供应商，然后调用 `resourceLoader.reload()` 重新加载扩展文件。
4. 调用 `_buildRuntime`。它创建新的 `ExtensionRunner`，并把 `_extensionRunnerRef.current` 指向它。此后 `_beforeToolCall` 读取的是新运行器。
5. 只有存在绑定时才继续。绑定指 UI 上下文、命令动作、关闭处理器、错误监听器中至少一个。满足时，向新运行器发出 `session_start`，`reason` 为 `"reload"`，然后调用 `extendResourcesFromExtensions("reload")`。

**实际运行的事件顺序**（临时测试，结束后已删除）：

- 已绑定 UI（`bindExtensions({ uiContext })`）：`factory`，`session_start:startup`，`--- reload`，`session_shutdown:reload`，`session_start:reload`。
- 未绑定：`factory`，`--- reload`，`session_shutdown:reload`。没有第二次 `session_start`。

说明：

- `session_start:startup` 来自 `bindExtensions`，它在 `agent-session.ts` 中发出 `_sessionStartEvent`。
- 未绑定时没有 `session_start:reload`，因为 `reload` 中的 `hasBindings` 为假（条件见上面第 5 步）。
- 测试中的扩展列表是固定的，reload 时工厂没有再次执行（输出中只有一个 `factory`）。真实 reload 会调用 `resourceLoader.reload()`，工厂是否重新执行，这一点来自源码阅读，未在本地验证。
- 旧 `pi` 对象调用 `getActiveTools()` 时抛出错误，错误内容以 `This extension ctx is stale after session replacement or reload.` 开头。

**写扩展时的规则**：

- 状态放在会话条目（`appendEntry`）或 `session_start` 创建的资源中，不放在模块顶层的变量里。
- 定时器、子进程、网络连接在 `session_shutdown` 中释放，并且清理函数要能重复调用。
- reload 之后不要再使用旧的 `pi` 或 ctx。

**旧实例何时失效**：

1. pi 对旧扩展发出 `session_shutdown` 事件，`reason` 为 `"reload"`。
2. 旧运行时被标记为失效。之后仍被捕获在闭包里的旧 `pi` 对象调用动作方法会抛出 stale 错误。
3. pi 重新加载扩展，并对新实例发出 `session_start`，`reason` 为 `"reload"`。

`session_start` 与 `session_shutdown` 的 `reason` 字段在 `types.ts` 里分别是 `"startup" | "reload" | "new" | "resume" | "fork"` 和 `"quit" | "reload" | "new" | "resume" | "fork"`。

**状态恢复的规则**：扩展自己的状态不要放在模块级变量里，因为 reload 之后模块会重新执行。需要跨会话保存的状态，用 `pi.appendEntry` 写入会话文件，然后在 `session_start` 里从 `ctx.sessionManager.getBranch()` 恢复。`getBranch()` 只返回当前分支，避免把放弃的分支也合并进来。

**泄漏检查**：`pi.on()` 注册的处理器属于它所在的那个扩展实例。reload 之后，`_buildRuntime` 用新扩展创建新运行器，`_beforeToolCall` 读取的是新运行器，所以旧处理器不会再被调用，不需要手动取消订阅。`pi.events.on()` 的订阅由运行时在 `invalidate` 时自动取消（见 `loader.ts`）。不会自动释放的是定时器、子进程和网络连接，它们必须在 `session_shutdown` 中清理。

### 用 faux 离线测试扩展

**定义**：faux 是一个脚本化的假模型。测试时可以预先设定它每一步的回复，包括要求调用某个工具。

**为什么需要**：测试扩展不应该调用真实模型。真实模型慢、花钱，而且输出不稳定。

**测试骨架**（示例代码，未在本地运行）：

```typescript
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./harness.ts";
import packageSummaryExtension from "./task-11-extension.ts";

describe("package_summary", () => {
	let h: Harness | undefined;
	afterEach(() => h?.cleanup());

	it("returns the package name through a tool call", async () => {
		h = await createHarness({ extensionFactories: [packageSummaryExtension] });
		await h.session.bindExtensions({});
		h.setResponses([
			fauxAssistantMessage([fauxToolCall("package_summary", {})]),
			fauxAssistantMessage("Done."),
		]);
		// 此处应补充：在 h.tempDir 下写入 package.json，向会话发送一条提示，
		// 然后断言 h.faux.state.callCount === 2，且工具结果文本包含包名。
		// 具体的发送方法名未在本篇核对，写作时需按 AgentSession 的公开方法补全。
	});
});
```

要点：

- `createHarness` 是异步函数，必须 `await`。它返回的 `Harness` 中，`session` 是 `AgentSession`，`faux` 是假模型句柄，`tempDir` 是临时目录，`cleanup()` 用于删除临时目录。
- `h.session.bindExtensions({})` 把扩展与会话绑定。参数对象里的所有字段都是可选的，所以传 `{}` 可以。
- `fauxAssistantMessage` 与 `fauxToolCall` 来自 `@earendil-works/pi-ai`，定义在 `packages/ai/src/providers/faux.ts`。

上面骨架中的断言是占位。下面的写法与本地运行通过的临时测试步骤相同（临时文件已删除）。其中的 `expect` 行没有单独运行，以下面的说明为准：

```typescript
import { expect, it } from "vitest";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createHarness, createTestUiContext, getToolResult } from "./harness.ts";
import helloExtension from "./hello.ts"; // 指向上面的 hello.ts

it("greets through the hello tool", async () => {
	const h = await createHarness({ extensionFactories: [helloExtension] });
	await h.session.bindExtensions({ uiContext: createTestUiContext() });
	h.setResponses([
		fauxAssistantMessage([fauxToolCall("hello", { name: "Ada" })]),
		fauxAssistantMessage("Done."),
	]);
	await h.session.prompt("greet Ada");
	expect(getToolResult(h, "hello").content).toEqual([{ type: "text", text: "Hello, Ada!" }]);
	expect(h.faux.state.callCount).toBe(2);
	h.cleanup();
});
```

- `createHarness` 是异步函数，必须 `await`。
- `bindExtensions({ uiContext })` 绑定界面。本地运行中，`/hello` 命令的通知就是通过这个 uiContext 收到的。
- `h.cleanup()` 删除临时目录。正式测试中应放在 `afterEach` 里调用。

## 源码导览

| 顺序 | 文件路径（相对仓库根）                                         | 符号                                           | 读的时候关注什么                                                       |
| ---- | -------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| 1    | `packages/coding-agent/src/core/prompt-templates.ts`           | `loadPromptTemplates`, `expandPromptTemplate`  | 只扫描直接子文件 `.md`；占位符替换发生在哪里                           |
| 2    | `packages/coding-agent/src/core/skills.ts`                     | `loadSkills`, `loadSkillsFromDir`, `formatSkillsForPrompt` | 名称与描述的长度限制；启动时进入系统提示的只有名称、描述和路径 |
| 3    | `packages/coding-agent/src/core/extensions/types.ts`           | `ExtensionAPI`, `ExtensionContext`, `ExtensionCommandContext`, `defineTool` | `on()` 的重载；`getContextUsage()` 在 `ExtensionContext` 上；`reload()` 只在命令上下文 |
| 4    | `packages/coding-agent/src/core/extensions/types.ts`           | `ToolCallEventResult`, `UserBashEventResult`, `ProviderConfig` | `block` 与 `reason` 字段；`user_bash` 的返回值形状；供应商配置字段     |
| 5    | `packages/coding-agent/src/core/extensions/loader.ts`          | `discoverAndLoadExtensions`, `loadExtensionsCached` | 发现顺序：项目、全局、显式配置；单个扩展失败不阻止其他扩展加载          |
| 6    | `packages/coding-agent/src/core/extensions/runner.ts`          | `ExtensionRunner`, `emitToolCall`, `emitUserBash` | 哪个钩子抛错会阻止操作；`block` 为真时立即返回                         |
| 7    | `packages/coding-agent/src/core/agent-session.ts`              | `bindExtensions`, `ExtensionBindings`, `_beforeToolCall` | 绑定动作发生在哪里；工具执行前的异常如何传播                           |
| 8    | `packages/coding-agent/src/core/slash-commands.ts`             | 内置命令表中的 `reload`                        | `/reload` 的描述文字                                                   |
| 9    | `packages/coding-agent/test/suite/harness.ts`                  | `createHarness`, `Harness`                     | `faux`、`session`、`tempDir`、`cleanup` 的含义                         |
| 10   | `packages/coding-agent/examples/extensions/hello.ts`           | 默认导出工厂                                   | 最小的 `defineTool` 与 `registerTool` 组合                             |
| 11   | `packages/coding-agent/examples/extensions/permission-gate.ts` | 默认导出工厂，`tool_call` 处理器               | 没有界面时默认拒绝                                                     |
| 12   | `packages/coding-agent/examples/extensions/reload-runtime.ts`  | `reload-runtime` 命令与工具                    | 命令才能调用 `ctx.reload()`；工具通过 `sendUserMessage` 排队           |
| 13   | `packages/ai/src/providers/faux.ts`                            | `fauxAssistantMessage`, `fauxToolCall`, `fauxProvider` | 假模型的脚本化回复与调用计数                                           |
| 14   | `packages/ai/src/index.ts`                                     | 对 `typebox` 的再导出 `Type`                   | 工具参数 schema 应从 `@earendil-works/pi-ai` 导入 `Type`               |

## 走读一次完整过程

以"用户输入 `/reload`，然后模型调用 `package_summary`"为例。

1. **启动时发现资源。** pi 调用 `discoverAndLoadExtensions`（`loader.ts`），依次扫描项目级 `.pi/extensions/`、用户级 `~/.pi/agent/extensions/` 和显式配置的路径。发现的文件被逐个加载。
2. **调用工厂。** 对每个扩展，pi 执行默认导出的工厂函数，传入 `ExtensionAPI`。工厂里的 `registerTool`、`registerCommand`、`on` 把注册项写入这个扩展的记录中。
3. **绑定会话。** `AgentSession.bindExtensions`（`agent-session.ts`）把 UI 上下文、模式和命令动作交给运行器。工具随后进入会话的工具列表。
4. **模型请求工具调用。** 假模型或真实模型返回一个 `package_summary` 调用。pi 在执行前调用 `_beforeToolCall`，它进一步调用 `ExtensionRunner.emitToolCall`。
5. **钩子决定是否执行。** 如果没有处理器返回 `block: true`，工具继续执行。如果有处理器抛错，异常向上传播，工具不会执行。
6. **执行工具。** `execute` 读取 `ctx.cwd/package.json`，返回 `content`（给模型）和 `details`（给界面）。
7. **用户输入 `/reload`。** pi 识别它是内置命令，调用重载流程。
8. **旧实例失效。** pi 对旧运行器发出 `session_shutdown`（`reason: "reload"`），然后将旧运行器标记为失效。之后闭包里的旧 `pi` 调用会抛出 stale 错误。
9. **新实例启动。** pi 重新执行工厂，得到新的注册项，对新运行器发出 `session_start`（`reason: "reload"`）。
10. **确认结果。** 新的 `package_summary` 工具可用；旧的事件处理器已被取消订阅，不会被重复调用。

**验证范围**：步骤 8 和步骤 9 的事件顺序已用测试 harness 运行验证，见上文"热重载时序"。harness 不会再次执行工厂函数，所以"真实 reload 时工厂重新执行"仍是源码推断，未在本地验证。

## 动手实验

以下实验都不需要模型，也不需要密钥。实验文件放在系统临时目录，结束后删除。

**注意**：本篇的实验描述和预期输出均依据源码推断，**未在本地运行**。运行结果以你自己的环境为准。

### 实验 1：模板展开（5 分钟）

目的：确认模板的文件位置和占位符替换。

PowerShell：

```powershell
$root = Join-Path $env:TEMP "pi-task11-lab1"
New-Item -ItemType Directory -Force "$root/.pi/prompts" | Out-Null
@'
---
description: Review staged git changes
argument-hint: "[focus]"
---
Review the staged changes. Focus on ${1:-correctness, security, and error handling}.
'@ | Set-Content -Encoding utf8 "$root/.pi/prompts/review.md"
Get-ChildItem "$root/.pi/prompts"
Remove-Item -Recurse -Force $root
```

bash：

```bash
root=$(mktemp -d)
mkdir -p "$root/.pi/prompts"
cat > "$root/.pi/prompts/review.md" <<'EOF'
---
description: Review staged git changes
argument-hint: "[focus]"
---
Review the staged changes. Focus on ${1:-correctness, security, and error handling}.
EOF
ls "$root/.pi/prompts"
rm -rf "$root"
```

预期：目录中只有一个文件 `review.md`。在交互界面中输入 `/review API` 时，`$1` 被替换为 `API`；不带参数时，使用默认值（未在本地验证）。

### 实验 2：技能发现的前提（5 分钟）

目的：理解技能必须有描述才会被加载。

创建两个技能目录：`good-skill`（有 `description`）和 `bad-skill`（没有 `description`）。两者都有 `SKILL.md`。

预期：根据 `skills.ts` 的规则，`bad-skill` 不会出现在系统提示的技能列表里，并会出现在诊断信息中（未在本地验证）。

### 实验 3：运行一个已有的 faux 套件测试（10 分钟）

目的：确认 `createHarness` 与 faux 的离线测试方式可以正常工作。这是本篇唯一真正运行的命令，用的是仓库里已有的测试文件，不创建新文件。

工作目录：`packages/coding-agent`。

PowerShell 与 bash 命令相同：

```bash
node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-boundaries.test.ts
```

本篇撰写时的真实输出（工作目录 `packages/coding-agent`，已运行）：

```text
 RUN  v4.1.11 D:/Github/pi/packages/coding-agent
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

你的运行时间和路径会不同，但"1 passed"与"29 passed"应当一致。

### 实验 4：离线运行 hello 扩展并读取结果（约 15 分钟）

**目的**：用 faux 假模型运行 `hello` 扩展，确认工具结果。全程不调用真实模型。

**步骤**：

1. 在 `packages/coding-agent/test/suite/` 下建两个临时文件：`hello.ts`（内容与上文"手把手：第一个扩展"一节相同）和 `tmp-lab.test.ts`（内容为上文"用 faux 离线测试扩展"中的 `greets through the hello tool` 写法，`helloExtension` 指向 `./hello.ts`）。
2. 工作目录设为 `packages/coding-agent`，运行测试文件。

bash：

```bash
node ../../node_modules/vitest/dist/cli.js --run test/suite/tmp-lab.test.ts
```

PowerShell（未在本地验证）：

```powershell
node ..\..\node_modules\vitest\dist\cli.js --run test/suite/tmp-lab.test.ts
```

3. 测试结束后删除这两个临时文件。

**预期输出**（本地运行的是 5 个用例的同一个文件；只有 1 个用例的情况未在本地验证）：

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

**注意**：本仓库中 vitest 没有显示测试里 `console.log` 的输出，只显示计数。需要看中间结果时，像本篇的临时测试那样把内容写入临时文件，或者用 `expect` 断言。

**读结果时看三个字段**：

- `isError`：为 true 时，模型收到的是错误结果。
- `content`：模型看到的文字。
- `details`：界面和测试读取的结构化数据，不进入模型上下文。

**没有输出或结果不对时的排查**：

- 我们把临时测试文件直接放在 `test/` 下时，vitest 报告 `No test files found`；放在 `test/suite/` 下则正常运行。原因未在本地验证。
- 忘记 `await createHarness(...)`：拿到的是 Promise，`h.session` 为 undefined。
- `h.faux.state.callCount` 统计模型被调用的次数。一次工具调用加一次收尾回复，结果为 2。

## 自测题

1. 按"从轻到重"排列文本指令、提示词模板、技能和扩展。说明为什么扩展是唯一会"加载即执行代码"的机制。
2. 团队想要一个"发布前检查清单"，清单有十几条，还要读参考文档。应选哪种机制？为什么不用扩展？
3. `tool_call` 处理器抛出异常时，工具会不会执行？如果你想让"规则检查失败"也拒绝操作，应该怎样写？
4. `ctx.reload()` 为什么只能在命令中调用？工具想触发重载，应该怎么做？
5. 扩展的工厂函数里为什么不应启动长期运行的定时器？长期资源应放在哪个事件里创建和释放？

## 常见错误

| 现象                                         | 原因                                                    | 解决                                                                   |
| -------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| 模板在补全列表中不出现                       | 放在了子目录里，或扩展名不是 `.md`，或项目未信任        | 把文件放在 `prompts/` 的直接子目录；检查项目信任；执行 `/reload`        |
| 技能从不被模型使用                           | `description` 太模糊，没有写"什么时候用"                | 改写描述，写清做什么和什么时候用；或用 `/skill:名称` 强制加载          |
| 修改扩展后仍是旧行为                         | 没有执行 `/reload`，或扩展在模块级缓存了状态            | 执行 `/reload`；把状态放进会话条目（`appendEntry`）                    |
| 重载后定时器或子进程仍在运行，输出重复 | 在工厂函数或模块顶层启动了资源，`session_shutdown` 没有释放它 | 在 `session_start` 中创建资源，在 `session_shutdown` 中释放，清理函数要能重复调用 |
| 危险命令在没有界面时被执行                   | 钩子在 `catch` 中返回 `undefined`，即出错时放行         | 出错时返回 `{ block: true, reason }`；没有界面时默认拒绝               |

## 选读：源码深入（跳过不影响主线）

> 选读内容超出本篇主线。读完主线后再看。

### 选读 A：加载器如何隔离失败

`loadExtension`（`packages/coding-agent/src/core/extensions/loader.ts`）把单个扩展的加载失败转换成错误记录，而不是抛出异常。调用方 `loadExtensionsInternal` 把错误放进 `errors` 数组，然后继续加载下一个路径。因此，一个扩展语法错误不会阻止其他扩展加载。

两种错误文字代表不同的失败位置：

- `Extension does not export a valid factory function`：模块加载成功，但默认导出不是函数。最常见的原因是忘记 `export default`。
- `Failed to load extension: ...`：导入或工厂执行时抛出异常。

这个隔离只包围单个路径的加载。发现阶段（读取目录、读取设置）的错误可能仍会向上抛出。

### 选读 B：工厂的 pending 与 commit

`createExtensionAPI` 为每个扩展维护一个三态：`loading`、`active`、`failed`。

- 工厂执行期间，`registerTool`、`registerCommand` 等写入尚未对外可见的扩展对象。
- `registerFlag` 的默认值、`registerProvider` 的变更，以及运行时层面的修改，先放进待提交队列（pending）。
- 工厂成功后调用 `commit()`，按注册顺序应用待提交的变更。
- 工厂抛错时调用 `discard()`，丢弃待提交的变更，并把 API 标记为 `failed`。之后再通过捕获的旧 `pi` 调用任何方法，都会抛出带扩展路径的错误。

这是"小事务"，不是数据库事务。如果某个待提交变更在应用过程中抛错，前面已经应用的变更不会自动回滚。另外，工厂里直接写的文件或全局变量，`discard()` 无法撤销。

### 选读 C：缓存只缓存工厂，不缓存实例

`loadExtensionsCached` 使用模块级的 `extensionCache`，键是扩展路径，值是工厂函数。缓存带有 `cwd` 和 `generation` 两个检查：切换工作目录或调用 `clearExtensionCache()` 会让旧缓存失效；正在进行的旧加载在完成时不会把结果写回新的缓存代际。

缓存命中后，pi 仍然会重新执行工厂，并创建新的 `Extension` 对象和新的运行时。也就是说，缓存只省去了模块导入的时间，不会让工厂只执行一次。

`ResourceLoader.reload()` 在已经加载过的情况下会先调用 `clearExtensionCache()`，因此 reload 能看到磁盘上的修改。

### 选读 D：事件总线订阅与 runtime 失效

扩展里有两种看起来相似的订阅：

1. `pi.on(事件名, 处理器)`：注册在扩展的 `handlers` 表里，由 `ExtensionRunner` 派发。
2. `pi.events.on(频道, 处理器)`：直接订阅 `EventBus`，由扩展之间通信使用。

`ExtensionRuntime` 会记录 `pi.events.on` 的取消函数。runtime 失效时统一调用这些函数，因此 reload 后扩展的事件总线监听器会被释放，而宿主自己的监听器不受影响。

任意 `setTimeout`、`setInterval`、子进程和网络连接都不在这个机制里，扩展必须自己在 `session_shutdown` 中释放。

### 选读 E：`emitMessageEnd` 的角色校验

`message_end` 事件允许扩展替换已经定稿的消息。`ExtensionRunner.emitMessageEnd` 会检查替换后的消息角色是否与原消息相同。角色不同的替换会被拒绝，并记录错误，然后继续派发给下一个处理器。这个检查来自源码阅读，本篇没有在本地运行验证。

### 选读 F：`resolveToolRenderers` 的链式决议

`registerToolRenderer` 注册的决议器会被组成一条链。每个决议器收到 `next()`，调用它会得到后续决议器的结果，最后是工具自身的渲染器。因此 `next() ?? mine` 的意思是"如果别人已经提供了渲染器就用别人的，否则用我的"。这适合给 MCP 等尚未注册的工具补充渲染，而不会覆盖已有渲染器。

## 下一篇

下一步是 SDK 与进程级协议：如何把 pi 当作库在自己的 Node 程序里创建会话，以及 `print`、`json`、`rpc` 三种模式各自的输入输出格式。

## 术语小结

| 术语                     | 一句话定义                                                           | 首次出现的小节       |
| ------------------------ | -------------------------------------------------------------------- | -------------------- |
| 提示词模板 (prompt template) | 一个 Markdown 文件，展开成一条用户消息，文件名即 `/命令`           | 提示词模板           |
| 技能 (skill)             | 一个含 `SKILL.md` 的目录，名称与描述启动时加入提示，全文按需读取    | 技能                 |
| 扩展 (extension)         | 默认导出工厂函数的 TypeScript 模块，可注册工具、命令和钩子          | 扩展与工厂函数       |
| 工厂函数 (factory)       | 扩展默认导出的函数，接收 `ExtensionAPI` 并进行注册                 | 扩展与工厂函数       |
| 工具 (tool)              | 模型可以调用的本地操作，由 `defineTool` 描述                        | 注册一个工具         |
| 参数 schema              | 用 `Type.Object` 描述的参数结构，pi 用它校验模型输入                | 注册一个工具         |
| 钩子 (hook)              | 在特定事件发生时被调用的处理器，由 `pi.on` 注册                    | 事件钩子             |
| `block` 结果             | `tool_call` 处理器返回的 `{ block: true, reason }`，阻止工具执行    | 事件钩子             |
| fail closed              | 安全钩子出错时拒绝操作的策略                                        | 失败时的安全规则     |
| 供应商 (provider)        | 一组模型加上连接方式（地址、密钥、协议）                           | 自定义供应商         |
| faux 假模型              | 可脚本化回复的离线模型，用于测试                                    | 用 faux 离线测试扩展 |
| 热重载 (hot reload)      | 不退出 pi，重新加载扩展、技能、模板等资源                          | 热重载               |
| 运行时失效 (invalidate)  | 重载后让旧扩展实例的动作方法抛出 stale 错误                        | 热重载               |
| `session_start` 事件     | 会话或扩展实例开始时触发，`reason` 指明原因（如 `reload`）         | 热重载               |
| `session_shutdown` 事件  | 会话或扩展实例结束时触发，用于释放资源；可能被多次触发            | 热重载               |
| 热重载时序 | 重载时事件的固定顺序：旧运行器先发出 shutdown，再创建新运行器并发出 start | 热重载 |
| ProviderConfig | `pi.registerProvider` 接受的配置对象，字段见自定义供应商一节的字段表 | 自定义供应商 |

## 验证记录

- 本文件由阅读源码生成，未修改任何源码或测试文件。
- 已对照源码核对：`ExtensionAPI.on` 重载在 `packages/coding-agent/src/core/extensions/types.ts` 中共 41 处；`ExtensionContext.getContextUsage()`；`ExtensionCommandContext.reload()`；`session_start` 与 `session_shutdown` 的 `reason` 取值；`ToolCallEventResult.block`；`ProviderConfig` 字段；`packages/ai/src/index.ts` 对 `Type` 的再导出；`createHarness` 为异步函数，返回 `session`、`faux`、`tempDir`、`cleanup`。
- 运行命令：`node ../../node_modules/vitest/dist/cli.js --run test/suite/agent-session-boundaries.test.ts`（工作目录 `packages/coding-agent`），结果 1 个文件、29 个用例全部通过，使用 faux 假模型。
- 已核对 `agent-loop.ts` 中 `beforeToolCall` 异常被转换为 `isError` 结果的路径。
- 已核对 `ProviderModelConfigBase` 的必填字段 `id`、`name`，以及 `ProviderConfig` 的 `baseUrl`、`apiKey`、`api`、`models` 字段。
- 已核对 `sendUserMessage` 的 `deliverAs` 取值为 `"steer" | "followUp"`；`ReadonlySessionManager` 包含 `getBranch`。
- 实验 1 与实验 2 仍未在本地运行，正文中已标注。热重载的事件顺序与 faux 扩展测试已用临时文件运行，5 个用例全部通过，临时文件已删除。
