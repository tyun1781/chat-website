# 把 INCH 部署到公网：从买域名到上线的完整步骤

> 面向第一次部署的新手。跟着做，大约 1~2 小时能上线；代码部分已经全部写好，你只需要买两样东西。

---

## 0. 先看这里：一个必须先知道的事实

你原本选的是「国内云服务器 + 已备案域名」。**这条路对这个项目走不通**，原因不是技术，是备案政策：

阿里云官方备案文档明确写着：

> 国务院下发的《关于第五批取消和下放管理层级行政审批项目的决定》第七条为"取消互联网电子公告服务专项审批（备案）的通知"，即开办论坛网站所需向省通信管理局申请的《BBS 前置审批文件》现已停止办理，**因此论坛网站已无法办理ICP备案**。
>
> —— [阿里云：常见网站的 ICP 备案场景及备案要求](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-requirements-for-a-regular-website)

你的站点有注册、发帖、评论、私聊，属于典型的 UGC 论坛/社区。这意味着：

- 买大陆服务器 → 必须备案 → 论坛类备案拿不到 → **域名无法合法绑定大陆服务器**
- 阿里云同一篇文档还强调：**未备案成功前不允许开通网站访问**，连用 IP 直接访问都不行
- 所以「先上线再补备案」也不成立

同一篇文档同时给出了另一条路：

> **托管于非中国内地服务器的网站无需进行 ICP 备案。**

**结论：把服务器放在香港（或新加坡/日本），完全跳过 ICP 备案。** 香港节点到大陆延迟通常 30~60ms，日常刷帖完全够用。下面的步骤都按这个方案写。

> 合规提醒（不是技术问题，请自己判断）：面向大陆用户提供交互服务，理论上仍需做**公安联网备案**，并落实用户实名、内容审核、日志留存不少于 6 个月等义务。这部分不在本文档的部署范围内。

---

## 1. 方案与费用

| 项目 | 选什么 | 参考价（以官网实时价为准） |
| --- | --- | --- |
| 域名 | 阿里云万网 / 腾讯云，`.com` 或 `.top` | `.com` 首年约 ¥55~90，续费约 ¥80~100/年 |
| 服务器 | 腾讯云 / 阿里云**轻量应用服务器**，地域选**香港** | 2核2G 3M 约 ¥24~30/月；新用户常年有 ¥99~200/年 的促销 |
| 合计 | | **首年大约 ¥300~500** |

配置建议：

- **系统镜像选 Ubuntu 22.04 LTS**（本文所有命令都按这个写）
- 内存 **2G 起步**，能上 2核4G 更稳（部署脚本会自动加 2G swap，2G 也能跑）
- 系统盘 40G 够用
- 带宽 3M 起步；论坛以文字为主，3M 能撑十几个人同时在线

> 如果暂时一分钱都不想花，还有一条兜底路：用 Cloudflare Tunnel 把你自己电脑上的服务临时暴露到公网，免费但电脑必须一直开机。等你决定买了再回来看本文档。

---

## 2. 第一步：买域名

全部在**腾讯云**一个账号里搞定（域名 + 服务器 + 解析都在同一控制台，最省事）：

1. 打开 <https://cloud.tencent.com>，注册账号，完成**个人实名认证**（身份证 + 微信/QQ 扫脸，10 分钟）。
2. 进入**域名注册**：<https://dnspod.cloud.tencent.com>
3. 搜索你想要的域名，比如 `inch-bbs.com`，选一个没被注册的。
4. 加入清单 → 结算。下单时如提示**创建信息模板**，选「个人」，填真实姓名、身份证号、地址。
5. 支付后等**实名审核**，通常几分钟到 1 天。**没通过实名的域名会被停止解析**，这一步不能跳。
6. 买完在「我的域名」里能看到它，解析默认由 DNSPod 托管。**先别急着解析**，等第 5 步再配。

> **注意：这里的「实名认证」是域名和账号的实名，不是网站备案。** 域名实名是必须的；网站备案（ICP）因为服务器在香港，不需要办。两件事别混。

省钱提示：`.top` / `.xyz` 首年常常只要 ¥10~30，但个别邮箱和第三方服务会歧视这类后缀；给自己人用的社区站无所谓，想要正式一点就 `.com`。

---

## 3. 第二步：买服务器

以**腾讯云轻量应用服务器**为例：

1. 注册/登录 <https://cloud.tencent.com>，完成实名认证（买域名时已做过就不用重复）。
2. 直接打购买页：<https://buy.cloud.tencent.com/lighthouse>
   （产品介绍页 <https://cloud.tencent.com/product/lighthouse>，控制台 <https://console.cloud.tencent.com/lighthouse>）
3. 页面上的选项，按这张表填：

   | 选项 | 选什么 | 说明 |
   | --- | --- | --- |
   | **创建方式** | **基于操作系统镜像** | 不要选「使用应用镜像」或「使用容器镜像」。应用镜像（WordPress/宝塔/论坛模板）会预装一堆东西、占端口；容器镜像会锁定 Ubuntu 24.04 并走面板里的容器管理，而我们要自己跑 docker compose，多一层就多一个坑 |
   | **地域** | **中国香港** | 不要选广州/上海/北京，那几个必须备案 |
   | **镜像** | **Ubuntu**，优先 22.04 或 24.04 LTS | **必须选 Ubuntu 系**，不要选 OpenCloudOS / CentOS / CentOS Stream——`setup-ubuntu.sh` 用的是 apt，非 Ubuntu 会直接报错退出。26.04 LTS 也能用（脚本会自动降级到 Docker 官方安装脚本） |
   | **套餐** | **2核 2G** 起（预算够上 2核 4G） | 1G 内存会在构建前端时被 OOM 杀掉，2G 是底线。香港常见 20~30Mbps 峰值带宽 + 0.5~2TB/月 流量包 |
   | **登录方式** | **自定义密码** | 自己设一个 root 密码并记下来，之后 `ssh root@IP` 直接能用。别选「自动生成密码」——密码发到站内信，还得翻控制台找 |
   | **时长** | 先买 **1 个月** | 跑通了再续年付，别一上来押一年 |

4. 支付完，进入实例详情页，记下**公网 IP**。
5. 在「防火墙」里确认**放通 22、80、443** 这三个端口（入方向）。没有就手动加。

> 香港套餐页面可能挂一句「在跨境连接时可能出现较大网络延迟和丢包」的免责说明——这是腾讯云对跨境线路的标准提示，不代表不能用。真实体感见第 11 节「国内访问会不会被墙」。

阿里云的对应产品叫**轻量应用服务器**，买的时候地域同样选**中国香港**，镜像选 Ubuntu 22.04，安全组放通 22/80/443。

> **注意**：轻量服务器默认用户名是 `root`。密码在控制台「重置密码」里设置一个，记下来。

---

## 4. 第三步：连上服务器

**注意：腾讯云轻量的 Ubuntu 镜像，初始登录名是 `ubuntu`，不是 `root`。** 控制台「服务器登录」那里会写「初始登录名为 ubuntu」。

先在控制台点**「重置密码」**，给 `ubuntu` 用户设一个你记得住的密码（如果你买的时候选了「自定义密码」，那已经设好了，跳过这步）。

然后在 Windows 上打开 PowerShell（不是 cmd），执行：

```powershell
ssh ubuntu@你的服务器IP
```

第一次连接会问 `Are you sure you want to continue connecting?`，输入 `yes` 回车，再输入密码（输密码时屏幕不显示，正常）。

连上后提示符是 `ubuntu@VM-...:~$`。**接下来切到 root**，后面的命令都用 root 跑：

```bash
sudo -i
```

提示符变成 `root@VM-...:~#` 就对了。

> 为什么不直接用 `ssh root@IP`？因为轻量 Ubuntu 默认没开 root 密码登录。`ubuntu` 有 sudo 权限，`sudo -i` 之后效果完全一样。
>
> 也可以在控制台点**「免密登录」**直接开网页终端，但上传文件不方便，本文按本地 SSH 写。

---

## 5. 第四步：域名解析

回到域名控制台，给域名加一条 A 记录：

| 记录类型 | 主机记录 | 记录值 | TTL |
| --- | --- | --- | --- |
| A | `@` | 你的服务器公网 IP | 600 |

- 腾讯云：DNSPod → 我的域名 → 解析 → 添加记录
- 阿里云：域名列表 → 解析 → 添加记录

`@` 表示主域名本身（`inch-bbs.com`）。如果你想让站点挂在 `www` 上，主机记录填 `www`，但**部署脚本里必须填同一个域名**。

加完后在本机验证（等 1~10 分钟生效）：

```powershell
nslookup inch-bbs.com
```

返回的 Address 是你的服务器 IP 就对了。

> 顺序很重要：**先解析，再部署**。Caddy 要在第一次访问时用域名去申请 Let's Encrypt 证书，域名不通就一定失败。

---

## 6. 第五步：上传代码并部署

### 6.1 把代码弄到服务器上

两种方式，选一种。

**方式 A（推荐，不依赖 GitHub 连通性）**：在你 **Windows 的 PowerShell** 里执行（不是在服务器上），把 zip 传过去：

```powershell
scp C:\Users\26425\Documents\deepseek-harness\default-workspace\chat-website.zip ubuntu@你的服务器IP:/tmp/
```

会问你密码，输 `ubuntu` 用户的密码。

然后**回到服务器上的 root shell**，解压：

```bash
cd /opt
apt-get install -y unzip
unzip /tmp/chat-website.zip
cd chat-website
```

（用 WinSCP / MobaXterm 拖拽上传到 `/tmp/` 也一样。）

**方式 B**：服务器直连 GitHub：

```bash
cd /opt
git clone https://github.com/tyun1781/chat-website.git
cd chat-website
```

> 方式 B 只克隆到 GitHub 上已有的代码。本次新增的 `Dockerfile`、`docker-compose.yml`、`Caddyfile`、`deploy.sh`、`setup-ubuntu.sh` 需要先推到仓库，否则用方式 A。
> 如果 `git clone` 卡住或报 `Connection reset`，说明服务器到 GitHub 不通，直接用方式 A。

### 6.2 装 Docker 并初始化

```bash
cd /opt/chat-website
bash setup-ubuntu.sh
```

> 这个脚本必须用 root 跑，会：创建 2G swap（防止构建时内存不足被杀）、用阿里云镜像源装 Docker、放通本机防火墙 22/80/443。
> 如果你已经是 root，直接 `bash setup-ubuntu.sh` 即可。

### 6.3 一键部署

```bash
bash deploy.sh
```

脚本会依次做这些事，中途会问你**一次**域名：

```
请输入已解析到本机的域名（例如 inch.example.com）:
```

填你的域名，**不要带 `https://`、不要带结尾斜杠**，例如 `inch-bbs.com`。

然后它会自动：

1. 生成 `.env`（数据库密码随机生成，不用你管）
2. 检查域名是否真的解析到了本机（解析不对会警告并让你确认）
3. 构建镜像（首次拉基础镜像 + 编译，约 3~10 分钟）
4. 启动 PostgreSQL 并等它就绪
5. 执行 5 个数据库迁移
6. 启动 API 和 Caddy，等待健康检查通过
7. 申请 HTTPS 证书并自检 `/api/health`、`/api/ready`

看到这个就成功了：

```
==> 部署完成
{"data":{"status":"ok"}}
{"data":{"status":"ready","database":"up","schema":"ready"}}
站点地址: https://inch-bbs.com
```

---

## 7. 第六步：创建第一个管理员

**系统没有默认管理员账号，不建就无法管理站点。** 在服务器上执行（密码从标准输入读，不会进 shell 历史）：

```bash
cd /opt/chat-website
read -rsp "管理员密码（12~128 字符）: " PW; echo
printf '%s' "$PW" | docker compose run --rm --no-deps api node dist/src/create-admin.js admin 管理员
unset PW
```

看到 `Initial administrator created.` 就成功了。这个命令只能执行一次——已存在管理员时会拒绝。

之后用 `admin` 账号在网页上登录，就能进管理台；普通用户可以在「工具 → 申请管理员权限」提交申请。

---

## 7.5 配置邮箱验证码（注册必填）

新用户注册必须填写邮箱并输入 6 位验证码，发信走 SMTP，需要你提供一个邮箱账号。

以 **QQ 邮箱**为例：

1. 登录 QQ 邮箱 → 设置 → **账户**
2. 找到「IMAP/SMTP 服务」，开启，按提示生成**授权码**（16 位字符串，**不是** 你的 QQ 密码）
3. 在服务器上编辑 `/opt/chat-website/.env`，追加这几行：

```ini
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的邮箱@qq.com
SMTP_PASS=上面生成的授权码
MAIL_FROM=INCH <你的邮箱@qq.com>
```

4. 重建 API 容器：

```bash
cd /opt/chat-website
docker compose up -d --build api
```

**没配 SMTP 站点也能正常跑**，只是注册接口会返回 503 `MAIL_NOT_CONFIGURED`，登录发帖都不受影响。

### 常见服务商参数

| 服务商 | SMTP_HOST | 端口 | 备注 |
| --- | --- | --- | --- |
| QQ 邮箱 | `smtp.qq.com` | 465 | 用授权码，不是登录密码 |
| 163 邮箱 | `smtp.163.com` | 465 | 用授权码 |
| 腾讯企业邮 | `smtp.exmail.qq.com` | 465 | 用邮箱密码 |
| Gmail | `smtp.gmail.com` | 465 | 需两步验证 + 应用专用密码 |

### 内置限制

- 验证码 6 位，**10 分钟**有效，同一验证码最多试 **5 次**，且只能兑换一次
- 同一 IP 每小时最多请求 **10** 次验证码；同一邮箱每小时最多 **5** 次
- 同一 IP 每小时最多注册 **5** 个账号
- 密码仍要求 12~128 字符，用户名 3~32 位小写字母/数字/下划线

### 关于历史账号

本功能上线前创建的账号（包括你的 `inch` 管理员）没有绑定邮箱，**不受影响，可以正常登录**。新注册的账号一律带已验证邮箱。

---

## 8. 第七步：验收清单

打开 `https://你的域名`，逐项确认：

- [ ] 首页正常显示，浏览器地址栏是**锁形图标**（HTTPS 生效）
- [ ] **注册流程**：填邮箱 → 点「获取验证码」→ 邮箱收到 6 位码 → 注册成功（验证邮箱绑定是否配好）
- [ ] 注册一个普通账号 → 能登录
- [ ] 发一条帖子 → 出现在列表里，刷新后还在
- [ ] 另开一个浏览器窗口评论它 → 另一边**不刷新也能看到**（这是在验 SSE 实时推送，Caddy 那行 `flush_interval -1` 就是为它准备的）
- [ ] 私聊能发出去
- [ ] 关掉浏览器再打开 → 登录态还在（Cookie 正常）
- [ ] 在服务器上执行 `curl -s https://你的域名/api/ready` 返回 `"schema":"ready"`

任何一项不对，先看日志：

```bash
docker compose logs --tail=100 web
docker compose logs --tail=100 api
```

---

## 9. 日常运维

所有命令都在 `/opt/chat-website` 目录下执行。

```bash
# 看状态
docker compose ps

# 看实时日志（Ctrl+C 退出）
docker compose logs -f api

# 重启
docker compose restart

# 停止（保留数据）
docker compose stop

# 更新代码后重新部署
git pull                      # 或用 WinSCP 覆盖文件
docker compose build
docker compose run --rm --no-deps api node dist/src/migrate.js
docker compose up -d
```

### 数据库备份（重要）

仓库里带了 `backup.sh`，做三件事：`pg_dump` 导出 → 校验 gzip 结构和 `pg_dump` 结束标记 → 删除 7 天前的旧备份。**校验不过会删掉半成品并返回非零**，不会留下一个看着正常其实截断的备份。

先手动跑一次，确认能出文件：

```bash
cd /opt/chat-website
chmod +x backup.sh
bash backup.sh
ls -lh /opt/backups/
```

然后挂到 cron（**先确认 cron 在跑**）：

```bash
systemctl is-active cron || (apt-get install -y cron && systemctl enable --now cron)

cat > /etc/cron.d/inch-backup <<'EOF'
0 4 * * * root /opt/chat-website/backup.sh >> /var/log/inch-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/inch-backup
```

> `/etc/cron.d/` 里的 cron 表达式比普通 crontab 多一个**用户名字段**（`root`），漏了它任务永远不会执行。另外文件末尾必须有换行。

第二天检查是否跑了：

```bash
cat /var/log/inch-backup.log
```

**一定要做一次还原演练**——没还原过的备份不算备份：

```bash
cd /opt/chat-website
# 建一个临时库，把最新备份灌进去
docker compose exec -T db psql -U inch -d postgres -c 'CREATE DATABASE restore_check'
zcat "$(ls -t /opt/backups/inch-*.sql.gz | head -1)" | docker compose exec -T db psql -U inch -d restore_check -q
docker compose exec -T db psql -U inch -d restore_check -c 'SELECT count(*) AS users FROM users'
# 确认数字对得上，再删掉
docker compose exec -T db psql -U inch -d postgres -c 'DROP DATABASE restore_check'
```

真正的灾难恢复（覆盖线上库，**会丢掉备份之后的新数据**）：

```bash
zcat /opt/backups/inch-2026-11-19-0400.sql.gz | docker compose exec -T db psql -U inch -d inch
```

> **备份和工作数据库在同一台机器的同一块盘上。** 机器或磁盘挂掉时，备份一起没了。至少每周把 `/opt/backups` 里最新那份拉到本地电脑（`scp ubuntu@IP:/opt/backups/inch-*.sql.gz .`）；想自动化就接腾讯云 COS，用 `coscli` 或 `rclone` 同步到对象存储。

### 证书

Caddy 自动申请、自动续期，90 天到期前会自己换，**不用你管**。证书存在 `caddy_data` 卷里，别手动删这个卷。

---

## 10. 这套部署做了什么（给想懂原理的你）

```
          浏览器
            │  https://你的域名
            ▼
   ┌─────────────────────┐
   │ web (Caddy) :80/:443│  ← 自动 HTTPS 证书
   │  ├ /           静态  │  ← 前端 dist（Vue 打包产物）
   │  └ /api/* 反向代理   │
   └─────────┬───────────┘
             ▼
   ┌─────────────────────┐
   │ api (Fastify) :3000 │  ← 只在 Docker 内网，不对公网开放
   └─────────┬───────────┘
             ▼
   ┌─────────────────────┐
   │ db (PostgreSQL)     │  ← 数据在 pgdata 卷里
   └─────────────────────┘
```

几个关键设计原因：

- **前端和后端同一个域名**。你的鉴权用 `__Host-session` Cookie + `Origin` 白名单校验，跨域部署会导致 Cookie 不发送、POST 全部 403。
- **必须 HTTPS**。`__Host-` 前缀的 Cookie 强制要求 `Secure` 属性，走 http 浏览器会直接丢掉登录态。
- **API 不暴露端口**。只有 Caddy 能访问 `api:3000`，外网扫不到。
- **`flush_interval -1`**。Caddy 默认会缓冲响应，不关掉的话 SSE 的心跳和消息会被攒在缓冲区里，实时推送看起来就是坏的。
- **`TRUST_PROXY=true`**。反代之后真实 IP 在 `X-Forwarded-For` 里，不打开这个开关，所有访客会共享同一个 IP，注册/登录的限流会互相顶掉。这是本次为上线新增的改动。
- **单实例**。在线人数、SSE 连接、限流计数都在进程内存里，所以只能跑 1 个 api 容器，不要横向扩容。

---

## 11. 常见问题

**Q：用香港服务器，到底要不要备案？**
不需要 ICP 备案。备案只对**中国大陆境内**的服务器生效；境外（含香港）服务器无需备案，[阿里云备案文档](https://help.aliyun.com/zh/icp-filing/basic-icp-service/product-overview/icp-filing-requirements-for-a-regular-website)明确写着「托管于非中国内地服务器的网站无需进行 ICP 备案」。账号实名、域名实名照做，但那是实名不是备案。

**Q：国内访问会不会被墙、要不要梯子？**
不需要梯子，香港是直连的。华南通常 20~50ms，华东 40~70ms，华北 60~90ms。体感比国内服务器慢一点，比开 VPN 快得多。风险点在**跨境出口带宽**：晚高峰可能丢包抖动，移动网络用户体验最差。另外，未备案域名在微信里被分享时可能被风控拦截（提示无法访问），公众号/小程序的服务端域名也要求已备案——如果推广依赖微信传播，要提前知道这个限制。

**Q：部署脚本卡在「等待 HTTPS 证书签发」最后失败**
按顺序查：① 域名 A 记录是否已生效（`nslookup` 对比服务器 IP）；② 云厂商**安全组**是否放通 80/443（轻量服务器有独立的「防火墙」页，别只改本机 ufw）；③ 是否在 80/443 上还跑着别的服务（`ss -lntp | grep -E ':80|:443'`）。Caddy 失败原因看 `docker compose logs web`。

**Q：`docker compose build` 拉镜像超时**
大陆/香港机器拉 Docker Hub 经常不稳。给 Docker 配镜像加速器，地址用你云厂商控制台「容器镜像服务 → 镜像加速器」给的那个：

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://你的加速器地址.mirror.aliyuncs.com"] }
EOF
systemctl restart docker
```

**Q：构建到一半报 `Killed` 或 `signal: killed`**
内存不足。确认 `setup-ubuntu.sh` 里的 2G swap 生效了：`free -h` 看 Swap 一行。还不够就把 swap 加到 4G。

**Q：能打开首页但登录报「请求来源不被允许」**
`.env` 里的 `SITE_DOMAIN` 和浏览器地址栏的域名不一致（比如多了 `www`）。改 `.env` 后 `docker compose up -d` 重建 api 容器。

**Q：我想换域名**
改 `.env` 里的 `SITE_DOMAIN` → `docker compose up -d`。Caddy 会自动为新域名申请证书，旧证书留在卷里不影响。

**Q：数据存在哪？会不会重建镜像就没了**
数据库数据在 Docker 卷 `inch_pgdata` 里，`docker compose down` 不会删，`docker compose down -v` **会删**。别用 `-v`。

**Q：本地开发还能照旧吗**
能。这些文件只在部署时用；本地还是 `npm run db:start` + `npm run migrate` + `npm start` + `npm run dev`。

---

## 附：本次为上线做的代码改动

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `backend/src/config.ts` | 新增 `trustProxy`（默认在生产环境开启，可用 `TRUST_PROXY` 覆盖） | 反代后取真实客户端 IP，否则限流互相干扰 |
| `backend/src/app.ts` | `buildApp` 接收 `trustProxy` 并传给 Fastify | 同上 |
| `backend/src/server.ts` | 传入 `config.trustProxy` | 同上 |
| `Dockerfile` | 新增，多阶段构建 api / web 两个镜像 | 一键构建 |
| `docker-compose.yml` | 新增，编排 db / api / web | 一键启动 |
| `Caddyfile` | 新增，自动 HTTPS + SPA 回退 + SSE 不缓冲 | 单域名同源部署 |
| `deploy.sh` / `setup-ubuntu.sh` | 新增 | 服务器初始化与一键部署 |
| `.dockerignore` / `.env.production.example` | 新增 | 防止 `.env` 打进镜像 |
