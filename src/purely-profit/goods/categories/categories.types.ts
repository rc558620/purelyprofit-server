export interface CategoryRecord {
  id: number;
  storeId: number;
  name: string;
  icon: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryIdRecord {
  id: number;
}

export interface CategoryListQueryInput {
  storeId: number;
  keyword?: string;
}

export interface CategoryDuplicateQueryInput {
  storeId: number;
  name: string;
  excludeId?: number;
}

export interface CategoryCreateInput {
  storeId: number;
  name: string;
  icon: string | null;
}

export interface CategoryUpdateInput {
  name?: string;
  icon?: string | null;
}

export interface CategoryRenameProductsInput {
  storeId: number;
  categoryId: number;
  name: string;
}
