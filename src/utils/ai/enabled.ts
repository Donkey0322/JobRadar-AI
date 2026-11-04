import { CONFIG } from "@/config";

export function isAIEnabled(): boolean {
  return CONFIG.ai.enabled && process.env.AI_MODE !== "DOWN";
}
