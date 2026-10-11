# 15. 进阶系统

> 预计时间：3 小时（主线，不含选读）
> 先修：task-00 到 task-14；尤其是 task-02-request-journey、task-03-messages-events-state、task-14-testing-debugging

## 本篇你会学到

- 说出仓库中 9 个进阶包和 1 个只剩产物的目录各自解决什么问题。
- 在源码中找到每个包的 3 到 5 个核心符号，并说出它们的作用。
- 区分六类问题：消息边界、远端会话路由、外部工具、脚本执行、崩溃恢复、观测与评测。

## 先用一个例子理解

用户输入："读取 `docs/a.md` 和 `docs/b.md`，各用一句话总结，然后告诉我哪个更长。"

在 task-02-request-journey 的主线里，模型先提出 `read` 调用，pi 在本地执行，模型再看到结果。这个流程在一台机器、一个进程里就能完成。

如果文件在远端服务器上，或者任务要跑很久、界面会断开，主线就不够用了。下面五个问题对应本篇的五组包：

1. 文件在远端仓库里。pi 不认识那个服务。没有统一的外部工具协议，每接一个服务都要写一套专用代码。对应 `mcp`。
2. 每个文件的全文都送回模型，上下文很快被占满。模型只能一个个调用、逐条阅读。对应 `codemode`：模型写一段脚本，脚本在沙箱里调用工具，只把摘要交给模型。
3. 第二个文件读到一半，进程崩溃。重启后不知道这次读取是否已经完成。对应 `durable`：每一步先写检查点，恢复时按重放策略决定是否重跑。
4. 界面关掉后重新打开。旧请求应该发给哪个会话？对应 `protocol`、`client`、`server`：用会话 ID 与附着 ID 决定请求去向，并且断线后不自动重放。
5. 这次回答慢了 3 秒，是模型慢还是工具慢？换了提示词后，成功率是否真的更高？对应 `telemetry` 记录耗时与事件，`evals` 做成对比较。

`chord` 解决另一类问题：同一个功能可能要在 agent worker、终端 UI 和远程 WebUI 里各运行一份，需要稳定的服务句柄和整体一致的状态。

## 本篇的边界

- 这些包不是日常 CLI 的必经路径。task-00 到 task-14 讲的主线已经足够使用 pi。
- `protocol`、`client`、`server` 的 README 明确写明是实验性的，协议没有兼容性保证，也没有内建认证。
- `durable` 的旧稿同样标注为实验性；本篇未逐条核对其 README 的声明。
- 评测（`evals`）会调用真实模型并产生费用。本篇只讲设计与源码，不运行它。

## 包地图

| 顺序 | 包（npm 名或路径） | 目录 | 解决的问题 | 与 coding-agent 的关系 |
| --- | --- | --- | --- | --- |
| 1 | `@earendil-works/pi-protocol` | `packages/protocol` | 字节流上的消息边界、版本与校验 | 实验服务层导入它（8 处） |
| 2 | `@earendil-works/pi-client` | `packages/client` | 连接、请求、订阅、断线语义 | 实验服务层导入它（5 处） |
| 3 | `@earendil-works/pi-server` | `packages/server`（实验） | 把连接路由到应用托管的会话 | 实验服务层导入它（4 处） |
| 4 | `@earendil-works/chord` | `packages/chord` | 跨环境的服务、复制状态、插件分片 | 大量导入（23 处，另有 `chord/context` 12 处） |
| 5 | `@earendil-works/pi-durable` | `packages/durable` | 持久会话、任务检查点、工具重放策略 | 导入它（17 处） |
| 6 | `@earendil-works/pi-mcp` | `packages/mcp` | MCP 客户端，接入外部工具 | 导入它（4 处，另有 `pi-mcp/oauth` 2 处） |
| 7 | `@earendil-works/pi-codemode` | `packages/codemode` | 沙箱 JavaScript，只能调用注入的工具 | `src/extensions/codemode/` 导入它 |
| 8 | `@earendil-works/pi-telemetry` | `packages/telemetry` | 厂商中立的 span 契约与类型化 schema | `pi-ai` 的 `src/types.ts` 引用它；coding-agent 未直接导入 |
| 9 | `@earendil-works/pi-evals` | `packages/evals` | 固定任务的配对评测 | coding-agent 不导入它；评测去运行 coding-agent |
| 10 | 无 npm 名（`session-backends/sqlite-node`） | `packages/session-backends/sqlite-node` | 会话存储后端的产物目录 | 不是 npm 包；SQLite 存储源码在 `durable` 中 |

下面的每一节都按同一结构写：问题、核心符号、最小例子、与 coding-agent 的关系、注意事项。

## 源码导览（按阅读顺序）

| 顺序 | 文件路径 | 符号 | 读的时候关注什么 |
| --- | --- | --- | --- |
| 1 | `packages/protocol/src/codec.ts` | `encodeClientMessage`、`ServerMessageDecoder` | 帧如何切分，校验失败走哪条路径 |
| 2 | `packages/client/src/client.ts` | `Client.connect`、`request`、`reconnect` | 断线后哪些请求在本地失败 |
| 3 | `packages/server/src/server.ts` | `Server` | 附着如何被路由 |
| 4 | `packages/chord/src/api.ts` | `defineService`、`replicatedState` | 服务标识与状态的所有权 |
| 5 | `packages/durable/src/harness/harness.ts` | `Harness.open`、`resume` | 打开时如何对齐仍在运行的任务 |
| 6 | `packages/durable/src/harness/tool.ts` | `ToolTask` 中的 `replay ?? "unsafe"` | 崩溃后工具是否重跑 |
| 7 | `packages/mcp/src/client.ts` | `McpClient` | 连接、列工具、调工具 |
| 8 | `packages/mcp/src/protocol/content.ts` | `toLlmContent` | 工具结果如何变成模型内容 |
| 9 | `packages/codemode/src/runtime/host.ts` | `CodemodeSandbox`、`execute` | 脚本的超时、取消与结果形状 |
| 10 | `packages/telemetry/src/memory.ts` | `InMemoryTelemetryContext` | 快照为什么不含时间戳 |
| 11 | `packages/evals/src/report.ts` | `formatEvalComparisonReport` | 阻断配对如何影响头条结果 |
| 12 | `packages/durable/src/storage/sqlite/node.ts` | `openNodeSqliteStorage` | SQLite 存储的入口 |

## 15.1 protocol（`@earendil-works/pi-protocol`）

**问题。** client 和 server 通过一条字节流通信，例如 Unix socket。字节流没有消息边界。发送方连续写两条消息，接收方一次读取可能只拿到半条，也可能拿到一条半。协议要解决三件事：怎样切分消息、怎样编码内容、遇到非法内容怎样拒绝。

**解决办法。** 每一帧由两部分组成：

```text
[4 字节无符号大端整数：载荷长度][一个 CBOR 项]
```

CBOR 是一种二进制的数据编码格式，可以理解为"二进制版的 JSON"。接收方先读 4 个字节得到长度，再等够这么多字节，最后解码。

**核心符号。**

- `PROTOCOL_VERSION`（`packages/protocol/src/protocol.ts`）：当前值为 `8`。
- `encodeClientMessage()`、`encodeServerMessage()`（`packages/protocol/src/codec.ts`）：先校验，再输出完整帧。
- `ClientMessageDecoder`、`ServerMessageDecoder`（同文件）：`push(chunk)` 返回已经完整的消息数组；`end()` 在仍有残帧时报错。
- `ProtocolValidationError`（同文件）：信封不合法、CBOR 损坏或分帧错误时抛出。

**最小例子。** 下面的代码取自 `packages/protocol/README.md`，是示意，本地未运行。

```ts
import {
  PROTOCOL_VERSION,
  encodeClientMessage,
  ServerMessageDecoder,
  type ClientHello,
} from "@earendil-works/pi-protocol";

const hello: ClientHello = { type: "hello", version: PROTOCOL_VERSION };
transport.send(encodeClientMessage(hello));

const decoder = new ServerMessageDecoder({ maxFrameLength: 1024 * 1024 });
for (const message of decoder.push(incomingChunk)) handleServerMessage(message);
decoder.end();
```

读这段代码时注意两点。第一，`push()` 返回空数组是正常情况，表示这一块数据还不足以组成一条完整消息。第二，`end()` 用来发现对端在一条消息中途断开。

**不变量。**

- 所有信封结构都拒绝未知字段。
- 载荷必须是严格 JSON。`NaN`、`Infinity`、`undefined`、字节数组、原型对象和循环引用都会被拒绝。
- 默认限制：单帧 16 MiB，数组或映射最多 1,000,000 项，嵌套最多 64 层（来自 README）。
- 协议只检查载荷"是不是严格 JSON"。载荷的业务语义由上层适配器（例如 chord）负责检查。

**一个分片的例子**（示意）。假设一条消息的完整帧是 14 字节。网络先送来前 6 字节，再送来后 8 字节。

- 第一次 `push()`：缓冲区只有 6 字节，不足以读出完整帧，返回空数组。
- 第二次 `push()`：缓冲区凑够 14 字节，解码出一条消息，返回 `[message]`。
- 如果第二次送来的数据里还带着下一帧的前几个字节，这些字节留在缓冲区中，等下一次 `push()` 再处理。

所以解码器的输入边界和消息边界无关。调用方每次只需要把收到的字节交给 `push()`。

**目录结构。** 下面是 `packages/protocol/src/` 的真实文件（由目录列表得到）。

```text
packages/protocol/src/
├── index.ts          对外导出
├── protocol.ts       消息的 schema 与 TypeScript 类型
├── codec.ts          校验后再编码，以及增量解码器
├── framing.ts        4 字节长度前缀，FrameDecoder，encodeFrame
└── cbor/
    ├── index.ts
    ├── decoder.ts    decodeCbor
    ├── encoder.ts    encodeCbor
    └── options.ts    长度、深度上限的默认值
```

**核心类型（字段名以 `protocol.ts` 为准）。**

- `ClientHello`：`{ type: "hello", version: 整数 }`。客户端的第一帧必须是它。
- `ServerHello`：`{ type: "hello", version: 8, serverId }`。`version` 必须等于 `PROTOCOL_VERSION`。
- `SessionTarget`：`{ serverId, sessionId, attachmentId }`。三个字段都要有，才能定位一个活动附着。
- `RequestEnvelope`：`{ type: "request", id, target, call }`。`target` 是服务器级或会话级的目标，`call` 是不透明的 JSON 值，协议不解释它。
- `ResponseEnvelope`：`{ type: "response", id, ok }`。`ok` 为 `true` 时有 `result`，为 `false` 时有 `error`。

所有信封都是严格对象（`additionalProperties: false`）。多出一个字段就会被拒绝，这能尽早发现版本不一致。

**与 coding-agent 的关系。** coding-agent 中一共有 8 处导入 `@earendil-works/pi-protocol`（每个文件 1 处）。它们分布在：

- `src/cli/experimental/command-options.ts`、`src/cli/experimental/commands/server.ts`
- `src/experimental/client-runtime.ts`、`src/experimental/server.ts`、`src/experimental/radius-relay.ts`、`src/experimental/plugins/package.ts`
- `src/experimental/services/connection.ts`、`src/experimental/services/sessions.ts`

协议本身不知道会话、工具或模型的含义。它只负责切帧、校验和附着路由字段。

**读的顺序。**

1. `packages/protocol/src/protocol.ts`：先看有哪些消息类型。
2. `packages/protocol/src/codec.ts`：看校验与编解码的入口，以及 `ServerMessageDecoder`。
3. `packages/protocol/src/framing.ts`：看长度前缀如何切分字节流。
4. `packages/protocol/README.md`：看实验性声明与版本说明。

**注意。** 协议版本是 8。客户端和服务器必须使用同一个版本，握手时会检查。

## 15.2 client（`@earendil-works/pi-client`）

**问题。** 界面（例如终端 UI）要连接一个远端会话，发送请求，接收订阅更新。难点在断线：请求可能已经在远端执行完成，但客户端收不到结果。如果客户端自动重放请求，像"发送邮件"这样的副作用就会重复发生。

**核心符号**（位于 `packages/client/src/`）。

- `Client`（`client.ts`，class）：客户端对象。
- `Client.connect(options)`（静态方法）：完成握手，并确认对端报告的 `serverId` 与期望一致。
- `client.request(target, call, signal?)`：低层请求原语。
- `client.reconnect()`：断线后重新握手。它不会自动重新附着，也不会重放请求。
- `createUnixTransportFactory()`、`discoverUnixServers()`（`unix.ts`）：Unix socket 的传输工厂与服务发现。

**最小例子。** 下面的代码是示意，本地未运行。`transportFactory` 通常由 `createUnixTransportFactory({ path })` 创建。

```ts
const client = await Client.connect({ serverId, transportFactory });
const result = await client.request(
  { serverId: client.serverId },
  { serviceId: "example.service", member: "read", args: [] },
);
// 调用对象的字段（serviceId、member、args）未在本地核对，以 chord 的 ServiceCall 为准。
```

**断线契约。** 这一段是本包最重要的规则，来自 `packages/client/README.md`：

| 观察到的现象 | 正确的反应 |
| --- | --- |
| 请求被 reject | 这是本地失败。远端可能已经完成 |
| 想继续使用这个会话 | 调用 `reconnect()`，通过管理服务重新 attach，拿到新的 attachment ID |
| 想"自动重试所有请求" | 不能这样做。协议故意不提供自动重放，因为副作用可能已经发生 |

**为什么不自动重放。** 假设客户端发出 `sendEmail` 请求。服务器已经发出邮件，但回复在断线前没有到达。客户端只看到"请求失败"。如果它自动重放，用户就会收到两封邮件。客户端无法知道远端是否已经执行，所以这个判断交给知道副作用语义的调用方。

**断线时的顺序**（依据旧稿引用的 `packages/client/README.md` 断连契约，本地未逐行核对）：

1. 所有等待中的本地请求被 reject。
2. 远端已经受理的调用可能继续执行完成。
3. 客户端清除当前的活动路由（attachment）。
4. 客户端不自动重连，也不重放请求。调用方要显式调用 `reconnect()`，再通过管理服务重新附着。

**目录结构。** `packages/client/src/` 的真实文件如下。

```text
packages/client/src/
├── index.ts          对外导出
├── client.ts         Client 类与 createClientServiceTransport
├── connection.ts     Connection：一条已握手的字节连接
├── transport.ts      ByteTransport 与 ByteTransportFactory 接口
├── unix.ts           Unix socket 的传输工厂与服务发现
├── types.ts          ClientOptions、ServiceSubscription 等公共类型
├── errors.ts         ServerError、DisconnectedError、ClientDisposedError
└── promise.ts        createPromiseResolvers，供请求与订阅使用
```

**核心类型（字段名以 `types.ts`、`transport.ts`、`client.ts` 为准）。**

- `ClientOptions`：`{ transportFactory, serverId, maxFrameLength?, onListenerError? }`。`serverId` 是期望的服务器身份，握手时会核对。
- `ByteTransportFactory`：`(handlers) => ByteTransport | Promise<ByteTransport>`。它把"怎样建立字节连接"交给调用方，客户端本身不关心是 Unix socket 还是别的通道。
- `ConnectionState`：`"disconnected" | "connecting" | "connected"`。
- `ServiceSubscription`：有 `id`、`target`、`snapshot` 字段，以及 `start()` 与 `dispose()` 方法。`start()` 要在调用方安装快照之后再调用，更新才按顺序送达。
- `Client` 类的只读访问器：`serverId`、`connectionState`、`connected`、`hello`、`attachment`。

**与 coding-agent 的关系。** coding-agent 中有 5 处导入 `@earendil-works/pi-client`，分别在 `src/client/index.ts`、`src/experimental/client-runtime.ts`、`src/experimental/radius-relay.ts`、`src/experimental/server.ts`、`src/experimental/services/connection.ts`。其中 `src/experimental/client-runtime.ts` 与 `src/experimental/server.ts` 另外导入了 `@earendil-works/pi-client/unix` 子路径（共 2 处）。

**读的顺序。**

1. `packages/client/src/client.ts`：看 `Client.connect`、`request`、`reconnect` 和 `dispose`。
2. `packages/client/src/transport.ts`：看传输层需要实现什么。
3. `packages/client/src/unix.ts`：看 `createUnixTransportFactory` 如何生成传输。
4. `packages/client/src/types.ts`：看选项与订阅的字段。

**注意。** 客户端只搬运数据，不解释业务。像 coding agent 的 `Transcript` 这样的观察接口，在客户端看来只是普通服务。

## 15.3 server（`@earendil-works/pi-server`，实验）

**问题。** 一个会话的 worker 进程可能同时被多个界面附着。服务器要回答一个问题：这次请求应该送到哪个会话、哪一个附着？

**核心符号**（位于 `packages/server/src/`）。

- `Server`（`server.ts`，class）：服务器本体。
- `ServerHost`（`types.ts`，interface）：应用必须提供的宿主。它有三个成员：`serverServices`、`resolveSession(sessionId, context)`、`openSession(metadata, context)`。
- `createUnixServer()`（`transports/unix/preset.ts`）：Unix socket 的预设构造函数。
- `getUnixSocketPath(serverId, serverDirectory)`（`transports/unix/address.ts`）：生成 socket 路径。
- `SessionMetadata`：只要求有一个 `id` 字段。应用可以扩展自己的字段。

**最小例子。** 下面是示意，取自旧稿的结构。`serverServices` 和 `openRoutedSession` 都需要应用提供，本地未运行。

```ts
const host: ServerHost<StoredSession> = {
  serverServices,
  async resolveSession(sessionId) {
    // 从应用目录取元数据；找不到就抛 SessionNotFoundError
  },
  openSession: (metadata) => openRoutedSession(metadata),
};
const server = createUnixServer(host, {
  serverId,
  path: getUnixSocketPath(serverId, "/run/user/1000/pi"),
});
await server.start();
```

**三个路由标识。** 这是理解本包的关键。

| 标识 | 谁生成 | 作用 |
| --- | --- | --- |
| `serverId` | 启动方 | 逻辑上的服务器身份。它不是 socket 地址 |
| `sessionId` | 应用 | 选定一个 durable 会话 |
| `attachmentId` | 服务器 | 选定一个活动的表现层附着 |

`attach()` 和 `detach()` 不返回这些标识。服务器通过带外的 `attachment` 消息告诉客户端当前有效的路由。这样，业务结果里不会混入路由细节。

**为什么 attach 不返回路由 ID。** 假设界面 A 附着某会话后断线，界面 B 重新附着，拿到新的 `attachmentId`。A 的一条迟到请求还带着旧 ID。如果服务器接受它，这条请求就会落到 B 的附着上。服务器拒绝陈旧 ID，正是为了防止这种串线。路由 ID 只放在带外的 `attachment` 消息里，不出现在业务结果中，也就不会被误用。

**附着的生命周期**（依据旧稿引用的协议与服务器 README，未逐行核对）：

1. 客户端发出 attach 请求。
2. 服务器安装活动路由，然后通过带外的 `attachment` 消息告诉客户端新的 `attachmentId`。
3. 之后的业务调用带上 `{ serverId, sessionId, attachmentId }`，服务器校验后转发给会话。
4. 连接断开时，服务器先等已受理的调用结束，再释放该附着。

**目录结构。** `packages/server/src/` 的真实文件如下（已省略 `testing/` 的细节）。

```text
packages/server/src/
├── index.ts
├── server.ts              Server 类：握手、分发请求、附着路由
├── types.ts               ServerOptions、SessionMetadata、ServerHost 等接口
├── session-router.ts      SessionRouter 类（内部实现未逐行核对）
├── connection.ts          连接阶段（awaitingHello 到 closed）
├── listener.ts            ServerListener 接口
├── errors.ts              SessionNotFoundError 等路由错误
├── testing/               client.ts、host.ts、server.ts 等测试辅助
└── transports/unix/
    ├── address.ts         getUnixSocketPath
    ├── listener.ts        createUnixListener 与 UnixByteConnection
    ├── preset.ts          createUnixServer
    └── types.ts           UnixListenerOptions、UnixServerOptions
```

**核心类型（字段名以 `types.ts` 为准）。**

- `ServerHost<TMetadata>`：三个成员。`serverServices` 处理服务器级管理调用；`resolveSession(sessionId, context)` 根据 ID 找到元数据，找不到时抛出路由错误；`openSession(metadata, context)` 返回一个 `RoutedSessionHandle`。
- `SessionMetadata`：只有一个必需字段 `id: string`。应用可以再加自己的字段。
- `RoutedSessionHandle`：`attachClient(context)`、`close(context)`，以及可选的 `terminated` Promise。`terminated` 在意外退出时给出错误，在正常关闭后解析为 `undefined`。
- `RoutedSessionAttachment`：`invokeService(call, publish, context)` 与 `release(context)`。每个表现层连接对一个会话只有一个附着。
- `ServerOptions`：`listeners`、`serverId` 必填；`maxFrameLength?`、`handshakeTimeoutMs?` 可选。

**与 coding-agent 的关系。** coding-agent 中有 4 处导入 `@earendil-works/pi-server`：`src/experimental/radius-relay.ts`、`src/experimental/server.ts`、`src/experimental/session-worker-manager.ts`、`src/experimental/services/server.ts`。`src/experimental/server.ts` 另外导入了 `@earendil-works/pi-server/unix` 子路径。关于"会话目录由 `meta.json` 与 `session.sqlite` 组成，服务器只读 `meta.json`"的说法，本地未核对。

**读的顺序。**

1. `packages/server/src/types.ts`：先看 `ServerHost` 与路由接口，这是应用必须实现的部分。
2. `packages/server/src/server.ts`：看握手与 `handleRequest` 如何校验路由字段。
3. `packages/server/src/transports/unix/preset.ts`：看 `createUnixServer` 如何把 `Server` 和 Unix 监听器组装起来。
4. `packages/server/README.md`：看实验性声明与路由规则。

**注意。** 服务器不加载 facet 契约，它只转发不透明的调用信封，并检查附着路由是否有效。服务器关闭时，会释放所有已路由的会话句柄。

## 15.4 chord（`@earendil-works/chord`）

**问题。** 同一个功能可能要在三个地方运行：agent worker、终端 UI、远程 WebUI。每个地方都需要调用同一个服务。状态更新也必须是整体一致的，界面不能看到改了一半的状态。

**核心符号**（`packages/chord/src/api.ts` 中导出，除非另注）。

- `defineService(id, options?)`：声明一个类型化、稳定的服务标识。`{ local: true }` 表示只在当前进程内使用，不会暴露到远程目录。
- `defineFacet(facet)`：声明插件的一个分片。分片可以被打包到不同的进程或环境中。
- `replicatedState(initial)`：创建权威状态。它返回 `MutableReplicatedState`，其 `change(context, mutate)` 方法让调用方在一个草稿上修改状态（类型定义在 `packages/chord/src/types.ts`）。
- `track(initial)`（`packages/chord/src/delta/tracker.ts`）：记录 JSON 操作，用于增量同步。
- `createFacetHost(options)`、`createStaticFacetLoader(facets)`：装载插件分片，支持热替换。

**最小例子。** 下面是示意，本地未运行。`context` 由调用方提供（类型来自 `@earendil-works/chord/context`）。

```ts
import { replicatedState } from "@earendil-works/chord";

const counter = replicatedState({ count: 0 });
counter.change(context, (draft) => {
  draft.count += 1;
});
```

**一个所有权的例子。** 界面 A 读到 `counter` 的当前值 `{ count: 1 }` 并保存下来。随后 worker 发布 `{ count: 2 }`。如果 A 直接修改它保存的对象，就等于改了进程内共享的权威值，其他订阅者看到的状态会被破坏。正确做法是只读取；需要修改时，通过 `change()` 开一个新的草稿。

**两条规则。**

- 草稿（`draft`）只在 `change` 的回调期间有效。回调结束后，它不再是状态的一部分。
- 用 `replicatedState` 发布的值不能再被原地修改。进程内的订阅者可能共享同一个对象，修改它会破坏权威状态。

**目录结构。** `packages/chord/src/` 的主要文件如下（子目录只列了本篇提到的部分）。

```text
packages/chord/src/
├── api.ts              对外 API：defineService、defineFacet、replicatedState 等
├── types.ts            Context、ReplicatedState、MutableReplicatedState、Service 等类型
├── index.ts
├── json.ts             JSON 值的判断与工具
├── context/index.ts    子路径 @earendil-works/chord/context
├── delta/
│   ├── tracker.ts      track()：记录 JSON 操作
│   ├── diff.ts         diffRevisions()：比较两个版本
│   ├── draft.ts        草稿（draft）的实现
│   ├── index.ts        applyImmutable() 等
│   └── README.md
├── facets/
│   ├── host.ts         createFacetHost()
│   └── loader.ts       装载分片
├── services/           服务的实例、句柄、消息线路（wire.ts）等
├── node.ts、node/      Node 环境：打包与清单（bundle.ts、manifest.ts）
└── bundler.ts          子路径 @earendil-works/chord/bundler
```

**核心类型（字段名以 `types.ts` 为准）。**

- `ReplicatedState<T>`：只读。`value` 在水合前是 `undefined`；`subscribe(listener)` 收到 `(value, context, delivery)`。
- `ReplicatedStateDelivery`：`{ kind: "hydrate" | "update", sequence: number }`。`sequence` 可能跳号，这是背压策略的结果（见选读 D）。
- `MutableReplicatedState<T>`：继承 `ReplicatedState<T>`，额外有 `change(context, mutate)` 与 `replace(context, value)`。只有权威方（worker 或宿主）持有它，其他代码只拿到只读视图。
- `ServiceMode`：`"singleton" | "keyed"`。singleton 表示一个进程内只有一个实例；keyed 表示按键分实例。
- `defineService(id, options?)` 的重载：传 `{ local: true }` 时返回只在本进程使用的服务。

**与 coding-agent 的关系。** coding-agent 大量使用 chord：导入 `@earendil-works/chord` 共 23 处，导入 `@earendil-works/chord/context` 共 12 处，另外还有 `@earendil-works/chord/node` 与 `@earendil-works/chord/bundler` 子路径。它是 coding-agent 实验服务层的组装基础，例如 `src/experimental/services/worker.ts`、`src/experimental/services/transcript.ts` 与 `src/experimental/session-worker.ts` 都直接使用它。

**读的顺序。**

1. `packages/chord/src/api.ts`：看 `defineService`、`defineFacet`、`replicatedState` 的导出与重载。
2. `packages/chord/src/types.ts`：看 `ReplicatedState` 与 `MutableReplicatedState` 的注释，它们写明了哪些值不能修改。
3. `packages/chord/src/delta/tracker.ts`：看 `track()` 如何记录变更。
4. `packages/chord/README.md`：看更完整的能力列表（本篇只讲了其中一部分）。

**注意。** chord 的 `PLANNING.md` 与 README 描述了更多能力。本篇只讲上面列出的符号，其余内容见选读。

## 15.5 durable（`@earendil-works/pi-durable`）

**问题。** agent 在执行工具时进程崩溃。重启后，这个任务是完成了还是没完成？工具要不要重跑？如果工具是"删除目录"，重跑会不会再删一次？

普通的 JSONL 会话（task-09）只保存"发生过什么"的记录。durable 要的是"做到哪一步了"的检查点。两者目标不同，不要把普通会话当成持久执行日志。

**核心符号**（位于 `packages/durable/src/`）。

- `Harness.open(storage, options, context)`（`harness/harness.ts`）：在存储上打开一个 Harness。`options.registry` 必须由 `createRegistry()`（`harness/registry.ts`）创建，否则报错。
- `harness.resume()`：启动任务调度器，继续上次未完成的工作。
- `defineTool({ name, description, parameters, execute, replay })`（`harness/define.ts`）。`replay` 的类型是 `"safe" | "unsafe"`（`harness/types.ts`）。
- `openNodeSqliteStorage(path)`（`storage/sqlite/node.ts`）：打开 SQLite 存储。测试中常用 `MemoryStorage`（`storage/memory.ts`）。

**一个崩溃的时间线。** 工具 `sendEmail` 执行到一半时进程被杀掉。

1. 意图已经写入存储：要发送一封邮件。
2. 邮件服务器可能已经收到了这封邮件。
3. 进程崩溃，存储里的任务状态仍是"执行中"。
4. 重启后，`harness.resume()` 发现这个任务没有完成。
5. 若工具声明为 `replay: "safe"`，它会重跑，可能发出第二封邮件。
6. 若工具是 `replay: "unsafe"`（缺省），它不重跑。模型收到中断的错误结果，由模型或用户决定是否重发。

同一个崩溃，两种声明，结局不同。选择由声明者负责，框架不替你猜。

**工具的重放策略。** 崩溃时，每个工具调用的状态决定它的结局：

| 崩溃时的状态 | `replay: "safe"`（如只读） | `replay: "unsafe"`（如发邮件、扣款） |
| --- | --- | --- |
| 意图已写入，执行未完成 | 重启后重跑 | 不重跑；模型收到中断的错误结果，附带已写入的部分输出（旧稿称 `interrupted`，未在本地核对字符串） |

缺省值是 `unsafe`：`packages/durable/src/harness/tool.ts` 中的 `tool.replay ?? "unsafe"` 决定了这一点。写工具时仍建议显式声明，避免读代码的人猜测。

| 对比 | 普通 JSONL 会话（task-09） | durable |
| --- | --- | --- |
| 存储单位 | 树形条目，追加写入 | 转录条目、文档、任务，一次提交原子完成 |
| 工具崩溃后 | 没有内建的重放语义，靠人看记录判断 | `replay: "safe"` 自动重跑；`"unsafe"` 不重跑，模型收到中断的错误结果 |
| 排队的输入 | 内存队列 | 持久文档，崩溃后仍在 |
| 会话身份 | `sessionId` | 持久的供应商会话身份，跨重试、reset、压缩保持 |

**最小例子。** 下面是示意，本地未运行。`models` 与 `registry` 需要由调用方准备。

```ts
import { defineTool } from "@earendil-works/pi-durable";
import { Type } from "typebox";

const count = defineTool({
  name: "count",
  description: "Count from 1 to n",
  parameters: Type.Object({ n: Type.Number() }),
  replay: "safe",
  execute: async (args, api) => {
    for (let i = 1; i <= args.n; i++) api.output(`${i}\n`);
    return {};
  },
});

const harness = await Harness.open(await openNodeSqliteStorage("./session.sqlite"), { models, registry }, context);
const root = await harness.root(context);
harness.resume();
```

`typebox` 是定义工具参数 schema 的库，与 durable 测试文件中的写法一致。`harness.root()` 与 `harness.resume()` 的完整签名以 `packages/durable/src/harness/harness.ts` 为准。

**目录结构。** `packages/durable/src/` 下与本篇相关的部分如下（`harness/` 约 25 个文件，这里只列主要的）。

```text
packages/durable/src/
├── index.ts
├── harness/
│   ├── harness.ts       Harness.open、Harness 实例的 resume() 与 root()
│   ├── define.ts        defineTool、defineExtension 等定义函数
│   ├── registry.ts      createRegistry、BUILTIN_TASKS
│   ├── tool.ts          ToolTask：工具调用的任务与重放规则
│   ├── scheduler.ts     TaskScheduler：open 与 resume
│   ├── generation.ts    GenerationTask：模型生成的任务
│   ├── compaction.ts    CompactionTask：上下文压缩的任务
│   └── types.ts         ToolRegistration、Registry、Agent 等类型
├── storage/
│   ├── memory.ts        MemoryStorage（测试用）
│   ├── jsonl/           JsonlStorage
│   └── sqlite/
│       ├── node.ts      openNodeSqliteStorage（Node 入口）
│       ├── storage.ts   SqliteStorage
│       └── migrations.ts SQLITE_MIGRATIONS
├── tools/               read、write、edit、bash 等内置工具的实现
├── session/             会话与分叉
└── testing/             存储一致性测试与基准
```

**核心类型（字段名以 `harness/types.ts` 为准）。**

- `ToolRegistration`：工具的注册形状。它包含 `execute(args, api, context)`，以及可选的 `replay?: "safe" | "unsafe"`、`executionMode?`、`outputLimits?`。`replay` 缺省时按 `unsafe` 处理。
- `ToolTask` 的检查点（`harness/tool.ts`）：`{ phase: "execute", arguments, replay }`。这是执行前写入存储的"意图"，崩溃恢复时读的就是它。
- `Harness.open(storage, options, context)`：静态方法，内部先调用 `openTasks(context)` 把仍为 `running` 的任务改回 `pending`，然后返回实例。
- `Storage` 接口：`MemoryStorage` 与 `SqliteStorage` 都实现它。调用方通过它读写会话、任务和文档。

**与 coding-agent 的关系。** coding-agent 中共有 17 处导入 `@earendil-works/pi-durable`，还包括 `@earendil-works/pi-durable/storage/sqlite/node`、`@earendil-works/pi-durable/tools`、`@earendil-works/pi-durable/env/node` 三个子路径。例如 `src/experimental/durable/runtime.ts`、`src/experimental/durable/harness-setup.ts`、`src/experimental/session-worker.ts` 都会导入它。实验 worker 用它打开会话存储并恢复任务。

**读的顺序。**

1. `packages/durable/src/harness/harness.ts`：看 `Harness.open` 与 `resume()`，以及两步的分工。
2. `packages/durable/src/harness/tool.ts`：看 `tool.replay ?? "unsafe"` 所在的分支。
3. `packages/durable/src/harness/types.ts`：看 `ToolRegistration` 的字段注释。
4. `packages/durable/src/storage/memory.ts`：看最小的 `Storage` 实现，比 SQLite 更容易读。

**注意。** 每个工具调用在 durable 中是自己的任务。它的意图在 `execute()` 之前就写入存储。

## 15.6 mcp（`@earendil-works/pi-mcp`）

**问题。** 外部工具由独立进程（stdio）或远端服务（HTTP）提供。pi 需要做四件事：建立连接、列出工具、调用工具、把结果转成模型能读的内容。连接失败和工具执行失败是两种不同的错误，要分开报告。

**核心符号**（位于 `packages/mcp/src/`）。

- `McpClient`（`client.ts`，class）：构造函数接收 `McpClientOptions`。`listTools(options?)`、`callTool(...)` 是两个主要方法。
- `StdioTransport`（`transports/stdio.ts`）：通过子进程的标准输入输出通信。
- `toLlmContent(result)`（`protocol/content.ts`）：把 `CallToolResult` 的 `content` 转成 `LlmContent` 数组。如果没有 `content` 但有 `structuredContent`，它会输出格式化后的 JSON 文本。
- `oauth/` 目录：处理需要 OAuth 登录的 HTTP 服务器。

**最小例子。** 下面是示意，本地未运行。

```ts
import { toLlmContent } from "@earendil-works/pi-mcp";

const llm = toLlmContent({ content: [{ type: "text", text: "hello" }] });
// 预期得到文本内容块 [{ type: "text", text: "hello" }]；输出形状未在本地运行验证
```

**连接生命周期**（依据旧稿引用的 coding-agent 文档 `packages/coding-agent/docs/mcp.md`，本地未逐行核对）：

1. 会话启动时，后台连接所有启用的服务器。连上之后，工具才会出现。
2. 第一次 prompt 时，直接暴露（direct）的工具最多等待 10 秒。
3. HTTP 返回 408、429 或 5xx 时，重试两次。连接断开后，下次调用时重连。
4. 停止 stdio 服务器时，先关闭 stdin，再发送 SIGTERM，最后对进程组发送 SIGKILL。

**名字怎样进入 pi。** coding-agent 在 `packages/coding-agent/src/core/mcp-servers.ts` 中给每个服务器生成命名空间：`mcp__<server>`，其中服务器名里的 `-` 会被替换为 `_`。工具的完整名字是 `mcp__<server>__<tool>`。这样，不同服务器的同名工具不会冲突。

**目录结构。** `packages/mcp/src/` 的真实文件如下。

```text
packages/mcp/src/
├── index.ts
├── client.ts                 McpClient 类
├── auth-provider.ts
├── protocol/
│   ├── types.ts              MCP 消息类型
│   ├── jsonrpc.ts            JSON-RPC 信封
│   └── content.ts            toLlmContent、LlmContent
├── transports/
│   ├── transport.ts          McpTransport 接口
│   ├── stdio.ts              StdioTransport：子进程标准输入输出
│   ├── streamable-http.ts    HTTP 传输
│   └── in-memory.ts          InMemoryTransport（测试用）
├── oauth/                    OAuth 登录：discovery、flow、provider、callback
└── testing/index.ts
```

**核心类型（字段名以 `client.ts` 为准）。**

- `McpClientOptions`：扩展了 `Implementation`，另有可选的 `capabilities`、`protocolVersion`、`requestTimeoutMs`、`roots`。
- `McpRequestOptions`：`{ signal?, timeoutMs?, onProgress? }`，每个请求都可以单独设置超时和取消信号。
- `McpClient`：`connect(transport)` 完成初始化；`listTools(options?)`、`callTool(...)`、`close()` 是常用方法。
- `LlmContent`：`{ type: "text", text }` 或 `{ type: "image", data, mimeType }`。这是 pi 能直接放进模型上下文的内容形状。

**工具名如何进入 pi。** coding-agent 的 `packages/coding-agent/src/core/mcp-servers.ts` 中，`mcpNamespace(server)` 返回 `mcp__` 加上服务器名（`-` 换成 `_`）。`packages/coding-agent/src/extensions/mcp/tools.ts` 再拼出 `mcp__<server>__<tool>`，并把其中不是字母、数字、下划线的字符换成 `_`。因此模型看到的工具名只含合法字符。

**与 coding-agent 的关系。** coding-agent 导入 `@earendil-works/pi-mcp` 共 4 处，导入 `@earendil-works/pi-mcp/oauth` 共 2 处。涉及的文件是 `src/extensions/mcp/` 下的 `oauth.ts`、`resources.ts`、`runtime.ts`、`tools.ts`。`packages/coding-agent/docs/mcp.md` 描述了配置文件、暴露方式和连接生命周期；这些内容属于 coding-agent 的文档，本篇不展开。

**读的顺序。**

1. `packages/mcp/src/client.ts`：看 `McpClient` 的连接、列工具和调工具。
2. `packages/mcp/src/protocol/content.ts`：看 `toLlmContent`，尤其是 `structuredContent` 的回退规则。
3. `packages/mcp/src/transports/stdio.ts`：看子进程传输如何收发消息。
4. `packages/coding-agent/src/extensions/mcp/tools.ts`：看 pi 如何给工具命名。

**注意。** MCP 服务器是外部代码和外部数据源。它返回的内容应被当作不可信输入处理。

## 15.7 codemode（`@earendil-works/pi-codemode`）

**问题。** 模型要处理 30 个文件时，如果一个个调用工具，每个结果都会进入上下文。上下文很快被占满，成本也随之上升。

codemode 的做法是：模型写一段 JavaScript，这段程序在沙箱中运行，循环、过滤、并行调用工具，最后只把摘要返回给模型。大结果留在脚本里被消化，不进入模型上下文。

**核心符号**（位于 `packages/codemode/src/`）。

- `CodemodeSandbox`（`runtime/host.ts`，class）：沙箱对象。构造参数是 `CodemodeSandboxOptions`（`types.ts`），其中有 `tools`、`globals`、`timeoutMs`（默认 300000）、内存上限等。
- `sandbox.execute(code, options?)`（`runtime/host.ts`）：运行一段脚本，返回 `CodemodeResult`（`types.ts`）。
- 脚本可用的全局对象：`tools`、`ALL_TOOLS`、`text()`、`image()`、`store()`、`load()`，由 `runtime/prelude-source.ts` 构建。
- `toCodemodeIdentifier(name)`（`identifier.ts`）：把工具名中不能作为 JavaScript 标识符的字符替换为 `_`。例如 `my-tool` 变成 `my_tool`。

**为什么要让脚本来做。** 假设要读 30 个文件，每个约 20 KB，只需要它们的标题。如果模型逐个调用，30 份全文都会进入上下文，约 600 KB。如果用脚本，脚本循环读取，只用 `text()` 输出 30 行标题，模型只看到几百字节。阅读成本从模型转移到了程序。

**最小例子。** 下面是示意，本地未运行。`CodemodeTool` 的字段以 `packages/codemode/src/types.ts` 为准。

```ts
import { CodemodeSandbox } from "@earendil-works/pi-codemode";

const sandbox = new CodemodeSandbox({
  tools: [
    {
      name: "echo",
      description: "Return the same arguments",
      execute: async (args) => args,
    },
  ],
});

const result = await sandbox.execute(`text(await tools.echo({ msg: "hi" }))`);
// 预期 result.ok 为 true，output 中含有文本 "hi"；本地未运行
```

**结果的两种形状。** `CodemodeResult` 是一个判别联合（task-00 中讲过的概念）：

- `{ ok: true, value, output, calls, storeWrites }`：脚本成功。
- `{ ok: false, error, output, calls }`：脚本失败。失败是返回值，不是 reject。

**脚本里工具调用的返回形状**（依据旧稿引用的 `packages/codemode/README.md`，本地未逐行核对）：

| 工具类型 | 脚本中得到的值 |
| --- | --- |
| 声明了 `outputSchema` 的工具 | 结构化值（`structuredContent`） |
| `bash` | 包含 `output`、`exit_code` 等字段的对象；非零退出码不会 reject |
| MCP 工具 | 完整的 `CallToolResult`，含 `isError` |
| 其他工具（如 `read`） | 文本 |

失败或参数非法的调用会 reject，错误信息带着工具的错误文本。`Promise.allSettled()` 可以保留成功的部分。

**沙箱的边界。** 脚本里没有 Node API、文件系统、网络和定时器。但脚本可以通过 `tools` 调用宿主注入的工具，工具本身可能有副作用。脚本失败时，已经发生的工具调用不会被撤销。

**目录结构。** `packages/codemode/src/` 的真实文件如下。

```text
packages/codemode/src/
├── index.ts
├── types.ts            CodemodeTool、CodemodeSandboxOptions、CodemodeResult 等
├── identifier.ts       toCodemodeIdentifier：工具名转成合法标识符
├── declarations.ts     把工具的 schema 渲染成脚本可见的 TypeScript 声明
├── source.ts           解析脚本开头的 // @options: 行
├── wasm.ts             loadQuickJSWasm：加载 QuickJS 的 wasm 模块
└── runtime/
    ├── host.ts         CodemodeSandbox 类与 execute()（宿主线程）
    ├── worker.ts       沙箱所在的 worker 线程入口
    ├── prelude-source.ts  构造 tools、ALL_TOOLS、text()、store() 等全局对象
    └── protocol.ts     宿主与 worker 之间的消息形状
```

**核心类型（字段名以 `types.ts` 为准）。**

- `CodemodeTool`：`name` 必填；`description?`、`inputSchema?`、`outputSchema?` 可选；`execute(args, context)` 执行真正的工作。`context.signal` 在脚本结束、超时或取消时被中止。
- `CodemodeSandboxOptions`：`tools?`、`globals?`、`timeoutMs?`（缺省 300000）、`memoryLimitBytes?`、`wasm?`、`workerUrl?`。
- `CodemodeResult`：判别联合。`ok: true` 时有 `value`、`output`、`calls`、`storeWrites`；`ok: false` 时有 `error`、`output`、`calls`。
- `CodemodeError`：`kind` 是 `"script" | "timeout" | "aborted" | "sandbox"` 之一。脚本抛错是 `"script"`，超时是 `"timeout"`。

**与 coding-agent 的关系。** coding-agent 的 `packages/coding-agent/src/extensions/codemode/` 目录含有 `execute.lazy.ts`、`execute.ts`、`index.ts`、`renderer.ts`、`tool.ts`、`worker.ts`。其中 `execute.ts` 导入 `@earendil-works/pi-codemode`，`tool.ts` 导入它以及 `@earendil-works/pi-codemode/declarations`、`@earendil-works/pi-codemode/source` 两个子路径。它如何把 pi 自己的工具和 MCP 工具注入沙箱，本篇未逐行核对。

**注意。** 不要把沙箱理解成"完全安全的环境"。它隔离的是执行环境；能做什么，取决于你注入了哪些工具。

## 15.8 telemetry（`@earendil-works/pi-telemetry`）

**问题。** 你想知道一次请求哪一段慢、哪一次失败。但记录这些信息不能改变业务结果：记录失败不能让请求失败，记录的内容也不能被当成持久状态。

**核心符号**（位于 `packages/telemetry/src/`）。

- `TelemetryContext`（`index.ts`，interface）：能开始新 span 的上下文。
- `InMemoryTelemetryContext`（`memory.ts`，class）：内存实现，用于测试。`getSpans()` 返回按开始顺序排列的快照。快照不含时间戳，所以结果是确定的。
- `NOOP_TELEMETRY_CONTEXT`（`noop.ts`）：空实现。没有配置后端时使用它。
- `defineTelemetrySchema(schema)`（`index.ts`）：定义封闭的 span 名和属性集合。
- `createTypedSpanStarter(context, schemas)`（`index.ts`）：根据 schema 生成类型检查过的 span 启动函数。

**一次操作的 span 树**（示意，取自 `packages/telemetry/README.md` 的结构）：

```text
example.account.load                span
├─ attributes: account.id=123, found=true
├─ event: example.cache.lookup
│  └─ attribute: cache.hit=false
└─ status: ok
```

**没有公共 `end()`。** `startSpan(options, callback)` 的回调返回或抛错时，span 自动结束。这样就不会出现"忘记结束"或"重复结束"。

**最小例子。** 下面是示意，取自旧稿的结构，本地未运行。

```ts
const telemetry = new InMemoryTelemetryContext();
await telemetry.startSpan({ name: "example.operation", attributes: { input: "demo" } }, async (span) => {
  span.addEvent("example.started");
  span.setAttributes({ output_count: 3 });
});
console.log(telemetry.getSpans());
```

**目录结构。** `packages/telemetry/src/` 的真实文件如下。

```text
packages/telemetry/src/
├── index.ts          接口、schema 定义函数、类型化 span 启动器
├── memory.ts         InMemoryTelemetryContext（记录 span，用于测试）
├── noop.ts           NOOP_TELEMETRY_CONTEXT（什么都不记录）
└── testing/
    ├── conformance.ts  适配器一致性测试的用例
    ├── index.ts
    └── types.ts
```

**核心类型（字段名以 `index.ts` 为准）。**

- `TelemetryContext`：只有一个方法 `startSpan(options, callback)`。callback 返回后 span 自动结束。
- `TelemetrySpan`：继承 `TelemetryContext`，额外有 `addEvent(name, attributes?)`、`setAttributes(attributes)`、`setStatus(status)`。
- `SpanOptions`：`{ name, attributes? }`。属性值只能是字符串、数字、布尔值或它们的数组。
- `SpanStatus`：`{ status: "ok" }` 或 `{ status: "error", error? }`。

**一个最小的记录器。** 下面的写法在源码中有对应的类型，但本地未运行。

```ts
const telemetry = new InMemoryTelemetryContext();
await telemetry.startSpan({ name: "demo" }, (span) => {
  span.setAttributes({ items: 3 });
});
telemetry.getSpans(); // 只读快照，不含时间戳
```

**与 coding-agent 的关系。** coding-agent 的源码中没有直接导入 `@earendil-works/pi-telemetry`。`packages/ai/src/types.ts` 第一行导入了 `TelemetryContext` 类型（只导入类型，不导入运行时代码）。该类型用于请求选项，具体传播路径本篇未逐行核对。

**读的顺序。**

1. `packages/telemetry/src/index.ts`：看 `TelemetryContext`、`TelemetrySpan` 与 schema 相关的类型。
2. `packages/telemetry/src/noop.ts`：看没有后端时的空实现，它说明"记录失败不影响业务"是怎样做到的。
3. `packages/telemetry/src/memory.ts`：看 `getSpans()` 如何生成确定性的快照。
4. `packages/telemetry/src/testing/conformance.ts`：看适配器必须满足的行为（例如错误时 span 的状态）。

**注意。** 遥测是进程内的诊断信息，不是持久状态。属性里不要放 prompt、文件内容、工具参数、凭据或请求头。

## 15.9 evals（`@earendil-works/pi-evals`）

**问题。** 你改了提示词，或者加了一个扩展，怎样判断结果"更好"？一次成功不能证明稳定；一次失败也不能证明变差。需要的是固定任务、成对比较、足够的重复次数，以及对缺失数据的诚实处理。

评测要和另外两种证据分开：

| 问题 | 证据 |
| --- | --- |
| 代码是否正确 | 确定性的单元测试（task-14） |
| 任务成功率是否提升 | 配对评测（本包） |
| 运行是否变快或变便宜 | 耗时、用量、遥测（本包之外的 telemetry） |

**核心符号**（位于 `packages/evals/src/`）。

- `DOCUMENTATION_VARIANTS = ["without_docs", "with_docs"]`（`plan.ts`）：两组对照的名称。
- `createTaskPlan(...)`（`plan.ts`）：把每个 `(case, variant, runNumber)` 展开成计划队列。
- `summarizeEvalObservations(...)`、`formatEvalComparisonReport(...)`（`report.ts`）：配对观测结果，计算提升（lift），生成报告。
- `createPiDocumentationEvalHarness(...)`（`harness.ts`）：创建文档评测的 harness。它只允许 `DOCUMENTATION_EVAL_TOOLS` 中的工具：`read`、`write`、`edit`、`grep`、`find`、`ls`。
- 两种评测文件：`*.docs.eval.ts` 做成对比较；其他 `*.eval.ts` 是宿主评测，不做成对比较。文件位于 `packages/evals/evals/`。

**为什么单次运行会误导。** 假设改了提示词后，同一个任务这一次通过了。这只说明这一次通过。模型输出有随机性，下一次可能失败。所以评测要求固定任务、两组对照、多次重复，并且两组的运行要一一配对。

**配对规则。** 一对的两臂各恰好有一个分数，才计入通过率提升。只要任一臂缺失、重复、跳过或报错，这一对就被阻断。只要有一对被阻断，报告就不显示头条通过率。

**最小例子。** 下面是示意，取自旧稿结构。它依赖 `vitest-evals`，本地未运行。运行它会调用真实模型并产生费用，执行前需要确认预算和供应商。

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

**目录结构。** `packages/evals/src/` 与 `packages/evals/evals/` 的真实文件如下。

```text
packages/evals/src/
├── plan.ts       DOCUMENTATION_VARIANTS、EvalTask、createTaskPlan
├── report.ts     EvalObservation、BlockedPair、summarizeEvalObservations、formatEvalComparisonReport
├── harness.ts    createPiDocumentationEvalHarness、DOCUMENTATION_EVAL_TOOLS
├── docker.ts     buildImages、createDockerContext、runTask
└── cli.ts        命令行入口

packages/evals/evals/
├── documentation-audit.eval.ts
├── smoke.eval.ts          宿主评测（不做成对比较）
├── custom-provider.docs.eval.ts
├── extensions.docs.eval.ts
├── models.docs.eval.ts
├── openai-provider.docs.eval.ts
├── tui.docs.eval.ts       *.docs.eval.ts 做成对比较
└── acme-server.ts、configured-runtime.ts   辅助文件
```

**核心类型（字段名以源码为准）。**

- `DocumentationVariant`：`"without_docs" | "with_docs"`，即两个对照组。
- `EvalTask`：一个被展开后的任务，它包含 case 信息和运行次数。`createTaskPlan` 会为每个 `(case, variant, runNumber)` 生成一项。
- `EvalObservation`：一次运行的观测结果，它与 `EvalRunIdentity` 相交，因此带有 `variant` 与运行编号。
- `BlockedPair`：`{ reasons: string[] }` 加上标识字段。它记录某一对为什么不能计入结论。
- `EvalComparisonReport`：汇总后的报告。阻断的配对存在时，头条通过率不显示。

**与 coding-agent 的关系。** coding-agent 不导入 `@earendil-works/pi-evals`（已用 Grep 核对）。评测通过 `packages/evals/src/harness.ts` 与 `packages/evals/src/docker.ts` 启动 coding-agent，并在隔离环境中运行。`docker.ts` 的细节本篇未逐行核对。

**读的顺序。**

1. `packages/evals/src/plan.ts`：看对照组与任务展开。
2. `packages/evals/src/report.ts`：看 `summarizeEvalObservations` 如何配对，以及 `formatEvalComparisonReport` 如何输出。
3. `packages/evals/src/harness.ts`：看文档评测允许的工具列表 `DOCUMENTATION_EVAL_TOOLS`。
4. `packages/evals/README.md`：看运行评测的前置条件（运行前需要确认费用与供应商）。

**注意。** 低分是数据，不是基础设施故障。`judgeThreshold: null` 的作用就是保留低分，让报告如实记录。

## 15.10 session-backends/sqlite-node（不是 npm 包）

**它是什么。** 这个目录名看起来像一个包，但它不是 npm 包。

本地检查的结果：

- `packages/session-backends/sqlite-node/` 下只有一个 `dist/` 目录。
- 没有 `package.json`，没有 `src/` 目录，也没有 `tsconfig` 文件。
- 因此它不能用 `npm install` 安装，也不能用 `npm run check` 检查。文档中也不应把它写成 `@earendil-works/...` 包名。

**判断一个目录是不是包的方法。** 先看目录下有没有 `package.json`，再看它的 `name` 字段。有 `name` 才是 npm 包。实验 1 只对 `protocol` 与 `durable` 运行了这个检查；其余包可以用同样的命令检查，本篇未逐个运行。`sqlite-node` 没有 `package.json`，实验 2 确认了这一点。

**为什么要分清。** 如果把 `sqlite-node` 当成包来写文档，读者会去 `npm install` 它，结果找不到。正确的入口是 durable 中的源码，因为那里有可以读的实现。

**SQLite 存储的源码在哪里。** 本地可读的源码位于 `packages/durable/src/storage/sqlite/`，其中 `node.ts` 导出 `openNodeSqliteStorage`。读 SQLite 相关代码时，从这里开始。

**它的目录内容。** 本地列出的文件只有：

```text
packages/session-backends/sqlite-node/
└── dist/
    ├── index.js
    ├── index.d.ts
    ├── index.js.map
    ├── index.d.ts.map
    └── sqlite/          子文件未逐个列出
```

**读的顺序（SQLite 源码，位于 durable）。**

1. `packages/durable/src/storage/sqlite/node.ts`：看 `openNodeSqliteStorage`（一个 `async` 函数）与 `NodeSqliteDatabase`。
2. `packages/durable/src/storage/sqlite/storage.ts`：看 `SqliteStorage` 如何实现 `Storage` 接口。
3. `packages/durable/src/storage/sqlite/migrations.ts`：看 `SQLITE_MIGRATIONS` 与当前 schema 版本。
4. `packages/durable/src/storage/sqlite/database.ts`：看 `SqliteExecutor` 与 `SqliteDatabase` 接口。

**未在本地验证。** `dist/` 中的内容的用途，以及它是否被其他包引用。

## 走读一次完整过程

下面用"读两个远端文件并汇总"这个例子，把前面的包串起来。这是示意流程：每一步的函数都存在于源码中，但整条链路没有在本地运行。

1. 启动时，`McpClient`（`packages/mcp/src/client.ts`）连接配置的服务器，调用 `listTools()` 取得工具列表。coding-agent 按 `mcp__<server>__<tool>` 给工具命名（`packages/coding-agent/src/core/mcp-servers.ts`）。
2. 模型提出一段脚本，交给 `CodemodeSandbox.execute()`（`packages/codemode/src/runtime/host.ts`）。
3. 脚本里 `tools.mcp__repo__read(...)` 的调用经过沙箱的宿主桥转发到宿主线程。宿主执行真正的工具（这里是 `McpClient.callTool`），再把 JSON 结果送回沙箱。
4. 脚本拿到两份结果，只用 `text()` 输出一句摘要。原始全文留在脚本内，不进入模型上下文。
5. `execute()` 返回 `CodemodeResult`。`ok` 为 `true` 时，模型只看到 `output`。
6. 如果这一步包在 durable 的工具里，并且工具声明为 `replay: "unsafe"`，进程若在这一步崩溃，重启后该调用不会重跑，模型收到中断的错误结果（`packages/durable/src/harness/tool.ts`）。
7. 每一步都可以用 `TelemetryContext.startSpan()` 包一层，记录耗时与错误。属性里不放文件内容。
8. 评测时，同一任务在 `without_docs` 与 `with_docs` 下各跑若干次。`createTaskPlan()` 展开计划，`formatEvalComparisonReport()` 配对计算提升。任一配对被阻断，就不报告头条结果。

## 失败路径速查

| 场景 | 在哪一层发现 | 最终状态 | 源码入口 |
| --- | --- | --- | --- |
| MCP 连接失败 | `McpClient` | 连接错误与工具调用错误分开表示 | `packages/mcp/src/client.ts` |
| 脚本运行时抛错 | `CodemodeSandbox.execute()` | 返回 `{ ok: false, error, output, calls }`；已发生的调用不回滚 | `packages/codemode/src/runtime/host.ts` |
| 脚本超时 | `CodemodeSandbox.execute()` | 由 `timeoutMs`（默认 300000）决定；宿主终止 worker | `packages/codemode/src/types.ts` |
| 进程崩溃，工具为 `unsafe` | durable 的工具任务 | 不重跑；模型收到中断的错误结果（旧稿称 `interrupted`，字符串未在本地核对） | `packages/durable/src/harness/tool.ts` |
| 断线时有未完成的请求 | `Client.request()` | 本地 reject；远端可能已经完成 | `packages/client/src/client.ts` |
| 使用旧的 `attachmentId` | 服务器 | 被拒绝；需要重新 attach | `packages/server/src/server.ts`（规则见 `packages/protocol/README.md`） |
| 评测中某一臂缺失 | `report.ts` | 该配对被阻断，头条通过率被扣留 | `packages/evals/src/report.ts` |

## 与主线的对照

进阶包并不是新的概念体系。每一个包都对应主线中的一个概念，只是放到了跨进程、断线、崩溃或评测的场景里。

| 主线概念（coding-agent） | 进阶包中的对应 | 差别 |
| --- | --- | --- |
| 会话 JSONL 记录（task-09） | durable 的转录、文档与任务 | durable 多了检查点与原子提交，崩溃后能继续执行 |
| 工具调用（task-06） | `mcp` 的外部工具，`codemode` 的脚本调用 | 工具可以在远端；调用可以在脚本内组合，只返回摘要 |
| 进程内 RPC（task-12 的 JSONL） | `protocol`、`client`、`server` | 跨进程、按会话路由、断线语义明确 |
| 事件订阅（task-03） | `chord` 的订阅与复制状态 | 订阅先拿到完整快照，再接收增量；慢的读者只保留最新值 |
| 测试（task-14） | `evals` | 测的是任务成功率，不是代码是否符合断言 |

## 常见误解

1. **误解：protocol 就是 pi 的 RPC 模式。** 实际上，task-12 的 JSONL RPC 通过同一进程的标准输入输出通信。protocol 是跨进程的字节帧，并且按服务和会话路由。
2. **误解：durable 是一种更好的会话文件。** durable 解决的是崩溃后的执行恢复，不是对话记录。普通会话仍然是主线。
3. **误解：codemode 是安全沙箱，可以运行任意代码。** 它隔离的是执行环境。脚本能做的事，取决于注入了哪些工具。
4. **误解：client 断线后会自动恢复。** 它不会自动重连，也不会重放请求。调用方要显式处理。
5. **误解：evals 一次通过就证明了改进。** 需要固定任务、重复运行和配对比较。缺失的数据要阻断结论，不能当零。
6. **误解：telemetry 能决定请求成功还是失败。** 它只观察。span 的记录失败不应改变业务结果。
7. **误解：sqlite-node 是可以 `npm install` 的包。** 它只有 `dist/` 产物，没有 `package.json`。

## 动手实验

本篇的实验只做只读检查，不需要模型，也不需要密钥。临时文件本篇不需要。

### 实验 1：确认包名（5 分钟）

目的：确认每个进阶目录对应的 npm 名。

PowerShell：

```powershell
cd D:\Github\pi
node -p "require('./packages/protocol/package.json').name"
node -p "require('./packages/durable/package.json').name"
```

bash：

```bash
cd /d/Github/pi
node -p "require('./packages/protocol/package.json').name"
node -p "require('./packages/durable/package.json').name"
```

预期输出（本地已运行）：

```text
@earendil-works/pi-protocol
@earendil-works/pi-durable
```

### 实验 2：确认 sqlite-node 不是包（2 分钟）

目的：确认 `session-backends/sqlite-node` 只有产物目录。

PowerShell：

```powershell
Get-ChildItem D:\Github\pi\packages\session-backends\sqlite-node
```

bash：

```bash
ls /d/Github/pi/packages/session-backends/sqlite-node
```

预期输出（本地已运行）：只有一个 `dist` 目录，没有 `package.json`。

### 实验 3：查 coding-agent 对进阶包的导入（5 分钟）

目的：确认哪些进阶包被 coding-agent 直接导入。

bash（本地已运行）：

```bash
cd /d/Github/pi
grep -rlE "@earendil-works/pi-(protocol|client|server|mcp|codemode|durable)" packages/coding-agent/src | sort
```

预期（本地实际输出约 40 行）：结果包括 `packages/coding-agent/src/experimental/services/` 下的 `server.ts`、`sessions.ts`、`worker.ts` 等文件，以及 `packages/coding-agent/src/extensions/codemode/execute.ts`、`tool.ts`、`worker.ts`，还有 `packages/coding-agent/src/extensions/mcp/` 下的文件。结果中没有 `telemetry` 与 `evals` 相关文件。

PowerShell 写法（未在本地验证）：

```powershell
cd D:\Github\pi
Get-ChildItem packages\coding-agent\src -Recurse -Filter *.ts | Select-String -Pattern "@earendil-works/pi-(protocol|client|server|mcp|codemode|durable)" | Select-Object -ExpandProperty Path -Unique
```

## 自测题

1. `ServerMessageDecoder.push()` 返回空数组时，是错误吗？为什么 `end()` 也要调用？
2. 客户端断线后，为什么不自动重放未完成的请求？举一个具体的副作用例子。
3. codemode 脚本中一次 `tools.x()` 调用已经发生，随后脚本抛错。这次调用会被撤销吗？
4. 为什么评测中"缺失数据不能当零"？如果把缺失当零，会发生什么？
5. telemetry 的 span 能不能用来决定请求是否成功？为什么？

### 参考答案

1. 不是错误。它表示这一块数据不足以组成完整的消息。`end()` 用来发现流在一条消息中途结束，此时抛出错误。
2. 请求可能已经在远端执行完成，客户端只是收不到结果。如果自动重放，"发送一封邮件"这样的操作会发送两次。
3. 不会。工具调用真实发生，脚本失败不回滚。需要回滚的场景要由工具或调用方自己设计。
4. 缺失可能是基础设施故障，不是能力下降。把它当零，会把故障误报为能力下降，也会让提升的结论失真。
5. 不能。span 只是观察记录，不参与业务。记录失败或内容不应改变请求的结果，也不应被写进消息或快照。

## 常见错误

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 把普通 JSONL 会话当成持久执行日志 | JSONL 只记录发生过什么，没有检查点 | 需要崩溃恢复时使用 durable 的 `Harness` 与任务检查点 |
| 有副作用的工具标成 `replay: "safe"` | 重启后工具被重跑，副作用重复 | 有副作用的工具使用 `"unsafe"`，或者自己实现幂等键 |
| 重连后继续使用旧的 `attachmentId` | 旧附着已经失效，服务器会拒绝陈旧路由 | 重新 attach，使用新的附着 ID |
| 用一次评测结果宣布提升 | 单次结果不能证明稳定性 | 增加重复次数，使用配对报告，看阻断的配对 |
| 在遥测属性里放 prompt 或文件内容 | 遥测会被导出到后端，内容可能包含敏感信息 | 属性只放标量和数组；敏感字段需要 schema 与数据政策明确允许 |

## 选读：源码深入（跳过不影响主线）

以下内容超出主线，可以跳过。

### A. 帧解码器的分片处理

`ServerMessageDecoder` 内部维护一个缓冲区。`push()` 每收到一块数据，先把它追加到缓冲区，再循环检查：缓冲区是否至少有 4 字节？如果有，读出长度 `n`，检查缓冲区是否至少有 `n` 字节。如果够，就解码这 `n` 字节为一个 CBOR 项，并把它加入结果数组。这个循环在一次 `push()` 中可能产生零条、一条或多条消息。

`maxFrameLength` 选项限制单帧的最大长度。超过限制时，解码器应当抛出 `ProtocolValidationError`，而不是无限等待。这个行为的具体代码位于 `packages/protocol/src/framing.ts`，本篇未逐行核对。

### B. durable 的任务与调度

`Harness` 把每个工具调用包装成一个任务。任务由调度器（`packages/durable/src/harness/scheduler.ts`）驱动，任务之间的依赖由 `packages/durable/src/harness/task-graph.ts` 描述。`Harness.open()` 会调用 `openTasks()`，把崩溃时仍处于 `running` 的任务改回 `pending`。之后 `resume()` 才真正开始调度。

这就是为什么"打开"和"恢复"是两步：先把状态对齐，再决定何时执行。

### C. codemode 沙箱的实现

每次 `execute()` 都会启动一个新的 worker 线程，并在其中创建一个新的 QuickJS 虚拟机。虚拟机是从 WebAssembly 模块实例化的，因此每次执行都有独立的内存。虚拟机对外只有两类导入：WASI 垫片（时钟、随机数，以及被丢弃的标准输出）和一个宿主调用入口。脚本无法通过其他方式访问宿主。

超时或取消时，宿主设置一个共享的中断标志，虚拟机会轮询它；随后调用 `worker.terminate()`。中断标志是必要的，因为在某些运行时上，`terminate()` 无法停止在 WebAssembly 中空转的线程。

本地核对（`packages/codemode/src/runtime/prelude-source.ts`）：`MAX_OUTPUT_CHARS = 16 * 1024 * 1024`，`MAX_OUTPUT_ITEMS = 100_000`，`MAX_STORE_VALUE_CHARS = 256 * 1024`，`MAX_STORE_TOTAL_CHARS = 1024 * 1024`。README 中的数字本篇未逐条核对。

### D. chord 的订阅与帧策略

chord 的订阅默认最多保留 100 个待交付的完整值。溢出时，只保留最新值，所以交付序列允许跳号。这是一种背压策略：宁可丢掉中间状态，也不让慢的读者拖垮系统。

旧稿还描述了 provider 侧的 `{ type: "reset", snapshot }` 元操作。本地未逐条核对这些数字与行为，请以 `packages/chord/README.md` 与源码为准。

### E. chord 的插件打包与热替换

旧稿说明插件在 `package.json` 的 `chord.facets` 字段中声明分片入口，但本地检查 `packages/chord/package.json` 时没有找到该字段，因此这一点未在本地验证。打包器（`packages/chord/src/node/bundle.ts`）把分片编译成独立的 CJS 文件。加载器（`packages/chord/src/facets/loader.ts`）按旧稿描述在每次加载时校验 SHA-256。热替换的顺序是：先加载候选版本，再调用 `FacetHost.reload()` 切换，最后释放旧版本。这个顺序保证服务句柄不断开。

以上打包与加载细节，本篇只检查了文件存在，未逐行核对。

### F. evals 的隔离细节

旧稿描述了文档评测的隔离方式：两个变体都安装同一批本地工作区 tarball；`without_docs` 变体删除 coding-agent 的 README、CHANGELOG、`docs/` 与 `examples/`；评测定义和 fixtures 归 root 所有，harness 降权后不可读；每次运行使用全新的 home、工作区和会话目录。

这些细节主要在 `packages/evals/src/docker.ts` 与 `packages/evals/src/harness.ts` 中。本篇未逐行核对。

### G. telemetry 的类型化 schema

`defineTelemetrySchema` 返回的对象在类型层面推断出精确的 span 名、属性和事件。`createTypedSpanStarter` 把这些类型交给调用方，使得用错的属性名或 span 名在编译期就会报错。

pi 各包的分工（据旧稿）：`telemetry` 拥有契约与工具；`ai` 传播 `telemetryContext`，不拥有 schema；`agent-core` 拥有 `pi.ai.*` 与 `pi.harness.*` 的 schema。`agent-core` 部分本地未验证。

## 下一篇

下一篇是 task-16（毕业项目）。它要求你把前面学过的主线和进阶系统的边界用于一个可评审的小改动，并说明它的失败路径与测试为什么有效。

## 术语小结

| 术语 | 一句话定义 | 首次出现的小节 |
| --- | --- | --- |
| 帧（frame） | 长度前缀加一条消息，用来在字节流中切分消息 | 15.1 protocol |
| CBOR | 一种二进制数据编码格式，可理解为二进制版 JSON | 15.1 protocol |
| 解码器（decoder） | 把任意分片的字节流还原成完整消息的对象 | 15.1 protocol |
| 路由标识（serverId、sessionId、attachmentId） | 决定一次请求去哪个服务器、会话和附着的三个 ID | 15.3 server |
| 附着（attachment） | 一条表现层连接绑定到一个会话的状态 | 15.3 server |
| 服务（service） | chord 中类型化、稳定的服务标识 | 15.4 chord |
| 复制状态（replicated state） | 整体原子发布、消费者只读的权威状态 | 15.4 chord |
| 分片（facet） | 插件的一部分，可以被打包到不同进程或环境 | 15.4 chord |
| 检查点（checkpoint） | 任务每一步之后的持久化落点 | 15.5 durable |
| 重放策略（replay） | 崩溃后工具是否允许重跑，取值 `safe` 或 `unsafe` | 15.5 durable |
| MCP | Model Context Protocol，外部工具和资源的接入协议 | 15.6 mcp |
| 沙箱（sandbox） | 隔离脚本执行环境的机制；它不隔离脚本通过工具获得的能力 | 15.7 codemode |
| span | 一次操作的开始与结束时间记录，可以嵌套 | 15.8 telemetry |
| 提升（lift） | 处理组相对对照组的通过率差值 | 15.9 evals |
| 阻断配对（blocked pair） | 两臂未各得恰好一个分数的配对，它会阻止头条结果的报告 | 15.9 evals |

## 包的阅读入口

| 包 | 什么时候读 | 第一个打开的文件 |
| --- | --- | --- |
| protocol | 需要了解字节格式，或想知道非法输入如何被拒绝 | `packages/protocol/src/codec.ts` |
| client | 写界面连接远端会话，或处理断线 | `packages/client/src/client.ts` |
| server | 研究会话路由与附着 | `packages/server/src/server.ts` |
| chord | 研究跨环境服务、复制状态、插件分片 | `packages/chord/src/api.ts` |
| durable | 研究崩溃后的任务恢复与工具重放策略 | `packages/durable/src/harness/harness.ts` |
| mcp | 接入外部 MCP 服务器，或排查连接与工具调用 | `packages/mcp/src/client.ts` |
| codemode | 研究模型写脚本调用工具的路径 | `packages/codemode/src/runtime/host.ts` |
| telemetry | 给操作加 span，或写测试用的记录器 | `packages/telemetry/src/index.ts` |
| evals | 设计对比实验，或读评测报告 | `packages/evals/src/report.ts` |
| session-backends/sqlite-node | 确认它是否为包（它不是）；读 SQLite 存储源码 | `packages/durable/src/storage/sqlite/node.ts` |
