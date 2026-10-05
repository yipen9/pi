# D26：`SettingsManager` 的配置状态与写入生命周期

> 精读对象：`packages/coding-agent/src/core/settings-manager.ts` 中的 `deepMergeSettings`、`FileSettingsStorage`、`InMemorySettingsStorage`、`SettingsManager`。
>
> D25 追踪的是配置如何变成资源路径并被加载；本文向上游追一层：设置值如何进入内存、项目不信任时如何被隔离、setter 怎样排队写回，以及 reload 为什么不一定等于“丢弃旧状态再读文件”。
>
> 基线：`200387122ca450d6387f033949423114a270b96c`。本文按源码和既有测试作静态核对；未运行设置测试。

## D26.1 先画出五份状态

`SettingsManager` 里至少要分清这几类数据：

```text
SettingsStorage     持久化后端（文件 / 内存）
globalSettings      已解析的用户级设置
projectSettings     已解析的项目级设置（未信任时为空对象）
settings            合并后的当前有效设置
modifiedFields      当前会话里明确改过、需要保存的字段集合
```

构造函数建立前四者的关系：

```text
globalSettings + projectSettings
             │
             └─ deepMergeSettings(global, project)
                    ↓
                 settings
```

`settings` 是读 getter 时通常看到的快照；两个来源对象则保留来源边界，供指定作用域 setter 和写盘逻辑使用。把它们都叫“配置”会让问题难定位：文件里有值，不代表当前 `settings` 一定已经读到；当前有效值存在，也不代表它已写回文件。

## D26.2 TypeScript 类型与运行时 JSON

`Settings` 是 TypeScript 类型，帮助源码调用者理解字段；`settings.json` 则是运行时文本，来自用户编辑，不能因为类型声明就假设内容有效。加载过程大致是：

```text
storage.withLock(scope, read)
  → 空内容映射成 {}
  → stripBom(text)
  → JSON.parse(text)
  → migrateSettings(parsedObject)
  → 交给 SettingsManager
```

这条路径里有两个容易混淆的概念：

- **JSON 语法正确**：`JSON.parse` 能把文本转成 JavaScript 值；
- **设置值语义正确**：例如 `transport` 是否是支持的选项，要由具体 getter/使用点进一步处理。

当前 `migrateSettings` 明确做格式迁移，例如 `queueMode → steeringMode`、旧 `websockets` 布尔值转成 `transport`、旧 `retry.maxDelayMs` 移到 `retry.provider.maxRetryDelayMs`。迁移是在内存对象上进行；只有后续 setter/save 将字段写回时，才会把迁移后的内容持久化。

若 `JSON.parse` 或迁移抛错，`tryLoadFromStorage` 返回空设置和错误对象，而不是让创建 manager 直接崩溃。创建路径会把 `{scope, path, error}` 放进 `errors`；调用方可用 `drainErrors()` 一次取走并清空。**默认值、空配置、读取失败后的空对象是三种不同情况**，诊断存在与否能帮助区分。

## D26.3 全局和项目设置怎样合并

`deepMergeObjects(base, overrides)` 递归处理双方都是普通对象的字段；其他值直接由右侧覆盖。数组不属于可递归合并对象，因此通常由项目数组整体替换全局数组。

```text
global.retry.provider = { timeoutMs: 30000, maxRetryDelayMs: 45000 }
project.retry.provider = { maxRetries: 2 }

merged.retry.provider = {
  timeoutMs: 30000,
  maxRetryDelayMs: 45000,
  maxRetries: 2
}
```

但不要把“数组整体替换”套用到所有字段：`defaultTools` 有单独规则。`mergeDefaultTools` 判断覆盖列表是否全由 `+name` / `-name` 组成；如果是，就把操作追加到继承列表；如果含普通名称，就把它当作新的工具选择列表。

随后 `resolveDefaultTools` 从普通名称或内置默认工具集合开始，按列表顺序应用加减操作：

```text
起始内置值：read, bash, edit, write
项目覆盖：-write, +grep
结果：read, bash, edit, grep
```

特殊边界要按它所在的层理解：最终有效列表为空时表示明确禁用所有默认内置工具；字段不存在表示“没有覆盖意见”。但当前 `mergeDefaultTools` 把项目层 `[]` 当成“全是 modifier 的列表”（空数组的 `every(...)` 为真），所以当全局层已有列表时，项目空数组追加零个操作，结果仍继承全局列表。例子：全局 `['read', 'bash']` + 项目 `[]` 得到 `['read', 'bash']`；单独的 `defaultTools: []`（例如仅全局配置）得到空选择。不要只凭配置文件的空数组外观推断合并结果，要看它覆盖哪一层。测试 `settings-manager.test.ts` 的 `defaultTools` 组覆盖空有效列表、全局替换、项目增量和默认集合，但没有把“项目空数组 + 非空全局列表”单独列成用例；上面这个组合由当前实现的条件推导。

还有一条重要分流：资源数组 `extensions`、`skills`、`prompts`、`themes` 最终不是简单读取合并后数组。`PackageManager.resolve()` 分别读取 global/project settings，并结合包资源与自动发现。也就是说，`SettingsManager` 的对象合并规则不能单独说明资源最终顺序；完整路径见 [D25](D25-resource-loader-reload.md)。

## D26.4 三种构造方式代表不同边界

| 创建方法 | 后端 | 路径/用途 |
|---|---|---|
| `SettingsManager.create(cwd, agentDir, options)` | `FileSettingsStorage` | 正常应用设置；错误诊断能附文件路径 |
| `SettingsManager.fromStorage(storage, options)` | 调用者提供 | 可替换后端；常用于测试或集成 |
| `SettingsManager.inMemory(settings, options)` | `InMemorySettingsStorage` | 无文件 I/O；把初始对象迁移后序列化进内存后端再构造 |

`InMemorySettingsStorage` 不是“manager 只在 RAM 里保存一次”。它仍有一个遵循 `SettingsStorage` 接口的存储值，所以 `reload()` 可以重新从这个内存后端读取。这个细节解释了回归 #3616：若 `inMemory()` 只把字段放在 manager 属性里、没有放进 backend，reload 就会把初始设置读成空对象。

## D26.5 项目不信任时的读写状态

构造 manager 时，`options.projectTrusted` 默认 `true`。若为 `false`，`loadFromStorage` 对 project scope 直接返回 `{}`，不读取 `.pi/settings.json`；全局设置仍然照常加载。有效状态因此是：

```text
trusted=false:
  globalSettings = read(global)
  projectSettings = {}
  settings = merge(globalSettings, {})
```

`setProjectTrusted(false)` 会将当前项目对象清空、清除项目修改记账，并重新计算有效设置。改为 `true` 时会重新从 project storage 加载，然后再合并。这个 setter 是同步状态切换；调用者不应以为它会触发资源 loader 也完成 reload。资源的最终重解析仍由 `DefaultResourceLoader.reload()` 负责。

写入方向有对称守卫：`updateProjectSettings` 和 `saveProjectSettings` 会同步调用 `assertProjectTrustedForWrite`；排队任务执行时还会再次检查，避免状态在 setter 与异步队列执行之间改变后仍写入项目配置。项目未信任时，尝试写项目设置会抛出明确错误，磁盘文件应保持原样。

现有 `settings-manager.test.ts` 的 `project trust` 组检查：未信任时项目覆盖不生效、变为信任后重新加载项目设置、未信任写入失败，以及 `defaultProjectTrust` 只能来自全局设置。请把这个边界和 D25 的资源 bootstrap 一起理解：设置 manager 管值的读写门，resource loader 管哪些资源最终被加载。

## D26.6 普通 setter 如何变成文件更新

以 `setTheme("light")` 为例，它并不是直接把当前生效值 JSON.stringify 后覆盖整个文件：

```text
globalSettings.theme = "light"
  → markModified("theme")
  → save()
      ├─ 重算有效 settings
      ├─ structuredClone(globalSettings) 形成快照
      ├─ 复制 modifiedFields / nested-field 记账
      └─ enqueueWrite("global", task)
            → persistScopedSettings()
            → storage.withLock("global", read-modify-write)
```

setter 先同步更新内存，所以紧随其后的 getter 通常立刻看到新值；文件 I/O 在写队列中稍后发生。`flush()` 的职责是 `await this.writeQueue`，也就是等已排入的写任务处理完。它不是“强制写成功”的同义词：`enqueueWrite` 捕获写错误并记入 `errors`，因此调用 `flush()` 后还应按调用场景检查诊断。

写入时，`persistScopedSettings` 会在锁内重新读取文件当前内容，再把**本次明确修改的字段**覆盖上去。这样有两种并发变化时的预期：

```text
Pi 启动时内存：{ theme: "dark", packages: ["old"] }
用户外部编辑：{ theme: "dark", packages: [] }
Pi 只改 theme：setTheme("light")
保存结果：{ theme: "light", packages: [] }
```

如果不是字段级记账，而是把旧的整个 `globalSettings` 快照覆盖到文件，外部刚改的 `packages: []` 会被旧数组改回 `["old"]`。`settings-manager-bug.test.ts` 专门覆盖“外部改数组、应用只改无关字段”这一回归。若 Pi 和用户都改了同一个字段，则本次 manager 显式 setter 的值胜出；`settings-manager.test.ts` 对这条规则也有断言。

嵌套字段还会记录子字段，例如 `compaction.enabled`。落盘时保留磁盘对象中未被修改的兄弟字段，只替换明确改过的 nested key。这避免“切换 compaction.enabled 顺便清掉 modelOverrides”。

## D26.7 异步写队列与错误不是一回事

`writeQueue` 初始为已完成的 `Promise<void>`。每次写操作都接到前一个 promise 后面，因此同一 manager 的写入按排队顺序执行：

```text
writeQueue₀
  → 写 theme
  → 写 modelThinkingLevels
  → 写 defaultTools
```

把它想成单车道队列：同一时间只有前面的任务先走完，后一个才开始。`Promise.then` 链让同步 `SettingsStorage.withLock` 拥有统一的异步调用接口，也让 `flush()` 能等待整条队列。

注意 `.catch(...)` 把失败转换成“记录错误后继续完成的队列 promise”。因此：

- `await flush()` 表示之前的队列已经处理到尾；
- 不表示每个任务都成功；
- 检查 `drainErrors()` 才能看到是否有写入失败；
- manager 不会自动重试任意写错误，避免不明确的重复副作用。

文件 backend 的 `withLock` 负责同一 scope 的锁内读-改-写；global 与 project 是不同 scope。当前内容不存在时，读取不会为了“看一眼”就创建目录；只有回调返回要写入的文本时才创建目录并取锁。这也是测试会分别断言“单纯读取不创建 `.pi`”与“写项目设置创建目录”的原因。

## D26.8 `reload()` 的真实语义

`reload()` 首先等待已排队写操作，再读 global 和 project storage。对每个 scope：

- 读取成功：用新对象替换对应内存状态，并清除该 scope 的 load error；
- 读取失败：保留该 scope 上次成功的对象，记录新的错误；
- 完成后清掉 modified-field 记账，再按当前 `projectTrusted` 重算有效设置。

```text
外部改文件 → manager.reload() → getter 看到新设置
坏 JSON    → manager.reload() → getter 保留上次有效设置 + drainErrors 有错误
```

因此 reload 的错误恢复是“last known good”：坏文件不会把当前运行中设置整体变成空，也不会被当作空文件覆盖掉。测试 `settings-manager.test.ts` 的 reload 组检查外部修改刷新和非法 JSON 保留旧值。

对 `inMemory()`，reload 的来源是内存 storage，所以初始配置应保留；若已排队 setter，reload 会先等它们写入 backend，再把更新后的值读回。回归 #3616 覆盖 manager 单独 reload、ResourceLoader 间接 reload，以及 setter + flush + reload 三条轨迹。

`applyOverrides()` 则只是对当前 `settings` 再做一次内存合并，不改 `globalSettings` 或 `projectSettings`，也不把 override 放入持久化字段账本。调用者应把它视为当前 manager 生命周期内的临时覆盖；之后 `reload()` 从两份存储重建有效值时不会保留这层临时覆盖。CLI 的 `--theme` 示例见 `packages/coding-agent/src/main.ts` 启动装配。

## D26.9 用测试定位常见误读

| 你要确认的行为 | 测试 | 测试如何区分正确与错误实现 |
|---|---|---|
| 嵌套对象保留未覆盖字段 | `regressions/7572-provider-retry-settings-merge.test.ts` | 项目只覆盖 `maxRetries`，断言全局 `timeoutMs`、`maxRetryDelayMs` 还在 |
| 外部数组编辑不被旧内存回写 | `settings-manager-bug.test.ts` | Pi 改 theme 后，断言外部新数组仍保留 |
| 相同字段的内存 setter 有优先权 | `settings-manager.test.ts` 的 preserve externally added settings | 外部与 setter 改同 key，断言 setter 值落盘 |
| 非法文件 reload 保留 last known good | 同文件的 reload 组 | 文件损坏后 getter 仍是旧值，且错误带路径 |
| 不可信项目设置不读/不写 | 同文件的 project trust 组 | 检查有效值、project getter、抛错与磁盘原文 |
| in-memory backend 可 reload | `regressions/3616-settings-inmemory-reload.test.ts` | 检查初始设置和更新 setter 跨 reload 保留 |
| `defaultTools` 的增量语义 | `settings-manager.test.ts` 的 `defaultTools` 组 | 检查列表替换、空列表与 `+/-` 操作 |

测试阅读时分三步：先读 `it(...)` 名称找行为，再读 setup 找状态，再读 assertion 判断什么坏实现会失败。只看测试名字不能证明覆盖了内部原因；要找到能区分预期与错误实现的断言。

## D26.10 故障定位清单

当“改了设置但没生效”时，用下面的检查顺序：

1. 先看 JSON 是否能解析；加载诊断是否在 `drainErrors()` 里；
2. 看值在哪个 scope：`getGlobalSettings()`、`getProjectSettings()`、还是有效值 `getSettings()`；
3. 项目设置是否在 `projectTrusted=false` 时被有意屏蔽；
4. getter 是否给了代码默认值，或在具体使用点做了验证/转换；
5. 数组是直接替换、特殊 `defaultTools` 修饰，还是资源路径由 PackageManager 分层组合；
6. setter 是否写到你预期的 scope，`flush()` 后是否还有写错误；
7. 是不是 CLI/SDK `applyOverrides()` 覆盖了设置；
8. 最后才追最终消费者，例如 `DefaultResourceLoader.reload()` 或 `createAgentSession`。

这个次序从原始文本到最终行为逐层缩小问题，不会把“文件里有值”误当成“下游一定消费了这个值”。

## D26.11 阅读路线与练习

建议按这一顺序实际跳源码：

1. `deepMergeObjects`：指出数组为什么不会递归合并；
2. `mergeDefaultTools`、`resolveDefaultTools`：手算全局 `['read','bash']`、项目 `['-bash','+grep']` 的结果；
3. `fromStorageWithPaths`、`tryLoadFromStorage`：画“成功/坏 JSON/未信任”三条初始化轨迹；
4. `setProjectTrusted`：对照 getter 说明 false → true 时 project settings 何时进入有效值；
5. `setTheme`、`save`、`enqueueWrite`、`persistScopedSettings`：画出同步更新、异步写入、磁盘再读和字段覆盖的时序；
6. `reload`：解释为什么错误时保留旧对象，以及为什么 `applyOverrides` 不属于两个存储层。

练习答案检查：

- 若你的工具列表算出 `read, grep`，必须能说明 `-bash` 是对继承列表操作；
- 若你认为 `flush()` 保证文件写成功，回到 `.catch(recordError)` 并指出错误最终存在哪里；
- 若你认为项目未信任时只是“不显示扩展”，回到 `loadFromStorage` 和 `assertProjectTrustedForWrite`，分别说明读门与写门；
- 若你认为 reload 失败会清空设置，找出 `if (!load.error)` 的条件赋值，并指出失败分支只记录 error。

## D26.12 验证边界

本篇静态核对的主要测试是 `settings-manager.test.ts`、`settings-manager-bug.test.ts`、`settings-manager-compaction.test.ts`、`default-tools-setting.test.ts`、`regressions/7572-provider-retry-settings-merge.test.ts` 与 `regressions/3616-settings-inmemory-reload.test.ts`。本轮没有运行这些测试，也没有宣称读者实验已完成。

若实际修改 `SettingsManager`：优先添加能证明错误实现会失败的测试；修改代码后依仓库要求运行 `npm run check`，修改测试后运行对应测试。若改资源设置到 loader 的连接，还要对照 D25 和 `resource-loader.test.ts`，因为 SettingsManager 合并正确不代表资源最终加载正确。
