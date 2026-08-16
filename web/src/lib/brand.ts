import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type ProductBrand = {
  productName: string;
  assistantName: string;
  assistantChatPlaceholder: string;
  assistantThinkingLabel: string;
  openAssistantLabel: string;
};

type AuthConfig = {
  brand?: ProductBrand;
};

const FALLBACK: ProductBrand = {
  productName: "OS",
  assistantName: "Ассистент",
  assistantChatPlaceholder: "Сообщение…",
  assistantThinkingLabel: "Считает…",
  openAssistantLabel: "Ассистент",
};

export function useBrand(): ProductBrand {
  const config = useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api<AuthConfig>("/v1/auth/config"),
    staleTime: 60_000,
  });
  return config.data?.brand ?? FALLBACK;
}
