import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import {
  CreatePartnerDraftDto,
  CreatePartnerDto,
  ModeratePartnerDto,
  UpdateBranchProfileDto,
  UpdatePartnerProfileDto,
} from "./dto";
import { PartnersService } from "./partners.service";

@Controller("partners")
@UseGuards(AccessGuard)
export class PartnersController {
  constructor(
    @Inject(PartnersService) private readonly partners: PartnersService,
  ) {}
  @Post() create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: CreatePartnerDto,
  ) {
    return this.partners.create(user.id, input);
  }

  @Post("draft")
  draft(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreatePartnerDraftDto,
  ) {
    return this.partners.createDraft(user.id, key, input);
  }

  @Post("me/submit")
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.partners.submit(user.id, key);
  }

  @Patch("me/profile")
  profile(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: UpdatePartnerProfileDto,
  ) {
    return this.partners.updateProfile(user.id, key, input);
  }
  @Get("me") own(@CurrentUser() user: AuthenticatedUser) {
    return this.partners.own(user.id);
  }

  @Get("workspace")
  @UseGuards(RolesGuard)
  @Roles("PARTNER")
  workspace(@CurrentUser() user: AuthenticatedUser) {
    return this.partners.own(user.id);
  }

  @Patch("me/branches/:branchId")
  @UseGuards(RolesGuard)
  @Roles("PARTNER")
  branch(
    @CurrentUser() user: AuthenticatedUser,
    @Param("branchId", new ParseUUIDPipe()) branchId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: UpdateBranchProfileDto,
  ) {
    return this.partners.updateBranch(user.id, branchId, key, input);
  }
}

@Controller("admin/partners")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class AdminPartnersController {
  constructor(
    @Inject(PartnersService) private readonly partners: PartnersService,
  ) {}
  @Get()
  list() {
    return this.partners.list();
  }

  @Post(":partnerId/approve") approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("partnerId", ParseUUIDPipe) id: string,
  ) {
    return this.partners.approve(id, user.id);
  }

  @Post(":partnerId/lifecycle")
  lifecycle(
    @CurrentUser() user: AuthenticatedUser,
    @Param("partnerId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ModeratePartnerDto,
  ) {
    return this.partners.moderate(id, user.id, key, input);
  }
}
