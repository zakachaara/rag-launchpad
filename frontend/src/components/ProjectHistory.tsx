import { getSavedProjects, deleteProject, SavedProject, RAGConfig } from "@/lib/mockApi";
import { useState } from "react";
import { Clock, Trash2, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProjectHistoryProps {
  onLoad: (config: RAGConfig) => void;
}

export default function ProjectHistory({ onLoad }: ProjectHistoryProps) {
  const [projects, setProjects] = useState<SavedProject[]>(getSavedProjects());

  if (projects.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm font-mono">
        <FolderOpen className="mx-auto h-8 w-8 mb-2 opacity-40" />
        No saved projects yet
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {projects.map((p) => (
        <div
          key={p.id}
          className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary/50 hover:bg-secondary transition-colors group"
        >
          <button
            onClick={() => onLoad(p.config)}
            className="flex-1 text-left"
          >
            <div className="text-sm font-medium truncate">{p.name}</div>
            <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(p.createdAt).toLocaleDateString()}
              <span className="ml-2">{p.config.model}</span>
            </div>
          </button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={() => {
              deleteProject(p.id);
              setProjects(getSavedProjects());
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  );
}
