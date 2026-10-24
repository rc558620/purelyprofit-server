import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MARKETING_MAX_PAGE_SIZE } from '../../../purely-profit/marketing/marketing.utils';
import {
  CARE_RECORD_CONTENT_MAX_LENGTH,
  CARE_RECORD_MAX_PAGE,
  CARE_RECORD_MAX_PHOTOS,
} from '../../../purely-profit/operations/spaces/dto/space-care-record.dto';

/**
 * 会员端护理档案分页查询。
 *
 * 真分页（页码从 1 开始）：第 1 页即「最近一次护理」，翻页向更早回溯，
 * 与时间线自上而下的阅读顺序一致（与 B 端空间域护理档案同口径）。
 *
 * 入参解析与 B 端 `ListSpaceCareRecordsQueryDto` 保持同一套写法
 * （`@Type(() => Number)`）：`transformOptionalInt` 会用 parseInt 把 `1.9`
 * 静默截断成 1，让 `@IsInt` 形同虚设；B 端遇到 `1.9` 是 400，C 端不能是 200。
 */
export class ListClubCareRecordsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page 必须是整数' })
  @Min(1, { message: 'page 最小为 1' })
  @Max(CARE_RECORD_MAX_PAGE, { message: `page 最大为 ${CARE_RECORD_MAX_PAGE}` })
  page?: number;

  @ApiPropertyOptional({
    example: 10,
    description: '每页条数，默认 10，最大 200',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize 必须是整数' })
  @Min(1, { message: 'pageSize 最小为 1' })
  @Max(MARKETING_MAX_PAGE_SIZE, {
    message: `pageSize 最大为 ${MARKETING_MAX_PAGE_SIZE}`,
  })
  pageSize?: number;
}

/**
 * C 端（purelyClub）护理记录。
 *
 * 隐私红线：只暴露会员本人需要查看的护理内容。
 * **不得**包含 customerId、来源场次、操作人等任何商家内部字段。
 *
 * 注：本结构是出参契约，class-validator 注解不参与请求校验，
 * 仅用于满足项目 DTO 规范（Rule 5）并固化出参类型约定
 * ——结构与 `toClubCareRecordDto` 的白名单必须同步修改。
 */
export class ClubCareRecordDto {
  @ApiProperty({ example: '35', description: '护理记录 ID（字符串）' })
  @IsString()
  id: string;

  @ApiProperty({ example: 1, description: '第几次护理，1 起；1 即基线' })
  @IsInt()
  @Min(1)
  seq: number;

  @ApiProperty({
    example: 1761000000000,
    description: '护理发生时间（毫秒时间戳）',
  })
  @IsInt()
  visitAt: number;

  @ApiProperty({ example: '深层清洁、肩颈疏通', description: '护理项目名' })
  @IsString()
  serviceName: string;

  @ApiProperty({ example: 298, description: '本次消费金额，单位：元' })
  @IsNumber()
  amountYuan: number;

  @ApiProperty({ example: '本次做了深层清洁', description: '护理说明' })
  @IsString()
  @MaxLength(CARE_RECORD_CONTENT_MAX_LENGTH)
  content: string;

  @ApiProperty({
    type: [String],
    example: ['https://cdn.example.com/care/1.jpg'],
    description: '现场照片 URL 列表，保序',
  })
  @IsArray()
  @ArrayMaxSize(CARE_RECORD_MAX_PHOTOS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(1024, { each: true })
  photos: string[];

  @ApiPropertyOptional({ example: '李技师', description: '护理师姓名' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  technicianName?: string;
}

/**
 * 效果对比的首尾记录（「最早一次」与「最近一次」）。
 *
 * 只包含**已补录照片**的记录：对比区没有照片就没有可比性。
 * 分页后首屏只含最近若干条，最早一次往往不在第 1 页内，
 * 因此由后端单独下发，前端无需翻到底即可拿到首尾。
 */
export class ClubCareCompareRangeDto {
  @ApiProperty({
    type: ClubCareRecordDto,
    nullable: true,
    description: '最早一次已补录照片的护理（对比左侧默认值）',
  })
  earliest: ClubCareRecordDto | null;

  @ApiProperty({
    type: ClubCareRecordDto,
    nullable: true,
    description: '最近一次已补录照片的护理（对比右侧默认值）',
  })
  latest: ClubCareRecordDto | null;
}

/** 分页元信息（与营销域 / 空间域列表一致） */
export class ClubCarePaginationMetaDto {
  @ApiProperty({ example: 1, description: '当前页码' })
  page: number;

  @ApiProperty({ example: 10, description: '每页条数' })
  pageSize: number;

  @ApiProperty({ example: 36, description: '总条数' })
  total: number;

  @ApiProperty({ example: 4, description: '总页数' })
  totalPages: number;
}

export class ClubCareRecordsResponseDto {
  @ApiProperty({
    example: '技师',
    description:
      '门店服务人员称呼（技师/美容师/洗车工等）：C 端据此把「护理师」列名替换为门店在提成设置中配置的称呼',
  })
  @IsString({ message: '服务人员称呼必须是字符串' })
  technicianLabel: string;

  @ApiProperty({
    type: [ClubCareRecordDto],
    description:
      '护理记录时间线的当前页，按 visitAt 倒序（最近一次在前），翻页向更早回溯',
  })
  @IsArray()
  items: ClubCareRecordDto[];

  @ApiPropertyOptional({
    type: ClubCareCompareRangeDto,
    description:
      '效果对比的首尾记录（最早 / 最近一次有照片的护理）；仅第 1 页下发，后续翻页不重复计算',
  })
  compareRange?: ClubCareCompareRangeDto;

  @ApiProperty({ type: ClubCarePaginationMetaDto, description: '分页元信息' })
  meta: ClubCarePaginationMetaDto;
}
