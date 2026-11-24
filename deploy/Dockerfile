# One image for every Node service. Pick the service with --build-arg SERVICE_DIR=<path>.
# e.g. docker build -f deploy/Dockerfile --build-arg SERVICE_DIR=mmaxr-platform/services/user-auth .
FROM node:22-slim
RUN corepack enable
ARG SERVICE_DIR
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "./${SERVICE_DIR:-.}..." || pnpm install --frozen-lockfile
ENV SERVICE_DIR=${SERVICE_DIR} NODE_ENV=production
WORKDIR /app/${SERVICE_DIR}
CMD ["npx", "tsx", "src/index.ts"]
