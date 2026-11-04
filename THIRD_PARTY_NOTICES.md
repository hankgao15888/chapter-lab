# 第三方内容说明

`LICENSE` 中的 MIT 许可适用于本仓库的原创程序代码、选题算法和项目说明。

考试试卷、评分标准、教材、商标及考试局名称的权利属于各自权利人，包括 OxfordAQA、Cambridge International、Pearson Edexcel 等。该许可不授予这些第三方内容的复制、再许可或再分发权利。

本公开仓库提供章节分类、题号、页码、分值、非官方分类建议及公开来源链接，不包含第三方试卷原图、评分标准文件或完整题干。网页在访客浏览器内读取来源PDF，将题目对应区域渲染成题图用于查看和组卷；不将原卷复制到GitHub仓库。原文件由来源网站提供，来源网站可能更新链接、调整访问或移除文件。

用户可在浏览器中导入自己有权使用的本地题库。导入不会将文件上传到项目服务器；请不要把个人题库、第三方原卷或个人练习备份提交到公共仓库。

## PDF.js

`docs/vendor/pdfjs/` 包含 Mozilla PDF.js 6.5.438 的预构建浏览器文件，来源为官方 `pdfjs-dist` npm 包（<https://www.npmjs.com/package/pdfjs-dist>），许可为 Apache-2.0。其完整许可见该目录下的 `LICENSE`；字体、CMap和WebAssembly组件的附带许可也保留在对应子目录内。

数据来源：

- 真题目录：<https://www.alevelcopilot.com/as-and-a-level-pastpapers>
- 2020年10月Edexcel IAL WFM03/01：保留Pearson官方原卷链接，浏览器题图使用MyMathsCloud同卷公开镜像；具体地址与替换说明保存在该卷索引和覆盖记录中。镜像的附带标识属于其提供方。
- OxfordAQA课程资料：<https://www.oxfordaqa.com/>
- 具体课程文档链接见 `data/curriculum.json` 的 `source` 字段。

## 官方解答内嵌

网页按原题号直接显示评分标准的对应区域，保留官方公式、图示、评分说明与来源。`data/answers.json` 和 `docs/answers/` 包含题号、页码、裁切坐标、选择题正确选项及来源限制；另有25道题的答案数值、公式及简要知识要点整理，保留原评分标准供核对。不打包评分标准PDF、图片或完整解答正文。替换来源与已知限制见 [答案来源核对](data/ANSWER_SOURCES.md)。

## 在线人数统计

实时在线组件异步引用 whos.amung.us 官方动态组件（https://waust.at/d.js），保留其统计链接与标识。服务介绍及政策见 https://whos.amung.us/getstarted/ 和 https://whos.amung.us/legal/privacy/ 。页面使用专属统计编号，仅调用实时统计请求与显示接口，不调用组件的附加合作方加载函数。第三方统计代码不打包进仓库。

## 公共聊天中继

聊天自习室通过 ntfy 公共服务（<https://ntfy.sh/>）的公开话题 `chapterlab-study-room-6e2d8c91f4b3` 收发消息。消息、昵称和学习状态由访客主动提交，会公开显示并可能被同一中继上的其他客户端读取；公开服务的保留时间、速率限制和内容政策由 ntfy 决定。消息以纯文本显示，客户端会限制字段、长度和发送频率，但本项目不运营该中继，不能保证删除、审核或私密性。请勿在聊天中发送个人或敏感信息。
