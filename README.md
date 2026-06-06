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
- `发送邮件` 按钮：选择车型、数量和发件邮箱后调用项目内 `outreach_package` 发送脚本。
- 邮件监控：自动轮询 3 个 IMAP 邮箱，发现退信后用备用邮箱重发一次；备用发送失败才计入“今日失效”。
- 感兴趣客户：按关键词识别回复，写入 `runtime/intervention.json` 并显示在“需要我介入”模块。

## 必须配置

真实发送前先检查：

- `E:\celeste\outreach_package\sender_profiles.local.json`
- `config.json` 里的 `sender_profile`
- `config.json` 里的 `retry_sender_profile`。留空时退信重发继续使用 `sender_profile`；如果要“换邮件重发”，这里填另一个 sender profile 名称。
- `config.local.json` 里的 3 个邮箱 IMAP 授权信息和 AnySearch key。
- `outreach_assets\email_images` 里的产品图片。

## 注意

- 获客优先使用项目内 AnySearch：`python tools/anysearch/scripts/anysearch_cli.py`，额度耗尽后自动切换备用搜索。
- 除 Excel 表格外，运行需要的站点、发送脚本、查找脚本、模板、图片和本机 Python 运行环境都在 `E:\celeste` 内。
- `python\` 目录体积较大，不提交到 GitHub；换新电脑时请复制整个 `E:\celeste` 文件夹。
- 获客排除规则：所有车型不采集中国客户；VW Amarok 不采集英国客户；BYD Shark 6 不采集澳大利亚客户。
- 发信是对外真实动作，点击按钮后会直接执行当前配置。
