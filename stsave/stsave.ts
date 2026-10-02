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
function esc(v: unknown): string { return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] || c)); }
function load(): Config { try { if (!fs.existsSync(CONFIG_PATH)) { save(DEFAULT); return { ...DEFAULT }; } const v = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); return { pack: String(v.pack || ""), defaultEmoji: String(v.defaultEmoji || DEFAULT.defaultEmoji) }; } catch { return { ...DEFAULT }; } }
function save(v: Config): void { fs.mkdirSync(CONFIG_DIR, { recursive: true }); fs.writeFileSync(CONFIG_PATH, JSON.stringify(v, null, 2)); }
function targetOf(msg: any): any { return msg.replyToMessage; }
function kindOf(msg: any): "static" | "video" { const d = msg?.media?.document || msg?.document; const mime = String(d?.mimeType || "").toLowerCase(); if (msg?.sticker || msg?.photo || mime.startsWith("image/") || mime.includes("webp") || mime.includes("tgsticker")) return "static"; if (mime.startsWith("video/") || mime.includes("gif")) return "video"; throw new Error("请回复贴纸、图片、GIF 或视频"); }

class StsaveNext extends Plugin {
  name = "stsave";
  description = "保存贴纸、图片、GIF 或视频到个人贴纸包";
  cmdHandlers = { stsave: async (msg: MessageContext) => {
    const m: any = msg;
    const args = String(m.text || "").trim().split(/\s+/).slice(1);
    const cfg = load();
    if (args[0] === "config") { if (args[1]) { cfg.pack = args[1].trim(); save(cfg); } await m.edit({ text: html(`当前贴纸包：<code>${esc(cfg.pack || "未设置")}</code>\n默认表情：<code>${esc(cfg.defaultEmoji)}</code>\n设置：<code>.stsave config &lt;short_name&gt;</code>`) }); return; }
    const target = targetOf(m); if (!target) { await m.edit({ text: html("请回复贴纸、图片、GIF 或视频后使用 .stsave") }); return; }
    if (!cfg.pack) throw new Error("请先使用 .stsave config 设置贴纸包短名称");
    const client: any = await getGlobalClient();
    const kind = kindOf(target);
    const data = Buffer.from(await client.downloadAsBuffer(target));
    if (kind === "static" && data.length > 512 * 1024) throw new Error("静态贴纸超过 512KB");
    if (kind === "video" && data.length > 256 * 1024) throw new Error("视频贴纸超过 256KB");
    const file = await client.uploadFile({ file: data, fileName: kind === "static" ? "sticker.webp" : "sticker.webm" });
    await client.call({ _: "stickers.addStickerToSet", stickerset: { _: "inputStickerSetShortName", shortName: cfg.pack }, sticker: { _: "inputStickerSetItem", document: file, emoji: cfg.defaultEmoji } });
    await m.edit({ text: html(`✅ 已保存到 <code>${esc(cfg.pack)}</code>。`) });
  } };
}
export default new StsaveNext();
