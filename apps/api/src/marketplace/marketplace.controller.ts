import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import {
  ListingDecisionDto,
  ListingDraftDto,
  ListingSubmitDto,
  StudioPreferenceDto,
  StudioQueryDto,
} from "./dto";
import { MarketplaceService } from "./marketplace.service";

@Controller("studios")
export class StudioDiscoveryController {
  constructor(
    @Inject(MarketplaceService)
    private readonly marketplace: MarketplaceService,
  ) {}

  @Get()
  list(@Query() query: StudioQueryDto) {
    return this.marketplace.list(query);
  }

  @Get(":slug")
  detail(@Param("slug") slug: string, @Query("locale") locale?: string) {
    return this.marketplace.detail(slug, locale === "uz" ? "uz" : "ru");
  }
}

@Controller("order-drafts")
@UseGuards(AccessGuard, RolesGuard)
@Roles("CUSTOMER")
export class StudioPreferenceController {
  constructor(
    @Inject(MarketplaceService)
    private readonly marketplace: MarketplaceService,
  ) {}

  @Put(":id/studio-preference")
  set(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: StudioPreferenceDto,
  ) {
    return this.marketplace.setPreference(user.id, id, key, input);
  }

  @Delete(":id/studio-preference")
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ListingSubmitDto,
  ) {
    return this.marketplace.clearPreference(user.id, id, key, input.version);
  }
}

@Controller("partner/network/listing")
@UseGuards(AccessGuard, RolesGuard)
@Roles("PARTNER")
export class PartnerListingController {
  constructor(
    @Inject(MarketplaceService)
    private readonly marketplace: MarketplaceService,
  ) {}

  @Get()
  own(@CurrentUser() user: AuthenticatedUser) {
    return this.marketplace.partnerListings(user.id);
  }

  @Put("draft")
  draft(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ListingDraftDto,
  ) {
    return this.marketplace.saveDraft(user.id, key, input);
  }

  @Post(":id/submit")
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ListingSubmitDto,
  ) {
    return this.marketplace.submit(user.id, id, key, input.version);
  }
}

@Controller("admin/partner-listings")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class AdminListingController {
  constructor(
    @Inject(MarketplaceService)
    private readonly marketplace: MarketplaceService,
  ) {}

  @Get()
  queue() {
    return this.marketplace.moderationQueue();
  }

  @Post(":id/decision")
  decision(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ListingDecisionDto,
  ) {
    return this.marketplace.decide(user.id, id, key, input);
  }
}
