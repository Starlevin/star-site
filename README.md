# 清寒 · 星夜手记

以星夜、银发少女与紫色为灵感的个人网站。适配手机和电脑，使用原生 HTML、CSS 和 JavaScript，无需安装依赖或构建。

## 内容

- 个人介绍与兴趣
- 校队网站、Elaina Focus、本地阅读器与单词学习助手的项目展示
- 数学二、电路与代码学习方向
- 项目筛选、详情弹窗、手机导航

项目状态与描述采用“探索中 / 建设中”的表述，不宣称计划功能已经上线。不包含电话、邮箱、求职安排、个人成绩或账户信息。

## 发布到 GitHub Pages

打开 https://github.com/Starlevin/star-site/settings/pages

在 Build and deployment 中设置：
1. Source：Deploy from a branch
2. Branch：main
3. Folder：/ (root)
4. 点击 Save

部署完成后地址为 https://starlevin.github.io/star-site/ 。地址在部署完成前可能返回 404，可在仓库 Actions 页面查看部署任务。

## 编辑

- `index.html`：页面结构、介绍与卡片内容
- `style.css`：主题、排版与响应式样式
- `script.js`：项目与学习详情、筛选和手机导航
- `favicon.svg`：星光图标

首页插画为原创内嵌 SVG，不依赖外部图片链接。字体可选加载 Google Fonts；无法访问时自动使用设备本地字体。其余页面功能无第三方运行时依赖。

## 本地查看

在项目目录运行 `python -m http.server 8000`，然后打开 http://localhost:8000 。

## 说明

本网站为静态展示，不收集访客资料，不提供用户账户、云端存储或自动同步聊天记录。
