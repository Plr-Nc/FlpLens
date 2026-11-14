# 贡献指南

> 提 issue 时请用仓库自带的模板（「打不开 / 解析出错」或「功能建议」）——
> 它们会问清必要的几项，省掉一来一回。空白 issue 已关闭。

目标是让「用户遇到打不开的版本」这件事，变成一条能修得动的 PR。

## 三级路径（按你愿意投入的精力选）

### L1 · 贴一份诊断报告

1. 打开 FlpLens，拖入那个打不开的 `.flp`
2. 切到「诊断」标签
3. 点「复制诊断报告」
4. 开 issue，粘贴

报告里**不含**工程名、通道名、采样路径、音符——可以放心贴。

维护者会据此判断是缺 profile 条目还是解析 bug。

### L2 · 给一个最小复现工程

如果 L1 的诊断显示"未知事件"或"结构读错"，需要一个样本：

1. 用 FL Studio **新建空工程**
2. **只加那一项**（一个通道 / 一个片段 / 一个自动化点 / 一个时间标记）
3. 另存为 `repro.flp`
4. issue 里写清：FL 版本、你期望看到什么、实际看到什么、附上 `repro.flp`

> 不要发整首工程——既没必要，也会带上你的路径和素材信息。

### L3 · 直接改 profile 并提交 fixture

```
src/flp/profiles.ts        加一条 profile（或改现有条目）
test/fixtures/<名字>/       sample.flp + expected.json + README.md
```

`expected.json` 只需写关键字段，例如：

```json
{ "flVersion": "26.1.6.5639", "channels": 12, "patterns": 3, "notes": 96, "playlistItems": 14 }
```

然后：

```bash
npm run verify
```

## 什么时候该改 profile，什么时候该改解析器

| 现象 | 改哪里 |
|---|---|
| 新版本事件长度变了（例如 FL 2026 的 `172` 从 4 字节变 1 字节） | `profiles.ts` 的 `eventSizeOverrides` |
| 文本乱码 | `profiles.ts` 的 `textEncoding` |
| playlist 记录长度变了 | 通常不用改：签名探测会自适应；探测失败才动 `detectPlaylistStride` |
| 某个事件含义变了 / 新事件要显示 | `events.ts`（语义）+ `project.ts`（状态机） |

## 本地开发

```bash
npm install
npm run dev
npm run typecheck
npm run verify
```

## 提交信息

`类型: 简述`，类型用 `新增 / 修复 / 整理 / 实验`。

## 边界

不接受这些方向的 PR：

- 写回 / 修改 `.flp`、版本降级、格式转换
- 解析第三方 VST 的预设名或状态块内容
- 任何上传、遥测、云端解析
- 复刻 FL Studio 的 UI、图标、配色
