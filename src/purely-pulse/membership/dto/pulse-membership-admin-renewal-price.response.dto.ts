import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { PulseMembershipPlanId } from '../membership.types';

/**
 * 单个档位的续费价现状（管理端「调整续费价格」弹窗的一行）。
 *
 * 所有金额都是**后端算好的展示字符串（单位：元）**。前端只负责渲染，
 * 不做任何乘除或分转元，以保证「运营看到的价 = 门店端展示的价 = 实际扣款」。
 */
export class PulseAdminRenewalPriceItemResponseDto {
  @ApiProperty({ example: 'yearly', description: '套餐档位' })
  planId: PulseMembershipPlanId;

  @ApiProperty({ example: '年度会员', description: '套餐名称' })
  planName: string;

  @ApiProperty({
    example: '469',
    description: '当前配置价（该档位的标准价，含子账号权益与否都以此为准）',
  })
  configPriceDisplay: string;

  @ApiPropertyOptional({
    example: '350',
    description:
      '本门店该档位议定的基础价（入库原值）；null = 未议定，续费按配置价走。' +
      '定价基数为 max(配置价, 议定价)，低于配置价时不再生效；' +
      '年 / 永久档位的子账号加价仍然叠加',
    nullable: true,
  })
  overridePriceDisplay: string | null;

  @ApiProperty({
    example: '100',
    description: '计入定价的子账号加价；月 / 季档位恒为 0',
  })
  subAccountAmountDisplay: string;

  @ApiProperty({
    example: '450',
    description: '★ 最终续费价 = max(配置价, 议定价) + 子账号加价',
  })
  renewalPriceDisplay: string;

  @ApiProperty({
    example: true,
    description:
      '是否允许编辑。含子账号权益的门店，月 / 季档位在门店端不展示，' +
      '改了也不会生效，因此为 false',
  })
  editable: boolean;

  @ApiPropertyOptional({
    example:
      '该门店含子账号权益，门店端只展示年 / 永久档位，月 / 季改价不会生效',
    description: '不可编辑时的原因文案，可直接展示给运营；可编辑时为 null',
    nullable: true,
  })
  editableReason: string | null;
}

/**
 * GET / PATCH /pulse/membership/admin/members/:id/renewal-price
 * 调整续费价格 —— 响应
 */
export class PulseAdminRenewalPriceResponseDto {
  @ApiProperty({
    type: [PulseAdminRenewalPriceItemResponseDto],
    description:
      '各档位的续费价现状，顺序与套餐目录一致（月 / 季 / 年 / 永久）',
  })
  items: PulseAdminRenewalPriceItemResponseDto[];
}
