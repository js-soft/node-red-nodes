# Custom Node-RED Nodes Publishing Guide

This document describes how the custom Node-RED nodes in this repository are
organized, published, and consumed.

## Overview

Custom Node-RED nodes are organized into independently publishable packages under
the `packages/` directory.

## Package Structure

```text
packages/
├── node-red-enmeshed-connector/
├── node-red-eudiplo/
└── node-red-frosch-work-openapi-generator/
```

## Publishing a Package

### Prerequisites

Ensure you have npm write access to the `@js-soft` packages and that the GitHub
repository has an `NPM_TOKEN` secret with publish permissions.

### Tag Format

Create git tags with the format `<package-identifier>@<version>`.

Examples:

```bash
git tag enmeshed-connector@0.1.0
git tag eudiplo@7.4.0
git tag frosch-work-openapi-generator@1.0.0
```

`node-red-eudiplo`'s version is kept in lockstep with its `@eudiplo/sdk-core`
dependency version rather than following independent semver. Its published
version should always match the SDK version currently pinned in
`packages/node-red-eudiplo/package.json`.

The tag identifier maps to a package directory and published npm package as
follows:

| Tag identifier | Directory | Published npm package |
| --- | --- | --- |
| `enmeshed-connector` | `packages/node-red-enmeshed-connector` | `@js-soft/node-red-enmeshed-connector` |
| `eudiplo` | `packages/node-red-eudiplo` | `@js-soft/node-red-eudiplo` |
| `frosch-work-openapi-generator` | `packages/node-red-frosch-work-openapi-generator` | `@js-soft/node-red-frosch-work-openapi-generator` |

### Push the Tag

```bash
git push origin eudiplo@7.4.0
```

### Automated Publication

The `.github/workflows/publish-npm-packages.yml` workflow will:

- Parse the tag to extract the package identifier and version.
- Verify the package directory exists.
- Install dependencies in that package directory.
- Update `package.json` to the tag version if necessary.
- Publish to npm using the `NPM_TOKEN` secret.

## Troubleshooting

### Tag Not Recognized

If the workflow does not trigger or exits early:

- Verify the tag format matches `<package-identifier>@<version>`.
- Check that the tag identifier is one of the supported packages listed above.
- Ensure `.github/workflows/publish-npm-packages.yml` exists on the default branch.

### Publish Fails

- Check that `NPM_TOKEN` is configured and valid.
- Verify `package.json` is valid JSON.
- Ensure the version does not already exist on npm.
- Check that all required files from the package `files` field exist.
