FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/demo-mcp-app/package.json packages/demo-mcp-app/package.json
RUN pnpm install --filter @mcp-app-gadgets/demo-mcp-app... --frozen-lockfile
COPY packages/demo-mcp-app packages/demo-mcp-app
RUN pnpm --filter @mcp-app-gadgets/demo-mcp-app build
EXPOSE 3001
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3001/health >/dev/null 2>&1 || exit 1
CMD ["pnpm", "--filter", "@mcp-app-gadgets/demo-mcp-app", "start"]
