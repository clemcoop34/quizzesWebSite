-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'IMAGE_MULTIPLE_CHOICE', 'IMAGE_REGION', 'OPEN_TEXT');

-- AlterTable
ALTER TABLE "PlayerAnswer" ADD COLUMN     "textAnswer" TEXT,
ALTER COLUMN "answerOptionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "acceptedTextAnswers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "type" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE';

-- AlterTable
ALTER TABLE "Quiz" ADD COLUMN     "likesCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizTag" (
    "quizId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "QuizTag_pkey" PRIMARY KEY ("quizId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- AddForeignKey
ALTER TABLE "QuizTag" ADD CONSTRAINT "QuizTag_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizTag" ADD CONSTRAINT "QuizTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
