# 成本管理模块修复清单（环比同期口径 + 业务时区全链路）

> 涉及两个仓库：
> - 后端 `purelyprofit-server`（NestJS，模块 `src/purely-profit/operations/costs`）
> - 前端 `purelyProfit`（页面 `src/pages/main/operations/costManagement`）
>
> 命名差异：后端目录/路由为 `costs` + `cost-records`，前端为 `costManagement`。
> 接口对应：`GET /costs/dashboard`、`GET /cost-records`、`POST /cost-records`、`DELETE /cost-records/:id`、`GET /costs/report`。

---

## 执行指令（给执行者）

这是一份**已定稿的修复任务书**。请按顺序执行所有 Step，**不要自行扩大范围**。

- **工作区要求**：两个仓库都必须能访问
  - `/Users/f0rest/Mac/project/React/purelyprofit-server`（后端，NestJS + Prisma + Jest）
  - `/Users/f0rest/Mac/project/React/purelyProfit`（前端，React 19 + Vite + Vitest）
- **执行方式**：每个 Step 改完立刻跑对应验证命令，全绿再进下一个 Step。
- **开工前**：先做 0.4 基线确认。

### 不要做的事（清单外一律不做）

1. 不要顺手清理死代码（`resolveCostTimeRange` / `selectFilteredCostRecords` / `getCostMonthStart` 系列 / `sumCostAmounts` / 两个未使用的 `_callerIsSubAccount` 参数）——另立项。
2. 不要处理问题 4（报表 CSV 被 `maxPageSize = 5000` 静默截断）——需改流式读库，另立项。
3. 不要重构清单未提及的文件，不要顺带改代码风格或格式化无关代码。
4. 不要改 `cost_records.amount` 的库表类型（INT 是既有设计，已在问题 2 用 DTO `@Max` 兜住）。
5. 不要改 `TrendBadge` 组件本身（通用组件，`suffix` 由调用方传入）。

### 决策依据（已确认，执行时无需再判断）

1. **环比改同期对比是正确的**。环比的数学前提是两个窗口等长；现状 `week/month/quarter` 本期是「周期至今」、上期是「完整上周期」，算出的比值不含业务信息（月初必然暴跌）。项目内 `year` 分支注释已写明「对称口径（YTD vs YTD）」，证明项目意图即同期对比，本次只是修正 `week/month/quarter` 的实现遗漏。
2. **文案必须同步加「同期」二字**。改后算法是「本月至今 vs 上月同期」；若文案仍写「较上月」，会让用户拿「上月同期」的数去对「上月全月」，产生新的语义错误。
3. **月末钳制接受**，不修（见「已知接受项」第 1 条）。
4. **采购模块同步改**（已确认）。
5. **报表中心全量统一改**（已确认），不做「只改成本报表」的局部方案。
6. **环比数值变更需预告、无需审批**（见「发版说明」）。

---

## 0. 基线与前置

### 0.1 已完成的修复（本清单不含，仅说明基线）

| # | 问题 | 状态 |
|---|---|---|
| 1 | 新增记录后不刷新列表（越界记录混入 + 分页错位） | 已修 |
| 2 | 金额缺上限校验，超过 ¥21,474,836.47 触发 DB 500 | 已修（`COST_MAX_AMOUNT_YUAN` + `@Max`） |
| 5 | 受限套餐账号 `hasFilter` 恒为 true | 已修（基线周期按 `resolveCostPeriod` 回退后比较） |
| 7 | 手建 salary/insurance/provident_fund 记录无法删除 | 已修（优先信任后端 `deletable`） |
| 8 | dashboard 趋势查询丢失 `date.lte` | 已修（补齐上界为上海当日 23:59:59.999） |

### 0.2 未处理（本清单范围外）

- 问题 4：报表 CSV 导出被 `maxPageSize = 5000` 静默截断，需改流式读库，工作量较大，单独立项。

### 0.3 开分支

```bash
cd /Users/f0rest/Mac/project/React/purelyprofit-server && git checkout -b fix/cost-compare-and-timezone
cd /Users/f0rest/Mac/project/React/purelyProfit   && git checkout -b fix/cost-compare-and-timezone
```

### 0.4 开工前基线确认（必做）

先跑一遍，确认基线全绿；若基线本身就是红的，先解决再开工。

```bash
# 后端：期望 tsc 无输出；jest 4 suites / 21 tests passed
cd /Users/f0rest/Mac/project/React/purelyprofit-server
npx tsc --noEmit
npx jest src/purely-profit/operations/costs

# 前端：期望 tsc 仅剩 src/features/qrPoster/storeLogo.api.ts(27,7) 一条预存在错误（与本次无关）
# 期望 vitest 10 files / 275 tests passed
cd /Users/f0rest/Mac/project/React/purelyProfit
npx tsc -b tsconfig.app.json tsconfig.node.json --noEmit
npx vitest run src/pages/main/operations/costManagement
```

若数字对不上，说明基线已被改动，先确认差异来源再继续。

---

## A 组：环比改为「同期对比」

### 背景

当前 `buildPreviousCostReportRange` 内部存在多种口径，且 `week/month/quarter` 是错的：

| 周期 | 本期 | 上期（现状） | 是否对称 |
|---|---|---|---|
| week | 本周一 → now | 完整上周 | 否 |
| month | 本月 1 号 → now | 完整上月 | 否 |
| quarter | 本季首月 1 号 → now | 完整上季 | 否 |
| year | 本年 1 月 1 号 → now | 去年 YTD | 是（注释写明「对称口径」） |
| custom_month | 完整一天 | 完整前一天 | 是 |
| custom_range | 完整区间 | 等长紧邻前段 | 结束日为今天时不对称 |

以 10/08 14:00、日均 ¥1000 为例，现状 month 环比 = (7.6 天 x 1000) / (30 天 x 1000) - 1 = -74.7%，其中不含任何业务信息，只反映「本月才过 8 天」。

**目标口径（同期对比）**：上期终点 = 本期终点 - 一个周期长度；上期起点 = 该周期自然起点。

### Step 1 — 后端：补 import 与常量

文件：`purelyprofit-server/src/purely-profit/operations/costs/costs.domain.ts`

在 `shanghai-time.utils` 的 import 中补 `addShanghaiMonths`、`addShanghaiYears`，并在 import 之后加：

```ts
const DAY_MS = 86_400_000;
```

- [ ] 完成

### Step 2 — 后端：重写 `buildPreviousCostReportRange`

同文件，替换整个 `switch`（保留函数签名与 7 个分支）：

```ts
  switch (resolvedPeriod) {
    case 'today':
      // 本期 = [今天 00:00, now]；上期对齐为 [昨天 00:00, 昨天同一时刻]
      return {
        start: getDayStart(currentRange.start - DAY_MS),
        end: currentRange.end - DAY_MS,
        period: resolvedPeriod,
      };
    case 'custom_month':
      // 本期是完整一天，上期 = 完整前一天，天然对称
      return {
        start: getDayStart(currentRange.start - DAY_MS),
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    case 'week':
      return {
        start: currentRange.start - 7 * DAY_MS,
        end: currentRange.end - 7 * DAY_MS,
        period: resolvedPeriod,
      };
    case 'month':
      return {
        start: makeShanghaiMs(
          getShanghaiYear(currentRange.start),
          getShanghaiMonth(currentRange.start) - 1,
          1,
        ),
        // 月末钳制：3/31 -> 2/28，上期会比本期少 1~3 天，属已知接受项
        end: addShanghaiMonths(currentRange.end, -1),
        period: resolvedPeriod,
      };
    case 'quarter':
      return {
        start: makeShanghaiMs(
          getShanghaiYear(currentRange.start),
          getShanghaiMonth(currentRange.start) - 3,
          1,
        ),
        end: addShanghaiMonths(currentRange.end, -3),
        period: resolvedPeriod,
      };
    case 'year':
      // 同期口径：上期终点 = 本期终点 - 1 年（严格同时刻，比原「去年同日日末」更精确）
      return {
        start: makeShanghaiMs(getShanghaiYear(currentRange.start) - 1, 0, 1),
        end: addShanghaiYears(currentRange.end, -1),
        period: resolvedPeriod,
      };
    case 'custom_range': {
      // 结束日 >= 今天时本期会被 now 截断，上期须按相同进度取等长，否则不对称
      const effectiveEnd = Math.min(currentRange.end, Date.now());
      const duration = Math.max(effectiveEnd - currentRange.start, 0);
      return {
        start: currentRange.start - duration - 1,
        end: currentRange.start - 1,
        period: resolvedPeriod,
      };
    }
  }
```

说明：
- `stats` / `dashboard` 经 `buildPreviousCostCalendarRange` 调用本函数，自动跟随，无需额外改。
- 报表中心 `/costs/report` 也调用本函数，同样自动跟随。
- `makeShanghaiMs` 支持月/日溢出进位（`Date.UTC` 语义），`month - 1` / `month - 3` 跨年安全。

- [ ] 完成

### Step 3 — 后端：新增 `costs.domain.spec.ts`（当前无 domain 单测）

新建 `purelyprofit-server/src/purely-profit/operations/costs/costs.domain.spec.ts`，至少覆盖：

1. `month`：本期 `[10/01 00:00, 10/08 14:00]` -> 上期 `[09/01 00:00, 09/08 14:00]`
2. `week`：上期起点为「上周一」、终点为「上周同一时刻」
3. `quarter` / `year` 同上（`addShanghaiMonths` / `addShanghaiYears`）
4. `year` 且 `query.year` 为往年 -> 上期为去年全年
5. `custom_range` 且 `end` 为今天 -> 上期长度 = `min(end, now) - start`
6. 跨年边界：当前为 1 月 -> 上期起点为去年 12/01
7. 月末钳制：当前为 3/31 -> 上期终点为 2/28 同一时刻

断言建议统一写成「上期长度 ≈ 本期长度」+「上期终点 ≈ 本期终点偏移一个周期」，比写死时间戳稳。

- [ ] 完成

### Step 4 — 前端：文案改为「同期」

文件：`purelyProfit/src/pages/main/operations/costManagement/costManagement.types.ts`

`COST_PERIOD_COPY` 中改 4 处 `compareSuffix` 与 4 处 `compareFallbackText`：

```ts
  week: {
    compareSuffix: '较上周同期',
    compareFallbackText: '暂无上周同期数据',
  },
  month: {
    compareSuffix: '较上月同期',
    compareFallbackText: '暂无上月同期数据',
  },
  quarter: {
    compareSuffix: '较上季同期',
    compareFallbackText: '暂无上季同期数据',
  },
  year: {
    compareSuffix: '较去年同期',
    compareFallbackText: '暂无去年同期数据',
  },
```

`all` / `custom_month` / `custom_range` 三支保持 `'较上一统计周期'`（详见 Step 12 可选优化）。

> 文案改动不是「补偿性修饰」：改前实现是「本月至今 vs 上月全月」，文案却写「较上月」，二者本就不符。只改算法不改文案会产生新的语义错误。
> `TrendBadge` 是通用组件、`suffix` 外部传入，无需改组件本身。

- [ ] 完成

### Step 5 — 前端：同步断言文案的测试

- `purelyProfit/src/pages/main/operations/costManagement/components/CostOverviewPanel/__tests__/CostOverviewPanel.test.tsx`
- 以及 `CostOverviewPanel/components/HeroCard` 相关测试

若断言「较上月」「暂无上月数据」字面量，同步改为新文案。

- [ ] 完成

---

## B 组：业务时区全链路对齐 Asia/Shanghai

### 背景

后端所有日期桶/趋势/环比统一走 `shared/shanghai-time.utils`（UTC+8）。前端却用本地时区构造时间戳（`new Date(y, m-1, d, 0,0,0,0)`）。东八区下等价，非 +08:00 会串日。

**只改前端构造不改其它，会引入新 bug**：UTC+9 用户本地 00:30（上海 23:30）时，按「上海今天零点」构造出的时间戳大于 `Date.now()`，会被后端「日期不能晚于当前时间」拦截，导致每天前一小时无法新增记录。因此必须一次性改完下列全部位置。

### Step 6 — 前端：新建业务时区工具

新建 `purelyProfit/src/utils/shanghaiTime.ts`：

```ts
// 业务时区固定为 Asia/Shanghai（UTC+8），与后端 shared/shanghai-time.utils 保持一致。
// 所有「日历日」的构造/解析/展示都必须经由本模块，避免客户端本地时区导致串日。

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface ShanghaiDateParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
}

export const getShanghaiParts = (ts: number): ShanghaiDateParts => {
  const d = new Date(ts + SHANGHAI_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
};

export const shanghaiDayStart = (y: number, m: number, d: number): number =>
  Date.UTC(y, m - 1, d, 0, 0, 0, 0) - SHANGHAI_OFFSET_MS;

export const shanghaiDayEnd = (y: number, m: number, d: number): number =>
  Date.UTC(y, m - 1, d, 23, 59, 59, 999) - SHANGHAI_OFFSET_MS;

export const getShanghaiTodayParts = (): ShanghaiDateParts =>
  getShanghaiParts(Date.now());

export const formatShanghaiDate = (ts: number): string => {
  const { year, month, day } = getShanghaiParts(ts);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

export const formatShanghaiMonthDay = (ts: number): string => {
  const { month, day } = getShanghaiParts(ts);
  return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
};

export const parseShanghaiDateInput = (value: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return shanghaiDayStart(Number(match[1]), Number(match[2]), Number(match[3]));
};
```

- [ ] 完成

### Step 7 — 前端：改造日期构造（4 处）

**7.1** `src/pages/main/operations/costManagement/components/AddCostModal/hooks/useAddCostForm.ts`

- [ ] `getTodayValue()` -> `return formatShanghaiDate(Date.now());`
- [ ] `formatDateValue(ts)` -> `return formatShanghaiDate(ts);`
- [ ] `handleConfirm` 里 `const dateTs = new Date(date).setHours(0, 0, 0, 0);` 改为
      `const dateTs = parseShanghaiDateInput(date) ?? Date.now();`

**7.2** `src/pages/main/operations/costManagement/hooks/useCostManagement.ts`

- [ ] `getCurrentDateParts()` 改为返回 `getShanghaiTodayParts()`
- [ ] `buildCostQuery` 内三处改为：
      `params.customDate = shanghaiDayStart(extra.year, extra.month, extra.day);`
      `params.rangeStartDate = shanghaiDayStart(range.startYear, range.startMonth, range.startDay);`
      `params.rangeEndDate = shanghaiDayEnd(range.endYear, range.endMonth, range.endDay);`

**7.3** `src/pages/main/operations/costManagement/components/CostItem/components/CostItemInfo/CostItemInfo.tsx`

- [ ] 删除本地 `formatDate`，改用 `formatShanghaiMonthDay(record.date)`

**7.4** `src/pages/main/dashboard/reportCenter/reportDateUtils.ts`（漏项，必须一起改）

报表中心成本 Tab 走同一个后端 `/costs/report`，内部同样用本地时区构造（约 8 处：`getDayStart` / `getWeekStart` / `getMonthStart` / `getQuarterStart` / `getTimeRange` / `getCustomRange`）。

- [ ] 所有「本地零点 / 本地日末」替换为 `shanghaiDayStart` / `shanghaiDayEnd`
- [ ] `new Date().getFullYear()` 一类默认取值替换为 `getShanghaiTodayParts()` 对应字段
- [ ] 已确认：报表中心全部统一，不做「只改成本报表」的局部方案

> `DayPicker` 是纯数字选择器，产出纯日历日，无需改。
> `costManagement.service.cache.ts` 的缓存 key 由参数派生，自动跟随。

### Step 8 — 后端：放宽未来日期校验（关键，不改会新增 400）

文件：`purelyprofit-server/src/purely-profit/operations/costs/costs-write.service.ts`

```ts
    const recordDate = new Date(dto.date);
    // 业务时区为上海：允许填写「上海今天」的任意时刻，
    // 否则比上海早进入新一天的客户端（如 UTC+9）会被误判为未来日期而 400。
    const shanghaiTodayEnd =
      getShanghaiDayStartMs(Date.now()) + 86_400_000 - 1;
    if (recordDate.getTime() > shanghaiTodayEnd) {
      throw new BadRequestException('成本发生日期不能晚于今天');
    }
```

并补 import：`import { getShanghaiDayStartMs } from '../../../shared/shanghai-time.utils';`

- [ ] 完成

### Step 9 —（可选加固）删除后刷新列表

文件：`src/pages/main/operations/costManagement/hooks/useCostManagement.ts` 的 `deleteRecord`

在 `await deleteRecordFromStore(id);` 之后加：

```ts
      // 仅在第 1 页时重拉列表：既修正分页元信息，
      // 又避免已 loadMore 到后续页的用户被弹回第一页
      if (recordsPage <= 1) {
        void refreshRecords(query, true).catch(() => undefined);
      }
```

并把 `recordsPage` 加入该 `useCallback` 依赖数组（参考同文件已有的 `recordsPage` 订阅）。

- [ ] 完成

---

## C 组：采购管理模块同步

已确认 `buildPreviousPurchaseDateRange` 只被采购模块使用（`purchases.domain.ts:65`），无跨模块复用，同步改风险低。

### Step 10 — 采购后端 + 前端同步

**10.0 后端：补 import（不补会编译失败）**

`commerce.utils.ts` 现有 `shanghai-time.utils` 的 import 只有 6 个符号：
`formatShanghaiDayLabel` / `getShanghaiDayStartMs` / `getShanghaiMonthStartMs` / `getShanghaiQuarterStartMs` / `getShanghaiWeekStartMs` / `getShanghaiYearStartMs`。

`DAY_MS` 已在同文件第 12 行定义，无需新增。

需补充导入：`addShanghaiMonths`、`addShanghaiYears`、`makeShanghaiMs`、`getShanghaiYear`、`getShanghaiMonth`。

- [ ] 完成

**10.1 后端** `purelyprofit-server/src/purely-profit/commerce/commerce.utils.ts`

`buildPreviousPurchaseDateRange` 新增 `period` 入参，`purchases.domain.ts:65` 传入当前 period：

```ts
export function buildPreviousPurchaseDateRange(
  currentRange: { gte: Date; lte: Date } | undefined,
  period?: PurchasePeriodValue,
): { gte: Date; lte: Date } | undefined {
  if (!currentRange) return undefined;
  const start = currentRange.gte.getTime();
  const end = currentRange.lte.getTime();
  const duration = end - start;
  if (duration < 0) return undefined;

  switch (period) {
    case 'week':
      return { gte: new Date(start - 7 * DAY_MS), lte: new Date(end - 7 * DAY_MS) };
    case 'month':
      return { gte: new Date(shanghaiMonthStartOf(start, -1)), lte: new Date(addShanghaiMonths(end, -1)) };
    case 'quarter':
      return { gte: new Date(shanghaiMonthStartOf(start, -3)), lte: new Date(addShanghaiMonths(end, -3)) };
    case 'year':
      return { gte: new Date(makeShanghaiMs(getShanghaiYear(start) - 1, 0, 1)), lte: new Date(addShanghaiYears(end, -1)) };
    case 'custom_month':
      return { gte: new Date(getShanghaiDayStartMs(start - DAY_MS)), lte: new Date(start - 1) };
    case 'custom_range': {
      const effective = Math.max(Math.min(end, Date.now()) - start, 0);
      return { gte: new Date(start - effective - 1), lte: new Date(start - 1) };
    }
    default:
      // all / undefined：无周期概念，保持紧邻等长段
      return { gte: new Date(start - duration - 1), lte: new Date(start - 1) };
  }
}
```

其中 `shanghaiMonthStartOf(ts, delta)` 内联为：
`makeShanghaiMs(getShanghaiYear(ts), getShanghaiMonth(ts) + delta, 1)`

**10.2 前端** `purchaseManagement.types.ts` 的 `PURCHASE_PERIOD_COPY`

- [ ] 4 处 `compareSuffix` 改「较上周同期 / 较上月同期 / 较上季同期 / 较去年同期」

**注意**：采购有 `NEW_GROWTH_SENTINEL`（上期 = 0 显示「新增」而非百分比）。上期窗口变短后上期 = 0 概率上升，「新增」出现频率提高，属预期行为，不是回归。

---

## D 组：样本保护与文案精确化

### Step 11 —（建议）极小样本保护

问题：月初 1 号 00:30 时本期/上期都只有 30 分钟数据，上期 ¥10、本期 ¥500 会得到 +4900%，数学正确但业务误导。
`calcPercentChangeWithFallback` 只在上期 = 0 时返回 null，不防极小样本。采购有 `NEW_GROWTH_SENTINEL`，成本没有。

文件：`purelyprofit-server/src/purely-profit/operations/costs/costs-read.shared.ts`，`calculatePreviousPeriodChange` 末尾：

```ts
  // 上期样本过小（如月初刚过零点）时百分比会放大到无意义，直接不展示
  const previousYuan = Money.fromDbCents(previousAggregate._sum.amount ?? 0).toOutputYuan();
  if (previousYuan > 0 && previousYuan < MIN_COMPARABLE_PREVIOUS_YUAN) {
    return null;
  }
  return calculateCostCompareLastPeriod(total, previousYuan);
```

常量 `MIN_COMPARABLE_PREVIOUS_YUAN` 需在本文件（`costs-read.shared.ts`）顶部与其它缓存常量一起定义，或在 `costs.types.ts` 定义后导入：

```ts
/** 上期金额低于该值时百分比会被放大到无意义，直接不展示环比 */
export const MIN_COMPARABLE_PREVIOUS_YUAN = 100;
```

阈值建议 `100`，或改用「本期记录数 < 3 则不展示」。属产品偏好，可留 TODO。
若不加，月初 1–2 号会出现 +几千% 的环比。

- [ ] 完成

### Step 12 —（可选）custom_* 文案精确化

- [ ] `custom_month`：实为「较前一日」（本期完整一天 vs 完整前一天）
- [ ] `custom_range`：实为「较上一等长周期」

比现在的「较上一统计周期」更准确。优先级低，可后置。

---

## 已知接受项（写进代码注释，勿当 bug 再修）

1. **月末钳制**：`addShanghaiMonths` 会把 3/31 钳制到 2/28，因此每月 29/30/31 号时上期比本期少 1~3 天，环比略偏高（最坏约 10%）。这是 GA / Shopify 等看板的通行做法（上月同日，不存在则取月末）。
   另一种严格等长做法是「上期终点 = 上月1号 + 本期已过时长」，长度精确相等，但上期终点会跨进本月（2/01 + 30 天 = 3/03），语义更怪，故不采用。
2. **闰年**：`year` 用 `addShanghaiYears` 时 2/29 -> 2/28，差 1 天。

---

## 验证与回归（全部跑通才算闭环）

```bash
# 1) 后端类型 + 单测
cd /Users/f0rest/Mac/project/React/purelyprofit-server
npx tsc --noEmit
npx jest src/purely-profit/operations/costs

# 2) 前端类型（预期仅剩已知预存在错误 src/features/qrPoster/storeLogo.api.ts(27,7)）
cd /Users/f0rest/Mac/project/React/purelyProfit
npx tsc -b tsconfig.app.json tsconfig.node.json --noEmit

# 3) 前端成本 + 报表中心测试
npx vitest run src/pages/main/operations/costManagement src/pages/main/dashboard/reportCenter

# 4) 时区无关性验证（关键）：三个时区结果必须一致
TZ=Asia/Shanghai    npx vitest run src/pages/main/operations/costManagement
TZ=Asia/Tokyo       npx vitest run src/pages/main/operations/costManagement
TZ=America/New_York npx vitest run src/pages/main/operations/costManagement
```

第 4 步任一时区失败，说明仍有遗漏的本地构造，用此命令定位：

```bash
cd /Users/f0rest/Mac/project/React/purelyProfit
rg -n "new Date\(" src/pages/main/operations/costManagement src/pages/main/dashboard/reportCenter
```

### 手工验收（必做）

- [ ] **环比**：造数据让本月 1–8 号、上月 1–31 号均有支出；切「本月」，确认「较上月同期」不再是 -70% 级
- [ ] **环比一致性**：报表中心成本报表的环比与成本页数值严格相等（二者共用 `buildPreviousCostReportRange`）
- [ ] **跨时区新增**：DevTools -> Sensors -> 时区设为 `Asia/Tokyo`，东京时间 00:30（上海 23:30）新增「今天」的记录 -> 必须成功，且列表显示日期与所选日历日一致
- [ ] **跨时区查询**：同上时区，选中具体日期 -> 返回的就是那一天的记录
- [ ] **删除按钮**：手建 `分类=工资` 的记录 -> 删除按钮可见且删除成功；自动沉淀的工资记录（sourceType=payroll）删除按钮仍不可见
- [ ] **采购模块**：采购页环比数值与文案同步生效

### 提交粒度建议

按下面 4 个 commit 拆，便于单独回滚：

1. `A 组`（Step 1–5）：环比同期对比（后端 domain + spec + 前端文案）。**注意**：Step 2 与 Step 4 必须同一 commit，否则会出现「算法改了、文案没改」的语义错误中间态。
2. `B 组`（Step 6–8）：时区全链路。**注意**：Step 7.1 与 Step 8 必须同一 commit——只改前端构造而不放宽后端校验，会让 UTC+9 用户在每天 00:00–01:00 无法新增记录。Step 7.4（报表中心）放同一 commit。
3. `C 组`（Step 10）：采购同步（含 10.0 的 import）。
4. `D 组`（Step 9 / 11 / 12）：可选加固项，可合并也可单独。

---

## 发版说明（建议文案）

> 成本 / 采购的环比改为同期对比（本月至今 vs 上月同期），修正月初环比因窗口长度不等而严重偏低的问题。
> 成本记录日期统一按业务时区（Asia/Shanghai）解析，修复非东八区客户端查询/新增时日期串一天的问题。

不需要走口径审批（`year` 分支注释已证明项目意图为对称口径，本次是修正实现缺陷），但需要预告：数字会整体变化、月初变化幅度大，UI 文案也会多出「同期」二字。

---

## 回滚

```bash
cd /Users/f0rest/Mac/project/React/purelyprofit-server && git checkout - && git branch -D fix/cost-compare-and-timezone
cd /Users/f0rest/Mac/project/React/purelyProfit   && git checkout - && git branch -D fix/cost-compare-and-timezone
```

---

## 附录：问题 7（删除按钮）关联影响核查结论

| 关联点 | 结论 |
|---|---|
| 复用面 | `CostItem` 仅被 `CostRecordList` 使用，无其他页面复用（`businessAnalysis` 里的 `makeCostItem` 是同名测试数据，无关） |
| 权限链路 | 未变。`canDelete` 仍来自 `costManagement.tsx` 的 `canDeleteCostRecord`（主账号 or `cost:delete`，且排除店长/财务角色） |
| 后端一致性 | 一致。`deleteRecord` 只拦 `sourceType !== 'manual'`；手建记录 sourceType 恒为 `manual`，故 UI 显示后删除必定成功 |
| 降级安全 | 安全。`deletable` 缺失时回落分类兜底，保守隐藏，不会误放出删除按钮 |
| 分类可选性 | 已确认 `CATEGORY_OPTIONS` 由 `COST_CATEGORY_CONFIG` 全量生成，含 salary/insurance/provident_fund，「手建工资」是真实可达场景 |
| 缓存一致性 | 正常。写操作后 `invalidateCostManagementCache()` 清空 service 缓存；账号切换有 `resetCostManagementStore` |

**唯一遗留问题**：删除成功后只做内存移除 + 刷 dashboard，不重拉列表，`recordsTotal - 1` 但分页数据未刷新，翻页后可能错位（与新增修复前同类问题、方向相反）。加固方式见 Step 9。
