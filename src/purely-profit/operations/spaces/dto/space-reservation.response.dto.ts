import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  SPACE_RESERVATION_STATUS_SWAGGER_DESCRIPTION,
  SPACE_RESERVATION_STATUS_VALUES,
  type SpaceReservationStatusValue,
} from '../spaces.constants';

export class SpaceReservationResponseDto {
  @ApiProperty({ example: '1', description: '预约 ID' })
  id: string;

  @ApiProperty({ example: '1', description: '空间 ID' })
  spaceId: string;

  @ApiProperty({ example: '张先生', description: '预约人姓名' })
  guestName: string;

  @ApiProperty({ example: '13800138000', description: '联系方式' })
  phone: string;

  @ApiProperty({
    example: 1760104800000,
    description: '预约开始时间戳（毫秒）',
  })
  reservedAt: number;

  @ApiPropertyOptional({
    example: 1760108400000,
    description: '预约结束时间戳（毫秒）',
  })
  reservedEndAt?: number;

  @ApiPropertyOptional({ example: 4, description: '预约人数' })
  guestCount?: number;

  @ApiPropertyOptional({ example: '生日聚会', description: '备注' })
  note?: string;

  @ApiProperty({
    example: 'pending',
    description: `预约状态。${SPACE_RESERVATION_STATUS_SWAGGER_DESCRIPTION}`,
    enum: SPACE_RESERVATION_STATUS_VALUES,
  })
  status: SpaceReservationStatusValue;

  @ApiProperty({ example: 1760097600000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiPropertyOptional({
    example: true,
    description:
      '预约开始时间是否已过（reservedAt <= 当前时间），过时后 UI 展示为"已过时"，不再参与新增预约冲突校验',
  })
  isOverdue?: boolean;
}
