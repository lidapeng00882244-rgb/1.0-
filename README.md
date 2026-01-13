# 留学生求职案例生成器 1.0（部署版）

这是一个用于在 GitHub + Zeabur 部署的精简版本，只包含运行所需的核心文件。

## 目录结构

- `server.js`：Node.js 后端服务入口
- `package.json`：依赖与启动脚本
- `config.sample.json`：配置模板（不包含真实 API Key）
- `2.0案例生成器/index.html`：前端页面（单文件版）
- `.gitignore`：忽略 `node_modules`、运行时生成的 `cases` 目录、本地 `config.json` 等敏感/大文件

> 注意：**不要**把包含真实通义千问 API Key 的 `config.json` 提交到 GitHub。

## 本地运行

```bash
npm install
cp config.sample.json config.json  # Windows 下可手动复制一份并改名
# 编辑 config.json，填入你的通义千问 API Key，或使用环境变量 DASHSCOPE_API_KEY
npm start
```

启动后，在浏览器访问：

- `http://localhost:5000` – 前端页面
- `http://localhost:5000/health` – 健康检查

## 在 Zeabur 部署

1. 将本目录作为一个独立仓库推送到 GitHub。
2. 在 Zeabur 选择「从 GitHub 导入项目」，选择该仓库。
3. 配置：
   - **Build / Install Command**：`npm install`
   - **Start Command**：`npm start`
   - **Port**：`5000`（或保持默认，Zeabur 会自动注入 `PORT` 环境变量）
4. 在 Zeabur 的环境变量中添加：
   - `DASHSCOPE_API_KEY`：你的通义千问密钥
5. 部署完成后，Zeabur 分配的域名（例如 `https://your-app.zeabur.app`）就是访问地址。

前端会自动使用当前域名作为后端地址，无需修改代码。

