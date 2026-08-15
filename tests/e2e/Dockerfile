FROM mcr.microsoft.com/playwright:v1.55.0-noble
WORKDIR /tests
RUN npm init -y && npm install --save-dev @playwright/test@1.55.0
COPY tests/e2e ./
CMD ["npx", "playwright", "test"]
