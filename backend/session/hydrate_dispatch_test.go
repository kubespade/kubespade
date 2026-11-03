package session

import (
	"context"
	"errors"
	"testing"

	"k8s-client/services"
)

func TestStHydrateOneDispatchesByType(t *testing.T) {
	orig := hydrateByType
	t.Cleanup(func() { hydrateByType = orig })

	var saw string
	hydrateByType = map[string]func(context.Context, services.ProfileMeta, services.PersistedSession) error{
		"kubeconfig": func(context.Context, services.ProfileMeta, services.PersistedSession) error {
			saw = "kubeconfig"
			return nil
		},
		"gcp": func(context.Context, services.ProfileMeta, services.PersistedSession) error {
			saw = "gcp"
			return errors.New("gcp boom")
		},
		"azure": func(context.Context, services.ProfileMeta, services.PersistedSession) error {
			saw = "azure"
			return nil
		},
	}

	ctx := context.Background()
	ps := services.PersistedSession{}

	if err := stHydrateOne(ctx, services.ProfileMeta{Type: "kubeconfig"}, ps); err != nil {
		t.Fatalf("kubeconfig: %v", err)
	}
	if saw != "kubeconfig" {
		t.Fatalf("saw = %q", saw)
	}

	err := stHydrateOne(ctx, services.ProfileMeta{Type: "gcp"}, ps)
	if err == nil || err.Error() != "gcp boom" {
		t.Fatalf("gcp err = %v", err)
	}
	if saw != "gcp" {
		t.Fatalf("saw = %q", saw)
	}

	// Unknown type falls through to hydrateAWS (not stubbed) — incomplete blob.
	err = stHydrateOne(ctx, services.ProfileMeta{Type: "aws", Name: "x"}, ps)
	if err == nil {
		t.Fatal("expected incomplete AWS session blob error")
	}
}
