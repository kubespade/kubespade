package services

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strings"
	"sync"
)

const apiTokenEnv = "K8S_CLIENT_API_TOKEN"

var (
	apiTokenOnce sync.Once
	apiTokenVal  string
)

// APIToken returns the per-process shared secret required for /api calls.
// Prefer K8S_CLIENT_API_TOKEN from the environment (Electron sets a fresh
// value each launch). If unset, a random token is generated for this process
// (injected into served HTML; Vite must set VITE_K8S_API_TOKEN to match).
func APIToken() string {
	apiTokenOnce.Do(func() {
		if t := strings.TrimSpace(os.Getenv(apiTokenEnv)); t != "" {
			apiTokenVal = t
			return
		}
		b := make([]byte, 32)
		if _, err := rand.Read(b); err != nil {
			apiTokenVal = "insecure-fallback-token"
			return
		}
		apiTokenVal = hex.EncodeToString(b)
	})
	return apiTokenVal
}

// TokenMatches reports whether the candidate equals the process API token.
func TokenMatches(candidate string) bool {
	t := APIToken()
	return t != "" && candidate != "" && subtleConstantTimeEq(t, candidate)
}

func subtleConstantTimeEq(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var v byte
	for i := 0; i < len(a); i++ {
		v |= a[i] ^ b[i]
	}
	return v == 0
}
