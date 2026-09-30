import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Eye,
  Gauge,
  Images,
  Info,
  Link2,
  Loader2,
  LogOut,
  Medal,
  Palette,
  Plug,
  Shield,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { api, ApiError } from "@/lib/api";
import { themeVars } from "@/lib/theme";
import { DraftProvider, useDraft } from "./draft";
import { Preview } from "./Preview";
import { AboutPage } from "./pages/AboutPage";
import { AppearancePage } from "./pages/AppearancePage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { BadgesPage, LinksPage } from "./pages/LinksPage";
import { CatalogPage, MediaPage, OverviewPage, SecurityPage } from "./pages/MiscPages";
import { ProfilePage } from "./pages/ProfilePage";
import { VaultPage } from "./pages/VaultPage";

export function App() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, retry: false });
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupStatus, enabled: me.isError });
  if (me.isLoading || (me.isError && setup.isLoading)) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (me.isError) return setup.data?.needed ? <Setup /> : <Login />;
  return (
    <Router base="/admin">
      <DraftProvider>
        <Shell username={me.data!.username} />
      </DraftProvider>
    </Router>
  );
}

function AuthCard({ title, subtitle, children, onSubmit }: { title: string; subtitle: string; children: React.ReactNode; onSubmit: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4" style={{ background: "radial-gradient(ellipse at top, #2e1065 0%, transparent 60%), var(--background)" }}>
      <form
        className="w-full max-w-sm rounded-2xl border bg-card/80 p-6 shadow-2xl backdrop-blur"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <img src="/img/brand/icon.svg" alt="" className="mx-auto mb-4 size-14" />
        <h1 className="text-center font-display text-xl font-bold">{title}</h1>
        <p className="mb-6 text-center text-sm text-muted-foreground">{subtitle}</p>
        <div className="grid gap-4">{children}</div>
      </form>
    </main>
  );
}

function Login() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(false);
  const m = useMutation({
    mutationFn: () => api.login(username, password, needCode ? code : undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
    onError: (e) => {
      if (e instanceof ApiError && e.totpRequired) {
        if (needCode) toast.error(e.message);
        setNeedCode(true);
        setCode("");
        return;
      }
      toast.error(e instanceof ApiError ? e.message : "Login failed");
    },
  });
  return (
    <AuthCard title="Sign in" subtitle="Manage your card and display case." onSubmit={() => m.mutate()}>
      {!needCode ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="u">Username</Label>
            <Input id="u" autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="p">Password</Label>
            <Input id="p" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="c">Authentication code</Label>
          <Input id="c" inputMode="numeric" autoComplete="one-time-code" autoFocus className="text-center font-mono text-lg tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} />
          <p className="text-xs text-muted-foreground">6-digit code from your authenticator app, or one of your recovery codes.</p>
        </div>
      )}
      <Button type="submit" disabled={m.isPending || !username || !password || (needCode && !code)}>
        {m.isPending && <Loader2 className="size-4 animate-spin" />}
        {needCode ? "Verify" : "Sign in"}
      </Button>
      {needCode && (
        <Button type="button" variant="ghost" onClick={() => setNeedCode(false)}>
          Back
        </Button>
      )}
    </AuthCard>
  );
}

/** First run: create the admin account with the setup code from the server log. */
function Setup() {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.setup(code, username, password),
    onSuccess: () => {
      toast.success("Welcome! Your dashboard is ready.");
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fields) setErrors(e.fields);
      toast.error(e instanceof ApiError ? e.message : "Setup failed");
    },
  });
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <AuthCard title="Welcome to OnPresence" subtitle="Create your admin account to start editing your card." onSubmit={() => m.mutate()}>
      <div className="grid gap-1.5">
        <Label htmlFor="sc">Setup code</Label>
        <Input id="sc" autoFocus autoComplete="off" className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} />
        <p className="text-xs text-muted-foreground">
          Printed in the server log on first start. With Docker: <code className="rounded bg-muted px-1">docker logs onpresence</code>
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="su">Username</Label>
        <Input id="su" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!errors.username} />
        {errors.username && <p className="text-xs text-destructive">{errors.username}</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="sp">Password</Label>
        <Input id="sp" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!errors.password} />
        <p className={errors.password ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{errors.password ?? "At least 10 characters."}</p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="sp2">Repeat password</Label>
        <Input id="sp2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} />
        {mismatch && <p className="text-xs text-destructive">Passwords do not match</p>}
      </div>
      <Button type="submit" disabled={m.isPending || !code || !username || password.length < 10 || confirm !== password}>
        {m.isPending && <Loader2 className="size-4 animate-spin" />}
        Create account
      </Button>
    </AuthCard>
  );
}

const NAV = [
  {
    label: "Card",
    items: [
      { href: "/", label: "Overview", icon: Gauge },
      { href: "/profile", label: "Profile", icon: UserRound, preview: true },
      { href: "/appearance", label: "Appearance", icon: Palette, preview: true },
      { href: "/integrations", label: "Integrations", icon: Plug, preview: true },
      { href: "/links", label: "Links", icon: Link2, preview: true },
      { href: "/badges", label: "Badges", icon: Medal, preview: true },
    ],
  },
  {
    label: "Hobbies",
    items: [{ href: "/vault", label: "Display case", icon: Archive }],
  },
  {
    label: "Assets",
    items: [
      { href: "/media", label: "Media library", icon: Images },
      { href: "/catalog", label: "Decoration packs", icon: Sparkles },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/security", label: "Security & data", icon: Shield },
      { href: "/about", label: "About", icon: Info },
    ],
  },
];

function Shell({ username }: { username: string }) {
  const [location] = useLocation();
  const qc = useQueryClient();
  const { draft, dirty, saving, save, discard } = useDraft();
  const [previewOpen, setPreviewOpen] = useState(false);
  const current = NAV.flatMap((g) => g.items).find((i) => i.href === location);
  const showPreview = !!current && "preview" in current && current.preview;

  const logout = async () => {
    await api.logout().catch(() => {});
    qc.clear();
    window.location.replace("/admin");
  };

  return (
    <div data-brand style={draft ? themeVars(draft.settings) : undefined}>
      <SidebarProvider>
        <Sidebar variant="inset">
          <SidebarHeader>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <img src="/img/brand/icon.svg" alt="" className="size-8" />
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-bold">{draft?.name ?? "OnPresence"}</p>
                <p className="text-xs text-muted-foreground">Dashboard</p>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {NAV.map((g) => (
              <SidebarGroup key={g.label}>
                <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {g.items.map((i) => (
                      <SidebarMenuItem key={i.href}>
                        <SidebarMenuButton asChild isActive={location === i.href}>
                          <Link href={i.href}>
                            <i.icon />
                            <span>{i.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/" target="_blank" rel="noopener">
                    <Eye />
                    <span>View site</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={logout}>
                  <LogOut />
                  <span>Sign out ({username})</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur">
            <SidebarTrigger />
            <span className="text-sm font-medium">{current?.label ?? "Dashboard"}</span>
            {showPreview && (
              <Button variant="secondary" size="sm" className="ml-auto xl:hidden" onClick={() => setPreviewOpen(true)}>
                <Eye className="size-4" /> Preview
              </Button>
            )}
          </header>

          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1 px-4 pb-32 pt-6 sm:px-8">
              <div className="mx-auto max-w-3xl">
                <Switch>
                  <Route path="/" component={OverviewPage} />
                  <Route path="/profile" component={ProfilePage} />
                  <Route path="/appearance" component={AppearancePage} />
                  <Route path="/integrations" component={IntegrationsPage} />
                  <Route path="/links" component={LinksPage} />
                  <Route path="/badges" component={BadgesPage} />
                  <Route path="/vault" component={VaultPage} />
                  <Route path="/media" component={MediaPage} />
                  <Route path="/catalog" component={CatalogPage} />
                  <Route path="/security" component={SecurityPage} />
                  <Route path="/about" component={AboutPage} />
                  <Route>
                    <p className="text-muted-foreground">Page not found.</p>
                  </Route>
                </Switch>
              </div>
            </main>
            {showPreview && (
              <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[480px] flex-none border-l xl:block">
                <Preview />
              </aside>
            )}
          </div>

          {dirty && (
            <div className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4" role="status">
              <div className="flex w-full max-w-xl items-center gap-3 rounded-2xl border bg-popover/95 p-3 pl-4 shadow-2xl backdrop-blur">
                <span className="flex-1 text-sm">You have unsaved changes</span>
                <Button variant="ghost" onClick={discard} disabled={saving}>
                  Discard
                </Button>
                <Button onClick={save} disabled={saving}>
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          )}
        </SidebarInset>
      </SidebarProvider>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-lg">
          <SheetTitle className="sr-only">Preview</SheetTitle>
          <Preview className="pt-10" />
        </SheetContent>
      </Sheet>
    </div>
  );
}
