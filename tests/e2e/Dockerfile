FROM mcr.microsoft.com/playwright:v1.56.0-noble
WORKDIR /tests
RUN npm init -y && npm install --save-dev @playwright/test@1.56.0
COPY tests/e2e ./
RUN chown -R pwuser:pwuser /tests
USER pwuser
HEALTHCHECK CMD node --version >/dev/null 2>&1 || exit 1
CMD ["npx", "playwright", "test"]
