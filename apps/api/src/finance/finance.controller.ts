import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { CreateSettlementBatchDto, RunReconciliationDto } from "./dto";
import { FinanceService } from "./finance.service";

@Controller("admin/finance")
@UseGuards(AccessGuard, RolesGuard)
@Roles("FINANCE_ADMIN")
export class FinanceAdminController {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}
  @Get()
  overview() {
    return this.finance.adminOverview();
  }
  @Post("settlement-batches")
  createBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateSettlementBatchDto,
  ) {
    return this.finance.createSettlement(user.id, key, input);
  }
  @Post("settlement-batches/:id/submit")
  submitBatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.finance.submitSettlement(user.id, id, key);
  }
  @Post("reconciliation")
  reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: RunReconciliationDto,
  ) {
    return this.finance.reconcile(user.id, key, input);
  }
  @Post("fiscal/:id/retry")
  retryFiscal(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.finance.retryFiscal(user.id, id, key);
  }
}

@Controller("partner/finance")
@UseGuards(AccessGuard, RolesGuard)
@Roles("PARTNER")
export class PartnerFinanceController {
  constructor(
    @Inject(FinanceService) private readonly finance: FinanceService,
  ) {}
  @Get("ledger")
  ledger(@CurrentUser() user: AuthenticatedUser) {
    return this.finance.partnerLedger(user.id);
  }
}
