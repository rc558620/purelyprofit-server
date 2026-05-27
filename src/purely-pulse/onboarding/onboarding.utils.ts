export interface MerchantVerificationRow {
  realName: string | null;
  idNumber: string | null;
}

export interface MembershipProfileRow {
  currentPlanId: string | null;
  expiresAt: Date | null;
}

export function isActiveMembership(
  profile: MembershipProfileRow | null,
): boolean {
  if (!profile?.currentPlanId || !profile.expiresAt) {
    return false;
  }

  return profile.expiresAt > new Date();
}
