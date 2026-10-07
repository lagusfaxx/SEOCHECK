FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npx next build

FROM base AS run
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/tsconfig.json /app/next.config.mjs ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx next start -p ${PORT}"]
