ALTER TABLE "Question" ADD COLUMN "imageRegions" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "PlayerAnswer" ADD COLUMN "selectedPoint" JSONB;
