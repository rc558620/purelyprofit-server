import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PulseMembershipPlanId } from '../membership.types';

/**
 * POST /pulse/membership/admin/members/:id/membership/pricing-preview
 * 会员成交价预览 —— 响应
 *
 * 所有金额都是**后端算好的展示字符串（单位：元）**。前端只负责渲染，
 * 不做任何乘除或分转元，以保证「运营看到的价 = 实际写入的价」。
 */
export class PulseAdminMemberPricingPreviewResponseDto {
  @ApiPropertyOptional({
    example: 'yearly',
    description: '本次预览的目标档位；免费会员为 null',
  })
  targetPlanId: PulseMembershipPlanId | null;

  @ApiProperty({
    example: '469',
    description: '当前配置价（不含子账号）',
  })
  configPriceDisplay: string;

  @ApiProperty({
    example: '150',
    description: '参与定价的子账号加价',
  })
  subAccountAmountDisplay: string;

  @ApiProperty({
    example: '498',
    description: '下次续费价 = 当前配置价 + 子账号加价',
  })
  renewalPriceDisplay: string;

  @ApiPropertyOptional({
    example: '500',
    description:
      '本次填写的成交金额，仅用于记账回显。成交价不参与续费定价，' +
      '运营议出的价格只对本次生效',
  })
  dealPriceDisplay: string | null;
}
