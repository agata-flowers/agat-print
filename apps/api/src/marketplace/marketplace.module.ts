import { Module } from "@nestjs/common";
import { CommerceModule } from "../commerce/commerce.module";
import { MatchingModule } from "../matching/matching.module";
import {
  AdminListingController,
  PartnerListingController,
  StudioDiscoveryController,
  StudioPreferenceController,
} from "./marketplace.controller";
import { MarketplaceService } from "./marketplace.service";

@Module({
  imports: [CommerceModule, MatchingModule],
  controllers: [
    StudioDiscoveryController,
    StudioPreferenceController,
    PartnerListingController,
    AdminListingController,
  ],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
