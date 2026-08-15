FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/demo-mcp-app/package.json packages/demo-mcp-app/package.json
RUN pnpm install --filter @mcp-app-gadgets/demo-mcp-app... --no-frozen-lockfile
COPY packages/demo-mcp-app packages/demo-mcp-app
RUN pnpm --filter @mcp-app-gadgets/demo-mcp-app build
EXPOSE 3001
CMD ["pnpm", "--filter", "@mcp-app-gadgets/demo-mcp-app", "start"]
