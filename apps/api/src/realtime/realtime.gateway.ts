import {
  ConnectedSocket,
  OnGatewayConnection,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer
} from "@nestjs/websockets";
import type {
  ClientToServerEvents,
  ErrorPayload,
  GameAnswerPayload,
  GameBuzzPayload,
  GameSkipExplanationsPayload,
  JoinRoomPayload,
  ReturnToLobbyPayload,
  SelectRoomQuizPayload,
  ServerToClientEvents,
  StartGamePayload
} from "@quiz/shared";
import { calculateQpucQuestionDurationMs, QPUC_BUZZ_ANSWER_TIME_MS } from "@quiz/shared";
import type { Server, Socket } from "socket.io";
import { getAllowedWebOrigins } from "../cors-origins.js";
import { GamesService } from "../games/games.service.js";
import { RoomsService } from "../rooms/rooms.service.js";

type QuizSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type QuizServer = Server<ClientToServerEvents, ServerToClientEvents>;

@WebSocketGateway({
  cors: {
    origin: getAllowedWebOrigins(),
    credentials: true
  }
})
export class RealtimeGateway implements OnGatewayConnection<QuizSocket> {
  @WebSocketServer()
  server: QuizServer;

  private readonly roomCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly questionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly questionEndsAt = new Map<string, string>();
  private readonly activeBuzzes = new Map<
    string,
    {
      roomCode: string;
      questionId: string;
      playerId: string;
      remainingMs: number;
      startedAtMs: number;
      segmentIndex?: number;
      nextHandPlayerId?: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly qpucHandOverrides = new Map<string, { segmentIndex: number; playerId: string }>();
  private readonly roomCleanupGraceMs = Number(process.env.ROOM_CLEANUP_GRACE_MS ?? 30_000);
  private readonly buzzAnswerTimeMs = QPUC_BUZZ_ANSWER_TIME_MS;

  constructor(
    private readonly roomsService: RoomsService,
    private readonly gamesService: GamesService
  ) {}

  handleConnection(client: QuizSocket): void {
    client.on("disconnecting", () => {
      void this.handleDisconnecting(client);
    });
  }

  @SubscribeMessage("room:watch")
  async watchRoom(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: { code: string; playerId?: string }) {
    try {
      const state = await this.roomsService.watch(payload.code, client.id, payload.playerId);
      this.cancelRoomCleanup(state.code);
      await client.join(state.code);
      client.emit("room:state_updated", state);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("room:join")
  async joinRoom(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: JoinRoomPayload) {
    try {
      const { state } = await this.roomsService.join(payload.code, payload.displayName, client.id, payload.playerId);
      this.cancelRoomCleanup(state.code);
      await client.join(state.code);
      client.emit("room:state_updated", state);
      client.to(state.code).emit("room:state_updated", {
        ...state,
        currentPlayerId: undefined
      });
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("room:quiz_select")
  async selectRoomQuiz(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: SelectRoomQuizPayload) {
    try {
      const state = await this.roomsService.selectQuiz(payload.code, payload.quizId, client.id);
      this.server.to(state.code).emit("room:state_updated", {
        ...state,
        currentPlayerId: undefined
      });
      client.emit("room:state_updated", state);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("room:return_to_lobby")
  async returnToLobby(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: ReturnToLobbyPayload) {
    try {
      const state = await this.roomsService.returnToLobby(payload.code, client.id);
      this.server.to(state.code).emit("room:state_updated", {
        ...state,
        currentPlayerId: undefined
      });
      client.emit("room:state_updated", state);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("game:start")
  async startGame(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: StartGamePayload) {
    try {
      const question = await this.gamesService.startGame(payload, client.id);
      this.cancelRoomCleanup(question.roomCode);
      this.server.to(question.roomCode).emit("game:question_started", question);
      this.scheduleQuestionEnd(question.sessionId, question.roomCode, question.endsAt);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("game:answer")
  async answer(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: GameAnswerPayload) {
    try {
      const activeBuzzBeforeAnswer = this.activeBuzzes.get(payload.sessionId);

      if (activeBuzzBeforeAnswer && activeBuzzBeforeAnswer.questionId === payload.questionId) {
        const { player } = await this.roomsService.getPlayerForSocket(payload.roomCode, client.id);

        if (player.id !== activeBuzzBeforeAnswer.playerId) {
          throw new Error("Seul le joueur qui a buzzé peut répondre.");
        }
      }

      const answerTimestamp =
        activeBuzzBeforeAnswer &&
        activeBuzzBeforeAnswer.questionId === payload.questionId
          ? new Date(activeBuzzBeforeAnswer.startedAtMs)
          : new Date();
      const { receipt, shouldEndQuestion, isCorrect } = await this.gamesService.answer(payload, client.id, answerTimestamp);
      this.server.to(payload.roomCode).emit("game:answer_received", receipt);
      const activeBuzz = this.activeBuzzes.get(payload.sessionId);

      if (activeBuzz && activeBuzz.questionId === payload.questionId && activeBuzz.playerId === receipt.playerId) {
        clearTimeout(activeBuzz.timer);
        this.activeBuzzes.delete(payload.sessionId);

        if (shouldEndQuestion) {
          this.clearQuestionTimer(payload.sessionId);
          this.qpucHandOverrides.delete(payload.sessionId);
          await this.endQuestionAndContinue(payload.sessionId, payload.roomCode);
          return;
        }

        if (!isCorrect) {
          this.switchHandAfterFailedBuzz(payload.sessionId, activeBuzz);
        }

        this.resumeQuestionAfterBuzz(payload.sessionId, activeBuzz);
        return;
      }

      if (shouldEndQuestion) {
        this.clearQuestionTimer(payload.sessionId);
        this.qpucHandOverrides.delete(payload.sessionId);
        await this.endQuestionAndContinue(payload.sessionId, payload.roomCode);
      }
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("game:buzz")
  async buzz(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: GameBuzzPayload) {
    try {
      const { player } = await this.roomsService.getPlayerForSocket(payload.roomCode, client.id);
      const currentEndsAt = this.questionEndsAt.get(payload.sessionId);

      if (!currentEndsAt || this.activeBuzzes.has(payload.sessionId)) {
        return;
      }

      const handState = await this.getQpucHand(payload.sessionId);

      if (handState && player.id !== handState.handPlayerId) {
        throw new Error("Ce n'est pas à toi d'avoir la main.");
      }

      const remainingMs = Math.max(1_000, Date.parse(currentEndsAt) - Date.now());
      this.clearQuestionTimer(payload.sessionId);

      const startedAtMs = Date.now();
      const timer = setTimeout(() => {
        const activeBuzz = this.activeBuzzes.get(payload.sessionId);
        if (!activeBuzz) return;
        this.activeBuzzes.delete(payload.sessionId);
        this.switchHandAfterFailedBuzz(payload.sessionId, activeBuzz);
        this.resumeQuestionAfterBuzz(payload.sessionId, activeBuzz);
      }, this.buzzAnswerTimeMs);

      this.activeBuzzes.set(payload.sessionId, {
        roomCode: payload.roomCode,
        questionId: payload.questionId,
        playerId: player.id,
        remainingMs,
        startedAtMs,
        segmentIndex: handState?.segmentIndex,
        nextHandPlayerId: handState ? this.getOpposingPlayerId(handState.playerIds, player.id) : undefined,
        timer
      });
      this.server.to(payload.roomCode).emit("game:buzz_started", {
        sessionId: payload.sessionId,
        roomCode: payload.roomCode,
        questionId: payload.questionId,
        playerId: player.id,
        answerEndsAt: new Date(startedAtMs + this.buzzAnswerTimeMs).toISOString()
      });
    } catch (error) {
      this.emitError(client, error);
    }
  }

  @SubscribeMessage("game:skip_explanations")
  async skipExplanations(@ConnectedSocket() client: QuizSocket, @MessageBody() payload: GameSkipExplanationsPayload) {
    try {
      const { room, player } = await this.roomsService.getPlayerForSocket(payload.roomCode, client.id);

      if (player.id !== room.hostPlayerId) {
        throw new Error("Only the room creator can skip explanations");
      }

      await this.continueAfterExplanations(payload.sessionId, payload.roomCode);
    } catch (error) {
      this.emitError(client, error);
    }
  }

  private scheduleQuestionEnd(sessionId: string, roomCode: string, endsAt?: string): void {
    if (!endsAt) {
      this.clearQuestionTimer(sessionId);
      this.questionEndsAt.delete(sessionId);
      return;
    }

    const delayMs = Math.max(0, Date.parse(endsAt) - Date.now());

    this.clearQuestionTimer(sessionId);
    this.questionEndsAt.set(sessionId, endsAt);
    const timer = setTimeout(() => {
      this.questionTimers.delete(sessionId);
      this.questionEndsAt.delete(sessionId);
      this.qpucHandOverrides.delete(sessionId);
      void this.endQuestionAndContinue(sessionId, roomCode);
    }, delayMs);
    this.questionTimers.set(sessionId, timer);
  }

  private resumeQuestionAfterBuzz(
    sessionId: string,
    activeBuzz: {
      roomCode: string;
      questionId: string;
      remainingMs: number;
      playerId?: string;
      segmentIndex?: number;
      nextHandPlayerId?: string;
    }
  ): void {
    const endsAt = new Date(Date.now() + activeBuzz.remainingMs).toISOString();
    this.scheduleQuestionEnd(sessionId, activeBuzz.roomCode, endsAt);
    this.server.to(activeBuzz.roomCode).emit("game:buzz_ended", {
      sessionId,
      roomCode: activeBuzz.roomCode,
      questionId: activeBuzz.questionId,
      endsAt,
      ...this.getBuzzHandPayload(activeBuzz)
    });
  }

  private clearQuestionTimer(sessionId: string): void {
    const timer = this.questionTimers.get(sessionId);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.questionTimers.delete(sessionId);
  }

  private async continueAfterExplanations(sessionId: string, roomCode: string): Promise<void> {
    this.qpucHandOverrides.delete(sessionId);
    const next = await this.gamesService.nextQuestion(sessionId);

    if (next) {
      this.server.to(roomCode).emit("game:question_started", next);
      this.scheduleQuestionEnd(sessionId, roomCode, next.endsAt);
      return;
    }

    const finished = await this.gamesService.finish(sessionId);
    this.clearQuestionTimer(sessionId);
    this.server.to(roomCode).emit("game:finished", finished);
  }

  private async getQpucHand(
    sessionId: string
  ): Promise<{ handPlayerId: string; segmentIndex: number; playerIds: string[] } | null> {
    const state = await this.gamesService.getLiveSession(sessionId);

    if (!state || state.modeId !== "qpuc_face_to_face") {
      return null;
    }

    const question = state.quiz.qpucQuestions?.[state.currentQuestionIndex];
    const playerIds = state.players.map((player) => player.id);
    const baseHandPlayerId =
      state.qpucBaseHandPlayerId ?? state.players.find((player) => player.isHost)?.id ?? state.players[0]?.id;

    if (!question || playerIds.length !== 2 || !baseHandPlayerId) {
      return null;
    }

    const durationMs = calculateQpucQuestionDurationMs(question.clues);
    const currentEndsAt = this.questionEndsAt.get(sessionId);
    const elapsedMs = currentEndsAt
      ? durationMs - Math.max(0, Date.parse(currentEndsAt) - Date.now())
      : state.questionStartedAt
        ? Date.now() - Date.parse(state.questionStartedAt)
        : 0;
    const segmentIndex = Math.min(3, Math.max(0, Math.floor((Math.max(0, elapsedMs) / durationMs) * 4)));
    const otherPlayerId = this.getOpposingPlayerId(playerIds, baseHandPlayerId);
    const naturalHandPlayerId = segmentIndex % 2 === 0 ? baseHandPlayerId : otherPlayerId;
    const override = this.qpucHandOverrides.get(sessionId);

    return {
      handPlayerId: override?.segmentIndex === segmentIndex ? override.playerId : naturalHandPlayerId,
      segmentIndex,
      playerIds
    };
  }

  private switchHandAfterFailedBuzz(
    sessionId: string,
    activeBuzz: { segmentIndex?: number; nextHandPlayerId?: string }
  ): void {
    if (activeBuzz.segmentIndex === undefined || !activeBuzz.nextHandPlayerId) {
      return;
    }

    this.qpucHandOverrides.set(sessionId, {
      segmentIndex: activeBuzz.segmentIndex,
      playerId: activeBuzz.nextHandPlayerId
    });
  }

  private getBuzzHandPayload(activeBuzz: { segmentIndex?: number; nextHandPlayerId?: string; playerId?: string }) {
    return activeBuzz.segmentIndex !== undefined && activeBuzz.nextHandPlayerId
      ? {
          handPlayerId: activeBuzz.nextHandPlayerId,
          segmentIndex: activeBuzz.segmentIndex,
          wrongPlayerId: activeBuzz.playerId
        }
      : {};
  }

  private getOpposingPlayerId(playerIds: string[], playerId: string): string {
    return playerIds.find((candidate) => candidate !== playerId) ?? playerId;
  }

  private async handleDisconnecting(client: QuizSocket): Promise<void> {
    const roomCodes = Array.from(client.rooms).filter((room) => room !== client.id);

    await this.roomsService.clearSocket(client.id);
    roomCodes.forEach((roomCode) => this.scheduleRoomCleanup(roomCode));
  }

  private scheduleRoomCleanup(roomCode: string): void {
    this.cancelRoomCleanup(roomCode);

    const timer = setTimeout(() => {
      void this.cleanupRoomIfEmpty(roomCode);
    }, this.roomCleanupGraceMs);

    this.roomCleanupTimers.set(roomCode, timer);
  }

  private cancelRoomCleanup(roomCode: string): void {
    const timer = this.roomCleanupTimers.get(roomCode);

    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.roomCleanupTimers.delete(roomCode);
  }

  private async cleanupRoomIfEmpty(roomCode: string): Promise<void> {
    this.roomCleanupTimers.delete(roomCode);

    const socketRoom = this.server.sockets.adapter.rooms.get(roomCode);

    if (socketRoom && socketRoom.size > 0) {
      return;
    }

    await this.roomsService.cleanupInactiveRoom(roomCode);
  }

  private async endQuestionAndContinue(sessionId: string, roomCode: string): Promise<void> {
    try {
      const ended = await this.gamesService.endQuestion(sessionId);
      this.server.to(roomCode).emit("game:question_ended", ended);
    } catch (error) {
      this.server.to(roomCode).emit("error", this.toErrorPayload(error));
    }
  }

  private emitError(client: QuizSocket, error: unknown): void {
    client.emit("error", this.toErrorPayload(error));
  }

  private toErrorPayload(error: unknown): ErrorPayload {
    const message = error instanceof Error ? error.message : "Unexpected realtime error";
    return {
      code: "REALTIME_ERROR",
      message
    };
  }
}
