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
  CreateAvailabilityDto,
  CreateCapabilityVersionDto,
  CreateCapacityVersionDto,
  CreateCatalogVersionDto,
  CreateOperationalVersionDto,
  OfferDecisionDto,
  ProductionStatusDto,
} from "./dto";
import { MatchingService } from "./matching.service";
import { PartnerNetworkService } from "./partner-network.service";

@Controller("partner")
@UseGuards(AccessGuard, RolesGuard)
@Roles("PARTNER")
export class PartnerMatchingController {
  constructor(
    @Inject(MatchingService) private readonly matching: MatchingService,
    @Inject(PartnerNetworkService)
    private readonly network: PartnerNetworkService,
  ) {}

  @Post("network/branches/:id/capabilities")
  capability(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateCapabilityVersionDto,
  ) {
    return this.network.capability(user.id, id, key, input);
  }

  @Post("network/branches/:id/operations")
  operational(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateOperationalVersionDto,
  ) {
    return this.network.operational(user.id, id, key, input);
  }

  @Post("network/branches/:id/catalogs")
  catalog(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateCatalogVersionDto,
  ) {
    return this.network.catalog(user.id, id, key, input);
  }

  @Post("network/branches/:id/capacity")
  capacity(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateCapacityVersionDto,
  ) {
    return this.network.capacity(user.id, id, key, input);
  }

  @Post("network/branches/:id/availability")
  availability(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateAvailabilityDto,
  ) {
    return this.network.availability(user.id, id, key, input);
  }

  @Post("network/branches/:id/availability/:availabilityId/cancel")
  cancelAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("availabilityId", new ParseUUIDPipe()) availabilityId: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.network.cancelAvailability(user.id, id, availabilityId, key);
  }

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
