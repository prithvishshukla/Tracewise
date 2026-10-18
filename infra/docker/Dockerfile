# One image for api, worker and web (the compose file chooses the command).
# NOTE: authored without access to a Docker daemon; verify with `docker compose --profile app build`.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN npm ci && npm run build:web && chown -R node:node /app
USER node
ENV NODE_ENV=production
EXPOSE 3000 4000
CMD ["npm", "run", "start", "-w", "@tracewise/api"]
