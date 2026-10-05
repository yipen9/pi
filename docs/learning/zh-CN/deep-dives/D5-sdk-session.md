# D5：`sdk.ts` 装配与 `agent-session.ts` 主路径精读

> 精读对象：`packages/coding-agent/src/core/sdk.ts` 的 `createAgentSession`（约 300 行，全书的"装配总装线"）与 `core/agent-session.ts` 中 `prompt` 主路径的关键段。
> 对应主线：第 3 章（请求旅程）、第 8 章（生命周期）。
> 说明：`agent-session.ts` 有 158KB，本篇不复读它的一切——只译注与装配直接相接的入径段（完整行为已在第 3、8 章讲清）。

---

# 第一部分：`createAgentSession` 的八个阶段

## 0. 函数签名与选项

【源码】

```typescript
export async function createAgentSession(options: CreateAgentSessionOptions = {}): Promise<CreateAgentSessionResult> {
```

【注解】

- `options = {}` 默认空对象：**全部可选**——一切未给都可发现/默认（第 15.2 节的"uses all defaults"由此而来）。
- 返回 `CreateAgentSessionResult`：`{ session, extensionsResult, modelFallbackMessage }`（第三个在恢复模型失败时给出提示）。

## 1. 路径与核心服务（前 20 行）

【源码】

```typescript
	const cwd = resolvePath(options.cwd ?? options.sessionManager?.getCwd() ?? process.cwd());
	const agentDir = options.agentDir ? resolvePath(options.agentDir) : getDefaultAgentDir();
	let resourceLoader = options.resourceLoader;

	const authPath = options.agentDir ? join(agentDir, "auth.json") : undefined;
	const modelsPath = options.agentDir ? join(agentDir, "models.json") : undefined;
	const modelRuntime = options.modelRuntime ?? (await ModelRuntime.create({ authPath, modelsPath }));

	const settingsManager = options.settingsManager ?? SettingsManager.create(cwd, agentDir);
	const sessionManager = options.sessionManager ?? SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir));

	if (!resourceLoader) {
		resourceLoader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
		await resourceLoader.reload();
		time("resourceLoader.reload");
	}
```

【注解（逐行）】

- **cwd 三级回落**：显式 `options.cwd` → 会话管理器已有的 cwd → `process.cwd()`。**为什么会话管理器优先于进程目录？** 因为恢复的会话可能属于别的目录（第 8.5.1 节），此时"会话的 cwd"才是正确目标。【陷阱】注意这里用的是**空值合并**（`??`）：空字符串 cwd 会继续回落——而不是"用空字符串"。
- `agentDir`：显式给了才 `resolvePath`，否则用 `getDefaultAgentDir()`（默认 `~/.pi/agent`，第 11.2 节）。
- **authPath/modelsPath 的"仅在显式 agentDir 时构造"**：这两个路径是给"自定义 agentDir"场景的显式指向；没有显式 agentDir 时传 `undefined`，让 `ModelRuntime.create` 走它自己的默认解析（避免这里替它做主）。【陷阱】这是个微妙的"不越权"设计——默认路径的知识留在 ModelRuntime 内，装配层只在需要覆盖时出手。
- 四个"`options.X ?? 默认`"：
  - `modelRuntime`：`ModelRuntime.create({ authPath, modelsPath })` **异步**（要读凭据/目录）；
  - `settingsManager`：`SettingsManager.create(cwd, agentDir)`（第 11.3 节）；
  - `sessionManager`：`SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir))`——**会话目录由 cwd 编码而来**（第 9.2.1 节）；
  - `resourceLoader`：仅当没给时才**构造 + reload**（发现扩展/技能/模板/主题）。
- `time("resourceLoader.reload")`：启动打点（第 19.2.2 节的 `printTimings` 会读它）。
- 【陷阱】注意 `resourceLoader` 声明为 `let` 且先取 `options.resourceLoader`——**"没给才创建"** 意味着注入的 loader 由调用方负责 reload（对比 `03-custom-prompt.ts`：构造 `new DefaultResourceLoader(...)` 后显式 `await loader1.reload()` 再传入。如果忘性 reload，扩展/技能不会在会话里出现——这是 SDK 新手最常见的坑之一）。

## 2. 会话恢复的前置读取

【源码】

```typescript
	// Check if session has existing data to restore
	const existingSession = sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");
```

【注解】

- `buildSessionContext()`：**三级投影的最终产物**（D3 精读）——恢复要用的消息与设置都在这里。
- `hasExistingSession`：判断"是否有历史"（消息数 > 0）。【陷阱】这里的 `messages` 是**投影**结果：如果历史全被上下文编辑省略，可能"有条目但消息为 0"——此时按"无历史"处理（有意的：对模型而言确实没内容可恢复）。
- `hasThinkingEntry`：单独扫**原始条目**（`getBranch()`）找"思考级别变更"——为什么不像模型那样用投影的设置？因为需要区分"**真的是 off**"与"**什么都没记录（老会话）**"。第 11 章的同类问题（`hasThinkingEntry` 在 sdk 和会话里被用两次：装配时与追加元数据时）。【陷阱】`buildSessionContext()` 里的 `thinkingLevel` 默认就是 `"off"`——无法表达"未记录"；所以查原始条目是唯一可靠的办法。

## 3. 模型解析：四步降级

【源码】

```typescript
	let model = options.model;
	let modelFallbackMessage: string | undefined;

	// Assistant messages name the physical model that answered, so a virtual selection is only in
	// model_change entries.
	const sessionModel = getBranchSelection(sessionManager.getBranch(), (provider, modelId) =>
		modelRuntime.getModel(provider, modelId),
	);

	// If session has data, try to restore model from it
	if (!model && hasExistingSession && sessionModel) {
		const restoredModel = modelRuntime.getModel(sessionModel.provider, sessionModel.modelId);
		if (restoredModel && modelRuntime.hasConfiguredAuth(restoredModel.provider)) {
			model = restoredModel;
		}
		if (!model) {
			modelFallbackMessage = `Could not restore model ${sessionModel.provider}/${sessionModel.modelId}`;
		}
	}

	// If still no model, use findInitialModel (checks settings default, then provider defaults)
	if (!model) {
		const result = await findInitialModel({
			scopedModels: [],
			isContinuing: hasExistingSession,
			defaultProvider: settingsManager.getDefaultProvider(),
			defaultModelId: settingsManager.getDefaultModel(),
			defaultThinkingLevel: settingsManager.getDefaultThinkingLevel(),
			modelThinkingLevels: settingsManager.getAllModelThinkingLevels(),
			modelRuntime,
		});
		model = result.model;
		if (!model) {
			modelFallbackMessage = formatNoModelsAvailableMessage();
		} else if (modelFallbackMessage) {
			modelFallbackMessage += `. Using ${model.provider}/${model.id}`;
		}
	}
```

【注解（四步优先级）】

1. **显式 `options.model`**：调用方说了算（最高）。
2. **会话恢复**（仅当"有历史且没显式给"）：`getBranchSelection(branch, lookup)` 从条目里找出"该会话应恢复的模型选择"（虚拟模型路由/`model_change`/物理模型的后手——注释说明"虚拟选择只在 `model_change` 里，助手消息写的是物理模型"）。
   - 恢复还要**双重校验**：模型仍在目录中（`getModel`）**且**该供应商有配置好的认证（`hasConfiguredAuth`）。【陷阱】两个条件缺一不可——目录里有但没凭据时会走"恢复失败"分支，给出 `Could not restore model ...` 提示，然后继续降级。
3. **`findInitialModel`**：按"设置里的默认 provider/model → 各供应商默认"找第一个可用（`model-resolver.ts`，第 3.5 节）。
4. 都没有：`modelFallbackMessage = formatNoModelsAvailableMessage()`。

- 【陷阱】`modelFallbackMessage` 是**字符串拼接**的：先可能写"恢复失败"，再在找到替代模型时追加 `". Using provider/id"`——所以最终提示是"原模型没恢复，改用 X"的完整信息。**拼接式提示**在仓库里常见，读消息文案要按整句理解。
- 【陷阱】`scopedModels: []` 硬编码空数组：装配阶段不做模型作用域（那是 CLI/`buildSessionOptions` 的事，第 3.4 章）；SDK 调用者要作用域就通过 `options.scopedModels` 在别处处理……等等，`options.scopedModels` 在下面 `new AgentSession` 时才用（第 8 节）——这里传空数组表示"找初始模型时不考虑作用域"。**同一个选项在流程的不同阶段有不同消费点**。

## 4. 思考级别：五级降级与钳制

【源码】

```typescript
	let thinkingLevel = options.thinkingLevel;

	// If session has data, restore thinking level from it
	if (thinkingLevel === undefined && hasExistingSession) {
		thinkingLevel = hasThinkingEntry
			? (existingSession.thinkingLevel as ThinkingLevel)
			: (settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL);
	}

	// Fall back to per-model override, then global default
	if (thinkingLevel === undefined && model) {
		const perModel = settingsManager.getModelThinkingLevel(model.provider, model.id);
		if (perModel) thinkingLevel = perModel;
	}
	if (thinkingLevel === undefined) {
		thinkingLevel = settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
	}

	// Clamp to model capabilities
	if (!model) {
		thinkingLevel = "off";
	} else {
		thinkingLevel = clampThinkingLevel(model, thinkingLevel) as ThinkingLevel;
	}
```

【注解（优先级链）】

1. 显式 `options.thinkingLevel`；
2. 会话恢复：有"思考级别条目"→ 用投影里的值；**没有条目但已存在会话**（老会话）→ 用设置默认（而不是 `"off"`）——【陷阱】这就是 `hasThinkingEntry` 的第二处用途：老会话补一个"合理默认"而不是"最低级"；
3. 每模型覆盖（`getModelThinkingLevel(provider, id)`）；
4. 全局默认（`?? DEFAULT_THINKING_LEVEL`）。

- 最后一步 **clamp**：没有模型 → 强制 `"off"`；有模型 → `clampThinkingLevel(model, level)`（第 5.3 节的"按能力钳制"）。
- 【陷阱】`as ThinkingLevel` 断言：`clampThinkingLevel` 的返回类型可能更宽（含 `"off"` 的联合），这里收窄——执行时它返回的确实是合法级别（含 off）。理解这一类断言要看函数契约，不要只信 `as`。
- 【陷阱】四级降级的顺序不能看错：**"每模型覆盖"在"全局默认"之前**，但**"会话恢复"在两者之前**。也就是说：恢复一个老会话时，即便设置里后来改了默认，也优先用该会话记录值（会话一致性 > 全局新偏好）。

## 5. 工具集计算：allowlist / denylist / 默认

【源码】

```typescript
	const configuredDefaultToolNames = settingsManager.getDefaultTools();
	const allowedToolNames = options.tools ?? (options.noTools === "all" ? [] : undefined);
	const excludedToolNames = options.excludeTools;
	const excludedToolNameSet = excludedToolNames ? new Set(excludedToolNames) : undefined;
	const initialActiveToolNames = (
		options.tools ?? (options.noTools ? [] : (configuredDefaultToolNames ?? DEFAULT_TOOL_NAMES))
	).filter((name) => !excludedToolNameSet?.has(name));
```

【注解（三个变量的分工）】

- `allowedToolNames`（**最终白名单的"上限"语义**）：
  - 传了 `options.tools` → 就是它；
  - `noTools === "all"` → `[]`（空数组=全禁）；
  - 否则 `undefined`（"没有上限"——由默认集决定）。
- `excludedToolNames` / Set：**黑名单**（在初始激活集里过滤掉）。
- `initialActiveToolNames`（**初始激活**）：
  - 优先级：显式 tools → `noTools`（任何值都变空）→ 设置里的 `defaultTools` → 内置 `DEFAULT_TOOL_NAMES`；
  - 最后 `.filter` 掉黑名单。
- 【陷阱】三个概念不同：**上限**（allowed，用于"能启用什么"）、**初始激活**（initialActive，会话开始时开哪些）、**黑名单**（exclude，任何情况下都不开）。扩展注册的工具可以"存在于注册表但不在激活集"（第 7.3 节的声明 vs 可执行；第 14.7 节的 `tools.ts` 动态开关）。
- 【陷阱】`options.noTools` 的取值语义（类型是 `"all" | "builtin"`）："all" 全禁（包括扩展工具）；"builtin" 只禁内置（保留扩展工具）——但**这段代码里两者都变成 `[]`**？看仔细：`options.noTools ? [] : ...` 对任何真值都取空——**"builtin" 的差异不在这里处理**，而是通过 `usesDefaultTools: options.tools === undefined && !options.noTools`（第 8 节传入会话）与 ResourceLoader 里的扩展加载策略实现（扩展工具仍注册，但初始激活为空的区别由会话侧逻辑决定）。【陷阱】读装配代码时要意识到"选项的完整语义可能分散在多个消费点"——这正是"只读一个函数会误判行为"的典型。

## 6. 图像屏蔽包装（防御纵深）

【源码（节选）】

```typescript
	const convertToLlmWithBlockImages = (messages: AgentMessage[]): Message[] => {
		const converted = convertToLlm(messages);
		// Check setting dynamically so mid-session changes take effect
		if (!settingsManager.getBlockImages()) {
			return converted;
		}
		// Filter out ImageContent from all messages, replacing with text placeholder
		return converted.map((msg) => {
			if (msg.role === "user" || msg.role === "toolResult") {
				const content = msg.content;
				if (Array.isArray(content)) {
					const hasImages = content.some((c) => c.type === "image");
					if (hasImages) {
						const filteredContent = content
							.map((c) => (c.type === "image" ? { type: "text" as const, text: "Image reading is disabled." } : c))
							.filter(/* 去掉连续重复的占位文本 */);
						return { ...msg, content: filteredContent };
					}
				}
			}
			return msg;
		});
	};
```

【注解】

- **包装而非替换**：先调真实 `convertToLlm`（第 4.4.2 节的翻译），再按设置做**图片屏蔽**。
- **动态读设置**：注释 "Check setting dynamically so mid-session changes take effect"——闭包每次调用都 `getBlockImages()`，所以用户在会话中途改设置、下一请求即生效。**这是"设置读取点"的教科书案例**：能动态读就别在装配时快照。
- 屏蔽范围：user 与 toolResult 两类消息（模型与工具结果都可能带图）；assistant 内容里的图？——助手消息没有 ImageContent（类型里是 text/thinking/toolCall），所以不用处理。
- 占位符 `"Image reading is disabled."` + **去重连续重复**（同一消息里多张图被换成多段相同文本时，只留一段）——细节见被省略的 filter（条件比较 `i > 0 && arr[i-1]` 是相同文本块）。【陷阱】这是"用户体验细节"进入内核转换层的例子：为什么不让下游 UI 去重？因为**占位文本会发给模型**，重复浪费 token；所以去重必须在**消息构建时**完成。
- 返回**新消息对象**（`{ ...msg, content: ... }`）只对有图的消息；无图消息原样（保持对象身份——第 4.8 节的映射依赖）。

---

> D5 第一部分到此。第二部分：扩展管线（`extensionRunnerRef` 与三处 provider 钩子）、缓存预热与请求选项、`Agent` 装配、会话元数据、`AgentSession` 装配与返回，以及对 `agent-session.ts` prompt 主路径的对照注。
---

# 第二部分：扩展管线、缓存预热与两层装配

## 7. `extensionRunnerRef`：一个"空盒子"和它的填装时机

【源码】

```typescript
	const extensionRunnerRef: { current?: ExtensionRunner } = {};
	const cacheWarmer = new CacheWarmer(
		modelRuntime,
		sessionManager,
		() => settingsManager.getCacheWarmingMode(),
		async (event) => extensionRunnerRef.current?.emitCacheWarmingDecision(event) ?? event.action,
	);
```

【注解（顺序问题）】

- `ExtensionRunner` 的**创建在会话层**（`AgentSession` 构造/绑定时，第 13 章），但 `Agent` 的 `streamFn`/钩子在**装配当下**就需要能"转发给扩展"——于是用一个**可变盒子**（`{ current?: ExtensionRunner }`）先占位：
  - 装配阶段创建盒子并闭包捕获；
  - 会话创建/绑定后把 runner 填进去（`extensionRunnerRef.current = runner`）；
  - 所有钩子通过 `extensionRunnerRef.current?.` 可空访问——**runner 未装时静默跳过**。
- 【陷阱】这是一个典型的"**打破创建顺序依赖**"手法（别名"holder/ref pattern"）。读代码时看到 `xxxRef.current` 就要找"谁给它赋值"；这里赋值方是 `AgentSession`（构造参数 `extensionRunnerRef`，见第 9 节）。
- `CacheWarmer` 构造参数四件套：`modelRuntime`（谁来预热）、`sessionManager`（读会话 id/条目）、**模式 getter**（`() => settingsManager.getCacheWarmingMode()`——动态读）、**决策回调**（先问扩展、扩展无意见就用 `event.action`）。
- 【陷阱】第四参的 `?? event.action`：`emitCacheWarmingDecision` 返回 undefined（没扩展处理/没给出动作）时用事件里建议的动作。这里就是第 13.3.6 节 `cache_warming_decision` 的消费方。

## 8. `buildRequestOptions`：每次请求的"选项拼装"

【源码】

```typescript
	const buildRequestOptions = (
		requestModel: Model<any>,
		options: ModelsSimpleStreamOptions = {},
	): ModelsSimpleStreamOptions => {
		const providerRetrySettings = settingsManager.getProviderRetrySettings();
		const httpIdleTimeoutMs = settingsManager.getHttpIdleTimeoutMs();
		const effectiveTimeoutMs = httpIdleTimeoutMs === 0 ? 2147483647 : httpIdleTimeoutMs;
		const headerRunner = extensionRunnerRef.current;
		return {
			...options,
			timeoutMs: options.timeoutMs ?? providerRetrySettings.timeoutMs ?? effectiveTimeoutMs,
			websocketConnectTimeoutMs: options.websocketConnectTimeoutMs ?? settingsManager.getWebSocketConnectTimeoutMs(),
			maxRetries: options.maxRetries ?? providerRetrySettings.maxRetries,
			maxRetryDelayMs: options.maxRetryDelayMs ?? providerRetrySettings.maxRetryDelayMs,
			transformHeaders: async (requestHeaders) => {
				const headers = mergeProviderAttributionHeaders(
					requestModel,
					settingsManager,
					options.sessionId,
					requestHeaders,
				);
				return headerRunner?.hasHandlers("before_provider_headers")
					? headerRunner.emitBeforeProviderHeaders(headers ?? {})
					: (headers ?? {});
			},
		};
	};
```

【注解（四层选项合并）】

- 合并顺序（每项各自）：**调用方传入的 options**（来自循环的 config 摊开，D1 第 18 节）→ `?? providerRetrySettings.X`（设置）→ `?? 生效兜底`。
- `httpIdleTimeoutMs === 0 → 2147483647`：把"0 = 永不超时"翻译成**int32 最大值**（约 24.8 天）——因为下游（undici/供应商 SDK）要求一个具体数字而不是 0/Infinity。【陷阱】这是"设置语义 → 传输层语义"的桥，读"0 是什么含义"要看这类转换点（第 11.3.4 节 getter 的语义在消费处才有完整定义）。
- `transformHeaders`：**函数式选项**——先合并供应商归因头（`mergeProviderAttributionHeaders`：第 5 章"请求头归因"），再（若有扩展）过 `before_provider_headers` 钩子。【陷阱】它每次请求**被调用时才执行**（不是装配时算好），所以 headers 是"请求时点"的——这是供应商 SDK 提供的钩子能力。
- 【陷阱】`headerRunner` 在**调用 buildRequestOptions 时**快照（`const headerRunner = extensionRunnerRef.current`），而 `transformHeaders` 闭包引用它——如果请求发出前 runner 被替换？这个函数是**每次请求前**调用的（`streamFn` 包装里），所以快照新鲜度是"每次请求"级别，够用。读闭包变量时永远问"它捕获的是哪个时点的值"。

## 9. `cacheContextIsCurrent`：预热结果的"过期判定"

【源码】

```typescript
	// Warm only requests for the selected model. Requests a virtual selection routed, or that an
	// extension redirected, may not be repeated by the next request, so warming them could be wasted.
	const cacheContextIsCurrent = (requestModel: Model<any>) => {
		const messages = agent.state.messages;
		return () => {
			const currentModel = agent.state.model;
			const currentMessages = agent.state.messages;
			return (
				currentModel.provider === requestModel.provider &&
				currentModel.id === requestModel.id &&
				messages.length <= currentMessages.length &&
				messages.every((message, index) => currentMessages[index] === message)
			);
		};
	};
```

【注解】

- 返回一个**判定闭包**给 `cacheWarmer.start(..., cacheContextIsCurrent(model))`（第 7 节的 streamFn 包装里用）。
- 判定逻辑（"这次预热的上下文还有效吗"）：
  1. 模型未变（provider + id）；
  2. 预热时的消息数组是当前数组的**前缀**（`messages.length <= currentMessages.length` 且逐项**引用相等** `===`）。
- 【陷阱】**引用相等**（`===`）：只比较每个位置的**对象身份**。为什么不用深比较？因为预热条件本来就是"同一条消息序列的前缀一致"——对象被替换（哪怕内容相同）就意味着上下文变过，预热可能不命中（宁可不命中也不误判）。注释原文也讲了"Agent state may shallow-copy the messages array or refresh the model object ... so top-level object identity is not a valid cache key"——**数组/模型的顶层身份不可靠，但消息元素的身份可靠**（消息对象在定稿后不再被替换，除 D1 第 19 节的"部分消息→最终消息"替换点——替换发生在 `message_end`，预热发起时用的是定稿后快照，安全）。
- 【陷阱】`const messages = agent.state.messages` 在**工厂调用时**读取（不是判定时）——所以闭包里的 `messages` 是"发起预热那一刻"的数组；判定时再取 `currentMessages` 比较。两个时点的对照就是这道检查的全部意义。

## 10. 三处 provider 钩子

【源码】

```typescript
	const transformProviderPayload = async (payload: unknown) => {
		const runner = extensionRunnerRef.current;
		if (!runner?.hasHandlers("before_provider_request")) return payload;
		return runner.emitBeforeProviderRequest(payload);
	};
	const handleProviderResponse: NonNullable<ModelsSimpleStreamOptions["onResponse"]> = async (response) => {
		const runner = extensionRunnerRef.current;
		if (!runner?.hasHandlers("after_provider_response")) return;
		await runner.emit({ type: "after_provider_response", status: response.status, headers: response.headers });
	};
	const handleProviderStreamEvent: NonNullable<ModelsSimpleStreamOptions["onProviderStreamEvent"]> = async (data, model) => {
		const runner = extensionRunnerRef.current;
		if (!runner?.hasHandlers("provider_stream_event")) return;
		await runner.emit({ data, type: "provider_stream_event", provider: model.provider, api: model.api, model: model.id });
	};
```

【注解】

- 三个都是"**先查有没有处理器，再发**"：`hasHandlers(name)` 是快速门（避免空转），没处理器就直接返回/透传。
- `transformProviderPayload`（`onPayload`）：**可以改 payload**（`return runner.emitBeforeProviderRequest(payload)`——返回的是变换后的对象）——注意前两个是"通知"（无返回值消费），这个是"变换"。【陷阱】三处语义不同，看钩子名与返回值：`before_provider_request`（变换）vs `after_provider_response`/`provider_stream_event`（通知）。
- 【陷阱】`handleProviderResponse` 里 `return;`（早退）而不是 `return 某个值`——它是通知型钩子；类型 `NonNullable<...["onResponse"]>` 提醒我们它的签名来自 pi-ai 的选项类型（返回 `void | Promise<void>`），**装配层必须匹配那个契约**。
- `provider_stream_event` 把自己的身份信息（provider/api/model）打包进事件——扩展能据此区分来源（第 13.3.6 节的 read-only 通知）。

## 11. `Agent` 装配：把一切接起来

【源码】

```typescript
	const agent = new Agent({
		initialState: {
			systemPrompt: "",
			model,
			thinkingLevel,
			tools: [],
			messages: existingSession.messages,
		},
		convertToLlm: convertToLlmWithBlockImages,
		streamFn: async (model, context, options) => {
			const requestOptions = buildRequestOptions(model, options);
			// Compaction and summaries use their own routing ids; only session requests
			// replace the cache entry, so warming restarts from them. Keep warming while
			// the current transcript still extends the request's prefix. ...
			if (options?.sessionId === sessionManager.getSessionId()) {
				cacheWarmer.start({ model, context, options: requestOptions }, cacheContextIsCurrent(model));
			}
			return modelRuntime.streamSimple(model, context, requestOptions);
		},
		onPayload: transformProviderPayload,
		onResponse: handleProviderResponse,
		onProviderStreamEvent: handleProviderStreamEvent,
		sessionId: sessionManager.getSessionId(),
		transformContext: async (messages) => {
			const runner = extensionRunnerRef.current;
			if (!runner) return messages;
			return runner.emitContext(messages);
		},
		steeringMode: settingsManager.getSteeringMode(),
		followUpMode: settingsManager.getFollowUpMode(),
		transport: settingsManager.getTransport(),
		thinkingBudgets: settingsManager.getThinkingBudgets(),
		maxRetryDelayMs: settingsManager.getProviderRetrySettings().maxRetryDelayMs,
	});
```

【注解（四组）】

**initialState（第 D2 节精读过 Agent 构造）**

- `systemPrompt: ""`：**空字符串**——真正的系统提示由会话层在每次 prompt 前组装（第 10 章）。为什么是空而不是默认文本？因为真实提示依赖"当次请求的上下文"（工具集、技能、项目文件），装配期没有这些。
- `tools: []`：初始空——工具注册由 `AgentSession`/扩展系统后填（第 13.2 节）。这是一个"先造空壳、后注入内容"的两段式装配。
- `messages: existingSession.messages`：**直接引用**投影消息数组——`createMutableAgentState` 里会 `slice()` 复制顶层（第 D2 节 §2.2）。

**streamFn（本书最重要的一个包装函数）**

- 三步：构造请求选项 → **条件性**启动缓存预热 → 调 `modelRuntime.streamSimple`。
- 预热条件 `options?.sessionId === sessionManager.getSessionId()`：只有"**会话请求**"才预热（压缩/摘要用自己的 id——注释原文："Compaction and summaries use their own routing ids; only session requests replace the cache entry"）。【陷阱】比较的两个 id 来源不同：`options.sessionId` 是**循环 config 里传下来的**（`Agent.sessionId` = `sessionManager.getSessionId()`，第 11 节下面）；但压缩路径构造的 `SimpleStreamOptions` 里可能有别的 id（D4 第 9 节：`options.sessionId ?? uuidv7()`）——所以这个条件实际是"**是不是主会话那条链**"的判定。
- 【陷阱】`cacheWarmer.start(...)` 不 await（它只是启动后台预热）；错误在预热器内部处理（不阻塞主请求）。

**透传钩子**：`onPayload`/`onResponse`/`onProviderStreamEvent` 三个 + `sessionId`（供应商会话亲和/缓存） + `transformContext`（扩展的 `context` 钩子——runner 未装时透传原消息）。

**行为参数**：steeringMode/followUpMode/transport/thinkingBudgets/maxRetryDelayMs——从设置动态读（注意这些是**装配时快照**：会话中途改设置对它们**本轮会话不生效**？【陷阱】不对——`steeringMode` 等进入 `Agent` 字段，而 `Agent.createLoopConfig` 每次运行时读字段（D2 第 12 节）；`AgentSession` 有 setter 会同步改 `agent.steeringMode`（第 13 章）。装配时的读取只是"初始值"）。

## 12. 会话元数据：为恢复写"铭牌"

【源码】

```typescript
	// Restore missing settings metadata for older sessions.
	if (hasExistingSession) {
		if (!hasThinkingEntry) {
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		if (model) {
			sessionManager.appendModelChange(model.provider, model.id);
		}
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}
```

【注解】

- 老会话补"思考级别条目"（因为第 4 节给它算了一个默认值，现在把这个决定**持久化**，下次恢复就有据可依——`hasThinkingEntry` 的第三处用途）。
- 新会话：写 `model_change`（有模型时）与 `thinking_level_change`——这就是第 9.4.5 节"沿路径取设置"的数据来源。**【陷阱】注意写的是 `model.provider/id`（选择的模型），而不是物理回复模型——与 D3 的"物理模型优先"形成配合：选择记录用 `model_change`，实际回答用助手消息。**
- 【陷阱】这些追加发生在**Agent 创建之后、会话创建之前**——`sessionManager` 的写与 `AgentSession` 无关；即使后续构造抛错，元数据已经写进文件（"追加即持久"的语义）。这种"写顺序"对崩溃分析有意义（老手会检查"为什么文件里有 model_change 但没有像样的会话"）。

## 13. `AgentSession` 装配与返回

【源码】

```typescript
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd,
		scopedModels: options.scopedModels,
		resourceLoader,
		customTools: options.customTools,
		modelRuntime,
		cacheWarmer,
		initialActiveToolNames,
		usesDefaultTools: options.tools === undefined && !options.noTools,
		allowedToolNames,
		excludedToolNames,
		extensionRunnerRef,
		sessionStartEvent: options.sessionStartEvent,
	});

	const extensionsResult = resourceLoader.getExtensions();

	return {
		session,
		extensionsResult,
		modelFallbackMessage,
	};
}
```

【注解】

- 传入的 15 项正是第 8.2 节"资源清单"的实例化：agent、三个 manager、cwd、模型作用域、资源加载器、自定义工具、模型运行时、缓存预热器、三个工具集变量、**扩展盒子**（第 7 节的赋值方在这里）、会话启动事件。
- `usesDefaultTools: options.tools === undefined && !options.noTools`：把"是否使用默认工具集"的判定**下推给会话**（第 5 节的【陷阱】——`noTools: "builtin"` 与 `"all"` 的区别由会话侧消费这个布尔来区分扩展工具与内置工具）。
- `extensionsResult = resourceLoader.getExtensions()`：返回值里带上扩展加载结果（供 UI 初始化用——交互模式需要扩展的 flags/命令清单，第 3.4.4 节）。
- 返回三件套：`session`、`extensionsResult`、`modelFallbackMessage`。

## 14. 对照：`agent-session.ts` 的 prompt 主路径（选段）

`sdk.ts` 装配完成后，日常行为从 `AgentSession.prompt` 开始（完整走查见第 3.6 节）。这里只标出与装配**直接相接**的四个点：

**（1）`_preparePromptAndToolLoadout` 的产物就是"系统补丁"**

第 3.6 节节选过：

```typescript
	const updateMessage = this._preparePromptAndToolLoadout(result.systemPromptOptions);
	this._runSystemPromptOptions = result.systemPromptOptions;
	if (updateMessage) messages.unshift(updateMessage);
```

- `updateMessage` 是**要注入的消息列表**（可能含一条系统消息——由 `diffSystemPromptSections` 与工具差分生成，D4 第 5 节 / D1 第 16 节）。
- 它在**用户消息之前** `unshift`——所以模型读到的顺序是"先声明状态变化，再读用户输入"。

**（2）`_runAgentPrompt` 的双层循环**

```typescript
	private async _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void> {
		this._agentRunAbortRequested = false;
		this._failedResponse = undefined;
		this._recordSelection();
		this._pendingToolNames.clear();
		this._isAgentRunActive = true;
		try {
			await this.agent.prompt(messages);
			while (!this._agentRunAbortRequested) {
				if (await this._handlePostAgentRun()) {
					if (this._agentRunAbortRequested) break;
					await this.agent.continue();
					continue;
				}
				if (this._agentRunAbortRequested || !(await this._runBeforeSettleBoundary())) break;
				if (this._agentRunAbortRequested) break;
				await this.agent.continue();
			}
		} finally { /* ... 收尾 ... */ }
	}
```

- 与 D2 的 `Agent` 层对照：**`agent.prompt` 管"一次运行"，`_runAgentPrompt` 的 while 管"一组运行"**（重试/压缩后继续/边界续跑）。两层各自的守卫也要分清：`Agent.activeRun` 防并发；`_agentRunAbortRequested`/`_isAgentRunActive` 是会话级状态位。
- 【陷阱】两次 `agent.continue()` 所在的路径含义不同：第一次是 `_handlePostAgentRun` **要求**继续（重试/压缩/队列）；第二次是**边界钩子**要求继续（`_runBeforeSettleBoundary`）。同一动作出现在两处，别以为是重复代码。

**（3）流式守卫的时机**（第 7.8 节 `read.ts` 同款）

```typescript
		if (this.isStreaming) {
			if (!options?.streamingBehavior) throw new Error("Agent is already processing. Specify streamingBehavior ...");
			...
		}
```

- `isStreaming` 读的是 `Agent` 的状态（D2 第 17 节）；「必须显式选 steer/followUp」的契约因此是**跨两层的**：D2 的类型/错误 + D5 的装配 + 第 6 章的队列语义。
- 【陷阱】这个守卫在 `prompt` 里、`agent.prompt` 之前——所以"运行中调用"根本到不了 `Agent` 的守卫（那里还有一道，D2 §8）。**两道守卫，各自面向不同调用路径**（SDK 直接调 `agent.prompt` 绕过会话层）。

**（4）`command`/模板展开的输入管线**

第 3.6 节的 ④⑤：`_runInputHandlers`（扩展 input 事件）→ 扩展命令 → `_expandSkillCommand` → `expandPromptTemplate`。这四步产出最终 `expandedText`——对照 D2 的 `normalizePromptInput`：**会话层的人物是"文本加工"，Agent 层的人物是"文本→消息"**。分工明确，改输入行为不要写错层。

## 15. 总结

### 15.1 装配的依赖顺序（改了谁要先想清）

```text
cwd/agentDir → ModelRuntime → SettingsManager → SessionManager → ResourceLoader.reload
  → 恢复读取（buildSessionContext / getBranch）
  → model 四步降级 → thinkingLevel 四级降级+钳制
  → 工具集三变量
  → convertToLlm 包装（动态设置）
  → 扩展盒子 + CacheWarmer + buildRequestOptions（动态设置）
  → Agent（streamFn 包装 = 选项 + 预热 + modelRuntime）
  → 会话元数据追加（model_change / thinking_level_change）
  → AgentSession（15 项注入）→ 返回三件套
```

### 15.2 五个"读 sdk.ts 容易错"的点

1. **cwd 优先级**：options → 会话管理器 → 进程目录（不是简单的 options ?? process.cwd()）。
2. **恢复的双重校验**：模型在目录 **且** 有认证，缺一走 fallback。
3. **两级"noTools"**：装配层只算初始集；"builtin vs all"的差异由会话消费 `usesDefaultTools`。
4. **动态 vs 快照**：`getBlockImages()` 动态读；`steeringMode` 等装配时读初始值（后续由会话同步）。
5. **扩展盒子**：所有 provider 钩子都经 `extensionRunnerRef.current`，注入了 runner 才生效——"钩子没被调用"常因 runner 未装/未绑（第 13 章）。

### 15.3 阅读检查清单

- [ ] 我能画出"四步模型降级"与"四级思考级别降级"的链条吗？
- [ ] 我知道 `hasThinkingEntry` 的三处用途吗？（恢复、追加元数据、会话侧判断）
- [ ] 我能解释 streamFn 里"预热条件"比较的两个 sessionId 各来自哪里吗？
- [ ] 我知道 `2035 天`（2147483647）的转换点吗？
- [ ] 我能说出 `cacheContextIsCurrent` 为什么用引用相等而不是深比较吗？
- [ ] 我能分清 `_runAgentPrompt` 两处 `agent.continue()` 的不同触发源吗？

---

> D5 完。下一篇（D6）精读 `main.ts` 的启动与装配选段：参数解析、运行时工厂、模式分发。