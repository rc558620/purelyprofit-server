import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrintAgentRegistryService } from './print-agent-registry.service';
import type { PrintAgentRegisterResult } from './dto/scan-ordering-print-agent.dto';

/**
 * 打印代理绑定域：门店绑定码、代理注册令牌、绑定状态与版本查询。
 *
 * 只负责「门店 ↔ 代理」的持久化关系，不参与连接管理与任务路由，
 * 便于独立演进多设备登记等协议层能力。
 */
@Injectable()
export class PrintAgentBindingService {
  private readonly logger = new Logger('PrintAgentBinding');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PrintAgentRegistryService,
  ) {}

  /**
   * 商家端生成/重置门店绑定码。
   * 语义是「重置绑定」：旧绑定码、已登记设备与旧令牌必须一并作废，
   * 否则旧代理仍能凭已保存的 token 重连，前端提示的「重新生成会重置绑定」就不成立。
   */
  async generateBindCode(storeId: number): Promise<string> {
    const bindCode = this.randomBindCode();
    await this.prisma.$transaction([
      this.prisma.printAgent.deleteMany({ where: { storeId } }),
      this.prisma.store.update({
        where: { id: storeId },
        data: { printAgentBindCode: bindCode, printAgentToken: null },
      }),
    ]);
    // 已建立的在线连接也要断开，避免撤销后仍继续接收打印任务
    await this.registry.dropConnection(storeId);
    this.logger.log(`生成打印代理绑定码并撤销旧设备: storeId=${storeId}`);
    return bindCode;
  }

  /** 读取门店当前绑定码（未生成时返回 null）。 */
  async getBindCode(storeId: number): Promise<string | null> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { printAgentBindCode: true },
    });
    return store?.printAgentBindCode ?? null;
  }

  /** 打印代理注册：绑定码 → 代理令牌；携带 deviceId 时按门店+设备独立登记（多台电脑互不覆盖）。 */
  async register(
    bindCode: string,
    deviceId?: string,
    platform?: string,
    version?: string,
  ): Promise<PrintAgentRegisterResult> {
    const store = await this.prisma.store.findFirst({
      where: { printAgentBindCode: bindCode },
      select: { id: true, name: true },
    });
    if (!store) {
      throw new BadRequestException('绑定码无效，请检查后重新输入');
    }
    const token = randomBytes(32).toString('hex');
    if (deviceId) {
      // 多代理：同一门店多台电脑各持有独立 token，互不覆盖
      await this.prisma.printAgent.upsert({
        where: { storeId_deviceId: { storeId: store.id, deviceId } },
        create: { storeId: store.id, deviceId, token, platform, version },
        update: { token, platform, version },
      });
    } else {
      // 旧代理兼容：未上报 deviceId 时沿用门店单 token 逻辑
      await this.prisma.store.update({
        where: { id: store.id },
        data: { printAgentToken: token },
      });
    }
    this.logger.log(
      `打印代理注册成功: storeId=${store.id} deviceId=${deviceId ?? '-'} platform=${platform ?? '-'} version=${version ?? '-'}`,
    );
    return { token, storeId: store.id, storeName: store.name };
  }

  /** 查询门店是否已绑定代理（本地部署未绑定时走服务器本机打印）。
   *  多代理：存在任一设备登记或旧版单 token 即视为已绑定。 */
  async isBound(storeId: number): Promise<boolean> {
    const [agent, store] = await Promise.all([
      this.prisma.printAgent.findFirst({
        where: { storeId },
        select: { id: true },
      }),
      this.prisma.store.findUnique({
        where: { id: storeId },
        select: { printAgentToken: true },
      }),
    ]);
    return Boolean(agent) || Boolean(store?.printAgentToken);
  }

  /** 查询门店最近一次注册代理的版本号（用于商家端新旧版本对比提示）。 */
  async getLatestRegisteredVersion(storeId: number): Promise<string | null> {
    const agent = await this.prisma.printAgent.findFirst({
      where: { storeId, version: { not: null } },
      orderBy: { updatedAt: 'desc' },
      select: { version: true },
    });
    return agent?.version ?? null;
  }

  /** 生成 6 位大写字母数字绑定码（去掉易混淆字符 0/O/1/I）。 */
  private randomBindCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i += 1) {
      code += alphabet[randomInt(alphabet.length)];
    }
    return code;
  }
}
