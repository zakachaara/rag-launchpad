import { useState, useEffect } from "react";
import { RAGConfig, saveProject } from "@/lib/mockApi";
import { usePipeline } from "@/hooks/usePipeline";
import ConfigForm from "@/components/ConfigForm";
import ProgressTracker from "@/components/ProgressTracker";
import CompletionModal from "@/components/CompletionModal";
import ProjectHistory from "@/components/ProjectHistory";
import { Zap, History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

const DEFAULT_CONFIG: RAGConfig = {
  model: "llama3",
  chunkingStrategy: "recursive",
  chunkSize: 500,
  chunkOverlap: 50,
  embeddingModel: "nomic-embed-text",
  dataFolderPath: "",
};

export default function Index() {
  const [config, setConfig] = useState<RAGConfig>(DEFAULT_CONFIG);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const { status, isRunning, launch, reset } = usePipeline();

  const handleLaunch = () => {
    saveProject(`${config.model} — ${config.chunkingStrategy}`, config);
    launch(config);
  };

  useEffect(() => {
    if (status?.chatUrl && !showCompletion) {
      setShowCompletion(true);
    }
  }, [status?.chatUrl]);

  const handleReset = () => {
    reset();
    setShowCompletion(false);
  };

  return (
    <div className="min-h-screen grid-bg">
      <div className="max-w-2xl mx-auto px-4 py-12 sm:py-20">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-4">
            <Zap className="h-8 w-8 text-primary neon-text" />
            <h1 className="text-3xl sm:text-4xl font-bold font-display tracking-tight">
              RAG <span className="text-primary neon-text">LaunchPad</span>
            </h1>
          </div>
          <p className="text-muted-foreground font-mono text-sm">
            Configure and launch your RAG pipeline in seconds
          </p>
        </div>

        {/* Main card */}
        <div className="bg-card rounded-lg border border-border p-6 sm:p-8 neon-border">
          {/* Toolbar */}
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
              {status ? "Pipeline Status" : "Configuration"}
            </h2>
            <div className="flex gap-2">
              {status && (
                <Button variant="ghost" size="sm" onClick={handleReset} className="font-mono text-xs text-muted-foreground">
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Reset
                </Button>
              )}
              {!status && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory(!showHistory)}
                  className="font-mono text-xs text-muted-foreground"
                >
                  <History className="h-3.5 w-3.5 mr-1" />
                  History
                </Button>
              )}
            </div>
          </div>

          {/* History panel */}
          {showHistory && !status && (
            <div className="mb-6 p-4 rounded-md bg-secondary/30 border border-border">
              <ProjectHistory onLoad={(c) => { setConfig(c); setShowHistory(false); }} />
            </div>
          )}

          {/* Config or Progress */}
          {!status ? (
            <ConfigForm config={config} onChange={setConfig} onLaunch={handleLaunch} disabled={isRunning} />
          ) : (
            <ProgressTracker status={status} />
          )}
        </div>

        {/* Footer */}
        <p className="text-center mt-6 text-xs text-muted-foreground font-mono opacity-50">
          Powered by Ollama • Local-first RAG
        </p>
      </div>

      {/* Completion modal */}
      {status?.chatUrl && (
        <CompletionModal
          open={showCompletion}
          onClose={() => setShowCompletion(false)}
          chatUrl={status.chatUrl}
        />
      )}
    </div>
  );
}
