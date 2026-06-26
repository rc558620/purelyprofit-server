-- Fix enum values to match Prisma schema (lowercase)
-- Prisma 7.x no longer auto-maps uppercase DB enum values to lowercase schema values.
-- The original migrations created uppercase values, but Prisma schema uses lowercase.

-- 1. StaffStatus: INVITED → invited, ACTIVE → active, DISABLED → disabled
ALTER TYPE "StaffStatus" RENAME VALUE 'INVITED' TO 'invited';
ALTER TYPE "StaffStatus" RENAME VALUE 'ACTIVE' TO 'active';
ALTER TYPE "StaffStatus" RENAME VALUE 'DISABLED' TO 'disabled';

-- 2. StaffRole: OWNER → owner, MANAGER → manager, STAFF → staff
ALTER TYPE "StaffRole" RENAME VALUE 'OWNER' TO 'owner';
ALTER TYPE "StaffRole" RENAME VALUE 'MANAGER' TO 'manager';
ALTER TYPE "StaffRole" RENAME VALUE 'STAFF' TO 'staff';

-- 3. SubscriptionPlanCode: STARTER → starter, GROWTH → growth, PRO → pro, CUSTOM → custom
ALTER TYPE "SubscriptionPlanCode" RENAME VALUE 'STARTER' TO 'starter';
ALTER TYPE "SubscriptionPlanCode" RENAME VALUE 'GROWTH' TO 'growth';
ALTER TYPE "SubscriptionPlanCode" RENAME VALUE 'PRO' TO 'pro';
ALTER TYPE "SubscriptionPlanCode" RENAME VALUE 'CUSTOM' TO 'custom';

-- 4. StoreSubscriptionStatus: ACTIVE → active, EXPIRED → expired, CANCELLED → cancelled
ALTER TYPE "StoreSubscriptionStatus" RENAME VALUE 'ACTIVE' TO 'active';
ALTER TYPE "StoreSubscriptionStatus" RENAME VALUE 'EXPIRED' TO 'expired';
ALTER TYPE "StoreSubscriptionStatus" RENAME VALUE 'CANCELLED' TO 'cancelled';

-- 5. MemberGender: UNKNOWN → unknown, MALE → male, FEMALE → female
ALTER TYPE "MemberGender" RENAME VALUE 'UNKNOWN' TO 'unknown';
ALTER TYPE "MemberGender" RENAME VALUE 'MALE' TO 'male';
ALTER TYPE "MemberGender" RENAME VALUE 'FEMALE' TO 'female';

-- 6. MemberStatus: ACTIVE → active, INACTIVE → inactive, BANNED → banned
ALTER TYPE "MemberStatus" RENAME VALUE 'ACTIVE' TO 'active';
ALTER TYPE "MemberStatus" RENAME VALUE 'INACTIVE' TO 'inactive';
ALTER TYPE "MemberStatus" RENAME VALUE 'BANNED' TO 'banned';

-- 7. MemberPointsChangeType: INCREASE → increase, DECREASE → decrease
ALTER TYPE "MemberPointsChangeType" RENAME VALUE 'INCREASE' TO 'increase';
ALTER TYPE "MemberPointsChangeType" RENAME VALUE 'DECREASE' TO 'decrease';
