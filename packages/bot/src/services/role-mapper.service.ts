import type { RoleKey } from "../types.js";

const ROLE_MAP: Record<string, RoleKey> = {
  "1段": "pemula",
  "2段": "pemula-atas",
  "3段": "menengah",
  "4段": "mahir",
};

const ROLE_ORDER: RoleKey[] = ["pemula", "pemula-atas", "menengah", "mahir"];

export function resolveRoleKey(roleNames: string[]): RoleKey {
  let best: RoleKey = "pemula";
  let bestIndex = 0;

  for (const roleName of roleNames) {
    const key = ROLE_MAP[roleName];
    if (key) {
      const idx = ROLE_ORDER.indexOf(key);
      if (idx > bestIndex) {
        best = key;
        bestIndex = idx;
      }
    }
  }

  return best;
}
