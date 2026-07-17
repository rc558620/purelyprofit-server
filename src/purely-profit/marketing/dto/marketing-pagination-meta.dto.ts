// ─── 营销中心 Response DTOs · 分页元信息 ────────────────────────────────

import { ApiProperty } from '@nestjs/swagger';
import type { MarketingPaginationMeta } from '../marketing.utils';

export class MarketingPaginationMetaDto implements MarketingPaginationMeta {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;

  @ApiProperty({ example: 68 })
  total: number;

  @ApiProperty({ example: 4 })
  totalPages: number;
}
