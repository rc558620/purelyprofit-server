import { toTimestampMs } from '../../commerce/commerce.utils';
import type { CategoryResponseDto } from './dto/category.dto';
import type { CategoryRecord } from './categories.types';

export function buildCategoryResponse(
  category: CategoryRecord,
): CategoryResponseDto {
  return {
    id: String(category.id),
    name: category.name,
    ...(category.icon ? { icon: category.icon } : {}),
    createdAt: toTimestampMs(category.createdAt),
    updatedAt: toTimestampMs(category.updatedAt),
  };
}
