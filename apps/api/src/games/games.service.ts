import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { GameEngine, GameModeRegistry, type GameQuiz } from "@quiz/game-core";
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

    if (room.players.length < 2) {
      throw new BadRequestException("At least two players are required to start");
    }

    const requestingPlayer = room.players.find((player) => player.socketId === socketId);

    if (!requestingPlayer || requestingPlayer.id !== room.hostPlayerId) {
      throw new BadRequestException("Only the room creator can start the game");
    }

    const quiz = room.quiz && room.quiz.id === payload.quizId ? room.quiz : await this.loadQuiz(payload.quizId);
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
      quiz: this.toGameQuiz(quiz),
      players: room.players.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        score: player.score,
        isHost: player.id === room.hostPlayerId
      })),
      modeId: payload.modeId as GameModeId
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
    socketId: string
  ): Promise<{ receipt: GameAnswerReceivedPayload; shouldEndQuestion: boolean }> {
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

    const receipt = await this.engine.answer(payload, player.id);
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
        shouldEndQuestion: await this.engine.haveAllPlayersValidatedCurrentQuestion(payload.sessionId)
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
      shouldEndQuestion: await this.engine.haveAllPlayersValidatedCurrentQuestion(payload.sessionId)
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

  private toGameQuiz(quiz: Awaited<ReturnType<GamesService["loadQuiz"]>>): GameQuiz {
    return {
      id: quiz.id,
      title: quiz.title,
      questions: quiz.questions.map((question) => ({
        id: question.id,
        type: this.toSharedQuestionType(question.type),
        prompt: question.prompt,
        imageUrl: question.imageUrl ?? undefined,
        imageRegions: this.parseImageRegions(question.imageRegions),
        imageRegionExplanation: question.imageRegionExplanation ?? undefined,
        order: question.order,
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
