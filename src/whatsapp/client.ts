const GRAPH_API_VERSION = "v21.0";

interface InboundMessage {
  from: string;
  text: string;
  messageId: string;
}

export function extractInboundMessages(body: any): InboundMessage[] {
  const messages: InboundMessage[] = [];
  const entries = body?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (msg.type === "text") {
          messages.push({
            from: msg.from,
            text: msg.text.body,
            messageId: msg.id,
          });
        }
      }
    }
  }
  return messages;
}

export async function sendWhatsAppMessage(to: string, body: string): Promise<void> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set");
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${errBody}`);
  }
}
