#!/usr/bin/env bash
# 全新 Ubuntu（22.04 / 24.04 / 26.04）服务器初始化：创建 swap、安装 Docker、放通本机防火墙。
# 用法（在服务器上）：sudo bash setup-ubuntu.sh
set -euo pipefail

# 关键：禁用 apt 的交互式提问。否则 Ubuntu 的 needrestart 会在装包之后
# 弹一个「要重启哪些服务」的选择框，通过 SSH 有时渲染不出来，终端会假死在
# "Scanning linux images..." 上。
export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_SUSPEND=1
export NEEDRESTART_MODE=a

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请用 root 运行，例如 sudo bash setup-ubuntu.sh"
  exit 1
fi

echo "==> 1/4 创建 2G swap（2C2G 机器构建前端时很容易 OOM）"
if [ "$(swapon --show | wc -l)" -eq 0 ]; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    已启用 2G swap"
else
  echo "    已有 swap，跳过"
fi

echo "==> 2/4 安装 Docker"
if command -v docker >/dev/null 2>&1; then
  echo "    Docker 已安装，跳过"
else
  if [ ! -f /etc/os-release ] || ! grep -qi '^ID=ubuntu' /etc/os-release; then
    echo "错误：本脚本只支持 Ubuntu（需要 apt）。当前系统不是 Ubuntu，请改用 Ubuntu 22.04/24.04 镜像重装。"
    exit 1
  fi
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg >/dev/null

  # 优先走阿里云 docker-ce 源。新版本 Ubuntu（如 26.04）的代号可能还没被镜像收录，
  # 那样会 404，再用官方脚本兜底。
  install_docker_apt() {
    . /etc/os-release
    codename="${VERSION_CODENAME:?无法识别 Ubuntu 版本代号}"
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/ubuntu/gpg \
      | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/ubuntu %s stable\n' \
      "$(dpkg --print-architecture)" "$codename" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq && apt-get install -y -qq \
      docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  }

  install_docker_script() {
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh >/dev/null
    rm -f /tmp/get-docker.sh
  }

  if install_docker_apt; then
    echo "    已通过阿里云镜像源安装"
  else
    echo "    镜像源不可用（可能是 Ubuntu 版本代号未被收录），改用官方安装脚本…"
    rm -f /etc/apt/sources.list.d/docker.list
    apt-get update -qq || true
    install_docker_script
  fi

  command -v docker >/dev/null 2>&1 || { echo "错误：Docker 安装失败，请把上面的报错发给我。"; exit 1; }
  systemctl enable --now docker
  echo "    Docker 已安装"
fi

echo "==> 3/4 放通本机防火墙 22/80/443"
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  echo "    ufw 已放通"
else
  echo "    ufw 未启用，跳过"
fi

echo "==> 4/4 版本检查"
docker --version
docker compose version

cat <<'EOF'

完成。如果 docker pull 很慢或超时（大陆网络常见），配置镜像加速器：

  sudo mkdir -p /etc/docker
  sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
  {
    "registry-mirrors": ["https://docker.m.daocloud.io"]
  }
  JSON
  sudo systemctl restart docker

镜像加速地址会失效，请以各云厂商控制台「容器镜像服务 → 镜像加速器」给出的地址为准。

下一步：回到仓库目录，执行 bash deploy.sh
记得同时在云厂商控制台「安全组 / 防火墙」放通 22、80、443 入方向。
EOF
