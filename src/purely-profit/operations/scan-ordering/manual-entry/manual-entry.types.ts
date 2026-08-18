// 录入订单（手工补录）响应类型定义：菜单聚合、价格预览与建单结果（金额统一后端计算并以元输出）

/** 录入订单规格选项（对齐前端 ManualEntrySpecOption 语义） */
export interface ManualEntrySpecOptionResponse {
  /** 选项 ID */
  id: number;
  /** 选项名称 */
  name: string;
  /** 相对商品基础价的差额（元；正为加价，负为减价） */
  extraPrice: number;
  /** 是否默认选中 */
  isDefault: boolean;
}

/** 录入订单规格组（对齐前端 ManualEntrySpecGroup 语义） */
export interface ManualEntrySpecGroupResponse {
  /** 规格组 ID */
  id: number;
  /** 规格组名称 */
  name: string;
  /** 选择模式：single 单选 / multiple 多选 */
  selectionType: 'single' | 'multiple';
  /** 最少必选数量 */
  minSelections: number;
  /** 最多可选数量（null 表示不限） */
  maxSelections: number | null;
  /** 该组下所有在售选项（按 sortOrder 排序） */
  options: ManualEntrySpecOptionResponse[];
}

/** 录入订单菜单商品（对齐前端 ManualEntryProduct 语义） */
export interface ManualEntryProductResponse {
  /** 菜单商品 ID */
  id: number;
  /** 商品名称 */
  name: string;
  /** 商品描述 */
  description: string | null;
  /** 基础售价（元） */
  basePrice: number;
  /** 封面图 URL（null 表示无图） */
  imageUrl: string | null;
  /** 可用库存（总库存 − 未接单预留；null 表示不限量） */
  stockQuantity: number | null;
  /** 是否售罄（售罄商品不可加入草稿） */
  soldOut: boolean;
  /** 规格组列表（空数组表示无规格商品） */
  specGroups: ManualEntrySpecGroupResponse[];
}

/** 录入订单菜单分类（对齐前端 ManualEntryCategory 语义） */
export interface ManualEntryCategoryResponse {
  /** 分类 ID */
  id: number;
  /** 分类名称 */
  name: string;
  /** 该分类下在售商品（按 sortOrder 排序） */
  products: ManualEntryProductResponse[];
}

/** 录入订单菜单聚合响应 */
export interface ManualEntryMenuResponse {
  /** 分类列表（按 sortOrder 排序） */
  categories: ManualEntryCategoryResponse[];
}

/** 价格预览行（每行对应一组商品 + 规格组合） */
export interface ManualEntryPreviewItem {
  /** 菜单商品 ID */
  productId: number;
  /** 商品名称快照 */
  productName: string;
  /** 规格名称快照（升序，无规格为空数组） */
  specNames: string[];
  /** 规格组合单价（元；基础价 + 规格加价合计，后端权威计算） */
  unitPrice: number;
  /** 数量 */
  quantity: number;
  /** 行小计（元；单价 × 数量） */
  lineTotal: number;
}

/** 价格预览响应（金额全部由后端计算，前端只读展示） */
export interface ManualEntryPreviewResponse {
  /** 定价行明细 */
  items: ManualEntryPreviewItem[];
  /** 商品合计（元） */
  itemsTotal: number;
  /** 优惠金额（元；平台结算券面抵扣，封顶不找零） */
  discountAmount: number;
  /** 应付金额（元） */
  payableAmount: number;
}

/** 建单成功响应 */
export interface ManualEntryOrderCreatedResponse {
  /** 销售记录 ID */
  orderId: number;
  /** 订单号（手工补录号段 #M-YYYYMMDD-NNN） */
  orderNo: string;
  /** 应付金额（元） */
  payableAmount: number;
  /** 创建时间戳（毫秒） */
  createdAt: number;
}
