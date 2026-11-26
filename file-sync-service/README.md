# Chapter Lab 私有文件同步服务

同步包在浏览器内加密。云端服务部署到 Cloudflare Workers Free，使用 SQLite Durable Objects 为每个获准的同步存储编号保存一份最新备份。无需启用 R2 或其他付费订阅。GitHub Pages 继续提供网站；未配置云端时仍可用坚果云和 `.clsync` 同步包。

## 用 Cloudflare 部署向导接入

[打开 Cloudflare 部署向导](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fhankgao15888%2Fchapter-lab%2Ftree%2Fmain%2Ffile-sync-service)

部署向导会在你授权的 Cloudflare 账号下部署 Worker 和 SQLite 存储。使用 Workers Free；如果界面显示 R2 或要求开通付费方案，请先检查是否选中了最新的 `file-sync-service` 配置。

在 Chapter Lab 的「我的练习 → 文件同步」生成或使用已有同步密钥，展开「同步存储编号」。仅把编号填入部署向导的 `SYNC_VAULTS`。若部署向导没有显示这个字段，可在 Worker 的「Settings → Variables and Secrets」中新增同名 Secret。部署后复制 Worker 的 `https://…workers.dev` 地址，填入站点的 `docs/file-sync-config.json` 并重新发布 GitHub Pages。

## 命令行部署

1. 在 Chapter Lab 登录需要同步的学员账号，使用已有同步密钥，或在还没有密钥时新建。展开「同步存储编号」，复制编号。不要把同步密钥或登录密码传给管理员。
2. 在 `file-sync-service/` 使用 Wrangler 登录，然后运行 `wrangler deploy`。配置会建立 SQLite Durable Object；不需要另建数据库。`SYNC_ORIGINS` 应为实际站点的 HTTPS origin，不包含目录或结尾斜线。
3. 运行 `wrangler secret put SYNC_VAULTS`，填写获准使用云端的完整存储编号，多个编号以英文逗号分隔。更新时应保留仍需使用的编号。
4. 将 Worker 的 HTTPS 地址填入 `docs/file-sync-config.json` 的 `endpoint`，发布 GitHub Pages。该文件只含服务地址。不要提交 Cloudflare API 密钥、学员同步密钥或答案文件。
5. 原设备点「上传全部 PDF」，新设备用同一学员名和同步密钥点「下载到此设备」。云端同步包最多 80 MB；超过时可通过坚果云或按 PDF 分批导出同步包。遇到版本冲突，先下载合并，再上传。导入保留本地版本，不传播删除。

服务校验同步存储编号与独立派生的访问令牌，只收加密包。学员名、PDF 文件名及解密密钥不发送到服务。每个编号对应独立的存储空间。上传完成前保留上一份完整备份，使用版本匹配防止意外覆盖。撤销访问可从 `SYNC_VAULTS` 移除对应编号；移除编号本身不会删除已存的加密数据。免费额度及超限处理见 [Cloudflare Durable Objects 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)。

运行 `node tests/file-sync.mjs` 验证加密还原、账号隔离、版本冲突和模拟存储访问控制。生产部署后还需用两台设备和非敏感示例文件验证实际存储。
