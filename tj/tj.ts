import { Plugin } from "@utils/pluginBase";
import type { MessageContext } from "@mtcute/dispatcher";
import { getGlobalClient } from "@utils/runtimeManager";
import { thtml as html } from "@mtcute/html-parser";

function textOf(m: any): string { return String(m?.text || m?.message || "").trim(); }
function senderOf(m: any): string { const s=m?.sender; return s?.username ? `@${s.username}` : [s?.firstName,s?.lastName].filter(Boolean).join(" ") || String(m?.senderId || "未知用户"); }
function dateOf(m: any): string { const d=m?.date instanceof Date?m.date:new Date(Number(m?.date||0)*1000); return Number.isNaN(d.getTime())?"未知时间":d.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false}); }

class TjNext extends Plugin {
  name="tj";
  description="统计指定消息的全部回复";
  cmdHandlers={tj: async (msg: MessageContext) => {
    const m:any=msg, client:any=await getGlobalClient();
    const target= m.replyToMessage;
    if(!target){await m.edit({text:html("请回复目标消息后发送 .tj")});return;}
    const replies:any[]=[];
    if(typeof client.iterMessages==='function'){
      for await(const item of client.iterMessages(m.chat.id,{replyTo:target.id,limit:1000})) replies.push(item);
    }
    if(!replies.length){await m.edit({text:html("目标消息暂无回复。")});return;}
    const lines=replies.reverse().map((r,i)=>`${i+1}. <b>${senderOf(r)}</b> | ${dateOf(r)}\n   ${textOf(r)||"[非文本消息]"}`);
    for(let i=0;i<lines.length;i+=8) await client.sendText(m.chat.id,lines.slice(i,i+8).join("\n"),{parseMode:"html"});
  }};
}
export default new TjNext();
