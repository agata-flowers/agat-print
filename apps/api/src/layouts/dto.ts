import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from "class-validator";

export class GenerateLayoutDto {
  @IsOptional()
  @IsUUID()
  layoutId?: string;

  @IsUUID()
  uploadId!: string;

  @IsInt()
  @Min(10)
  @Max(1_000)
  targetWidthMm!: number;

  @IsInt()
  @Min(10)
  @Max(1_000)
  targetHeightMm!: number;

  @IsInt()
  @Min(72)
  @Max(1_200)
  minDpi!: number;

  @IsBoolean()
  photoDocument!: boolean;
}

export class ConfirmLayoutDto {
  @IsUUID()
  previewVersionId!: string;
}

export class ManualReviewDecisionDto {
  @IsIn(["APPROVE", "REJECT"])
  decision!: "APPROVE" | "REJECT";
}
