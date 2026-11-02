# 参与改进

欢迎报告分类误配、损坏的来源链接和组卷问题。

报告题目问题时，请提供考试局、科目、年份、卷号、原题号及建议分类。请使用原卷链接，不要在Issue中粘贴完整试卷或上传个人题库。

修改数据时编辑 `data/catalog.json`，然后运行：

```sh
node scripts/build.mjs
node tests/verify.mjs
node tests/geometry.mjs
```

修改界面后，请检查窄屏和桌面布局、筛选、组卷、来源链接及打印预览。本项目无后端服务，不需要也不应提交访问令牌、个人记录或私有站点配置。
