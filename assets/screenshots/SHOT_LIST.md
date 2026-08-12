# Marketing screenshots

Processed by `process-screenshots.py` (restore from `_originals/`, redact, round).

| File | Platform | Notes |
|------|----------|--------|
| `01-*-overview.png` | mac / win / ipad | Cluster overview |
| `02-*-pods.png` | mac / win / ipad | Pods table |
| `02-*-pods-info.png` | mac / win / ipad | Pod detail drawer |
| `03-*-logs.png` | mac / win / ipad | Log viewer |
| `01-ipad-overview-light.png` | ipad | Overview, light theme |
| `02-ipad-pods-light.png` | ipad | Pods table, light theme |
| `04-mac-clusters.png` | mac | Manage clusters |
| `04-mac-clusters-2.png` | mac | Add Cluster dialog (homepage default) |
| `04-win-clusters.png` | win | Manage + Add Cluster (ARN redacted) |
| `04-ipad-clusters.png` | ipad | Manage + Add Cluster |

**Corners:** mac rounded to window curve (~15px @1978×1284); iPad to hardware (~58px @1224×935); Windows left square. Site uses PNG alpha + drop-shadow (no CSS clip) for mac/iPad.

**Redacted:** AWS account IDs / IAM user on cluster ARNs; local username in mac kubeconfig paths.
