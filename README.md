# Wyatt323 TeleBox-Next Plugins

个人维护的 TeleBox-Next 插件仓库，兼容 [TeleBox-Next](https://github.com/TeleBoxOrg/TeleBox-Next)。

## 添加仓库

在 TeleBox-Next 中执行：

```text
.tpm source add https://github.com/Wyatt323/TeleBox-Next-Plugins
```

## 安装

```text
.tpm i aix
.tpm i stsave
.tpm i yvlux
.tpm i tj
.tpm i ban_ad_spam
```

## 插件

- `yvlux`：语录贴纸生成，命令为 `.yvlux`
- `tj`：统计指定消息的全部回复
- `ban_ad_spam`：通过 👍 reaction 发起 3 人 Ban 投票，达到 3 票后回复 `/spam`

这些插件是按 TeleBox-Next 的 mtcute 插件接口维护，不与经典版 TeleBox 插件混用。

> `aix` 和 `stsave` 依赖 Teleproto 的底层类型，正在单独适配；未放入索引，避免安装后加载失败。
