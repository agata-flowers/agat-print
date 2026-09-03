import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class OpenDisputeDto {
  @IsIn([
    "PRINT_QUALITY",
    "WRONG_OUTPUT",
    "DAMAGED",
    "MISSING_ITEMS",
    "DELIVERY_FAILURE",
  ])
  category!:
    | "PRINT_QUALITY"
    | "WRONG_OUTPUT"
    | "DAMAGED"
    | "MISSING_ITEMS"
    | "DELIVERY_FAILURE";

  @IsOptional()
  @IsString()
  @MaxLength(280)
  @Matches(/^[\p{L}\p{N} .,;:!?()-]+$/u)
  structuredComment?: string;
}

export class PartnerDisputeResponseDto {
  @IsIn([
    "ACKNOWLEDGED",
    "DISAGREES",
    "REPRINT_ACCEPTED",
    "DELIVERY_NOT_PARTNER",
  ])
  responseCode!:
    | "ACKNOWLEDGED"
    | "DISAGREES"
    | "REPRINT_ACCEPTED"
    | "DELIVERY_NOT_PARTNER";
}

export class ResolveDisputeDto {
  @IsIn(["NO_ACTION", "REPRINT", "PARTIAL_REFUND", "FULL_REFUND"])
  resolution!: "NO_ACTION" | "REPRINT" | "PARTIAL_REFUND" | "FULL_REFUND";

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,15}$/)
  refundAmountMinor?: string;
}

export class CreateLegalHoldDto {
  @IsIn(["LEGAL_REQUEST", "SECURITY_INCIDENT", "REGULATORY_REVIEW"])
  reasonCode!: "LEGAL_REQUEST" | "SECURITY_INCIDENT" | "REGULATORY_REVIEW";
}
