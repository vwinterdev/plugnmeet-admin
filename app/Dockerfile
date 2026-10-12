FROM node:22-alpine
WORKDIR /srv
COPY server.js ./
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
