# 工作区重设计：应用与验收

本补丁 **DTCC_M0_Workspace_Redesign.patch** 直接基于已安装的 `DTCC_M0_Initialization.patch`。它替代尚未应用的 `DTCC_M0_UI_Refinement.patch`，不要叠加应用上一份界面补丁。

## 更新

先在运行前端和 API 的终端分别按 Ctrl+C。将补丁下载到 Downloads 后执行：

```bash
cd ~/dtcc-multi-agent-audit &&
git apply --check "$HOME/Downloads/DTCC_M0_Workspace_Redesign.patch" &&
git apply "$HOME/Downloads/DTCC_M0_Workspace_Redesign.patch" &&
bash scripts/setup.sh &&
bash scripts/check.sh &&
npm --prefix apps/web run dev
```

本次新增本地字体包，并将 HTTPX 列为 API 运行依赖，所以需要执行 setup。安装不会配置或调用 AWS。若补丁检查失败，请停止并反馈；不要使用强制覆盖。浏览器下载自动改名时，请替换为实际文件名。

打开 http://127.0.0.1:3000。静态检测现在完全在浏览器执行，不需要另开 Python API。

## 两种分析模式

- **Static analysis**：直接贴入、编辑或上传 Solidity，点击 Run static analysis。Vercel 公开版本也可以使用；不需要凭据或后端。
- **API analysis**：先运行下方命令，按终端提示输入区域、协议、模型 ID 和隐藏的 Bedrock Key，再在页面点 Check connection、关闭设置窗口并点击 Run API analysis。

```bash
cd ~/dtcc-multi-agent-audit
.venv/bin/python scripts/start_api.py --bedrock
```

默认 `converse` 对应 Bedrock Runtime；暑期项目的 `mantle` 配置仍被支持。暑期归档使用 `us-east-1` / `anthropic.claude-haiku-4-5`，现有账号是否仍获准使用需真实调用确认。两种协议的模型 ID 不能随意混用。详见 `docs/BEDROCK.md`。

凭据仅保存在当前 API 进程中，不写进代码或浏览器。Check connection 只检查后端配置，不能证明 AWS 已授权；真实调用完成才代表连通成功。公开 Vercel 版本的 API 模式提供本地配置入口，不开放共享付费接口。

## 验收

1. 查看 Logo、完整项目标题和桌面／窄窗口排版。
2. 切换五个参考案例；检查严重程度筛选、搜索与证据定位。
3. 修改源码，确认旧结果和导出立即失效；重新检测后下载 JSON / Markdown。
4. 上传 .sol 文件、新建合约、复制源码，确认操作可用。
5. 可选：配置 Bedrock 后运行 API 分析。模型结果与静态结果分开保留；报错不会显示伪造的模型报告。

真实 AWS 调用未在本轮测试环境中执行。自动测试覆盖两种协议的模拟响应、错误和证据校验；不代表模型可用性或审计准确率已经验证。多模型和编排代理仍是后续学期工作。

本补丁不自动提交、推送或部署。先反馈本地界面效果，再继续 GitHub / Vercel 发布。
