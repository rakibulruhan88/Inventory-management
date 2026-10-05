import type { CustomerInput } from '@afia/contracts';
import { IsEmail, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
export class CustomerDto implements CustomerInput {
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== '') @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
}
