export type Id = string;

export type GameModeId = "classic" | "qpuc_face_to_face";
export type QuestionType = "multiple_choice" | "image_multiple_choice" | "image_region" | "open_text";
export type QuizReportReason = "wrong_content" | "offensive_content" | "incorrect_uness_metadata" | "other";

export const QUIZ_REPORT_HIDE_THRESHOLD = 3;
export const QUIZ_CORRECTION_FILTER_THRESHOLD = 20;

export const GAME_MODE_DEFINITIONS: Record<GameModeId, { label: string; shortLabel: string; description: string }> = {
  classic: {
    label: "Classic",
    shortLabel: "Classic",
    description: "Mode QCM classique compatible avec les quiz standards."
  },
  qpuc_face_to_face: {
    label: "Face-à-face",
    shortLabel: "Face-à-face",
    description: "Duel à 2 joueurs inspiré de Questions pour un champion."
  }
};

export const CLASSIC_TIMING_CONFIG = {
  fallbackQuestionDurationMs: 20_000,
  baseQuestionTimeMs: 8_000,
  timePerWordMs: 650,
  minQuestionDurationMs: 12_000,
  maxQuestionDurationMs: 90_000
};

export const QPUC_BUZZ_ANSWER_TIME_MS = 10_000;

export interface TimedQuestionTextInput {
  prompt: string;
  options?: Array<{ label: string }>;
  acceptedTextAnswers?: string[];
}

export function calculateClassicQuestionDurationMs(question: TimedQuestionTextInput): number {
  const wordCount = countWords([
    question.prompt,
    ...(question.options ?? []).map((option) => option.label),
    ...(question.acceptedTextAnswers ?? [])
  ].join(" "));

  if (wordCount === 0) {
    return CLASSIC_TIMING_CONFIG.fallbackQuestionDurationMs;
  }

  const durationMs = CLASSIC_TIMING_CONFIG.baseQuestionTimeMs + wordCount * CLASSIC_TIMING_CONFIG.timePerWordMs;

  return clamp(
    Math.round(durationMs),
    CLASSIC_TIMING_CONFIG.minQuestionDurationMs,
    CLASSIC_TIMING_CONFIG.maxQuestionDurationMs
  );
}

export function calculateQpucQuestionDurationMs(clues: string[]): number {
  return calculateClassicQuestionDurationMs({
    prompt: clues.join(" ")
  });
}

export type RoomStatus = "lobby" | "playing" | "finished";
export type GameSessionStatus = "initialized" | "active" | "finished";
export type GameQuestionTimingMode = "dynamic_timer" | "no_timer";

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
  clues?: string[];
  order: number;
  durationMs: number;
  options: AnswerOptionDto[];
}

export interface QuizDto {
  id: Id;
  title: string;
  questions: QuestionDto[];
  qpucQuestions?: QpucProgressiveQuestionDto[];
}

export interface QpucProgressiveQuestionDto {
  id: Id;
  theme?: string;
  answer: string;
  acceptedAnswers: string[];
  clues: string[];
  sourceReference?: string;
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
  compatibleGameModes: GameModeId[];
  qpucQuestionCount: number;
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

export interface ReturnToLobbyPayload {
  code: string;
}

export interface StartGamePayload {
  roomCode: string;
  quizId: Id;
  modeId: GameModeId;
  timingMode?: GameQuestionTimingMode;
  questionLimit?: number;
}

export interface GameQuestionStartedPayload {
  sessionId: Id;
  roomCode: string;
  question: QuestionDto;
  questionIndex: number;
  totalQuestions: number;
  startedAt: string;
  endsAt?: string;
  timingMode: GameQuestionTimingMode;
  pointsAvailable?: number;
  handPlayerId?: Id;
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
  hasAnswer: boolean;
  validated: boolean;
  textAnswer?: string;
  isCorrect?: boolean;
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

export interface GameBuzzPayload {
  sessionId: Id;
  roomCode: string;
  questionId: Id;
}

export interface GameBuzzStartedPayload {
  sessionId: Id;
  roomCode: string;
  questionId: Id;
  playerId: Id;
  answerEndsAt: string;
}

export interface GameBuzzEndedPayload {
  sessionId: Id;
  roomCode: string;
  questionId: Id;
  endsAt?: string;
  handPlayerId?: Id;
  segmentIndex?: number;
  wrongPlayerId?: Id;
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
  "room:return_to_lobby": (payload: ReturnToLobbyPayload) => void;
  "game:start": (payload: StartGamePayload) => void;
  "game:buzz": (payload: GameBuzzPayload) => void;
  "game:answer": (payload: GameAnswerPayload) => void;
  "game:skip_explanations": (payload: GameSkipExplanationsPayload) => void;
}

export interface ServerToClientEvents {
  "room:state_updated": (payload: RoomStateDto) => void;
  "game:question_started": (payload: GameQuestionStartedPayload) => void;
  "game:buzz_started": (payload: GameBuzzStartedPayload) => void;
  "game:buzz_ended": (payload: GameBuzzEndedPayload) => void;
  "game:answer_received": (payload: GameAnswerReceivedPayload) => void;
  "game:question_ended": (payload: GameQuestionEndedPayload) => void;
  "game:finished": (payload: GameFinishedPayload) => void;
  error: (payload: ErrorPayload) => void;
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface QuizCompatibilityInput {
  sourceType?: string | null;
  qpucQuestions?: unknown;
  questionCount?: number;
  questions?: Array<{
    type?: string | null;
    acceptedTextAnswers?: string[] | null;
  }>;
}

export function getCompatibleGameModesForQuiz(quiz: QuizCompatibilityInput): GameModeId[] {
  const hasClassicQuestions = quiz.questions ? quiz.questions.length > 0 : (quiz.questionCount ?? 1) > 0;
  const modes: GameModeId[] = hasClassicQuestions ? ["classic"] : [];
  const qpucQuestions = parseQpucProgressiveQuestions(quiz.qpucQuestions);

  return qpucQuestions.length > 0 ? [...modes, "qpuc_face_to_face"] : modes;
}

export function parseQpucProgressiveQuestions(value: unknown): QpucProgressiveQuestionDto[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((question, index): QpucProgressiveQuestionDto | null => {
      if (!question || typeof question !== "object") {
        return null;
      }

      const candidate = question as {
        id?: unknown;
        theme?: unknown;
        answer?: unknown;
        acceptedAnswers?: unknown;
        clues?: unknown;
        sourceReference?: unknown;
      };
      const answer = typeof candidate.answer === "string" ? candidate.answer.trim() : "";
      const clues = Array.isArray(candidate.clues)
        ? candidate.clues.filter((clue): clue is string => typeof clue === "string").map((clue) => clue.trim()).filter(Boolean)
        : [];
      const acceptedAnswers = Array.isArray(candidate.acceptedAnswers)
        ? candidate.acceptedAnswers
            .filter((acceptedAnswer): acceptedAnswer is string => typeof acceptedAnswer === "string")
            .map((acceptedAnswer) => acceptedAnswer.trim())
            .filter(Boolean)
        : [];

      if (!answer || clues.length === 0) {
        return null;
      }

      const parsedQuestion: QpucProgressiveQuestionDto = {
        id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `qpuc-${index + 1}`,
        answer,
        acceptedAnswers: [...new Set([answer, ...acceptedAnswers])],
        clues
      };

      if (typeof candidate.theme === "string" && candidate.theme.trim()) {
        parsedQuestion.theme = candidate.theme.trim();
      }

      if (typeof candidate.sourceReference === "string" && candidate.sourceReference.trim()) {
        parsedQuestion.sourceReference = candidate.sourceReference.trim();
      }

      return parsedQuestion;
    })
    .filter((question): question is QpucProgressiveQuestionDto => question !== null);
}
