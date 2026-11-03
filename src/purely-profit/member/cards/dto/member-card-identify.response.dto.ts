// 开台识别聚合响应：顾客信息 + 储值余额 + 可用持卡 + 可用团购券
//
// 契约来源：purelyProfit memberCardRepository.dto.ts 的
// MemberCardIdentifyResponseDTO（开台弹窗 / 结账抵扣面板共用）。
// 口径约束：
// - 手机号一律脱敏下发，前端不再二次处理；
// - 金额以「分」落库、以「元」出参，换算只走 Money；
// - 只下发开台需要的资产摘要，**禁止**携带消费明细 / 积分明细等账务流水。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { MemberCardDto } from './member-card.response.dto';

/** 可用于开台核销的团购券 */
export class MemberVoucherAssetDto {
  @ApiProperty({ example: '123456789012', description: '团购券码' })
  @IsString()
  code: string;

  @ApiProperty({ example: '纯利宝团购券', description: '券对应商品名称快照' })
  @IsString()
  productName: string;

  @ApiProperty({ example: 50, description: '券面金额（元）' })
  @IsNumber()
  @Min(0)
  faceAmount: number;

  @ApiPropertyOptional({
    example: 1746534399999,
    description: '到期时间（毫秒时间戳），券不设到期时不下发',
  })
  @IsOptional()
  @IsInt()
  expiresAt?: number;
}

/**
 * 开台识别结果。
 *
 * 顾客未在本门店建档时不抛 404，而是返回「无顾客信息 + 空资产」的聚合结果：
 * 结账面板按有无 customerId 判定是否可用，403 / 404 会让前端弹出无意义报错。
 */
export class MemberCardIdentifyResponseDto {
  @ApiPropertyOptional({
    example: '12',
    description: '营销顾客 ID；未匹配到顾客时不下发',
  })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({
    example: '张三',
    description: '顾客姓名；未匹配到顾客时不下发',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: '13800000001',
    description: '顾客手机号（完整号码，占位号不下发）；未匹配到顾客时不下发',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: '黄金会员',
    description: 'purelyClub 会员等级名称；非 club 会员不下发',
  })
  @IsOptional()
  @IsString()
  clubLevelLabel?: string;

  @ApiProperty({ example: 1947.72, description: '储值余额（元）' })
  @IsNumber()
  @Min(0)
  balance: number;

  @ApiProperty({
    type: () => MemberCardDto,
    description: '当前可用持卡（仅生效中且有剩余次数）',
  })
  @IsArray()
  cards: MemberCardDto[];

  @ApiProperty({
    type: () => MemberVoucherAssetDto,
    description: '当前可用团购券（仅已支付待使用且未过期）',
  })
  @IsArray()
  vouchers: MemberVoucherAssetDto[];
}
