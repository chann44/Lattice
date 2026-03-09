FROM oven/bun:1.2.20

WORKDIR /app

COPY package.json bun.lock tsconfig.json drizzle.config.ts ./
RUN bun install --frozen-lockfile

COPY . .

RUN mkdir -p /data/blobs

ENV PORT=8080
ENV DB_PATH=/data/agent-scm.db
ENV BLOBS_DIR=/data/blobs

EXPOSE 8080
VOLUME ["/data"]

CMD ["bun", "index.ts"]
