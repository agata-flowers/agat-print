import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import { Roles } from "../common/roles.decorator";
import { RolesGuard } from "../common/roles.guard";
import {
  CreateOrderDraftDto,
  DraftVersionDto,
  LinkDraftResourceDto,
  PublishCatalogDto,
  StartDraftUploadDto,
  UpdateOrderDraftDto,
} from "./dto";
import { OrderingService } from "./ordering.service";
import { APP_ENVIRONMENT } from "../uploads/private-object-storage.service";
import type { AppEnvironment } from "../config/environment";

async function readLimited(request: Request, limit: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const raw of request) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    total += chunk.length;
    if (total > limit)
      throw new PayloadTooLargeException({ code: "FILE_SIZE_EXCEEDED" });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

@Controller("catalog")
export class CatalogController {
  constructor(
    @Inject(OrderingService) private readonly ordering: OrderingService,
  ) {}
  @Get()
  catalog(@Query("locale") locale?: string) {
    return this.ordering.catalog(locale === "uz" ? "uz" : "ru");
  }
}

@Controller()
@UseGuards(AccessGuard)
export class CustomerOrderingController {
  constructor(
    @Inject(OrderingService) private readonly ordering: OrderingService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}
  @Post("order-drafts") create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateOrderDraftDto,
  ) {
    return this.ordering.createDraft(user.id, key, input);
  }
  @Get("order-drafts") drafts(@CurrentUser() user: AuthenticatedUser) {
    return this.ordering.listDrafts(user.id);
  }
  @Get("order-drafts/:id") draft(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.ordering.ownDraft(user.id, id);
  }
  @Patch("order-drafts/:id/configuration") update(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: UpdateOrderDraftDto,
  ) {
    return this.ordering.updateDraft(user.id, id, key, input);
  }
  @Post("order-drafts/:id/upload") upload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: LinkDraftResourceDto,
  ) {
    return this.ordering.linkUpload(user.id, id, key, input);
  }
  @Post("order-drafts/:id/upload-session") startUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: StartDraftUploadDto,
  ) {
    return this.ordering.startUpload(user.id, id, key, input);
  }
  @Put("order-drafts/:id/content") async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Req() request: Request,
  ) {
    return this.ordering.putContent(
      user.id,
      id,
      await readLimited(request, this.env.uploadMaxFileBytes),
    );
  }
  @Post("order-drafts/:id/layout") layout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: LinkDraftResourceDto,
  ) {
    return this.ordering.linkLayout(user.id, id, key, input);
  }
  @Post("order-drafts/:id/create-layout") createLayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DraftVersionDto,
  ) {
    return this.ordering.createLayout(user.id, id, key, input);
  }
  @Get("order-drafts/:id/preview-url") preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.ordering.previewUrl(user.id, id);
  }
  @Post("order-drafts/:id/approve") approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DraftVersionDto,
  ) {
    return this.ordering.approve(user.id, id, key, input);
  }
  @Post("order-drafts/:id/sync") sync(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DraftVersionDto,
  ) {
    return this.ordering.syncDraft(user.id, id, key, input);
  }
  @Post("order-drafts/:id/quote") quote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DraftVersionDto,
  ) {
    return this.ordering.quote(user.id, id, key, input);
  }
  @Post("order-drafts/:id/checkout") checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DraftVersionDto,
  ) {
    return this.ordering.checkout(user.id, id, key, input);
  }
  @Delete("order-drafts/:id") cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DraftVersionDto,
  ) {
    return this.ordering.cancel(user.id, id, key, input);
  }
  @Get("orders") orders(@CurrentUser() user: AuthenticatedUser) {
    return this.ordering.ownOrders(user.id);
  }
  @Get("orders/:id/timeline") timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.ordering.timeline(user.id, id);
  }
  @Get("notifications") notifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query("locale") locale?: string,
  ) {
    return this.ordering.notifications(user.id, locale === "uz" ? "uz" : "ru");
  }
  @Post("notifications/:id/read") read(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    return this.ordering.readNotification(user.id, id, key);
  }
}

@Controller("admin/catalog")
@UseGuards(AccessGuard, RolesGuard)
@Roles("ADMIN")
export class AdminCatalogController {
  constructor(
    @Inject(OrderingService) private readonly ordering: OrderingService,
  ) {}
  @Post("versions") publish(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: PublishCatalogDto,
  ) {
    return this.ordering.publishCatalog(user.id, key, input);
  }
}
