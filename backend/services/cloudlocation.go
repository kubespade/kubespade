package services

import (
	"context"
	"strings"
)

// FillMissingCloudLocation writes AKS/GKE location into Region when the
// profile already has a cluster but no region (older connections). Returns
// true if the in-memory meta was updated (caller should persist).
func FillMissingCloudLocation(ctx context.Context, p *ProfileMeta) bool {
	if p == nil || strings.TrimSpace(p.Region) != "" || p.ClusterName == "" {
		return false
	}
	if p.Type != "azure" && p.Type != "gcp" {
		return false
	}
	cred, err := LoadCredential(p.Name)
	if err != nil {
		return false
	}
	switch p.Type {
	case "azure":
		listed, err := ListAKSClusters(ctx, cred.ServiceAccountJSON)
		if err != nil {
			return false
		}
		for _, c := range listed {
			if c.Name == p.ClusterName && c.Location != "" {
				if p.ResourceGroup != "" && c.ResourceGroup != "" && !strings.EqualFold(c.ResourceGroup, p.ResourceGroup) {
					continue
				}
				p.Region = c.Location
				return true
			}
		}
	case "gcp":
		listed, err := ListGKEClusters(ctx, cred.ServiceAccountJSON, p.ProjectID)
		if err != nil {
			return false
		}
		for _, c := range listed {
			if c.Name == p.ClusterName && c.Location != "" {
				p.Region = c.Location
				return true
			}
		}
	}
	return false
}
