-- AlterTable
ALTER TABLE "Cluster" ADD COLUMN     "nameLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pillarLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "topicLocked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "locked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Topic" ADD COLUMN     "nameLocked" BOOLEAN NOT NULL DEFAULT false;
