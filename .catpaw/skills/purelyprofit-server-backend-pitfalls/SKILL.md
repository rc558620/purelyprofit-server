---
name: purelyprofit-server-backend-pitfalls
description: Captures recurring backend implementation pitfalls in purelyprofit-server, especially TypeScript typing, DTO boundaries, raw SQL row mapping, Prisma transaction return shapes, pagination assembly, and ESLint no-unsafe/no-unnecessary-type-assertion issues. Use when fixing strange lint errors, refactoring service-layer types, mapping raw query results, or wanting to avoid repeated backend mistakes in this repository.
---

# purelyprofit-server 后端踩坑记录

## 什么时候用这个 skill

遇到下面场景时优先使用：

- 修 `@typescript-eslint/no-unsafe-*`、`no-unnecessary-type-assertion`、`unbound-method`
- service 里出现 `error typed`、`unsafe member access`、`unsafe assignment`
- 把对象方法拆出来赋值后，开始报 `this` 绑定相关 lint
- DTO、raw SQL row、response DTO 之间类型开始互相污染
- Prisma 事务返回值、`Promise.all()` 解构后类型不稳定
- 想在动手前先避开这个仓库里已经踩过的坑

## 核心原则

- controller 入参边界和 service 内部消费类型分开
- 数据库行类型、业务输入类型、响应 DTO 类型分层建模
- 先修“源头类型污染”，不要在末端到处补 `as`
- 已有泛型时先信泛型，避免重复断言
- 返回值组装优先稳定、可读、局部显式，而不是追求一次性花式推导

## 高风险信号

看到这些现象时，优先怀疑是上游类型已经坏了：

- 一个字段开始同时报 `no-unsafe-argument`、`no-unsafe-member-access`、`no-unsafe-assignment`
- 某个 DTO 字段明明写了类型，进入 service 后却被推成 `error typed`
- `$queryRaw<Foo[]>()` 已写泛型，后面还想继续补 `as Foo[]`
- `Promise.all()`、事务元组解构后，每个元素都开始报 unsafe
- 改了一个类型断言，lint 报错反而越修越多

## 排查顺序

按这个顺序查，通常返工最少：

1. 先查 controller 传入 service 的类型边界是不是过重依赖 DTO class
2. 再查 SQL row / Prisma 返回值是不是缺少本地明确类型
3. 再查事务返回值和 `Promise.all()` 是否用了不稳定的数组元组解构
4. 最后才处理 mapper 和 response 组装

## DTO 相关坑

### 坑 1：把 decorated DTO 直接当 service 内部长生命周期类型

症状：

- `query.storeId`、`query.type`、`dto.userId` 开始报 unsafe
- `Dto['field']` 索引访问类型也一起变脏

推荐写法：

- DTO class 只作为 controller 边界类型
- 进入 service 后，如果只消费部分字段，定义本地 `interface` / `type`
- service 内不要长期依赖带装饰器的 DTO class 做复杂类型推导

示意：

```ts
interface MemberPointsLogsQuery {
  storeId?: number;
  page?: number;
  pageSize?: number;
  type?: MemberPointsRecordTypeValue;
  source?: MemberPointsRecordSourceValue;
  keyword?: string;
}
```

### 坑 2：用 `Dto['type']`、`Dto['source']` 到处传播类型

症状：

- 上游 DTO 一脏，下游所有索引访问类型一起脏
- 一个字段同时污染 query builder、mapper、response 组装

推荐写法：

- service 私有方法的参数直接写本地联合类型或本地 interface
- 不要为了“复用一点类型”把整个类型链绑死在 DTO 上

## raw SQL / Prisma 相关坑

### 坑 3：raw SQL 行类型不本地化

症状：

- `$queryRaw()` 返回结果和 response DTO 混在一起
- mapper、service、事务返回值互相污染

推荐写法：

- 每条 raw SQL 的结果优先定义本地 row interface
- row interface 只描述数据库查询结果，不要混入 response DTO 语义

示意：

```ts
interface BeanLogRecord {
  id: number;
  memberId: number;
  memberName: string;
  memberPhone: string | null;
  amount: number;
  source: MemberBeanRecordSourceFilter;
  description: string;
  relatedPromoId?: string | null;
  relatedUser?: string | null;
  createdAt: Date;
}
```

### 坑 4：已经有泛型还继续补同形态断言

反模式：

```ts
const rows = (await prisma.$queryRaw<Foo[]>`...`) as Foo[];
```

推荐：

```ts
const rows = await prisma.$queryRaw<Foo[]>`...`;
```

适用范围：

- `$queryRaw<Foo[]>()`
- `Promise.all([...])`
- 已经能稳定推断的事务返回值

## 事务和 Promise.all 相关坑

### 坑 5：事务里直接返回数组元组，解构后类型漂移

症状：

- `const [member, log] = ...` 后 `log` 突然变成 error typed
- 后续 mapper / response 组装全部开始 unsafe

推荐写法：

- 优先返回命名对象：`return { member, log }`
- 命名对象比裸元组更稳，也更容易局部收窄字段类型

示意：

```ts
const result: { member: MemberRecord; log: BeanLogRecord } =
  await this.prisma.$transaction(async (transaction) => {
    // ...
    return {
      member: this.requireMemberRow(memberRows[0]),
      log: this.requireBeanLogRow(logRows[0]),
    };
  });
```

### 坑 6：一边解构 `Promise.all()` 一边直接复杂 map

症状：

- `[items, countRows]` 解构时报 unsafe destructuring
- `items.map(...)` 的返回又继续 unsafe

推荐写法：

- 先用显式结果类型接住整体结果
- 再拆 `items` / `countRows`
- 再组装 `responseItems`

示意：

```ts
const queryResult: [BeanLogRecord[], CountRow[]] = await Promise.all([
  this.prisma.$queryRaw<BeanLogRecord[]>`...`,
  this.prisma.$queryRaw<CountRow[]>`...`,
]);
const items = queryResult[0];
const countRows = queryResult[1];
```

## response 组装相关坑

### 坑 7：response DTO、mapper、row type 三层混用

症状：

- mapper 明明能用，但一调用就 unsafe
- response 对象局部字段总是被判不安全

推荐写法：

- 正常情况优先复用 mapper
- 如果 lint 在这条链路失真，可以在当前 service 做一层局部显式映射
- 但必须保证字段名、枚举值、可选字段、时间字段和 DTO 完全对齐
- 修 lint 时不要顺手改接口语义

### 坑 8：末端狂补断言掩盖源头问题

反模式：

- `as AdjustMemberBeansResponseDto`
- `as Foo[]`
- `as unknown as ...`

推荐：

- 先找 DTO 边界是不是污染了 service
- 再找 row type 是不是缺失/混用
- 只有确认推断就是不稳定，才做最小范围显式标注

## DTO 导出常量 / 联合类型相关坑

### 坑 9：把共享枚举常量和联合类型绑在 decorated DTO 文件里

症状：

- mapper / utils 明明只 import 了 `const` 或 `type`，却开始报 `error typed`
- `MEMBER_LEVEL_VALUES.includes(...)` 这类本来很普通的调用突然报 `unsafe call`、`unsafe member access`
- response 对象里某个字段只是赋值给联合类型，lint 却报 `unsafe assignment`
- 同一个 DTO 文件里既有 `class-validator` / Swagger 装饰器 class，又导出了给 service / mapper 复用的常量与 type

推荐写法：

- 共享的枚举常量、联合类型、纯转换函数，优先放到不含装饰器的 `*.utils.ts` / `*.types.ts` / `constants.ts`
- DTO 文件只负责 controller 边界 class；如果前端/其他模块还从 DTO 文件取类型，可以在 DTO 文件里做 re-export
- mapper / service 优先依赖“纯类型模块”，不要直接把 decorated DTO 文件当共享类型中心
- 如果只是想给 Swagger DTO 复用枚举值，就从纯模块 import 进 DTO，而不是反过来让业务层从 DTO 取

## 方法引用 / this 绑定相关坑

### 坑 10：把实例方法拆出来再调用，触发 `unbound-method`

症状：

- `const resolver = service.someMethod as (...) => ...` 一类写法开始同时报 `unbound-method`
- 为了压住 `this` 绑定问题，顺手补了一个函数类型断言，结果又触发 `no-unnecessary-type-assertion`
- 这个方法本身其实不需要单独拿出来传递，只是本地包了一层转发

推荐写法：

- 能直接通过对象调用，就直接 `return service.someMethod(...)`
- 如果后续确实要把方法作为回调传递，再考虑箭头函数、`.bind()` 或显式 `this: void`
- 不要为了“先存到局部变量再调用”去拆实例方法引用
- 如果方法签名本来就能正确推断，先删掉多余断言，再看 lint 是否自然消失

## 这类问题的推荐修法模板

### 场景 A：query DTO 进入 service 后开始 unsafe

- 把 service 方法入参改成本地 interface
- query builder 私有方法也改用本地 interface / union type
- 让 DTO 停留在 controller 边界

### 场景 B：raw SQL + mapper + response 一起炸

- 本地定义 row interface
- `$queryRaw<Row[]>()`
- 事务返回命名对象
- 分页结果先接 `queryResult`
- 最后再组装 responseItems / record

### 场景 C：为了过 lint 想补大量 `as`

先停一下，依次确认：

- 这里的 unsafe 源头是不是 DTO class
- 这里的 row type 是不是其实应该本地定义
- 这里是不是应该返回对象而不是元组
- 这里是不是应该先拆中间变量再 map

如果前三项有一项答案是“是”，先修结构，不要先补断言。

### 场景 D：mapper / utils import DTO 文件后开始 error typed

- 先看这个 import 的是不是 decorated DTO 文件
- 如果导入的是共享枚举值、联合类型、纯 helper，优先把它们迁到无装饰器模块
- DTO 文件可以保留 re-export，兼容 controller / 其他调用方
- 修这类问题时，优先移动“共享类型定义”，不要先在 mapper 里补 `as`

### 场景 E：实例方法拆出来以后同时报 `unbound-method` 和多余断言

- 先看这个方法是不是其实可以直接 `service.method(...)` 调用
- 如果只是本地封装一层转发，不要拆实例方法引用
- 只有在确实要把方法作为独立回调传递时，再选箭头函数、`.bind()` 或 `this: void`
- 如果同时写了 `as (...) => ...`，优先删除断言，避免一处改动引出第二个 lint

## 真实案例索引

### 案例 1：`src/members/members-points.service.ts`

检索关键词：

- `members-points.service.ts`
- `no-unnecessary-type-assertion`
- `no-unsafe-argument`
- `no-unsafe-member-access`
- `error typed`
- `Promise.all tuple`
- `DTO 边界污染`
- `raw SQL row interface`

问题画像：

- 积分/纯利豆记录查询与调整逻辑同时混合了 DTO class、raw SQL 结果、response DTO
- service 内继续透传 decorated DTO，导致 `query.storeId`、`query.type`、`query.source` 一类字段在复杂链路里开始失真
- `Promise.all()` 和事务结果一边解构一边继续 map/组装，放大了 `unsafe assignment`、`unsafe argument`
- 已经写了 `$queryRaw<Foo[]>()`，局部还想继续补同形态 `as Foo[]`

最终修法：

- 把 service 入参与私有查询参数改成本地 interface，例如 `MemberPointsLogsQuery`、`MemberBeansLogsQuery`、`AdjustMemberPointsInput`、`AdjustMemberBeansInput`
- 为 raw SQL 结果定义本地 row type，例如 `BeanLogRecord`、`CountRow`
- 事务结果改为命名对象返回，而不是裸元组
- `Promise.all()` 结果先接显式类型，再拆 `items` / `countRows`
- response 组装阶段只做字段映射，不再用大量 `as` 掩盖上游问题

这次案例对应的坑位：

- 坑 1：把 decorated DTO 直接当 service 内部长生命周期类型
- 坑 2：用 `Dto['type']`、`Dto['source']` 到处传播类型
- 坑 4：已经有泛型还继续补同形态断言
- 坑 5：事务里直接返回数组元组，解构后类型漂移
- 坑 6：一边解构 `Promise.all()` 一边直接复杂 map
- 坑 8：末端狂补断言掩盖源头问题

以后再遇到下面现象，优先回看这个案例：

- 一个 service 同时出现 `no-unsafe-*` 和 `no-unnecessary-type-assertion`
- query DTO 进入 service 后字段类型突然变脏
- raw SQL 查询、mapper、response DTO 三层连锁报错
- 调整一个 `as` 以后，lint 报错数量反而增加

### 案例 2：`src/members/members.mapper.ts`

检索关键词：

- `members.mapper.ts`
- `error typed`
- `unsafe assignment`
- `unsafe call`
- `unsafe member access`
- `MEMBER_LEVEL_VALUES.includes`
- `member-response.dto.ts`
- `decorated DTO 导出常量`

问题画像：

- mapper 明明只是做字段映射，却从 `member-response.dto.ts` 同时导入共享常量和联合类型
- `member-response.dto.ts` 里既有 Swagger / `class-validator` 装饰器 class，又承载了 `MEMBER_LEVEL_VALUES`、`MemberLevelValue`、`MemberRechargeChannelValue` 这类纯共享定义
- 结果 `toRechargeHistory()` 里的 `channel: record.channel`、`toMemberLevel()` 里的 `MEMBER_LEVEL_VALUES.includes(...)`、`toMemberResponse()` 里的 `level: toMemberLevel(...)` 一起开始报 `error typed`
- 问题源头不在 mapper 映射逻辑本身，而在“纯类型定义”和 decorated DTO 文件耦合过深

最终修法：

- 把 `MEMBER_STATUS_VALUES`、`MEMBER_LEVEL_VALUES`、`MEMBER_RECHARGE_CHANNEL_VALUES` 及对应联合类型迁到 `members.utils.ts`
- DTO 文件改为从纯模块 import 并 re-export，继续兼容 controller / DTO 声明使用
- mapper 改为从 `members.utils.ts` 读取 `MemberLevelValue`、`MemberRechargeChannelValue`
- `toMemberLevel()` 改成显式 `switch` 收窄，不再依赖从 DTO 文件拿到的 tuple 常量做 `includes`

这次案例对应的坑位：

- 坑 7：response DTO、mapper、row type 三层混用
- 坑 8：末端狂补断言掩盖源头问题
- 坑 9：把共享枚举常量和联合类型绑在 decorated DTO 文件里

以后再遇到下面现象，优先回看这个案例：

- mapper / utils 只 import 了 DTO 文件里的 `const` / `type`，却开始报 `error typed`
- `includes`、普通字段赋值、简单返回对象一起变成 `unsafe`
- 看起来像 mapper 写坏了，实际是共享类型定义放错层了
- 想在 mapper 里补 `as MemberLevelValue`、`as Foo` 才能过 lint

### 案例 3：`src/members/members.service.ts`

检索关键词：

- `members.service.ts`
- `resolveMembersViewStoreId`
- `unbound-method`
- `no-unnecessary-type-assertion`
- `this 绑定`
- `方法拆出来赋值`

问题画像：

- `resolveViewStoreId()` 内部先把 `this.membersAccessService.resolveMembersViewStoreId` 拆成局部变量再调用
- 为了让局部变量有明确签名，额外补了 `as (...) => Promise<number | null>`
- 由于这个方法不是 `this: void`，拆引用后触发 `@typescript-eslint/unbound-method`
- 而这个断言并没有改变表达式类型，又同时触发 `@typescript-eslint/no-unnecessary-type-assertion`

最终修法：

- 删除局部 `resolver` 变量
- 删除多余的函数类型断言
- 直接改成 `return this.membersAccessService.resolveMembersViewStoreId(...)`
- 如果未来真要把该方法作为回调传递，再按场景选择箭头函数、`.bind()` 或显式 `this: void`

这次案例对应的坑位：

- 坑 4：已经有泛型还继续补同形态断言
- 坑 8：末端狂补断言掩盖源头问题
- 坑 10：把实例方法拆出来再调用，触发 `unbound-method`

以后再遇到下面现象，优先回看这个案例：

- 某个 service 私有方法只是转发，却先把另一个 service 的方法拆出来调用
- 一个位置同时出现 `unbound-method` 和 `no-unnecessary-type-assertion`
- 为了消除 `this` 报错，开始给方法引用补显式函数类型
- 其实没有回调传递需求，却引入了 `.bind()`、箭头包装或类型断言

## 与架构 skill 的分工

- `purelyprofit-server-backend-architecture`：回答“代码该怎么组织、模块该怎么落”
- `purelyprofit-server-backend-pitfalls`：回答“哪些写法最容易炸、出现问题先查哪里”

先用架构 skill 决定代码落位，再用这个 pitfalls skill 检查实现细节，通常最稳。
