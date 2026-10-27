import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 小程序下单 openid 解析服务。
 *
 * 前端目前不具备获取 openid 的能力，历史实现依赖「占位手机号反解」，
 * 仅在会员充值链路生效，且用户绑定真实手机号后即失效。
 * 这里统一改为按 userId 回查 users.wechat_openid：
 * - 账号已绑定 openid 时，一律以库内值为准，入参与之不一致则忽略并记录告警，
 *   避免「用他人 openid 发起支付」造成付款方混淆；
 * - 账号尚未绑定 openid 时才采用入参，为前端后续补齐 openid 透传留出升级通道；
 * - 未传入参则服务端回查，无需前端配合、无需发新版小程序。
 */
@Injectable()
export class ClubWechatOpenidService {
  private readonly logger = new Logger(ClubWechatOpenidService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveOpenid(
    userId: number,
    explicitOpenid?: string | null,
  ): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { wechatOpenid: true },
    });
    const stored = user?.wechatOpenid?.trim();
    const storedOpenid = stored && stored.length > 0 ? stored : null;

    const trimmed = explicitOpenid?.trim();
    if (!trimmed) {
      return storedOpenid;
    }

    // 显式传入的 openid 必须与账号已绑定的 openid 一致，否则以库内值为准。
    // 落账账户由服务端上下文决定，此处的风险是「用他人 openid 发起支付」，
    // 会造成付款方混淆与被代付骚扰，因此不接受不匹配的入参。
    if (storedOpenid && storedOpenid !== trimmed) {
      this.logger.warn(
        `用户 ${userId} 下单传入的 openid 与账号绑定值不一致，已忽略入参`,
      );
      return storedOpenid;
    }

    // 账号尚未绑定 openid 时保留入参，为前端后续补齐 openid 透传留出升级通道
    return storedOpenid ?? trimmed;
  }
}
