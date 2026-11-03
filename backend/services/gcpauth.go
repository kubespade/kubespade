package services

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// GCPServiceAccount represents the fields we need from a service account JSON key.
type GCPServiceAccount struct {
	Type        string `json:"type"`
	ProjectID   string `json:"project_id"`
	PrivateKey  string `json:"private_key"`
	ClientEmail string `json:"client_email"`
	TokenURI    string `json:"token_uri"`
}

// GKECluster holds metadata for a single GKE cluster returned from the GCP API.
type GKECluster struct {
	Name     string `json:"name"`
	Location string `json:"location"`
	Endpoint string `json:"endpoint"`
	Status   string `json:"status"`
	CAData   []byte `json:"-"` // decoded CA certificate, not serialised
}

// ParseGCPServiceAccount validates and parses a service account JSON key.
func ParseGCPServiceAccount(jsonData string) (*GCPServiceAccount, error) {
	var sa GCPServiceAccount
	if err := json.Unmarshal([]byte(jsonData), &sa); err != nil {
		return nil, fmt.Errorf("invalid service account JSON: %w", err)
	}
	if sa.Type != "service_account" {
		return nil, fmt.Errorf("expected type 'service_account', got '%s'", sa.Type)
	}
	if sa.PrivateKey == "" || sa.ClientEmail == "" {
		return nil, fmt.Errorf("service account JSON is missing private_key or client_email")
	}
	if sa.TokenURI == "" {
		sa.TokenURI = "https://oauth2.googleapis.com/token"
	}
	return &sa, nil
}

// GetGCPToken exchanges a service account JSON key for a short-lived OAuth2 access token.
// It builds a JWT signed with the SA private key, then posts it to the token endpoint.
func GetGCPToken(ctx context.Context, saJSON string) (token string, expiry time.Time, err error) {
	sa, err := ParseGCPServiceAccount(saJSON)
	if err != nil {
		return "", time.Time{}, err
	}

	// Decode the RSA private key from PEM.
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return "", time.Time{}, fmt.Errorf("failed to decode PEM block from private_key")
	}
	keyIface, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("parse private key: %w", err)
	}
	rsaKey, ok := keyIface.(*rsa.PrivateKey)
	if !ok {
		return "", time.Time{}, fmt.Errorf("private key is not RSA")
	}

	// Build JWT header + payload.
	now := time.Now()
	headerJSON, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	payloadJSON, _ := json.Marshal(map[string]interface{}{
		"iss":   sa.ClientEmail,
		"scope": "https://www.googleapis.com/auth/cloud-platform",
		"aud":   sa.TokenURI,
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	})
	header := base64.RawURLEncoding.EncodeToString(headerJSON)
	payload := base64.RawURLEncoding.EncodeToString(payloadJSON)
	sigInput := header + "." + payload

	// Sign with RSA-SHA256.
	digest := sha256.Sum256([]byte(sigInput))
	sigBytes, err := rsa.SignPKCS1v15(rand.Reader, rsaKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign JWT: %w", err)
	}
	jwt := sigInput + "." + base64.RawURLEncoding.EncodeToString(sigBytes)

	// Exchange the JWT for an access token.
	resp, err := http.PostForm(sa.TokenURI, url.Values{
		"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"},
		"assertion":  {jwt},
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("token request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", time.Time{}, fmt.Errorf("token exchange failed (%d): %s", resp.StatusCode, body)
	}

	var tr oauthTokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", time.Time{}, fmt.Errorf("parse token response: %w", err)
	}
	if tr.Error != "" {
		return "", time.Time{}, fmt.Errorf("GCP auth error: %s: %s", tr.Error, tr.ErrorDesc)
	}

	expiry = now.Add(time.Duration(tr.ExpiresIn) * time.Second)
	return tr.AccessToken, expiry, nil
}

// ListGKEClusters lists all GKE clusters across all locations in the given project.
func ListGKEClusters(ctx context.Context, saJSON, projectID string) ([]GKECluster, error) {
	token, _, err := GetGCPToken(ctx, saJSON)
	if err != nil {
		return nil, err
	}

	apiURL := fmt.Sprintf(
		"https://container.googleapis.com/v1/projects/%s/locations/-/clusters",
		url.PathEscape(projectID),
	)
	var listResp struct {
		Clusters []struct {
			Name       string `json:"name"`
			Location   string `json:"location"`
			Endpoint   string `json:"endpoint"`
			Status     string `json:"status"`
			MasterAuth struct {
				ClusterCACertificate string `json:"clusterCaCertificate"`
			} `json:"masterAuth"`
		} `json:"clusters"`
	}
	if err := doJSONGet(ctx, apiURL, token, &listResp); err != nil {
		return nil, fmt.Errorf("GKE API: %w", err)
	}

	clusters := make([]GKECluster, 0, len(listResp.Clusters))
	for _, c := range listResp.Clusters {
		caData, _ := base64.StdEncoding.DecodeString(c.MasterAuth.ClusterCACertificate)
		clusters = append(clusters, GKECluster{
			Name:     c.Name,
			Location: c.Location,
			Endpoint: c.Endpoint,
			Status:   c.Status,
			CAData:   caData,
		})
	}
	return clusters, nil
}

// DescribeGKECluster finds a specific cluster by name within a project.
func DescribeGKECluster(ctx context.Context, saJSON, projectID, clusterName string) (*GKECluster, error) {
	clusters, err := ListGKEClusters(ctx, saJSON, projectID)
	if err != nil {
		return nil, err
	}
	for i := range clusters {
		if clusters[i].Name == clusterName {
			return &clusters[i], nil
		}
	}
	return nil, fmt.Errorf("cluster '%s' not found in project '%s'", clusterName, projectID)
}
