import type { SupplierInput } from '@afia/contracts';
import { IsEmail, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class UpdateSupplierDto implements SupplierInput {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
