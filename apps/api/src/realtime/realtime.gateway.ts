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
  GameSkipExplanationsPayload,
  JoinRoomPayload,
  SelectRoomQuizPayload,
  ServerToClientEvents,
  StartGamePayload
} from "@quiz/shared";
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
  private readonly roomCleanupGraceMs = Number(process.env.ROOM_CLEANUP_GRACE_MS ?? 30_000);

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
      const { receipt, shouldEndQuestion } = await this.gamesService.answer(payload, client.id);
      this.server.to(payload.roomCode).emit("game:answer_received", receipt);

      if (shouldEndQuestion) {
        this.clearQuestionTimer(payload.sessionId);
        await this.endQuestionAndContinue(payload.sessionId, payload.roomCode);
      }
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

  private scheduleQuestionEnd(sessionId: string, roomCode: string, endsAt: string): void {
    const delayMs = Math.max(0, Date.parse(endsAt) - Date.now());

    this.clearQuestionTimer(sessionId);
    const timer = setTimeout(() => {
      this.questionTimers.delete(sessionId);
      void this.endQuestionAndContinue(sessionId, roomCode);
    }, delayMs);
    this.questionTimers.set(sessionId, timer);
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
