import { Module } from "@nestjs/common";
import { ClassicMode, GameModeRegistry, QpucFaceToFaceMode } from "@quiz/game-core";

@Module({
  providers: [
    {
      provide: GameModeRegistry,
      useFactory: () => {
        const registry = new GameModeRegistry();
        registry.register(new ClassicMode());
        registry.register(new QpucFaceToFaceMode());
        return registry;
      }
    }
  ],
  exports: [GameModeRegistry]
})
export class GameModesModule {}
