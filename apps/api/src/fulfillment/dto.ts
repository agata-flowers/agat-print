import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

export class RequestFulfillmentDto {
  @IsString()
  @IsIn(["PICKUP", "DELIVERY"])
  mode!: "PICKUP" | "DELIVERY";

  @IsOptional()
  @IsString()
  @Length(8, 500)
  deliveryAddress?: string;
}

export class ConfirmPinDto {
  @IsString()
  @Matches(/^\d{6}$/)
  pin!: string;
}

export class CourierApplicationDto {
  @IsString()
  @Length(2, 160)
  displayName!: string;

  @IsString()
  @Matches(/^[A-Z0-9_-]{2,40}$/)
  serviceZone!: string;
}

export class DeliveryFailureDto {
  @IsString()
  @IsIn(["RECIPIENT_UNAVAILABLE", "ADDRESS_UNREACHABLE", "PACKAGE_DAMAGED"])
  reason!: "RECIPIENT_UNAVAILABLE" | "ADDRESS_UNREACHABLE" | "PACKAGE_DAMAGED";
}

export class RegisterPrinterAgentDto {
  @IsString()
  @Length(2, 80)
  label!: string;
}

export class PrinterJobStatusDto {
  @IsString()
  @IsIn(["PRINTING", "COMPLETED", "FAILED"])
  status!: "PRINTING" | "COMPLETED" | "FAILED";

  @IsOptional()
  @IsString()
  @MaxLength(40)
  @IsIn(["DEVICE_UNAVAILABLE", "PAPER_ERROR", "OUTPUT_REJECTED"])
  failureCode?: "DEVICE_UNAVAILABLE" | "PAPER_ERROR" | "OUTPUT_REJECTED";
}
