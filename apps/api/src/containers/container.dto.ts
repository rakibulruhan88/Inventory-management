import type { ContainerUpdateInput } from '@afia/contracts';
import { IsOptional, IsString, MinLength } from 'class-validator';
export class ContainerDto implements ContainerUpdateInput {
  @IsString() @MinLength(1) containerNumber: string;
  @IsOptional() @IsString() notes?: string;
}
