# Chapter Lab · A-Level 分章练习室

按 OxfordAQA 官方课程单元，筛选 OxfordAQA International、CIE International 和 Edexcel IAL 的物理、数学、进阶数学真题索引，并自动组合章节练习。

**[在线使用](https://hankgao15888.github.io/chapter-lab/)** · **[源码仓库](https://github.com/hankgao15888/chapter-lab)**

## 功能

- 94个课程分类，支持科目、章节、AS/A2、考试局、年份及估计难度筛选。
- 目标总分组卷，尽量匹配难度配比、覆盖所选章节，题目不重复。
- 保存练习、记录错题、避开已练题，导入和导出浏览器记录。
- 公开页面提供原卷题号、页码、试卷链接及评分标准出处。
- 导入本地题库后显示原题图，可打印或保存为PDF；未导入时可打印选题清单。
- 无后端、无模型调用、无API密钥，无需构建或安装前端依赖。

## 收录范围与准确性

索引更新于2026-11-02：从指定来源的每个来源试卷单元，选取2024和2025年各一套代表卷，共90套、1,011道大题；另有1,722条整卷目录记录。并非全部考季、变体或历年试卷均已拆分。

937题有章节建议，74题待归类。依据为 OxfordAQA 9630、9660、9665 现行官方课程，未混入2027首教的9760/9765新版，也不对应某一版教材的页码。分类包含关键词和题干语义建议，跨考试局题目可能只部分符合目标课程，**不代表官方标签或全量人工审定**。

难度是按大题总分估计：≤4分为基础、5–10分为标准、≥11分为挑战。它不是官方难度评级。组卷按题数尽量匹配难度比例；题池不足时显示实际分数和缺口，不重复凑题。

## 在本地运行

直接打开 `docs/index.html`，或在仓库根目录运行：

```sh
python -m http.server 8765 --directory docs
```

然后打开 `http://127.0.0.1:8765/`。公开版不需要额外下载题图即可进行索引筛选、选题和查看原卷链接。

## 导入已有离线题库

1. 解压自己的 Chapter Lab 离线题库。
2. 点击网页右上角「导入本地题库」。
3. 选择包含 `data.js` 和 `questions/` 的完整文件夹。
4. 导入匹配的原题图后，可预览完整题目并打印练习卷。

题库文件在浏览器本地读取，不上传服务器。刷新页面后需重新导入；练习记录、错题及章节调整仍保存在浏览器本地存储。不同域名和浏览器的记录独立，可通过「我的练习」导出备份。

文件夹导入主要面向支持目录选择的桌面浏览器。其他设备仍可使用公开索引和来源链接。

## GitHub Pages 发布

本仓库采用静态 `docs/` 目录：进入 **Settings → Pages → Deploy from a branch**，选择 **main /docs** 并保存。`.nojekyll` 保证按静态文件发布。无需构建步骤。

若偏好 GitHub Actions，`deployment/pages.yml` 提供可选工作流模板；先改用 Actions 作为发布源，再将它复制到 `.github/workflows/pages.yml`。

官方说明：[发布源配置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 目录与开发

```text
docs/                 可直接发布的HTML/CSS/JavaScript
  selection.js        独立选题算法，可在Node中测试
  data.js             由公开索引生成的浏览器数据
data/catalog.json     不包含完整题干和题图的公开索引
data/curriculum.json  官方章节及其来源
scripts/build.mjs     验证并生成docs/data.js
tests/verify.mjs      索引完整性、整卷总分及组卷约束验证
deployment/pages.yml  可选GitHub Actions模板
```

更新 `data/catalog.json` 后运行：

```sh
node scripts/build.mjs
node tests/verify.mjs
```

需要Node.js 20或更高版本，无第三方npm依赖。

## 数据与许可

原创代码与项目说明采用 [MIT](LICENSE) 许可。考试试卷、评分标准、教材与考试局名称的权利属于相应权利人，**不在本项目的MIT许可内**；公开仓库不打包第三方试卷原图或完整题干。详情见 [第三方内容说明](THIRD_PARTY_NOTICES.md)。

真题索引来源：[A Level Copilot](https://www.alevelcopilot.com/as-and-a-level-pastpapers)。课程分类来源链接保存在每个章节条目中。项目与上述考试局、出版社及来源网站无隶属或官方合作关系。
