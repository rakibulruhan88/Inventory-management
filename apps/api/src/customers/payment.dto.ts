import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';
export class PaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsOptional() @IsIn(['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER']) method?:
    'CASH' | 'BANK' | 'MOBILE_BANKING' | 'OTHER';
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
}
