import { StaffStatus } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { StoreRecordSnapshot } from './dto/store-response.dto';

/** 绑定门店查询字段：必须包含 businessMode，业态判定依赖它。 */
const BOUND_STORE_SELECT = {
  id: true,
  name: true,
  address: true,
  businessMode: true,
  // 会员护理档案档位：门店更新时据此拒绝跨档位修改门店类型
  memberCareEnabled: true,
  // 服务人员称呼：auth/profile 与门店读取都据此回显
  technicianLabel: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * 查询当前账号已绑定的门店（唯一事实源）。
 *
 * 建店校验（「一个账号只能绑定一个门店」）与门店读取都走这里，
 * 避免两份查询逻辑各自演化导致口径漂移。
 *
 * 优先级：
 * 1. JWT 中已解析出当前门店时，直接按 storeId 精确命中（最快且语义最准）
 * 2. 否则按 ownerId 或活跃 staff 记录（userId / email / phone 任一命中）回退查找
 */
export async function findBoundStoreRecord(
  prisma: PrismaService,
  user: AuthenticatedUser,
): Promise<StoreRecordSnapshot | null> {
  if (user.currentMembership?.storeId) {
    return prisma.store.findUnique({
      where: { id: user.currentMembership.storeId },
      select: BOUND_STORE_SELECT,
    });
  }

  return prisma.store.findFirst({
    where: {
      OR: [
        { ownerId: user.id },
        {
          staffs: {
            some: {
              isActive: true,
              status: StaffStatus.active,
              OR: [
                { userId: user.id },
                { email: user.email },
                { phone: user.phone },
              ],
            },
          },
        },
      ],
    },
    select: BOUND_STORE_SELECT,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
}
