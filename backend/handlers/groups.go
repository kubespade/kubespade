package handlers

import (
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
	"k8s-client/session"
)

func ListGroups(c *gin.Context) {
	cfg, err := services.LoadAppConfig()
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	groups := cfg.Groups
	if groups == nil {
		groups = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups})
}

func CreateGroup(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.AddGroup(strings.TrimSpace(req.Name)); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	cfg, _ := services.LoadAppConfig()
	c.JSON(http.StatusOK, gin.H{"groups": cfg.Groups})
}

func DeleteGroupHandler(c *gin.Context) {
	name := c.Param("name")
	removed, err := services.DeleteGroup(name)
	if err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	for _, profileName := range removed {
		session.Default.Remove(profileName)
		_ = services.DeleteCredential(profileName)
	}
	cfg, _ := services.LoadAppConfig()
	groups := cfg.Groups
	if groups == nil {
		groups = []string{}
	}
	c.JSON(http.StatusOK, gin.H{"groups": groups, "removedProfiles": removed})
}

func RenameGroupHandler(c *gin.Context) {
	oldName := c.Param("name")
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.RenameGroup(oldName, strings.TrimSpace(req.Name)); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	cfg, _ := services.LoadAppConfig()
	c.JSON(http.StatusOK, gin.H{"groups": cfg.Groups})
}

func SetProfileGroupHandler(c *gin.Context) {
	profileName := strings.ToLower(c.Param("name"))
	var req struct {
		Group string `json:"group"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.SetProfileGroup(profileName, req.Group); err != nil {
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func SetProfileDisplayNameHandler(c *gin.Context) {
	profileName := strings.ToLower(c.Param("name"))
	var req struct {
		DisplayName string `json:"displayName"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := services.SetProfileDisplayName(profileName, req.DisplayName); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
			return
		}
		respondErr(c, http.StatusInternalServerError, err)
		return
	}
	session.Default.SetDisplayName(profileName, strings.TrimSpace(req.DisplayName))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
