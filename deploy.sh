#!/usr/bin/env bash
# 在服务器上、仓库根目录执行：bash deploy.sh
# 首次运行会交互式生成 .env，然后构建镜像 → 迁移数据库 → 启动 → 自检。
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v docker >/dev/null 2>&1 || { echo "错误：未安装 Docker。请先执行 sudo bash setup-ubuntu.sh"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "错误：缺少 docker compose 插件。请先执行 sudo bash setup-ubuntu.sh"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "错误：需要 curl。sudo apt-get install -y curl"; exit 1; }

if [ ! -f .env ]; then
  echo "==> 首次部署：生成 .env"
  read -r -p "请输入已解析到本机的域名（例如 inch.example.com）: " site_domain
  site_domain="${site_domain#http://}"
  site_domain="${site_domain#https://}"
  site_domain="${site_domain%%/*}"
  if [ -z "$site_domain" ]; then echo "错误：域名不能为空"; exit 1; fi
  if command -v openssl >/dev/null 2>&1; then
    db_pass="$(openssl rand -hex 24)"
  else
    db_pass="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  printf 'SITE_DOMAIN=%s\nPOSTGRES_PASSWORD=%s\n' "$site_domain" "$db_pass" > .env
  chmod 600 .env
  echo "==> 已写入 .env（数据库密码已随机生成，请勿泄露）"
fi

set -a; . ./.env; set +a
echo "==> 目标域名: ${SITE_DOMAIN}"

# DNS 预检：域名没解析到本机时，Caddy 申请证书一定会失败。
public_ip="$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
resolved_ip="$(getent hosts "${SITE_DOMAIN}" 2>/dev/null | awk '{print $1; exit}' || true)"
if [ -n "$public_ip" ] && [ -n "$resolved_ip" ] && [ "$public_ip" != "$resolved_ip" ]; then
  echo ""
  echo "!! 警告：${SITE_DOMAIN} 当前解析到 ${resolved_ip}，但本机公网 IP 是 ${public_ip}。"
  echo "!! 请先把域名的 A 记录改成 ${public_ip}，否则 HTTPS 证书申请会失败。"
  echo ""
  read -r -p "仍然继续？(y/N) " go
  [ "${go}" = "y" ] || exit 1
fi

echo "==> 构建镜像（首次需拉取基础镜像，约 3~10 分钟）"
docker compose build

echo "==> 启动数据库并等待就绪"
docker compose up -d --wait db

echo "==> 执行数据库迁移"
docker compose run --rm --no-deps api node dist/src/migrate.js

echo "==> 启动全部服务"
docker compose up -d --wait

echo "==> 等待 HTTPS 证书签发（最长 90 秒）"
# 注意：不能直接 curl https://$SITE_DOMAIN。域名解析到本机的公网 IP，而从服务器
# 内部访问自己的公网 IP 通常不被云厂商支持（无 hairpin NAT），会超时，从而把
# 一次成功的部署误判为失败。用 --resolve 把域名钉到 127.0.0.1：仍然走完整的
# SNI → Caddy → TLS → 反向代理链路，但不离开本机。
health_ok=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 --resolve "${SITE_DOMAIN}:443:127.0.0.1" \
      "https://${SITE_DOMAIN}/api/health" >/dev/null 2>&1; then
    health_ok=1
    break
  fi
  sleep 3
done

if [ "$health_ok" = "1" ]; then
  echo ""
  echo "==> 本机自检通过（TLS + 路由 + 反向代理）"
  curl -fsS --resolve "${SITE_DOMAIN}:443:127.0.0.1" "https://${SITE_DOMAIN}/api/health"; echo
  curl -fsS --resolve "${SITE_DOMAIN}:443:127.0.0.1" "https://${SITE_DOMAIN}/api/ready"; echo
  echo ""
  echo "==> 检查外网可达性（从公网能不能连到 443）"
  if curl -fsS --max-time 8 "https://${SITE_DOMAIN}/api/health" >/dev/null 2>&1; then
    echo "    外网访问正常"
    echo ""
    echo "站点地址: https://${SITE_DOMAIN}"
  else
    echo ""
    echo "    外网访问失败：本机链路是通的，但从公网连不进 443。"
    echo "    99% 是云厂商控制台的实例防火墙没放通 443（不是服务器里的 ufw）。"
    echo "    去「轻量应用服务器 → 你的实例 → 防火墙」加一条 TCP:443 规则，然后重跑 bash deploy.sh。"
    exit 1
  fi
else
  echo ""
  echo "!! 本机自检未通过，证书很可能还没签下来。请查看日志："
  echo "   docker compose logs --tail=80 web"
  echo "   关注 acme / challenge / certificate 相关的行"
  echo "常见原因：DNS 未生效、控制台防火墙未放通 80/443。"
  exit 1
fi

echo ""
echo "下一步：创建第一个管理员（密码从标准输入读取，不会进 shell 历史）"
echo "  docker compose run --rm --no-deps api node dist/src/create-admin.js admin 管理员"
