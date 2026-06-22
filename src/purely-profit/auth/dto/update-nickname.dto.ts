import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

function trimStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateNicknameDto {
  @ApiProperty({
    example: '张三',
    description: '新昵称，去除首尾空格后最大长度 20 个字符',
  })
  @Transform(({ value }: { value: unknown }) => trimStringValue(value))
  @IsString({ message: '昵称必须是字符串' })
  @IsNotEmpty({ message: '昵称不能为空' })
  @MaxLength(20, { message: '昵称长度不能超过 20 个字符' })
  name: string;
}
