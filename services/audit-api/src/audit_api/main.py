"""Stateless local analysis API. Bind to loopback only; not a hosted multi-user backend."""

from threading import Lock

from audit_core import __version__
from audit_core.engine import analyze
from audit_core.models import AuditInput, AuditReport
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from audit_api.review import EnhancedReport, ReviewError, public_settings, review

ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
MAX_BODY_BYTES = 64_000


class LocalRequestBoundary:
    """Bound even chunked bodies before JSON parsing; block foreign browser origins."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "POST":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        origin = headers.get(b"origin", b"").decode("latin-1")
        if origin and origin not in ALLOWED_ORIGINS:
            return await JSONResponse({"detail": "Origin not allowed"}, 403)(scope, receive, send)
        body = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            body.extend(event.get("body", b""))
            if len(body) > MAX_BODY_BYTES:
                return await JSONResponse({"detail": "Request body too large"}, 413)(
                    scope, receive, send
                )
            if not event.get("more_body", False):
                break
        consumed = False

        async def replay():
            nonlocal consumed
            if not consumed:
                consumed = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


app = FastAPI(title="DTCC — Smart Contract Analysis", version=__version__)
app.add_middleware(LocalRequestBoundary)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    allow_credentials=False,
)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Never echo source or the raw request inside framework validation errors.
    return JSONResponse(
        status_code=422,
        content={
            "detail": "Invalid request. Supply a .sol filename and nonblank UTF-8 source "
            "within 48,000 bytes, 1,200 lines and 2,000 characters per line."
        },
    )


@app.get("/api/health")
def health():
    return {"status": "ok", "version": __version__, "mode": "static", "offline": True}


@app.post("/api/audits", response_model=AuditReport)
def audit(data: AuditInput):
    # Sync route runs bounded CPU work in FastAPI's worker thread pool.
    return analyze(data)


review_slot = Lock()


@app.exception_handler(ReviewError)
async def review_error(request: Request, exc: ReviewError):
    return JSONResponse(status_code=exc.status, content={"detail": str(exc)})


@app.get("/api/config")
def configuration():
    return public_settings()


@app.post("/api/reviews", response_model=EnhancedReport)
async def enhanced_audit(data: AuditInput):
    if not review_slot.acquire(blocking=False):
        raise ReviewError("A Bedrock review is already running. Retry after it completes.", 429)
    try:
        return await review(analyze(data))
    finally:
        review_slot.release()
