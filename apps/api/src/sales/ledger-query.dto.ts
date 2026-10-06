import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { SalesLedgerQuery } from '@afia/contracts';
export class LedgerPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
export class SalesLedgerQueryDto
  extends LedgerPageDto
  implements SalesLedgerQuery
{
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(200) customer?: string;
  @IsOptional() @IsString() @MaxLength(100) phone?: string;
  @IsOptional() @IsString() @MaxLength(100) customerId?: string;
  @IsOptional() @IsString() @MaxLength(100) invoice?: string;
  @IsOptional() @IsString() @MaxLength(200) product?: string;
  @IsOptional()
  @IsIn(['today', 'yesterday', 'week', 'month', 'specific', 'range'])
  date?: SalesLedgerQuery['date'];
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
  @IsOptional()
  @IsIn(['PAID', 'PARTIAL', 'UNPAID', 'VOIDED'])
  status?: SalesLedgerQuery['status'];
  @IsOptional()
  @IsIn(['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER'])
  method?: SalesLedgerQuery['method'];
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minTotal?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxTotal?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minDue?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxDue?: number;
  @IsOptional()
  @IsIn(['newest', 'oldest', 'highest-total', 'lowest-total', 'highest-due'])
  sort?: SalesLedgerQuery['sort'];
}
