# 10. 设置来源、资源发现与项目信任

> 预计时间：2 小时（不含选读）
> 先修：上下文构造与压缩（需要知道什么是 compaction，即把旧对话压缩成摘要）

## 本篇你会学到

- 说出一个设置可能来自哪几层，并按优先级算出最终生效的值。
- 解释为什么不受信任的项目，它的设置和扩展不会生效。
- 按固定步骤排查"我的设置没有生效"。

## 先用一个例子理解

假设你想改会话保存的目录，设置项叫 `sessionDir`。你至少有三个地方可以写它：

1. 全局文件 `<agentDir>/settings.json`，写成 `"A"`；
2. 项目文件 `<项目>/.pi/settings.json`，写成 `"B"`；
3. 启动命令 `--session-dir C`。

如果没有统一规则，每个程序都可能自己决定"谁赢"。你改了文件却看不出效果，也无法判断该改哪里。pi 的做法是：每个设置只有一个"生效值"，而且有固定的优先级。

项目文件还有一个额外问题。你从网上 clone 一个仓库，里面可能有 `.pi/settings.json`，它能指定要加载的扩展。扩展是代码，会在你的机器上运行。所以 pi 在加载项目里的代码类资源前，要先确认这个项目可信。这就是"项目信任"。

本篇用 `sessionDir` 和 `defaultTools` 两个设置做实验。你会看到同一个值在三层里的变化，并看到不可信项目为什么只能使用全局设置。

## 核心概念

每个概念给出定义、为什么需要它、一个小例子。

### 概念 1：设置层与合并

**设置层**（settings layer）是设置的一个来源，本项目里有两层文件：全局层和项目层。另外还有代码内置的默认值，以及启动时的覆盖。

**合并**（merge）是把两层合成一份对象。规则很简单：

- 两边都是普通对象时，递归合并，只覆盖同名的键；
- 其他情况，右边（项目层）整体替换左边（全局层）。

```text
全局: { "sessionDir": "A", "retry": { "timeoutMs": 30000, "maxRetries": 3 } }
项目: { "sessionDir": "B", "retry": { "maxRetries": 2 } }
合并: { "sessionDir": "B", "retry": { "timeoutMs": 30000, "maxRetries": 2 } }
```

`retry` 是对象，所以 `timeoutMs` 从全局层保留下来。`sessionDir` 是字符串，项目层直接替换。

`defaultTools` 有一个特殊语法，因为它是数组，而且常见的需求是"再多开一个工具"。数组元素以 `+` 或 `-` 开头时，表示修改继承来的列表，而不是替换它。例如 `["-bash", "+grep"]` 表示去掉 `bash`、加上 `grep`。这个规则在本篇的实验 1 中会被验证。

### 完整示例：全局与项目 settings.json

下面是两份可以被解析的文件。全局文件位于 `<agentDir>/settings.json`，项目文件位于 `<项目>/.pi/settings.json`。项目文件只写想覆盖的键，其余键继承全局层。

全局文件 `<agentDir>/settings.json`：

```json
{
  "theme": "dark",
  "sessionDir": "A",
  "defaultTools": ["read", "bash"],
  "defaultProjectTrust": "ask",
  "enableSkillCommands": true,
  "retry": { "maxRetries": 3, "baseDelayMs": 2000 },
  "compaction": { "enabled": true, "reserveTokens": 16384 }
}
```

项目文件 `<项目>/.pi/settings.json`：

```json
{
  "theme": "light",
  "sessionDir": "B",
  "defaultTools": ["-bash", "+grep"],
  "defaultProjectTrust": "never",
  "retry": { "maxRetries": 2 },
  "compaction": { "reserveTokens": 8192 }
}
```

下面是临时脚本调用 `SettingsManager.create(项目, agentDir)` 得到的输出（本地真实运行，Windows，Node v23.9.0）。脚本只使用临时目录作为 `agentDir`，运行后已删除；它没有调用任何模型。

```text
getSettings() = {"theme":"light","sessionDir":"B","defaultTools":["read","bash","-bash","+grep"],"defaultProjectTrust":"never","enableSkillCommands":true,"retry":{"maxRetries":2,"baseDelayMs":2000},"compaction":{"enabled":true,"reserveTokens":8192}}
getSessionDir() = B
getDefaultTools() = ["read","grep"]
getDefaultProjectTrust() = ask
getProjectSettings().defaultProjectTrust = never
```

逐项看结果：

| 键 | 全局 | 项目 | 合并后 | 规则 |
| --- | --- | --- | --- | --- |
| `theme` | `"dark"` | `"light"` | `"light"` | 字符串，项目整体替换 |
| `sessionDir` | `"A"` | `"B"` | `"B"` | 字符串，项目整体替换 |
| `retry` | `{maxRetries: 3, baseDelayMs: 2000}` | `{maxRetries: 2}` | `{maxRetries: 2, baseDelayMs: 2000}` | 对象，递归合并，`baseDelayMs` 保留 |
| `compaction` | `{enabled: true, reserveTokens: 16384}` | `{reserveTokens: 8192}` | `{enabled: true, reserveTokens: 8192}` | 对象，递归合并，`enabled` 保留 |
| `defaultTools` | `["read","bash"]` | `["-bash","+grep"]` | `["read","bash","-bash","+grep"]` | 数组，全部是 `+`/`-` 时追加 |

有三个地方需要特别注意：

- `defaultTools` 的 `getSettings()` 结果是拼接后的原始列表。`getDefaultTools()` 才会按顺序执行 `-bash` 和 `+grep`，得到 `["read","grep"]`。两个方法读的是同一份数据，但看到的形式不同。
- `defaultProjectTrust` 写在项目文件里，合并后的对象里确实有 `"never"`，但 `getDefaultProjectTrust()` 返回 `ask`。`Settings` 类型上的注释写着 `global setting only`。本地运行的输出与注释一致；`getDefaultProjectTrust()` 的函数体未逐行核对。这是"写了但不生效"的典型例子，排查方法见本篇的排查步骤。
- 合并结果里的 `sessionDir` 是 `"B"`，但它只是设置层的值。命令行和环境变量还可能盖过它，见下一节的优先级表。

### 概念 2：生效值

**生效值**（effective value）是程序真正使用的那一份合并结果。它存放在 `SettingsManager` 内部的 `settings` 字段里，所有 getter（如 `getSessionDir()`、`getDefaultTools()`）都读它。

这一点很重要：文件里写着 `"B"`，不代表程序正在用 `"B"`。只有合并后的生效值才算数。

### 同一个设置的来源优先级

概念 1 讲的是两份设置文件之间的合并。实际运行时，`sessionDir` 还可能来自命令行和环境变量。下表按从强到弱排列，同一个设置只有排名最靠前的那一个生效。表中的例子都使用 `sessionDir`。

| 排名 | 来源 | 例子 | 最终结果 | 代码位置 |
| ---: | --- | --- | --- | --- |
| 1 | 命令行 `--session-dir` | `--session-dir C` | `C` | `main.ts` 中 `parsed.sessionDir` 的分支 |
| 2 | 环境变量 `PI_CODING_AGENT_SESSION_DIR` | 设为 `E` | `E` | `main.ts` 中 `ENV_SESSION_DIR` 的分支 |
| 3 | 会话覆盖 `applyOverrides` | `{ sessionDir: "F" }` | `F`，只在内存中，`reload()` 后消失 | `SettingsManager.applyOverrides` |
| 4 | 项目设置 `<项目>/.pi/settings.json` | `"B"` | `B`（项目可信时） | 合并后的 `settings` |
| 5 | 全局设置 `<agentDir>/settings.json` | `"A"` | `A`（项目不可信，或项目没写这个键） | 合并后的 `settings` |
| 6 | 没有任何来源 | 文件里都没有该键 | `undefined`，由调用方使用它自己的默认目录 | `getSessionDir()` 返回 `undefined` |

用实验验证排名 3 和排名 4 的关系（本地真实运行的输出）：

```text
A applyOverrides F -> getSessionDir() = F
A after reload getSessionDir() = B
A no files: getSessionDir() = undefined  getDefaultTools() = undefined
```

- 第一行：会话覆盖（排名 3）盖过了项目设置（排名 4）。
- 第二行：`reload()` 之后回到项目的 `B`，覆盖消失。
- 第三行：没有任何文件时，所有 getter 返回 `undefined`。这说明"内置默认"不在 `SettingsManager` 里，而是由调用方补上。

为什么排名 1 和 2 不走合并？看 `main.ts` 中的代码。它用 `??` 把三个来源串起来：先取 `parsed.sessionDir`；如果没有，取环境变量；都没有，才取 `startupSettingsManager.getSessionDir()`。这是"第一个有值的赢"，不是对象合并，所以命令行的值会完整替换设置文件里的值。`main.ts` 对 `applyOverrides` 的调用只有 `theme`，`sessionDir` 不经过它。

### 概念 3：项目信任

**项目信任**（project trust）是一道门。信任之前，项目层设置当作空对象读取，而且不能写入。

```text
项目未信任:
  读取项目设置  -> 得到 {}（文件内容不读入生效值）
  写入项目设置  -> 报错 "Project is not trusted; refusing to write project settings"
```

"读"和"写"都要挡住。否则一个不可信项目可以通过让 pi 保存设置来留下持久化副作用。

**受保护资源**（trust-requiring resource）是需要信任才能加载的项目资源。它包括 `.pi/settings.json`、`.pi/extensions/`、`.pi/skills/`、`.pi/prompts/`、`.pi/themes/`、`.pi/SYSTEM.md`，以及当前目录或祖先目录里的 `.agents/skills`。空的 `.pi` 目录不算。

### 信任决策的顺序

`resolveProjectTrusted`（`project-trust.ts`）按下面的顺序给结论，第一个给出答案的步骤生效：

1. 调用方传入了 `trustOverride`（对应显式批准或拒绝）：直接使用它。
2. 项目没有受保护资源：直接信任，因为没有需要加载的项目代码。
3. 用户级扩展发出的 `project_trust` 事件给出 `yes` 或 `no`：使用它。扩展要求记住时，结果会写入 `trust.json`。
4. `trust.json` 里已保存的决定。查找时按规范化后的路径，最近的祖先目录的决定生效。
5. 全局设置 `defaultProjectTrust`：`always` 信任，`never` 不信任，`ask` 继续往下。
6. `ask` 时：没有界面返回 `false`；有界面则弹出选择框，并保存用户的选择。

用一个例子说明。`defaultProjectTrust` 是 `ask`，程序没有界面（例如非交互模式），项目里有 `.pi/settings.json`。第 1 到第 4 步都没有答案，第 5 步是 `ask`，第 6 步没有界面，结果是 `false`。项目设置和项目扩展都不会加载。这正是实验 5 的结果。

不可信项目会失去的东西：

- 项目层设置不参与合并，项目层被当作 `{}`；
- 项目的 `.pi` 扩展、技能、模板、主题不加载；
- 项目的系统提示文件（如 `.pi/SYSTEM.md`）只有在可信时才读取；
- 不能写入项目设置。

不可信项目仍然保留的东西：

- 全局设置、全局资源和内置扩展照常工作；
- 上下文文件（如 `AGENTS.md`）的读取不以信任为前提（未在本地验证，见选读）。它们是文本，不会被执行，但会进入模型的输入，所以应当当作不可信输入对待。

这就是"不可信项目得到更少"的含义：它没有失去全部功能，只是失去了来自项目的代码和配置。

### 概念 4：会话覆盖

**会话覆盖**（override）是运行时临时修改生效值的做法，用 `applyOverrides(...)` 实现。它只改内存里的生效值，不写文件，也不记入文件层。

调用 `reload()` 时，生效值会从两份文件重新算出来，覆盖值就丢了。如果宿主希望覆盖一直有效，要在每次 reload 后重新调用 `applyOverrides`。

### 概念 5：reload

**reload** 是从磁盘重新读取全局和项目设置，然后重新合并。它不会自动发生；手工改了文件，要么调用 `reload()`，要么在交互模式里执行 `/reload`。

reload 遇到坏文件时采用"最后已知正确值"的策略。坏 JSON 不会把生效值清空，而是保留上一次成功读取的值，并把错误记入诊断列表。

### 概念 6：资源发现与优先级

**资源**（resource）是除设置之外，pi 从磁盘加载的东西。有五类：

| 资源 | 是什么 | 目录约定 |
| --- | --- | --- |
| 扩展（extension） | 可执行 TypeScript 模块，可以注册工具和命令 | `extensions/` |
| 技能（skill） | 一个目录加一个 `SKILL.md`，按需加载的说明书 | `skills/` |
| 提示词模板（prompt template） | Markdown 文件，变成 `/命令` | `prompts/` |
| 主题（theme） | 终端配色 | `themes/` |
| 上下文文件（context file） | `AGENTS.md` 这类纯文本指令，不执行代码 | 从祖先目录收集 |

**优先级**（precedence）决定同名资源谁赢。`package-manager.ts` 中的 `resourcePrecedenceRank` 给每个来源打一个数字，数字越小越优先：

| rank | 来源 | 例子 |
| ---: | --- | --- |
| 0 | 项目，写在设置里的显式条目 | 项目 `settings.json` 列出的资源 |
| 1 | 项目，自动发现 | 项目 `.pi/prompts/` 里扫描到的文件 |
| 2 | 用户（全局），写在设置里的显式条目 | 全局 `settings.json` 列出的资源 |
| 3 | 用户（全局），自动发现 | `<agentDir>/prompts/` 里扫描到的文件 |
| 4 | 包（package）提供的资源 | 通过 pi 包安装的资源 |
| 5 | 内置（builtin）扩展 | 随 pi 一起发布的扩展 |

项目层排在用户层前面，所以项目里的同名模板会压过全局模板。这个规则只在项目可信时才适用，因为不可信时项目资源根本不进入候选列表。

### 资源从发现到加载

一个资源（例如提示词模板）要被使用，要经过四步。每一步都可能让它"消失"：

1. **发现。** `PackageManager.resolve()` 按目录约定收集候选路径：用户设置里列出的、项目和用户目录里自动发现的、包提供的，以及内置的。
2. **标记 enabled。** 每个候选带一个 `enabled` 标记和元数据（来源、范围）。被禁用的候选仍在列表里，便于诊断，但不会被加载。
3. **信任过滤。** 项目来源的候选只有在项目可信时才参与解析。不可信时项目设置为 `{}`，项目目录的候选也不会进入加载列表。
4. **去重与冲突。** 按 rank 排序，去掉指向同一真实文件的重复引用，然后交给各类资源的加载器。两个不同文件同名时，冲突在这一步产生诊断。

所以"资源没有出现"可能发生在任何一步：没有被发现（路径写错）、被标记为禁用、因为不可信而被过滤、或者在同名冲突中输给了别人。实验 4 演示的是第 3 步和第 4 步。

### 容易混淆的几组词

- **文件内容与生效值。** 文件写了 `"B"`，不代表程序用的是 `"B"`。不可信或解析失败时，生效值可能不是文件里的值。
- **覆盖与写入。** `applyOverrides` 只改内存；setter 改内存的同时还会排队写文件。两者都让 getter 立刻看到新值，但只有后者会留下文件。
- **信任与沙箱。** 信任决定项目资源是否加载。它不限制已加载工具能访问什么。
- **去重与冲突。** 去重删除指向同一个真实文件的重复引用；冲突是两个不同文件同名，只会选中一个。
- **设置与资源。** 设置是 JSON 里的值；资源是磁盘上的文件或目录。设置可以告诉 pi 去哪里找资源，但两者的合并路径不同（见选读）。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径（相对仓库根） | 符号 | 读的时候关注什么 |
| ---: | --- | --- | --- |
| 1 | `packages/coding-agent/src/config.ts` | `getAgentDir`、`ENV_AGENT_DIR`、`ENV_SESSION_DIR`、`CONFIG_DIR_NAME` | 全局目录从哪来；项目目录名 `.pi` 来自包配置，默认值是 `.pi` |
| 2 | `packages/coding-agent/src/main.ts` | `main`、局部变量 `startupSettingsManager`、`runtimeSettingsManager` | 启动时创建两次设置管理器；会话目录的优先级；交互模式下的覆盖 |
| 3 | `packages/coding-agent/src/core/settings-manager.ts` | `SettingsManager.create`、`tryLoadFromStorage`、`loadFromStorage`、`deepMergeSettings` | 文件如何变成对象，合并如何发生 |
| 4 | `packages/coding-agent/src/core/settings-manager.ts` | `DEFAULT_TOOL_NAMES`、`mergeDefaultTools`、`resolveDefaultTools`、`getDefaultTools` | `defaultTools` 的 `+/-` 规则在哪两步生效 |
| 5 | `packages/coding-agent/src/core/settings-manager.ts` | `FileSettingsStorage.withLock` | 读取文件时也会取锁；只有要写时才创建目录 |
| 6 | `packages/coding-agent/src/core/settings-manager.ts` | `setProjectTrusted`、`assertProjectTrustedForWrite`、`reload`、`applyOverrides` | 信任切换、写入守卫、重新读取、会话覆盖 |
| 7 | `packages/coding-agent/src/core/trust-manager.ts` | `hasTrustRequiringProjectResources`、`ProjectTrustStore` | 哪些文件触发信任；决定保存在 `<agentDir>/trust.json` |
| 8 | `packages/coding-agent/src/core/project-trust.ts` | `resolveProjectTrusted` | 信任决策的顺序 |
| 9 | `packages/coding-agent/src/core/resource-loader.ts` | `DefaultResourceLoader`、`reload`、`loadProjectTrustExtensions`、`getPrompts` | 信任前先加载哪些扩展；资源如何进入加载列表 |
| 10 | `packages/coding-agent/src/core/package-manager.ts` | `resourcePrecedenceRank` | 同名资源的 rank 数字 |
| 11 | `packages/coding-agent/src/core/slash-commands.ts` | 命令表中的 `trust`、`reload` | 交互模式里对应的两个命令 |
| 12 | `packages/coding-agent/src/utils/version-check.ts` | 读取 `PI_SKIP_VERSION_CHECK` 的位置 | 环境变量只在这里被检查；`main.ts` 在离线模式下设置它 |
| 13 | `packages/ai/src/env-api-keys.ts` | `findEnvKeys` | 供应商 API Key 的环境变量。它与设置系统是两条独立的路径 |

阅读建议：先读第 3 到第 6 步，搞清楚"一份设置对象如何产生"。再读第 7 到第 8 步，搞清楚"项目能否参与"。最后读第 9 到第 10 步，搞清楚"资源如何排序"。不要把三件事混成一条链。

## 走读一次完整过程

场景：用户在项目目录 `D:/work/app` 启动 pi，全局设置里有 `sessionDir: "A"`，项目设置里有 `sessionDir: "B"`。项目已经被信任。

1. **决定 agentDir。** `getAgentDir()` 读取环境变量 `PI_CODING_AGENT_DIR`。没有设置时，使用默认的用户目录下的 agent 目录。
2. **创建启动期的设置管理器。** `main.ts` 调用 `SettingsManager.create(cwd, agentDir)`。这一次没有传 `projectTrusted`，默认值是 `true`。它的作用是为会话目录的查找提供一个初始值。
3. **创建存储。** `create` 内部使用 `FileSettingsStorage`，它知道两份文件的路径：`<agentDir>/settings.json` 和 `<cwd>/.pi/settings.json`。
4. **读取全局层。** `tryLoadFromStorage(storage, "global")` 调用 `loadFromStorage`。它通过 `storage.withLock("global", ...)` 读出文本。读取时如果文件存在，就先取锁。
5. **读取项目层。** 对 `"project"` 调用同样的函数，但是 `projectTrusted` 为真，所以继续读文件。
6. **解析与迁移。** 文本经过去掉 BOM、`JSON.parse`，再经过 `migrateSettings` 处理旧字段名。
7. **合并。** 构造函数执行 `this.settings = deepMergeSettings(globalSettings, projectSettings)`。生效值得到 `"B"`。
8. **读取生效值。** `getSessionDir()` 读 `this.settings.sessionDir`，得到 `"B"`。
9. **确定最终会话目录。** `main.ts` 的规则是：命令行 `--session-dir` 优先；其次是环境变量 `PI_CODING_AGENT_SESSION_DIR`；最后才是 `startupSettingsManager.getSessionDir()`。所以如果启动时带了 `--session-dir C`，最终是 `C`，设置文件不参与。
10. **创建运行期的设置管理器。** `main.ts` 再次调用 `SettingsManager.create(cwd, agentDir, { projectTrusted })`，这次传入真实的信任结论。前一个对象只用于找会话目录。

如果项目未信任，第 5 步直接返回 `{}`，不读文件。第 7 步合并的是全局层加上空对象，所以生效值是 `"A"`。

### reload 的过程（对应实验 2 和实验 3）

假设你在 pi 运行时把项目文件从 `B` 改成了 `D`，然后调用 `reload()`。

1. 文件变成 `D`，但 `SettingsManager` 的生效值仍然是旧的。文件变化本身不会通知 pi。
2. `reload()` 先 `await this.writeQueue`，等待之前排队的写入全部结束，避免读到写了一半的状态。
3. 读取全局文件。读取成功则替换 `globalSettings`，并清除全局的加载错误。
4. 清空所有 `modified*` 记录。之后的值就是文件里的值，不再有"本次修改过"的标记。
5. 读取项目文件。是否读取取决于当前的 `projectTrusted`。成功则替换 `projectSettings`。
6. 重新合并，得到新的 `settings`。之前的覆盖值 `C` 没有保存在任何一层里，所以消失了。
7. 如果第 5 步解析失败，项目层保留原来的值，错误被记录下来（实验 3）。

这个过程说明一个事实：`reload()` 是"从文件重新算"，不是"在旧值上叠加修改"。

### 走读二：不可信项目的提示词模板如何被排除

场景：项目目录里有 `.pi/prompts/inspect.md`，全局目录里也有 `inspect.md`。项目未信任，这对应实验 4 的第二次 reload。

1. 调用 `pm.setProjectTrusted(false)`。`SettingsManager` 清空 `projectSettings`，项目设置不再参与合并。
2. 调用 `loader.reload()`。它没有传 `resolveProjectTrust`，所以跳过信任询问的两阶段流程，直接进入第 3 步。
3. `reload` 调用 `settingsManager.reload()`。项目设置按"不可信"处理，仍是 `{}`。
4. `reload` 调用 `packageManager.resolve()`。解析项目来源的候选时，`PackageManager` 检查 `isProjectTrusted()`；为假时，项目来源的候选不进入结果。
5. 剩下的候选只有全局的 `inspect.md`。它的 rank 是 3，没有对手，因此被选中，没有冲突诊断。
6. `getPrompts()` 返回 `prompts` 与 `diagnostics`。`prompts` 里的 `inspect` 指向全局文件，`diagnostics` 里没有 `collision`。

对照可信时的第 4 步：项目候选进入结果，rank 1 排在 rank 3 前面，全局文件成为输家，并产生一条 `collision` 诊断。这就是实验 4 中两次输出不同的原因。

### 走读三：技能与提示词模板的发现目录

场景：当前目录（cwd）是 `repo/app`。`repo` 下有 `.git` 目录，所以 `repo` 是 git 仓库根。全局 agent 目录是 `agent`，用户主目录是 `home`。下面的目录树是实验中真实创建的，实验结束后删除。路径都相对于临时根目录 `B`。

```text
B/
  agent/                              <agentDir>
    skills/review/SKILL.md            用户技能 review
    prompts/inspect.md                用户模板 inspect
    prompts/nested/deep.md            子目录里的模板
  home/.agents/skills/lint/SKILL.md   用户级 .agents 技能 lint
  repo/                               有 .git，是仓库根
    .agents/skills/deploy/SKILL.md    祖先目录的 .agents 技能 deploy
    app/                              cwd
      .pi/settings.json
      .pi/skills/review/SKILL.md      项目技能 review
      .pi/prompts/inspect.md          项目模板 inspect
```

`PackageManager` 收集候选的顺序如下（与 `packages/coding-agent/src/core/package-manager.ts` 中的收集代码一致）：

1. 项目技能：`<cwd>/.pi/skills/`。只有项目可信时才扫描。
2. 祖先的 `.agents` 技能：从 `cwd` 开始，每上一层检查一次 `<dir>/.agents/skills/`，直到遇到含 `.git` 的目录为止，包括那个目录。本例检查 `app/.agents/skills`（不存在）和 `repo/.agents/skills`（存在）。只有项目可信时才扫描。如果一直找不到 `.git`，就会一直走到文件系统根目录。
3. 项目模板：`<cwd>/.pi/prompts/`。只看这一层的 `.md` 文件，不进入子目录。只有项目可信时才扫描。
4. 用户技能：`<agentDir>/skills/`。
5. 用户级 `.agents` 技能：`~/.agents/skills/`。`~` 由环境变量 `HOME`（没有时用系统主目录）决定。
6. 用户模板：`<agentDir>/prompts/`。同样只看这一层。

每个候选都带有 `source`、`scope` 和 `baseDir`。之后 `resourcePrecedenceRank` 按上面的 rank 表排序；同一个真实文件出现两次时，只保留第一次。

技能的规则比模板多一些，由 `collectSkillEntries` 完成：

- 如果一个目录里直接有 `SKILL.md`，这个目录就是一个技能，不再进入它的子目录。
- 否则递归进入子目录，寻找 `SKILL.md`。名字以 `.` 开头的目录和 `node_modules` 被跳过。
- 根目录下的 `.md` 文件只在"pi 模式"（`<agentDir>/skills/` 和 `.pi/skills/`）中被当作技能。在"agents 模式"（`.agents/skills/`）中，根目录的 `.md` 被忽略，只有子目录里的 `.md` 才算。

实验输出（本地真实运行；路径相对于临时根目录 `B`，Windows 的反斜杠保留）：

```text
B trusted skills:
  review <- B\repo\app\.pi\skills\review\SKILL.md
  deploy <- B\repo\.agents\skills\deploy\SKILL.md
  lint <- home\.agents\skills\lint\SKILL.md
B trusted prompts:
  inspect <- B\repo\app\.pi\prompts\inspect.md
B trusted diagnostics: collision: name "review" collision | collision: name "/inspect" collision
B untrusted skills:
  review <- B\agent\skills\review\SKILL.md
  lint <- home\.agents\skills\lint\SKILL.md
B untrusted prompts:
  inspect <- B\agent\prompts\inspect.md
B untrusted diagnostics: none
```

逐条解释：

- 可信时，`review` 有两个候选：项目的（rank 1）和用户的（rank 3）。rank 小的项目技能胜出，另一个产生一条 `collision` 诊断。
- `deploy` 来自祖先的 `.agents/skills`。它是项目来源，所以只有可信时才出现。
- `lint` 来自 `~/.agents/skills`。它是用户来源，两种情况下都出现。
- 模板 `inspect` 的冲突与技能相同。诊断文本里名字显示为 `/inspect`，这是诊断的格式；模板本身的名字是 `inspect`。
- `nested/deep.md` 没有出现，因为模板只看顶层。
- 不可信时，项目来源的 `review`、`deploy` 和模板 `inspect` 全部消失，因此没有冲突诊断。全局的 `review` 和 `inspect` 被选中。

为什么要在 `.git` 处停止？如果不停止，祖先搜索会一直走到磁盘根目录，把别的项目甚至家目录下的 `.agents/skills` 也当作当前项目的资源。`.git` 只是一个停止标记，本例中它是空目录；真实仓库中它可能是目录，也可能是文件（git worktree 的情况），代码只用 `existsSync` 检查，两者都可以。

### 走读四：trust.json 的前后变化

场景：项目 `parent/project` 有 `.pi/settings.json`，所以它是需要信任的项目。信任决定保存在 `<agentDir>/trust.json`。下面的输出把临时目录替换为 `<TMP>`。

第 0 步：还没有任何决定，文件不存在。调用 `resolveProjectTrusted`（无界面，`defaultProjectTrust` 为 `ask`）得到 `false`，而且不写入文件。

```text
C0 file: (absent)
C1 ask, no UI -> trusted: false  file: (absent)
```

第 1 步：之前用户选过"不信任"，文件里有一条 `false`。这是"before"。

```json
{
  "<TMP>\\C\\parent\\project": false
}
```

结果：`resolveProjectTrusted` 在第 4 步（已保存的决定）就得到 `false`，不再弹出选择框，也不再询问。

第 2 步：用户改为"信任"，执行 `store.set(project, true)`，文件变成：

```json
{
  "<TMP>\\C\\parent\\project": true
}
```

第 3 步：用户选择 "Trust parent folder"。对应的调用是 `setMany([{ path: parent, decision: true }, { path: project, decision: null }])`。`null` 的意思是"删除这一条"，所以 `project` 键消失，只剩父目录。这是"after"：

```json
{
  "<TMP>\\C\\parent": true
}
```

结果：`project` 没有自己的条目，`findNearestTrustEntry` 向上找到 `parent`，得到 `true`。父目录下的其它子目录也会因此可信，除非它们有自己的条目。

这个例子说明四点：

- 文件的键是规范化后的绝对路径（`canonicalizePath(resolvePath(...))`），不是你输入的相对路径。Windows 上反斜杠在 JSON 中写成 `\\`。
- 文件的值只有 `true` 或 `false`。`null` 只出现在更新请求中，表示删除。pi 自己不会写出 `null`，但读取时接受它。
- 写入时会先加锁、再读取文件，修改后按键名排序写回。所以文件内容的顺序是稳定的。
- 信任的查找顺序在 `resolveProjectTrusted` 中：先看 `trustOverride`，再看有没有受保护资源，然后是用户扩展的 `project_trust` 事件，最后才读 `trust.json`。本例中前两步都没有给出答案，所以结果来自 `trust.json`。

### TypeScript 小课：`Partial` 与运行时检查

`SettingsManager` 中的类型 `Settings` 描述字段的形状。`applyOverrides` 的参数类型是 `Partial<Settings>`，意思是"每个字段都可选，只传你想改的字段"：

```typescript
type Settings = { sessionDir?: string; defaultTools?: string[] };
const override: Partial<Settings> = { sessionDir: "C" }; // 只改一个字段
```

但类型只在编译期存在。`settings.json` 是用户手写的文本，TypeScript 无法保证它合法。所以加载路径必须在运行时检查：`JSON.parse` 能否成功，迁移函数能否处理旧字段名，错误能否被记录。`tryLoadFromStorage` 用 `try/catch` 包住整个读取过程，正是为此。

类型声明帮助开发者写对代码；运行时检查和诊断列表才保护用户的文件。本篇里还有另一道门：项目代码不可信，所以需要信任门。两者都是"不要相信输入"，只是检查的对象不同：一个是文件内容，一个是项目代码。

## 动手实验

实验使用一个临时脚本。它只在系统临时目录里创建 `agent` 和 `project` 两个目录，结束时删除。它不读写你真实的 `~/.pi`，也不调用任何模型。

### 准备：保存脚本

用编辑器新建文件，保存为临时目录下的 `pi-task10-exp/exp.mts`。

- PowerShell 路径：`$env:TEMP\pi-task10-exp\exp.mts`
- bash 路径：`/tmp/pi-task10-exp/exp.mts`（Git Bash 中 `/tmp` 指向系统临时目录）

如果你的仓库不在 `D:\Github\pi`，把脚本里 `file:///D:/Github/pi` 替换成你的路径。

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { resolveProjectTrusted } from "file:///D:/Github/pi/packages/coding-agent/src/core/project-trust.ts";
import { DefaultResourceLoader } from "file:///D:/Github/pi/packages/coding-agent/src/core/resource-loader.ts";
import { SettingsManager } from "file:///D:/Github/pi/packages/coding-agent/src/core/settings-manager.ts";
import { ProjectTrustStore } from "file:///D:/Github/pi/packages/coding-agent/src/core/trust-manager.ts";

function write(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text);
}

const root = mkdtempSync(join(tmpdir(), "pi-task10-"));
try {
	const agentDir = join(root, "agent");
	const projectDir = join(root, "project");
	const projectSettings = join(projectDir, ".pi", "settings.json");
	write(join(agentDir, "settings.json"), JSON.stringify({ sessionDir: "A", defaultTools: ["read", "bash"] }));
	write(projectSettings, JSON.stringify({ sessionDir: "B", defaultTools: ["-bash", "+grep"] }));

	const m = SettingsManager.create(projectDir, agentDir);
	console.log("E1 trusted        sessionDir =", m.getSessionDir(), " tools =", m.getDefaultTools());
	m.setProjectTrusted(false);
	console.log("E1 untrusted      sessionDir =", m.getSessionDir(), " tools =", m.getDefaultTools());
	m.setProjectTrusted(true);
	console.log("E1 re-trusted     sessionDir =", m.getSessionDir());
	m.applyOverrides({ sessionDir: "C" });
	console.log("E1 applyOverrides sessionDir =", m.getSessionDir());
	write(projectSettings, JSON.stringify({ sessionDir: "D" }));
	console.log("E1 file=D, no reload sessionDir =", m.getSessionDir());
	await m.reload();
	console.log("E1 after reload   sessionDir =", m.getSessionDir());
	write(projectSettings, "{broken");
	await m.reload();
	console.log("E1 broken JSON + reload sessionDir =", m.getSessionDir(), " errors =", m.drainErrors().map((e) => e.scope));
	console.log("E1 errors drained again =", m.drainErrors().length);
} finally {
	rmSync(root, { recursive: true, force: true });
}

const root2 = mkdtempSync(join(tmpdir(), "pi-task10-prompts-"));
try {
	const agentDir = join(root2, "agent");
	const projectDir = join(root2, "project");
	const globalPrompt = join(agentDir, "prompts", "inspect.md");
	const projectPrompt = join(projectDir, ".pi", "prompts", "inspect.md");
	write(globalPrompt, "---\ndescription: Inspect source\n---\nGLOBAL\n");
	write(projectPrompt, "---\ndescription: Inspect source\n---\nPROJECT\n");
	write(join(projectDir, ".pi", "settings.json"), "{}");

	const pm = SettingsManager.create(projectDir, agentDir);
	const loader = new DefaultResourceLoader({ cwd: projectDir, agentDir, settingsManager: pm });
	const show = () => {
		const r = loader.getPrompts();
		const chosen = r.prompts.find((p) => p.name === "inspect");
		const collisions = r.diagnostics.filter((d) => d.type === "collision").length;
		return `chosen=${chosen ? relative(root2, chosen.filePath) : "none"} collisions=${collisions}`;
	};
	await loader.reload();
	console.log("E2 trusted   ", show());
	pm.setProjectTrusted(false);
	await loader.reload();
	console.log("E2 untrusted ", show());

	const store = new ProjectTrustStore(agentDir);
	const ctx = { hasUI: false, ui: undefined };
	for (const mode of ["always", "never", "ask"] as const) {
		const trusted = await resolveProjectTrusted({
			cwd: projectDir,
			trustStore: store,
			defaultProjectTrust: mode,
			projectTrustContext: ctx,
		});
		console.log(`E3 defaultProjectTrust=${mode} no-UI -> trusted=${trusted}`);
	}
} finally {
	rmSync(root2, { recursive: true, force: true });
}
```

### 运行

PowerShell：

```powershell
node "$env:TEMP\pi-task10-exp\exp.mts"
```

bash：

```bash
node /tmp/pi-task10-exp/exp.mts
```

Node 23 会在 stderr 打印 `ExperimentalWarning: Type Stripping is an experimental feature`，忽略即可。

以下输出来自本地真实运行（Windows，Node v23.9.0）。

```text
E1 trusted        sessionDir = B  tools = [ 'read', 'grep' ]
E1 untrusted      sessionDir = A  tools = [ 'read', 'bash' ]
E1 re-trusted     sessionDir = B
E1 applyOverrides sessionDir = C
E1 file=D, no reload sessionDir = C
E1 after reload   sessionDir = D
E1 broken JSON + reload sessionDir = D  errors = [ 'project' ]
E1 errors drained again = 0
E2 trusted    chosen=project\.pi\prompts\inspect.md collisions=1
E2 untrusted  chosen=agent\prompts\inspect.md collisions=0
E3 defaultProjectTrust=always no-UI -> trusted=true
E3 defaultProjectTrust=never no-UI -> trusted=false
E3 defaultProjectTrust=ask no-UI -> trusted=false
```

### 怎样读懂输出

| 输出行 | 证明的事 |
| --- | --- |
| `E1 trusted sessionDir = B` | 可信项目的项目层参与合并，项目值覆盖全局值 |
| `E1 untrusted sessionDir = A` | 不可信时项目层被忽略，回到全局值 |
| `E1 applyOverrides sessionDir = C` | 会话覆盖直接改了生效值 |
| `E1 file=D, no reload` 仍是 `C` | 改文件不会自动更新生效值 |
| `E1 after reload sessionDir = D` | reload 从文件重新计算，覆盖消失 |
| `errors = [ 'project' ]` | 项目文件解析失败，错误进入诊断列表 |
| `E2 trusted ... chosen=project\...` | 同名模板中项目层胜出，并产生一条冲突诊断 |
| `E2 untrusted ... chosen=agent\...` | 不可信时项目模板不进入候选，全局模板被选中 |
| `E3 ... -> trusted=...` | 无界面时，结果只由 `defaultProjectTrust` 和已保存的决定决定 |

### 实验 1：可信与不可信（5 分钟）

目的：看到同一个文件在信任前后生效值不同。

步骤：看 `E1 trusted` 与 `E1 untrusted` 两行。

预期：可信时 `sessionDir = B`，全局为 `A`。不可信时回到 `A`。

解释：`setProjectTrusted(false)` 把项目层替换为 `{}`，然后重新合并。项目的 `"B"` 从未进入生效值。

工具列表也一样。可信时，全局 `["read", "bash"]` 与项目 `["-bash", "+grep"]` 合并得到 `["read", "grep"]`；不可信时只剩全局的 `["read", "bash"]`。

### 实验 2：覆盖与 reload

目的：区分"改文件"、"会话覆盖"和"reload"三件事。

步骤：看 `E1 applyOverrides`、`E1 file=D, no reload`、`E1 after reload` 三行。

预期：

- 覆盖后是 `C`；
- 文件改成 `D`，但没 reload 时仍是 `C`；
- reload 之后变成 `D`，覆盖的 `C` 消失。

解释：覆盖只修改内存中的生效值。reload 从文件重新合并，所以覆盖不会保留下来。

### 实验 3：坏 JSON

目的：看到解析错误时，设置系统保留旧值而不崩溃。

步骤：看 `E1 broken JSON + reload` 与 `E1 errors drained again` 两行。

预期：`sessionDir` 仍是 `D`；错误列表里有一条 `project`；第二次取出为 0，因为 `drainErrors()` 会清空列表。

解释：reload 发现项目文件解析失败时，只记录错误，不替换上一次成功的项目设置。

### 实验 4：同名提示词模板

目的：看到项目层的同名模板胜出，并且不可信时它消失。

步骤：看 `E2` 两行。

预期：

- 可信时选中项目的 `inspect.md`，并且有 1 条冲突诊断（collision）；
- 不可信时选中全局的 `inspect.md`，没有冲突诊断。

解释：两个文件都在候选列表里时，rank 更小的项目层排在前面。不可信时项目的文件根本不进入候选列表，所以没有冲突。

### 实验 5：信任决策（无界面）

目的：看到没有界面时，`defaultProjectTrust` 决定结果。

步骤：看 `E3` 三行。

预期：`always` 信任，`never` 与 `ask` 不信任。

解释：`ask` 需要界面弹窗；没有界面时，`resolveProjectTrusted` 直接返回 `false`。

### 清理

脚本已经删除自己创建的临时目录。最后删除脚本本身：

PowerShell：

```powershell
Remove-Item -Recurse -Force "$env:TEMP\pi-task10-exp"
```

bash：

```bash
rm -rf /tmp/pi-task10-exp
```

## 自测题

1. 同一个 `sessionDir` 同时出现在全局、项目和 `--session-dir` 三处，哪一个生效？为什么 `--session-dir` 不走合并？
2. 项目未信任时，`getDefaultTools()` 为什么不会看到项目里的 `["-bash", "+grep"]`？写项目设置时会发生什么？
3. `applyOverrides({ sessionDir: "C" })` 之后调用 `reload()`，生效值是什么？为什么？
4. `resolveProjectTrusted` 的决策顺序是什么？没有界面且 `defaultProjectTrust` 为 `ask` 时，结果是什么？

5. 为什么看 `getPrompts()` 的结果时，要同时看 `filePath` 和诊断，而不能只看名字？

### 参考答案

1. 只有 `--session-dir C` 生效。`main.ts` 先看命令行参数，有值就直接使用，不再查看设置。它是完整替换，不是合并，所以设置文件里的 `A` 和 `B` 都不参与。
2. `getDefaultTools()` 读的是生效值。未信任时项目层被换成 `{}`，`["-bash", "+grep"]` 根本没有进入合并。写项目设置会抛出 `Project is not trusted; refusing to write project settings`，文件内容保持不变。
3. 生效值不是 `"C"`，而是从两份文件重新算出的值（实验中是 `"D"`，或全局的 `"A"`）。`applyOverrides` 只改内存，`reload()` 不保留它。
4. 顺序是：`trustOverride`，然后是"没有受保护资源则信任"，然后是 `project_trust` 事件，然后是 `trust.json` 中已保存的决定，然后是 `defaultProjectTrust`，最后是界面弹窗或无界面时的 `false`。没有界面且为 `ask` 时结果是 `false`（实验 5）。
5. 同名模板可能有多个，只有一个会被选中。`filePath` 告诉你选中的是哪个文件，`collision` 诊断告诉你还有哪些输了。只看名字无法区分它们。

## 常见错误

### 排查步骤：设置没有生效

按顺序做，每一项都要有证据。不要跳项。PowerShell 与 bash 的写法不同，所以两份都写；两者结果相同的命令只写一份。

1. **确认你改的是哪份文件。** 全局文件是 `<agentDir>/settings.json`，项目文件是 `<项目>/.pi/settings.json`。`agentDir` 来自环境变量 `PI_CODING_AGENT_DIR`；没有设置时，使用 `getAgentDir()` 给出的默认目录。很多"没有生效"的问题只是改错了目录。
   - PowerShell：`"$env:PI_CODING_AGENT_DIR"; Get-Content "$env:PI_CODING_AGENT_DIR\settings.json"`
   - bash：`echo "$PI_CODING_AGENT_DIR"; cat "$PI_CODING_AGENT_DIR/settings.json"`
   - 预期：输出的内容就是你以为的那份文件。实验中把 `PI_CODING_AGENT_DIR` 指向临时目录后，两条命令都输出 `{ "sessionDir": "A" }`（本地运行）。
2. **比较两层文件和生效值。** 在临时脚本中用与实验相同的方式导入 `SettingsManager`，然后调用三个 getter：

   ```typescript
   const m = SettingsManager.create(projectDir, agentDir);
   console.log(m.getGlobalSettings(), m.getProjectSettings(), m.getSettings());
   ```

   - 预期：如果 `getProjectSettings()` 是 `{}`，说明项目层没有读进来，去看第 3 项（JSON）和第 4 项（信任）。如果两层都有值，但 `getSettings()` 的结果与你的预期不同，按"完整示例"中的规则重新计算。
3. **检查 JSON 是否合法。** 注释和尾逗号都会让解析失败，而且失败时整份文件会被忽略。命令（PowerShell 与 bash 相同，只需把路径换成你的文件）：
   - `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "<文件路径>"`
   - 预期：合法时没有输出，非法时输出 `SyntaxError`。实验中对 `{ "sessionDir": "B", }` 的输出是 `SyntaxError: Expected double-quoted property name in JSON at position 21 (line 1 column 22)`。
   - 程序内的对应检查是 `drainErrors()`。本地运行中它返回 `project <TMP>\D\project\.pi\settings.json`。注意 `drainErrors()` 会清空列表，需要时先保存结果。
4. **检查信任。** 项目层只有在可信时才参与合并。查看已保存的决定：
   - PowerShell：`Get-Content "$env:PI_CODING_AGENT_DIR\trust.json"`
   - bash：`cat "$PI_CODING_AGENT_DIR/trust.json"`
   - 预期：文件不存在时命令会报错，这表示没有保存过决定。此时项目是否可信取决于 `defaultProjectTrust` 和界面。交互模式执行 `/trust` 可以保存决定（命令名见 `packages/coding-agent/src/core/slash-commands.ts`）。程序内调用 `isProjectTrusted()`，返回 `false` 就是原因。实验 T3 中 `isProjectTrusted() = false`，`getSessionDir()` 回到全局的 `A`。
5. **检查覆盖。** 下面三个来源会盖过设置文件：命令行 `--session-dir`、环境变量 `PI_CODING_AGENT_SESSION_DIR`，以及宿主代码（SDK 调用方）中的 `applyOverrides`。检查环境变量：
   - PowerShell：`"[" + $env:PI_CODING_AGENT_SESSION_DIR + "]"`
   - bash：`echo "[$PI_CODING_AGENT_SESSION_DIR]"`
   - 预期：输出 `[]` 表示环境变量没有设置。然后检查你的启动命令里有没有 `--session-dir`。它的值是完整替换，不参与合并。用 `pi` 命令行实际验证这一点未在本地验证（本篇没有启动 pi）。
6. **检查 reload 和消费者。** 文件改完后，生效值不会自动更新。交互模式执行 `/reload`，代码中调用 `reload()`。然后确认读取它的代码确实使用了这个值：
   - bash：`grep -rn "getDefaultTools()" packages/coding-agent/src`（在仓库根目录执行；PowerShell 中可用编辑器的搜索功能，未在本地用 PowerShell 验证）
   - 预期：结果包含 `agent-session.ts` 和 `sdk.ts` 中的调用，这两处读的是生效值。如果改了设置、重新加载后当前会话仍没有变化，去看会话创建时是否已经算好了值。

真实例子：你改了 `defaultTools`，但当前会话的工具没有变化。第 6 项是最可能的原因：工具集在创建会话时计算，中途改设置不会改变它。这一点与 `sdk.ts` 的创建流程有关，未在本地用实验验证。

### 排查示例：一次完整的排查

场景：你在 `<项目>/.pi/settings.json` 里写了 `"sessionDir": "B"`，但 `getSessionDir()` 仍然返回全局的 `A`。下面是组 T 的真实运行输出（临时目录，运行后已删除）。路径中的临时目录用 `<TMP>` 表示。上面第 3 项和第 4 项中引用的 T1 到 D3，就是这组输出。

```text
T1 getSessionDir() with broken project JSON = A
T1 drainErrors() = [ 'project <TMP>\\D\\project\\.pi\\settings.json' ]
T2 after fixing JSON and reload = B  errors = 0
T3 untrusted: isProjectTrusted() = false  getSessionDir() = A
```

这四行对应三个原因：

- **原因一：JSON 不合法（第 3 项）。** 项目文件里有尾逗号，解析失败。解析失败时项目层被当作 `{}`，所以生效值是全局的 `A`。错误进入 `drainErrors()`，它的 `scope` 是 `project`，`path` 指向那份文件。修好 JSON 并执行 `reload()` 后，生效值变成 `B`，错误列表为空（D2）。
- **原因二：没有 reload（第 6 项）。** 只改文件而不 reload，生效值会一直是旧值。实验 2 的第二行（`file=D, no reload`）演示的就是这个现象。T2 中的 `reload()` 是必须的一步。
- **原因三：项目不可信（第 4 项）。** T3 用 `projectTrusted: false` 创建管理器。项目层不参与合并，`isProjectTrusted()` 返回 `false`，生效值回到 `A`。即使文件内容完全正确，结果也一样。

下表把常见症状映射到第一个应该做的检查：

| 症状 | 先做的检查 | 典型原因 |
| --- | --- | --- |
| 项目文件写了值，程序仍用全局值 | 第 3 项（JSON）、第 4 项（信任） | JSON 非法，或项目不可信 |
| 改了文件，程序里的值没变 | 第 6 项（reload） | 生效值还是旧快照 |
| 改了 `sessionDir`，但保存目录没变 | 第 5 项（覆盖） | 命令行或环境变量盖过了文件 |
| 在项目里写了 `defaultProjectTrust`，但没有效果 | 第 2 项（比较三个 getter） | 项目层的值不被 `getDefaultProjectTrust()` 使用 |
| 改了 `defaultTools`，当前会话工具不变 | 第 6 项（消费者） | 工具集在会话创建时已经算好 |

排查时请记录以下证据，它们比记忆可靠：

- 每个 getter 的输出，而不是"我记得它是 B"。
- `drainErrors()` 的结果，因为调用一次后列表就被清空。
- 你使用的 `agentDir` 和项目目录的绝对路径。两者不对应时，前面的所有结论都不适用。

如果三个原因都不符合，回到第 2 项，比较 `getGlobalSettings()`、`getProjectSettings()` 和 `getSettings()` 的差异。大多数"没有生效"的问题都能在这三个输出中找到答案。

### 常见现象

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 项目 `.pi/settings.json` 写了值，但程序仍用全局值 | 项目未信任，项目层被当作 `{}` | 在交互模式执行 `/trust`；或把设置移到全局文件 |
| 改了文件，程序里的值没变 | 没有 reload，生效值仍是旧快照 | 执行 `/reload`，或在代码里调用 `reload()` |
| 改了设置后，值变回了旧的 | 启动时或会话中 `applyOverrides` 的覆盖在 reload 后丢失 | 在 reload 之后重新应用覆盖，或去掉覆盖 |
| 项目设置文件里有注释或多余逗号，整份项目设置失效 | JSON 解析失败，项目层保留上一次成功的值，错误进入诊断 | 改成合法 JSON（不能有注释和尾逗号）；用 `drainErrors()` 查看错误 |
| 以为"信任了项目"就等于沙箱，工具可以随便访问文件 | 信任只决定项目资源是否加载，不限制工具权限 | 把信任当作"允许执行项目代码"的决定；工具仍用 pi 进程的系统权限运行 |
| 非交互模式（`print`、`json`）下，主题参数覆盖没有效果 | 启动时只在交互模式下对设置调用 `applyOverrides` | 非交互模式下改用全局设置文件 |
| 两个同名提示词，用的不是预期的那个 | 同名冲突按 rank 选中，项目可信时项目层胜出 | 看 `getPrompts()` 返回的 `filePath` 和 `collision` 诊断，不要只看文件名 |

补充：项目设置文件解析失败后，设置写入会被跳过（`saveProjectSettings` 在 `projectSettingsLoadError` 存在时直接返回）。这时修改只存在于内存中，文件不变。先修好 JSON，再做修改。

## 下一篇

下一篇：技能、模板与扩展。本篇解决的是"资源从哪来、谁优先"。下一篇解决"资源被加载后，怎样变成模型能用的指令、命令和工具"。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| 设置层 | 设置的一个来源，如全局文件或项目文件 | 核心概念 1 |
| 合并 | 把多层设置按规则合成一份对象 | 核心概念 1 |
| 生效值 | 合并后程序真正使用的值，getter 读取它 | 核心概念 2 |
| 项目信任 | 允许项目层设置与代码类资源参与的决定 | 核心概念 3 |
| 受保护资源 | 需要信任才能加载的项目文件或目录 | 核心概念 3 |
| 会话覆盖 | 只改内存生效值的 `applyOverrides` 调用 | 核心概念 4 |
| reload | 从磁盘重新读取设置并重新合并 | 核心概念 5 |
| 最后已知正确值 | 解析失败时保留的上一次成功读取的值 | 核心概念 5 |
| 诊断 | 加载或解析时记录的错误或警告 | 核心概念 5 |
| 资源发现 | 按目录约定找出扩展、技能、模板、主题、上下文文件 | 核心概念 6 |
| 优先级（rank） | 资源来源的排序数字，越小越优先 | 核心概念 6 |
| 同名冲突（collision） | 两个同名资源都存在时产生的诊断，只有一个会被选中 | 实验 4 |
| 上下文文件 | `AGENTS.md` 等纯文本指令，不执行代码 | 核心概念 6 |
| `trust.json` | 保存信任决定的文件，位于 agentDir 下 | 源码导览 |
| `defaultTools` 语法 | 数组中 `+name` 添加、`-name` 删除的修改规则 | 核心概念 1 |

## 选读：源码深入（可选，跳过不影响主线）

以下内容超出主线。读完主线后再看。

### SettingsManager 的内部状态

`SettingsManager` 同时保存四份数据：

```text
globalSettings   全局文件解析后的对象
projectSettings  项目文件解析后的对象（未信任时为 {}）
settings         合并后的生效值
modifiedFields   本次运行中被 setter 修改过的字段
```

分开保存的原因是：只有分开，才能知道某个值来自哪一层，并且在保存时只写回被修改的字段。如果只保存合并结果，保存时就会把全局层的值错误地写进项目文件。

### 写入路径

以项目层 setter 为例（设置包、路径等项目字段的方法都经过 `updateProjectSettings`）：

1. `updateProjectSettings` 调用 `assertProjectTrustedForWrite`。未信任时直接抛错。
2. 复制 `projectSettings`，执行修改函数，并记录 `markProjectModified(field)`。
3. `saveProjectSettings` 更新内存中的 `projectSettings` 与 `settings`，然后通过 `enqueueWrite("project", ...)` 排队。
4. 队列任务调用 `persistScopedSettings`，它在 `storage.withLock` 内重新读取文件，并只覆盖被修改的字段。

由此可知两点：

- setter 之后立刻 `getX()` 能看到新值，因为内存先更新；
- `flush()` 只等待队列结束，不保证每次写入都成功。写入错误的记录方式未在本地逐行核对。

### withLock 为什么读也取锁

`FileSettingsStorage.withLock` 的顺序是：

1. 如果文件存在，取锁（`lockfile.lockSync`，失败时最多重试 10 次，每次间隔 20 毫秒）；
2. 读取当前文本并交给回调；
3. 如果回调返回了新文本，才创建目录并写入。

读取也取锁，是为了避免读到另一个进程写了一半的文件。单纯读取时不会创建 `.pi` 目录，只有要写入时才会。

### defaultTools 的两步规则

`defaultTools` 的解析分两步，分别在两个私有函数中完成：

- `mergeDefaultTools(base, overrides)`：如果覆盖列表全部由 `+`/`-` 元素组成，就把它追加到继承列表后面；否则覆盖列表整体替换继承列表。注意空数组 `[]` 满足"全部是修饰符"（空真），所以项目层写 `[]` 会继承全局列表。
- `resolveDefaultTools(entries)`：普通名称构成起始列表；如果没有普通名称但有修饰符，起始列表是内置默认 `DEFAULT_TOOL_NAMES`（`read`、`bash`、`edit`、`write`）。然后按顺序应用修饰符。

手算例子：全局 `["read", "bash"]`，项目 `["-bash", "+grep"]`。合并后是 `["read", "bash", "-bash", "+grep"]`。普通名称 `read`、`bash` 构成起始列表，`-bash` 删除 `bash`，`+grep` 追加 `grep`，结果是 `["read", "grep"]`。这与实验 1 的输出一致。

### DefaultResourceLoader.reload 的两阶段

项目信任与资源加载之间有一个依赖：决定信任时，需要扩展参与（`project_trust` 事件），但项目扩展在被信任之前不能执行。解决办法是两阶段：

```text
reload(options)
  如果提供了 resolveProjectTrust:
    1. loadProjectTrustExtensions：
       setProjectTrusted(false) -> settingsManager.reload() -> 只加载用户级和临时 CLI 扩展
    2. 调用回调 resolveProjectTrust(...)，得到 true/false
    3. setProjectTrusted(结果)
  settingsManager.reload()           按最终信任结论重新读设置
  packageManager.resolve()           收集所有候选路径（含 enabled 标记）
  只保留 enabled 的路径
  加载扩展、技能、模板、主题
  加载上下文文件与系统提示
```

第 1 步之所以只加载用户级扩展，是因为项目扩展是项目资源，必须等到第 3 步之后才可能加载。

### 资源候选的去重

`package-manager.ts` 在收集完候选资源后，先按 `resourcePrecedenceRank` 稳定排序，再用 `canonicalizePath` 对路径去重。去重只删除指向同一个真实文件的重复引用。两个不同文件即使文件名相同，也都保留，由各类资源的加载器决定冲突如何处理。

### 环境变量速查

| 变量 | 作用 | 读取位置 |
| --- | --- | --- |
| `PI_CODING_AGENT_DIR` | 覆盖全局 agent 目录 | `config.ts`（`ENV_AGENT_DIR`） |
| `PI_CODING_AGENT_SESSION_DIR` | 覆盖会话目录；低于 `--session-dir`，高于设置 | `main.ts` |
| `PI_SKIP_VERSION_CHECK` | 跳过版本检查 | `utils/version-check.ts`；`main.ts` 在离线模式下设置它 |
| 供应商 API Key 变量（如 `OPENAI_API_KEY`） | 认证，与设置系统无关 | `packages/ai/src/env-api-keys.ts` 的 `findEnvKeys` |

### 未在本地验证的说法

- 上下文文件（`AGENTS.md`）加载不需要项目信任。代码中 `loadProjectContextFiles` 附近没有信任判断，但未运行专门的测试。
- 信任不限制工具权限、不沙箱化已启用的工具。这是设计说明，未在本地用实验验证。
- 交互模式中 `/reload` 是否会调用 `SettingsManager.reload()`，未逐行核对。命令描述写的是"重新加载 keybindings、extensions、skills、prompts、themes 与上下文文件"。
