import { Module } from "@nestjs/common";
import { GamesModule } from "../games/games.module.js";
import { RoomsModule } from "../rooms/rooms.module.js";
import { RealtimeGateway } from "./realtime.gateway.js";

@Module({
  imports: [GamesModule, RoomsModule],
  providers: [RealtimeGateway]
})
export class RealtimeModule {}
