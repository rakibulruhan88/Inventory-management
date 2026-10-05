import type {
  UpdateProductRequest,
  UpdateVariantRequest,
} from '@afia/contracts';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProductDto implements UpdateProductRequest {
  @IsString()
  @MinLength(1)
  itemCode: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class UpdateVariantDto implements UpdateVariantRequest {
  @IsString()
  @MinLength(1)
  color: string;

  @IsOptional()
  @IsString()
  size?: string;
}
