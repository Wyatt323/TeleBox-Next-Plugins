import { Plugin } from "@utils/pluginBase";
import { getGlobalClient } from "@utils/runtimeManager";
import type { MessageContext } from "@mtcute/dispatcher";
import { thtml as html } from "@mtcute/html-parser";
import { createDirectoryInAssets } from "@utils/pathHelpers";
import fs from "fs";
import path from "path";

const CONFIG_DIR = createDirectoryInAssets("stsave");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const DEFAULT = { pack: "", defaultEmoji: "⭐" };
type Config = typeof DEFAULT;

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[char] || char));
}

function loadConfig(): Config {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      saveConfig(DEFAULT);
      return { ...DEFAULT };
    }
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return {
      pack: String(raw?.pack || ""),
      defaultEmoji: String(raw?.defaultEmoji || DEFAULT.defaultEmoji),
    };
  } catch {
    return { ...DEFAULT };
  }
}

function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getReply(msg: any): any {
  return msg?.replyToMessage;
}

function getKind(message: any): "static" | "video" {
  const document = message?.media?.document || message?.document;
  const mime = String(document?.mimeType || "").toLowerCase();
  if (message?.sticker || message?.photo || mime.startsWith("image/") || mime.includes("webp") || mime.includes("tgsticker")) return "static";
  if (mime.startsWith("video/") || mime.includes("gif")) return "video";
  throw new Error("请回复贴纸、图片、GIF 或视频");
}

function getShortName(value: string): string {
  return value.trim().replace(/^https?:\/\/t\.me\/addstickers\//i, "").split(/[?#]/)[0];
}

function isValidShortName(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(value);
}

class StsaveNextPlugin extends Plugin {
  name = "stsave";
  description = "使用 Next/m t c u t e API 保存贴纸、图片、GIF 或视频到个人贴纸包";

  cmdHandlers = {
    stsave: async (msg: MessageContext): Promise<void> => {
      const message: any = msg;
      const args = String(message.text || "").trim().split(/\s+/).slice(1);
      const config = loadConfig();

      if (args[0] === "config") {
        if (args[1]) {
          const shortName = getShortName(args[1]);
          if (!isValidShortName(shortName)) throw new Error("贴纸包短名称格式无效");
          config.pack = shortName;
          saveConfig(config);
        }
        await message.edit({
          text: html(`📦 <b>stsave 配置</b>\n\n贴纸包：<code>${esc(config.pack || "未设置")}</code>\n默认表情：<code>${esc(config.defaultEmoji)}</code>\n\n设置：<code>.stsave config &lt;short_name&gt;</code>`),
        });
        return;
      }

      const target = getReply(message);
      if (!target) {
        await message.edit({ text: html("请回复贴纸、图片、GIF 或视频后使用 <code>.stsave</code>") });
        return;
      }
      if (!config.pack) throw new Error("请先使用 .stsave config 设置贴纸包短名称");

      const client: any = await getGlobalClient();
      const kind = getKind(target);
      const buffer = Buffer.from(await client.downloadAsBuffer(target));
      const maxBytes = kind === "static" ? 512 * 1024 : 256 * 1024;
      if (buffer.length > maxBytes) throw new Error(`媒体超过 ${kind === "static" ? "512KB" : "256KB"} 限制`);

      const uploaded = await client.uploadFile({
        file: buffer,
        fileName: kind === "static" ? "sticker.webp" : "sticker.webm",
        fileMime: kind === "static" ? "image/webp" : "video/webm",
      });

      await client.call({
        _: "stickers.addStickerToSet",
        stickerset: { _: "inputStickerSetShortName", shortName: config.pack },
        sticker: {
          _: "inputStickerSetItem",
          document: uploaded,
          emoji: config.defaultEmoji,
        },
      });
      await message.edit({ text: html(`✅ 已保存到 <code>${esc(config.pack)}</code>。`) });
    },
  };
}

export default new StsaveNextPlugin();
