import { IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AttributionDto } from '../../activity/attribution';

export class SignupDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => AttributionDto)
  attribution?: AttributionDto;
}
