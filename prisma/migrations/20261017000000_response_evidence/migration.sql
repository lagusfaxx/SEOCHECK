ALTER TABLE "Page" ADD COLUMN "responseHtml" TEXT, ADD COLUMN "responseTruncated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Webhook" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'json', ADD COLUMN "recipient" TEXT, ADD COLUMN "template" TEXT;
CREATE TABLE "WebhookDelivery" (
 "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "webhookId" TEXT NOT NULL, "eventKey" TEXT NOT NULL, "event" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0, "nextAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "WebhookDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebhookDelivery_webhookId_eventKey_key" ON "WebhookDelivery"("webhookId","eventKey");
CREATE INDEX "WebhookDelivery_status_nextAt_idx" ON "WebhookDelivery"("status","nextAt");
