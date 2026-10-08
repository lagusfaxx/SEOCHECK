-- CreateTable
CREATE TABLE "GscDay" (
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscDay_pkey" PRIMARY KEY ("projectId","date")
);

-- AddForeignKey
ALTER TABLE "GscDay" ADD CONSTRAINT "GscDay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
