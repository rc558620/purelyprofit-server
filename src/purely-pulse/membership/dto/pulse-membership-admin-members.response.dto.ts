import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, ValidateNested } from 'class-validator';
import { PulseMemberBaseDto } from './pulse-membership-admin-member-base.dto';

/**
 * 管理员会员列表项
 * 字段与会员公共字段完全一致，保留独立类型以稳定列表接口的 Swagger 契约
 */
export class PulseMemberListItemDto extends PulseMemberBaseDto {
  @ApiProperty({
    example: true,
    description:
      '续费价是否被调整过。口径是**曾经调过**：以改价审计为准，' +
      '运营后来清空覆盖（恢复配置价）也仍为 true，供列表「已调价」徽章与清单筛选使用',
  })
  @IsBoolean()
  renewalPriceAdjusted: boolean;
}

/**
 * 会员列表统计概览（后端权威计算，前端仅展示）。
 *
 * 统计口径为**当前查询条件过滤后的完整列表**，与分页切片无关，
 * 保证「共 X 位」与筛选条件一致。
 */
export class PulseAdminMemberListStatsDto {
  @ApiProperty({ example: 158, description: '当前筛选条件下的会员总数' })
  @IsInt()
  totalCount: number;

  @ApiProperty({ example: 120, description: '活跃会员数' })
  @IsInt()
  activeCount: number;

  @ApiProperty({ example: 30, description: '未活跃会员数' })
  @IsInt()
  inactiveCount: number;

  @ApiProperty({ example: 6, description: '合伙人数' })
  @IsInt()
  partnerCount: number;

  @ApiProperty({ example: 2, description: '封禁人数' })
  @IsInt()
  bannedCount: number;
}

/**
 * 管理员会员列表响应
 */
export class PulseAdminMembersResponseDto {
  @ApiProperty({
    type: [PulseMemberListItemDto],
    description: '当前页会员列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseMemberListItemDto)
  items: PulseMemberListItemDto[];

  @ApiProperty({ example: 158, description: '当前筛选条件下的会员总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码（从 1 开始）' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页条数' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: true, description: '是否还有下一页' })
  @IsBoolean()
  hasMore: boolean;

  @ApiProperty({
    type: PulseAdminMemberListStatsDto,
    description: '统计概览（按当前筛选条件的完整列表计算，与分页无关）',
  })
  @ValidateNested()
  @Type(() => PulseAdminMemberListStatsDto)
  stats: PulseAdminMemberListStatsDto;
}
