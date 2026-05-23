import { Module } from "@nestjs/common";
import { GameModesModule } from "../game-modes/game-modes.module.js";
import { GamesService } from "./games.service.js";

@Module({
  imports: [GameModesModule],
  providers: [GamesService],
  exports: [GamesService]
})
export class GamesModule {}
