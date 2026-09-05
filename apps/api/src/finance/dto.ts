import {
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from "class-validator";

export class CreateSettlementBatchDto {
  @IsISO8601()
  cutoffAt!: string;
}

export class RunReconciliationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{1,80}$/)
  runReference!: string;
}

export class RetryFiscalDto {
  @IsOptional()
  @IsUUID()
  operationId?: string;
}
