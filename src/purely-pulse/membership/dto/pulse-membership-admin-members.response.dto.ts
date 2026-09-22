import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, ValidateNested } from 'class-validator';
import { PulseMemberBaseDto } from './pulse-membership-admin-member-base.dto';

/**
 * 管理员会员列表项
 * 字段与会员公共字段完全一致，保留独立类型以稳定列表接口的 Swagger 契约
 */
export class PulseMemberListItemDto extends PulseMemberBaseDto {}

/**
 * 管理员会员列表响应
 */
export class PulseAdminMembersResponseDto {
  @ApiProperty({
    type: [PulseMemberListItemDto],
    description: '会员列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseMemberListItemDto)
  items: PulseMemberListItemDto[];

  @ApiProperty({ example: 158, description: '会员总数' })
  @IsInt()
  total: number;
}
