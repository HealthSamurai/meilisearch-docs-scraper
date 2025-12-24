# Lightweight Bun runtime image
FROM oven/bun:1-alpine

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Default command expects config.json to be mounted
ENTRYPOINT ["bun", "run", "src/index.ts"]
CMD ["config.json"]
