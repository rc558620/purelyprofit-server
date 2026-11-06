import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * 签到状态：成功响应不包装，直接返回裸 DTO。
 * 布尔值必须是严格 JSON boolean；所有时间戳均为毫秒 number；
 * checkedDates 为上海时区 YYYY-MM-DD 字符串；活动不可用时返回 activityEnabled=false 的合法空态。
 */
export class CheckInStatusResponseDto {
  @ApiProperty({ example: true, description: '当前门店签到活动是否生效' })
  @IsBoolean({ message: '活动启用状态必须是布尔值' })
  activityEnabled: boolean;

  @ApiPropertyOptional({
    example: 1762400000000,
    description: '活动开始时间（毫秒时间戳）；活动不可用时省略',
  })
  @IsOptional()
  @IsInt({ message: '活动开始时间必须是整数毫秒时间戳' })
  @Min(0)
  activityStartAt?: number;

  @ApiPropertyOptional({
    example: 1762486399999,
    description: '活动结束时间（毫秒时间戳）；活动不可用时省略',
  })
  @IsOptional()
  @IsInt({ message: '活动结束时间必须是整数毫秒时间戳' })
  @Min(0)
  activityEndAt?: number;

  @ApiProperty({
    example: false,
    description: '按后端 serverTime 判定的今日是否已签到',
  })
  @IsBoolean({ message: '今日签到状态必须是布尔值' })
  todayCheckedIn: boolean;

  @ApiProperty({ example: 3, description: '截至当前的连续签到天数' })
  @IsInt({ message: '连续签到天数必须是整数' })
  @Min(0)
  continuousDays: number;

  @ApiProperty({ example: 1, description: '商家配置的单次签到积分，仅展示' })
  @IsInt({ message: '单次签到积分必须是整数' })
  @Min(0)
  pointsPerCheckIn: number;

  @ApiProperty({ example: 128, description: '当前门店会员积分余额' })
  @IsInt({ message: '积分余额必须是整数' })
  @Min(0)
  pointsBalance: number;

  @ApiProperty({
    example: ['2026-11-04', '2026-11-05'],
    description: '近期已签到日期（上海时区 YYYY-MM-DD）',
    type: [String],
  })
  @IsArray({ message: '已签到日期必须是数组' })
  @IsString({ each: true, message: '已签到日期必须是 YYYY-MM-DD 字符串' })
  checkedDates: string[];

  @ApiProperty({
    example: 1762444800000,
    description: '后端服务器时间（毫秒时间戳）',
  })
  @IsInt({ message: '服务器时间必须是整数毫秒时间戳' })
  @Min(0)
  serverTime: number;
}

/** 签到结果：空 body 提交后的裸 DTO，description 可为空串但禁止 null */
export class CheckInResultDto {
  @ApiProperty({
    example: 1762444800000,
    description: '签到时间（毫秒时间戳）',
  })
  @IsInt({ message: '签到时间必须是整数毫秒时间戳' })
  @Min(0)
  checkedInAt: number;

  @ApiProperty({ example: 1, description: '本次实际发放积分' })
  @IsInt({ message: '发放积分必须是整数' })
  @Min(1)
  awardedPoints: number;

  @ApiProperty({ example: 129, description: '事务内更新后的积分余额' })
  @IsInt({ message: '积分余额必须是整数' })
  @Min(0)
  pointsBalance: number;

  @ApiProperty({ example: 4, description: '签到后的连续签到天数' })
  @IsInt({ message: '连续签到天数必须是整数' })
  @Min(1)
  continuousDays: number;

  @ApiProperty({ example: '每日签到 +1 积分', description: '积分流水说明' })
  @IsString({ message: '说明必须是字符串' })
  description: string;
}
