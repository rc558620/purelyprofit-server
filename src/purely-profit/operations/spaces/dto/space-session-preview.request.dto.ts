import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RenewPreviewRequestDto {
  @ApiProperty({ example: 30, description: '续费金额（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '续费金额必须是数字' })
  @Min(0.01, { message: '续费金额必须大于 0' })
  amount: number;

  @ApiPropertyOptional({
    example: 100,
    description: '团购券面金额（元），团购续费预览时传入',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '券面金额必须是数字' })
  @Min(0.01, { message: '券面金额必须大于 0' })
  voucherFaceAmount?: number;

  /** P3a fix: 团购场景下预览也应校验券码/平台必填，与实际续费口径一致 */
  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  @IsOptional()
  @IsString({ message: '团购券码必须是字符串' })
  @MaxLength(50, { message: '团购券码最长 50 个字符' })
  grouponCode?: string;

  @ApiPropertyOptional({ example: 'meituan', description: '团购平台' })
  @IsOptional()
  @IsString({ message: '团购平台必须是字符串' })
  @MaxLength(50, { message: '团购平台最长 50 个字符' })
  grouponPlatform?: string;
}
