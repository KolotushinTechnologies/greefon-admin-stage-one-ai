import { MASTER_KOLOTUSHIN } from "./types.js";

export function isMasterKolotushin(user: { isOwner?: boolean | undefined; honorific?: string | null | undefined }): boolean {
  return user.isOwner === true || user.honorific === MASTER_KOLOTUSHIN;
}
