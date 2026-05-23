import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { ImageRegionDto, QuizReportReason } from "@quiz/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateQuizBody } from "./quizzes.controller.js";

@Injectable()
export class QuizzesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.quiz.findMany({
      orderBy: [{ likesCount: "desc" }, { createdAt: "desc" }],
      include: {
        quizTags: {
          include: { tag: true }
        },
        reports: {
          select: { id: true }
        },
        _count: {
          select: { questions: true }
        }
      }
    });
  }

  async get(id: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: { id },
      include: {
        questions: {
          orderBy: { order: "asc" },
          include: {
            answerOptions: {
              orderBy: { order: "asc" }
            }
          }
        },
        quizTags: {
          include: { tag: true }
        }
      }
    });

    if (!quiz) {
      throw new NotFoundException("Quiz not found");
    }

    return quiz;
  }

  listTags() {
    return this.prisma.tag.findMany({
      orderBy: { name: "asc" }
    });
  }

  async listMetadataOptions() {
    const quizzes = await this.prisma.quiz.findMany({
      where: { sourceType: "uness" },
      select: {
        sourceCity: true,
        sourceYear: true,
        trainingYear: true
      }
    });

    return {
      cities: uniqueSorted(quizzes.map((quiz) => quiz.sourceCity)),
      sourceYears: uniqueSorted(quizzes.map((quiz) => quiz.sourceYear)),
      trainingYears: uniqueSorted(quizzes.map((quiz) => quiz.trainingYear))
    };
  }

  like(id: string) {
    return this.prisma.quiz.update({
      where: { id },
      data: {
        likesCount: {
          increment: 1
        }
      },
      select: {
        id: true,
        likesCount: true
      }
    });
  }

  async report(id: string, reason: QuizReportReason, reporterKey: string) {
    await this.get(id);

    if (!reporterKey?.trim()) {
      throw new BadRequestException("Reporter key is required");
    }

    const prismaReason = this.toPrismaReportReason(reason);
    const existingReport = await this.prisma.quizReport.findUnique({
      where: {
        quizId_reporterKey: {
          quizId: id,
          reporterKey
        }
      }
    });

    if (existingReport) {
      const quiz = await this.prisma.quiz.findUnique({
        where: { id },
        select: {
          id: true,
          reportCount: true
        }
      });

      return {
        ...quiz,
        alreadyReported: true
      };
    }

    const quiz = await this.prisma.$transaction(async (tx) => {
      await tx.quizReport.create({
        data: {
          quizId: id,
          reporterKey,
          reason: prismaReason
        }
      });

      return tx.quiz.update({
        where: { id },
        data: {
          reportCount: {
            increment: 1
          }
        },
        select: {
          id: true,
          reportCount: true
        }
      });
    });

    return {
      ...quiz,
      alreadyReported: false
    };
  }

  async delete(id: string) {
    await this.get(id);
    await this.prisma.quiz.delete({
      where: { id }
    });
    await this.prisma.tag.deleteMany({
      where: {
        quizTags: {
          none: {}
        }
      }
    });

    return { id, deleted: true };
  }

  create(body: CreateQuizBody) {
    this.validateCreateBody(body);
    const tags = [...new Set((body.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
    const correctionPercent = this.calculateCorrectionPercent(body);

    return this.prisma.quiz.create({
      data: {
        title: body.title,
        description: body.description,
        correctionPercent,
        sourceType: body.sourceType ?? null,
        sourceCity: body.sourceCity?.trim() || null,
        sourceYear: body.sourceYear?.trim() || null,
        trainingYear: body.trainingYear?.trim() || null,
        quizTags: {
          create: tags.map((tagName) => ({
            tag: {
              connectOrCreate: {
                where: { name: tagName },
                create: { name: tagName }
              }
            }
          }))
        },
        questions: {
          create: body.questions.map((question, questionIndex) => ({
            type: this.toPrismaQuestionType(question.type ?? "multiple_choice"),
            prompt: question.prompt,
            imageUrl: question.imageUrl || null,
            imageRegions:
              question.type === "image_region"
                ? (this.cleanImageRegions(question.imageRegions ?? []) as unknown as Prisma.InputJsonValue)
                : [],
            imageRegionExplanation:
              question.type === "image_region" ? question.imageRegionExplanation?.trim() || null : null,
            acceptedTextAnswers: question.acceptedTextAnswers ?? [],
            order: questionIndex + 1,
            durationMs: question.durationMs ?? 20_000,
            answerOptions:
              question.type === "open_text" || question.type === "image_region"
                ? undefined
                : {
                    create: (question.options ?? []).map((option, optionIndex) => ({
                      label: option.label,
                      isCorrect: option.isCorrect,
                      explanation: option.explanation?.trim() || null,
                      order: optionIndex + 1
                    }))
                  }
          }))
        }
      },
      include: {
        questions: {
          include: { answerOptions: true }
        },
        quizTags: {
          include: { tag: true }
        }
      }
    });
  }

  private validateCreateBody(body: CreateQuizBody): void {
    if (!body.title?.trim()) {
      throw new BadRequestException("Quiz title is required");
    }

    if (!body.questions?.length) {
      throw new BadRequestException("At least one question is required");
    }

    if (body.sourceType === "uness") {
      if (!body.sourceCity?.trim()) {
        throw new BadRequestException("UNESS city is required");
      }

      if (!body.sourceYear?.trim()) {
        throw new BadRequestException("UNESS year is required");
      }

      if (!body.trainingYear?.trim()) {
        throw new BadRequestException("UNESS training year is required");
      }
    }

    body.questions.forEach((question, index) => {
      const type = question.type ?? "multiple_choice";

      if (!question.prompt?.trim()) {
        throw new BadRequestException(`Question ${index + 1}: prompt is required`);
      }

      if ((type === "image_multiple_choice" || type === "image_region") && !question.imageUrl?.trim()) {
        throw new BadRequestException(`Question ${index + 1}: image URL is required`);
      }

      if (type === "image_region") {
        const regions = this.cleanImageRegions(question.imageRegions ?? []);

        if (regions.length === 0) {
          throw new BadRequestException(`Question ${index + 1}: at least one image region is required`);
        }

        return;
      }

      if (type === "open_text") {
        const answers = question.acceptedTextAnswers?.map((answer) => answer.trim()).filter(Boolean) ?? [];

        if (answers.length === 0) {
          throw new BadRequestException(`Question ${index + 1}: at least one accepted answer is required`);
        }

        return;
      }

      const options = question.options ?? [];

      if (options.length < 2) {
        throw new BadRequestException(`Question ${index + 1}: at least two answer options are required`);
      }

      if (options.some((option) => !option.label.trim())) {
        throw new BadRequestException(`Question ${index + 1}: all answer options are required`);
      }

      if (!options.some((option) => option.isCorrect)) {
        throw new BadRequestException(`Question ${index + 1}: at least one correct option is required`);
      }
    });
  }

  private toPrismaQuestionType(type: NonNullable<CreateQuizBody["questions"][number]["type"]>) {
    switch (type) {
      case "image_multiple_choice":
        return "IMAGE_MULTIPLE_CHOICE";
      case "image_region":
        return "IMAGE_REGION";
      case "open_text":
        return "OPEN_TEXT";
      case "multiple_choice":
      default:
        return "MULTIPLE_CHOICE";
    }
  }

  private toPrismaReportReason(reason: QuizReportReason) {
    switch (reason) {
      case "wrong_content":
        return "WRONG_CONTENT";
      case "offensive_content":
        return "OFFENSIVE_CONTENT";
      case "incorrect_uness_metadata":
        return "INCORRECT_UNESS_METADATA";
      case "other":
      default:
        return "OTHER";
    }
  }

  private calculateCorrectionPercent(body: CreateQuizBody): number {
    const correctionItems: Array<{ explanation?: string }> = body.questions.flatMap(
      (question): Array<{ explanation?: string }> => {
        if (question.type === "open_text") {
          return [];
        }

        if (question.type === "image_region") {
          return [{ explanation: question.imageRegionExplanation ?? "" }];
        }

        return question.options ?? [];
      }
    );

    if (correctionItems.length === 0) {
      return 0;
    }

    const explainedItems = correctionItems.filter((item) => item.explanation?.trim());
    return Math.round((explainedItems.length / correctionItems.length) * 100);
  }

  private cleanImageRegions(regions: ImageRegionDto[]): ImageRegionDto[] {
    return regions
      .map((region, index) => ({
        id: region.id || `region-${index + 1}`,
        points: (region.points ?? [])
          .map((point) => ({
            x: Number(point.x),
            y: Number(point.y)
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          .map((point) => ({
            x: Math.max(0, Math.min(1, point.x)),
            y: Math.max(0, Math.min(1, point.y))
          }))
      }))
      .filter((region) => region.points.length >= 3);
  }
}

function uniqueSorted(values: Array<string | null>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort(
    (a, b) => a.localeCompare(b, "fr")
  );
}
