import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 小程序下单 openid 解析服务。
 *
 * 前端目前不具备获取 openid 的能力，历史实现依赖「占位手机号反解」，
 * 仅在会员充值链路生效，且用户绑定真实手机号后即失效。
 * 这里统一改为按 userId 回查 users.wechat_openid：
 * - 显式传入的 openid 优先（保留前端未来补齐 openid 透传后的升级通道）
 * - 未传则服务端回查，无需前端配合、无需发新版小程序
 */
@Injectable()
export class ClubWechatOpenidService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveOpenid(
    userId: number,
    explicitOpenid?: string | null,
  ): Promise<string | null> {
    const trimmed = explicitOpenid?.trim();
    if (trimmed) {
      return trimmed;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { wechatOpenid: true },
    });
    const stored = user?.wechatOpenid?.trim();
    return stored && stored.length > 0 ? stored : null;
  }
}
