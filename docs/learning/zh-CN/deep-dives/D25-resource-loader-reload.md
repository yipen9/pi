# D25：资源解析与 `reload()` 生命周期

> 对照源码：`packages/coding-agent/src/core/resource-loader.ts` 的 `DefaultResourceLoader.reload`、`loadFinalExtensionSet`、`update*FromPaths`；`packages/coding-agent/src/core/package-manager.ts` 的 `resolve`、`resourcePrecedenceRank`、`toResolvedPaths`。
>
> 本篇解释一条常见故障链：配置里明明写了资源，为什么没加载、被别的资源盖过、项目扩展没出现在信任提示里，或者 reload 后行为没变？先分清设置读取、路径解析、信任过滤、具体资源解析和最终公开状态这几个阶段。

## D25.1 先有一张状态图

```text
ResourceLoader.reload(options)
  ├─ 已加载过？清 extension factory cache
  ├─ 要询问项目信任？
  │    ├─ projectTrusted=false；reload settings
  │    ├─ 解析当前可用资源，排除 builtin，加载预信任扩展
  │    └─ callback 决定 projectTrusted
  ├─ 按最终信任状态 reload settings
  ├─ PackageManager.resolve()
  │    ├─ package resources
  │    ├─ 项目/用户显式资源
  │    ├─ 自动发现资源
  │    └─ builtin extensions
  ├─ 合并临时 CLI 资源，记录 PathMetadata，过滤 enabled=false
  ├─ 加载最终扩展集合（复用预加载项、装载剩余项、处理 inline factory）
  ├─ 加载 Skills → Prompts → Themes，并附加来源信息/诊断
  ├─ 加载上下文文件、system prompt、append system prompt
  └─ loaded=true
```

【注解】`reload` 是 `async` 函数。每个 `await` 都表示当前步骤可能等待 I/O 或扩展初始化；后一步只有在前一步完成后才开始。不要把整条流程理解成“读一次 settings.json”。它会协调设置、包管理、扩展运行时以及四类资源状态。

【陷阱】`loaded=true` 在正常流程末尾设置。若中途抛错，不能假定 loader 已完成本轮更新；排查时同时看调用方是否捕获错误、界面是否仍在展示上一次状态。

## D25.2 两种路径解析：预信任与最终加载

如果 `reload` 收到 `resolveProjectTrust`，它先调用 `loadProjectTrustExtensions()`。这个方法显式执行 `setProjectTrusted(false)`，重新载入设置，再调用 `loadCurrentExtensionSet()`。因此项目设置中的资源不会因为项目还没获信任就先执行。

预信任阶段只用来呈现可供决策的扩展集合。`loadCurrentExtensionSet` 把 `builtin:` 路径留到最终阶段，因为项目设置仍可能禁用内置扩展；它也把 inline factory 纳入预信任结果。`resolveProjectTrust` 回调拿到 `extensionsResult` 后返回布尔值，随后 loader 保存决定。

之后 `reload` 再执行 `settingsManager.reload()`，这次保留刚确定的信任状态；然后重新解析完整路径。最终扩展集合中，预信任 pass 已成功加载且最终仍启用的磁盘扩展按 `resolvedPath` 复用，不会初始化第二次。预加载失败的路径也不会在同一轮最终 pass 里盲目重试；错误会进入最终结果。内置扩展这时才加载。

```text
项目不可信时：
  bootstrap: user/global + temporary CLI extensions
  trust callback: 读取这些扩展提供的 project_trust 决策
  final pass: 按决策重新读 settings，再决定是否包含 project resources
```

现有测试 `test/resource-loader.test.ts` 检查了回调阶段只看到用户扩展，以及批准后项目扩展进入最终集合；还检查预信任扩展初始化计数为 1。可用它理解“复用”而非“加载两次”的语义。

## D25.3 包管理器如何收集资源

`PackageManager.resolve()` 先读全局和项目 settings。包源先按项目、再按用户加入候选，并按包身份去重，项目来源胜出。之后解析包资源，再分别处理每种资源类型的项目显式条目、用户显式条目，最后执行自动发现。内置扩展在末尾加入，并应用项目对 builtin 的覆盖规则。

包资源的发现方式取决于包配置：

- 有用户 package filter 时，`autoload: false` 表示不默认加载；其资源类型 pattern 是增量启停规则；否则明确列出的 pattern 筛选文件，空数组会禁用该类型全部资源。
- 没有用户 filter 时，优先采用 `package.json` 中 `pi` manifest 的资源条目。
- 无 manifest 时，从 `extensions/`、`skills/`、`prompts/`、`themes/` 目录收集符合资源类型的文件。

这里的“自动发现”指项目 `.pi` 或用户 agent 目录下的资源目录扫描；它和 package manager 对包内部目录的发现是两条来源不同的路径。排查时查看 `PathMetadata.source`、`scope`、`origin`，不要只看文件名。

## D25.4 优先级排序和去重不是同一件事

`resourcePrecedenceRank` 对资源排序，顺序是：

| rank | 来源 | 例子 |
|---:|---|---|
| 0 | 项目显式本地配置 | 项目 settings 中列出的 Skill |
| 1 | 项目自动发现 | 项目 `.pi/skills/` 中扫描出的 Skill |
| 2 | 用户显式本地配置 | 用户 settings 中列出的 Skill |
| 3 | 用户自动发现 | 用户 agent 目录自动发现的 Skill |
| 4 | package 资源 | 安装包提供的 Skill/Prompt/Theme/Extension |
| 5 | builtin | `builtin:mcp` 等内置扩展 |

`toResolvedPaths` 先按 rank 稳定排序，再按 `canonicalizePath(path)` 去重。路径去重只会删除同一实际路径的重复引用，不会因为两个文件名字相同就删掉其中一个。

不同资源类型之后还会应用自己的语义：Skill loader 按 Skill 名称解决冲突并产生 collision diagnostic；Prompt 和 Theme 分别经过自己的 dedupe 逻辑；Extension 同名工具/命令冲突会被报告，但扩展仍都保留，具体注册顺序影响最终命令或工具映射。因此不要把“路径排序”“Skill 名称冲突”和“扩展工具名冲突”叫成同一种覆盖。

例如用户自动发现的 `web-fetch/SKILL.md` 与 package 内同名 Skill 同时存在：两者 canonical path 不同，所以 PackageManager 都交给 loader；用户来源 rank 更靠前，Skill loader 选用户版本，并把 package 版本作为 collision loser 报告。回归测试 `regressions/2781-skill-collision-precedence.test.ts` 明确断言了这一行为。

## D25.5 `enabled`、路径合并和 `no*` 选项

PackageManager 返回的是 `{ path, enabled, metadata }`，路径存在不等于资源启用。`reload` 会先为解析到的每个路径保存 metadata，再只把 `enabled` 为真的资源放进加载列表；这样禁用项仍可参与配置诊断，但不会被加载。

临时 CLI 源由 `resolveExtensionSources(..., { temporary: true })` 单独解析，metadata 标为 `source: "cli"`、`scope: "temporary"`。`mergePaths` 保留输入顺序并按路径去重。扩展通常将 CLI 路径放在设置解析路径之前；Skills、Prompts、Themes 则将额外显式路径放在列表末尾。这些顺序是后续加载器优先级的重要输入，不能从命令行参数名推断最终胜者。

`noExtensions`、`noSkills`、`noPromptTemplates`、`noThemes` 只改变对应类别的最终路径选择；在这些选项下仍保留明确的 CLI 或 additional 路径。`noContextFiles` 则直接让 `agentsFiles` 为空。它们是不同开关，不是一个总的“禁止所有资源”标志。

## D25.6 四类资源如何进入 loader 状态

扩展由 `loadFinalExtensionSet` 产生 `extensionsResult`，之后 `applyExtensionSourceInfo` 把来源信息附到扩展以及其命令、工具。扩展加载错误和冲突诊断留在 `extensionsResult` 中。

Skills、Prompts、Themes 分别经过 `updateSkillsFromPaths`、`updatePromptsFromPaths`、`updateThemesFromPaths`：

1. 调用对应的加载函数，且 `includeDefaults: false`，因为默认目录已由 PackageManager 路径解析提供；
2. Prompt 与 Theme 还会执行各自 dedupe；
3. 可选 override hook 可以替换结果；
4. 以路径和 metadata 查找来源，把 `sourceInfo` 加回结果对象；
5. 将诊断存入 loader 对应的诊断字段。

目录资源可能需要到内部文件才有来源信息。例如自动发现或 package 来源的 Skill 若路径是目录且有 `SKILL.md`，`mapSkillPath` 会把目录映射到文件，并把同一 metadata 记录到文件路径。否则之后只拿到 `SKILL.md` 文件名时，无法判断它来自项目、用户还是 package。

## D25.7 system prompt 和上下文文件是另一条支路

扩展和资源更新完成后，reload 还会重新载入 `AGENTS.md` 等项目上下文文件（除非 `noContextFiles`），解析 system prompt 输入，并解析 append system prompt 输入。显式传入的 source 优先；未传入时才发现约定文件。路径存在时 loader 会保留其绝对来源路径，便于 UI/诊断展示。

这说明“Skill 没进入模型提示”可能发生在多个位置：路径没解析到、资源被禁用、文件解析失败、名称冲突输掉，或最终 prompt 组装没有引用它。先看 `getSkills()` 与诊断，再看 `formatSkillsForPrompt` 和系统提示组装，不要直接修改 system prompt 文本。

## D25.8 按现象定位

| 现象 | 先检查 | 证据/测试 |
|---|---|---|
| 项目扩展没出现在信任询问中 | 是否处于 pre-trust pass；项目是否仍不可信 | `resource-loader.test.ts` 的 project trust 测试 |
| trust callback 批准后扩展没有运行 | 最终 project settings 是否启用；扩展是否预加载失败；最终结果 errors | 同文件的 trust resolution 测试 |
| 同名 Skill 选错版本 | 每条资源的 source/scope/origin 和 rank；loader collision diagnostic | `regressions/2781-skill-collision-precedence.test.ts` |
| 禁用的资源仍可见于配置诊断 | 区分解析列表和 enabled 加载列表 | `ResolvedResource.enabled` 与 `reload` 的筛选 |
| reload 后 inline factory 状态像旧的 | 是否 `loaded`；cache 是否清除；factory 是不是通过最终 pass 注册 | `regressions/extension-factory-cache.test.ts` |
| 内存 settings reload 后值丢失 | `SettingsManager.reload` 是否保留 in-memory 初始值 | `regressions/3616-settings-inmemory-reload.test.ts` |
| 资源存在但找不到来源 | metadata 是否在目录路径与实际文件路径之间传递 | `mapSkillPath`、`findSourceInfoForPath` |

建议调试时按这条链逐项记值：

```text
raw settings
  → PackageManager ResolvedResource[] (path, enabled, metadata)
  → reload 选出的路径数组
  → loader 解析结果与 diagnostics
  → sourceInfo / UI 可见状态
```

每一步都能回答“输入是什么、过滤掉什么、输出是什么”，问题通常就会落在一个明确边界上。

## D25.9 修改时的验证边界

若只修改说明文字或索引，不需要代码测试。若改资源优先级、信任阶段、路径过滤、缓存或冲突处理，先选最近的具体测试：

- `packages/coding-agent/test/resource-loader.test.ts`：trust、builtin、extension 顺序与 loader 行为；
- `packages/coding-agent/test/suite/regressions/2781-skill-collision-precedence.test.ts`：Skill 同名胜者；
- `packages/coding-agent/test/suite/regressions/3616-settings-inmemory-reload.test.ts`：内存设置 reload；
- `packages/coding-agent/test/suite/regressions/extension-factory-cache.test.ts`：扩展 factory 缓存。

按仓库根 `AGENTS.md`，代码变更后还要执行 `npm run check`；修改测试后必须运行对应测试。本文只做静态源码和既有测试核对，没有声称这些测试在本轮重新运行通过。

## D25.10 阅读路线

1. 读 `resource-loader.ts` 的 `reload`，把每个局部变量的来源标在纸上：`resolvedPaths`、`metadataByPath`、`enabledExtensions`、`extensionPaths`。
2. 跳到 `PackageManager.resolve`，核对资源收集顺序以及 project/user 两份设置的作用域。
3. 跳到 `resourcePrecedenceRank` 和 `toResolvedPaths`，区分排序与 canonical path 去重。
4. 对照 Skill collision 测试，确认“两个路径都在”和“最终只选一个 Skill”可以同时成立。
5. 对照 trust 测试，追踪同一个扩展从 bootstrap 到 final pass 的加载次数。

读完后应能解释：资源为什么没被执行、哪个来源胜出、loader 是否复用预加载扩展，以及诊断应该从哪个 getter 取。
