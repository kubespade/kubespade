package services

import "testing"

func TestNormalizePodPath(t *testing.T) {
	got, err := NormalizePodPath("/var/www/../www/app")
	if err != nil {
		t.Fatal(err)
	}
	if got != "/var/www/app" {
		t.Fatalf("got %q", got)
	}
	if _, err := NormalizePodPath("relative"); err == nil {
		t.Fatal("expected error for relative path")
	}
	if _, err := NormalizePodPath(""); err == nil {
		t.Fatal("expected error for empty path")
	}
}
