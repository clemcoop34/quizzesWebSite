import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import type { RoomQuizPreviewDto, RoomStateDto } from "@quiz/shared";
import { LiveStateService } from "../live-state/live-state.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateRoomBody } from "./rooms.controller.js";

const codeAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 6);

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly liveState: LiveStateService
  ) {}

  async create(body: CreateRoomBody) {
    const code = await this.uniqueCode();
    const room = await this.prisma.room.create({
      data: {
        code,
        quizId: body.quizId,
        players: body.hostDisplayName
          ? {
              create: {
                displayName: body.hostDisplayName,
                score: 0
              }
            }
          : undefined
      },
      include: { players: true }
    });

    const host = room.players[0];

    if (host) {
      await this.prisma.room.update({
        where: { id: room.id },
        data: { hostPlayerId: host.id }
      });
    }

    const state = await this.getState(code);

    return {
      ...state,
      currentPlayerId: host?.id
    };
  }

  async join(
    code: string,
    displayName: string,
    socketId?: string,
    playerId?: string
  ): Promise<{ state: RoomStateDto; playerId: string }> {
    const normalizedCode = code.toUpperCase();
    const room = await this.prisma.room.findUnique({
      where: { code: normalizedCode },
      include: { players: true }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    if (room.status !== "LOBBY") {
      throw new BadRequestException("Cannot join a room after the game has started");
    }

    const existingPlayer =
      (playerId ? room.players.find((candidate) => candidate.id === playerId) : undefined) ??
      room.players.find((candidate) => candidate.socketId === socketId);

    const player = existingPlayer
      ? await this.prisma.player.update({
          where: { id: existingPlayer.id },
          data: { displayName, socketId }
        })
      : await this.prisma.player.create({
          data: {
            roomId: room.id,
            displayName,
            socketId
          }
        });

    if (!room.hostPlayerId) {
      await this.prisma.room.update({
        where: { id: room.id },
        data: { hostPlayerId: player.id }
      });
    }

    const state = await this.getState(normalizedCode);

    return {
      state: {
        ...state,
        currentPlayerId: player.id
      },
      playerId: player.id
    };
  }

  async setPlayerSocket(roomCode: string, playerId: string, socketId: string) {
    await this.prisma.player.update({
      where: { id: playerId },
      data: { socketId }
    });

    return this.getState(roomCode);
  }

  async selectQuiz(code: string, quizId: string, socketId: string): Promise<RoomStateDto> {
    const normalizedCode = code.toUpperCase();
    const room = await this.prisma.room.findUnique({
      where: { code: normalizedCode },
      include: { players: true }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    if (room.status !== "LOBBY") {
      throw new BadRequestException("Cannot change quiz after the game has started");
    }

    const requester = room.players.find((player) => player.socketId === socketId);

    if (!requester || requester.id !== room.hostPlayerId) {
      throw new BadRequestException("Only the room creator can change the quiz");
    }

    const quiz = await this.prisma.quiz.findUnique({
      where: { id: quizId },
      select: { id: true }
    });

    if (!quiz) {
      throw new NotFoundException("Quiz not found");
    }

    await this.prisma.room.update({
      where: { id: room.id },
      data: { quizId }
    });

    return this.getState(normalizedCode);
  }

  async getState(code: string): Promise<RoomStateDto> {
    const room = await this.prisma.room.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        quiz: {
          include: {
            questions: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                prompt: true
              }
            },
            quizTags: {
              include: { tag: true }
            }
          }
        },
        players: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    return {
      code: room.code,
      status: room.status.toLowerCase() as RoomStateDto["status"],
      quizId: room.quizId ?? undefined,
      quiz: room.quiz ? toRoomQuizPreview(room.quiz) : undefined,
      hostPlayerId: room.hostPlayerId ?? undefined,
      players: room.players.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        score: player.score,
        isHost: player.id === room.hostPlayerId
      }))
    };
  }

  async watch(code: string, socketId: string, playerId?: string): Promise<RoomStateDto> {
    const normalizedCode = code.toUpperCase();
    const room = await this.prisma.room.findUnique({
      where: { code: normalizedCode },
      include: {
        players: {
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const existingPlayer = playerId ? room.players.find((player) => player.id === playerId) : undefined;

    if (existingPlayer) {
      await this.prisma.player.update({
        where: { id: existingPlayer.id },
        data: { socketId }
      });
    }

    const state = await this.getState(normalizedCode);

    return {
      ...state,
      currentPlayerId: existingPlayer?.id
    };
  }

  async getPlayerForSocket(roomCode: string, socketId: string) {
    const room = await this.prisma.room.findUnique({
      where: { code: roomCode.toUpperCase() },
      include: { players: true }
    });

    if (!room) {
      throw new NotFoundException("Room not found");
    }

    const player = room.players.find((candidate) => candidate.socketId === socketId);

    if (!player) {
      throw new BadRequestException("Socket is not linked to a player in this room");
    }

    return {
      room,
      player
    };
  }

  async clearSocket(socketId: string): Promise<void> {
    await this.prisma.player.updateMany({
      where: { socketId },
      data: { socketId: null }
    });
  }

  async cleanupInactiveRoom(code: string): Promise<boolean> {
    const room = await this.prisma.room.findUnique({
      where: { code: code.toUpperCase() },
      include: {
        players: true,
        sessions: true
      }
    });

    if (!room) {
      return false;
    }

    if (room.players.some((player) => player.socketId)) {
      return false;
    }

    await Promise.all(room.sessions.map((session) => this.liveState.delete(session.id)));
    await this.prisma.room.delete({
      where: { id: room.id }
    });

    return true;
  }

  private async uniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = codeAlphabet();
      const existing = await this.prisma.room.findUnique({ where: { code } });

      if (!existing) {
        return code;
      }
    }

    throw new Error("Unable to generate a unique room code");
  }
}

function toRoomQuizPreview(quiz: {
  id: string;
  title: string;
  correctionPercent: number;
  sourceType: string | null;
  sourceCity: string | null;
  sourceYear: string | null;
  trainingYear: string | null;
  questions: Array<{
    id: string;
    prompt: string;
  }>;
  quizTags: Array<{ tag: { name: string } }>;
}): RoomQuizPreviewDto {
  return {
    id: quiz.id,
    title: quiz.title,
    correctionPercent: quiz.correctionPercent,
    sourceType: quiz.sourceType ?? undefined,
    sourceCity: quiz.sourceCity ?? undefined,
    sourceYear: quiz.sourceYear ?? undefined,
    trainingYear: quiz.trainingYear ?? undefined,
    tags: quiz.quizTags.map((quizTag) => quizTag.tag.name),
    questions: quiz.questions
  };
}
