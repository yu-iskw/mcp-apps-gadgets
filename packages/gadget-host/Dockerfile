FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/gadget-host/package.json packages/gadget-host/package.json
RUN pnpm install --filter @mcp-app-gadgets/host... --frozen-lockfile
COPY packages/gadget-host packages/gadget-host
RUN pnpm --filter @mcp-app-gadgets/host build
EXPOSE 8080 8081
CMD ["pnpm", "--filter", "@mcp-app-gadgets/host", "start"]
