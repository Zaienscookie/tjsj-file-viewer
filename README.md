# TJSJ 文档库 - 在线文件浏览器

Cloudflare Worker：私有 GitHub 仓库（tjsj-document-together）的在线文件浏览器。

## 功能
- 📂 树状目录 + 文件列表
- 📄 在线预览：md / pdf / 图片 / **docx** / **xlsx** / txt / csv
- ⬇ 一键下载（含 GitHub 不支持预览的文件）
- 🔒 私有仓库通过 Secret 读取，token 不外泄

## 部署
1. CF 面板 → Workers & Pages → 创建 Worker → 粘贴 `_worker.js` 内容 → 部署
2. 设置 → 变量和机密 → Secret: `GH_TOKEN` = GitHub token（有 tjsj 私有仓库读权限）
3. 设置 → 自定义域（可选）如 `tjsj.zain-dev.top`
4. 访问即可浏览

## 安全建议
- 文档保密 → 用 Cloudflare Access 给 Worker 加登录保护（免费 50 人）
