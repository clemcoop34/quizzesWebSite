import { describe, expect, it } from "vitest";
import { ClassicMode, GameEngine, GameModeRegistry } from "../index.js";
import { MemoryGameStateStore, players, quiz } from "./helpers.js";

describe("GameEngine", () => {
  it("orchestrates start, answer, question end and finish", async () => {
    const registry = new GameModeRegistry();
    registry.register(new ClassicMode());
    const store = new MemoryGameStateStore();
    const engine = new GameEngine(registry, store);

    await engine.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "classic",
      quiz,
      players
    });

    const question = await engine.start("session-1", new Date("2026-01-01T00:00:00.000Z"));
    expect(question.question.id).toBe("question-1");

    const receipt = await engine.answer(
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-1",
        optionIds: ["option-1"]
      },
      "player-1",
      new Date("2026-01-01T00:00:01.000Z")
    );
    expect(receipt.playerId).toBe("player-1");

    const ended = await engine.endQuestion("session-1", new Date("2026-01-01T00:00:10.000Z"));
    expect(ended.scores["player-1"]).toBeGreaterThan(1000);

    const finished = await engine.finish("session-1");
    expect(finished.ranking[0]).toEqual({ playerId: "player-1", score: ended.scores["player-1"] });
  });

  it("reports when every player has validated the current question", async () => {
    const registry = new GameModeRegistry();
    registry.register(new ClassicMode());
    const store = new MemoryGameStateStore();
    const engine = new GameEngine(registry, store);

    await engine.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "classic",
      quiz,
      players
    });
    await engine.start("session-1", new Date("2026-01-01T00:00:00.000Z"));

    await engine.answer(
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-1",
        optionIds: ["option-1"],
        validated: true
      },
      "player-1",
      new Date("2026-01-01T00:00:01.000Z")
    );
    expect(await engine.haveAllPlayersValidatedCurrentQuestion("session-1")).toBe(false);

    await engine.answer(
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-1",
        optionIds: ["option-2"],
        validated: true
      },
      "player-2",
      new Date("2026-01-01T00:00:02.000Z")
    );
    expect(await engine.haveAllPlayersValidatedCurrentQuestion("session-1")).toBe(true);
  });
});
