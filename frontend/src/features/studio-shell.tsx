"use client";

import * as stylex from "@stylexjs/stylex";
import {
  BarChart3,
  FileText,
  Layers3,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  ScrollText,
  Settings,
  SlidersHorizontal,
  SquareKanban,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const desktop = "@media (min-width: 761px)";
const mobile = "@media (max-width: 760px)";
const reducedMotion = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  shell: {
    display: { default: "grid", [mobile]: "block" },
    gridTemplateColumns: "252px minmax(0, 1fr)",
    minHeight: "100dvh",
    paddingTop: { default: 0, [mobile]: "calc(56px + env(safe-area-inset-top))" },
  },
  shellCollapsed: {
    gridTemplateColumns: { [desktop]: "52px minmax(0, 1fr)" },
  },
  mobileHeader: {
    alignItems: "center",
    backdropFilter: "blur(14px)",
    backgroundColor: "color-mix(in srgb, var(--bg) 92%, transparent)",
    borderBottomColor: "var(--line)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    display: { default: "none", [mobile]: "flex" },
    height: "calc(56px + env(safe-area-inset-top))",
    insetBlockStart: 0,
    insetInline: 0,
    justifyContent: "space-between",
    paddingBlockEnd: 9,
    paddingBlockStart: "max(9px, env(safe-area-inset-top))",
    paddingInline: 14,
    position: "fixed",
    zIndex: 40,
  },
  brand: {
    alignItems: "center",
    display: "flex",
    fontSize: "0.95rem",
    fontWeight: 650,
    gap: 9,
    letterSpacing: "-0.01em",
    minWidth: 0,
  },
  brandMark: {
    backgroundImage: "var(--sidebar-brand-bg)",
    borderColor: "var(--sidebar-brand-line)",
    borderRadius: 8,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "inset 0 1px var(--sidebar-brand-highlight)",
    color: "var(--sidebar-brand-fg)",
    display: "grid",
    fontSize: 9,
    fontWeight: 750,
    height: 27,
    placeItems: "center",
    letterSpacing: "-0.04em",
    width: 27,
  },
  menuButton: {
    display: { default: "none", [mobile]: "grid" },
    fontSize: 20,
    height: 36,
    padding: 0,
    placeItems: "center",
    width: 36,
  },
  scrim: {
    backgroundColor: { default: "#0008", ":hover": "#0008", ":active": "#0008" },
    borderRadius: 0,
    borderWidth: 0,
    display: { default: "none", [mobile]: "block" },
    inset: 0,
    padding: 0,
    position: "fixed",
    zIndex: 44,
  },
  sidebar: {
    backgroundColor: "var(--sidebar)",
    borderRightColor: "var(--line)",
    borderRightStyle: "solid",
    borderRightWidth: 1,
    boxShadow: { [mobile]: "18px 0 50px #0007" },
    display: "flex",
    flexDirection: "column",
    height: "100dvh",
    insetBlockStart: 0,
    insetInlineStart: { [mobile]: 0 },
    overflow: "hidden",
    overscrollBehavior: "contain",
    paddingBlockEnd: { default: 12, [mobile]: "calc(12px + env(safe-area-inset-bottom))" },
    paddingBlockStart: { default: 14, [mobile]: "calc(14px + env(safe-area-inset-top))" },
    paddingInline: 12,
    pointerEvents: { [mobile]: "none" },
    position: { default: "sticky", [mobile]: "fixed" },
    transform: { [mobile]: "translateX(-102%)" },
    transitionDelay: {
      [mobile]: { default: "0s, 180ms", [reducedMotion]: "0s" },
    },
    transitionDuration: {
      [mobile]: { default: "180ms, 0s", [reducedMotion]: "0s" },
    },
    transitionProperty: {
      [mobile]: { default: "transform, visibility", [reducedMotion]: "none" },
    },
    transitionTimingFunction: { [mobile]: "ease, linear" },
    visibility: { [mobile]: "hidden" },
    width: { [mobile]: "min(85vw, 290px)" },
    zIndex: { default: 30, [mobile]: 45 },
  },
  sidebarCollapsed: {
    paddingInline: { [desktop]: 6 },
  },
  sidebarOpen: {
    pointerEvents: { [mobile]: "auto" },
    transform: { [mobile]: "translateX(0)" },
    transitionDelay: { [mobile]: "0s" },
    visibility: { [mobile]: "visible" },
  },
  sidebarHead: {
    alignItems: "center",
    display: "flex",
    gap: 8,
    justifyContent: "space-between",
    paddingBlockEnd: 15,
    paddingBlockStart: 3,
    paddingInline: 8,
  },
  sidebarHeadCollapsed: {
    justifyContent: { [desktop]: "center" },
    paddingInline: { [desktop]: 0 },
  },
  hideWhenCollapsed: {
    display: { [desktop]: "none" },
  },
  productTag: {
    color: "var(--sidebar-tag)",
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: "0.11em",
  },
  collapseButton: {
    display: { default: "grid", [mobile]: "none" },
    flexShrink: 0,
    height: 26,
    padding: 0,
    placeItems: "center",
    width: 26,
  },
  drawerClose: {
    display: { default: "none", [mobile]: "grid" },
    flexShrink: 0,
    height: 26,
    padding: 0,
    placeItems: "center",
    width: 26,
  },
  newTask: {
    alignItems: "center",
    backgroundColor: {
      default: "var(--sidebar-control)",
      ":hover": "var(--sidebar-control-hover)",
    },
    borderColor: { default: "var(--line-strong)", ":hover": "var(--sidebar-line-hover)" },
    borderRadius: 9,
    borderStyle: "solid",
    borderWidth: 1,
    boxShadow: "0 1px 2px #0004",
    display: "flex",
    fontWeight: 600,
    gap: 9,
    marginBlock: "0 13px",
    marginInline: 2,
    minHeight: 38,
    paddingBlock: 0,
    paddingInline: 10,
  },
  collapsedLink: {
    justifyContent: { [desktop]: "center" },
    paddingInline: { [desktop]: 0 },
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    gap: 15,
    minHeight: 0,
    overflowY: "auto",
  },
  navSection: {
    display: "grid",
    gap: 2,
  },
  navHeading: {
    color: "var(--sidebar-muted)",
    fontSize: 10,
    fontWeight: 650,
    letterSpacing: "0.075em",
    marginBlock: "0 5px",
    marginInline: 9,
    textTransform: "uppercase",
  },
  navLink: {
    alignItems: "center",
    backgroundColor: { default: "transparent", ":hover": "var(--sidebar-control)" },
    borderRadius: 8,
    color: { default: "var(--sidebar-nav)", ":hover": "var(--fg)" },
    display: "flex",
    fontSize: "0.9rem",
    gap: 10,
    minHeight: 36,
    paddingBlock: 0,
    paddingInline: 10,
    transitionDuration: "120ms",
    transitionProperty: "background-color, color",
    transitionTimingFunction: "ease",
  },
  navLinkActive: {
    backgroundColor: { default: "var(--accent-soft)", ":hover": "var(--accent-soft)" },
    boxShadow: "inset 2px 0 var(--accent)",
    color: { default: "var(--sidebar-nav-active)", ":hover": "var(--sidebar-nav-active)" },
  },
  navIcon: {
    flexShrink: 0,
    height: 17,
    opacity: 0.82,
    width: 17,
  },
  navIconActive: {
    color: "var(--accent)",
    opacity: 1,
  },
  sidebarFooter: {
    borderTopColor: "var(--line)",
    borderTopStyle: "solid",
    borderTopWidth: 1,
    display: "grid",
    gap: 6,
    marginBlockStart: "auto",
    paddingBlockStart: 10,
  },
  footerText: {
    alignItems: "center",
    color: "var(--sidebar-footer)",
    display: "flex",
    fontSize: 10,
    gap: 8,
    margin: 0,
    paddingBlock: 3,
    paddingInline: 11,
  },
  main: {
    minWidth: 0,
  },
});

const PRIMARY_NAV = [
  ["/agent", "Projects & workbench", SquareKanban],
  ["/", "Status", BarChart3],
  ["/models", "Models", Layers3],
  ["/agent/automations", "Automations", Workflow],
] as const;
const LIBRARY_NAV = [
  ["/recipes", "Recipes", FileText],
  ["/usage", "Usage", BarChart3],
  ["/configure", "Configure", SlidersHorizontal],
  ["/logs", "Logs", ScrollText],
] as const;

type NavItem = readonly [href: string, label: string, Icon: LucideIcon];

function activeRoute(pathname: string, href: string) {
  if (href === "/" || href === "/agent") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ collapsed = false, close }: { collapsed?: boolean; close?: () => void }) {
  return (
    <Link
      href="/"
      aria-label="Local Studio home"
      title={collapsed ? "Local Studio" : undefined}
      onClick={close}
      {...stylex.props(styles.brand, collapsed && styles.hideWhenCollapsed)}
    >
      <span aria-hidden="true" {...stylex.props(styles.brandMark)}>
        LS
      </span>
      <span>Local Studio</span>
    </Link>
  );
}

function NavLinks({
  items,
  pathname,
  collapsed,
}: {
  items: readonly NavItem[];
  pathname: string;
  collapsed: boolean;
}) {
  return items.map(([href, label, Icon]) => {
    const active = activeRoute(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        aria-label={label}
        title={collapsed ? label : undefined}
        {...stylex.props(
          styles.navLink,
          active && styles.navLinkActive,
          collapsed && styles.collapsedLink,
        )}
      >
        <Icon
          aria-hidden="true"
          {...stylex.props(styles.navIcon, active && styles.navIconActive)}
        />
        <span {...stylex.props(collapsed && styles.hideWhenCollapsed)}>{label}</span>
      </Link>
    );
  });
}

function SidebarFooter({
  collapsed,
  closeMobile,
  pathname,
}: {
  collapsed: boolean;
  closeMobile: () => void;
  pathname: string;
}) {
  const active = activeRoute(pathname, "/settings");
  return (
    <div {...stylex.props(styles.sidebarFooter)}>
      <Link
        href="/settings"
        aria-current={active ? "page" : undefined}
        aria-label="Settings"
        title={collapsed ? "Settings" : undefined}
        onClick={closeMobile}
        {...stylex.props(
          styles.navLink,
          active && styles.navLinkActive,
          collapsed && styles.collapsedLink,
        )}
      >
        <Settings
          aria-hidden="true"
          {...stylex.props(styles.navIcon, active && styles.navIconActive)}
        />
        <span {...stylex.props(collapsed && styles.hideWhenCollapsed)}>Settings</span>
      </Link>
      <p {...stylex.props(styles.footerText, collapsed && styles.hideWhenCollapsed)}>
        Private, local-first workspace
      </p>
    </div>
  );
}

function Sidebar({
  collapsed,
  closeMobile,
  mobileOpen,
  pathname,
  sidebar,
  toggleSidebar,
}: {
  collapsed: boolean;
  closeMobile: () => void;
  mobileOpen: boolean;
  pathname: string;
  sidebar: React.RefObject<HTMLElement | null>;
  toggleSidebar: () => void;
}) {
  return (
    <aside
      ref={sidebar}
      id="app-sidebar"
      {...(mobileOpen
        ? { role: "dialog" as const, "aria-modal": true, "aria-label": "Main navigation" }
        : {})}
      {...stylex.props(
        styles.sidebar,
        collapsed && styles.sidebarCollapsed,
        mobileOpen && styles.sidebarOpen,
      )}
    >
      <div {...stylex.props(styles.sidebarHead, collapsed && styles.sidebarHeadCollapsed)}>
        <Brand collapsed={collapsed} close={closeMobile} />
        <span {...stylex.props(styles.productTag, collapsed && styles.hideWhenCollapsed)}>
          LOCAL WORKSPACE
        </span>
        <button
          type="button"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleSidebar}
          {...stylex.props(styles.collapseButton)}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
        <button
          type="button"
          aria-label="Close navigation"
          title="Close navigation"
          onClick={closeMobile}
          {...stylex.props(styles.drawerClose)}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <Link
        href="/agent?new=1"
        aria-label="New task"
        title={collapsed ? "New task" : undefined}
        onClick={closeMobile}
        {...stylex.props(styles.newTask, collapsed && styles.collapsedLink)}
      >
        <Plus aria-hidden="true" {...stylex.props(styles.navIcon)} />
        <span {...stylex.props(collapsed && styles.hideWhenCollapsed)}>New task</span>
      </Link>
      <nav aria-label="Main navigation" onClick={closeMobile} {...stylex.props(styles.nav)}>
        <div {...stylex.props(styles.navSection)}>
          <NavLinks items={PRIMARY_NAV} pathname={pathname} collapsed={collapsed} />
        </div>
        <div {...stylex.props(styles.navSection)}>
          <p {...stylex.props(styles.navHeading, collapsed && styles.hideWhenCollapsed)}>
            Library & operations
          </p>
          <NavLinks items={LIBRARY_NAV} pathname={pathname} collapsed={collapsed} />
        </div>
      </nav>
      <SidebarFooter collapsed={collapsed} closeMobile={closeMobile} pathname={pathname} />
    </aside>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const closeMobile = () => setMobileOpen(false);

  useMountSubscription(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") return setMobileOpen(false);
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        sidebar.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const outside = !sidebar.current?.contains(document.activeElement);
      if (outside || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
    };
  }, [mobileOpen]);
  useMountSubscription(() => setMobileOpen(false), [pathname]);
  useMountSubscription(() => {
    const query = matchMedia("(max-width: 760px)");
    const closeOnDesktop = () => {
      if (!query.matches) setMobileOpen(false);
    };
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);
  useMountSubscription(() => {
    setCollapsed(localStorage.getItem("local-studio.sidebar-collapsed") === "1");
  }, []);
  useMountSubscription(() => {
    if (!mobileOpen) return;
    sidebar.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => menuButton.current?.focus();
  }, [mobileOpen]);

  const toggleSidebar = () =>
    setCollapsed((value) => {
      localStorage.setItem("local-studio.sidebar-collapsed", value ? "0" : "1");
      return !value;
    });
  return (
    <div {...stylex.props(styles.shell, collapsed && styles.shellCollapsed)}>
      <header inert={mobileOpen || undefined} {...stylex.props(styles.mobileHeader)}>
        <Brand close={closeMobile} />
        <button
          ref={menuButton}
          type="button"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          aria-controls="app-sidebar"
          onClick={() => setMobileOpen((open) => !open)}
          {...stylex.props(styles.menuButton)}
        >
          {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </header>
      {mobileOpen && (
        <div
          role="presentation"
          aria-hidden="true"
          onPointerDown={closeMobile}
          {...stylex.props(styles.scrim)}
        />
      )}
      <Sidebar
        collapsed={collapsed}
        closeMobile={closeMobile}
        mobileOpen={mobileOpen}
        pathname={pathname}
        sidebar={sidebar}
        toggleSidebar={toggleSidebar}
      />
      <main inert={mobileOpen || undefined} {...stylex.props(styles.main)}>
        {children}
      </main>
    </div>
  );
}
