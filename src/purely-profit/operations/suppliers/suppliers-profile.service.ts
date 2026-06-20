import { Injectable } from '@nestjs/common';
import type { Supplier } from '@prisma/client';
import {
  buildPaginationMeta,
  toTimestampMs,
} from '../../commerce/commerce.utils';
import type { PaginationMetaDto } from '../../stores/dto/store-response.dto';
import type {
  PaginatedSuppliersResponseDto,
  SupplierResponseDto,
} from './dto/supplier.dto';

type SupplierSnapshot = Pick<
  Supplier,
  | 'id'
  | 'name'
  | 'contact'
  | 'phone'
  | 'category'
  | 'note'
  | 'createdAt'
  | 'updatedAt'
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

  buildEmptyPaginatedResponse(
    page: number,
    pageSize: number,
  ): PaginatedSuppliersResponseDto {
    return {
      items: [],
      meta: buildPaginationMeta(0, page, pageSize),
    };
  }

  buildPaginatedResponse(
    suppliers: SupplierSnapshot[],
    page: number,
    pageSize: number,
    total: number,
  ): PaginatedSuppliersResponseDto {
    const meta: PaginationMetaDto = buildPaginationMeta(total, page, pageSize);
    return {
      items: suppliers.map((item) => this.toSupplierResponse(item)),
      meta,
    };
  }
}
