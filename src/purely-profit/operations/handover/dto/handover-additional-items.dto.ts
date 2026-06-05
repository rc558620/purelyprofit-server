import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class HandoverAdditionalItemDto {
  @ApiProperty({ example: 1, description: '附加项 ID' })
  id: number;

  @ApiProperty({ example: '房卡', description: '附加项名称' })
  name: string;

  @ApiPropertyOptional({
    example: '2 张',
    description: '最近一次交班填写的值，用于下一班自动回填',
  })
  val?: string;

  @ApiProperty({ example: 1748766600000, description: '创建时间戳(ms)' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1748767200000,
    description: '更新时间戳(ms)',
  })
  updatedAt?: number;
}

export class HandoverAdditionalItemListResponseDto {
  @ApiProperty({
    type: [HandoverAdditionalItemDto],
    description: '附加项列表',
  })
  items: HandoverAdditionalItemDto[];
}

export class CreateHandoverAdditionalItemDto {
  @ApiProperty({ example: '房卡', description: '附加项名称' })
  @IsString({ message: '附加项名称必须是字符串' })
  @MaxLength(20, { message: '附加项名称不能超过 20 个字符' })
  name: string;
}

export class UpdateHandoverAdditionalItemDto {
  @ApiProperty({ example: '新房卡', description: '附加项名称' })
  @IsString({ message: '附加项名称必须是字符串' })
  @MaxLength(20, { message: '附加项名称不能超过 20 个字符' })
  name: string;
}
