import type { PrismaService } from '../../prisma/prisma.service';

/**
 * 按「门店 + 手机号」定位当前门店的会员档案 ID。
 *
 * C 端客存接口与 C 端实时房间必须共用这一口径，否则会出现
 * "能查客存但收不到推送"（或反向）的错配。未在本店登记、
 * 已删除或被拉黑时返回 null。
 */
export async function resolveCustodyMemberId(
  prisma: PrismaService,
  storeId: number,
  phone: string,
): Promise<number | null> {
  const normalizedPhone = (phone ?? '').trim();
  if (!normalizedPhone) return null;

  const member = await prisma.member.findFirst({
    where: {
      storeId,
      phone: normalizedPhone,
      deletedAt: null,
      status: { not: 'banned' },
    },
    select: { id: true },
  });
  return member?.id ?? null;
}
