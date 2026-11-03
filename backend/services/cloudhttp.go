package services

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// oauthTokenResponse is the shared shape of GCP/Azure token endpoints.
type oauthTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

// doJSONGet performs an authenticated GET and unmarshals JSON into out.
func doJSONGet(ctx context.Context, apiURL, bearer string, out any) error {
	return doJSON(ctx, http.MethodGet, apiURL, bearer, nil, "", out)
}

// doJSONPost performs an authenticated POST (optional JSON body) and unmarshals into out.
func doJSONPost(ctx context.Context, apiURL, bearer string, jsonBody string, out any) error {
	var body io.Reader
	contentType := ""
	if jsonBody != "" {
		body = strings.NewReader(jsonBody)
		contentType = "application/json"
	}
	return doJSON(ctx, http.MethodPost, apiURL, bearer, body, contentType, out)
}

func doJSON(ctx context.Context, method, apiURL, bearer string, body io.Reader, contentType string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, apiURL, body)
	if err != nil {
		return err
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", method, apiURL, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s %s error (%d): %s", method, apiURL, resp.StatusCode, raw)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("parse response: %w", err)
	}
	return nil
}
