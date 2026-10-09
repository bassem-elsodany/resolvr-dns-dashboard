# Contributing to Resolvr

Thanks for helping out. Bug reports, fixes and small features are all welcome.

## Before you start

- **Bugs:** open an issue using the bug template first, unless the fix is trivial.
- **Features:** open an issue to discuss it before writing code, so we agree on scope.
- **Security problems:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Requires Node.js 24. Each service has its own `package.json`:

```bash
cd backend  && npm ci && npm run dev    # API on the port set in your env
cd frontend && npm ci && npm run dev    # Vite dev server
```

See the [Development](README.md#development) and [Configuration](README.md#configuration) sections of the README for environment variables.

## Making a change

1. Fork the repo and branch from `main`. Use a descriptive prefix: `fix/…`, `feat/…`, `docs/…`, `chore/…`.
2. Keep the change focused. One concern per pull request.
3. Add or update tests. Bug fixes should include a test that fails without the fix.
4. Run what CI runs, in both services you touched:

   ```bash
   cd backend  && npm test && npm run build
   cd frontend && npm test && npm run build
   ```

   `npm run build` also type-checks.
5. Open a pull request against `main` and fill in the template.

`main` is protected: changes land through a pull request with passing CI. Pull requests are squash-merged, so the PR title becomes the commit message. Write it in the imperative, for example `Fix live toggle resetting on navigation`.

## Releases

Releases are tagged `vMAJOR.MINOR.PATCH`. Pushing a tag publishes versioned Docker images to GHCR. Every merge to `main` also updates the `latest` tag, so pin a version if you need stability.

The version shown next to the app name in the sidebar comes from `frontend/package.json`. To cut a release:

1. In a pull request, bump the version in both services (they share one number):
   `cd frontend && npm version X.Y.Z --no-git-tag-version`, then the same in `backend/`.
2. Merge it, then tag that commit `vX.Y.Z` and create the GitHub release.
