import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CLUB_MEMBER_LEVEL_VALUES,
  type ClubMemberLevelValue,
} from '../../../../purely-club/member/dto/club-member-account.dto';
import {
  MARKETING_CUSTOMER_STATUS_VALUES,
  MARKETING_CUSTOMER_TIER_VALUES,
  MARKETING_MAX_PAGE_SIZE,
  type MarketingCustomerTierValue,
} from '../../../marketing/marketing.utils';

/** 护理档案管理端顾客列表状态筛选：all 表示不按活跃状态过滤 */
export const SPACE_CARE_CUSTOMER_STATUS_VALUES = [
  'all',
  ...MARKETING_CUSTOMER_STATUS_VALUES,
] as const;
export type SpaceCareCustomerStatusValue =
  (typeof SPACE_CARE_CUSTOMER_STATUS_VALUES)[number];

/** 单条护理记录最多可补录的照片数量（与前端相册选择器上限对齐） */
export const CARE_RECORD_MAX_PHOTOS = 9;

/** 护理说明最大长度，与 DB VARCHAR(500) 对齐 */
export const CARE_RECORD_CONTENT_MAX_LENGTH = 500;

/**
 * 页码上限：深翻页会退化成「跳过千万行再取 10 行」，是廉价的放大攻击面。
 *
 * 单顾客护理记录数远达不到该上限（1000 × 默认 10 = 1 万条），
 * 正常交互永远触不到；B/C 两端护理档案查询共用此值。
 * service 层的 `resolveMarketingPagination` 只做下限归一，上限由这里拦。
 */
export const CARE_RECORD_MAX_PAGE = 1000;

export class ListSpaceCareCustomersQueryDto {
  @ApiPropertyOptional({
    enum: SPACE_CARE_CUSTOMER_STATUS_VALUES,
    description:
      '顾客活跃状态筛选：all=全部 new=新客 active=活跃 dormant=沉睡 lost=流失',
  })
  @IsOptional()
  @IsString()
  @IsIn(SPACE_CARE_CUSTOMER_STATUS_VALUES)
  status?: SpaceCareCustomerStatusValue;

  @ApiPropertyOptional({
    example: '张',
    description: '顾客昵称关键字（模糊匹配）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({
    example: '138',
    description: '手机号关键字（前缀匹配）',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, description: '每页条数，上限 200' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MARKETING_MAX_PAGE_SIZE)
  pageSize?: number;

  @ApiPropertyOptional({
    example: 18,
    description: '门店 ID；不传时取当前登录者默认可管理门店',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  storeId?: number;
}

/**
 * 护理记录时间线的分页查询。
 *
 * 真分页：页码从 1 开始，第 1 页即「最近一次护理」，翻页向更早回溯，
 * 与前端时间线自上而下的阅读顺序一致。
 */
export class ListSpaceCareRecordsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CARE_RECORD_MAX_PAGE)
  page?: number;

  @ApiPropertyOptional({ example: 10, description: '每页条数，上限 200' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MARKETING_MAX_PAGE_SIZE)
  pageSize?: number;
}

export class UpdateSpaceCareRecordDto {
  @ApiProperty({
    example: '本次做了深层清洁，建议一周后复诊',
    description: '商家补录的护理说明',
  })
  @IsString()
  @MaxLength(CARE_RECORD_CONTENT_MAX_LENGTH)
  content: string;

  @ApiProperty({
    type: [String],
    example: ['https://cdn.example.com/care/1.jpg'],
    description:
      '现场照片 URL 列表（来自 POST /upload/image 返回的 url，保序；每项不得为空串）',
  })
  @IsArray()
  @ArrayMaxSize(CARE_RECORD_MAX_PHOTOS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(1024, { each: true })
  photos: string[];
}

/** 通用分页元信息（与营销域列表一致） */
export class SpaceCarePaginationMetaDto {
  @ApiProperty({ example: 1, description: '当前页码' })
  page: number;

  @ApiProperty({ example: 10, description: '每页条数' })
  pageSize: number;

  @ApiProperty({ example: 36, description: '总条数' })
  total: number;

  @ApiProperty({ example: 4, description: '总页数' })
  totalPages: number;
}

/** 护理档案列表中的顾客（字段与营销域顾客完全对齐，便于前端复用卡片与英雄卡） */
export class SpaceCareCustomerDto {
  @ApiProperty({ example: '12', description: '顾客 ID（字符串）' })
  id: string;

  @ApiProperty({ example: '张三', description: '顾客昵称' })
  name: string;

  @ApiProperty({
    example: '13800000001',
    description: '手机号；无手机号时为空串',
  })
  phone: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg' })
  avatar?: string;

  @ApiProperty({
    enum: MARKETING_CUSTOMER_TIER_VALUES,
    description: '会员等级（regular < gold < diamond）',
  })
  tier: MarketingCustomerTierValue;

  @ApiPropertyOptional({
    example: 'diamond',
    enum: CLUB_MEMBER_LEVEL_VALUES,
    description:
      '对齐 purely-club 当前会员等级；未开通 purely-club 会员时不返回（前端优先展示该等级）',
  })
  clubLevel?: ClubMemberLevelValue;

  @ApiPropertyOptional({
    example: '钻石会员',
    description:
      '对齐 purely-club 当前会员等级名称；未开通 purely-club 会员时不返回（前端优先展示该等级）',
  })
  clubLevelLabel?: string;

  @ApiProperty({ example: 500, description: '储值余额，单位：元' })
  balance: number;

  @ApiProperty({ example: 320, description: '积分余额' })
  points: number;

  @ApiProperty({ example: 1580, description: '累计消费金额，单位：元' })
  totalSpent: number;

  @ApiProperty({ example: 12, description: '消费次数' })
  visitCount: number;

  @ApiProperty({
    example: 1714000000000,
    description: '注册时间（毫秒时间戳）',
  })
  registeredAt: number;

  @ApiPropertyOptional({
    example: 1714700000000,
    description: '最后消费时间（毫秒时间戳）；null 表示从未消费',
  })
  lastVisitAt: number | null;

  @ApiPropertyOptional({ example: 'VIP 老顾客', description: '商家备注' })
  remark?: string;
}

/**
 * 护理档案详情里的顾客摘要。
 *
 * 只给详情页标题（如「纯利会员4010护理档案」）用：完整顾客档案与账户概览
 * 仍归营销域「顾客详情」，这里刻意不带余额 / 积分 / 消费统计。
 */
export class SpaceCareCustomerSummaryDto {
  @ApiProperty({ example: '12', description: '顾客 ID（字符串）' })
  id: string;

  @ApiProperty({ example: '纯利会员4010', description: '顾客昵称' })
  name: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.jpg' })
  avatar?: string;
}

/** 单条护理记录（B 端全字段） */
export class SpaceCareRecordDto {
  @ApiProperty({ example: '35', description: '护理记录 ID（字符串）' })
  id: string;

  @ApiProperty({ example: '12', description: '所属顾客 ID（字符串）' })
  customerId: string;

  @ApiProperty({ example: 1, description: '第几次护理，1 起；1 即基线' })
  seq: number;

  @ApiProperty({
    example: 1761000000000,
    description: '护理发生时间（毫秒时间戳）',
  })
  visitAt: number;

  @ApiProperty({
    example: '深层清洁、肩颈疏通',
    description: '护理项目名快照（只读）',
  })
  serviceName: string;

  @ApiProperty({
    example: 298,
    description: '本次消费金额，单位：元（只读快照）',
  })
  amountYuan: number;

  @ApiProperty({
    example: '本次做了深层清洁',
    description: '商家补录的护理说明',
  })
  content: string;

  @ApiProperty({
    type: [String],
    example: ['https://cdn.example.com/care/1.jpg'],
    description: '现场照片 URL 列表，保序',
  })
  photos: string[];

  @ApiPropertyOptional({
    example: '李技师',
    description: '护理师姓名快照（只读）',
  })
  technicianName?: string;

  @ApiProperty({
    example: 1761003600000,
    description: '最后更新时间（毫秒时间戳）',
  })
  updatedAt: number;
}

export class SpaceCareCustomerListResponseDto {
  @ApiProperty({ type: [SpaceCareCustomerDto], description: '顾客列表' })
  items: SpaceCareCustomerDto[];

  @ApiProperty({ type: SpaceCarePaginationMetaDto, description: '分页元信息' })
  meta: SpaceCarePaginationMetaDto;
}

/**
 * 效果对比的首尾记录（「最早一次」与「最近一次」）。
 *
 * 只返回**已补录照片**的记录：对比区没有照片就没有可比性，
 * 把无照片的首尾记录塞进下拉只会出现两个空图占位。
 * 由详情接口一并返回，避免前端为拿首尾多打一次请求。
 *
 * 注意：取的是「最早 / 最近一条**有照片**的护理」，不是 `seq=1` 的基线
 * （seq=1 那条若没补照片会被跳过）。
 */
export class SpaceCareCompareRangeDto {
  @ApiProperty({
    type: SpaceCareRecordDto,
    nullable: true,
    description: '最早一次已补录照片的护理（对比左侧默认值）',
  })
  earliest: SpaceCareRecordDto | null;

  @ApiProperty({
    type: SpaceCareRecordDto,
    nullable: true,
    description: '最近一次已补录照片的护理（对比右侧默认值）',
  })
  latest: SpaceCareRecordDto | null;
}

export class SpaceCareRecordDetailResponseDto {
  @ApiPropertyOptional({
    type: SpaceCareCustomerSummaryDto,
    description:
      '档案所属顾客摘要（仅 id / 昵称 / 头像，供详情页标题展示）；仅第 1 页下发',
  })
  customer?: SpaceCareCustomerSummaryDto;

  @ApiProperty({
    type: [SpaceCareRecordDto],
    description:
      '护理记录时间线的当前页，按 visitAt 倒序（最近一次在前），翻页向更早回溯',
  })
  items: SpaceCareRecordDto[];

  @ApiPropertyOptional({
    type: SpaceCareCompareRangeDto,
    description:
      '效果对比的首尾记录（最早 / 最近一次有照片的护理）；仅第 1 页下发，翻页不再重复计算（前端沿用首屏结果）',
  })
  compareRange?: SpaceCareCompareRangeDto;

  @ApiProperty({ type: SpaceCarePaginationMetaDto, description: '分页元信息' })
  meta: SpaceCarePaginationMetaDto;
}

/** 护理记录时间线单页响应（详情首屏之后的翻页只取记录，不再重复查顾客档案） */
export class SpaceCareRecordListResponseDto {
  @ApiProperty({ type: [SpaceCareRecordDto], description: '护理记录当前页' })
  items: SpaceCareRecordDto[];

  @ApiProperty({ type: SpaceCarePaginationMetaDto, description: '分页元信息' })
  meta: SpaceCarePaginationMetaDto;
}
