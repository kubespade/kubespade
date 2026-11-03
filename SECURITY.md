# Security

## Reporting a vulnerability

Email **security concerns** to the maintainer via GitHub Security Advisories on this repository (preferred) or open a **private** report — do not file a public issue with exploit details.

Please include: desktop OS, app version, and a minimal reproduction. **Do not** paste kubeconfigs, cloud credentials, tokens, or cluster secrets.

## What this project stores

KubeSpade Desktop keeps cluster credentials and profiles on the local machine (OS keyring / app data). There is no KubeSpade cloud proxy for your Kubernetes API traffic. Optional update checks talk to GitHub Releases only.

## Signing releases

Official installers are published on GitHub Releases with `SHA256SUMS.txt`. macOS builds are notarized; Windows builds may be Authenticode-signed. Signing secrets and certificates are **never** in this repository — see `.env.example` and `certs/` (gitignored) for local release builds.
