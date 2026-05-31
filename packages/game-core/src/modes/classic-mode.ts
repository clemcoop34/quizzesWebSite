import type {
  GameAnswerPayload,
  GameFinishedPayload,
  GameQuestionEndedPayload,
  GameQuestionStartedPayload,
  Id,
  ImagePointDto,
  ImageRegionDto
} from "@quiz/shared";
import type { GameMode, GameSessionState, InitializeGameInput } from "../types.js";
import { calculateClassicQuestionDurationMs, CLASSIC_TIMING_CONFIG } from "../timing.js";

const CORRECT_ANSWER_POINTS = 1_000;
const MAX_SPEED_BONUS_POINTS = 500;
type AnswerGrade = {
  mistakes: number;
  scoreRatio: number;
  status: "perfect" | "partial" | "wrong";
};

export class ClassicMode implements GameMode {
  readonly id = "classic" as const;

  initialize(input: InitializeGameInput): GameSessionState {
    const scores = Object.fromEntries(input.players.map((player) => [player.id, 0]));

    return {
      sessionId: input.sessionId,
      roomCode: input.roomCode,
      quiz: input.quiz,
      players: input.players,
      modeId: this.id,
      status: "initialized",
      currentQuestionIndex: 0,
      questionDurationMs: input.questionDurationMs ?? CLASSIC_TIMING_CONFIG.fallbackQuestionDurationMs,
      questionTimingMode: input.timingMode ?? "dynamic_timer",
      answersByQuestion: {},
      scoredQuestionIds: [],
      scores
    };
  }

  buildQuestionStartedPayload(state: GameSessionState, now: Date): GameQuestionStartedPayload {
    const question = this.currentQuestion(state);
    const durationMs = this.durationForQuestion(state);
    const endsAt = durationMs ? new Date(now.getTime() + durationMs) : undefined;

    return {
      sessionId: state.sessionId,
      roomCode: state.roomCode,
      question: {
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        imageUrl: question.imageUrl,
        order: question.order,
        durationMs: durationMs ?? question.durationMs,
        options: question.options.map(({ id, label }) => ({ id, label }))
      },
      questionIndex: state.currentQuestionIndex,
      totalQuestions: state.quiz.questions.length,
      startedAt: now.toISOString(),
      endsAt: endsAt?.toISOString(),
      timingMode: state.questionTimingMode
    };
  }

  acceptAnswer(
    state: GameSessionState,
    payload: GameAnswerPayload,
    playerId: Id,
    now: Date
  ): GameSessionState {
    if (state.status !== "active") {
      throw new Error("Cannot answer before the game is active");
    }

    const question = this.currentQuestion(state);

    if (payload.questionId !== question.id) {
      throw new Error("Answer does not match current question");
    }

    const optionIds = new Set(question.options.map((option) => option.id));

    if (!payload.optionIds.every((optionId) => optionIds.has(optionId))) {
      throw new Error("Answer option does not belong to current question");
    }

    const playerExists = state.players.some((player) => player.id === playerId);

    if (!playerExists) {
      throw new Error("Player is not part of this game session");
    }

    const answersForQuestion = state.answersByQuestion[question.id] ?? {};

    return {
      ...state,
      answersByQuestion: {
        ...state.answersByQuestion,
        [question.id]: {
          ...answersForQuestion,
          [playerId]: {
            playerId,
            questionId: question.id,
            optionIds: [...new Set(payload.optionIds)],
            textAnswer: payload.textAnswer?.trim(),
            selectedPoint: payload.selectedPoint,
            answeredAt: now.toISOString(),
            validated: Boolean(payload.validated)
          }
        }
      }
    };
  }

  endQuestion(state: GameSessionState, now: Date): { state: GameSessionState; payload: GameQuestionEndedPayload } {
    const question = this.currentQuestion(state);
    const answersForQuestion = state.answersByQuestion[question.id] ?? {};
    const correctOptionIds = this.correctOptionIds(question.id, state);
    const nextScores = { ...state.scores };
    const playerResults = state.players.map((player) => {
      const answer = answersForQuestion[player.id];
      const grade = this.gradeAnswer(state, answer?.optionIds ?? [], answer?.textAnswer, correctOptionIds, answer?.selectedPoint);

      if (!state.scoredQuestionIds.includes(question.id) && answer && grade.scoreRatio > 0) {
        nextScores[player.id] =
          (nextScores[player.id] ?? 0) + Math.round(this.pointsForAnswer(state, answer.answeredAt, now) * grade.scoreRatio);
      }

      return {
        playerId: player.id,
        ...grade
      };
    });

    const nextState: GameSessionState = {
      ...state,
      scores: nextScores,
      scoredQuestionIds: state.scoredQuestionIds.includes(question.id)
        ? state.scoredQuestionIds
        : [...state.scoredQuestionIds, question.id],
      status: this.isLastQuestion(state) ? "finished" : state.status
    };

    return {
      state: nextState,
      payload: {
        sessionId: state.sessionId,
        roomCode: state.roomCode,
        questionId: question.id,
        correctOptionIds,
        correctRegions: question.type === "image_region" ? question.imageRegions ?? [] : undefined,
        questionExplanation:
          question.type === "image_region" && question.imageRegionExplanation?.trim()
            ? question.imageRegionExplanation.trim()
            : undefined,
        playerResults,
        explanations: question.options
          .filter((option) => option.explanation?.trim())
          .map((option) => ({
            optionId: option.id,
            label: option.label,
            explanation: option.explanation?.trim() ?? "",
            isCorrect: option.isCorrect
          })),
        scores: nextScores
      }
    };
  }

  isFinished(state: GameSessionState): boolean {
    return state.status === "finished" || this.isLastQuestion(state);
  }

  buildFinishedPayload(state: GameSessionState): GameFinishedPayload {
    const ranking = Object.entries(state.scores)
      .map(([playerId, score]) => ({ playerId, score }))
      .sort((a, b) => b.score - a.score);

    return {
      sessionId: state.sessionId,
      roomCode: state.roomCode,
      scores: state.scores,
      ranking
    };
  }

  private currentQuestion(state: GameSessionState) {
    const question = state.quiz.questions[state.currentQuestionIndex];

    if (!question) {
      throw new Error("No current question available");
    }

    return question;
  }

  private isLastQuestion(state: GameSessionState): boolean {
    return state.currentQuestionIndex >= state.quiz.questions.length - 1;
  }

  private durationForQuestion(state: GameSessionState): number | null {
    if (state.questionTimingMode === "no_timer") {
      return null;
    }

    return calculateClassicQuestionDurationMs(this.currentQuestion(state));
  }

  private correctOptionIds(questionId: Id, state: GameSessionState): Id[] {
    const sourceQuestion = state.quiz.questions.find((question) => question.id === questionId);
    const options = sourceQuestion?.options ?? [];

    return options.filter((option) => option.isCorrect).map((option) => option.id);
  }

  private gradeAnswer(
    state: GameSessionState,
    selectedOptionIds: Id[],
    textAnswer: string | undefined,
    correctOptionIds: Id[],
    selectedPoint?: ImagePointDto
  ): AnswerGrade {
    const question = this.currentQuestion(state);

    if (question.type === "open_text") {
      const isCorrect = this.matchesAcceptedText(textAnswer, question.acceptedTextAnswers ?? []);

      return {
        mistakes: isCorrect ? 0 : 1,
        scoreRatio: isCorrect ? 1 : 0,
        status: isCorrect ? "perfect" : "wrong"
      };
    }

    if (question.type === "image_region") {
      const isCorrect =
        selectedPoint !== undefined &&
        (question.imageRegions ?? []).some((region) => this.isPointInRegion(selectedPoint, region));

      return {
        mistakes: isCorrect ? 0 : 1,
        scoreRatio: isCorrect ? 1 : 0,
        status: isCorrect ? "perfect" : "wrong"
      };
    }

    const mistakes = this.countMultipleChoiceMistakes(selectedOptionIds, correctOptionIds);
    const scoreRatio = this.scoreRatioForMistakes(mistakes);

    return {
      mistakes,
      scoreRatio,
      status: scoreRatio === 1 ? "perfect" : scoreRatio > 0 ? "partial" : "wrong"
    };
  }

  private countMultipleChoiceMistakes(selectedOptionIds: Id[], correctOptionIds: Id[]): number {
    const selected = new Set(selectedOptionIds);
    const correct = new Set(correctOptionIds);
    const missingCorrectAnswers = correctOptionIds.filter((optionId) => !selected.has(optionId)).length;
    const selectedWrongAnswers = selectedOptionIds.filter((optionId) => !correct.has(optionId)).length;

    return missingCorrectAnswers + selectedWrongAnswers;
  }

  private scoreRatioForMistakes(mistakes: number): number {
    if (mistakes === 0) return 1;
    if (mistakes === 1) return 0.5;
    if (mistakes === 2) return 0.2;
    return 0;
  }

  private isPointInRegion(point: ImagePointDto, region: ImageRegionDto): boolean {
    const points = region.points;

    if (points.length < 3) {
      return false;
    }

    let inside = false;

    for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
      const currentPoint = points[current];
      const previousPoint = points[previous];
      const intersects =
        currentPoint.y > point.y !== previousPoint.y > point.y &&
        point.x <
          ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
            (previousPoint.y - currentPoint.y) +
            currentPoint.x;

      if (intersects) {
        inside = !inside;
      }
    }

    return inside;
  }

  private matchesAcceptedText(candidate: string | undefined, acceptedAnswers: string[]): boolean {
    const normalizedCandidate = this.normalizeText(candidate ?? "");

    if (!normalizedCandidate) {
      return false;
    }

    return acceptedAnswers.some((acceptedAnswer) => {
      const normalizedAccepted = this.normalizeText(acceptedAnswer);

      if (!normalizedAccepted) {
        return false;
      }

      if (normalizedCandidate === normalizedAccepted) {
        return true;
      }

      const maxDistance = normalizedAccepted.length <= 5 ? 1 : 2;
      return this.levenshtein(normalizedCandidate, normalizedAccepted) <= maxDistance;
    });
  }

  private normalizeText(value: string): string {
    return value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ");
  }

  private levenshtein(a: string, b: string): number {
    const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));

    for (let i = 0; i <= a.length; i += 1) {
      dp[i][0] = i;
    }

    for (let j = 0; j <= b.length; j += 1) {
      dp[0][j] = j;
    }

    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }

    return dp[a.length][b.length];
  }

  private pointsForAnswer(state: GameSessionState, answeredAt: string, fallbackNow: Date): number {
    if (!state.questionStartedAt) {
      return CORRECT_ANSWER_POINTS;
    }

    const startedAtMs = Date.parse(state.questionStartedAt);
    const answeredAtMs = Date.parse(answeredAt);
    const elapsedMs = Math.max(0, answeredAtMs - startedAtMs);
    const durationMs = this.durationForQuestion(state);

    if (!durationMs) {
      void fallbackNow;
      return CORRECT_ANSWER_POINTS;
    }

    const remainingRatio = Math.max(0, Math.min(1, (durationMs - elapsedMs) / durationMs));

    if (!Number.isFinite(remainingRatio)) {
      void fallbackNow;
      return CORRECT_ANSWER_POINTS;
    }

    return CORRECT_ANSWER_POINTS + Math.round(MAX_SPEED_BONUS_POINTS * remainingRatio);
  }
}
