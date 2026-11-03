package services

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func withCredstoreDir(t *testing.T, dir string) {
	t.Helper()
	prevCred, prevPass := credstoreFile, passphraseFile
	credstoreFile = filepath.Join(dir, "credentials.enc")
	passphraseFile = filepath.Join(dir, ".vault-pass")
	t.Cleanup(func() {
		credstoreFile, passphraseFile = prevCred, prevPass
	})
}

func TestPassphraseKey(t *testing.T) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatal(err)
	}
	hexPass := hex.EncodeToString(raw)

	gotHex := passphraseKey(hexPass)
	if !bytes.Equal(gotHex, raw) {
		t.Fatalf("hex passphrase: got %x, want %x", gotHex, raw)
	}

	plain := "my-secret-passphrase"
	gotHash := passphraseKey(plain)
	gotHash2 := passphraseKey(plain)
	if !bytes.Equal(gotHash, gotHash2) {
		t.Fatal("SHA-256 derivation should be stable")
	}
	if len(gotHash) != 32 {
		t.Fatalf("key length %d", len(gotHash))
	}
	// Non-64-char hex strings are hashed, not decoded.
	shortHex := hex.EncodeToString([]byte("not-thirty-two-bytes"))
	if bytes.Equal(passphraseKey(shortHex), raw) {
		t.Fatal("short hex string should be hashed, not decoded")
	}
}

func TestEncryptDecryptGCMRoundTrip(t *testing.T) {
	key := passphraseKey(hex.EncodeToString(make([]byte, 32)))
	plain := []byte(`{"credentials":{"prod":{"type":"aws"}}}`)

	ct, err := encryptGCM(key, plain)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(ct, plain) {
		t.Fatal("ciphertext must differ from plaintext")
	}

	out, err := decryptGCM(key, ct)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, plain) {
		t.Fatalf("round-trip mismatch: %q vs %q", out, plain)
	}

	wrongKey := passphraseKey("different-passphrase")
	if _, err := decryptGCM(wrongKey, ct); err == nil {
		t.Fatal("expected decrypt failure with wrong key")
	}

	if _, err := decryptGCM(key, []byte("short")); err == nil {
		t.Fatal("expected error for truncated ciphertext")
	}
}

func TestCredStoreSaveLoadRoundTrip(t *testing.T) {
	dir := t.TempDir()
	withCredstoreDir(t, dir)

	name := "My-Profile"
	cred := StoredCredential{
		Type:            "aws",
		AccessKeyID:     "AKIAEXAMPLE",
		SecretAccessKey: "secret",
	}
	if err := SaveCredential(name, cred); err != nil {
		t.Fatal(err)
	}

	loaded, err := LoadCredential(name)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Type != cred.Type || loaded.AccessKeyID != cred.AccessKeyID || loaded.SecretAccessKey != cred.SecretAccessKey {
		t.Fatalf("loaded %+v, want %+v", loaded, cred)
	}

	data, err := os.ReadFile(credstoreFile)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, []byte("AKIAEXAMPLE")) {
		t.Fatal("credentials.enc must not contain plaintext secrets")
	}

	if err := DeleteCredential(name); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadCredential(name); err == nil {
		t.Fatal("expected not found after delete")
	}
}

func TestCredStorePersistLoadEncryptedFile(t *testing.T) {
	dir := t.TempDir()
	withCredstoreDir(t, dir)

	pass, err := GetPassphrase()
	if err != nil {
		t.Fatal(err)
	}
	store := &credentialStore{Credentials: map[string]StoredCredential{
		"disk": {Type: "kubeconfig", KubeconfigData: "yaml"},
	}}
	plain, err := json.Marshal(store)
	if err != nil {
		t.Fatal(err)
	}
	ct, err := encryptGCM(passphraseKey(pass), plain)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(credstoreFile, ct, 0600); err != nil {
		t.Fatal(err)
	}

	loaded, err := loadCredStore()
	if err != nil {
		t.Fatal(err)
	}
	cred, ok := loaded.Credentials["disk"]
	if !ok {
		t.Fatalf("credentials: %+v", loaded.Credentials)
	}
	if cred.KubeconfigData != "yaml" {
		t.Fatalf("got %+v", cred)
	}

	store.Credentials["disk"] = StoredCredential{Type: "kubeconfig", KubeconfigData: "updated"}
	if err := persistCredStore(store); err != nil {
		t.Fatal(err)
	}
	loaded, err = loadCredStore()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Credentials["disk"].KubeconfigData != "updated" {
		t.Fatalf("persist round-trip: %+v", loaded.Credentials["disk"])
	}
}
