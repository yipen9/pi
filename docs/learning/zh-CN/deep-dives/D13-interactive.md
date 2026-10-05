# D13：交互模式（TUI 装配与启动序列）精读

> 精读对象：`modes/interactive/tui-renderer.ts`、`modes/interactive/chat-viewport.ts` 与 `modes/interactive/interactive-mode.ts`（247KB！）的**装配与启动段**（`init`/`run`）与整体结构。
> 对应主线：第 17 章（终端 UI）、第 3 章（入口）。
> 读法：`interactive-mode.ts` 太大，**不要通读**。本篇给"结构地图 + 启动序列逐段"；其余部分（大量 selector/渲染组件）按需从地图定位。

---

## 0. 目录地图：交互模式由什么组成

```text
modes/interactive/
├── interactive-mode.ts        主类（247KB）：装配、启动、编辑提交、渲染派发、选择器管理、停止
├── tui-renderer.ts            渲染器组合根（main/alt screen + 主题样式注入 + Proxy 引用）
├── chat-viewport.ts           布局：ScrollView 转录区 + 固定输入坞（VStack）
├── footer-data-provider.ts    页脚数据（分支、上下文用量等）的提供者/订阅
├── model-catalog-refresh.ts   启动时的目录刷新
├── session-share.ts           会话分享（/share）
├── external-editor.ts         外部编辑器（$EDITOR）
├── components/                40+ 个 UI 组件（消息、工具、选择器、页脚、头图、主题等）
└── theme/                     主题系统（dark/light/system、schema、控制器）
```

【陷阱】"交互模式"的代码量远大于核心会话——但**职责边界很清晰**（第 17 章反复强调的"逻辑与渲染分离"）：它**只消费** `AgentSession` 的公开面（事件/状态/方法），不反向修改核心。本 D13 关注的正是这条边界的**装配方式**。

---

# 第一部分：两个组合根与一个巨型类

## 1. `tui-renderer.ts`：渲染器的"选择"与"注入"

【源码（完整，含重载）】

```typescript
export interface InteractiveTuiOptions {
	readonly tuiMode: "regular" | "fullscreen";
	readonly showHardwareCursor: boolean;
	readonly logDirectory: string;
	readonly terminal?: Terminal;
	readonly onRightClickPaste?: () => void;
	readonly fullscreenCopyOnSelect?: boolean;
	readonly fullscreenWheelScrollLines?: WheelScrollLines;
}

/** Composition root shared by coding-agent presentations. */
export function createInteractiveTui(options: InteractiveTuiOptions & { readonly tuiMode: "fullscreen" }): TuiAltScreen;
export function createInteractiveTui(options: InteractiveTuiOptions & { readonly tuiMode: "regular" }): TuiMainScreen;
export function createInteractiveTui(options: InteractiveTuiOptions): TuiMainScreen | TuiAltScreen;
export function createInteractiveTui(options: InteractiveTuiOptions): TuiMainScreen | TuiAltScreen {
	const terminal = options.terminal ?? new ProcessTerminal();
	if (options.tuiMode === "fullscreen") {
		const styleSearchMatch = (text: string) => theme.bg("searchMatchBg", theme.fg("searchMatchText", text));
		return new TuiAltScreen(terminal, options.showHardwareCursor, options.logDirectory, {
			searchMatchStyle: (text) => theme.underline(styleSearchMatch(text)),
			searchCurrentMatchStyle: (text) => theme.bold(theme.inverse(styleSearchMatch(text))),
			searchNavigationButtonStyle: (text, hovered) => (hovered ? theme.underline(text) : text),
			scrollToEndIndicator: () => {
				const shortcut = keyDisplayText("tui.altScreen.bottom");
				const label = ` ↓ Jump to latest message${shortcut ? ` · ${shortcut}` : ""} `;
				return theme.bg("selectedBg", theme.fg("text", label));
			},
			openUrl: openBrowser,
			onRightClickPaste: options.onRightClickPaste,
			copyOnSelect: options.fullscreenCopyOnSelect,
			wheelScrollLines: options.fullscreenWheelScrollLines ?? "auto",
			copySelection: async (text) => {
				try { await copyToClipboard(text); return true; }
				catch (error) { return error instanceof Error ? error.message : String(error); }
			},
		});
	}
	return new TuiMainScreen(terminal, options.showHardwareCursor, options.logDirectory);
}
```

【注解（三个设计点）】

1. **重载把"模式→具体渲染器类型"变成编译期事实**：传 `tuiMode: "fullscreen"` 的调用方拿到的类型就是 `TuiAltScreen`（能调它的特有方法）；`"regular"` 拿 `TuiMainScreen`。**联合返回类型让调用方各自收窄**——比"返回基接口 + 运行时断言"更安全。
2. **全屏渲染器的行为全部"依赖注入"**：搜索高亮样式（用了主题的语义色 + 下划线/反显修饰）、"跳到最新"的指示器（`keyDisplayText` 生成快捷键提示——**键位系统进 UI 文案**）、**打开 URL**（`openBrowser` 平台工具）、右键粘贴、选择复制、滚轮行数、"复制成功/失败消息"的回传。
   - 【陷阱】`copySelection` 返回 **`true` 或错误字符串**（成功/失败两种类型并存的返回值）——调用方（renderer 内部）据此决定提示什么。**"布尔 + 原因"的合并形态**在小接口里很常见；如果你写类似 API，注意消费端要能区分。
3. **主题通过闭包而非参数**：样式函数直接引用模块级 `theme` 单例（`theme.bg(...)`）——**主题是渲染期读取的全局状态**（第 17.7 节"不要在渲染路径外缓存带色字符串"的实践背景：`theme` 单例在切换时整体替换/失效）。

### 1.1 `createInteractiveTuiReference`：可替换渲染器的稳定引用

【源码（节选）】

```typescript
/** Stable reference for components while InteractiveMode replaces the active renderer. */
export function createInteractiveTuiReference(getTui: () => TUI): TUI {
	return new Proxy({} as TUI, {
		get: (_target, property) => {
			const tui = getTui();
			const value = Reflect.get(tui, property, tui);
			if (typeof value !== "function") return value;
			let methodTui = tui;
			let method = value;
			return (...args: unknown[]) => {
				const currentTui = getTui();
				if (currentTui !== methodTui) {
					// 重新取方法并换绑
					const currentMethod = Reflect.get(currentTui, property, currentTui);
					if (typeof currentMethod !== "function") throw new TypeError(...);
					methodTui = currentTui;
					method = currentMethod;
				}
				return Reflect.apply(method, methodTui, args);
			};
		},
		set: (_target, property, value) => Reflect.set(getTui(), property, value, getTui()),
		has: (_target, property) => Reflect.has(getTui(), property),
		getPrototypeOf: () => Reflect.getPrototypeOf(getTui()),
	});
}
```

【注解】

- **要解决的问题**：组件在构造时拿到 `TUI` 引用；但**用户可以在运行时切换模式（regular ↔ fullscreen）**——渲染器对象被整体替换，旧引用会调用到"死对象"。
- **解法**：Proxy 包装"动态取当前渲染器"的 getter：
  - **方法**：返回一个闭包，每次调用时检查"渲染器是否被替换"（`currentTui !== methodTui`）——被替换则**重新取方法并换绑 `this`**（`Reflect.apply(method, methodTui, args)`）；未替换则复用上次的方法引用（**少一次 Reflect.get** 的微优化）。
  - **非函数属性**：每次读时实时取（`Reflect.get`）。
  - `set`/`has`/`getPrototypeOf` 全部透传给当前渲染器（保持对象语义完整）。
- 【陷阱】这是**"稳定句柄 + 可变实现"**模式的又一实现（对比第 23 章 Chord 的服务 facade、D5 的 `extensionRunnerRef`）：组件永远持有 Proxy，实现随便换。**代价**：每次属性访问多一层（热路径上的属性读会被放大——所以方法路径做了缓存）。读这一段你要能回答："为什么不能直接让组件每次去 `getTui()`？"——【答】组件是**第三方（扩展）写的**，只能收一个 TUI 对象；Proxy 让它们"不用改代码"就获得动态性。

## 2. `chat-viewport.ts`：转录区 + 输入坞的固定布局

【源码（完整）】

```typescript
export interface ChatViewport {
	readonly root: Component;
	readonly transcript: ScrollView;
}

/** Shared fullscreen transcript and fixed input-dock layout. */
export function createChatViewport(options: ChatViewportOptions): ChatViewport {
	const transcript = new ScrollView(options.document, {
		follow: "end",
		primary: true,
		overscroll: "chain",
		scrollbar: options.scrollbar ?? "auto",
		...(options.scrollbarTrackStyle === undefined ? {} : { scrollbarTrackStyle: options.scrollbarTrackStyle }),
		...(options.scrollbarThumbStyle === undefined ? {} : { scrollbarThumbStyle: options.scrollbarThumbStyle }),
	});
	const dock = new VStack([
		{ component: options.pendingMessages, shrink: 1, minSize: 0 },
		{ component: options.status, shrink: 1, minSize: 0 },
		...(options.widgetsAbove === undefined ? [] : [{ component: options.widgetsAbove, shrink: 1, minSize: 0 }]),
		{ component: options.editor, shrink: 1, minSize: 3 },
		...(options.widgetsBelow === undefined ? [] : [{ component: options.widgetsBelow, shrink: 1, minSize: 0 }]),
		{ component: options.footer, shrink: 1, minSize: 0 },
	]);
	return {
		transcript,
		root: new VStack([
			{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]),
	};
}
```

【注解（布局的四个声明）】

1. **顶部 = ScrollView（转录区）**，`follow: "end"`（**自动跟随尾部**——流式输出时滚到底）、`primary: true`（主视口——键盘翻页/搜索的默认目标）、`overscroll: "chain"`（到边界后把滚动"链"给外层——第 17.5 节的滚动语义）。
2. **底部 = VStack（固定输入坞）**，顺序从上有：待发消息区 → 状态行 → 用户 widget（上）→ **编辑器（`minSize: 3`——至少三行）** → 用户 widget（下）→ 页脚。
   - 【陷阱】`minSize: 3` 是编辑器的"不可压缩底线"（别人 shrink 到 0 时它也要保住三行——收缩优先级通过 minSize 表达）。
   - 【陷阱】widget 的插入用**条件展开**（`...(x === undefined ? [] : [...])`）——undefined 时不占布局（不是"渲染空组件"）；**布局数组由"存在的组件"构成**。
3. **根 = 垂直两段**：转录区 `grow: 1`（吃掉剩余空间）+ 输入坞 `basis: "auto"`（按内容需要）。**"上面弹性、下面自适应"**是聊天类 TUI 的经典骨架。
4. 滚动条样式**由调用方注入**（track/thumb 两个可选函数——主题语义色在组合根组装，第 1 节同款）。

【跳转】`ScrollView` 与 `VStack` 的完整语义（follow/primary/overscroll/个字段）在 `packages/tui`（第 17 章 + tui README）；这里只需读懂"谁在上、谁弹性、谁保底"。

---

> D13 第一部分到此。第二部分：`InteractiveMode` 的字段总览、`init()` 的启动序列（12 步逐段）、`run()` 的主循环与异步检查、与核心的边界总结。
---

# 第二部分：`InteractiveMode` 的字段、启动序列与主循环

## 3. 字段总览：一个 TUI 应用的全部状态

`InteractiveMode` 的字段（源码 447-501 行，按职责分组）：

| 组 | 字段（节选） | 说明 |
|---|---|---|
| 运行时 | `runtimeHost`、`renderer`、`ui`、`mainScreenRenderState` | 会话运行时 + 当前渲染器 + TUI 接口 + main-screen 渲染态 |
| 组件树 | `loadedResourcesContainer`、`chatContainer`、`documentContainer`、`transcriptScrollView`、`fullscreenLayoutRoot`、`pendingMessagesContainer`、`statusContainer`、`editorContainer`、`footerContainer` | **每个区域一个容器**（第 2 节的输入坞就是这些容器拼的） |
| 编辑器 | `defaultEditor`（`CustomEditor`）、`editor`（`ActiveEditor`）、`editorComponentFactory`、`autocompleteProvider(+Wrappers)`、`fdPath` | 默认编辑器与"当前活动编辑器"分离（扩展可替换——第 17.4.3 节） |
| 选择器 | `activeSelectorToken`、`activeSelectorDispose` | "同一时刻只能有一个选择器"的令牌与释放器 |
| 键位/版本 | `keybindings`、`version` | 键位管理器与版本号（头部/通知用） |
| 生命周期 | `isInitialized`、`onInputCallback`、`pendingUserInputs` | 初始化幂等 + **输入 Promise 的 resolver** + 排队输入 |
| 状态指示 | `idleStatus`、`activeStatusIndicator`、`activeWorkingIndicatorEmbedded`、`workingMessage/Visible/IndicatorOptions`、`hiddenThinkingLabel` | 忙碌/空闲指示器族 |
| 交互计时 | `lastSigintTime`、`lastEscapeTime` | **双击检测**（Ctrl+C 两次退出、Esc 两次…） |
| 展示开关 | `changelogMarkdown`、`startupNoticesShown`、`anthropicSubscriptionWarningShown`、`managedToolStatusStarted` | "只提示一次"的旗标族 |
| 流式渲染 | `streamingComponent`、`entriesRenderedByBoundaryCompaction`（Set） | 当前流式组件引用 + **压缩边界已渲染条目的去重集** |

- 【陷阱】`entriesRenderedByBoundaryCompaction` 的命名与类型（Set<string>）暗示一个真实需求：**压缩后同一批"保留条目"可能被重复渲染**（压缩事件 + 投影刷新两条路径）——用条目 id 去重。读 UI 问题时这是"消息重复显示"类 bug 的第一嫌疑点。
- 【陷阱】`pendingUserInputs` + `onInputCallback`：**交互循环的"输入侧"是一个 Promise 的 resolver 对**（`getUserInput` 返回新 Promise 并保存 resolve；编辑器提交时 resolve）——**把"事件驱动的提交"桥接成"顺序的 await 循环"**。这是 TUI 与异步主循环结合的经典写法（下面 `run()` 的 while 直接读它）。
- 【陷阱】大量"只提示一次"旗标：**状态机式的 UI 一致性**（避免重复通知）；它们都是布尔/时间戳的平凡类型，但**每个都对应一个"重复触发"的坑**。

## 4. `init()`：十二步启动序列

`init()`（932-1134 行）是全书**最长的单一函数之一**。按执行顺序拆成十二步（每步都有"为什么必须是这个顺序"）：

### 步骤 1-2：幂等守卫与信号处理

```typescript
	async init(): Promise<void> {
		if (this.isInitialized) return;
		this.registerSignalHandlers();
```

- **幂等**（`run()` 与手动初始化可能都调）；信号处理**最早注册**（初始化中途被 Ctrl+C/SIGTERM 也要能优雅退——覆盖"启动一半"的窗口）。

### 步骤 3-4：变更日志与模型作用域提示

```typescript
		this.changelogMarkdown = this.getChangelogForDisplay();
		if (this.session.scopedModels.length > 0 && this.shouldShowStartupDetails()) {
			// ...（拼模型列表 + 循环键提示 → console.log 到"启动前"的终端）
```

- changelog 先拿（后面头部的"新版本提示"用）；模型作用域提示**用 `console.log` 直接打印**——【陷阱】此刻 TUI 还没 `start()`，**stdout 还是普通终端**（这行输出会留在终端回滚区，成为启动日志的一部分）；之后进入全屏就看不到了。
- 提示文案**用键位系统生成**（`this.keybindings.getKeys("app.model.cycleForward")` + `formatKeyText`）——**按键提示永远从键位表来**（第 17.9.4 节的"不硬编码"）。

### 步骤 5：一次建树、可重挂

```typescript
		// Keep one component tree and remount it when changing renderers.
		this.renderWidgets(); // Initialize with default spacer
		const viewport = createChatViewport({ /* ... 各容器 ... */ });
		this.transcriptScrollView = viewport.transcript;
		this.fullscreenLayoutRoot = viewport.root;
		this.mountInteractiveTui(this.renderer, [ /* 七个容器 */ ]);
```

- 注释就是设计：**组件树只建一次**（所有容器/编辑器/页脚都在树上），切换 regular/fullscreen 时**重挂**（`mountInteractiveTui` 把树挂到新渲染器）——配合第 1 节的 Proxy 引用，组件无需感知切换。
- `renderWidgets()` 先跑一次（默认 spacer）——**保证布局数组里"widget 位置"始终存在**（后续更新只是替换内容）。

### 步骤 6-7：先用"启动期编辑器"，UI 先于扩展

```typescript
		// Accept text while startup completes, but only enable interrupt, exit, and submission feedback.
		this.defaultEditor.onAction("app.clear", () => this.handleCtrlC());
		this.defaultEditor.onCtrlD = () => this.handleCtrlD();
		this.defaultEditor.onSubmit = (text) => this.handleStartupSubmit(text);
		this.ui.setFocus(this.editor);

		// Start the UI before initializing extensions so session_start handlers can use interactive dialogs
		this.ui.start();
		this.isInitialized = true;
```

- **启动期只绑三个动作**（清屏/退出/提交）——其余键位要等"工具与处理器就绪"（步骤 11）再启用；**启动期间允许打字但不允许乱触发**。
- 【陷阱】**`ui.start()` 必须在扩展初始化之前**——注释原文："so session_start handlers can use interactive dialogs"。扩展的 `session_start` 可以弹选择框（第 13 章），而对话框需要已启动的 TUI。**顺序 = 能力**的又一实例。
- `isInitialized = true` 紧跟在 `ui.start()` 后——后续异步步骤失败也不会重复初始化（但组件可能没齐……读代码时注意这个"早设旗标"的取舍）。

### 步骤 8：主题先于"烘烤颜色"的内容

```typescript
		this.ensurePngTranscoder();
		this.themeController.applyFromSettings();
		// The header and startup notices bake theme colors into their text, so build them once the terminal
		// reported its colors. This ends at the terminal's DA1 reply, or after 100 ms if it answers nothing.
		await this.themeController.waitForTerminalColors();
```

- `ensurePngTranscoder()`：图片转码器（内联图片，第 17.1 节）**惰性准备**。
- **注释解释了一个纯技术依赖**：头部与启动提示会把主题色**烘进字符串**（第 17.7 节的【陷阱】：带色字符串不能事后跟随主题变化）——所以必须等**终端上报自身颜色**（DA1 查询的答复）之后才构建；终端不应答则 100ms 超时（**不让慢终端卡死启动**）。**"配色感知的 100ms 等待"**是终端 UI 的独特工程点。

### 步骤 9：头部构建（有 logo / 无 logo 两种）

```typescript
		if (this.shouldShowStartupHeader()) {
			const showDetails = this.shouldShowStartupDetails();
			const showLogo = supportsPiLogo();
			const withLogo = (hints: string) => { /* logo 两行 + 版本 + hints；无 logo 用 piWordmark + vX */ };
			const expandedInstructions = () => [ /* 完整快捷键清单（20 条） */ ].join("\n");
			const compactInstructions = () => [ /* 5 条精简 */ ].join(theme.fg("muted", " · "));
			const compactOnboarding = () => theme.fg("dim", `Press ... to show full startup help...`);
			const onboarding = () => theme.fg("dim", `Pi can explain its own features...`);
			const header = new BuiltInHeader(
				() => `${withLogo(compactInstructions())}\n${compactOnboarding()}\n\n${onboarding()}`,
				() => `${withLogo(expandedInstructions())}\n\n${onboarding()}`,
				this.getStartupExpansionState(), 1, 0,
			);
			if (showLogo) header.onLogoClick = (column, row) => playPiLogo3d(this.renderer, column, row);
			// ...（Spacer + header + Spacer 入 headerContainer）
		} else { this.builtInHeader = new Text("", 0, 0); /* ... */ }
		this.ui.requestRender();
```

【注解（四个要点）】

1. **"按需构建"**（两个函数而不是两个字符串）：注释说 "Built on demand so the header follows theme changes"——**头部内容在渲染时求值**（主题切换后重新取色）；`BuiltInHeader(compactFn, expandedFn, expansionState, ...)` 接收的是**函数**。
2. **指令集两档**：`compactInstructions`（5 条常用）与 `expandedInstructions`（20 条全量）——**按展开状态切换**（`app.tools.expand` 键）；快捷键提示全部来自 `hint()`/`keyHint()` 辅助（键位表驱动）。
3. **onboarding 文案**："Pi can explain its own features... Ask it how to use or extend Pi."——**教用户"用模型回答 pi 的问题"**（第 10 章的 docs 分节为它提供知识）。
4. **彩蛋**：`header.onLogoClick = playPiLogo3d`——点击 logo 放 3D 动画（`interactive/components/easter-egg-3d.ts` 48KB！）。【陷阱】读大仓库时遇到这类"无关正式功能"的代码——**跳过即可**，但要认出它（否则会浪费半天猜"这个 3D 模块在主链路哪里用"）。

### 步骤 10：先挂 UI，再下载外部工具

```typescript
		// Ensure fd and rg are available after mounting the TUI (downloads if missing, adds to PATH via getBinDir)
		// so slow downloads do not make startup appear frozen.
		// Both are needed: fd for autocomplete, rg for grep tool and bash commands.
		const [fdPath] = await Promise.all([
			ensureTool("fd", (status) => this.showManagedToolStatus(status)),
			ensureTool("rg", (status) => this.showManagedToolStatus(status)),
		]);
		this.fdPath = fdPath;
```

- **托管二进制**（`fd` 用于自动补全、`rg` 用于 grep 工具与 bash）——缺失时**下载**。
- 【陷阱】注释点明顺序原因："slow downloads do not make startup appear frozen"——**UI 先挂载**（用户立刻看到界面与下载状态——`showManagedToolStatus` 把进度显示在状态行），再等下载。**"先反馈、后等待"**的启动体验铁律。
- 两个工具**并行下载**（`Promise.all`）。

### 步骤 11-12：启用完整输入、重绑、渲染、挂后台观察者

```typescript
		this.setupKeyHandlers();
		this.setupEditorSubmitHandler();
		this.ui.requestRender();

		// Initialize extensions first so resources are shown before messages
		await this.rebindCurrentSession();
		this.renderInitialMessages();

		onThemeChange(() => { this.ui.invalidate(); this.updateEditorBorderColor(); this.ui.requestRender(); });
		this.footerDataProvider.onBranchChange(() => { this.ui.requestRender(); });
		await this.updateAvailableProviderCount();
		this.ui.renderNow();
		void loadAllHighlightLanguages().then(() => { if (!this.isInitialized) return; this.ui.invalidate(); this.ui.requestRender(); });
	}
```

- **输入处理在工具就绪后才全量启用**（`setupKeyHandlers`/`setupEditorSubmitHandler`）——**"编辑器可用的前提是它依赖的能力已就绪"**。
- `rebindCurrentSession()`：把扩展绑到会话（`session_start` 在此触发——**在消息渲染之前**，注释："resources are shown before messages"）。
- `renderInitialMessages()`：处理恢复会话的历史渲染（第 9 章的条目树 → 组件）。
- **两类观察者**：主题变更（invalidate + 边框色 + 重渲染）与 git 分支变更（仅重渲染——数据由 `footerDataProvider` 提供，第 0 节文件）。
- `await this.updateAvailableProviderCount()`（页脚显示可用供应商数）；`ui.renderNow()` **同步渲染一帧**（把完成态先落屏）；**语法高亮语言包异步加载**（`void ... .then`）——**重任务后台化**（加载完只 invalidate + 重渲染）。
- 【陷阱】`loadAllHighlightLanguages` 的回调里再查 `isInitialized`（**异步回调可能发生在 stop 之后**——防御"已经关了还在刷 UI"）。

## 5. `run()`：启动检查 + 主循环

```typescript
	async run(): Promise<void> {
		await this.init();

		if (!process.env.PI_OFFLINE) {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 15_000);
			void refreshModelCatalogs(this.session.modelRuntime, controller.signal)
				.then(() => this.updateAvailableProviderCount())
				.catch(() => {})
				.finally(() => clearTimeout(timeout));
		}

		checkForNewPiVersion(this.version).then((newRelease) => { if (newRelease) this.showNewVersionNotification(newRelease); });
		this.checkForPackageUpdates().then((updates) => { if (updates.length > 0) this.showPackageUpdateNotification(updates); })
			.finally(() => { if (process.platform === "win32" && this.isInitialized) this.updateTerminalTitle(); });
		this.checkTmuxKeyboardSetup().then((warning) => { if (warning) this.showWarning(warning); });

		// ...（启动警告分发：diagnostics / migratedProviders / models.json error / modelFallbackMessage / crash / anthropic 订阅）
		void this.maybeWarnAboutAnthropicSubscriptionAuth();

		if (initialMessage) { try { await this.session.prompt(initialMessage, { images: initialImages }); } catch (e) { this.showError(...); } }
		if (initialMessages) { for (const message of initialMessages) { try { await this.session.prompt(message); } catch (e) { this.showError(...); } } }

		while (true) {
			const userInput = await this.getUserInput();
			try { await this.session.prompt(userInput); } catch (error) { this.showError(...); }
		}
	}
```

【注解（三段结构）】

1. **四个后台检查**（全部 `void`/`.then`——**不阻塞主循环**）：
   - 目录刷新（非离线；15 秒超时；成功后更新供应商计数；`.catch(() => {})` **吞掉刷新错误**——启动体验优先，错误已经由 `getError()` 在别处呈现）；
   - 版本检查 → 新版通知；
   - 包更新检查 → 通知；`.finally` 里有个 **Windows 专属修复**（注释："npm can overwrite the shared console title while checking extension package versions"——检查时 npm 可能改了控制台标题，恢复 pi 的标题）；
   - tmux 键盘配置检查 → 警告。
   - 【陷阱】四个都是"**发现什么就通知**"模式（`.then(if (x) show)`）——**启动路径零阻塞**；任何"启动时必须等待"的诱惑都被拒绝了（除了 init 里明确需要顺序的步骤）。
2. **启动警告的统一分发**：`startupDiagnostics` 按级别推给 `showError`/`showWarning`/`showStatus`；`migratedProviders`（迁移过的凭据）；`models.json` 错误；`modelFallbackMessage`（模型回退）；**崩溃记录**（`takeUnnotifiedCrash()`——取一条"未通知过"的崩溃，显示时间与消息 + "Run /bug to report it"）；Anthropic 订阅鉴权提示（`maybeWarnAboutAnthropicSubscriptionAuth`——只提示一次，旗标在字段里）。**第 8.3.2 节的"诊断收集、边界裁决"在交互层的最终呈现**。
3. **初始消息 + 主循环**：初始消息（来自 CLI 参数/管道）逐条 `prompt`（**错误就地显示、不退出**——交互模式下"报错后还能继续打字"）；主循环 `while (true)`：`getUserInput()`（等编辑器提交）→ `session.prompt`（**串行**——一次运行完再收下一个输入）→ 出错 `showError`。
   - 【陷阱】主循环**不处理"运行中再提交"**？——那是 `getUserInput` 与编辑器/队列的领域（流式期间的回车走 steer/followUp 的交互路径，第 6 章）；**主循环只负责"空闲时的下一次提交"**。读交互输入行为时要沿着 `getUserInput` 与编辑器事件继续往组件层读（本篇止于结构与顺序，具体提交分支以源码为准）。

## 6. 交互模式与核心的边界（本节是结论）

| 维度 | 核心（AgentSession）负责 | 交互模式负责 |
|---|---|---|
| 运行 | prompt 循环、工具、压缩、重试 | **触发 prompt 的时机**（编辑器/初始消息） |
| 状态 | 唯一数据源（`session.state`/事件） | 把事件变成组件更新、把状态变成页脚数字 |
| 资源 | 会话/扩展/设置的拥有与释放 | 终端的启动、恢复、`stop()` |
| 扩展 | 扩展的运行与钩子 | **提供交互上下文**（对话框/状态/widget/自定义编辑器） |
| 失败 | 错误成"结果"、事件携带原因 | 把原因显示成 `showError/showWarning/showStatus` |
| 顺序 | 不感知 UI | **承接全部启动顺序问题**（UI 先于扩展、颜色先于头部、工具后于挂载、消息后于资源） |

【核心结论】交互模式的复杂度全在**"顺序与体验"**：把 200 行的启动序列拆成十二步后，你会发现**每一步的注释都在回答"为什么不能更早/更晚"**——这正是 247KB 文件里最应该被精读的部分（其余是大量组件的重复模式）。

## 7. 阅读检查清单

- [ ] 我能说出 `createInteractiveTuiReference` 这个 Proxy 解决的问题与代价吗？
- [ ] 我知道 `chat-viewport` 里 `minSize: 3` 与 `grow/basis` 的分工吗？
- [ ] 我能背出 init 十二步里"为什么 UI 必须先于扩展""颜色必须先于头部""工具必须后于挂载"的原因吗？
- [ ] 我知道启动期编辑器只绑了哪三个动作、为什么吗？
- [ ] 我能说出 `run()` 的四个后台检查与"零阻塞"原则吗？
- [ ] 我知道主循环的 `while(true)` 与流式排队（steer/follow-up）的分工吗？

---

> D13 完。精读篇（D1-D13）覆盖：循环、Agent、会话（投影/本体）、提示与压缩（读/写）、SDK、CLI、工具、扩展、模型层、协议模式、交互模式。