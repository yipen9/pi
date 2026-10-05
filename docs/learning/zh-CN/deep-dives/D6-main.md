# D6：`main.ts` 启动与装配选段精读

> 精读对象：`packages/coding-agent/src/main.ts`（约 1000 行）的 `main()` 主函数——从进程参数到"三种模式分发"的完整启动装配。
> 对应主线：第 3 章（入口与装配）。
> 读法：顺着 `main()` 的执行顺序读，本文按阶段切分；每段先源码后注解。

---

## 0. 为什么 `main.ts` 值得读

`main.ts` 是"**产品决策的沉积层**"：哪些命令要在装配前短路、什么顺序建对象、出错时退出码是什么、哪些东西要动态重算——全在这里。对照 D5（`sdk.ts` 是"给嵌入方的最干净装配"），`main.ts` 是"给 CLI 的完整装配 + 模式分发"。

【陷阱】`main.ts` 里同一件事常出现**两次**（比如 SettingsManager），因为"信息不足时先粗略建、信息足够后精确重建"。读时给每个对象标注"第几次创建、为什么"。

---

## 1. 段落零：打点、离线与扩展工厂

【源码】

```typescript
export async function main(args: string[], options?: MainOptions) {
	resetTimings();
	const extensionFactories = [...builtInExtensions, ...(options?.extensionFactories ?? [])];
	const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env.PI_OFFLINE);
	if (offlineMode) {
		process.env.PI_OFFLINE = "1";
		process.env.PI_SKIP_VERSION_CHECK = "1";
	}
```

【注解】

- `resetTimings()`：把启动打点表归零（第 19.2.2 节的 `time()`/`printTimings()` 同一体系）。
- **内置扩展**（`builtInExtensions`，来自 `src/core/experimental.ts` 或类似模块）+ 宿主注入的扩展 → 统一进 `extensionFactories`，之后随 ResourceLoader 一起向会话传递。
- 离线模式的两个来源：**命令行参数**或**环境变量**（`isTruthyEnvFlag`——"truthy 解析"：`1`/`true`/`yes` 之类；第 11.7 节的变量表）。
- 离线模式的副作用：写两个环境变量——**`PI_OFFLINE` 与 `PI_SKIP_VERSION_CHECK`**。【陷阱】为什么要"写入环境变量"而不是就地用布尔？因为后面更深层的代码（模型目录刷新、版本检查）**也读环境变量**——用"环境变量作为进程级广播"能让分散的模块共享这个决定，而不用把布尔一层层传下去。这是"进程级开关"与"参数级开关"的分工示例。
- 【陷阱】`options?.extensionFactories ?? []`：`MainOptions` 是给测试/嵌入的注入点（`main(args, options)`）——CLI 从 `cli.ts` 调用时不传第二参。

## 2. 短路命令：`auth`、Windows 清理、包/配置/mcp

【源码（节选）】

```typescript
	if (await runAuthCommand(args)) {
		return;
	}

	if (process.platform === "win32") {
		cleanupWindowsSelfUpdateQuarantine(getPackageDir());
	}
	cleanupManagedInstall();

	const cwd = process.cwd();
	const agentDir = getAgentDir();
	const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
	applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher();

	if (await handlePackageCommand(args, { extensionFactories })) {
		const exitCode = process.exitCode ?? 0;
		if (process.platform === "win32" && exitCode === 0 && args[0] === "update") {
			// We normally prefer process.exit(0) for package commands so bad extensions cannot keep
			// one-shot commands alive. On Windows, Node can assert after fetch() if process.exit(0)
			// runs during teardown; let successful `pi update` drain naturally instead.
			// https://github.com/nodejs/node/issues/56645
			return;
		}
		process.exit(exitCode);
		return;
	}

	if (await handleConfigCommand(args, { extensionFactories })) {
		return;
	}

	if (args[0] === "mcp") {
		const { runMcpCommand } = await loadMcpCommand();
		process.exitCode = await runMcpCommand(args.slice(1), { cwd, agentDir });
		return;
	}
```

【注解（顺序即优先级）】

- **`auth` 最先**：`pi auth ...` 连 cwd/agentDir 都不需要（它自己解析凭据路径）。短路 return。
- Windows 自更新隔离清理 + 托管安装清理：**平台杂务**（被杀毒/更新流程打扰后的残骸处理）；只在 win32 跑（另一个平台也不会有那些文件）。
- `cwd`/`agentDir` **只取一次**（第 3.4.2 节的"显式落盘"）；bootstrap 设置管理器用 **`projectTrusted: false`**——此刻还没做信任判定，**先不允许任何项目设置生效**；只读它的**全局**设置（`getGlobalSettings().httpProxy`）来配置代理与 HTTP 调度器。【陷阱】注意读的是 `getGlobalSettings()` 而不是合并后的 `getSettings()`——**在信任前只信全局**，这是第 11.5 节"信任边界"在启动期的体现。
- 四个子命令按序短路：包管理（`install/remove/list/update`）→ 配置（`pi config`）→ MCP（`pi mcp`）。要点：
  - 包管理**依赖扩展工厂**（`{ extensionFactories }`）——因为安装/更新会触发扩展 reconcile；
  - Windows + `pi update` + 成功退出码的**特例注释**：正常情况下"包命令跑完就 `process.exit`"（防止坏扩展挂住进程），但 Windows 上 Node 在 `fetch()` 之后 teardown 里退出会触发断言（引用了 nodejs/node#56645），所以**成功时改为自然返回**（让事件循环自己 drain）。
  - 【陷阱】这段是"**平台特定 workaround + 引用上游 issue**"的范例：注释写清"Why + 链接"，而不是"magic return"。读到时能理解，而不是当成可疑代码删掉。
  - `mcp` 用**动态导入**（`await loadMcpCommand()`）——一个真实的"按需加载"（MCP 支持不在所有启动路径都需要；这也是入口成本预算（第 20.2.4 节）允许的少数动态导入之一。【陷阱】为什么这里可以而其它地方不许？因为它是**命令分发层的懒加载**，不改变模块依赖图（`main.ts` 仍静态可知它可能加载 mcp 包的哪个入口——通过 helper）。

## 3. 参数解析与"早退"命令

【源码（节选）】

```typescript
	const parsed = parseArgs(args);
	if (parsed.diagnostics.length > 0) {
		for (const d of parsed.diagnostics) {
			const color = d.type === "error" ? chalk.red : chalk.yellow;
			console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
		}
		if (parsed.diagnostics.some((d) => d.type === "error")) {
			process.exit(1);
		}
	}
	time("parseArgs");

	if (parsed.version) {
		console.log(VERSION);
		process.exit(0);
	}

	if (parsed.export) {
		let result: string;
		try {
			const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
			result = await exportFromFile(parsed.export, outputPath);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Failed to export session";
			console.error(chalk.red(`Error: ${message}`));
			process.exit(1);
		}
		console.log(`Exported to: ${result}`);
		process.exit(0);
	}
```

【注解】

- 诊断三态（info/warning/error）：**warning 写入 stderr 但继续**；任何 error → `process.exit(1)`。这就是"参数解析器把校验问题收集起来、调用方统一裁决"的模式（第 8.3.2 节的 diagnostics 同族）。
- **`--version` 极速路径**：只打印 `VERSION`（来自 `config.ts`，第 0.7 节的实验就是它）——**不建任何服务、不加载扩展**（注意此刻 `extensionFactories` 只存在于数组里，还没有实例化）。
- **`--export` 路径**：导出会话为 HTML 后退出；`parsed.messages[0]` 当输出路径（位置参数复用——第 16 章的 CLI 文档里 `--export <input> [output]` 的 "output" 走的其实是非选项参数）；错误统一格式化 + 退出码 1。
- 【陷阱】这两条路径都在**任何会话装配之前**——"快速命令不建会话"的实例（第 3.4.2 节的设计点之一）。也解释了为什么"改扩展 bug 后 `pi --version` 还慢"会令人困惑——扩展工厂此刻确实没跑，但如果慢就说明慢在别处（模块加载等）。

## 4. 模式解析与 stdout 接管

【源码】

```typescript
	let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
	const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
	if (shouldTakeOverStdout) {
		takeOverStdout();
	}

	if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
		console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
		process.exit(1);
	}

	validateForkFlags(parsed);
```

【注解】

- `resolveAppMode(parsed, stdin.isTTY, stdout.isTTY)`：三态输入——显式模式（`--print`/`--mode json|rpc`）优先；否则"两个流都是 TTY → interactive，否则 print"（第 3.4.4 节）。
- **`takeOverStdout()`**：非交互模式下把"直接写 stdout"重定向到 stderr，**保护协议通道**（JSON/RPC 的 stdout 只许放协议记录；第 16.3.1 节的"stdout 专用于 JSONL"）。
  - `isPlainRuntimeMetadataCommand(parsed)` 的例外：某些命令（如纯元数据输出，比如 list-models？）**需要**真正的 stdout——它们不做接管。【陷阱】这个例外函数的名字与语义要合起来读："平凡的运行时元数据命令"输出的是人/机共读的短信息，不算协议流。
- RPC 的 `@file` 拒绝：在**任何装配之前**报错退出（比"装配完再发现"省时间，也避免产生副作用）。
- `validateForkFlags`：组合校验（`--fork` 与 `--session/--continue/--resume/--no-session` 互斥；第 16 章的 CLI 文档列了约束）。

## 5. 迁移、启动设置与首次引导

【源码（节选）】

```typescript
	// Run migrations (pass cwd for project-local migrations)
	const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(cwd);
	time("runMigrations");

	const startupSettingsManager = SettingsManager.create(cwd, agentDir);
	const startupSettingsDiagnostics = collectSettingsDiagnostics(startupSettingsManager);

	// Experimental first-time setup: theme choice and analytics opt-in.
	// Runs before any runtime services are created so the chosen settings apply everywhere.
	if (appMode === "interactive" && !parsed.help && parsed.listModels === undefined && shouldRunFirstTimeSetup()) {
		await showFirstTimeSetup(startupSettingsManager);
		time("firstTimeSetup");
	}

	if (appMode === "interactive" && parsed.useTheme !== undefined) {
		startupSettingsManager.applyOverrides({ theme: parsed.useTheme });
	}
```

【注解】

- **迁移**（`runMigrations(cwd)`）：配置文件/凭据的版本迁移（第 11.3.2 节的 settings 迁移是另一处）。返回"迁移过的认证供应商"（给交互层提示）与**弃用警告**（后面在交互模式展示）。
- **第二个 SettingsManager**（`startupSettingsManager`）：注意这次**没有** `projectTrusted: false` → **按默认信任加载项目设置**。为什么？因为下一步的"会话目录解析"需要读 `sessionDir` 设置——而 `sessionDir` 是文档明确允许"信任前读取"的**引导期例外**（第 11.5 节）。
  - 【陷阱】所以进程里会有三个设置管理器阶段：bootstrap（trusted:false，只读全局）→ startup（默认信任，用于会话目录/首次引导）→ runtime（真实信任结论，第 7 节工厂里创建）。读 `main.ts` 时必须把这三者的**职责与信任级别**分开，否则会以为"项目设置没信任却生效了"。
- **首次引导**（主题选择 + 遥测同意）：`shouldRunFirstTimeSetup()` 守卫（只在交互、非 help、非 list-models 时跑）；注释说明为什么**必须最早跑**——"让选定的设置在所有地方生效"（晚了的话，runtime 服务已按旧设置创建）。
- `--theme` 的会话覆盖：`applyOverrides({ theme })`——**不落盘**的会话期覆盖（第 11.3.3 节）。

## 6. 会话目录与会话管理器

【源码（节选）】

```typescript
	// Decide the final runtime cwd before creating cwd-bound runtime services.
	// --session and --resume may select a session from another project, so project-local
	// settings, resources, provider registrations, and models must be resolved only after the
	// target session cwd is known. ...
	const envSessionDir = process.env[ENV_SESSION_DIR];
	const sessionDir =
		(parsed.sessionDir ? normalizePath(parsed.sessionDir) : undefined) ??
		(envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
		startupSettingsManager.getSessionDir();
	let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
	const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
	// ...（缺 cwd 时的交互询问/非交互报错）
```

【注解】

- **会话目录三级优先**：`--session-dir` → 环境变量（`PI_CODING_AGENT_SESSION_DIR`）→ 设置里的 `sessionDir`（第 3.4.3 节）。
- `createSessionManager(parsed, cwd, sessionDir, startupSettingsManager)`：处理 `--continue`/`--resume`/`--session`/`--session-id`/`--fork`/`--no-session` 等组合（`cli/session-picker.ts` 等模块配合）——它可能**打开别的项目的会话**，所以紧接着要处理"目标会话的 cwd 与当前进程 cwd 不同"的问题。
- `getMissingSessionCwdIssue`：目标会话的 cwd **不存在**（目录被删/换机器）时的处理——交互模式询问新目录；非交互报错退出（第 9 章的"恢复报错"排障项）。**这就是"cwd 必须在建 runtime 服务之前定下来"的实践**：注释原文说"项目本地设置、资源、provider 注册、模型都必须等目标 cwd 确定后再解析"。

---

> D6 第一部分到此。第二部分：`createRuntime` 工厂（信任解析、服务创建、模型作用域、会话选项、会话创建）、`createAgentSessionRuntime`、help/list-models、管道输入与初始消息、主题、诊断输出与三种模式分发，最后是总结。
---

# 第二部分：运行时工厂与模式分发

## 7. `createRuntime` 工厂：可重建装配的完整实现

先看它的"闭包捕获"部分（函数外，装配一次）：

【源码（节选）】

```typescript
	const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
	const resolvedSkillPaths = resolveCliPaths(cwd, parsed.skills);
	const resolvedPromptTemplatePaths = resolveCliPaths(cwd, parsed.promptTemplates);
	const resolvedThemePaths = resolveCliPaths(cwd, parsed.themes);
```

【注解】

- 四类 CLI 路径**在工厂外解析一次**（相对 cwd → 绝对路径）——第 11.4.3 节的注释："so later cwd switches do not reinterpret them"（切目录后不会被重新解释）。**相对路径转绝对 = 冻结语义**，这是"可重建装配"能正确工作的前提之一。

### 7.1 信任解析：三重判定

【源码】

```typescript
	const createRuntime: CreateAgentSessionRuntimeFactory = async ({
		cwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext,
	}) => {
		const isInitialRuntime = sessionStartEvent === undefined;
		const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
		const cachedProjectTrust = projectTrustByCwd.get(cwd);
		const hasTrustRequiringResources = hasTrustRequiringProjectResources(cwd);
		const shouldResolveProjectTrust =
			parsed.projectTrustOverride === undefined && cachedProjectTrust === undefined && hasTrustRequiringResources;
		const projectTrusted = shouldResolveProjectTrust
			? false
			: (cachedProjectTrust ??
				parsed.projectTrustOverride ??
				(!hasTrustRequiringResources || trustStore.get(cwd) === true));
		const runtimeSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted });
```

【注解（三重）：**

1. **CLI 覆盖**（`parsed.projectTrustOverride`，来自 `--approve`/`--no-approve`）最高；
2. **本次进程的缓存**（`projectTrustByCwd`——同一 cwd 只判定一次，见下）；
3. **资源存在性 + 存储的决定**：没有受保护资源 → 信任（不需要判定）；否则查 `trustStore`（第 11.5.3 节）。

- `shouldResolveProjectTrust` 为真 = "**还没有结论且确实需要判定**" → 先置 `false`（安全默认），把真正的判定推迟到 ResourceLoader 的 `resolveProjectTrust` 回调里（第 7.2 节）——因为**判定需要先加载一部分扩展**（`project_trust` 事件只能由用户级/CLI 扩展处理，第 11.4.3 节）。
- 【陷阱】`createRuntime` 的**参数由 runtime 调用方提供**（`{ cwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext }`）而不是直接用外部闭包里的 `cwd`——这就是"重建"的关键：每次替换会话时传入新 cwd。**但四类资源路径是闭包（第一次的 cwd 解析结果）**——所以"切目录后自定义扩展路径仍指向老位置"这种语义是**刻意的**（用户传入的路径不该被切目录悄悄改变）。两套"cwd 相关"的处理不同，读时注意区分。
- `isInitialRuntime`（`sessionStartEvent === undefined`）用于后续决定信任提示的 UI 形态（启动时可用交互弹窗；替换时用当前 appMode）。

### 7.2 服务创建与信任回调的接线

【源码（节选）】

```typescript
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			settingsManager: runtimeSettingsManager,
			modelRuntimeSignal: AbortSignal.timeout(15_000),
			extensionFlagValues: parsed.unknownFlags,
			resourceLoaderReloadOptions: shouldResolveProjectTrust
				? {
						resolveProjectTrust: async ({ extensionsResult }) => {
							const trusted = await resolveProjectTrusted({
								cwd, trustStore,
								trustOverride: parsed.projectTrustOverride,
								defaultProjectTrust: startupSettingsManager.getDefaultProjectTrust(),
								extensionsResult,
								projectTrustContext:
									projectTrustContext ??
									createProjectTrustContext({
										cwd,
										mode: isInitialRuntime ? trustPromptMode : appMode,
										settingsManager: startupSettingsManager,
										hasUI: isInitialRuntime && trustPromptMode === "interactive",
									}),
								onExtensionError: (message) => projectTrustDiagnostics.push({ type: "warning", message }),
							});
							projectTrustByCwd.set(cwd, trusted);
							return trusted;
						},
					}
				: undefined,
			resourceLoaderOptions: {
				additionalExtensionPaths: resolvedExtensionPaths,
				additionalSkillPaths: resolvedSkillPaths,
				additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
				additionalThemePaths: resolvedThemePaths,
				noExtensions: parsed.noExtensions,
				noSkills: parsed.noSkills,
				noPromptTemplates: parsed.noPromptTemplates,
				noThemes: parsed.noThemes,
				noContextFiles: parsed.noContextFiles,
				systemPrompt: parsed.systemPrompt,
				appendSystemPrompt: parsed.appendSystemPrompt,
				extensionFactories,
			},
		});
```

【注解】

- `extensionFlagValues: parsed.unknownFlags`：未识别的 CLI flag 传给服务层——由它对照扩展注册的 flag 做校验（第 8.3.2 节：不认识的报 error 诊断）。
- **信任回调的四个要点**：
  1. 它接收 `{ extensionsResult }`（预加载的扩展结果）——正是"先加载用户级/CLI 扩展、再判定"的机制接口；
  2. `trustPromptMode` 的来源没在这段显示（`main.ts` 前面按模式算好：交互=可弹窗、非交互=自动）；`hasUI: isInitialRuntime && trustPromptMode === "interactive"`——**只有启动期且交互**才给 UI，重建时不给（替换场景不弹信任窗）；
  3. 判定结果写进 `projectTrustByCwd` 缓存（同 cwd 的重建不再判定——**避免每次切会话都重新问用户**）；
  4. `onExtensionError` 把扩展错误收成 warning 诊断（不中断信任流程）。
- `modelRuntimeSignal: AbortSignal.timeout(15_000)`：模型运行时创建带**15 秒超时**（目录刷新/凭据读取不能无限等——第 5.6.2 节的动态目录在启动期受限）。
- `resourceLoaderOptions` 十项：四个路径 + 五个 no* 开关 + 两个提示注入——**CLI 的全部资源控制面**都在这里（对照第 11.4 节的发现器）。

### 7.3 诊断收集与模型作用域

【源码（节选）】

```typescript
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			...projectTrustDiagnostics,
			...services.diagnostics,
			...collectSettingsDiagnostics(settingsManager),
			...resourceLoader.getExtensions().errors.map(({ path, error }) => ({ type: "error", message: `Failed to load extension "${path}": ${error}` })),
			...(resourceLoader.getExtensions().warnings ?? []).map(({ path, warning }) => ({ type: "warning", message: `Extension package "${path}": ${warning}` })),
		];

		const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
		const scopedModels = modelPatterns && modelPatterns.length > 0
			? await resolveModelScope(modelPatterns, modelRuntime, { signal: AbortSignal.timeout(15_000) })
			: [];
		const { options: sessionOptions, cliThinkingFromModel, diagnostics: sessionOptionDiagnostics } =
			buildSessionOptions(parsed, scopedModels, sessionManager.buildSessionContext().messages.length > 0, modelRuntime, settingsManager);
		diagnostics.push(...sessionOptionDiagnostics);
```

【注解】

- **五类诊断来源合并**：信任诊断、服务诊断、设置诊断、扩展加载错误、扩展包警告——全部变成 `AgentSessionRuntimeDiagnostic`（第 8.3.2 节的"只收集不打印"）。**运行时把它交给 main 层统一展示/裁决**（第 7.5 节）。
- 模型作用域：`parsed.models`（CLI）或设置里的 `enabledModels`；`resolveModelScope(..., { signal: 15s })` 把模式解析成模型列表（第 5.3.1 节）——**又一次 15 秒超时**（启动期的网络操作有统一预算）。
- `buildSessionOptions(parsed, scopedModels, isContinuing, modelRuntime, settingsManager)`：把 CLI 选项 + 作用域解析成"会话创建选项"（`sessionOptions`），还返回 `cliThinkingFromModel`（"思考级别来自模型后缀 `provider/model:high`"这种来源标记）与诊断。**这是 CLI 与 SDK 的最后一个接缝**：再往下就是 D5 的 `createAgentSessionFromServices`。

### 7.4 运行时 API Key 与"从服务建会话"

【源码（节选）】

```typescript
		if (parsed.apiKey) {
			if (!sessionOptions.model) {
				diagnostics.push({ type: "error", message: "--api-key requires a model to be specified via --model, --provider/--model, or --models" });
			} else {
				await modelRuntime.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
			}
		}

		const created = await createAgentSessionFromServices({
			services, sessionManager, sessionStartEvent,
			model: sessionOptions.model, thinkingLevel: sessionOptions.thinkingLevel, scopedModels: sessionOptions.scopedModels,
			tools: sessionOptions.tools, excludeTools: sessionOptions.excludeTools, noTools: sessionOptions.noTools, customTools: sessionOptions.customTools,
		});
		const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
		if (created.session.model && cliThinkingOverride) {
			created.session.setThinkingLevel(created.session.thinkingLevel);
		}

		return { ...created, services, diagnostics };
	};
```

【注解】

- `--api-key` 的**前置校验**：必须有明确模型（因为 key 要绑定到 provider）——否则报 error 诊断（最终会阻止启动，见第 7.5 节）；有模型时 `setRuntimeApiKey`（第 5 章的"运行时覆盖"）。
- `createAgentSessionFromServices(...)`：**D5 的 `createAgentSession` 的服务注入版**（第 8.3.2 节）——把装配好的服务原样传给会话创建。
- 【陷阱】`cliThinkingOverride` 与 `created.session.setThinkingLevel(created.session.thinkingLevel)` 这一对：**重新应用一次思考级别**。为什么？注释没写，但结合 D5 第 4 节：`createAgentSession` 内部按"恢复/设置"逻辑算出级别并 clamp；CLI 显式指定（`--thinking` 或模型后缀）时，要**覆盖回去并触发 setter 的副作用**（setter 可能会同步相关状态/写条目，第 13 章）。读这种"调用自己的 getter 再 set 回去"的写法时要**找出 setter 的副作用**才知道为什么需要——否则会觉得是 no-op。
- 返回 `{ ...created, services, diagnostics }`：`CreateAgentSessionRuntimeResult` 的三件套（D5 §0 的返回 + services + diagnostics）。

## 8. `createAgentSessionRuntime` 与运行时取值

【源码（节选）】

```typescript
	time("createRuntime");
	const runtime = await createAgentSessionRuntime(createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir,
		sessionManager,
	});
	time("createAgentSessionRuntime");
	const { services, session, modelFallbackMessage } = runtime;
	const { settingsManager, modelRuntime, resourceLoader } = services;
	setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());
	applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
	configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());
```

【注解】

- `createAgentSessionRuntime`（第 8.4 节）内部：`assertSessionCwdExists` → 调用工厂 → 包成 `AgentSessionRuntime`。注意传的 cwd 是 **`sessionManager.getCwd()`**（会话的目标 cwd，可能是别的项目）而不是进程 cwd。
- 拿到 runtime 后：解构服务与会话、**重设终端能力覆盖**（`setCapabilityOverrides`——终端能力探测的覆盖项，第 17 章）、**再次应用代理与 HTTP 调度器**（这次用 runtime 的**合并设置**——【陷阱】全局代理在 bootstrap 时已应用过一次，这里用"合并后"的设置再应用：即"项目设置里的代理也能生效"；这正是"必须等 cwd 确定"的价值）。

## 9. help / list-models / 管道输入与初始消息

【源码（节选）】

```typescript
	if (parsed.help) {
		reportDiagnostics(startupSettingsDiagnostics);
		const extensionFlags = resourceLoader.getExtensions().extensions.flatMap((extension) => Array.from(extension.flags.values()));
		printHelp(extensionFlags);
		process.exit(0);
	}

	if (parsed.listModels !== undefined) {
		reportDiagnostics(startupSettingsDiagnostics);
		const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
		await listModels(modelRuntime, searchPattern, AbortSignal.timeout(15_000));
		process.exit(0);
	}

	let stdinContent: string | undefined;
	if (appMode !== "rpc") {
		stdinContent = await readPipedStdin();
		if (stdinContent !== undefined && appMode === "interactive") {
			appMode = "print";
		}
	}
	time("readPipedStdin");

	const { initialMessage, initialImages } = await prepareInitialMessage(parsed, stdinContent);
	time("prepareInitialMessage");
```

【注解】

- **help**：先报启动设置诊断（帮助也要能看到配置问题），再**合并扩展注册的 flag** 后打印帮助（`extensionFlags`——扩展可以通过 `pi.registerFlag` 增加 CLI 选项，第 13.2 节）。
- **list-models**：15 秒超时的列表（含搜索）；同样先报诊断。
- **管道输入**：RPC 模式**不读** stdin（它是协议通道！）；其他模式读；读到内容且当前是 interactive → **降级为 print**（第 16.2 节的"管道自动降级"）。`readPipedStdin` 读的是"非 TTY stdin 的全部内容"（`git diff | pi ...` 的场景）。
- `prepareInitialMessage(parsed, stdinContent)`：把位置参数消息、`@file` 附件、stdin 文本、图片整理成 `initialMessage`/`initialImages`（第 16 章的 CLI 文档："Piped stdin 内容前置到第一个 prompt"）。

## 10. 主题、诊断与三种模式分发

【源码（节选）】

```typescript
	setThemeJsonValidator(validateThemeJson);
	initTheme(settingsManager.getTheme(), appMode === "interactive");
	time("initTheme");

	if (appMode === "interactive" && deprecationWarnings.length > 0) {
		await showDeprecationWarnings(deprecationWarnings);
	}

	time("resolveModelScope");
	const startupDiagnostics = deduplicateDiagnostics([...startupSettingsDiagnostics, ...runtime.diagnostics]);
	const hasRuntimeErrors = runtime.diagnostics.some((diagnostic) => diagnostic.type === "error");
	if (appMode !== "interactive" || hasRuntimeErrors) {
		reportDiagnostics(startupDiagnostics);
	}
	if (hasRuntimeErrors) {
		if (runtime.diagnostics.some((diagnostic) => diagnostic.message.includes("Failed to load extension"))) {
			console.error(chalk.yellow(EXTENSION_LOAD_FAILURE_HINT));
		}
		process.exit(1);
	}
	time("createAgentSession");

	if (appMode !== "interactive" && !session.model) {
		console.error(chalk.red(formatNoModelsAvailableMessage()));
		process.exit(1);
	}

	const startupBenchmark = isTruthyEnvFlag(process.env.PI_STARTUP_BENCHMARK);
	if (startupBenchmark && appMode !== "interactive") {
		console.error(chalk.red("Error: PI_STARTUP_BENCHMARK only supports interactive mode"));
		process.exit(1);
	}

	if (!offlineMode && appMode === "rpc") {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);
		void modelRuntime.refresh({ signal: controller.signal }).catch(() => {}).finally(() => clearTimeout(timeout));
	}

	if (appMode === "rpc") {
		printTimings();
		await runRpcMode(runtime);
	} else if (appMode === "interactive") {
		const interactiveMode = new InteractiveMode(runtime, { /* migratedProviders, startupDiagnostics, modelFallbackMessage, autoTrustOnReloadCwd, initialMessage, initialImages, initialMessages, verbose, tuiMode, initialThemeSetting */ });
		if (startupBenchmark) { /* 初始化后立刻退出并打印耗时 */ }
		printTimings();
		await interactiveMode.run();
	} else {
		printTimings();
		const exitCode = await runPrintMode(runtime, { mode: toPrintOutputMode(appMode), messages: parsed.messages, initialMessage, initialImages });
		stopThemeWatcher();
		restoreStdout();
		if (exitCode !== 0) {
			process.exitCode = exitCode;
		}
		return;
	}
```

【注解（收尾的六个决定）】

1. **主题初始化**：先设置 JSON 校验器（用户主题全量校验，第 17 章的"主题是用户数据"），再按模式初始化（`appMode === "interactive"` 决定要不要真的动终端）。
2. **弃用警告**：只在交互模式弹（非交互会污染协议输出）。
3. **诊断裁决**：交互且无错 → 不打印（TUI 会展示）；非交互或**有 error** → 打印；有 error → 追加"扩展加载失败提示"（针对性建议）→ **退出码 1**。这就是"收集-裁决"闭环的终点（第 8.3.2 节）。
4. **非交互无模型 → 报错退出**（print/json 没法"进界面再选"）。
5. **`PI_STARTUP_BENCHMARK` 仅交互**：非交互直接报错（它依赖 TUI 的初始化路径才有意义，第 19.2 节）。交互模式下：初始化 TUI → 给 150ms 让 stdin 处理器消费终端查询应答（Kitty 协议、设备属性、单元格尺寸）→ 停 → 打印耗时 → **等待 stdout/stderr drain** → return（不进入主循环）。这段"等 drain"是"退出前不丢输出"的细节（第 17 章的终端查询主题）。
6. **RPC 的后台目录刷新**：非离线 + RPC → 20 秒超时的 `modelRuntime.refresh()`，**不 await**（fire-and-forget，`.catch(() => {})` 吞错、`.finally` 清定时器）——注释说"interactive 模式在 TUI 初始化后再刷新"（时机不同）。
7. **三模式分发**：`runRpcMode(runtime)` / `new InteractiveMode(runtime, {...})` + `run()` / `runPrintMode(runtime, { mode: toPrintOutputMode(appMode), ... })`。print 分支的收尾：`stopThemeWatcher()` + `restoreStdout()`（把第 4 节接管的 stdout 还回去）+ 退出码传递（`process.exitCode = exitCode`——**不强制 process.exit**，让进程自然退出，避免截断输出）。

## 11. 总结

### 11.1 `main()` 的阶段表（背下来）

```text
① 打点/离线/扩展工厂
② auth 短路 → Windows 清理 → bootstrap 设置（只全局）→ 包/配置/mcp 短路
③ parseArgs → 诊断裁决 → version/export 短路
④ appMode 解析 → takeOverStdout → RPC @file 拒绝 → fork 校验
⑤ 迁移 → startup 设置（默认信任）→ 首次引导 → 主题覆盖
⑥ 会话目录三级 → 会话管理器 → 缺 cwd 处理
⑦ createRuntime 工厂（信任解析/服务/诊断/作用域/会话选项/运行时 key/建会话）
⑧ createAgentSessionRuntime → 能力/代理/调度器
⑨ help / list-models → stdin → 初始消息 → 主题
⑩ 诊断裁决（error 退出）→ 无模型（非交互）退出 → benchmark 校验
⑪ RPC 后台刷新 → 三模式分发
```

### 11.2 与 D5 的关系

```text
main.ts        = 环境/命令行 → 决定"往哪儿装配"（模式、会话、信任、路径）
sdk.ts         = 决定"装配什么"（服务、Agent、AgentSession 的连线）
agent-session  = 决定"运行起来后怎么活"（prompt 主路径、压缩、重试）
```

### 11.3 阅读检查清单

- [ ] 我能说出"三个 SettingsManager 阶段"的信任级别与用途吗？
- [ ] 我知道 `sessionDir` 为什么在信任前可读吗？（引导期例外）
- [ ] 我能解释 `takeOverStdout` 与它的例外吗？
- [ ] 我知道信任回调为什么接收 `extensionsResult` 吗？（预加载用户级扩展）
- [ ] 我能说出 `createRuntime` 哪些输入是闭包（冻结）、哪些是参数（随替换变化）吗？
- [ ] 我知道 print 分支为什么不 `process.exit` 吗？（自然退出、避免截断）

---

> D6 完。下一篇（D7）精读内置工具：`read.ts`、`write.ts`、`truncate.ts`、`output-accumulator.ts`、`bash.ts` 的关键段。