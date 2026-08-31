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
import {
  CreateCapabilityVersionDto,
  OfferDecisionDto,
  ProductionStatusDto,
} from "./dto";
import { MatchingService } from "./matching.service";

@Controller("partner")
@UseGuards(AccessGuard, RolesGuard)
@Roles("PARTNER")
export class PartnerMatchingController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}

  @Get("offers")
  offers(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.partnerOffers(user.id);
  }

  @Post("offers/:id/decision")
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: OfferDecisionDto,
  ) {
    return this.matching.decideOffer(user.id, id, key, input);
  }

  @Get("orders/active")
  active(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.activeOrder(user.id);
  }

  @Post("orders/:id/print-ready")
  printReady(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.matching.printReadyUrl(user.id, id, key);
  }

  @Post("orders/:id/status")
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ProductionStatusDto,
  ) {
    return this.matching.setProductionStatus(user.id, id, key, input);
  }
}

@Controller("admin")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class AdminMatchingController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
  ) {}

  @Post("branches/:id/capabilities")
  capability(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() input: CreateCapabilityVersionDto,
  ) {
    return this.matching.createCapability(user.id, id, input);
  }

  @Get("matching")
  history() {
    return this.matching.adminHistory();
  }
}
