FROM public.ecr.aws/docker/library/node:22-alpine AS base
WORKDIR /app

# 依存インストール用
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ビルド用
FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# 本番イメージ
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# OSパッケージを最新化（libssl/libcrypto等の脆弱性修正の取り込み）
RUN apk upgrade --no-cache

# ランタイムでは npm を使用しない（CMD は node 直接実行）ため削除する。
# npm が同梱する依存（tar, glob 等）の脆弱性を実行イメージから排除する目的
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# 非rootユーザー
RUN addgroup -S app && adduser -S app -G app

# アップロード用ディレクトリを事前作成
RUN mkdir -p /app/uploads /app/output-web && chown -R app:app /app/uploads /app/output-web

USER app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O- http://localhost:3000/health || exit 1

CMD ["node", "dist/web/server.js"]
