import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { PublicWebhook } from "../common/public-webhook.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import {
  ConfirmPinDto,
  CourierApplicationDto,
  DeliveryFailureDto,
  PrinterJobStatusDto,
  RegisterPrinterAgentDto,
  RequestFulfillmentDto,
} from "./dto";
import { FulfillmentService } from "./fulfillment.service";
import {
  PrinterAgentGuard,
  type PrinterAgentRequest,
} from "./printer-agent.guard";

@Controller("orders")
@UseGuards(AccessGuard)
export class CustomerFulfillmentController {
  constructor(
    @Inject(FulfillmentService)
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Post(":id/fulfillment")
  request(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: RequestFulfillmentDto,
  ) {
    return this.fulfillment.requestFulfillment(user.id, id, key, input);
  }
}

@Controller("couriers")
@UseGuards(AccessGuard)
export class CourierApplicationController {
  constructor(
    @Inject(FulfillmentService)
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Post()
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CourierApplicationDto,
  ) {
    return this.fulfillment.applyCourier(user.id, input);
  }

  @Get("me")
  own(@CurrentUser() user: AuthenticatedUser) {
    return this.fulfillment.ownCourier(user.id);
  }
}

@Controller("partner")
@UseGuards(AccessGuard, RolesGuard)
@Roles("PARTNER")
export class PartnerFulfillmentController {
  constructor(
    @Inject(FulfillmentService)
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Post("orders/:id/pickup/complete")
  completePickup(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ConfirmPinDto,
  ) {
    return this.fulfillment.completePickup(user.id, id, key, input);
  }

  @Post("deliveries/:id/handoff")
  handoff(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ConfirmPinDto,
  ) {
    return this.fulfillment.handoffDelivery(user.id, id, key, input);
  }
}

@Controller("courier")
@UseGuards(AccessGuard, RolesGuard)
@Roles("COURIER")
export class CourierDeliveryController {
  constructor(
    @Inject(FulfillmentService)
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Get("deliveries/active")
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.fulfillment.activeDelivery(user.id);
  }

  @Post("deliveries/:id/complete")
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ConfirmPinDto,
  ) {
    return this.fulfillment.completeDelivery(user.id, id, key, input);
  }

  @Post("deliveries/:id/fail")
  fail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DeliveryFailureDto,
  ) {
    return this.fulfillment.failDelivery(user.id, id, key, input);
  }
}

@Controller("admin")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class AdminFulfillmentController {
  constructor(
    @Inject(FulfillmentService)
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Post("couriers/:id/approve")
  approveCourier(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.fulfillment.approveCourier(user.id, id);
  }

  @Get("couriers")
  couriers() {
    return this.fulfillment.adminCouriers();
  }

  @Post("couriers/:id/suspend")
  suspendCourier(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.fulfillment.suspendCourier(user.id, id);
  }

  @Post("branches/:id/printer-agents")
  registerAgent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() input: RegisterPrinterAgentDto,
  ) {
    return this.fulfillment.registerPrinterAgent(user.id, id, input.label);
  }

  @Post("printer-agents/:id/revoke")
  revokeAgent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.fulfillment.revokePrinterAgent(user.id, id);
  }

  @Get("fulfillment")
  history() {
    return this.fulfillment.adminFulfillment();
  }
}

@Controller("printer-agent")
@PublicWebhook()
@UseGuards(PrinterAgentGuard)
export class PrinterAgentController {
  constructor(
    @Inject(FulfillmentService)
    private readonly fulfillment: FulfillmentService,
  ) {}

  @Post("jobs/claim")
  claim(
    @Req() request: PrinterAgentRequest,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.fulfillment.claimPrintJob(request.printerAgent!, key);
  }

  @Post("jobs/:id/status")
  status(
    @Req() request: PrinterAgentRequest,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: PrinterJobStatusDto,
  ) {
    return this.fulfillment.setPrintJobStatus(
      request.printerAgent!,
      id,
      key,
      input,
    );
  }
}
