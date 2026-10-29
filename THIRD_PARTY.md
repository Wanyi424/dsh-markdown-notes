# 第三方内容与许可

项目代码使用 MIT 许可证。以下第三方内容保留自己的许可，不因包含在本仓库中而改变许可。

## 内置示例文档

`src/assets/sample.md` 改编自 [doocs/md 的中文示例](https://github.com/doocs/md/blob/main/apps/web/src/assets/example/markdown.zh-CN.md)。本项目保留示例主体，移除了“推荐阅读”及之后的文章链接、分隔线和二维码，删改了只适用于原编辑器或微信公众号的功能说明，并将“链接与图片”中的主页与图片替换为维护者主页及本项目宣传图，表格示例中的联系人换为本项目作者。

- 上游：<https://github.com/doocs/md>
- 作者：Doocs
- 上游许可：WTFPL Version 2，Copyright (C) 2025 Doocs
- 许可副本：[licenses/doocs-WTFPL.txt](licenses/doocs-WTFPL.txt)

文档中提及的第三方品牌和外链属于各自权利人。源码中的链接不表示与相关组织存在合作。

`docs/images/plugin-banner.png` 是为本项目生成的宣传图，遵循本项目的 MIT 许可。

## 图标与字体

- UI 图标来自 [Lucide](https://github.com/lucide-icons/lucide)，使用 ISC 许可。
- 默认信息图的四个图标来自 [Material Design Icons / Pictogrammers](https://github.com/Templarian/MaterialDesign)，使用 Apache-2.0 许可。参见 [上游许可声明](licenses/mdi-NOTICE.txt)和 [Apache-2.0 全文](licenses/Apache-2.0.txt)。
- 数学排版的样式和字体来自 [KaTeX](https://github.com/KaTeX/KaTeX)，遵循其上游许可。

## 构建依赖

构建脚本会依据实际打包模块，汇总上游许可证至 `lib/THIRD_PARTY_NOTICES.txt`，该文件随 Release 安装包分发。依赖的精确版本记录在 `package-lock.json`。

## 截图与品牌

`docs/images/` 中的截图由项目维护者提供，展示插件在 DeepSeek Harness 桌面端的实际运行效果。DeepSeek、DeepSeek Harness 的名称、标识及宿主界面属于其权利人，本项目是独立社区插件。
