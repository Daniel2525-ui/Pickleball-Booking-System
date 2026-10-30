// Remounts on every top-level navigation, so each page fades and rises in (keyframes in globals.css)
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
