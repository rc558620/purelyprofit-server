import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  SPACE_STATUS_VALUES,
  type SpaceStatusValue,
} from '../spaces.constants';

export class ListSpacesQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: 'idle', description: '空间状态筛选' })
  @IsOptional()
  @IsIn(SPACE_STATUS_VALUES, { message: '空间状态不合法' })
  status?: SpaceStatusValue;

  @ApiPropertyOptional({ example: '包间', description: '空间类型筛选' })
  @IsOptional()
  @IsString({ message: '空间类型必须是字符串' })
  @MaxLength(20, { message: '空间类型最长 20 个字符' })
  type?: string;

  @ApiPropertyOptional({ example: '1楼', description: '空间区域筛选' })
  @IsOptional()
  @IsString({ message: '空间区域必须是字符串' })
  @MaxLength(20, { message: '空间区域最长 20 个字符' })
  zone?: string;
}

export class GetSpacesDashboardQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}
