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
      maxSelections: number;
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
