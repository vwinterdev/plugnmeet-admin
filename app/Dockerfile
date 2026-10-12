FROM node:22-alpine AS build
WORKDIR /build
COPY package.json ./
RUN npm install
COPY vite.config.js index.html ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /srv
COPY server.js ./
COPY --from=build /build/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "server.js"]
