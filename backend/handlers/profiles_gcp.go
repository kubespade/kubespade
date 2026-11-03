package handlers

import (
	"net/http"

	"k8s-client/services"
	"k8s-client/session"

	"github.com/gin-gonic/gin"
)

func addGCPProfile(c *gin.Context, req addProfileRequest) {
	if req.ServiceAccountJSON == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "serviceAccountJson is required"})
		return
	}

	sa, err := services.ParseGCPServiceAccount(req.ServiceAccountJSON)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	projectID := req.ProjectID
	if projectID == "" {
		projectID = sa.ProjectID
	}
	if projectID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "project_id not found in service account JSON"})
		return
	}

	// Verify that the credentials can produce a valid token.
	ctx := c.Request.Context()
	if _, _, err := services.GetGCPToken(ctx, req.ServiceAccountJSON); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid GCP credentials: " + err.Error()})
		return
	}

	if err := services.SaveCredential(req.Name, services.StoredCredential{
		Type:               "gcp",
		ServiceAccountJSON: req.ServiceAccountJSON,
	}); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	if err := services.SaveProfile(services.ProfileMeta{
		Name:      req.Name,
		Type:      "gcp",
		ProjectID: projectID,
	}); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "name": req.Name})
}

func authGCP(c *gin.Context, meta services.ProfileMeta, req authRequest) {
	ctx := c.Request.Context()
	cred, err := services.LoadCredential(meta.Name)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	cluster, err := services.DescribeGKECluster(ctx, cred.ServiceAccountJSON, meta.ProjectID, req.ClusterName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	session.Default.ConnectGCP(meta, cluster, cred.ServiceAccountJSON)

	meta.ClusterName = req.ClusterName
	if cluster.Location != "" {
		meta.Region = cluster.Location
	}
	_ = services.SaveProfile(meta)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
