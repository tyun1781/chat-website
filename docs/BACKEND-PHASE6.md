# 后端第六阶段：论坛标签

日期：2026-11-18（Asia/Shanghai）。后端 `http://127.0.0.1:3000` 保持运行。

## 已完成

每个公开帖子保存一个服务端验证的标签。固定目录为 daily 日常、anime 动漫、games 游戏、music 音乐、share 分享。“全部”是前端过滤器，不写入数据库。

- `GET /api/tags` 返回 `{data:[{id,label},...]}`，仅列出5个实际标签。
- `POST /api/messages` 接受可选tag；缺省daily，旧客户端可以继续只发送body。
- `GET /api/messages?tag=anime` 在数据库中过滤，保持原有稳定键集分页；不传tag返回全部。
- 所有公开 Message 响应与 message.created 事件增加tag字段。
- 同幂等键必须对应相同正文和标签；省略tag与显式daily等价，同键变更标签返回409。

接口字段及公共事件处理要求已与前端确认，并增补到 API-CONTRACT.md 顶部。

## 数据迁移与兼容

真实开发数据库已应用 `003_message_tags.sql`：messages新增非空tag列、默认daily及固定目录约束；增加按tag和创建时间/ID的未删除帖子分页索引。现有帖子，包括已软删除的历史记录，自动归入daily。

历史 message.created 事件的 message 对象补充对应tag，事件ID和顺序保持不变。幂等正文摘要不改写，通过原记录标签额外验证，保留旧客户端重放兼容。升级期间短暂停止旧后端，迁移后重新启动，避免旧进程生成缺少tag的新事件。

公共流仍发送全部公开帖子/评论事件，公共水位不因筛选改变。前端必须处理所有事件ID，只将匹配所选标签的新增帖子展示出来；切换标签需重置分页。评论仍按帖子ID查询；私聊表、接口和独立事件流未修改，不参与公开标签筛选。

## 必要验证

专项测试继续暂停，仅执行类型、构建及必要真实联通：

- `npm run typecheck`、`npm run build` 通过。
- 003迁移真实成功，`/api/ready` 返回200。
- 标签目录准确返回5项，未知标签all返回400。
- 旧式POST只传body仍创建daily帖子；同键显式daily重放200，同键换anime返回409。
- anime筛选每页1条，连续两页不同帖子且标签正确；daily筛选返回值均为daily。
- 实际SSE创建事件包含正确daily/anime标签。
- 数据库确认历史 message.created 事件没有缺失tag。
- 带标签帖子下评论发布、查询和作者删除正常。
- 本轮自检公开帖子及评论已软删除，会话已退出。

后端已通知前端接口就绪。未运行完整专项测试、未修改前端或测试文件、未提交或推送GitHub。

## 本地启动

在 backend 目录使用现有数据库配置：

```powershell
npm run migrate
npm run build
npm start
```

若项目数据库未运行，先在独立终端执行 `npm run db:start`。本阶段目录只读，不提供自定义标签、修改已发布帖子标签或标签管理后台。
