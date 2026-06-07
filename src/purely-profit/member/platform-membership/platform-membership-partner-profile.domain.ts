import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';
import { buildPartnerProfileResponse } from './platform-membership-partner.domain';
import {
  findStoreMembershipPromoRecords,
  findStorePartnerApplications,
  findStorePartners,
} from './platform-membership.query';
import type { PrismaExecutor } from './platform-membership.types';

export async function buildPartnerProfileByStoreId(
  prismaExecutor: PrismaExecutor,
  storeId: number,
): Promise<PlatformMembershipPartnerProfileResponseDto> {
  const [partners, promoRecords, applications] = await Promise.all([
    findStorePartners(prismaExecutor, storeId),
    findStoreMembershipPromoRecords(prismaExecutor, storeId),
    findStorePartnerApplications(prismaExecutor, storeId),
  ]);

  return buildPartnerProfileResponse({
    partners,
    promoRecords,
    applications,
  });
}
