#!/usr/bin/env bash
# Point origin at the caller's token and drop any checkout credential that
# would otherwise stay in effect. checkout@v6 writes the token to an external
# file and loads it with includeIf, so unsetting the local extraheader is not
# enough: `git config --includes` still returns that Authorization header.
set -euo pipefail

token="${1:?push token is required}"
repository="${2:?repository is required}"

git config --local --unset-all "http.https://github.com/.extraheader" || true

keys="$(git config --local --name-only --get-regexp '^includeIf\.gitdir:' 2>/dev/null || true)"
if [[ -n "$keys" ]]; then
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    values="$(git config --local --get-all "$key" 2>/dev/null || true)"
    [[ -z "$values" ]] && continue
    credential_only=true
    while IFS= read -r value; do
      [[ -z "$value" ]] && continue
      base="${value##*/}"
      if [[ ! "$base" =~ ^git-credentials-[0-9a-fA-F-]+\.config$ ]]; then
        credential_only=false
      fi
    done <<< "$values"
    if [[ "$credential_only" != true ]]; then
      continue
    fi
    git config --local --unset-all "$key" || true
    while IFS= read -r value; do
      [[ -z "$value" ]] && continue
      if [[ -f "$value" ]]; then
        rm -f -- "$value"
      fi
    done <<< "$values"
  done <<< "$keys"
fi

git remote set-url origin "https://x-access-token:${token}@github.com/${repository}.git"
