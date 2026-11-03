// 卡模板上下架入参：已售出的持卡实例不受模板上下架影响
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ToggleMemberCardPlanDto {
  @ApiProperty({ example: true, description: '是否上架' })
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive: boolean;
}
