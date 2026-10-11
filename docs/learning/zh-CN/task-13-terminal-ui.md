# 13. 终端 UI、输入和宽度

> 预计时间：2 小时
> 先修：SDK 与进程级协议（`print`、`json`、`rpc` 三种非交互模式）。本篇只需要知道 pi 有 `interactive` 模式，不需要先读 `AgentSession` 的内部实现。

## 本篇你会学到

- 解释终端程序的输入与输出：程序收到的是字节，输出的是文字和控制码。
- 说明 `pi-tui` 的组件如何把状态变成"给定宽度下的若干行字符串"，以及渲染器如何只更新变化的行。
- 用 `visibleWidth`、`truncateToWidth`、`sliceByColumn` 处理中文、颜色码等宽度问题，并能写一个无需模型的组件级检查。

## 先用一个例子理解

假设你在 80 列的终端里运行 pi，输入了一段中英文混排的长提示，然后把窗口缩小到 40 列。

没有宽度处理时会发生这样的事：

```text
组件按字符数截断：text.slice(0, 40)
"A中文B..." 的前 4 个 JS 字符是 "A中文B"，
但它在终端里占 6 列；这一行超过了 40 列的预期，
边框向右溢出，下一行的内容被挤乱。
```

pi 的做法是：组件收到的是"当前宽度"这个数字；它返回的每一行都必须不超过这个宽度。判断"有多宽"要用终端列数，而不是字符串长度。

所以本篇的主线是：

1. 终端只认字节和控制码，pi 要自己把界面画出来。
2. 组件按宽度返回行；渲染器比较前后两帧，只写变化的部分。
3. 宽度计算要用专门的函数。
4. 按键不能写死，要通过键位表查询。
5. 交互模式启动时有固定的顺序，顺序错了就会出现"界面还没出来，对话框已经想弹出"之类的问题。

## 核心概念

**终端（terminal）**：屏幕加键盘的程序接口。程序向标准输出写入文字和控制码，从标准输入读取按键字节。终端本身不理解"组件"或"布局"，这些都要程序自己算。

例子：下面这行命令让终端把 `红` 显示成红色，然后恢复默认颜色。终端只是执行这些字节，并不知道它在画一个"按钮"。

```text
输出字节：ESC [ 3 1 m 红 ESC [ 0 m LF
终端动作：切到红色 -> 写入 "红" -> 恢复默认颜色 -> 换行
```

**转义序列与 ANSI 码（escape sequence）**：以 `\x1b`（ESC 字符）开头的一串字节，用来控制终端，例如颜色、光标移动、同步输出。`\x1b[31m` 表示"之后的文字用红色"，`\x1b[0m` 表示"恢复默认样式"。这些字节在屏幕上不占列，但会让 JS 字符串变长。

为什么需要：如果颜色码不被识别为"不占列"，每个带颜色的字符串都会被算成很宽，边框就会对不齐。所以 pi 的宽度函数要能跳过这些字节。

**组件（component）**：有 `render(width)` 方法的对象，返回一个字符串数组，每个元素是一行。它可以有 `invalidate()`，用来在状态或主题变化后清掉缓存。`pi-tui` 的 `Component` 接口定义在 `packages/tui/src/tui.ts`。

为什么需要：如果每个界面片段都直接往终端写字，窗口一变宽或一变窄，就要人工改每一处。让组件只返回"给定宽度下的行"，布局变化就只需要再调用一次 `render`。

例子：一个只显示一行状态的组件，宽度 8 和宽度 4 会返回不同的行。下面的 `status.render(4)` 只返回不超过 4 列的文字。这个形状就是 pi 要求的组件契约，不需要继承任何基类。

**差分渲染（differential rendering）**：渲染器保存上一帧的行，新一帧出来后找出第一行和最后一行变化的位置，只重写这一段。它的目的是减少闪烁和写入量。实现主要在 `packages/tui/src/tui-main-screen.ts`，里面用 `firstChanged`、`lastChanged` 等变量记录范围。

为什么需要：如果 50 行界面里只有 1 行变了，全量重写会把 50 行都送进终端。差分渲染只送那 1 行。下面"深入一点"中的例子展示了这个比较过程。

**显示宽度（display width）**：文字在终端中占的列数。ASCII 字母通常占 1 列，常见中文占 2 列，ANSI 码占 0 列，有些 emoji 占 2 列。`visibleWidth` 计算的就是这个值。

例子：`"A中文B"` 的 JS 长度是 4，显示宽度是 6。如果用 `.length` 判断"能不能放进 5 列"，会误判为"能放下"，实际上超出了一列。

**键位表（keybindings）**：把"动作名"映射到"按键"的表。例如动作 `app.clear` 默认是 `ctrl+c`。代码查询的是动作名，用户可以在配置里改键。`pi-tui` 的表叫 `TUI_KEYBINDINGS`，`coding-agent` 的合并表叫 `KEYBINDINGS`。

为什么需要：如果代码里写的是 `if (data === "\x03")`，用户就无法改键，而且 Windows 与 macOS 的默认键不同时，每个平台都要改代码。查动作名可以把差异留在键位表里。

## 深入一点：组件、宽度、按键怎样配合

本节不引入新概念，只把上面的六个概念连起来。

### 组件的三条规则

`packages/coding-agent/docs/tui.md` 对组件的要求可以归纳为三条：

```text
1. 每一行都不能超过传入的 width。
2. 测量"可见列数"，不要测字符串长度。ANSI 码、宽字符、emoji、组合字符都会改变列数。
3. 每一行的样式要自己带上。pi 在每行末尾会重置样式，所以下一行不会继承上一行的颜色。
```

第 3 条的意思是：每一行都要自己写 `\x1b[...m` 和对应的 `\x1b[0m`，不能指望前一行的颜色延续。

三条规则的文字来自 `packages/coding-agent/docs/tui.md` 的 "Understand the component model" 一节。下面用一个例子说明每条为什么重要。

- 第 1 条。组件收到 `width = 4`，内容是 `ABCDEFG`。返回 `ABCD` 是对的；返回 `ABCDEFG` 会让这一行超过 4 列，终端会自动折行，下一行的内容被挤乱。
- 第 2 条。内容 `中文` 的 `.length` 是 2，但占 4 列。如果组件用 `.length <= width` 判断，宽度 3 时会错误地认为"放得下"。
- 第 3 条。第 1 行写了 `\x1b[31m` 但没有写 `\x1b[0m`。第 2 行没有任何颜色码，但终端仍显示红色。pi 在每行末尾重置样式，所以第 2 行不会变红；如果组件自己不写 `\x1b[0m`，它依赖的是上一行的状态，这种依赖在行被单独重绘时就会失效。

### 一帧是怎样产生的

```text
状态变化
  -> 相关组件 invalidate()（清掉缓存）
  -> tui.requestRender()（请求一帧，多次请求会合并）
  -> doRender() 调用每个组件的 render(width)，得到新行数组
  -> 与上一帧比较，找出 firstChanged 与 lastChanged
  -> 输出 \x1b[?2026h（开始同步输出）
  -> 只重写 firstChanged 到 lastChanged 之间的行
  -> 输出 \x1b[?2026l（结束同步输出）
```

同步输出（`\x1b[?2026h` 与 `\x1b[?2026l`）让终端把这一段写入当作一次原子更新。它解决的是"写到一半被看到"的撕裂问题。差分渲染解决的是"每帧全量重写导致闪烁"的问题。两者一起用：只写变化的部分，并且写完整再显示。

调用方不需要自己防抖。多次 `requestRender()` 会合并成一次渲染。

### 一帧的逐步例子

下面的组件只有两行。它不是 pi 的真实组件，只是为了看清楚"状态 -> 行 -> 比较 -> 输出"这条路。代码与输出都在本地运行过（实验 7 保存的脚本就是这份代码）。

```js
const { truncateToWidth, visibleWidth } = await import("file:///D:/Github/pi/packages/tui/src/utils.ts");
const status = {
  items: ["A中文B🙂", "idle"],
  render(width) { return this.items.map((text) => truncateToWidth(text, width)); },
  invalidate() {},
};
const prev = status.render(8);            // 阶段 1：用宽度 8 渲染上一帧
status.items[1] = "running 3 tools";      // 阶段 2：状态变化
status.invalidate();
const next = status.render(8);            // 阶段 2：重新渲染下一帧
let firstChanged = -1;                    // 阶段 3：找第一行和最后一行变化
let lastChanged = -1;
for (let i = 0; i < Math.max(prev.length, next.length); i++) {
  const oldLine = i < prev.length ? prev[i] : "";
  const newLine = i < next.length ? next[i] : "";
  if (oldLine !== newLine) {
    if (firstChanged === -1) firstChanged = i;
    lastChanged = i;
  }
}
const rows = next.slice(firstChanged, lastChanged + 1);   // 阶段 4：只取要重写的行
console.log("stage 1 prev frame:", JSON.stringify(prev));
console.log("stage 2 next frame:", JSON.stringify(next));
console.log("stage 2 visible widths:", JSON.stringify(next.map((l) => visibleWidth(l))));
console.log("stage 3 firstChanged:", firstChanged, "lastChanged:", lastChanged);
console.log("stage 4 rows to rewrite:", JSON.stringify(rows));
console.log("stage 4 bytes:", JSON.stringify("\x1b[?2026h" + rows.join("\r\n") + "\x1b[?2026l"));
```

本地输出（逐阶段）：

```text
stage 1 prev frame: ["A中文B🙂","idle"]
stage 2 next frame: ["A中文B🙂","runni\u001b[0m...\u001b[0m"]
stage 2 visible widths: [8,8]
stage 3 firstChanged: 1 lastChanged: 1
stage 4 rows to rewrite: ["runni\u001b[0m...\u001b[0m"]
stage 4 bytes: "\u001b[?2026hrunni\u001b[0m...\u001b[0m\u001b[?2026l"
```

每个阶段的意思：

1. 阶段 1：`render(8)` 把 `A中文B🙂` 放进 8 列。它正好 8 列，所以不截断。`idle` 不超宽，原样返回。
2. 阶段 2：`running 3 tools` 超过 8 列，`truncateToWidth` 截成 `runni` 加 `...`。截断后的文字外面包了重置码 `\u001b[0m`，这是 `truncateToWidth` 的行为，保证省略号不继承前面的颜色。
3. 阶段 3：逐行比较。第 0 行相同，第 1 行不同，所以 `firstChanged = 1`、`lastChanged = 1`。
4. 阶段 4：只把第 1 行放进输出，前后加同步输出标记。第 0 行不写入终端，终端保留原来的内容。

画成图，两帧的差别如下：

```text
行  上一帧 prev（宽 8）     下一帧 next（宽 8）         是否重写
0   A中文B🙂                A中文B🙂                    否（相同）
1   idle                    runni...（省略号在末尾）    是（firstChanged=1, lastChanged=1）

写入终端的内容：ESC[?2026h + 第 1 行 + ESC[?2026l
```

说明：

- 这个例子省略了光标定位。真实的 `TuiMainScreen` 在 `packages/tui/src/tui-main-screen.ts` 中还要处理光标位置、kitty 图片和视口滚动。本例只演示"比较与范围"这一步，比较循环与真实实现的写法相同。
- `rows.join("\r\n")` 是简化写法。真实实现在写每一行之前也会输出 `\r\n`，见 `tui-main-screen.ts` 中逐行写入的循环。
- 阶段 4 的输出只包含变化的行。这就是"差分"的含义：没变的行不发送。

### 宽度的常见陷阱

下表的数据来自实验（`visibleWidth` 的结果在本地 Node v23.9.0 上测得）。

| 输入 | `.length` | `visibleWidth` | 说明 |
| --- | --- | --- | --- |
| `abc` | 3 | 3 | ASCII 每个字符 1 列 |
| `中文` | 2 | 4 | 汉字每个 2 列 |
| `\x1b[31m` | 5 | 0 | ANSI 码不占列 |
| `🙂界` | 3 | 4 | emoji 2 列，汉字 2 列 |
| `é`（e 加组合重音） | 2 | 1 | 两个码点组成一个用户看到的字符 |

结论：`.length` 只用于"有多少个 UTF-16 代码单元"这类问题，不用于布局。`slice(0, width)` 可能切断 ANSI 码或 emoji 序列，所以布局代码要用 `truncateToWidth`、`sliceByColumn`、`wrapTextWithAnsi`。

下面是 8 个典型输入的测量结果（实验 8 的脚本输出）。每一列的含义：

- `length`：JS 字符串的 `.length`，按 UTF-16 代码单元计数。
- 码点数：`[...s].length`，按 Unicode 码点计数。
- 字形簇数：`Intl.Segmenter` 按"用户看到的一个字符"切分后的数量。
- `visibleWidth`：pi 计算的终端列数。

| 输入（名称） | `length` | 码点数 | 字形簇数 | `visibleWidth` | 为什么是这个值 |
| --- | --- | --- | --- | --- | --- |
| `a`（ASCII） | 1 | 1 | 1 | 1 | 可打印 ASCII 每个 1 列 |
| `中`（CJK） | 1 | 1 | 1 | 2 | 东亚宽字符占 2 列 |
| `🙂`（emoji，U+1F642） | 2 | 1 | 1 | 2 | 这个 emoji 在 JS 中是一个代理对（2 个代码单元），终端占 2 列 |
| `é`（`e` + U+0301 组合重音） | 2 | 2 | 1 | 1 | 组合重音不占列，它跟在 `e` 后面，两者合成一个字形 |
| 家庭 emoji（三个人 + 两个 ZWJ） | 8 | 5 | 1 | 2 | ZWJ（零宽连接符，U+200D）把多个 emoji 连成一个图形，按一个 2 列图形计算 |
| `\x1b[31m`（ANSI 颜色码） | 5 | 5 | 5 | 0 | 转义序列不显示，不占列 |
| `Ａ`（全角 A，U+FF21） | 1 | 1 | 1 | 2 | 全角字母占 2 列 |
| 国旗（两个区域指示符） | 4 | 2 | 1 | 2 | 两个区域指示符合成一个国旗，pi 按 2 列计算 |

从表中可以推出两个截断错误的例子（不需要再运行）：

- `"A中文B".slice(0, 2)` 得到 `"A中"`。`A` 占 1 列，`中` 占 2 列，共 3 列，超过了要求的 2 列。
- `"é"` 的 `length` 是 2，但它只占 1 列。如果用 `length` 估算"有多宽"，会比实际多算一列，布局会提前换行。

注意：表中的 `visibleWidth` 是 pi 的计算结果。真实终端对 ZWJ 家庭 emoji 与国旗的显示取决于字体与终端程序。pi 的宽度函数与终端不一致时，问题会表现为"边框偏移一列"。这一点在本地没有在真实终端上验证。

`sliceByColumn` 的参数是 `(line, startCol, length, strict)`：

- `startCol`：从第几列开始，从 0 计数。
- `length`：取多少列，不是结束列。
- `strict`：为真时，不取会超出范围的宽字符。

### 宽度函数怎么选

| 需求 | 用哪个 |
| --- | --- |
| 测量一行占多少列 | `visibleWidth` |
| 把一行截到最多 N 列，超出部分用省略号 | `truncateToWidth` |
| 取从第 `startCol` 列开始的 `length` 列 | `sliceByColumn` |
| 按列宽换行，并保留颜色码 | `wrapTextWithAnsi` |
| 统计字符数（不影响布局） | `.length` 或 `Array.from(text).length` |

规则：凡是影响布局的地方，都用前四个函数。`.length` 只用于不影响屏幕位置的计算。

### 按键：动作名、默认键和用户覆盖

按键处理分三层：

1. **动作名**：代码里只出现 `app.clear`、`app.message.followUp` 这样的名字，表示"要做什么"。
2. **默认键**：定义在 `TUI_KEYBINDINGS`（`packages/tui/src/keybindings.ts`）和 `KEYBINDINGS`（`packages/coding-agent/src/core/keybindings.ts`）中，每项有 `defaultKeys`，平台差异也在这里处理。
3. **用户覆盖**：用户在 agent 目录的 `keybindings.json` 中为动作指定新键。文档描述的规则是：配置值替换默认键；空数组表示禁用。

用户覆盖的示例（`keybindings.json` 的形式，内容为示意；它的规则已在本地验证，见下文的覆盖测试与实验 9）：

```json
{
  "app.session.new": "ctrl+shift+n",
  "app.session.tree": ["ctrl+shift+t", "alt+shift+t"],
  "tui.altScreen.pageUp": []
}
```

本地运行得到的默认值（实验 5）：

- `app.clear` 默认 `ctrl+c`；`app.exit` 默认 `ctrl+d`。
- `app.message.followUp` 在 Windows 上默认 `ctrl+q`。这一点由 `useWindowsKeybindings()` 决定，Windows 与 WSL 返回真。
- `app.suspend` 在 Windows 上默认为空数组，即禁用。
- `app.tools.expand` 默认 `ctrl+o`。

下表列出常用动作的默认键。"Windows 默认" 列来自实验 9 的本地运行。"非 Windows 默认" 列是读源码得到的（`packages/coding-agent/src/core/keybindings.ts` 中 `process.platform` 与 `windowsKeybindings` 分支），未在本地运行：

| 动作名 | 非 Windows 默认（源码推断） | Windows 默认（本地运行） | 说明 |
| --- | --- | --- | --- |
| `app.interrupt` | `escape` | `escape` | 取消或中断当前操作 |
| `app.clear` | `ctrl+c` | `ctrl+c` | 清空编辑器（启动期即可用） |
| `app.exit` | `ctrl+d` | `ctrl+d` | 编辑器为空时退出 |
| `app.suspend` | `ctrl+z` | `[]`（禁用） | 挂起到后台；Windows 没有这个操作 |
| `app.message.followUp` | `alt+enter` | `ctrl+q` | 排队一条后续消息 |
| `app.tools.expand` | `ctrl+o` | `ctrl+o` | 展开或折叠工具输出 |
| `app.editor.external` | `ctrl+g` | `ctrl+g` | 用外部编辑器编辑输入 |
| `app.model.select` | `ctrl+l` | `ctrl+l` | 打开模型选择器 |
| `app.thinking.cycle` | `shift+tab` | `shift+tab` | 切换思考级别 |
| `app.session.tree` | `[]`（无默认） | `[]`（无默认） | 打开会话树，需要用户配置 |
| `tui.input.submit` | `enter` | `enter` | 提交输入 |
| `tui.input.newLine` | `shift+enter`、`ctrl+j` | `shift+enter`、`ctrl+j` | 插入换行 |
| `tui.editor.undo` | `ctrl+-` | `ctrl+z` | 撤销；Windows 分支覆盖为 `ctrl+z` |
| `tui.select.cancel` | `escape`、`ctrl+c` | `escape`、`ctrl+c` | 取消选择 |
| `tui.altScreen.pageUp` | `pageUp` | `pageUp` | 全屏模式向上翻一页 |

读表时注意两点：

- `app.session.tree` 默认是空数组。这种动作没有默认键，用户要在 `keybindings.json` 中指定，它才会生效。
- 同一个动作名在不同平台上可能是不同的键。代码只写动作名，平台差异留在表里。

覆盖测试（实验 9 的本地输出）说明了用户配置的规则：

- 用户写了 `"app.exit": []`，所以 `app.exit` 的键集合为空，`matches("\x04", "app.exit")` 返回 `false`。空数组表示禁用，而不是回退到默认键。
- 用户没有写 `app.clear`，所以它保留默认 `ctrl+c`。
- 用户写了 `"app.session.tree": ["ctrl+shift+t", "alt+shift+t"]`，它的键集合就是这两个键。
- 两个动作认领同一个键时，`getConflicts()` 会报告冲突。输入 `{"app.exit": "ctrl+x", "app.clear": "ctrl+x"}` 时，输出是 `[{"key":"ctrl+x","keybindings":["app.exit","app.clear"]}]`。冲突只是报告，本地运行时没有阻止加载。

在代码里判断按键时，要用 `matchesKey(data, keyId)`，并且 `keyId` 应该来自动作的默认键表或键位管理器，而不是写死字符串。`AGENTS.md` 的规则是：不要写 `matchesKey(keyData, "ctrl+x")` 这样的硬编码判断，新增快捷键要加到默认键表。

### 输入法与光标位置

输入法（例如中文拼音）的候选框要显示在真实光标附近。终端只知道"硬件光标"的位置，所以组件要做两件事：

- 实现 `Focusable` 接口（定义在 `packages/tui/src/tui.ts`）。
- 在视觉光标前放 `CURSOR_MARKER`（同文件导出，值是 `\x1b_pi:c\x07`）。TUI 通过这个标记找到光标位置。

包裹 `Input` 或 `Editor` 的容器必须把自己的 `focused` 状态传给子组件。否则候选框会出现在错误的位置。

### 为什么需要原始模式（raw mode）和 SIGINT

问题：终端默认是"熟模式"（cooked mode，也叫行模式）。例子：你在普通命令行里输入 `abc`，再按 Backspace 删掉 `c`。程序在你按下 Enter 之前什么都收不到，收到的是整行 `ab`。删除字符、回显文字、把 Ctrl+C 变成中断信号，都是终端驱动替程序做的。

这对全屏式界面不够用。编辑器要在每个按键后立刻更新，`↑` 要用来选择历史输入，pi 要自己画光标。所以 pi 要切到原始模式（raw mode）：每个按键字节直接交给程序，驱动不再做行缓冲、不回显、也不把 Ctrl+C 变成信号。

pi 的实现在 `packages/tui/src/terminal.ts` 的 `ProcessTerminal.start()`。它先保存 `process.stdin.isRaw`，再调用 `process.stdin.setRawMode(true)`，然后打开 bracketed paste。`stop()` 用保存的值恢复。`interactive-mode.ts` 的注释也写明，TUI 的 `stop()` 会恢复熟模式。

最小例子（实验 10 的本地输出）：把 `\x03` 通过管道交给一个子进程。子进程的 stdin 不是终端，所以 `isTTY` 与 `setRawMode` 都是 `undefined`，`\x03` 原样到达：

```text
child isTTY: undefined setRawMode: undefined
child got: "\u0003" [ 3 ]
```

为什么是这个结果：管道中没有终端驱动，没有任何转换，字节 `3`（即 `\x03`）直接成为数据。这说明 `setRawMode(true)` 只在真正的终端里有作用。在真实终端的原始模式中，用户按 Ctrl+C 也会得到同一个字节，区别在于程序能不能看到它。

SIGINT 是操作系统的中断信号。在熟模式下，驱动把 `\x03` 转成 SIGINT，发给前台进程。默认行为是结束进程。在原始模式下这个转换不发生，程序收到的只是字节。所以 pi 要自己用 `matchesKey` 判断 Ctrl+C，才能决定"清空编辑器"还是"退出"。

Node 用 `process.on("SIGINT", handler)` 注册监听器。实验 10 的第二部分在本地 Windows 上做了一个测试：进程给自己发送 SIGINT。结果是监听器没有运行，进程以退出码 1 结束，也没有输出。这说明 Windows 上 `process.kill(process.pid, "SIGINT")` 不等于终端按下 Ctrl+C，不能用它来验证监听器。Linux、macOS 与 WSL 上真实终端的 Ctrl+C 行为未在本地验证。

### 一次按键的路径

```text
用户按下 Ctrl+C
  -> 终端把它作为字节 \x03 发给程序
  -> 程序处于 raw 模式时，这只是一个字节，不会变成 SIGINT 信号
  -> 焦点组件用 matchesKey(data, keyId) 判断字节是否命中某个动作的默认键
  -> 命中 app.clear，调用应用层注册的处理函数
  -> 处理函数修改状态，并调用 requestRender()
  -> 下一帧渲染，界面更新
```

实验 5 已验证：`matchesKey("\x03", "ctrl+c")` 为 `true`，`KEYBINDINGS["app.clear"].defaultKeys` 为 `"ctrl+c"`。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径（相对仓库根） | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/tui/src/utils.ts` | `visibleWidth` | 忽略 ANSI 码，按 grapheme（用户看到的一个字符）计算列数 |
| 2 | `packages/tui/src/utils.ts` | `truncateToWidth` | 截断时保留 ANSI 码，并在末尾加省略号 `...` |
| 3 | `packages/tui/src/utils.ts` | `sliceByColumn`、`sliceWithWidth` | 第三个参数是列数（不是结束列）；`strict` 为真时不切开超出范围的宽字符 |
| 4 | `packages/tui/src/tui.ts` | `Component`、`Focusable`、`CURSOR_MARKER`、`TUI` | 组件契约；光标标记用于输入法候选框定位 |
| 5 | `packages/tui/src/tui-main-screen.ts` | `TuiMainScreen` | 差分渲染；同步输出序列 `\x1b[?2026h` 与 `\x1b[?2026l` |
| 6 | `packages/tui/src/terminal.ts` | `ProcessTerminal`、`writeLogPath` | `PI_TUI_WRITE_LOG` 如何解析为文件路径或目录 |
| 7 | `packages/tui/src/keybindings.ts` | `TUI_KEYBINDINGS`、`Keybindings` | 基础动作表与默认键 |
| 8 | `packages/coding-agent/src/core/keybindings.ts` | `KEYBINDINGS`、`useWindowsKeybindings`、`AppKeybindings` | 应用动作表；Windows 上 `app.message.followUp` 默认是 `ctrl+q` |
| 9 | `packages/coding-agent/src/modes/interactive/tui-renderer.ts` | `createInteractiveTui`、`createInteractiveTuiReference` | 按模式选择渲染器；稳定引用 |
| 10 | `packages/coding-agent/src/modes/interactive/chat-viewport.ts` | `createChatViewport` | 转录区与输入区的布局 |
| 11 | `packages/coding-agent/src/modes/interactive/interactive-mode.ts` | `init`、`run`、`mountInteractiveTui`、`getUserInput`、`renderInitialMessages`、`rebindCurrentSession` | 启动顺序与主循环 |

建议先读 1 到 3，再读 4 和 5。第 6 到 8 读完后，用 `KEYBINDINGS` 的默认值来理解键位。第 9 到 11 只在需要理解启动顺序时读。

## 走读一次完整过程

下面的过程从"启动 `pi` 交互模式"开始，到"等待用户第一次输入"为止。

1. **选择渲染器。** `createInteractiveTui`（`tui-renderer.ts`）根据 `tuiMode` 返回 `TuiMainScreen` 或 `TuiAltScreen`。普通模式使用 `TuiMainScreen`，终端保留自己的滚动历史。状态变化：此时还没有任何组件挂到渲染器上。

2. **进入 `init()`。** `interactive-mode.ts` 的 `init` 先检查 `isInitialized`，已初始化则直接返回。之后注册信号处理函数，这样启动到一半按 Ctrl+C 也能退出。

3. **打印启动前的提示。** 如果有模型作用域设置，`init` 用 `console.log` 直接写到终端。此时 TUI 还没有 `start()`，这些行会留在终端的滚动历史里。

4. **建组件树。** `createChatViewport`（`chat-viewport.ts`）创建转录区 `ScrollView` 与底部输入区 `VStack`。底部从上到下是待发消息、状态行、可选 widget、编辑器、可选 widget、页脚。编辑器设置了 `minSize: 3`，收缩时至少保留 3 行。状态变化：组件已创建，但还没有显示。

5. **挂载到渲染器。** `mountInteractiveTui` 把上面的组件挂到当前渲染器。之后切换 regular 与 fullscreen 时，组件树可以重新挂到新渲染器，而组件不必重建。

6. **设置启动期按键。** 启动期间只绑定三个动作：清空或中断（`app.clear`，即 Ctrl+C）、退出（Ctrl+D）、提交（`onSubmit`）。其他键位要等后面的步骤完成后再启用。

7. **启动 UI。** `ui.setFocus(...)` 设置焦点，然后 `ui.start()` 开始接收输入和渲染。代码注释说明这一步在扩展初始化之前，原因是扩展的 `session_start` 处理函数可能要弹出对话框，而对话框需要已经启动的 TUI。`isInitialized` 在这里设为 `true`。

8. **等待终端颜色。** 头部和启动提示会把主题色写进字符串，所以要等终端回报自己的颜色。`waitForTerminalColors` 最多等 100 毫秒，超时就用默认值，避免慢终端卡住启动。

9. **构建头部。** 头部内容由函数生成，主题变化后会重新取色。`supportsPiLogo()` 决定显示 logo 还是纯文字标题。

10. **下载或定位外部工具。** `ensureTool("fd", ...)` 与 `ensureTool("rg", ...)` 并行执行。`fd` 用于自动补全，`rg` 用于 grep 工具和 bash 相关功能。下载进度通过 `showManagedToolStatus` 显示在状态行。UI 已经可见，所以下载慢也不会像"卡死"。

11. **启用完整输入。** `setupKeyHandlers` 与 `setupEditorSubmitHandler` 替换启动期的按键处理。之后调用 `ui.requestRender()` 刷新一帧。

12. **绑定会话和恢复历史。** `rebindCurrentSession()` 把扩展绑到当前会话，`session_start` 在这里触发。之后 `renderInitialMessages()` 把已有的会话历史渲染成组件。注释说明扩展先于历史消息显示。

13. **进入 `run()` 的主循环。** `run()` 先调用 `await this.init()`，然后在后台启动模型目录刷新、版本检查和包更新检查。这些检查都不阻塞主循环。然后处理命令行传入的初始消息，最后进入 `while (true)`：`getUserInput()` 等待用户提交，再调用 `session.prompt(...)`。

结果：界面可见、键位可用、会话历史已显示，程序停在 `getUserInput()` 等待第一次输入。

## 动手实验

以下实验都不需要模型账号，也不需要 tmux。第一个实验大约 5 分钟。

### 实验 1：测量字符串长度与显示宽度

目的：看到 `length` 与 `visibleWidth` 的差别。

步骤：在系统临时目录写一个脚本，导入仓库里的 `utils.ts`，运行后删除脚本。

PowerShell：

```powershell
$dir = Join-Path $env:TEMP ("pi-task13-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
$script = Join-Path $dir "width.mjs"
@'
const { visibleWidth, truncateToWidth } = await import("file:///D:/Github/pi/packages/tui/src/utils.ts");
const plain = "A中文B";
const styled = `\x1b[31m${plain}\x1b[0m`;
console.log("length:", plain.length, "width:", visibleWidth(plain));
console.log("styled length:", styled.length, "width:", visibleWidth(styled));
console.log("truncate 4:", JSON.stringify(truncateToWidth(styled, 4)), visibleWidth(truncateToWidth(styled, 4)));
'@ | Set-Content -Path $script -Encoding utf8
node $script 2>$null
Remove-Item -Recurse -Force $dir
```

bash：

```bash
D=$(mktemp -d)
cat > "$D/width.mjs" <<'EOF'
const { visibleWidth, truncateToWidth } = await import("file:///D:/Github/pi/packages/tui/src/utils.ts");
const plain = "A中文B";
const styled = `\x1b[31m${plain}\x1b[0m`;
console.log("length:", plain.length, "width:", visibleWidth(plain));
console.log("styled length:", styled.length, "width:", visibleWidth(styled));
console.log("truncate 4:", JSON.stringify(truncateToWidth(styled, 4)), visibleWidth(truncateToWidth(styled, 4)));
EOF
node "$D/width.mjs" 2>/dev/null
rm -rf "$D"
```

预期输出（在本地运行得到，Node v23.9.0）：

```text
length: 4 width: 6
styled length: 13 width: 6
truncate 4: "\u001b[31mA\u001b[0m...\u001b[0m" 4
```

说明：`A中文B` 的 JS 长度是 4，但占 6 列。带颜色码后长度变成 13，宽度仍是 6。`truncateToWidth` 截到 4 列，保留了颜色码，末尾是 `...`。

注意：Node 23 会打印一条 `ExperimentalWarning`（类型剥离）。上面的命令用 `2>/dev/null` 或 `2>$null` 隐藏它。Node 22.19 及以上版本也支持直接导入 `.ts` 文件。

### 实验 2：渲染一个最小组件到字符串

目的：理解"组件给定宽度返回行"的契约，并观察截断与切片。

步骤：写一个只有 `render` 和 `invalidate` 的对象，分别用宽度 8、4、2 调用，再用 `sliceByColumn` 切几次。这个对象没有继承任何类，只要结构符合 `Component` 即可。

PowerShell：

```powershell
$dir = Join-Path $env:TEMP ("pi-task13-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
$script = Join-Path $dir "component.mjs"
@'
const { truncateToWidth, visibleWidth, sliceByColumn } = await import("file:///D:/Github/pi/packages/tui/src/utils.ts");
const label = {
  text: "A中文B\u{1F642}",
  render(width) { return [truncateToWidth(this.text, width)]; },
  invalidate() {},
};
for (const width of [8, 4, 2]) {
  const [line] = label.render(width);
  console.log(`width=${width} line=${JSON.stringify(line)} visible=${visibleWidth(line)} ok=${visibleWidth(line) <= width}`);
}
console.log("sliceByColumn('A中文B', 1, 2)       =", JSON.stringify(sliceByColumn("A中文B", 1, 2)));
console.log("sliceByColumn('A中文B', 1, 1)       =", JSON.stringify(sliceByColumn("A中文B", 1, 1)));
console.log("sliceByColumn('A中文B', 1, 1, true) =", JSON.stringify(sliceByColumn("A中文B", 1, 1, true)));
console.log("sliceByColumn('A中文B', 0, 3, true) =", JSON.stringify(sliceByColumn("A中文B", 0, 3, true)));
'@ | Set-Content -Path $script -Encoding utf8
node $script 2>$null
Remove-Item -Recurse -Force $dir
```

bash：

```bash
D=$(mktemp -d)
cat > "$D/component.mjs" <<'EOF'
const { truncateToWidth, visibleWidth, sliceByColumn } = await import("file:///D:/Github/pi/packages/tui/src/utils.ts");
const label = {
  text: "A中文B\u{1F642}",
  render(width) { return [truncateToWidth(this.text, width)]; },
  invalidate() {},
};
for (const width of [8, 4, 2]) {
  const [line] = label.render(width);
  console.log(`width=${width} line=${JSON.stringify(line)} visible=${visibleWidth(line)} ok=${visibleWidth(line) <= width}`);
}
console.log("sliceByColumn('A中文B', 1, 2)       =", JSON.stringify(sliceByColumn("A中文B", 1, 2)));
console.log("sliceByColumn('A中文B', 1, 1)       =", JSON.stringify(sliceByColumn("A中文B", 1, 1)));
console.log("sliceByColumn('A中文B', 1, 1, true) =", JSON.stringify(sliceByColumn("A中文B", 1, 1, true)));
console.log("sliceByColumn('A中文B', 0, 3, true) =", JSON.stringify(sliceByColumn("A中文B", 0, 3, true)));
EOF
node "$D/component.mjs" 2>/dev/null
rm -rf "$D"
```

预期输出（在本地运行得到）：

```text
width=8 line="A中文B🙂" visible=8 ok=true
width=4 line="A\u001b[0m...\u001b[0m" visible=4 ok=true
width=2 line="\u001b[0m..\u001b[0m" visible=2 ok=true
sliceByColumn('A中文B', 1, 2)       = "中"
sliceByColumn('A中文B', 1, 1)       = "中"
sliceByColumn('A中文B', 1, 1, true) = ""
sliceByColumn('A中文B', 0, 3, true) = "A中"
```

说明：

- 宽度 2 时，省略号只剩两个点，且所有行都满足 `visible <= width`，这就是组件契约。
- `sliceByColumn(line, 1, 1)` 从第 1 列取 1 列。`中` 占第 1 到 2 列，非严格模式下会取出整个字符，结果宽度为 2，超过了请求的 1 列。
- 严格模式 `strict = true` 不会切开宽字符，因此 `sliceByColumn("A中文B", 1, 1, true)` 返回空字符串。`sliceByColumn("A中文B", 0, 3, true)` 返回 `"A中"`，因为 `A` 占 1 列，`中` 占 2 列，正好 3 列。

注意：这个实验只验证组件返回的字符串。它不证明真实终端的显示结果，因为终端字体、emoji 支持和 Windows Terminal 的设置都会影响最终显示。

### 实验 3：查看 `PI_TUI_WRITE_LOG` 的解析规则

目的：知道该把哪种值传给 `PI_TUI_WRITE_LOG`。

规则（来自 `packages/tui/src/terminal.ts` 的 `writeLogPath` 初始化）：

- 如果值是一个已存在的目录，pi 会在该目录下生成 `tui-<时间戳>-<进程号>.log`。
- 否则，值被当作文件路径直接使用。
- 设成 `1` 不会开启任何特殊功能。`1` 会被当作文件名，pi 会在当前目录写一个名为 `1` 的文件。

bash 写法（指定文件路径）：

```bash
PI_TUI_WRITE_LOG="$HOME/tui-task13.log" pi
```

PowerShell 写法（指定文件路径）：

```powershell
$env:PI_TUI_WRITE_LOG = "$HOME\tui-task13.log"
pi
Remove-Item Env:PI_TUI_WRITE_LOG
```

bash 写法（指定目录）：

```bash
mkdir -p /tmp/pi-tui-logs && PI_TUI_WRITE_LOG=/tmp/pi-tui-logs pi
```

PowerShell 写法（指定目录）：

```powershell
New-Item -ItemType Directory -Force -Path "$env:TEMP\pi-tui-logs" | Out-Null
$env:PI_TUI_WRITE_LOG = "$env:TEMP\pi-tui-logs"
pi
Remove-Item Env:PI_TUI_WRITE_LOG
```

说明：这里的 `pi` 是交互模式命令，需要模型账号才能完成一次对话。本实验只验证路径规则，没有在本地启动交互模式。若只想看原始输出，可以先启动 pi，不发送任何消息，然后退出，再打开日志文件。日志内容未在本地验证。

### 实验 4：写一份最小复现说明

目的：把一次界面问题写成别人能复现的格式。

格式：

```text
输入文本：A中文B🙂
终端宽度：8 列，然后缩到 4 列
操作序列：渲染 -> 缩窄 -> 放宽
期望：每一行的可见宽度 <= 当前宽度，省略号完整
实际：（填写你的观察，例如某行超宽）
层级判断：组件层（用 visibleWidth 测量）还是终端层（看 PI_TUI_WRITE_LOG 的原始字节）
```

完成后，如果组件层的测量都通过，问题更可能在布局、光标或终端状态。如果组件层就失败，先检查宽度函数的使用。

### 实验 5：查看默认键位与 matchesKey

目的：确认默认键位表中的值，并确认 `matchesKey` 的基本用法。

步骤：在临时目录写一个脚本，导入 `KEYBINDINGS` 和 `matchesKey`，运行后删除。

PowerShell：

```powershell
$dir = Join-Path $env:TEMP ("pi-task13-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
$script = Join-Path $dir "keys.mjs"
@'
const { KEYBINDINGS } = await import("file:///D:/Github/pi/packages/coding-agent/src/core/keybindings.ts");
const { matchesKey } = await import("file:///D:/Github/pi/packages/tui/src/keys.ts");
console.log("platform:", process.platform);
for (const id of ["app.clear", "app.exit", "app.message.followUp", "app.suspend", "app.tools.expand"]) {
  console.log(id, "=>", JSON.stringify(KEYBINDINGS[id].defaultKeys));
}
console.log("matchesKey(ctrl+c):", matchesKey("\x03", "ctrl+c"));
console.log("matchesKey(escape):", matchesKey("\x1b", "escape"));
'@ | Set-Content -Path $script -Encoding utf8
node $script 2>$null
Remove-Item -Recurse -Force $dir
```

bash：

```bash
D=$(mktemp -d)
cat > "$D/keys.mjs" <<'EOF'
const { KEYBINDINGS } = await import("file:///D:/Github/pi/packages/coding-agent/src/core/keybindings.ts");
const { matchesKey } = await import("file:///D:/Github/pi/packages/tui/src/keys.ts");
console.log("platform:", process.platform);
for (const id of ["app.clear", "app.exit", "app.message.followUp", "app.suspend", "app.tools.expand"]) {
  console.log(id, "=>", JSON.stringify(KEYBINDINGS[id].defaultKeys));
}
console.log("matchesKey(ctrl+c):", matchesKey("\x03", "ctrl+c"));
console.log("matchesKey(escape):", matchesKey("\x1b", "escape"));
EOF
node "$D/keys.mjs" 2>/dev/null
rm -rf "$D"
```

预期输出（在 Windows 本地运行得到，`platform` 因系统而异）：

```text
platform: win32
app.clear => "ctrl+c"
app.exit => "ctrl+d"
app.message.followUp => "ctrl+q"
app.suspend => []
app.tools.expand => "ctrl+o"
matchesKey(ctrl+c): true
matchesKey(escape): true
```

说明：在 Linux 或 macOS 上，`app.message.followUp` 应为 `"alt+enter"`，这是按 `useWindowsKeybindings()` 分支推断的，未在本地验证。

### 实验 6：检查宽度契约（组件层回归检查）

目的：用固定的输入和宽度，验证 `truncateToWidth` 与 `wrapTextWithAnsi` 的输出都满足"每行不超过宽度"。这是写组件时最基本的回归检查。

步骤：对 4 组输入、宽度 1 到 20 逐一截断，并检查每行的 `visibleWidth`。另外对 `wrapTextWithAnsi` 的结果做同样的检查。

输入清单（与实际界面问题对应）：

- `中文标题`：宽字符。
- 家庭 emoji（由 `\u{1F468}\u200D\u{1F469}\u200D\u{1F467}` 组成，三个人加两个零宽连接符）：多码点序列。
- `\x1b[31m彩色\x1b[0m`：带 ANSI 颜色码。
- 一段很长的中英文混排单行：超长输入。

PowerShell：

```powershell
$dir = Join-Path $env:TEMP ("pi-task13-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $dir | Out-Null
$script = Join-Path $dir "contract.mjs"
@'
const { truncateToWidth, visibleWidth, wrapTextWithAnsi } = await import("file:///D:/Github/pi/packages/tui/src/utils.ts");
const inputs = [
  "中文标题",
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} 家庭 emoji",
  "\x1b[31m彩色\x1b[0m",
  "这是一段很长很长的单行文本 with ASCII and 中文混排 long enough to need truncation",
];
let failures = 0;
for (const text of inputs) {
  for (let width = 1; width <= 20; width++) {
    const line = truncateToWidth(text, width);
    if (visibleWidth(line) > width) { failures++; console.log("FAIL", JSON.stringify(text), width, JSON.stringify(line)); }
  }
  for (const line of wrapTextWithAnsi(text, 10)) {
    if (visibleWidth(line) > 10) { failures++; console.log("WRAP FAIL", JSON.stringify(line)); }
  }
}
console.log("cases:", inputs.length * 20, "+ wrap checks");
console.log("failures:", failures);
console.log("family emoji visibleWidth:", visibleWidth("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"));
console.log("wrap 10 of 中文标题中文:", JSON.stringify(wrapTextWithAnsi("中文标题中文", 10)));
'@ | Set-Content -Path $script -Encoding utf8
node $script 2>$null
Remove-Item -Recurse -Force $dir
```

bash：

```bash
D=$(mktemp -d)
cat > "$D/contract.mjs" <<'EOF'
const { truncateToWidth, visibleWidth, wrapTextWithAnsi } = await import("file:///D:/Github/pi/packages/tui/src/utils.ts");
const inputs = [
  "中文标题",
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467} 家庭 emoji",
  "\x1b[31m彩色\x1b[0m",
  "这是一段很长很长的单行文本 with ASCII and 中文混排 long enough to need truncation",
];
let failures = 0;
for (const text of inputs) {
  for (let width = 1; width <= 20; width++) {
    const line = truncateToWidth(text, width);
    if (visibleWidth(line) > width) { failures++; console.log("FAIL", JSON.stringify(text), width, JSON.stringify(line)); }
  }
  for (const line of wrapTextWithAnsi(text, 10)) {
    if (visibleWidth(line) > 10) { failures++; console.log("WRAP FAIL", JSON.stringify(line)); }
  }
}
console.log("cases:", inputs.length * 20, "+ wrap checks");
console.log("failures:", failures);
console.log("family emoji visibleWidth:", visibleWidth("\u{1F468}\u200D\u{1F469}\u200D\u{1F467}"));
console.log("wrap 10 of 中文标题中文:", JSON.stringify(wrapTextWithAnsi("中文标题中文", 10)));
EOF
node "$D/contract.mjs" 2>/dev/null
rm -rf "$D"
```

预期输出（在本地 bash 运行得到；PowerShell 版本未单独运行，脚本内容相同）：

```text
cases: 80 + wrap checks
failures: 0
family emoji visibleWidth: 2
wrap 10 of 中文标题中文: ["中文标题中","文"]
```

说明：

- `failures: 0` 表示 80 组截断结果都满足契约。如果出现 `FAIL` 行，说明组件或宽度函数有问题，先修宽度处理，再看布局。
- 家庭 emoji 由三个人形加两个零宽连接符（ZWJ，`\u200D`）组成，终端通常显示为一个 2 列的图形。`visibleWidth` 返回 2，与此一致。不同终端对这类序列的支持不同，所以界面测试要在目标终端上确认。
- `wrapTextWithAnsi("中文标题中文", 10)` 第一行是 5 个汉字，占 10 列；第二行是剩下的 `文`。

## 宽度回归检查清单

写或改组件时，用下面的输入和宽度做检查。它们对应前面实验中出现过的问题类型。

| 输入 | 宽度 | 检查什么 |
| --- | --- | --- |
| `中文标题` | 20、8、4 | 宽字符不超宽，不切半个汉字 |
| 家庭 emoji 序列 | 20、4 | 不被切断，不超宽 |
| `\x1b[31m彩色\x1b[0m` | 20、4 | 颜色码不占列，末尾样式被重置 |
| 超长单行 | 20 | 截断后有省略号，且不超宽 |
| 同一输入 | 20 缩到 4 再放到 20 | 缩放前后结果一致，没有残留旧行 |

最后一行对应"窗口缩放"。在组件层，它可以用多次调用 `render(width)` 模拟；在真实终端中，需要人工缩放窗口观察。

## 自测题

1. 为什么 `"A中文B".length` 是 4，而 `visibleWidth("A中文B")` 是 6？
2. 组件的 `render(width)` 需要满足什么规则？它为什么不能只用 `text.slice(0, width)`？
3. 差分渲染比较的是什么？它为什么需要 `invalidate()`？
4. 为什么代码里应该写 `KEYBINDINGS` 的动作名，而不是写 `matchesKey(data, "ctrl+c")`？
5. 交互模式为什么先调用 `ui.start()`，再调用 `rebindCurrentSession()`？

## 常见错误

1. **现象**：中文行超出边框，或换行位置不对。
   **原因**：用 `text.length` 或 `text.slice` 计算宽度。
   **解决**：用 `visibleWidth` 测量，用 `truncateToWidth` 截断。
2. **现象**：切换主题后，组件仍显示旧颜色。
   **原因**：把带颜色的字符串存在了组件状态里，`invalidate()` 没有重建它。
   **解决**：每次 `render` 时重新生成带颜色的字符串，或在 `invalidate()` 中清掉缓存。
3. **现象**：按 Ctrl+C 没有退出，而是清空了编辑器。
   **原因**：这是默认键位 `app.clear` 的行为（`KEYBINDINGS` 中 `app.clear` 默认 `ctrl+c`）。
   **解决**：如果想改退出键，修改 `keybindings.json` 中 `app.exit` 或 `app.clear` 的映射。
4. **现象**：Windows 上找不到 Alt+Enter 的 follow-up 行为。
   **原因**：`app.message.followUp` 在 Windows 上默认是 `ctrl+q`，在其他平台是 `alt+enter`（见 `packages/coding-agent/src/core/keybindings.ts`）。
   **解决**：在 Windows 上使用 Ctrl+Q，或在 `keybindings.json` 中自定义。
5. **现象**：设置 `PI_TUI_WRITE_LOG=1` 后，当前目录多出一个名为 `1` 的文件，没有日志。
   **原因**：`1` 被当作文件路径。
   **解决**：改为完整的文件路径或已存在的目录。

## 参考答案

1. `length` 按 UTF-16 代码单元计数，`A` 与 `B` 各 1 个，两个汉字各 1 个，共 4。终端按列显示，两个汉字各占 2 列，共 6 列。
2. 每一行的 `visibleWidth` 都要不大于传入的宽度。`slice(0, width)` 按字符切，会把宽字符切开，也可能切断 ANSI 码或 emoji 序列。应该用 `truncateToWidth` 或 `sliceByColumn`。
3. 比较上一帧与当前帧的行，找出第一行和最后一行变化的位置，只重写这一段。`invalidate()` 用来清掉组件的缓存，否则组件可能继续返回旧的带颜色字符串。
4. 用户可以在 `keybindings.json` 里改键位；写死按键会让配置失效。动作名经过键位表查询，配置生效。
5. `ui.start()` 让 TUI 能显示并接收输入。扩展的 `session_start` 在 `rebindCurrentSession()` 中触发，可能需要弹出对话框，所以必须先启动 UI。

## 选读：源码深入（交互模式装配与启动）

选读，跳过不影响主线。本节放的是 `interactive-mode.ts` 的装配细节，适合需要修改启动流程时阅读。

### 目录地图

```text
packages/coding-agent/src/modes/interactive/
├── interactive-mode.ts     主类：装配、启动、提交、渲染派发、停止
├── tui-renderer.ts         渲染器选择与稳定引用
├── chat-viewport.ts        转录区 + 固定输入区布局
├── model-catalog-refresh.ts 启动时的模型目录刷新
├── external-editor.ts      外部编辑器
├── components/             消息、工具、选择器、页脚等组件
└── theme/                  主题系统
```

`interactive-mode.ts` 很大，不要从头通读。读启动序列时，从 `init` 与 `run` 开始即可。

### 稳定引用：`createInteractiveTuiReference`

问题：组件在构造时拿到 `TUI` 对象。用户可能在运行中切换 regular 与 fullscreen，渲染器对象会被替换。如果组件还持有旧对象，就会调用到已经停止的渲染器。

解法：`createInteractiveTuiReference(getTui)` 返回一个 `Proxy`。组件持有的是这个代理，每次调用方法时，代理通过 `getTui()` 取当前渲染器，并把方法绑定到它上面。代价是每次属性访问多一层间接调用，所以方法路径做了缓存。

这样做的原因是组件可能来自扩展。扩展只拿到一个 `TUI` 对象，不需要为渲染器切换改代码。

### 布局：`createChatViewport`

`createChatViewport` 返回的根节点是垂直两段：

- 转录区 `ScrollView`：`basis: 0`，`grow: 1`，占据剩余空间。`follow: "end"` 让流式输出自动滚到底部。
- 输入区 `VStack`：`basis: "auto"`，按内容高度。编辑器的 `minSize: 3` 保证至少 3 行。

widget 通过条件展开加入布局。没有 widget 时，布局数组里根本不存在对应项，而不是插入一个空组件。

### 启动序列的顺序约束

下表列出几个顺序约束，以及代码注释给出的原因。

| 顺序 | 原因 |
| --- | --- |
| 信号处理最先注册 | 启动到一半按 Ctrl+C 也要能退出 |
| `ui.start()` 早于扩展初始化 | 扩展的 `session_start` 可能弹对话框 |
| 等终端颜色回报后再建头部 | 头部把主题色写进字符串，颜色未知会错 |
| UI 挂载后再下载 `fd`、`rg` | 下载慢时用户仍能看到界面 |
| `rebindCurrentSession()` 早于 `renderInitialMessages()` | 扩展资源先显示，历史消息后显示 |
| 后台检查都用 `void` 或 `.then` | 启动路径不被网络检查阻塞 |

### 主循环与输入

`run()` 的主循环是串行的：`getUserInput()` 等待一次提交，然后 `session.prompt(...)` 完成后再等待下一次提交。运行中的输入（流式期间按回车）由编辑器与队列处理，走 steer 或 follow-up 路径，不经过这个循环。具体分支需要从编辑器事件继续往下读。

### 交互模式与核心的边界

| 维度 | `AgentSession` 负责 | 交互模式负责 |
| --- | --- | --- |
| 运行 | prompt 循环、工具、压缩、重试 | 决定何时调用 `prompt`（编辑器提交或初始消息） |
| 状态 | 唯一数据源（状态与事件） | 把事件变成组件更新 |
| 资源 | 会话、扩展、设置的生命周期 | 终端的启动与停止 |
| 失败 | 以结果或事件的形式报告 | 用 `showError`、`showWarning` 显示 |

交互模式只消费 `AgentSession` 的公开接口，不修改核心。

### 未在本地验证的内容

- 启动序列的完整 12 步细节来自对 `interactive-mode.ts` 的阅读，只核对了符号（`init`、`run`、`ensureTool`、`rebindCurrentSession`、`renderInitialMessages`、`getUserInput`、`mountInteractiveTui`、`createChatViewport`、`handleStartupSubmit`）存在，没有在本地启动交互模式。
- `footer-data-provider.ts` 在旧笔记中出现过，但当前目录列表中没有它，本篇不引用。
- tmux 交互测试只在 Linux、macOS 或 WSL 中可用，本篇没有运行。`.pi/skills/interactive-testing.md` 中有 tmux 步骤，需要时再读。

## 下一篇

下一篇讲测试与调试。我们会学习如何运行单个测试文件、如何为组件写回归测试、以及如何提交一个可评审的小改动。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| 终端（terminal） | 程序通过字节与屏幕、键盘交互的接口 | 核心概念 |
| 转义序列（escape sequence） | 以 ESC 开头、控制终端的字节串 | 核心概念 |
| 组件（component） | 有 `render(width)` 的对象，返回若干行字符串 | 核心概念 |
| 差分渲染（differential rendering） | 只重写与上一帧不同的行 | 核心概念 |
| 显示宽度（display width） | 文字在终端中占的列数 | 核心概念 |
| 键位表（keybindings） | 动作名到按键的映射 | 核心概念 |
| 同步输出（synchronized output） | 用 `\x1b[?2026h` 与 `\x1b[?2026l` 包住一帧，让终端一次性显示 | 源码导览 |
| 光标标记（CURSOR_MARKER） | 放在可见光标前的标记，用于定位输入法候选框 | 源码导览 |
| 稳定引用（Proxy 引用） | 组件持有的代理，每次调用时取当前渲染器 | 选读 |
