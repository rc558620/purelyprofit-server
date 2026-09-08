import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class SelfOrderingMenuQueryDto {
  @ApiProperty({ description: '空间会话 ID；来自 resolve-space 返回值' })
  @Type(() => Number)
  @IsInt({ message: 'sessionId 必须是整数' })
  @Min(1, { message: 'sessionId 不合法' })
  sessionId: number;
}
