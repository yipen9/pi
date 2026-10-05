# D11：模型层精读（`pi-ai` 与 coding-agent 的模型运行时）

> 精读对象：`packages/ai/src/models.ts`（Models 实现）、`packages/ai/src/compat.ts`（统一入口与注册表）、`packages/coding-agent/src/core/model-runtime.ts`（ModelRuntime）、`core/model-resolver.ts`（模型解析）。
> 对应主线：第 5 章（pi-ai 与供应商适配）、第 3.5 节（装配时的模型解析）。
> 读法：两层分开读——**通用层**（ai：任何宿主可用）与**应用层**（coding-agent：认证存储、目录刷新、虚拟模型、别名解析）。

---

# 第一部分：`pi-ai` 的 Models 实现（通用层）

## 0. 三个文件的角色

```text
models.ts   Models 接口的实现（ModelsImpl）：provider 注册表、模型查询、stream 分发、动态刷新事务
compat.ts   统一入口：stream/streamSimple/complete、API 实现注册表、内置 API 列表、faux 注册
providers/* 具体供应商（每个导出一个工厂；数据在 *.models.ts）
```

【陷阱】`models.ts` 的类名是 **`ModelsImpl`**（不是 `Models`）——`Models` 是接口（D1 第 18 节提过它的字段）。`createModels()` 返回 `MutableModels`（带 `setProvider` 等变更方法）。**接口/实现/Mutable 视图三层命名**在仓库里一致出现（对比 `SessionManager` 只有一个类，但接口面与内部方法也是分开的）。

## 1. `ModelsImpl` 的字段与构造器

【源码（节选）】

```typescript
	private refreshControllers = new Map<string, AbortController>();
	private publicationChains = new Map<string, Promise<unknown>>();

	constructor(options?: CreateModelsOptions) {
		this.credentials = options?.credentials ?? new InMemoryCredentialStore();
		this.modelsStore = options?.modelsStore ?? new InMemoryModelsStore();
		this.authContext = options?.authContext ?? defaultAuthContext();
	}
```

【注解（三件注入的依赖）】

1. `credentials`：凭据存储（默认**内存**——通用层不假设文件位置；coding-agent 注入文件版）；
2. `modelsStore`：动态模型目录的持久化存储（刷新结果的落点）；
3. `authContext`：认证交互环境（`ctx.env(...)` 等——第 5.5.1 节 `anthropicApiKeyAuth.resolve` 里用的就是它）。

- 【陷阱】三个默认值全是**内存/无持久**：`pi-ai` 裸用时"重启即忘"——**持久化由宿主决定**（coding-agent 在 `ModelRuntime.create` 里换成文件/存储实现，见第二部分）。这是"库不越权"的又一例。

## 2. `setProvider` 与"刷新覆盖"（`supersedeProviderRefresh`）

【源码（节选）】

```typescript
	setProvider(provider: Provider): void {
		this.supersedeProviderRefresh(provider.id);
		this.providers.set(provider.id, provider);
	}

	deleteProvider(id: string): void {
		this.supersedeProviderRefresh(id);
		this.providers.delete(id);
	}

	clearProviders(): void {
		for (const id of new Set([...this.providers.keys(), ...this.refreshControllers.keys()])) {
			this.supersedeProviderRefresh(id);
		}
		this.providers.clear();
	}

	private supersedeProviderRefresh(providerId: string): number {
		const generation = (this.refreshGenerations.get(providerId) ?? 0) + 1;
		this.refreshGenerations.set(providerId, generation);
		const previous = this.refreshControllers.get(providerId);
		if (previous) {
			this.refreshControllers.delete(providerId);
			previous.abort();
		}
		return generation;
	}
```

【注解（"代际"模式）】

- **每次注册/删除都 +1 代**（`refreshGenerations`）：旧的刷新任务拿到的是旧代际号，**发布时对不上就不再写入**（`beginProviderRefresh`/`publishProviderModels` 会比对）。
- 旧的刷新**控制器被 abort**（如果还在跑）——"替换 provider"意味着"它的在途刷新作废"。
- 【陷阱】**代际 + abort 双重防护**：abort 让旧任务**尽快停**（省资源）；代际号保证即使它"停不下来/已经跑到发布点"也**写不进去**（正确性）。**"取消是尽力而为、代际是硬保证"**——分布式/异步系统里的经典组合（对比第 6 章的"取消信号"与"循环检查点"的双保险）。
- `clearProviders` 的遍历集合是 **providers ∪ refreshControllers**：有些刷新任务的 provider 已被删（控制器还在）——清空时也要把它们作废。**"清理要覆盖所有持有态的集合"**的实例。

## 3. 查询：best-effort 与" линейный find"

【源码（节选）】

```typescript
	getModels(provider?: string): readonly Model<Api>[] {
		if (provider !== undefined) {
			const entry = this.providers.get(provider);
			if (!entry) return [];
			try { return entry.getModels(); } catch { return []; }
		}
		const models: Model<Api>[] = [];
		for (const entry of this.providers.values()) {
			try { models.push(...entry.getModels()); } catch {
				// Best-effort: ill-behaved providers yield no models.
			}
		}
		return models;
	}

	getModel(provider: string, id: string): Model<Api> | undefined {
		return this.getModels(provider).find((model) => model.id === id);
	}
```

【注解】

- **`Provider.getModels()` 的契约是"不许抛"**（第 5.2.3 节的注释："Must not throw; `Models` treats a throwing implementation as having no models"）——这里的 try/catch 是**对契约的兜底执行**（不信任 provider 的守约）。两层防御：契约写在文档里，代码再包一层。
- 跨 provider 聚合遍历时**单个 provider 抛错不影响其他**（局部 catch）。
- 【陷阱】`getModel` **每次都在数组里线性找**（没有按 id 建索引）——当前模型数量（几百）下无碍；**读代码时注意它是 O(模型数) 的**（热路径上别反复调用；仓库里的缓存策略见 `getAvailableSnapshot` 之类的快照 API）。
- `getAllModels`/`getModelsOfType` 同构（`getAllModels?.() ?? getModels()` 的回退——只提供聊天模型的 provider 不必实现 `getAllModels`）。

## 4. `streamSimple`：鉴权解析 + 分发的"懒惰"包装

【源码】

```typescript
	streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): AssistantMessageEventStream {
		const transcript = normalizeContext(context);
		return lazyStream(model, async () => {
			const provider = this.requireChatProvider(model);
			const { requestModel, requestOptions } = await this.applyAuth(model, options);
			return provider.streamSimple(requestModel, transcript, requestOptions as SimpleStreamOptions);
		});
	}
```

【注解（四步）】

1. `normalizeContext`：**同步**折规范（第 5.4 节）——在 `lazyStream` 外调用；如果这一步发生异常，它不会经过 `lazyStream` 的错误流转换，而是从 `streamSimple()` 调用处同步抛出；
2. `lazyStream(model, async () => ...)`：先同步创建并返回外层流，同时**立刻调用** `setup()` 开始异步准备，并不是等消费者第一次读取才开始。`setup` 回调是 async 函数，因此其中同步抛错（例如找不到 provider）会变成 rejected Promise；`lazyStream` 的 `.catch()` 把它转换成 `{ type: "error", reason: "error", error }` 事件，并以同一条 `stopReason: "error"` 消息结束流。异步认证失败也沿同一 catch 路径处理。调用者可立即拿到流对象；`stream.result()` 最终解析为错误消息，而非因 setup 失败而 reject。
3. `requireChatProvider`：查不到 provider 时抛 `ModelsError("provider", ...)`；因为它运行在传给 `lazyStream` 的 async setup 中，外层观察到的是错误流，而不是调用点同步异常。`models-runtime.test.ts` 的 `produces an error stream for unknown providers instead of throwing` 验证此边界；
4. `applyAuth`：解析凭据（可能异步：命令型 key、OAuth 刷新）→ 返回 `{ requestModel, requestOptions }`——**auth 被"应用"到请求选项上**（apiKey/headers/env），provider 拿到的是"已带凭据形状"的选项。

```text
ModelsImpl.streamSimple(model, context)
  ├─ normalizeContext(context)        同步；失败可直接抛出
  └─ lazyStream(model, setup)
       ├─ new 外层 AssistantMessageEventStream
       ├─ 立即执行 setup()            查 provider → await applyAuth → 建 provider stream
       ├─ setup 成功                  forwardStream 转发事件与终态
       └─ setup 失败                  error 事件 + stopReason="error" 终态
```

注意还有一个不同入口：直接调用低层 `packages/ai/src/api/*` 的 provider `streamSimple()`，不经过 `ModelsImpl` 的 `lazyStream` 包装时，缺少 API key 可能同步抛出。`pre-generation-error.test.ts` 明确对多个 provider API 断言此行为；`types.ts` 的 `StreamFunction` 注释也保留了这个接口契约。因而不要把“直接 API 调用”和“经 `Models` 注册表调用”的错误时机合并成一句话。
- `complete`/`completeSimple`：`.result()` 包装（把流汇聚成消息——第 5.4 节）。
- `streamDeferred`：先查 `provider.fetchDeferred` 是否存在，缺则抛 `ModelsError("provider", ...)`——**能力检测前置**（不做无意义的 auth 解析）。
- 【陷阱】三个流式方法的**结构完全同构**（normalize → lazyStream → require → applyAuth → 委托）——将来加新"流种类"时照抄这套骨架即可；**差异只在委托的方法名与能力检查**。

## 5. `createProvider` 与注册表（含 faux）

【源码（节选，第 5.2.4 节已读过主体）】

```typescript
export function createProvider<TApi extends Api = Api>(input: CreateProviderOptions<TApi>): Provider<TApi> {
	const single = input.api && typeof (input.api as ProviderStreams).stream === "function"
		? (input.api as ProviderStreams) : undefined;
	const byApi = single || !input.api ? undefined : (input.api as Partial<Record<string, ProviderStreams>>);
	// ...（images/classifiers 同款处理）
	if (streams.length === 0 && imageImplementations.length === 0 && classifierImplementations.length === 0) {
		throw new Error(`Provider ${input.id}: at least one of "api", "images", or "classifiers" is required.`);
	}
```

【注解】

- **空实现直接拒绝**（构造期响亮失败——"注册一个什么都干不了的 provider"是调用方 bug）。
- `single` vs `byApi` 的判定用 **`typeof ...stream === "function"`**（鸭子类型）：对象要么"就是一个流实现"、要么"是 api→实现的字典"——**类型系统的区分不了这两者时，运行时的形状检查顶上**（`input.api` 的类型是联合，无法单靠类型分流）。【陷阱】读这类"同字段两种形状"的 API 时，优先找**构造期的校验**（这里就是），它把模糊留给实现、把清晰还给调用错误。

【源码（compat 的 faux 注册）】

```typescript
export function registerFauxProvider(options: RegisterFauxProviderOptions = {}): FauxProviderRegistration {
	const core = createFauxCore(options);
	const sourceId = `faux-provider-${Math.random().toString(36).slice(2, 10)}`;
	registerApiProvider({ api: core.api, stream: core.stream, streamSimple: core.streamSimple }, sourceId);
	return {
		api: core.api, models: core.models, getModel: core.getModel, state: core.state,
		setResponses: core.setResponses, appendResponses: core.appendResponses,
		getPendingResponseCount: core.getPendingResponseCount,
		unregister() { unregisterApiProviders(sourceId); },
	};
}
```

【注解】

- **random sourceId**：同一进程可以注册**多个 faux**（不同测试各自注册/注销互不干扰）——`unregisterApiProviders(sourceId)` 只删这个 id 注册的那些 api。
- 返回的注册对象把 core 的**八个方法/字段**透出（`state` 句柄是断言 `callCount` 的关键，第 5.7.2 节）。
- 【陷阱】faux 走 `registerApiProvider`（**api 级**注册），不走 `setProvider`（provider 级）——所以它**不占用 provider id**，而是注册了一批"api 实现"；`resolveApiProvider(model.api)` 按 api 找它（compat 的 fallback 路径，第 5.4 节）。**两种注册粒度**（api vs provider）在这里各有用例：内置供应商用 provider（有目录/认证），测试替身用 api（更轻、可多重注册）。

【源码（内置 API 注册的"不覆盖"策略）】

```typescript
const BUILTIN_APIS: [Api, ProviderStreams][] = [
	["anthropic-messages", anthropicMessagesApi()],
	["openai-completions", openAICompletionsApi()],
	// ...（共 10 个）
];

/**
 * Registers the builtin API implementations into the api-registry without
 * clobbering existing entries: compat may load after a test or extension has
 * already registered an override for a builtin api id.
 */
export function registerBuiltInApiProviders(): void {
	for (const [api, streams] of BUILTIN_APIS) {
		if (!getApiProvider(api)) {
			registerApiProvider({ api, stream: streams.stream, streamSimple: streams.streamSimple });
		}
		builtinApiProviderInstances.set(api, getApiProvider(api));
	}
}
```

【注解】

- **顺序不敏感**的注册：先注过自定义实现的（测试/扩展），内置就**让位**（`if (!getApiProvider(api))`）。注释给出理由："compat 可能在测试或扩展注册覆盖之后才加载"——**模块加载顺序不该决定行为**，这是"幂等注册"的设计。
- `builtinApiProviderInstances`：记下每个 api 最终生效的实现（可能是覆盖版）——供 `resetApiProviders` 等操作使用。
- 【陷阱】`BUILTIN_APIS` 在**模块顶层就 `xxxApi()` 创建**（10 个实现对象）——这些是轻量工厂产物（真正的 SDK import 在 `.lazy.ts` 里按需加载，第 5.5.2 节）；**"顶层对象 ≠ 顶层重依赖"**，阅读时别把它们当重型初始化。

---

> D11 第一部分到此。第二部分：coding-agent 侧——`ModelRuntime.create` 的六件装配、provider 组合（builtins/native/config/extension/virtual）、虚拟模型路由（凭据隔离与 maxTokens 钳制）、认证快照（`hasConfiguredAuth`/`checkAuth`/`getAvailable`）、`model-resolver` 的两条解析链（`parseModelPattern` 与 `findInitialModel`/`restoreModelFromSession`）与总结。
---

# 第二部分：coding-agent 的模型运行时（应用层）

## 6. `ModelRuntime.create`：六件装配

【源码】

```typescript
	static async create(options: CreateModelRuntimeOptions = {}): Promise<ModelRuntime> {
		const credentials = new RuntimeCredentials(options.credentials ?? DefaultAuthStorage.create(options.authPath));
		const modelsPath =
			options.modelsPath === null ? undefined : (options.modelsPath ?? join(getAgentDir(), "models.json"));
		const config = await ModelConfig.load(modelsPath);
		const modelsStore =
			options.modelsStore ??
			(modelsPath
				? new FileModelsStore(options.modelsStorePath ?? join(dirname(modelsPath), "models-store.json"))
				: new InMemoryCodingAgentModelsStore());
		const builtinModelDataGeneratedAt = builtinProviderCatalog.getBuiltinModelDataGeneratedAt();
		const providers = builtinProviderCatalog
			.builtinProviders()
			.map((provider) =>
				provider.id === "radius"
					? provider
					: withRemoteCatalog(provider, options.catalogBaseUrl, builtinModelDataGeneratedAt),
			);
		const runtime = new ModelRuntime(
			credentials,
			config,
			modelsPath,
			modelsStore,
			providers,
			process.env.PI_OFFLINE === undefined,
		);
		runtime.configureRadiusProviders();
		runtime.rebuildProviders();
		const refreshFromNetwork = runtime.modelNetworkEnabled && options.allowModelNetwork === true;
		// ...（超时控制器与 signal 组合）
		try {
			if (options.refreshOnCreate !== false) {
				await runtime.refresh({ allowNetwork: refreshFromNetwork, signal });
			}
		} finally {
			if (timeout) clearTimeout(timeout);
		}
		return runtime;
	}
```

【注解（六件）】

1. **凭据**：`RuntimeCredentials`（包装）`DefaultAuthStorage.create(options.authPath)`——`authPath` 缺省时由 `DefaultAuthStorage` 自己找默认位置（**又一个"默认知识留在实现里"**：调用方只在需要覆盖时传路径）。
2. **配置目录文件**：`modelsPath` 三态——**`null` 显式禁用**（不加载 models.json，用于"纯内置"场景，如 SDK 全控制示例）；缺省 `~/.pi/agent/models.json`；`ModelConfig.load(modelsPath)` 读它（第 11.2 节的目录）。
3. **动态目录存储**：有 modelsPath → `FileModelsStore(models-store.json)`（**刷新结果持久化到同目录**——第 5.6.2 节的 `stored`）；没有 → 内存版。注意 `modelsStorePath` 可单独覆盖（文件与配置可以分家）。
4. **内置 provider 工厂**：`builtinProviderCatalog.builtinProviders()` 拿到全部内置 provider 对象；**除 radius 外**都包一层 `withRemoteCatalog(provider, catalogBaseUrl, generatedAt)`——远程目录覆盖（pi.dev 的模型目录，含时间血缘 `generatedAt`；第 5.6.2 节的"静态 + 远程"）。radius 的目录天生动态（自带 gateway 拉取），不需要包。
5. **构造 + 两个初始化动作**：`configureRadiusProviders()`（按 settings 里的 `oauth: "radius"` 配置**自定义 gateway** 的 radius provider——第 5.6.2 节 Radius 段）与 `rebuildProviders()`（把内置 + 配置 + 扩展 + 虚拟模型**组合进内部 Models**）。
6. **创建后刷新**：`refreshFromNetwork = modelNetworkEnabled && allowModelNetwork === true`——**默认不联网**（`allowModelNetwork` 默认 false；`refreshOnCreate !== false` 时才跑一次 `refresh({ allowNetwork })`）；超时如上（`AbortController` + `AbortSignal.any` 组合调用方 signal；`finally` 清定时器）。【陷阱】离线判定在构造时为 `process.env.PI_OFFLINE === undefined`（存在即离线）——**离线是"创建时快照"**，中途改环境变量不影响本实例。
- 【陷阱】`options.modelsPath === null ? undefined : ...` 的三态（null=禁用、undefined=默认、字符串=指定）与 `authPath` 的"缺省即内置"不同——**同一函数里两种"默认策略"**：modelsPath 有"显式禁用"需求（null），authPath 没有。读参数默认时逐个确认。

## 7. provider 的组合：五路来源

【源码（节选）】

```typescript
	private providerIds(): Set<string> {
		return new Set([
			...this.builtins.keys(),
			...this.nativeExtensionProviders.keys(),
			...this.config.getProviderIds(),
			...this.extensionProviders.keys(),
			...this.virtualModels.keys(),
		]);
	}

	/** Returns the provider without virtual models, or undefined when only virtual models define it. */
	private recomposeProvider(providerId: string): Provider | undefined {
		const provider = this.composeProvider(providerId);
		const virtualModels = [...(this.virtualModels.get(providerId)?.values() ?? [])].map((entry) => entry.model);
		if (virtualModels.length > 0) this.models.setProvider(withVirtualModels(providerId, provider, virtualModels));
		else if (provider) this.models.setProvider(provider);
		else this.models.deleteProvider(providerId);
		return provider;
	}
```

【注解（五路来源）】

| 来源 | 内容 | 注册方式 |
|---|---|---|
| `builtins` | 内置目录（`builtinProviders()` + radius 定制） | 构造时装入 |
| `nativeExtensionProviders` | 扩展注册的**原生 Provider 对象**（`registerNativeProvider`） | 运行时 |
| `config` | `models.json` 里声明的兼容端点（第 11.2 节） | `ModelConfig` |
| `extensionProviders` | 扩展注册的**配置对象**（`pi.registerProvider`，第 13.2 节） | 运行时 |
| `virtualModels` | 虚拟模型（按请求路由，第 5 章） | 运行时 |

- `recomposeProvider`：**组合逻辑**——先 `composeProvider`（基础 provider：内置/配置/扩展谁定义了算谁的），再决定向 `this.models`（内部的 `Models` 实例）**注册什么**：
  - 有虚拟模型 → 包一层 `withVirtualModels`（**虚拟模型挂在哪个 provider id 上由注册者声明**——同 id 的物理 provider 与虚拟模型共存，路由在 `streamSimple` 里发生）；
  - 只有基础 → 直接注册；
  - 都没有 → `deleteProvider`（**声明退出**——组合结果为空时同步删除，避免残留旧 provider）。
- 【陷阱】"**重建组合**"（recompose/rebuild）是 ModelRuntime 的核心不变式：任何来源变化（扩展注册、配置重载、radius 配置）后都要走一遍——**"派生状态不手改、只重算"**（跟第 4 章的"系统提示重放"是同一种思想：**权威输入 → 重算派生**）。
- 【跳转】`composeProvider` 的具体合并顺序（内置 vs 配置 vs 扩展的覆盖规则）——读它时关注"谁的字段赢"（local provider 覆盖的粒度：整个模型列表替换还是逐字段？`registerProvider` 的文档注释给了语义：`models` 提供=替换全部；只给 `baseUrl`=只改 URL，第 13.2 节）。

## 8. 虚拟模型路由：凭据隔离与预算钳制

【源码】

```typescript
	streamSimple(model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions): AssistantMessageEventStream {
		const transcript = normalizeContext(context);
		if (isVirtualModel(model)) {
			// Requests outside the agent loop are routed here. Callers sized them before routing, so
			// cap the output budget to the routed model.
			return lazyStream(model, async () => {
				const route = await this.resolveModel(model, transcript.messages, {
					reason: "direct",
					thinkingLevel: options?.reasoning ?? "off",
					signal: options?.signal,
				});
				const { maxTokens: limit } = route.model;
				const maxTokens = options?.maxTokens && limit > 0 ? Math.min(options.maxTokens, limit) : options?.maxTokens;
				const reasoning = route.thinkingLevel === "off" ? undefined : route.thinkingLevel;
				// Caller credentials were resolved for the virtual model's provider. Another provider
				// resolves its own, so they are not sent to the wrong vendor.
				const { apiKey, headers, env, ...rest } = options ?? {};
				const auth = route.model.provider === model.provider ? { apiKey, headers, env } : {};
				return this.streamSimple(route.model, context, { ...rest, ...auth, maxTokens, reasoning });
			});
		}
		return lazyStream(model, async () => {
			assertChatModel(model);
			const prepared = await this.prepareRequest(model, options);
			return prepared.provider.streamSimple(prepared.model, transcript, prepared.options as SimpleStreamOptions);
		});
	}
```

【注解（虚拟模型分支的四个决策）】

1. **只在"agent 循环之外"的请求到这里**（注释："Requests outside the agent loop are routed here"）——循环内的路由走 `resolveModel` 别的 reason（`_prepare`/钩子路径）；这里是**直接调用者**（SDK/codemode）的兜底。
2. **`maxTokens` 钳制到路由后的模型上限**："callers sized them before routing"——调用方按**虚拟模型**的元数据算了预算，路由到的物理模型可能更小 → 取 `min`（`limit > 0` 才钳——0 表示未知，不钳）。
3. **`reasoning` 归一**：路由出的 `"off"` → `undefined`（第 D1/D2 节的"两套词汇表"第三次出现——到这里你应该已经条件反射）。
4. **凭据隔离**（最精妙的一行）：

```typescript
				const { apiKey, headers, env, ...rest } = options ?? {};
				const auth = route.model.provider === model.provider ? { apiKey, headers, env } : {};
```

   - 调用方传的 `apiKey`/`headers`/`env` 是**为虚拟模型所属 provider 解析的**；
   - 如果路由到了**别的 provider**，这些凭据**不带过去**（`auth = {}`）——新 provider 会走自己的 `prepareRequest`/auth 解析；
   - 同一 provider 时保留（减少重复解析）。
   - 【陷阱】**"凭据不见得是给谁用的"**——多 provider 系统里，凭据与"它属于哪家"必须绑在一起流转；这一行是"凭据泄漏到错误供应商"防御的实现点。**读任何"转发请求"的代码，都要问"转发时哪些凭据/上下文被带过去了、该不该带"**。
5. 递归调用 `this.streamSimple(route.model, context, ...)`——**用物理模型再走一遍**（不是递归死循环：物理模型不是虚拟模型，走 else 分支）。
- else 分支：`assertChatModel`（**能力断言**：图片/分类模型不能从聊天入口调用）+ `prepareRequest`（"准备请求"——auth/路由变换的汇点）+ 委托 `prepared.provider.streamSimple`。**通用层（第一部分）与这里的结构同构**，多了一步"prepareRequest"（应用的请求变换：headers/attribution/配置的头——第 3.5 节的 `buildRequestOptions` 在另一个维度）。

## 9. 认证状态：快照、可用性与错误

【源码（节选）】

```typescript
	hasConfiguredAuth(providerId: string): boolean {
		return this.snapshot.configuredProviders.has(providerId);
	}

	async getAvailable(providerId?: string, options?: AuthOperationOptions): Promise<readonly Model<Api>[]> {
		if (providerId) {
			const errorSeq = ++this.availabilityErrorSeq;
			try {
				const available = await this.models.getAvailable(providerId, options);
				if (errorSeq === this.availabilityErrorSeq) this.availabilityError = undefined;
				return available;
			} catch (error) {
				if (errorSeq === this.availabilityErrorSeq && !options?.signal?.aborted) {
					this.availabilityError = error instanceof Error ? error.message : String(error);
				}
				throw error;
			}
		}
		await this.queueAvailabilityRefresh(options?.signal);
		return this.snapshot.available;
	}
```

【注解】

- **`hasConfiguredAuth` 是同步的快照查询**（`snapshot.configuredProviders`）——不访问网络/不跑命令，所以装配期（第 3.5 节）可以频繁调用。**"配置了认证" ≠ "认证有效"**（第 5.6 节的阶段分离）——快照由刷新任务异步更新。
- `getAvailable(provider)`：**带序号的错误清理**（`availabilityErrorSeq`）——并发调用的旧结果不覆盖新状态（"代际"模式在小尺度上的复刻）；取消（aborted）不记错误（**取消不是故障**——第 6 章的语义一致）。
- `getAvailable()`（无参）：`queueAvailabilityRefresh` + 返回 `snapshot.available`（**快照读**——不阻塞等刷新；"可用性"的最终一致）。
- `isUsingOAuth`/`isUsingSubscription`：从快照的凭据类型 + provider 的 oauth 元数据判断（登录引导/订阅区分用——第 5.5.1 节）。
- `getAuth(model, overrides)`：在通用层结果上**再合并"已配置的模型头"**（`resolveConfiguredModelHeaders`——models.json 里 per-model headers 的落点）。
- `getError()`：**错误汇总器**（配置错误 + 组合错误 + 可用性刷新错误）——"诊断收集、调用方裁决"模式在模型层的又一实例（第 8.3.2 节的血统）。

## 10. `model-resolver`：两条解析链

### 10.1 `parseModelPattern`：`"provider/model:level"` 的解析

【源码（节选，含递归）】

```typescript
export function parseModelPattern(pattern, availableModels, options?): ParsedModelResult {
	// Try exact match first
	const exactMatch = tryMatchModel(pattern, availableModels);
	if (exactMatch) return { model: exactMatch, thinkingLevel: undefined, warning: undefined };

	// No match - try splitting on last colon if present
	const lastColonIndex = pattern.lastIndexOf(":");
	if (lastColonIndex === -1) return { model: undefined, thinkingLevel: undefined, warning: undefined };

	const prefix = pattern.substring(0, lastColonIndex);
	const suffix = pattern.substring(lastColonIndex + 1);

	if (isValidThinkingLevel(suffix)) {
		const result = parseModelPattern(prefix, availableModels, options);
		if (result.model) {
			return { model: result.model, thinkingLevel: result.warning ? undefined : suffix, warning: result.warning };
		}
		return result;
	} else {
		const allowFallback = options?.allowInvalidThinkingLevelFallback ?? true;
		if (!allowFallback) return { model: undefined, thinkingLevel: undefined, warning: undefined };
		const result = parseModelPattern(prefix, availableModels, options);
		if (result.model) {
			return { model: result.model, thinkingLevel: undefined, warning: `Invalid thinking level "${suffix}" in pattern "${pattern}". Using default instead.` };
		}
		return result;
	}
}
```

【注解】

- **先整串精确匹配**（`tryMatchModel`——含别名/模糊逻辑在它内部），再考虑"最后一段冒号后缀是不是思考级别"。
- 递归结构：每次剥掉**最后一段**后缀再试——**支持模型 id 里本身带冒号**（文档注释点名 OpenRouter 的 `model:exacto`）：`a:b:c` 先试整串、再试 `a:b`（suffix=c）、再试 `a`（suffix=b:c？）——【陷阱】每层只剥一段，所以带冒号的 id 需要"整串精确匹配"命中，否则会一层层剥到失败；**注释里的算法描述可以对照这个递归验证**（"tries to match the full pattern first, then progressively strips colon-suffixes"）。
- **两种模式**（`allowInvalidThinkingLevelFallback`）：
  - **严格模式**（CLI `--model` 解析，false）：无效后缀视为 id 的一部分 → 整体不匹配（**避免悄悄解析成另一个模型**——"宁报错不猜"）；
  - **宽容模式**（scope/设置里，默认 true）：递归前缀 + **warning**（"Invalid thinking level ... Using default instead."）——诊断交给调用方（`resolveModelScopeWithDiagnostics` 收集成 `ModelScopeDiagnostic`）。
- 【陷阱】"有效思考级别时也要看内层 warning"：`thinkingLevel: result.warning ? undefined : suffix`——**内层已经警告（比如前缀是模糊匹配）时，不采用本层后缀**（避免"模糊匹配 + 级别"的双重不确定叠加）。**警告传播抑制**的实例。
- 解析结果三件套 `{ model, thinkingLevel, warning }`——第 3 章 `resolveModelScope` 与 CLI 的 `--model` 都消费它。

### 10.2 `findInitialModel`：五步优先级

【源码（分支目录）】

```typescript
	// 1. CLI args take priority
	if (cliProvider && cliModel) { /* resolveCliModel；error → 打印并 exit(1)；成功直接返回 */ }

	// 2. Use first model from scoped models (skip if continuing/resuming)
	if (scopedModels.length > 0 && !isContinuing) { /* scoped[0] + 每模型级别 ?? 默认 */ }

	// 3. Try saved default from settings if auth is configured.
	if (defaultProvider && defaultModelId) { /* getModel + hasConfiguredAuth 才用 */ }

	// 4. Try first available model with valid API key
	const availableModels = [...modelRuntime.getAvailableSnapshot()];
	if (availableModels.length > 0) {
		for (const provider of Object.keys(defaultModelPerProvider)) {
			const match = availableModels.find((m) => m.provider === provider && m.id === defaultModelPerProvider[provider]);
			if (match) return { model: match, ... };
		}
		return { model: availableModels[0], ... };
	}

	// 5. No model found
	return { model: undefined, ... };
```

【注解（五步各自的"为什么"）】

1. **CLI 显式参数最高**：`cliProvider && cliModel` 都给才走；解析失败**直接 `exit(1)`**（【陷阱】这个函数在"装配核心"里却会退出进程——它是**CLI 专用路径**，SDK 调用时不传这两个参数；读函数的副作用时先看调用方）。
2. **作用域的第一个**（`--models`/`enabledModels` 解析出的列表）：**`!isContinuing` 才用**——恢复会话时优先让"会话记录"决定（第 3.5 节的顺序）；这里体现了"作用域只是启动偏好，历史选择优先"。
3. **设置里的默认**：**双重条件**（模型存在 + 有认证）——否则跳过（与第 3.5 节恢复逻辑同款校验）。
4. **可用快照**：先按 `defaultModelPerProvider` 表找"已知好模型"（每个 provider 一个人气默认），找不到用**第一个可用**；【陷阱】这一步**没有任何认证二次校验**（快照本身已经过滤过可用性——`getAvailableSnapshot` 的语义）。
5. 全空 → `model: undefined`（调用方据此发 `formatNoModelsAvailableMessage`——第 3.5 节）。

【陷阱】五步的**返回对象形状不同**：第 1、4（首分支）、5 步返回 `thinkingLevel: DEFAULT_THINKING_LEVEL`；第 2 步返回"scoped/每模型/默认"三级计算；第 3 步返回"每模型/默认"两级。**同一函数的返回里级别来源不一致**——消费方（`createAgentSession`）在更外层还有自己的恢复链（D5 第 4 节），两级链条叠加时要按实际传参追（`scopedModels` 在 SDK 装配里传空数组——D5 已经点过）。

### 10.3 `restoreModelFromSession`：恢复的完整决策

【源码（节选）】

```typescript
export async function restoreModelFromSession(savedProvider, savedModelId, currentModel, shouldPrintMessages, modelRuntime) {
	const restoredModel = modelRuntime.getModel(savedProvider, savedModelId);
	const hasConfiguredAuth = restoredModel ? modelRuntime.hasConfiguredAuth(restoredModel.provider) : false;

	if (restoredModel && hasConfiguredAuth) {
		if (shouldPrintMessages) console.log(chalk.dim(`Restored model: ${savedProvider}/${savedModelId}`));
		return { model: restoredModel, fallbackMessage: undefined };
	}

	const reason = !restoredModel ? "model no longer exists" : "no auth configured";
	if (shouldPrintMessages) console.error(chalk.yellow(`Warning: Could not restore model ${savedProvider}/${savedModelId} (${reason}).`));

	if (currentModel) { /* 用当前模型兜底 + fallbackMessage */ }
	const availableModels = [...modelRuntime.getAvailableSnapshot()];
	if (availableModels.length > 0) { /* 先找 defaultModelPerProvider 的匹配，再取第一个 */ }
	// ...（都失败：返回 undefined + 不适用消息）
}
```

【注解】

- **恢复三态原因**：模型不存在 / 无认证 / 成功——原因字符串进警告与 `fallbackMessage`（用户能看到"为什么换了模型"）。
- 两条兜底顺序：**当前模型**（调用方已经有一个在用的）→ **可用快照的人气默认** → 空。
- 【陷阱】`shouldPrintMessages` 参数：**同一函数既能"打日志"也能"静默返回消息"**——SDK/RPC 场景传 false（自己渲染 `fallbackMessage`），CLI 传 true（直接打印）。**"输出"与"判断"分离**的又一种做法（对比诊断模式）。
- 【陷阱】它与 `findInitialModel` 的重叠：两者都会"从可用快照里挑默认"。差异在**入口条件**（findInitialModel 管"没有恢复值的启动"；restore 管"有恢复值但不可用"）与**输出形态**（`InitialModelResult` vs `{model, fallbackMessage}`）。**改"默认选择"逻辑时两处都要看**——这是潜在的重复源（好读法：grep `defaultModelPerProvider` 找到所有使用点，仓库马上告诉你全部三处）。

## 11. 总结

### 11.1 优先级链总表（背这张表，排障时省半小时）

| 场景 | 优先级（从高到低） |
|---|---|
| 模型选择（启动） | CLI `--provider/--model` → 作用域首个（非恢复时）→ 设置默认（有认证）→ 可用快照的人气默认 → 首个可用 → 无 |
| 模型恢复（有历史） | 会话记录值（有认证）→ 当前模型 → 可用快照默认 → 无 |
| 模式（pattern）解析 | 整串精确 → 从右到左逐段剥冒号（有效级别才采用）→ 严格模式失败 / 宽容模式警告+前缀结果 |
| 流式分发（通用层） | 内置 provider（按 model.provider）→ api 注册表（resolveApiProvider(model.api)） |
| 流式分发（应用层） | 虚拟模型 → `resolveModel` 路由（凭据按 provider 隔离、maxTokens 钳制）→ 物理模型 `prepareRequest` → provider |
| 认证来源（Anthropic 例） | 已存凭据 → AUTH_TOKEN(Bearer) → OAUTH_TOKEN/API_KEY → 联合身份（第 5.5.1 节） |

### 11.2 阅读检查清单

- [ ] 我能说出 `ModelsImpl` 三种注入依赖的"默认全内存"策略吗？
- [ ] 我能解释"代际 + abort"双重防护各防什么吗？
- [ ] 我知道 `lazyStream` 把准备工作推迟的原因与代价吗？
- [ ] 我能复述虚拟模型路由的四个决策（尤其是凭据隔离那三行）吗？
- [ ] 我能画出 `findInitialModel` 的五步吗？第 2 步为什么有 `!isContinuing`？
- [ ] 我能说出 `parseModelPattern` 两种模式在"怕什么"上的差别吗？

---

> D11 完。精读篇（D1-D11）覆盖：循环、Agent、会话（投影/本体）、提示与压缩（读/写）、SDK、CLI、工具、扩展、模型层。
