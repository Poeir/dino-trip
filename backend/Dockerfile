FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

# Production deps only -- playwright and the supabase CLI are dev tooling for
# the one-off scripts, not needed to serve the API.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# The official node image ships an unprivileged `node` user.
RUN chown -R node:node /app
USER node

EXPOSE 4000
CMD ["node", "src/server.js"]
