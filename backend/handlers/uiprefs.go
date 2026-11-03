package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

// GetUIPrefs returns UI preferences stored beside profiles (survives reinstall).
func GetUIPrefs(c *gin.Context) {
	prefs, err := services.LoadUIPrefs()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"prefs": prefs})
}

type uiPrefsBody struct {
	Prefs  map[string]string `json:"prefs"`
	Remove []string          `json:"remove"`
}

// PutUIPrefs merges UI preference updates into the persistent store.
func PutUIPrefs(c *gin.Context) {
	var body uiPrefsBody
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	prefs, err := services.MergeUIPrefs(body.Prefs, body.Remove)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"prefs": prefs})
}
