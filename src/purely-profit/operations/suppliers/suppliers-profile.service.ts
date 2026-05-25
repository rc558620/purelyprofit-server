import { Injectable } from '@nestjs/common';
import type { Supplier } from '@prisma/client';
import { toTimestampMs } from '../../commerce/commerce.utils';
import type { SupplierResponseDto } from './dto/supplier.dto';

type SupplierSnapshot = Pick<
  Supplier,
  'id' | 'name' | 'contact' | 'phone' | 'category' | 'note' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class SuppliersProfileService {
  toSupplierResponse(supplier: SupplierSnapshot): SupplierResponseDto {
    return {
      id: String(supplier.id),
      name: supplier.name,
      ...(supplier.contact ? { contact: supplier.contact } : {}),
      ...(supplier.phone ? { phone: supplier.phone } : {}),
      ...(supplier.category ? { category: supplier.category } : {}),
      ...(supplier.note ? { note: supplier.note } : {}),
      createdAt: toTimestampMs(supplier.createdAt),
      updatedAt: toTimestampMs(supplier.updatedAt),
    };
  }
}
