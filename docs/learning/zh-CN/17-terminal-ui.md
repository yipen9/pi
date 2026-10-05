# 第 17 章：终端 UI

> 学完本章你能回答：
>
> 1. `pi-tui` 的组件模型是什么？"差分渲染"与"同步输出"各解决什么问题？
> 2. 为什么"字符长度 ≠ 终端显示宽度"？该用哪些工具函数？
> 3. 输入、焦点与 IME（中文输入法）之间的坑在哪？
> 4. 键位系统怎么工作？为什么不能硬编码按键判断？
> 5. 自定义界面（widget/overlay/自定义编辑器）应该怎么做、不该怎么做？

**前置知识**：第 13 章（`ctx.ui`）、第 14 章（工具渲染）。
**预计学习时间**：1.5 天（偏实践：用 tmux 做交互实验）。
**本章验证状态**：静态核对通过（`packages/coding-agent/docs/tui.md`、`keybindings.md`、`packages/tui/README.md` 与键位代码结构核对）；实验 L11 设计中。

---

## 17.1 `pi-tui`：一套独立的终端 UI 框架

`packages/tui` 是**与业务无关**的终端 UI 库（第 0 章的"核心四包"之一），`coding-agent` 的交互模式建立在它之上。它的特性清单（`packages/tui/README.md`）几乎就是"终端应用的难题列表"及其答案：

| 特性 | 解决的问题 |
|---|---|
| **可互换渲染器**（main-screen / alternate-screen，共享 `TUI` 接口） | 有的场景要保留回滚缓冲（main），有的要全屏自管（alternate） |
| **差分渲染**（只更新变化的行/视口行） | 每次全量重绘会闪烁、且浪费带宽 |
| **同步输出**（CSI 2026 原子更新） | 帧内多行更新对用户"同时出现"，不闪 |
| **括号粘贴模式**（bracketed paste） | 大段粘贴（>10 行）需要标记起止，避免被逐字符解释 |
| **组件模型**（`Component.render()`） | 界面由可组合单元构成 |
| **应用自管滚动**（alt-screen 视口支持鼠标/触控板/键盘） | 全屏模式下回滚缓冲归应用所有 |
| **内联图片**（Kitty / iTerm2 图形协议） | 终端里显示图片 |
| **自动补全**（文件路径、斜杠命令） | 编辑器体验 |

一个最小程序（README 的 Quick Start 改写 + 注释）：

```typescript
import { ProcessTerminal, Text, TuiMainScreen, matchesKey } from "@earendil-works/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TuiMainScreen(terminal);          // 具体渲染器只在这里出现
tui.addChild(new Text("Welcome to my app!"));
tui.setFocus(/* 某个组件 */);
tui.addInputListener((data) => {
	// 原始模式下 Ctrl+C 不会送 SIGINT，需要自己拦截
	if (matchesKey(data, "ctrl+c")) { tui.stop(); process.exit(0); }
});
tui.start();
```

三个要点：

1. **`TUI` 是共享接口**（组件管理、焦点、overlay、输入、生命周期、终端查询、渲染）；只有"构造应用"时才选具体渲染器——业务代码不绑死 main/alternate；
2. **raw 模式下没有 SIGINT**：Ctrl+C 只是普通按键数据，必须自己拦截（这是所有终端框架的共性，不是 pi 特有）；
3. **不要自己造第二套渲染器**（`tui.md` 原文：Do not create a second terminal renderer inside an extension）——直接画 ANSI 会与差分渲染打架。

## 17.2 组件模型：`render(width)` 的契约

`tui.md` 的组件定义（ paraphrase + 原文要点）：

- 组件为**给定宽度**渲染一个**行数组**（每行一个字符串）；
- 可选处理键盘/鼠标输入；
- **状态或主题变化时，必须让缓存输出失效**（`invalidate()`）。

三条硬规则：

```text
1. 每一行都必须适配传入的宽度；
2. 测量"可见终端列数"，而不是字符串长度——ANSI 转义、宽字符（CJK）、emoji、
   组合字符都会改变显示宽度；
3. 每一行末尾 pi 会重置样式与超链接，所以每行都要重新施加样式。
```

对应工具函数（**不要自己实现宽度处理**）：

| 函数 | 用途 |
|---|---|
| `visibleWidth(text)` | 可见列数（忽略 ANSI、按 Unicode 宽度算） |
| `truncateToWidth(text, width)` | 按可见宽度截断 |
| `sliceByColumn(text, start, end)` | 按列区间切片 |
| `wrapTextWithAnsi(text, width)` | 保留 ANSI 的换行 |

渲染刷新流程：

```text
改状态 → 相关组件 invalidate() → tui.requestRender()
（TUI 会合并多次请求，统一更新终端——不用自己防抖）
```

## 17.3 内置组件库：先组合，再自造

`tui.md` 点名的组件（写扩展 UI 的"标准件"）：

| 分类 | 组件 |
|---|---|
| 内容 | `Text`、`Markdown`、`Image`、`TruncatedText` |
| 布局 | `Container`、`VStack`、`HStack`、`Box`、`Spacer` |
| 输入 | `Input`、`Editor` |
| 选择 | `SelectList`（可搜索）、`SettingsList`（设置流） |
| 视口 | `ScrollView`（有界可滚动） |
| 进行中 | `Loader`、`CancellableLoader` |
| 指针 | `MouseRegion` |

原则：**选择、滚动、文本编辑、宽度处理都优先复用**——这些正是"看起来简单、边界极多"的模块（第 14.7 节的 `tools.ts` 示例就是 `SettingsList` + `Container` 的组合）。

## 17.4 输入、焦点与 IME：中文用户最关心的一节

### 17.4.1 按键解析与可配置键位

- 用 `matchesKey()` / `Key` 解析键盘输入；解析器考虑了终端协议差异与修饰键；
- **扩展组件应使用注入的 `KeybindingsManager`** 处理"可配置的应用动作"——而不是写死按键。

### 17.4.2 光标与 IME（中文输入法的正确位置）

两条原文要求：

```text
A component that displays a text cursor should implement `Focusable` and place
`CURSOR_MARKER` immediately before its visual cursor. The TUI uses that marker to position
the hardware cursor for input method editors.

Containers that wrap an `Input` or `Editor` must propagate their `focused` state to that child.
Without propagation, Chinese, Japanese, Korean, and other IME candidate windows can appear at
the wrong screen position.
```

翻译成场景：你自定义了一个"带边框的输入区"，把 `Input` 包在 `Box` 里。如果 `Box` 没有把"聚焦状态"传给孩子，**输入法候选框会飘到屏幕中间或左上角**——因为系统不知道真实光标在哪。修法就是两条：实现 `Focusable` + 放 `CURSOR_MARKER`；容器**传递 focused 状态**。

### 17.4.3 替换主编辑器：扩展 `CustomEditor`

要换掉主输入框时：

- **继承 `CustomEditor`**（不要从零写），它会保留应用快捷键与 agent 控制；
- **不认识的键要转发给基类**（否则用户熟悉的快捷键失灵）；
- 想恢复默认：清掉自定义编辑器工厂。

## 17.5 鼠标：全屏模式才是"应用处理"

两种模式的行为差异（`tui.md`）：

| 模式 | 鼠标归属 |
|---|---|
| 全屏（alternate screen） | 归一化事件路由到组件：可标记已处理、捕获拖拽、请求焦点/渲染 |
| 常规模式 | **留给终端**（终端拥有回滚缓冲），应用不要抢 |

全屏内的默认路由规则：

- **未处理的滚轮事件** → 滚动最近的 `ScrollView`；
- **未处理的主键拖拽** → 保留给"转录区选择"；
- **OSC 8 链接优先于包围它的点击区域**（点链接打开链接，不是命中父区域）。

最后一条设计纪律（与你写的任何扩展交互相关）：

```text
Design every interaction with a keyboard path even when fullscreen mouse input is available.
```

**鼠标是增强，键盘是基线**——在 print/RPC/不支持鼠标的环境里，功能不能丢。
## 17.6 自定义屏幕与 overlay

当内置对话框不够用时，才轮到 `ctx.ui.custom()`。它的契约（`tui.md` 原文要点）：

```text
`ctx.ui.custom()` temporarily gives one component control of the interactive area and resolves
when that component calls the supplied completion callback.
```

一个最小形态：

```typescript
await ctx.ui.custom((tui, theme, keybindings, done) => {
	const component = {
		render(width: number) { return [theme.fg("accent", "按 Esc 关闭")]; },
		invalidate() {},
		handleInput(data: string) {
			if (matchesKey(data, "escape")) done(undefined);   // 结束交互 → Promise resolve
		},
	};
	return component;
});
```

规则清单（全部来自官方文档，逐条重要）：

| 规则 | 说明 |
|---|---|
| `overlay: true` | 画在既有内容**之上**；选项控制尺寸、锚点、偏移、边距、响应式可见性 |
| `OverlayHandle.setHidden()` | 临时隐藏/显示，**交互仍然活跃**（不是结束） |
| 焦点所有权 | 已聚焦的 overlay 会在普通渲染中**保持输入所有权**；要让别的组件收输入，必须**显式**释放/改焦点 |
| 一实例一交互 | 每次开始交互都**新建**组件实例；不要复用 |
| 完成方式 | 调工厂收到的**完成回调**（它 resolve Promise 并销毁组件） |
| 禁止 | 对 `ctx.ui.custom()` 创建的 overlay 调 `OverlayHandle.hide()` |

定位/堆叠/焦点/响应式/动画的完整行为参考 `examples/extensions/overlay-qa-tests.ts`（仓库里最大的示例之一，专门做 QA 矩阵）——**要写复杂 overlay 前先读它**。

## 17.7 主题：语义色与具体色的分工

### 17.7.1 用传进来的 theme

```typescript
return new Text(
	theme.style("Done!", { fg: "success", bg: "toolSuccessBg", bold: true }),
	0, 0,
);
```

- `theme.style()`：前景/背景 + 属性（粗体等）组合；
- 颜色值可以是**语义 token**（accent、muted、success、warnings、errors、tool 输出、Markdown 等）或**具体 `Color`**；
- **位置有讲究**：前景 token 放 `fg`、背景 token 放 `bg`；要"把背景色当文字色"，取具体值：`{ fg: theme.colors.userMessageBg }`；
- 需要颜色运算用 `mixColors()`；
- token 被主题设为"终端默认色"时，用终端自己的颜色；`theme.colors` 报"终端宣告的颜色"（没宣告则给猜测值）；`theme.appearance`（`"dark"`/`"light"`）用于决定"提亮还是压暗"；
- pi 按终端能力把结果转成 truecolor 或 256 色；**token 每主题只转换一次**——能预算的具体色就别放进 render 路径。

### 17.7.2 两个"存储陷阱"

```text
Do not permanently store strings with theme colors unless invalidate() rebuilds them.
A theme change clears render caches, but it cannot remove old ANSI colors embedded in
application state.
```

翻译：**不要把带颜色的字符串长期存在你的状态里**——主题切换清的是渲染缓存，清不掉你状态里已固化的 ANSI 序列。要么每次渲染现算（无状态组件完全没问题），要么在 `invalidate()` 里重建。

Markdown 渲染用 `getMarkdownTheme()`，保证与应用主题一致。

## 17.8 渲染性能与调试

### 17.8.1 性能纪律（`tui.md`）

```text
1. 渲染跑在交互关键路径上——把昂贵的布局/高亮按"宽度 + 内容"缓存，
   并在 invalidate() 里清掉；
2. 默认视图保持紧凑，细节用展开或独立屏幕呈现；
3. 自定义工具渲染要处理 partial results，并在能安全更新时复用上一个组件。
```

### 17.8.2 调试渲染问题

- **`PI_TUI_WRITE_LOG` 环境变量**：捕获发给终端的原始 ANSI 流——"看得见的乱码"背后到底发了什么字节，一目了然；
- 必测矩阵（写/改组件时）：**窄宽度、宽字符、resize 事件、主题切换、焦点迁移、常规与全屏两种模式**。

## 17.9 键位系统：从配置文件到代码表

### 17.9.1 用户视角

- pi 的快捷键由**命名动作**（如 `app.session.new`）到按键的映射组成；
- 用户在 `<agent-dir>/keybindings.json` 里覆盖：

```json
{
  "app.session.new": "ctrl+shift+n",
  "app.session.tree": ["ctrl+shift+t", "alt+shift+t"],
  "tui.altScreen.pageUp": []
}
```

- 配置值**替换**该动作的默认键位；**空数组 = 禁用**；
- `/hotkeys` 查看当前生效键位；改文件后 `/reload` 生效。

### 17.9.2 键语法

```text
modifier+key：修饰键 ctrl / shift / alt / super（可组合）
字母 a-z；数字 0-9；
特殊键：escape(esc) enter(return) tab space backspace delete insert clear
        home end pageUp pageDown up down left right
功能键 f1-f12；符号（` - = [ ] \ ; ' , . / ! @ # $ % ^ & * ( ) _ + | ~ { } : < > ?）
示例：ctrl+shift+x、alt+ctrl+x、super+k、ctrl+1
```

`super` 需要终端单独上报修饰键（通常是 Kitty 键盘协议）——不支持的终端里可能无效（第 2 章 Windows 键位配置一节也提过）。

### 17.9.3 代码视角：默认表怎么组织

- `pi-tui` 提供基础表（`TUI_KEYBINDINGS`）与 `Keybindings` 接口；
- `coding-agent` 的 `core/keybindings.ts` 合并出应用总表（`KEYBINDINGS`），其中 `app.*` 动作带 `defaultKeys` 与 `description`；
- **平台差异**在同一处处理：`useWindowsKeybindings()` 判断 Windows 与 WSL，并调整默认值。例如：

```typescript
export const KEYBINDINGS = {
	...TUI_KEYBINDINGS,
	"tui.editor.undo": {
		...TUI_KEYBINDINGS["tui.editor.undo"],
		defaultKeys: process.platform === "win32" ? "ctrl+z" : windowsKeybindings ? "alt+z" : "ctrl+-",
	},
	"app.suspend": {
		defaultKeys: process.platform === "win32" ? [] : "ctrl+z",   // Windows 上禁用挂起
		description: "Suspend to background",
	},
	// ...
};
```

### 17.9.4 开发规则（来自 `AGENTS.md`）

```text
Never hardcode key checks (e.g. matchesKey(keyData, "ctrl+x")).
Add defaults to DEFAULT_EDITOR_KEYBINDINGS or DEFAULT_APP_KEYBINDINGS so they stay configurable.
```

注意：仓库规则给的是历史名称；当前代码里的实际结构是 `pi-tui` 的 `TUI_KEYBINDINGS` 与 `coding-agent` 的 `KEYBINDINGS`（见 17.9.3）。**原则不变**：新增快捷键要进默认键位表（保持可配置），代码里通过键位系统查询动作，而不是写死按键字符串。查代码时以当前表为准。

Windows Terminal 的键位限制（Shift+Enter、Alt+Enter 被保留/改写）见 `docs/terminal-setup.md`；键位参考全表见 `docs/keybindings.md`。

## 17.10 宽度问题的本质：为什么"字符数"是错的

把一段中英文混排文本按"字符数"对齐，常见三种错：

| 元素 | 字符数 | 实际列数 |
|---|---|---|
| ASCII `abc` | 3 | 3 |
| 中文 `你好` | 2 | **4**（全角） |
| ANSI 颜色序列 `\x1b[31m` | 5 个字符 | **0 列** |
| emoji `👨👩👧`（ZWJ 序列） | 多个码点 | 2 列 |
| 组合音标 `é`（e + ́） | 2 | 1 |

所以：

- `text.length` 只该用于"码点数量"这类场景，**不能用于布局**；
- `slice(0, width)` 可能把 ANSI 序列或 emoji 序列**切一半**——终端显示直接坏掉；
- 正确工具：`visibleWidth` / `truncateToWidth` / `sliceByColumn` / `wrapTextWithAnsi`（17.2 节）。

**测试输入清单**（写组件时固定用它们验收）：`中文标题`、`👨👩👧 家庭 emoji`、`\x1b[31m彩色\x1b[0m`、超长单行、窄宽度（如 20 列）、窗口 resize。

## 17.11 实验 L11：中文与宽度的最小复现

**实验性质**：交互实验（tmux）+ 组件级验证；不依赖真实模型。
**验证状态**：设计中。目标（规划文档 L11）："中文、长行、缩放输入 → 终端问题最小复现"。

### 材料

仓库自带的交互测试指引 `.pi/skills/interactive-testing.md`（AGENTS.md 要求交互测试前先读它）：

```bash
tmux new-session -d -s pi-test -x 80 -y 24
tmux send-keys -t pi-test "./pi-test.sh" Enter
sleep 3 && tmux capture-pane -t pi-test -p
tmux send-keys -t pi-test "输入一段中文：你好，世界 🌏" Enter
tmux resize-window -t pi-test -x 40 -y 24   # 模拟缩放
tmux capture-pane -t pi-test -p
tmux kill-session -t pi-test
```

### 步骤

1. 按上面流程启动、输入含中文与 emoji 的文本，观察 80 列下的换行位置；
2. **缩放到 40 列**，再观察：文本是否重排？边框是否错位？输入光标在字中/行尾位置是否正确？
3. 写一个**最小组件实验**（不接模型）：一个扩展，用 `visibleWidth`/`truncateToWidth` 渲染固定文本，分别用"正确工具"和"`slice` 硬切"两版对比，在 40/80 列下截图；
4. 用 `PI_TUI_WRITE_LOG=1` 启动，找出两种实现的原始输出差异；
5. 产出：一份"最小复现说明"——**输入文本 + 宽度 + 操作序列 + 期望/实际**（第 19 章会把这套格式用于故障报告）。

### 判定标准

- 复现不依赖模型调用，可在组件层稳定重现；
- 能解释错位发生在哪一层（渲染字符串生成 vs 终端显示），并给出正确工具的选择理由；
- 缩放操作不破坏"每行必须适配宽度"的契约。

### 清理

`tmux kill-session`；删除临时扩展；`git status` 干净。

## 17.12 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 中文/emoji 行错位 | 用 `length`/`slice` 处理宽度 | 一律用 pi-tui 宽度工具（17.10） |
| 界面闪烁/撕裂 | 绕过差分渲染自己画 ANSI | 只通过组件与 `requestRender` |
| UI 不更新 | 改了状态没 `invalidate()` | 状态变化的组件必须失效缓存 |
| 切换主题后旧颜色残留 | 把带色字符串存进了状态 | 渲染现算，或在 `invalidate()` 重建 |
| 输入法候选框位置飘 | 容器没把 `focused` 传给 `Input/Editor`，或缺 `CURSOR_MARKER` | 17.4.2 两条要求 |
| overlay 关了但交互没结束 | 调了 `hide()` 而不是完成回调 | `ctx.ui.custom` 的 overlay 用完成回调结束 |
| overlay 复用导致状态串 | 一个实例跑了多次交互 | 一交互一实例 |
| 新增快捷键改键位文件无效 | 代码写死了 `matchesKey` | 进默认键位表 + 通过键位系统查询（17.9.4） |
| 常规模式下鼠标不生效 | 常规模式鼠标归终端 | 设计键盘路径；只有全屏才路由组件 |
| Windows 下某些键不工作 | 终端保留/改写了组合键（super 需 Kitty 协议） | 查 `terminal-setup.md` 与平台默认键位表 |

## 17.13 验收题

1. 差分渲染与同步输出（CSI 2026）分别解决什么问题？两者为什么互补？
2. 列出"每行适配宽度"的四个工具函数，并解释为什么不能按字符数算。
3. 自定义带边框输入区时，为了中文输入法位置正确，必须做哪三件事？
4. `ctx.ui.custom()` overlay 的结束方式？为什么不能对 Hide 调用 `hide()`？焦点如何交还？
5. `theme.style()` 中"前景 token 与背景 token"的互换怎么做？为什么不能长期存储带色字符串？
6. 新增一个快捷键的完整步骤（用户配置、代码默认表、平台差异、验证命令）？
7. 复现一个宽度问题的实验流程（tmux 会话、缩放、最小组件、原始日志）？

### 参考答案（要点）

1. 差分渲染减少更新量、避免重绘闪烁；同步输出让"一帧的多次写"在终端上原子呈现；两者结合=只写变化且写到一半不会被看到。
2. `visibleWidth`、`truncateToWidth`、`sliceByColumn`、`wrapTextWithAnsi`；ANSI 零宽、CJK 双宽、emoji/组合字符长度不定，字符数不等于列数。
3. 组件实现 `Focusable` 并在视觉光标前放 `CURSOR_MARKER`；容器把 `focused` 状态传给子组件；使用内置 `Input/Editor`（而非自绘光标）。
4. 调工厂给的完成回调（resolve Promise 并销毁）；`hide()` 只是临时隐藏、交互仍活跃；焦点通过 overlay handle 显式释放/改焦点。
5. `{ fg: theme.colors.someBgToken }`（取具体色值放另一位置）；主题切换只能清渲染缓存，清不掉状态里固化的 ANSI。
6. 在 `keybindings.json` 支持覆盖（无需改代码即可生效）→ 代码里把默认值加进默认键位表（`TUI_KEYBINDINGS`/`KEYBINDINGS` 对应条目，含平台差异）→ `/reload` 或重启 → `/hotkeys` 验证；不要硬编码按键判断。
7. tmux 起 80x24 → 输入中文/emoji/长行 → `resize-window` 到 40 → 组件级最小复现（两版实现对照）→ `PI_TUI_WRITE_LOG` 看原始字节 → 产出"输入+宽度+序列+期望/实际"说明。

## 17.14 来源与下一章

- `packages/coding-agent/docs/tui.md`（集成点、组件模型、宽度、键盘/IME、鼠标、overlay、主题、性能）；
- `packages/coding-agent/docs/keybindings.md`、`docs/themes.md`、`docs/terminal-setup.md`、`docs/windows.md`；
- `packages/tui/README.md` 与 `packages/tui/src/index.ts`（组件与工具导出）；
- `packages/coding-agent/src/core/keybindings.ts`（`KEYBINDINGS`、`useWindowsKeybindings`、`AppKeybinding`）；
- 示例：`examples/extensions/preset.ts`、`tools.ts`、`qna.ts`、`modal-editor.ts`、`custom-footer.ts`、`widget-placement.ts`、`overlay-qa-tests.ts`、`doom-overlay/`；
- `.pi/skills/interactive-testing.md`（tmux 交互测试指引）。

下一章开始"成为能提交可靠改动的开发者"：测试分层、faux provider 与 harness、如何写出"坏实现会失败"的测试。