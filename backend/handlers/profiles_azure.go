package handlers

import (
	"net/http"

	"k8s-client/services"
	"k8s-client/session"

	"github.com/gin-gonic/gin"
)

func addAzureProfile(c *gin.Context, req addProfileRequest) {
	if req.ServiceAccountJSON == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "serviceAccountJson (Azure SP credentials) is required"})
		return
	}

	sp, err := services.ParseAzureServicePrincipal(req.ServiceAccountJSON)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	subscriptionID := req.SubscriptionID
	if subscriptionID == "" {
		subscriptionID = sp.SubscriptionID
	}

	ctx := c.Request.Context()
	if _, _, err := services.GetAzureARMToken(ctx, req.ServiceAccountJSON); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid Azure credentials: " + err.Error()})
		return
	}

	if err := services.SaveCredential(req.Name, services.StoredCredential{
		Type:               "azure",
		ServiceAccountJSON: req.ServiceAccountJSON,
	}); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	if err := services.SaveProfile(services.ProfileMeta{
		Name:           req.Name,
		Type:           "azure",
		SubscriptionID: subscriptionID,
	}); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "name": req.Name})
}

// ── Delete ───────────────────────────────────────────────────────────────────

func authAzure(c *gin.Context, meta services.ProfileMeta, req authRequest) {
	// Fall back to stored resource group (reconnect case)
	if req.ResourceGroup == "" {
		req.ResourceGroup = meta.ResourceGroup
	}
	if req.ClusterName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "clusterName is required for Azure"})
		return
	}
	ctx := c.Request.Context()
	cred, err := services.LoadCredential(meta.Name)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	rg, err := services.ResolveAKSResourceGroup(ctx, cred.ServiceAccountJSON, req.ClusterName, req.ResourceGroup)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cluster, err := services.DescribeAKSCluster(ctx, cred.ServiceAccountJSON, rg, req.ClusterName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	session.Default.ConnectAzure(meta, cluster, cred.ServiceAccountJSON)

	meta.ClusterName = req.ClusterName
	meta.ResourceGroup = rg
	if cluster.Location != "" {
		meta.Region = cluster.Location
	}
	_ = services.SaveProfile(meta)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Preview kubeconfig ────────────────────────────────────────────────────────

// PreviewKubeconfig parses a kubeconfig and returns all contexts without saving.
