// 门店快照读取：店主 userId 与门店名是低频变更的门店级数据，
// 而客存的角色判定（主账号权威依据）与推送载荷（告知会员是哪家门店）每次都要用。
// 缓存读写收在一处，避免两处各自写入字段不全的快照把数据写坏。
import type { Prisma } from '@prisma/client';
import type { CustodyCodeService } from './custody-code.service';
import type { CustodyStoreSnapshot } from './custody-code.types';

/** 读取门店行所需的最小客户端 */
export type CustodyStoreSnapshotClient = Pick<
  Prisma.TransactionClient,
  'store'
>;

/**
 * 读取门店快照：优先走缓存，未命中才读门店行并回写整份快照。
 *
 * 「回写整份」是要点：若推送侧只写 name、角色侧只写 ownerId，
 * 先写的一方会把另一字段写成空值，主账号就可能被判成操作员。
 */
export async function resolveCustodyStoreSnapshot(
  client: CustodyStoreSnapshotClient,
  codeService: CustodyCodeService,
  storeId: number,
): Promise<CustodyStoreSnapshot> {
  const cached = await codeService.readStoreSnapshot(storeId);
  if (cached) {
    return cached;
  }
  const store = await client.store.findUnique({
    where: { id: storeId },
    select: { ownerId: true, name: true },
  });
  const snapshot: CustodyStoreSnapshot = {
    ownerId: store?.ownerId ?? null,
    name: store?.name ?? '',
  };
  await codeService.writeStoreSnapshot(storeId, snapshot);
  return snapshot;
}
