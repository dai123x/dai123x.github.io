# 🌐 戴璇 · 个人数字门户 (daixuan.cloud)

> 现代轻量化响应式个人主页 · 3D 图形交互与自媒体创作者作品集  
> 专为 **GitHub Pages** 打造，内置自定义域名 `daixuan.cloud` 解析支持与 GitHub Actions 自动化部署。

[![GitHub Pages](https://img.shields.io/badge/Deployment-GitHub%20Pages-blue?logo=github)](https://daixuan.cloud)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](#)
[![Pure Vanilla](https://img.shields.io/badge/Stack-HTML5%20%7C%20CSS3%20%7C%20VanillaJS-orange)](#)

---

## ✨ 核心特性

- ⚡ **零构建依赖 · 开箱即用**：纯原生 HTML5 / CSS3 / ES6+ 编写，无需安装 Node.js、Vite 或任何构建工具，本地双击 `index.html` 即可畅快预览。
- 🌓 **双模式色彩自适应**：支持跟随系统主题自动切换浅色 / 深色（Dark/Light）模式，亦支持手动一键平滑切换，状态持久化至 `localStorage`。
- 📱 **极致全端响应式**：精心优化的流式网关与 Bento-Grid 卡片排版，在手机、平板、高分屏桌面端均可完美呈现。
- 🎨 **毛玻璃现代美学 (Glassmorphism)**：微弥散动态光晕、平滑过渡动画、卡片微动效与交互打字机效果。
- 🏷️ **作品分类过滤**：精选项目支持按「全部 / 3D交互与开发 / 自媒体与创作」实时标签筛选。
- 📬 **便捷互动体验**：邮箱点击一键复制并唤起轻量 Toast 提示、微信二维码交互弹窗、平滑锚点定位与回到顶部浮钮。
- 🌐 **已就绪的 GitHub Pages 配置**：根目录内置 `CNAME`（指定 `daixuan.cloud`），并配备 `.github/workflows/deploy.yml` 自动化部署流。

---

## 📁 目录结构

```text
personal-portfolio/
├── index.html                      # 网站主入口页面 (SEO 标签 / 语义化排版)
├── CNAME                           # GitHub Pages 自定义域名配置 (daixuan.cloud)
├── .gitignore                      # Git 忽略配置
├── README.md                       # 项目说明与 GitHub 提交流程指南
├── css/
│   └── style.css                   # 核心设计系统与样式表 (双主题 / 响应式)
├── js/
│   └── main.js                     # 交互逻辑 (主题切换 / 筛选 / 弹窗 / Toast)
├── assets/
│   └── images/
│       ├── favicon.svg             # 网站徽标 Favicon
│       ├── avatar.svg              # 极客风格矢量头像 (可替换为您自己的照片)
│       ├── project-3dmap.svg       # 长工大全景立体地图插画
│       ├── project-cloud.svg       # 个人门户封面图
│       ├── project-media.svg       # 自媒体视频矩阵插画
│       └── project-study.svg       # 知识库与英语备考插画
└── .github/
    └── workflows/
        └── deploy.yml              # GitHub Actions 自动化部署流水线
```

---

## 🚀 提交到 GitHub 并上线 GitHub Pages 完整指南

### 第一步：在 GitHub 上创建新仓库

从您的仓库截图已知，您的 GitHub 用户名是 **`dai123x`**，目标仓库是 **`dai123x.github.io`**：
1. 仓库名称：**`dai123x.github.io`**（作为 GitHub 用户专属 Pages 站点）
2. 仓库属性：**Public**（公开）
3. 远程地址：`https://github.com/dai123x/dai123x.github.io.git`

---

### 第二步：在本地直接推送到 GitHub

由于本地仓库已完成 `git init` 与初始提交，并已将远程分支设为您的仓库，您只需在终端（PowerShell 或 CMD）执行推送：

```bash
cd "d:\自媒体\personal-portfolio"

# 一键推送至 GitHub main 分支
git push -u origin main
```

> 若尚未添加远程源或需重新配置，可运行：
> ```bash
> git remote add origin https://github.com/dai123x/dai123x.github.io.git
> git push -u origin main
> ```

---

### 第三步：开启 GitHub Pages 静态托管

推送完成后，前往您的 GitHub 仓库页面：

1. 点击顶部的 **Settings** 选项卡。
2. 在左侧菜单中找到 **Pages**（在 "Code and automation" 下方）。
3. 在 **Build and deployment** 下的 **Source** 中：
   - 选项 A（最简单）：选择 **Deploy from a branch**，并将 Branch 设置为 **`main`**，文件夹保持 **`/(root)`**，点击 **Save**。
   - 选项 B：选择 **GitHub Actions**（仓库中已自带 `.github/workflows/deploy.yml`，推送后会自动运行部署）。
4. 此时稍等 1~2 分钟，GitHub Pages 即可完成构建发布！

---

### 第四步：配置 `daixuan.cloud` 域名 DNS 解析

由于项目中已包含 `CNAME` 文件并写入了 `daixuan.cloud`，GitHub 会自动识别您的自定义域名。

前往您的域名服务商（如腾讯云、阿里云、Cloudflare、Namesilo 等）的 **DNS 解析控制台**，为 `daixuan.cloud` 添加以下解析记录：

| 记录类型 | 主机记录 | 记录值 | 说明 |
| :--- | :--- | :--- | :--- |
| **CNAME** | `@` 或 `www` | `<您的GitHub用户名>.github.io.` | 指向 GitHub 提供的 Pages 节点 |

> 💡 **备用方案（A 记录）**：  
> 如果域名商的根域名 `@` 不允许添加 CNAME，可以添加 4 条 **A 记录**指向 GitHub Pages 官方 IP：
> - `185.199.108.153`
> - `185.199.109.153`
> - `185.199.110.153`
> - `185.199.111.153`

解析生效后（通常 5~30 分钟），在 GitHub 仓库的 **Settings -> Pages** 中勾选 **Enforce HTTPS**，即可全自动获得免费的 SSL 证书，实现 `https://daixuan.cloud` 绿锁安全访问！

---

## 🛠️ 自定义配置指南

1. **更换真实头像**：
   - 将你的真实头像图片放入 `assets/images/`，如命名为 `avatar.jpg`。
   - 在 `index.html` 中搜索 `assets/images/avatar.svg`，替换为 `assets/images/avatar.jpg`。

2. **更换微信二维码图片**：
   - 将你的微信二维码图片保存为 `assets/images/wechat-qr.png`。
   - 打开 `index.html` 中的微信模态框区域，将 SVG 占位图替换为 `<img src="assets/images/wechat-qr.png" width="180">` 即可。

3. **修改个人链接与社交媒体**：
   - 在 `index.html` 中搜索 `https://github.com`、`https://space.bilibili.com`、`contact@daixuan.cloud`，修改为你的实际账号地址或主页。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源，您可以自由修改、定制与二次分发。
