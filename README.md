# 戴璇 · 个人数字门户

[访问站点](https://daixuan.cloud/) · [GitHub 仓库](https://github.com/dai123x/dai123x.github.io)

个人主页与作品集，集中展示应用统计案例、交互可视化、三维校园地图及前端工具。站点使用原生 HTML、CSS 和 JavaScript，保留各作品的独立页面与设计；无需安装 npm 依赖，也没有前端框架构建步骤。部分作品使用本地第三方库或在线资源。

## 站点入口

当前 `sitemap.xml` 收录以下 12 个页面：

| 页面 | 内容 |
| --- | --- |
| [首页](https://daixuan.cloud/) | 个人介绍、作品分类与项目入口 |
| [璇玑星海](https://daixuan.cloud/galaxy/) | 个人经历与作品的交互星系 |
| [工大印记](https://daixuan.cloud/school/) | 长春工业大学主题页面 |
| [智能制造案例](https://daixuan.cloud/case-studies/smart-manufacturing-takt-time-analysis.html) | 工序节拍分析与产线改善情景展示 |
| [信用风险案例](https://daixuan.cloud/case-studies/applied-statistics-credit-risk.html) | 应用统计与信用风险分析展示 |
| [全景立体校园地图](https://daixuan.cloud/campus-map/) | 校园空间示意、建筑检索与三维漫游 |
| [雪线之上](https://daixuan.cloud/snow-viz/) | 吉林冰雪经济目标可视化交互系统 |
| [雪线之上作品说明书](https://daixuan.cloud/snow-viz/documentation.html) | 作品方法、数据与交互说明 |
| [统计游乐场](https://daixuan.cloud/stats-lab/) | 可交互的统计概念演示 |
| [Aurora Chat · 极光](https://daixuan.cloud/aurora-chat/) | 浏览器端 AI 聊天工作台 |
| [明史资料平台](https://daixuan.cloud/ming-history/) | 文献索引与研读工具 |
| [简历](https://daixuan.cloud/resume/) | 在线简历与打印页面 |
| [朗读室](https://daixuan.cloud/words/) | 英文演讲与《经济学人》句式精读 |

`snow-viz/vr_twin.html` 是冰雪作品的附属三维 / VR 页面；`404.html` 提供站点错误页。

## 目录与维护点

```text
.
├── index.html                 # 首页内容、作品卡片和导航
├── css/                       # 首页样式（style.css、refresh.css）
├── js/                        # 首页交互与图片查看器
├── assets/                    # 共享图片、图标和音频
├── galaxy/                    # 星系页面及 comments.json
├── school/                    # 学校主题页面
├── case-studies/              # 两篇统计案例、说明与保存结果
├── campus-map/                # 三维校园示意、模型数据和本地 Three.js
├── snow-viz/                  # 冰雪作品、说明书、VR 页面及 CSV/JSON 数据
├── stats-lab/                 # 统计演示、样式与中英文文案
├── aurora-chat/               # 聊天工作台、本地第三方库及许可声明
├── ming-history/              # 明史页面、交互逻辑及 data-*.js 资料
├── resume/                    # 简历页面
├── words/                     # 朗读室：演讲与句式内容、样式与交互
├── scripts/                   # 站点检查、部署打包及已有分析辅助文件
├── .github/workflows/         # GitHub Actions 校验与部署
├── sitemap.xml                # 公开页面索引
├── robots.txt                 # 搜索引擎抓取配置
├── site.webmanifest           # 站点名称、图标与显示配置
├── CNAME                      # 自定义域名 daixuan.cloud
├── 404.html
└── LICENSE
```

- 修改首页内容时同步检查 `index.html`、`css/` 和 `js/`；作品名称、封面和链接在首页与各作品页面之间保持一致。
- 各作品的内容和交互主要位于对应目录。校园模型数据在 `campus-map/js/campus-data.js`，明史资料在 `ming-history/js/data-*.js`，统计游乐场的双语文案在 `stats-lab/js/i18n.js`。
- 冰雪作品的数据、报告和页面同在 `snow-viz/`；案例保存结果位于 `case-studies/case_summary.json`。更新统计内容时核对数据来源、分析条件和页面数值，保留原有作者署名。
- 新增或移除公开页面时，同时更新导航、页面的 canonical / 分享信息和 `sitemap.xml`。更换域名时同步检查 `CNAME`、`robots.txt` 与页面中的绝对地址。

## 本地预览与检查

在仓库根目录启动 HTTP 静态服务，例如使用已安装的 Python 3：

```bash
python -m http.server 8000 --bind 127.0.0.1
```

打开 [http://127.0.0.1:8000/](http://127.0.0.1:8000/)，即可沿首页链接访问各作品。使用 HTTP 预览，以便 JSON 请求、模块脚本和相对路径按网站方式加载。地图在线影像、VR 页面的 CDN 资源和聊天服务接口仍需要相应网络访问；Aurora Chat 提供无需配置服务接口的演示模式。

站点维护脚本使用 Node.js 内置模块，无需运行 `npm install`：

```bash
node scripts/check-site.mjs
node scripts/build-site.mjs
```

第一条执行站点静态检查，第二条生成部署目录 `_site/`。如需核对部署包，可在 `_site/` 内启动同样的 HTTP 服务。静态检查通过后，仍应在浏览器查看桌面与手机宽度下的实际页面，并检查导航、主题切换及本次修改涉及的作品交互。

## 部署

站点由 [GitHub Actions 工作流](.github/workflows/)发布到 GitHub Pages：拉取请求执行校验，`main` 分支更新后检查并打包站点，将 `_site/` 作为部署产物发布。仓库的 **Settings → Pages → Build and deployment → Source** 应选择 **GitHub Actions**。

`CNAME` 记录自定义域名 `daixuan.cloud`；域名解析与 HTTPS 状态在域名服务商和 GitHub Pages 设置中管理。部署进度与失败原因以仓库 **Actions** 记录为准。

## 许可证、素材与数据

根目录的 [MIT 许可证](LICENSE)说明本项目代码的使用条件。复用子项目时也需查看其单独声明：例如 [Aurora Chat 许可证](aurora-chat/LICENSE)与[第三方组件声明](aurora-chat/THIRD-PARTY-NOTICES.md)，以及[校园地图的用途与来源说明](campus-map/README.md)。

第三方库保留各自的版权与许可证；图片、音频、地图服务、引用资料和外部数据依各自来源的授权条件使用，不能因其出现在本仓库就视为统一采用 MIT。复用或再分发前，应核对对应项目的来源说明与许可，并保留必要署名。作品中的统计案例、情景推演和校园空间示意，应连同页面说明的假设与适用范围一起理解。
