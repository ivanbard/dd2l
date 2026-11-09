# Publishing dd2l

Publish a stable GitHub Release to publish `@ivanbard/dd2l` to npm automatically.
Pushing commits or tags alone does not publish anything. Drafts and prereleases
are ignored. Major, minor and patch releases all use the same workflow.

## Continuous integration

GitHub Actions runs `npm ci` and `npm run release:check` on pull requests and
pushes to `main`, using Windows Server 2025, Node.js 24 and the runner's installed
Google Chrome. The same checks can be started manually from the Actions tab.
Windows exercises the DPAPI and OCR tests; CI uses fictional data and test
credentials, without a school or ChatGPT login.

The GitHub branch protection for `main` requires a pull request and the
`Windows release checks` status check on an up-to-date branch before merging.
Force pushes and branch deletion are disabled. No approving review is required,
and administrators retain GitHub's default bypass. If recreating these settings,
the check becomes selectable after the workflow has run.
Weekly Dependabot pull requests update npm dependencies and GitHub Actions;
they go through the same checks and require manual merging.

## One-time npm setup

The package already exists as `@ivanbard/dd2l`; its installed binary is `dd2l`.
Sign into the npm account that owns the `@ivanbard` scope, enable two-factor
authentication, and keep recovery codes somewhere private.

In [the package settings](https://www.npmjs.com/package/@ivanbard/dd2l/access),
add a **GitHub Actions trusted publisher** with these exact values:

| Field | Value |
| --- | --- |
| Organization or user | `ivanbard` |
| Repository | `dd2l` |
| Workflow filename | `publish.yml` |
| Environment | Leave empty (the workflow does not use an environment) |
| Allowed actions, if offered | Allow direct `npm publish` |

No npm token or `NPM_TOKEN` GitHub secret is needed. The workflow uses GitHub's
short-lived OIDC identity and installs npm 11 for trusted publishing support
(npm 11.5.1 or newer is required). npm automatically attaches provenance for
trusted GitHub Actions publishes; the command also requests it explicitly.
See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

Configure the trusted publisher when ready to release: npm currently requires
its first successful publish within two days of configuration. If it expires,
recreate the connection before publishing.

## Release

1. Complete the security audit and address release-blocking findings before
   publishing. Passing CI does not establish that the audit passed. Review the
   README, MIT license, third-party notices and package contents as appropriate.
2. Update the version and lockfile together, for example:

   ```powershell
   npm version patch --no-git-tag-version
   ```

   Use `minor` or `major` instead for the intended version change. Commit the
   changes, open a pull request, and merge after CI passes.
3. On GitHub, draft a new release. Create a tag named exactly `vX.Y.Z` matching
   the merged `package.json` version, targeting that commit on `main`. Review
   the release notes and publish the release without marking it a prerelease.
4. Watch **Publish to npm** in Actions. It checks out the tag, verifies the
   version and that the commit belongs to `main`, then runs `npm ci` and
   `npm publish --provenance`. The existing `prepublishOnly` hook runs all tests,
   Chrome UI checks and npm package-content validation before uploading.
5. After success, verify the released version (replace `X.Y.Z`):

   ```powershell
   npm view @ivanbard/dd2l@X.Y.Z version bin --json --registry=https://registry.npmjs.org/
   npx --yes @ivanbard/dd2l@X.Y.Z --help
   ```

The package's `publishConfig` publishes publicly to the npm registry. Stable
releases update npm's `latest` tag, so release versions in ascending order.
The workflow serializes publishing and does not cancel an active publish.
Make sure `publish.yml` is merged before creating the release tag.

## Failed releases

If validation, tests or npm authentication fail, nothing is published. Fix the
cause before retrying. For trusted publishing errors, check the exact repository
and workflow values in npm settings and whether the connection has expired.

If npm accepted a version but a later workflow step or network response failed,
check the registry before retrying. Published npm versions cannot be overwritten;
fix code in a new version instead of moving an already published release tag.
Do not bypass release checks with `--ignore-scripts`.
