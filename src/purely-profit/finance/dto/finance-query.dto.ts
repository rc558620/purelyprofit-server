import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PaginationQueryDto,
  transformOptionalBoolean,
} from '../../stores/dto/store-response.dto';
import {
  FINANCE_ACCOUNT_CATEGORY_VALUES,
  FINANCE_ACCOUNT_STATUS_FILTER_VALUES,
  FINANCE_ACCOUNT_TYPE_FILTER_VALUES,
  FINANCE_ACCOUNT_TYPE_VALUES,
  FINANCE_CASH_FLOW_CATEGORY_VALUES,
  FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES,
  FINANCE_CASH_FLOW_DIRECTION_VALUES,
  FINANCE_CASH_FLOW_PAYMENT_VALUES,
  FINANCE_OVERVIEW_PERIOD_VALUES,
  FINANCE_PAYMENT_CHANNEL_VALUES,
  FINANCE_RECONCILIATION_STATUS_VALUES,
  FINANCE_RECONCILIATION_STATUS_FILTER_VALUES,
  FINANCE_RECONCILIATION_TYPE_VALUES,
  FINANCE_RECONCILIATION_TYPE_FILTER_VALUES,
  type FinanceAccountCategoryValue,
  type FinanceAccountTypeValue,
  type FinanceCashFlowCategoryValue,
  type FinanceCashFlowDirectionValue,
  type FinanceCashFlowPaymentValue,
  type FinanceOverviewPeriodValue,
  type FinancePaymentChannelValue,
  type FinanceReconciliationStatusValue,
  type FinanceReconciliationTypeValue,
} from '../finance.types';

export class FinanceOverviewQueryDto {
  @ApiPropertyOptional({
    enum: FINANCE_OVERVIEW_PERIOD_VALUES,
    description: '财务总览周期筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_OVERVIEW_PERIOD_VALUES, { message: '财务周期不合法' })
  period?: FinanceOverviewPeriodValue;
}

export class FinanceReportQueryDto {
  @ApiPropertyOptional({
    enum: [
      'today',
      'week',
      'month',
      'quarter',
      'year',
      'custom_month',
      'custom_range',
    ],
    description: '报表中心财务周期筛选',
  })
  @IsOptional()
  @IsIn(
    [
      'today',
      'week',
      'month',
      'quarter',
      'year',
      'custom_month',
      'custom_range',
    ],
    {
      message: '财务报表周期不合法',
    },
  )
  period?:
    | 'today'
    | 'week'
    | 'month'
    | 'quarter'
    | 'year'
    | 'custom_month'
    | 'custom_range';

  @ApiPropertyOptional({
    example: 2026,
    description: '按年筛选时的年份；不传默认当前年',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '年份必须是整数' })
  @Min(1970, { message: '年份不合法' })
  year?: number;

  @ApiPropertyOptional({
    example: 1747180800000,
    description: '按月模式对应的单日时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义日期必须是整数时间戳' })
  @Min(0, { message: '自定义日期不合法' })
  customDate?: number;

  @ApiPropertyOptional({
    example: 1746057600000,
    description: '自定义区间开始时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1748735999999,
    description: '自定义区间结束时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;

  @ApiPropertyOptional({
    example: false,
    description: '是否按导出模式拉取数据',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: '导出标记必须是布尔值' })
  export?: boolean;
}

export class ListFinanceCashFlowRecordsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ['today', 'week', 'month', 'quarter', 'custom_day', 'custom_range'],
    description: '现金流水时间周期',
  })
  @IsOptional()
  @IsIn(['today', 'week', 'month', 'quarter', 'custom_day', 'custom_range'], {
    message: '现金流水时间周期不合法',
  })
  period?:
    | 'today'
    | 'week'
    | 'month'
    | 'quarter'
    | 'custom_day'
    | 'custom_range';

  @ApiPropertyOptional({
    enum: FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES,
    description: '现金流水方向筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES, {
    message: '现金流水方向筛选不合法',
  })
  directionFilter?: 'all' | FinanceCashFlowDirectionValue;

  @ApiPropertyOptional({ example: 2026, description: '自定义单日-年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单日年份必须是整数' })
  customDayYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义单日-月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单日月份必须是整数' })
  customDayMonth?: number;

  @ApiPropertyOptional({ example: 14, description: '自定义单日-日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单日日份必须是整数' })
  customDayDay?: number;

  @ApiPropertyOptional({ example: 2026, description: '自定义区间开始-年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间开始年份必须是整数' })
  customRangeStartYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义区间开始-月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间开始月份必须是整数' })
  customRangeStartMonth?: number;

  @ApiPropertyOptional({ example: 1, description: '自定义区间开始-日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间开始日必须是整数' })
  customRangeStartDay?: number;

  @ApiPropertyOptional({ example: 2026, description: '自定义区间结束-年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间结束年份必须是整数' })
  customRangeEndYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义区间结束-月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间结束月份必须是整数' })
  customRangeEndMonth?: number;

  @ApiPropertyOptional({ example: 14, description: '自定义区间结束-日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间结束日必须是整数' })
  customRangeEndDay?: number;
}

export class CreateFinanceCashFlowRecordDto {
  @ApiProperty({
    enum: FINANCE_CASH_FLOW_DIRECTION_VALUES,
    description: '流水方向',
  })
  @IsIn(FINANCE_CASH_FLOW_DIRECTION_VALUES, { message: '流水方向不合法' })
  direction: FinanceCashFlowDirectionValue;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_CATEGORY_VALUES,
    description:
      '流水分类：sales 仅允许销售记录自动生成；refund/transfer_in/other_income 归入附加收入；purchase 单列进货支出；rent 店面租金；utilities 水电煤气；salary/marketing/tax/transfer_out/other_expense 归入成本支出',
  })
  @IsIn(FINANCE_CASH_FLOW_CATEGORY_VALUES, { message: '流水分类不合法' })
  category: FinanceCashFlowCategoryValue;

  @ApiProperty({ example: '午市营业额', description: '标题/摘要' })
  @IsString({ message: '流水标题必须是字符串' })
  @MaxLength(40, { message: '流水标题最多 40 个字符' })
  title: string;

  @ApiProperty({ example: 128.5, description: '金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '流水金额必须是数字' })
  @Min(0.01, { message: '流水金额必须大于 0' })
  amount: number;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_PAYMENT_VALUES,
    description: '支付方式',
  })
  @IsIn(FINANCE_CASH_FLOW_PAYMENT_VALUES, { message: '支付方式不合法' })
  payment: FinanceCashFlowPaymentValue;

  @ApiPropertyOptional({ example: '周末活动收入', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 个字符' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '发生时间必须是整数时间戳' })
  date: number;
}

export class ListFinanceAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FINANCE_ACCOUNT_TYPE_FILTER_VALUES,
    description: '账款类型筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_ACCOUNT_TYPE_FILTER_VALUES, { message: '账款类型筛选不合法' })
  typeFilter?: 'all' | FinanceAccountTypeValue;

  @ApiPropertyOptional({
    enum: FINANCE_ACCOUNT_STATUS_FILTER_VALUES,
    description: '账款状态筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_ACCOUNT_STATUS_FILTER_VALUES, { message: '账款状态筛选不合法' })
  statusFilter?: 'all' | 'pending' | 'partial' | 'settled' | 'overdue';

  @ApiPropertyOptional({
    example: '蔬菜批发行',
    description: '对方名称/备注搜索词',
  })
  @IsOptional()
  @IsString({ message: '搜索词必须是字符串' })
  @MaxLength(30, { message: '搜索词最多 30 个字符' })
  searchText?: string;
}

export class CreateFinanceAccountDto {
  @ApiProperty({
    enum: FINANCE_ACCOUNT_TYPE_VALUES,
    description: '账款类型',
  })
  @IsIn(FINANCE_ACCOUNT_TYPE_VALUES, { message: '账款类型不合法' })
  type: FinanceAccountTypeValue;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_CATEGORY_VALUES,
    description:
      '账款分类：sales_credit 强绑定应收；supplier_debt 强绑定应付；advance_paid/loan/deposit/other 允许按实际业务选择应收或应付',
  })
  @IsIn(FINANCE_ACCOUNT_CATEGORY_VALUES, { message: '账款分类不合法' })
  category: FinanceAccountCategoryValue;

  @ApiProperty({ example: '张三水果店', description: '对方名称' })
  @IsString({ message: '对方名称必须是字符串' })
  @MaxLength(30, { message: '对方名称最多 30 个字符' })
  counterpart: string;

  @ApiProperty({ example: 5000, description: '总金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '总金额必须是数字' })
  @Min(0.01, { message: '总金额必须大于 0' })
  amount: number;

  @ApiProperty({ example: 0, description: '已收/付金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '已收/付金额必须是数字' })
  @Min(0, { message: '已收/付金额不能小于 0' })
  paidAmount: number;

  @ApiPropertyOptional({
    example: 1747267200000,
    description: '到期时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '到期时间必须是整数时间戳' })
  dueDate?: number;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '发生时间必须是整数时间戳' })
  date: number;

  @ApiPropertyOptional({ example: '分两次结清', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 个字符' })
  note?: string;
}

export class SettleFinanceAccountDto {
  @ApiProperty({ example: 1000, description: '本次收/付金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '本次收付金额必须是数字' })
  @Min(0.01, { message: '本次收付金额必须大于 0' })
  payAmount: number;
}

export class FinanceReconciliationItemInputDto {
  @ApiProperty({ example: '微信渠道差异', description: '差异项目描述' })
  @IsString({ message: '差异描述必须是字符串' })
  description: string;

  @ApiProperty({ example: 100, description: '账面金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '账面金额必须是数字' })
  bookAmount: number;

  @ApiProperty({ example: 98, description: '实际金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '实际金额必须是数字' })
  actualAmount: number;

  @ApiPropertyOptional({ example: '手续费差异', description: '备注' })
  @IsOptional()
  @IsString({ message: '差异备注必须是字符串' })
  @MaxLength(100, { message: '差异备注最多 100 个字符' })
  note?: string;
}

export class ListFinanceReconciliationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FINANCE_RECONCILIATION_STATUS_FILTER_VALUES,
    description: '对账状态筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_RECONCILIATION_STATUS_FILTER_VALUES, {
    message: '对账状态筛选不合法',
  })
  statusFilter?: 'all' | FinanceReconciliationStatusValue;

  @ApiPropertyOptional({
    enum: FINANCE_RECONCILIATION_TYPE_FILTER_VALUES,
    description: '对账类型筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_RECONCILIATION_TYPE_FILTER_VALUES, {
    message: '对账类型筛选不合法',
  })
  typeFilter?: 'all' | FinanceReconciliationTypeValue;

  @ApiPropertyOptional({
    example: '供应商',
    description: '标题/对象/备注搜索词',
  })
  @IsOptional()
  @IsString({ message: '搜索词必须是字符串' })
  @MaxLength(30, { message: '搜索词最多 30 个字符' })
  searchText?: string;
}

export class CreateFinanceReconciliationDto {
  @ApiProperty({ example: '5月月度对账', description: '对账标题' })
  @IsString({ message: '对账标题必须是字符串' })
  @MaxLength(50, { message: '对账标题最多 50 个字符' })
  title: string;

  @ApiProperty({
    enum: FINANCE_RECONCILIATION_TYPE_VALUES,
    description: '对账类型',
  })
  @IsIn(FINANCE_RECONCILIATION_TYPE_VALUES, { message: '对账类型不合法' })
  type: FinanceReconciliationTypeValue;

  @ApiProperty({
    enum: FINANCE_RECONCILIATION_STATUS_VALUES,
    description: '前端计算得到的状态，后端会按实际金额重新校正',
  })
  @IsIn(FINANCE_RECONCILIATION_STATUS_VALUES, { message: '对账状态不合法' })
  status: FinanceReconciliationStatusValue;

  @ApiPropertyOptional({
    enum: FINANCE_PAYMENT_CHANNEL_VALUES,
    description: '收款渠道，仅 payment 类型有效',
  })
  @IsOptional()
  @IsIn(FINANCE_PAYMENT_CHANNEL_VALUES, { message: '收款渠道不合法' })
  channel?: FinancePaymentChannelValue;

  @ApiPropertyOptional({ example: '绿色蔬菜批发行', description: '对账对象' })
  @IsOptional()
  @IsString({ message: '对账对象必须是字符串' })
  @MaxLength(30, { message: '对账对象最多 30 个字符' })
  counterpart?: string;

  @ApiProperty({ example: 1746057600000, description: '周期开始时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '周期开始时间必须是整数时间戳' })
  periodStart: number;

  @ApiProperty({ example: 1748735999999, description: '周期结束时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '周期结束时间必须是整数时间戳' })
  periodEnd: number;

  @ApiProperty({ example: 12000, description: '账面收入，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '账面收入必须是数字' })
  @Min(0, { message: '账面收入不能小于 0' })
  bookIncome: number;

  @ApiProperty({ example: 8000, description: '账面支出，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '账面支出必须是数字' })
  @Min(0, { message: '账面支出不能小于 0' })
  bookExpense: number;

  @ApiProperty({ example: 11800, description: '实际收入，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '实际收入必须是数字' })
  @Min(0, { message: '实际收入不能小于 0' })
  actualIncome: number;

  @ApiProperty({ example: 8100, description: '实际支出，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '实际支出必须是数字' })
  @Min(0, { message: '实际支出不能小于 0' })
  actualExpense: number;

  @ApiPropertyOptional({
    type: [FinanceReconciliationItemInputDto],
    description: '差异明细',
  })
  @IsOptional()
  @IsArray({ message: '差异明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReconciliationItemInputDto)
  items?: FinanceReconciliationItemInputDto[];

  @ApiPropertyOptional({ example: '财务张姐', description: '对账人' })
  @IsOptional()
  @IsString({ message: '对账人必须是字符串' })
  @MaxLength(20, { message: '对账人最多 20 个字符' })
  operator?: string;

  @ApiPropertyOptional({ example: '节假日汇总', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 个字符' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '对账日期时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '对账日期必须是整数时间戳' })
  date: number;
}

export class ConfirmFinanceReconciliationDto {
  @ApiPropertyOptional({ example: '微信手续费差额', description: '调整说明' })
  @IsOptional()
  @IsString({ message: '调整说明必须是字符串' })
  @MaxLength(150, { message: '调整说明最多 150 个字符' })
  adjustNote?: string;
}
