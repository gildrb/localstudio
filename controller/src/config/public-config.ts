import type { SystemConfig } from "@local-studio/contracts/system";
import type { Config } from "./env";

export const toPublicSystemConfig = (config: Config): SystemConfig => ({
  host: config.host,
  port: config.port,
  inference_port: config.inference_port,
  api_key_configured: Boolean(config.api_key),
  models_dir: config.models_dir,
  data_dir: config.data_dir,
  db_path: config.db_path,
});
