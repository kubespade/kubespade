package services

import (
	"errors"
	"testing"
	"time"
)

func TestNeedsMFAError(t *testing.T) {
	var err error = &NeedsMFAError{}
	if err.Error() != "MFA required" {
		t.Errorf("Error() = %q", err.Error())
	}
	if !IsNeedsMFA(err) {
		t.Error("IsNeedsMFA should be true for *NeedsMFAError")
	}
	if IsNeedsMFA(errors.New("other")) {
		t.Error("IsNeedsMFA should be false for generic error")
	}
	if IsNeedsMFA(nil) {
		t.Error("IsNeedsMFA should be false for nil")
	}
}

func TestAWSCacheKey(t *testing.T) {
	if awsCacheKey("MyProfile") != "myprofile" {
		t.Errorf("expected lowercased key")
	}
	if awsCacheKey("already") != "already" {
		t.Errorf("expected unchanged")
	}
}

func TestIsMFARequiredErr(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"MultiFactorAuthentication", errors.New("AccessDenied: MultiFactorAuthentication failed"), true},
		{"mfa token phrase", errors.New("MFA token is invalid"), true},
		{"mfa required combo", errors.New("an MFA device is required for this action"), true},
		{"expiredtoken mfa combo", errors.New("ExpiredToken: the mfa session has expired"), true},
		{"unrelated", errors.New("connection refused"), false},
		{"mfa alone without required", errors.New("configure your mfa device"), false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isMFARequiredErr(tt.err); got != tt.want {
				t.Errorf("isMFARequiredErr(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestAWSSessionIsExpired(t *testing.T) {
	var nilSess *AWSSession
	if !nilSess.isExpired() {
		t.Error("nil session should be expired")
	}
	// Expiry in the past → expired.
	past := &AWSSession{Expiry: time.Now().Add(-time.Hour)}
	if !past.isExpired() {
		t.Error("past expiry should be expired")
	}
	// Expiry far in the future → not expired (accounting for 2m skew).
	future := &AWSSession{Expiry: time.Now().Add(time.Hour)}
	if future.isExpired() {
		t.Error("future expiry should not be expired")
	}
	// Within the 2-minute skew window → treated as expired.
	soon := &AWSSession{Expiry: time.Now().Add(time.Minute)}
	if !soon.isExpired() {
		t.Error("expiry within skew window should be expired")
	}
}

func TestLoadPersistedMFASerial(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("K8S_CLIENT_DATA", dir)

	if got := loadPersistedMFASerial("missing"); got != "" {
		t.Errorf("expected empty for missing profile, got %q", got)
	}

	meta := ProfileMeta{
		Name:      "role-mfa",
		Type:      "aws",
		Region:    "us-east-1",
		RoleARN:   "arn:aws:iam::123:role/EKS",
		MFASerial: "arn:aws:iam::123:mfa/user",
	}
	if err := SaveProfile(meta); err != nil {
		t.Fatal(err)
	}
	if got := loadPersistedMFASerial("role-mfa"); got != meta.MFASerial {
		t.Errorf("loadPersistedMFASerial = %q, want %q", got, meta.MFASerial)
	}
	// Case-insensitive profile name.
	if got := loadPersistedMFASerial("Role-MFA"); got != meta.MFASerial {
		t.Errorf("loadPersistedMFASerial case-insensitive = %q", got)
	}
}

func TestPrepareRoleMFASerialAlreadySet(t *testing.T) {
	meta := ProfileMeta{Name: "p", MFASerial: "arn:aws:iam::1:mfa/x"}
	serial, err := prepareRoleMFASerial(&meta, "AKIA", "secret", "us-east-1")
	if err != nil {
		t.Fatal(err)
	}
	if serial != "arn:aws:iam::1:mfa/x" {
		t.Errorf("got %q", serial)
	}
}

func TestCheckSessionPrefersActiveCache(t *testing.T) {
	name := "check-sess-" + t.Name()
	ClearAWSSession(name)
	t.Cleanup(func() { ClearAWSSession(name) })

	meta := ProfileMeta{Name: name, MFASerial: "arn:aws:iam::1:mfa/x"}
	if CheckSession(name, meta) {
		t.Fatal("expected false with MFA serial and empty cache")
	}

	awsSessionCache.set(name, &AWSSession{
		AccessKeyID: "A", SecretAccessKey: "B", SessionToken: "C",
		Expiry: time.Now().Add(time.Hour),
	}, nil)
	if !CheckSession(name, meta) {
		t.Fatal("expected true with active cache")
	}
}
