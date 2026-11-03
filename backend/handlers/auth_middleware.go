package handlers

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

// RequireAPIToken rejects requests that do not present the process API token
// via Authorization: Bearer, X-K8s-Api-Token, or access_token query (SSE/WS).
func RequireAPIToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		if !services.TokenMatches(tokenFromRequest(c)) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		c.Next()
	}
}

func tokenFromRequest(c *gin.Context) string {
	if h := c.GetHeader("Authorization"); strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	if h := c.GetHeader("X-K8s-Api-Token"); h != "" {
		return strings.TrimSpace(h)
	}
	if q := c.Query("access_token"); q != "" {
		return q
	}
	return ""
}

// AllowedWebSocketOrigin accepts only loopback origins for our UI.
func AllowedWebSocketOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	if host != "localhost" && host != "127.0.0.1" && host != "::1" {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return true
}
