import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsString, ValidateNested } from 'class-validator';
import { StaffResponseDto } from './staff-response.dto';
import { StoreSeatSummaryDto } from './store-seat-summary.dto';

const STAFF_STATUS_VALUES = ['INVITED', 'ACTIVE', 'DISABLED'] as const;

type StaffStatus = (typeof STAFF_STATUS_VALUES)[number];

export class StaffActivationResponseDto {
  @ApiProperty({ enum: STAFF_STATUS_VALUES, description: '员工激活后的状态' })
  @IsIn(STAFF_STATUS_VALUES, { message: '员工激活后的状态不合法' })
  status: StaffStatus;

  @ApiProperty({
    example: '员工账号已激活，可登录系统',
    description: '激活结果说明',
  })
  @IsString({ message: '激活结果说明必须是字符串' })
  message: string;

  @ApiProperty({ type: StaffResponseDto, description: '员工信息' })
  @ValidateNested()
  @Type(() => StaffResponseDto)
  staff: StaffResponseDto;

  @ApiProperty({ type: StoreSeatSummaryDto, description: '门店账号席位概览' })
  @ValidateNested()
  @Type(() => StoreSeatSummaryDto)
  seatSummary: StoreSeatSummaryDto;
}
