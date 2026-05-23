export type Id = string;

export type GameModeId = "classic";
export type QuestionType = "multiple_choice" | "image_multiple_choice" | "image_region" | "open_text";
export type QuizReportReason = "wrong_content" | "offensive_content" | "incorrect_uness_metadata" | "other";

export const QUIZ_REPORT_HIDE_THRESHOLD = 3;
export const QUIZ_CORRECTION_FILTER_THRESHOLD = 20;

export type RoomStatus = "lobby" | "playing" | "finished";
export type GameSessionStatus = "initialized" | "active" | "finished";

export interface ImagePointDto {
  x: number;
  y: number;
}

export interface ImageRegionDto {
  id: Id;
  points: ImagePointDto[];
}

export interface AnswerOptionDto {
  id: Id;
  label: string;
  explanation?: string;
}

export interface QuestionDto {
  id: Id;
  type: QuestionType;
  prompt: string;
  imageUrl?: string;
  order: number;
  durationMs: number;
  options: AnswerOptionDto[];
}

export interface QuizDto {
  id: Id;
  title: string;
  questions: QuestionDto[];
}

export interface RoomQuizPreviewDto {
  id: Id;
  title: string;
  correctionPercent: number;
  sourceType?: string;
  sourceCity?: string;
  sourceYear?: string;
  trainingYear?: string;
  tags: string[];
  questions: Array<{
    id: Id;
    prompt: string;
  }>;
}

export interface PlayerDto {
  id: Id;
  displayName: string;
  score: number;
  isHost: boolean;
}

export interface RoomStateDto {
  code: string;
  status: RoomStatus;
  quizId?: Id;
  quiz?: RoomQuizPreviewDto;
  hostPlayerId?: Id;
  currentPlayerId?: Id;
  players: PlayerDto[];
}

export interface JoinRoomPayload {
  code: string;
  displayName: string;
  playerId?: Id;
}

export interface WatchRoomPayload {
  code: string;
  playerId?: Id;
}

export interface SelectRoomQuizPayload {
  code: string;
  quizId: Id;
}

export interface StartGamePayload {
  roomCode: string;
  quizId: Id;
  modeId: GameModeId;
}

export interface GameQuestionStartedPayload {
  sessionId: Id;
  roomCode: string;
  question: QuestionDto;
  questionIndex: number;
  totalQuestions: number;
  startedAt: string;
  endsAt: string;
}

export interface GameAnswerPayload {
  sessionId: Id;
  roomCode: string;
  questionId: Id;
  optionIds: Id[];
  textAnswer?: string;
  selectedPoint?: ImagePointDto;
  validated?: boolean;
}

export interface GameAnswerReceivedPayload {
  sessionId: Id;
  questionId: Id;
  playerId: Id;
  receivedAt: string;
}

export interface GameQuestionEndedPayload {
  sessionId: Id;
  roomCode: string;
  questionId: Id;
  correctOptionIds: Id[];
  correctRegions?: ImageRegionDto[];
  questionExplanation?: string;
  playerResults: Array<{
    playerId: Id;
    status: "perfect" | "partial" | "wrong";
    mistakes: number;
    scoreRatio: number;
  }>;
  explanations: Array<{
    optionId: Id;
    label: string;
    explanation: string;
    isCorrect: boolean;
  }>;
  scores: Record<Id, number>;
}

export interface GameSkipExplanationsPayload {
  sessionId: Id;
  roomCode: string;
  questionId: Id;
}

export interface GameFinishedPayload {
  sessionId: Id;
  roomCode: string;
  scores: Record<Id, number>;
  ranking: Array<{
    playerId: Id;
    score: number;
  }>;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ClientToServerEvents {
  "room:watch": (payload: WatchRoomPayload) => void;
  "room:join": (payload: JoinRoomPayload) => void;
  "room:quiz_select": (payload: SelectRoomQuizPayload) => void;
  "game:start": (payload: StartGamePayload) => void;
  "game:answer": (payload: GameAnswerPayload) => void;
  "game:skip_explanations": (payload: GameSkipExplanationsPayload) => void;
}

export interface ServerToClientEvents {
  "room:state_updated": (payload: RoomStateDto) => void;
  "game:question_started": (payload: GameQuestionStartedPayload) => void;
  "game:answer_received": (payload: GameAnswerReceivedPayload) => void;
  "game:question_ended": (payload: GameQuestionEndedPayload) => void;
  "game:finished": (payload: GameFinishedPayload) => void;
  error: (payload: ErrorPayload) => void;
}
