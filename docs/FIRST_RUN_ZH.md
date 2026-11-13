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

1. 选择参考案例、点击 **Upload contract** 上传合约，或在 **Edit source** 中粘贴代码，再选择 **Bedrock Review**。
2. 粘贴完整有效的 Bedrock API Key，不含 `export` 命令或引号。
3. 点击 **Use API key**，再点击 **Run Bedrock Review**。完成后先查看 **Findings**，不会自动进入第二轮。
4. 打开 **Second Review**，检查分配的复核任务，再点击 **Run Second Review**。收到有效的第二轮报告后点击 **View Final Report** 直接打开最终报告；部分有效结果也可进入最终报告。若没有可执行的复核任务，页面会说明原因。取消或请求失败不会被算作已完成第二轮，初轮结果和导出仍保留。区域为 `us-east-1`，三个固定模型为 GPT-6 Astra、Claude Opus 5.5 和 Grok 4.7，账户须具备对应调用权限。若此前用 Fable 5.2 运行过，请重新发起初轮分析。旧报告保留原模型身份，不能在同一报告里换人投票。

要测试 Muxiang 提供的合约，在 **Reference cases** 中选 **DAO Treasury**，然后运行 **Static Analysis** 或 **Bedrock Review**。只有出现可复核的分歧时才运行 **Second Review**，最后查看 **Final Report**。零条发现是有效结果，不代表没有风险；这个补充案例不计入原有五例基准。
5. Key 仅保留在当前标签页内存及当前服务端请求中。刷新页面或点击 **Clear key** 后需要重新输入。应用不会写入浏览器存储、Cookie、日志或仓库。

若显示 Response too long，新版本会在明确收到输出上限信号时，仅对该模型尝试一次扩容：32,768 → 65,536 tokens。它仍受三次总尝试和本轮时限约束；缺失结果不会计票。

添加 Key 只验证格式，成功返回模型分析才说明 AWS 调用成功。分析时 Key 与源码经本站服务端发往 AWS；模型费用归 Key 所属 AWS 账户，Vercel 运行费用归部署账户。不要分享包含 Key 或请求正文的截图。

## 功能验收

- 不输入 Key，点击 **Static Analysis → Run Static Analysis**，检查源码、候选项和 JSON/Markdown 导出。
- 输入 Key 后点击 **Run Bedrock Review**，确认先显示初轮 Findings，再手动执行 Second Review，最后查看 Final Report。
- 最终报告先看风险概览、风险解释和建议处理方式；需要追溯时再展开模型判断与源码证据。第二轮未完成时，已接受的首轮判断和严重程度仍保留，并明确标注待复核；不会把旧判断计成新回答。
- 区分“分配的复核任务完成”和“三模型覆盖完整”。两份初次结果加两份复核结果，整体仍只有 2/3 模型覆盖。
- 若显示内容过滤或 guardrail 阻止，保留其他结果并按提示联系 AWS 管理员确认允许的使用场景。刷新、更换 Key 或延长超时不保证解决；应用不会重写输入或重复请求来绕过过滤。
- Key 过期或没有权限时，应保留静态结果并明确报错。
- 修改源码、更换案例或取消分析后，旧请求不能覆盖新内容。
- 点击 Clear key 或刷新页面，确认不会自动恢复凭据。
- 打开 Documentation 的八页平台说明、三页编排设计及 Connection guide；文件标题和正文不显示日期。
- 通过 **Review settings → Validate 5 cases** 做五合约验证。批量验证有独立的复核开关及调用上限，与工作区的手动第二轮操作独立，必须明确启动批量验证。

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
