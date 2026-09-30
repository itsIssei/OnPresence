# OnPresence: Vite frontend embedded in a static Go binary.
# Multi-arch: the build stages run on the build machine and cross-compile.

# ---- frontend ----
FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- server ----
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS builder
ARG TARGETOS TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY embed.go ./
COPY server/ ./server/
COPY --from=web /web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags="-w -s -X main.version=${VERSION}" -o /out/onpresence ./server

# ---- runtime ----
FROM alpine:3.22
ARG VERSION=dev
LABEL org.opencontainers.image.title="OnPresence" \
      org.opencontainers.image.description="Self-hosted profile card and hobby display case" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"

RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 10001 onpresence \
 && adduser -S -D -H -u 10001 -G onpresence onpresence \
 && mkdir -p /app/data \
 && chown -R onpresence:onpresence /app/data

WORKDIR /app
COPY --from=builder /out/onpresence /app/onpresence

ENV PORT=8080 \
    DATA_DIR=/app/data

USER onpresence
EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["/app/onpresence"]
