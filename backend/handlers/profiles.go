package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"k8s-client/services"
	"k8s-client/session"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ── List ─────────────────────────────────────────────────────────────────────

func ListProfiles(c *gin.Context) {
	cfg, err := services.LoadAppConfig()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	type profileResponse struct {
		services.ProfileMeta
		SessionActive bool   `json:"sessionActive"`
		Connected     bool   `json:"connected"`
		ClusterName   string `json:"clusterName"`
		DisplayName   string `json:"displayName"`
	}

	for name, p := range cfg.Profiles {
		if p.Type == "kubeconfig" && p.KubeconfigPath == "" && !p.KubeconfigEmbedded {
			cred, err := services.LoadCredential(name)
			if err == nil && services.UpgradeKubeconfigLiveLink(&p, &cred) {
				_ = services.SaveCredential(name, cred)
				_ = services.SaveProfile(p)
				cfg.Profiles[name] = p
			}
		}
	}

	if services.HasLiveKubeconfigProfiles(cfg) {
		for _, name := range services.SyncLiveKubeconfigProfiles() {
			for _, pf := range services.DefaultPFManager.List(name) {
				services.DefaultPFManager.Stop(pf.ID)
			}
			session.Default.Remove(name)
		}
		cfg, err = services.LoadAppConfig()
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
	}

	profiles := make([]profileResponse, 0, len(cfg.Profiles))
	locCtx, locCancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer locCancel()
	for name, p := range cfg.Profiles {
		if p.Name == "" {
			p.Name = name
		}
		if services.FillMissingCloudLocation(locCtx, &p) {
			_ = services.SaveProfile(p)
			cfg.Profiles[name] = p
		}
		s, connected := session.Default.Get(p.Name)
		// clusterName is the auth/reconnect key (context name for kubeconfig).
		clusterName := p.ClusterName
		displayName := services.ProfileDisplayName(p)
		if connected {
			if p.Type != "kubeconfig" {
				clusterName = s.ClusterName
			}
			// User alias on the profile wins over the live session label.
			if strings.TrimSpace(p.DisplayName) == "" {
				if p.Type == "kubeconfig" {
					if s.DisplayName != "" {
						displayName = s.DisplayName
					} else {
						displayName = services.ShortClusterDisplayName(s.ClusterName)
					}
				} else {
					displayName = s.ClusterName
				}
			}
		}
		profiles = append(profiles, profileResponse{
			ProfileMeta:   p,
			SessionActive: services.CheckSession(p.Name, p),
			Connected:     connected,
			ClusterName:   clusterName,
			DisplayName:   displayName,
		})
	}

	c.JSON(http.StatusOK, gin.H{"profiles": profiles})
}

// ── Add ──────────────────────────────────────────────────────────────────────

type addProfileRequest struct {
	Name   string `json:"name"` // opaque id; omitted → server generates UUID
	Type   string `json:"type"` // "aws" (default) | "kubeconfig" | "gcp" | "azure"
	Region string `json:"region"`
	// AWS
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	RoleARN         string `json:"roleArn"`
	// kubeconfig — supply either KubeconfigData (raw YAML) or KubeconfigPath (server-side file)
	KubeconfigData     string `json:"kubeconfigData"`
	KubeconfigPath     string `json:"kubeconfigPath"`     // read directly from this path on the server
	KubeconfigContext  string `json:"kubeconfigContext"`  // pin to a specific context (optional)
	KubeconfigEmbedded bool   `json:"kubeconfigEmbedded"` // true = pasted YAML, never live-link
	// GCP
	ServiceAccountJSON string `json:"serviceAccountJson"`
	ProjectID          string `json:"projectId"`
	// Azure (ServiceAccountJSON also used for Azure SP JSON)
	SubscriptionID string `json:"subscriptionId"`
}

func AddProfile(c *gin.Context) {
	var req addProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.Name = strings.ToLower(strings.TrimSpace(req.Name))
	if req.Name == "" {
		req.Name = strings.ToLower(uuid.New().String())
	} else {
		cfg, err := services.LoadAppConfig()
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		if _, exists := cfg.Profiles[req.Name]; exists {
			c.JSON(http.StatusBadRequest, gin.H{"error": "profile " + req.Name + " already exists"})
			return
		}
	}
	if req.Type == "" {
		req.Type = "aws"
	}

	switch req.Type {
	case "aws":
		addAWSProfile(c, req)
	case "kubeconfig":
		addKubeconfigProfile(c, req)
	case "gcp":
		addGCPProfile(c, req)
	case "azure":
		addAzureProfile(c, req)
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported type: " + req.Type})
	}
}

func DeleteProfile(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	for _, pf := range services.DefaultPFManager.List(name) {
		services.DefaultPFManager.Stop(pf.ID)
	}
	session.Default.Remove(name)
	services.ClearAWSSession(name)
	_ = services.DeleteCredential(name)
	_ = services.DeleteProfileMeta(name)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DisconnectProfile drops the live k8s session (and AWS MFA cache) but keeps
// the saved profile credentials so the user can reconnect later.
func DisconnectProfile(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	cfg, err := services.LoadAppConfig()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	if _, ok := cfg.Profiles[name]; !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	for _, pf := range services.DefaultPFManager.List(name) {
		services.DefaultPFManager.Stop(pf.ID)
	}
	session.Default.Remove(name)
	services.ClearAWSSession(name)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── List clusters ─────────────────────────────────────────────────────────────

func ListClusters(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	mfaToken := c.Query("mfaToken")

	cfg, err := services.LoadAppConfig()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	meta, ok := cfg.Profiles[name]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	ctx := c.Request.Context()

	switch meta.Type {
	case "kubeconfig":
		cred, err := services.LoadCredential(meta.Name)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		yaml, err := services.ResolveKubeconfigYAML(meta, cred)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		entries, err := services.ListKubeconfigContexts(yaml)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		clusters := make([]gin.H, len(entries))
		for i, e := range entries {
			clusters[i] = gin.H{"name": e.ContextName, "location": e.ClusterName}
		}
		c.JSON(http.StatusOK, gin.H{"clusters": clusters})

	case "gcp":
		cred, err := services.LoadCredential(meta.Name)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		gkeClusters, err := services.ListGKEClusters(ctx, cred.ServiceAccountJSON, meta.ProjectID)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"clusters": gkeClusters})

	case "azure":
		cred, err := services.LoadCredential(meta.Name)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		aksClusters, err := services.ListAKSClusters(ctx, cred.ServiceAccountJSON)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"clusters": aksClusters})

	default: // "aws" or ""
		awsSess, err := services.GetAWSSession(ctx, meta, mfaToken)
		if err != nil {
			if services.IsNeedsMFA(err) {
				c.JSON(http.StatusUnauthorized, gin.H{"needsMFA": true, "message": "MFA required"})
				return
			}
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		eksClusters, err := services.ListEKSClusters(ctx, awsSess, meta.Region)
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"clusters": eksClusters})
	}
}

// ── Seed cloud session (MFA) ──────────────────────────────────────────────────

type sessionSeedRequest struct {
	MFAToken string `json:"mfaToken"`
}

// SeedProfileSession caches temporary cloud credentials (AWS GetSessionToken /
// AssumeRole) using an MFA code. Used before the profile is "connected" to a
// cluster — unlike /k8s/info, this does not require an existing k8s session.
func SeedProfileSession(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	var req sessionSeedRequest
	_ = c.ShouldBindJSON(&req)
	if req.MFAToken == "" {
		req.MFAToken = c.Query("mfaToken")
	}

	cfg, err := services.LoadAppConfig()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	meta, ok := cfg.Profiles[name]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	ctx := c.Request.Context()
	switch meta.Type {
	case "kubeconfig", "gcp", "azure":
		// No MFA session cache for these types.
		c.JSON(http.StatusOK, gin.H{"ok": true})
		return
	default: // aws
		if _, err := services.GetAWSSession(ctx, meta, req.MFAToken); err != nil {
			if services.IsNeedsMFA(err) {
				c.JSON(http.StatusUnauthorized, gin.H{"needsMFA": true, "message": "MFA required"})
				return
			}
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// ── Auth ──────────────────────────────────────────────────────────────────────

type authRequest struct {
	MFAToken         string `json:"mfaToken"`
	ClusterName      string `json:"clusterName"`
	ResourceGroup    string `json:"resourceGroup"` // Azure AKS only
	AllowExec        bool   `json:"allowExec"`
	AllowInsecureTLS bool   `json:"allowInsecureTLS"`
}

func AuthProfile(c *gin.Context) {
	name := strings.ToLower(c.Param("name"))
	var req authRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cfg, err := services.LoadAppConfig()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	meta, ok := cfg.Profiles[name]
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	switch meta.Type {
	case "kubeconfig":
		authKubeconfig(c, meta, req)
	case "gcp":
		authGCP(c, meta, req)
	case "azure":
		authAzure(c, meta, req)
	default: // "aws" or legacy empty string
		authAWS(c, meta, req)
	}
}
