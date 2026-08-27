import { Schema } from "effect";

const RIG_HARDWARE_TYPE_VALUES = [
  "dgx-spark",
  "gpu-desktop",
  "gpu-server",
  "mac",
  "laptop",
  "mini-pc",
  "custom",
] as const;
const RIG_NODE_ROLE_VALUES = ["head", "worker", "standalone"] as const;

export type RigHardwareType = (typeof RIG_HARDWARE_TYPE_VALUES)[number];
export type RigNodeRole = (typeof RIG_NODE_ROLE_VALUES)[number];
export const RIG_HARDWARE_TYPES: RigHardwareType[] = [...RIG_HARDWARE_TYPE_VALUES];
export const RIG_NODE_ROLES: RigNodeRole[] = [...RIG_NODE_ROLE_VALUES];
export type RigNodeSource = "detected" | "manual";

export interface RigAccelerator {
  name: string;
  count: number;
  memory_gb: number | null;
  memory_type: string | null;
  memory_bandwidth_gbs: number | null;
  unified_memory: boolean;
}

export interface RigNode {
  id: string;
  name: string;
  hardware_type: RigHardwareType;
  role: RigNodeRole;
  source: RigNodeSource;
  hostname: string | null;
  address: string | null;
  os: string | null;
  cpu_model: string | null;
  cpu_cores: number | null;
  memory_gb: number | null;
  accelerators: RigAccelerator[];
  notes: string | null;
}

export interface Rig {
  id: string;
  name: string;
  description: string | null;
  nodes: RigNode[];
  created_at: string;
  updated_at: string;
}

export interface RigsPayload {
  rigs: Rig[];
  local_node_id: string;
}

export const RIG_HARDWARE_TYPE_LABELS = {
  "dgx-spark": "DGX Spark",
  "gpu-desktop": "GPU Desktop",
  "gpu-server": "GPU Server",
  mac: "Mac",
  laptop: "Laptop",
  "mini-pc": "Mini PC",
  custom: "Custom",
} satisfies Record<RigHardwareType, string>;

export const RIG_NODE_ROLE_LABELS = {
  head: "Head node",
  worker: "Worker node",
  standalone: "Standalone",
} satisfies Record<RigNodeRole, string>;

export const RigAcceleratorInputSchema = Schema.Struct({
  name: Schema.String,
  count: Schema.optional(Schema.Number),
  memory_gb: Schema.optional(Schema.NullOr(Schema.Number)),
  memory_type: Schema.optional(Schema.NullOr(Schema.String)),
  memory_bandwidth_gbs: Schema.optional(Schema.NullOr(Schema.Number)),
  unified_memory: Schema.optional(Schema.Boolean),
});

export const RigCreateSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

export const RigUpdateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.NullOr(Schema.String)),
});

const RigNodeFields = {
  hardware_type: Schema.optional(Schema.Literals(RIG_HARDWARE_TYPES)),
  role: Schema.optional(Schema.Literals(RIG_NODE_ROLES)),
  hostname: Schema.optional(Schema.NullOr(Schema.String)),
  address: Schema.optional(Schema.NullOr(Schema.String)),
  os: Schema.optional(Schema.NullOr(Schema.String)),
  cpu_model: Schema.optional(Schema.NullOr(Schema.String)),
  memory_gb: Schema.optional(Schema.NullOr(Schema.Number)),
  accelerators: Schema.optional(Schema.Array(RigAcceleratorInputSchema)),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
};

export const RigNodeCreateSchema = Schema.Struct({ name: Schema.String, ...RigNodeFields });
export const RigNodeUpdateSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  ...RigNodeFields,
});
