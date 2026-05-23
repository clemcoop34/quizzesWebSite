import { Module } from "@nestjs/common";
import { QuizzesController } from "./quizzes.controller.js";
import { QuizzesService } from "./quizzes.service.js";

@Module({
  controllers: [QuizzesController],
  providers: [QuizzesService],
  exports: [QuizzesService]
})
export class QuizzesModule {}
