---
name: purelyprofit-server-backend-pitfalls
description: Captures recurring backend implementation pitfalls in purelyprofit-server, especially TypeScript typing, DTO boundaries, raw SQL row mapping, Prisma transaction return shapes, pagination assembly, dual product-line semantics, membership plan config vs runtime profile modeling, and ESLint no-unsafe/no-unnecessary-type-assertion issues. Use when fixing strange lint errors, refactoring service-layer types, mapping raw query results, adjusting membership settings or access rules, or wanting to avoid repeated backend mistakes in this repository.
---

# purelyprofit-server 后端踩坑记录

## 什么时候用这个 skill

遇到下面场景时优先使用：

- 修 `@typescript-eslint/no-unsafe-*`、`no-unnecessary-type-assertion`、`unbound-method`
- service 里出现 `error typed`、`unsafe member access`、`unsafe assignment`
- DTO、raw SQL row、response DTO 之间类型开始互相污染
- Prisma 事务返回值、`Promise.all()` 解构后类型不稳定
- 需要同时处理 `purely-profit` 与 `purely-pulse` 的产品语义边界
- 要改 Pulse 会员套餐配置、会员权益限制、永久会员语义
- 想在动手前先避开这个仓库里已经踩过的坑

## 核心原则

- controller 入参边界和 service 内部消费类型分开
- 数据库行类型、业务输入类型、响应 DTO 类型分层建模
- 先修“源头类型污染”，不要在末端到处补 `as`
- 已有泛型时先信泛型，避免重复断言
- 返回值组装优先稳定、可读、局部显式，而不是追求一次性花式推导
- 先分清产品视角，再谈字段对齐；语义错了，类型再干净也没用

## 高风险信号

看到这些现象时，优先怀疑是上游类型或产品语义已经坏了：

- 一个字段开始同时报 `no-unsafe-argument`、`no-unsafe-member-access`、`no-unsafe-assignment`
- 某个 DTO 字段明明写了类型，进入 service 后却被推成 `error typed`
- `$queryRaw<Foo[]>()` 已写泛型，后面还想继续补 `as Foo[]`
- `Promise.all()`、事务元组解构后，每个元素都开始报 unsafe
- `purely-pulse` controller/Swagger 写着“开发者看目标商家”，service 却默认绑当前商家自己
- 改了一个类型断言或文案，lint/语义问题反而越修越多

## 排查顺序

按这个顺序查，通常返工最少：

1. 先查当前接口到底属于 `purely-profit` 还是 `purely-pulse`
2. 再查是不是把 `membership_plan_settings` 配置层和 `storeMembershipProfile` 运行态混用了
3. 再查 controller 传入 service 的类型边界是不是过重依赖 DTO class
4. 再查 SQL row / Prisma 返回值是不是缺少本地明确类型
5. 再查事务返回值和 `Promise.all()` 是否用了不稳定的数组元组解构
6. 最后才处理 mapper 和 response 组装

## 产品视角相关坑

### 坑 1：页面联调时只记得前端是 `purelyProfit`，却忘了先分清后端产品线

症状：

- 用户说“检查页面”“页面联调”“page-check”时，直接把整条链路默认为同一套老板端后端语义
- 虽然前端页面确实来自 `purelyProfit`，但后端实现到底落在 `src/purely-profit/*` 还是 `src/purely-pulse/*` 没有先判清
- 联调时只看页面字段和接口返回，不核对 controller / DTO / service / 数据库查询所对应的产品视角
- 最终出现前端页面是对的，但后端接口把“商家看自己”和“开发者看商家”两套语义混写

推荐写法：

- 页面联调默认先把前端项目理解为 `purelyProfit`，但不要据此跳过后端产品线判断
- 联调开始时先明确：当前后端链路属于 `purely-profit` 还是 `purely-pulse`
- 检查范围必须同时覆盖前端页面/路由/请求层/types/form schema，与后端 controller / DTO / service / 数据库实现
- 只有前后端字段、状态流转和产品视角三者都对齐，才算真正联调通过

### 坑 2：把 `purely-pulse` 当 `purely-profit` 来写

症状：

- `pulse/*` controller、Swagger、DTO 描述里开始出现“老板端首页”“我的会员中心”“当前老板”“个人端状态”这类语义
- service 默认直接用 `user.id`、`ownerId = user.id`、`currentMembership.storeId` 去定位业务对象
- 当前登录开发者账号既被当成操作人，又被当成被查看的商家本人
- 接口虽然能跑，但产品语义已经从“开发者看商家”跑成“商家看自己”

推荐写法：

- 先拆清楚“操作人”和“目标商家/门店/区域”，不要让两种身份共用一套语义
- `purely-pulse` 默认优先按显式目标对象建模，例如 `targetStoreId`、`merchantId`、`region`
- 如果只是开发者专属 mock / 测试模式，要在命名、Swagger、注释里显式标明，不要让特殊模式反向定义正常接口语义
- 修这类问题时，先改接口视角和查询条件，再处理 DTO / mapper / lint；不要只改文案不改查询

### 坑 3：把 `purely-profit` 的自助老板端 service 直接代理到 `purely-pulse`

症状：

- `pulse` service 里大量出现 `return xxxPurelyProfitService.getXxx(user)` 这种直接转发
- 复用后字段结构看起来能对上，但查询条件仍然默认绑定“当前商家自己”
- Swagger、DTO、错误文案开始跟着出现“我的门店”“当前账号未绑定门店”“仅老板可查看”这类表达
- 表面像是“少写代码”，实际把 `purely-pulse` 的产品边界整个拖偏

推荐写法：

- 可以复用聚合函数、mapper、底层查询片段，但不要直接复用“当前商家态”的 service 入口
- 如果确实要复用现有能力，优先下沉成接收显式 `storeId` / `merchantId` 的纯业务函数，再由 `purely-pulse` 自己组装入口语义
- `dev-mode`、mock 数据、老板模拟视角只能作为特例分支，不能决定主链路的默认查询模型
- 判断是否跑偏时，优先看 service 的目标对象解析逻辑，而不是只看返回字段名字像不像

### 坑 4：把老板端“当前门店”与 Pulse “目标门店”混成同一个字段语义

症状：

- `currentStoreId` 在老板端和 Pulse 里被混当成同一概念复用
- 老板端语义是“当前登录人可操作的门店”，Pulse 语义却应该是“当前被观察的目标门店”
- 切换 Pulse 目标门店后，返回值、缓存 key、查询条件、错误文案仍然沿用老板端“当前门店”表达
- 代码短期可跑，长期会让 session、dashboard、membership、growth 全链路混乱

推荐写法：

- 老板端优先使用 `resolveViewStoreId` / `resolveSingleStoreId` 这类访问能力解析
- Pulse 观察态优先使用 `pulse-store-context.service.ts` 或显式 `targetStoreId` 语义
- 命名、Swagger、错误文案里明确写清“目标门店”“观察对象”，不要继续沿用模糊的“当前门店”
- 需要跨产品线复用时，复用底层查询函数，不复用入口语义

## 会员体系相关坑

### 坑 16：把 `membership_plan_settings` 当成门店运行态会员档案

症状：

- 在老板端功能开关、商品/员工/空间配额判断里，直接读取 `membership_plan_settings` 就想决定当前门店是否可用
- 改了 Pulse 套餐配置表后，预期所有商家运行态权限立即跟着自动切换，却没有同步检查 `storeMembershipProfile`、订单、积分/纯利豆等数据
- `src/purely-pulse/membership-settings/*` 被当成老板端自助购买或门店实时会员状态接口使用
- 新增权益时在多个 service 各写一套 `if (planId === ...)`，没有统一回到访问控制层

推荐写法：

- `membership_plan_settings` 只负责平台套餐配置，适合维护价格、默认时长、永久会员默认有效期
- 门店当前处于什么会员状态，优先看 `storeMembershipProfile`、会员订单、积分日志、纯利豆日志等运行态数据
- 老板端功能准入、历史数据窗口、配额控制优先统一收口到 `PlatformMembershipAccessService`
- 要新增会员权益时，先判断是“改配置表”“改运行态档案”“改访问控制逻辑”中的哪一层，不要三层语义混在一起

### 坑 17：把 `lifetime` 直接写进 `StoreMembershipProfile.currentPlanId`

症状：

- 看到 `MembershipPlanSettingId` 里有 `lifetime`，就直接想把运行态 `currentPlanId` 也设成 `lifetime`
- Prisma schema、DTO、service 对 `currentPlanId` 的联合类型开始互相打架，因为 `MembershipPlanCycle` 当前只有 `monthly`、`quarterly`、`yearly`
- Pulse session / onboarding / membership 这类模块查询运行态档案时，字段值和既有解析逻辑对不上
- 只改了一个字段值，却没有同时调整到期时间解析、权益判断和展示层文案

推荐写法：

- 先区分配置层与运行态：配置层可以有 `lifetime`，运行态档案仍要遵守 `MembershipPlanCycle`
- 需要表达永久会员时，优先沿用现有中心化解析逻辑，不要在 controller / DTO / 单个 service 私自扩出一套第四个运行态枚举
- 如果未来真的要让运行态直接支持 `lifetime`，必须连带修改 Prisma enum、DTO、session/onboarding/membership/service mapper 与访问控制逻辑，而不是只改一个字段
- 当前仓库里涉及永久会员判断时，先检索 `PlatformMembershipAccessService` 和 `storeMembershipProfile` 相关实现，再决定怎么改

## DTO 相关坑

### 坑 5：把 decorated DTO 直接当 service 内部长生命周期类型

症状：

- `query.storeId`、`query.type`、`dto.userId` 开始报 unsafe
- `Dto['field']` 索引访问类型也一起变脏
- DTO 一旦带有 `ValidateIf`、Swagger 装饰器、复杂联合字段，污染会沿着整个 service 私有方法继续传播

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

### 坑 6：用 `Dto['type']`、`Dto['source']` 到处传播类型

症状：

- 上游 DTO 一脏，下游所有索引访问类型一起脏
- 一个字段同时污染 query builder、mapper、response 组装
- 改 DTO 校验规则后，service 与 mapper 的类型稳定性一起受影响

推荐写法：

- service 私有方法的参数直接写本地联合类型或本地 interface
- 不要为了“复用一点类型”把整个类型链绑死在 DTO 上

### 坑 7：把共享枚举常量和联合类型绑在 decorated DTO 文件里

症状：

- mapper / utils 明明只 import 了 `const` 或 `type`，却开始报 `error typed`
- `MEMBER_LEVEL_VALUES.includes(...)` 这类普通调用突然报 `unsafe call`、`unsafe member access`
- response 对象里某个字段只是赋值给联合类型，lint 却报 `unsafe assignment`
- 同一个 DTO 文件里既有 `class-validator` / Swagger 装饰器 class，又导出了给 service / mapper 复用的常量与 type

推荐写法：

- 共享的枚举常量、联合类型、纯转换函数，优先放到不含装饰器的 `*.utils.ts` / `*.types.ts` / `constants.ts`
- DTO 文件只负责 controller 边界 class；如果前端/其他模块还从 DTO 文件取类型，可以在 DTO 文件里做 re-export
- mapper / service 优先依赖“纯类型模块”，不要直接把 decorated DTO 文件当共享类型中心
- 如果只是想给 Swagger DTO 复用枚举值，就从纯模块 import 进 DTO，而不是反过来让业务层从 DTO 取

## raw SQL / Prisma 相关坑

### 坑 8：raw SQL 行类型不本地化

症状：

- `$queryRaw()` 返回结果和 response DTO 混在一起
- mapper、service、事务返回值互相污染
- 一条 SQL 同时服务列表、详情、统计，后续越改越难收窄字段

推荐写法：

- 每条 raw SQL 的结果优先定义本地 row interface
- row interface 只描述数据库查询结果，不要混入 response DTO 语义
- 真正对外返回时，再走 mapper 或局部显式响应组装

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

### 坑 9：已经有泛型还继续补同形态断言

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

### 坑 10：事务里直接返回数组元组，解构后类型漂移

症状：

- `const [member, log] = ...` 后 `log` 突然变成 error typed
- 后续 mapper / response 组装全部开始 unsafe
- 一个事务同时做创建、聚合、日志落库时最容易出现这类问题

推荐写法：

- 优先返回命名对象：`return { member, log }`
- 命名对象比裸元组更稳，也更容易局部收窄字段类型

示意：

```ts
const result: { member: MemberRecord; log: BeanLogRecord } =
  await this.prisma.$transaction(async (transaction) => {
    return {
      member: this.requireMemberRow(memberRows[0]),
      log: this.requireBeanLogRow(logRows[0]),
    };
  });
```

### 坑 11：一边解构 `Promise.all()` 一边直接复杂 map

症状：

- `[items, countRows]` 解构时报 unsafe destructuring
- `items.map(...)` 的返回又继续 unsafe
- 分页场景一边查列表一边查总数时最容易放大问题

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

### 坑 12：response DTO、mapper、row type 三层混用

症状：

- mapper 明明能用，但一调用就 unsafe
- response 对象局部字段总是被判不安全
- row type 为了省事直接复用了 response DTO，导致查询层和接口层边界粘在一起

推荐写法：

- 正常情况优先复用 mapper
- 如果 lint 在这条链路失真，可以在当前 service 做一层局部显式映射
- 但必须保证字段名、枚举值、可选字段、时间字段和 DTO 完全对齐
- 修 lint 时不要顺手改接口语义

### 坑 13：末端狂补断言掩盖源头问题

反模式：

- `as AdjustMemberBeansResponseDto`
- `as Foo[]`
- `as unknown as ...`

推荐：

- 先找 DTO 边界是不是污染了 service
- 再找 row type 是不是缺失/混用
- 再找当前接口的产品语义是不是先天就错了
- 只有确认推断就是不稳定，才做最小范围显式标注

## 方法引用 / this 绑定相关坑

### 坑 14：把实例方法拆出来再调用，触发 `unbound-method`

症状：

- `const resolver = service.someMethod as (...) => ...` 一类写法开始同时报 `unbound-method`
- 为了压住 `this` 绑定问题，顺手补了一个函数类型断言，结果又触发 `no-unnecessary-type-assertion`
- 这个方法本身其实不需要单独拿出来传递，只是本地包了一层转发

推荐写法：

- 能直接通过对象调用，就直接 `return service.someMethod(...)`
- 如果后续确实要把方法作为回调传递，再考虑箭头函数、`.bind()` 或显式 `this: void`
- 不要为了“先存到局部变量再调用”去拆实例方法引用
- 如果方法签名本来就能正确推断，先删掉多余断言，再看 lint 是否自然消失

## 命名与路径迁移相关坑

### 坑 15：skill、注释、案例路径还停留在旧目录，导致后续搜索和套用模板全偏

症状：

- 文档、skill、提示词里还写 `src/auth/*`、`src/member/*`、`src/operations/*` 顶层旧路径
- 实际代码已经迁到 `src/purely-profit/*`、`src/purely-pulse/*`
- 新任务一开始就按旧路径搜索，后续定位 controller / service / DTO 全部低效甚至误判
- 人以为是在“复用旧经验”，实际上是在把旧目录结构强行套到新仓库上

推荐写法：

- 搜索、示例、skill、重构建议统一以新路径为准
- 老板端能力统一优先查 `src/purely-profit/*`
- Pulse 能力统一优先查 `src/purely-pulse/*`
- 如果必须提旧路径，只能作为迁移背景说明，不能再当当前事实基线

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
- 这里是不是把老板端和 Pulse 的产品视角写混了
- 这里是不是应该先拆中间变量再 map

如果前四项有一项答案是“是”，先修结构，不要先补断言。

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

### 场景 F：Pulse 接口字段都对，但语义还是不对

- 先看当前 service 是否默认绑定当前登录人自己的门店
- 再看目标对象解析是不是应该交给 `pulse-store-context.service.ts`
- 再看 Swagger、DTO、错误文案是不是仍沿用老板端表达
- 最后才调整 mapper / response 字段名

## 真实案例索引

### 案例 1：`src/purely-profit/member/members/members-points.service.ts`

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

- 坑 5：把 decorated DTO 直接当 service 内部长生命周期类型
- 坑 6：用 `Dto['type']`、`Dto['source']` 到处传播类型
- 坑 9：已经有泛型还继续补同形态断言
- 坑 10：事务里直接返回数组元组，解构后类型漂移
- 坑 11：一边解构 `Promise.all()` 一边直接复杂 map
- 坑 13：末端狂补断言掩盖源头问题

以后再遇到下面现象，优先回看这个案例：

- 一个 service 同时出现 `no-unsafe-*` 和 `no-unnecessary-type-assertion`
- query DTO 进入 service 后字段类型突然变脏
- raw SQL 查询、mapper、response DTO 三层连锁报错
- 调整一个 `as` 以后，lint 报错数量反而增加

### 案例 2：`src/purely-profit/member/members/members.mapper.ts`

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

- 坑 7：把共享枚举常量和联合类型绑在 decorated DTO 文件里
- 坑 12：response DTO、mapper、row type 三层混用
- 坑 13：末端狂补断言掩盖源头问题

以后再遇到下面现象，优先回看这个案例：

- mapper / utils 只 import 了 DTO 文件里的 `const` / `type`，却开始报 `error typed`
- `includes`、普通字段赋值、简单返回对象一起变成 `unsafe`
- 看起来像 mapper 写坏了，实际是共享类型定义放错层了
- 想在 mapper 里补 `as MemberLevelValue`、`as Foo` 才能过 lint

### 案例 3：`src/purely-profit/member/members/members.service.ts`

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

- 坑 9：已经有泛型还继续补同形态断言
- 坑 13：末端狂补断言掩盖源头问题
- 坑 14：把实例方法拆出来再调用，触发 `unbound-method`

以后再遇到下面现象，优先回看这个案例：

- 某个 service 私有方法只是转发，却先把另一个 service 的方法拆出来调用
- 一个位置同时出现 `unbound-method` 和 `no-unnecessary-type-assertion`
- 为了消除 `this` 报错，开始给方法引用补显式函数类型
- 其实没有回调传递需求，却引入了 `.bind()`、箭头包装或类型断言

### 案例 4：`src/purely-pulse/session/session.controller.ts` + `src/purely-pulse/session/session.service.ts`

检索关键词：

- `Pulse / Session`
- `target store`
- `current-store`
- `bootstrap`
- `开发者查看目标商家`
- `pulse-store-context`

问题画像：

- Session 首屏接口字段很多都能复用老板端数据结构，于是很容易把“当前登录人”和“当前观察目标门店”写成同一对象
- 切换目标门店接口如果直接套老板端“当前门店”写法，短期能跑，长期会让 dashboard / membership / growth 全部沿用错误语义
- Swagger 文案如果不强调观察态，很快就会有后续模块跟着误用

最终修法：

- 在 controller 注释、Swagger、DTO 命名里明确写“目标门店”“观察对象”
- 目标门店上下文统一交给 `pulse-store-context.service.ts` 一类能力维护
- 登录开发者摘要与目标门店摘要分开建模
- 复用底层聚合查询，但不复用老板端自助入口语义

这次案例对应的坑位：

- 坑 2：把 `purely-pulse` 当 `purely-profit` 来写
- 坑 3：把 `purely-profit` 的自助老板端 service 直接代理到 `purely-pulse`
- 坑 4：把老板端“当前门店”与 Pulse “目标门店”混成同一个字段语义

以后再遇到下面现象，优先回看这个案例：

- Pulse controller 文案和 DTO 字段都开始往老板端语义漂移
- 切换目标对象的接口仍沿用“当前门店”老表达
- 需求明明是“开发者观察商家”，实现却默认按商家本人处理

## 与架构 skill 的分工

- `purelyprofit-server-backend-architecture`：回答“代码该怎么组织、模块该怎么落、当前产品线语义是什么”
- `purelyprofit-server-backend-pitfalls`：回答“哪些写法最容易炸、出现问题先查哪里、哪些语义最容易写偏”

先用架构 skill 决定代码落位，再用这个 pitfalls skill 检查实现细节，通常最稳。
