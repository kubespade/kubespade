package session

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

type stubTokenSource struct {
	calls atomic.Int32
	err   error
	tok   string
	exp   time.Time
}

func (s *stubTokenSource) refresh(context.Context) (string, time.Time, error) {
	s.calls.Add(1)
	if s.err != nil {
		return "", time.Time{}, s.err
	}
	return s.tok, s.exp, nil
}

func TestCachedTokenRefreshAndInvalidate(t *testing.T) {
	exp := time.Now().Add(time.Hour)
	src := &stubTokenSource{tok: "t1", exp: exp}
	cache := &cachedToken{}

	got, err := getCloudK8sConfig(context.Background(), cache, src, "https://api", []byte("ca"))
	if err != nil {
		t.Fatalf("getCloudK8sConfig: %v", err)
	}
	if got.BearerToken != "t1" || src.calls.Load() != 1 {
		t.Fatalf("first refresh: token=%q calls=%d", got.BearerToken, src.calls.Load())
	}

	got2, err := getCloudK8sConfig(context.Background(), cache, src, "https://api", []byte("ca"))
	if err != nil {
		t.Fatalf("cached getCloudK8sConfig: %v", err)
	}
	if got2.BearerToken != "t1" || src.calls.Load() != 1 {
		t.Fatalf("cache hit: token=%q calls=%d", got2.BearerToken, src.calls.Load())
	}

	cache.invalidate()
	got3, err := getCloudK8sConfig(context.Background(), cache, src, "https://api", []byte("ca"))
	if err != nil {
		t.Fatalf("after invalidate: %v", err)
	}
	if got3.BearerToken != "t1" || src.calls.Load() != 2 {
		t.Fatalf("re-refresh: token=%q calls=%d", got3.BearerToken, src.calls.Load())
	}
}

func TestCachedTokenRefreshError(t *testing.T) {
	src := &stubTokenSource{err: errors.New("boom")}
	cache := &cachedToken{}
	if _, err := getCloudK8sConfig(context.Background(), cache, src, "https://api", nil); err == nil {
		t.Fatal("expected error")
	}
	if src.calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", src.calls.Load())
	}
}

func TestCachedTokenNearExpiryRefreshes(t *testing.T) {
	exp := time.Now().Add(time.Minute) // inside 2m skew
	src := &stubTokenSource{tok: "fresh", exp: time.Now().Add(time.Hour)}
	cache := &cachedToken{token: "stale", expiry: exp}

	if _, err := getCloudK8sConfig(context.Background(), cache, src, "https://api", nil); err != nil {
		t.Fatalf("getCloudK8sConfig: %v", err)
	}
	if src.calls.Load() != 1 {
		t.Fatalf("expected refresh near expiry, calls=%d", src.calls.Load())
	}
}
