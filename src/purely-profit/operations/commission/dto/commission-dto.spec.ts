/**
 * 提成 DTO 契约测试：前端技师/服务 ID 以字符串提交，必须能被 class-validator 转换并校验通过。
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CommissionAssignmentDto } from './commission-assignment.dto';
import { CommissionOverrideDto } from './commission-service.dto';

describe('提成 DTO 前端契约', () => {
  it('开台提成分配的技师/服务 ID 字符串可被转换并通过校验', async () => {
    const dto = plainToInstance(CommissionAssignmentDto, {
      technicianId: '5',
      technicianName: '王强',
      serviceIds: ['1', '2'],
      serviceNames: ['足疗', 'SPA'],
      commission: 120.5,
    } as object);

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.technicianId).toBe(5);
    expect(dto.serviceIds).toEqual([1, 2]);
  });

  it('覆盖表技师 ID 字符串可被转换并通过校验', async () => {
    const dto = plainToInstance(CommissionOverrideDto, {
      technicianId: '6',
      commission: 60,
    } as object);

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.technicianId).toBe(6);
  });

  it('非法技师 ID 与负数提成被拒绝', async () => {
    const badOverride = plainToInstance(CommissionOverrideDto, {
      technicianId: 'abc',
      commission: -1,
    } as object);
    const errors = await validate(badOverride);
    expect(errors.length).toBeGreaterThan(0);
  });
});
