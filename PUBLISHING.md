# Publishing dd2l

Publish from the Windows checkout with Node.js 24+ and Google Chrome installed.
No npm token belongs in this repository. Publication is manual; pushing a commit
does not publish anything.

## One-time account setup

1. Create an account at https://www.npmjs.com/signup and verify its email address.
2. Enable two-factor authentication in npm account settings. Keep recovery codes
   somewhere private.
3. Run `npm login --registry=https://registry.npmjs.org/` and complete the browser
   flow. Confirm the account with `npm whoami --registry=https://registry.npmjs.org/`.

The package is named `@ivanbard/dd2l`. npm rejected the unscoped `dd2l` name
because it resembles an existing package. Publish with the npm account that owns
the `@ivanbard` scope. The installed binary is still named `dd2l`.

## First release, after the security audit

1. Finish the security audit and address its release-blocking findings. The
   package checks do not establish that the audit passed.
2. Make the GitHub repository public and confirm its code is the version you
   intend to distribute. Review the README, MIT license, third-party notices,
   and package metadata. The initial package version is `0.1.0`.
3. Run `npm ci`, then `npm run release:check`. This runs tests, Chrome UI checks,
   and validates the actual npm package file list without publishing.
4. Review the payload with `npm pack --dry-run`. Test the packed package on a
   fresh Windows account if possible. Commit and push all approved changes.
5. Check `git status --short` is empty, then publish:

   ```powershell
   npm publish
   ```

`npm publish` reruns `release:check` automatically before uploading. It targets
the public npm registry using `publishConfig`; complete npm's authentication or
2FA prompt if requested. Do not use `--ignore-scripts`, which bypasses the checks.
If a check fails, fix it and retry. Registry authorization or name-availability
errors must be resolved through npm; local checks cannot prevent those.

After success, verify:

```powershell
npm view @ivanbard/dd2l@0.1.0 version bin --json --registry=https://registry.npmjs.org/
npx --yes @ivanbard/dd2l@0.1.0 --help
```

Users can then run `npx @ivanbard/dd2l setup`. The GitHub repository's visibility and an
npm release are separate; making one public does not publish the other.

## Later releases

With a clean checkout after fixes and audit review, use `npm version patch`
(or an intentional minor/major bump), `git push --follow-tags`, then `npm publish`.
`npm version` creates a commit and tag; review changes before running it. npm
versions cannot be overwritten, so use a new version for each release.
