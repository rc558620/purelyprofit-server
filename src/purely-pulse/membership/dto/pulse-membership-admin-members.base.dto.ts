// Pulse / 管理端会员操作请求体的公共字段组基类
//
// 多个会员操作请求体重复出现的字段集中到这里，由
// pulse-membership-admin-members.*.request.dto.ts 的具体 DTO 继承。
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { toOptionalInt } from './pulse-membership-admin-members.transform';

/**
 * 会员标识兼容字段组
 *
 * purelyPulse 前端早期把会员 ID 放在请求体里（`memberId` / `id`），后期统一到
 * `:id` 路径参数；三个字段同时保留做兜底，谁传都能落到同一条会员记录上。
 */
export class PulseAdminMemberIdentityFieldsDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;
}

/**
 * 成交子账号数量（0~10）
 *
 * 在 {@link PulseAdminMemberIdentityFieldsDto} 之上叠加子账号数量：凡是报子账号
 * 数量的接口都要带会员标识，这里直接继承，省得每个 DTO 写两层。
 * 加价 `subAccountAmountDisplay` 的空串语义各接口不同（清空回退 / 非法），
 * 因此只把数量抽到基类。
 */
export class PulseAdminMemberSubAccountDealFieldsDto extends PulseAdminMemberIdentityFieldsDto {
  @ApiPropertyOptional({
    example: 3,
    description: '本次成交包含的子账号数量，范围 0~10',
  })
  @IsOptional()
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountDealFieldsDto) =>
      dto.subAccountCount !== undefined,
  )
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt({ message: '子账号数量必须是整数' })
  @Min(0, { message: '子账号数量不能小于 0' })
  @Max(10, { message: '子账号数量不能超过 10' })
  subAccountCount?: number;
}
