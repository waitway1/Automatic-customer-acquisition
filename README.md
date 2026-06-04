# 客户增长控制台

启动：

```powershell
cd E:\celeste
.\start.ps1
```

也可以直接双击：

```text
E:\celeste\Start-Customer-Console.bat
```

浏览器打开：

```text
http://127.0.0.1:8765
```

## 已实现

- 启动网页后自动刷新五个类别客户数量：Ranger T9、BYD Shark 6、VW Amarok、Santa Fe、Jetour T2/G700。
- `ranegrt9` 和 `ranger t9` 都写入 `C:\1\Chrome\work\excel\ranger\ranger.xlsx`。
- `每日获客` 按钮：每个车型目标新增 10 个客户，写入对应 Excel；写入前按邮箱和主域名去重，并生成备份。
- `发送邮件` 按钮：选择车型和数量后调用 `C:\1\Chrome\portable-product-email-outreach-skill` 的发送脚本。
- 邮件监控：可轮询 IMAP，发现退信后移动到 `邮箱失效` sheet，并触发同车型重发 1 封；同一退信邮箱只重发一次。
- 感兴趣客户：按关键词识别回复，写入 `runtime/intervention.json` 并显示在“需要我介入”模块。

## 必须配置

真实发送前先检查：

- `C:\1\Chrome\portable-product-email-outreach-skill\sender_profiles.local.json`
- `config.json` 里的 `sender_profile`
- `config.json` 里的 `retry_sender_profile`。留空时退信重发继续使用 `sender_profile`；如果要“换邮件重发”，这里填另一个 sender profile 名称。
- `config.json` 里的 `mail_monitor.imap_host / imap_user / imap_password`
- `config.json` 里的产品图片路径。当前默认不带产品图；如果发送脚本要求图片，需要在生成的车型配置或 `app.py` 里加入真实图片。

## 注意

- 获客依赖 AnySearch：`python C:/Users/Administrator/.codex/skills/anysearch/scripts/anysearch_cli.py`。
- BYD Shark 6 默认排除澳大利亚客户。
- 发信是对外真实动作，点击按钮后会直接执行当前配置。
