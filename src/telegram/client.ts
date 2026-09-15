const TELEGRAM_API = "https://api.telegram.org";

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
}

function apiUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  const res = await fetch(apiUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Telegram send failed: ${res.status} ${errBody}`);
  }
}

export async function getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
  const res = await fetch(
    apiUrl("getUpdates") + `?offset=${offset}&timeout=${timeoutSeconds}`,
    { signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000) },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Telegram getUpdates failed: ${res.status} ${errBody}`);
  }

  const body = await res.json();
  return body.result as TelegramUpdate[];
}

export function extractTextMessage(update: TelegramUpdate): { chatId: string; text: string } | null {
  const message = update.message;
  if (!message?.text) return null;
  return { chatId: String(message.chat.id), text: message.text };
}
