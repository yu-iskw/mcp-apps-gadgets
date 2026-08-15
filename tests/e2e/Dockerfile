FROM mcr.microsoft.com/playwright:v1.56.0-noble
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile
COPY tests/e2e ./tests/e2e
RUN chown -R pwuser:pwuser /workspace
USER pwuser
WORKDIR /workspace/tests/e2e
HEALTHCHECK CMD node --version >/dev/null 2>&1 || exit 1
CMD ["sh", "-c", "node proxy.mjs & sleep 1; exec pnpm exec playwright test"]
