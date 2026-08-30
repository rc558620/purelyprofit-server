import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COMMISSION_RECORD_STATUS_VALUES,
  COMMISSION_RECORDS_DEFAULT_PAGE_SIZE,
  COMMISSION_RECORDS_MAX_PAGE_SIZE,
} from '../commission.constants';
import type { CommissionRecordStatusValue } from '../commission.types';

/** 提成明细查询参数。 */
export class ListCommissionRecordsQueryDto {
  @ApiPropertyOptional({ example: '2026-07', description: '归属月份 YYYY-MM' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '月份格式必须为 YYYY-MM' })
  month?: string;

  @ApiPropertyOptional({ example: 1, description: '技师员工 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '技师员工 ID 必须是整数' })
  @Min(1, { message: '技师员工 ID 必须大于等于 1' })
  technicianId?: number;

  @ApiPropertyOptional({
    description: '记录状态',
    enum: COMMISSION_RECORD_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(COMMISSION_RECORD_STATUS_VALUES, { message: '记录状态不合法' })
  status?: CommissionRecordStatusValue;

  @ApiPropertyOptional({ example: 1, description: '页码（从 1 开始）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于 1' })
  page?: number;

  @ApiPropertyOptional({
    example: COMMISSION_RECORDS_DEFAULT_PAGE_SIZE,
    description: '每页条数',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数必须是整数' })
  @Min(1, { message: '每页条数必须大于等于 1' })
  @Max(COMMISSION_RECORDS_MAX_PAGE_SIZE, {
    message: '每页条数不能超过 100',
  })
  pageSize?: number;
}

/** 提成明细记录响应（金额为元）。 */
export class CommissionRecordResponseDto {
  @ApiProperty({ example: 1, description: '提成记录 ID' })
  id: number;

  @ApiProperty({ example: 1, description: '关联会话 ID' })
  sessionId: number;

  @ApiProperty({ example: 'A台', description: '空间名称快照' })
  spaceName: string;

  @ApiProperty({ example: 1, description: '技师员工 ID' })
  technicianId: number;

  @ApiProperty({ example: '王强', description: '技师姓名快照' })
  technicianName: string;

  @ApiProperty({ example: [1, 2], description: '关联服务 ID 列表' })
  serviceIds: number[];

  @ApiProperty({ example: ['足疗', 'SPA'], description: '服务名称列表' })
  serviceNames: string[];

  @ApiProperty({
    example: [50, 52, 50],
    description: '每服务提成金额（元），与 serviceIds 对齐',
  })
  serviceCommissions: number[];

  @ApiProperty({ example: 120, description: '提成金额（元）' })
  commission: number;

  @ApiProperty({
    example: 'settled',
    description: '记录状态',
    enum: COMMISSION_RECORD_STATUS_VALUES,
  })
  status: CommissionRecordStatusValue;

  @ApiProperty({ example: 1741323600000, description: '结账时间戳（毫秒）' })
  settledAt: number;

  @ApiProperty({ example: 1741323600000, description: '创建时间戳（毫秒）' })
  createdAt: number;
}

/** 提成明细汇总（按当前筛选条件计算，金额为元）。 */
export class CommissionRecordsSummaryDto {
  @ApiProperty({
    example: 1200,
    description: '已结账提成合计（settled+included，元）',
  })
  settledTotal: number;

  @ApiProperty({ example: 0, description: '待结账提成合计（元）' })
  pendingTotal: number;

  @ApiProperty({ example: 0, description: '已作废提成合计（元）' })
  cancelledTotal: number;

  @ApiProperty({ example: 10, description: '记录总笔数' })
  totalCount: number;

  @ApiProperty({ example: 8, description: '已结账记录笔数' })
  settledCount: number;

  @ApiProperty({ example: 0, description: '待结账记录笔数' })
  pendingCount: number;

  @ApiProperty({ example: 0, description: '已作废记录笔数' })
  cancelledCount: number;
}

/** 提成明细列表响应。 */
export class ListCommissionRecordsResponseDto {
  @ApiProperty({
    type: [CommissionRecordResponseDto],
    description: '当前页明细',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CommissionRecordResponseDto)
  items: CommissionRecordResponseDto[];

  @ApiProperty({ type: CommissionRecordsSummaryDto, description: '汇总' })
  @ValidateNested()
  @Type(() => CommissionRecordsSummaryDto)
  summary: CommissionRecordsSummaryDto;

  @ApiProperty({ example: 10, description: '筛选条件下的总记录数' })
  total: number;

  @ApiProperty({ example: false, description: '是否还有更多数据' })
  hasMore: boolean;
}

/** 员工月度提成汇总查询参数（工资弹窗回填）。 */
export class CommissionSummaryByEmployeeQueryDto {
  @ApiProperty({ example: 1, description: '员工 ID（技师）' })
  @Type(() => Number)
  @IsInt({ message: '员工 ID 必须是整数' })
  @Min(1, { message: '员工 ID 必须大于等于 1' })
  employeeId: number;

  @ApiProperty({ example: '2026-07', description: '归属月份 YYYY-MM' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '月份格式必须为 YYYY-MM' })
  month: string;
}

/** 员工月度提成汇总响应（工资弹窗回填，金额为元）。 */
export class CommissionSummaryByEmployeeResponseDto {
  @ApiProperty({ example: 1200, description: '该员工该月已结账提成合计（元）' })
  @IsNumber({}, { message: '提成合计必须是数字' })
  commission: number;
}
