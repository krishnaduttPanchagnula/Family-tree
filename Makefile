# Family Tree Builder — development tasks.
#
#   make            list the targets
#   make run        start the app on http://localhost:8099
#   make test       run the tests
#
# The app is a multi-file Go package, so it is always run as a package:
# `go run .` — not `go run main.go`, which compiles that one file only and
# leaves the rest of the package undefined.

BINARY  := familytree
BIN_DIR := bin
PORT    ?= 8099
GO      ?= go

.DEFAULT_GOAL := help

.PHONY: help run build install test testv cover vet fmt fmtcheck check clean dev \
        docker docker-dev docker-down docker-logs release tidy

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

run: ## Run the app (go run . — the whole package)
	$(GO) run .

build: ## Build the binary into ./bin
	@mkdir -p $(BIN_DIR)
	$(GO) build -trimpath -ldflags "-s -w" -o $(BIN_DIR)/$(BINARY) .

install: ## Build and install the binary into GOBIN
	$(GO) install -trimpath -ldflags "-s -w" .

test: ## Run the tests
	$(GO) test ./...

testv: ## Run the tests with names and output
	$(GO) test -v ./...

cover: ## Run the tests and write a coverage profile
	$(GO) test -coverprofile=coverage.out ./...
	$(GO) tool cover -func=coverage.out | tail -1

vet: ## Run go vet
	$(GO) vet ./...

fmt: ## Format the Go files
	$(GO) fmt ./...

fmtcheck: ## Fail if a Go file is not formatted
	@unformatted=$$(gofmt -l . 2>/dev/null); \
	if [ -n "$$unformatted" ]; then echo "not formatted:"; echo "$$unformatted"; exit 1; fi; \
	echo "all Go files are formatted"

check: fmtcheck vet test ## Format check, vet and test

tidy: ## Tidy the module dependencies
	$(GO) mod tidy

clean: ## Remove build artefacts (uploads/ and backups/ are left alone)
	rm -rf $(BIN_DIR) tmp coverage.out
	rm -f familytree.db familytree.db-shm familytree.db-wal
	@echo "cleaned (uploads/ and backups/ kept)"

dev: ## Run with hot reload (needs air: go install github.com/air-verse/air@latest)
	air

docker: ## Build and run the container
	docker compose up --build

docker-dev: ## Run the container with hot reload
	docker compose --profile dev up dev

docker-down: ## Stop the containers
	docker compose down

docker-logs: ## Follow the container logs
	docker compose logs -f

release: ## Build a local snapshot release (needs goreleaser)
	goreleaser release --snapshot --clean
