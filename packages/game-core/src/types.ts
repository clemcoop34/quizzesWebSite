import type {
  GameAnswerPayload,
  GameFinishedPayload,
  GameModeId,
  GameQuestionEndedPayload,
  GameQuestionStartedPayload,
  Id,
  ImagePointDto,
  ImageRegionDto,
  PlayerDto,
  QuestionDto
} from "@quiz/shared";

export interface GameAnswerOption {
  id: Id;
  label: string;
  isCorrect: boolean;
  explanation?: string;
}

export interface GameQuestion extends Omit<QuestionDto, "options"> {
  options: GameAnswerOption[];
  acceptedTextAnswers?: string[];
  imageRegions?: ImageRegionDto[];
  imageRegionExplanation?: string;
}

export interface GameQuiz {
  id: Id;
  title: string;
  questions: GameQuestion[];
}

export interface PlayerAnswerState {
  playerId: Id;
  questionId: Id;
  optionIds: Id[];
  textAnswer?: string;
  selectedPoint?: ImagePointDto;
  answeredAt: string;
  validated?: boolean;
}

export interface GameSessionState {
  sessionId: Id;
  roomCode: string;
  quiz: GameQuiz;
  players: PlayerDto[];
  modeId: GameModeId;
  status: "initialized" | "active" | "finished";
  currentQuestionIndex: number;
  questionStartedAt?: string;
  questionDurationMs: number;
  answersByQuestion: Record<Id, Record<Id, PlayerAnswerState>>;
  scoredQuestionIds: Id[];
  scores: Record<Id, number>;
}

export interface InitializeGameInput {
  sessionId: Id;
  roomCode: string;
  quiz: GameQuiz;
  players: PlayerDto[];
  modeId: GameModeId;
  questionDurationMs?: number;
}

export interface GameStateStore {
  get(sessionId: Id): Promise<GameSessionState | null>;
  set(sessionId: Id, state: GameSessionState): Promise<void>;
  delete(sessionId: Id): Promise<void>;
}

export interface GameMode {
  id: GameModeId;
  initialize(input: InitializeGameInput): GameSessionState;
  buildQuestionStartedPayload(state: GameSessionState, now: Date): GameQuestionStartedPayload;
  acceptAnswer(state: GameSessionState, payload: GameAnswerPayload, playerId: Id, now: Date): GameSessionState;
  endQuestion(state: GameSessionState, now: Date): {
    state: GameSessionState;
    payload: GameQuestionEndedPayload;
  };
  isFinished(state: GameSessionState): boolean;
  buildFinishedPayload(state: GameSessionState): GameFinishedPayload;
}
