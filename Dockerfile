FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json build.mjs ./
COPY src/ src/
RUN node build.mjs

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/package.json ./
RUN npm install -g @earendil-works/pi-coding-agent
EXPOSE 8080
CMD ["node", "dist/cli.js", "start"]
