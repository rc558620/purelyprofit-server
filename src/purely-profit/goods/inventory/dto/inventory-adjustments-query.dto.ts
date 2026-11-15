// 库存流水列表查询入参：从 inventory.dto.ts 外移，避免该文件超过 400 行
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PaginationQueryDto,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';
import { INVENTORY_ADJUST_TYPE_VALUES } from '../../../commerce/commerce.utils';

export class ListInventoryAdjustmentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: 1, description: '商品 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '商品 ID 必须是整数' })
  @Min(1, { message: '商品 ID 必须大于等于 1' })
  productId?: number;

  @ApiPropertyOptional({ example: '可乐', description: '商品关键字' })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '关键字必须是字符串' })
  keyword?: string;

  @ApiPropertyOptional({
    example: 'restock',
    enum: INVENTORY_ADJUST_TYPE_VALUES,
    description: '调整类型',
  })
  @IsOptional()
  @IsIn(INVENTORY_ADJUST_TYPE_VALUES, { message: '调整类型不合法' })
  adjustType?: (typeof INVENTORY_ADJUST_TYPE_VALUES)[number];

  @ApiPropertyOptional({
    description:
      '分页游标：上一页响应中的 nextCursor 值，原样回传即可；不传表示第一页。' +
      '传入时优先于 page（兼容期保留 page/pageSize 走旧路径）',
    example: 'v1:eyJrZXlzIjpbMTc2MzIyNTYwMDAwMF0sImlkIjo0Mn0',
  })
  @IsOptional()
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(256, { message: 'cursor 长度不合法' })
  cursor?: string;
}
