// 新用户额度接口 DTO（单位统一为「位新客」）
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RECHARGE_TIER_AMOUNT_FEN } from '../../member/new-customer-quota/new-customer-quota.constants';

/** 额度概览 */
export class NewCustomerQuotaOverviewDto {
  /** 剩余额度：还能服务多少位新客 */
  @ApiProperty({ description: '剩余额度（位新客）' })
  remaining!: number;

  /** 预警阈值：低于该值时首页每天提醒 */
  @ApiProperty({ description: '预警阈值（位新客）' })
  warningThreshold!: number;

  /** 累计充值获得 */
  @ApiProperty({ description: '累计充值获得（位新客）' })
  totalRecharged!: number;

  /** 累计会员赠送 */
  @ApiProperty({ description: '累计会员赠送（位新客）' })
  totalGranted!: number;

  /** 累计已服务新客 */
  @ApiProperty({ description: '累计已服务新客数' })
  totalConsumed!: number;
}

/** 充值档位 */
export class NewCustomerQuotaTierDto {
  /** 充值金额（分） */
  @ApiProperty({ description: '充值金额（分）', example: 1000 })
  amountFen!: number;

  /** 金额展示值（如 ¥10） */
  @ApiProperty({ description: '金额展示值', example: '¥10' })
  amountDisplay!: string;

  /** 可服务的新客数，由后端按 0.03 元/位新客计算 */
  @ApiProperty({ description: '可服务的新客数', example: 333 })
  quotaCount!: number;
}

/** 充值档位列表 */
export class NewCustomerQuotaTiersDto {
  @ApiProperty({ type: [NewCustomerQuotaTierDto] })
  tiers!: NewCustomerQuotaTierDto[];
}

/** 额度流水条目 */
export class NewCustomerQuotaLogDto {
  @ApiProperty()
  id!: number;

  /** recharge=充值 grant=会员赠送 consume=新客消耗 clear=清零 */
  @ApiProperty({ enum: ['recharge', 'grant', 'consume', 'clear'] })
  type!: string;

  /** 变动数量：正数为增加，负数为消耗 */
  @ApiProperty()
  changeAmount!: number;

  /** 变动后的余额 */
  @ApiProperty()
  balanceAfter!: number;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  createdAt!: string;
}

/** 额度流水列表 */
export class NewCustomerQuotaLogsDto {
  @ApiProperty({ type: [NewCustomerQuotaLogDto] })
  items!: NewCustomerQuotaLogDto[];
}

/** 充值请求：仅支持固定档位，金额（分） */
export class RechargeNewCustomerQuotaDto {
  @ApiProperty({
    description: '充值金额（分），仅支持 1000 / 5000 / 10000',
    example: 1000,
  })
  @IsInt()
  @IsIn([...RECHARGE_TIER_AMOUNT_FEN])
  amountFen!: number;
}

/** 额度流水分页查询：与前端分页参数对齐，pageSize 兼作返回条数 */
export class NewCustomerQuotaLogsQueryDto {
  @ApiPropertyOptional({ description: '页码，默认 1' })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '每页条数，默认 20，上限 50' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;

  @ApiPropertyOptional({ description: '门店 ID（子账号场景）' })
  @IsOptional()
  @IsInt()
  storeId?: number;
}
