import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module";
import {
  AdminPartnersController,
  PartnersController,
} from "./partners.controller";
import { PartnersService } from "./partners.service";
@Module({
  imports: [CommerceModule],
  controllers: [PartnersController, AdminPartnersController],
  providers: [PartnersService],
})
export class PartnersModule {}
