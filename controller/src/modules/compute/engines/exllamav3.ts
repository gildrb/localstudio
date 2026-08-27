import type { EngineSupport, HostProfile } from "../contracts";
import { noMetrics, openAiEngine, supported, unsupported } from "./shared";

const image = (host: HostProfile): string | null =>
  host.accelerator === "cuda" ? "ghcr.io/theroyallab/tabbyapi:latest" : null;
const supports = (host: HostProfile): EngineSupport => {
  if (host.platform === "darwin") return unsupported("exllamav3 requires CUDA; macOS has none");
  if (host.accelerator !== "cuda")
    return unsupported(`exllamav3 needs a CUDA device; this host reports ${host.accelerator}`);
  return host.dockerGpu
    ? supported("docker")
    : unsupported("exllamav3 (TabbyAPI) needs Docker with GPU passthrough");
};

export const exllamav3 = openAiEngine({
  id: "exllamav3",
  defaultPort: 5000,
  readyDeadlineMs: 900_000,
  metrics: noMetrics,
  image,
  supports,
  arguments: {
    modelFlag: "--model-dir",
    servedNameFlag: "--model-name",
    spelling: { maxContextLength: { flag: "--max-seq-len" } },
  },
});
