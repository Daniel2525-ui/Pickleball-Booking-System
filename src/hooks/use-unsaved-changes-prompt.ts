import { useEffect } from "react";

/** Reloading or closing the tab while `dirty` asks first. */
// shortcut: in-app links (sidebar) still leave without asking; intercept router navigation if staff lose edits that way
export function useUnsavedChangesPrompt(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
