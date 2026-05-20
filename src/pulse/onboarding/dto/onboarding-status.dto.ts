import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

/**
 * 入驻各步骤完成状态
 */
export class OnboardingStepsDto {
  @ApiProperty({
    example: true,
    description: '是否已注册账号（调用此接口即表示已注册）',
  })
  @IsBoolean()
  hasRegistered: boolean;

  @ApiProperty({ example: false, description: '是否已完成实名认证' })
  @IsBoolean()
  hasVerifiedRealName: boolean;

  @ApiProperty({ example: false, description: '是否已创建门店' })
  @IsBoolean()
  hasCreatedStore: boolean;

  @ApiProperty({ example: false, description: '是否已开通平台会员' })
  @IsBoolean()
  hasMembership: boolean;
}

/**
 * GET /pulse/onboarding/status 响应 DTO
 */
export class OnboardingStatusResponseDto {
  @ApiProperty({ example: false, description: '是否已完成全部入驻步骤' })
  @IsBoolean()
  isCompleted: boolean;

  @ApiProperty({ type: OnboardingStepsDto, description: '各入驻步骤完成状态' })
  steps: OnboardingStepsDto;

  @ApiPropertyOptional({
    example: 1,
    description: '当前门店 ID，未创建门店时为 null',
  })
  @IsOptional()
  @IsInt()
  storeId: number | null;

  @ApiPropertyOptional({
    example: '我的咖啡店',
    description: '当前门店名称，未创建门店时为 null',
  })
  @IsOptional()
  @IsString()
  storeName: string | null;
}
