package handlers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
	"k8s-client/session"
	rest "k8s.io/client-go/rest"
)

// respondErr writes {"error": err.Error()} with the given HTTP status.
func respondErr(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"error": err.Error()})
}

// respondBadRequest writes a 400 {"error": msg}.
func respondBadRequest(c *gin.Context, msg string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": msg})
}

// respondK8sConfigError writes the standard response for a failed GetK8sConfig:
// 401 {needsMFA:true} when the profile needs (re)authentication, otherwise 500.
// Centralising this keeps the MFA re-auth path uniform across every handler.
func respondK8sConfigError(c *gin.Context, err error) {
	if services.IsNeedsMFA(err) {
		c.JSON(http.StatusUnauthorized, gin.H{"needsMFA": true})
		return
	}
	respondErr(c, http.StatusInternalServerError, err)
}

// resolveSession looks up the connected profile session for the ":name" route
// param. On failure it writes a 400 response and returns ok=false.
func resolveSession(c *gin.Context) (name string, sess *session.ProfileSession, ok bool) {
	name = strings.ToLower(c.Param("name"))
	sess, found := session.Default.Get(name)
	if !found {
		respondBadRequest(c, "profile not connected")
		return "", nil, false
	}
	return name, sess, true
}

// resolveSessionQuiet is like resolveSession but does not write an error response.
func resolveSessionQuiet(c *gin.Context, name string) (sess *session.ProfileSession, ok bool) {
	name = strings.ToLower(name)
	if name == "" {
		name = strings.ToLower(c.Param("name"))
	}
	sess, found := session.Default.Get(name)
	if !found {
		return nil, false
	}
	return sess, true
}

// resolveK8s resolves the profile session and its Kubernetes rest.Config for the
// ":name" route param. It is the shared preamble for cluster-touching handlers:
// on any failure it writes the appropriate response (400 not-connected, 401
// needsMFA, or 500) and returns ok=false, so the caller need only `if !ok { return }`.
func resolveK8s(c *gin.Context) (name string, sess *session.ProfileSession, k8sCfg *rest.Config, ok bool) {
	name, sess, ok = resolveSession(c)
	if !ok {
		return "", nil, nil, false
	}
	cfg, err := sess.GetK8sConfig(c.Request.Context(), "")
	if err != nil {
		respondK8sConfigError(c, err)
		return "", nil, nil, false
	}
	return name, sess, cfg, true
}
