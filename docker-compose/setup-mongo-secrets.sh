#!/usr/bin/env sh

set -eu
umask 077

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
install_root=${1:-$script_dir}

case "$install_root" in
  '' | /)
    echo "Refusing unsafe installation root: $install_root" >&2
    exit 1
    ;;
esac

if [ -L "$install_root" ]; then
  echo "Refusing symbolic-link installation root: $install_root" >&2
  exit 1
fi

mkdir -p -- "$install_root"
install_root=$(CDPATH= cd -- "$install_root" && pwd -P)
case "$install_root" in
  '' | /)
    echo "Refusing unsafe resolved installation root: $install_root" >&2
    exit 1
    ;;
esac
secret_dir="$install_root/secrets"
data_dir="$install_root/data"
mongo_data_dir="$install_root/data/mongo"
static_dir="$install_root/data/static"
log_dir="$install_root/log"
caddy_config_dir="$install_root/caddy/config"
caddy_data_dir="$install_root/caddy/data"
caddy_dir="$install_root/caddy"
root_password_file="$secret_dir/mongo-root-password"
app_password_file="$secret_dir/mongo-app-password"
app_uri_file="$secret_dir/mongo-app-uri"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script as root so secret files can be assigned to the container users." >&2
  exit 1
fi

for file in "$root_password_file" "$app_password_file" "$app_uri_file"; do
  if [ -L "$file" ]; then
    echo "Refusing symbolic-link secret path: $file" >&2
    exit 1
  fi
done

for directory in \
  "$secret_dir" \
  "$data_dir" \
  "$mongo_data_dir" \
  "$static_dir" \
  "$log_dir" \
  "$caddy_dir" \
  "$caddy_config_dir" \
  "$caddy_data_dir"; do
  if [ -L "$directory" ]; then
    echo "Refusing symbolic-link deployment path: $directory" >&2
    exit 1
  fi
done

mkdir -p -- "$secret_dir" "$mongo_data_dir" "$static_dir" "$log_dir" "$caddy_config_dir" "$caddy_data_dir"

# The application image runs as uid/gid 10001. Preparing these bind mounts
# here avoids Docker creating root-owned directories on first startup.
chown -R 10001:10001 "$static_dir" "$log_dir" "$caddy_dir"
chmod 0750 "$static_dir" "$log_dir" "$caddy_dir" "$caddy_config_dir" "$caddy_data_dir"

existing=0
for file in "$root_password_file" "$app_password_file" "$app_uri_file"; do
  [ -e "$file" ] && existing=$((existing + 1))
done

if [ "$existing" -ne 0 ] && [ "$existing" -ne 3 ]; then
  echo "MongoDB secret set is incomplete; refusing to replace or regenerate it." >&2
  exit 1
fi

if [ "$existing" -eq 0 ] && [ -d "$mongo_data_dir" ] && [ -n "$(find "$mongo_data_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
  echo "Existing MongoDB data detected at $mongo_data_dir." >&2
  echo "Do not add authentication or change its major version in place; run migrate-mongo.sh." >&2
  exit 1
fi

random_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    od -An -N 32 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

if [ "$existing" -eq 0 ]; then
  mkdir -p -- "$secret_dir"
  chmod 0700 "$secret_dir"

  root_password=$(random_hex)
  app_password=$(random_hex)

  printf '%s' "$root_password" >"$root_password_file"
  printf '%s' "$app_password" >"$app_password_file"
  printf 'mongodb://zweiblog:%s@mongo:27017/zweiBlog?authSource=admin' "$app_password" >"$app_uri_file"
fi

root_password=$(cat "$root_password_file")
app_password=$(cat "$app_password_file")
app_uri=$(cat "$app_uri_file")

if ! printf '%s\n' "$root_password" | grep -Eq '^[0-9a-f]{64}$' ||
  ! printf '%s\n' "$app_password" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "MongoDB password files have an invalid format." >&2
  exit 1
fi

expected_uri="mongodb://zweiblog:${app_password}@mongo:27017/zweiBlog?authSource=admin"
if [ "$app_uri" != "$expected_uri" ]; then
  echo "MongoDB application URI does not match the application password." >&2
  exit 1
fi

# The official Mongo image runs as uid 999 after its entrypoint. ZweiBlog runs
# as uid 10001. File-backed Compose secrets retain source-file ownership.
chown 999:999 "$root_password_file" "$app_password_file"
chown 10001:10001 "$app_uri_file"
chmod 0400 "$root_password_file" "$app_password_file" "$app_uri_file"

echo "MongoDB credentials are ready in $secret_dir (existing values were not rotated)."
