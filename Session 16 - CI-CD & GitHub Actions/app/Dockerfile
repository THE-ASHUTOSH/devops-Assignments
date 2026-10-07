FROM node:20-alpine

# pull in patched OS packages (trivy flagged HIGH openssl CVEs in the base image)
RUN apk --no-cache upgrade

WORKDIR /app

# copy package.json first so this layer caches when only source changes
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# don't run as root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 3000
CMD ["node", "src/server.js"]
