FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY server.js ./
COPY audio-assets ./audio-assets

EXPOSE 8080

CMD ["npm", "start"]
