import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, ValidateNested } from 'class-validator';

/**
 * purelyClub C 端会员等级分布
 * 枚举固定为 free / gold / platinum / diamond
 */
export class PulseAdminMemberClubLevelBreakdownDto {
  @ApiProperty({ example: 18, description: '免费会员数量' })
  @IsInt()
  free: number;

  @ApiProperty({ example: 8, description: '黄金会员数量' })
  @IsInt()
  gold: number;

  @ApiProperty({ example: 4, description: '铂金会员数量' })
  @IsInt()
  platinum: number;

  @ApiProperty({ example: 2, description: '钻石会员数量' })
  @IsInt()
  diamond: number;
}

/**
 * purelyClub C 端会员运营统计（owner 视角）
 * 对齐前端 ClubMemberStats（memberList.types.ts）
 */
export class PulseAdminMemberClubStatsDto {
  @ApiProperty({ example: 1288058, description: '顾客在途余额合计（分）' })
  @IsInt()
  pendingBalanceFen: number;

  @ApiProperty({ example: 2267000, description: '会员充值总金额（分）' })
  @IsInt()
  totalRechargeFen: number;

  @ApiProperty({ example: 32, description: '会员用户总数' })
  @IsInt()
  totalMemberCount: number;

  @ApiProperty({ example: 147, description: '累计充值笔数' })
  @IsInt()
  rechargeCount: number;

  @ApiProperty({ example: 38800, description: '今日储值金额（分）' })
  @IsInt()
  todayRechargeFen: number;

  @ApiProperty({ example: 326500, description: '本月储值金额（分）' })
  @IsInt()
  monthRechargeFen: number;

  @ApiProperty({ example: 892000, description: '本季储值金额（分）' })
  @IsInt()
  quarterRechargeFen: number;

  @ApiProperty({ example: 1842000, description: '本年储值金额（分）' })
  @IsInt()
  yearRechargeFen: number;

  @ApiProperty({ example: 1250000, description: '去年储值金额（分）' })
  @IsInt()
  lastYearRechargeFen: number;

  @ApiProperty({
    type: PulseAdminMemberClubLevelBreakdownDto,
    description: '各等级会员数量分布',
  })
  @ValidateNested()
  @Type(() => PulseAdminMemberClubLevelBreakdownDto)
  levelBreakdown: PulseAdminMemberClubLevelBreakdownDto;
}
