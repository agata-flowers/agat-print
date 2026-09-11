import {
  IsIn,
  IsInt,
  IsOptional,
  IsArray,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from "class-validator";

export class CreateTariffDto {
  @IsString()
  @Matches(/^\d{1,15}$/)
  basePriceMinor!: string;

  @IsString()
  @Matches(/^\d{1,15}$/)
  perPagePriceMinor!: string;

  @IsOptional()
  @IsArray()
  rules?: Array<{
    serviceCode: string;
    basePriceMinor: string;
    perPagePriceMinor: string;
    optionPrices: Record<string, string>;
  }>;

  @IsOptional()
  @IsArray()
  fulfillmentRules?: Array<{
    mode: "PICKUP" | "DELIVERY";
    locationCode: string;
    feeMinor: string;
    enabled?: boolean;
  }>;
}

export class CreateOrderDto {
  @IsUUID()
  layoutApprovalId!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  orderDraftId?: string;

  @IsOptional()
  @IsUUID()
  priceQuoteId?: string;
}

export class StartPaymentDto {
  @IsOptional()
  @IsIn(["SUCCESS", "FAILURE"])
  simulateOutcome?: "SUCCESS" | "FAILURE";
}

export class PaymentCallbackDto {
  @IsUUID()
  eventId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,160}$/)
  paymentReference!: string;

  @IsIn(["PAYMENT_SUCCEEDED", "PAYMENT_FAILED", "REFUND_SUCCEEDED"])
  outcome!: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED" | "REFUND_SUCCEEDED";
}

export class NoExecutorRefundDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9._:-]{1,80}$/)
  syntheticEventReference!: string;
}
