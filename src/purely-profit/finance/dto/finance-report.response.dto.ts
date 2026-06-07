import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';

export class FinanceReportSummaryDto {
  @ApiProperty({ example: 12000, description: '当期总收入' })
  totalIncome: number;

  @ApiProperty({ example: 8000, description: '当期总支出' })
  totalExpense: number;

  @ApiProperty({ example: 4000, description: '净现金流' })
  netCashFlow: number;

  @ApiProperty({ example: 18, description: '流水笔数' })
  recordCount: number;

  @ApiProperty({ example: 5600, description: '未收账款总额' })
  receivableTotal: number;

  @ApiProperty({ example: 1800, description: '未付账款总额' })
  payableTotal: number;

  @ApiPropertyOptional({ example: 26.5, description: '较上期净现金流变化率' })
  compareLastPeriod: number | null;
}

export class FinanceReportCashFlowRowDto {
  @ApiProperty({ example: '1', description: '流水 ID' })
  id: string;

  @ApiProperty({ example: '2026-5-14', description: '日期标签' })
  dateLabel: string;

  @ApiProperty({ example: '午市营业额', description: '标题' })
  title: string;

  @ApiProperty({ example: 'income', description: '收支方向' })
  direction: string;

  @ApiProperty({ example: '销售收入', description: '分类标签' })
  categoryLabel: string;

  @ApiProperty({ example: 128.5, description: '金额' })
  amount: number;

  @ApiProperty({ example: '微信', description: '支付方式标签' })
  paymentLabel: string;
}

export class FinanceReportAccountRowDto {
  @ApiProperty({ example: '1', description: '账款 ID' })
  id: string;

  @ApiProperty({ example: 'receivable', description: '账款类型' })
  type: string;

  @ApiProperty({ example: '应收', description: '账款类型标签' })
  typeLabel: string;

  @ApiProperty({ example: '张三水果店', description: '对方名称' })
  counterpart: string;

  @ApiProperty({ example: 5000, description: '总金额' })
  amount: number;

  @ApiProperty({ example: 3000, description: '剩余金额' })
  remaining: number;

  @ApiProperty({ example: '待收付', description: '状态标签' })
  statusLabel: string;

  @ApiProperty({ example: 'pending', description: '状态 key' })
  statusKey: string;

  @ApiProperty({ example: '2026-5-14', description: '日期标签' })
  dateLabel: string;
}

export class FinanceReportResponseDto {
  @ApiProperty({ type: FinanceReportSummaryDto, description: '财务报表概况' })
  @ValidateNested()
  @Type(() => FinanceReportSummaryDto)
  summary: FinanceReportSummaryDto;

  @ApiProperty({
    type: [FinanceReportCashFlowRowDto],
    description: '现金流水行',
  })
  @IsArray({ message: '现金流水行必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReportCashFlowRowDto)
  cashFlowRows: FinanceReportCashFlowRowDto[];

  @ApiProperty({ type: [FinanceReportAccountRowDto], description: '账款行' })
  @IsArray({ message: '账款行必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReportAccountRowDto)
  accountRows: FinanceReportAccountRowDto[];
}
