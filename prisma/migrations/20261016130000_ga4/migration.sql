-- CreateTable
CREATE TABLE "Ga4Row" (
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "landing" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "keyEvents" DOUBLE PRECISION NOT NULL,
    "revenue" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Ga4Row_pkey" PRIMARY KEY ("projectId","date","landing")
);

-- AddForeignKey
ALTER TABLE "Ga4Row" ADD CONSTRAINT "Ga4Row_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
