package handlers

import (
	"net/http"

	"k8s-client/services"
	"k8s-client/session"

	"github.com/gin-gonic/gin"
)

func addAWSProfile(c *gin.Context, req addProfileRequest) {
	ctx := c.Request.Context()
	if req.AccessKeyID == "" || req.SecretAccessKey == "" || req.Region == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "accessKeyId, secretAccessKey, and region are required"})
		return
	}

	if err := services.VerifyAWSCredentials(ctx, req.AccessKeyID, req.SecretAccessKey, req.Region); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid AWS credentials: " + err.Error()})
		return
	}

	mfaSerial, _ := services.DiscoverMFASerial(req.AccessKeyID, req.SecretAccessKey, req.Region)

	if err := services.SaveCredential(req.Name, services.StoredCredential{
		Type:            "aws",
		AccessKeyID:     req.AccessKeyID,
		SecretAccessKey: req.SecretAccessKey,
	}); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	if err := services.SaveProfile(services.ProfileMeta{
		Name:      req.Name,
		Type:      "aws",
		Region:    req.Region,
		RoleARN:   req.RoleARN,
		MFASerial: mfaSerial,
	}); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"ok": true, "name": req.Name})
}

func authAWS(c *gin.Context, meta services.ProfileMeta, req authRequest) {
	ctx := c.Request.Context()
	awsSess, err := services.GetAWSSession(ctx, meta, req.MFAToken)
	if err != nil {
		if services.IsNeedsMFA(err) {
			c.JSON(http.StatusUnauthorized, gin.H{"needsMFA": true})
			return
		}
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	cluster, err := services.DescribeEKSCluster(ctx, awsSess, meta.Region, req.ClusterName)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	if err := session.Default.ConnectAWS(meta, cluster, awsSess); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}

	meta.ClusterName = req.ClusterName
	_ = services.SaveProfile(meta)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
