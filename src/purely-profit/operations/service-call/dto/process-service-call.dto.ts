import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export const PROCESS_SERVICE_CALL_STATUSES = [
  'processing',
  'completed',
] as const;

export class ProcessServiceCallDto {
  @ApiProperty({
    enum: PROCESS_SERVICE_CALL_STATUSES,
    enumName: 'ProcessServiceCallStatus',
  })
  @IsEnum(PROCESS_SERVICE_CALL_STATUSES, {
    message: 'status 仅支持 processing 或 completed',
  })
  status: (typeof PROCESS_SERVICE_CALL_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 不能超过 200 个字符' })
  remark?: string;
}
