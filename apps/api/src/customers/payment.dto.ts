import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsISO8601,
} from 'class-validator';
class PaymentAllocationDto {
  @IsOptional() @IsString() @MaxLength(100) saleId?: string;
  @IsOptional() @IsString() @MaxLength(100) openingBalanceId?: string;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  amount: number;
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  expectedDue: number;
}
export class PaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999999999999.99)
  amount: number;
  @IsOptional() @IsIn(['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER']) method?:
    'CASH' | 'BANK' | 'MOBILE_BANKING' | 'OTHER';
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsUUID() idempotencyKey: string;
  @IsISO8601({ strict: true }) paidAt: string;
  @IsIn(['AUTO', 'MANUAL']) allocationMode: 'AUTO' | 'MANUAL';
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999999999999.99)
  expectedOutstanding: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations?: PaymentAllocationDto[];
}
