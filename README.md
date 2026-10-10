# pi-discrimen

Connect [Pi](https://pi.dev/) to a **Discrimen** router. Use automatic routing,
choose an underlying model from Pi's model picker, and see which model serves
each response in the footer.

```text
Discrimen · Auto → Qwen3.8 Flash Next
```

The package is **pi-discrimen**, and the provider and router are **Discrimen**.
Requires Pi **1.0.4 or newer** and Node **22.19 or newer**. Older
`@mariozechner/pi-coding-agent` and GSD builds are not supported by this release.

## Install and connect

Install from npm:

```sh
pi install npm:pi-discrimen
pi
```

Inside Pi:

```text
/login discrimen
/discrimen auto
```

Login asks for the router URL and a **client API key**. Paste either the root URL
or its `/v1` URL; reverse-proxy prefixes are supported. The key prompt is masked.
The extension verifies access to `/v1/models` before Pi saves the credential.
Pi stores the key and its associated URL in `~/.pi/agent/auth.json`, respecting
`PI_CODING_AGENT_DIR` if set. It does not put secrets in project settings.

`/discrimen auto` selects automatic routing for the current session. Open
`/model`, select **Discrimen — Auto**, and press **Ctrl+S** to make it the default
for new sessions. The extension leaves your existing default alone until you
save a new one.

You need network access to the router, including your VPN if it is private.
An administrator can issue a separate client key for each person. Admin keys
are unnecessary for this integration.

## Update the extension

For an npm installation, run this in your terminal:

```sh
pi update --extensions
```

This updates your unpinned Pi packages, including `pi-discrimen`. Restart Pi or
run `/reload` in an existing session to load the updated extension. Your saved
Discrimen login is kept; you do not need to enter the router URL or API key again.

If you installed a specific version, such as `npm:pi-discrimen@0.1.1`, it stays
pinned. Switch to the latest release and receive future updates with:

```sh
pi install npm:pi-discrimen
```

Then restart Pi or run `/reload`. Git tags and commits also stay pinned; install
the desired newer Git tag explicitly. For a local checkout, pull the latest
source in that directory, then restart Pi or run `/reload`.

To refresh the available models without updating the extension, run inside Pi:

```text
/discrimen refresh
/model
```

If prompted to connect, run `/login discrimen` first. If you still have the old
`pi-discrimin` package, follow [Migrating from the misspelled package](#migrating-from-the-misspelled-package);
updating it does not switch to the corrected package name.

## Models and commands

| Command | Action |
| --- | --- |
| `/login discrimen` | Connect, change router, or replace the API key |
| `/discrimen auto` | Select the router's `default` model |
| `/model` | Choose Auto, Expert, or an underlying model |
| `/discrimen refresh` | Fetch the latest catalogue, including additions and removals |
| `/discrimen status` | Show the configured URL and current catalogue size |
| `/logout` | Remove the saved Discrimen credential through Pi's provider menu |

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

For CI or a temporary shell session, supply `DISCRIMEN_URL` and
`DISCRIMEN_API_KEY` through your environment or secret manager:

```sh
export DISCRIMEN_URL=https://router.example.com
# Set DISCRIMEN_API_KEY using your secret manager.
pi --provider discrimen --model default
```

A saved login takes precedence. Log out of Discrimen before changing connections
using environment variables. Environment credentials remain usable after logout
until you unset them.

## Migrating from the misspelled package

The initial prototype was published as `pi-discrimin`. Replace an npm
installation with:

```sh
pi remove npm:pi-discrimin
pi install npm:pi-discrimen
```

If you installed a pinned version or Git source, use `pi list` to find the old
source and pass that exact source to `pi remove`. Restart Pi, run
`/login discrimen`, then `/discrimen auto`, and save your new default in `/model`.
Saved credentials under the old `discrimin` provider are not migrated. For
environment setup, rename `DISCRIMIN_URL` and `DISCRIMIN_API_KEY` to
`DISCRIMEN_URL` and `DISCRIMEN_API_KEY`.

## Try a local checkout

```sh
pi -e /path/to/pi-discrimen
```

To keep it installed:

```sh
pi install /path/to/pi-discrimen
```

Pi supplies the runtime dependencies and loads the TypeScript source directly.
There is no build step. Restart Pi or run `/reload` after installing in another
terminal.

## Distribute it

### npm: easiest for users

The package is published as `pi-discrimen`. Users install it with:

```sh
pi install npm:pi-discrimen
```

See [Update the extension](#update-the-extension) for upgrading an installation.
For reproducible installs, use `pi install npm:pi-discrimen@0.1.1`; a pinned
installation stays on that version until its package specification is changed.

### CI releases from GitHub

[j842/pi-discrimen](https://github.com/j842/pi-discrimen) is the primary source
repository and issue tracker. `.github/workflows/ci.yaml` verifies pushes to
`main` and pull requests. `.github/workflows/publish.yaml` publishes `v*` tags
using npm **Trusted Publishing**, with short-lived GitHub OIDC credentials.
No npm token or repository secret is required.

The release workflow uses GitHub-hosted Ubuntu runners, Node 24, and an npm CLI
with Trusted Publishing support. It checks the release tag and repository
metadata, typechecks, runs the tests, packs the package, and tests the extracted
archive with the real Pi CLI before publishing that same archive. Stable
versions use npm's `latest` channel; prereleases such as `v0.2.0-beta.1` use
`next`. npm adds provenance automatically.

One-time setup:

1. Push the source and workflow files to `https://github.com/j842/pi-discrimen.git`
   and enable GitHub Actions. Keep `package.json`'s `repository.url` set to
   `git+https://github.com/j842/pi-discrimen.git`; npm checks that it matches.
2. Publish the new package name once from a terminal using your npm account's
   2FA (no bypass token is needed): `npm login`, then
   `npm publish --access public`. Complete the authentication challenge.
   Skip this step if `pi-discrimen` is already published under your account.
3. Open [the npm package settings](https://www.npmjs.com/package/pi-discrimen/access),
   find **Trusted Publisher**, and select **GitHub Actions**. Enter:

   | Setting | Value |
   | --- | --- |
   | Organization or user | `j842` |
   | Repository | `pi-discrimen` |
   | Workflow filename | `publish.yaml` |
   | Environment name | Leave blank |
   | Allowed actions | Enable direct publishing with `npm publish` |

   Enter only the workflow filename, without `.github/workflows/`. Allowing
   only staged publishing will not authorize this workflow's `npm publish`.
4. Complete the first CI publication within two days of creating the trusted
   publisher; npm expires an unused configuration after that interval.
5. After a successful trusted publication, npm's **Publishing access** setting
   can be changed to **Require two-factor authentication and disallow tokens**.
   Trusted Publishing continues working. Revoke any unused npm publishing token
   and remove the old `NPM_TOKEN` secret if one was created.

See [npm's Trusted Publishing guide](https://docs.npmjs.com/trusted-publishers/).
Restrict creation of `v*` tags to release maintainers using GitHub repository
rules. After the first manual publication of `pi-discrimen@0.1.0`, release the
next version from a clean checkout with `origin` pointing to GitHub:

```sh
npm version patch
git push origin main
git push origin "v$(node -p 'require("./package.json").version')"
```

`npm version` updates the package and extension manifest together, commits the
version change, and creates its tag. Use `minor`,
`major`, or an explicit version instead of `patch` when appropriate. Never
reuse an already-published version. Release tags must exactly match
`package.json`, for example `v0.1.1` for version `0.1.1`. If npm rejects the OIDC
authentication, check the exact publisher fields and allowed actions above;
recreate an expired publisher configuration and rerun the failed workflow.

For a manual publication, enable account 2FA on npm, run `npm login`, then
`npm publish --access public` and complete the authentication challenge.
Logging in alone is insufficient without 2FA. See
[npm's 2FA setup instructions](https://docs.npmjs.com/configuring-two-factor-authentication/).

The repository currently has no dependency lockfile, so CI uses `npm install`.
Commit an npm-generated `package-lock.json` and change that step to `npm ci`
when establishing a reproducible dependency baseline.

### Install directly from GitHub

Install a tagged release from the public repository:

```sh
pi install git:github.com/j842/pi-discrimen@v0.1.1
```

Private repositories require the user's Git credentials. A public repository is
simplest for sharing with people outside your organisation. Credentials for the
router are configured separately after installation and never belong in the
package. A tagged installation stays pinned to that tag.

### Downloadable archive

`npm pack` creates `pi-discrimen-0.1.1.tgz`. Share that file; recipients extract
it into a permanent directory and install the extracted package by local path:

```sh
mkdir pi-discrimen
tar -xzf pi-discrimen-0.1.1.tgz -C pi-discrimen --strip-components=1
pi install ./pi-discrimen
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
