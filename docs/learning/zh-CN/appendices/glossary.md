# 附录 A：术语表

> 用法：每个术语给出"一句话解释 + 首次出现的章节"。读代码遇到不认识的词，先查这里；查不到再搜源码（用英文名搜）。

## A.1 核心概念

| 中文 | 英文 | 一句话 | 章节 |
|---|---|---|---|
| 智能体外壳 / 运行框架 | agent harness | 组织模型、工具、状态、界面的框架，本身不"聪明" | 0.1 |
| 智能体 | agent | "模型 + 工具 + 循环"组成的执行体 | 0.1 |
| 轮次 | turn | 一次助手响应 + 它引发的工具执行 | 3.3.3 |
| 低层运行 | Agent run | 一次 `Agent.prompt()` 或 `Agent.continue()` 调用建立的生命周期；以 `agent_end` 和已等待的 listener 收尾为边界 | 3.3.3、D2 |
| 会话 prompt 编排 | session prompt workflow | `AgentSession.prompt()` 在 `started` 后进入 `_runAgentPrompt()`；可串起 retry、压缩恢复和多个低层 Agent run | 8、D27 |
| 用户请求 | user request | 用户提交一次输入；与模型请求不等价 | 3.3.3 |
| 模型请求 | model request | 真正发给供应商 API 的一次请求 | 3.3.3 |
| 转录 | transcript | 发给模型看/被记录的消息序列 | 4.1 |
| 投影 | projection | 从会话树/文档到"模型实际看到的内容"的计算过程 | 9.4 |
| 活动分支 | active branch | 从根到当前叶子的一条路径 | 9.1 |
| 叶子 | leaf | 会话树中的"当前位置" | 4.7.3 |
| 条目 | entry | 会话文件里的一行（JSONL） | 4.7 |
| 会话 | session | 一次对话的全部记录与状态 | 8.1 |
| 压缩 | compaction | 用摘要替换旧上下文表示的机制 | 10 |
| 上下文窗口 | context window | 模型一次能接受的最大 token 量 | 5.3 |
| 思考级别 | thinking level | off/minimal/low/medium/high/xhigh/max | 5.3 |
| 停止原因 | stop reason | pending/stop/length/toolUse/error/aborted/deferred | 4.3.3 |
| 用量 | usage | token 与成本统计 | 4.3.5 |

## A.2 消息与事件

| 中文 | 英文 | 一句话 | 章节 |
|---|---|---|---|
| Agent 消息 | AgentMessage | 内部消息（模型消息 + 应用自定义角色） | 4.4 |
| 模型消息 | Message | 供应商能理解的四角色联合 | 4.3 |
| 内容块 | content block | 消息内容的最小单元（text/image/thinking/toolCall） | 4.2 |
| 判别联合 | discriminated union | 用共同字面量字段区分成员的类型联合 | 1.3.4 |
| 类型收窄 | narrowing | 判断判别字段后类型自动缩小 | 1.3.4 |
| 事件 | event | 运行时广播（过程），不是消息（结果） | 3.3.2 |
| 队列更新 | queue update | 排队消息变化的会话事件 | 4.5.2 |
| 边界（结算前） | agent_before_settle | 最后一个可行动钩子 | 6.2、13.3.5 |
| 已结算 | agent_settled | "不会再自动继续"的最终信号 | 4.5.2、16.3 |
| 延迟句柄 | deferred handle | 异步应答的取回凭据 | 4.3.3 |

## A.3 工具与模型

| 中文 | 英文 | 一句话 | 章节 |
|---|---|---|---|
| 工具 | tool | 模型可调用的本地操作 | 7.1 |
| 工具定义 | ToolDefinition | 扩展/应用注册工具的"富"形态 | 7.1.2 |
| 参数校验 | argument validation | 用 typebox schema 在运行时校验调用参数 | 7.4 |
| 前置钩子 | beforeToolCall | 执行前可拦截（block）的钩子 | 7.6 |
| 后置钩子 | afterToolCall | 结果字段级改写的钩子 | 7.6 |
| 顺序 / 并行执行 | sequential / parallel execution | 工具批次的两种调度 | 7.5 |
| 终止提示 | terminate | "整批都同意时不因本批继续"的调度提示 | 7.5.4 |
| 模型 | model | 模型静态元数据（api/provider/限制/价格） | 5.2.2 |
| 协议方言 | api | 供应商接口族标识（如 anthropic-messages） | 5.2.1 |
| 供应商 | provider | 认证 + 模型目录 + 请求实现 | 5.2.3 |
| 简单流式 / 完整流式 | streamSimple / stream | 供应商无关档位 vs 协议特有选项 | 5.4 |
| 兼容开关 | compat | OpenAI 兼容生态的行为微调 | 5.5.4 |
| 假供应商 | faux provider | 脚本化、离线的测试模型 | 5.7 |

## A.4 会话与持久化

| 中文 | 英文 | 一句话 | 章节 |
|---|---|---|---|
| 会话管理器 | SessionManager | 会话文件的对象化句柄 | 9.3 |
| 分支会话 | branched session | 只包含"根到叶子"路径的新文件 | 9.5.2 |
| 分支摘要 | branch summary | 放弃某分支时生成的摘要条目 | 10.6 |
| 上下文编辑 | context edit | 只改"投影"、不改原始条目的追加编辑 | 9.4.4 |
| 保留边界 | firstKeptEntryId | 压缩后从哪条开始保留 | 10.3.2 |
| 保留预算 | keepRecentTokens | 压缩后至少保留的近期上下文 | 10.3 |
| 预留 | reserveTokens | 为模型回复预留的窗口 | 10.2.1 |
| 检测点替换 | checkpoint | 压缩条目携带的提示词/工具检查点 | 9.4.3 |

## A.5 扩展与集成

| 中文 | 英文 | 一句话 | 章节 |
|---|---|---|---|
| 上下文文件 | context files | AGENTS.md 等纯文本指令 | 11.4.2 |
| 项目信任 | project trust | 允许加载项目可执行资源前的人工决定 | 11.5 |
| 提示词模板 | prompt template | Markdown 变成 `/命令` | 12.3.2 |
| 技能 | skill | 目录 + SKILL.md 的按需说明书 | 12.3.3 |
| 扩展 | extension | 可执行 TypeScript 模块（进程权限） | 12.3.4、13 |
| Pi 包 | Pi package | 分发多资源的 npm/git 单元 | 12.3.6 |
| 钳制 | clamp | 按模型能力压低思考级别 | 5.3 |
| 重绑 | rebind | 会话替换后重新挂订阅/扩展绑定 | 8.6 |

## A.6 协议与架构（选修）

| 中文 | 英文 | 一句话 | 章节 |
|---|---|---|---|
| MCP | Model Context Protocol | 外部工具/资源接入协议 | 22 |
| 暴露方式 | exposure | codemode/deferred/direct 三种工具到达模型的方式 | 22.3 |
| 工具搜索 | tool_search | deferred 工具的"发现后再直调"机制 | 22.3 |
| 沙箱 | codemode sandbox | QuickJS VM + worker 的脚本执行环境 | 22.9 |
| 面片 | facet | Chord 插件可独立打包到不同环境的分片 | 23.2 |
| 服务 | service | Chord 的类型化稳定 token（singleton/keyed） | 23.2 |
| 复制状态 | replicated state | 原子发布、完整不可变值消费的状态 | 23.2 |
| 增量跟踪 | delta tracking | 记录/合并 JSON 操作的机制 | 23.2 |
| 持久执行 | durable execution | 意图先提交、崩溃可续的执行模型 | 23.1 |
| 检查点 | checkpoint | 任务每一步的持久落点 | 23.3.1 |
| 附着 | attachment | 一条表现层连接绑定到一个会话 | 24.2 |
| 信封 | envelope | 协议中包裹 payload 的定向记录 | 24.3 |
| span | span | 一次操作的时间记录（遥测） | 25.2 |
| lift | lift | 处理组相对对照组的提升（评估） | 25.5 |
| 阻断配对 | blocked pair | 两臂未各得恰好一个分数，禁止计入头条 | 25.6 |

## A.7 容易混淆的成对术语

| 对 | 区分 |
|---|---|
| message vs event | 结果 vs 过程（3.3.2） |
| turn vs run | 一个轮次 vs 整次运行（3.3.3） |
| `agent_end` vs `agent_settled` | 低层 run 结束 vs 自动工作清零（4.5.2） |
| 声明 vs 可执行 | 系统消息里的工具声明 vs 运行时工具集（7.3） |
| details vs content | 给界面/程序 vs 给模型（14.2） |
| 完成顺序 vs 记录顺序 | 并发完成 vs 声明序记录（7.5.3） |
| 停止原因 `length` vs `stop` | 被截断 vs 正常说完（4.3.3） |
| `AgentSession.prompt()` vs `Agent.prompt()` | 应用层输入分流/会话编排 vs 低层 Agent run 入口（8、D2、D27） |
| `handled` vs `queued` vs `started` | 输入被消费、不创建该输入自己的 run / 放入当前运行队列 / 进入会话 run 编排（8、16.5.3） |
| 提示词模板 vs 技能 | 一段话 vs 一套流程+文件（12.3.3） |
| 扩展 vs Pi 包 | 可执行单元 vs 分发单元（12.3.6） |
| compaction 摘要 vs branch summary | 压缩历史 vs 放弃分支（10.6） |
| durable cheat sheet：`replay: safe/never` | 崩溃后重跑 vs 报 interrupted（23.4） |
| JSONL RPC vs client/server | 进程内 stdio 协议 vs 跨进程服务路由（24.1） |
| 单测 vs 评估 | 确定性 vs 配对统计（25.1、25.6） |

## A.8 输入与运行的层级

不要按“用户按了一次回车”推断低层 run 或模型请求的数量。实际层级是：

| 层级 | 代表符号 | 次数关系 |
|---|---|---|
| 输入调用 | `AgentSession.prompt(text)` | 一次调用只表达一次输入尝试；结果可能是 `handled`、`queued` 或 `started` |
| 会话编排 | `_runAgentPrompt(messages)` | 只在开始处理输入时进入；在里面管理重试、压缩恢复、边界 continuation 与取消 |
| Agent run | `Agent.prompt(messages)` 或 `Agent.continue()` | 一次会话编排可包含多个 run；每个低层 run 都发出自己的 `agent_start` / `agent_end` 生命周期 |
| Agent turn | `turn_start` 到 `turn_end` | 一个 run 可包含多个 turn；每个 turn 通常包含一次助手响应及其引发的工具执行 |
| 模型请求 | `streamSimple` / provider stream | 通常发生在助手响应阶段；自动重试会再次请求模型，压缩摘要等内部工作也可能有独立请求 |

两个边界例子：

- 扩展命令被消费时，`prompt()` 返回 `handled`，没有为该输入启动 `_runAgentPrompt()`；
- `prompt()` 在 Agent 已运行时以 `steer`/`followUp` 方式排队，返回 `queued`。这条输入会影响现有流程，但它本身不是新的 `Agent.prompt()` 调用。

因此，统计“模型请求次数”不能数 prompt、turn 或 `agent_end`：应按 provider 请求事件/日志，或明确的测试探针计数。章节 21 的自测题也按这个区分评分。

## A.9 索引方式说明

- 想找"某行为在哪个文件" → 用 [source-map](source-map.md)；
- 想找"某命令怎么跑" → 用 [commands](commands.md)；
- 想找"某现象怎么排" → 用 [troubleshooting](troubleshooting.md)；
- 想找"哪些练习要做" → 用 [exercises-and-answers](exercises-and-answers.md)。
