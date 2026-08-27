# Marketing screenshots

Processed by `process-screenshots.py` (restore from `_originals/`, redact, round).

| File | Platform | Notes |
|------|----------|--------|
| `01-*-overview.png` | mac / win / ubuntu / ipad | Cluster overview |
| `02-*-pods.png` | mac / win / ubuntu / ipad | Pods table |
| `02-*-pods-info.png` | mac / win / ubuntu / ipad | Pod detail drawer |
| `03-*-logs.png` | mac / win / ubuntu / ipad | Log viewer |
| `01-ipad-overview-light.png` | ipad | Overview, light theme |
| `02-ipad-pods-light.png` | ipad | Pods table, light theme |
| `04-mac-clusters.png` | mac | Manage clusters |
| `04-mac-clusters-2.png` | mac | Add Cluster dialog (homepage default) |
| `04-win-clusters.png` | win | Manage + Add Cluster (ARN redacted) |
| `04-ubuntu-clusters.png` | linux | Manage + Add Cluster (ARN redacted) |
| `04-ipad-clusters.png` | ipad | Manage + Add Cluster |
| `05-mac-ai-picker.png` | mac | AI client picker (In use / Switch) |
| `05-mac-ai-chat.png` | mac | AI workbench answering about clusters |
| `05-mac-ai-approve.png` | mac | Approve write dialog |
| `05-mac-ai-tabs.png` | mac | AI + pod exec tabs in one workbench |
| `05-mac-ai-settings.png` | mac | Settings → AI assistant (optional) |

AI mac shots: backed up to `_originals/`, scaled to width **1978** (match other mac gallery shots), rounded corners **15px**. No ARN/username redaction needed (Homebrew paths + `~/Library/...`).

### AI shot captions (site copy)

| File | Tag | Headline | Body |
|------|-----|----------|------|
| `05-mac-ai-picker.png` | AI clients | Pick Claude, Gemini, Codex, or Copilot | First open asks which CLI to use. The choice sticks; change it anytime in Settings. |
| `05-mac-ai-chat.png` | AI terminal | Ask your clusters in plain language | In-app AI sees only clusters connected in KubeSpade — via MCP tools, not a live kubeconfig in the shell. |
| `05-mac-ai-approve.png` | Guardrails | Writes need your OK | Reads are free. Apply and delete wait for Approve in the app before they run. |
| `05-mac-ai-tabs.png` | Workbench | AI next to pod exec | Same bottom dock as SSH and logs — switch tabs without juggling windows. |
| `05-mac-ai-settings.png` | Preferences | Change the default assistant | Preferred client lives in Settings → AI assistant; the sidebar icon matches your choice. |

**Corners:** mac rounded to window curve (~15px @1978×1284); iPad to hardware (~58px @1224×935); Ubuntu GNOME window already has transparent rounded corners — keep alpha, no extra mask; Windows left square. Site uses PNG alpha + drop-shadow (no CSS clip) for mac/Linux/iPad.

**Redacted:** AWS account IDs / IAM user on cluster ARNs; local username in mac kubeconfig paths.
