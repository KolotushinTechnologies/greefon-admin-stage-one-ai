import type { AppEnv } from "../../config/env.js";

export type ProductBrand = {
  productName: string;
  assistantName: string;
  assistantChatPlaceholder: string;
  assistantThinkingLabel: string;
  openAssistantLabel: string;
};

export function productBrand(env: AppEnv): ProductBrand {
  const productName = env.PRODUCT_NAME.trim() || "Greefon OS";
  const assistantName = env.ASSISTANT_NAME.trim() || productName.replace(/\s*OS$/i, "").trim() || "Assistant";
  return {
    productName,
    assistantName,
    assistantChatPlaceholder: env.ASSISTANT_CHAT_PLACEHOLDER.trim() || `Сообщение · ${assistantName}`,
    assistantThinkingLabel: env.ASSISTANT_THINKING_LABEL.trim() || `${assistantName} считает…`,
    openAssistantLabel: env.ASSISTANT_OPEN_LABEL.trim() || assistantName,
  };
}
