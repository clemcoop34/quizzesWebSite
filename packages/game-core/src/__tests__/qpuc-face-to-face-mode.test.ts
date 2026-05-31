import { describe, expect, it } from "vitest";
import { QpucFaceToFaceMode } from "../modes/qpuc-face-to-face-mode.js";
import { players } from "./helpers.js";

const faceToFaceQuiz = {
  id: "quiz-face",
  title: "Face quiz",
  questions: [],
  qpucQuestions: [
    {
      id: "question-1",
      theme: "Géographie",
      answer: "Paris",
      acceptedAnswers: ["Paris"],
      clues: [
        "Capitale européenne",
        "Ville traversée par un fleuve",
        "Son fleuve est la Seine",
        "Capitale de la France"
      ]
    }
  ]
};

describe("QpucFaceToFaceMode", () => {
  it("requires exactly two players", () => {
    const mode = new QpucFaceToFaceMode();

    expect(() =>
      mode.initialize({
        sessionId: "session-1",
        roomCode: "ABCD12",
        modeId: "qpuc_face_to_face",
        quiz: faceToFaceQuiz,
        players: [players[0]]
      })
    ).toThrow("exactement à 2 joueurs");
  });

  it("awards speed points to the first correct answer", () => {
    const mode = new QpucFaceToFaceMode();
    const state = mode.initialize({
      sessionId: "session-1",
      roomCode: "ABCD12",
      modeId: "qpuc_face_to_face",
      quiz: faceToFaceQuiz,
      players
    });
    const activeState = {
      ...state,
      status: "active" as const,
      questionStartedAt: "2026-01-01T00:00:00.000Z"
    };
    const secondPlayerAnswered = mode.acceptAnswer(
      activeState,
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-1",
        optionIds: [],
        textAnswer: "paris",
        validated: true
      },
      "player-2",
      new Date("2026-01-01T00:00:05.000Z")
    );
    const firstPlayerAnswered = mode.acceptAnswer(
      secondPlayerAnswered,
      {
        sessionId: "session-1",
        roomCode: "ABCD12",
        questionId: "question-1",
        optionIds: [],
        textAnswer: "Paris",
        validated: true
      },
      "player-1",
      new Date("2026-01-01T00:00:02.000Z")
    );

    const result = mode.endQuestion(firstPlayerAnswered, new Date("2026-01-01T00:00:24.000Z"));

    expect(result.payload.scores["player-1"]).toBe(4);
    expect(result.payload.scores["player-2"]).toBe(0);
    expect(result.payload.playerResults).toEqual([
      { playerId: "player-1", mistakes: 0, scoreRatio: 1, status: "perfect" },
      { playerId: "player-2", mistakes: 0, scoreRatio: 0, status: "partial" }
    ]);
  });
});
