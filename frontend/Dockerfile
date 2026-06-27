### Stage 1: build the SPA ####################################################
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Point the built app at the nginx proxy path (same host, /api/ prefix)
ENV VITE_API_BASE_URL=""

RUN npm run build

### Stage 2: serve with nginx #################################################
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
