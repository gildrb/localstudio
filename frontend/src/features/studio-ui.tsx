import Link from "next/link";
import type { ReactNode } from "react";
import type { Json } from "./studio-api";

export function ErrorText({ value }: { value: string }) {
  return value ? <p className="error">{value}</p> : null;
}
export function JsonView({ value }: { value: Json | null }) {
  return <pre>{value === null ? "Loading…" : JSON.stringify(value, null, 2)}</pre>;
}
export function Page({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page">
      <header>
        <div>
          <h1>{title}</h1>
          <p>Private by default. Local services keep custody of your data.</p>
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}
export function Tabs({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className="tabs">
      {items.map(([href, label]) => (
        <Link key={href} href={href}>
          {label}
        </Link>
      ))}
    </div>
  );
}
