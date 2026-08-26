import { Module } from "@nestjs/common";
import { AdminBootstrapService } from "./admin-bootstrap.service";

@Module({
  providers: [AdminBootstrapService],
  exports: [AdminBootstrapService],
})
export class AdminModule {}
