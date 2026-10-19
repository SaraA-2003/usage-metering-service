FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY examples/web ./examples/web
RUN npm run build

ENV NODE_ENV=production
USER node
EXPOSE 8080 3000
CMD ["npm", "start"]
