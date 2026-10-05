# D16：导出、分享与报告精读

> 精读对象：`core/session-export.ts`、`core/export-html/`（生成器与模板）、`modes/interactive/session-share.ts`、`core/bug-report.ts` 与 `/bug` 流程。
> 对应主线：第 9 章（会话导出）、第 16 章（`--export`）、第 19 章（故障报告）。
> 读法：按"三种输出"读——**JSONL（给机器）**、**HTML（给人看）**、**报告（给维护者）**；三者都建立在同一份会话数据上，但**脱敏与呈现策略完全不同**。

---

## 0. 三种输出的对照组

| 输出 | 入口 | 数据源 | 关键处理 | 敏感度 |
|---|---|---|---|---|
| JSONL 导出 | `exportSessionToJsonl`（/export、--export 的底层之一） | 活动分支条目 | **重链 parentId** + 补尾条目 | 原样（含工具输出/文件内容） |
| HTML 导出 | `AgentSession.exportToHtml`；CLI `--export <input> [output]` | 同上 + 主题 | ANSI→HTML、主题色推导、自包含模板 | 原样（**分享前自查**） |
| Bug 报告 | `/bug`（交互）/ `summarizeForBugReport`（会话层） | 会话摘录 + 崩溃记录 + 环境 | **递归脱敏**（凭据/URL 查询参数） | 经脱敏 |

【陷阱】JSONL/HTML 的敏感度是"**原样**"——安全文档的提醒适用：**分享会话前先审阅**（第 11 章的安全节）。Bug 报告是唯一带脱敏的输出（下一部分）。

---

# 第一部分：JSONL 导出与 HTML 导出

## 1. `session-export.ts`：把"活动分支"导成一个新 JSONL

【源码（完整）】

```typescript
type TrailingEntries = (parentId: string | null, timestamp: string) => readonly object[];

/** Serialize the current branch and optional export-only entries as JSONL. */
export function serializeSessionBranch(
	sessionManager: SessionManager,
	createTrailingEntries?: TrailingEntries,
): string {
	const timestamp = new Date().toISOString();
	const header: SessionHeader = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: sessionManager.getSessionId(),
		timestamp,
		cwd: sessionManager.getCwd(),
	};
	const entries: object[] = [header];
	let parentId: string | null = null;
	for (const entry of sessionManager.getBranch()) {
		entries.push({ ...entry, parentId });
		parentId = entry.id;
	}
	entries.push(...(createTrailingEntries?.(parentId, timestamp) ?? []));
	return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}
```

【注解（四个动作）】

1. **新 header，旧 id**：`id` 沿用 `sessionManager.getSessionId()`（**同一次会话的身份**），`timestamp` 用**导出时刻**（新文件的诞生时间），`cwd` 原样——**导出文件"看起来是同一个会话，但血缘起点是现在"**。
2. **遍历的是 `getBranch()`**（活动分支，**根→叶**——第 D3 第 8 节）；也就是**只导出当前这条线**，其他分支不带走（对比 `forkFrom` 的"全部复制"与 `createBranchedSession` 的"路径复制到新文件"——这是第三种"分支导出"形态：**纯序列化**，不碰 SessionManager 自身）。
3. **重链 `parentId`**：`entries.push({ ...entry, parentId }); parentId = entry.id;`——导出器按 `getBranch()` 返回的根→叶顺序，把每条记录的父节点规范成前一条记录；第一条从 `null` 开始。这样导出的当前分支成为一份**独立的线性 JSONL 链**，后续的分享元数据也能接在当前叶子后面。`getBranch()` 自己是沿原始 `parentId` 从叶回溯到根，所以这一步**不是损坏树结构的修复器**：若原始父链断裂，断点上游的条目不会进入 `getBranch()`，导出时也无从恢复。`export-jsonl-share.test.ts` 断言会话记录 ID 不变、父 ID 形成线性链，且附加的 `pi.share` 记录指向原叶子。
4. **可选"尾条目"**（`createTrailingEntries`）：传 `(parentId, timestamp)` 回调，把额外条目接到链尾——`pi.share` 的分享元数据用它（第 3 节）。**"导出格式可扩展"的钩子**（不污染核心导出逻辑）。

【源码（写盘）】

```typescript
export function exportSessionToJsonl(sessionManager, outputPath?, createTrailingEntries?): string {
	const filePath = resolvePath(
		outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
		process.cwd(),
	);
	const dir = dirname(filePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	writeFileSync(filePath, serializeSessionBranch(sessionManager, createTrailingEntries));
	return filePath;
}
```

【注解】

- 缺省文件名 = `session-<时间戳>.jsonl`（冒号点替换为连字符——**跨平台文件名安全**，与 D9 的会话文件命名同款）。
- **相对路径基于 `process.cwd()`**（用户在哪个目录运行 `/export`，文件落在哪）；父目录不存在则创建。
- **同步写**（`writeFileSync`）：导出是显式的一次性动作，同步更简单（错误直接抛给调用方——CLI 会 catch 并 `exit(1)`，D6 第 3 节）。

## 2. `export-html/`：自包含 HTML 的生成器

### 2.1 目录结构与"自包含"策略

```text
core/export-html/
├── index.ts        生成器（读模板 + 序列化会话 + 注入数据）
├── ansi-to-html.ts 把终端 ANSI 颜色序列转换为 HTML（导出里的彩色代码/输出还原）
├── tool-renderer.ts 工具调用的 HTML 渲染适配（对接扩展的自定义渲染器）
├── template.html   页面骨架（占位符）
├── template.css    样式（22KB——暗/亮主题变量、消息卡片、工具块……）
└── template.js     80KB 前端逻辑（渲染转录、折叠、搜索等；导出是"可交互文档"）
```

【注解】

- **自包含**：一个 `.html` = 模板 + 样式 + 脚本 + 数据（会话 JSON 内联）——**双击即看、离线可用、方便发送**。
- 【陷阱】`template.js` 有 80KB——导出不是"静态快照"，而是一个小的前端应用（折叠工具输出、切换展开状态等）。读导出相关问题时（"导出的文件里为什么这段看不到"）**要同时怀疑模板 JS 的渲染逻辑**，而不只是后端生成逻辑。

### 2.2 主题 → CSS 变量的推导

【源码（节选）】

```typescript
function parseColor(color: string): { r; g; b } | undefined { /* #RRGGBB 与 rgb(r,g,b) 两种格式 */ }

function getLuminance(r, g, b): number {
	const toLinear = (c: number) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function adjustBrightness(color: string, factor: number): string { /* 每通道乘法 + 夹取 0-255 */ }

/** Derive export background colors from a base color (e.g., userMessageBg). */
function deriveExportColors(baseColor: string): { pageBg; cardBg; infoBg } {
	const parsed = parseColor(baseColor);
	if (!parsed) return { pageBg: "rgb(24, 24, 30)", cardBg: "rgb(30, 30, 36)", infoBg: "rgb(60, 55, 40)" };
	const luminance = getLuminance(parsed.r, parsed.g, parsed.b);
	const isLight = luminance > 0.5;
	// 亮色主题：页面比卡片略亮；暗色主题：页面比卡片更暗
	// ...
}
```

【注解（三个知识点）】

1. **相对亮度公式**（WCAG 的 `L = 0.2126R + 0.7152G + 0.0722B`，通道先做 sRGB→线性的转换）——判断"这个主题色算亮还是暗"。
2. **`adjustBrightness`**：每通道乘以系数再夹到 [0,255]——**快速明暗调整**（不是 OKLab 之类的感知均匀空间；够用即可，第 17 章的 `mixColors` 是更讲究的工具，这里是导出的一次性推导）。
3. **两种主题各推三个背景色**（page/card/info）：亮色主题"页面比卡片亮一档"、暗色"页面比卡片暗一档"——**可读性规则写成了代码**（导出页面不要求与终端完全一致，要求"在任何主题下都可读"）。
- 【陷阱】这是"**主题色到网页配色的桥**"：导出复用的是**终端主题的语义色**（`getResolvedThemeColors`/`getThemeExportColors`），再推导出网页需要的衍生色。读这段时你会看到"一个设计系统如何跨媒介复用语义 token"的微型案例。

### 2.3 自定义工具的 HTML 渲染

【源码（接口）】

```typescript
/** Interface for rendering custom tools to HTML. Used by agent-session to pre-render extension tool output. */
export interface ToolHtmlRenderer {
	renderCall(toolCallId: string, toolName: string, args: unknown): string | undefined;
	renderResult(
		toolCallId: string, toolName: string,
		result: Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
		details: unknown, isError: boolean,
	): { collapsed?: string; expanded?: string } | undefined;
}

export interface ExportOptions {
	outputPath?: string;
	themeName?: string;
	/** Optional tool renderer for custom tools */
	toolRenderer?: ToolHtmlRenderer;
}
```

【注解】

- **"预渲染"模式**：扩展的工具渲染器（第 14.5 节，终端里画 tool 的同一批函数）在导出时**把 HTML 片段提前算好**，交给生成器**内联**进模板——导出的 HTML 不需要运行扩展代码（**导出是静态化**）。
- `renderResult` 返回 `{ collapsed, expanded }` 两版——对应前端模板里的"折叠/展开"交互（第 2.1 节的 template.js）。
- 【陷阱】渲染失败的约定是 **返回 undefined**（"没有自定义渲染器/渲染不了"）→ 生成器回退到默认渲染——**"可选能力"的接口设计**（对比第 13 章 `hasHandlers` 的快速门）。

### 2.4 导出入口与 CLI

- 会话层：`AgentSession.exportToHtml(outputPath?, { themeName? })`（第 8 章提过它的位置：`agent-session.ts` 第 4239 行）。
- CLI：`pi --export <input> [output]`（D6 第 3 节的快速路径——**不建会话**，直接读文件导出？）；主流程里 `exportFromFile` 走的具体链路（读会话 → 生成 HTML）——**排障时记住"两条导出路径"**（会话内 `/export` 与 CLI `--export`）。
- 【陷阱】`themeName` 的传递（第 8.5 节 `/share` 用 `theme.name`）：导出会**沿用当前主题**（导出时刻的语义色快照）——主题变了要重新导出才反映。

---

> D16 第一部分到此。第二部分：`session-share.ts` 的分享链路（temp 导出 → Radius → gh gist → 清理）、`bug-report.ts` 的脱敏与报告形态、`/bug` 流程与总结。
---

# 第二部分：分享链路与故障报告

## 3. `session-share.ts`：`/share` 的完整链路

### 3.1 上下文与"尾条目"：给查看器补元数据

【源码（节选）】

```typescript
interface SessionShareContext {
	session: AgentSession;
	ui: TUI;
	editorContainer: Container;
	editor: EditorComponent;
	showStatus: (message: string) => void;
	showError: (message: string) => void;
}

/** Trailing `pi.share` entry carrying the system prompt and tool schemas for the session viewer. */
export function createShareTrailingEntries(session, parentId, timestamp): object[] {
	return [{
		type: "custom",
		customType: "pi.share",
		id: crypto.randomUUID().slice(0, 8),
		parentId,
		timestamp,
		data: {
			systemPrompt: session.state.systemPrompt,
			tools: session.state.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
		},
	}];
}

/** Export the current branch with presentation metadata for Radius. */
export function exportSessionForShare(filePath: string, session: AgentSession): void {
	exportSessionToJsonl(session.sessionManager, filePath, (parentId, timestamp) =>
		createShareTrailingEntries(session, parentId, timestamp));
}
```

【注解】

- `SessionShareContext`：分享是**交互功能的实现**，需要 UI 句柄（TUI/编辑器容器）来"用加载器替换编辑器"（下一节）——**依赖都是注入的**（测试可替）。
- **`pi.share` 尾条目**（`custom` 类型——第 4.7.2 节的"扩展私有数据"，**不进模型上下文**）：带**系统提示与工具 schema**——查看器（Radius 的 session viewer）需要它们才能完整还原"这次会话当时的工作环境"。**这是"导出不只是消息，还要带上下文元数据"的实例**。
- 【陷阱】`id: crypto.randomUUID().slice(0, 8)`——只用前 8 位（与仓库的 8 位短 id 惯例一致）；碰撞概率低且仅在文件内要求唯一。
- `exportSessionForShare` 就是对第 1 节 `exportSessionToJsonl` 的**用法示范**：尾条目回调把 session 元数据封进导出。

### 3.2 `shareSession` 主流程：三段落 + 兜底

【源码（节选）】

```typescript
export async function shareSession(context: SessionShareContext): Promise<void> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-share-"));
	const jsonlFile = path.join(tempDir, "session.jsonl");
	const htmlFile = path.join(tempDir, "session.html");

	try {
		try {
			exportSessionForShare(jsonlFile, context.session);
		} catch (error) {
			context.showError(`Failed to export session: ...`);
			return;
		}
		if (await tryShareViaRadius(jsonlFile, context)) return;

		try {
			const authResult = spawnSync("gh", ["auth", "status"], { encoding: "utf-8" });
			if (authResult.status !== 0) {
				context.showError("GitHub CLI is not logged in. Run 'gh auth login' first.");
				return;
			}
		} catch {
			context.showError("GitHub CLI (gh) is not installed. ...");
			return;
		}

		try {
			await context.session.exportToHtml(htmlFile, { themeName: theme.name });
		} catch (error) { context.showError(`Failed to export session: ...`); return; }

		await shareViaGist(htmlFile, context);
	} finally {
		try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Ignore cleanup errors */ }
	}
}
```

【注解（主链路五步）】

1. **临时目录**（`mkdtempSync(os.tmpdir() + "pi-share-")`）——分享的中间产物（JSONL/HTML）都放临时目录，**最后统一清理**（finally 里的 `rmSync`；清理失败吞掉——**导出文件不该因清理失败而报错**）。
2. **先导 JSONL**（Radius 的格式——带 `pi.share` 元数据）；失败 → 显示错误并结束。
3. **优先 Radius**（`tryShareViaRadius` 返回 true 表示"这条路已经处理完"——无论成功失败；返回 false 表示"没有 Radius 条件，走兜底"——**"优先级 + 是否已处理"的布尔约定**）。
4. **兜底前先检查 `gh`**：`spawnSync("gh", ["auth", "status"])`——**命令不存在会抛**（catch → "not installed"）；**存在但未登录**（status ≠ 0）→ "not logged in" 提示。**两种失败两种文案**——用户能立刻对症。
5. **导出 HTML → `shareViaGist`**——兜底路径分享的是**HTML 文件**（给人看的），而 Radius 分享的是 **JSONL**（给查看器渲染的）——【陷阱】**两条路线的产物不同**（同一份会话，两种介质）。

- 【陷阱】`spawnSync`（同步）用于**快速能力探测**（等待时间可忽略）；真正的长操作（上传/gist）用**异步 `spawn` + 事件**（下一节）——**同步/异步的选择按操作时长**。

### 3.3 `tryShareViaRadius`：带加载器的上传

【源码（节选）】

```typescript
async function tryShareViaRadius(tmpFile: string, context: SessionShareContext): Promise<boolean> {
	const provider = context.session.modelRuntime.getProvider("radius");
	if (!provider) return false;

	const token = getAuthCredential(
		await context.session.modelRuntime.getAuth("radius", { minOAuthValidityMs: 5 * 60_000 }),
	);
	if (!token) return false;

	const loader = new BorderedLoader(context.ui, theme, "Uploading to Radius...");
	context.editorContainer.clear();
	context.editorContainer.addChild(loader);
	context.ui.setFocus(loader);
	context.ui.requestRender();
	loader.onAbort = () => { restoreEditor(loader, context); context.showStatus("Share cancelled"); };

	try {
		const body = fs.readFileSync(tmpFile);
		const url = new URL("/v1/artifacts", DEFAULT_RADIUS_GATEWAY);
		url.searchParams.set("visibility", "organization");
		url.searchParams.set("title", "Pi session");
		const response = await fetch(url, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-ndjson", "Content-Length": String(body.byteLength) },
			body,
			signal: loader.signal,
		});
		if (loader.signal.aborted) return true;
		const json = await response.json().catch(() => null);
		if (loader.signal.aborted) return true;
		restoreEditor(loader, context);
		if (!response.ok || !json?.artifact) { context.showError(`Failed to upload Radius artifact: ...`); return true; }
		const shareUrl = json.artifact.canonical_url;
		context.showStatus(`Share URL: ${hyperlink(shareUrl, shareUrl)}`);
		return true;
	} catch (error) {
		if (!loader.signal.aborted) { restoreEditor(loader, context); context.showError(`Failed to upload Radius artifact: ...`); }
		return true;
	}
}
```

【注解（五个模式）】

1. **前置条件**（两查）：provider 是否存在（未登录 Radius 的人没有它）→ 返回 false 走兜底；token 是否可得（`getAuth("radius", { minOAuthValidityMs: 5*60_000 })`——**至少还要 5 分钟有效期**的 OAuth 令牌；`getAuthCredential` 抽取出凭据）→ 无则兜底。**"选择路线"在发出任何 UI 之前完成**（用户不会看到"上传中"才发现没登录）。
2. **编辑器换装**：`editorContainer.clear()` → `addChild(new BorderedLoader(...))` → `setFocus` → `requestRender`——**用加载器临时顶替输入框**（第 13.6 节的 `ctx.ui` 之外，这是内部 UI 的直接操作——**应用内部代码可以绕扩展层**）。
3. **`loader.onAbort`**：**取消的语义**——恢复编辑器 + 状态"Share cancelled"（上传用 `loader.signal` 传入 fetch——**取消信号直达网络请求**）。
4. **上传**：`POST /v1/artifacts?visibility=organization&title=Pi session`，`Content-Type: application/x-ndjson`（**JSONL 是 ndjson**——"newline-delimited"，第 9 章的会话格式在 HTTP 上传里的 MIME 名），`signal: loader.signal`。
5. **响应处理的三态**：中止（检查两处 `signal.aborted` 后**静默返回**——取消不是错误）；不 OK/无 artifact → `showError`（但**返回 true**——"已处理，别再走兜底"？【陷阱】失败也返回 true：**用户选了 Radius、凭据也有，就不该悄悄改用 gist 上传**——错误要呈现给用户，而不是另找一个可能也不合适的通道）；成功 → `showStatus("Share URL: ...")` + `hyperlink` 可点击链接。
- 【陷阱】catch 里的 `if (!loader.signal.aborted)` 条件：**取消导致的异常静默**（不弹错误）——"取消是结果"（第 D12 第 6 节同款语义在网络的复刻）。

### 3.4 `shareViaGist`：异步子进程 + 取消杀进程

【源码（节选）】

```typescript
async function shareViaGist(tmpFile: string, context: SessionShareContext): Promise<void> {
	const loader = new BorderedLoader(context.ui, theme, "Creating gist...");
	context.editorContainer.clear();
	context.editorContainer.addChild(loader);
	context.ui.setFocus(loader);
	context.ui.requestRender();

	let proc: ReturnType<typeof spawn> | null = null;
	loader.onAbort = () => { proc?.kill(); restoreEditor(loader, context); context.showStatus("Share cancelled"); };

	try {
		const result = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve) => {
			proc = spawn("gh", ["gist", "create", "--public=false", tmpFile]);
			let stdout = "", stderr = "";
			proc.stdout?.on("data", (data) => { stdout += data.toString(); });
			proc.stderr?.on("data", (data) => { stderr += data.toString(); });
			proc.on("close", (code) => resolve({ stdout, stderr, code }));
		});
		if (loader.signal.aborted) return;
		restoreEditor(loader, context);
		if (result.code !== 0) { context.showError(`Failed to create gist: ...`); return; }
		const gistUrl = result.stdout?.trim();
		const gistId = gistUrl?.split("/").pop();
		if (!gistId) { context.showError("Failed to parse gist ID from gh output"); return; }
		// ...（后续：用 gistId 组织展示/访问信息——以剩余实现为准）
```

【注解】

- **异步 `spawn` + 手动 Promise**：收集 stdout/stderr，`close` 时 resolve `{ code }`——**"子进程三件套"的又一次出现**（对比 D7 的 bash：这里是短命令、无超时要求，所以实现更简单）。
- **取消 → `proc.kill()`**（杀掉 gh 进程）——**取消要作用到子进程**（第 7.11 节的"取消不是强杀、由实现翻译"在这里的应用侧翻译）。
- `--public=false`：**私有 gist**（跨两层的隐私默认：报告/分享的默认都是"不公开"）。
- 输出解析：`stdout` 是 gist URL；`split("/").pop()` 取 id；解析失败显式报错（**不猜**）。
- 【陷阱】与 Radius 分支对称的三处：加载器换装、onAbort、aborted 静默——**两条分享路线共享同一套交互骨架**（读一份就懂另一份）。

## 4. `bug-report.ts`：脱敏是核心功能

### 4.1 三个脱敏工具（第 19.2.6 节见过，这里给全）

【源码（节选）】

```typescript
export const BUG_REPORT_CUSTOM_ENTRY_TYPE = "pi.bug-report";
const BUG_REPORT_SCHEMA_VERSION = 1;
const REDACTED = "<redacted>";
const SENSITIVE_KEY = /(?:^|[-_])(api[-_]?key|secret|token|password|passwd|credential|authorization|cookie)(?:$|[-_])/i;

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));
}

/** Strip credentials and secret-looking query parameters from a URL. */
export function redactUrl(value: string): string {
	const nested = /^([a-z][a-z0-9+.-]*:)([a-z][a-z0-9+.-]*:\/\/.*)$/i.exec(value);
	if (nested) return `${nested[1]}${redactUrl(nested[2])}`;   // 处理 "scheme:" 前缀包裹的 URL
	try {
		const url = new URL(value);
		let changed = false;
		if (url.username || url.password) { url.username = ""; url.password = ""; changed = true; }
		for (const key of url.searchParams.keys()) {
			if (isSensitiveKey(key)) { url.searchParams.set(key, REDACTED); changed = true; }
		}
		return changed ? url.toString() : value;
	} catch { return value; }
}

/** Copy a JSON value while removing values that may contain credentials. */
export function redactJsonValue(value: unknown): unknown {
	if (value === undefined) return undefined;
	return JSON.parse(JSON.stringify(value, (key, child: unknown) => {
		if (child !== null && child !== undefined && isSensitiveKey(key)) return REDACTED;
		return typeof child === "string" ? redactUrl(child) : child;
	}));
}
```

【注解（三个层次）】

1. **键名匹配**（`SENSITIVE_KEY`）：**先做 camelCase → snake_case 归一**（`key.replace(/([a-z0-9])([A-Z])/g, "$1_$2")`——把 `apiKey` 变成 `api_Key`？准确说 `apiKey` → `api_Key` 再被 `[-_]` 匹配……读正则：`(?:^|[-_])` + `api[-_]?key` —— 归一后 `api_Key` 里的 `_K` 大写——不匹配 `api[-_]?key`（大小写不敏感 `/i`，`_Key` vs `_key` 匹配！）。**结论：归一化让"驼峰/蛇形/中划线"三种命名都能命中同一张敏感词表**——写法上有点绕（可以简化），但目的清楚）。
2. **URL 脱敏**（`redactUrl`）：剥 basic-auth 的用户名/密码；遍历查询参数把敏感键的值置为 `<redacted>`；`nested` 正则处理"双层 scheme"（比如 `git+https://...` 或 `proxy:http://...`——先剥外层）。
3. **JSON 递归脱敏**（`redactJsonValue`）：`JSON.stringify` 的 **replacer** 按**键名**替换值、按**字符串内容**做 URL 脱敏（字符串可能是完整 URL/内嵌 URL 的片段），再 `JSON.parse` 回来——**纯函数、不改原对象**。
- 【陷阱】脱敏是**尽力而为**（best-effort）：只覆盖"已知敏感模式"（键名表 + URL 参数）；**自由文本里的密钥不会被发现**（比如模型在回答里复述了密钥）。所以文档口径是"报告可能仍含敏感信息，提交前自查"——**不要把它当合规级脱敏**。

### 4.2 报告的组装与上传（结构）

【说明（结合已见片段与文件结构）】

- `core/bug-report.ts`（13KB）：组装报告工件——**收集**会话摘录（`summarizeForBugReport` 在会话层，第 8 章文件里的第 4273 行）、崩溃记录（`CrashRecord`）、扩展清单、环境与版本（`VERSION`/`getPiUserAgent`）；**打包**成 zip（`writeZipArchive`——`utils/zip.ts`）；**摘要**用 `completeSummarization`/`serializeConversation`（与压缩共享的摘要链，D4/D10——**报告也请模型写摘要**）。
- `modes/interactive/bug-report.ts`（10.5KB）+ `core/bug-report-upload.ts`（1.4KB）：`/bug [描述]` 的交互流程（收集描述、确认、上传）——**以这两个文件的实现为准**（本篇未逐行读）。
- 报告在会话里以 `custom` 条目（`customType: "pi.bug-report"`）+ schema 版本号携带——**条目是报告的结构化载体**（第 4.7.2 节的 custom 用例）。

## 5. 总结

### 5.1 四个可以带走的模式

| 模式 | 出处 | 一句话 |
|---|---|---|
| 导出器产出"合法文件"而非"输入回显" | `serializeSessionBranch` 重链 parentId | 责任边界在导出器 |
| 尾条目钩子 | `createTrailingEntries` | 扩展导出格式不动核心 |
| 取消贯穿到 I/O | `loader.signal` → fetch/`proc.kill()` | 取消不是 UI 层的表演 |
| 脱敏 = 键名表 + URL 规则 + 递归 | `redact*` 三件 | 尽力而为，不承诺完美 |

### 5.2 阅读检查清单

- [ ] 我能说出 JSONL 导出与 forkFrom/createBranchedSession 的三种"分支导出"差别吗？
- [ ] 我知道导出 HTML "自包含"的含义与代价吗？（模板 JS 也是真相的一部分）
- [ ] 我能复述 `/share` 的优先级与两种失败文案吗？
- [ ] 我能解释"失败也返回 true"的分享路由语义吗？
- [ ] 我知道脱敏三层各覆盖什么、漏什么吗？
- [ ] 我能说出 `pi.share` 与 `pi.bug-report` 两个 customType 各自的作用吗？

---

> D16 完。精读篇 D1-D16 覆盖：循环、Agent、会话（投影/本体/压缩触发/导出分享）、提示与压缩（读/写/触发）、SDK、CLI、工具、扩展（类型/派发/加载）、模型层、协议模式、交互模式、报告链路。D17 继续精读 Anthropic provider 的请求与流式响应路径。
