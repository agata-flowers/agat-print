import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module";
import { UploadsModule } from "../uploads/uploads.module";
import {
  AdminPartnersController,
  PartnersController,
} from "./partners.controller";
import { PartnersService } from "./partners.service";
@Module({
  imports: [CommerceModule, UploadsModule],
  controllers: [PartnersController, AdminPartnersController],
  providers: [PartnersService],
})
export class PartnersModule {}
