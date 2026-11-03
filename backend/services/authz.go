package services

import (
	"context"
	"sync"

	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"
)

// AccessCheck is a single SelfSubjectAccessReview query.
type AccessCheck struct {
	ID          string `json:"id"`
	Verb        string `json:"verb"`
	Kind        string `json:"kind"`
	Namespace   string `json:"namespace,omitempty"`
	Name        string `json:"name,omitempty"`
	Subresource string `json:"subresource,omitempty"`
}

func CheckAccess(ctx context.Context, k8sCfg *rest.Config, checks []AccessCheck) (map[string]bool, error) {
	client, err := clientset(k8sCfg)
	if err != nil {
		return nil, err
	}

	type result struct {
		id    string
		allow bool
	}

	ch := make(chan result, len(checks))
	var wg sync.WaitGroup

	for _, c := range checks {
		gvr, ok := kindToGVR[c.Kind]
		if !ok {
			ch <- result{id: c.ID, allow: false}
			continue
		}
		ns := c.Namespace
		if clusterScopedKinds[c.Kind] {
			ns = ""
		}
		wg.Add(1)
		go func(c AccessCheck, ns string) {
			defer wg.Done()
			review := &authorizationv1.SelfSubjectAccessReview{
				Spec: authorizationv1.SelfSubjectAccessReviewSpec{
					ResourceAttributes: &authorizationv1.ResourceAttributes{
						Namespace:   ns,
						Verb:        c.Verb,
						Group:       gvr.Group,
						Resource:    gvr.Resource,
						Subresource: c.Subresource,
						Name:        c.Name,
					},
				},
			}
			r, err := client.AuthorizationV1().SelfSubjectAccessReviews().Create(ctx, review, metav1.CreateOptions{})
			allow := err == nil && r.Status.Allowed
			ch <- result{id: c.ID, allow: allow}
		}(c, ns)
	}

	wg.Wait()
	close(ch)

	results := make(map[string]bool, len(checks))
	for r := range ch {
		results[r.id] = r.allow
	}
	return results, nil
}
