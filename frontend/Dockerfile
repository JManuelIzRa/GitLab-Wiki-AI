### Stage 1: build the SPA ####################################################
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9 AS build

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
