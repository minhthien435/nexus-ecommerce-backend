# syntax=docker/dockerfile:1

FROM node:24-slim AS builder
WORKDIR /app
ENV HUSKY=0

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HUSKY=0
ENV PORT=3000

COPY package*.json ./
RUN npm pkg delete scripts.prepare && npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main"]
