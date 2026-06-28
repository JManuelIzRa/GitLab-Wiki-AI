### Stage 1: build the SPA ####################################################
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Point the built app at the nginx proxy path (same host, /api/ prefix)
ENV VITE_API_BASE_URL=""

RUN npm run build

### Stage 2: serve with nginx #################################################
FROM nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
