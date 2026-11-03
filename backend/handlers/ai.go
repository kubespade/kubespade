package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
	"k8s-client/session"
	"k8s.io/client-go/rest"
)

// CreateAIWorkspace builds an ephemeral multi-context kubeconfig + CLAUDE.md
// for all currently connected profile sessions.
func CreateAIWorkspace(c *gin.Context) {
	sessList := session.Default.List()
	restByProfile := map[string]*rest.Config{}
	labels := map[string]string{}

	for _, s := range sessList {
		cfg, err := s.GetK8sConfig(c.Request.Context(), "")
		if err != nil {
			// Skip profiles that cannot mint a token right now (e.g. MFA needed).
			continue
		}
		restByProfile[s.Meta.Name] = cfg
		labels[s.Meta.Name] = s.DisplayLabel()
	}

	ws, err := services.WriteAIWorkspace(restByProfile, labels)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, ws)
}

// DeleteAIWorkspace wipes the ephemeral AI workspace from disk.
func DeleteAIWorkspace(c *gin.Context) {
	if err := services.ClearAIWorkspace(); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
