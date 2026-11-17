import type { Prisma } from '@prisma/client';
import type { GetPulseAdminMemberLogsQueryDto } from './dto/pulse-membership-admin-logs.request.dto';

/**
 * 管理端会员流水（积分 / 纯利豆）的查询条件构造。
 *
 * 抽离为纯函数：只吃 DTO 与权限范围内的门店集合，便于与列表 / 统计共用同一份
 * 口径，也避免 service 被大量 where 拼装淹没。
 */
export type AdminMemberLogsCursor = { createdAt: Date; id: number };

/** 游标条件的结构：积分与纯利豆两张流水表的 where 都能吃下这一段。 */
interface AdminMemberLogsCursorWhere {
  OR: Array<
    { createdAt: { lt: Date } } | { createdAt: Date; id: { lt: number } }
  >;
}

/** 游标条件：同时间戳时按 id 二次排序，保证翻页不重不漏。 */
function buildCursorWhere(
  cursor: AdminMemberLogsCursor,
): AdminMemberLogsCursorWhere {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * 积分 Tab 语义转换。
 *
 * 边界必须与 `buildPulseAdminPointsLogItem` 的 type 推导逐条对齐：
 * type = source==='expire' ? 'expire' : changeType==='increase' ? 'earn' : 'spend'。
 * 于是「获得」= 非过期来源且 increase，「消耗」= 过期来源或 decrease ——
 * 两个 Tab 都排除管理员调整（管理员调整在 memberPoints 页单独成 Tab）。
 */
function buildPointsTabWhere(
  pointsTab: GetPulseAdminMemberLogsQueryDto['pointsTab'],
): Prisma.StoreMembershipPointsLogWhereInput {
  switch (pointsTab) {
    case 'admin':
      return { source: 'admin_adjust' };
    case 'earn':
      return {
        source: { notIn: ['admin_adjust', 'expire'] },
        changeType: 'increase',
      };
    case 'spend':
      return {
        source: { not: 'admin_adjust' },
        OR: [{ source: 'expire' }, { changeType: 'decrease' }],
      };
    case 'all':
    default:
      return {};
  }
}

/**
 * 积分关键词：流水说明 + 门店 / 会员身份字段，覆盖前端搜索框的三种意图。
 *
 * 必须带上 owner.email：展示手机号 `resolveAdminMemberPhone` 的最后一级兜底是
 * 从占位邮箱 `phone_13619654020@purelyprofit.local` 里解析出手机号，
 * 只搜 contactPhone / wechatPhone 会让这批用户「看得见手机号却搜不到」。
 */
function buildPointsKeywordConditions(
  keyword: string,
): Prisma.StoreMembershipPointsLogWhereInput[] {
  return [
    { description: { contains: keyword } },
    { store: { name: { contains: keyword } } },
    { store: { contactPhone: { contains: keyword } } },
    { store: { owner: { realName: { contains: keyword } } } },
    { store: { owner: { name: { contains: keyword } } } },
    { store: { owner: { wechatPhone: { contains: keyword } } } },
    { store: { owner: { email: { contains: keyword } } } },
  ];
}

/**
 * Tab 语义转换。
 *
 * 「获得」「消耗/提现」两个 Tab 都要排除管理员调整（管理员调整在 partnerBeans 页单独成 Tab）。
 * 边界必须与 `buildPulseAdminBeanLogItem` 的 type 推导完全对齐：
 * type = source==='withdrawal' ? 'withdraw' : changeAmount > 0 ? 'earn' : 'spend'。
 * 也即在「提现恒为 withdraw」的前提下，earn=金额>0、spend=金额<=0 ——
 * 若 earn 用 >=0、spend 用 <0，金额恰好为 0 的流水会在两个 Tab 里都查不到。
 */
function buildBeanTabWhere(
  beanTab: GetPulseAdminMemberLogsQueryDto['beanTab'],
): Prisma.StorePartnerBeanLogWhereInput {
  switch (beanTab) {
    case 'admin':
      return { source: 'admin_adjust' };
    case 'earn':
      return {
        source: { notIn: ['admin_adjust', 'withdrawal'] },
        changeAmount: { gt: 0 },
      };
    case 'spend':
      return {
        source: { not: 'admin_adjust' },
        OR: [{ source: 'withdrawal' }, { changeAmount: { lte: 0 } }],
      };
    case 'all':
    default:
      return {};
  }
}

/**
 * 关键词：流水说明 + 门店 / 合伙人身份字段，覆盖前端搜索框的三种意图。
 *
 * 必须带上 owner.email：展示手机号 `resolveAdminMemberPhone` 的最后一级兜底是
 * 从占位邮箱 `phone_13619654020@purelyprofit.local` 里解析出手机号，
 * 只搜 contactPhone / wechatPhone 会让这批用户「看得见手机号却搜不到」。
 */
function buildBeanKeywordConditions(
  keyword: string,
): Prisma.StorePartnerBeanLogWhereInput[] {
  return [
    { description: { contains: keyword } },
    { store: { name: { contains: keyword } } },
    { store: { contactPhone: { contains: keyword } } },
    { store: { owner: { realName: { contains: keyword } } } },
    { store: { owner: { name: { contains: keyword } } } },
    { store: { owner: { wechatPhone: { contains: keyword } } } },
    { store: { owner: { email: { contains: keyword } } } },
  ];
}

/**
 * 构造纯利豆流水的查询条件。
 *
 * Tab 与关键词过滤和统计查询共用同一份条件，避免出现「列表被筛过、统计没筛过」的口径错位。
 *
 * 各条件统一走 AND 组合：Tab（尤其是「消耗/提现」）与关键词都会用到 OR，
 * 平铺展开会让后一个 OR 覆盖前一个，条件被静默丢弃。
 */
export function buildBeanLogsWhere(
  query: GetPulseAdminMemberLogsQueryDto,
  storeIds: number[],
  cursor: AdminMemberLogsCursor | undefined | null,
): Prisma.StorePartnerBeanLogWhereInput {
  const andConditions: Prisma.StorePartnerBeanLogWhereInput[] = [];
  const tabWhere = buildBeanTabWhere(query.beanTab);

  if (Object.keys(tabWhere).length > 0) {
    andConditions.push(tabWhere);
  }

  if (query.keyword) {
    andConditions.push({ OR: buildBeanKeywordConditions(query.keyword) });
  }

  // 单合伙人（门店）过滤：与权限范围 storeId: { in: storeIds } 取交集，
  // 传了无权门店的 ID 只会得到空结果，不会越权
  if (query.storeId !== undefined) {
    andConditions.push({ storeId: query.storeId });
  }

  if (cursor) {
    andConditions.push(buildCursorWhere(cursor));
  }

  return {
    storeId: { in: storeIds },
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  };
}

/**
 * 构造积分流水的查询条件：与纯利豆同构，Tab / 关键词 / 游标统一走 AND 组合。
 *
 * 平铺展开会让后一个 OR 覆盖前一个（「消耗」Tab 自带 OR、关键词也是 OR），
 * 条件被静默丢弃后前端会看到「筛选没生效」。
 */
export function buildPointsLogsWhere(
  query: GetPulseAdminMemberLogsQueryDto,
  storeIds: number[],
  cursor: AdminMemberLogsCursor | undefined | null,
): Prisma.StoreMembershipPointsLogWhereInput {
  const andConditions: Prisma.StoreMembershipPointsLogWhereInput[] = [];
  const tabWhere = buildPointsTabWhere(query.pointsTab);

  if (Object.keys(tabWhere).length > 0) {
    andConditions.push(tabWhere);
  }

  if (query.keyword) {
    andConditions.push({ OR: buildPointsKeywordConditions(query.keyword) });
  }

  // 与纯利豆同口径：单合伙人（门店）过滤在积分流水里同样生效
  if (query.storeId !== undefined) {
    andConditions.push({ storeId: query.storeId });
  }

  if (cursor) {
    andConditions.push(buildCursorWhere(cursor));
  }

  return {
    storeId: { in: storeIds },
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  };
}
