import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * 上架/下架产品
 */
export class ToggleMarketingProductDto {
  @ApiProperty({ example: true, description: '是否上架' })
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive: boolean;
}
