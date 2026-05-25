import { MemberSnapshotDto } from './dto/member-response.dto';
import type { MemberSnapshotRow } from './members.types';

export function toMemberSnapshotResponse(
  row: MemberSnapshotRow,
): MemberSnapshotDto {
  return {
    id: String(row.id),
    name: row.name,
    phone: row.phone ?? '',
    availablePoints: row.points,
    beanBalance: row.beanBalance,
    isPartner: row.isPartner,
  };
}

export function toMemberSnapshotResponses(
  rows: MemberSnapshotRow[],
): MemberSnapshotDto[] {
  return rows.map((row) => toMemberSnapshotResponse(row));
}
