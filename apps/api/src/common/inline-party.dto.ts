import type { InlinePartyInput } from '@afia/contracts';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class InlinePartyDto implements InlinePartyInput {
  @IsOptional() @IsString() @MinLength(1) id?: string;
  @IsString() @MinLength(1) name: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  email?: string;
  @IsOptional() @IsString() address?: string;
}
