import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';

function trimStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateAvatarDto {
  @ApiProperty({
    example: 'data:image/png;base64,...',
    description: '头像地址或 base64 数据，传空串表示清空头像',
  })
  @Transform(({ value }: { value: unknown }) => trimStringValue(value))
  @IsString({ message: '头像必须是字符串' })
  avatar: string;
}
