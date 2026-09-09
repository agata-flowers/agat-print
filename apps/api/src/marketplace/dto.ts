import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class StudioQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,39}$/)
  serviceCode?: string;
  @IsOptional() @IsString() @MaxLength(40) paperCode?: string;
  @IsOptional() @IsString() @MaxLength(40) colorMode?: string;
  @IsOptional() @IsString() @MaxLength(40) locationCode?: string;
  @IsOptional() @IsIn(["ru", "uz"]) locale?: "ru" | "uz";
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class ListingDraftDto {
  @IsString() @Matches(/^[0-9a-f-]{36}$/i) branchId!: string;
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/) publicSlug!: string;
  @IsString() @MaxLength(120) titleRu!: string;
  @IsString() @MaxLength(120) titleUz!: string;
  @IsString() @MaxLength(500) descriptionRu!: string;
  @IsString() @MaxLength(500) descriptionUz!: string;
}

export class ListingSubmitDto {
  @IsInt() @Min(0) version!: number;
}

export class ListingDecisionDto {
  @IsIn(["PUBLISH", "REJECT", "RETIRE"])
  decision!: "PUBLISH" | "REJECT" | "RETIRE";
  @IsInt() @Min(0) version!: number;
  @IsOptional()
  @IsIn([
    "APPROVED",
    "CONTENT_POLICY",
    "NETWORK_INELIGIBLE",
    "RETIRED_BY_OPERATOR",
  ])
  reasonCode?: string;
}

export class StudioPreferenceDto {
  @IsInt() @Min(0) version!: number;
  @IsIn(["AUTO_ASSIGN", "PREFERRED_STUDIO"])
  mode!: "AUTO_ASSIGN" | "PREFERRED_STUDIO";
  @IsIn(["ALLOW_ELIGIBLE_ALTERNATIVE", "STRICT_PREFERENCE"])
  fallbackPolicy!: "ALLOW_ELIGIBLE_ALTERNATIVE" | "STRICT_PREFERENCE";
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{2,79}$/)
  studioSlug?: string;
}
