import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

const fileKinds = ["PDF", "DOCX", "JPEG", "PNG"] as const;
const serviceCodes = ["DOCUMENT_PRINT", "PHOTO_PRINT"] as const;
const paperCodes = ["STANDARD", "GLOSSY", "MATTE", "PHOTO"] as const;
const colorModes = ["COLOR", "MONOCHROME"] as const;

export class CreateCapabilityVersionDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(fileKinds, { each: true })
  supportedFileKinds!: (typeof fileKinds)[number][];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxPages!: number;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(2000)
  maxWidthMm!: number;

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(2000)
  maxHeightMm!: number;

  @Type(() => Number)
  @IsInt()
  @Min(72)
  @Max(2400)
  minDpi!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  priority!: number;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(serviceCodes, { each: true })
  serviceCodes?: (typeof serviceCodes)[number][];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(paperCodes, { each: true })
  paperCodes?: (typeof paperCodes)[number][];

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(colorModes, { each: true })
  colorModes?: (typeof colorModes)[number][];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  equipmentCodes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxQuantity?: number;
}

export class WeeklyWindowDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(6) weekday!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(1439) opensMinute!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(1440) closesMinute!: number;
}

export class CreateOperationalVersionDto {
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => WeeklyWindowDto)
  weeklyHours!: WeeklyWindowDto[];
  @IsBoolean() pickupEnabled!: boolean;
  @IsBoolean() printerAgentEnabled!: boolean;
}

export class CatalogItemDto {
  @IsIn(serviceCodes) serviceCode!: (typeof serviceCodes)[number];
  @IsBoolean() enabled!: boolean;
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(paperCodes, { each: true })
  paperCodes!: (typeof paperCodes)[number][];
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(colorModes, { each: true })
  colorModes!: (typeof colorModes)[number][];
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) maxQuantity!: number;
}

export class CreateCatalogVersionDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CatalogItemDto)
  items!: CatalogItemDto[];
}

export class CreateCapacityVersionDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  maxConcurrentOrders!: number;
}

export class CreateAvailabilityDto {
  @IsIn(["AVAILABLE", "UNAVAILABLE"])
  kind!: "AVAILABLE" | "UNAVAILABLE";
  @IsDateString() startsAt!: string;
  @IsDateString() endsAt!: string;
}

export class OfferDecisionDto {
  @IsString()
  @IsIn(["ACCEPT", "REJECT"])
  decision!: "ACCEPT" | "REJECT";
}

export class ProductionStatusDto {
  @IsString()
  @IsIn(["IN_PRODUCTION", "READY"])
  status!: "IN_PRODUCTION" | "READY";
}

export class StartMatchingDto {
  @IsString()
  @Length(2, 80)
  reason!: string;
}
