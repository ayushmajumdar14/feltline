import { createFileRoute, useNavigate, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { isLocalBot } from "@/lib/local";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  beforeLoad: () => {
    if (isLocalBot()) throw redirect({ to: "/tables" });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Feltline" },
      { name: "description", content: "Sign in or create your private Feltline workspace." },
      { property: "og:title", content: "Sign in — Feltline" },
      { property: "og:description", content: "Your own isolated workspace for tables, hands and opponents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/tables", data: { display_name: name || undefined } },
        });
        if (error) throw error;
        if (data.session) nav({ to: "/tables" });
        else setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        nav({ to: "/tables" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function magic() {
    if (!email) return void toast.error("Enter your email first");
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + "/tables" },
    });
    if (error) toast.error(error.message);
    else setSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center felt px-4">
      <div className="hud-panel w-full max-w-sm p-6">
        <Link to="/" className="font-display text-lg font-bold uppercase tracking-widest text-gold">
          Feltline
        </Link>
        {sent ? (
          <div className="mt-6 space-y-2">
            <h1 className="font-display text-2xl font-semibold uppercase">Check your email</h1>
            <p className="text-sm text-muted-foreground">We sent a link to {email}. Open it to finish signing in.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <h1 className="font-display text-2xl font-semibold uppercase">
              {mode === "in" ? "Sign in" : "Create workspace"}
            </h1>
            {mode === "up" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Display name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" variant="take" className="w-full" disabled={busy}>
              {mode === "in" ? "Sign in" : "Sign up"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={magic}>
              Email me a magic link
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {mode === "in" ? "New here?" : "Have an account?"}{" "}
              <button type="button" className="text-gold underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>
                {mode === "in" ? "Create a workspace" : "Sign in"}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
