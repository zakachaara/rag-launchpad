import { useState, useCallback, useRef, useEffect } from "react";
import {
  RAGConfig,
  PipelineStatus,
  launchPipeline,
  getPipelineStatus,
  resetPipeline,
} from "@/lib/mockApi";

export function usePipeline() {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const launch = useCallback(async (config: RAGConfig) => {
    resetPipeline();
    setIsRunning(true);
    setStatus(null);

    await launchPipeline(config);

    intervalRef.current = setInterval(async () => {
      const s = await getPipelineStatus();
      setStatus(s);

      if (s?.chatUrl || s?.error) {
        setIsRunning(false);
        stopPolling();
      }
    }, 500);
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    resetPipeline();
    setStatus(null);
    setIsRunning(false);
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return { status, isRunning, launch, reset };
}
