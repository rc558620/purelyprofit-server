import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ScanOrderServiceCallStatus } from '@prisma/client';

export class ListScanOrderingServiceCallsDto {
  @ApiPropertyOptional({ enum: ScanOrderServiceCallStatus })
  @IsOptional()
  @IsEnum(ScanOrderServiceCallStatus, { message: 'status 不合法' })
  status?: ScanOrderServiceCallStatus;
}

export class ProcessScanOrderingServiceCallDto {
  @ApiProperty({ enum: ['acknowledged', 'resolved'] })
  @IsEnum(['acknowledged', 'resolved'], {
    message: 'status 仅支持 acknowledged 或 resolved',
  })
  status: 'acknowledged' | 'resolved';

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 不能超过 200 个字符' })
  remark?: string;
}
