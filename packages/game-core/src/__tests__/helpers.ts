import type { GameQuiz, GameStateStore, GameSessionState } from "../types.js";

export class MemoryGameStateStore implements GameStateStore {
  private readonly states = new Map<string, GameSessionState>();

  async get(sessionId: string): Promise<GameSessionState | null> {
    return this.states.get(sessionId) ?? null;
  }

  async set(sessionId: string, state: GameSessionState): Promise<void> {
    this.states.set(sessionId, structuredClone(state));
  }

  async delete(sessionId: string): Promise<void> {
    this.states.delete(sessionId);
  }
}

export const quiz: GameQuiz = {
  id: "quiz-1",
  title: "Demo quiz",
  questions: [
    {
      id: "question-1",
      type: "multiple_choice",
      prompt: "Capital of France?",
      order: 1,
      durationMs: 10_000,
      options: [
        { id: "option-1", label: "Paris", isCorrect: true },
        { id: "option-2", label: "Lyon", isCorrect: false }
      ]
    },
    {
      id: "question-2",
      type: "multiple_choice",
      prompt: "2 + 2?",
      order: 2,
      durationMs: 10_000,
      options: [
        { id: "option-3", label: "4", isCorrect: true },
        { id: "option-4", label: "5", isCorrect: false }
      ]
    }
  ]
};

export const players = [
  { id: "player-1", displayName: "Ada", score: 0, isHost: true },
  { id: "player-2", displayName: "Linus", score: 0, isHost: false }
];
