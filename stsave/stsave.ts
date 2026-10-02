import { Plugin } from "@utils/pluginBase";
import { getGlobalClient } from "@utils/runtimeManager";
import { createDirectoryInAssets } from "@utils/pathHelpers";
import { safeGetReplyMessage } from "@utils/safeGetMessages";
import type { MessageContext } from "@mtcute/dispatcher";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);
const CONFIG_DIR = createDirectoryInAssets("stsave");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const MAX_STATIC = 512 * 1024;
const MAX_VIDEO = 256 * 1024;
const DEFAULT = { pack: "", defaultEmoji: "⭐" };
type Config = typeof DEFAULT;
type Kind = "static" | "animated" | "video";

type AnyMessage = MessageContext & Record<string, any>;
type AnyClient = Record<string, any>;

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c));
}
function loadConfig(): Config {
  try {
    if (!fs.existsSync(CONFIG_PATH)) { saveConfig(DEFAULT); return { ...DEFAULT }; }
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    const packs = raw?.packs && typeof raw.packs === "object" ? raw.packs : {};
    return { pack: String(raw?.pack ?? packs.static ?? packs.video ?? packs.animated ?? "").trim(), defaultEmoji: String(raw?.defaultEmoji || DEFAULT.defaultEmoji) };
  } catch { return { ...DEFAULT }; }
}
function saveConfig(c: Config): void { fs.mkdirSync(CONFIG_DIR, { recursive: true }); const tmp = `${CONFIG_PATH}.tmp`; fs.writeFileSync(tmp, JSON.stringify(c, null, 2)); fs.renameSync(tmp, CONFIG_PATH); }
function packName(v: string): string { return v.trim().replace(/^https?:\/\/t\.me\/addstickers\//i, "").split(/[?#]/)[0]; }
function validPack(v: string): boolean { return /^[A-Za-z][A-Za-z0-9_]{2,63}$/.test(v); }
function errorText(e: any): string { const s = String(e?.errorMessage || e?.message || e || "未知错误"); if (s.includes("STICKERSET_INVALID")) return "贴纸包不存在或名称无效"; if (s.includes("STICKERS_TOO_MUCH")) return "贴纸包已满"; if (s.includes("STICKER_VIDEO_LONG")) return "视频贴纸不能超过 3 秒"; if (s.includes("STICKER_VIDEO_BIG")) return "视频贴纸文件过大"; return s; }

function mediaKind(msg: any): Kind | "image" {
  const media = msg?.media;
  const type = String(media?.type || "").toLowerCase();
  const doc = media?.document || msg?.document || (type === "document" ? media : undefined);
  const mime = String(doc?.mimeType || doc?.mime_type || media?.mimeType || "").toLowerCase();
  if (msg?.sticker || type === "sticker") { if (mime.includes("tgsticker")) return "animated"; if (mime === "video/webm") return "video"; return "static"; }
  if (type === "photo" || msg?.photo || mime.startsWith("image/") && mime !== "image/gif") return "image";
  if (type === "video" || type === "animation" || mime.startsWith("video/") || mime === "image/gif") return "video";
  throw new Error("请回复贴纸、图片、GIF 或视频");
}
function rawOf(value: any): any { return value?.raw || value; }
function inputDocument(doc: any): any { const r = rawOf(doc); return { _: "inputDocument", id: r?.id ?? doc?.id, accessHash: r?.accessHash ?? doc?.accessHash, fileReference: r?.fileReference ?? doc?.fileReference ?? Buffer.alloc(0) }; }

async function imageWebp(input: Buffer): Promise<Buffer> {
  let result = Buffer.alloc(0);
  for (let quality = 92; quality >= 40; quality -= 8) { result = await sharp(input).rotate().resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality, alphaQuality: 100, effort: 6 }).toBuffer(); if (result.length <= MAX_STATIC) return result; }
  throw new Error(`转换后的静态贴纸超过 512KB（${Math.ceil(result.length / 1024)}KB）`);
}
async function videoWebm(input: Buffer): Promise<Buffer> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`; const inFile = path.join(os.tmpdir(), `stsave-${id}.input`); const outFile = path.join(os.tmpdir(), `stsave-${id}.webm`); fs.writeFileSync(inFile, input);
  try { let result = Buffer.alloc(0); for (const crf of [24, 30, 36, 42, 48, 54, 60, 63]) { await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", inFile, "-t", "3", "-vf", "scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,fps=30", "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", String(crf), "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", outFile]); result = fs.readFileSync(outFile); if (result.length <= MAX_VIDEO) return result; } throw new Error(`转换后的 WebM 超过 256KB（${Math.ceil(result.length / 1024)}KB）`); } finally { for (const f of [inFile, outFile]) try { fs.unlinkSync(f); } catch {} }
}

async function uploadSticker(client: AnyClient, data: Buffer, kind: "static" | "video", emoji: string): Promise<any> {
  const ext = kind === "static" ? "webp" : "webm";
  const sent = await client.sendMedia("me", { type: "document", file: data, fileName: `sticker.${ext}`, mimeType: kind === "static" ? "image/webp" : "video/webm", attributes: [{ _: "documentAttributeSticker", alt: emoji, stickerset: { _: "inputStickerSetEmpty" } }] });
  const doc = sent?.media?.document || sent?.media;
  if (!doc) throw new Error("上传转换后的贴纸失败");
  try { if (typeof sent?.delete === "function") await sent.delete({ revoke: true }); } catch {}
  return inputDocument(doc);
}

class StsaveNextPlugin extends Plugin {
  name = "stsave";
  description = "⭐ 保存贴纸、图片、GIF 或视频到贴纸包";
  cmdHandlers: Record<string, (msg: MessageContext) => Promise<void>> = { stsave: (m) => this.handle(m), st: (m) => this.handle(m) };

  private help(): string { return "⭐ <b>stsave</b>\n回复贴纸、图片、GIF 或视频：<code>.stsave</code>\n<code>.stsave save</code> 保存\n<code>.stsave to 包短名称</code> 本次指定\n<code>.stsave set 包短名称</code> 设置目标\n<code>.stsave auto</code> 自动选包\n<code>.stsave clear</code> 清除目标\n<code>.stsave emoji ⭐</code> 默认表情\n<code>.stsave status</code> 查看状态"; }
  private async handle(msg: MessageContext): Promise<void> {
    const m = msg as AnyMessage; const parts = String(m.text || "").trim().split(/\s+/); const sub = String(parts[1] || "").toLowerCase(); const config = loadConfig();
    try {
      if (sub === "help" || sub === "h") { await m.edit({ text: this.help() }); return; }
      if (sub === "status" || (!sub && !m.replyToMessage)) { await m.edit({ text: `⭐ <b>stsave 设置</b>\n\n贴纸包：${config.pack ? `<code>${esc(config.pack)}</code>` : "自动选择/创建"}\n默认表情：${esc(config.defaultEmoji)}` }); return; }
      if (sub === "emoji") { const e = parts.slice(2).join(" ").trim(); if (!e) throw new Error("请提供默认表情"); config.defaultEmoji = e; saveConfig(config); await m.edit({ text: `✅ 默认表情已设置为 ${esc(e)}` }); return; }
      if (sub === "set" || sub === "config") { const p = packName(parts[2] || ""); if (!validPack(p)) throw new Error("贴纸包短名称无效"); config.pack = p; saveConfig(config); await m.edit({ text: `✅ 已设置目标贴纸包：<code>${esc(p)}</code>` }); return; }
      if (sub === "auto" || sub === "clear") { config.pack = ""; saveConfig(config); await m.edit({ text: "✅ 已恢复自动选择/创建贴纸包" }); return; }
      const target = typeof (m as any).getReplyTo === "function" ? await (m as any).getReplyTo() : await safeGetReplyMessage(m); if (!target) throw new Error("请回复贴纸、图片、GIF 或视频后再使用命令");
      const detected = mediaKind(target); const client = await getGlobalClient() as unknown as AnyClient; let document: any; let kind: Kind;
      if (detected === "static" || detected === "animated" || detected === "video") { const d = target?.media?.document || target?.document || target?.sticker; document = inputDocument(d); kind = detected; } else { await m.edit({ text: detected === "image" ? "⏳ 正在转换为 WebP…" : "⏳ 正在转换为 WebM…" }); const data = Buffer.from(await client.downloadAsBuffer(target.media)); const out = detected === "image" ? await imageWebp(data) : await videoWebm(data); document = await uploadSticker(client, out, detected === "image" ? "static" : "video", config.defaultEmoji); kind = detected === "image" ? "static" : "video"; }
      const requested = sub === "to" ? packName(parts[2] || "") : config.pack; if (requested && !validPack(requested)) throw new Error("贴纸包短名称无效"); const me = await client.getMe(); const base = String(me?.username || `user_${me?.id || "me"}`).toLowerCase().replace(/[^a-z0-9_]/g, "_"); const pack = requested || `${base}_stsave_1`.slice(0, 64); const sticker = { _: "inputStickerSetItem", document, emoji: config.defaultEmoji };
      try { await client.call({ _: "stickers.addStickerToSet", stickerset: { _: "inputStickerSetShortName", shortName: pack }, sticker }); } catch (e: any) { if (!String(e?.errorMessage || e?.message || e).includes("STICKERSET_INVALID")) throw e; await client.call({ _: "stickers.createStickerSet", userId: { _: "inputUserSelf" }, title: "stsave 收藏", shortName: pack, stickers: [sticker], software: "TeleBox stsave" }); }
      await m.edit({ text: `✅ <b>贴纸保存成功</b>\n类型：${kind}\n贴纸包：<code>${esc(pack)}</code>` });
    } catch (e) { await m.edit({ text: `❌ <b>保存失败：</b>${esc(errorText(e))}` }); }
  }
}
export default new StsaveNextPlugin();
