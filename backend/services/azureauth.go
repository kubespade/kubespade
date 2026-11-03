package services

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// AzureServicePrincipal holds the fields we need from an Azure SP JSON credential file
// (produced by: az ad sp create-for-rbac --json-auth).
type AzureServicePrincipal struct {
	ClientID       string `json:"clientId"`
	ClientSecret   string `json:"clientSecret"`
	SubscriptionID string `json:"subscriptionId"`
	TenantID       string `json:"tenantId"`
}

// AKSCluster holds metadata for a single AKS cluster.
type AKSCluster struct {
	Name          string `json:"name"`
	Location      string `json:"location"`
	ResourceGroup string `json:"resourceGroup"`
	Endpoint      string `json:"endpoint"` // FQDN or server URL
	Status        string `json:"status"`
	CAData        []byte `json:"-"`
	Token         string `json:"-"` // kubeconfig bearer token (may be empty)
	CertData      []byte `json:"-"` // kubeconfig client-certificate-data
	KeyData       []byte `json:"-"` // kubeconfig client-key-data
	StaticAuth    bool   `json:"-"` // true if Token or client cert came from kubeconfig
}

// ParseAzureServicePrincipal validates and parses an Azure SP JSON credential.
func ParseAzureServicePrincipal(jsonData string) (*AzureServicePrincipal, error) {
	var sp AzureServicePrincipal
	if err := json.Unmarshal([]byte(jsonData), &sp); err != nil {
		return nil, fmt.Errorf("invalid Azure SP JSON: %w", err)
	}
	if sp.ClientID == "" || sp.ClientSecret == "" || sp.TenantID == "" || sp.SubscriptionID == "" {
		return nil, fmt.Errorf("azure SP JSON must contain clientId, clientSecret, tenantId, subscriptionId")
	}
	return &sp, nil
}

// getAzureToken obtains an OAuth2 access token using client_credentials flow.
func getAzureToken(ctx context.Context, sp *AzureServicePrincipal, scope string) (token string, expiry time.Time, err error) {
	tokenURL := fmt.Sprintf(
		"https://login.microsoftonline.com/%s/oauth2/v2.0/token",
		url.PathEscape(sp.TenantID),
	)

	resp, err := http.PostForm(tokenURL, url.Values{
		"client_id":     {sp.ClientID},
		"client_secret": {sp.ClientSecret},
		"scope":         {scope},
		"grant_type":    {"client_credentials"},
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("azure token request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var tr oauthTokenResponse
	if err := json.Unmarshal(body, &tr); err != nil {
		return "", time.Time{}, fmt.Errorf("parse Azure token response: %w", err)
	}
	if tr.Error != "" {
		return "", time.Time{}, fmt.Errorf("azure auth error: %s: %s", tr.Error, tr.ErrorDesc)
	}
	if tr.AccessToken == "" {
		return "", time.Time{}, fmt.Errorf("azure token response missing access_token (%d): %s", resp.StatusCode, body)
	}

	return tr.AccessToken, time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second), nil
}

// GetAzureARMToken returns an ARM management token (used to list clusters and fetch credentials).
func GetAzureARMToken(ctx context.Context, spJSON string) (token string, expiry time.Time, err error) {
	sp, err := ParseAzureServicePrincipal(spJSON)
	if err != nil {
		return "", time.Time{}, err
	}
	return getAzureToken(ctx, sp, "https://management.azure.com/.default")
}

// GetAzureK8sToken returns a token scoped for the AKS Kubernetes API server (AAD clusters).
// The AKS server application ID is a fixed global GUID for public Azure.
func GetAzureK8sToken(ctx context.Context, spJSON string) (token string, expiry time.Time, err error) {
	sp, err := ParseAzureServicePrincipal(spJSON)
	if err != nil {
		return "", time.Time{}, err
	}
	return getAzureToken(ctx, sp, "6dae42f8-4368-4678-94ff-3960e28e3630/.default")
}

// ListAKSClusters lists all AKS clusters in the subscription.
func ListAKSClusters(ctx context.Context, spJSON string) ([]AKSCluster, error) {
	sp, err := ParseAzureServicePrincipal(spJSON)
	if err != nil {
		return nil, err
	}

	token, _, err := getAzureToken(ctx, sp, "https://management.azure.com/.default")
	if err != nil {
		return nil, err
	}

	apiURL := fmt.Sprintf(
		"https://management.azure.com/subscriptions/%s/providers/Microsoft.ContainerService/managedClusters?api-version=2024-09-01",
		url.PathEscape(sp.SubscriptionID),
	)

	var listResp struct {
		Value []struct {
			ID         string `json:"id"`
			Name       string `json:"name"`
			Location   string `json:"location"`
			Properties struct {
				ProvisioningState string `json:"provisioningState"`
				PowerState        struct {
					Code string `json:"code"`
				} `json:"powerState"`
				FQDN string `json:"fqdn"`
			} `json:"properties"`
		} `json:"value"`
	}
	if err := doJSONGet(ctx, apiURL, token, &listResp); err != nil {
		return nil, fmt.Errorf("AKS list: %w", err)
	}

	clusters := make([]AKSCluster, 0, len(listResp.Value))
	for _, c := range listResp.Value {
		status := c.Properties.ProvisioningState
		if c.Properties.PowerState.Code != "" {
			status = c.Properties.PowerState.Code
		}
		clusters = append(clusters, AKSCluster{
			Name:          c.Name,
			Location:      c.Location,
			ResourceGroup: extractResourceGroup(c.ID),
			Endpoint:      c.Properties.FQDN,
			Status:        status,
		})
	}
	return clusters, nil
}

// extractResourceGroup parses the resource group name from an ARM resource ID.
// Format: /subscriptions/{sub}/resourcegroups/{rg}/providers/...
func extractResourceGroup(resourceID string) string {
	parts := strings.Split(resourceID, "/")
	for i, p := range parts {
		if strings.EqualFold(p, "resourceGroups") && i+1 < len(parts) {
			return parts[i+1]
		}
	}
	return ""
}

// ResolveAKSResourceGroup returns hint, or looks up the cluster in the subscription
// (same list as Azure Portal / az aks list).
func ResolveAKSResourceGroup(ctx context.Context, spJSON, clusterName, hint string) (string, error) {
	if hint != "" {
		return hint, nil
	}
	clusters, err := ListAKSClusters(ctx, spJSON)
	if err != nil {
		return "", err
	}
	var matches []AKSCluster
	for _, c := range clusters {
		if c.Name == clusterName && c.ResourceGroup != "" {
			matches = append(matches, c)
		}
	}
	if len(matches) == 1 {
		return matches[0].ResourceGroup, nil
	}
	if len(matches) > 1 {
		return "", fmt.Errorf("multiple AKS clusters named %q — pick one from the list", clusterName)
	}
	return "", fmt.Errorf("AKS cluster %q not found in this subscription", clusterName)
}

// DescribeAKSCluster fetches cluster credentials via listClusterUserCredential
// and returns the server URL, CA cert, and optional static bearer token.
func DescribeAKSCluster(ctx context.Context, spJSON, resourceGroup, clusterName string) (*AKSCluster, error) {
	sp, err := ParseAzureServicePrincipal(spJSON)
	if err != nil {
		return nil, err
	}

	token, _, err := getAzureToken(ctx, sp, "https://management.azure.com/.default")
	if err != nil {
		return nil, err
	}

	apiURL := fmt.Sprintf(
		"https://management.azure.com/subscriptions/%s/resourceGroups/%s/providers/Microsoft.ContainerService/managedClusters/%s/listClusterUserCredential?api-version=2024-09-01",
		url.PathEscape(sp.SubscriptionID),
		url.PathEscape(resourceGroup),
		url.PathEscape(clusterName),
	)

	var credResp struct {
		Kubeconfigs []struct {
			Name  string `json:"name"`
			Value string `json:"value"`
		} `json:"kubeconfigs"`
	}
	if err := doJSONPost(ctx, apiURL, token, "", &credResp); err != nil {
		return nil, fmt.Errorf("listClusterUserCredential: %w", err)
	}
	if len(credResp.Kubeconfigs) == 0 {
		return nil, fmt.Errorf("no kubeconfigs returned for cluster %s", clusterName)
	}

	kubeconfigBytes, err := base64.StdEncoding.DecodeString(credResp.Kubeconfigs[0].Value)
	if err != nil {
		return nil, fmt.Errorf("decode kubeconfig: %w", err)
	}

	parsed, err := parseAKSUserKubeconfig(kubeconfigBytes)
	if err != nil {
		return nil, fmt.Errorf("parse kubeconfig: %w", err)
	}

	return &AKSCluster{
		Name:          clusterName,
		Location:      aksManagedClusterLocation(ctx, token, sp.SubscriptionID, resourceGroup, clusterName),
		ResourceGroup: resourceGroup,
		Endpoint:      parsed.server,
		CAData:        parsed.caData,
		Token:         parsed.token,
		CertData:      parsed.certData,
		KeyData:       parsed.keyData,
		StaticAuth:    parsed.staticAuth,
	}, nil
}

func aksManagedClusterLocation(ctx context.Context, token, subscriptionID, resourceGroup, clusterName string) string {
	apiURL := fmt.Sprintf(
		"https://management.azure.com/subscriptions/%s/resourceGroups/%s/providers/Microsoft.ContainerService/managedClusters/%s?api-version=2024-09-01",
		url.PathEscape(subscriptionID),
		url.PathEscape(resourceGroup),
		url.PathEscape(clusterName),
	)
	var doc struct {
		Location string `json:"location"`
	}
	if doJSONGet(ctx, apiURL, token, &doc) != nil {
		return ""
	}
	return doc.Location
}

type aksUserKubeconfig struct {
	server     string
	caData     []byte
	token      string
	certData   []byte
	keyData    []byte
	staticAuth bool
}

// parseAKSUserKubeconfig reads the kubeconfig Azure returns from
// listClusterUserCredential (same document `az aks get-credentials` writes).
// Local-account clusters use client certs or a bearer token. Entra-integrated
// clusters use exec/kubelogin — we do not run the plugin; the caller mints an
// AAD token for the AKS server app instead.
func parseAKSUserKubeconfig(data []byte) (*aksUserKubeconfig, error) {
	cfg, err := clientcmd.Load(data)
	if err != nil {
		return nil, err
	}
	ctxName := cfg.CurrentContext
	if ctxName == "" {
		for name := range cfg.Contexts {
			ctxName = name
			break
		}
	}
	if ctxName == "" {
		return nil, fmt.Errorf("kubeconfig has no context")
	}
	ctx, ok := cfg.Contexts[ctxName]
	if !ok || ctx == nil {
		return nil, fmt.Errorf("context %q not found", ctxName)
	}
	cluster, ok := cfg.Clusters[ctx.Cluster]
	if !ok || cluster == nil {
		return nil, fmt.Errorf("cluster %q not found", ctx.Cluster)
	}
	if cluster.Server == "" {
		return nil, fmt.Errorf("server not found in kubeconfig")
	}
	auth, ok := cfg.AuthInfos[ctx.AuthInfo]
	if !ok || auth == nil {
		auth = &clientcmdapi.AuthInfo{}
	}
	hasCert := len(auth.ClientCertificateData) > 0 && len(auth.ClientKeyData) > 0
	return &aksUserKubeconfig{
		server:     cluster.Server,
		caData:     cluster.CertificateAuthorityData,
		token:      auth.Token,
		certData:   auth.ClientCertificateData,
		keyData:    auth.ClientKeyData,
		staticAuth: hasCert || auth.Token != "",
	}, nil
}
