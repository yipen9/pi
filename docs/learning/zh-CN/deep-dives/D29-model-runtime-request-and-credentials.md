# D29：ModelRuntime 的请求准备与凭据同步

> 本篇接着 D11，追踪 coding-agent 应用层的两条路径：一次模型请求如何得到最终认证参数；一次凭据变更如何更新模型目录与可用性快照。
>
> 验证状态：静态核对 `model-runtime.ts`、`runtime-credentials.ts` 与列出的测试源码；未运行测试。

## 1. 两个时序问题

`ModelRuntime` 不只是把模型交给 `pi-ai`。它还要把应用配置、凭据存储、每请求覆盖值和扩展提供的转换组合起来。凭据变更也不止是写存储：调用方通常紧接着要读 `hasConfiguredAuth()` 或 `getAvailableSnapshot()`，因此返回前需要尽量完成本地状态同步。

```text
请求：模型 + 调用选项 → auth resolve → 头/环境合并 → provider
凭据：同 provider 排队 → 写凭据 → 重组 provider → 本地刷新 → 发布 auth/available 快照
```

## 2. 请求准备：`prepareRequest`

`stream`、非虚拟模型的 `streamSimple`、deferred 请求、图片生成与分类最终都经过 `prepareRequest`。它是 coding-agent 层的请求准备汇点。

```typescript
const provider = this.models.getProvider(model.provider);
if (!provider) throw new ModelsError("provider", `Unknown provider: ${model.provider}`);
const resolution = await this.getAuth(model, {
  apiKey: options?.apiKey,
  env: options?.env,
  signal: options?.signal,
});
if (!resolution) throw new ModelsError("auth", `Provider is not configured: ${model.provider}`);

const { transformHeaders, ...rawProviderOptions } = options ?? {};
const providerOptions = rawProviderOptions as ProviderRequestOptions<TModel>;
let headers = mergeHeaders(resolution.auth.headers, providerOptions.headers);
if (transformHeaders) headers = await transformHeaders(headers ?? {});
const env = resolution.env || providerOptions.env
  ? { ...(resolution.env ?? {}), ...(providerOptions.env ?? {}) }
  : undefined;
const requestModel = resolution.auth.baseUrl ? { ...model, baseUrl: resolution.auth.baseUrl } : model;
```

执行顺序很关键：

1. **先查 provider**。未知 provider 直接给 `ModelsError("provider")`，不做认证解析。
2. **再解析认证**。`getAuth(model, overrides)` 让 `pi-ai` 按 provider 的认证实现解析凭据；`apiKey`、`env` 和 `signal` 是这次请求的覆盖输入。没有解析结果时抛认证错误。
3. **合并 headers**。认证生成的头是底值，请求显式传入的头覆盖同名项；名称按大小写不敏感替换，因此 `authorization` 可以覆盖 `Authorization`。
4. **最后执行 `transformHeaders`**。转换器看到的是前两层合并后的完整头。它不会继续传给 provider，避免把宿主回调暴露成供应商选项。
5. **合并 env 并生成请求模型**。provider auth 的 env 在前、请求 env 在后；若认证解析返回专用 `baseUrl`，只克隆本次请求模型并覆盖 URL，不改目录中的模型对象。

一个具体例子：provider auth 生成 `Authorization: Bearer generated` 和 `x-provider: p`，模型配置再带 `x-model: m`，调用方给 `authorization: Explicit` 与 `x-call: c`。大小写不敏感合并会保留显式 Authorization，并把其他头一起交给 transform；provider 收到的是 transform 的返回值，而不是 transform 函数本身。

## 3. 虚拟模型与认证归属

虚拟模型的直接 `streamSimple` 会先调用 `resolveModel`，再递归调用物理模型的 `streamSimple`。D11 已解释路由校验与 `maxTokens` 限制；这里补充认证归属：调用者传来的 `apiKey`、`headers`、`env` 是针对虚拟模型 provider 解析的。目标仍属于同一个 provider 时可复用；跨 provider 时这些字段被剥离，让目标 provider 自己解析认证。

```text
virtual/A + caller auth(A) → route physical/A → 保留 auth(A)
virtual/A + caller auth(A) → route physical/B → 丢弃 auth(A)，改解析 auth(B)
```

这条边界避免把某供应商的密钥或认证头发送给另一供应商。模型调用的完整路径是：虚拟路由（若有）→ 物理模型认证准备 → provider stream。

## 4. 凭据是覆盖层，不是第二份持久存储

`RuntimeCredentials` 包装传入的 `CredentialStore`，只在内存里保存 runtime API key 覆盖：

- `read(provider)`：有 runtime 覆盖时返回 API key credential，否则委托持久 store。
- `list()`：先读取持久凭据，再按 provider 用 runtime 覆盖替换列表项。
- `modify()`：直接委托持久 store；运行时覆盖不参与持久修改器。
- `delete(provider)`：先等待持久删除成功，再移除 runtime 覆盖。

因此 `setRuntimeApiKey` 的密钥不会因 runtime 覆盖本身写入磁盘；而 logout/delete 需要处理持久值与内存覆盖两处。读取和列举的结果视角不同于只看底层 store，这也是认证状态快照需要分别保留 `configuredProviders` 与 `storedProviders` 的原因。

## 5. 凭据操作队列与提交边界

`login`、`logout`、`setRuntimeApiKey`、`removeRuntimeApiKey` 都经 `enqueueCredentialOperation(providerId, ...)`。队列按 provider 分开：同一家凭据操作按顺序执行，不同 provider 不相互等待。

```text
provider A: login ── synchronize ── set key ── synchronize
provider B: logout ── synchronize              (可与 A 并行)
```

队列的尾 Promise 会吸收错误，只用于让下一项等前一项结束；原始 operation 仍把自己的成功或失败返回给调用者。排队期间取消会让任务在开始前检查 signal 并退出。operation 开始后，凭据写入和同步使用同一 signal；一旦凭据变更已经提交，取消不能假装回滚它。

同步步骤是：

1. 检查取消信号并重新组合该 provider。
2. 对该 provider 执行 `models.refresh({ allowNetwork: false })`，不会因凭据操作触发目录网络请求。
3. 更新全部模型快照，再只刷新这个 provider 的认证检查、已存凭据和可用模型。
4. 让该 provider 的新快照在操作 Promise 成功前可读。

如果第 2 或第 3 步失败，`CredentialSynchronizationError` 会带上 provider、操作类型、credential 和原始 cause。它的消息明确表示**凭据操作已提交，但本地同步失败**。调用方不能把它当作“凭据没写进去”并盲目重试；应检查实际凭据，再重试同步或刷新。

## 6. 快照并发：序号决定谁能发布

全量可用性刷新并行收集可用模型、每个 provider 的 `checkAuth` 和凭据列表。开始时递增 `availabilityRefreshSeq`；完成时只有仍是最新序号的任务才能替换整份快照。provider 单项刷新另有 `providerAvailabilitySeq`，只更新该 provider 的部分，并使更早启动的全量刷新失效。

```text
全量刷新 #4 开始
provider A 凭据变更，A 单项刷新开始并使 #4 失效
#4 较晚完成 → 序号不匹配，不发布
A 单项刷新完成 → 合并 A 的结果到当前快照
```

这与 D11 中 `pi-ai Models` 的 provider refresh generation 是类似防线，但作用层不同：`pi-ai` 防止旧目录刷新发布；`ModelRuntime` 防止旧认证/可用性读取覆盖新快照。Abort 用于尽早停止工作，序号检查负责阻止过期结果写入。

`hasConfiguredAuth()` 和 `getAvailableSnapshot()` 是同步快照读取，不会临时执行 auth check。新 provider 注册时 `markProvisionallyConfigured()` 可按已存凭据或显式配置暂时标记，避免异步刷新完成前启动模型选择看不到它；后续 availability pass 会用真实检查结果替换这个临时判断。

## 7. 静态证据与阅读入口

| 行为 | 实现 | 可对照测试 |
|---|---|---|
| 同 provider 排队、不同 provider 并发、提交后同步失败 | `model-runtime.ts`、`runtime-credentials.ts` | `model-runtime-credential-sync.test.ts` |
| auth/env 覆盖、header 大小写合并与转换器边界 | `prepareRequest`、`getAuth` | `model-runtime-auth-options.test.ts` |
| native provider 注册后的可用性与 overlay | `registerNativeProvider`、`composeProvider` | `model-runtime-modify-models-compat.test.ts` |
| 虚拟路由校验、预算与跨 provider 凭据隔离 | `resolveModel`、`streamSimple` | `virtual-models.test.ts` |

以上是源码与测试断言的静态对照，不表示这些测试已经运行通过。若改动认证顺序，先追 `prepareRequest → getAuth → pi-ai auth resolver → provider`；若改动凭据写入，追 operation 是否已提交，再检查同步失败时快照是否仍旧。

---

> D29 完。与 D11 合读：D11 解释模型层构造、解析和路由；本篇解释 coding-agent 如何为单次请求准备认证，以及认证状态如何随凭据操作更新。
