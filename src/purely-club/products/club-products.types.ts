export const CLUB_HOT_PRODUCT_COUNT = 3;
export const CLUB_FEATURED_PRODUCT_LIMIT = 6;
export const CLUB_PRODUCT_NOT_FOUND_MESSAGE = '当前门店下找不到该服务商品';

export const clubProductSelect = {
  id: true,
  categoryId: true,
  name: true,
  price: true,
  originalPrice: true,
  image: true,
  description: true,
  stock: true,
  durationMinutes: true,
  personCount: true,
  createdAt: true,
  category: {
    select: {
      name: true,
    },
  },
} as const;

export interface ClubProductRecord {
  id: number;
  categoryId: number;
  name: string;
  price: number;
  originalPrice: number | null;
  image: string | null;
  description: string | null;
  stock?: number | null;
  durationMinutes: number | null;
  personCount: number | null;
  createdAt: Date;
  category?: {
    name: string;
  } | null;
}

export interface ClubFirstOrderPromotion {
  id: number;
  discountRate: number;
  tag: string;
}
