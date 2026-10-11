# Releasing FlowLint

## GitHub release

1. Update the package version and changelog. Run `pnpm check` and
   `pnpm verify:package`. The latter packs the built package, checks its file list,
   installs it in a fresh directory, tests CLI success/failure, imports the library,
   and compiles a TypeScript consumer against the shipped declarations.
2. Commit to main and wait for CI. Create and push a matching version tag:

   ```sh
   git tag -a v0.1.0 -m "FlowLint v0.1.0"
   git push origin v0.1.0
   ```

3. The release workflow repeats checks on Node 22/24, verifies the installable
   tarball, and creates a GitHub Release with changelog notes and SHA256SUMS.
   Published tags and release artifacts should not be replaced; fix forward with
   a new version.

The repository is private. People downloading a release need repository access.
The MIT license does not change the repository's access settings.

## npm bootstrap and Trusted Publishing

As of 2026-10-11, the anonymous registry lookup for `@leracherry/flowlint` returned
404, and this machine had no authenticated npm account. A 404 is not proof of
scope ownership or publish authorization. GitHub and npm usernames are separate.
The intended scope must be verified by its npm owner before registry publication.

1. Sign in to npm locally using `npm login`, then confirm `npm whoami` and access
   to the intended scope. Do not put tokens or credentials in this repository.
   If a different scope is required, update package metadata, documentation, and
   the package-name check in `npm-publish.yml` before making a new release.
2. The scope owner can bootstrap the first package using the verified release:

   ```sh
   npm publish ./leracherry-flowlint-0.1.0.tgz --access public
   ```

   This command makes the package public on npm. Complete npm's authentication
   and any two-factor challenge locally.

3. In the npm package settings, add a GitHub Trusted Publisher with owner
   `leracherry`, repository `flowlint`, workflow `npm-publish.yml`, no environment,
   and permission to publish directly. The file name is case-sensitive.
4. Set GitHub repository variable `NPM_PUBLISH_ENABLED` to `true`. Dispatch
   **Publish verified release to npm** with an existing release tag. The workflow
   downloads and checks the release tarball, verifies its name/version, and
   publishes using OIDC. No npm token secret is used. Do this for a new version;
   npm cannot republish an already published version.

The workflow is disabled until the variable is enabled. Trusted publisher
registration requires npm package settings access and has not been completed.
Use the current [npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/)
when configuring it. The workflow uses Node 24 and npm 11.6.1. Provenance is
explicitly disabled for this private repository because npm does not support
provenance from private repositories; it enables automatically if the repository
becomes public. Repository visibility is a separate owner decision.

A new trusted publisher currently needs its first successful publish within two
days of registration; configure it when the next version is ready.
