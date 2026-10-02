import { Plugin } from "@utils/pluginBase";
import type { MessageContext } from "@mtcute/dispatcher";
import { getGlobalClient } from "@utils/runtimeManager";
import { thtml as html } from "@mtcute/html-parser";

const TTL = 5 * 60 * 1000;
const REQUIRED = 3;
const APPROVAL = "👍";

type Vote = {
  chatId: any;
  targetId: number;
  voteId: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  inFlight: boolean;
};

function textOf(msg: any): string { return String(msg?.text || msg?.message || ""); }
function replyId(msg: any): number | undefined { return msg?.replyToMessage?.id; }
function mentionMe(msg: any, me: any): boolean {
  if (msg?.isMention || msg?.mentioned) return true;
  const text = textOf(msg).toLowerCase();
  const username = me?.username ? `@${String(me.username).toLowerCase()}` : "";
  return !!username && text.includes(username);
}
function voteText(count: number, expiresAt: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return `🛡️ <b>Ban 投票</b>\n\n同意人数：<b>${count}/${REQUIRED}</b>\n有效期：${seconds} 秒\n\n请对本消息添加 👍 表示同意。`;
}
function updateMatchesVote(update: any, vote: Vote): boolean {
  const peer = update?.peer;
  if (peer == null) return true;
  return String(peer) === String(vote.chatId) || String(peer?.channelId ?? peer?.chatId ?? peer?.userId) === String(vote.chatId);
}

class BanAdSpamNext extends Plugin {
  name = "ban_ad_spam";
  description = "ban广告触发 5 分钟、3 个 👍 同意的 /spam 投票";
  cmdHandlers: Record<string, (msg: MessageContext) => Promise<void>> = {};
  private votes = new Map<string, Vote>();

  private key(chatId: any, messageId: number): string { return `${String(chatId)}:${messageId}`; }
  private async approvals(vote: Vote): Promise<number> {
    const client: any = await getGlobalClient();
    const result = await client.getReactionUsers({ chatId: vote.chatId, message: vote.voteId, emoji: APPROVAL, limit: 100 });
    return Number(result?.total ?? (Array.isArray(result) ? result.length : 0));
  }

  eventHandlers = [{
    kind: "rawUpdate" as const,
    handler: async (ctx: any) => {
      const update = ctx?.update || ctx;
      if (update?._ !== "updateMessageReactions") return;
      const messageId = Number(update?.msgId ?? 0);
      if (!messageId) return;
      for (const vote of this.votes.values()) {
        if (vote.voteId !== messageId || vote.expiresAt <= Date.now() || !updateMatchesVote(update, vote) || vote.inFlight) continue;
        vote.inFlight = true;
        try {
          const count = await this.approvals(vote);
          const client: any = await getGlobalClient();
          if (count < REQUIRED) {
            await client.editMessage({ chatId: vote.chatId, message: vote.voteId, text: html(voteText(count, vote.expiresAt)) });
            vote.inFlight = false;
            continue;
          }
          clearTimeout(vote.timer);
          await client.sendText(vote.chatId, "/spam", { replyTo: vote.targetId });
          await client.editMessage({ chatId: vote.chatId, message: vote.voteId, text: html("✅ <b>投票通过</b>\n已达到 3 个 👍，已回复 /spam。") });
          this.votes.delete(this.key(vote.chatId, vote.voteId));
        } catch (error) {
          vote.inFlight = false;
          console.error("[ban_ad_spam] reaction update failed:", error);
        }
      }
    },
  }];

  listenMessageHandler = async (msg: MessageContext): Promise<void> => {
    const message: any = msg;
    if (message.isOutgoing || !textOf(message).toLowerCase().includes("ban广告")) return;
    const targetId = replyId(message);
    if (!targetId || !message.chat) return;
    const client: any = await getGlobalClient();
    const me = await client.getMe();
    if (!mentionMe(message, me)) return;
    const chatId = message.chat;
    const expiresAt = Date.now() + TTL;
    const voteMessage: any = await client.sendText(chatId, html(voteText(0, expiresAt)), { replyTo: targetId });
    const vote: Vote = { chatId, targetId, voteId: voteMessage.id, expiresAt, inFlight: false, timer: setTimeout(async () => {
      const key = this.key(chatId, voteMessage.id);
      if (this.votes.get(key)?.voteId !== voteMessage.id) return;
      this.votes.delete(key);
      await client.editMessage({ chatId, message: voteMessage.id, text: html("⌛ <b>Ban 投票已超时</b>。") }).catch(() => undefined);
    }, TTL) };
    this.votes.set(this.key(chatId, voteMessage.id), vote);
  };

  cleanup(): void { for (const vote of this.votes.values()) clearTimeout(vote.timer); this.votes.clear(); }
}
export default new BanAdSpamNext();
