import { Module } from "@nestjs/common";
import { ClassicMode, GameModeRegistry } from "@quiz/game-core";

@Module({
  providers: [
    {
      provide: GameModeRegistry,
      useFactory: () => {
        const registry = new GameModeRegistry();
        registry.register(new ClassicMode());
        return registry;
      }
    }
  ],
  exports: [GameModeRegistry]
})
export class GameModesModule {}
