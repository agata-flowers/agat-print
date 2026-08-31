import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  Min,
} from "class-validator";

const fileKinds = ["PDF", "DOCX", "JPEG", "PNG"] as const;

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
  reason!: string;
}
