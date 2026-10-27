import { Link } from "@tanstack/react-router";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function AutoplayDialog({
  open,
  onOpenChange,
  confirmed,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-display uppercase text-destructive">
            {confirmed ? "Turn on auto-play?" : "Auto-play is locked"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmed
              ? "The assistant will act for you on this private table. You can stop it instantly. A red banner stays on screen while it is on."
              : "Complete the auto-play consent checklist in Settings first. Every item is required."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep suggestions only</AlertDialogCancel>
          {confirmed ? (
            <Button variant="danger" onClick={onConfirm}>Turn on auto-play</Button>
          ) : (
            <Button asChild variant="take">
              <Link to="/settings">Open checklist</Link>
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
