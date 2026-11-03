package services

import (
	"context"
	"fmt"

	certificatesv1 "k8s.io/api/certificates/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

// ApproveOrDenyCSR sets Approved or Denied on the CSR via the /approval subresource
// (same as kubectl certificate approve / deny).
func ApproveOrDenyCSR(ctx context.Context, k8sCfg *rest.Config, name string, approve bool) error {
	client, err := clientset(k8sCfg)
	if err != nil {
		return err
	}
	csr, err := client.CertificatesV1().CertificateSigningRequests().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return err
	}

	for _, c := range csr.Status.Conditions {
		switch c.Type {
		case certificatesv1.CertificateApproved:
			return fmt.Errorf("CSR %q is already approved", name)
		case certificatesv1.CertificateDenied:
			return fmt.Errorf("CSR %q is already denied", name)
		case certificatesv1.CertificateFailed:
			return fmt.Errorf("CSR %q has already failed", name)
		}
	}

	now := metav1.Now()
	cond := certificatesv1.CertificateSigningRequestCondition{
		Status:             corev1.ConditionTrue,
		Reason:             "K8sFlashlight",
		LastUpdateTime:     now,
		LastTransitionTime: now,
	}
	if approve {
		cond.Type = certificatesv1.CertificateApproved
		cond.Message = "Approved via KubeSpade"
	} else {
		cond.Type = certificatesv1.CertificateDenied
		cond.Message = "Denied via KubeSpade"
	}
	csr.Status.Conditions = append(csr.Status.Conditions, cond)

	_, err = client.CertificatesV1().CertificateSigningRequests().UpdateApproval(ctx, name, csr, metav1.UpdateOptions{})
	return err
}
