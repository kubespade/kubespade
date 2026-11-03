package services

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestParseGCPServiceAccount(t *testing.T) {
	t.Run("valid", func(t *testing.T) {
		sa, err := ParseGCPServiceAccount(`{
			"type": "service_account",
			"project_id": "p1",
			"private_key": "-----BEGIN PRIVATE KEY-----\nX\n-----END PRIVATE KEY-----\n",
			"client_email": "sa@p1.iam.gserviceaccount.com"
		}`)
		if err != nil {
			t.Fatal(err)
		}
		if sa.TokenURI != "https://oauth2.googleapis.com/token" {
			t.Errorf("default TokenURI = %q", sa.TokenURI)
		}
		if sa.ClientEmail != "sa@p1.iam.gserviceaccount.com" {
			t.Errorf("ClientEmail = %q", sa.ClientEmail)
		}
	})

	t.Run("wrong type", func(t *testing.T) {
		_, err := ParseGCPServiceAccount(`{"type":"authorized_user","private_key":"x","client_email":"a@b"}`)
		if err == nil || !strings.Contains(err.Error(), "service_account") {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("missing fields", func(t *testing.T) {
		_, err := ParseGCPServiceAccount(`{"type":"service_account"}`)
		if err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("invalid json", func(t *testing.T) {
		_, err := ParseGCPServiceAccount(`{`)
		if err == nil {
			t.Fatal("expected error")
		}
	})
}

func testGCPServiceAccountJSON(t *testing.T, tokenURI string) string {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	raw, err := json.Marshal(map[string]string{
		"type":         "service_account",
		"project_id":   "demo",
		"private_key":  string(pemKey),
		"client_email": "sa@demo.iam.gserviceaccount.com",
		"token_uri":    tokenURI,
	})
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestGetGCPTokenExchange(t *testing.T) {
	var sawAssertion bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
			t.Errorf("grant_type = %q", r.Form.Get("grant_type"))
		}
		if r.Form.Get("assertion") == "" {
			t.Error("missing assertion")
		} else {
			sawAssertion = true
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "ya29.test-token",
			"expires_in":   3600,
			"token_type":   "Bearer",
		})
	}))
	t.Cleanup(srv.Close)

	token, expiry, err := GetGCPToken(context.Background(), testGCPServiceAccountJSON(t, srv.URL))
	if err != nil {
		t.Fatalf("GetGCPToken: %v", err)
	}
	if !sawAssertion {
		t.Fatal("token endpoint did not receive JWT assertion")
	}
	if token != "ya29.test-token" {
		t.Errorf("token = %q", token)
	}
	if expiry.Before(time.Now().Add(30 * time.Minute)) {
		t.Errorf("expiry too soon: %v", expiry)
	}
}

func TestGetGCPTokenHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	t.Cleanup(srv.Close)

	_, _, err := GetGCPToken(context.Background(), testGCPServiceAccountJSON(t, srv.URL))
	if err == nil || !strings.Contains(err.Error(), "token exchange failed") {
		t.Fatalf("err = %v", err)
	}
}

func TestGetGCPTokenOAuthErrorField(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{
			"error":             "invalid_grant",
			"error_description": "Bad JWT",
		})
	}))
	t.Cleanup(srv.Close)

	_, _, err := GetGCPToken(context.Background(), testGCPServiceAccountJSON(t, srv.URL))
	if err == nil || !strings.Contains(err.Error(), "GCP auth error") {
		t.Fatalf("err = %v", err)
	}
}
