import {
  Body,
  Controller,
  Get,
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
  ConfirmLayoutDto,
  GenerateLayoutDto,
  ManualReviewDecisionDto,
} from "./dto";
import { LayoutsService } from "./layouts.service";

@Controller("layouts")
@UseGuards(AccessGuard)
export class LayoutsController {
  constructor(private readonly layouts: LayoutsService) {}

  @Post()
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: GenerateLayoutDto,
  ) {
    return this.layouts.generate(user.id, body);
  }

  @Get(":id")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.layouts.own(user.id, id);
  }

  @Get(":id/preview-url")
  previewUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.layouts.previewUrl(user.id, id);
  }

  @Post(":id/confirm")
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: ConfirmLayoutDto,
  ) {
    return this.layouts.confirm(user.id, id, body);
  }
}

@Controller("admin/manual-reviews")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class ManualReviewsController {
  constructor(private readonly layouts: LayoutsService) {}

  @Get()
  queue() {
    return this.layouts.manualQueue();
  }

  @Get(":id/preview-url")
  previewUrl(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.layouts.manualPreviewUrl(id);
  }

  @Post(":id/decision")
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: ManualReviewDecisionDto,
  ) {
    return this.layouts.decideManualReview(user.id, id, body);
  }
}
