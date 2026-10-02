#!/usr/bin/env bash
# Pulls main and rebuilds the chatbot on the VPS, then waits for /health.
#
# Intended to be the ONLY thing the CI SSH key can run. In ~/.ssh/authorized_keys
# on the VPS the CI public key is prefixed with a forced command:
#
#   command="bash /home/ubuntu/dino/deploy/deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... ci-deploy
#
# so even if the key leaks it can't open a shell. Can also be run by hand.

# Everything lives in a function and runs on the last line: `git pull` below
# rewrites this very file, and bash reads scripts incrementally.
main() {
  set -euo pipefail

  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  git fetch origin main
  git merge --ff-only origin/main

  cd deploy
  docker compose up -d --build

  # CHAT_DOMAIN is where Caddy serves the chatbot; poll it until it answers
  # (a fresh container loads the embedding model first, which takes a while).
  set -a
  . ./.env
  set +a
  for _ in $(seq 1 36); do
    if curl -fsS "https://${CHAT_DOMAIN}/health" >/dev/null; then
      echo "deploy ok: https://${CHAT_DOMAIN}/health is up"
      docker image prune -f >/dev/null
      return 0
    fi
    sleep 5
  done

  echo "deploy FAILED: /health did not come up within 3 minutes" >&2
  docker compose logs --tail 50 chatbot >&2
  return 1
}

main "$@"
