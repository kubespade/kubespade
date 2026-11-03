package session

import (
	"context"
	"log"
	"sync"
	"time"

	"k8s-client/services"
)

const (
	healthInterval     = 20 * time.Second
	healthProbeTimeout = 5 * time.Second
	healthStartDelay   = 12 * time.Second
)

// StartHealthChecks periodically probes connected sessions and drops ones whose
// API server is gone (deleted/stopped cloud clusters). Keeps the sidebar green
// dot honest without waiting for the user to open the cluster.
func StartHealthChecks() {
	go func() {
		time.Sleep(healthStartDelay)
		t := time.NewTicker(healthInterval)
		defer t.Stop()
		for {
			Default.reapUnreachable()
			<-t.C
		}
	}()
}

func (st *Store) reapUnreachable() {
	sessions := st.List()
	if len(sessions) == 0 {
		return
	}

	var wg sync.WaitGroup
	for _, sess := range sessions {
		name := sess.Meta.Name
		if name == "" {
			continue
		}
		wg.Add(1)
		go func(name string, sess *ProfileSession) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), healthProbeTimeout)
			defer cancel()
			err := probeSession(ctx, sess)
			if err == nil {
				return
			}
			// Expired MFA — leave the session; UI will prompt on next use.
			if services.IsNeedsMFA(err) {
				return
			}
			log.Printf("session health %s: %v — disconnecting", name, err)
			for _, pf := range services.DefaultPFManager.List(name) {
				services.DefaultPFManager.Stop(pf.ID)
			}
			st.Remove(name)
			services.ClearAWSSession(name)
		}(name, sess)
	}
	wg.Wait()
}
