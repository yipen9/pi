# 第 20 章：仓库规范、依赖与上游贡献

> 学完本章你能回答：
>
> 1. `npm run check` 到底跑了哪些检查？为什么它"会改写文件"？
> 2. 五个检查脚本各自防止什么问题？
> 3. 依赖为什么必须"精确版本"、为什么默认 `--ignore-scripts`、lockfile 什么时候才能提交？
> 4. 本仓库的 Git 纪律（多会话共享工作区）是什么？提交信息怎么写？
> 5. 上游贡献的准入规则（auto-close、`lgtm`/`lgtmi`、质量门槛）是什么？

**前置知识**：第 2 章（环境）、第 18 章（测试）、第 19 章（调试）。
**预计学习时间**：1 天（建议实操一遍 check 与 diff 审查）。
**本章验证状态**：静态核对通过（`AGENTS.md`、`CONTRIBUTING.md`、`package.json` 脚本与 5 个检查脚本源码核对）。

---

## 20.1 `npm run check`：一次跑完的"质量门"

根 `package.json` 的 `check` 脚本（已核对）：

```json
"check": "biome check --write --error-on-warnings . && npm run check:pinned-deps && npm run check:runtime-deps && npm run check:ts-imports && npm run check:entry-graphs && npm run check:install-lock:coding-agent && tsc --noEmit && npm run check:browser-smoke"
```

逐项解释：

| 步骤 | 命令 | 检查什么 |
|---|---|---|
| 1 | `biome check --write --error-on-warnings .` | 格式 + lint，**自动修复**；警告也算错 |
| 2 | `check:pinned-deps` | 外部依赖必须是精确版本 |
| 3 | `check:runtime-deps` | 源码 import 的包必须已声明在依赖里 |
| 4 | `check:ts-imports` | 相对导入必须是 `.ts` 后缀（不是 `.js`） |
| 5 | `check:entry-graphs` | 包入口（exports）的**模块图成本预算** |
| 6 | `check:install-lock:coding-agent` | 独立安装锁与生成脚本一致 |
| 7 | `tsc --noEmit` | 全仓库类型检查 |
| 8 | `check:browser-smoke` | 浏览器环境 smoke 检查 |

**最重要的使用细节**：第 1 步带 `--write`——check **会改你的文件**（格式化、可自动修的 lint）。所以：

```text
跑完 check 后必须 git diff 审查它改了什么；不要把无关的格式变更混进你的改动。
```

`AGENTS.md` 的措辞是"Fix all errors, warnings, and infos before committing"（连 info 都要处理完）。

## 20.2 五个检查脚本：每个都在防一类"慢性病"

### 20.2.1 `check-pinned-deps`：供应链卫生

脚本遍历所有 `package.json`，对 `dependencies`/`devDependencies`/`optionalDependencies` 要求**精确 semver**（`1.2.3` 这种，不允许 `^`/`~`）。规则细节（源码）：

- 内部工作区包（`@earendil-works/pi-*` 与 `@earendil-works/chord`）**豁免**；
- 非 registry 形式（`workspace:`、`file:`、`git+`、`https:` 等）豁免；
- `npm:` 别名会剥出真实版本再检查。

为什么？**浮动版本意味着"今天 CI 通过、明天装出不一样的东西"**。精确版本让安装可复现，也让"升级"成为一个显式的、可审查的提交。

### 20.2.2 `check-runtime-deps`：依赖声明完整性

用 TypeScript 的 parser 扫源码里的 import/export/动态 import 说明符：

- 跳过相对路径、绝对路径、Node 内置模块；
- 其余（包名，含 scoped 的 `@scope/name`）必须出现在 `dependencies` / `optionalDependencies` / `peerDependencies` 或包自身名里。

它防的是"**幽灵依赖**"：本地 `node_modules` 恰好有这个包（别人的传递依赖），于是能 import 成功；发布后用户装不到就炸。

### 20.2.3 `check-ts-imports`：`.ts` 后缀纪律

只抓一种坏味道：**相对导入写成 `.js`**（`./foo.js`）。回顾第 1.1.3 节：本仓库源码里相对导入必须写真实存在的 `.ts`，构建时由 `rewriteRelativeImportExtensions` 改写。

### 20.2.4 `check-entry-graphs`：入口是"成本契约"

这个脚本的头部注释是一篇小论文，值得全文摘录：

```text
Entry points are cost contracts.

A package's `exports` map is the only place that says which modules are public, and one stray
`export *` can silently make a narrow entry drag an entire barrel: importing a 1-file pure
function through a barrel costs ~37 MB of evaluated module graph, and nothing fails until
someone measures a process. This walks the value-import graph of every declared entry point
and enforces a budget per entry, so that regression fails at commit time instead.

Only value imports count. `import type` / `export type` are erased before Node sees them.
```

三个要点：

1. **`exports` 是成本契约**：子路径入口（如 `./models`）承诺"小而专"；
2. **`export *` 是隐形放大器**：一个桶文件可能把整个进程的模块图拖进来；
3. **预算逐入口写死**（源码 `BUDGETS`），例如 `packages/ai` 的 `./models`：`maxFiles: 15`，且禁止触达 `providers/`、`models.generated.ts`、`index.ts` 等——**防止"改一行 import 让冷启动变重"**。

这解释了为什么本仓库反复强调"`import type` 不算成本"（第 1.2.2 节）：类型在运行时被擦除。

### 20.2.5 `check:install-lock:coding-agent`：独立安装的免脚本承诺

`packages/coding-agent/install-lock/` 是一份"安装锁"：记录独立安装（不跑生命周期脚本）时全部依赖与完整性。`generate-coding-agent-install-lock.mjs --check` 验证它与当前依赖图一致；更新方式：

```bash
node scripts/generate-coding-agent-install-lock.mjs          # 重新生成
node scripts/generate-coding-agent-install-lock.mjs --check  # 验证
```

规则（`AGENTS.md`）：**新增带生命周期脚本的依赖需要审查，并且必须在该脚本里显式加白名单——不许悄悄加**。

## 20.3 编码规范清单（来自 `AGENTS.md`，逐条给你"为什么"）

| 规则 | 为什么 |
|---|---|
| 用**可擦除 TS 语法**（无 `enum`/`namespace`/参数属性/`import =`） | Node 原生类型擦除（第 1.1 节） |
| **顶层导入**，禁止 inline/dynamic import | 依赖图可静态分析（entry-graphs 预算依赖它） |
| 类型导入一律 `import type` | 运行时零成本、语义清晰（第 1.2.2 节） |
| 相对导入写 `.ts` 后缀 | 源码直接跑（第 1.1.3 节） |
| 不用 `any`（除非必要） | 类型安全；边界用 `unknown` + 收窄 |
| 改动前**完整读文件**；广泛改动前读完相关文件 | 避免基于搜索片段的错误结论 |
| 单调用点的小 helper 内联掉 | 减少无谓抽象 |
| 查外部 API 类型要看 `node_modules`，别猜 | 防止拍脑袋的错误用法 |
| `packages/coding-agent` 内解析资源必须用 `src/config.ts` 的 helper | 源码运行/安装/独立二进制三种布局不同（本章 20.2 的"成本契约"同理：路径也是契约） |
| 快捷键加入默认键位表，不硬编码按键判断 | 保持可配置（第 17.9 节） |
| **不手改** `packages/ai/src/models.generated.ts` | 生成文件；改 `generate-models.ts` 后重新生成（含再生成带来的无关 diff 是允许的） |
| 不主动做"向后兼容"（除非用户要求） | 避免无需求的复杂度 |
| 疑似有意为之的功能要**先问再删** | 尊重既有设计 |
| 改完代码跑 `npm run check`（完整输出） | 质量门（20.1） |
| 不主动跑 `npm run build` / `npm test`（除用户要求） | 避免误触 e2e/长构建；用 `./test.sh` |
| 测试遵循 `AGENTS.md` 的运行方式（suite/harness/faux） | CI 安全（第 18 章） |
| 临时脚本写到 `/tmp` 再跑，用完删除 | 不污染仓库 |

这些规则的共同点：**每一条都对应一种在真实维护中踩过的坑**。读它们时想"不这么做会怎样"，比背条文有用。

## 20.4 依赖与安装安全：把"装包"当成代码评审

`AGENTS.md` 的 "Dependency and Install Security" 一节（加上 `README` 与脚本）可以整理成五条：

1. **直接外部依赖钉精确版本**（20.2.1 的机器检查）；lockfile 与依赖改动**按代码评审对待**；
2. **默认 `--ignore-scripts`**：

```bash
npm install --ignore-scripts    # 日常补充
npm ci --ignore-scripts         # 干净/CI 复现
```

   生命周期脚本是供应链攻击常见载体；除非用户明确要求，不跑；

3. **lockfile 的刷新姿势**：依赖元数据变了用

```bash
npm install --package-lock-only --ignore-scripts
```

   **pre-commit 会拦截 lockfile 提交**，除非设置 `PI_ALLOW_LOCKFILE_CHANGE=1`——不要为"顺手提交"绕过它（除非用户就是要提交这个变更）；

4. **`undici` 的特殊规则**：升级 `undici` 前**必须**读目标版本的 changelog/发行说明，评估对功能的影响，再更新；
5. **install-lock 与白名单**（20.2.5）：新增带 lifecycle 脚本的依赖要走显式审查。
## 20.5 Git 规程：这个工作区可能同时有多个"你"

`AGENTS.md` 开头就写明了一个特殊前提：**可能同时有多个 pi 会话在同一个工作目录里改不同文件**。因此 Git 操作有一条红线：

```text
Git operations that touch unstaged, staged, or untracked files outside your own changes
will stomp on other sessions' work.
```

### 20.5.1 提交纪律（只在用户要求时才提交）

| 规则 | 做法 |
|---|---|
| 只提交**本次会话你改的文件** | 提交前 `git status` 核对；`packages/ai/src/models.generated.ts` 可随你的文件一并包含 |
| **显式路径**暂存 | `git add <path1> <path2>`；**禁止** `git add -A` / `git add .` |
| 提交信息格式 | `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: <说明>`（可多行；信息要具体、简短） |

### 20.5.2 禁止清单（会破坏别人工作的命令）

```text
git reset --hard
git checkout .
git clean -fd
git stash
git add -A / git add .
git commit --no-verify
```

遇到 rebase 冲突：**只解决你改过的文件**；如果冲突出现在你没动过的文件里——**中止并询问用户**（不要自作主张）。永远不要 force push。

### 20.5.3 评审 PR 时的纪律

- **不要** `gh pr checkout`、`git switch` 或把工作区切到 PR 分支（除非用户明确要求）；
- 用 `gh pr view`、`gh pr diff`、`gh api`，加上本地 `git show`/`git diff` 对已抓取的 ref 做检查；
- 需要 PR 文件内容时：抓到临时文件，或 `git show <ref>:<path>`——**不切分支**。

这套纪律的核心是：**工作区是共享资源，任何"清理式"操作都可能删除他人的未保存成果。**

## 20.6 Changelog：条目写给"升级的人"看

位置：`packages/*/CHANGELOG.md`（每包一份）。规则（`AGENTS.md`）：

- 所有新条目进 `## [Unreleased]`；子标题固定为 `### Breaking Changes`、`### Added`、`### Changed`、`### Fixed`、`### Removed`；
- **先读完整的 Unreleased 段**，追加到已有小节；**绝不重复创建同名小节**；
- **已发布版本段不可变**（`## [0.12.2]` 之类永远不改）；
- 在非 `main` 分支或 PR 上工作时**不创建** changelog 条目。

归因格式：

```markdown
Fixed foo bar ([#123](https://github.com/earendil-works/pi/issues/123))
Added feature X ([#456](https://github.com/earendil-works/pi/pull/456) by [@username](https://github.com/username))
```

- 内部（来自 issue）：用 issue 链接；
- 外部贡献：用 PR 链接 + 作者署名。

与 `CONTRIBUTING.md` 的关系要分清：**外部贡献者的 PR 不要改 CHANGELOG**（"Changelog entries are added by maintainers"）；`AGENTS.md` 的 changelog 规则是给在 `main` 上工作的维护者/本仓库用户用的。两者不矛盾——**以你当前的角色为准**。

## 20.7 上游贡献准入：`CONTRIBUTING.md` 的六个要点

1. **核心要小**：不属于核心的功能应该做成扩展；"让核心变胖"的 PR 会被拒。甚至**扩展钩子点**也要先讨论——避免不可维护的交互复杂度；
2. **唯一铁律**："**You must understand your code.**"——用 AI 写代码没问题，**提交自己不理解的东西**不行；用 agent 时要从 pi 根目录启动（自动读取 `AGENTS.md`）；
3. **贡献闸门**：新贡献者的 issue 与 PR **默认自动关闭**；周五到周日的 issue 不保证被审；维护者每天复查自动关闭的 issue，把值得的重新打开；
4. **批准机制**：维护者在回复中用命令位置的关键词批准——`lgtmi`（以后 issue 不自动关）、`lgtm`（issue 与 PR 都不自动关）。命令要在回复的**开头**（可前缀 @用户名）或**结尾**；**`lgtmi` 只给 issue 权，PR 必须 `lgtm`**；
5. **issue 质量门槛**：必须用两个官方模板之一；**一屏以内**；用自己的话写（不要 LLM 代写；如果必须，跟一条明确标注 AI 的补充评论）；说清问题、为什么重要；如果你想自己实现，说出来；
6. **滥用后果**：两次无视该文档、或用 agent 批量灌 issue——**永久拉黑**。提交 PR 前必须已有 `lgtm`，且 `npm run check` 与 `./test.sh` **双通过**；新供应商要按 `AGENTS.md` 补测试。

FAQ 里最有意思的一条是"为什么不让人工智能分流一切"：AI 可以帮忙分组、摘要、找缺失信息，但**最终决定权在人类维护者**——"打磨过的 AI 生成 issue 仍然可能是错的、误导的、昂贵的"。

大改动走 RFC：`rfc.earendil.com/keyword/pi/`。

## 20.8 issue / PR 操作规范（写给用 agent 操作的你）

`AGENTS.md` 的 "Issues and PRs" 一节（已在第 19 章用过一部分）：

| 场景 | 规范 |
|---|---|
| 建 issue | 加 `pkg:*` 标签（`pkg:agent`、`pkg:ai`、`pkg:coding-agent`、`pkg:tui`），适用就都加 |
| 发评论 | 先写进**临时文件**，再 `gh issue/pr comment --body-file`；**不要**用 `--body` 传多行 markdown；语气简洁、技术化；结尾附上来源提示指定的 AI 声明行（如 `This comment is AI-generated by ...`） |
| 用提交关 issue | 消息里写 `fixes #N` / `closes #N`；**多个 issue 要逐个重复关键词**（`closes #1, closes #2`）——共享关键词只关第一个 |
| 评审 PR | 不切分支（20.5.3）；用 `gh` 与 `git show` 检查 |

这些规则和 20.5 的 Git 纪律合在一起，构成"**在共享仓库里安全协作**"的完整动作集。

## 20.9 实验 L12-C：一次"可评审改动"的完整演练

**实验性质**：本地实操（不提交；除非用户明确要求）。
**验证状态**：设计中。它是 L12 的收尾：把 18-20 章的能力合成一次完整流程。

### 步骤

1. **选题**：一个小而真实的改动。建议候选：
   - 给一个新动作补默认键位（第 17.9.4 节的流程；改 `packages/coding-agent/src/core/keybindings.ts` 与（如需）`packages/tui` 的键位表）；
   - 修一处文档与实现不一致（改 `docs/*.md`，纯文档改动不触发构建要求）；
   - 给某工具补一个**错误路径**的测试（第 18 章）。
2. **读全**：把要改的文件完整读一遍（规则要求）；
3. **最小实现**：只改必要范围；
4. **验证**：

```bash
# 相关测试（按第 18 章的方式单跑）
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run test/<你的测试>.test.ts
# 质量门（完整输出）
npm run check
```

5. **审查 check 的副作用**：`git diff` 里逐块确认——有没有被 biome 格式化出的无关变更？
6. **写变更说明草稿**（模拟 PR 描述）：

```markdown
### 问题
（用户/开发者能观察到的现象或缺口）

### 行为变化
（改动后"什么变了"；明确"什么没变"）

### 测试证据
（跑了哪个测试、结果；check 通过的结论）

### 影响边界
（哪些包/入口受影响；是否触及 exports/入口成本；兼容性说明）
```

7. （可选）按格式预写 commit message（**不执行**）：`feat(coding-agent): ...`。

### 判定标准

- `npm run check` 通过，且你能指出它改了哪些文件；
- `git status` 只包含你的改动；
- 变更说明第一段就能让评审者判断"该不该合并"。

### 清理

若本实验是练习而非真实任务：还原所有改动，保持工作区干净。

## 20.10 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| check 之后 diff 里全是格式噪音 | 没审查 `--write` 的副作用 | 先跑 check 再决定改动；把格式化单独处理 |
| 依赖检查失败 | 写了 `^1.2.3` 或用了未声明的包 | 改精确版本；把缺失依赖加进对应 section |
| `check:ts-imports` 失败 | 相对导入写了 `.js` | 改成 `.ts`（第 1.1.3 节） |
| `check:entry-graphs` 失败 | 入口新增了重依赖（`export *` 牵连） | 拆子路径/用 `import type`/调整导出 |
| lockfile 被 pre-commit 拦下 | 未设置允许变更 | 确认用户是否真的要提交 lockfile；不要擅自绕过 |
| 提交里混入他人文件 | 用了 `git add -A` | 还原暂存，改按显式路径 |
| PR 被 auto-close | 未获 `lgtm` 或未过质量门槛 | 按 `CONTRIBUTING.md` 先过 issue 流程 |
| CI 上才挂 | 本地没跑 `./test.sh`/`npm run check` | PR 前双跑（CONTRIBUTING 明文要求） |
| 在 PR 分支上工作 | 违反了"不动工作区"纪律 | 用 `gh pr view/diff/api` + `git show`（20.5.3） |

## 20.11 验收题

1. 写出 `npm run check` 的八个步骤；哪一步会改写文件？为什么要审 diff？
2. 五个检查脚本各自防什么？（用一句话概括，并说出对应的"慢性病"）
3. 为什么直接依赖要精确版本？`undici` 有什么额外要求？
4. lockfile 的正确刷新命令与提交限制？
5. 本仓库的 commit message 格式？为什么要"显式路径"暂存？
6. `lgtmi` 与 `lgtm` 的区别与命令位置要求？
7. new contributor 的 PR 前提与双通过命令是什么？

### 参考答案（要点）

1. biome --write → pinned-deps → runtime-deps → ts-imports → entry-graphs → install-lock → tsc → browser-smoke；第 1 步自动改写；因为格式/自动修复可能带来无关 diff。
2. pinned-deps：可复现安装（防版本漂移）；runtime-deps：幽灵依赖；ts-imports：相对导入后缀纪律；entry-graphs：入口模块图膨胀；install-lock：独立安装免脚本的一致性与白名单。
3. 浮动版本导致不可复现与隐性升级；undici 升级前必须读 changelog/发行说明并评估影响。
4. `npm install --package-lock-only --ignore-scripts`；pre-commit 默认拦截，除非 `PI_ALLOW_LOCKFILE_CHANGE=1`（需用户明确要提交）。
5. `{feat,fix,docs}[(ai,tui,agent,coding-agent)]: ...`；共享工作区里显式路径才能保证不碰别人的暂存/未暂存改动。
6. `lgtmi` 只放行 issue；`lgtm` 放行 issue 与 PR；命令需在回复开头（可带 @前缀）或结尾。
7. 先获得维护者的 `lgtm`；PR 前 `npm run check` 与 `./test.sh` 都必须通过（且外部 PR 不改 CHANGELOG）。

## 20.12 来源与下一章

- `AGENTS.md`（开发规则、命令、依赖安全、Git、Issue/PR、Changelog、发布）；
- `CONTRIBUTING.md`（核心最小化、One Rule、贡献闸门、质量门槛、PR 前提、FAQ）；
- `package.json`（`check` 及子脚本）、`scripts/check-pinned-deps.mjs`、`check-runtime-deps.mjs`、`check-ts-relative-imports.mjs`、`check-entry-graphs.mjs`、`generate-coding-agent-install-lock.mjs`；
- `.husky`（pre-commit 行为）与根 `test.sh`（第 2、18 章）。

下一章是毕业项目：把 0-20 章的所有能力合成一个"你能独立解释、独立定位、独立验证"的小改动——并给出四个候选课题与验收标准。