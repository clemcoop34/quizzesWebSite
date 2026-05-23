import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module.js";
import { GameModesModule } from "./game-modes/game-modes.module.js";
import { GamesModule } from "./games/games.module.js";
import { LiveStateModule } from "./live-state/live-state.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { QuizzesModule } from "./quizzes/quizzes.module.js";
import { RealtimeModule } from "./realtime/realtime.module.js";
import { RoomsModule } from "./rooms/rooms.module.js";
import { HealthController } from "./health.controller.js";

@Module({
  imports: [
    PrismaModule,
    LiveStateModule,
    AuthModule,
    QuizzesModule,
    RoomsModule,
    GameModesModule,
    GamesModule,
    RealtimeModule
  ],
  controllers: [HealthController]
})
export class AppModule {}
