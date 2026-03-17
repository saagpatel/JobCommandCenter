from __future__ import annotations

import asyncio
import signal
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.adapters.registry import AdapterRegistry
from src.api.routes import router

logger = structlog.get_logger(__name__)

_HOST = "127.0.0.1"
_PORT = 9876
_ALLOWED_ORIGINS = [
    "http://localhost:1420",
    "tauri://localhost",
]


def _configure_structlog() -> None:
    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(20),  # INFO
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    log = structlog.get_logger("jcc.lifespan")
    log.info("sidecar starting", host=_HOST, port=_PORT)
    app.state.startup_time = time.monotonic()
    registry = AdapterRegistry()

    from src.adapters.ashby import AshbyAdapter
    registry.register("ashby", AshbyAdapter())

    app.state.registry = registry
    yield
    log.info("sidecar shutting down")


def _build_app(shutdown_event: asyncio.Event) -> FastAPI:
    app = FastAPI(title="JCC Sidecar", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.shutdown_event = shutdown_event
    app.include_router(router)
    return app


async def _run(shutdown_event: asyncio.Event) -> None:
    app = _build_app(shutdown_event)

    config = uvicorn.Config(
        app=app,
        host=_HOST,
        port=_PORT,
        log_config=None,
    )
    server = uvicorn.Server(config)

    # Run server and shutdown waiter concurrently
    async def _wait_for_shutdown() -> None:
        await shutdown_event.wait()
        server.should_exit = True

    await asyncio.gather(server.serve(), _wait_for_shutdown())


def main() -> None:
    _configure_structlog()
    log = structlog.get_logger("jcc.main")

    shutdown_event = asyncio.Event()

    # Handle SIGTERM/SIGINT for graceful shutdown
    def _signal_handler(sig: int, _frame: object) -> None:
        log.info("received signal", signal=sig)
        shutdown_event.set()

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    log.info("sidecar starting", host=_HOST, port=_PORT)
    asyncio.run(_run(shutdown_event))
    log.info("sidecar stopped")


if __name__ == "__main__":
    main()
