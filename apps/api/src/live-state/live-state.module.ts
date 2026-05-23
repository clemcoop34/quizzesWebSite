import { Global, Module } from "@nestjs/common";
import { LiveStateService } from "./live-state.service.js";

@Global()
@Module({
  providers: [LiveStateService],
  exports: [LiveStateService]
})
export class LiveStateModule {}
