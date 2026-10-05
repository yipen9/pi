# 精读篇：核心代码逐段注解

> 主线 0-25 章解决"**看懂结构与行为**"。精读篇解决"**每一行到底在做什么、为什么这么写**"。
>
> 用法：打开编辑器，左边源码、右边本文档，**一段源码 + 一段注解**对照读；读完一段，用"转到定义"跳一次被引用的符号，再回来继续。注解不替代源码——它是"路标 + 翻译 + 为什么"。

## 系列清单

| 文件 | 精读对象 | 对应主线章节 |
|---|---|---|
| [D1-agent-loop](D1-agent-loop.md) ✅ 已完成 | `packages/agent/src/agent-loop.ts`（940 行） | 第 3、6、7 章 |
| [D2-agent](D2-agent.md) ✅ 已完成 | `packages/agent/src/agent.ts` | 第 3、6 章 |
| [D3-session-manager](D3-session-manager.md) ✅ 已完成 | `packages/coding-agent/src/core/session-manager.ts`（投影/分支部分） | 第 9 章 |
| [D4-prompt-compaction](D4-prompt-compaction.md) ✅ 已完成 | `core/system-prompt.ts` + `core/compaction/`（关键函数） | 第 10 章 |
| [D5-sdk-session](D5-sdk-session.md) ✅ 已完成 | `core/sdk.ts` + `core/agent-session.ts`（装配与 prompt 路径选段） | 第 3、8 章 |
| [D6-main](D6-main.md) ✅ 已完成 | `src/main.ts`（启动与装配选段） | 第 3 章 |
| [D7-tools](D7-tools.md) ✅ 已完成 | `core/tools/truncate.ts`、`output-accumulator.ts`、`bash.ts`（含 read/write 对照） | 第 7 章 |
| [D8-extensions](D8-extensions.md) ✅ 已完成 | `core/extensions/types.ts` + `runner.ts`（关键段） | 第 13、14 章 |
| [D9-session-manager-class](D9-session-manager-class.md) ✅ 已完成 | `SessionManager` 类本体（生命周期/持久化/append 家族/工厂） | 第 9 章 |
| [D10-compaction-write-path](D10-compaction-write-path.md) ✅ 已完成 | `core/compaction/compaction.ts` 写路径（prepare/compact） | 第 10 章 |
| [D11-model-layer](D11-model-layer.md) ✅ 已完成 | `ai/models.ts` + `compat.ts` + `model-runtime.ts` + `model-resolver.ts` | 第 5 章 |
| [D12-protocol-modes](D12-protocol-modes.md) ✅ 已完成 | `modes/json-event.ts`、`jsonl.ts`、`print-mode.ts`、`rpc/*` | 第 16 章 |
| [D13-interactive](D13-interactive.md) ✅ 已完成 | `modes/interactive/`（渲染组合根、视口布局、启动序列） | 第 17 章 |
| [D14-extension-loader](D14-extension-loader.md) ✅ 已完成 | `core/extensions/loader.ts` + 四个支持文件 | 第 13 章 |
| [D15-compaction-session-glue](D15-compaction-session-glue.md) ✅ 已完成 | `agent-session.ts` 压缩触发与编排段 | 第 10 章 |
| [D16-export-share](D16-export-share.md) ✅ 已完成 | `session-export.ts`、`export-html/`、`session-share.ts`、`bug-report` | 第 9、19 章 |
| [D17-anthropic-stream](D17-anthropic-stream.md) ✅ 已完成 | `api/anthropic-messages.ts` 请求构造、SSE 解码、Anthropic 事件到统一事件 | 第 4–7 章 |
| [D18-openai-responses](D18-openai-responses.md) ✅ 已完成 | `api/openai-responses.ts` 与 `openai-responses-shared.ts` 的输出槽位、工具参数及终态 | 第 4–7 章 |
| [D19-openai-completions](D19-openai-completions.md) ✅ 已完成 | `api/openai-completions.ts` chunk 累积、兼容能力与 finish reason | 第 4–7 章 |
| [D20-bedrock-converse](D20-bedrock-converse.md) ✅ 已完成 | Bedrock credentials/region、Converse 事件转换和错误诊断 | 第 4、5、7、11、18、19 章 |
| [D21-faux-test-harness](D21-faux-test-harness.md) ✅ 已完成 | faux response/stream、`registerFauxProvider` 与 `createHarness` 生命周期 | 第 5–8、18–21 章 |
| [D22-extension-loader-lifecycle](D22-extension-loader-lifecycle.md) ✅ 已完成 | 工厂失败隔离、pending/commit/discard、缓存代际与 reload/dispose | 第 11–13、18–20 章 |
| [D23-provider-adapter-field-guide](D23-provider-adapter-field-guide.md) ✅ 已完成 | 四种 provider 协议对照、新 adapter 数据流与离线测试矩阵 | 第 4–7、18–21 章 |
| [D24-worked-source-change](D24-worked-source-change.md) ✅ 已完成 | issue #9631 的测试契约、历史实现 diff、prompt 顺序变化与断言区分力 | 第 8、13、18–21 章 |
| [D25-resource-loader-reload](D25-resource-loader-reload.md) ✅ 已完成 | `DefaultResourceLoader.reload`、项目信任双阶段、包资源排序、来源元数据与故障定位 | 第 11–14、18–20 章 |
| [D26-settings-manager-state](D26-settings-manager-state.md) ✅ 已完成 | `SettingsManager` 的来源合并、项目授权、异步写回、字段级保存与 reload | 第 1、3、8、11、18–20 章 |
| [D27-agent-session-prompt-settlement](D27-agent-session-prompt-settlement.md) ✅ 已完成 | `AgentSession.prompt()` 输入分流、run 循环、重试/压缩续跑、`agent_before_settle` 与 `agent_settled` 收束 | 第 4、6、8、10、13、15、18 章 |
| [D28-agent-session-runtime-replacement](D28-agent-session-runtime-replacement.md) ✅ 已完成 | `AgentSessionRuntime` 的 new/resume/fork/import 替换顺序、cwd 服务重建、扩展失效与失败状态 | 第 8、9、13、18 章 |
| [D29-model-runtime-request-and-credentials](D29-model-runtime-request-and-credentials.md) ✅ 已完成 | `ModelRuntime.prepareRequest` 的 auth/header/env 合并、`RuntimeCredentials` 覆盖层、按 provider 排队与快照同步 | 第 5、8、11、18 章 |
| [D30-provider-composition-and-refresh](D30-provider-composition-and-refresh.md) ✅ 已完成 | `models.json` upsert、extension 模型整表替换、provider 能力分发、刷新发布与覆盖优先级 | 第 5、11、13、18 章 |

> 状态：D1-D30 已完成。每篇写完会在上表标记。

## 阅读约定的记号

正文里四种块：

```text
【源码】   逐字引用的真实代码（可能为篇幅做了标注，但不会改动语义）
【注解】   逐行/逐段的解释
【跳转】   该去读的下一级符号（文件 → 符号）
【陷阱】   容易读错或容易踩的点
```

【陷阱】标记的内容请务必留意——它们是"读过一遍但没读懂"的最常见信号。
