package session

import (
	"context"
	"fmt"
	"sync"
	"time"

	"k8s-client/services"
	"k8s.io/client-go/rest"
)

const tokenRefreshSkew = 2 * time.Minute

// tokenSource mints a cloud bearer token when the cache is empty or near expiry.
type tokenSource interface {
	refresh(ctx context.Context) (token string, expiry time.Time, err error)
}

type cachedToken struct {
	mu     sync.Mutex
	token  string
	expiry time.Time
}

func (c *cachedToken) invalidate() {
	c.mu.Lock()
	c.token = ""
	c.expiry = time.Time{}
	c.mu.Unlock()
}

func (c *cachedToken) needsRefresh() bool {
	return c.token == "" || time.Now().Add(tokenRefreshSkew).After(c.expiry)
}

// ensureFreshLocked refreshes when needed. Caller must hold c.mu.
func (c *cachedToken) ensureFreshLocked(ctx context.Context, src tokenSource) error {
	if !c.needsRefresh() {
		return nil
	}
	tok, expiry, err := src.refresh(ctx)
	if err != nil {
		return err
	}
	c.token = tok
	c.expiry = expiry
	return nil
}

func getCloudK8sConfig(ctx context.Context, cache *cachedToken, src tokenSource, host string, caData []byte) (*rest.Config, error) {
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if err := cache.ensureFreshLocked(ctx, src); err != nil {
		return nil, err
	}
	return &rest.Config{
		Host:        host,
		BearerToken: cache.token,
		TLSClientConfig: rest.TLSClientConfig{
			CAData: caData,
		},
	}, nil
}

type gcpTokenSource struct {
	saJSON string
}

func (g gcpTokenSource) refresh(ctx context.Context) (string, time.Time, error) {
	tok, expiry, err := services.GetGCPToken(ctx, g.saJSON)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("refresh GCP token: %w", err)
	}
	return tok, expiry, nil
}

type azureTokenSource struct {
	spJSON string
}

func (a azureTokenSource) refresh(ctx context.Context) (string, time.Time, error) {
	tok, expiry, err := services.GetAzureK8sToken(ctx, a.spJSON)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("refresh Azure k8s token: %w", err)
	}
	return tok, expiry, nil
}

type awsEKSTokenSource struct {
	s   *ProfileSession
	mfa string
}

func (a awsEKSTokenSource) refresh(ctx context.Context) (string, time.Time, error) {
	awsSess, err := services.GetAWSSession(ctx, a.s.Meta, a.mfa)
	if err != nil {
		return "", time.Time{}, err
	}
	tok, err := services.GetEKSToken(ctx, awsSess, a.s.Meta.Region, a.s.ClusterName)
	if err != nil {
		return "", time.Time{}, err
	}
	return tok.Token, tok.Expiry, nil
}
