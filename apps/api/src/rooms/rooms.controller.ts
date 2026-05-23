import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { RoomsService } from "./rooms.service.js";

@Controller("rooms")
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@Body() body: CreateRoomBody) {
    return this.roomsService.create(body);
  }

  @Post(":code/join")
  join(@Param("code") code: string, @Body() body: JoinRoomBody) {
    return this.roomsService.join(code, body.displayName, body.socketId, body.playerId);
  }

  @Get(":code")
  get(@Param("code") code: string) {
    return this.roomsService.getState(code);
  }
}

export interface CreateRoomBody {
  quizId?: string;
  hostDisplayName?: string;
}

export interface JoinRoomBody {
  displayName: string;
  socketId?: string;
  playerId?: string;
}
