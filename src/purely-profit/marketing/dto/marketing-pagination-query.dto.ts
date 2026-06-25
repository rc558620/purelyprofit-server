import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { transformOptionalInt } from '../../stores/dto/store-response.dto';

export class MarketingPageQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '门店 ID（不传则按当前可管理门店）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, description: '每页数量' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量必须大于等于 1' })
  pageSize?: number;
}
