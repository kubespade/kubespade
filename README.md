# KubeSpade

**KubeSpade** is a Kubernetes GUI for day-to-day cluster work — browse workloads, stream logs, edit YAML, exec, port-forward, Helm, Desktop AI, and more — without living in the terminal. Credentials stay on your device.

This repository is the **open-source Desktop client** (macOS, Windows, Linux): Electron UI, local Go API, React frontend.

Website: [https://www.kubespade.com](https://www.kubespade.com)

---

## What this repository is

| Here | Not here |
|------|----------|
| **Desktop** source (Electron + local Go API + React) | **iPad** app — separate private codebase; ships via the [App Store](https://www.kubespade.com/ipad) (paid / Store listing when live). Not open source. |
| [GitHub Releases](https://github.com/kubespade/kubespade/releases) — Desktop installers (`.dmg`, `.exe`, `.deb`, AppImage) + `SHA256SUMS.txt` | Marketing site — [kubespade.com](https://www.kubespade.com) |
| [Issues](https://github.com/kubespade/kubespade/issues) — Desktop bugs and feature requests | |

### Tags and source

Desktop installers ship on [GitHub Releases](https://github.com/kubespade/kubespade/releases) with `SHA256SUMS.txt`. **Source in this repo matches Desktop v1.5.1+** (v1.5.0 was a source drop without a matching tag tree). Prefer the [Download](https://www.kubespade.com/download) page or the latest Release; verify checksums.

---

## Download (Desktop)

- [kubespade.com/download](https://www.kubespade.com/download) or [Releases](https://github.com/kubespade/kubespade/releases)

In-app updates check this repository’s Releases API.

iPad: see [kubespade.com/ipad](https://www.kubespade.com/ipad) — App Store only; source is not in this repo.

---

## Develop (Desktop)

Needs **Go 1.25+** and **Node 20+**.

```bash
# 1. Frontend (Vite on :5173, proxies /api → :4466)
cd frontend && npm install && npm run dev

# 2. Backend
cd backend && go mod download && go run .

# 3. Electron (optional — or open http://localhost:5173)
cd electron && npm install && npm start
```

Default API port is **4466**. Signed release builds: see `./build-release.sh` and `.env.example` (signing secrets stay local — never commit `.env` or `certs/`).

See also [LICENSE](LICENSE) and [SECURITY.md](SECURITY.md) after the source tree is present.

---

## Support

Open an [Issue](https://github.com/kubespade/kubespade/issues) for **Desktop**. Include OS, app version, and cluster type (EKS / GKE / AKS / kubeconfig).

Do **not** paste kubeconfigs, tokens, or other secrets.

- Privacy: [https://www.kubespade.com/privacy](https://www.kubespade.com/privacy)
- Terms: [https://www.kubespade.com/terms](https://www.kubespade.com/terms)
- Email: support@kubespade.com
- Security: [SECURITY.md](SECURITY.md) (or a private report — no public exploit write-ups)

---

## License

Desktop source in this repository is **Apache License 2.0** (see [LICENSE](LICENSE)). The iPad app is a separate product and is not licensed or distributed as source from this repo.
