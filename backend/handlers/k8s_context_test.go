package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"k8s-client/services"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestRespondK8sConfigError_needsMFA(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	respondK8sConfigError(c, &services.NeedsMFAError{})

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("code = %d, want 401", w.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body["needsMFA"] != true {
		t.Errorf("body = %v, want needsMFA:true", body)
	}
}

func TestRespondK8sConfigError_generic(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	respondK8sConfigError(c, errors.New("boom"))

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("code = %d, want 500", w.Code)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	if body["error"] != "boom" {
		t.Errorf("body = %v, want error:boom", body)
	}
	if _, ok := body["needsMFA"]; ok {
		t.Error("generic error must not include needsMFA")
	}
}

func TestResolveSession_notConnected(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "name", Value: "no-such-profile"}}

	name, sess, ok := resolveSession(c)

	if ok {
		t.Fatal("expected ok=false for unknown profile")
	}
	if name != "" || sess != nil {
		t.Errorf("expected zero name/sess, got %q %v", name, sess)
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", w.Code)
	}
	var body map[string]interface{}
	_ = json.Unmarshal(w.Body.Bytes(), &body)
	if body["error"] != "profile not connected" {
		t.Errorf("body = %v", body)
	}
}

func TestResolveK8s_notConnected(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "name", Value: "no-such-profile"}}

	name, sess, cfg, ok := resolveK8s(c)

	if ok {
		t.Fatal("expected ok=false")
	}
	if name != "" || sess != nil || cfg != nil {
		t.Errorf("expected zero returns, got %q %v %v", name, sess, cfg)
	}
	if w.Code != http.StatusBadRequest {
		t.Fatalf("code = %d, want 400", w.Code)
	}
}
