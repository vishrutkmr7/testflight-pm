# TestFlight PM GitHub Action Docker Image
# Uses Bun runtime for optimal performance

FROM oven/bun:1.1.34-alpine AS base

# Set working directory
WORKDIR /app

# Install git for repository operations (if needed)
RUN apk add --no-cache git

# Copy package files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src/ ./src/
COPY types/ ./types/
COPY tsconfig.json ./

# Copy action entry point
COPY action-entrypoint.ts ./

# Build the application
RUN bun build action-entrypoint.ts --outdir dist --target bun

# Production stage
FROM oven/bun:1.1.34-alpine AS production

WORKDIR /app

# Install necessary runtime dependencies
RUN apk add --no-cache \
    git \
    ca-certificates \
    tzdata

# Copy built application and dependencies
COPY --from=base /app/dist/ ./dist/
COPY --from=base /app/node_modules/ ./node_modules/
COPY --from=base /app/package.json ./

# Create non-root user for security
RUN addgroup -g 1001 -S testflight && \
    adduser -S testflight -u 1001 -G testflight

# Change ownership of app directory
RUN chown -R testflight:testflight /app

# Switch to non-root user
USER testflight

# Set environment variables
ENV NODE_ENV=production
ENV BUN_RUNTIME=true

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD bun --version || exit 1

# Entry point for GitHub Action
ENTRYPOINT ["bun", "run", "dist/action-entrypoint.js"] 