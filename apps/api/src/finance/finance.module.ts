import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CommerceModule } from "../commerce/commerce.module";
import { loadEnvironment } from "../config/environment";
import { FISCAL_PROVIDER, PAYOUT_PROVIDER } from "../providers/provider-tokens";
import { UploadsModule } from "../uploads/uploads.module";
import {
  FinanceAdminController,
  PartnerFinanceController,
} from "./finance.controller";
import {
  HttpFiscalProvider,
  HttpPayoutProvider,
  MockFiscalProvider,
  MockPayoutProvider,
} from "./finance.adapters";
import { FinanceQueueService } from "./finance-queue.service";
import { FinanceService } from "./finance.service";

@Module({
  imports: [AuditModule, CommerceModule, UploadsModule],
  controllers: [FinanceAdminController, PartnerFinanceController],
  providers: [
    FinanceService,
    FinanceQueueService,
    MockFiscalProvider,
    HttpFiscalProvider,
    MockPayoutProvider,
    HttpPayoutProvider,
    {
      provide: FISCAL_PROVIDER,
      inject: [MockFiscalProvider, HttpFiscalProvider],
      useFactory: (mock: MockFiscalProvider, http: HttpFiscalProvider) =>
        loadEnvironment().fiscalProvider === "mock" ? mock : http,
    },
    {
      provide: PAYOUT_PROVIDER,
      inject: [MockPayoutProvider, HttpPayoutProvider],
      useFactory: (mock: MockPayoutProvider, http: HttpPayoutProvider) =>
        loadEnvironment().payoutProvider === "mock" ? mock : http,
    },
  ],
  exports: [FinanceService, FinanceQueueService],
})
export class FinanceModule {}
