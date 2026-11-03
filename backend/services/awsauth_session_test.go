package services

import (
	"context"
	"testing"
	"time"
)

func TestGetAWSSessionReturnsCachedActive(t *testing.T) {
	name := "aws-cache-hit-" + t.Name()
	ClearAWSSession(name)
	t.Cleanup(func() { ClearAWSSession(name) })

	want := &AWSSession{
		AccessKeyID:     "ASIACACHED",
		SecretAccessKey: "secret",
		SessionToken:    "token",
		Expiry:          time.Now().Add(time.Hour),
	}
	awsSessionCache.set(name, want, nil)

	got, err := GetAWSSession(context.Background(), ProfileMeta{
		Name:      name,
		Type:      "aws",
		Region:    "eu-west-1",
		MFASerial: "arn:aws:iam::1:mfa/user", // would force MFA if cache missed
	}, "")
	if err != nil {
		t.Fatalf("GetAWSSession: %v", err)
	}
	if got.AccessKeyID != want.AccessKeyID || got.SessionToken != want.SessionToken {
		t.Fatalf("got %#v, want cached session", got)
	}
}

func TestGetAWSSessionNeedsMFAWhenSerialAndNoToken(t *testing.T) {
	name := "aws-needs-mfa-" + t.Name()
	ClearAWSSession(name)
	t.Cleanup(func() { ClearAWSSession(name) })

	_, err := GetAWSSession(context.Background(), ProfileMeta{
		Name:      name,
		Type:      "aws",
		Region:    "us-east-1",
		MFASerial: "arn:aws:iam::1:mfa/user",
	}, "")
	if !IsNeedsMFA(err) {
		t.Fatalf("err = %v, want NeedsMFAError", err)
	}
}

func TestGetAWSSessionCheckSessionMFAWithoutActive(t *testing.T) {
	name := "aws-check-mfa-" + t.Name()
	ClearAWSSession(name)
	t.Cleanup(func() { ClearAWSSession(name) })

	meta := ProfileMeta{Name: name, MFASerial: "arn:aws:iam::1:mfa/user"}
	if CheckSession(name, meta) {
		t.Fatal("expected false with MFA serial and empty cache")
	}

	mfa := &AWSSession{
		AccessKeyID: "ASIAA", SecretAccessKey: "s", SessionToken: "t",
		Expiry: time.Now().Add(time.Hour),
	}
	// MFA STS only — no active role session yet.
	awsSessionCache.set(name, nil, mfa)
	// getActive sees nil Active → expired; CheckSession should still see MFA.
	if !CheckSession(name, meta) {
		t.Fatal("expected true when MFA STS cache is valid")
	}
}

func TestClearAWSSessionDropsCache(t *testing.T) {
	name := "aws-clear-" + t.Name()
	ClearAWSSession(name)
	t.Cleanup(func() { ClearAWSSession(name) })

	awsSessionCache.set(name, &AWSSession{
		AccessKeyID: "A", SecretAccessKey: "B",
		Expiry: time.Now().Add(time.Hour),
	}, nil)
	ClearAWSSession(name)
	if _, ok := awsSessionCache.getActive(name); ok {
		t.Fatal("expected cache empty after ClearAWSSession")
	}
}

func TestRestoreAWSSessionSkipsFullyExpired(t *testing.T) {
	name := "aws-restore-" + t.Name()
	ClearAWSSession(name)
	t.Cleanup(func() { ClearAWSSession(name) })

	RestoreAWSSession(name,
		&AWSSession{Expiry: time.Now().Add(-time.Hour)},
		&AWSSession{Expiry: time.Now().Add(-time.Hour)},
	)
	if _, ok := awsSessionCache.getActive(name); ok {
		t.Fatal("fully expired restore must not populate cache")
	}

	RestoreAWSSession(name,
		&AWSSession{AccessKeyID: "live", SecretAccessKey: "s", Expiry: time.Now().Add(time.Hour)},
		nil,
	)
	got, ok := awsSessionCache.getActive(name)
	if !ok || got.AccessKeyID != "live" {
		t.Fatalf("restore live session: ok=%v got=%#v", ok, got)
	}
}
