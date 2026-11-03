package services

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/util/jsonpath"
)

// crdPrinterColumn is a compiled CRD additionalPrinterColumn.
type crdPrinterColumn struct {
	Key      string
	Label    string
	Priority int32
	jp       *jsonpath.JSONPath
}

func loadCRDPrinterColumns(ctx context.Context, dynClient dynamic.Interface, group, version, plural string) ([]crdPrinterColumn, error) {
	if plural == "" || version == "" {
		return nil, nil
	}
	crdName := plural
	if group != "" {
		crdName = plural + "." + group
	}
	obj, err := dynClient.Resource(crdGVR).Get(ctx, crdName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	return parseCRDPrinterColumns(obj.Object, version), nil
}

func parseCRDPrinterColumns(obj map[string]interface{}, version string) []crdPrinterColumn {
	spec, _ := obj["spec"].(map[string]interface{})
	vs, _ := spec["versions"].([]interface{})
	var rawCols []interface{}
	for _, v := range vs {
		vm, ok := v.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := vm["name"].(string)
		if name != version {
			continue
		}
		rawCols, _ = vm["additionalPrinterColumns"].([]interface{})
		break
	}
	if len(rawCols) == 0 {
		return nil
	}

	out := make([]crdPrinterColumn, 0, len(rawCols))
	used := map[string]int{}
	for _, raw := range rawCols {
		cm, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := cm["name"].(string)
		path, _ := cm["jsonPath"].(string)
		if name == "" || path == "" {
			continue
		}
		if isBuiltinCRDColumn(name) {
			continue
		}
		key := name
		if n := used[key]; n > 0 {
			key = fmt.Sprintf("%s_%d", name, n+1)
		}
		used[name]++

		jp := jsonpath.New("col-" + key)
		jp.AllowMissingKeys(true)
		if err := jp.Parse("{" + path + "}"); err != nil {
			continue
		}
		var priority int32
		switch p := cm["priority"].(type) {
		case int64:
			priority = int32(p)
		case float64:
			priority = int32(p)
		case int:
			priority = int32(p)
		}
		out = append(out, crdPrinterColumn{
			Key:      key,
			Label:    name,
			Priority: priority,
			jp:       jp,
		})
	}
	return out
}

func isBuiltinCRDColumn(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "name", "age", "namespace":
		return true
	default:
		return false
	}
}

func evaluatePrinterColumns(obj map[string]interface{}, cols []crdPrinterColumn) map[string]string {
	fields := make(map[string]string, len(cols))
	for _, col := range cols {
		fields[col.Key] = evalJSONPath(col.jp, obj)
	}
	return fields
}

func evalJSONPath(jp *jsonpath.JSONPath, obj map[string]interface{}) string {
	if jp == nil {
		return ""
	}
	var buf bytes.Buffer
	if err := jp.Execute(&buf, obj); err != nil {
		return ""
	}
	return strings.TrimSpace(buf.String())
}

func resourceColumnsFromPrinter(cols []crdPrinterColumn) []ResourceColumn {
	out := make([]ResourceColumn, len(cols))
	for i, c := range cols {
		out[i] = ResourceColumn{Key: c.Key, Label: c.Label, Priority: c.Priority}
	}
	return out
}
