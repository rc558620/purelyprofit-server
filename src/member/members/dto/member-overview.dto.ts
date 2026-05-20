import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';

export class MemberOverviewQueryDto {
  @ApiPropertyOptional({ example: 1, description: '按门店 ID 获取会员概览' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

export class MembersOverviewResponseDto {
  @ApiProperty({ example: 168, description: '总会员数' })
  @IsInt({ message: '总会员数必须是整数' })
  totalCount: number;

  @ApiProperty({ example: 150, description: '活跃会员数' })
  @IsInt({ message: '活跃会员数必须是整数' })
  activeCount: number;

  @ApiProperty({ example: 23, description: '合伙人数' })
  @IsInt({ message: '合伙人数必须是整数' })
  partnerCount: number;

  @ApiProperty({ example: 5, description: '封禁会员数' })
  @IsInt({ message: '封禁会员数必须是整数' })
  bannedCount: number;
}
