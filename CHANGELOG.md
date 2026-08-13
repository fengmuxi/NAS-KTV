# Changelog

## [0.3.7](https://github.com/fengmuxi/NAS-KTV/compare/v0.3.6...v0.3.7) (2026-08-13)


### Bug Fixes

* **ci:** 修复 release 产物上传与 Android 构建失败 ([5d1fcac](https://github.com/fengmuxi/NAS-KTV/commit/5d1fcacaae84be83ea6893e7e459042441e3754f))
* **ci:** 收紧 desktop Release 上传范围，只传最终安装包 ([3eecace](https://github.com/fengmuxi/NAS-KTV/commit/3eecace0b728db374b85faa146ea96ea0fa4ad5f))

## [0.3.6](https://github.com/fengmuxi/NAS-KTV/compare/v0.3.5...v0.3.6) (2026-08-13)


### Bug Fixes

* **ci:** 修复 gh workflow run 因缺少 .git 上下文导致的失败 ([1d72cf5](https://github.com/fengmuxi/NAS-KTV/commit/1d72cf5d87b4a78512b927e0dcf7a070d8d5716f))

## [0.3.5](https://github.com/fengmuxi/NAS-KTV/compare/v0.3.4...v0.3.5) (2026-08-13)


### Bug Fixes

* **ci:** 增强 gh workflow run 调试（列出可用 workflow + 备选路径） ([6e0d0c9](https://github.com/fengmuxi/NAS-KTV/commit/6e0d0c9c3ed03973e3af7ba11bf0cada7a9fef1e))

## [0.3.4](https://github.com/fengmuxi/NAS-KTV/compare/v0.3.3...v0.3.4) (2026-08-13)


### Bug Fixes

* **ci:** 增加兜底触发步骤的调试输出和错误处理 ([b975d0e](https://github.com/fengmuxi/NAS-KTV/commit/b975d0e5eaaae86c7e17027a7051b6ac5c3dcdd1))

## [0.3.3](https://github.com/fengmuxi/NAS-KTV/compare/v0.3.2...v0.3.3) (2026-08-13)


### Bug Fixes

* **ci:** 修复 version.yml if 表达式引用 secrets 导致的校验失败 ([58bc6d8](https://github.com/fengmuxi/NAS-KTV/commit/58bc6d84aca9bdd8d595c3ff35a5c4c20d60014e))
* **ci:** 统一 pnpm 版本源，修复 desktop/android 构建版本冲突 ([eddd300](https://github.com/fengmuxi/NAS-KTV/commit/eddd3001cf1e0980ecc781e03fe319c31eeb8181))

## [0.3.2](https://github.com/fengmuxi/NAS-KTV/compare/v0.3.1...v0.3.2) (2026-08-13)


### Bug Fixes

* **ci:** release-please 改用 PAT 以触发下游 release.yml 构建 ([cd40e2f](https://github.com/fengmuxi/NAS-KTV/commit/cd40e2f2db6c67289503b30d37ebcfff1cb8eea5))

## [0.3.1](https://github.com/fengmuxi/NAS-KTV/compare/v0.3.0...v0.3.1) (2026-08-13)


### Bug Fixes

* **build:** 移除前端包 prebuild 修复 web Docker 构建，版本同步至 0.3.0 ([b2bdf1c](https://github.com/fengmuxi/NAS-KTV/commit/b2bdf1c56a30f3951278f2fdda91dbbcd1a6a6f1))
* **ci:** 关闭 buildx provenance/SBOM 以兼容阿里云 ACR 推送 ([00dc75a](https://github.com/fengmuxi/NAS-KTV/commit/00dc75aabc5f592e48b3788b518f5224c2f31699))
* **separator:** Docker 不再预装 torch/demucs，改由运行时后台安装 ([78219df](https://github.com/fengmuxi/NAS-KTV/commit/78219df64f74c05819b80c2c44f4878109ba0706))

## [0.3.0](https://github.com/fengmuxi/NAS-KTV/compare/v0.2.1...v0.3.0) (2026-08-13)


### Features

* separator PyTorch 后台自动安装与安装状态监控 ([e6b9088](https://github.com/fengmuxi/NAS-KTV/commit/e6b908887e9fa12532f68d22582cb0ad996fb900))


### Bug Fixes

* TV 播放器以 CORS 模式加载跨源音频以支持混音 ([0e7e4ee](https://github.com/fengmuxi/NAS-KTV/commit/0e7e4eeefb037a9cf3f0a1b1dbdd2d84fb873ee9))
* TV 连接/授权页排版与二维码、自动扫描流程 ([11d63b8](https://github.com/fengmuxi/NAS-KTV/commit/11d63b8b819aa6a6fd251ca1528fda266d667c13))
* 音频流接口放行跨源访问以支持 TV Web Audio 混音 ([b8d240c](https://github.com/fengmuxi/NAS-KTV/commit/b8d240ca26229ccd293d92314e3ee0bc1e58d37b))

## [0.2.1](https://github.com/fengmuxi/NAS-KTV/compare/v0.2.0...v0.2.1) (2026-08-11)


### Bug Fixes

* backend Docker 构建跳过 tsc --noEmit（用 tsx JIT 运行无需预编译） ([5529047](https://github.com/fengmuxi/NAS-KTV/commit/5529047fef0f00f8351cec0a27a228f4af102371))
* Docker 构建移除 set-version，恢复 frozen-lockfile ([6bc30ac](https://github.com/fengmuxi/NAS-KTV/commit/6bc30acfa9cdbf475c1ae44b591620b78b220dd9))
* separator Docker 构建失败 — 升级 pip + 加编译依赖 + 分步安装 ([cd498bd](https://github.com/fengmuxi/NAS-KTV/commit/cd498bde00253f47b93dfb8d3514cd4c197184ac))
* 修复 CI Docker 构建两个失败问题 ([441daff](https://github.com/fengmuxi/NAS-KTV/commit/441daff323c0269e2bb71c07be0054d6c8997799))
* 修复 Docker 构建中 tsc 编译与 shared 依赖安装问题 ([d0a08fb](https://github.com/fengmuxi/NAS-KTV/commit/d0a08fb74d912a92e3ba848337c0e3db79835148))
* 彻底修复 CI Docker 构建三个镜像失败 ([c79d493](https://github.com/fengmuxi/NAS-KTV/commit/c79d493babaed736828cf2a8a19f368810fbb4d0))
* 统一 pnpm 版本为 9（根因：lockfile v9 格式与 pnpm 8 不兼容） ([8389b6b](https://github.com/fengmuxi/NAS-KTV/commit/8389b6b1eb0c850e289fe0187537d1d5cf0d2652))

## [0.2.0](https://github.com/fengmuxi/NAS-KTV/compare/v0.1.0...v0.2.0) (2026-08-11)


### Features

* 初始化 nasktv 项目骨架与 CI/CD、版本管理框架 ([9bb0ddb](https://github.com/fengmuxi/NAS-KTV/commit/9bb0ddb1ac498defd584670dde6b24533ea972df))


### Bug Fixes

* 修复 release-please Node.js 版本兼容与 PR 权限 ([804e73e](https://github.com/fengmuxi/NAS-KTV/commit/804e73ea264ef0657f065f46d41400da6484ae03))
* 移除 release-please-action 不支持的 node-version 参数 ([68bb5bb](https://github.com/fengmuxi/NAS-KTV/commit/68bb5bb7de528518cab505f7bfcd384b842dafa2))
