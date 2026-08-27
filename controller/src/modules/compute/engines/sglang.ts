import type { EngineSupport, HostProfile } from "../contracts";
import { openAiEngine, prometheusMetrics, supported, unsupported } from "./shared";

const image = (host: HostProfile): string | null =>
  host.accelerator === "cuda" ? "lmsysorg/sglang:latest" : null;
const supports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") return unsupported("SGLang has no Metal backend");
  if (host.platform === "win32" && !host.wsl) return unsupported("SGLang on Windows requires WSL2");
  if (host.accelerator !== "cuda")
    return unsupported(`SGLang needs a CUDA device; this host reports ${host.accelerator}`);
  return host.dockerGpu
    ? supported("docker")
    : unsupported("SGLang needs Docker with GPU passthrough (nvidia-container-toolkit)");
};

export const sglang = openAiEngine({
  id: "sglang",
  defaultPort: 30000,
  readyDeadlineMs: 900_000,
  metrics: prometheusMetrics("sglang", "token_usage"),
  image,
  supports,
  arguments: {
    subcommand: ["serve"],
    modelFlag: "--model-path",
    servedNameFlag: "--served-model-name",
    defaults: ["--enable-metrics"],
    spelling: {
      tensorParallel: { flag: "--tensor-parallel-size" },
      pipelineParallel: { flag: "--pipeline-parallel-size" },
      maxContextLength: { flag: "--context-length" },
      memoryFraction: { flag: "--mem-fraction-static" },
      maxConcurrentRequests: { flag: "--max-running-requests" },
      kvCacheDtype: { flag: "--kv-cache-dtype" },
      dtype: { flag: "--dtype" },
      quantization: { flag: "--quantization" },
      trustRemoteCode: { flag: "--trust-remote-code" },
      toolCallParser: { flag: "--tool-call-parser" },
      reasoningParser: { flag: "--reasoning-parser" },
    },
  },
});
