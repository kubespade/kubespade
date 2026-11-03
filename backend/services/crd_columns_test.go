package services

import (
	"testing"
)

func TestParseCRDPrinterColumns_OrderLike(t *testing.T) {
	crd := map[string]interface{}{
		"spec": map[string]interface{}{
			"group": "acme.cert-manager.io",
			"versions": []interface{}{
				map[string]interface{}{
					"name": "v1",
					"additionalPrinterColumns": []interface{}{
						map[string]interface{}{
							"name":     "State",
							"type":     "string",
							"jsonPath": ".status.state",
						},
						map[string]interface{}{
							"name":     "Issuer",
							"type":     "string",
							"jsonPath": ".spec.issuerRef.name",
							"priority": float64(1),
						},
						map[string]interface{}{
							"name":     "Age",
							"type":     "date",
							"jsonPath": ".metadata.creationTimestamp",
						},
						map[string]interface{}{
							"name":     "Name",
							"jsonPath": ".metadata.name",
						},
					},
				},
			},
		},
	}

	cols := parseCRDPrinterColumns(crd, "v1")
	if len(cols) != 2 {
		t.Fatalf("want State+Issuer (Age/Name skipped), got %d: %+v", len(cols), cols)
	}
	if cols[0].Key != "State" || cols[0].Priority != 0 {
		t.Fatalf("State col = %+v", cols[0])
	}
	if cols[1].Key != "Issuer" || cols[1].Priority != 1 {
		t.Fatalf("Issuer col = %+v", cols[1])
	}

	obj := map[string]interface{}{
		"metadata": map[string]interface{}{"name": "order-1"},
		"spec": map[string]interface{}{
			"issuerRef": map[string]interface{}{"name": "letsencrypt"},
		},
		"status": map[string]interface{}{"state": "valid"},
	}
	fields := evaluatePrinterColumns(obj, cols)
	if fields["State"] != "valid" {
		t.Fatalf("State = %q", fields["State"])
	}
	if fields["Issuer"] != "letsencrypt" {
		t.Fatalf("Issuer = %q", fields["Issuer"])
	}
}

func TestParseCRDPrinterColumns_WrongVersion(t *testing.T) {
	crd := map[string]interface{}{
		"spec": map[string]interface{}{
			"versions": []interface{}{
				map[string]interface{}{
					"name": "v1beta1",
					"additionalPrinterColumns": []interface{}{
						map[string]interface{}{"name": "State", "jsonPath": ".status.state"},
					},
				},
			},
		},
	}
	if cols := parseCRDPrinterColumns(crd, "v1"); len(cols) != 0 {
		t.Fatalf("expected empty for unmatched version, got %+v", cols)
	}
}

func TestExtractCRDStatusFields_PhaseFallback(t *testing.T) {
	obj := map[string]interface{}{
		"status": map[string]interface{}{"phase": "Ready"},
	}
	f := extractCRDStatusFields(obj)
	if f["status"] != "Ready" {
		t.Fatalf("got %#v", f)
	}
}
