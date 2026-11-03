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
