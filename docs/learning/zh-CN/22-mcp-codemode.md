# 第 22 章：MCP 与 Codemode（选修）

> 学完本章你能回答：
>
> 1. MCP 的配置放在哪、怎么连接、失败怎么排查？
> 2. `mcp__<server>__<tool>` 的命名规则与三种暴露方式（codemode / deferred / direct）是什么？
> 3. Codemode 是什么？脚本能做什么、不能做什么？
> 4. "脚本沙箱"的边界在哪——为什么它不能被笼统地称为"完整安全沙箱"？
> 5. 两者组合能解决什么问题？（大量工具、结果过滤、并行调用）

**前置知识**：第 5 章（工具形态）、第 7 章（工具流水线）、第 13-14 章（扩展与工具）。
**预计学习时间**：1.5 天（选修）。
**本章验证状态**：静态核对通过（`packages/mcp/README.md`、`packages/codemode/README.md`、`docs/mcp.md`、`docs/codemode.md` 逐项核对）；实验 L13 设计中。

---

## 22.1 两个独立包，一个组合故事

| 包 | 是什么 | 依赖 |
|---|---|---|
| `packages/mcp` | 一个**独立的 MCP 客户端**：传输无关的 client core + stdio/HTTP 传输 + 内存测试传输；**不依赖官方 MCP SDK，也不依赖其他 pi 包** | 无 pi 依赖 |
| `packages/codemode` | 一个**代码执行沙箱**：让模型写 JavaScript 调用工具（QuickJS 编译为 wasm，跑在 worker 线程） | 无 pi 依赖 |

两者的关系由 `coding-agent` 在应用层组合：MCP 把外部服务器的工具接进来；codemode 让模型**写一段程序**去调这些工具（以及 pi 自己的工具、非 LLM 模型），只把程序输出交给模型。

为什么要有 codemode？（第 1.3 节"为什么要 harness"的延续）**当工具数量多、单个结果大时，"一个个调用再逐条阅读"又贵又慢**；写成脚本可以：并行调用、过滤/聚合结果、只返回摘要。

## 22.2 MCP：配置、连接与排查

### 22.2.1 快速使用

```bash
pi mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem .
pi mcp list          # 连接每个启用的服务器，打印状态/工具/错误；有错时退出码 1
pi
```

远程服务器：

```bash
pi mcp add docs --url https://example.com/mcp --bearer-token-env-var DOCS_TOKEN
```

`--local`/`-l` 写项目配置；交互模式里用 `/mcp` 检查连接、登录、重连、改暴露方式、启停服务器；`/reload` 应用外部改动。

### 22.2.2 配置文件与信任

- 用户级：`~/.pi/agent/mcp.json`；项目级：`.pi/mcp.json`（**需项目信任**）；
- 同名条目：**项目覆盖用户级**；
- **只写 `enabled`/`exposure`/`toolExposure` 的项目条目**是对用户级服务器的"局部覆盖"——其余字段（env/headers/auth）保留。这让你可以"只在这个项目里关掉某个用户级服务器"：

```json
{ "mcpServers": { "internal-tools": { "enabled": false } } }
```

条目格式（与主流 MCP 客户端一致）：

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "docs": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${DOCS_TOKEN}" } }
  }
}
```

要点：

- **stdio**：`command` 是**一个可执行文件**，参数放 `args`（不是 shell 字符串）；支持 `env`、`cwd`；相对 `cwd` 按会话目录解析；`~/` 前缀展开主目录；
- **HTTP**：`url` + `headers` + `oauth`；**不支持旧的 SSE 传输**（多数服务器在 `/mcp` 提供 streamable HTTP）；
- 两种都支持：`timeout`（秒，默认 60，进度通知会重置它）、`enabled: false`、`exposure`/`toolExposure`、`description`（会进系统提示、用于工具搜索排序与 `describeNamespace()`）；
- 值支持环境变量 `${VAR}`；也支持 `!command` **整值命令**（如 `"Authorization": "!echo Bearer $(gh auth token)"`）；
- **无效条目不阻塞其他服务器**（报告并跳过）。

### 22.2.3 命名与冲突规则

- 服务器名只允许字母、数字、`_`、`-`；
- 工具命名为 `mcp__<server>__<tool>`；非法字符替换为 `_`；替换后仍冲突的工具加**哈希后缀**；
- 名字仅差 `-`/`_` 的服务器视为同一个（第二个会被拒绝）；`mcp.json` 的服务器覆盖扩展注册的同名服务器。

### 22.2.4 连接生命周期（读代码/排障的关键）

```text
会话启动 → 后台连接所有启用服务器（工具连上才出现）
第一次 prompt → 只对"direct 工具"最多等 10 秒（因为它们必须出现在请求里）
其他服务器 → 需要时才等：codemode 脚本等到它命名的服务器；
            searchTools()/ALL_TOOLS/tool_search/资源工具会等全部
HTTP 错误 → 408/429/5xx 重试两次；连接掉了显示 disconnected，下次调用重连
工具列表变化 → 新工具加入；被撤下的工具变为不可达
停止 stdio → 关 stdin → SIGTERM → 对进程组 SIGKILL（npx/uvx 包一层也能杀干净）
```

### 22.2.5 排查入口

| 手段 | 给出什么 |
|---|---|
| `pi mcp list` | 每个服务器的状态、工具、错误（含退出码） |
| `/mcp` | 完整连接错误 + stdio 服务器 stderr 的尾部 |
| `~/.pi/agent/mcp.log` | 服务器日志通知（`<time> [server] <level> <logger>: <message>`；5MB 轮转 `mcp.log.1`） |
| 启动报告 | 配置错误/连接失败/需要登录各报一次 |

## 22.3 三种暴露方式：工具怎么到达模型

每个服务器工具有 `exposure`（服务器级）与可覆盖的 `toolExposure`（工具级）：

| 暴露 | 行为 | 典型场景 |
|---|---|---|
| `codemode`（默认） | 可从 codemode 脚本调用；**不声明给模型、也不列进 codemode 描述**（脚本用 `searchTools()`/`describeTool()`/`ALL_TOOLS` 找） | 通用 MCP 服务器；希望脚本组合/过滤调用 |
| `deferred` | 通过 `tool_search` 匹配到后，**下一次模型调用前**加载为可直接调用的工具 | 大服务器：先发现、再直调 |
| `direct` | 像内置工具一样**直接声明**给模型，同时也能从 codemode 调用 | 小而常用的工具集 |

配套事实：

- `tool_search` 加载的工具**记录在转录里**，在该分支上保持声明；
- codemode 调用**不依赖活动工具集**（`/tree`、恢复、fork 后仍可用）；
- 想让 codemode 常驻：设置 `"defaultTools": ["+codemode"]`；想禁自动激活：`"autoEnableCodemode": false`；
- **大结果截断**：文本超过 20KB 时，模型看到的是"中间被挖掉、替换为 `…N chars truncated…`"的版本，**全文写进临时文件**并在结果里给出路径——而 codemode 脚本拿到的是**完整结果**，可以自己先"削"再给模型。

## 22.4 MCP OAuth：交给标准的浏览器流程

- 没有 `Authorization` 头的 HTTP 服务器可走 OAuth：`/mcp` 或 `/mcp login <server>` 发起；浏览器授权；回调 URL 在 SSH 等场景可手工粘贴；
- 令牌存 `~/.pi/agent/mcp-auth.json`；过期或被拒时自动刷新；追加 scope 会再次要求登录；登出删除凭据；
- **凭据身份 = 服务器名 + URL**：同 URL 不同名分别登录；不同文件里同名同 URL 共享一次登录；
- 服务器不支持动态客户端注册时，手工配置注册信息（`clientId`/`clientSecret`/`callbackPort`/`callbackUrl`；`clientSecret` 支持环境变量或命令）；
- 需要特定 client 名（有些服务器只认已知客户端）可设 `clientName`；`clientRegistration: "cimd"` 走 Client ID Metadata Document（pi.dev 上的文档）；
- 服务器发现不正确时，可显式给 `authServerMetadataUrl`（**只指向你信任的元数据文档**，除本地回环外必须 HTTPS）。

安全提醒（结合第 11 章）：**MCP 服务器=外部代码/数据源**。项目条目的 `!command` 凭证、`headers`、"信任的元数据 URL"都是敏感面；给项目信任前先审查 `mcp.json`。
## 22.5 Codemode：让模型写一段程序去用工具

### 22.5.1 脚本形态

- 工具输入是**裸 JavaScript 源码**（不是 JSON，不要 Markdown 代码围栏）；
- 在 QuickJS 沙箱里作为 **async 函数体**执行——顶层 `await` 与 `return` 可用；
- 沙箱里**没有 Node API、文件系统、网络、定时器**；脚本只能通过 `tools` 与 `models` 与外界交互；
- 脚本开头可写选项行：

```js
// @options: {"max_output_tokens": 2000, "timeout_ms": 60000}
```

  - `max_output_tokens`（默认 10000）限制输出；超长输出保留**头尾**，全文写临时文件并给出路径；
  - 硬上限：**16 Mi 字符**的文本/图片数据，或 **100000 次** `text()`/`image()`/`console` 调用——超过直接 `RangeError`（**即使脚本 catch 了也失败**）。大数据应该"用工具写文件"，而不是往输出里灌；
  - `timeout_ms` 是整段脚本的硬期限（默认不设）。**图像生成可能几分钟**，别给它短期限。

### 22.5.2 结果格式与失败语义

```text
Script completed
（wall time）
（输出内容）
```

失败时保留**部分输出**，再附 `Script error:` 与错误。三条必须记住的语义：

1. **工具调用是真实副作用**：失败前已发生的调用**不会撤销**（"回滚"是你的事——比如用 `git` 或文件队列）；
2. 脚本结束时仍在跑的调用**被取消**（未 await 的 Promise 被丢弃）；
3. 失败是"结果"，不是"拒绝"：`execute()` 对脚本失败不 reject，错误在 `result.error` 里（`kind`: `script` / `timeout` / `aborted` / `sandbox`）。

## 22.6 全局对象与调用语义

### 22.6.1 全局速查表（`codemode.md`）

| 全局 | 用途 |
|---|---|
| `tools.<name>(args)` | 调用工具（见下） |
| `text(value)` | 输出文本项（字符串原样；其他值 JSON） |
| `image(value)` | 输出图片（base64 `data:` URL、`{ image_url }`、或图片块；**不支持远程 URL**；PNG/JPEG/GIF/WebP） |
| `console.log/info/warn/error/debug` | 同 `text()` |
| `return value` | 顶层 return 把值作为输出 |
| `exit()` | 成功结束脚本 |
| `store(key, value)` / `load(key)` | 跨调用保存小 JSON 值（22.7） |
| `ALL_TOOLS` | 全部可调用工具的 `{ name, description }` |
| `searchTools(query, {limit?, namespace?})` | BM25 排序（默认 8 条） |
| `describeTool(name)` | 工具的说明 + TypeScript 声明 |
| `describeNamespace(name)` | 命名空间（如 MCP 服务器）的说明/instructions/工具列表 |
| `models` | 非 LLM 模型（分类器/图像模型，22.8） |

### 22.6.2 `tools.<name>` 的命名与返回

- 工具标识里**非 JS 标识符字符会变成 `_`**：MCP 工具 `mcp__dev-radius__search` 在脚本里是 `tools.mcp__dev_radius__search`；
- 每个方法接收一个参数对象；
- **返回什么取决于工具**：

| 工具类型 | 解析为 |
|---|---|
| 有 `outputSchema` 的工具 | 结构化值（`structuredContent`） |
| `bash` | `{ output, truncated, full_output_path?, exit_code, wall_time_seconds }`（**非零退出也正常解析**）；`output` 上限 1 MiB，超长保留首尾各 512 KiB + 省略标记 |
| MCP 工具 | 完整 `CallToolResult`（含 `isError` 与 `structuredContent`） |
| 其他（`read`/`edit`/`write`…） | 文本输出 |

- 失败/被拦截/参数非法的调用**reject**，错误携带工具错误文本；用 `Promise.allSettled()` 保留成功的部分；
- `codemode` 的 description 里会列出一部分工具的 TypeScript 声明（**共享 3000 估算 token 的预算**，设置项 `codemode.inlineBudget`）；`deferred` 暴露的工具不列出（所以 MCP 服务器连接后描述不变）；其余靠 `searchTools()`/`describeTool()`/`ALL_TOOLS` 找；
- `codemode.mode: "on"|"only"`：`on`（默认）其他工具保持声明，描述里写明"如何从脚本调用"；`only` 则把它们从模型视图隐藏、只在 codemode 描述里列出（模型必须走脚本）。

## 22.7 Store：跨脚本的小状态，且"随分支"

- `store(key, value)` 保存（`undefined` 删除），`load(key)` 读取；
- **写入只在脚本成功时保留**：每个存过值的成功脚本会向会话追加一条 `codemode-store` custom 条目——所以恢复会话后值还在，**且每条分支只看到自己路径上写过的值**（第 9 章的分支世界观再次出现）；
- 限额：单值 ≤262144 字符 JSON，总和 ≤1048576；**不要存图片数据**（用 `image()` 输出或写文件）。

## 22.8 `models`：脚本里的分类器与图像模型

```ts
declare const models: {
	getModelsOfType(type, provider?): Promise<ModelInfo[]>;
	getAvailableOfType(type, provider?): Promise<ModelInfo[]>;   // 凭据可用的
	getModelOfType(type, provider, id): Promise<ModelInfo | undefined>;
	classify(model, context): Promise<ClassifierResult>;          // 对 state 回答 questions
	generateImages(model, context): Promise<ImagesResult>;        // 可能耗时数分钟
};
```

- `type` 为 `chat | image | classifier`；**chat 模型只可列举，不能在脚本里运行**；
- `classify()`/`generateImages()` 只用到 `model.provider` 与 `id`（所以 `{provider, id}` 也可）；
- **不抛供应商错误**：检查 `stopReason` 与 `errorMessage`；
- 并发上限 **4** 个此类调用/脚本（多余的排队——`Promise.all()` 大批量没问题）；
- 其**用量会加到 `codemode` 的工具结果**并计入会话成本（第 4.2 节 `Usage` 的子集概念）。
- 模型 ID 因供应商而异（如 `typesafe/jev-latest` vs `openrouter/typesafe/jev-1.13`）；用 `getAvailableOfType` 找当前凭据可用的。

## 22.9 沙箱边界：它隔离什么、不隔离什么

`codemode` README 的 "How it works" 给了精确的实现事实：

- 每次 `execute()` 起一个 **worker 线程**（含 VM 创建约 20ms），从 wasm 模块实例化**全新 QuickJS VM**（独立线性内存）；
- VM 的 import 只有两类：**WASI 垫片**（时钟、随机数、被丢弃的 stdout/stderr）与**一个宿主调用入口**——脚本无法以其他方式触达宿主；
- worker 在 VM 内先求值一段 prelude：把唯一的宿主桥收进闭包，在其上构建 `tools`、`console` 与全局变量；脚本被编译为 async 函数体；
- 工具调用以**消息**转发到宿主线程；宿主执行、把 JSON 结果投回；**期限与取消信号由宿主掌握**：任一触发 → 设置共享中断标志（VM 轮询）→ `worker.terminate()`。（中断标志是必需的：在 Bun 上 `terminate()` 停不住"在 wasm 里空转"的线程。）worker 线程保证同步的 QuickJS 不会阻塞宿主事件循环。

**正确表述它的边界**（这也是验收题之一）：

| 问题 | 答案 |
|---|---|
| 脚本能读文件/联网吗？ | 不能直接：无 fs/net/Node API |
| 脚本能影响外界吗？ | **能**——通过工具调用（工具是宿主注入的能力）与非 LLM 模型调用 |
| 那它是"安全沙箱"吗？ | 它是**VM/宿主隔离**，不是"无害环境"；能做什么由**注入的工具与权限钩子**决定 |
| 权限钩子管脚本吗？ | 管：MCP 调用与嵌套调用都走工具流水线；脚本发起的调用带 `parentToolCallId`（第 13-14 章的钩子适用） |
| 输出/副作用会被撤销吗？ | 不会：工具调用真实发生；失败不回滚；未完成的被取消 |

一句话：**沙箱把"执行环境"关小了，"能力"却仍由你批准的工具集界定**——这正是第 12 章"最小机制"思想在安全层面的映射。

## 22.10 组合实战：一段聚合脚本

场景：两个大 MCP 服务器（各几十个工具），你要"查所有与 issue 相关的信息并给摘要"。不开 codemode 时模型要多次调用、逐条阅读；开 codemode 后：

```js
// 1) 找工具（server A 的 search_issues、server B 的 get_issue、本地 grep）
const [a, b] = await Promise.all([
  tools.search_issues({ query: "login bug" }),
  tools.mcp__tracker__search({ q: "login" }),
]);

// 2) 并行取详情（失败的不影响其他）
const details = await Promise.allSettled(
  b.issues.slice(0, 5).map((i) => tools.mcp__tracker__get_issue({ id: i.id })),
);

// 3) 只把"结论"交给模型：过滤 + 摘要
const failed = details.filter((d) => d.status === "rejected").length;
text(`serverA 命中 ${a.hits.length}，tracker 命中 ${b.issues.length}，详情失败 ${failed}`);
for (const d of details.slice(0, 3)) {
  if (d.status === "fulfilled") text(`- ${d.value.title}: ${d.value.state}`);
}
```

模型最终看到的只是这几行文本（以及 20KB 截断规则下的结果）——**原始大结果留在脚本里被消化**。这就是 codemode 的核心价值：**把"阅读成本"从模型转移到程序**。

## 22.11 实验 L13：本地 MCP + codemode 组合

**实验性质**：本地（优先用内存传输或本地 stdio 演示服务器，避免外部依赖）；选修。
**验证状态**：设计中。目标（规划文档 L13）："本地演示 MCP 工具，对比直接逐个调用与一段程序组合结果"。

### 步骤（两条路线任选）

1. **纯本地路线（无模型、无网络）**：直接使用 `@earendil-works/pi-mcp` 的**内存测试传输**写一个小脚本：注册两个只读工具 → `listTools()` → `callTool()`；断言 `toLlmContent()` 的输出形状；再写 `@earendil-works/pi-codemode` 的 `CodemodeSandbox` 脚本，组合两个调用并断言只返回摘要；
2. **完整链路路线（可选）**：`pi mcp add` 一个本地 stdio 服务器（如 filesystem 演示），在 pi 里对比：
   - 不开 codemode：让模型逐个调用（观察工具调用次数与上下文体积）；
   - 开 codemode（`"defaultTools": ["+codemode"]`）：让模型写脚本组合调用。

### 观察与思考

- 连接失败、参数错误、取消分别发生在哪一层？（MCP 客户端 / 工具流水线 / 沙箱）
- codemode 调用为什么不受 `/tree`、恢复、fork 影响？（提示：仓库规则"codemode 调用不依赖活动工具集"）
- 脚本里未 await 的调用结束时是什么状态？（提示：被取消并记为 `cancelled`）

### 清理

删除演示服务器配置与实验脚本；`/reload`；确认 `/mcp` 列表回到原状。

## 22.12 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| 工具列表里没有 MCP 工具 | exposure 是 `codemode`（默认）不进声明 | 用 codemode 脚本调用，或把暴露改成 `direct`/`deferred` |
| `/mcp` 显示需要登录 | 服务器要 OAuth | `/mcp login <server>`；SSH 场景手工贴回调 URL |
| 第一次 prompt 等了 10 秒 | 有 `direct` 工具在等连接 | 属预期；减少 direct 或等服务器更快的网络 |
| stdio 服务器杀不干净 | 通过 npx/uvx 包装 | pi 会杀**进程组**（规范路径）；自定义启动器要自行处理子进程 |
| 脚本输出太大而失败 | 超过 16Mi 字符/100000 项硬上限 | 用工具写文件；`max_output_tokens` 只控制给模型的输出 |
| 脚本里 `tools.x-y()` 语法错 | 标识符被替换为 `_` | 用替换后的名字（`tools.x_y()`）或 `searchTools` 查 |
| 以为脚本失败会回滚 | 工具调用真实发生 | 设计"幂等/可恢复"的工具（第 7 章的 `replay`/队列思想） |
| 在脚本里存大对象 | store 限额（单值 256Ki 字符/总 1Mi） | 存 ID/游标；大对象用文件 |
| 沙箱当"绝对安全"依赖 | 混淆"环境隔离"与"能力边界" | 用权限钩子（`tool_call`）控工具；审查 MCP 来源 |

## 22.13 验收题

1. MCP 的命名/冲突规则；`-` 与 `_` 为什么算同一个服务器？
2. 三种 exposure 的差异与适用场景；`tool_search` 加载的工具为什么"留在分支上"？
3. codemode 脚本里工具调用的三种返回形态（结构化/`bash`/文本）与失败语义？
4. store 的持久化与分支语义；限额是多少？
5. 沙箱"隔离什么、不隔离什么"？权限钩子如何覆盖脚本调用？
6. 组合脚本如何降低"上下文成本"？举出你实验里的数字/观察。

### 参考答案（要点）

1. `mcp__<server>__<tool>`，非法字符→`_`，冲突加哈希；名仅差 `-`/`_` 视为同一，因为归一化后相同，防止"同一服务器双注册"的歧义。
2. codemode（默认，脚本可见、模型不可见）/deferred（搜索后加载）/direct（直接声明+脚本可用）；`tool_search` 的加载结果**持久进转录**，所以切分支/恢复仍在该分支声明。
3. 有 outputSchema→结构化；`bash`→对象（含 exit_code 等，非零不 reject）；MCP→CallToolResult；其他→文本。失败 reject 带错误文本；脚本级失败不回滚、不 reject（在 result.error 里）。
4. 成功脚本追加 `codemode-store` custom 条目；分支相对；单值 ≤262144 字符、总计 ≤1048576。
5. 隔离执行环境（无 fs/net/Node）；不隔离"通过工具触达的能力"；脚本调用带 `parentToolCallId`，`tool_call`/`tool_result` 钩子照常生效。
6. 示例：多个大结果在脚本内被过滤/聚合，只有摘要进模型；观察点包括模型侧工具调用次数下降、发给模型的文本体积下降（对照 20KB 截断与 inline 预算）。

## 22.14 来源与下一章

- `packages/mcp/README.md`（客户端核心、传输、`toLlmContent`、OAuth 子集、协议面）；
- `packages/codemode/README.md`（脚本、全局对象、调用语义、store、models、沙箱实现）；
- `packages/coding-agent/docs/mcp.md`（配置、命名、暴露、连接生命周期、资源、权限、SDK/扩展集成）；
- `packages/coding-agent/docs/codemode.md`（选项行、输出限额、`describeNamespace`、`codemode.mode` 等）；
- 示例：`packages/agent/examples/mcp-codemode`。

下一章进入"持久执行"的世界：Chord 的服务/状态模型与 durable 的"先落盘再显示"——为什么"存了聊天记录"不等于"能恢复执行"。