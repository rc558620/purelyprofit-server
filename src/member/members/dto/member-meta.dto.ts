import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';

export class MemberMetaQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '按门店 ID 获取会员筛选元数据',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

export class MemberMetaOptionDto {
  @ApiProperty({ example: 'annual', description: '筛选项值' })
  @IsString({ message: '筛选项值必须是字符串' })
  value: string;

  @ApiProperty({ example: 18, description: '筛选项命中会员数' })
  @IsInt({ message: '筛选项命中会员数必须是整数' })
  count: number;
}

export class MembersMetaResponseDto {
  @ApiProperty({
    type: [MemberMetaOptionDto],
    description: '会员等级筛选项及命中数量',
  })
  levels: MemberMetaOptionDto[];

  @ApiProperty({
    type: [MemberMetaOptionDto],
    description: '会员状态筛选项及命中数量',
  })
  statuses: MemberMetaOptionDto[];
}
