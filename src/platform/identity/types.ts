import { z } from "zod";

export const actorKindSchema = z.enum(["staff", "parent", "student", "owner", "system"]);
export type ActorKind = z.infer<typeof actorKindSchema>;

export const staffRoleSchema = z.enum(["superadmin", "admin", "operator"]);
export type StaffRole = z.infer<typeof staffRoleSchema>;

export const userStatusSchema = z.enum(["active", "disabled"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const MASTER_KOLOTUSHIN = "Мастер Колотушин";

export const staffUserSchema = z.object({
  _id: z.string(),
  telegramUserId: z.string(),
  username: z.string().nullable(),
  displayName: z.string().nullable(),
  honorific: z.string().nullable(),
  isOwner: z.boolean(),
  actorKind: actorKindSchema,
  role: staffRoleSchema.nullable(),
  status: userStatusSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type StaffUser = z.infer<typeof staffUserSchema>;

export const ROLE_RANK: Record<StaffRole, number> = {
  operator: 1,
  admin: 2,
  superadmin: 3,
};

export function hasAtLeast(role: StaffRole | null, required: StaffRole): boolean {
  if (!role) {
    return false;
  }
  return ROLE_RANK[role] >= ROLE_RANK[required];
}
