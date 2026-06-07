import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  SPACE_RESERVATION_STATUS_SWAGGER_DESCRIPTION,
  SPACE_RESERVATION_STATUS_VALUES,
  type SpaceReservationStatusValue,
} from '../spaces.constants';

export class ListSpaceReservationsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: 'pending',
    description: `预约状态筛选。${SPACE_RESERVATION_STATUS_SWAGGER_DESCRIPTION}。未传时后端默认只返回 pending，不会返回 fulfilled 和 cancelled；如需查看其他状态，请显式传对应 status。`,
    enum: SPACE_RESERVATION_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_RESERVATION_STATUS_VALUES, { message: '预约状态不合法' })
  status?: SpaceReservationStatusValue;

  @ApiPropertyOptional({
    example: 1760054400000,
    description: '按预约开始时间过滤：区间起始时间戳（毫秒，含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间起始时间必须是整数时间戳' })
  @Min(0, { message: '区间起始时间不合法' })
  dateFrom?: number;

  @ApiPropertyOptional({
    example: 1760140799999,
    description: '按预约开始时间过滤：区间结束时间戳（毫秒，含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  dateTo?: number;
}
