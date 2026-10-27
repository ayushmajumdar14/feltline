import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/install")({
  head: () => ({
    meta: [
      { title: "Install the Feltline extension" },
      { name: "description", content: "Download the Feltline Chrome extension as a zip. No GitHub required." },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  return (
    <div className="flex min-h-screen items-center justify-center felt px-4 py-10">
      <div className="hud-panel w-full max-w-lg space-y-5 p-6">
        <Link to="/" className="font-display text-lg font-bold uppercase tracking-widest text-gold">
          Feltline
        </Link>
        <h1 className="font-display text-3xl font-semibold uppercase">Chrome extension</h1>
        <p className="text-sm text-muted-foreground">
          This download is only the extension folder. It is not the GitHub repo. Chrome cannot one-click install from a
          website, so you unzip it and load it once.
        </p>
        <Button asChild variant="take" className="w-full">
          <a href="/feltline-extension.zip" download="feltline-extension.zip">
            Download Feltline.zip
          </a>
        </Button>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Unzip the file. You should see a folder that contains <span className="font-mono">manifest.json</span>.</li>
          <li>
            In Chrome open <span className="font-mono">chrome://extensions</span>.
          </li>
          <li>Turn on Developer mode (top right).</li>
          <li>
            Click <strong>Load unpacked</strong> and choose that unzipped folder.
          </li>
          <li>
            <Link to="/auth" className="text-gold underline">
              Sign in on Feltline
            </Link>
            , add your Poker Now table, then open that game in this same Chrome profile.
          </li>
          <li>Open the coach page here. Take / Override / Ignore clicks on Poker Now.</li>
        </ol>
        <p className="text-xs text-muted-foreground">Private tables only. You confirm every move unless auto-play is on.</p>
      </div>
    </div>
  );
}
