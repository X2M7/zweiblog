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
ZWEIBLOG_SCRIPT_VERSION="v0.3.3"

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
ZWEIBLOG_OLD_IMAGE="${ZWEIBLOG_OLD_IMAGE:-zweiblog:previous}"

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


delete_old_images() {
  echo -e "> 删除旧镜像"
  docker rmi -f "${ZWEIBLOG_OLD_IMAGE}" >/dev/null 2>&1 || true
}

retag_old_images() {
  echo -e "> 重命名旧镜像"
  if [[ -n "${ZWEIBLOG_IMAGE}" ]]; then
    docker tag "${ZWEIBLOG_IMAGE}" "${ZWEIBLOG_OLD_IMAGE}" >/dev/null 2>&1 || true
  fi
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

update_script() {
  require_asset_base || return 1
  echo -e "> 更新脚本"

  curl -sL ${SCRIPT_URL} -o /tmp/zweiblog.sh
  new_version=$(cat /tmp/zweiblog.sh | grep "ZWEIBLOG_SCRIPT_VERSION" | head -n 1 | awk -F "=" '{print $2}' | sed 's/\"//g;s/,//g;s/ //g')
  if [ ! -n "$new_version" ]; then
    echo -e "脚本获取失败，请检查本机能否链接 ${SCRIPT_URL}"
    return 1
  fi
  echo -e "当前最新版本为: ${new_version}"
  mv -f /tmp/zweiblog.sh ./zweiblog.sh && chmod a+x ./zweiblog.sh

  echo -e "3s后执行新脚本"
  sleep 3s
  clear
  exec ./zweiblog.sh
  exit 0
}

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
    echo -e "${red}Existing MongoDB data was detected at $existing_mongo_path.${plain}"
    echo "The MongoDB 8.0 template will not be written over an existing data directory."
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
  read -ep "请输入您的邮箱：" zweiblog_email &&
    read -ep "请输入 http 端口（默认为 80）：" zweiblog_http_port &&
    read -ep "请输入 https 端口（默认为 443）：" zweiblog_https_port
  # echo "接下来您需要输入的域名对应着编排文件中的 ZWEI_BLOG_ALLOW_DOMAINS 变量（不含协议、不可包含通配符、多个域名通过英文逗号分隔）" &&
  # echo "如果用了 cdn 或图床，需要把图床或 cdn 的域名也加上" &&
  # read -ep "请输入您最终要绑定的域名（小写）:" zweiblog_domains

  if [[ -z "${zweiblog_email}" ]]; then
    echo -e "${red}除了端口外所有选项都不能为空${plain}"
    before_show_menu
    return 1
  fi

  if [[ -z "${zweiblog_http_port}" ]]; then
    zweiblog_http_port=80
  fi
  if [[ -z "${zweiblog_https_port}" ]]; then
    zweiblog_https_port=443
  fi
  if [[ ! "${zweiblog_email}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    echo -e "${red}邮箱格式无效${plain}"
    return 1
  fi
  if [[ ! "${zweiblog_http_port}" =~ ^[0-9]+$ || ! "${zweiblog_https_port}" =~ ^[0-9]+$ ]]; then
    echo -e "${red}端口必须是 1-65535 之间的整数${plain}"
    return 1
  fi
  if ((zweiblog_http_port < 1 || zweiblog_http_port > 65535)) ||
    ((zweiblog_https_port < 1 || zweiblog_https_port > 65535)); then
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
  sed -i "s/zweiblog_http_port/${zweiblog_http_port}/g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
  sed -i "s/zweiblog_https_port/${zweiblog_https_port}/g" "${ZWEIBLOG_BASE_PATH}/docker-compose.yaml"
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
  docker-compose down
  docker-compose up -d
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
  echo -e "> 更新服务"
  retag_old_images

  cd $ZWEIBLOG_BASE_PATH
  docker-compose pull
  docker-compose down
  docker-compose up -d
  if [[ $? == 0 ]]; then
    echo -e "${green}ZweiBlog 更新并重启成功${plain}"
    echo -e "默认管理面板地址：${yellow}域名:站点访问端口${plain}"
  else
    echo -e "${red}重启失败，可能是因为启动时间超过了两秒，请稍后查看日志信息${plain}"
  fi

  delete_old_images

  before_show_menu

}

reset_https() {
    echo -e "> 重置 https 设置（需要先启动 zweiblog）"
    cd $ZWEIBLOG_BASE_PATH && docker-compose exec zweiblog node /app/cli/resetHttps.js
    before_show_menu
}

start_zweiblog() {
  echo -e "> 启动 ZweiBlog"

  cd $ZWEIBLOG_BASE_PATH && docker-compose up -d
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

  cd "$ZWEIBLOG_BASE_PATH" && docker-compose down
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

  cd $ZWEIBLOG_BASE_PATH && docker-compose logs -f

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

backup() {
  echo -e "> 备份 zweiblog"
  name="zweiblog-backup-$(date +"%Y%m%d%H%M%S").tar.gz"
  cd "$ZWEIBLOG_BASE_PATH" || return 1
  (umask 077 && tar czf "$name" ./data) || return 1
  chmod 0600 "$name"
  echo -e "${green}备份成功，文件名：${name}${plain} 所在路径：${ZWEIBLOG_BASE_PATH}"
}

restore() {
  echo -e "> 恢复 zweiblog"
  read -e -r -p "请输入备份文件名（含路径）: " path
  # 检测空
  if [ -z "$path" ]; then
    echo -e "${red}输入为空${plain}"
    exit 1
  fi
  # 停止 zweiblog
  echo -e "> 停止 zweiblog 中..."
  stop_zweiblog
  # 覆盖解压到目标路径
  echo -e "> 覆盖解压到目标路径中..."
  tar xzvf $path -C $ZWEIBLOG_BASE_PATH
  echo -e "${green}恢复成功${plain}，请手动启动 zweiblog"
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
  echo "./zweiblog.sh update                     - 更新 ZweiBlog"
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
