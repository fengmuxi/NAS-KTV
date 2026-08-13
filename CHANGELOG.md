# Changelog

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
