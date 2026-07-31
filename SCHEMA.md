# Dependency Graph — JSON contract (v4)

Shared contract between any extractor and the viewer.
Describes a directed dependency graph plus an optional **entry tree**
(entry → sub-entry → …) for navigation and scoping.

Typical file name: `view-graph.json` (any path is fine).

## Concepts

| Concept               | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| **Node**              | A unit of the system (class, module, package, page, service, contract, …). |
| **Edge**              | Directed dependency: `source` depends on `target`.                         |
| **Entry point**       | A graph root of analysis (listed flat in `entryPoints`).                   |
| **Entry / sub-entry** | A node in the optional hierarchical `entries` tree (navigation + scope).   |
| **Orphan**            | A graph node not reachable by following edges from any entry point.        |
| **Shared contract**   | A node that several extracts agree on (same `id`), used to join graphs.    |

Orphans are **computed**, never stored in the file.

An **entry** may point at a graph node (`nodeId`). Sub-entries nest under it.
Clicking an entry in the viewer scopes the graph to that branch (that entry’s
`nodeId` and all nested entries’ `nodeId`s, plus their dependency subtrees).

## Top level

```jsonc
{
  "version": 4,
  "generatedAt": "2026-01-15T12:00:00.000Z",   // optional, ISO-8601
  "meta": {                                      // optional
    "tech": "free-string",                       // which emitter produced this file
    "label": "orders-web",                       // human label for this extract
    "root": "src",                               // optional base for relative `file` paths
    "warnings": ["…"]
  },
  "entryPoints": ["app.Main", "app.Admin"],      // flat roots for reachability / orphans
  "entries": [Entry],                            // optional hierarchy (entry → sub-entry)
  "nodes": [Node],
  "edges": [Edge],
  "stats": {                                     // optional; viewer recomputes if absent
    "nodeCount": 0,
    "edgeCount": 0,
    "entryPointCount": 0,
    "orphanCount": 0,
    "maxDepth": 0
  }
}
```

- `entryPoints` drives reachability and orphan detection.
- `entries` is optional navigation. If omitted, the viewer lists `entryPoints` flat.
- Emitters should keep `entryPoints` consistent with every `entries[].nodeId`
  that is a root of analysis (typically every `nodeId` in the tree).
- `meta.tech` / `meta.label` identify **one extract**. They are not used as join keys.

## Node

```jsonc
{
  "id": "orders.api.OrdersHandler", // required, stable, unique within one file
  "name": "OrdersHandler", // required, display label
  "file": "api/OrdersHandler.java", // optional location hint
  "kind": "handler", // optional free-form tag
  "tags": ["tech:java", "type:controller"], // optional, see § Tags
}
```

- `id` is the only key referenced by `entryPoints`, edges, and `entries[].nodeId`.
- `kind` has **no enumerated values**. Suggested tags (informative only):
  `module`, `page`, `handler`, `service`, `contract`, …
- `tags` is an optional array of free-form labels. Empty, absent, and `null` are equivalent.

## Tags

`nodes[].tags` are the extractor's cross-cutting labels. Unlike `kind` (one value, drives the
node's default colour), a node may carry any number of tags, and the viewer exposes them as
**bulk operations**: hide every node carrying a tag, or paint every node carrying a tag.

Recommended shape — a namespace, a colon, a value:

```text
tech:angular        which stack the node came from
type:controller     the node's role, in a vocabulary shared across stacks
trait:static        a cross-cutting property, orthogonal to the role
```

The viewer groups tags by namespace, so consistent prefixes keep the Tags panel readable.
Suggested `type:` vocabulary (convention for emitters — **not** a schema enum), so that one
tag means the same thing whichever extractor produced the node:

| `type:` value | Typical mapping                                           |
| ------------- | --------------------------------------------------------- |
| `controller`  | HTTP handler, `@RestController`, request-mapping class    |
| `service`     | Business service, `@Service`, injectable                  |
| `dao`         | Repository / data-access, `@Repository`                   |
| `entity`      | Persisted or transported data model, `@Entity`, DTO       |
| `view`        | Page / screen / routed leaf                               |
| `layout`      | Shell holding a nested outlet                             |
| `component`   | Reusable UI component                                     |
| `directive`   | Behaviour attached to an element                          |
| `pipe`        | Value transform used from a template                      |
| `guard`       | Route access check                                        |
| `resolver`    | Route data pre-fetch                                      |
| `interceptor` | Request/response middleware                               |
| `config`      | Wiring / configuration class                              |
| `contract`    | Shared boundary node (see § Multi-extract reconciliation) |

The `trait:` namespace carries properties that are **orthogonal to the role**, so a node keeps its
`type:` while gaining a trait. Emitted today: `trait:static` (a static method — no instance state,
and typically outside the injection graph). Others an emitter may find worth surfacing:
`trait:deprecated`, `trait:generated`, `trait:transactional`.

Notes for emitters:

- Emit `tech:*` on nodes your stack owns. Do **not** put `tech:*` on shared **contract** nodes —
  they belong to no single side, and tagging them would make hiding one stack also hide the
  boundary that joins it to the other.
- Prefer a signal the framework guarantees over a folder convention: `@Pipe` or
  `implements CanActivate` means the same thing in every project, `app/views/` does not.
- Tags are **additive on merge**: the union of every extract's tags for that `id` (see § Merge rules).

Hiding a tag hides the tagged nodes _and_ the descendants that only those nodes reached, so
hiding e.g. `type:dao` prunes the branches that hung off the data-access layer while leaving
nodes another live path still reaches.

## Edge

```jsonc
{
  "source": "orders.api.OrdersHandler",
  "target": "orders.domain.OrdersService",
}
```

- Meaning: **source depends on target** (uses, calls, imports, includes, consumes, …).
- At most one edge per `(source, target)` pair.
- No edge kinds — all relations are dependencies.

## Entry (tree)

```jsonc
{
  "id": "entry:/orders→orders.ui.OrdersPage", // required, unique within the entries tree
  "label": "orders",                          // required, short display label
  "path": "/orders",                          // optional full path / breadcrumb (may repeat)
  "nodeId": "orders.ui.OrdersPage",           // optional link to a graph node
  "children": [Entry]                         // optional sub-entries
}
```

`id` must be unique in the whole tree. Prefer a stable disambiguator when several
entries share the same `path` (different `nodeId`, outlet, or source file).
`path` is for display / breadcrumbs only — it may repeat.
Examples of what emitters often map here (informative only — not part of the contract):
navigation trees, request-mapping trees, module / package hierarchies, job pipelines.

---

## Multi-extract reconciliation (shared contracts)

Several extracts (e.g. UI client + HTTP server + worker) stay valid **v4 files on their
own**. They are reconciled by giving the **same `id`** to the same logical contract
in every extract, then **merging** the files.

The schema does **not** encode which stack produced a node. Join key = `nodes[].id`.

### Shared contract nodes

A **contract** is an ordinary node that both sides of a boundary agree to name
identically. Typical use: an HTTP (or RPC / messaging) interface.

Recommended `id` shape for HTTP-like contracts (convention for emitters — not a
schema enum):

```text
api:{METHOD} {normalized-path}
```

Examples:

```text
api:GET /orders
api:GET /orders/:id
api:POST /orders
```

Normalization expected of emitters before building the id:

1. Uppercase the method.
2. Ensure the path starts with `/`.
3. Strip trailing `/` (except for `/` itself).
4. Drop query string and fragment.
5. Use a single placeholder style for path params: `:name` (not `{name}`).

Suggested `kind` for these nodes: `"contract"` (optional).

### Edge direction at a boundary

Both sides **depend on** the contract node (same edge meaning as everywhere else):

| Role                               | Edge                               |
| ---------------------------------- | ---------------------------------- |
| Consumer (calls the contract)      | `consumerNode` → `api:GET /orders` |
| Provider (implements the contract) | `providerNode` → `api:GET /orders` |

After merge, consumer and provider are siblings that both depend on the shared
contract — no stack-specific edge type is required.

Emitters **must** also list the contract in `nodes` (invariant 1). A consumer
extract that only knows the URL still emits the contract node; a provider extract
emits the same id when it declares the mapping.

### Merge rules

Given extracts `A`, `B`, … (each valid v4), a merge produces one v4 document:

1. **Nodes** — union by `id`. If the same `id` appears in several files, keep one
   node; prefer a non-empty `name` / `file` / `kind` when the other side omitted it.
   Conflicting non-empty `name`/`kind` → keep the first and push a `meta.warnings` note.
   `tags` are **unioned**, never in conflict (see § Tags).
2. **Edges** — union by `(source, target)`; duplicates dropped.
3. **entryPoints** — union of ids (that still exist after the node merge).
4. **entries** — concatenate root lists from each extract (preserve each tree).
   If two roots share the same `entries[].id`, keep the first and warn.
5. **meta** — `tech`: `"merged"` (or omit); `label`: optional combined label;
   `warnings`: concatenation of inputs’ warnings plus merge notes.
6. **stats** — recompute from the merged graph (viewer may ignore stored stats).

The viewer loads a **single** v4 file. Multi-stack analysis = extract → merge → upload.

### Minimal multi-extract example

**Extract A** (consumer side):

```json
{
  "version": 4,
  "meta": { "tech": "web-client", "label": "orders-ui" },
  "entryPoints": ["ui.OrdersPage"],
  "nodes": [
    { "id": "ui.OrdersPage", "name": "OrdersPage", "kind": "page" },
    { "id": "api:GET /orders", "name": "GET /orders", "kind": "contract" }
  ],
  "edges": [{ "source": "ui.OrdersPage", "target": "api:GET /orders" }]
}
```

**Extract B** (provider side):

```json
{
  "version": 4,
  "meta": { "tech": "http-server", "label": "orders-api" },
  "entryPoints": ["api.OrdersHandler"],
  "nodes": [
    { "id": "api.OrdersHandler", "name": "OrdersHandler", "kind": "handler" },
    { "id": "api:GET /orders", "name": "GET /orders", "kind": "contract" }
  ],
  "edges": [{ "source": "api.OrdersHandler", "target": "api:GET /orders" }]
}
```

**Merged** (join on `api:GET /orders`):

```json
{
  "version": 4,
  "meta": { "tech": "merged", "label": "orders-ui+orders-api" },
  "entryPoints": ["ui.OrdersPage", "api.OrdersHandler"],
  "nodes": [
    { "id": "ui.OrdersPage", "name": "OrdersPage", "kind": "page" },
    { "id": "api.OrdersHandler", "name": "OrdersHandler", "kind": "handler" },
    { "id": "api:GET /orders", "name": "GET /orders", "kind": "contract" }
  ],
  "edges": [
    { "source": "ui.OrdersPage", "target": "api:GET /orders" },
    { "source": "api.OrdersHandler", "target": "api:GET /orders" }
  ]
}
```

The same pattern works for any boundary that can be named stably (RPC methods,
message topics, shared libraries, …): pick a shared `id` convention, emit the
contract node on every side, merge.

---

## Invariants

1. Every `edge.source` and `edge.target` equals some `nodes[].id`.
2. Every id in `entryPoints` equals some `nodes[].id`.
3. Every `entries[].nodeId` (when set) equals some `nodes[].id`.
4. Every `entries[].id` is unique in the tree.
5. `nodes` is unique by `id` within one file (and after merge).
6. Cycles among **edges** are allowed.
7. Stack-specific detail belongs only in `meta` — never as required fields on
   nodes, edges, or entries. `tags` are the sanctioned way to label individual nodes
   (free-form values, no schema enum).
8. Cross-extract joins use **equal `nodes[].id` only** — never `meta.tech`.

## Minimal valid example (with entry tree)

```json
{
  "version": 4,
  "entryPoints": ["app.Main", "app.Orders", "app.OrderDetail"],
  "entries": [
    {
      "id": "entry:app.Main",
      "label": "Main",
      "nodeId": "app.Main",
      "children": [
        {
          "id": "/orders→app.Orders",
          "label": "orders",
          "path": "/orders",
          "nodeId": "app.Orders",
          "children": [
            {
              "id": "/orders/:id→app.OrderDetail",
              "label": ":id",
              "path": "/orders/:id",
              "nodeId": "app.OrderDetail"
            }
          ]
        }
      ]
    }
  ],
  "nodes": [
    { "id": "app.Main", "name": "Main" },
    { "id": "app.Orders", "name": "Orders" },
    { "id": "app.OrderDetail", "name": "OrderDetail" },
    { "id": "app.Unused", "name": "Unused" }
  ],
  "edges": [
    { "source": "app.Main", "target": "app.Orders" },
    { "source": "app.Orders", "target": "app.OrderDetail" }
  ]
}
```

Here `app.Unused` is an orphan. The entry tree scopes navigation to Main → orders → :id.
