import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { GameSessionState, GameStateStore } from "@quiz/game-core";
import { createClient, type RedisClientType } from "redis";

@Injectable()
export class LiveStateService implements GameStateStore, OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL ?? "redis://localhost:6379"
    });
  }

  async onModuleInit() {
    await this.client.connect();
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  async get(sessionId: string): Promise<GameSessionState | null> {
    const raw = await this.client.get(this.key(sessionId));
    return raw ? (JSON.parse(raw) as GameSessionState) : null;
  }

  async set(sessionId: string, state: GameSessionState): Promise<void> {
    await this.client.set(this.key(sessionId), JSON.stringify(state), {
      EX: 60 * 60 * 6
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.del(this.key(sessionId));
  }

  private key(sessionId: string): string {
    return `game-session:${sessionId}`;
  }
}
