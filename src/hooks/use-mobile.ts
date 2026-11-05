import * as React from "react"

const MOBILE_BREAKPOINT = 768
const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(query)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

// The server snapshot (false) is also used while hydrating, so phones no longer render a different tree than the server sent
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
