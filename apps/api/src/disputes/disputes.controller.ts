import {
  Body,
  Controller,
  Delete,
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
import {
  CreateLegalHoldDto,
  OpenDisputeDto,
  PartnerDisputeResponseDto,
  ResolveDisputeDto,
} from "./dto";
import { DisputesService } from "./disputes.service";

@Controller()
@UseGuards(AccessGuard, RolesGuard)
@Roles("CUSTOMER")
export class CustomerDisputesController {
  constructor(
    @Inject(DisputesService) private readonly disputes: DisputesService,
  ) {}

  @Post("orders/:id/disputes")
  open(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: OpenDisputeDto,
  ) {
    return this.disputes.open(user.id, id, key, input);
  }

  @Get("orders/:id/disputes")
  own(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.disputes.own(user.id, id);
  }

  @Post("disputes/:id/cancel")
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.disputes.cancel(user.id, id, key);
  }
}

@Controller("partner/disputes")
@UseGuards(AccessGuard, RolesGuard)
@Roles("PARTNER")
export class PartnerDisputesController {
  constructor(
    @Inject(DisputesService) private readonly disputes: DisputesService,
  ) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.disputes.partnerList(user.id);
  }
  @Post(":id/response")
  respond(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: PartnerDisputeResponseDto,
  ) {
    return this.disputes.partnerRespond(user.id, id, key, input);
  }
}

@Controller("admin")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class AdminDisputesController {
  constructor(
    @Inject(DisputesService) private readonly disputes: DisputesService,
  ) {}
  @Get("disputes") list() {
    return this.disputes.adminList();
  }
  @Get("disputes/:id") detail(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.disputes.adminDetail(id);
  }
  @Post("disputes/:id/decision")
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ResolveDisputeDto,
  ) {
    return this.disputes.resolve(user.id, id, key, input);
  }
  @Post("orders/:id/retention-holds")
  hold(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateLegalHoldDto,
  ) {
    return this.disputes.createHold(user.id, id, key, input);
  }
  @Delete("orders/:orderId/retention-holds/:holdId")
  release(
    @CurrentUser() user: AuthenticatedUser,
    @Param("orderId", new ParseUUIDPipe()) orderId: string,
    @Param("holdId", new ParseUUIDPipe()) holdId: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.disputes.releaseHold(user.id, orderId, holdId, key);
  }
  @Get("retention") retention() {
    return this.disputes.retentionStatus();
  }
}
