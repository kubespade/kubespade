package session

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"k8s-client/services"
	"k8s.io/client-go/rest"
)

// ProfileSession holds connection state for one connected profile.
// Supports AWS EKS, plain kubeconfig, GCP GKE, and Azure AKS.
type ProfileSession struct {
	Meta        services.ProfileMeta
	ClusterName string
	DisplayName string // short UI label (e.g. EKS name without ARN)

	// AWS EKS fields
	awsEndpoint string
	awsCAData   []byte
	awsToken    cachedToken

	// kubeconfig field
	directCfg *rest.Config

	// GCP GKE fields
	gcpEndpoint string
	gcpCAData   []byte
	gcpSAJSON   string
	gcpToken    cachedToken

	// Azure AKS fields
	azureEndpoint   string
	azureCAData     []byte
	azureCertData   []byte
	azureKeyData    []byte
	azureSPJSON     string
	azureToken      cachedToken
	azureStaticAuth bool // true = kubeconfig token or client cert, no AAD refresh
}

// DisplayLabel returns the short UI name for the connected cluster.
func (s *ProfileSession) DisplayLabel() string {
	if s.DisplayName != "" {
		return s.DisplayName
	}
	if short := services.ShortClusterDisplayName(s.ClusterName); short != "" {
		return short
	}
	return s.ClusterName
}

// InvalidateTokens clears cached cloud bearer tokens so the next GetK8sConfig
// call re-fetches them. Used after the API returns 401/403 that may be caused
// by an expired EKS/AAD/GCP token that our wall-clock TTL missed.
func (s *ProfileSession) InvalidateTokens() {
	s.awsToken.invalidate()
	s.gcpToken.invalidate()
	if !s.azureStaticAuth {
		s.azureToken.invalidate()
	}
}

// GetK8sConfig returns a valid k8s rest.Config, refreshing tokens when needed.
func (s *ProfileSession) GetK8sConfig(ctx context.Context, mfaToken string) (*rest.Config, error) {
	switch s.Meta.Type {
	case "kubeconfig":
		return s.getKubeconfigK8sConfig()
	case "gcp":
		return s.getGCPK8sConfig(ctx)
	case "azure":
		return s.getAzureK8sConfig(ctx)
	case "aws", "":
		return s.getAWSK8sConfig(ctx, mfaToken)
	default:
		return nil, fmt.Errorf("unsupported profile type: %s", s.Meta.Type)
	}
}

func (s *ProfileSession) getKubeconfigK8sConfig() (*rest.Config, error) {
	cred, err := services.LoadCredential(s.Meta.Name)
	if err != nil {
		return nil, err
	}
	if services.UpgradeKubeconfigLiveLink(&s.Meta, &cred) {
		_ = services.SaveCredential(s.Meta.Name, cred)
		_ = services.SaveProfile(s.Meta)
	}

	// Embedded YAML (paste) — use the config frozen at connect.
	if s.Meta.KubeconfigPath == "" {
		if s.directCfg == nil {
			return nil, fmt.Errorf("kubeconfig session not initialized")
		}
		return s.directCfg, nil
	}

	// Live-linked file (~/.kube/config or uploaded path) — re-read every request
	// so a recreated cluster (new API endpoint in kubeconfig) is picked up
	// without deleting the profile or restarting the app.
	yaml, err := services.ResolveKubeconfigYAML(s.Meta, cred)
	if err != nil {
		return nil, err
	}
	contextName := s.Meta.ClusterName
	if contextName == "" {
		contextName = s.ClusterName
	}
	k8sCfg, err := services.KubeconfigToRestConfigWithContext(yaml, contextName)
	if err != nil {
		return nil, err
	}
	if info, err := services.ParseKubeconfigContextByName(yaml, contextName); err == nil {
		if info.DisplayName != "" {
			s.DisplayName = info.DisplayName
		}
		s.ClusterName = info.ClusterName
	}
	s.directCfg = k8sCfg
	return k8sCfg, nil
}

func (s *ProfileSession) getAzureK8sConfig(ctx context.Context) (*rest.Config, error) {
	s.azureToken.mu.Lock()
	defer s.azureToken.mu.Unlock()

	cfg := &rest.Config{
		Host:            s.azureEndpoint,
		TLSClientConfig: rest.TLSClientConfig{CAData: s.azureCAData},
	}

	// Local-account AKS: user kubeconfig is client cert (typical) or a static token.
	if len(s.azureCertData) > 0 && len(s.azureKeyData) > 0 {
		cfg.TLSClientConfig.CertData = s.azureCertData
		cfg.TLSClientConfig.KeyData = s.azureKeyData
		if s.azureToken.token != "" {
			cfg.BearerToken = s.azureToken.token
		}
		return cfg, nil
	}
	if s.azureStaticAuth {
		cfg.BearerToken = s.azureToken.token
		return cfg, nil
	}

	// Entra-integrated cluster: kubeconfig is exec/kubelogin. Same AAD audience kubelogin uses.
	if err := s.azureToken.ensureFreshLocked(ctx, azureTokenSource{spJSON: s.azureSPJSON}); err != nil {
		return nil, err
	}
	cfg.BearerToken = s.azureToken.token
	return cfg, nil
}

func (s *ProfileSession) getGCPK8sConfig(ctx context.Context) (*rest.Config, error) {
	return getCloudK8sConfig(ctx, &s.gcpToken, gcpTokenSource{saJSON: s.gcpSAJSON}, s.gcpEndpoint, s.gcpCAData)
}

func (s *ProfileSession) getAWSK8sConfig(ctx context.Context, mfaToken string) (*rest.Config, error) {
	return getCloudK8sConfig(ctx, &s.awsToken, awsEKSTokenSource{s: s, mfa: mfaToken}, s.awsEndpoint, s.awsCAData)
}

// Store holds one ProfileSession per profile name.
type Store struct {
	mu       sync.RWMutex
	sessions map[string]*ProfileSession
}

var Default = &Store{sessions: map[string]*ProfileSession{}}

func (st *Store) Get(profile string) (*ProfileSession, bool) {
	st.mu.RLock()
	defer st.mu.RUnlock()
	s, ok := st.sessions[profile]
	return s, ok
}

// SetDisplayName updates the live session UI label. Empty falls back to the
// short cluster name. No-op if the profile is not connected.
func (st *Store) SetDisplayName(profile, displayName string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	s := st.sessions[profile]
	if s == nil {
		return
	}
	displayName = strings.TrimSpace(displayName)
	if displayName == "" {
		displayName = services.ShortClusterDisplayName(s.ClusterName)
		if displayName == "" {
			displayName = s.ClusterName
		}
	}
	s.DisplayName = displayName
}

// install stores (or replaces) a session under its profile name.
func (st *Store) install(name string, sess *ProfileSession) {
	st.mu.Lock()
	st.sessions[name] = sess
	st.mu.Unlock()
}

// ConnectAWS creates (or replaces) an AWS EKS session.
func (st *Store) ConnectAWS(meta services.ProfileMeta, cluster *services.EKSCluster, awsSess *services.AWSSession) error {
	caData, err := base64.StdEncoding.DecodeString(cluster.CACert)
	if err != nil {
		return fmt.Errorf("decode CA: %w", err)
	}

	ctx := context.Background()
	tok, err := services.GetEKSToken(ctx, awsSess, meta.Region, cluster.Name)
	if err != nil {
		return err
	}

	sess := &ProfileSession{
		Meta:        meta,
		ClusterName: cluster.Name,
		awsEndpoint: cluster.Endpoint,
		awsCAData:   caData,
		awsToken:    cachedToken{token: tok.Token, expiry: tok.Expiry},
	}

	st.install(meta.Name, sess)

	ps := services.PersistedSession{
		Type:        "aws",
		ClusterName: cluster.Name,
		DisplayName: services.ShortClusterDisplayName(cluster.Name),
		Endpoint:    cluster.Endpoint,
		CAData:      cluster.CACert,
	}
	if awsSess != nil {
		ps.AWSAccessKeyID = awsSess.AccessKeyID
		ps.AWSSecretAccessKey = awsSess.SecretAccessKey
		ps.AWSSessionToken = awsSess.SessionToken
		ps.AWSExpiry = awsSess.Expiry
	}
	if _, mfa := services.PeekAWSAuth(meta.Name); mfa != nil {
		ps.AWSMFAAccessKeyID = mfa.AccessKeyID
		ps.AWSMFASecretAccessKey = mfa.SecretAccessKey
		ps.AWSMFASessionToken = mfa.SessionToken
		ps.AWSMFAExpiry = mfa.Expiry
	}
	_ = services.SavePersistedSession(meta.Name, ps)
	return nil
}

// ConnectAzure creates an AKS session from listClusterUserCredential (same as
// `az aks get-credentials`). Client cert / static token are used as-is; Entra
// clusters mint an AAD token lazily in getAzureK8sConfig.
func (st *Store) ConnectAzure(meta services.ProfileMeta, cluster *services.AKSCluster, spJSON string) {
	sess := &ProfileSession{
		Meta:            meta,
		ClusterName:     cluster.Name,
		azureEndpoint:   cluster.Endpoint,
		azureCAData:     cluster.CAData,
		azureCertData:   cluster.CertData,
		azureKeyData:    cluster.KeyData,
		azureSPJSON:     spJSON,
		azureToken:      cachedToken{token: cluster.Token},
		azureStaticAuth: cluster.StaticAuth,
	}
	st.install(meta.Name, sess)

	_ = services.SavePersistedSession(meta.Name, services.PersistedSession{
		Type:            "azure",
		ClusterName:     cluster.Name,
		DisplayName:     cluster.Name,
		Endpoint:        cluster.Endpoint,
		CAData:          base64.StdEncoding.EncodeToString(cluster.CAData),
		AzureToken:      cluster.Token,
		AzureStaticAuth: cluster.StaticAuth,
		AzureClientCert: base64.StdEncoding.EncodeToString(cluster.CertData),
		AzureClientKey:  base64.StdEncoding.EncodeToString(cluster.KeyData),
	})
}

// ConnectGCP creates a GKE session. Tokens are fetched lazily by getGCPK8sConfig.
func (st *Store) ConnectGCP(meta services.ProfileMeta, cluster *services.GKECluster, saJSON string) {
	sess := &ProfileSession{
		Meta:        meta,
		ClusterName: cluster.Name,
		gcpEndpoint: "https://" + cluster.Endpoint,
		gcpCAData:   cluster.CAData,
		gcpSAJSON:   saJSON,
	}
	st.install(meta.Name, sess)

	_ = services.SavePersistedSession(meta.Name, services.PersistedSession{
		Type:        "gcp",
		ClusterName: cluster.Name,
		DisplayName: cluster.Name,
		Endpoint:    "https://" + cluster.Endpoint,
		CAData:      base64.StdEncoding.EncodeToString(cluster.CAData),
	})
}

// ConnectKubeconfig creates a session backed by a raw kubeconfig.
// clusterName is the kube cluster key; displayName is the short UI label.
func (st *Store) ConnectKubeconfig(meta services.ProfileMeta, k8sCfg *rest.Config, clusterName, displayName string) {
	if displayName == "" {
		displayName = services.ShortClusterDisplayName(clusterName)
	}
	sess := &ProfileSession{
		Meta:        meta,
		ClusterName: clusterName,
		DisplayName: displayName,
		directCfg:   k8sCfg,
	}
	st.install(meta.Name, sess)

	_ = services.SavePersistedSession(meta.Name, services.PersistedSession{
		Type:        "kubeconfig",
		ClusterName: clusterName,
		DisplayName: displayName,
	})
}

func (st *Store) Remove(profile string) {
	st.mu.Lock()
	delete(st.sessions, profile)
	st.mu.Unlock()
	_ = services.DeletePersistedSession(profile)
}

// Hydrate restores remembered sessions from sessions.enc into memory after boot.
// Profiles that cannot be restored silently (expired MFA STS) are dropped from disk.
func Hydrate() {
	all, err := services.LoadAllPersistedSessions()
	if err != nil {
		log.Printf("session hydrate: load: %v", err)
		return
	}
	if len(all) == 0 {
		return
	}

	cfg, err := services.LoadAppConfig()
	if err != nil {
		log.Printf("session hydrate: config: %v", err)
		return
	}

	ctx := context.Background()
	for name, ps := range all {
		meta, ok := cfg.Profiles[name]
		if !ok {
			_ = services.DeletePersistedSession(name)
			continue
		}
		// Cap each restore so a dead VPN / offline API cannot stall boot.
		oneCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		err := stHydrateOne(oneCtx, meta, ps)
		cancel()
		if err != nil {
			log.Printf("session hydrate %s: %v", name, err)
			_ = services.DeletePersistedSession(name)
		}
	}
}

var hydrateByType = map[string]func(context.Context, services.ProfileMeta, services.PersistedSession) error{
	"kubeconfig": hydrateKubeconfig,
	"gcp":        hydrateGCP,
	"azure":      hydrateAzure,
}

func stHydrateOne(ctx context.Context, meta services.ProfileMeta, ps services.PersistedSession) error {
	if fn, ok := hydrateByType[meta.Type]; ok {
		return fn(ctx, meta, ps)
	}
	return hydrateAWS(ctx, meta, ps)
}

func hydrateAWS(ctx context.Context, meta services.ProfileMeta, ps services.PersistedSession) error {
	if ps.Endpoint == "" || ps.CAData == "" || ps.ClusterName == "" {
		return fmt.Errorf("incomplete AWS session blob")
	}
	caData, err := base64.StdEncoding.DecodeString(ps.CAData)
	if err != nil {
		return fmt.Errorf("decode CA: %w", err)
	}

	awsSess := &services.AWSSession{
		AccessKeyID:     ps.AWSAccessKeyID,
		SecretAccessKey: ps.AWSSecretAccessKey,
		SessionToken:    ps.AWSSessionToken,
		Expiry:          ps.AWSExpiry,
	}
	var mfaSess *services.AWSSession
	if ps.AWSMFAAccessKeyID != "" {
		mfaSess = &services.AWSSession{
			AccessKeyID:     ps.AWSMFAAccessKeyID,
			SecretAccessKey: ps.AWSMFASecretAccessKey,
			SessionToken:    ps.AWSMFASessionToken,
			Expiry:          ps.AWSMFAExpiry,
		}
	}
	services.RestoreAWSSession(meta.Name, awsSess, mfaSess)

	if !awsSessExpired(awsSess) {
		// Active STS still good.
	} else {
		// Active expired — try silent refresh (MFA STS and/or AssumeRole without OTP).
		if meta.MFASerial != "" {
			fresh, err := services.GetAWSSession(ctx, meta, "")
			if err != nil {
				if services.IsNeedsMFA(err) {
					return fmt.Errorf("AWS STS expired (MFA required)")
				}
				return err
			}
			awsSess = fresh
		} else {
			fresh, err := services.GetAWSSession(ctx, meta, "")
			if err != nil {
				return err
			}
			awsSess = fresh
		}
	}

	sess := &ProfileSession{
		Meta:        meta,
		ClusterName: ps.ClusterName,
		DisplayName: ps.DisplayName,
		awsEndpoint: ps.Endpoint,
		awsCAData:   caData,
		// EKS token minted lazily on first GetK8sConfig
	}
	if err := probeSession(ctx, sess); err != nil {
		return err
	}
	Default.install(meta.Name, sess)

	// Refresh persisted STS if we just re-minted.
	active, mfa := services.PeekAWSAuth(meta.Name)
	if active == nil {
		active = awsSess
	}
	psOut := services.PersistedSession{
		Type:               "aws",
		ClusterName:        ps.ClusterName,
		DisplayName:        ps.DisplayName,
		Endpoint:           ps.Endpoint,
		CAData:             ps.CAData,
		AWSAccessKeyID:     active.AccessKeyID,
		AWSSecretAccessKey: active.SecretAccessKey,
		AWSSessionToken:    active.SessionToken,
		AWSExpiry:          active.Expiry,
	}
	if mfa != nil {
		psOut.AWSMFAAccessKeyID = mfa.AccessKeyID
		psOut.AWSMFASecretAccessKey = mfa.SecretAccessKey
		psOut.AWSMFASessionToken = mfa.SessionToken
		psOut.AWSMFAExpiry = mfa.Expiry
	}
	_ = services.SavePersistedSession(meta.Name, psOut)
	return nil
}

func awsSessExpired(s *services.AWSSession) bool {
	if s.Expiry.IsZero() {
		return true
	}
	return time.Now().After(s.Expiry.Add(-2 * time.Minute))
}

func hydrateKubeconfig(ctx context.Context, meta services.ProfileMeta, ps services.PersistedSession) error {
	cred, err := services.LoadCredential(meta.Name)
	if err != nil {
		return err
	}
	yaml, err := services.ResolveKubeconfigYAML(meta, cred)
	if err != nil {
		return err
	}
	contextName := meta.ClusterName
	if contextName == "" {
		contextName = ps.ClusterName
	}
	k8sCfg, err := services.KubeconfigToRestConfigWithContext(yaml, contextName)
	if err != nil {
		return err
	}
	info, err := services.ParseKubeconfigContextByName(yaml, contextName)
	if err != nil {
		return err
	}
	if err := services.ProbeKubeconfigAuth(ctx, k8sCfg); err != nil {
		return err
	}
	display := ps.DisplayName
	if display == "" {
		display = info.DisplayName
	}
	// Install without re-writing persistence (already on disk).
	sess := &ProfileSession{
		Meta:        meta,
		ClusterName: info.ClusterName,
		DisplayName: display,
		directCfg:   k8sCfg,
	}
	Default.install(meta.Name, sess)
	return nil
}

func hydrateGCP(ctx context.Context, meta services.ProfileMeta, ps services.PersistedSession) error {
	if ps.Endpoint == "" || ps.CAData == "" {
		return fmt.Errorf("incomplete GCP session blob")
	}
	cred, err := services.LoadCredential(meta.Name)
	if err != nil {
		return err
	}
	caData, err := base64.StdEncoding.DecodeString(ps.CAData)
	if err != nil {
		return err
	}
	endpoint := ps.Endpoint
	if !strings.HasPrefix(endpoint, "https://") && !strings.HasPrefix(endpoint, "http://") {
		endpoint = "https://" + endpoint
	}
	sess := &ProfileSession{
		Meta:        meta,
		ClusterName: ps.ClusterName,
		DisplayName: ps.DisplayName,
		gcpEndpoint: endpoint,
		gcpCAData:   caData,
		gcpSAJSON:   cred.ServiceAccountJSON,
	}
	if err := probeSession(ctx, sess); err != nil {
		return err
	}
	Default.install(meta.Name, sess)
	return nil
}

func hydrateAzure(ctx context.Context, meta services.ProfileMeta, ps services.PersistedSession) error {
	if ps.Endpoint == "" || ps.CAData == "" {
		return fmt.Errorf("incomplete Azure session blob")
	}
	cred, err := services.LoadCredential(meta.Name)
	if err != nil {
		return err
	}
	caData, err := base64.StdEncoding.DecodeString(ps.CAData)
	if err != nil {
		return err
	}
	certData, _ := base64.StdEncoding.DecodeString(ps.AzureClientCert)
	keyData, _ := base64.StdEncoding.DecodeString(ps.AzureClientKey)
	sess := &ProfileSession{
		Meta:            meta,
		ClusterName:     ps.ClusterName,
		DisplayName:     ps.DisplayName,
		azureEndpoint:   ps.Endpoint,
		azureCAData:     caData,
		azureCertData:   certData,
		azureKeyData:    keyData,
		azureSPJSON:     cred.ServiceAccountJSON,
		azureToken:      cachedToken{token: ps.AzureToken},
		azureStaticAuth: ps.AzureStaticAuth,
	}
	if err := probeSession(ctx, sess); err != nil {
		return err
	}
	Default.install(meta.Name, sess)
	return nil
}

// probeSession verifies the API server is reachable before marking a session connected.
// Without this, deleted/stopped cloud clusters stay green forever after hydrate.
func probeSession(ctx context.Context, sess *ProfileSession) error {
	cfg, err := sess.GetK8sConfig(ctx, "")
	if err != nil {
		return err
	}
	return services.ProbeKubeconfigAuth(ctx, cfg)
}
