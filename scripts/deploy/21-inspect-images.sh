#!/bin/bash
set -u
echo "=== inspect lis image app package ==="
docker run --rm --entrypoint sh gxy-lis:latest -c 'ls -la /app/app | head -30; echo ---; cat /app/app/__init__.py; echo ---; python -c "import app,sys; print(app, getattr(app,\"__file__\",None), getattr(app,\"__path__\",None)); print(hasattr(app,\"__version__\"), getattr(app,\"__version__\",None))"'

echo ""
echo "=== inspect tag image models ==="
docker run --rm --entrypoint sh gxy-tag:latest -c 'ls -la /app/app/models | head -20; echo ---; head -5 /app/app/models/__init__.py; echo ---; python -c "from app.models import Base; print(Base)"'

echo ""
echo "=== build log tail ==="
tail -40 /tmp/gxy-build-lis-tag.log 2>/dev/null || echo no-build-log

echo ""
echo "=== volume issue ==="
docker volume ls | grep gxy || true
docker info 2>/dev/null | grep -iE 'Storage|Security|Root|Name' | head -20
