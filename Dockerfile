FROM node:20-slim

WORKDIR /app

# Install server + client deps first so the layer caches across source edits.
COPY package*.json ./
COPY arena-client/package*.json ./arena-client/
RUN npm install

COPY . .

# Bundle the React client; arena-server.js serves arena-client/dist when present.
RUN npm run build

ENV PORT=8080
EXPOSE 8080

CMD ["node", "arena-server.js"]
