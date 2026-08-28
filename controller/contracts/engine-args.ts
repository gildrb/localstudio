export type EngineArgType = "string" | "number" | "boolean";

export type EngineExtraArgValue =
  | string
  | number
  | boolean
  | null
  | readonly EngineExtraArgValue[]
  | EngineExtraArgObject;

export interface EngineExtraArgObject {
  [key: string]: EngineExtraArgValue;
}

export interface EngineExtraArgs extends EngineExtraArgObject {}

type EngineArgScope = "vllm" | "shared" | "device";

type EngineArgSpec = {
  readonly field: string;
  readonly type: EngineArgType;
  readonly scope: EngineArgScope;
  readonly aliases?: readonly string[];
};

type EngineArgRow = readonly [
  field: string,
  type: EngineArgType,
  scope: EngineArgScope,
  aliases?: readonly string[],
];

export const engineArgKey = (field: string): string => field.replace(/_/g, "-");

const normalizeEngineArgKey = (key: string): string => key.replace(/_/g, "-").toLowerCase().trim();

const ENGINE_ARG_ROWS = [
  ["tokenizer", "string", "vllm"],
  ["tokenizer_mode", "string", "vllm"],
  ["seed", "number", "vllm"],
  ["revision", "string", "vllm"],
  ["code_revision", "string", "vllm"],
  ["load_format", "string", "vllm"],
  ["quantization_param_path", "string", "vllm"],
  ["chat_template", "string", "shared"],
  ["chat_template_content_format", "string", "vllm"],
  ["response_role", "string", "vllm"],
  ["block_size", "number", "vllm"],
  ["swap_space", "number", "vllm"],
  ["cpu_offload_gb", "number", "vllm"],
  ["num_gpu_blocks_override", "number", "vllm"],
  ["enable_prefix_caching", "boolean", "vllm"],
  ["enable_chunked_prefill", "boolean", "vllm"],
  ["max_num_batched_tokens", "number", "vllm"],
  ["scheduling_policy", "string", "vllm"],
  ["max_paddings", "number", "vllm"],
  ["data_parallel_size", "number", "vllm"],
  ["enable_expert_parallel", "boolean", "vllm"],
  ["cuda_graph_max_bs", "number", "vllm"],
  ["disable_custom_all_reduce", "boolean", "vllm"],
  ["use_v2_block_manager", "boolean", "vllm"],
  ["compilation_config", "string", "vllm"],
  ["speculative_model", "string", "vllm"],
  ["speculative_model_quantization", "string", "vllm"],
  ["num_speculative_tokens", "number", "vllm"],
  ["speculative_draft_tensor_parallel_size", "number", "vllm"],
  ["speculative_max_model_len", "number", "vllm"],
  ["speculative_disable_mqa_scorer", "boolean", "vllm"],
  ["spec_decoding_acceptance_method", "string", "vllm"],
  ["typical_acceptance_sampler_posterior_threshold", "number", "vllm"],
  ["typical_acceptance_sampler_posterior_alpha", "number", "vllm"],
  ["ngram_prompt_lookup_max", "number", "vllm"],
  ["ngram_prompt_lookup_min", "number", "vllm"],
  ["guided_decoding_backend", "string", "vllm"],
  ["tool_parser_plugin", "string", "vllm"],
  ["enable_lora", "boolean", "vllm"],
  ["max_loras", "number", "vllm"],
  ["max_lora_rank", "number", "vllm"],
  ["lora_extra_vocab_size", "number", "vllm"],
  ["lora_dtype", "string", "vllm"],
  ["long_lora_scaling_factors", "string", "vllm"],
  ["fully_sharded_loras", "boolean", "vllm"],
  ["image_input_type", "string", "vllm"],
  ["image_token_id", "number", "vllm"],
  ["image_input_shape", "string", "vllm"],
  ["image_feature_size", "number", "vllm"],
  ["limit_mm_per_prompt", "string", "vllm"],
  ["mm_processor_kwargs", "string", "vllm"],
  ["allowed_local_media_path", "string", "vllm"],
  ["disable_log_requests", "boolean", "vllm"],
  ["disable_log_stats", "boolean", "vllm"],
  ["max_log_len", "number", "vllm"],
  ["uvicorn_log_level", "string", "vllm"],
  ["disable_frontend_multiprocessing", "boolean", "vllm"],
  ["enable_request_id_headers", "boolean", "vllm"],
  ["disable_fastapi_docs", "boolean", "vllm"],
  ["return_tokens_as_token_ids", "boolean", "vllm"],
  [
    "visible_devices",
    "string",
    "device",
    [
      "VISIBLE_DEVICES",
      "visible_devices",
      "CUDA_VISIBLE_DEVICES",
      "cuda_visible_devices",
      "cuda-visible-devices",
    ],
  ],
  ["cuda_visible_devices", "string", "device", ["CUDA_VISIBLE_DEVICES", "cuda_visible_devices"]],
  ["hip_visible_devices", "string", "device", ["HIP_VISIBLE_DEVICES", "hip_visible_devices"]],
  ["rocr_visible_devices", "string", "device", ["ROCR_VISIBLE_DEVICES", "rocr_visible_devices"]],
] as const satisfies readonly EngineArgRow[];

export const ENGINE_ARG_SPECS: readonly EngineArgSpec[] = ENGINE_ARG_ROWS.map(
  ([field, type, scope, aliases]) =>
    aliases ? { field, type, scope, aliases } : { field, type, scope },
);

type EngineArgValue<Type extends EngineArgType> = Type extends "number"
  ? number
  : Type extends "boolean"
    ? boolean
    : string;

export type EngineArgValues = {
  [Row in (typeof ENGINE_ARG_ROWS)[number] as Row[0]]?: EngineArgValue<Row[1]>;
};

const SGLANG_COMPATIBLE_VLLM_KEYS: ReadonlySet<string> = new Set([
  "disable-custom-all-reduce",
  "enable-prefix-caching",
  "enable-chunked-prefill",
  "chunked-prefill-size",
  "max-num-batched-tokens",
  "scheduling-policy",
  "enable-priority-scheduling",
  "schedule-conservativeness",
  "page-size",
  "data-parallel-size",
  "enable-torch-compile",
  "enable-p2p-check",
  "enable-deterministic-inference",
  "random-seed",
  "load-format",
  "revision",
  "tokenizer-mode",
  "tokenizer-backend",
  "device",
  "stream-interval",
  "watchdog-timeout",
  "enable-cache-report",
  "chat-template",
  "hf-chat-template-name",
  "api-key",
  "download-dir",
  "base-gpu-id",
  "gpu-id-step",
  "sleep-on-idle",
  "skip-server-warmup",
  "log-level",
  "log-requests",
]);

export const KNOWN_VLLM_EXTRA_ARG_KEYS: ReadonlySet<string> = new Set([
  ...ENGINE_ARG_SPECS.filter((spec) => spec.scope !== "device").map((spec) =>
    engineArgKey(spec.field),
  ),
  ...SGLANG_COMPATIBLE_VLLM_KEYS,
  "tensor-parallel-size",
  "pipeline-parallel-size",
  "max-model-len",
  "gpu-memory-utilization",
  "max-num-seqs",
  "kv-cache-dtype",
  "trust-remote-code",
  "tool-call-parser",
  "reasoning-parser",
  "enable-auto-tool-choice",
  "quantization",
  "dtype",
  "served-model-name",
  "host",
  "port",
  "attention-backend",
  "moe-backend",
  "async-scheduling",
  "hf-overrides",
  "speculative-config",
  "speculative-config-2",
  "decode-context-parallel-size",
  "dcp-comm-backend",
  "dcp-kv-cache-interleave-size",
  "fuse-allreduce-rms",
  "fuse-rms",
  "fuse-rms-norm",
  "fuse-rms-quant",
  "fuse-attn-quant",
  "extra-llm-config",
  "override-generation-config",
  "override-attention-dtype",
  "tensor-parallel-size-of-mlp",
]);

export const INTERNAL_RECIPE_KEYS: ReadonlySet<string> = new Set([
  ...ENGINE_ARG_SPECS.filter((spec) => spec.scope === "device").map((spec) =>
    engineArgKey(spec.field),
  ),
  "venv-path",
  "env-vars",
  "description",
  "tags",
  "status",
  "metadata",
  "llama-bin",
  "mlx-python",
  "launch-command",
  "custom-command",
  "docker-container",
  "docker-image",
]);

export const isInternalRecipeKey = (key: string): boolean =>
  INTERNAL_RECIPE_KEYS.has(normalizeEngineArgKey(key));

const JSON_STRING_ARG_KEYS: ReadonlySet<string> = new Set([
  "speculative-config",
  "default-chat-template-kwargs",
]);

export const isJsonStringArgumentKey = (key: string): boolean =>
  JSON_STRING_ARG_KEYS.has(normalizeEngineArgKey(key));
