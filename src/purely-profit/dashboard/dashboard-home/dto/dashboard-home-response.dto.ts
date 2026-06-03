import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreSubAccountStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import {
  DASHBOARD_HOME_ACTIVITY_ICON_VALUES,
  DASHBOARD_HOME_ACTIVITY_TYPE_VALUES,
  DASHBOARD_HOME_PERIOD_VALUES,
  type DashboardHomeActivityIconValue,
  type DashboardHomeActivityTypeValue,
  type DashboardHomePeriodValue,
} from '../dashboard-home.types';
import type { ProfitHomeModule } from '../../../access-control/subject-capability.service';

export class DashboardHomeStatsDto {
  @ApiProperty({ example: '今日净利润 (元)', description: '净利润卡片标题' })
  @IsString({ message: '净利润标题必须是字符串' })
  profitLabel: string;

  @ApiProperty({ example: 1248.5, description: '当前周期净利润，单位元' })
  @IsNumber({}, { message: '净利润必须是数字' })
  profit: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: '净利润较上期变化率（%），上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber({}, { message: '净利润变化率必须是数字' })
  profitChange: number | null;

  @ApiProperty({ example: '较昨日', description: '净利润对比口径文案' })
  @IsString({ message: '净利润对比文案必须是字符串' })
  profitCompareLabel: string;

  @ApiProperty({ example: '今日订单数', description: '订单卡片标题' })
  @IsString({ message: '订单标题必须是字符串' })
  orderLabel: string;

  @ApiProperty({ example: 86, description: '当前周期订单数' })
  @IsInt({ message: '订单数必须是整数' })
  orderCount: number;

  @ApiPropertyOptional({
    example: 5.2,
    description: '订单数较上期变化率（%），上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber({}, { message: '订单变化率必须是数字' })
  orderChange: number | null;

  @ApiProperty({ example: '较昨日', description: '订单对比口径文案' })
  @IsString({ message: '订单对比文案必须是字符串' })
  orderCompareLabel: string;
}

export class DashboardHomeSalesTrendDto {
  @ApiProperty({ example: '销售趋势图', description: '趋势图标题' })
  @IsString({ message: '趋势图标题必须是字符串' })
  title: string;

  @ApiProperty({
    example: ['08:00', '10:00', '12:00', '14:00'],
    description: '横轴标签',
  })
  @IsArray({ message: '横轴标签必须是数组' })
  categories: string[];

  @ApiProperty({
    example: [800, 1200, 1000, null],
    description: '实收数据，未来时段可返回 null',
  })
  @IsArray({ message: '实收数据必须是数组' })
  actual: Array<number | null>;

  @ApiProperty({
    example: [null, null, null, 900],
    description: '预测数据，仅在需要预测的时段返回数值',
  })
  @IsArray({ message: '预测数据必须是数组' })
  forecast: Array<number | null>;

  @ApiProperty({ example: false, description: '是否为年度按月视图' })
  @IsBoolean({ message: '年度视图标记必须是布尔值' })
  isYearMode: boolean;

  @ApiProperty({ example: '实收', description: '实收图例名称' })
  @IsString({ message: '实收图例名称必须是字符串' })
  seriesNameActual: string;

  @ApiProperty({ example: '预测', description: '预测图例名称' })
  @IsString({ message: '预测图例名称必须是字符串' })
  seriesNameForecast: string;
}

export class DashboardHomeActivityDto {
  @ApiProperty({ example: 'sales-rise-today', description: '动态 ID' })
  @IsString({ message: '动态 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    enum: DASHBOARD_HOME_ACTIVITY_TYPE_VALUES,
    description: '动态类型 success/warning/info',
  })
  @IsIn(DASHBOARD_HOME_ACTIVITY_TYPE_VALUES, { message: '动态类型不合法' })
  type: DashboardHomeActivityTypeValue;

  @ApiProperty({
    enum: DASHBOARD_HOME_ACTIVITY_ICON_VALUES,
    description: '前端用于映射图标资源的 key',
  })
  @IsIn(DASHBOARD_HOME_ACTIVITY_ICON_VALUES, { message: '动态图标类型不合法' })
  icon: DashboardHomeActivityIconValue;

  @ApiProperty({ example: '今日销售额超昨日', description: '动态标题' })
  @IsString({ message: '动态标题必须是字符串' })
  title: string;

  @ApiProperty({
    example: '刚刚 · 环比 +12.5%',
    description: '动态时间/来源文案',
  })
  @IsString({ message: '动态时间文案必须是字符串' })
  time: string;

  @ApiPropertyOptional({ example: '+¥342', description: '动态右侧数值文案' })
  @IsOptional()
  @IsString({ message: '动态数值文案必须是字符串' })
  value?: string;

  @ApiPropertyOptional({ example: '剩5件', description: '动态标签文案' })
  @IsOptional()
  @IsString({ message: '动态标签文案必须是字符串' })
  tag?: string;

  @ApiPropertyOptional({ example: 'inventory', description: '关联业务类型' })
  @IsOptional()
  @IsString({ message: '关联业务类型必须是字符串' })
  bizType?: string;

  @ApiPropertyOptional({ example: '12', description: '关联业务 ID' })
  @IsOptional()
  @IsString({ message: '关联业务 ID 必须是字符串' })
  bizId?: string;

  @ApiPropertyOptional({ example: '/stocktaking', description: '点击跳转路径' })
  @IsOptional()
  @IsString({ message: '跳转路径必须是字符串' })
  actionUrl?: string;

  @ApiProperty({ example: 1747184400000, description: '动态创建时间戳（ms）' })
  @IsInt({ message: '动态创建时间必须是整数' })
  createdAt: number;
}

export class DashboardHomeMetaDto {
  @ApiProperty({
    enum: DASHBOARD_HOME_PERIOD_VALUES,
    description: '当前统计周期',
  })
  @IsIn(DASHBOARD_HOME_PERIOD_VALUES, { message: '统计周期不合法' })
  period: DashboardHomePeriodValue;

  @ApiProperty({ example: 18, description: '当前统计门店 ID' })
  @IsInt({ message: '门店 ID 必须是整数' })
  storeId: number;

  @ApiProperty({ example: '纯利宝测试门店', description: '当前统计门店名称' })
  @IsString({ message: '门店名称必须是字符串' })
  storeName: string;

  @ApiProperty({
    example: 1747180800000,
    description: '当前周期开始时间戳（ms）',
  })
  @IsInt({ message: '当前周期开始时间必须是整数' })
  startAt: number;

  @ApiProperty({
    example: 1747212600000,
    description: '当前周期结束时间戳（ms）',
  })
  @IsInt({ message: '当前周期结束时间必须是整数' })
  endAt: number;

  @ApiProperty({
    example: 1747094400000,
    description: '对比周期开始时间戳（ms）',
  })
  @IsInt({ message: '对比周期开始时间必须是整数' })
  compareStartAt: number;

  @ApiProperty({
    example: 1747126200000,
    description: '对比周期结束时间戳（ms）',
  })
  @IsInt({ message: '对比周期结束时间必须是整数' })
  compareEndAt: number;

  @ApiProperty({ example: 1747212600000, description: '接口生成时间戳（ms）' })
  @IsInt({ message: '生成时间必须是整数' })
  generatedAt: number;
}

export class DashboardHomeCapabilityDto {
  @ApiProperty({
    example: 'owner',
    description: '身份类型: owner/staff/sub_account',
  })
  @IsString()
  identityType: string;

  @ApiPropertyOptional({
    example: 'cashier',
    description: '子账号角色，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsString()
  subAccountRole?: string;

  @ApiPropertyOptional({
    example: '收银员',
    description: '子账号角色中文标识，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsString()
  subAccountRoleLabel?: string;

  @ApiProperty({
    example: ['additional', 'business-analysis', 'finance-center'],
    description: '允许访问的首页模块列表',
  })
  @IsArray({ message: '允许模块必须是数组' })
  @IsString({ each: true })
  allowedHomeModules: ProfitHomeModule[];

  @ApiProperty({
    example: ['store-settings'],
    description: '隐藏的首页模块列表',
  })
  @IsArray({ message: '隐藏模块必须是数组' })
  @IsString({ each: true })
  hiddenHomeModules: ProfitHomeModule[];

  @ApiProperty({
    example: true,
    description: '是否可以访问财务中心',
  })
  @IsBoolean()
  canViewFinance: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以访问营销中心',
  })
  @IsBoolean()
  canViewMarketing: boolean;

  @ApiProperty({
    example: false,
    description: '是否可以显示商品管理首页入口，不等同于 goods:view 接口权限',
  })
  @IsBoolean()
  canUseGoodsManagement: boolean;

  @ApiPropertyOptional({
    enum: StoreSubAccountStatus,
    example: StoreSubAccountStatus.active,
    description: '子账号状态，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsString()
  subAccountStatus?: StoreSubAccountStatus;

  @ApiPropertyOptional({
    example: true,
    description:
      '子账号是否已绑定岗位，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsBoolean()
  subAccountAssigned?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      '子账号是否允许访问首页，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsBoolean()
  canAccessHome?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      '子账号是否允许使用交班，仅当 identityType 为 sub_account 时有值',
  })
  @IsOptional()
  @IsBoolean()
  canUseHandover?: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以使用交班管理',
  })
  @IsBoolean()
  canUseHandoverManagement: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以使用空间管理',
  })
  @IsBoolean()
  canUseSpaceManagement: boolean;

  @ApiProperty({
    example: false,
    description: '是否可以访问门店设置',
  })
  @IsBoolean()
  canAccessStoreSettings: boolean;

  @ApiProperty({
    example: true,
    description: '是否可以访问首页概览接口',
  })
  @IsBoolean()
  canAccessDashboardOverview: boolean;
}

export class DashboardHomeOverviewResponseDto {
  @ApiProperty({ type: DashboardHomeStatsDto, description: '首页统计卡摘要' })
  @ValidateNested()
  @Type(() => DashboardHomeStatsDto)
  stats: DashboardHomeStatsDto;

  @ApiProperty({
    type: DashboardHomeSalesTrendDto,
    description: '首页销售趋势图数据',
  })
  @ValidateNested()
  @Type(() => DashboardHomeSalesTrendDto)
  salesTrend: DashboardHomeSalesTrendDto;

  @ApiProperty({
    type: [DashboardHomeActivityDto],
    description: '首页最新动态列表',
  })
  @IsArray({ message: '首页动态必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => DashboardHomeActivityDto)
  activities: DashboardHomeActivityDto[];

  @ApiProperty({ type: DashboardHomeMetaDto, description: '首页返回元信息' })
  @ValidateNested()
  @Type(() => DashboardHomeMetaDto)
  meta: DashboardHomeMetaDto;

  @ApiProperty({
    type: DashboardHomeCapabilityDto,
    description: '用户能力快照，用于前端动态展示首页模块',
  })
  @ValidateNested()
  @Type(() => DashboardHomeCapabilityDto)
  capability: DashboardHomeCapabilityDto;
}
