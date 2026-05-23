import type { GameMode } from "./types.js";
import type { GameModeId } from "@quiz/shared";

export class GameModeRegistry {
  private readonly modes = new Map<GameModeId, GameMode>();

  register(mode: GameMode): void {
    this.modes.set(mode.id, mode);
  }

  get(modeId: GameModeId): GameMode {
    const mode = this.modes.get(modeId);

    if (!mode) {
      throw new Error(`Unknown game mode: ${modeId}`);
    }

    return mode;
  }
}
