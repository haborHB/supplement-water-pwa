# 补剂与饮水 PWA

这是一个本地优先的手机网页应用，用于记录每日补剂和饮水量。

## 当前功能

- IndexedDB 本地保存补剂档案、成分版本、服用记录和饮水记录
- 今日饮水总量、目标值、剩余量和快捷记录
- 每个补剂的详细档案页面
- 每单位有效成分记录
- 粘贴文本后自动识别并填入成分名称、含量和单位
- 补剂服用历史
- 最近 7 天统计
- 导出本周 JSON 和全部备份
- 导入“全部备份” JSON
- Service Worker 离线缓存
- Android 主屏幕安装入口

## 本地预览

在此文件夹启动静态服务器：

```powershell
python -m http.server 4173
```

然后在电脑打开：

```text
http://localhost:4173
```

PWA 的 Service Worker 在 `localhost` 下可以进行本地测试。手机安装版本需要使用 HTTPS 地址。

## HTTPS 部署

把整个文件夹作为静态网站发布到一个支持 HTTPS 的静态托管服务，访问根目录即可。部署时必须保留以下文件在同一目录：

```text
index.html
styles.css
app.js
sw.js
manifest.webmanifest
icon.svg
```

网页代码可以放在静态托管服务上，但本版本没有后端数据库，记录保存在当前手机浏览器的 IndexedDB 中。请保持部署域名稳定，并定期使用应用内的“导出全部备份”。

## GitHub Pages

可以把本目录内容直接放入一个新的 GitHub 仓库根目录。建议仓库名使用 `supplement-water-pwa`，然后在仓库的 Settings > Pages 中选择：

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

这个项目不需要构建步骤。不要把应用导出的补剂和饮水 JSON 备份放进仓库；项目里的 `.gitignore` 已经忽略常见的备份文件名。

## 每周总结

在“历史”页面点击“导出本周 JSON”，将文件上传到聊天中即可进行统计。文件包含本周饮水记录、服用记录、补剂档案和有效成分版本。

“导出全部备份”生成的文件可以在设置页面恢复；本周 JSON 是统计文件，不会被允许覆盖本地全部数据。

## 2026.10.25.1 修复

修正隐藏字段 `name="id"` 覆盖 `form.id` 导致保存事件被跳过的问题。档案和成分版本在同一个 IndexedDB 事务提交成功后才更新界面；保存失败时保留表单并显示错误，连续点击不会重复建档。

离线缓存更新为 `v2-save-fix`，更新应用代码不删除 IndexedDB 数据。首次收到本次更新时，请联网打开页面，关闭该页面后重新打开；在“设置”中确认版本为 `2026.10.25.1`。之后的更新会显示刷新提示。

## 回归检查

```powershell
npm ci
npm test
```

测试使用 jsdom 与 fake-indexeddb 验证新建、编辑、重新载入、重复提交和事务失败重试，并检查 Service Worker 的更新与离线策略。表单命名属性覆盖通过测试适配模拟；这些检查不替代 Android 实机验证。

也可以运行 `node tests/serve.cjs`，在桌面浏览器打开 `http://127.0.0.1:4181/tests/regression.html` 执行浏览器端表单测试。每次使用单独命名的测试数据库，不读取现有记录。
