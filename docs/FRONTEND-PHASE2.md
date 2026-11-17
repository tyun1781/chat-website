# 前端第二阶段

## 范围

Vue 3 + TypeScript + Vite。已实现入场、注册、登录、刷新恢复会话、退出、修改昵称与修改密码。账号请求通过真实 `/api` 接口；注册成功后须登录，改密成功清空会话并返回登录。

留言仅为空状态与临时草稿布局；发布按钮禁用，明确标注尚未开放、草稿刷新会清空。没有模拟留言、虚假发布结果、管理后台或 SSE 订阅。

## 设计方向

按用户指定的 frontend-design 指导，先规划再构建。主题为“街角留言窗”：公开留言像一张向路人敞开的纸签。记忆点集中在大号中文标题与纸签形状，其余页面保持安静。

设计 token：雾蓝 `#edf3fa`（背景）、深海蓝 `#173250`（文字）、钴蓝 `#264fe5`（动作）、柠檬黄 `#f2ed91`（欢迎纸签）、白色 `#ffffff`（编辑区域）、灰蓝 `#52677f`（说明）。字体以 Noto Sans SC 为首选，通过 Google Fonts 加载，失败自动回落 Microsoft YaHei 与系统 sans-serif。标题 900 字重，正文 400；正文行长由双栏宽度约束。

布局比较：普通等宽卡片阵列不能表达公共交流，最终使用不对称的留言区＋编辑纸签。所有正文左对齐，空状态居中，移动端改单列。入场采用全屏蓝底与黄色纸签，一次会话只出现一次；点击任意处或 Enter 进入，700ms 淡出上移，reduced-motion 下直接切换。

```text
桌面：标志                         账号入口
      大标题                  欢迎纸签
      大家的留言（宽）     临时编辑区（窄）
手机：标志  账号入口
      标题与纸签
      大家的留言
      临时编辑区
```

自审修改：手机初版标题被纸签挤成两行，已缩减手机标题与纸签尺寸，390px 下单行且无横向溢出。避免装饰性渐变、卡片阵列和独立 section 进场动画。

## 启动

在 `frontend` 目录运行：

```powershell
npm install
npm run dev
```

地址 `http://127.0.0.1:5173`。端口固定，避免自动换端口导致 Origin 白名单不匹配。默认代理 `/api` 到 `http://127.0.0.1:3000`，保留浏览器 Origin。后端需要允许前端 Origin。可复制 `.env.example` 为 `.env` 设置 `API_PROXY_TARGET`，修改后重启。

`npm run build` 执行 TypeScript 检查并构建到 `dist`；`npm run typecheck` 可单独检查。生产环境需由同源反向代理转发 `/api` 到后端，静态服务器提供 `dist`；`vite preview` 仅供产物预览，不配置开发代理。

## 接口与安全

- 会话 cookie 由浏览器处理，CSRF token 只保存在内存，不写入 localStorage。
- 写请求携带 `X-CSRF-Token`；遇 CSRF_INVALID 恢复 session 后仅重试一次，兼容多标签页轮换。
- 请求设 15 秒超时，显示可操作错误；401 失效/账号禁用清空本地身份，并保留当前页草稿。
- 成功提示仅来自真实成功响应；服务未启动时显示连接失败并可重试，不伪装登录。
- 原生 dialog 提供焦点约束、Escape 关闭、可访问标题；处理中防止重复提交；页面正文及昵称使用 Vue 文本插值。
- 入场期间主页面 inert；回车进入后焦点移到主标题；具有可见焦点及 reduced-motion 支持。

## 验证

- `npm run build`：通过（包含 vue-tsc）。
- `npm audit`：0 vulnerabilities（升级 vue-tsc 到 3.3.14 后）。
- agent-browser 独立会话 frontend-phase2：Enter 进入、390×844 / 1440×1000 页面截图、注册 dialog 字段和语义检查通过；无浏览器脚本错误。
- 390px 屏幕下 documentElement.scrollWidth 不大于 innerWidth。
- 视觉检查图片位于 `frontend/artifacts/`（已 gitignore）。
- 实际账号端到端及更完整边界验收由测试 agent 记录到 `docs/TEST-PHASE2.md`，不要将本页视觉检查当作完整验收。

## 待办

留言真实查询、发布、删除与 SSE 同步；管理后台；邮箱验证与找回密码；生产部署与邮件接入。完整留言上线时替换临时草稿区域，并按契约实现幂等提交、分页合并和事件去重。
