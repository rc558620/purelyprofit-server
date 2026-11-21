/**
 * 会话响应映射单测：按权限裁剪提成金额。
 *
 * 覆盖：
 *  - 无 commission:view 时裁掉 commissionAssignments[].commission
 *  - 裁剪返回新对象，不修改共享缓存里的原响应
 */
import type { SpaceSessionResponseDto } from './dto/space-session.dto';
import { maskSpaceSessionCommission } from './space-sessions.mapper';

const buildResponse = (): SpaceSessionResponseDto =>
  ({
    id: 1001,
    spaceId: 3,
    status: 'active',
    commissionAssignments: [
      {
        technicianId: 5,
        technicianName: '王强',
        serviceIds: [1],
        serviceNames: ['足疗'],
        commission: 45,
      },
    ],
  }) as unknown as SpaceSessionResponseDto;

describe('maskSpaceSessionCommission', () => {
  it('裁掉提成金额但保留分配关系', () => {
    const masked = maskSpaceSessionCommission(buildResponse());

    expect(masked.commissionAssignments).toEqual([
      {
        technicianId: 5,
        technicianName: '王强',
        serviceIds: [1],
        serviceNames: ['足疗'],
      },
    ]);
    expect(masked.commissionAssignments?.[0]).not.toHaveProperty('commission');
  });

  it('不修改原响应，避免污染共享缓存', () => {
    const original = buildResponse();

    maskSpaceSessionCommission(original);

    expect(original.commissionAssignments?.[0]?.commission).toBe(45);
  });

  it('没有提成分配时原样返回', () => {
    const original = { id: 1 } as unknown as SpaceSessionResponseDto;

    expect(maskSpaceSessionCommission(original)).toBe(original);
  });
});
