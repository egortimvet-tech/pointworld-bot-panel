FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
CMD ["npm", "start"]
