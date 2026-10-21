# Security policy

Pindou is a browser-only app. It has no backend, no accounts, and sends no project data anywhere. The realistic risks are therefore:

- Script injection through imported images, file names, or project data.
- A dependency advisory in the build or runtime dependencies.
- Mistakes in the optional deployment templates in `deploy/`.

## Reporting a vulnerability

Report privately through GitHub Security Advisories:

<https://github.com/feijinloeng/pindou/security/advisories/new>

Do not open a public issue for a vulnerability. Please include reproduction steps, browser and version, and the affected file or feature.

This is a hobby project maintained in spare time. Expect a first reply within a week; there is no bug bounty.

## Scope

In scope:

- The web app in `src/`.
- The local storage layer (`src/storage/`) and data validation (`src/domain/`).
- The export pipeline (`src/render/`).
- The deployment templates in `deploy/`.

Out of scope:

- Data loss caused by clearing browser storage, private browsing, or switching devices. Projects live only in the visitor's IndexedDB.
- Missing features such as project-file import, accounts, or cloud sync.
- Reports that require the user to install a malicious browser extension or run a modified build.
