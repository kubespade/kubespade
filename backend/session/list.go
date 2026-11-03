package session

// List returns a snapshot of all connected profile sessions.
func (st *Store) List() []*ProfileSession {
	st.mu.RLock()
	defer st.mu.RUnlock()
	out := make([]*ProfileSession, 0, len(st.sessions))
	for _, s := range st.sessions {
		out = append(out, s)
	}
	return out
}
