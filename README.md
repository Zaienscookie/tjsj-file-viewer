# 社团内部软件 (st.zain-dev.top)

Cloudflare Worker 单文件应用：**文档浏览 + 备忘录 + 便利贴 + 课表（多班级）**

## 功能
| Tab | 功能 | 数据源 |
|---|---|---|
| 📂 文档 | 树状浏览 tjsj-document-together 私有仓库，md/pdf/docx/xlsx 在线预览 + 下载 | GitHub API (GH_TOKEN) |
| 📝 备忘录 | 增删列表 | CF KV `memos` |
| 📌 便利贴 | 彩色便签墙，增删 | CF KV `notes` |
| 📅 课表 | 多班级课表，格子编辑保存 | CF KV `scheds` |

## 部署
1. CF 面板 → 创建 Worker → 粘贴 `_worker.js` → 部署
2. **设置 → 绑定 → KV Namespace**（创建三个）：`memos` / `notes` / `scheds`
3. **设置 → 变量 → Secret**：`GH_TOKEN` = GitHub token（读 tjsj-document-together 权限）
4. **设置 → 自定义域** → `st.zain-dev.top`
5. 建议：Cloudflare Access 登录保护（社团内部用，免费 50 人）

## 安全
- 私有仓库内容只经 Worker 中转，token 在 Secret 不外泄
- 建议加 Access 保护防止外部访问
