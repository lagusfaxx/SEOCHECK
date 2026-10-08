-- Estados claros de crawl
ALTER TABLE "Crawl" ADD COLUMN "reason" TEXT;
UPDATE "Crawl" SET "status" = 'completed' WHERE "status" = 'done';
UPDATE "Crawl" SET "status" = 'failed', "reason" = 'Error durante el crawl (registro anterior)' WHERE "status" = 'error';
UPDATE "Crawl" SET "status" = 'failed', "reason" = 'Interrumpido' WHERE "status" IN ('running', 'crawling');
