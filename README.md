# node-red-nodes

Node-RED node packages maintained by js-soft.

This repository contains the Node-RED packages that were extracted from
`js-soft/frosch-workflow-engine`.

## Packages

| Package directory | Published npm package | Release tag |
| --- | --- | --- |
| `packages/node-red-enmeshed-connector` | `@js-soft/node-red-enmeshed-connector` | `enmeshed-connector@x.y.z` |
| `packages/node-red-eudiplo` | `@js-soft/node-red-eudiplo` | `eudiplo@x.y.z` |
| `packages/node-red-frosch-work-openapi-generator` | `@js-soft/node-red-frosch-work-openapi-generator` | `frosch-work-openapi-generator@x.y.z` |

## Publishing

Packages are published independently by pushing a tag in the format
`<package-identifier>@<version>`. Prerelease versions are supported.

```bash
git tag eudiplo@7.4.0
git push origin eudiplo@7.4.0
```

The publish workflow installs dependencies in the matching package directory,
updates the package version to match the tag if needed, and publishes the package
to npm with public access and provenance.

See [CUSTOM_NODES_PUBLISHING.md](./CUSTOM_NODES_PUBLISHING.md) for details.
