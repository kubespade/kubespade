package services

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/iam"
	"github.com/aws/aws-sdk-go-v2/service/sts"
)

// NeedsMFAError is returned when MFA is required but no token was supplied.
type NeedsMFAError struct{}

func (e *NeedsMFAError) Error() string { return "MFA required" }
func IsNeedsMFA(err error) bool        { _, ok := err.(*NeedsMFAError); return ok }

// IAM GetSessionToken with MFA — AWS allows up to 36h; 12h covers a work day.
const mfaSessionSeconds int32 = 43_200

// AWSSession holds temporary (or long-lived) AWS credentials.
type AWSSession struct {
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
	Expiry          time.Time
}

func (s *AWSSession) isExpired() bool {
	if s == nil {
		return true
	}
	return time.Now().After(s.Expiry.Add(-2 * time.Minute))
}

// awsConfig builds an aws.Config from a session.
func (s *AWSSession) awsConfig(region string) (aws.Config, error) {
	return config.LoadDefaultConfig(context.Background(),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			s.AccessKeyID, s.SecretAccessKey, s.SessionToken,
		)),
		config.WithRegion(region),
	)
}

// ── Session cache ────────────────────────────────────────────────────────────

// cachedAWSAuth keeps active API creds plus optional MFA GetSessionToken session
// so AssumeRole can refresh silently until the MFA STS window ends.
type cachedAWSAuth struct {
	Active     *AWSSession
	MFASession *AWSSession
}

type sessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*cachedAWSAuth
}

var awsSessionCache = &sessionStore{sessions: map[string]*cachedAWSAuth{}}

func awsCacheKey(name string) string { return strings.ToLower(name) }

func (sc *sessionStore) getActive(name string) (*AWSSession, bool) {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	a := sc.sessions[awsCacheKey(name)]
	if a == nil || a.Active.isExpired() {
		return nil, false
	}
	return a.Active, true
}

func (sc *sessionStore) getMFA(name string) (*AWSSession, bool) {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	a := sc.sessions[awsCacheKey(name)]
	if a == nil || a.MFASession.isExpired() {
		return nil, false
	}
	return a.MFASession, true
}

func (sc *sessionStore) peek(name string) (active, mfa *AWSSession) {
	sc.mu.RLock()
	defer sc.mu.RUnlock()
	a := sc.sessions[awsCacheKey(name)]
	if a == nil {
		return nil, nil
	}
	return a.Active, a.MFASession
}

func (sc *sessionStore) set(name string, active, mfa *AWSSession) {
	sc.mu.Lock()
	key := awsCacheKey(name)
	if mfa == nil {
		if old := sc.sessions[key]; old != nil && !old.MFASession.isExpired() {
			mfa = old.MFASession
		}
	}
	sc.sessions[key] = &cachedAWSAuth{Active: active, MFASession: mfa}
	sc.mu.Unlock()
	// Keep sessions.enc STS in sync when a profile is already remembered.
	_ = UpdatePersistedAWSSession(name, active, mfa)
}

// PeekAWSAuth returns cached active + MFA sessions (may be expired).
func PeekAWSAuth(name string) (active, mfa *AWSSession) {
	return awsSessionCache.peek(name)
}

// RestoreAWSSession puts temporary STS credentials back into the in-memory
// cache (used when hydrating sessions.enc after restart). Skips the persist
// hook to avoid a write loop on boot.
func RestoreAWSSession(name string, active, mfa *AWSSession) {
	if active.isExpired() && mfa.isExpired() {
		return
	}
	awsSessionCache.mu.Lock()
	defer awsSessionCache.mu.Unlock()
	awsSessionCache.sessions[awsCacheKey(name)] = &cachedAWSAuth{Active: active, MFASession: mfa}
}

func (sc *sessionStore) clear(name string) {
	sc.mu.Lock()
	defer sc.mu.Unlock()
	delete(sc.sessions, awsCacheKey(name))
}

// ClearAWSSession drops the cached temporary credentials for a profile so the
// next GetAWSSession call re-authenticates (silently for AssumeRole-only, or
// with a fresh MFA code when MFASerial is set).
func ClearAWSSession(name string) {
	awsSessionCache.clear(name)
}

// CheckSession returns true when a usable AWS session is available without an
// MFA prompt: permanent IAM keys, AssumeRole that can be refreshed from long-
// term keys, or a still-valid MFA-backed cache entry.
func CheckSession(name string, meta ProfileMeta) bool {
	if _, ok := awsSessionCache.getActive(name); ok {
		return true
	}
	if meta.MFASerial == "" {
		// No stored MFA serial — GetAWSSession can try with long-term keys.
		// If the role trust policy requires MFA, that call returns NeedsMFAError.
		return true
	}
	// MFA STS still good → role (or MFA-only) can refresh without a new OTP.
	_, ok := awsSessionCache.getMFA(name)
	return ok
}

func isMFARequiredErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "multifactorauthentication") ||
		strings.Contains(msg, "mfa token") ||
		(strings.Contains(msg, "mfa") && strings.Contains(msg, "required")) ||
		strings.Contains(msg, "expiredtoken") && strings.Contains(msg, "mfa")
}

// ── Core auth ────────────────────────────────────────────────────────────────

// GetAWSSession returns valid AWS credentials for the profile.
// Handles GetSessionToken (MFA), AssumeRole, and session caching.
func GetAWSSession(ctx context.Context, meta ProfileMeta, mfaToken string) (*AWSSession, error) {
	// Always try the cache first — an MFA token may have already been consumed
	// by a prior call (e.g. listClusters) that seeded the cache.
	if s, ok := awsSessionCache.getActive(meta.Name); ok {
		return s, nil
	}

	// Prefer a serial persisted after a prior discover (in-memory meta may be stale).
	if meta.MFASerial == "" {
		meta.MFASerial = loadPersistedMFASerial(meta.Name)
	}

	// Role session expired but MFA STS still good → silent AssumeRole refresh.
	if meta.RoleARN != "" {
		if mfaSess, ok := awsSessionCache.getMFA(meta.Name); ok {
			roleCfg, err := mfaSess.awsConfig(meta.Region)
			if err == nil {
				sess, err := assumeRole(ctx, roleCfg, meta.RoleARN)
				if err == nil {
					awsSessionCache.set(meta.Name, sess, mfaSess)
					return sess, nil
				}
				if !isMFARequiredErr(err) && !strings.Contains(strings.ToLower(err.Error()), "expired") {
					return nil, fmt.Errorf("AssumeRole: %w", err)
				}
				// Fall through to full MFA re-auth.
			}
		}
	}

	// No cached session.
	if mfaToken == "" {
		if meta.MFASerial != "" {
			return nil, &NeedsMFAError{}
		}
	}

	// Load raw IAM credentials.
	cred, err := LoadCredential(meta.Name)
	if err != nil {
		return nil, fmt.Errorf("load credentials: %w", err)
	}

	baseCfg, err := config.LoadDefaultConfig(ctx,
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cred.AccessKeyID, cred.SecretAccessKey, "",
		)),
		config.WithRegion(meta.Region),
	)
	if err != nil {
		return nil, err
	}

	var sess *AWSSession
	var mfaSess *AWSSession

	if meta.MFASerial != "" {
		// Step 1: GetSessionToken with MFA → creds that carry MultiFactorAuthPresent=true.
		mfaSess, err = getSessionToken(ctx, baseCfg, meta.MFASerial, mfaToken)
		if err != nil {
			if isMFARequiredErr(err) {
				return nil, &NeedsMFAError{}
			}
			return nil, fmt.Errorf("GetSessionToken: %w", err)
		}
		sess = mfaSess
		// Step 2 (if role): AssumeRole using the MFA-authenticated session.
		if meta.RoleARN != "" {
			roleSessionCfg, _ := mfaSess.awsConfig(meta.Region)
			sess, err = assumeRole(ctx, roleSessionCfg, meta.RoleARN)
			if err != nil {
				if isMFARequiredErr(err) {
					return nil, &NeedsMFAError{}
				}
				return nil, fmt.Errorf("AssumeRole: %w", err)
			}
		}
	} else if meta.RoleARN != "" {
		// No MFA serial on the profile. Role trust may still require MFA
		// (serial missing when ListMFADevices failed at add-profile time).
		if mfaToken != "" {
			serial, discErr := prepareRoleMFASerial(&meta, cred.AccessKeyID, cred.SecretAccessKey, meta.Region)
			if discErr != nil {
				return nil, discErr
			}
			mfaSess, err = getSessionToken(ctx, baseCfg, serial, mfaToken)
			if err != nil {
				if isMFARequiredErr(err) {
					return nil, &NeedsMFAError{}
				}
				return nil, fmt.Errorf("GetSessionToken: %w", err)
			}
			roleSessionCfg, _ := mfaSess.awsConfig(meta.Region)
			sess, err = assumeRole(ctx, roleSessionCfg, meta.RoleARN)
			if err != nil {
				if isMFARequiredErr(err) {
					return nil, &NeedsMFAError{}
				}
				return nil, fmt.Errorf("AssumeRole: %w", err)
			}
		} else {
			sess, err = assumeRole(ctx, baseCfg, meta.RoleARN)
			if err != nil {
				if isMFARequiredErr(err) {
					return nil, &NeedsMFAError{}
				}
				return nil, fmt.Errorf("AssumeRole: %w", err)
			}
		}
	} else {
		// No MFA, no role: use raw IAM credentials directly.
		// IAM long-term keys don't expire; use a generous TTL for cache purposes.
		sess = &AWSSession{
			AccessKeyID:     cred.AccessKeyID,
			SecretAccessKey: cred.SecretAccessKey,
			Expiry:          time.Now().Add(12 * time.Hour),
		}
	}

	awsSessionCache.set(meta.Name, sess, mfaSess)
	return sess, nil
}

// loadPersistedMFASerial returns mfaSerial from app-config if previously saved.
func loadPersistedMFASerial(name string) string {
	cfg, err := LoadAppConfig()
	if err != nil {
		return ""
	}
	if p, ok := cfg.Profiles[awsCacheKey(name)]; ok {
		return p.MFASerial
	}
	return ""
}

// prepareRoleMFASerial discovers the IAM user's MFA device and persists it on
// the profile so later sessions skip rediscovery.
func prepareRoleMFASerial(meta *ProfileMeta, accessKeyID, secretKey, region string) (string, error) {
	if meta.MFASerial != "" {
		return meta.MFASerial, nil
	}
	serial, err := DiscoverMFASerial(accessKeyID, secretKey, region)
	if err != nil {
		return "", fmt.Errorf("discover MFA device: %w", err)
	}
	if serial == "" {
		return "", fmt.Errorf("role requires MFA, but no MFA device was found on this IAM user (need iam:ListMFADevices)")
	}
	meta.MFASerial = serial
	if saveErr := SaveProfile(*meta); saveErr != nil {
		log.Printf("[GetAWSSession] discovered MFA serial but failed to save profile %s: %v", meta.Name, saveErr)
	} else {
		log.Printf("[GetAWSSession] persisted MFA serial for profile %s", meta.Name)
	}
	return serial, nil
}

func getSessionToken(ctx context.Context, cfg aws.Config, mfaSerial, mfaToken string) (*AWSSession, error) {
	client := sts.NewFromConfig(cfg)
	input := &sts.GetSessionTokenInput{
		SerialNumber:    aws.String(mfaSerial),
		TokenCode:       aws.String(mfaToken),
		DurationSeconds: aws.Int32(mfaSessionSeconds),
	}
	result, err := client.GetSessionToken(ctx, input)
	if err != nil {
		return nil, err
	}
	c := result.Credentials
	return &AWSSession{
		AccessKeyID:     aws.ToString(c.AccessKeyId),
		SecretAccessKey: aws.ToString(c.SecretAccessKey),
		SessionToken:    aws.ToString(c.SessionToken),
		Expiry:          aws.ToTime(c.Expiration),
	}, nil
}

func assumeRole(ctx context.Context, cfg aws.Config, roleARN string) (*AWSSession, error) {
	client := sts.NewFromConfig(cfg)
	result, err := client.AssumeRole(ctx, &sts.AssumeRoleInput{
		RoleArn:         aws.String(roleARN),
		RoleSessionName: aws.String("k8s-client"),
	})
	if err != nil {
		return nil, err
	}
	c := result.Credentials
	return &AWSSession{
		AccessKeyID:     aws.ToString(c.AccessKeyId),
		SecretAccessKey: aws.ToString(c.SecretAccessKey),
		SessionToken:    aws.ToString(c.SessionToken),
		Expiry:          aws.ToTime(c.Expiration),
	}, nil
}

// ── EKS token ────────────────────────────────────────────────────────────────

// emptyStringSHA256 is the SHA-256 hash of an empty body, required by SigV4.
const emptyStringSHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// GenerateEKSToken creates an EKS bearer token ("k8s-aws-v1.<base64url>") by
// presigning STS GetCallerIdentity with x-k8s-aws-id in the signed headers.
// Using net/http + v4.PresignHTTP directly ensures the custom header is
// included in X-Amz-SignedHeaders (required by the EKS webhook authenticator).
func GenerateEKSToken(ctx context.Context, sess *AWSSession, region, clusterName string) (string, time.Time, error) {
	// Log the IAM entity that will appear in the EKS audit log.
	// If this is an IAM user (not a role), make sure it's in the cluster's aws-auth ConfigMap.
	cfg, err := sess.awsConfig(region)
	if err != nil {
		return "", time.Time{}, err
	}
	if id, err := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{}); err == nil {
		log.Printf("[EKS token] cluster=%s IAM-identity=%s", clusterName, aws.ToString(id.Arn))
	}

	// Build the STS GetCallerIdentity URL with explicit 60-second expiry.
	// X-Amz-Expires must be part of the query before signing (SigV4 presign spec).
	stsBase := fmt.Sprintf("https://sts.%s.amazonaws.com/", region)
	q := url.Values{}
	q.Set("Action", "GetCallerIdentity")
	q.Set("Version", "2011-06-15")
	q.Set("X-Amz-Expires", "60")
	stsURL := stsBase + "?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, stsURL, nil)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("build STS request: %w", err)
	}
	// x-k8s-aws-id must be set BEFORE signing so it appears in X-Amz-SignedHeaders.
	req.Header.Set("x-k8s-aws-id", clusterName)

	creds := aws.Credentials{
		AccessKeyID:     sess.AccessKeyID,
		SecretAccessKey: sess.SecretAccessKey,
		SessionToken:    sess.SessionToken,
	}

	signingTime := time.Now()
	signedURI, _, err := v4.NewSigner().PresignHTTP(
		ctx, creds, req, emptyStringSHA256, "sts", region, signingTime,
	)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("presign STS: %w", err)
	}

	// Log URL structure for debugging (no credentials exposed).
	if parsed, perr := url.Parse(signedURI); perr == nil {
		pq := parsed.Query()
		log.Printf("[EKS token] cluster=%s alg=%s expires=%s signed-headers=%s has-security-token=%v",
			clusterName,
			pq.Get("X-Amz-Algorithm"),
			pq.Get("X-Amz-Expires"),
			pq.Get("X-Amz-SignedHeaders"),
			pq.Get("X-Amz-Security-Token") != "",
		)
	}

	token := "k8s-aws-v1." + base64.RawURLEncoding.EncodeToString([]byte(signedURI))
	return token, signingTime.Add(14 * time.Minute), nil
}

// ── MFA discovery ────────────────────────────────────────────────────────────

// DiscoverMFASerial queries iam:ListMFADevices with raw IAM credentials.
// Returns "" if no MFA device is registered (direct-key auth, no MFA prompt).
func DiscoverMFASerial(accessKeyID, secretKey, region string) (string, error) {
	ctx := context.Background()
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyID, secretKey, "")),
		config.WithRegion(region),
	)
	if err != nil {
		return "", err
	}

	iamClient := iam.NewFromConfig(cfg)
	result, err := iamClient.ListMFADevices(ctx, &iam.ListMFADevicesInput{})
	if err != nil {
		// Can't confirm whether an MFA device exists — don't prompt.
		log.Printf("[DiscoverMFASerial] ListMFADevices failed (%v) — assuming no MFA", err)
		return "", nil
	}

	if len(result.MFADevices) == 0 {
		log.Printf("[DiscoverMFASerial] no MFA devices — skipping mfa_serial")
		return "", nil
	}
	serial := aws.ToString(result.MFADevices[0].SerialNumber)
	log.Printf("[DiscoverMFASerial] found: %s", serial)
	return serial, nil
}

// ── Caller identity (for session verification) ───────────────────────────────

// VerifyAWSCredentials checks that the credentials work by calling GetCallerIdentity.
func VerifyAWSCredentials(ctx context.Context, accessKeyID, secretKey, region string) error {
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKeyID, secretKey, "")),
		config.WithRegion(region),
	)
	if err != nil {
		return err
	}
	_, err = sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	return err
}
