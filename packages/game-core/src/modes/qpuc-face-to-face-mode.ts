import type {
  GameAnswerPayload,
  GameFinishedPayload,
  GameQuestionEndedPayload,
  GameQuestionStartedPayload,
  Id,
  QpucProgressiveQuestionDto
} from "@quiz/shared";
import { calculateQpucQuestionDurationMs } from "@quiz/shared";
import type { GameMode, GameSessionState, InitializeGameInput, PlayerAnswerState } from "../types.js";

const WINNING_SCORE = 9;

export class QpucFaceToFaceMode implements GameMode {
  readonly id = "qpuc_face_to_face" as const;

  initialize(input: InitializeGameInput): GameSessionState {
    if (input.players.length !== 2) {
      throw new Error("Le mode Face-à-face se joue exactement à 2 joueurs");
    }

    if (!input.quiz.qpucQuestions?.length) {
      throw new Error("Le mode Face-à-face requiert des questions à indices progressifs");
    }

    const hostPlayer = input.players.find((player) => player.isHost) ?? input.players[0];

    return {
      sessionId: input.sessionId,
      roomCode: input.roomCode,
      quiz: input.quiz,
      players: input.players,
      modeId: this.id,
      status: "initialized",
      currentQuestionIndex: 0,
      questionDurationMs: calculateQpucQuestionDurationMs(input.quiz.qpucQuestions[0]?.clues ?? []),
      questionTimingMode: "dynamic_timer",
      answersByQuestion: {},
      scoredQuestionIds: [],
      scores: Object.fromEntries(input.players.map((player) => [player.id, 0])),
      qpucBaseHandPlayerId: hostPlayer.id
    };
  }

  buildQuestionStartedPayload(state: GameSessionState, now: Date): GameQuestionStartedPayload {
    const question = this.currentQuestion(state);
    const durationMs = this.durationForQuestion(question);

    return {
      sessionId: state.sessionId,
      roomCode: state.roomCode,
      question: {
        id: question.id,
        type: "open_text",
        prompt: question.theme ? `Thème : ${question.theme}` : "Face-à-face",
        clues: question.clues,
        order: state.currentQuestionIndex + 1,
        durationMs,
        options: []
      },
      questionIndex: state.currentQuestionIndex,
      totalQuestions: state.quiz.qpucQuestions?.length ?? 0,
      startedAt: now.toISOString(),
      endsAt: new Date(now.getTime() + durationMs).toISOString(),
      timingMode: "dynamic_timer",
      pointsAvailable: 4,
      handPlayerId: state.qpucBaseHandPlayerId ?? state.players.find((player) => player.isHost)?.id ?? state.players[0]?.id
    };
  }

  acceptAnswer(state: GameSessionState, payload: GameAnswerPayload, playerId: Id, now: Date): GameSessionState {
    if (state.status !== "active") {
      throw new Error("Cannot answer before the game is active");
    }

    const question = this.currentQuestion(state);

    if (payload.questionId !== question.id) {
      throw new Error("Answer does not match current question");
    }

    if (!state.players.some((player) => player.id === playerId)) {
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
            optionIds: [],
            textAnswer: payload.textAnswer?.trim(),
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
    const nextScores = { ...state.scores };
    const firstCorrectAnswer = Object.values(answersForQuestion)
      .filter((answer) => this.isCorrectAnswer(answer.textAnswer, question.acceptedAnswers))
      .sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt))[0];

    if (firstCorrectAnswer && !state.scoredQuestionIds.includes(question.id)) {
      nextScores[firstCorrectAnswer.playerId] =
        (nextScores[firstCorrectAnswer.playerId] ?? 0) + this.pointsForAnswer(state, firstCorrectAnswer, now);
    }

    const playerResults = state.players.map((player) => {
      const answer = answersForQuestion[player.id];
      const isCorrect = Boolean(answer && this.isCorrectAnswer(answer.textAnswer, question.acceptedAnswers));
      const isScoringAnswer = firstCorrectAnswer?.playerId === player.id;

      return {
        playerId: player.id,
        mistakes: isCorrect ? 0 : 1,
        scoreRatio: isScoringAnswer ? 1 : 0,
        status: isScoringAnswer ? ("perfect" as const) : isCorrect ? ("partial" as const) : ("wrong" as const)
      };
    });

    const nextState: GameSessionState = {
      ...state,
      scores: nextScores,
      scoredQuestionIds: state.scoredQuestionIds.includes(question.id)
        ? state.scoredQuestionIds
        : [...state.scoredQuestionIds, question.id],
      status: this.isFinished({ ...state, scores: nextScores }) ? "finished" : state.status,
      qpucBaseHandPlayerId: firstCorrectAnswer?.playerId ?? state.qpucBaseHandPlayerId
    };

    return {
      state: nextState,
      payload: {
        sessionId: state.sessionId,
        roomCode: state.roomCode,
        questionId: question.id,
        correctOptionIds: [],
        questionExplanation: question.answer,
        playerResults,
        explanations: [],
        scores: nextScores
      }
    };
  }

  isFinished(state: GameSessionState): boolean {
    return Math.max(...Object.values(state.scores)) >= WINNING_SCORE || state.currentQuestionIndex >= (state.quiz.qpucQuestions?.length ?? 0) - 1;
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

  private currentQuestion(state: GameSessionState): QpucProgressiveQuestionDto {
    const question = state.quiz.qpucQuestions?.[state.currentQuestionIndex];

    if (!question) {
      throw new Error("No current question available");
    }

    return question;
  }

  private durationForQuestion(question: QpucProgressiveQuestionDto): number {
    return calculateQpucQuestionDurationMs(question.clues);
  }

  private pointsForAnswer(state: GameSessionState, answer: PlayerAnswerState, fallbackNow: Date): number {
    if (!state.questionStartedAt) {
      void fallbackNow;
      return 1;
    }

    const elapsedRatio = Math.max(0, Math.min(1, (Date.parse(answer.answeredAt) - Date.parse(state.questionStartedAt)) / this.durationForQuestion(this.currentQuestion(state))));

    if (elapsedRatio <= 0.25) return 4;
    if (elapsedRatio <= 0.5) return 3;
    if (elapsedRatio <= 0.75) return 2;
    return 1;
  }

  private isCorrectAnswer(candidate: string | undefined, acceptedAnswers: string[]): boolean {
    const normalizedCandidate = this.normalizeText(candidate ?? "");

    if (!normalizedCandidate) {
      return false;
    }

    return acceptedAnswers.some((acceptedAnswer) => {
      const normalizedAccepted = this.normalizeText(acceptedAnswer);

      if (!normalizedAccepted) {
        return false;
      }

      if (normalizedAccepted === normalizedCandidate) {
        return true;
      }

      if (normalizedAccepted.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedAccepted)) {
        return Math.min(normalizedAccepted.length, normalizedCandidate.length) >= 4;
      }

      const maxDistance = Math.max(2, Math.ceil(normalizedAccepted.length * 0.28));
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

    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }

    return dp[a.length][b.length];
  }
}
