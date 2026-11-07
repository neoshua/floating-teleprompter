# 第三方开源组件声明

本项目（及随附的 Windows 绿色版安装包）包含或依赖下列第三方开源组件。
各组件的权利归其各自权利人所有，按其原始许可证授权使用。
许可证全文见 [`third_party/`](./third_party/) 目录。

> 本项目 `LICENSE` 中的免费使用附加条款仅针对本项目独立编写的代码，
> **不减损、不替代**下表任一上游组件按其原始许可证已授予的权利。

---

## 1. Electron 37.2.6

- 用途：桌面应用运行时，提供无边框、置顶、真透明与鼠标穿透能力
- 许可证：MIT
- 项目：https://github.com/electron/electron
- 再分发：绿色版安装包内包含 Electron 运行时二进制文件
- 许可证全文：[`third_party/LICENSE-MIT-Electron.txt`](./third_party/LICENSE-MIT-Electron.txt)

## 2. vosk-browser 0.0.8

- 用途：在渲染进程中通过 WebAssembly 运行离线语音识别
- 许可证：Apache-2.0
- 项目：https://github.com/ccoreilly/vosk-browser
- 再分发：`vendor/vosk.js` 是该包 `dist/vosk.js` 的**未经修改的拷贝**，
  由 `npm run setup` 从 `node_modules` 生成，随绿色版安装包分发。
  该仓库不含 `vendor/`，请自行执行 `npm install && npm run setup` 生成。
- 许可证全文：[`third_party/LICENSE-APACHE-2.0.txt`](./third_party/LICENSE-APACHE-2.0.txt)

## 3. Vosk 中文语音模型 `vosk-model-small-cn-0.22`

- 用途：离线中文语音识别的声学与语言模型
- 许可证：Apache-2.0（见 https://alphacephei.com/vosk/models 的 License 列）
- 项目：https://alphacephei.com/vosk/ · https://github.com/alphacep/vosk-api
- 版权：Copyright (c) 2019-2022 Alphacephei Inc. 及 Vosk 项目贡献者
- **改动说明**：本项目把官方发布的 `.zip` 归档**仅做容器格式转换**，
  重新打包为 WebAssembly 运行时所需的 `.tar.gz`（内部保持 `model/` 顶层
  目录），**未修改任何模型文件内容、权重或配置**。
- 再分发：绿色版安装包内包含该模型的 `assets/model.tar.gz`；
  本 Git 仓库**不含**模型文件，由 `npm run setup` 从官方地址下载生成。
- 许可证全文：[`third_party/LICENSE-APACHE-2.0.txt`](./third_party/LICENSE-APACHE-2.0.txt)

## 4. @electron/packager 18.4.4

- 用途：仅构建期使用，把应用组装成 Windows 绿色版目录
- 许可证：BSD-2-Clause
- 项目：https://github.com/electron/packager
- 再分发：**不随**绿色版安装包分发（构建工具，不进入运行时）
- 许可证全文：[`third_party/LICENSE-BSD-2-Clause.txt`](./third_party/LICENSE-BSD-2-Clause.txt)

## 5. Python / Pillow（可选，仅构建期）

- 用途：构建图标、把绿色版目录压缩为 zip
- 许可证：Pillow 采用 HPND 类许可证；Python 采用 PSF License
- 再分发：**不随**绿色版安装包分发，运行时无此依赖

---

## 关于 Apache-2.0 组件的 NOTICE

上表第 2、3 项按 Apache License 2.0 授权。该许可证第 4 条要求：再分发时
须保留版权、专利、商标与归属声明，附许可证副本，并对修改过的文件作显著
说明；若上游作品含 `NOTICE` 文件，还须一并保留。

- vosk-browser 与 Vosk 模型发布包中均未提供独立的 `NOTICE` 文件；
  本文件即作为归属声明随绿色版提供。
- 模型归档的格式转换说明见上文第 3 条。
- Apache-2.0 全文及其中的专利与商标条款，见
  [`third_party/LICENSE-APACHE-2.0.txt`](./third_party/LICENSE-APACHE-2.0.txt)。

---

## 随绿色版分发的声明文件

Windows 绿色版 zip 中包含以下声明文件，请一并保留：

```
LICENSE                    本项目许可（MIT + 免费使用附加条款，允许自愿赞助）
NOTICE.md                  影视飓风致谢、非官方声明与权利保留
THIRD_PARTY_NOTICES.md     本文件
third_party/               各上游许可证全文
使用说明.txt               使用说明（内含致谢段落）
```
