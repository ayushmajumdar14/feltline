import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { settingsQ, tablesQ } from "@/lib/queries";
import { isLocalBot } from "@/lib/local";
import * as bot from "@/lib/bot-api";
import { CONSENT_ITEMS, canEnableAutoplay } from "@/lib/poker";
import { CONTRACT_DOC } from "@/lib/hud-events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Feltline" },
      { name: "description", content: "Nickname, blinds, strategy, auto-play consent and your data." },
      { property: "og:title", content: "Settings — Feltline" },
      { property: "og:description", content: "Workspace settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const settings = useQuery(settingsQ);
  const tables = useQuery(tablesQ);
  const s = settings.data;
  const [form, setForm] = useState({ nickname: "", buy_in: "", small_blind: "", big_blind: "" });
  const [checks, setChecks] = useState([false, false, false, false]);

  useEffect(() => {
    if (!s) return;
    setForm({ nickname: s.nickname, buy_in: String(s.buy_in), small_blind: String(s.small_blind), big_blind: String(s.big_blind) });
    setChecks(CONSENT_ITEMS.map(() => !!s.autoplay_confirmed_at));
  }, [s?.user_id, s?.autoplay_confirmed_at]);

  if (!s) return <p className="text-muted-foreground">Loading…</p>;

  async function update(patch: Record<string, unknown>, msg?: string) {
    try {
      if (isLocalBot()) await bot.patchSettings(patch);
      else {
        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase.from("settings").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", s!.user_id);
        if (error) throw error;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return;
    }
    qc.invalidateQueries({ queryKey: ["settings"] });
    if (msg) toast.success(msg);
  }

  async function toggleCheck(i: number, v: boolean) {
    const next = checks.map((c, j) => (j === i ? v : c));
    setChecks(next);
    if (canEnableAutoplay(next)) {
      await update({ autoplay_confirmed_at: new Date().toISOString() }, "Auto-play unlocked. It stays off until you turn it on per table.");
    } else if (s!.autoplay_confirmed_at) {
      await update({ autoplay_confirmed_at: null, default_mode: "suggest" });
      // turn off any active auto-play
      for (const t of tables.data ?? []) {
        if (t.status !== "autoplay") continue;
        if (isLocalBot()) await bot.patchTable(t.id, { status: "suggesting" });
        else {
          const { supabase } = await import("@/integrations/supabase/client");
          await supabase.from("tables").update({ status: "suggesting" }).eq("id", t.id);
        }
      }
      qc.invalidateQueries({ queryKey: ["tables"] });
      toast("Auto-play locked again.");
    }
  }

  async function exportData() {
    const names = ["profiles", "settings", "tables", "opponents", "hands", "hand_players", "actions", "showdowns", "suggestions"] as const;
    const out: Record<string, unknown> = isLocalBot() ? await bot.exportAll() : {};
    if (!isLocalBot()) {
      const { supabase } = await import("@/integrations/supabase/client");
      for (const n of names) out[n] = (await supabase.from(n).select("*")).data;
    }
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "feltline-export.json";
    a.click();
  }

  async function deleteWorkspace() {
    if (isLocalBot()) {
      toast.error("Local workspace delete is the SQLite file — close the API and remove players.sqlite3.");
      return;
    }
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.from("tables").delete().eq("user_id", s!.user_id);
    await supabase.from("opponents").delete().eq("user_id", s!.user_id);
    await supabase.from("settings").update({ autoplay_confirmed_at: null, default_mode: "suggest", extension_connected: false }).eq("user_id", s!.user_id);
    await qc.cancelQueries();
    qc.clear();
    toast.success("Workspace data deleted");
    navigate({ to: "/tables" });
  }

  async function reloadDemo() {
    if (isLocalBot()) {
      await bot.resetDemo();
    } else {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.rpc("reset_demo_workspace");
      if (error) {
        toast.error(error.message);
        return;
      }
    }
    qc.invalidateQueries();
    toast.success("Demo table reloaded");
  }

  const unlocked = !!s.autoplay_confirmed_at;
  return (
    <div className="mx-auto grid max-w-4xl gap-3 md:grid-cols-2">
      <Panel title="Player">
        {(["nickname", "buy_in", "small_blind", "big_blind"] as const).map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={k} className="capitalize">{k.replace("_", " ")}</Label>
            <Input id={k} type={k === "nickname" ? "text" : "number"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </div>
        ))}
        <Button
          variant="take"
          onClick={() => update({ nickname: form.nickname, buy_in: Number(form.buy_in), small_blind: Number(form.small_blind), big_blind: Number(form.big_blind) }, "Saved")}
        >
          Save
        </Button>
      </Panel>

      <Panel title="Coaching">
        <Choice label="Strategy" value={s.strategy} options={[["theory", "Theory"], ["equity", "Equity"]]} onChange={(v) => update({ strategy: v }, "Strategy saved")} />
        <Choice
          label="Default mode"
          value={s.default_mode}
          options={unlocked ? [["suggest", "Suggest"], ["auto", "Auto-play"]] : [["suggest", "Suggest"]]}
          onChange={(v) => update({ default_mode: v }, "Default mode saved")}
        />
        {!unlocked && <p className="text-xs text-muted-foreground">Auto-play as a default is locked until the checklist is complete.</p>}
        <div className="flex items-center justify-between rounded bg-muted p-3">
          <div>
            <p className="font-semibold">Chrome extension</p>
            <p className={s.extension_connected ? "text-sm text-success" : "text-sm text-muted-foreground"}>
              {s.extension_connected ? "Extension connected" : "Not connected"}
            </p>
          </div>
          <Switch checked={s.extension_connected} onCheckedChange={(v) => update({ extension_connected: v })} aria-label="Mock extension connection" />
        </div>
        <p className="text-[11px] text-muted-foreground">Demo toggle — the real extension will report this itself.</p>
      </Panel>

      <Panel title="Auto-play consent checklist" className="md:col-span-2">
        <p className="text-sm text-muted-foreground">All four are required. Auto-play stays off until you turn it on for a specific table.</p>
        {CONSENT_ITEMS.map((item, i) => (
          <label key={i} className="flex items-start gap-3 rounded bg-muted p-3">
            <Checkbox checked={!!checks[i]} onCheckedChange={(v) => toggleCheck(i, v === true)} />
            <span className="text-sm">{i + 1}. {item}</span>
          </label>
        ))}
        <p className={unlocked ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {unlocked ? `Unlocked ${new Date(s.autoplay_confirmed_at!).toLocaleString()}. Unchecking any item locks it and stops auto-play.` : "Locked."}
        </p>
      </Panel>

      <Panel title="Extension event contract" className="md:col-span-2">
        <p className="text-sm text-muted-foreground">The HUD listens for these messages. The extension sends table state and suggestions; the HUD sends decisions and the auto-play flag.</p>
        <pre className="overflow-x-auto rounded bg-sidebar p-3 font-mono text-xs">{CONTRACT_DOC}</pre>
      </Panel>

      <Panel title="Danger zone" className="border-destructive/50 md:col-span-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={exportData}>Export my data</Button>
          <Button variant="outline" onClick={reloadDemo}>Reload demo table</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="danger">Delete my workspace</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all workspace data?</AlertDialogTitle>
                <AlertDialogDescription>Tables, hands, opponents and suggestions are removed for good. Your sign-in stays.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteWorkspace}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={"hud-panel space-y-3 p-4 " + (className ?? "")}>
      <h2 className="font-display text-lg font-semibold uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="hud-label">{label}</p>
      <div className="flex gap-1">
        {options.map(([v, l]) => (
          <button
            key={v}
            onClick={() => onChange(v)}
            className={"rounded px-3 py-1.5 font-display text-sm uppercase " + (value === v ? "bg-gold text-gold-foreground" : "bg-muted text-muted-foreground")}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
