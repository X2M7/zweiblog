#!/bin/bash

#========================================================
#   System Required: CentOS 7+ / Debian 8+ / Ubuntu 16+ /
#     Arch 未测试
#   Description: zweiblog 安装脚本
#   GitHub: https://github.com/X2M7/zweiblog
#========================================================

ZWEIBLOG_BASE_PATH="/var/zweiblog"
ZWEIBLOG_DATA_PATH="${ZWEIBLOG_BASE_PATH}/data"
ZWEIBLOG_DATA_PATH_RAW="\/var\/zweiblog\/data"
ZWEIBLOG_SCRIPT_VERSION="v0.3.4"

ZWEIBLOG_RELEASE_BASE_URL="${ZWEIBLOG_RELEASE_BASE_URL:-https://raw.githubusercontent.com/X2M7/zweiblog/main}"
ZWEIBLOG_RELEASE_BASE_URL="${ZWEIBLOG_RELEASE_BASE_URL%/}"
ZWEIBLOG_ASSET_BASE_URL="${ZWEIBLOG_ASSET_BASE_URL:-${ZWEIBLOG_RELEASE_BASE_URL}/docker-compose}"
ZWEIBLOG_ASSET_BASE_URL="${ZWEIBLOG_ASSET_BASE_URL%/}"
COMPOSE_URL="${ZWEIBLOG_ASSET_BASE_URL:+${ZWEIBLOG_ASSET_BASE_URL}/docker-compose-template.yml}"
MONGO_INIT_URL="${ZWEIBLOG_ASSET_BASE_URL:+${ZWEIBLOG_ASSET_BASE_URL}/mongo-init.js}"
MONGO_HEALTHCHECK_URL="${ZWEIBLOG_ASSET_BASE_URL:+${ZWEIBLOG_ASSET_BASE_URL}/mongo-healthcheck.js}"
MONGO_SECRET_SETUP_URL="${ZWEIBLOG_ASSET_BASE_URL:+${ZWEIBLOG_ASSET_BASE_URL}/setup-mongo-secrets.sh}"
MONGO_MIGRATION_URL="${ZWEIBLOG_MONGO_MIGRATION_URL:-${ZWEIBLOG_RELEASE_BASE_URL}/scripts/migrate-mongo.sh}"
SCRIPT_URL="${ZWEIBLOG_INSTALLER_URL:-${ZWEIBLOG_RELEASE_BASE_URL}/scripts/zweiblog.sh}"
GITHUB_URL="dn-dao-github-mirror.daocloud.io"
Get_Docker_URL="${ZWEIBLOG_DOCKER_INSTALL_HOST:-get.docker.com}"
Get_Docker_Argu=" -s docker --mirror Aliyun"
ZWEIBLOG_IMAGE="${ZWEIBLOG_IMAGE:-ghcr.io/x2m7/zweiblog:latest}"
Docker_IMG="${ZWEIBLOG_IMAGE}"

red='\033[0;31m'
green='\033[0;32m'
yellow='\033[0;33m'
plain='\033[0m'
export PATH=$PATH:/usr/local/bin

os_arch=""

require_asset_base() {
  if [[ -z "${ZWEIBLOG_ASSET_BASE_URL}" ]]; then
    echo -e "${red}No ZweiBlog distribution URL is configured.${plain}"
    echo "Set ZWEIBLOG_ASSET_BASE_URL to a location containing this fork's synchronized deployment assets."
    echo "For this local checkout, use docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build in the docker-compose directory."
    return 1
  fi
}

require_distribution_assets() {
  require_asset_base || return 1
  if [[ -z "${ZWEIBLOG_IMAGE}" ]]; then
    echo -e "${red}No published ZweiBlog image is configured.${plain}"
    echo "Set ZWEIBLOG_IMAGE to the image built from this fork."
    return 1
  fi
}

existing_installation_uses_mongo_8() {
  local compose_file=''
  local candidate=''
  local secret_file=''

  for candidate in \
    "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml" \
    "${ZWEIBLOG_BASE_PATH}/docker-compose.yml"; do
    if [ -f "${candidate}" ]; then
      compose_file="${candidate}"
      break
    fi
  done
  [ -n "${compose_file}" ] || return 1

  # Fail closed unless the existing deployment explicitly names MongoDB 8.
  # Removing quotes first keeps this check compatible with generated YAML.
  if ! tr -d "\"'" <"${compose_file}" |
    grep -Eq '^[[:space:]]*image:[[:space:]]*mongo:(8([.-]|[[:space:]]|$)|\$\{ZWEIBLOG_MONGO_VERSION:-8([.]0)?\})'; then
    return 1
  fi

  for secret_file in mongo-root-password mongo-app-password mongo-app-uri; do
    [ -s "${ZWEIBLOG_DATA_PATH}/secrets/${secret_file}" ] || return 1
  done
}


# Use the same persistent image pin for start, restart and rollback.
zweiblog_compose() {
  local compose_file
  local -a compose_args=()
  for compose_file in docker-compose.yaml docker-compose.yml; do
    if [[ -f "${ZWEIBLOG_BASE_PATH}/${compose_file}" ]]; then
      compose_args=(-f "${ZWEIBLOG_BASE_PATH}/${compose_file}")
      break
    fi
  done
  [[ ${#compose_args[@]} -gt 0 ]] || { echo "找不到编排文件" >&2; return 1; }
  for compose_file in docker-compose.override.yaml docker-compose.override.yml; do
    if [[ -f "${ZWEIBLOG_BASE_PATH}/${compose_file}" ]]; then
      compose_args+=(-f "${ZWEIBLOG_BASE_PATH}/${compose_file}")
      break
    fi
  done
  if [[ "${ZWEIBLOG_IGNORE_IMAGE_PIN:-0}" != 1 && -f "${ZWEIBLOG_BASE_PATH}/.zweiblog-image.yaml" ]]; then
    compose_args+=(-f "${ZWEIBLOG_BASE_PATH}/.zweiblog-image.yaml")
  fi
  (cd -- "${ZWEIBLOG_BASE_PATH}" && docker-compose "${compose_args[@]}" "$@")
}

write_image_pin() {
  local destination="$1" image_id="$2" temporary_file
  [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  temporary_file=$(umask 077; mktemp "${ZWEIBLOG_BASE_PATH}/.image-pin.XXXXXX") || return 1
  printf 'services:\n  zweiblog:\n    image: %s\n' "$image_id" > "$temporary_file" || {
    rm -f -- "$temporary_file"; return 1;
  }
  mv -f -- "$temporary_file" "$destination"
}

wait_for_zweiblog() {
  local container_id state deadline=$((SECONDS + 300))
  while (( SECONDS < deadline )); do
    container_id=$(zweiblog_compose ps -q zweiblog) || return 1
    [[ -n "$container_id" ]] || return 1
    state=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}}' "$container_id") || return 1
    [[ "$state" == 'running healthy' ]] && return 0
    [[ "$state" == 'running starting' ]] || { echo "服务未通过健康检查：$state" >&2; return 1; }
    sleep 5
  done
  echo "等待服务健康检查超时" >&2
  return 1
}

pre_check() {
  # check root before touching anything under /var
  [[ $EUID -ne 0 ]] && echo -e "${red}错误: ${plain} 必须使用root用户运行此脚本！\n" && exit 1

  if ! command -v curl >/dev/null 2>&1; then
    echo "未找到 curl 命令"
    exit 1
  fi

  ## os_arch
  if [[ $(uname -m | grep 'x86_64') != "" ]]; then
    os_arch="amd64"
  elif [[ $(uname -m | grep 'i386\|i686') != "" ]]; then
    echo "不支持 386 平台"
    exit 1
  elif [[ $(uname -m | grep 'aarch64\|armv8b\|armv8l') != "" ]]; then
    os_arch="arm64"
  elif [[ $(uname -m | grep 'arm') != "" ]]; then
    echo "不支持 arm 平台，目前只支持 arm64、amd64"
    exit 1
  elif [[ $(uname -m | grep 's390x') != "" ]]; then
    echo "不支持 s390x 平台，目前只支持 arm64、amd64"
    exit 1
  elif [[ $(uname -m | grep 'riscv64') != "" ]]; then
    echo "不支持 riscv64 平台，目前只支持 arm64、amd64"
    exit 1
  fi

      ## China_IP
    if [[ -z "${CN}" ]]; then
        if [[ $(curl -m 10 -s https://ipapi.co/json | grep 'China') != "" ]]; then
            echo "根据ipapi.co提供的信息，当前IP可能在中国"
            read -e -r -p "是否选用中国镜像完成安装? [Y/n] " input
            case $input in
                [yY][eE][sS] | [yY])
                    echo "使用中国镜像"
                    CN=true
                ;;

                [nN][oO] | [nN])
                    echo "不使用中国镜像"
                ;;
                *)
                    echo "使用中国镜像"
                    CN=true
                ;;
            esac
        fi
    fi

    if [[ -z "${CN}" ]]; then
        GITHUB_URL="dn-dao-github-mirror.daocloud.io"
        Get_Docker_Argu=" "
    else
        echo "使用中国镜像"
        GITHUB_URL="github.com"
        Get_Docker_Argu=" -s docker --mirror Aliyun"
    fi

}

confirm() {
  if [[ $# > 1 ]]; then
    echo && read -e -p "$1 [默认$2]: " temp
    if [[ x"${temp}" == x"" ]]; then
      temp=$2
    fi
  else
    read -e -p "$1 [y/n]: " temp
  fi
  if [[ x"${temp}" == x"y" || x"${temp}" == x"Y" ]]; then
    return 0
  else
    return 1
  fi
}

update_script() (
  require_asset_base || return 1
  umask 077
  local temporary_dir artifact installed_tmp='' owner mode new_version
  temporary_dir=$(mktemp -d /tmp/zweiblog-update.XXXXXX) || return 1
  trap 'rm -rf -- "$temporary_dir"; [[ -z "$installed_tmp" ]] || rm -f -- "$installed_tmp"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  artifact="${temporary_dir}/zweiblog.sh"
  echo "> 更新脚本"
  if ! curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 10 --max-time 120 "$SCRIPT_URL" -o "$artifact"; then
    echo "脚本下载失败，保留当前脚本。" >&2
    return 1
  fi
  if [[ ! -s "$artifact" ]] || ! bash -n "$artifact"; then
    echo "下载内容不是有效脚本，已中止更新。" >&2
    return 1
  fi
  new_version=$(sed -n 's/^ZWEIBLOG_SCRIPT_VERSION="\([A-Za-z0-9._-]*\)"$/\1/p' "$artifact")
  [[ -n "$new_version" && "$new_version" != *$'\n'* ]] || return 1
  # Never install or execute a root script from the caller's working directory.
  [[ ! -L "$ZWEIBLOG_BASE_PATH" ]] || return 1
  mkdir -p -- "$ZWEIBLOG_BASE_PATH" || return 1
  owner=$(stat -c %u -- "$ZWEIBLOG_BASE_PATH") || return 1
  mode=$(stat -c %a -- "$ZWEIBLOG_BASE_PATH") || return 1
  if [[ "$owner" != 0 ]] || (( (8#$mode & 0022) != 0 )); then
    echo "安装目录必须由 root 拥有且不可被其他用户写入。" >&2
    return 1
  fi
  installed_tmp=$(mktemp "${ZWEIBLOG_BASE_PATH}/.zweiblog-script.XXXXXX") || return 1
  install -m 0700 -- "$artifact" "$installed_tmp" || return 1
  cmp -s -- "$artifact" "$installed_tmp" || return 1
  mv -f -- "$installed_tmp" "${ZWEIBLOG_BASE_PATH}/zweiblog.sh" || return 1
  installed_tmp=''
  echo "已安装版本 ${new_version}，正在运行同一份已校验的下载文件。"
  bash "$artifact"
)

before_show_menu() {
  echo && echo -n -e "${yellow}* 按回车返回主菜单 *${plain}" && read temp
  show_menu
}

install_base() {
  (command -v git >/dev/null 2>&1 && command -v curl >/dev/null 2>&1 && command -v wget >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1 && command -v getenforce >/dev/null 2>&1) ||
    (install_soft curl wget git unzip)
}

install_soft() {
  # Arch官方库不包含selinux等组件
  (command -v yum >/dev/null 2>&1 && yum makecache && yum install $* selinux-policy -y) ||
    (command -v apt >/dev/null 2>&1 && apt update && apt install $* selinux-utils -y) ||
    (command -v pacman >/dev/null 2>&1 && pacman -Syu $*) ||
    (command -v apt-get >/dev/null 2>&1 && apt-get update && apt-get install $* selinux-utils -y)
}

check_mongo8_cpu() {
  case "$(uname -m)" in
  x86_64 | amd64)
    if ! grep -Eq '^flags.* avx( |$)' /proc/cpuinfo; then
      echo -e "${red}MongoDB 8.0 requires AVX on x86_64. Use a compatible host or an external supported MongoDB service.${plain}"
      return 1
    fi
    ;;
  aarch64 | arm64)
    if ! grep -Eq '^Features.* (fphp|dcpop|sha3|sm3|sm4|asimddp|sha512|sve)( |$)' /proc/cpuinfo; then
      echo -e "${red}MongoDB 8.0 requires ARMv8.2-A or newer. Use a compatible host or an external supported MongoDB service.${plain}"
      return 1
    fi
    ;;
  *)
    echo -e "${red}MongoDB 8.0 is not supported on architecture $(uname -m).${plain}"
    return 1
    ;;
  esac
}

install_zweiblog() {
  require_distribution_assets || return 1
  install_base
  check_mongo8_cpu || exit 1

  echo -e "> 安装 ZweiBlog"

  # ZweiBlog 数据文件夹
  if [ ! -d "${ZWEIBLOG_DATA_PATH}" ]; then
    mkdir -p $ZWEIBLOG_DATA_PATH
  else
    echo "您可能已经安装过 ZweiBlog，重复安装可能会引发问题，请注意备份。"
    read -e -r -p "是否退出安装? [Y/n] " input
    case $input in
    [yY][eE][sS] | [yY])
      echo "退出安装"
      exit 0
      ;;
    [nN][oO] | [nN])
      echo "继续安装"
      ;;
    *)
      echo "退出安装"
      exit 0
      ;;
    esac
  fi

  chmod 0750 "$ZWEIBLOG_DATA_PATH"

  command -v docker >/dev/null 2>&1
  if [[ $? != 0 ]]; then
    echo -e "正在安装 Docker"
    bash <(curl -sL https://${Get_Docker_URL}) ${Get_Docker_Argu} >/dev/null 2>&1
    systemctl enable docker.service
    systemctl start docker.service
    command -v docker >/dev/null 2>&1
    if [[ $? != 0 ]]; then
      echo -e "${red}Docker 安装失败${plain}"
      exit 0
    fi
    echo -e "${green}Docker${plain} 安装成功"
  fi


  if ! command -v docker-compose >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
      echo -e "未找到 docker-compose，使用 docker compose 创建兼容命令"
      printf '%s\n' '#!/bin/sh' 'exec docker compose "$@"' > /usr/local/bin/docker-compose
      chmod 0755 /usr/local/bin/docker-compose
      echo -e "${green}Docker Compose${plain} 兼容命令创建成功"
    else
      echo -e "${red}未找到 Docker Compose v2，请先完成安装${plain}"
      return 1
    fi
  fi

  config 0

  if [[ $# == 0 ]]; then
    before_show_menu
  fi
}

selinux() {
  #判断当前的状态
  getenforce | grep '[Ee]nfor'
  if [ $? -eq 0 ]; then
    echo -e "SELinux是开启状态，正在关闭！"
    setenforce 0 &>/dev/null
    find_key="SELINUX="
    sed -ri "/^$find_key/c${find_key}disabled" /etc/selinux/config
  fi
}

config() {
  require_distribution_assets || return 1
  if [[ ! -d "${ZWEIBLOG_BASE_PATH}" || ! -d "${ZWEIBLOG_DATA_PATH}" ]]; then
    echo -e "${red}未检测到完整的 ZweiBlog 安装目录，请先执行安装。${plain}"
    return 1
  fi
  existing_mongo_path="${ZWEIBLOG_DATA_PATH}/data/mongo"
  if [ -d "$existing_mongo_path" ] &&
    [ -n "$(find "$existing_mongo_path" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]; then
    if existing_installation_uses_mongo_8; then
      echo -e "${green}Existing MongoDB 8 deployment and complete secret files detected; configuration may be updated safely.${plain}"
    else
      echo -e "${red}Existing MongoDB data was detected at $existing_mongo_path, but MongoDB 8 compatibility could not be confirmed.${plain}"
      echo "The MongoDB 8.0 template will not be written over an old or ambiguous data directory."
      migration_tmp="${ZWEIBLOG_BASE_PATH}/.migrate-mongo.sh.tmp"
      if wget -t 2 -T 10 -O "$migration_tmp" "$MONGO_MIGRATION_URL" >/dev/null 2>&1; then
        mv -f -- "$migration_tmp" "${ZWEIBLOG_BASE_PATH}/migrate-mongo.sh"
        chmod 0755 "${ZWEIBLOG_BASE_PATH}/migrate-mongo.sh"
        echo "Run ${ZWEIBLOG_BASE_PATH}/migrate-mongo.sh first and review its MIGRATION_REPORT.txt."
      else
        rm -f -- "$migration_tmp"
        echo "Download the migration helper from $MONGO_MIGRATION_URL before changing this installation."
      fi
      return 1
    fi
  fi

  echo -e "> 修改配置"

  echo -e "正在下载编排文件"
  rm -f -- "${ZWEIBLOG_BASE_PATH}/docker-compose-template.yaml" >/dev/null 2>&1
  wget -t 2 -T 10 -O "${ZWEIBLOG_BASE_PATH}/docker-compose-template.yaml" "${COMPOSE_URL}" >/dev/null 2>&1
  if [[ $? != 0 ]]; then
    echo -e "${red}下载脚本失败，请检查本机能否连接 ${COMPOSE_URL}${plain}"
    return 0
  fi

  mkdir -p "${ZWEIBLOG_DATA_PATH}"
  for asset in \
    "mongo-init.js|${MONGO_INIT_URL}" \
    "mongo-healthcheck.js|${MONGO_HEALTHCHECK_URL}" \
    "setup-mongo-secrets.sh|${MONGO_SECRET_SETUP_URL}"; do
    asset_name="${asset%%|*}"
    asset_url="${asset#*|}"
    asset_tmp="${ZWEIBLOG_DATA_PATH}/.${asset_name}.tmp"
    if ! wget -t 2 -T 10 -O "$asset_tmp" "$asset_url" >/dev/null 2>&1; then
      rm -f -- "$asset_tmp"
      echo -e "${red}Failed to download required MongoDB asset: $asset_url${plain}"
      return 1
    fi
    mv -f -- "$asset_tmp" "${ZWEIBLOG_DATA_PATH}/${asset_name}"
  done
  chmod 0444 "${ZWEIBLOG_DATA_PATH}/mongo-init.js" "${ZWEIBLOG_DATA_PATH}/mongo-healthcheck.js"
  chmod 0755 "${ZWEIBLOG_DATA_PATH}/setup-mongo-secrets.sh"

  migration_tmp="${ZWEIBLOG_BASE_PATH}/.migrate-mongo.sh.tmp"
  if wget -t 2 -T 10 -O "$migration_tmp" "$MONGO_MIGRATION_URL" >/dev/null 2>&1; then
    mv -f -- "$migration_tmp" "${ZWEIBLOG_BASE_PATH}/migrate-mongo.sh"
    chmod 0755 "${ZWEIBLOG_BASE_PATH}/migrate-mongo.sh"
  else
    rm -f -- "$migration_tmp"
    echo -e "${yellow}MongoDB migration helper download failed; new-install setup can continue.${plain}"
  fi

  # read -ep "请输入您想要安装的版本，默认不填为最新：" zweiblog_version &&
  zweiblog_caddy_https="off"
  zweiblog_email=""
  zweiblog_http_bind="127.0.0.1"
  zweiblog_http_port=""
  zweiblog_https_port=""
  zweiblog_https_mapping="# HTTPS is managed by the external reverse proxy."

  echo "部署模式："
  echo "  1. 外部 Nginx/Caddy 反向代理（推荐，只提供本机 HTTP 上游）"
  echo "  2. 直接使用 ZweiBlog 内置 Caddy 申请 HTTPS 证书"
  read -ep "请选择部署模式（默认为 1）：" zweiblog_deploy_mode
  if [[ -z "${zweiblog_deploy_mode}" || "${zweiblog_deploy_mode}" == "1" ]]; then
    read -ep "请输入本机 HTTP 上游端口（默认为 8080）：" zweiblog_http_port
    [[ -z "${zweiblog_http_port}" ]] && zweiblog_http_port=8080
  elif [[ "${zweiblog_deploy_mode}" == "2" ]]; then
    zweiblog_caddy_https="on-demand"
    zweiblog_http_bind="0.0.0.0"
    read -ep "请输入 ACME 邮箱：" zweiblog_email
    read -ep "请输入 HTTP 端口（默认为 80）：" zweiblog_http_port
    read -ep "请输入 HTTPS 端口（默认为 443）：" zweiblog_https_port
    [[ -z "${zweiblog_http_port}" ]] && zweiblog_http_port=80
    [[ -z "${zweiblog_https_port}" ]] && zweiblog_https_port=443
    zweiblog_https_mapping="- '0.0.0.0:${zweiblog_https_port}:443'"
  else
    echo -e "${red}部署模式只能选择 1 或 2${plain}"
    return 1
  fi
  # echo "接下来您需要输入的域名对应着编排文件中的 ZWEI_BLOG_ALLOW_DOMAINS 变量（不含协议、不可包含通配符、多个域名通过英文逗号分隔）" &&
  # echo "如果用了 cdn 或图床，需要把图床或 cdn 的域名也加上" &&
  # read -ep "请输入您最终要绑定的域名（小写）:" zweiblog_domains

  if [[ "${zweiblog_caddy_https}" == "on-demand" &&
    ! "${zweiblog_email}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    echo -e "${red}邮箱格式无效${plain}"
    return 1
  fi
  if [[ ! "${zweiblog_http_port}" =~ ^[0-9]+$ ]] ||
    [[ "${zweiblog_caddy_https}" == "on-demand" &&
      ! "${zweiblog_https_port}" =~ ^[0-9]+$ ]]; then
    echo -e "${red}端口必须是 1-65535 之间的整数${plain}"
    return 1
  fi
  if ((zweiblog_http_port < 1 || zweiblog_http_port > 65535)) ||
    [[ "${zweiblog_caddy_https}" == "on-demand" &&
      (zweiblog_https_port -lt 1 || zweiblog_https_port -gt 65535) ]]; then
    echo -e "${red}端口必须是 1-65535 之间的整数${plain}"
    return 1
  fi
  # if [[ -z "${zweiblog_version}" ]]; then
  #   zweiblog_version="latest"
  # fi

  rm -f -- "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml" >/dev/null 2>&1
  cp "${ZWEIBLOG_BASE_PATH}/docker-compose-template.yaml" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml" >/dev/null 2>&1
  sed -i "s/zweiblog_data_path/${ZWEIBLOG_DATA_PATH_RAW}/g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
  sed -i "s/zweiblog_email/${zweiblog_email}/g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
  sed -i "s/zweiblog_caddy_https/${zweiblog_caddy_https}/g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
  sed -i "s/zweiblog_http_bind/${zweiblog_http_bind}/g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
  sed -i "s/zweiblog_http_port/${zweiblog_http_port}/g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
  sed -i "s|zweiblog_https_mapping|${zweiblog_https_mapping}|g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
  # sed -i "s/zweiblog_domains/${zweiblog_domains}/g" ${ZWEIBLOG_BASE_PATH}/docker-compose.yaml
  # sed -i "s/zweiblog_version/${zweiblog_version}/g" ${ZWEIBLOG_BASE_PATH}/docker-compose.yaml
  sed -i "s|zweiblog_image|${Docker_IMG}|g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"

  mkdir -p \
    "${ZWEIBLOG_DATA_PATH}/data/static" \
    "${ZWEIBLOG_DATA_PATH}/log" \
    "${ZWEIBLOG_DATA_PATH}/caddy/config" \
    "${ZWEIBLOG_DATA_PATH}/caddy/data"
  chown -R 10001:10001 \
    "${ZWEIBLOG_DATA_PATH}/data/static" \
    "${ZWEIBLOG_DATA_PATH}/log" \
    "${ZWEIBLOG_DATA_PATH}/caddy"

  "${ZWEIBLOG_DATA_PATH}/setup-mongo-secrets.sh" "${ZWEIBLOG_DATA_PATH}" || return 1

  echo -e "配置 ${green}修改成功，请稍等重启生效${plain}"

  restart

  if [[ $# == 0 ]]; then
    before_show_menu
  fi
}

restart() {
  echo -e "> 重启服务"

  cd $ZWEIBLOG_BASE_PATH
  zweiblog_compose down || return 1
  zweiblog_compose up -d
  if [[ $? == 0 ]]; then
    echo -e "${green}ZweiBlog 重启成功${plain}"
    echo -e "默认管理面板地址：${yellow}域名:站点访问端口/admin${plain}"
  else
    echo -e "${red}重启失败，可能是因为启动时间超过了两秒，请稍后查看日志信息${plain}"
  fi

  if [[ $# == 0 ]]; then
    before_show_menu
  fi
}
update() {
  local container_id previous_image target_image new_image retention_tag
  echo "> 更新服务（仅更新应用镜像，MongoDB 版本保持不变）"
  container_id=$(zweiblog_compose ps -q zweiblog) || return 1
  [[ -n "$container_id" ]] || { echo "请先启动当前版本并确认健康后再更新。" >&2; return 1; }
  previous_image=$(docker inspect --format '{{.Image}}' "$container_id") || return 1
  target_image=$(ZWEIBLOG_IGNORE_IMAGE_PIN=1 zweiblog_compose config | awk '
    /^  zweiblog:/ { in_service=1; next }
    /^  [^ ]/ { in_service=0 }
    in_service && /^    image:/ { print $2; exit }')
  [[ -n "$target_image" ]] || return 1
  # Capture a consistent pre-update backup before any new process can write.
  backup 0 || { echo "备份失败，取消更新。" >&2; return 1; }
  retention_tag="zweiblog:rollback-$(date +%Y%m%d%H%M%S)-${RANDOM}"
  docker tag "$previous_image" "$retention_tag" || return 1
  ZWEIBLOG_IGNORE_IMAGE_PIN=1 zweiblog_compose pull zweiblog || return 1
  new_image=$(docker image inspect --format '{{.Id}}' "$target_image") || return 1
  write_image_pin "${ZWEIBLOG_BASE_PATH}/.zweiblog-rollback.yaml" "$previous_image" || return 1
  write_image_pin "${ZWEIBLOG_BASE_PATH}/.zweiblog-image.yaml" "$new_image" || return 1
  if ! zweiblog_compose up -d --no-deps zweiblog || ! wait_for_zweiblog; then
    echo "更新未通过健康检查，正在恢复上一应用镜像。" >&2
    rollback 0 || echo "自动回滚未恢复健康，请检查服务日志和备份。" >&2
    return 1
  fi
  echo "更新完成，旧镜像保留为 ${retention_tag}。可运行 ./zweiblog.sh rollback 回滚应用。"
  [[ $# != 0 ]] || before_show_menu
  return 0
}

rollback() {
  local previous_image
  [[ -f "${ZWEIBLOG_BASE_PATH}/.zweiblog-rollback.yaml" ]] || {
    echo "没有可用的上一次更新记录。" >&2; return 1;
  }
  previous_image=$(sed -n 's/^    image: \(sha256:[a-f0-9]\{64\}\)$/\1/p' "${ZWEIBLOG_BASE_PATH}/.zweiblog-rollback.yaml")
  docker image inspect "$previous_image" >/dev/null || return 1
  write_image_pin "${ZWEIBLOG_BASE_PATH}/.zweiblog-image.yaml" "$previous_image" || return 1
  zweiblog_compose up -d --no-deps zweiblog && wait_for_zweiblog || return 1
  echo "已恢复上一应用镜像；数据库保持现状。如涉及不兼容数据迁移，请在维护窗口恢复更新前备份。"
  [[ $# != 0 ]] || before_show_menu
  return 0
}

reset_https() {
    echo -e "> 重置 https 设置（需要先启动 zweiblog）"
    cd "$ZWEIBLOG_BASE_PATH" && zweiblog_compose exec zweiblog node /app/cli/resetHttps.js
    before_show_menu
}

start_zweiblog() {
  echo -e "> 启动 ZweiBlog"

  cd "$ZWEIBLOG_BASE_PATH" && zweiblog_compose up -d
  if [[ $? == 0 ]]; then
    echo -e "${green}ZweiBlog 启动成功${plain}"
  else
    echo -e "${red}启动失败，请稍后查看日志信息${plain}"
  fi

  if [[ $# == 0 ]]; then
    before_show_menu
  fi
}

stop_zweiblog() {
  echo -e "> 停止 ZweiBlog"

  cd "$ZWEIBLOG_BASE_PATH" && zweiblog_compose down
  if [[ $? == 0 ]]; then
    echo -e "${green}ZweiBlog 停止成功${plain}"
  else
    echo -e "${red}停止失败，请稍后查看日志信息${plain}"
  fi

  if [[ $# == 0 ]]; then
    before_show_menu
  fi
}

show_log() {
  echo -e "> 获取日志"

  cd "$ZWEIBLOG_BASE_PATH" && zweiblog_compose logs -f

  if [[ $# == 0 ]]; then
    before_show_menu
  fi
}

find_container_using_install_root() {
  local install_root="$1"
  local container_ids=""
  local container_id=""
  local mount_sources=""
  local mount_source=""

  if ! container_ids="$(docker ps -aq)"; then
    return 2
  fi

  for container_id in ${container_ids}; do
    if ! mount_sources="$(docker inspect --format '{{range .Mounts}}{{println .Source}}{{end}}' "${container_id}" 2>/dev/null)"; then
      return 2
    fi
    while IFS= read -r mount_source; do
      case "${mount_source}" in
      "${install_root}" | "${install_root}"/*)
        printf '%s' "${container_id}"
        return 0
        ;;
      esac
    done <<< "${mount_sources}"
  done

  return 1
}

uninstall_zweiblog() {
  local interactive=false
  local resolved_root=""
  local compose_file=""
  local input=""
  local container_id=""
  local container_check_status=0
  [[ $# == 0 ]] && interactive=true

  echo -e "> 卸载 ZweiBlog"

  if [[ ! -e "${ZWEIBLOG_BASE_PATH}" ]]; then
    echo -e "${yellow}未检测到 ${ZWEIBLOG_BASE_PATH}，无需卸载；没有删除任何文件。${plain}"
    echo "如需排查旧 VanBlog，请先查看容器和卷，不要直接删除未知目录。"
    $interactive && before_show_menu
    return 0
  fi

  if [[ ! -d "${ZWEIBLOG_BASE_PATH}" || -L "${ZWEIBLOG_BASE_PATH}" ]]; then
    echo -e "${red}安装路径不是普通目录，拒绝自动删除：${ZWEIBLOG_BASE_PATH}${plain}"
    $interactive && before_show_menu
    return 1
  fi

  resolved_root="$(cd -- "${ZWEIBLOG_BASE_PATH}" && pwd -P)" || {
    echo -e "${red}无法解析安装路径；没有删除任何文件。${plain}"
    $interactive && before_show_menu
    return 1
  }
  if [[ "${resolved_root}" != "/var/zweiblog" ]]; then
    echo -e "${red}安装路径安全校验失败，拒绝删除：${resolved_root}${plain}"
    $interactive && before_show_menu
    return 1
  fi

  for candidate in docker-compose.yaml docker-compose.yml compose.yaml compose.yml; do
    if [[ -f "${resolved_root}/${candidate}" ]]; then
      compose_file="${resolved_root}/${candidate}"
      break
    fi
  done
  if [[ -z "${compose_file}" || -L "${compose_file}" || ! -d "${resolved_root}/data" ]] ||
    ! grep -Eq '^[[:space:]]{2}zweiblog:' "${compose_file}"; then
    echo -e "${red}没有检测到完整的 ZweiBlog 编排和数据结构，拒绝自动删除。${plain}"
    echo "请先备份并人工核对 ${resolved_root}。"
    $interactive && before_show_menu
    return 1
  fi

  echo -e "${red}以下目录中的数据库、图片、评论、密钥和证书将永久删除：${resolved_root}${plain}"
  read -e -r -p "请输入 DELETE /var/zweiblog 以确认，其他输入均取消: " input
  if [[ "${input}" != "DELETE /var/zweiblog" ]]; then
    echo "已取消卸载；没有删除任何文件。"
    $interactive && before_show_menu
    return 0
  fi

  if docker compose version >/dev/null 2>&1; then
    (cd -- "${resolved_root}" && docker compose -f "${compose_file}" down --volumes --remove-orphans) || {
      echo -e "${red}停止容器失败，已中止卸载；数据未删除。${plain}"
      $interactive && before_show_menu
      return 1
    }
  elif command -v docker-compose >/dev/null 2>&1; then
    (cd -- "${resolved_root}" && docker-compose -f "${compose_file}" down --volumes --remove-orphans) || {
      echo -e "${red}停止容器失败，已中止卸载；数据未删除。${plain}"
      $interactive && before_show_menu
      return 1
    }
  else
    echo -e "${red}未找到 Docker Compose，已中止卸载；数据未删除。${plain}"
    $interactive && before_show_menu
    return 1
  fi

  container_id="$(find_container_using_install_root "${resolved_root}")"
  container_check_status=$?
  if [[ ${container_check_status} -eq 0 ]]; then
    echo -e "${red}仍有容器引用 ${resolved_root}（容器 ID：${container_id}），已中止删除。${plain}"
    echo "请先确认该容器属于哪个 Compose 项目并安全停止；数据未删除。"
    $interactive && before_show_menu
    return 1
  elif [[ ${container_check_status} -ne 1 ]]; then
    echo -e "${red}无法核对 Docker 容器挂载，已中止卸载；数据未删除。${plain}"
    $interactive && before_show_menu
    return 1
  fi

  if ! rm -rf -- "${resolved_root}"; then
    echo -e "${red}安装目录删除失败，请人工检查；不要重复执行强制删除。${plain}"
    $interactive && before_show_menu
    return 1
  fi
  if [[ -e "${resolved_root}" ]]; then
    echo -e "${red}安装目录删除失败，请人工检查；不要重复执行强制删除。${plain}"
    $interactive && before_show_menu
    return 1
  fi

  echo -e "${green}ZweiBlog 已卸载。容器镜像未自动删除，避免影响同机的其他部署。${plain}"
  if $interactive; then
    before_show_menu
  fi
  return 0
}

backup() (
  umask 077
  local temporary_dir='' archive_name mongo_id mongo_state service running_output app_id image_id='' resume_needed=false
  local -a running_services=() backup_entries=(data) snapshot_entries=()
  cd -- "$ZWEIBLOG_BASE_PATH" || return 1
  [[ -d data && ! -L data ]] || return 1
  # Restore precisely the services that were running, including after a partial stop.
  running_output=$(zweiblog_compose ps --services --filter status=running) || return 1
  while IFS= read -r service; do
    [[ -z "$service" ]] || running_services+=("$service")
  done <<< "$running_output"
  app_id=$(zweiblog_compose ps -q zweiblog) || return 1
  if [[ -n "$app_id" ]]; then
    image_id=$(docker inspect --format '{{.Image}}' "$app_id") || return 1
    [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  fi
  cleanup_backup() {
    local result=$?
    if $resume_needed; then
      if ! zweiblog_compose start "${running_services[@]}"; then
        echo "备份后恢复服务失败，请手动检查并启动服务。" >&2
        result=1
      fi
    fi
    [[ -z "$temporary_dir" ]] || rm -rf -- "$temporary_dir"
    exit "$result"
  }
  trap cleanup_backup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if (( ${#running_services[@]} > 0 )); then
    resume_needed=true
    zweiblog_compose stop --timeout 120 "${running_services[@]}" || return 1
  fi
  mongo_id=$(zweiblog_compose ps -a -q mongo) || return 1
  [[ -n "$mongo_id" ]] || { echo "没有可验证的 MongoDB 容器，取消备份。" >&2; return 1; }
  mongo_state=$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$mongo_id") || return 1
  [[ "$mongo_state" == 'exited 0' ]] || {
    echo "MongoDB 未正常停止，取消文件备份：${mongo_state}" >&2; return 1;
  }
  running_output=$(zweiblog_compose ps --services --filter status=running) || return 1
  [[ -z "$running_output" ]] || return 1
  for service in docker-compose.yaml docker-compose.yml docker-compose.override.yaml docker-compose.override.yml docker-compose.https.yml docker-compose.build.yml .env .zweiblog-image.yaml .zweiblog-rollback.yaml mongo-init.js mongo-healthcheck.js setup-mongo-secrets.sh; do
    # Record the actually running image even on the first update, before an
    # image pin exists. A latest tag alone cannot identify a restorable version.
    [[ "$service" != .zweiblog-image.yaml || -z "$image_id" ]] || continue
    [[ ! -f "$service" ]] || backup_entries+=("$service")
  done
  # The installer nests these inside data/, while the checked-in Compose
  # defaults keep them beside data/. Preserve either standard layout.
  for service in secrets log caddy; do
    if [[ -e "$service" ]]; then
      [[ -d "$service" && ! -L "$service" ]] || return 1
      backup_entries+=("$service")
    fi
  done
  temporary_dir=$(mktemp -d "${ZWEIBLOG_BASE_PATH}/.zweiblog-backup.XXXXXX") || return 1
  archive_name="zweiblog-backup-$(date +%Y%m%d%H%M%S)-${temporary_dir##*.}.tar.gz"
  if [[ -n "$image_id" ]]; then
    printf 'services:\n  zweiblog:\n    image: %s\n' "$image_id" > "${temporary_dir}/.zweiblog-image.yaml" || return 1
    snapshot_entries=(-C "$temporary_dir" .zweiblog-image.yaml)
  fi
  tar czf "${temporary_dir}/archive.tar.gz" "${backup_entries[@]}" "${snapshot_entries[@]}" || return 1
  tar tzf "${temporary_dir}/archive.tar.gz" >/dev/null || return 1
  mv -- "${temporary_dir}/archive.tar.gz" "${ZWEIBLOG_BASE_PATH}/${archive_name}" || return 1
  if $resume_needed; then
    zweiblog_compose start "${running_services[@]}" || return 1
    resume_needed=false
  fi
  echo "备份成功：${ZWEIBLOG_BASE_PATH}/${archive_name}（包含数据库、文件和配置，权限 0600）"
)

restore_archive() (
  umask 077
  local backup_file="$1" temporary_dir='' entry name retained_dir='' running_output
  local -a entries=(data secrets log caddy docker-compose.yaml docker-compose.yml docker-compose.override.yaml docker-compose.override.yml docker-compose.https.yml docker-compose.build.yml .env .zweiblog-image.yaml .zweiblog-rollback.yaml mongo-init.js mongo-healthcheck.js setup-mongo-secrets.sh)
  local -a installed=() retained=()
  [[ -f "$backup_file" && -d "$ZWEIBLOG_BASE_PATH" ]] || return 1
  temporary_dir=$(mktemp -d "${ZWEIBLOG_BASE_PATH}/.zweiblog-restore.XXXXXX") || return 1
  trap 'rm -rf -- "$temporary_dir"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  # Validate before stopping services. Links/devices and paths outside the
  # backup format are rejected rather than extracted with root privileges.
  tar tzf "$backup_file" > "${temporary_dir}/entries" || return 1
  while IFS= read -r entry; do
    entry="${entry#./}"
    case "$entry" in
      /*|*\\*|..|../*|*/../*|*/..) echo "备份包含不安全路径" >&2; return 1;;
      data|data/|data/*|secrets|secrets/|secrets/*|log|log/|log/*|caddy|caddy/|caddy/*|docker-compose.yaml|docker-compose.yml|docker-compose.override.yaml|docker-compose.override.yml|docker-compose.https.yml|docker-compose.build.yml|.env|.zweiblog-image.yaml|.zweiblog-rollback.yaml|mongo-init.js|mongo-healthcheck.js|setup-mongo-secrets.sh) ;;
      *) echo "备份包含未知路径：$entry" >&2; return 1;;
    esac
  done < "${temporary_dir}/entries"
  tar tvzf "$backup_file" > "${temporary_dir}/types" || return 1
  if ! awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" { exit 1 }' "${temporary_dir}/types"; then
    echo "备份包含链接或特殊文件，拒绝自动恢复。" >&2; return 1
  fi
  mkdir "${temporary_dir}/contents" || return 1
  tar xzf "$backup_file" -C "${temporary_dir}/contents" || return 1
  [[ -d "${temporary_dir}/contents/data" ]] || return 1
  if [[ -f "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml" || -f "${ZWEIBLOG_BASE_PATH}/docker-compose.yml" ]]; then
    zweiblog_compose stop --timeout 120 || return 1
    running_output=$(zweiblog_compose ps --services --filter status=running) || return 1
    [[ -z "$running_output" ]] || return 1
  fi
  retained_dir=$(mktemp -d "${ZWEIBLOG_BASE_PATH}/zweiblog-before-restore.XXXXXX") || return 1
  restore_previous_files() {
    local item
    # Do not merge MongoDB directories. Retain the failed new files for review.
    for item in "${installed[@]}"; do
      mv -- "${ZWEIBLOG_BASE_PATH}/${item}" "${temporary_dir}/contents/${item}" || return 1
    done
    for item in "${retained[@]}"; do
      mv -- "${retained_dir}/${item}" "${ZWEIBLOG_BASE_PATH}/${item}" || return 1
    done
  }
  for name in "${entries[@]}"; do
    if [[ -e "${ZWEIBLOG_BASE_PATH}/${name}" || -L "${ZWEIBLOG_BASE_PATH}/${name}" ]]; then
      if ! mv -- "${ZWEIBLOG_BASE_PATH}/${name}" "${retained_dir}/${name}"; then
        restore_previous_files; return 1
      fi
      retained+=("$name")
    fi
    if [[ -e "${temporary_dir}/contents/${name}" ]]; then
      if ! mv -- "${temporary_dir}/contents/${name}" "${ZWEIBLOG_BASE_PATH}/${name}"; then
        restore_previous_files; return 1
      fi
      installed+=("$name")
    fi
  done
  echo "恢复成功，原数据保留在 ${retained_dir}；请核对配置与镜像版本后手动启动。"
)

restore() {
  local backup_file
  echo "> 恢复 zweiblog（请使用自己保管的可信备份）"
  read -e -r -p "请输入备份文件名（含路径）: " backup_file
  [[ -n "$backup_file" ]] || return 1
  restore_archive "$backup_file"
}

show_usage() {
  echo "ZweiBlog 管理脚本使用方法: "
  echo "--------------------------------------------------------"
  echo "./zweiblog.sh                            - 显示管理菜单"
  echo "./zweiblog.sh install                    - 安装 ZweiBlog"
  echo "./zweiblog.sh config                     - 修改 ZweiBlog 配置"
  echo "./zweiblog.sh start                      - 启动 ZweiBlog"
  echo "./zweiblog.sh stop                       - 停止 ZweiBlog"
  echo "./zweiblog.sh restart                    - 重启 ZweiBlog"
  echo "./zweiblog.sh update                     - 备份并更新应用镜像"
  echo "./zweiblog.sh rollback                   - 恢复上一应用镜像"
  echo "./zweiblog.sh log                        - 查看 ZweiBlog 日志"
  echo "./zweiblog.sh uninstall                  - 卸载 ZweiBlog"
  echo "./zweiblog.sh reset_https                - 重置 https 设置"
  echo "./zweiblog.sh backup                     - 备份 ZweiBlog"
  echo "./zweiblog.sh restore                    - 恢复 ZweiBlog"
  echo "--------------------------------------------------------"
  echo "./zweiblog.sh update_script              - 更新此脚本"
  echo "--------------------------------------------------------"
}

show_menu() {
  echo -e "
    ${green}ZweiBlog 管理脚本${plain} ${red}${ZWEIBLOG_SCRIPT_VERSION}${plain}
    --- https://github.com/X2M7/zweiblog ---
    ${green}1.${plain}  安装 ZweiBlog
    ${green}2.${plain}  修改配置
    ${green}3.${plain}  启动服务
    ${green}4.${plain}  停止服务
    ${green}5.${plain}  重启服务
    ${green}6.${plain}  更新
    ${green}7.${plain}  查看日志
    ${green}8.${plain}  卸载
    ${green}9.${plain}  重置 https 设置
    ${green}10.${plain} 备份 ZweiBlog
    ${green}11.${plain} 恢复 ZweiBlog
    ${green}12.${plain} 回滚应用镜像
    ————————————————-
    ${green}20.${plain} 更新此脚本
    ${green}30.${plain} 查看脚本使用说明
    ${green}0.${plain}  退出脚本
    "
  echo && read -ep "请输入选择 [0-30]: " num

  case "${num}" in
  0)
    exit 0
    ;;
  1)
    install_zweiblog
    ;;
  2)
    config
    ;;
  3)
    start_zweiblog
    ;;
  4)
    stop_zweiblog
    ;;
  5)
    restart
    ;;
  6)
    update
    ;;
  7)
    show_log
    ;;
  8)
    uninstall_zweiblog
    ;;
  9)
    reset_https
    ;;
  10)
    backup
    ;;
  11)
    restore
    ;;
  12)
    rollback
    ;;
  20)
    update_script
    ;;
  30)
    show_usage
    ;;
  *)
    echo -e "${red}请输入正确的数字 [0-30]${plain}"
    ;;
  esac
}

pre_check

if [[ $# > 0 ]]; then
  case $1 in
  "install")
    install_zweiblog 0
    ;;
  "config")
    config 0
    ;;
  "start")
    start_zweiblog 0
    ;;
  "stop")
    stop_zweiblog 0
    ;;
  "restart")
    restart 0
    ;;
  "update")
    update 0
    ;;
  "rollback")
    rollback 0
    ;;
  "log")
    show_log 0
    ;;
  "update_script")
    update_script 0
    ;;
  "uninstall")
    uninstall_zweiblog 0
    ;;
  "reset_https")
    reset_https 0
    ;;
  "backup")
    backup 0
    ;;
  "restore")
    restore 0
    ;;
  *) show_usage ;;
  esac
else
  show_menu
fi
