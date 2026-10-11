# 16. 毕业项目：只读 inspect_package 扩展

> 预计时间：4–6 小时（建议分两次完成，每次 2–3 小时）
> 先修：本系列前面各篇讲过的内容（TypeScript 基础、请求旅程、消息与事件、工具、AgentSession、测试）。选读内容不是必需。

## 如何使用本篇

本篇是一个完整的小项目，不是阅读材料。你要写两个文件，跑一次单文件测试，并写出一份别人能评审的说明。

- 建议分两次完成，每次 2–3 小时。第一次完成扩展和第一个测试；第二次完成边界、错误和说明。
- 每一步都要留下证据：一条命令、一段输出、或一个文件路径。没有证据的步骤不算完成。
- 遇到卡住的情况，先看下文"卡住时怎么办"，再回到对应的步骤。

## 本篇你会学到

- 用扩展机制写一个只读工具 `inspect_package`，并把它注册到 pi 的工具表里。
- 用 faux 假模型在离线测试里跑通一次完整的"模型提出工具调用 → 工具执行 → 模型给出回答"循环。
- 写出一份评审者能判断的变更说明：问题、固定输入、处理规则、失败路径、尚未覆盖的情况。

## 先用一个例子理解

用户输入："看看 `packages/coding-agent/package.json` 里有哪些脚本，依赖有几个。"

没有工具时，模型只能猜，或者请用户把文件粘贴进来。模型不能直接读你的硬盘。

有工具时，流程如下：

1. 模型回复一个工具调用：`inspect_package({"directory":"packages/coding-agent"})`。
2. pi 在本地执行这个工具，读出文件并整理成短文本。
3. 工具结果作为一条新消息回到对话。
4. 模型再请求一次，这次根据工具结果给出回答。

这里有两个安全问题，本篇的边界规则就是为它们准备的：

- 模型可能发出 `{"directory":"../../.."}`，读到仓库外的文件（例如用户主目录里的配置文件）。
- 仓库里可能有一个符号链接（symbolic link，即"指向另一个位置的快捷方式"）。它的名字在仓库内，实际指向仓库外。只看字符串路径检查不出来。

所以本篇的工具必须做两件事：先用字符串判断路径位置，再用 `realpath` 找出真实位置后重新判断。

## 核心概念

**1. 扩展（extension）**：一个导出工厂函数的 TypeScript 模块。pi 启动时调用这个函数，函数内可以注册工具、命令等。

- 为什么需要：pi 本身不知道你的团队要什么工具。扩展让你在不改 pi 源码的前提下加入新能力。
- 小例子：`packages/coding-agent/examples/extensions/hello.ts` 导出一个函数，在里面调用 `pi.registerTool(...)` 注册 `hello` 工具。

**2. 工具（tool）**：模型可以请求执行的本地函数。一个工具由三部分组成：名字（`name`）、参数形状（`parameters`）、执行函数（`execute`）。pi 提供 `defineTool` 来创建它。

- 为什么需要：模型只能输出文字，不能直接读文件。工具把"读文件"变成模型可以请求、pi 可以执行的动作。
- 小例子：模型请求 `hello({"name":"Ada"})`，pi 调用 `execute`，返回文字 `Hello, Ada!`。

**3. 参数 schema 与 TypeBox**：schema 是"参数应该长什么样"的描述。TypeBox（包内导出名 `Type`）用来写 schema，例如 `Type.Optional(Type.String())` 表示"可以不传的字符串"。pi 会在调用 `execute` 前用它校验模型给出的参数。

- 为什么需要：模型给出的参数可能缺字段或类型错误。校验在执行前完成，`execute` 拿到的参数已经符合形状。
- 小例子：`directory` 传成数字 `42` 时，校验失败，`execute` 不会运行。（这是 pi 的校验行为；本篇未在本地运行这个例子。）

**4. 路径边界（path boundary）**：判断一个目标路径是否仍在根目录内的规则。本篇有两层：字符串层（`path.relative`）和真实路径层（`realpath`）。

- 为什么需要：工具会把模型给的路径变成真实的文件读取。没有边界，模型就能读到任何可访问的文件。
- 小例子：根为 `workspace-demo`，`..\outside` 被拒绝，`..foo` 允许（见下文的表）。

**5. 错误结果（error result）**：工具失败时返回一个带 `isError: true` 的结果，模型能看到错误文字并据此回答。它不是让整个运行崩溃。

- 为什么需要：一次文件缺失不应该让整个对话失败。模型收到错误后可以告诉用户"没有找到文件"。
- 小例子：`package.json` 不存在时，工具结果是 `isError: true` 加一句错误文字，模型的下一条回复可以解释这件事。
- 源码依据：`packages/agent/src/types.ts` 中 `execute` 的注释写明"抛出错误，或返回带 `isError: true` 的结果"。`packages/agent/src/agent-loop.ts` 把抛出的错误转成 `isError: true` 的工具结果。

**6. 离线测试（offline test）与 faux 假模型**：测试用 `createHarness` 建立一个临时会话，模型用 faux（脚本化的假模型）按预设顺序回复。整个测试不联网、不需要密钥。

- 为什么需要：真实模型不稳定、要花钱、需要密钥。测试要稳定、免费、可重复。
- 小例子：`setResponses([第一条回复请求工具, 第二条回复给文字])`，测试每次得到同样的两步。

## 路径边界规则：先看五个例子

规则只检查字符串形状，不检查文件是否存在。核心代码（完整版见后文"实现规格"）：

```typescript
import { isAbsolute, relative, resolve, sep } from "node:path";

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target); // 从根走到目标的相对路径
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
```

三种越界形状都要拒绝：

| 形状 | 例子（根为 `workspace-demo`） | `relative` 的结果 | 结论 |
| --- | --- | --- | --- |
| 子目录 | `workspace-demo/sub/pkg` | `sub\pkg` | 允许 |
| 上一级 | `workspace-demo/../outside` | `..\outside` | 拒绝：以 `..` 加分隔符开头 |
| 名字以 `..` 开头但不是上一级 | `workspace-demo/..foo` | `..foo` | 允许：这只是普通目录名 |
| 不同盘符（Windows） | `E:\secret` | `E:\secret` | 拒绝：结果仍是绝对路径 |
| 根本身 | `workspace-demo` | 空字符串 | 允许 |

这张表的重点有两条：

- 不能写 `rel.startsWith("..")`。它会把 `..foo` 误判为越界。正确做法是精确比较 `..` 和 `..` 加分隔符。
- Windows 的分隔符是 `\`，所以检查的是 `..\`；在 Linux/macOS 上分隔符是 `/`，检查的是 `../`。代码用 `sep` 来适配两者。

Windows 跨盘符的情况要单独理解。如果根在 `D:\` 下，目标在 `E:\`，`path.relative` 无法给出相对路径，只能返回目标本身的绝对路径。`isAbsolute` 因此能捕获它。

## 真实路径检查：为什么字符串检查不够

字符串检查只看路径怎么写，不看它指向哪里。流程如下：

```text
输入 directory = "link-to-outside"
字符串检查：workspace-demo/link-to-outside 在根内，通过
realpath：真实位置是 C:\Users\me\secret，不在根内
结论：必须拒绝
```

所以本篇的规则是：

1. 对根目录 `ctx.cwd` 调用 `realpath`，得到真实根。
2. 对目标目录 `target` 调用 `realpath`，得到真实目标目录。
3. 对 `target/package.json` 调用 `realpath`，得到真实文件位置。
4. 把 2 和 3 分别和真实根比较；任何一个越界就拒绝。

`realpath` 要求路径存在。目标不存在时它会抛出错误，所以代码必须先把"不存在"转换成本篇规定的错误文字，而不能让系统原始错误直接出现。

### 完整示例：逐条输入的结果

下面的例子把"字符串检查 + realpath 检查"的结果逐条列出。它来自一个临时目录里的固定夹具（fixture，即测试用的固定文件）：

- 根目录 `workspace-demo/`，里面有 `pkg/`（合法的 `package.json`，`name` 为 `demo`）、`broken/`（内容 `{`）、`list/`（内容 `[]`）、`empty/`（没有 `package.json`）。
- 一个与根平级的 `outside/`，里面有 `package.json`。
- 根目录里一个名为 `link-out` 的目录联接（junction，Windows 上的"目录快捷方式"，指向 `outside/`）。它的名字在根内，真实位置在根外。

每一行的输入是模型给出的 `directory`。`relative` 列是 `path.relative(root, target)` 的结果；表中的双反斜杠是 JSON 的显示方式，真实值只有一个反斜杠。

实际输出（PowerShell 与 bash 各运行一次，输出逐字相同；临时目录运行后已删除）：

```text
symbolic link (junction) link-out: created
input        string  relative         result
pkg          pass    "pkg"            ok, name=demo
.            pass    ""               No package.json
..           fail    ".."             rejected by string check
../outside   fail    "..\\outside"    rejected by string check
..foo        pass    "..foo"          Directory not found
E:/secret    fail    "E:\\secret"     rejected by string check
link-out     pass    "link-out"       rejected by realpath check
missing      pass    "missing"        Directory not found
broken       pass    "broken"         Invalid JSON
list         pass    "list"           not a JSON object
empty        pass    "empty"          No package.json
fixture removed: true
```

逐行读法：

| 输入 | 字符串检查 | 发生了什么 | 教学要点 |
| --- | --- | --- | --- |
| `pkg` | 通过 | `realpath` 三次都成功，读出 `name` | 正常路径 |
| `.` | 通过 | 根本身允许，但根下没有 `package.json` | 根本身不是越界 |
| `..` | 拒绝 | 字符串检查直接返回，没有访问磁盘 | 快速拒绝 |
| `../outside` | 拒绝 | `relative` 是 `..\outside`，以 `..` 加分隔符开头 | 越界的常见写法 |
| `..foo` | 通过 | `relative` 是 `..foo`，不是上一级；目录不存在，所以是 `Directory not found` | 证明不能用 `startsWith("..")` |
| `E:/secret` | 拒绝 | 跨盘符时 `relative` 仍是绝对路径，`isAbsolute` 为真 | Windows 跨盘符 |
| `link-out` | 通过 | 名字在根内，所以字符串检查看不出问题 | 字符串检查的盲区 |
| `link-out` 的 `realpath` | 拒绝 | 真实位置是 `outside/`，不在真实根内 | 只有 `realpath` 能发现它 |
| `missing` | 通过 | `realpath(target)` 抛出 ENOENT，映射为 `Directory not found` | 系统错误要改写 |
| `broken` | 通过 | 读到 `{`，`JSON.parse` 抛出，映射为 `Invalid JSON` | 坏 JSON |
| `list` | 通过 | JSON 合法，但顶层是数组 | 顶层必须是对象 |
| `empty` | 通过 | 目录存在，`package.json` 不存在 | 缺失文件 |

注意两点：

- 只有 `link-out` 一行需要 `realpath` 才能拒绝。如果删掉 `realpath` 检查，字符串检查会放行这一行，之后的 `readFile` 会读到 `outside/package.json`。这是推断，未在本地验证；第 5 步的先红后绿实验可以验证它。
- `E:/secret` 写成正斜杠，是为了避免不同 shell 对反斜杠的转义不同。Node 在 Windows 上两种写法解析结果相同。

本例的运行环境：Windows 11，Node v23.9.0，PowerShell 与 Git Bash。`link-out` 使用 `junction`，因为它不需要管理员权限。真正的符号链接（`New-Item -ItemType SymbolicLink`）在本机没有权限时失败，输出为 `New-Item SymbolicLink: failed`（已在本地验证）。`junction` 与符号链接在 `realpath` 上的行为是否完全相同，未在本地验证；本例的 `realpath` 结果只对 `junction` 有效。

## 设计理由：为什么是两层检查

只做 `realpath` 检查行不行？结果上是对的，但有两个问题：

- `realpath` 要求路径存在。对不存在的路径它直接抛错，错误处理会变得分散。
- `..` 这类明显越界的输入会先触碰文件系统，而字符串检查可以在不访问磁盘时就拒绝它。

所以两层检查的分工是：

- 字符串检查：快速、便宜，给出清晰的"越界"错误，不访问磁盘。它是可选的快捷方式，去掉它结果仍然正确（越界路径最终会被 `realpath` 层拒绝），但错误信息会不够清楚。
- `realpath` 检查：必需的部分。它是唯一能发现符号链接越界的检查。

本篇不需要的复杂度：递归遍历目录、读取 lockfile、解析 workspace 配置、支持 glob 模式。它们都超出规格，加上会让评审难以逐行检查。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径（相对仓库根） | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/coding-agent/examples/extensions/hello.ts` | `defineTool`、`parameters`、`execute` | 一个工具的最小形状；`execute` 返回 `content` 与 `details` |
| 2 | `packages/coding-agent/src/index.ts` | `defineTool`、`ExtensionAPI` | 扩展应从包入口导入这两个名字 |
| 3 | `packages/coding-agent/src/core/extensions/types.ts` | `defineTool`、`ExtensionAPI.registerTool`、`cwd` | 工具的类型定义；`ctx.cwd` 是默认基准目录 |
| 4 | `packages/coding-agent/test/suite/harness.ts` | `createHarness`、`tempDir`、`cleanup`、`setResponses`、`session.bindExtensions` | 离线测试如何建立会话、临时目录与假模型回复 |
| 5 | `packages/ai/src/providers/faux.ts` | `fauxAssistantMessage`、`fauxToolCall` | 假模型回复的构造方式；`stopReason: "toolUse"` 表示"请求工具" |
| 6 | `packages/coding-agent/test/suite/agent-session-boundaries.test.ts` | 测试中对 `fauxToolCall` 的用法 | 一个已有的工具循环测试，本篇测试可照它的写法 |

读源码时不必从第一行读到最后一行。从 `hello.ts` 入手，看清工具的形状；再看 `harness.ts` 的 `createHarness`，看清测试如何搭环境。

## 走读一次完整过程

以"正常目录"测试为例。假设 `h` 是 `createHarness` 的返回值，扩展是 `extension`。

1. 测试调用 `const h = await createHarness({ extensionFactories: [extension] })`。`createHarness` 是异步函数，必须写 `await`。它创建 `tempDir`（系统临时目录下的新目录）、faux 假模型和一个 `AgentSession`。`session` 的工作目录（`cwd`）就是 `tempDir`。`harness.ts` 在这一步用 `createTestExtensionsResult` 加载 `extensionFactories`。
2. 扩展工厂函数在加载时执行。工厂函数调用 `pi.registerTool(defineTool({...}))`，于是 `inspect_package` 进入工具表。`AgentSession` 上有 `bindExtensions(bindings)` 方法，示例代码（`examples/sdk` 下）用 `await session.bindExtensions({})` 调用它。本篇未在本地验证测试中是否还需要显式调用它；如果工具没有出现，见下文"卡住时怎么办"的第一种症状。
3. 测试把一份 `package.json` 写入 `h.tempDir`，内容包含 `name`、`scripts` 和 `dependencies`。
4. 测试调用 `h.setResponses([...])`，预设两条假模型回复。第一条请求工具，写法如下：

   ```typescript
   fauxAssistantMessage([fauxToolCall("inspect_package", {})], { stopReason: "toolUse" });
   ```

   `fauxToolCall(name, arguments, { id? })` 构造一个工具调用块。`fauxAssistantMessage(content, { stopReason })` 构造助手消息；`stopReason` 默认是 `"stop"`（见 `packages/ai/src/providers/faux.ts`），请求工具时要显式写 `"toolUse"`。`packages/coding-agent/test/system-prompt-updates.test.ts` 中有同样的写法（`fauxAssistantMessage([fauxToolCall("first", {})], { stopReason: "toolUse" })`）。第二条是普通文字回答，例如 `fauxAssistantMessage("done")`。
5. 测试调用 `session.prompt(...)`。Agent 循环发出第一次模型请求，假模型返回第一条回复。
6. pi 用工具的 `parameters` schema 校验参数。这一步在 `packages/agent/src/agent-loop.ts` 中调用 `validateToolArguments`（定义在 `packages/ai/src/utils/validation.ts`）。校验通过后，调用 `execute(toolCallId, params, signal, onUpdate, ctx)`。`ctx` 中的 `cwd` 就是工具的工作目录。
7. 你的 `execute` 按下列顺序工作：算出 `target`，做路径边界检查，读取 `package.json`，`JSON.parse`，检查顶层是对象，整理 `content` 和 `details`，然后返回。
8. 工具结果成为一条工具结果消息，进入会话。Agent 发出第二次模型请求，假模型返回第二条文字回复。
9. 循环结束。测试检查：工具只执行一次；假模型请求两次；工具结果不是错误；文本含包名与脚本名；`details` 中的依赖数正确。

预期的会话消息变化如下（这是按上述步骤推出的顺序，本篇未在本地运行验证；以你自己的测试输出为准）：

| 阶段 | 会话里的消息（按顺序） |
| --- | --- |
| 建立会话后 | 无 |
| `prompt` 发出后 | 用户消息 |
| 第一次模型回复后 | 用户消息，助手消息（含工具调用） |
| 工具执行后 | 以上 + 工具结果消息 |
| 第二次模型回复后 | 以上 + 助手文字消息 |

第 5 步和第 8 步是两次模型请求。注意不要把"一次用户输入"数成"一次模型请求"：一次输入可以对应多次模型请求，因为工具调用本身需要模型再看一次结果。

## 走读二：一次越界请求的失败路径

同样的测试框架，换一个输入：模型请求 `directory: ".."`。这条路径用来回答"失败路径怎样结束"。

1. 假模型第一次回复一个工具调用：`inspect_package({"directory":".."})`。
2. pi 校验参数，`directory` 是字符串，校验通过，调用 `execute`。
3. `execute` 算出 `target`，它位于 `ctx.cwd` 的上一级。字符串检查 `isInside` 返回 `false`。
4. `execute` 抛出错误 `Directory is outside the working directory: ..`。该次工具调用没有读取任何文件。
5. pi 把错误转成 `isError: true` 的工具结果，放入会话。
6. 假模型第二次回复一条文字，例如"该目录不在工作目录内，无法读取"。
7. 运行结束。测试断言：`isError` 为 `true`；错误文字含 `outside`；会话中没有任何仓库外的文件内容。

这条路径的最终状态是"运行正常结束，工具失败，没有副作用"。它和"正常目录"走读的区别只在第 3 步之后：正常路径会读文件并返回成功结果。

## 实现规格

下面是本篇的固定规格。扩展文件和测试文件都由你自己创建，不借用仓库中其他的示例文件。

### 学习者创建的文件

下表列出你会创建或产生的全部文件。除前两行外，都不要求进入仓库。

| 路径 | 必需 | 何时出现 | 结束时怎么处理 |
| --- | --- | --- | --- |
| `packages/coding-agent/test/suite/task-16-extension.ts` | 是 | 第 2 天 | 保留，属于交付物 |
| `packages/coding-agent/test/suite/task-16-learning.test.ts` | 是 | 第 3 天 | 保留，属于交付物 |
| `$env:TEMP\pi-task16-pr.md`（bash 中为 `$TMPDIR` 或 `/tmp` 下同名文件） | 否 | 第 7 天，写 PR 描述草稿 | 提交后删除；不在仓库内 |
| `$env:TEMP\pi-task16-verify-<随机串>\check.mjs` | 否 | 做路径表实验时 | 运行后删除目录 |
| `$env:TEMP\pi-suite-<时间>-<随机串>`（由测试框架创建） | 自动 | 每个测试用例 | 由 `h.cleanup()` 删除；结束后不应残留 |

说明：

- 时序图和四段说明放在 PR 描述里（见下文示例），不单独保存为仓库文件。本篇不要求在仓库中新增 `.md` 文件。
- 测试文件建议放在 `test/suite/`，这样 `./harness.ts` 的相对导入路径可以直接使用。如果放在别处，需要改导入路径。
- 完成后如果不打算保留这两个文件，可以删除它们，但评审时需要它们，所以请先完成评审。

| 项目 | 要求 |
| --- | --- |
| 名称和参数 | 工具名 `inspect_package`；参数 schema 为 `directory` 可选字符串 |
| 工作目录 | 基准是 `ctx.cwd`；参数为空时读取当前目录 |
| 边界 | `target = resolve(ctx.cwd, directory ?? ".")`；对 `ctx.cwd`、`target` 和 `target/package.json` 分别 `realpath`；用 `isInside` 比较真实路径 |
| 输入 | 读取 `target/package.json`；`JSON.parse` 后确认顶层是对象（不是数组，也不是 `null`） |
| 输出 `content` | 包名、版本（如有）、脚本名列表，最多 20 个；超过时注明"还有 N 个未显示" |
| 输出 `details` | 保存 `name`、脚本名数组、`dependencyCount` 和 `file`（真实路径） |
| 错误 | 文件不存在、JSON 非法、目录越界，三类错误文字互不相同，且都包含出错的路径 |
| 只读 | 不写任何文件，不执行 `package.json` 中的脚本 |

实现骨架（示意，不是完整答案）：

```typescript
import { realpath, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isInside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "inspect_package",
			label: "Inspect package",
			description: "Read package.json in a directory under the working directory.",
			parameters: Type.Object({
				directory: Type.Optional(Type.String({ description: "Directory relative to the working directory" })),
			}),
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const target = resolve(ctx.cwd, params.directory ?? ".");
				// 1. 字符串检查（快速拒绝明显越界的输入）
				if (!isInside(resolve(ctx.cwd), target)) {
					throw new Error(`Directory is outside the working directory: ${params.directory}`);
				}
				// 2. 真实路径检查（防止符号链接越界）
				const realRoot = await realpath(ctx.cwd);
				const realTarget = await realpath(target); // 目录不存在时会抛出，需要转成清晰的错误
				const pkgPath = resolve(target, "package.json");
				const realPkg = await realpath(pkgPath);
				if (!isInside(realRoot, realTarget) || !isInside(realRoot, realPkg)) {
					throw new Error(`Resolved path is outside the working directory: ${params.directory}`);
				}
				// 3. 读取与解析
				const text = await readFile(realPkg, "utf8");
				const data: unknown = JSON.parse(text); // 非法 JSON 时抛出，需要转成 "Invalid JSON" 错误
				// ... 检查 data 是否为对象，整理 content 与 details
				return { content: [{ type: "text", text: "..." }], details: {} };
			},
		}),
	);
}
```

注意骨架里的三处"需要转成"：`realpath` 与 `JSON.parse` 抛出的系统错误不适合直接给模型。你需要用 `try/catch` 把它们改写成本篇规定的错误文字，并保留路径。

另外，`pkgPath` 不存在时 `realpath(pkgPath)` 会抛出 ENOENT。把它映射成"未找到 package.json"错误，是测试"缺失文件"用例要检查的内容。

### 失败路径表

每种输入都要有明确的去向。下表是规格要求的行为；错误文字是本篇的建议写法，你可以换措辞，但三类错误必须互不相同且含路径。

| 情况 | 处理位置 | 抛出或返回的内容（示例） | 文件是否被写入 | 模型下一步看到什么 |
| --- | --- | --- | --- | --- |
| `directory` 为 `..` 或 `../x` | 字符串检查 | `Directory is outside the working directory: ..` | 否 | 错误结果，`isError: true` |
| 符号链接指向根外 | `realpath` 检查 | `Resolved path is outside the working directory: <directory>` | 否 | 错误结果 |
| 目录不存在 | `realpath(target)` 捕获 | `Directory not found: <target>` | 否 | 错误结果 |
| `package.json` 不存在 | `realpath(pkgPath)` 捕获 | `No package.json at <pkgPath>` | 否 | 错误结果 |
| JSON 非法 | `JSON.parse` 捕获 | `Invalid JSON in <pkgPath>` | 否 | 错误结果 |
| 顶层不是对象（如数组、`null`） | 类型检查 | `package.json must contain a JSON object: <pkgPath>` | 否 | 错误结果 |
| 脚本超过 20 个 | 输出整理 | 正常结果；`content` 只列前 20 个并注明还有几个 | 否 | 正常结果，不是错误 |

几个要点：

- 所有失败路径都不写文件，也不改变会话之外的状态。这是"只读"契约的一部分。
- 失败只让这一次工具调用返回错误，整次运行仍然继续，模型可以用错误文字回答用户。
- "脚本超过 20 个"不是错误。它是输出长度的限制，属于正常结果，测试要断言 `content` 中的脚本数不超过 20。

### 与 hello.ts 的对照

`hello.ts` 是本篇的模板。下表说明每一部分在 `inspect_package` 中怎样对应，以及多出来的部分为什么需要。

| 部分 | `hello.ts` | `inspect_package` | 多出来的原因 |
| --- | --- | --- | --- |
| 名字 | `hello` | `inspect_package` | 无 |
| 参数 | 必填字符串 `name` | 可选字符串 `directory` | 参数可省略时，默认值要在 `execute` 中处理 |
| 默认目录 | 不需要 | `ctx.cwd` | 工具要读文件，必须知道从哪里开始 |
| 输入检查 | 无 | 边界检查与 JSON 检查 | 工具读的是真实文件，必须防越界、防坏数据 |
| 返回的 `content` | 一句问候 | 包名与最多 20 个脚本名 | 输出给模型看，必须短 |
| 返回的 `details` | `{ greeted }` | `name`、脚本名、依赖数、`file` | 给界面或程序用，不给模型看 |
| 错误 | 无 | 三类可辨别的错误文字 | 模型需要知道失败原因 |

### 输出形状示例

下面是一个示例输出（设计草稿，不是真实运行结果）。输入是一个只有一个脚本、一个依赖的 `package.json`。

```text
content（给模型看）:
demo
scripts (1): check
dependencies: 1

details（给界面或程序看）:
{ "name": "demo", "scripts": ["check"], "dependencyCount": 1, "file": "<真实路径>" }
```

注意：`content` 是短文本，`details` 是结构化数据。这与 `hello.ts` 中的 `content` 与 `details` 作用相同。

## 动手实验

### 七天计划

总时长约 5 小时，分七步完成。每一步结束时都要有对应的产出。下一步不要跳过；后一步依赖前一步的文件和输出。

| 天 | 时长 | 做什么 | 产出（作为完成的证据） |
| --- | --- | --- | --- |
| 第 1 天 | 40 分钟 | 读 `hello.ts`、`harness.ts` 的 `createHarness`、`faux.ts` 的 `fauxToolCall`；跑实验 1 | 实验 1 的输出，以及一句话解释为什么 `..foo` 通过字符串检查 |
| 第 2 天 | 40 分钟 | 创建 `task-16-extension.ts`，只实现正常目录：读取、解析、输出 `content` 与 `details`，暂不做边界检查 | 文件存在；`Select-String -Path packages\coding-agent\test\suite\task-16-extension.ts -Pattern 'registerTool'` 有输出 |
| 第 3 天 | 40 分钟 | 创建 `task-16-learning.test.ts`，只写"正常目录"一个用例，用 `try/finally` 调用 `h.cleanup()` | 单文件测试运行，该用例通过，输出中有用例名 |
| 第 4 天 | 60 分钟 | 加字符串检查（`isInside`）；加"缺失文件"和"坏 JSON"的错误映射；加"越界"用例 | 单文件测试：四个用例中至少三个通过，失败的那个有可读的错误 |
| 第 5 天 | 60 分钟 | 加 `realpath` 检查；加"脚本超过 20 个"用例；尝试符号链接（或 `junction`）用例 | 单文件测试全部通过；符号链接用例要么通过，要么记为"未验证"并写明原因 |
| 第 6 天 | 60 分钟 | 做先红后绿实验（见实验 5）；写时序图 | 删除边界检查后失败的用例名与断言行；恢复后再次通过的输出 |
| 第 7 天 | 40 分钟 | 用下文的自我评审清单逐项检查；写 PR 描述草稿；交给评审 | 清单每一项都有"是"并附证据路径，或写明"否"和原因 |

每天结束前运行一次单文件测试，并把输出保存在 `$env:TEMP\pi-task16-day<N>.txt`（这是临时文件，不进仓库）。这样第 7 天写 PR 描述时，证据已经存在，不需要重新运行全部步骤。

第 4 天的"越界"用例可以先用 `directory: ".."`。第 5 天再加符号链接用例，这样边界检查是逐步加上的，每一步都有失败和通过的对照。

单文件测试的命令（PowerShell，从仓库根目录开始，先切换到包目录再运行）：

```powershell
Set-Location packages\coding-agent
$root = git rev-parse --show-toplevel
node "$root/node_modules/vitest/dist/cli.js" --run test/suite/task-16-learning.test.ts
Set-Location ..\..
```

本段的命令格式来自 AGENTS.md。命令本身未在本地运行（测试文件由学习者创建，此时不存在）。

### 实验 1：离线演示路径边界（5 分钟）

目的：亲眼看到 `relative` 的结果，理解"只看字符串"的规则。

PowerShell 版（在仓库根目录执行）：

```powershell
$d = Join-Path $env:TEMP "pi-task16-check"
New-Item -ItemType Directory -Force -Path $d | Out-Null
$js = @'
import { isAbsolute, relative, resolve, sep } from "node:path";
const root = resolve("workspace-demo");
const inside = (c) => { const rel = relative(root, resolve(c)); return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)); };
const other = "E" + ":" + sep + "secret";
const cases = { "sub/pkg": resolve(root, "sub", "pkg"), "parent (..)": resolve(root, "..", "outside"), "name ..foo": resolve(root, "..foo"), "cross drive": other, "root itself": root };
for (const [k, v] of Object.entries(cases)) console.log(k.padEnd(16), String(inside(v)).padEnd(6), JSON.stringify(relative(root, resolve(v))));
'@
Set-Content -LiteralPath (Join-Path $d "check.mjs") -Value $js -Encoding UTF8
node (Join-Path $d "check.mjs")
Remove-Item -LiteralPath $d -Recurse -Force
```

bash 版（在仓库根目录执行；`$(mktemp -d)` 是 bash 写法）：

```bash
d=$(mktemp -d)
cat > "$d/check.mjs" <<'EOF'
import { isAbsolute, relative, resolve, sep } from "node:path";
const root = resolve("workspace-demo");
const inside = (c) => { const rel = relative(root, resolve(c)); return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)); };
const cases = { "sub/pkg": resolve(root, "sub", "pkg"), "parent (..)": resolve(root, "..", "outside"), "name ..foo": resolve(root, "..foo"), "absolute": "/etc/passwd", "root itself": root };
for (const [k, v] of Object.entries(cases)) console.log(k.padEnd(16), String(inside(v)).padEnd(6), JSON.stringify(relative(root, resolve(v))));
EOF
node "$d/check.mjs"
rm -rf "$d"
```

PowerShell 实测输出（仓库位于 `D:\Github\pi`，根为 `workspace-demo`，`relative` 的结果用 JSON 字符串显示，反斜杠会双写）：

```text
sub/pkg          true   "sub\\pkg"
parent (..)      false  "..\\outside"
name ..foo       true   "..foo"
cross drive      false  "E:\\secret"
root itself      true   ""
```

bash 版：未在本地验证。预期 `absolute` 行为 `false`，分隔符显示为 `/`。

解释：`..foo` 为 `true`，因为它不是 `..` 也不以 `..\` 开头。这正是"不能用 `startsWith("..")`"的原因。

### 实验 2：看一个真实工具长什么样（5 分钟）

目的：读懂 `hello.ts` 的四个部分，为自己的工具做对照。

步骤：

1. 打开 `packages/coding-agent/examples/extensions/hello.ts`，找到 `defineTool({...})`。
2. 逐行标注 `name`、`parameters`、`execute` 的参数和返回值。
3. 用 `Get-Content`（PowerShell）或 `cat`（bash）查看前 20 行，确认导入语句来自 `@earendil-works/pi-coding-agent` 与 `@earendil-works/pi-ai`。

PowerShell：

```powershell
Get-Content packages\coding-agent\examples\extensions\hello.ts -TotalCount 20
```

bash：

```bash
head -n 20 packages/coding-agent/examples/extensions/hello.ts
```

预期：能看到 `import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";`，以及 `name: "hello"`、`description: "A simple greeting tool"` 等字段。

实测（PowerShell 运行上面的命令）输出的前几行就是这些内容。

#### 阅读测试基础设施（只读，2 分钟）

目的：确认临时目录从哪里来、何时清理。这是 `try/finally` 写法的依据。

PowerShell：

```powershell
Select-String -Path packages\coding-agent\test\suite\harness.ts -Pattern "tmpdir|cleanup\(\)"
```

bash：

```bash
grep -n "tmpdir\|cleanup()" packages/coding-agent/test/suite/harness.ts
```

实测（PowerShell 运行上面的命令）输出三行：

- `import { tmpdir } from "node:os";`：导入系统临时目录函数；
- `const tempDir = join(tmpdir(), \`pi-suite-...\`)`：每次 `createHarness` 在临时目录下建立一个 `pi-suite-` 目录；
- `cleanup() {`：删除这个临时目录（若存在）的函数。

所以只要测试在 `finally` 里调用 `h.cleanup()`，无论用例是否失败，临时目录都会被删除。

### 实验 3：用扩展命令加载 hello.ts（未在本地验证）

目的：确认扩展能被 pi 加载。`pi-test` 脚本是 bash 包装，在 PowerShell 下不要使用它，直接用 `pi -e`（`-e` 是 `--extension` 的缩写，见 `packages/coding-agent/src/cli/args.ts`）。

PowerShell：

```powershell
pi -e .\packages\coding-agent\examples\extensions\hello.ts
```

bash：

```bash
pi -e ./packages/coding-agent/examples/extensions/hello.ts
```

预期：pi 启动后，`hello` 工具可用。本篇没有在本地运行这条命令；它需要已安装的 `pi` 命令，并可能需要已配置的模型。若只想检查加载，不要求模型回答。

### 实验 4：运行你自己的离线测试（完成项目后）

目的：确认 `inspect_package` 的测试在本地通过，且只运行单个文件。

进入 `packages/coding-agent`，运行单文件测试。下面是 AGENTS.md 指定的格式，其中 `$(git rev-parse --show-toplevel)` 是 bash 写法：

bash：

```bash
cd packages/coding-agent
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/suite/task-16-learning.test.ts
```

PowerShell：

```powershell
Set-Location packages\coding-agent
$root = git rev-parse --show-toplevel
node "$root/node_modules/vitest/dist/cli.js" --run test/suite/task-16-learning.test.ts
```

预期：该文件的所有用例通过。这些测试文件由你创建，本篇没有在本地运行它们；结果记录写在你的实验记录里，不要照抄本篇的预期。

不要运行完整的 vitest 套件（AGENTS.md 禁止直接运行全部测试，包括 e2e）。也不要运行 `npm run build` 或 `npm test`。

### 实验 5：先红后绿（自证测试有区分力）

目的：证明测试不是"碰巧通过"。

步骤：

1. 先完成扩展和测试，单文件测试应全部通过。
2. 临时把 `isInside` 的字符串检查删掉（或把 `realpath` 检查删掉），再运行同一个测试文件。
3. 记录哪些用例失败，失败的断言是哪一行。
4. 恢复代码，再运行一次，确认变回通过。

预期（未在本地验证）：删掉越界检查后，"directory 为 .." 的用例应当失败；删掉 `realpath` 检查后，符号链接用例应当失败（如果你能创建符号链接）。

符号链接用例在 Windows 上需要开发者模式或管理员权限来创建链接。若不具备条件，记录为"未验证"，不要跳过说明。

### 毕业项目：自查清单

交付前逐项打勾，并写出证据路径。缺少证据的项写"未完成"，不要写"应该没问题"。

- [ ] 需求覆盖：正常目录输出包名、脚本名（最多 20 个）、依赖数；`details` 字段齐全。证据：测试用例名。
- [ ] 坏输入：缺失文件、非法 JSON、`directory: ".."`、超过 20 个脚本，四类输入都有用例，错误文字可辨别。证据：测试输出。
- [ ] 边界：字符串检查与 `realpath` 检查都有；`..foo` 这种名字不被误拒。证据：实验 1 的输出与测试用例。
- [ ] 取消与释放：每个用例用 `try/finally` 调用 `h.cleanup()`；本篇未要求取消路径，若实现了 `signal` 处理，记录为加分项。证据：测试文件中的 `finally`。
- [ ] 离线测试：测试只用 faux，不联网，不需要密钥。证据：单文件测试命令与输出。
- [ ] 源码解释：能说出 `execute` 的入口、工具结果进入会话的路径、两次模型请求的原因。证据：下文时序图。
- [ ] 只读：工具没有写文件，也没有执行 `package.json` 的脚本。证据：代码中没有 `writeFile`、`exec` 调用。

### 示例：自我评审（是或否）

这是一份可以直接照抄的评审清单。每一项只回答"是"或"否"。选"否"的项要写原因，不能留空。任何一项为"否"，都不能交给评审。

| 编号 | 检查项 | 是 | 否 | 证据（文件或命令） |
| --- | --- | --- | --- | --- |
| 1 | 工具名是 `inspect_package`，参数只有可选的 `directory` | □ | □ | `task-16-extension.ts` 中的 `name` 与 `parameters` |
| 2 | 未传 `directory` 时，目标是 `ctx.cwd` | □ | □ | 测试"正常目录"用例不传参数 |
| 3 | 字符串检查用 `isInside`，代码中没有 `startsWith("..")` | □ | □ | 运行 `Select-String` 命令，结果为空（见下） |
| 4 | `ctx.cwd`、`target`、`target/package.json` 都调用了 `realpath` | □ | □ | `task-16-extension.ts` 中的 `realpath` 调用 |
| 5 | `..foo` 不被拒绝 | □ | □ | 实验 1 的输出中 `..foo` 一行为 `true` |
| 6 | `directory: ".."` 被拒绝，错误文字含 `outside` | □ | □ | 越界用例的测试输出 |
| 7 | 缺失、坏 JSON、越界三类错误文字互不相同，且都含路径 | □ | □ | 测试输出中三条错误文字 |
| 8 | `JSON.parse` 的结果检查了对象，排除数组与 `null` | □ | □ | `task-16-extension.ts` 中的类型检查 |
| 9 | 超过 20 个脚本时，`content` 只列 20 个，且结果不是错误 | □ | □ | "脚本过多"用例的断言 |
| 10 | 扩展中没有写文件或执行命令的调用 | □ | □ | 运行 `Select-String` 命令，结果为空（见下） |
| 11 | 每个用例都在 `finally` 中调用 `h.cleanup()` | □ | □ | `task-16-learning.test.ts` 中的 `finally` |
| 12 | 单文件测试命令运行，输出已保存 | □ | □ | `$env:TEMP\pi-task16-day7.txt` |
| 13 | 删除边界检查后，至少一个测试失败（先红后绿） | □ | □ | 实验 5 的记录 |
| 14 | 时序图和四段说明都写在 PR 描述中 | □ | □ | PR 描述草稿的对应小节 |

第 3 项与第 10 项的检查命令：

```powershell
Select-String -Path packages\coding-agent\test\suite\task-16-extension.ts -Pattern 'startsWith\("\.\."\)', 'writeFile', 'exec\(', 'spawn'
```

```bash
grep -nE 'startsWith\("\.\."\)|writeFile|exec\(|spawn' packages/coding-agent/test/suite/task-16-extension.ts
```

两条命令在文件存在时输出匹配行；无输出即为通过。`exec\(` 这样写是为了不匹配 `execute(`，因为工具的 `execute` 方法本身不是问题。匹配规则已在样例文本上验证：PowerShell 的 `Select-String` 能匹配 `rel.startsWith("..")`，不匹配 `rel.startsWith(\`..${sep}\`)`；bash 的 `grep` 能匹配 `rel.startsWith("..")`。bash 下的不匹配情况、`writeFile`、`exec(`、`spawn` 的匹配，以及对真实文件运行这些命令，未在本地验证。

### 测试用例表

测试文件必须覆盖下列用例。每个用例都用 `try/finally` 调用 `h.cleanup()`。

| 用例 | 输入（`directory`，以及写入 `tempDir` 的内容） | 必须断言 |
| --- | --- | --- |
| 正常目录 | 不传参数；`package.json` 含 `name: "demo"`、脚本 `check`、依赖 `x` | 工具执行一次；faux 请求两次；`isError` 为 `false`；文本含 `demo` 与 `check`；`details` 的依赖数为 1 |
| 缺失文件 | 不写 `package.json` | `isError` 为 `true`；错误文字含 `package.json` 的完整路径 |
| 坏 JSON | `package.json` 内容为 `{` | `isError` 为 `true`；错误文字含 `Invalid JSON` |
| 越界 | `directory: ".."` | `isError` 为 `true`；错误文字含 `outside`；没有读出仓库外的内容 |
| 脚本过多 | `scripts` 含 21 个脚本 | `isError` 为 `false`；`content` 中脚本名不超过 20 个；`details` 仍保存完整数量或完整名单（二选一，写明你的选择） |

"没有读出仓库外的内容"的断言方法：让越界路径指向一个已知内容的文件，断言工具结果中不含该内容。

### 测试文件的骨架

下面是一个用例的骨架，展示 API 的组合方式。你要把它扩展为表中的五个用例。

```typescript
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import extension from "./task-16-extension.ts";
import { createHarness, getToolResult } from "./harness.ts";

describe("inspect_package", () => {
	it("正常目录：返回包名、脚本与依赖数", async () => {
		const h = await createHarness({ extensionFactories: [extension] });
		try {
			writeFileSync(
				join(h.tempDir, "package.json"),
				JSON.stringify({ name: "demo", scripts: { check: "echo ok" }, dependencies: { x: "1.0.0" } }),
			);
			h.setResponses([
				fauxAssistantMessage([fauxToolCall("inspect_package", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			await h.session.prompt("inspect this package");
			const result = getToolResult(h, "inspect_package");
			expect(result.isError).toBe(false);
			expect(result.details).toMatchObject({ name: "demo", dependencyCount: 1 });
		} finally {
			h.cleanup();
		}
	});
});
```

逐行说明：

- `createHarness` 是异步函数，所以用 `await`。它返回的 `h.tempDir` 是本用例专用的临时目录，写入的 `package.json` 放在这里。
- `h.setResponses` 预设两条假模型回复。第一条请求工具，第二条给出文字。
- `h.session.prompt` 触发一次完整运行。它内部会发出两次模型请求（见"走读一次完整过程"）。
- `getToolResult(h, "inspect_package")` 从会话中找到最近一条该工具的结果。它定义在 `packages/coding-agent/test/suite/harness.ts`。
- `finally` 中的 `h.cleanup()` 删除临时目录。即使断言失败，这一行也会执行。

本骨架未在本地验证。它只示意 API 的用法。其中的名字（`createHarness`、`getToolResult`、`h.tempDir`、`h.setResponses`、`h.session.prompt`、`h.cleanup`，以及 `fauxToolCall` 与 `fauxAssistantMessage`）均已在仓库源码中确认存在。`ToolResultMessage` 有 `isError` 与 `details` 字段（见 `packages/ai/src/types.ts`）。

### 交付物

1. 扩展源码（`task-16-extension.ts` 或你的文件名）。
2. 单文件测试命令与结果。
3. 一张时序图，格式为"输入 → 模型 → Agent → 工具 → 会话 → 输出"。示例：

   ```text
   用户输入 → AgentSession.prompt → 模型第一次请求（返回 toolUse）
            → Agent 校验参数 → execute（边界检查、读文件、解析）
            → 工具结果消息进入会话 → 模型第二次请求（返回文字）→ 输出
   ```

4. 一页说明，包含五段，每段一两句：

   - 问题：工具为什么存在。示例："团队需要快速看到一个子目录的 package.json 摘要，而不让模型自由读取文件。"
   - 固定输入：参数、默认目录、示例文件内容。示例："`directory` 可选；未传时读取 `ctx.cwd`。"
   - 处理规则：边界、解析、输出整理。示例："先字符串检查，再 `realpath` 检查；输出最多 20 个脚本名。"
   - 失败路径：每类错误的文字与去向。示例："越界 → 错误结果，不写文件，运行继续。"
   - 尚未覆盖的情况：诚实列出。示例："未测试 UNC 路径；未测试 Windows 符号链接（权限不足时）；未处理超大 `package.json`。"

### 示例：PR 描述

下面是一份可以照着写的 PR 描述。方括号中的内容必须换成你自己的运行结果；不能保留方括号本身。这份示例的结构是四段：问题、行为变化、测试证据、影响边界。

```text
## 问题

团队需要快速看到子目录 package.json 的摘要（包名、脚本名、依赖数），
但不希望模型自由读取仓库中的文件。之前模型只能猜，或要求用户粘贴文件内容。

## 行为变化

- 新增只读工具 inspect_package。参数 directory 可选，未传时使用 ctx.cwd。
- 成功时返回 content（包名、版本（如有）、最多 20 个脚本名）和 details
  （name、脚本名数组、dependencyCount、file）。
- 失败时返回 isError: true 的结果。缺失文件、非法 JSON、越界三类错误文字互不相同，且都含路径。
- 不写文件，不执行 package.json 中的脚本。
- 调用顺序（一次用户输入）：
  用户输入 → AgentSession.prompt → 模型第一次请求（返回 toolUse）
  → 参数校验 → execute（边界检查、读文件、解析）
  → 工具结果消息进入会话 → 模型第二次请求（返回文字）→ 输出

## 测试证据

- 命令（在 packages/coding-agent 下运行）：
  node "$root/node_modules/vitest/dist/cli.js" --run test/suite/task-16-learning.test.ts
- 结果：[填入通过的用例数与失败数]
- 先红后绿：删除 realpath 检查后，[填入失败的用例名]；恢复后全部通过。
- 路径表实验输出：[粘贴实验 1 的输出]
- 未运行：完整 vitest 套件，npm run build。

## 影响边界

- 只新增两个文件：test/suite/task-16-extension.ts 与 test/suite/task-16-learning.test.ts。
  不修改 packages/*/src。
- 未覆盖：UNC 路径（\\server\share）、Windows 上真正的符号链接（权限不足时）、
  超大 package.json、大小写不同的同一路径（如 D:\Repo 与 d:\repo）。
- 不处理 workspace 配置、lockfile、glob 模式。这些超出本次规格。
```

### 评分标准（100 分，80 分为通过）

| 维度 | 分值 | 满分标准 | 扣分示例 |
| --- | --- | --- | --- |
| 功能与契约 | 25 | 输出包名、脚本名（不超过 20）、依赖数；`details` 字段齐全；只读 | 漏掉依赖数；把任意文件内容原样返回 |
| 边界安全 | 25 | 字符串与 `realpath` 两层检查；`..` 与绝对路径被拒；`..foo` 允许 | 只做字符串检查（-15）；用 `startsWith("..")`（-10） |
| 错误辨别 | 15 | 三类错误文字互不相同，且含路径 | 三类错误都是 "failed" |
| 测试 | 20 | 五个用例通过；每例有 `finally` 清理；去掉边界检查后至少一个用例失败 | 测试只断言"没报错"；没有清理临时目录 |
| 说明 | 15 | 四段式说明与时序图齐全；写明未覆盖情况 | 只写"已完成"，没有证据路径 |

**一票否决**：只要边界检查有遗漏（例如 `..` 能读出仓库外的文件），总分不得超过 59 分。边界是本篇最重要的安全要求。

### 加分项（不计入上表，不影响通过）

- 在 `details` 之外，补充 `structuredContent`，让程序化调用直接取结构化结果。
- 为终端显示注册渲染函数，把脚本数与依赖数画成简短的列表。
- 把扩展打包为 pi package，并确认它能被 pi 识别（具体命令未在本地验证）。

这三项都超出规格。做之前先保证上表的所有项已经通过；加分项的代码也要有测试，否则不计分。

### 评审者的快速检查

评审者可以用下面的问题在 5 分钟内判断一份变更：

1. 工具名、参数、默认目录是否与规格一致？
2. `directory: ".."` 是否被拒绝，错误文字是什么？
3. 符号链接的检查在哪一行？如果删掉它，哪个测试会失败？
4. 工具有没有任何写操作或执行操作？
5. 测试是否在 `finally` 中清理了临时目录？

## 卡住时怎么办

下面列出五种常见症状。每种都给出一条诊断命令。先运行命令，再看"结果含义"，不要直接改代码。诊断命令都只读，不会改变文件。

### 症状 1：模型从不调用 inspect_package

- 诊断（PowerShell，在仓库根目录）：

  ```powershell
  Select-String -Path packages\coding-agent\test\suite\task-16-extension.ts -Pattern 'registerTool'
  Select-String -Path packages\coding-agent\test\suite\task-16-learning.test.ts -Pattern 'extensionFactories'
  ```

- 诊断（bash）：`grep -n 'registerTool' packages/coding-agent/test/suite/task-16-extension.ts` 和 `grep -n 'extensionFactories' packages/coding-agent/test/suite/task-16-learning.test.ts`。
- 结果含义：第一条没有输出，说明扩展没有调用 `pi.registerTool`。第二条没有输出，说明测试没有把扩展传给 `createHarness`。两条都有输出时，问题在别处，例如工具名拼写不一致。
- 解决：补上缺的调用，并确认工具名在扩展和 `fauxToolCall` 中完全一致（都是 `inspect_package`）。

### 症状 2：vitest 报告找不到测试文件

- 诊断（PowerShell）：

  ```powershell
  (Get-Location).Path
  Test-Path test\suite\task-16-learning.test.ts
  ```

- 诊断（bash）：`pwd` 和 `ls test/suite/task-16-learning.test.ts`。
- 结果含义：如果 `Get-Location` 不是 `...\packages\coding-agent`，命令在错误的目录运行。如果 `Test-Path` 返回 `False`，文件不在预期位置，或名字写错了。
- 解决：先 `Set-Location packages\coding-agent`，再运行测试。文件名必须是 `task-16-learning.test.ts`，不是 `.test.js`。已在本地验证：在 `packages\coding-agent` 下 `Test-Path test\suite\harness.ts` 返回 `True`，说明这条路径形式可用。

### 症状 3：错误文字里出现 ENOENT 或 EPERM

- 症状表现：测试输出或模型回答中出现 `ENOENT: no such file or directory, open '...'` 这类长文字。
- 诊断（PowerShell）：

  ```powershell
  node "$root/node_modules/vitest/dist/cli.js" --run test/suite/task-16-learning.test.ts 2>&1 | Select-String -Pattern 'ENOENT|EPERM'
  ```

- 诊断（bash）：同一命令，把 `Select-String` 换成 `grep -E 'ENOENT|EPERM'`，并去掉 PowerShell 的 `$root` 写法，改为 `"$(git rev-parse --show-toplevel)"`。
- 结果含义：有输出，说明系统原始错误直接泄漏到了工具结果中。`EPERM` 通常表示没有权限，例如创建符号链接时。
- 解决：在 `execute` 中用 `try/catch` 包裹 `realpath` 和 `readFile`，把 `ENOENT` 映射为 "未找到 package.json" 或 "Directory not found"，并保留路径。诊断中的 `Select-String` 对样例文本 `ENOENT: no such file` 的匹配已在本地验证。

### 症状 4：临时目录越来越多

- 症状表现：系统临时目录里出现很多 `pi-suite-*` 目录。
- 诊断（PowerShell）：

  ```powershell
  (Get-ChildItem -LiteralPath $env:TEMP -Filter "pi-suite-*" -Directory | Measure-Object).Count
  ```

- 诊断（bash）：`ls -d /tmp/pi-suite-* 2>/dev/null | wc -l`。
- 结果含义：数字会随每次失败的测试增加。在本地验证时，该数字为 `0`，说明当前没有残留。
- 解决：每个用例改用 `try { ... } finally { h.cleanup(); }`。`cleanup` 会删除 `tempDir`（见 `packages/coding-agent/test/suite/harness.ts` 的 `cleanup`）。

### 症状 5：边界检查看起来没有生效

- 症状表现：越界用例通过了，但它本应失败；或者 `..` 的输入读到了仓库外的内容。
- 诊断（PowerShell）：

  ```powershell
  Select-String -Path packages\coding-agent\test\suite\task-16-extension.ts -Pattern 'startsWith\("\.\."\)'
  Select-String -Path packages\coding-agent\test\suite\task-16-extension.ts -Pattern 'isInside\(|realpath\('
  ```

- 诊断（bash）：`grep -nE 'startsWith\("\.\."\)' packages/coding-agent/test/suite/task-16-extension.ts` 和 `grep -nE 'isInside\(|realpath\(' packages/coding-agent/test/suite/task-16-extension.ts`。
- 结果含义：第一条有输出，说明用了错误的 `startsWith("..")` 判断，它会误拒 `..foo`。第二条应至少有四行：`isInside` 的定义、字符串检查中的 `isInside(` 调用、`realpath(ctx.cwd)` 与 `realpath(target)` 等真实路径调用。少于四行，说明至少一层检查缺失。这是一个粗略的计数，不能替代运行测试。
- 解决：删掉 `startsWith("..")`，改用 `rel !== ".."` 加 `!rel.startsWith(\`..${sep}\`)`。补上缺失的 `realpath` 检查，并用"越界"用例和实验 5 确认它生效。

## 自测题

1. 为什么 `rel.startsWith("..")` 不是正确的越界判断？请用 `..foo` 这个目录名举例。
2. 字符串检查通过后，为什么还要对 `ctx.cwd`、`target` 和 `target/package.json` 分别调用 `realpath`？请举一个符号链接的例子。
3. 一次 `session.prompt` 会引发几次模型请求？它们分别由什么触发？
4. 工具抛出的错误和模型收到的错误结果是什么关系？为什么错误文字要包含路径？
5. 如果测试在中途失败，临时目录会怎样？应该用什么结构保证它被清理？

## 参考答案

1. `..foo` 是一个普通目录名，不是上一级。`relative` 的结果是 `..foo`，它以 `..` 开头但没有分隔符。`startsWith("..")` 会误拒它。正确做法是精确比较 `rel === ".."` 并检查 `..` 加分隔符。
2. 字符串检查只看路径写法。例如仓库里有 `link-to-outside`，它的字符串在根内，但指向 `C:\Users\me\secret`。`realpath` 返回真实位置，检查的是真实位置。`package.json` 也要单独检查，因为它本身可能是符号链接。
3. 两次。第一次由用户输入触发，模型返回工具调用；第二次由工具结果触发，模型返回文字回答。它们都是模型请求，不是用户输入次数。
4. 工具抛出的错误会被 pi 转成 `isError: true` 的工具结果，并进入会话，模型据此回答。错误文字包含路径，是为了让模型和用户都能知道是哪个目录或文件出了问题。
5. 如果测试在 `h.cleanup()` 之前抛出异常，临时目录会残留。应使用 `try { ... } finally { h.cleanup(); }`，确保无论测试成功还是失败都会清理。

## 常见错误

**1. 用 `startsWith("..")` 判断越界**

- 现象：目录名 `..foo` 被拒绝，或者测试中一个合法目录报错。
- 原因：`..foo` 以 `..` 开头，但不是上一级。
- 解决：用 `rel !== ".."` 与 `!rel.startsWith(`..${sep}`)` 两个精确判断。

**2. 只做字符串检查，漏掉符号链接**

- 现象：传入一个仓库内的名字，却读到了仓库外的文件。
- 原因：字符串检查不跟随符号链接。
- 解决：对根和目标都调用 `realpath`，再用 `isInside` 比较真实路径。在 Windows 上没有权限创建符号链接时，把这个用例记为"未验证"。

**3. `realpath` 或 `JSON.parse` 的系统错误直接返回给模型**

- 现象：模型收到 `ENOENT: no such file or directory, open '...'` 这类长文字，或者错误文字不一致。
- 原因：没有把底层异常转换为本篇规定的三类错误。
- 解决：在 `execute` 中用 `try/catch` 包裹，分别抛出 "未找到 package.json"、"Invalid JSON"、"outside the working directory" 三类错误，并包含路径。

**4. 在 PowerShell 中运行 `pi-test` 失败**

- 现象：PowerShell 提示找不到命令，或脚本执行出错。
- 原因：`pi-test.sh` 是 bash 脚本，不是 PowerShell 命令。
- 解决：直接运行 `pi -e <扩展路径>`；扩展路径在 PowerShell 中用反斜杠，例如 `.\packages\coding-agent\examples\extensions\hello.ts`。

**5. 测试失败后临时目录残留**

- 现象：系统临时目录里越来越多 `pi-suite-*` 目录。
- 原因：`h.cleanup()` 没有在失败路径执行。
- 解决：每个用例用 `try/finally`，在 `finally` 中调用 `h.cleanup()`。

## 下一篇

没有下一篇。本篇是毕业项目。若想继续深入外围模块，可以阅读下面的选读部分，并按其中列出的主题（MCP、durable、client/server、evals）自行选择。

## 选读：源码深入（可选，跳过不影响主线）

**选读，跳过不影响主线。** 以下内容超出毕业项目的要求，适合想继续看外围模块的读者。

### 选读 A：durable 的 `replay` 字段

durable（持久执行模块，`packages/durable/`）在工具上有一个 `replay` 字段，取值为 `"safe"` 或 `"unsafe"`，默认值是 `"unsafe"`。

- `packages/durable/src/harness/tool.ts` 中，`tool.replay ?? "unsafe"` 决定了未声明的工具按 `unsafe` 处理。
- `"safe"` 表示：如果进程崩溃后只知道"工具意图已记录，结果未知"，可以安全地重新执行这个工具。
- `"unsafe"` 表示：不能重放，系统应报告"中断"，而不是重复执行。

对本篇的 `inspect_package` 来说，它只读文件，重放没有副作用，所以可以声明为 `replay: "safe"`。但本篇的规格没有要求声明它。

### 选读 B：AgentTool 的 `replay` 字段（不是同一个字段）

`packages/agent/src/types.ts` 中 `AgentTool` 也有一个 `replay` 字段，但取值是 `"never" | "safe"`。两者名字相同、取值不同，阅读时要区分：

- `packages/agent/src/types.ts` 的 `AgentTool`：`"never"` 表示这类工具在恢复时不重放，`"safe"` 表示可以安全重放。源码注释说明它是"意图已存在、结果未知"时的恢复策略。
- `packages/durable/src/harness/types.ts` 的工具声明：`"safe"` 或 `"unsafe"`。

这种名字重复是历史与包边界造成的。读源码时以所在文件的类型为准，不要把两者混用。

### 选读 C：为什么 `realpath` 要对根目录也调用

如果只对 `target` 调用 `realpath`，而根目录 `ctx.cwd` 本身是符号链接，那么真实根与真实目标可能处于不同的"外壳"中，比较结果不可靠。对根和目标都调用 `realpath`，保证两边使用同一套真实路径规则。

### 选读 D：Windows 上的路径细节

- Windows 路径大小写通常不敏感。本篇未在本地验证 `path.relative` 对 `D:\Repo` 与 `d:\repo` 的比较结果；需要时自行用实验 1 的方法测试。
- UNC 路径（如 `\\server\share`）未在本篇验证，需要单独测试。
- 跨盘符的情况见前文"路径边界规则"一节。

### 选读 E：外围模块概览（选读，不要求完成）

外围模块包括：

- MCP（Model Context Protocol，外部工具接入协议）让远端服务提供工具，`packages/mcp/` 实现客户端。
- codemode 让模型提交一段受控脚本，在脚本内调用注入的工具，`packages/codemode/`。
- client/server（`packages/client/`、`packages/server/`）把会话放在另一个进程。`packages/client/src/client.ts` 中有 `attachment` 状态（`get attachment()`）。断线后旧的 attachment ID 是否失效，未在本地验证。
- telemetry（`packages/telemetry/`）记录带类型的运行事实；evals（`packages/evals/`）用固定任务与重复运行比较方案。

这些模块都依赖本篇的主线：工具、会话、事件。读它们之前，先完成本篇的离线测试。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| 扩展（extension） | 导出工厂函数、可注册工具的 TypeScript 模块 | 核心概念 |
| 工具（tool） | 模型可请求执行的本地函数 | 核心概念 |
| defineTool | pi 提供的工具创建函数 | 核心概念 |
| 参数 schema | 描述工具参数形状的结构，用于运行时校验 | 核心概念 |
| TypeBox | 编写 schema 的库，包内导出名为 `Type` | 核心概念 |
| 路径边界 | 判断目标是否仍在根目录内的规则 | 核心概念 |
| realpath | 把路径解析为真实位置（跟随符号链接） | 真实路径检查 |
| 符号链接 | 指向另一个位置的快捷方式 | 先用一个例子理解 |
| 错误结果 | 带 `isError: true` 的工具结果，会进入会话 | 核心概念 |
| 离线测试 | 不联网、不需要密钥的测试 | 核心概念 |
| faux | 脚本化的假模型，按预设回复 | 核心概念 |
| createHarness | 测试中建立临时会话与假模型的函数 | 源码导览 |
| 工具调用（tool call） | 模型在回复中提出的一次工具执行请求 | 走读一次完整过程 |
| 工具结果（tool result） | 工具执行后形成的结果，回到会话中 | 走读一次完整过程 |
| 只读 | 工具不写文件、不执行外部脚本 | 实现规格 |
