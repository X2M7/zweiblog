FROM node:22-alpine AS ADMIN_BUILDER
ENV NODE_OPTIONS='--max_old_space_size=4096 --openssl-legacy-provider'
ENV EEE=production
WORKDIR /repo
RUN apk add --update python3 make g++ && rm -rf /var/cache/apk/*
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./packages/admin/ ./packages/admin/
RUN corepack enable
RUN corepack prepare pnpm@8.11.0 --activate
RUN pnpm config set network-timeout 600000 -g
RUN pnpm config set registry https://registry.npmjs.org -g
RUN pnpm config set fetch-retries 20 -g
RUN pnpm config set fetch-timeout 600000 -g
RUN pnpm install --frozen-lockfile --filter @zweiblog/admin...
RUN pnpm --filter @zweiblog/admin build

FROM node:22-alpine AS SERVER_BUILDER
ENV NODE_OPTIONS=--max_old_space_size=4096
WORKDIR /repo
RUN apk add --no-cache python3 make g++
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./packages/server/ ./packages/server/
RUN corepack enable
RUN corepack prepare pnpm@8.11.0 --activate
RUN pnpm config set network-timeout 600000 -g
RUN pnpm config set registry https://registry.npmmirror.com -g
RUN pnpm config set fetch-retries 20 -g
RUN pnpm config set fetch-timeout 600000 -g
RUN pnpm install --frozen-lockfile --filter @zweiblog/server...
RUN pnpm --filter @zweiblog/server build
RUN pnpm --filter @zweiblog/server deploy --prod /out/server

FROM node:22-alpine AS RUNTIME_DEPS_BUILDER
WORKDIR /repo
RUN apk add --no-cache python3 make g++
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./
COPY ./packages/cli/ ./packages/cli/
RUN corepack enable
RUN corepack prepare pnpm@8.11.0 --activate
RUN pnpm config set network-timeout 600000 -g
RUN pnpm config set registry https://registry.npmmirror.com -g
RUN pnpm config set fetch-retries 20 -g
RUN pnpm config set fetch-timeout 600000 -g
RUN pnpm install --frozen-lockfile --filter zweiblog-cli...
RUN pnpm --filter zweiblog-cli deploy --prod /out/cli

FROM node:22-alpine AS WEBSITE_BUILDER
WORKDIR /repo
RUN apk add --update python3 make g++ && rm -rf /var/cache/apk/*
COPY ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ./tsconfig.base.json ./
COPY ./packages/website ./packages/website
ENV isBuild=t
ENV ZWEI_BLOG_ALLOW_DOMAINS="pic.mereith.com"
ARG ZWEI_BLOG_BUILD_SERVER
ENV ZWEI_BLOG_SERVER_URL=${ZWEI_BLOG_BUILD_SERVER}
ARG ZWEI_BLOG_VERSIONS
ENV ZWEI_BLOG_VERSION=${ZWEI_BLOG_VERSIONS}
RUN corepack enable
RUN corepack prepare pnpm@8.11.0 --activate
RUN pnpm config set network-timeout 600000 -g
RUN pnpm config set registry https://registry.npmmirror.com -g
RUN pnpm config set fetch-retries 20 -g
RUN pnpm config set fetch-timeout 600000 -g
RUN pnpm install --frozen-lockfile --filter @zweiblog/theme-default...
RUN pnpm --filter @zweiblog/theme-default build

FROM node:22-alpine AS RUNNER
WORKDIR /app
RUN apk add --no-cache --update tzdata caddy nss-tools libwebp-tools libcap \
  && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
  && echo "Asia/Shanghai" > /etc/timezone \
  && apk del tzdata \
  && setcap cap_net_bind_service=+ep "$(command -v caddy)"

WORKDIR /app/cli
COPY --from=RUNTIME_DEPS_BUILDER /out/cli/ ./

WORKDIR /app/server
COPY --from=SERVER_BUILDER /out/server/node_modules ./node_modules
COPY --from=SERVER_BUILDER /repo/packages/server/dist/src/ ./

WORKDIR /app/website
COPY --from=WEBSITE_BUILDER /repo/packages/website/.next/standalone/ ./
COPY --from=WEBSITE_BUILDER /repo/packages/website/next.config.js ./packages/website/next.config.js
COPY --from=WEBSITE_BUILDER /repo/packages/website/public ./packages/website/public
COPY --from=WEBSITE_BUILDER /repo/packages/website/package.json ./packages/website/package.json
COPY --from=WEBSITE_BUILDER /repo/packages/website/.next/static ./packages/website/.next/static

ENV NODE_ENV=production
ENV HOME=/home/zweiblog
ENV ZWEI_BLOG_SERVER_URL="http://127.0.0.1:3000"
ENV ZWEI_BLOG_ALLOW_DOMAINS="pic.mereith.com"
ENV EMAIL="vanblog@mereith.com"
ENV ZWEI_BLOG_LEGACY_WALINE_DB="waline"

WORKDIR /app/admin
COPY --from=ADMIN_BUILDER /repo/packages/admin/dist/ ./
COPY caddyTemplate.json /app/caddyTemplate.json

WORKDIR /app
COPY ./scripts/start.js ./
COPY ./entrypoint.sh ./
ENV PORT=3001
ARG ZWEI_BLOG_VERSIONS
ENV ZWEI_BLOG_VERSION=${ZWEI_BLOG_VERSIONS}
RUN addgroup -S -g 10001 zweiblog \
  && adduser -S -D -u 10001 -G zweiblog -h /home/zweiblog zweiblog \
  && mkdir -p /app/static /var/log /home/zweiblog/.config/caddy /home/zweiblog/.local/share/caddy \
  && chown -R zweiblog:zweiblog /app /var/log /home/zweiblog

VOLUME /app/static
VOLUME /var/log
VOLUME /home/zweiblog/.config/caddy
VOLUME /home/zweiblog/.local/share/caddy

EXPOSE 80
USER zweiblog
ENTRYPOINT ["sh", "entrypoint.sh"]
