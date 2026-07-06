import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';
import { buildPartnerProfileResponse } from './platform-membership-partner.domain';
import {
  findCurrentStorePartner,
  findStoreMembershipPromoRecords,
  findStorePartnerApplications,
} from './platform-membership.query';
import type { PrismaExecutor } from './platform-membership.types';

export async function buildPartnerProfileByStoreId(
  prismaExecutor: PrismaExecutor,
  storeId: number,
): Promise<PlatformMembershipPartnerProfileResponseDto> {
  const [partner, promoRecords, applications] = await Promise.all([
    findCurrentStorePartner(prismaExecutor, storeId),
    findStoreMembershipPromoRecords(prismaExecutor, storeId),
    findStorePartnerApplications(prismaExecutor, storeId),
  ]);

  return buildPartnerProfileResponse({
    partner,
    promoRecords,
    applications,
  });
}
