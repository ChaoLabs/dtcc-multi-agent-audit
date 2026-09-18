# 首次运行与本地验收

## 本地运行

需要 Node.js 24 LTS（也支持 Node 22.14+）和 Git。网页的静态检测与 Bedrock API 分析都由 Next.js 应用提供，不需要另开 Python 后端。

首次下载仓库：

```bash
git clone https://github.com/ChaoLabs/dtcc-multi-agent-audit.git
cd dtcc-multi-agent-audit
npm ci --prefix apps/web
npm --prefix apps/web run dev
```

已有项目时，在现有目录直接启动 `npm --prefix apps/web run dev`。打开 `http://127.0.0.1:3000`；终端保持运行，结束时按 Ctrl+C。

## 网页内连接 Bedrock

1. 选择 **API analysis**。
2. 粘贴完整有效的 Bedrock API Key，不含 `export` 命令或引号。
3. 点击 **Use API key**，然后点击 **Run API analysis**。
4. 默认调用 GPT-6 Astra，区域 `us-east-1`，模型 ID `us.openai.gpt-6-astra`。账户需要有该模型的调用权限。
5. Key 仅保留在当前标签页内存及当前服务端请求中。刷新页面或点击 **Clear key** 后需要重新输入。应用不会写入浏览器存储、Cookie、日志或仓库。

添加 Key 只验证格式，成功返回模型分析才说明 AWS 调用成功。分析时 Key 与源码经本站服务端发往 AWS；模型费用归 Key 所属 AWS 账户，Vercel 运行费用归部署账户。不要分享包含 Key 或请求正文的截图。

## 功能验收

- 不输入 Key，运行静态检测，检查源码、候选项和 JSON/Markdown 导出。
- 输入 Key 后运行 API 分析，确认 GPT-6 Astra 的模型信息和独立模型结果。
- Key 过期或没有权限时，应保留静态结果并明确报错。
- 修改源码、更换案例或取消分析后，旧请求不能覆盖新内容。
- 点击 Clear key 或刷新页面，确认不会自动恢复凭据。
- 打开 Documentation PDF 和 Connection guide，确认同站点链接与移动端布局。

## 开发检查

完整测试另外需要 Python 3.12–3.14：

```bash
bash scripts/setup.sh
bash scripts/check.sh
cd apps/web
npx playwright install chromium
npm run test:e2e
```

浏览器测试会自行启动 Next.js 和用于规则对照的 Python 服务；运行前先停止手动启动的项目服务。真实 Bedrock 调用不包含在自动化测试中。

## Vercel

在 Vercel 导入仓库，Root Directory 选择 `apps/web`，Framework 选择 Next.js，Node.js 选择 24.x。安装 `npm ci`，构建 `npm run build`，输出目录保留默认，并启用 Fluid compute。

无需配置共享 AWS Key。部署后，访客打开链接即可运行静态检测，并可在网页输入自己的有效 Bedrock Key 运行 API 分析。访客不需要终端。详细设置见 `docs/DEPLOYMENT.md`。

补丁只更新本地代码；GitHub 推送和 Vercel 部署在本地验收后进行。不要把下载的补丁文件、Key 或个人配置加入提交。
