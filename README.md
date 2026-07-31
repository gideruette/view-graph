# View Graph

Autonomous, **technology-agnostic** dependency explorer.

Focus: **entry tree** (entry → sub-entry), **dependency edges**, **orphan nodes**, **tags**
(bulk hide / bulk colour).

Works with extracts from Angular, React, Spring Boot, C#, or any custom emitter that follows [SCHEMA.md](./SCHEMA.md) **v4**.

```
view-graph/
  SCHEMA.md    contract v4
  src/         Angular viewer (upload an extract)
```

The Angular extractor itself lives in the sibling [`node-stack-export`](../node-stack-export) project (other
stacks: write your own emitter following SCHEMA.md).

## Explore (upload an extract)

```bash
cd view-graph
npm install
npm start
```

Open http://localhost:5180 → **Load JSON…** or drop a `view-graph.json`.

Optional: `?data=<url>` loads a remote extract once.

### Tags — hide or colour nodes in bulk

Extractors label each node with `tags` (see [SCHEMA.md](./SCHEMA.md) § Tags). The **Tags** tab in
the left panel turns those labels into bulk operations, grouped by namespace:

- **👁 hide** — drops every node carrying the tag *and* the branches only those nodes reached, so
  hiding `type:entity` prunes the data layer without stranding what another path still reaches.
  **only** hides every other tag in the same namespace ("show just this layer").
- **◧ colour** — pick a colour and every node carrying the tag takes it, overriding its `kind`
  colour. A node with several coloured tags uses the alphabetically first one.

Both are your preferences, not part of the extract: they persist across reloads, and the filter bar
always shows how much is hidden with a one-click **Show all**.

## What the Angular extractor emits

Node roles come from what a class *is* to Angular, not from the folder it lives in:

| Role | Recognised by |
|------|---------------|
| `view` / `layout` | mounted by a leaf route / by a route with children (or bootstrapped) |
| `component` | `@Component` that no route mounts |
| `directive` / `pipe` | `@Directive` / `@Pipe` |
| `service` | `@Injectable` |
| `guard` / `resolver` / `interceptor` / `validator` | the Angular contract the `@Injectable` implements |
| `entity` | class, interface or type alias under `model/` (or `*.model.ts` / `*.dto.ts`) |
| `contract` | HTTP call site → `api:{METHOD} {path}`, the join key for merging with a backend extract |

Pipes and directives are linked through the template that actually uses them (`| pipeName`, or a tag
matching the directive's selector), falling back to the availability scope (`imports: []`, NgModule
declarations/exports, TS value imports) when the usage is not statically visible.

## Generate (Angular workspace)

```bash
cd ../node-stack-export
npm install
npm run build
npm run extract -- --workspace ../sources/frontend
```

Then upload the produced `view-graph.json` in the viewer.

```bash
node dist/cli.js --list-projects --workspace ../sources/frontend
node dist/cli.js --workspace ../sources/frontend --project asta-starter-kit --out ./my-app.json --pretty
```

## Minimal extract shape

```json
{
  "version": 4,
  "meta": { "tech": "web", "label": "orders" },
  "entryPoints": ["app.Main", "app.Orders", "app.Detail"],
  "entries": [
    {
      "id": "entry:app.Main",
      "label": "Main",
      "nodeId": "app.Main",
      "children": [
        {
          "id": "/orders",
          "label": "orders",
          "path": "/orders",
          "nodeId": "app.Orders",
          "children": [
            { "id": "/orders/:id", "label": ":id", "path": "/orders/:id", "nodeId": "app.Detail" }
          ]
        }
      ]
    }
  ],
  "nodes": [
    { "id": "app.Main", "name": "Main" },
    { "id": "app.Orders", "name": "Orders" },
    { "id": "app.Detail", "name": "Detail" }
  ],
  "edges": [
    { "source": "app.Main", "target": "app.Orders" },
    { "source": "app.Orders", "target": "app.Detail" }
  ]
}
```

See [SCHEMA.md](./SCHEMA.md). Click an entry in the viewer to scope the graph to that branch.
