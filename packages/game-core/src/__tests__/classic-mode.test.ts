import { describe, expect, it } from "vitest";
import { ClassicMode } from "../modes/classic-mode.js";
import { players, quiz } from "./helpers.js";

describe("ClassicMode", () => {
  it("updates answers until the question ends", () => {
    const mode = new ClassicMode();
    const state = mode.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "classic",
      quiz,
      players
    });

    const activeState = {
      ...state,
      status: "active" as const,
      questionStartedAt: "2026-01-01T00:00:00.000Z"
    };

    const answered = mode.acceptAnswer(
      activeState,
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-1",
        optionIds: ["option-1"]
      },
      "player-1",
      new Date("2026-01-01T00:00:02.000Z")
    );

    const updated = mode.acceptAnswer(
      answered,
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-1",
        optionIds: ["option-2"]
      },
      "player-1",
      new Date("2026-01-01T00:00:03.000Z")
    );

    const result = mode.endQuestion(updated, new Date("2026-01-01T00:00:10.000Z"));

    expect(Object.values(result.state.answersByQuestion["question-1"])).toHaveLength(1);
    expect(result.payload.correctOptionIds).toEqual(["option-1"]);
    expect(result.state.answersByQuestion["question-1"]["player-1"].optionIds).toEqual(["option-2"]);
    expect(result.payload.playerResults.find((player) => player.playerId === "player-1")).toMatchObject({
      mistakes: 2,
      scoreRatio: 0.2,
      status: "partial"
    });
    expect(result.payload.scores["player-1"]).toBeGreaterThan(0);
    expect(result.payload.scores["player-2"]).toBe(0);
  });

  it("rejects answers for a non-current question", () => {
    const mode = new ClassicMode();
    const state = mode.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "classic",
      quiz,
      players
    });

    expect(() =>
      mode.acceptAnswer(
        { ...state, status: "active" },
        {
          sessionId: "session-1",
          roomCode: "ABCD12",
          questionId: "question-2",
          optionIds: ["option-3"]
        },
        "player-1",
        new Date()
      )
    ).toThrow("Answer does not match current question");
  });

  it("scores open text answers with case, accent and typo tolerance", () => {
    const mode = new ClassicMode();
    const state = mode.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "classic",
      quiz: {
        id: "quiz-open",
        title: "Open quiz",
        questions: [
          {
            id: "question-open",
            type: "open_text",
            prompt: "Capitale de la France ?",
            order: 1,
            durationMs: 10_000,
            acceptedTextAnswers: ["Paris"],
            options: []
          }
        ]
      },
      players
    });

    const answered = mode.acceptAnswer(
      { ...state, status: "active", questionStartedAt: "2026-01-01T00:00:00.000Z" },
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-open",
        optionIds: [],
        textAnswer: "pariis"
      },
      "player-1",
      new Date("2026-01-01T00:00:02.000Z")
    );
    const result = mode.endQuestion(answered, new Date("2026-01-01T00:00:10.000Z"));

    expect(result.payload.scores["player-1"]).toBeGreaterThan(0);
  });

  it("scores multiple choice answers with partial credit by mistake count", () => {
    const mode = new ClassicMode();
    const state = mode.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "classic",
      quiz: {
        id: "quiz-partial",
        title: "Partial quiz",
        questions: [
          {
            id: "question-partial",
            type: "multiple_choice",
            prompt: "Choose correct options",
            order: 1,
            durationMs: 10_000,
            options: [
              { id: "option-1", label: "A", isCorrect: true },
              { id: "option-2", label: "B", isCorrect: true },
              { id: "option-3", label: "C", isCorrect: false }
            ]
          }
        ]
      },
      players
    });

    const playerOneAnswered = mode.acceptAnswer(
      { ...state, status: "active", questionStartedAt: "2026-01-01T00:00:00.000Z" },
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-partial",
        optionIds: ["option-1", "option-2"]
      },
      "player-1",
      new Date("2026-01-01T00:00:02.000Z")
    );
    const playerTwoAnswered = mode.acceptAnswer(
      playerOneAnswered,
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-partial",
        optionIds: ["option-1"]
      },
      "player-2",
      new Date("2026-01-01T00:00:02.000Z")
    );

    const result = mode.endQuestion(playerTwoAnswered, new Date("2026-01-01T00:00:10.000Z"));

    expect(result.payload.playerResults).toEqual([
      { playerId: "player-1", mistakes: 0, scoreRatio: 1, status: "perfect" },
      { playerId: "player-2", mistakes: 1, scoreRatio: 0.5, status: "partial" }
    ]);
    expect(result.payload.scores["player-2"]).toBe(Math.round(result.payload.scores["player-1"] * 0.5));
  });

  it("scores image region answers when the selected point is inside a correct polygon", () => {
    const mode = new ClassicMode();
    const state = mode.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "classic",
      quiz: {
        id: "quiz-region",
        title: "Region quiz",
        questions: [
          {
            id: "question-region",
            type: "image_region",
            prompt: "Point to the target",
            imageUrl: "data:image/png;base64,demo",
            imageRegions: [
              {
                id: "region-1",
                points: [
                  { x: 0.2, y: 0.2 },
                  { x: 0.8, y: 0.2 },
                  { x: 0.8, y: 0.8 },
                  { x: 0.2, y: 0.8 }
                ]
              }
            ],
            order: 1,
            durationMs: 10_000,
            options: []
          }
        ]
      },
      players
    });

    const playerOneAnswered = mode.acceptAnswer(
      { ...state, status: "active", questionStartedAt: "2026-01-01T00:00:00.000Z" },
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-region",
        optionIds: [],
        selectedPoint: { x: 0.5, y: 0.5 }
      },
      "player-1",
      new Date("2026-01-01T00:00:02.000Z")
    );
    const playerTwoAnswered = mode.acceptAnswer(
      playerOneAnswered,
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-region",
        optionIds: [],
        selectedPoint: { x: 0.9, y: 0.9 }
      },
      "player-2",
      new Date("2026-01-01T00:00:02.000Z")
    );

    const result = mode.endQuestion(playerTwoAnswered, new Date("2026-01-01T00:00:10.000Z"));

    expect(result.payload.correctRegions).toHaveLength(1);
    expect(result.payload.playerResults).toEqual([
      { playerId: "player-1", mistakes: 0, scoreRatio: 1, status: "perfect" },
      { playerId: "player-2", mistakes: 1, scoreRatio: 0, status: "wrong" }
    ]);
  });
});
