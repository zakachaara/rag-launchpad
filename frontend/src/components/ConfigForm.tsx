import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RAGConfig } from "@/lib/api";
import { OllamaModelEntry, getAvailableModels, pullModel, searchRegistry } from "@/lib/mockApi";
import { Rocket, Search, Download, CheckCircle2, Loader2, ChevronDown, X } from "lucide-react";

interface ConfigFormProps {
  config: RAGConfig;
  onChange: (config: RAGConfig) => void;
  onLaunch: () => void;
  disabled: boolean;
}

function FormField({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="space-y-2">
      <Label className={`text-sm text-muted-foreground uppercase tracking-wider ${mono ? "font-mono text-xs" : ""}`}>
        {label}
      </Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Searchable model picker
// ---------------------------------------------------------------------------

interface ModelPickerProps {
  value: string;
  onChange: (tag: string) => void;
  disabled: boolean;
}

function ModelPicker({ value, onChange, disabled }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<OllamaModelEntry[]>([]);
  const [pulling, setPulling] = useState<string | null>(null);
  const [justPulled, setJustPulled] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load installed models once on mount
  useEffect(() => {
    setLoading(true);
    getAvailableModels()
      .then(setModels)
      .finally(() => setLoading(false));
  }, []);

  // Refresh installed state after a pull
  const refreshModels = async () => {
    const fresh = await getAvailableModels();
    setModels(fresh);
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const filtered = searchRegistry(query).map((entry) => ({
    ...entry,
    installed: models.find((m) => m.tag === entry.tag)?.installed ?? false,
  }));

  // Group by family
  const families = Array.from(new Set(filtered.map((m) => m.family)));

  const selectedEntry = models.find((m) => m.tag === value) ??
    searchRegistry("").find((m) => m.tag === value);

  const handlePull = async (e: React.MouseEvent, tag: string) => {
    e.stopPropagation();
    setPulling(tag);
    try {
      await pullModel(tag);
      setJustPulled(tag);
      await refreshModels();
      setTimeout(() => setJustPulled(null), 3000);
    } catch (err) {
      console.error("Pull failed:", err);
    } finally {
      setPulling(null);
    }
  };

  const handleSelect = (tag: string) => {
    onChange(tag);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-3 py-2 rounded-md
                   bg-secondary border border-border font-mono text-sm
                   hover:border-primary/50 transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="flex items-center gap-2 min-w-0">
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-muted-foreground" />
          ) : selectedEntry?.installed ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          ) : (
            <Download className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          )}
          <span className="truncate">{value || "Select a model…"}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[320px] rounded-lg border border-border
                        bg-popover shadow-xl overflow-hidden">
          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models, sizes, families…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground font-mono"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-3 py-1.5 bg-muted/30 border-b border-border text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Installed</span>
            <span className="flex items-center gap-1"><Download className="h-3 w-3 text-amber-500" /> Not installed</span>
          </div>

          {/* Model list */}
          <div className="max-h-72 overflow-y-auto">
            {families.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No models match "{query}"</div>
            ) : (
              families.map((family) => (
                <div key={family}>
                  {/* Family header */}
                  <div className="sticky top-0 px-3 py-1 text-[10px] uppercase tracking-widest
                                  font-semibold text-muted-foreground bg-muted/60 border-b border-border/50">
                    {family}
                  </div>
                  {/* Entries */}
                  {filtered
                    .filter((m) => m.family === family)
                    .map((m) => {
                      const isSelected = m.tag === value;
                      const isPulling = pulling === m.tag;
                      const wasPulled = justPulled === m.tag;

                      return (
                        <button
                          key={m.tag}
                          type="button"
                          onClick={() => handleSelect(m.tag)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left
                                      hover:bg-accent transition-colors group
                                      ${isSelected ? "bg-accent" : ""}`}
                        >
                          {/* Left side */}
                          <div className="flex items-center gap-2 min-w-0">
                            {m.installed ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            ) : (
                              <Download className="h-3.5 w-3.5 shrink-0 text-amber-500/70" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-sm font-medium truncate">{m.tag}</span>
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold
                                                bg-primary/10 text-primary leading-none">
                                  {m.size}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {m.description}
                              </p>
                            </div>
                          </div>

                          {/* Pull button — only shown for non-installed models */}
                          {!m.installed && (
                            <button
                              type="button"
                              onClick={(e) => handlePull(e, m.tag)}
                              disabled={!!pulling}
                              className="shrink-0 ml-2 flex items-center gap-1 px-2 py-1 rounded text-[11px]
                                         font-medium border border-amber-500/40 text-amber-500
                                         hover:bg-amber-500/10 hover:border-amber-500
                                         disabled:opacity-40 disabled:cursor-not-allowed
                                         transition-colors opacity-0 group-hover:opacity-100"
                            >
                              {isPulling ? (
                                <><Loader2 className="h-3 w-3 animate-spin" /> Pulling…</>
                              ) : wasPulled ? (
                                <><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Done</>
                              ) : (
                                <><Download className="h-3 w-3" /> Pull</>
                              )}
                            </button>
                          )}
                        </button>
                      );
                    })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

export default function ConfigForm({ config, onChange, onLaunch, disabled }: ConfigFormProps) {
  const update = (partial: Partial<RAGConfig>) => onChange({ ...config, ...partial });
  const canLaunch = config.dataFolderPath.trim().length > 0 && config.model.length > 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        <FormField label="Ollama Model">
          <ModelPicker
            value={config.model}
            onChange={(tag) => update({ model: tag })}
            disabled={disabled}
          />
        </FormField>

        <FormField label="Chunking Strategy">
          <Select value={config.chunkingStrategy} onValueChange={(v) => update({ chunkingStrategy: v })} disabled={disabled}>
            <SelectTrigger className="bg-secondary border-border font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["fixed", "recursive", "semantic"].map((s) => (
                <SelectItem key={s} value={s} className="font-mono">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField label="Chunk Size" mono>
          <Input
            type="number"
            min={100}
            max={2000}
            value={config.chunkSize}
            onChange={(e) => update({ chunkSize: Math.min(2000, Math.max(100, parseInt(e.target.value) || 100)) })}
            className="bg-secondary border-border font-mono"
            disabled={disabled}
          />
        </FormField>

        <FormField label="Chunk Overlap" mono>
          <Input
            type="number"
            min={0}
            max={500}
            value={config.chunkOverlap}
            onChange={(e) => update({ chunkOverlap: Math.min(500, Math.max(0, parseInt(e.target.value) || 0)) })}
            className="bg-secondary border-border font-mono"
            disabled={disabled}
          />
        </FormField>

        <FormField label="Embedding Model">
          <Select value={config.embeddingModel} onValueChange={(v) => update({ embeddingModel: v })} disabled={disabled}>
            <SelectTrigger className="bg-secondary border-border font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["nomic-embed-text", "mxbai-embed-large", "all-MiniLM-L6-v2"].map((m) => (
                <SelectItem key={m} value={m} className="font-mono">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

      </div>

      <FormField label="Data Folder Path" mono>
        <Input
          type="text"
          placeholder="/path/to/your/documents"
          value={config.dataFolderPath}
          onChange={(e) => update({ dataFolderPath: e.target.value })}
          className="bg-secondary border-border font-mono"
          disabled={disabled}
        />
      </FormField>

      <Button
        onClick={onLaunch}
        disabled={disabled || !canLaunch}
        className="w-full h-12 text-base font-semibold neon-glow transition-all duration-300 hover:scale-[1.01]"
        size="lg"
      >
        <Rocket className="mr-2 h-5 w-5" />
        {disabled ? "Pipeline Running..." : "Launch RAG Pipeline"}
      </Button>
    </div>
  );
}
