#!/bin/sh
set -e

echo "Checking database connectivity..."
node ./docker-entrypoint-check-db.js

echo "Applying database migrations..."
npx prisma migrate deploy

exec "$@"
