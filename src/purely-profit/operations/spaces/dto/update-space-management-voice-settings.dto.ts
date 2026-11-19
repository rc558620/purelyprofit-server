import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';

/** 更新空间管理语音播报配置（支持部分更新：只更新传入的字段）。 */
export class UpdateSpaceManagementVoiceSettingsDto {
  @ApiPropertyOptional({
    type: Boolean,
    description: '空间管理语音播报开关（默认关闭）',
  })
  /**
   * 全局 ValidationPipe 开启了 enableImplicitConversion，class-transformer 对
   * Boolean 反射类型执行 `Boolean(value)`：字符串 "false" 会被转成 true
   * （Boolean('false') === true），@IsBoolean 校验的是转换后的值，
   * 于是 HTTP 直接传 "false" 会 200 并把门店开关写成 true。
   *
   * @Transform 在隐式转换之后执行，但其 obj 参数仍是被转换前的那份 plain 对象，
   * 因此这里取回请求原文交给 @IsBoolean 严格校验：只接受布尔 true / false。
   */
  @Transform(
    ({ obj }: TransformFnParams) =>
      (obj as Record<string, unknown>).spaceManagementVoiceEnabled,
    { toClassOnly: true },
  )
  /**
   * 只跳过 undefined，不用 @IsOptional()：@IsOptional() 会连 null 一起放行，
   * null 落到 Prisma 的非空 Boolean 字段会抛异常，最终被全局过滤器兜成 500。
   */
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsBoolean({ message: 'spaceManagementVoiceEnabled 必须是布尔值' })
  spaceManagementVoiceEnabled?: boolean;
}
