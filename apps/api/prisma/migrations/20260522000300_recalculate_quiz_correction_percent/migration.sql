UPDATE "Quiz"
SET "correctionPercent" = COALESCE((
  SELECT ROUND(
    COUNT(*) FILTER (
      WHERE "AnswerOption"."explanation" IS NOT NULL
        AND LENGTH(TRIM("AnswerOption"."explanation")) > 0
    )::numeric
    / NULLIF(COUNT(*), 0)
    * 100
  )::int
  FROM "Question"
  JOIN "AnswerOption" ON "AnswerOption"."questionId" = "Question"."id"
  WHERE "Question"."quizId" = "Quiz"."id"
), 0);
