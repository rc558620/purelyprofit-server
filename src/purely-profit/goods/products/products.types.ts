import type { ProductSortValue } from '../../commerce/commerce.utils';

export interface ProductListQueryInput {
  storeId?: number;
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  categoryId?: number;
  isActive?: boolean;
  sortBy?: ProductSortValue;
}

export interface ProductCategoryRecord {
  id: number;
}

export interface ProductStoreRecord {
  id: number;
  storeId: number;
}

/**
 * 写路径前置校验所需的商品标量快照（不含规格关系）。
 *
 * update 与扫码点餐上下架只需要这些标量；列表/详情/编辑响应仍使用
 * 带三层规格的 ProductRecord，避免写路径无谓拉取规格组与选项。
 */
export interface ProductScalarRecord {
  id: number;
  storeId: number;
  name: string;
  category: string;
  code: string;
  price: number;
  costPrice: number | null;
  image: string | null;
}

export interface ProductRecord {
  id: number;
  storeId: number;
  name: string;
  category: string;
  code: string;
  price: number;
  profit: number;
  costPrice: number | null;
  unit: string;
  stock: number;
  alertThreshold: number;
  image: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  scanOrderingMenuProducts?: {
    id: number;
    isActive: boolean;
    deletedAt: Date | null;
    specGroups: Array<{
      id: number;
      name: string;
      selectionType: 'single' | 'multiple';
      minSelections: number;
      maxSelections: number | null;
      sortOrder: number;
      options: Array<{
        id: number;
        name: string;
        extraPrice: number;
        isDefault: boolean;
        isActive: boolean;
      }>;
    }>;
  }[];
}

export interface ProductPageResult {
  items: ProductRecord[];
  total: number;
}

export interface ProductCreateInput {
  storeId: number;
  categoryId: number | null;
  category: string;
  code: string;
  name: string;
  price: number;
  profit: number;
  costPrice: number | null;
  unit: string;
  stock: number;
  alertThreshold: number;
  image: string | null;
  description: string | null;
}

export interface ProductUpdateInput {
  name?: string;
  category?: string;
  categoryId?: number | null;
  code?: string;
  price?: number;
  profit?: number;
  costPrice?: number | null;
  unit?: string;
  stock?: number;
  alertThreshold?: number;
  image?: string | null;
  description?: string | null;
  isActive?: boolean;
}
