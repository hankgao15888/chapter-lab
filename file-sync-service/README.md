# Chapter Lab 私有文件同步服务

控制器在登录后的浏览器内生成并加密同步包。在部署配置云端前，用户可以通过「我的练习 → 文件同步」手动迁移 `.clsync` 文件。这个服务部署在独立的 Cloudflare Worker，使用私有 R2 bucket，当前 GitHub Pages 默认没有配置服务地址。

## 启用云端

1. 在拥有部署权限的 Cloudflare 账号中启用 R2，创建名为 `chapter-lab-private-sync` 的 bucket。保持 bucket 的公开访问关闭。使用另一个名字时，同步修改 `wrangler.jsonc`。
2. 在 Chapter Lab 登录需要同步的学员账号，生成或填入同步密钥。展开「同步存储编号」，复制编号。不要把同步密钥或登录密码传给管理员。
3. 使用已登录的 Wrangler 从 `file-sync-service/` 部署 `wrangler.jsonc`。用 `wrangler secret put SYNC_VAULTS` 保存允许使用云端的存储编号，多个编号以逗号分隔。`SYNC_ORIGINS` 设为实际站点的 HTTPS origin，不包含目录或结尾斜线。
4. 将 Worker 的 HTTPS origin 填入 `docs/file-sync-config.json` 的 `endpoint`，发布 GitHub Pages。该文件只含服务地址。不要提交 Cloudflare API 密钥、学员同步密钥或答案文件。
5. 原设备点「上传全部 PDF」，新设备用同一学员名和同步密钥点「下载到此设备」。每个云端版本最多 80 MB。并发写入需要匹配云端版本；遇到冲突，先下载合并，再上传。导入保留本地版本，不传播删除。

服务校验同步存储编号与独立派生的访问令牌，只收加密包。无需将学员名、PDF 文件名或解密密钥发送到服务。Cloudflare R2 [Worker 接口](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) 用 ETag 条件写入避免较旧的数据覆盖新版本。关闭公开访问仍须配合 Worker 的凭据校验和私有配置。需要撤销云端访问时，可移除对应的存储编号，同时按需要从 R2 清理其加密包。

运行 `node tests/file-sync.mjs` 验证加密还原、账号隔离、版本冲突和模拟存储访问控制。生产部署后还需用两台设备和非敏感示例文件验证实际存储。
