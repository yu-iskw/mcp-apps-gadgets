FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/oauth-demo-mcp-app/package.json packages/oauth-demo-mcp-app/package.json
RUN pnpm install --filter @mcp-app-gadgets/oauth-demo-mcp-app... --frozen-lockfile
COPY packages/oauth-demo-mcp-app packages/oauth-demo-mcp-app
RUN pnpm --filter @mcp-app-gadgets/oauth-demo-mcp-app build
EXPOSE 3002
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3002/health >/dev/null 2>&1 || exit 1
CMD ["pnpm", "--filter", "@mcp-app-gadgets/oauth-demo-mcp-app", "start"]
