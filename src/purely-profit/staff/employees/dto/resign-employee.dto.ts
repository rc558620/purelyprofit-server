import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';

export class ResignEmployeeDto {
  @ApiPropertyOptional({
    example: 1742601600000,
    description: '离职时间戳（毫秒），不传则取当前时间',
  })
  @IsOptional()
  @IsInt({ message: '离职日期必须是整数时间戳' })
  resignDate?: number;

  @ApiPropertyOptional({ example: '个人原因', description: '离职原因' })
  @IsOptional()
  @IsString({ message: '离职原因必须是字符串' })
  resignReason?: string;
}
