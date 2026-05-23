import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { isAllowedWebOrigin } from "./cors-origins.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false
  });
  app.useBodyParser("json", { limit: "8mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "8mb" });
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, isAllowedWebOrigin(origin));
    },
    credentials: true
  });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 4000);
}

void bootstrap();
