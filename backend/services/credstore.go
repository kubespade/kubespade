package services

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/zalando/go-keyring"
)

const (
	keyringService = "KubeSpade"
	keyringUser    = "vault-pass"
)

// Older keychain service names from previous product brands.
var legacyKeyringServices = []string{"K8s Client", "K8s Flashlight", "k8s-flashlight"}

var (
	credstoreFile  string
	passphraseFile string
)

func init() {
	credstoreFile = filepath.Join(DataDir(), "credentials.enc")
	passphraseFile = filepath.Join(DataDir(), ".vault-pass")
}

// StoredCredential holds sensitive data for one profile, encrypted at rest.
type StoredCredential struct {
	Type               string `json:"type"` // "aws" | "kubeconfig" | "gcp" | "azure"
	AccessKeyID        string `json:"accessKeyId,omitempty"`
	SecretAccessKey    string `json:"secretAccessKey,omitempty"`
	KubeconfigData     string `json:"kubeconfigData,omitempty"`
	ServiceAccountJSON string `json:"serviceAccountJson,omitempty"` // GCP SA key JSON or Azure SP JSON
}

type credentialStore struct {
	Credentials map[string]StoredCredential `json:"credentials"`
}

var credMu sync.RWMutex

// GetPassphrase reads the master passphrase from the OS keychain (preferred),
// migrating a legacy plaintext `.vault-pass` file when present. Generates a
// new key if neither exists.
func GetPassphrase() (string, error) {
	if pass, err := keyring.Get(keyringService, keyringUser); err == nil && strings.TrimSpace(pass) != "" {
		return strings.TrimSpace(pass), nil
	}

	// Rebrand: copy vault key from older keychain service names.
	for _, legacy := range legacyKeyringServices {
		pass, err := keyring.Get(legacy, keyringUser)
		if err != nil || strings.TrimSpace(pass) == "" {
			continue
		}
		pass = strings.TrimSpace(pass)
		if setErr := keyring.Set(keyringService, keyringUser, pass); setErr == nil {
			_ = keyring.Delete(legacy, keyringUser)
		}
		return pass, nil
	}

	// Migrate legacy on-disk key into the keychain, then delete the file.
	if data, err := os.ReadFile(passphraseFile); err == nil {
		pass := strings.TrimSpace(string(data))
		if pass != "" {
			if setErr := keyring.Set(keyringService, keyringUser, pass); setErr == nil {
				_ = os.Remove(passphraseFile)
			}
			return pass, nil
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}

	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	pass := hex.EncodeToString(b)
	if err := keyring.Set(keyringService, keyringUser, pass); err != nil {
		// Fallback: keep file-based key if keychain unavailable (CI/headless).
		if err := os.MkdirAll(DataDir(), 0700); err != nil {
			return "", err
		}
		if werr := os.WriteFile(passphraseFile, []byte(pass), 0600); werr != nil {
			return "", fmt.Errorf("keychain unavailable (%v) and file fallback failed: %w", err, werr)
		}
		return pass, nil
	}
	_ = os.Remove(passphraseFile)
	return pass, nil
}

func SaveCredential(name string, cred StoredCredential) error {
	credMu.Lock()
	defer credMu.Unlock()
	store, err := loadCredStore()
	if err != nil {
		return err
	}
	store.Credentials[strings.ToLower(name)] = cred
	return persistCredStore(store)
}

func LoadCredential(name string) (StoredCredential, error) {
	credMu.RLock()
	defer credMu.RUnlock()
	store, err := loadCredStore()
	if err != nil {
		return StoredCredential{}, err
	}
	cred, ok := store.Credentials[strings.ToLower(name)]
	if !ok {
		return StoredCredential{}, fmt.Errorf("credential not found: %s", name)
	}
	return cred, nil
}

func DeleteCredential(name string) error {
	credMu.Lock()
	defer credMu.Unlock()
	store, err := loadCredStore()
	if err != nil {
		return err
	}
	delete(store.Credentials, strings.ToLower(name))
	return persistCredStore(store)
}

func loadCredStore() (*credentialStore, error) {
	pass, err := GetPassphrase()
	if err != nil {
		return nil, err
	}
	key := passphraseKey(pass)

	data, err := os.ReadFile(credstoreFile)
	if os.IsNotExist(err) {
		return &credentialStore{Credentials: map[string]StoredCredential{}}, nil
	}
	if err != nil {
		return nil, err
	}

	plain, err := decryptGCM(key, data)
	if err != nil {
		return nil, fmt.Errorf("decrypt credstore: %w", err)
	}

	var store credentialStore
	if err := json.Unmarshal(plain, &store); err != nil {
		return nil, err
	}
	if store.Credentials == nil {
		store.Credentials = map[string]StoredCredential{}
	}
	return &store, nil
}

func persistCredStore(store *credentialStore) error {
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
	return os.WriteFile(credstoreFile, ciphertext, 0600)
}

// passphraseKey derives a 32-byte AES key from the passphrase.
// If the passphrase is already 64 hex chars (our generated format), decode directly.
// Otherwise SHA-256 hash it.
func passphraseKey(pass string) []byte {
	if b, err := hex.DecodeString(pass); err == nil && len(b) == 32 {
		return b
	}
	h := sha256.Sum256([]byte(pass))
	return h[:]
}

func encryptGCM(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

func decryptGCM(key, ciphertext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(ciphertext) < gcm.NonceSize() {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce, ct := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}
