import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { GameEngine, GameModeRegistry, type GameQuiz, type GameSessionState } from "@quiz/game-core";
import type {
  GameAnswerPayload,
  GameAnswerReceivedPayload,
  GameFinishedPayload,
  ImagePointDto,
  ImageRegionDto,
  GameModeId,
  GameQuestionEndedPayload,
  GameQuestionStartedPayload,
  StartGamePayload
} from "@quiz/shared";
import { getCompatibleGameModesForQuiz as getCompatibleModes } from "@quiz/shared";
import { parseQpucProgressiveQuestions } from "@quiz/shared";
import { LiveStateService } from "../live-state/live-state.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class GamesService {
  private readonly engine: GameEngine;

  constructor(
    registry: GameModeRegistry,
    private readonly liveState: LiveStateService,
    private readonly prisma: PrismaService
  ) {
    this.engine = new GameEngine(registry, liveState);
  }

  async startGame(payload: StartGamePayload, socketId: string): Promise<GameQuestionStartedPayload> {
    const room = await this.prisma.room.findUnique({
      where: { code: payload.roomCode.toUpperCase() },
      include: {
        players: { orderBy: { createdAt: "asc" } },
        quiz: {
          include: {
            questions: {
              orderBy: { order: "asc" },
              include: { answerOptions: { orderBy: { order: "asc" } } }
            }
          }
        }
      }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const requestingPlayer = room.players.find((player) => player.socketId === socketId);

    if (!requestingPlayer || requestingPlayer.id !== room.hostPlayerId) {
      throw new BadRequestException("Only the room creator can start the game");
    }

    const quiz = room.quiz && room.quiz.id === payload.quizId ? room.quiz : await this.loadQuiz(payload.quizId);
    const compatibleModes = getCompatibleModes({
      sourceType: quiz.sourceType,
      qpucQuestions: quiz.qpucQuestions,
      questionCount: quiz.questions.length,
      questions: quiz.questions.map((question) => ({
        type: this.toSharedQuestionType(question.type),
        acceptedTextAnswers: question.acceptedTextAnswers
      }))
    });

    if (!compatibleModes.includes(payload.modeId)) {
      throw new BadRequestException("This quiz is not compatible with the selected game mode");
    }

    if (payload.modeId === "qpuc_face_to_face" && room.players.length !== 2) {
      throw new BadRequestException("Le mode Face-à-face se joue exactement à 2 joueurs");
    }

    if (payload.modeId !== "qpuc_face_to_face" && room.players.length < 2) {
      throw new BadRequestException("At least two players are required to start");
    }

    await this.prisma.player.updateMany({
      where: { roomId: room.id },
      data: { score: 0 }
    });

    const session = await this.prisma.gameSession.create({
      data: {
        roomId: room.id,
        quizId: quiz.id,
        modeId: payload.modeId,
        status: "INITIALIZED"
      }
    });

    await this.engine.initialize({
      sessionId: session.id,
      roomCode: room.code,
      quiz: this.toGameQuiz(quiz, payload.modeId, payload.questionLimit),
      players: room.players.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        score: 0,
        isHost: player.id === room.hostPlayerId
      })),
      modeId: payload.modeId as GameModeId,
      timingMode: payload.timingMode ?? "dynamic_timer"
    });

    const question = await this.engine.start(session.id);

    await this.prisma.$transaction([
      this.prisma.room.update({
        where: { id: room.id },
        data: { status: "PLAYING", quizId: quiz.id }
      }),
      this.prisma.gameSession.update({
        where: { id: session.id },
        data: { status: "ACTIVE", startedAt: new Date(question.startedAt) }
      })
    ]);

    return question;
  }

  async answer(
    payload: GameAnswerPayload,
    socketId: string,
    answeredAt = new Date()
  ): Promise<{ receipt: GameAnswerReceivedPayload; shouldEndQuestion: boolean; isCorrect: boolean }> {
    const room = await this.prisma.room.findUnique({
      where: { code: payload.roomCode.toUpperCase() },
      include: { players: true }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const player = room.players.find((candidate) => candidate.socketId === socketId);

    if (!player) {
      throw new BadRequestException("Socket is not linked to a player in this room");
    }

    const liveSessionBeforeAnswer = await this.liveState.get(payload.sessionId);
    const receipt = await this.engine.answer(payload, player.id, answeredAt);

    if (liveSessionBeforeAnswer?.modeId === "qpuc_face_to_face") {
      const question = liveSessionBeforeAnswer.quiz.qpucQuestions?.[liveSessionBeforeAnswer.currentQuestionIndex];
      const isCorrect = question ? this.matchesAcceptedText(payload.textAnswer, question.acceptedAnswers) : false;

      return {
        receipt: {
          ...receipt,
          textAnswer: payload.textAnswer?.trim() || undefined,
          isCorrect
        },
        shouldEndQuestion: Boolean(payload.validated && isCorrect),
        isCorrect
      };
    }

    const selectedOptions = await this.prisma.answerOption.findMany({
      where: {
        id: {
          in: payload.optionIds
        }
      }
    });
    const correctOptions = await this.prisma.answerOption.findMany({
      where: {
        questionId: payload.questionId,
        isCorrect: true
      }
    });
    const question = await this.prisma.question.findUnique({
      where: { id: payload.questionId },
      select: {
        type: true,
        imageRegions: true,
        acceptedTextAnswers: true
      }
    });
    const selectedOptionIds = new Set(payload.optionIds);
    const isCorrect =
      question?.type === "OPEN_TEXT"
        ? this.matchesAcceptedText(payload.textAnswer, question.acceptedTextAnswers)
        : question?.type === "IMAGE_REGION"
          ? Boolean(payload.selectedPoint) &&
            this.parseImageRegions(question.imageRegions).some((region) =>
              this.isPointInRegion(payload.selectedPoint as ImagePointDto, region)
            )
        : selectedOptions.length === selectedOptionIds.size &&
          correctOptions.length === selectedOptionIds.size &&
          correctOptions.every((option) => selectedOptionIds.has(option.id));

    if (payload.optionIds.length === 0 && !payload.textAnswer?.trim() && !payload.selectedPoint && !payload.validated) {
      await this.prisma.playerAnswer.deleteMany({
        where: {
          sessionId: payload.sessionId,
          playerId: player.id,
          questionId: payload.questionId
        }
      });

      return {
        receipt,
        shouldEndQuestion: await this.engine.haveAllPlayersValidatedCurrentQuestion(payload.sessionId),
        isCorrect: false
      };
    }

    await this.prisma.playerAnswer.upsert({
      where: {
        sessionId_playerId_questionId: {
          sessionId: payload.sessionId,
          playerId: player.id,
          questionId: payload.questionId
        }
      },
      create: {
        sessionId: payload.sessionId,
        playerId: player.id,
        questionId: payload.questionId,
        answerOptionId: payload.optionIds[0] ?? null,
        textAnswer: payload.textAnswer?.trim() || null,
        selectedPoint: this.toJsonPoint(payload.selectedPoint),
        answeredAt: new Date(receipt.receivedAt),
        isCorrect,
        pointsAwarded: 0
      },
      update: {
        answerOptionId: payload.optionIds[0] ?? null,
        textAnswer: payload.textAnswer?.trim() || null,
        selectedPoint: this.toJsonPoint(payload.selectedPoint),
        answeredAt: new Date(receipt.receivedAt),
        isCorrect,
        pointsAwarded: 0
      }
    });

    return {
      receipt,
      shouldEndQuestion: await this.engine.haveAllPlayersValidatedCurrentQuestion(payload.sessionId),
      isCorrect
    };
  }

  async endQuestion(sessionId: string): Promise<GameQuestionEndedPayload> {
    const result = await this.engine.endQuestion(sessionId);

    await this.prisma.$transaction(
      Object.entries(result.scores).map(([playerId, score]) =>
        this.prisma.player.update({
          where: { id: playerId },
          data: { score }
        })
      )
    );

    return result;
  }

  nextQuestion(sessionId: string): Promise<GameQuestionStartedPayload | null> {
    return this.engine.nextQuestion(sessionId);
  }

  getLiveSession(sessionId: string): Promise<GameSessionState | null> {
    return this.liveState.get(sessionId);
  }

  async finish(sessionId: string): Promise<GameFinishedPayload> {
    const result = await this.engine.finish(sessionId);
    const session = await this.prisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { room: true }
    });

    if (session) {
      await this.prisma.$transaction([
        this.prisma.gameSession.update({
          where: { id: sessionId },
          data: { status: "FINISHED", endedAt: new Date() }
        }),
        this.prisma.room.update({
          where: { id: session.roomId },
          data: { status: "FINISHED" }
        })
      ]);
    }

    return result;
  }

  private async loadQuiz(quizId: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      include: {
        questions: {
          orderBy: { order: "asc" },
          include: { answerOptions: { orderBy: { order: "asc" } } }
        }
      }
    });

    if (!quiz) {
      throw new NotFoundException("Quiz not found");
    }

    return quiz;
  }

  private toGameQuiz(
    quiz: Awaited<ReturnType<GamesService["loadQuiz"]>>,
    modeId: GameModeId,
    questionLimit?: number
  ): GameQuiz {
    const limit = Number.isInteger(questionLimit) && questionLimit && questionLimit > 0 ? questionLimit : undefined;
    const shuffledQuestions =
      modeId === "classic" ? this.shuffleArray(quiz.questions).slice(0, limit ?? quiz.questions.length) : this.shuffleArray(quiz.questions);
    const allQpucQuestions = parseQpucProgressiveQuestions(quiz.qpucQuestions);
    const shuffledQpucQuestions =
      modeId === "qpuc_face_to_face"
        ? this.shuffleArray(allQpucQuestions).slice(0, limit ?? allQpucQuestions.length)
        : this.shuffleArray(allQpucQuestions);

    return {
      id: quiz.id,
      title: quiz.title,
      qpucQuestions: shuffledQpucQuestions,
      questions: shuffledQuestions.map((question, questionIndex) => ({
        id: question.id,
        type: this.toSharedQuestionType(question.type),
        prompt: question.prompt,
        imageUrl: question.imageUrl ?? undefined,
        imageRegions: this.parseImageRegions(question.imageRegions),
        imageRegionExplanation: question.imageRegionExplanation ?? undefined,
        order: questionIndex + 1,
        durationMs: question.durationMs,
        acceptedTextAnswers: question.acceptedTextAnswers,
        options: question.answerOptions.map((option) => ({
          id: option.id,
          label: option.label,
          isCorrect: option.isCorrect,
          explanation: option.explanation ?? undefined
        }))
      }))
    };
  }

  private shuffleArray<T>(items: T[]): T[] {
    const shuffled = [...items];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }

    return shuffled;
  }

  private toSharedQuestionType(type: string) {
    switch (type) {
      case "IMAGE_MULTIPLE_CHOICE":
        return "image_multiple_choice" as const;
      case "OPEN_TEXT":
        return "open_text" as const;
      case "IMAGE_REGION":
        return "image_region" as const;
      case "MULTIPLE_CHOICE":
      default:
        return "multiple_choice" as const;
    }
  }

  private matchesAcceptedText(candidate: string | undefined, acceptedAnswers: string[]): boolean {
    const normalizedCandidate = this.normalizeText(candidate ?? "");

    if (!normalizedCandidate) {
      return false;
    }

    return acceptedAnswers.some((acceptedAnswer) => {
      const normalizedAccepted = this.normalizeText(acceptedAnswer);
      const maxDistance = normalizedAccepted.length <= 5 ? 1 : 2;
      return (
        normalizedCandidate === normalizedAccepted ||
        this.levenshtein(normalizedCandidate, normalizedAccepted) <= maxDistance
      );
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

  private parseImageRegions(value: unknown): ImageRegionDto[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((region, index) => {
        if (!region || typeof region !== "object" || !Array.isArray((region as { points?: unknown }).points)) {
          return null;
        }

        return {
          id: typeof (region as { id?: unknown }).id === "string" ? (region as { id: string }).id : `region-${index + 1}`,
          points: ((region as { points: unknown[] }).points)
            .map((point) => {
              if (!point || typeof point !== "object") {
                return null;
              }

              const x = Number((point as { x?: unknown }).x);
              const y = Number((point as { y?: unknown }).y);
              return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
            })
            .filter((point): point is ImagePointDto => point !== null)
        };
      })
      .filter((region): region is ImageRegionDto => Boolean(region && region.points.length >= 3));
  }

  private toJsonPoint(point: ImagePointDto | undefined): Prisma.InputJsonValue | undefined {
    return point ? ({ x: point.x, y: point.y } as Prisma.InputJsonValue) : undefined;
  }

  private isPointInRegion(point: ImagePointDto, region: ImageRegionDto): boolean {
    const points = region.points;
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
}
