#!/bin/sh
# PostgreSQL 客户端 PATH 兜底（POSIX sh 兼容，可被 bash / sh 直接 source）。
#
# 背景：release 流程的备份（pg_dump）与影子库重置（psql）依赖 PostgreSQL 客户端，
# 但本机常常没把它们放进 PATH —— 典型是 macOS 用 Postgres.app 安装，
# 二进制藏在应用包内，导致 `pnpm run release:execute` 因找不到 pg_dump 直接失败。
#
# 用法：. ./scripts/pg-env.sh
# 可选：PG_ENV_VERBOSE=true 时打印生效的候选目录。

for pg_candidate in \
  /Applications/Postgres.app/Contents/Versions/latest/bin \
  /Applications/Postgres.app/Contents/Versions/*/bin \
  /opt/homebrew/opt/libpq/bin \
  /opt/homebrew/bin \
  /usr/local/opt/libpq/bin \
  /usr/local/bin \
  /usr/lib/postgresql/*/bin
do
  [ -d "$pg_candidate" ] || continue
  [ -x "$pg_candidate/psql" ] || continue

  case ":$PATH:" in
    *":$pg_candidate:"*) ;;
    *)
      PATH="$pg_candidate:$PATH"
      if [ "${PG_ENV_VERBOSE:-false}" = "true" ]; then
        echo "[pg-env] 已加入 PATH: $pg_candidate"
      fi
      ;;
  esac
done

export PATH

# 仍然找不到时给出可执行的提示，而不是让上层命令莫名其妙地失败
if ! command -v psql >/dev/null 2>&1; then
  echo "[pg-env] 警告：仍未找到 psql/pg_dump，请手工安装 PostgreSQL 客户端" >&2
  echo "         macOS 建议：brew install libpq，或安装 Postgres.app" >&2
fi
