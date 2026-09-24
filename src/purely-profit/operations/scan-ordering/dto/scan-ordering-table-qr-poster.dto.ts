import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  TABLE_QR_POSTER_SLOGAN_MAX_LENGTH,
  TABLE_QR_POSTER_THEMES,
} from '../scan-ordering-table-qr-poster.service';

/** 更新扫码点餐桌码海报配置（支持部分更新：只更新传入字段）。 */
export class UpdateTableQrPosterConfigDto {
  @ApiPropertyOptional({
    example: 'lime',
    description: '海报主题色：lime / forest / ink / amber',
  })
  @IsOptional()
  @IsIn([...TABLE_QR_POSTER_THEMES], { message: '海报主题色取值非法' })
  theme?: string;

  @ApiPropertyOptional({
    example: '扫码点餐 · 下单免等待',
    description: '海报标语（二维码下方短句）',
  })
  @IsOptional()
  @IsString({ message: '海报标语必须是字符串' })
  @MaxLength(TABLE_QR_POSTER_SLOGAN_MAX_LENGTH, {
    message: `海报标语不能超过 ${TABLE_QR_POSTER_SLOGAN_MAX_LENGTH} 个字符`,
  })
  slogan?: string;

  @ApiPropertyOptional({
    example: true,
    description: '是否展示门店 Logo（加载失败回退品牌图标）',
  })
  @IsOptional()
  @IsBoolean({ message: 'showStoreLogo 必须是布尔值' })
  showStoreLogo?: boolean;
}
