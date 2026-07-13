import {
  buildPartnerReviewResponse,
  normalizePartnerReviewStatus,
} from './platform-membership-partner-review.compat';
import type { PlatformMembershipPartnerProfileResponseDto } from './dto/platform-membership-response.dto';

type AppInput =
  PlatformMembershipPartnerProfileResponseDto['applications'][number];

function buildApplication(overrides: Partial<AppInput> = {}): AppInput {
  return {
    id: '1',
    name: '张三',
    phone: '13800138000',
    idCard: '440301199001011234',
    region: ['广东省', '深圳市', '南山区'],
    paymentMethod: 'wechat',
    paymentAccount: 'wx_test',
    intention: 'agent',
    status: 'pending',
    createdAt: 0,
    followUpNotes: [],
    beanBalance: 0,
    totalEarnedBeans: 0,
    totalWithdrawnBeans: 0,
    ...overrides,
  };
}

describe('partner-review compat', () => {
  it('reviewing 状态映射为 reviewing 而非 pending', () => {
    expect(normalizePartnerReviewStatus('reviewing')).toBe('reviewing');
    expect(normalizePartnerReviewStatus('pending')).toBe('pending');
    expect(normalizePartnerReviewStatus('approved')).toBe('approved');
    expect(normalizePartnerReviewStatus('rejected')).toBe('rejected');
  });

  it('buildPartnerReviewResponse 统计区分 reviewing', () => {
    const profile = {
      applications: [
        buildApplication({ id: '1', status: 'pending' }),
        buildApplication({ id: '2', status: 'reviewing' }),
        buildApplication({ id: '3', status: 'approved' }),
        buildApplication({ id: '4', status: 'rejected' }),
      ],
    } as unknown as PlatformMembershipPartnerProfileResponseDto;

    const result = buildPartnerReviewResponse(profile);

    expect(result.stats.totalCount).toBe(4);
    expect(result.stats.pendingCount).toBe(1);
    expect(result.stats.reviewingCount).toBe(1);
    expect(result.stats.approvedCount).toBe(1);
    expect(result.stats.rejectedCount).toBe(1);
    expect(
      result.applications.find((application) => application.id === '2')?.status,
    ).toBe('reviewing');
  });
});
