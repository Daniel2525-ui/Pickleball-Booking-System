/** The one header every admin page uses: title, a line of what the page is for, and its main actions. */
export function AdminPageHeader({
  title,
  description,
  eyebrow,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small line above the title */
  eyebrow?: React.ReactNode;
  /** Actions on the right */
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-14 z-20 bg-background/95 backdrop-blur-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pt-6 pb-4 border-b -mx-4 px-4 lg:-mx-8 lg:px-8">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold text-primary">{eyebrow}</p>}
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>}
    </header>
  );
}
