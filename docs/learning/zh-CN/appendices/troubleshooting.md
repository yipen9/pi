# 附录 D：故障索引

> 用法：按"现象"找到行，按"定位步骤"逐条验证。每一步都尽量给出可观察证据；不要跳过"先确认你跑的是哪份代码"。

## D.0 通用前三条（先问自己）

1. **我跑的是源码版还是安装版？** 排障一律先用 `pi-test`（第 2.9 节）。
2. **我的 Node 版本对吗？** `node --version` ≥ 22.19.0。
3. **有事件轨迹吗？** 能用 JSON 模式就 `--mode json > events.jsonl`；UI 问题先开 `PI_TUI_WRITE_LOG`。

## D.1 启动类

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| 启动即报语法/模块错误 | 查 Node 版本 → 重装依赖 `npm install --ignore-scripts` → 确认用 `pi-test` | 2.2、2.9 |
| PowerShell 拒绝执行脚本 | 用 `powershell -ExecutionPolicy Bypass -File .\pi-test.ps1` | 2.9 |
| 启动很慢 | `PI_STARTUP_BENCHMARK=1` 看各阶段耗时；检查资源扫描/模型目录 | 19.2.2 |
| 进程直接退出/崩溃 | 读 `<agent-dir>/crashes.json`（最多 5 条、7 天内） | 19.2.4 |
| 启动后没有可用模型 | 认证与目录：`/login`、`--list-models`、`modelFallbackMessage` | 3.5、5.6 |
| `--version` 也执行扩展导致变慢/报错 | 扩展在 factory 里起了重资源 | 13.4 |

## D.2 配置与资源类

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| 改了设置不生效 | 11.6 工作流：定位 getter → 文件路径 → JSON 合法性 → 项目信任 → CLI/会话覆盖 → `/reload` | 11.6 |
| 项目级资源全部不生效 | 项目是否已信任（`/trust` 或 `--approve`） | 11.5 |
| AGENTS.md 没进提示词 | 检查目录层级与 `--no-context-files`；注意上下文文件**不需要**信任 | 11.4.2 |
| 模板/Skill 不出现 | 位置是否"直接子文件/含 SKILL.md"；`/reload`；description 是否缺失 | 12.3 |
| 扩展没加载/报重复 | 看启动诊断的扩展错误；同名工具冲突（replaceable/builtin） | 13.1、15.4.7 |
| `--some-flag` 不认识 | 扩展 flag 未注册时报诊断 | 8.3.2 |

## D.3 模型与认证类

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| 提示没有 API Key | 核对四层优先级（已存凭据→环境→OAuth→联合身份）；`source` 字段 | 5.5.1 |
| OAuth 过期/重复登录 | `auth.json`、重新 `/login`；MCP 侧是 `mcp-auth.json` | 5.6、22.4 |
| `getModel` 返回 undefined | `--list-models`；目录动态刷新（stored/权限过滤） | 5.2.4、5.6.2 |
| 请求发出后长时间无响应 | 检查超时/代理设置；事件流是否停在 `message_start(assistant)` | 11.3.4、16 |
| 频繁自动重试 | 看 `auto_retry_*` 事件与错误文本（限流/过载）；检查 `retry` 设置 | 6.6 |
| 上下文溢出反复发生 | 看 `compaction_*` 事件；调 `reserveTokens`/`keepRecentTokens` | 10.2、10.5 |

## D.4 工具类

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| 模型说"没有这个工具" | 声明 vs 可执行：系统消息 `toolsAdded/toolsRemoved`、白名单、`state.tools` | 7.3 |
| 工具参数错误 | 错误文本含字段路径与收到的参数；收紧 schema | 7.4 |
| 工具被静默拒绝 | `tool_call` 钩子/`beforeToolCall` 的 `block`；看错误结果 reason | 7.6 |
| 工具一直"运行中" | 工具是否检查 `signal`；看 `tool_execution_*` 事件配对 | 6.5 |
| 大输出把上下文撑爆 | 用 `truncateHead/Tail` + 临时文件 + 提示模型 | 7.9、14.6 |
| 同一文件并发写坏 | 是否绕过 `withFileMutationQueue` | 7.10 |
| 工具结果顺序"不对" | 区分完成顺序/记录顺序 | 7.5.3 |

## D.5 会话与上下文类

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| 恢复会话报 cwd 不存在 | `--session-dir`、切回原目录、`cwdOverride` | 9.5 |
| 历史"丢失" | 是否在另一条分支：`/tree`、活动叶子 | 9.1 |
| 压缩后模型失忆 | 固有属性；重要信息落文件；检查摘要模板栏目 | 10.4、10.9 |
| `context_edit` 不生效 | 编辑与目标是否都在活动分支的投影条目里 | 9.4.4 |
| fork 后内容变少 | fork 只复制根→叶路径；label 会被重建 | 9.5.2 |
| 会话文件手改后打不开 | 树结构/id 被破坏；用导出副本修 | 9.8 |

## D.6 协议与集成类（JSON/RPC/SDK）

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| JSON 解析偶尔失败 | 别用 readline；字节流 + 只在 LF 切分；退出时 flush 残留 | 16.7 |
| 最后一条事件丢了 | 同上（残帧） | 16.7 |
| RPC 响应配错 | 用 `id` 关联（异步处理，顺序无保证） | 16.5.2 |
| 等不到"完成" | 等 `agent_settled`；`disposition: handled` 时不要等 | 16.5.3 |
| 子进程卡住 | 客户端是否停止读 stdout（背压） | 16.3.1 |
| `RpcClient` 起不来 | `cliPath` 指向未构建的 `dist/cli.js` | 16.6 |
| SDK 恢复历史无效 | 用含条目的 `SessionManager` 构造会话；别赋值 `agent.state.messages` | 15.3 |
| 替换会话后事件断了 | 重绑订阅（`setRebindSession`/手动） | 8.6 |

## D.7 终端与 UI 类

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| 中文/emoji 行错位 | 用 `visibleWidth/truncateToWidth`；检查是否按字符数处理 | 17.10 |
| 输入法候选框位置飘 | 容器传递 `focused`；`Focusable` + `CURSOR_MARKER` | 17.4.2 |
| 界面闪烁/撕裂 | 是否绕开差分渲染自绘 ANSI | 17.1 |
| UI 不刷新 | 组件状态变化后 `invalidate()` + `requestRender` | 17.2 |
| 切主题旧色残留 | 状态里存了带色字符串 | 17.7.2 |
| 快捷键没生效 | 键位文件语法/平台差异/`/reload`；别硬编码按键 | 17.9 |
| 常规模式鼠标不响应 | 常规模式鼠标归终端（设计如此） | 17.5 |
| 渲染问题需原始证据 | `PI_TUI_WRITE_LOG` 抓 ANSI 流 | 17.8.2 |

## D.8 选修模块

| 现象 | 定位步骤 | 章节 |
|---|---|---|
| MCP 服务器连不上 | `pi mcp list`/`/mcp`/`mcp.log`；动态端口/权限 | 22.2.5 |
| MCP 工具"看不见" | exposure 默认 codemode（不进模型声明） | 22.3 |
| codemode 脚本报错 | `result.error.kind`（script/timeout/aborted/sandbox）；`tools.<name>` 名称替换规则 | 22.5、22.6 |
| codemode 输出超限 | 16Mi 字符/100000 项硬上限；用工具写文件 | 22.5.1 |
| durable 重启后没继续 | 调 `resume()`；重复提交用 `requestId` | 23.3.3 |
| 工具崩溃后重跑 | `replay: "safe"` 的语义；有副作用改 `"never"` | 23.4 |
| 客户端断连后请求失败 | 不自动重放；`reconnect()` + 重新 attach + 只重放安全操作 | 24.5.1 |
| 请求被拒（陈旧路由） | 用新的 `attachmentId` | 24.2 |
| 评估结果"变差" | 看是否阻断配对/饱和/波动；缺失不能当零 | 25.6 |

## D.9 排障工具位置速查

```text
事件轨迹     pi --mode json ... > events.jsonl     （第 16 章）
启动耗时     PI_STARTUP_BENCHMARK=1、printTimings  （第 19 章）
渲染字节     PI_TUI_WRITE_LOG                      （第 17 章）
崩溃记录     <agent-dir>/crashes.json              （第 19 章）
MCP 日志     <agent-dir>/mcp.log                   （第 22 章）
会话文件     <agent-dir>/sessions/...              （第 9 章）
评估产物     packages/evals/.eval/...              （第 25 章）
```