#!/usr/bin/env bash
# Syncs son-of-anton skills into the consumer repo and runs structural migrations.
#
# Works in two modes:
#   source repo  — run from the son-of-anton repo itself (.agents/skills/ exists at root)
#   consumer repo — run from a repo that has done `git subtree add` (.son-of-anton/ exists)
#
# Source-repo mode: skips migration logic; only relinks skills.
# Consumer-repo mode: runs apply_migrations() before symlinking.
#
# Naming convention:
#   The skill named "soa" is linked as "soa" (not "soa-soa") — it is the entry point.
#   All other skills are linked with the "soa-" prefix.
#
# Idempotent: removes stale soa-* symlinks before relinking so reruns don't leave ghosts.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SKILLS_DEST="$REPO_ROOT/.claude/skills"
SOA_TARGET_VERSION=1

if [ -d "$REPO_ROOT/.agents/skills" ] && [ ! -d "$REPO_ROOT/.son-of-anton" ]; then
  # Source repo: skills live at .agents/skills/ directly
  SKILLS_SRC="$REPO_ROOT/.agents/skills"
  LINK_TARGET_PREFIX="../../.agents/skills"
  IS_SOURCE_REPO=true
else
  # Consumer repo: skills live under .son-of-anton/
  SKILLS_SRC="$REPO_ROOT/.son-of-anton/.agents/skills"
  LINK_TARGET_PREFIX="../../.son-of-anton/.agents/skills"
  IS_SOURCE_REPO=false
fi

# ---------------------------------------------------------------------------
# Version helpers
# ---------------------------------------------------------------------------

read_soa_version() {
  local version_file="$REPO_ROOT/.soa-sync-version"
  if [ -f "$version_file" ]; then
    local raw
    raw="$(cat "$version_file")"
    if ! [[ "$raw" =~ ^[0-9]+$ ]]; then
      echo "soa-sync: .soa-sync-version contains non-integer value '$raw'; aborting" >&2
      exit 1
    fi
    echo "$raw"
  else
    echo "0"
  fi
}

write_soa_version() {
  echo "$1" > "$REPO_ROOT/.soa-sync-version"
}

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------

run_migration_1() {
  local old_base="$REPO_ROOT/.agents/delivery"
  local new_base="$REPO_ROOT/docs/product/delivery"

  for reviews_dir in "$old_base"/*/reviews; do
    if [ -d "$reviews_dir" ]; then
      local phase
      phase="$(basename "$(dirname "$reviews_dir")")"
      mkdir -p "$new_base/$phase"
      git -C "$REPO_ROOT" mv ".agents/delivery/$phase/reviews" "docs/product/delivery/$phase/reviews"
    fi
  done
}

apply_migrations() {
  local current_version
  current_version="$(read_soa_version)"

  if [ "$current_version" -ge "$SOA_TARGET_VERSION" ]; then
    return
  fi

  local v="$current_version"
  while [ "$v" -lt "$SOA_TARGET_VERSION" ]; do
    v=$((v + 1))
    "run_migration_$v"
  done

  write_soa_version "$SOA_TARGET_VERSION"
}

# ---------------------------------------------------------------------------
# Run migrations (consumer mode only)
# ---------------------------------------------------------------------------

if [ "$IS_SOURCE_REPO" = false ]; then
  apply_migrations
fi

# ---------------------------------------------------------------------------
# Skill symlinking (both modes)
# ---------------------------------------------------------------------------

mkdir -p "$SKILLS_DEST"

# Remove stale soa-* symlinks/directories and the bare "soa" entry before relinking.
for stale in "$SKILLS_DEST"/soa-* "$SKILLS_DEST/soa"; do
  if [ -L "$stale" ]; then
    rm "$stale"
  elif [ -d "$stale" ]; then
    rm -rf "$stale"
  fi
done

for skill_dir in "$SKILLS_SRC"/*/; do
  name="$(basename "$skill_dir")"
  target="$LINK_TARGET_PREFIX/$name"

  # "soa" is the entry point — link as "soa", not "soa-soa"
  if [ "$name" = "soa" ]; then
    link="$SKILLS_DEST/soa"
  else
    link="$SKILLS_DEST/soa-$name"
  fi

  ln -sf "$target" "$link"
  echo "  linked: .claude/skills/$(basename "$link")"
done

# Ensure repo-root symlinks required by the delivery orchestrator exist (consumer only).
if [ "$IS_SOURCE_REPO" = false ]; then
  for pair in ".agents:.son-of-anton/.agents" "tools:.son-of-anton/tools"; do
    link_name="${pair%%:*}"
    target="${pair##*:}"
    link="$REPO_ROOT/$link_name"
    if [ ! -e "$link" ] && [ ! -L "$link" ]; then
      ln -s "$target" "$link"
      echo "  linked: $link_name -> $target"
    elif [ "$link_name" = ".agents" ]; then
      echo "  kept: .agents already exists; Son-of-Anton skills remain under .son-of-anton/.agents"
    fi
  done
fi

echo "soa-sync: done"
