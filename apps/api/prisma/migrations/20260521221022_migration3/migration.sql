-- CreateEnum
CREATE TYPE "QuizReportReason" AS ENUM ('WRONG_CONTENT', 'OFFENSIVE_CONTENT', 'OTHER');

-- AlterTable
ALTER TABLE "AnswerOption" ADD COLUMN     "explanation" TEXT;

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "correctionPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reportCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "QuizReport" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "reason" "QuizReportReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizReport_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "QuizReport" ADD CONSTRAINT "QuizReport_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
