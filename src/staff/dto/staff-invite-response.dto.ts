import { StaffStatus } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { StaffResponseDto } from './staff-response.dto';
import { StoreSeatSummaryDto } from './store-seat-summary.dto';

export class StaffInviteResponseDto {
  @ApiProperty({ enum: StaffStatus, description: '员工当前邀请状态' })
  @IsEnum(StaffStatus, { message: '员工当前邀请状态不合法' })
  status: StaffStatus;

  @ApiProperty({
    example: '员工已创建，待注册或激活后占用账号席位',
    description: '邀请结果说明',
  })
  @IsString({ message: '邀请结果说明必须是字符串' })
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
