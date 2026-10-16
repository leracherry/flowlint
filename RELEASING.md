# Releasing FlowLint

## GitHub release

1. Update the package version and changelog. Run `pnpm check` and
   `pnpm verify:package`. The latter packs the built package, checks its file list,
   installs it in a fresh directory, tests CLI success/failure, imports the library,
   and compiles a TypeScript consumer against the shipped declarations.
2. Commit to main and wait for CI. Create and push a matching version tag (replace the example with the new version):

   ```sh
   git tag -a v0.2.0 -m "FlowLint v0.2.0"
   git push origin v0.2.0
   ```

3. The release workflow repeats checks on Node 22/24, verifies the installable
   tarball, and creates a GitHub Release with changelog notes and SHA256SUMS.
   Published tags and release artifacts should not be replaced; fix forward with
   a new version.

The source repository and release downloads are public under the MIT license.

## npm publishing

The repository's `NPM_TOKEN` Actions secret authenticates npm publication. Use a
publish-capable token for the `leracherry` npm account with access to
`@leracherry/flowlint`, including any required 2FA bypass permission. Never place
the token in source files or workflow logs.

After the GitHub Release finishes, dispatch **Publish verified release to npm**
with its version tag. The workflow downloads the existing tarball, checks its
SHA-256 checksum and package name/version, verifies `npm whoami` is `leracherry`,
and publishes with public access. Verify registry availability with
`npm view @leracherry/flowlint version`, then install the exact version in a fresh
project and run its CLI and API. Publishing does not change GitHub repository visibility.
Publishing an existing npm version again is not supported; fix forward with a
new version.

The workflow uses Node 24 and npm 11.6.1. Public-repository releases include npm
provenance using the job’s `id-token: write` permission. Provenance is disabled
automatically if the repository becomes private. Token authentication remains
responsible for publication; provenance attests the build workflow.

## Optional migration to Trusted Publishing

After the package exists, its npm owner can configure a GitHub Trusted Publisher
for owner `leracherry`, repository `flowlint`, workflow `npm-publish.yml`, with no
environment. Follow the current
[npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/).
Then update the workflow to grant `id-token: write`, remove token authentication
and the token-based `npm whoami` step, and verify a new-version publication before
removing the repository secret. Trusted Publishing has not been configured.
