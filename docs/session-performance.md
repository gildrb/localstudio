# Agent session performance

Frontend load order: transcript, runtime status, then one active-session SSE stream. Unpaged files ≤96 MiB are read fully; larger files use a 2,000-message tail. Paging uses an opaque cursor. Active-branch caching is stat-keyed.

For transcript/usage changes, benchmark cold/warm open, append, and older page on normal and >100 MiB rollouts. Track bytes read, branch rebuilds, polling, SSE count, and cache bounds. Reject superlinear event/byte cost.
