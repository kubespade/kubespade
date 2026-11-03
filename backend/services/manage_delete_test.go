package services

import (
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestParseDeleteResourceOptions(t *testing.T) {
	t.Run("defaults", func(t *testing.T) {
		opts, err := ParseDeleteResourceOptions("", "", "")
		if err != nil {
			t.Fatal(err)
		}
		if opts.Force || opts.GracePeriodSeconds != nil {
			t.Fatalf("unexpected opts: %+v", opts)
		}
		if opts.Propagation != string(metav1.DeletePropagationForeground) {
			t.Fatalf("propagation = %q", opts.Propagation)
		}
	})

	t.Run("force implies grace 0", func(t *testing.T) {
		opts, err := ParseDeleteResourceOptions("true", "", "Background")
		if err != nil {
			t.Fatal(err)
		}
		if !opts.Force || opts.GracePeriodSeconds == nil || *opts.GracePeriodSeconds != 0 {
			t.Fatalf("unexpected opts: %+v", opts)
		}
		if opts.Propagation != string(metav1.DeletePropagationBackground) {
			t.Fatalf("propagation = %q", opts.Propagation)
		}
	})

	t.Run("explicit grace wins with force", func(t *testing.T) {
		opts, err := ParseDeleteResourceOptions("1", "30", "Orphan")
		if err != nil {
			t.Fatal(err)
		}
		if opts.GracePeriodSeconds == nil || *opts.GracePeriodSeconds != 30 {
			t.Fatalf("grace = %v", opts.GracePeriodSeconds)
		}
	})

	t.Run("bad propagation", func(t *testing.T) {
		if _, err := ParseDeleteResourceOptions("", "", "sideways"); err == nil {
			t.Fatal("expected error")
		}
	})

	t.Run("bad grace", func(t *testing.T) {
		if _, err := ParseDeleteResourceOptions("", "-1", ""); err == nil {
			t.Fatal("expected error")
		}
	})
}

func TestDeleteOptionsFrom(t *testing.T) {
	opts := deleteOptionsFrom(DeleteResourceOptions{
		Propagation: string(metav1.DeletePropagationOrphan),
		Force:       true,
	})
	if opts.PropagationPolicy == nil || *opts.PropagationPolicy != metav1.DeletePropagationOrphan {
		t.Fatalf("policy = %v", opts.PropagationPolicy)
	}
	if opts.GracePeriodSeconds == nil || *opts.GracePeriodSeconds != 0 {
		t.Fatalf("grace = %v", opts.GracePeriodSeconds)
	}
}
