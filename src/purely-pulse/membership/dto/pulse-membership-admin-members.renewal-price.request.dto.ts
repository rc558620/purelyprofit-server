// Pulse / 管理端续费价调整请求 DTO
//
// 覆盖某门店在各档位上的议定续费价（不含子账号加价，加价单独走补录接口）。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PulseAdminMemberIdentityFieldsDto } from './pulse-membership-admin-members.base.dto';
import {
  PULSE_AMOUNT_NON_NEGATIVE_PATTERN,
  PULSE_MEMBERSHIP_PLAN_ID_VALUES,
} from './pulse-membership-admin-members.constants';
import { toOptionalAmountString } from './pulse-membership-admin-members.transform';
import type { PulseMembershipPlanId } from '../membership.types';

/**
 * 「调整续费价格」的单档位提交项。
 *
 * `priceDisplay` 为空（null / undefined / 空串）表示**清除覆盖**、恢复默认价，
 * 因此弹窗清空输入框即可回退；`0` 是合法取值，表示该档位免费，
 * 与「未设置」是两回事，校验规则必须放行。
 */
export class PulseAdminRenewalPriceItemDto {
  @ApiProperty({
    enum: PULSE_MEMBERSHIP_PLAN_ID_VALUES,
    example: 'yearly',
    description: '套餐档位',
  })
  @IsIn(PULSE_MEMBERSHIP_PLAN_ID_VALUES, { message: '套餐档位不合法' })
  planId: PulseMembershipPlanId;

  @ApiPropertyOptional({
    example: '350',
    description:
      '覆盖价（元，最多两位小数，允许 0）。传空串表示清除覆盖、按配置价续费',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalAmountString(value))
  @IsString({ message: '续费价必须是字符串' })
  @Matches(PULSE_AMOUNT_NON_NEGATIVE_PATTERN, {
    message: '续费价必须是非负数，最多两位小数',
  })
  priceDisplay?: string;
}

/** PATCH /pulse/membership/admin/members/:id/renewal-price —— 请求体 */
export class PulseAdminRenewalPriceUpdateDto extends PulseAdminMemberIdentityFieldsDto {
  @ApiProperty({
    type: [PulseAdminRenewalPriceItemDto],
    description:
      '要调整的档位列表。只需提交改动过的档位，未提交的保持原样；' +
      'priceDisplay 为空即清除该档位的覆盖价',
  })
  @IsArray({ message: '档位列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PulseAdminRenewalPriceItemDto)
  items: PulseAdminRenewalPriceItemDto[];
}
