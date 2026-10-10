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
  FulfillmentPreferenceDto,
  LinkDraftResourceDto,
  PublishCatalogDto,
  StartDraftUploadDto,
  UpdateOrderDraftDto,
  AddBasketItemDto,
  BasketFulfillmentPreferenceDto,
  BasketStudioPreferenceDto,
  BasketVersionDto,
  CreateBasketDto,
  ReorderBasketItemDto,
} from "./dto";
import { OrderingService } from "./ordering.service";
import { BasketService } from "./basket.service";
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
    return this.ordering.catalog(
      locale === "uz" || locale === "en" ? locale : "ru",
    );
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
  @Get("order-drafts/:id/fulfillment-options") fulfillmentOptions(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.ordering.fulfillmentOptions(user.id, id);
  }
  @Put("order-drafts/:id/fulfillment-preference") fulfillmentPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: FulfillmentPreferenceDto,
  ) {
    return this.ordering.setFulfillmentPreference(user.id, id, key, input);
  }
  @Delete("order-drafts/:id/fulfillment-preference") clearFulfillmentPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: DraftVersionDto,
  ) {
    return this.ordering.clearFulfillmentPreference(user.id, id, key, input);
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
    return this.ordering.notifications(
      user.id,
      locale === "uz" || locale === "en" ? locale : "ru",
    );
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

@Controller("baskets")
@UseGuards(AccessGuard)
export class CustomerBasketController {
  constructor(@Inject(BasketService) private readonly baskets: BasketService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateBasketDto,
  ) {
    return this.baskets.create(user.id, key, input);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.baskets.list(user.id);
  }

  @Get(":id")
  get(@CurrentUser() user: AuthenticatedUser, @Param("id") id: string) {
    return this.baskets.get(user.id, id);
  }

  @Post(":id/items")
  add(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: AddBasketItemDto,
  ) {
    return this.baskets.addItem(user.id, id, key, input);
  }

  @Patch(":id/items/:itemId")
  reorder(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ReorderBasketItemDto,
  ) {
    return this.baskets.reorderItem(user.id, id, itemId, key, input);
  }

  @Delete(":id/items/:itemId")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: BasketVersionDto,
  ) {
    return this.baskets.removeItem(user.id, id, itemId, key, input);
  }

  @Put(":id/studio-preference")
  studio(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: BasketStudioPreferenceDto,
  ) {
    return this.baskets.setStudio(user.id, id, key, input);
  }

  @Put(":id/fulfillment-preference")
  fulfillment(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: BasketFulfillmentPreferenceDto,
  ) {
    return this.baskets.setFulfillment(user.id, id, key, input);
  }

  @Post(":id/quote")
  quote(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: BasketVersionDto,
  ) {
    return this.baskets.quote(user.id, id, key, input);
  }

  @Post(":id/checkout")
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: BasketVersionDto,
  ) {
    return this.baskets.checkout(user.id, id, key, input);
  }
}
