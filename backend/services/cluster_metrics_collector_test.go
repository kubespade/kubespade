package services

import (
	"context"
	"strconv"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestNormalizeRetention(t *testing.T) {
	if NormalizeRetention(7) != 7 {
		t.Fatal("7")
	}
	if NormalizeRetention(99) != CMCDefaultRetention {
		t.Fatalf("invalid → default %d", CMCDefaultRetention)
	}
}

func TestBuildCollectorObjectsEmptyDir(t *testing.T) {
	ns, sa, cr, crb, cm, pvc, dep, svc := buildCollectorObjects(14, "")
	if ns.Name != CMCNamespace || sa.Name != CMCName {
		t.Fatalf("ns/sa names: %s / %s", ns.Name, sa.Name)
	}
	if pvc != nil {
		t.Fatal("empty storageClass → no PVC")
	}
	if dep.Annotations[CMCAnnStorage] != "emptyDir" {
		t.Fatalf("storage ann = %q", dep.Annotations[CMCAnnStorage])
	}
	if dep.Annotations[CMCAnnRetentionDays] != "14" {
		t.Fatalf("retention ann = %q", dep.Annotations[CMCAnnRetentionDays])
	}
	if dep.Annotations[CMCManifestVersionAnn] != strconv.Itoa(CMCManifestVersion) {
		t.Fatal("manifest version annotation missing")
	}
	if cm.Data["collector.py"] == "" {
		t.Fatal("expected collector script in ConfigMap")
	}
	if cr.Name == "" || crb.Name == "" || svc.Name != CMCName {
		t.Fatal("rbac/service incomplete")
	}
	foundEmpty := false
	for _, v := range dep.Spec.Template.Spec.Volumes {
		if v.Name == "data" && v.EmptyDir != nil {
			foundEmpty = true
		}
	}
	if !foundEmpty {
		t.Fatal("expected emptyDir data volume")
	}
}

func TestBuildCollectorObjectsPVC(t *testing.T) {
	_, _, _, _, _, pvc, dep, _ := buildCollectorObjects(30, "gp3")
	if pvc == nil || pvc.Spec.StorageClassName == nil || *pvc.Spec.StorageClassName != "gp3" {
		t.Fatalf("pvc = %#v", pvc)
	}
	if dep.Annotations[CMCAnnStorage] != "pvc:gp3" {
		t.Fatalf("storage ann = %q", dep.Annotations[CMCAnnStorage])
	}
	foundPVC := false
	for _, v := range dep.Spec.Template.Spec.Volumes {
		if v.PersistentVolumeClaim != nil && v.PersistentVolumeClaim.ClaimName == CMCName+"-data" {
			foundPVC = true
		}
	}
	if !foundPVC {
		t.Fatal("expected PVC data volume")
	}
}

func TestCollectorTeardownStatus(t *testing.T) {
	ctx := context.Background()

	t.Run("missing namespace → nil", func(t *testing.T) {
		client := fake.NewSimpleClientset()
		if st := collectorTeardownStatus(ctx, client); st != nil {
			t.Fatalf("got %+v", st)
		}
	})

	t.Run("terminating namespace → pending", func(t *testing.T) {
		now := metav1.NewTime(time.Now())
		client := fake.NewSimpleClientset(&corev1.Namespace{
			ObjectMeta: metav1.ObjectMeta{
				Name:              CMCNamespace,
				DeletionTimestamp: &now,
			},
			Status: corev1.NamespaceStatus{Phase: corev1.NamespaceTerminating},
		})
		st := collectorTeardownStatus(ctx, client)
		if st == nil || st.State != "pending" {
			t.Fatalf("got %+v", st)
		}
	})

	t.Run("remaining collector pod → pending", func(t *testing.T) {
		client := fake.NewSimpleClientset(
			&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: CMCNamespace}},
			&corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name:      "cmc-pod",
					Namespace: CMCNamespace,
					Labels:    map[string]string{"app": CMCAppLabel},
				},
			},
		)
		st := collectorTeardownStatus(ctx, client)
		if st == nil || st.State != "pending" {
			t.Fatalf("got %+v", st)
		}
	})

	t.Run("clean namespace no pods → nil", func(t *testing.T) {
		client := fake.NewSimpleClientset(
			&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: CMCNamespace}},
		)
		if st := collectorTeardownStatus(ctx, client); st != nil {
			t.Fatalf("got %+v", st)
		}
	})
}
