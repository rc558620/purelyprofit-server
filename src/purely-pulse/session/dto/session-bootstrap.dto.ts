import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString } from 'class-validator';

// ──────────────────────────────────────────────
// 子 DTO：用户摘要
// ──────────────────────────────────────────────

export class PulseSessionUserDto {
  @ApiProperty({ example: 1, description: '用户 ID' })
  @IsInt()
  id: number;

  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString()
  phone: string;

  @ApiPropertyOptional({
    example: '开发者 A',
    description: '当前登录账号昵称，未设置时为 null',
  })
  @IsOptional()
  @IsString()
  name: string | null;

  @ApiProperty({ example: '', description: '头像地址，未设置时为空串' })
  @IsString()
  avatar: string;

  @ApiProperty({ example: false, description: '是否已完成实名认证' })
  @IsBoolean()
  verified: boolean;
}

// ──────────────────────────────────────────────
// 子 DTO：门店摘要
// ──────────────────────────────────────────────

export class PulseSessionStoreDto {
  @ApiProperty({ example: 1, description: '门店 ID' })
  @IsInt()
  id: number;

  @ApiProperty({ example: '示例咖啡店', description: '当前目标门店名称' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: '北京市朝阳区',
    description: '地址，未设置时为 null',
  })
  @IsOptional()
  @IsString()
  address: string | null;
}

// ──────────────────────────────────────────────
// 子 DTO：会员状态摘要
// ──────────────────────────────────────────────

export class PulseSessionMembershipDto {
  @ApiProperty({ example: false, description: '目标商家是否处于有效订阅状态' })
  @IsBoolean()
  isActive: boolean;

  @ApiPropertyOptional({
    example: 'monthly',
    description:
      '目标商家当前套餐 ID（monthly / quarterly / yearly），未开通时为 null',
  })
  @IsOptional()
  @IsString()
  planId: string | null;

  @ApiPropertyOptional({
    example: '季度会员',
    description: '目标商家当前套餐名称，未开通时为 null',
  })
  @IsOptional()
  @IsString()
  planName: string | null;

  @ApiPropertyOptional({
    example: 30,
    description: '目标商家订阅剩余天数（已到期或未开通时为 0）',
  })
  @IsOptional()
  @IsInt()
  remainingDays: number;

  @ApiPropertyOptional({
    example: '2026-08-20T00:00:00.000Z',
    description: '目标商家订阅到期时间，未开通时为 null',
  })
  @IsOptional()
  expiresAt: Date | null;
}

// ──────────────────────────────────────────────
// 根响应 DTO
// ──────────────────────────────────────────────

export class PulseSessionBootstrapResponseDto {
  @ApiProperty({
    example: 'normal',
    enum: ['normal', 'developer'],
    description: '当前会话模式，开发者账号返回 developer',
  })
  @IsString()
  @IsIn(['normal', 'developer'])
  mode: 'normal' | 'developer';

  @ApiProperty({ type: PulseSessionUserDto, description: '当前登录开发者摘要' })
  user: PulseSessionUserDto;

  @ApiPropertyOptional({
    type: PulseSessionStoreDto,
    description: '当前选中的目标商家门店摘要，未选定观察对象时为 null',
  })
  @IsOptional()
  store: PulseSessionStoreDto | null;

  @ApiProperty({
    type: PulseSessionMembershipDto,
    description: '当前目标商家的平台订阅状态摘要',
  })
  membership: PulseSessionMembershipDto;

  @ApiProperty({ example: 0, description: '当前目标商家相关提醒总数' })
  @IsInt()
  unreadNotificationCount: number;

  @ApiProperty({
    example: false,
    description: '新字段：是否已选定目标商家门店',
  })
  @IsBoolean()
  targetStoreSelected: boolean;

  @ApiProperty({
    example: false,
    description:
      '兼容字段：是否已选定目标商家门店，建议迁移到 targetStoreSelected',
    deprecated: true,
  })
  @IsBoolean()
  hasOnboarded: boolean;
}

// ──────────────────────────────────────────────
// PATCH /pulse/session/current-store 请求 DTO
// ──────────────────────────────────────────────

export class PulseSwitchCurrentStoreDto {
  @ApiProperty({ example: 1, description: '目标商家门店 ID' })
  @IsInt()
  storeId: number;
}

// ──────────────────────────────────────────────
// PATCH /pulse/session/current-store 响应 DTO
// ──────────────────────────────────────────────

export class PulseSwitchCurrentStoreResponseDto {
  @ApiProperty({ example: true, description: '切换是否成功' })
  @IsBoolean()
  success: boolean;

  @ApiProperty({
    type: PulseSessionStoreDto,
    description: '切换后的当前目标商家门店摘要',
  })
  store: PulseSessionStoreDto;
}
