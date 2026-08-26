import { IsOptional, IsString, Length } from "class-validator";
export class CreatePartnerDto {
  @IsString() @Length(2, 180) displayName!: string;
  @IsString() @Length(2, 180) branchName!: string;
  @IsOptional() @IsString() @Length(2, 120) district?: string;
}
