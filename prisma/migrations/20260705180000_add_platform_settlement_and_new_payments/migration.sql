-- AlterEnum: Add platform_settlement to FinanceCashFlowCategory
ALTER TYPE "FinanceCashFlowCategory" ADD VALUE 'platform_settlement';

-- AlterEnum: Add meituan, douyin, platform to FinanceCashFlowPayment
ALTER TYPE "FinanceCashFlowPayment" ADD VALUE 'meituan';
ALTER TYPE "FinanceCashFlowPayment" ADD VALUE 'douyin';
ALTER TYPE "FinanceCashFlowPayment" ADD VALUE 'platform';
