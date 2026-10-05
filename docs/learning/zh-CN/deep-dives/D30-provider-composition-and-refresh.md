# D30：Provider 组合、模型覆盖与动态刷新

> 本篇继续 D11/D29 的模型层阅读，聚焦 `models.json`、内置/native provider、extension 配置和动态模型刷新如何合成一个最终 provider。目标是修改某一层时，能判断其他层是否会覆盖它。
>
> 验证状态：静态核对 `provider-composer.ts`、`model-config.ts`、`model-runtime.ts` 与列出的测试源码；未运行测试。

## 1. 为什么要分清 provider 的几层

一个 provider 可能同时来自内置目录、`models.json` 和 extension。它们不是简单地把三个对象用 `{ ...a, ...b, ...c }` 拼起来：模型列表有“加一条/替换一条/整表替换”三种语义；认证需要保留 provider 自己的 OAuth/API key 行为；流实现还要按 API 类型决定委托给谁。

```text
native 或 builtin Provider
          │
          ▼
  models.json provider 配置
          │
          ▼
  extension provider 配置
          │
          ▼
OAuth modifyModels（旧式投影）
          │
          ▼
models.json modelOverrides（最后应用）
```

这张图表达模型目录处理次序。最终 `Provider` 的名称、认证、stream 和可选能力也各有自己的合并规则，不能从模型列表顺序直接推断。

## 2. `models.json`：覆盖目录，upsert 自定义模型

`ModelConfig.load(path)` 只负责读、解析、校验并冻结配置。找不到文件按空配置处理；读取、JSON 或 schema 错误记录为可查询的 error，同时返回空 provider map。它不会在加载时半应用一份无效配置。

`applyModelsJson(providerId, baseModels, config)` 的工作分三步：

1. 先从 base provider 的所有模型复制一份。provider `baseUrl` 覆盖每个模型 URL，chat 模型还合并 provider `compat`。
2. 再处理 `config.models`。每个定义都生成一个模型；如果同 ID 已有 chat model 就替换，否则追加。
3. 创建模型时逐字段选值：模型定义优先，其次 provider 配置，最后从已有 chat 模型挑出的默认值。默认值先找同 ID，再找指定 API，再找 `openai-completions`，最后才取首个 chat model。

例如已有目录为 `sonnet`、`haiku`，配置增加 `local-test`，三者都保留；配置重新定义 `sonnet` 则替换同 ID 项。此时 provider 级 `baseUrl` 会成为模型级 URL 的默认值，而模型定义自己的 `baseUrl` 可以覆盖它。

一个易忽略的边界：`modelOverrides` 不在 `applyModelsJson` 的 upsert 循环中应用。它会在整个 provider 组合的最后阶段应用，所以也能改写 extension 新增模型的 chat 元数据。

## 3. Extension `models` 是整表替换

`applyExtension` 的分支直接决定语义：

```typescript
if (!config) return [...models];
if (!config.models) {
  return config.baseUrl ? models.map((model) => ({ ...model, baseUrl: config.baseUrl! })) : [...models];
}
return config.models.map((definition) => extensionModelFromDefinition(providerId, models, config, definition));
```

- 没有 `models`：保留上一步整个模型列表；若给了 `baseUrl`，只克隆并覆盖每个模型的 URL。
- 给了 `models`（包括空数组）：输出列表由 extension 定义生成，不会隐式把其他模型拼回来。
- extension 定义的 API 与 URL 默认值来自：模型自身 → extension provider 配置 → 上一步模型中匹配的默认模型。

因此，“只想调整 endpoint”时不应顺手加一个 `models` 数组，否则列表语义从“覆盖 URL”变成“替换模型清单”。

## 4. 总模型列表：最后覆盖与来源顺序

`composeModelProvider` 内部的 `getAllModels()` 每次按这个顺序重新计算：

1. `base.getAllModels()`（若无则 `getModels()`）。
2. 应用 `models.json` provider 设置与自定义模型。
3. 应用 extension 配置；extension 有 `models` 时在此替换列表。
4. 若 OAuth 凭据已由刷新流程提供，运行 extension 的 `oauth.modifyModels`。该旧式钩子只处理 chat 模型，图片和 classifier 模型原样保留。
5. 对最终 chat 模型应用 `modelOverrides`。

同一个模型字段的具体覆盖粒度要看实现：例如 `name`、`reasoning`、`contextWindow` 是给出值才覆盖；`cost`、sampling params、prompt cache 和 compatibility 对象按字段合并；`inputLimits.images.resize` 还有一层嵌套合并。未提供的字段保持基础值。

例子：base 的 `contextWindow=100000`、extension 新模型设 `50000`、`modelOverrides.local.contextWindow=42000`，最终是 `42000`。但若 extension 声明了 models，它不会保留 base 里的其他模型；最后覆盖只针对实际留在列表中的 chat 模型。

## 5. Provider 本身不是同一个“字段全覆盖表”

`composeModelProvider` 最后创建统一 `Provider` 对象，关键字段规则如下：

| 字段/能力 | 选择规则 |
|---|---|
| `name` | extension → `models.json` → base → extension OAuth name → provider id |
| provider `baseUrl` | extension → `models.json` → base |
| API key / OAuth | 各自单独组合；保留 base auth 的 login/check/resolve 等行为，并注入已配置的 key、headers 或 extension OAuth |
| stream | 同 API 时 extension `streamSimple` 优先；否则若 base 声明支持该 API 就交给 base；其余查 pi-ai API registry |
| deferred response | 只从 base provider 投影 `fetchDeferred` / `cancelDeferred` |
| image / classifier | extension 按 API 的实现优先；没有时才用 base 实现 |

Provider 级 headers 不直接把所有来源拼到 provider 顶层字段；配置 headers 在 auth 解析时注入认证结果，模型级 headers 则在 `resolveConfiguredModelHeaders()` 单独按模型查找。不要只看 `provider.headers` 就判断请求最终会带哪些头；请求实际合并路径见 D29。

认证合成也有值得单独记住的分支：配置 API key 优先使用 extension 的值，否则 `models.json` 的值；若 base 有 API-key auth，就沿用其解析逻辑，并把配置 key 作为 credential 交给它；没有 inherited auth 时才由组合器直接解析 key。OAuth-only provider 不会凭空生成 API key 登录方法。

## 6. 动态刷新：先计算候选，再发布状态

`ModelRuntime.refresh()` 会重新加载 `models.json`、配置 Radius provider，然后按需重组全部 provider 或指定 provider，接着调用 `pi-ai Models.refresh()`。是否联网由调用参数优先决定，否则回退到 runtime 的 `modelNetworkEnabled`。

对于 extension `refreshModels`，组合器先 await 回调拿到候选模型，再检查 signal；仍有效时通过 `context.publish({ update })` 发布。`update` 回调中会先用 `applyModelsJson` 和新模型列表做结构校验，成功后才替换闭包中的 `refreshedExtensionModels`。后续 `getAllModels()` 因而读到新列表。校验抛错时新值不会写入闭包。

`pi-ai Models.refresh` 管 provider 刷新代际与 ModelsStore 发布；ModelRuntime 刷新后再重算本地模型/auth 可用性快照（详见 D29）。extension 的 `refreshModels` 候选本身不会自动持久化进 ModelsStore；测试 `publishes refreshModels results without forcing ModelsStore persistence` 明确覆盖了这一点。目录快照可在运行时更新，但重启后来源仍是配置/extension 重新生成。

## 7. 注册和验证边界

`registerProvider()` 先验证新输入能否独立应用，再合并到已注册 extension 配置：输入中 `undefined` 的字段不会抹掉之前值；有效字段才更新。此处使用的是“重注册字段合并”语义，不同于 provider 的 `models` 列表在组合时整表替换。

`composeModelProvider()` 会立即调用一次 `getAllModels()` 做 eager validation，所以模型定义缺 API、缺 baseUrl 或配置非法时，注册/重载阶段就能发现，而不是等到第一次请求。ModelRuntime 捕获组合错误并回退到 base provider（如果存在），将错误放进 composition diagnostics；单纯失败不意味着旧组合自动完整回滚到任意旧 extension 配置，具体输入 map 是否已更新取决于注册/重载入口，排查时要读调用方写入顺序。

```text
extension 输入验证 → 存入 extensionProviders → recomposeProvider
                                      ├─ compose 成功：注册新组合
                                      └─ compose 失败：记录错误，回退 base
```

若要改变失败时保留旧 extension provider 的行为，需要先明确状态契约并为失败重注册写测试；不能仅凭“回退 base”推断之前有效的 extension 组合会保留。

## 8. 对照源码与测试

| 问题 | 入口 | 静态证据 |
|---|---|---|
| models.json 对 native provider 的覆盖顺序 | `composeModelProvider`、`applyModelsJson` | `model-runtime-modify-models-compat.test.ts` 的 `applies models.json overrides above native providers` |
| 动态模型是否写入 ModelsStore | `composeModelProvider.refreshModels`、`context.publish` | 同文件的 `publishes refreshModels results without forcing ModelsStore persistence` |
| OAuth modifyModels 是否跟随凭据变化 | `extensionOAuthCredential`、`logout` 后刷新 | 同文件的 `applies legacy OAuth modifyModels after async credential initialization` |
| models.json 的 baseUrl 覆盖与自定义模型合并 | `applyModelsJson` | `model-registry.test.ts` 的 `overriding baseUrl keeps all built-in models`、`can mix baseUrl override and models merge`；该文件覆盖兼容 registry 对应行为 |

上表为实现与断言的静态核对，不表示测试已执行。动模型字段时先查合并函数；动模型列表时先确定是 upsert 还是 replacement；动刷新时追 `refreshModels → publish → getAllModels → snapshot` 的完整路径。`ModelConfig` 解析错误的当前专门单测入口本轮未确认，因此该错误路径只按实现静态核对。

---

> D30 完。D11 给模型层地图，D29 讲单次请求认证与快照，D30 讲目录/配置如何组合成可运行 provider。
