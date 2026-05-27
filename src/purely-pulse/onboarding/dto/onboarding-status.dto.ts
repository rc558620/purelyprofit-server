import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * 目标商家基础状态步骤。
 *
 * 当前字段名仍兼容旧 onboarding 语义，Step 1 仅统一解释口径，不调整返回结构。
 */
export class OnboardingStepsDto {
  @ApiProperty({
    example: true,
    description:
      '兼容字段：当前观察链路可用时恒为 true，建议迁移到 targetStatus',
    deprecated: true,
  })
  @IsBoolean()
  hasRegistered: boolean;

  @ApiProperty({
    example: false,
    description:
      '兼容字段：目标商家主体资料是否完整，建议迁移到 targetStatus.merchantVerified',
    deprecated: true,
  })
  @IsBoolean()
  hasVerifiedRealName: boolean;

  @ApiProperty({
    example: false,
    description:
      '兼容字段：是否已选定目标商家门店，建议迁移到 targetStatus.storeSelected',
    deprecated: true,
  })
  @IsBoolean()
  hasCreatedStore: boolean;

  @ApiProperty({
    example: false,
    description:
      '兼容字段：目标商家是否已开通平台订阅能力，建议迁移到 targetStatus.membershipActive',
    deprecated: true,
  })
  @IsBoolean()
  hasMembership: boolean;
}

/**
 * GET /pulse/onboarding/status 响应 DTO。
 *
 * 当前同时返回新的 targetStatus 字段与旧 onboarding 兼容字段，
 * 用于平滑收口到更明确的目标商家状态模型。
 */
export class OnboardingTargetStatusDto {
  @ApiProperty({
    example: false,
    description: '新字段：目标商家基础条件是否已齐备',
  })
  @IsBoolean()
  isReady: boolean;

  @ApiProperty({
    example: false,
    description: '新字段：是否已选定目标商家门店',
  })
  @IsBoolean()
  storeSelected: boolean;

  @ApiProperty({
    example: false,
    description: '新字段：目标商家主体资料是否完整',
  })
  @IsBoolean()
  merchantVerified: boolean;

  @ApiProperty({
    example: false,
    description: '新字段：目标商家是否处于有效平台订阅状态',
  })
  @IsBoolean()
  membershipActive: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: '新字段：当前选中的目标商家门店 ID，未选定观察对象时为 null',
  })
  @IsOptional()
  @IsInt()
  storeId: number | null;

  @ApiPropertyOptional({
    example: '示例咖啡店',
    description: '新字段：当前选中的目标商家门店名称，未选定观察对象时为 null',
  })
  @IsOptional()
  @IsString()
  storeName: string | null;
}

export class OnboardingStatusResponseDto {
  @ApiProperty({
    example: false,
    description:
      '兼容字段：目标商家基础条件是否已齐备，建议迁移到 targetStatus.isReady',
    deprecated: true,
  })
  @IsBoolean()
  isCompleted: boolean;

  @ApiProperty({
    type: OnboardingStepsDto,
    description: '目标商家基础状态步骤的兼容字段集合',
  })
  steps: OnboardingStepsDto;

  @ApiProperty({
    type: OnboardingTargetStatusDto,
    description: '新字段：按目标商家视角表达的基础状态',
  })
  targetStatus: OnboardingTargetStatusDto;

  @ApiPropertyOptional({
    example: 1,
    description:
      '兼容字段：当前选中的目标商家门店 ID，建议迁移到 targetStatus.storeId',
    deprecated: true,
  })
  @IsOptional()
  @IsInt()
  storeId: number | null;

  @ApiPropertyOptional({
    example: '示例咖啡店',
    description:
      '兼容字段：当前选中的目标商家门店名称，建议迁移到 targetStatus.storeName',
    deprecated: true,
  })
  @IsOptional()
  @IsString()
  storeName: string | null;
}
