# Multi-stage build for Family Tree Builder.
#
#   runtime (default) -> small production-ish image, data in /data
#   dev               -> Go toolchain + air for live reload
#
# No BuildKit-only syntax is used, so this builds with Docker, Podman,
# and buildah alike.

############## 1. Build the binary ##############
FROM golang:1.26-bookworm AS build
WORKDIR /src

# Warm the module cache in its own layer so code edits don't re-download deps.
COPY go.mod go.sum ./
RUN go mod download

# CGO is required by github.com/mattn/go-sqlite3.
COPY . .
RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/familytree .

############## 2. Dev image: live reload via air ##############
FROM build AS dev
# Air rebuilds and restarts whenever a watched file changes. The UI is embedded
# in the binary (go:embed), so .js/.css/.html changes trigger a rebuild too.
RUN go install github.com/air-verse/air@latest
EXPOSE 8099
CMD ["air"]

############## 3. Runtime image ##############
FROM debian:bookworm-slim AS runtime

# ca-certificates: update checker, S3 and Google OAuth.
# curl: used by the HEALTHCHECK below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/familytree /usr/local/bin/familytree

# The app writes familytree.db and uploads/ into its working directory;
# /data is where docker-compose.yml bind-mounts your persistent data.
WORKDIR /data

# Deliberately runs as root inside the container: rootless Podman maps uid 0
# back to your own account, so files written to ./data stay owned by you.
# With Docker you can drop privileges by adding e.g.
#   user: "1000:1000"
# to a service in docker-compose.yml.

EXPOSE 8099

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8099/api/persons >/dev/null || exit 1

ENTRYPOINT ["familytree"]
