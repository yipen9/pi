# 第 25 章：Telemetry、行为评估与性能（选修）

> 学完本章你能回答：
>
> 1. "代码正确性""任务成功率""运行效率"三种问题分别用什么证据回答？
> 2. `pi-telemetry` 的 span/attribute/event/status 模型是什么？为什么没有公共 `end()`？
> 3. 类型化 schema 解决什么问题？pi 各包如何分工？
> 4. 行为评估（evals）怎么做到"可比较"？为什么"缺失测量不能当零值"？
> 5. 一次评估最少需要哪些设计要素才能得出可信结论？

**前置知识**：第 4 章（用量）、第 18 章（测试层次）、第 19 章（排障）。
**预计学习时间**：1 天（选修）。
**本章验证状态**：静态核对通过（`packages/telemetry/README.md`、`packages/evals/README.md` 逐节核对）；实验 L15 设计中。

---

## 25.1 先分清三类问题

| 问题 | 例子 | 证据来源 |
|---|---|---|
| **代码正确性** | "`queue_mode: one-at-a-time` 真的只取一条吗？" | 单元/集成测试（第 18 章） |
| **任务成功率** | "带文档的 agent 是不是更能完成某类任务？" | 行为评估（本章 25.6） |
| **运行效率** | "启动慢在哪一步？缓存命中有多少？成本多少？" | 耗时打点、`usage`/成本、遥测（本章 25.2-25.8） |

三者的纪律不同：单测要"确定"；评估要"成对、可重复、按预算"；性能要"先测量再优化"。**最常见的错误是用一种证据回答另一种问题**——比如"我手动跑了一次成功"就宣布任务成功率提升（第 25.6 节会说清为什么不行）。

## 25.2 Telemetry：span 模型

`packages/telemetry` 提供**厂商中立**的遥测契约：只有"契约 + no-op + 内存参考实现 + schema 工具 + 一致性套件"，**没有导出器、没有全局 current-span、不依赖任何后端**。

### 25.2.1 概念表（README 原文翻译）

| 概念 | 含义 |
|---|---|
| **Span** | 一次操作的时间记录（如"加载账户""发一次 AI 请求"）；开始于工作之前，结束于工作完成 |
| **父子 span** | 操作可以嵌套（请求 span 里有缓存查询与数据库查询），形成"时间都花在哪"的树 |
| **Attribute** | 挂在 span 上的命名事实（`provider: "openai"`、`cache.hit: true`、`item_count: 12`） |
| **Event** | span 内某个时点的命名事件（`retry.scheduled`、`cache.lookup`）；**没有时长**，可带属性 |
| **Status** | 结果：`ok` 或 `error`（错误可带 name/message） |
| **Context** | "新工作挂在哪"的句柄：从某 context 开 span，它就成其为子 |

官方示例轨迹：

```text
example.account.load                         span
├─ attributes: account.id=123, found=true   facts about the span
├─ event: example.cache.lookup              occurrence during the span
│  └─ attribute: cache.hit=false            fact about the event
└─ status: ok                               final outcome
```

一条不可违背的原则：

```text
A span is diagnostic data, not business state. Recording it must not change whether
the account load runs, succeeds, fails, or is persisted.
```

**遥测只负责观察，不参与业务结果**——这与第 7 章"错误是结果"、第 23 章"先提交再显示"一样，都是把"不变量"说清楚的设计。

### 25.2.2 核心 API：回调管理生命周期

```typescript
return telemetryContext.startSpan(
	{ name: "example.account.load", attributes: { "example.account.id": accountId } },
	async (span) => {
		const account = await readAccount(accountId);
		span.setAttributes({ "example.account.found": account !== undefined });
		return account;
	},
);
```

- **没有公共 `end()`**：`startSpan()` 拥有"结算"——回调返回或 reject 之前 span 一直开着；这消灭了"忘记 end / 重复 end"的经典错误；
- **嵌套**：把回调里的 span 当 context，继续 `span.startSpan(...)`；
- **预期失败也要显式**：正常返回但业务失败时，手动 `span.setStatus({ status: "error", error: { name, message } })`；
- 特性语义（no-op 版）：同步调用回调；保留返回值与异步拒绝；同步抛错转成 reject 的 Promise（同值）；共享一个冻结的惰性 span；**不检查、不保留**名称/属性/事件/状态。

### 25.2.3 内存参考实现与一致性套件

```typescript
const telemetry = new InMemoryTelemetryContext();
await telemetry.startSpan({ name: "example.operation", attributes: { input: "demo" } }, async (span) => {
	span.addEvent("example.started");
	span.setAttributes({ output_count: 3 });
});
console.log(telemetry.getSpans());
```

- `getSpans()` 返回**分离快照**（按开始顺序）：确定性数字 ID、父 ID、合并属性、有序事件、最终状态、结算状态、确定的结束序号；**不记录时间戳**（日期无关、可逐字节比对）；
- 存储**无界且进程本地**：每个测试/记录域新建实例；
- **适配器一致性套件**（`@earendil-works/pi-telemetry/testing`）：以"分组用例"的形式提供与运行器无关的一致性检查；fixture 提供新 context 并把后端 finished spans 归一化成 `RecordedTelemetrySpan`。检查清单（README 原文）覆盖：同步单次准入、结果与拒绝恒等、自动与显式状态、属性合并、事件顺序、**结算后调用是惰性的**、嵌套与并发的父子关系、以及"不可读 payload 的失败被抑制"。

## 25.3 类型化 Schema：让遥测"可编译期检查"

低层 API 故意开放（任意名字与属性袋）以保持适配器通用；**领域包**再定义"封闭、可序列化"的 schema，并**推断出精确类型**：

```typescript
export const EXAMPLE_TELEMETRY_SCHEMA = defineTelemetrySchema({
	version: 1,
	spans: {
		"example.read": {
			description: "Read one resource",
			parents: { kind: "any" },
			startAttributes: {
				"example.resource": { type: "string", required: true, values: ["account", "project"], description: "Resource kind" },
			},
			endAttributes: { "example.item_count": { type: "number", description: "Number of returned items" } },
			events: {
				"example.cache": {
					description: "Cache lookup result",
					attributes: { "example.cache.hit": { type: "boolean", required: true, description: "..." } },
				},
			},
			status: { default: "ok", errorWhen: "The read throws or returns an error result" },
		},
	},
} as const);

const startSpan = createTypedSpanStarter(telemetryContext, [EXAMPLE_TELEMETRY_SCHEMA]);
await startSpan("example.read", { "example.resource": "account" }, async (span, startChildSpan) => {
	span.addEvent("example.cache", { "example.cache.hit": true });
	const accounts = await readAccounts();
	// 子 span 用同一个 starter（已绑定到回调 span）
});
```

- 每个 span 暴露一个重载：**名字与属性在编译期检查**；
- 联合类型名字必须先收窄（保持"运行时名字 ↔ 属性 schema"的对应）；
- 回调收到"已绑定回调 span"的子 starter——**类型系统替你保证父子关系**。

### 25.3.1 pi 各包的分工（读源码时的路标）

```text
@earendil-works/pi-telemetry   拥有厂商中立契约、no-op/内存参考、schema 工具、适配器一致性套件
@earendil-works/pi-ai          接受并传播 provider 请求选项里的 telemetryContext；不拥有任何遥测 schema
@earendil-works/pi-agent-core  拥有并导出 AI 请求与 harness 的 schema、组合只读 schema 元组、类型化 span 助手
```

```typescript
import {
	AGENT_TELEMETRY_SCHEMAS, AI_TELEMETRY_SCHEMA, HARNESS_TELEMETRY_SCHEMA,
	startAiSpan, startHarnessSpan,
} from "@earendil-works/pi-agent-core";
```

命名空间：`pi.ai.*`、`pi.harness.*`、`pi.session.*`——适配器可以翻译成后端惯例，但**pi 自己的词汇不变**。

## 25.4 安全与可移植性：遥测里不许有什么

README 的 "Security and Portability" 一节可直接当检查表：

- **遥测是进程本地诊断，不是持久状态**：`TelemetryContext`/`TelemetrySpan`/后端 trace 对象**不得**写入记录、消息、快照、延迟句柄；
- **属性值限原始标量与数组**；
- 领域插桩**应避免**：prompt、completion、工具参数/输出、文件内容、供应商载荷、请求头、凭据、自由格式错误细节——除非你的 schema 与数据政策明确允许；
- **不使用 `AsyncLocalStorage` 或任何运行时环境上下文 API**：Node/Bun/浏览器/worker 都可用（后端适配器自负兼容）。

一句话：**遥测的默认姿态是"少收集"，收集什么要写进 schema 与数据政策**。
## 25.5 行为评估：两种形态

`packages/evals` 是"用真实模型跑固定任务集"的评估设施（基于 `vitest-evals`）。文件约定（README 原文）：

| 形态 | 文件 | 运行方式 | 对比结构 |
|---|---|---|---|
| **文档提升评估** | `*.docs.eval.ts` | `eval:docs`：每个用例在隔离的 `without_docs` 与 `with_docs` 容器里各跑一次，报告 **lift**（提升） | 成对比较 |
| **宿主评估** | 其它 `*.eval.ts` | `eval:host`：本机 Vitest 跑，普通 vitest-evals 套件 | **不是**成对比较 |

Runner 代码在 `src/` 各司其职：`cli.ts`（编排比较）、`docker.ts`（构建两个镜像、发现用例、跑一条隔离臂）、`plan.ts`（展开 `(case, variant, repetition)` 任务）、`report.ts`（读 Vitest JSON、配对、算 lift）、`harness.ts`（vitest-evals 适配器）。

### 25.5.1 运行命令与前提

```bash
# 入口（宿主评估 + 文档比较）；需要模型环境变量
PI_PROVIDER=openai-codex PI_MODEL=gpt-5.6-sol npm run eval -w packages/evals

# 只跑宿主评估
PI_PROVIDER=openai-codex PI_MODEL=gpt-5.6-sol npm run eval:host -w packages/evals

# 只跑一个宿主套件
PI_PROVIDER=... PI_MODEL=... npm run eval:host -w packages/evals -- evals/documentation-audit.eval.ts

# 文档比较（仓库根）
npm run eval:docs -w packages/evals -- --provider openai-codex --model gpt-5.6-sol

# 提高重复次数（测量稳定性）
npm run eval:docs -w packages/evals -- evals/extensions.docs.eval.ts --runs-per-variant 5
# 等价：PI_EVAL_RUNS_PER_VARIANT=5；也可用 vitest 过滤： -t "adds the model"
```

（本手册的读者注意：**这些命令会产生真实模型调用与费用**。按规划 Q4 的原则：跑之前单独确认预算与供应商。）

### 25.5.2 Runner 管线（六步）

```text
1. 临时挂载仓库做 Docker 构建，用仓库的 consumer-install 机制打包当前工作区包，
   然后从暂存运行时分别创建 without_docs 与 with_docs 两个镜像；
2. 在两个镜像里发现所选用例，并要求两组队列一致（identical cohorts）；
3. 执行前先规划每一条 (case, variant, model, runNumber) 臂；
4. 每条臂在全新容器里运行；失败/缺失的臂被记录，计划队列继续；
5. 有报告时用 @vitest-evals/core/node 读原生 Vitest JSON；
6. 配对精确的臂并写比较报告；被阻断的配对**扣留头条 lift**，进程非零退出。
```

一个低调但重要的细节：**重复顺序按 runNumber 交替**，降低顺序偏差（order bias）。

### 25.5.3 两个变体的隔离细节（可信度从哪来）

`without_docs` 变体：**移除** coding-agent 的 `README.md`、`CHANGELOG.md`、`docs/`、`examples/`，并从默认系统提示里**去掉 Pi 文档路由一节**；`with_docs` 保留、提示不变。

两者共同的隔离纪律：

- 都安装**同一批本地工作区 tarball**（npm overrides 保证 coding-agent 的内部 pi 依赖也来自当前仓库，而不是 registry）；
- **内部依赖包的文档/源码被对称移除**（防止它们变成"另一份指令"）；
- 启动时校验镜像允许清单，并验证安装后的 coding-agent 从 `dist/` 解析；
- 评估定义、评测助手、fixtures、Vitest 配置**root 所有**，harness 永久降权到非特权 UID 后**不可读**；
- 每次运行获得全新的 home、agent 目录、工作区、会话目录与容器文件系统；
- 文档评估**默认只允许** `read`/`write`/`edit`/`grep`/`find`/`ls`——**不暴露 shell 与 web 搜索**；
- 诚实声明：供应商流量仍需要容器网络，所以 **Docker 本身不能证明** agent 写的任意代码"从不使用网络"。

**读到这里你应该明白：评估的可信度是"隔离 + 配对 + 记录"堆出来的，不是"跑一下看起来更好"。**

## 25.6 结果的解释规则：为什么"缺失不能当零值"

每次调用创建被忽略的 `.eval/<timestamp>_<id>/` 目录，包含：

```text
protocol.json          模型、镜像 ID、用例、任务、协议摘要
expected-runs.json     完整计划队列
observations.jsonl     归一化结果与遥测
tasks/*/vitest.json    每条隔离臂的原生 JSON
<variant>/sessions/*/session.jsonl   原生 Pi 会话
report.json / report.txt            配对比较
```

判分规则（README 原文要点）：

- **一条配对只有"两臂各恰好一个分数"时才计入 pass-rate lift**；
- 缺失/重复/跳过/pending/未评分/报错的臂**阻断该配对**；
- 评估集里**任一配对被子阻断 → 扣留头条通过率**（不只算"能算的"）；
- **缺失的遥测保持不可用，而不是被当作零**；
- 报告会标出：无提升（no lift）、负增量、**饱和的对照组/处理组**（全对或全错——区分力可疑）、以及观察到的 flakiness；
- **一次重复不能证明稳定性**；
- 产物可能包含 prompt、回答、生成的代码与工具输出（敏感，别乱分享）。

把这套规则与第 18 章的测试纪律对照：测试追求"确定"，评估承认"随机但可度量"——**不是把随机洗掉，而是把随机写进协议**。

## 25.7 写一个评估：文件里只放"场景 + 任务 + 评分"

```ts
import { describeEval, StructuredOutputJudge } from "vitest-evals";
import { createPiDocumentationEvalHarness } from "../src/harness.ts";

const harness = createPiDocumentationEvalHarness();
const judge = StructuredOutputJudge({ expected: { ok: true }, match: "strict", allowExtras: false });

describeEval("Target workflow", { harness, judges: [judge], judgeThreshold: null }, (it) => {
	it("completes the task", async ({ run }) => {
		await run("Complete the target task.");
	});
});
```

三条纪律：

1. **外层 runner 拥有**变体、重复、隔离、身份、持久化与报告——评估文件**只写**场景搭建、模型任务与确定性评分；
2. 比较评分用 `judgeThreshold: null`：**低分是数据，不是基础设施故障**；
3. Vitest 断言只用来守护"套件不变量"（坏了才用断言），不要拿它当评分器。

## 25.8 性能与成本：先测量，再优化

三类可测量（回到 25.1）：

| 测量 | 工具/来源 | 注意 |
|---|---|---|
| 启动/初始化耗时 | `main.ts` 的 `time()` 打点 + `printTimings()`；`PI_STARTUP_BENCHMARK=1`（仅交互模式，初始化后退出并打印） | 别用"感觉"定位启动慢（第 19.2.2 节） |
| 会话用量与成本 | 助手消息的 `usage`（第 4.3.5 节）；`Model.cost`（第 5.3 节）；摘要/工具内部的嵌套用量也会累计（第 10.4、14.2 节） | 缓存命中（`cacheRead`）显著便宜——这也是缓存预热存在的理由 |
| 运行时剖析 | 根脚本 `profile:tui` / `profile:rpc`（`node scripts/profile-coding-agent-node.mjs --mode ...`） | 剖析的是**当前仓库源码** |
| 遥测 span | 本章 25.2-25.3 的契约（模型请求/harness 的 schema 在 agent-core） | 属性里**不要**放 prompt/文件内容/凭据 |

延伸到评估：**缺失测量 ≠ 零值**（25.6）；**显著变慢也是结果**——评估报告要区分"成功率变化"与"耗时/成本变化"，两者可能方向相反（更稳但更贵）。

## 25.9 选修实验 L15：设计一次可信的评估（不执行）

**实验性质**：**设计文档**（规划文档明确：真实评估运行前需确认预算与供应商）。**本实验不发起真实模型调用**。
**验证状态**：设计中。

### 目标

产出一份完整的评估计划，包含：**基线、样本、次数、预算、指标、失败分类**（规划文档的验收标准）。

### 模板（填完即产物）

```markdown
## 假设
（例：安装某扩展后，agent 完成"读取并汇总 package.json"任务的成功率提升）

## 任务集（样本）
- 例：5 个固定任务，每个任务给相同的起始仓库快照；任务文本与验收标准固化在评估文件里
- 说明样本为什么有代表性；列出你**不**覆盖的场景

## 变体与基线
- 对照组：不带扩展 / without_docs
- 处理组：带扩展 / with_docs（除变量外一切相同）

## 次数与顺序
- runs-per-variant ≥ 5（说明：一次重复不能证明稳定性）
- 记录顺序交替策略（参考 runner 的 runNumber 交替）

## 指标
- 主指标：pass-rate lift（仅在配对完整时报告）
- 护栏指标：耗时、成本、阻断配对数、flakiness

## 预算
- 模型：____；每条任务大致 token：____；总预算估算：____
- 明确"超预算时停止并记录部分结果"

## 失败分类
- 模型错误（答案错）/ 工具错误 / 评分器错误 / 基础设施错误（容器、网络）
- 每类的处置：重跑、记为阻断、还是人工审阅

## 解释规则（预先写死）
- 任一对被阻断 → 不报告头条通过率
- 缺失遥测按"不可用"，不按 0
- 出现饱和（全对/全错）时先质疑区分力
```

### 判定标准

- 计划里的每个数字都有来源或估算依据；
- "预注册"解释规则（先写规则、后看数据），避免事后挑选结论；
- 明确不执行的理由与将来执行的确认点。

### 清理

无（纯文档）。

## 25.10 常见错误

| 现象 | 原因 | 处理 |
|---|---|---|
| "跑了一次成功"当结论 | 单次不能证明稳定性 | 重复 ≥5 + 配对报告 |
| 把缺失数据当 0 | 违反评估语义 | 缺失=不可用；阻断相关配对 |
| 只报能算的配对 | 选择性报告 | 规则要求：任一阻断则扣留头条 |
| 用单测断言给模型打分 | 混淆证据类型 | 评分归 judge；Vitest 断言守不变量 |
| 遥测里塞 prompt/文件内容 | 数据政策 | 属性保持标量/数组；敏感字段需 schema+政策明确允许 |
| 持久化 span/context | 契约禁止 | 遥测是进程本地诊断 |
| 拿 Docker 当"无网络证明" | README 明确说不能 | 需要网络策略层面另行隔离 |
| 启动慢靠猜 | 没测量 | `PI_STARTUP_BENCHMARK`/打点/剖析脚本 |

## 25.11 验收题

1. 三类问题（正确性/成功率/效率）各用什么证据？混淆会怎样？
2. span/attribute/event/status/context 的定义？为什么没有公共 `end()`？"预期失败"怎么标记？
3. no-op 与内存参考实现的行为差异？一致性套件检查哪几类性质？
4. 类型化 schema 解决什么？pi 三个包（telemetry/ai/agent-core）如何分工？
5. 评估的两种文件形态；runner 六步；`without_docs`/`with_docs` 的隔离细节（至少四条）。
6. 报告规则：什么阻断配对？"缺失不能当零值"的意义？饱和意味着什么？
7. 一次评估计划至少包含哪些要素？为什么"解释规则要预先写死"？

### 参考答案（要点）

1. 正确性→确定性测试；成功率→配对评估；效率→耗时/用量/遥测。混用会把"一次成功"当稳定性、把"低分"当故障、把"感觉慢"当瓶颈。
2. span=一次操作的时长记录（可嵌套成树）；attribute=命名事实；event=时点事件；status=ok/error；context=挂载点。无 end() 是因为生命周期由 startSpan 的回调结算拥有（防漏/防重）。预期失败用 setStatus 显式标记。
3. no-op：同步调用、保留返回值/拒绝、共享惰性 span、不记录；内存版：确定性快照（无时间戳）、有界？——**无界**存储、进程本地。一致性：单次准入、结果/拒绝恒等、自动/显式状态、属性合并、事件顺序、结算后惰性、嵌套/并发父子、payload 失败抑制。
4. 让"名字/属性/事件/层级"在编译期检查，且运行时可序列化。分工：telemetry=契约与工具；ai=传播 telemetryContext（无 schema）；agent-core=拥有 pi.ai/pi.harness schema 与类型化 starter。
5. `*.docs.eval.ts`（成对 lift）/其它 `*.eval.ts`（宿主）。六步见 25.5.2。隔离：同 tarball/overrides、对称移除内部包文档、root 所有不可读、全新 home/工作区/会话、默认工具受限（无 shell/web）、dist 解析校验（任举四条）。
6. 两臂非"恰好一个分数"即阻断；任一阻断扣留头条；缺失≠0 防止把基础设施问题误读为能力下降；饱和=没有区分力，先质疑问卷设计与难度。
7. 假设、任务集、变体/基线、次数与顺序、指标（含护栏）、预算、失败分类、预先写死的解释规则。

## 25.12 来源与下一章

- `packages/telemetry/README.md`（概念、核心 API、no-op/内存参考、一致性套件、类型化 schema、pi 集成、安全与可移植性、API 表）；
- `packages/evals/README.md`（文件约定、runner 管线、变体隔离、结果与报告规则、编写评估）；
- 第 19.2 节（启动打点与基准）、第 4.3.5/5.3 节（用量与成本）、根 `package.json`（`profile:tui`/`profile:rpc`）。

至此**全部 26 章（0-25）正文完成**。接下来请使用附录：术语表、源码地图、命令速查、故障索引、练习参考答案、验证记录与版本说明。