import type {
  GameAnswerPayload,
  GameAnswerReceivedPayload,
  GameFinishedPayload,
  GameQuestionEndedPayload,
  GameQuestionStartedPayload,
  Id
} from "@quiz/shared";
import type { GameStateStore, GameSessionState, InitializeGameInput } from "./types.js";
import { GameModeRegistry } from "./game-mode-registry.js";

export class GameEngine {
  constructor(
    private readonly registry: GameModeRegistry,
    private readonly store: GameStateStore
  ) {}

  async initialize(input: InitializeGameInput): Promise<GameSessionState> {
    const mode = this.registry.get(input.modeId);
    const state = mode.initialize(input);
    await this.store.set(state.sessionId, state);

    return state;
  }

  async start(sessionId: Id, now = new Date()): Promise<GameQuestionStartedPayload> {
    const state = await this.mustGetState(sessionId);
    const mode = this.registry.get(state.modeId);
    const nextState: GameSessionState = {
      ...state,
      status: "active",
      currentQuestionIndex: 0,
      questionStartedAt: now.toISOString()
    };

    await this.store.set(sessionId, nextState);

    return mode.buildQuestionStartedPayload(nextState, now);
  }

  async answer(
    payload: GameAnswerPayload,
    playerId: Id,
    now = new Date()
  ): Promise<GameAnswerReceivedPayload> {
    const state = await this.mustGetState(payload.sessionId);
    const mode = this.registry.get(state.modeId);
    const nextState = mode.acceptAnswer(state, payload, playerId, now);
    const questionAnswers = nextState.answersByQuestion[payload.questionId] ?? {};
    const playerAnswer = questionAnswers[playerId];

    await this.store.set(payload.sessionId, nextState);

    return {
      sessionId: payload.sessionId,
      questionId: payload.questionId,
      playerId,
      receivedAt: now.toISOString(),
      hasAnswer: playerAnswer ? this.hasAnswerContent(playerAnswer) : false,
      validated: Boolean(playerAnswer?.validated)
    };
  }

  async haveAllPlayersValidatedCurrentQuestion(sessionId: Id): Promise<boolean> {
    const state = await this.mustGetState(sessionId);
    const question = state.quiz.questions[state.currentQuestionIndex];

    if (!question) {
      return false;
    }

    const answersForQuestion = state.answersByQuestion[question.id] ?? {};

    return state.players.length > 0 && state.players.every((player) => answersForQuestion[player.id]?.validated);
  }

  async endQuestion(sessionId: Id, now = new Date()): Promise<GameQuestionEndedPayload> {
    const state = await this.mustGetState(sessionId);
    const mode = this.registry.get(state.modeId);
    const result = mode.endQuestion(state, now);

    await this.store.set(sessionId, result.state);

    return result.payload;
  }

  async nextQuestion(sessionId: Id, now = new Date()): Promise<GameQuestionStartedPayload | null> {
    const state = await this.mustGetState(sessionId);
    const mode = this.registry.get(state.modeId);

    if (mode.isFinished(state)) {
      return null;
    }

    const nextState: GameSessionState = {
      ...state,
      status: "active",
      currentQuestionIndex: state.currentQuestionIndex + 1,
      questionStartedAt: now.toISOString()
    };

    await this.store.set(sessionId, nextState);

    return mode.buildQuestionStartedPayload(nextState, now);
  }

  async finish(sessionId: Id): Promise<GameFinishedPayload> {
    const state = await this.mustGetState(sessionId);
    const mode = this.registry.get(state.modeId);
    const finishedState: GameSessionState = {
      ...state,
      status: "finished"
    };

    await this.store.set(sessionId, finishedState);

    return mode.buildFinishedPayload(finishedState);
  }

  private async mustGetState(sessionId: Id): Promise<GameSessionState> {
    const state = await this.store.get(sessionId);

    if (!state) {
      throw new Error(`Game session not found: ${sessionId}`);
    }

    return state;
  }

  private hasAnswerContent(answer: { optionIds: Id[]; textAnswer?: string; selectedPoint?: unknown }): boolean {
    return answer.optionIds.length > 0 || Boolean(answer.textAnswer?.trim()) || Boolean(answer.selectedPoint);
  }
}
