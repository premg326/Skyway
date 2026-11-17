FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV NODE_ENV=production
EXPOSE 4173
USER node
CMD ["node", "server.mjs"]
