.PHONY: install build lint test typecheck dev clean tauri-dev tauri-build

NODE_BIN := ./node_modules/.bin

install:
	pnpm install

build:
	pnpm run build

lint:
	pnpm run lint

test:
	pnpm run test:run

typecheck:
	pnpm run typecheck

dev:
	pnpm run dev

tauri-dev:
	pnpm run tauri:dev

tauri-build:
	pnpm run tauri:build

clean:
	rm -rf dist coverage node_modules src-tauri/target
