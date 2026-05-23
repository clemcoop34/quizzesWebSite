import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import type { ImageRegionDto, QuizReportReason } from "@quiz/shared";
import { QuizzesService } from "./quizzes.service.js";

@Controller("quizzes")
export class QuizzesController {
  constructor(private readonly quizzesService: QuizzesService) {}

  @Get()
  list() {
    return this.quizzesService.list();
  }

  @Get("tags")
  listTags() {
    return this.quizzesService.listTags();
  }

  @Get("metadata-options")
  listMetadataOptions() {
    return this.quizzesService.listMetadataOptions();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.quizzesService.get(id);
  }

  @Post(":id/like")
  like(@Param("id") id: string) {
    return this.quizzesService.like(id);
  }

  @Post(":id/report")
  report(@Param("id") id: string, @Body() body: ReportQuizBody) {
    return this.quizzesService.report(id, body.reason, body.reporterKey);
  }

  @Delete(":id")
  delete(@Param("id") id: string) {
    return this.quizzesService.delete(id);
  }

  @Post()
  create(@Body() body: CreateQuizBody) {
    return this.quizzesService.create(body);
  }
}

export interface CreateQuizBody {
  title: string;
  description?: string;
  tags?: string[];
  sourceType?: "uness";
  sourceCity?: string;
  sourceYear?: string;
  trainingYear?: string;
  questions: Array<{
    type?: "multiple_choice" | "image_multiple_choice" | "image_region" | "open_text";
    prompt: string;
    imageUrl?: string;
    imageRegions?: ImageRegionDto[];
    imageRegionExplanation?: string;
    acceptedTextAnswers?: string[];
    durationMs?: number;
    options?: Array<{
      label: string;
      isCorrect: boolean;
      explanation?: string;
    }>;
  }>;
}

export interface ReportQuizBody {
  reason: QuizReportReason;
  reporterKey: string;
}
