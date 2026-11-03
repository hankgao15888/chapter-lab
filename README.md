# Chapter Lab · A-Level 分章练习室

按 OxfordAQA 官方课程单元，筛选 OxfordAQA International、CIE International 和 Edexcel IAL 的物理、数学、进阶数学、化学、生物和经济真题索引，并自动组合章节练习。

**[在线使用](https://hankgao15888.github.io/chapter-lab/)** · **[源码仓库](https://github.com/hankgao15888/chapter-lab)**

## 功能

- 365个课程分类，支持科目、章节、AS/A2、考试局、年份及估计难度筛选；年份随科目和考试局自动更新。
- 按科目加载真题索引，切换科目后缓存已载入数据；保留旧版练习记录。
- 目标总分组卷，尽量匹配难度配比、覆盖所选章节，题目不重复。
- 保存练习、记录错题、避开已练题，导入和导出浏览器记录。
- 查看题目或组卷时自动读取原卷PDF，直接显示真实题目、公式、图表及共享题干。
- 每道题可展开「查看答案与解析」，直接显示对应官方答案、计算过程、图示及得分点；按需加载并缓存同卷评分标准。
- 组卷预览可逐题展开答案，或勾选「附答案与解析」生成按题目顺序排列的解答附录。
- 题图和所选解答全部加载完成后，可打印完整练习卷或保存为PDF；加载失败时可重试，不会把来源清单当作完整试卷打印。
- 保留原卷题号、页码、试卷链接及评分标准出处；支持本地离线题库导入。
- 无后端、无模型调用、无API密钥。PDF.js已随站点提供，无需从第三方CDN加载程序。

## 收录范围与准确性

索引更新于2026-11-03：已拆分指定来源网站三个考试局、六门科目目录列出的**全部年份、考季与变体，共3,447套试卷、39,182道独立练习题**。范围以来源网站目录为准，不包含目录之外的历史试卷。

| 考试局 | 收录年份 | 试卷 | 练习题 |
| --- | --- | ---: | ---: |
| OxfordAQA International | 2018–2026 | 388 | 5047 |
| CIE International | 2015–2026 | 2355 | 26275 |
| Edexcel IAL | 2019–2026 | 704 | 7860 |

| 科目 | 试卷 | 练习题 |
| --- | ---: | ---: |
| 物理 | 674 | 8749 |
| 数学 | 708 | 6054 |
| 进阶数学 | 340 | 2974 |
| 化学 | 679 | 8079 |
| 生物 | 586 | 5657 |
| 经济 | 460 | 7669 |

逐卷题数、原卷总分及可选题调整记录见 [覆盖核对表](docs/coverage.json)。旧版CIE进阶数学的EITHER/OR分别拆为独立练习题；试卷总分按原考试二选一规则核对。2018年两套扫描版OxfordAQA进阶数学卷通过OCR并核对页界与分值；一份来源失效原卷已补充Pearson官方链接，显示题图时使用经核对的同卷公开镜像。

35,359题有章节建议，3,823题待归类。依据为 OxfordAQA 9630、9660、9665、9620、9610、9640 现行官方课程，未混入2027首教的9760/9765新版，也不对应某一版教材的页码。分类由题干关键词自动建议，跨考试局题目可能只部分符合目标课程，**不代表官方标签或全量人工审定**。

化学、生物：OxfordAQA 2018–2026、CIE 2015–2026、Edexcel IAL 2019–2026。经济：OxfordAQA 2022–2026、CIE 2015–2026、Edexcel IAL 2019–2026。

经济材料：Edexcel 阅读材料随题附入，CIE 数据材料保留在对应大题中。OxfordAQA 的配套数据材料册暂不可读取，共156道依赖材料的题目已标注并禁止加入练习卷；其余题目可以组卷。

官方解答索引覆盖3,447套试卷、39,182道题：39,180道定位至官方评分标准；2道公开评分标准缺少对应答案，页面逐题注明。10道被官方作废或移除的选择题保留核对记录，并排除组卷。数学长解答及部分复杂排版保留相关整页，并明确提示同页可能含相邻题。

8份错链或失效文件补充了同卷来源。3套共25道题的替代来源不支持跨域渲染，已逐题整理官方答案要点与公式直接展示并支持打印；完整评分细则仍保留来源链接核对。来源与限制见[官方解答来源核对](data/ANSWER_SOURCES.md)。选择题仅有答案键时会明确说明无官方推导；中文AI讲解暂未启用。

难度是按大题总分估计：≤4分为基础、5–10分为标准、≥11分为挑战。它不是官方难度评级。组卷按题数尽量匹配难度比例；题池不足时显示实际分数和缺口，不重复凑题。

## 在本地运行

在线访问即可自动显示题目。在本地使用自动PDF渲染时，请在仓库根目录启动HTTP服务器：

```sh
python -m http.server 8765 --directory docs
```

然后打开 `http://127.0.0.1:8765/`。无需手工导入题图；第一次读取某套来源试卷时需要联网下载PDF，后续按原题区域显示。直接以 `file://` 打开HTML可能无法启动PDF工作线程，请使用HTTP服务器。

## 可选：导入已有离线题库

默认会自动加载来源PDF；需要离线显示或来源暂不可用时，也可以使用已有题图：

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
  selection.js        独立选题算法，大题池分层抽样与完整题池回退
  catalog-utils.js    按实际题库生成年份列表
  coverage.json       逐卷题数与分值核对记录
  question-geometry.js 原题区域坐标与画布裁切
  question-renderer.js 原卷读取、并发控制、题图渲染及重试
  vendor/pdfjs/       PDF.js 6.5.438及其Apache许可文件
  data.js             章节、整卷目录与按科目加载清单
  catalog/            六科独立真题索引
  catalog-loader.js   科目缓存、加载校验与重试
data/catalog.json     不包含完整题干和题图的公开索引
data/curriculum.json  官方章节及其来源
scripts/build.mjs     验证并生成浏览器清单与六科索引
tests/verify.mjs      索引完整性、整卷总分及组卷约束验证
tests/geometry.mjs    PDF裁切边界与共享题干区域验证
tests/years.mjs       历年筛选、各科各年组卷及大题库性能验证
deployment/pages.yml  可选GitHub Actions模板
```

更新 `data/catalog.json` 后运行：

```sh
node scripts/build.mjs
npm test
```

需要Node.js 20或更高版本，无第三方npm依赖。

## 数据与许可

原创代码与项目说明采用 [MIT](LICENSE) 许可。PDF.js采用Apache-2.0许可，详见 `docs/vendor/pdfjs/LICENSE`。考试试卷、评分标准、教材与考试局名称的权利属于相应权利人，**不在本项目的MIT许可内**；公开仓库不打包第三方试卷原图或完整题干，浏览器直接读取来源PDF并显示题目。详情见 [第三方内容说明](THIRD_PARTY_NOTICES.md)。

真题索引来源：[A Level Copilot](https://www.alevelcopilot.com/as-and-a-level-pastpapers)。课程分类来源链接保存在每个章节条目中。项目与上述考试局、出版社及来源网站无隶属或官方合作关系。
