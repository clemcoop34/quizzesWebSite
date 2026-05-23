-- Add reporter identity to prevent duplicate reports from the same browser.
ALTER TABLE "QuizReport" ADD COLUMN "reporterKey" TEXT;

UPDATE "QuizReport"
SET "reporterKey" = CONCAT('legacy-', "id")
WHERE "reporterKey" IS NULL;

ALTER TABLE "QuizReport" ALTER COLUMN "reporterKey" SET NOT NULL;

CREATE UNIQUE INDEX "QuizReport_quizId_reporterKey_key"
ON "QuizReport"("quizId", "reporterKey");
