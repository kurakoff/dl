FROM node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev && rm -rf /root/.npm

COPY src/ ./src/
COPY entrypoint.sh ./

RUN mkdir -p /app/data

EXPOSE 3001

CMD ["sh", "entrypoint.sh"]
