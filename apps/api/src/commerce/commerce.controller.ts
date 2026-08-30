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
import { PublicWebhook } from "../common/public-webhook.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import { CommerceService } from "./commerce.service";
import {
  CreateOrderDto,
  CreateTariffDto,
  NoExecutorRefundDto,
  PaymentCallbackDto,
  StartPaymentDto,
} from "./dto";

@Controller()
@UseGuards(AccessGuard)
export class CommerceController {
  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  @Get("tariffs/current")
  currentTariff() {
    return this.commerce.currentTariff();
  }

  @Post("orders")
  createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateOrderDto,
  ) {
    return this.commerce.createOrder(user.id, key, input);
  }

  @Get("orders/:id")
  order(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.commerce.ownOrder(user.id, id);
  }

  @Post("orders/:id/payment")
  payment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: StartPaymentDto,
  ) {
    return this.commerce.startPayment(user.id, id, key, input);
  }
}

@Controller("admin")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class CommerceAdminController {
  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  @Get("tariffs")
  tariffs() {
    return this.commerce.tariffs();
  }

  @Post("tariffs")
  createTariff(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreateTariffDto,
  ) {
    return this.commerce.createTariff(user.id, input);
  }

  @Get("finance/audit")
  financeAudit() {
    return this.commerce.financeAudit();
  }

  @Post("internal/orders/:id/no-executor")
  noExecutor(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: NoExecutorRefundDto,
  ) {
    return this.commerce.requestNoExecutorRefund(user.id, id, key, input);
  }
}

@Controller("payments/mock")
export class MockPaymentCallbackController {
  constructor(
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  @Post("callback")
  @PublicWebhook()
  callback(
    @Headers("x-provider-signature") signature: string | undefined,
    @Body() input: PaymentCallbackDto,
  ) {
    return this.commerce.callback(input, signature);
  }
}
