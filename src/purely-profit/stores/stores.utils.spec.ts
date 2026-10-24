/**
 * stores.utils 服务人员称呼归一化单元测试
 *
 * 覆盖范围：
 *  - 称呼 trim 与空值回落默认「技师」
 *  - UpdateStoreDto → 更新载荷的白名单提取（未传字段不产出，避免误清空）
 */
import { UpdateStoreDto } from './dto/update-store.dto';
import { DEFAULT_TECHNICIAN_LABEL } from './dto/store-response.dto';
import { extractStoreUpdatePayload } from './stores.utils';

describe('extractStoreUpdatePayload – 服务人员称呼', () => {
  it('正常称呼按 trim 后写入', () => {
    const payload = extractStoreUpdatePayload(
      Object.assign(new UpdateStoreDto(), { technicianLabel: '  美容师  ' }),
    );
    expect(payload.technicianLabel).toBe('美容师');
  });

  it('空字符串与全空格回落默认「技师」', () => {
    expect(
      extractStoreUpdatePayload(
        Object.assign(new UpdateStoreDto(), { technicianLabel: '' }),
      ).technicianLabel,
    ).toBe(DEFAULT_TECHNICIAN_LABEL);

    expect(
      extractStoreUpdatePayload(
        Object.assign(new UpdateStoreDto(), { technicianLabel: '   ' }),
      ).technicianLabel,
    ).toBe(DEFAULT_TECHNICIAN_LABEL);
  });

  it('未传称呼时不产出该字段，避免覆盖已有值', () => {
    const payload = extractStoreUpdatePayload(
      Object.assign(new UpdateStoreDto(), { storeName: '纯利优选示范店' }),
    );
    expect(payload).not.toHaveProperty('technicianLabel');
    expect(payload.storeName).toBe('纯利优选示范店');
  });
});
