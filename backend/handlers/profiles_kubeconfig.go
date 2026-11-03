package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"k8s-client/services"
	"k8s-client/session"

	"github.com/gin-gonic/gin"
)

func addKubeconfigProfile(c *gin.Context, req addProfileRequest) {
	if req.KubeconfigData == "" && req.KubeconfigPath == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kubeconfigData or kubeconfigPath is required"})
		return
	}

	// pasted YAML → embed in vault; file path or local context → live-link
	var (
		yamlForParse string
		livePath     string
		embedded     = req.KubeconfigEmbedded
	)
	if req.KubeconfigPath != "" {
		var err error
		livePath, err = services.ValidateKubeconfigPath(req.KubeconfigPath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		raw, err := os.ReadFile(livePath)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "cannot read kubeconfig file: " + err.Error()})
			return
		}
		yamlForParse = string(raw)
		embedded = false
	} else if req.KubeconfigData != "" {
		yamlForParse = req.KubeconfigData
		if !embedded {
			if p, ok := services.MatchKubeconfigContentToPath(yamlForParse); ok {
				livePath = p
				embedded = false
			}
		}
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kubeconfigData or kubeconfigPath is required"})
		return
	}

	entries, err := services.ListKubeconfigContexts(yamlForParse)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Pin to a specific context when caller says so; fall back to single-context shortcut.
	clusterName := req.KubeconfigContext
	if clusterName == "" && len(entries) == 1 {
		clusterName = entries[0].ContextName
	}

	if clusterName != "" && livePath == "" && !embedded {
		if p, ok := services.FindLiveKubeconfigPathForContext(clusterName); ok {
			livePath = p
		}
	}

	if clusterName != "" {
		cfg, err := services.LoadAppConfig()
		if err != nil {
			respondErr(c, http.StatusInternalServerError, err)
			return
		}
		for _, p := range cfg.Profiles {
			if p.Type == "kubeconfig" && p.ClusterName == clusterName {
				c.JSON(http.StatusConflict, gin.H{
					"error": fmt.Sprintf("context %q is already imported", clusterName),
				})
				return
			}
		}
	}

	cred := services.StoredCredential{Type: "kubeconfig"}
	if livePath == "" {
		cred.KubeconfigData = yamlForParse
	}
	if err := services.SaveCredential(req.Name, cred); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	if err := services.SaveProfile(services.ProfileMeta{
		Name:               req.Name,
		Type:               "kubeconfig",
		ClusterName:        clusterName,
		KubeconfigPath:     livePath,
		KubeconfigEmbedded: livePath == "" && embedded,
	}); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	if livePath != "" && clusterName != "" {
		_ = services.AdoptLiveKubeconfigContext(livePath, clusterName)
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "name": req.Name})
}

func authKubeconfig(c *gin.Context, meta services.ProfileMeta, req authRequest) {
	cred, err := services.LoadCredential(meta.Name)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	contextName := req.ClusterName
	if contextName == "" {
		contextName = meta.ClusterName
	}
	if services.UpgradeKubeconfigLiveLink(&meta, &cred) {
		_ = services.SaveCredential(meta.Name, cred)
		_ = services.SaveProfile(meta)
	}

	yaml, err := services.ResolveKubeconfigYAML(meta, cred)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	execCmds, err := services.KubeconfigExecCommands(yaml)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(execCmds) > 0 && !req.AllowExec && !meta.AllowExec {
		c.JSON(http.StatusForbidden, gin.H{
			"needsExecConfirm": true,
			"execCommands":     execCmds,
			"error":            "This kubeconfig runs local exec plugins. Confirm to continue.",
		})
		return
	}

	insecure, serverURL, err := services.KubeconfigInsecureTLS(yaml, contextName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if insecure && !req.AllowInsecureTLS && !meta.AllowInsecureTLS {
		c.JSON(http.StatusForbidden, gin.H{
			"needsInsecureTLS": true,
			"server":           serverURL,
			"error":            "This kubeconfig disables TLS verification (insecure-skip-tls-verify).",
		})
		return
	}

	k8sCfg, err := services.KubeconfigToRestConfigWithContext(yaml, contextName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	info, err := services.ParseKubeconfigContextByName(yaml, contextName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	// Run exec credential plugin now (aws-vault, aws eks get-token, …)
	// so connect fails with a clear error instead of a later blank cluster view.
	if err := services.ProbeKubeconfigAuth(c.Request.Context(), k8sCfg); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	session.Default.ConnectKubeconfig(meta, k8sCfg, info.ClusterName, info.DisplayName)

	// Remember the chosen context for next connect (auto-skips picker).
	meta.ClusterName = contextName
	if req.AllowExec || meta.AllowExec {
		meta.AllowExec = true
	}
	if req.AllowInsecureTLS || meta.AllowInsecureTLS {
		meta.AllowInsecureTLS = true
	}
	_ = services.SaveProfile(meta)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func PreviewKubeconfig(c *gin.Context) {
	var body struct {
		KubeconfigData string `json:"kubeconfigData" binding:"required"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	entries, err := services.ListKubeconfigContexts(body.KubeconfigData)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"contexts": entries})
}

// GetDefaultKubeconfig reads ~/.kube/config, parses its contexts, and returns
// the file path + contexts — the file content is NOT sent to the client.
func GetDefaultKubeconfig(c *gin.Context) {
	home, err := os.UserHomeDir()
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "cannot determine home directory"})
		return
	}
	path := filepath.Join(home, ".kube", "config")
	data, err := os.ReadFile(path)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "~/.kube/config not found"})
		return
	}
	entries, err := services.ListKubeconfigContexts(string(data))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"path":     path,
		"contexts": entries,
	})
}

// UnlinkLiveKubeconfig drops every live-linked profile for a kubeconfig file
// (or all files if path is empty) and stops watching that file.
func UnlinkLiveKubeconfig(c *gin.Context) {
	var body struct {
		Path string `json:"path"`
	}
	if c.Request.ContentLength > 0 {
		if err := c.ShouldBindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	removed, err := services.UnlinkLiveKubeconfig(body.Path)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	for _, name := range removed {
		for _, pf := range services.DefaultPFManager.List(name) {
			services.DefaultPFManager.Stop(pf.ID)
		}
		session.Default.Remove(name)
		services.ClearAWSSession(name)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "removed": removed})
}
