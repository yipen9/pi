# 第 12 章：选择最小合适的扩展机制

> 学完本章你能回答：
>
> 1. 给 pi 加能力有哪几种机制？从"最轻"到"最重"怎么排序？
> 2. 上下文指令、Prompt Template、Skill、Extension、主题、Pi package 各自解决什么问题？
> 3. 一个具体需求该选哪一种？判断标准是什么？
> 4. 这些机制的文件放哪里、什么时候被发现、要不要项目信任？

**前置知识**：第 11 章（配置与信任）、第 7 章（工具是什么）。
**预计学习时间**：1 天（重实践：每个机制都动手试一次）。
**本章验证状态**：静态核对通过（对照 `quickstart.md`、`prompt-templates.md`、`skills.md`、`extensions.md`、`packages.md`）；实验为本地操作。

---

## 12.1 核心原则：从最轻的机制开始

`quickstart.md` 里有一张 "Choose how to customize Pi" 表，它就是这个原则的官方版本：

| 需求 | 先用什么 |
|---|---|
| 给某个文件夹设定长期生效的指令 | `AGENTS.md`（上下文文件） |
| 复用一段提示词 | Prompt Template |
| 添加"某类任务"的专项指令与配套文件 | Skill |
| 加可执行工具、命令或事件处理器 | Extension |
| 构建自定义终端组件 | Terminal UI（扩展的一部分，第 17 章） |
| 接入不支持的模型服务 | Custom Provider（第 5、13 章） |
| 安装/分发多个资源 | Pi package |

为什么强调"最轻"？因为每往上一级，代价都在增加：

```text
指令 < 模板 < 技能 < 扩展 < 内核修改
轻 ──────────────────────────────────────→ 重
影响面小                                 影响面大
无代码                                   可执行代码（进程权限）
易改易删                                 需要测试与评审
```

**"能用指令解决的，别写代码；能用模板解决的，别做技能；能用技能解决的，别写扩展；能写扩展解决的，别改内核。"** 这条链是本章的骨架，也是毕业项目选题（第 21 章）的判断标准。

### 12.1.1 决策树

```mermaid
flowchart TD
  N[需求] --> Q1{需要模型"自己决定何时执行"吗?}
  Q1 -->|否，一段文本就够| A1[AGENTS.md 指令]
  Q1 -->|是我手动触发的一段提示| A2[Prompt Template]
  Q1 -->|否，但需要配套文件/多步流程说明| A3[Skill]
  Q1 -->|是，需要执行代码| Q2{需要读/写外部系统或拦截事件吗?}
  Q2 -->|是| A4[Extension]
  Q2 -->|只是换配色| A5[Theme]
  N --> Q3{要分发给别人/多个资源成套?}
  Q3 -->|是| A6[Pi package（打包上述任一）]
```

## 12.2 六种机制总览

| 机制 | 形态 | 能执行代码？ | 发现位置（用户/项目） | 信任要求 | 生效时机 |
|---|---|---|---|---|---|
| 上下文指令 | Markdown 文本 | 否 | `~/.pi/agent/AGENTS.md` 等；项目 `<dir>/AGENTS.md`（各级祖先） | **不要求** | 启动/`/reload`；每次请求进系统提示 |
| Prompt Template | Markdown（frontmatter） | 否 | `~/.pi/agent/prompts/`；`<项目>/.pi/prompts/` | 项目模板需信任 | `/reload` 或重启 |
| Skill | 目录 + `SKILL.md` | 否（但可指导模型执行脚本） | `~/.pi/agent/skills/`、`~/.agents/skills/`、项目 `.pi/skills/`、`.agents/skills/` | 项目技能需信任 | 名称进提示词；正文按需加载 |
| Extension | TypeScript/JS 模块 | **是**（进程权限） | `~/.pi/agent/extensions/`、`<项目>/.pi/extensions/`、CLI `--extension` | 项目扩展需信任 | 启动时加载 factory |
| Theme | JSON | 否 | `~/.pi/agent/themes/`、项目 `.pi/themes/` | 项目主题需信任 | 主题初始化/`/reload` |
| Pi package | npm/git/本地包 | 视内容而定 | 由设置声明 | 项目声明需信任 | `pi install` 后加载 |

注意几个反直觉点：

- **上下文指令不要求信任**：它是文本不是代码——但正因如此，它也是提示注入的载体（第 11 章的安全提醒）；
- **Skill 可以"有脚本"但不执行脚本**：脚本只有被模型（或你）通过工具调用时才会跑；Skill 本身只是"给模型的说明书 + 附带文件"；
- **Extension 是唯一"加载即执行"的机制**：所以它也是信任机制存在的理由。

## 12.3 逐机制精讲

### 12.3.1 上下文指令：文件夹里的"长期原则"

**是什么**：放在 agent 目录或工作目录（及其祖先）里的 Markdown 指令文件，每次请求都会进入系统提示的 `project_context` 分节（第 10 章）。

**文件与优先级**（`configuration.md`）：

```text
<agent-dir>/AGENTS.override.md > AGENTS.md > AGENTS.MD > CLAUDE.md > CLAUDE.MD
（每个目录内只取第一个命中；AGENTS.override.md 只替换同目录的其它候选）
```

发现范围：agent 目录 + 工作目录 + 各级祖先目录；祖先在前、当前在后（第 11.4.2 节）。

**与其它的区别**：它没有 frontmatter、没有命令、没有按需加载——**每次请求都在**。所以：

- 适合：编码规范、项目约定、常用命令、目录结构说明；
- 不适合：长流程（放 Skill）、偶尔才用的知识（放 Skill）、需要参数化的文本（放模板）。

**写法建议**（结合第 10 章的渲染方式）：

- 它是被包进 `<project_instructions path="...">` 的文本——**写得像给新同事的交接文档**：短句、可执行、有例子；
- 目录层级会累加：根目录放"全仓库通用"，子目录放"本模块特有"；
- 修改后 `/reload`（或重启）才生效。

### 12.3.2 Prompt Template：一个人人可用的"快捷键提示词"

**是什么**：一个 Markdown 文件变成 `/命令`。适合"我经常要说同一段话，只是参数不同"。

**创建**（`prompt-templates.md` 的原例）：

```markdown
---
description: Review staged git changes
argument-hint: "[focus]"
---
Review the staged changes. Focus on ${1:-correctness, security, and error handling}.
```

放到 `~/.pi/agent/prompts/review.md` 后即成为 `/review`；`description` 显示在补全菜单（省略时取第一行非空文本）。

**替换语法**：

| 语法 | 结果 |
|---|---|
| `$1`、`$2`… | 第 N 个位置参数 |
| `$@` / `$ARGUMENTS` | 全部参数（空格连接） |
| `${1:-default}` | 第一个参数，缺省则用默认值 |
| `${@:-default}` | 全部参数或默认值 |
| `${@:N}` | 从第 N 个开始的参数 |
| `${@:N:L}` | 从第 N 个开始的 L 个参数 |

参数遵循类 shell 的引号规则：`/review "API compatibility"` 是一个含空格的参数。

**展开时机**（读代码时的顺序）：

```text
编辑器输入 "/review xxx"
  → 扩展的 input 事件先看到"原始输入"（可拦截/改写）
    → 模板展开（skill 命令同层）
      → 结果作为用户消息进入 Agent（第 3 章的 prompt 流程）
```

`prompt-templates.md` 原文："Extensions receive the raw input first through the `input` event unless an extension command with the same name handles it."——**扩展命令 > 模板展开**的优先级要记住。

**位置**：用户/项目的 `prompts/` 目录（只加载**直接子文件** `.md`；嵌套文件要靠设置或 Pi package 声明）。项目模板**需要信任**。改完 `/reload`。

### 12.3.3 Skill：按需加载的"专项说明书"

**是什么**：一个目录 + `SKILL.md`，可以带脚本、参考资料、资产。pi 把"名称 + 描述 + 路径"放进系统提示；**只有任务匹配时，模型才去读 `SKILL.md` 全文**。

**创建**（`skills.md` 原例）：

```text
pdf-tools/
├── SKILL.md
├── scripts/extract.sh
├── references/formats.md
└── assets/template.json
```

```markdown
---
name: pdf-tools
description: Extract text and tables from PDF files. Use when reading, converting, or inspecting PDFs.
---

# PDF tools

Read `references/formats.md` before converting a document. Run scripts relative to this skill directory.
```

**描述怎么写**（决定模型能否"路由"到它）：

- 说清**做什么 + 什么时候用**；
- 反例："Helps with PDFs."（信息不足）；
- 正例见上（动作 + 触发场景都有）。

**加载机制**（源码层面的三步）：

1. 启动扫描：每个技能取 `name/description/path` → 系统提示的 `skills` 分节（第 10 章 `formatSkillsForPrompt`）；
2. 任务匹配：模型读 `SKILL.md`（通过 read 工具）并照做；
3. 强制加载：`/skill:命令名 参数`——参数会作为用户请求追加到加载的指令后。

失败模式：模型可能"没想到"该用某个技能——这是设计取舍（省 token vs 保证加载）；需要确定性时用 `/skill:name`；也可以设置 `disable-model-invocation: true` 让它**只能**被显式命令触发。

**frontmatter 字段**（Agent Skills 规范，`skills.md` 表格）：

| 字段 | 用途 |
|---|---|
| `name` | 命令名与显示名（小写字母/数字/连字符；≤64 字符；无首尾/连续连字符） |
| `description` | 给模型的路由描述（≤1024 字符） |
| `license` | 许可证 |
| `compatibility` | 环境要求 |
| `metadata` | 附加键值 |
| `allowed-tools` | 实验性预批准工具清单 |
| `disable-model-invocation` | 禁止模型自动触发 |

**位置与规则**：

- `~/.pi/agent/skills/`、`~/.agents/skills/`、项目 `.pi/skills/`、项目 `.agents/skills/`（后者从工作目录向上到仓库根）；
- 含 `SKILL.md` 的目录递归发现；也接受个别独立 Markdown，但"目录 + SKILL.md"是**可移植形态**；
- 语法坏的 `SKILL.md` 与无描述的技能**不加载**；重名保留先发现的并告警（诊断里查）；
- 项目技能可以指导模型运行脚本——**给信任前先审查内容**；
- 改完 `/reload`。

**与模板的分界**：模板是"一段话"；技能是"一套流程 + 附带文件 + 按需加载"。当提示词超过一屏、或需要引用脚本/参考文档时，升级为技能。

### 12.3.4 Extension：唯一能"执行"的机制

**是什么**：TypeScript 模块，导出默认工厂函数，接收 `ExtensionAPI`：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("hello", {
		description: "Show a greeting",
		handler: async (name, ctx) => {
			ctx.ui.notify(`Hello, ${name || "world"}!`, "info");
		},
	});
}
```

**能力清单**（`extensions.md` 的集成点表，读全它）：

| 能力 | 主要 API |
|---|---|
| 观察/修改生命周期行为 | `pi.on()` |
| 增加模型可调用的操作 | `pi.registerTool()` |
| 增加 `/` 命令 | `pi.registerCommand()` |
| 快捷键 / CLI flag | `pi.registerShortcut()` / `pi.registerFlag()` |
| 发送用户消息 / 自定义消息 | `pi.sendUserMessage()` / `pi.sendMessage()` |
| 持久化非上下文数据 | `pi.appendEntry()` |
| 改工具集/模型/思考级别 | `pi` 上的会话控制方法 |
| 注册模型供应商 | `pi.registerProvider()` |
| 注册 MCP 服务器 | `pi.registerMcpServer()` |
| 按请求路由到模型 | `pi.registerVirtualModel()` |
| 终端渲染 | renderer + `ctx.ui` |
| 扩展之间通信 | `pi.events` |

**生命周期规则**（原文照抄，极其重要）：

```text
Do not start processes, sockets, watchers, or timers in the factory because some invocations
load extensions without starting a session.
Start long-lived resources from `session_start` or from the command or tool that needs them.
Close session-scoped resources from an idempotent `session_shutdown` handler.
```

翻译：**工厂函数只做"注册"**；重资源在 `session_start`（或用到时）创建；`session_shutdown` 里幂等地清理。否则 `--version` 这类"只加载不建会话"的调用会白白启动一堆进程。

另外两条：

- `ctx.reload()` 会**替换整个扩展运行时**——reload 之后的代码不能再碰旧运行时的状态；
- 只有**用户级与 CLI 显式加载**的扩展能参与 `project_trust` 事件（第 11.4.3 节的"先加载一部分"就是它们）。

**位置**：用户/项目的 `extensions/` 目录（直接文件或含 `index.ts` 的子目录）；开发时用 `pi --extension ./hello.ts` 直接加载（基于 `jiti`，本地 TS 无需编译）。项目的扩展**需要信任**。

（第 13 章系统讲 Extension API 与事件；第 14 章讲工具型扩展与打包。）

### 12.3.5 主题：限定范围的定制

JSON 主题文件放在用户/项目的 `themes/` 目录，控制终端配色（`themes.md`，第 17 章细读）。`quickstart` 把它与 TUI 组件分开列：换配色=主题；改**组件结构**=扩展里的渲染器/TUI 能力。

### 12.3.6 Pi package：分发单元

**是什么**：一个普通目录或 npm 包，按约定目录或 `pi` manifest 暴露资源：

```text
my-pi-package/
├── package.json
├── extensions/
├── skills/
├── prompts/
└── themes/
```

```json
{
  "name": "my-pi-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./src/extension.ts"],
    "skills": ["./resources/skills"],
    "prompts": ["./resources/prompts/*.md"],
    "themes": ["./resources/themes/*.json"]
  }
}
```

**安装与管理**：

```bash
pi install npm:@example/pi-tools@1.0.0
pi install git:github.com/example/pi-tools@v1
pi install ./local-package
pi list
pi remove <source>
pi update --extensions
```

`--local`/`-l` 写入项目 `.pi/settings.json`（未信任不读）；`-e`/`--extension` 单次试用不写设置。

**依赖规则**（`packages.md` 的硬要求）：

- 扩展 import 的运行时依赖放 `dependencies`；
- **host 提供的包**（`@earendil-works/pi-ai`、`pi-agent-core`、`pi-coding-agent`、`pi-tui`、`typebox`）放 `peerDependencies`（`"*"`）且**不要打包**——打包会造成重复的类/注册表实例；
- 版本固定的 npm 规格、git tag/commit 会被"钉住"，更新只重放不改 ref。

**过滤与身份**：设置里可用对象形式筛选资源（`[]` 全不加载、`!pattern` 排除、`+path`/`-path` 精确增删）；同一包在个人与项目设置同时出现时，项目条目通常整体替换个人条目（`autoload: false` 时变成"过滤增量"）；身份识别分别用包名/仓库 URL（不含 ref）/绝对路径——**防止同一个包被加载两次**。
## 12.4 五个需求，五次选择

练习方式：先自己想"用哪个"，再看答案与理由。核心不是背结论，而是**判断"是否需要执行 / 是否需要按需 / 是否需要分发"**。

### 需求 1：团队要求"代码评审按固定格式输出"

**选择：Prompt Template**。理由：

- 需求本质是一段**参数化的固定文本**（标题结构、检查项、输出格式）；
- 没有执行逻辑、没有外部系统、不需要模型自动触发（人来发 `/review`）；
- 放 `prompts/review.md`，全团队各自安装或随项目模板分发即可。

**为什么不用更重的**：写扩展=为一段文本付出可执行代码的信任与维护成本；做 Skill=它的价值在按需加载长内容，这里文本很短、每次都用。

### 需求 2："给仓库加一套'发布前检查'的完整流程（含脚本、清单、参考文档）"

**选择：Skill**。理由：

- 内容是**一套多步流程 + 配套文件**（`scripts/check.sh`、`references/checklist.md`）；
- 只在"发布"场景用——按需加载正合适（平时不占上下文）；
- 描述里写清"什么时候用"，模型能自动路由；也可以 `/skill:release-check` 强制触发。

**为什么不用更重的**：脚本由模型用 bash/read 执行，Skill 本身**不需要**是扩展；写扩展会把"说明书"和"执行逻辑"耦合，且失去按需加载的优势。

### 需求 3："读取内部工单系统，提供一个查询工具"

**选择：Extension**。理由：

- 需要**执行代码**（HTTP 调用内部系统）、**注册工具**（`pi.registerTool()`）、处理凭据与错误；
- 可能还要缓存、限流、进度上报——这些都是扩展的领域。

**为什么必须更重**：模板/技能只能"指导模型去做"，而"做一个新工具"是能力扩展，只有扩展 API 能完成（第 14 章实战）。

### 需求 4："把配色换成公司品牌色"

**选择：Theme**。理由：纯 JSON 数据，改颜色不碰逻辑。

**为什么不用扩展**：除非要**自定义组件结构**（那是 TUI 渲染器，属于扩展能力），单改配色用主题最合适；主题还能进 package 一起分发。

### 需求 5："把需求 1 和 2 打包分享给全公司"

**选择：Pi package**。理由：

- 分发是独立关注点：`npm`/`git` 安装、版本钉住、资源过滤、依赖规则；
- 一个 package 可以同时含 prompts + skills（+ extensions/themes）；
- 推送更新后，同事 `pi update --extensions` 即可。

### 12.4.1 反例集：常见"过度设计"

| 需求 | 常见错误选择 | 更轻的正确答案 | 教训 |
|---|---|---|---|
| 统一回答语气 | 写扩展改提示词 | AGENTS.md 里一句话 | 文本能解决的别写代码 |
| 固定格式的日报 | 写工具 | Prompt Template | 工具是给模型"能力"，不是给模板"文本" |
| 偶尔用的长检查清单 | 每次都塞进 AGENTS.md | Skill | 长内容按需加载，别占常规上下文 |
| 换配色 | 改内核渲染代码 | Theme | 数据问题用数据解决 |
| 单人用一个扩展 | 直接发 npm 包 | `--extension ./my.ts` 或放本地目录 | 分发是最后一步，不是第一步 |

## 12.5 实验 L07（第二部分）：创建模板与 Skill

**实验性质**：本地操作（改你自己的配置目录）；无需模型（验证发现与展开即可）。
**验证状态**：设计中。实验与第 11 章 L07 配套，合起来覆盖"配置 + 模板/Skill 样例"。

### 步骤

1. **模板**：

```text
~/.pi/agent/prompts/check.md
---
description: Run a structured self-check
argument-hint: "<area>"
---
请对 ${1:-当前改动} 做一次自查，按以下格式输出：
1. 结论（一句话）
2. 依据（3 条以内）
3. 风险与未验证项
```

   启动 pi（源码运行），输入 `/` 看补全里是否出现 `check`；运行 `/check API 层`，观察展开文本里的 `${1:-...}` 被替换为什么。

2. **技能**：

```text
~/.pi/agent/skills/team-report/SKILL.md
---
name: team-report
description: Generate the team weekly report template. Use when the user asks for a weekly or status report.
---
# Team report
按以下小节输出：本周进展 / 风险 / 下周计划。读取 references/format.md 了解详细格式。
```

   再放一个 `references/format.md`。重启/`/reload` 后：
   - 在系统提示的 `skills` 分节里找到它（用第 10 章的方法验证：读会话文件里的系统消息，或看扩展诊断）；
   - 用 `/skill:team-report` 强制加载，观察参数如何追加。

3. **验证规则**：故意把 `description` 删掉，重启后确认它**不被加载**（并出现在诊断里）——这就是 12.3.3 的"无描述不加载"。

### 观察与思考

- 模板展开发生在扩展 `input` 事件**之后**还是之前？用第 13 章的日志扩展验证（TEMPLATE 先记下这个问题）；
- Skill 的 `description` 出现在系统提示的哪个 section？`name` 与目录名不一致会怎样（本仓库不告警，别的实现可能要求一致）？

### 清理

删除两个实验资源，`/reload`；确认不再出现在命令列表与提示里。

## 12.6 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 模板在补全里不出现 | 放错目录 / 非直接子文件 `.md` / 项目未信任 | 对照 12.3.2 的位置与信任规则；`/reload` |
| `/review` 被扩展命令抢走 | 扩展命令优先于模板 | 改名或检查扩展；见 `prompt-templates.md` 的顺序说明 |
| Skill 不触发 | description 太模糊 / 被模型忽略 | 改写 description"做什么+何时用"；或 `/skill:name` 强制 |
| Skill 改了没反应 | 没 `/reload` | 重载后重新验证 |
| 项目资源全都不生效 | 未信任项目 | `/trust` 或 `--approve`（第 11 章） |
| 扩展"启动就崩"或拖慢启动 | 在 factory 里起了长驻资源 | 移到 `session_start`；工厂只注册 |
| 打包后类实例重复/报重复注册 | 把 host 提供的包打进了 dependencies | 改为 `peerDependencies`（12.3.6） |
| 同一个包被加载两次 | 用了不同来源声明同一包 | 用 `pi list` 检查；按包名/URL/路径的身份规则理解 |

## 12.7 验收题

1. 按"最轻到最重"排出六种机制，并各用一句话说明它们的适用边界。
2. 什么机制**不需要**项目信任？为什么？它带来的风险是什么？
3. 模板展开与扩展命令的优先级？从代码流程角度说明为什么。
4. 给出三个需求，分别选模板、技能、扩展，并说明"更重的方案为什么没必要"。
5. Pi package 为什么要求 host 提供的包放 `peerDependencies` 且不能打包？
6. Skill 的"两段式加载"是什么？它省了什么、放弃了什么？

### 参考答案（要点）

1. 指令（长期文本）< 模板（参数化提示）< 技能（按需流程+文件）< 扩展（可执行）< 主题（数据配置，可轻可中）< package（分发容器）。准确排序可按"是否有代码/是否影响全局"讨论，只要理由成立。
2. 上下文指令（AGENTS.md 等）。它是纯文本、不执行代码，所以无需审批；风险是提示注入——内容可能影响模型行为。
3. 扩展命令优先。流程：编辑器输入 → 扩展 `input` 事件（可拦截）→ 若扩展命令同名则先执行；否则才进入模板/技能展开 → 形成用户消息。
4. 示例：统一格式输出→模板（纯文本）；发布检查流程→技能（按需+文件，无需代码）；内部工单查询工具→扩展（需要执行+注册工具）。更重的方案各自引入信任/维护/耦合成本。
5. 打包会造成多个副本：类身份、注册表、初始化都会重复；宿主模块映射失效（`packages.md` 明确警告并会报扩展警告）。
6. 启动只把 name/description/path 放进系统提示；任务匹配时才加载全文。省 token/上下文；放弃的是"保证模型一定会加载"（因此有 `/skill:name` 强制通道）。

## 12.8 来源与下一章

- `packages/coding-agent/docs/quickstart.md`（"Choose how to customize Pi" 表）、`docs/prompt-templates.md`、`docs/skills.md`、`docs/extensions.md`、`docs/packages.md`、`docs/themes.md`、`docs/configuration.md`；
- `packages/coding-agent/src/core/skills.ts`（`formatSkillsForPrompt`）、`core/prompt-templates.ts`（`expandPromptTemplate`）、`core/resource-loader.ts`（发现与诊断）。

下一章进入 Extension 的世界：类型与契约、加载过程、事件钩子、状态与重载——你会写第一个真正"能执行"的扩展。