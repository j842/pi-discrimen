# pi-discrimin

Connect [Pi](https://pi.dev/) to a **Discrimen** router. Use automatic routing,
choose an underlying model from Pi's model picker, and see which model serves
each response in the footer.

```text
Discrimin · Auto → Qwen3.8 Flash Next
```

The package and provider are named **discrimin**; the router project is named
**Discrimen**. Requires Pi **1.0.4 or newer** and Node **22.19 or newer**. Older
`@mariozechner/pi-coding-agent` and GSD builds are not supported by this release.

## Install and connect

Once the package is published to npm:

```sh
pi install npm:pi-discrimin
pi
```

Inside Pi:

```text
/login discrimin
/discrimin auto
```

Login asks for the router URL and a **client API key**. Paste either the root URL
or its `/v1` URL; reverse-proxy prefixes are supported. The key prompt is masked.
The extension verifies access to `/v1/models` before Pi saves the credential.
Pi stores the key and its associated URL in `~/.pi/agent/auth.json`, respecting
`PI_CODING_AGENT_DIR` if set. It does not put secrets in project settings.

`/discrimin auto` selects automatic routing for the current session. Open
`/model`, select **Discrimin — Auto**, and press **Ctrl+S** to make it the default
for new sessions. The extension leaves your existing default alone until you
save a new one.

You need network access to the router, including your VPN if it is private.
An administrator can issue a separate client key for each person. Admin keys
are unnecessary for this integration.

## Models and commands

| Command | Action |
| --- | --- |
| `/login discrimin` | Connect, change router, or replace the API key |
| `/discrimin auto` | Select the router's `default` model |
| `/model` | Choose Auto, Expert, or an underlying model |
| `/discrimin refresh` | Fetch the latest catalogue, including additions and removals |
| `/discrimin status` | Show the configured URL and current catalogue size |
| `/logout` | Remove the saved Discrimin credential through Pi's provider menu |

The catalogue is discovered at startup and through Pi's provider refresh flow.
Successful results are reused in memory for up to 60 seconds; the refresh command
bypasses that cache. Discovery has an eight-second timeout. An outage retains
the last successful catalogue for the same connection in the running process.
Changing connections clears the previous fleet; catalogues are not saved to disk.

Auto and Expert leave `reasoning_effort` unset so the router decides whether to
think. A named thinking-capable model exposes Pi's normal thinking controls.
Model IDs and aliases from the catalogue are sent unchanged to the router.

The footer reads `X-LLM-Backend-Model-Name`, falling back to
`X-LLM-Backend-Model`, for **every HTTP response**, including successive calls
in a tool loop. It clears the previous answer's identity when a new call starts
or another provider is selected. If a proxy strips these headers, it says
`backend unreported`. For Expert, the header identifies the reported answering
model; it does not enumerate the whole expert panel. Stream failures after the
headers arrive remain visible through Pi's normal error UI.

Context limits come from `context_length`; missing limits use a conservative
32,768-token fallback. If no output limit is advertised, the client uses an
8,192-token cap, limited to a quarter of the context window. Costs display as
zero because the router catalogue does not provide prices; this is not a claim
that serving the models is free.

## Environment-only setup

For CI or a temporary shell session, supply `DISCRIMIN_URL` and
`DISCRIMIN_API_KEY` through your environment or secret manager:

```sh
export DISCRIMIN_URL=https://router.example.com
# Set DISCRIMIN_API_KEY using your secret manager.
pi --provider discrimin --model default
```

A saved login takes precedence. Log out of Discrimin before changing connections
using environment variables. Environment credentials remain usable after logout
until you unset them.

## Try a local checkout

```sh
pi -e /path/to/pi-discrimin
```

To keep it installed:

```sh
pi install /path/to/pi-discrimin
```

Pi supplies the runtime dependencies and loads the TypeScript source directly.
There is no build step. Restart Pi or run `/reload` after installing in another
terminal.

## Distribute it

### npm: easiest for users

The package is prepared for public npm publishing under `pi-discrimin`.
Publishing requires an npm account with permission to use the name. If the name
is unavailable, use a scope such as `@your-account/pi-discrimin` and adjust the
install command. The `pi-package` keyword makes a published package eligible
for [Pi's package gallery](https://pi.dev/packages).

From the package directory:

```sh
npm install
npm run verify
npm pack --dry-run
npm login
npm publish --access public
```

Users then run:

```sh
pi install npm:pi-discrimin
```

For automated updates, use the release workflow below. Users
with an unpinned installation run `pi update --extensions`. For reproducible
installs, use `pi install npm:pi-discrimin@0.1.0`; a pinned installation stays on
that version until its package specification is changed.

### CI releases on forge.jde.nz

`.gitea/workflows/publish.yaml` tests pushes to `main`, pull requests, and `v*`
tags using Node 24. Release tags must exactly match `package.json`: `v0.1.0`
for version `0.1.0`. The workflow typechecks, runs the tests, packs the package,
and runs the Pi integration test against the extracted archive before publishing
that same archive. Stable versions use npm's `latest` channel; prereleases such
as `v0.2.0-beta.1` use `next`. Branch pushes and pull requests only verify.

One-time setup:

1. Enable Actions for `public/pi-discrimin` and make an `ubuntu-latest` runner
   available to the repository.
2. For a new npm package, first publish `0.1.0` using the manual commands above
   to claim the name under your npm account. This lets you restrict the CI token
   to this package.
3. Create an npm **granular access token**, with **Read and write (publish and
   stage)** access to `pi-discrimin` and **Bypass 2FA** enabled for unattended
   publishing. Add it as the repository's Actions secret **`NPM_TOKEN`**. Set
   an expiry and replace the secret before the token expires. The package must
   allow token publishing. See [npm's token setup documentation](https://docs.npmjs.com/creating-and-viewing-access-tokens/).
4. Commit and push the workflow and package files before pushing a release tag.
   Restrict creation of `v*` tags to release maintainers in repository settings.

After the first manual publication, release the next version from a clean
checkout:

```sh
npm version patch
git push origin main
git push origin "v$(node -p 'require("./package.json").version')"
```

`npm version` commits the version change and creates its tag. Use `minor`,
`major`, or an explicit version instead of `patch` when appropriate. Never
reuse an already-published version. If a release fails because of a missing or
expired secret, fix the secret and rerun the failed workflow.

Forgejo is not an [npm trusted-publishing provider](https://docs.npmjs.com/trusted-publishers/),
so this workflow uses a token and does not request provenance. npm currently
[plans to remove direct token publishing in January 2027](https://docs.npmjs.com/about-access-tokens/).
Before then, move publishing to a supported hosted CI provider (for example,
a public GitHub mirror with trusted publishing), or adopt npm's staged
publishing flow, which requires a maintainer to approve each release.

The repository currently has no dependency lockfile, so CI uses `npm install`.
Commit an npm-generated `package-lock.json` and change that step to `npm ci`
when establishing a reproducible dependency baseline.

### Git: share before publishing to npm

Once the source is pushed and tagged in the public repository:

```sh
pi install git:forge.jde.nz/public/pi-discrimin@v0.1.0
```

Private repositories require the user's Git credentials. A public repository is
simplest for sharing with people outside your organisation. Credentials for the
router are configured separately after installation and never belong in the
package. A tagged installation stays pinned to that tag.

### Downloadable archive

`npm pack` creates `pi-discrimin-0.1.0.tgz`. Share that file; recipients extract
it into a permanent directory and install the extracted package by local path:

```sh
mkdir pi-discrimin
tar -xzf pi-discrimin-0.1.0.tgz -C pi-discrimin --strip-components=1
pi install ./pi-discrimin
```

Local installations keep referring to that directory, so leave it in place.

## Development and verification

```sh
npm install
npm run verify
```

Tests cover authentication and cancellation, model metadata, refreshes and
outages, terminal-safe footer text, and a real Pi CLI session with a fixture HTTP
transport. The CLI test discovers the models, makes two streamed requests,
executes Pi's `read` tool against a temporary file, and observes both backend
identities in the footer API. It requires no router key or running model and
does not alter your Pi configuration. A production router smoke test remains
useful before a release to confirm the deployed router's protocol and headers.

Only `src/`, package metadata, this README, the extension manifest, and the
licence are included in the npm archive. Tests and development dependencies are
excluded.

See Pi's [package documentation](https://pi.dev/docs/latest/packages) and
[provider documentation](https://pi.dev/docs/latest/custom-provider).
