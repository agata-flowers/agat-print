import {
  Body,
  Controller,
  Get,
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
import { CreatePartnerDto } from "./dto";
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
  @Get("me") own(@CurrentUser() user: AuthenticatedUser) {
    return this.partners.own(user.id);
  }

  @Get("workspace")
  @UseGuards(RolesGuard)
  @Roles("PARTNER")
  workspace(@CurrentUser() user: AuthenticatedUser) {
    return this.partners.own(user.id);
  }
}

@Controller("admin/partners")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class AdminPartnersController {
  constructor(
    @Inject(PartnersService) private readonly partners: PartnersService,
  ) {}
  @Post(":partnerId/approve") approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("partnerId", ParseUUIDPipe) id: string,
  ) {
    return this.partners.approve(id, user.id);
  }
}
