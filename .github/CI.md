# CI/CD 密钥与环境变量说明

本文说明 NASKTV 的 GitHub Actions 流水线需要配置哪些 **GitHub Secrets / 环境变量**，以及哪些是自动提供的、哪些是应用自身的运行时变量（容易混淆）。

## 工作流总览

| 文件 | 触发 | 作用 |
|------|------|------|
| `version.yml` | 推送 `main` | release-please：按约定式提交算版本、维护 CHANGELOG、开 Release PR、合并后打 tag + 建 Release |
| `docker.yml` | 被 `release.yml` 调用 / 手动 | 构建统一仓库 `nasktv` 的多架构镜像（`backend`/`separator`/`web` 用 tag 区分）并推阿里云 ACR |
| `desktop.yml` | 被 `release.yml` 调用 / 手动 | TV 桌面端：Windows(64/32) + macOS(64)，**未签名** |
| `android.yml` | 被 `release.yml` 调用 / 手动 | TV 安卓端：`arm64-v8a`(64) / `armeabi-v7a`(32) APK，**未签名** |
| `release.yml` | release-please 发布 Release（`release: published`） | 编排器：串行调用 docker → desktop → android，把产物挂到该 Release（tag 名显式传给子工作流） |

> macOS 物理上无 32 位；Linux 桌面端已按需求移除；所有产物当前均为未签名侧载包。

---

## 必须手动配置的 GitHub Secrets

路径：**仓库 Settings → Secrets and variables → Actions → Secrets → New repository secret**

当前版本**只有这 4 个手动密钥**（签名移除后，不再需要任何 Windows / macOS / Android 签名密钥）：

| Secret 名称 | 必填 | 说明 | 示例 |
|------|------|------|------|
| `ALIYUN_ACR_REGISTRY` | ✅ | 阿里云容器镜像服务（ACR）注册地址 | `registry.cn-hangzhou.aliyuncs.com` |
| `ALIYUN_ACR_USERNAME` | ✅ | ACR 登录用户名（通常用 RAM 子账号的 AccessKeyId） | `your-ram-access-key-id` |
| `ALIYUN_ACR_PASSWORD` | ✅ | ACR 登录密码（RAM AccessKeySecret） | `your-ram-access-key-secret` |
| `ALIYUN_ACR_NAMESPACE` | ✅ | 镜像命名空间（仓库名） | `nasktv` |

**未配置的后果**：`docker.yml` 的登录/推送步骤会失败，镜像不会发布；但桌面端、安卓端构建不受影响（可单独出包）。

**镜像推送地址**（三个元件推到同一个镜像仓库 `nasktv`，用 tag 前缀区分）：
```
<ALIYUN_ACR_REGISTRY>/<ALIYUN_ACR_NAMESPACE>/nasktv:backend-<semver>
<ALIYUN_ACR_REGISTRY>/<ALIYUN_ACR_NAMESPACE>/nasktv:separator-<semver>
<ALIYUN_ACR_REGISTRY>/<ALIYUN_ACR_NAMESPACE>/nasktv:web-<semver>
```
标签策略：以 `v0.2.0` 为例，每个元件生成两个 tag —— `backend-0.2.0` / `backend-0.2`、`separator-0.2.0` / `separator-0.2`、`web-0.2.0` / `web-0.2`（多架构 `linux/amd64` + `linux/arm64`）。不同元件 tag 前缀不同，不会互相覆盖。

---

## 自动提供的变量（**无需、也不能**手动配置）

| 变量 | 来源 | 用途 |
|------|------|------|
| `GITHUB_TOKEN` | GitHub 自动注入 | release-please 开 PR/打 tag、tauri-action 与 action-gh-release 上传产物。权限由各 workflow 的 `permissions:` 块控制（需 `contents: write` + `pull-requests: write`，见仓库 Settings → Actions → General → Workflow permissions 设为 Read and write） |
| `GITHUB_REF_NAME` | GitHub 自动注入 | 当前 tag 名（如 `v0.2.0`），被 `scripts/set-version.mjs` 用于统一各包版本号 |

---

## 工作流内部设置的非密钥环境变量（自动，无需配置）

这些由 workflow 步骤自己 `echo >> $GITHUB_ENV` 或 `env:` 设置，列出来仅供排查：

| 变量 | 出现位置 | 说明 |
|------|---------|------|
| `CI=true` | desktop.yml / android.yml | 告诉 Tauri 不要弹出开发窗口 |
| `NDK_HOME` / `ANDROID_NDK_HOME` | android.yml | 安装 NDK 26 + **`platforms;android-36`** 后写入，供 cargo 交叉编译。⚠️ `platforms;android-36` 必须与 `src-tauri/gen/android/app/build.gradle.kts` 的 `compileSdk=36`/`targetSdk=36` 一致，否则 gradle 配置阶段报 “Failed to find Platform android-36” → `tauri build` exit code 2 |
| Docker 镜像 `tags` / `labels` | docker.yml | 由 `docker/metadata-action` 依据 semver 自动生成 |

---

## 已移除的签名密钥（当前工作流**不再引用**，请勿寻找）

早期方案曾计划开启签名，相关密钥已随「去签名」需求删除，不在仓库任何 workflow 中出现：

- Windows：`WINDOWS_PFX_BASE64` / `WINDOWS_PFX_PASSWORD`
- macOS：`APPLE_CERT_BASE64` / `APPLE_CERT_PASSWORD` / `APPLE_API_KEY_BASE64` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER`
- Android：`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEY_ALIAS` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_PASSWORD`

> 若日后需要恢复签名（消除 Windows SmartScreen 拦截、出 Android 发布包、macOS 公证），再把这些密钥加回 Secrets，并在对应 workflow 中恢复签名步骤即可。

---

## ⚠️ 与应用运行时环境变量区分（容易混淆）

下面这些**不是 GitHub Secrets**，是后端 `packages/backend` 在 NAS 上运行时的配置，写在 `.env`（参考 `.env.example`），与 CI 无关：

`PORT` / `JWT_SECRET` / `DB_PATH` / `SCAN_PATH` / `SEPARATOR_SERVICE_URL` / `SEPARATION_OUTPUT_DIR` / `SEPARATION_CONCURRENCY` / `HF_ENDPOINT` / `AI_ENABLED` / `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` / `AI_PARSE_CONCURRENCY`

并发数优先级：`settings` 表 > 环境变量 > 默认 1。
