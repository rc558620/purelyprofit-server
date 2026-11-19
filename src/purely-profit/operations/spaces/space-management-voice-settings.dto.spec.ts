// 空间管理语音开关 DTO 校验回归：全局开启 enableImplicitConversion 后，
// 字符串 "false" 会被隐式转成 true，null 会穿透校验并在 Prisma 层变成 500。
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateSpaceManagementVoiceSettingsDto } from './dto/update-space-management-voice-settings.dto';

/** 复刻全局 ValidationPipe 的转换 + 校验两步（transform: true + enableImplicitConversion）。 */
const transformAndValidate = async (
  payload: Record<string, unknown>,
): Promise<{
  errors: Awaited<ReturnType<typeof validate>>;
  dto: UpdateSpaceManagementVoiceSettingsDto;
}> => {
  const dto = plainToInstance(UpdateSpaceManagementVoiceSettingsDto, payload, {
    enableImplicitConversion: true,
  });
  const errors = await validate(dto);
  return { errors, dto };
};

describe('UpdateSpaceManagementVoiceSettingsDto', () => {
  it('接受布尔 false 并保持 false（不被隐式转换影响）', async () => {
    const { errors, dto } = await transformAndValidate({
      spaceManagementVoiceEnabled: false,
    });

    expect(errors).toHaveLength(0);
    expect(dto.spaceManagementVoiceEnabled).toBe(false);
  });

  it('接受布尔 true', async () => {
    const { errors, dto } = await transformAndValidate({
      spaceManagementVoiceEnabled: true,
    });

    expect(errors).toHaveLength(0);
    expect(dto.spaceManagementVoiceEnabled).toBe(true);
  });

  it('拒绝字符串 "false"（不得静默写成 true）', async () => {
    const { errors, dto } = await transformAndValidate({
      spaceManagementVoiceEnabled: 'false',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('spaceManagementVoiceEnabled');
    expect(dto.spaceManagementVoiceEnabled).toBe('false');
  });

  it('拒绝字符串 "true"（只接受 JSON 布尔）', async () => {
    const { errors } = await transformAndValidate({
      spaceManagementVoiceEnabled: 'true',
    });

    expect(errors).toHaveLength(1);
  });

  it('拒绝 null（不能穿透成 Prisma 500）', async () => {
    const { errors } = await transformAndValidate({
      spaceManagementVoiceEnabled: null,
    });

    expect(errors).toHaveLength(1);
  });

  it('空对象合法（支持部分更新）', async () => {
    const { errors, dto } = await transformAndValidate({});

    expect(errors).toHaveLength(0);
    expect(dto.spaceManagementVoiceEnabled).toBeUndefined();
  });
});
