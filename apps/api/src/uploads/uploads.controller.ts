import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AccessGuard } from "../auth/access.guard";
import { CurrentUser } from "../common/current-user.decorator";
import type { AuthenticatedUser } from "../common/request-user";
import type { AppEnvironment } from "../config/environment";
import { CreateUploadSessionDto } from "./dto";
import { APP_ENVIRONMENT } from "./private-object-storage.service";
import { UploadService } from "./upload.service";

async function readLimited(request: Request, limit: number): Promise<Buffer> {
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

@Controller("uploads")
@UseGuards(AccessGuard)
export class UploadsController {
  constructor(
    @Inject(UploadService) private readonly uploads: UploadService,
    @Inject(APP_ENVIRONMENT) private readonly env: AppEnvironment,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateUploadSessionDto,
  ) {
    return this.uploads.create(user.id, dto);
  }

  @Put(":id/content")
  async putContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Req() request: Request,
  ) {
    const value = await readLimited(request, this.env.uploadMaxFileBytes);
    return this.uploads.putContent(user.id, id, value);
  }

  @Delete(":id")
  @HttpCode(204)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.uploads.cancel(user.id, id);
  }
}
