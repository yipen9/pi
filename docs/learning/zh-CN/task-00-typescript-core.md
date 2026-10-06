# 00. TypeScript 核心与常用语法

本任务只学习 TypeScript，不要求了解任何项目源码。完成后应能读懂日常 TypeScript 代码，区分类型检查与运行时行为，并独立写出带输入校验、异步处理和测试的模块。建议用 2-3 天完成；所有学习材料、例子、练习和验收要求都在本文中。

## 今日准备与运行约定

- 准备 Node.js >= 22.19.0 和 TypeScript 编译器。`node --version` 查看版本。当前仓库安装过依赖时可运行 `npx --no-install tsc --version`；`--no-install` 避免临时从网络下载。
- 在自己新建的临时目录里保存练习文件，不改现有源码。本文的短代码块各自解释一个概念，不能把所有短块原样拼成一个文件；文末的 `study.ts` 是完整可运行文件。
- 运行完整例子：`node study.ts`。静态检查：`npx --no-install tsc --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --erasableSyntaxOnly --skipLibCheck study.ts`。如果没有本地 TypeScript 编译器，先完成运行时练习，并把“静态检查未运行”记录下来。
- `node` 执行代码，不替代 `tsc` 的类型检查。`tsc --noEmit` 只检查，不生成 JavaScript。刻意制造类型错误的练习只运行 `tsc`，修复后再运行 `node`。
- 示例默认使用可擦除的 TypeScript 语法：类型信息可被移除，剩余代码仍是 JavaScript。`enum`、`namespace`、构造函数参数属性等需要生成额外代码的语法放在文末说明，不用于可直接运行的练习。

## 1. 类型究竟解决什么问题

JavaScript 在运行时才发现某些错误；TypeScript 在写代码时检查值的形状。例如把字符串交给需要数字的函数，类型检查能提前报错。类型不是运行时防护：网络输入、文件内容和 `JSON.parse` 的结果仍需要实际检查。

可以把一段程序分为两层看：`tsc` 在执行前分析“这里允许什么值”，Node.js 在执行时处理“这里实际是什么值”。类型注解属于前一层，会从运行代码中擦除。因此 TypeScript 可以减少内部代码的误用，却不能保证外部数据真实可靠。

```typescript
function double(value: number): number {
  // 参数和返回值都承诺是 number；若写成 return String(value * 2)，静态检查会报错。
  return value * 2;
}

const answer = double(21); // 编译器从函数返回类型推断 answer 为 number。
console.log(answer); // 运行时输出 42。
// double("21"); // 取消注释后 tsc 报错：string 不能交给 number 参数。
```

`value: number` 是参数类型；函数右侧的 `: number` 是返回类型。`const answer` 没有显式类型，编译器根据返回值推断。运行时没有这些类型注解，`double("21")` 甚至可能被 JavaScript 强制转换成 42，所以“恰好跑出结果”不等于调用正确。

练习 1：把返回表达式改为 `String(value * 2)`，记录 `tsc` 的错误；分别修复“返回类型”和“返回值”，解释两种修复的语义差异。自检：改返回类型为 `string` 后，`answer` 应推断为字符串；保留 `number` 并恢复数字表达式后，`answer` 仍是数字。不要只看控制台的 `42`，还要检查它是数字还是字符串。

## 2. 基础类型、推断和字面量类型

常见基础类型是 `string`、`number`、`boolean`、`bigint`、`null`、`undefined`。`number` 同时表示整数和小数，TypeScript 不单独提供 `int`。`const` 不能重新赋值，`let` 可以。尽量让编译器推断局部变量，只在函数边界和需要约束的地方显式标注类型。

“推断”不是放弃类型：编译器根据初始化值推算类型，并继续检查后续赋值。`const` 的原始值不能重新赋值，通常能保留更窄的字面量类型；`let` 要允许后续赋值，通常推断为较宽的 `string` 或 `number`。对象的 `const` 只固定变量指向，不能阻止修改对象字段。

```typescript
let count = 0; // 初始化为数字，推断为 number。
count += 1; // let 允许重赋值，此时 count 为 1。
const title = "TypeScript"; // 不会重新赋值，类型可保持字面量 "TypeScript"。
let status: "idle" | "running" = "idle"; // 声明允许的两个状态。
status = "running"; // 合法：右侧是联合成员之一。
// status = "done"; // 取消注释后报错："done" 不在联合中。
```

`"idle" | "running"` 叫字符串字面量联合，比任意 `string` 更精确。它适合状态、模式和协议字段。不要为每个临时值都造一个类型名；在多个边界复用时再提取别名。

练习 2：定义 `type Priority = "low" | "normal" | "high"`，编写 `let priority: Priority`，分别赋合法值和 `"urgent"`，观察检查结果。自检：前三个字符串可以赋值，`"urgent"` 必须被 `tsc` 拒绝；运行前撤销故意制造的错误。再比较 `let level = "low"` 与 `const level = "low"` 的推断类型。

## 3. 数组、元组、只读与浅拷贝

`string[]` 是任意长度的字符串数组；`[string, number]` 是有固定位置含义的元组。`readonly` 防止通过当前引用修改数组，但不会在运行时冻结对象。展开运算符 `[...]` 只复制外层数组，数组中的对象仍被共享。

元组适合“第一位是名称、第二位是次数”这种位置协议；字段多或语义不明显时，对象 `{ name, count }` 更易读。只读类型是编译期的访问约束，其他可写引用仍可能修改同一对象。理解浅拷贝时，分别观察“数组容器”和“数组中的对象”是不是同一个。

```typescript
const names: string[] = ["Ada", "Lin"]; // 每个元素必须是字符串，长度不限。
const row: [string, number] = ["Ada", 2]; // 第 0 位是姓名，第 1 位是次数。
const modes = ["read", "write"] as const; // 类型为 readonly ["read", "write"]。
type Mode = (typeof modes)[number]; // 取元组元素的联合："read" | "write"。

const original = [{ value: 1 }];
const copied = [...original]; // copied 是新数组，但 copied[0] === original[0]。
copied[0].value = 2; // 修改共享对象，所以 original[0].value 也变为 2。
console.assert(original[0].value === 2); // 断言浅拷贝的实际行为。
```

`as const` 会把字面量收窄并添加只读约束；`typeof modes` 在类型位置取得变量类型；`[number]` 取得数组元素类型。`as const` 不等于运行时 `Object.freeze`。

练习 3：分别执行 `copied.push({ value: 3 })` 和修改 `copied[0].value`，记录 `original` 的长度与首个对象值。尝试 `modes.push("execute")`，观察类型错误。自检：只向 `copied` 追加元素时 `original.length` 仍为 1；修改共享的首个对象时，`original[0].value` 同步改变；`modes.push` 因只读元组而报错，不能靠 `as const` 在运行时冻结它。

## 4. 对象、`interface` 与 `type`

对象类型描述字段，不负责创建对象。`?` 表示字段可以缺席；`readonly` 表示不能通过该类型的引用重新赋值。`interface` 常用于可扩展的对象契约，`type` 还能命名联合、交叉和元组。这里不需要争论二选一：先选能清楚表达形状的写法。

可选字段在读取时通常得到 `字段类型 | undefined`；写代码时要考虑字段不存在的情况。交叉类型 `A & B` 要求两边字段同时存在。`interface Admin extends User` 也是增加对象要求的一种写法，但只适用于可扩展的对象形状。

```typescript
interface User {
  readonly id: string; // 必填，只能通过该类型读取，不能重新赋值。
  name: string; // 必填且可修改。
  email?: string; // 可以缺席；读取时要处理 undefined。
}

type WithTimestamp = { createdAt: number };
type StoredUser = User & WithTimestamp; // 必须同时满足 User 和 WithTimestamp。

const user: StoredUser = { id: "u1", name: "Ada", createdAt: Date.now() }; // email 可省略。
user.name = "Ada L."; // name 可写。
// user.id = "u2"; // 取消注释后报错：readonly 不允许通过 user 修改 id。
```

TypeScript 主要按结构检查：一个值具有所需字段就可用于相应位置，不要求它由指定类构造。对象字面量赋给明确类型时还会检查多余字段，能抓住拼写错误。`readonly` 是静态限制，不能替代运行时的权限或不可变数据设计。

练习 4：给 `User` 增加可选 `nickname`；故意把 `createdAt` 写成 `createAt`，让 `tsc` 指出问题。再用 `interface Admin extends User` 加 `permissions: string[]`，构造一个合法值。自检：不写 `nickname` 仍合法；`createAt` 不能替代必需的 `createdAt`；`Admin` 必须同时有 `id`、`name` 和 `permissions`。

## 5. 联合、交叉与判别字段

联合 `A | B` 表示二者之一；交叉 `A & B` 表示必须同时满足。给联合成员放一个共同的固定值字段，称为“判别字段”。检查该字段后，TypeScript 就能缩小当前分支的类型。

例如成功结果含 `text`，失败结果含 `error`。直接读 `result.text` 不安全，因为失败对象没有它；先检查 `result.ok`，编译器才能证明当前分支是哪一种。这个判断在运行时也真实执行，因此同时保护了实际访问。

```typescript
type LoadResult =
  | { ok: true; text: string } // 成功时只有 text。
  | { ok: false; error: string }; // 失败时只有 error。

function describe(result: LoadResult): string {
  if (result.ok) return result.text; // ok 为 true，收窄为成功成员。
  return `失败：${result.error}`; // 其余情况只能是失败成员。
}
```

对状态较多的联合可用 `switch`。默认分支中把值赋给 `never`，能在新增成员但忘记处理时触发类型错误。`never` 表示这条路径理论上不应收到值。

```typescript
type Action = { type: "add"; value: number } | { type: "clear" }; // type 是判别字段。

function apply(current: number, action: Action): number {
  switch (action.type) { // 运行时依据实际的 type 字符串选择分支。
    case "add": return current + action.value; // 此处 action 才有 value。
    case "clear": return 0; // clear 不需要 value。
    default: {
      const impossible: never = action; // 新增成员却漏写 case 时，这行报错。
      return impossible; // 类型检查通过时，此分支理论上不可达。
    }
  }
}
```

练习 5：给 `Action` 增加 `{ type: "multiply"; value: number }`，先观察 `never` 报错，再补分支。自检：`apply(3, { type: "add", value: 2 })` 为 5；`apply(3, { type: "multiply", value: 2 })` 为 6；补全 `case` 后 `never` 不再报错。

## 6. `null`、`undefined`、可选链和空值合并

开启严格检查后，可能缺失的值必须先处理。`?.` 在左侧为 `null` 或 `undefined` 时停止访问；`??` 仅在左侧为这两种空值时使用默认值。`||` 还会把 `0`、`false`、`""` 当作需要回退，二者不能混用。

`?.` 的结果本身仍可能是 `undefined`，因此常与 `??` 配合。只有当“所有假值都表示缺失”时，才选择 `||`。非空断言 `!` 不检查条件，它只是让类型错误消失，外部数据上误用会变成运行时异常。

```typescript
type Settings = { retries?: number; label?: string }; // 字段可以缺席。
const settings: Settings = { retries: 0, label: "" }; // 0 和空串都是已提供的值。
const retries = settings.retries ?? 3; // 左边不是 null/undefined，结果为 0。
const wrongRetries = settings.retries || 3; // 0 是假值，结果误变成 3。
const firstLetter = settings.label?.[0] ?? "?"; // 空串索引结果为 undefined，最终是 "?"。
console.assert(retries === 0 && wrongRetries === 3 && firstLetter === "?"); // 验证三种结果。
```

非空断言 `value!` 只让编译器相信它存在，运行时不增加检查。边界输入优先使用 `if (value === undefined)` 等真实判断。

练习 6：写 `function displayName(name?: string): string`。缺席时返回 `"anonymous"`，空字符串必须原样保留；用 `??` 实现，并对比 `||` 的错误行为。自检：`displayName()` 为 `"anonymous"`，`displayName("")` 为 `""`，`displayName("Ada")` 为 `"Ada"`。

## 7. 函数、回调、重载与闭包

函数类型既约束参数，也约束返回值。可选参数用 `?`，默认参数用 `=`，剩余参数用 `...`。回调是传给别的函数、稍后被调用的函数；闭包会记住其定义处的变量。

看函数签名时先问三件事：调用者必须提供什么、函数承诺返回什么、有没有把函数本身当值传递。下面的 `Predicate<T>` 就是函数值的类型。`readonly T[]` 表示 `select` 只能读取入参数组；它返回一个新数组，调用者可以修改结果。默认参数 `limit = 10` 允许省略参数，省略时使用 10。

```typescript
type Predicate<T> = (value: T) => boolean; // 输入一个 T，返回是否保留它。

function select<T>(values: readonly T[], test: Predicate<T>): T[] {
  return values.filter(test); // filter 逐项调用 test，并生成新数组。
}

function makeThreshold(limit = 10): Predicate<number> {
  return (value) => value >= limit; // 返回的函数仍可读取定义时所在作用域的 limit。
}

const selected = select([3, 12, 17], makeThreshold(12)); // T 推断为 number；保留 >= 12 的值。
console.assert(selected.join(",") === "12,17"); // 结果为 [12, 17]。
```

当不同入参对应不同返回类型，可用重载签名。调用者看到重载，函数实现仍要处理完整联合。

前两行是调用方可见的签名，第三行是实现签名；调用不能仅凭实现签名绕过前两行。因此 `normalize(true)` 不合法。实现内部的 `typeof` 是真实的运行时判断，帮助 TypeScript 在两个分支里收窄 `value`。

```typescript
function normalize(value: string): string; // 字符串输入对应字符串输出。
function normalize(value: number): number; // 数字输入对应数字输出。
function normalize(value: string | number): string | number {
  return typeof value === "string" ? value.trim() : Math.round(value); // 按运行时类型分别处理。
}
const text = normalize(" hi "); // 类型为 string，值为 "hi"。
const rounded = normalize(2.6); // 类型为 number，值为 3。
```

练习 7：给 `select` 传 `['a', 'abcd', 'hello']` 并筛选长度大于 3 的项；给 `normalize` 传 `boolean`，观察为何重载拒绝它。另写 `let limit = 10; const test = (n: number) => n >= limit; limit = 15;`，判断 `test(12)` 的结果。自检：筛选结果为 `['abcd', 'hello']`；布尔调用被拒绝；`test(12)` 是 `false`，因为该闭包读的是变量此刻的值 15，而不是创建回调时的快照。

## 8. 泛型、约束、`keyof` 与索引访问

泛型用占位符表达“输入和输出保持某种关系”。`T` 不是运行时变量。约束 `T extends ...` 表示调用者传来的类型至少具有指定结构。`keyof T` 是字段名联合，`T[K]` 是字段值类型。

读 `getField` 时从调用现场代入：`item` 的类型是 `{ id: string; count: number }`，所以 `K` 只能是 `"id" | "count"`。传 `"id"` 后，返回类型不是宽泛的 `string | number`，而是对应字段的 `string`。这正是泛型保存“哪个键对应哪个值”的关系。

```typescript
function getField<T extends object, K extends keyof T>(item: T, key: K): T[K] {
  return item[key]; // K 必须是 item 的键，所以索引访问有类型依据。
}

const item = { id: "a", count: 2 };
const id = getField(item, "id"); // K = "id"，结果为 string。
const count = getField(item, "count"); // K = "count"，结果为 number。
// getField(item, "missing"); // 取消注释后报错：没有这个键。
```

泛型不是越多越好：如果返回值与输入类型没有关联，普通参数类型更容易读。不要用泛型掩盖缺少运行时校验的问题。

练习 8：写 `function first<T>(items: readonly T[]): T | undefined`。分别用 `[4, 5]`、`['a']` 和空数组调用。自检：前两次分别得到数字 4、字符串 `"a"`，空数组得到 `undefined`；即使传入数组的元素类型明确，数组仍可能为空，所以返回类型必须包含 `undefined`。

## 9. `unknown`、类型守卫、断言与运行时校验

`any` 会跳过大部分检查；`unknown` 迫使你先证明值的形状。`as SomeType` 是类型断言，只影响编译器，不检查真实值。类型守卫的返回类型 `value is User` 告诉编译器：返回 `true` 后可以按 `User` 使用。

外部输入的推荐路线是“先以 `unknown` 接收，再用运行时条件逐项检查”。`typeof null` 的结果是 `"object"`，因此判断对象时要显式排除 `null`。数组也是对象；如果业务只允许普通非数组对象，还要用 `Array.isArray` 排除数组。类型守卫的签名是你向编译器作出的承诺，检查条件漏写字段时，编译器不会替你发现守卫撒了谎。

```typescript
type Person = { name: string; age: number };

function isPerson(value: unknown): value is Person {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false; // 排除原始值、null 和数组。
  const record = value as Record<string, unknown>; // 只为逐字段读取；尚未声称它是 Person。
  return typeof record.name === "string" &&
    typeof record.age === "number" && Number.isFinite(record.age); // 拒绝字符串年龄、NaN 和 Infinity。
}

const parsed: unknown = JSON.parse('{"name":"Ada","age":36}'); // JSON.parse 成功不等于字段正确。
if (!isPerson(parsed)) throw new Error("Invalid person"); // 失败则抛错，后续路径只剩 Person。
console.log(parsed.name.toUpperCase()); // 输出 ADA；此处 parsed 已被收窄。
```

`JSON.parse` 成功只表示文本是合法 JSON，不表示它符合你的业务形状。若要抛错并顺便收窄类型，可写 `function assertPerson(value: unknown): asserts value is Person`，函数内部失败时必须真的抛错。

练习 9：把 JSON 改成 `{"name":"Ada","age":"36"}`，确认守卫拒绝；再要求年龄为非负整数，覆盖 `-1`、`2.5`、`NaN` 三种输入。自检：校验条件可用 `Number.isInteger(record.age) && record.age >= 0`；`0` 与 `36` 通过，负数、小数、`NaN`、字符串均失败。`NaN` 不能写进 JSON 文本，应直接构造 JavaScript 值测试。

## 10. 常用工具类型与类型运算

工具类型只在编译期变换类型，不会复制或改写实际对象。先掌握下表，再读复杂类型表达式。

把它们理解为“从已有类型推导新类型”的函数。`Partial`、`Pick` 等作用于字段形状，`Extract`、`Exclude` 作用于联合成员，`ReturnType`、`Awaited` 从函数或 Promise 类型中提取结果。下表的 `K` 通常是键的联合，`V` 是值类型。

| 写法                                  | 含义                          | 典型用途                 |
| ------------------------------------- | ----------------------------- | ------------------------ |
| `Partial<T>`                        | 所有字段可选                  | 局部更新参数             |
| `Required<T>`                       | 所有字段必填                  | 归一化后的完整配置       |
| `Readonly<T>`                       | 字段只读                      | 对外暴露的快照           |
| `Pick<T, K>`                        | 只保留 K                      | API 的局部视图           |
| `Omit<T, K>`                        | 去掉 K                        | 构造时由系统生成某些字段 |
| `Record<K, V>`                      | K 到 V 的映射                 | 按名称索引对象           |
| `Extract<U, X>` / `Exclude<U, X>` | 从联合提取 / 排除成员         | 事件类型筛选             |
| `ReturnType<F>` / `Awaited<P>`    | 函数返回类型 / Promise 最终值 | 避免重复写派生类型       |

```typescript
type Task = { id: string; title: string; done: boolean };
type TaskPatch = Partial<Pick<Task, "title" | "done">>; // 先取 title/done，再让二者可选。
type NewTask = Omit<Task, "id">; // 创建时还没有系统分配的 id。
type ById = Record<string, Task>; // 任意字符串键对应一个完整 Task。

const patch: TaskPatch = { done: true }; // title 可省略。
const draft: NewTask = { title: "Read", done: false }; // id 不属于 NewTask。
const tasks: ById = { t1: { id: "t1", ...draft } }; // 运行时仍需手动创建对象。
console.assert(patch.done && tasks.t1.title === "Read"); // 工具类型不改变实际数据。
```

`Partial<T>` 是浅层的：若字段本身是对象，它内部的必填字段不会自动变成可选。`Readonly<T>` 同样不是深冻结。

例如 `Partial<{ profile: { name: string } }>` 允许整个 `profile` 缺席；一旦提供 `profile`，其中的 `name` 仍必填。`Record<string, Task>` 表示“按字符串键读取时期待 Task”，却不保证某个键在运行时真的存在；读取来自用户的键时仍应处理缺失。

练习 10：从 `Task` 派生只含 `id`、`done` 的只读视图，例如组合 `Readonly` 和 `Pick`；尝试漏掉 `done`、额外写 `title`，观察对象字面量检查。自检：合法视图只有 `id` 与 `done`；漏字段、添字段、重新赋值都被拒绝。`Extract<"a" | "b" | "c", "a" | "c">` 的结果是 `"a" | "c"`。

## 11. 映射类型、条件类型、`infer` 和 `satisfies`

映射类型对一组字段逐个变换；条件类型像编译期的分支；`infer` 在匹配的结构中提取某一部分。它们适合消除重复类型定义，但不应让简单数据形状变得难懂。

`[K in keyof T]` 可读成“遍历 T 的每个字段 K”；`?: T[K]` 可读成“该字段可以缺席，但若提供，值仍是原类型”。`T extends readonly (infer Item)[] ? Item : never` 可读成“如果 T 是只读或可写数组，就取出元素类型；否则得到不可能的 `never`”。这些都是编译期运算，不会遍历真实对象。

```typescript
type OptionalFields<T> = { [K in keyof T]?: T[K] }; // 逐字段添加可选标记。
type ElementOf<T> = T extends readonly (infer Item)[] ? Item : never; // 匹配数组并提取元素类型。

type Name = ElementOf<readonly string[]>; // Item 被推断为 string。
type OptionalTask = OptionalFields<{ id: string; done: boolean }>; // id、done 都可省略。

const limits = { low: 1, high: 5 } as const satisfies Record<string, number>; // 检查每个值是 number，并保留精确字面量。
const high = limits.high; // 类型是字面量 5，而不只是 number。
```

`satisfies` 检查表达式是否符合目标类型，同时尽量保留表达式原有的精确信息；它不是类型断言，也不是运行时校验。`as const` 会进一步把属性收窄并标成只读。

练习 11：把 `high` 改成字符串，让 `satisfies` 报错。写 `type UnwrapPromise<T> = T extends Promise<infer V> ? V : T`，分别验证 `Promise<number>` 和 `string`。自检：前者得到 `number`，后者仍是 `string`；`satisfies` 拒绝字符串值，但不会在运行时转换它。

## 12. 类、访问器、可见性和继承

类同时产生运行时构造函数和实例类型。`private` 是 TypeScript 层面的访问限制；`#field` 是 JavaScript 运行时私有字段。`get`/`set` 把读取和赋值包装成方法调用。类需要维持不变量时才比普通对象更合适。

不变量是对象始终必须满足的条件，例如计数器不能通过 `increment` 减少。把状态藏在 `#value`，外部只能经由公开方法操作。`get value()` 看起来像属性读取，实际上执行读取方法。`static` 方法属于类本身，要写 `Counter.from(...)`，而不是 `counter.from(...)`。

```typescript
class Counter {
  #value: number; // JavaScript 私有字段，类外不能直接访问。

  constructor(initial = 0) {
    this.#value = initial; // 新实例创建时保存初始值。
  }

  get value(): number { return this.#value; } // 对外只提供读取入口。

  increment(step = 1): void {
    if (step < 0) throw new Error("step must be non-negative"); // 拒绝负步长。
    this.#value += step; // 默认增加 1；void 表示不返回有意义的值。
  }
}

const counter = new Counter(2); // 构造初值为 2 的实例。
counter.increment(); // 未传 step，使用默认值 1。
console.assert(counter.value === 3); // 通过 getter 读取结果。
```

`implements SomeInterface` 只检查类实例形状，不会自动生成方法。继承 `extends Base` 是运行时关系；优先用组合表达“持有另一个对象”，只在确实是同一种对象时继承。

练习 12：给 `Counter` 增加 `reset(): void` 和 `static from(value: number): Counter`；尝试从类外读取 `counter.#value`，记录检查或语法错误。写一个接口约束 `readonly value: number` 和 `increment(step?: number): void`，让 `Counter implements` 它。自检：`reset()` 后值为 0；`Counter.from(5).value` 为 5；类外访问私有字段失败；`implements` 本身没有生成额外运行时代码。

## 13. 模块、导入导出与源码后缀

一个文件就是一个模块。`export` 暴露值或类型，`import` 引入它。只引用类型时用 `import type`，运行时不会加载这项导入。相对路径在直接运行 `.ts` 源码时写实际后缀 `.ts`；打包或编译产物的解析规则可能不同。

这里分清“值”和“类型”：`sum` 是运行时存在的函数，`Pair` 只用于静态检查。导入类型时使用 `import type` 能明确告诉读者和工具，这项导入在执行时不存在。一个模块被导入时，它的顶层语句会执行；因此可复用模块的顶层通常只放定义和必要的初始化。

`math.ts`：

```typescript
export type Pair = { left: number; right: number }; // 只导出类型，运行时没有 Pair 对象。
export function sum(pair: Pair): number { return pair.left + pair.right; } // 导出真实函数。
```

`main.ts`：

```typescript
import { sum } from "./math.ts"; // 值导入：运行时需要找到并加载 sum。
import type { Pair } from "./math.ts"; // 类型导入：检查后会被擦除。

const pair: Pair = { left: 2, right: 3 }; // 检查两个数字字段是否齐全。
console.log(sum(pair)); // 运行时输出 5。
```

在两个文件所在目录运行 `node main.ts`。检查时加 `--allowImportingTsExtensions`：`npx --no-install tsc --noEmit --strict --target ES2024 --module NodeNext --moduleResolution NodeNext --erasableSyntaxOnly --allowImportingTsExtensions main.ts math.ts`。不要在模块顶层写有副作用的测试数据，除非导入该模块时确实要执行它。

练习 13：增加 `multiply(pair: Pair)` 并从 `main.ts` 调用；故意把 `import type { Pair }` 用作运行时值，观察编译器报错。自检：同一组 `{ left: 2, right: 3 }` 求和为 5、求积为 6；`Pair` 不能写成 `new Pair()`，因为类型别名不是构造函数。恢复正确代码后分别运行 `node main.ts` 与上面的静态检查命令。

## 14. `Promise`、`async/await`、并发和异步迭代

`async` 函数总返回 `Promise<T>`。`await` 等待当前 Promise 的结果，但不会阻塞整个进程。依次 `await` 两个相互独立的任务会串行等待；`Promise.all` 可以并发等待，任一个拒绝则整体拒绝。`for await...of` 逐个消费异步流。

`Promise<T>` 可以理解为“将来得到一个 T，或者得到一个失败原因”。调用异步函数会立即拿到 Promise；遇到 `await`，当前函数暂停，事件循环仍能继续处理其他任务。把两个 Promise 一起交给 `Promise.all`，结果数组保持输入顺序，与完成先后无关。并发等待不等于让普通 JavaScript 计算自动在多个 CPU 核上并行。

```typescript
async function fetchNumber(value: number): Promise<number> {
  return value * 2; // async 会把数字结果包装为 Promise<number>。
}

async function* numbers(): AsyncIterable<number> {
  yield 1; // 消费者第一次迭代时取得 1。
  yield 2; // 第二次取得 2，之后迭代结束。
}

async function run(): Promise<void> {
  const [a, b] = await Promise.all([fetchNumber(2), fetchNumber(3)]); // 两个调用先创建 Promise，再一起等待；结果是 4、6。
  let total = a + b; // 从 10 开始累加。
  for await (const value of numbers()) total += value; // 逐次得到 1、2，累加为 13。
  console.assert(total === 13); // Promise.all 保持输入顺序，异步迭代逐项消费。
}
void run(); // 启动示例；此处不使用返回的 Promise。
```

上例中的 `Promise.all` 适合互不依赖的计算；如果第二步必须用第一步结果，就应按顺序 `await`。不要把一个流的中间片段误当作最终结果。

练习 14：让 `numbers()` 产生 1、2、3，调整断言。编写一个 `fetchNumber` 抛错的分支，并在 `run` 中用 `try/catch` 输出错误消息。自检：正常总和从 13 变为 16；抛错时进入 `catch`，不会继续执行 `try` 中位于失败 `await` 之后的语句；`catch` 中先用 `instanceof Error` 判断再读取 `.message`。

## 15. 异常、`finally`、取消和订阅清理

在 `catch` 中先把错误看作 `unknown`，再判断是否为 `Error`。`finally` 不论成功、抛错或提前返回都会执行，适合释放资源。`AbortSignal` 只是取消信号，异步操作是否真正停止，要看执行代码有没有检查或传递它。

取消有时间顺序：① 调用前已取消，入口检查立即终止；② 入口检查通过，等待期间取消，等待后再次检查才能终止；③ 所有检查都已通过才取消，操作可能已经完成。`AbortController.abort()` 不会自动把普通 Promise 停掉。真正支持取消的外部 API 通常需要显式接收 `signal`。`finally` 可清理订阅、文件句柄或锁，但不要在其中无意覆盖原本的返回值或错误。

```typescript
async function work(signal: AbortSignal): Promise<string> {
  try {
    if (signal.aborted) throw new Error("aborted"); // 处理调用前就取消的情况。
    await Promise.resolve(); // 形成一个异步边界，函数稍后继续。
    if (signal.aborted) throw new Error("aborted"); // 处理等待期间取消的情况。
    return "done"; // 两次检查都通过才返回成功。
  } finally {
    console.log("cleanup"); // 成功、抛错或提前返回都会执行。
  }
}

async function demo(): Promise<void> {
  const controller = new AbortController(); // controller 持有取消操作，signal 交给工作函数。
  controller.abort(); // 在调用前取消；work 的第一次检查就会抛错。
  try { await work(controller.signal); } // await 把拒绝的 Promise 转为当前函数中的异常。
  catch (error: unknown) {
    if (error instanceof Error) console.log(error.message); // 先判断形状，再读取 message。
  }
}
void demo(); // 输出顺序：cleanup，然后 aborted。
```

订阅函数通常返回一个取消订阅函数。持有订阅时，也要明确何时退订；不要以为事件源会自动知道你不再需要回调。

一个最小订阅例子如下。`Set` 保证同一函数只保存一次；返回的闭包记住这次传入的 `handler`，所以能精准删除它。删除只影响后续通知，不会撤回已经发生的调用。

```typescript
const listeners = new Set<(message: string) => void>(); // 保存当前订阅的回调。

function subscribe(handler: (message: string) => void): () => void {
  listeners.add(handler); // 订阅时登记回调。
  return () => { listeners.delete(handler); }; // 返回清理函数；调用后不再收到后续消息。
}

function publish(message: string): void {
  for (const listener of listeners) listener(message); // 只通知当前集合里的回调。
}

let calls = 0;
const unsubscribe = subscribe(() => { calls += 1; }); // 记住退订入口。
publish("first"); // calls 变为 1。
unsubscribe(); // 移除刚才的回调。
publish("second"); // 回调不会再执行，calls 仍为 1。
console.assert(calls === 1);
```

练习 15：给订阅例子增加第二个回调，验证只退订第一个时第二个仍收到消息。给 `work` 增加“首次检查通过、等待期间取消”的测试，例如先调用 `const pending = work(controller.signal)`，紧接着 `controller.abort()`，再 `await pending` 并捕获错误。自检：取消发生在第二次检查前；`cleanup` 只输出一次；已退订回调的计数不再增加。

## 16. 集合、解构、展开和常见陷阱

`Map<K, V>` 用任意键映射值，`Set<T>` 保存不重复的值。`Record<string, V>` 是对象形状的类型，不会在运行时创建 Map。解构提取字段；展开复制外层容器，不能自动完成深拷贝。

`Map` 有明确的 `.get`、`.set`、`.has` 和 `.size` API，键还能是对象；普通对象适合字段名已知、需要 JSON 序列化的记录。用 `.get` 读取 Map 时，返回类型通常包含 `undefined`，因为键可能不存在。解构中的 `...rest` 建立一个新外层对象，但嵌套对象仍会共享引用。

```typescript
const scores = new Map<string, number>([["a", 1]]); // 键为 string，值为 number。
scores.set("b", 2); // 增加或覆盖键 b。
const unique = new Set(["a", "a", "b"]); // 重复的 a 只保留一次。
const config = { retries: 2, mode: "fast" };
const { retries, ...rest } = config; // retries 为 2；rest 为 { mode: "fast" }。
const changed = { ...rest, retries: 0 }; // 建立新对象，覆盖 retries。
console.assert(scores.get("b") === 2 && unique.size === 2 && changed.retries === 0); // 验证集合与展开结果。
```

读到 `!` 要分清：`!condition` 是运行时布尔取反；`value!` 是非空断言，只影响类型检查。读到 `as` 也要问：这是类型断言，还是 `as const` 的字面量收窄？两者都不验证外部输入。

练习 16：实现词频统计，输入 `string[]`，返回 `Map<string, number>`；重复词累计，空数组返回空 Map。可用 `counts.set(word, (counts.get(word) ?? 0) + 1)`。再把结果转成普通对象。自检：`['a', 'b', 'a']` 对应 a:2、b:1；空数组结果 `.size === 0`。需要任意键及增删查 API 时选 Map；需要普通 JSON 字段结构时用对象，`Record` 只是它的静态类型。

## 17. 需要认识但不必优先使用的语法

- `enum` 会生成运行时代码。直接用 Node 的类型擦除方式运行时可能不被支持；大多数状态集合可以用字符串字面量联合和 `as const` 对象表达。
- `namespace` 和 `import =` / `export =` 是较旧的模块组织方式。现代项目通常使用标准 `import` / `export`。
- 构造函数参数属性如 `constructor(private id: string) {}` 需要生成赋值代码；使用直接执行 `.ts` 的环境时，写显式字段与构造器赋值更可预测。
- 装饰器、JSX、部分实验特性需要额外编译配置。先读清构建工具与运行环境，再决定是否使用。
- `as unknown as T` 能强行绕过检查，却没有证明输入真是 T。边界数据必须用守卫或校验器验证。

看到旧代码中的这些写法，先判断它有没有运行时代码、当前执行环境能否处理、是否需要替换。下面的替代写法使用字符串值作为状态，`Record<Mode, string>` 要求每个状态都有说明；增加第三种模式后，遗漏说明会成为类型错误。

```typescript
type Mode = "read" | "write"; // 编译期的状态集合，运行时不生成 enum 对象。
const descriptions: Record<Mode, string> = {
  read: "读取", // Mode 的第一个成员必须有对应值。
  write: "写入", // Mode 的第二个成员也必须有对应值。
};
console.assert(descriptions.read === "读取");
```

练习 17：将上述 `Mode` 加入 `"execute"`，先观察 `descriptions` 缺少键时报错，再补上说明。自检：三种模式都有字符串描述；删除任意一个必需键时静态检查失败。能说明原始 `enum Mode { Read, Write }` 默认是数字状态，而字符串联合没有对应的运行时对象。

## 18. 声明文件 `.d.ts` 与 `declare module`

有些模块没有类型：打包进依赖的 JavaScript、`.wasm` 文件、甚至 `.json` 资源。`.d.ts`（声明文件）只含类型声明，没有任何运行时代码，作用是让 `tsc` 认识这些外来模块的形状。项目里 `packages/ai/src/providers/data-json.d.ts` 让整个目录的 JSON 导入都通过检查，`packages/coding-agent/src/utils/highlight-js.d.ts` 为 `highlight.js` 的深层路径补类型。

通配声明用模式匹配导入路径；`declare module "具体包名"` 还可以给已有模块追加成员（模块扩充），`packages/coding-agent/src/core/keybindings.ts` 就用它给 TUI 包的键位接口追加应用自己的键位。

资产声明 `assets.d.ts`：

```typescript
// assets.d.ts：只参与检查，不会生成任何 JavaScript。
declare module "*.meta" { // 通配声明：任何以 .meta 结尾的导入都按此形状检查。
  const content: string;
  export default content;
}
```

模块扩充 `augment.ts`：

```typescript
// augment.ts：给已有模块的接口追加字段，而不是替换它。
import type { Keybindings } from "@earendil-works/pi-tui";

declare module "@earendil-works/pi-tui" {
  interface Keybindings {
    "app.customAction": string; // 与原有 Keybindings 接口合并。
  }
}
```

声明文件只影响类型检查，不会让运行时的加载自动成功；`.wasm` 导入能通过 `tsc`，运行时仍需要自己的加载代码。

练习 18：仿照 `data-json.d.ts`，写 `globals.d.ts` 用 `declare const` 声明一个由打包器注入的全局常量 `PI_BUNDLED_NODE: boolean`；在 `main.ts` 中用 `typeof PI_BUNDLED_NODE !== "undefined"` 保护后再读取。自检：不声明时 `tsc` 报“找不到名称”，声明后通过；运行时该常量可能不存在，typeof 保护不能省略。

## 19. 名义类型：`unique symbol` 品牌

结构类型检查下，形状相同的值可以互换，`string` 类型的用户 id 和订单 id 无法区分。品牌（brand）技术用 `unique symbol` 在类型上加一个不可见的标记，运行时代价为零。项目的 durable 包用 `Id<"submission">`、`Id<"document">` 让两种 id 互不混用。

```typescript
declare const userIdBrand: unique symbol; // 只为类型存在的键，擦除后没有任何输出。
type UserId = string & { readonly [userIdBrand]: void }; // 仍是 string，但多一个私有标记。

function toUserId(value: string): UserId {
  if (value.length === 0) throw new Error("empty id"); // 品牌只允许在这里“铸造”。
  return value as UserId; // 断言集中在一个做过校验的函数内。
}

function loadUser(id: UserId): void { console.log(id); }

const id = toUserId("u-1");
loadUser(id); // 正常。
// loadUser("u-1"); // 取消注释报错：普通 string 不能代替 UserId。
console.log(typeof id); // "string"：运行时品牌完全消失。
```

练习 19：再定义 `OrderId` 品牌，写 `function link(user: UserId, order: OrderId): string`；尝试把 `UserId` 传给 `order` 参数，观察报错。自检：`const plain: string = id` 合法（品牌类型是 string 的子类型），反向必须经 `toUserId`。

## 20. 抽象类与 `override`

抽象类是“不能直接实例化的基类”：它把一族类型的公共骨架和已实现逻辑放在一起，同时强制子类补齐剩余方法。项目的 `TransportEvents`、`Stack`、`TuiBase` 都是抽象基类。`override` 显式标记“这个成员有意重写父类”，父类没有同名成员时静态报错，能抓住拼写漂移。

```typescript
abstract class Store { // 不能直接 new Store()。
  abstract get(key: string): string | undefined; // 子类必须实现。

  has(key: string): boolean { // 已实现：子类可复用，也可按需要改写。
    return this.get(key) !== undefined;
  }
}

class MemoryStore extends Store {
  readonly #data = new Map<string, string>();

  override get(key: string): string | undefined { // 重写抽象成员。
    return this.#data.get(key);
  }

  override has(key: string): boolean { // 重写已实现成员；误写成 hsa 会立即报错。
    return this.#data.has(key);
  }
}

// new Store(); // 取消注释报错：抽象类不能实例化。
```

练习 20：给 `Store` 增加抽象方法 `keys(): string[]`，先观察 `MemoryStore` 漏实现时的报错，再补上；然后把 `override has` 故意改成 `override hsa`，记录错误。自检：说明 `override` 在默认配置下不是强制的（项目也未开启 `noImplicitOverride`），它首先是意图文档，其次是拼写保护。

## 21. `import.meta` 与 `import.meta.url`

`import.meta` 是当前模块的运行时元信息，`import.meta.url` 是本模块文件的 URL。ESM 没有 `__dirname`，要定位与源文件同目录的资源就用它换算。项目的 `config.ts` 依据 `import.meta.url` 的特征判断当前是源码运行、npm 安装还是打包后的二进制。

```typescript
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // 本文件所在目录的绝对路径。
// join(here, "data.txt") 表示与本文件同目录的资源路径。
console.log(import.meta.url.startsWith("file://")); // true：本地运行时是 file:// URL。
```

练习 21：分别打印 `import.meta.url` 与 `here`，比较两者；把文件挪到另一个目录运行，观察路径跟随变化。自检：URL 含 `file://` 前缀和百分号转义，必须经 `fileURLToPath` 转换，不能字符串截取。

## 22. JSON 模块导入与导入属性

项目的模型数据以 `.json` 文件随包发布，源码直接导入（如 `packages/ai/src/providers/anthropic.models.ts`）。开启 `resolveJsonModule` 后，`tsc` 按 JSON 内容推断导入的类型；`with { type: "json" }` 是导入属性，Node.js 要求显式写出才会按 JSON 解析。

```typescript
import values from "./models.json" with { type: "json" };
// values 的类型由 tsc 依据文件内容推断；运行时由 Node.js 按 JSON 解析。

console.log(Array.isArray(values)); // 仍是外部数据：文件可能被改动，边界处仍要校验。
```

静态检查需追加 `--resolveJsonModule`；若报 TS2856（导入属性不能用于编译到 CommonJS 的导入），在练习目录放一个内容为 `{"type": "module"}` 的 `package.json`。

练习 22：新建 `models.json`（含 `name` 字段的数组），导入并输出第一个 `name`；分别运行 `node main.ts` 与带 `--resolveJsonModule` 的检查命令。自检：删去 `with { type: "json" }` 后运行时立即报错，说明导入属性是 Node.js 的运行时要求，不是类型语法。

## 23. 模板字面量类型与 `const` 泛型参数

模板字面量类型把字符串模式写进类型：`/api/${string}` 表示“以 `/api/` 开头的任意字符串”，适合路由、事件名等约定。`const` 泛型参数让传入的字面量在推断时保持字面量类型，免去在调用处写 `as const`。项目的模型目录（`model-catalog.ts`）同时使用这两者锁住 provider 与分组名。

```typescript
type Route = `/api/${string}`; // 模板字面量类型：编译期的字符串模式。
const ok: Route = "/api/users"; // 满足模式。
// const bad: Route = "/web/users"; // 取消注释报错：模式不匹配。

function pick<const T extends readonly string[]>(items: T): T[number] {
  return items[0]; // const 让 T 保持 readonly ["a", "b"]。
}

const first = pick(["a", "b"]); // first 的类型是 "a" | "b"，而不是宽化的 string。
console.log(ok, first);
```

练习 23：定义 `type Action = `demo/${"get" | "post"}/${string}``，各写一个合法值和一个非法值，观察检查行为。自检：模板类型只在编译期匹配模式，来自外部的字符串仍需运行时校验；`const` 泛型作用于参数推断，`as const` 作用于表达式，二者互补。

## 24. 桶文件与类型再导出

包通常用一个 `index.ts` 汇总内部模块（桶文件）。再导出时同样要区分值与类型：`export * from` 把值和类型一起转发；`export type { } from` 只转发类型；`import { type X }` 在值导入语句里内联标记单个类型成员。项目的每个包都有桶文件，且 `tsconfig.base.json` 开启 `verbatimModuleSyntax`：纯类型的导入导出必须显式标 `type`，这就是代码中大量 `import { type X }` 的原因。

```typescript
// index.ts：三种形式按需要选用；同一成员只能再导出一次。
export * from "./counter.ts"; // 形式一：值与类型全部转发。
export type { Job, JobResult } from "./job.ts"; // 形式二：只转发类型，不产生运行时代码。
// 形式三（与形式二等价的内联写法）：
// export { type Job, type JobResult } from "./job.ts";
```

练习 24：把第 13 节的 `math.ts` 和一个含类型的 `types.ts` 汇总进 `index.ts`，`main.ts` 只从 `"./index.ts"` 导入；运行 `node main.ts` 与第 13 节的静态检查命令。自检：删掉 `export type { Job }` 后，仅消费类型的位置仍能通过检查——类型再导出本来就擦除；但 `verbatimModuleSyntax` 开启时，把类型混进值导出且不加 `type` 会报错。

## 25. 显式资源管理：`using` 与 `Symbol.dispose`

`using` 声明在离开作用域时自动调用对象的 `[Symbol.dispose]()`，中途抛错也会执行，比手写 `try/finally` 更贴近“申请—释放”的成对结构；异步资源用 `await using` 配 `[Symbol.asyncDispose]()`。项目的遥测测试夹具用 `await using fixture = await factory()` 保证测试结束释放资源。

```typescript
class TempFile {
  static open(): TempFile { return new TempFile(); }
  [Symbol.dispose](): void { console.log("closed"); } // 作用域结束时自动调用。
}

{
  using file = TempFile.open(); // 块结束即释放。
  console.log("working", file !== undefined);
} // 此处输出 closed。
```

注意运行环境：`using` 是 JavaScript 语法而不是类型注解，Node 22/23 的类型擦除模式直接运行会报 SyntaxError（本机 Node 23.9 实测），需要较新的 Node 或经转译；静态检查时给命令追加 `--lib ES2024,ESNext.Disposable,DOM`。

练习 25：用 `try/finally` 重写上面的等价逻辑，对比两种写法的行数与异常路径。自检：说明 `using` 适合“变量生命周期就是资源生命周期”的局部场景；资源需要跨函数传递时，仍要手动 `dispose` 或返回清理函数。

## 综合动手：处理一批未知输入

下面的 `study.ts` 是完整、可运行的基础样例。它把未知输入校验为任务，计算结果，并用判别联合表达成功和失败。先原样运行并通过静态检查，再完成后面的改造任务。

阅读顺序：先看 `Job` 描述合法输入，再看 `isJob` 如何在运行时证明输入合法，然后看 `processJob` 如何处理取消与计算，最后看 `main` 怎样检查结果。特别留意：`input` 在通过 `isJob` 前只能按 `unknown` 使用，通过后才可以读取 `input.values`。示例允许空数组，所以求和初始值必须写 0。

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

这个样例同时用到了别名、可选字段、联合、判别字段、`unknown`、类型守卫、`Record`、数组方法、泛型工具类型、`async/await`、`Promise.all`、可选链、空值合并和取消信号。正常输出是 `3 inputs, 2 successes, 1 validation failure`。`void main()` 表示刻意不使用返回的 Promise；正式程序若要控制退出码，应在顶层处理拒绝，例如 `main().catch((error: unknown) => { console.error(error); process.exitCode = 1; })`。

沿一条失败输入追踪：第三个对象先进入 `processJob`，`signal` 不存在，第一次取消判断跳过；`isJob` 检查 `values`，发现 `"5"` 不是数字，于是返回 `{ ok: false, id: "bad", reason: "invalid job" }`。它不会走到 `reduce`，因此坏数据不会被当作数字计算。`Promise.all` 收到的是三个正常兑现的 `JobResult`；这里“业务失败”是一个结果值，并非 Promise 拒绝。

沿一条成功输入追踪：第一项通过守卫后，`input` 从 `unknown` 缩小为 `Job`；异步边界之后再次确认未取消；`reduce` 得到 6，`input.label ?? "untitled"` 得到默认标签。`filter` 的类型谓词让 `successes` 中的元素可以直接读 `total`。若去掉谓词、仅写普通布尔回调，请观察当前 TypeScript 版本是否仍能推断收窄，再说明显式谓词要表达的契约。

### 改造任务

1. **类型与校验**：给 `Job` 增加 `priority?: "low" | "normal" | "high"`。在 `isJob` 中增加条件：字段不存在，或值属于这三个字符串之一。成功结果增加必填 `priority`，缺席时用 `?? "normal"`。非法优先级、空 id、`NaN`、`Infinity`、负数分别写一个输入用例。原样例只要求“有限数字”，所以负数原本会通过；为使负数失败，新增 `item >= 0` 的运行时检查。逐例记录通过或失败原因。
2. **返回结果**：成功分支加入 `average: number | null`。空数组返回 `null`，非空数组返回 `total / input.values.length`。先检查长度，再做除法，避免得到 `NaN`。在结果消费处使用 `if (result.ok)` 读取它；失败分支没有 `average`，不要用 `as` 强行读取。
3. **泛型**：写 `groupBy<T, K extends string | number>(items: readonly T[], key: (item: T) => K): Map<K, T[]>`。对每项计算键，从 Map 取已有组；若不存在先放空数组，再加入当前项。按成功结果的 `label` 分组，构造“两项同标签、一项不同标签”的输入，断言组数为 2、成员数分别为 2 和 1。不得使用 `any`。
4. **异步与取消**：新增 `processJobs(inputs: readonly unknown[], signal?: AbortSignal): Promise<JobResult[]>`。选择顺序处理或 `Promise.all` 并记录原因：顺序处理便于在取消后停止启动后续项；并发处理会同时启动多个任务，单个取消信号需要传给每项。预先取消与处理期间取消都要有测试。对处理中取消，明确结果数组是否保留已完成项、是否产生未处理项的结果，并让实现与这个约定一致。
5. **模块化**：把类型、校验与处理函数导出到 `job.ts`，在 `main.ts` 中用值导入和 `import type` 分别引入函数与类型。相对路径写实际 `.ts` 后缀。依次运行 `node main.ts` 和第 13 节带 `--allowImportingTsExtensions` 的静态检查命令，按实际文件名调整参数。
6. **类与订阅**：写 `JobLog` 类，内部保存结果列表；对外返回新数组或只读快照，避免暴露内部可变数组。`onResult(handler)` 把回调加入 `Set` 并返回退订函数。每处理完一项，先保存结果再通知当前订阅者。测试顺序为“订阅、处理第一项、退订、处理第二项”，断言旧回调只收到第一项。

### 覆盖用例与验收

| 用例            | 输入 / 操作                                    | 预期                                          |
| --------------- | ---------------------------------------------- | --------------------------------------------- |
| 正常求和        | `[1, 2, 3]`                                  | total = 6，average = 2                        |
| 空数组          | `[]`                                         | total = 0，average = null                     |
| 缺省标签/优先级 | 不传两个可选字段                               | `"untitled"` / `"normal"`                 |
| 非法数值        | `NaN`、`Infinity`、负数                    | 均被校验拒绝                                  |
| 非法结构        | `null`、数组、字符串、缺 id、values 含字符串 | 返回失败结果，不发生类型断言造成的异常        |
| 预先取消        | 调用前`controller.abort()`                   | 返回 aborted，不计算结果                      |
| 中途取消        | 在异步边界前后触发取消                         | 按所选处理策略稳定返回 aborted 或停止后续任务 |
| 分组            | 两项同 label、一项不同 label                   | Map 中组数和成员数正确                        |
| 退订            | 先订阅、后退订、再处理任务                     | 退订后的处理不调用旧回调                      |
| 静态检查        | `tsc --noEmit --strict`                      | 无错误；不使用`any` 或双重断言绕过输入校验  |

交付物是 `job.ts`、`main.ts`、一份覆盖上表的可运行断言或测试，以及简短记录：哪一步属于类型检查，哪一步是真实运行时校验，哪两个异步操作可以并发。完成时应能独立解释 `unknown` 与 `any`、`??` 与 `||`、联合与交叉、`import type` 与值导入、`readonly` 与运行时不可变这五组区别；若学到第 18-25 节，还应能说明 `declare module` 与值导入、`unique symbol` 品牌与结构类型、`using` 与 `finally` 这三组补充区别。

建议按四轮验收：第一轮原样运行 `study.ts` 并记录输出；第二轮每完成一个改造点就运行 `tsc --noEmit --strict` 与相关断言；第三轮在预先取消、中途取消、空数组和坏输入上逐项观察结果；第四轮拆分模块后运行最终 `main.ts`。每轮都保留一个“故意写错、确认 `tsc` 能抓住、再修复”的小实验，避免只看运行结果误以为静态约束生效。
