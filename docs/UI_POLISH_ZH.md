# 工作台体验与平台文档更新

本次更新移除标题旁的装饰图形，保留 DTCC 标识与完整项目标题。

## 使用方式

- 桌面窗口宽度至少 851px、高度至少 680px 时，工作区适配窗口高度。代码和结果分别滚动，运行、筛选与导出入口保持可见。
- `Focus` 隐藏标题区和页脚，扩大审计区域；`Restore` 恢复。较矮窗口和手机采用自然页面滚动，避免压缩或遮挡控件。
- `Report details` 改为弹窗，不再展开后撑长页面。支持关闭按钮、Esc 及焦点返回。
- 手机上的证据行号会滚动至对应源码；仅展开发现项不会把页面拉走。
- `Documentation` 打开同站点四页 PDF；`Analysis method` 打开方法说明；`Local setup` 与 API 连接说明打开站内帮助页。GitHub 按钮用于访问源码。

## 文档

PDF 使用 DTCC 标识、深绿与白色配色、嵌入字体和统一表格。内容依据已有 PPT 和实际代码设计，咨询案例仅用于参考排版。四页内容为背景、功能、风险覆盖、证据与报告，不含项目进展或时间表。

## 补丁包

`DTCC_UI_Polish_v2.zip` 包含增量补丁、从原始 M0 开始的累计补丁，以及自动选择补丁的 `apply.sh`。

在仓库根目录运行 `bash /path/to/DTCC_UI_Polish_v2/apply.sh`。脚本首先完整检查补丁是否匹配；适配原始 M0 和上一版 Workspace Redesign。已经应用则不重复修改。不匹配时停止，不强制覆盖。

应用后运行：

```bash
bash scripts/setup.sh
bash scripts/check.sh
npm --prefix apps/web run dev
```

静态分析仍无需 API。Bedrock 仍为本地后端单模型分析；本次更新不改变该边界。
