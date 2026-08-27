import type { EngineSupport, HostProfile } from "../contracts";
import { openAiEngine, prometheusMetrics, supported, unsupported } from "./shared";

const image = (host: HostProfile): string | null =>
  host.accelerator === "rocm"
    ? "rocm/vllm:latest"
    : host.accelerator === "cuda"
      ? "vllm/vllm-openai:latest"
      : null;
const supports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") return unsupported("vLLM has no Metal backend");
  if (host.platform === "win32" && !host.wsl) return unsupported("vLLM on Windows requires WSL2");
  if (host.accelerator !== "cuda" && host.accelerator !== "rocm")
    return unsupported(`vLLM needs a CUDA or ROCm device; this host reports ${host.accelerator}`);
  return host.dockerGpu
    ? supported("docker")
    : unsupported("vLLM needs Docker with GPU passthrough (nvidia-container-toolkit)");
};

export const vllm = openAiEngine({
  id: "vllm",
  defaultPort: 8000,
  readyDeadlineMs: 1_800_000,
  metrics: prometheusMetrics("vllm", "kv_cache_usage_perc"),
  image,
  supports,
  arguments: {
    modelFlag: null,
    servedNameFlag: "--served-model-name",
    spelling: {
      tensorParallel: { flag: "--tensor-parallel-size" },
      pipelineParallel: { flag: "--pipeline-parallel-size" },
      maxContextLength: { flag: "--max-model-len" },
      memoryFraction: { flag: "--gpu-memory-utilization" },
      maxConcurrentRequests: { flag: "--max-num-seqs" },
      kvCacheDtype: { flag: "--kv-cache-dtype" },
      dtype: { flag: "--dtype" },
      quantization: { flag: "--quantization" },
      trustRemoteCode: { flag: "--trust-remote-code" },
      toolCallParser: { flag: "--tool-call-parser", companion: "--enable-auto-tool-choice" },
      reasoningParser: { flag: "--reasoning-parser" },
    },
  },
});
