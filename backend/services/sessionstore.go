package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	sessionstoreFile string
	sessionMu        sync.Mutex
)

func init() {
	sessionstoreFile = filepath.Join(DataDir(), "sessions.enc")
}

// PersistedSession is enough state to rebuild a live k8s ProfileSession after restart.
// Long-lived IAM / SA keys stay in credentials.enc — only temp STS and cluster endpoints here.
type PersistedSession struct {
	Type        string `json:"type"` // aws | kubeconfig | gcp | azure
	ClusterName string `json:"clusterName"`
	DisplayName string `json:"displayName,omitempty"`

	Endpoint string `json:"endpoint,omitempty"`
	CAData   string `json:"caData,omitempty"` // base64 for AWS/GCP/Azure

	// AWS temporary STS (from GetSessionToken / AssumeRole)
	AWSAccessKeyID     string    `json:"awsAccessKeyId,omitempty"`
	AWSSecretAccessKey string    `json:"awsSecretAccessKey,omitempty"`
	AWSSessionToken    string    `json:"awsSessionToken,omitempty"`
	AWSExpiry          time.Time `json:"awsExpiry,omitempty"`

	// MFA GetSessionToken session — used to silently refresh AssumeRole until MFA STS expires.
	AWSMFAAccessKeyID     string    `json:"awsMfaAccessKeyId,omitempty"`
	AWSMFASecretAccessKey string    `json:"awsMfaSecretAccessKey,omitempty"`
	AWSMFASessionToken    string    `json:"awsMfaSessionToken,omitempty"`
	AWSMFAExpiry          time.Time `json:"awsMfaExpiry,omitempty"`

	// Azure kubeconfig user (listClusterUserCredential)
	AzureToken      string `json:"azureToken,omitempty"`
	AzureStaticAuth bool   `json:"azureStaticAuth,omitempty"`
	AzureClientCert string `json:"azureClientCert,omitempty"` // base64 of client-certificate-data
	AzureClientKey  string `json:"azureClientKey,omitempty"`  // base64 of client-key-data
}

type persistedSessionStore struct {
	Sessions map[string]PersistedSession `json:"sessions"`
}

// SavePersistedSession upserts one remembered connection.
func SavePersistedSession(name string, s PersistedSession) error {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	store, err := loadSessionStore()
	if err != nil {
		return err
	}
	store.Sessions[strings.ToLower(name)] = s
	return persistSessionStore(store)
}

// LoadAllPersistedSessions returns every remembered connection.
func LoadAllPersistedSessions() (map[string]PersistedSession, error) {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	store, err := loadSessionStore()
	if err != nil {
		return nil, err
	}
	out := make(map[string]PersistedSession, len(store.Sessions))
	for k, v := range store.Sessions {
		out[k] = v
	}
	return out, nil
}

// DeletePersistedSession removes a remembered connection (Disconnect / Delete).
func DeletePersistedSession(name string) error {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	store, err := loadSessionStore()
	if err != nil {
		return err
	}
	delete(store.Sessions, strings.ToLower(name))
	return persistSessionStore(store)
}

// UpdatePersistedAWSSession refreshes STS fields for an already-remembered profile.
func UpdatePersistedAWSSession(name string, aws, mfa *AWSSession) error {
	if aws == nil && mfa == nil {
		return nil
	}
	sessionMu.Lock()
	defer sessionMu.Unlock()
	store, err := loadSessionStore()
	if err != nil {
		return err
	}
	key := strings.ToLower(name)
	s, ok := store.Sessions[key]
	if !ok {
		return nil
	}
	if aws != nil {
		s.AWSAccessKeyID = aws.AccessKeyID
		s.AWSSecretAccessKey = aws.SecretAccessKey
		s.AWSSessionToken = aws.SessionToken
		s.AWSExpiry = aws.Expiry
	}
	if mfa != nil {
		s.AWSMFAAccessKeyID = mfa.AccessKeyID
		s.AWSMFASecretAccessKey = mfa.SecretAccessKey
		s.AWSMFASessionToken = mfa.SessionToken
		s.AWSMFAExpiry = mfa.Expiry
	}
	store.Sessions[key] = s
	return persistSessionStore(store)
}

func loadSessionStore() (*persistedSessionStore, error) {
	pass, err := GetPassphrase()
	if err != nil {
		return nil, err
	}
	key := passphraseKey(pass)

	data, err := os.ReadFile(sessionstoreFile)
	if os.IsNotExist(err) {
		return &persistedSessionStore{Sessions: map[string]PersistedSession{}}, nil
	}
	if err != nil {
		return nil, err
	}

	plain, err := decryptGCM(key, data)
	if err != nil {
		return nil, fmt.Errorf("decrypt sessions: %w", err)
	}

	var store persistedSessionStore
	if err := json.Unmarshal(plain, &store); err != nil {
		return nil, err
	}
	if store.Sessions == nil {
		store.Sessions = map[string]PersistedSession{}
	}
	return &store, nil
}

func persistSessionStore(store *persistedSessionStore) error {
	pass, err := GetPassphrase()
	if err != nil {
		return err
	}
	key := passphraseKey(pass)

	plain, err := json.Marshal(store)
	if err != nil {
		return err
	}

	ciphertext, err := encryptGCM(key, plain)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(sessionstoreFile), 0700); err != nil {
		return err
	}
	return os.WriteFile(sessionstoreFile, ciphertext, 0600)
}
