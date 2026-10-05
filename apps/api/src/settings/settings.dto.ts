import {
  IsEmail,
  IsHexColor,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
export class SettingsDto {
  @IsString() @MinLength(1) storeName: string;
  @IsOptional() @IsString() logoUrl?: string | null;
  @IsOptional() @IsString() faviconUrl?: string | null;
  @IsOptional() @IsString() storePhone?: string | null;
  @IsOptional() @ValidateIf((_object, value) => value !== '') @IsEmail() storeEmail?: string | null;
  @IsOptional() @IsString() storeAddress?: string | null;
  @IsIn(['BDT']) currency: string;
  @IsString() currencySymbol: string;
  @IsString() @MinLength(1) invoicePrefix: string;
  @IsIn(['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER']) defaultPaymentMethod:
    'CASH' | 'BANK' | 'MOBILE_BANKING' | 'OTHER';
  @IsInt() @Min(0) lowStockRollThreshold: number;
  @IsNumber() @Min(0) lowStockMeterThreshold: number;
  @IsHexColor() brandAccent: string;
}
