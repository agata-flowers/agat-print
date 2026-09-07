import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class CreatePartnerDto {
  @IsString() @Length(2, 180) displayName!: string;
  @IsString() @Length(2, 180) branchName!: string;
  @IsOptional() @IsString() @Length(2, 120) district?: string;
}

export class CreatePartnerDraftDto extends CreatePartnerDto {}

export class UpdatePartnerProfileDto {
  @IsOptional() @IsString() @Length(2, 180) displayName?: string;
  @IsOptional() @IsString() @Length(0, 500) publicDescription?: string;
  @IsOptional() @IsString() @Length(0, 180) publicContact?: string;
  @IsOptional() @IsString() @Length(2, 500) operationalContact?: string;
}

export class UpdateBranchProfileDto {
  @IsOptional() @IsString() @Length(2, 180) name?: string;
  @IsOptional() @IsString() @Length(0, 500) publicDescription?: string;
  @IsOptional() @IsIn(["Asia/Tashkent"]) timezone?: "Asia/Tashkent";
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200000)
  serviceRadiusMeters?: number;
  @IsOptional() @IsBoolean() acceptingOrders?: boolean;
}

export class ModeratePartnerDto {
  @IsIn(["ACTIVE", "SUSPENDED", "REJECTED", "CLOSED"])
  status!: "ACTIVE" | "SUSPENDED" | "REJECTED" | "CLOSED";
}
