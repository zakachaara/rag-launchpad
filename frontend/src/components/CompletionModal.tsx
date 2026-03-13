import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, PartyPopper } from "lucide-react";

interface CompletionModalProps {
  open: boolean;
  onClose: () => void;
  chatUrl: string;
}

export default function CompletionModal({ open, onClose, chatUrl }: CompletionModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border neon-border sm:max-w-md">
        <DialogHeader className="text-center items-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center neon-glow">
            <PartyPopper className="h-8 w-8 text-primary" />
          </div>
          <DialogTitle className="text-2xl font-display">Your RAG system is ready!</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            The chat interface is now running and accessible at the URL below.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 p-3 rounded-md bg-secondary font-mono text-sm text-center">
          <a href={chatUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            {chatUrl}
          </a>
        </div>

        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1 border-border">
            Close
          </Button>
          <Button
            className="flex-1 neon-glow"
            onClick={() => window.open(chatUrl, "_blank")}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Chat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
