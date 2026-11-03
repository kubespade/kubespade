package services

import "testing"

// TestRegistryDerivation guards the maps derived from resourceRegistry in init():
// their contents must stay consistent with the registry so a future kind added in
// one place can't silently drift from the others.
func TestRegistryDerivation(t *testing.T) {
	wantClusterScoped := 0
	for _, rk := range resourceRegistry {
		if kindToGVR[rk.Plural] != rk.GVR {
			t.Errorf("kindToGVR[%q] mismatch", rk.Plural)
		}
		if kindNameToResource[rk.Kind] != rk.Plural {
			t.Errorf("kindNameToResource[%q] = %q, want %q", rk.Kind, kindNameToResource[rk.Kind], rk.Plural)
		}
		if rk.Plural != "events" && kindSingular[rk.Plural] != rk.Kind {
			t.Errorf("kindSingular[%q] = %q, want %q", rk.Plural, kindSingular[rk.Plural], rk.Kind)
		}
		if rk.ClusterScoped {
			wantClusterScoped++
			if !clusterScopedKinds[rk.Plural] {
				t.Errorf("%q should be cluster-scoped", rk.Plural)
			}
		} else if clusterScopedKinds[rk.Plural] {
			t.Errorf("%q should be namespaced", rk.Plural)
		}
	}

	if len(kindToGVR) != len(resourceRegistry) {
		t.Errorf("kindToGVR = %d, want %d", len(kindToGVR), len(resourceRegistry))
	}
	if len(kindNameToResource) != len(resourceRegistry) {
		t.Errorf("kindNameToResource = %d, want %d", len(kindNameToResource), len(resourceRegistry))
	}
	if len(clusterScopedKinds) != wantClusterScoped {
		t.Errorf("clusterScopedKinds = %d, want %d", len(clusterScopedKinds), wantClusterScoped)
	}
	// events is intentionally excluded from kindSingular (preserved behaviour).
	if _, ok := kindSingular["events"]; ok {
		t.Errorf("kindSingular must not contain events")
	}
	if len(kindSingular) != len(resourceRegistry)-1 {
		t.Errorf("kindSingular = %d, want %d", len(kindSingular), len(resourceRegistry)-1)
	}
}
