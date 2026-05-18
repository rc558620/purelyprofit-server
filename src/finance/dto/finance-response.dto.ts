import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationMetaDto } from '../../stores/dto/store-response.dto';
import {
  FINANCE_ACCOUNT_CATEGORY_VALUES,
  FINANCE_ACCOUNT_STATUS_VALUES,
  FINANCE_ACCOUNT_TYPE_VALUES,
  FINANCE_CASH_FLOW_CATEGORY_VALUES,
  FINANCE_CASH_FLOW_DIRECTION_VALUES,
  FINANCE_CASH_FLOW_PAYMENT_VALUES,
  FINANCE_PAYMENT_CHANNEL_VALUES,
  FINANCE_RECONCILIATION_STATUS_VALUES,
  FINANCE_RECONCILIATION_TYPE_VALUES,
  type FinanceAccountCategoryValue,
  type FinanceAccountStatusValue,
  type FinanceAccountTypeValue,
  type FinanceCashFlowCategoryValue,
  type FinanceCashFlowDirectionValue,
  type FinanceCashFlowPaymentValue,
  type FinancePaymentChannelValue,
  type FinanceReconciliationStatusValue,
  type FinanceReconciliationTypeValue,
} from '../finance.types';

export class FinanceCompareDto {
  @ApiProperty({ example: 1280, description: '当前值' })
  @IsNumber({}, { message: '当前值必须是数字' })
  current: number;

  @ApiProperty({ example: 960, description: '上期值' })
  @IsNumber({}, { message: '上期值必须是数字' })
  previous: number;

  @ApiPropertyOptional({
    example: 33.33,
    description: '变化率 %，上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber({}, { message: '变化率必须是数字' })
  changeRate: number | null;
}

export class FinanceHeroSummaryDto {
  @ApiProperty({ type: FinanceCompareDto, description: '净收益' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  netIncome: FinanceCompareDto;

  @ApiProperty({ type: FinanceCompareDto, description: '总收入' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  totalIncome: FinanceCompareDto;

  @ApiProperty({ type: FinanceCompareDto, description: '总支出' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  totalExpense: FinanceCompareDto;

  @ApiProperty({ type: FinanceCompareDto, description: '利润率' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  profitRate: FinanceCompareDto;

  @ApiPropertyOptional({ example: 1.28, description: '收支比' })
  @IsOptional()
  @IsNumber({}, { message: '收支比必须是数字' })
  incomeExpenseRatio: number | null;
}

export class FinanceDailyTrendDto {
  @ApiProperty({ example: '05/14', description: '日期标签' })
  @IsString({ message: '日期标签必须是字符串' })
  dateLabel: string;

  @ApiProperty({ example: 420.5, description: '收入' })
  @IsNumber({}, { message: '收入必须是数字' })
  income: number;

  @ApiProperty({ example: 260.5, description: '支出' })
  @IsNumber({}, { message: '支出必须是数字' })
  expense: number;

  @ApiProperty({ example: 160, description: '净收益' })
  @IsNumber({}, { message: '净收益必须是数字' })
  net: number;
}

export class FinanceSourceItemDto {
  @ApiProperty({
    enum: ['sales', 'additional', 'cost', 'purchase'],
    description: '来源类型',
  })
  @IsString({ message: '来源类型必须是字符串' })
  type: 'sales' | 'additional' | 'cost' | 'purchase';

  @ApiProperty({ example: '销售收入', description: '来源名称' })
  @IsString({ message: '来源名称必须是字符串' })
  label: string;

  @ApiProperty({ example: 8800, description: '金额' })
  @IsNumber({}, { message: '金额必须是数字' })
  amount: number;

  @ApiProperty({ enum: ['income', 'expense'], description: '收支方向' })
  @IsIn(['income', 'expense'], { message: '收支方向不合法' })
  direction: 'income' | 'expense';

  @ApiProperty({ example: '#84cc16', description: '颜色' })
  @IsString({ message: '颜色必须是字符串' })
  color: string;

  @ApiProperty({ example: '🛒', description: '图标' })
  @IsString({ message: '图标必须是字符串' })
  icon: string;

  @ApiProperty({ example: 65, description: '占比整数百分比' })
  @IsInt({ message: '占比必须是整数' })
  percent: number;
}

export class FinanceSourceGroupDto {
  @ApiProperty({ enum: ['income', 'expense'], description: '分组方向' })
  @IsIn(['income', 'expense'], { message: '分组方向不合法' })
  direction: 'income' | 'expense';

  @ApiProperty({ example: 12800, description: '该方向总额' })
  @IsNumber({}, { message: '总额必须是数字' })
  total: number;

  @ApiProperty({ type: [FinanceSourceItemDto], description: '来源项列表' })
  @IsArray({ message: '来源项列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceSourceItemDto)
  items: FinanceSourceItemDto[];
}

export class FinanceOverviewResponseDto {
  @ApiProperty({ type: FinanceHeroSummaryDto, description: '头部汇总卡' })
  @ValidateNested()
  @Type(() => FinanceHeroSummaryDto)
  heroSummary: FinanceHeroSummaryDto;

  @ApiProperty({ type: [FinanceDailyTrendDto], description: '每日趋势' })
  @IsArray({ message: '每日趋势必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceDailyTrendDto)
  dailyTrend: FinanceDailyTrendDto[];

  @ApiProperty({ type: FinanceSourceGroupDto, description: '收入构成' })
  @ValidateNested()
  @Type(() => FinanceSourceGroupDto)
  incomeGroup: FinanceSourceGroupDto;

  @ApiProperty({ type: FinanceSourceGroupDto, description: '支出构成' })
  @ValidateNested()
  @Type(() => FinanceSourceGroupDto)
  expenseGroup: FinanceSourceGroupDto;
}

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

  @ApiProperty({ type: [FinanceReportCashFlowRowDto], description: '现金流水行' })
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

export class FinanceCashFlowRecordResponseDto {
  @ApiProperty({ example: '1', description: '流水 ID' })
  @IsString({ message: '流水 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_DIRECTION_VALUES,
    description: '流水方向',
  })
  @IsIn(FINANCE_CASH_FLOW_DIRECTION_VALUES, { message: '流水方向不合法' })
  direction: FinanceCashFlowDirectionValue;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_CATEGORY_VALUES,
    description:
      '流水分类：sales 为销售自动流水；refund/transfer_in/other_income 参与附加收入口径；purchase 参与进货支出口径；rent 店面租金；utilities 水电煤气；salary/marketing/tax/transfer_out/other_expense 参与成本支出口径',
  })
  @IsIn(FINANCE_CASH_FLOW_CATEGORY_VALUES, { message: '流水分类不合法' })
  category: FinanceCashFlowCategoryValue;

  @ApiProperty({ example: '午市营业额', description: '标题' })
  @IsString({ message: '流水标题必须是字符串' })
  title: string;

  @ApiProperty({ example: 128.5, description: '金额，单位元' })
  @IsNumber({}, { message: '流水金额必须是数字' })
  amount: number;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_PAYMENT_VALUES,
    description: '支付方式',
  })
  @IsIn(FINANCE_CASH_FLOW_PAYMENT_VALUES, { message: '支付方式不合法' })
  payment: FinanceCashFlowPaymentValue;

  @ApiPropertyOptional({ example: '节假日活动', description: '备注' })
  @IsOptional()
  @IsString({ message: '流水备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @IsInt({ message: '发生时间必须是整数' })
  date: number;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;
}

export class FinanceCashFlowStatsDto {
  @ApiProperty({ example: 12880, description: '总收入' })
  @IsNumber({}, { message: '总收入必须是数字' })
  totalIncome: number;

  @ApiProperty({ example: 9320, description: '总支出' })
  @IsNumber({}, { message: '总支出必须是数字' })
  totalExpense: number;

  @ApiProperty({ example: 3560, description: '净现金流' })
  @IsNumber({}, { message: '净现金流必须是数字' })
  netFlow: number;

  @ApiProperty({ example: 18, description: '流水笔数' })
  @IsInt({ message: '流水笔数必须是整数' })
  recordCount: number;

  @ApiPropertyOptional({ example: 25.6, description: '较上期变化 %' })
  @IsOptional()
  @IsNumber({}, { message: '较上期变化必须是数字' })
  compareLastPeriod: number | null;
}

export class PaginatedFinanceCashFlowRecordsResponseDto {
  @ApiProperty({
    type: [FinanceCashFlowRecordResponseDto],
    description: '当前页现金流水列表',
  })
  @IsArray({ message: '现金流水列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceCashFlowRecordResponseDto)
  items: FinanceCashFlowRecordResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}

export class FinanceAccountRecordResponseDto {
  @ApiProperty({ example: '1', description: '账款 ID' })
  @IsString({ message: '账款 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_TYPE_VALUES,
    description: '账款类型',
  })
  @IsIn(FINANCE_ACCOUNT_TYPE_VALUES, { message: '账款类型不合法' })
  type: FinanceAccountTypeValue;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_CATEGORY_VALUES,
    description:
      '账款分类：sales_credit 为客户赊账应收；supplier_debt 为供应商欠款应付；advance_paid/loan/deposit/other 可按业务场景落为应收或应付',
  })
  @IsIn(FINANCE_ACCOUNT_CATEGORY_VALUES, { message: '账款分类不合法' })
  category: FinanceAccountCategoryValue;

  @ApiProperty({ example: '张三水果店', description: '对方名称' })
  @IsString({ message: '对方名称必须是字符串' })
  counterpart: string;

  @ApiProperty({ example: 5200, description: '总金额，单位元' })
  @IsNumber({}, { message: '总金额必须是数字' })
  amount: number;

  @ApiProperty({ example: 1200, description: '已收/付金额，单位元' })
  @IsNumber({}, { message: '已收/付金额必须是数字' })
  paidAmount: number;

  @ApiProperty({ example: 4000, description: '剩余金额，单位元' })
  @IsNumber({}, { message: '剩余金额必须是数字' })
  remaining: number;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_STATUS_VALUES,
    description: '账款状态',
  })
  @IsIn(FINANCE_ACCOUNT_STATUS_VALUES, { message: '账款状态不合法' })
  status: FinanceAccountStatusValue;

  @ApiPropertyOptional({
    example: 1747267200000,
    description: '到期时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '到期时间必须是整数' })
  dueDate?: number;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @IsInt({ message: '发生时间必须是整数' })
  date: number;

  @ApiPropertyOptional({ example: '月底前结清', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiProperty({ example: 1747190000000, description: '更新时间戳（ms）' })
  @IsInt({ message: '更新时间必须是整数' })
  updatedAt: number;
}

export class FinanceAccountsStatsDto {
  @ApiProperty({ example: 8200, description: '应收总额' })
  @IsNumber({}, { message: '应收总额必须是数字' })
  totalReceivable: number;

  @ApiProperty({ example: 2600, description: '应付总额' })
  @IsNumber({}, { message: '应付总额必须是数字' })
  totalPayable: number;

  @ApiProperty({ example: 5600, description: '净应收' })
  @IsNumber({}, { message: '净应收必须是数字' })
  netReceivable: number;

  @ApiProperty({ example: 2, description: '逾期条数' })
  @IsInt({ message: '逾期条数必须是整数' })
  overdueCount: number;

  @ApiProperty({ example: 4, description: '本月新增条数' })
  @IsInt({ message: '本月新增条数必须是整数' })
  newThisMonth: number;
}

export class PaginatedFinanceAccountsResponseDto {
  @ApiProperty({
    type: [FinanceAccountRecordResponseDto],
    description: '当前页账款列表',
  })
  @IsArray({ message: '账款列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceAccountRecordResponseDto)
  items: FinanceAccountRecordResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}

export class FinanceReconciliationItemResponseDto {
  @ApiProperty({ example: '1', description: '差异项 ID' })
  @IsString({ message: '差异项 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '微信手续费差异', description: '差异描述' })
  @IsString({ message: '差异描述必须是字符串' })
  description: string;

  @ApiProperty({ example: 100, description: '账面金额' })
  @IsNumber({}, { message: '账面金额必须是数字' })
  bookAmount: number;

  @ApiProperty({ example: 98, description: '实际金额' })
  @IsNumber({}, { message: '实际金额必须是数字' })
  actualAmount: number;

  @ApiProperty({ example: -2, description: '差异金额' })
  @IsNumber({}, { message: '差异金额必须是数字' })
  difference: number;

  @ApiPropertyOptional({ example: '平台手续费', description: '差异备注' })
  @IsOptional()
  @IsString({ message: '差异备注必须是字符串' })
  note?: string;
}

export class FinanceReconciliationRecordResponseDto {
  @ApiProperty({ example: '1', description: '对账单 ID' })
  @IsString({ message: '对账单 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '5月月度对账', description: '标题' })
  @IsString({ message: '标题必须是字符串' })
  title: string;

  @ApiProperty({
    enum: FINANCE_RECONCILIATION_TYPE_VALUES,
    description: '对账类型',
  })
  @IsIn(FINANCE_RECONCILIATION_TYPE_VALUES, { message: '对账类型不合法' })
  type: FinanceReconciliationTypeValue;

  @ApiProperty({
    enum: FINANCE_RECONCILIATION_STATUS_VALUES,
    description: '对账状态',
  })
  @IsIn(FINANCE_RECONCILIATION_STATUS_VALUES, { message: '对账状态不合法' })
  status: FinanceReconciliationStatusValue;

  @ApiPropertyOptional({
    enum: FINANCE_PAYMENT_CHANNEL_VALUES,
    description: '渠道',
  })
  @IsOptional()
  @IsIn(FINANCE_PAYMENT_CHANNEL_VALUES, { message: '渠道不合法' })
  channel?: FinancePaymentChannelValue;

  @ApiPropertyOptional({ example: '绿色蔬菜批发行', description: '对账对象' })
  @IsOptional()
  @IsString({ message: '对账对象必须是字符串' })
  counterpart?: string;

  @ApiProperty({ example: 1746057600000, description: '周期开始时间戳（ms）' })
  @IsInt({ message: '周期开始时间必须是整数' })
  periodStart: number;

  @ApiProperty({ example: 1748735999999, description: '周期结束时间戳（ms）' })
  @IsInt({ message: '周期结束时间必须是整数' })
  periodEnd: number;

  @ApiProperty({ example: 12000, description: '账面收入' })
  @IsNumber({}, { message: '账面收入必须是数字' })
  bookIncome: number;

  @ApiProperty({ example: 8000, description: '账面支出' })
  @IsNumber({}, { message: '账面支出必须是数字' })
  bookExpense: number;

  @ApiProperty({ example: 4000, description: '账面净额' })
  @IsNumber({}, { message: '账面净额必须是数字' })
  bookNet: number;

  @ApiProperty({ example: 11800, description: '实际收入' })
  @IsNumber({}, { message: '实际收入必须是数字' })
  actualIncome: number;

  @ApiProperty({ example: 8100, description: '实际支出' })
  @IsNumber({}, { message: '实际支出必须是数字' })
  actualExpense: number;

  @ApiProperty({ example: 3700, description: '实际净额' })
  @IsNumber({}, { message: '实际净额必须是数字' })
  actualNet: number;

  @ApiProperty({ example: -300, description: '差异金额' })
  @IsNumber({}, { message: '差异金额必须是数字' })
  diffAmount: number;

  @ApiProperty({
    type: [FinanceReconciliationItemResponseDto],
    description: '差异明细',
  })
  @IsArray({ message: '差异明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReconciliationItemResponseDto)
  items: FinanceReconciliationItemResponseDto[];

  @ApiPropertyOptional({ example: '微信手续费差额', description: '调整说明' })
  @IsOptional()
  @IsString({ message: '调整说明必须是字符串' })
  adjustNote?: string;

  @ApiPropertyOptional({ example: '财务张姐', description: '对账人' })
  @IsOptional()
  @IsString({ message: '对账人必须是字符串' })
  operator?: string;

  @ApiPropertyOptional({ example: '节假日汇总', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '对账日期时间戳（ms）' })
  @IsInt({ message: '对账日期必须是整数' })
  date: number;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiProperty({ example: 1747190000000, description: '更新时间戳（ms）' })
  @IsInt({ message: '更新时间必须是整数' })
  updatedAt: number;
}

export class FinanceReconciliationStatsDto {
  @ApiProperty({ example: 8, description: '总对账单数' })
  @IsInt({ message: '总对账单数必须是整数' })
  totalCount: number;

  @ApiProperty({ example: 3, description: '已核实数' })
  @IsInt({ message: '已核实数必须是整数' })
  confirmedCount: number;

  @ApiProperty({ example: 2, description: '有差异数' })
  @IsInt({ message: '有差异数必须是整数' })
  discrepancyCount: number;

  @ApiProperty({ example: 1, description: '已调整数' })
  @IsInt({ message: '已调整数必须是整数' })
  adjustedCount: number;

  @ApiProperty({ example: 2, description: '草稿数' })
  @IsInt({ message: '草稿数必须是整数' })
  draftCount: number;

  @ApiProperty({ example: 628, description: '累计差异总额' })
  @IsNumber({}, { message: '累计差异总额必须是数字' })
  totalDiffAmount: number;

  @ApiProperty({ example: 4, description: '本月新增数' })
  @IsInt({ message: '本月新增数必须是整数' })
  newThisMonth: number;
}

export class PaginatedFinanceReconciliationsResponseDto {
  @ApiProperty({
    type: [FinanceReconciliationRecordResponseDto],
    description: '当前页对账单列表',
  })
  @IsArray({ message: '对账单列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReconciliationRecordResponseDto)
  items: FinanceReconciliationRecordResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}
