import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { ScanOrderingStockMode } from '@prisma/client';

/** 更新商品库存与售罄状态请求。 */
export class UpdateScanOrderingProductStockDto {
  @ApiProperty({
    enum: ScanOrderingStockMode,
    example: ScanOrderingStockMode.sold_out,
    description: '库存模式',
  })
  @IsEnum(ScanOrderingStockMode, { message: '库存模式不合法' })
  stockMode: ScanOrderingStockMode;

  @ApiPropertyOptional({
    example: 10,
    description: '有限库存模式 (finite) 时的库存数量，其他模式可忽略',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '库存数量必须是整数' })
  @Min(0, { message: '库存数量不能小于 0' })
  stockQuantity?: number;
}
