FROM node:24-bookworm-slim
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p .data && chown -R node:node /app
USER node
EXPOSE 4300
CMD ["npm", "run", "api"]
