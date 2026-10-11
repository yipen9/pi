# 00. TypeScript 核心

> 预计时间：6 小时（估算，未计时）
> 先修：无。会一门编程语言即可，不需要读过 pi 源码。

## 本篇你会学到

- 读懂 pi 仓库里常见的 TypeScript 写法：类型、接口、联合、可选链、泛型、`async`/`await`、ESM 导入导出。
- 分清哪些写法只在 `tsc` 静态检查时存在，哪些会在 Node.js 运行时执行。
- 为外部输入写运行时校验，并解释为什么类型断言不能代替校验。

## 先用一个例子理解

假设一个任务数据来自网络，内容是 `{"id":"bad","values":["5"]}`，其中 `values` 应该是数字，实际是字符串。下面的代码能通过编译，但结果是错的：

```typescript
type Job = { id: string; values: number[] };

const fromNetwork: unknown = JSON.parse('{"id":"bad","values":["5"]}');
const job = fromNetwork as Job; // 类型断言：告诉编译器“相信我”，运行时不检查。
const total = job.values.reduce((sum, value) => sum + value, 0);
console.log(JSON.stringify(total), typeof total); // 输出 "05" string
```

在 JavaScript 中，`0 + "5"` 得到字符串 `"05"`。没有异常，错误值继续向后传。TypeScript 只检查你写的代码，检查不到运行时传进来的数据。

这个问题有两种解法，分别对应本篇的第二层：

- 不做断言，先把数据当作 `unknown`，再用类型守卫逐项检查（见 2.2 和 2.3）。
- 检查失败时返回明确的错误结果，而不是继续计算（见 2.1 的判别联合）。

## 核心概念

本篇分三层。第一层（1.1–1.7）是读懂仓库必需的内容。第二层（2.1–2.5）是仓库中反复出现的模式。第三层（类型声明文件、品牌类型、抽象类、模板字面量类型、JSON 导入、`import.meta`）放在文末“选读”。

### 第一层：必须会（读懂仓库）

#### 1.1 类型注解、类型推断与字面量类型

**类型注解**是写在名字后的类型说明，例如 `value: number`。**类型推断**是编译器根据初始值推算出的类型。**字面量类型**是只允许某一个具体值的类型，例如 `"idle"`。

为什么需要：函数的参数和返回值要写清楚，调用者才知道如何使用它。局部变量交给推断即可，避免重复书写。

```typescript
function double(value: number): number { // 参数和返回值都承诺是 number。
  return value * 2;
}

const answer = double(21); // 编译器从返回类型推断 answer 为 number。
console.log(answer); // 运行时输出 42。
// double("21"); // 取消注释后 tsc 报错：string 不能交给 number 参数。
```

类型注解在运行时不存在。`double("21")` 如果不经过 `tsc`，JavaScript 会把它强制转换后继续计算，所以“恰好跑出结果”不等于调用正确。

`let` 与 `const` 推断的类型不同：

```typescript
let count = 0; // 推断为 number；let 允许之后重新赋值。
count += 1;
const title = "TypeScript"; // const 不能重新赋值，类型保留字面量 "TypeScript"。
```

仓库例子：`packages/coding-agent/src/config.ts` 中的 `isBunBinary` 没有写类型注解，它的类型由 `||` 的结果推断为 `boolean`。

练习 1：把 `double` 的返回表达式改为 `String(value * 2)`，记录 `tsc` 的错误。分别修复“返回类型”和“返回值”，说明两种修复的区别。自检：把返回类型改成 `string` 后，`answer` 是字符串；保留 `number` 并恢复数字表达式后，`answer` 仍是数字。不要只看控制台的 `42`，还要检查它是数字还是字符串。

#### 1.2 interface、type、可选字段与 readonly

**对象类型**描述一个对象应有的字段。`interface` 和 `type` 都可以写它。**可选字段** `email?: string` 表示字段可以缺席。**readonly** 表示不能通过这个类型的引用重新赋值。**交叉类型** `A & B` 表示同时满足 A 和 B。

为什么需要：字段名拼错、必填字段缺失，都能在写代码时被发现。它只描述形状，不负责创建对象。

```typescript
interface User {
  readonly id: string; // 必填，只能读取，不能重新赋值。
  name: string; // 必填且可修改。
  email?: string; // 可以缺席；读取时要处理 undefined。
}

type WithTimestamp = { createdAt: number };
type StoredUser = User & WithTimestamp; // 必须同时满足两个类型。

const user: StoredUser = { id: "u1", name: "Ada", createdAt: Date.now() }; // email 可省略。
user.name = "Ada L."; // name 可写。
// user.id = "u2"; // 取消注释后报错：id 是 readonly。
```

TypeScript 主要按结构检查：只要值有所需字段，就能用在对应位置，不要求它由某个类创建。对象字面量直接赋给明确类型时，还会检查多余字段，因此能抓住拼写错误。

数组的展开运算符 `[...]` 只复制外层数组。元素如果是对象，新旧数组仍共享同一个对象：

```typescript
const original = [{ value: 1 }];
const copied = [...original]; // copied 是新数组，但 copied[0] 与 original[0] 是同一个对象。
copied[0].value = 2; // 修改共享对象。
console.assert(original[0].value === 2); // 断言：original 也看到了修改。
```

`readonly` 是编译期约束，不会在运行时冻结对象。这一点在 2.1 与选读的 `as const` 中还会再遇到。

仓库例子：`packages/agent/src/types.ts` 中有多个 `export interface`（如 `BeforeToolCallResult`），这是接口的常见用法。`packages/ai/src/types.ts` 的 `JsonValue` 使用 `readonly JsonValue[]` 表示只读数组。

练习 2：给 `User` 增加可选 `nickname`；故意把 `createdAt` 写成 `createAt`，让 `tsc` 指出问题。再用 `interface Admin extends User` 增加 `permissions: string[]`，构造一个合法值。自检：不写 `nickname` 仍合法；`createAt` 不能替代必需的 `createdAt`；`Admin` 必须同时有 `id`、`name` 和 `permissions`。

练习 3：复制上面的 `original` 数组，分别执行 `copied.push({ value: 3 })` 和修改 `copied[0].value`，记录 `original` 的长度与首个对象的值。自检：追加元素时 `original.length` 仍为 1；修改共享对象时 `original[0].value` 同步变化。

#### 1.3 联合类型与基础收窄

**联合类型** `A | B` 表示值是 A 或 B 之一。**收窄**（narrowing）指根据 `typeof`、`===` 或 `if` 判断，让编译器确定当前值属于哪一支。

为什么需要：状态、模式和协议字段通常只有有限几个取值。用联合类型可以让无效值在写代码时就被拒绝，比任意 `string` 更精确。

```typescript
let status: "idle" | "running" = "idle"; // 字符串字面量联合。
status = "running"; // 合法：右侧是联合中的一个成员。
// status = "done"; // 取消注释后报错："done" 不在联合中。

function label(value: string | number): string {
  return typeof value === "string" ? value : value.toFixed(2); // typeof 把两个分支分别收窄。
}
```

`typeof value === "string"` 是运行时检查，它同时帮助编译器在两个分支中确定 `value` 的类型。字符串字面量联合适合替代 `enum`（见选读）。

仓库例子：`packages/ai/src/types.ts` 中的 `JsonValue` 是一个联合：`null | boolean | number | string | readonly JsonValue[] | JsonObject`。它还是递归的，数组元素可以再是 `JsonValue`。

练习 4：定义 `type Priority = "low" | "normal" | "high"`，编写 `let priority: Priority`，分别赋合法值和 `"urgent"`，观察 `tsc` 结果。再比较 `let level = "low"` 与 `const level = "low"` 的推断类型。自检：`"urgent"` 必须被拒绝；前者推断为 `string`，后者保留字面量 `"low"`。

#### 1.4 可选链与空值合并

**可选链** `?.` 在左侧为 `null` 或 `undefined` 时停止访问，整个表达式结果是 `undefined`。**空值合并** `??` 只在左侧为 `null` 或 `undefined` 时使用右侧默认值。**非空断言** `value!` 告诉编译器“这里一定有值”，运行时不检查。

为什么需要：字段可能缺席时，`strict` 模式要求你先处理缺失的情况。`??` 与 `||` 的区别很重要：`||` 会把 `0`、`false`、`""` 也当作需要回退。

```typescript
type Settings = { retries?: number; label?: string };
const settings: Settings = { retries: 0, label: "" }; // 0 和空串都是已提供的值。

const retries = settings.retries ?? 3; // 左边不是 null/undefined，结果为 0。
const wrongRetries = settings.retries || 3; // 0 是假值，结果误变成 3。
const firstLetter = settings.label?.[0] ?? "?"; // 空串的第 0 个字符是 undefined，结果为 "?"。
console.assert(retries === 0 && wrongRetries === 3 && firstLetter === "?"); // 验证三种结果。
```

只有当“所有假值都表示缺失”时才使用 `||`。非空断言 `!` 只让类型错误消失，外部数据上误用会变成运行时异常，边界输入应使用 `if (value === undefined)` 这样的真实判断。

仓库例子：`packages/coding-agent/src/config.ts` 中有 `npmCommand?.length ? undefined : getInferredNpmInstall()`，先用 `?.` 读取可能为空的 `npmCommand`。

练习 5：写 `function displayName(name?: string): string`。缺席时返回 `"anonymous"`，空字符串必须原样保留。用 `??` 实现，并对比 `||` 的错误行为。自检：`displayName()` 为 `"anonymous"`，`displayName("")` 为 `""`，`displayName("Ada")` 为 `"Ada"`。

#### 1.5 泛型基础、函数类型与重载

**泛型**是类型参数，写在 `<T>` 中。它像函数参数一样接收类型，让输入与输出的类型保持关联。**约束** `T extends X` 限制 `T` 至少具有 `X` 的结构。**`keyof T`** 是 `T` 所有字段名的联合，**`T[K]`** 是字段 `K` 的类型。

**函数类型**既约束参数，也约束返回值。**闭包**是记住定义时所在作用域的函数，它读取的是变量当前的值，而不是创建时的快照。**重载**是为同一个函数提供多个调用签名，实现体只写一次。

为什么需要：如果返回值的类型依赖输入的类型，写普通参数就只能退化成 `any` 或宽泛的联合。泛型让编译器保留“哪个键对应哪个类型”的关系。

```typescript
type Predicate<T> = (value: T) => boolean; // 函数类型：输入 T，返回是否保留。

function select<T>(values: readonly T[], test: Predicate<T>): T[] {
  return values.filter(test); // 不修改入参，返回新数组。
}

function makeThreshold(limit = 10): Predicate<number> {
  return (value) => value >= limit; // 闭包：读取定义时的 limit 参数。
}

const selected = select([3, 12, 17], makeThreshold(12)); // T 推断为 number。
console.assert(selected.join(",") === "12,17");

function getField<T extends object, K extends keyof T>(item: T, key: K): T[K] {
  return item[key]; // K 必须是 item 的键，所以索引访问有类型依据。
}
const id = getField({ id: "a", count: 2 }, "id"); // 结果类型为 string，不是宽泛的联合。
// getField({ id: "a" }, "missing"); // 取消注释后报错：没有这个键。
```

重载示例：

```typescript
function normalize(value: string): string; // 调用签名 1：字符串进，字符串出。
function normalize(value: number): number; // 调用签名 2：数字进，数字出。
function normalize(value: string | number): string | number { // 实现签名，外部不可直接调用。
  return typeof value === "string" ? value.trim() : Math.round(value);
}
const text = normalize(" hi "); // 类型 string，值 "hi"。
// normalize(true); // 取消注释后报错：没有匹配 boolean 的签名。
```

闭包的例子说明：`let limit = 10; const test = (n: number) => n >= limit; limit = 15;` 之后 `test(12)` 为 `false`，因为闭包读取的是 `limit` 此刻的值 15。

仓库例子：`packages/ai/src/api/google-shared.ts` 中的 `resolveGoogleThinkingLevel<T extends GoogleApiType>` 是带约束的泛型函数。

练习 6：给 `select` 传入 `['a', 'abcd', 'hello']` 并筛选长度大于 3 的项。给 `normalize` 传入布尔值，观察重载如何拒绝它。自检：结果为 `['abcd', 'hello']`；布尔调用被拒绝。

练习 7：写 `function first<T>(items: readonly T[]): T | undefined`。分别用 `[4, 5]`、`['a']` 和空数组调用。自检：前两次分别得到数字 4 和字符串 `"a"`，空数组得到 `undefined`。即使元素类型确定，数组仍可能为空，所以返回类型必须包含 `undefined`。

#### 1.6 async/await 与 Promise 基础

**`Promise<T>`** 表示“将来会得到一个 `T`，或者得到一个失败原因”。`async` 函数总是返回 `Promise`。`await` 等待一个 `Promise` 的结果，等待期间当前函数暂停，但 Node.js 仍可以处理其他任务（这叫事件循环，即 Node.js 调度回调的机制）。

为什么需要：读文件、访问网络、调用模型都需要时间。异步函数让代码保持顺序书写，同时不阻塞整个进程。

```typescript
async function fetchNumber(value: number): Promise<number> {
  return value * 2; // async 会把 number 包装成 Promise<number>。
}

async function run(): Promise<void> {
  const [a, b] = await Promise.all([fetchNumber(2), fetchNumber(3)]); // 两个调用同时进行，结果按输入顺序返回。
  console.log(a, b); // 4 和 6。
}
void run(); // 启动示例；此处不使用返回的 Promise。
```

依次 `await` 两个互不依赖的任务会串行等待。互不依赖时用 `Promise.all` 同时等待；任一个拒绝，整体就拒绝。如果第二步依赖第一步的结果，就必须按顺序 `await`。

`for await...of` 逐项消费异步可迭代对象。下面的例子在本地运行输出 `total 13 true`：

```typescript
async function* numbers(): AsyncIterable<number> {
  yield 1; // 消费者第一次迭代时取得 1。
  yield 2; // 第二次取得 2，之后迭代结束。
}

async function total(): Promise<number> {
  let sum = 10;
  for await (const value of numbers()) sum += value; // 10 + 1 + 2。
  return sum;
}
```

仓库例子：`packages/agent/src/agent-loop.ts` 中的 `await Promise.all(` 并发等待一组工具调用，并保持结果顺序与输入一致。

练习 8：让 `numbers()` 再产生 3，调整期望总和。在 `run` 中加入一个会抛错的 `fetchNumber` 分支，用 `try/catch` 输出错误消息。自检：抛错时进入 `catch`，失败的 `await` 之后的语句不再执行。

#### 1.7 ESM 导入导出与 `import type`

**模块**是一个文件。**`export`** 把值或类型暴露给其他文件，**`import`** 引入它们。**`import type`** 只引入类型，编译后这项导入被删除，运行时不会加载。在 pi 仓库中，相对导入要写出 `.ts` 后缀。

为什么需要：类型在运行时不存在，`import type` 能明确告诉读者和工具“这里只是类型”。此外，导入一个模块时它的顶层语句会执行，所以可复用模块的顶层通常只放定义。

`math.ts`：

```typescript
export type Pair = { left: number; right: number }; // 只导出类型，运行时没有 Pair 对象。
export function sum(pair: Pair): number { return pair.left + pair.right; } // 导出真实函数。
```

`main.ts`：

```typescript
import { sum } from "./math.ts"; // 值导入：运行时需要加载 sum。
import type { Pair } from "./math.ts"; // 类型导入：检查后会被擦除。

const pair: Pair = { left: 2, right: 3 };
console.log(sum(pair)); // 运行时输出 5。
```

仓库例子：`packages/coding-agent/src/experimental/process.ts` 同时使用 `import { type ChildProcess, spawn } from "node:child_process";` 和 `import { getPackageDir, isBunBinary, isBundledNode } from "../config.ts";`。前者把类型标记写在值导入的花括号内，后者导入相对路径的 `.ts` 文件。

仓库根目录的 `tsconfig.base.json` 开启了 `verbatimModuleSyntax`。因此纯类型的导入与导出必须显式写 `type`，否则 `tsc` 会报错。

练习 9：给 `math.ts` 增加 `multiply(pair: Pair)` 并从 `main.ts` 调用。故意把 `import type { Pair }` 当作值使用，例如写 `new Pair()`，观察报错。自检：`{ left: 2, right: 3 }` 的求和为 5、求积为 6；`Pair` 是类型别名，不是构造函数。

### 第二层：仓库常用模式

#### 2.1 判别联合与 `never` 穷尽检查

**判别字段**是联合的每个成员都有、且取值固定的字段，例如 `type` 或 `ok`。检查判别字段后，编译器把当前值收窄为对应的成员。**`never`** 表示“不可能出现的类型”，写在 `default` 分支里时，可以在新增成员却忘记处理时报错。

为什么需要：一个事件或结果可能有很多种形状。判别字段让每个分支只访问属于它的字段，避免读到不存在的属性。

```typescript
type LoadResult =
  | { ok: true; text: string } // 成功时只有 text。
  | { ok: false; error: string }; // 失败时只有 error。

function describe(result: LoadResult): string {
  if (result.ok) return result.text; // ok 为 true，收窄为成功成员。
  return `失败：${result.error}`; // 其余情况只能是失败成员。
}

type Action = { type: "add"; value: number } | { type: "clear" };

function apply(current: number, action: Action): number {
  switch (action.type) { // 运行时依据实际的 type 字符串选择分支。
    case "add": return current + action.value; // 这里 action 才有 value。
    case "clear": return 0;
    default: {
      const impossible: never = action; // 新增成员却漏写 case 时，这行报错。
      return impossible;
    }
  }
}
```

`apply(3, { type: "add", value: 2 })` 为 5，`apply(3, { type: "clear" })` 为 0。

仓库例子：`packages/ai/src/types.ts` 中的 `export type AssistantMessageEvent` 是判别联合，每个成员都有 `type` 字段（如 `"start"`、`"text_delta"`、`"error"`）。`packages/coding-agent/src/core/messages.ts` 的 `switch` 默认分支中有 `const _exhaustiveCheck: never = m;`，`packages/agent/src/proxy.ts` 中也有同样的写法。

练习 10：给 `Action` 增加 `{ type: "multiply"; value: number }`，先观察 `never` 报错，再补上 `case`。自检：`apply(3, { type: "multiply", value: 2 })` 为 6；补全后 `never` 不再报错。

#### 2.2 类型守卫与断言函数

**类型守卫**是返回 `value is T` 的函数。函数返回 `true` 时，编译器把 `value` 当作 `T`。**断言函数** `asserts value is T` 在条件不满足时抛错，正常返回后同样收窄类型。

为什么需要：守卫把“运行时检查”和“类型收窄”绑在一起。对外部数据，它比 `as` 断言更安全，因为检查是真实执行的。但守卫的类型是你的承诺：如果检查条件漏掉了字段，编译器不会替你发现。

```typescript
type Person = { name: string; age: number };

function isPerson(value: unknown): value is Person {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>; // 只为逐字段读取，尚未声称它是 Person。
  return typeof record.name === "string" &&
    typeof record.age === "number" && Number.isFinite(record.age); // 拒绝字符串年龄、NaN 和 Infinity。
}

const parsed: unknown = JSON.parse('{"name":"Ada","age":36}');
if (!isPerson(parsed)) throw new Error("Invalid person"); // 失败则抛错。
console.log(parsed.name.toUpperCase()); // 输出 ADA；此处 parsed 已收窄为 Person。
```

仓库例子：`packages/tui/src/tui.ts` 中的 `isFocusable(component: Component | null): component is Component & Focusable`，判断组件是否有 `focused` 字段。`packages/chord/src/services/wire.ts` 中的 `assertAddress(value: unknown): asserts value is ServiceInstanceAddress` 是断言函数，校验失败时抛出 `TypeError`。

练习 11：把 JSON 改成 `{"name":"Ada","age":"36"}`，确认守卫拒绝。再要求年龄为非负整数，覆盖 `-1`、`2.5`、`NaN` 三种输入。自检：校验条件可用 `Number.isInteger(record.age) && record.age >= 0`；`0` 与 `36` 通过；负数、小数、`NaN` 和字符串都失败。`NaN` 不能写进 JSON 文本，应直接构造 JavaScript 对象测试。

#### 2.3 `unknown` 与运行时校验

**`unknown`** 表示“任意值，但使用前必须先证明它的形状”。**`any`** 则跳过大部分检查，不推荐用于外部数据。**运行时校验**是在程序执行时检查值的真实形状，它与类型检查互补，不能互相替代。

为什么需要：网络、文件、用户输入的内容在编译时不可知。`JSON.parse` 成功只说明文本是合法 JSON，不说明它符合你的字段要求。

```typescript
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const data: unknown = JSON.parse('{"ok":true}');
if (isRecord(data)) {
  console.log(typeof data.ok); // "boolean"；这里的 data 已收窄为对象。
}
```

`typeof null` 的结果是 `"object"`，所以判断对象时必须排除 `null`。数组也是对象，业务只允许普通对象时还要用 `Array.isArray` 排除。

仓库例子：`packages/evals/src/plan.ts` 中的 `isRecord` 使用同样的三个条件。`packages/mcp/src/protocol/jsonrpc.ts` 中的 `isJsonRpcRequest(message: unknown): message is JsonRpcRequest` 先校验外部消息，再读取字段。

#### 2.4 Promise、并发与取消

**取消信号** `AbortSignal` 由 `AbortController` 创建。调用 `controller.abort()` 后，`signal.aborted` 变为 `true`。但取消信号只是一个标记：代码必须主动检查它，或者把它传给支持取消的 API，操作才会停止。**订阅**是注册回调，返回的**退订函数**负责移除回调。

为什么需要：模型请求和工具执行可能很慢，用户需要中途停止。订阅如果不退订，回调会一直保留在集合里，造成内存泄漏并继续接收消息。

```typescript
async function work(signal: AbortSignal): Promise<string> {
  try {
    if (signal.aborted) throw new Error("aborted"); // 调用前已取消。
    await Promise.resolve(); // 异步边界：此后调用方可能已经取消。
    if (signal.aborted) throw new Error("aborted"); // 等待期间取消。
    return "done";
  } finally {
    console.log("cleanup"); // 成功、抛错或提前返回都会执行。
  }
}

async function demo(): Promise<void> {
  const controller = new AbortController();
  controller.abort(); // 调用前取消，work 第一次检查就会抛错。
  try { await work(controller.signal); }
  catch (error: unknown) {
    if (error instanceof Error) console.log("caught", error.message);
  }
}
void demo(); // 输出 cleanup，然后 caught aborted。
```

`abort()` 不会自动停止普通的 `Promise`。只有代码检查了 `signal`，或者把它传给支持取消的 API，操作才会停止。取消发生的时间点也很重要：如果在最后一次检查之后才取消，操作可能已经完成。

订阅与退订的例子：

```typescript
const listeners = new Set<(message: string) => void>(); // 保存当前订阅的回调。

function subscribe(handler: (message: string) => void): () => void {
  listeners.add(handler);
  return () => { listeners.delete(handler); }; // 返回清理函数。
}

function publish(message: string): void {
  for (const listener of listeners) listener(message);
}

let calls = 0;
const unsubscribe = subscribe(() => { calls += 1; });
publish("first"); // calls 变为 1。
unsubscribe();
publish("second"); // 已退订，calls 仍为 1。
```

仓库例子：`packages/agent/src/agent-loop.ts` 中的 `runAgentLoop` 接收 `signal: AbortSignal | undefined`，循环中多处检查 `if (signal?.aborted)`。这就是“代码主动检查信号”的实际形式。

练习 12：给订阅例子增加第二个回调，验证只退订第一个时第二个仍收到消息。自检：退订后的回调计数不再增加；第二个回调继续执行。

练习 13：给 `work` 增加“首次检查通过、等待期间取消”的测试：先调用 `const pending = work(controller.signal)`，紧接着 `controller.abort()`，再 `await pending` 并捕获错误。自检：取消发生在第二次检查之前；`cleanup` 只输出一次。

#### 2.5 `using`、`Symbol.dispose` 与 `await using`

**`using`** 声明一个资源，离开所在代码块时自动调用它的 `[Symbol.dispose]()` 方法。**`await using`** 对异步资源做同样的事，调用 `[Symbol.asyncDispose]()` 并等待完成。**资源释放**指关闭文件、删除临时目录、断开连接等收尾动作。

为什么需要：手动写 `try/finally` 容易漏写，或者在多个分支中重复。`using` 把“获取”与“释放”绑定在同一个代码块中，异常路径也会执行释放。

```typescript
class TempFile {
  static open(): TempFile { return new TempFile(); }
  [Symbol.dispose](): void { console.log("closed"); } // 离开代码块时自动调用。
}

{
  using file = TempFile.open();
  console.log("working", file !== undefined);
} // 此处输出 closed。
```

注意运行环境：`using` 是 JavaScript 语法，不是类型注解。本地 Node.js 23.9.0 直接运行会报 `SyntaxError`（见动手实验 8），静态检查需要加入 `ESNext.Disposable` 库。

仓库例子：`packages/telemetry/src/testing/conformance.ts` 中的 `await using fixture = await factory();` 保证测试结束时释放夹具。`packages/client/src/client.ts` 实现了 `[Symbol.asyncDispose](): Promise<void>`。本地搜索未发现使用同步 `[Symbol.dispose]` 的实现，仓库主要使用异步版本。

练习 14：用 `try/finally` 重写上面的 `TempFile` 例子，对比两种写法的行数和异常路径。自检：说明 `using` 适合“变量的生命周期就是资源的生命周期”的局部场景。资源需要跨函数传递时，仍要手动释放或返回清理函数。

## 动手实验

### 实验约定

- 本篇所有实验不需要 API 密钥，不调用模型。
- 本地验证环境：Node.js v23.9.0，仓库 TypeScript 编译器 7.0.2。仓库 `package.json` 的 `engines` 要求 Node `>=22.19.0`，其他版本未在本地验证。
- 先在仓库根目录执行一次 `npm install --ignore-scripts`，让 `node_modules/.bin/tsc` 存在。
- 在系统临时目录中创建练习目录 `pi-learn-00`，把下面的代码块保存为同名文件。练习结束后删除该目录。
- 不要在仓库目录中直接检查练习文件。仓库的 `tsconfig.json` 会被读取，对命令行传入的文件会报 `TS5112`（本地实测）。

设置目录与 `tsc` 路径：

PowerShell：

```powershell
$dir = Join-Path $env:TEMP "pi-learn-00"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir
$tsc = "D:\Github\pi\node_modules\.bin\tsc.cmd" # 按你的仓库路径修改。
```

bash（Git Bash、macOS 或 Linux）：

```bash
DIR="${TMPDIR:-/tmp}/pi-learn-00"
mkdir -p "$DIR" && cd "$DIR"
TSC=/d/Github/pi/node_modules/.bin/tsc # 按你的仓库路径修改。
```

静态检查命令。下文用 `$tsc` 或 `$TSC` 指代上面的编译器路径，参数完全相同：

PowerShell：

```powershell
& $tsc --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --erasableSyntaxOnly --skipLibCheck study.ts
```

bash：

```bash
"$TSC" --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --erasableSyntaxOnly --skipLibCheck study.ts
```

`--noEmit` 只检查不生成 JavaScript。`--erasableSyntaxOnly` 禁止需要生成额外代码的语法，如 `enum` 与构造函数参数属性（见 3.7）。仓库的 `AGENTS.md`（Code Quality 节）规定 `packages/*/src` 等目录只能使用可擦除语法。

两条约定要记住：

- 在 Node v23.9.0 上 `node study.ts` 会先在 stderr 打印两行 `ExperimentalWarning: Type Stripping ...`。这是 Node 的提示，不是错误，程序输出在 stdout。
- `console.assert(条件)` 条件为假时只向 stderr 打印 `Assertion failed`，不抛错、不停止程序。需要“失败即停止”的练习，应改用 `if (...) throw new Error(...)`。

### 实验 1：运行完整样例 study.ts（5 分钟）

目的：确认本地 Node 能直接运行 TypeScript，并理解输出来自哪里。

步骤：把下面“综合练习”一节中的 `study.ts` 代码保存到练习目录，运行 `node study.ts`。

预期输出（实测，stdout）：

```text
3 inputs, 2 successes, 1 validation failure
```

stderr 额外有两行 `ExperimentalWarning` 提示。

### 实验 2：静态检查 study.ts

目的：确认同一份代码能通过 `tsc` 检查。

步骤：运行上面的静态检查命令。

预期输出（实测）：无输出，退出码 0。

### 实验 3：故意制造类型错误，只运行 tsc

目的：看到 `tsc` 在运行前拒绝非法值。

步骤：保存为 `neg1.ts`：

```typescript
let status: "idle" | "running" = "idle";
status = "done";
```

运行 `tsc` 静态检查命令，把 `study.ts` 替换为 `neg1.ts`。

预期输出（实测）：

```text
neg1.ts(2,1): error TS2322: Type '"done"' is not assignable to type '"idle" | "running"'.
```

直接运行 `node neg1.ts` 没有错误输出，退出码 0。运行时不检查这个类型，只有 `tsc` 能发现它。

### 实验 4：console.assert 不抛错

目的：确认 `console.assert` 与 `if ... throw` 的区别。

步骤：保存为 `assert.ts`：

```typescript
const expected = 2;
console.assert(1 === expected, "demo"); // 条件为假：只写 stderr，不抛错。
console.log("after assert"); // 仍会执行。
```

运行 `node assert.ts`。

预期输出（实测）：stderr 出现 `Assertion failed: demo`，stdout 出现 `after assert`，退出码 0。

### 实验 5：enum 不被 strip-only 模式支持

目的：理解为什么本篇避免使用 `enum`。

步骤：保存为 `enum.ts`：

```typescript
enum Mode { Read, Write }
console.log(Mode.Read);
```

运行 `node enum.ts`。

预期输出（实测，节选）：

```text
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:   x TypeScript enum is not supported in strip-only mode
```

退出码 1。改为字符串字面量联合（见 1.3）即可运行。

### 实验 6：ESM 导入与 import type

目的：确认值导入会在运行时执行，`import type` 不会。

步骤：在 `esm` 子目录中保存 `math.ts` 与 `main.ts`（内容见 1.7），运行 `node main.ts`，再运行静态检查命令并加上 `--allowImportingTsExtensions`，检查目标为 `main.ts math.ts`。

预期输出（实测）：`node main.ts` 输出 `5`，退出码 0；`tsc` 无输出，退出码 0。

### 实验 7：JSON 导入属性与 TS2856

目的：理解 `with { type: "json" }` 是运行时要求，并理解 TS2856 的来源。

步骤：

1. 保存 `models.json`：`[{ "name": "alpha" }, { "name": "beta" }]`。
2. 保存 `main.ts`：

```typescript
import values from "./models.json" with { type: "json" };

console.log(values[0].name); // 输出 alpha。
```

3. 运行 `node main.ts`。
4. 删除 `with { type: "json" }` 得到 `noattr.ts`，运行 `node noattr.ts`。
5. 对 `main.ts` 运行静态检查命令（不加 `study.ts`，改为 `main.ts`）。
6. 在同一目录新建 `package.json`，内容为 `{"type": "module"}`，再次运行第 5 步的检查命令。

预期输出（实测）：

- 第 3 步：输出 `alpha`，退出码 0。
- 第 4 步：`TypeError [ERR_IMPORT_ATTRIBUTE_MISSING]: Module "file:///.../models.json" needs an import attribute of "type: json"`，退出码 1。
- 第 5 步：`main.ts(1,36): error TS2856: Import attributes are not allowed on statements that compile to CommonJS 'require' calls.`，退出码 1。
- 第 6 步：无输出，退出码 0。

说明：`package.json` 的 `type` 字段告诉 TypeScript 这些 `.ts` 文件是 ES 模块，因而不会编译成 CommonJS 的 `require`。在本地 TypeScript 7.0.2 上，本例不加 `--resolveJsonModule` 也能通过；其他版本未验证。

### 实验 8：using 在 Node 23.9.0 上不可运行，tsc 需要库声明

目的：区分“语法存在”与“运行环境支持”。

步骤：保存为 `using.ts`：

```typescript
class TempFile {
  static open(): TempFile { return new TempFile(); }
  [Symbol.dispose](): void { console.log("closed"); }
}

{
  using file = TempFile.open();
  console.log("working", file !== undefined);
}
```

1. 运行 `node using.ts`。
2. 运行静态检查命令，但不加 `--lib`。
3. 运行静态检查命令，加上 `--lib ES2024,ESNext.Disposable,DOM`。

预期输出（实测）：

1. `SyntaxError: Unexpected identifier 'file'`，退出码 1。
2. `error TS2318: Cannot find global type 'Disposable'` 与 `TS2550`（`Symbol.dispose` 不存在），退出码 1。
3. 无输出，退出码 0。

说明：`using` 需要较新的 Node 或经过转译才能运行。本地只在 Node 23.9.0 上验证了上述 `SyntaxError`。

### 综合练习：study.ts

`study.ts` 是完整、可运行的基础样例。它把未知输入校验为任务，计算结果，并用判别联合表达成功与失败。阅读顺序：先看 `Job` 描述合法输入，再看 `isJob` 如何在运行时证明输入合法，然后看 `processJob` 如何处理取消与计算，最后看 `main` 怎样检查结果。

`input` 在通过 `isJob` 之前只能按 `unknown` 使用。通过之后才能读取 `input.values`。示例允许空数组，所以求和初始值必须写 0。

```typescript
type Job = { id: string; values: number[]; label?: string }; // 合法任务：必填 id/values，可选 label。
type JobResult =
  | { ok: true; id: string; total: number; label: string } // 成功时有计算结果。
  | { ok: false; id: string | null; reason: string }; // 失败时保留能读到的 id 与原因。

function isJob(value: unknown): value is Job {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false; // 拒绝原始值、null 和数组。
  const record = value as Record<string, unknown>; // 仅把字段当 unknown 逐项读取，尚未断言是 Job。
  return typeof record.id === "string" && record.id.length > 0 &&
    Array.isArray(record.values) && // values 必须是真实数组；空数组也合法。
    record.values.every((item: unknown) => typeof item === "number" && Number.isFinite(item)) && // 每项都得是有限数字。
    (record.label === undefined || typeof record.label === "string"); // 缺席或字符串都合法。
}

function readId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null; // 无法安全读取 id 的形状。
  const id = (value as Record<string, unknown>).id; // 只读取单个未知字段，不假设整个对象合法。
  return typeof id === "string" ? id : null; // id 不是字符串时，用 null 表示无法保留。
}

async function processJob(input: unknown, signal?: AbortSignal): Promise<JobResult> {
  if (signal?.aborted) return { ok: false, id: readId(input), reason: "aborted" }; // 调用前取消：先返回，不做校验或计算。
  if (!isJob(input)) return { ok: false, id: readId(input), reason: "invalid job" }; // 守卫失败：返回可检查的失败值。
  await Promise.resolve(); // 留出异步边界；从这里继续时，外部可能已经调用 abort()。
  if (signal?.aborted) return { ok: false, id: input.id, reason: "aborted" }; // 守卫已通过，故此处可读取 input.id。
  const total = input.values.reduce((sum, value) => sum + value, 0); // 初始值 0 保证空数组也返回 0。
  return { ok: true, id: input.id, total, label: input.label ?? "untitled" }; // 空字符串标签会原样保留。
}

async function main(): Promise<void> {
  const inputs: unknown[] = [ // 模拟外部数据；先作为 unknown，不能直接信任字段。
    { id: "a", values: [1, 2, 3] }, // 合法，合计 6，标签缺席。
    { id: "b", values: [4], label: "one" }, // 合法，显式标签为 one。
    { id: "bad", values: ["5"] }, // 不合法："5" 是字符串而非数字。
  ];
  const results = await Promise.all(inputs.map((input) => processJob(input))); // 为每项建立 Promise，结果顺序与 inputs 相同。
  const successes = results.filter((result): result is Extract<JobResult, { ok: true }> => result.ok); // 过滤后只保留成功成员。
  if (successes.length !== 2 || successes[0]?.total !== 6 || successes[1]?.label !== "one") {
    throw new Error("Unexpected successful results"); // 任何成功结果不符，明确让程序失败。
  }
  if (results[2]?.ok !== false || results[2].reason !== "invalid job") {
    throw new Error("Invalid input was accepted"); // 第三项必须是校验失败分支。
  }
  console.log("3 inputs, 2 successes, 1 validation failure"); // 所有断言通过才输出。
}

void main(); // 启动示例；正式命令行程序应处理 Promise 拒绝并设置退出码。
```

`void main()` 表示刻意不使用返回的 Promise。正式程序若要控制退出码，应在顶层处理拒绝，例如 `main().catch((error: unknown) => { console.error(error); process.exitCode = 1; })`。

## 走读一次完整过程

以下以 `study.ts` 为例，说明数据如何流过函数。

1. `main()` 构造 `inputs`，三个元素都是 `unknown`。此时编译器不知道它们的形状。
2. `inputs.map((input) => processJob(input))` 对每个输入调用 `processJob`，得到三个 `Promise<JobResult>`。
3. `processJob` 第一步检查 `signal?.aborted`。本例没有传 `signal`，`signal` 为 `undefined`，检查跳过。
4. `isJob(input)` 是类型守卫。对第一、二项它返回 `true`，`input` 从 `unknown` 收窄为 `Job`。对 `{ id: "bad", values: ["5"] }`，`every` 检查失败，它返回 `false`。
5. 第三项在守卫处返回 `{ ok: false, id: "bad", reason: "invalid job" }`。`reduce` 不会执行，坏数据不会被当作数字计算。
6. 第一、二项通过 `await Promise.resolve()` 进入异步边界，再次检查取消信号，然后 `reduce` 计算合计。第一项得到 `total: 6`，标签缺席时 `label` 为 `"untitled"`。
7. `Promise.all` 收齐三个结果，顺序与 `inputs` 相同。注意：第三项是一个正常兑现的 `JobResult`，“校验失败”是结果值，不是 Promise 拒绝。
8. `filter` 的类型谓词 `result is Extract<JobResult, { ok: true }>` 让 `successes` 的元素可以直接读取 `total` 和 `label`。
9. 两个 `if` 断言通过后，打印 `3 inputs, 2 successes, 1 validation failure`。

## 改造任务

以下任务需要在 `study.ts` 基础上完成，本文没有给出实测输出。

1. 类型与校验：给 `Job` 增加 `priority?: "low" | "normal" | "high"`。在 `isJob` 中增加条件：字段不存在，或值属于这三个字符串之一。成功结果增加必填 `priority`，缺席时用 `?? "normal"`。非法优先级、空 id、`NaN`、`Infinity`、负数分别写一个输入用例。原样例只要求“有限数字”，所以负数原本会通过；为使负数失败，新增 `item >= 0` 的运行时检查。
2. 返回结果：成功分支加入 `average: number | null`。空数组返回 `null`，非空数组返回 `total / input.values.length`。先检查长度，再做除法，避免得到 `NaN`。在结果消费处使用 `if (result.ok)` 读取它，不要用 `as` 强行读取失败分支。
3. 泛型：写 `groupBy<T, K extends string | number>(items: readonly T[], key: (item: T) => K): Map<K, T[]>`。按成功结果的 `label` 分组，构造“两项同标签、一项不同标签”的输入，断言组数为 2、成员数分别为 2 和 1。不得使用 `any`。
4. 异步与取消：新增 `processJobs(inputs: readonly unknown[], signal?: AbortSignal): Promise<JobResult[]>`。选择顺序处理或 `Promise.all` 并写下理由：顺序处理便于在取消后停止启动后续项；并发处理会同时启动多个任务，单个取消信号需要传给每项。预先取消与处理期间取消都要有测试。明确结果数组是否保留已完成项、是否为未处理项生成结果，并让实现与这个约定一致。
5. 模块化：把类型、校验与处理函数导出到 `job.ts`，在 `main.ts` 中用值导入引入函数、用 `import type` 引入类型。相对路径写实际 `.ts` 后缀。依次运行 `node main.ts` 和带 `--allowImportingTsExtensions` 的静态检查命令。
6. 类与订阅：写 `JobLog` 类，内部保存结果列表；对外返回新数组或只读快照，避免暴露内部可变数组。`onResult(handler)` 把回调加入 `Set` 并返回退订函数。每处理完一项，先保存结果再通知当前订阅者。测试顺序为“订阅、处理第一项、退订、处理第二项”，断言旧回调只收到第一项。

覆盖用例：


| 用例             | 输入 / 操作                                  | 预期                                       |
| ------------------ | ---------------------------------------------- | -------------------------------------------- |
| 正常求和         | `[1, 2, 3]`                                  | total = 6，average = 2                     |
| 空数组           | `[]`                                         | total = 0，average = null                  |
| 缺省标签与优先级 | 不传两个可选字段                             | `"untitled"` 与 `"normal"`                 |
| 非法数值         | `NaN`、`Infinity`、负数                      | 均被校验拒绝                               |
| 非法结构         | `null`、数组、字符串、缺 id、values 含字符串 | 返回失败结果，不发生类型断言造成的异常     |
| 预先取消         | 调用前`controller.abort()`                   | 返回 aborted，不计算结果                   |
| 中途取消         | 在异步边界前后触发取消                       | 按所选策略稳定返回 aborted 或停止后续任务  |
| 分组             | 两项同 label、一项不同 label                 | Map 中组数和成员数正确                     |
| 退订             | 先订阅、后退订、再处理任务                   | 退订后的处理不调用旧回调                   |
| 静态检查         | `tsc --noEmit --strict`                      | 无错误；不使用`any` 或双重断言绕过输入校验 |

交付物：`job.ts`、`main.ts`、一份覆盖上表的可运行断言，以及简短记录：哪一步是类型检查，哪一步是真实运行时校验，哪两个异步操作可以并发。

## 自测题

1. `const a = "x"` 与 `let b = "x"` 推断的类型分别是什么？为什么不同？
2. 为什么 `JSON.parse` 的结果应先当作 `unknown`，而不是直接断言为某个类型？
3. `console.assert(false)` 之后，程序会停止吗？如果需要停止，应该怎么写？
4. `import type { Pair } from "./math.ts"` 与 `import { sum } from "./math.ts"` 在运行时有什么区别？
5. 为什么 `enum Mode { Read }` 不能用 `node file.ts` 直接运行？

### 参考答案

1. `a` 是字面量类型 `"x"`，因为 `const` 不会重新赋值；`b` 是 `string`，因为 `let` 允许之后赋其他字符串。
2. `JSON.parse` 成功只表示文本是合法 JSON。断言会跳过检查，字段类型错误时程序会继续运行并得到错误结果（如 `"05"`）。先用 `unknown` 接收，再用守卫检查，才能保证之后访问的字段存在且类型正确。
3. 不会停止。`console.assert` 只向 stderr 打印 `Assertion failed`。需要停止时写 `if (!条件) throw new Error(...)`。
4. `import type` 只导入类型，编译后被删除，运行时不加载 `math.ts` 中的这一项。`import { sum }` 是值导入，运行时需要加载 `sum`。
5. `enum` 需要生成运行时对象，Node 的 strip-only 模式只能删除类型注解，不能生成代码。实测报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。

## 常见错误

1. 现象：在仓库目录中运行 `tsc --noEmit ... 练习.ts` 报 `TS5112: tsconfig.json is present but will not be loaded`。原因：仓库根目录有 `tsconfig.json`，命令行传入文件时不能同时读取它。解决：在练习目录（系统临时目录）中运行检查。
2. 现象：`console.assert` 失败后程序继续运行，看起来“没有检查”。原因：断言只打印 `Assertion failed`，不抛错。解决：需要停止时改用 `if (...) throw new Error(...)`。
3. 现象：`node file.ts` 报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，提到 `enum`。原因：Node 的 strip-only 模式只能删除类型注解。解决：用字符串字面量联合加 `as const` 对象代替（见 1.3 与选读中的说明）。
4. 现象：`node main.ts` 报 `ERR_IMPORT_ATTRIBUTE_MISSING`，提到 `type: json`。原因：导入 JSON 文件时 Node 要求写 `with { type: "json" }`。解决：补上导入属性。静态检查若报 `TS2856`，在练习目录放一个内容为 `{"type": "module"}` 的 `package.json`（见实验 7）。
5. 现象：`using` 在 Node 23.9.0 上报 `SyntaxError: Unexpected identifier`。原因：当前 Node 版本不支持 `using` 语法。解决：换用支持该语法的较新 Node，或改写为 `try/finally`（见 2.5 的练习）。

## 选读：第三层与补充（可选，跳过不影响主线）

以下内容超出读懂仓库的最低要求。跳过不影响后续文件。

### 3.1 类型声明文件 `.d.ts` 与 `declare module`

**声明文件** `.d.ts` 只包含类型声明，没有运行时代码。它的作用是告诉 `tsc` 外来模块的形状，例如没有类型的 JavaScript 依赖、`.wasm` 文件或 `.json` 资源。**`declare module "路径"`** 为一个模块路径写声明；**模块扩充**则在已有模块中追加成员。

为什么需要：`tsc` 不能读取 JavaScript 依赖的内部实现，又不能对未知导入放行，所以需要一个声明文件作为桥梁。

```typescript
// assets.d.ts：只参与检查，不生成任何 JavaScript。
declare module "*.meta" { // 通配声明：任何以 .meta 结尾的导入都按此形状检查。
  const content: string;
  export default content;
}
```

仓库例子：`packages/ai/src/providers/data-json.d.ts` 中的 `declare module "*.json"` 为 `.json` 导入提供默认导出。它的类型是 `unknown`；本地未验证它与 JSON 自动推断类型之间的优先级。`packages/coding-agent/src/utils/highlight-js.d.ts` 为 `highlight.js` 的深层路径补类型。`packages/coding-agent/src/bun/quickjs-wasm.d.ts` 为 `.wasm` 资源声明模块。

模块扩充的例子：`packages/coding-agent/src/core/keybindings.ts` 中的 `declare module "@earendil-works/pi-tui"` 内写有 `interface Keybindings extends AppKeybindings {}`，把应用自己的键位合并进 TUI 包的 `Keybindings` 接口。

注意：声明文件只影响类型检查。`.wasm` 导入能通过 `tsc`，运行时仍需要自己的加载代码。

练习 15：仿照 `data-json.d.ts`，写 `globals.d.ts`，用 `declare const PI_BUNDLED_NODE: boolean;` 声明一个由打包器注入的全局常量。在 `main.ts` 中用 `typeof PI_BUNDLED_NODE !== "undefined"` 保护后再读取。自检：不声明时 `tsc` 报“找不到名称”；声明后通过；运行时该常量可能不存在，`typeof` 保护不能省略。

### 3.2 品牌类型（名义类型）

**结构类型**指形状相同的值可以互换。**品牌类型**（brand）在 `string` 上附加一个只存在于类型中的标记，使 `UserId` 与普通 `string` 不能互换。它的运行时代价为零。

为什么需要：用户 id 与订单 id 都是字符串，结构类型检查无法区分它们。品牌类型让编译器拒绝把一个 id 当作另一个使用。

```typescript
declare const userIdBrand: unique symbol; // 只为类型存在的键，擦除后没有任何输出。
type UserId = string & { readonly [userIdBrand]: void };

function toUserId(value: string): UserId {
  if (value.length === 0) throw new Error("empty id"); // 品牌只允许在这里“铸造”。
  return value as UserId; // 断言集中在一个做过校验的函数内。
}

function loadUser(id: UserId): void { console.log("loaded", id); }

const id = toUserId("u-1");
loadUser(id); // 正常。
// loadUser("u-1"); // 取消注释报错：普通 string 不能代替 UserId。
console.log(typeof id); // "string"：运行时品牌完全消失。
```

本地实测：`node` 输出 `loaded u-1` 与 `string`。在另一个文件中用 `declare const b: unique symbol; type U = string & { readonly [b]: void };` 定义品牌，调用 `load("u-1")` 时 `tsc` 报 `TS2345: Argument of type 'string' is not assignable to parameter of type 'U'`。

仓库例子：`packages/durable/src/types.ts` 中的 `declare const idBrand: unique symbol;` 与 `export type Id<Kind extends string, Type = unknown>`，并定义 `SubmissionId = Id<"submission">`、`DocumentId = Id<"document">`，让两种 id 互不混用。`packages/ai/src/types.ts` 也有 `declare const transcriptContextBrand: unique symbol;`。

练习 16：再定义 `OrderId` 品牌，写 `function link(user: UserId, order: OrderId): string`。尝试把 `UserId` 传给 `order` 参数，观察报错。自检：`const plain: string = id` 合法；反向必须经过 `toUserId`。

### 3.3 抽象类与 `override`

**抽象类**（`abstract class`）是不能直接用 `new` 创建的基类。它可以包含已实现的方法，并要求子类实现 `abstract` 成员。**`override`** 显式标记“这个成员有意重写父类成员”。父类没有该成员时，`tsc` 会报错。

为什么需要：基类提供公共骨架，子类只补差异。`override` 能抓住拼写错误，例如把 `has` 误写成 `hsa` 时立即报错。

```typescript
abstract class Store {
  abstract get(key: string): string | undefined; // 子类必须实现。

  has(key: string): boolean { // 已实现：子类可复用或改写。
    return this.get(key) !== undefined;
  }
}

class MemoryStore extends Store {
  readonly #data = new Map<string, string>();

  override get(key: string): string | undefined {
    return this.#data.get(key);
  }

  override has(key: string): boolean { // 误写成 hsa 会立即报错。
    return this.#data.has(key);
  }
}
// new Store(); // 取消注释报错：抽象类不能实例化。
```

本地实测：`new MemoryStore().has("x")` 输出 `false`。

仓库例子：`packages/tui/src/tui.ts` 中的 `export abstract class TuiBase extends Container implements TUI`。`packages/tui/src/components/stack.ts` 中的 `export abstract class Stack extends Container`。`packages/mcp/src/transports/transport.ts` 中的 `export abstract class TransportEvents`，其子类如 `packages/mcp/src/transports/in-memory.ts` 中的 `InMemoryTransport` 继承它。

`override` 在 `packages/tui/src/tui-alt-screen.ts` 中大量使用，例如 `protected override beforeTerminalStart(): void`。仓库根目录的 `tsconfig.base.json` 未设置 `noImplicitOverride`，所以 `override` 在这个仓库中不是强制的，它首先是意图说明。

练习 17：给 `Store` 增加抽象方法 `keys(): string[]`，先观察 `MemoryStore` 漏实现时的报错，再补上。把 `override has` 改成 `override hsa`，记录错误。

### 3.4 模板字面量类型与 `const` 泛型参数

**模板字面量类型**把字符串的模式写进类型，例如 `` `/api/${string}` `` 表示“以 `/api/` 开头的任意字符串”。**`const` 泛型参数**让传入的字面量在推断时保持精确类型，不需要在调用处写 `as const`。

为什么需要：路由、事件名、provider 名等字符串有固定格式。类型模式可以在编译时拒绝不符合格式的字面量。但它只在编译期生效，来自外部的字符串仍需运行时校验。

```typescript
type Route = `/api/${string}`;
const ok: Route = "/api/users"; // 满足模式。
// const bad: Route = "/web/users"; // 取消注释报错：模式不匹配。

function pick<const T extends readonly string[]>(items: T): T[number] {
  return items[0];
}

const first = pick(["a", "b"]); // first 的类型是 "a" | "b"，而不是 string。
console.log(ok, first); // 本地实测输出：/api/users a
```

仓库例子：`packages/ai/src/model-catalog.ts` 中定义了模板类型 `` `${TType}:${string}` ``，`ModelId` 使用 `infer` 从该模板中取出部分。`flattenChatModelCatalog<const TProvider extends ProviderId, const TGroups extends ModelGroups>` 使用 `const` 泛型参数保留 provider 与分组名的字面量类型。

练习 18：定义 ``type Action = `demo/${"get" | "post"}/${string}` ``，各写一个合法值和一个非法值，观察检查行为。自检：模板类型只在编译期匹配模式；来自外部的字符串仍需运行时校验。

### 3.5 JSON 导入与导入属性

**JSON 导入**让源码直接 `import` 一个 `.json` 文件。**导入属性** `with { type: "json" }` 告诉运行时按 JSON 解析该文件。开启 `resolveJsonModule` 后，`tsc` 按文件内容推断导入的类型。

为什么需要：Node.js 不会仅凭扩展名决定如何解析导入。要求写明 `type: "json"` 可以避免错误解析，也让读者看出该导入是数据。

```typescript
import values from "./models.json" with { type: "json" };
// values 的类型由 tsc 依据文件内容推断；运行时由 Node.js 按 JSON 解析。
console.log(Array.isArray(values)); // 仍是外部数据：文件可能被改动，边界处仍要校验。
```

实验 7 已验证：缺少 `with { type: "json" }` 会在运行时报 `ERR_IMPORT_ATTRIBUTE_MISSING`；静态检查在没有 `type: module` 的 `package.json` 时报 `TS2856`。

仓库例子：`packages/ai/src/providers/anthropic.models.ts` 直接写 `import values from "./data/anthropic.json" with { type: "json" };`。`packages/ai/src/providers/all.ts` 也以同样写法导入 `./data/.manifest.json`。

练习 19：新建 `models.json`（含 `name` 字段的数组），导入并输出第一个 `name`。删去 `with { type: "json" }` 后再运行，观察错误。

### 3.6 `import.meta` 与 `import.meta.url`

**`import.meta`** 是当前模块的元信息。**`import.meta.url`** 是本模块文件的 `file://` 地址。ESM 没有 `__dirname`，要定位与源文件同目录的文件，需要用 `fileURLToPath(import.meta.url)` 换算。

为什么需要：ESM 模块不提供 CommonJS 的 `__dirname` 与 `__filename`。把 URL 转换成路径是唯一可靠的方法，字符串截取会在含空格或百分号转义的路径上出错。

```typescript
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
console.log(import.meta.url.startsWith("file://"), here.length > 0); // 本地实测输出：true true
```

静态检查 `import.meta` 时，`tsc` 要求文件被视为 ES 模块。在没有 `package.json` 的目录中运行会报 `TS1470: The 'import.meta' meta-property is not allowed in files which will build into CommonJS output.`。在目录中加入 `{"type": "module"}` 后通过。若检查 `node:` 导入还报找不到名称，可追加 `--typeRoots <仓库>/node_modules/@types --types node`（本地实测两者都需要）。

仓库例子：`packages/coding-agent/src/config.ts` 中的注释与 `export const isBunBinary =`。它检查 `import.meta.url` 是否包含 `$bunfs`、`~BUN` 或 `%7EBUN` 等标记，以判断是否运行在 Bun 打包的二进制中。

练习 20：打印 `import.meta.url` 与 `here`，比较两者。把文件挪到另一个目录运行，观察路径如何变化。自检：URL 带有 `file://` 前缀，必须经 `fileURLToPath` 转换。

### 3.7 补充语法（仓库中较少使用，按需了解）

以下内容未列入主线，只需在读旧代码时认识它们。

- 工具类型：`Partial<T>`、`Required<T>`、`Readonly<T>`、`Pick<T, K>`、`Omit<T, K>`、`Record<K, V>`、`Extract<U, X>`、`Exclude<U, X>`、`ReturnType<F>`、`Awaited<P>`。它们只在编译期变换类型，不改变对象。`Partial` 与 `Readonly` 都是浅层的，嵌套对象的字段不会自动变化。

```typescript
type Task = { id: string; title: string; done: boolean };
type TaskPatch = Partial<Pick<Task, "title" | "done">>; // 先取 title/done，再让二者可选。
type NewTask = Omit<Task, "id">; // 创建时还没有系统分配的 id。
type ById = Record<string, Task>;

const patch: TaskPatch = { done: true }; // title 可省略。
const draft: NewTask = { title: "Read", done: false };
const tasks: ById = { t1: { id: "t1", ...draft } };
console.assert(patch.done === true && tasks.t1.title === "Read"); // 本地实测通过。
```

- 映射类型、条件类型、`infer` 与 `satisfies`：

```typescript
type OptionalFields<T> = { [K in keyof T]?: T[K] }; // 逐字段添加可选标记。
type ElementOf<T> = T extends readonly (infer Item)[] ? Item : never; // 匹配数组并提取元素类型。

type Name = ElementOf<readonly string[]>; // string
const limits = { low: 1, high: 5 } as const satisfies Record<string, number>; // 检查每个值是 number，并保留精确字面量。
const high = limits.high; // 类型是字面量 5。
```

`satisfies` 检查表达式是否符合目标类型，同时保留原有的精确类型；它不是类型断言，也不是运行时校验。

- 类、`#` 私有字段与 `get`：类同时产生构造函数和实例类型。`#value` 是 JavaScript 运行时私有字段，类外访问会报错。`get value()` 让读取像属性访问，实际执行方法。`static` 方法通过 `Counter.from(...)` 调用，而不是通过实例。

```typescript
class Counter {
  #value: number;
  constructor(initial = 0) { this.#value = initial; }
  get value(): number { return this.#value; }
  increment(step = 1): void {
    if (step < 0) throw new Error("step must be non-negative");
    this.#value += step;
  }
}
const counter = new Counter(2);
counter.increment(); // 未传 step，使用默认值 1。
console.assert(counter.value === 3); // 本地实测通过。
```

`implements SomeInterface` 只检查类实例的形状，不生成方法。仓库中 `packages/durable/src/storage/sqlite/node.ts` 的 `abstract class NodeSqliteExecutor implements SqliteExecutor` 同时使用了抽象类与 `implements`。

- 集合与解构：`Map<K, V>` 用任意键映射值，`Set<T>` 保存不重复的值。`Record<string, V>` 只是对象的静态类型，不会创建 Map。解构 `const { retries, ...rest } = config;` 中的 `rest` 是新的外层对象，嵌套对象仍共享引用。

```typescript
const counts = new Map<string, number>();
for (const word of ["a", "b", "a"]) counts.set(word, (counts.get(word) ?? 0) + 1); // a: 2, b: 1
const config = { retries: 2, mode: "fast" };
const { retries, ...rest } = config; // retries 为 2；rest 为 { mode: "fast" }。
```

练习 21：实现词频统计，输入 `string[]`，返回 `Map<string, number>`。空数组返回的 Map 的 `.size` 应为 0。再把结果转换成普通对象。自检：需要任意键和增删查 API 时用 `Map`；需要 JSON 结构时用对象。

- 不必优先使用的语法：`enum` 生成运行时代码，Node 的 strip-only 模式不支持（见实验 5）。`namespace`、`import =`、`export =` 是较旧的模块写法，现代代码使用标准 `import` 与 `export`。构造函数参数属性（如 `constructor(private id: string) {}`）需要生成赋值代码。装饰器与 JSX 需要额外编译配置。`as unknown as T` 能强行绕过检查，但没有证明输入真的是 `T`。

本地搜索 `packages/` 时未找到 `export enum`，也未找到构造函数参数属性（已用 `grep` 验证）。

- 桶文件与类型再导出：包通常用 `index.ts` 汇总内部模块。`export * from "./x.ts"` 转发值和类型；`export type { Job } from "./job.ts"` 只转发类型。`packages/tui/src/index.ts` 的 `export { ..., type Keybindings, ... } from "./keybindings.ts"` 就是内联类型导出的例子。

练习 22：把 `math.ts` 与一个含类型的 `types.ts` 汇总进 `index.ts`，`main.ts` 只从 `./index.ts` 导入。删掉 `export type` 后，观察 `tsc` 报错，而运行时输出不变，因为类型本来就会被擦除。

## 下一篇

01 仓库地图与运行环境：这些语法在 pi 仓库的各个包中分布在哪里，如何安装依赖并运行检查命令。

## 术语小结


| 术语          | 一句话定义                                    | 首次出现的小节 |
| --------------- | ----------------------------------------------- | ---------------- |
| 类型注解      | 写在名字后面的类型说明，如`: number`          | 1.1            |
| 类型推断      | 编译器根据初始值推算出的类型                  | 1.1            |
| 字面量类型    | 只允许某一个具体值的类型，如`"idle"`          | 1.1            |
| interface     | 描述对象字段形状的声明                        | 1.2            |
| 联合类型      | `A | B`，值为 A 或 B 之一                     | 1.3            |
| 收窄          | 根据检查把类型缩小到联合中的某一支            | 1.3            |
| 可选链`?.`    | 左侧为 null 或 undefined 时停止访问           | 1.4            |
| 空值合并`??`  | 左侧为 null 或 undefined 时使用右侧值         | 1.4            |
| 泛型          | 类型参数，让输入与输出的类型相关联            | 1.5            |
| Promise       | 表示将来得到结果或失败原因的对象              | 1.6            |
| ESM           | 使用`import` 与 `export` 的模块系统           | 1.7            |
| `import type` | 只导入类型，编译后删除的导入                  | 1.7            |
| 判别字段      | 联合成员中取值固定、用于区分分支的字段        | 2.1            |
| 类型守卫      | 返回`value is T` 的函数，返回 true 时收窄类型 | 2.2            |
| unknown       | 使用前必须先检查形状的类型                    | 2.3            |
