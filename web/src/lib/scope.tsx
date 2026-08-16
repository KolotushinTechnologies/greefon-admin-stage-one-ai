import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

const KEY = "greefon-os-branch";

type Scope = {
  branchCrmId: string;
  setBranchCrmId: (id: string) => void;
};

const ScopeContext = createContext<Scope>({
  branchCrmId: "",
  setBranchCrmId: () => undefined,
});

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [branchCrmId, setBranch] = useState(() => localStorage.getItem(KEY) ?? "");
  const value = useMemo(
    () => ({
      branchCrmId,
      setBranchCrmId: (id: string) => {
        setBranch(id);
        if (id.length > 0) {
          localStorage.setItem(KEY, id);
        } else {
          localStorage.removeItem(KEY);
        }
      },
    }),
    [branchCrmId],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): Scope {
  return useContext(ScopeContext);
}

export function withBranch(path: string, branchCrmId: string): string {
  if (!branchCrmId) {
    return path;
  }
  return `${path}${path.includes("?") ? "&" : "?"}branchCrmId=${encodeURIComponent(branchCrmId)}`;
}
