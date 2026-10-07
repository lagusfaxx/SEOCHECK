-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'cl',
    "language" TEXT NOT NULL DEFAULT 'es',
    "locationCode" INTEGER NOT NULL DEFAULT 2152,
    "gscProperty" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "seeds" TEXT[],
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.45,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "term" TEXT NOT NULL,
    "sources" TEXT[],
    "relevance" DOUBLE PRECISION,
    "volume" INTEGER,
    "cpc" DOUBLE PRECISION,
    "competition" DOUBLE PRECISION,
    "intent" TEXT,
    "difficulty" DOUBLE PRECISION,
    "score" DOUBLE PRECISION,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "clusterId" TEXT,
    "embedding" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "name" TEXT NOT NULL,
    "primary" TEXT NOT NULL,
    "intent" TEXT,
    "volume" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "urls" TEXT[],
    "topicId" TEXT,
    "isPillar" BOOLEAN NOT NULL DEFAULT false,
    "pos" JSONB,

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "name" TEXT NOT NULL,
    "pos" JSONB,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerpSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 10,
    "organic" JSONB NOT NULL,
    "paa" TEXT[],
    "related" TEXT[],
    "features" TEXT[],
    "aiOverview" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerpSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Crawl" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "options" JSONB NOT NULL DEFAULT '{}',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "robots" TEXT,
    "sitemapUrls" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Crawl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "status" INTEGER NOT NULL,
    "redirects" JSONB NOT NULL DEFAULT '[]',
    "contentType" TEXT,
    "title" TEXT,
    "titleLen" INTEGER NOT NULL DEFAULT 0,
    "metaDesc" TEXT,
    "metaLen" INTEGER NOT NULL DEFAULT 0,
    "h1" TEXT[],
    "canonical" TEXT,
    "canonicalType" TEXT,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "hreflang" JSONB NOT NULL DEFAULT '[]',
    "jsonldTypes" TEXT[],
    "jsonldErrors" INTEGER NOT NULL DEFAULT 0,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "imgNoAlt" INTEGER NOT NULL DEFAULT 0,
    "inlinks" INTEGER NOT NULL DEFAULT 0,
    "outlinks" INTEGER NOT NULL DEFAULT 0,
    "links" TEXT[],
    "responseMs" INTEGER NOT NULL DEFAULT 0,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "contentHash" TEXT,
    "inSitemap" BOOLEAN NOT NULL DEFAULT false,
    "orphan" BOOLEAN NOT NULL DEFAULT false,
    "blocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "crawlId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detail" TEXT,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsiResult" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "score" INTEGER,
    "lab" JSONB NOT NULL,
    "field" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsiResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlInspection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "verdict" TEXT,
    "coverageState" TEXT,
    "googleCanonical" TEXT,
    "userCanonical" TEXT,
    "lastCrawl" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UrlInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedKeyword" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "depth" INTEGER NOT NULL DEFAULT 10,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankCheck" (
    "id" TEXT NOT NULL,
    "trackedId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "position" INTEGER,
    "url" TEXT,
    "features" TEXT[],
    "competitors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "RankCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscRow" (
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscRow_pkey" PRIMARY KEY ("projectId","date","query","page")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "seen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAnalysis" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "score" INTEGER,
    "result" JSONB NOT NULL DEFAULT '{}',
    "brief" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorpusTerm" (
    "lang" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "df" INTEGER NOT NULL,

    CONSTRAINT "CorpusTerm_pkey" PRIMARY KEY ("lang","term")
);

-- CreateTable
CREATE TABLE "CorpusMeta" (
    "lang" TEXT NOT NULL,
    "docs" INTEGER NOT NULL,

    CONSTRAINT "CorpusMeta_pkey" PRIMARY KEY ("lang")
);

-- CreateIndex
CREATE INDEX "JobRun_projectId_kind_createdAt_idx" ON "JobRun"("projectId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Keyword_runId_idx" ON "Keyword"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_projectId_term_key" ON "Keyword"("projectId", "term");

-- CreateIndex
CREATE INDEX "SerpSnapshot_projectId_keyword_fetchedAt_idx" ON "SerpSnapshot"("projectId", "keyword", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Page_crawlId_url_key" ON "Page"("crawlId", "url");

-- CreateIndex
CREATE INDEX "Issue_crawlId_severity_idx" ON "Issue"("crawlId", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedKeyword_projectId_keyword_key" ON "TrackedKeyword"("projectId", "keyword");

-- CreateIndex
CREATE INDEX "RankCheck_trackedId_date_idx" ON "RankCheck"("trackedId", "date");

-- CreateIndex
CREATE INDEX "GscRow_projectId_query_idx" ON "GscRow"("projectId", "query");

-- CreateIndex
CREATE INDEX "Alert_projectId_seen_idx" ON "Alert"("projectId", "seen");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordRun" ADD CONSTRAINT "KeywordRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KeywordRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KeywordRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KeywordRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerpSnapshot" ADD CONSTRAINT "SerpSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Crawl" ADD CONSTRAINT "Crawl_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "Crawl"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PsiResult" ADD CONSTRAINT "PsiResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlInspection" ADD CONSTRAINT "UrlInspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedKeyword" ADD CONSTRAINT "TrackedKeyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankCheck" ADD CONSTRAINT "RankCheck_trackedId_fkey" FOREIGN KEY ("trackedId") REFERENCES "TrackedKeyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscRow" ADD CONSTRAINT "GscRow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAnalysis" ADD CONSTRAINT "ContentAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
