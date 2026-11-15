#!/usr/bin/env sh
# Self-signed certificate for the local mock of claude.ai / chatgpt.com / gemini.google.com.
# Generated on demand so no private key is ever committed.
set -e
cd "$(dirname "$0")"
[ -f key.pem ] && [ -f cert.pem ] && exit 0
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:claude.ai,DNS:chatgpt.com,DNS:gemini.google.com,DNS:localhost" >/dev/null 2>&1
echo "generated e2e/key.pem and e2e/cert.pem"
