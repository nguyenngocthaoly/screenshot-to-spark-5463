import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, useNavigate, HeadContent, Scripts, type ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Moon, Sun, Database, RotateCcw } from "lucide-react";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { hydrateStore, resetDemo, setPersona, setState, useApp, personaLanding } from "@/lib/store";
import { pendingReviewCount } from "@/lib/offsetCalc";
import { DataPanel } from "@/components/app/DataPanel";
import { Btn, selectCls } from "@/components/app/bits";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-5xl font-bold">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">This page doesn't exist.</p>
        <Link to="/" className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Go home</Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Something went wrong. Try again or go home.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Try again</button>
          <a href="/" className="rounded-md border px-4 py-2 text-sm">Go home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Supplier debt offset" },
      { name: "description", content: "Offset supplier advance credit against open bills, with FX, minutes and approvals." },
      { property: "og:title", content: "Supplier debt offset" },
      { property: "og:description", content: "Offset supplier advance credit against open bills." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function Header() {
  const s = useApp();
  const nav = useNavigate();
  const pending = pendingReviewCount(s.data);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const link = "rounded px-2 py-1 text-xs hover:bg-accent";
  return (
    <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2">
      <span className="mr-2 text-sm font-semibold"><span className="text-primary">●</span> Debt offset</span>
      <nav className="flex gap-1">
        <Link to="/" className={link} activeProps={{ className: "bg-accent text-accent-foreground font-medium" }} activeOptions={{ exact: true }}>Supplier workspace</Link>
        <Link to="/overview" className={link} activeProps={{ className: "bg-accent text-accent-foreground font-medium" }}>
          Overview {pending > 0 && <span className="ml-1 rounded-full bg-warning px-1.5 text-[10px] font-semibold text-foreground">{pending}</span>}
        </Link>
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted-foreground">Viewing as</label>
        <select aria-label="Viewing as" className={selectCls} value={s.data.users.find((u) => u.name === s.userName)?.id ?? ""} onChange={(e) => {
          const persona = s.data.users.find((u) => u.id === e.target.value);
          if (!persona) return;
          setPersona(persona.id); nav({ to: personaLanding(persona.defaultRole) });
        }}>
          {s.data.users.map((u) => <option key={u.id} value={u.id}>{u.name} – {u.title ?? u.defaultRole}</option>)}
        </select>
        <Btn tone={s.dataPanelOpen ? "primary" : "secondary"} onClick={() => setState({ dataPanelOpen: !s.dataPanelOpen })}><Database className="size-3.5" /> Edit data</Btn>
        <Btn tone="secondary" onClick={() => { resetDemo(); nav({ to: "/" }); }}><RotateCcw className="size-3.5" /> Reset demo</Btn>
        <button aria-label="Toggle dark mode" className="rounded p-1.5 hover:bg-accent" onClick={() => { const d = !dark; document.documentElement.classList.toggle("dark", d); localStorage.setItem("theme", d ? "dark" : "light"); setDark(d); }}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>
    </header>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { dataPanelOpen } = useApp();
  useEffect(() => hydrateStore(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen flex-col">
        <Header />
        <div className="flex flex-1 flex-col lg:flex-row">
          <main className="min-w-0 flex-1"><Outlet /></main>
          {dataPanelOpen && <DataPanel />}
        </div>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}
