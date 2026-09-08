import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from '../stores/club-current-store-context.service';
import { ResolveSpaceDto } from './dto/resolve-space.dto';
import { assertGeneralStoreForSelfOrdering } from './club-self-ordering.utils';

/** 自助下单空间解析结果：菜单查询与下单均以此会话为归属基准 */
export interface ResolvedSpace {
  /** 空间当前进行中的会话 ID */
  sessionId: number;
  /** 空间 ID */
  spaceId: number;
  /** 空间展示名（有区域时形如「区域 · 名称」） */
  spaceName: string;
  /** 门店 ID */
  storeId: number;
}

@Injectable()
export class ClubSelfOrderingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  /**
   * 解析空间二维码，定位该空间当前进行中的会话
   *
   * 会话是后续菜单查询与下单的归属基准，因此未开台时直接拒绝进入自助下单，
   * 避免产生无归属的订单。
   */
  async resolveSpace(
    user: AuthenticatedUser,
    dto: ResolveSpaceDto,
  ): Promise<ResolvedSpace> {
    const qrCode = await this.resolveActiveSpaceQrCode(dto.spaceToken);
    const currentContext =
      await this.currentStoreContextService.requireCurrentContext(user);

    // 自助下单面向非餐饮业态；餐饮门店走既有的扫码点餐链路
    assertGeneralStoreForSelfOrdering(currentContext.store);
    if (qrCode.storeId !== currentContext.store.id) {
      throw new ForbiddenException('该二维码不属于当前门店');
    }

    const session = await this.prisma.spaceSession.findFirst({
      where: { spaceId: qrCode.space.id, status: 'active' },
      orderBy: { startTime: 'desc' },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException('当前空间未开台，请联系工作人员');
    }

    return {
      sessionId: session.id,
      spaceId: qrCode.space.id,
      spaceName: qrCode.space.zone
        ? `${qrCode.space.zone.name} · ${qrCode.space.name}`
        : qrCode.space.name,
      storeId: currentContext.store.id,
    };
  }

  /** 解析并校验空间二维码；码不存在 / 已作废 / 空间已删除时均拒绝 */
  private async resolveActiveSpaceQrCode(spaceToken: string): Promise<{
    storeId: number;
    space: {
      id: number;
      name: string;
      deletedAt: Date | null;
      zone: { name: string } | null;
    };
  }> {
    const token = spaceToken.trim();
    if (!token) {
      throw new BadRequestException('二维码无效，请扫描空间二维码');
    }

    const qrCode = await this.prisma.spaceQrCode.findUnique({
      where: { token },
      select: {
        storeId: true,
        revokedAt: true,
        space: {
          select: {
            id: true,
            name: true,
            deletedAt: true,
            zone: { select: { name: true } },
          },
        },
      },
    });
    if (!qrCode) {
      throw new NotFoundException('二维码无效，请扫描空间二维码');
    }
    if (qrCode.revokedAt) {
      throw new BadRequestException('该空间二维码已作废，请联系工作人员');
    }
    if (qrCode.space.deletedAt) {
      throw new NotFoundException('该空间已删除，请联系工作人员');
    }

    return qrCode;
  }
}
