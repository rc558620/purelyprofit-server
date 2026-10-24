/**
 * employees-profile.domain 单元测试
 *
 * 覆盖范围：
 *  - 新建员工：isTechnician 透传与缺省回落 false
 *  - 更新员工：isTechnician 增量语义（不传不更新，传 false 也要写入）
 */
import {
  buildCreateEmployeeProfileData,
  buildUpdateEmployeeProfileData,
  type EmployeeProfileDictionaryRecord,
} from './employees-profile.domain';

const department: EmployeeProfileDictionaryRecord = { id: 7, name: '前厅' };
const position: EmployeeProfileDictionaryRecord = { id: 9, name: '美容师' };

const buildCreateInput = (
  overrides: Partial<Parameters<typeof buildCreateEmployeeProfileData>[0]> = {},
) => ({
  storeId: 18,
  department,
  position,
  empNo: 'EMP001',
  name: '张三',
  phone: '13800138001',
  joinDate: Date.UTC(2026, 0, 1),
  baseSalary: 4500,
  ...overrides,
});

// 断言统一用 toMatchObject，不直接访问 Prisma 生成类型的属性：
// 生成客户端类型缓存未刷新时（prisma generate 后 IDE/CI 未重新加载）会误报 TS2339，
// 而该字段的契约已由 build*ProfileData 内部的对象字面量守住。
describe('buildCreateEmployeeProfileData', () => {
  it('显式 isTechnician=true 时写入 true', () => {
    const data = buildCreateEmployeeProfileData(
      buildCreateInput({ isTechnician: true }),
    );
    expect(data).toMatchObject({ isTechnician: true });
  });

  it('未传 isTechnician 时回落 false', () => {
    const data = buildCreateEmployeeProfileData(buildCreateInput());
    expect(data).toMatchObject({ isTechnician: false });
  });
});

describe('buildUpdateEmployeeProfileData', () => {
  it('传 true / false 都会写入该字段', () => {
    expect(
      buildUpdateEmployeeProfileData({ isTechnician: true }),
    ).toMatchObject({ isTechnician: true });
    expect(
      buildUpdateEmployeeProfileData({ isTechnician: false }),
    ).toMatchObject({ isTechnician: false });
  });

  it('未传时不产出该字段（保持增量更新语义）', () => {
    const data = buildUpdateEmployeeProfileData({ name: '李四' });
    expect(data).not.toHaveProperty('isTechnician');
    expect(data.name).toBe('李四');
  });
});
