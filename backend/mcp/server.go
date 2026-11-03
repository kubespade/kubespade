package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"k8s-client/services"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Run starts the KubeSpade MCP stdio server (JSON-RPC over stdin/stdout).
// Logs must go to stderr only.
func Run() error {
	dec := json.NewDecoder(bufio.NewReader(os.Stdin))
	enc := json.NewEncoder(os.Stdout)
	for {
		var msg map[string]json.RawMessage
		if err := dec.Decode(&msg); err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		var method string
		_ = json.Unmarshal(msg["method"], &method)
		var id json.RawMessage
		if raw, ok := msg["id"]; ok {
			id = raw
		}
		// Notifications have no id — ignore responses for them.
		if id == nil && method != "" {
			continue
		}
		if method == "" {
			continue
		}
		result, err := handle(method, msg["params"])
		if id == nil {
			continue
		}
		if err != nil {
			_ = enc.Encode(map[string]any{
				"jsonrpc": "2.0",
				"id":      rawID(id),
				"error": map[string]any{
					"code":    -32000,
					"message": err.Error(),
				},
			})
			continue
		}
		_ = enc.Encode(map[string]any{
			"jsonrpc": "2.0",
			"id":      rawID(id),
			"result":  result,
		})
	}
}

func rawID(id json.RawMessage) any {
	var v any
	if err := json.Unmarshal(id, &v); err != nil {
		return nil
	}
	return v
}

func handle(method string, params json.RawMessage) (any, error) {
	switch method {
	case "initialize":
		return map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "kubespade",
				"version": "1.0.0",
			},
			"instructions": "You are inside KubeSpade. Use kubespade_* cluster tools for Kubernetes. Writes require in-app user approval.",
		}, nil
	case "tools/list":
		return map[string]any{"tools": toolDefs()}, nil
	case "tools/call":
		var p struct {
			Name      string         `json:"name"`
			Arguments map[string]any `json:"arguments"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if p.Arguments == nil {
			p.Arguments = map[string]any{}
		}
		text, isErr := callTool(p.Name, p.Arguments)
		return map[string]any{
			"content": []map[string]any{{"type": "text", "text": text}},
			"isError": isErr,
		}, nil
	case "ping":
		return map[string]any{}, nil
	default:
		return nil, fmt.Errorf("method not found: %s", method)
	}
}

func toolDefs() []map[string]any {
	ctxProp := map[string]any{
		"type":        "string",
		"description": "Cluster context name from kubespade_list_clusters",
	}
	return []map[string]any{
		{
			"name":        "kubespade_list_clusters",
			"description": "List Kubernetes clusters currently connected in the KubeSpade app.",
			"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}},
		},
		{
			"name":        "kubespade_get",
			"description": "Read cluster resources (like kubectl get). Prefer this for listing pods, deployments, etc.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"context":       ctxProp,
					"resource":      map[string]any{"type": "string", "description": "e.g. pods, deployments, nodes"},
					"namespace":     map[string]any{"type": "string"},
					"name":          map[string]any{"type": "string"},
					"extraArgs":     map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Optional; e.g. field-selector type=Warning"},
					"fieldSelector": map[string]any{"type": "string", "description": "e.g. type=Warning for events"},
				},
				"required": []string{"context", "resource"},
			},
		},
		{
			"name":        "kubespade_describe",
			"description": "Describe a cluster resource (like kubectl describe).",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"context":   ctxProp,
					"resource":  map[string]any{"type": "string"},
					"name":      map[string]any{"type": "string"},
					"namespace": map[string]any{"type": "string"},
				},
				"required": []string{"context", "resource", "name"},
			},
		},
		{
			"name":        "kubespade_logs",
			"description": "Read pod logs from a connected cluster.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"context":   ctxProp,
					"namespace": map[string]any{"type": "string"},
					"pod":       map[string]any{"type": "string"},
					"container": map[string]any{"type": "string"},
					"tail":      map[string]any{"type": "integer"},
				},
				"required": []string{"context", "namespace", "pod"},
			},
		},
		{
			"name":        "kubespade_apply",
			"description": "Apply a YAML manifest. KubeSpade asks the user to Approve before running.",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"context":   ctxProp,
					"manifest":  map[string]any{"type": "string", "description": "Full YAML to apply"},
					"namespace": map[string]any{"type": "string"},
					"summary":   map[string]any{"type": "string", "description": "Short human summary of the change"},
				},
				"required": []string{"context", "manifest", "summary"},
			},
		},
		{
			"name":        "kubespade_delete",
			"description": "Delete one or more cluster resources in a single call. Prefer `items` so the user Approves the whole batch once (do not call this tool once per object).",
			"inputSchema": map[string]any{
				"type": "object",
				"properties": map[string]any{
					"context": ctxProp,
					"summary": map[string]any{"type": "string", "description": "Short human summary of the deletion"},
					"items": map[string]any{
						"type":        "array",
						"description": "Resources to delete together (one Approve). Each entry: resource, name, optional namespace.",
						"items": map[string]any{
							"type": "object",
							"properties": map[string]any{
								"resource":  map[string]any{"type": "string"},
								"name":      map[string]any{"type": "string"},
								"namespace": map[string]any{"type": "string"},
							},
							"required": []string{"resource", "name"},
						},
					},
					"resource":  map[string]any{"type": "string", "description": "Kind for a single delete (or use items)"},
					"name":      map[string]any{"type": "string"},
					"namespace": map[string]any{"type": "string"},
				},
				"required": []string{"context", "summary"},
			},
		},
	}
}

func callTool(name string, args map[string]any) (string, bool) {
	switch name {
	case "kubespade_list_clusters":
		return listClusters()
	case "kubespade_get":
		return toolGet(args)
	case "kubespade_describe":
		return toolDescribe(args)
	case "kubespade_logs":
		return toolLogs(args)
	case "kubespade_apply":
		return toolApply(args)
	case "kubespade_delete":
		return toolDelete(args)
	default:
		return fmt.Sprintf("unknown tool: %s", name), true
	}
}

func strArg(args map[string]any, key string) string {
	v, _ := args[key].(string)
	return strings.TrimSpace(v)
}

func extraArgStrings(args map[string]any) []string {
	raw, ok := args["extraArgs"].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, e := range raw {
		if s, ok := e.(string); ok && strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

func normalizeResource(res string) string {
	r := strings.ToLower(strings.TrimSpace(res))
	switch r {
	case "po", "pod":
		return "pods"
	case "deploy", "deployment":
		return "deployments"
	case "svc", "service":
		return "services"
	case "no", "node":
		return "nodes"
	case "ns", "namespace":
		return "namespaces"
	case "ev", "event":
		return "events"
	case "cm", "configmap":
		return "configmaps"
	case "ing", "ingress":
		return "ingresses"
	case "ds", "daemonset":
		return "daemonsets"
	case "sts", "statefulset":
		return "statefulsets"
	case "job":
		return "jobs"
	case "cj", "cronjob":
		return "cronjobs"
	default:
		return r
	}
}

func wantsWarningOnly(args map[string]any) bool {
	if strings.Contains(strArg(args, "fieldSelector"), "type=Warning") {
		return true
	}
	for _, s := range extraArgStrings(args) {
		if strings.Contains(s, "type=Warning") {
			return true
		}
	}
	return false
}

func restConfigForContext(contextName string) (*rest.Config, error) {
	kc := services.AIKubeconfigPath()
	if !fileExists(kc) {
		return nil, fmt.Errorf("cluster credentials are not available — close and reopen the AI panel")
	}
	loading := &clientcmd.ClientConfigLoadingRules{ExplicitPath: kc}
	overrides := &clientcmd.ConfigOverrides{}
	if contextName != "" {
		overrides.CurrentContext = contextName
	}
	return clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loading, overrides).ClientConfig()
}

func jsonOut(v any, err error) (string, bool) {
	if err != nil {
		return err.Error(), true
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err.Error(), true
	}
	return string(b), false
}

func listClusters() (string, bool) {
	path := filepath.Join(services.AIWorkspaceDir(), "clusters.json")
	b, err := os.ReadFile(path)
	if err != nil {
		fallback := filepath.Join(cwdOrDot(), "clusters.json")
		b, err = os.ReadFile(fallback)
	}
	if err != nil {
		return "No clusters.json in workspace (no clusters connected or workspace incomplete).", false
	}
	return string(b), false
}

func cwdOrDot() string {
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	return wd
}

func toolGet(args map[string]any) (string, bool) {
	ctxName := strArg(args, "context")
	res := normalizeResource(strArg(args, "resource"))
	if ctxName == "" || res == "" {
		return "context and resource are required", true
	}
	cfg, err := restConfigForContext(ctxName)
	if err != nil {
		return err.Error(), true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	ns := strArg(args, "namespace")
	name := strArg(args, "name")
	if name != "" {
		return jsonOut(services.GetResourceDetail(ctx, cfg, res, ns, name))
	}
	list, err := services.ListResources(ctx, cfg, res, ns)
	if err != nil {
		return err.Error(), true
	}
	if list != nil && wantsWarningOnly(args) {
		filtered := list.Items[:0]
		for _, item := range list.Items {
			if strings.EqualFold(item.Fields["type"], "Warning") {
				filtered = append(filtered, item)
			}
		}
		list.Items = filtered
	}
	const capN = 300
	if list != nil && len(list.Items) > capN {
		list.Items = list.Items[:capN]
	}
	return jsonOut(list, nil)
}

func toolDescribe(args map[string]any) (string, bool) {
	ctxName := strArg(args, "context")
	res := normalizeResource(strArg(args, "resource"))
	name := strArg(args, "name")
	if ctxName == "" || res == "" || name == "" {
		return "context, resource, and name are required", true
	}
	cfg, err := restConfigForContext(ctxName)
	if err != nil {
		return err.Error(), true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	return jsonOut(services.GetResourceDetail(ctx, cfg, res, strArg(args, "namespace"), name))
}

func toolLogs(args map[string]any) (string, bool) {
	ctxName := strArg(args, "context")
	ns := strArg(args, "namespace")
	pod := strArg(args, "pod")
	if ctxName == "" || ns == "" || pod == "" {
		return "context, namespace, and pod are required", true
	}
	cfg, err := restConfigForContext(ctxName)
	if err != nil {
		return err.Error(), true
	}
	tail := 200
	if v, ok := args["tail"].(float64); ok && v > 0 {
		tail = int(v)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var b strings.Builder
	err = services.StreamPodLogs(ctx, cfg, ns, pod, strArg(args, "container"), int64(tail), false, false, func(line string) bool {
		b.WriteString(line)
		b.WriteByte('\n')
		return true
	})
	if err != nil {
		return err.Error(), true
	}
	text := strings.TrimSpace(b.String())
	if text == "" {
		return "(ok, empty output)", false
	}
	return text, false
}

func toolApply(args map[string]any) (string, bool) {
	ctxName := strArg(args, "context")
	manifest := strArg(args, "manifest")
	summary := strArg(args, "summary")
	if ctxName == "" || manifest == "" {
		return "context and manifest are required", true
	}
	if summary == "" {
		summary = "Apply Kubernetes manifest"
	}
	detail := fmt.Sprintf("context=%s\n%s", ctxName, truncate(manifest, 4000))
	ok, msg := requestApproval("kubespade_apply", summary, detail)
	if !ok {
		return msg, true
	}
	cfg, err := restConfigForContext(ctxName)
	if err != nil {
		return err.Error(), true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	results, err := services.ApplyManifestYAML(ctx, cfg, manifest)
	return jsonOut(results, err)
}

func toolDelete(args map[string]any) (string, bool) {
	ctxName := strArg(args, "context")
	if ctxName == "" {
		return "context is required", true
	}
	targets, errMsg := parseDeleteTargets(args)
	if errMsg != "" {
		return errMsg, true
	}
	summary := strArg(args, "summary")
	if summary == "" {
		if len(targets) == 1 {
			summary = fmt.Sprintf("Delete %s/%s", targets[0].Resource, targets[0].Name)
		} else {
			summary = fmt.Sprintf("Delete %d resources", len(targets))
		}
	}
	detail := formatDeleteDetail(ctxName, targets)
	ok, msg := requestApproval("kubespade_delete", summary, detail)
	if !ok {
		return msg, true
	}
	cfg, err := restConfigForContext(ctxName)
	if err != nil {
		return err.Error(), true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	results := make([]map[string]any, 0, len(targets))
	failed := 0
	for _, t := range targets {
		row := map[string]any{"kind": t.Resource, "name": t.Name, "namespace": t.Namespace}
		if err := services.DeleteResource(ctx, cfg, t.Resource, t.Namespace, t.Name, services.DeleteResourceOptions{}); err != nil {
			row["action"] = "error"
			row["error"] = err.Error()
			failed++
		} else {
			row["action"] = "deleted"
		}
		results = append(results, row)
	}
	out, isErr := jsonOut(results, nil)
	if failed == len(targets) {
		return out, true
	}
	return out, isErr
}

const maxDeleteItems = 50

type deleteTarget struct {
	Resource  string
	Name      string
	Namespace string
}

func parseDeleteTargets(args map[string]any) ([]deleteTarget, string) {
	if raw, ok := args["items"]; ok && raw != nil {
		list, ok := raw.([]any)
		if !ok {
			return nil, "items must be an array of {resource, name, namespace?}"
		}
		if len(list) == 0 {
			return nil, "items must not be empty"
		}
		if len(list) > maxDeleteItems {
			return nil, fmt.Sprintf("at most %d items per delete (got %d); split into fewer batches", maxDeleteItems, len(list))
		}
		out := make([]deleteTarget, 0, len(list))
		for i, e := range list {
			m, ok := e.(map[string]any)
			if !ok {
				return nil, fmt.Sprintf("items[%d] must be an object", i)
			}
			res := normalizeResource(strArg(m, "resource"))
			name := strArg(m, "name")
			if res == "" || name == "" {
				return nil, fmt.Sprintf("items[%d] needs resource and name", i)
			}
			out = append(out, deleteTarget{Resource: res, Name: name, Namespace: strArg(m, "namespace")})
		}
		return out, ""
	}
	res := normalizeResource(strArg(args, "resource"))
	name := strArg(args, "name")
	if res == "" || name == "" {
		return nil, "pass items: [{resource, name, namespace?}] for a batch, or resource + name for one object"
	}
	return []deleteTarget{{Resource: res, Name: name, Namespace: strArg(args, "namespace")}}, ""
}

func formatDeleteDetail(ctxName string, targets []deleteTarget) string {
	var b strings.Builder
	n := len(targets)
	fmt.Fprintf(&b, "Delete %d resource", n)
	if n != 1 {
		b.WriteByte('s')
	}
	fmt.Fprintf(&b, " (context %s):\n", ctxName)
	for _, t := range targets {
		if t.Namespace != "" {
			fmt.Fprintf(&b, "- %s/%s  ns=%s\n", t.Resource, t.Name, t.Namespace)
		} else {
			fmt.Fprintf(&b, "- %s/%s\n", t.Resource, t.Name)
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…(truncated)"
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func requestApproval(tool, summary, detail string) (approved bool, message string) {
	base := strings.TrimRight(os.Getenv("KUBESPADE_APPROVAL_URL"), "/")
	token := os.Getenv("KUBESPADE_APPROVAL_TOKEN")
	if base == "" {
		return false, "Write blocked: KubeSpade approval URL is not configured. Reopen the AI panel from the app."
	}
	body, _ := json.Marshal(map[string]string{
		"tool":    tool,
		"summary": summary,
		"detail":  detail,
	})
	req, err := http.NewRequest(http.MethodPost, base+"/approve", strings.NewReader(string(body)))
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	res, err := client.Do(req)
	if err != nil {
		return false, "Approval request failed: " + err.Error()
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var parsed struct {
		Approved bool   `json:"approved"`
		Message  string `json:"message"`
	}
	_ = json.Unmarshal(raw, &parsed)
	if res.StatusCode >= 400 {
		msg := parsed.Message
		if msg == "" {
			msg = string(raw)
		}
		return false, msg
	}
	if !parsed.Approved {
		msg := parsed.Message
		if msg == "" {
			msg = "User denied the write operation in KubeSpade."
		}
		return false, msg
	}
	return true, ""
}
