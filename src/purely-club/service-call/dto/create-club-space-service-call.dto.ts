import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ServiceCallType } from '@prisma/client';

export class CreateClubSpaceServiceCallDto {
  @ApiProperty({
    description: '空间二维码中的稳定令牌',
    minLength: 1,
    maxLength: 64,
  })
  @IsString({ message: 'spaceToken 必须是字符串' })
  @MaxLength(64, { message: 'spaceToken 不合法' })
  spaceToken: string;

  @ApiProperty({ enum: ServiceCallType, description: '服务呼叫类型' })
  @IsEnum(ServiceCallType, { message: 'type 不受支持' })
  type: ServiceCallType;

  @ApiPropertyOptional({ description: '顾客补充说明', maxLength: 200 })
  @IsOptional()
  @IsString({ message: 'remark 必须是字符串' })
  @MaxLength(200, { message: 'remark 不能超过 200 个字符' })
  remark?: string;
}
