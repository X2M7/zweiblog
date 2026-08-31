#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly script_dir
repo_root="$(CDPATH= cd -- "${script_dir}/.." && pwd -P)"
readonly repo_root
readonly compose_file="${repo_root}/docker-compose/docker-compose.yml"
readonly smoke_image="${1:-zweiblog:smoke}"
readonly smoke_http_port="${ZWEIBLOG_SMOKE_HTTP_PORT:-18080}"
temp_parent="$(CDPATH= cd -- "${RUNNER_TEMP:-/tmp}" && pwd -P)"
readonly temp_parent
temp_root="$(mktemp -d "${temp_parent}/zweiblog-smoke.XXXXXX")"
readonly temp_root
readonly deployment_root="${temp_root}/deployment"
readonly compose_env_file="${temp_root}/compose.env"
: >"${compose_env_file}"

run_suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${BASHPID}"
run_suffix="$(printf '%s' "${run_suffix}" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-')"
[[ -n "${run_suffix}" ]] || run_suffix="local-${BASHPID}"
readonly project_name="zweiblog-smoke-${run_suffix}"

smoke_token=''

compose() {
  docker compose --env-file "${compose_env_file}" --project-name "${project_name}" \
    --file "${compose_file}" "$@"
}

redact() {
  if [[ -n "${smoke_token}" ]]; then
    sed "s/${smoke_token}/[REDACTED-SMOKE-TOKEN]/g"
  else
    cat
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if ((exit_code != 0)); then
    echo 'Docker smoke test failed; container state follows.' >&2
    compose ps >&2 || true
    compose logs --no-color --tail=250 2>&1 | redact >&2 || true
  fi

  compose down --volumes --remove-orphans --timeout 20 >/dev/null 2>&1 || true
  case "${temp_root}" in
    "${temp_parent}"/zweiblog-smoke.*)
      # MongoDB and ZweiBlog intentionally run with container-specific UIDs,
      # so their bind-mounted files might not be removable by the CI runner.
      # Reuse the already loaded smoke image as root to empty only the validated
      # disposable temporary directory, then remove the runner-owned wrapper.
      if [[ -d "${temp_root}" && ! -L "${temp_root}" ]]; then
        docker run --rm --user 0:0 --entrypoint node \
          --volume "${temp_root}:/cleanup-target" \
          "${smoke_image}" \
          -e "const fs=require('node:fs'),path=require('node:path');for(const name of fs.readdirSync('/cleanup-target'))fs.rmSync(path.join('/cleanup-target',name),{recursive:true,force:true})" \
          >/dev/null 2>&1 || true
      fi
      rm -rf -- "${temp_root}" || true
      ;;
    *) echo "Refusing to remove unexpected temporary path: ${temp_root}" >&2 ;;
  esac

  exit "${exit_code}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
  echo "ERROR: $*" >&2
  return 1
}

for command in awk cmp curl docker grep node openssl sed tr; do
  command -v "${command}" >/dev/null 2>&1 || fail "required command is unavailable: ${command}"
done
docker compose version >/dev/null
docker image inspect "${smoke_image}" >/dev/null 2>&1 || fail "image is not loaded: ${smoke_image}"

[[ "${smoke_http_port}" =~ ^[0-9]+$ ]] || fail 'ZWEIBLOG_SMOKE_HTTP_PORT must be numeric'
((smoke_http_port >= 1024 && smoke_http_port <= 65535)) ||
  fail 'ZWEIBLOG_SMOKE_HTTP_PORT must be between 1024 and 65535'
if curl --silent --show-error --output /dev/null --max-time 1 \
  "http://127.0.0.1:${smoke_http_port}/" 2>/dev/null; then
  fail "host port ${smoke_http_port} is already in use"
fi

mkdir -p \
  "${deployment_root}/secrets" \
  "${deployment_root}/data/mongo" \
  "${deployment_root}/data/static/customPage/legacy-smoke" \
  "${deployment_root}/log" \
  "${deployment_root}/caddy/config" \
  "${deployment_root}/caddy/data"

# These paths are disposable CI fixtures. World-writable directories avoid
# depending on a particular host uid while the containers retain their normal
# production uids (MongoDB 999 and ZweiBlog 10001).
chmod 0777 \
  "${deployment_root}/data/mongo" \
  "${deployment_root}/data/static" \
  "${deployment_root}/data/static/customPage" \
  "${deployment_root}/log" \
  "${deployment_root}/caddy" \
  "${deployment_root}/caddy/config" \
  "${deployment_root}/caddy/data"

# Older releases returned /static/customPage URLs. Create this compatibility
# fixture before containers take ownership of the bind-mounted directories.
chmod 0755 "${deployment_root}/data/static/customPage/legacy-smoke"
printf '<script>window.legacySmoke=true</script>' \
  >"${deployment_root}/data/static/customPage/legacy-smoke/index.html"
chmod 0644 "${deployment_root}/data/static/customPage/legacy-smoke/index.html"

root_password="$(openssl rand -hex 32)"
app_password="$(openssl rand -hex 32)"
printf '%s' "${root_password}" >"${deployment_root}/secrets/mongo-root-password"
printf '%s' "${app_password}" >"${deployment_root}/secrets/mongo-app-password"
printf 'mongodb://zweiblog:%s@mongo:27017/zweiBlog?authSource=admin' "${app_password}" \
  >"${deployment_root}/secrets/mongo-app-uri"
chmod 0444 "${deployment_root}"/secrets/*
unset root_password app_password

export COMPOSE_PROJECT_NAME="${project_name}"
export ZWEIBLOG_IMAGE="${smoke_image}"
export ZWEIBLOG_DATA_DIR="${deployment_root}"
export ZWEIBLOG_MONGO_VERSION='8.0'
export ZWEIBLOG_HTTP_BIND='127.0.0.1'
export ZWEIBLOG_HTTP_PORT="${smoke_http_port}"
export ZWEIBLOG_WEB_NETWORK="${project_name}-web"
export TZ='UTC'
export ACME_EMAIL=''
export ZWEI_BLOG_CADDY_HTTPS='off'
export ZWEI_BLOG_TRUST_PROXY='loopback'
export ZWEI_BLOG_CADDY_TRUSTED_PROXIES=''
export ZWEI_BLOG_ENABLE_SWAGGER='false'
export ZWEI_BLOG_PIPELINE_ALLOW_UNSAFE_EXECUTION='false'
export ZWEI_BLOG_PICGO_ALLOW_UNSAFE_PLUGIN_INSTALL='false'
export ZWEI_BLOG_ALLOW_TRUSTED_CUSTOM_CODE='false'

compose config --quiet
compose up --detach --wait --wait-timeout 300

app_container="$(compose ps --quiet zweiblog)"
[[ -n "${app_container}" ]] || fail 'Compose did not create the zweiblog container'
[[ "$(docker inspect --format '{{.State.Health.Status}}' "${app_container}")" == 'healthy' ]] ||
  fail 'zweiblog container did not reach healthy state'

# Verify the three in-container listeners, then prove Next is loopback-only. A
# Docker HOSTNAME regression would make 3001 reachable on the container IP and
# leave bundled Caddy unable to connect to 127.0.0.1:3001.
docker exec --interactive "${app_container}" node <<'NODE'
const os = require('node:os');

async function fetchHealthy(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  await response.arrayBuffer();
  if (response.status >= 500) throw new Error(`${url} returned ${response.status}`);
}

(async () => {
  await fetchHealthy('http://127.0.0.1:3000/api/public/category');
  await fetchHealthy('http://127.0.0.1:3001/');
  await fetchHealthy('http://127.0.0.1/');

  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((address) => address && address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
  if (addresses.length === 0) throw new Error('no non-loopback IPv4 address found');

  for (const address of addresses) {
    let reachable = false;
    try {
      const response = await fetch(`http://${address}:3001/`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(2_000),
      });
      await response.arrayBuffer();
      reachable = true;
    } catch {}
    if (reachable) throw new Error(`Next unexpectedly accepts traffic on ${address}:3001`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE

next_log_found='false'
for _ in {1..15}; do
  app_logs="$(compose logs --no-color zweiblog 2>&1)"
  if grep -Fq '127.0.0.1:3001' <<<"${app_logs}"; then
    next_log_found='true'
    break
  fi
  sleep 2
done
[[ "${next_log_found}" == 'true' ]] || fail 'Next startup log did not report 127.0.0.1:3001'

readonly external_base="http://127.0.0.1:${smoke_http_port}"
root_status="$(curl --silent --show-error --output "${temp_root}/root.html" \
  --write-out '%{http_code}' --max-time 20 "${external_base}/")"
[[ "${root_status}" =~ ^[0-9]{3}$ ]] && ((root_status >= 200 && root_status < 500)) ||
  fail "bundled Caddy root route returned ${root_status}"

curl --fail --silent --show-error --max-time 20 \
  "${external_base}/admin/" >"${temp_root}/admin.html"
expected_admin_hash="$(docker exec "${app_container}" node -e \
  "const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('/app/admin/index.html')).digest('hex'))")"
actual_admin_hash="$(openssl dgst -sha256 "${temp_root}/admin.html" | awk '{print $NF}')"
[[ "${actual_admin_hash}" == "${expected_admin_hash}" ]] ||
  fail 'the external /admin/ response did not come from the bundled admin application'

route_marker="smoke_route_${run_suffix}"
docker exec "${app_container}" node -e \
  "fetch('http://127.0.0.1:3000/api/public/category?marker=${route_marker}').then(async r=>{if(r.status>=500)throw new Error(String(r.status));process.stdout.write(await r.text())}).catch(e=>{console.error(e);process.exit(1)})" \
  >"${temp_root}/api-direct.json"
curl --fail --silent --show-error --max-time 20 \
  "${external_base}/api/public/category?marker=${route_marker}" >"${temp_root}/api-caddy.json"
cmp --silent "${temp_root}/api-direct.json" "${temp_root}/api-caddy.json" ||
  fail 'the external API response differs from the direct port 3000 response'

# Exercise the unauthenticated first-run upload endpoint with a real PNG. This
# covers multipart parsing, image validation/conversion, Mongo metadata, the
# local static volume, and Caddy's /static route without creating an admin.
printf '%s' \
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' |
  openssl base64 -d -A >"${temp_root}/smoke.png"
curl --fail --silent --show-error --max-time 30 \
  --form "file=@${temp_root}/smoke.png;type=image/png;filename=smoke.png" \
  "${external_base}/api/admin/init/upload" >"${temp_root}/upload.json"
upload_path="$(node -e \
  "const fs=require('node:fs');const value=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const src=value?.data?.src;if(value?.statusCode!==200||typeof src!=='string')process.exit(1);process.stdout.write(src)" \
  "${temp_root}/upload.json")"
[[ "${upload_path}" == /static/img/* && "${upload_path}" != *..* ]] ||
  fail 'the first-run PNG upload did not return a safe local static path'
curl --fail --silent --show-error --max-time 20 \
  "${external_base}${upload_path}" >"${temp_root}/uploaded-image"
stored_image="${deployment_root}/data/static/${upload_path#/static/}"
[[ -s "${stored_image}" ]] || fail 'the uploaded image was not persisted to the local volume'
cmp --silent "${stored_image}" "${temp_root}/uploaded-image" ||
  fail 'Caddy did not return the uploaded image from the local static volume'

# Older releases returned /static/customPage URLs. They must remain usable via
# a redirect through /c, never through the unsandboxed generic static mount.
legacy_headers="${temp_root}/legacy-custom-page.headers"
legacy_status="$(curl --silent --show-error --output /dev/null \
  --dump-header "${legacy_headers}" --write-out '%{http_code}' --max-time 20 \
  "${external_base}/static/customPage/legacy-smoke/index.html")"
[[ "${legacy_status}" == '308' ]] ||
  fail "legacy custom-page static route returned ${legacy_status} instead of 308"
grep -Eiq '^location: /c/legacy-smoke/index\.html\r?$' "${legacy_headers}" ||
  fail 'legacy custom-page static route did not redirect through /c'
grep -Eiq '^access-control-allow-origin: \*\r?$' "${legacy_headers}" ||
  fail 'legacy custom-page redirect is missing isolated-page CORS'

smoke_token="$(openssl rand -hex 32)"
access_marker="smoke_access_${run_suffix}"
curl --fail --silent --show-error --output /dev/null --max-time 20 \
  --header "Authorization: Bearer ${smoke_token}" \
  --header "Token: ${smoke_token}" \
  "${external_base}/api/public/category?marker=${access_marker}"

readonly access_log="${deployment_root}/log/zweiblog-access.log"
access_entry_found='false'
for _ in {1..20}; do
  if [[ -f "${access_log}" ]] && grep -Fq "${access_marker}" "${access_log}"; then
    access_entry_found='true'
    break
  fi
  sleep 1
done
[[ "${access_entry_found}" == 'true' ]] || fail 'Caddy did not write the marked access-log entry'
if grep -Fq "${smoke_token}" "${access_log}"; then
  fail 'Caddy access log leaked a sensitive request token'
fi

echo 'Docker smoke test passed: health, listeners, Caddy routes, and access-log redaction.'
