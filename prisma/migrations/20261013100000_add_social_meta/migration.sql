-- AlterTable: agregar campo provider a OAuthState
ALTER TABLE "OAuthState" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'google';

-- CreateTable: MetaConnection
CREATE TABLE "MetaConnection" (
    "projectId" TEXT NOT NULL,
    "igAccountId" TEXT NOT NULL,
    "igAccountName" TEXT NOT NULL,
    "pageId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "connectedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable: SocialPost
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'instagram',
    "caption" TEXT NOT NULL,
    "imageUrl" TEXT,
    "imagePrompt" TEXT,
    "keywords" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "metaMediaId" TEXT,
    "metaPostId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "errorMsg" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialPost_projectId_status_idx" ON "SocialPost"("projectId", "status");

-- CreateIndex
CREATE INDEX "SocialPost_projectId_createdAt_idx" ON "SocialPost"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "MetaConnection" ADD CONSTRAINT "MetaConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
