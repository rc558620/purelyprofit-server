/**
 * Step 8.1: SpaceSession 查询时 include items 和 renewRecords 的标准片段
 * 所有需要读取 session items/renewRecords 的查询都应使用此片段
 */
export const SPACE_SESSION_ITEMS_INCLUDE = {
  sessionItems: {
    orderBy: { sortOrder: 'asc' as const },
  },
  sessionRenewRecords: {
    orderBy: { id: 'asc' as const },
  },
} as const;

/**
 * Step 8.1: 写入 space_session_items 的数据格式
 */
export interface CreateSessionItemData {
  productId: string;
  productName: string;
  categoryName: string;
  salePrice: number;
  profit: number;
  quantity: number;
  sortOrder: number;
}

/**
 * Step 8.1: 写入 space_session_renew_records 的数据格式
 */
export interface CreateRenewRecordData {
  recordId: string;
  amount: number;
  addedMinutes: number;
  paymentMethod: string;
  grouponCode?: string | null;
  grouponPlatform?: string | null;
  note?: string | null;
  renewedAt: number;
}

/**
 * 将 SpaceSessionItemRecord[] 转换为 Prisma createMany 格式
 */
export const toSessionItemCreateData = (
  items: Array<{
    productId: string;
    productName: string;
    categoryName: string;
    salePrice: number;
    profit: number;
    quantity: number;
  }>,
  startSortOrder = 0,
): CreateSessionItemData[] =>
  items.map((item, index) => ({
    productId: item.productId,
    productName: item.productName,
    categoryName: item.categoryName,
    salePrice: item.salePrice,
    profit: item.profit,
    quantity: item.quantity,
    sortOrder: startSortOrder + index,
  }));

/**
 * 将 SpaceSessionRenewRecord 转换为 Prisma create 格式
 */
export const toRenewRecordCreateData = (record: {
  id: string;
  amount: number;
  addedMinutes: number;
  paymentMethod: string;
  grouponCode?: string;
  grouponPlatform?: string;
  note?: string;
  renewedAt: number;
}): CreateRenewRecordData => ({
  recordId: record.id,
  amount: record.amount,
  addedMinutes: record.addedMinutes,
  paymentMethod: record.paymentMethod,
  grouponCode: record.grouponCode ?? null,
  grouponPlatform: record.grouponPlatform ?? null,
  note: record.note ?? null,
  renewedAt: record.renewedAt,
});
